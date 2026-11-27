// typology: phonemes, profiles, inventories, words and spelling (language-typology-scripts.md §10 steps 1, 3-6). Fast: no runs.
import { describe, expect, it } from 'vitest'
import { createRng } from '../../rng.ts'
import {
  C_BASE, C_COUNT, cons, consFeatures, fromLetters, ipa, isConsonant, isVowel, LEGACY_LETTER, SEG, sonority, V_BASE, V_COUNT, vow, vowFeatures,
} from './phoneme.ts'
import { drawCradles, Series, Style, syntheticProfiles } from './profile.ts'
import { TYPO } from './params.ts'
import { buildInventory, sspCoda, sspOnset } from './inventory.ts'
import { conflicts, drawOrtho, plainOk, repairOrtho, romanize, scholarlyOk, writable } from './orthography.ts'
import { typoLanguage, typoCompose, typoRoot, typoMorph, withClass } from './words.ts'
import { isClick, isRare, syllableCount, templateOf, typoEuphonic } from './phonotactics.ts'
import { blocked } from './blocklist.ts'
import { typoBorrowWord } from './borrow.ts'

const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0)

describe('typology: phonemes (step 1)', () => {
  it('codes round-trip every bundle', () => {
    for (let c = C_BASE; c < C_BASE + C_COUNT; c++) {
      const f = consFeatures(c)
      expect(cons(f.place, f.manner, f.lar, f.sec)).toBe(c)
      expect(isConsonant(c) && !isVowel(c)).toBe(true)
    }
    for (let c = V_BASE; c < V_BASE + V_COUNT; c++) {
      const f = vowFeatures(c)
      expect(vow(f.q, f.long, f.nasal, f.tone)).toBe(c)
      expect(isVowel(c) && !isConsonant(c)).toBe(true)
    }
    expect(C_COUNT + V_COUNT).toBe(2544)
  })
  it('sonority rises stop < affricate < fricative < nasal < liquid < glide < vowel', () => {
    const seq = [SEG.t, SEG.ch, SEG.s, SEG.n, SEG.l, SEG.y, vow(5)]
    for (let i = 1; i < seq.length; i++) expect(sonority(seq[i])).toBeGreaterThan(sonority(seq[i - 1]))
  })
  it('legacy letters map to phonemes; letters read greedily with digraphs', () => {
    expect(ipa(String.fromCharCode(LEGACY_LETTER.th, LEGACY_LETTER.sh, LEGACY_LETTER.ch, LEGACY_LETTER.ng))).toBe('θʃt͡ʃŋ')
    expect(ipa(fromLetters('Thashaar'))).toBe('θaʃaːr')
    expect(ipa(fromLetters("Kep'ia-Nor"))).toBe('kepʔia-nor')
  })
})

describe('typology: profiles (step 3)', () => {
  it('priors sum to 1', () => {
    for (const p of [TYPO.invPrior, TYPO.vowPrior, TYPO.sylPrior, TYPO.tonePrior, TYPO.stylePrior]) expect(sum(p)).toBeCloseTo(1, 2)
  })
  it('synthetic draws (2000 languages) match the priors within max(0.05, 0.25 prior)', () => {
    const draws = [] as ReturnType<typeof syntheticProfiles>
    for (let s = 0; s < 100; s++) draws.push(...syntheticProfiles(1000 + s, 20, 20))
    const share = (f: (d: (typeof draws)[0]) => number, k: number): number[] => {
      const c = new Array<number>(k).fill(0)
      for (const d of draws) c[f(d)]++
      return c.map((x) => x / draws.length)
    }
    const check = (got: number[], prior: readonly number[]): void => got.forEach((g, i) => expect(Math.abs(g - prior[i]), `${got} vs ${prior}`).toBeLessThanOrEqual(Math.max(0.05, 0.25 * prior[i])))
    check(share((d) => d.inv, 5), TYPO.invPrior)
    check(share((d) => d.vow, 3), TYPO.vowPrior)
    check(share((d) => d.syl, 3), TYPO.sylPrior)
    check(share((d) => d.tone, 3), TYPO.tonePrior)
    check(share((d) => d.style, 5), TYPO.stylePrior)
    const rate = (bit: number): number => draws.filter((d) => d.series & bit).length / draws.length
    expect(Math.abs(rate(Series.Ejective) - TYPO.ejective)).toBeLessThan(0.05)
    expect(Math.abs(rate(Series.Uvular) - TYPO.uvular)).toBeLessThan(0.05)
    expect(Math.abs(draws.filter((d) => d.nasal).length / draws.length - TYPO.nasalVowels)).toBeLessThan(0.05)
  })
  it('stratified cradles: with 6 cradles nearly every world has a tonal cradle, and cradles span the syllable classes', () => {
    let tonal = 0, spread = 0
    const centre = (c: number): [number, number, number] => [Math.cos(c * 1.7), Math.sin(c * 1.7), 0]
    for (let s = 0; s < 200; s++) {
      const g = drawCradles(s, 6, centre)
      if (g.some((x) => x.tone > 0)) tonal++
      if (new Set(g.map((x) => x.syl)).size >= 2) spread++
    }
    expect(tonal / 200).toBeGreaterThanOrEqual(0.9)
    expect(spread / 200).toBeGreaterThanOrEqual(0.9)
  })
})

