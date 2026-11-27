// families: names of the merchant families and their heads, in the language of each family's first home (merchant-families.md §2.8).
//
// A surname: with 0.3 the home's root fused with an ending of the language (a toponymic, "of Rilko"), with 0.45 a fresh root and
// an ending, otherwise a bare fresh root; 3-10 letters, fluent, unique and not nearly the same as a ruling house's name or an
// earlier family's. A cadet line (FamilyCause.Split) keeps its parent's surname (the UI says "the Veckin of Osk"), so it draws
// no surname. Each family draws a stock of six men's and four women's names the first time; a son takes his father's name with
// 0.3, else one of the stock (the first favoured); a son-in-law or a widow gets a fresh word of the language.
//
// Draws only from 'names-family-<id>' (surname and stock), 'names-familyhead-<head id>' and the endings
// 'names-familyaffix-<tribe>-<level>' (two morphs); each family in id order and each head in id order, so a longer run names alike.

import { HeadHow } from '../../contract.ts'
import type { World } from '../../contract.ts'
import { createRng } from '../rng.ts'
import type { Rng } from '../rng.ts'
import type { Language } from './phonology.ts'
import type { SettlementNaming } from './index.ts'
import { buildMorph, buildRoot, fluentName, fuseWords, letterCount, nameOf, nearAny } from './words.ts'

export interface FamilyLike { firstHome: number; parent: number }
export interface HeadLike { family: number; female: boolean; how: number; prev: number }

function word(lang: Language, rng: Rng, min: number, max: number): string {
  for (let k = 0; k < 40; k++) {
    const w = nameOf(lang, buildRoot(lang, rng))
    const n = letterCount(w)
    if (n >= min && n <= max && (k >= 30 || fluentName(w))) return w
  }
  return nameOf(lang, buildRoot(lang, rng))
}

function pickFav(rng: Rng, n: number): number {
  let t = 0
  for (let k = 0; k < n; k++) t += 1 / (k + 1)
  let x = rng.next() * t
  for (let k = 0; k < n; k++) { x -= 1 / (k + 1); if (x < 0) return k }
  return n - 1
}

/** Surnames of the families and personal names of the heads; `taken` holds names not to reuse (the ruling houses'). */
export function nameFamilies(world: World, naming: SettlementNaming, families: readonly FamilyLike[], heads: readonly HeadLike[], taken: readonly string[]): { family: string[]; head: string[] } {
  const used = new Set<string>(taken.map((x) => x.toLowerCase()))
  const lc: string[] = taken.map((x) => x.toLowerCase())
  const affix = new Map<string, string[]>()
  const family: string[] = []
  const male: string[][] = [], female: string[][] = []
  const langs: Language[] = []
  for (let f = 0; f < families.length; f++) {
    const home = families[f].firstHome
    const par = families[f].parent
    if (par >= 0 && par < f) { family.push(family[par]); male.push(male[par]); female.push(female[par]); langs.push(langs[par]); continue }
    const tribe = naming.tribe[home], level = naming.level[home]
    const lang = naming.language(tribe, level)
    langs.push(lang)
    const key = tribe + ':' + level
    let ends = affix.get(key)
    if (!ends) {
      const r = createRng(world.seed, `names-familyaffix-${tribe}-${level}`)
      ends = [buildMorph(lang, r, 2, true), buildMorph(lang, r, 2, true)]
      affix.set(key, ends)
    }
    const rng = createRng(world.seed, `names-family-${f}`)
    let name = ''
    for (let attempt = 0; attempt < 200 && !name; attempt++) {
      const x = rng.next()
      const ending = ends[Math.floor(rng.next() * ends.length)]
      let w: string | null
      if (x < 0.3) w = fuseWords(lang, naming.roots[home] ?? buildRoot(lang, rng), ending)
      else if (x < 0.75) w = fuseWords(lang, buildRoot(lang, rng), ending)
      else w = buildRoot(lang, rng)
      if (w === null || attempt > 120) w = buildRoot(lang, rng)
      const cand = nameOf(lang, w)
      const n = letterCount(cand)
      if (n >= 3 && n <= (attempt < 100 ? 10 : 12) && !used.has(cand.toLowerCase()) && (attempt >= 100 || (fluentName(cand) && !nearAny(lc, cand)))) name = cand
    }
    if (!name) name = nameOf(lang, buildRoot(lang, rng)) + 'o' + f // (practically unreachable)
    used.add(name.toLowerCase())
    lc.push(name.toLowerCase())
    family.push(name)
    const m: string[] = [], w: string[] = []
    for (let k = 0; k < 6; k++) { let x = word(lang, rng, 3, 9); for (let t = 0; t < 10 && m.indexOf(x) >= 0; t++) x = word(lang, rng, 3, 9); m.push(x) }
    for (let k = 0; k < 4; k++) { let x = word(lang, rng, 3, 9); for (let t = 0; t < 10 && (w.indexOf(x) >= 0 || m.indexOf(x) >= 0); t++) x = word(lang, rng, 3, 9); w.push(x) }
    male.push(m)
    female.push(w)
  }
  const head: string[] = []
  for (let h = 0; h < heads.length; h++) {
    const x = heads[h]
    const rng = createRng(world.seed, `names-familyhead-${h}`)
    const f = x.family
    let name: string
    if (x.how === HeadHow.SonInLaw || x.how === HeadHow.Widow) name = word(langs[f], rng, 3, 9)
    else if (x.female) name = female[f][pickFav(rng, female[f].length)]
    else {
      const p = x.prev
      const u = rng.next()
      if (x.how === HeadHow.Son && p >= 0 && p < h && !heads[p].female && u < 0.3) name = head[p]
      else name = male[f][pickFav(rng, male[f].length)]
    }
    head.push(name)
  }
  return { family, head }
}
