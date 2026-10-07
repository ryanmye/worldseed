// Colour mappings for each view mode. All colours are sRGB in 0..1, written
// into a caller-provided array at offset o to avoid per-cell allocation.
// The shader decodes them to linear before lighting.

import type { World } from '../contract.ts'
import { Biome } from '../contract.ts'

export const ViewMode = {
  Terrain: 'terrain',
  Elevation: 'elevation',
  Temperature: 'temperature',
  Rainfall: 'rainfall',
  Plates: 'plates',
  Biomes: 'biomes',
  Population: 'population',
  /** Static year-0 per-cell carrying capacity (formerly shown, misleadingly, as "Population"). */
  Capacity: 'capacity',
  LandUse: 'landuse',
  /** Main staple crop per cell at the current land snapshot (History.crop; hidden without it). */
  Crops: 'crops',
  /** Main herd animal per cell (History.herd). */
  Herds: 'herds',
  /** Main cash crop (fibre, luxury or stimulant) per cell (History.cash). */
  Cash: 'cash',
  /** polities: flat political map (render/polities.ts draws the factions over a neutral base; hidden without polity data). */
  Factions: 'factions',
  /** polities: danger (raids, war, lawlessness) per land cell as a heat map (render/polities.ts), over a neutral base. */
  Danger: 'danger',
  /** religion: majority faith of the land of each settlement (ui/faithsPanel.ts colours it; hidden without faiths). */
  Faiths: 'faiths',
  /** goods: deposits, mines and the industries of towns over a muted relief (ui/goodsPanel.ts, render/longhaul.ts; hidden without goods data). */
  Resources: 'resources',
  /** disease: place-bound fever per cell as a heat map (History.fever; optionally as one people feels it, ui/diseasePanel.ts; hidden without it). */
  Fever: 'fever',
  /** tourism: scenery per land cell, coloured by what makes it fine (History.scenery, sceneryKind; ui/tourismPanel.ts; hidden without it). */
  Scenery: 'scenery',
  /** ideas: peoples' lands by the number of ideas held at the year, or by when they took up the selected idea (ui/ideasPanel.ts colours it; hidden without ideas). */
  Ideas: 'ideas',
} as const
export type ViewMode = (typeof ViewMode)[keyof typeof ViewMode]

export const VIEW_MODES: ViewMode[] = [
  ViewMode.Terrain,
  ViewMode.Elevation,
  ViewMode.Temperature,
  ViewMode.Rainfall,
  ViewMode.Plates,
  ViewMode.Biomes,
  ViewMode.Population,
  ViewMode.Capacity,
  ViewMode.LandUse,
  ViewMode.Crops,
  ViewMode.Herds,
  ViewMode.Cash,
  ViewMode.Factions,
  ViewMode.Danger,
  ViewMode.Faiths,
  ViewMode.Resources,
  ViewMode.Fever,
  ViewMode.Scenery,
  ViewMode.Ideas,
]

export function isViewMode(s: string | null): s is ViewMode {
  return s !== null && (VIEW_MODES as string[]).includes(s)
}

/** How the shader blends the three corner colours of a triangle. */
export const BlendStyle = {
  /** Satellite-style terrain: perturbed crisp boundaries, ocean/ice/snow shading. */
  Terrain: 0,
  /** Continuous data: plain linear interpolation. */
  Smooth: 1,
  /** Categorical data: perturbed crisp boundaries, flat lighting. */
  Categorical: 2,
} as const

export function blendStyleFor(mode: ViewMode): number {
  switch (mode) {
    case ViewMode.Terrain: return BlendStyle.Terrain
    case ViewMode.Plates:
    case ViewMode.Biomes:
    case ViewMode.Population:
    case ViewMode.Capacity:
    case ViewMode.Crops:
    case ViewMode.Herds:
    case ViewMode.Cash:
    case ViewMode.Factions:
    case ViewMode.Danger:
    case ViewMode.Faiths:
    case ViewMode.Ideas:
    case ViewMode.Resources: return BlendStyle.Categorical
    default: return BlendStyle.Smooth
  }
}

export const BIOME_NAMES: Record<number, string> = {
  [Biome.Ocean]: 'Ocean',
  [Biome.Coast]: 'Coast',
  [Biome.Ice]: 'Ice',
  [Biome.Tundra]: 'Tundra',
  [Biome.Taiga]: 'Taiga',
  [Biome.TemperateForest]: 'Temperate Forest',
  [Biome.Grassland]: 'Grassland',
  [Biome.Desert]: 'Desert',
  [Biome.Savanna]: 'Savanna',
  [Biome.Rainforest]: 'Rainforest',
  [Biome.Mountain]: 'Mountain',
}

