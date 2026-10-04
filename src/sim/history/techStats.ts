// Stats harness, technology and exploration (see stats.ts): spread of technology between peoples and
// contact networks, the gap at first contact between cradles and how fast it closes, expeditions, their
// senders, bases, poles and other discoveries, and tables / maps for single seeds.

import { Biome, EventType, TECH_FIELD_COUNT } from '../../contract.ts'
import type { History, World } from '../../contract.ts'
import type { HistoryDiagnostics } from './index.ts'
import type { Terrain } from './terrain.ts'

/** Years at which technology figures are taken. */
export const TECH_YEARS = [500, 1000, 1500, 2000]
const F = TECH_FIELD_COUNT
const FIELD = ['Farm', 'Sea', 'Metal', 'Crafts']

export interface TechStats {
  /** Per TECH_YEARS per field: median level over living peoples; most / least advanced living people; most / least advanced network (by its best member; NaN with one network); largest most / least ratio within a network. */
  median: number[][]
  spread: number[][]
  between: number[][]
  within: number[][]
  /** Contact networks per TECH_YEARS. */
  networks: number[]
  /** First contacts joining two networks of different cradles: year, gap in mean level (fields averaged) between the two networks' best, ratio of their levels, years until the gap halved (-1 if never). */
  contacts: { year: number; gap: number; ratio: number; half: number }[]
  /** Year each cradle first met another cradle (-1 never). */
  cradleMet: number[]
  techAdvances: number
}

/** Contact networks (label: the smallest member) as of `year`. */
function networks(h: History, year: number): Int32Array {
  const P = h.peoples.length
  const lab = new Int32Array(P)
  for (let p = 0; p < P; p++) lab[p] = p
  const find = (x: number): number => { while (lab[x] !== x) x = lab[x]; return x }
  for (let a = 0; a < P; a++) {
    for (let b = a + 1; b < P; b++) {
      const y = h.contactYear[a * P + b]
      if (y < 0 || y > year) continue
      const ra = find(a), rb = find(b)
      if (ra !== rb) { if (ra < rb) lab[rb] = ra; else lab[ra] = rb }
    }
  }
  for (let p = 0; p < P; p++) lab[p] = find(p)
  return lab
}

const tech = (h: History, q: number, p: number, f: number): number => h.technology[(q * h.peoples.length + p) * F + f]
const meanTech = (h: History, q: number, p: number): number => { let t = 0; for (let f = 0; f < F; f++) t += tech(h, q, p, f); return t / F }

