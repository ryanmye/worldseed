# lane/n4c — watch-mode and battle fixes from AI play-test #2
Source: /home/claude/runs/llmpt2/REPORT-summary.md "→ lane N4c"; log.md; runs to /home/claude/runs/n4c/; shots /home/claude/eval/n4c/.
Worktree /home/claude/wsx-n4c, branch lane/n4c from origin/main 2fa2410. Parallel: N3d (throne UI) — do not touch seat cards / dashboard.

## Items (status)
1 place names — done (battleName/townAt; Inesna x2 verified correct: two conquests in 1891, wars 179 and 180)
2 battle Why — done (rules/base.ts battleCauses, commanderBattle; prose/explain labels)
3 replay — done (groundOf height, standingWords, sideColours ΔE>=30, rain/mud/ford; rankedFactors with NUMBERS)
4 stall — done: reproduced (seat link minus 1014 orders, choose Raise taxes: inline top-battle replay at 1015 ends, deps.play() with the frame loop asleep, nothing woke it); fixed (onSettled wakes; play dep wakes); verified reaching the 1020 card
5 — done (storyCard withoutShown)
6 — done (timeline api.setYear settles)
7 — done (DIRECTOR.dwellYears/dwellSlowAt; CAPTION_LAG_YEARS clears)
8 — done (overlay.setLayersPending until onHistoryShown)
9 — done (Why's R opens Factions; R on a tucked Factions opens the drawer) — verify in browser
10 — done (historyView setQuiet: journeys/trade/expeditions hidden while a strip-jump caption shows)

## Log
- adfcf2b: items 1,2,3,5,6,7. Tests battleFormat/director/why/drama pass (runs/n4c/vitest1.log).
- next: commit 8/9; item 10 dim layers; item 4 stall repro (seed 7 seat URL from runs/llmpt2/50.txt minus the 1014 levy); after-shots; g0; primer; merge origin/main.
- G0 OK all 6 (runs/n4c/g0.log). n4c.test.ts, coverage.test pass. primer v8.
- next: after-shots of watch seed 146916 (eval/n4c), merge origin/main, rerun tests+G0, push, report.
- DONE. Final: typecheck+build OK; 13 test files/78 tests pass (runs/n4c/vitest-final.log); G0 6/6 OK; origin/main had nothing new to merge (2fa2410). Shots in /home/claude/eval/n4c (before-*, after-*).
