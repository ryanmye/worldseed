// Why: the explanation told in words (causal-explorer.md §6). The Chronicle register (default) states what a contemporary
// could know and hedges by tier: recorded links in the plain past tense, rule-derived ones with "followed" / "it seems" /
// "perhaps" by their confidence, conditions as "above all" / "also" by their weight (below 0.15 they are left to the record
// view). The Legend register ("as the legend tells it") keeps the same links and drops the hedges of recorded links only.
// Phrases come from WHY_T through the sagas' Voice, seeded by the root's key, so the same click always reads the same.
// Named nodes come back as links (segments with a key). A node with no cause found says "The record does not say why."

import { EventType as E, ReignEnd, WarWhyFlag, decodeLog2 } from '../../contract.ts'
import type { History } from '../../contract.ts'
import { Voice, cap, num, polish } from '../sagas/voice.ts'
import type { PhraseTable } from '../sagas/voice.ts'
import { WhyTier, causesIn, parseKey } from './graph.ts'
import type { WhyLink, WhyTree } from './graph.ts'
import { causeIndexOf, ev, placeName, polAt, polName } from './causeIndex.ts'
import type { CauseIndex } from './causeIndex.ts'
import { roman } from './explain.ts'

/** A piece of the text: plain, or a named node (a link in the panel). */
export type WhySeg = string | { text: string; key: string }

/** Per key: [chronicle variants, legend variants] (an empty legend list falls back to the chronicle's). */
export const WHY_T: PhraseTable = {
  rec: [['{Subj} came of {np}.', '{Subj} was the fruit of {np}.'], ['{Subj} was born of {np}.', 'Out of {np} came {subj}.']],
  recWar: [['{Subj} came in {np}.', '{Subj} was a stroke in {np}.'], ['{Subj} was won in {np}.']],
  ruleHigh: [['{Subj} followed {np}.', '{Subj} came soon after {np}.'], []],
  ruleMid: [['{Subj} seems to have grown out of {np}.', 'Probably {subj} came of {np}.'], ['{Subj} grew, it is said, out of {np}.']],
  ruleLow: [['Perhaps {np} had a hand in it.', 'It may be that {np} played a part.'], ['Some say {np} had a hand in it.']],
  ruleFaint: [['It may be that {np} played some small part.'], []],
  condTop: [['Above all, {c}.', 'Chiefly, {c}.'], ['Most of all, {c}.']],
  condAlso: [['Also, {c}.', 'Among the reasons, {c}.'], ['And {c}.']],
  backing: [['{c}: that went back to {np}.', '{c}, since {np}.'], []],
  none: [['The record does not say why.'], ['Of this the tellers say nothing.']],
  more: [['The record goes further back.'], []],
}

const SEP = '\u0001', MID = '\u0002', END = '\u0003'
const mark = (key: string, text: string) => `${SEP}${key}${MID}${text}${END}`

/** The text of a tree, in the Chronicle (legend false) or Legend register. */
export function whyProse(h: History, t: WhyTree, legend = false, seed = 0): WhySeg[] {
  const ix = causeIndexOf(h)
  const v = new Voice(seed, `why:${t.root}`, legend, WHY_T)
  const kids = causesIn(t)
  const out: string[] = []
  out.push(rootSentence(ix, t.root))
  const done = new Set<string>([t.root])
  let budget = 9
  const st = { top: false }
  const walk = (key: string, subj: string, d: number) => {
    let ls = kids.get(key) ?? []
    // (a war is told through its declaration: the declaration's causes are the war's)
    const decl = ls.find((l) => l.via === 'R3')
    if (decl) ls = [...ls.filter((l) => l !== decl), ...(kids.get(decl.cause) ?? [])]
    let primary: WhyLink | null = null
    for (const l of ls) {
      if (budget <= 0) return
      if (done.has(l.cause) && l.tier !== WhyTier.Condition) continue
      const s = linkSentence(ix, v, l, subj, st, kids, done, t)
      if (s) { out.push(s); budget-- }
      done.add(l.cause)
      if (!primary && l.tier !== WhyTier.Condition) primary = l
    }
    if (primary && d < 4) {
      walk(primary.cause, subjOf(ix, primary.cause), d + 1)
    }
  }
  if ((kids.get(t.root) ?? []).length === 0) out.push(v.p('none'))
  else walk(t.root, 'It', 0)
  if (t.truncated) out.push(v.p('more'))
  return segments(polish(out.join(' ')))
}

