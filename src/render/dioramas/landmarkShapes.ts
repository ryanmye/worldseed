// Generated low-poly geometry of the landmarks (History.landmarks): the houses of worship in
// each building tradition (contract LandmarkForm, a great and a lesser size each), the great
// secular buildings (keeps and citadels, palaces, market halls, guildhalls, lighthouses,
// libraries, monuments, mausoleums, baths, council houses), a construction scaffold and a
// monastery's cloister. Same conventions as shapes.ts (KayKit model units, y up, front +z,
// frontage along x, foundation skirt below y = 0) and the same colour masks:
//   0     fixed colour
//   128   wall: the instance's wall colour (the town's stone, adobe or timber by style), rgb a shade (188 = 1x)
//   191   roof: the instance's roof colour (the town's), whitened by snow
//   255   trim: in a landmark atlas the instance's trim colour (the faith's, the realm's, gilt), shaded by
//         luminance as the KayKit team colour is (rgb 101 = 1x)
// Pieces are drawn at their natural size (a house is ~0.8 wide): a cathedral ~2.6 long and
// ~3 tall, a keep with its bailey ~2.2 across. They are merged into two atlases (models.ts
// Model.LandmarkSacred and Model.LandmarkCivic), one draw call each whatever the mix of
// landmarks in view: every vertex carries its piece number (aPiece) and the vertex shader
// collapses the pieces an instance does not show (material.ts).

import * as THREE from 'three'
import { LandmarkKind } from '../../contract.ts'
import { Builder, Style, type RGB } from './shapes.ts'
import { LANDMARK_CIVIC } from './town.ts'

const M_FIXED = 0
const M_WALL = 128
const M_ROOF = 191
const M_TRIM = 255
const W: RGB = [188, 188, 188]
const W_DARK: RGB = [158, 158, 158]
const W_LIGHT: RGB = [206, 206, 206]
const R: RGB = [188, 188, 188]
const R_DARK: RGB = [162, 162, 162]
const TRIM: RGB = [101, 101, 101]
const TRIM_LIGHT: RGB = [124, 124, 124]
const WOOD: RGB = [104, 78, 56]
const DARK_WOOD: RGB = [78, 60, 46]
const STONE: RGB = [168, 158, 140]
const STONE_DARK: RGB = [134, 126, 112]
const DOOR: RGB = [62, 48, 40]
const GILT: RGB = [196, 160, 82]
const WATER: RGB = [74, 128, 150]
const LEAF: RGB = [70, 104, 56]
const LEAF2: RGB = [88, 118, 62]

/** Pieces of the sacred atlas: the forms of LandmarkForm, great then lesser (2 * form + lesser), and the sacred grove. */
export const SacredPiece = {
  Cathedral: 0, Church: 1,
  GreatMosque: 2, DomedTemple: 3,
  Ziggurat: 4, SteppedShrine: 5,
  GreatColumned: 6, Columned: 7,
  GreatPagoda: 8, Pagoda: 9,
  GreatStave: 10, Stave: 11,
  GreatStupa: 12, Stupa: 13,
  Henge: 14, StoneCircle: 15,
  Grove: 16,
} as const
export const SACRED_PIECES = 17
/** Piece of a house of worship of `form` (LandmarkForm), great or lesser. */
export const sacredPiece = (form: number, great: boolean) => Math.max(0, Math.min(7, form | 0)) * 2 + (great ? 0 : 1)

/** Pieces of the civic atlas. */
export const CivicPiece = {
  Keep: 0, Citadel: 1, Stronghold: 2,
  Palace: 3, DomedPalace: 4, TimberHall: 5,
  MarketHall: 6, Guildhall: 7, Lighthouse: 8, Library: 9,
  Column: 10, Obelisk: 11, Mausoleum: 12, PyramidTomb: 13,
  Baths: 14, CouncilHouse: 15, Scaffold: 16, Cloister: 17,
} as const
/**
 * Pieces of the third atlas (models.ts Model.LandmarkPack): the KayKit pieces of public/models/landmarks/landmarks.glb (empty if it
 * did not load). An atlas of their own: they are detailed (some 12k triangles together), so the generated atlases stay light.
 */
export const PackPiece = { RuinHouse: 0, BuildYard: 1, BuildA: 2, BuildB: 3, BuildC: 4, Watchtower: 5, RoundTower: 6 } as const
/** Mesh names in landmarks.glb, by PackPiece. */
export const PACK_PIECES = ['ruin_house', 'build_yard', 'build_a', 'build_b', 'build_c', 'watchtower', 'round_tower'] as const


export const CIVIC_PIECES = 18

// ---------- helpers ----------

/** Merlons along the top of a wall from (x0, z0) to (x1, z1) at height y. */
function merlons(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, t: number, rgb: RGB = W, mask = M_WALL, size = 0.09) {
  const L = Math.hypot(x1 - x0, z1 - z0)
  const n = Math.max(2, Math.round(L / (size * 2)))
  for (let i = 0; i < n; i += 1) {
    if (i % 2) continue
    const a = (i + 0.15) / n, c = (i + 0.85) / n
    const ax = x0 + (x1 - x0) * a, az = z0 + (z1 - z0) * a, cx = x0 + (x1 - x0) * c, cz = z0 + (z1 - z0) * c
    b.box(Math.min(ax, cx) - t / 2, y, Math.min(az, cz) - t / 2, Math.max(ax, cx) + t / 2, y + size, Math.max(az, cz) + t / 2, rgb, mask)
  }
}

/** A square tower (half width h) to height y with merlons, optionally a pyramid cap. */
function squareTower(b: Builder, cx: number, cz: number, h: number, y: number, cap: number, wall: RGB = W, roof = true) {
  b.box(cx - h, -0.15, cz - h, cx + h, y, cz + h, wall, M_WALL, roof && cap > 0 ? R : W_DARK, roof && cap > 0 ? M_ROOF : M_WALL)
  if (cap > 0) b.hip(cx - h, cx + h, cz - h, cz + h, y, y + cap, 0.04)
  else {
    const t = 0.05
    merlons(b, cx - h, cz - h + t / 2, cx + h, cz - h + t / 2, y, t)
    merlons(b, cx - h, cz + h - t / 2, cx + h, cz + h - t / 2, y, t)
    merlons(b, cx - h + t / 2, cz - h, cx - h + t / 2, cz + h, y, t)
    merlons(b, cx + h - t / 2, cz - h, cx + h - t / 2, cz + h, y, t)
  }
}

/** A round tower to height y with a conical roof of height cap (0: a crenellated top). */
function roundTower(b: Builder, cx: number, cz: number, r: number, y: number, cap: number, seg = 8, wall: RGB = W) {
  b.frustum(cx, cz, -0.15, y, r, r * 0.94, seg, wall, M_WALL, W_DARK, M_WALL)
  if (cap > 0) b.frustum(cx, cz, y - 0.02, y + cap, r * 1.18, 0, seg, R, M_ROOF, null, M_ROOF, 0.5)
  else for (let i = 0; i < seg; i += 2) {
    const a = ((i + 0.5) / seg) * Math.PI * 2
    const x = cx + Math.cos(a) * r * 0.86, z = cz + Math.sin(a) * r * 0.86
    b.box(x - 0.04, y, z - 0.04, x + 0.04, y + 0.09, z + 0.04, wall, M_WALL)
  }
}

/** A row of columns along x from x0 to x1 at depth z, n columns of radius r and height h standing on y0. */
function colonnade(b: Builder, x0: number, x1: number, z: number, n: number, r: number, y0: number, h: number, rgb: RGB = W_LIGHT, mask = M_WALL) {
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1)
    b.frustum(x, z, y0, y0 + h, r, r * 0.86, 6, rgb, mask, null)
  }
}
/** The same along z. */
function colonnadeZ(b: Builder, z0: number, z1: number, x: number, n: number, r: number, y0: number, h: number, rgb: RGB = W_LIGHT, mask = M_WALL) {
  for (let i = 0; i < n; i++) {
    const z = n === 1 ? (z0 + z1) / 2 : z0 + ((z1 - z0) * i) / (n - 1)
    b.frustum(x, z, y0, y0 + h, r, r * 0.86, 6, rgb, mask, null)
  }
}

/** Stepped base: `steps` steps of height sh from half sizes (hx, hz), each inset by d. Returns the top height. */
function steps(b: Builder, hx: number, hz: number, steps: number, sh: number, d: number, rgb: RGB = W_LIGHT, mask = M_WALL): number {
  let y = -0.15
  for (let i = 0; i < steps; i++) {
    const top = i === 0 ? sh : y + sh
    b.box(-hx + i * d, y, -hz + i * d, hx - i * d, top, hz - i * d, i % 2 ? W_DARK : rgb, mask)
    y = top
  }
  return y
}