type RGB = readonly [number, number, number]
const rgb = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255]

/** Categorical colours for the Biomes view (map-like, distinct, not garish). */
const BIOME_COLOR: Record<number, RGB> = {
  [Biome.Ocean]: rgb(30, 62, 112),
  [Biome.Coast]: rgb(62, 124, 168),
  [Biome.Ice]: rgb(236, 241, 246),
  [Biome.Tundra]: rgb(160, 158, 132),
  [Biome.Taiga]: rgb(52, 96, 78),
  [Biome.TemperateForest]: rgb(66, 128, 62),
  [Biome.Grassland]: rgb(160, 178, 92),
  [Biome.Desert]: rgb(228, 204, 142),
  [Biome.Savanna]: rgb(198, 168, 90),
  [Biome.Rainforest]: rgb(26, 104, 52),
  [Biome.Mountain]: rgb(136, 118, 104),
}

function write(c: RGB, out: Float32Array | Uint8Array, o: number, scale: number) {
  out[o] = c[0] * scale
  out[o + 1] = c[1] * scale
  out[o + 2] = c[2] * scale
}

function lerp3(a: RGB, b: RGB, t: number): [number, number, number] {
  const ct = Math.max(0, Math.min(1, t))
  return [a[0] + (b[0] - a[0]) * ct, a[1] + (b[1] - a[1]) * ct, a[2] + (b[2] - a[2]) * ct]
}

function ramp(stops: readonly (readonly [number, RGB])[], x: number): [number, number, number] {
  if (x <= stops[0][0]) return [...stops[0][1]]
  for (let k = 1; k < stops.length; k++) {
    if (x <= stops[k][0]) {
      const [t0, c0] = stops[k - 1]
      const [t1, c1] = stops[k]
      return lerp3(c0, c1, (x - t0) / (t1 - t0))
    }
  }
  return [...stops[stops.length - 1][1]]
}

// ---------- Terrain (satellite-style) ----------

// Land albedo as a continuous function of climate, so biomes blend the way
// they do in satellite imagery: arid = light, desaturated sand and steppe;
// wet = deep saturated green; cold = dull olive-brown.
const CLIMATE_T = [0.0, 0.15, 0.3, 0.5, 0.72, 0.9] as const
const CLIMATE_R = [0.0, 0.12, 0.25, 0.4, 0.6, 0.85] as const
// rows: temperature, columns: rainfall
const CLIMATE_TABLE: RGB[][] = [
  [rgb(146, 141, 130), rgb(132, 129, 117), rgb(118, 118, 106), rgb(108, 110, 98), rgb(98, 103, 92), rgb(92, 98, 88)],
  [rgb(146, 136, 116), rgb(126, 122, 98), rgb(106, 109, 84), rgb(92, 99, 76), rgb(80, 92, 70), rgb(72, 86, 66)],
  [rgb(162, 150, 120), rgb(124, 121, 88), rgb(76, 90, 60), rgb(52, 74, 50), rgb(42, 66, 46), rgb(36, 60, 42)],
  [rgb(196, 170, 128), rgb(166, 150, 104), rgb(124, 130, 76), rgb(80, 104, 52), rgb(52, 86, 40), rgb(40, 76, 36)],
  [rgb(206, 170, 120), rgb(180, 152, 100), rgb(142, 138, 78), rgb(98, 114, 52), rgb(50, 90, 34), rgb(34, 78, 30)],
  [rgb(212, 168, 112), rgb(186, 150, 94), rgb(152, 138, 74), rgb(104, 116, 48), rgb(44, 88, 32), rgb(28, 74, 28)],
]

function bracket(xs: readonly number[], x: number): [number, number] {
  if (x <= xs[0]) return [0, 0]
  for (let k = 1; k < xs.length; k++) {
    if (x <= xs[k]) return [k - 1, (x - xs[k - 1]) / (xs[k] - xs[k - 1])]
  }
  return [xs.length - 2, 1]
}

function climateColor(t: number, r: number): [number, number, number] {
  const [ti, tf] = bracket(CLIMATE_T, t)
  const [ri, rf] = bracket(CLIMATE_R, r)
  const ti1 = Math.min(ti + 1, CLIMATE_T.length - 1)
  const ri1 = Math.min(ri + 1, CLIMATE_R.length - 1)
  const a = lerp3(CLIMATE_TABLE[ti][ri], CLIMATE_TABLE[ti][ri1], rf)
  const b = lerp3(CLIMATE_TABLE[ti1][ri], CLIMATE_TABLE[ti1][ri1], rf)
  return lerp3(a, b, tf)
}

