# lane/setup progress (shared setup, EVALUATION.md §4)

Worktree /home/claude/wsx-setup, branch lane/setup. Runs are in /home/claude/runs/setup/.

## Done
1. **Preset URL** (`src/sim/history/presets.ts`; `HistoryOptions.preset`; runner `expandPreset` + `presetParams` → `createDisasters(…, feedback)`, `createBattles(s, neutral)`; main.ts `presetOptionsFromParams`). Dramatic = oaths, balance, arms, families, finance, society, beliefs, barriers, disasters (+DX.feedback), battles (neutral=false), coldWars, warRestraint, causes. Commit 1 + coldwar follow-up.
2. **Landing toggle** (landing.ts/css: Realistic/Dramatic radio pills, "Or take a throne" → `?seed=61343&seat=polity:0:700[&preset=dramatic]&lang=1`).
3. **Noise ratchet** confirmed on main: `npm run realism:check -- --noise docs/realism-noise.jsonl` → OK 0.372 → 0.400 (tol 0.116). Added `npm run realism:check:noise`, README section.
4. **Registry**: no duplicate values in code (all worktrees); `src/registry.test.ts` enum-uniqueness test; `docs/REGISTRY.md`; MASTER-PLAN addendum "registry reconciliation".
5. **Plan freeze**: MASTER-PLAN "Phase freeze (2026-11-27, outside evaluation)" (plans dir, not in git), with pointers to Bots and primer and Resumability.

## Gates so far (before coldwar merge)
- G0 `--preset realistic`: OK 1/42/1234 (runs/setup/g0-real.log). typecheck OK, build OK, presets+registry tests OK.

## Current / next
- Dramatic sanity rerun with coldWars on: `node --experimental-strip-types --no-warnings src/sim/history/presetStats.ts 1 7 42 1234 --out /home/claude/runs/setup/dramatic.jsonl` (resumes; log dramatic.log). Realistic rows are in runs/setup/realistic.jsonl, pre-coldwar Dramatic rows in dramatic-pre-coldwar.jsonl.
- Then set SANITY_BOUNDS and the header numbers; re-run G0 (realistic) + tests after the merge; build; Playwright smoke `/home/claude/scratch-setup/smoke.mjs <preview-url>`; push; report.
- Bots and primer: there is no docs/PLAYER_PRIMER.md or persona file on main yet, so Lane 2/4 must add the preset toggle when they create them.