/** A door (dark panel) on the +z face at x, from y0, w wide, h high, standing proud of z by a hair. */
function door(b: Builder, x: number, z: number, y0: number, w: number, h: number, rgb: RGB = DOOR) {
  b.quad([x - w / 2, y0, z + 0.006], [x + w / 2, y0, z + 0.006], [x + w / 2, y0 + h, z + 0.006], [x - w / 2, y0 + h, z + 0.006], rgb)
}

/** A finial or spire tip in trim colour: a thin cone from y0 to y1. */
function finial(b: Builder, cx: number, cz: number, y0: number, y1: number, r: number, rgb: RGB = TRIM) {
  b.frustum(cx, cz, y0, y1, r, 0, 6, rgb, M_TRIM, null, M_TRIM)
}

/** A minaret: slim round shaft to h with a balcony, a little drum and a pointed or domed cap. */
function minaret(b: Builder, cx: number, cz: number, r: number, h: number, pointed: boolean) {
  b.frustum(cx, cz, -0.15, h * 0.78, r, r * 0.85, 8, W, M_WALL, null)
  b.frustum(cx, cz, h * 0.76, h * 0.8, r * 1.45, r * 1.45, 8, W_DARK, M_WALL)
  b.frustum(cx, cz, h * 0.8, h * 0.92, r * 0.72, r * 0.7, 8, W, M_WALL, null)
  if (pointed) b.frustum(cx, cz, h * 0.92, h, r * 0.8, 0, 8, TRIM, M_TRIM, null, M_TRIM)
  else { b.dome(cx, cz, h * 0.92, r * 0.72, 8, 2, TRIM, M_TRIM); finial(b, cx, cz, h * 0.92 + r * 0.7, h * 1.04, r * 0.15) }
}

/** A tier of a pagoda: a box of half width h from y to y + wh, then a wide hip roof flaring out by o, up to y + wh + rh. */
function pagodaTier(b: Builder, h: number, y: number, wh: number, rh: number, o: number, wall: RGB = W) {
  b.box(-h, y, -h, h, y + wh, h, wall, M_WALL)
  b.hip(-h, h, -h, h, y + wh, y + wh + rh, o, R, M_ROOF)
}

function tree(b: Builder, x: number, z: number, s: number, g: RGB) {
  b.frustum(x, z, -0.1, 0.32 * s, 0.04 * s, 0.035 * s, 4, WOOD, M_FIXED, null)
  b.frustum(x, z, 0.24 * s, 0.6 * s, 0.2 * s, 0.32 * s, 6, g, M_FIXED, null)
  b.frustum(x, z, 0.6 * s, 0.98 * s, 0.32 * s, 0, 6, [g[0] + 12, g[1] + 14, g[2] + 6], M_FIXED, null)
}

// ---------- sacred ----------

