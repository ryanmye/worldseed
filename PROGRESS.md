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

## Current / next
- landing play paths (landing.ts slot + main.ts onStart path)
- bundle split (landing JS < 1 MB)
- measure after (desktop + phone), PLAYER_PRIMER update, merge origin/main, gates

## Measurements
- before-desktop: /home/claude/eval/onboard/before-desktop.log (start->shown 59.8 s, no caption in 120 s, dead air 120 s, JS 2.51 MB)
- before-phone: /home/claude/eval/onboard/before-phone.log
