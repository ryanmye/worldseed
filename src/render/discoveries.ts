// Discoveries: a small permanent mark at each place an expedition reached first (a pole,
// the highest summit, the heart of the great desert, an unsettled land), from the year of
// the Discovery event on, with a brief pulse when it happens. A pole gets a larger
// compass-star in a ring; everything else a small four-pointed star. One instanced
// screen-space glyph per discovery, static per history; the year, the pulse length and the
// known-world mask are uniforms (the mask's per-instance year is uploaded once per
// selection), so what is shown is a function of the year.
//
// Discovery places come from ui/expeditionsData.ts (the events carry no cell).

import * as THREE from 'three'
import type { World } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { sunUniforms } from './sun.ts'
import { DiscoveryKind, type Discovery } from '../ui/expeditionsData.ts'

const LIFT = 0.0045
const NEVER = 1e9

export interface DiscoveryLayer {
  mesh: THREE.Mesh
  setTime(year: number, pulseYears: number): void
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  setKnownMask(cellYear: Float32Array | null): void
  dispose(): void
}

export function buildDiscoveryLayer(world: World, list: readonly Discovery[]): DiscoveryLayer | null {
  const n = list.length
  if (n === 0) return null
  const P = world.grid.positions
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const pos = new Float32Array(n * 3)
  const info = new Float32Array(n * 2) // year, pole (1) or not (0)
  const known = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const c = list[i].cell
    const r = surfaceRadius(world, c) + LIFT
    pos[i * 3] = P[c * 3] * r
    pos[i * 3 + 1] = P[c * 3 + 1] * r
    pos[i * 3 + 2] = P[c * 3 + 2] * r
    info[i * 2] = list[i].year
    info[i * 2 + 1] = list[i].kind === DiscoveryKind.NorthPole || list[i].kind === DiscoveryKind.SouthPole ? 1 : 0
  }
  const knownAttr = new THREE.InstancedBufferAttribute(known, 1)
  quad.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3))
  quad.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 2))
  quad.setAttribute('aKnown', knownAttr)
  quad.instanceCount = n
  const uniforms = {
    uReliefK: reliefUniforms.uReliefK,
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
      attribute vec2 aInfo;
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
      varying float vPole;
      varying float vPulse;
      varying float vAlpha;
      varying float vNight;
      void main() {
        vec3 aPosR = ws_relief(aPos); // the ground at the zoom's relief (terrainHeight.ts)
        bool shown = uYear >= aInfo.x;
        if (uMaskOn > 0.5 && uYear < aKnown) shown = false;
        vec3 up = normalize(aPosR);
        float facing = dot(up, normalize(uCamObj - aPosR));
        if (!shown || facing <= 0.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        float age = uYear - aInfo.x;
        float pulse = uPulseYears * 2.5;
        vPulse = age < pulse ? age / pulse : -1.0;
        vPole = aInfo.y;
        float r = (vPole > 0.5 ? 7.5 : 5.0) * uSizeScale * mix(0.6, 1.0, sqrt(facing));
        float ext = vPulse >= 0.0 ? r + 34.0 : r + 3.0;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(aPosR, 1.0);
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
      varying float vPole;
      varying float vPulse;
      varying float vAlpha;
      varying float vNight;
      // a star with k points: distance-like value, negative inside
      float star(vec2 p, float r, float k, float inner) {
        float a = atan(p.y, p.x);
        float m = 0.5 + 0.5 * cos(a * k);
        float rr = mix(r * inner, r, pow(m, 3.0));
        return length(p) - rr;
      }
      void main() {
        vec2 p = vPx;
        float R = vR;
        vec3 gold = vec3(1.0, 0.88, 0.5);
        vec3 rim = vec3(0.10, 0.07, 0.03);
        vec3 c = vec3(0.0);
        float a = 0.0;
        // pulse: two pale rings racing outward
        if (vPulse >= 0.0) {
          for (int k = 0; k < 2; k++) {
            float t = clamp(vPulse * 1.3 - float(k) * 0.3, 0.0, 1.0);
            float pr = R + 30.0 * sqrt(t);
            float ring = (1.0 - smoothstep(0.8, 2.2, abs(length(p) - pr))) * pow(1.0 - t, 1.3) * step(0.0, vPulse * 1.3 - float(k) * 0.3);
            c = gold * ring + c * (1.0 - ring);
            a = ring + a * (1.0 - ring);
          }
        }
        float d = vPole > 0.5 ? star(p, R, 8.0, 0.38) : star(p, R, 4.0, 0.3);
        float halo = (1.0 - smoothstep(1.2, 2.6, d)) * 0.8;
        c = rim * halo + c * (1.0 - halo);
        a = halo + a * (1.0 - halo);
        if (vPole > 0.5) {
          float ring = 1.0 - smoothstep(0.5, 1.4, abs(length(p) - R * 1.2));
          c = gold * ring + c * (1.0 - ring);
          a = ring + a * (1.0 - ring);
        }
        float body = 1.0 - smoothstep(0.0, 1.0, d);
        vec3 fill = mix(gold, vec3(1.0, 0.98, 0.92), 1.0 - smoothstep(0.0, R * 0.5, length(p)));
        c = fill * body + c * (1.0 - body);
        a = body + a * (1.0 - body);
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
  mesh.renderOrder = 8.4
  const tmpQ = new THREE.Quaternion()
  const cells = list.map((d) => d.cell)
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
