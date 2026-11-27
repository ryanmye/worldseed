// typology: inventories and syllable templates (language-typology-scripts.md §4.3). Pure in (draw, Rng).
//
// Consonants are filled series by series toward the drawn size, in a design order loosely after how common segments are
// cross-linguistically [A; to calibrate against PHOIBLE]: the core /p t k m n/ and a liquid, then /w j s/, voicing, /h ŋ/ and the
// other liquid, the fricatives f ʃ x z, the affricates tʃ ts dʒ, /ɲ/, and the series the profile switched on (2-5 places each,
// so a series stays coherent: never a lone ejective). When the switched-on series overflow the target, the optional singles
// go first, last added first. Vowels: 3 -> i a u, 5 -> i e a o u, up to 10 with front rounded and back unrounded vowels; long
// and nasal counterparts of 3-5 qualities; tone sets H/L or three levels plus contours. Templates: simple (C)V, moderate
// (C)(C)V(C) with a liquid or glide second, complex up to CCCVCC; clusters obey sonority sequencing (Clements 1990) with the
// s + stop exception, and each language samples which of them it allows.

import type { Rng } from '../../rng.ts'
import { cons, consFeatures, isConsonant, Laryngeal, Manner, Place, SEG, Secondary, sonority, Tone, vow, VQ } from './phoneme.ts'
import type { TypoDraw } from './profile.ts'
import { Series } from './profile.ts'
import { TYPO } from './params.ts'
import type { TypoProfile } from './types.ts'

const L = Laryngeal, P = Place, M = Manner

function sample<T>(rng: Rng, arr: readonly T[], k: number): T[] {
  const c = arr.slice()
  rng.shuffle(c)
  return c.slice(0, Math.max(0, Math.min(k, c.length)))
}

/** The members of a switched-on series, most usual first; `k` of them are taken. */
function seriesMembers(bit: number): number[] {
  switch (bit) {
    case Series.Aspirated: return [cons(P.Alveolar, M.Stop, L.Aspirated), cons(P.Velar, M.Stop, L.Aspirated), cons(P.Bilabial, M.Stop, L.Aspirated), cons(P.Postalveolar, M.Affricate, L.Aspirated), cons(P.Alveolar, M.Affricate, L.Aspirated)]
    case Series.Ejective: return [cons(P.Velar, M.Stop, L.Ejective), cons(P.Alveolar, M.Stop, L.Ejective), cons(P.Bilabial, M.Stop, L.Ejective), cons(P.Alveolar, M.Affricate, L.Ejective), cons(P.Postalveolar, M.Affricate, L.Ejective)]
    case Series.Implosive: return [cons(P.Bilabial, M.Stop, L.Implosive), cons(P.Alveolar, M.Stop, L.Implosive), cons(P.Palatal, M.Stop, L.Implosive), cons(P.Velar, M.Stop, L.Implosive)]
    case Series.Prenasal: return [cons(P.Bilabial, M.Stop, L.Prenasalised), cons(P.Alveolar, M.Stop, L.Prenasalised), cons(P.Velar, M.Stop, L.Prenasalised), cons(P.Postalveolar, M.Affricate, L.Prenasalised)]
    case Series.Retroflex: return [cons(P.Retroflex, M.Stop), cons(P.Retroflex, M.Nasal, L.Voiced), cons(P.Retroflex, M.Fricative), cons(P.Retroflex, M.Stop, L.Voiced), cons(P.Retroflex, M.Lateral, L.Voiced)]
    case Series.Uvular: return [SEG.q, SEG.X, SEG.R, SEG.G]
    case Series.Pharyngeal: return [SEG.hh, SEG.ain]
    case Series.LabialVelar: return [cons(P.LabialVelar, M.Stop), cons(P.LabialVelar, M.Stop, L.Voiced)]
    case Series.Labialised: return [cons(P.Velar, M.Stop, L.Voiceless, Secondary.Labialised), cons(P.Velar, M.Stop, L.Voiced, Secondary.Labialised), cons(P.Velar, M.Fricative, L.Voiceless, Secondary.Labialised)]
    case Series.Lateral: return [SEG.lh, SEG.tl]
    case Series.Clicks: return [cons(P.Alveolar, M.Click), cons(P.Dental, M.Click), cons(P.Postalveolar, M.Click), cons(P.Palatal, M.Click)]
    case Series.Dental: return [SEG.th, SEG.dh]
    default: return []
  }
}
const SERIES_ORDER = [Series.Aspirated, Series.Ejective, Series.Implosive, Series.Prenasal, Series.Retroflex, Series.Uvular, Series.Pharyngeal, Series.LabialVelar, Series.Labialised, Series.Lateral, Series.Clicks, Series.Dental]

