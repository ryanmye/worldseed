# worldseed player primer

Version: 4 (src/bots/primer.ts PRIMER_VERSION). Every UI-driven bot (scripts/bots-ui.mjs) and every LLM play-tester reads
this file, and nothing else, to learn how to play. Each item was checked against the code named beside it. A lane that
changes the UI controls, the cards, the orders or the seat options updates this file and bumps the version (see
_LANE_BRIEF.md "Bots and primer"). `src/bots/coverage.test.ts` fails when a keyboard shortcut or a decision kind is missing here.

Changelog:
- v1 (2026-11-27, lane/bots): first version, from origin/main f20cb5f.
- v2 (2026-11-27, lane/setup merge): presets (the start page's History toggle, `v=2`, `preset=`, per-switch overrides) and the throne link.
- v3 (2026-11-27, lane/onboard merge): play paths on the start page, Follow on by default for first visits, the context panel and "More panels", the drama strip, caption Share and Watch the battle, inline battle replays, caption swipe on a phone.
- v4 (2026-11-27, lane/n1 surfacing): eleven cards for the merged systems (finance, battles, beliefs, disasters, oaths,
  city-states, cold wars, merchant houses), a renowned general bringing the General card, Credit coming at a lower need, and
  the story director telling battles, eruptions, defaults, betrayals and bluffs.

## 1. Starting a world

- **The start page** shows only at the bare URL, or with `intro=1` (main.ts `showLanding`). It has a seed field (with a dice
  for a random seed), a years field (200 to 6000; landing.ts YEARS_MIN/MAX) and **Start**. "Choose where peoples begin" plants
  hearths (written as `c=`). Any other URL parameter opens the app directly.
- **Play paths** (ui/onboardPolicy.ts PLAY_PATHS): the start page offers three ways in. **Watch history unfold** (the
  primary button; `Enter` in a field picks it) starts the world with Follow the story on. **Rule a kingdom** opens the
  throne link below (seed 61343, `seat=polity:0:700`, with the chosen preset). **Explore freely** starts the world with
  Follow off: you turn the globe yourself while history plays.
- **Direct links:** `?seed=42` opens seed 42; `years=` sets the history's length (default 2000); `year=N` starts the
  timeline at year N; `play=0` starts paused; `lang=1` turns on language drift. New worlds started from the page write
  `lang=1`, so a link without it gets the older names.
- **Presets** (src/sim/history/presets.ts): the start page has a **History** toggle, **Realistic** (the default: battles,
  disasters, debts and grudges, tuned against real history) or **Dramatic** (everything on: merchant houses, cold wars,
  absentee rulers and city-states too). The preset is part of the world, like the seed: the same seed under another preset
  is another history. The bot harness takes `--preset`.
- **Throne link:** the curated seat world is seed 61343, `seat=polity:0:700`, with the chosen preset: you rule a realm from
  year 700 and decisions come to you as cards. With the play paths shown, **Rule a kingdom** is the way to it (the separate
  "Or take a throne" link is hidden then).
- **URL keys for presets:** `v=2` marks a link made with the presets; new worlds write it. A link without `v` is an old
  link and replays with every newer system off (preset `off`), so old share and seat links keep their history. With `v=2`,
  no `preset=` means realistic; `preset=dramatic` or `preset=off` pick the others. Each switch can be overridden over the
  preset with `<key>=1` or `<key>=0`: `oaths`, `balance`, `arms`, `families`, `finance`, `society`, `beliefs`, `barriers`,
  `disasters`, `battles`, `coldWars`, `warRestraint`, `absentee`, `causes`, `governments` (for example
  `preset=dramatic&battles=0` is the dramatic world without battles).
- **Loading:** the bar reads "Simulating…" and then "Drawing the map…". The first ~20 years play at the intro rate of 20
  years a second (timeline.ts INTRO_YEARS_PER_SECOND); after that, 1× is 20/3 ≈ 6.7 years a second.

## 2. Looking at the world

- **Rotate and zoom:** drag the globe to turn it and use the wheel or a pinch to zoom (three.js OrbitControls, main.ts).
  `M` switches between the globe and a flat map (Equal Earth). URL: `lon=`, `lat=`, `az=` in degrees and `dist=` (camera
  distance; the planet's radius is 1, default 3.25).
- **Frame land, not ocean.** At the start the camera faces a default longitude, often over ocean, and the early settlements
  are tiny dots. To frame a realm, open **Factions** (`R`), click a realm, and click its capital's name in the detail; the
  camera flies there. Clicking a town on the globe selects it too. `select=<settlement id>` and `polity=<id>` select from the
  URL. On a decision card, **Show me** flies to the card's place.
- **Sun and daylight:** `S` opens "Sun and quality". Its sun modes (render/sun.ts) are:
  - **Fixed** (default): the planet turns under a fixed sun, so the place you look at may be on the night side.
  - **Follow**: the sun sits behind the camera, so whatever you look at is lit.
  - **Daylight**: daylight everywhere; city lights are hidden.

  Pick **Follow** to keep the realm lit: the story camera does not take the sun into account. URL: `sun=fixed|follow|full`,
  and `sunlon=` and `sunlat=` for the fixed sun. Shift-drag or right-drag moves the sun on the globe.
- **Views:** `V` and `Shift+V` step through the map views (terrain, factions, population and others). `L` shows the layers.
  `view=factions` in the URL shows the realms' colours.

## 3. Following the story

- **Follow the story:** press `H`, use the Follow button on the timeline bar, or add `follow=1` (ui/story/storyView.ts).
  The director flies the camera to the great events (beats), slows playback at each one and shows a caption card with
  Read more, Why? and Next. **On a first visit it is on by default** (ui/onboardPolicy.ts followByDefault): unless the
  address has `follow=0`, or opens somewhere particular (`seat`, `cmp`, `fly`, `select`, `polity`, `year`, `lon` or `lat`).
  Later visits start with it off. While following, quiet stretches fast-forward (⏩ and "~N min" beside Follow). With
  Follow on, story notices show too; without it, "Story notices" in the layers toggles them.
- **Captions** also have **Share** (a link with `year=` and `follow=1`) and, on battle beats, **Watch the battle** (the 2D
  replay). On a phone, swipe a caption sideways: left is Next, right closes it.
- **Inline battle replays:** while following, the top three battles replay inline; the timeline pauses and resumes after.
- **Drama strip:** the strip above the timeline slider shows the story's peaks (ui/story/dramaStrip.ts). Click a peak to
  jump there: playback pauses and following lets go.
- The beats are the ticks on the timeline. The director does not frame for daylight, so set Sun to Follow (§2).
- **Following one realm:** select it in Factions. The director gives the selection's stories a focus bonus (storyView
  `focus`).

## 4. Panels

The right column shows the Chronicle, View and one **context panel**: Factions, or Why while it is open, or the story's
battle. The other panels sit under **More panels (n)** (click it to show them; "Fewer panels" hides them again), and empty
panels are hidden. On a phone the sheet's tabs put the context panel first and hide empty tabs.

Each panel's key opens and closes it (ui/shortcuts.ts registry; `?` lists all keys):
- `C` **Chronicle**: notable events up to the year shown, newest first. Your choices on the throne appear here in hedged
  words ("is said to…").
- `R` **Factions**: the realms alive in the year shown, largest first. A realm's detail shows its ruler, wars, grudges and
  oaths (the grudges, balance and arms lines live here), and **Take this throne**.
- **Why**: opened from a chronicle entry's or a caption's "Why?" link (`why=event:<id>`). It shows the causes, each with its
  tier, and "What came of it?". `Esc` closes it.
- `P` peoples, `F` faiths, `D` sickness, `G` goods and trade, `I` ideas, `N` species, `U` cities, `T` leisure travel, `A`
  sagas, `B` the library, `O` Nudge (orders for watch mode), `W` What if (`[` / `]` move its swipe divider), `K` the unexplored world, `J` credits, `S` sun and
  quality, `L` layers, `?` help.
- `.` replays the latest battle (at the selected town, if it saw one); `Esc` closes the replay. `Y` or a double-click flies
  down into a town (the city view: `Q`/`E` turn, `Z`/`X` lower or raise the view, `+`/`−` move closer or further, `Esc`
  returns to the globe).

## 5. Time and speed

- `Space` plays or pauses; at the end of the history it simulates further. `←`/`→` step one snapshot, `Shift+←`/`→` ten,
  and `Home`/`End` go to the first or last year.
- `1`–`4` set the speed to ¼×, 1×, 4× or 16× (timeline.ts SPEEDS); the speed buttons on the bar do the same. 1× is 6.7
  years a second. In throne mode the timeline plays up to each pause, so 16× shortens the waits between cards.

## 6. Throne mode (the seat)

- **Entering:** in Factions, select a living realm and click **Take this throne**. The button appears only when the realm
  exists and is alive in the year shown (politiesPanel.ts), and you rule from that year. Or use a link:
  `seat=<kind>:<id>:<from>[:amb=a.b]` (contract.ts encodeSeat), where `kind` is `polity`, `house` or `people`, for example
  `?seed=42&lang=1&seat=polity:2:700`.
- **Finding a seat alive at a year:** open `?seed=S&year=Y&play=0` and press `R`. The list is that year's living realms,
  largest first, and the top one is a safe choice. A `seat=` id that is dead at `from` gives a seat that is lost at once.
- **Ambitions:** `amb=` takes AmbitionKind numbers: 0 endure 300 years, 1 unify your landmass, 2 a faith of the realm, 3
  the richest realm, 4 two crowns at once, 5 a great monument. They are judged only and change nothing in the run. There is
  no picker for them in the UI; the link is the only way to set them.
- **The loop:** "Reaching your reign…" plays the years up to `from`. The timeline then plays on and pauses at each year
  with decisions, and the decision screen shows. Your choices go into the address as `o=`, so reloading the link replays the
  same reign to its last pause. "The seat is lost" ends the reign; "Watch on" continues as a spectator.
- **The decision screen** (ui/seat/decisionCard.ts, cardModel.ts):
  - Title and year ("Revolt: Riaku", "705 · decision 1 of 2"), a short situation, and the **Authority** meter.
  - 2–4 option cards. Each has a corner badge (what it costs or risks: War, Terms, Tribute, Heir, −15% gold, Debt, Unrest,
    Walls, Ports, Settlers…), a name, a type tag (War, Diplomacy, Court, Coin, Faith, Works, Discovery) and a line of
    consequence.
  - Keys `1`–`4` pick the cards in order. **Show me** flies to the place, with a pill to come back.
  - Watch for a **Wait** badge with "The court keeps its own counsel; events take their course". That option gives no
    order: choosing it is the same as letting events run (it can be "Crush it" on a revolt or "Endure").
- **Defer** ("Do nothing — let <body> decide", or `Esc`): the deciding body takes the option a cautious court would. The
  button names it ("They would choose: …"). The body can be your court, the elders, the regent's council, the league's
  council or the family (decider.ts). Each deferral lowers Authority by (1 − 0.7 × divisiveness) / 5 (SEAT.deferDivisive, deferFull): close to 1/5 for a routine matter and less for a divisive one,
  whose blame then falls on the body. Each decision you take yourself restores some. At low Authority the body rules in all
  but name: only urgent cards come, the throne is less safe and successions are more contested. A Crisis card may then
  offer **Reclaim power**, which is risky.
- **Card kinds** (contract.ts DecisionKind) and their options:
  - War declared on us: Fight on / Sue for peace / Offer tribute / Seek an ally
  - A neighbour is weak (Opening): Strike / Stay out / Offer a match
  - Succession (Heir): Name the heir born in … / Let the law decide
  - A crisis at court (Crisis): Placate them / Crush the pretender / Endure / Reclaim power
  - Alliance made: Honour it / Renounce it
  - Alliance sought: Seek an ally / Decline
  - Overlord: Pay / Defy
  - Match: Arrange the match / Decline
  - General: Honour / Purge him / Ignore it
  - Plague: Quarantine the ports / Move the court / Endure
  - Faith: Embrace it / Keep the old ways
  - Revolt: Placate them / Fortify the capital / Crush it
  - Credit: Borrow / Raise taxes / Retrench / Refuse the debts
  - Charter: Grant it / Refuse
  - Betrayal: Make a separate peace / Stand by them
  - Frontier: Send settlers / Explore further / Stay at home
  - Crop: Take it up / Ignore it
  - Idea: Seek it out / Ignore it
  - The merged systems' cards (each comes from something that happened to your realm that year; seat/watch.ts mergedCards).
    Every option but the last gives a real order, named in its line of consequence; the last is the court's own course:
    - The crown defaults (Default; finance): Raise taxes / Refuse the debts / Placate them / Retrench
    - The war chest (WarChest; finance): after you declare a war, Borrow / Raise taxes / Retrench; when the soldiers go
      unpaid, Sue for peace / Raise taxes / Borrow / Fight on
    - After the battle (Battle; battles, at least 6,000 men): won, Offer terms / Reward the army / Fight on; lost, Sue for
      peace / Raise taxes / Recall the general / Fight on
    - A bluff exposed (Bluff; beliefs): a rival's bluff seen through, Call the bluff / Defy (if it is your overlord) / Stay
      out; your own seen through, Raise taxes / Fortify the capital / Seek an ally / Endure
    - An intelligence report (Intelligence; beliefs): a rival's secret alliance revealed, Seek an ally / Fortify the capital
      / Ignore it; its spies caught, Strike / Renounce it / Fortify the capital / Ignore it
    - Disaster (an eruption, quake, wave or flood that killed at least 200, a town destroyed, a volcanic winter):
      Send relief / Raise taxes / Move the court (if it struck the capital) / Endure
    - An ally calls (AllyCalls; oaths): Join the war / Renounce it / Stay out
    - Betrayed by an ally (Betrayed; oaths): Avenge it / Seek an ally / Endure
    - A city breaks free (Commune; city-states): Strike / Seek an ally / Stay out
    - A cold war (ColdWar): Seek an ally / Raise taxes / Fortify the capital / Endure
    - The merchant houses take sides (Houses; families): Placate them / Fortify the capital / Ignore it
  - With battles on, a general of yours who wins renown brings the General card (Honour / Purge him / Ignore it).
  - Credit comes when the crown's need is at least 0.4 (debts, arrears, a recent default, or a war with some debt).
- **What you can know:** cards describe what your realm's people know (the fog). A bot or play-tester must judge only from
  the screen: the card, the meter, the chronicle and the map.

## 7. Playing sensibly (for bots and play-testers)

1. Before judging anything, set Sun to Follow (`S`, then Follow), turn on Follow the story (`H`), and frame land: Factions,
   then the realm, then its capital.
2. Take a living throne: the top realm of the Factions list in the chosen year.
3. Use 16× (`4`) between cards and read every card in full before choosing.
4. Note whether a later card or chronicle line shows what your last choice did. That is the "visible consequence" the
   harness measures.
