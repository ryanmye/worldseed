# Lane N3d — throne-mode fixes from AI play-test #2 — journal
Worktree /home/claude/wsx-n3d, branch lane/n3d (from origin/main 2fa2410). Runs: /home/claude/runs/n3d/. Eval shots: /home/claude/eval/n3d/.
Inputs: /home/claude/runs/llmpt2/REPORT-summary.md "→ lane N3d"; brief plans/_LANE_BRIEF.md.
Before (bots) = runs/n3b/r4 (lane/n3b final = main 2fa2410 game; personas v4, primer v7).
Probe: runs/n3d/tools/probe.ts <seed> <seat> <preset> <persona> <span> <out.txt> (cards/messages/feed as text).

## Steps
- [x] S0 setup + re-check on main (runs/n3d/before-A.txt, before-B.txt: items reproduced; item 8 seat names: Thotakor = polity 1 seed 7, ended 981 (the dead seat n3b fixed), names consistent; item 10 order years: by design)
- [x] S1-S7 game+UI fixes + primer v8: commits bf19878, de4763b, 9214bf2 (probes runs/n3d/after1-*.txt)
- [x] S8 personas v5 + LLM_PLAYTESTER v2 (separate commit)
- [x] S9 tests: n3d.test.ts + coverage (runs/n3d/tests-2.log); earlier seat/story tests 51/51 (tests-1.log)
- [x] S10 bots after -> runs/n3d/after (before = runs/n3b/r4); compare: python3 runs/n3b/compare.py runs/n3b/r4 runs/n3d/after
- [x] S11 screenshots 1280/1440/phone -> /home/claude/eval/n3d/
- [x] S12 merge origin/main, G0, typecheck, build, realism, push
## Current
DONE. Results: runs/n3d/compare.txt, compare-n3b.txt; g0.log OK x6; realism.log 0.325->0.325 46/104; tests-final.log 64/64; build OK. Shots /home/claude/eval/n3d/.
## Note
Coordinator: N4d (follow-a-realm) may supersede the seated-camera change; kept minimal (plan.ts seat focus option + storyView).

## Bisect (coordinator, after report): Dramatic oldpower2 lost 6 -> 9/13
- worktrees /home/claude/wsx-n3d-bis{a,b,c}: a = 2fa2410 game + personas v5; b = n3d game + personas v4; c = n3d game + old deferral cost
- runs: runs/n3d/bisect/{a,b,c} via run.sh dramatic <out> <wt> oldpower2 (resumable); summarize: python3 runs/n3b/compare.py runs/n3b/r4 runs/n3d/bisect/X
- bisect result (Dramatic oldpower2 lost/13): before 6; a 6 (identical runs: personas v5 change nothing on n3b's game); b 8; c 8; after 9. Skilled (cautious+greedy) survive 4/7 in before and after. No loss within 15 y of a coup/fallen/breakaway card (no traps); losses are overlord wars decades later (divergence).
- tuning: deferCost 0.2 + 0.4 d (was 0.35 + 0.65 d); re-acceptance -> runs/n3d/after2 (runs/n3d/bots2.sh, resumable)
- re-acceptance done: runs/n3d/after2 (compare2.txt, compare2-n3b.txt): Dramatic oldpower2 lost 7/13 (before 6); skilled (cautious+greedy) survive 4/7 both.
- merged origin/main 2b638f7 (n4d): n4d's seated Follow supersedes n3d's seat focus (plan.ts/storyView.ts from main); primer v9, personas v6. G0 OK x6 (g0-final.log), tests 80/80 (tests-final2.log), typecheck + build OK.
DONE (bisect report sent).
