// Fun harness: the history options a run uses, from the app's own presets (src/sim/history/presets.ts): `realistic` (the
// default, what a new world from the start page gets), `dramatic` or `off`, plus language drift on (lang=1). The preset is
// named in the options (HistoryOptions.preset), so the run gets the preset's params too (DX.feedback, BATTLE_MODE.neutral) and a
// row's preset label is the history it measured, whatever PRESET_DEFAULT is (the unit suite pins it to 'off').
// `extra` (--opts JSON) is merged on top, so any HistoryOptions switch can be tried by hand (explicit values win over the preset).
import type { HistoryOptions } from '../contract.ts'
import { expandPreset, isPresetName, LINK_VERSION } from '../sim/history/presets.ts'

export interface RunOptions { preset: string; historyOptions: HistoryOptions; url: Record<string, string> }

export function resolveRun(preset = 'realistic', extra: HistoryOptions = {}): RunOptions {
  if (!isPresetName(preset)) throw new Error(`unknown preset "${preset}" (off, realistic or dramatic); pass --opts '{...}' for other switches`)
  // v=2: a link without `v` is version 1 and replays with preset 'off' (presetOptionsFromParams), whatever preset it was made with
  const url: Record<string, string> = { v: String(LINK_VERSION), lang: '1' }
  if (preset !== 'realistic') url.preset = preset
  return { preset, historyOptions: expandPreset({ language: true, ...extra, preset }), url }
}
