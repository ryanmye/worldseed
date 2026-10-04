// Where a settlement's town plan stands: the centre of its plan (town.ts) on the globe, from
// the world and a few site facts (its cell, its peak population, its first port), without
// building the plan. layout.ts places every plan here; terrainHeight.ts flattens the valley
// floor round the same point, so a coastal or port town (whose centre can sit most of a
// cell from its cell centre) stands on the flattened ground too.
//
// A coastal settlement's centre moves a little inland, to the point nearest its cell centre
// (leaning toward its higher dry neighbours) whose surroundings are mostly dry land as the
// planet draws it; a port town comes down to its harbour, its centre about half the town's
// radius inland of the port.

import type { World } from '../../contract.ts'
import { townRadius } from './footprint.ts'
import { createSurface, type Probe, type Surface } from './surface.ts'
import { setTownCentres } from '../terrainHeight.ts'

/** World units per KayKit unit (models.ts KK), and a common house's width. */
const KK = 0.00075
const HOUSE_WIDTH = 0.8 * KK
/** How far inland a coastal centre leans first (in 0.4 cell spacings). */
const COAST_SHIFT = 0.12
/** Port position from its cell centre toward the sea, in cell spacings (structures.ts PORT_OFFSET). */
const PORT_OFFSET = 0.55

export interface OriginEnv {
  world: World
  surface: Surface
  water(i: number): boolean
}

/** What the origin needs of the world: its ground probe (as drawn) and which cells are water. */
export function createOriginEnv(world: World, surface: Surface = createSurface(world)): OriginEnv {
  const lakeRaw = (world as Partial<World>).lake
  const lake = lakeRaw && lakeRaw.length === world.grid.cellCount ? lakeRaw : null
  return { world, surface, water: (i) => world.elevation[i] < 0 || (lake !== null && lake[i] === 1) }
}

/**
 * Where a port on `cell` stands, as structures.ts places it: [x, y, z] toward the sea from the
 * cell centre (unnormalised) and the seaward tangent [dx, dy, dz].
 */
export function portSiteOf(env: OriginEnv, cell: number): number[] {
  const { positions: P, neighborOffsets: off, neighbors: nb, cellCount } = env.world.grid
  const spacing = Math.sqrt((4 * Math.PI) / cellCount)
  const cx = P[cell * 3], cy = P[cell * 3 + 1], cz = P[cell * 3 + 2]
  let dx = 0, dy = 0, dz = 0
  const toward = (j: number) => {
    let tx = P[j * 3], ty = P[j * 3 + 1], tz = P[j * 3 + 2]
    const d = tx * cx + ty * cy + tz * cz
    tx -= cx * d; ty -= cy * d; tz -= cz * d
    const l = Math.hypot(tx, ty, tz)
    if (l > 1e-9) { dx += tx / l; dy += ty / l; dz += tz / l }
  }
  for (let e = off[cell]; e < off[cell + 1]; e++) if (env.world.elevation[nb[e]] < 0) toward(nb[e])
  if (dx * dx + dy * dy + dz * dz < 1e-12) for (let e = off[cell]; e < off[cell + 1]; e++) if (env.water(nb[e])) toward(nb[e])
  if (dx * dx + dy * dy + dz * dz < 1e-12) { dx = -cx * cy; dy = 1 - cy * cy; dz = -cz * cy }
  const dl = Math.hypot(dx, dy, dz) || 1
  dx /= dl; dy /= dl; dz /= dl
  let px = cx + dx * PORT_OFFSET * spacing, py = cy + dy * PORT_OFFSET * spacing, pz = cz + dz * PORT_OFFSET * spacing
  const pl = Math.hypot(px, py, pz)
  px /= pl; py /= pl; pz /= pl
  return [px, py, pz, dx, dy, dz]
}

/**
 * Centre of the plan of a settlement on `cell` with peak population `peak` (unit vector) and
 * whether it counts as coastal: [x, y, z, coastal 0 | 1]. `port`: its first port's site
 * (portSiteOf, or the structure layer's placement), or null. Deterministic in its inputs.
 */
