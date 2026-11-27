# LLM play-tester (occasional; never in CI)

An expensive smoke and review tool. A Claude subagent plays through Playwright from screenshots and DOM text and reports
qualitative observations next to the scripted bots' metrics. Version 1, used with PLAYER_PRIMER v1 and PERSONAS v1.

## How to run
1. Start the app: `npx vite --port 5199 --strictPort` in the worktree.
2. Give the subagent:
   - the full text of `docs/PLAYER_PRIMER.md`;
   - one persona prompt from `docs/bots/PERSONAS.md`;
   - the brief below.
   It needs a browser tool or a Playwright script that can take screenshots, read `.seat-screen` text and click.
3. The subagent may act only through the UI: keys, clicks and the address bar for the initial link. No `window.__*`
   tools, no JavaScript that reads state, no source code.

## Brief for the subagent
> You are play-testing worldseed, a history simulator with a throne mode. Read the primer and play as the persona below.
> 1. Open `http://localhost:5199/?seed=<S>&year=<Y>&play=0&lang=1`. Set Sun to Follow, turn on Follow the story, open
>    Factions, frame the top realm's capital and take its throne.
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

## Closing the loop
- Every play-test pack (Lane 6) and every LLM run ends with "primer/persona improvements suggested".
- The next bots iteration applies them with a version bump of the primer or the personas, in a commit apart from any game
  change.
- Store the reports under `/home/claude/runs/bots/llm/<date>-<persona>-<seed>.md`.

Status: the prompts are written, but no subagent run has been made yet (this lane's agent cannot spawn subagents).
