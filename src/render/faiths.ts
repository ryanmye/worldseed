// religion: the holy cities of the universal faiths and the capitals of states with a state religion
// on the map (data from ui/faithsData.ts), one instanced draw of static instances (one per faith with
// a holy city, one per run of snapshots in which a state kept the same capital and state religion).
// Shown on the Faiths view, and for a selected faith on any view; a pure function of the year: a holy
// city is marked from the faith's founding until the faith dies out or the city is abandoned. The holy
// city's mark is a small sunburst in the faith's colour over a dark rim, in the top slot over the
// marker one step above a capital's star (markerSlots.ts); a state religion is a thin ring in the
// faith's colour round the capital's marker (inside the ring band). The selected faith's marks are
// larger with a halo, the others dimmed. Globe and flat map (ws_place); in a known world, marks in
// cells not yet known are hidden. Nothing applies: no draw.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { CITY_POPULATION, TOWN_POPULATION } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'
import { requestRender } from './invalidate.ts'
import { stateFaithAt, type FaithsData } from '../ui/faithsData.ts'
import { holySlotHeight } from './markerSlots.ts'

const MARK_LIFT = 0.0047
const NEVER = 1e9

export interface FaithLayer {
  object: THREE.Group
  /** Whether the marks show (the Faiths view), and the selected faith (-1 none; its mark shows on any view). */
  setShown(on: boolean, selected: number): void
  setKnownMask(cellYear: Float32Array | null): void
  /** Draw order: over the clouds while a known world is shown. */
  setMasked(on: boolean): void
  setTime(year: number): void
  update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  readonly active: boolean
  dispose(): void
}

const VERT = /* glsl */ `
${RELIEF_GLSL}
attribute vec3 aPos;
attribute vec3 aA; // from, until, faith id
attribute vec3 aCol;
attribute vec2 aK; // kind (0 holy city, 1 state religion's capital), height over the marker (holy) or marker radius (ring), CSS px unscaled
attribute float aKnown;
uniform float uYear;
uniform float uSel;
uniform float uAll;
uniform float uMaskOn;
uniform float uSizeScale;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform vec3 uCamObj;
uniform vec3 uSunObj;
uniform float uDaylight;
varying vec2 vPx;
varying vec3 vCol;
varying float vSel;
varying float vDim;
varying float vAlpha;
varying float vR;
varying float vKind;
varying float vInner;
void main() {
  vec3 pos = ws_relief(aPos);
  vec3 up = normalize(pos);
  float facing = ws_facing(dot(up, normalize(uCamObj - pos)));
  bool sel = uSel >= 0.0 && abs(aA.z - uSel) < 0.5;
  bool on = uYear >= aA.x && uYear < aA.y && (uAll > 0.5 || sel);
  if (!on || (uMaskOn > 0.5 && uYear < aKnown) || facing <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float fs = uSizeScale * mix(0.7, 1.0, sqrt(facing));
  float R, ext;
  vec2 off = vec2(0.0);
  vKind = aK.x;
  vInner = 0.0;
  if (aK.x < 0.5) {
    R = (sel ? 8.0 : 6.2) * fs;
    ext = R + (sel ? 9.0 : 3.0);
    // the top slot, a step above a capital's star (markerSlots.ts)
    off = vec2(0.0, aK.y * fs + (sel ? 1.8 : 0.0) * fs);
  } else {
    // a ring hugging the capital's marker, under a mart's gold rings (which start a little further out)
    vInner = aK.y * uSizeScale * mix(0.55, 1.0, sqrt(facing));
    R = vInner + 1.1;
    ext = R + (sel ? 7.0 : 3.0);
  }
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(pos), 1.0);
  clip.xy += (position.xy * ext + off) * uPixelRatio * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  vPx = position.xy * ext;
  vR = R;
  vCol = aCol;
  vSel = sel ? 1.0 : 0.0;
  vDim = uSel >= 0.0 && !sel ? 0.45 : 1.0;
  vAlpha = smoothstep(0.0, 0.25, facing) * mix(1.0, 0.75, 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight)));
}
`

