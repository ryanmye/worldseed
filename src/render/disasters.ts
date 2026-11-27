// disasters: the natural shocks on the globe (History.disasters). One instanced screen-space glyph per located row
// (eruptions, earthquakes that struck someone or reached M 8.5, tsunamis, great floods), static per history; the year,
// the pulse length and the known-world mask are uniforms, so what is drawn is a pure function of the year:
//  - eruption: an ash-grey cone with an ember core at the volcano, fading over 5 years; in its year a grey plume ring
//    spreads from it (VEI 6-7 larger);
//  - earthquake: concentric ochre ripples at the epicentre in its year, fading over 3 years;
//  - tsunami: a pale white ring racing out from the epicentre in its year;
//  - flood: a blue disc on the largest town struck, for its year and the next.
// Colours keep clear of the disease chartreuse/bone, the blight browns and the war reds. Cells the viewing people does not
// know are hidden. Not drawn (deferred): the drought wash over a weather region and the hemisphere wash of great eruptions.

import * as THREE from 'three'
import { DisasterKind, type History, type World } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'

const LIFT = 0.0046
const NEVER = 1e9

export interface DisasterLayer {
  mesh: THREE.Mesh
  setTime(year: number, pulseYears: number): void
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  setKnownMask(cellYear: Float32Array | null): void
  dispose(): void
}