function sacredGeometry(p: number): Builder {
  const b = new Builder()
  switch (p) {
    case SacredPiece.Cathedral: {
      // a long nave with aisles, a transept, a round apse, twin west towers with spires and a crossing spire
      b.box(-1.1, -0.15, -0.5, 1.0, 0.62, 0.5, W_DARK, M_WALL, R_DARK, M_ROOF) // aisles
      b.box(-1.1, 0.5, -0.32, 1.0, 1.08, 0.32, W, M_WALL) // clerestory
      b.gable(-1.1, 1.0, -0.32, 0.32, 1.08, 1.6, 0.04, true)
      b.box(0.2, -0.15, -0.82, 0.62, 1.08, 0.82, W, M_WALL) // transept
      b.gable(0.2, 0.62, -0.82, 0.82, 1.08, 1.55, 0.04, false)
      b.frustum(1.0, 0, -0.15, 0.95, 0.32, 0.32, 8, W, M_WALL, null) // apse
      b.frustum(1.0, 0, 0.93, 1.32, 0.36, 0, 8, R, M_ROOF, null, M_ROOF, 0.5)
      for (const sz of [-1, 1]) {
        const z = sz * 0.3
        b.box(-1.5, -0.15, z - 0.2, -1.1, 2.0, z + 0.2, W, M_WALL)
        b.box(-1.52, 1.94, z - 0.22, -1.08, 2.02, z + 0.22, W_DARK, M_WALL)
        b.frustum(-1.3, z, 2.0, 3.0, 0.2, 0, 4, R_DARK, M_ROOF, null, M_ROOF, 0.5)
        finial(b, -1.3, z, 2.9, 3.15, 0.03)
      }
      b.box(-1.5, -0.15, -0.1, -1.1, 1.3, 0.1, W_LIGHT, M_WALL) // west front between the towers
      b.quad([-1.501, 0, 0.1], [-1.501, 0, -0.1], [-1.501, 0.55, -0.1], [-1.501, 0.55, 0.1], DOOR)
      b.frustum(-1.505, 0, 0.75, 0.76, 0.14, 0.14, 10, TRIM_LIGHT, M_TRIM, TRIM_LIGHT, M_TRIM) // rose window
      b.frustum(0.41, 0, 1.5, 2.45, 0.14, 0, 8, R_DARK, M_ROOF, null, M_ROOF) // crossing spire
      finial(b, 0.41, 0, 2.38, 2.6, 0.025)
      for (let i = 0; i < 4; i++) b.box(-0.9 + i * 0.5, -0.15, 0.48, -0.82 + i * 0.5, 0.75, 0.58, W_DARK, M_WALL) // buttresses
      break
    }
    case SacredPiece.Church: {
      b.box(-0.75, -0.15, -0.32, 0.6, 0.72, 0.32, W, M_WALL)
      b.gable(-0.75, 0.6, -0.32, 0.32, 0.72, 1.18, 0.05, true)
      b.frustum(0.6, 0, -0.15, 0.62, 0.24, 0.24, 7, W, M_WALL, null)
      b.frustum(0.6, 0, 0.6, 0.9, 0.27, 0, 7, R, M_ROOF, null, M_ROOF, 0.5)
      b.box(-1.08, -0.15, -0.19, -0.7, 1.45, 0.19, W, M_WALL)
      b.frustum(-0.89, 0, 1.45, 2.3, 0.2, 0, 4, R_DARK, M_ROOF, null, M_ROOF, 0.5)
      finial(b, -0.89, 0, 2.22, 2.42, 0.025)
      b.quad([-1.081, 0, 0.08], [-1.081, 0, -0.08], [-1.081, 0.42, -0.08], [-1.081, 0.42, 0.08], DOOR)
      break
    }
    case SacredPiece.GreatMosque: {
      // a prayer hall under a great dome on a drum, half domes and small domes, an arcaded court, two tall minarets
      b.box(-0.95, -0.15, -0.75, 0.95, 0.72, 0.75, W, M_WALL, R, M_ROOF)
      b.frustum(0, 0, 0.72, 0.98, 0.6, 0.6, 12, W, M_WALL, null)
      b.dome(0, 0, 0.98, 0.6, 12, 4, TRIM, M_TRIM)
      finial(b, 0, 0, 1.56, 1.85, 0.04, GILT)
      for (const [x, z] of [[-0.62, -0.45], [0.62, -0.45], [-0.62, 0.45], [0.62, 0.45]] as const) {
        b.frustum(x, z, 0.72, 0.8, 0.22, 0.22, 8, W, M_WALL, null)
        b.dome(x, z, 0.8, 0.22, 8, 2, TRIM, M_TRIM)
      }
      // the court before it, its arcade
      b.box(-0.95, -0.15, 0.75, -0.85, 0.38, 1.35, W, M_WALL, W_DARK, M_WALL)
      b.box(0.85, -0.15, 0.75, 0.95, 0.38, 1.35, W, M_WALL, W_DARK, M_WALL)
      b.box(-0.95, -0.15, 1.25, -0.2, 0.38, 1.35, W, M_WALL, W_DARK, M_WALL)
      b.box(0.2, -0.15, 1.25, 0.95, 0.38, 1.35, W, M_WALL, W_DARK, M_WALL)
      b.box(-0.2, -0.15, 1.22, 0.2, 0.62, 1.38, W_LIGHT, M_WALL) // gate portal
      door(b, 0, 1.38, 0, 0.18, 0.4)
      b.frustum(0, 1.05, -0.15, 0.04, 0.12, 0.12, 8, W_DARK, M_WALL, WATER, M_FIXED) // ablution fountain
      minaret(b, -1.1, 1.35, 0.1, 2.6, false)
      minaret(b, 1.1, 1.35, 0.1, 2.6, false)
      door(b, 0, 0.75, 0, 0.26, 0.5)
      break
    }
    case SacredPiece.DomedTemple: {
      b.box(-0.5, -0.15, -0.5, 0.5, 0.62, 0.5, W, M_WALL, R, M_ROOF)
      b.frustum(0, 0, 0.62, 0.78, 0.4, 0.4, 10, W, M_WALL, null)
      b.dome(0, 0, 0.78, 0.4, 10, 3, TRIM, M_TRIM)
      finial(b, 0, 0, 1.16, 1.36, 0.03, GILT)
      b.box(-0.22, -0.15, 0.5, 0.22, 0.5, 0.6, W_LIGHT, M_WALL)
      door(b, 0, 0.6, 0, 0.16, 0.34)
      minaret(b, 0.72, -0.4, 0.08, 1.75, true)
      break
    }
    case SacredPiece.Ziggurat: {
      // four stepped terraces of mud brick, a great stair up the front, the shrine on top
      const tiers = [[1.3, 0.4], [1.0, 0.38], [0.72, 0.36], [0.46, 0.34]] as const
      let y = -0.15
      tiers.forEach(([h, th], i) => {
        b.box(-h, y, -h, h, y + th + (i === 0 ? 0.15 : 0), h, i % 2 ? W_DARK : W, M_WALL, W_LIGHT, M_WALL)
        y += th + (i === 0 ? 0.15 : 0)
      })
      b.box(-0.24, y, -0.24, 0.24, y + 0.32, 0.24, W_LIGHT, M_WALL, TRIM, M_TRIM)
      b.box(-0.27, y + 0.32, -0.27, 0.27, y + 0.37, 0.27, TRIM, M_TRIM)
      door(b, 0, 0.24, y, 0.12, 0.2)
      // the stair: a ramp from the ground to the top terrace's front
      const top = y
      b.quad([-0.2, -0.1, 1.62], [0.2, -0.1, 1.62], [0.2, top, 0.46], [-0.2, top, 0.46], W_LIGHT, M_WALL)
      b.quad([-0.2, -0.15, 1.62], [-0.2, top, 0.46], [-0.2, -0.15, 0.46], [-0.2, -0.15, 1.62], W_DARK, M_WALL)
      b.quad([0.2, -0.15, 1.62], [0.2, -0.15, 0.46], [0.2, top, 0.46], [0.2, -0.15, 1.62], W_DARK, M_WALL)
      break
    }
    case SacredPiece.SteppedShrine: {
      let y = -0.15
      for (const [h, th] of [[0.7, 0.3], [0.5, 0.28], [0.32, 0.26]] as const) {
        b.box(-h, y, -h, h, y + th + (y < 0 ? 0.15 : 0), h, W, M_WALL, W_LIGHT, M_WALL)
        y += th + (y < 0 ? 0.15 : 0)
      }
      b.box(-0.18, y, -0.18, 0.18, y + 0.26, 0.18, W_LIGHT, M_WALL)
      b.hip(-0.18, 0.18, -0.18, 0.18, y + 0.26, y + 0.42, 0.05, TRIM, M_TRIM)
      b.quad([-0.12, -0.1, 0.95], [0.12, -0.1, 0.95], [0.12, y, 0.32], [-0.12, y, 0.32], W_LIGHT, M_WALL)
      break
    }
    case SacredPiece.GreatColumned: {
      // a peripteral temple: three steps, a colonnade all round, entablature, low pediment roof
      const top = steps(b, 1.25, 0.72, 3, 0.1, 0.06)
      const hx = 1.05, hz = 0.52, ch = 0.86
      b.box(-0.8, top, -0.32, 0.8, top + ch, 0.32, W, M_WALL) // cella
      colonnade(b, -hx, hx, hz, 8, 0.055, top, ch)
      colonnade(b, -hx, hx, -hz, 8, 0.055, top, ch)
      colonnadeZ(b, -hz + 0.15, hz - 0.15, -hx, 3, 0.055, top, ch)
      colonnadeZ(b, -hz + 0.15, hz - 0.15, hx, 3, 0.055, top, ch)
      b.box(-hx - 0.08, top + ch, -hz - 0.08, hx + 0.08, top + ch + 0.14, hz + 0.08, W_LIGHT, M_WALL)
      b.gable(-hx - 0.08, hx + 0.08, -hz - 0.08, hz + 0.08, top + ch + 0.14, top + ch + 0.42, 0.03, true, R, TRIM_LIGHT, M_TRIM)
      door(b, 0, 0.32, top, 0.2, 0.42)
      break
    }
    case SacredPiece.Columned: {
      const top = steps(b, 0.7, 0.5, 2, 0.1, 0.06)
      b.box(-0.4, top, -0.42, 0.4, top + 0.62, 0.18, W, M_WALL)
      colonnade(b, -0.36, 0.36, 0.38, 4, 0.045, top, 0.62) // the portico along the front
      b.box(-0.46, top + 0.62, -0.48, 0.46, top + 0.72, 0.46, W_LIGHT, M_WALL)
      b.gable(-0.46, 0.46, -0.48, 0.46, top + 0.72, top + 0.95, 0.03, false, R, TRIM_LIGHT, M_TRIM)
      door(b, 0, 0.18, top, 0.16, 0.36)
      break
    }
    case SacredPiece.GreatPagoda: {
      // five tiers on a stone platform, each roof flaring wide, a finial of rings
      b.box(-0.95, -0.15, -0.95, 0.95, 0.12, 0.95, STONE, M_FIXED, W_LIGHT, M_WALL)
      let y = 0.12, h = 0.62
      for (let i = 0; i < 5; i++) {
        const wh = i === 0 ? 0.42 : 0.26
        pagodaTier(b, h, y, wh, 0.2, 0.2 - i * 0.02, i === 0 ? W : W_DARK)
        y += wh + 0.2
        h *= 0.82
      }
      b.frustum(0, 0, y - 0.04, y + 0.55, 0.06, 0.02, 6, TRIM, M_TRIM, null)
      for (let k = 0; k < 4; k++) b.frustum(0, 0, y + 0.08 + k * 0.1, y + 0.12 + k * 0.1, 0.09, 0.09, 6, GILT, M_FIXED)
      door(b, 0, 0.62, 0.12, 0.2, 0.3)
      break
    }
    case SacredPiece.Pagoda: {
      b.box(-0.6, -0.15, -0.6, 0.6, 0.08, 0.6, STONE, M_FIXED, W_LIGHT, M_WALL)
      let y = 0.08, h = 0.42
      for (let i = 0; i < 3; i++) {
        const wh = i === 0 ? 0.34 : 0.22
        pagodaTier(b, h, y, wh, 0.16, 0.15)
        y += wh + 0.16
        h *= 0.8
      }
      b.frustum(0, 0, y - 0.03, y + 0.38, 0.045, 0.015, 6, TRIM, M_TRIM, null)
      door(b, 0, 0.42, 0.08, 0.16, 0.24)
      break
    }
    case SacredPiece.GreatStave: {
      // a stave church: stacked steep roofs, a skirt of a gallery, a tall central tower; dragon-head gables in trim
      b.box(-0.75, -0.15, -0.55, 0.75, 0.3, 0.55, W_DARK, M_WALL)
      b.hip(-0.75, 0.75, -0.55, 0.55, 0.3, 0.55, 0.1, R_DARK)
      b.box(-0.55, 0.3, -0.38, 0.55, 0.85, 0.38, W, M_WALL)
      b.gable(-0.55, 0.55, -0.38, 0.38, 0.85, 1.3, 0.06, true)
      b.box(-0.3, 0.9, -0.3, 0.3, 1.45, 0.3, W, M_WALL)
      b.hip(-0.3, 0.3, -0.3, 0.3, 1.45, 1.75, 0.08)
      b.box(-0.16, 1.62, -0.16, 0.16, 1.95, 0.16, W_DARK, M_WALL)
      b.frustum(0, 0, 1.95, 2.65, 0.2, 0, 4, R_DARK, M_ROOF, null, M_ROOF, 0.5)
      for (const sx of [-1, 1]) {
        b.box(sx * 0.58 - 0.03, 1.15, -0.03, sx * 0.58 + 0.03, 1.42, 0.03, TRIM, M_TRIM)
        b.box(sx * 0.33 - 0.03, 1.62, -0.03, sx * 0.33 + 0.03, 1.85, 0.03, TRIM, M_TRIM)
      }
      door(b, 0, 0.55, 0, 0.18, 0.28, DARK_WOOD)
      break
    }
    case SacredPiece.Stave: {
      b.box(-0.45, -0.15, -0.36, 0.45, 0.45, 0.36, W, M_WALL)
      b.gable(-0.45, 0.45, -0.36, 0.36, 0.45, 0.85, 0.07, true)
      b.box(-0.2, 0.6, -0.2, 0.2, 1.05, 0.2, W_DARK, M_WALL)
      b.hip(-0.2, 0.2, -0.2, 0.2, 1.05, 1.28, 0.06)
      b.frustum(0, 0, 1.2, 1.75, 0.13, 0, 4, R_DARK, M_ROOF, null, M_ROOF, 0.5)
      for (const sx of [-1, 1]) b.box(sx * 0.48 - 0.025, 0.72, -0.025, sx * 0.48 + 0.025, 0.95, 0.025, TRIM, M_TRIM)
      door(b, 0, 0.36, 0, 0.14, 0.26, DARK_WOOD)
      break
    }
    case SacredPiece.GreatStupa: {
      // two square terraces with a walkway, a great dome, the harmika and a spire of parasols; gateways on four sides
      b.box(-1.15, -0.15, -1.15, 1.15, 0.18, 1.15, W_DARK, M_WALL, W_LIGHT, M_WALL)
      b.box(-0.92, 0.18, -0.92, 0.92, 0.4, 0.92, W, M_WALL, W_LIGHT, M_WALL)
      b.frustum(0, 0, 0.4, 0.5, 0.82, 0.82, 14, W_LIGHT, M_WALL, null)
      b.dome(0, 0, 0.5, 0.8, 14, 5, W_LIGHT, M_WALL)
      b.box(-0.18, 1.26, -0.18, 0.18, 1.48, 0.18, TRIM, M_TRIM)
      b.frustum(0, 0, 1.48, 2.6, 0.06, 0.03, 6, TRIM, M_TRIM, null)
      for (let k = 0; k < 6; k++) { const yy = 1.6 + k * 0.17; b.frustum(0, 0, yy, yy + 0.04, 0.24 - k * 0.03, 0.24 - k * 0.03, 8, GILT, M_FIXED) }
      for (const [x, z, yaw] of [[0, 1.3, 0], [0, -1.3, 0], [1.3, 0, 1], [-1.3, 0, 1]] as const) {
        const dx = yaw ? 0.03 : 0.2, dz = yaw ? 0.2 : 0.03
        b.box(x - dx - 0.03, -0.15, z - dz - 0.03, x - dx + 0.03, 0.55, z - dz + 0.03, W_DARK, M_WALL)
        b.box(x + dx - 0.03, -0.15, z + dz - 0.03, x + dx + 0.03, 0.55, z + dz + 0.03, W_DARK, M_WALL)
        b.box(x - (yaw ? 0.04 : 0.28), 0.5, z - (yaw ? 0.28 : 0.04), x + (yaw ? 0.04 : 0.28), 0.58, z + (yaw ? 0.28 : 0.04), TRIM, M_TRIM)
      }
      break
    }
    case SacredPiece.Stupa: {
      b.box(-0.55, -0.15, -0.55, 0.55, 0.15, 0.55, W, M_WALL, W_LIGHT, M_WALL)
      b.frustum(0, 0, 0.15, 0.22, 0.42, 0.42, 12, W_LIGHT, M_WALL, null)
      b.dome(0, 0, 0.22, 0.4, 12, 4, W_LIGHT, M_WALL)
      b.box(-0.1, 0.6, -0.1, 0.1, 0.72, 0.1, TRIM, M_TRIM)
      b.frustum(0, 0, 0.72, 1.4, 0.04, 0.02, 6, TRIM, M_TRIM, null)
      for (let k = 0; k < 4; k++) { const yy = 0.8 + k * 0.13; b.frustum(0, 0, yy, yy + 0.03, 0.13 - k * 0.02, 0.13 - k * 0.02, 8, GILT, M_FIXED) }
      break
    }
    case SacredPiece.Henge: {
      // a ring of sarsens with lintels round a horseshoe of trilithons and an altar stone
      const n = 16, r = 1.1
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const x = Math.cos(a) * r, z = Math.sin(a) * r
        const ta = a + Math.PI / 2
        const ux = Math.cos(ta) * 0.09, uz = Math.sin(ta) * 0.09, vx = Math.cos(a) * 0.06, vz = Math.sin(a) * 0.06
        const c: RGB = i % 3 ? STONE : STONE_DARK
        // an upright (a box turned to face the centre)
        const P = (s: number, t: number, y: number): [number, number, number] => [x + ux * s + vx * t, y, z + uz * s + vz * t]
        const top = 0.62 + 0.05 * Math.sin(i * 7.3)
        b.quad(P(-1, 1, -0.1), P(1, 1, -0.1), P(1, 1, top), P(-1, 1, top), c)
        b.quad(P(1, -1, -0.1), P(-1, -1, -0.1), P(-1, -1, top), P(1, -1, top), c)
        b.quad(P(1, 1, -0.1), P(1, -1, -0.1), P(1, -1, top), P(1, 1, top), c)
        b.quad(P(-1, -1, -0.1), P(-1, 1, -0.1), P(-1, 1, top), P(-1, -1, top), c)
        b.quad(P(-1, -1, top), P(-1, 1, top), P(1, 1, top), P(1, -1, top), c)
        // lintel to the next
        if (i % 4 !== 3) {
          const a2 = ((i + 1) / n) * Math.PI * 2
          const x2 = Math.cos(a2) * r, z2 = Math.sin(a2) * r
          const nx = -(z2 - z), nz = x2 - x, nl = Math.hypot(nx, nz)
          const ox = (nx / nl) * 0.06, oz = (nz / nl) * 0.06
          const L = (px: number, pz: number, s: number, y: number): [number, number, number] => [px + ox * s, y, pz + oz * s]
          const y0 = 0.62, y1 = 0.72
          b.quad(L(x, z, 1, y1), L(x2, z2, 1, y1), L(x2, z2, -1, y1), L(x, z, -1, y1), STONE_DARK)
          b.quad(L(x, z, 1, y0), L(x2, z2, 1, y0), L(x2, z2, 1, y1), L(x, z, 1, y1), STONE_DARK)
          b.quad(L(x2, z2, -1, y0), L(x, z, -1, y0), L(x, z, -1, y1), L(x2, z2, -1, y1), STONE_DARK)
        }
      }
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * 0.6 + (i / 4) * Math.PI * 1.8
        const x = Math.cos(a) * 0.55, z = Math.sin(a) * 0.55
        b.box(x - 0.12, -0.1, z - 0.07, x - 0.04, 0.82, z + 0.07, STONE)
        b.box(x + 0.04, -0.1, z - 0.07, x + 0.12, 0.82, z + 0.07, STONE)
        b.box(x - 0.15, 0.82, z - 0.08, x + 0.15, 0.94, z + 0.08, STONE_DARK)
      }
      b.box(-0.2, -0.1, -0.08, 0.2, 0.12, 0.08, TRIM, M_TRIM)
      break
    }
    case SacredPiece.StoneCircle: {
      const n = 9, r = 0.62
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const x = Math.cos(a) * r, z = Math.sin(a) * r
        const h = 0.36 + 0.14 * Math.abs(Math.sin(i * 5.1))
        b.frustum(x, z, -0.1, h, 0.08, 0.05, 4, i % 2 ? STONE : STONE_DARK, M_FIXED, STONE_DARK, M_FIXED, i * 0.3)
      }
      b.frustum(0, 0, -0.1, 0.62, 0.1, 0.05, 4, STONE_DARK, M_FIXED, TRIM, M_TRIM)
      b.box(-0.14, -0.1, 0.18, 0.14, 0.1, 0.32, TRIM, M_TRIM)
      break
    }
    case SacredPiece.Grove: {
      // a sacred grove: a ring of great trees round a clearing with an altar stone and a carved post
      const n = 7
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.3
        tree(b, Math.cos(a) * 0.75, Math.sin(a) * 0.75, 1.15 + 0.25 * Math.sin(i * 3.7), i % 2 ? LEAF : LEAF2)
      }
      b.box(-0.18, -0.1, -0.1, 0.18, 0.14, 0.1, STONE)
      b.box(-0.05, -0.1, -0.35, 0.05, 0.75, -0.25, WOOD, M_FIXED, TRIM, M_TRIM)
      b.box(-0.08, 0.6, -0.36, 0.08, 0.7, -0.24, TRIM, M_TRIM)
      break
    }
  }
  return b
}

