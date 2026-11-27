// Sagas: names for wars, derived from the records alone so that every saga calls a war by the same name: two realms of
// one name ("the War of the Two Kubetas"), a civil war ("the Temukuntin Civil War"), a holy war ("the Kuleso Holy War"),
// a long one ("the Thirty Years' War over Vebena": its length, and the largest town that changed hands in it), one
// that took a great town ("the Vebena War"), or a costly one named for its enemy and year ("the Kubeta War of 1203").
// Small wars stay unnamed. Names that would repeat get ordinals ("the Second War of the Two Kubetas"). Computed once
// per history and year told (a war still being fought has no length yet).

import { EventType, WarKind } from '../../contract.ts'
import type { History } from '../../contract.ts'
import type { Ctx } from './facts.ts'
import { ordinal } from './voice.ts'

const cache = new WeakMap<History, Map<number, string[]>>()

const NUM_CAP = (n: number): string => {
  const w = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const t = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  if (n < 20) return w[n]
  if (n < 100) return t[Math.floor(n / 10)] + (n % 10 ? '-' + w[n % 10] : '')
  return n === 100 ? 'Hundred' : String(n)
}

const plural = (name: string) => (/(s|sh|ch|x|z)$/i.test(name) ? `${name}es` : `${name}s`)

/** The war's name as told at the context's year, '' when it has none. */
export function warName(c: Ctx, w: number): string {
  const W = c.pd?.wars
  if (!W || w < 0 || w >= W.count || W.startYear[w] > c.Y) return ''
  let m = cache.get(c.h)
  if (!m) cache.set(c.h, (m = new Map()))
  let names = m.get(c.Y)
  if (!names) {
    names = nameAll(c)
    if (m.size > 16) m.clear()
    m.set(c.Y, names)
  }
  return names[w] ?? ''
}

/** "the War of the Two Kubetas" or else "the war against Kubeta" (from polity p's side; "the civil war" for its own). */
export function warCalled(c: Ctx, w: number, p: number): string {
  const n = warName(c, w)
  if (n) return n
  const W = c.pd!.wars!
  if (W.kind[w] === WarKind.CivilWar) return 'the civil war'
  const other = W.attacker[w] === p ? W.defender[w] : W.attacker[w]
  return `the war against ${c.pname(other)}`
}

function nameAll(c: Ctx): string[] {
  const W = c.pd!.wars!
  const h = c.h
  const Y = c.Y
  const out: string[] = new Array(W.count).fill('')
  const holyFaith = new Map<number, number>()
  for (const i of c.type(EventType.HolyWar)) { const e = c.ev(i); holyFaith.set(e.value, e.extra ?? -1) }
  // the largest town taken in each war (by its people the year before), and whether it was sacked
  const taken = new Map<number, { id: number; pop: number; year: number }>()
  for (const i of c.type(EventType.Conquered)) {
    const e = c.ev(i)
    const pop = c.pop(e.settlement, Math.max(0, e.year - 1))
    const t = taken.get(e.value)
    if (!t || pop > t.pop) taken.set(e.value, { id: e.settlement, pop, year: e.year })
  }
  const base = (p: number) => h.polities[p]?.name ?? ''
  for (let w = 0; w < W.count; w++) {
    const s = W.startYear[w]
    if (s > Y) break
    const ended = W.endYear[w] >= 0 && W.endYear[w] <= Y
    const len = (ended ? W.endYear[w] : Y) - s
    const a = W.attacker[w], d = W.defender[w]
    const dead = W.dead[w]
    const t = taken.get(w)
    const town = t && t.pop >= 2000 ? c.name(t.id, t.year) : ''
    if (W.kind[w] === WarKind.CivilWar) {
      if (dead >= 300 || len >= 3) out[w] = `the ${base(d)} Civil War`
    } else if (base(a) && base(a) === base(d)) out[w] = `the War of the Two ${plural(base(a))}`
    else if (holyFaith.has(w) && c.faithWord(holyFaith.get(w)!)) out[w] = `the ${c.faithWord(holyFaith.get(w)!)} Holy War`
    else if (ended && len >= 20) out[w] = `the ${NUM_CAP(len)} Years' War${town ? ` over ${town}` : ''}`
    else if (town && t!.pop >= 5000) out[w] = `the ${town} War`
    else if (dead >= 3000) out[w] = `the ${base(d)} War of ${s}`
  }
  // (repeats: ordinals in order of declaration, "the First ..." once a second comes)
  const seen = new Map<string, number[]>()
  out.forEach((n, w) => { if (n) { const a = seen.get(n) ?? []; a.push(w); seen.set(n, a) } })
  for (const [n, ws] of seen) {
    if (ws.length < 2) continue
    ws.forEach((w, k) => { out[w] = n.replace(/^the /, `the ${cap(ordinal(k + 1))} `) })
  }
  return out
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * partisan: the war's name from the teller's side (experience §3.4). Without a lens, warCalled. A defensive war the
 * teller won with >= 3000 dead is "the War of Deliverance"; a war the foe won against the teller "the {Foe} Invasion of
 * {year}"; a war the teller began "the {Our} Campaign against {foe}". The neutral name (warName) is unchanged: the
 * neutral sagas and the chronicle keep one name per war.
 */
export function warCalledBy(c: Ctx, w: number, p: number): string {
  const L = c.lens
  const W = c.pd?.wars
  if (!L || !W) return warCalled(c, w, p)
  const s = L.sideOfWar(w, c.Y)
  if (s.side === 'none' || W.kind[w] === WarKind.CivilWar) return warCalled(c, w, p)
  const foe = s.side === 'attacker' ? W.defender[w] : W.attacker[w]
  const ours = s.side === 'attacker' ? W.attacker[w] : W.defender[w]
  const base = (q: number) => c.h.polities[q]?.name ?? ''
  if (s.side === 'defender' && s.won && W.dead[w] >= 3000) return 'the War of Deliverance'
  if (s.lost && s.side === 'defender') return `the ${base(foe)} Invasion of ${W.startYear[w]}`
  if (s.side === 'attacker') return `the ${base(ours)} Campaign against ${c.pname(foe)}`
  return warCalled(c, w, p)
}
