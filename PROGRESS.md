# Lane N4d — follow-a-realm mode — journal
Worktree /home/claude/wsx-n4d, branch lane/n4d (from origin/main 2fa2410). Runs: /home/claude/runs/n4d/. Shots: /home/claude/eval/n4d/.
Owner ask: "follow mode should also lock into a country and go through smaller events too". UI only (G0 unchanged).

## Steps
- [x] S1 realm story model: src/ui/story/realmFollow.ts (DOM-free) + plan.ts tune/promUnit + director pacing tune + tests
- [x] S2 storyView hook (followRealm API, chip, Esc, follow=realm:<id>, successor auto-continue, strip/notices/captions)
- [x] S3 entry points: Factions "Follow this realm", landing "or follow one realm", seat default; chronicle realm scope; context panel
- [x] S4 stats: storyStats/pacingStats --realm; runs/n4d/*.jsonl
- [x] S5 primer v8 + personas v5 (separate commits); coverage.test
- [x] S6 screenshots eval/n4d; merge origin/main; gates (g0, typecheck, build, tests)
## Current
S6 done: merged origin/main (up to date), G0 6/6 OK, tsc, build, vitest story+onboard+coverage 45/45. DONE.
## Measurements
runs/n4d/realm.jsonl tag mw4 (final tune): 61343 realistic p0 5.0 beats/century small 72% mw 3 dead 5.3 s first 3.9 s; 61343 dramatic p0 5.24, 83%, dead 5.7; 1 dramatic p1 4.96, 73%, dead 6.9; 42 realistic auto(17) 5.32, 48%, dead 4.7. G0 OK (runs/n4d/g0.log).
## Next commands
git fetch origin main && git merge origin/main; g0; tsc; build; vitest realmFollow/plan/director/onboard/coverage
