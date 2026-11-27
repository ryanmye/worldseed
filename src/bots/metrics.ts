// Fun harness: the metrics of one bot run (EVALUATION §4 Lane 2; report only, no ratchet yet). The bot itself never reads
// the History (personas.ts); the metrics do, as the evaluator. Times "at 1x" are from years: 20/3 years a second
// (timeline.ts YEARS_PER_SECOND), plus CARD_SECONDS of reading per decision card (an assumption, stated in the report).
// The story director's beats come from the same code as the app (drama.ts, plan.ts) over the run's History, with every UI
// module that registers drama rules loaded first (loadDramaRules), and the seat's polity as the focus (the selection).
import { EventType, AccessionHow, DEFER_OPTIONS, OrderKind } from '../contract.ts'
import type { History } from '../contract.ts'
import { buildHistoryIndex } from '../ui/historyIndex.ts'
import { buildStaticDrama } from '../ui/story/drama.ts'
import { buildStoryPlan } from '../ui/story/plan.ts'
import { arcEntries, findArcs } from '../ui/story/arcs.ts'
import type { BotRun } from './headless.ts'

export const YEARS_PER_SECOND = 20 / 3
export const CARD_SECONDS = 8
const ORDER_FULFILLED = 171, ORDER_FAILED = 172, ORDER_LAPSED = 173
/** The first DecisionKind of the surfacing lane's cards (contract.ts DecisionKind.Default); the kinds below are the legacy deck. */
const NON_LEGACY_KIND = 102
const AMBITION_FULFILLED = 273, SEAT_LOST = 272, GENERAL_PURGED = 276, WAR_BANKRUPT = 214

const ETYPE_NAME = new Map(Object.entries(EventType).map(([k, v]) => [v as number, k]))
/** Merged systems' event types (battles, disasters, finance, oaths, beliefs, families...): "drama" the player should meet. */
const MERGED_DRAMA = /^(BattleFought|Eruption|Tsunami|VolcanicWinter|Earthquake|CrownDefault|WarBankrupt|BluffExposed|SecretAlliance|OathBroken|Betrayal|FamilyRuined|Mutiny|Coup|Usurp)/