/** Consonants that may stand in a cluster (plain voiceless or voiced, no secondary, not a click, implosive or prenasal). */
function clusterable(c: number): boolean {
  const f = consFeatures(c)
  return f.lar <= L.Voiced && f.sec === 0 && f.manner !== M.Click && f.place !== P.Pharyngeal && f.place !== P.Glottal && f.place !== P.LabialVelar
}

/** Onset cluster a+b obeys sonority sequencing (rising), or is s + stop. */
export function sspOnset(a: number, b: number): boolean {
  if (a === b) return false
  if (a === SEG.s && sonority(b) === 0) return consFeatures(b).lar === L.Voiceless
  return sonority(a) < sonority(b) && sonority(b) >= 3 && sonority(a) <= 2
}
/** Coda cluster a+b falls in sonority (or is s + stop at the end, "st"). */
export function sspCoda(a: number, b: number): boolean {
  if (a === b) return false
  if (a === SEG.s && sonority(b) === 0) return consFeatures(b).lar === L.Voiceless
  // a nasal before a stop or affricate shares its place (mp, nt, ŋk)
  if (sonority(a) === 3 && sonority(b) <= 1) { const pa = consFeatures(a).place, pb = consFeatures(b).place; return pa === pb || (pa === P.Alveolar && (pb === P.Postalveolar || pb === P.Dental)) }
  if (b === SEG.s && sonority(a) <= 1) return true // ("ks", "ts")
  return sonority(a) > sonority(b) && sonority(a) >= 3
}
const ch = (c: number): string => String.fromCharCode(c)

