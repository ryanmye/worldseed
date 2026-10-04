// rulers, religion: headless tuning harness for rulers, houses, successions, unions and faiths. Run with:
//   node src/sim/history/rulers/dynastyStats.ts [seed ...]            (Node >= 23, native type stripping)
//   node src/sim/history/rulers/dynastyStats.ts --report 12345 42     (also king lists, houses, unions, faiths, holy wars and faith maps)
// Reports, across seeds, reign lengths, house lifetimes, succession outcomes, crises, civil wars, partitions, unions and wars
// of succession, and for religion the faiths founded, their spread (share of settlements following a universal faith,
// connected against isolated, conversion year against trade connectivity), schisms, state religions, holy wars, persecutions
// and the wealth of holy cities.

import { AccessionHow, Biome, EventType, FaithKind, ReignEnd, SuccessionLaw, TOWN_POPULATION, UnionEnd } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { generateWorld } from '../../index.ts'
import { runHistory } from '../index.ts'
import type { HistoryRun } from '../index.ts'
import { HISTORY_STATS_SEEDS, spearman } from '../stats.ts'
import { Tier, tierOf } from '../polity/state.ts'

export interface DynastyRow {
  seed: number
  ms: number
  rulers: number
  houses: number
  /** Reign lengths (ended reigns of houses in Kingdoms or larger at the accession). */
  reigns: number[]
  /** House lifetimes (houses that ever ruled a Kingdom or larger; ongoing ones to the end). */
  houseLife: number[]
  houseLifeAll: number[]
  /** Kingdom or larger polity-snapshots without a ruler. */
  gaps: number
  successions: number
  clean: number
  regencies: number
  contested: number
  extinct: number
  usurped: number
  crises: number
  civil: number
  partitions: number
  reunified: number
  unions: number
  merged: number
  split: number
  succWars: number
  marriages: number
  // religion
  universal: number
  firstFaith: number
  schisms: number
  /** Share of living settlements whose majority follows a universal faith at 1000, 1500, 2000; connected / isolated at 2000. */
  uni: number[]
  uniConnected: number
  uniIsolated: number
  /** Spearman of the year a settlement turned to a universal faith against its trade routes (negative: the connected first). */
  convCorr: number
  states: number
  stateShare2000: number
  holyWars: number
  warsAfter: number
  persecutions: number
  flights: number
  /** Percentile (0 poorest .. 1 richest) of the holy cities' wealth among living towns at the end (median over holy cities). */
  holyRank: number
  oldDied: number
  layerBytes: number
}

const med = (a: number[]): number => { if (a.length === 0) return NaN; const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : 0.5 * (s[s.length / 2 - 1] + s[s.length / 2]) }
const pct = (a: number[], q: number): number => { if (a.length === 0) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))] }

/** Tier of each polity at snapshot q (from the snapshot's membership and people). */
function tiersAt(h: History, q: number): Int8Array {
  const S = h.settlements.length, P = h.polities.length
  const pop = new Float64Array(P), mem = new Int32Array(P)
  let W = 0
  const peoplePop = new Map<number, Float64Array>()
  for (let i = 0; i < S; i++) {
    const x = h.population[q * S + i]
    if (x <= 0 || h.settlements[i].outpost) continue
    W += x
    const p = h.polity[q * S + i]
    if (p < 0) continue
    pop[p] += x; mem[p]++
    let pp = peoplePop.get(p)
    if (!pp) { pp = new Float64Array(h.peoples.length); peoplePop.set(p, pp) }
    pp[h.settlements[i].people] += x
  }
  const out = new Int8Array(P).fill(-1)
  for (let p = 0; p < P; p++) {
    if (mem[p] === 0) continue
    const pp = peoplePop.get(p)
    let multi = 0
    if (pp) for (let k = 0; k < pp.length; k++) if (pp[k] >= 0.15 * pop[p]) multi++
    out[p] = tierOf(pop[p], mem[p], multi >= 2, W)
  }
  return out
}

