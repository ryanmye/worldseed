// typology: the phoneme-model sound changes (language-typology-scripts.md §10 step 8).
import { describe, expect, it } from 'vitest'
import { SoundChangeKind } from '../../contract.ts'
import { applyUnitsF, FEATURE_CHANGES, FEATURE_KINDS } from './soundChangeF.ts'
import { evolve, type LanguageRules } from './soundChange.ts'
import { cons, ipa, Laryngeal, Manner, Place, SEG, Tone, vow } from './typology/phoneme.ts'

const ch = (...c: number[]): string => String.fromCharCode(...c)
const a = vow(5), e = vow(2), i = vow(0), o = vow(11), u = vow(9)
/** Bits of a moderate template (onset 2, coda 1, final 1) and of a complex one. */
const MOD = 2 | (1 << 2) | (1 << 13) | (1 << 16)
const CPX = 2 | (2 << 2) | (2 << 13) | (2 << 16)
const run = (w: string, kind: number, variant: number, bits = CPX): string | null => {
  const out = applyUnitsF(w.split(''), kind, variant, 2, bits)
  return out === null ? null : ipa(out.join(''))
}

describe('phoneme sound changes (FEATURE_CHANGES)', () => {
  it('has kinds 0-25, matching the contract enum', () => {
    expect(FEATURE_KINDS).toBe(26)
    expect(Math.max(...Object.values(SoundChangeKind))).toBe(25)
    for (const k of FEATURE_CHANGES) expect(k.length).toBeGreaterThan(0)
  })
  it('each kind rewrites a hand-made word', () => {
    expect(run(ch(SEG.p, a, SEG.t, a), 0, 0)).toBe('pada')
    expect(run(ch(SEG.k, i, SEG.n, a), 1, 0)).toBe('t͡ʃina')
    expect(run(ch(SEG.t, a, SEG.m, a), 2, 0)).toBe('tomo')
    expect(run(ch(SEG.t, a, SEG.n, SEG.t, a), 3, 0)).toBe('tonta')
    expect(run(ch(SEG.t, a, SEG.k, i), 4, 0)).toBe('teki')
    expect(run(ch(SEG.k, a, SEG.l, a, SEG.m, a), 5, 0)).toBe('kalma')
    expect(run(ch(SEG.k, a, SEG.l, a, SEG.m, a), 6, 0)).toBe('kalam')
    expect(run(ch(SEG.k, a, SEG.l, a, SEG.n), 7, 0)).toBe('kala')
    expect(run(ch(SEG.k, a, SEG.p, SEG.t, a), 8, 0)).toBe('kata')
    expect(run(ch(SEG.t, a, SEG.y, SEG.k, a), 9, 0)).toBe('teːka')
    expect(run(ch(SEG.h, a, SEG.l, a), 10, 0)).toBe('ala')
    expect(run(ch(SEG.sh, a, SEG.l, a), 11, 0)).toBe('sala')
    expect(run(ch(SEG.w, a, SEG.l, a), 12, 0)).toBe('vala')
    expect(run(ch(SEG.s, SEG.t, a, SEG.l, a), 13, 0)).toBe('astala')
    expect(run(ch(SEG.t, a, SEG.l, a, SEG.k), 14, 0)).toBe('talâ')
    expect(run(ch(SEG.t, a, SEG.m, SEG.p, a), 15, 0)).toBe('ta\u0303pa')
    expect(run(ch(cons(Place.Alveolar, Manner.Stop, Laryngeal.Aspirated), a, SEG.l, a), 16, 0)).toBe('tala')
    expect(run(ch(cons(Place.Velar, Manner.Stop, Laryngeal.Ejective), a, SEG.l, a), 17, 0)).toBe('kala')
    expect(run(ch(SEG.q, a, SEG.l, a), 18, 0)).toBe('kala')
    expect(run(ch(cons(Place.Retroflex, Manner.Stop), a, SEG.l, a), 19, 0)).toBe('tala')
    expect(run(ch(SEG.s, a, SEG.l, a), 20, 0)).toBe('hala')
    expect(run(ch(SEG.t, vow(5, 1), SEG.l, a), 21, 0)).toBe('tala')
    expect(run(ch(SEG.t, vow(5, 0, 0, Tone.Mid), SEG.l, vow(5, 0, 0, Tone.High)), 22, 0)).toBe('tàlá')
    expect(run(ch(SEG.t, a, SEG.l, a), 23, 0)).toBeNull()
    expect(run(ch(cons(Place.Alveolar, Manner.Stop, Laryngeal.Prenasalised), a, SEG.l, a), 24, 0)).toBe('dala')
    expect(run(ch(SEG.p, SEG.l, a, SEG.t, o), 25, 0)).toBe('palato')
    expect(run(ch(SEG.k, e, SEG.t, u), 0, 1)).toBeNull() // (no voiced stop between vowels)
  })
  it('blocks a change its language cannot say (a simple-syllable language keeps its final vowels)', () => {
    const w = ch(SEG.k, a, SEG.l, a, SEG.m, a)
    expect(run(w, 6, 0, CPX)).toBe('kalam')
    expect(run(w, 6, 0, 1 /* (C)V only */)).toBeNull()
    expect(run(w, 5, 0, MOD)).toBe('kalma')
  })
  it('a tonogenesis chain through evolve: a final stop leaves a falling tone, then falling merges with low', () => {
    const L: LanguageRules = {
      count: 1, parent: Int16Array.of(-1), splitYear: Int16Array.of(0), ruleStart: Int32Array.of(0, 2),
      ruleYear: Int16Array.of(100, 300), ruleKind: Uint8Array.of(14, 22), ruleVariant: Uint8Array.of(0, 2), typo: Uint32Array.of(CPX),
    }
    const w = ch(SEG.t, a, SEG.l, a, SEG.k)
    expect(ipa(evolve(L, w, 0, -1, 50))).toBe('talak')
    expect(ipa(evolve(L, w, 0, -1, 200))).toBe('talâ')
    expect(ipa(evolve(L, w, 0, -1, 400))).toBe('talà')
    // a letter form never meets the phoneme catalogue
    expect(evolve(L, 'talak', 0, -1, 400)).toBe('talak'.length ? evolve({ ...L, typo: undefined }, 'talak', 0, -1, 400) : '')
  })
})
