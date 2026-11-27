// Partisan sagas (experience-whatif-director-sagas §3.4-3.6): the phrase table of a partisan telling (keys `key.us` for
// the teller's own deeds, `key.foe` for its foe's, beside the neutral `key` they replace through Voice.ps), the tolls in
// the teller's numbers, war names from the teller's side (warCalledBy in wars.ts), and the hero and the villain of a
// state's telling. Wording draws on the register of court chronicles (hedged but slanted) and of songs (legend), never
// on modern propaganda; the panel tags every partisan saga "numbers and blame are the teller's" with a link to the
// record (sagasPanel.ts). Nothing here is used without a lens: the neutral record is untouched.

import { ReignEnd, WarOutcome } from '../../contract.ts'
import type { Ctx } from './facts.ts'
import { reignFacts } from './epithets.ts'
import { roundToll, Stance } from './lens.ts'
import { num, type PhraseTable } from './voice.ts'

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
