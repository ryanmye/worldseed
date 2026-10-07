// The long-distance trade and the goods economy on the map (data from ui/goodsData.ts): sea
// lanes opened by route-seeking expeditions, the relay legs between marts, marts, trading posts,
// rare deposits and their rushes, the industries of towns (Resources view), the prices of a class
// (price view), ships on the lanes and highlights of what the Goods panel selects.
//
//  - Lines (one draw of one ribbon geometry): the legs along the bundled network of
//    routeCurves.ts (routeNetwork: sea runs snap onto lanes already sailed, a shared link is one
//    curve, so parallel lanes draw as one bundle), the opening expeditions' trails along their own
//    smoothed paths (smoothPaths). A lane is gold, drawn out from its home mart over its first two
//    years, wider and brighter with its volume (log scale against the busiest lane, a few pixels at
//    most, narrower zoomed out: the lanes read as a network without burying the towns and names
//    along them); a relay leg is a thin amber line with beads
//    drifting along it (distinct from the cyan sea dashes and warm land lines of the ordinary
//    trade); the route-seeking expedition that opened a lane is a dotted white-gold trail while
//    the lane is selected and for a few decades after it came home. A float texture holds each
//    leg's volume at the two trade snapshots bracketing the year and whether it is highlighted;
//    rewritten only when that pair (or the highlight) changes. Lines lie under the known-world
//    mist (as the trade lines do) and thin out among the 3D towns.
//  - Marks (one instanced draw of static instances): a gold ring round each mart's marker
//    (thicker, then doubled from mid zoom, the busier it is; zoomed out only the busiest show, and
//    thinner); the trading posts (a pennant in the owner's colour beside a factory's host, a small
//    fort or a beacon tower below a fort's or a station's own marker, from mid zoom: markerSlots.ts); deposit icons by kind
//    from the year found (sized by output, grey and struck through once spent) with a pulsing
//    ring while a rush lasts; industry dots round the settlement markers on the Resources view
//    (one per industry, colours of goodsData INDUSTRY_LIST); price discs over the traders of
//    the chosen class (a fixed scale per class over the first 2000 years, so the gradient's
//    collapse when a lane opens shows). Values are written per trade snapshot pair, ring radii
//    (which follow the settlement markers) per population snapshot pair; the shader interpolates.
//  - Dynamic marks (a second instanced draw): ships on the lanes (larger and rarer than the
//    merchants: one to three per lane by volume, sailing out and back, a pure function of the
//    year; gone at 16x) and highlight rings (selected tradition's seats, a secret's holders,
//    a lane's ends, a deposit and its mine).
//  - Known world: marks in cells not yet known are hidden (per instance).

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { CITY_POPULATION, LegKind, PostKind, TOWN_POPULATION } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms, SEAM_FRAG_GLSL } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'
import { networkRouteSamples, routeNetwork, segmentWater, smoothPaths, type PathSamples } from './routeCurves.ts'
import { requestRender } from './invalidate.ts'
import { MARKER_SLOT_GLSL } from './markerSlots.ts'
import { INDUSTRY_LIST, ownerRgb, type GoodsData } from '../ui/goodsData.ts'

const LIFT = 0.0033
const MARK_LIFT = 0.0045
/** The samples of each network piece the legs are drawn with (routeCurves.ts networkRouteSamples). */
const LEG_SAMPLES = [0, 2, 4, 5]
const TEX_W = 1024
const NEVER = 1e9
const MAX_SHIPS = 40
const MAX_RINGS = 480
/** Settlement marker radius range (CSS px before zoom scaling), as render/settlements.ts. */
const MIN_RADIUS = 1.7
const MAX_RADIUS = 6.5
const TOWN_MIN_RADIUS = 4.6
const CITY_MIN_RADIUS = 7.0

export const MarkKind = { Mart: 0, Industry: 1, Price: 2, Factory: 3, Fort: 4, Station: 5, Camp: 6, Deposit: 7, Rush: 8, Ship: 9, Ring: 10 } as const

export interface LongHaulShown {
  /** Lanes, relay legs and ships (the Long-distance trade toggle). */
  lanes: boolean
  /** Marts and trading posts (with the lanes). */
  marks: boolean
  /** Deposits and rushes. */
  deposits: boolean
  /** The Resources view: industry dots, larger deposits. */
  resources: boolean
  /** Price discs of class k (PRICE_INDEX_GOODS order), -1 off. */
  price: number
}

export interface LongHaulLayer {
  object: THREE.Group
  setShown(s: LongHaulShown): void
  setKnownMask(cellYear: Float32Array | null): void
  /** Draw order of the marks: over the clouds while a known world is shown. */
  setMasked(on: boolean): void
  /** What is highlighted: legs (bold), settlements (rings, sRGB per ring or one colour), cells (rings, e.g. a deposit). */
  setHighlight(legs: readonly number[], settlements: readonly number[], rgb: readonly (readonly [number, number, number])[], cells: readonly number[]): void
  /** Per frame: the year, the population snapshots and fraction, and an effect opacity (lower at high playback speed). */
  setTime(year: number, s0: number, s1: number, sFrac: number, effectAlpha: number): void
  update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** Up close the markers yield to the 3D towns: the rings follow (near, far camera distances; far <= 0 off). */
  setYield(near: number, far: number): void
  dispose(): void
}

/** Samples of a's paths, then b's (one geometry for the legs and the trails). */
function concatSamples(a: PathSamples, b: PathSamples): PathSamples {
  const na = a.offsets[a.count], nb = b.offsets[b.count]
  const count = a.count + b.count
  const offsets = new Uint32Array(count + 1)
  offsets.set(a.offsets.subarray(0, a.count))
  for (let i = 0; i <= b.count; i++) offsets[a.count + i] = na + b.offsets[i]
  const cat = <T extends Float32Array | Uint8Array>(x: T, y: T, n: number, m: number, k: number, make: (len: number) => T): T => {
    const out = make((n + m) * k)
    out.set(x.subarray(0, n * k))
    out.set(y.subarray(0, m * k), n * k)
    return out
  }
  const f32 = (len: number) => new Float32Array(len)
  const length = new Float32Array(count)
  length.set(a.length.subarray(0, a.count))
  length.set(b.length.subarray(0, b.count), a.count)
  return {
    count,
    offsets,
    pos: cat(a.pos, b.pos, na, nb, 3, f32),
    side: cat(a.side, b.side, na, nb, 3, f32),
    arc: cat(a.arc, b.arc, na, nb, 1, f32),
    frac: cat(a.frac, b.frac, na, nb, 1, f32),
    water: cat(a.water, b.water, na, nb, 1, (len) => new Uint8Array(len)),
    length,
  }
}

