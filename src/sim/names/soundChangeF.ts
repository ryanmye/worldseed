// typology: regular sound change on phoneme forms (language-typology-scripts.md §5.3). Pure: no Rng, shared by the assembly and
// the UI. FEATURE_CHANGES[kind][variant] is the phoneme-model catalogue: the same SoundChangeKind ids as the letter catalogue
// (soundChange.ts SOUND_CHANGES) for kinds 0-13, so one id means the same process in both models, and kinds 14-25 that only a
// feature model can state (tonogenesis, nasalisation, loss of aspiration or glottalisation, mergers of series, debuccalisation,
// length, tone mergers, prenasal loss, cluster breaking). A rule rewrites feature bundles in a context; a word whose result would
// not pass its language's drift gate (typology/phonotactics.ts, from Languages.typo) keeps its form for that rule, as in the
// letter model. New phonemes may arise (a lenited stop as a fricative the inventory lacked): the spelling handles any bundle.

import type { RuleSpec } from './soundChange.ts'
import {
  cons, consFeatures, isConsonant, isVowel, Laryngeal, Manner, Place, Secondary, Tone, vow, vowFeatures, withTone,
} from './typology/phoneme.ts'
import { templateOfBits, typoEuphonic } from './typology/phonotactics.ts'

type Units = string[]
const code = (u: string | undefined): number => (u === undefined ? -1 : u.charCodeAt(0))
const V = (u: string | undefined): boolean => isVowel(code(u))
const C = (u: string | undefined): boolean => isConsonant(code(u))
const ch = (c: number): string => String.fromCharCode(c)
const F = (u: string) => consFeatures(code(u))
const Q = (u: string) => vowFeatures(code(u))

function syllables(u: Units): number {
  let n = 0
  for (const x of u) if (V(x)) n++
  return n
}
/** Each unit meeting `test` in context `ctx` becomes map(unit) (all at once). */
function rewrite(label: string, test: (u: Units, i: number) => boolean, map: (x: string, u: Units, i: number) => string | null): RuleSpec {
  return {
    label,
    apply(u) {
      let out: Units | null = null
      for (let i = 0; i < u.length; i++) {
        if (!test(u, i)) continue
        const y = map(u[i], u, i)
        if (y === null || y === u[i]) continue
        if (!out) out = u.slice()
        out[i] = y
      }
      return out
    },
  }
}
const betweenV = (u: Units, i: number): boolean => V(u[i - 1]) && V(u[i + 1])
const isStop = (x: string, lar?: number): boolean => C(x) && F(x).manner === Manner.Stop && (lar === undefined || F(x).lar === lar)
const front = (x: string | undefined): boolean => V(x) && [0, 1, 2, 3, 4, 15].indexOf(Q(x!).q) >= 0
/** A consonant closes its syllable (a consonant or the word's end follows). */
const closes = (u: Units, i: number): boolean => i + 1 >= u.length || C(u[i + 1])
const withF = (x: string, place: number, manner: number, lar: number, sec?: number): string => ch(cons(place, manner, lar, sec ?? F(x).sec))
const vq = (x: string, q: number): string => { const f = Q(x); return ch(vow(q, f.long, f.nasal, f.tone)) }
function qualityShift(label: string, pairs: [number, number][], ctx: (u: Units, i: number) => boolean = () => true): RuleSpec {
  return rewrite(label, (u, i) => V(u[i]) && ctx(u, i), (x) => { const p = pairs.find(([a]) => a === Q(x).q); return p ? vq(x, p[1]) : null })
}
function drop(label: string, test: (u: Units, i: number) => boolean, after?: (out: Units, i: number) => void): RuleSpec {
  return {
    label,
    apply(u) {
      for (let i = u.length - 1; i >= 0; i--) {
        if (!test(u, i)) continue
        const out = u.slice(0, i).concat(u.slice(i + 1))
        if (after) after(out, i)
        return out
      }
      return null
    },
  }
}
function syncope(nth: 'second' | 'penult'): RuleSpec {
  return {
    label: nth === 'second' ? "the second syllable's vowel falls in long words" : 'the vowel before the last syllable falls in long words',
    apply(u) {
      const s = syllables(u)
      if (s < 3) return null
      const want = nth === 'second' ? 2 : s - 1
      let k = 0
      for (let i = 0; i < u.length; i++) {
        if (!V(u[i]) || ++k !== want) continue
        if (!C(u[i - 1]) || !C(u[i + 1]) || !V(u[i + 2]) || Q(u[i]).long) return null
        return u.slice(0, i).concat(u.slice(i + 1))
      }
      return null
    },
  }
}
const finalC = (u: Units, i: number, pred: (x: string) => boolean): boolean => i === u.length - 1 && i >= 2 && C(u[i]) && V(u[i - 1]) && pred(u[i])
const nasal = (x: string | undefined): boolean => x !== undefined && C(x) && F(x).manner === Manner.Nasal
const FRIC: Record<number, number> = { [Place.Bilabial]: Place.Bilabial, [Place.Alveolar]: Place.Dental, [Place.Velar]: Place.Velar, [Place.Uvular]: Place.Uvular, [Place.Postalveolar]: Place.Postalveolar }

