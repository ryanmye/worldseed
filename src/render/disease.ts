// Epidemics on the map (data from ui/diseaseData.ts): each outbreak row is a settlement struck in
// a year by one epidemic, sick for its disease's duration. Everything drawn is a pure function of
// the year (and the playback speed, which only stretches how long a mark lingers): scrubbing back
// shows what a direct load shows.
//
//  - Marks (one instanced draw of static instances, one per outbreak row and one per quarantine):
//    while a place is sick, a ring round its marker in its disease kind's colour (crowd sickness a
//    sickly chartreuse, plague a pale bone (violets are the factions' and faiths'), camp fever a pale blue; nothing like the reds of
//    war, the browns of blight or the cyan and amber of trade), wider and thicker with its toll,
//    over a faint wash; a city struck gets a second ring; a great epidemic's marks are brighter and
//    a minor outbreak's fainter. In the year struck a ring spreads from it (only while playing). The
//    ring lingers a little after the sickness ends (longer while playing, so the wave reads at 1x),
//    and the ground an epidemic of four places or more has passed keeps a faint tint of its colour
//    for a couple of decades. Ports holding ships in quarantine fly a small yellow flag from mid zoom
//    while it is in force. A selected epidemic shows every place it struck, coloured by when (pale
//    yellow first, crimson last), hollow until struck; a selected disease dims the others.
//  - Links (one draw of one ribbon geometry): from each outbreak's source to it, drawn out in the
//    year it is struck and fading after: by sea along the sea route or lane it took (dashes running
//    toward the struck port), overland along the trade road (solid), with an army along its line of
//    march (dash-dot), else a faint short link (neighbours, kin, travellers). A selected epidemic
//    draws its whole spread tree.
//  - Activity: the years in which anything is drawn are known per history (merged spans), so per
//    frame the layer only checks the year against them; with nothing active neither draw is made.
//  - Known world: marks in cells not yet known are hidden; the links lie under the mist.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { CITY_POPULATION, DiseaseVia, JourneyKind, TOWN_POPULATION } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms, SEAM_FRAG_GLSL } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'
import { smoothPaths } from './routeCurves.ts'
import { requestRender } from './invalidate.ts'
import { KIND_RGB, type DiseaseData } from '../ui/diseaseData.ts'

const LIFT = 0.0036
const MARK_LIFT = 0.0046
const NEVER = 1e9
/** Settlement marker radius range (CSS px before zoom scaling), as render/settlements.ts. */
const MIN_RADIUS = 1.7
const MAX_RADIUS = 6.5
const TOWN_MIN_RADIUS = 4.6
const CITY_MIN_RADIUS = 7.0
/** Years the ground an epidemic passed stays tinted (a great one longer), and the fewest places for a tint. */
const FOOT_YEARS = 18
const FOOT_GREAT_YEARS = 28
const FOOT_MIN_PLACES = 4
/** Longest linger of a ring and of a link (years) at any speed, for the activity spans. */
const LINGER_MAX = 8
const LINK_LINGER_MAX = 10
const GROW_MAX = 2
const FLAG_KIND = 9

export interface DiseaseLayer {
  object: THREE.Group
  /** The Disease layer toggle. */
  setShown(on: boolean): void
  setKnownMask(cellYear: Float32Array | null): void
  /** Draw order of the marks: over the clouds while a known world is shown. */
  setMasked(on: boolean): void
  /** Highlight an epidemic (its places and spread tree) and/or a disease (the others dimmed); -1 none. */
  setSelection(epidemic: number, disease: number): void
  /** Per frame: the year, the pulse length (years a second of playback covers), an effect opacity (lower at high speed), and whether playing. */
  setTime(year: number, pulseYears: number, effect: number, playing: boolean): void
  update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** Up close the markers yield to the 3D towns: the rings follow (near, far camera distances; far <= 0 off). */
  setYield(near: number, far: number): void
  /** Whether either draw is on this frame. */
  readonly active: boolean
  dispose(): void
}

