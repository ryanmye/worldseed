import { describe, expect, it } from 'vitest'
import { generateWorld } from '../index.ts'
import { simulateHistory } from './index.ts'
import { hashValue } from '../../historyCache.ts'
import { expandPreset, presetOptionsFromParams, presetParams, PRESETS, PRESET_SWITCHES, PRESET_URL_KEYS } from './presets.ts'
import type { HistoryOptions } from '../../contract.ts'

describe('presets', () => {
  it('realistic is no preset: expandPreset returns the options unchanged, no params', () => {
    const o: HistoryOptions = { years: 300, preset: 'realistic' }
    expect(expandPreset(o)).toBe(o)
    expect(expandPreset(undefined)).toBeUndefined()
    expect(presetParams(o)).toEqual({})
    expect(PRESETS.realistic).toEqual({})
  })

  it('dramatic turns every merged switch on, battles non-neutral and DX.feedback on', () => {
    const e = expandPreset({ preset: 'dramatic' })!
    for (const k of PRESET_SWITCHES) expect(e[k], k).toBe(true)
    expect(presetParams({ preset: 'dramatic' })).toEqual({ dxFeedback: true, battleNeutral: false })
  })

  it('an explicit switch wins over the preset; expansion is idempotent', () => {
    const e = expandPreset({ preset: 'dramatic', battles: false, disasters: false })!
    expect(e.battles).toBe(false)
    expect(e.disasters).toBe(false)
    expect(e.finance).toBe(true)
    expect(expandPreset(e)).toEqual(e)
  })

  it('URL: preset and per-switch keys parse, realistic writes no preset, unknown values are ignored', () => {
    expect(presetOptionsFromParams(new URLSearchParams('preset=dramatic&battles=0&causes=1'))).toEqual({ preset: 'dramatic', battles: false, causes: true })
    expect(presetOptionsFromParams(new URLSearchParams('preset=realistic'))).toEqual({})
    expect(presetOptionsFromParams(new URLSearchParams('preset=chaos&finance=yes'))).toEqual({})
    expect(presetOptionsFromParams(new URLSearchParams('seed=7&seat=polity:0:700'))).toEqual({})
    expect(PRESET_URL_KEYS).toContain('preset')
  })

  it('URL round trip: a share or seat link built from the page address keeps the preset keys', () => {
    const page = new URL('https://x.test/?seed=61343&preset=dramatic&disasters=0&lang=1')
    // what the seat controller and the share buttons do: set a param on the current address
    const seatLink = new URL(page.href)
    seatLink.searchParams.set('seat', 'polity:0:700')
    expect(presetOptionsFromParams(seatLink.searchParams)).toEqual(presetOptionsFromParams(page.searchParams))
    expect(presetOptionsFromParams(new URL(seatLink.href).searchParams)).toEqual({ preset: 'dramatic', disasters: false })
  })

  it('realistic preset gives the history of no preset; dramatic changes it (300 y, seed 7)', () => {
    const w = generateWorld(7)
    const plain = hashValue(simulateHistory(w, { years: 300 }))
    expect(hashValue(simulateHistory(w, { years: 300, preset: 'realistic' }))).toBe(plain)
    const dramatic = simulateHistory(w, { years: 300, preset: 'dramatic' })
    expect(hashValue(dramatic)).not.toBe(plain)
    // explicit per-switch options equal the preset (but for the params, which only a preset sets)
    expect(hashValue(simulateHistory(w, { years: 300, ...expandPreset({ preset: 'dramatic' }), preset: 'dramatic' }))).toBe(hashValue(dramatic))
  })
})
