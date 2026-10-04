// disease: stats harness for the disease system. Per seed: global aggregates, great epidemics (network and town
// mortality, clustering after networks join), contact epidemics, endemic sickness, the fever belt against the same
// world without the disease system, armies stricken and campaigns ended, quarantine, memory and timing.
//   node src/sim/history/disease/diseaseStats.ts [--off] [--json] [--years N] [--detail] seeds...
// --off also runs each world with the system off (fever belt and aggregates compared); --json prints the rows only;
// --detail prints, per seed, the diseases, each great epidemic's path, the population curve and a fever map.

import { CITY_POPULATION, DiseaseKind, EventType, StructureType, TOWN_POPULATION } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import { HISTORY_STATS_SEEDS } from '../stats.ts'
import { FEVER } from './params.ts'

export interface DiseaseRow {
  seed: number
  ms: number
  msOff: number
  /** Population, living settlements, open routes at 500/1000/1500/2000 (up to the run's end); towns and cities at the end. */
  pop: number[]
  living: number[]
  routes: number[]
  towns: number
  cities: number
  extinct: number
  /** The same without the system (NaN without --off). */
  popOff: number[]
  livingOff: number[]
  routesOff: number[]
  townsOff: number
  citiesOff: number
  diseases: number
  appeared: number
  epidemics: number
  outbreaks: number
  great: number
  /** Great epidemics per millennium (0-1000, 1000-2000, ...). */
  greatPerK: number[]
  /** Worst great epidemic: share of its network and of the towns it reached that died. */
  worstNet: number
  worstTown: number
  /** Highest town mortality of any great epidemic (towns it reached). */
  maxTown: number
  /** Great epidemics beginning within 150 years after two cradles met or a lane opened. */
  clustered: number
  contactEpi: number
  contactMort: number
  endemicEvents: number
  endemicAtEnd: number
  /** Deaths over the run: epidemics, endemic, fever (people). */
  deadEpi: number
  deadEnd: number
  deadFever: number
  /** Living settlements and population on fever ground (natural intensity >= FEVER.ground) at 1000/1500/2000, and without the system. */
  feverLiving: number[]
  feverPop: number[]
  feverLivingOff: number[]
  feverPopOff: number[]
  armyStricken: number
  wars: number
  /** Wars that ended within 3 years after an ArmyStricken of theirs; wars whose attacker sickness exhausted (then ending within 3 years). */
  endedByDisease: number
  spentByDisease: number
  quarantines: number
  firstQuarantine: number
  /** Ports struck by great plague waves after the first quarantine: share struck and mean toll, quarantined / not. */
  qStruck: number
  qToll: number
  nqStruck: number
  nqToll: number
  memory: number
  plagueWaves: number
}

const YEARS = [500, 1000, 1500, 2000]

function totals(h: History, y: number): { pop: number; living: number } {
  const S = h.settlements.length
  const q = Math.min(h.snapshotCount - 1, Math.round(y / h.snapshotInterval))
  let pop = 0, living = 0
  for (let i = 0; i < S; i++) { const p = h.population[q * S + i]; if (p > 0) { pop += p; living++ } }
  return { pop, living }
}

function openRoutes(h: History, y: number): number {
  const R = h.trade.count
  const isOpen = new Uint8Array(R)
  for (const e of h.events) {
    if (e.year > y) break
    if (e.type === EventType.TradeOpened) isOpen[e.value] = 1
    else if (e.type === EventType.TradeClosed) isOpen[e.value] = 0
  }
  let n = 0
  for (let r = 0; r < R; r++) n += isOpen[r]
  return n
}

function popAt(h: History, id: number, y: number): number {
  const S = h.settlements.length
  const q = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
  return h.population[q * S + id]
}

function feverGround(w: World, h: History, fever: Uint8Array | null, y: number): { living: number; pop: number } {
  const S = h.settlements.length
  const q = Math.min(h.snapshotCount - 1, Math.round(y / h.snapshotInterval))
  let living = 0, pop = 0
  const g = (FEVER.ground * 255) | 0
  for (let i = 0; i < S; i++) {
    const p = h.population[q * S + i]
    if (!(p > 0) || h.settlements[i].outpost) continue
    const c = h.settlements[i].cell
    const f = fever !== null ? fever[c] : 0
    if (f >= g) { living++; pop += p }
  }
  void w
  return { living, pop }
}