const MARK_VERT = /* glsl */ `
${RELIEF_GLSL}
attribute vec3 aPos;
attribute vec4 aA; // year struck, first year well, footprint years (0 none), kind (9: a quarantine flag)
attribute vec4 aB; // toll 0..1, marker radius (px), flags (1 great, 2 city, 4 origin, 8 minor), when in its epidemic 0..1
attribute vec2 aC; // epidemic, disease
attribute float aKnown;
uniform float uYear;
uniform float uLinger;
uniform float uStrike;
uniform float uFx;
uniform float uSelEpi;
uniform float uSelDis;
uniform float uMaskOn;
uniform float uSizeScale;
uniform float uFlagZoom;
uniform vec2 uYield;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform vec3 uCamObj;
uniform vec3 uSunObj;
uniform float uDaylight;
uniform vec3 uKindRgb[4];
varying vec2 vPx;
flat varying float vKind;
flat varying float vFlags;
varying float vInner;
varying float vR;
varying float vFoot;
varying float vFootR;
varying float vGlow;
varying float vStrike;
varying float vSel;
varying float vStruck;
varying float vAlpha;
varying vec3 vCol;
varying vec3 vRamp;
varying float vNight;
vec3 ramp(float t) {
  vec3 a = vec3(1.0, 0.95, 0.55), b = vec3(1.0, 0.6, 0.18), c = vec3(0.86, 0.12, 0.3);
  return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0);
}
void main() {
  vec3 pos = ws_relief(aPos);
  vec3 up = normalize(pos);
  float facing = ws_facing(dot(up, normalize(uCamObj - pos)));
  float kind = aA.w;
  float y0 = aA.x, y1 = aA.y;
  float flags = aB.z;
  bool great = mod(flags, 2.0) > 0.5;
  bool hidden = uMaskOn > 0.5 && uYear < aKnown;
  float glow = 0.0, foot = 0.0, strike = -1.0, sel = 0.0, struck = 0.0, show = 0.0;
  float dim = 1.0;
  if (kind > 8.5) {
    show = uYear >= y0 && uYear < y1 ? uFlagZoom : 0.0;
  } else {
    sel = uSelEpi >= 0.0 && abs(aC.x - uSelEpi) < 0.5 ? 1.0 : 0.0;
    if ((uSelEpi >= 0.0 && sel < 0.5) || (uSelDis >= 0.0 && abs(aC.y - uSelDis) > 0.5)) dim = 0.3;
    struck = uYear >= y0 ? 1.0 : 0.0;
    float after = uYear - y1;
    if (struck > 0.5) glow = after < 0.0 ? 1.0 : (after < uLinger ? 1.0 - after / uLinger : 0.0);
    if (struck > 0.5 && aA.z > 0.0) foot = after < 0.0 ? 1.0 : (after < aA.z ? 1.0 - after / aA.z : 0.0);
    float age = uYear - y0;
    if (uStrike > 0.0 && age >= 0.0 && age < uStrike) strike = age / uStrike;
    show = max(max(glow, foot * 0.6), max(sel, strike >= 0.0 ? 1.0 : 0.0));
  }
  if (hidden || facing <= 0.0 || show <= 0.003) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float yieldK = uYield.y > 0.0 ? 1.0 - smoothstep(uYield.x, uYield.y, length(uCamObj - pos)) : 0.0;
  float inner = aB.y * uSizeScale * mix(0.55, 1.0, sqrt(facing)) * mix(1.0, 0.55, yieldK);
  float toll = aB.x;
  float R = inner + (3.0 + 7.0 * sqrt(toll)) * uSizeScale;
  float footR = max(R + 9.0, 20.0 * uSizeScale) * (great ? 1.35 : 1.0);
  float ext = kind > 8.5 ? inner + 12.0 : max(max(R + 16.0, footR), inner + 9.0) + 3.0;
  vec2 off = kind > 8.5 ? vec2(inner + 4.0, inner + 5.0) : vec2(0.0);
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(pos), 1.0);
  clip.xy += (position.xy * ext + off) * uPixelRatio * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  vPx = position.xy * ext;
  vKind = kind;
  vFlags = flags;
  vInner = inner;
  vR = R;
  vFoot = foot * dim;
  vFootR = footR;
  vGlow = glow * mix(1.0, uFx, 0.6) * dim;
  vStrike = strike;
  vSel = sel;
  vStruck = struck;
  vCol = uKindRgb[int(clamp(kind, 0.0, 3.0) + 0.5)];
  vRamp = ramp(aB.w);
  vAlpha = smoothstep(0.0, 0.25, facing) * (kind > 8.5 ? show : 1.0);
  vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
}
`

