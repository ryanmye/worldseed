// Expedition bases (Settlement.outpost) and the traces of expeditions on the globe.
//
//  - Flags: one instanced screen-space glyph per base, a pennant in its people's colour on
//    a pole standing up from the ground (screen "up" follows the local vertical), shown
//    from mid zoom (and always while selected or hovered). Bases are not settlements: the
//    settlement layer skips them and this layer draws and picks them instead.
//  - Lost expeditions: a small pale cross at the last point a lost expedition reached, from
//    the year it was lost (instances of the same glyph mesh).
//  - Supply lines: a thin dashed line along the route from each base's parent to the base,
//    bright while the base or its parent is selected (or hovered), faint otherwise at mid
//    zoom.
//  - Camps: up close (where the 3D towns appear) a base is a tiny camp of generated
//    geometry styled by its ground: a hut and sledges on the ice, tents and a cairn on the
//    tundra and in the mountains, tents and crates in the desert; always a flagpole in its
//    people's colour. No town plan, no fields.
//
// Everything is static per history (one upload) except per-frame uniforms; what is shown
// is a function of the year, the selection and the camera. A known-world mask (per cell,
// the year from which the place is known) hides what the people whose world is shown did
// not know.

import * as THREE from 'three'
import { Biome, type History, type World } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefRadius, reliefUniforms } from './terrainHeight.ts'
import { sunUniforms } from './sun.ts'
import type { ExpeditionData } from '../ui/expeditionsData.ts'
import { DIORAMA_FAR, DIORAMA_NEAR } from './dioramas/layer.ts'
import { KK } from './dioramas/models.ts'

const LIFT = 0.004
const LINE_LIFT = 0.0032
const NEVER = 1e9
/** Lost-expedition marks fade to this opacity over LOST_FADE_YEARS after the loss. */
const LOST_FADE_YEARS = 250
/** Camera distance over which the flags fade in (far, near). */
const FLAG_FAR = 2.95
const FLAG_NEAR = 2.45

export interface OutpostLayer {
  object: THREE.Group
  /** Per frame: year and pulse length in years. */
  setTime(year: number, pulseYears: number): void
  /** Selected and hovered settlement ids (-1: none): a base's flag rings, its supply line (or its parent's lines) brighten. */
  setSelected(id: number): void
  setHovered(id: number): void
  /** Per frame while visible. */
  update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** Base (settlement id) whose flag is at CSS pixel (x, y), or -1. */
  pick(camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number, slopPx: number): number
  centerLocal(id: number, out: THREE.Vector3): THREE.Vector3
  /** Per cell, the year from which it is known (1e9 never); null shows all. */
  setKnownMask(cellYear: Float32Array | null): void
  /** Flags (with the settlement markers), traces (supply lines and lost marks: with the expeditions), camps (with the buildings). */
  setFlagsVisible(on: boolean): void
  setTracesVisible(on: boolean): void
  setCampsVisible(on: boolean): void
  /** Within camera distance near..far the flags step back for the camps (far <= 0: off). */
  setYield(near: number, far: number): void
  /** Draw order of the flags (raised over the clouds in the known-world view). */
  setFlagOrder(order: number): void
  readonly count: number
  dispose(): void
}

const unitOf = (world: World, c: number, out: THREE.Vector3) => out.set(world.grid.positions[c * 3], world.grid.positions[c * 3 + 1], world.grid.positions[c * 3 + 2])

/** Two rounds of corner cutting on the unit sphere: a cell-to-cell route drawn as a smooth line. */
function smoothRoute(world: World, cells: ArrayLike<number>): THREE.Vector3[] {
  let pts: THREE.Vector3[] = []
  for (let k = 0; k < cells.length; k++) pts.push(unitOf(world, cells[k], new THREE.Vector3()))
  for (let round = 0; round < 2 && pts.length > 2; round++) {
    const next: THREE.Vector3[] = [pts[0]]
    for (let k = 0; k + 1 < pts.length; k++) {
      next.push(pts[k].clone().lerp(pts[k + 1], 0.25).normalize(), pts[k].clone().lerp(pts[k + 1], 0.75).normalize())
    }
    next.push(pts[pts.length - 1])
    pts = next
  }
  // long straight stretches (a fallback route of two cells) follow the great circle
  const out: THREE.Vector3[] = [pts[0]]
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k]
    const steps = Math.max(1, Math.ceil(a.angleTo(b) / 0.01))
    for (let s = 1; s <= steps; s++) out.push(a.clone().lerp(b, s / steps).normalize())
  }
  return out
}

// ---------------------------------------------------------------------------
// camps: generated low-poly geometry

class CampWriter {
  pos: number[] = []
  nrm: number[] = []
  col: number[] = []
  anchor: number[] = []
  life: number[] = []
  known: number[] = []
  /** Current frame: origin, east, north, up (object space), the anchor and life of the camp being written. */
  o = new THREE.Vector3()
  e = new THREE.Vector3()
  n = new THREE.Vector3()
  u = new THREE.Vector3()
  lifeA = 0
  lifeB = NEVER
  knownIndex = 0
  private tmp = new THREE.Vector3()
  private tn = new THREE.Vector3()

