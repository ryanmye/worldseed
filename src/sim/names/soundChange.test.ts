// language: the pure sound-change core (soundChange.ts; language-drift.md §7 step 1).
import { describe, expect, it } from 'vitest'
import { SoundChangeKind } from '../../contract.ts'
import { SC, SOUND_CHANGES, SOUND_CHANGE_KINDS, applyRule, evolve, similarity, type LanguageRules } from './soundChange.ts'
import { isEuphonic, isEuphonicDrift } from './words.ts'

/** A one-language table holding `rules` ([year, kind, variant]) in date order. */
function table(rules: Array<[number, number, number]>, parent = -1): LanguageRules {
  return {
    count: 1, parent: Int16Array.of(parent), splitYear: Int16Array.of(0), ruleStart: Int32Array.of(0, rules.length),
    ruleYear: Int16Array.from(rules.map((r) => r[0])), ruleKind: Uint8Array.from(rules.map((r) => r[1])), ruleVariant: Uint8Array.from(rules.map((r) => r[2])),
  }
}
const v = (kind: number, label: string): number => SOUND_CHANGES[kind].findIndex((r) => r.label === label)

describe('sound change catalogue', () => {
  it('the contract enum matches the catalogue', () => {
    expect(SOUND_CHANGES.length).toBe(SOUND_CHANGE_KINDS)
    for (const [k, id] of Object.entries(SoundChangeKind)) expect(SC[k as keyof typeof SC], k).toBe(id)
  })

  it('each kind rewrites a hand-made word', () => {
    const cases: Array<[number, string, string, string]> = [
      [SC.Lenition, 't > d between vowels', 'katal', 'kadal'],
      [SC.Palatalisation, 'k > ch before i and e', 'kiran', 'chiran'],
      [SC.VowelShift, 'a > o', 'taman', 'tomon'],
      [SC.VowelShift, 'a > o and o > u (a chain shift)', 'karo', 'koru'],
      [SC.Raising, 'a > o before a closing nasal', 'lanta', 'lonta'],
      [SC.Umlaut, 'a > e before an i in the next syllable', 'mali', 'meli'],
      [SC.Syncope, "the second syllable's vowel falls in long words", 'vastara', 'vastra'],
      [SC.Apocope, 'a final vowel falls in long words', 'telumo', 'telum'],
      [SC.FinalLoss, 'a final n falls', 'koran', 'kora'],
      [SC.FinalLoss, 'a final nasal falls after an unstressed vowel, which opens to a', 'vastarum', 'vastara'],
      [SC.ClusterSimplify, 'nd > n', 'kandor', 'kanor'],
      [SC.Monophthong, 'ai, ei > e', 'taiko', 'teko'],
      [SC.HLoss, 'an initial h falls', 'harun', 'arun'],
      [SC.Depalatalise, 'sh > s', 'vashtarum', 'vastarum'],
      [SC.Fortition, 'an initial w > v', 'walun', 'valun'],
      [SC.Prothesis, 'e is put before an initial s and a consonant', 'spano', 'espano'],
    ]
    for (const [kind, label, from, to] of cases) {
      const variant = v(kind, label)
      expect(variant, label).toBeGreaterThanOrEqual(0)
      expect(applyRule(from, kind, variant), label).toBe(to)
    }
  })

  it('a rule that does not reach a word, or would make it unpronounceable or too short, leaves it (null)', () => {
    expect(applyRule('lomu', SC.Lenition, v(SC.Lenition, 't > d between vowels'))).toBeNull() // no t
    // syncope of "parkata" would give "parkta" (a cluster no euphony allows)
    expect(applyRule('parkata', SC.Syncope, 0)).toBeNull()
    // a final vowel does not fall from a two-syllable word
    expect(applyRule('tano', SC.Apocope, 0)).toBeNull()
    expect(applyRule('an', SC.FinalLoss, v(SC.FinalLoss, 'a final n falls'))).toBeNull()
  })

  it('isEuphonicDrift allows exactly one medial sonorant/s + onset-cluster triple; isEuphonic does not', () => {
    for (const w of ['vastra', 'kantro', 'molpra']) { expect(isEuphonic(w), w).toBe(false); expect(isEuphonicDrift(w), w).toBe(true) }
    for (const w of ['vaktra', 'vastrastro', 'astr']) expect(isEuphonicDrift(w), w).toBe(false)
    for (const w of ['katal', 'morinu', 'ashet']) expect(isEuphonicDrift(w)).toBe(isEuphonic(w))
  })
})

describe('evolve', () => {
  it('with no rules is the identity', () => {
    const L = table([])
    for (const w of ['vashtarum', 'oru tal', 'kel-maro']) expect(evolve(L, w, 0, -1, 2000)).toBe(w)
  })

  it('carries vashtarum to vastra through three dated rules, and only up to the year asked', () => {
    const L = table([
      [610, SC.Depalatalise, v(SC.Depalatalise, 'sh > s')],
      [900, SC.FinalLoss, v(SC.FinalLoss, 'a final nasal falls after an unstressed vowel, which opens to a')],
      [1240, SC.Syncope, 0],
    ])
    expect(evolve(L, 'vashtarum', 0, -1, 500)).toBe('vashtarum')
    expect(evolve(L, 'vashtarum', 0, -1, 610)).toBe('vastarum')
    expect(evolve(L, 'vashtarum', 0, -1, 1000)).toBe('vastara')
    expect(evolve(L, 'vashtarum', 0, -1, 2000)).toBe('vastra')
    // a word that entered in 950 (a loan) is not touched by the earlier rules
    expect(evolve(L, 'shotarum', 0, 950, 1000)).toBe('shotarum')
    expect(evolve(L, 'shotarum', 0, 950, 2000)).toBe('shotrum') // (the later syncope reaches it)
  })

  it('follows the lineage: a daughter has her mother\'s rules before the split and her own after', () => {
    const L: LanguageRules = {
      count: 2, parent: Int16Array.of(-1, 0), splitYear: Int16Array.of(0, 700), ruleStart: Int32Array.of(0, 2, 3),
      ruleYear: Int16Array.of(500, 800, 900), ruleKind: Uint8Array.of(SC.Lenition, SC.VowelShift, SC.HLoss), ruleVariant: Uint8Array.of(0, 0, 0),
    }
    expect(evolve(L, 'hatan', 0, -1, 2000)).toBe('hodon') // t > d (500), a > o (800)
    expect(evolve(L, 'hatan', 1, -1, 2000)).toBe('adan') // t > d (500), the daughter's h loss (900)
  })

  it('similarity is 1 for equal words and falls with edits', () => {
    expect(similarity('vastra', 'vastra')).toBe(1)
    expect(similarity('vastra', 'vastara')).toBeCloseTo(6 / 7)
  })
})
