// battles: text for the battles' events (EventType 220-227) and battle rows, for the chronicle, the inspector, the war
// panel and the city card. Numbers are a chronicler's, hedged ("some", "perhaps", "it is said"): the armies and their
// casualties are not the people the towns lost (History.battles `dead`, counted in Wars.dead). Null for other events,
// or for a history without battles, so the caller falls back to its own wording.

import { BattleCourse, BattleFactor, BattleFlag, BattleKind, BattleWeather, CommanderFate, EventType, type History, type HistoryEvent } from '../contract.ts'
import { politiesOf } from './politiesData.ts'
import { polityName } from './polityFormat.ts'
import { battleName, battlesOf, townAt } from './battlesData.ts'
import { BATTLE } from '../sim/history/battles/params.ts'

/** n4c: a town as said in `year` (the chronicle's spoken name at the event's year, play-test 2). */
const settlementName = (h: History, id: number, year: number) => townAt(h, id, year)

/** Whether an event type is a battles event (220-229). */
export const isBattleEvent = (t: number): boolean => t >= 220 && t <= 229

/** Whether `other` of a battles event is a settlement id (BattleFought: the attackers' base; SiegeLaid: the besiegers'; Renowned, Dismissed: the capital served). */
export const battleOtherIsSettlement = (t: number): boolean => t === EventType.BattleFought || t === EventType.SiegeLaid || t === EventType.CommanderRenowned || t === EventType.CommanderDismissed || t === EventType.GeneralSeized || t === EventType.GeneralRose || t === EventType.GeneralTurned

/** "some 3,000": a chronicler's round number. */
export function roundMen(n: number): string {
  const x = n < 100 ? Math.round(n / 10) * 10 : n < 1000 ? Math.round(n / 50) * 50 : n < 10000 ? Math.round(n / 100) * 100 : Math.round(n / 1000) * 1000
  return Math.max(10, x).toLocaleString('en-US')
}

/** "a third" of a share lost. */
export function shareWords(f: number): string {
  if (f >= 0.7) return 'most'
  if (f >= 0.45) return 'half'
  if (f >= 0.3) return 'a third'
  if (f >= 0.22) return 'a quarter'
  if (f >= 0.17) return 'a fifth'
  if (f >= 0.09) return 'a tenth'
  return 'a few'
}

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen']

/** "after some four hours". */
export function hoursWords(h: number): string {
  if (h >= 13.5) return 'after two days'
  if (h < 1) return 'within the hour'
  if (h < 1.5) return 'after an hour'
  return `after some ${NUM[Math.round(h)] ?? Math.round(h)} hours`
}

/** The battle's name, capitalised for the start of a line ("The Battle of Vebena Ford"). */
export function battleTitle(h: History, b: number): string {
  const n = battleName(h, b)
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : 'A battle'
}

/** A commander's name with his office: "King Ulem II" style is the rulers panel's; here "its ruler Ulem II" or "Tsoro". */
export function commanderName(h: History, c: number): string {
  const C = battlesOf(h)?.C
  if (!C || c < 0 || c >= C.count) return ''
  return C.name[c] || 'an unnamed captain'
}

function sideName(h: History, p: number): string {
  const pd = politiesOf(h)
  return pd ? polityName(pd, p, 'its enemies') : 'its enemies'
}

// ---------- n5: what decided a battle (History.battles course) ----------

/** A deciding factor of battle b: its BattleFactor id (or NUMBERS) and whether it favoured the defenders (and so the winner). */
export interface DecidingFactor {
  id: number
  def: boolean
  forWinner: boolean
  /** n4c: its estimated share of the odds, |ln| of the factor it multiplied the attackers' odds by (see factorWeight). */
  weight?: number
}

/** n4c: the armies' numbers as a deciding factor (not a BattleFactor: the square of the strength ratio is the odds' base). */
export const NUMBERS = 100