  /** Local (east, north, up) in KayKit units to object space. */
  private at(x: number, y: number, z: number, out: THREE.Vector3) {
    return out.copy(this.o).addScaledVector(this.e, x * KK).addScaledVector(this.n, y * KK).addScaledVector(this.u, z * KK)
  }
  private dir(x: number, y: number, z: number, out: THREE.Vector3) {
    return out.set(0, 0, 0).addScaledVector(this.e, x).addScaledVector(this.n, y).addScaledVector(this.u, z).normalize()
  }
  /** One triangle (local coordinates), flat-shaded, colour linear rgb. */
  tri(a: number[], b: number[], c: number[], rgb: readonly number[]) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    this.dir(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0], this.tn)
    for (const p of [a, b, c]) {
      this.at(p[0], p[1], p[2], this.tmp)
      this.pos.push(this.tmp.x, this.tmp.y, this.tmp.z)
      this.nrm.push(this.tn.x, this.tn.y, this.tn.z)
      this.col.push(rgb[0], rgb[1], rgb[2])
      this.anchor.push(this.o.x, this.o.y, this.o.z)
      this.life.push(this.lifeA, this.lifeB)
      this.known.push(this.knownIndex)
    }
  }
  quad(a: number[], b: number[], c: number[], d: number[], rgb: readonly number[]) {
    this.tri(a, b, c, rgb)
    this.tri(a, c, d, rgb)
  }
  /** Box centred at (x, y) on the ground, size (w, d, h), turned by `rot` radians about the vertical. */
  box(x: number, y: number, z0: number, w: number, d: number, h: number, rot: number, rgb: readonly number[], top: readonly number[] = rgb) {
    const c = Math.cos(rot), s = Math.sin(rot)
    const p = (dx: number, dy: number, z: number) => [x + dx * c - dy * s, y + dx * s + dy * c, z]
    const hw = w / 2, hd = d / 2
    const b0 = p(-hw, -hd, z0), b1 = p(hw, -hd, z0), b2 = p(hw, hd, z0), b3 = p(-hw, hd, z0)
    const t0 = p(-hw, -hd, z0 + h), t1 = p(hw, -hd, z0 + h), t2 = p(hw, hd, z0 + h), t3 = p(-hw, hd, z0 + h)
    this.quad(b0, b1, t1, t0, rgb)
    this.quad(b1, b2, t2, t1, rgb)
    this.quad(b2, b3, t3, t2, rgb)
    this.quad(b3, b0, t0, t3, rgb)
    this.quad(t0, t1, t2, t3, top)
  }
  /** Ridge tent (triangular prism) along its local x, centred at (x, y). */
  tent(x: number, y: number, len: number, wid: number, h: number, rot: number, rgb: readonly number[], end: readonly number[]) {
    const c = Math.cos(rot), s = Math.sin(rot)
    const p = (dx: number, dy: number, z: number) => [x + dx * c - dy * s, y + dx * s + dy * c, z]
    const hl = len / 2, hw = wid / 2
    const a0 = p(-hl, -hw, 0), a1 = p(hl, -hw, 0), b0 = p(-hl, hw, 0), b1 = p(hl, hw, 0), r0 = p(-hl, 0, h), r1 = p(hl, 0, h)
    this.quad(a0, a1, r1, r0, rgb)
    this.quad(b1, b0, r0, r1, rgb)
    this.tri(b0, a0, r0, end)
    this.tri(a1, b1, r1, end)
  }
  /** Gabled roof over a box footprint. */
  roof(x: number, y: number, z0: number, w: number, d: number, h: number, rot: number, rgb: readonly number[]) {
    const c = Math.cos(rot), s = Math.sin(rot)
    const p = (dx: number, dy: number, z: number) => [x + dx * c - dy * s, y + dx * s + dy * c, z]
    const hw = w / 2 + 0.06, hd = d / 2 + 0.06
    const a0 = p(-hw, -hd, z0), a1 = p(hw, -hd, z0), b0 = p(-hw, hd, z0), b1 = p(hw, hd, z0), r0 = p(-hw, 0, z0 + h), r1 = p(hw, 0, z0 + h)
    this.quad(a0, a1, r1, r0, rgb)
    this.quad(b1, b0, r0, r1, rgb)
    this.tri(b0, a0, r0, rgb)
    this.tri(a1, b1, r1, rgb)
  }
  /** Flagpole with a pennant in `flag`, at (x, y). */
  flagpole(x: number, y: number, h: number, rot: number, flag: readonly number[]) {
    this.box(x, y, 0, 0.07, 0.07, h, rot, POLE)
    const c = Math.cos(rot), s = Math.sin(rot)
    const p = (dx: number, z: number) => [x + dx * c, y + dx * s, z]
    const top = p(0.04, h - 0.04), low = p(0.04, h - 0.42), tip = p(0.78, h - 0.25)
    this.tri(top, low, tip, flag)
    this.tri(low, top, tip, flag)
  }
}

const srgb = (r: number, g: number, b: number) => [r, g, b].map((v) => Math.pow(v / 255, 2.2))
const POLE = srgb(214, 206, 188)
const WOOD = srgb(112, 82, 58)
const WOOD_DARK = srgb(78, 58, 42)
const CANVAS = srgb(214, 198, 160)
const CANVAS_END = srgb(186, 168, 128)
const HIDE = srgb(150, 118, 84)
const SNOW_ROOF = srgb(236, 240, 246)
const STONE = srgb(132, 126, 118)
const CRATE = srgb(150, 112, 70)
const RUNNER = srgb(60, 48, 38)