const MARK_FRAG = /* glsl */ `
uniform float uFx;
varying vec2 vPx;
flat varying float vKind;
flat varying float vFlags;
varying float vInner;
varying float vR;
varying float vFoot;
varying float vFootR;
varying float vGlow;
varying float vStrike;
varying float vSel;
varying float vStruck;
varying float vAlpha;
varying vec3 vCol;
varying vec3 vRamp;
varying float vNight;
float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
vec4 glyph(float d, vec3 fillC, vec3 lineC, float outline) {
  float fill = 1.0 - smoothstep(-0.6, 0.6, d);
  float edge = 1.0 - smoothstep(-0.6, 0.6, d - outline);
  return vec4(mix(lineC, fillC, fill) * edge, edge);
}
vec4 over(vec4 a, vec4 b) { return vec4(a.rgb + b.rgb * (1.0 - a.a), a.a + b.a * (1.0 - a.a)); }
void main() {
  vec2 p = vPx;
  float d = length(p);
  vec3 dark = vec3(0.05, 0.03, 0.07);
  vec4 o = vec4(0.0);
  if (vKind > 8.5) {
    // a quarantine flag: a yellow square flag on a pole
    vec2 q = p + vec2(0.0, 4.0);
    float pole = sdSeg(q, vec2(-3.0, -2.0), vec2(-3.0, 9.0)) - 0.6;
    float flag = sdBox(q - vec2(0.6, 6.2), vec2(3.4, 2.6));
    o = glyph(min(pole, flag), vec3(1.0, 0.86, 0.12), dark, 1.0);
    o = over(glyph(pole, vec3(0.92, 0.88, 0.8), dark, 0.0), o);
  } else {
    float flags = vFlags;
    bool great = mod(flags, 2.0) > 0.5;
    bool city = mod(floor(flags / 2.0), 2.0) > 0.5;
    bool minor = mod(floor(flags / 8.0), 2.0) > 0.5;
    float strength = great ? 1.0 : minor ? 0.6 : 0.82;
    // the ground it passed: a faint soft tint
    if (vFoot > 0.0) {
      float t = 1.0 - smoothstep(vFootR * 0.25, vFootR, d);
      float a = vFoot * t * (great ? 0.26 : 0.14);
      o = vec4(vCol * 0.8 * a, a);
    }
    // sick: a ring in the kind's colour over a wash (doubled for a city)
    if (vGlow > 0.0) {
      float w = (great ? 1.5 : 1.0) * (1.2 + 1.6 * clamp((vR - vInner) / 10.0, 0.0, 1.0));
      float wash = (1.0 - smoothstep(vR - 1.0, vR + 0.5, d)) * step(vInner + 0.5, d) * 0.22 * vGlow * strength;
      o = over(vec4(vCol * wash, wash), o);
      vec4 ring = glyph(abs(d - vR) - w * 0.5, mix(vCol, vec3(1.0), 0.18), dark, 0.9);
      o = over(ring * vGlow * strength, o);
      if (city) o = over(glyph(abs(d - vR - w - 2.6) - 0.6, mix(vCol, vec3(1.0), 0.45), dark, 0.7) * vGlow * strength, o);
    }
    // the year struck: a ring spreading out (while playing)
    if (vStrike >= 0.0) {
      float R2 = vR + 15.0 * sqrt(vStrike);
      float a = (1.0 - smoothstep(0.5, 1.6, abs(d - R2))) * (1.0 - vStrike) * 0.85 * uFx * strength;
      o = over(vec4(mix(vCol, vec3(1.0), 0.4) * a, a), o);
    }
    // the selected epidemic: every place it struck, coloured by when (hollow until struck)
    if (vSel > 0.5) {
      float Rs = vInner + 3.2;
      if (vStruck > 0.5) o = over(glyph(abs(d - Rs) - 1.4, vRamp, dark, 0.9), o);
      else o = over(glyph(abs(d - Rs) - 0.5, vRamp * 0.8, dark, 0.5) * 0.55, o);
    }
  }
  o *= vAlpha * mix(1.0, 0.7, vNight);
  if (o.a < 0.004) discard;
  gl_FragColor = o;
}
`

