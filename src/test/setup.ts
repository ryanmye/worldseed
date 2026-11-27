// vitest setup (vite.config.ts test.setupFiles): runs without a preset use 'off', every post-8cabf09 system off.
// The unit suite's goldens and off-identity tests were recorded against that world; the realistic default (owner decision (b),
// 2026-11-27) is guarded by G0 in hashBase.test.ts and by presets.test.ts, which name their preset. To move a test onto the
// realistic default, pass `preset: 'realistic'` in its options and re-record its goldens.
import { PRESET_DEFAULT } from '../sim/history/presets.ts'

PRESET_DEFAULT.name = 'off'