/** The sound system of a drawn profile (ortho, prefixes and patterns are filled by typology/words.ts). */
export function buildInventory(d: TypoDraw, rng: Rng): TypoProfile {
  const n = d.nCons
  const liquid = rng.next() < 0.6 ? SEG.l : SEG.r
  const otherLiquid = liquid === SEG.l ? SEG.r : SEG.l
  const core = [SEG.p, SEG.t, SEG.k, SEG.m, SEG.n, liquid]
  const optional: number[] = [SEG.w, SEG.y, SEG.s]
  if (d.series & Series.Voicing) optional.push(SEG.b, SEG.d, SEG.g)
  optional.push(SEG.h, SEG.ng, otherLiquid, SEG.f, SEG.sh, SEG.x, SEG.z, SEG.ch, SEG.ts, SEG.j, SEG.ny)
  // the extras for large inventories (after the series)
  const extras: number[] = [SEG.v, SEG.gh, SEG.zh, SEG.dz, SEG.glottal, SEG.rt, cons(P.Palatal, M.Stop), cons(P.Palatal, M.Lateral, L.Voiced), cons(P.Bilabial, M.Fricative)]
  if (!(d.series & Series.Voicing)) extras.unshift(SEG.b, SEG.d, SEG.g)
  const have = new Set<number>(core)
  const series: number[][] = []
  for (const bit of SERIES_ORDER) {
    if (!(d.series & bit)) continue
    if (bit === Series.Clicks && d.inv < 2) continue
    const all = seriesMembers(bit)
    const k = Math.min(all.length, 2 + rng.int(0, Math.max(0, Math.min(3, all.length - 2))))
    series.push(all.slice(0, k))
  }
  // fit: core + series + optional (in order) up to n; series trimmed to 2 then dropped (last first) when they overflow
  let total = core.length + series.reduce((a, s) => a + s.length, 0)
  for (let i = series.length - 1; i >= 0 && total > n; i--) while (series[i].length > 2 && total > n) { series[i].pop(); total-- }
  while (series.length && total > n) { total -= series[series.length - 1].length; series.pop() }
  const out: number[] = core.slice()
  for (const s of series) for (const c of s) if (!have.has(c)) { have.add(c); out.push(c) }
  for (const c of optional) { if (out.length >= n) break; if (!have.has(c)) { have.add(c); out.push(c) } }
  for (const c of extras) { if (out.length >= n) break; if (!have.has(c)) { have.add(c); out.push(c) } }

  // vowels
  const qual: number[] = []
  const base5 = [VQ.i, VQ.e, VQ.a, VQ.o, VQ.u]
  if (d.nVowels <= 3) qual.push(VQ.i, VQ.a, VQ.u)
  else if (d.nVowels === 4) qual.push(VQ.i, VQ.a, VQ.u, rng.next() < 0.5 ? VQ.e : VQ.o)
  else {
    qual.push(...base5)
    const add = sample(rng, rng.next() < 0.5 ? [VQ.ɛ, VQ.ɔ, VQ.ə, VQ.ɨ, VQ.y, VQ.ɯ, VQ.ø, VQ.ɑ] : [VQ.ə, VQ.ɨ, VQ.y, VQ.ø, VQ.ɯ, VQ.ɛ, VQ.ɔ, VQ.œ], 8)
    // the 7-vowel systems most often add the open-mid pair together
    if (d.nVowels >= 7 && rng.next() < 0.5) { add.splice(add.indexOf(VQ.ɛ), 1); add.splice(add.indexOf(VQ.ɔ), 1); add.unshift(VQ.ɛ, VQ.ɔ) }
    for (const v of add) { if (qual.length >= d.nVowels) break; if (qual.indexOf(v) < 0) qual.push(v) }
  }
  const vowels = qual.slice()
  const qOf = (v: number): number => Math.floor((v - 0xf000) / 24)
  if (d.length) for (const v of sample(rng, qual, 3 + rng.int(0, Math.min(2, qual.length - 3)))) vowels.push(vow(qOf(v), 1))
  if (d.nasal) for (const v of sample(rng, qual, 3 + rng.int(0, Math.min(2, qual.length - 3)))) vowels.push(vow(qOf(v), 0, 1))
  const tones: number[] = d.tone === 0 ? [] : d.tone === 1 ? [Tone.High, Tone.Low] : [Tone.High, Tone.Mid, Tone.Low, ...sample(rng, [Tone.Rising, Tone.Falling], 1 + rng.int(0, 1))]

  // template
  let onsetMax = 1, codaMax = 0, finalMax = 0
  const cvOnly = d.syl === 0 && rng.next() < TYPO.cvOnly
  if (d.syl === 1) { onsetMax = 2; codaMax = 1; finalMax = 1 }
  if (d.syl === 2) { onsetMax = 2 + rng.int(0, 1); codaMax = 2 + (rng.next() < 0.3 ? 1 : 0); finalMax = 2 }
  const plain = out.filter(clusterable)
  const onsetPool: string[] = []
  if (onsetMax >= 2) {
    for (const a of plain) for (const b of plain) {
      if (!sspOnset(a, b)) continue
      if (d.syl === 1 && sonority(b) < 4) continue // (moderate: the second must be a liquid or glide)
      if (d.syl === 1 && a === SEG.s && sonority(b) === 0) continue
      if (sonority(b) === 3 && a !== SEG.s && a !== SEG.sh && a !== SEG.k && a !== SEG.g) continue // (obstruent + nasal: only sn, kn-like)
      if (sonority(a) === 1) continue // (no affricate first)
      const fa = consFeatures(a), fb = consFeatures(b)
      if (fa.place === fb.place && fb.manner !== M.Approximant && fb.manner !== M.Trill && fb.manner !== M.Tap) continue // (no tl, dl: homorganic stop + lateral)
      if ((a === SEG.y || a === SEG.w) || (b === SEG.y && fa.place === P.Palatal)) continue
      onsetPool.push(ch(a) + ch(b))
    }
  }
  const onsets = sample(rng, onsetPool, d.syl === 1 ? 3 + rng.int(0, 5) : 5 + rng.int(0, 7))
  if (onsetMax >= 3 && have.has(SEG.s)) {
    for (const c of onsets.slice()) {
      if (sspOnset(SEG.s, c.charCodeAt(0)) && sonority(c.charCodeAt(1)) >= 4 && rng.next() < 0.5) onsets.push(ch(SEG.s) + c)
    }
  }
  const codaPool = out.filter((c) => clusterable(c) && (d.syl === 2 || sonority(c) >= 2) && c !== SEG.h && c !== SEG.w && c !== SEG.y)
  const codas = codaMax ? sample(rng, codaPool, d.syl === 1 ? 3 + rng.int(0, 3) : 5 + rng.int(0, 5)) : []
  const finals = finalMax ? sample(rng, codas, Math.max(1, Math.min(codas.length, (d.syl === 1 ? 2 : 4) + rng.int(0, 3)))) : []
  const fcPool: string[] = []
  if (finalMax >= 2) for (const a of codas) for (const b of codas) if (sspCoda(a, b)) fcPool.push(ch(a) + ch(b))
  const finalClusters = sample(rng, fcPool, 2 + rng.int(0, 6))

  return {
    draw: d, cons: out, vowels, tones, onsetMax, codaMax, finalMax, cvOnly, onsets, codas, finals, finalClusters,
    join: 0, prefixes: [], patterns: [], ortho: 0, bits: 0,
  }
}