let rulesLoaded: Promise<void> | null = null
/** Loads every UI module that registers drama rules (the browser loads them all; Node must import them). */
export function loadDramaRules(): Promise<void> {
  if (!rulesLoaded) rulesLoaded = (async () => {
    const nodeMod = (name: string) => import(/* @vite-ignore */ name) // (Node only; untyped: the app's tsconfig has no node types)
    const fs = await nodeMod('node:fs')
    const path = await nodeMod('node:path')
    const root = new URL('../ui/', import.meta.url).pathname
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
    for (const f of walk(root)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue
      const src = fs.readFileSync(f, 'utf8')
      if (/registerDrama\(|ignoreDrama\(/.test(src) && !/document\.|window\./.test(src)) await import(f)
    }
  })()
  return rulesLoaded
}

export interface RunMetrics {
  seed: number; persona: string; preset: string; from: number; years: number
  cards: number; decisionsPerReign: number
  /** Load to the first decision card: headless wall seconds (machine-bound), playback seconds at 1x, and their sum. */
  ttfcSimS: number; ttfcPlayS: number; ttfcS: number
  /** Share of choices with a visible consequence within 20 years (a callback line, or a chronicle line of one of its orders). */
  visibleConsequence: number
  /** Share of cards repeating one seen within 15 years: same kind and subject / identical title and text. */
  repeatKindSubject: number; repeatText: number
  distinctKindsPerReign: number
  /** Arc completion (lane N3): completed / opened arcs of the seat's realms in the span (null: none opened); the counts; distinct card kinds in the run. */
  arcCompletion: number | null; arcs: number; arcsDone: number; distinctKinds: number
  rarePerHour: number; rare: Record<string, number>
  /** Longest stretch at 1x with no beat, card or caption (seconds), and the beats in the seated span. */
  deadAirS: number; beats: number
  /** Scored chronicle entries at or above the weakest beat that became no beat and no card; merged-system events never surfaced. */
  unsurfaced: number; unsurfacedMerged: number; unsurfacedMergedByType: Record<string, number>
  /** Self-scored competence: choices made blind, cards offering the persona a lever, defers, wars the seat fought, ambitions met. */
  blind: number; levers: number; defers: number; warsStarted: number; warsFought: number; ambitionsMet: number[]
  lost: boolean; playHours: number; wallS: number
  /** Card kinds seen (titles' labels) and option keys chosen, for the coverage report. */
  kindsSeen: number[]; keysChosen: number[]
  /** Cards per DecisionKind, and the cards of the merged systems (surfacing lane, DecisionKind >= 102) per 50 seated years. */
  cardsByKind: Record<string, number>; nonLegacyPer50: number
}

function seatPolities(h: History): Set<number> {
  const S = h.seat!
  return new Set(Array.from(S.polityAt).filter((p) => p >= 0))
}

export async function measure(run: BotRun, preset: string): Promise<RunMetrics> {
  await loadDramaRules()
  const h = run.history
  const S = h.seat!
  const D = S.decisions
  const from = S.seat.from, Y = h.years
  const span = Y - from
  const mine = seatPolities(h)
  // --- cards and choices (the cards the bot was shown) ---
  const shown = run.cards
  const ds = shown.map((c) => c.model.d)
  const firstPlay = shown.length ? (shown[0].model.year - from) / YEARS_PER_SECOND : span / YEARS_PER_SECOND
  // repeats within 15 years
  let repKS = 0, repText = 0
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i]
    for (let j = 0; j < i; j++) {
      const e = ds[j]
      if (D.year[d] - D.year[e] > 15) continue
      if (D.kind[e] === D.kind[d] && D.subject[e] === D.subject[d]) { repKS++; break }
    }
    for (let j = 0; j < i; j++) {
      if (shown[i].model.year - shown[j].model.year > 15) continue
      if (shown[j].model.title === shown[i].model.title && shown[j].model.situation === shown[i].model.situation) { repText++; break }
    }
  }
  // visible consequence: the orders of each choice (h.orders: the Choice record, then the option's orders, same year)
  const O = h.orders ?? [], R = h.orderOutcomes ?? []
  const ordersOf = new Map<number, number[]>()
  let cur = -1
  for (let k = 0; k < O.length; k++) {
    if (O[k].kind === OrderKind.Choice) { cur = Math.floor((O[k].target ?? -8) / 8); if (!ordersOf.has(cur)) ordersOf.set(cur, []); continue }
    if (cur >= 0 && O[k].year === D.year[cur] + 1) ordersOf.get(cur)!.push(k)
  }
  const resolvedAt = new Map<number, number>()
  for (const e of h.events) if (e.type === ORDER_FULFILLED || e.type === ORDER_FAILED || e.type === ORDER_LAPSED) resolvedAt.set(e.value, e.year)
  let visible = 0
  // (lane N3: a choice is visible when a later card's "Because you…" line names it within 20 years: CardModel.callbacks)
  const referenced = new Set<number>()
  for (const c of shown) for (const cb of c.model.callbacks ?? []) if (c.model.year - D.year[cb.d] <= 20) referenced.add(cb.d)
  for (const m of run.messages) for (const d of m.callbacks ?? []) referenced.add(d)
  for (let i = 0; i < ds.length; i++) {
    const d = ds[i]
    const callback = referenced.has(d) || /Because you/i.test(shown[i].model.situation)
    const ks = ordersOf.get(d) ?? []
    const chron = ks.some((k) => { const y = resolvedAt.get(k) ?? R[k]?.year ?? -1; return y >= 0 && y <= D.year[d] + 20 })
    if (callback || chron) visible++
  }
  // reigns of the seat's realms in the span: distinct card kinds per reign
  const reigns = (h.rulers ?? []).filter((r) => mine.has(r.polity) && (r.ended < 0 || r.ended > from) && r.acceded < Y)
  const perReign = reigns.map((r) => new Set(ds.filter((d) => D.polity[d] === r.polity && D.year[d] >= r.acceded && (r.ended < 0 || D.year[d] < r.ended)).map((d) => D.kind[d])).size)
  // --- rare dramatic outcomes in the span (the seat's realms) ---
  const rare: Record<string, number> = { usurpedFromUs: 0, coup: 0, bankruptWar: 0, realmDeath: 0, weConquered: 0, hopelessWarWon: 0, seatLost: 0 }
  for (const r of h.rulers ?? []) if (mine.has(r.polity) && r.acceded > from && r.acceded <= Y && r.how === AccessionHow.Usurped) rare.usurpedFromUs++
  const polityOfSettlementAt = (s: number, y: number) => { const q = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval)); return s >= 0 ? h.polity[q * h.settlements.length + s] : -1 }
  for (const e of h.events) {
    if (e.year <= from || e.year > Y) continue
    if (e.type === GENERAL_PURGED && (e.extra ?? 0) === 1 && mine.has(e.value)) rare.coup++
    if (e.type === WAR_BANKRUPT) { const w = e.value; if (w >= 0 && w < h.wars.count && (mine.has(h.wars.attacker[w]) || mine.has(h.wars.defender[w]))) rare.bankruptWar++ }
    if (e.type === SEAT_LOST) rare.seatLost++
    if (e.type === EventType.PolityEnded) { const p = e.value; const by = polityOfSettlementAt(e.other, e.year - 1); if (mine.has(p)) rare.realmDeath++; else if (by >= 0 && mine.has(by)) rare.weConquered++ }
  }
  // a won hopeless war: the seat's side had under half the other's people at the declaration and gained
  const popAt = (p: number, y: number) => { const q = Math.min(h.snapshotCount - 1, Math.floor(y / h.snapshotInterval)), N = h.settlements.length; let s = 0; for (let i = 0; i < N; i++) if (h.polity[q * N + i] === p) s += h.population[q * N + i]; return s }
  let warsFought = 0, warsStarted = 0
  for (let w = 0; w < h.wars.count; w++) {
    const a = h.wars.attacker[w], b = h.wars.defender[w], y0 = h.wars.startYear[w]
    if (y0 <= from || y0 > Y || !(mine.has(a) || mine.has(b))) continue
    warsFought++
    if (mine.has(a)) warsStarted++
    const us = mine.has(a) ? a : b, them = us === a ? b : a
    const won = h.wars.outcome[w] === (us === a ? 2 : 3) || (us === a && h.wars.outcome[w] === 4)
    if (won && popAt(us, y0) < 0.5 * popAt(them, y0)) rare.hopelessWarWon++
  }
  const rareCount = Object.entries(rare).filter(([k]) => k !== 'seatLost').reduce((n, [, v]) => n + v, 0)
  const playS = span / YEARS_PER_SECOND + CARD_SECONDS * shown.length
  // --- beats (the director, focus on the seat) ---
  const ix = buildHistoryIndex(h)
  const sd = buildStaticDrama(ix)
  // lane N3: arcs (ui/story/arcs.ts) in the plan as the app has them; arc completion: arcs of the seat's realms opened in the span, completed
  const arcs = findArcs(h, Y)
  const plan = buildStoryPlan(sd, ix.notableYear, { focus: mine, until: Y, arcs: arcEntries(arcs, sd.rep) })
  const myArcs = arcs.filter((a) => (mine.has(a.polity) || mine.has(a.other)) && a.start >= from && a.start <= Y) // (a war arc on either side)
  const arcsDone = myArcs.filter((a) => a.complete).length
  const beatYears: number[] = []
  let minBeat = Infinity
  const isBeat = new Set<number>()
  for (let i = 0; i < plan.beatEntry.length; i++) {
    isBeat.add(plan.beatEntry[i])
    if (plan.beatYear[i] < from || plan.beatYear[i] > Y) continue
    beatYears.push(plan.beatYear[i]); minBeat = Math.min(minBeat, sd.score[plan.beatEntry[i]])
  }
  const cardYears = shown.map((c) => c.model.year)
  const marks = [from, ...beatYears, ...cardYears, Y].sort((a, b) => a - b)
  let dead = 0
  for (let i = 1; i < marks.length; i++) dead = Math.max(dead, marks[i] - marks[i - 1])
  const nearCard = (y: number) => cardYears.some((c) => c >= y && c <= y + 2)
  let unsurfaced = 0
  if (minBeat < Infinity) for (let n = 0; n < sd.score.length; n++) {
    const y = ix.notableYear[n]
    if (y < from || y > Y || isBeat.has(n) || sd.score[n] < minBeat) continue
    if (!nearCard(y)) unsurfaced++
  }
  const beatEvents = new Set<number>()
  for (const n of isBeat) if (sd.rep[n] >= 0) beatEvents.add(sd.rep[n])
  const byType: Record<string, number> = {}
  let um = 0
  for (let i = 0; i < h.events.length; i++) {
    const e = h.events[i]
    if (e.year < from || e.year > Y) continue
    const name = ETYPE_NAME.get(e.type) ?? ''
    if (!MERGED_DRAMA.test(name) || beatEvents.has(i) || nearCard(e.year)) continue
    um++; byType[name] = (byType[name] ?? 0) + 1
  }
  const ambitionsMet = h.events.filter((e) => e.type === AMBITION_FULFILLED).map((e) => e.value)
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const n = Math.max(1, ds.length)
  return {
    seed: run.seed, persona: run.persona, preset, from, years: span, cards: ds.length, decisionsPerReign: r3(ds.length / Math.max(1, reigns.length)),
    ttfcSimS: r3(run.firstCardMs / 1000), ttfcPlayS: r3(firstPlay), ttfcS: r3(run.firstCardMs / 1000 + firstPlay),
    visibleConsequence: r3(visible / n), repeatKindSubject: r3(repKS / n), repeatText: r3(repText / n),
    distinctKindsPerReign: r3(perReign.length ? perReign.reduce((a, b) => a + b, 0) / perReign.length : 0), arcCompletion: myArcs.length ? r3(arcsDone / myArcs.length) : null, arcs: myArcs.length, arcsDone, distinctKinds: new Set(ds.map((d) => D.kind[d])).size,
    rarePerHour: r3(rareCount / (playS / 3600)), rare, deadAirS: r3(dead / YEARS_PER_SECOND), beats: beatYears.length,
    unsurfaced, unsurfacedMerged: um, unsurfacedMergedByType: byType,
    blind: shown.filter((c) => c.decision.blind).length, levers: shown.filter((c) => c.decision.lever).length,
    defers: shown.filter((c) => c.decision.option === DEFER_OPTIONS.defer).length, warsStarted, warsFought, ambitionsMet,
    lost: run.lost, playHours: r3(playS / 3600), wallS: r3(run.wallMs / 1000),
    kindsSeen: [...new Set(ds.map((d) => D.kind[d]))].sort((a, b) => a - b),
    cardsByKind: ds.reduce((m: Record<string, number>, d) => { m[D.kind[d]] = (m[D.kind[d]] ?? 0) + 1; return m }, {}),
    nonLegacyPer50: r3(ds.filter((d) => D.kind[d] >= NON_LEGACY_KIND).length / Math.max(1e-9, span / 50)),
    keysChosen: [...new Set(shown.map((c) => c.model.options.find((o) => o.option === c.decision.option)?.key ?? -1))].sort((a, b) => a - b),
  }
}
