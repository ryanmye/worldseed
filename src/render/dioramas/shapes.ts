// Generated low-poly geometry for the diorama layer: the bulk houses of every building
// style, the landmarks of the styles the KayKit pack does not fit, walls, market stalls,
// trees and rocks, haystacks, the dam and the soft contact shadow.
//
// Units are KayKit model units (a KayKit house is ~0.8 wide), so one scale (models.ts KK)
// and the night-window pattern of the material fit both. y is up, the model faces +z,
// a house's frontage runs along x. Walls start below y = 0 (a foundation skirt), so a
// house sunk into a slope shows no gap.
//
// Colours: RGBA8 `aColor`, sRGB albedo plus a mask in alpha that the material reads:
//   0     fixed colour
//   128   wall: the colour is replaced by the instance's wall colour (rgb is a shade, 188 = 1x)
//   191   roof: replaced by the instance's roof colour (and whitened by its snow)
//   255   team colour (the KayKit packs' own mask)

import * as THREE from 'three'

export type RGB = readonly [number, number, number]

const M_FIXED = 0
const M_WALL = 128
const M_ROOF = 191
/** Shades of masked parts (188 is 1x in the material). */
const W: RGB = [188, 188, 188]
const W_DARK: RGB = [150, 150, 150]
const R: RGB = [188, 188, 188]
const R_DARK: RGB = [160, 160, 160]

type V3 = readonly [number, number, number]