/** The battle's deciding factors (0-2; none for a neutral run, a naval battle or a history cached before they were recorded). */
export function decidingFactors(h: History, b: number): DecidingFactor[] {
  const B = h.battles
  const c = B.course?.[b] ?? 0
  const out: DecidingFactor[] = []
  const defWon = B.winner[b] === 1
  const f1 = c & BattleCourse.Factor, f2 = (c >> BattleCourse.Factor2Shift) & BattleCourse.Factor
  if (f1 !== BattleFactor.None) { const def = (c & BattleCourse.DefFavoured) !== 0; out.push({ id: f1, def, forWinner: def === defWon }) }
  if (f2 !== BattleFactor.None) { const def = (c & BattleCourse.DefFavoured2) !== 0; out.push({ id: f2, def, forWinner: def === defWon }) }
  return out
}

const lnAbs = (x: number) => Math.abs(Math.log(x > 0 ? x : 1))
/** The numbers' share of the odds: the square law, x = (A / D)^2 (battles.md 3.3), as |ln|. */
const numbersWeight = (h: History, b: number) => 2 * lnAbs(h.battles.menA[b] / Math.max(1, h.battles.menD[b]))

/**
 * n4c: how much a recorded factor moved the odds (|ln| of its multiplier), as near as the record allows. The command's
 * from the commanders' skills, morale's from the break fractions (both recorded); the rest are bounded by their
 * parameters (battles/params.ts), so a factor is never under-weighed against the numbers.
 */
export function factorWeight(h: History, b: number, id: number): number {
  const B = h.battles
  switch (id) {
    case BattleFactor.Command: {
      const C = h.commanders
      const sk = (c: number) => (C && c >= 0 && c < C.count && C.skill[c] > 0 ? C.skill[c] : 1)
      return Math.max(lnAbs(BATTLE.factorMin), lnAbs(sk(B.cmdA[b]) / sk(B.cmdD[b])))
    }
    case BattleFactor.Morale: { const bA = B.breakA[b], bD = B.breakD[b]; return Math.max(lnAbs(BATTLE.factorMin), lnAbs((1 - bD * bD) / Math.max(1e-6, 1 - bA * bA))) }
    case BattleFactor.Rain: return Math.max(lnAbs(BATTLE.factorMin), numbersWeight(h, b) / 4) // (x -> x^(3/4))
    case BattleFactor.Surprise: return 2 * lnAbs(1 - BATTLE.surpriseLoss)
    case BattleFactor.Sickness: return lnAbs(BATTLE.sick)
    case BattleFactor.Snow: return lnAbs(BATTLE.snowMul)
    case BattleFactor.Heat: return lnAbs(BATTLE.heatMul)
    case BattleFactor.Height: return lnAbs((1 + BATTLE.heightMax) / (1 - BATTLE.heightMax))
    case BattleFactor.Winter: return lnAbs(1 - BATTLE.winterMul)
    case BattleFactor.Supply: return lnAbs(1 / BATTLE.supplyBase)
    case BattleFactor.Ground: case BattleFactor.Ford: return lnAbs(2.2 + BATTLE.fordBonus) // (defence 1 to 2.2, the ford's bonus: polity/defense.ts)
  }
  return lnAbs(BATTLE.factorMin)
}

/**
 * n4c (play-test 2: "Decided by: outgeneralled" over 2.4 to 1 and 15 to 1): the recorded factors and the numbers, each with
 * its weight, heaviest first. The numbers count when a side had at least NUMBERS_MIN times the other's men and the battle's
 * factors were recorded (none in a neutral run, as before).
 */
export function rankedFactors(h: History, b: number): DecidingFactor[] {
  const B = h.battles
  const fs = decidingFactors(h, b).map((f) => ({ ...f, weight: factorWeight(h, b, f.id) }))
  if (fs.length > 0 && B.kind[b] !== BattleKind.Naval) {
    const r = B.menA[b] / Math.max(1, B.menD[b])
    if (r >= NUMBERS_MIN || r <= 1 / NUMBERS_MIN) {
      const def = r < 1
      fs.push({ id: NUMBERS, def, forWinner: def === (B.winner[b] === 1), weight: numbersWeight(h, b) })
    }
  }
  return fs.sort((x, y) => (y.weight ?? 0) - (x.weight ?? 0))
}
const NUMBERS_MIN = 1.3

/** "about 2.4 to 1" (or "15 to 1"): the larger army against the smaller. */
export function oddsWords(a: number, d: number): string {
  const r = Math.max(a, d) / Math.max(1, Math.min(a, d))
  return r >= 10 ? `${Math.round(r)} to 1` : `about ${r.toFixed(1).replace(/\.0$/, '')} to 1`
}

