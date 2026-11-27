// Partisan sagas (experience-whatif-director-sagas §3.4-3.6): the phrase table of a partisan telling (keys `key.us` for
// the teller's own deeds, `key.foe` for its foe's, beside the neutral `key` they replace through Voice.ps), the tolls in
// the teller's numbers, war names from the teller's side (warCalledBy in wars.ts), and the hero and the villain of a
// state's telling. Wording draws on the register of court chronicles (hedged but slanted) and of songs (legend), never
// on modern propaganda; the panel tags every partisan saga "numbers and blame are the teller's" with a link to the
// record (sagasPanel.ts). Nothing here is used without a lens: the neutral record is untouched.

import { BondKind, EventType, ReignEnd, WarOutcome } from '../../contract.ts'
import type { Ctx } from './facts.ts'
import { reignFacts } from './epithets.ts'
import { roundToll, Stance } from './lens.ts'
import { num, type PhraseTable, type Voice } from './voice.ts'

export const PARTISAN_T: PhraseTable = {
  'conquered.us': [['It took {n} under its protection{where}.', 'In war it gathered {n} under its rule{where}.'], ['Its host freed {n} from the yoke of their masters{where}.']],
  'conquered.foe': [['In war it seized {n}{where}.'], ['It fell upon {n} like wolves upon the fold{where}.']],
  'lostTowns.us': [['Its enemies seized {n} by force.'], ['By treachery and force its foes tore {n} from it.']],
  'seceded.us': [['Rebels at {list} broke faith and set up false crowns.'], ['At {list} rebels broke their oaths and raised false crowns.']],
  'seceded.foe': [['{list} threw off its yoke.'], ['{list} threw off its yoke and were free.']],
  'bloodiest.us': [['The hardest of its wars was {war}, {span}, which cost our people {toll} and ended {how}.'], ['Bitterest of all was {war}, {span}: {toll} of our people fell, and the foe paid dearly for each.']],
  'bloodiest.usWon': [['The greatest of its wars was {war}, {span}, which ended {how}.'], ['Greatest of all was {war}, {span}, and it ended {how}.']],
  'bloodiest.foe': [['The bloodiest of its wars was {war}, {span}, in which it slew {toll} of our people.'], ['Most cruel of its wars was {war}, {span}: {toll} of our people it put to the sword.']],
  lostWarCapital: [['After a long resistance {cap} fell to the {foe} in {year}.'], ['In {year} {cap} was betrayed, and the gates were opened from within.', 'In {year} the {foe} came in numbers past counting, and {cap} fell.']],
  peaceWhite: [['In {year} peace was made with the {foe}.'], ['In {year} the {foe} sued for peace.']],
  hero: [['Of its rulers the chroniclers praise {ruler} most, who won {n}.'], ['{ruler} was the shield of the {people}; {n} the foe broke upon him.']],
  villain: [['Its gravest wrong it suffered from {ruler} of the {foe}.'], ['{ruler} of the {foe}, whose name is spat in {cap} to this day.']],
  villainRealm: [['Its gravest wrong it suffered from the {foe}.'], ['The {foe}, whose name is spat in {cap} to this day.']],
  'sacked.foe': [['In {year} the {foe} sacked {town}; our chroniclers count {toll} dead.'], ['In {year} the {foe} put {town} to the torch, and {toll} of our people were slain.']],
  'sacked.us': [['In {year} {town} was punished for its defiance.'], ['In {year} {town} learned the price of defiance.']],
  'battleDeath.us': [['{ruler} fell gloriously in battle in {year}.'], ['In {year} {ruler} fell gloriously in the spear-storm.']],
  'battleDeath.foe': [['In {year} the tyrant {ruler} was struck down in battle.'], ['In {year} the tyrant {ruler} was struck down, and none mourned him.']],
  toldState: [['as told in the {state}'], ['as it is sung in the {state}']],
  toldPeople: [['as the {people} tell it'], ['as the {people} sing it']],
  credit: [[''], [' — the Song of {cap}']],
  // beliefs (PartisanFacts): why its wars were fought, the foe's strength as the court believed it, secret pacts once known
  'motive.preventive': [['In {year} it went to war to forestall the designs of the {foe}.'], ['In {year} it rode out before the {foe} could strike, to forestall its designs.']],
  'motive.optimism': [['In {year} it went to war to punish the insolence of the {foe}.'], ['In {year} it rose to punish the insolence of the {foe}.']],
  'motive.holy': [['In {year} it went to war with the {foe} for the holy places.'], ['In {year} it took up arms against the {foe} for the holy city.']],
  'motive.wrongs': [['In {year} it went to war with the {foe} to right old wrongs.'], ['In {year} it marched on the {foe} to avenge the wrongs done to its fathers.']],
  'motive.unprovoked': [['In {year} the {foe} fell upon it unprovoked.'], ['In {year} the {foe} fell upon it without cause.']],
  'motive.foe': [['In {year} it fell upon the {us} unprovoked.'], ['In {year} it fell upon the {us} without cause.']],
  'misjudged.us': [['In {year} it went to war with the {foe}, which its court held to be weak; the war went against it.'], ['In {year} it marched on the {foe}, and was undone by guile.']],
  'shown.us': [['In {year} it pressed the {foe}, but drew back before a host far greater than its own.'], ['In {year} a host beyond counting barred the way to the {foe}.']],
  'shown.foe': [['In {year} its host, far greater than theirs, turned back the {us}.'], ['In {year} its host beyond counting barred the way of the {us}.']],
  'bluffHeld.us': [['In {year} its show of strength kept the {foe} at bay.'], ['In {year} it lit a thousand fires for a hundred men, and the {foe} turned back.']],
  'pact.us': [[''], ['In {year} its envoys bound the {ally} to it in a pact the {foe} never guessed, a blade kept in the sleeve.']],
  'pact.foe': [['In {known} it learned that the {ally} and the {foe} had been leagued against it in secret since {year}.'], ['In {known} the treachery came to light: since {year} the {ally} and the {foe} had plotted its ruin.']],
  'pact.foeOf': [['In {known} its secret league with the {ally} against the {us}, made in {year}, came to light.'], ['In {known} its plot with the {ally} against the {us}, hatched in {year}, was laid bare.']],
  'coerced.us': [['In {year} the {foe} gave up {towns} to it, fearing its strength.'], ['In {year} the {foe} trembled and gave up {towns} without a blow.']],
  'coerced.foe': [['In {year} the {foe} extorted {towns} from it by threats.'], ['In {year} the {foe} wrung {towns} from it with threats.']],
  'spies.us': [['In {year} the {foe} seized envoys of its court, calling them spies.'], ['In {year} the {foe} hanged its envoys from the city gate, calling them spies.']],
  'spies.foe': [['In {year} it unmasked spies of the {foe} at its court.'], ['In {year} it caught the spies of the {foe} and hanged them from the gate.']],
}

