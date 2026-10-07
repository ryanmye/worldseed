// landmarks: tests of the great buildings and houses of worship raised by history (src/sim/history/landmarks).

import { describe, expect, it } from 'vitest'
import { EventType, FaithKind, IdeaHow, LANDMARK_FORM_COUNT, LANDMARK_KIND_COUNT, LandmarkForm, LandmarkKind, LandmarkRank, LandmarkState, landmarkNameAt, landmarksAt, landmarkTownAt, ReignEnd, SightKind, settlementNameAt } from '../../../contract.ts'
import type { History, Polity, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'
import { LANDMARK } from './params.ts'
import { EVENT_OF_STATE } from './assemble.ts'
import { capitalCities } from './landmarksStats.ts'

function fnvBytes(h: number, b: Uint8Array): number {
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) }
  return h
}
const enc = new TextEncoder()
/** Hash of any value: typed arrays by bytes, arrays and objects key by key (sorted), numbers as float64. */
function hv(h: number, v: unknown): number {
  if (v === null || v === undefined) return fnvBytes(h, enc.encode(String(v)))
  if (ArrayBuffer.isView(v)) { h = fnvBytes(h, enc.encode(v.constructor.name)); return fnvBytes(h, new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
  if (typeof v === 'number') return fnvBytes(h, new Uint8Array(new Float64Array([v]).buffer))
  if (typeof v === 'string' || typeof v === 'boolean') return fnvBytes(h, enc.encode(typeof v + String(v)))
  if (Array.isArray(v)) { h = fnvBytes(h, enc.encode('[' + v.length)); for (const x of v) h = hv(h, x); return h }
  if (typeof v === 'object') { for (const k of Object.keys(v as object).sort()) { h = fnvBytes(h, enc.encode(k)); h = hv(h, (v as Record<string, unknown>)[k]) } return h }
  return h
}
const isOurs = (t: number): boolean => t >= 140 && t <= 149
/** Hash of every History field that exists without the landmarks system (every key but `landmarks`; events without 140-149). */
export function hashPreLandmarks(hi: History): string {
  const r = hi as unknown as Record<string, unknown>
  let h = 0x811c9dc5
  for (const k of Object.keys(r).filter((x) => x !== 'landmarks').sort()) {
    h = fnvBytes(h, enc.encode(k))
    h = hv(h, k === 'events' ? hi.events.filter((e) => !isOurs(e.type)) : r[k])
  }
  return (h >>> 0).toString(16)
}
/** Hash of the landmarks and their events. */
function hashLandmarks(hi: History): string {
  let h = hv(0x811c9dc5, hi.landmarks)
  h = hv(h, hi.events.filter((e) => isOurs(e.type)))
  return (h >>> 0).toString(16)
}

/**
 * Histories without the landmarks system: hashPreLandmarks of simulateHistory with landmarks off equals the history of main
 * 2ec370c, before it (every key of History; it has no `landmarks` and no events 140-149), recorded there by the same hash.
 * The system is a pure consequence layer, so with it on the same holds. A later change outside the system must regenerate these.
 */
// (Re-recorded with the danger on the way of trade (polity/params.ts WAYRISK): with WAYRISK.on false the tree was checked
// bit-identical to main dcf64f7 on every History field in every off configuration (goods, disease, rulers, religion, tourism,
// renaming, ideas, landmarks, polities); only the entries with polities on changed.)
// (Re-recorded with the danger-trade and landmark fixes (re-paths round danger, the sea risk's scale, escorts for dear goods,
// the minimum forsaken spell, bandits living off the traffic; the landmarks' crowding, rededication on conquest, revival,
// templates and sights): with every new switch off (WAYRISK.reroute false, escortValue 0, minForsaken 0, seaScale false;
// BANDIT.traffic false; LANDMARK.sights false, crowdTo 0, convertConquest 0, revive 0) the tree was checked identical to main
// e06929d on every History field (the additive ones aside: trade.repath*, landmarks.nameTemplate, changeSettlement) in these
// configurations and in 150- and 50-year chunks; entries without polities changed only by the empty trade.repath* fields.)
/** hashPreLandmarks with the landmarks on (their sights draw visitors), per GOLDEN seed. */
const GOLDEN_SIGHTS: Record<number, string> = { 42: '7a1b088f', 3: '487b1e48', 7: '37cdaf60', 1: '796171e', 9: '3b217f94' }
const GOLDEN: [number, number, number | undefined, Record<string, boolean>, string][] = [
  [42, 2000, undefined, {}, '7ee13e52'],
  [3, 600, undefined, {}, '487b1e48'],
  [7, 900, undefined, { polities: false, goods: false }, '37cdaf60'],
  [1, 1500, undefined, { disease: false }, 'dd37f0db'],
  [9, 800, 24, {}, '858ee66'],
]

const worlds = new Map<number, World>()
function world(seed: number): World {
  let w = worlds.get(seed)
  if (!w) { w = generateWorld(seed); worlds.set(seed, w) }
  return w
}
const histories = new Map<string, History>()
function history(seed: number, years = 2000): History {
  const key = seed + ':' + years
  let h = histories.get(key)
  if (!h) { h = simulateHistory(world(seed), { years }); histories.set(key, h); W0.set(h, world(seed)) }
  return h
}

const KD = LandmarkKind, ST = LandmarkState, FM = LandmarkForm
const isWorship = (k: number): boolean => k === KD.GreatTemple || k === KD.Monastery || k === KD.Temple || k === KD.Shrine
const standing = (s: number): boolean => s === ST.InUse || s === ST.Restored || s === ST.Converted
/** The kinds begun at the scans (every LANDMARK.step years); monuments and tombs are begun in the year of their event. */
const SCANNED = [KD.Castle, KD.Palace, KD.GreatTemple, KD.Monastery, KD.MarketHall, KD.Guildhall, KD.Lighthouse, KD.Library, KD.Baths, KD.CouncilHouse, KD.Temple, KD.Shrine]
/** The least population each kind needs at its begun year (the smallest of its paths' minimums). */
const MIN_POP: Record<number, number> = {
  [KD.Castle]: Math.min(LANDMARK.castlePop, LANDMARK.fortPop, LANDMARK.forcePop), [KD.Palace]: LANDMARK.palacePop,
  [KD.GreatTemple]: Math.min(LANDMARK.holyPop, LANDMARK.seatTemplePop, LANDMARK.piousPop), [KD.Monastery]: LANDMARK.monkPop,
  [KD.MarketHall]: Math.min(LANDMARK.martPop, LANDMARK.hubPop), [KD.Guildhall]: LANDMARK.guildPop, [KD.Lighthouse]: LANDMARK.lightPop,
  [KD.Library]: LANDMARK.libraryPop, [KD.Baths]: LANDMARK.bathsPop, [KD.CouncilHouse]: LANDMARK.councilPop, [KD.Temple]: LANDMARK.templePop, [KD.Shrine]: LANDMARK.shrinePop,
  [KD.Monument]: 0, [KD.Mausoleum]: 0,
}
/** Allowed changes of state (from -> to). */
const NEXT: Record<number, number[]> = {
  [ST.Building]: [ST.InUse, ST.Unfinished],
  [ST.InUse]: [ST.Neglected, ST.Ruined, ST.Converted],
  [ST.Restored]: [ST.Neglected, ST.Ruined, ST.Converted],
  [ST.Converted]: [ST.Neglected, ST.Ruined, ST.Converted],
  [ST.Neglected]: [ST.Ruined, ST.Restored],
  [ST.Ruined]: [ST.Restored],
  [ST.Unfinished]: [],
}

const aliveAt = (h: History, id: number, y: number): boolean => h.settlements[id].foundedYear <= y && (h.settlements[id].abandonedYear < 0 || h.settlements[id].abandonedYear > y)
const popAt = (h: History, v: number, y: number): number => h.population[Math.floor(y / h.snapshotInterval) * h.settlements.length + v]
/** Polity p's capital at year y and the year it became so ([-1, -1] outside its life). */
function capitalAt(pol: Polity, y: number): [number, number] {
  if (pol.foundedYear > y || (pol.endedYear >= 0 && pol.endedYear < y)) return [-1, -1]
  let c = -1, since = -1
  for (let k = 0; k < pol.capitals.length; k++) if (pol.capitalYears[k] <= y) { c = pol.capitals[k]; since = pol.capitalYears[k] }
  return [c, since]
}
function owned(a: ArrayBufferView): void {
  expect(a.byteOffset).toBe(0)
  expect(a.buffer.byteLength).toBe(a.byteLength)
}

/** The world each checked history was run on (for the grid). */
const W0 = new Map<History, World>()

/** Landmark sights (SightKind.Landmark): a great landmark's, once, when ruined, unfinished or LANDMARK.sightAge years old, with its fame and name. */
function checkLandmarkSights(h: History): void {
  const L = h.landmarks
  const seen = new Set<number>() // (lookup only)
  for (const x of h.sights) {
    if (x.kind !== SightKind.Landmark) { expect(x.landmark).toBeUndefined(); continue }
    const id = x.landmark!
    expect(id >= 0 && id < L.count).toBe(true)
    expect(seen.has(id)).toBe(false)
    seen.add(id)
    expect(L.rank[id]).toBe(LandmarkRank.Great)
    expect(x.name).toBe(h.settlements[x.settlement].name)
    expect(x.fromYear % 10).toBe(0)
    const town = landmarkTownAt(h, id, x.fromYear - 1)
    expect(x.settlement).toBe(town)
    expect(x.cell).toBe(h.settlements[town].cell)
    // (judged on the landmark as it stood at the end of the year before: tourism runs before the landmarks each year)
    const at = landmarksAt(h, town, x.fromYear - 1).find((y) => y.id === id)!
    const ruin = at.state === ST.Ruined || at.state === ST.Unfinished
    expect(at.state).not.toBe(ST.Building)
    if (!ruin) expect(x.fromYear - L.begunYear[id]).toBeGreaterThanOrEqual(LANDMARK.sightAge)
    expect(x.fame).toBeCloseTo(LANDMARK.sightFame[L.kind[id]] * (ruin ? LANDMARK.sightRuin : 1), 9)
  }
}

/** Structural and historical invariants of History.landmarks and the landmark events. */
function checkLandmarks(h: History): void {
  const L = h.landmarks
  const S = h.settlements.length
  const n = L.count, C = L.changeCount
  for (const a of [L.kind, L.rank, L.form, L.variant, L.settlement, L.cell, L.begunYear, L.completedYear, L.polity, L.ruler, L.dynasty, L.faith, L.people]) { expect(a.length).toBe(n); owned(a) }
  for (const a of [L.changeLandmark, L.changeYear, L.changeState, L.changeFaith, L.changePolity]) { expect(a.length).toBe(C); owned(a) }
  for (const a of [L.faithForm, L.faithVariant]) { expect(a.length).toBe(h.faiths.length); owned(a) }
  expect(L.name.length).toBe(n)
  const iMath = h.ideas.findIndex((d) => d.key === 'mathematics'), iWriting = h.ideas.findIndex((d) => d.key === 'writing')
  const holds = (p: number, i: number, y: number): boolean => {
    let held = false
    const A = h.ideaAdoptions
    for (let k = 0; k < A.count && A.year[k] <= y; k++) if (A.people[k] === p && A.idea[k] === i) held = A.how[k] !== IdeaHow.Lost
    return held
  }
  // Rows.
  const names = new Set<string>() // (lookup only)
  const worshipOf = new Uint8Array(h.faiths.length)
  for (let i = 0; i < n; i++) {
    const k = L.kind[i], v = L.settlement[i], y = L.begunYear[i]
    const at = `landmark ${i} (${L.name[i]}, kind ${k} at ${v} in ${y})`
    if (k >= LANDMARK_KIND_COUNT) throw new Error(`${at}: kind`)
    expect(L.rank[i]).toBe(k === KD.Temple || k === KD.Shrine ? LandmarkRank.Lesser : LandmarkRank.Great)
    if (i > 0 && y < L.begunYear[i - 1]) throw new Error(`${at}: out of order`)
    if (v < 0 || v >= S || y < 0 || y > h.years) throw new Error(`${at}: settlement or year`)
    expect(L.cell[i]).toBe(h.settlements[v].cell)
    if (!aliveAt(h, v, y)) throw new Error(`${at}: not alive`)
    if (h.settlements[v].outpost) throw new Error(`${at}: an outpost`)
    expect(L.variant[i]).toBeLessThan(4)
    expect(L.people[i] >= 0 && L.people[i] < h.peoples.length).toBe(true)
    // Names: non-empty, unique in the world (case-insensitive).
    const nm = L.name[i]
    if (!nm || nm.length > 90 || /undefined|null|NaN|  /.test(nm)) throw new Error(`${at}: name '${nm}'`)
    const lc = nm.toLowerCase()
    if (names.has(lc)) throw new Error(`${at}: name ${nm} twice`)
    names.add(lc)
    // The template: the name with {town} where its town's name of the begun year stood (landmarkNameAt gives the name back then).
    const tp = L.nameTemplate[i]
    expect(typeof tp).toBe('string')
    expect(landmarkNameAt(h, i, y)).toBe(nm)
    if (tp.includes('{town}')) expect(tp.split('{town}').join(settlementNameAt(h, v, y))).toBe(nm)
    else expect(tp).toBe(nm)
    // The builder: a polity alive at the year, its ruler reigning, that ruler's house.
    const p = L.polity[i]
    if (p >= 0) {
      const pol = h.polities[p]
      expect(pol.foundedYear <= y && (pol.endedYear < 0 || pol.endedYear >= y)).toBe(true)
    }
    const r = L.ruler[i]
    if (r >= 0) {
      const ru = h.rulers[r]
      expect(ru.polity).toBe(p)
      if (!(ru.acceded <= y && (ru.ended < 0 || ru.ended >= y))) throw new Error(`${at}: ruler ${r} not reigning`)
      expect(L.dynasty[i]).toBe(ru.dynasty)
    } else expect(L.dynasty[i]).toBe(-1)
    const f = L.faith[i]
    expect(f >= -1 && f < h.faiths.length).toBe(true)
    // Its conditions at the begun year.
    if (SCANNED.includes(k as never)) {
      if (y % LANDMARK.step !== 0) throw new Error(`${at}: not a scan year`)
      const pop = popAt(h, v, y)
      if (pop < MIN_POP[k]) throw new Error(`${at}: ${pop} people`)
    }
    const [cap, since] = p >= 0 ? capitalAt(h.polities[p], y) : [-1, -1]
    if (k === KD.Palace) { expect(cap).toBe(v); expect(y - since).toBeGreaterThanOrEqual(LANDMARK.palaceEmpireYears) }
    if (k === KD.CouncilHouse) { expect(cap).toBe(v); expect(y - since).toBeGreaterThanOrEqual(LANDMARK.councilYears) }
    // (a seat: the capital for some years; else a frontier fortress)
    if (k === KD.Castle && (cap !== v || y - since < Math.min(LANDMARK.castleYears, LANDMARK.forceYears))) expect(popAt(h, v, y)).toBeGreaterThanOrEqual(LANDMARK.fortPop)
    if (k === KD.Monument) {
      expect(cap).toBe(v)
      expect(h.events.some((e) => e.year === y && e.type === EventType.PeaceMade)).toBe(true)
    }
    if (k === KD.Mausoleum) {
      expect(cap).toBe(v)
      const ru = h.rulers[r]
      expect(ru.ended).toBe(y)
      expect(ru.died).toBe(y)
      expect([ReignEnd.Overthrown]).not.toContain(ru.end)
      expect(h.events.some((e) => e.year === y && e.type === EventType.ReignEnded && e.value === r && e.settlement === v)).toBe(true)
    }
    if (k === KD.Guildhall) expect(h.events.some((e) => e.type === EventType.TraditionRenowned && e.settlement === v && e.year <= y && y - e.year <= LANDMARK.guildWindow)).toBe(true)
    if (k === KD.Library && h.ideas.length > 0) expect(holds(L.people[i], iWriting, y)).toBe(true)
    if (k === KD.Temple || k === KD.Shrine || k === KD.Monastery) {
      // (raised for the town's majority faith at the year, from the faith snapshot taken that year)
      expect(f).toBe(h.faith[Math.floor(y / h.snapshotInterval) * S + v])
      if (k === KD.Shrine) expect(h.faiths[f].kind).toBe(FaithKind.Traditional)
    }
    // Forms: a house of worship's is its faith's tradition (a great temple's early form before the mathematics; shrines are stone circles).
    if (isWorship(k)) {
      expect(f).toBeGreaterThanOrEqual(0)
      const g = h.faiths[f]
      expect(g.foundedYear <= y && (g.endedYear < 0 || g.endedYear >= y)).toBe(true)
      worshipOf[f] = 1
      const tf = L.faithForm[f]
      expect(tf).toBeLessThan(LANDMARK_FORM_COUNT)
      expect(L.variant[i]).toBe(L.faithVariant[f])
      if (k === KD.Shrine) expect(L.form[i]).toBe(FM.Circle)
      else if (k === KD.Monastery || k === KD.Temple) expect(L.form[i]).toBe(tf)
      else {
        const vaulted = tf === FM.Steepled || tf === FM.Domed || tf === FM.Pagoda
        const early = L.form[i] !== tf
        if (early) { expect(vaulted).toBe(true); expect([FM.Ziggurat, FM.Columned]).toContain(L.form[i]) }
        if (vaulted && h.ideas.length > 0 && iMath >= 0) expect(early).toBe(!holds(L.people[i], iMath, y))
      }
    } else expect(L.form[i]).toBe(0)
  }
  // Changes: chronological; each landmark's first is Building at its begun year; allowed transitions; completedYear.
  const state = new Int32Array(n).fill(-1)
  const cur = new Int32Array(n).fill(-1)
  const done = new Int32Array(n).fill(-1)
  const townOf = Int32Array.from(L.settlement)
  for (let i = 0; i < n; i++) cur[i] = L.faith[i]
  for (let c = 0; c < C; c++) {
    const id = L.changeLandmark[c], y = L.changeYear[c], st = L.changeState[c]
    const at = `change ${c} (landmark ${id}, state ${st} in ${y})`
    if (id < 0 || id >= n) throw new Error(`${at}: landmark`)
    if (c > 0 && y < L.changeYear[c - 1]) throw new Error(`${at}: out of order`)
    if (y > h.years || y < L.begunYear[id]) throw new Error(`${at}: year`)
    const prev = state[id]
    if (prev < 0) { expect(st).toBe(ST.Building); expect(y).toBe(L.begunYear[id]) }
    else if (!NEXT[prev].includes(st)) throw new Error(`${at}: ${prev} -> ${st}`)
    if (st === ST.InUse) done[id] = y
    if (st === ST.Converted) {
      expect(isWorship(L.kind[id])).toBe(true)
      const f = L.changeFaith[c]
      expect(f >= 0 && f < h.faiths.length).toBe(true)
      expect(f).not.toBe(cur[id])
      cur[id] = f
      worshipOf[f] = 1
    } else if (st === ST.Restored && isWorship(L.kind[id])) {
      expect(L.changeFaith[c] >= 0 && L.changeFaith[c] < h.faiths.length).toBe(true)
      cur[id] = L.changeFaith[c]
      worshipOf[L.changeFaith[c]] = 1
    } else expect(L.changeFaith[c]).toBe(-1)
    expect(L.changePolity[c] >= -1 && L.changePolity[c] < h.polities.length).toBe(true)
    // Its town: the one it was begun in, until a town founded on or beside the ruins of the abandoned one restores it and takes it over.
    const town = L.changeSettlement[c], was = townOf[id]
    if (town !== was) {
      expect(st).toBe(ST.Restored)
      expect(prev).toBe(ST.Ruined)
      const old = h.settlements[was], heir = h.settlements[town]
      expect(old.abandonedYear >= 0 && old.abandonedYear <= y).toBe(true)
      expect(heir.foundedYear).toBeGreaterThanOrEqual(old.abandonedYear)
      expect(heir.foundedYear + LANDMARK.reviveYears).toBeLessThanOrEqual(y)
      expect(aliveAt(h, town, y)).toBe(true)
      const wd = W0.get(h)
      if (wd) {
        const { neighborOffsets: off, neighbors: nb } = wd.grid
        let near = heir.cell === old.cell
        for (let k = off[old.cell]; k < off[old.cell + 1]; k++) if (nb[k] === heir.cell) near = true
        expect(near).toBe(true)
      }
      townOf[id] = town
    }
    state[id] = st
  }
  for (let i = 0; i < n; i++) {
    expect(state[i]).toBeGreaterThanOrEqual(0)
    expect(L.completedYear[i]).toBe(done[i])
    if (done[i] >= 0) expect(done[i] - L.begunYear[i]).toBeGreaterThanOrEqual(LANDMARK.buildMin[L.kind[i]])
  }
  // Abandoned towns: none of their landmarks stands or is still building after the abandonment.
  for (let i = 0; i < n; i++) {
    const t = landmarkTownAt(h, i, h.years)
    const a = h.settlements[t].abandonedYear
    if (a < 0) continue
    const after = landmarksAt(h, t, h.years).find((x) => x.id === i)!
    expect(standing(after.state) || after.state === ST.Building || after.state === ST.Neglected).toBe(false)
  }
  // Events: one per change of a great landmark, none for the lesser, in order, with the right fields.
  const evs = h.events.filter((e) => isOurs(e.type))
  let j = 0
  for (let c = 0; c < C; c++) {
    const id = L.changeLandmark[c]
    if (L.rank[id] !== LandmarkRank.Great) continue
    const e = evs[j++]
    if (!e) throw new Error(`no event for change ${c}`)
    expect([e.year, e.type, e.settlement, e.value, e.extra]).toEqual([L.changeYear[c], EVENT_OF_STATE[L.changeState[c]], L.changeSettlement[c], id, L.kind[id]])
    const st = L.changeState[c]
    if (st === ST.Unfinished || st === ST.Neglected) expect(e.other).toBe(-1)
    if (st === ST.Building || st === ST.InUse) {
      const p = L.polity[id]
      if (e.other >= 0) expect(capitalAt(h.polities[p], e.year)[0]).toBe(e.other)
    }
    if ((st === ST.Restored || st === ST.Converted) && e.other >= 0) expect(capitalAt(h.polities[L.changePolity[c]], e.year)[0]).toBe(e.other)
    if (st === ST.Ruined && e.other >= 0) {
      expect(e.other).toBeLessThan(S)
      expect(h.events.some((x) => x.year === e.year && x.type === EventType.Sacked && x.settlement === e.settlement && x.other === e.other)).toBe(true)
    }
  }
  expect(j).toBe(evs.length)
  expect(evs.every((e) => e.type >= EventType.LandmarkBegun && e.type <= EventType.LandmarkConverted)).toBe(true)
  for (let i = 1; i < h.events.length; i++) if (h.events[i].year < h.events[i - 1].year) throw new Error(`events out of order at ${i}`)
  // landmarksAt agrees with the table (at each change's year, for its town).
  for (let c = 0; c < C; c += 3) {
    const v = L.changeSettlement[c], y = L.changeYear[c]
    const got = landmarksAt(h, v, y)
    const want: { id: number; state: number; since: number; faith: number }[] = []
    for (let i = 0; i < n && L.begunYear[i] <= y; i++) {
      let town = L.settlement[i]
      for (let k = 0; k < C && L.changeYear[k] <= y; k++) if (L.changeLandmark[k] === i) town = L.changeSettlement[k]
      if (town !== v) continue
      let s = ST.Building as number, since = L.begunYear[i], f = L.faith[i]
      for (let k = 0; k < C && L.changeYear[k] <= y; k++) if (L.changeLandmark[k] === i) { s = L.changeState[k]; since = L.changeYear[k]; if (L.changeFaith[k] >= 0) f = L.changeFaith[k] }
      want.push({ id: i, state: s, since, faith: f })
    }
    expect(got.map((x) => ({ id: x.id, state: x.state, since: x.since, faith: x.faith }))).toEqual(want)
    for (const x of got) { expect(x.kind).toBe(L.kind[x.id]); expect(x.rank).toBe(L.rank[x.id]); expect(x.form).toBe(L.form[x.id]) }
  }
  // Building traditions: set for every faith that has a house of worship; a schism keeps its parent's form, with another variant.
  for (let f = 0; f < h.faiths.length; f++) {
    const tf = L.faithForm[f]
    expect(tf < LANDMARK_FORM_COUNT || tf === 255).toBe(true)
    if (worshipOf[f]) expect(tf).toBeLessThan(LANDMARK_FORM_COUNT)
    const par = h.faiths[f].parent
    if (tf !== 255 && par >= 0) { expect(tf).toBe(L.faithForm[par]); expect(L.faithVariant[f]).not.toBe(L.faithVariant[par]) }
    // (a universal faith founded anew builds no ziggurats or stone circles: the folk traditions' forms)
    if (tf !== 255 && par < 0 && h.faiths[f].kind === FaithKind.Universal) expect([FM.Ziggurat, FM.Circle]).not.toContain(tf)
  }
  // The guarantee: every city of 10,000 people that has been a capital for 30 years has a castle or palace (begun by then).
  for (const v of capitalCities(h, 30)) {
    let first = -1
    for (const pol of h.polities) {
      const end = pol.endedYear >= 0 ? pol.endedYear - 1 : h.years
      for (let k = 0; k < pol.capitals.length; k++) {
        if (pol.capitals[k] !== v) continue
        const to = k + 1 < pol.capitals.length ? pol.capitalYears[k + 1] - 1 : end
        for (let q = Math.ceil((pol.capitalYears[k] + 30) / h.snapshotInterval); q * h.snapshotInterval <= to && q < h.snapshotCount; q++) {
          if (h.population[q * S + v] >= 10000) { const y = q * h.snapshotInterval; if (first < 0 || y < first) first = y; break }
        }
      }
    }
    let ok = false
    for (let i = 0; i < n; i++) if (L.settlement[i] === v && (L.kind[i] === KD.Castle || L.kind[i] === KD.Palace) && L.begunYear[i] <= first) ok = true
    if (!ok) throw new Error(`capital city ${v} (${h.settlements[v].name}, 10,000 people in ${first}) has no castle or palace`)
  }
}

describe('landmarks', () => {
  it('switched off, the history is the one from before the landmarks system, with the landmarks empty', () => {
    for (const [seed, years, n, opts, hash] of GOLDEN) {
      const w = n ? generateWorld(seed, { subdivisions: n }) : world(seed)
      const h = simulateHistory(w, { years, ...opts, landmarks: false })
      expect(hashPreLandmarks(h)).toBe(hash)
      const L = h.landmarks
      expect(L.count + L.changeCount + L.name.length + L.kind.length + L.changeLandmark.length + L.faithForm.length).toBe(0)
      expect(h.events.some((e) => isOurs(e.type))).toBe(false)
    }
  }, 400_000)

  it('is a pure consequence layer but for the sights: switched on without them (or without tourism), every other field is the same', () => {
    for (const [seed, years, n, opts, hash] of GOLDEN) {
      const w = n ? generateWorld(seed, { subdivisions: n }) : world(seed)
      // (the landmarks are sights of the tourism system, the one place they act on the rest: LANDMARK.sights; without it they are pure)
      LANDMARK.sights = false
      try { expect(hashPreLandmarks(simulateHistory(w, { years, ...opts }))).toBe(hash) } finally { LANDMARK.sights = true }
      const h = seed === 42 && years === 2000 && !n ? history(42) : simulateHistory(w, { years, ...opts })
      W0.set(h, w)
      checkLandmarks(h)
      checkLandmarkSights(h)
      expect(hashPreLandmarks(h)).toBe(GOLDEN_SIGHTS[seed])
    }
    // Without tourism (no sights), on or off, every other field is the same.
    const a = simulateHistory(world(3), { years: 600, tourism: false }), b = simulateHistory(world(3), { years: 600, tourism: false, landmarks: false })
    expect(hashPreLandmarks(a)).toBe(hashPreLandmarks(b))
  }, 400_000)

  it('every history satisfies the landmark invariants; counts in range; the capital cities have their castles', () => {
    const kinds = new Set<number>(), states = new Set<number>(), forms = new Set<number>()
    for (const [seed, years] of [[42, 2000], [12345, 2000], [4, 2000], [9, 2000], [3, 3000]]) {
      const h = history(seed, years)
      checkLandmarks(h)
      checkLandmarkSights(h)
      const L = h.landmarks
      let great = 0
      for (let i = 0; i < L.count; i++) { kinds.add(L.kind[i]); forms.add(L.form[i]); if (L.rank[i] === LandmarkRank.Great) great++ }
      for (let c = 0; c < L.changeCount; c++) states.add(L.changeState[c])
      const lesser = L.count - great
      // A few dozen great works per world (big crowded worlds more: each capital city has its castle), a town's houses of worship.
      // (seed 12345: since the oceans, oceans.ts, its second continent lies across 9 cells of open ocean and is met only after
      // 2000: a quieter world of fewer states, 28 not 49, and 11 great works)
      expect(great).toBeGreaterThanOrEqual(seed === 12345 ? 10 : 12)
      expect(great).toBeLessThanOrEqual(years > 2000 ? 120 : 80)
      expect(lesser).toBeGreaterThanOrEqual(40)
      expect(lesser).toBeLessThanOrEqual(years > 2000 ? 450 : 350)
      // Most towns have none; a big city has several.
      const S = h.settlements.length
      const per = new Int32Array(S)
      for (let i = 0; i < L.count; i++) if (L.rank[i] === LandmarkRank.Great) per[L.settlement[i]]++
      let towns = 0, withGreat = 0
      for (let v = 0; v < S; v++) {
        let peak = 0
        for (let q = 0; q < h.snapshotCount; q++) if (h.population[q * S + v] > peak) peak = h.population[q * S + v]
        if (peak >= 3000) { towns++; if (per[v] > 0) withGreat++ }
        expect(per[v]).toBeLessThanOrEqual(10)
      }
      expect(withGreat).toBeLessThan(towns / 2)
    }
    for (const k of [KD.Castle, KD.Palace, KD.GreatTemple, KD.MarketHall, KD.Temple, KD.Shrine]) expect(kinds.has(k)).toBe(true)
    for (const s of [ST.Building, ST.InUse, ST.Neglected, ST.Ruined, ST.Converted]) expect(states.has(s)).toBe(true)
    expect(forms.has(FM.Circle)).toBe(true)
    // Without polities: no castles, palaces, seats or royal works; temples and shrines still.
    const np = simulateHistory(world(7), { years: 900, polities: false })
    checkLandmarks(np)
    for (let i = 0; i < np.landmarks.count; i++) expect([KD.Castle, KD.Palace, KD.CouncilHouse, KD.Monument, KD.Mausoleum]).not.toContain(np.landmarks.kind[i])
    // Without religion: no houses of worship.
    const nr = simulateHistory(world(3), { years: 900, religion: false })
    checkLandmarks(nr)
    for (let i = 0; i < nr.landmarks.count; i++) expect(isWorship(nr.landmarks.kind[i])).toBe(false)
  }, 400_000)

  it('is deterministic; a longer run repeats a shorter one exactly; a resumed run equals runs from scratch, owning its arrays', () => {
    const w = world(42)
    const short = history(42)
    expect(hashLandmarks(simulateHistory(generateWorld(42), { years: 2000 }))).toBe(hashLandmarks(short))
    const long = simulateHistory(w, { years: 2600 })
    checkLandmarks(long)
    const A = short.landmarks, B = long.landmarks
    expect(A.count).toBeGreaterThan(0)
    expect(B.count).toBeGreaterThanOrEqual(A.count)
    for (let i = 0; i < A.count; i++) {
      for (const key of ['kind', 'rank', 'form', 'variant', 'settlement', 'cell', 'begunYear', 'polity', 'ruler', 'dynasty', 'faith', 'people'] as const) if (A[key][i] !== B[key][i]) throw new Error(`landmark ${i} ${key} differs`)
      expect(B.name[i]).toBe(A.name[i])
      expect(B.nameTemplate[i]).toBe(A.nameTemplate[i])
      if (A.completedYear[i] >= 0) expect(B.completedYear[i]).toBe(A.completedYear[i])
      else if (B.completedYear[i] >= 0) expect(B.completedYear[i]).toBeGreaterThan(2000)
    }
    for (let i = A.count; i < B.count; i++) expect(B.begunYear[i]).toBeGreaterThan(2000)
    expect(B.changeCount).toBeGreaterThanOrEqual(A.changeCount)
    for (const key of ['changeLandmark', 'changeYear', 'changeState', 'changeFaith', 'changePolity', 'changeSettlement'] as const) expect(Array.from(B[key].slice(0, A.changeCount))).toEqual(Array.from(A[key]))
    for (let c = A.changeCount; c < B.changeCount; c++) expect(B.changeYear[c]).toBeGreaterThan(2000)
    expect(Array.from(B.faithForm.slice(0, A.faithForm.length))).toEqual(Array.from(A.faithForm))
    expect(Array.from(B.faithVariant.slice(0, A.faithVariant.length))).toEqual(Array.from(A.faithVariant))
    const evS = short.events.filter((e) => isOurs(e.type)), evL = long.events.filter((e) => isOurs(e.type))
    expect(evL.slice(0, evS.length)).toEqual(evS)
    // Resumable.
    const run = createHistoryRun(w)
    const a1 = run.advanceTo(1000)
    expect(hashLandmarks(a1)).toBe(hashLandmarks(simulateHistory(w, { years: 1000 })))
    const a = run.advanceTo(2000)
    expect(hashLandmarks(a)).toBe(hashLandmarks(short))
    expect(hashPreLandmarks(a)).toBe(hashPreLandmarks(short))
    const b = run.advanceTo(2600)
    expect(hashLandmarks(b)).toBe(hashLandmarks(long))
    expect(hashLandmarks(a)).toBe(hashLandmarks(short)) // (untouched by the extension)
    const bufs = (h: History) => [h.landmarks.kind, h.landmarks.settlement, h.landmarks.begunYear, h.landmarks.completedYear, h.landmarks.changeLandmark, h.landmarks.changeYear, h.landmarks.faithForm].map((x) => x.buffer)
    const seen = new Set(bufs(a)) // (lookup only)
    for (const x of bufs(b)) expect(seen.has(x)).toBe(false)
    expect(b.landmarks.name).not.toBe(a.landmarks.name)
    // The worker's way (src/worker.ts): 150-year chunks; the same table as one run.
    const chunked = createHistoryRun(w)
    let c = chunked.advanceTo(150)
    for (let y = 300; y <= 2000; y += 150) c = chunked.advanceTo(y)
    c = chunked.advanceTo(2000)
    expect(hashLandmarks(c)).toBe(hashLandmarks(short))
    expect(hashPreLandmarks(c)).toBe(hashPreLandmarks(short))
  }, 400_000)
})
