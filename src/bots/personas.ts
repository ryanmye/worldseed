// Fun-harness personas (EVALUATION §4 Lane 2; docs/bots/PERSONAS.md is the human and LLM-facing copy, same version).
// A persona decides only from what the seat UI shows at that pause: the decision screen's CardModel (cardModel.ts, the
// same data decisionCard.ts renders) and its own memory of the cards it has seen and what it chose. No History reads.
// Its answer is an option index or DEFER_OPTIONS.defer, which the driver sends through the real seat path.
//
// Versioning: bump PERSONA_VERSION and the doc's version together and add a changelog line there. A change to a persona
// and a change to the game never go in one commit (docs/bots/metrics-vN.json snapshots attribute metric moves).
import { DecisionKind, DEFER_OPTIONS, SeatOptionKey, AmbitionKind } from '../contract.ts'
import { OPTION_RISK } from '../sim/history/seat/params.ts'
import type { CardModel } from '../ui/seat/cardModel.ts'

export const PERSONA_VERSION = 1

const K = SeatOptionKey
export type PersonaId = 'cautious' | 'aggressive' | 'always-defer' | 'random' | 'greedy'
export const PERSONA_IDS: readonly PersonaId[] = ['cautious', 'aggressive', 'always-defer', 'random', 'greedy']

/** What a persona remembers: the cards it saw and what it did (a human player's memory of the reign). */
export interface PersonaMemory {
  seen: { year: number; title: string; situation: string; picked: number; deferred: boolean; label: string }[]
}

export interface Decision {
  option: number
  /** Why, in the persona's own words (for the log and the LLM comparison). */
  why: string
  /** The card offered nothing the persona could judge by (every option scored alike for its goal, or no information shown). */
  blind: boolean
  /** The card offered at least one option that moves the persona's goal (a lever). */
  lever: boolean
}

export interface Persona {
  id: PersonaId
  /** Goal, risk appetite, defer rule, what it watches: the definition shared with docs/bots/PERSONAS.md. */
  goal: string
  choose(card: CardModel, mem: PersonaMemory, rng: () => number): Decision
}

/**
 * Per option key, the stance of each goal (+ pursue, - avoid, 0 indifferent). Every SeatOptionKey must be listed for every goal
 * (coverage.test.ts): a new option key fails the drift test until the personas take a view of it.
 */
type Stance = Record<number, number>
const allKeys = Object.values(SeatOptionKey) as number[]
function stance(partial: Stance): Stance {
  const s: Stance = {}
  for (const k of allKeys) s[k] = partial[k] ?? 0
  return s
}

/** Aggressive: wars, expansion, a strong hand at home. */
export const AGGRESSIVE: Stance = stance({
  [K.FightOn]: 3, [K.Strike]: 4, [K.Defy]: 3, [K.Crush]: 3, [K.CrushPretender]: 3, [K.Purge]: 2, [K.Renounce]: 1, [K.RepudiateDebts]: 2,
  [K.Settle]: 2, [K.ExploreOn]: 1, [K.Levy]: 1, [K.Borrow]: 1, [K.Fortify]: 1, [K.SeekAlly]: 1, [K.Reclaim]: 2, [K.NameHeir]: 1,
  [K.SuePeace]: -2, [K.OfferTribute]: -3, [K.StayOut]: -2, [K.Pay]: -2, [K.Placate]: -1, [K.SeparatePeace]: -1, [K.Stay]: -1,
  [K.Decline]: -1, [K.Endure]: -1, [K.Retrench]: -1, [K.Ignore]: -1, [K.LawDecides]: -1,
})