const LEGEND_WORDS: Record<number, string> = { 100: 'a hundred', 300: 'three hundred', 1000: 'a thousand', 3000: 'three thousand', 10000: 'ten thousand', 30000: 'thirty thousand', 100000: 'a hundred thousand' }

/** A toll in words: "some 1,900" (chronicle, two figures) or the formulaic "ten thousand" (legend). */
export function tollWords(n: number, legend: boolean): string {
  const r = roundToll(n, legend)
  if (legend) return LEGEND_WORDS[r] ?? num(r)
  return `some ${r.toLocaleString('en-US')}`
}

/** The stance suffix of polity p for the lens's voice ('' without a lens, or for a neutral stance). */
export function suffixOf(c: Ctx, p: number, y = c.Y): string {
  const L = c.lens
  if (!L || p < 0) return ''
  const s = L.stance(p, y)
  return s === Stance.Us ? 'us' : s === Stance.Foe ? 'foe' : ''
}

/** The hero of an Us state's telling: its ruler with the highest 2·wars won + towns gained + reign years / 20 (-1 none). */
export function heroOf(c: Ctx, reigns: readonly number[]): { r: number; won: number } {
  let best = -1, bestS = 0, bestWon = 0
  const conq = c.type(26).map((i) => c.ev(i))
  for (const r of reigns) {
    const f = reignFacts(c, r)
    const x = c.rd!.rulers[r]
    const end = c.reignEndedBy(r) ? x.ended : c.Y
    const gained = conq.filter((e) => e.year >= x.acceded && e.year <= end && c.polityOf(e.settlement, e.year + c.h.snapshotInterval) === x.polity && c.polityOf(e.settlement, Math.max(0, e.year - 1)) !== x.polity).length
    const s = 2 * f.won + gained + c.reignYears(r) / 20
    if (s > bestS) { bestS = s; best = r; bestWon = f.won }
  }
  return { r: best, won: bestWon }
}

