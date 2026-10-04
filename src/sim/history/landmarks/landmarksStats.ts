// landmarks: stats harness. Per seed: landmarks by kind and rank, their states at the end of the run, the largest cities
// with their landmarks, the faiths' building traditions, and the system's own cost (--off: the system replayed beside a run
// with it off, timed alone, against the run's time). --detail prints every great landmark as a story (built when, by whom,
// for which faith, what became of it) and a sample of the lesser ones. Without seeds: the 20 stats seeds, with medians.
//   node src/sim/history/landmarks/landmarksStats.ts [--off] [--detail] [--years N] seeds...

import { Biome, CITY_POPULATION, FaithKind, LANDMARK_KIND_COUNT, LandmarkForm, LandmarkKind, LandmarkRank, LandmarkState, landmarksAt, settlementNameAt } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { HISTORY_STATS_SEEDS } from '../stats.ts'
import { createLandmarks, landmarksYear } from './system.ts'
import type { LandmarksState } from './state.ts'

const KINDS = Object.keys(LandmarkKind) as (keyof typeof LandmarkKind)[]
const FORMS = Object.keys(LandmarkForm) as (keyof typeof LandmarkForm)[]
const STATES = Object.keys(LandmarkState) as (keyof typeof LandmarkState)[]
const BIOMES = Object.keys(Biome) as (keyof typeof Biome)[]

function popAt(h: History, id: number, y: number): number {
  const q = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
  return h.population[q * h.settlements.length + id]
}

/** The state of landmark i at the end of the run, and the year it entered it. */
function finalState(h: History, i: number): { state: number; since: number } {
  const L = h.landmarks
  let state = 0, since = L.begunYear[i]
  for (let k = 0; k < L.changeCount; k++) if (L.changeLandmark[k] === i) { state = L.changeState[k]; since = L.changeYear[k] }
  return { state, since }
}

/** One landmark as a line of the chronicle. */
export function story(h: History, i: number): string {
  const L = h.landmarks
  const v = L.settlement[i], y = L.begunYear[i]
  const parts: string[] = [`${L.name[i]} [${KINDS[L.kind[i]]}${L.rank[i] === LandmarkRank.Lesser ? ', lesser' : ''}${L.rank[i] === LandmarkRank.Lesser || L.kind[i] === LandmarkKind.GreatTemple || L.kind[i] === LandmarkKind.Monastery ? ', ' + FORMS[L.form[i]] + '/' + L.variant[i] : ''}]`]
  parts.push(`at ${settlementNameAt(h, v, y)} (${Math.round(popAt(h, v, y))} people)`)
  parts.push(`begun ${y}`)
  const p = L.polity[i]
  if (p >= 0) parts.push(`by ${h.polities[p].name}`)
  if (L.ruler[i] >= 0) { const r = h.rulers[L.ruler[i]]; parts.push(`under ${r.name} ${r.regnal}${L.dynasty[i] >= 0 ? ' of ' + h.dynasties[L.dynasty[i]].name : ''}`) }
  if (L.faith[i] >= 0 && L.faith[i] < h.faiths.length) parts.push(`for ${h.faiths[L.faith[i]].name}`)
  parts.push(`(${h.peoples[L.people[i]].name} builders)`)
  const hist: string[] = []
  for (let k = 0; k < L.changeCount; k++) {
    if (L.changeLandmark[k] !== i || L.changeState[k] === LandmarkState.Building) continue
    let s = `${STATES[L.changeState[k]]} ${L.changeYear[k]}`
    if (L.changeFaith[k] >= 0) s += ` (${h.faiths[L.changeFaith[k]].name})`
    if (L.changePolity[k] >= 0 && L.changeState[k] !== LandmarkState.InUse) s += ` [${h.polities[L.changePolity[k]].name}]`
    hist.push(s)
  }
  parts.push('-> ' + (hist.length ? hist.join(', ') : 'still building'))
  return parts.join(' ')
}

