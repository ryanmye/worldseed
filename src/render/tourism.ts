// Leisure travel on the map (data from ui/tourismData.ts). Everything drawn is a pure function of the
// year: scrubbing back shows what a direct load shows.
//
//  - Marks (one instanced draw of static instances):
//      sights, from the year they were recognised, as a small glyph over the place in a colour of
//      their kind (broken columns for ruins, a crown for an old capital, a flagged peak for a summit
//      first climbed, a snowflake for an old polar base, crossed tools for a mining town gone quiet, a
//      faded parasol for a resort long out of fashion, a four-point star for a holy city), a little
//      larger the more famous;
//      visited places, a ring of pink dots round the settlement marker, wider with its visitors a
//      year (larger, brighter dots while in fashion; it fades out as they stop coming);
//      resort towns, a striped parasol over the marker: bright pink while in fashion, muted out of
//      it, a faint grey outline once given up.
//  - Flows (one draw of one ribbon geometry): from home town to the place visited along the pair's
//    path, for pairs that ever carry PAIR_MIN visitors a year or more, while they carry SHOW_MIN or
//    more: a faint pink track with beads running toward the place, wider with the visitors (unlike
//    trade's cyan sea dashes and warm land lines and the solid kind-coloured disease links).
//  - Per frame nothing is uploaded: a float texture holds each destination's visitors, fashion and
//    marker radius and each drawn pair's visitors at the two trade snapshots around the year; it is
//    rewritten only when that pair of snapshots changes, and the shaders interpolate.
//  - Activity: the years in which anything is drawn are known per history (merged spans): before
//    the first sight or visitor neither draw is made, and the flows only while a pair is busy.
//  - Known world: marks in cells not yet known are hidden; the flows lie under the mist.

import * as THREE from 'three'
import type { History, World } from '../contract.ts'
import { CITY_POPULATION, TOWN_POPULATION } from '../contract.ts'
import { SUN_DIRECTION, surfaceRadius } from './globe.ts'
import { RELIEF_GLSL, reliefUniforms } from './terrainHeight.ts'
import { flatUniforms, SEAM_FRAG_GLSL } from './mapProjection.ts'
import { sunUniforms } from './sun.ts'
import { smoothPaths } from './routeCurves.ts'
import { requestRender } from './invalidate.ts'
import { inFashion, SIGHT_RGB, snapPair, TRAVEL_RGB, type TourismData } from '../ui/tourismData.ts'

const LIFT = 0.0034
const MARK_LIFT = 0.0047
const NEVER = 1e9
/** Settlement marker radius range (CSS px before zoom scaling), as render/settlements.ts. */
const MIN_RADIUS = 1.7
const MAX_RADIUS = 6.5
const TOWN_MIN_RADIUS = 4.6
const CITY_MIN_RADIUS = 7.0
/** A pair is drawn if it ever carries this many visitors a year; it shows while it carries SHOW_MIN or more. */
export const PAIR_MIN = 12
export const SHOW_MIN = 8
const TEX_W = 256
const DEST_KIND = 8

export interface TourismLayer {
  object: THREE.Group
  /** The Travel layer toggle. */
  setShown(on: boolean): void
  setKnownMask(cellYear: Float32Array | null): void
  /** Draw order of the marks: over the clouds while a known world is shown. */
  setMasked(on: boolean): void
  /** Highlight the flows of a settlement (as home town or place visited); -1 none. */
  setSelected(id: number): void
  /** Per frame: the year, and an effect strength (lower at high playback speed: the beads blur into a line). */
  setTime(year: number, effect: number): void
  update(camera: THREE.Camera, drawSize: THREE.Vector2, pixelRatio: number): void
  /** Up close the markers yield to the 3D towns: the marks follow (near, far camera distances; far <= 0 off). */
  setYield(near: number, far: number): void
  /** Whether either draw is on this frame. */
  readonly active: boolean
  /** Pairs with geometry (for measurement). */
  readonly pairsDrawn: number
  dispose(): void
}

