# lane/bots progress (fun harness, EVALUATION §4 Lane 2)

## Done
- cardModel.ts: decision screen as data; decisionCard.ts renders it; seatController takes an injected card (main.ts passes createDecisionCard).
- src/bots: personas.ts (v1), headless.ts (real worker + real seat controller), metrics.ts, funHarness.ts (resumable, /home/claude/runs/bots/), presets.ts, primer.ts.
- scripts/bots-ui.mjs: Playwright UI bot (setup like a player, plays through the DOM, replay + headless equivalence).

## Next
- docs/PLAYER_PRIMER.md, docs/bots/PERSONAS.md, docs/bots/LLM_PLAYTESTER.md
- src/bots/coverage.test.ts (drift), src/bots/bots.test.ts (equivalence)
- Playwright smoke: vite on :5199, `node --import ./scripts/css-register.mjs --experimental-strip-types --no-warnings scripts/bots-ui.mjs http://localhost:5199/ --seed 42 --persona cautious --cards 4`
- Baseline: `nohup /home/claude/bin/simq node --import ./scripts/css-register.mjs --experimental-strip-types --no-warnings src/bots/funHarness.ts --seeds ... > /home/claude/runs/bots/log.txt &`
- G0, typecheck, build, merge origin/main, push.
