// Ideas on the map (data from ui/ideasData.ts): each row of History.ideaAdoptions is a people conceiving, taking up or losing an
// idea in a year at one of its settlements (`via`). Everything drawn is a pure function of the year, the playback speed and the
// selected idea: scrubbing back shows what a direct load shows.
//
//  - Marks (one instanced draw of static instances: one per row, then one per settlement):
//    with no idea selected, while playing, a brief pulse at the entry settlement when an idea arrives (a ring spreading out in
//    its channel's colour), a distinct one where an idea is conceived (a gold four-point burst; a paler one for an independent
//    origin), and a grey ring closing in where one is lost. With an idea selected, a ring round every settlement of a people
//    holding it, coloured by when its people took it up (gold the first, through green, to blue the last), a faint hollow ring
//    round those of peoples without it yet, grey where it was lost; a gold sparkle in the lower-left slot (markerSlots.ts) where
//    it was conceived (smaller for an independent origin), a grey cross where a people lost it; arrivals pulse while playing.
//  - Links (one draw of one ribbon geometry, only with an idea selected): from each adoption's source settlement to its entry
//    settlement, along the trade route or long-haul leg between them when the channel is Trade or Lane and one joins them, else
//    a walk along the great circle; coloured by channel, widening toward the entry (the way the idea went), drawn out over a
//    couple of years when it arrives, a faint pulse running toward the entry for a while after.
//  - Activity: the rows' years are sorted, so per frame the layer only counts (two binary searches) the rows whose pulse covers
//    the year; with no selection and no pulse (or paused) neither draw is made.
//  - Known world: marks in cells not yet known are hidden; the links lie under the mist.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { CITY_POPULATION, IdeaHow, TOWN_POPULATION } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms, SEAM_FRAG_GLSL } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'
import { smoothPaths } from './routeCurves.ts'
import { requestRender } from './invalidate.ts'
import { MARKER_SLOT_GLSL } from './markerSlots.ts'
import { adoptionYears, HOW_RGB, type IdeasData } from '../ui/ideasData.ts'

const LIFT = 0.0034
const MARK_LIFT = 0.0047
const NEVER = 1e9
/** Settlement marker radius range (CSS px before zoom scaling), as render/settlements.ts. */
const MIN_RADIUS = 1.7
const MAX_RADIUS = 6.5
const TOWN_MIN_RADIUS = 4.6
const CITY_MIN_RADIUS = 7.0
/** Longest pulse (years) at any speed; how long a link takes to draw out. */
const PULSE_MAX = 12
const GROW_YEARS = 3
/** Camera distances (planet radii) over which the selected idea's per-town rings give way to the holders' halos alone (uFar 0 .. 1). */
const RINGS_NEAR = 1.9
const RINGS_FAR = 2.6
/** Row kinds (aA.w) and the settlements' instances. */
const K_ADOPT = 0, K_FIRST = 1, K_AGAIN = 2, K_LOST = 3, K_SETTLEMENT = 9

/** The time ramp of a selected idea (t 0 first .. 1 last), sRGB 0..1: gold, green, blue. The panel's legend draws the same. */
export const IDEA_RAMP_CSS = 'linear-gradient(to right, rgb(255, 214, 102), rgb(110, 206, 150), rgb(84, 116, 232))'
export function ideaRamp(t: number, out: number[] | Uint8Array, o: number, scale = 1): void {
  const a = [1.0, 0.84, 0.4], b = [0.43, 0.81, 0.59], c = [0.33, 0.45, 0.91]
  const x = Math.max(0, Math.min(1, t))
  const [p, q, f] = x < 0.5 ? [a, b, x * 2] : [b, c, x * 2 - 1]
  for (let k = 0; k < 3; k++) out[o + k] = (p[k] + (q[k] - p[k]) * f) * scale
}

export interface IdeasLayer {
  object: THREE.Group
  /** The Ideas layer toggle. */
  setShown(on: boolean): void
  setKnownMask(cellYear: Float32Array | null): void
  /** Draw order of the marks: over the clouds while a known world is shown. */
  setMasked(on: boolean): void
  /** Show idea i's spread (-1 none). */
  setSelected(i: number): void
  /** Per frame: the year, the pulse length (years a second of playback covers), an effect opacity (lower at high speed), whether playing, and the snapshot shown. */
  setTime(year: number, pulseYears: number, effect: number, playing: boolean, s0: number): void
  update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** Up close the markers yield to the 3D towns: the rings follow (near, far camera distances; far <= 0 off). */
  setYield(near: number, far: number): void
  /** Whether either draw is on this frame. */
  readonly active: boolean
  /** For measurement (perf=1): whether each draw is on, and the links built (all, and of the selected idea). */
  stats(): { marks: boolean; links: boolean; built: number; selected: number; indices: number; samples: number }
  dispose(): void
}

