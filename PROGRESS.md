# Lane N4d — follow-a-realm mode — journal
Worktree /home/claude/wsx-n4d, branch lane/n4d (from origin/main 2fa2410). Runs: /home/claude/runs/n4d/. Shots: /home/claude/eval/n4d/.
Owner ask: "follow mode should also lock into a country and go through smaller events too". UI only (G0 unchanged).

## Steps
- [ ] S1 realm story model: src/ui/story/realmFollow.ts (DOM-free) + plan.ts tune/promUnit + director pacing tune + tests
- [ ] S2 storyView hook (followRealm API, chip, Esc, follow=realm:<id>, successor auto-continue, strip/notices/captions)
- [ ] S3 entry points: Factions "Follow this realm", landing "or follow one realm", seat default; chronicle realm scope; context panel
- [ ] S4 stats: storyStats/pacingStats --realm; runs/n4d/*.jsonl
- [ ] S5 primer v8 + personas v5 (separate commits); coverage.test
- [ ] S6 screenshots eval/n4d; merge origin/main; gates (g0, typecheck, build, tests)
## Current
S1
## Next commands