const ROCK_DRY = rgb(150, 132, 112)
const ROCK_WET = rgb(98, 94, 86)
const SNOW = rgb(240, 244, 248)

/** Land albedo (sRGB) before snow; snow and sea ice are applied in the shader. */
export function terrainColor(world: World, i: number, out: Float32Array | Uint8Array, o: number, scale = 1): void {
  const e = Math.max(0, world.elevation[i])
  const t = world.temperature[i]
  const r = world.rainfall[i]
  if (world.biome[i] === Biome.Ice && world.elevation[i] >= 0) {
    write(SNOW, out, o, scale)
    return
  }
  // Use sea-level-equivalent temperature for vegetation so the lapse rate
  // reads as rock and snow rather than as tundra stripes up every slope.
  let c = climateColor(Math.min(1, t + 0.25 * e), r)
  const rock = lerp3(ROCK_DRY, ROCK_WET, r * 1.4)
  c = lerp3(c, rock, smooth(0.28, 0.75, e) * 0.85)
  write(c, out, o, scale)
}

/** 0..1 snow cover factor, 0.5 at the snow line. Driven by temperature, colder for very high peaks. */
export function snowFactor(world: World, i: number): number {
  const e = world.elevation[i]
  if (e < 0) return 0
  const tEff = world.temperature[i] - 0.22 * smooth(0.45, 1.0, e)
  return clamp01(0.5 + (0.13 - tEff) / 0.09)
}