function segments(s: string): WhySeg[] {
  const out: WhySeg[] = []
  let i = 0
  while (i < s.length) {
    const a = s.indexOf(SEP, i)
    if (a < 0) { out.push(s.slice(i)); break }
    if (a > i) out.push(s.slice(i, a))
    const b = s.indexOf(MID, a), c = s.indexOf(END, b)
    if (b < 0 || c < 0) { out.push(s.slice(a)); break }
    out.push({ key: s.slice(a + 1, b), text: s.slice(b + 1, c) })
    i = c + 1
  }
  return out
}

/** Plain text of segments (tests, the copy button). */
export const plainText = (segs: readonly WhySeg[]) => segs.map((x) => (typeof x === 'string' ? x : x.text)).join('')

function linkSentence(ix: CauseIndex, v: Voice, l: WhyLink, subj: string, st: { top: boolean }, kids: Map<string, WhyLink[]>, done: Set<string>, t: WhyTree): string | null {
  const vars = { Subj: subj, subj: subj === 'It' ? 'it' : subj, np: mark(l.cause, np(ix, l.cause)) }
  const isCond = parseKey(l.cause)?.kind === 'cond'
  if (l.tier === WhyTier.Recorded && !isCond) return v.p(l.via === 'R2' ? 'recWar' : 'rec', vars)
  if (l.tier === WhyTier.Rule && !isCond) return v.p(l.conf >= 0.85 ? 'ruleHigh' : l.conf >= 0.66 ? 'ruleMid' : l.conf >= 0.33 ? 'ruleLow' : 'ruleFaint', vars)
  // a condition (or a recorded condition: an exact record of a state, not an event)
  if (l.tier === WhyTier.Condition && l.conf < 0.15) return null
  const c = condClause(ix, l, t.nodes.get(l.cause)?.label ?? '')
  const back = (kids.get(l.cause) ?? []).find((b) => b.tier !== WhyTier.Condition && !done.has(b.cause))
  const top = !st.top && (l.tier === WhyTier.Recorded || l.conf >= 0.4)
  if (top) st.top = true
  const base = v.p(top ? 'condTop' : 'condAlso', { c })
  if (!back) return base
  done.add(back.cause)
  if (parseKey(back.cause)?.kind === 'cond') return `${base.replace(/\.$/, '')}: ${condClause(ix, back, t.nodes.get(back.cause)?.label ?? '')}.`
  const hedge = back.tier === WhyTier.Recorded ? 'it went back to' : back.conf >= 0.85 ? 'it followed' : back.conf >= 0.66 ? 'it seems to have gone back to' : 'perhaps it went back to'
  return `${base.replace(/\.$/, '')}; ${hedge} ${mark(back.cause, np(ix, back.cause))}.`
}

// ---------------------------------------------------------------------------------------------------------------------------
// Names and phrases

function town(ix: CauseIndex, id: number, y: number): string {
  return placeName(ix, id, y)
}
function ruler(ix: CauseIndex, r: number): string {
  const x = ix.h.rulers?.[r]
  return x ? `${x.name}${x.regnal > 1 ? ' ' + roman(x.regnal) : ''}` : 'its ruler'
}
const attOf = (ix: CauseIndex, w: number) => polName(ix, ix.h.wars.attacker[w])
/** Who took the town of a Conquered event: the realm its army came from (play-test 1: the war's attacker named a defender's
 * counter-conquest wrongly), else the realm holding it after, else the war's attacker. */
function takerOf(ix: CauseIndex, e: { settlement: number; other: number; value: number; year: number }): string {
  const q = e.other >= 0 ? polAt(ix, e.other, e.year) : polAt(ix, e.settlement, e.year + 1)
  if (q >= 0) return polName(ix, q)
  return ix.h.wars && e.value >= 0 ? attOf(ix, e.value) : 'its enemies'
}
const defOf = (ix: CauseIndex, w: number) => polName(ix, ix.h.wars.defender[w])

