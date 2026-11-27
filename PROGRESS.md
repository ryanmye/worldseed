# lane/citystates — progress journal (city-states.md)

Worktree /home/claude/wsx-citystates, branch lane/citystates (from origin/main; origin/main merged at 2e22b70).
Feature: HistoryOptions.governments, GOV_ON = false (default OFF; step 9 flip deferred to its own PR per R29).

## Done (commits)
- c4d069a #1 contract, option, empty assembly, drama rules, LATER_KEYS
- f6436e0 #2-7 founding forms, rulers integration, charters/risings (step 4 complete), free towns, councils, signorie, theocracy, confederation, GOV hooks
- (UI) #10-11 part: governmentsData, tierWord(year), titles, chronicle 200-205, panel Government block
- #8 tuning; #3 union split fix; #4-5 same-year charter check + test fixes
- 2e22b70 merge origin/main

## Gates after merge
- G0 OK x3 (runs/citystates/g0.out); typecheck, build OK
- vitest government, rulers, ui/story, whatif, registry, finance: 10 files / 59 tests pass

## Open measurements (outputs in /home/claude/runs/citystates/)
- realism off/on rows: off-<seed>.jsonl, on-<seed>.jsonl (seeds 1 7 42 1234). Missing seed files -> rerun only those:
  node --experimental-strip-types --no-warnings src/sim/history/realismStats.ts <seed> --json [--opts '{"governments":true}'] > /home/claude/runs/citystates/{off,on}-<seed>.jsonl
- checks:
  cat runs/off-*.jsonl > off.jsonl; cat runs/on-*.jsonl > on.jsonl
  realismStats.ts --check docs/realism-baseline.jsonl --from off.jsonl --tol 0 --noise docs/realism-noise.jsonl
  realismStats.ts --check off.jsonl --from on.jsonl --noise docs/realism-noise.jsonl
- harness: h-<seed>.out (governmentStats.ts <seed>)

## Results (final, post-merge)
- realism off vs baseline (--noise): 0.400 -> 0.400 OK; on vs off (--noise): 0.400 -> 0.384 OK, 3 rows WORSE vs single ref but within null noise (war.alpha, epi.plagueWorstNet, urb2000.u10). Full table runs/citystates/ab.txt
- harness rows runs/citystates/h-*.out

## Next
Report to coordinator (gates, A/B, harness rows, deviations). Not done: map capital colours, sagas phrases, polity naming by city, chronicle group of its own (uses Politics).