export class Builder {
  pos: number[] = []
  col: number[] = []
  tri(a: V3, b: V3, c: V3, rgb: RGB, mask = M_FIXED) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
    for (let i = 0; i < 3; i++) this.col.push(rgb[0], rgb[1], rgb[2], mask)
  }
  quad(a: V3, b: V3, c: V3, d: V3, rgb: RGB, mask = M_FIXED) {
    this.tri(a, b, c, rgb, mask)
    this.tri(a, c, d, rgb, mask)
  }
  /** Axis-aligned box without a bottom face. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, rgb: RGB, mask = M_FIXED, top: RGB = rgb, topMask = mask) {
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top, topMask)
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], rgb, mask)
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], rgb, mask)
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], rgb, mask)
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], rgb, mask)
  }
  /**
   * Gable roof over [x0, x1] x [z0, z1] from eave height ye to ridge height yr, ridge along
   * x (alongX) or z, overhanging by o; the two gable ends are wall-coloured triangles.
   */
  gable(x0: number, x1: number, z0: number, z1: number, ye: number, yr: number, o: number, alongX: boolean, roof: RGB = R, wall: RGB = W, wallMask = M_WALL) {
    if (alongX) {
      const zc = (z0 + z1) / 2
      const slope = (yr - ye) / ((z1 - z0) / 2)
      const yo = ye - o * slope
      this.quad([x0 - o, yo, z0 - o], [x0 - o, yr, zc], [x1 + o, yr, zc], [x1 + o, yo, z0 - o], roof, M_ROOF)
      this.quad([x1 + o, yo, z1 + o], [x1 + o, yr, zc], [x0 - o, yr, zc], [x0 - o, yo, z1 + o], roof, M_ROOF)
      this.tri([x0, ye, z1], [x0, yr, zc], [x0, ye, z0], wall, wallMask)
      this.tri([x1, ye, z0], [x1, yr, zc], [x1, ye, z1], wall, wallMask)
    } else {
      const xc = (x0 + x1) / 2
      const slope = (yr - ye) / ((x1 - x0) / 2)
      const yo = ye - o * slope
      this.quad([x0 - o, yo, z1 + o], [xc, yr, z1 + o], [xc, yr, z0 - o], [x0 - o, yo, z0 - o], roof, M_ROOF)
      this.quad([x1 + o, yo, z0 - o], [xc, yr, z0 - o], [xc, yr, z1 + o], [x1 + o, yo, z1 + o], roof, M_ROOF)
      this.tri([x0, ye, z0], [xc, yr, z0], [x1, ye, z0], wall, wallMask)
      this.tri([x1, ye, z1], [xc, yr, z1], [x0, ye, z1], wall, wallMask)
    }
  }
  /** Hip roof (four slopes up to a short ridge along x, or a point). */
  hip(x0: number, x1: number, z0: number, z1: number, ye: number, yr: number, o: number, roof: RGB = R, mask = M_ROOF) {
    const a0 = x0 - o, a1 = x1 + o, b0 = z0 - o, b1 = z1 + o
    const zc = (z0 + z1) / 2
    const inset = Math.min((z1 - z0) / 2, (x1 - x0) / 2)
    const r0 = Math.min((x0 + x1) / 2, x0 + inset), r1 = Math.max((x0 + x1) / 2, x1 - inset)
    const yo = ye - o * 0.6
    this.quad([a0, yo, b0], [r0, yr, zc], [r1, yr, zc], [a1, yo, b0], roof, mask)
    this.quad([a1, yo, b1], [r1, yr, zc], [r0, yr, zc], [a0, yo, b1], roof, mask)
    this.tri([a0, yo, b1], [r0, yr, zc], [a0, yo, b0], roof, mask)
    this.tri([a1, yo, b0], [r1, yr, zc], [a1, yo, b1], roof, mask)
  }
  /** Frustum of a cone around the y axis (r0 at y0, r1 at y1; r1 = 0 is a cone), optional top cap. */
  frustum(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, seg: number, side: RGB, mask = M_FIXED, cap: RGB | null = side, capMask = mask, phase = 0) {
    for (let i = 0; i < seg; i++) {
      const a0 = ((i + phase) / seg) * Math.PI * 2, a1 = ((i + 1 + phase) / seg) * Math.PI * 2
      const p = (r: number, a: number, y: number): V3 => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)]
      if (r1 > 0) this.quad(p(r0, a1, y0), p(r1, a1, y1), p(r1, a0, y1), p(r0, a0, y0), side, mask)
      else this.tri(p(r0, a1, y0), [cx, y1, cz], p(r0, a0, y0), side, mask)
      if (r1 > 0 && cap) this.tri([cx, y1, cz], p(r1, a0, y1), p(r1, a1, y1), cap, capMask)
    }
  }
  /** Dome (half sphere, rings x seg) of radius r sitting at y0. */
  dome(cx: number, cz: number, y0: number, r: number, seg: number, rings: number, rgb: RGB, mask = M_FIXED) {
    for (let j = 0; j < rings; j++) {
      const t0 = (j / rings) * Math.PI / 2, t1 = ((j + 1) / rings) * Math.PI / 2
      const ra = Math.cos(t0) * r, rb = Math.cos(t1) * r
      const ya = y0 + Math.sin(t0) * r, yb = y0 + Math.sin(t1) * r
      this.frustum(cx, cz, ya, yb, ra, j === rings - 1 ? 0 : rb, seg, rgb, mask, null)
    }
  }
  /** Squashed rough rock (an irregular octahedron). */
  rock(cx: number, cz: number, r: number, h: number, rgb: RGB, twist: number) {
    const pts: V3[] = []
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + twist
      const rr = r * (0.75 + 0.35 * Math.abs(Math.sin(a * 3 + twist * 7)))
      pts.push([cx + Math.cos(a) * rr, h * 0.25, cz + Math.sin(a) * rr])
    }
    const top: V3 = [cx + r * 0.15, h, cz - r * 0.1]
    const bot: V3 = [cx, -0.1, cz]
    for (let i = 0; i < 5; i++) {
      const a = pts[i], b = pts[(i + 1) % 5]
      this.tri(b, top, a, rgb)
      this.tri(a, bot, b, rgb)
    }
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(this.col), 4, true))
    g.computeVertexNormals() // non-indexed: flat facets, the low-poly look of the packs
    return g
  }
}

// ---------- building styles ----------

export const Style = {
  Temperate: 0,
  Cold: 1,
  Mountain: 2,
  Desert: 3,
  Savanna: 4,
  Rainforest: 5,
} as const
export type Style = (typeof Style)[keyof typeof Style]
export const STYLE_COUNT = 6

/** Generated kinds per style: four house variants and three landmarks. */
export const Kind = {
  /** Small: cottage, hut. */
  Small: 0,
  /** The common house. */
  House: 1,
  /** Long: barn, workshop, warehouse, longhouse. */
  Long: 2,
  /** Tall: townhouse of the dense core. */
  Tall: 3,
  /** Hall: the style's church / temple / great hall. */
  Hall: 4,
  /** Tower: minaret, stave church, watchtower, temple pyramid. */
  Tower: 5,
  /** Fort: kasbah, stockade, citadel. */
  Fort: 6,
} as const
export type Kind = (typeof Kind)[keyof typeof Kind]
export const KIND_COUNT = 7

const DARK_WOOD: RGB = [92, 70, 52]
const STONE: RGB = [168, 160, 146]
const STONE_DARK: RGB = [128, 122, 112]
const CHIMNEY: RGB = [110, 96, 86]