/** The battle's ground in a word, from its terrain flags ("the pass", "the wood"), or null. */
export function groundWord(fl: number): string | null {
  if (fl & BattleFlag.Pass) return 'the pass'
  if (fl & BattleFlag.Hill) return 'the hills'
  if (fl & BattleFlag.Wood) return 'the wood'
  if (fl & BattleFlag.Marsh) return 'the marsh'
  if (fl & BattleFlag.Coast) return 'the shore'
  return null
}

/** The factor as a clause ("the defenders held the ford", "fog gave the attackers surprise"), in the chronicle's voice. `top`: it is the battle's first decider (only then "outgeneralled"). */
export function factorClause(h: History, b: number, f: DecidingFactor, top = true): string {
  const B = h.battles
  const fl = B.flags[b], w = B.weather[b]
  const side = f.def ? 'the defenders' : 'the attackers', other = f.def ? 'the attackers' : 'the defenders'
  switch (f.id) {
    case NUMBERS: {
      const many = f.def ? B.menD[b] : B.menA[b], few = f.def ? B.menA[b] : B.menD[b]
      return `${side}' numbers told, some ${roundMen(many)} against ${roundMen(few)} (${oddsWords(many, few)})`
    }
    case BattleFactor.Ground: {
      const g = groundWord(fl)
      if (f.def) return g ? `the defenders stood in ${g}` : 'the defenders stood on stronger ground'
      return g ? `the attackers caught them in ${g}, short of the town's stronger ground` : 'the attackers forced battle on open ground'
    }
    case BattleFactor.Ford: return f.def ? 'the defenders held the ford' : 'the attackers won the crossing'
    case BattleFactor.Command: {
      const c = f.def ? B.cmdD[b] : B.cmdA[b]
      const n = commanderName(h, c)
      if (!f.forWinner || !top) return n && n !== 'an unnamed captain' ? `${n} was the better captain` : `${side} were the better led`
      return n && n !== 'an unnamed captain' ? `${n} outgeneralled the enemy` : `${side} were the better led`
    }
    case BattleFactor.Supply: return `hunger thinned the ranks of ${other}`
    case BattleFactor.Sickness: return `sickness ran through the camp of ${other}`
    case BattleFactor.Surprise: return w === BattleWeather.Fog ? `fog gave ${side} surprise` : `${side} caught the enemy unready`
    case BattleFactor.Rain: return w === BattleWeather.Snow ? (f.def ? 'the snow blunted the attack' : 'the snow blunted the defence') : f.def ? 'the rain blunted the attack' : 'the rain blunted the defence'
    case BattleFactor.Snow: return f.def ? 'snow broke the attack' : 'the snow told on the defenders'
    case BattleFactor.Heat: return f.def ? 'the heat told on the attackers' : 'the heat told on the defenders'
    case BattleFactor.Morale: return f.def ? 'the defenders\' line was the steadier' : 'the attackers\' line was the steadier'
    case BattleFactor.Height: return f.def ? 'the defenders held the higher ground' : 'the attackers came down from the heights'
    case BattleFactor.Winter: return f.def ? 'winter wore down the attackers' : 'winter wore down the defenders'
  }
  return ''
}

/** n4c: the battle's factors split for the summaries: the first decider (the heaviest that favoured the victors), the others for them, those against them. */
export function decidingSplit(h: History, b: number): { top: DecidingFactor | null; also: DecidingFactor[]; con: DecidingFactor[] } {
  const fs = rankedFactors(h, b)
  const pro = fs.filter((f) => f.forWinner), con = fs.filter((f) => !f.forWinner)
  return { top: pro[0] ?? null, also: pro.slice(1), con }
}

/** The short form for a caption ("the ford"; "fog gave the defenders surprise"), the first deciding factor, or null. */
export function decidingShort(h: History, b: number): string | null {
  const { top, con } = decidingSplit(h, b)
  if (top) return factorClause(h, b, top)
  return con[0] ? `${h.battles.winner[b] === 0 ? 'the attackers' : 'the defenders'} won, though ${factorClause(h, b, con[0])}` : null
}

