// battles: text for the battles' events (EventType 220-227) and battle rows, for the chronicle, the inspector, the war
// panel and the city card. Numbers are a chronicler's, hedged ("some", "perhaps", "it is said"): the armies and their
// casualties are not the people the towns lost (History.battles `dead`, counted in Wars.dead). Null for other events,
// or for a history without battles, so the caller falls back to its own wording.

import { BattleCourse, BattleFactor, BattleFlag, BattleKind, BattleWeather, CommanderFate, EventType, type History, type HistoryEvent } from '../contract.ts'
import { renamedName } from './renamingData.ts'
import { politiesOf } from './politiesData.ts'
import { polityName } from './polityFormat.ts'
import { battlesOf } from './battlesData.ts'

const settlementName = (h: History, id: number) => (id >= 0 && id < h.settlements.length ? renamedName(h, id) ?? (h.settlements[id].name || `Settlement #${id}`) : 'a settlement')

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
  const n = battlesOf(h)?.B.name[b] ?? ''
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

/** A deciding factor of battle b: its BattleFactor id and whether it favoured the defenders (and so the winner). */
export interface DecidingFactor { id: number; def: boolean; forWinner: boolean }

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

/** The battle's ground in a word, from its terrain flags ("the pass", "the wood"), or null. */
export function groundWord(fl: number): string | null {
  if (fl & BattleFlag.Pass) return 'the pass'
  if (fl & BattleFlag.Hill) return 'the hills'
  if (fl & BattleFlag.Wood) return 'the wood'
  if (fl & BattleFlag.Marsh) return 'the marsh'
  if (fl & BattleFlag.Coast) return 'the shore'
  return null
}