function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const LINE_VERT = /* glsl */ `
${RELIEF_GLSL}
attribute vec4 aSide; // side direction, across (-1|1)
attribute vec4 aInfo; // leg, kind (0 relay, 1 lane, 2 trail), arc length, fraction along
attribute vec2 aYears; // opened, closed (-1 open); a trail: set out, came home
uniform sampler2D uLeg;
uniform float uFrac;
uniform float uYear;
uniform float uLogMax;
uniform float uLaneLogMax;
uniform float uPixel;
uniform float uPixelRatio;
uniform float uClose;
uniform float uFar;
uniform float uDrop;
uniform float uRelay;
uniform float uLanes;
uniform vec3 uCamObj;
varying float vAcross;
varying float vSoft;
varying float vCore;
varying float vArcPx;
varying float vKind;
varying float vHl;
varying float vShow;
varying float vFacing;
varying float vS;
void main() {
  vec3 pR = ws_relief(position);
  int i = int(aInfo.x + 0.5);
  vec4 t = texelFetch(uLeg, ivec2(i - (i / ${TEX_W}) * ${TEX_W}, i / ${TEX_W}), 0);
  float v = mix(t.x, t.y, uFrac);
  float hl = t.z;
  float kind = aInfo.y;
  float s = v > 0.0 ? clamp(log(1.0 + v) / uLogMax, 0.0, 1.0) : 0.0;
  bool open = uYear >= aYears.x && (aYears.y < 0.0 || uYear < aYears.y);
  float show = 0.0;
  float core = 1.0;
  if (kind < 0.5) {
    show = open && v > 0.0 ? uRelay * mix(0.55, 1.0, s) : 0.0;
    if (hl > 0.5) show = open ? 1.0 : 0.0;
    core = (0.45 + 1.0 * s) * mix(1.0, 0.7, uFar) * (1.0 + 0.8 * hl);
  } else if (kind < 1.5) {
    // (lanes against the busiest lane: relay legs between marts carry far more)
    s = v > 0.0 ? clamp(log(1.0 + v) / uLaneLogMax, 0.0, 1.0) : 0.0;
    // drawn out from its home over its first two years; fainter and narrower the less it carries
    // (log volume against the busiest leg), capped at a few pixels, narrower zoomed out: the
    // lanes read as the long-distance network without burying the towns and names under them
    float grow = clamp((uYear - aYears.x) / 2.0, 0.0, 1.0);
    show = open && aInfo.w <= grow + 1e-4 ? uLanes * (hl > 0.5 ? 1.0 : mix(0.6, 1.0, s)) : 0.0;
    core = mix(1.3, 2.6, s) * mix(1.0, 0.75, uFar) * (1.0 + 0.5 * hl);
  } else {
    // the expedition that opened the lane: while the lane is selected, else fading for 40 years after it came home
    float after = uYear - aYears.y;
    float a = hl > 0.5 ? 1.0 : (after < 40.0 ? 1.0 - clamp(after / 40.0, 0.0, 1.0) : 0.0);
    float travelled = clamp((uYear - aYears.x) / max(aYears.y - aYears.x, 0.01), 0.0, 1.0);
    show = uYear >= aYears.x && aInfo.w <= travelled + 1e-4 ? a * uLanes : 0.0;
    core = 0.9 + 0.5 * hl;
  }
  if (show <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vShow = show;
  vS = s;
  vKind = kind;
  vHl = hl;
  core *= mix(0.5, 1.0, uClose);
  vec3 up = normalize(pR);
  vec3 base = pR - up * uDrop;
  vec4 mv = modelViewMatrix * vec4(ws_place(base), 1.0);
  float pix = -mv.z * uPixel * uPixelRatio;
  float outer = core + 0.8;
  vCore = core / outer;
  vSoft = 0.9 / outer;
  vAcross = aSide.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(base + aSide.xyz * aSide.w * outer * pix), 1.0);
  vFacing = ws_facing(dot(up, normalize(uCamObj - pR)));
  vArcPx = aInfo.z / max(pix / uPixelRatio, 1e-7);
}
`

const LINE_FRAG = /* glsl */ `
uniform float uYear;
uniform float uClose;
varying float vAcross;
varying float vSoft;
varying float vCore;
varying float vArcPx;
varying float vKind;
varying float vHl;
varying float vShow;
varying float vFacing;
varying float vS;
${SEAM_FRAG_GLSL}
void main() {
  ws_clipLine();
  float limb = smoothstep(0.0, 0.3, vFacing);
  float x = abs(vAcross);
  float coreMask = 1.0 - smoothstep(vCore - vSoft, vCore, x);
  float body = 1.0 - smoothstep(1.0 - vSoft, 1.0, x);
  vec3 col;
  float a;
  if (vKind < 0.5) {
    // a relay leg: a thin amber line with beads drifting along it
    float f = fract(vArcPx / 18.0 - uYear * 0.35);
    float bead = 1.0 - smoothstep(0.08, 0.2, abs(f - 0.5));
    col = mix(vec3(0.14, 0.08, 0.02), mix(vec3(0.96, 0.68, 0.32), vec3(1.0, 0.93, 0.7), bead), coreMask);
    a = body * mix(0.5, 0.95, coreMask);
    if (vHl > 0.5) col = mix(col, vec3(1.0, 0.97, 0.86), 0.35 * coreMask);
  } else if (vKind < 1.5) {
    // a lane: gold with a thin warm edge, a pale centre on the busy ones, a slow glint running out from its home
    float inner = 1.0 - smoothstep(0.0, vCore, x);
    float glint = smoothstep(0.86, 1.0, sin(vArcPx / 34.0 - uYear * 0.9)) * 0.25;
    vec3 gold = mix(vec3(0.98, 0.7, 0.22), vec3(1.0, 0.95, 0.8), smoothstep(0.3, 0.95, inner) * (0.35 + 0.55 * vS) + glint);
    col = mix(vec3(0.3, 0.17, 0.03), gold, coreMask);
    a = body * mix(0.55, 0.95, coreMask);
    if (vHl > 0.5) col = mix(col, vec3(1.0), 0.25 * coreMask);
  } else {
    // the opening expedition's trail: white-gold dots
    float f = fract(vArcPx / 7.0);
    float on = 1.0 - smoothstep(0.2, 0.34, abs(f - 0.5));
    col = mix(vec3(0.08, 0.06, 0.03), vec3(1.0, 0.95, 0.75), coreMask);
    a = body * on * mix(0.55, 1.0, coreMask);
  }
  a *= limb * vShow * mix(0.45, 1.0, uClose);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}
`