/** "What decided it" as a sentence (with the day's course: a winter campaign, mud, a frozen river), or ''. */
export function decidingSentence(h: History, b: number): string {
  const fs = decidingFactors(h, b)
  const { top, also, con } = decidingSplit(h, b)
  const c = h.battles.course?.[b] ?? 0
  let s = ''
  const pro = top ? [top, ...also] : []
  if (pro.length > 0) s = `It is said that ${pro.map((f, i) => factorClause(h, b, f, i === 0)).join(', and ')}${con.length ? `, though ${factorClause(h, b, con[0], false)}` : ''}.`
  else if (con.length > 0) s = `Though ${con.map((f) => factorClause(h, b, f, false)).join(' and ')}, the day went to ${h.battles.winner[b] === 0 ? 'the attackers' : 'the defenders'}.`
  const extra: string[] = []
  if (c & BattleCourse.Frozen) extra.push('The river had frozen and gave the defenders nothing.')
  if ((c & BattleCourse.Winter) && !fs.some((f) => f.id === BattleFactor.Winter)) extra.push('It was a winter campaign.')
  if (c & BattleCourse.Mud) extra.push('The field was mud, and the pursuit bogged down.')
  return [s, ...extra].filter(Boolean).join(' ')
}

/**
 * Narrate-only archetypes the merged code already produces (battles-fiction §3 "narrate now"), as one closing line or '':
 * the last stand (A1: the beaten defenders outnumbered two to one, most of them lost, the victors bled), the Pyrrhic victory
 * (A12, the flag), weather deciding the day (A16: the first deciding factor is the weather's and favoured the victors).
 */
export function battleArchetype(h: History, b: number): 'last-stand' | 'pyrrhic' | 'weather' | null {
  const B = h.battles
  const fl = B.flags[b]
  const won = B.winner[b] === 0
  const fW = won ? B.lossA[b] / Math.max(1, B.menA[b]) : B.lossD[b] / Math.max(1, B.menD[b])
  const fL = won ? B.lossD[b] / Math.max(1, B.menD[b]) : B.lossA[b] / Math.max(1, B.menA[b])
  if (won && B.kind[b] !== BattleKind.Naval && B.menA[b] >= 2 * B.menD[b] && fL >= 0.6 && fW >= 0.1) return 'last-stand'
  if (fl & BattleFlag.Pyrrhic) return 'pyrrhic'
  const f = rankedFactors(h, b)[0] // (n4c: the heaviest factor, the numbers included)
  if (f && f.forWinner && (f.id === BattleFactor.Rain || f.id === BattleFactor.Snow || f.id === BattleFactor.Heat || (f.id === BattleFactor.Surprise && B.weather[b] === BattleWeather.Fog))) return 'weather'
  return null
}

const KIND_WORDS = ['A field battle', 'A siege assault', 'A relief', 'A sea fight', 'An ambush', 'A landing']
const WEATHER_WORDS = ['Clear', 'Rain', 'Fog', 'Snow', 'Heat']

/**
 * The ground in words: "a river crossing, in a wood; the defenders chose it", or "open ground". n4c: `height`, the side the
 * higher ground favoured (the Height factor: the slope between the site and the attackers' approach, which the terrain flags
 * do not show; play-test 2: "Ground: open ground" beside "came down from the heights").
 */
export function groundWords(fl: number, kind: number, height: 'att' | 'def' | null = null): string {
  const g: string[] = []
  if (fl & BattleFlag.Ford) g.push('a river crossing')
  if (fl & BattleFlag.Pass) g.push('a pass')
  if (fl & BattleFlag.Hill) g.push('hills')
  if (fl & BattleFlag.Wood) g.push('woods')
  if (fl & BattleFlag.Marsh) g.push('marsh')
  if (fl & BattleFlag.Coast) g.push('the shore')
  let s = g.length ? g.join(', ') : kind === BattleKind.Siege ? 'the walls' : kind === BattleKind.Naval ? 'open sea' : 'open ground'
  if (kind === BattleKind.Siege && g.length) s = `the walls, ${s}`
  if (height && kind !== BattleKind.Naval) s += height === 'att' ? ', sloping down from the attackers' : ', rising toward the defenders'
  if (kind !== BattleKind.Naval && kind !== BattleKind.Siege) s += fl & BattleFlag.GroundByDefender ? '; the defenders chose it' : '; the attackers chose it'
  return s
}