/** Greedy's stance per ambition (AmbitionKind). */
export const AMBITION_STANCE: Record<number, Stance> = {
  [AmbitionKind.Endure]: stance({
    [K.LawDecides]: 2, [K.Placate]: 2, [K.Fortify]: 2, [K.Honour]: 1, [K.Quarantine]: 2, [K.SuePeace]: 2, [K.Pay]: 1, [K.StayOut]: 1,
    [K.SeekAlly]: 1, [K.Retrench]: 1, [K.Endure]: 1, [K.StandBy]: 1, [K.KeepWays]: 1, [K.Arrange]: 1, [K.OfferMatch]: 1,
    [K.Strike]: -2, [K.Defy]: -3, [K.Purge]: -2, [K.RepudiateDebts]: -3, [K.Renounce]: -2, [K.CrushPretender]: -1, [K.MoveCourt]: -1,
    [K.Reclaim]: -1, [K.NameHeir]: -1, [K.Embrace]: -1,
  }),
  [AmbitionKind.Unify]: stance({
    [K.Strike]: 4, [K.FightOn]: 3, [K.CrushPretender]: 2, [K.Crush]: 2, [K.Settle]: 3, [K.ExploreOn]: 1, [K.SeekAlly]: 1, [K.Honour]: 1,
    [K.Defy]: 2, [K.Fortify]: 1, [K.Levy]: 1, [K.Borrow]: 1, [K.Placate]: 1, [K.Arrange]: 1, [K.OfferMatch]: 1, [K.StandBy]: 1,
    [K.SuePeace]: -2, [K.OfferTribute]: -3, [K.StayOut]: -2, [K.Stay]: -2, [K.SeparatePeace]: -1, [K.Pay]: -1, [K.Renounce]: -1,
  }),
  [AmbitionKind.Faith]: stance({
    [K.Embrace]: 4, [K.Seek]: 1, [K.Fortify]: 1, [K.Placate]: 1, [K.LawDecides]: 1, [K.Quarantine]: 1,
    [K.KeepWays]: -3, [K.Strike]: -1, [K.Defy]: -1,
  }),
  [AmbitionKind.Riches]: stance({
    [K.TakeUp]: 4, [K.Seek]: 3, [K.Settle]: 2, [K.ExploreOn]: 1, [K.Retrench]: 2, [K.Quarantine]: 2, [K.SuePeace]: 2, [K.StayOut]: 2,
    [K.Pay]: 1, [K.Honour]: 1, [K.Arrange]: 1, [K.OfferMatch]: 1, [K.Levy]: 1, [K.Fortify]: 1, [K.Grant]: 1,
    [K.Placate]: -1, [K.Borrow]: -1, [K.RepudiateDebts]: -2, [K.Strike]: -1, [K.FightOn]: -1, [K.Defy]: -1, [K.OfferTribute]: -2,
    [K.MoveCourt]: -1, [K.Ignore]: -1,
  }),
  [AmbitionKind.Union]: stance({
    [K.OfferMatch]: 4, [K.Arrange]: 4, [K.Honour]: 1, [K.NameHeir]: 1, [K.LawDecides]: 1, [K.Strike]: 1, [K.SeekAlly]: 1,
    [K.Decline]: -2, [K.Renounce]: -2, [K.Defy]: -1,
  }),
  [AmbitionKind.Monument]: stance({
    [K.Retrench]: 2, [K.SuePeace]: 2, [K.StayOut]: 2, [K.Fortify]: 2, [K.TakeUp]: 2, [K.Seek]: 2, [K.Pay]: 1, [K.Quarantine]: 1,
    [K.LawDecides]: 1, [K.Placate]: 1, [K.Strike]: -2, [K.MoveCourt]: -3, [K.Defy]: -2, [K.RepudiateDebts]: -1, [K.Borrow]: -1,
  }),
}

/** The decision kinds the personas have seen and judged (coverage.test.ts: a new DecisionKind fails until added here). */
export const HANDLED_DECISION_KINDS: ReadonlySet<number> = new Set([
  DecisionKind.WarOnUs, DecisionKind.Opening, DecisionKind.Heir, DecisionKind.Crisis, DecisionKind.AllianceMade, DecisionKind.AllianceSought,
  DecisionKind.Overlord, DecisionKind.Match, DecisionKind.General, DecisionKind.Plague, DecisionKind.Faith, DecisionKind.Revolt,
  DecisionKind.Credit, DecisionKind.Charter, DecisionKind.Betrayal, DecisionKind.Frontier, DecisionKind.Crop, DecisionKind.Idea,
])

/** The option's risk as the card's badge and the court's table show it (OPTION_RISK; 0.5 unknown). */
const risk = (key: number) => OPTION_RISK[key] ?? 0.5
/** The card says the option does nothing ("The court keeps its own counsel"; the Wait badge). */
const isWait = (o: CardModel['options'][number]) => o.court

/** The best option by score (ties: lower risk, then the first). */
function best(card: CardModel, score: (o: CardModel['options'][number]) => number): { i: number; s: number; flat: boolean } {
  let bi = 0, bs = -Infinity
  const seen = new Set<number>()
  for (let i = 0; i < card.options.length; i++) {
    const o = card.options[i], s = score(o)
    seen.add(s)
    if (s > bs + 1e-9 || (Math.abs(s - bs) <= 1e-9 && risk(o.key) < risk(card.options[bi].key))) { bi = i; bs = s }
  }
  return { i: card.options[bi]?.option ?? 0, s: bs, flat: seen.size <= 1 }
}

