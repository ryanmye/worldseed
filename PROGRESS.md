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

- ui-additions 1 (marker floor, top-5 town labels, peopleWash.ts washes + glowing hearths, hearth opening shot)
- ui-additions 2 (contextPanel.ts registry; groupRightRail shows the current context; empty panels hidden)
- ui-additions 3 (story/dramaStrip.ts over the slider; timeline.addAboveSlider, timeline.years)
- ui-additions 4 (phone: story card swipe; sheet tabs context-first, empty hidden)
- measurements so far in /home/claude/runs/onboard/measure.jsonl and pacing.jsonl; G0 OK (runs/onboard/g0.log);
  vitest src/ui/story + battle tests 34/34 (runs/onboard/vitest.log)

## Current / next
- final dist built (index 872 KB); /home/claude/eval/onboard/runfinal.sh (nohup) waits for runall.sh then measures
  final-desktop / final-phone on :4912
- then: re-run G0 + vitest on final, merge origin/main, push, report (lane/setup landing conflict: see report)