/** 0..1 sea-ice factor for water, 0.5 at the freezing line. */
export function seaIceFactor(world: World, i: number): number {
  return clamp01(0.5 + (0.075 - world.temperature[i]) / 0.05)
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
function smooth(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

// ---------- Data views ----------

const ELEV_SEA: readonly (readonly [number, RGB])[] = [
  [-1, rgb(10, 26, 66)],
  [-0.5, rgb(24, 62, 120)],
  [-0.12, rgb(52, 112, 168)],
  [0, rgb(118, 176, 210)],
]
const ELEV_LAND: readonly (readonly [number, RGB])[] = [
  [0, rgb(62, 120, 72)],
  [0.12, rgb(128, 160, 92)],
  [0.3, rgb(214, 196, 128)],
  [0.55, rgb(168, 118, 78)],
  [0.8, rgb(124, 100, 92)],
  [1, rgb(246, 246, 246)],
]
const TEMP_STOPS: readonly (readonly [number, RGB])[] = [
  [0, rgb(42, 30, 110)],
  [0.2, rgb(52, 92, 190)],
  [0.4, rgb(88, 184, 208)],
  [0.6, rgb(222, 222, 120)],
  [0.8, rgb(238, 136, 60)],
  [1, rgb(176, 32, 38)],
]
const RAIN_STOPS: readonly (readonly [number, RGB])[] = [
  [0, rgb(170, 128, 72)],
  [0.2, rgb(214, 194, 120)],
  [0.45, rgb(120, 178, 96)],
  [0.7, rgb(40, 140, 140)],
  [1, rgb(30, 70, 160)],
]
const SEA_TINT = 0.55

/** Extra per-cell data some view modes need (it arrives later than the world). */
export interface ModeData {
  /** Carrying capacity per cell in people, from the settlement history (Capacity view). */
  capacity: Float32Array | null
  capacityMax: number
  /** People per cell at the current snapshot, spread from settlement populations (Population view). */
  density?: Float32Array | null
  /** Fixed colour-scale maximum for `density`, from the first NORM_YEARS of the history. */
  densityMax?: number
  /** Crops, Herds and Cash crops views: sRGB 0..255 per cell (3 per cell) for the land snapshot shown, or null (all land neutral). */
  speciesRgb?: Uint8Array | null
  /** Faiths view: sRGB 0..255 per cell (3 per cell), or null (all land neutral). */
  faithRgb?: Uint8Array | null
  /** Fever view: sRGB 0..255 per cell (3 per cell), or null (all land neutral). */
  feverRgb?: Uint8Array | null
  /** Scenery view: sRGB 0..255 per cell (3 per cell), or null (all land neutral). */
  sceneryRgb?: Uint8Array | null
  /** Ideas view: sRGB 0..255 per cell (3 per cell), or null (all land neutral). */
  ideasRgb?: Uint8Array | null
}

/** Capacity and Population views: heat ramp over a 0..1 normalised value. */
const CAPACITY_STOPS: readonly (readonly [number, RGB])[] = [
  [0, rgb(40, 30, 52)],
  [0.25, rgb(98, 34, 96)],
  [0.5, rgb(186, 52, 68)],
  [0.75, rgb(238, 126, 48)],
  [1, rgb(252, 222, 132)],
]
const CAPACITY_WATER = rgb(14, 22, 38)
const CAPACITY_BARREN = rgb(30, 30, 36)

/** CSS colour of the Population view's heat ramp at a 0..1 position, for its legend. */
export function densityRampCss(frac: number): string {
  const [r, g, b] = ramp(CAPACITY_STOPS, Math.max(0, Math.min(1, frac)))
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}
/** Land use view: the base under the shader's cultivation / degradation ramp (which needs the year). */
const LANDUSE_WILD = rgb(46, 52, 50)
/** Factions view: stateless land (the factions are drawn over it); Danger view: land under the heat ramp. */
const FACTIONS_STATELESS = rgb(96, 97, 92)
const FACTIONS_WATER = rgb(18, 30, 52)
const DANGER_LAND = rgb(42, 46, 48)
/** Resources view: low ground and high ground of its muted relief. */
const RESOURCES_LOW = rgb(74, 80, 70)
const RESOURCES_HIGH = rgb(150, 132, 108)
const RESOURCES_WATER = rgb(34, 48, 66)

export function colorForMode(
  mode: ViewMode,
  world: World,
  i: number,
  out: Float32Array | Uint8Array,
  o: number,
  scale = 1,
  data: ModeData | null = null,
): void {
  const e = world.elevation[i]
  switch (mode) {
    case ViewMode.Terrain:
      terrainColor(world, i, out, o, scale)
      return
    case ViewMode.Elevation:
      write(e < 0 ? ramp(ELEV_SEA, e) : ramp(ELEV_LAND, e), out, o, scale)
      return
    case ViewMode.Temperature: {
      const c = ramp(TEMP_STOPS, world.temperature[i])
      write(e < 0 ? lerp3(c, rgb(64, 72, 92), 1 - SEA_TINT) : c, out, o, scale)
      return
    }
    case ViewMode.Rainfall: {
      const c = ramp(RAIN_STOPS, world.rainfall[i])
      write(e < 0 ? rgb(22, 34, 56) : c, out, o, scale)
      return
    }
    case ViewMode.Plates: {
      const p = world.plate[i]
      const c = hsl((p * 0.6180339887) % 1, 0.5, e < 0 ? 0.34 : 0.56)
      write(c, out, o, scale)
      return
    }
    case ViewMode.Biomes:
      write(BIOME_COLOR[world.biome[i]] ?? BIOME_COLOR[Biome.Grassland], out, o, scale)
      return
    case ViewMode.Population: {
      const water = e < 0 || world.lake?.[i] === 1
      const d = data?.density ? data.density[i] : 0
      const dMax = data?.densityMax ?? 0
      if (water) write(CAPACITY_WATER, out, o, scale)
      else if (d <= 0 || !data || dMax <= 0) write(CAPACITY_BARREN, out, o, scale)
      else write(ramp(CAPACITY_STOPS, Math.log1p(d) / Math.log1p(dMax)), out, o, scale)
      return
    }
    case ViewMode.Capacity: {
      const water = e < 0 || world.lake?.[i] === 1
      const cap = data?.capacity ? data.capacity[i] : 0
      if (water) write(CAPACITY_WATER, out, o, scale)
      else if (cap <= 0 || !data || data.capacityMax <= 0) write(CAPACITY_BARREN, out, o, scale)
      else write(ramp(CAPACITY_STOPS, Math.sqrt(cap / data.capacityMax)), out, o, scale)
      return
    }
    case ViewMode.LandUse: {
      const water = e < 0 || world.lake?.[i] === 1
      write(water ? CAPACITY_WATER : LANDUSE_WILD, out, o, scale)
      return
    }
    case ViewMode.Crops:
    case ViewMode.Herds:
    case ViewMode.Cash: {
      const water = e < 0 || world.lake?.[i] === 1
      const c = data?.speciesRgb
      if (water) write(CAPACITY_WATER, out, o, scale)
      else if (c && c.length >= (i + 1) * 3) {
        out[o] = (c[i * 3] / 255) * scale
        out[o + 1] = (c[i * 3 + 1] / 255) * scale
        out[o + 2] = (c[i * 3 + 2] / 255) * scale
      } else write(LANDUSE_WILD, out, o, scale)
      return
    }
    case ViewMode.Fever:
    case ViewMode.Scenery: {
      const water = e < 0 || world.lake?.[i] === 1
      const c = mode === ViewMode.Scenery ? data?.sceneryRgb : data?.feverRgb
      if (water) write(CAPACITY_WATER, out, o, scale)
      else if (c && c.length >= (i + 1) * 3) {
        out[o] = (c[i * 3] / 255) * scale
        out[o + 1] = (c[i * 3 + 1] / 255) * scale
        out[o + 2] = (c[i * 3 + 2] / 255) * scale
      } else write(DANGER_LAND, out, o, scale)
      return
    }
    case ViewMode.Ideas: {
      const c = data?.ideasRgb
      if (e < 0 || world.lake?.[i] === 1) write(FACTIONS_WATER, out, o, scale)
      else if (c && c.length >= (i + 1) * 3) {
        out[o] = (c[i * 3] / 255) * scale
        out[o + 1] = (c[i * 3 + 1] / 255) * scale
        out[o + 2] = (c[i * 3 + 2] / 255) * scale
      } else write(DANGER_LAND, out, o, scale)
      return
    }
    case ViewMode.Faiths: {
      const water = e < 0 || world.lake?.[i] === 1
      const c = data?.faithRgb
      if (water) write(FACTIONS_WATER, out, o, scale)
      else if (c && c.length >= (i + 1) * 3) {
        out[o] = (c[i * 3] / 255) * scale
        out[o + 1] = (c[i * 3 + 1] / 255) * scale
        out[o + 2] = (c[i * 3 + 2] / 255) * scale
      } else write(DANGER_LAND, out, o, scale)
      return
    }
    case ViewMode.Factions:
    case ViewMode.Danger: {
      const water = e < 0 || world.lake?.[i] === 1
      write(water ? (mode === ViewMode.Factions ? FACTIONS_WATER : CAPACITY_WATER) : mode === ViewMode.Factions ? FACTIONS_STATELESS : DANGER_LAND, out, o, scale)
      return
    }
    case ViewMode.Resources: {
      // a muted relief: the ground darker low, paler and browner in the hills, where the ores lie
      const water = e < 0 || world.lake?.[i] === 1
      if (water) write(RESOURCES_WATER, out, o, scale)
      else write(lerp3(RESOURCES_LOW, RESOURCES_HIGH, Math.sqrt(Math.max(0, e) / 0.6)), out, o, scale)
      return
    }
  }
}

function hsl(h: number, s: number, l: number): RGB {
  const hue2rgb = (p: number, q: number, tt: number) => {
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)]
}

// ---------- legends (ui/viewLegends.ts): the views' colours as CSS ----------

const css = (c: readonly number[]) => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`
/** A left-to-right CSS gradient of ramp stops over [lo, hi] of their domain. */
function gradientCss(stops: readonly (readonly [number, RGB])[], lo: number, hi: number): string {
  return `linear-gradient(to right, ${stops.map(([t, c]) => `${css(c)} ${(((t - lo) / (hi - lo)) * 100).toFixed(1)}%`).join(', ')})`
}
/** The Elevation, Temperature, Rainfall, Capacity (and Population) views' ramps as CSS gradients (Elevation: -1 deep sea .. 1 peaks, the coast a sharp step at the middle; the others 0 .. 1). */
export const VIEW_RAMP_CSS = {
  elevation: gradientCss([...ELEV_SEA, ...ELEV_LAND].map(([t, c]) => [(t + 1) / 2, c] as const), 0, 1),
  temperature: gradientCss(TEMP_STOPS, 0, 1),
  rainfall: gradientCss(RAIN_STOPS, 0, 1),
  capacity: gradientCss(CAPACITY_STOPS, 0, 1),
} as const
/** Swatches of the views' fixed colours: water and bare land of the data views, stateless land, wild land of the Land use view, a plate on land and under the sea. */
export const VIEW_SWATCH_CSS = {
  water: css(CAPACITY_WATER),
  barren: css(CAPACITY_BARREN),
  stateless: css(FACTIONS_STATELESS),
  factionsWater: css(FACTIONS_WATER),
  wild: css(LANDUSE_WILD),
  dangerLand: css(DANGER_LAND),
  plateLand: css(hsl(0.58, 0.5, 0.56)),
  plateSea: css(hsl(0.58, 0.5, 0.34)),
} as const
/** The Biomes view's colours, in the legend's order (land from cold to hot, then mountains, coast, ocean). */
export function biomeLegend(): { name: string; css: string }[] {
  const order = [Biome.Ice, Biome.Tundra, Biome.Taiga, Biome.TemperateForest, Biome.Grassland, Biome.Savanna, Biome.Desert, Biome.Rainforest, Biome.Mountain, Biome.Coast, Biome.Ocean]
  return order.map((b) => ({ name: BIOME_NAMES[b], css: css(BIOME_COLOR[b]) }))
}
