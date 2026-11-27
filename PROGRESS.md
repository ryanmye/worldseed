# Lane N1 (surfacing: director beats + throne cards) — journal
Worktree /home/claude/wsx-n1, branch lane/n1 (origin/main dc5d9f0 + lane/onboard 2b17be6, merged e4697b4 with the main merge's resolution).
Spec: plans/EVALUATION.md §4 Lane 1, §1d. Brief: plans/_LANE_BRIEF.md. Runs: /home/claude/runs/n1/.

## Steps
- [x] 0 setup: worktree, merge onboard (e4697b4), node_modules symlink
- [x] 1 harness: storyStats loads *Format.ts rules (loadDramaRules), --preset, beat mix, funnel, --out jsonl (d171a18)
- [x] 2 baseline (before): cached histories runs/n1/cache/{realistic,dramatic}-2000-{1,42,1234,7}.bin (v8);
      /home/claude/n1-tools/tune-before.ts on worktree /home/claude/wsx-n1-before (e4697b4) -> runs/n1/before-tune-*.log
- [x] 3 diagnose: runs/n1/diag-dramatic-1.log (funnel). Causes: (a) society/disasters/cold wars never chronicle entries
      (historyIndex isShownType); (b) one beat per 25-75 y window, classics B 8-10 with polity magnitudes outscore; novelty
- [x] 4 drama fixes + tuning (0b679ca, then freshness/debut/like/ahead/debut-swap). Tune: n1-tools/tune.ts <preset> seeds
      After: dramatic 41% new-system beats, 38/40 system-seed pairs, top battle a beat 4/4; realistic 35%.
- [x] merged origin/main 39e8470 (onboard)
- [ ] 5 throne cards
- [ ] 6 primer + personas bump
- [ ] 7 after measurements, merge origin/main, final push

## Current / next commands
- step 5 cards: new DecisionKinds 102+ (registry next free; N3 uses 80-85, N5 may use 94-101), SeatOptionKeys 160+
