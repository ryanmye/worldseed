// Fun harness: the history options a run uses. `realistic` is today's defaults (what a new world from the start page gets:
// language drift on, lang=1). Other presets are looked up from the app's own preset expansion when it exists (lane/setup
// adds `preset=dramatic|realistic`); until it merges, asking for one fails loudly instead of guessing its switches.
// `extra` (--opts JSON) is merged on top, so any HistoryOptions switch can be tried by hand.
import * as contract from '../contract.ts'
import type { HistoryOptions } from '../contract.ts'

export interface RunOptions { preset: string; historyOptions: HistoryOptions; url: Record<string, string> }

type Expander = (name: string) => HistoryOptions | null | undefined
function appExpander(): Expander | null {
  const c = contract as unknown as Record<string, unknown>
  for (const name of ['expandPreset', 'presetOptions', 'historyPreset']) if (typeof c[name] === 'function') return c[name] as Expander
  return null
}

export function resolveRun(preset = 'realistic', extra: HistoryOptions = {}): RunOptions {
  const base: HistoryOptions = { language: true }
  const url: Record<string, string> = { lang: '1' }
  if (preset !== 'realistic') {
    // (lane N3: the preset is a HistoryOptions field since lane/setup: the simulation expands it, sim/history/presets.ts)
    if (preset === 'dramatic' || preset === 'off') base.preset = preset
    else {
      const ex = appExpander()
      const o = ex ? ex(preset) : null
      if (!o) throw new Error(`preset "${preset}" is unknown; pass --opts '{...}' instead`)
      Object.assign(base, o)
    }
    url.preset = preset
  }
  return { preset, historyOptions: { ...base, ...extra }, url }
}