const MARK_VERT = /* glsl */ `
${RELIEF_GLSL}
${MARKER_SLOT_GLSL}
attribute vec3 aPos;
attribute vec4 aA; // rows: year, how, idea, kind (0 adoption, 1 first conception, 2 independent, 3 loss); settlements: founded, abandoned, -1, 9
attribute vec4 aB; // marker radius (px); settlements: year its people took up the selected idea, year it lost it, when 0..1
attribute float aKnown;
uniform float uFar; // 0 from mid zoom down .. 1 at the globe's far view: only the holders' halos
uniform float uYear;
uniform float uPulse;
uniform float uSel;
uniform float uFx;
uniform float uMaskOn;
uniform float uSizeScale;
uniform vec2 uYield;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform vec3 uCamObj;
uniform vec3 uSunObj;
uniform float uDaylight;
uniform vec3 uHowRgb[14];
varying vec2 vPx;
flat varying float vMode;
varying float vR;
varying float vAge;
varying float vAlpha;
varying vec3 vCol;
varying float vNight;
vec3 ramp(float t) {
  vec3 a = vec3(1.0, 0.84, 0.4), b = vec3(0.43, 0.81, 0.59), c = vec3(0.33, 0.45, 0.91);
  return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0);
}
void main() {
  vec3 pos = ws_relief(aPos);
  vec3 up = normalize(pos);
  float facing = ws_facing(dot(up, normalize(uCamObj - pos)));
  float kind = aA.w;
  bool hidden = (uMaskOn > 0.5 && uYear < aKnown) || facing <= 0.0;
  // modes: 0 arrival pulse, 1 conception pulse, 2 loss pulse, 3 origin sparkle, 4 loss cross, 5 holder ring, 6 not yet, 7 lost ring; -1 none
  float mode = -1.0;
  float age = 0.0;
  vec3 col = vec3(1.0);
  if (kind > 8.5) {
    bool alive = uYear >= aA.x && uYear < aA.y;
    if (uSel >= 0.0 && alive) {
      if (uYear >= aB.z) { mode = 7.0; col = vec3(0.55, 0.55, 0.58); }
      else if (uYear >= aB.y) { mode = 5.0; col = ramp(aB.w); }
      else mode = 6.0;
    }
  } else {
    float y = aA.x;
    age = uYear - y;
    bool pulse = uPulse > 0.0 && age >= 0.0 && age < uPulse;
    bool mine = uSel < 0.0 || abs(aA.z - uSel) < 0.5;
    if (mine) {
      if (uSel >= 0.0 && age >= 0.0 && (kind > 0.5 && kind < 2.5)) mode = 3.0;
      else if (uSel >= 0.0 && age >= 0.0 && kind > 2.5) mode = 4.0;
      if (pulse && (mode < 0.0 || kind < 0.5)) mode = kind < 0.5 ? 0.0 : kind < 2.5 ? 1.0 : 2.0;
      if (pulse && kind > 0.5 && kind < 2.5 && uSel >= 0.0) mode = 1.0;
    }
    col = uHowRgb[int(clamp(aA.y, 0.0, 13.0) + 0.5)];
    if (kind > 0.5 && kind < 2.5) col = uHowRgb[0];
  }
  // far out the land colouring of the Ideas view tells who holds it: the not-yet and lost rings go, the holders keep a halo
  if (mode > 5.5 && uFar > 0.99) hidden = true;
  if (hidden || mode < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float yieldK = uYield.y > 0.0 ? 1.0 - smoothstep(uYield.x, uYield.y, length(uCamObj - pos)) : 0.0;
  float r = aB.x * uSizeScale * mix(0.55, 1.0, sqrt(facing)) * mix(1.0, 0.55, yieldK);
  float s = uSizeScale;
  vec2 off = vec2(0.0);
  float ext = r + 22.0 * s;
  if (mode > 2.5 && mode < 4.5) {
    // the sparkle and the cross sit in the lower-left slot, outside the ring band
    float g = (mode < 3.5 ? (kind > 1.5 ? 4.0 : 5.5) : 3.5) * s;
    off = ws_slotAt(WS_SLOT_LOWER_LEFT, r, g, s);
    ext = g + 3.0;
  } else if (mode > 4.5) ext = r + 10.0 * s + 2.0;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(pos), 1.0);
  clip.xy += (position.xy * ext + off) * uPixelRatio * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  vPx = position.xy * ext;
  vMode = mode;
  vR = mode > 2.5 && mode < 4.5 ? (mode < 3.5 ? (kind > 1.5 ? 4.0 : 5.5) : 3.5) * s : r;
  vAge = mode < 2.5 ? clamp(age / max(uPulse, 1e-3), 0.0, 1.0) : 0.0;
  vCol = col;
  vAlpha = smoothstep(0.0, 0.25, facing) * (mode < 2.5 ? uFx : 1.0) * (kind < 2.5 && kind > 1.5 ? 0.8 : 1.0) * (mode > 5.5 ? 1.0 - uFar : 1.0);
  vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
}
`