const TEX_GLSL = /* glsl */ `
uniform sampler2D uVis;
vec4 ws_item(float item, float texel) {
  int i = int(item + 0.5) * 2 + int(texel);
  return texelFetch(uVis, ivec2(i - (i / ${TEX_W}) * ${TEX_W}, i / ${TEX_W}), 0);
}
`

const MARK_VERT = /* glsl */ `
${RELIEF_GLSL}
${TEX_GLSL}
attribute vec3 aPos;
attribute vec4 aA; // from year, until year (NEVER), kind (0..6 a sight, 8 a destination), item (destinations: texture item)
attribute vec4 aB; // static marker radius (px), fame 0..1, flags (1 resort), resort founded year
attribute vec2 aC; // resort given up (year, NEVER), settlement id
attribute float aKnown;
uniform float uYear;
uniform float uFrac;
uniform float uMaskOn;
uniform float uSizeScale;
uniform float uSel;
uniform vec2 uYield;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform vec3 uCamObj;
uniform vec3 uSunObj;
uniform float uDaylight;
uniform vec3 uSightRgb[7];
varying vec2 vPx;
flat varying float vKind;
varying float vScale;
varying float vRing;
varying float vRingA;
varying float vResort;
varying float vFashion;
varying float vSel;
varying float vAlpha;
varying vec3 vCol;
varying float vNight;
varying vec2 vParasol;
void main() {
  vec3 pos = ws_relief(aPos);
  vec3 up = normalize(pos);
  float facing = ws_facing(dot(up, normalize(uCamObj - pos)));
  float kind = aA.z;
  bool hidden = uMaskOn > 0.5 && uYear < aKnown;
  float show = uYear >= aA.x && uYear < aA.y ? 1.0 : 0.0;
  float inner = aB.x;
  float vis = 0.0, fashion = 0.0, resort = 0.0;
  if (kind > 7.5) {
    vec4 t0 = ws_item(aA.w, 0.0);
    vec4 t1 = ws_item(aA.w, 1.0);
    vis = mix(t0.x, t0.y, uFrac);
    fashion = mix(t0.z, t0.w, uFrac);
    inner = max(mix(t1.x, t1.y, uFrac), ${MIN_RADIUS.toFixed(1)});
    bool isResort = mod(aB.z, 2.0) > 0.5 && uYear >= aB.w;
    resort = isResort ? (uYear >= aC.x ? 2.0 : 1.0) : 0.0;
    float ringA = smoothstep(0.3, 3.0, vis);
    show *= max(ringA, resort > 0.5 ? 1.0 : 0.0);
    vRingA = ringA;
  } else vRingA = 0.0;
  if (hidden || facing <= 0.0 || show <= 0.003) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float yieldK = uYield.y > 0.0 ? 1.0 - smoothstep(uYield.x, uYield.y, length(uCamObj - pos)) : 0.0;
  float s = uSizeScale * mix(0.6, 1.0, sqrt(facing)) * mix(1.0, 0.6, yieldK);
  inner *= s;
  float ring = inner * 1.25 + (2.4 + 2.3 * sqrt(max(vis, 0.0) / 10.0)) * s;
  ring = min(ring, inner * 1.25 + 26.0 * s);
  float scale = kind > 7.5 ? s : s * (0.85 + 0.5 * aB.y);
  // a sight's glyph sits over the place (a quarantine flag takes the upper right); a resort's parasol up and to the left
  // (clear of a town's or city's outer rings: about 1.4 times its marker radius)
  vec2 glyphOff = kind > 7.5 ? vec2(-(inner * 1.25 + 3.5 * s), inner * 1.25 + 4.0 * s) : (inner > 2.0 * s ? vec2(0.0, inner * 1.45 + 5.5 * scale) : vec2(0.0));
  float ext = kind > 7.5 ? max(ring + 3.0, length(glyphOff) + 9.0 * s) : 8.0 * scale;
  vec2 centre = kind > 7.5 ? vec2(0.0) : glyphOff;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(ws_place(pos), 1.0);
  clip.xy += (position.xy * ext + centre) * uPixelRatio * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  vPx = position.xy * ext;
  vKind = kind;
  vScale = scale;
  vRing = ring;
  vResort = resort;
  vFashion = fashion;
  vParasol = glyphOff;
  vSel = uSel >= 0.0 && abs(aC.y - uSel) < 0.5 ? 1.0 : 0.0;
  vCol = kind > 7.5 ? vec3(${TRAVEL_RGB.map((x) => x.toFixed(3)).join(', ')}) : uSightRgb[int(clamp(kind, 0.0, 6.0) + 0.5)];
  vAlpha = smoothstep(0.0, 0.25, facing);
  vNight = 1.0 - smoothstep(-0.15, 0.1, mix(dot(up, normalize(uSunObj)), 1.0, uDaylight));
}
`