/** n4c: battle b's ground in words, with the higher ground where a factor of the day was the height. */
export function groundOf(h: History, b: number): string {
  const ht = decidingFactors(h, b).find((f) => f.id === BattleFactor.Height)
  return groundWords(h.battles.flags[b], h.battles.kind[b], ht ? (ht.def ? 'def' : 'att') : null)
}

/** n4c: "Decided by" (the heaviest factor for the victors), "Also" (the others for them), "Though" (those against them), as label / value rows. */
export function decidingRows(h: History, b: number): [string, string][] {
  const { top, also, con } = decidingSplit(h, b)
  const rows: [string, string][] = []
  if (top) rows.push(['Decided by', factorClause(h, b, top)])
  if (also.length) rows.push(['Also', also.map((f) => factorClause(h, b, f, false)).join('; ')])
  if (con.length) rows.push([top ? 'Though' : 'Won though', con.map((f) => factorClause(h, b, f, false)).join('; ')])
  return rows
}

/** n5: the context panel's summary of battle b, as label / value rows (the chronicler's numbers, hedged). */
export function battleSummary(h: History, b: number): [string, string][] {
  const bd = battlesOf(h)
  if (!bd || b < 0 || b >= bd.B.count) return []
  const B = bd.B
  const fl = B.flags[b], c = B.course?.[b] ?? 0, kind = B.kind[b]
  const naval = kind === BattleKind.Naval
  const unit = naval ? ' ships' : ''
  const rows: [string, string][] = []
  rows.push(['Battle', `${KIND_WORDS[kind] ?? 'A battle'} for ${settlementName(h, B.target[b], B.year[b])}`])
  const cmd = (k: number) => { const n = commanderName(h, k); return n ? ` under ${n}` : '' }
  rows.push(['Attackers', `${sideName(h, B.attacker[b])}, some ${roundMen(B.menA[b])}${unit}${cmd(B.cmdA[b])}`])
  rows.push(['Defenders', `${sideName(h, B.defender[b])}, perhaps ${roundMen(B.menD[b])}${unit}${cmd(B.cmdD[b])}`])
  rows.push(['Ground', groundOf(h, b)])
  const wx = [WEATHER_WORDS[B.weather[b]] ?? 'Clear']
  if (c & BattleCourse.Winter) wx.push('winter campaign')
  if (c & BattleCourse.Mud) wx.push('mud')
  if (c & BattleCourse.Frozen) wx.push('the river frozen')
  if (fl & BattleFlag.Surprise) wx.push(fl & BattleFlag.SurpriseByDefender ? 'the defenders surprised the attackers' : 'the attackers surprised the defenders')
  rows.push(['Weather', wx.join(', ')])
  for (const [k, v] of decidingRows(h, b)) rows.push([k, v])
  const won = B.winner[b] === 0
  const la = B.lossA[b] / Math.max(1, B.menA[b]), ld = B.lossD[b] / Math.max(1, B.menD[b])
  rows.push(['Losses', `the attackers ${shareWords(la)}, the defenders ${shareWords(ld)}${fl & BattleFlag.Pursuit ? ' (in the rout)' : ''}`])
  const arch = battleArchetype(h, b)
  const outcome = won ? (kind === BattleKind.Relief ? 'The besiegers were driven off' : naval ? 'The attackers won the sea' : `${settlementName(h, B.target[b], B.year[b])} fell`) : 'The defenders held'
  rows.push(['Outcome', `${outcome} ${hoursWords(B.hours[b])}${arch === 'last-stand' ? '; a last stand' : arch === 'pyrrhic' ? '; a Pyrrhic victory' : arch === 'weather' ? '; the weather decided it' : ''}`])
  return rows
}

