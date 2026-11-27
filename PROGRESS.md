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

- measurements done: runs/n5/combined.jsonl (base season height mud frozen all frozen2 hm sm smf hmf x 4 seeds),
  bstats-table.txt, check-<cfg>.txt (noise check), vs-<cfg>.txt
- step 2 (38f4a05): Realistic battleTerms height+mud+frozen, Dramatic all four; G0 realistic re-recorded (ef60fc5, PENDING
  coordinator sign-off): 1 5e7f05d8ff3ef465, 42 4411abcb29ca8e1e, 1234 802f4d68ac303a22; G0-off unchanged
- realism:check:noise on the new default OK 0.348 -> 0.325 (realism-check-noise-default.log); preset:sanity OK (sanity.log)
- captions on the new default: seed 7 209/209, seed 42 119/119 name terrain/weather when a term >= 15%
- final shots eval/n5/final-*.png (fog2/snow2/ford2 + story-inline-0..2)

## Current
- DONE; awaiting coordinator (G0 sign-off; merge origin/main once ci-determinism / detMath lands: n5 sim code uses no
  pow/exp/log/trig).
