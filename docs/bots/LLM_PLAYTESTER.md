# LLM play-tester (occasional; never in CI)

An expensive smoke and review tool. A Claude subagent plays through Playwright from screenshots and DOM text and reports
qualitative observations next to the scripted bots' metrics. Version 2 (lane/n3d), used with PLAYER_PRIMER v9 and PERSONAS v6.

## How to run
1. Start the app in the worktree on a free port, e.g. `npx vite --port <PORT> --strictPort` (or `npm run build` then
   `npx vite preview --port <PORT> --strictPort`). Use that port below; there is no fixed one (5199 was a past lane's).
2. Give the subagent:
   - the full text of `docs/PLAYER_PRIMER.md`;
   - one persona prompt from `docs/bots/PERSONAS.md`;
   - the brief below.
   It needs a browser tool or a Playwright script that can take screenshots, read `.seat-screen` text and click.
   Lane N3d (after LLM play-test #2):
   - Read the decision screen's text straight from the `.seat-screen` element (its innerText) and wait for that element
     to appear, rather than guessing selectors or sleeping a fixed time: on SwiftShader the first card can take minutes.
   - The VM has no `ss`: to find a free port, read `/proc/net/tcp` (local ports are hex in the second column), or just try
     `--strictPort` on a port and take the next one if it fails.
   - The reign summaries ("The reign of … ends") are messages with a **Continue** button; they queue before the next card.
   - If playback stalls (play icon on, year not moving, no card), press `Space` twice.
3. The subagent may act only through the UI: keys, clicks and the address bar for the initial link. No `window.__*`
   tools, no JavaScript that reads state, no source code.

## Brief for the subagent
> You are play-testing worldseed, a history simulator with a throne mode. Read the primer and play as the persona below.
> 1. Open `http://localhost:<PORT>/` and click **Rule a kingdom** on the start page (the curated throne: seed 61343,
>    Kelurair/Tidu from 700, Dramatic). Or, for another world, `http://localhost:<PORT>/?seed=<S>&year=<Y>&play=0&lang=1`,
>    open Factions and take the top realm's throne. To play an ambition, pick it in the "Your throne" panel's
>    **Change ambition…** list before the first card (it restarts the reign), or add `:amb=<k>` to `seat=`.
>    Do the shared setup (Sun to Follow, frame the capital) **after the first card** or with `play=0`: the first card comes
>    within seconds of the history showing.
> 2. Play about 15 decision cards at 16× between cards. Before each choice, write one line: what the card says, what you
>    choose and why, as the persona would.
> 3. After each choice, watch for any sign of what it did: a later card that refers to it, a chronicle line, a change on
>    the map.
>
> Report:
> - (a) the first moment you had a meaningful choice, and how long it took;
> - (b) choices whose consequence you could see, and choices that vanished;
> - (c) repeated or confusing cards (quote them);
> - (d) the most dramatic thing you saw, and whether the game showed it to you or you found it by chance;
> - (e) long stretches with nothing to look at;
> - (f) whether your persona's goal was reachable, and if not, whether you played badly or the game gave you no lever;
> - (g) **primer/persona improvements suggested**: what the primer got wrong or left out, and what the persona prompt
>   should say.
>
> What counts as interesting: a hard choice with visible stakes, a callback to an earlier choice, a named person, a
> reversal, a war or disaster framed on screen in daylight.

## Timings (for planning a run)
- Headless bots (src/bots/headless.ts, Node, 2-vCPU shared VM): a 300-year reign from 700 takes 10–35 s wall time per
  persona, the first card about 2–8 s after the world (most of it simulating years 0–700).
- Browser (system Chrome on SwiftShader, same VM): the first card 60–90 s after load; each later card 5–70 s depending on
  the years between pauses. Real hardware is much faster (the evaluator measured 14.5 s to the first card on a phone
  viewport with a lighter load).

## Closing the loop
- Every play-test pack (Lane 6) and every LLM run ends with "primer/persona improvements suggested".
- The next bots iteration applies them with a version bump of the primer or the personas, in a commit apart from any game
  change.
- Store the reports under `/home/claude/runs/bots/llm/<date>-<persona>-<seed>.md`.

Status: the prompts are written, but no subagent run has been made yet (this lane's agent cannot spawn subagents).