const MARK_VERT = /* glsl */ `
${RELIEF_GLSL}
${MARKER_SLOT_GLSL}
attribute vec3 aPos;
attribute vec4 aA; // kind, size (px), value at t0, value at t1
attribute vec4 aB; // per kind: deposit kind and spent year, industry bits, ship heading; marker radius at s0, s1 (zw)
attribute vec4 aC; // colour, unused
attribute vec2 aL; // shown from, until
attribute float aKnown;
uniform float uYear;
uniform float uFrac;
uniform float uSFrac;
uniform float uMaskOn;
uniform float uSizeScale;
uniform float uZoom;
uniform float uPostZoom;
uniform float uMarks;
uniform float uDeps;
uniform float uRes;
uniform float uPrice;
uniform float uShips;
uniform vec2 uYield;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform vec3 uCamObj;
uniform vec3 uSunObj;
uniform float uDaylight;
varying vec2 vPx;
flat varying float vKind;
varying float vSize;
varying float vInner;
varying float vAlpha;
varying float vV;
flat varying vec4 vB;
varying vec3 vCol;
varying float vSpent;
varying float vNight;
flat varying float vFlip;
void main() {
  vec3 pos = ws_relief(aPos);
  vec3 up = normalize(pos);
  float facing = ws_facing(dot(up, normalize(uCamObj - pos)));
  float kind = aA.x;
  float a0 = aA.z, a1 = aA.w;
  if (a0 < 0.0) a0 = a1;
  if (a1 < 0.0) a1 = a0;
  float v = mix(a0, a1, uFrac);
  bool alive = uYear >= aL.x && uYear < aL.y;
  if (uMaskOn > 0.5 && uYear < aKnown) alive = false;
  float show = 1.0;
  // marts: zoomed out to the globe or the whole map only the busiest show
  float martCut = mix(0.62, 0.0, smoothstep(0.25, 0.9, uZoom));
  if (kind < 0.5) show = uMarks * smoothstep(martCut, martCut + 0.1, v) * step(0.001, v);
  else if (kind < 1.5) show = uRes * step(0.5, aB.x);
  else if (kind < 2.5) show = uPrice * step(0.0, a0);
  else if (kind < 6.5) show = uMarks * uPostZoom;
  else if (kind < 8.5) show = uDeps;
  else if (kind < 9.5) show = uShips * v;
  if (!alive || facing <= 0.0 || show <= 0.003) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float yieldK = uYield.y > 0.0 ? 1.0 - smoothstep(uYield.x, uYield.y, length(uCamObj - pos)) : 0.0;
  // the settlement marker's radius here (as render/settlements.ts draws it)
  float inner = mix(aB.z, aB.w, uSFrac) * uSizeScale * mix(0.55, 1.0, sqrt(facing)) * mix(1.0, 0.55, yieldK);
  float size = aA.y * uSizeScale;
  float ext;
  vec2 off = vec2(0.0);
  if (kind < 2.5 || kind > 9.5) ext = inner + 10.0;
  else if (kind > 6.5 && kind < 7.5) {
    size = (3.2 + 4.6 * sqrt(clamp(v, 0.0, 1.0))) * uSizeScale * (uRes > 0.5 ? 1.7 : 1.0) * mix(0.75, 1.0, uZoom);
    if (uRes > 0.5) size = max(size, 6.0);
    ext = size + 3.0;
  } else if (kind > 7.5 && kind < 8.5) {
    size = 9.0 * uSizeScale;
    ext = size * 2.8 + 3.0;
  } else if (kind > 8.5) {
    // ships: a little smaller zoomed out, where a lane carries up to three
    size *= mix(0.75, 1.0, uZoom);
    ext = size + 3.0;
  }
  else {
    // posts: a factory's pennant beside its host's marker, a fort or station below its own (the
    // top is the capital's and the holy city's slot: markerSlots.ts)
    ext = size * 1.9 + 3.0;
    off = kind < 3.5 ? vec2(inner + size * 0.35, 0.0) : ws_slotAt(WS_SLOT_BELOW, inner, size * 0.75, uSizeScale);
  }
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(pos), 1.0);
  vFlip = 1.0;
  if (kind > 8.5 && kind < 9.5) {
    vec4 ahead = projectionMatrix * modelViewMatrix * vec4(ws_place(pos + aB.xyz * 0.01), 1.0);
    vec2 d = (ahead.xy / ahead.w - clip.xy / clip.w) * uViewport;
    vFlip = d.x < 0.0 ? -1.0 : 1.0;
  }
  vec2 offPx = position.xy * ext + off;
  clip.xy += offPx * uPixelRatio * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  vPx = position.xy * ext;
  vKind = kind;
  vSize = size;
  vInner = inner;
  vV = v;
  vB = aB;
  vCol = aC.rgb;
  vSpent = kind > 6.5 && kind < 7.5 && aB.y > 0.0 && uYear >= aB.y ? 1.0 : 0.0;
  vAlpha = show * smoothstep(0.0, 0.25, facing) * (kind > 2.5 && kind < 6.5 ? mix(1.0, 0.75, yieldK) : 1.0);
  vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
}
`

