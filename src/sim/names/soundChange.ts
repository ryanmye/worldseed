// language: regular sound change (docs/plans language-drift.md §4.3). Pure: no Rng, shared by the sim (assembly) and the UI.
//
// A rule is a rewrite on the phoneme units of a word (toUnits: letters, with the digraphs ng/sh/th/ch and gh/kh/ph/dh/zh as
// one unit) in a context: "t becomes d between vowels", "the vowel of the second syllable falls in a word of three or more".
// It applies to every word whose units meet its context (exceptionless, after the Neogrammarians, Osthoff & Brugmann 1878),
// except a word whose result would not pass isEuphonicDrift or would fall below its fewest letters: that word keeps its form
// for that rule (a "conspiracy" toward pronounceable names, after Kisseberth 1970; blocking is a design simplification).
//
// A language (History.languages row) holds its rules in date order. A word said at year Y by speakers of language s is its
// form passed through the rules of every language on the path from the root down to s, each language's rules counted from its
// own split to the split of the next language on the path (to Y for s), and only those after the year the word entered
// (`from`: -1 for a native word, which is coined in the proto-language's sound pattern and then worn like every other word;
// the borrowing year for a loan or an exonym).

import { letterCount, isEuphonicDrift, toUnits, capitalizeName } from './words.ts'

/** The kinds of regular sound change (contract.ts SoundChangeKind mirrors these ids). */
export const SC = {
  Lenition: 0,
  Palatalisation: 1,
  VowelShift: 2,
  Raising: 3,
  Umlaut: 4,
  Syncope: 5,
  Apocope: 6,
  FinalLoss: 7,
  ClusterSimplify: 8,
  Monophthong: 9,
  HLoss: 10,
  Depalatalise: 11,
  Fortition: 12,
  Prothesis: 13,
} as const
export const SOUND_CHANGE_KINDS = 14

type Units = string[]

export interface RuleSpec {
  /** A short description for the tree panel ("t > d between vowels"). */
  label: string
  /** The rewrite on a word's units: a new list, or null when nothing in the word meets the rule. */
  apply(u: Units): Units | null
}

const VOWELS = 'aeiou'
const isV = (s: string | undefined): boolean => s !== undefined && s.length === 1 && VOWELS.indexOf(s) >= 0
const isC = (s: string | undefined): boolean => s !== undefined && s !== "'" && !isV(s)
const NASALS = ['n', 'm', 'ng']
const STOPS = ['p', 't', 'k', 'b', 'd', 'g']

function syllables(u: Units): number {
  let n = 0
  for (let i = 0; i < u.length; i++) if (isV(u[i]) && !isV(u[i - 1])) n++
  return n
}

/** Each unit equal to a `from` that meets `ctx` becomes its `to` (all at once, so chains do not feed each other). */
function substitute(pairs: ReadonlyArray<readonly [string, string]>, ctx: (u: Units, i: number) => boolean): (u: Units) => Units | null {
  return (u) => {
    let out: Units | null = null
    for (let i = 0; i < u.length; i++) {
      for (const [from, to] of pairs) {
        if (u[i] !== from || !ctx(u, i)) continue
        if (!out) out = u.slice()
        out[i] = to
        break
      }
    }
    return out
  }
}

const anywhere = (): boolean => true
const betweenVowels = (u: Units, i: number): boolean => isV(u[i - 1]) && isV(u[i + 1])
const beforeFront = (u: Units, i: number): boolean => u[i + 1] === 'i' || u[i + 1] === 'e'
/** Before a nasal that closes its syllable (a consonant or the word's end follows the nasal). */
const beforeClosingNasal = (u: Units, i: number): boolean => NASALS.indexOf(u[i + 1]) >= 0 && (i + 2 >= u.length || isC(u[i + 2]))
/** An i in the next syllable (one or more consonants between). */
const iFollows = (u: Units, i: number): boolean => {
  let j = i + 1
  if (!isC(u[j])) return false
  while (isC(u[j])) j++
  return u[j] === 'i'
}
const initialBeforeVowel = (u: Units, i: number): boolean => i === 0 && isV(u[1])
const initialBeforeBack = (u: Units, i: number): boolean => i === 0 && (u[1] === 'a' || u[1] === 'o' || u[1] === 'u')

function sub(label: string, pairs: ReadonlyArray<readonly [string, string]>, ctx: (u: Units, i: number) => boolean): RuleSpec {
  return { label, apply: substitute(pairs, ctx) }
}