/**
 * Languages.typo: bits 0-1 onsetMax, 2-3 codaMax, 4-6 tones (0 none, else the number of tones up to 5 and 7 for 6+), 7 harmony,
 * 8-10 MorphStyle, 11 headInitial, 12 class prefixes, 13-14 syllable class, 15 cvOnly, 16-17 finalMax, 18 nasal vowels, 19 length.
 */
export function packTypo(t: TypoProfile): number {
  const d = t.draw
  return ((t.onsetMax & 3) | ((t.codaMax & 3) << 2) | ((Math.min(7, t.tones.length) & 7) << 4) | ((d.harmony ? 1 : 0) << 7) | ((d.style & 7) << 8) |
    ((d.headInitial ? 1 : 0) << 11) | ((t.prefixes.length ? 1 : 0) << 12) | ((d.syl & 3) << 13) | ((t.cvOnly ? 1 : 0) << 15) | ((t.finalMax & 3) << 16) |
    ((d.nasal ? 1 : 0) << 18) | ((d.length ? 1 : 0) << 19)) >>> 0
}
export interface TypoBits { onsetMax: number; codaMax: number; tones: number; harmony: boolean; style: number; headInitial: boolean; prefixes: boolean; syl: number; cvOnly: boolean; finalMax: number }
export function unpackTypo(b: number): TypoBits {
  return {
    onsetMax: b & 3, codaMax: (b >> 2) & 3, tones: (b >> 4) & 7, harmony: !!((b >> 7) & 1), style: (b >> 8) & 7, headInitial: !!((b >> 11) & 1),
    prefixes: !!((b >> 12) & 1), syl: (b >> 13) & 3, cvOnly: !!((b >> 15) & 1), finalMax: (b >> 16) & 3,
  }
}
export { isConsonant }
