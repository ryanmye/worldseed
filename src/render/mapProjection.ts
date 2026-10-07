// The flat map: one projection switch for every layer on the ground.
//
// Projection: Equal Earth (Šavrič, Patterson and Jenny 2018), an equal-area pseudocylindrical
// projection with a closed-form forward (a polynomial in the parametric latitude) and a
// one-dimensional Newton inverse. Areas are true (a faction's or a people's territory reads
// at its real size, which suits the political and population maps), the meridians bow gently
// and the poles are straight lines about 0.6 of the equator long, so high-latitude land keeps
// a readable shape instead of the equirectangular smear or the Mercator blow-up.
//
// Placement: the map lies in the plane tangent to the unit sphere at the map centre, in
// planet (object) space: map x along the centre's east, map y along its north, heights
// (radius - 1, compressed by MAP_Z) toward the camera. The centre is the point under the
// camera and the central meridian runs through it, so the camera stays where a globe camera
// would be (on the ray through the centre, at the same altitude): every layer's distance-
// and altitude-dependent logic works unchanged, the morph between globe and map needs no
// camera motion, and panning east-west scrolls the map endlessly (the central meridian
// follows the view). The antimeridian of the view (central meridian + 180) is the map's
// left and right edge.
//
// GLSL (appended to RELIEF_GLSL, so every layer's vertex shader has it):
//   ws_place(pR)   a point at the rendered relief (ws_relief) to where it is drawn now:
//                  pR itself on the globe (uFlat 0), the map point (uFlat 1), mixed in between
//   ws_placeV(pR)  the same for the final vertex of a line or ribbon, also writing the seam
//                  varying: its fragment shader calls ws_clipLine() (SEAM_FRAG_GLSL), which
//                  drops what crosses the antimeridian (lines break at the edge of the map)
//   ws_placeTri(pR, corners)  for the planet's own triangles (and the passes that redraw
//                  them): a triangle across the antimeridian is unwrapped onto one side and
//                  drawn a second time shifted a world over (a seam copy, seamCopy()), both
//                  clipped at the edge by ws_clipTri(); triangles around a pole are dropped
//                  and the map is clipped a little short of the poles
//   ws_facing(f)   a facing term (1 on the visible side) that is 1 everywhere on the map
// CPU twins: placeFlat (labels, pickers), mapRayHit (hover and sun drag), flatLam.

import * as THREE from 'three'
import type { World } from '../contract.ts'

const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796
const M = Math.sqrt(3) / 2
const XK = (2 * Math.sqrt(3)) / 3
/** Heights on the map, relative to the globe (the camera looks straight down: only depth order and a hint of parallax). */
export const MAP_Z = 0.3

/** Equal Earth forward: writes x, y of longitude lam, latitude phi (radians) into `out`. */
export function equalEarth(lam: number, phi: number, out: { x: number; y: number }): void {
  const th = Math.asin(M * Math.sin(phi))
  const t2 = th * th, t6 = t2 * t2 * t2
  out.y = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
  out.x = (XK * lam * Math.cos(th)) / (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))
}

/** Map y of latitude phi. */
export function equalEarthY(phi: number): number {
  const th = Math.asin(M * Math.sin(phi))
  const t2 = th * th, t6 = t2 * t2 * t2
  return th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
}

/** d(map x)/d(longitude) at latitude phi (the east-west scale of the map there). */
export function equalEarthKx(phi: number): number {
  const th = Math.asin(M * Math.sin(phi))
  const t2 = th * th, t6 = t2 * t2 * t2
  return (XK * Math.cos(th)) / (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))
}

/** Latitude of map y (Newton on the parametric latitude). */
export function equalEarthLat(y: number): number {
  const yy = Math.max(-Y_POLE, Math.min(Y_POLE, y))
  let th = yy / A1
  for (let i = 0; i < 6; i++) {
    const t2 = th * th, t6 = t2 * t2 * t2
    const f = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - yy
    const d = A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2)
    th -= f / d
  }
  return Math.asin(Math.max(-1, Math.min(1, Math.sin(th) / M)))
}

/** Equal Earth inverse: longitude and latitude of map (x, y); false outside the map. */
export function equalEarthInverse(x: number, y: number, out: { lam: number; phi: number }): boolean {
  if (Math.abs(y) > Y_POLE) return false
  let th = y / A1
  for (let i = 0; i < 6; i++) {
    const t2 = th * th, t6 = t2 * t2 * t2
    const f = th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2)) - y
    th -= f / (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))
  }
  const t2 = th * th, t6 = t2 * t2 * t2
  out.lam = (x * (A1 + 3 * A2 * t2 + t6 * (7 * A3 + 9 * A4 * t2))) / (XK * Math.cos(th))
  out.phi = Math.asin(Math.max(-1, Math.min(1, Math.sin(th) / M)))
  return Math.abs(out.lam) <= Math.PI
}

