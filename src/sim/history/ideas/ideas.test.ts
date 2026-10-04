// ideas: tests of the ideas system (src/sim/history/ideas): the off switch, the invariants of conception and adoption, prefix
// stability and the resumable run, and the technology caps.

import { describe, expect, it } from 'vitest'
import { EventType, IdeaHow, ideasHeldAt } from '../../../contract.ts'
import type { History, World } from '../../../contract.ts'
import { createHistoryRun, generateWorld, simulateHistory } from '../../index.ts'
import { runHistory } from '../index.ts'
import { TQ } from '../species.ts'
import { IDEA, IDEA_DEFS, TQ_BREEDING, TQ_HEAVY_PLOUGH, TQ_ROTATION, TQ_TERRACE } from './params.ts'

const IDEAS_KEYS = new Set(['ideas', 'ideaAdoptions'])
const isOurs = (t: number): boolean => t >= 120 && t <= 129

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
/** Hash of every History field that exists without the ideas system (every key but the ideas fields; events without 120-129). */
export function hashPreIdeas(hi: History): string {
  const r = hi as unknown as Record<string, unknown>
  let h = 0x811c9dc5
  for (const k of Object.keys(r).filter((x) => !IDEAS_KEYS.has(x)).sort()) {
    h = fnvBytes(h, enc.encode(k))
    h = hv(h, k === 'events' ? hi.events.filter((e) => !isOurs(e.type)) : r[k])
  }
  return (h >>> 0).toString(16)
}
/** Hash of the ideas fields and their events. */
function hashIdeas(hi: History): string {
  let h = hv(0x811c9dc5, hi.ideas)
  h = hv(h, hi.ideaAdoptions)
  h = hv(h, hi.events.filter((e) => isOurs(e.type)))
  return (h >>> 0).toString(16)
}

/**
 * Histories without the ideas system: hashPreIdeas of simulateHistory with ideas off equals the history of main 1375ac5 before it
 * (every key of History there, hashed the same way; recorded on 1375ac5 and checked against this tree with ideas off). A later
 * change outside the ideas system must regenerate these.
 */
