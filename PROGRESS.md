# Lane N4b — watch-mode UI polish (from LLM play-test #1) — journal
Worktree /home/claude/wsx-n4b, branch lane/n4b from origin/main 39e8470. Runs: /home/claude/runs/n4b/. Shots: /home/claude/eval/n4b/.
Findings: /home/claude/runs/llmpt1/REPORT-summary.md + log.md. UI only, no sim changes (G0 must be unchanged).
Baseline build served from /home/claude/llmpt-wc (39e8470) at :4987 (before shots); lane build at :4988 (4951/4952 belong to N5).

## Items
- [x] 1 Read more expands the caption
- [x] 2 Why panel: scroll into view, R back to Factions, Esc closes
- [x] 3 Resume pill unpauses
- [x] 4 Show me on a seat card: following resumes after the card closes
- [x] 5 Chronicle: no auto-scroll under pointer/focus
- [x] 6 Factions min height with More panels open
- [x] 7 ~N min estimate updates
- [x] 8 Caption places pinned on the globe
- [x] 9 Battle replay: legible figures, side legend, skip/shorten
- [x] 10 Drama-strip jump: caption + framing
- [ ] primer + coverage, gates, merge origin/main

## Current
all 10 items implemented (commits wip 1-3); primer v4; G0 OK; tests (coverage, battleTimeline, story, onboard) pass.
Done: merged origin/main (no new commits, 39e8470), G0 OK, typecheck OK, tests OK, before/after shots in /home/claude/eval/n4b (b- before, a- after). Lane complete.
Follow-up (coordinator, from N5): battle context panel kept to --right-w (it widened the column over the inline replay); replay bar fits 300 px; phone tab "Battle". Checked with tools/overlap.mjs at 1280/1440/1920 + phone: shots eval/n4b/{b,a}-overlap-*.png, logs runs/n4b/{b,a}-overlap.out.
Scenario scripts: /home/claude/runs/n4b/tools/sessA.mjs <base> <a|b> (session A items 1-3,5-10), sessB.mjs (item 4). Logs /home/claude/runs/n4b/?-sess?.log

## Next commands
(none running)