function pitched(b: Builder, hw: number, hd: number, ye: number, yr: number, o: number, alongX = true, chimney = false) {
  b.box(-hw, -0.15, -hd, hw, ye, hd, W, M_WALL)
  b.gable(-hw, hw, -hd, hd, ye, yr, o, alongX)
  if (chimney) b.box(hw * 0.45, ye, -hd * 0.3, hw * 0.45 + 0.08, yr + 0.06, -hd * 0.3 + 0.08, CHIMNEY)
}

function stilts(b: Builder, hw: number, hd: number, y: number) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (hw - 0.05), z = sz * (hd - 0.05)
    b.box(x - 0.025, -0.15, z - 0.025, x + 0.025, y, z + 0.025, DARK_WOOD)
  }
  b.box(-hw - 0.03, y, -hd - 0.03, hw + 0.03, y + 0.05, hd + 0.03, DARK_WOOD)
}

function roundHut(b: Builder, cx: number, cz: number, r: number, wall: number, apex: number, seg = 7) {
  b.frustum(cx, cz, -0.15, wall, r, r, seg, W, M_WALL, null)
  b.frustum(cx, cz, wall - 0.04, apex, r * 1.25, 0, seg, R, M_ROOF, null, M_ROOF, 0.5)
}

function houseGeometry(style: Style, kind: Kind): THREE.BufferGeometry {
  const b = new Builder()
  switch (style) {
    case Style.Temperate:
      if (kind === Kind.Small) pitched(b, 0.3, 0.22, 0.3, 0.56, 0.05)
      else if (kind === Kind.House) pitched(b, 0.4, 0.27, 0.4, 0.72, 0.05, true, true)
      else if (kind === Kind.Long) pitched(b, 0.6, 0.27, 0.36, 0.66, 0.05)
      else pitched(b, 0.27, 0.33, 0.72, 1.0, 0.04, false, true)
      break
    case Style.Cold:
      if (kind === Kind.Small) pitched(b, 0.3, 0.22, 0.24, 0.62, 0.06)
      else if (kind === Kind.House) pitched(b, 0.42, 0.26, 0.3, 0.78, 0.06, true, true)
      else if (kind === Kind.Long) pitched(b, 0.7, 0.28, 0.28, 0.76, 0.07)
      else pitched(b, 0.3, 0.3, 0.56, 1.02, 0.05, false, true)
      break
    case Style.Mountain:
      // stone walls, low heavy roofs
      if (kind === Kind.Small) pitched(b, 0.3, 0.24, 0.3, 0.44, 0.07)
      else if (kind === Kind.House) pitched(b, 0.42, 0.28, 0.38, 0.54, 0.07, true, true)
      else if (kind === Kind.Long) pitched(b, 0.6, 0.28, 0.32, 0.48, 0.07)
      else {
        b.box(-0.28, -0.15, -0.28, 0.28, 0.86, 0.28, W, M_WALL)
        b.hip(-0.28, 0.28, -0.28, 0.28, 0.86, 1.06, 0.05)
      }
      break
    case Style.Desert:
      // flat-roofed adobe blocks; the roof mask is the terrace
      if (kind === Kind.Small) b.box(-0.27, -0.15, -0.27, 0.27, 0.36, 0.27, W, M_WALL, R, M_ROOF)
      else if (kind === Kind.House) {
        b.box(-0.4, -0.15, -0.3, 0.4, 0.38, 0.3, W, M_WALL, R, M_ROOF)
        b.box(-0.4, 0.38, -0.3, 0.02, 0.66, 0.06, W, M_WALL, R, M_ROOF)
      } else if (kind === Kind.Long) {
        b.box(-0.6, -0.15, -0.3, 0.6, 0.34, 0.3, W, M_WALL, R, M_ROOF)
        b.box(0.22, 0.34, -0.3, 0.6, 0.56, 0.0, W_DARK, M_WALL, R, M_ROOF)
      } else {
        b.box(-0.3, -0.15, -0.3, 0.3, 0.78, 0.3, W, M_WALL, R, M_ROOF)
        b.box(-0.3, 0.78, -0.3, 0.3, 0.84, -0.22, W_DARK, M_WALL) // parapet
      }
      break
    case Style.Savanna:
      if (kind === Kind.Small) roundHut(b, 0, 0, 0.25, 0.24, 0.6)
      else if (kind === Kind.House) {
        b.box(-0.36, -0.15, -0.24, 0.36, 0.28, 0.24, W, M_WALL)
        b.hip(-0.36, 0.36, -0.24, 0.24, 0.28, 0.56, 0.07)
      } else if (kind === Kind.Long) {
        roundHut(b, -0.3, 0, 0.21, 0.22, 0.52)
        roundHut(b, 0.3, 0.04, 0.24, 0.24, 0.58)
        b.frustum(0, 0, -0.15, 0.1, 0.66, 0.66, 10, W_DARK, M_WALL, null) // low compound wall
      } else roundHut(b, 0, 0, 0.34, 0.32, 0.82, 8)
      break
    case Style.Rainforest:
      if (kind === Kind.Small) {
        stilts(b, 0.3, 0.22, 0.2)
        b.box(-0.3, 0.25, -0.22, 0.3, 0.42, 0.22, W, M_WALL)
        b.gable(-0.3, 0.3, -0.22, 0.22, 0.42, 0.8, 0.09, true)
      } else if (kind === Kind.House) {
        stilts(b, 0.4, 0.26, 0.22)
        b.box(-0.4, 0.27, -0.26, 0.4, 0.46, 0.26, W, M_WALL)
        b.gable(-0.4, 0.4, -0.26, 0.26, 0.46, 0.9, 0.1, true)
      } else if (kind === Kind.Long) {
        stilts(b, 0.62, 0.26, 0.22)
        b.box(-0.62, 0.27, -0.26, 0.62, 0.46, 0.26, W, M_WALL)
        b.gable(-0.62, 0.62, -0.26, 0.26, 0.46, 0.88, 0.1, true)
      } else {
        // a big A-frame roof down to the ground
        b.box(-0.3, -0.15, -0.3, 0.3, 0.1, 0.3, W, M_WALL)
        b.gable(-0.3, 0.3, -0.3, 0.3, 0.1, 0.92, 0.06, false)
      }
      break
  }
  return b.build()
}

