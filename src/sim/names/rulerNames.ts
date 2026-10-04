// rulers, religion: names of ruling houses, rulers and faiths, in the languages of the world (see index.ts, polityNames.ts).
//
// A house is named from the language of its first capital (its people's tongue there): the capital's root or a fresh root
// with a house ending of the language ("Mera" + "sh"), unique among houses. It has a stock of personal names drawn when it
// is founded (six for men, four for women, a women's ending fused on where the language allows). A ruler takes, in order:
// the same person's name on a second throne (a union); a man: his father's name (0.35, if his father reigned), an earlier
// king's of the house (0.25), else a name of the stock (the first ones are favoured); a woman: from the women's stock. The
// regnal number counts the earlier reigns of the same polity with that name; a name worn past IV gives way, the more often
// the higher it would go, to a new name of the house's language that joins its stock (numbers past VIII are rare). A league's head gets a fresh name of the
// capital's language. A faith is named from its people's language (traditional: the people's name or a fresh root with a
// faith ending) or its founding town's (universal: the town's root or a fresh root with the ending), unique among faiths.
//
// Draws only from 'names-house-<id>', 'names-ruler-<id>', 'names-faith-<id>' and the endings 'names-houseaffix-',
// 'names-fem-' and 'names-faithaffix-<tribe>-<level>' (no other stream, no new meaning class), each thing named from its own
// stream in id order from what was known when it appeared, so a longer run names alike and nothing else is renamed.

