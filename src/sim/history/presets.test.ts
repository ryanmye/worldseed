import { afterEach, describe, expect, it } from 'vitest'
import { generateWorld } from '../index.ts'
import { simulateHistory } from './index.ts'
import { hashValue } from '../../historyCache.ts'
import { G0_OFF_GOLDENS, G0_YEARS, hashBase } from '../../hashBase.ts'
import {
  expandPreset, LINK_VERSION, PRESET_DEFAULT, presetOptionsFromParams, presetParams, PRESETS, PRESET_SWITCHES, PRESET_URL_KEYS,
} from './presets.ts'
import type { HistoryOptions, PresetName } from '../../contract.ts'

// (the suite's default preset is 'off', src/test/setup.ts; tests of the shipped default set PRESET_DEFAULT and restore it)
const suiteDefault = PRESET_DEFAULT.name
afterEach(() => { PRESET_DEFAULT.name = suiteDefault })
const REALISTIC_ON = ['oaths', 'balance', 'arms', 'finance', 'society', 'beliefs', 'barriers', 'disasters', 'battles'] as const

describe('presets', () => {
  it('the shipped default is realistic (the suite runs on off)', async () => {
    // a fresh module instance has the shipped value; this one was set by the test setup
    expect(suiteDefault).toBe('off')
    const src = await import('./presets.ts?raw')
    expect((src as unknown as { default: string }).default).toMatch(/PRESET_DEFAULT: \{ name: PresetName \} = \{ name: 'realistic' \}/)
  })

  it('realistic: the switches that pass the ratchet (REJUDGE.md), DX.feedback on, battles non-neutral; families, cold wars, causes left to their defaults', () => {
    const e = expandPreset({ preset: 'realistic' })
    for (const k of REALISTIC_ON) expect(e[k], k).toBe(true)
    for (const k of ['families', 'coldWars', 'warRestraint', 'causes'] as const) expect(e[k], k).toBeUndefined()
    expect(presetParams({ preset: 'realistic' })).toEqual({ dxFeedback: true, battleNeutral: false })
  })

  it('dramatic: every switch on; off: every switch off, no params', () => {
    const d = expandPreset({ preset: 'dramatic' })
    for (const k of PRESET_SWITCHES) expect(d[k], k).toBe(true)
    expect(presetParams({ preset: 'dramatic' })).toEqual({ dxFeedback: true, battleNeutral: false })
    const o = expandPreset({ preset: 'off' })
    for (const k of PRESET_SWITCHES) expect(o[k], k).toBe(false)
    expect(presetParams({ preset: 'off' })).toEqual({})
    expect(Object.keys(PRESETS).sort()).toEqual(['dramatic', 'off', 'realistic'])
  })

  it('no preset in the options is PRESET_DEFAULT', () => {
    PRESET_DEFAULT.name = 'realistic'
    expect({ ...expandPreset({}), preset: 'realistic' }).toEqual(expandPreset({ preset: 'realistic' }))
    PRESET_DEFAULT.name = 'off'
    expect({ ...expandPreset(undefined), preset: 'off' }).toEqual(expandPreset({ preset: 'off' }))
  })

  it('an explicit switch wins over the preset; expansion is idempotent', () => {
    const e = expandPreset({ preset: 'dramatic', battles: false, disasters: false })
    expect(e.battles).toBe(false)
    expect(e.disasters).toBe(false)
    expect(e.finance).toBe(true)
    expect(expandPreset(e)).toEqual(e)
  })

  it('URL: a link without v is version 1 (preset off); v=2 without preset is the default (written as none)', () => {
    const P = (q: string) => presetOptionsFromParams(new URLSearchParams(q))
    expect(LINK_VERSION).toBe(2)
    expect(P('seed=7')).toEqual({ preset: 'off' })
    expect(P('seed=7&seat=polity:0:700&o=1000:explore:5:12345')).toEqual({ preset: 'off' })
    expect(P('seed=7&v=2')).toEqual({})
    expect(P('seed=7&v=2&preset=realistic')).toEqual({})
    expect(P('seed=7&preset=realistic')).toEqual({})
    expect(P('seed=7&v=2&preset=dramatic&battles=0&causes=1')).toEqual({ preset: 'dramatic', battles: false, causes: true })
    expect(P('seed=7&v=2&preset=off')).toEqual({ preset: 'off' })
    expect(P('seed=7&causes=1')).toEqual({ preset: 'off', causes: true }) // (an old causal-explorer link)
    expect(P('v=2&preset=chaos&finance=yes')).toEqual({})
    expect(PRESET_URL_KEYS).toContain('v')
  })

  it('URL round trip: a share or seat link built from the page address keeps v and the preset keys', () => {
    for (const q of ['seed=61343&v=2&preset=dramatic&disasters=0&lang=1', 'seed=61343', 'seed=61343&v=2']) {
      const page = new URL('https://x.test/?' + q)
      const seatLink = new URL(page.href)
      seatLink.searchParams.set('seat', 'polity:0:700') // (what the seat controller and the share buttons do)
      expect(presetOptionsFromParams(new URL(seatLink.href).searchParams)).toEqual(presetOptionsFromParams(page.searchParams))
    }
  })

  it('realistic and dramatic change the history; off is the history before the presets (300 y, seed 7)', () => {
    const w = generateWorld(7)
    const run = (p: PresetName) => hashValue(simulateHistory(w, { years: 300, preset: p }))
    const off = run('off'), real = run('realistic'), dram = run('dramatic')
    expect(new Set([off, real, dram]).size).toBe(3)
    // explicit per-switch options equal the preset (with the preset's params, which only a preset sets)
    expect(hashValue(simulateHistory(w, { years: 300, ...expandPreset({ preset: 'dramatic' }) }))).toBe(dram)
  })

  it('an old link (no v) replays its old history under the shipped default: seed 1 at 2000 y is the pre-preset G0 hash', () => {
    PRESET_DEFAULT.name = 'realistic'
    const opts: HistoryOptions = { years: G0_YEARS, ...presetOptionsFromParams(new URLSearchParams('seed=1')) }
    expect(hashBase(simulateHistory(generateWorld(1), opts))).toBe(G0_OFF_GOLDENS[1]) // 923881e7cd3fe59b, recorded on 8cabf09
  }, 600_000)
})