function landmarkGeometry(style: Style, kind: Kind): THREE.BufferGeometry {
  const b = new Builder()
  const s = style
  if (kind === Kind.Hall) {
    if (s === Style.Desert) {
      // domed hall with a small minaret at one corner
      b.box(-0.7, -0.15, -0.7, 0.7, 0.55, 0.7, W, M_WALL, R, M_ROOF)
      b.frustum(0, 0, 0.55, 0.62, 0.52, 0.52, 10, W, M_WALL)
      b.dome(0, 0, 0.62, 0.5, 10, 3, [214, 206, 188])
      b.frustum(0.58, 0.58, 0.55, 1.45, 0.11, 0.09, 8, W, M_WALL)
      b.dome(0.58, 0.58, 1.45, 0.12, 8, 2, [214, 206, 188])
    } else if (s === Style.Savanna) {
      roundHut(b, 0, 0, 0.6, 0.42, 1.3, 10)
      roundHut(b, -0.82, 0.3, 0.24, 0.24, 0.6)
      roundHut(b, 0.78, -0.42, 0.24, 0.24, 0.6)
    } else if (s === Style.Rainforest) {
      // stepped stone platform with a shrine
      const st: RGB = [158, 146, 122]
      b.box(-0.85, -0.15, -0.85, 0.85, 0.22, 0.85, st, M_FIXED, [176, 164, 140])
      b.box(-0.64, 0.22, -0.64, 0.64, 0.46, 0.64, st, M_FIXED, [176, 164, 140])
      b.box(-0.44, 0.46, -0.44, 0.44, 0.7, 0.44, st, M_FIXED, [176, 164, 140])
      b.box(-0.24, 0.7, -0.24, 0.24, 0.94, 0.24, W, M_WALL)
      b.hip(-0.24, 0.24, -0.24, 0.24, 0.94, 1.2, 0.08)
      b.quad([-0.18, -0.15, 0.85], [0.18, -0.15, 0.85], [0.18, 0.7, 0.44], [-0.18, 0.7, 0.44], [180, 168, 144]) // stair
    } else {
      // Cold (and fallback): a great longhouse
      b.box(-1.0, -0.15, -0.38, 1.0, 0.4, 0.38, W, M_WALL)
      b.gable(-1.0, 1.0, -0.38, 0.38, 0.4, 1.02, 0.08, true)
      b.box(-1.08, 0.9, -0.04, -0.92, 1.18, 0.04, DARK_WOOD) // gable posts
      b.box(0.92, 0.9, -0.04, 1.08, 1.18, 0.04, DARK_WOOD)
    }
  } else if (kind === Kind.Tower) {
    if (s === Style.Desert) {
      b.frustum(0, 0, -0.15, 1.3, 0.2, 0.16, 8, W, M_WALL)
      b.frustum(0, 0, 1.18, 1.26, 0.25, 0.25, 8, W_DARK, M_WALL)
      b.frustum(0, 0, 1.26, 1.62, 0.12, 0.11, 8, W, M_WALL)
      b.dome(0, 0, 1.62, 0.13, 8, 2, [214, 206, 188])
    } else if (s === Style.Savanna) {
      b.frustum(0, 0, -0.15, 0.95, 0.26, 0.22, 8, W, M_WALL, null)
      b.frustum(0, 0, 0.9, 1.4, 0.32, 0, 8, R, M_ROOF, null, M_ROOF, 0.5)
    } else if (s === Style.Rainforest) {
      // steep stepped temple pyramid
      const st: RGB = [150, 140, 118], top: RGB = [172, 160, 136]
      for (let i = 0; i < 5; i++) {
        const h = 0.62 - i * 0.12
        b.box(-h, -0.15 + i * 0.28, -h, h, 0.13 + i * 0.28, h, st, M_FIXED, top)
      }
      b.box(-0.16, 1.25, -0.16, 0.16, 1.5, 0.16, W, M_WALL)
      b.hip(-0.16, 0.16, -0.16, 0.16, 1.5, 1.7, 0.05)
    } else {
      // stave church: stacked steep roofs
      b.box(-0.38, -0.15, -0.38, 0.38, 0.42, 0.38, W, M_WALL)
      b.hip(-0.38, 0.38, -0.38, 0.38, 0.42, 0.72, 0.08)
      b.box(-0.22, 0.6, -0.22, 0.22, 0.92, 0.22, W, M_WALL)
      b.hip(-0.22, 0.22, -0.22, 0.22, 0.92, 1.18, 0.07)
      b.box(-0.1, 1.1, -0.1, 0.1, 1.28, 0.1, W_DARK, M_WALL)
      b.frustum(0, 0, 1.28, 1.7, 0.16, 0, 4, R_DARK, M_ROOF, null, M_ROOF, 0.5)
    }
  } else {
    // Fort
    if (s === Style.Desert) {
      // kasbah: four walls, corner towers, a keep
      const t = 0.14, e = 1.0, h = 0.6
      b.box(-e, -0.15, -e, e, h, -e + t, W, M_WALL, R, M_ROOF)
      b.box(-e, -0.15, e - t, e, h, e, W, M_WALL, R, M_ROOF)
      b.box(-e, -0.15, -e + t, -e + t, h, e - t, W, M_WALL, R, M_ROOF)
      b.box(e - t, -0.15, -e + t, e, h, e - t, W, M_WALL, R, M_ROOF)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * e - 0.18, -0.15, sz * e - 0.18, sx * e + 0.18, 0.95, sz * e + 0.18, W_DARK, M_WALL, R, M_ROOF)
      b.box(-0.42, -0.15, -0.42, 0.42, 1.05, 0.42, W, M_WALL, R, M_ROOF)
    } else if (s === Style.Savanna || s === Style.Rainforest) {
      // stockade ring around a great hut
      const pal: RGB = [118, 88, 60]
      b.frustum(0, 0, -0.15, 0.42, 1.0, 1.0, 14, pal, M_FIXED, null)
      b.frustum(0, 0, -0.15, 0.42, 0.95, 0.95, 14, pal, M_FIXED, null)
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2
        b.tri([Math.cos(a) * 1.0, 0.42, Math.sin(a) * 1.0], [Math.cos(a + 0.22) * 0.975, 0.52, Math.sin(a + 0.22) * 0.975], [Math.cos(a + 0.45) * 1.0, 0.42, Math.sin(a + 0.45) * 1.0], pal)
      }
      if (s === Style.Savanna) roundHut(b, 0, 0, 0.45, 0.36, 1.0, 9)
      else {
        stilts(b, 0.55, 0.3, 0.22)
        b.box(-0.55, 0.27, -0.3, 0.55, 0.5, 0.3, W, M_WALL)
        b.gable(-0.55, 0.55, -0.3, 0.3, 0.5, 1.0, 0.1, true)
      }
    } else {
      // Cold (and fallback): timber palisade square with a hall
      const pal: RGB = [104, 80, 58], e = 0.95
      b.box(-e, -0.15, -e, e, 0.4, -e + 0.08, pal)
      b.box(-e, -0.15, e - 0.08, e, 0.4, e, pal)
      b.box(-e, -0.15, -e, -e + 0.08, 0.4, e, pal)
      b.box(e - 0.08, -0.15, -e, e, 0.4, e, pal)
      b.box(-0.6, -0.15, -0.3, 0.6, 0.36, 0.3, W, M_WALL)
      b.gable(-0.6, 0.6, -0.3, 0.3, 0.36, 0.9, 0.07, true)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * e - 0.1, -0.15, sz * e - 0.1, sx * e + 0.1, 0.7, sz * e + 0.1, pal, M_FIXED, [80, 62, 46])
    }
  }
  return b.build()
}