/** The vowel of a syllable falls between consonants, a vowel following (3+ syllables): "vastara" > "vastra". */
function syncope(nth: 'second' | 'penult'): RuleSpec {
  return {
    label: nth === 'second' ? 'the second syllable\'s vowel falls in long words' : 'the vowel before the last syllable falls in long words',
    apply(u) {
      const syl = syllables(u)
      if (syl < 3) return null
      const want = nth === 'second' ? 2 : syl - 1
      let k = 0
      for (let i = 0; i < u.length; i++) {
        if (!isV(u[i]) || isV(u[i - 1])) continue
        if (++k !== want) continue
        if (isV(u[i + 1])) return null // (a diphthong does not fall)
        if (!isC(u[i - 1]) || !isC(u[i + 1]) || !isV(u[i + 2])) return null // (the cluster it leaves must pass the euphony gate)
        return u.slice(0, i).concat(u.slice(i + 1))
      }
      return null
    },
  }
}

function apocope(which: readonly string[], label: string): RuleSpec {
  return {
    label,
    apply(u) {
      const n = u.length
      if (n < 3 || syllables(u) < 3 || which.indexOf(u[n - 1]) < 0 || !isC(u[n - 2])) return null
      return u.slice(0, n - 1)
    },
  }
}

function finalLoss(which: readonly string[], label: string): RuleSpec {
  return {
    label,
    apply(u) {
      const n = u.length
      if (n < 3 || which.indexOf(u[n - 1]) < 0 || !isV(u[n - 2])) return null
      return u.slice(0, n - 1)
    },
  }
}

/** A final nasal after an unstressed vowel (a word of 2+ syllables) falls and the vowel lowers to a ("vashtarum" > "vashtara"). */
const nasalLowering: RuleSpec = {
  label: 'a final nasal falls after an unstressed vowel, which opens to a',
  apply(u) {
    const n = u.length
    if (n < 3 || (u[n - 1] !== 'm' && u[n - 1] !== 'n') || !isV(u[n - 2]) || isV(u[n - 3]) || syllables(u) < 2) return null
    const out = u.slice(0, n - 1)
    out[n - 2] = 'a'
    return out
  },
}

/** Inside a word, of two consonants (one in `first` before one in `second`), the first falls (kt > t), or the second (nd > n). */
function cluster(first: readonly string[], second: readonly string[] | null, label: string, dropSecond = false): RuleSpec {
  return {
    label,
    apply(u) {
      let out: Units | null = null
      const w = u.slice()
      for (let i = 1; i + 1 < w.length; i++) {
        if (!isV(w[i - 1]) || first.indexOf(w[i]) < 0 || !isC(w[i + 1]) || w[i + 1] === w[i]) continue
        if (second && second.indexOf(w[i + 1]) < 0) continue
        w.splice(dropSecond ? i + 1 : i, 1)
        out = w
      }
      return out
    },
  }
}

function monophthong(pairs: ReadonlyArray<readonly [string, string]>, label: string): RuleSpec {
  return {
    label,
    apply(u) {
      let out: Units | null = null
      const w = u.slice()
      for (let i = 0; i + 1 < w.length; i++) {
        if (!isV(w[i]) || !isV(w[i + 1])) continue
        for (const [d, m] of pairs) {
          if (w[i] + w[i + 1] !== d) continue
          w.splice(i, 2, m)
          out = w
          break
        }
      }
      return out
    },
  }
}

function hLoss(initial: boolean, medial: boolean, label: string): RuleSpec {
  return {
    label,
    apply(u) {
      let out: Units | null = null
      const w = u.slice()
      for (let i = w.length - 1; i >= 0; i--) {
        if (w[i] !== 'h') continue
        if ((initial && i === 0 && isV(w[1])) || (medial && i > 0 && isV(w[i - 1]) && isV(w[i + 1]))) {
          w.splice(i, 1)
          out = w
        }
      }
      return out
    },
  }
}

function prothesis(v: string): RuleSpec {
  return {
    label: `${v} is put before an initial s and a consonant`,
    apply(u) {
      if (u[0] !== 's' || !isC(u[1])) return null
      return [v].concat(u)
    },
  }
}

/**
 * The catalogue: SOUND_CHANGES[kind][variant]. Appending a variant to a kind is safe only for new histories (the variant is
 * drawn by index); keep the order.
 */