// ---------- civic ----------

function civicGeometry(p: number): Builder {
  const b = new Builder()
  switch (p) {
    case CivicPiece.Keep: {
      // a curtain wall round a bailey with round corner towers and a gatehouse; a tall square keep with corner turrets
      const e = 1.05, t = 0.12, h = 0.62
      b.box(-e, -0.15, -e, e, h, -e + t, W, M_WALL)
      b.box(-e, -0.15, -e + t, -e + t, h, e, W, M_WALL)
      b.box(e - t, -0.15, -e + t, e, h, e, W, M_WALL)
      b.box(-e, -0.15, e - t, -0.24, h, e, W, M_WALL)
      b.box(0.24, -0.15, e - t, e, h, e, W, M_WALL)
      merlons(b, -e, -e + t / 2, e, -e + t / 2, h, t)
      merlons(b, -e + t / 2, -e, -e + t / 2, e, h, t)
      merlons(b, e - t / 2, -e, e - t / 2, e, h, t)
      merlons(b, -e, e - t / 2, -0.24, e - t / 2, h, t)
      merlons(b, 0.24, e - t / 2, e, e - t / 2, h, t)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) roundTower(b, sx * e, sz * e, 0.22, 1.0, 0.42)
      // gatehouse
      for (const sx of [-1, 1]) squareTower(b, sx * 0.3, e - 0.02, 0.14, 0.92, 0)
      b.box(-0.18, 0.5, e - 0.12, 0.18, 0.86, e + 0.06, W_DARK, M_WALL)
      door(b, 0, e + 0.06, -0.05, 0.26, 0.5, DARK_WOOD)
      // the keep
      b.box(-0.42, -0.15, -0.55, 0.42, 1.75, 0.2, W, M_WALL, W_DARK, M_WALL)
      merlons(b, -0.42, -0.53, 0.42, -0.53, 1.75, 0.05)
      merlons(b, -0.42, 0.18, 0.42, 0.18, 1.75, 0.05)
      merlons(b, -0.4, -0.55, -0.4, 0.2, 1.75, 0.05)
      merlons(b, 0.4, -0.55, 0.4, 0.2, 1.75, 0.05)
      for (const sx of [-1, 1]) for (const sz of [-0.55, 0.2]) roundTower(b, sx * 0.42, sz, 0.1, 2.0, 0.3, 6)
      b.box(-0.08, 1.75, -0.25, 0.08, 2.2, -0.1, W_DARK, M_WALL)
      b.box(-0.01, 2.2, -0.18, 0.01, 2.5, -0.16, DARK_WOOD)
      b.quad([0.01, 2.32, -0.17], [0.01, 2.5, -0.17], [0.01, 2.44, 0.12], [0.01, 2.36, 0.12], TRIM, M_TRIM) // banner
      door(b, 0, 0.2, 0, 0.14, 0.3, DARK_WOOD)
      // a hall in the bailey
      b.box(0.5, -0.15, 0.25, 0.9, 0.38, 0.85, W_DARK, M_WALL)
      b.gable(0.5, 0.9, 0.25, 0.85, 0.38, 0.62, 0.04, false)
      break
    }
    case CivicPiece.Citadel: {
      // a mud-brick citadel: battered walls with square towers, a tall tapering keep, flat roofs
      const e = 1.05, t = 0.16, h = 0.7
      const wall = (x0: number, z0: number, x1: number, z1: number) => { b.box(x0, -0.15, z0, x1, h, z1, W, M_WALL, W_DARK, M_WALL) }
      wall(-e, -e, e, -e + t)
      wall(-e, -e + t, -e + t, e)
      wall(e - t, -e + t, e, e)
      wall(-e, e - t, -0.22, e)
      wall(0.22, e - t, e, e)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.frustum(sx * e, sz * e, -0.15, 1.1, 0.25, 0.19, 4, W, M_WALL, W_DARK, M_WALL, 0.5)
        merlons(b, sx * e - 0.13, sz * e, sx * e + 0.13, sz * e, 1.1, 0.06, W, M_WALL, 0.07)
      }
      for (const sx of [-1, 1]) b.frustum(sx * 0.32, e, -0.15, 1.0, 0.18, 0.14, 4, W, M_WALL, W_DARK, M_WALL, 0.5)
      b.box(-0.2, 0.5, e - 0.14, 0.2, 0.92, e + 0.04, W_DARK, M_WALL)
      door(b, 0, e + 0.04, -0.05, 0.24, 0.5, DARK_WOOD)
      b.frustum(-0.1, -0.2, -0.15, 2.1, 0.52, 0.36, 4, W, M_WALL, W_DARK, M_WALL, 0.5)
      b.box(-0.32, 2.1, -0.42, 0.12, 2.24, 0.02, W_DARK, M_WALL)
      b.box(-0.02, 2.24, -0.22, 0.02, 2.55, -0.18, DARK_WOOD)
      b.quad([0.02, 2.36, -0.2], [0.02, 2.55, -0.2], [0.02, 2.48, 0.1], [0.02, 2.4, 0.1], TRIM, M_TRIM)
      b.box(0.35, -0.15, 0.2, 0.85, 0.48, 0.8, W, M_WALL, R, M_ROOF)
      for (let i = 0; i < 5; i++) b.box(-0.6 + i * 0.12, 0.85 + i * 0.25, 0.14, -0.58 + i * 0.12, 0.88 + i * 0.25, 0.16, DARK_WOOD) // beam ends
      break
    }
    case CivicPiece.Stronghold: {
      // a timber stronghold on a mound: a palisade, corner towers with steep roofs, a great hall
      const pal: RGB = WOOD, e = 1.0
      b.frustum(0, 0, -0.15, 0.22, 1.2, 1.05, 10, [118, 104, 70], M_FIXED, [104, 112, 62], M_FIXED)
      for (const [x0, z0, x1, z1] of [[-e, -e, e, -e + 0.08], [-e, e - 0.08, -0.2, e], [0.2, e - 0.08, e, e], [-e, -e, -e + 0.08, e], [e - 0.08, -e, e, e]] as const) b.box(x0, 0.1, z0, x1, 0.6, z1, pal)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        b.box(sx * e - 0.13, 0.1, sz * e - 0.13, sx * e + 0.13, 0.95, sz * e + 0.13, pal, M_FIXED, R, M_ROOF)
        b.hip(sx * e - 0.13, sx * e + 0.13, sz * e - 0.13, sz * e + 0.13, 0.95, 1.25, 0.05)
      }
      b.box(-0.6, 0.15, -0.35, 0.6, 0.7, 0.3, W, M_WALL)
      b.gable(-0.6, 0.6, -0.35, 0.3, 0.7, 1.35, 0.08, true)
      b.box(-0.15, 0.15, 0.3, 0.15, 0.55, 0.42, DARK_WOOD)
      b.box(0.55, 1.1, -0.04, 0.6, 1.45, 0.04, TRIM, M_TRIM)
      b.box(-0.6, 1.1, -0.04, -0.55, 1.45, 0.04, TRIM, M_TRIM)
      break
    }
    case CivicPiece.Palace: {
      // a palace round a court of honour: a main range with a domed centre pavilion, two wings, corner pavilions
      b.box(-1.15, -0.15, -0.75, 1.15, 0.85, -0.25, W, M_WALL)
      b.hip(-1.15, 1.15, -0.75, -0.25, 0.85, 1.12, 0.05)
      for (const sx of [-1, 1]) {
        b.box(sx * 1.15 - 0.45 * sx, -0.15, -0.25, sx * 1.15, 0.78, 0.8, W, M_WALL)
        b.hip(Math.min(sx * 0.7, sx * 1.15), Math.max(sx * 0.7, sx * 1.15), -0.25, 0.8, 0.78, 1.02, 0.05)
        b.box(sx * 1.15 - 0.22, -0.15, -0.95, sx * 1.15 + 0.22, 1.05, -0.5, W_LIGHT, M_WALL)
        b.hip(sx * 1.15 - 0.22, sx * 1.15 + 0.22, -0.95, -0.5, 1.05, 1.4, 0.04, R_DARK)
      }
      b.box(-0.35, -0.15, -0.85, 0.35, 1.15, -0.15, W_LIGHT, M_WALL)
      b.frustum(0, -0.5, 1.15, 1.3, 0.3, 0.3, 10, W_LIGHT, M_WALL, null)
      b.dome(0, -0.5, 1.3, 0.3, 10, 3, TRIM, M_TRIM)
      finial(b, 0, -0.5, 1.58, 1.8, 0.03, GILT)
      colonnade(b, -0.3, 0.3, -0.12, 4, 0.04, -0.15, 0.7, W_LIGHT)
      b.box(-0.38, 0.55, -0.2, 0.38, 0.66, -0.06, W_LIGHT, M_WALL)
      door(b, 0, -0.15, 0, 0.2, 0.4)
      // the court's railing and gate
      b.box(-0.7, -0.15, 0.95, -0.15, 0.12, 1.0, DARK_WOOD)
      b.box(0.15, -0.15, 0.95, 0.7, 0.12, 1.0, DARK_WOOD)
      for (const sx of [-1, 1]) b.box(sx * 0.15 - 0.04, -0.15, 0.93, sx * 0.15 + 0.04, 0.32, 1.02, W_LIGHT, M_WALL, TRIM, M_TRIM)
      break
    }
    case CivicPiece.DomedPalace: {
      // a palace of courts and domes: a great domed hall, an arcaded front, corner towers with small domes, a garden pool
      b.box(-1.1, -0.15, -0.8, 1.1, 0.7, 0.2, W, M_WALL, R, M_ROOF)
      b.frustum(0, -0.3, 0.7, 0.92, 0.48, 0.48, 12, W, M_WALL, null)
      b.dome(0, -0.3, 0.92, 0.48, 12, 4, TRIM, M_TRIM)
      finial(b, 0, -0.3, 1.38, 1.6, 0.03, GILT)
      for (const sx of [-1, 1]) {
        b.frustum(sx * 0.62, -0.4, 0.7, 0.82, 0.22, 0.22, 8, W, M_WALL, null)
        b.dome(sx * 0.62, -0.4, 0.82, 0.22, 8, 2, TRIM, M_TRIM)
        for (const z of [-0.8, 0.2]) {
          b.frustum(sx * 1.1, z, -0.15, 1.2, 0.16, 0.14, 8, W, M_WALL, W_DARK, M_WALL)
          b.dome(sx * 1.1, z, 1.2, 0.15, 8, 2, TRIM, M_TRIM)
        }
      }
      colonnade(b, -0.95, 0.95, 0.28, 7, 0.04, -0.15, 0.55, W_LIGHT)
      b.box(-1.0, 0.5, 0.2, 1.0, 0.62, 0.36, W_LIGHT, M_WALL)
      b.box(-0.6, -0.15, 0.55, 0.6, -0.04, 1.05, W_LIGHT, M_WALL, WATER, M_FIXED)
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) tree(b, sx * 0.85, 0.55 + i * 0.25, 0.55, LEAF)
      door(b, 0, 0.2, -0.15, 0.2, 0.42)
      break
    }
    case CivicPiece.TimberHall: {
      // a great timber hall with a high ridge, crossed gable posts, a gallery and a smaller hall beside it
      b.box(-1.15, -0.15, -0.42, 1.15, 0.55, 0.42, W, M_WALL)
      b.gable(-1.15, 1.15, -0.42, 0.42, 0.55, 1.4, 0.1, true)
      for (const sx of [-1, 1]) {
        b.box(sx * 1.2 - 0.03, 1.15, -0.2, sx * 1.2 + 0.03, 1.6, -0.14, TRIM, M_TRIM)
        b.box(sx * 1.2 - 0.03, 1.15, 0.14, sx * 1.2 + 0.03, 1.6, 0.2, TRIM, M_TRIM)
      }
      b.box(-1.15, -0.15, 0.42, 1.15, 0.28, 0.6, DARK_WOOD)
      b.hip(-1.15, 1.15, 0.42, 0.62, 0.28, 0.42, 0.04, R_DARK)
      b.box(-0.7, -0.15, -1.0, 0.1, 0.4, -0.55, W_DARK, M_WALL)
      b.gable(-0.7, 0.1, -1.0, -0.55, 0.4, 0.8, 0.06, true)
      door(b, 0, 0.6, -0.15, 0.22, 0.38, DARK_WOOD)
      break
    }
    case CivicPiece.MarketHall: {
      // an open arcade under a great hipped roof, a loft above, a lantern with a bell
      const hx = 1.0, hz = 0.6
      colonnade(b, -hx, hx, hz, 6, 0.06, -0.15, 0.5, W)
      colonnade(b, -hx, hx, -hz, 6, 0.06, -0.15, 0.5, W)
      colonnadeZ(b, -hz + 0.25, hz - 0.25, -hx, 2, 0.06, -0.15, 0.5, W)
      colonnadeZ(b, -hz + 0.25, hz - 0.25, hx, 2, 0.06, -0.15, 0.5, W)
      b.box(-hx - 0.06, 0.5, -hz - 0.06, hx + 0.06, 0.95, hz + 0.06, W, M_WALL)
      b.hip(-hx - 0.06, hx + 0.06, -hz - 0.06, hz + 0.06, 0.95, 1.5, 0.08)
      b.box(-0.14, 1.38, -0.14, 0.14, 1.7, 0.14, W_LIGHT, M_WALL)
      b.frustum(0, 0, 1.7, 2.0, 0.2, 0, 4, R_DARK, M_ROOF, null, M_ROOF, 0.5)
      finial(b, 0, 0, 1.95, 2.12, 0.02)
      b.box(-hx + 0.1, -0.15, -hz + 0.1, hx - 0.1, -0.1, hz - 0.1, STONE, M_FIXED) // the floor
      for (let i = 0; i < 4; i++) b.box(-0.7 + i * 0.45, -0.15, -0.15, -0.5 + i * 0.45, 0.12, 0.15, WOOD, M_FIXED, [150, 120, 80]) // stalls
      break
    }
    case CivicPiece.Guildhall: {
      // a tall stepped-gabled hall of three storeys on an arcade, and a slender belfry
      b.box(-0.6, -0.15, -0.45, 0.6, 1.25, 0.45, W, M_WALL)
      b.gable(-0.6, 0.6, -0.45, 0.45, 1.25, 1.85, 0.03, false)
      for (let i = 0; i < 4; i++) { const y = 1.25 + i * 0.15, w = 0.6 - i * 0.15; b.box(-w, y, 0.43, w, y + 0.15, 0.5, W_LIGHT, M_WALL) }
      colonnade(b, -0.5, 0.5, 0.5, 5, 0.04, -0.15, 0.42, W_LIGHT)
      b.box(-0.6, 0.38, 0.45, 0.6, 0.46, 0.56, W_LIGHT, M_WALL)
      b.box(0.62, -0.15, -0.3, 0.9, 1.9, -0.02, W, M_WALL)
      b.box(0.6, 1.9, -0.32, 0.92, 2.0, 0.0, W_DARK, M_WALL)
      b.frustum(0.76, -0.16, 2.0, 2.65, 0.19, 0, 8, R_DARK, M_ROOF, null, M_ROOF, 0.5)
      finial(b, 0.76, -0.16, 2.6, 2.8, 0.02)
      b.frustum(0.905, -0.16, 1.5, 1.51, 0.09, 0.09, 10, TRIM_LIGHT, M_TRIM, TRIM_LIGHT, M_TRIM) // clock
      door(b, 0, 0.45, -0.15, 0.18, 0.34)
      b.box(-0.04, 1.0, 0.5, 0.04, 1.2, 0.54, TRIM, M_TRIM)
      break
    }
    case CivicPiece.Lighthouse: {
      // a round tapering tower on a rocky base, a gallery, a lantern with its fire, a keeper's house
      b.rock(-0.1, 0.1, 0.55, 0.18, STONE_DARK, 0.4)
      b.frustum(0, 0, -0.15, 0.22, 0.42, 0.4, 10, W_DARK, M_WALL, null)
      b.frustum(0, 0, 0.2, 2.0, 0.32, 0.2, 10, W, M_WALL, null)
      for (let k = 0; k < 3; k++) b.frustum(0, 0, 0.6 + k * 0.5, 0.72 + k * 0.5, 0.3 - k * 0.04 + 0.006, 0.29 - k * 0.04 + 0.006, 10, TRIM, M_TRIM, null) // painted bands
      b.frustum(0, 0, 2.0, 2.06, 0.32, 0.32, 10, W_DARK, M_WALL)
      b.frustum(0, 0, 2.06, 2.36, 0.15, 0.15, 8, [250, 226, 150], M_FIXED, null)
      b.frustum(0, 0, 2.34, 2.62, 0.2, 0, 8, R_DARK, M_ROOF, null, M_ROOF)
      b.box(0.32, -0.15, -0.2, 0.75, 0.38, 0.2, W, M_WALL)
      b.gable(0.32, 0.75, -0.2, 0.2, 0.38, 0.58, 0.04, true)
      door(b, 0, 0.42, 0.1, 0.12, 0.24, DARK_WOOD)
      break
    }
    case CivicPiece.Library: {
      // a domed reading hall with a columned portico and two book wings
      b.box(-0.45, -0.15, -0.45, 0.45, 0.85, 0.35, W, M_WALL, R, M_ROOF)
      b.frustum(0, -0.05, 0.85, 1.0, 0.36, 0.36, 12, W_LIGHT, M_WALL, null)
      b.dome(0, -0.05, 1.0, 0.36, 12, 4, TRIM, M_TRIM)
      b.frustum(0, -0.05, 1.34, 1.5, 0.07, 0.07, 6, W_LIGHT, M_WALL, TRIM, M_TRIM)
      for (const sx of [-1, 1]) {
        b.box(sx * 0.45, -0.15, -0.35, sx * 1.15, 0.6, 0.25, W, M_WALL)
        b.hip(Math.min(sx * 0.45, sx * 1.15), Math.max(sx * 0.45, sx * 1.15), -0.35, 0.25, 0.6, 0.82, 0.04)
      }
      const top = steps(b, 0.4, 0.15, 2, 0.06, 0.03)
      void top
      colonnade(b, -0.32, 0.32, 0.5, 4, 0.045, -0.03, 0.62, W_LIGHT)
      b.box(-0.38, 0.59, 0.35, 0.38, 0.69, 0.56, W_LIGHT, M_WALL)
      b.gable(-0.38, 0.38, 0.35, 0.56, 0.69, 0.86, 0.02, false, R, TRIM_LIGHT, M_TRIM)
      door(b, 0, 0.35, -0.03, 0.16, 0.36)
      break
    }
    case CivicPiece.Column: {
      // a triumphal column on a stepped plinth, a statue in trim on top
      const top = steps(b, 0.42, 0.42, 3, 0.1, 0.07)
      b.box(-0.18, top, -0.18, 0.18, top + 0.3, 0.18, W_LIGHT, M_WALL)
      b.frustum(0, 0, top + 0.3, top + 1.9, 0.12, 0.1, 8, W_LIGHT, M_WALL, null)
      for (let k = 0; k < 6; k++) b.frustum(0, 0, top + 0.45 + k * 0.24, top + 0.48 + k * 0.24, 0.125 - k * 0.003, 0.125 - k * 0.003, 8, W_DARK, M_WALL, null)
      b.box(-0.15, top + 1.9, -0.15, 0.15, top + 1.98, 0.15, W_LIGHT, M_WALL)
      b.frustum(0, 0, top + 1.98, top + 2.2, 0.06, 0.07, 6, TRIM, M_TRIM, null)
      b.dome(0, 0, top + 2.2, 0.06, 6, 2, TRIM, M_TRIM)
      b.box(0.03, top + 2.08, -0.02, 0.16, top + 2.13, 0.02, TRIM, M_TRIM)
      break
    }
    case CivicPiece.Obelisk: {
      const top = steps(b, 0.36, 0.36, 2, 0.12, 0.07)
      b.box(-0.17, top, -0.17, 0.17, top + 0.18, 0.17, W_DARK, M_WALL)
      b.frustum(0, 0, top + 0.18, top + 1.75, 0.15, 0.09, 4, W_LIGHT, M_WALL, null, M_WALL, 0.5)
      b.frustum(0, 0, top + 1.75, top + 1.97, 0.09, 0, 4, TRIM, M_TRIM, null, M_TRIM, 0.5)
      break
    }
    case CivicPiece.Mausoleum: {
      // a domed tomb on a high stepped plinth, four corner kiosks
      const top = steps(b, 0.85, 0.85, 3, 0.14, 0.12)
      b.frustum(0, 0, top, top + 0.65, 0.48, 0.48, 8, W_LIGHT, M_WALL, W, M_WALL, 0.5)
      b.frustum(0, 0, top + 0.65, top + 0.8, 0.42, 0.42, 12, W, M_WALL, null)
      b.dome(0, 0, top + 0.8, 0.42, 12, 4, TRIM, M_TRIM)
      finial(b, 0, 0, top + 1.2, top + 1.42, 0.03, GILT)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * 0.5, z = sz * 0.5
        colonnade(b, x - 0.06, x + 0.06, z, 2, 0.025, top, 0.4, W_LIGHT)
        b.frustum(x, z, top + 0.4, top + 0.46, 0.12, 0.12, 6, W_LIGHT, M_WALL, null)
        b.dome(x, z, top + 0.46, 0.11, 6, 2, TRIM, M_TRIM)
      }
      door(b, 0, 0.45, top, 0.16, 0.36)
      break
    }
    case CivicPiece.PyramidTomb: {
      const h = 0.95, r = 1.4
      b.box(-0.95, -0.15, -0.95, 0.95, 0.05, 0.95, W_DARK, M_WALL)
      const c = (x: number, z: number): [number, number, number] => [x, 0.05, z]
      const apex: [number, number, number] = [0, 0.05 + r * h, 0]
      const e = 0.9
      b.tri(c(-e, e), c(e, e), apex, W, M_WALL)
      b.tri(c(e, e), c(e, -e), apex, W_LIGHT, M_WALL)
      b.tri(c(e, -e), c(-e, -e), apex, W, M_WALL)
      b.tri(c(-e, -e), c(-e, e), apex, W_DARK, M_WALL)
      // its gilt capstone
      const k = 0.88
      const capY = 0.05 + r * h * k
      const ce = e * (1 - k)
      b.tri([-ce, capY, ce], [ce, capY, ce], [0, apex[1] + 0.01, 0], TRIM, M_TRIM)
      b.tri([ce, capY, ce], [ce, capY, -ce], [0, apex[1] + 0.01, 0], TRIM, M_TRIM)
      b.tri([ce, capY, -ce], [-ce, capY, -ce], [0, apex[1] + 0.01, 0], TRIM, M_TRIM)
      b.tri([-ce, capY, -ce], [-ce, capY, ce], [0, apex[1] + 0.01, 0], TRIM, M_TRIM)
      // a small temple at its foot
      b.box(-0.25, -0.15, 0.95, 0.25, 0.32, 1.3, W, M_WALL, W_LIGHT, M_WALL)
      door(b, 0, 1.3, -0.15, 0.12, 0.3)
      break
    }
    case CivicPiece.Baths: {
      // a vaulted bath house: a long hall of small domes, a columned court round the great pool, steam vents
      b.box(-1.05, -0.15, -0.75, 1.05, 0.55, -0.2, W, M_WALL, R, M_ROOF)
      for (let i = 0; i < 4; i++) {
        const x = -0.78 + i * 0.52
        b.frustum(x, -0.47, 0.55, 0.6, 0.22, 0.22, 8, W, M_WALL, null)
        b.dome(x, -0.47, 0.6, 0.22, 8, 2, i === 1 || i === 2 ? TRIM : R, i === 1 || i === 2 ? M_TRIM : M_ROOF)
      }
      b.box(-0.8, -0.15, 0.0, 0.8, -0.04, 0.85, W_LIGHT, M_WALL, WATER, M_FIXED)
      colonnade(b, -1.0, 1.0, 1.02, 7, 0.04, -0.15, 0.45, W_LIGHT)
      colonnadeZ(b, -0.1, 0.95, -1.0, 3, 0.04, -0.15, 0.45, W_LIGHT)
      colonnadeZ(b, -0.1, 0.95, 1.0, 3, 0.04, -0.15, 0.45, W_LIGHT)
      b.box(-1.05, 0.45, 0.95, 1.05, 0.52, 1.08, W_LIGHT, M_WALL)
      for (let i = 0; i < 2; i++) b.frustum(-0.3 + i * 0.6, 0.4, -0.04, 0.4, 0.08, 0.14, 6, [226, 230, 232], M_FIXED, null) // steam
      door(b, 0, -0.2, -0.15, 0.2, 0.4)
      break
    }
    case CivicPiece.CouncilHouse: {
      // a senate house: a columned portico under a pediment, the hall behind, a tall clock tower
      const top = steps(b, 0.85, 0.7, 2, 0.08, 0.05)
      b.box(-0.75, top, -0.6, 0.75, top + 0.85, 0.25, W, M_WALL)
      b.gable(-0.75, 0.75, -0.6, 0.25, top + 0.85, top + 1.18, 0.04, false, R, W, M_WALL)
      colonnade(b, -0.62, 0.62, 0.52, 6, 0.05, top, 0.8, W_LIGHT)
      b.box(-0.7, top + 0.8, 0.25, 0.7, top + 0.92, 0.6, W_LIGHT, M_WALL)
      b.gable(-0.7, 0.7, 0.25, 0.6, top + 0.92, top + 1.15, 0.02, false, R, TRIM_LIGHT, M_TRIM)
      b.box(-0.2, top, -0.95, 0.2, 2.15, -0.55, W, M_WALL)
      b.box(-0.23, 2.15, -0.98, 0.23, 2.25, -0.52, W_DARK, M_WALL)
      b.frustum(0, -0.75, 2.25, 2.75, 0.17, 0, 8, R_DARK, M_ROOF, null, M_ROOF, 0.5)
      finial(b, 0, -0.75, 2.7, 2.88, 0.02)
      b.quad([-0.08, 1.7, -0.549], [0.08, 1.7, -0.549], [0.08, 1.86, -0.549], [-0.08, 1.86, -0.549], TRIM_LIGHT, M_TRIM)
      door(b, 0, 0.25, top, 0.2, 0.42)
      break
    }
    case CivicPiece.Scaffold: {
      // a unit scaffold (1 x 1 x 1, scaled to the work): poles, ledgers at three lifts, a crane jib
      const pole = (x: number, z: number) => b.box(x - 0.015, -0.1, z - 0.015, x + 0.015, 1.0, z + 0.015, WOOD)
      for (let i = 0; i <= 3; i++) {
        const u = -0.5 + i / 3
        pole(u, -0.5); pole(u, 0.5); pole(-0.5, u); pole(0.5, u)
      }
      for (let k = 1; k <= 3; k++) {
        const y = k * 0.32
        b.box(-0.51, y, -0.52, 0.51, y + 0.02, -0.48, WOOD)
        b.box(-0.51, y, 0.48, 0.51, y + 0.02, 0.52, WOOD)
        b.box(-0.52, y, -0.51, -0.48, y + 0.02, 0.51, WOOD)
        b.box(0.48, y, -0.51, 0.52, y + 0.02, 0.51, WOOD)
      }
      b.box(0.43, -0.1, 0.43, 0.47, 1.25, 0.47, DARK_WOOD)
      b.box(-0.1, 1.2, 0.43, 0.47, 1.23, 0.47, DARK_WOOD)
      b.box(-0.09, 0.95, 0.445, -0.085, 1.2, 0.455, [60, 56, 50])
      break
    }
    case CivicPiece.Cloister: {
      // a monastery's ranges round a square garth: dormitory, refectory, chapter house, a well in the garth
      const e = 0.8, d = 0.28
      for (const [x0, z0, x1, z1, along] of [[-e, -e, e, -e + d, 1], [-e, e - d, e, e, 1], [-e, -e + d, -e + d, e - d, 0], [e - d, -e + d, e, e - d, 0]] as const) {
        b.box(x0, -0.15, z0, x1, 0.42, z1, W, M_WALL)
        b.gable(x0, x1, z0, z1, 0.42, 0.68, 0.04, along === 1)
      }
      b.box(-e + d, -0.15, -e + d, e - d, -0.08, e - d, [104, 128, 70])
      b.frustum(0, 0, -0.15, 0.1, 0.08, 0.08, 8, STONE, M_FIXED, STONE_DARK)
      b.box(e - 0.12, -0.15, -e - 0.02, e + 0.1, 0.9, -e + 0.2, W, M_WALL)
      b.hip(e - 0.12, e + 0.1, -e - 0.02, -e + 0.2, 0.9, 1.1, 0.03)
      break
    }
  }
  return b
}