/** The factor as a clause ("the defenders held the ford", "fog gave the attackers surprise"), in the chronicle's voice. */
export function factorClause(h: History, b: number, f: DecidingFactor): string {
  const B = h.battles
  const fl = B.flags[b], w = B.weather[b]
  const side = f.def ? 'the defenders' : 'the attackers', other = f.def ? 'the attackers' : 'the defenders'
  switch (f.id) {
    case BattleFactor.Ground: {
      const g = groundWord(fl)
      if (f.def) return g ? `the defenders stood in ${g}` : 'the defenders stood on stronger ground'
      return g ? `the attackers caught them in ${g}, short of the town's stronger ground` : 'the attackers forced battle on open ground'
    }
    case BattleFactor.Ford: return f.def ? 'the defenders held the ford' : 'the attackers won the crossing'
    case BattleFactor.Command: {
      const c = f.def ? B.cmdD[b] : B.cmdA[b]
      const n = commanderName(h, c)
      if (!f.forWinner) return n && n !== 'an unnamed captain' ? `${n} was the better captain` : `${side} were the better led`
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

/** The short form for a caption ("the ford"; "fog gave the defenders surprise"), the first deciding factor, or null. */
export function decidingShort(h: History, b: number): string | null {
  const fs = decidingFactors(h, b)
  const f = fs.find((x) => x.forWinner)
  if (f) return factorClause(h, b, f)
  return fs[0] ? `${h.battles.winner[b] === 0 ? 'the attackers' : 'the defenders'} won, though ${factorClause(h, b, fs[0])}` : null
}

/** "What decided it" as a sentence (with the day's course: a winter campaign, mud, a frozen river), or ''. */
export function decidingSentence(h: History, b: number): string {
  const fs = decidingFactors(h, b)
  const c = h.battles.course?.[b] ?? 0
  let s = ''
  const pro = fs.filter((f) => f.forWinner), con = fs.filter((f) => !f.forWinner)
  if (pro.length > 0) s = `It is said that ${pro.map((f) => factorClause(h, b, f)).join(', and ')}${con.length ? `, though ${factorClause(h, b, con[0])}` : ''}.`
  else if (con.length > 0) s = `Though ${con.map((f) => factorClause(h, b, f)).join(' and ')}, the day went to ${h.battles.winner[b] === 0 ? 'the attackers' : 'the defenders'}.`
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
  const fs = decidingFactors(h, b)
  const won = B.winner[b] === 0
  const fW = won ? B.lossA[b] / Math.max(1, B.menA[b]) : B.lossD[b] / Math.max(1, B.menD[b])
  const fL = won ? B.lossD[b] / Math.max(1, B.menD[b]) : B.lossA[b] / Math.max(1, B.menA[b])
  if (won && B.kind[b] !== BattleKind.Naval && B.menA[b] >= 2 * B.menD[b] && fL >= 0.6 && fW >= 0.1) return 'last-stand'
  if (fl & BattleFlag.Pyrrhic) return 'pyrrhic'
  const f = fs[0]
  if (f && f.forWinner && (f.id === BattleFactor.Rain || f.id === BattleFactor.Snow || f.id === BattleFactor.Heat || (f.id === BattleFactor.Surprise && B.weather[b] === BattleWeather.Fog))) return 'weather'
  return null
}

const KIND_WORDS = ['A field battle', 'A siege assault', 'A relief', 'A sea fight', 'An ambush', 'A landing']
const WEATHER_WORDS = ['Clear', 'Rain', 'Fog', 'Snow', 'Heat']

/** The ground in words: "a river crossing, in a wood; the defenders chose it", or "open ground". */
export function groundWords(fl: number, kind: number): string {
  const g: string[] = []
  if (fl & BattleFlag.Ford) g.push('a river crossing')
  if (fl & BattleFlag.Pass) g.push('a pass')
  if (fl & BattleFlag.Hill) g.push('hills')
  if (fl & BattleFlag.Wood) g.push('woods')
  if (fl & BattleFlag.Marsh) g.push('marsh')
  if (fl & BattleFlag.Coast) g.push('the shore')
  let s = g.length ? g.join(', ') : kind === BattleKind.Siege ? 'the walls' : kind === BattleKind.Naval ? 'open sea' : 'open ground'
  if (kind === BattleKind.Siege && g.length) s = `the walls, ${s}`
  if (kind !== BattleKind.Naval && kind !== BattleKind.Siege) s += fl & BattleFlag.GroundByDefender ? '; the defenders chose it' : '; the attackers chose it'
  return s
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
  rows.push(['Battle', `${KIND_WORDS[kind] ?? 'A battle'} for ${settlementName(h, B.target[b])}`])
  const cmd = (k: number) => { const n = commanderName(h, k); return n ? ` under ${n}` : '' }
  rows.push(['Attackers', `${sideName(h, B.attacker[b])}, some ${roundMen(B.menA[b])}${unit}${cmd(B.cmdA[b])}`])
  rows.push(['Defenders', `${sideName(h, B.defender[b])}, perhaps ${roundMen(B.menD[b])}${unit}${cmd(B.cmdD[b])}`])
  rows.push(['Ground', groundWords(fl, kind)])
  const wx = [WEATHER_WORDS[B.weather[b]] ?? 'Clear']
  if (c & BattleCourse.Winter) wx.push('winter campaign')
  if (c & BattleCourse.Mud) wx.push('mud')
  if (c & BattleCourse.Frozen) wx.push('the river frozen')
  if (fl & BattleFlag.Surprise) wx.push(fl & BattleFlag.SurpriseByDefender ? 'the defenders surprised the attackers' : 'the attackers surprised the defenders')
  rows.push(['Weather', wx.join(', ')])
  const fs = decidingFactors(h, b)
  const pro = fs.filter((f) => f.forWinner), con = fs.filter((f) => !f.forWinner)
  if (pro.length) rows.push(['Decided by', pro.map((f) => factorClause(h, b, f)).join('; ')])
  if (con.length) rows.push([pro.length ? 'Though' : 'Won though', con.map((f) => factorClause(h, b, f)).join('; ')])
  const won = B.winner[b] === 0
  const la = B.lossA[b] / Math.max(1, B.menA[b]), ld = B.lossD[b] / Math.max(1, B.menD[b])
  rows.push(['Losses', `the attackers ${shareWords(la)}, the defenders ${shareWords(ld)}${fl & BattleFlag.Pursuit ? ' (in the rout)' : ''}`])
  const arch = battleArchetype(h, b)
  const outcome = won ? (kind === BattleKind.Relief ? 'The besiegers were driven off' : naval ? 'The attackers won the sea' : `${settlementName(h, B.target[b])} fell`) : 'The defenders held'
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
  const target = settlementName(h, B.target[b])
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
  const fell = won && B.kind[b] !== BattleKind.Relief ? `; ${settlementName(h, B.target[b])} fell` : ''
  return `${B.year[b]} · ${bd.B.name[b] || 'a battle'}, won by ${victor} (some ${roundMen(B.menA[b] + B.menD[b])} engaged${fell})`
}

/** Chronicle line for a battles event, or null. */
export function describeBattleEvent(h: History, e: HistoryEvent): string | null {
  const t = e.type as number
  if (!isBattleEvent(t)) return null
  const bd = battlesOf(h)
  const name = settlementName(h, e.settlement)
  switch (t) {
    case EventType.BattleFought:
      return bd && e.value >= 0 && e.value < bd.B.count ? describeBattle(h, e.value) : `A battle is fought for ${name}`
    case EventType.SiegeLaid:
      return `The siege of ${name} begins` + (e.other >= 0 ? ` (the besiegers come from ${settlementName(h, e.other)})` : '')
    case EventType.CommanderFell: {
      const who = commanderName(h, e.value) || 'A commander'
      const b = bd ? bd.C.fateBattle[e.value] : -1
      const where = bd && b >= 0 ? bd.B.name[b] : `the battle for ${name}`
      return (e.extra ?? 0) === 1 ? `${who} is taken prisoner at ${where}` : `${who} falls at ${where}`
    }
    case EventType.CommanderRenowned: {
      const who = commanderName(h, e.value) || 'A commander'
      return `After the battle for ${name}, ${who}'s name is known across ${e.other >= 0 ? `the realm of ${settlementName(h, e.other)}` : 'the land'}`
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
      const n = bd.B.name[b] || 'a battle'
      return self ? `${n.charAt(0).toUpperCase() + n.slice(1)}: ${won ? 'the attackers won' : 'the defenders held'}` : `Its army fought ${n} and ${won ? 'won' : 'was beaten'}`
    }
    case EventType.SiegeLaid:
      return self ? 'Besieged' : `Its army laid siege to ${settlementName(h, e.settlement)}`
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
  const at = C.fateBattle[c] >= 0 ? ` at ${bd.B.name[C.fateBattle[c]]}` : ''
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