/** The chronicle's account of battle b (one or two sentences). */
export function describeBattle(h: History, b: number): string {
  const bd = battlesOf(h)
  if (!bd) return 'A battle'
  const B = bd.B, C = bd.C
  const att = sideName(h, B.attacker[b]), def = sideName(h, B.defender[b])
  const won = B.winner[b] === 0
  const fl = B.flags[b]
  const under = (c: number, ruler: boolean) => (c < 0 ? '' : ruler ? ` led by ${commanderName(h, c)} in person` : ` under ${commanderName(h, c)}`)
  const cA = under(B.cmdA[b], B.cmdA[b] >= 0 && C.reign[B.cmdA[b]] >= 0), cD = under(B.cmdD[b], B.cmdD[b] >= 0 && C.reign[B.cmdD[b]] >= 0)
  const target = settlementName(h, B.target[b], B.year[b])
  const menA = `some ${roundMen(B.menA[b])} of ${att}${cA}`, menD = `perhaps ${roundMen(B.menD[b])} of ${def}${cD}`
  const title = battleTitle(h, b)
  const loser = won ? def : att
  const lossL = won ? B.lossD[b] / Math.max(1, B.menD[b]) : B.lossA[b] / Math.max(1, B.menA[b])
  let s: string
  switch (B.kind[b]) {
    case BattleKind.Siege: {
      const yr = B.siegeYear[b]
      s = `${title}${yr > 0 ? `, ${ordinalYear(yr + 1)} year` : ''}: ${menA} stormed the walls against ${menD}. `
      s += won ? `The walls were carried ${hoursWords(B.hours[b])}; the defenders lost, it is said, ${shareWords(lossL)} of their men.` : `The assault failed; the besiegers are said to have lost ${roundMen(B.lossA[b])}.`
      const why = decidingSentence(h, b)
      if (why) s += ' ' + why
      if (won) s += ` ${target} fell.`
      return s
    }
    case BattleKind.Relief:
      s = `${title}: ${menA} struck the besiegers' lines at ${target}, held by ${menD}. `
      break
    case BattleKind.Ambush:
      s = `${title}: the army of ${att}${cA}, some ${roundMen(B.menA[b])} strong, was caught on the march by ${menD}. `
      break
    case BattleKind.Landing:
      s = `${title}: ${menA} came ashore and met ${menD} on the strand. `
      break
    default:
      s = fl & BattleFlag.Ford ? `${title}: ${menA} forced the river against ${menD}. ` : `${title}: ${menA} met ${menD} on the way to ${target}. `
  }
  if (B.weather[b] === BattleWeather.Rain) s += 'Rain had soaked the field. '
  else if (B.weather[b] === BattleWeather.Snow) s += 'They fought in the snow. '
  else if (B.weather[b] === BattleWeather.Fog) s += 'A fog lay over the ground. '
  else if (B.weather[b] === BattleWeather.Heat) s += 'The heat was terrible. '
  s += `The ${loser} line broke ${hoursWords(B.hours[b])} and lost, it is said, ${shareWords(lossL)} of its men${fl & BattleFlag.Pursuit ? ' in the rout' : ''}.`
  const why = decidingSentence(h, b)
  if (why) s += ' ' + why
  const arch = battleArchetype(h, b)
  if (arch === 'last-stand') s += ` The defenders made a last stand, and it cost the victors dear.`
  else if (fl & BattleFlag.Pyrrhic) s += ' It was a victory that cost the victors nearly as much as defeat.'
  else if (fl & BattleFlag.Outnumbered) s += ' The victors had been outnumbered.'
  if (arch === 'weather') s += ' Men said afterwards that the weather, not the generals, decided the day.'
  if (won && B.kind[b] !== BattleKind.Relief) s += ` ${target} fell.`
  return s
}

function ordinalYear(n: number): string {
  return ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'][n] ?? `${n}th`
}

/** A short line for a battle row: "1203 · the Battle of Vebena Ford, won by Kubeta (Vebena fell)". */
export function battleShortLine(h: History, b: number): string {
  const bd = battlesOf(h)
  if (!bd) return ''
  const B = bd.B
  const won = B.winner[b] === 0
  const victor = sideName(h, won ? B.attacker[b] : B.defender[b])
  const fell = won && B.kind[b] !== BattleKind.Relief ? `; ${settlementName(h, B.target[b], B.year[b])} fell` : ''
  return `${B.year[b]} · ${battleName(h, b) || 'a battle'}, won by ${victor} (some ${roundMen(B.menA[b] + B.menD[b])} engaged${fell})`
}