export interface LandmarkRow {
  seed: number
  years: number
  ms: number
  /** The system's own time (replayed beside a run with it off) and that run's time (--off). */
  msSys: number
  msOff: number
  great: number
  lesser: number
  byKind: number[]
  /** Final states, great and lesser. */
  greatStates: number[]
  lesserStates: number[]
  changes: number
  forms: number[]
  /** Capital cities of 10,000 people: how many, and with a great landmark. */
  capCities: number
  capCitiesWith: number
  /** Great landmarks begun per century. */
  century: number[]
  /** Houses of worship by LandmarkForm. */
  worship: number[]
}

function median(a: number[]): number {
  const b = a.slice().sort((x, y) => x - y)
  const n = b.length
  return n === 0 ? NaN : n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2
}

/** Settlements that were a capital for 30 years or more while they had CITY_POPULATION people (at a snapshot). */
export function capitalCities(h: History, minYears = 30): number[] {
  const S = h.settlements.length
  const mark = new Uint8Array(S)
  for (const pol of h.polities) {
    const end = pol.endedYear >= 0 ? pol.endedYear - 1 : h.years
    for (let k = 0; k < pol.capitals.length; k++) {
      const v = pol.capitals[k]
      const from = pol.capitalYears[k], to = k + 1 < pol.capitals.length ? pol.capitalYears[k + 1] - 1 : end
      for (let q = Math.ceil((from + minYears) / h.snapshotInterval); q * h.snapshotInterval <= to && q < h.snapshotCount; q++) {
        if (h.population[q * S + v] >= CITY_POPULATION) { mark[v] = 1; break }
      }
    }
  }
  const out: number[] = []
  for (let v = 0; v < S; v++) if (mark[v]) out.push(v)
  return out
}

function traditions(h: History, w: World): string[] {
  const L = h.landmarks
  const used = new Uint8Array(h.faiths.length)
  for (let i = 0; i < L.count; i++) if (L.faith[i] >= 0 && L.faith[i] < used.length && (L.kind[i] === LandmarkKind.GreatTemple || L.kind[i] === LandmarkKind.Monastery || L.kind[i] === LandmarkKind.Temple || L.kind[i] === LandmarkKind.Shrine)) used[L.faith[i]] = 1
  const out: string[] = []
  for (const f of h.faiths) {
    if (!used[f.id] && f.kind === FaithKind.Traditional) continue
    const c = f.foundedAt >= 0 ? h.settlements[f.foundedAt].cell : -1
    const b = c >= 0 ? BIOMES[w.biome[c]] : '?'
    const form = L.faithForm[f.id] < 255 ? FORMS[L.faithForm[f.id]] + '/' + L.faithVariant[f.id] : 'unseen'
    out.push(`${f.name} (${f.kind === FaithKind.Universal ? 'universal' : 'traditional'}${f.parent >= 0 ? ', schism of ' + h.faiths[f.parent].name : ''}; ${h.peoples[f.people].name}, ${b}${c >= 0 ? ` t${w.temperature[c].toFixed(2)} r${w.rainfall[c].toFixed(2)} e${w.elevation[c].toFixed(2)}` : ''}): ${form}${used[f.id] ? '' : ' (no house of worship)'}`)
  }
  return out
}