export function techStats(h: History): TechStats {
  const P = h.peoples.length
  const median: number[][] = [], spread: number[][] = [], between: number[][] = [], within: number[][] = []
  const nets: number[] = []
  for (const year of TECH_YEARS) {
    if (year > h.years) continue
    const q = Math.floor(year / h.snapshotInterval)
    const lab = networks(h, year)
    const m: number[] = [], sp: number[] = [], bt: number[] = [], wi: number[] = []
    let roots = 0
    for (let p = 0; p < P; p++) if (lab[p] === p) roots++
    nets.push(roots)
    for (let f = 0; f < F; f++) {
      const xs: number[] = []
      const top = new Map<number, number>(), lo = new Map<number, number>()
      for (let p = 0; p < P; p++) {
        const v = tech(h, q, p, f)
        if (!(v > 0)) continue
        xs.push(v)
        const n = lab[p]
        if (!top.has(n) || v > (top.get(n) as number)) top.set(n, v)
        if (!lo.has(n) || v < (lo.get(n) as number)) lo.set(n, v)
      }
      xs.sort((a, b) => a - b)
      m.push(xs.length > 0 ? xs[xs.length >> 1] : 0)
      sp.push(xs.length > 0 ? xs[xs.length - 1] / xs[0] : 0)
      const tops: number[] = []
      let w = 1
      for (let p = 0; p < P; p++) {
        if (lab[p] !== p || !top.has(p)) continue
        tops.push(top.get(p) as number)
        const r = (top.get(p) as number) / (lo.get(p) as number)
        if (r > w) w = r
      }
      bt.push(tops.length >= 2 ? Math.max(...tops) / Math.min(...tops) : NaN)
      wi.push(w)
    }
    median.push(m); spread.push(sp); between.push(bt); within.push(wi)
  }
  // First contacts that joined networks of different cradles.
  const contacts: { year: number; gap: number; ratio: number; half: number }[] = []
  const K = Math.max(...h.peoples.map((x) => x.cradle)) + 1
  const cradleMet = new Array<number>(K).fill(-1)
  const joined: number[] = []
  for (const e of h.events) {
    if (e.type !== EventType.FirstContact) continue
    const pa = h.settlements[e.settlement].people, pb = h.settlements[e.other].people
    const ca = h.peoples[pa].cradle, cb = h.peoples[pb].cradle
    if (ca === cb) continue
    if (cradleMet[ca] < 0) cradleMet[ca] = e.year
    if (cradleMet[cb] < 0) cradleMet[cb] = e.year
    const before = networks(h, e.year - 1)
    if (before[pa] === before[pb]) continue
    const key = e.year * P * P + Math.min(before[pa], before[pb]) * P + Math.max(before[pa], before[pb])
    if (joined.indexOf(key) >= 0) continue // (two pairs of the same two networks met that year)
    joined.push(key)
    const setA: number[] = [], setB: number[] = []
    for (let p = 0; p < P; p++) { if (before[p] === before[pa]) setA.push(p); else if (before[p] === before[pb]) setB.push(p) }
    const best = (set: number[], q: number): number => { let b = 0; for (const p of set) { const v = meanTech(h, q, p); if (v > b) b = v } return b }
    const q0 = Math.floor(e.year / h.snapshotInterval)
    const a0 = best(setA, q0), b0 = best(setB, q0)
    const gap = Math.abs(a0 - b0)
    const lead = a0 >= b0 ? setA : setB, lag = a0 >= b0 ? setB : setA
    let half = -1
    for (let q = q0 + 1; q < h.snapshotCount && gap > 0; q++) {
      if (best(lead, q) - best(lag, q) <= gap / 2) { half = q * h.snapshotInterval - e.year; break }
    }
    contacts.push({ year: e.year, gap, ratio: Math.max(a0, b0) / Math.max(1e-9, Math.min(a0, b0)), half })
  }
  const techAdvances = h.events.filter((e) => e.type === EventType.TechAdvance).length
  return { median, spread, between, within, networks: nets, contacts, cradleMet, techAdvances }
}

export interface ExploreStats {
  count: number
  /** Came home, founded a base, lost. */
  outcomes: number[]
  seaShare: number
  /** Expeditions per era (0-500, 500-1000, 1000-1500, 1500-2000) and the mean technology driving them. */
  perEra: number[]
  techEra: number[]
  senderPop: number[]
  senderWealth: number[]
  senderProsperity: number[]
  /** Pole reached (north, south), -1 if not. */
  poles: number[]
  /** Other discoveries, "kind:year[#feature]". */
  discoveries: string[]
  basesEver: number
  basesAlive: number[]
  basesAbandoned: number
  /** Latitude (degrees) and biome name of each base ever, and whether alive at the end. */
  baseLat: number[]
  baseBiome: string[]
  baseAlive: boolean[]
  /** Pairs of peoples that first met through an expedition or a base: within a cradle, between cradles. */
  viaInner: number
  viaCross: number
  /** Cells nobody knew that an expedition revealed first: land, sea. */
  revealedLand: number
  revealedSea: number
  searches: number
  fruitless: number
}

const BIOME_NAMES = Object.keys(Biome)