/** A small deterministic random sequence for the camp of settlement `id`. */
function rng(id: number) {
  let s = (id * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

function writeCamp(w: CampWriter, biome: number, id: number, flag: readonly number[]) {
  const r = rng(id + 17)
  const rot = r() * Math.PI * 2
  const ring = (k: number, n: number, rad: number) => {
    const a = rot + (k / n) * Math.PI * 2 + (r() - 0.5) * 0.6
    return [Math.cos(a) * rad, Math.sin(a) * rad, a]
  }
  if (biome === Biome.Ice) {
    // a hut with a snowed roof, two sledges, a few crates
    w.box(0, 0, 0, 1.1, 0.8, 0.62, rot, WOOD, WOOD)
    w.roof(0, 0, 0.62, 1.1, 0.8, 0.38, rot, SNOW_ROOF)
    for (let k = 0; k < 2; k++) {
      const [x, y, a] = ring(k, 2, 1.25 + r() * 0.3)
      w.box(x, y, 0.05, 0.95, 0.32, 0.1, a + 1.3, WOOD)
      w.box(x + Math.cos(a + 1.3 + Math.PI / 2) * 0.13, y + Math.sin(a + 1.3 + Math.PI / 2) * 0.13, 0, 1.05, 0.04, 0.05, a + 1.3, RUNNER)
      w.box(x - Math.cos(a + 1.3 + Math.PI / 2) * 0.13, y - Math.sin(a + 1.3 + Math.PI / 2) * 0.13, 0, 1.05, 0.04, 0.05, a + 1.3, RUNNER)
    }
    const [cx, cy] = ring(0.5, 2, 0.9)
    w.box(cx, cy, 0, 0.26, 0.26, 0.24, rot, CRATE)
    w.box(cx + 0.3, cy + 0.05, 0, 0.22, 0.22, 0.2, rot + 0.4, CRATE)
    const [fx, fy] = ring(0.25, 1, 0.85)
    w.flagpole(fx, fy, 2.2, rot, flag)
  } else if (biome === Biome.Desert) {
    // tents round a cleared patch, crates and a water store
    const n = 2 + Math.floor(r() * 2)
    for (let k = 0; k < n; k++) {
      const [x, y, a] = ring(k, n, 0.95)
      w.tent(x, y, 1.0, 0.8, 0.62, a + Math.PI / 2, CANVAS, CANVAS_END)
    }
    w.box(0.15, -0.1, 0, 0.28, 0.28, 0.26, rot, CRATE)
    w.box(-0.18, 0.12, 0, 0.24, 0.24, 0.22, rot + 0.5, CRATE)
    w.flagpole(0, 0.45, 2.1, rot, flag)
  } else {
    // tundra, mountains and other wild ground: tents of hide or canvas, a stone cairn, a hut on the tundra
    const hut = biome === Biome.Tundra || biome === Biome.Taiga
    if (hut) {
      w.box(0, 0, 0, 0.95, 0.75, 0.55, rot, WOOD_DARK, WOOD_DARK)
      w.roof(0, 0, 0.55, 0.95, 0.75, 0.34, rot, WOOD)
    }
    const n = hut ? 1 + Math.floor(r() * 2) : 2 + Math.floor(r() * 2)
    for (let k = 0; k < n; k++) {
      const [x, y, a] = ring(k + 0.5, n + (hut ? 1 : 0), hut ? 1.2 : 0.85)
      w.tent(x, y, 0.95, 0.75, 0.58, a + Math.PI / 2, biome === Biome.Mountain ? CANVAS : HIDE, biome === Biome.Mountain ? CANVAS_END : WOOD)
    }
    const [cx, cy] = ring(0.2, 1, 1.5)
    w.box(cx, cy, 0, 0.36, 0.36, 0.18, rot, STONE)
    w.box(cx, cy, 0.18, 0.26, 0.26, 0.16, rot + 0.5, STONE)
    w.box(cx, cy, 0.34, 0.15, 0.15, 0.14, rot + 0.2, STONE)
    const [fx, fy] = ring(0.75, 1, hut ? 0.9 : 0.25)
    w.flagpole(fx, fy, 2.2, rot, flag)
  }
}

// ---------------------------------------------------------------------------

export function buildOutpostLayer(world: World, h: History, data: ExpeditionData, peopleRgb: (settlement: number) => readonly [number, number, number] | null): OutpostLayer {
  const P = world.grid.positions
  const B = data.outposts.length
  const L = data.lostCell.length
  const n = B + L
  const object = new THREE.Group()
  const tmp = new THREE.Vector3()
  const cellOf = new Int32Array(n)
  const ids = new Int32Array(B)

  // ---------- glyphs: flags (instances 0..B-1) and lost marks (B..n-1) ----------
  const quad = new THREE.InstancedBufferGeometry()
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  quad.setIndex([0, 1, 2, 0, 2, 3])
  const gPos = new Float32Array(Math.max(1, n) * 3)
  const gLife = new Float32Array(Math.max(1, n) * 2)
  const gInfo = new Float32Array(Math.max(1, n) * 4) // kind (0 flag, 1 lost), settlement id, unused, unused
  const gCol = new Float32Array(Math.max(1, n) * 3)
  const gKnown = new Float32Array(Math.max(1, n))
  const fallback = [0.93, 0.36, 0.28] as const
  for (let k = 0; k < n; k++) {
    const isBase = k < B
    const c = isBase ? h.settlements[data.outposts[k]].cell : data.lostCell[k - B]
    cellOf[k] = c
    const r = surfaceRadius(world, c) + LIFT
    gPos[k * 3] = P[c * 3] * r
    gPos[k * 3 + 1] = P[c * 3 + 1] * r
    gPos[k * 3 + 2] = P[c * 3 + 2] * r
    if (isBase) {
      const s = h.settlements[data.outposts[k]]
      ids[k] = s.id
      gLife[k * 2] = s.foundedYear
      gLife[k * 2 + 1] = s.abandonedYear >= 0 ? s.abandonedYear : NEVER
      gInfo[k * 4] = 0
      gInfo[k * 4 + 1] = s.id
      const rgb = peopleRgb(s.id) ?? fallback
      gCol.set(rgb, k * 3)
    } else {
      gLife[k * 2] = data.lostYear[k - B]
      gLife[k * 2 + 1] = NEVER
      gInfo[k * 4] = 1
      gInfo[k * 4 + 1] = -1
      gCol.set([0.82, 0.86, 0.92], k * 3)
    }
  }
  const knownAttr = new THREE.InstancedBufferAttribute(gKnown, 1)
  quad.setAttribute('aPos', new THREE.InstancedBufferAttribute(gPos, 3))
  quad.setAttribute('aLife', new THREE.InstancedBufferAttribute(gLife, 2))
  quad.setAttribute('aInfo', new THREE.InstancedBufferAttribute(gInfo, 4))
  quad.setAttribute('aCol', new THREE.InstancedBufferAttribute(gCol, 3))
  quad.setAttribute('aKnown', knownAttr)
  quad.instanceCount = n

  const glyphUniforms = {
    uReliefK: reliefUniforms.uReliefK,
    uYear: { value: 0 },
    uPulseYears: { value: 20 },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uSelected: { value: -1 },
    uHovered: { value: -1 },
    uZoom: { value: 0 },
    uSizeScale: { value: 1 },
    uMaskOn: { value: 0 },
    uFlags: { value: 1 },
    uLost: { value: 1 },
    uYield: { value: new THREE.Vector2(0, 0) },
    // up close the glyphs and lines come down from their lift onto the ground (to the camps)
    uDrop: { value: 0 },
  }
  const glyphMaterial = new THREE.ShaderMaterial({
    uniforms: glyphUniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec3 aPos;
      attribute vec2 aLife;
      attribute vec4 aInfo;
      attribute vec3 aCol;
      attribute float aKnown;
      uniform float uYear;
      uniform float uPulseYears;
      uniform vec2 uViewport;
      uniform float uPixelRatio;
      uniform vec3 uCamObj;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      uniform float uSelected;
      uniform float uHovered;
      uniform float uZoom;
      uniform float uSizeScale;
      uniform float uMaskOn;
      uniform float uFlags;
      uniform float uLost;
      uniform vec2 uYield;
      uniform float uDrop;
      varying vec2 vPx;
      varying float vExt;
      varying float vKind;
      varying vec3 vCol;
      varying float vAlpha;
      varying float vSel;
      varying float vHov;
      varying float vPulse;
      varying float vNight;
      varying float vYield;
      void main() {
        vec3 aPosR = ws_relief(aPos); // the ground at the zoom's relief (terrainHeight.ts)
        bool lost = aInfo.x > 0.5;
        vSel = abs(aInfo.y - uSelected) < 0.5 ? 1.0 : 0.0;
        vHov = abs(aInfo.y - uHovered) < 0.5 ? 1.0 : 0.0;
        float special = max(vSel, vHov);
        bool alive = uYear >= aLife.x && uYear < aLife.y;
        if (uMaskOn > 0.5 && uYear < aKnown) alive = false;
        if ((lost ? uLost : uFlags) < 0.5) alive = false;
        vec3 up = normalize(aPosR);
        vec3 at = aPosR - up * uDrop;
        float facing = dot(up, normalize(uCamObj - at));
        float zoom = max(uZoom, special);
        if (!alive || facing <= 0.0 || zoom <= 0.01) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        float age = uYear - aLife.x;
        vPulse = age < uPulseYears * 1.5 ? age / (uPulseYears * 1.5) : -1.0;
        vYield = uYield.y > 0.0 ? 1.0 - smoothstep(uYield.x, uYield.y, length(uCamObj - at)) : 0.0;
        float ext = (lost ? 4.2 : 8.5) * uSizeScale * mix(0.6, 1.0, sqrt(facing)) * mix(1.0, 0.7, vYield);
        float lift = lost ? 0.0 : ext * 0.72; // a flag's quad sits above its foot
        float pad = vSel > 0.5 || vHov > 0.5 || vPulse >= 0.0 ? 10.0 : 2.0;
        float quadR = ext + pad;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(at, 1.0);
        vec4 above = projectionMatrix * modelViewMatrix * vec4(at + up * 0.01, 1.0);
        vec2 d = (above.xy / above.w - clip.xy / clip.w) * uViewport;
        vec2 upS = length(d) > 1e-4 ? normalize(d) : vec2(0.0, 1.0);
        vec2 side = vec2(upS.y, -upS.x);
        vec2 offPx = side * position.x * quadR + upS * (position.y * quadR + lift);
        clip.xy += offPx * uPixelRatio * 2.0 / uViewport * clip.w;
        gl_Position = clip;
        vPx = vec2(position.x * quadR, position.y * quadR + lift); // relative to the foot, y up
        vExt = ext;
        vKind = lost ? 1.0 : 0.0;
        vCol = aCol;
        float fade = lost ? mix(0.95, 0.5, smoothstep(0.0, ${LOST_FADE_YEARS.toFixed(1)}, age)) : 1.0;
        vAlpha = smoothstep(0.0, 0.3, facing) * zoom * fade;
        vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vPx;
      varying float vExt;
      varying float vKind;
      varying vec3 vCol;
      varying float vAlpha;
      varying float vSel;
      varying float vHov;
      varying float vPulse;
      varying float vNight;
      varying float vYield;
      float sdSeg(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h);
      }
      float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
        vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
        vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
        vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
        vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
        vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
        float s = sign(e0.x * e2.y - e0.y * e2.x);
        vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
        return -sqrt(d.x) * sign(d.y);
      }
      void main() {
        vec2 p = vPx;
        float E = vExt;
        vec3 c = vec3(0.0);
        float a = 0.0;
        vec3 rim = vec3(0.07, 0.05, 0.04);
        if (vKind > 0.5) {
          // lost: a small pale cross with a dark halo
          float r = E * 0.62;
          float dd = min(sdSeg(p, vec2(-r, -r), vec2(r, r)), sdSeg(p, vec2(-r, r), vec2(r, -r)));
          float halo = (1.0 - smoothstep(1.6, 2.6, dd)) * 0.7;
          float body = 1.0 - smoothstep(0.55, 1.25, dd);
          c = rim * halo;
          a = halo;
          c = vCol * body + c * (1.0 - body);
          a = body + a * (1.0 - body);
        } else {
          // a pennant on a pole standing on the ground (the foot at the origin)
          float H = E * 1.55;
          float pole = sdSeg(p, vec2(0.0, 0.0), vec2(0.0, H));
          float flag = sdTri(p, vec2(0.0, H), vec2(0.0, H - E * 0.78), vec2(E * 1.2, H - E * 0.38));
          float foot = length(p) - E * 0.17;
          float halo = (1.0 - smoothstep(1.2, 2.2, min(min(pole - 0.3, flag), foot))) * 0.7;
          float poleA = 1.0 - smoothstep(0.45, 1.15, pole);
          float flagIn = 1.0 - smoothstep(-0.55, 0.05, flag);
          float flagA = 1.0 - smoothstep(0.35, 1.15, flag);
          float footA = 1.0 - smoothstep(-0.2, 0.7, foot);
          c = rim * halo;
          a = halo;
          vec3 poleC = vec3(0.93, 0.9, 0.82);
          c = poleC * poleA + c * (1.0 - poleA);
          a = poleA + a * (1.0 - poleA);
          c = rim * footA + c * (1.0 - footA);
          a = footA + a * (1.0 - footA);
          vec3 flagC = mix(rim, vCol * 1.08, flagIn);
          c = flagC * flagA + c * (1.0 - flagA);
          a = flagA + a * (1.0 - flagA);
          a *= 1.0 - 0.8 * vYield;
          c *= 1.0 - 0.8 * vYield;
          // selection and hover: a ring round the foot
          float d = length(p - vec2(0.0, E * 0.15));
          float ringA = max(vSel, vHov * 0.5) * (1.0 - smoothstep(0.55, 1.45, abs(d - E * 0.85)));
          c = vec3(1.0) * ringA + c * (1.0 - ringA);
          a = ringA + a * (1.0 - ringA);
          if (vPulse >= 0.0) {
            float pr = E * 0.4 + 18.0 * vPulse;
            float pa = (1.0 - smoothstep(0.5, 1.8, abs(length(p) - pr))) * pow(1.0 - vPulse, 1.5) * 0.85;
            c = vec3(1.0, 0.9, 0.62) * pa + c * (1.0 - pa);
            a = pa + a * (1.0 - pa);
          }
        }
        float k = vAlpha * mix(1.0, max(0.4, max(vSel, vHov)), vNight);
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
  const glyphs = new THREE.Mesh(quad, glyphMaterial)
  glyphs.frustumCulled = false
  glyphs.renderOrder = 8.3 // over the settlement markers, under structure icons and travelling groups
  glyphs.visible = n > 0
  object.add(glyphs)

  // ---------- supply lines: a thin dashed ribbon with a dark rim (so it reads on the ice) ----------
  const lPos: number[] = [], lSide: number[] = [], lArc: number[] = [], lInfo: number[] = [], lKnownIdx: number[] = [], lIndex: number[] = []
  const side = new THREE.Vector3(), tan = new THREE.Vector3()
  for (let k = 0; k < B; k++) {
    const s = h.settlements[data.outposts[k]]
    const a = data.routeOffsets[k], b = data.routeOffsets[k + 1]
    if (b - a < 2) continue
    const pts = smoothRoute(world, data.routeCells.subarray(a, b))
    // heights follow the route's cells (interpolated by index)
    const cells = data.routeCells.subarray(a, b)
    let arc = 0
    const v0 = lPos.length / 3
    for (let q = 0; q < pts.length; q++) {
      if (q > 0) arc += pts[q].distanceTo(pts[q - 1])
      const ci = cells[Math.min(cells.length - 1, Math.round((q / (pts.length - 1)) * (cells.length - 1)))]
      const r = surfaceRadius(world, ci) + LINE_LIFT
      tan.copy(pts[Math.min(pts.length - 1, q + 1)]).sub(pts[Math.max(0, q - 1)])
      side.crossVectors(pts[q], tan).normalize()
      for (const across of [-1, 1]) {
        lPos.push(pts[q].x * r, pts[q].y * r, pts[q].z * r)
        lSide.push(side.x, side.y, side.z, across)
        lArc.push(arc)
        lInfo.push(s.id, s.parent, s.foundedYear, s.abandonedYear >= 0 ? s.abandonedYear : NEVER)
        lKnownIdx.push(ci)
      }
      if (q > 0) {
        const v = v0 + q * 2
        lIndex.push(v - 2, v, v - 1, v - 1, v, v + 1)
      }
    }
  }
  const lineGeom = new THREE.BufferGeometry()
  lineGeom.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(lPos), 3))
  lineGeom.setAttribute('aSide', new THREE.BufferAttribute(Float32Array.from(lSide), 4))
  lineGeom.setAttribute('aArc', new THREE.BufferAttribute(Float32Array.from(lArc), 1))
  lineGeom.setAttribute('aInfo', new THREE.BufferAttribute(Float32Array.from(lInfo), 4))
  lineGeom.setIndex(lIndex)
  const lineKnown = new Float32Array(lKnownIdx.length)
  const lineKnownAttr = new THREE.BufferAttribute(lineKnown, 1)
  lineGeom.setAttribute('aKnown', lineKnownAttr)
  const lineUniforms = {
    uReliefK: reliefUniforms.uReliefK,
    uYear: glyphUniforms.uYear,
    uCamObj: glyphUniforms.uCamObj,
    uSelected: glyphUniforms.uSelected,
    uHovered: glyphUniforms.uHovered,
    uMaskOn: glyphUniforms.uMaskOn,
    uFaint: { value: 0 },
    uDash: { value: 0.004 },
    uPixel: { value: 0.001 },
    uPixelRatio: glyphUniforms.uPixelRatio,
    uDrop: { value: 0 },
    uSunObj: glyphUniforms.uSunObj,
    uDaylight: sunUniforms.uDaylight,
  }
  const lineMaterial = new THREE.ShaderMaterial({
    uniforms: lineUniforms,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec4 aSide; // side direction, across (-1|1)
      attribute float aArc;
      attribute vec4 aInfo; // base id, parent id, founded, abandoned
      attribute float aKnown;
      uniform float uYear;
      uniform vec3 uCamObj;
      uniform float uSelected;
      uniform float uHovered;
      uniform float uMaskOn;
      uniform float uFaint;
      uniform float uPixel;
      uniform float uPixelRatio;
      uniform float uDrop;
      uniform vec3 uSunObj;
      uniform float uDaylight;
      varying float vArc;
      varying float vA;
      varying float vAcross;
      varying float vSel;
      void main() {
        vec3 positionR = ws_relief(position); // the ground at the zoom's relief (terrainHeight.ts)
        bool alive = uYear >= aInfo.z && uYear < aInfo.w;
        if (uMaskOn > 0.5 && uYear < aKnown) alive = false;
        float sel = abs(aInfo.x - uSelected) < 0.5 || abs(aInfo.y - uSelected) < 0.5 ? 1.0 : 0.0;
        float hov = abs(aInfo.x - uHovered) < 0.5 || abs(aInfo.y - uHovered) < 0.5 ? 0.7 : 0.0;
        vec3 up = normalize(positionR);
        float facing = dot(up, normalize(uCamObj - positionR));
        float night = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
        vSel = max(sel, hov);
        vA = max(vSel * 0.95, uFaint) * smoothstep(0.0, 0.25, facing) * mix(1.0, 0.6, night);
        if (!alive || vA <= 0.003) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec3 base = positionR - up * uDrop;
        vec4 mv = modelViewMatrix * vec4(base, 1.0);
        float pix = -mv.z * uPixel * uPixelRatio;
        float halfW = vSel > 0.5 ? 2.1 : 1.5; // CSS px: a light core of about 1-1.5 px and a dark rim
        vAcross = aSide.w;
        vArc = aArc;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(base + aSide.xyz * aSide.w * halfW * pix, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uDash;
      varying float vArc;
      varying float vA;
      varying float vAcross;
      varying float vSel;
      void main() {
        float dash = step(0.42, fract(vArc / uDash));
        float x = abs(vAcross);
        float core = 1.0 - smoothstep(0.38, 0.55, x);
        float body = 1.0 - smoothstep(0.82, 1.0, x);
        vec3 c = mix(vec3(0.07, 0.05, 0.03), vec3(1.0, 0.9, 0.64), core);
        float a = vA * dash * body * mix(0.55, 1.0, core);
        if (a < 0.004) discard;
        gl_FragColor = vec4(c * a, a);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  })
  const lines = new THREE.Mesh(lineGeom, lineMaterial)
  lines.frustumCulled = false
  lines.renderOrder = 7.2 // with the journey trails
  lines.visible = lPos.length > 0
  object.add(lines)

  // ---------- camps ----------
  const cw = new CampWriter()
  const up = new THREE.Vector3()
  for (let k = 0; k < B; k++) {
    const s = h.settlements[data.outposts[k]]
    const c = s.cell
    up.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]).normalize()
    cw.u.copy(up)
    const ref = Math.abs(up.y) > 0.95 ? tmp.set(0, 0, 1) : tmp.set(0, 1, 0)
    cw.e.crossVectors(ref, up).normalize()
    cw.n.crossVectors(up, cw.e).normalize()
    cw.o.copy(up).multiplyScalar(surfaceRadius(world, c) + 0.00003)
    cw.lifeA = s.foundedYear
    cw.lifeB = s.abandonedYear >= 0 ? s.abandonedYear : NEVER
    cw.knownIndex = c
    const rgb = peopleRgb(s.id) ?? fallback
    writeCamp(cw, world.biome[c], s.id, rgb.map((v) => Math.pow(v, 2.2)))
  }
  const campGeom = new THREE.BufferGeometry()
  campGeom.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(cw.pos), 3))
  campGeom.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(cw.nrm), 3))
  campGeom.setAttribute('aColor', new THREE.BufferAttribute(Float32Array.from(cw.col), 3))
  campGeom.setAttribute('aAnchor', new THREE.BufferAttribute(Float32Array.from(cw.anchor), 3))
  campGeom.setAttribute('aLife', new THREE.BufferAttribute(Float32Array.from(cw.life), 2))
  const campKnownCell = Int32Array.from(cw.known)
  const campKnown = new Float32Array(campKnownCell.length)
  const campKnownAttr = new THREE.BufferAttribute(campKnown, 1)
  campGeom.setAttribute('aKnown', campKnownAttr)
  const campUniforms = {
    uReliefK: reliefUniforms.uReliefK,
    uYear: glyphUniforms.uYear,
    uCamObj: glyphUniforms.uCamObj,
    uSunObj: glyphUniforms.uSunObj,
    uDaylight: sunUniforms.uDaylight,
    uMaskOn: glyphUniforms.uMaskOn,
    uFade: { value: new THREE.Vector2(DIORAMA_NEAR, DIORAMA_FAR) },
  }
  const campMaterial = new THREE.ShaderMaterial({
    uniforms: campUniforms,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${RELIEF_GLSL}
      attribute vec3 aColor;
      attribute vec3 aAnchor;
      attribute vec2 aLife;
      attribute float aKnown;
      uniform float uYear;
      uniform vec3 uCamObj;
      uniform float uMaskOn;
      uniform vec2 uFade;
      varying vec3 vC;
      varying vec3 vN;
      varying vec3 vUp;
      void main() {
        bool alive = uYear >= aLife.x && uYear < aLife.y;
        if (uMaskOn > 0.5 && uYear < aKnown) alive = false;
        float dist = length(uCamObj - aAnchor);
        float near = 1.0 - smoothstep(uFade.x * 0.66, uFade.y, dist);
        float s = alive ? near * near * (3.0 - 2.0 * near) : 0.0;
        if (s <= 0.002) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        vec3 p = ws_relief(aAnchor) + (position - aAnchor) * s;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        vC = aColor;
        vN = normal;
        vUp = normalize(aAnchor);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunObj;
      uniform float uDaylight;
      varying vec3 vC;
      varying vec3 vN;
      varying vec3 vUp;
      void main() {
        vec3 L = normalize(uSunObj);
        if (uDaylight > 0.5) {
          vec3 t = L - vUp * dot(L, vUp);
          float tl = length(t);
          L = normalize(vUp + (tl > 1e-4 ? t / tl : vec3(0.0)) * 0.6);
        }
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float day = smoothstep(-0.12, 0.2, dot(vUp, L));
        float diff = max(dot(n, L), 0.0) * day;
        float sky = 0.5 + 0.5 * dot(n, vUp);
        vec3 col = vC * (diff * vec3(1.0, 0.95, 0.86) * 1.6 + vec3(0.30, 0.38, 0.52) * (0.18 + 0.32 * day) * sky);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const camps = new THREE.Mesh(campGeom, campMaterial)
  camps.frustumCulled = false
  camps.renderOrder = 0.6
  camps.visible = false
  object.add(camps)
  let campsOn = true

  // ---------- state ----------
  let year = 0
  let flagsOn = true
  let tracesOn = true
  let maskYears: Float32Array | null = null
  const tmpQ = new THREE.Quaternion()
  const camLocal = new THREE.Vector3()
  const mvp = new THREE.Matrix4()
  let zoom = 0
  let sizeScale = 1
  let dropNow = 0
  const indexOf = new Map<number, number>()
  for (let k = 0; k < B; k++) indexOf.set(ids[k], k)

  return {
    object,
    get count() {
      return B
    },
    setTime(y: number, pulseYears: number) {
      year = y
      glyphUniforms.uYear.value = y
      glyphUniforms.uPulseYears.value = pulseYears
    },
    setSelected(id: number) {
      glyphUniforms.uSelected.value = id
    },
    setHovered(id: number) {
      glyphUniforms.uHovered.value = id
    },
    update(camera: THREE.PerspectiveCamera, drawSize: THREE.Vector2, pixelRatio: number) {
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(tmpQ).invert()
      glyphUniforms.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(glyphUniforms.uCamObj.value)
      object.worldToLocal(glyphUniforms.uCamObj.value)
      glyphUniforms.uViewport.value.copy(drawSize)
      glyphUniforms.uPixelRatio.value = pixelRatio
      const dist = camera.position.length()
      sizeScale = Math.min(1.4, Math.max(0.85, Math.sqrt(3.25 / dist)))
      glyphUniforms.uSizeScale.value = sizeScale
      const t = Math.min(1, Math.max(0, (FLAG_FAR - dist) / (FLAG_FAR - FLAG_NEAR)))
      zoom = t * t * (3 - 2 * t)
      glyphUniforms.uZoom.value = zoom
      lineUniforms.uFaint.value = tracesOn ? 0.3 * zoom : 0
      // dashes a few pixels long at any zoom
      lineUniforms.uDash.value = Math.max(0.0004, (dist - 1) * 0.012)
      lineUniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, drawSize.y)
      const down = 1 - Math.min(1, Math.max(0.06, (dist - 1) / 0.6))
      glyphUniforms.uDrop.value = dropNow = (LIFT - 0.0002) * down
      lineUniforms.uDrop.value = (LINE_LIFT - 0.0002) * down
      lines.visible = tracesOn && lPos.length > 0
      camps.visible = campsOn && B > 0 && dist - 1 < DIORAMA_FAR + 0.05
    },
    pick(camera: THREE.PerspectiveCamera, x: number, y: number, width: number, height: number, slopPx: number) {
      if (!glyphs.visible || !flagsOn) return -1
      object.updateWorldMatrix(true, false)
      mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(object.matrixWorld)
      camera.getWorldPosition(camLocal)
      object.worldToLocal(camLocal)
      let best = -1, bestScore = Infinity
      for (let k = 0; k < B; k++) {
        if (year < gLife[k * 2] || year >= gLife[k * 2 + 1]) continue
        if (maskYears && year < gKnown[k]) continue
        const id = ids[k]
        const special = id === glyphUniforms.uSelected.value || id === glyphUniforms.uHovered.value
        if (zoom < 0.2 && !special) continue
        const cx = gPos[k * 3], cy = gPos[k * 3 + 1], cz = gPos[k * 3 + 2]
        if ((camLocal.x - cx) * cx + (camLocal.y - cy) * cy + (camLocal.z - cz) * cz <= 0) continue
        const cr = Math.hypot(cx, cy, cz), crr = reliefRadius(cr) // as drawn (ws_relief)
        tmp.set(cx, cy, cz).multiplyScalar((crr - dropNow) / cr).applyMatrix4(mvp)
        const sx = ((tmp.x + 1) / 2) * width, sy = ((1 - tmp.y) / 2) * height
        // the flag stands above its foot: aim at its middle
        const ext = 8.5 * sizeScale
        const d = Math.hypot(sx - x, sy - ext * 0.9 - y)
        const score = d - ext
        if (score <= slopPx && score < bestScore) {
          bestScore = score
          best = id
        }
      }
      return best
    },
    centerLocal(id: number, out: THREE.Vector3) {
      const k = indexOf.get(id)
      if (k === undefined) return out.set(0, 0, 0)
      return out.set(gPos[k * 3], gPos[k * 3 + 1], gPos[k * 3 + 2])
    },
    setKnownMask(cellYear: Float32Array | null) {
      maskYears = cellYear
      glyphUniforms.uMaskOn.value = cellYear ? 1 : 0
      if (!cellYear) return
      for (let k = 0; k < n; k++) gKnown[k] = cellYear[cellOf[k]] ?? NEVER
      knownAttr.needsUpdate = true
      for (let v = 0; v < lKnownIdx.length; v++) lineKnown[v] = cellYear[lKnownIdx[v]] ?? NEVER
      lineKnownAttr.needsUpdate = true
      for (let v = 0; v < campKnownCell.length; v++) campKnown[v] = cellYear[campKnownCell[v]] ?? NEVER
      campKnownAttr.needsUpdate = true
    },
    setFlagsVisible(on: boolean) {
      flagsOn = on
      glyphUniforms.uFlags.value = on ? 1 : 0
    },
    setTracesVisible(on: boolean) {
      tracesOn = on
      glyphUniforms.uLost.value = on ? 1 : 0
    },
    setCampsVisible(on: boolean) {
      campsOn = on
    },
    setYield(near: number, far: number) {
      glyphUniforms.uYield.value.set(near, far)
    },
    setFlagOrder(order: number) {
      glyphs.renderOrder = order
    },
    dispose() {
      quad.dispose()
      glyphMaterial.dispose()
      lineGeom.dispose()
      lineMaterial.dispose()
      campGeom.dispose()
      campMaterial.dispose()
    },
  }
}