const MARK_FRAG = /* glsl */ `
uniform float uSizeScale;
uniform float uFar;
varying vec2 vPx;
flat varying float vMode;
varying float vR;
varying float vAge;
varying float vAlpha;
varying vec3 vCol;
varying float vNight;
vec4 glyph(float d, vec3 fillC, vec3 lineC, float outline) {
  float fill = 1.0 - smoothstep(-0.6, 0.6, d);
  float edge = 1.0 - smoothstep(-0.6, 0.6, d - outline);
  return vec4(mix(lineC, fillC, fill) * edge, edge);
}
vec4 over(vec4 a, vec4 b) { return vec4(a.rgb + b.rgb * (1.0 - a.a), a.a + b.a * (1.0 - a.a)); }
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
/** A four-point star of radius R (a sparkle). */
float sdSparkle(vec2 p, float R) {
  p = abs(p);
  float a = sdSeg(p, vec2(0.0), vec2(R, 0.0)) - mix(R * 0.28, 0.0, clamp(p.x / R, 0.0, 1.0));
  float b = sdSeg(p, vec2(0.0), vec2(0.0, R)) - mix(R * 0.28, 0.0, clamp(p.y / R, 0.0, 1.0));
  return min(min(a, b), length(p) - R * 0.32);
}
void main() {
  vec2 p = vPx;
  float d = length(p);
  vec3 dark = vec3(0.04, 0.04, 0.07);
  vec4 o = vec4(0.0);
  float R = vR;
  if (vMode < 0.5) {
    // an idea arrives: a ring spreading out from the marker in its channel's colour
    float R2 = R + 2.5 + 14.0 * sqrt(vAge);
    float a = (1.0 - smoothstep(0.6, 1.8, abs(d - R2))) * (1.0 - vAge) * 0.9;
    o = vec4(mix(vCol, vec3(1.0), 0.25) * a, a);
  } else if (vMode < 1.5) {
    // an idea conceived: a gold four-point burst growing and fading, with a ring
    float k = 1.0 - vAge;
    float star = sdSparkle(p, R + 6.0 + 12.0 * sqrt(vAge));
    o = glyph(star, mix(vCol, vec3(1.0), 0.35), dark, 0.8) * k;
    float R2 = R + 4.0 + 18.0 * sqrt(vAge);
    float a = (1.0 - smoothstep(0.7, 2.0, abs(d - R2))) * k * 0.8;
    o = over(o, vec4(vCol * a, a));
  } else if (vMode < 2.5) {
    // lost: a grey ring closing in
    float R2 = R + 2.0 + 14.0 * (1.0 - vAge);
    float a = (1.0 - smoothstep(0.5, 1.4, abs(d - R2))) * (1.0 - vAge) * 0.75;
    o = vec4(vec3(0.62, 0.62, 0.66) * a, a);
  } else if (vMode < 3.5) {
    // where the selected idea was conceived: a gold sparkle
    o = glyph(sdSparkle(p, R), vCol, dark, 1.0);
  } else if (vMode < 4.5) {
    // where a people lost it: a grey cross
    float x = min(sdSeg(p, vec2(-R, -R), vec2(R, R)), sdSeg(p, vec2(-R, R), vec2(R, -R))) - 0.8;
    o = glyph(x, vec3(0.7, 0.7, 0.74), dark, 0.9);
  } else if (vMode < 5.5) {
    // a settlement of a people holding it: a soft halo and a ring in the colour of when (holders' towns read as a patch)
    // (far out the halo alone, a little stronger: the rings would crowd the globe)
    float halo = (1.0 - smoothstep(R + 3.0, R + 9.0 * uSizeScale, d)) * step(R, d) * mix(0.32, 0.42, uFar);
    o = over(glyph(abs(d - R - 2.8) - 1.5, vCol, dark, 0.8) * (1.0 - uFar), vec4(vCol * halo, halo));
  } else if (vMode < 6.5) {
    // not yet: a faint hollow ring
    o = glyph(abs(d - R - 2.4) - 0.4, vec3(0.75, 0.78, 0.84), dark, 0.3) * 0.28;
  } else {
    // lost there: a grey broken ring
    float ang = atan(p.y, p.x);
    float on = step(0.0, sin(ang * 6.0));
    o = glyph(abs(d - R - 2.5) - 0.8, vCol, dark, 0.6) * (0.35 + 0.5 * on);
  }
  o *= vAlpha * mix(1.0, 0.75, vNight);
  if (o.a < 0.004) discard;
  gl_FragColor = o;
}
`