const LINE_VERT = /* glsl */ `
${RELIEF_GLSL}
attribute vec4 aSide; // side direction, across (-1|1)
attribute vec4 aInfo; // year struck, via, fraction along, arc length
attribute vec4 aSel; // epidemic, disease, flags (1 great, 8 minor), kind
uniform float uYear;
uniform float uGrow;
uniform float uLinkLinger;
uniform float uFx;
uniform float uSelEpi;
uniform float uSelDis;
uniform float uPixel;
uniform float uPixelRatio;
uniform float uClose;
uniform float uDrop;
uniform vec3 uCamObj;
uniform vec3 uKindRgb[4];
varying float vAcross;
varying float vSoft;
varying float vCore;
varying float vArcPx;
varying float vVia;
varying float vShow;
varying float vFront;
varying float vFacing;
varying vec3 vCol;
void main() {
  vec3 pR = ws_relief(position);
  float y = aInfo.x;
  float via = aInfo.y;
  float frac = aInfo.z;
  float flags = aSel.z;
  bool great = mod(flags, 2.0) > 0.5;
  bool minor = mod(floor(flags / 8.0), 2.0) > 0.5;
  float t0 = y - uGrow;
  float grow = clamp((uYear - t0) / max(uGrow, 1e-3), 0.0, 1.0);
  float show = 0.0;
  if (uYear >= t0 && frac <= grow + 1e-4) show = 1.0 - clamp((uYear - y - 1.0) / max(uLinkLinger, 1e-3), 0.0, 1.0);
  show *= mix(1.0, uFx, 0.5);
  bool sel = uSelEpi >= 0.0 && abs(aSel.x - uSelEpi) < 0.5;
  if (sel) show = max(show, uYear >= y ? 0.7 : 0.2);
  else if (uSelEpi >= 0.0 || (uSelDis >= 0.0 && abs(aSel.y - uSelDis) > 0.5)) show *= 0.3;
  // a faint short link: neighbours, kin, travellers, the first contact, a returning focus
  bool faint = via > 2.5 && via < 5.5 || via > 6.5;
  show *= faint ? 0.55 : 1.0;
  show *= great ? 1.0 : minor ? 0.6 : 0.85;
  if (show <= 0.003) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vShow = show;
  vVia = via;
  vFront = grow < 1.0 ? clamp(1.0 - (grow - frac) * 6.0, 0.0, 1.0) : 0.0;
  float core = (faint ? 0.65 : 1.15) * (great ? 1.3 : 1.0) * (sel ? 1.15 : 1.0);
  core *= mix(0.6, 1.0, uClose);
  vec3 up = normalize(pR);
  vec3 base = pR - up * uDrop;
  vec4 mv = modelViewMatrix * vec4(ws_place(base), 1.0);
  float pix = -mv.z * uPixel * uPixelRatio;
  float outer = core + 0.9;
  vCore = core / outer;
  vSoft = 0.9 / outer;
  vAcross = aSide.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(base + aSide.xyz * aSide.w * outer * pix), 1.0);
  vFacing = ws_facing(dot(up, normalize(uCamObj - pR)));
  vArcPx = aInfo.w / max(pix / uPixelRatio, 1e-7);
  vCol = mix(uKindRgb[int(clamp(aSel.w, 0.0, 3.0) + 0.5)], vec3(1.0), sel ? 0.1 : 0.0);
}
`

const LINE_FRAG = /* glsl */ `
uniform float uYear;
varying float vAcross;
varying float vSoft;
varying float vCore;
varying float vArcPx;
varying float vVia;
varying float vShow;
varying float vFront;
varying float vFacing;
varying vec3 vCol;
${SEAM_FRAG_GLSL}
void main() {
  ws_clipLine();
  float limb = smoothstep(0.0, 0.3, vFacing);
  float x = abs(vAcross);
  float coreMask = 1.0 - smoothstep(vCore - vSoft, vCore, x);
  float body = 1.0 - smoothstep(1.0 - vSoft, 1.0, x);
  float on = 1.0;
  if (vVia > 1.5 && vVia < 2.5) {
    // by sea: dashes running toward the struck port
    on = 1.0 - smoothstep(0.32, 0.46, abs(fract(vArcPx / 11.0 - uYear * 1.5) - 0.5));
  } else if (vVia > 5.5 && vVia < 6.5) {
    // with an army: dash-dot
    float f = fract(vArcPx / 16.0);
    on = f < 0.55 ? 1.0 : (abs(f - 0.78) < 0.07 ? 1.0 : 0.0);
  } else if (vVia > 6.5) {
    // the first contact, a returning focus: dots
    on = 1.0 - smoothstep(0.18, 0.3, abs(fract(vArcPx / 6.0) - 0.5));
  }
  vec3 col = mix(vec3(0.05, 0.03, 0.07), mix(vCol, vec3(1.0), vFront * 0.6), coreMask);
  float a = body * on * mix(0.55, 1.0, coreMask) * vShow * limb;
  a = max(a, body * vFront * vShow * limb * 0.9);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}
`