export function landmarkRow(seed: number, years: number, off: boolean, detail: boolean): LandmarkRow {
  const w = generateWorld(seed)
  if (off) { runHistory(w, { years: 300 }); runHistory(w, { years: 300, landmarks: false }) } // (warm-up, so the timings compare)
  let t = performance.now()
  const run = runHistory(w, { years })
  const ms = performance.now() - t
  let msOff = NaN, msSys = NaN
  if (off) {
    let lm: LandmarksState | null = null
    let sys = 0
    t = performance.now()
    runHistory(w, { years, landmarks: false }, (s) => { const a = performance.now(); if (lm === null) lm = createLandmarks(s); landmarksYear(s, lm); sys += performance.now() - a })
    msOff = performance.now() - t - sys
    msSys = sys
  }
  const h = run.history
  const L = h.landmarks
  const byKind = new Array<number>(LANDMARK_KIND_COUNT).fill(0)
  const greatStates = new Array<number>(STATES.length).fill(0), lesserStates = new Array<number>(STATES.length).fill(0)
  const forms = new Array<number>(FORMS.length).fill(0)
  let great = 0, lesser = 0
  const century = new Array<number>(Math.ceil(years / 100) + 1).fill(0)
  for (let i = 0; i < L.count; i++) {
    byKind[L.kind[i]]++
    const st = finalState(h, i).state
    if (L.rank[i] === LandmarkRank.Great) { great++; greatStates[st]++; century[Math.floor(L.begunYear[i] / 100)]++ } else { lesser++; lesserStates[st]++ }
  }
  for (let f = 0; f < L.faithForm.length; f++) if (L.faithForm[f] < 255) forms[L.faithForm[f]]++
  const worship = new Array<number>(FORMS.length).fill(0)
  for (let i = 0; i < L.count; i++) if (L.kind[i] === LandmarkKind.GreatTemple || L.kind[i] === LandmarkKind.Monastery || L.kind[i] === LandmarkKind.Temple || L.kind[i] === LandmarkKind.Shrine) worship[L.form[i]]++
  const caps = capitalCities(h)
  let capWith = 0
  for (const v of caps) { let ok = false; for (let i = 0; i < L.count; i++) if (L.settlement[i] === v && (L.kind[i] === LandmarkKind.Castle || L.kind[i] === LandmarkKind.Palace)) ok = true; if (ok) capWith++ }
  const row: LandmarkRow = { seed, years, ms, msSys, msOff, great, lesser, byKind, greatStates, lesserStates, changes: L.changeCount, forms, capCities: caps.length, capCitiesWith: capWith, century, worship }
  if (detail) {
    console.log(`\n== seed ${seed} at ${years}: ${great} great, ${lesser} lesser landmarks, ${L.changeCount} changes (${h.settlements.length} settlements) ==`)
    console.log('-- faiths and their building traditions')
    for (const x of traditions(h, w)) console.log('  ' + x)
    console.log('-- great landmarks')
    for (let i = 0; i < L.count; i++) if (L.rank[i] === LandmarkRank.Great) console.log('  ' + story(h, i))
    console.log('-- lesser landmarks (a sample)')
    let k = 0
    for (let i = 0; i < L.count && k < 25; i++) if (L.rank[i] === LandmarkRank.Lesser && i % 4 === 0) { console.log('  ' + story(h, i)); k++ }
    console.log('-- largest cities (peak population) and their landmarks at the end')
    const S = h.settlements.length
    const peak = new Float64Array(S)
    for (let q = 0; q < h.snapshotCount; q++) for (let v = 0; v < S; v++) if (h.population[q * S + v] > peak[v]) peak[v] = h.population[q * S + v]
    const order = Array.from({ length: S }, (_, i) => i).sort((a, b) => peak[b] - peak[a]).slice(0, 15)
    for (const v of order) {
      const at = landmarksAt(h, v, h.years)
      const st = h.settlements[v]
      const g = at.filter((x) => x.rank === LandmarkRank.Great).map((x) => `${L.name[x.id]} (${STATES[x.state]})`)
      const l = at.filter((x) => x.rank === LandmarkRank.Lesser)
      console.log(`  ${settlementNameAt(h, v, h.years)}: peak ${Math.round(peak[v])}, now ${Math.round(popAt(h, v, h.years))}${st.abandonedYear >= 0 ? ' (abandoned ' + st.abandonedYear + ')' : ''}${caps.includes(v) ? ', capital city' : ''}; great: ${g.join('; ') || '-'}; lesser ${l.length} (${l.map((x) => KINDS[x.kind][0] + ':' + STATES[x.state]).join(' ')})`)
    }
    const d = run.diag.landmarks
    if (d) console.log('  diag ' + JSON.stringify(d))
  }
  return row
}

