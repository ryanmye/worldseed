// onboarding (ui-additions 1, readable early map): before any state exists the globe shows the peoples as soft washes of
// their colour around their settlements, and the first hearths (the original tribes) as glowing markers, so the first
// centuries are not an empty planet with sub-pixel dots. One THREE.Points draw: a sprite per settlement, its wash a
// gaussian a few cells wide (wider with its population), its core a small pulsing glow for a hearth. The washes fade out
// over WASH_FADE years once the first state is founded (the faction tint takes over); the hearths' glow fades after
// HEARTH_YEARS. Globe only (hidden on the flat map); nothing is drawn on the far side.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { surfaceRadius } from './globe.ts'

const WASH_FADE = 150
const HEARTH_YEARS = 250
/** Wash radius in cell spacings: at least this, more with the population (sqrt), capped. */
const WASH_CELLS_MIN = 1.6
const WASH_CELLS_MAX = 5
const WASH_ALPHA = 0.28
/** The hearth's glowing core, in CSS pixels. */
const CORE_PX = 7

export interface PeopleWash {
  readonly object: THREE.Points
  /** Per frame: the year, the two snapshots around it and the camera. */
  update(year: number, s0: number, s1: number, frac: number, camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number, flatT: number): void
  dispose(): void
}

/** `rgb`: the peoples' colours (3 sRGB floats per people, PeoplesData.rgb); `people`: each settlement's people. */
export function buildPeopleWash(world: World, h: History, rgb: Float32Array, people: Int32Array): PeopleWash {
  const N = h.settlements.length
  const pos = new Float32Array(N * 3)
  const col = new Float32Array(N * 3)
  const life = new Float32Array(N * 2)
  const hearth = new Float32Array(N)
  const size = new Float32Array(N)
  const P = world.grid.positions
  for (let i = 0; i < N; i++) {
    const s = h.settlements[i]
    const r = surfaceRadius(world, s.cell) + 0.003
    pos[i * 3] = P[s.cell * 3] * r
    pos[i * 3 + 1] = P[s.cell * 3 + 1] * r
    pos[i * 3 + 2] = P[s.cell * 3 + 2] * r
    const p = people[i] ?? -1
    for (let k = 0; k < 3; k++) col[i * 3 + k] = p >= 0 ? rgb[p * 3 + k] : 0.8
    life[i * 2] = s.foundedYear
    life[i * 2 + 1] = s.abandonedYear < 0 ? 1e9 : s.abandonedYear
    hearth[i] = s.parent < 0 && !s.outpost ? 1 : 0
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 2))
  geo.setAttribute('aHearth', new THREE.BufferAttribute(hearth, 1))
  const sizeAttr = new THREE.BufferAttribute(size, 1)
  sizeAttr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('aSize', sizeAttr)
  // the first state's year: the washes give way to the factions' tint
  let firstState = Infinity
  for (const pol of h.polities ?? []) firstState = Math.min(firstState, pol.foundedYear)
  const spacing = Math.sqrt((4 * Math.PI) / Math.max(1, world.grid.cellCount))
  const uniforms = {
    uYear: { value: 0 },
    uWash: { value: 1 },
    uHearth: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uScale: { value: 1 },
    uCore: { value: CORE_PX },
    uTime: { value: 0 },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute vec2 aLife;
      attribute float aHearth;
      attribute float aSize;
      uniform float uYear, uWash, uHearth, uScale, uCore;
      uniform vec3 uCamObj;
      varying vec3 vColor;
      varying float vWashA, vCoreA, vCoreFrac;
      void main() {
        vColor = aColor;
        vec3 up = normalize(position);
        float facing = dot(up, normalize(uCamObj - position));
        bool alive = uYear >= aLife.x && uYear < aLife.y;
        vWashA = alive ? uWash * smoothstep(0.0, 0.25, facing) * smoothstep(0.0, 15.0, uYear - aLife.x) : 0.0;
        vCoreA = alive ? aHearth * uHearth * smoothstep(0.05, 0.3, facing) : 0.0;
        if (vWashA <= 0.001 && vCoreA <= 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float washPx = aSize * uScale / max(0.05, -mv.z);
        float px = max(washPx * sqrt(max(0.15, facing)), uCore * 2.6);
        vCoreFrac = uCore / px;
        gl_PointSize = px;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vColor;
      varying float vWashA, vCoreA, vCoreFrac;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float d = length(q);
        if (d > 1.0) discard;
        float wash = vWashA * ${WASH_ALPHA.toFixed(2)} * exp(-3.2 * d * d);
        float c = d / max(0.02, vCoreFrac);
        float pulse = 0.75 + 0.25 * sin(uTime * 2.4);
        float core = vCoreA * (smoothstep(1.0, 0.35, c) * 0.9 + exp(-1.4 * c * c) * 0.6 * pulse);
        vec3 glow = mix(vColor, vec3(1.0, 0.95, 0.8), 0.55);
        float a = clamp(wash + core, 0.0, 1.0);
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(vColor, glow, core / max(a, 1e-4)), a);
      }
    `,
  })
  const object = new THREE.Points(geo, mat)
  object.frustumCulled = false
  object.renderOrder = 4.5 // over the ground and its tints, under the clouds (5) and the markers
  let shownS = -1
  let clock = 0
  return {
    object,
    update(year, s0, s1, frac, camera, drawSize, pixelRatio, flatT) {
      const wash = Number.isFinite(firstState) ? 1 - Math.min(1, Math.max(0, (year - firstState) / WASH_FADE)) : 1
      const hearthA = 1 - Math.min(1, Math.max(0, (year - HEARTH_YEARS * 0.6) / (HEARTH_YEARS * 0.4)))
      object.visible = flatT === 0 && (wash > 0 || hearthA > 0)
      if (!object.visible) return
      uniforms.uYear.value = year
      uniforms.uWash.value = wash
      uniforms.uHearth.value = hearthA
      clock += 1 / 60
      uniforms.uTime.value = clock
      object.updateWorldMatrix(true, false)
      camera.getWorldPosition(uniforms.uCamObj.value)
      object.worldToLocal(uniforms.uCamObj.value)
      // world radius -> pixels: (radius / depth) * (viewport height / 2) / tan(fov / 2)
      uniforms.uScale.value = (drawSize.y * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      uniforms.uCore.value = CORE_PX * pixelRatio
      // population rows: only when the snapshot changes (the in-between frac is not worth an upload)
      const s = frac < 0.5 ? s0 : s1
      if (s === shownS) return
      shownS = s
      for (let i = 0; i < N; i++) {
        const pop = h.population[s * N + i]
        const cells = Math.min(WASH_CELLS_MAX, WASH_CELLS_MIN + Math.sqrt(Math.max(0, pop) / 400))
        size[i] = 2 * cells * spacing
      }
      sizeAttr.needsUpdate = true
    },
    dispose() {
      geo.dispose()
      mat.dispose()
    },
  }
}
