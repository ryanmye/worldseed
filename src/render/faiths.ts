// religion: the holy cities of the universal faiths on the map (data from ui/faithsData.ts), one
// instanced draw of static instances (one per faith with a holy city). Shown on the Faiths view, and
// for a selected faith on any view; a pure function of the year: a holy city is marked from the
// faith's founding until the faith dies out or the city is abandoned. The mark is a small sunburst in
// the faith's colour over a dark rim; the selected faith's is larger with a halo, the others dimmed. Globe and flat map
// (ws_place); in a known world, marks in cells not yet known are hidden. Nothing applies: no draw.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'
import { requestRender } from './invalidate.ts'
import type { FaithsData } from '../ui/faithsData.ts'

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
  float R = (sel ? 8.0 : 6.2) * uSizeScale * mix(0.7, 1.0, sqrt(facing));
  float ext = R + (sel ? 9.0 : 3.0);
  // above the town's marker (a city's ring is about CITY_MIN_RADIUS), so both read
  vec2 off = vec2(0.0, 7.0 * uSizeScale + R + 1.0);
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
vec4 over(vec4 a, vec4 b) { return vec4(a.rgb + b.rgb * (1.0 - a.a), a.a + b.a * (1.0 - a.a)); }
void main() {
  vec2 p = vPx;
  float d = length(p);
  float ang = atan(p.y, p.x);
  // a pale gold eight-rayed star over a dark rim, its heart in the faith's colour
  float rays = 0.5 + 0.5 * cos(ang * 8.0 + 0.3927);
  float r = vR * (0.5 + 0.5 * pow(rays, 2.5));
  float body = 1.0 - smoothstep(r - 0.6, r + 0.6, d);
  float rim = 1.0 - smoothstep(r + 0.5, r + 1.7, d);
  vec3 dark = vec3(0.05, 0.04, 0.06);
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
  const n = holy.length
  const cap = Math.max(1, n)
  const aPos = new Float32Array(cap * 3), aA = new Float32Array(cap * 3), aCol = new Float32Array(cap * 3), aKnown = new Float32Array(cap)
  const cells = new Int32Array(cap).fill(-1)
  holy.forEach((f, k) => {
    const s = h.settlements[f.holyCity]
    const cell = s.cell
    cells[k] = cell
    const r = surfaceRadius(world, cell) + MARK_LIFT
    aPos[k * 3] = P[cell * 3] * r
    aPos[k * 3 + 1] = P[cell * 3 + 1] * r
    aPos[k * 3 + 2] = P[cell * 3 + 2] * r
    const until = Math.min(f.endedYear >= 0 ? f.endedYear : NEVER, s.abandonedYear >= 0 ? s.abandonedYear : NEVER)
    aA[k * 3] = f.foundedYear
    aA[k * 3 + 1] = until
    aA[k * 3 + 2] = f.id
    aCol[k * 3] = fd.rgb[f.id * 3]
    aCol[k * 3 + 1] = fd.rgb[f.id * 3 + 1]
    aCol[k * 3 + 2] = fd.rgb[f.id * 3 + 2]
  })
  const geom = new THREE.InstancedBufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  geom.setIndex([0, 1, 2, 0, 2, 3])
  const knownAttr = new THREE.InstancedBufferAttribute(aKnown, 1).setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3))
  geom.setAttribute('aA', new THREE.InstancedBufferAttribute(aA, 3))
  geom.setAttribute('aCol', new THREE.InstancedBufferAttribute(aCol, 3))
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
  mesh.name = 'holy cities'
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