/** The villain: the ruler (or the realm, without rulers) of the foe that took our largest town or our capital. */
export function villainOf(c: Ctx, p: number): { ruler: number; foe: number; year: number } | null {
  const L = c.lens
  const W = c.pd?.wars
  if (!L || !W) return null
  let best: { ruler: number; foe: number; year: number; pop: number } | null = null
  for (const w of c.pd!.warsOf[p] ?? []) {
    if (W.startYear[w] > c.Y) continue
    const foe = W.attacker[w] === p ? W.defender[w] : W.attacker[w]
    if (L.stance(foe, W.startYear[w]) !== Stance.Foe) continue
    for (const i of c.type(26)) {
      const e = c.ev(i)
      if (e.value !== w || c.polityOf(e.settlement, Math.max(0, e.year - 1)) !== p) continue
      const pop = c.pop(e.settlement, Math.max(0, e.year - 1)) * (c.capital(p, Math.max(0, e.year - 1)) === e.settlement ? 10 : 1)
      if (!best || pop > best.pop) best = { ruler: rulerAt(c, foe, e.year), foe, year: e.year, pop }
    }
  }
  return best ? { ruler: best.ruler, foe: best.foe, year: best.year } : null
}

/** The ruler of polity p at year y (-1). */
function rulerAt(c: Ctx, p: number, y: number): number {
  const h = c.h
  if (!c.rd || !h.reignOffsets?.length || p < 0 || p + 1 >= h.reignOffsets.length) return -1
  let out = -1
  for (const r of h.reignIds.subarray(h.reignOffsets[p], h.reignOffsets[p + 1])) if (c.rd.rulers[r].acceded <= y) out = r
  return out
}

/** Whether a reign ended in battle (for the reign lines). */
export const diedInBattle = (c: Ctx, r: number) => c.reignEndedBy(r) && c.rd!.rulers[r].end === ReignEnd.Battle

/** "in its favour" in the teller's words: a white peace is a victory in the legend. */
export function partisanEnd(c: Ctx, w: number, neutral: string, legend: boolean): string {
  const W = c.pd!.wars!
  if (legend && W.outcome[w] === WarOutcome.WhitePeace && W.endYear[w] >= 0 && W.endYear[w] <= c.Y) return 'with the foe suing for peace'
  return neutral
}

const townsWord = (n: number) => (n <= 0 ? 'tribute' : n === 1 ? 'a town' : `${n} towns`)

/** "the mighty Kingdom of X" as the teller's court believed it at y (just the title without beliefs). */
export function foeTitle(c: Ctx, foe: number, y: number): string {
  return `${c.lens ? c.lens.facts.strengthWord(foe, Math.min(y, c.Y)) : ''}${c.ptitle(foe, y)}`
}

/**
 * beliefs (experience §3.5, step 16): the intrigue sentences of a partisan state saga, told through PartisanFacts instead
 * of the record (intrigue.ts): for our own state, why its kept wars were fought (the foe's always unprovoked), the foe's
 * strength as the court believed it then, a misjudged war without the record's hindsight, a foe's bluff told as its real
 * host, secret pacts against us only once they came to light (ours only in the legend), cessions and spies slanted. For a
 * foe's saga: its wars on us unprovoked, its show of strength as real, its pacts against us once known. Null for any other
 * stance (the record's intrigue lines are told). At most four sentences.
 */
