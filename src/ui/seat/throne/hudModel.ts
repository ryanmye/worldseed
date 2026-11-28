// Throne slice (lane N3): the throne HUD as data (ui-additions 3, 3b, 3c). DOM-free, so the bots read the same numbers the
// dashboard draws (fun-harness rule: what the screen shows, nothing more). Values come from the HUD row the seat recorded at
// each decision (sim/history/seat/hud.ts: the systems' own hazard functions, the believed strength of enemies), so the
// dashboard shows the state at the last decision, with ▲/▼ against the decision before it.
//
// "Odds the realm stands in 50 years" (3c): S = exp(-50 x the sum of the yearly hazards of a blow to the realm: an overthrow,
// a contested succession (the ruler's yearly chance of death at this age x the chance the succession is contested), a crown
// default, a town breaking away, a war lost badly). Worded hedged: "if things stay as they are". Age is shown, and is not a
// risk: states do not die of old age (ui-additions 3b).
import { AccessionHow, SeatKind } from '../../../contract.ts'
import type { History } from '../../../contract.ts'
import { HUD, HUD_N } from '../../../sim/history/seat/hud.ts'
import { SEAT } from '../../../sim/history/seat/params.ts'
import { reignAt } from './heirs.ts'
import { spokenNameAt } from '../../../sim/names/spoken.ts'

export { HUD, HUD_N }

export interface Meter {
  key: string
  label: string
  /** Display text ("4.2 years of revenue", "38%"). */
  text: string
  value: number
  /** -1 worse, 0 same, +1 better since the decision before (for the player: ▼ red / ▲ green). */
  trend: -1 | 0 | 1
  /** The arrow and the change in words ("▲ from 31%"). */
  change: string
  why: string
}

export interface Hazard {
  key: string
  label: string
  /** Yearly chance 0..1. */
  yearly: number
  text: string
  trend: -1 | 0 | 1
  change: string
  /** The "Why?" line: its compose-stack factors in words. */
  why: string
}

export interface HudModel {
  year: number
  /** The decision row the HUD is read from (-1: none yet). */
  d: number
  realm: string
  /** Realm age in years (from its founding); a milestone notice when it passes a century (ui-additions 3d). */
  realmAge: number
  rulerAge: number
  meters: Meter[]
  hazards: Hazard[]
  /** 0..1, and its words. */
  odds: number
  oddsText: string
  oddsChange: string
  oddsTrend: -1 | 0 | 1
  /** "Age is not a risk": the explicit note. */
  ageNote: string
  /** lane N3d: why the odds moved by ODDS_WHY or more since the decision before ('' otherwise). */
  oddsWhy: string
}

/** lane N3d: a move of the 50-year odds this large (0..1) between two decisions is explained (play-test #2: ±30 with no word). */
export const ODDS_WHY = 0.1

/**
 * "Why the odds fell (75% → 42%): mostly the chance of a contested succession (the ruler is 61)": the hazard whose value at the
 * decision before would undo most of the move (each part put back alone, the rest as now).
 */
export function oddsWhy(r: ArrayLike<number>, p0: ArrayLike<number>, age: number): string {
  const now = oddsOfRow(r), was = oddsOfRow(p0)
  if (!(Math.abs(now - was) >= ODDS_WHY)) return ''
  const parts: [string, number[]][] = [
    ['the overthrow hazard', [HUD.Overthrow]],
    [`the chance of a contested succession${age >= 0 ? ` (the ruler is ${age})` : ''}`, [HUD.Contest, HUD.DeathYear]],
    ['towns that may break away', [HUD.Breakaway, HUD.LostShare]],
    ['the war', [HUD.WarLoss]],
    ['the crown’s debts', [HUD.Default]],
    [r.length > HUD.Crisis && r[HUD.Crisis] > 0 ? 'an open crisis at court' : 'the crisis at court, now over', [HUD.Crisis]],
  ]
  let best = '', gain = 0
  for (const [label, idx] of parts) {
    const x = Array.from(r)
    for (const i of idx) if (i < x.length && i < p0.length) x[i] = p0[i]
    const g = Math.abs(oddsOfRow(x) - now)
    if (g > gain) { gain = g; best = label }
  }
  if (!best) return ''
  return `Why the odds ${now < was ? 'fell' : 'rose'} (${pct(was)} → ${pct(now)}): mostly ${best}.`
}