/** Chronicle line for a battles event, or null. */
export function describeBattleEvent(h: History, e: HistoryEvent): string | null {
  const t = e.type as number
  if (!isBattleEvent(t)) return null
  const bd = battlesOf(h)
  const name = settlementName(h, e.settlement, e.year)
  switch (t) {
    case EventType.BattleFought:
      return bd && e.value >= 0 && e.value < bd.B.count ? describeBattle(h, e.value) : `A battle is fought for ${name}`
    case EventType.SiegeLaid:
      return `The siege of ${name} begins` + (e.other >= 0 ? ` (the besiegers come from ${settlementName(h, e.other, e.year)})` : '')
    case EventType.CommanderFell: {
      const who = commanderName(h, e.value) || 'A commander'
      const b = bd ? bd.C.fateBattle[e.value] : -1
      const where = bd && b >= 0 ? battleName(h, b) : `the battle for ${name}`
      return (e.extra ?? 0) === 1 ? `${who} is taken prisoner at ${where}` : `${who} falls at ${where}`
    }
    case EventType.CommanderRenowned: {
      const who = commanderName(h, e.value) || 'A commander'
      return `After the battle for ${name}, ${who}'s name is known across ${e.other >= 0 ? `the realm of ${settlementName(h, e.other, e.year)}` : 'the land'}`
    }
    case EventType.CommanderDismissed:
      return `${commanderName(h, e.value) || 'A general'} is relieved of command after the defeat at ${name}`
    case EventType.GeneralSeized:
      return `The general ${commanderName(h, e.value) || ''} takes the throne at ${name}`.replace('  ', ' ')
    case EventType.GeneralRose:
      return `The general ${commanderName(h, e.value) || ''} raises a rising at ${name}`.replace('  ', ' ')
    case EventType.GeneralTurned:
      return `The general ${commanderName(h, e.value) || ''} goes over to the enemy with ${name}`.replace('  ', ' ')
  }
  return null
}

/** Inspector line for a battles event from the point of view of settlement `id`, or null. */
export function describeBattleEventFor(h: History, e: HistoryEvent, id: number): string | null {
  const t = e.type as number
  if (!isBattleEvent(t)) return null
  const bd = battlesOf(h)
  const self = e.settlement === id
  switch (t) {
    case EventType.BattleFought: {
      if (!bd || e.value < 0 || e.value >= bd.B.count) return self ? 'A battle was fought for it' : 'Its army fought a battle'
      const B = bd.B, b = e.value
      const won = B.winner[b] === 0
      const n = battleName(h, b) || 'a battle'
      return self ? `${n.charAt(0).toUpperCase() + n.slice(1)}: ${won ? 'the attackers won' : 'the defenders held'}` : `Its army fought ${n} and ${won ? 'won' : 'was beaten'}`
    }
    case EventType.SiegeLaid:
      return self ? 'Besieged' : `Its army laid siege to ${settlementName(h, e.settlement, e.year)}`
    case EventType.CommanderFell:
      return `${commanderName(h, e.value) || 'A commander'} ${(e.extra ?? 0) === 1 ? 'was taken' : 'fell'} in the battle for it`
    case EventType.CommanderRenowned:
      return self ? `${commanderName(h, e.value) || 'A commander'} won renown in the battle for it` : `Its general ${commanderName(h, e.value)} won renown`
    case EventType.CommanderDismissed:
      return self ? `${commanderName(h, e.value) || 'A general'} was relieved after the defeat here` : `Its general ${commanderName(h, e.value)} was relieved`
  }
  return describeBattleEvent(h, e)
}

/** Chronicle / inspector dot class for a battles event, or null. */
export function battleEventKind(e: HistoryEvent): 'battle' | null {
  return isBattleEvent(e.type as number) ? 'battle' : null
}

/** Whether a battles event is a chronicle headline: a great battle (BATTLE.logMen x 4 engaged), a ruler in the field, a commander's renown. */
export function isBattleHeadline(h: History, e: HistoryEvent): boolean {
  const t = e.type as number
  if (t === EventType.CommanderRenowned || t === EventType.GeneralSeized || t === EventType.GeneralRose) return true
  if (t !== EventType.BattleFought) return false
  const bd = battlesOf(h)
  if (!bd || e.value < 0 || e.value >= bd.B.count) return false
  const B = bd.B, b = e.value
  return B.menA[b] + B.menD[b] >= 6000 || (B.flags[b] & BattleFlag.RulerLed) !== 0
}

