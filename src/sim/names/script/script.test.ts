// typology: glyphs and transcription (language-typology-scripts.md §10 step 11, §8.4). Pure fixtures, fast.
import { describe, expect, it } from 'vitest'
import type { Languages, Scripts } from '../../../contract.ts'
import { createRng } from '../../rng.ts'
import { syntheticProfiles } from '../typology/profile.ts'
import { typoLanguage } from '../typology/words.ts'
import { buildRoot } from '../words.ts'
import { hamming, pathOf } from './glyphs.ts'
import { ScriptKind, signSet, soundsOf, transcribe, type ScriptSource } from './builders.ts'
import { isConsonant, isVowel, vowFeatures } from '../typology/phoneme.ts'

/** A one-language history: 100 lexicon words of a drawn typology language, and the scripts given. */
function fixture(rows: { type: number; parent: number; family: number; origin: number; direction: number }[], seed = 3): ScriptSource {
  const d = syntheticProfiles(seed, 1, 1)[0]
  const lang = typoLanguage({ ...d, syl: 1, style: 1 }, createRng(seed, 'fx'), 0)
  const r = createRng(seed, 'fx-words')
  const words: string[] = []
  for (let m = 0; m < 100; m++) words.push(buildRoot(lang, r))
  const lexStart = new Int32Array(101)
  for (let i = 0; i <= 100; i++) lexStart[i] = i
  const languages = { count: 1, parent: Int16Array.of(-1), lexStart, lexForm: words } as unknown as Languages
  const n = rows.length
  const scripts: Scripts = {
    count: n, type: Uint8Array.from(rows.map((x) => x.type)), direction: Uint8Array.from(rows.map((x) => x.direction)), origin: Uint8Array.from(rows.map((x) => x.origin)),
    parent: Int16Array.from(rows.map((x) => x.parent)), family: Int16Array.from(rows.map((x) => x.family)), people: new Int16Array(n), language: new Int16Array(n),
    year: new Int16Array(n), settlement: new Int32Array(n), name: rows.map((_, i) => `S${i}`),
  }
  return { scripts, languages }
}
const all = [0, 1, 2, 3, 4, 5].map((type, i) => ({ type, parent: -1, family: i, origin: 0, direction: 0 }))

describe('typology: glyphs (step 11)', () => {
  const h = fixture(all.concat([
    { type: 4, parent: 4, family: 4, origin: 2, direction: 0 }, // adapted from the alphabet
    { type: 4, parent: 4, family: 4, origin: 3, direction: 1 }, // reformed, direction flipped
  ]))
  it('is deterministic, distinct within a script, about three strokes a sign, and within budget', () => {
    const t0 = performance.now()
    const a = signSet(11, h, 4)!
    const ms = performance.now() - t0
    const paths = a.glyphs.map(pathOf)
    const again = signSet(11, { ...h }, 4)!
    expect(again.glyphs.map(pathOf)).toEqual(paths)
    expect(signSet(12, h, 4)!.glyphs.map(pathOf)).not.toEqual(paths)
    let close = 0, pairs = 0
    for (let i = 0; i < a.glyphs.length; i++) for (let j = i + 1; j < a.glyphs.length; j++) { pairs++; if (hamming(a.glyphs[i].sig, a.glyphs[j].sig) < 6) close++ }
    expect(close / pairs).toBeLessThan(0.02)
    let strokes = 0, n = 0
    for (let s = 0; s < 6; s++) {
      const set = signSet(11, h, s)!
      if (s === ScriptKind.Featural) continue
      for (const g of set.glyphs.slice(0, 60)) { strokes += g.count; n++ }
    }
    expect(strokes / n).toBeGreaterThanOrEqual(2.6)
    expect(strokes / n).toBeLessThanOrEqual(3.4)
    for (let s = 0; s < 6; s++) expect(signSet(11, h, s)!.glyphs.map(pathOf).join('').length).toBeLessThan(48 * 1024)
    expect(ms).toBeLessThan(60) // (the plan's 3 ms desktop gate is for a warm engine; a cold vitest worker is slower)
  })
  it('a daughter shares more of its parent than unrelated scripts share', () => {
    const p = signSet(11, h, 4)!, d = signSet(11, h, 6)!, u = signSet(11, h, 3)!
    const overlap = (x: typeof p, y: typeof p): number => {
      let sum = 0, k = 0
      for (const [key, i] of x.key) { const j = y.key.get(key); if (j === undefined) continue; sum += 1 - hamming(x.glyphs[i].sig, y.glyphs[j].sig) / 64; k++ }
      return k ? sum / k : 0
    }
    expect(overlap(p, d) - overlap(p, u)).toBeGreaterThanOrEqual(0.15)
    // the reformed, right-to-left daughter mirrors its glyphs
    expect(signSet(11, h, 7)!.direction).toBe(1)
  })
  it('transcribes by type: alphabet one sign a sound, abjad consonants only, syllabary by syllable, logograms with a determinative', () => {
    const snd = soundsOf(h, 0)
    expect(snd.cons.length).toBeGreaterThan(4)
    const form = h.languages!.lexForm[0]
    const units = [...form].map((c) => c.charCodeAt(0))
    const nC = units.filter(isConsonant).length, nV = units.filter(isVowel).length
    const alpha = transcribe(signSet(11, h, ScriptKind.Alphabet)!, form)
    expect(alpha.glyphs.length).toBe(nC + nV + units.filter((c) => isVowel(c) && vowFeatures(c).long).length)
    const abjad = transcribe(signSet(11, h, ScriptKind.Abjad)!, form)
    expect(abjad.glyphs.length).toBeGreaterThanOrEqual(nC)
    expect(abjad.glyphs.length).toBeLessThanOrEqual(nC + nV)
    const syl = signSet(11, h, ScriptKind.Syllabary)!
    expect(transcribe(syl, form).glyphs.length).toBeLessThanOrEqual(nC + nV)
    const logo = signSet(11, h, ScriptKind.Logosyllabic)!
    const tl = transcribe(logo, form, true)
    if (logo.determinative) expect(tl.glyphs[0]).toBe(logo.key.get('d'))
    const ab = transcribe(signSet(11, h, ScriptKind.Abugida)!, form)
    expect(ab.glyphs.length).toBeGreaterThan(0)
    expect(ab.glyphs.length).toBeLessThanOrEqual(2 * nC + nV) // (a coda: its base and the vowel killer)
    expect(transcribe(signSet(11, h, ScriptKind.Featural)!, form).glyphs.length).toBe(nC + nV)
  })
})
