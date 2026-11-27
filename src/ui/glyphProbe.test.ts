// typology: the glyph probe's fallback path with a mocked canvas.
import { describe, expect, it } from 'vitest'
import { createGlyphProbe, type ProbeCanvas } from './glyphProbe.ts'
import { romanize } from '../sim/names/typology/orthography.ts'
import { cons, Manner, Place, vow } from '../sim/names/typology/phoneme.ts'

/** A fake canvas whose "font" draws only the letters in `has` (others as the tofu box). */
function fakeCanvas(has: string): ProbeCanvas {
  let last = ''
  return {
    getContext: () => ({
      font: '', textBaseline: '', fillStyle: '',
      clearRect() { last = '' },
      fillText(s: string) { last = [...s].map((c) => (has.includes(c) ? c : '͸')).join('') },
      getImageData() { const d = new Uint8Array(24 * 24 * 4); for (let i = 0; i < last.length; i++) d[(last.charCodeAt(i) % 500) * 4 + 3] = 255; return { data: d } },
    }),
  }
}

describe('glyph probe', () => {
  it('marks tofu and dropped diacritics unsupported, and romanize falls back', () => {
    const p = createGlyphProbe(fakeCanvas('abcdefghijklmnopqrstuvwxyzţ'), 'x')
    expect(p('a')).toBe(true)
    expect(p('ṭ')).toBe(false)
    const retro = String.fromCharCode(cons(Place.Retroflex, Manner.Stop), vow(5))
    const o = 0 // (retroflex slot option 0: scholarly ṭ, fallback ţ)
    expect(romanize(retro, o, 'scholarly')).toBe('ṭa')
    expect(romanize(retro, o, 'scholarly', p)).toBe('ţa')
  })
})