const LINE_VERT = /* glsl */ `
${RELIEF_GLSL}
attribute vec4 aSide; // side direction, across (-1|1)
attribute vec4 aInfo; // year taken up, how, fraction along, arc length back from the entry
attribute float aIdea;
uniform float uYear;
uniform float uGrow;
uniform float uSel;
uniform float uPixel;
uniform float uPixelRatio;
uniform float uClose;
uniform float uDrop;
uniform vec3 uCamObj;
uniform vec3 uHowRgb[14];
varying float vAcross;
varying float vSoft;
varying float vCore;
varying float vArcPx;
varying float vShow;
varying float vFront;
varying float vFresh;
varying float vFacing;
varying vec3 vCol;
void main() {
  vec3 pR = ws_relief(position);
  float y = aInfo.x;
  float frac = aInfo.z;
  float grow = clamp((uYear - y + uGrow) / max(uGrow, 1e-3), 0.0, 1.0);
  bool sel = uSel >= 0.0 && abs(aIdea - uSel) < 0.5;
  if (!sel || grow <= 0.0 || frac > grow + 1e-4) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float age = uYear - y;
  vShow = 0.95;
  vFront = grow < 1.0 ? clamp(1.0 - (grow - frac) * 6.0, 0.0, 1.0) : 0.0;
  vFresh = clamp(1.0 - age / 40.0, 0.0, 1.0);
  // widening toward the entry: the way the idea went
  float core = mix(0.9, 2.1, frac) * mix(0.7, 1.0, uClose);
  vec3 up = normalize(pR);
  vec3 base = pR - up * uDrop;
  vec4 mv = modelViewMatrix * vec4(ws_place(base), 1.0);
  float pix = -mv.z * uPixel * uPixelRatio;
  float outer = core + 1.3;
  vCore = core / outer;
  vSoft = 0.9 / outer;
  vAcross = aSide.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(base + aSide.xyz * aSide.w * outer * pix), 1.0);
  vFacing = ws_facing(dot(up, normalize(uCamObj - pR)));
  vArcPx = aInfo.w / max(pix / uPixelRatio, 1e-7);
  vCol = uHowRgb[int(clamp(aInfo.y, 0.0, 13.0) + 0.5)];
}
`

const LINE_FRAG = /* glsl */ `
uniform float uYear;
varying float vAcross;
varying float vSoft;
varying float vCore;
varying float vArcPx;
varying float vShow;
varying float vFront;
varying float vFresh;
varying float vFacing;
varying vec3 vCol;
${SEAM_FRAG_GLSL}
void main() {
  ws_clipLine();
  float limb = smoothstep(0.0, 0.3, vFacing);
  float x = abs(vAcross);
  float coreMask = 1.0 - smoothstep(vCore - vSoft, vCore, x);
  float body = 1.0 - smoothstep(1.0 - vSoft, 1.0, x);
  // a bright pulse running toward the entry while the link is fresh
  float run = vFresh * (1.0 - smoothstep(0.08, 0.2, abs(fract(vArcPx / 40.0 + uYear * 0.6) - 0.5)));
  vec3 col = mix(vec3(0.04, 0.04, 0.07), mix(vCol, vec3(1.0), max(vFront * 0.6, run * 0.5)), coreMask);
  float a = body * mix(0.7, 1.0, coreMask) * vShow * limb;
  a = max(a, body * vFront * limb * 0.9);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}
`