/** Geometry of (style, kind). */
export function styleGeometry(style: Style, kind: Kind): THREE.BufferGeometry {
  return kind <= Kind.Tall ? houseGeometry(style, kind) : landmarkGeometry(style, kind)
}

// ---------- shared pieces ----------

/** Three haystacks: a squat drum under a rounded cone each. */
export function buildHaystacks(): THREE.BufferGeometry {
  const b = new Builder()
  const hay: RGB = [214, 172, 84], hayTop: RGB = [196, 150, 66], dark: RGB = [168, 128, 58]
  const stacks: [number, number, number][] = [[0, 0, 1], [0.27, 0.12, 0.8], [-0.12, 0.26, 0.7]]
  for (const [x, z, s] of stacks) {
    b.frustum(x, z, -0.05, 0.13 * s, 0.13 * s, 0.135 * s, 7, hay, M_FIXED, hayTop)
    b.frustum(x, z, 0.13 * s, 0.2 * s, 0.135 * s, 0.1 * s, 7, hayTop, M_FIXED, hayTop)
    b.frustum(x, z, 0.2 * s, 0.29 * s, 0.1 * s, 0, 7, dark, M_FIXED)
  }
  return b.build()
}

/**
 * A gently curved dam, 1 unit wide along x (scaled per instance to the river), bowed
 * upstream (-z; +z is downstream), with a darker spillway face.
 */
