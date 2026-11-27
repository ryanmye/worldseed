// typology: the stats harness (language-typology-scripts.md §8.1). Short lang=2 runs (the profiles depend on the world and its
// cradles only; 60 years founds every people) give each world's proto-languages; the pooled shares are compared with the WALS
// priors, with the balance gates (legacy-like signature, styles and syllable classes per world, bigram cosine of plain names)
// and pronounceability. `--sheet` prints the owner listening sheet (12 names per people, plain and scholarly); `--styles S`
// prints 10 place names per morphology style from world seed S (one proto-language per style: the seed's first people's draw
// with its style set to each style in turn).
//   node --experimental-strip-types --no-warnings src/sim/names/typology/typologyStats.ts [--sheet] [--styles S] [seeds...]

import { generateWorld, simulateHistory } from '../../index.ts'
import type { History } from '../../../contract.ts'
import { createRng } from '../../rng.ts'
import { spokenNameAt } from '../spoken.ts'
import { composeName, pickWeighted, buildRoot } from '../words.ts'
import { MEANING_CLASSES } from '../phonology.ts'
import { unpackTypo } from './inventory.ts'
import { isConsonant, isVowel, vowFeatures } from './phoneme.ts'
import { plainOk, romanize, repairOrtho, writable, drawOrtho } from './orthography.ts'
import { blocked } from './blocklist.ts'
import { TYPO } from './params.ts'
import { STYLE_NAMES, syntheticProfiles } from './profile.ts'
import { typoLanguage } from './words.ts'

interface Lang { seed: number; people: number; syl: number; tones: number; style: number; nCons: number; nVowels: number; nasal: boolean; names: string[] }

function protoLangs(h: History, seed: number): Lang[] {
  const L = h.languages!
  const out: Lang[] = []
  for (let n = 0; n < L.count; n++) {
    if (L.parent[n] >= 0) continue
    const b = unpackTypo(L.typo![n])
    const cons = new Set<number>(), vq = new Set<number>()
    for (let m = 0; m < 100; m++) {
      const r = L.lexStart[n * 100 + m]
      for (const ch of L.lexForm[r] ?? '') { const c = ch.charCodeAt(0); if (isConsonant(c)) cons.add(c); else if (isVowel(c)) vq.add(vowFeatures(c).q) }
    }
    const p = L.people[n]
    const names = h.settlements.filter((s) => s.people === p).map((s) => s.name)
    out.push({ seed, people: p, syl: b.syl, tones: b.tones, style: b.style, nCons: cons.size, nVowels: vq.size, nasal: !!((L.typo![n] >> 18) & 1), names })
  }
  return out
}

function bigrams(names: readonly string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const n of names) { const w = '^' + n.toLowerCase().replace(/[^a-z]/g, '') + '$'; for (let i = 0; i + 1 < w.length; i++) { const k = w.slice(i, i + 2); m.set(k, (m.get(k) ?? 0) + 1) } }
  return m
}
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let d = 0, na = 0, nb = 0
  for (const [k, x] of a) { na += x * x; const y = b.get(k); if (y) d += x * y }
  for (const y of b.values()) nb += y * y
  return d / Math.sqrt(na * nb || 1)
}
const share = (xs: readonly number[], k: number): number[] => { const c = new Array<number>(k).fill(0); for (const x of xs) c[x]++; return c.map((x) => +(x / Math.max(1, xs.length)).toFixed(3)) }

/** 10 place names per morphology style from world seed `seed` (see the file comment). */
export function styleSheet(seed: number): string[] {
  const out: string[] = []
  const base = syntheticProfiles(seed, 1, 1)[0]
  for (let style = 0; style < 5; style++) {
    const d = { ...base, style }
    const o0 = drawOrtho(createRng(seed, `names-ortho-sheet-${style}`))
    const lang = typoLanguage(d, createRng(seed, `names-typo-sheet-${style}`), o0)
    const t = lang.typo!
    t.ortho = repairOrtho(writable(t.cons, t.vowels, t.tones), o0)
    const rng = createRng(seed, `names-sheet-${style}`)
    const plain: string[] = [], sch: string[] = []
    for (let k = 0; plain.length < 10 && k < 200; k++) {
      const root = buildRoot(lang, rng)
      const cls = MEANING_CLASSES[k % 7]
      const opts = lang.affixes[cls]
      const f = rng.next() < 0.42 ? composeName(lang, root, opts[pickWeighted(rng, opts.map((o) => o.weight))]) : composeName(lang, root, undefined)
      if (f === null) continue
      const p = romanize(f, t.ortho, 'plain').replace(/(^|[ -])\S/g, (x) => x.toUpperCase())
      if (plain.indexOf(p) >= 0) continue
      plain.push(p)
      sch.push(romanize(f, t.ortho, 'scholarly').replace(/(^|[ -])\S/g, (x) => x.toUpperCase()))
    }
    out.push(`${STYLE_NAMES[style]} (syllables ${['simple', 'moderate', 'complex'][d.syl]}, tone ${['none', 'simple', 'complex'][d.tone]}, ${t.cons.length} consonants, ${t.vowels.length} vowels)`)
    out.push('  plain:     ' + plain.join(', '))
    out.push('  scholarly: ' + sch.join(', '))
  }
  return out
}