/** Map y of the poles, and half the map's width (at the equator). */
export const Y_POLE = equalEarthY(Math.PI / 2)
export const X_EDGE = (XK * Math.PI) / A1

/** The projection state (written by setFlatView, read by the CPU twins). */
export const flat = {
  /** 0 globe .. 1 map. */
  t: 0,
  /** Central meridian (planet longitude, atan2(x, z)) and latitude of the map centre. */
  lon0: 0,
  lat0: 0,
  /** Map y of the centre. */
  y0: 0,
  /** Latitude beyond which the map is clipped (just short of the poles: the pole cells' fans). */
  poleClip: Math.PI / 2 - 0.04,
  /** Bumped whenever the projection changes (layers that cache a layout redo it). */
  version: 0,
  /** Map frame in planet space: east, north, up at the centre. */
  e: new THREE.Vector3(1, 0, 0),
  n: new THREE.Vector3(0, 1, 0),
  u: new THREE.Vector3(0, 0, 1),
}

/** Shared uniforms: spread into every material on the ground (`...flatUniforms`, never cloned). */
export const flatUniforms = {
  uFlat: { value: 0 },
  uMapBasis: { value: new THREE.Matrix3() },
  /** Central meridian, map y of the centre, pole clip latitude. */
  uMapCentre: { value: new THREE.Vector3(0, 0, Math.PI / 2 - 0.04) },
  /** 1 while a seam copy draws (seamCopy). */
  uSeamCopy: { value: 0 },
  /** Unit direction of every cell (cellDirTexture), for ws_placeTri. */
  uWsCellDir: { value: null as THREE.Texture | null },
}

export const DIR_TEX_W = 512

/** True while the map (or the morph to it) shows. */
export function flatActive(): boolean {
  return flat.t > 0
}

/**
 * Sets the morph amount and the map centre (a unit direction in planet space, the point under
 * the camera). Cheap; bumps flat.version only when something changed.
 */
export function setFlatView(t: number, cx: number, cy: number, cz: number): void {
  const l = Math.hypot(cx, cy, cz) || 1
  const lat = Math.asin(Math.max(-1, Math.min(1, cy / l)))
  const lon = Math.abs(cx) + Math.abs(cz) < 1e-12 ? flat.lon0 : Math.atan2(cx, cz)
  if (t === flat.t && lon === flat.lon0 && lat === flat.lat0) return
  flat.t = t
  flat.lon0 = lon
  flat.lat0 = lat
  flat.y0 = equalEarthY(lat)
  const sl = Math.sin(lon), cl = Math.cos(lon), sp = Math.sin(lat), cp = Math.cos(lat)
  flat.e.set(cl, 0, -sl)
  flat.n.set(-sp * sl, cp, -sp * cl)
  flat.u.set(cp * sl, sp, cp * cl)
  const e = flat.e, n = flat.n, u = flat.u
  flatUniforms.uMapBasis.value.set(e.x, n.x, u.x, e.y, n.y, u.y, e.z, n.z, u.z)
  flatUniforms.uMapCentre.value.set(lon, flat.y0, flat.poleClip)
  flatUniforms.uFlat.value = t
  flat.version++
}

/** Wrapped longitude from the central meridian, in (-pi, pi], of planet-space point (x, y, z). */
export function flatLam(x: number, z: number): number {
  let l = (Math.abs(x) + Math.abs(z) < 1e-12 ? 0 : Math.atan2(x, z)) - flat.lon0
  l -= 2 * Math.PI * Math.floor((l + Math.PI) / (2 * Math.PI))
  return l
}

const ee = { x: 0, y: 0 }
/**
 * CPU twin of ws_place: moves a planet-space point at the rendered relief to where it is
 * drawn (in place). No-op on the globe.
 */
