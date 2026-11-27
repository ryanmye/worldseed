# lane/onboard — progress journal (EVALUATION §4 Lane 4)

Worktree /home/claude/wsx-onboard, branch lane/onboard (from origin/main 363c570). Baseline build: /home/claude/onb-before
(detached 363c570, `npx vite preview --port 4911`). Measurement script: /home/claude/eval/onboard/scripts/measure.mjs
(results: /home/claude/runs/onboard/measure.jsonl, logs + screenshots /home/claude/eval/onboard/).

## Done
- director.ts: pacing (fast-forward quiet stretches, setPacing; tests in director.test.ts)
- storyView.ts: daylight framing (planet turn), heartland shot, top-3 inline battle replays, progress hint, Share
- storyCard.ts / story.css: Share + Watch the battle buttons, progress span
- battleMap.ts/.css: open(b, {inline, onDone})
- onboard.ts/.css: followByDefault (first visit), markVisited, PLAY_PATHS/THRONE_START, groupRightRail ("More panels")
- historyView.ts: wiring

- landing play paths (landing.ts `paths`/`onPath` slot; main.ts onStart path; CSS in onboard.css)
- bundle split: landing chunk 871 KB (249 KB gz) vs 2,514 KB before; historyView chunk loads after the landing draws
  (lazy.ts / lazyHistoryView.ts), seatController + cityCard lazy, tiny modules: dioramas/active.ts, goodsNames.ts,
  goodsInUse.ts, historyYears.ts

- pacing harness src/ui/story/pacingStats.ts -> /home/claude/runs/onboard/pacing.jsonl (log pacing.log)

## Current / next
- running (nohup): /home/claude/eval/onboard/runall.sh (resumable; after/before x desktop/phone, seed 61343, 120 s) ->
  runs/onboard/measure.jsonl + eval/onboard/*.log/png; G0 -> runs/onboard/g0.log; vitest -> runs/onboard/vitest.log
- after build served at http://localhost:4912/ (npx vite preview in /home/claude/wsx-onboard)
- smoke: FORCE=1 simq node scripts/measure.mjs http://localhost:4912/ smoke1-desktop desktop 60 (log eval/onboard/smoke1-desktop.log)
- then: after-desktop / after-phone (120 s), gates (tsc, build, G0, vitest src/ui/story), merge origin/main, push, report

## Measurements
- before-desktop: /home/claude/eval/onboard/before-desktop.log (start->shown 59.8 s, no caption in 120 s, dead air 120 s, JS 2.51 MB)
- before-phone: /home/claude/eval/onboard/before-phone.log