/** The reign on p's throne at year y (-1). */
export function rulerAt(h: History, p: number, y: number): number {
  let best = -1
  for (let k = h.reignOffsets[p]; k < h.reignOffsets[p + 1]; k++) { const r = h.reignIds[k]; if (h.rulers[r].acceded <= y) best = r; else break }
  return best
}

export function dynastyStats(seed: number, run: HistoryRun, ms: number): DynastyRow {
  const h = run.history
  const S = h.settlements.length
  const Y = h.years
  const ev = (t: number): number => h.events.filter((e) => e.type === t).length
  // Tiers at each snapshot (every 25 years for speed), and which houses ever ruled a Kingdom+.
  const bigHouse = new Uint8Array(h.dynasties.length)
  const bigAt = new Map<number, Int8Array>()
  for (let q = 0; q < h.snapshotCount; q += 5) bigAt.set(q, tiersAt(h, q))
  const tierAtYear = (p: number, y: number): number => { const q = Math.floor(y / h.snapshotInterval / 5) * 5; return bigAt.get(q)?.[p] ?? -1 }
  const reigns: number[] = []
  for (const r of h.rulers) {
    if (r.dynasty < 0) continue
    const t = tierAtYear(r.polity, r.acceded)
    if (t >= Tier.Kingdom) bigHouse[r.dynasty] = 1
    if (r.ended >= 0 && t >= Tier.Kingdom) reigns.push(r.ended - r.acceded)
  }
  const houseLife: number[] = [], houseLifeAll: number[] = []
  for (const d of h.dynasties) {
    const life = (d.ended >= 0 ? d.ended : Y) - d.founded
    houseLifeAll.push(life)
    if (bigHouse[d.id]) houseLife.push(life)
  }
  // Every Kingdom+ has a ruler at every snapshot.
  let gaps = 0
  for (const [q, tiers] of bigAt) {
    const y = q * h.snapshotInterval
    for (let p = 0; p < h.polities.length; p++) {
      if (tiers[p] < Tier.Kingdom) continue
      const r = rulerAt(h, p, y)
      if (r < 0 || (h.rulers[r].ended >= 0 && h.rulers[r].ended < y)) gaps++
    }
  }
  const d = run.diag.rulers
  let merged = 0, split = 0
  for (let k = 0; k < h.unions.count; k++) { if (h.unions.end[k] === UnionEnd.Merged) merged++; else if (h.unions.end[k] === UnionEnd.Split) split++ }
  // Religion.
  const uniF = h.faiths.filter((f) => f.kind === FaithKind.Universal)
  const founded = uniF.filter((f) => f.parent < 0)
  const isUni = (f: number): boolean => f !== 255 && f < h.faiths.length && h.faiths[f].kind === FaithKind.Universal
  const shareAt = (y: number): number => {
    const q = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
    let n = 0, u = 0
    for (let i = 0; i < S; i++) { const f = h.faith[q * S + i]; if (f === 255 || h.settlements[i].outpost) continue; n++; if (isUni(f)) u++ }
    return n ? u / n : 0
  }
  const RC = h.trade.count, TQ = h.tradeSnapshotCount - 1
  const deg = new Int32Array(S)
  for (let r = 0; r < RC; r++) if (h.tradeVolume[TQ * RC + r] > 0) { deg[h.trade.a[r]]++; deg[h.trade.b[r]]++ }
  const q = h.snapshotCount - 1
  let cn = 0, cu = 0, inn = 0, iu = 0
  const cy: number[] = [], cd: number[] = []
  const first = run.diag.religion?.firstUniversal
  for (let i = 0; i < S; i++) {
    const f = h.faith[q * S + i]
    if (f === 255 || h.settlements[i].outpost) continue
    if (deg[i] > 0) { cn++; if (isUni(f)) cu++ } else { inn++; if (isUni(f)) iu++ }
    if (first && first[i] >= 0) { cy.push(first[i]); cd.push(deg[i]) }
  }
  const P = h.polities.length
  let st = 0, alive = 0
  for (let p = 0; p < P; p++) { const x = h.polities[p]; if (x.endedYear >= 0) continue; alive++; if (h.stateFaith[q * P + p] > 0) st++ }
  const firstYear = founded.length ? founded[0].foundedYear : -1
  let warsAfter = 0
  for (let w = 0; w < h.wars.count; w++) if (firstYear >= 0 && h.wars.startYear[w] >= firstYear) warsAfter++
  // Holy cities' wealth among the living towns.
  const towns: number[] = []
  for (let i = 0; i < S; i++) if (h.population[q * S + i] >= TOWN_POPULATION) towns.push(h.wealth[q * S + i])
  towns.sort((a, b) => a - b)
  const ranks: number[] = []
  for (const f of uniF) {
    const c = f.holyCity
    if (c < 0 || h.population[q * S + c] <= 0 || towns.length === 0) continue
    const wv = h.wealth[q * S + c]
    let k = 0
    while (k < towns.length && towns[k] < wv) k++
    ranks.push(k / towns.length)
  }
  return {
    seed, ms, rulers: h.rulers.length, houses: h.dynasties.length, reigns, houseLife, houseLifeAll, gaps,
    successions: d?.successions ?? 0, clean: d?.clean ?? 0, regencies: d?.regencies ?? 0, contested: d?.contested ?? 0, extinct: d?.extinct ?? 0, usurped: d?.usurped ?? 0,
    crises: ev(EventType.SuccessionCrisis), civil: ev(EventType.CivilWar), partitions: ev(EventType.Partitioned), reunified: ev(EventType.Reunified),
    unions: h.unions.count, merged, split, succWars: h.successionWars.length, marriages: h.marriages.count,
    universal: founded.length, firstFaith: firstYear, schisms: uniF.length - founded.length,
    uni: [shareAt(1000), shareAt(1500), shareAt(2000)], uniConnected: cn ? cu / cn : 0, uniIsolated: inn ? iu / inn : NaN, convCorr: spearman(cy, cd),
    states: ev(EventType.StateReligion), stateShare2000: alive ? st / alive : 0, holyWars: h.holyWars.length, warsAfter, persecutions: ev(EventType.Persecution),
    flights: run.diag.religion?.flights ?? 0, holyRank: med(ranks), oldDied: h.events.filter((e) => e.type === EventType.FaithDied && h.faiths[e.value].kind === FaithKind.Traditional).length,
    layerBytes: h.faith.byteLength + h.faithShare.byteLength + h.stateFaith.byteLength,
  }
}