export function placeFlat(v: THREE.Vector3): THREE.Vector3 {
  const t = flat.t
  if (t <= 0) return v
  const r = v.length() || 1
  const phi = Math.asin(Math.max(-1, Math.min(1, v.y / r)))
  equalEarth(flatLam(v.x, v.z), Math.max(-flat.poleClip, Math.min(flat.poleClip, phi)), ee)
  const mx = ee.x, my = ee.y - flat.y0, mz = 1 + (r - 1) * MAP_Z
  const px = flat.e.x * mx + flat.n.x * my + flat.u.x * mz
  const py = flat.e.y * mx + flat.n.y * my + flat.u.y * mz
  const pz = flat.e.z * mx + flat.n.z * my + flat.u.z * mz
  return v.set(v.x + (px - v.x) * t, v.y + (py - v.y) * t, v.z + (pz - v.z) * t)
}

/** A facing term on the map (CPU twin of ws_facing). */
export function flatFacing(f: number): number {
  return f + (1 - f) * flat.t
}

const hitTmp = new THREE.Vector3()
const inv = { lam: 0, phi: 0 }
/**
 * The ground under a ray in planet space on the (fully flat) map: writes the unit direction
 * on the sphere into `out`; false off the map or during the morph.
 */
export function mapRayHit(ray: THREE.Ray, out: THREE.Vector3): boolean {
  if (flat.t < 1) return false
  const u = flat.u
  const den = ray.direction.dot(u)
  if (Math.abs(den) < 1e-9) return false
  // the plane through the centre (sea level) facing the camera
  const s = (1 - ray.origin.dot(u)) / den
  if (s <= 0) return false
  ray.at(s, hitTmp)
  const mx = hitTmp.dot(flat.e)
  const my = hitTmp.dot(flat.n) + flat.y0
  if (!equalEarthInverse(mx, my, inv) || Math.abs(inv.phi) > flat.poleClip) return false
  const lon = flat.lon0 + inv.lam
  const cp = Math.cos(inv.phi)
  out.set(cp * Math.sin(lon), Math.sin(inv.phi), cp * Math.cos(lon))
  return true
}

const dirTextures = new WeakMap<World, THREE.DataTexture>()
/** Unit direction of every cell (RGBA float, DIR_TEX_W wide), cached per world; also sets the pole clip for its cell size. */
export function cellDirTexture(world: World): THREE.DataTexture {
  const N = world.grid.cellCount
  // the pole cells' fans reach about one cell spacing from the pole: clip the map just past them
  flat.poleClip = Math.PI / 2 - 1.6 * Math.sqrt((4 * Math.PI) / N)
  flatUniforms.uMapCentre.value.z = flat.poleClip
  let tex = dirTextures.get(world)
  if (tex) return tex
  const P = world.grid.positions
  const h = Math.ceil(N / DIR_TEX_W)
  const data = new Float32Array(DIR_TEX_W * h * 4)
  for (let i = 0; i < N; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]
    const l = Math.hypot(x, y, z) || 1
    data[i * 4] = x / l
    data[i * 4 + 1] = y / l
    data[i * 4 + 2] = z / l
  }
  tex = new THREE.DataTexture(data, DIR_TEX_W, h, THREE.RGBAFormat, THREE.FloatType)
  tex.minFilter = tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  dirTextures.set(world, tex)
  return tex
}

/**
 * A second draw of `mesh` (same geometry and material, a child of it) for the triangles that
 * cross the antimeridian on the map (ws_placeTri draws them shifted a world over). Shown only
 * while the map is (syncSeamCopies, once per frame); the shader collapses every other triangle.
 */
export function seamCopy(mesh: THREE.Mesh): THREE.Mesh {
  const copy = new THREE.Mesh(mesh.geometry, mesh.material)
  copy.name = `${mesh.name || 'mesh'} (seam copy)`
  copy.frustumCulled = false
  copy.visible = false
  copy.userData.wsSeamCopy = true
  copy.renderOrder = mesh.renderOrder
  copy.onBeforeRender = (_r, _s, _c, _g, material) => {
    flatUniforms.uSeamCopy.value = 1
    ;(material as THREE.ShaderMaterial).uniformsNeedUpdate = true
  }
  copy.onAfterRender = (_r, _s, _c, _g, material) => {
    flatUniforms.uSeamCopy.value = 0
    ;(material as THREE.ShaderMaterial).uniformsNeedUpdate = true
  }
  mesh.add(copy)
  return copy
}

/**
 * Per frame, before drawing (no allocation): the seam copies follow their mesh (material,
 * draw order, geometry range) and show only on the map; on the map every visible object
 * under `root` skips frustum culling (bounding volumes are spheres around the globe, while the
 * map spreads far beyond them); back on the globe the culling flags are restored.
 */