export function buildDam(): THREE.BufferGeometry {
  const b = new Builder()
  const concrete: RGB = [186, 180, 168], top: RGB = [206, 201, 190], face: RGB = [140, 136, 128], spill: RGB = [120, 160, 175]
  const seg = 8
  const H = 0.5, T = 0.14, bow = 0.14
  const zAt = (x: number) => -bow * (1 - 4 * x * x)
  for (let i = 0; i < seg; i++) {
    const xa = -0.5 + i / seg, xb = -0.5 + (i + 1) / seg
    const za = zAt(xa), zb = zAt(xb)
    const mid = i === seg / 2 - 1 || i === seg / 2
    b.quad([xa, -0.05, za - T * 0.5], [xa, H, za - T * 0.5], [xb, H, zb - T * 0.5], [xb, -0.05, zb - T * 0.5], concrete)
    b.quad([xa, H, za - T * 0.5], [xa, H, za + T * 0.5], [xb, H, zb + T * 0.5], [xb, H, zb - T * 0.5], top)
    b.quad([xb, -0.05, zb + T * 1.6], [xb, H, zb + T * 0.5], [xa, H, za + T * 0.5], [xa, -0.05, za + T * 1.6], mid ? spill : face)
  }
  b.box(-0.62, -0.05, -0.12, -0.48, H + 0.05, 0.22, concrete, M_FIXED, top)
  b.box(0.48, -0.05, -0.12, 0.62, H + 0.05, 0.22, concrete, M_FIXED, top)
  return b.build()
}

/** A town wall section, 1 unit long along x (scaled per instance), crenellated; wall-masked (stone, adobe or timber by style). */
export function buildWallSegment(): THREE.BufferGeometry {
  const b = new Builder()
  b.box(-0.5, -0.2, -0.07, 0.5, 0.36, 0.07, W, M_WALL, W_DARK, M_WALL)
  for (let i = 0; i < 4; i++) {
    const x = -0.5 + 0.06 + i * 0.25
    b.box(x, 0.36, -0.07, x + 0.12, 0.44, 0.07, W_DARK, M_WALL)
  }
  return b.build()
}

/** A wall tower or gate tower: a squat drum under a cone. */
export function buildWallTower(): THREE.BufferGeometry {
  const b = new Builder()
  b.frustum(0, 0, -0.2, 0.56, 0.17, 0.15, 7, W, M_WALL, null)
  b.frustum(0, 0, 0.54, 0.84, 0.2, 0, 7, R, M_ROOF, null, M_ROOF, 0.5)
  return b.build()
}

