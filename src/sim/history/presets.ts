// presets: named bundles of HistoryOptions switches (EVALUATION.md §3 P1, §4 shared setup). URL `preset=realistic|dramatic`.
//   realistic  today's defaults: every post-8cabf09 system as its own default (off until its R29 flip). G0 holds.
//   dramatic   every merged system on, battles non-neutral and the disasters' Phase-2 feedback. Not realism-ratcheted: it is
//              guarded by the sanity bounds in presets.test.ts / presetStats.ts instead (EVALUATION.md §3 P1b).
// An explicit option always wins over the preset (expandPreset fills only the switches left undefined), so `preset=dramatic&battles=0`
// is the dramatic world without battles. A link without `preset` is a realistic one (old links keep their history).
//
// Sub-switches that are params, not options (MASTER-PLAN §3.3), travel as PresetParams: the runner reads them at set-up in place
// of the module defaults (DX.feedback, BATTLE_MODE.neutral), so a dramatic run never mutates the shared params.

import type { HistoryOptions, PresetName } from '../../contract.ts'

export const PRESET_NAMES: readonly PresetName[] = ['realistic', 'dramatic']

/** The boolean HistoryOptions switches a preset may set, in URL order (each is also a URL key: `<key>=1` / `<key>=0`). */
export const PRESET_SWITCHES = [
  'oaths', 'balance', 'arms', 'families', 'finance', 'society', 'beliefs', 'barriers', 'disasters', 'battles', 'causes',
] as const satisfies readonly (keyof HistoryOptions)[]
export type PresetSwitch = (typeof PRESET_SWITCHES)[number]

/** The switches each preset turns on (realistic: none; the systems keep their own defaults). */
export const PRESETS: Record<PresetName, Partial<Record<PresetSwitch, boolean>>> = {
  realistic: {},
  dramatic: {
    oaths: true, balance: true, arms: true, // grudges-and-oaths
    families: true, // merchant-families
    finance: true, // state-finances
    society: true, // society & secular cycles
    beliefs: true, barriers: true, // beliefs-and-deception, barriers (communication)
    disasters: true, // disasters (with DX.feedback below)
    battles: true, // battles (non-neutral below)
    causes: true, // the Why panel's records (recording only)
  },
}

/** Params a preset sets for the run (read at set-up instead of the module defaults). */
export interface PresetParams {
  /** DX.feedback (disasters Phase 2: storage exhaustion, malnutrition, relief). */
  dxFeedback?: boolean
  /** BATTLE_MODE.neutral (false: terrain, weather, supply, toll, tempo, naval and pretenders change outcomes). */
  battleNeutral?: boolean
}
export const PRESET_PARAMS: Record<PresetName, PresetParams> = {
  realistic: {},
  dramatic: { dxFeedback: true, battleNeutral: false },
}

export function isPresetName(x: unknown): x is PresetName {
  return x === 'realistic' || x === 'dramatic'
}

/**
 * The options with the preset's switches filled in where the options leave them undefined (explicit values win). Idempotent;
 * no preset (or realistic) returns `o` itself.
 */
export function expandPreset(o: HistoryOptions | undefined): HistoryOptions | undefined {
  const p = o?.preset
  if (!o || !p || p === 'realistic') return o
  const out: HistoryOptions = { ...o }
  for (const [k, v] of Object.entries(PRESETS[p]) as [PresetSwitch, boolean][]) if (out[k] === undefined) out[k] = v
  return out
}

/** The preset's params for a run with these options (empty for none or realistic). */
export function presetParams(o: HistoryOptions | undefined): PresetParams {
  const p = o?.preset
  return p ? PRESET_PARAMS[p] : {}
}

/**
 * The preset and per-switch overrides a URL asks for: `preset=realistic|dramatic` and `<switch>=1|0` for each PRESET_SWITCHES key
 * (`causes=1` is the old causal-explorer flag, unchanged). Unknown values are ignored. Realistic is written as no preset, so its
 * options (and the cache key and hashes) are exactly those of a link without one.
 */
export function presetOptionsFromParams(params: URLSearchParams): Pick<HistoryOptions, 'preset' | PresetSwitch> {
  const o: Pick<HistoryOptions, 'preset' | PresetSwitch> = {}
  const p = params.get('preset')
  if (p === 'dramatic') o.preset = p
  for (const k of PRESET_SWITCHES) {
    const v = params.get(k)
    if (v === '1') o[k] = true
    else if (v === '0') o[k] = false
  }
  return o
}

/** The URL keys presetOptionsFromParams reads (for links that must carry them along: share, seat, the landing's Start). */
export const PRESET_URL_KEYS: readonly string[] = ['preset', ...PRESET_SWITCHES]