const langs = (seeds: number, per = 20) => {
  const out = []
  for (let s = 0; s < seeds; s++) {
    const draws = syntheticProfiles(500 + s, per, 5)
    for (let i = 0; i < draws.length; i++) {
      const o = drawOrtho(createRng(s, `o${i}`))
      const l = typoLanguage(draws[i], createRng(s, `l${i}`), o)
      l.typo!.ortho = repairOrtho(writable(l.typo!.cons, l.typo!.vowels, l.typo!.tones), o)
      out.push(l)
    }
  }
  return out
}

describe('typology: inventories and templates (step 4)', () => {
  const draws = syntheticProfiles(77, 400, 10)
  it('consonant counts lie in their class range; series are coherent; clusters obey sonority; CV-only has no codas', () => {
    for (let i = 0; i < draws.length; i++) {
      const d = draws[i]
      const t = buildInventory(d, createRng(77, `inv${i}`))
      const [lo, hi] = TYPO.invRange[d.inv]
      expect(t.cons.length, `class ${d.inv}`).toBeGreaterThanOrEqual(Math.min(lo, 6))
      expect(t.cons.length).toBeLessThanOrEqual(hi)
      expect(new Set(t.cons).size).toBe(t.cons.length)
      // no lone ejective, implosive or click
      for (const pred of [(c: number) => consFeatures(c).lar === 3, (c: number) => consFeatures(c).lar === 4, isClick]) {
        const n = t.cons.filter(pred).length
        expect(n === 0 || n >= 2).toBe(true)
      }
      for (const cl of t.onsets) for (let k = 0; k + 1 < cl.length; k++) expect(sspOnset(cl.charCodeAt(k), cl.charCodeAt(k + 1))).toBe(true)
      for (const cl of t.finalClusters) expect(sspCoda(cl.charCodeAt(0), cl.charCodeAt(1))).toBe(true)
      if (d.syl === 0) { expect(t.codas.length + t.finals.length).toBe(0); expect(t.onsets.length).toBe(0) }
      if (d.syl === 1) for (const cl of t.onsets) expect(sonority(cl.charCodeAt(1))).toBeGreaterThanOrEqual(4)
      expect(t.vowels.filter((v) => vowFeatures(v).long === 0 && vowFeatures(v).nasal === 0).length).toBe(d.nVowels)
      if (d.tone === 0) expect(t.tones.length).toBe(0); else expect(t.tones.length).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('typology: morphology styles and words (step 5)', () => {
  const all = langs(12)
  it('roots pass the gate and the anti-caricature caps; isolating morphs are one syllable', () => {
    for (const l of all) {
      const t = l.typo!
      const rng = createRng(3, 'w')
      for (let k = 0; k < 20; k++) {
        const w = typoRoot(l, rng)
        expect(typoEuphonic(w, templateOf(t)), ipa(w)).toBe(true)
        let rare = 0, clicks = 0
        for (const c of w) { const x = c.charCodeAt(0); if (isRare(x)) rare++; if (isClick(x)) clicks++ }
        expect(rare).toBeLessThanOrEqual(TYPO.markedPerWord)
        expect(clicks).toBeLessThanOrEqual(1)
        if (t.draw.style === Style.Isolating) {
          expect(syllableCount(w)).toBeLessThanOrEqual(3)
          expect(syllableCount(typoMorph(l, rng, 2, true))).toBe(1)
        }
        if (t.draw.syl === 0) { for (let i = 0; i < w.length; i++) if (isConsonant(w.charCodeAt(i))) expect(isVowel(w.charCodeAt(i + 1))).toBe(true) }
        expect(plainOk(romanize(w, t.ortho, 'plain'))).toBe(true)
      }
    }
  })
  it('root-and-pattern keeps the root consonants through composition; class prefixes are distinct', () => {
    let rp = 0, pf = 0
    for (const l of all) {
      const t = l.typo!
      const rng = createRng(5, 'c')
      if (t.draw.style === Style.RootPattern) {
        rp++
        for (let k = 0; k < 10; k++) {
          const root = typoRoot(l, rng)
          const opt = l.affixes.river.find((o) => o.attach === 'fuse')
          if (!opt) continue
          const c = typoCompose(l, root, opt)
          if (c === null) continue
          const consOf = (s: string) => [...s].map((x) => x.charCodeAt(0)).filter(isConsonant)
          const r = consOf(root).slice(0, 3)
          const got = consOf(c)
          for (const x of new Set(r)) expect(got).toContain(x)
        }
      }
      if (t.draw.style === Style.Prefixing) {
        pf++
        expect(new Set(t.prefixes).size).toBe(4)
        let differ = 0
        for (let k = 0; k < 10; k++) { const stem = typoRoot(l, rng); if (withClass(l, stem, 1) !== stem) differ++ }
        expect(differ).toBeGreaterThanOrEqual(5)
      }
    }
    expect(rp + pf).toBeGreaterThan(0)
  })
  it('the blocklist folds case and diacritics, blocks whole countries and contained slurs, not innocent words', () => {
    expect(blocked('Peru')).toBe(true)
    expect(blocked('Kapérú')).toBe(false)
    expect(blocked('Pérú')).toBe(true)
    expect(blocked('Lamalifuckor')).toBe(true)
    expect(blocked('Perun')).toBe(false)
    expect(blocked('Maliko')).toBe(false)
  })
  it('borrowing maps into the recipient inventory and repairs to its template', () => {
    for (let i = 0; i + 1 < all.length; i += 7) {
      const a = all[i], b = all[i + 1]
      const rng = createRng(9, 'b' + i)
      const w = typoBorrowWord(typoRoot(a, rng), b, rng)
      for (const c of w) { const x = c.charCodeAt(0); if (isConsonant(x)) expect(b.typo!.cons).toContain(x) }
      const l = typoBorrowWord('Strathclyde', b, rng)
      expect(l.length).toBeGreaterThan(1)
    }
  })
})

describe('typology: orthography (step 6)', () => {
  const all = langs(25, 40)
  it('scholarly spelling is injective after repair for (nearly) every language; letters whitelisted', () => {
    let bad = 0
    for (const l of all) {
      const t = l.typo!
      const codes = writable(t.cons, t.vowels, t.tones)
      if (conflicts(codes, t.ortho).length) bad++
      for (const c of codes) {
        const s = romanize(String.fromCharCode(c), t.ortho, 'scholarly')
        expect(scholarlyOk(s), `${ipa(String.fromCharCode(c))} -> ${s}`).toBe(true)
        expect(/^[a-z']*$/.test(romanize(String.fromCharCode(c), t.ortho, 'plain'))).toBe(true)
      }
    }
    expect(bad / all.length).toBeLessThanOrEqual(0.01)
  })
  it('plain names are pronounceable and differ across traditions only in spelling', () => {
    const l = all[0]
    const rng = createRng(1, 'p')
    for (let k = 0; k < 50; k++) {
      const w = typoRoot(l, rng)
      expect(plainOk(romanize(w, l.typo!.ortho, 'plain'))).toBe(true)
    }
    const kh = String.fromCharCode(SEG.x, vow(5))
    const spellings = new Set<string>()
    for (let o = 0; o < 4; o++) spellings.add(romanize(kh, o << 6, 'plain'))
    expect(spellings.size).toBeGreaterThan(1)
  })
})