/** Built geometry of piece `p` of an atlas, with its bounding size (model units) and eave (height its walls reach). */
export interface PieceGeometry {
  geometry: THREE.BufferGeometry
  size: [number, number, number]
}

function finish(b: Builder): PieceGeometry {
  const g = b.build()
  g.computeBoundingBox()
  const bb = g.boundingBox!
  return { geometry: g, size: [bb.max.x - bb.min.x, bb.max.y, bb.max.z - bb.min.z] }
}

export const sacredPieceGeometry = (p: number): PieceGeometry => finish(sacredGeometry(p))
export const civicPieceGeometry = (p: number): PieceGeometry => finish(civicGeometry(p))

/**
 * One atlas from its pieces (each non-indexed or indexed, with position, normal and aColor; aFace optional):
 * a non-indexed geometry with every piece's triangles, its piece number in `aPiece`.
 */
export function mergeAtlas(pieces: readonly THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0
  const flat = pieces.map((g) => (g.getIndex() ? g.toNonIndexed() : g))
  for (const g of flat) n += g.getAttribute('position').count
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Uint8Array(n * 4), face = new Float32Array(n * 2), piece = new Float32Array(n)
  let o = 0
  flat.forEach((g, k) => {
    const P = g.getAttribute('position'), N = g.getAttribute('normal'), C = g.getAttribute('aColor'), F = g.getAttribute('aFace')
    const c = P.count
    for (let i = 0; i < c; i++) {
      pos[(o + i) * 3] = P.getX(i); pos[(o + i) * 3 + 1] = P.getY(i); pos[(o + i) * 3 + 2] = P.getZ(i)
      if (N) { nor[(o + i) * 3] = N.getX(i); nor[(o + i) * 3 + 1] = N.getY(i); nor[(o + i) * 3 + 2] = N.getZ(i) }
      else nor[(o + i) * 3 + 1] = 1
      // (aColor is RGBA8 normalised in both the packs and the generated pieces)
      const arr = C.array as ArrayLike<number>
      for (let q = 0; q < 4; q++) col[(o + i) * 4 + q] = arr[i * 4 + q]
      if (F) { face[(o + i) * 2] = F.getX(i); face[(o + i) * 2 + 1] = F.getY(i) }
      piece[o + i] = k
    }
    o += c
    if (g !== pieces[k]) g.dispose()
  })
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  out.setAttribute('aColor', new THREE.BufferAttribute(col, 4, true))
  out.setAttribute('aFace', new THREE.BufferAttribute(face, 2))
  out.setAttribute('aPiece', new THREE.BufferAttribute(piece, 1))
  return out
}