const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '  - ')
const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : '-')

export function formatDynastyStats(rows: DynastyRow[]): string {
  const lines: string[] = []
  lines.push('  seed    ms rulers houses reignMed p10 p90 <3y  houseMed p90 max gaps  succ clean reg cont ext usurp  crisis civil part reun  union merg split swar marr  | univ first schism  uni1000 uni1500 uni2000 conn isol corr  state stSh holy/wars pers flee holyRank oldDied  bytes')
  for (const r of rows) {
    const short = r.reigns.filter((x) => x < 3).length / (r.reigns.length || 1)
    lines.push([
      String(r.seed).padStart(6), f0(r.ms).padStart(5), String(r.rulers).padStart(6), String(r.houses).padStart(6),
      f0(med(r.reigns)).padStart(8), f0(pct(r.reigns, 0.1)).padStart(3), f0(pct(r.reigns, 0.9)).padStart(3), f2(short).padStart(4),
      f0(med(r.houseLife)).padStart(9), f0(pct(r.houseLife, 0.9)).padStart(3), f0(Math.max(...r.houseLife, 0)).padStart(4), String(r.gaps).padStart(4),
      String(r.successions).padStart(5), String(r.clean).padStart(5), String(r.regencies).padStart(3), String(r.contested).padStart(4), String(r.extinct).padStart(3), String(r.usurped).padStart(5),
      String(r.crises).padStart(7), String(r.civil).padStart(5), String(r.partitions).padStart(4), String(r.reunified).padStart(4),
      String(r.unions).padStart(6), String(r.merged).padStart(4), String(r.split).padStart(5), String(r.succWars).padStart(4), String(r.marriages).padStart(4), ' |',
      String(r.universal).padStart(4), String(r.firstFaith).padStart(5), String(r.schisms).padStart(6),
      f2(r.uni[0]).padStart(8), f2(r.uni[1]).padStart(7), f2(r.uni[2]).padStart(7), f2(r.uniConnected).padStart(4), f2(r.uniIsolated).padStart(4), f2(r.convCorr).padStart(5),
      String(r.states).padStart(6), f2(r.stateShare2000).padStart(4), `${r.holyWars}/${r.warsAfter}`.padStart(9), String(r.persecutions).padStart(4), String(r.flights).padStart(4), f2(r.holyRank).padStart(8), String(r.oldDied).padStart(7), String(r.layerBytes).padStart(7),
    ].join(' '))
  }
  const m = (f: (r: DynastyRow) => number): string => f2(med(rows.map(f)))
  const all = rows.flatMap((r) => r.reigns)
  lines.push('')
  lines.push(`medians over ${rows.length} seeds: reign median ${m((r) => med(r.reigns))} (pooled p10 ${f0(pct(all, 0.1))}, p90 ${f0(pct(all, 0.9))}, max ${f0(Math.max(...all))}; < 3 years ${f2(all.filter((x) => x < 3).length / all.length)}); house lifetime (Kingdom+) ${m((r) => med(r.houseLife))}, all houses ${m((r) => med(r.houseLifeAll))}, p90 ${m((r) => pct(r.houseLife, 0.9))}; gaps (Kingdom+ without a ruler) total ${rows.reduce((a, r) => a + r.gaps, 0)}`)
  lines.push(`  successions ${m((r) => r.successions)}: clean ${m((r) => r.clean / r.successions)}, regencies ${m((r) => r.regencies / r.successions)}, contested ${m((r) => r.contested / r.successions)}, extinct ${m((r) => r.extinct / r.successions)}, usurped ${m((r) => r.usurped / r.successions)}`)
  lines.push(`  crises ${m((r) => r.crises)}, civil wars ${m((r) => r.civil)} (range ${Math.min(...rows.map((r) => r.civil))}..${Math.max(...rows.map((r) => r.civil))}), partitions sum ${rows.reduce((a, r) => a + r.partitions, 0)} (worlds ${rows.filter((r) => r.partitions > 0).length}), reunifications sum ${rows.reduce((a, r) => a + r.reunified, 0)} (worlds ${rows.filter((r) => r.reunified > 0).length})`)
  lines.push(`  unions ${m((r) => r.unions)} (sum ${rows.reduce((a, r) => a + r.unions, 0)}, merged ${rows.reduce((a, r) => a + r.merged, 0)}, split ${rows.reduce((a, r) => a + r.split, 0)}), wars of succession ${m((r) => r.succWars)} (worlds with one ${rows.filter((r) => r.succWars > 0).length}), marriages ${m((r) => r.marriages)}`)
  lines.push(`  universal faiths ${m((r) => r.universal)} (range ${Math.min(...rows.map((r) => r.universal))}..${Math.max(...rows.map((r) => r.universal))}), first founded ${m((r) => r.firstFaith)} (before 500 in ${rows.filter((r) => r.firstFaith >= 0 && r.firstFaith < 500).length}), schisms ${m((r) => r.schisms)} (worlds with one ${rows.filter((r) => r.schisms > 0).length})`)
  lines.push(`  universal majority 1000/1500/2000 ${m((r) => r.uni[0])} / ${m((r) => r.uni[1])} / ${m((r) => r.uni[2])}; connected ${m((r) => r.uniConnected)} vs isolated ${m((r) => r.uniIsolated)}; conversion year vs routes (Spearman) ${m((r) => r.convCorr)}`)
  lines.push(`  state religions adopted ${m((r) => r.states)}, share of living polities with one at 2000 ${m((r) => r.stateShare2000)}; holy wars / wars since the first faith ${m((r) => r.holyWars / (r.warsAfter || 1))}; persecutions ${m((r) => r.persecutions)}, flights ${m((r) => r.flights)}; holy cities' wealth percentile among towns ${m((r) => r.holyRank)}; old faiths died ${m((r) => r.oldDied)}; layer bytes max ${Math.max(...rows.map((r) => r.layerBytes))}`)
  lines.push(`  rulers max ${Math.max(...rows.map((r) => r.rulers))}, houses max ${Math.max(...rows.map((r) => r.houses))}; ms median ${m((r) => r.ms)} max ${f0(Math.max(...rows.map((r) => r.ms)))}`)
  return lines.join('\n')
}