/** A noun phrase for a node ("the fall of Oruma to Vashtar in 1204"). */
export function np(ix: CauseIndex, key: string): string {
  const k = parseKey(key)
  if (!k) return 'something the record does not name'
  const h = ix.h
  if (k.kind === 'war') return `the war of ${attOf(ix, k.id)} on ${defOf(ix, k.id)}, begun in ${h.wars.startYear[k.id]}`
  if (k.kind !== 'event') return 'that'
  const e = ev(ix, k.id)
  const y = e.year
  const at = town(ix, e.settlement, y)
  switch (e.type) {
    case E.Conquered: return `the fall of ${at} to ${takerOf(ix, e)} in ${y}`
    case E.BattleFought: return `${h.battles && e.value >= 0 && e.value < h.battles.count ? h.battles.name[e.value] : `the battle for ${at}`} in ${y}`
    case E.Sacked: return `the sack of ${at} in ${y}`
    case E.WarDeclared: return `the war ${attOf(ix, e.value)} made on ${defOf(ix, e.value)} in ${y}`
    case E.CivilWar: return `the civil war that broke out at ${at} in ${y}`
    case E.PeaceMade: return `the peace of ${y} between ${attOf(ix, e.value)} and ${defOf(ix, e.value)}`
    case E.PolityEnded: return `the end of ${polName(ix, e.value)} in ${y}`
    case E.PolityFounded: return `the founding of ${polName(ix, e.value)} in ${y}`
    case E.SuccessionCrisis: return `the contested succession at ${at} in ${y}`
    case E.Regency: return `the regency at ${at} in ${y}`
    case E.ReignEnded: {
      const r = ruler(ix, e.value)
      const x = e.extra
      return x === ReignEnd.Overthrown || x === ReignEnd.Deposed ? `the fall of ${r} in ${y}` : x === ReignEnd.Natural || x === ReignEnd.Battle || x === ReignEnd.Sack || x === ReignEnd.Plague ? `the death of ${r} in ${y}` : `the end of the reign of ${r} in ${y}`
    }
    case E.RulerAcceded: return `the accession of ${ruler(ix, e.value)} in ${y}`
    case E.BorderDispute: return `the quarrel over the land between ${polName(ix, polAt(ix, e.settlement, y))} and ${polName(ix, e.value)}, first disputed in ${y}`
    case E.Famine: return `the famine at ${at} in ${y}`
    case E.Revolt: return `the rising at ${at} in ${y}`
    case E.RevoltCrushed: return `the crushing of the rising at ${at} in ${y}`
    case E.Seceded: return `the breaking away of ${at} in ${y}`
    case E.Partitioned: return `the partition of ${polName(ix, e.value)} in ${y}`
    case E.Migration: return `the departure of its people for ${town(ix, e.other, y)} in ${y}`
    case E.BecameVassal: return `the submission of ${polName(ix, polAt(ix, e.settlement, y))} to ${polName(ix, e.value % 1000)} in ${y}`
    case E.Reunified: return `the reunion of ${polName(ix, e.value)} with ${polName(ix, polAt(ix, e.settlement, y))} in ${y}`
    case E.RoyalMarriage: return `the marriage of ${y} between the houses of ${at} and ${town(ix, e.other, y)}`
    case E.Persecution: return `the persecution at ${at} in ${y}`
    case E.CityStricken: return `the plague at ${at} in ${y}`
    case E.FirstContact: return `the first meeting of two peoples at ${at} in ${y}`
    case E.Raid: return `the raid on ${at} in ${y}`
    case E.SiegeLifted: return `the siege of ${at}, lifted in ${y}`
    case E.Founded: return `the founding of ${at} in ${y}`
    case E.Blight: return `the blight among the people of ${at} in ${y}`
    case E.OrderGiven: return `the order given in ${y}`
    case E.HolyWar: return `the holy war proclaimed in ${y}`
    case E.RulerConverted: return `the conversion of the ruler at ${at} in ${y}`
    case E.ResortAbandoned: return `the end of ${at} as a resort in ${y}`
    default: return `the ${eventWord(e.type)} at ${at} in ${y}`
  }
}