function smoothAt(x: number, a: number, b: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Merged [start, end) year spans of `iv` (pairs), for a quick "anything here" test. */
function mergeSpans(iv: number[]): Float64Array {
  const n = iv.length / 2
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => iv[a * 2] - iv[b * 2])
  const out: number[] = []
  for (const i of order) {
    const a = iv[i * 2], b = iv[i * 2 + 1]
    if (out.length && a <= out[out.length - 1]) out[out.length - 1] = Math.max(out[out.length - 1], b)
    else out.push(a, b)
  }
  return Float64Array.from(out)
}
function inSpans(sp: Float64Array, y: number): boolean {
  let lo = 0, hi = sp.length / 2
  while (lo < hi) {
    const m = (lo + hi) >>> 1
    if (sp[m * 2] <= y) lo = m + 1
    else hi = m
  }
  return lo > 0 && y < sp[(lo - 1) * 2 + 1]
}

export function buildDiseaseLayer(world: World, h: History, dd: DiseaseData, maxPopulation: number): DiseaseLayer {
  const { positions: P, neighborOffsets: nbOff, neighbors: nb, cellCount } = world.grid
  const N = dd.N
  const O = dd.O
  const R = dd.R
  const object = new THREE.Group()
  object.name = 'disease'

  // radius of a settlement marker (CSS px before zoom scaling) at a year, as render/settlements.ts
  const invMax = 1 / Math.max(1, maxPopulation)
  const radiusAt = (id: number, year: number) => {
    const s = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(year / h.snapshotInterval)))
    const pop = h.population[s * N + id] ?? 0
    let r0 = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(Math.min(1, Math.max(0, pop * invMax)))
    if (pop >= CITY_POPULATION) r0 = Math.max(r0, CITY_MIN_RADIUS)
    else if (pop >= TOWN_POPULATION) r0 = Math.max(r0, TOWN_MIN_RADIUS)
    return r0
  }
  const posAt = (arr: Float32Array, k: number, cell: number, lift: number) => {
    const r = surfaceRadius(world, cell) + lift
    arr[k * 3] = P[cell * 3] * r
    arr[k * 3 + 1] = P[cell * 3 + 1] * r
    arr[k * 3 + 2] = P[cell * 3 + 2] * r
  }
  const cellOf = (id: number) => (id >= 0 && id < N ? h.settlements[id].cell : -1)

  // per epidemic: great or minor, its span (for "when"), whether its ground is tinted
  const E = dd.E
  const epiStart = new Float64Array(E), epiSpan = new Float64Array(E), epiFoot = new Float32Array(E), epiFlag = new Uint8Array(E)
  for (let e = 0; e < E; e++) {
    const x = dd.epidemics[e]
    const lo = dd.eOff[e], hi = dd.eOff[e + 1]
    epiStart[e] = hi > lo ? dd.eYear[lo] : x.startYear
    epiSpan[e] = hi > lo ? Math.max(1, dd.eYear[hi - 1] - dd.eYear[lo]) : 1
    epiFoot[e] = x.great ? FOOT_GREAT_YEARS : hi - lo >= FOOT_MIN_PLACES ? FOOT_YEARS : 0
    epiFlag[e] = x.great ? 1 : hi - lo < 3 ? 8 : 0
  }

  // ---------- marks ----------
  const Q = dd.Q
  const nQ = Q ? Q.count : 0
  const nM = R + nQ
  const cap = Math.max(1, nM)
  const mPos = new Float32Array(cap * 3), mA = new Float32Array(cap * 4), mB = new Float32Array(cap * 4), mC = new Float32Array(cap * 2), mKnown = new Float32Array(cap)
  const mCell = new Int32Array(cap).fill(-1)
  const markIv: number[] = []
  const flagIv: number[] = []
  for (let i = 0; i < R; i++) {
    const id = O.settlement[i]
    const cell = cellOf(id)
    if (cell < 0) {
      mA[i * 4] = NEVER
      mA[i * 4 + 1] = NEVER
      continue
    }
    posAt(mPos, i, cell, MARK_LIFT)
    mCell[i] = cell
    const e = O.epidemic[i]
    const y0 = O.year[i], y1 = dd.rowEnd[i]
    const foot = e >= 0 && e < E ? epiFoot[e] : 0
    mA[i * 4] = y0
    mA[i * 4 + 1] = y1
    mA[i * 4 + 2] = foot
    mA[i * 4 + 3] = dd.rowKind[i]
    mB[i * 4] = O.mortality[i] / 255
    mB[i * 4 + 1] = radiusAt(id, y0)
    mB[i * 4 + 2] = (e >= 0 && e < E ? epiFlag[e] : 0) + (dd.rowCity[i] ? 2 : 0) + (O.source[i] < 0 ? 4 : 0)
    mB[i * 4 + 3] = e >= 0 && e < E ? Math.min(1, (y0 - epiStart[e]) / epiSpan[e]) : 0
    mC[i * 2] = e
    mC[i * 2 + 1] = O.disease[i]
    markIv.push(y0 - 0.01, Math.max(y1 + LINGER_MAX, y1 + foot))
  }
  for (let q = 0; q < nQ; q++) {
    const k = R + q
    const id = Q!.settlement[q]
    const cell = cellOf(id)
    if (cell < 0) {
      mA[k * 4] = NEVER
      mA[k * 4 + 1] = NEVER
      mA[k * 4 + 3] = FLAG_KIND
      continue
    }
    posAt(mPos, k, cell, MARK_LIFT)
    mCell[k] = cell
    const to = Q!.to[q] >= 0 ? Q!.to[q] : NEVER
    mA[k * 4] = Q!.from[q]
    mA[k * 4 + 1] = to
    mA[k * 4 + 3] = FLAG_KIND
    mB[k * 4 + 1] = radiusAt(id, Q!.from[q])
    mC[k * 2] = -9
    mC[k * 2 + 1] = -9
    flagIv.push(Q!.from[q], to)
  }
  const markSpans = mergeSpans(markIv)
  const flagSpans = mergeSpans(flagIv)
  const geom = new THREE.InstancedBufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  geom.setIndex([0, 1, 2, 0, 2, 3])
  const knownAttr = new THREE.InstancedBufferAttribute(mKnown, 1).setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute('aPos', new THREE.InstancedBufferAttribute(mPos, 3))
  geom.setAttribute('aA', new THREE.InstancedBufferAttribute(mA, 4))
  geom.setAttribute('aB', new THREE.InstancedBufferAttribute(mB, 4))
  geom.setAttribute('aC', new THREE.InstancedBufferAttribute(mC, 2))
  geom.setAttribute('aKnown', knownAttr)
  geom.instanceCount = nM

  const kindRgb = [0, 1, 2, 3].map((k) => new THREE.Vector3(...(KIND_RGB[k] ?? [1, 1, 1])))
  const mu = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uLinger: { value: 1 },
    uStrike: { value: 0 },
    uFx: { value: 1 },
    uSelEpi: { value: -1 },
    uSelDis: { value: -1 },
    uMaskOn: { value: 0 },
    uSizeScale: { value: 1 },
    uFlagZoom: { value: 1 },
    uYield: { value: new THREE.Vector2(0, 0) },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uKindRgb: { value: kindRgb },
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
  marks.renderOrder = 8.66 // over the settlement markers, the structure icons and the goods marks
  marks.name = 'disease marks'
  marks.visible = false
  object.add(marks)

  // ---------- links: from each outbreak's source to it, along the way it came ----------
  // (cell paths: the trade route or long-haul leg between the two, the army's or travellers' journey, else a walk along the great circle)
  const T = h.trade
  const pairKey = (a: number, b: number) => Math.min(a, b) * 1048576 + Math.max(a, b)
  const needed = new Set<number>()
  for (let i = 0; i < R; i++) if (O.source[i] >= 0 && O.source[i] < N && O.settlement[i] >= 0 && O.settlement[i] < N) needed.add(pairKey(O.source[i], O.settlement[i]))
  const routeOf = new Map<number, number>()
  if (T && T.count > 0) for (let r = 0; r < T.count; r++) {
    const k = pairKey(T.a[r], T.b[r])
    if (needed.has(k) && !routeOf.has(k)) routeOf.set(k, r)
  }
  const LH = h.longHaul
  const legOf = new Map<number, number>()
  if (LH && LH.count > 0) for (let k = 0; k < LH.count; k++) {
    const key = pairKey(LH.a[k], LH.b[k])
    if (needed.has(key) && !legOf.has(key)) legOf.set(key, k)
  }
  const J = h.journeys
  const journeysOf = new Map<number, number[]>()
  if (J && J.count > 0) for (let j = 0; j < J.count; j++) {
    if (J.from[j] < 0 || J.to[j] < 0) continue
    const key = pairKey(J.from[j], J.to[j])
    if (!needed.has(key)) continue
    const a = journeysOf.get(key)
    if (a) a.push(j)
    else journeysOf.set(key, [j])
  }
  const isWater = (c: number) => world.elevation[c] < 0
  const pathOut: number[] = []
  /** Cells from a toward b, a step at a time along the great circle (the closest neighbour each time). */
  const walk = (a: number, b: number) => {
    pathOut.length = 0
    let cur = a
    pathOut.push(cur)
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2]
    for (let step = 0; step < 400 && cur !== b; step++) {
      let best = -2, next = -1
      for (let k = nbOff[cur]; k < nbOff[cur + 1]; k++) {
        const c = nb[k]
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
    if (fwd) for (let k = lo; k < hi; k++) pathOut.push(src[k])
    else for (let k = hi - 1; k >= lo; k--) pathOut.push(src[k])
  }
  const linkRows: number[] = []
  const lOffs: number[] = [0]
  const lPath: number[] = []
  for (let i = 0; i < R; i++) {
    const s = O.source[i], t = O.settlement[i]
    if (s < 0 || s >= N || t < 0 || t >= N || s === t) continue
    const ca = cellOf(s), cb = cellOf(t)
    if (ca < 0 || cb < 0 || ca === cb) continue
    const key = pairKey(s, t)
    const via = O.via[i]
    let done = false
    if (via === DiseaseVia.Route || via === DiseaseVia.Sea) {
      const r = routeOf.get(key)
      const k = legOf.get(key)
      // a sea passage prefers a route that goes by water; the long-haul lane next
      if (r !== undefined && T.pathOffsets[r + 1] - T.pathOffsets[r] >= 2) {
        let wet = false
        for (let q = T.pathOffsets[r]; q < T.pathOffsets[r + 1] && !wet; q++) if (isWater(T.path[q])) wet = true
        if (via === DiseaseVia.Route || wet || k === undefined) {
          copyPath(T.path, T.pathOffsets[r], T.pathOffsets[r + 1], ca)
          done = true
        }
      }
      if (!done && k !== undefined && LH.pathOffsets[k + 1] - LH.pathOffsets[k] >= 2) {
        copyPath(LH.path, LH.pathOffsets[k], LH.pathOffsets[k + 1], ca)
        done = true
      }
    } else if ((via === DiseaseVia.Army || via === DiseaseVia.Journey) && J) {
      // the journey between the two nearest the year (an army arrives the year of the battle)
      let best = -1, bd = 6
      for (const j of journeysOf.get(key) ?? []) {
        if (via === DiseaseVia.Army && J.kind[j] !== JourneyKind.Army) continue
        const dy = Math.abs(J.arriveYear[j] - O.year[i])
        if (dy < bd) {
          bd = dy
          best = j
        }
      }
      if (best >= 0 && J.pathOffsets[best + 1] - J.pathOffsets[best] >= 2) {
        copyPath(J.path, J.pathOffsets[best], J.pathOffsets[best + 1], ca)
        done = true
      }
    }
    if (!done) walk(ca, cb)
    if (pathOut.length < 2) continue
    // (the drawing starts at the source and ends at the struck place)
    if (pathOut[0] !== ca) pathOut.unshift(ca)
    if (pathOut[pathOut.length - 1] !== cb) pathOut.push(cb)
    let ok = true
    for (const c of pathOut) if (!(c >= 0 && c < cellCount)) ok = false
    if (!ok) continue
    linkRows.push(i)
    for (const c of pathOut) lPath.push(c)
    lOffs.push(lPath.length)
  }
  const nL = linkRows.length
  const smp = smoothPaths(world, Uint32Array.from(lOffs), Uint32Array.from(lPath), nL, LIFT)
  const lineGeom = new THREE.BufferGeometry()
  const linkIv: number[] = []
  {
    const nS = smp.offsets[nL]
    let quads = 0
    for (let l = 0; l < nL; l++) quads += Math.max(0, smp.offsets[l + 1] - smp.offsets[l] - 1)
    const V = nS * 2
    const vPos = new Float32Array(V * 3), vSide = new Float32Array(V * 4), vInfo = new Float32Array(V * 4), vSel = new Float32Array(V * 4)
    for (let l = 0; l < nL; l++) {
      const i = linkRows[l]
      const e = O.epidemic[i]
      const flags = e >= 0 && e < E ? epiFlag[e] : 0
      linkIv.push(O.year[i] - GROW_MAX, O.year[i] + 1 + LINK_LINGER_MAX)
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
          vInfo[v * 4] = O.year[i]
          vInfo[v * 4 + 1] = O.via[i]
          vInfo[v * 4 + 2] = smp.frac[s]
          // arc length back from the struck end (the sea dashes run toward it)
          vInfo[v * 4 + 3] = smp.length[l] - smp.arc[s]
          vSel[v * 4] = e
          vSel[v * 4 + 1] = O.disease[i]
          vSel[v * 4 + 2] = flags
          vSel[v * 4 + 3] = dd.rowKind[i]
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
    lineGeom.setAttribute('aSel', new THREE.BufferAttribute(vSel, 4))
    lineGeom.setIndex(new THREE.BufferAttribute(idx, 1))
  }
  const linkSpans = mergeSpans(linkIv)
  const lu = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uGrow: { value: 0.7 },
    uLinkLinger: { value: 1 },
    uFx: { value: 1 },
    uSelEpi: mu.uSelEpi,
    uSelDis: mu.uSelDis,
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
    uClose: { value: 1 },
    uDrop: { value: 0 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uKindRgb: mu.uKindRgb,
  }
  const lineMat = new THREE.ShaderMaterial({ uniforms: lu, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, ...blend, side: THREE.DoubleSide })
  const lines = new THREE.Mesh(lineGeom, lineMat)
  lines.frustumCulled = false
  lines.renderOrder = 6.58 // over the trade lines and the long-haul legs, under the known-world mist
  lines.name = 'disease links'
  lines.visible = false
  object.add(lines)

  // ---------- state ----------
  let shown = true
  let knownMask: Float32Array | null = null
  let selEpi = -1, selDis = -1
  let marksOn = false, flagsOn = false, linksOn = false
  let flagZoom = 0
  const tmpQ = new THREE.Quaternion()
  const camObj = new THREE.Vector3()
  const knownOf = (cell: number) => (knownMask && cell >= 0 ? (knownMask[cell] ?? NEVER) : 0)

  const syncVisible = () => {
    const sel = selEpi >= 0
    marks.visible = shown && nM > 0 && (marksOn || sel || (flagsOn && flagZoom > 0.003))
    lines.visible = shown && nL > 0 && (linksOn || sel)
  }

  const api: DiseaseLayer = {
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
      marks.renderOrder = on ? 9.77 : 8.66
    },
    setSelection(epidemic: number, disease: number) {
      selEpi = epidemic >= 0 && epidemic < E ? epidemic : -1
      selDis = disease >= 0 && disease < dd.D ? disease : -1
      mu.uSelEpi.value = selEpi
      mu.uSelDis.value = selDis
      syncVisible()
      requestRender()
    },
    setTime(year: number, pulseYears: number, effect: number, playing: boolean) {
      mu.uYear.value = year
      lu.uYear.value = year
      mu.uFx.value = effect
      lu.uFx.value = effect
      // while playing the marks and links linger about a third of a second (so the wave reads at
      // 1x); paused, only what is sick now and what was struck in the last year or so
      mu.uLinger.value = playing ? Math.min(LINGER_MAX, Math.max(1, pulseYears * 0.35)) : 1
      lu.uLinkLinger.value = playing ? Math.min(LINK_LINGER_MAX, Math.max(1, pulseYears * 0.4)) : 1
      mu.uStrike.value = playing && effect > 0.5 ? Math.min(4, Math.max(0.8, pulseYears * 0.15)) : 0
      lu.uGrow.value = playing ? Math.min(GROW_MAX, Math.max(0.7, pulseYears * 0.04)) : 0.7
      marksOn = inSpans(markSpans, year)
      flagsOn = inSpans(flagSpans, year)
      linksOn = inSpans(linkSpans, year)
      syncVisible()
    },
    update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number) {
      object.updateWorldMatrix(true, false)
      camera.getWorldPosition(camObj)
      object.worldToLocal(camObj)
      const dist = camObj.length()
      // quarantine flags from mid zoom in
      const fz = 1 - smoothAt(dist, 2.3, 3.0)
      if ((fz > 0.003) !== (flagZoom > 0.003)) {
        flagZoom = fz
        syncVisible()
      }
      flagZoom = fz
      mu.uFlagZoom.value = fz
      if (!marks.visible && !lines.visible) return
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
    },
    setYield(near: number, far: number) {
      mu.uYield.value.set(near, far)
    },
    get active() {
      return marks.visible || lines.visible
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
