# lane/bots progress (fun harness, EVALUATION §4 Lane 2)

## Done (pushed to lane/bots)
- cardModel.ts: the decision screen as data; decisionCard.ts renders it; seatController takes an injected card (main.ts passes createDecisionCard).
- src/bots: personas.ts (v1), headless.ts (the real worker and the real seat controller; pickSeat), metrics.ts, funHarness.ts (resumable: /home/claude/runs/bots/*.jsonl), presets.ts, primer.ts.
- docs/PLAYER_PRIMER.md v1, docs/bots/PERSONAS.md v1, docs/bots/LLM_PLAYTESTER.md.
- Tests: src/bots/coverage.test.ts (drift; 4/4), src/bots/bots.test.ts (equivalence, 5 personas x 2 seeds; green together with src/ui/seat: 7/7).
- Coverage-test line appended under "Bots and primer" in _LANE_BRIEF.md.

## Running (nohup; resumable)
- UI smoke: /home/claude/runs/bots/ui-42-cautious.log (scripts/bots-ui.mjs; vite on :5199 from /home/claude/runs/bots/vite.log)
  - First try: the replay hash matched the headless one (5798f286 @775), but the page hash was read before the pause History was staged (years 2000). Fixed: poll until the shown History's years equal the card's year.
- Baseline: /home/claude/runs/bots/baseline.log, rows in /home/claude/runs/bots/realistic-p1-from700-span300.jsonl; writes docs/fun-baseline.jsonl and docs/bots/metrics-v1.json at the end.
  - Rerun the same command to resume.

## Results
- Baseline v1: /home/claude/runs/bots/baseline.log (404 s; 36 runs; all 36 replays EQUAL).
- UI smoke, seed 42 cautious: all checks ok. Fresh replay = bot run = headless (b5e0ba4c @775). The log is /home/claude/runs/bots/ui-42-cautious.log.

## Next
- G0, build, merge origin/main, push, report.
