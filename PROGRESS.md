# lane/n5 — progress journal (EVALUATION §4 Lane 5: battles visibility + cheap mechanics)

Worktree /home/claude/wsx-n5, branch lane/n5 (from origin/main dc5d9f0 + origin/lane/onboard 2b17be6, merge fbb85cd:
landing.ts/main.ts conflicts resolved: preset pills + play paths; seat controller + decision card in the lazy chunk).
Runs: /home/claude/runs/n5/. Screenshots: /home/claude/eval/n5/.

## Done
- merge onboard (fbb85cd); merge origin/main 39e8470 (7db5f7a)
- step 1 visibility + terms behind switches (86d17b5): course field, captions, replay overlay/legend, context summary, terms.test.ts
- G0 OK x6 with terms off (runs/n5/g0-step1.log); vitest battles/story/presets/streams/coverage 63/63 (vitest-step1.log)
- before/after shots: eval/n5/{before,after}-*.png (tools/shots.mjs; previews :4951 dist-before, :4952 dist-after)
- caption acceptance tool tools/captions.ts (seed 1: 218/218, seed 42: 184/186 before the fog fix)

## Current
- measurements: tools/measure.sh -> runs/n5/combined.jsonl (configs base season height mud frozen all x seeds 1 7 42 1234),
  resumable: rerun `nohup tools/measure.sh /home/claude/wsx-n5 &`. Do NOT edit src/sim while it runs.

## Next
1. sim: Battles.course (deciding factors + mechanic bits), recording only
2. UI: factor clauses in describeBattle, battle scene caption, replay weather overlay + terrain cues + legend, context summary
3. mechanics (season, elevation, mud, frozen) behind PresetParams.battleTerms, battleStats per term, realism A/B