const HOW = ['founded', 'inherited', 'elected', 'usurped', 'conquest', 'union', 'claimant']
const END = ['reigning', 'died', 'fell in battle', 'killed at the fall of the capital', 'overthrown', 'deposed', 'plague', 'realm ended', 'term ended']
const LAW = ['primogeniture', 'partible', 'elective', 'seniority']
const ROMAN = (n: number): string => { const v = [10, 9, 5, 4, 1], s = ['X', 'IX', 'V', 'IV', 'I']; let o = ''; for (let i = 0; i < v.length; i++) while (n >= v[i]) { o += s[i]; n -= v[i] } return o }

/** King lists, houses, unions, faiths and maps for one seed. */
export function dynastyReport(world: World, h: History): string {
  const out: string[] = []
  const S = h.settlements.length
  const P = h.polities.length
  const life = (p: number): number => (h.polities[p].endedYear >= 0 ? h.polities[p].endedYear : h.years) - h.polities[p].foundedYear
  const order = [...Array(P).keys()].filter((p) => h.polities[p].origin !== 6).sort((a, b) => life(b) - life(a) || a - b)
  const title = (r: number): string => {
    const x = h.rulers[r]
    const repeat = x.regnal > 1 || h.rulers.some((y) => y.polity === x.polity && y.name === x.name && y.id !== x.id)
    return `${x.name}${repeat ? ' ' + ROMAN(x.regnal) : ''}${x.female ? ' (queen)' : ''}`
  }
  for (const p of order.slice(0, 2)) {
    const x = h.polities[p]
    out.push(`\n--- ${x.name} (polity ${p}, ${x.foundedYear}-${x.endedYear >= 0 ? x.endedYear : 'now'}, people ${h.peoples[x.people].name}) ---`)
    for (let k = h.reignOffsets[p]; k < h.reignOffsets[p + 1]; k++) {
      const r = h.reignIds[k]
      const y = h.rulers[r]
      const house = y.dynasty >= 0 ? `House of ${h.dynasties[y.dynasty].name}` : 'elected head'
      const faith = y.faith >= 0 ? `, ${h.faiths[y.faith].name}` : ''
      out.push(`  ${String(y.acceded).padStart(4)}-${y.ended >= 0 ? String(y.ended).padStart(4) : 'now '} ${title(r).padEnd(18)} ${house.padEnd(24)} b.${y.born} ${HOW[y.how]} (${LAW[y.law]}) -> ${END[y.end]}${faith}  ab ${y.ability.toFixed(2)} war ${y.warlike.toFixed(2)}`)
    }
  }
  // Houses: the longest-lived twenty.
  const ds = h.dynasties.map((d) => ({ d, life: (d.ended >= 0 ? d.ended : h.years) - d.founded })).sort((a, b) => b.life - a.life).slice(0, 20)
  out.push(`\n--- houses: ${h.dynasties.length}; the longest twenty ---`)
  for (const { d, life: l } of ds) {
    let n = 0
    for (const r of h.rulers) if (r.dynasty === d.id) n++
    out.push(`  House of ${d.name.padEnd(12)} ${d.founded}-${d.ended >= 0 ? d.ended : 'now'} (${l} y, ${n} reigns), home ${h.polities[d.home].name}, founder ${h.rulers[d.founder] ? title(d.founder) : '-'}`)
  }
  out.push(`\n--- unions: ${h.unions.count}; wars of succession: ${h.successionWars.length}; marriages: ${h.marriages.count} ---`)
  for (let k = 0; k < h.unions.count; k++) {
    const r = h.unions.ruler[k]
    out.push(`  ${h.unions.startYear[k]}-${h.unions.endYear[k] >= 0 ? h.unions.endYear[k] : 'now'}: ${h.polities[h.unions.senior[k]].name} + ${h.polities[h.unions.junior[k]].name} under ${title(r)} of ${h.dynasties[h.rulers[r].dynasty].name} -> ${['ongoing', 'merged', 'split', 'ended'][h.unions.end[k]]}`)
  }
  for (const w of h.successionWars) out.push(`  war of succession ${w}: ${h.polities[h.wars.attacker[w]].name} on ${h.polities[h.wars.defender[w]].name} ${h.wars.startYear[w]}-${h.wars.endYear[w]} outcome ${h.wars.outcome[w]}`)
  // Faiths.
  out.push(`\n--- faiths: ${h.faiths.length} ---`)
  const share = (f: number, y: number): string => {
    const q = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
    let n = 0, c = 0
    for (let i = 0; i < S; i++) { const g = h.faith[q * S + i]; if (g === 255) continue; n++; if (g === f) c++ }
    return n ? (c / n).toFixed(2) : '-'
  }
  for (const f of h.faiths) {
    const ms = [500, 1000, 1500, 2000].filter((y) => y <= h.years).map((y) => `${y}:${share(f.id, y)}`).join(' ')
    out.push(`  ${String(f.id).padStart(3)} ${f.name.padEnd(12)} ${f.kind ? 'universal' : 'traditional'} ${f.parent >= 0 ? 'schism of ' + h.faiths[f.parent].name + ' ' : ''}people ${h.peoples[f.people].name} founded ${f.foundedYear} at ${h.settlements[f.foundedAt].name}${f.holyCity >= 0 ? ' (holy city ' + h.settlements[f.holyCity].name + ')' : ''} zeal ${f.zeal.toFixed(2)} org ${f.organisation.toFixed(2)} appeal ${f.appeal.toFixed(2)}${f.endedYear >= 0 ? ' died ' + f.endedYear : ''}; majority share ${ms}`)
  }
  const pick = (t: number, fmt: (e: History['events'][number]) => string, max = 30): void => {
    const es = h.events.filter((e) => e.type === t)
    for (const e of es.slice(0, max)) out.push('  ' + fmt(e))
    if (es.length > max) out.push(`  ... ${es.length - max} more`)
  }
  const capName = (id: number): string => (id >= 0 ? h.settlements[id].name : '-')
  out.push('\n--- schisms, conversions, state religions, persecutions, holy wars, holy cities fallen ---')
  pick(EventType.Schism, (e) => `${e.year} schism: ${h.faiths[e.value].name} split from ${h.faiths[h.faiths[e.value].parent].name} at ${capName(e.settlement)}`)
  const reignAt = (cap: number, y: number): number => { for (let p = 0; p < h.polities.length; p++) { const x = h.polities[p]; if (y < x.foundedYear || (x.endedYear >= 0 && y > x.endedYear)) continue; let c = x.capitals[0]; for (let i = 0; i < x.capitals.length; i++) if (x.capitalYears[i] <= y) c = x.capitals[i]; if (c === cap) return p } return -1 }
  const polName = (cap: number, y: number): string => { const p = reignAt(cap, y); return p >= 0 ? h.polities[p].name : capName(cap) }
  pick(EventType.RulerConverted, (e) => { const p = reignAt(e.settlement, e.year); const r = p >= 0 ? rulerAt(h, p, e.year) : -1; return `${e.year} ${r >= 0 ? title(r) : 'the ruler'} at ${capName(e.settlement)} converted from ${e.extra !== undefined && e.extra >= 0 ? h.faiths[e.extra].name : '-'} to ${h.faiths[e.value].name}` }, 20)
  pick(EventType.StateReligion, (e) => `${e.year} ${polName(e.settlement, e.year)}: state religion ${h.faiths[e.value].name}`, 20)
  pick(EventType.Persecution, (e) => `${e.year} ${polName(e.settlement, e.year)} persecutes the ${e.extra !== undefined && e.extra >= 0 ? h.faiths[e.extra].name : '-'} (state faith ${h.faiths[e.value].name})`, 15)
  pick(EventType.HolyWar, (e) => `${e.year} holy war of ${h.polities[h.wars.attacker[e.value]].name} (${h.faiths[e.extra ?? 0].name}) on ${h.polities[h.wars.defender[e.value]].name}`, 15)
  pick(EventType.HolyCityFell, (e) => `${e.year} holy city ${capName(e.settlement)} of ${h.faiths[e.value].name} fell`, 10)
  pick(EventType.FaithDied, (e) => `${e.year} the ${h.faiths[e.value].name} faith died out (last at ${capName(e.settlement)})`, 10)
  for (const y of [1000, 1500, 2000]) if (y <= h.years) out.push(asciiFaithMap(world, h, y))
  return out.join('\n')
}