export function syncSeamCopies(root: THREE.Object3D): void {
  const on = flat.t > 0
  if (!on && !culledOff) return
  visit(root, on)
  culledOff = on
}
let culledOff = false
function visit(o: THREE.Object3D, on: boolean): void {
  const ch = o.children
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i]
    if (c.userData.wsSeamCopy === true) {
      const m = c as THREE.Mesh
      const p = o as THREE.Mesh
      m.visible = on
      m.material = p.material
      m.renderOrder = p.renderOrder
      continue
    }
    if (on) {
      if (c.userData.wsCulled === undefined) c.userData.wsCulled = c.frustumCulled
      c.frustumCulled = false
    } else if (c.userData.wsCulled !== undefined) {
      c.frustumCulled = c.userData.wsCulled as boolean
      delete c.userData.wsCulled
    }
    if (c.visible || !on) visit(c, on)
  }
}

/** GLSL appended to RELIEF_GLSL (vertex and fragment shaders alike; see the header). */
export const MAP_GLSL = /* glsl */ `
uniform float uFlat;
uniform mat3 uMapBasis;
uniform vec3 uMapCentre;
uniform float uSeamCopy;
uniform sampler2D uWsCellDir;
const float WS_PI = 3.14159265;
const float WS_TAU = 6.28318531;
float ws_lam(vec3 d) {
  float l = (abs(d.x) + abs(d.z) < 1e-9 ? 0.0 : atan(d.x, d.z)) - uMapCentre.x;
  return l - WS_TAU * floor((l + WS_PI) / WS_TAU);
}
vec2 ws_equalEarth(float lam, float phi) {
  float th = asin(${M.toFixed(7)} * sin(phi));
  float t2 = th * th, t6 = t2 * t2 * t2;
  float y = th * (${A1} + ${A2} * t2 + t6 * (${A3} + ${A4} * t2));
  float x = ${XK.toFixed(7)} * lam * cos(th) / (${A1} + ${(3 * A2).toFixed(6)} * t2 + t6 * (${(7 * A3).toFixed(6)} + ${(9 * A4).toFixed(6)} * t2));
  return vec2(x, y);
}
// the map point of pR (rendered relief) at map longitude lam; latitudes up to phiMax
vec3 ws_mapAt(vec3 pR, float lam, float phiMax) {
  float r = length(pR);
  vec2 m = ws_equalEarth(lam, clamp(asin(clamp(pR.y / r, -1.0, 1.0)), -phiMax, phiMax));
  return uMapBasis * vec3(m.x, m.y - uMapCentre.y, 1.0 + (r - 1.0) * ${MAP_Z.toFixed(3)});
}
vec3 ws_mapAt(vec3 pR, float lam) {
  return ws_mapAt(pR, lam, 2.0);
}
// (points and lines past the clip latitude sit on the map's top or bottom edge)
vec3 ws_place(vec3 pR) {
  if (uFlat <= 0.0) return pR;
  return mix(pR, ws_mapAt(pR, ws_lam(pR), uMapCentre.z), uFlat);
}
float ws_facing(float f) {
  return uFlat <= 0.0 ? f : mix(f, 1.0, uFlat);
}
#ifdef attribute
// (vertex shaders only: three.js defines "attribute" there)
varying vec4 ws_vSeam;
vec3 ws_placeV(vec3 pR) {
  if (uFlat <= 0.0) {
    ws_vSeam = vec4(1.0, 0.0, 0.0, 0.0);
    return pR;
  }
  float l = ws_lam(pR);
  ws_vSeam = vec4(cos(l), sin(l), l, 0.0);
  return mix(pR, ws_mapAt(pR, l, uMapCentre.z), uFlat);
}
float ws_cull;
vec3 ws_dirOf(float c) {
  int i = int(c + 0.5);
  return texelFetch(uWsCellDir, ivec2(i % ${DIR_TEX_W}, i / ${DIR_TEX_W}), 0).xyz;
}
// a planet triangle with corner cells "corners": unwrapped across the antimeridian (the seam
// copy draws it a world over), ws_cull = 1 when this draw has nothing of it to show
vec3 ws_placeTri(vec3 pR, vec3 corners) {
  ws_cull = 0.0;
  if (uFlat <= 0.0) {
    ws_vSeam = vec4(0.0);
    ws_cull = uSeamCopy;
    return pR;
  }
  float r = length(pR);
  float phi = asin(clamp(pR.y / r, -1.0, 1.0));
  float lv = ws_lam(pR);
  // far from the antimeridian and the poles no triangle can cross: the vertex alone decides
  // (a planet triangle spans well under 0.3 of longitude below 80 degrees of latitude)
  if (abs(lv) < WS_PI - 0.3 && abs(phi) < 1.4) {
    ws_cull = uSeamCopy;
    ws_vSeam = vec4(0.0, 0.0, lv, phi);
    return mix(pR, ws_mapAt(pR, lv), uFlat);
  }
  vec3 d0 = ws_dirOf(corners.x), d1 = ws_dirOf(corners.y), d2 = ws_dirOf(corners.z);
  bool p0 = abs(d0.x) + abs(d0.z) < 1e-6, p1 = abs(d1.x) + abs(d1.z) < 1e-6, p2 = abs(d2.x) + abs(d2.z) < 1e-6;
  float l0 = ws_lam(d0), l1 = ws_lam(d1), l2 = ws_lam(d2);
  // a pole corner takes the longitude of the next corner
  if (p0) l0 = l1;
  if (p1) l1 = l2;
  if (p2) l2 = l0;
  l1 += WS_TAU * floor((l0 - l1) / WS_TAU + 0.5);
  l2 += WS_TAU * floor((l0 - l2) / WS_TAU + 0.5);
  float lo = min(l0, min(l1, l2)), hi = max(l0, max(l1, l2));
  // around a pole: beyond the clip latitude anyway
  if (hi - lo > WS_PI) ws_cull = 1.0;
  if (abs(pR.x) + abs(pR.z) < 1e-6 * r) lv = p0 ? l0 : p1 ? l1 : l2;
  lv += WS_TAU * floor((l0 - lv) / WS_TAU + 0.5);
  if (uSeamCopy > 0.5) {
    if (hi > WS_PI) lv -= WS_TAU;
    else if (lo < -WS_PI) lv += WS_TAU;
    else ws_cull = 1.0;
  }
  ws_vSeam = vec4(0.0, 0.0, lv, phi);
  return mix(pR, ws_mapAt(pR, lv), uFlat);
}
#endif
`