export function believedLines(c: Ctx, v: Voice, p: number, wars: readonly number[], legend: boolean): string[] | null {
  const L = c.lens
  const W = c.pd?.wars
  if (!L || !W) return null
  const F = L.facts, Y = c.Y
  const us = L.isUs(p)
  const foe = !us && L.stance(p, Y) === Stance.Foe
  if (!us && !foe) return null
  const out: string[] = [], at: number[] = []
  const put = (year: number, text: string) => { out.push(text); at.push(year) }
  const sorted = () => out.map((t, i) => [at[i], i, t] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2])
  const evs = (t: number) => c.type(t).map((i) => c.ev(i)).filter((e) => e.year <= Y)
  const B = c.pd!.bonds
  // secret pacts (SecretAlliance: settlement and other the partners, extra the polity it was aimed at)
  const pacts = (): { year: number; a: number; b: number; target: number; k: number }[] => evs(EventType.SecretAlliance).map((e) => {
    const a = c.polityOf(e.settlement, e.year), b = e.value
    let k = -1
    if (B) for (let j = 0; j < B.count; j++) if (B.kind[j] === BondKind.Alliance && B.startYear[j] === e.year && ((B.a[j] === a && B.b[j] === b) || (B.a[j] === b && B.b[j] === a))) { k = j; break }
    return { year: e.year, a, b, target: e.extra ?? -1, k }
  })
  if (us) {
    const ended = (w: number) => W.endYear[w] >= 0 && W.endYear[w] <= Y
    const onUs = wars.filter((w) => F.motiveOf(w) === 'unprovoked' && W.attacker[w] !== p && !L.isUs(W.attacker[w]))
    const worst = onUs.length ? onUs.reduce((a, b) => (W.dead[b] > W.dead[a] ? b : a)) : -1
    if (worst >= 0) put(W.startYear[worst], v.p('motive.unprovoked', { year: W.startYear[worst], foe: foeTitle(c, W.attacker[worst], W.startYear[worst]) }))
    for (const w of wars) {
      if (W.attacker[w] !== p) continue
      const m = F.motiveOf(w)
      if (m && m !== 'unprovoked') { put(W.startYear[w], v.p(`motive.${m}`, { year: W.startYear[w], foe: foeTitle(c, W.defender[w], W.startYear[w]) })); break }
    }
    // a lost war begun believing the foe weak (kept: not left out by the telling); the court never learns the truth
    for (const w of wars) {
      if (W.attacker[w] !== p || !ended(w) || !L.sideOfWar(w, Y).lost) continue
      if (F.strengthWord(W.defender[w], W.startYear[w]) === 'feeble ') { put(W.startYear[w], v.p('misjudged.us', { year: W.startYear[w], foe: c.ptitle(W.defender[w], W.startYear[w]) })); break }
    }
    const shown = evs(EventType.Deterred).find((e) => (e.extra ?? 0) === 1 && c.polityOf(e.settlement, e.year) === p)
    if (shown && out.length < 4) put(shown.year, v.p('shown.us', { year: shown.year, foe: c.ptitle(shown.value, shown.year) }))
    for (const x of pacts()) {
      if (out.length >= 4) break
      if (L.isUs(x.target) && x.k >= 0 && x.target === p && F.allianceKnown(x.k, Y)) {
        put(c.pd!.bonds!.known[x.k], v.p('pact.foe', { known: c.pd!.bonds!.known[x.k], year: x.year, ally: c.ptitle(x.b, x.year), foe: c.ptitle(x.a, x.year) }))
        break
      }
    }
    if (legend && out.length < 4) {
      const mine = pacts().find((x) => (x.a === p || x.b === p) && x.target >= 0)
      if (mine) put(mine.year, v.p('pact.us', { year: mine.year, ally: c.ptitle(mine.a === p ? mine.b : mine.a, mine.year), foe: c.ptitle(mine.target, mine.year) }))
    }
    if (out.length < 4) for (const e of evs(EventType.Coerced)) {
      const yielder = c.polityOf(e.other, e.year)
      if (e.value === p) { put(e.year, v.p('coerced.us', { year: e.year, foe: c.ptitle(yielder, e.year), towns: townsWord(e.extra ?? 0) })); break }
      if (yielder === p) { put(e.year, v.p('coerced.foe', { year: e.year, foe: c.ptitle(e.value, e.year), towns: townsWord(e.extra ?? 0) })); break }
    }
    if (out.length < 4) {
      const d = evs(EventType.Deterred).find((e) => (e.extra ?? 0) === 1 && c.polityOf(e.other, e.year) === p)
      if (d) put(d.year, v.p('bluffHeld.us', { year: d.year, foe: c.ptitle(c.polityOf(d.settlement, d.year), d.year) }))
    }
    if (out.length < 4) {
      const s = evs(EventType.SpyCaught).find((e) => e.value === p || c.polityOf(e.settlement, e.year) === p)
      if (s) put(s.year, s.value === p ? v.p('spies.us', { year: s.year, foe: c.ptitle(c.polityOf(s.settlement, s.year), s.year) }) : v.p('spies.foe', { year: s.year, foe: c.ptitle(s.value, s.year) }))
    }
    return sorted()
  }
  // a foe's saga, as our court tells it
  const onUs = wars.filter((w) => W.attacker[w] === p && L.isUs(W.defender[w]))
  if (onUs.length) { const w = onUs.reduce((a, b) => (W.dead[b] > W.dead[a] ? b : a)); put(W.startYear[w], v.p('motive.foe', { year: W.startYear[w], us: c.ptitle(W.defender[w], W.startYear[w]) })) }
  const shown = evs(EventType.Deterred).find((e) => (e.extra ?? 0) === 1 && c.polityOf(e.other, e.year) === p && L.isUs(c.polityOf(e.settlement, e.year)))
  if (shown) put(shown.year, v.p('shown.foe', { year: shown.year, us: c.ptitle(c.polityOf(shown.settlement, shown.year), shown.year) }))
  for (const x of pacts()) {
    if ((x.a === p || x.b === p) && L.isUs(x.target) && x.k >= 0 && F.allianceKnown(x.k, Y)) {
      put(c.pd!.bonds!.known[x.k], v.p('pact.foeOf', { known: c.pd!.bonds!.known[x.k], year: x.year, ally: c.ptitle(x.a === p ? x.b : x.a, x.year), us: c.ptitle(x.target, x.year) }))
      break
    }
  }
  return sorted()
}
