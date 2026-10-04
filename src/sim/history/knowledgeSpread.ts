// gradual-knowledge: what peoples in contact learn from each other, a little at a time.
//
// At first contact (knowledge.ts meet) each side learns only what lies near
// the meeting: the cells the other knows within KNOW_SPREAD.revealHops plain
// hops of the two settlements through which they met, and the other's
// settlements within revealSettleHops (so those two, and the other's nearby
// towns, are known at once: trade can start). After that, what a people
// knows passes to each people it has met as a spreading front: every
// KNOW_SPREAD.step years the learner gains, one ring of cells per hop, the
// cells the teacher knows that lie beside cells the learner already knows, so
// knowledge advances outward from what it has. The front moves
//   rate = (contact + near (if settlements of the two have seen each other) + trade * v / (v + tradeHalf))
//          * (1 + craftsTech * (Crafts - 1))
// hops a year, v the smoothed trade volume between the two peoples (technology.ts pairVol), Crafts the
// learner's: fast between heavy trading partners, slowly by bare contact. Chains work: what B learned from C
// is part of what B knows, and reaches A later. Nothing here is ever unlearned; a people's own journeys,
// voyages, expeditions, trade routes and sight are still learned at once (knowledge.ts).
//
// Cost: the front of each ordered pair (learner, teacher) is a candidate list, fed incrementally from what
// either people learned since the last step (Knowledge.fresh) and seeded by one scan of the cells when the
// pair first met; each candidate costs a few neighbour checks, so the work is bounded by what is learned.
// Deterministic: fixed orders, no randomness, plain arithmetic.

import { TECH_FIELD_COUNT, TechField } from '../../contract.ts'
import { KNOW_SPREAD } from './params.ts'
import type { HistoryState } from './state.ts'
import type { TechState } from './technology.ts'

export interface SpreadState {
  /** 1 once the front of an ordered pair (learner * P + teacher) has been seeded (at the first step after they met). */
  seeded: Uint8Array
  /** Fractional hops of front accumulated per ordered pair. */
  acc: Float64Array
  /** Candidate cells per ordered pair: known to the teacher and beside a cell the learner knew when listed (may hold duplicates and cells since learned). */
  cand: number[][]
  /** List length at the last compaction, per ordered pair. */
  candKept: Int32Array
  /** Scratch (reveal search, compaction): stamps, depths, queue. */
  stamp: Int32Array
  depth: Int32Array
  queue: Int32Array
  run: number
  /** Plain hops of the reveal at first contact at this resolution: of all known cells, and of settlements. */
  revealHops: number
  revealSettleHops: number
}

export function createSpread(P: number, N: number, n: number): SpreadState {
  const cand: number[][] = []
  for (let i = 0; i < P * P; i++) cand.push([])
  return {
    seeded: new Uint8Array(P * P),
    acc: new Float64Array(P * P),
    cand,
    candKept: new Int32Array(P * P),
    stamp: new Int32Array(N),
    depth: new Int32Array(N),
    queue: new Int32Array(N),
    run: 0,
    revealHops: Math.max(1, Math.round((KNOW_SPREAD.revealHops * n) / 48)),
    revealSettleHops: Math.max(1, Math.round((KNOW_SPREAD.revealSettleHops * n) / 48)),
  }
}

/**
 * First contact through settlements a and b (of different peoples): each people learns the cells the other
 * knows within revealHops plain hops of either settlement (over land and sea), and the cells of the other's
 * living settlements within revealSettleHops.
 */
export function revealNear(s: HistoryState, a: number, b: number): void {
  const k = s.know
  const sp = k.spread
  const { known, N, fresh } = k
  const pa = s.people[a], pb = s.people[b]
  const baseA = pa * N, baseB = pb * N
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const { stamp, depth, queue } = sp
  const run = ++sp.run
  const year = s.year
  const hops = sp.revealHops
  const far = sp.revealSettleHops > hops ? sp.revealSettleHops : hops
  const { occupant, people } = s
  let head = 0, tail = 0
  const ca = s.cell[a], cb = s.cell[b]
  stamp[ca] = run; depth[ca] = 0; queue[tail++] = ca
  if (stamp[cb] !== run) { stamp[cb] = run; depth[cb] = 0; queue[tail++] = cb }
  while (head < tail) {
    const c = queue[head++]
    const ya = known[baseA + c], yb = known[baseB + c]
    const o = depth[c] <= hops ? -1 : occupant[c] // (beyond revealHops: settlements only)
    if (o >= 0 || depth[c] <= hops) {
      const po = o >= 0 ? people[o] : -1
      if (yb >= 0 && ya < 0 && (o < 0 || po === pb)) { known[baseA + c] = year; fresh[pa].push(c) }
      else if (ya >= 0 && yb < 0 && (o < 0 || po === pa)) { known[baseB + c] = year; fresh[pb].push(c) }
    }
    if (depth[c] >= far) continue
    for (let e = off[c]; e < off[c + 1]; e++) {
      const j = nb[e]
      if (stamp[j] === run) continue
      stamp[j] = run
      depth[j] = depth[c] + 1
      queue[tail++] = j
    }
  }
}