/** A vowel copied from the next vowel of the word (epenthesis), else the previous, toneless when it has none. */
function copyVowel(u: Units, i: number): string {
  for (let j = i; j < u.length; j++) if (V(u[j])) { const f = Q(u[j]); return ch(vow(f.q, 0, 0, f.tone)) }
  for (let j = i - 1; j >= 0; j--) if (V(u[j])) { const f = Q(u[j]); return ch(vow(f.q, 0, 0, f.tone)) }
  return ch(vow(5))
}

/** The phoneme-model catalogue (see the file comment). Append variants only for new histories (drawn by index). */
export const FEATURE_CHANGES: ReadonlyArray<ReadonlyArray<RuleSpec>> = [
  // 0 Lenition
  [
    rewrite('voiceless stops voice between vowels', (u, i) => betweenV(u, i) && isStop(u[i], Laryngeal.Voiceless), (x) => withF(x, F(x).place, Manner.Stop, Laryngeal.Voiced)),
    rewrite('voiced stops become fricatives between vowels', (u, i) => betweenV(u, i) && isStop(u[i], Laryngeal.Voiced) && FRIC[F(u[i]).place] !== undefined, (x) => withF(x, FRIC[F(x).place], Manner.Fricative, Laryngeal.Voiced)),
    rewrite('voiceless stops become fricatives between vowels', (u, i) => betweenV(u, i) && isStop(u[i], Laryngeal.Voiceless) && FRIC[F(u[i]).place] !== undefined, (x) => withF(x, F(x).place === Place.Bilabial ? Place.Labiodental : FRIC[F(x).place], Manner.Fricative, Laryngeal.Voiceless)),
    rewrite('s voices between vowels', (u, i) => betweenV(u, i) && C(u[i]) && F(u[i]).manner === Manner.Fricative && F(u[i]).lar === Laryngeal.Voiceless && F(u[i]).place === Place.Alveolar, (x) => withF(x, Place.Alveolar, Manner.Fricative, Laryngeal.Voiced)),
  ],
  // 1 Palatalisation
  [
    rewrite('velar stops become affricates before front vowels', (u, i) => front(u[i + 1]) && C(u[i]) && F(u[i]).place === Place.Velar && F(u[i]).manner === Manner.Stop && F(u[i]).lar <= 1, (x) => withF(x, Place.Postalveolar, Manner.Affricate, F(x).lar, 0)),
    rewrite('s becomes sh before front vowels', (u, i) => front(u[i + 1]) && C(u[i]) && F(u[i]).place === Place.Alveolar && F(u[i]).manner === Manner.Fricative, (x) => withF(x, Place.Postalveolar, Manner.Fricative, F(x).lar)),
    rewrite('t becomes ts before i', (u, i) => V(u[i + 1]) && Q(u[i + 1]).q === 0 && isStop(u[i], Laryngeal.Voiceless) && F(u[i]).place === Place.Alveolar, () => ch(cons(Place.Alveolar, Manner.Affricate))),
  ],
  // 2 VowelShift
  [
    qualityShift('a > o', [[5, 11]]), qualityShift('e > i', [[2, 0]]), qualityShift('o > u', [[11, 9]]), qualityShift('u > o', [[9, 11]]),
    qualityShift('i > e', [[0, 2]]), qualityShift('a > e', [[5, 2]]), qualityShift('a > o and o > u (a chain shift)', [[5, 11], [11, 9]]),
  ],
  // 3 Raising
  [qualityShift('vowels rise before a closing nasal', [[5, 11], [2, 0], [11, 9]], (u, i) => nasal(u[i + 1]) && closes(u, i + 1))],
  // 4 Umlaut
  [qualityShift('back vowels front before an i in the next syllable', [[5, 2], [11, 3], [9, 1], [12, 4]], (u, i) => { let j = i + 1; if (!C(u[j])) return false; while (C(u[j])) j++; return V(u[j]) && Q(u[j]).q === 0 })],
  // 5 Syncope
  [syncope('second'), syncope('penult')],
  // 6 Apocope
  [drop('a final vowel falls in long words', (u, i) => i === u.length - 1 && V(u[i]) && C(u[i - 1]) && syllables(u) >= 3 && !Q(u[i]).long)],
  // 7 FinalLoss
  [
    drop('a final nasal falls', (u, i) => finalC(u, i, nasal)),
    drop('a final s falls', (u, i) => finalC(u, i, (x) => F(x).manner === Manner.Fricative && F(x).place === Place.Alveolar)),
    drop('a final stop falls', (u, i) => finalC(u, i, (x) => F(x).manner === Manner.Stop)),
    drop('a final liquid falls', (u, i) => finalC(u, i, (x) => F(x).manner === Manner.Lateral || F(x).manner === Manner.Trill || F(x).manner === Manner.Tap)),
  ],
  // 8 ClusterSimplify
  [
    drop('a stop falls before another', (u, i) => i > 0 && V(u[i - 1]) && isStop(u[i]) && isStop(u[i + 1])),
    drop('a voiced stop falls after a nasal (nd > n)', (u, i) => i > 1 && nasal(u[i - 1]) && isStop(u[i], Laryngeal.Voiced)),
    drop('a coda falls before a consonant', (u, i) => i > 0 && V(u[i - 1]) && C(u[i]) && C(u[i + 1])),
  ],
  // 9 Monophthong (vowel + glide)
  [
    {
      label: 'aj and aw become long e and o',
      apply(u) {
        for (let i = 0; i + 1 < u.length; i++) {
          if (!V(u[i]) || Q(u[i]).q !== 5 || !C(u[i + 1]) || F(u[i + 1]).manner !== Manner.Approximant || V(u[i + 2])) continue
          const f = Q(u[i]), pal = F(u[i + 1]).place === Place.Palatal
          return u.slice(0, i).concat([ch(vow(pal ? 2 : 11, 1, f.nasal, f.tone))], u.slice(i + 2))
        }
        return null
      },
    },
  ],
  // 10 HLoss
  [
    drop('an initial h falls', (u, i) => i === 0 && code(u[0]) === cons(Place.Glottal, Manner.Fricative) && V(u[1])),
    drop('h falls between vowels', (u, i) => i > 0 && code(u[i]) === cons(Place.Glottal, Manner.Fricative) && V(u[i - 1]) && V(u[i + 1])),
  ],
  // 11 Depalatalise
  [
    rewrite('sh > s', (u, i) => C(u[i]) && F(u[i]).place === Place.Postalveolar && F(u[i]).manner === Manner.Fricative, (x) => withF(x, Place.Alveolar, Manner.Fricative, F(x).lar)),
    rewrite('ch > sh', (u, i) => C(u[i]) && F(u[i]).place === Place.Postalveolar && F(u[i]).manner === Manner.Affricate && F(u[i]).lar <= 1, (x) => withF(x, Place.Postalveolar, Manner.Fricative, F(x).lar)),
    rewrite('ny > n', (u, i) => C(u[i]) && F(u[i]).place === Place.Palatal && F(u[i]).manner === Manner.Nasal, () => ch(cons(Place.Alveolar, Manner.Nasal, Laryngeal.Voiced))),
  ],
  // 12 Fortition
  [
    rewrite('an initial w > v', (u, i) => i === 0 && V(u[1]) && C(u[0]) && F(u[0]).place === Place.LabialVelar && F(u[0]).manner === Manner.Approximant, () => ch(cons(Place.Labiodental, Manner.Fricative, Laryngeal.Voiced))),
    rewrite('an initial y > j', (u, i) => i === 0 && V(u[1]) && C(u[0]) && F(u[0]).place === Place.Palatal && F(u[0]).manner === Manner.Approximant, () => ch(cons(Place.Postalveolar, Manner.Affricate, Laryngeal.Voiced))),
  ],
  // 13 Prothesis
  [{ label: 'a vowel is put before an initial s and a consonant', apply: (u) => (C(u[0]) && F(u[0]).manner === Manner.Fricative && F(u[0]).place === Place.Alveolar && C(u[1]) ? [copyVowel(u, 0)].concat(u) : null) }],
  // 14 Tonogenesis
  [
    {
      label: 'a final stop falls and leaves a contour tone (falling after a voiceless one, rising after a voiced or glottal one)',
      apply(u) {
        const n = u.length
        if (n < 3 || !C(u[n - 1]) || !V(u[n - 2]) || F(u[n - 1]).manner !== Manner.Stop) return null
        const f = F(u[n - 1])
        const t = f.lar === Laryngeal.Voiceless && f.place !== Place.Glottal ? Tone.Falling : Tone.Rising
        return u.slice(0, n - 2).concat([ch(withTone(code(u[n - 2]), t))])
      },
    },
  ],
  // 15 Nasalise
  [
    {
      label: 'a vowel before a closing nasal takes on nasality and the nasal falls (aN > ã)',
      apply(u) {
        for (let i = 0; i + 1 < u.length; i++) {
          if (!V(u[i]) || Q(u[i]).nasal || !nasal(u[i + 1]) || !closes(u, i + 1)) continue
          const f = Q(u[i])
          return u.slice(0, i).concat([ch(vow(f.q, f.long, 1, f.tone))], u.slice(i + 2))
        }
        return null
      },
    },
  ],
  // 16 Deaspirate
  [rewrite('aspirated stops merge with plain ones', (u, i) => C(u[i]) && F(u[i]).lar === Laryngeal.Aspirated, (x) => withF(x, F(x).place, F(x).manner, Laryngeal.Voiceless))],
  // 17 Deglottalise
  [
    rewrite('ejectives become plain stops', (u, i) => C(u[i]) && F(u[i]).lar === Laryngeal.Ejective, (x) => withF(x, F(x).place, F(x).manner, Laryngeal.Voiceless)),
    rewrite('implosives become plain voiced stops', (u, i) => C(u[i]) && F(u[i]).lar === Laryngeal.Implosive, (x) => withF(x, F(x).place === Place.Palatal ? Place.Postalveolar : F(x).place, F(x).place === Place.Palatal ? Manner.Affricate : F(x).manner, Laryngeal.Voiced)),
  ],
  // 18 UvularMerge
  [rewrite('uvulars move to velar (q > k)', (u, i) => C(u[i]) && F(u[i]).place === Place.Uvular, (x) => withF(x, Place.Velar, F(x).manner === Manner.Trill ? Manner.Fricative : F(x).manner, F(x).lar))],
  // 19 RetroflexMerge
  [rewrite('retroflexes merge with alveolars', (u, i) => C(u[i]) && F(u[i]).place === Place.Retroflex, (x) => withF(x, F(x).manner === Manner.Fricative ? Place.Postalveolar : Place.Alveolar, F(x).manner, F(x).lar))],
  // 20 Debuccalise
  [
    rewrite('s > h before a vowel', (u, i) => V(u[i + 1]) && C(u[i]) && F(u[i]).place === Place.Alveolar && F(u[i]).manner === Manner.Fricative && F(u[i]).lar === 0, () => ch(cons(Place.Glottal, Manner.Fricative))),
    rewrite('a final k or t becomes a glottal stop', (u, i) => i === u.length - 1 && i > 0 && V(u[i - 1]) && isStop(u[i], Laryngeal.Voiceless) && (F(u[i]).place === Place.Velar || F(u[i]).place === Place.Alveolar), () => ch(cons(Place.Glottal, Manner.Stop))),
  ],
  // 21 LengthChange
  [
    rewrite('long vowels shorten', (u, i) => V(u[i]) && Q(u[i]).long === 1, (x) => { const f = Q(x); return ch(vow(f.q, 0, f.nasal, f.tone)) }),
    {
      label: 'a sonorant falls before a consonant and the vowel lengthens',
      apply(u) {
        for (let i = 1; i + 1 < u.length; i++) {
          if (!V(u[i - 1]) || Q(u[i - 1]).long || !C(u[i]) || !C(u[i + 1])) continue
          const m = F(u[i]).manner
          if (m !== Manner.Nasal && m !== Manner.Lateral && m !== Manner.Trill && m !== Manner.Tap) continue
          const f = Q(u[i - 1])
          return u.slice(0, i - 1).concat([ch(vow(f.q, 1, f.nasal, f.tone))], u.slice(i + 1))
        }
        return null
      },
    },
  ],
  // 22 ToneMerge
  [
    rewrite('mid tone merges with low', (u, i) => V(u[i]) && Q(u[i]).tone === Tone.Mid, (x) => ch(withTone(code(x), Tone.Low))),
    rewrite('rising tone merges with high', (u, i) => V(u[i]) && Q(u[i]).tone === Tone.Rising, (x) => ch(withTone(code(x), Tone.High))),
    rewrite('falling tone merges with low', (u, i) => V(u[i]) && Q(u[i]).tone === Tone.Falling, (x) => ch(withTone(code(x), Tone.Low))),
  ],
  // 23 HarmonyLoss: new suffixes stop following the root's vowels; inherited words keep theirs (no rewrite of forms)
  [{ label: 'vowel harmony stops applying to new suffixes', apply: () => null }],
  // 24 Prenasal
  [
    rewrite('prenasalised stops become plain voiced stops', (u, i) => C(u[i]) && F(u[i]).lar === Laryngeal.Prenasalised, (x) => withF(x, F(x).place, F(x).manner, Laryngeal.Voiced)),
    rewrite('prenasalised stops become nasals', (u, i) => C(u[i]) && F(u[i]).lar === Laryngeal.Prenasalised && F(u[i]).manner === Manner.Stop, (x) => withF(x, F(x).place, Manner.Nasal, Laryngeal.Voiced, Secondary.None)),
  ],
  // 25 ClusterBreak
  [
    {
      label: 'an echo vowel breaks a word-initial cluster',
      apply: (u) => (C(u[0]) && C(u[1]) && u.length > 2 ? [u[0], copyVowel(u, 1)].concat(u.slice(1)) : null),
    },
  ],
]
export const FEATURE_KINDS = FEATURE_CHANGES.length

/** The rule a typology language row holds: FEATURE_CHANGES[kind][variant]. */
export function ruleSpecF(kind: number, variant: number): RuleSpec | null {
  return FEATURE_CHANGES[kind]?.[variant] ?? null
}

/**
 * One feature rule on a phoneme word split into units: the result's units, or null when the rule does not reach it, the
 * result would not pass the language's drift gate (`bits`: Languages.typo) or would be shorter than `minLetters` phonemes.
 */
export function applyUnitsF(units: readonly string[], kind: number, variant: number, minLetters: number, bits: number): string[] | null {
  const spec = ruleSpecF(kind, variant)
  if (!spec) return null
  const out = spec.apply(units as Units)
  if (!out) return null
  const w = out.join('')
  if (w === units.join('') || out.length < minLetters || !typoEuphonic(w, templateOfBits(bits), true)) return null
  return out
}