export function diseaseSeedStats(seed: number, withOff: boolean, years = 2000): DiseaseRow {
  const w = generateWorld(seed)
  let t = performance.now()
  const run = runHistory(w, { years })
  const ms = performance.now() - t
  const h = run.history
  let off: History | null = null, msOff = NaN
  if (withOff) { t = performance.now(); off = runHistory(w, { years, disease: false }).history; msOff = performance.now() - t }
  const ys = YEARS.filter((y) => y <= years)
  const S = h.settlements.length, last = h.snapshotCount - 1
  let towns = 0, cities = 0
  for (let i = 0; i < S; i++) { const p = h.population[last * S + i]; if (p >= TOWN_POPULATION) towns++; if (p >= CITY_POPULATION) cities++ }
  let townsOff = NaN, citiesOff = NaN
  if (off) { townsOff = 0; citiesOff = 0; const So = off.settlements.length, lo = off.snapshotCount - 1; for (let i = 0; i < So; i++) { const p = off.population[lo * So + i]; if (p >= TOWN_POPULATION) townsOff++; if (p >= CITY_POPULATION) citiesOff++ } }
  const P = h.peoples.length
  const alive = new Uint8Array(P)
  for (let i = 0; i < S; i++) if (h.population[last * S + i] > 0) alive[h.settlements[i].people] = 1
  let extinct = 0
  for (let p = 0; p < P; p++) if (!alive[p]) extinct++
  // Great epidemics.
  const O = h.outbreaks
  const great = h.epidemics.filter((e) => e.great)
  const greatPerK: number[] = []
  for (let k = 0; k * 1000 < years; k++) greatPerK.push(great.filter((e) => e.startYear >= k * 1000 && e.startYear < (k + 1) * 1000).length)
  let worstNet = 0, worstTown = 0
  const townShare = (e: number): number => {
    let dead = 0, pop = 0
    for (let i = 0; i < O.count; i++) {
      if (O.epidemic[i] !== e) continue
      const p = popAt(h, O.settlement[i], O.year[i])
      if (p < TOWN_POPULATION) continue
      dead += (O.mortality[i] / 255) * p
      pop += p
    }
    return pop > 0 ? dead / pop : 0
  }
  let maxTown = 0
  for (const e of great) {
    const x = e.network > 0 ? e.deaths / e.network : 0
    const t = townShare(e.id)
    if (t > maxTown) maxTown = t
    if (x > worstNet) { worstNet = x; worstTown = t }
  }
  // Clustering: cradle pairs meeting, lanes opening.
  const joins: number[] = []
  for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) {
    const y = h.contactYear[a * P + b]
    if (y > 0 && h.peoples[a].cradle !== h.peoples[b].cradle) joins.push(y)
  }
  for (const e of h.events) if (e.type === EventType.DirectRoute) joins.push(e.year)
  let clustered = 0
  for (const e of great) if (joins.some((y) => e.startYear >= y && e.startYear - y <= 150)) clustered++
  const contact = h.events.filter((e) => e.type === EventType.Epidemic)
  const contactMort = contact.length > 0 ? contact.reduce((x, e) => x + e.value, 0) / contact.length : 0
  let endemicAtEnd = 0
  for (let p = 0; p < P; p++) { let m = h.endemic[last * P + p] ?? 0; while (m) { endemicAtEnd += m & 1; m >>= 1 } }
  const dg = run.diag.disease2
  const sum = (a: number[] | undefined): number => (a ?? []).reduce((x, y) => x + y, 0)
  // Fever belt.
  const fy = [1000, 1500, 2000].filter((y) => y <= years)
  const fev = h.fever.length > 0 ? h.fever : null
  const feverLiving = fy.map((y) => feverGround(w, h, fev, y).living), feverPop = fy.map((y) => feverGround(w, h, fev, y).pop)
  const feverLivingOff = off ? fy.map((y) => feverGround(w, off as History, fev, y).living) : [], feverPopOff = off ? fy.map((y) => feverGround(w, off as History, fev, y).pop) : []
  // Armies.
  const stricken = h.events.filter((e) => e.type === EventType.ArmyStricken)
  let endedByDisease = 0
  const W = h.wars
  for (let k = 0; k < W.count; k++) {
    const end = W.endYear[k]
    if (end < 0) continue
    if (stricken.some((e) => e.value === k && end >= e.year && end - e.year <= 3)) endedByDisease++
  }
  let spentByDisease = 0
  const sp = run.diag.disease2?.spent ?? []
  for (let i = 0; i < sp.length; i += 2) { const end = W.endYear[sp[i + 1]]; if (end >= sp[i] && end - sp[i] <= 3) spentByDisease++ }
  // Quarantine: ports struck by great plague waves after the first quarantine.
  const Q = h.quarantines
  let firstQ = -1
  for (let k = 0; k < Q.count; k++) if (firstQ < 0 || Q.from[k] < firstQ) firstQ = Q.from[k]
  let qPorts = 0, qHit = 0, qTollS = 0, nPorts = 0, nHit = 0, nTollS = 0
  if (firstQ >= 0) {
    const ports = h.structures.filter((x) => x.type === StructureType.Port)
    for (const e of great) {
      if (h.diseases[e.disease].kind !== DiseaseKind.Plague || e.startYear < firstQ) continue
      const y = e.startYear
      const struck = new Map<number, number>() // (lookups only)
      for (let i = 0; i < O.count; i++) if (O.epidemic[i] === e.id) struck.set(O.settlement[i], O.mortality[i] / 255)
      const seen = new Uint8Array(S)
      for (const x of ports) {
        if (x.builtYear > y || (x.lostYear >= 0 && x.lostYear < y) || seen[x.settlement]) continue
        if (!e.peoples.includes(h.settlements[x.settlement].people)) continue
        seen[x.settlement] = 1
        let inQ = false
        for (let k = 0; k < Q.count; k++) if (Q.settlement[k] === x.settlement && Q.from[k] <= y && (Q.to[k] < 0 || Q.to[k] >= y)) inQ = true
        const tl = struck.get(x.settlement)
        if (inQ) { qPorts++; if (tl !== undefined) { qHit++; qTollS += tl } }
        else { nPorts++; if (tl !== undefined) { nHit++; nTollS += tl } }
      }
    }
  }
  const mem = [h.outbreaks.disease, h.outbreaks.settlement, h.outbreaks.year, h.outbreaks.mortality, h.outbreaks.source, h.outbreaks.via, h.outbreaks.epidemic, h.fever, h.feverTolerance, h.endemic, h.quarantines.settlement, h.quarantines.from, h.quarantines.to]
    .reduce((x, a) => x + a.byteLength, 0) + h.epidemics.length * 96 + h.diseases.length * 160
  const plagueWaves = h.epidemics.filter((e) => h.diseases[e.disease].kind === DiseaseKind.Plague && e.outbreaks >= 10).length
  return {
    seed, ms, msOff,
    pop: ys.map((y) => totals(h, y).pop), living: ys.map((y) => totals(h, y).living), routes: ys.map((y) => openRoutes(h, y)), towns, cities, extinct,
    popOff: off ? ys.map((y) => totals(off as History, y).pop) : [], livingOff: off ? ys.map((y) => totals(off as History, y).living) : [], routesOff: off ? ys.map((y) => openRoutes(off as History, y)) : [], townsOff, citiesOff,
    diseases: h.diseases.length, appeared: h.diseases.filter((d) => d.firstYear >= 0).length, epidemics: h.epidemics.length, outbreaks: O.count, great: great.length, greatPerK,
    worstNet, worstTown, maxTown, clustered, contactEpi: contact.length, contactMort,
    endemicEvents: h.events.filter((e) => e.type === EventType.Endemic).length, endemicAtEnd,
    deadEpi: sum(dg?.epiDead), deadEnd: sum(dg?.endDead), deadFever: sum(dg?.feverDead),
    feverLiving, feverPop, feverLivingOff, feverPopOff,
    armyStricken: stricken.length, wars: W.count, endedByDisease, spentByDisease,
    quarantines: Q.count, firstQuarantine: firstQ, qStruck: qPorts > 0 ? qHit / qPorts : NaN, qToll: qHit > 0 ? qTollS / qHit : NaN, nqStruck: nPorts > 0 ? nHit / nPorts : NaN, nqToll: nHit > 0 ? nTollS / nHit : NaN,
    memory: mem, plagueWaves,
  }
}