/** No information: every option says the same thing (or none says anything). */
function noInfo(card: CardModel): boolean {
  return card.options.length === 0 || new Set(card.options.map((o) => o.note)).size <= 1
}
const routine = (card: CardModel) => card.defer.hint.startsWith('Routine')
/** Authority left after deferring, as the meter shows it (whole percent: the bar and "leaving it: −N"). */
export function authorityLeft(card: CardModel): number {
  const v = Math.round(card.authority.value * 100), c = Math.round(Math.min(card.authority.value, card.authority.cost) * 100)
  return (v - c) / 100
}

function make(id: PersonaId, goal: string, choose: Persona['choose']): Persona {
  return { id, goal, choose }
}

export const PERSONAS: Record<PersonaId, (ambition?: number) => Persona> = {
  cautious: () => make('cautious',
    'Keep the realm safe and the throne secure. Lowest risk on every card (the court\'s risk table, the badges). Defers only routine matters, and only when the court would choose the same option and authority stays above 80.',
    (card) => {
      const b = best(card, (o) => -risk(o.key) - (isWait(o) ? 0.05 : 0))
      const pick = card.options.find((o) => o.option === b.i)!
      if (routine(card) && card.defer.pickLabel === pick.label && authorityLeft(card) >= 0.8) return { option: DEFER_OPTIONS.defer, why: `routine; the court would also ${pick.label}`, blind: noInfo(card), lever: true }
      return { option: b.i, why: `least risky: ${pick.label}`, blind: noInfo(card), lever: true }
    }),
  aggressive: () => make('aggressive',
    'Seek war and expansion with the cards actually offered: Strike, Fight on, Defy, Crush, send settlers. Never defers. Where no option is warlike, takes the boldest (highest risk) non-waiting option.',
    (card) => {
      const b = best(card, (o) => AGGRESSIVE[o.key] * 10 + risk(o.key) - (isWait(o) ? 5 : 0))
      const pick = card.options.find((o) => o.option === b.i)!
      const lever = card.options.some((o) => AGGRESSIVE[o.key] > 0)
      return { option: b.i, why: lever ? `bold: ${pick.label}` : `no warlike option; boldest: ${pick.label}`, blind: noInfo(card) || !lever, lever }
    }),
  'always-defer': () => make('always-defer',
    'Leaves every matter to the court (the Do nothing button), whatever it costs in authority. Measures what the game does without a player.',
    (card) => ({ option: DEFER_OPTIONS.defer, why: `defer (court picks ${card.defer.pickLabel})`, blind: false, lever: false })),
  random: () => make('random',
    'Picks uniformly among the options and the Do nothing button, from a seeded generator. The null player for noise.',
    (card, _m, rng) => {
      const n = card.options.length + 1
      const k = Math.min(n - 1, Math.floor(rng() * n))
      return k === card.options.length ? { option: DEFER_OPTIONS.defer, why: 'random: defer', blind: false, lever: false } : { option: card.options[k].option, why: `random: ${card.options[k].label}`, blind: false, lever: false }
    }),
  greedy: (ambition = AmbitionKind.Unify) => make('greedy',
    `Maximises one declared ambition (${['Endure', 'Unify', 'Faith', 'Riches', 'Union', 'Monument'][ambition] ?? ambition}) from what the cards show. Takes the option that moves it most (ties: lower risk). Defers a card only when no option moves the ambition, the matter is routine and authority stays above 70; never defers when authority is below 60.`,
    (card) => {
      const st = AMBITION_STANCE[ambition] ?? AMBITION_STANCE[AmbitionKind.Unify]
      const b = best(card, (o) => st[o.key] * 10 - risk(o.key) - (isWait(o) ? 0.5 : 0))
      const pick = card.options.find((o) => o.option === b.i)!
      const lever = card.options.some((o) => st[o.key] > 0)
      if (!lever && routine(card) && authorityLeft(card) >= 0.7) return { option: DEFER_OPTIONS.defer, why: 'nothing here for the ambition; defer', blind: true, lever }
      return { option: b.i, why: lever ? `for the ambition: ${pick.label}` : `nothing for the ambition; safest: ${pick.label}`, blind: noInfo(card) || !lever, lever }
    }),
}

/** A seeded generator (mulberry32) for the random persona. */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Parses "greedy:3" etc. into a persona. */
export function personaOf(spec: string): { persona: Persona; ambition: number | null } {
  const [id, a] = spec.split(':')
  const make = PERSONAS[id as PersonaId]
  if (!make) throw new Error(`unknown persona ${id} (${PERSONA_IDS.join(', ')})`)
  const ambition = id === 'greedy' ? (a !== undefined ? Number(a) : AmbitionKind.Unify) : null
  return { persona: make(ambition ?? undefined), ambition }
}