/** ASCII map of the majority faith of the settlements at a year (letters by faith id order; lower case: traditional). */
export function asciiFaithMap(world: World, h: History, year: number, W = 120, H = 40): string {
  const Pp = world.grid.positions
  const S = h.settlements.length
  const q = Math.min(h.snapshotCount - 1, Math.floor(year / h.snapshotInterval))
  const grid: string[] = new Array(W * H).fill(' ')
  const at = (i: number): number => {
    const x = Pp[i * 3], y = Pp[i * 3 + 1], z = Pp[i * 3 + 2]
    const lon = Math.atan2(z, x), lat = Math.asin(Math.max(-1, Math.min(1, y)))
    const col = Math.min(W - 1, Math.floor(((lon / Math.PI + 1) / 2) * W))
    const row = Math.min(H - 1, Math.floor((1 - (lat / (Math.PI / 2) + 1) / 2) * H))
    return row * W + col
  }
  for (let c = 0; c < world.grid.cellCount; c++) if (world.elevation[c] >= 0) { const pix = at(c); if (grid[pix] === ' ') grid[pix] = world.biome[c] === Biome.Ice ? '#' : '.' }
  const lower = 'abcdefghijklmnopqrstuvwxyz', upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const sym = (f: number): string => {
    const x = h.faiths[f]
    if (x.kind === FaithKind.Traditional) return lower[f % 26]
    let k = 0
    for (let g = 0; g < f; g++) if (h.faiths[g].kind === FaithKind.Universal) k++
    return upper[k % upper.length]
  }
  const count = new Map<number, number>()
  for (let i = 0; i < S; i++) {
    const f = h.faith[q * S + i]
    if (f === 255) continue
    grid[at(h.settlements[i].cell)] = sym(f)
    count.set(f, (count.get(f) ?? 0) + 1)
  }
  for (const f of h.faiths) if (f.holyCity >= 0 && f.foundedYear <= year && h.faith[q * S + f.holyCity] !== 255) grid[at(h.settlements[f.holyCity].cell)] = '*'
  const legend = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${sym(f)} ${h.faiths[f].name} ${n}`).join('  ')
  const lines = [`faiths at ${year}: ${legend}   (* holy city; lower case traditional faiths)`]
  for (let row = 0; row < H; row++) lines.push(grid.slice(row * W, row * W + W).join(''))
  return lines.join('\n')
}

export function runDynastyStats(seeds: number[], report: boolean): string {
  runHistory(generateWorld(0), { years: 300 })
  const rows: DynastyRow[] = []
  const extra: string[] = []
  for (const seed of seeds) {
    const w = generateWorld(seed)
    const t0 = performance.now()
    const run = runHistory(w)
    rows.push(dynastyStats(seed, run, performance.now() - t0))
    if (report) extra.push(`\n=== seed ${seed} ===` + dynastyReport(w, run.history))
  }
  return formatDynastyStats(rows) + '\n' + extra.join('\n')
}

void AccessionHow
void ReignEnd
void SuccessionLaw

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
  const args = argv.slice(2)
  const report = args.includes('--report')
  const seeds = args.map(Number).filter((s) => Number.isFinite(s))
  console.log(runDynastyStats(seeds.length > 0 ? seeds : HISTORY_STATS_SEEDS, report))
}
