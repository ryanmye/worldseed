// renaming: tests of places renamed by history (src/sim/history/renaming).

import { describe, expect, it } from 'vitest'
import { EventType, formerNamesAt, NEW_NAME, RenameCause, RenameForm, renamingAt, settlementNameAt } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'
import { letterCount } from '../../names/words.ts'
import { nameWorld } from '../../names/featureNames.ts'
import { runHistory } from '../index.ts'
import { createRenaming, renamingYear } from './system.ts'
import type { RenamingState } from './state.ts'
import { assembleRenamings, weaveEvents } from './assemble.ts'

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
const isOurs = (t: number): boolean => t >= 110 && t <= 119
/** Hash of every History field that exists without the renaming system (every key but `renamings`; events without PlaceRenamed). */
export function hashPreRenaming(hi: History): string {
  const r = hi as unknown as Record<string, unknown>
  let h = 0x811c9dc5
  for (const k of Object.keys(r).filter((x) => x !== 'renamings' && x !== 'ideas' && x !== 'ideaAdoptions').sort()) { // (ideas: later than renaming)
    h = fnvBytes(h, enc.encode(k))
    h = hv(h, k === 'events' ? hi.events.filter((e) => !isOurs(e.type) && (e.type < 120 || e.type > 129)) : r[k])
  }
  return (h >>> 0).toString(16)
}
/** Hash of the renamings and their events. */
function hashRenaming(hi: History): string {
  let h = hv(0x811c9dc5, hi.renamings)
  h = hv(h, hi.events.filter((e) => isOurs(e.type)))
  return (h >>> 0).toString(16)
}

/**
 * Histories without the renaming system: hashPreRenaming of simulateHistory with renaming off equals the history of main
 * c4375b1 with the trade and siting fixes merged, before it (every key of History), recorded there. The system is a pure consequence layer, so with it on the same
 * holds. A later change outside the renaming system must regenerate these.
 */
const GOLDEN: [number, number, number | undefined, Record<string, boolean>, string][] = [
  [42, 2000, undefined, {}, '38f85a6a'],
  [3, 600, undefined, {}, 'f2aa2bcb'],
  [7, 900, undefined, { polities: false, goods: false }, '7ef42c7a'],
  [1, 1500, undefined, { disease: false }, '46618b37'],
  [9, 800, 24, {}, 'c401fefc'],
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
  if (!h) { h = simulateHistory(world(seed), { years }); histories.set(key, h) }
  return h
}

const aliveAt = (h: History, id: number, y: number): boolean => h.settlements[id].foundedYear <= y && (h.settlements[id].abandonedYear < 0 || h.settlements[id].abandonedYear > y)