/**
 * Fragment side (after SEAM_FRAG_GLSL, which declares uMapCentre): the map-plane position (Equal Earth, before the view's
 * basis; map units are world units on the map) of a planet direction d, for a pattern that should keep a steady screen scale
 * on the map (a pattern phased on the sphere is stretched by the projection there, and by a different amount everywhere).
 */
export const MAP_XY_FRAG_GLSL = /* glsl */ `
vec2 ws_mapXY(vec3 d) {
  d = normalize(d);
  float l = (abs(d.x) + abs(d.z) < 1e-9 ? 0.0 : atan(d.x, d.z)) - uMapCentre.x;
  l -= 6.28318531 * floor((l + 3.14159265) / 6.28318531);
  float th = asin(${M.toFixed(7)} * clamp(d.y, -1.0, 1.0));
  float t2 = th * th, t6 = t2 * t2 * t2;
  float y = th * (${A1} + ${A2} * t2 + t6 * (${A3} + ${A4} * t2));
  float x = ${XK.toFixed(7)} * l * cos(th) / (${A1} + ${(3 * A2).toFixed(6)} * t2 + t6 * (${(7 * A3).toFixed(6)} + ${(9 * A4).toFixed(6)} * t2));
  return vec2(x, y);
}
`

/** Fragment side of the seam for shaders that already include RELIEF_GLSL (the planet). */
export const SEAM_FRAG_BODY_GLSL = /* glsl */ `
varying vec4 ws_vSeam;
// a line or ribbon across the antimeridian: its interpolated longitude disagrees with the
// longitude of its interpolated direction (they agree to ~1e-4 along any ordinary segment)
void ws_clipLine() {
  if (uFlat > 0.0 && abs(atan(ws_vSeam.y, ws_vSeam.x) - ws_vSeam.z) > 0.012) discard;
}
// a planet triangle (ws_placeTri): past the map's edge, or past the clip latitude near the poles
void ws_clipTri() {
  if (uFlat > 0.0) {
    if (abs(ws_vSeam.z) > 3.14159265) discard;
    if (abs(ws_vSeam.w) > mix(2.0, uMapCentre.z, smoothstep(0.7, 1.0, uFlat))) discard;
  }
}
`

/**
 * Fragment side of the seam: include once in a layer's fragment shader and call ws_clipLine()
 * (or ws_clipTri()) first thing in main(); also declares uFlat (1 on the map) for limb fades.
 */
export const SEAM_FRAG_GLSL = /* glsl */ `
uniform float uFlat;
uniform vec3 uMapCentre;
${SEAM_FRAG_BODY_GLSL}
`