const MARK_FRAG = /* glsl */ `
varying vec2 vPx;
flat varying float vKind;
varying float vScale;
varying float vRing;
varying float vRingA;
varying float vResort;
varying float vFashion;
varying float vSel;
varying float vAlpha;
varying vec3 vCol;
varying float vNight;
varying vec2 vParasol;
float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// a closed polygon of n <= 8 vertices (signed: negative inside)
float sdPoly(vec2 p, vec2 v[8], int n) {
  float d = dot(p - v[0], p - v[0]);
  float s = 1.0;
  for (int i = 0, j = n - 1; i < n; j = i, i++) {
    vec2 e = v[j] - v[i];
    vec2 w = p - v[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= v[i].y, p.y < v[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
  }
  return s * sqrt(d);
}
vec4 glyph(float d, vec3 fillC, vec3 lineC, float outline) {
  float fill = 1.0 - smoothstep(-0.6, 0.6, d);
  float edge = 1.0 - smoothstep(-0.6, 0.6, d - outline);
  return vec4(mix(lineC, fillC, fill) * edge, edge);
}
vec4 over(vec4 a, vec4 b) { return vec4(a.rgb + b.rgb * (1.0 - a.a), a.a + b.a * (1.0 - a.a)); }
// a parasol: a striped canopy over a pole (p in glyph px, unit size 1)
float parasolD(vec2 p) {
  vec2 c = vec2(0.0, 0.2);
  float canopy = max(length(p - c) - 4.6, -(p.y - c.y));
  // scalloped rim
  canopy = max(canopy, -(length(vec2(mod(p.x + 4.6, 3.07) - 1.535, p.y - c.y + 0.1)) - 0.95));
  float pole = sdSeg(p, vec2(0.0, 0.2), vec2(0.0, -4.4)) - 0.55;
  float hook = abs(length(p - vec2(-0.9, -4.4)) - 0.9) - 0.45;
  hook = max(hook, p.y + 4.4);
  return min(min(canopy, pole), hook);
}
float sightD(float kind, vec2 p) {
  vec2 v[8];
  if (kind < 0.5) {
    // ruins: two columns, one broken, a lintel fragment, a base
    float a = sdBox(p - vec2(-2.3, -0.2), vec2(1.05, 3.4));
    float b = sdBox(p - vec2(1.9, -1.6), vec2(1.05, 2.0));
    float l = sdBox(p - vec2(-1.3, 3.6), vec2(2.4, 0.7));
    float base = sdBox(p - vec2(0.0, -4.2), vec2(4.4, 0.75));
    return min(min(a, b), min(l, base));
  }
  if (kind < 1.5) {
    // an old capital: a crown
    v[0] = vec2(-4.6, -3.4); v[1] = vec2(4.6, -3.4); v[2] = vec2(4.8, 2.8); v[3] = vec2(2.4, 0.1);
    v[4] = vec2(0.0, 3.9); v[5] = vec2(-2.4, 0.1); v[6] = vec2(-4.8, 2.8); v[7] = v[6];
    return sdPoly(p, v, 7);
  }
  if (kind < 2.5) {
    // a summit first climbed: a peak with a flag
    v[0] = vec2(-5.2, -3.8); v[1] = vec2(5.2, -3.8); v[2] = vec2(0.0, 3.4);
    v[3] = v[2]; v[4] = v[2]; v[5] = v[2]; v[6] = v[2]; v[7] = v[2];
    float peak = sdPoly(p, v, 3);
    float pole = sdSeg(p, vec2(0.0, 3.0), vec2(0.0, 6.6)) - 0.45;
    float flag = sdBox(p - vec2(1.5, 5.7), vec2(1.5, 0.95));
    return min(peak, min(pole, flag));
  }
  if (kind < 3.5) {
    // an old polar base: a snowflake
    float d = sdSeg(p, vec2(0.0, -4.6), vec2(0.0, 4.6));
    d = min(d, sdSeg(p, vec2(-4.0, -2.3), vec2(4.0, 2.3)));
    d = min(d, sdSeg(p, vec2(-4.0, 2.3), vec2(4.0, -2.3)));
    return d - 0.85;
  }
  if (kind < 4.5) {
    // a mining town gone quiet: crossed pick and hammer
    float handles = min(sdSeg(p, vec2(-3.6, -4.0), vec2(3.0, 3.0)), sdSeg(p, vec2(3.6, -4.0), vec2(-3.0, 3.0))) - 0.7;
    float pick = sdSeg(p, vec2(1.0, 4.6), vec2(4.8, 1.0)) - 0.8;
    float head = sdBox(p - vec2(-3.1, 3.1), vec2(1.7, 1.0));
    return min(handles, min(pick, head));
  }
  if (kind < 5.5) return parasolD(p);
  // a holy city: a four-point star
  v[0] = vec2(0.0, 5.2); v[1] = vec2(1.25, 1.25); v[2] = vec2(5.2, 0.0); v[3] = vec2(1.25, -1.25);
  v[4] = vec2(0.0, -5.2); v[5] = vec2(-1.25, -1.25); v[6] = vec2(-5.2, 0.0); v[7] = vec2(-1.25, 1.25);
  return sdPoly(p, v, 8);
}
void main() {
  vec2 p = vPx;
  vec3 dark = vec3(0.06, 0.03, 0.06);
  vec4 o = vec4(0.0);
  if (vKind > 7.5) {
    float d = length(p);
    // visited: a ring of dots round the marker, a faint wash inside
    if (vRingA > 0.0) {
      float circ = 6.2831853 * vRing;
      float n = max(6.0, floor(circ / (4.6 * vScale)));
      float a = atan(p.y, p.x);
      float k = floor(a / 6.2831853 * n + 0.5);
      float ak = k * 6.2831853 / n;
      vec2 c = vRing * vec2(cos(ak), sin(ak));
      // (a place in fashion: larger, brighter dots and a warmer wash)
      float dd = length(p - c) - (1.1 + 0.25 * vFashion) * max(vScale, 0.8);
      vec4 dots = glyph(dd, mix(vCol, vec3(1.0), 0.2 + 0.3 * vSel + 0.15 * vFashion), dark, 0.75);
      float wash = (1.0 - smoothstep(vRing - 1.5, vRing, d)) * (0.06 + 0.06 * vFashion) * vRingA;
      o = over(dots * vRingA * mix(0.85, 1.0, max(vFashion, vSel)), vec4(vCol * wash, wash));
    }
    // a resort: a striped parasol (bright in fashion, muted out of it, a grey outline once given up)
    if (vResort > 0.5) {
      vec2 q = (p - vParasol) / max(vScale, 0.5);
      float pd = parasolD(q) * max(vScale, 0.5);
      if (vResort > 1.5) {
        o = over(glyph(abs(pd) - 0.35, vec3(0.62, 0.6, 0.62), dark, 0.0) * 0.55, o);
      } else {
        float stripe = step(0.5, fract(atan(q.y - 0.2, q.x) / 3.14159 * 3.0));
        vec3 a = mix(vec3(0.62, 0.48, 0.56), vCol, vFashion);
        vec3 b = mix(vec3(0.82, 0.8, 0.78), vec3(1.0), vFashion);
        vec3 fillC = q.y > 0.2 ? mix(a, b, stripe) : vec3(0.92, 0.9, 0.86);
        o = over(glyph(pd, fillC, dark, 0.9) * mix(0.78, 1.0, vFashion), o);
      }
    }
  } else {
    vec2 q = p / max(vScale, 0.5);
    float d = sightD(vKind, q) * max(vScale, 0.5);
    vec3 fillC = vKind > 4.5 && vKind < 5.5 ? mix(vCol, vec3(1.0), step(0.5, fract(atan(q.y - 0.2, q.x) / 3.14159 * 3.0)) * 0.5) : vCol;
    o = glyph(d, fillC, dark, 1.0);
    if (vKind > 4.5 && vKind < 5.5) o *= 0.8; // faded
  }
  o *= vAlpha * mix(1.0, 0.7, vNight);
  if (o.a < 0.004) discard;
  gl_FragColor = o;
}
`