export function exploreStats(world: World, h: History, terrain: Terrain, diag?: HistoryDiagnostics): ExploreStats {
  const L = diag?.expeditions
  const S = h.settlements.length
  const N = world.grid.cellCount
  const count = L ? L.year.length : 0
  const outcomes = [0, 0, 0]
  const perEra = [0, 0, 0, 0], techSum = [0, 0, 0, 0]
  let sea = 0
  for (let i = 0; i < count && L; i++) {
    outcomes[L.outcome[i]]++
    sea += L.sea[i]
    const era = Math.min(3, Math.floor(L.year[i] / 500))
    perEra[era]++
    techSum[era] += L.tech[i]
  }
  const poles = [-1, -1]
  const discoveries: string[] = []
  const kinds = diag?.discoveryKind ?? []
  let di = 0
  for (const e of h.events) {
    if (e.type !== EventType.Discovery) continue
    const k = kinds[di++]
    if (k === 0 || k === 1) poles[k] = e.year
    else discoveries.push(`${['', '', 'landmass', 'summit', 'desert'][k]}:${e.year}${e.value >= 0 ? '#' + e.value : ''}`)
  }
  const bases = h.settlements.filter((x) => x.outpost)
  const aliveAt = (year: number): number => {
    if (year > h.years) return 0
    const q = Math.floor(year / h.snapshotInterval)
    let n = 0
    for (const b of bases) if (h.population[q * S + b.id] > 0) n++
    return n
  }
  const P = h.peoples.length
  let viaInner = 0, viaCross = 0
  if (diag?.contactVia) {
    for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) {
      if (diag.contactVia[a * P + b] !== 4) continue
      if (h.peoples[a].cradle === h.peoples[b].cradle) viaInner++
      else viaCross++
    }
  }
  let revealedLand = 0, revealedSea = 0
  if (diag?.revealed) for (let i = 0; i < N; i++) if (diag.revealed[i] >= 0) { if (terrain.sea[i]) revealedSea++; else revealedLand++ }
  return {
    count, outcomes, seaShare: count > 0 ? sea / count : 0, perEra, techEra: techSum.map((t, i) => (perEra[i] > 0 ? t / perEra[i] : 0)),
    senderPop: L ? L.senderPop.slice() : [], senderWealth: L ? L.senderWealth.slice() : [], senderProsperity: L ? L.senderProsperity.slice() : [],
    poles, discoveries,
    basesEver: bases.length, basesAlive: [1000, 1500, 2000].map(aliveAt), basesAbandoned: bases.filter((b) => b.abandonedYear >= 0).length,
    baseLat: bases.map((b) => Math.round((Math.asin(Math.max(-1, Math.min(1, world.grid.positions[b.cell * 3 + 1]))) * 180) / Math.PI)),
    baseBiome: bases.map((b) => BIOME_NAMES[world.biome[b.cell]]),
    baseAlive: bases.map((b) => b.abandonedYear < 0),
    viaInner, viaCross, revealedLand, revealedSea,
    searches: diag?.expSearches ?? 0, fruitless: diag?.expFruitless ?? 0,
  }
}

const pad = (s: string | number, n: number) => String(s).padStart(n)
const med = (xs: number[]): number => { const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length > 0 ? a[a.length >> 1] : NaN }
const pct = (xs: number[], q: number): number => { const a = [...xs].sort((x, y) => x - y); return a.length > 0 ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN }
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '-')