const GOLDEN: [number, number, number | undefined, Record<string, boolean>, string][] = [
  [42, 2000, undefined, {}, '4f48a79c'],
  [3, 600, undefined, {}, '998ce24b'],
  [7, 900, undefined, { polities: false, goods: false }, '985e33d6'],
  [1, 1500, undefined, { disease: false }, 'd2cdb4b9'],
  [9, 800, 24, {}, 'e24efe77'],
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

/** Whether people p has a living settlement at year y. */
function aliveAt(h: History, p: number, y: number): boolean {
  for (const s of h.settlements) if (s.people === p && !s.outpost && s.foundedYear <= y && (s.abandonedYear < 0 || s.abandonedYear > y)) return true
  return false
}

/** Structural invariants of the ideas fields. */
function checkIdeas(h: History): void {
  const P = h.peoples.length, I = h.ideas.length, S = h.settlements.length
  const A = h.ideaAdoptions
  expect(I).toBe(IDEA_DEFS.length)
  h.ideas.forEach((d, i) => {
    expect(d.id).toBe(i)
    expect(d.key).toBe(IDEA_DEFS[i].key)
    for (const q of d.prerequisites) expect(q).toBeLessThan(i)
    expect(d.ease > 0 && d.ease <= 1).toBe(true)
  })
  for (const a of [A.idea, A.people, A.year, A.how, A.from, A.via, A.source]) { expect(a.length).toBe(A.count); expect(a.byteOffset).toBe(0); expect(a.buffer.byteLength).toBe(a.byteLength) }
  // Replay: held per people and idea, checked row by row.
  const held = new Uint8Array(P * I)
  const firstInv = new Int32Array(I).fill(-1)
  const origins = new Int32Array(I)
  const evKey = new Map<string, number>() // (lookup only)
  for (const e of h.events) {
    if (!isOurs(e.type)) continue
    expect(e.type).toBeLessThanOrEqual(EventType.IdeaResisted)
    const key = `${e.year}:${e.type}:${e.value}:${h.settlements[e.settlement].people}`
    evKey.set(key, (evKey.get(key) ?? 0) + 1)
  }
  for (let k = 0; k < A.count; k++) {
    const i = A.idea[k], q = A.people[k], y = A.year[k], how = A.how[k], from = A.from[k]
    if (k > 0) expect(y).toBeGreaterThanOrEqual(A.year[k - 1])
    expect(i < I && q < P && how <= IdeaHow.Lost && y >= 0 && y <= h.years).toBe(true)
    expect(A.via[k] >= 0 && A.via[k] < S).toBe(true)
    if (how === IdeaHow.Lost) {
      expect(held[q * I + i]).toBe(1)
      held[q * I + i] = 0
      expect(evKey.get(`${y}:${EventType.IdeaLost}:${i}:${q}`) ?? 0).toBeGreaterThan(0)
      continue
    }
    expect(held[q * I + i]).toBe(0)
    // Prerequisites held before adoption.
    for (const pre of h.ideas[i].prerequisites) if (!held[q * I + pre]) throw new Error(`idea ${h.ideas[i].key} taken up by ${q} in ${y} without ${h.ideas[pre].key}`)
    if (how === IdeaHow.Invented) {
      expect(from).toBe(-1)
      // One origin per independent conception: no living holder it had met.
      for (let p = 0; p < P; p++) {
        if (p === q || !held[p * I + i]) continue
        const c = h.contactYear[q * P + p]
        if (c >= 0 && c <= y && aliveAt(h, p, y)) throw new Error(`idea ${h.ideas[i].key} conceived by ${q} in ${y} though it had met holder ${p} (${c})`)
      }
      if (firstInv[i] < 0) firstInv[i] = y
      origins[i]++
      expect(h.settlements[A.via[k]].people).toBe(q)
      expect(evKey.get(`${y}:${EventType.IdeaConceived}:${i}:${q}`) ?? 0).toBeGreaterThan(0)
    } else {
      // The source held the idea, and the adopter had met it by then.
      expect(from >= 0 && from < P && from !== q).toBe(true)
      if (!held[from * I + i]) throw new Error(`idea ${h.ideas[i].key} came to ${q} in ${y} from ${from}, which did not hold it`)
      const c = h.contactYear[q * P + from]
      if (!(c >= 0 && c <= y)) throw new Error(`idea ${h.ideas[i].key} came to ${q} in ${y} from ${from}, not met (${c})`)
      if (A.source[k] >= 0) expect(h.settlements[A.source[k]].people).toBe(from)
      expect(h.settlements[A.via[k]].people).toBe(q)
      expect(evKey.get(`${y}:${EventType.IdeaAdopted}:${i}:${h.settlements[A.via[k]].people}`) ?? 0).toBeGreaterThan(0)
    }
    held[q * I + i] = 1
  }
  h.ideas.forEach((d, i) => { expect(d.firstYear).toBe(firstInv[i]); expect(d.origins).toBe(origins[i]) })
  // The species techniques that are ideas: held by exactly the peoples that hold the technique (by the end).
  const T = h.techniques.length
  h.ideas.forEach((d, i) => {
    if (d.technique < 0) return
    for (let p = 0; p < P; p++) expect(held[p * I + i] === 1).toBe(h.techniqueYear[p * T + d.technique] >= 0)
  })
  // ideasHeldAt agrees with the replay at the end.
  for (let p = 0; p < P; p++) {
    const mine = ideasHeldAt(h, p, h.years)
    const exp: number[] = []
    for (let i = 0; i < I; i++) if (held[p * I + i]) exp.push(i)
    expect(mine).toEqual(exp)
  }
  // Resisted ideas name a living people's settlement.
  for (const e of h.events) if (e.type === EventType.IdeaResisted) { expect(e.value >= 0 && e.value < I).toBe(true); expect((e.extra ?? -1) >= 0 && (e.extra ?? -1) <= 2).toBe(true) }
}

describe('ideas', () => {
  it('switched off, the history is the one from before the ideas system, with the ideas fields empty', () => {
    for (const [seed, years, n, opts, hash] of GOLDEN) {
      const w = n ? generateWorld(seed, { subdivisions: n }) : world(seed)
      const h = simulateHistory(w, { years, ...opts, ideas: false })
      expect(hashPreIdeas(h)).toBe(hash)
      expect(h.ideas.length + h.ideaAdoptions.count + h.ideaAdoptions.idea.length).toBe(0)
      expect(h.events.some((e) => isOurs(e.type))).toBe(false)
    }
  }, 400_000)

  it('the catalogue: prerequisites first, the mirrored techniques are the species system\'s', () => {
    expect(TQ_ROTATION).toBe(TQ.rotation)
    expect(TQ_HEAVY_PLOUGH).toBe(TQ.heavyPlough)
    expect(TQ_TERRACE).toBe(TQ.terrace)
    expect(TQ_BREEDING).toBe(TQ.breeding)
    expect(IDEA_DEFS.length).toBeGreaterThanOrEqual(30)
    expect(IDEA_DEFS.length).toBeLessThanOrEqual(45)
    const keys = new Set<string>()
    IDEA_DEFS.forEach((d, i) => {
      expect(keys.has(d.key)).toBe(false)
      for (const k of d.pre) expect(IDEA_DEFS.findIndex((x) => x.key === k)).toBeLessThan(i)
      keys.add(d.key)
      if (d.technique >= 0) { expect(d.pre.length).toBe(0); expect(d.chance).toBe(0) }
    })
  })

  it('every history satisfies the ideas invariants; most peoples originate few of the ideas they hold', () => {
    for (const seed of [42, 7]) {
      const h = history(seed)
      checkIdeas(h)
      const P = h.peoples.length, A = h.ideaAdoptions
      // Ideas are conceived, travel, and most of a people's ideas came from others.
      expect(h.ideas.filter((d) => d.firstYear >= 0).length).toBeGreaterThan(25)
      let own = 0, got = 0
      for (let k = 0; k < A.count; k++) { if (A.how[k] === IdeaHow.Invented) own++; else if (A.how[k] !== IdeaHow.Lost) got++ }
      expect(got).toBeGreaterThan(2 * own)
      expect(got).toBeGreaterThan(P * 10)
    }
    checkIdeas(simulateHistory(generateWorld(9, { subdivisions: 24 }), { years: 1200 }))
  }, 400_000)

  it('is deterministic; a longer run repeats a shorter one exactly; a resumed run equals runs from scratch, owning its arrays', () => {
    const w = world(3)
    const a = simulateHistory(w, { years: 1500 })
    const b = simulateHistory(generateWorld(3), { years: 1500 })
    expect(hashIdeas(b)).toBe(hashIdeas(a))
    expect(hashPreIdeas(b)).toBe(hashPreIdeas(a))
    const long = simulateHistory(w, { years: 2100 })
    const A = a.ideaAdoptions, B = long.ideaAdoptions
    expect(B.count).toBeGreaterThan(A.count)
    for (const k of ['idea', 'people', 'year', 'how', 'from', 'via', 'source'] as const) expect(Array.from(B[k].slice(0, A.count))).toEqual(Array.from(A[k]))
    for (let k = A.count; k < B.count; k++) expect(B.year[k]).toBeGreaterThan(a.years)
    a.ideas.forEach((d, i) => { if (d.firstYear >= 0) expect(long.ideas[i]).toEqual(d); else expect(long.ideas[i].firstYear < 0 || long.ideas[i].firstYear > a.years).toBe(true) })
    const evA = a.events.filter((e) => isOurs(e.type)), evL = long.events.filter((e) => isOurs(e.type))
    expect(evL.slice(0, evA.length)).toEqual(evA)
    expect(Array.from(long.technology.slice(0, a.technology.length))).toEqual(Array.from(a.technology))
    // Resumable.
    const run = createHistoryRun(w)
    const r1 = run.advanceTo(1500)
    expect(hashIdeas(r1)).toBe(hashIdeas(a))
    expect(hashPreIdeas(r1)).toBe(hashPreIdeas(a))
    const r2 = run.advanceTo(2100)
    expect(hashIdeas(r2)).toBe(hashIdeas(long))
    expect(hashPreIdeas(r2)).toBe(hashPreIdeas(long))
    expect(hashIdeas(r1)).toBe(hashIdeas(a)) // (untouched by the extension)
    const bufs = (h: History) => [h.ideaAdoptions.idea, h.ideaAdoptions.people, h.ideaAdoptions.year, h.ideaAdoptions.via].map((x) => x.buffer)
    const seen = new Set(bufs(r1))
    for (const x of bufs(r2)) expect(seen.has(x)).toBe(false)
  }, 400_000)

  it('the technology levels follow the caps of the ideas held: a people without ideas plateaus, receiving them it catches up', () => {
    let over = 0, n = 0, worst = 0
    let bare = -1
    runHistory(world(42), { years: 1500 }, (s) => {
      const ix = s.ideas
      if (ix === null || s.year % 50 !== 0) return
      for (let p = 0; p < ix.P; p++) {
        if (!(ix.ctx.pop[p] > 0)) continue
        let nh = 0
        for (let i = 0; i < ix.I; i++) nh += ix.held[p * ix.I + i]
        for (let f = 0; f < 4; f++) {
          const d = s.tech[p * 4 + f] - ix.fx.cap[p * 4 + f]
          n++
          if (d > IDEA.soft * 2) over++
          if (d > worst) worst = d
        }
        if (nh === 0) bare = Math.max(bare, s.tech[p * 4])
      }
    })
    // (at most a little above the cap: the soft margin, rarely more after an idea is lost)
    expect(over / n).toBeLessThan(0.05)
    expect(worst).toBeLessThan(0.8)
    if (bare >= 0) expect(bare).toBeLessThan(1 + IDEA.capBase + 0.4)
  }, 300_000)
})