/** True when a neighbour of cell c is known to the people whose rows start at `base`. */
function besideKnown(known: Int16Array, base: number, off: Uint32Array, nb: Uint32Array, c: number): boolean {
  for (let e = off[c]; e < off[c + 1]; e++) if (known[base + nb[e]] >= 0) return true
  return false
}

/** Drops duplicates and cells the learner already knows from a pair's candidate list. */
function compact(sp: SpreadState, known: Int16Array, base: number, i: number): void {
  const list = sp.cand[i]
  const stamp = sp.stamp
  const run = ++sp.run
  let w = 0
  for (let t = 0; t < list.length; t++) {
    const c = list[t]
    if (stamp[c] === run || known[base + c] >= 0) continue
    stamp[c] = run
    list[w++] = c
  }
  list.length = w
  sp.candKept[i] = w
}

/** System (end of year, after technology and knowledge, every KNOW_SPREAD.step years): the fronts advance. */
export function knowledgeSpreadSystem(s: HistoryState, tk: TechState): void {
  const X = KNOW_SPREAD
  if (s.year % X.step !== 0) return
  const k = s.know
  const sp = k.spread
  const { P, N, known, contact, near } = k
  const { neighborOffsets: off, neighbors: nb } = s.world.grid
  const { seeded, acc, cand } = sp
  const alive = tk.alive
  const year = s.year
  // 1. What each people learned since the last step widens the fronts of its seeded pairs, as learner and as teacher.
  for (let x = 0; x < P; x++) {
    const ev = k.fresh[x]
    if (ev.length === 0) continue
    k.fresh[x] = [] // (cells learned below go to the new list: they feed the next step)
    if (!alive[x]) continue
    const bx = x * N
    for (let q = 0; q < P; q++) {
      if (q === x || !alive[q] || contact[x * P + q] < 0) continue
      const bq = q * N
      if (seeded[x * P + q]) {
        // x learns from q: q's cells beside what x just learned.
        const list = cand[x * P + q]
        for (let t = 0; t < ev.length; t++) {
          const c = ev[t]
          for (let e = off[c]; e < off[c + 1]; e++) {
            const j = nb[e]
            if (known[bq + j] >= 0 && known[bx + j] < 0) list.push(j)
          }
        }
      }
      if (seeded[q * P + x]) {
        // q learns from x: what x just learned, where it lies beside what q knows.
        const list = cand[q * P + x]
        for (let t = 0; t < ev.length; t++) {
          const c = ev[t]
          if (known[bq + c] < 0 && besideKnown(known, bq, off, nb, c)) list.push(c)
        }
      }
    }
  }
  // 2. Pairs met since the last step: their fronts start from everything either knows now.
  for (let p = 0; p < P; p++) {
    if (!alive[p]) continue
    const bp = p * N
    for (let q = 0; q < P; q++) {
      const i = p * P + q
      if (q === p || seeded[i] || !alive[q] || contact[i] < 0) continue
      seeded[i] = 1
      const bq = q * N
      const list = cand[i]
      for (let c = 0; c < N; c++) if (known[bq + c] >= 0 && known[bp + c] < 0 && besideKnown(known, bp, off, nb, c)) list.push(c)
      sp.candKept[i] = list.length
    }
  }
  // 3. Each front advances by whole hops: the candidates are learned, and the teacher's cells beside them are next.
  const pairVol = tk.pairVol
  const tech = s.tech
  for (let p = 0; p < P; p++) {
    if (!alive[p]) continue
    const bp = p * N
    const crafts = 1 + X.craftsTech * (tech[p * TECH_FIELD_COUNT + TechField.Crafts] - 1)
    for (let q = 0; q < P; q++) {
      const i = p * P + q
      if (q === p || !seeded[i]) continue
      if (!alive[q]) { cand[i] = []; continue } // (a people that died out teaches nothing more)
      const v = pairVol[i]
      const rate = (X.contact + (near[i] ? X.near : 0) + (X.trade * v) / (v + X.tradeHalf)) * crafts
      let a = acc[i] + rate * X.step
      let hops = Math.floor(a)
      a -= hops
      if (hops > X.maxHops) hops = X.maxHops
      acc[i] = a
      let list = cand[i]
      if (hops === 0) {
        if (list.length > 2 * sp.candKept[i] + 256) compact(sp, known, bp, i) // keep the waiting list bounded
        continue
      }
      const bq = q * N
      for (let h = 0; h < hops && list.length > 0; h++) {
        const learned: number[] = []
        for (let t = 0; t < list.length; t++) {
          const c = list[t]
          if (known[bp + c] >= 0) continue
          known[bp + c] = year
          learned.push(c)
        }
        const next: number[] = []
        for (let t = 0; t < learned.length; t++) {
          const c = learned[t]
          k.fresh[p].push(c)
          for (let e = off[c]; e < off[c + 1]; e++) {
            const j = nb[e]
            if (known[bq + j] >= 0 && known[bp + j] < 0) next.push(j)
          }
        }
        list = next
      }
      cand[i] = list
      sp.candKept[i] = list.length
      if (list.length > 0) compact(sp, known, bp, i)
    }
  }
}