const MARK_FRAG = /* glsl */ `
uniform float uYear;
uniform float uZoomF;
uniform vec3 uInd[13];
varying vec2 vPx;
flat varying float vKind;
varying float vSize;
varying float vInner;
varying float vAlpha;
varying float vV;
flat varying vec4 vB;
varying vec3 vCol;
varying float vSpent;
varying float vNight;
flat varying float vFlip;
float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
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
// a filled glyph with an outline: premultiplied
vec4 glyph(float d, vec3 fillC, vec3 lineC, float outline) {
  float fill = 1.0 - smoothstep(-0.6, 0.6, d);
  float edge = 1.0 - smoothstep(-0.6, 0.6, d - outline);
  return vec4(mix(lineC, fillC, fill) * edge, edge);
}
vec4 over(vec4 a, vec4 b) { return vec4(a.rgb + b.rgb * (1.0 - a.a), a.a + b.a * (1.0 - a.a)); }
vec3 priceRamp(float t) {
  vec3 c0 = vec3(0.16, 0.62, 0.86), c1 = vec3(0.35, 0.86, 0.62), c2 = vec3(0.98, 0.86, 0.32), c3 = vec3(0.95, 0.42, 0.2), c4 = vec3(0.86, 0.14, 0.32);
  t = clamp(t, 0.0, 1.0) * 4.0;
  return t < 1.0 ? mix(c0, c1, t) : t < 2.0 ? mix(c1, c2, t - 1.0) : t < 3.0 ? mix(c2, c3, t - 2.0) : mix(c3, c4, t - 3.0);
}
void main() {
  vec2 p = vPx;
  float r = vSize;
  vec4 o = vec4(0.0);
  vec3 dark = vec3(0.07, 0.05, 0.03);
  int k = int(vKind + 0.5);
  if (k == 0) {
    // a mart: a gold ring round the marker, thicker the busier, doubled for the busiest from mid zoom
    // (zoomed out a thinner single ring, so the marts do not bury the towns and names around them)
    float R = vInner + 2.0;
    float w = (0.9 + 1.5 * vV) * mix(0.6, 1.0, uZoomF);
    float d = abs(length(p) - R - w * 0.5) - w * 0.5;
    o = glyph(d, vec3(1.0, 0.82, 0.36), dark, 0.9);
    if (vV > 0.55 && uZoomF > 0.5) {
      float d2 = abs(length(p) - (R + w + 2.2)) - 0.55;
      o = over(o, glyph(d2, vec3(1.0, 0.9, 0.58), dark, 0.7) * 0.9);
    }
  } else if (k == 1) {
    // industries: a dot per industry round the marker, from the top, clockwise
    int bits = int(vB.x + 0.5);
    float R = vInner + 4.6;
    float j = 0.0;
    for (int i = 0; i < 13; i++) {
      if (((bits >> i) & 1) == 0) continue;
      float ang = 1.5708 - j * 0.62;
      vec2 c = R * vec2(cos(ang), sin(ang));
      o = over(o, glyph(length(p - c) - 2.1, uInd[i], dark, 0.9));
      j += 1.0;
    }
  } else if (k == 2) {
    // a price disc over the trader's marker: blue cheap .. crimson dear
    float d = length(p) - (vInner + 1.8);
    o = glyph(d, priceRamp(vV), dark, 1.0);
  } else if (k == 3) {
    // a factory: a pennant in the owner's colour on a pole by the host's marker
    vec2 q = p + vec2(0.0, r * 0.9);
    float H = r * 1.7;
    float pole = sdSeg(q, vec2(0.0, 0.0), vec2(0.0, H));
    float flag = sdTri(q, vec2(0.0, H), vec2(0.0, H - r * 0.8), vec2(r * 1.15, H - r * 0.4));
    o = glyph(min(pole - 0.55, flag), vCol, dark, 1.0);
    o = over(glyph(pole - 0.5, vec3(0.94, 0.9, 0.82), dark, 0.0), o);
  } else if (k == 4) {
    // a fort post: a stone tower with merlons and a band in the owner's colour
    vec2 q = p;
    float body = sdBox(q - vec2(0.0, -0.15 * r), vec2(0.42 * r, 0.6 * r));
    float m = min(sdBox(q - vec2(-0.3 * r, 0.56 * r), vec2(0.12 * r, 0.15 * r)), min(sdBox(q - vec2(0.0, 0.56 * r), vec2(0.12 * r, 0.15 * r)), sdBox(q - vec2(0.3 * r, 0.56 * r), vec2(0.12 * r, 0.15 * r))));
    float d = min(body, m);
    vec3 stone = mix(vec3(0.6, 0.56, 0.5), vec3(0.88, 0.84, 0.76), smoothstep(-0.8 * r, 0.6 * r, q.y));
    float band = step(abs(q.y - 0.2 * r), 0.16 * r);
    o = glyph(d, mix(stone, vCol, band), dark, 1.0);
  } else if (k == 5) {
    // a victualling station: a beacon tower with a light, capped in the owner's colour
    vec2 q = p;
    float body = sdTri(q, vec2(-0.38 * r, -0.8 * r), vec2(0.38 * r, -0.8 * r), vec2(0.0, 0.5 * r));
    float capD = sdBox(q - vec2(0.0, 0.5 * r), vec2(0.28 * r, 0.14 * r));
    o = glyph(min(body, capD), mix(vec3(0.9, 0.86, 0.78), vCol, step(0.36 * r, q.y)), dark, 1.0);
    float halo = exp(-dot(q - vec2(0.0, 0.62 * r), q - vec2(0.0, 0.62 * r)) / (r * r * 0.25)) * 0.7;
    o = over(o, vec4(vec3(1.0, 0.88, 0.5) * halo, halo));
  } else if (k == 6) {
    // a mining camp: a tent in the owner's colour
    float d = sdTri(p, vec2(-0.7 * r, -0.6 * r), vec2(0.7 * r, -0.6 * r), vec2(0.0, 0.6 * r));
    o = glyph(d, vCol, dark, 1.0);
  } else if (k == 7) {
    // a deposit by kind
    int dk = int(vB.x + 0.5);
    float d;
    vec3 c;
    if (dk == 0) {
      // gold: a nugget
      d = min(min(length(p - vec2(-0.25 * r, -0.1 * r)) - 0.55 * r, length(p - vec2(0.3 * r, 0.05 * r)) - 0.5 * r), length(p - vec2(0.0, 0.3 * r)) - 0.42 * r);
      c = mix(vec3(0.85, 0.6, 0.12), vec3(1.0, 0.9, 0.45), smoothstep(-0.4 * r, 0.6 * r, p.y + p.x * 0.3));
    } else if (dk == 1) {
      // silver: an ingot
      d = sdBox(vec2(p.x + p.y * 0.25, p.y), vec2(0.72 * r, 0.36 * r)) - 0.1 * r;
      c = mix(vec3(0.62, 0.68, 0.76), vec3(0.95, 0.97, 1.0), smoothstep(-0.36 * r, 0.36 * r, p.y));
    } else if (dk == 2) {
      // gems: a cut stone
      float top = sdBox(p - vec2(0.0, 0.25 * r), vec2(0.62 * r, 0.22 * r));
      float bot = sdTri(p, vec2(-0.62 * r, 0.05 * r), vec2(0.62 * r, 0.05 * r), vec2(0.0, -0.75 * r));
      d = min(top, bot);
      c = mix(vec3(0.75, 0.08, 0.32), vec3(1.0, 0.55, 0.75), smoothstep(-0.5 * r, 0.5 * r, p.y - p.x * 0.5));
    } else if (dk == 3) {
      // amber: a drop
      d = min(length(p - vec2(0.0, -0.18 * r)) - 0.55 * r, sdTri(p, vec2(-0.48 * r, -0.05 * r), vec2(0.48 * r, -0.05 * r), vec2(0.0, 0.8 * r)));
      c = mix(vec3(0.78, 0.38, 0.05), vec3(1.0, 0.72, 0.25), smoothstep(-0.6 * r, 0.6 * r, p.y));
    } else if (dk == 4) {
      // pearls: a pearl on a blue ground
      d = length(p) - 0.62 * r;
      c = mix(vec3(0.8, 0.82, 0.86), vec3(1.0), smoothstep(0.6 * r, 0.0, length(p - vec2(-0.2 * r, 0.22 * r))));
      o = glyph(length(p) - 0.9 * r, vec3(0.12, 0.3, 0.55), dark, 0.0) * 0.8;
    } else if (dk == 5) {
      // murex: a purple shell
      d = min(length(p - vec2(0.0, 0.1 * r)) - 0.48 * r, sdTri(p, vec2(-0.3 * r, -0.1 * r), vec2(0.3 * r, -0.1 * r), vec2(0.12 * r, -0.85 * r)));
      c = mix(vec3(0.4, 0.1, 0.42), vec3(0.8, 0.45, 0.85), smoothstep(-0.6 * r, 0.6 * r, p.y));
      // its whorl
      c = mix(c, vec3(0.95, 0.8, 0.95), (1.0 - smoothstep(0.0, 0.9, abs(length(p - vec2(0.04 * r, 0.12 * r)) - 0.22 * r))) * 0.6);
    } else {
      // copper, tin, fine iron, kaolin: an ore lump
      d = sdBox(vec2(p.x * 0.9 + p.y * 0.2, p.y), vec2(0.55 * r, 0.42 * r)) - 0.12 * r;
      c = dk == 6 ? vec3(0.8, 0.45, 0.25) : dk == 7 ? vec3(0.7, 0.72, 0.68) : dk == 8 ? vec3(0.45, 0.47, 0.52) : vec3(0.92, 0.9, 0.84);
    }
    if (vSpent > 0.5) {
      float lum = dot(c, vec3(0.3, 0.55, 0.15));
      c = vec3(lum) * 0.55;
    }
    o = over(glyph(d, c, dark, 1.0), o);
    if (vSpent > 0.5) {
      // struck through
      float s = sdSeg(p, vec2(-0.85 * r, -0.65 * r), vec2(0.85 * r, 0.65 * r)) - 0.7;
      o = over(glyph(s, vec3(0.92, 0.3, 0.22), dark, 0.6), o);
    }
  } else if (k == 8) {
    // a rush: gold rings spreading from the deposit, three a few years apart
    for (int i = 0; i < 2; i++) {
      float ph = fract(uYear / 4.0 + float(i) * 0.5);
      float R = r * (0.6 + 1.9 * ph);
      float ring = 1.0 - smoothstep(0.4, 1.4, abs(length(p) - R));
      float a = ring * (1.0 - ph) * 0.9;
      o = over(o, vec4(vec3(1.0, 0.84, 0.4) * a, a));
    }
  } else if (k == 9) {
    vec2 q = vec2(p.x * vFlip, p.y);
    if (vB.w > 0.5) {
      // on land: a caravan wagon under a cream cover, two wheels
      float cover = sdBox(q - vec2(0.0, 0.05 * r), vec2(0.62 * r, 0.32 * r)) - 0.22 * r;
      float bed = sdBox(q - vec2(0.0, -0.36 * r), vec2(0.72 * r, 0.1 * r));
      float wheels = min(length(q - vec2(-0.42 * r, -0.56 * r)), length(q - vec2(0.42 * r, -0.56 * r))) - 0.2 * r;
      o = glyph(cover, vec3(1.0, 0.95, 0.8), vec3(0.42, 0.28, 0.06), 1.0);
      o = over(glyph(min(bed, wheels), vec3(0.25, 0.15, 0.07), vec3(1.0, 0.85, 0.45), 0.9), o);
    } else {
    // a lane ship: a dark hull under cream sails with a gold rim, facing the way it sails
    float hull = max(sdBox(q - vec2(0.0, -0.58 * r), vec2(0.7 * r, 0.17 * r)), -(q.y + 0.58 * r) - 0.12 * r * (1.0 - abs(q.x) / (0.7 * r)));
    float s1 = sdTri(q, vec2(0.06 * r, 0.92 * r), vec2(0.06 * r, -0.36 * r), vec2(0.66 * r, -0.36 * r));
    float s2 = sdTri(q, vec2(-0.18 * r, 0.8 * r), vec2(-0.18 * r, -0.36 * r), vec2(-0.66 * r, -0.36 * r));
    o = glyph(min(s1, s2), vec3(1.0, 0.96, 0.84), vec3(0.42, 0.28, 0.06), 1.0);
    o = over(glyph(hull, vec3(0.2, 0.12, 0.06), vec3(1.0, 0.85, 0.45), 0.9), o);
    }
  } else {
    // a highlight ring round a marker (or a deposit)
    float R = vInner + 5.0;
    float d = abs(length(p) - R) - 1.1;
    o = glyph(d, vCol, dark, 1.0);
  }
  o *= vAlpha * mix(1.0, 0.65, vNight);
  if (o.a < 0.004) discard;
  gl_FragColor = o;
}
`

