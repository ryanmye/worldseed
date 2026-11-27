// Fun harness drift test (cheap, no simulation): new gameplay forces a bot and primer update.
// - every DecisionKind is handled by the personas and named in the primer;
// - every SeatOptionKey has a stance in every persona table and a button word;
// - every order kind a card can give has a type tag (seatFormat.ts) the personas read;
// - every keyboard shortcut in src is listed in the primer;
// - the primer's and personas' versions match their docs.
import { describe, expect, it } from 'vitest'
import { DecisionKind, SeatOptionKey, describeDecisionKinds } from '../contract.ts'
import { AGGRESSIVE, AMBITION_STANCE, HANDLED_DECISION_KINDS, PERSONA_VERSION } from './personas.ts'
import { OPTION_LABEL } from '../ui/seat/seatFormat.ts'
import { PRIMER_VERSION } from './primer.ts'

import primer from '../../docs/PLAYER_PRIMER.md?raw'
import personasDoc from '../../docs/bots/PERSONAS.md?raw'

/** Every source file of the app (Vite's glob, as text). */
const SOURCES = import.meta.glob(['../**/*.ts', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('fun-harness coverage drift', () => {
  it('versions match their docs', () => {
    expect(primer).toMatch(new RegExp(`^Version: ${PRIMER_VERSION}\\b`, 'm'))
    expect(personasDoc).toMatch(new RegExp(`^Version: ${PERSONA_VERSION}\\b`, 'm'))
  })
  it('every decision kind is handled and in the primer', () => {
    const DK = describeDecisionKinds()
    for (const k of Object.values(DecisionKind) as number[]) {
      expect(HANDLED_DECISION_KINDS.has(k), `DecisionKind ${k} (${DK[k]?.label}) has no persona handling: update personas.ts`).toBe(true)
    }
    expect(Object.values(DecisionKind).length).toBe(HANDLED_DECISION_KINDS.size)
  })
  it('every seat option has a stance in every persona and a label in the primer', () => {
    for (const k of Object.values(SeatOptionKey) as number[]) {
      expect(k in AGGRESSIVE, `option ${k}: no aggressive stance`).toBe(true)
      for (const [a, st] of Object.entries(AMBITION_STANCE)) expect(k in st, `option ${k}: no stance for ambition ${a}`).toBe(true)
      const label = OPTION_LABEL[k]
      expect(label, `option ${k}: no button word`).toBeTruthy()
      if (k !== SeatOptionKey.NameHeir) expect(primer.includes(label), `option "${label}" is not in docs/PLAYER_PRIMER.md`).toBe(true)
    }
  })
  it('every keyboard shortcut is in the primer', () => {
    const missing: string[] = []
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100)
    for (const [f, src] of Object.entries(SOURCES)) {
      for (const m of src.matchAll(/addShortcut\(\{\s*keys:\s*\[([^\]]*)\]/g)) {
        const first = m[1].split(',')[0].trim().replace(/^'|'$/g, '')
        const shown = first === ' ' ? 'Space' : first === 'ArrowLeft' || first === 'ArrowRight' ? '←' : first === 'Escape' ? 'Esc' : first === 'PageUp' || first === 'PageDown' ? (first === 'PageUp' ? 'X' : 'Z') : first.length === 1 ? first.toUpperCase() : first
        if (!primer.includes('`' + shown) && !primer.includes(shown + '`') && !primer.includes(`\`${first}\``)) missing.push(`${shown} (${f})`)
      }
      for (const m of src.matchAll(/keys:\s*\[([^\]]*)\],\s*\n?\s*label: '([^']*)'/g)) {
        const label = m[2]
        const parts = label.split(/\s*\/\s*|\s*–\s*/).filter(Boolean)
        if (!parts.some((x: string) => primer.includes(x))) missing.push(`${label} (${f})`)
      }
    }
    expect(missing, `shortcuts missing from docs/PLAYER_PRIMER.md: ${missing.join(', ')}`).toEqual([])
  })
})