export function planOrigin(env: OriginEnv, cell: number, peak: number, port: ArrayLike<number> | null): Float64Array {
  const { world, surface, water } = env
  const { positions: GP, neighborOffsets: off, neighbors: nb, cellCount } = world.grid
  const spacing = Math.sqrt((4 * Math.PI) / cellCount)
  const probe: Probe = { radius: 1, nx: 0, ny: 1, nz: 0, elev: 0, lake: 0, cell: 0 }
  const fr = { ux: 0, uy: 0, uz: 0, ex: 0, ey: 0, ez: 0, nx: 0, ny: 0, nz: 0 }
  const frameAt = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z)
    fr.ux = x / l; fr.uy = y / l; fr.uz = z / l
    let ex = fr.uz, ey = 0, ez = -fr.ux
    let el = Math.hypot(ex, ey, ez)
    if (el < 1e-6) { ex = 1; ey = 0; ez = 0; el = 1 }
    fr.ex = ex / el; fr.ey = ey / el; fr.ez = ez / el
    fr.nx = fr.uy * fr.ez - fr.uz * fr.ey
    fr.ny = fr.uz * fr.ex - fr.ux * fr.ez
    fr.nz = fr.ux * fr.ey - fr.uy * fr.ex
  }
  const probeAt = (ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, nx: number, ny: number, nz: number, x: number, y: number, start: number) => {
    const px = ox + ex * x + nx * y, py = oy + ey * x + ny * y, pz = oz + ez * x + nz * y
    const l = Math.hypot(px, py, pz)
    surface.probe(px / l, py / l, pz / l, start, probe)
    frameAt(px, py, pz)
  }
  const c = cell
  let ox = GP[c * 3], oy = GP[c * 3 + 1], oz = GP[c * 3 + 2]
  let coastal = false
  let vx = 0, vy = 0, vz = 0
  for (let k = off[c]; k < off[c + 1]; k++) {
    const j = nb[k]
    if (water(j)) { coastal = true; continue }
    const wgt = Math.max(world.elevation[j], 0.002)
    vx += (GP[j * 3] - ox) * wgt
    vy += (GP[j * 3 + 1] - oy) * wgt
    vz += (GP[j * 3 + 2] - oz) * wgt
  }
  // the centre is the point nearest the cell centre (leaning toward the higher dry
  // neighbours) whose surroundings are mostly dry land as drawn: on the coast the town
  // hugs the shore, but stands on land
  const vl = Math.hypot(vx, vy, vz)
  surface.probe(ox, oy, oz, c, probe)
  if (coastal || surface.wet(probe, 0.25)) {
    frameAt(ox, oy, oz)
    const ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
    const lx = vl > 0 ? (vx * ex + vy * ey + vz * ez) / vl : 0, ly = vl > 0 ? (vx * nx + vy * ny + vz * nz) / vl : 0
    const c0x = ox, c0y = oy, c0z = oz
    const ring = HOUSE_WIDTH * 2.2
    let need = 4
    const dryAround = (x: number, y: number) => {
      probeAt(c0x, c0y, c0z, ex, ey, ez, nx, ny, nz, x, y, c)
      if (surface.wet(probe, need >= 4 ? 0.12 : 0)) return false
      let dry = 0
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2
        probeAt(c0x, c0y, c0z, ex, ey, ez, nx, ny, nz, x + Math.cos(a) * ring, y + Math.sin(a) * ring, c)
        if (!surface.wet(probe, 0.1)) dry++
      }
      return dry >= need
    }
    let bx = lx * COAST_SHIFT * spacing * 0.4, by = ly * COAST_SHIFT * spacing * 0.4
    // (a settlement whose cell is drawn as sea moves to the nearest land, up to ~3/4 of a cell)
    // a second pass settles for any spit of land (a small island)
    search: for (let pass = 0, i = 0; pass < 2; i++) {
      if (i > 25) { pass++; i = 0; need = 1; if (pass >= 2) break }
      const r = i * spacing * 0.03
      const n = i === 0 ? 1 : 16
      // directions ordered by how well they lean inland
      for (let q = 0; q < n; q++) {
        const a = Math.atan2(ly, lx) + (q % 2 ? 1 : -1) * Math.ceil(q / 2) * ((Math.PI * 2) / 16)
        const x = lx * COAST_SHIFT * spacing * 0.4 + Math.cos(a) * r, y = ly * COAST_SHIFT * spacing * 0.4 + Math.sin(a) * r
        if (dryAround(x, y)) { bx = x; by = y; break search }
      }
    }
    const px = c0x + ex * bx + nx * by, py = c0y + ey * bx + ny * by, pz = c0z + ez * bx + nz * by
    const l = Math.hypot(px, py, pz)
    ox = px / l; oy = py / l; oz = pz / l
  }
  // a port town comes down to its harbour: its centre sits inland of the port by about
  // half the town's radius, so the waterfront wards (and the quay) meet the water
  if (port) {
    const ps = port
    const pl = Math.hypot(ps[0], ps[1], ps[2])
    const px0 = ps[0] / pl, py0 = ps[1] / pl, pz0 = ps[2] / pl
    frameAt(px0, py0, pz0)
    const ex = fr.ex, ey = fr.ey, ez = fr.ez, nx = fr.nx, ny = fr.ny, nz = fr.nz
    let dx = ps[3] * ex + ps[4] * ey + ps[5] * ez, dy = ps[3] * nx + ps[4] * ny + ps[5] * nz
    const dl = Math.hypot(dx, dy) || 1
    dx /= dl; dy /= dl
    const R = Math.min(spacing * 0.5, Math.max(HOUSE_WIDTH * 2.5, townRadius(peak) * KK * 0.5))
    const ring = HOUSE_WIDTH * 2
    for (let i = 0; i < 8; i++) {
      const t = R + i * HOUSE_WIDTH
      const x = -dx * t, y = -dy * t
      probeAt(px0, py0, pz0, ex, ey, ez, nx, ny, nz, x, y, c)
      if (surface.wet(probe, 0.12)) continue
      let dry = 0
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2
        probeAt(px0, py0, pz0, ex, ey, ez, nx, ny, nz, x + Math.cos(a) * ring, y + Math.sin(a) * ring, c)
        if (!surface.wet(probe, 0.1)) dry++
      }
      if (dry < 4) continue
      const qx = px0 + ex * x + nx * y, qy = py0 + ey * x + ny * y, qz = pz0 + ez * x + nz * y
      const ql = Math.hypot(qx, qy, qz)
      // (still the settlement's own place: within a cell of its centre)
      if (Math.hypot(qx / ql - GP[c * 3], qy / ql - GP[c * 3 + 1], qz / ql - GP[c * 3 + 2]) > spacing * 0.9) break
      ox = qx / ql; oy = qy / ql; oz = qz / ql
      coastal = true
      break
    }
  }
  return Float64Array.of(ox, oy, oz, coastal ? 1 : 0)
}

