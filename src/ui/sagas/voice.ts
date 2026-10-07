// Sagas: the voice a saga is told in. Every sentence a generator writes comes from a phrase table: per key, the
// variants of the plain chronicle register and of the heightened legend register (kennings, epithets), with {slots}
// the generator fills from the recorded history. The seeded stream only chooses among a key's variants (each key
// cycles through all its variants in a seeded order before any repeats), never what is said, so the same subject
// of the same world reads the same every time, and two worlds (or two subjects) are worded differently.

import { createRng, type Rng } from '../../sim/rng.ts'

/** Per key: [chronicle variants, legend variants]; an empty legend list falls back to the chronicle's. */
export type PhraseTable = Record<string, readonly [readonly string[], readonly string[]]>

export type Vars = Record<string, string | number>

export class Voice {
  readonly legend: boolean
  private rng: Rng
  private order = new Map<string, { seq: number[]; k: number }>()
  private tables: PhraseTable[]

  constructor(seed: number, stream: string, legend: boolean, ...tables: PhraseTable[]) {
    this.legend = legend
    this.rng = createRng(seed, `saga:${stream}:${legend ? 'L' : 'C'}`)
    this.tables = tables
  }

  private variants(key: string): readonly string[] {
    for (const t of this.tables) {
      const e = t[key]
      if (!e) continue
      return this.legend && e[1].length > 0 ? e[1] : e[0]
    }
    return [`{${key}?}`]
  }

  /** The next variant of `key` (a seeded order, cycling), with its {slots} filled. */
  p(key: string, vars: Vars = {}): string {
    const vs = this.variants(key)
    let o = this.order.get(key)
    if (!o || o.seq.length !== vs.length) {
      const seq = vs.map((_, i) => i)
      this.rng.shuffle(seq)
      o = { seq, k: 0 }
      this.order.set(key, o)
    }
    const s = vs[o.seq[o.k % o.seq.length]]
    o.k++
    return fill(s, vars)
  }

  /** One of `xs`, by the seeded stream (for a choice the tables do not hold, such as which epithet of several fits). */
  one<T>(xs: readonly T[]): T {
    return xs[Math.min(xs.length - 1, Math.floor(this.rng.next() * xs.length))]
  }

  /** `chron` in the chronicle register, `leg` in the legend's (both already worded). */
  reg(chron: string, leg: string): string {
    return this.legend ? leg : chron
  }
}

/** Fills {slot}s; an unfilled slot stays visible as {slot} (so a gap shows in review rather than vanishing). */
export function fill(s: string, vars: Vars): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

// ---------------------------------------------------------------------------
// small English helpers

export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** "a", "a and b", "a, b and c". */
export function list(xs: readonly string[], and = 'and'): string {
  const v = xs.filter((x) => x.length > 0)
  if (v.length <= 1) return v[0] ?? ''
  return `${v.slice(0, -1).join(', ')} ${and} ${v[v.length - 1]}`
}

const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** "three", "forty-one", "1,200". */
export function num(n: number): string {
  n = Math.round(n)
  if (n >= 0 && n <= 20) return SMALL[n]
  if (n > 20 && n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + SMALL[n % 10] : '')
  return n.toLocaleString('en-US')
}

/** "once", "twice", "three times". */
export function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : n === 3 ? 'three times' : `${num(n)} times`
}

/** "1 town", "3 towns". */
export const plural = (n: number, one: string, many = one + 's') => `${num(n)} ${n === 1 ? one : many}`

/** A headcount in round words: "some 1,200 people", "about 48,000", "nearly a million". */
export function people(n: number): string {
  if (n < 1000) return `some ${Math.max(10, Math.round(n / 10) * 10).toLocaleString('en-US')}`
  if (n < 1e4) return `some ${(Math.round(n / 100) * 100).toLocaleString('en-US')}`
  if (n < 1e5) return `some ${(Math.round(n / 1000) * 1000).toLocaleString('en-US')}`
  if (n < 1e6) return `some ${(Math.round(n / 10000) * 10000).toLocaleString('en-US')}`
  const m = Math.round(n / 1e5) / 10
  return m === 1 ? 'about a million' : `some ${m.toLocaleString('en-US')} million`
}

/** "first", "second", ..., "tenth", else "11th". */
export function ordinal(n: number): string {
  const w = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth']
  if (n >= 0 && n < w.length) return w[n]
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${s}`
}

/** "a third", "half", "most" of something lost. */
export function shareWords(f: number): string {
  if (f >= 0.75) return 'nearly all'
  if (f >= 0.6) return 'most'
  if (f >= 0.45) return 'half'
  if (f >= 0.3) return 'a third'
  if (f >= 0.22) return 'a quarter'
  if (f >= 0.15) return 'a sixth'
  if (f >= 0.08) return 'one in ten'
  return 'a few'
}

/** "in 412" / "in the year 412": the plain year phrase (the voice varies it). */
export const yearOf = (y: number) => String(Math.round(y))

/** "the 1100s" for a year. */
export const centuryOf = (y: number) => (y < 100 ? 'the first century' : `the ${Math.floor(y / 100) * 100}s`)

/** "a" or "an" before a word. */
export const an = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`)

/** Years as a span: "412–470". */
export const span = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`)

/** Tidies a generated paragraph: doubled or stray punctuation, spaces, and a capital at each sentence start. */
export function polish(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.;:!?])/g, '$1')
    .replace(/;\s*\./g, '.')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+([,.;:!?])/g, '$1')
    // (a year below 100 reads as a count: "in the year 42")
    .replace(/\b([Ii]n|[Bb]y|[Ff]rom|[Ss]ince|[Uu]ntil) (\d{1,2})\b(?![,.]\d)/g, '$1 the year $2')
    .trim()
    .replace(/(^|[.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
}