/** Market stalls: a cluster of awnings in fabric colours. */
export function buildStalls(): THREE.BufferGeometry {
  const b = new Builder()
  const cloth: RGB[] = [[196, 84, 62], [222, 200, 140], [96, 132, 150], [200, 160, 72], [150, 90, 120]]
  const stalls: [number, number, number][] = [[-0.42, -0.25, 0], [0.05, -0.32, 1], [0.45, -0.12, 2], [-0.3, 0.28, 3], [0.22, 0.3, 4]]
  for (const [x, z, c] of stalls) {
    b.box(x - 0.13, -0.1, z - 0.1, x + 0.13, 0.16, z + 0.1, [150, 120, 90])
    b.hip(x - 0.13, x + 0.13, z - 0.1, z + 0.1, 0.18, 0.3, 0.04, cloth[c], M_FIXED)
  }
  return b.build()
}

/** A simple well: a stone ring under a little roof. */
export function buildWell(): THREE.BufferGeometry {
  const b = new Builder()
  b.frustum(0, 0, -0.1, 0.14, 0.16, 0.16, 7, STONE, M_FIXED, STONE_DARK)
  b.box(-0.15, 0.14, -0.02, -0.12, 0.38, 0.02, DARK_WOOD)
  b.box(0.12, 0.14, -0.02, 0.15, 0.38, 0.02, DARK_WOOD)
  b.gable(-0.19, 0.19, -0.13, 0.13, 0.34, 0.46, 0.02, true)
  return b.build()
}

/** A short town bridge, 1 unit long along x (scaled to the river per instance) and 1 wide along z. */
export function buildTownBridge(): THREE.BufferGeometry {
  const b = new Builder()
  const stone: RGB = [176, 164, 142], dark: RGB = [136, 126, 110], deck: RGB = [150, 128, 98]
  b.box(-0.55, 0.1, -0.5, 0.55, 0.2, 0.5, stone, M_FIXED, deck)
  b.box(-0.55, 0.2, -0.5, 0.55, 0.3, -0.38, dark)
  b.box(-0.55, 0.2, 0.38, 0.55, 0.3, 0.5, dark)
  b.box(-0.08, -0.3, -0.45, 0.08, 0.1, 0.45, dark)
  b.box(-0.6, -0.3, -0.5, -0.45, 0.2, 0.5, dark)
  b.box(0.45, -0.3, -0.5, 0.6, 0.2, 0.5, dark)
  return b.build()
}

// ---------- vegetation ----------

export const Flora = {
  Broadleaf: 0,
  Conifer: 1,
  Palm: 2,
  Acacia: 3,
  Cactus: 4,
  Rocks: 5,
  Jungle: 6,
} as const
export type Flora = (typeof Flora)[keyof typeof Flora]
export const FLORA_COUNT = 7

const TRUNK: RGB = [104, 80, 58]