export const SOUND_CHANGES: ReadonlyArray<ReadonlyArray<RuleSpec>> = [
  // Lenition: a stop or fricative softens between vowels
  [
    sub('t > d between vowels', [['t', 'd']], betweenVowels),
    sub('k > g between vowels', [['k', 'g']], betweenVowels),
    sub('p > b between vowels', [['p', 'b']], betweenVowels),
    sub('b > v between vowels', [['b', 'v']], betweenVowels),
    sub('g > h between vowels', [['g', 'h']], betweenVowels),
    sub('k > h between vowels', [['k', 'h']], betweenVowels),
    sub('p > f between vowels', [['p', 'f']], betweenVowels),
    sub('d > th between vowels', [['d', 'th']], betweenVowels),
    sub('s > z between vowels', [['s', 'z']], betweenVowels),
    sub('t, k, p > d, g, b between vowels', [['t', 'd'], ['k', 'g'], ['p', 'b']], betweenVowels),
  ],
  // Palatalisation: a consonant before i or e becomes palatal
  [
    sub('k > ch before i and e', [['k', 'ch']], beforeFront),
    sub('s > sh before i and e', [['s', 'sh']], beforeFront),
    sub('g > y before i and e', [['g', 'y']], beforeFront),
    sub('t > ch before i and e', [['t', 'ch']], beforeFront),
  ],
  // VowelShift: a vowel moves everywhere
  [
    sub('a > o', [['a', 'o']], anywhere),
    sub('e > i', [['e', 'i']], anywhere),
    sub('o > u', [['o', 'u']], anywhere),
    sub('u > o', [['u', 'o']], anywhere),
    sub('i > e', [['i', 'e']], anywhere),
    sub('a > e', [['a', 'e']], anywhere),
    sub('a > o and o > u (a chain shift)', [['a', 'o'], ['o', 'u']], anywhere),
  ],
  // Raising: a vowel rises before a nasal that closes its syllable
  [
    sub('a > o before a closing nasal', [['a', 'o']], beforeClosingNasal),
    sub('e > i before a closing nasal', [['e', 'i']], beforeClosingNasal),
    sub('o > u before a closing nasal', [['o', 'u']], beforeClosingNasal),
  ],
  // Umlaut: a back vowel fronts when i follows in the next syllable
  [
    sub('a > e before an i in the next syllable', [['a', 'e']], iFollows),
    sub('o > e before an i in the next syllable', [['o', 'e']], iFollows),
    sub('u > i before an i in the next syllable', [['u', 'i']], iFollows),
  ],
  // Syncope
  [syncope('second'), syncope('penult')],
  // Apocope
  [apocope(['a', 'e', 'i', 'o', 'u'], 'a final vowel falls in long words'), apocope(['e', 'i'], 'a final e or i falls in long words')],
  // FinalLoss
  [
    finalLoss(['n'], 'a final n falls'),
    finalLoss(['s'], 'a final s falls'),
    finalLoss(['t', 'd', 'k'], 'a final t, d or k falls'),
    finalLoss(['m'], 'a final m falls'),
    finalLoss(['r'], 'a final r falls'),
    nasalLowering,
  ],
  // ClusterSimplify: the first of two consonants assimilates to the second
  [
    cluster(STOPS, STOPS, 'a stop falls before another (kt > t)'),
    cluster(['n'], ['d'], 'nd > n', true),
    cluster(['m'], ['b', 'p'], 'mb > m', true),
    cluster(['s'], ['t', 'k', 'p'], 's falls before a stop (st > t)'),
    cluster(['r'], null, 'r falls before a consonant'),
    cluster(['l'], null, 'l falls before a consonant'),
    cluster(['n'], ['s', 'sh', 'th', 'f'], 'n falls before a fricative'),
  ],
  // Monophthong: a diphthong becomes one vowel
  [
    monophthong([['ai', 'e'], ['ei', 'e']], 'ai, ei > e'),
    monophthong([['au', 'o'], ['ou', 'o']], 'au, ou > o'),
    monophthong([['oi', 'e'], ['ea', 'e'], ['ia', 'a'], ['io', 'o']], 'oi, ea > e; ia > a; io > o'),
  ],
  // HLoss
  [hLoss(true, false, 'an initial h falls'), hLoss(false, true, 'h falls between vowels'), hLoss(true, true, 'h falls')],
  // Depalatalise: a palatal turns back
  [
    sub('sh > s', [['sh', 's']], anywhere),
    sub('ch > sh', [['ch', 'sh']], anywhere),
    sub('ch > t', [['ch', 't']], anywhere),
    sub('y > l', [['y', 'l']], anywhere),
  ],
  // Fortition: a word-initial w, y or v hardens
  [
    sub('an initial w > v', [['w', 'v']], initialBeforeVowel),
    sub('an initial y > g before a, o and u', [['y', 'g']], initialBeforeBack),
    sub('an initial v > b', [['v', 'b']], initialBeforeVowel),
  ],
  // Prothesis: a vowel before an initial s-cluster
  [prothesis('e'), prothesis('i')],
]

