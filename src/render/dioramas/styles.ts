// Building styles by biome and climate, their wall / roof / ground colours, and what grows
// in the countryside. A settlement's style comes from its own cell; its houses blend in
// the styles of neighbouring land cells (a town on a biome boundary is mixed) and, a
// little, the style of the settlement its founders came from.

import { Biome, type World } from '../../contract.ts'
import { snowFactor } from '../palette.ts'
import { Flora, Style, type Style as StyleT } from './shapes.ts'

export function styleOfCell(world: World, c: number): StyleT {
  const b = world.biome[c]
  const e = world.elevation[c]
  if (b === Biome.Mountain || e > 0.38) return Style.Mountain
  switch (b) {
    case Biome.Desert: return Style.Desert
    case Biome.Savanna: return Style.Savanna
    case Biome.Rainforest: return Style.Rainforest
    case Biome.Tundra:
    case Biome.Taiga:
    case Biome.Ice: return Style.Cold
    default: return world.temperature[c] < 0.3 ? Style.Cold : Style.Temperate
  }
}

/** Snow on roofs, 0..1, matched to the planet's snow line (palette.ts snowFactor, the shader's 0.42..0.58 contour). */
export function roofSnow(world: World, c: number): number {
  const s = snowFactor(world, c)
  const t = Math.min(1, Math.max(0, (s - 0.3) / 0.3))
  return t * t * (3 - 2 * t)
}

type RGB = readonly [number, number, number]

/** Wall colours per style (sRGB); the bulk houses pick one per lot. */
export const WALLS: readonly (readonly RGB[])[] = [
  [[222, 210, 186], [232, 226, 212], [204, 182, 146], [150, 116, 86]], // Temperate: plaster, white, ochre, timber
  [[104, 78, 58], [124, 94, 68], [128, 60, 46], [112, 106, 98]], // Cold: dark timber, red-painted, grey
  [[150, 146, 138], [130, 126, 120], [166, 158, 144], [140, 132, 120]], // Mountain: stone
  [[196, 162, 116], [178, 130, 84], [206, 182, 142], [176, 124, 92]], // Desert: sand, ochre, pale, adobe
  [[158, 104, 68], [172, 100, 64], [178, 140, 98], [146, 112, 80]], // Savanna: earth, red earth, mud
  [[150, 112, 76], [186, 160, 110], [162, 124, 84], [132, 100, 70]], // Rainforest: wood, bamboo
]
/** Roof colours per style (sRGB). */
export const ROOFS: readonly (readonly RGB[])[] = [
  [[166, 82, 56], [140, 68, 50], [104, 104, 108], [172, 142, 92], [124, 84, 62]], // terracotta, dark tile, slate, thatch, brown
  [[72, 68, 64], [98, 100, 66], [82, 86, 94], [92, 74, 58], [110, 96, 80]], // dark, turf, slate, shingle
  [[80, 82, 88], [110, 106, 100], [92, 72, 58], [96, 96, 98], [124, 116, 104]], // slate, stone, dark wood
  [[204, 176, 132], [188, 152, 104], [214, 196, 160], [194, 162, 118], [178, 140, 98]], // terraces
  [[196, 158, 90], [176, 138, 76], [150, 116, 66], [188, 152, 92], [166, 128, 74]], // thatch
  [[180, 156, 92], [158, 142, 82], [138, 120, 70], [170, 148, 86], [150, 130, 76]], // palm thatch
]
/** Whitewash for warm coastal towns. */
export const WHITEWASH: RGB = [238, 236, 228]
/** Packed earth under built-up patches, per style (sRGB). */
export const GROUND: readonly RGB[] = [[150, 136, 108], [120, 110, 98], [138, 132, 122], [190, 164, 124], [164, 122, 86], [138, 112, 78]]
/**
 * Town ground per kind (town.ts GroundKind: street, square, yard, garden soil) and style
 * (sRGB): packed earth and cobbles, pale dust in the desert, dark mud in the north.
 */
export const GROUND_KINDS: readonly (readonly RGB[])[] = [
  [[108, 96, 80], [94, 84, 72], [104, 98, 90], [186, 164, 126], [150, 106, 70], [106, 80, 54]],
  [[124, 116, 104], [96, 90, 82], [118, 112, 104], [196, 178, 144], [150, 120, 92], [124, 100, 74]],
  [[92, 98, 62], [88, 92, 68], [92, 92, 74], [168, 148, 110], [140, 116, 74], [74, 90, 48]],
  [[88, 70, 50], [68, 56, 46], [86, 74, 60], [150, 118, 82], [124, 86, 56], [86, 64, 44]],
]
/** Town walls per style (sRGB): stone, timber, stone, adobe, timber, timber. */
export const WALL_STONE: readonly RGB[] = [[170, 162, 146], [112, 86, 62], [150, 146, 138], [206, 174, 126], [128, 94, 64], [112, 84, 58]]

export const srgbToLinear = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** Whether KayKit's medieval landmarks fit the style (elsewhere generated ones stand in). */
export const kaykitFits = (s: StyleT) => s === Style.Temperate || s === Style.Mountain

/** Countryside flora of a cell: grove kinds with weights (empty: nothing grows to speak of). */
export function floraOf(world: World, c: number): { kinds: Flora[]; count: number } {
  const b = world.biome[c]
  const coastalHot = world.temperature[c] > 0.8
  switch (b) {
    case Biome.TemperateForest: return { kinds: [Flora.Broadleaf, Flora.Broadleaf, Flora.Conifer], count: 5 }
    case Biome.Grassland: return { kinds: [Flora.Broadleaf], count: 2 }
    case Biome.Taiga: return { kinds: [Flora.Conifer], count: 5 }
    case Biome.Tundra: return { kinds: [Flora.Rocks], count: 1 }
    case Biome.Desert: return { kinds: [Flora.Cactus, Flora.Rocks], count: 2 }
    case Biome.Savanna: return { kinds: coastalHot ? [Flora.Acacia, Flora.Palm] : [Flora.Acacia], count: 2 }
    case Biome.Rainforest: return { kinds: [Flora.Jungle, Flora.Palm], count: 5 }
    case Biome.Mountain: return { kinds: [Flora.Conifer, Flora.Rocks], count: 2 }
    default: return { kinds: [], count: 0 }
  }
}

/** Whether windmills make sense in the style's countryside. */
export const windmillsFit = (s: StyleT) => s === Style.Temperate || s === Style.Cold