const FRAG = /* glsl */ `
varying vec2 vPx;
varying vec3 vCol;
varying float vSel;
varying float vDim;
varying float vAlpha;
varying float vR;
varying float vKind;
varying float vInner;
vec4 over(vec4 a, vec4 b) { return vec4(a.rgb + b.rgb * (1.0 - a.a), a.a + b.a * (1.0 - a.a)); }
void main() {
  vec2 p = vPx;
  float d = length(p);
  vec3 dark = vec3(0.05, 0.04, 0.06);
  if (vKind > 0.5) {
    // the state religion: a ring in the faith's colour, a dark line each side
    float w = vSel > 0.5 ? 1.3 : 1.1;
    float rd = abs(d - vR) - w;
    float fill = 1.0 - smoothstep(-0.5, 0.5, rd);
    float edge = 1.0 - smoothstep(-0.5, 0.5, rd - 0.6);
    vec4 o = vec4(mix(dark, mix(vCol, vec3(1.0), 0.3), fill) * edge, edge);
    if (vSel > 0.5) {
      float halo = (1.0 - smoothstep(0.0, 1.4, abs(d - vR - 6.0))) * 0.7;
      o = over(o, vec4(mix(vCol, vec3(1.0), 0.5) * halo, halo));
    }
    o *= vAlpha * vDim;
    if (o.a < 0.004) discard;
    gl_FragColor = o;
    return;
  }
  float ang = atan(p.y, p.x);
  // a pale gold eight-rayed star over a dark rim, its heart in the faith's colour
  float rays = 0.5 + 0.5 * cos(ang * 8.0 + 0.3927);
  float r = vR * (0.5 + 0.5 * pow(rays, 2.5));
  float body = 1.0 - smoothstep(r - 0.6, r + 0.6, d);
  float rim = 1.0 - smoothstep(r + 0.5, r + 1.7, d);
  float coreR = vR * 0.42;
  float core = 1.0 - smoothstep(coreR - 0.6, coreR + 0.6, d);
  float coreRim = 1.0 - smoothstep(coreR + 0.2, coreR + 1.2, d);
  vec3 c = mix(dark, vec3(1.0, 0.92, 0.62), body);
  c = mix(c, dark, coreRim * 0.85);
  c = mix(c, mix(vCol, vec3(1.0), 0.1), core);
  vec4 o = vec4(c * rim, rim);
  if (vSel > 0.5) {
    float halo = (1.0 - smoothstep(0.0, 1.6, abs(d - vR - 5.0))) * 0.85;
    o = over(o, vec4(mix(vCol, vec3(1.0), 0.5) * halo, halo));
  }
  o *= vAlpha * vDim;
  if (o.a < 0.004) discard;
  gl_FragColor = o;
}
`

