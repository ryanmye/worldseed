// disease: the History fields of the disease system (all copied out of the state, each array with its own buffer).

import type { DiseaseInfo, EpidemicInfo, Outbreaks, Quarantines, World } from '../../../contract.ts'
import { createRng } from '../../rng.ts'
import type { SettlementNaming } from '../../names/index.ts'
import { buildMorph, buildRoot, fuseWords, letterCount } from '../../names/words.ts'
import type { DiseaseState } from './state.ts'

export interface DiseaseHistory {
  diseases: DiseaseInfo[]
  epidemics: EpidemicInfo[]
  outbreaks: Outbreaks
  fever: Uint8Array
  feverTolerance: Uint8Array
  endemic: Uint8Array
  quarantines: Quarantines
}

export function emptyDiseaseHistory(): DiseaseHistory {
  return {
    diseases: [], epidemics: [],
    outbreaks: { count: 0, disease: new Uint8Array(0), settlement: new Int32Array(0), year: new Int16Array(0), mortality: new Uint8Array(0), source: new Int32Array(0), via: new Uint8Array(0), epidemic: new Int32Array(0) },
    fever: new Uint8Array(0), feverTolerance: new Uint8Array(0), endemic: new Uint8Array(0),
    quarantines: { count: 0, settlement: new Int32Array(0), from: new Int16Array(0), to: new Int16Array(0) },
  }
}

/**
 * Disease names: a word from the language of the settlement it first struck, in order of the first year (then id),
 * drawn from 'names-disease-<id>', unique among the peoples' names and the earlier diseases' (prefix-stable).
 */
function diseaseNames(world: World, dz: DiseaseState, naming: SettlementNaming, peopleNames: readonly string[]): string[] {
  const D = dz.D
  const order: number[] = []
  for (let d = 0; d < D; d++) if (dz.firstYear[d] >= 0) order.push(d)
  order.sort((a, b) => dz.firstYear[a] - dz.firstYear[b] || a - b)
  const used = new Set<string>()
  for (const n of peopleNames) used.add(n.toLowerCase())
  const names: string[] = new Array<string>(D).fill('')
  for (const d of order) {
    const namer = dz.firstSettlement[d]
    const lang = naming.language(naming.tribe[namer], naming.level[namer])
    const rng = createRng(world.seed, `names-disease-${d}`)
    let name = ''
    for (let attempt = 0; attempt < 400 && !name; attempt++) {
      let w = buildRoot(lang, rng)
      if (rng.next() < 0.5) {
        const f = fuseWords(lang, w, buildMorph(lang, rng, 2, true))
        if (f !== null && letterCount(f) <= 10) w = f
      }
      if (letterCount(w) >= 3 && !used.has(w.toLowerCase())) name = w.toLowerCase()
    }
    if (!name) name = dz.defs[d].archetype + d // practically unreachable
    used.add(name)
    names[d] = name
  }
  return names
}

export function assembleDisease(world: World, dz: DiseaseState, naming: SettlementNaming, peopleNames: readonly string[], snapshotCount: number): DiseaseHistory {
  const D = dz.D
  const names = diseaseNames(world, dz, naming, peopleNames)
  const diseases: DiseaseInfo[] = []
  for (let d = 0; d < D; d++) {
    const def = dz.defs[d]
    diseases.push({
      id: d, kind: def.kind, archetype: def.archetype, name: names[d], firstYear: dz.firstYear[d], firstSettlement: dz.firstSettlement[d], originPeople: dz.originPeople[d],
      originCell: dz.originCell[d], mortality: def.mortality, duration: def.duration, fade: def.fade, sea: def.sea, crowd: def.crowd, criticalSize: def.ccs, placeBound: d === dz.feverId,
    })
  }
  const epidemics: EpidemicInfo[] = []
  for (let e = 0; e < dz.eDisease.length; e++) {
    epidemics.push({
      id: e, disease: dz.eDisease[e], startYear: dz.eStart[e], endYear: dz.eEnd[e], origin: dz.eOrigin[e], source: dz.eSource[e],
      deaths: dz.eDeaths[e], network: dz.eNet[e], outbreaks: dz.eRows[e], peoples: dz.ePeoples[e].slice(), great: dz.eGreat[e] !== 0,
    })
  }
  const n = dz.oDisease.length
  const outbreaks: Outbreaks = {
    count: n, disease: Uint8Array.from(dz.oDisease), settlement: Int32Array.from(dz.oSettlement), year: Int16Array.from(dz.oYear),
    mortality: Uint8Array.from(dz.oToll, (x) => (x * 255 + 0.5) | 0), source: Int32Array.from(dz.oSource), via: Uint8Array.from(dz.oVia), epidemic: Int32Array.from(dz.oEpi),
  }
  const fever = new Uint8Array(dz.N)
  for (let c = 0; c < dz.N; c++) fever[c] = (dz.fever[c] * 255 + 0.5) | 0
  const SP = snapshotCount * dz.P
  return {
    diseases, epidemics, outbreaks, fever,
    feverTolerance: dz.snapTol.slice(0, SP), endemic: dz.snapEnd.slice(0, SP),
    quarantines: { count: dz.qSettlement.length, settlement: Int32Array.from(dz.qSettlement), from: Int16Array.from(dz.qFrom), to: Int16Array.from(dz.qTo) },
  }
}
