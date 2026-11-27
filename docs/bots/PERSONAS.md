# Fun-harness personas

Version: 1 (src/bots/personas.ts PERSONA_VERSION). The scripted bots (headless and UI) run the policies in personas.ts.
The LLM play-tester gets the prompt text below. Both read only what the seat UI shows (docs/PLAYER_PRIMER.md): the
decision screen, the Authority meter, the chronicle and the map, plus their own memory of earlier cards.

Rules for changing this file:
- Bump the version together with personas.ts and add a changelog line.
- Never change a persona and the game in one commit. docs/bots/metrics-vN.json snapshots tell bot changes apart from game
  changes.
- A new DecisionKind or SeatOptionKey fails src/bots/coverage.test.ts until every persona has a stance on it.

Changelog:
- v1 (2026-11-27): the five personas. Every persona declares every ambition (`amb=0.1.2.3.4.5`; judged only), so each run
  reports which ambitions were met. Greedy lists its target first.

## Shared setup (every persona, every driver)
Act like a sensible player before judging anything:
- In the browser, set Sun to Follow, turn on Follow the story, and frame the realm's capital on land.
- Take the throne of the top realm of the Factions list (most people) alive in the chosen year, so no persona starts on a
  dead seat.
- Use 16× between cards.

## cautious
- **Goal:** keep the realm safe and the throne secure.
- **Risk appetite:** lowest. On each card it takes the option with the lowest court risk (OPTION_RISK, the same table the
  court's own pick uses; the badges show the same thing in words).
- **Defers:** only a routine matter ("Routine business"), only when the court would pick the same option, and only if
  Authority stays at 80 or above.
- **Watches:** Authority, revolts, successions and wars on us.
- **Prompt:** "You are a careful ruler. Above all, avoid war, revolt and a lost throne. Read every option's badge and
  consequence line and take the safest. Leave a matter to the court only when it is routine, the court would choose what
  you would, and your Authority stays high. Report any card where every option felt dangerous or meaningless."

## aggressive
- **Goal:** war and expansion through the cards actually offered.
- **Risk appetite:** high. It prefers Strike, Fight on, Defy, Crush, Crush the pretender, Purge, Send settlers, Explore
  further and Refuse the debts. Where nothing is warlike, it takes the boldest option that is not a Wait.
- **Defers:** never.
- **Watches:** wars started and won, towns taken, realms ended.
- **Prompt:** "You are a conqueror. Grow the realm by war and settlement. Whenever a card offers a war or a strike, take it.
  Never let the court decide. Note how often the game gave you a chance to start a war and whether your wars visibly
  changed the map."

## always-defer
- **Goal:** none. It measures what the game does without a player.
- **Defers:** every card, through the real Do nothing button, with its Authority cost.
- **Prompt (LLM):** "Press Do nothing on every card. Report what the court chose, how Authority fell and what happened to
  the realm."

## random
- **Goal:** none. It is the null player, used for noise.
- **Policy:** uniform over the options plus Do nothing, from a seeded generator (seed × 7919 + 17; `--null N` re-runs it
  with N other seeds).

## greedy (`greedy:<AmbitionKind>`, default 1 Unify)
- **Goal:** maximise one declared ambition. The scripted version scores each option key by a per-ambition stance table
  (personas.ts AMBITION_STANCE; ties go to the lower risk).
- **Defers:** only when no option moves the ambition, the matter is routine and Authority stays at 70 or above. Never when
  Authority is below 60.
- **Watches:** for Unify, realm size and towns gained; for Riches, crops, ideas, settlers and peace; for Endure, safety and
  succession; for Union, matches.
- **Prompt:** "You have one ambition: <ambition>. Judge every card only by whether it moves you toward it. Note every card
  where no option could help ('no lever'). At the end, report whether you achieved it and whether the game ever gave you a
  real way to."

## Self-scored competence (reported per run)
- **blind:** the persona's choice was made without information. Either every option said the same thing, or no option
  touched its goal.
- **levers:** cards that offered at least one option that moves the goal.
- **Verdicts:**
  - **game gives no lever:** the persona failed and saw 0 levers.
  - **bot weak:** it failed but another persona met the goal on the same seed.
  - **levers too weak:** it saw levers and no persona met the goal.