/** A small grove of a kind of tree (or a scatter of rocks), ~1.2 units across. */
export function floraGeometry(kind: Flora): THREE.BufferGeometry {
  const b = new Builder()
  const spots: [number, number, number][] = [[0, 0, 1], [0.42, 0.2, 0.85], [-0.36, 0.3, 0.9], [0.12, -0.42, 0.75], [-0.3, -0.3, 0.8]]
  switch (kind) {
    case Flora.Broadleaf: {
      const greens: RGB[] = [[86, 116, 58], [100, 128, 64], [74, 104, 52]]
      spots.forEach(([x, z, s], i) => {
        if (i > 3) return
        b.box(x - 0.03 * s, -0.1, z - 0.03 * s, x + 0.03 * s, 0.22 * s, z + 0.03 * s, TRUNK)
        b.frustum(x, z, 0.16 * s, 0.38 * s, 0.14 * s, 0.24 * s, 6, greens[i % 3], M_FIXED, null, M_FIXED, i * 0.3)
        b.frustum(x, z, 0.38 * s, 0.58 * s, 0.24 * s, 0, 6, greens[i % 3], M_FIXED, null, M_FIXED, i * 0.3)
      })
      break
    }
    case Flora.Conifer: {
      const g: RGB[] = [[54, 84, 60], [62, 92, 64], [48, 76, 56]]
      spots.forEach(([x, z, s], i) => {
        b.box(x - 0.025, -0.1, z - 0.025, x + 0.025, 0.12 * s, z + 0.025, TRUNK)
        b.frustum(x, z, 0.08 * s, 0.5 * s, 0.17 * s, 0, 6, g[i % 3])
        b.frustum(x, z, 0.36 * s, 0.76 * s, 0.12 * s, 0, 6, g[(i + 1) % 3])
      })
      break
    }
    case Flora.Palm:
    case Flora.Jungle: {
      const frond: RGB = kind === Flora.Palm ? [92, 132, 62] : [62, 104, 50]
      spots.forEach(([x, z, s], i) => {
        if (kind === Flora.Palm && i > 2) return
        const lean = 0.08 * s * (i % 2 ? 1 : -1)
        const h = 0.62 * s
        const tx = x + lean, tz = z + lean * 0.5
        b.quad([x - 0.025, -0.1, z], [x + 0.025, -0.1, z], [tx + 0.02, h, tz], [tx - 0.02, h, tz], TRUNK)
        b.quad([x, -0.1, z - 0.025], [x, -0.1, z + 0.025], [tx, h, tz + 0.02], [tx, h, tz - 0.02], TRUNK)
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + i
          const ca = Math.cos(a), sa = Math.sin(a)
          const L = 0.3 * s
          b.tri([tx, h + 0.03, tz], [tx + ca * L - sa * 0.07, h - 0.12 * s, tz + sa * L + ca * 0.07], [tx + ca * L + sa * 0.07, h - 0.12 * s, tz + sa * L - ca * 0.07], frond)
        }
        if (kind === Flora.Jungle) b.frustum(x + 0.15, z - 0.12, -0.1, 0.22 * s, 0.2 * s, 0, 5, [52, 90, 46])
      })
      break
    }
    case Flora.Acacia: {
      const g: RGB = [116, 128, 62]
      for (const [x, z, s] of [spots[0], spots[2]]) {
        b.quad([x - 0.025, -0.1, z], [x + 0.025, -0.1, z], [x + 0.06, 0.34 * s, z], [x + 0.02, 0.34 * s, z], TRUNK)
        b.quad([x, -0.1, z - 0.025], [x, -0.1, z + 0.025], [x + 0.04, 0.34 * s, z + 0.02], [x + 0.04, 0.34 * s, z - 0.02], TRUNK)
        b.frustum(x + 0.04, z, 0.32 * s, 0.42 * s, 0.3 * s, 0.22 * s, 7, g, M_FIXED, g)
      }
      break
    }
    case Flora.Cactus: {
      const g: RGB = [96, 124, 76]
      spots.forEach(([x, z, s], i) => {
        if (i > 2) return
        b.box(x - 0.035, -0.1, z - 0.035, x + 0.035, 0.42 * s, z + 0.035, g)
        b.box(x + 0.035, 0.14 * s, z - 0.025, x + 0.11, 0.19 * s, z + 0.025, g)
        b.box(x + 0.07, 0.19 * s, z - 0.025, x + 0.11, 0.32 * s, z + 0.025, g)
        b.box(x - 0.1, 0.2 * s, z - 0.025, x - 0.035, 0.25 * s, z + 0.025, g)
        b.box(x - 0.1, 0.25 * s, z - 0.025, x - 0.065, 0.34 * s, z + 0.025, g)
      })
      b.rock(0.3, -0.3, 0.12, 0.1, [176, 150, 116], 1.3)
      break
    }
    case Flora.Rocks: {
      const c: RGB[] = [[132, 126, 118], [116, 112, 106], [148, 140, 128]]
      spots.forEach(([x, z, s], i) => b.rock(x * 0.8, z * 0.8, 0.16 * s, 0.16 * s, c[i % 3], i * 1.7))
      break
    }
  }
  return b.build()
}

/** Unit disk in the xz plane; alpha 1 at the centre falling to 0 at the rim. */
export function buildBlob(): THREE.BufferGeometry {
  const seg = 16
  const pos = [0, 0, 0]
  const col = [0, 0, 0, 255]
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    for (const [r, alpha] of [[0.55, 170], [1, 0]] as const) {
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r)
      col.push(0, 0, 0, alpha)
    }
  }
  const index: number[] = []
  for (let i = 0; i < seg; i++) {
    const a = 1 + i * 2, b = 1 + (i + 1) * 2
    index.push(0, b, a)
    index.push(a, b, b + 1, a, b + 1, a + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setAttribute('aColor', new THREE.BufferAttribute(new Uint8Array(col), 4, true))
  g.setIndex(index)
  return g
}
