# worldseed player primer

Version: 7 (src/bots/primer.ts PRIMER_VERSION). Every UI-driven bot (scripts/bots-ui.mjs) and every LLM play-tester reads
this file, and nothing else, to learn how to play. Each item was checked against the code named beside it. A lane that
changes the UI controls, the cards, the orders or the seat options updates this file and bumps the version (see
_LANE_BRIEF.md "Bots and primer"). `src/bots/coverage.test.ts` fails when a keyboard shortcut or a decision kind is missing here.

Changelog:
- v1 (2026-11-27, lane/bots): first version, from origin/main f20cb5f.
- v2 (2026-11-27, lane/setup merge): presets (the start page's History toggle, `v=2`, `preset=`, per-switch overrides) and the throne link.
- v3 (2026-11-27, lane/onboard merge): play paths on the start page, Follow on by default for first visits, the context panel and "More panels", the drama strip, caption Share and Watch the battle, inline battle replays, caption swipe on a phone.
- v4 (2026-11-27, lane/n4b): watch-mode polish from LLM play-test #1: Read more expands the caption itself, Resume plays
  on, the caption's place is pinned on the globe, a drama-strip jump captions and frames its story, the time left follows
  the real pace, Why sits in the context slot (`R` or `Esc` closes it), the chronicle holds still under the pointer,
  Factions keeps its rows with More panels open, the replay's side legend and skip button, Show me lets following resume.
- v5 (2026-11-27, lane/n1 surfacing; written as v4 in the lane, renumbered at the merge after n4b): eleven cards for the
  merged systems (finance, battles, beliefs, disasters, oaths, city-states, cold wars, merchant houses), a renowned general
  bringing the General card, Credit coming at a lower need, and the story director telling battles, eruptions, defaults,
  betrayals and bluffs.
- v6 (2026-11-27, lane/n3 throne slice; written as v4 in the lane, renumbered at the merge after n4b v4 and n1 v5): Rule a kingdom opens Dramatic; the seat dashboard ("Your throne": arms, medallions, ambition picker, 50-year odds, hazards with Why?, the realm's feed, reigns with share links); cards show the news since the last card, "Because you…" lines, named heirs, each option's risk and odds move; Crush is now "Garrison the town" (a real order); card keys are exclusive while a card is shown; reign-end summaries; Authority shows its number.
- v7 (2026-11-28, lane/n3b throne balance r2): Unify is won by war (10 towns taken in wars you declared, your share of the land held); Monument
  is a great work of your doing (begun within 40 years of the order that leads to it: a war, a faith, an idea or a crop you
  sought; not the capital's castle or palace, not a town's temple); the Overlord
  card warns when the overlord is about to take the realm whole (Keep paying / Defy / Defy, with an ally); the surfacing
  lane's options (Send relief, Reward the army, Recall the general, Offer terms…) say what follows and move the odds; a
  reign's share link keeps only that reign's choices and opens at its year; the ambition picker asks before it restarts
  the reign; on a phone the throne's tab opens with the first card; three new story arcs (the uncle on the throne, the
  child king, the provinces rise).

## 1. Starting a world

- **The start page** shows only at the bare URL, or with `intro=1` (main.ts `showLanding`). It has a seed field (with a dice
  for a random seed), a years field (200 to 6000; landing.ts YEARS_MIN/MAX) and **Start**. "Choose where peoples begin" plants
  hearths (written as `c=`). Any other URL parameter opens the app directly.
- **Play paths** (ui/onboardPolicy.ts PLAY_PATHS): the start page offers three ways in. **Watch history unfold** (the
  primary button; `Enter` in a field picks it) starts the world with Follow the story on. **Rule a kingdom** opens the
  throne link below (seed 61343, `seat=polity:0:700`) in **Dramatic**, unless you picked a preset on the page first (main.ts
  onPath, lane N3). **Keep an old great power alive** (lane N3) opens the second curated throne: seed 7's Thotakor from
  995 (`seat=polity:1:995`, Dramatic), a realm of nearly five centuries, deep in debt and paying tribute (onboardPolicy.ts
  OLD_POWER_START). **Explore freely** starts the world with
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
  Read more, Why? and Next. **Read more** expands the caption itself with the subject's saga where it tells this moment
  (the story waits while you read; **Less**, Next or × goes on), with a link to the whole saga in Sagas. The caption's
  place is marked on the globe with a ring and its name. **On a first visit it is on by default** (ui/onboardPolicy.ts followByDefault): unless the
  address has `follow=0`, or opens somewhere particular (`seat`, `cmp`, `fly`, `select`, `polity`, `year`, `lon` or `lat`).
  Later visits start with it off. While following, quiet stretches fast-forward (⏩ and "~N min" beside Follow: the story
  time left at this speed, scaled by how fast the story has really gone on this device, so it counts down as it plays).
  Any camera move of yours (drag, zoom, a panel's fly-to) pauses following: the **Following paused · Resume** chip
  appears, and **Resume** follows again and plays on if the timeline was paused. With
  Follow on, story notices show too; without it, "Story notices" in the layers toggles them.
- **Captions** also have **Share** (a link with `year=` and `follow=1`) and, on battle beats, **Watch the battle** (the 2D
  replay). On a phone, swipe a caption sideways: left is Next, right closes it.
- **Inline battle replays:** while following, the top three battles replay inline; the timeline pauses and resumes after.
- **What decided a battle** (lane n5, no new control): battle captions and chronicle lines name the deciding factor ("the
  defenders held the ford", "fog gave the attackers surprise", "snow broke the attack", "hunger thinned the ranks"); the
  replay draws the day's weather (rain, snow, fog, heat), terrain cues (rivers, the ford, woods, high ground, walls, the shore,
  mud) and a legend (Ground, Weather, Decided by); the battle context panel opens with a summary table.
- **Drama strip:** the strip above the timeline slider shows the story's peaks (ui/story/dramaStrip.ts). Click a peak to
  jump there: playback pauses, following lets go, and the strongest story at the peak gets a caption, a pin and a
  camera flight. **Resume** (or Space and a moment's wait) goes on from there.
- The beats are the ticks on the timeline. The director does not frame for daylight, so set Sun to Follow (§2).
- **Following one realm:** select it in Factions. The director gives the selection's stories a focus bonus (storyView
  `focus`).

## 4. Panels

The right column shows the Chronicle, View and one **context panel**: Factions, or Why while it is open, or the story's
battle. The other panels sit under **More panels (n)** (click it to show them; "Fewer panels" hides them again), and empty
panels are hidden. On a phone the sheet's tabs put the context panel first and hide empty tabs.

Each panel's key opens and closes it (ui/shortcuts.ts registry; `?` lists all keys):
- `C` **Chronicle**: notable events up to the year shown, newest first. While the pointer is over the list (or a row has
  the focus) the rows hold still, so a click lands on the line you aimed at; the new lines come in when the pointer leaves. Your choices on the throne appear here in hedged
  words ("is said to…").
- `R` **Factions**: the realms alive in the year shown, largest first. A realm's detail shows its ruler, wars, grudges and
  oaths (the grudges, balance and arms lines live here), and **Take this throne**.
- **Why**: opened from a chronicle entry's or a caption's "Why?" link (`why=event:<id>`). It shows the causes, each with its
  tier, and "What came of it?". It takes the context slot near the top of the column (Factions steps aside); `Esc`, `R`
  or its × closes it and brings Factions back.
- `P` peoples, `F` faiths, `D` sickness, `G` goods and trade, `I` ideas, `N` species, `U` cities, `T` leisure travel, `A`
  sagas, `B` the library, `O` Nudge (orders for watch mode), `W` What if (`[` / `]` move its swipe divider), `K` the unexplored world, `J` credits, `S` sun and
  quality, `L` layers, `?` help.
- `.` replays the latest battle (at the selected town, if it saw one); `Esc` closes the replay. The replay names the sides
  by colour above the field; ⏭ skips the clash to the break (pressed again, to the end). `Y` or a double-click flies
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
- **Ambitions:** `amb=` takes AmbitionKind numbers: 0 endure 300 years, 1 unify the land by war (lane N3b: take 10 towns
  in wars you declared yourself since the seat's year (an order you chose on a card, not one left to the court: Strike,
  Join the war, Avenge it, Call the bluff) and hold your share of the landmass's people, vassals' and tributaries' counting, at
  most 10 points below your share at the start (or below 60%), 10 years running, with 5 towns of your own), 2 a faith of the
  realm, 3 the richest realm for 25 years, 4 two crowns at once, 5 a great monument of your doing (lane N3b: a great landmark begun and finished by the realm while
  you hold the seat, within 40 years of your order that leads to it (chosen by you, not left to the court): a victory monument after a war you ordered (Strike,
  Join the war, Avenge it, Call the bluff), a great temple or monastery after you embraced a faith, a library, market hall
  or guildhall after you sought an idea or took up a crop; the castle, palace, a mausoleum or a town's temple do not
  count, they come whatever you do). The **first** ambition is
  the reign's: the dashboard shows how it stands, and with Unify first the "A neighbour is weak" card comes more often (every
  10 years instead of 25; seat/watch.ts coolOf). Otherwise they are judged only. **Picker:** the dashboard's "Change
  ambition…" list; choosing another one asks first, then restarts the reign from its first year (the address keeps the
  seat, drops `o=` and `year=`).