const LINE_VERT = /* glsl */ `
${RELIEF_GLSL}
${TEX_GLSL}
attribute vec4 aSide; // side direction, across (-1|1)
attribute vec4 aInfo; // texture item, fraction along, arc length from home, from settlement
attribute float aTo; // settlement visited
uniform float uFrac;
uniform float uSel;
uniform float uSelOn;
uniform float uPixel;
uniform float uPixelRatio;
uniform float uClose;
uniform float uDrop;
uniform vec3 uCamObj;
varying float vAcross;
varying float vSoft;
varying float vCore;
varying float vArcPx;
varying float vShow;
varying float vFacing;
varying float vSel;
varying float vOuterPx;
void main() {
  vec3 pR = ws_relief(position);
  vec4 t = ws_item(aInfo.x, 0.0);
  float vis = mix(t.x, t.y, uFrac);
  float show = smoothstep(${(SHOW_MIN * 0.6).toFixed(2)}, ${(SHOW_MIN * 1.4).toFixed(2)}, vis);
  bool sel = uSel >= 0.0 && (abs(aInfo.w - uSel) < 0.5 || abs(aTo - uSel) < 0.5);
  if (sel) show = max(show, vis > 0.2 ? 0.85 : 0.0);
  else if (uSelOn > 0.5) show *= 0.4;
  if (show <= 0.003) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vShow = show;
  vSel = sel ? 1.0 : 0.0;
  float core = 0.55 + 0.55 * min(2.2, sqrt(max(vis, 0.0) / 12.0));
  core *= mix(0.7, 1.0, uClose) * (sel ? 1.2 : 1.0);
  vec3 up = normalize(pR);
  vec3 base = pR - up * uDrop;
  vec4 mv = modelViewMatrix * vec4(ws_place(base), 1.0);
  float pix = -mv.z * uPixel * uPixelRatio;
  float outer = core + 0.9;
  vCore = core / outer;
  vSoft = 0.9 / outer;
  vAcross = aSide.w;
  vOuterPx = outer;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(ws_placeV(base + aSide.xyz * aSide.w * outer * pix), 1.0);
  vFacing = ws_facing(dot(up, normalize(uCamObj - pR)));
  vArcPx = aInfo.z / max(pix / uPixelRatio, 1e-7);
}
`