/** Structural and historical invariants of History.renamings. */
function checkRenamings(h: History): void {
  const R = h.renamings
  const S = h.settlements.length
  const P = h.peoples.length
  const causes = Object.values(RenameCause) as number[], forms = Object.values(RenameForm) as number[]
  for (const a of [R.settlement, R.year, R.cause, R.form, R.polity, R.ruler, R.dynasty, R.faith, R.people, R.previous, R.restored, R.source, R.keptBy]) {
    expect(a.length).toBe(R.count)
    expect(a.byteOffset).toBe(0)
    expect(a.buffer.byteLength).toBe(a.byteLength)
  }
  expect(R.name.length).toBe(R.count)
  const last = new Int32Array(S).fill(-1)
  for (let i = 0; i < R.count; i++) {
    const v = R.settlement[i], y = R.year[i], c = R.cause[i], f = R.form[i]
    const at = `renaming ${i} (${v} in ${y})`
    if (i > 0 && y < R.year[i - 1]) throw new Error(`${at} out of order`)
    if (v < 0 || v >= S || y < 0 || y > h.years) throw new Error(`${at} bad settlement or year`)
    if (causes.indexOf(c) < 0 || forms.indexOf(f) < 0) throw new Error(`${at} cause ${c} form ${f}`)
    // Alive at the year (Distinguished: in its founding year).
    if (!aliveAt(h, v, y)) throw new Error(`${at}: not alive`)
    if (c === RenameCause.Distinguished) { expect(y).toBe(h.settlements[v].foundedYear); expect(f).toBe(RenameForm.Qualified); expect(last[v]).toBe(-1) }
    // The chain of names: previous is the settlement's last renaming.
    expect(R.previous[i]).toBe(last[v])
    const before = last[v] >= 0 ? R.name[last[v]] : h.settlements[v].name
    if (R.name[i].toLowerCase() === before.toLowerCase()) throw new Error(`${at}: ${before} renamed to itself`)
    const n = letterCount(R.name[i])
    if (n < 3 || n > 16) throw new Error(`${at}: name ${R.name[i]}`)
    expect(R.people[i] >= 0 && R.people[i] < P).toBe(true)
    expect(R.keptBy[i] === -1 || (R.keptBy[i] >= 0 && R.keptBy[i] < P && R.keptBy[i] !== R.people[i])).toBe(true)
    // Restored and revived names were borne before (by the town, or by the ruin it stands on).
    if (f === RenameForm.Restored || f === RenameForm.Revived) {
      const r = R.restored[i]
      expect(r).toBeGreaterThanOrEqual(-1)
      const owner = f === RenameForm.Revived ? R.source[i] : v
      const was = r >= 0 ? R.name[r] : h.settlements[owner].name
      expect(R.name[i]).toBe(was)
      if (r >= 0) { expect(R.settlement[r]).toBe(owner); expect(R.year[r]).toBeLessThan(y) }
      if (f === RenameForm.Restored) {
        // (an earlier name of this town: its founding name, or one it bore before the one replaced)
        const seq = [h.settlements[v].name]
        for (let k = 0; k < i; k++) if (R.settlement[k] === v) seq.push(R.name[k])
        expect(seq.slice(0, seq.length - 1).indexOf(R.name[i])).toBeGreaterThanOrEqual(0)
      } else {
        const src = R.source[i]
        const a = h.settlements[src].abandonedYear
        expect(a >= 0 && a < y).toBe(true)
        expect(settlementNameAt(h, src, a)).toBe(R.name[i])
      }
    } else {
      expect(R.restored[i]).toBe(NEW_NAME)
      expect(R.source[i]).toBe(-1)
    }
    if (f === RenameForm.Revived) expect(c).toBe(RenameCause.Revived)
    if (c === RenameCause.Restored) expect(f).toBe(RenameForm.Restored)
    // Polity-driven renamings: the polity existed and its people's tongue made the name; conquerors were foreign to the old name.
    if (c === RenameCause.Conquest || c === RenameCause.Cession || c === RenameCause.Refounded || c === RenameCause.Capital || c === RenameCause.Faith) {
      const p = R.polity[i]
      expect(p >= 0 && p < h.polities.length).toBe(true)
      const pol = h.polities[p]
      expect(pol.foundedYear <= y && (pol.endedYear < 0 || pol.endedYear >= y)).toBe(true)
      const prevPeople = last[v] >= 0 ? R.people[last[v]] : h.settlements[v].people
      if (c !== RenameCause.Capital && c !== RenameCause.Faith) expect(R.people[i]).not.toBe(prevPeople)
      if (c === RenameCause.Capital) {
        let cap = -1
        for (let k = 0; k < pol.capitals.length; k++) if (pol.capitalYears[k] <= y) cap = pol.capitals[k]
        expect(cap).toBe(v)
      }
    }
    if (f === RenameForm.Ruler) { const r = h.rulers[R.ruler[i]]; expect(r.polity).toBe(R.polity[i]); expect(r.acceded <= y && (r.ended < 0 || r.ended >= y)).toBe(true) }
    if (f === RenameForm.House) expect(R.dynasty[i] >= 0 && R.dynasty[i] < h.dynasties.length).toBe(true)
    if (f === RenameForm.Faith) expect(R.faith[i] >= 0 && R.faith[i] < h.faiths.length).toBe(true)
    // The helpers agree with the table.
    if (i + 1 >= R.count || R.settlement[i + 1] !== v || R.year[i + 1] !== y) {
      expect(settlementNameAt(h, v, y)).toBe(R.name[i])
      expect(renamingAt(h, v, y)).toBe(i)
      if (c !== RenameCause.Distinguished) expect(formerNamesAt(h, v, y)[0]).toBe(before)
    }
    if (y > h.settlements[v].foundedYear && (i === 0 || R.year[i - 1] < y || R.settlement[i - 1] !== v)) expect(settlementNameAt(h, v, y - 1)).toBe(before)
    last[v] = i
  }
  // Events: one PlaceRenamed per renaming, in the order of the table, in the year's place among the other events.
  const evs = h.events.filter((e) => isOurs(e.type))
  expect(evs.length).toBe(R.count)
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]
    expect(e.type).toBe(EventType.PlaceRenamed)
    expect([e.year, e.settlement, e.value, e.extra]).toEqual([R.year[i], R.settlement[i], i, R.cause[i]])
    if (R.cause[i] === RenameCause.Revived) expect(e.other).toBe(R.source[i])
  }
  for (let i = 1; i < h.events.length; i++) if (h.events[i].year < h.events[i - 1].year) throw new Error(`events out of order at ${i}`)
  // Names: no two living settlements share one at any year; a name is never borne by two settlements over the run except a revived one.
  const owner = new Map<string, number>() // (lookup only)
  const claim = (name: string, id: number, k: number): void => {
    const lc = name.toLowerCase()
    const o = owner.get(lc)
    if (o !== undefined && o !== id && !(k >= 0 && R.form[k] === RenameForm.Revived && R.source[k] === o)) throw new Error(`${name} borne by ${o} and ${id}`)
    owner.set(lc, id)
  }
  const distinguished = new Uint8Array(S)
  for (let i = 0; i < R.count; i++) if (R.cause[i] === RenameCause.Distinguished) distinguished[R.settlement[i]] = 1
  let k = 0
  const living = new Map<string, number>() // (lookup only)
  const curName = h.settlements.map((s) => s.name)
  const byYear = (y: number): number[] => h.settlements.filter((s) => s.abandonedYear === y).map((s) => s.id)
  let founded = 0
  for (let y = 0; y <= h.years; y++) {
    for (const id of byYear(y)) living.delete(curName[id].toLowerCase())
    for (; founded < S && h.settlements[founded].foundedYear <= y; founded++) {
      const id = founded
      if (!distinguished[id]) claim(h.settlements[id].name, id, -1)
      if (h.settlements[id].abandonedYear === y) continue
      if (!distinguished[id]) { if (living.has(curName[id].toLowerCase())) throw new Error(`${curName[id]} twice in ${y}`); living.set(curName[id].toLowerCase(), id) }
    }
    for (; k < R.count && R.year[k] === y; k++) {
      const v = R.settlement[k]
      claim(R.name[k], v, k)
      if (R.cause[k] !== RenameCause.Distinguished) living.delete(curName[v].toLowerCase())
      curName[v] = R.name[k]
      if (living.has(R.name[k].toLowerCase())) throw new Error(`${R.name[k]} twice in ${y}`)
      living.set(R.name[k].toLowerCase(), v)
    }
  }
}