/** The fate of a commander in words ("fell at the Battle of X in 1203"). */
export function commanderFateWords(h: History, c: number): string {
  const bd = battlesOf(h)
  if (!bd) return ''
  const C = bd.C
  const at = C.fateBattle[c] >= 0 ? ` at ${battleName(h, C.fateBattle[c])}` : ''
  const y = C.fateYear[c] >= 0 ? ` in ${C.fateYear[c]}` : ''
  switch (C.fate[c]) {
    case CommanderFate.Slain: return `fell${at}${y}`
    case CommanderFate.Taken: return `was taken${at}${y}`
    case CommanderFate.Dismissed: return `was relieved of command${y}`
    case CommanderFate.Retired: return C.reign[c] >= 0 ? `led until the reign ended${y}` : `retired${y}`
    case CommanderFate.Seized: return `took the throne${y}`
    case CommanderFate.Rose: return `rose against the realm${y}`
    case CommanderFate.Turned: return `went over to the enemy${y}`
    case CommanderFate.RealmEnded: return `outlived the realm${y}`
  }
  return 'still served'
}

// ---------- n4c: the replay's figures (battleMap.ts) ----------

/**
 * n4c: men still standing as the chroniclers count them: the start's round figure less the losses' own (rounded finer),
 * so the end counter shows every loss (play-test 2: 11,000 "still standing" after 140 lost) and adds up with the sub-title.
 */
export function standingWords(men: number, left: number): string {
  const lost = men * (1 - Math.min(1, Math.max(0, left)))
  if (lost < 0.5) return roundMen(men)
  const start = Number(roundMen(men).replace(/,/g, ''))
  const l = Number(roundMen(lost).replace(/,/g, ''))
  return Math.max(10, start - Math.min(l, start - 10)).toLocaleString('en-US')
}

/** CIE Lab of a colour (D65). */
function labOf(c: [number, number, number]): [number, number, number] {
  const f = (u: number) => { u /= 255; return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4 }
  const [r, g, bl] = c.map(f)
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * bl, z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)
  return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))]
}
/**
 * n4c: whether two sides' colours tell apart on the field's small figures: a lightness gap of SIDE_MIN_DL, or (both of
 * some colour) hues SIDE_MIN_HUE degrees apart in Lab, or (greys) a ΔE of SIDE_MIN_DELTA_E. (Play-test 2's teal and green
 * are ΔE 56 apart but 32° in hue at one lightness: hard to tell, so ΔE alone is not the test.)
 */
export function sidesDistinct(a: [number, number, number], b: [number, number, number]): boolean {
  const p = labOf(a), q = labOf(b)
  if (Math.abs(p[0] - q[0]) >= SIDE_MIN_DL) return true
  const cp = Math.hypot(p[1], p[2]), cq = Math.hypot(q[1], q[2])
  if (cp >= 20 && cq >= 20) {
    let dh = Math.abs(Math.atan2(p[2], p[1]) - Math.atan2(q[2], q[1])) * (180 / Math.PI)
    if (dh > 180) dh = 360 - dh
    return dh >= SIDE_MIN_HUE
  }
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) >= SIDE_MIN_DELTA_E
}
const SIDE_MIN_DL = 20, SIDE_MIN_HUE = 60
function parseCss(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim())
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
  const r = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c)
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null
}
/** n4c: the least ΔE between two greyish sides' colours (sidesDistinct). */
export const SIDE_MIN_DELTA_E = 30
const SIDE_FALLBACK = ['#e05a4f', '#4a7fd6', '#f0c330', '#f2f2f2', '#9b59d0', '#1f1f1f']
/** The attackers' and defenders' colours: their realms', unless too alike; then the defenders take the most distinct of a fixed set (the attackers keep theirs). */
export function sideColours(a: string | undefined, d: string | undefined): [string, string] {
  const ca = a ?? SIDE_FALLBACK[0], cd = d ?? SIDE_FALLBACK[1]
  const pa = parseCss(ca), pd = parseCss(cd)
  if (!pa || !pd || sidesDistinct(pa, pd)) return [ca, cd]
  for (const f of SIDE_FALLBACK) if (sidesDistinct(pa, parseCss(f)!)) return [ca, f] // (the first distinct one, in a fixed order: the same pair reads the same)
  const best = SIDE_FALLBACK[3]
  return [ca, best]
}
