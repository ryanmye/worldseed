# lane/absentee progress (absentee-rulers.md)
Worktree /home/claude/wsx-absentee, branch lane/absentee (from origin/main a4d6b8a; origin/main 363c570 merged in ba00844).

## Done
- 8a8d082 absentee#1 sim: rulers/absentee.ts, HistoryOptions.absentee, EventType 185-187, CrisisBit.Deference, deference.ts deferenceRelease/deferencePressure
- b836066 absentee#2 UI: absenteeFormat.ts, decider deciderNameOf/viceroy, epithets, saga line, why rules
- 3bef88e absentee#3 harness absenteeStats.ts + absentee.test.ts, tuned ABSENTEE defaults
- ba00844 merge origin/main
- Gates after merge: G0 OK (3 seeds), typecheck OK, 10 test files / 52 tests pass, realism OFF tol 0 OK, ON passes with --noise (0.372 -> 0.451, tol 0.116), fails single-reference.
- Results in /home/claude/runs/absentee/: final_a/b.jsonl (harness 4 seeds), off2/on2.jsonl (realism rows), g0.txt

## Next
- npm run build (gate), then push; report to coordinator.
- Commands:
  - harness: node --experimental-strip-types --no-warnings src/sim/history/rulers/absenteeStats.ts 1 7 42 1234 --json
  - realism on: node --experimental-strip-types --no-warnings src/sim/history/realismStats.ts 1 7 42 1234 --json --opts '{"absentee":true}' > /home/claude/runs/absentee/on2.jsonl
  - check: ... realismStats.ts --check docs/realism-baseline.jsonl --from /home/claude/runs/absentee/on2.jsonl --noise docs/realism-noise.jsonl