export function formatTechStats(rows: { seed: number; tech: TechStats }[]): string {
  const L: string[] = []
  L.push(`technology per seed at ${TECH_YEARS.join('/')}: networks; per field ${FIELD.join('/')}: median level, most/least advanced people, most/least advanced network (- if one)`)
  for (const r of rows) {
    const t = r.tech
    const cells = TECH_YEARS.map((y, i) => (i < t.median.length ? `y${y} n${t.networks[i]} ` + FIELD.map((_, f) => `${t.median[i][f].toFixed(2)}/${f2(t.spread[i][f])}/${f2(t.between[i][f])}`).join(' ') : '')).join(' | ')
    L.push(`  seed ${pad(r.seed, 6)}: ${cells}`)
    const c = t.contacts.map((x) => `${x.year}: gap ${x.gap.toFixed(2)} (x${x.ratio.toFixed(2)}) half ${x.half < 0 ? 'never' : x.half + 'y'}`).join('; ')
    L.push(`      cradles first met another cradle ${t.cradleMet.map((y) => (y < 0 ? 'never' : y)).join(' ')}; network-joining contacts between cradles: ${c || '-'}; TechAdvance ${t.techAdvances}`)
  }
  L.push('technology summary (median over seeds [min..max]):')
  for (let i = 0; i < TECH_YEARS.length; i++) {
    const ok = rows.filter((r) => i < r.tech.median.length)
    if (ok.length === 0) continue
    const rng = (xs: number[]) => `${f2(med(xs))} [${f2(Math.min(...xs.filter(Number.isFinite)))}..${f2(Math.max(...xs.filter(Number.isFinite)))}]`
    const sep = ok.filter((r) => r.tech.networks[i] >= 2)
    L.push(
      `  y${TECH_YEARS[i]}: seeds with >= 2 networks ${sep.length}/${ok.length}; ` +
        FIELD.map((n, f) => `${n} level ${rng(ok.map((r) => r.tech.median[i][f]))} most/least people ${rng(ok.map((r) => r.tech.spread[i][f]))} between networks ${sep.length > 0 ? rng(sep.map((r) => r.tech.between[i][f])) : '-'} within ${rng(ok.map((r) => r.tech.within[i][f]))}`).join('; '),
    )
  }
  const all = rows.flatMap((r) => r.tech.contacts)
  const halves = all.filter((x) => x.half >= 0).map((x) => x.half)
  L.push(`  network-joining first contacts between cradles: ${all.length}; gap at contact (mean level) median ${f2(med(all.map((x) => x.gap)))} [p90 ${f2(pct(all.map((x) => x.gap), 0.9))}], ratio median ${f2(med(all.map((x) => x.ratio)))} max ${f2(Math.max(0, ...all.map((x) => x.ratio)))}; years to halve the gap median ${med(halves)} [p10 ${pct(halves, 0.1)} .. p90 ${pct(halves, 0.9)}], never ${all.length - halves.length}`)
  const met = rows.flatMap((r) => r.tech.cradleMet)
  L.push(`  cradles by year of first contact with another cradle: before 1000 ${met.filter((y) => y >= 0 && y < 1000).length}, 1000-1600 ${met.filter((y) => y >= 1000 && y <= 1600).length}, after 1600 ${met.filter((y) => y > 1600).length}, never ${met.filter((y) => y < 0).length}; seeds with a cradle uncontacted past 1600 ${rows.filter((r) => r.tech.cradleMet.some((y) => y < 0 || y > 1600)).length}/${rows.length}, to the end ${rows.filter((r) => r.tech.cradleMet.some((y) => y < 0)).length}/${rows.length}; TechAdvance per seed median ${med(rows.map((r) => r.tech.techAdvances))}`)
  return L.join('\n')
}

