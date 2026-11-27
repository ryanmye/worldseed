// disasters: History.disasters, History.climate and History.weatherRegion, copied out of the state (the run goes on), and
// the volcanoes' names: a volcano is named, "Mount X", in the language of the living settlement that witnessed its first
// witnessed eruption, from 'names-volcano-<id>', in the order of those eruptions (so a longer run names nothing differently).

import type { ClimateSeries, Disasters, World } from '../../../contract.ts'
import { createRng } from '../../rng.ts'
import type { SettlementNaming } from '../../names/index.ts'
import { buildRoot, letterCount } from '../../names/words.ts'
import type { DisasterState } from './state.ts'

export interface DisasterHistory {
  disasters: Disasters
  climate: ClimateSeries
  weatherRegion: Uint16Array
}

export function emptyDisasterHistory(): DisasterHistory {
  return {
    disasters: {
      count: 0, kind: new Uint8Array(0), year: new Int16Array(0), endYear: new Int16Array(0), cell: new Int32Array(0), region: new Int16Array(0),
      size: new Float32Array(0), dT: new Float32Array(0), settlement: new Int32Array(0), deaths: new Float32Array(0), struck: new Int32Array(0),
      cause: new Int32Array(0), volcano: new Int32Array(0), name: [],
    },
    climate: { temp: new Float32Array(0), volcanic: new Float32Array(0), harvest: new Float32Array(0) },
    weatherRegion: new Uint16Array(0),
  }
}

function capitalise(w: string): string {
  return w.length ? w[0].toUpperCase() + w.slice(1) : w
}

/** Volcano names by volcano id ('' if never witnessed by `years`) and the row at which each was named. */
function volcanoNames(world: World, dx: DisasterState, naming: SettlementNaming, n: number, peopleNames: readonly string[]): { name: string[]; at: Int32Array } {
  const V = dx.vCell.length
  const name = new Array<string>(V).fill('')
  const at = new Int32Array(V).fill(-1)
  const used = new Set<string>()
  for (const p of peopleNames) used.add(p.toLowerCase())
  const r = dx.rows
  for (let i = 0; i < n; i++) {
    const v = r.volcano[i], wit = r.witness[i]
    if (v < 0 || wit < 0 || at[v] >= 0) continue
    const lang = naming.language(naming.tribe[wit], naming.level[wit])
    const rng = createRng(world.seed, `names-volcano-${v}`)
    let w = ''
    for (let attempt = 0; attempt < 400 && !w; attempt++) {
      const x = buildRoot(lang, rng)
      if (letterCount(x) >= 3 && letterCount(x) <= 9 && !used.has(x.toLowerCase())) w = x
    }
    if (!w) w = 'Volcano ' + v
    used.add(w.toLowerCase())
    name[v] = 'Mount ' + capitalise(w)
    at[v] = i
  }
  return { name, at }
}

/** Everything up to year `years` (the year just simulated). */
export function assembleDisasters(world: World, dx: DisasterState, naming: SettlementNaming, years: number, peopleNames: readonly string[]): DisasterHistory {
  const r = dx.rows
  const n = r.kind.length
  const vn = volcanoNames(world, dx, naming, n, peopleNames)
  const name: string[] = []
  for (let i = 0; i < n; i++) {
    const v = r.volcano[i]
    name.push(v >= 0 && vn.at[v] >= 0 && vn.at[v] <= i ? vn.name[v] : '')
  }
  const disasters: Disasters = {
    count: n,
    kind: Uint8Array.from(r.kind), year: Int16Array.from(r.year), endYear: Int16Array.from(r.endYear), cell: Int32Array.from(r.cell),
    region: Int16Array.from(r.region), size: Float32Array.from(r.size), dT: Float32Array.from(r.dT), settlement: Int32Array.from(r.settlement),
    deaths: Float32Array.from(r.deaths), struck: Int32Array.from(r.struck), cause: Int32Array.from(r.cause), volcano: Int32Array.from(r.volcano), name,
  }
  const Y = years + 1
  return {
    disasters,
    climate: {
      temp: Float32Array.from(dx.tempSeries.slice(0, Y)),
      volcanic: Float32Array.from(dx.volcSeries.slice(0, Y)),
      harvest: Float32Array.from(dx.harvestSeries.slice(0, Y)),
    },
    weatherRegion: dx.region.slice(),
  }
}
