// orders: stats harness. Per seed, a run without orders, then two runs with a standard set of five orders each, all given in one
// year (set A at --a (1000): Explore, Crop, War, Seat, Fortify; set B at --b (1500): Settle, Idea, Peace, Faith, Quarantine), their
// actors and targets picked from the run without orders at that year (the runs agree before it). Prints per order its outcome,
// year, reason and a one-line story; then fulfilment rates per kind and the side effects on aggregates at the end of the run.
//   node src/sim/history/orders/ordersStats.ts [--years N] [--a Y] [--b Y] [--quiet] seeds...

import { EventType, FaithKind, OrderKind, OrderReason, OrderStatus, StructureType, describeOrderKinds, encodeOrders, ideasHeldAt, orderFeasible, settlementNameAt } from '../../../contract.ts'
import type { History, Order, World } from '../../../contract.ts'
import { generateWorld, simulateHistory } from '../../index.ts'
import { HISTORY_STATS_SEEDS } from '../stats.ts'

const KINDS = describeOrderKinds()
const STATUS = Object.keys(OrderStatus) as (keyof typeof OrderStatus)[]
const REASON = Object.keys(OrderReason) as (keyof typeof OrderReason)[]

const aliveAt = (h: History, id: number, y: number): boolean => { const x = h.settlements[id]; return x.foundedYear <= y && (x.abandonedYear < 0 || x.abandonedYear > y) }
const snapOf = (h: History, y: number): number => Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval))
const popAt = (h: History, id: number, y: number): number => h.population[snapOf(h, y) * h.settlements.length + id]
const polAt = (h: History, id: number, y: number): number => h.polity.length ? h.polity[snapOf(h, y) * h.settlements.length + id] : -1
const polAlive = (h: History, p: number, y: number): boolean => h.polities[p].foundedYear <= y && (h.polities[p].endedYear < 0 || h.polities[p].endedYear > y)
function chord(w: World, a: number, b: number): number {
  const P = w.grid.positions
  const dx = P[3 * a] - P[3 * b], dy = P[3 * a + 1] - P[3 * b + 1], dz = P[3 * a + 2] - P[3 * b + 2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
const hopOf = (w: World): number => { const o = w.grid.neighborOffsets; return chord(w, 0, w.grid.neighbors[o[0]]) }

/** Peoples by living population at y, largest first. */
function peoplesBySize(h: History, y: number): number[] {
  const pop = new Float64Array(h.peoples.length)
  for (const x of h.settlements) if (!x.outpost && aliveAt(h, x.id, y)) pop[x.people] += popAt(h, x.id, y)
  return h.peoples.map((p) => p.id).filter((p) => pop[p] > 0).sort((a, b) => pop[b] - pop[a] || a - b)
}
function polityPop(h: History, y: number): Float64Array {
  const pop = new Float64Array(h.polities.length)
  for (const x of h.settlements) { const p = polAt(h, x.id, y); if (p >= 0 && aliveAt(h, x.id, y)) pop[p] += popAt(h, x.id, y) }
  return pop
}
function capitalAt(h: History, p: number, y: number): number {
  const P = h.polities[p]; let c = -1
  for (let k = 0; k < P.capitals.length && P.capitalYears[k] <= y; k++) c = P.capitals[k]
  return c
}
const atWarAt = (h: History, p: number, q: number, y: number): number => {
  const W = h.wars
  for (let w = 0; w < W.count; w++) if (((W.attacker[w] === p && W.defender[w] === q) || (W.attacker[w] === q && W.defender[w] === p)) && W.startYear[w] <= y && (W.endYear[w] < 0 || W.endYear[w] >= y)) return w
  return -1
}

/** The faith of the ruler of polity p at year y (its faith at accession, then its conversions; -1 if none known). */
function rulerFaith(h: History, p: number, y: number): number {
  let f = -1, from = 0
  for (const r of h.rulers) if (r.polity === p && r.acceded <= y && (r.ended < 0 || r.ended > y)) { f = r.faith; from = r.acceded }
  for (const e of h.events) if (e.type === EventType.RulerConverted && e.year >= from && e.year <= y && polAt(h, e.settlement, e.year) === p) f = e.value
  return f
}

/** The standard orders of set A (year y) or B, picked from history h (without orders); kinds that find no fitting actor are left out. */
export function pickOrders(w: World, h: History, y: number, set: 'A' | 'B'): Order[] {
  const N = w.grid.cellCount
  const hop = hopOf(w)
  const peoples = peoplesBySize(h, y)
  const out: Order[] = []
  const add = (o: Order | null): void => { if (o && orderFeasible(h, { ...o, year: y + 1 }, y + 1) === OrderReason.None) out.push(o) }
  const mid = peoples.length > 1 ? peoples[1] : peoples[0] // (the second-largest people: not always the leader)
  // (the people's towns able to send expeditions and settlers: ORDERS.senderPop)
  const homes = (p: number): number[] => h.settlements.filter((x) => x.people === p && !x.outpost && aliveAt(h, x.id, y) && popAt(h, x.id, y) >= 300).map((x) => x.cell)
  if (set === 'A') {
    // Explore: the second people toward the nearest land it does not know, at least 6 cells from its towns.
    if (mid !== undefined) {
      const hs = homes(mid)
      let best = -1, bd = Infinity
      for (let c = 0; c < N; c++) {
        if (w.elevation[c] < 0) continue
        const k = h.knownYear[mid * N + c]
        if (k >= 0 && k <= y) continue
        let d = Infinity
        for (const a of hs) { const x = chord(w, a, c); if (x < d) d = x }
        if (d >= 6 * hop && d < bd) { bd = d; best = c }
      }
      if (best >= 0) add({ year: y, kind: OrderKind.Explore, actor: mid, target: best })
    }
    // Crop: the largest people takes up the species most held by the peoples it has met, that it lacks.
    const big = peoples[0]
    if (big !== undefined) {
      const P = h.peoples.length, S = h.species.length
      let best = -1, bn = 0
      for (let x = 0; x < S; x++) {
        const k = h.speciesYear[big * S + x]
        if (k >= 0 && k <= y) continue
        let n = 0
        for (let q = 0; q < P; q++) { const c = h.contactYear[big * P + q]; const t = h.speciesYear[q * S + x]; if (q !== big && c >= 0 && c <= y && t >= 0 && t <= y) n++ }
        if (n > bn) { bn = n; best = x }
      }
      if (best >= 0) add({ year: y, kind: OrderKind.Crop, actor: big, target: best })
    }
    if (h.polities.length > 0) {
      const pp = polityPop(h, y)
      const alive = h.polities.map((p) => p.id).filter((p) => polAlive(h, p, y) && pp[p] > 0).sort((a, b) => pp[b] - pp[a] || a - b)
      // War: the largest polity on the polity with the nearest capital that it is not at war with.
      for (const a of alive.slice(0, 3)) {
        const ca = capitalAt(h, a, y)
        let best = -1, bd = Infinity
        for (const b of alive) { if (b === a || atWarAt(h, a, b, y) >= 0) continue; const d = chord(w, h.settlements[ca].cell, h.settlements[capitalAt(h, b, y)].cell); if (d < bd) { bd = d; best = b } }
        if (best >= 0) { add({ year: y, kind: OrderKind.War, actor: a, target: best }); break }
      }
      // Seat: the second polity's capital moves to its largest other town.
      const sp = alive.length > 1 ? alive[1] : alive[0]
      if (sp !== undefined) {
        const cap = capitalAt(h, sp, y)
        let best = -1
        for (const x of h.settlements) if (x.id !== cap && !x.outpost && aliveAt(h, x.id, y) && polAt(h, x.id, y) === sp && (best < 0 || popAt(h, x.id, y) > popAt(h, best, y))) best = x.id
        if (best >= 0) add({ year: y, kind: OrderKind.Seat, actor: sp, target: best })
      }
      // Fortify: the largest town of the largest polity without walls.
      if (alive.length > 0) {
        let best = -1
        for (const x of h.settlements) {
          if (x.outpost || !aliveAt(h, x.id, y) || polAt(h, x.id, y) !== alive[0]) continue
          if (h.structures.some((st) => st.type === StructureType.Walls && st.settlement === x.id && st.builtYear <= y && (st.lostYear < 0 || st.lostYear > y))) continue
          if (popAt(h, x.id, y) < 500) continue
          if (best < 0 || popAt(h, x.id, y) > popAt(h, best, y)) best = x.id
        }
        if (best >= 0) add({ year: y, kind: OrderKind.Fortify, actor: best })
      }
    }
  } else {
    // Settle: the second people toward the best known, empty land 4-10 cells from its nearest town.
    if (mid !== undefined) {
      const hs = homes(mid)
      const taken = new Uint8Array(N)
      for (const x of h.settlements) if (aliveAt(h, x.id, y)) taken[x.cell] = 1
      let best = -1, bv = 0
      for (let c = 0; c < N; c++) {
        if (!(h.capacity[c] > 0) || taken[c]) continue
        const k = h.knownYear[mid * N + c]
        if (k < 0 || k > y) continue
        let d = Infinity
        for (const a of hs) { const x = chord(w, a, c); if (x < d) d = x }
        if (d < 4 * hop || d > 10 * hop) continue
        if (h.capacity[c] > bv) { bv = h.capacity[c]; best = c }
      }
      if (best >= 0) add({ year: y, kind: OrderKind.Settle, actor: mid, target: best })
    }
    // Idea: the third people (or the second) seeks the idea held by most peoples, whose prerequisites it holds.
    for (const q of h.ideas.length > 0 ? peoples.slice(1).concat(peoples.slice(0, 1)) : []) {
      {
        const held = ideasHeldAt(h, q, y)
        const count = new Int32Array(h.ideas.length)
        const PN = h.peoples.length
        for (let p = 0; p < PN; p++) { const c = h.contactYear[q * PN + p]; if (p !== q && c >= 0 && c <= y) for (const i of ideasHeldAt(h, p, y)) count[i]++ }
        let best = -1
        for (const I of h.ideas) {
          if (I.technique >= 0 || held.indexOf(I.id) >= 0 || I.prerequisites.some((r) => held.indexOf(r) < 0)) continue
          if (count[I.id] > 0 && (best < 0 || count[I.id] > count[best])) best = I.id
        }
        if (best >= 0) { add({ year: y, kind: OrderKind.Idea, actor: q, target: best }); break }
      }
    }
    if (h.polities.length > 0) {
      // Peace: the oldest war going on at y (begun at least 2 years before).
      const W = h.wars
      for (let k = 0; k < W.count; k++) {
        if (W.startYear[k] <= y - 2 && (W.endYear[k] < 0 || W.endYear[k] > y)) { add({ year: y, kind: OrderKind.Peace, actor: W.defender[k], target: W.attacker[k] }); break }
      }
      // Faith: the polity and universal faith (not its state faith) with the most of its people in towns where it is the majority.
      if (h.faiths.length > 0) {
        const PP = h.polities.length
        const best = { p: -1, f: -1, v: 0 }
        const acc = new Map<number, number>()
        const q = snapOf(h, y)
        for (const x of h.settlements) {
          const p = polAt(h, x.id, y)
          if (p < 0 || !aliveAt(h, x.id, y)) continue
          const f = h.faith[q * h.settlements.length + x.id]
          if (f === 255 || h.faiths[f].kind !== FaithKind.Universal) continue
          const rf = rulerFaith(h, p, y)
          if (h.stateFaith[q * PP + p] === f + 1 || rf === f || (rf >= 0 && h.faiths[rf].kind === FaithKind.Universal)) continue // (a ruler of a universal faith turns only when the capital has)
          const key = p * 256 + f
          const v = (acc.get(key) ?? 0) + popAt(h, x.id, y)
          acc.set(key, v)
          if (v > best.v) { best.v = v; best.p = p; best.f = f }
        }
        if (best.p >= 0) add({ year: y, kind: OrderKind.Faith, actor: best.p, target: best.f })
      }
      // Quarantine: the largest port in a polity, not in quarantine.
      let bestQ = -1
      for (const st of h.structures) {
        if (st.type !== StructureType.Port || st.builtYear > y || (st.lostYear >= 0 && st.lostYear <= y)) continue
        const id = st.settlement
        if (id < 0 || !aliveAt(h, id, y) || polAt(h, id, y) < 0) continue
        if (orderFeasible(h, { year: y + 1, kind: OrderKind.Quarantine, actor: id }, y + 1) !== OrderReason.None) continue
        if (bestQ < 0 || popAt(h, id, y) > popAt(h, bestQ, y)) bestQ = id
      }
      if (bestQ >= 0) add({ year: y, kind: OrderKind.Quarantine, actor: bestQ })
    }
  }
  return out
}

/** A one-line story of order k of history h. */
export function story(h: History, k: number): string {
  const o = (h.orders as Order[])[k], r = (h.orderOutcomes ?? [])[k]
  const info = KINDS[o.kind]
  const y0 = o.year
  const town = (id: number, y: number): string => (id >= 0 ? settlementNameAt(h, id, y) : '?')
  const pol = (p: number): string => (p >= 0 && p < h.polities.length ? h.polities[p].name : '?')
  const ppl = (p: number): string => (p >= 0 && p < h.peoples.length ? 'the ' + h.peoples[p].name : '?')
  const t = o.target ?? -1
  let ask: string
  switch (o.kind) {
    case OrderKind.Explore: ask = `${ppl(o.actor)}, urged to explore toward cell ${t}`; break
    case OrderKind.Settle: ask = `${ppl(o.actor)}, urged to settle toward cell ${t}`; break
    case OrderKind.Crop: ask = `${ppl(o.actor)}, urged to take up ${h.species[t]?.name ?? '?'} (${h.species[t]?.archetype ?? '?'})`; break
    case OrderKind.Idea: ask = `${ppl(o.actor)}, urged to seek ${h.ideas[t]?.name ?? '?'}`; break
    case OrderKind.War: ask = `${pol(o.actor)}, urged to make war on ${pol(t)}`; break
    case OrderKind.Peace: ask = `${pol(o.actor)}, urged to make peace with ${pol(t)}`; break
    case OrderKind.Seat: ask = `${pol(o.actor)}, urged to move its court to ${town(t, y0)}`; break
    case OrderKind.Faith: ask = `the ruler of ${pol(o.actor)}, urged to take up the ${h.faiths[t]?.name ?? '?'} faith`; break
    case OrderKind.Fortify: ask = `${town(o.actor, y0)}, urged to raise walls`; break
    case OrderKind.Quarantine: ask = `the port of ${town(o.actor, y0)}, urged to hold ships in quarantine`; break
    default: ask = info?.label ?? '?'
  }
  if (!r) return `${y0}: ${ask}`
  const yr = r.year
  const at = r.place >= 0 ? town(r.place, yr >= 0 ? yr : y0) : ''
  switch (r.status) {
    case OrderStatus.Fulfilled: {
      let what = ''
      switch (o.kind) {
        case OrderKind.Explore: what = r.reason === OrderReason.Reached ? `send an expedition from ${at} that reaches it` : 'learn of it from others'; break
        case OrderKind.Settle: what = `found ${town(r.product, yr)}`; break
        case OrderKind.Crop: what = `take it up at ${at}`; break
        case OrderKind.Idea: what = `take it up at ${at}`; break
        case OrderKind.War: what = `${h.wars.attacker[r.product] === o.actor ? 'declare war' : 'are attacked'} (war ${r.product})`; break
        case OrderKind.Peace: what = `make peace (war ${r.product})`; break
        case OrderKind.Seat: what = 'move the court there'; break
        case OrderKind.Faith: what = 'convert'; break
        case OrderKind.Fortify: what = 'raise walls'; break
        case OrderKind.Quarantine: what = 'begin a quarantine'; break
      }
      return `${y0}: ${ask}, ${what} in ${yr} (${yr - y0} years).`
    }
    case OrderStatus.Partly: return `${y0}: ${ask}: by ${yr} something was done (${o.kind === OrderKind.Explore ? `an expedition from ${at} went that way` : o.kind === OrderKind.Settle ? `${town(r.product, yr)} was founded nearer` : REASON[r.reason]}), not all.`
    case OrderStatus.Failed: return `${y0}: ${ask}: failed in ${yr} (${REASON[r.reason]}).`
    case OrderStatus.Expired: return `${y0}: ${ask}: nothing came of it by ${yr} (${REASON[r.reason]}).`
    case OrderStatus.Active: return `${y0}: ${ask}: still in force.`
  }
  return `${y0}: ${ask}: pending.`
}

interface Agg { pop: number; settlements: number; polities: number; wars: number; events: number; known: number }
function aggregates(h: History): Agg {
  const y = h.years
  let pop = 0, n = 0
  for (const x of h.settlements) if (aliveAt(h, x.id, y)) { pop += popAt(h, x.id, y); n++ }
  let known = 0
  for (let i = 0; i < h.knownYear.length; i++) if (h.knownYear[i] >= 0) known++
  const ev = h.events.filter((e) => e.type < 170 || e.type > 179).length
  return { pop, settlements: n, polities: h.polities.filter((p) => p.endedYear < 0).length, wars: h.wars.count, events: ev, known }
}

function main(): void {
  const args = ((globalThis as { process?: { argv: string[] } }).process?.argv ?? []).slice(2)
  let years = 2000, ya = 1000, yb = 1500, quiet = false
  const seeds: number[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--years') years = Number(args[++i])
    else if (args[i] === '--a') ya = Number(args[++i])
    else if (args[i] === '--b') yb = Number(args[++i])
    else if (args[i] === '--quiet') quiet = true
    else seeds.push(Number(args[i]))
  }
  const list = seeds.length > 0 ? seeds : HISTORY_STATS_SEEDS
  const tally = KINDS.map(() => ({ n: 0, ok: 0, partly: 0, failed: 0, expired: 0, lag: [] as number[] }))
  const reasons = KINDS.map(() => new Map<string, number>())
  const diffs: Record<keyof Agg, number[]> = { pop: [], settlements: [], polities: [], wars: [], events: [], known: [] }
  const ctrl: Record<keyof Agg, number[]> = { pop: [], settlements: [], polities: [], wars: [], events: [], known: [] }
  for (const seed of list) {
    const w = generateWorld(seed)
    const t0 = performance.now()
    const base = simulateHistory(w, { years })
    const tBase = performance.now() - t0
    const b0 = aggregates(base)
    const pickA = pickOrders(w, base, ya - 1, 'A').map((o) => ({ ...o, year: ya })) // (given at ya, on the world of the end of ya - 1)
    const pickB = pickOrders(w, base, yb - 1, 'B').map((o) => ({ ...o, year: yb }))
    // (control C: the Fortify order of set A alone, a small sure change: how far the world drifts from any change at all)
    for (const [set, orders] of [['A', pickA], ['B', pickB], ['C', pickA.filter((o) => o.kind === OrderKind.Fortify)]] as const) {
      if (orders.length === 0) continue
      const t1 = performance.now()
      const h = simulateHistory(w, { years, orders })
      const tRun = performance.now() - t1
      const a = aggregates(h)
      for (const k of Object.keys(diffs) as (keyof Agg)[]) (set === 'C' ? ctrl : diffs)[k].push(b0[k] > 0 ? (a[k] - b0[k]) / b0[k] : 0)
      if (set === 'C') continue
      if (!quiet) console.log(`seed ${seed} set ${set} o=${encodeOrders(orders)}  (${(tRun / 1000).toFixed(1)}s, without ${(tBase / 1000).toFixed(1)}s)`)
      const R = h.orderOutcomes ?? []
      for (let k = 0; k < orders.length; k++) {
        const o = orders[k], r = R[k]
        const T = tally[o.kind]
        T.n++
        if (r.status === OrderStatus.Fulfilled) { T.ok++; T.lag.push(r.year - o.year) }
        else if (r.status === OrderStatus.Partly) T.partly++
        else if (r.status === OrderStatus.Failed) T.failed++
        else if (r.status === OrderStatus.Expired) T.expired++
        const key = STATUS[r.status] + ':' + REASON[r.reason]
        reasons[o.kind].set(key, (reasons[o.kind].get(key) ?? 0) + 1)
        if (!quiet) console.log(`  ${KINDS[o.kind].key.padEnd(10)} ${STATUS[r.status].padEnd(9)} ${String(r.year).padStart(5)} ${REASON[r.reason].padEnd(13)} ${story(h, k)}`)
      }
      void EventType
    }
  }
  console.log('\nkind        n  fulfilled  partly  failed  expired  median years   outcomes')
  for (let i = 0; i < KINDS.length; i++) {
    const T = tally[i]
    if (T.n === 0) continue
    const lag = T.lag.slice().sort((a, b) => a - b)
    const med = lag.length ? lag[lag.length >> 1] : NaN
    const rs = [...reasons[i].entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
    console.log(`${KINDS[i].key.padEnd(10)} ${String(T.n).padStart(3)}  ${(T.ok / T.n * 100).toFixed(0).padStart(8)}%  ${String(T.partly).padStart(6)}  ${String(T.failed).padStart(6)}  ${String(T.expired).padStart(7)}  ${String(med).padStart(12)}   ${rs}`)
  }
  const med = (a: number[]): number => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN }
  const mabs = (a: number[]): number => med(a.map(Math.abs))
  console.log('\nside effects at the end of the run (ordered run vs without, relative): median | median of |x| | max |x|   (control: one Fortify order)')
  const f = (x: number): string => (x * 100).toFixed(2).padStart(7) + '%'
  for (const k of Object.keys(diffs) as (keyof Agg)[]) {
    const a = diffs[k], c = ctrl[k]
    console.log(`  ${k.padEnd(12)} ${f(med(a))} ${f(mabs(a))} ${f(Math.max(...a.map(Math.abs)))}   | ${f(med(c))} ${f(mabs(c))} ${f(Math.max(...c.map(Math.abs)))}`)
  }
}

if (typeof import.meta !== 'undefined' && (import.meta as { main?: boolean }).main) main()
