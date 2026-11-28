// Sagas: "The Deeds of Tsoro" (battles). A commander of armies: his first command (a ruler leading in person, a general
// appointed for a war, a kinsman of the ruling house), his greatest victories as scenes, his defeats, and his fate (slain,
// taken, relieved, retired, the realm's end) or his standing at the year told. Every clause is from History.commanders and
// the battles he fought (History.battles); the voice only chooses the wording.

import { CommanderFate } from '../../contract.ts'
import { battleName, battlesOf } from '../battlesData.ts'
import type { Ctx } from './facts.ts'
import { battlePlace, commanderEpithet, withEpithet } from './epithets.ts'
import { list, num, plural, Voice, type PhraseTable } from './voice.ts'
import { Book, type Saga } from './types.ts'
import { battleScene, SCENE_T } from './scenes.ts'
import { Refs } from './refs.ts'

const T: PhraseTable = {
  title: [['The Deeds of {name}'], ['The Saga of {name}']],
  ruler: [
    ['{name} was ruler of {state} and led its armies in person, first in {year}.', 'In {year} {name}, ruler of {state}, took the field at the head of its army.'],
    ['In {year} {name}, lord of {state}, rode out at the head of the host.'],
  ],
  general: [
    ['{name} first commanded the army of {state} in {year}{kin}.', 'In {year} {state} gave its army to {name}{kin}.'],
    ['In {year} the host of {state} was given into the hands of {name}{kin}.'],
  ],
  kin: [[', a kinsman of the house of {house}'], [', of the blood of the house of {house}']],
  record: [
    ['In all {name} fought {battles} and won {wins}.', '{name} fought {battles}, winning {wins}.'],
    ['{battles} {name} fought, and {wins} of them were victories.'],
  ],
  victories: [['The greatest of them were {list}.'], ['Songs were made of {list}.']],
  defeats: [['{name} was beaten {n}, the worst at {at} in {year}.'], ['{N} the host of {name} broke, and worst at {at} in {year}.']],
  slain: [['{name} fell at {at} in {year}.'], ['At {at} in {year} {name} fell, and the host came home without its captain.']],
  taken: [['{name} was taken at {at} in {year} and never commanded again.'], ['At {at} in {year} {name} was led away in chains.']],
  dismissed: [['After the defeat at {at} in {year}, {name} was relieved of command.'], ['After {at}, in {year}, {name} was stripped of command.']],
  retired: [['{name} retired from command in {year}.'], ['In {year} {name} hung up the sword.']],
  reignEnded: [['{name} led the armies until the reign ended in {year}.'], ['Until {year} {name} led the host, and then the reign was over.']],
  realmEnded: [['{name} outlived the realm, which ended in {year}.'], ['In {year} the realm {name} had served was no more.']],
  serving: [['In {Y} {name} still commands.'], ['In {Y} {name} keeps the field still.']],
  closing: [['Here ends the account of {name}.'], ['So ends the saga of {name}.']],
  epigraph: [['{name}: {facts}.'], ['Of {name}, {feat}.']],
}

export function commanderSaga(c: Ctx, k: number, legend: boolean): Saga {
  const h = c.h
  const bd = battlesOf(h)!
  const C = bd.C, B = bd.B
  const Y = c.Y
  const v = new Voice(c.seed, `commander:${k}`, legend, T, SCENE_T)
  const book = new Book()
  const refs = new Refs(c, book, { kind: 'commander', id: k }, legend)
  const base = C.name[k] || 'the captain'
  const ep = legend ? commanderEpithet(c, k) : ''
  const name = withEpithet(base, ep)
  const p = C.polity[k]
  const state = p >= 0 ? c.pname(p) : 'the realm'
  const rows = bd.byCommander[k].filter((b) => B.year[b] <= Y)
  const first = C.firstYear[k]
  const won = (b: number) => (B.winner[b] === 0) === (B.cmdA[b] === k)
  if (C.reign[k] >= 0) book.add(refs.cite(v.p('ruler', { name: base, state, year: first }), { kind: 'state', id: p }))
  else {
    const d = C.dynasty[k]
    const kin = d >= 0 && h.dynasties?.[d] ? v.p('kin', { house: h.dynasties[d].name }) : ''
    const s = v.p('general', { name: base, state, year: first, kin })
    book.add(d >= 0 ? refs.cite(s, { kind: 'house', id: d }) : refs.cite(s, { kind: 'state', id: p }))
  }
  const wins = rows.filter(won)
  const losses = rows.filter((b) => !won(b))
  const p2: string[] = [v.p('record', { name: base, battles: plural(rows.length, 'battle'), wins: num(wins.length) })]
  const great = wins.slice().sort((a, b) => B.lossA[b] + B.lossD[b] - (B.lossA[a] + B.lossD[a]) || a - b).slice(0, 3).sort((a, b) => a - b)
  if (great.length) p2.push(v.p('victories', { list: list(great.map((b) => `${battleName(h, b)} (${B.year[b]})`)) }))
  if (losses.length) {
    const worst = losses.slice().sort((a, b) => B.lossA[b] + B.lossD[b] - (B.lossA[a] + B.lossD[a]) || a - b)[0]
    const n = losses.length === 1 ? 'once' : losses.length === 2 ? 'twice' : `${num(losses.length)} times`
    p2.push(v.p('defeats', { name: base, n, N: n.charAt(0).toUpperCase() + n.slice(1), at: battleName(h, worst), year: B.year[worst] }))
  }
  book.add(p2.join(' '))
  // the two greatest battles as scenes
  for (const b of great.slice().sort((a, b) => B.lossA[b] + B.lossD[b] - (B.lossA[a] + B.lossD[a])).slice(0, 2).sort((a, b) => a - b)) {
    const sc = battleScene(c, v, b)
    if (sc) book.scene(sc.title, sc.text)
  }
  const fy = C.fateYear[k], fb = C.fateBattle[k]
  const at = fb >= 0 ? battleName(h, fb) : ''
  if (fy >= 0 && fy <= Y) {
    switch (C.fate[k]) {
      case CommanderFate.Slain: book.add(v.p('slain', { name: base, at, year: fy })); break
      case CommanderFate.Taken: book.add(v.p('taken', { name: base, at, year: fy })); break
      case CommanderFate.Dismissed: book.add(v.p('dismissed', { name: base, at, year: fy })); break
      case CommanderFate.Retired: book.add(v.p(C.reign[k] >= 0 ? 'reignEnded' : 'retired', { name: base, year: fy })); break
      case CommanderFate.RealmEnded: book.add(v.p('realmEnded', { name: base, year: fy })); break
    }
  } else book.add(v.p('serving', { name: base, Y }))
  const best = great.length ? great[0] : -1
  const facts = [`${state}`, plural(rows.length, 'battle'), `${num(wins.length)} won`]
  const feat = best >= 0 ? `who won ${battleName(h, best)}` : `who led the army of ${state}`
  return {
    kind: 'commander', id: k, year: Y, legend, title: v.p('title', { name: legend ? name : base }),
    epigraph: v.p('epigraph', { name: base, facts: list(facts), feat: best >= 0 && legend ? `the victor of ${battlePlace(battleName(h, best))}` : feat }),
    ...book.parts(), closing: v.p('closing', { name: base }),
  }
}