const pct = (x: number) => `${x < 0.01 && x > 0 ? '<1' : Math.round(x * 100)}%`
const yrPct = (x: number) => (x <= 0 ? 'none' : x < 0.001 ? '<0.1% a year' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}% a year`)

/** The HUD row of decision d (HUD_N values; null when not recorded). */
export function hudRowOf(h: History, d: number): Float32Array | null {
  const D = h.seat?.decisions
  if (!D || !D.hud || d < 0 || d >= D.count || D.hud.length < (d + 1) * HUD_N) return null
  return D.hud.subarray(d * HUD_N, (d + 1) * HUD_N)
}

/** The sum of the yearly hazards of a blow to the realm (the odds' exponent / 50). */
export function blowRate(r: ArrayLike<number>): number {
  const v = (i: number) => (Number.isFinite(r[i]) ? r[i] : 0)
  // (breakaways: the yearly chance of losing a quarter of the realm's people to them, 4 x the expected share lost; a lone
  // village leaving is not a blow to the realm. A row from before LostShare existed has none: Breakaway / 10)
  const lost = r.length > HUD.LostShare && Number.isFinite(r[HUD.LostShare]) ? Math.min(1, 4 * r[HUD.LostShare]) : v(HUD.Breakaway) / 10
  // (a default due now counts once, oddsOfRow; the yearly part is capped: a crown can default only once in FIN.defaultGap years)
  return v(HUD.Overthrow) + v(HUD.Contest) * v(HUD.DeathYear) + Math.min(0.05, v(HUD.Default)) + lost + v(HUD.WarLoss)
}
export const oddsOf = (rate: number) => Math.exp(-50 * rate)
/** An open crisis: a one-off chance that it ends in civil war or a partition (RULERS civil 0.32, partition 0.12; a rough figure). */
export const CRISIS_RISK = 0.3
/** A default due now (the rule's own test is met): counted once, as a blow (a rough figure). */
export const DEFAULT_RISK = 0.5
/** The 50-year odds of a HUD row: the yearly hazards over 50 years, and an open crisis once. */
export function oddsOfRow(r: ArrayLike<number>): number {
  const crisis = r.length > HUD.Crisis && r[HUD.Crisis] > 0
  const due = Number.isFinite(r[HUD.Default]) && r[HUD.Default] >= 0.5
  return oddsOf(blowRate(r)) * (crisis ? 1 - CRISIS_RISK : 1) * (due ? 1 - DEFAULT_RISK : 1)
}

/** Legitimacy (UI meter, 0..1): how the realm sees the ruler's right, from the way they came to the throne, growing with years on it. */
export function legitimacy(how: number, years: number): number {
  const L0 = how === AccessionHow.Usurped ? 0.4 : how === AccessionHow.Conquered ? 0.5 : how === AccessionHow.Claimed ? 0.6 : how === AccessionHow.Elected ? 0.85 : 1
  return Math.min(1, L0 + 0.02 * Math.max(0, years))
}

function trendOf(now: number, before: number, goodUp: boolean, eps: number): -1 | 0 | 1 {
  if (!Number.isFinite(now) || !Number.isFinite(before) || Math.abs(now - before) <= eps) return 0
  return (now > before) === goodUp ? 1 : -1
}
const arrow = (now: number, before: number, eps: number, fmt: (x: number) => string) =>
  !Number.isFinite(before) || Math.abs(now - before) <= eps ? '' : `${now > before ? '▲' : '▼'} from ${fmt(before)}`

/** The seat's decision rows for its polity, in order. */
function rowsOf(h: History): number[] {
  const D = h.seat?.decisions
  const out: number[] = []
  if (D) for (let d = 0; d < D.count; d++) out.push(d)
  return out
}

/** The HUD at decision d (the card's moment), or at the last decision up to `year` when d < 0. */
export function hudModel(h: History, d: number, year: number): HudModel | null {
  const S = h.seat
  if (!S) return null
  const rows = rowsOf(h)
  if (d < 0) for (const x of rows) if (S.decisions.year[x] <= year) d = x
  const r = hudRowOf(h, d)
  if (!r) return null
  const prevD = rows.filter((x) => x < d).pop() ?? -1
  const p0 = hudRowOf(h, prevD)
  const before = (i: number) => (p0 ? p0[i] : NaN)
  const y = S.decisions.year[d]
  const p = S.decisions.polity[d]
  const P = h.polities?.[p]
  const realm = P?.name ?? 'the realm'
  const ruler = reignAt(h, p, y)
  const meters: Meter[] = []
  if (Number.isFinite(r[HUD.Treasury])) {
    const t = r[HUD.Treasury], b = before(HUD.Treasury)
    meters.push({ key: 'treasury', label: 'Treasury', value: t, text: t < 0 ? 'in arrears' : `${t.toFixed(1)} years of revenue`, trend: trendOf(t, b, true, 0.05), change: arrow(t, b, 0.05, (x) => x.toFixed(1)), why: 'Coin in the treasury, as years of the crown’s revenue (negative: arrears, the army unpaid).' })
    const db = r[HUD.Debt], bd = before(HUD.Debt)
    meters.push({ key: 'debt', label: 'Debt', value: db, text: `${db.toFixed(1)}× revenue`, trend: trendOf(db, bd, false, 0.05), change: arrow(db, bd, 0.05, (x) => `${x.toFixed(1)}×`), why: `The crown's debts over its ordinary revenue. The interest due is ${pct(r[HUD.DebtService])} of what the crown can bear before it defaults.` })
  }
  if (ruler) {
    const L = legitimacy(ruler.how, y - ruler.acceded)
    const Lb = p0 && prevD >= 0 ? (() => { const r0 = reignAt(h, p, S.decisions.year[prevD]); return r0 ? legitimacy(r0.how, S.decisions.year[prevD] - r0.acceded) : NaN })() : NaN
    meters.push({ key: 'legitimacy', label: 'Legitimacy', value: L, text: pct(L), trend: trendOf(L, Lb, true, 0.005), change: arrow(L, Lb, 0.005, pct), why: 'How the realm sees the ruler’s right: by the way they came to the throne (a usurper starts low) and the years on it. A reading of the record, not a number the simulation uses.' })
  }
  {
    const u = r[HUD.Unrest], b = before(HUD.Unrest)
    meters.push({ key: 'unrest', label: 'Unrest', value: u, text: pct(Math.min(1.5, u)), trend: trendOf(u, b, false, 0.01), change: arrow(u, b, 0.01, pct), why: 'The towns’ unrest, by people, against the level at which a town rises (100%).' })
    const dv = r[HUD.Deference], bv = before(HUD.Deference)
    const auth = Math.max(0, 1 - dv / SEAT.deferFull), ab = Number.isFinite(bv) ? Math.max(0, 1 - bv / SEAT.deferFull) : NaN
    meters.push({ key: 'authority', label: 'Authority', value: auth, text: pct(auth), trend: trendOf(auth, ab, true, 0.005), change: arrow(auth, ab, 0.005, pct), why: 'How far the realm still waits on you: each matter left to the court lowers it, each decision taken restores it.' })
    const w = r[HUD.Wars], bw = before(HUD.Wars)
    const ratio = r[HUD.EnemyRatio]
    meters.push({ key: 'war', label: 'War', value: w, text: w <= 0 ? 'at peace' : `${w} war${w > 1 ? 's' : ''}${ratio > 0 ? `; the strongest foe ${ratio >= 1 ? `${ratio.toFixed(1)}× our strength` : `${pct(ratio)} of ours`} (as our spies tell it)` : ''}`, trend: trendOf(w, bw, false, 0), change: !Number.isFinite(bw) || w === bw ? '' : `${w > bw ? '▲' : '▼'} from ${bw}`, why: 'Wars the realm is fighting, and the strongest enemy as the court believes it (fog: not the true figure).' })
  }
  const hz = (key: string, label: string, v: number, b: number, why: string): Hazard => ({ key, label, yearly: v, text: yrPct(v), trend: trendOf(v, b, false, 0.0005), change: arrow(v, b, 0.0005, (x) => yrPct(x).replace(' a year', '')), why })
  const hazards: Hazard[] = []
  {
    const f = (i: number) => (Number.isFinite(r[i]) && Math.abs(r[i] - 1) > 0.005 ? r[i] : 1)
    const parts: string[] = []
    if (r[HUD.OvBase] > 0) parts.push(`a ruler of middling ability on the throne: ${yrPct(r[HUD.OvBase])} at base`)
    else parts.push('the ruler is able, or new to the throne: not exposed')
    if (f(HUD.OvFin) !== 1) parts.push(`an unpaid army ×${f(HUD.OvFin).toFixed(2)}`)
    if (f(HUD.OvMagnates) !== 1) parts.push(`ambitious magnates ×${f(HUD.OvMagnates).toFixed(2)}`)
    if (f(HUD.OvGeneral) !== 1) parts.push(`a famous general ×${f(HUD.OvGeneral).toFixed(2)}`)
    if (f(HUD.OvOrders) !== 1) parts.push(`your orders (gold for the court, a purge) ×${f(HUD.OvOrders).toFixed(2)}`)
    if (f(HUD.OvDefer) !== 1) parts.push(`matters left to the court ×${f(HUD.OvDefer).toFixed(2)}`)
    hazards.push(hz('overthrow', 'Overthrow', r[HUD.Overthrow] || 0, before(HUD.Overthrow), `Overthrow: ${parts.join('; ')}.`))
  }
  {
    const c = r[HUD.Contest] || 0, dy = r[HUD.DeathYear] || 0
    const cb = before(HUD.Contest) * before(HUD.DeathYear)
    hazards.push(hz('succession', 'Contested succession', c * dy, cb, `If the ruler died now the succession would be contested with chance ${pct(c)}; at ${ruler ? y - ruler.born : '?'} the ruler's yearly chance of death is ${yrPct(dy)} (the life table, not a foretelling).`))
  }
  if (r.length > HUD.Crisis && r[HUD.Crisis] > 0) hazards.push({ key: 'crisis', label: 'An open crisis', yearly: 0, text: `${pct(CRISIS_RISK)} it ends in civil war`, trend: -1, change: '', why: 'A succession crisis or a regency is open: it may end in civil war or a partition (a rough figure, counted once in the odds). Placating the court ends it.' })
  if (Number.isFinite(r[HUD.Default])) hazards.push(hz('default', 'Crown default', r[HUD.Default], before(HUD.Default), `The crown defaults when the interest due passes what it can bear or the army goes unpaid for years: the interest is now ${pct(r[HUD.DebtService])} of that.`))
  {
    // (lane N3d: the towns named, and what moves it: the play-test's "Why?" named no town and no lever)
    const towns = [HUD.BreakTown1, HUD.BreakTown2].map((i) => (r.length > i && r[i] >= 0 ? r[i] : -1)).filter((i) => i >= 0 && i < h.settlements.length).map((i) => spokenNameAt(h, i, y))
    const b = r[HUD.Breakaway] || 0
    const why = b <= 0
      ? 'No town of the realm is restive enough to rise now.'
      : `Towns past the point of rising: together ${yrPct(r[HUD.Revolt] || 0)} that one rises, and ${yrPct(b)} that a rising wins and the town breaks away${towns.length ? `. Likeliest: ${towns.join(' and ')}` : ''}. Gold for the restive (Placate, Send relief) calms them; a garrison holds a town that rose; raising taxes stirs them.`
    hazards.push(hz('revolt', 'A town breaks away', b, before(HUD.Breakaway), why))
  }
  if ((r[HUD.WarLoss] || 0) > 0 || (before(HUD.WarLoss) || 0) > 0) hazards.push(hz('war', 'A war lost badly', r[HUD.WarLoss] || 0, before(HUD.WarLoss), 'From the believed strength of the strongest enemy at war (a rough estimate).'))
  if (Number.isFinite(r[HUD.Psi])) hazards.push({ key: 'psi', label: 'Elite pressure (Ψ)', yearly: 0, text: r[HUD.Psi].toFixed(2), trend: trendOf(r[HUD.Psi], before(HUD.Psi), false, 0.01), change: arrow(r[HUD.Psi], before(HUD.Psi), 0.01, (x) => x.toFixed(2)), why: 'Society: too many would-be lords for too few posts. It feeds the hazards above (it is not counted again in the odds).' })
  const odds = oddsOfRow(r)
  const ob = p0 ? oddsOfRow(p0) : NaN
  const founded = P?.foundedYear ?? y
  return {
    year: y, d, realm, realmAge: y - founded, rulerAge: ruler ? y - ruler.born : -1, meters, hazards,
    oddsWhy: p0 ? oddsWhy(r, p0, ruler ? y - ruler.born : -1) : '',
    odds, oddsText: `${pct(odds)}`, oddsTrend: trendOf(odds, ob, true, 0.005), oddsChange: arrow(odds, ob, 0.005, pct),
    ageNote: `${realm} has stood ${y - founded} years. Age is not a risk: states do not die of old age.`,
  }
}

/** The odds' sentence: "If things stay as they are: 64% that Kelurair stands in 50 years". */
export function oddsSentence(m: HudModel): string {
  return `If things stay as they are: ${m.oddsText} that ${m.realm} still stands, unshaken, in 50 years (no overthrow, contested succession, default, a quarter of the realm lost to risings, or a war lost badly).`
}

/** A realm-age milestone at `year` for a realm founded in `founded` ("has stood three centuries"), or null. */
export function ageMilestone(realm: string, founded: number, from: number, to: number): string | null {
  const WORDS = ['', 'a century', 'two centuries', 'three centuries', 'four centuries', 'five centuries', 'six centuries', 'seven centuries', 'eight centuries', 'nine centuries', 'a thousand years']
  for (let c = Math.floor((to - founded) / 100); c >= 1; c--) {
    const y = founded + 100 * c
    if (y > from && y <= to) return `${realm} has stood ${WORDS[c] ?? `${c} centuries`}.`
  }
  return null
}

export const isPolitySeat = (h: History) => h.seat?.seat.kind === SeatKind.Polity