function main(): void {
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
  const off = args.includes('--off')
  const detail = args.includes('--detail')
  const yi = args.indexOf('--years')
  const years = yi >= 0 ? Number(args[yi + 1]) : 2000
  const seeds = args.filter((a: string, i: number) => !a.startsWith('--') && (yi < 0 || i !== yi + 1)).map(Number)
  const list = seeds.length ? seeds : HISTORY_STATS_SEEDS
  const rows: LandmarkRow[] = []
  const K = KINDS.map((k) => k.slice(0, 5))
  console.log('seed   great lesser chg  ' + K.map((k) => k.padStart(5)).join(' ') + '  caps  ms' + (off ? '  sys  off  share' : ''))
  for (const seed of list) {
    const r = landmarkRow(seed, years, off, detail)
    rows.push(r)
    console.log(`${String(seed).padEnd(6)} ${String(r.great).padStart(5)} ${String(r.lesser).padStart(6)} ${String(r.changes).padStart(4)}  ` + r.byKind.map((x) => String(x).padStart(5)).join(' ') + `  ${r.capCitiesWith}/${r.capCities}  ${Math.round(r.ms)}` + (off ? `  ${Math.round(r.msSys)}  ${Math.round(r.msOff)}  ${(100 * r.msSys / r.msOff).toFixed(2)}%` : ''))
  }
  const med = (f: (r: LandmarkRow) => number): string => String(median(rows.map(f)))
  const rng = (f: (r: LandmarkRow) => number): string => `${med(f)} (${Math.min(...rows.map(f))}..${Math.max(...rows.map(f))})`
  console.log('\nhouses of worship by form (' + FORMS.join(' ') + '), per seed:')
  for (const r of rows) console.log(`  ${String(r.seed).padEnd(6)} ` + r.worship.map((x) => String(x).padStart(4)).join(' ') + `   forms ${r.worship.filter((x) => x > 0).length} (without Circle ${r.worship.filter((x, i) => x > 0 && i !== LandmarkForm.Circle).length})`)
  console.log('houses of worship by form, total ' + FORMS.map((f, i) => `${f} ${rows.reduce((a, r) => a + r.worship[i], 0)}`).join(', ') + `; seeds with 3+ forms besides Circle ${rows.filter((r) => r.worship.filter((x, i) => x > 0 && i !== LandmarkForm.Circle).length >= 3).length}/${rows.length}`)
  console.log(`\nmedians over ${rows.length} seeds at ${years}: great ${rng((r) => r.great)}, lesser ${rng((r) => r.lesser)}, changes ${med((r) => r.changes)}`)
  console.log('by kind ' + KINDS.map((k, i) => `${k} ${med((r) => r.byKind[i])} [${rows.reduce((a, r) => a + r.byKind[i], 0)}]`).join(', '))
  console.log('great states ' + STATES.map((s, i) => `${s} ${med((r) => r.greatStates[i])} [${rows.reduce((a, r) => a + r.greatStates[i], 0)}]`).join(', '))
  console.log('lesser states ' + STATES.map((s, i) => `${s} ${med((r) => r.lesserStates[i])} [${rows.reduce((a, r) => a + r.lesserStates[i], 0)}]`).join(', '))
  console.log('faith forms (worlds with one) ' + FORMS.map((f, i) => `${f} ${rows.filter((r) => r.forms[i] > 0).length}`).join(', '))
  console.log('great begun by century ' + Array.from({ length: Math.ceil(years / 100) }, (_, c) => rows.reduce((a, r) => a + r.century[c], 0)).join(' '))
  console.log(`capital cities with a castle or palace ${rows.reduce((a, r) => a + r.capCitiesWith, 0)}/${rows.reduce((a, r) => a + r.capCities, 0)}`)
  if (off) console.log(`time: system ${Math.round(rows.reduce((a, r) => a + r.msSys, 0))} ms of ${Math.round(rows.reduce((a, r) => a + r.msOff, 0))} ms (${(100 * rows.reduce((a, r) => a + r.msSys, 0) / rows.reduce((a, r) => a + r.msOff, 0)).toFixed(2)}%)`)
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) main()