const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
if (argv[1] && /typologyStats\.ts$/.test(argv[1])) {
  const args = argv.slice(2)
  const sheet = args.includes('--sheet')
  const si = args.indexOf('--styles')
  if (si >= 0) {
    for (const l of styleSheet(Number(args[si + 1]))) console.log(l)
  } else {
    const seeds = args.filter((x) => /^\d+$/.test(x)).map(Number)
    const list = seeds.length ? seeds : [1, 7, 42, 1234]
    const all: Lang[] = []
    let worlds6 = 0, worldsOk = 0, names = 0, badPlain = 0, hits = 0, schOk = 0
    const cos: number[] = [], cos1: number[] = []
    for (const seed of list) {
      const h = simulateHistory(generateWorld(seed), { years: 60, language: true, typology: true })
      const ls = protoLangs(h, seed)
      all.push(...ls)
      if (ls.length >= 6) { worlds6++; if (new Set(ls.map((l) => l.style)).size >= 3 && new Set(ls.map((l) => l.syl)).size >= 2) worldsOk++ }
      for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) cos.push(cosine(bigrams(ls[i].names), bigrams(ls[j].names)))
      // the same measure on the lang=1 world (letters)
      const h1 = simulateHistory(generateWorld(seed), { years: 60, language: true })
      const by = h1.peoples.map((p) => h1.settlements.filter((s) => s.people === p.id).map((s) => s.name))
      for (let i = 0; i < by.length; i++) for (let j = i + 1; j < by.length; j++) cos1.push(cosine(bigrams(by[i]), bigrams(by[j])))
      for (const s of h.settlements) { names++; if (!plainOk(s.name)) badPlain++; if (blocked(s.name)) hits++ }
      for (let id = 0; id < h.settlements.length; id++) if (!/\p{M}/u.test(spokenNameAt(h, id, 60, -1, 'scholarly'))) schOk++
      if (sheet) {
        for (const l of ls) {
          const p = h.peoples[l.people]
          const ids = h.settlements.filter((s) => s.people === l.people).slice(0, 12).map((s) => s.id)
          console.log(`seed ${seed} · ${p.name} (${STYLE_NAMES[l.style]}, ${['simple', 'moderate', 'complex'][l.syl]} syllables, ${l.tones ? l.tones + ' tones' : 'no tone'}): ${ids.map((id) => `${h.settlements[id].name} [${spokenNameAt(h, id, h.settlements[id].foundedYear, -1, 'scholarly')}]`).join(', ')}`)
        }
      }
    }
    const legacyLike = all.filter((l) => l.tones === 0 && l.nVowels === 5 && l.syl >= 1 && l.style === 1 && !l.nasal && l.nCons >= 15 && l.nCons <= 25).length / all.length
    const invClass = all.map((l) => (l.nCons <= 14 ? 0 : l.nCons <= 18 ? 1 : l.nCons <= 25 ? 2 : l.nCons <= 33 ? 3 : 4))
    const meanCos = cos.reduce((a, b) => a + b, 0) / Math.max(1, cos.length)
    console.log(JSON.stringify({
      seeds: list, languages: all.length,
      syl: { got: share(all.map((l) => l.syl), 3), prior: TYPO.sylPrior },
      tone: { got: share(all.map((l) => (l.tones === 0 ? 0 : l.tones === 2 ? 1 : 2)), 3), prior: TYPO.tonePrior },
      style: { got: share(all.map((l) => l.style), 5), prior: TYPO.stylePrior },
      inventorySeen: { got: share(invClass, 5), prior: TYPO.invPrior, note: 'consonants seen in the proto lexicon (a lower bound on the inventory)' },
      nasal: +(all.filter((l) => l.nasal).length / all.length).toFixed(3),
      legacyLike: +legacyLike.toFixed(3), legacyLikeTarget: 0.15,
      worldsStylesOk: `${worldsOk}/${worlds6}`, target: '>= 80% of worlds with 6+ peoples',
      bigramCosine: +meanCos.toFixed(3), cosineTarget: 0.3, lang1SameMeasure: +(cos1.reduce((a, b) => a + b, 0) / Math.max(1, cos1.length)).toFixed(3), planBaselineRoots: 0.433,
      plainUnpronounceable: +(badPlain / names).toFixed(4), blocklistHits: hits, scholarlyNoCombining: +(schOk / names).toFixed(4),
    }, null, 1))
  }
}