/**
 * For terrainHeight.ts: moves each town site of the flattening (siteList: x, y, z, flat,
 * reach per site; siteCell; the settlement and its peak per site, peak < 0 for an outpost,
 * which stays on its cell) to where its plan stands, and its cell to the cell there.
 */
const recentred = new WeakMap<World, { env: OriginEnv; cache: Map<string, Float64Array> }>()
export function recentreSites(world: World, history: { settlements: { cell: number }[]; structures: { type: number; settlement: number; cell: number }[] }, siteList: number[], siteCell: number[], siteIds: number[], sitePeak: number[]): void {
  // (per world: the probe and the origins already found, so a longer run only adds its new towns)
  let rc = recentred.get(world)
  if (!rc) recentred.set(world, (rc = { env: createOriginEnv(world), cache: new Map() }))
  const env = rc.env
  const ports = new Map<number, number>()
  const cellCount = world.grid.cellCount
  // (StructureType.Port: the first port each settlement built, as layout.ts takes it)
  for (const st of history.structures) if (st.type === 0 && st.cell >= 0 && st.cell < cellCount && !ports.has(st.settlement)) ports.set(st.settlement, st.cell)
  for (let k = 0; k < siteIds.length; k++) {
    // (a hamlet's plan is a few houses round its well: it stays on its cell)
    if (sitePeak[k] < 300) continue
    const id = siteIds[k]
    const cell = history.settlements[id].cell
    const pc = ports.get(id)
    const key = `${id}:${cell}:${pc ?? -1}:${Math.round(sitePeak[k])}`
    let o = rc.cache.get(key)
    if (!o) rc.cache.set(key, (o = planOrigin(env, cell, sitePeak[k], pc !== undefined ? portSiteOf(env, pc) : null)))
    const P = world.grid.positions
    if (Math.hypot(o[0] - P[cell * 3], o[1] - P[cell * 3 + 1], o[2] - P[cell * 3 + 2]) < 1e-7) continue
    siteList[k * 5] = o[0]; siteList[k * 5 + 1] = o[1]; siteList[k * 5 + 2] = o[2]
    siteCell[k] = env.surface.nearestCell(o[0], o[1], o[2], cell)
  }
}

// (terrainHeight.ts cannot import this module, which reads the ground through it: it takes the hook)
setTownCentres(recentreSites)
