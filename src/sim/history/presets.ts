// presets: named bundles of HistoryOptions switches (EVALUATION.md §3 P1, §4 shared setup; owner decision (b), 2026-11-27).
//   realistic  THE DEFAULT (PRESET_DEFAULT): the merged systems that pass the noise-aware realism ratchet together (REJUDGE.md
//              "all-on + DX.feedback" minus cold wars: 0.371, z -0.03): grudges (oaths, balance, arms), finance, beliefs and
//              barriers, battles with their modifiers, society, disasters with DX.feedback. Families stay at their default (off:
//              families + FAMILY.feedback is MARGINAL); cold wars, absentee and governments stay off (realistic does not name governments: its module default, off). G0 = the new goldens.
//   dramatic   every merged system on: realistic plus families, cold wars with war restraint, absentee rulers, governments (city-states) and causes. Not realism-ratcheted:
//              guarded by the sanity bounds of presetStats.ts (EVALUATION.md §3 P1b). Known caveat: with coldWars on,
//              zipf1500.zeta fails the noise-aware ratchet on one of 4 seeds (1234; REJUDGE.md), pending a 22-seed sweep.
//   off        every post-8cabf09 system off: the history before the presets. G0-off (G0_OFF_GOLDENS) is its identity; links
//              without `v=` (made before the presets) replay with it, so old share and seat links keep their history.
// An explicit option always wins over the preset (expandPreset fills only the switches left undefined), so `preset=dramatic&battles=0`
// is the dramatic world without battles.
//
// Sub-switches that are params, not options (MASTER-PLAN §3.3), travel as PresetParams: the runner reads them at set-up in place
// of the module defaults (DX.feedback, BATTLE_MODE.neutral), so a run never mutates the shared params.
//
// Link version (URL `v=`): absent or 1, a link made before the presets (every switch off: preset 'off' unless the link names one);
// 2, the presets (no `preset=` is realistic). New worlds write v=2.

import type { HistoryOptions, PresetName } from '../../contract.ts'
import type { BattleTerms } from './battles/params.ts'

export const PRESET_NAMES: readonly PresetName[] = ['off', 'realistic', 'dramatic']

/** The link version new worlds write (URL `v=`); a link without `v` is version 1 (preset 'off'). */
export const LINK_VERSION = 2

/** The boolean HistoryOptions switches a preset sets, in URL order (each is also a URL key: `<key>=1` / `<key>=0`). */
export const PRESET_SWITCHES = [
  'oaths', 'balance', 'arms', 'families', 'finance', 'society', 'beliefs', 'barriers', 'disasters', 'battles', 'coldWars',
  'warRestraint', 'absentee', 'causes', 'governments',
] as const satisfies readonly (keyof HistoryOptions)[]
export type PresetSwitch = (typeof PRESET_SWITCHES)[number]

const REALISTIC: Partial<Record<PresetSwitch, boolean>> = {
  oaths: true, balance: true, arms: true, // grudges-and-oaths
  finance: true, // state-finances
  society: true, // society & secular cycles
  beliefs: true, barriers: true, // beliefs-and-deception, barriers (communication)
  disasters: true, // disasters (with DX.feedback: without it, disasters fail the ratchet; REJUDGE.md)
  battles: true, // battles, with the modifiers (BATTLE_MODE.neutral false)
}

/** The switches each preset sets (a switch not named keeps its module default: off for every post-8cabf09 system). */
export const PRESETS: Record<PresetName, Partial<Record<PresetSwitch, boolean>>> = {
  off: Object.fromEntries(PRESET_SWITCHES.map((k) => [k, false])),
  realistic: REALISTIC,
  dramatic: {
    ...REALISTIC,
    families: true, // merchant-families
    coldWars: true, warRestraint: true, // cold wars and great-power war restraint (barriers-coldwar §3, D-CW1)
    absentee: true, // absentee and do-nothing AI rulers (absentee-rulers; merged 17ae06d)
    governments: true, // forms of government and city-states (lane/citystates; merged df6a137)
    causes: true, // the Why panel's records (recording only)
  },
}

/** Params a preset sets for the run (read at set-up instead of the module defaults). */
export interface PresetParams {
  /** DX.feedback (disasters Phase 2: storage exhaustion, malnutrition, relief). */
  dxFeedback?: boolean
  /** BATTLE_MODE.neutral (false: terrain, weather, supply, toll, tempo, naval and pretenders change outcomes). */
  battleNeutral?: boolean
  /** Battle terms (battles/params.ts BATTLE_TERMS, lane N5): campaigning season, height, mud, frozen rivers; unset ones stay off. */
  battleTerms?: Partial<BattleTerms>
}
export const PRESET_PARAMS: Record<PresetName, PresetParams> = {
  off: {},
  realistic: { dxFeedback: true, battleNeutral: false },
  dramatic: { dxFeedback: true, battleNeutral: false },
}

/**
 * The preset of a run whose options name none. Mutable for harnesses and the test setup (src/test/setup.ts pins the unit
 * suite to 'off', the identity its goldens were recorded against); the app and the CLI scripts run 'realistic'.
 */
export const PRESET_DEFAULT: { name: PresetName } = { name: 'realistic' }

export function isPresetName(x: unknown): x is PresetName {
  return x === 'off' || x === 'realistic' || x === 'dramatic'
}

/** The preset a run with these options uses. */
export function presetOf(o: HistoryOptions | undefined): PresetName {
  return o?.preset ?? PRESET_DEFAULT.name
}

/** The options with the preset's switches filled in where the options leave them undefined (explicit values win). Idempotent. */
export function expandPreset(o: HistoryOptions | undefined): HistoryOptions {
  const out: HistoryOptions = { ...(o ?? {}) }
  for (const [k, v] of Object.entries(PRESETS[presetOf(o)]) as [PresetSwitch, boolean][]) if (out[k] === undefined) out[k] = v
  return out
}

/** The preset's params for a run with these options. */
export function presetParams(o: HistoryOptions | undefined): PresetParams {
  return PRESET_PARAMS[presetOf(o)]
}

/**
 * The preset and per-switch overrides a URL asks for: `v=` (link version), `preset=off|realistic|dramatic` and `<switch>=1|0`
 * for each PRESET_SWITCHES key (`causes=1` is the old causal-explorer flag, unchanged). A link without `v` (version 1, made before
 * the presets) and without `preset` is preset 'off'; with v=2 no preset is realistic, written as none (the default), so its options
 * are `{}`. Unknown values are ignored.
 */
export function presetOptionsFromParams(params: URLSearchParams): Pick<HistoryOptions, 'preset' | PresetSwitch> {
  const o: Pick<HistoryOptions, 'preset' | PresetSwitch> = {}
  const p = params.get('preset')
  const v = Number.parseInt(params.get('v') ?? '1', 10)
  if (p === 'dramatic' || p === 'off') o.preset = p
  else if (p !== 'realistic' && !(v >= LINK_VERSION)) o.preset = 'off'
  for (const k of PRESET_SWITCHES) {
    const x = params.get(k)
    if (x === '1') o[k] = true
    else if (x === '0') o[k] = false
  }
  return o
}

/** The URL keys presetOptionsFromParams reads. */
export const PRESET_URL_KEYS: readonly string[] = ['v', 'preset', ...PRESET_SWITCHES]