const LINE_FRAG = /* glsl */ `
uniform float uYear;
uniform float uFx;
varying float vAcross;
varying float vSoft;
varying float vCore;
varying float vArcPx;
varying float vShow;
varying float vFacing;
varying float vSel;
varying float vOuterPx;
${SEAM_FRAG_GLSL}
void main() {
  ws_clipLine();
  float limb = smoothstep(0.0, 0.3, vFacing);
  float x = abs(vAcross);
  float coreMask = 1.0 - smoothstep(vCore - vSoft, vCore, x);
  float body = 1.0 - smoothstep(1.0 - vSoft, 1.0, x);
  // round beads (the travellers) running from the home town toward the place visited, a quarter
  // spacing a year, over a faint track; at high playback speed they blur into the track
  const float SPACING = 11.0;
  float along = (fract(vArcPx / SPACING - uYear * 0.25) - 0.5) * SPACING;
  float r = vOuterPx * 0.95;
  float bd = length(vec2(along, vAcross * vOuterPx));
  float bead = 1.0 - smoothstep(r - 0.7, r + 0.4, bd);
  float beadCore = 1.0 - smoothstep(r - 1.5, r - 0.6, bd);
  bead = mix(0.5, bead, uFx);
  vec3 pink = vec3(${TRAVEL_RGB.map((x) => x.toFixed(3)).join(', ')});
  vec3 light = mix(pink, vec3(1.0), 0.15 + 0.25 * vSel);
  float track = (0.2 + 0.12 * vSel) * coreMask;
  vec3 col = mix(vec3(0.07, 0.03, 0.06), light, max(beadCore * uFx, 1.0 - uFx * 0.5) );
  float a = max(bead, track * body) * vShow * limb;
  col = mix(light, col, bead);
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

export function buildTourismLayer(world: World, h: History, td: TourismData, maxPopulation: number): TourismLayer {
  const { positions: P, cellCount } = world.grid
  const N = td.N
  const Q = td.Q
  const I = td.interval
  const F = td.F
  const object = new THREE.Group()
  object.name = 'tourism'

  // radius of a settlement marker (CSS px before zoom scaling) at a year, as render/settlements.ts
  const invMax = 1 / Math.max(1, maxPopulation)
  const radiusAt = (id: number, year: number) => {
    if (id < 0 || id >= N) return 0
    const s = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(year / h.snapshotInterval)))
    const pop = h.population[s * N + id] ?? 0
    if (!(pop > 0)) return 0
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

  // ---------- marks: sights, then destinations ----------
  const S = td.sights.length
  const D = td.D
  const nM = S + D
  const cap = Math.max(1, nM)
  const mPos = new Float32Array(cap * 3), mA = new Float32Array(cap * 4), mB = new Float32Array(cap * 4), mC = new Float32Array(cap * 2), mKnown = new Float32Array(cap)
  const mCell = new Int32Array(cap).fill(-1)
  const markIv: number[] = []
  for (let k = 0; k < S; k++) {
    const x = td.sights[k]
    const cell = x.cell >= 0 && x.cell < cellCount ? x.cell : -1
    if (cell < 0) {
      mA[k * 4] = NEVER
      mA[k * 4 + 1] = NEVER
      continue
    }
    posAt(mPos, k, cell, MARK_LIFT)
    mCell[k] = cell
    mA[k * 4] = x.fromYear
    mA[k * 4 + 1] = NEVER
    mA[k * 4 + 2] = x.kind
    mA[k * 4 + 3] = -1
    // beside the marker of a living place on its cell (the host if it stands there, else its own settlement)
    const host = td.sightHost[k]
    const on = host >= 0 && h.settlements[host].cell === cell ? host : x.settlement
    mB[k * 4] = on >= 0 && (h.settlements[on].abandonedYear < 0 || h.settlements[on].abandonedYear > x.fromYear) ? radiusAt(on, x.fromYear) : 0
    mB[k * 4 + 1] = Math.max(0, Math.min(1, x.fame))
    mC[k * 2] = NEVER
    mC[k * 2 + 1] = on
    markIv.push(x.fromYear, NEVER)
  }
  for (let d = 0; d < D; d++) {
    const k = S + d
    const id = td.dests[d]
    const cell = h.settlements[id].cell
    posAt(mPos, k, cell, MARK_LIFT)
    mCell[k] = cell
    // from a snapshot before its first visitors (or its founding as a resort)
    let first = -1
    for (let q = 0; q < Q && first < 0; q++) if (td.destVis[d * Q + q] > 0) first = q
    const r = td.resortOf.get(id)
    const from = Math.min(first >= 0 ? (first - 1) * I : NEVER, r ? r.founded : NEVER)
    let last = -1
    for (let q = Q - 1; q >= 0 && last < 0; q--) if (td.destVis[d * Q + q] > 0) last = q
    mA[k * 4] = from
    // a resort's mark stays (faint once given up); a visited place's ring goes when the visitors stop
    mA[k * 4 + 1] = r ? NEVER : last >= 0 ? (last + 1) * I : from
    mA[k * 4 + 2] = DEST_KIND
    mA[k * 4 + 3] = d
    mB[k * 4] = 0
    mB[k * 4 + 2] = r ? 1 : 0
    mB[k * 4 + 3] = r ? r.founded : NEVER
    mC[k * 2] = r && r.abandoned >= 0 ? r.abandoned : NEVER
    mC[k * 2 + 1] = id
    markIv.push(from, mA[k * 4 + 1])
  }
  const markSpans = mergeSpans(markIv)
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

  // ---------- flows: the pairs that ever carry PAIR_MIN visitors a year ----------
  const pairItem = new Int32Array(F.count).fill(-1)
  const drawn: number[] = []
  const lOffs: number[] = [0]
  const lPath: number[] = []
  for (let k = 0; k < F.count; k++) {
    if (td.pairPeak[k] < PAIR_MIN) continue
    const a = F.from[k], b = F.to[k]
    if (a < 0 || a >= N || b < 0 || b >= N) continue
    const ca = h.settlements[a].cell, cb = h.settlements[b].cell
    if (ca === cb) continue
    const lo = F.pathOffsets[k], hi = F.pathOffsets[k + 1]
    const cells: number[] = []
    if (hi - lo >= 2) for (let q = lo; q < hi; q++) cells.push(F.path[q])
    else cells.push(ca, cb)
    if (cells[0] !== ca) cells.unshift(ca)
    if (cells[cells.length - 1] !== cb) cells.push(cb)
    if (cells.some((c) => !(c >= 0 && c < cellCount))) continue
    pairItem[k] = D + drawn.length
    drawn.push(k)
    for (const c of cells) lPath.push(c)
    lOffs.push(lPath.length)
  }
  const nL = drawn.length
  const flowIv: number[] = []
  for (let r = 0; r < F.rowCount; r++) {
    const k = F.rowPair[r]
    if (pairItem[k] < 0 || F.visitors[r] < SHOW_MIN * 0.6) continue
    const y = F.rowSnapshot[r] * I
    flowIv.push(y - I, y + I)
  }
  const flowSpans = mergeSpans(flowIv)
  const lineGeom = new THREE.BufferGeometry()
  if (nL > 0) {
    const smp = smoothPaths(world, Uint32Array.from(lOffs), Uint32Array.from(lPath), nL, LIFT)
    const nS = smp.offsets[nL]
    let quads = 0
    for (let l = 0; l < nL; l++) quads += Math.max(0, smp.offsets[l + 1] - smp.offsets[l] - 1)
    const V = nS * 2
    const vPos = new Float32Array(V * 3), vSide = new Float32Array(V * 4), vInfo = new Float32Array(V * 4), vTo = new Float32Array(V)
    for (let l = 0; l < nL; l++) {
      const k = drawn[l]
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
          vInfo[v * 4] = pairItem[k]
          vInfo[v * 4 + 1] = smp.frac[s]
          vInfo[v * 4 + 2] = smp.arc[s]
          vInfo[v * 4 + 3] = F.from[k]
          vTo[v] = F.to[k]
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
    lineGeom.setAttribute('aTo', new THREE.BufferAttribute(vTo, 1))
    lineGeom.setIndex(new THREE.BufferAttribute(idx, 1))
  }

  // ---------- the texture: per destination (vis q0, q1, fashion q0, q1), (radius q0, q1); per drawn pair (vis q0, q1) ----------
  const items = D + nL
  const texH = Math.max(1, Math.ceil((Math.max(1, items) * 2) / TEX_W))
  const texData = new Float32Array(TEX_W * texH * 4)
  const visTex = new THREE.DataTexture(texData, TEX_W, texH, THREE.RGBAFormat, THREE.FloatType)
  visTex.minFilter = visTex.magFilter = THREE.NearestFilter
  visTex.generateMipmaps = false
  visTex.needsUpdate = true
  let texQ0 = -1, texQ1 = -1
  const writeSnapshots = (q0: number, q1: number) => {
    texData.fill(0)
    const y0 = q0 * I, y1 = q1 * I
    for (let d = 0; d < D; d++) {
      const id = td.dests[d]
      const o = d * 8
      texData[o] = td.destVis[d * Q + q0]
      texData[o + 1] = td.destVis[d * Q + q1]
      texData[o + 2] = inFashion(td, id, y0) ? 1 : 0
      texData[o + 3] = inFashion(td, id, y1) ? 1 : 0
      texData[o + 4] = radiusAt(id, y0)
      texData[o + 5] = radiusAt(id, y1)
    }
    for (let c = 0; c < 2; c++) {
      const q = c === 0 ? q0 : q1
      for (let r = td.qOff[q]; r < td.qOff[q + 1]; r++) {
        const it = pairItem[F.rowPair[r]]
        if (it >= 0) texData[it * 8 + c] = F.visitors[r]
      }
    }
    visTex.needsUpdate = true
  }

  const sightRgb = SIGHT_RGB.map((c) => new THREE.Vector3(c[0], c[1], c[2]))
  const mu = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uVis: { value: visTex },
    uYear: { value: 0 },
    uFrac: { value: 0 },
    uMaskOn: { value: 0 },
    uSizeScale: { value: 1 },
    uSel: { value: -1 },
    uYield: { value: new THREE.Vector2(0, 0) },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
    uSunObj: { value: SUN_DIRECTION.clone() },
    uDaylight: sunUniforms.uDaylight,
    uSightRgb: { value: sightRgb },
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
  marks.renderOrder = 8.64 // over the settlement markers and structure icons, under the disease marks
  marks.name = 'tourism marks'
  marks.visible = false
  object.add(marks)

  const lu = {
    uReliefK: reliefUniforms.uReliefK,
    ...flatUniforms,
    uVis: mu.uVis,
    uYear: mu.uYear,
    uFrac: mu.uFrac,
    uFx: { value: 1 },
    uSel: mu.uSel,
    uSelOn: { value: 0 },
    uPixel: { value: 0.001 },
    uPixelRatio: { value: 1 },
    uClose: { value: 1 },
    uDrop: { value: 0 },
    uCamObj: { value: new THREE.Vector3(0, 0, 3) },
  }
  const lineMat = new THREE.ShaderMaterial({ uniforms: lu, vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, ...blend, side: THREE.DoubleSide })
  const lines = new THREE.Mesh(lineGeom, lineMat)
  lines.frustumCulled = false
  lines.renderOrder = 6.57 // over the trade lines and long-haul legs, under the disease links and the known-world mist
  lines.name = 'tourism flows'
  lines.visible = false
  object.add(lines)

  // ---------- state ----------
  let shown = true
  let knownMask: Float32Array | null = null
  let marksOn = false, linksOn = false
  const pair = { q0: 0, q1: 0, frac: 0 }
  const tmpQ = new THREE.Quaternion()
  const camObj = new THREE.Vector3()
  const knownOf = (cell: number) => (knownMask && cell >= 0 ? (knownMask[cell] ?? NEVER) : 0)
  const syncVisible = () => {
    marks.visible = shown && nM > 0 && marksOn
    lines.visible = shown && nL > 0 && linksOn
  }

  const api: TourismLayer = {
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
      marks.renderOrder = on ? 9.76 : 8.64
    },
    setSelected(id: number) {
      const v = id >= 0 && id < N ? id : -1
      mu.uSel.value = v
      lu.uSelOn.value = v >= 0 && (td.isHome[v] === 1 || td.destOf[v] >= 0) ? 1 : 0
      requestRender()
    },
    setTime(year: number, effect: number) {
      snapPair(td, year, pair)
      if (pair.q0 !== texQ0 || pair.q1 !== texQ1) {
        texQ0 = pair.q0
        texQ1 = pair.q1
        writeSnapshots(pair.q0, pair.q1)
      }
      mu.uYear.value = year
      mu.uFrac.value = pair.frac
      lu.uFx.value = effect
      marksOn = inSpans(markSpans, year)
      linksOn = inSpans(flowSpans, year)
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
    },
    setYield(near: number, far: number) {
      mu.uYield.value.set(near, far)
    },
    get active() {
      return marks.visible || lines.visible
    },
    get pairsDrawn() {
      return nL
    },
    dispose() {
      geom.dispose()
      lineGeom.dispose()
      markMat.dispose()
      lineMat.dispose()
      visTex.dispose()
    },
  }
  return api
}
