// The player's nudges on the map: a small target mark (a ring with a dot) at each order's place while it is in force,
// and for Explore and Settle a dotted line from the actor's town to the target. One instanced screen-space glyph draw for
// all of it (marks and dots are instances of the same quad), static per history: each instance carries the years it is
// shown [from, to) and the year the known world shown includes its cell, so what is drawn is a function of the year
// (uniforms only, nothing per frame on the CPU). Built only when there are orders: none, no mesh and no cost.

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'

const LIFT = 0.005
const NEVER = 1e9
/** Dots along a line: one per this many radians of arc (about 0.7 degrees), at most MAX_DOTS. */
const DOT_STEP = 0.012
const MAX_DOTS = 160

/** One thing to draw: a mark at `cell`, and (with `from` >= 0) a dotted line from cell `from` to it; shown from year `y0` until `y1`. */
export interface NudgeMark {
  cell: number
  from: number
  y0: number
  y1: number
  /** 0 the people's orders (exploration, settlement: cyan), 1 the state's and the town's (amber). */
  tone: number
}

export interface NudgeLayer {
  mesh: THREE.Mesh
  setTime(year: number): void
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  setKnownMask(cellYear: Float32Array | null): void
  dispose(): void
}

export function buildNudgeLayer(world: World, marks: readonly NudgeMark[]): NudgeLayer | null {
  if (marks.length === 0) return null
  const P = world.grid.positions
  const pos: number[] = []
  const info: number[] = [] // y0, y1, kind (0 mark, 1 dot), tone
  const cells: number[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), v = new THREE.Vector3()
  for (const m of marks) {
    const r = surfaceRadius(world, m.cell) + LIFT
    pos.push(P[m.cell * 3] * r, P[m.cell * 3 + 1] * r, P[m.cell * 3 + 2] * r)
    info.push(m.y0, m.y1, 0, m.tone)
    cells.push(m.cell)
    if (m.from < 0 || m.from === m.cell) continue
    a.set(P[m.from * 3], P[m.from * 3 + 1], P[m.from * 3 + 2]).normalize()
    b.set(P[m.cell * 3], P[m.cell * 3 + 1], P[m.cell * 3 + 2]).normalize()
    const ang = a.angleTo(b)
    const n = Math.min(MAX_DOTS, Math.max(2, Math.ceil(ang / DOT_STEP)))
    const ra = surfaceRadius(world, m.from) + LIFT
    const sin = Math.sin(ang)
    for (let k = 1; k < n; k++) {
      const t = k / n
      // slerp along the great circle, the radius eased between the two ends
      if (sin < 1e-6) v.copy(a)
      else v.copy(a).multiplyScalar(Math.sin((1 - t) * ang) / sin).addScaledVector(b, Math.sin(t * ang) / sin)
      v.normalize().multiplyScalar(ra + (r - ra) * t)
      pos.push(v.x, v.y, v.z)
      info.push(m.y0, m.y1, 1, m.tone)
      // (the known-world mask of a dot: the nearer end's cell)
      cells.push(t < 0.5 ? m.from : m.cell)
    }
  }
  const n = cells.length
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const known = new Float32Array(n)
  const knownAttr = new THREE.InstancedBufferAttribute(known, 1)
  quad.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 3))
  quad.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(info), 4))
  quad.setAttribute('aKnown', knownAttr)
  quad.instanceCount = n
  const uniforms = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uSizeScale: { value: 1 },
    uMaskOn: { value: 0 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec3 aPos;
      attribute vec4 aInfo;
      attribute float aKnown;
      uniform float uYear;
      uniform vec2 uViewport;
      uniform float uPixelRatio;
      uniform vec3 uCamObj;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      uniform float uSizeScale;
      uniform float uMaskOn;
      varying vec2 vPx;
      varying float vR;
      varying float vDot;
      varying float vTone;
      varying float vAlpha;
      void main() {
        vec3 p = ws_relief(aPos);
        bool shown = uYear >= aInfo.x && uYear < aInfo.y;
        if (uMaskOn > 0.5 && uYear < aKnown) shown = false;
        vec3 up = normalize(p);
        float facing = ws_facing(dot(up, normalize(uCamObj - p)));
        if (!shown || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vDot = aInfo.z;
        vTone = aInfo.w;
        float r = (vDot > 0.5 ? 1.6 : 7.0) * uSizeScale * mix(0.6, 1.0, sqrt(facing));
        float ext = r + 2.5;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(p), 1.0);
        clip.xy += position.xy * ext * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = position.xy * ext;
        vR = r;
        float night = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
        vAlpha = smoothstep(0.0, 0.3, facing) * mix(1.0, 0.7, night);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vPx;
      varying float vR;
      varying float vDot;
      varying float vTone;
      varying float vAlpha;
      void main() {
        vec3 col = vTone > 0.5 ? vec3(1.0, 0.78, 0.42) : vec3(0.55, 0.92, 1.0);
        vec3 rim = vec3(0.02, 0.03, 0.05);
        float d = length(vPx);
        float a, body;
        if (vDot > 0.5) {
          body = 1.0 - smoothstep(vR - 0.6, vR + 0.6, d);
          a = (1.0 - smoothstep(vR + 0.2, vR + 1.6, d)) * 0.85;
        } else {
          // a ring with a dot at its centre (a target), on a dark halo
          float ring = 1.0 - smoothstep(0.7, 1.5, abs(d - vR));
          float centre = 1.0 - smoothstep(1.4, 2.4, d);
          body = max(ring, centre);
          float halo = max(1.0 - smoothstep(1.6, 3.0, abs(d - vR)), 1.0 - smoothstep(2.4, 3.8, d));
          a = max(body, halo * 0.75);
        }
        vec3 c = mix(rim, col, body / max(a, 1e-3));
        a *= vAlpha * (vDot > 0.5 ? 0.8 : 1.0);
        if (a < 0.004) discard;
        gl_FragColor = vec4(c * a, a);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(quad, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 9.76 // (over the clouds and the known-world mist: an order's place is the player's, always in view)
  const tmpQ = new THREE.Quaternion()
  return {
    mesh,
    setTime(year: number) {
      uniforms.uYear.value = year
      // (no draw call in the years when nothing is in force)
      let on = false
      for (const m of marks) if (year >= m.y0 && year < m.y1) { on = true; break }
      mesh.visible = on
    },
    update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      mesh.updateWorldMatrix(true, false)
      mesh.getWorldQuaternion(tmpQ).invert()
      uniforms.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(uniforms.uCamObj.value)
      mesh.worldToLocal(uniforms.uCamObj.value)
      uniforms.uViewport.value.copy(drawSize)
      uniforms.uPixelRatio.value = pixelRatio
      uniforms.uSizeScale.value = Math.min(1.4, Math.max(0.85, Math.sqrt(3.25 / camera.position.length())))
    },
    setKnownMask(cellYear: Float32Array | null) {
      uniforms.uMaskOn.value = cellYear ? 1 : 0
      if (!cellYear) return
      for (let i = 0; i < n; i++) known[i] = cellYear[cells[i]] ?? NEVER
      knownAttr.needsUpdate = true
    },
    dispose() {
      quad.dispose()
      material.dispose()
    },
  }
}