import type { World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { Rng } from '../rng.ts'
import type { Language } from './phonology.ts'
import type { SettlementNaming } from './index.ts'
import { buildMorph, buildRoot, capitalizeName, fuseWords, letterCount } from './words.ts'

export interface HouseLike {
  /** First capital (its language names the house and its people). */
  capital: number
}
export interface RulerLike {
  polity: number
  dynasty: number
  female: boolean
  /** Capital at the accession. */
  capital: number
  /** Parent's reign (a child of a ruler), -1. */
  parent: number
  /** First reign of the same person (itself unless a second throne). */
  person: number
}
export interface FaithLike {
  traditional: boolean
  people: number
  foundedAt: number
}

function morphs(world: World, naming: SettlementNaming, cache: Map<string, string[]>, stream: string, tribe: number, level: number, n: number): string[] {
  const key = stream + tribe + ':' + level
  let e = cache.get(key)
  if (e) return e
  const lang = naming.language(tribe, level)
  const rng = createRng(world.seed, `${stream}${tribe}-${level}`)
  e = []
  for (let k = 0; k < n; k++) e.push(buildMorph(lang, rng, 2, true))
  cache.set(key, e)
  return e
}

function word(lang: Language, rng: Rng, min: number, max: number): string {
  for (let k = 0; k < 40; k++) {
    const w = capitalizeName(buildRoot(lang, rng))
    const n = letterCount(w)
    if (n >= min && n <= max) return w
  }
  return capitalizeName(buildRoot(lang, rng))
}

/** A ruler's name whose regnal number would pass `soft` is replaced by a new one with chance (number - soft) / span. */
const REGNAL = { soft: 4, span: 8 }

/** Favours the first entries: index k with weight 1 / (k + 1). */
function pickFav(rng: Rng, n: number): number {
  let t = 0
  for (let k = 0; k < n; k++) t += 1 / (k + 1)
  let x = rng.next() * t
  for (let k = 0; k < n; k++) { x -= 1 / (k + 1); if (x < 0) return k }
  return n - 1
}

/** Names every house and every reign (in id order), with regnal numbers. */
export function nameRulers(world: World, naming: SettlementNaming, houses: readonly HouseLike[], rulers: readonly RulerLike[]): { houseNames: string[]; names: string[]; regnal: number[] } {
  const cache = new Map<string, string[]>()
  const used = new Set<string>()
  const houseNames: string[] = []
  const male: string[][] = [], female: string[][] = []
  const langs: Language[] = []
  for (let d = 0; d < houses.length; d++) {
    const cap = houses[d].capital
    const tribe = naming.tribe[cap], level = naming.level[cap]
    const lang = naming.language(tribe, level)
    langs.push(lang)
    const ends = morphs(world, naming, cache, 'names-houseaffix-', tribe, level, 2)
    const fem = morphs(world, naming, cache, 'names-fem-', tribe, level, 2)
    const rng = createRng(world.seed, `names-house-${d}`)
    let name = ''
    for (let attempt = 0; attempt < 200 && !name; attempt++) {
      const x = rng.next()
      const ending = ends[Math.floor(rng.next() * ends.length)]
      let w: string | null
      if (x < 0.35) w = fuseWords(lang, naming.roots[cap] ?? buildRoot(lang, rng), ending)
      else if (x < 0.75) w = fuseWords(lang, buildRoot(lang, rng), ending)
      else w = buildRoot(lang, rng)
      if (w === null || attempt > 120) w = buildRoot(lang, rng)
      const cand = capitalizeName(w)
      const n = letterCount(cand)
      if (n >= 3 && n <= (attempt < 100 ? 9 : 12) && !used.has(cand.toLowerCase())) name = cand
    }
    if (!name) name = capitalizeName(buildRoot(lang, rng)) + 'a' + d // practically unreachable
    used.add(name.toLowerCase())
    houseNames.push(name)
    const m: string[] = [], f: string[] = []
    for (let k = 0; k < 6; k++) {
      let w = word(lang, rng, 3, 9)
      for (let t = 0; t < 10 && m.indexOf(w) >= 0; t++) w = word(lang, rng, 3, 9)
      m.push(w)
    }
    for (let k = 0; k < 4; k++) {
      let w = ''
      for (let t = 0; t < 12 && (!w || f.indexOf(w) >= 0 || m.indexOf(w) >= 0); t++) {
        const root = buildRoot(lang, rng)
        const fu = rng.next() < 0.7 ? fuseWords(lang, root, fem[Math.floor(rng.next() * fem.length)]) : null
        w = capitalizeName(fu !== null && letterCount(fu) <= 10 ? fu : root)
      }
      f.push(w)
    }
    male.push(m)
    female.push(f)
  }
  const names: string[] = []
  const regnal: number[] = []
  const count = new Map<string, number>()
  for (let r = 0; r < rulers.length; r++) {
    const x = rulers[r]
    const rng = createRng(world.seed, `names-ruler-${r}`)
    let name: string
    if (x.person !== r && x.person >= 0 && x.person < r) name = names[x.person]
    else if (x.dynasty < 0) {
      const cap = x.capital
      name = word(naming.language(naming.tribe[cap], naming.level[cap]), rng, 3, 9)
    } else if (x.female) {
      const st = female[x.dynasty]
      name = st[pickFav(rng, st.length)]
    } else {
      const st = male[x.dynasty]
      const par = x.parent
      const u = rng.next()
      if (par >= 0 && par < r && !rulers[par].female && rulers[par].dynasty === x.dynasty && u < 0.35) name = names[par]
      else {
        // An earlier king of the house, most recent first.
        let prior = ''
        if (u < 0.6) for (let q = r - 1; q >= 0 && !prior; q--) if (rulers[q].dynasty === x.dynasty && !rulers[q].female && rng.next() < 0.5) prior = names[q]
        name = prior || st[pickFav(rng, st.length)]
      }
    }
    let key = x.polity + ':' + name
    let n = (count.get(key) ?? 0) + 1
    // A worn name (its regnal number past REGNAL.soft) gives way, more often the higher it would go, to a new name of the
    // house's language, which joins the house's stock (so a long house keeps a handful of names in use, rarely past VIII).
    if (x.dynasty >= 0 && x.person === r && n > REGNAL.soft && rng.next() < (n - REGNAL.soft) / REGNAL.span) {
      const st = x.female ? female[x.dynasty] : male[x.dynasty]
      let w = word(langs[x.dynasty], rng, 3, 9)
      for (let t = 0; t < 10 && (st.indexOf(w) >= 0 || (count.get(x.polity + ':' + w) ?? 0) > 0); t++) w = word(langs[x.dynasty], rng, 3, 9)
      st.push(w)
      name = w
      key = x.polity + ':' + name
      n = (count.get(key) ?? 0) + 1
    }
    count.set(key, n)
    names.push(name)
    regnal.push(n)
  }
  return { houseNames, names, regnal }
}

/** Names every faith (in id order), unique among faiths and apart from the peoples' names. */
export function nameFaiths(world: World, naming: SettlementNaming, faiths: readonly FaithLike[], peopleNames: readonly string[]): string[] {
  const cache = new Map<string, string[]>()
  const used = new Set<string>()
  for (const p of peopleNames) used.add(p.toLowerCase())
  const out: string[] = []
  for (let f = 0; f < faiths.length; f++) {
    const x = faiths[f]
    const at = x.foundedAt
    const tribe = naming.tribe[at], level = x.traditional ? 0 : naming.level[at]
    const lang = naming.language(tribe, level)
    const ends = morphs(world, naming, cache, 'names-faithaffix-', tribe, level, 2)
    const rng = createRng(world.seed, `names-faith-${f}`)
    let name = ''
    for (let attempt = 0; attempt < 200 && !name; attempt++) {
      const u = rng.next()
      const ending = ends[Math.floor(rng.next() * ends.length)]
      const base = u < 0.45 ? (x.traditional ? (peopleNames[x.people] ?? '').toLowerCase() : naming.roots[at] ?? '') : buildRoot(lang, rng)
      let w: string | null = base ? fuseWords(lang, base, ending) : null
      if (w === null || attempt > 120) w = buildRoot(lang, rng)
      const cand = capitalizeName(w)
      const n = letterCount(cand)
      if (n >= 3 && n <= (attempt < 100 ? 9 : 12) && !used.has(cand.toLowerCase())) name = cand
    }
    if (!name) name = capitalizeName(buildRoot(lang, rng)) + 'i' + f // practically unreachable
    used.add(name.toLowerCase())
    out.push(name)
  }
  return out
}