/** The rule a language row holds: SOUND_CHANGES[kind][variant] (a description for an unknown pair). */
export function ruleSpec(kind: number, variant: number): RuleSpec | null {
  return SOUND_CHANGES[kind]?.[variant] ?? null
}

/**
 * One rule on one word (lower case, no spaces): the new word, or null when the rule does not reach it or the result would
 * not be euphonic (isEuphonicDrift) or shorter than `minLetters`.
 */
export function applyRule(word: string, kind: number, variant: number, minLetters = 2): string | null {
  const spec = ruleSpec(kind, variant)
  if (!spec) return null
  const units = toUnits(word).map((u) => u.s)
  const out = spec.apply(units)
  if (!out) return null
  const w = out.join('')
  if (w === word || letterCount(w) < minLetters || !isEuphonicDrift(w)) return null
  return w
}

/** What evolve needs of History.languages. */
export interface LanguageRules {
  count: number
  parent: Int16Array
  splitYear: Int16Array
  ruleStart: Int32Array
  ruleYear: Int16Array
  ruleKind: Uint8Array
  ruleVariant: Uint8Array
}

/** Languages from the root down to `node` (at most the tree's depth). */
export function lineage(L: Pick<LanguageRules, 'parent'>, node: number): number[] {
  const path: number[] = []
  for (let k = node; k >= 0; k = L.parent[k]) path.push(k)
  return path.reverse()
}

/** Whether `a` is `b` or one of its ancestors. */
export function isAncestor(L: Pick<LanguageRules, 'parent'>, a: number, b: number): boolean {
  for (let k = b; k >= 0; k = L.parent[k]) if (k === a) return true
  return false
}

/**
 * Calls fn(kind, variant, year) for each rule a word said by `node` at `to` has gone through since `from` (exclusive), in
 * date order (see the file comment).
 */
export function forEachRule(L: LanguageRules, node: number, from: number, to: number, fn: (kind: number, variant: number, year: number) => void): void {
  const path = lineage(L, node)
  for (let p = 0; p < path.length; p++) {
    const k = path[p]
    const end = p + 1 < path.length ? L.splitYear[path[p + 1]] : Infinity
    for (let r = L.ruleStart[k]; r < L.ruleStart[k + 1]; r++) {
      const y = L.ruleYear[r]
      if (y >= end || y > to) break
      if (y <= from) continue
      fn(L.ruleKind[r], L.ruleVariant[r], y)
    }
  }
}

/** How many rules forEachRule would give (the cache key of a spoken name). */
export function rulesCrossed(L: LanguageRules, node: number, from: number, to: number): number {
  let n = 0
  forEachRule(L, node, from, to, () => { n++ })
  return n
}

/**
 * A form (lower case; words split at spaces and hyphens, each worn on its own) as said at `to` by speakers of `node`, having
 * entered the language after `from`. Each word keeps at least 2 letters and the whole at least `minLetters`.
 */
export function evolve(L: LanguageRules, form: string, node: number, from: number, to: number, minLetters = 2): string {
  if (node < 0 || node >= L.count) return form
  const parts = form.split(/([ -])/)
  let total = letterCount(form)
  forEachRule(L, node, from, to, (kind, variant) => {
    for (let i = 0; i < parts.length; i += 2) {
      const w = parts[i]
      if (!w) continue
      const before = letterCount(w)
      const out = applyRule(w, kind, variant, 2)
      if (out === null) continue
      const after = letterCount(out)
      if (total - before + after < minLetters) continue
      parts[i] = out
      total += after - before
    }
  })
  return parts.join('')
}

/** evolve, capitalised as a name. */
export function evolveName(L: LanguageRules, form: string, node: number, from: number, to: number, minLetters = 3): string {
  return capitalizeName(evolve(L, form.toLowerCase(), node, from, to, minLetters))
}

/** Normalised similarity of two words: 1 - Levenshtein distance / the longer length (Levenshtein 1965). */
export function similarity(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m && !n) return 1
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    const t = prev; prev = cur; cur = t
  }
  return 1 - prev[n] / Math.max(m, n)
}
