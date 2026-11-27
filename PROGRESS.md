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

## Owner decision (b) (coordinator, 2026-11-27): Realistic = new default
- Done (commit 6fe71b1+): presets off/realistic/dramatic; PRESET_DEFAULT 'realistic'; Realistic = oaths, balance, arms, finance, beliefs, barriers, battles, society, disasters + DX.feedback; link version v=2 (no v → preset off); g0.ts checks G0 (default) + G0-off; suite pinned to off via src/test/setup.ts (vite.config test.setupFiles); stale battles doc in contract.ts fixed; README/REGISTRY docs.
- Running (resumable; rerun the scripts to continue):
  - realism re-baseline: /home/claude/runs/setup/realism-runner.sh and realism-runner-b.sh → runs/setup/realism/<config>.jsonl (base, j100d1-9, j500d1, j1000d1, j100s1, sweep18); progress.log
  - G0 new values: runs/setup/g0-new.log (`node --experimental-strip-types scripts/g0.ts 2000 1 42 1234`)
  - sanity: runs/setup/{off,realistic,dramatic}.jsonl (presetStats.ts --out)
- Next: fill G0_GOLDENS (src/hashBase.ts, PENDING*), _LANE_BRIEF.md, MASTER-PLAN §2; assemble docs/realism-baseline.jsonl (base), docs/realism-sweep22.jsonl (base+sweep18), docs/realism-noise.jsonl (12 jitters); update REALISM_BASELINE and REALISM_SWEEP_BASELINE from realismStats.test output; run presets/registry/hashBase/realismStats tests; build; smoke; push.

## Status after restart (resumed)
- Realism re-baseline DONE (runs complete, 70 rows): baseline 0.371197 48/104; sweep22 0.371930 246/572; null ensemble k=13 mean 0.3483 sd 0.0300, in range 46.5 sd 3.8. Commit b662140.
- G0 new (1 086a0ba67ed15ca6, 42 b81096d393b32e50, 1234 8b177fd80d554a37); G0-off unchanged. presets/registry/hashBase tests OK; 15 golden/battles/disasters/history test files OK (91 tests); build OK; Playwright smoke OK (runs/setup/smoke.log, shots/).
- Merged origin/main 17ae06d (absentee) → Dramatic adds absentee. Pending: G0 after merge (runs/setup/g0-after-absentee.log), dramatic sanity rerun (runs/setup/dramatic.jsonl), vt-realism.log, realism-check-noise-new.log. If G0 realistic changed after the merge, the realism rows must be rerun (delete runs/setup/realism/*.jsonl, rerun realism-runner.sh).

## DONE (lane complete)
- G0 after merging 17ae06d: unchanged; both identities OK. Final tests: realismStats, presets, registry, hashBase all pass (36 tests). Build OK. Dramatic sanity with absentee: in bounds.
- Null ensemble on the realistic default: under the old rule 11/12 null perturbations fail (12/12 on 8cabf09); under the noise rule, leave-one-out, 3/12 (≤2 on 8cabf09). The test bounds were set to these measured values.