// ---------- which pieces stand for a landmark ----------

/** The pieces of a landmark (Role.Landmark kinds: a sacred piece, or LANDMARK_CIVIC + a civic piece) and a second one beside it (-1). */
export interface LandmarkPieces {
  code: number
  extra: number
}

/**
 * The pieces of a landmark of `kind` (LandmarkKind) by its form (LandmarkForm, houses of worship), its variant and the town's
 * building style: a stone keep in the temperate lands and the mountains, a mud-brick citadel in the dry lands and the savanna, a
 * timber stronghold in the north and the forests; a courtyard palace, a palace of domes in the hot lands, a great timber hall in
 * the north; an obelisk or a column, a domed tomb or a pyramid; a sacred grove in the woods and a stone circle in the open.
 */
export function landmarkPieces(kind: number, form: number, variant: number, style: number, id: number): LandmarkPieces {
  const C = (p: number) => LANDMARK_CIVIC + p
  const hot = style === Style.Desert || style === Style.Savanna
  const wood = style === Style.Cold || style === Style.Rainforest
  switch (kind) {
    case LandmarkKind.Castle: return { code: C(hot ? CivicPiece.Citadel : wood ? CivicPiece.Stronghold : CivicPiece.Keep), extra: -1 }
    case LandmarkKind.Palace: return { code: C(hot || style === Style.Rainforest ? CivicPiece.DomedPalace : style === Style.Cold ? CivicPiece.TimberHall : CivicPiece.Palace), extra: -1 }
    case LandmarkKind.GreatTemple: return { code: sacredPiece(form, true), extra: -1 }
    case LandmarkKind.Monastery: return { code: sacredPiece(form, false), extra: C(CivicPiece.Cloister) }
    case LandmarkKind.MarketHall: return { code: C(CivicPiece.MarketHall), extra: -1 }
    case LandmarkKind.Guildhall: return { code: C(CivicPiece.Guildhall), extra: -1 }
    case LandmarkKind.Lighthouse: return { code: C(CivicPiece.Lighthouse), extra: -1 }
    case LandmarkKind.Library: return { code: C(CivicPiece.Library), extra: -1 }
    case LandmarkKind.Monument: return { code: C(hot || ((id + variant) & 1) ? CivicPiece.Obelisk : CivicPiece.Column), extra: -1 }
    case LandmarkKind.Mausoleum: return { code: C(style === Style.Desert || (style === Style.Rainforest && (id & 1)) ? CivicPiece.PyramidTomb : CivicPiece.Mausoleum), extra: -1 }
    case LandmarkKind.Baths: return { code: C(CivicPiece.Baths), extra: -1 }
    case LandmarkKind.CouncilHouse: return { code: C(CivicPiece.CouncilHouse), extra: -1 }
    case LandmarkKind.Shrine: return { code: wood || style === Style.Temperate && (id % 3 === 0) ? SacredPiece.Grove : SacredPiece.StoneCircle, extra: -1 }
    default: return { code: sacredPiece(form, false), extra: -1 }
  }
}