function eventWord(t: number): string {
  const m: Record<number, string> = { [E.Joined]: 'submission', [E.Defected]: 'defection', [E.CapitalMoved]: 'move of the capital', [E.Alliance]: 'alliance', [E.DynastyEnded]: 'end of a house', [E.StateReligion]: 'new state religion', [E.FaithReached]: 'coming of a faith', [E.IdeaAdopted]: 'coming of a new idea', [E.TradeClosed]: 'closing of a trade route', [E.Epidemic]: 'epidemic', [E.GreatEpidemic]: 'great epidemic', [E.DiseaseAppeared]: 'first outbreak of a disease' }
  return m[t] ?? 'event'
}

/** A short subject for a node told after its first mention ("The war", "That fall"). */
function subjOf(ix: CauseIndex, key: string): string {
  const k = parseKey(key)
  if (k?.kind === 'war') return 'The war'
  if (k?.kind !== 'event') return 'That'
  const e = ev(ix, k.id)
  switch (e.type) {
    case E.Conquered: return `The fall of ${town(ix, e.settlement, e.year)}`
    case E.WarDeclared: case E.CivilWar: return 'The war'
    case E.SuccessionCrisis: return 'The contested succession'
    case E.ReignEnded: return 'That reign\'s end'
    case E.Famine: return 'The famine'
    case E.Revolt: return 'The rising'
    case E.BorderDispute: return 'The quarrel'
    case E.PeaceMade: return 'The peace'
    case E.PolityEnded: return 'Its end'
    default: return 'That'
  }
}

/** The root's own sentence. */
function rootSentence(ix: CauseIndex, key: string): string {
  const k = parseKey(key)
  const h = ix.h
  if (!k) return ''
  if (k.kind === 'war') return `${cap(attOf(ix, k.id))} made war on ${defOf(ix, k.id)} in ${h.wars.startYear[k.id]}.`
  if (k.kind !== 'event') return ''
  const e = ev(ix, k.id)
  const y = e.year
  const at = town(ix, e.settlement, y)
  switch (e.type) {
    case E.PolityEnded: return `${cap(polName(ix, e.value))} came to an end in ${y}.`
    case E.PolityFounded: return `${cap(polName(ix, e.value))} was founded at ${at} in ${y}.`
    case E.WarDeclared: return `${cap(attOf(ix, e.value))} made war on ${defOf(ix, e.value)} in ${y}.`
    case E.Conquered: return `${at} fell to ${takerOf(ix, e)} in ${y}.`
    case E.Revolt: return `${at} rose against ${town(ix, e.other, y)} in ${y}.`
    case E.Famine: return `Hunger struck ${at} in ${y}; ${shareOf(e.value)} of its people were lost.`
    case E.Abandoned: return `${at} was left empty in ${y}.`
    case E.ReignEnded: return `The reign of ${ruler(ix, e.value)} ended in ${y}.`
    case E.SuccessionCrisis: return `The succession at ${at} was contested in ${y}.`
    case E.PeaceMade: return `${cap(attOf(ix, e.value))} and ${defOf(ix, e.value)} made peace in ${y}.`
    default: return `${cap(np(ix, key))}.`
  }
}

function shareOf(f: number): string {
  return f >= 0.5 ? 'half or more' : f >= 0.3 ? 'a third' : f >= 0.2 ? 'a fifth' : f >= 0.1 ? 'one in ten' : 'a few'
}

function ratioWords(x: number): string {
  if (x >= 10) return 'many times over'
  if (x >= 2.5) return `about ${num(Math.round(x))} to one`
  if (x >= 1.75) return 'about two to one'
  if (x >= 1.3) return 'about three to two'
  return 'by a little'
}