const med = (x: number[]): number => { const a = x.filter((v) => Number.isFinite(v)).sort((p, q) => p - q); if (a.length === 0) return NaN; return a.length % 2 ? a[a.length >> 1] : 0.5 * (a[a.length / 2 - 1] + a[a.length / 2]) }
const k = (x: number): string => (Number.isFinite(x) ? (x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(0) + 'k' : x.toFixed(0)) : '-')
const pc = (x: number): string => (Number.isFinite(x) ? (100 * x).toFixed(1) + '%' : '-')

export function formatDiseaseStats(rows: DiseaseRow[]): string {
  const L: string[] = []
  const n = rows.length
  L.push(`disease: medians over ${n} seeds (with the system | without)`)
  L.push(`  time ms ${med(rows.map((r) => r.ms)).toFixed(0)} (max ${Math.max(...rows.map((r) => r.ms)).toFixed(0)}) | ${med(rows.map((r) => r.msOff)).toFixed(0)} (max ${Math.max(...rows.map((r) => r.msOff).filter(Number.isFinite), 0).toFixed(0)})`)
  for (let i = 0; i < rows[0].pop.length; i++) {
    const y = YEARS[i]
    L.push(`  ${y}: pop ${k(med(rows.map((r) => r.pop[i])))} | ${k(med(rows.map((r) => r.popOff[i] ?? NaN)))}; living ${med(rows.map((r) => r.living[i])).toFixed(0)} | ${med(rows.map((r) => r.livingOff[i] ?? NaN)).toFixed(0)}; routes ${med(rows.map((r) => r.routes[i])).toFixed(0)} | ${med(rows.map((r) => r.routesOff[i] ?? NaN)).toFixed(0)}`)
  }
  L.push(`  towns ${med(rows.map((r) => r.towns))} | ${med(rows.map((r) => r.townsOff))}; cities ${med(rows.map((r) => r.cities))} | ${med(rows.map((r) => r.citiesOff))}; peoples extinct (all seeds) ${rows.reduce((x, r) => x + r.extinct, 0)}`)
  L.push(`  diseases ${med(rows.map((r) => r.diseases))} (appeared ${med(rows.map((r) => r.appeared))}); epidemics ${med(rows.map((r) => r.epidemics))}, outbreaks ${med(rows.map((r) => r.outbreaks))}`)
  L.push(`  great epidemics ${med(rows.map((r) => r.great))} [${Math.min(...rows.map((r) => r.great))}..${Math.max(...rows.map((r) => r.great))}] (target 3-10); per millennium ${rows[0].greatPerK.map((_, i) => med(rows.map((r) => r.greatPerK[i] ?? 0))).join('/')}; seeds in 3-10: ${rows.filter((r) => r.great >= 3 && r.great <= 10).length}/${n}`)
  L.push(`  worst: network ${pc(med(rows.map((r) => r.worstNet)))} [${pc(Math.min(...rows.map((r) => r.worstNet)))}..${pc(Math.max(...rows.map((r) => r.worstNet)))}] (10-30%), its towns ${pc(med(rows.map((r) => r.worstTown)))}; the deadliest in towns of a world's great epidemics ${pc(med(rows.map((r) => r.maxTown)))} [${pc(Math.min(...rows.map((r) => r.maxTown)))}..${pc(Math.max(...rows.map((r) => r.maxTown)))}] (25-50%)`)
  L.push(`  great epidemics within 150 years after cradles met or a lane opened: ${rows.reduce((x, r) => x + r.clustered, 0)} of ${rows.reduce((x, r) => x + r.great, 0)}`)
  L.push(`  contact epidemics (Epidemic events) ${med(rows.map((r) => r.contactEpi))} [${Math.min(...rows.map((r) => r.contactEpi))}..${Math.max(...rows.map((r) => r.contactEpi))}], seeds with one ${rows.filter((r) => r.contactEpi > 0).length}/${n}, expected loss ${pc(med(rows.filter((r) => r.contactEpi > 0).map((r) => r.contactMort)))}`)
  L.push(`  endemic events ${med(rows.map((r) => r.endemicEvents))}, (people, disease) endemic at the end ${med(rows.map((r) => r.endemicAtEnd))}`)
  L.push(`  deaths over the run: epidemics ${k(med(rows.map((r) => r.deadEpi)))}, endemic ${k(med(rows.map((r) => r.deadEnd)))}, fever ${k(med(rows.map((r) => r.deadFever)))}`)
  for (let i = 0; i < rows[0].feverLiving.length; i++) {
    const y = [1000, 1500, 2000][i]
    const rl = med(rows.map((r) => (r.feverLivingOff[i] > 0 ? r.feverLiving[i] / r.feverLivingOff[i] : NaN))), rp = med(rows.map((r) => (r.feverPopOff[i] > 0 ? r.feverPop[i] / r.feverPopOff[i] : NaN)))
    L.push(`  fever ground at ${y}: settlements ${med(rows.map((r) => r.feverLiving[i]))} | ${med(rows.map((r) => r.feverLivingOff[i] ?? NaN))} (ratio ${rl.toFixed(2)}), people ${k(med(rows.map((r) => r.feverPop[i])))} | ${k(med(rows.map((r) => r.feverPopOff[i] ?? NaN)))} (ratio ${rp.toFixed(2)})`)
  }
  L.push(`  armies stricken ${med(rows.map((r) => r.armyStricken))}, wars ${med(rows.map((r) => r.wars))}, ended within 3 years of it ${med(rows.map((r) => r.endedByDisease))} (all seeds ${rows.reduce((x, r) => x + r.endedByDisease, 0)}); campaigns ended by sickness (it spent the attacker) ${med(rows.map((r) => r.spentByDisease))} (all seeds ${rows.reduce((x, r) => x + r.spentByDisease, 0)})`)
  L.push(`  quarantines ${med(rows.map((r) => r.quarantines))}, seeds with one ${rows.filter((r) => r.quarantines > 0).length}/${n}, first ${med(rows.filter((r) => r.firstQuarantine >= 0).map((r) => r.firstQuarantine))}; great plague after: ports struck quarantined ${pc(med(rows.map((r) => r.qStruck)))} (toll ${pc(med(rows.map((r) => r.qToll)))}) vs not ${pc(med(rows.map((r) => r.nqStruck)))} (toll ${pc(med(rows.map((r) => r.nqToll)))})`)
  L.push(`  plague waves (>= 10 outbreaks) ${med(rows.map((r) => r.plagueWaves))}; memory of the disease fields ${(med(rows.map((r) => r.memory)) / 1e6).toFixed(2)} MB (max ${(Math.max(...rows.map((r) => r.memory)) / 1e6).toFixed(2)})`)
  L.push('  per seed: ' + rows.map((r) => `${r.seed}: great ${r.great} worst ${pc(r.worstNet)} contact ${r.contactEpi} pop ${k(r.pop[r.pop.length - 1])}|${k(r.popOff[r.popOff.length - 1] ?? NaN)}`).join('; '))
  return L.join('\n')
}