export function formatExploreStats(rows: { seed: number; explore: ExploreStats }[]): string {
  const L: string[] = []
  L.push('exploration per seed: expeditions (home/base/lost, % by sea), per era 0-500/500-1000/1000-1500/1500-2000 (mean driving tech), poles N/S, other discoveries, bases ever (alive 1000/1500/2000, abandoned), base latitudes and biomes (* alive at end), contacts via expeditions within/between cradles, cells first revealed land/sea, searches (fruitless)')
  for (const r of rows) {
    const x = r.explore
    L.push(
      `  seed ${pad(r.seed, 6)}: ${x.count} (${x.outcomes.join('/')}, ${(100 * x.seaShare).toFixed(0)}% sea), era ${x.perEra.join('/')} (tech ${x.techEra.map((t) => t.toFixed(1)).join('/')}), poles ${x.poles.map((y) => (y < 0 ? '-' : y)).join('/')}, ${x.discoveries.join(' ') || 'no other discoveries'}; ` +
        `bases ${x.basesEver} (${x.basesAlive.join('/')}, ${x.basesAbandoned} abandoned): ${x.baseLat.map((l, i) => `${l}${x.baseBiome[i].slice(0, 4)}${x.baseAlive[i] ? '*' : ''}`).join(' ')}; contacts ${x.viaInner}/${x.viaCross}; revealed ${x.revealedLand}/${x.revealedSea}; searches ${x.searches} (${x.fruitless})`,
    )
  }
  const allPop = rows.flatMap((r) => r.explore.senderPop), allW = rows.flatMap((r) => r.explore.senderWealth), allF = rows.flatMap((r) => r.explore.senderProsperity)
  const bins = [0, 0, 0, 0]
  for (const p of allPop) bins[p < 1000 ? 0 : p < 3000 ? 1 : p < 10000 ? 2 : 3]++
  const counts = rows.map((r) => r.explore.count)
  L.push('exploration summary:')
  L.push(`  expeditions per seed median ${med(counts)} [${Math.min(...counts)}..${Math.max(...counts)}]; outcomes (all seeds) home/base/lost ${[0, 1, 2].map((i) => rows.reduce((a, r) => a + r.explore.outcomes[i], 0)).join('/')}; per era (all) ${[0, 1, 2, 3].map((i) => rows.reduce((a, r) => a + r.explore.perEra[i], 0)).join('/')}, mean driving tech per era ${[0, 1, 2, 3].map((i) => f2(med(rows.filter((r) => r.explore.perEra[i] > 0).map((r) => r.explore.techEra[i])))).join('/')}`)
  L.push(`  senders: population p10/median/p90 ${pct(allPop, 0.1).toFixed(0)}/${pct(allPop, 0.5).toFixed(0)}/${pct(allPop, 0.9).toFixed(0)}, by size <1k/1-3k/3-10k/10k+ ${bins.join('/')}; wealth p10/median/p90 ${pct(allW, 0.1).toFixed(0)}/${pct(allW, 0.5).toFixed(0)}/${pct(allW, 0.9).toFixed(0)}; prosperity p10/median/p90 ${f2(pct(allF, 0.1))}/${f2(pct(allF, 0.5))}/${f2(pct(allF, 0.9))}`)
  const pole1 = rows.map((r) => { const ys = r.explore.poles.filter((y) => y >= 0); return ys.length > 0 ? Math.min(...ys) : -1 })
  L.push(`  first pole reached per seed ${pole1.map((y) => (y < 0 ? '-' : y)).join(' ')}; seeds with a pole by 2000 ${pole1.filter((y) => y >= 0 && y <= 2000).length}/${rows.length}, first pole in 1200-1900 ${pole1.filter((y) => y >= 1200 && y <= 1900).length}/${rows.length}; both poles ${rows.filter((r) => r.explore.poles.every((y) => y >= 0)).length}/${rows.length}`)
  const alive = (i: number) => rows.map((r) => r.explore.basesAlive[i])
  const lat = rows.flatMap((r) => r.explore.baseLat.map((l) => Math.abs(l)))
  const biomes = new Map<string, number>()
  for (const r of rows) for (const b of r.explore.baseBiome) biomes.set(b, (biomes.get(b) ?? 0) + 1)
  L.push(`  bases alive at 1000/1500/2000 per seed median ${med(alive(0))}/${med(alive(1))}/${med(alive(2))} (max ${Math.max(...alive(2))} at 2000); seeds with a base at |lat| >= 55 or on ice/tundra/desert/mountain ever ${rows.filter((r) => r.explore.baseLat.some((l, i) => Math.abs(l) >= 55 || ['Ice', 'Tundra', 'Desert', 'Mountain'].includes(r.explore.baseBiome[i]))).length}/${rows.length}; |latitude| of bases ever p10/median/p90 ${pct(lat, 0.1)}/${pct(lat, 0.5)}/${pct(lat, 0.9)}; by biome ${BIOME_NAMES.filter((b) => biomes.has(b)).map((b) => `${b} ${biomes.get(b)}`).join(', ')}`)
  L.push(`  first contacts through expeditions or bases (all seeds): within cradles ${rows.reduce((a, r) => a + r.explore.viaInner, 0)}, between cradles ${rows.reduce((a, r) => a + r.explore.viaCross, 0)}; cells first revealed by expeditions per seed median land ${med(rows.map((r) => r.explore.revealedLand))} sea ${med(rows.map((r) => r.explore.revealedSea))}; searches per seed median ${med(rows.map((r) => r.explore.searches))} (fruitless ${med(rows.map((r) => r.explore.fruitless))})`)
  return L.join('\n')
}