/** A condition as a clause ("Vashtar was the stronger at the front of Kesh, about two to one"). */
function condClause(ix: CauseIndex, l: WhyLink, label: string): string {
  const k = parseKey(l.cause)
  const code = k?.code ?? ''
  const i = k?.id ?? -1
  const e = i >= 0 ? ev(ix, i) : null
  const h = ix.h
  const W = ix.why
  const y = e?.year ?? 0
  if (e && (e.type === E.WarDeclared) && h.wars && W) {
    const w = e.value
    const att = attOf(ix, w), def = defOf(ix, w)
    if (code === 'odds') return `${att} was the stronger at the frontier town of ${town(ix, W.wars.front[w], y)}, ${ratioWords(decodeLog2(W.wars.odds[w]))}`
    if (code === 'crisis') return `${def} was in the throes of a contested succession`
    if (code === 'warlike') return `its ruler was a warlike one`
    if (code === 'holy') return `zeal for the faith drove it on`
    if (code === 'order') return `an order urged it on`
    if (code === 'mul') return W.wars.flags[w] & WarWhyFlag.Warlike ? 'its ruler was eager for war' : 'its ruler was eager for war'
  }
  const fixed: Record<string, string> = {
    'rivalry.Claim': 'the two were rivals over the farmland between them',
    'rivalry.Dispute': 'their claims had met over open land',
    'rivalry.Differ': 'their peoples were strangers to each other',
    'rivalry.Hunger': 'hunger gnawed along the border',
    'rivalry.RecentWar': 'they had fought within living memory',
    'rivalry.Faith': 'their faiths stood against each other',
    'rivalry.Secession': 'the one had broken away from the other',
    'rivalry.Alarm': 'the one had been alarmed by the other\'s attacks on its neighbours',
    'unrest.Distance': 'the capital was far away',
    'unrest.Foreign': 'its people chafed under foreign rule',
    'unrest.Conquest': 'the memory of its conquest was fresh',
    'unrest.Famine': 'a famine had lately struck it',
    'unrest.Crowding': 'it was crowded beyond what its fields could feed',
    'unrest.BadTax': 'grain had been taken from it in a bad year',
    'unrest.Exhaustion': 'the realm was weary of war',
    'unrest.Crisis': 'the succession at the capital was contested',
    'unrest.Corruption': 'smugglers had corrupted its officers',
    'unrest.Colony': 'it lay overseas, far from the capital',
    'unrest.Faith': 'its rulers kept another faith',
    'unrest.Shock': 'the bitterness of an earlier rising lingered',
    'famine.Ravaged': `war had ravaged its fields`,
    'famine.Crowded': 'it had more mouths than its fields could feed',
    'famine.Imports': 'the grain it used to buy did not come',
    'weather.drought': 'a drought had settled on the region',
    'weather.crisis': 'the bad year was felt far and wide',
    'weather.bad': 'it was a poor year in the region',
    'famine.burst': 'it was a bad year far and wide',
    'war.exhaustion': 'the war had worn both sides out',
  }
  if (code === 'famine.Harvest' && e && W) {
    const r = ix.famineRow.get(i)
    if (r !== undefined) {
      const x = (W.famines.harvest[r] / 255) * 1.4
      return `the harvest of its region was ${x < 0.5 ? 'less than half of a normal year\'s' : x < 0.75 ? 'well short of a normal year\'s' : 'short of a normal year\'s'}`
    }
  }
  if (fixed[code]) return fixed[code]
  if (e) {
    if (code === 'ruler.age' && e.type === E.ReignEnded) { const r = h.rulers?.[e.value]; return `${ruler(ix, e.value)} had died of age or illness${r ? `, aged ${y - r.born}` : ''}` }
    if (code === 'ruler.ability' && e.type === E.ReignEnded) return `${ruler(ix, e.value)} was a weak ruler`
    if (code === 'absorbed.size') {
      const r = ix.absorbedRow.get(i)
      const x = r !== undefined && W ? decodeLog2(W.absorbed.ratio[r]) : 0
      return `a neighbour ${x >= 2 ? `${x >= 10 ? 'many' : num(Math.round(x))} times its size` : 'larger than itself'} drew it in${r !== undefined && W?.absorbed.bound[r] ? ', as its overlord' : ''}`
    }
    if (code === 'decline') {
      let peak = 0
      const N = h.settlements.length
      for (let s = 0; s < h.snapshotCount && s * h.snapshotInterval <= y; s++) peak = Math.max(peak, h.population[s * N + e.settlement] ?? 0)
      return peak < 100 ? `it had never grown beyond a hamlet of ${num(Math.max(10, Math.round(peak / 10) * 10))}` : 'it had long been in decline'
    }
  }
  return label.replace(/^(rivalry|unrest): /, '') || 'there was more to it'
}