/** Per-seed printout: diseases and origins, each great epidemic's path (cities struck), the population curve every 25 years, a fever map. */
export function diseaseDetail(seed: number, years = 2000): string {
  const w = generateWorld(seed)
  const h = runHistory(w, { years }).history
  const L: string[] = []
  const S = h.settlements.length
  const name = (id: number): string => (id >= 0 ? `${h.settlements[id].name}(${id})` : '-')
  L.push(`=== seed ${seed}: diseases ===`)
  for (const d of h.diseases) {
    const kind = ['crowd', 'plague', 'fever', 'camp'][d.kind]
    const origin = d.kind === DiseaseKind.Plague ? `reservoir at cell ${d.originCell}` : d.firstSettlement >= 0 ? `cell ${d.originCell}` : '-'
    L.push(`  ${d.id} ${d.name || '(never appeared)'} [${d.archetype}, ${kind}] first ${d.firstYear >= 0 ? d.firstYear + ' at ' + name(d.firstSettlement) + ' among ' + (h.peoples[d.originPeople]?.name ?? '-') : 'never'}; origin ${origin}; mortality ${d.mortality.toFixed(2)}, ${d.duration} y, fade ${d.fade}, sea ${d.sea}, crowd ${d.crowd}, ccs ${d.criticalSize}`)
  }
  const O = h.outbreaks
  L.push(`  epidemics ${h.epidemics.length}, outbreaks ${O.count}, great ${h.epidemics.filter((e) => e.great).length}`)
  for (const e of h.epidemics) {
    if (!e.great) continue
    const d = h.diseases[e.disease]
    L.push(`  great epidemic ${e.id}: ${d.name} ${e.startYear}-${e.endYear >= 0 ? e.endYear : '...'} from ${name(e.origin)}${e.source >= 0 ? ' (came from ' + name(e.source) + ')' : ''}: ${e.outbreaks} places, ${(e.deaths / 1000).toFixed(1)}k dead of ${(e.network / 1000).toFixed(0)}k (${pc(e.deaths / e.network)}), peoples ${e.peoples.map((p) => h.peoples[p].name).join(', ')}`)
    const path: string[] = []
    for (let i = 0; i < O.count; i++) {
      if (O.epidemic[i] !== e.id) continue
      const p = popAt(h, O.settlement[i], O.year[i])
      if (p < TOWN_POPULATION) continue
      path.push(`${O.year[i]} ${h.settlements[O.settlement[i]].name}${p >= CITY_POPULATION ? '*' : ''} ${(100 * O.mortality[i] / 255).toFixed(0)}%`)
    }
    L.push(`    towns struck (* city): ${path.length > 0 ? path.join(', ') : 'none'}`)
  }
  // Population curve every 25 years, epidemics marked.
  L.push('  world population every 25 years (G great epidemic begins, c contact epidemic, | 100k):')
  const marks = new Map<number, string>() // (lookups only)
  for (const e of h.epidemics) if (e.great) { const b = Math.floor(e.startYear / 25); marks.set(b, (marks.get(b) ?? '') + 'G') }
  for (const e of h.events) if (e.type === EventType.Epidemic) { const b = Math.floor(e.year / 25); marks.set(b, (marks.get(b) ?? '') + 'c') }
  let maxP = 1
  const tot: number[] = []
  for (let y = 0; y <= h.years; y += 25) { const q = y / h.snapshotInterval; let t = 0; for (let i = 0; i < S; i++) t += h.population[q * S + i]; tot.push(t); if (t > maxP) maxP = t }
  for (let b = 0; b < tot.length; b++) {
    const bar = '#'.repeat(Math.round((60 * tot[b]) / maxP))
    L.push(`    ${String(b * 25).padStart(4)} ${(tot[b] / 1000).toFixed(0).padStart(5)}k ${bar} ${marks.get(b) ?? ''}`)
  }
  L.push(asciiFever(w, h))
  return L.join('\n')
}