function smoothAt(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function buildIdeasLayer(world: World, h: History, dd: IdeasData, maxPopulation: number): IdeasLayer {
  const { positions: P, neighborOffsets: nbOff, neighbors: nb, cellCount } = world.grid
  const N = dd.N
  const R = dd.R
  const A = dd.A
  const object = new THREE.Group()
  object.name = 'ideas'

  // radius of a settlement marker (CSS px before zoom scaling) at snapshot s, as render/settlements.ts
  const invMax = 1 / Math.max(1, maxPopulation)
  const radiusAtSnap = (id: number, s: number) => {
    const pop = h.population[s * N + id] ?? 0
    let r0 = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(Math.min(1, Math.max(0, pop * invMax)))
    if (pop >= CITY_POPULATION) r0 = Math.max(r0, CITY_MIN_RADIUS)
    else if (pop >= TOWN_POPULATION) r0 = Math.max(r0, TOWN_MIN_RADIUS)
    return r0
  }
  const snapOf = (year: number) => Math.max(0, Math.min(h.snapshotCount - 1, Math.round(year / h.snapshotInterval)))
  const posAt = (arr: Float32Array, k: number, cell: number, lift: number) => {
    const r = surfaceRadius(world, cell) + lift
    arr[k * 3] = P[cell * 3] * r
    arr[k * 3 + 1] = P[cell * 3 + 1] * r
    arr[k * 3 + 2] = P[cell * 3 + 2] * r
  }
  const cellOf = (id: number) => (id >= 0 && id < N ? h.settlements[id].cell : -1)

  // ---------- marks: rows, then settlements ----------
  const nM = R + N
  const cap = Math.max(1, nM)
  const mPos = new Float32Array(cap * 3), mA = new Float32Array(cap * 4), mB = new Float32Array(cap * 4), mKnown = new Float32Array(cap)
  const mCell = new Int32Array(cap).fill(-1)
  const pulseRows: number[] = []
  // first and later conceptions, per idea in order
  const originNo = new Int32Array(dd.I)
  for (let k = 0; k < R; k++) {
    const cell = cellOf(A.via[k])
    const how = A.how[k]
    const kind = how === IdeaHow.Lost ? K_LOST : how === IdeaHow.Invented ? (originNo[A.idea[k]]++ === 0 ? K_FIRST : K_AGAIN) : K_ADOPT
    if (cell < 0) {
      mA[k * 4] = NEVER
      mA[k * 4 + 2] = -9
      continue
    }
    posAt(mPos, k, cell, MARK_LIFT)
    mCell[k] = cell
    mA[k * 4] = A.year[k]
    mA[k * 4 + 1] = how
    mA[k * 4 + 2] = A.idea[k]
    mA[k * 4 + 3] = kind
    mB[k * 4] = radiusAtSnap(A.via[k], snapOf(A.year[k]))
    pulseRows.push(A.year[k])
  }
  for (let id = 0; id < N; id++) {
    const k = R + id
    const s = h.settlements[id]
    posAt(mPos, k, s.cell, MARK_LIFT)
    mCell[k] = s.cell
    mA[k * 4] = s.foundedYear
    mA[k * 4 + 1] = s.abandonedYear >= 0 ? s.abandonedYear : NEVER
    mA[k * 4 + 2] = -1
    mA[k * 4 + 3] = K_SETTLEMENT
    mB[k * 4] = MIN_RADIUS
    mB[k * 4 + 1] = NEVER
    mB[k * 4 + 2] = NEVER
  }
  /** Years of the rows that pulse (chronological, as the table): a pulse is on at y while a row's year is in (y - pulse, y]. */
  const pulseYears = Float64Array.from(pulseRows)
  const rowsUpTo = (y: number) => {
    let lo = 0, hi = pulseYears.length
    while (lo < hi) {
      const m = (lo + hi) >>> 1
      if (pulseYears[m] <= y) lo = m + 1
      else hi = m
    }
    return lo
  }
  const geom = new THREE.InstancedBufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  geom.setIndex([0, 1, 2, 0, 2, 3])
  const knownAttr = new THREE.InstancedBufferAttribute(mKnown, 1).setUsage(THREE.DynamicDrawUsage)
  const bAttr = new THREE.InstancedBufferAttribute(mB, 4).setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute('aPos', new THREE.InstancedBufferAttribute(mPos, 3))
  geom.setAttribute('aA', new THREE.InstancedBufferAttribute(mA, 4))
  geom.setAttribute('aB', bAttr)
  geom.setAttribute('aKnown', knownAttr)
  geom.instanceCount = nM

  const howRgb = HOW_RGB.map((c) => new THREE.Vector3(c[0], c[1], c[2]))
  const mu = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uPulse: { value: 0 },
    uSel: { value: -1 },
    uFx: { value: 1 },
    uMaskOn: { value: 0 },
    uSizeScale: { value: 1 },
    uFar: { value: 0 },
    uYield: { value: new THREE.Vector2(0, 0) },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uHowRgb: { value: howRgb },
  }
  const blend = {
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  } as const
  const markMat = new THREE.ShaderMaterial({ uniforms: mu, vertexShader: MARK_VERT, fragmentShader: MARK_FRAG, ...blend, side: THREE.FrontSide })
  const marks = new THREE.Mesh(geom, markMat)
  marks.frustumCulled = false
  marks.renderOrder = 8.69 // over the settlement markers, the sickness marks and the holy cities
  marks.name = 'ideas marks'
  marks.visible = false
  object.add(marks)

  // ---------- links: from each adoption's source to where it came in, along the way it came ----------
  const T = h.trade
  const LH = h.longHaul
  const pairKey = (a: number, b: number) => Math.min(a, b) * 1048576 + Math.max(a, b)
  const needed = new Set<number>()
  const linkable = (k: number) => A.how[k] !== IdeaHow.Invented && A.how[k] !== IdeaHow.Lost && A.source[k] >= 0 && A.source[k] < N && A.via[k] >= 0 && A.via[k] < N
  for (let k = 0; k < R; k++) if (linkable(k) && (A.how[k] === IdeaHow.Trade || A.how[k] === IdeaHow.Lane)) needed.add(pairKey(A.source[k], A.via[k]))
  const routeOf = new Map<number, number>()
  if (T && T.count > 0) for (let r = 0; r < T.count; r++) {
    const key = pairKey(T.a[r], T.b[r])
    if (needed.has(key) && !routeOf.has(key)) routeOf.set(key, r)
  }
  const legOf = new Map<number, number>()
  if (LH && LH.count > 0) for (let q = 0; q < LH.count; q++) {
    const key = pairKey(LH.a[q], LH.b[q])
    if (needed.has(key) && !legOf.has(key)) legOf.set(key, q)
  }
  const pathOut: number[] = []
  /** Cells from a toward b, a step at a time along the great circle (the closest neighbour each time). */
  const walk = (a: number, b: number) => {
    pathOut.length = 0
    let cur = a
    pathOut.push(cur)
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2]
    for (let step = 0; step < 600 && cur !== b; step++) {
      let best = -2, next = -1
      for (let q = nbOff[cur]; q < nbOff[cur + 1]; q++) {
        const c = nb[q]
        const d = P[c * 3] * bx + P[c * 3 + 1] * by + P[c * 3 + 2] * bz
        if (d > best) {
          best = d
          next = c
        }
      }
      const here = P[cur * 3] * bx + P[cur * 3 + 1] * by + P[cur * 3 + 2] * bz
      if (next < 0 || best <= here) break
      cur = next
      pathOut.push(cur)
    }
    if (cur !== b) pathOut.push(b)
  }
  const copyPath = (src: Uint32Array, lo: number, hi: number, fromCell: number) => {
    pathOut.length = 0
    const fwd = src[lo] === fromCell || src[hi - 1] !== fromCell
    if (fwd) for (let q = lo; q < hi; q++) pathOut.push(src[q])
    else for (let q = hi - 1; q >= lo; q--) pathOut.push(src[q])
  }
  const linkRows: number[] = []
  const lOffs: number[] = [0]
  const lPath: number[] = []
  for (let k = 0; k < R; k++) {
    if (!linkable(k)) continue
    const ca = cellOf(A.source[k]), cb = cellOf(A.via[k])
    if (ca < 0 || cb < 0 || ca === cb) continue
    const key = pairKey(A.source[k], A.via[k])
    let done = false
    if (A.how[k] === IdeaHow.Trade) {
      const r = routeOf.get(key)
      if (r !== undefined && T.pathOffsets[r + 1] - T.pathOffsets[r] >= 2) {
        copyPath(T.path, T.pathOffsets[r], T.pathOffsets[r + 1], ca)
        done = true
      }
    } else if (A.how[k] === IdeaHow.Lane) {
      const q = legOf.get(key)
      if (q !== undefined && LH.pathOffsets[q + 1] - LH.pathOffsets[q] >= 2) {
        copyPath(LH.path, LH.pathOffsets[q], LH.pathOffsets[q + 1], ca)
        done = true
      }
    }
    if (!done) walk(ca, cb)
    if (pathOut.length < 2) continue
    if (pathOut[0] !== ca) pathOut.unshift(ca)
    if (pathOut[pathOut.length - 1] !== cb) pathOut.push(cb)
    let ok = true
    for (const c of pathOut) if (!(c >= 0 && c < cellCount)) ok = false
    if (!ok) continue
    linkRows.push(k)
    for (const c of pathOut) lPath.push(c)
    lOffs.push(lPath.length)
  }
  const nL = linkRows.length
  const smp = smoothPaths(world, Uint32Array.from(lOffs), Uint32Array.from(lPath), nL, LIFT)
  const lineGeom = new THREE.BufferGeometry()
  {
    const nS = smp.offsets[nL]
    let quads = 0
    for (let l = 0; l < nL; l++) quads += Math.max(0, smp.offsets[l + 1] - smp.offsets[l] - 1)
    const V = nS * 2
    const vPos = new Float32Array(V * 3), vSide = new Float32Array(V * 4), vInfo = new Float32Array(V * 4), vIdea = new Float32Array(V)
    for (let l = 0; l < nL; l++) {
      const k = linkRows[l]
      for (let s = smp.offsets[l]; s < smp.offsets[l + 1]; s++) {
        for (let side = 0; side < 2; side++) {
          const v = s * 2 + side
          vPos[v * 3] = smp.pos[s * 3]
          vPos[v * 3 + 1] = smp.pos[s * 3 + 1]
          vPos[v * 3 + 2] = smp.pos[s * 3 + 2]
          vSide[v * 4] = smp.side[s * 3]
          vSide[v * 4 + 1] = smp.side[s * 3 + 1]
          vSide[v * 4 + 2] = smp.side[s * 3 + 2]
          vSide[v * 4 + 3] = side === 0 ? -1 : 1
          vInfo[v * 4] = A.year[k]
          vInfo[v * 4 + 1] = A.how[k]
          vInfo[v * 4 + 2] = smp.frac[s]
          vInfo[v * 4 + 3] = smp.length[l] - smp.arc[s]
          vIdea[v] = A.idea[k]
        }
      }
    }
    const idx = new Uint32Array(quads * 6)
    let q = 0
    for (let l = 0; l < nL; l++) {
      for (let s = smp.offsets[l]; s + 1 < smp.offsets[l + 1]; s++) {
        const b = s * 2
        idx[q++] = b; idx[q++] = b + 2; idx[q++] = b + 1
        idx[q++] = b + 1; idx[q++] = b + 2; idx[q++] = b + 3
      }
    }
    lineGeom.setAttribute('position', new THREE.BufferAttribute(vPos, 3))
    lineGeom.setAttribute('aSide', new THREE.BufferAttribute(vSide, 4))
    lineGeom.setAttribute('aInfo', new THREE.BufferAttribute(vInfo, 4))
    lineGeom.setAttribute('aIdea', new THREE.BufferAttribute(vIdea, 1))
    lineGeom.setIndex(new THREE.BufferAttribute(idx, 1))
  }
  /** Per idea, whether any of its links is drawn (a selected idea without links makes no line draw). */
  const ideaHasLinks = new Uint8Array(dd.I)
  for (const k of linkRows) ideaHasLinks[A.idea[k]] = 1
  const firstLinkYear = new Float64Array(dd.I).fill(NEVER)
  for (const k of linkRows) firstLinkYear[A.idea[k]] = Math.min(firstLinkYear[A.idea[k]], A.year[k] - GROW_YEARS)
  const lu = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: mu.uYear,
    uGrow: { value: GROW_YEARS },
    uSel: mu.uSel,
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
    uClose: { value: 1 },
    uDrop: { value: 0 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uHowRgb: mu.uHowRgb,
  }
  const lineMat = new THREE.ShaderMaterial({ uniforms: lu, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, ...blend, side: THREE.DoubleSide })
  const lines = new THREE.Mesh(lineGeom, lineMat)
  lines.frustumCulled = false
  lines.renderOrder = 6.61 // over the trade lines, the long-haul legs and the sickness links, under the known-world mist
  lines.name = 'ideas links'
  lines.visible = false
  object.add(lines)

  // ---------- state ----------
  let shown = true
  let knownMask: Float32Array | null = null
  let sel = -1
  let pulseOn = false
  let year = 0
  let radiusSnap = -1
  const adoptY = new Int16Array(dd.P), lostY = new Int16Array(dd.P)
  const tmpQ = new THREE.Quaternion()
  const camObj = new THREE.Vector3()
  const knownOf = (cell: number) => (knownMask && cell >= 0 ? (knownMask[cell] ?? NEVER) : 0)

  const syncVisible = () => {
    marks.visible = shown && nM > 0 && (sel >= 0 || pulseOn)
    lines.visible = shown && nL > 0 && sel >= 0 && ideaHasLinks[sel] === 1 && year >= firstLinkYear[sel]
  }
  /** The settlements' rings for the selected idea: when each one's people took it up and lost it, and where that falls in the idea's spread. */
  const writeSelection = () => {
    if (sel < 0) return
    adoptionYears(dd, sel, adoptY, lostY)
    const y0 = dd.ideas[sel].firstYear
    const span = Math.max(1, dd.lastYear[sel] - y0)
    for (let id = 0; id < N; id++) {
      const k = R + id
      const q = h.settlements[id].people
      const a = q >= 0 && q < dd.P ? adoptY[q] : -1
      const l = q >= 0 && q < dd.P ? lostY[q] : -1
      mB[k * 4 + 1] = a >= 0 ? a : NEVER
      mB[k * 4 + 2] = l >= 0 ? l : NEVER
      mB[k * 4 + 3] = a >= 0 ? Math.min(1, Math.max(0, (a - y0) / span)) : 0
    }
    bAttr.needsUpdate = true
  }
  const writeRadii = (s: number) => {
    radiusSnap = s
    for (let id = 0; id < N; id++) mB[(R + id) * 4] = radiusAtSnap(id, s)
    bAttr.needsUpdate = true
  }

  const api: IdeasLayer = {
    object,
    setShown(on: boolean) {
      if (on === shown) return
      shown = on
      syncVisible()
      requestRender()
    },
    setKnownMask(cellYear: Float32Array | null) {
      knownMask = cellYear
      mu.uMaskOn.value = cellYear ? 1 : 0
      for (let k = 0; k < nM; k++) mKnown[k] = knownOf(mCell[k])
      knownAttr.needsUpdate = true
      requestRender()
    },
    setMasked(on: boolean) {
      marks.renderOrder = on ? 9.78 : 8.69
    },
    setSelected(i: number) {
      sel = i >= 0 && i < dd.I ? i : -1
      mu.uSel.value = sel
      radiusSnap = -1
      writeSelection()
      syncVisible()
      requestRender()
    },
    setTime(y: number, pulseYears: number, effect: number, playing: boolean, s0: number) {
      year = y
      mu.uYear.value = y
      mu.uFx.value = effect
      // pulses last about half a second of playback (a few years at 1x), only while playing
      mu.uPulse.value = playing && effect > 0.3 ? Math.min(PULSE_MAX, Math.max(1.5, pulseYears * 0.5)) : 0
      pulseOn = mu.uPulse.value > 0 && rowsUpTo(y) > rowsUpTo(y - mu.uPulse.value)
      if (sel >= 0 && s0 !== radiusSnap) writeRadii(s0)
      syncVisible()
    },
    update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number) {
      if (!marks.visible && !lines.visible) return
      object.updateWorldMatrix(true, false)
      camera.getWorldPosition(camObj)
      object.worldToLocal(camObj)
      const dist = camObj.length()
      object.getWorldQuaternion(tmpQ).invert()
      mu.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      lu.uCamObj.value.copy(camObj)
      mu.uCamObj.value.copy(camObj)
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 42
      lu.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) / Math.max(1, drawSize.y)
      lu.uPixelRatio.value = pixelRatio
      mu.uViewport.value.copy(drawSize)
      mu.uPixelRatio.value = pixelRatio
      lu.uClose.value = smoothAt(dist, 1.1, 1.35)
      lu.uDrop.value = LIFT * (1 - Math.min(1, Math.max(0.06, (dist - 1) / 0.6)))
      // as the settlement markers (the rings must fit them)
      mu.uSizeScale.value = Math.min(1.5, Math.max(0.8, Math.sqrt(3.25 / Math.max(1e-3, (camera as THREE.PerspectiveCamera).position.length()))))
      mu.uFar.value = smoothAt((camera as THREE.PerspectiveCamera).position.length(), RINGS_NEAR, RINGS_FAR)
    },
    setYield(near: number, far: number) {
      mu.uYield.value.set(near, far)
    },
    get active() {
      return marks.visible || lines.visible
    },
    stats() {
      let n = 0
      if (sel >= 0) for (const k of linkRows) if (A.idea[k] === sel) n++
      return { marks: marks.visible, links: lines.visible, built: nL, selected: n, indices: lineGeom.index?.count ?? 0, samples: smp.offsets[nL] }
    },
    dispose() {
      geom.dispose()
      lineGeom.dispose()
      markMat.dispose()
      lineMat.dispose()
    },
  }
  return api
}
