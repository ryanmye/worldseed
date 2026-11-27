# Lane N3b — throne balance round 2 — journal
Worktree /home/claude/wsx-n3b, branch lane/n3b (from origin/main da401d6). Runs: /home/claude/runs/n3b/.
Brief: plans/_LANE_BRIEF.md; inputs runs/merge-n3/summary.txt, wsx-n3/PROGRESS.md, plans/AGENTS.md follow-ups.
Goals: 1 Unify reachable; 2 Monument harder; 3 old-power Dramatic 40-60% survivable; 4 arcs >= 1/run; 5 card flow 102-112; 6 quick checks.

## Steps
- [x] S0 setup + baseline (merge-n3 = before); probe runs/n3b/probe/unify.ts (replays a jsonl, traces Unify share)
- [x] S1 Unify: diagnosis (probe unify3.jsonl + unify_rules.py): shares move <= 0.08 with any play; conquests offset by revolt secessions; rule now 10 towns taken + share >= min(.6,s0)-.1 for 10y
- [x] S2 Monument: great landmark begun+finished in seat time, not castle/palace (temples dropped)
- [x] S3 old power: loss = vassal absorption at bond age 80 (bonds.ts); looming Overlord card (Keep paying/Defy/Defy with an ally) every 10y within 25y of it
- [x] S4 arcs: T16 uncle, T4 child king, provinces rise, T1 coda
- [x] S5 card flow: stakes LIKELY/odds alias/callbacks for 160-166 keys; FightOn court words
- [x] S6 quick checks: share link trims o= and opens at year=; picker confirm + drops year=; phone tab auto-open
- commits: game+primer v7 (see git log), personas v4 (separate)
- [x] S7 bots r1 (pre-merge) -> runs/n3b/r1 (compare: python3 runs/n3b/compare.py runs/merge-n3 runs/n3b/r1). Findings: Monument still passive on fowinlan/oldpower; old power 10/11 survive incl always-defer (court picked Defy with an ally)
- [x] S8 Monument needs the seat's own order (drivenBy); court pays on the looming card
- [x] S9 merged origin/main 9d00a3e (n5, detmath2) at cd535e9; G0 OK x6 vs post-N5 goldens (runs/n3b/g0-2.log)
- [ ] S10 bots r2 (post-merge) -> runs/n3b/r2; baseline post-merge main -> runs/n3b/base-out (worktree runs/n3b/base). Both via nohup run.sh chains (r2-*.out) (run.sh dramatic|realistic <out>); summarize: python3 runs/n3b/r1/summarize.py

## Current
S10 running; then compare.py base-out vs r2; tests + build + realism:check.
S7 bots r1 running (nohup runs/n3b/run.sh). G0 OK x6 pre-n5 (runs/n3b/g0-1.log).
Old: S1 Unify. Finding (realistic-kelurair): share peaks 0.52 passively ~790, greedy:1's wars then LOWER it (0.34 by 850); 0.6 never hit by any persona. Probing other setups: runs/n3b/probe/*.txt

## Next commands
(none)