/** Technology per people per field at 500/1000/1500/2000 with its contact network (letter), as a table. */
export function techTable(h: History): string {
  const P = h.peoples.length
  const L: string[] = [`technology per people (Farm/Sea/Metal/Crafts) and contact network (letter) at ${TECH_YEARS.join('/')}`]
  const head = '  people        cradle ' + TECH_YEARS.map((y) => pad(`year ${y}`, 23)).join(' ')
  L.push(head)
  const labs = TECH_YEARS.map((y) => (y <= h.years ? networks(h, y) : null))
  for (let p = 0; p < P; p++) {
    const cells = TECH_YEARS.map((y, i) => {
      const lab = labs[i]
      if (!lab) return pad('', 23)
      const q = Math.floor(y / h.snapshotInterval)
      const v = [0, 1, 2, 3].map((f) => tech(h, q, p, f))
      if (!(v[0] > 0)) return pad('(died out)', 23)
      return pad(`${String.fromCharCode(97 + lab[p])} ${v.map((x) => x.toFixed(2)).join('/')}`, 23)
    })
    L.push(`  ${h.peoples[p].name.padEnd(12).slice(0, 12)} ${pad(h.peoples[p].cradle, 6)} ${cells.join(' ')}`)
  }
  return L.join('\n')
}

/**
 * Equirectangular ASCII map at `year`: terrain (' ' sea, '_' sea ice, '.' land, '#' land ice, '^' mountain, ':' desert),
 * cells nobody knew that an expedition revealed first ('*' land, '+' sea), land still unknown to everyone ('?'),
 * settlements ('o'), expedition bases alive ('B') and abandoned by then ('b').
 */
export function asciiExploreMap(world: World, h: History, year: number, diag?: HistoryDiagnostics, W = 120, H = 40): string {
  const N = world.grid.cellCount
  const P = world.grid.positions
  const grid: string[] = new Array(W * H).fill(' ')
  const rank = new Float64Array(W * H).fill(-1)
  const at = (i: number): number => {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]
    const lon = Math.atan2(z, x), lat = Math.asin(Math.max(-1, Math.min(1, y)))
    const col = Math.min(W - 1, Math.floor(((lon / Math.PI + 1) / 2) * W))
    const row = Math.min(H - 1, Math.floor((1 - (lat / (Math.PI / 2) + 1) / 2) * H))
    return row * W + col
  }
  const put = (q: number, ch: string, r: number) => { if (r > rank[q]) { rank[q] = r; grid[q] = ch } }
  const PP = h.peoples.length
  for (let i = 0; i < N; i++) {
    const e = world.elevation[i], b = world.biome[i]
    let known = false
    for (let p = 0; p < PP && !known; p++) { const y = h.knownYear[p * N + i]; if (y >= 0 && y <= year) known = true }
    const rev = diag?.revealed ? diag.revealed[i] >= 0 && diag.revealed[i] <= year : false
    if (e < 0) {
      if (rev) put(at(i), '+', 2)
      else put(at(i), b === Biome.Ice ? '_' : ' ', 0)
    } else if (rev) put(at(i), '*', 3)
    else if (!known) put(at(i), '?', 2.5)
    else put(at(i), b === Biome.Ice ? '#' : b === Biome.Mountain ? '^' : b === Biome.Desert ? ':' : '.', 1)
  }
  const S = h.settlements.length
  const snap = Math.floor(year / h.snapshotInterval)
  for (let id = 0; id < S; id++) {
    const st = h.settlements[id]
    if (st.outpost) {
      if (st.foundedYear > year) continue
      put(at(st.cell), h.population[snap * S + id] > 0 ? 'B' : 'b', 1e9)
    } else if (h.population[snap * S + id] >= 300) put(at(st.cell), 'o', 10 + h.population[snap * S + id])
  }
  const lines = [`year ${year} exploration: * land / + sea first revealed by an expedition, ? land unknown to all, B base (b abandoned), o settlement 300+   (. land ^ mountain : desert # ice _ sea ice)`]
  for (let row = 0; row < H; row++) lines.push(grid.slice(row * W, row * W + W).join(''))
  return lines.join('\n')
}