export function buildLongHaulLayer(world: World, h: History, gd: GoodsData, maxPopulation: number): LongHaulLayer {
  const { positions: P } = world.grid
  const N = gd.N
  const object = new THREE.Group()
  object.name = 'long-haul trade'
  const LH = gd.legs
  const L = gd.L
  const TS = gd.TS

  // ---------- lines: legs, and the trails of the expeditions that opened lanes ----------
  const J = h.journeys
  const trails: number[] = []
  if (LH && J) for (const k of gd.lanes) if (gd.legJourney[k] >= 0) trails.push(k)
  const count = L + trails.length
  const offs = new Uint32Array(count + 1)
  let total = 0
  for (let k = 0; k < L; k++) total += LH!.pathOffsets[k + 1] - LH!.pathOffsets[k]
  for (const k of trails) {
    const j = gd.legJourney[k]
    total += J!.pathOffsets[j + 1] - J!.pathOffsets[j]
  }
  const path = new Uint32Array(total)
  let w = 0
  for (let k = 0; k < L; k++) {
    offs[k] = w
    path.set(LH!.path.subarray(LH!.pathOffsets[k], LH!.pathOffsets[k + 1]), w)
    w += LH!.pathOffsets[k + 1] - LH!.pathOffsets[k]
  }
  trails.forEach((k, i) => {
    const j = gd.legJourney[k]
    offs[L + i] = w
    path.set(J!.path.subarray(J!.pathOffsets[j], J!.pathOffsets[j + 1]), w)
    w += J!.pathOffsets[j + 1] - J!.pathOffsets[j]
  })
  offs[count] = w
  // legs along the bundled network (routeCurves.ts routeNetwork: sea runs snap onto lanes already
  // sailed, every shared link is one curve), so parallel lanes through a strait or along a coast
  // draw as one bundle that brightens with its members instead of a braid of ribbons; the opening
  // expeditions' trails on their own smoothed paths. The network smooths each
  // node over five cells (a lane crosses open sea in long straight runs), still from the leg's own
  // cells alone and checked against land and sea, so legs sharing a stretch share its curve.
  const legNet = routeNetwork(world, offs, path, L, 2)
  // (four of each piece's six samples are plenty at a lane's few pixels: fewer triangles; the same
  // four of every piece, so a shared piece stays one curve)
  const legSmp = networkRouteSamples(legNet, L, LIFT, LEG_SAMPLES)
  const trailOffs = new Uint32Array(trails.length + 1)
  for (let i = 0; i <= trails.length; i++) trailOffs[i] = offs[L + i] - offs[L]
  const smp = concatSamples(legSmp, smoothPaths(world, trailOffs, path.subarray(offs[L]), trails.length, LIFT))
  const nS = smp.offsets[count]
  let quads = 0
  for (let i = 0; i < count; i++) quads += Math.max(0, smp.offsets[i + 1] - smp.offsets[i] - 1)
  const lineGeom = new THREE.BufferGeometry()
  {
    const V = nS * 2
    const vPos = new Float32Array(V * 3), vSide = new Float32Array(V * 4), vInfo = new Float32Array(V * 4), vYears = new Float32Array(V * 2)
    for (let i = 0; i < count; i++) {
      const leg = i < L ? i : trails[i - L]
      const kind = i < L ? (LH!.kind[i] === LegKind.Lane ? 1 : 0) : 2
      const j = i < L ? -1 : gd.legJourney[leg]
      const y0 = i < L ? LH!.openedYear[leg] : J!.departYear[j]
      const y1 = i < L ? LH!.closedYear[leg] : J!.arriveYear[j]
      for (let s = smp.offsets[i]; s < smp.offsets[i + 1]; s++) {
        for (let side = 0; side < 2; side++) {
          const v = s * 2 + side
          vPos[v * 3] = smp.pos[s * 3]
          vPos[v * 3 + 1] = smp.pos[s * 3 + 1]
          vPos[v * 3 + 2] = smp.pos[s * 3 + 2]
          vSide[v * 4] = smp.side[s * 3]
          vSide[v * 4 + 1] = smp.side[s * 3 + 1]
          vSide[v * 4 + 2] = smp.side[s * 3 + 2]
          vSide[v * 4 + 3] = side === 0 ? -1 : 1
          vInfo[v * 4] = leg
          vInfo[v * 4 + 1] = kind
          vInfo[v * 4 + 2] = smp.arc[s]
          vInfo[v * 4 + 3] = smp.frac[s]
          vYears[v * 2] = y0
          vYears[v * 2 + 1] = y1
        }
      }
    }
    const idx = new Uint32Array(quads * 6)
    let q = 0
    for (let i = 0; i < count; i++) {
      for (let s = smp.offsets[i]; s + 1 < smp.offsets[i + 1]; s++) {
        const b = s * 2
        idx[q++] = b; idx[q++] = b + 2; idx[q++] = b + 1
        idx[q++] = b + 1; idx[q++] = b + 2; idx[q++] = b + 3
      }
    }
    lineGeom.setAttribute('position', new THREE.BufferAttribute(vPos, 3))
    lineGeom.setAttribute('aSide', new THREE.BufferAttribute(vSide, 4))
    lineGeom.setAttribute('aInfo', new THREE.BufferAttribute(vInfo, 4))
    lineGeom.setAttribute('aYears', new THREE.BufferAttribute(vYears, 2))
    lineGeom.setIndex(new THREE.BufferAttribute(idx, 1))
  }
  // the busiest lane's volume at any snapshot of the first 2000 years (as goodsData's legVolumeMax)
  let laneVolumeMax = 1
  if (gd.legVolume) {
    const tn = Math.min(TS, Math.floor(2000 / gd.TI) + 1)
    for (let q = 0; q < tn; q++) for (const k of gd.lanes) laneVolumeMax = Math.max(laneVolumeMax, gd.legVolume[q * L + k])
  }
  const texH = Math.max(1, Math.ceil(Math.max(1, L) / TEX_W))
  const legData = new Float32Array(TEX_W * texH * 4)
  const legTex = new THREE.DataTexture(legData, TEX_W, texH, THREE.RGBAFormat, THREE.FloatType)
  legTex.minFilter = legTex.magFilter = THREE.NearestFilter
  legTex.generateMipmaps = false
  legTex.needsUpdate = true
  const lu = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uLeg: { value: legTex },
    uFrac: { value: 0 },
    uYear: { value: 0 },
    uLogMax: { value: Math.log(1 + gd.legVolumeMax) },
    uLaneLogMax: { value: Math.log(1 + laneVolumeMax) },
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
    uClose: { value: 1 },
    uFar: { value: 0 },
    uDrop: { value: 0 },
    uRelay: { value: 1 },
    uLanes: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
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
  const lineMat = new THREE.ShaderMaterial({ uniforms: lu, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, ...blend, side: THREE.DoubleSide })
  const lines = new THREE.Mesh(lineGeom, lineMat)
  lines.frustumCulled = false
  lines.renderOrder = 6.56 // over the trade lines and the outlaw overlays, under the selected routes
  lines.name = 'long-haul legs'
  lines.visible = count > 0
  object.add(lines)

  // ---------- static marks ----------
  // radius of a settlement marker (CSS px before zoom scaling) at snapshot s, as render/settlements.ts
  const invMax = 1 / Math.max(1, maxPopulation)
  const radiusAt = (id: number, s: number) => {
    const pop = h.population[Math.max(0, Math.min(h.snapshotCount - 1, s)) * N + id] ?? 0
    let r0 = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(Math.min(1, Math.max(0, pop * invMax)))
    if (pop >= CITY_POPULATION) r0 = Math.max(r0, CITY_MIN_RADIUS)
    else if (pop >= TOWN_POPULATION) r0 = Math.max(r0, TOWN_MIN_RADIUS)
    return r0
  }
  const industrySet: number[] = []
  if (gd.industry) {
    const ever = new Uint8Array(N)
    for (let i = 0; i < TS * N; i++) if (gd.industry[i]) ever[i % N] = 1
    for (let i = 0; i < N; i++) if (ever[i]) industrySet.push(i)
  }
  const marts = gd.martSettlements, priced = gd.pricedSettlements
  const posts = gd.posts
  const D = gd.D
  const deposits = h.deposits
  const rushes: number[] = []
  for (let d = 0; d < D; d++) if (gd.rush[d]) rushes.push(d)
  const M0 = 0, I0 = M0 + marts.length, P0 = I0 + industrySet.length, F0 = P0 + priced.length, D0 = F0 + posts.length, R0 = D0 + D
  const nStatic = R0 + rushes.length
  const geom = new THREE.InstancedBufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
  geom.setIndex([0, 1, 2, 0, 2, 3])
  const cap = Math.max(1, nStatic)
  const mPos = new Float32Array(cap * 3), mA = new Float32Array(cap * 4), mB = new Float32Array(cap * 4), mC = new Float32Array(cap * 4), mL = new Float32Array(cap * 2), mKnown = new Float32Array(cap)
  const mCell = new Int32Array(cap).fill(-1)
  const mId = new Int32Array(cap).fill(-1) // settlement whose marker radius a ring follows
  const posAt = (arr: Float32Array, k: number, cell: number, lift: number) => {
    const r = surfaceRadius(world, cell) + lift
    arr[k * 3] = P[cell * 3] * r
    arr[k * 3 + 1] = P[cell * 3 + 1] * r
    arr[k * 3 + 2] = P[cell * 3 + 2] * r
  }
  const lifeOf = (k: number, id: number) => {
    const s = h.settlements[id]
    mL[k * 2] = s.foundedYear
    mL[k * 2 + 1] = s.abandonedYear >= 0 ? s.abandonedYear : NEVER
  }
  const atSettlement = (k: number, id: number, kind: number) => {
    const cell = h.settlements[id].cell
    posAt(mPos, k, cell, MARK_LIFT)
    mCell[k] = cell
    mId[k] = id
    mA[k * 4] = kind
    lifeOf(k, id)
  }
  marts.forEach((id, j) => atSettlement(M0 + j, id, MarkKind.Mart))
  industrySet.forEach((id, j) => atSettlement(I0 + j, id, MarkKind.Industry))
  priced.forEach((id, j) => atSettlement(P0 + j, id, MarkKind.Price))
  posts.forEach((x, j) => {
    const k = F0 + j
    const site = x.kind === PostKind.Factory ? x.host : x.settlement
    if (site < 0 || site >= N) {
      mL[k * 2] = NEVER
      mL[k * 2 + 1] = NEVER
      return
    }
    atSettlement(k, site, x.kind === PostKind.Factory ? MarkKind.Factory : x.kind === PostKind.Fort ? MarkKind.Fort : x.kind === PostKind.Station ? MarkKind.Station : MarkKind.Camp)
    mA[k * 4 + 1] = x.kind === PostKind.Factory ? 6.2 : 6.6
    mL[k * 2] = Math.max(mL[k * 2], x.foundedYear)
    mL[k * 2 + 1] = Math.min(mL[k * 2 + 1], x.endedYear >= 0 ? x.endedYear : NEVER)
    const c = ownerRgb(gd, x.owner, x.foundedYear)
    mC[k * 4] = c[0]
    mC[k * 4 + 1] = c[1]
    mC[k * 4 + 2] = c[2]
  })
  for (let d = 0; d < D; d++) {
    const k = D0 + d
    const x = deposits[d]
    posAt(mPos, k, x.cell, MARK_LIFT)
    mCell[k] = x.cell
    mA[k * 4] = MarkKind.Deposit
    mB[k * 4] = x.kind
    mB[k * 4 + 1] = x.exhaustedYear >= 0 ? x.exhaustedYear : 0
    mL[k * 2] = x.foundYear >= 0 ? x.foundYear : NEVER
    mL[k * 2 + 1] = NEVER
  }
  rushes.forEach((d, j) => {
    const k = R0 + j
    const x = deposits[d]
    posAt(mPos, k, x.cell, MARK_LIFT)
    mCell[k] = x.cell
    mA[k * 4] = MarkKind.Rush
    mL[k * 2] = gd.rush[d]!.start
    mL[k * 2 + 1] = gd.rush[d]!.end
  })
  const dyn = (a: Float32Array, n: number) => new THREE.InstancedBufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage)
  const aAttr = dyn(mA, 4), bAttr = dyn(mB, 4), knownAttr = dyn(mKnown, 1)
  geom.setAttribute('aPos', new THREE.InstancedBufferAttribute(mPos, 3))
  geom.setAttribute('aA', aAttr)
  geom.setAttribute('aB', bAttr)
  geom.setAttribute('aC', new THREE.InstancedBufferAttribute(mC, 4))
  geom.setAttribute('aL', new THREE.InstancedBufferAttribute(mL, 2))
  geom.setAttribute('aKnown', knownAttr)
  geom.instanceCount = nStatic

  // ---------- dynamic marks: ships and highlight rings ----------
  const dCap = MAX_SHIPS + MAX_RINGS
  const dGeom = new THREE.InstancedBufferGeometry()
  dGeom.setAttribute('position', geom.getAttribute('position'))
  dGeom.setIndex(geom.getIndex())
  const dPos = new Float32Array(dCap * 3), dA = new Float32Array(dCap * 4), dB = new Float32Array(dCap * 4), dC = new Float32Array(dCap * 4), dL = new Float32Array(dCap * 2), dKnown = new Float32Array(dCap)
  for (let k = 0; k < dCap; k++) {
    dA[k * 4] = k < MAX_SHIPS ? MarkKind.Ship : MarkKind.Ring
    dL[k * 2] = -NEVER
    dL[k * 2 + 1] = NEVER
  }
  const dPosAttr = dyn(dPos, 3), dAAttr = dyn(dA, 4), dBAttr = dyn(dB, 4), dCAttr = dyn(dC, 4), dKnownAttr = dyn(dKnown, 1)
  dGeom.setAttribute('aPos', dPosAttr)
  dGeom.setAttribute('aA', dAAttr)
  dGeom.setAttribute('aB', dBAttr)
  dGeom.setAttribute('aC', dCAttr)
  dGeom.setAttribute('aL', new THREE.InstancedBufferAttribute(dL, 2))
  dGeom.setAttribute('aKnown', dKnownAttr)
  dGeom.instanceCount = 0

  const ind = INDUSTRY_LIST.slice().sort((a, b) => a.bit - b.bit).map((x) => new THREE.Color(x.color))
  while (ind.length < 13) ind.push(new THREE.Color(1, 1, 1))
  const mu = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uYear: { value: 0 },
    uFrac: { value: 0 },
    uSFrac: { value: 0 },
    uMaskOn: { value: 0 },
    uSizeScale: { value: 1 },
    uZoom: { value: 1 },
    uZoomF: { value: 1 },
    uPostZoom: { value: 1 },
    uMarks: { value: 1 },
    uDeps: { value: 1 },
    uRes: { value: 0 },
    uPrice: { value: 0 },
    uShips: { value: 1 },
    uYield: { value: new THREE.Vector2(0, 0) },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uInd: { value: ind.map((c) => new THREE.Vector3(c.r, c.g, c.b)) },
  }
  const markMat = new THREE.ShaderMaterial({ uniforms: mu, vertexShader: MARK_VERT, fragmentShader: MARK_FRAG, ...blend, side: THREE.FrontSide })
  const marks = new THREE.Mesh(geom, markMat)
  marks.frustumCulled = false
  marks.renderOrder = 8.62 // over the settlement markers and structure icons (with the outlaw marks)
  marks.name = 'goods marks'
  marks.visible = nStatic > 0
  object.add(marks)
  const dmarks = new THREE.Mesh(dGeom, markMat)
  dmarks.frustumCulled = false
  dmarks.renderOrder = 8.64
  dmarks.name = 'lane ships and highlights'
  dmarks.visible = false
  object.add(dmarks)

  // per-class price scale: the cheapest and dearest byte over the first 2000 years
  const pMin = new Float32Array(5).fill(255), pMax = new Float32Array(5)
  if (gd.price) {
    const tn = Math.min(TS, Math.floor(2000 / gd.TI) + 1)
    for (let q = 0; q < tn; q++) for (const id of priced) for (let k = 0; k < 5; k++) {
      const b = gd.price[(q * N + id) * 5 + k]
      if (!b) continue
      if (b < pMin[k]) pMin[k] = b
      if (b > pMax[k]) pMax[k] = b
    }
  }
  // busyness of a mart: the long-haul volume at it, on a log scale against the busiest mart's
  const martVol = (id: number, t: number) => {
    let v = 0
    if (gd.legVolume) for (const k of gd.legsOf.get(id) ?? []) v += gd.legVolume[t * L + k]
    return v
  }
  let martMax = 1
  {
    const tn = Math.min(TS, Math.floor(2000 / gd.TI) + 1)
    for (let t = 0; t < tn; t += 5) for (const id of marts) martMax = Math.max(martMax, martVol(id, t))
  }
  const martLog = Math.log(1 + martMax)

  // ---------- ships: per lane, sailing out and back ----------
  const laneLen = new Float32Array(L)
  for (const k of gd.lanes) laneLen[k] = smp.length[k]
  const spacing = Math.sqrt((4 * Math.PI) / world.grid.cellCount)

  // ---------- state ----------
  let shown: LongHaulShown = { lanes: true, marks: true, deposits: true, resources: false, price: -1 }
  let knownMask: Float32Array | null = null
  let shownT0 = -1, shownT1 = -1, shownS0 = -1, shownS1 = -1, shownPrice = -2, shownShipYear = NaN
  let effect = 1
  let nShips = 0, nRings = 0
  let hlLegs: number[] = []
  let hlSett: number[] = []
  let hlRgb: (readonly [number, number, number])[] = []
  let hlCells: number[] = []
  let hlDirty = true
  const knownOf = (cell: number) => (knownMask && cell >= 0 ? (knownMask[cell] ?? NEVER) : 0)
  const tmpQ = new THREE.Quaternion()
  const camObj = new THREE.Vector3()

  function full(attr: THREE.BufferAttribute | THREE.InstancedBufferAttribute) {
    attr.clearUpdateRanges()
    attr.needsUpdate = true
  }

  function writeLegs(t0: number, t1: number) {
    legData.fill(0)
    if (gd.legVolume) {
      for (let k = 0; k < L; k++) {
        legData[k * 4] = gd.legVolume[t0 * L + k]
        legData[k * 4 + 1] = gd.legVolume[t1 * L + k]
      }
    }
    for (const k of hlLegs) if (k >= 0 && k < L) legData[k * 4 + 2] = 1
    legTex.needsUpdate = true
  }

  function writeValues(t0: number, t1: number) {
    // marts: busyness (0 when not a mart then)
    for (let j = 0; j < marts.length; j++) {
      const id = marts[j], k = M0 + j
      const m0 = gd.mart && gd.mart[t0 * N + id] ? 0.05 + 0.95 * Math.min(1, Math.log(1 + martVol(id, t0)) / martLog) : 0
      const m1 = gd.mart && gd.mart[t1 * N + id] ? 0.05 + 0.95 * Math.min(1, Math.log(1 + martVol(id, t1)) / martLog) : 0
      mA[k * 4 + 2] = m0
      mA[k * 4 + 3] = m1
    }
    // industries: the bits at the earlier snapshot
    if (gd.industry) for (let j = 0; j < industrySet.length; j++) mB[(I0 + j) * 4] = gd.industry[t0 * N + industrySet[j]]
    // deposits: output against the largest
    if (gd.output) for (let d = 0; d < D; d++) {
      mA[(D0 + d) * 4 + 2] = gd.output[t0 * D + d] / gd.outputMax
      mA[(D0 + d) * 4 + 3] = gd.output[t1 * D + d] / gd.outputMax
    }
    writePrices(t0, t1)
    full(aAttr)
    full(bAttr)
  }

  function writePrices(t0: number, t1: number) {
    const k = shown.price
    for (let j = 0; j < priced.length; j++) {
      const i = P0 + j
      if (k < 0 || !gd.price || pMax[k] <= pMin[k]) {
        mA[i * 4 + 2] = mA[i * 4 + 3] = -1
        continue
      }
      const id = priced[j]
      const b0 = gd.price[(t0 * N + id) * 5 + k], b1 = gd.price[(t1 * N + id) * 5 + k]
      mA[i * 4 + 2] = b0 ? (b0 - pMin[k]) / (pMax[k] - pMin[k]) : -1
      mA[i * 4 + 3] = b1 ? (b1 - pMin[k]) / (pMax[k] - pMin[k]) : -1
    }
    shownPrice = k
  }

  function writeRadii(s0: number, s1: number) {
    for (let k = 0; k < nStatic; k++) {
      const id = mId[k]
      if (id < 0) continue
      mB[k * 4 + 2] = radiusAt(id, s0)
      mB[k * 4 + 3] = radiusAt(id, s1)
    }
    full(bAttr)
  }

  function writeRings() {
    let n = 0
    const base = MAX_SHIPS
    const put = (cell: number, id: number, rgb: readonly [number, number, number]) => {
      if (n >= MAX_RINGS) return
      const i = base + n
      posAt(dPos, i, cell, MARK_LIFT)
      dB[i * 4 + 2] = id >= 0 ? radiusAt(id, shownS0) : 4
      dB[i * 4 + 3] = id >= 0 ? radiusAt(id, shownS1) : 4
      dC[i * 4] = rgb[0]
      dC[i * 4 + 1] = rgb[1]
      dC[i * 4 + 2] = rgb[2]
      dA[i * 4 + 1] = 1
      dKnown[i] = knownOf(cell)
      n++
    }
    hlSett.forEach((id, j) => {
      if (id >= 0 && id < N) put(h.settlements[id].cell, id, hlRgb[j] ?? hlRgb[0] ?? [1, 1, 1])
    })
    for (const c of hlCells) put(c, -1, [1, 0.95, 0.7])
    nRings = n
    full(dPosAttr)
    full(dBAttr)
    full(dCAttr)
    full(dKnownAttr)
    hlDirty = false
  }

  /** Point at fraction u along leg k's samples into dPos[i], heading into dB[i]. */
  function along(k: number, u: number, i: number) {
    const o0 = smp.offsets[k], o1 = smp.offsets[k + 1]
    let lo = o0, hi = o1 - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (smp.frac[m] <= u) lo = m
      else hi = m
    }
    const f0 = smp.frac[lo], f1 = smp.frac[hi]
    const t = f1 > f0 ? Math.min(1, Math.max(0, (u - f0) / (f1 - f0))) : 0
    for (let c = 0; c < 3; c++) {
      dPos[i * 3 + c] = smp.pos[lo * 3 + c] + (smp.pos[hi * 3 + c] - smp.pos[lo * 3 + c]) * t
      dB[i * 4 + c] = smp.pos[hi * 3 + c] - smp.pos[lo * 3 + c]
    }
    const len = Math.hypot(dB[i * 4], dB[i * 4 + 1], dB[i * 4 + 2]) || 1
    for (let c = 0; c < 3; c++) dB[i * 4 + c] /= len
    // a wagon on land, a ship at sea
    dB[i * 4 + 3] = (hi > lo ? segmentWater(smp.water, lo, t) : smp.water[lo]) ? 0 : 1
  }

  function writeShips(y: number) {
    let n = 0
    if (shown.lanes && effect > 0.3 && gd.legVolume) {
      for (const k of gd.lanes) {
        if (n >= MAX_SHIPS) break
        if (y < LH!.openedYear[k] + 1 || (LH!.closedYear[k] >= 0 && y >= LH!.closedYear[k])) continue
        const x = Math.min(Math.max(y / gd.TI, 0), TS - 1)
        const t0 = Math.floor(x), t1 = Math.min(t0 + 1, TS - 1)
        const v = gd.legVolume[t0 * L + k] * (1 - (x - t0)) + gd.legVolume[t1 * L + k] * (x - t0)
        if (!(v > 0.3)) continue
        const ships = 1 + (v > 15 ? 1 : 0) + (v > 80 ? 1 : 0)
        // a one-way passage takes a year or so per 12 cells, at least one year
        const oneWay = Math.max(1, laneLen[k] / spacing / 12)
        for (let s = 0; s < ships && n < MAX_SHIPS; s++) {
          const w2 = y / (2 * oneWay) + hash01(k, s)
          const c = Math.floor(w2)
          let u = (w2 - c) * 2
          const back = u > 1
          if (back) u = 2 - u
          const i = n
          along(k, u, i)
          if (back) for (let q = 0; q < 3; q++) dB[i * 4 + q] = -dB[i * 4 + q]
          dA[i * 4 + 1] = 9.5
          // fades in leaving port and out arriving
          dA[i * 4 + 2] = dA[i * 4 + 3] = Math.min(1, Math.min(u, 1 - u) * 10) * (effect >= 1 ? 1 : 0.75)
          dKnown[i] = knownOf(h.settlements[LH!.a[k]].cell)
          n++
        }
      }
    }
    for (let k = n; k < nShips; k++) dA[k * 4 + 2] = dA[k * 4 + 3] = 0
    nShips = n
    full(dPosAttr)
    full(dAAttr)
    full(dBAttr)
    full(dKnownAttr)
  }

  function syncVisibility() {
    lines.visible = count > 0 && (shown.lanes || hlLegs.length > 0)
    lu.uRelay.value = shown.lanes ? 1 : 0
    lu.uLanes.value = shown.lanes || hlLegs.length > 0 ? 1 : 0
    mu.uMarks.value = shown.marks ? 1 : 0
    mu.uDeps.value = shown.deposits || shown.resources ? 1 : 0
    mu.uRes.value = shown.resources ? 1 : 0
    mu.uPrice.value = shown.price >= 0 ? 1 : 0
    mu.uShips.value = shown.lanes ? 1 : 0
    marks.visible = nStatic > 0 && (shown.marks || shown.deposits || shown.resources || shown.price >= 0)
    dGeom.instanceCount = nRings > 0 ? MAX_SHIPS + nRings : nShips
    dmarks.visible = dGeom.instanceCount > 0
  }

  const api: LongHaulLayer = {
    object,
    setShown(s: LongHaulShown) {
      if (s.lanes === shown.lanes && s.marks === shown.marks && s.deposits === shown.deposits && s.resources === shown.resources && s.price === shown.price) return
      shown = { ...s }
      if (shownPrice !== s.price && shownT0 >= 0) {
        writePrices(shownT0, shownT1)
        full(aAttr)
      }
      shownShipYear = NaN
      syncVisibility()
      requestRender()
    },
    setKnownMask(cellYear: Float32Array | null) {
      knownMask = cellYear
      mu.uMaskOn.value = cellYear ? 1 : 0
      for (let k = 0; k < nStatic; k++) mKnown[k] = knownOf(mCell[k])
      full(knownAttr)
      hlDirty = true
      shownShipYear = NaN
      requestRender()
    },
    setMasked(on: boolean) {
      marks.renderOrder = on ? 9.78 : 8.62
      dmarks.renderOrder = on ? 9.79 : 8.64
    },
    setHighlight(legs, settlements, rgb, cells) {
      hlLegs = legs.slice()
      hlSett = settlements.slice()
      hlRgb = rgb.slice()
      hlCells = cells.slice()
      hlDirty = true
      if (shownT0 >= 0) writeLegs(shownT0, shownT1)
      syncVisibility()
      requestRender()
    },
    setYield(near: number, far: number) {
      mu.uYield.value.set(near, far)
    },
    setTime(y: number, s0: number, s1: number, sFrac: number, effectAlpha: number) {
      effect = effectAlpha
      mu.uYear.value = y
      lu.uYear.value = y
      mu.uSFrac.value = sFrac
      const x = Math.min(Math.max(y / gd.TI, 0), TS - 1)
      const t0 = Math.floor(x), t1 = Math.min(t0 + 1, TS - 1)
      const f = t1 === t0 ? 0 : x - t0
      lu.uFrac.value = f
      mu.uFrac.value = f
      if (t0 !== shownT0 || t1 !== shownT1) {
        shownT0 = t0
        shownT1 = t1
        writeLegs(t0, t1)
        writeValues(t0, t1)
        shownShipYear = NaN
      }
      if (s0 !== shownS0 || s1 !== shownS1) {
        shownS0 = s0
        shownS1 = s1
        writeRadii(s0, s1)
        hlDirty = true
      }
      if (hlDirty) writeRings()
      if (shown.lanes && y !== shownShipYear) {
        shownShipYear = y
        writeShips(y)
      } else if (!shown.lanes && nShips > 0) writeShips(y)
      syncVisibility()
    },
    update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number) {
      if (!lines.visible && !marks.visible && !dmarks.visible) return
      object.updateWorldMatrix(true, false)
      object.getWorldQuaternion(tmpQ).invert()
      mu.uSunObj.value.copy(SUN_DIRECTION).applyQuaternion(tmpQ)
      camera.getWorldPosition(camObj)
      object.worldToLocal(camObj)
      lu.uCamObj.value.copy(camObj)
      mu.uCamObj.value.copy(camObj)
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 42
      lu.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) / Math.max(1, drawSize.y)
      lu.uPixelRatio.value = pixelRatio
      mu.uViewport.value.copy(drawSize)
      mu.uPixelRatio.value = pixelRatio
      const dist = camObj.length()
      const alt = dist - 1
      const smooth = (a: number, b: number) => {
        const t = Math.min(1, Math.max(0, (dist - a) / (b - a)))
        return t * t * (3 - 2 * t)
      }
      lu.uClose.value = smooth(1.1, 1.35)
      lu.uFar.value = smooth(1.7, 3.0)
      lu.uDrop.value = LIFT * (1 - Math.min(1, Math.max(0.06, alt / 0.6)))
      // as the settlement markers (their rings must fit them)
      mu.uSizeScale.value = Math.min(1.5, Math.max(0.8, Math.sqrt(3.25 / Math.max(1e-3, (camera as THREE.PerspectiveCamera).position.length()))))
      mu.uZoom.value = 1 - smooth(1.6, 3.2)
      mu.uZoomF.value = mu.uZoom.value
      // posts show from mid zoom in
      mu.uPostZoom.value = 1 - smooth(2.3, 3.0)
    },
    dispose() {
      lineGeom.dispose()
      geom.dispose()
      dGeom.dispose()
      lineMat.dispose()
      markMat.dispose()
      legTex.dispose()
    },
  }
  return api
}