export function buildFaithLayer(world: World, h: History, fd: FaithsData): FaithLayer {
  const P = world.grid.positions
  const N = fd.N
  const object = new THREE.Group()
  object.name = 'faiths'
  const holy = fd.faiths.filter((f) => f.holyCity >= 0 && f.holyCity < N)
  const popAt = (id: number, s: number) => h.population[Math.max(0, Math.min(h.snapshotCount - 1, s)) * N + id] ?? 0
  // the capitals of states with a state religion: runs of snapshots with the same capital and faith
  const rings: { id: number; from: number; until: number; f: number; pop: number }[] = []
  const pols = h.polities ?? []
  const iv = Math.max(1, fd.interval)
  if (h.stateFaith && pols.length) {
    const open = new Map<number, (typeof rings)[number]>()
    for (let s = 0; s < fd.S; s++) {
      const y = s * iv
      const seen = new Set<number>()
      pols.forEach((x, q) => {
        if (y < x.foundedYear || (x.endedYear >= 0 && y >= x.endedYear) || !x.capitals?.length) return
        const f = stateFaithAt(fd, q, s)
        if (f < 0) return
        let k = 0
        while (k + 1 < x.capitals.length && (x.capitalYears[k + 1] ?? Infinity) <= y) k++
        const id = x.capitals[k]
        if (id < 0 || id >= N || popAt(id, s) <= 0) return
        seen.add(q)
        const run = open.get(q)
        const tier = (p: number) => (p >= CITY_POPULATION ? 2 : p >= TOWN_POPULATION ? 1 : 0)
        if (run && run.id === id && run.f === f && tier(run.pop) === tier(popAt(id, s))) {
          run.until = y + iv
          return
        }
        const r = { id, from: y, until: y + iv, f, pop: popAt(id, s) }
        rings.push(r)
        open.set(q, r)
      })
      for (const q of [...open.keys()]) if (!seen.has(q)) open.delete(q)
    }
    // (the last snapshot's run lasts to the end of the history; none outlives its capital)
    for (const r of rings) {
      const ab = h.settlements[r.id].abandonedYear
      if (r.until >= (fd.S - 1) * iv + iv) r.until = NEVER
      if (ab >= 0) r.until = Math.min(r.until, ab)
    }
  }
  const n = holy.length + rings.length
  const cap = Math.max(1, n)
  const aPos = new Float32Array(cap * 3), aA = new Float32Array(cap * 3), aCol = new Float32Array(cap * 3), aK = new Float32Array(cap * 2), aKnown = new Float32Array(cap)
  const cells = new Int32Array(cap).fill(-1)
  const put = (k: number, id: number, from: number, until: number, f: number) => {
    const cell = h.settlements[id].cell
    cells[k] = cell
    const r = surfaceRadius(world, cell) + MARK_LIFT
    aPos[k * 3] = P[cell * 3] * r
    aPos[k * 3 + 1] = P[cell * 3 + 1] * r
    aPos[k * 3 + 2] = P[cell * 3 + 2] * r
    aA[k * 3] = from
    aA[k * 3 + 1] = until
    aA[k * 3 + 2] = f
    aCol[k * 3] = fd.rgb[f * 3]
    aCol[k * 3 + 1] = fd.rgb[f * 3 + 1]
    aCol[k * 3 + 2] = fd.rgb[f * 3 + 2]
  }
  holy.forEach((f, k) => {
    const s = h.settlements[f.holyCity]
    put(k, f.holyCity, f.foundedYear, Math.min(f.endedYear >= 0 ? f.endedYear : NEVER, s.abandonedYear >= 0 ? s.abandonedYear : NEVER), f.id)
    // the top slot by the city's size over the faith's life (its largest)
    let pop = 0
    for (let q = Math.floor(f.foundedYear / iv); q < h.snapshotCount; q++) pop = Math.max(pop, popAt(f.holyCity, q))
    aK[k * 2] = 0
    aK[k * 2 + 1] = holySlotHeight(pop)
  })
  rings.forEach((x, j) => {
    const k = holy.length + j
    put(k, x.id, x.from, x.until, x.f)
    aK[k * 2] = 1
    // the capital's marker radius (as render/settlements.ts at its tier)
    aK[k * 2 + 1] = x.pop >= CITY_POPULATION ? 7.0 : x.pop >= TOWN_POPULATION ? 4.6 : 2.6
  })
  const geom = new THREE.InstancedBufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  geom.setIndex([0, 1, 2, 0, 2, 3])
  const knownAttr = new THREE.InstancedBufferAttribute(aKnown, 1).setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3))
  geom.setAttribute('aA', new THREE.InstancedBufferAttribute(aA, 3))
  geom.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3))
  geom.setAttribute('aK', new THREE.InstancedBufferAttribute(aK, 2))
  geom.setAttribute('aKnown', knownAttr)
  geom.instanceCount = n
  const u = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uSel: { value: -1 },
    uAll: { value: 0 },
    uMaskOn: { value: 0 },
    uSizeScale: { value: 1 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 8.68 // over the settlement markers and the sickness marks
  mesh.name = 'holy cities and state religions'
  mesh.visible = false
  object.add(mesh)

  let shown = false
  let sel = -1
  let year = 0
  /** Holy cities marked at some year: [from, until) per instance, for a quick test of whether anything shows. */
  const anyAt = (y: number) => {
    for (let k = 0; k < n; k++) if (y >= aA[k * 3] && y < aA[k * 3 + 1] && (shown || aA[k * 3 + 2] === sel)) return true
    return false
  }
  const sync = () => {
    const v = n > 0 && (shown || sel >= 0) && anyAt(year)
    if (v !== mesh.visible) {
      mesh.visible = v
      requestRender()
    }
  }
  const tmpQ = new THREE.Quaternion()
  const camObj = new THREE.Vector3()
  return {
    object,
    setShown(on: boolean, selected: number) {
      shown = on
      sel = selected
      u.uAll.value = on ? 1 : 0
      u.uSel.value = selected
      sync()
      requestRender()
    },
    setKnownMask(cellYear: Float32Array | null) {
      u.uMaskOn.value = cellYear ? 1 : 0
      for (let k = 0; k < n; k++) aKnown[k] = cellYear && cells[k] >= 0 ? (cellYear[cells[k]] ?? NEVER) : 0
      knownAttr.needsUpdate = true
      requestRender()
    },
    setMasked(on: boolean) {
      mesh.renderOrder = on ? 9.78 : 8.68
    },
    setTime(y: number) {
      year = y
      u.uYear.value = y
      sync()
    },
    update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number) {
      if (!mesh.visible) return
      object.updateWorldMatrix(true, false)
      camera.getWorldPosition(camObj)
      object.worldToLocal(camObj)
      u.uCamObj.value.copy(camObj)
      object.getWorldQuaternion(tmpQ).invert()
      u.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      u.uViewport.value.copy(drawSize)
      u.uPixelRatio.value = pixelRatio
      u.uSizeScale.value = Math.min(1.5, Math.max(0.8, Math.sqrt(3.25 / Math.max(1e-3, (camera as THREE.PerspectiveCamera).position.length()))))
    },
    get active() {
      return mesh.visible
    },
    dispose() {
      geom.dispose()
      mat.dispose()
    },
  }
}