describe('renaming', () => {
  it('switched off, the history is the one from before the renaming system, with the renamings empty', () => {
    for (const [seed, years, n, opts, hash] of GOLDEN) {
      const w = n ? generateWorld(seed, { subdivisions: n }) : world(seed)
      const h = simulateHistory(w, { years, ...opts, renaming: false, ideas: false }) // (ideas: later, off here too)
      expect(hashPreRenaming(h)).toBe(hash)
      expect(h.renamings.count + h.renamings.name.length + h.renamings.settlement.length).toBe(0)
      expect(h.events.some((e) => isOurs(e.type))).toBe(false)
    }
  }, 300_000)

  it('is a pure consequence layer: switched on, every other field is the same', () => {
    // (ideas off: the golden histories are those before the ideas system)
    expect(hashPreRenaming(simulateHistory(world(42), { years: 2000, ideas: false }))).toBe(GOLDEN[0][4])
    const h = simulateHistory(world(3), { years: 600, ideas: false })
    expect(hashPreRenaming(h)).toBe(GOLDEN[1][4])
    const w = generateWorld(9, { subdivisions: 24 })
    expect(hashPreRenaming(simulateHistory(w, { years: 800, ideas: false }))).toBe(GOLDEN[4][4])
  }, 300_000)

  it('every history satisfies the renaming invariants', () => {
    let total = 0
    const causes = new Set<number>()
    for (const seed of [42, 12345, 4, 9]) {
      const h = history(seed)
      checkRenamings(h)
      total += h.renamings.count
      for (let i = 0; i < h.renamings.count; i++) causes.add(h.renamings.cause[i])
      // Rare and meaningful: a handful to a few dozen per world, mostly places of some size. (ideas: up to 50 since, more wars in some worlds)
      expect(h.renamings.count).toBeGreaterThanOrEqual(3)
      expect(h.renamings.count).toBeLessThanOrEqual(50)
    }
    expect(total).toBeGreaterThanOrEqual(30)
    for (const c of [RenameCause.Conquest, RenameCause.Cession, RenameCause.Capital, RenameCause.Refounded, RenameCause.Restored]) expect(causes.has(c)).toBe(true)
    // Without polities (no conquerors, capitals or faiths of state), only revivals and qualified founding names are possible.
    const np = simulateHistory(world(7), { years: 900, polities: false })
    checkRenamings(np)
    for (let i = 0; i < np.renamings.count; i++) expect([RenameCause.Revived, RenameCause.Distinguished]).toContain(np.renamings.cause[i])
  }, 400_000)

  it('a founding name another town already bears gets a qualified form (Distinguished) from its founding', () => {
    // The decisions of seed 42, replayed beside the run (the system only reads the state), then a later settlement given,
    // as its founding name, the name of a renamed town: the table must qualify it and stay unique.
    const w = world(42)
    let rn: RenamingState | null = null
    const run = runHistory(w, { years: 2000 }, (s) => { if (rn === null) rn = createRenaming(s); renamingYear(s, rn) })
    const h = run.history
    const { naming } = nameWorld(w, h.settlements)
    const base = assembleRenamings(w, rn!, h.settlements, naming, h.features, h.rulers, h.dynasties, h.faiths)
    expect(base.renamings.name).toEqual(h.renamings.name)
    // (a rule that holds on any history: the first renaming that gave a new name, and the first settlement founded after it
    // that is not that town, not a revived ruin and never renamed itself, so the collision is the only change)
    const B = base.renamings
    const k = B.cause.findIndex((c, i) => c !== RenameCause.Distinguished && B.restored[i] === NEW_NAME)
    expect(k).toBeGreaterThanOrEqual(0)
    const y = B.year[k]
    const touched = new Set<number>() // (lookup only)
    for (let i = 0; i < B.count; i++) { touched.add(B.settlement[i]); if (B.source[i] >= 0) touched.add(B.source[i]) }
    const late = h.settlements.find((s) => s.foundedYear > y && !touched.has(s.id))!
    expect(late).toBeDefined()
    const taken = B.name[k]
    const settlements = h.settlements.map((s) => (s.id === late.id ? { ...s, name: taken } : s))
    const res = assembleRenamings(w, rn!, settlements, naming, h.features, h.rulers, h.dynasties, h.faiths)
    const out = res.renamings
    const d = out.cause.findIndex((c) => c === RenameCause.Distinguished)
    expect(d).toBeGreaterThanOrEqual(0)
    expect(out.settlement[d]).toBe(late.id)
    expect(out.year[d]).toBe(late.foundedYear)
    expect(out.form[d]).toBe(RenameForm.Qualified)
    expect(out.name[d].toLowerCase()).not.toBe(taken.toLowerCase())
    expect(out.count).toBe(base.renamings.count + 1)
    // (the other renamings are those of the run, the qualified row woven in)
    for (let i = 0, j = 0; i < out.count; i++) {
      if (i === d) continue
      expect([out.settlement[i], out.year[i], out.name[i], out.cause[i]]).toEqual([B.settlement[j], B.year[j], B.name[j], B.cause[j]])
      j++
    }
    checkRenamings({ ...h, settlements, renamings: out, events: weaveEvents(h.events.filter((e) => !isOurs(e.type)), res.events) })
  }, 300_000)

  it('is deterministic; a longer run repeats a shorter one exactly; a resumed run equals runs from scratch', () => {
    const w = world(42)
    const short = history(42)
    expect(hashRenaming(simulateHistory(w, { years: 2000 }))).toBe(hashRenaming(short))
    const long = simulateHistory(w, { years: 2600 })
    checkRenamings(long)
    const A = short.renamings, B = long.renamings
    expect(A.count).toBeGreaterThan(0)
    expect(B.count).toBeGreaterThanOrEqual(A.count)
    for (let i = 0; i < A.count; i++) {
      for (const key of ['settlement', 'year', 'cause', 'form', 'polity', 'ruler', 'dynasty', 'faith', 'people', 'previous', 'restored', 'source', 'keptBy'] as const) if (A[key][i] !== B[key][i]) throw new Error(`renaming ${i} ${key} differs`)
      expect(B.name[i]).toBe(A.name[i])
    }
    for (let i = A.count; i < B.count; i++) expect(B.year[i]).toBeGreaterThan(2000)
    const evS = short.events.filter((e) => isOurs(e.type)), evL = long.events.filter((e) => isOurs(e.type))
    expect(evL.slice(0, evS.length)).toEqual(evS)
    // Resumable.
    const run = createHistoryRun(w)
    const a1 = run.advanceTo(1000)
    expect(hashRenaming(a1)).toBe(hashRenaming(simulateHistory(w, { years: 1000 })))
    const a = run.advanceTo(2000)
    expect(hashRenaming(a)).toBe(hashRenaming(short))
    expect(hashPreRenaming(a)).toBe(hashPreRenaming(short))
    const b = run.advanceTo(2600)
    expect(hashRenaming(b)).toBe(hashRenaming(long))
    expect(hashRenaming(a)).toBe(hashRenaming(short)) // (untouched by the extension)
    const bufs = (h: History) => [h.renamings.settlement, h.renamings.year, h.renamings.previous].map((x) => x.buffer)
    const seen = new Set(bufs(a))
    for (const x of bufs(b)) expect(seen.has(x)).toBe(false)
  }, 400_000)
})