- **The loop:** "Reaching your reign…" plays the years up to `from`. The timeline then plays on and pauses at each year
  with decisions, and the decision screen shows. Your choices go into the address as `o=`, so reloading the link replays the
  same reign to its last pause. "The seat is lost" ends the reign; "Watch on" continues as a spectator.
- **The decision screen** (ui/seat/decisionCard.ts, cardModel.ts):
  - Title and year ("Revolt: Riaku", "705 · decision 1 of 2"), a short situation, and the **Authority** meter, with its
    number ("Authority 72") and what leaving this matter costs now ("leaving it: −8 now"; it recovers ×0.9 of the deference
    with each decision you take, so a later reading can be smaller).
  - **Since the last card** (a gold-edged box, lane N3 ui/seat/throne/callbacks.ts): the realm's news (who died and how, who
    takes the throne, aged what, "known as Aru before the crown"; wars ended), **"Because you…"** lines that tell what came of
    your earlier choices (a match made or refused, an heir crowned or dead first, walls raised, peace made), your ambition,
    and the **odds the realm stands 50 years** with ▲/▼ since the last card.
  - 2–4 option cards. Each has a corner badge (what it costs or risks: War, Terms, Tribute, Heir, −15% gold, Debt, Unrest,
    Walls, Ports, Settlers…), a name, a type tag (War, Diplomacy, Court, Coin, Faith, Works, Discovery), a line of
    consequence (the order's effect and what likely follows), **Risk: low / some / high / grave** (the court's risk table),
    and, where the option scales a hazard by a known factor (Placate, Purge, naming an heir, suing for peace), **"Odds the
    realm stands 50 years: 62% → 71%"**.
  - Keys `1`–`4` pick the cards in order. While a card is shown the number keys belong to it: they do not change the
    playback speed (lane N3; before, `1`–`4` also set ¼×–16×). **Show me** lifts the screen and flies to the place; the pill
    "Back to the decision" (or `Esc`) brings it back. If you were following the story, following resumes once the card is
    answered (n4b: historyView.peek).
  - A **Wait** badge marks the option that gives no order. Its line now says what that means ("Nothing is done: the crisis
    runs its course"; "No one is named: the law's heir, Aru (son, 19), succeeds unless the lords contest it").
- **Defer** ("Do nothing — let <body> decide", or `Esc`): the deciding body takes the option a cautious court would. The
  button names it ("They would choose: …"). The body can be your court, the elders, the regent's council (only while the
  ruler is a minor), the league's council or the family (decider.ts). Each deferral lowers Authority by (1 − 0.7 × divisiveness) / 5 (SEAT.deferDivisive, deferFull): close to 1/5 for a routine matter and less for a divisive one,
  whose blame then falls on the body. Each decision you take yourself restores some. At low Authority the body rules in all
  but name: only urgent cards come (war on us, a crisis, plague, a battle, a default, a disaster, an ally's call, a betrayal, a city breaking free), the throne is less safe and successions are more contested. A Crisis card may then
  offer **Reclaim power**, which is risky.
- **Card kinds** (contract.ts DecisionKind) and their options:
  - War declared on us: Fight on / Sue for peace / Offer tribute / Seek an ally
  - A neighbour is weak (Opening): Strike / Stay out / Offer a match. It comes when a neighbour is in turmoil, or (lane N3)
    every 5 years when a neighbour at peace with us is clearly weaker at the border.
  - Succession (Heir): Name Aru (son, 23) heir[, the law's choice] / Name … / Let the law decide. Heirs have names (made
    from the house's names; a ruler crowned under another name is "Aru, crowned as Tika"). No heir under 3 is offered by
    name. The card comes once a reign, again only if the heir it named as the law's has died.
  - A crisis at court (Crisis): Placate them / Crush the pretender / Endure / Reclaim power. Its text says the cause (a
    disputed succession, or a regency for a child); the same crisis does not come again within 20 years.
  - Alliance made: Honour it / Renounce it
  - Alliance sought: Seek an ally / Decline
  - Overlord: Pay / Defy. Lane N3b: when the overlord could soon take the realm whole (a vassal for most of 80 years and
    far the stronger at your capital), the card says so and comes every 10 years: **Keep paying** (what the court does if you leave it
    to them; it ends with the realm absorbed) / Defy / **Defy, with an ally** (the tribute stops and an alliance is sought with the
    overlord's rival in the same breath; only when such a rival is known).
  - Match: Arrange the match / Decline
  - General: Honour him / Purge him / Ignore it (Honour gives gold to the court: a Placate order)
  - Plague: Quarantine the ports / Move the court / Endure
  - Faith: Embrace it / Keep the old ways
  - Revolt: Placate them / Fortify the capital / Garrison the town / Ignore it. **Garrison the town** (the old "Crush it")
    is a real order now: the risen town is walled and garrisoned (a Fortify order on it). The text says whether the rising
    was put down. A town that broke away gives no card; the dashboard's feed reports towns lost.
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
    - After the battle (Battle; battles, at least 300 men, at most one every 8 years): won, Offer terms / Reward the army / Fight on; lost, Sue for
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
- **A reign ends:** when a ruler of your realm dies or falls, the next pause first shows **"The reign of King X the …
  ends"**: years, how it ended, what you decided, what came of it, the epithet (ui/sagas/epithets.ts), **Share this reign**
  (a link that replays it: lane N3b, it keeps only the choices made up to that reign's end and opens the view at its
  year, `year=`) and **Continue**.
- **Your throne** (the dashboard, the right column's context panel while seated; on a phone, the bottom sheet): the
  realm's arms and age, the ruler's and heirs' medallions, the ambition and its picker, the **odds the realm stands 50
  years** ("if things stay as they are": no overthrow, contested succession, default, a quarter of the realm lost to
  risings, or a war lost badly), the meters (Treasury, Debt, Legitimacy, Unrest, Authority, War) with ▲/▼ since the last
  card, the **yearly hazards** each with **Why?** (its factors: an unpaid army, magnates, a famous general, your orders,
  deference), the realm's age (not a risk: states do not die of old age), **Your realm** (successions, wars, what came of
  your choices, towns lost, centuries passed) and the past **Reigns** with share links. "Take this throne" is hidden while
  you are seated. The drama strip over the timeline marks the seated span and each card's year in blue. On a phone the
  sheet opens the **Your throne** tab (half height) at the reign's first card (lane N3b).
- **What you can know:** cards describe what your realm's people know (the fog). A bot or play-tester must judge only from
  the screen: the card, the meter, the chronicle and the map.

## 7. Playing sensibly (for bots and play-testers)

1. Before judging anything, set Sun to Follow (`S`, then Follow), turn on Follow the story (`H`), and frame land: Factions,
   then the realm, then its capital.
2. Take a living throne: the top realm of the Factions list in the chosen year.
3. Use 16× (`4`) between cards and read every card in full before choosing.
4. Note whether a later card or chronicle line shows what your last choice did. That is the "visible consequence" the
   harness measures.