export function buildDisasterLayer(world: World, h: History): DisasterLayer | null {
  const d = (h as Partial<History>).disasters
  if (!d || d.count === 0) return null
  const rows: number[] = []
  for (let i = 0; i < d.count; i++) {
    const k = d.kind[i]
    if (d.cell[i] < 0) continue
    if (k === DisasterKind.Eruption || k === DisasterKind.Tsunami || k === DisasterKind.Flood || (k === DisasterKind.Earthquake && (d.struck[i] > 0 || d.size[i] >= 8.5))) rows.push(i)
  }
  const n = rows.length
  if (n === 0) return null
  const P = world.grid.positions
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const pos = new Float32Array(n * 3)
  const info = new Float32Array(n * 3) // year, kind, magnitude 0..1
  const known = new Float32Array(n)
  const cells: number[] = []
  for (let t = 0; t < n; t++) {
    const i = rows[t]
    const c = d.cell[i]
    cells.push(c)
    const r = surfaceRadius(world, c) + LIFT
    pos[t * 3] = P[c * 3] * r
    pos[t * 3 + 1] = P[c * 3 + 1] * r
    pos[t * 3 + 2] = P[c * 3 + 2] * r
    const k = d.kind[i]
    info[t * 3] = d.year[i]
    info[t * 3 + 1] = k
    info[t * 3 + 2] = k === DisasterKind.Eruption ? (d.size[i] - 5) / 2 : k === DisasterKind.Earthquake ? Math.min(1, Math.max(0, (d.size[i] - 7) / 2)) : k === DisasterKind.Tsunami ? 1 : Math.min(1, d.size[i] * 20)
  }
  const knownAttr = new THREE.InstancedBufferAttribute(known, 1)
  quad.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3))
  quad.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 3))
  quad.setAttribute('aKnown', knownAttr)
  quad.instanceCount = n
  const uniforms = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uPulseYears: { value: 20 },
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
      attribute vec3 aInfo;
      attribute float aKnown;
      uniform float uYear;
      uniform float uPulseYears;
      uniform vec2 uViewport;
      uniform float uPixelRatio;
      uniform vec3 uCamObj;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      uniform float uSizeScale;
      uniform float uMaskOn;
      varying vec2 vPx;
      varying float vR;
      varying float vKind;
      varying float vAge;
      varying float vLife;
      varying float vMag;
      varying float vAlpha;
      varying float vNight;
      void main() {
        vec3 aPosR = ws_relief(aPos);
        float kind = aInfo.y;
        float life = kind < 0.5 ? 5.0 : kind < 1.5 ? 3.0 : kind < 2.5 ? 2.0 : 2.0;
        float age = uYear - aInfo.x;
        bool shown = age >= 0.0 && age < life;
        if (uMaskOn > 0.5 && uYear < aKnown) shown = false;
        vec3 up = normalize(aPosR);
        float facing = ws_facing(dot(up, normalize(uCamObj - aPosR)));
        if (!shown || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vKind = kind;
        vAge = age;
        vLife = life;
        vMag = aInfo.z;
        float r = (kind < 0.5 ? 5.0 + 2.0 * aInfo.z : 4.0) * uSizeScale * mix(0.6, 1.0, sqrt(facing));
        float ext = r + 14.0 + 26.0 * aInfo.z + (kind > 1.5 && kind < 2.5 ? 30.0 : 0.0);
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(aPosR), 1.0);
        clip.xy += position.xy * ext * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = position.xy * ext;
        vR = r;
        vAlpha = smoothstep(0.0, 0.3, facing);
        vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vPx;
      varying float vR;
      varying float vKind;
      varying float vAge;
      varying float vLife;
      varying float vMag;
      varying float vAlpha;
      varying float vNight;
      void ring(inout vec3 c, inout float a, vec3 col, float rr, float w, float k) {
        float x = (1.0 - smoothstep(w * 0.4, w, abs(length(vPx) - rr))) * k;
        c = col * x + c * (1.0 - x);
        a = x + a * (1.0 - x);
      }
      void main() {
        vec3 c = vec3(0.0);
        float a = 0.0;
        float L = length(vPx);
        float fade = 1.0 - smoothstep(vLife * 0.5, vLife, vAge);
        float t = clamp(vAge, 0.0, 1.0); // the first year: the spreading marks
        if (vKind < 0.5) {
          // eruption: plume ring, then the cone
          if (vAge < 1.0) ring(c, a, vec3(0.62, 0.6, 0.58), vR + (12.0 + 24.0 * vMag) * sqrt(t), 2.2, pow(1.0 - t, 1.2));
          vec2 p = vPx;
          float cone = max(abs(p.x) * 0.9 + p.y * 0.55 - vR * 0.7, -p.y - vR * 0.55);
          float body = (1.0 - smoothstep(-0.5, 0.8, cone)) * fade;
          vec3 ash = vec3(0.45, 0.42, 0.4);
          c = ash * body + c * (1.0 - body);
          a = body + a * (1.0 - body);
          float core = (1.0 - smoothstep(vR * 0.15, vR * 0.4, length(p - vec2(0.0, vR * 0.35)))) * fade;
          c = vec3(1.0, 0.55, 0.18) * core + c * (1.0 - core);
          a = core + a * (1.0 - core);
        } else if (vKind < 1.5) {
          // earthquake: ochre ripples in its year, a faint ring after
          for (int k = 0; k < 3; k++) {
            float tt = clamp(t * 1.4 - float(k) * 0.2, 0.0, 1.0);
            if (vAge < 1.0) ring(c, a, vec3(0.86, 0.66, 0.36), vR + (8.0 + 22.0 * vMag) * sqrt(tt), 1.8, pow(1.0 - tt, 1.3) * step(0.0, t * 1.4 - float(k) * 0.2));
          }
          ring(c, a, vec3(0.86, 0.66, 0.36), vR, 1.4, 0.8 * fade);
        } else if (vKind < 2.5) {
          // tsunami: a pale white ring racing out
          if (vAge < 1.0) ring(c, a, vec3(0.92, 0.96, 1.0), vR + 60.0 * sqrt(t), 2.6, pow(1.0 - t, 1.1));
          ring(c, a, vec3(0.92, 0.96, 1.0), vR * 1.2, 1.4, 0.7 * fade);
        } else {
          // flood: a blue disc
          float body = (1.0 - smoothstep(vR * 0.8, vR * 1.4, L)) * 0.8 * fade;
          c = vec3(0.3, 0.55, 0.95) * body + c * (1.0 - body);
          a = body + a * (1.0 - body);
        }
        float k = vAlpha * mix(1.0, 0.55, vNight);
        c *= k;
        a *= k;
        if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
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
  mesh.renderOrder = 8.42
  const tmpQ = new THREE.Quaternion()
  return {
    mesh,
    setTime(year: number, pulseYears: number) {
      uniforms.uYear.value = year
      uniforms.uPulseYears.value = pulseYears
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