/** Equirectangular ASCII map of the fever belt: ' ' sea, '.' land, ':' fever >= .1, '+' >= .25, '#' >= .5, settlements on fever ground at the end 'o'. */
export function asciiFever(w: World, h: History, cols = 96, rows = 36): string {
  const N = w.grid.cellCount
  const P = w.grid.positions
  const grid: string[][] = []
  const best: number[][] = []
  for (let r = 0; r < rows; r++) { grid.push(new Array<string>(cols).fill(' ')); best.push(new Array<number>(cols).fill(-1)) }
  const rank = (c: number): number => {
    if (w.elevation[c] < 0) return 0
    const f = h.fever[c] / 255
    return f >= 0.5 ? 4 : f >= 0.25 ? 3 : f >= 0.1 ? 2 : 1
  }
  const ch = ' .:+#'
  const cellOf = (c: number): [number, number] => {
    // (sine of latitude down the rows; a pseudo-angle of longitude across: no transcendental functions)
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2]
    const m = Math.abs(x) + Math.abs(z)
    const a = m > 0 ? (z >= 0 ? 1 - x / m : 3 + x / m) / 4 : 0
    return [Math.min(rows - 1, Math.max(0, Math.floor(((1 - y) / 2) * rows))), Math.min(cols - 1, Math.max(0, Math.floor(a * cols)))]
  }
  for (let c = 0; c < N; c++) {
    const [r, q] = cellOf(c)
    const x = rank(c)
    if (x > best[r][q]) { best[r][q] = x; grid[r][q] = ch[x] }
  }
  const S = h.settlements.length, last = h.snapshotCount - 1
  for (let i = 0; i < S; i++) {
    if (!(h.population[last * S + i] > 0)) continue
    const c = h.settlements[i].cell
    if (h.fever[c] < FEVER.ground * 255) continue
    const [r, q] = cellOf(c)
    grid[r][q] = 'o'
  }
  return '  fever belt (' + "' ' sea, . land, : >= .1, + >= .25, # >= .5, o settlement on fever ground at the end):\n" + grid.map((r) => '   |' + r.join('') + '|').join('\n')
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
  const args = argv.slice(2)
  const off = args.includes('--off')
  const json = args.includes('--json')
  const detail = args.includes('--detail')
  const yi = args.indexOf('--years')
  const years = yi >= 0 ? Number(args[yi + 1]) : 2000
  const seeds = args.filter((a, i) => !a.startsWith('--') && (yi < 0 || i !== yi + 1)).map(Number).filter((s) => Number.isFinite(s))
  const use = seeds.length > 0 ? seeds : HISTORY_STATS_SEEDS
  if (detail) for (const s of use) console.log(diseaseDetail(s, years))
  else {
    const rows = use.map((s) => diseaseSeedStats(s, off, years))
    console.log(json ? JSON.stringify(rows) : formatDiseaseStats(rows))
  }
}
