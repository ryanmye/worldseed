# Plan: Future technology (electrification to an invented future) — so 6000-year worlds keep developing

Base commit 8cabf09 (read-only checkout `/home/claude/ryanmye/worldseed`; probes run in `/home/claude/scratch-futuretech`).
Plan only. Tags: **[V]** verified in the code, **[M]** measured here, **[A]** assumed / design default (not a fact),
**[verified]** a literature or fact citation whose page I opened or whose title, venue and identifier a search listing
confirmed (marked *search* when only the listing was seen), **[unverified]** I could not confirm it (reason given).
Every number not followed by a citation is a design default.

**Depends on (hard): tech-tree-innovation.md** (the tree this one continues, its idea keys as prerequisites and its
innovation-pressure model). **Depends on (soft, each with a proxy):** modern-ideologies-regimes.md, society-secular-cycles.md,
state-finances.md, disasters-climate.md, battles.md, city-states.md, riots-uprisings.md, experience-whatif-director-sagas.md
(director registry), city-renderer-eras.md (rendering), perf-efficiency.md (perf budget, goldens).
**Status of the two parallel plans:** tech-tree-innovation.md appeared while this plan was being written and was read in
full before finishing; its keys, levers, eras, intensities and pressure interface are adopted below (section 0.3).
modern-ideologies-regimes.md did not exist when I finished: the only dependency on it is the IdeaKind numbering (0.2) and
read-only inputs it may take from this plan (0.4).

---

## 0. Interfaces

### 0.1 Event ids (block 320–329, all used)
| id | name | settlement | other | value | extra |
|---|---|---|---|---|---|
| 320 | `EraEntered` | largest living settlement of the people | -1 | the era (8–14, tech-tree numbering, 2.2) | 1 when it is the world's first people in that era, else 0 |
| 321 | `WarmingMark` | capital of the people with the largest cumulative emissions | -1 | the mark reached, in tenths of °C (10, 15, 20, 30, 40) | that people |
| 322 | `SkyVeiled` | capital of the sponsoring polity | -1 | offset taken on, tenths of °C | sponsor polity |
| 323 | `VeilFailed` | world's largest town in the hardest-hit weather region | capital of the old sponsor, or -1 | rate of warming in the first 5 years, hundredths of °C a year | `VeilEnd` cause (0 sponsor fell, 1 lost the idea, 2 renounced) |
| 324 | `OffWorldFounded` | the launch site | -1 | History.offWorld row | `OffWorldKind` |
| 325 | `OffWorldEnded` | the launch site (or the parent's capital if the site is gone) | -1 | row | 0 abandoned, 1 independent, 2 returned (survivors came home after a collapse) |
| 326 | `MachineCrisis` | capital of the polity where it began | -1 | outcome (`MachineOutcome`) | the AI era held (0 general, 1 superhuman) |
| 327 | `GreatCollapse` | the world's largest town just before | -1 | share of the world's people lost, permille | `CollapseCause` |
| 328 | `EraRegained` | largest settlement of the people | -1 | the era regained | years since it was lost |
| 329 | `Displacement` | capital of the polity | -1 | smoothed displaced share, permille (logged when it first passes `FUT.dispEvent`) | polity |

Missing-settlement rule (as disasters-climate.md 2.4): if no living settlement qualifies, no event is logged; the table row is
still written. Director (experience-whatif-director-sagas.md 0.1) registrations, in `ui/futureFormat.ts`:
320 Discovery B 5 (×1.5 world-first, ignored when not world-first and era < Present), 321 Nature 4, 322 Nature 5,
323 Nature 7 (mag: harvest loss), 324 Discovery 5, 325 Discovery 4, 326 Politics 7, 327 War/Nature 10 (mag: share lost),
328 Settlement 5, 329 Society 4. All weights [A].

### 0.2 Enum values (next free in the registry of `_CONVENTIONS.md` at the time of writing)
| enum | values | note |
|---|---|---|
| `IdeaHow` | **15 Recovered** (re-learned from records/ruins of what it once held, or from returning colonists) | registry (resolved): 14 Hired is tech-tree's; `CH` becomes 16 (`ideas/state.ts`); HOW arrays in ideasStats.ts and the UI's HOW_SHORT/HOW_CSS gain 'Recovered' |
| `IdeaKind` | **11 Energy, 12 Computing, 13 Life, 14 Space, 15 Earth** (climate, water, habitat) | registry (resolved): 8 Industry, 9 Communication (tech-tree), 10 Ideology (modern-ideologies), 11–15 this plan. Telecom rows use tech-tree's Communication, automation rows its Industry |
| `ArmyEra` (tech-tree 5.1, 0–6) | **7 Mass, 8 Networked** (abstract break points for battles.md: casualty rate and break thresholds only) | appended; no weapon semantics |
| `StructureType` | **6 Airport, 7 Spaceport, 8 PowerStation, 9 Arcology, 10 Desalination, 11 SkyTether** (space elevator anchor) | no other plan adds StructureTypes (grep of all plans: none) [V] |
| `RevoltCause` | **17 Displaced** (automation unemployment) | registry: 16 is court-politics; next free 17 |
| `GrievanceKind`, `ReignEnd`, `OrderKind`, `DecisionKind` | none | seat-mode orders for this plan (e.g. "fund the veil", "ban the machines") are follow-ups only; they take the next free OrderKind/DecisionKind when built (registry: tech-tree 39–40 / 25–26, character-mode 41+ / 27+) |
| New enums (this plan's own) | `IdeaTier`, `OffWorldKind`, `CollapseCause`, `MachineOutcome`, `VeilEnd` | section 2.7 |

IdeaKind and IdeaHow values are fixed by the central registry (`_CONVENTIONS.md`). For the others the registry wins if it
later differs; nothing here depends on the numeric values.

### 0.3 tech-tree-innovation.md (hard dependency): what this plan takes, unchanged
1. **Where it stops.** Its last key is **`electricPower`** (the registry's attach point; the other terminal-frontier keys
   below are also used) and its last era is **7, "the age of steel and electricity" (real c. 1850–1914)**; era 8+ is this plan's
   (its 0.4). This plan's eras are **8–14** (2.2), so it also owns 1914–c.1990 (aviation, antibiotics, nuclear power,
   computers, the green revolution, containers), as that plan recommends.
2. **Its idea keys as prerequisites**, from its terminal frontier: `electricPower, combustionEngine, radio, fertiliser,
   germTheory, sanitation, massSchooling, assemblyLine, bessemer, machineGun, ironclad, refrigeration, limitedLiability`, plus
   `chemistry`, `railway`, `vaccination`, `breeding` (v1/technique). Its `grid`-like, `assemblyLine`, `fertiliser` and `radio`
   rows exist there, so this plan does not repeat them. A test resolves every `pre` key through `ideaIndex` at load.
3. **Its catalogue plumbing.** `ix.defs` is per run (its 2.2). This plan appends its rows after tech-tree's (ids ≥ 107) and
   after modern-ideologies' if that plan appends first; the catalogue is built from the option mask
   `v1 + (techTree ? v2) + (ideologies ? theirs) + (future ? mine)` and PRE/SITE/IDEA_INDEX are computed per mask at module
   load (memoised). **`future` requires `techTree`**: with techTree off the future rows are not in the catalogue (their
   prerequisites do not exist), and the option is ignored (stated in the option's doc comment).
4. **Its innovation-pressure model, as is.** Conception of a future row is that plan's `λ(q,i) = λ₀(q,i) · Mc(q,i)` (its
   3.1, channels War, Rivalry, Labour, Land, Energy, Market, Open, Frag, Shock, Scale), times this plan's two factors only:
   difficulty H and AI acceleration (2.6). Adoption speed is its `Ma`. This plan uses its extension points and nothing else:
   - its `ideas/pressure.ts` functions as is (`pressureStep`, `conceiveMul`, `adoptMul`, `pressureWhy`), so future conceptions
     also get IdeaPressures rows ("why here, why now") for free;
   - `press` specs on its rows (2.2) and **KIND_BETA rows for the five new kinds** (2.6);
   - three channels registered through `registerChannel` at module load, in this order: **`Climate`** (`anthroT − veil`,
     ref 0; drives Earth and Energy rows: necessity), **`Displaced`** (`u_p`, ref 0; drives Administration relief rows),
     **`Race`** (`rivals_p` at the same AI level, ref 0; drives Computing rows and lowers alignment, 2.5.8).
5. **Its S-curve diffusion.** Every lever here is multiplied by that plan's Bass intensity `a = ideaIntensity(ix, p, i)`
   (its 4.4; `IDEA2.sFrom` = 5 < 8, so all future rows are on S-curves), exactly as its own levers are. Its Bass rates were
   set against Comin & Hobijn 2010 [verified: average adoption lag 45 years after invention; newer technologies spread
   faster] and Griliches 1957 [verified-search: logistic adoption of hybrid corn].
6. **Its levers, reused rather than duplicated:** `yield` (food on every settlement), `fisc` (finance taxMul), `tollAll`
   (every disease), `famine`, `army` (ArmyEra), `unlock`/`infraMul` (infrastructure.md networks), `credit`. Only the levers
   it lacks are added here (2.3).
7. **Its era frontier**: `ideaEra(ix, p)` / `eraAt(h, p, year)` ("the highest era of which people p holds at least half");
   ERA_LABELS gains this plan's seven labels. `EraEntered` (320) is this plan's counterpart of its `Industrialised` (304),
   for eras 8–14.
8. **Its streams**: rows of this plan draw from a new **`'history-ideas-future'`** stream (not its `'history-ideas-v2'`), so
   that a future-on run keeps every v1/v2 draw identical until a future row first becomes eligible (2.9).
9. **Its id cap**: it counts 107 ideas; with ~25 ideologies and this plan's 71, about 203. Per the registry, **tech-tree's
   first step widens idea ids to Uint16** (contract, assemble, cache version bump); this plan relies on that and does not
   widen them itself.
10. **Its infrastructure split**: networks belong to infrastructure.md (its 0.6, "airports, containers: none here
    (future-tech)"). This plan's hubs (2.5.2) are the airport/spaceport network. If infrastructure.md claims an `airport`
    InfraKey, hubs are read from it (`ideaUnlock(p, 'airport')` plus its nodes) and 2.5.2 only prices the edges; otherwise
    this plan builds them as written.

**Proxy if tech-tree-innovation.md is not built yet:** none that is useful. The future rows rest on its keys, so this plan is
built after it (build order: after tech-tree, after society/finances/disasters if possible).

### 0.3b Integration rule (owner requirement): what is reused, and why the few new things are new
- **Reused, not paralleled:** ideas catalogue rows and learning/loss (not a separate tech system); tech-tree's pressures,
  Bass intensity, levers (`yield`, `fisc`, `tollAll`, `army`, `unlock`), `ideaEra`/`eraAt`, tree graph; existing events
  Built/StructureLost (4/7), Migration, FirstContact, IdeaConceived/Adopted/Lost; the existing StructureType table (6–11
  added, not a new building table); `losses` for collapse forgetting; society's α, MMP and elite share (not a new class
  model); finances' `taxMul`/`finSpend`; disasters' climate sum and `strikeTown` (not a second climate model); battles'
  quality term; riots' ladder via RevoltCause; polity unrest and civil.ts as proxies; trade edges and `partnerSearch` (air
  links are edges).
- **New, with justification:**
  - `future/` module and `futureYear`: carbon, veil, automation state and the collapse cap are yearly world/polity
    quantities that no existing system owns (disasters owns natural shocks only; society has no technology input).
  - `History.offWorld`: off-world places are not cells, so the settlement arrays cannot carry them (2.5.10).
  - `History.future` series: no History table holds per-year forcing or per-people automation/alignment. With disasters on,
    `anthroT`/`veil` are written **into its `ClimateSeries`**, and the future series keeps them only as the proxy when it is off.
  - UI: no new panel. The world strip and per-people lines go into the **Ideas panel** (a "Future" section) and the
    **polity panel** (society block lines); the off-world list is a section of the Ideas panel.
  - Three pressure channels registered through tech-tree's `registerChannel` (its documented extension point).

### 0.4 Other plans (reads only; each has a proxy)
| plan | what this plan reads / writes | proxy without it |
|---|---|---|
| society-secular-cycles.md | writes: labour share α_p (2.5.4) via a new `socAutomation(s, p)` input; reads `socWage`, `socElite` for the UI | polity unrest (`unrest.ts`) += `FUT.uUnrest · u_p` |
| state-finances.md | via tech-tree's `fisc` lever (2.5.5); UBI costs via `finSpend` | polity reach of tax `ideaAdmin` (existing lever) |
| disasters-climate.md | writes: `anthroT[year]` added to the global T sum (3.2 there) and `resil_p` divides `strikeTown` shares | harvest multiplier on weather.ts' regional harvest (2.5.7) |
| battles.md | writes nothing new; power multipliers go through the existing `ideaWar` → `qualityOf` term [V polity/state.ts:605], which battles.md already treats as quality in r | — |
| riots-uprisings.md | RevoltCause 17 Displaced; reads `futDisplaced(s, p)` | polity unrest proxy above |
| city-states.md | Alesina–Spolaore term (2.5.2) multiplies its charter/secession pressure | polity `civil.ts` secession chance |
| modern-ideologies-regimes.md | reads `futEra`, `futAutomation`, `futAlign` as inputs to ideologies (e.g. techno-utopian / neo-Luddite / green); this plan reads nothing from it | — |
| experience-whatif-director-sagas.md | registers 320–329 (0.1); phrase table `FUT_T` (section 3.4) | — |
| city-renderer-eras.md (parallel) | reads tech-tree's `eraAt`, structures 6–11, `History.future` (section 4) | — |
| perf-efficiency.md | perf budget, golden hashes (`923881e7cd3fe59b` seed 1, `3bac8db3dfd723b5` seed 42, `2bb9f72e9e99433d` seed 1234 at 2000 y) | — |

---

## 1. Current behaviour

### 1.1 The ideas system [V]
- `ideas/params.ts`: 45 ideas (`IDEA_DEFS`), eras 0–4, the last being the early modern centuries (`banking`, `gunpowder`,
  `printing`, `navigation`, `drainage`, `inoculation`, `science`). The header says the sim clock runs "from the first
  villages (year 0) to about the industrial threshold (year 2000)".
- Ideas are per **people** (`s.know.P`, fixed at the start: 6–11 peoples in the seeds probed [M]), not per polity.
  State arrays are `P·I`, `P·I·CH` and `P·P·CH` (`ideas/state.ts createIdeas`) [V].
- Conception (`system.ts learnAndConceive`): chance `conceive · chance/100 · step · cond · (1 + mix·min(mixMax, met)) /
  (1 + cardwell·recent) · (1 + combo·nHeld) · scale` (scale linear in pop/popRef, clamped 0.2–2.5). Learning from met
  holders over 13 channels; backwardness `1 + 8(x − 1)`; resistance by faith/ruler/guild; adoption roll `adopt · use ·
  (1 − r)`. One draw from `'history-ideas'` per considered (people, idea), in people-then-idea order; ideas whose
  prerequisites are missing are skipped **before** any draw [V].
- Loss (`losses`): fragile ideas go when the people is small or below 0.4 of its slowly decaying peak (collapse), and the
  ideas resting on them go too [V]. This is the existing collapse-and-forgetting mechanism this plan reuses.
- Effects (`hooks.ts recompute`): technology caps per field, and levers `land` (trade reach, `trade.ts:568`,
  `goods/longhaul.ts:164`), `seaCost` (divisor of deep-sea cost, `trade.ts:331,368`), `range` (`voyages.ts:262`,
  `exploration.ts:339`), `war` (`polity/state.ts:605` qualityOf), `defence`, `admin` (`polity/state.ts:638` reachOf),
  `toll` (crowd-disease deaths), `craft`, `learn`, `quarantine`, `farm` (per settlement, `population.ts:112`) [V].
- `History.ideaAdoptions.idea` is a **Uint8Array** (`contract.ts:1691`) at 8cabf09 [V]; the registry assigns its widening to
  Uint16 to tech-tree's first step, which this plan assumes is built.

### 1.2 What a 6000-year world does today [M]
`probe/probe-long.ts` (mine, seeds 1 and the probes of the tech-tree agent's `scratch-tech/probe/b6000-*.json` for 7 and 42;
6000 years, default options):

| seed | peoples | last first-conception | best people holds (of 45) at 2000 / 3000 / 4000 / 6000 | max tech level (Farming) 2000 → 3000 → 6000 | world pop 2000 → 3000 → 6000 | run time |
|---|---|---|---|---|---|---|
| 1 | 6 | 5720 (one late origin) | 33 / 39 / 44 / 45 | 3.68 → 4.22 → 4.80 | 0.42 M → 0.95 M → 1.36 M | 173 s (contended) |
| 7 | 10 | 2500 | 37 / 44 / 44 / 44 | techMax 4.12 → 4.84 → 5.26 | — | 72 s |
| 42 | 10 | 3180 | 42 / 44 / 45 / 45 | techMax 4.25 → 4.86 → 5.25 | — | 51 s |

Reading: the tree is exhausted between years ~2500 and ~4000; technology then creeps by ~0.1 a millennium and population
flattens. **Two thirds of a 6000-year run has nothing left to discover.** The ideas system costs ~1 s of a 51–72 s run
(`ideasMs` in the tech agent's probe) [M], so it can grow.

### 1.3 Distance in the sim today [V]
- Migration (`migration.ts siteSearch`): Dijkstra over cells from the origin within a budget; step cost `s.moveCost[j]·tm`
  on land, `T.moveCost[j]·seaMul` at sea, an ocean cost from Seafaring on deep cells.
- Trade (`trade.ts rebuildLinks`, every `TRADE.linkStep`): one bounded multi-source search over the same cell costs builds
  regions; touching regions become **edges** with a cost (`edgeCost`); partners are searched over edges (`partnerSearch`)
  with gravity size/cost². Long-haul legs (`goods/longhaul.ts`) between marts.
- Polity reach: `lambda = lambda0 · (1 + reachCrafts(Crafts − 1)) / sqrt(1 + members/overload)` and `grip(dist, lambda)`
  of each member from the capital (`polity/params.ts:50`, `polity/control.ts:84`).
- Disease: passes over trade routes, long-haul legs, neighbours, and the year's journeys, between peoples in contact only
  (`disease/system.ts` header).
None of them knows a mode of transport faster than a ship or a cart, and none has a hub-to-hub edge.

---

## 2. Design

### 2.1 Principles
1. **Same machinery.** Every future technology is one more `IdeaDef` row: conceived where its preconditions hold, by
   chance, carried by contact, resisted, lost in collapse. Nothing is scheduled by year. Era names are labels on what a
   people holds.
2. **Honest tiers.** Each row has a plausibility tier (`IdeaTier`): **Historical/Present** (in use at scale by 2026),
   **Near** (near-future plausible: demonstrated at prototype or pilot scale, credible path), **Speculative** (consistent
   with known physics; no working system at scale, or a major unsolved engineering problem), **Fiction** (needs physics we
   do not know, e.g. FTL; or physics we know forbids it). `HistoryOptions.futureFiction` (default false) gates the Fiction
   tier: such rows are skipped before any draw, so worlds without it never see them. The UI shows the tier on every idea
   and era line, in words, not only colour.
3. **Abstract war.** Military content is only power multipliers (the existing `war` lever), a deterrence term on war
   declaration, and a capped catastrophe hazard. No weapon specifics, names, or mechanics in data, UI, or prose.
4. **Bounded worlds.** The future must not explode the run: a demographic transition holds population, founding is damped
   (growth goes to existing towns), hubs and off-world rows are capped (section 7).
5. **Collapse is a path, not an ending.** Catastrophes are rare, capped, never total; the existing loss mechanism forgets,
   and a new channel (Recovered) relearns faster than first discovery.

### 2.2 The catalogue (71 rows, prerequisites earlier; ids appended after tech-tree's)

Columns: key; tier (H Present, N Near, S Speculative, F Fiction); kind; pre (this plan's keys, or tech-tree-innovation.md keys such as
electricPower, combustionEngine); main levers (shares per unit, times `IDEA.lever` as today unless stated: see 2.3 for the new levers);
grounding [source]. `chance` and `teach` defaults by tier: H chance 0.25 teach 40; N 0.15 / 60; S 0.08 / 90; F 0.04 / 120
(design defaults [A]); per-row overrides in params.ts. `cond` sketches use `IdeaCtx` fields plus new ones (2.4).

**Era 8 — Electrification and mass production (real c. 1914–1945)**
| key | tier | kind | pre | levers | grounding |
|---|---|---|---|---|---|
| `electrification` | H | Energy | electricPower, assemblyLine | energy +1, craft 0.1, light (night lights, 5) | household and rural electrification after the first grids (tech-tree's `electricPower`) [unverified: common history] |
| `motorRoad` | H | Transport | combustionEngine, bessemer | land 0.25, landStep (2.5.1), reach 0.05, unlock road ×infraMul | motor lorries and paved highways [unverified] |
| `aviation` | H | Transport | combustionEngine, bessemer | air mode on (hubs, 2.5.2), range 0.1 | powered flight 1903; airlines from 1919 [unverified] |
| `antibiotics` | H | Health | germTheory, chemistry | tollAll −0.3, life 0.05 | penicillin (1928, mass production 1940s) [unverified] |
| `incomeTax` | H | Administration | limitedLiability, massSchooling | fisc 0.2 | broad income taxes of the 20th century; fiscal capacity as investment (Besley & Persson 2011 [verified-search]) |

**Era 9 — Computing, telecom, the atom, the jet (c. 1940–1990)**
| key | tier | kind | pre | levers | grounding |
|---|---|---|---|---|---|
| `fission` | H | Energy | electrification, chemistry | energy +1, clean 0.3 | first reactor 1942, power 1950s [unverified] |
| `deterrence` | H | War | fission | deter (2.5.6), war 0.1 | abstract "weapons too terrible to use"; stability–instability paradox (Snyder 1965 [verified-search: Wikipedia/handbook entries, original book chapter not opened]); whether deterrence keeps the peace is contested (Sagan & Waltz 1995 [verified-search]) |
| `computer` | H | Computing | electrification, radio, massSchooling | learn 0.15, admin 0.05, craft 0.05 | stored-program computers, 1940s [unverified] |
| `jetAirliner` | H | Transport | aviation | air cost ÷ 2 | jet airliners, 1950s [unverified] |
| `container` | H | Seafaring | motorRoad | seaCost 0.4, land 0.1 | container shipping (1956) [unverified] |
| `greenRevolution` | H | Farming | fertiliser, breeding | yield 0.3 | high-yield varieties, 1960s [unverified] |
| `rocketry` | H | Space | aviation, computer | unlocks space | orbital launch 1957 [unverified] |
| `satellite` | H | Space | rocketry | resil 0.15 (warning), reach 0.05, learn 0.05 | weather and communications satellites |
| `highSpeedRail` | H | Transport | electrification, railway | landStep ÷, rail hubs | Shinkansen 1964 [unverified] |
| `vaccinesMass` | H | Health | antibiotics, vaccination | toll −0.3, tollAll −0.1 | mass immunisation programmes |
| `pill` | H | Health | antibiotics | fert −0.25 (2.5.3) | oral contraception (1960) [unverified]; fertility decline is one arm of the demographic transition (Lee 2003 [verified-search]) |
| `welfareState` | H | Administration | incomeTax | relief 0.3, fisc 0.05 | social insurance |

**Era 10 — The networked present (c. 1990–2026)**
| key | tier | kind | pre | levers | grounding |
|---|---|---|---|---|---|
| `internet` | H | Communication | computer, satellite | learn 0.25, reach 0.15, admin 0.1, newTask 0.05 | ARPANET 1969, web 1991 [unverified] |
| `mobile` | H | Communication | internet | reach 0.1, learn 0.1 | mobile phones |
| `robotics` | H | Industry | computer, assemblyLine | autom 0.1, craft 0.2 | industrial robots |
| `narrowAI` | H | Computing | internet | autom 0.1, learn 0.15, aiLevel 1 | machine learning systems in wide use |
| `crispr` | H | Life | computer, vaccinesMass | yield 0.1, toll −0.1, life 0.05 | programmable Cas9 (Jinek et al. 2012 [verified-search]); first approved CRISPR therapy, Casgevy, FDA 8 Dec 2023 [verified-search] |
| `reusableRocket` | H | Space | rocketry, computer | launch cost ÷ 3 | first landed orbital booster, Falcon 9, 21 Dec 2015 [verified-search] |
| `station` | H | Space | rocketry | off-world Station rows | crewed orbital stations |
| `maglev` | H | Transport | highSpeedRail | landStep ÷ | Shanghai maglev, commercial from 2004 [verified-search] |
| `robotaxi` | H | Transport | narrowAI, motorRoad | landStep ÷ (small), autom 0.03 | Waymo fully driverless public service, Phoenix 2020, all of San Francisco 2024 [verified-search] |
| `desalination` | H | Earth | electrification | water (dry coast carrying capacity, 2.5.3) | reverse-osmosis desalination at city scale [unverified] |
| `verticalFarm` | H | Farming | electrification, robotics | vfarm (urban food, 2.5.3) | indoor farms exist; economics contested [unverified] |
| `solarWind` | H | Energy | electrification, computer | energy +0.5, clean 0.4 | utility solar and wind |
| `pandemicWatch` | H | Health | internet, crispr | outbreak beta −0.3 on air edges, quarantine | genomic surveillance |

**Era 11 — The near future**
| key | tier | kind | pre | levers | grounding |
|---|---|---|---|---|---|
| `generalAI` | **S** (contested) | Computing | narrowAI, robotics | autom 0.35, learn 0.4, aiLevel 2 | no system meets broad definitions of general intelligence as of this writing [A: owner may retag N]; explosive-growth arguments conditional on it (Davidson 2021 [verified]) |
| `alignment` | N | Computing | narrowAI | align research (2.5.8) | AI race model: more teams and more hostility raise risk (Armstrong, Bostrom & Shulman 2016 [verified]) |
| `eVTOL` | N | Transport | aviation, robotics | vertiport hubs (short air edges, 2.5.2) | electric air taxis in certification [unverified: status not checked] |
| `smallReactor` | N | Energy | fission, computer | energy +0.5, clean 0.3 | small modular reactors [unverified] |
| `fusion` | N (contested; S for power plants) | Energy | fission, computer | energy +2, clean 0.5 | NIF ignition: 3.15 MJ out for 2.05 MJ laser energy, 5 Dec 2022 [verified-search]; no net-electric plant yet |
| `airCapture` | N | Earth | solarWind | removal of cumulative carbon (2.5.7) | Climeworks Orca, 4000 t CO2/yr, opened Sept 2021 [verified-search] |
| `skyVeil` | N | Earth | rocketry, satellite | veil (stratospheric aerosol), termination risk (2.5.7) | deployment would be logistically feasible and cheap per Smith & Wagner 2018 [verified-search]; termination warms fast (Jones et al. 2013 [verified]; Trisos et al. 2018 [verified]) |
| `culturedMeat` | N | Farming | crispr, verticalFarm | vfarm 0.5 (land-free food) | Singapore approved cultivated chicken, Dec 2020 [verified-search] |
| `geneDrive` | N | Life | crispr | fever (place-bound disease) mort −0.4 | — [unverified status] |
| `lunarBase` | N | Space | reusableRocket, station | off-world Lunar rows | — |
| `quantumComputer` | N (contested usefulness) | Computing | computer | learn 0.1 | — |
| `digitalState` | N | Administration | internet, narrowAI | fisc 0.15, admin 0.15, reach 0.1 | — |
| `basicIncome` | N | Administration | digitalState, robotics | relief of displacement (2.5.4) | — |
| `quakeProof` | H | Earth | computer, bessemer | resil 0.3 | — |

**Era 12 — The speculative future (known physics, unproven engineering)**
| key | tier | kind | pre | levers | grounding |
|---|---|---|---|---|---|
| `superAI` | S | Computing | generalAI | autom 0.3, learn 1.0, aiLevel 3, MachineCrisis hazard | — (speculative, flagged) |
| `hyperloop` | S | Transport | maglev | landStep ÷ (long lines only) | Hyperloop One shut down Dec 2023 without a passenger line [verified-search] |
| `pointRocket` | S | Transport | reusableRocket | rocket hubs (spaceports), air cost ÷ for > 5000 km | suborbital point-to-point travel (proposed, not flown commercially) [unverified] |
| `orbitalSolar` | S | Energy | reusableRocket, solarWind | energy +2, clean 0.5 | Caltech SSPD-1 beamed power in space, 2023 [verified-search] |
| `marsColony` | S | Space | lunarBase, fusion or smallReactor | off-world Mars rows (can become independent) | — |
| `spaceElevator` | S | Space | reusableRocket, `nanomaterial` | launch cost ÷ 20; needs an equatorial site | tether materials unproven at scale [unverified: no source opened] |
| `nanomaterial` | S | Industry | quantumComputer or generalAI | craft 0.3, Crafts cap | — |
| `arcology` | S | Earth | verticalFarm, fusion or smallReactor | density cap ×2 for towns ≥ CITY_POPULATION, founding damp (2.5.3) | — |
| `longevity` | S | Life | crispr, generalAI | life 0.3 (rulers' reigns, mortality), fert −0.1 | — |
| `oceanCity` | S | Earth | arcology, desalination | sea settlements? **no** (cells are fixed): coastal towns' density cap ×1.3 | — |
| `habitat` | S | Space | marsColony, spaceElevator or orbitalSolar | off-world Habitat rows (large) | O'Neill-style rotating habitats [unverified] |
| `weatherControl` | S | Earth | skyVeil, superAI | regional drought −50% (disasters), veil stable | — |
| `molecularFab` | S (contested) | Industry | nanomaterial, superAI | craft 0.5, yield 0.2 | contested feasibility [unverified] |
| `upload` | S | Life | superAI, longevity | life 0.2, learn 0.3 (far) | — |
| `longArchive` | N | Knowledge | internet, satellite | support of every held idea against loss (2.5.9); seeds Recovered | — |
| `planetaryDefence` | N | Space | rocketry, satellite | impact hazard −90% (2.5.9) | — |

**Era 13 — The far future**
| key | tier | kind | pre | levers | grounding |
|---|---|---|---|---|---|
| `dysonSwarm` | S | Energy | habitat, orbitalSolar | energy +5, clean 1 | — |
| `interstellarProbe` | S | Space | fusion, habitat | learn 0.1, Chronicle only | — |
| `generationShip` | S | Space | interstellarProbe | off-world Starship rows (leave forever: emigration sink, no remittance) | — |
| `stewardAI` | S | Administration | superAI, alignment | admin 0.5, fisc 0.3 when align ≥ 0.8 (2.5.8) | — |
| `planetCraft` | S | Earth | weatherControl, dysonSwarm | anthroT pinned to 0, harvest variance −50% | — |

**Era 14 — Fiction (only with `futureFiction`)**
| key | tier | kind | pre | levers | grounding |
|---|---|---|---|---|---|
| `teleport` | **F** | Transport | superAI, fusion | gate hubs: hub-to-hub cost ≈ 0 (2.5.2) | matter teleportation needs unknown physics; *quantum* teleportation moves quantum states, not matter (stated in the UI) [A] |
| `warpDrive` | F | Space | generationShip, teleport | off-world Colony rows far away grow fast; remittances | FTL travel conflicts with relativity as understood [A] |
| `replicator` | F | Industry | molecularFab, teleport | yield 1, craft 1 | — |
| `forceField` | F | War | dysonSwarm | defence 0.5 | — |
| `mindNet` | F | Computing | upload, teleport | learn 1, reach 1 | — |
| `timeSight` | F | Knowledge | mindNet | chronicle-only "omens" (no sim effect beyond learn 0.2) | — |

(71 rows: era 8 has 5, 9 has 12, 10 has 13, 11 has 14, 12 has 16, 13 has 5, 14 has 6. Era is generation (what it is built
on), tier is plausibility, and they differ by design: `generalAI` is S-tier in era 11, `longArchive` and `planetaryDefence`
are N-tier in era 12. Each row also gets a `press` spec where its kind default is wrong, e.g. `skyVeil` {Climate 2},
`airCapture` {Climate 1.5}, `basicIncome` {Displaced 2}, `alignment` {Race 1, Open 0.5}, `generalAI`/`superAI` {Race 1.5,
Market 1}, `deterrence` {War 1.5, Rivalry 1.5} — design defaults [A].)
**Ordering and "or" prerequisites.** `IdeaDef.pre` is AND-only today [V]. Add `preAny?: string[]` (at least one held), checked
in the same place as `pre` (`learnAndConceive`, `losses`' prerequisite pass, `PRE`); rows are topologically sorted in
params.ts (`nanomaterial` before `spaceElevator`), and the existing test that prerequisites come earlier covers `preAny`.
`history` strings: one or two sentences, each fact sourced as in the columns or written as "proposed" / "imagined".
**The [unverified] grounding lines above are common historical facts I did not open a page for; the build agent verifies
each before writing it into a `history` string, or drops the date.**

### 2.3 New IdeaDef fields (all optional; absent = 0; levers are shares per unit as today, times tech-tree's Bass intensity `a = ideaIntensity(ix, p, i)` and `IDEA.lever` unless stated; written `·a` below)
```ts
  /** future: plausibility tier (IdeaTier); absent = Historical (every existing row). */
  tier?: IdeaTier
  /** future: at least one of these keys must be held as well as every key of `pre`. */
  preAny?: string[]
  /** future: energy per head added (units of FUT.energyRef; not times lever) and the clean share it brings (0..1, of its own energy). */
  energy?: number
  clean?: number
  /** future: divisors of travel cost by mode: landStep (rail, road, maglev, hyperloop), air (cost per km on hub edges), launch (cost to orbit). */
  landStep?: number
  air?: number
  launch?: number
  /** future: hub kind it opens (HUB_AIR, HUB_VERTI, HUB_ROCKET, HUB_GATE) — section 2.5.2. */
  hub?: number
  /** future: reach of rule and of news (polity lambda multiplier share). */
  reach?: number
  /** future: water for dry coasts (desalination), land-free urban food (vertical farms, cultured meat). (Food on all farmland is tech-tree's `yield`.) */
  water?: number
  vfarm?: number
  /** future: fertility (negative: fewer births; the demographic transition), longevity. */
  fert?: number
  life?: number
  /** future: share of tasks it automates, and new tasks it creates (Acemoglu & Restrepo 2018). */
  autom?: number
  newTask?: number
  /** future: AI level it brings (1 narrow, 2 general, 3 superhuman; the people's level is the max held). */
  aiLevel?: number
  /** future: disaster resilience share, relief (transfers against displacement). (Fiscal capacity is tech-tree's `fisc`.) */
  resil?: number
  relief?: number
  /** future: deterrence (1 when it is the deterrent). */
  deter?: number
```
`recompute` (`ideas/hooks.ts`) gets the same loop body for the new fields into a new `FutureEffects` object
(`ix.fut`, created only when `HistoryOptions.future` is on, so the old object shape is untouched). New hooks, each
`O(1)` and RNG-free, called only when `s.future !== null`: `futLandStep(p)`, `futAir(p)`, `futReach(p)`, `futFarm(id)`,
`futFert(p)`, `futLife(p)`, `futFiscal(p)`, `futResil(p)`, `futAutomation(p)`, `futDisplaced(p)`, `futAlign(p)`,
`futDeter(p)` (the era is tech-tree's `ideaEra`).

### 2.4 Context fields added to `IdeaCtx` (computed in `context`, only when future is on)
`energy` (per head, from held ideas, last step), `clean` (clean share), `urban` (share in towns ≥ TOWN_POPULATION),
`hubs` (number of hub settlements), `eq` (1 if the people holds a settlement with |lat| < FUT.eqLat on a coast: elevator
site), `rivals` (number of met peoples at war or in rivalry holding the same AI level), `align`, `aiLevel`.
Example conds (design defaults [A]): `generalAI: ss(1, 4, c.cities) · ss(2, 6, c.energy) · ss(0.4, 0.7, c.urban)`;
`skyVeil: ss(1.5, 3, anthroT) · ss(0, 1, c.tier)` (it is invented only where warming already hurts);
`desalination: ss(0.05, 0.3, c.dry · c.coast)`; `spaceElevator: c.eq`.

### 2.5 Effects on sim quantities

#### 2.5.1 Travel and trade cost by mode
Mode multipliers per people (product over held ideas of `1 / (1 + share · a)`; the land, sea and air divisors are capped
at FUT.maxDiv 20 so a single row cannot make distance vanish):

| mode | applies to | from | cap |
|---|---|---|---|
| land step `L_p` | trade **edge** costs (not the cell search), long-haul land legs, polity reach distance | `motorRoad`, `highSpeedRail`, `maglev`, `robotaxi`, `hyperloop` (and tech-tree's `railway`, `macadam` through infraMul) | ÷ 20 |
| sea `S_p` | the existing `ideaSea` divisor (multiplied) | `container` | existing |
| air `A_p` | hub-to-hub edges (2.5.2) | `aviation`, `jetAirliner`, `eVTOL`, `pointRocket`, `teleport` | — |
| launch `K_p` | off-world founding, growth, emigration (2.5.10) | `reusableRocket`, `spaceElevator` | ÷ 100 |

**Where it is applied (and why not in the cell search).** The migration and trade cell searches stay at today's cell
costs [V migration.ts:343, trade.ts:388]. Dividing per-cell costs by L_p would let each Dijkstra reach L_p² more cells
(perf) and send village founders across continents (wrong: modern migration goes to cities). Instead:
- trade: `edgeCost[e] /= sqrt(L_pa · L_pb)` after `rebuildLinks` builds the edges (pair of the ends' peoples), and air
  edges are added between hubs;
- long-haul legs (`goods/longhaul.ts`): land part ÷ L, sea part ÷ S as today;
- polity: `lambda *= 1 + FUT.reachK · (futReach(p) − 1)`, with `futReach = (1 + Σ reach·a) · sqrt(L_p)` (the telegraph,
  radio and the internet carry orders; roads and rail carry soldiers and tax);
- migration: unchanged cell search plus a **hub migration** draw: each year a settlement of people q in its crowded
  state (food < 1 or pop/sup > FUT.crowd) sends `FUT.hubMig · pop` to the most attractive hub (food ratio · size^0.5 /
  airCost) of its own people or a met people (one draw from `'history-future'` per sending hub-region, at most
  FUT.hubMigMax senders a year, ascending id). Logged as today's Migration events (`EventType.Migration`), so disease and
  ideas pulses see it [V: both scan Migration].

#### 2.5.2 Effective distance and the hub network
Hubs: settlements ≥ CITY_POPULATION of peoples holding a hub idea, the top FUT.hubPerPeople (3) by population, at most
FUT.hubMax (64) in the world (ties by id); rebuilt every `TRADE.linkStep` with the edges. Kind = best held
(`HUB_AIR` aviation, `HUB_ROCKET` pointRocket for pairs > FUT.rocketKm, `HUB_GATE` teleport). Each hub gets a
`StructureType.Airport` (or Spaceport for rocket hubs) built (Built event 4 [V], ignored by the director).
Air edge cost: `c_air(a, b) = FUT.airBase + FUT.airKm · gc(a, b) / sqrt(A_pa · A_pb)` (gc great-circle km; gate edges
cost FUT.gateBase only). eVTOL adds short edges between each hub and towns within FUT.vertiKm (vertiports, a render
hint only: they add no structure).

Consequences (every one through an existing system):
- **Trade**: partners within reach multiply; the gravity rule (size/cost²) concentrates trade on hubs.
- **Empires and city-states**: reach λ grows (2.5.1), so large realms hold together more cheaply; but with trade cheap,
  the economic cost of being small falls. Alesina & Spolaore 1997 [verified-search] (QJE 112(4):1027–1056): the number of
  countries rises with economic openness, because size matters less for market access. Hook: secession and charter
  pressure × `(1 + FUT.asK · open_p)`, `open_p` = share of p's trade volume carried on air or edges discounted by L > 2
  (city-states.md charter pressure, else civil.ts secession chance). Net effect is measured, not assumed (harness, section 6).
- **Epidemics**: hub edges are disease channels with `w = v / (v + FUT.airHalf)` (v the edge's trade volume), every disease
  (not only ship-borne ones), and the beta on them × `FUT.fastBeta` (1.5: arrival inside the incubation period beats
  inspection). Effective distance `d_eff = 1 − ln P_mn` (flux share) predicts arrival times far better than geography
  (Brockmann & Helbing 2013 [verified], Science 342(6164):1337–1342); air networks seed distant outbreaks fast (Tatem,
  Rogers & Hay 2006 [verified], Adv. Parasitol. 62:293–343). `pandemicWatch` and `vaccinesMass` reduce beta on air edges and
  the toll. Harness: epidemic reach (peoples struck per outbreak) rises with hubs; deaths per outbreak fall with medicine.
- **Contact**: two peoples with hubs that trade over an air edge are in contact (`know.contact` set on first air trade;
  the existing FirstContact machinery logs it [V knowledge.ts]).
- UI stat "the world shrinks": population-weighted mean of `d_eff` between the 10 largest towns (each year, history
  side; a Float32 per snapshot).

#### 2.5.3 Carrying capacity and the demographic transition
- Food: the `yield` rows here (greenRevolution, crispr, molecularFab) go through tech-tree's `yield` lever (`ideaFarm`,
  population.ts:112); water: dry coastal settlements (aridity ≥ 0.35, coast) get `farmT *= 1 + water·a`; urban food: a
  town's supply gets `+ vfarm · a · pop ·
  FUT.vfarmPerHead` loads, land-free (vertical farms, cultured meat), only for towns ≥ TOWN_POPULATION.
- **Demographic transition (required, or the run explodes).** Logistic growth `p += g·p(1 − p/sup)` [V population.ts:195]
  becomes `p += g · F_p · p · (1 − p / (sup · D_p))` with `F_p = clamp(1 + Σ fert·a + FUT.urbanFert · (urban_p − 0.3), 0.15, 1)`
  and desired density `D_p = 1 − FUT.dDesire · (1 − F_p)` (people choose fewer children than land allows). With
  `pill` and `welfareState` fully adopted and urban share 0.7: F ≈ 0.45, D ≈ 0.78 [A]. Sub-replacement worlds can shrink
  slowly (D < 1 under a full larder). Lee 2003 [verified-search] (JEP 17(4):167–190): mortality falls first, fertility
  follows; population grows several-fold during the transition and then stabilises or declines. Calibration target, not
  fact: future-on world population peaks at 2–5× its pre-industrial plateau and stops growing within ~400 sim-years of
  `pill` (harness, section 6).
- **Founding damp**: migration's colonise chance × `(1 − FUT.foundDamp · urban_p)` (growth goes to towns, as in real
  urbanisation); arcologies raise town density caps (`sup` × 2 for towns ≥ CITY_POPULATION).
- Longevity (`life`): crowd-disease toll × (1 − life), ruler death hazard × (1 − 0.5·life) (rulers/ module: longer reigns,
  older rulers; chronicle shows gerontocracy), fert × (1 − 0.3·life).

#### 2.5.4 Labour, automation, wages (feeds society-secular-cycles.md)
Task model after Acemoglu & Restrepo 2018 [verified] (AER 108(6):1488–1542): automation displaces labour from tasks,
the creation of new tasks reinstates it, and the labour share depends on the balance. Per polity p (its capital's people):
```
a*_p  = min(FUT.aMax, Σ autom_i · a_i)                 automatable task share at full adoption
a_p  += (a*_p − a_p) · FUT.aRate                         diffusion lag (yearly)
n_p  += Σ newTask_i · a_i · FUT.nRate − FUT.nDecay · n_p   new tasks
ae_p  = a_p / (1 + n_p)                                  effective automation
disp  = max(0, ae_p − ae_p(t−1))                         newly displaced share this year
u_p  ← u_p · (1 − 1/FUT.retrain) + disp · (1 − relief_p) displaced (retraining half-life FUT.retrain = 15 y)
prod_p = 1 + FUT.aGain · ae_p                            output per head gain
```
With society on: SOC's labour share `alpha_p = SOC.alpha · (1 − ae_p)` and wage terms × prod_p; the capital share goes to
the elite income (elite share ε rises: inequality); MMP × `(1 + FUT.uMMP · u_p)`. riots-uprisings' ladder gets
`RevoltCause.Displaced` (17) when u_p is the largest grievance term. Without society: polity unrest += `FUT.uUnrest · u_p`.
`Displacement` (329) when u_p first exceeds `FUT.dispEvent` (0.08) in a polity, at most once per 50 years.
`basicIncome` relief 0.6, `welfareState` 0.3 (combine 1 − Π(1 − r)); each costs `FUT.reliefCost · u_p · revenue` a year
through `finSpend` (finances) or capital wealth (proxy).
The superhuman case (`superAI` aMax 0.95): wages fall toward zero for unrelieved polities while output rises — the
inequality scenario of the literature, flagged speculative (Aghion, Jones & Jones 2019 [verified-search], NBER chapter
c14015, discuss both a Baumol-type slow-down where non-automated tasks bind and singularity cases).

#### 2.5.5 Fiscal capacity
The `fisc` rows (incomeTax, welfareState, digitalState, stewardAI) go through tech-tree's `fisc` lever (finances' `taxMul[p] ×= ideaFisc`;
without finances, folded into `admin` at half weight, as that plan does). Besley & Persson 2011 [verified-search] treat fiscal capacity as a state
investment; here it is a held idea (a simplification, said so in the UI help).

#### 2.5.6 War: power multipliers and deterrence (abstract)
- Power: the `war` lever as today (qualityOf), capped in total at `FUT.warCap` (×3 over the pre-industrial value), so
  battles' Lanchester ratio r does not become 1000:1 [battles.md 3.3 treats tech as quality in r].
- Deterrence: when the war-declaration rule (polity/war.ts) considers attacker A on defender D and both hold
  `deterrence`, the chance × `FUT.deterMul` (0.15) [A]; a war that starts anyway between holders draws, once per war
  year, the escalation hazard `FUT.escalate` (0.004) → a GreatCollapse candidate (2.5.9). Wars against non-holders are
  not damped (stability–instability paradox: Snyder 1965 [verified-search]). The sign of the "nuclear peace" is
  contested (Sagan & Waltz 1995 [verified-search]); the UI help says so.
- No weapon is named. The idea's name in the UI is "the great deterrent", its effect line "major wars between holders
  become rare and terrible".

#### 2.5.7 Climate: anthropogenic warming, resilience, sky veil and termination shock
- Emissions per people a year: `e_p = pop_p · energy_p · (1 − clean_p) · FUT.eScale` (fossil share of energy use).
  Cumulative `C += Σ e_p − removal` (`airCapture`: removal `FUT.dac · a · pop_p` from its holders, at most C).
- Warming: `anthroT = TCRE · C` with TCRE `FUT.tcre`, in sim units calibrated so that a world that industrialises on
  fossil energy for ~250 sim-years reaches ~2 °C [A]. Linear in cumulative emissions, as IPCC AR6 WG1 SPM D.1.1
  [verified]: each 1000 GtCO2 likely causes 0.27–0.63 °C, best estimate 0.45 °C. The ratio between the sim's C and
  GtCO2 is a calibration constant, not a fact.
- Harvest: with disasters on, `anthroT − veil` is added to the global temperature sum in `climateYear` (disasters 3.2),
  so cold margins gain and hot dry regions lose through its own kT/kHot terms; without disasters, a proxy multiplier on
  weather.ts' regional harvest `1 − FUT.kHotProxy · max(0, anthroT − veil) · hot_r`.
- `WarmingMark` (321) at 1.0, 1.5, 2.0, 3.0, 4.0 °C.
- Resilience: disasters' `strikeTown` share × `(1 − min(0.8, Σ resil·a))` (satellites' warning, quakeProof).
- **Sky veil** (`skyVeil`): the strongest holder polity (largest power, ascending id on ties) becomes the sponsor when
  `anthroT ≥ FUT.veilAt`; `veil → min(anthroT − FUT.veilTarget, FUT.veilMax)` at FUT.veilRamp °C/yr. `SkyVeiled` (322).
  **Termination**: if the sponsor ends, loses the idea (collapse), or `renounces` (a draw, FUT.renounce per year while at
  war with a holder or in crisis), and no other holder takes over within FUT.veilGrace (2) years, `veil ← veil · e^(−1/τ)`
  with τ = FUT.veilTau (2 years) [A]. Models agree that global temperature rises rapidly after sudden termination
  (Jones et al. 2013 [verified], JGR-Atmos 118(17):9743–9752, GeoMIP G2); the resulting climate velocity would exceed
  10 km/yr, more than double recent rates (Trisos et al. 2018 [verified], Nat. Ecol. Evol. 2:475–482). Harvest gets an
  extra rate penalty `−FUT.kRate · max(0, dT/dt − FUT.rSafe)` per region. `VeilFailed` (323).

#### 2.5.8 AI level, alignment, the machine crisis
Per people: `aiLevel_p` = max held (0–3). Alignment `align_p ∈ [0, 1]` (a societal variable: how well its institutions
control the machines), yearly:
```
align += FUT.alR · (research_p + FUT.alAdmin · (admin_p − 1)) · (1 − align) − FUT.alRace · rivals_p · align
research_p = a(alignment) + 0.5 · a(stewardAI)
```
`rivals_p` (2.4): met peoples at the same AI level at war or rivalry with p. The race term follows Armstrong, Bostrom &
Shulman 2016 [verified] (more teams and more enmity raise disaster risk; more information about rivals' capabilities can
too). Hazard per 5-year step while aiLevel ≥ 2: `h = FUT.mh[aiLevel] · (1 − align)² · min(1, energy_p / FUT.energyRef)`
(mh = [0, 0, 0.002, 0.01]) [A]. A hit is a `MachineCrisis` (326) with outcome drawn by align:
`Contained` (economic shock: u_p += 0.1, learn −50% for 20 y), `Seized` (the polity's ruler deposed: ReignEnd via the
rulers module's existing Overthrown path if present [V rulers/ ReignEnd 0–8], else a revolt), `Catastrophe` (a GreatCollapse
candidate, 2.5.9), or with align ≥ 0.8 and `stewardAI`: `Steward` (positive: admin +0.3, fisc +0.2 for 100 y).
Probabilities `Catastrophe = 0.3 (1 − align)`, `Seized = 0.3`, rest Contained (Steward replaces Contained when eligible) [A].
These are invented mechanics for a story, not forecasts; the UI help says so.

#### 2.5.9 Existential-scale events: rare, capped, survivable — and the collapse-and-recovery path
Candidates: escalation of a deterrent war (2.5.6), machine catastrophe (2.5.8), termination famine (a VeilFailed whose
5-year world harvest falls below FUT.collapseHarvest), pandemic (an outbreak striking ≥ FUT.pandemicHubs of the hubs within
3 years with toll above FUT.pandemicToll), impact (a natural hazard FUT.impact 1e-5 per year, × 0.1 with
`planetaryDefence`; on in every future-on world). A candidate becomes a `GreatCollapse` (327) only through the **cap**:
- at most `FUT.maxCollapses` (2) per run; at least `FUT.collapseGap` (500) years apart; never before the world's first
  era-9 people; otherwise the candidate is downgraded (a war goes on as a normal war; a machine crisis is Contained; etc.).
Effect: the peoples in contact with the origin lose `share ~ U(FUT.lossMin 0.3, FUT.lossMax 0.6)` (one draw) of every
settlement's people, × 0.5 for peoples with no hub; never the people's largest settlement below FUT.floorPop; never more
than FUT.worldLossMax (0.7) of the world. Hubs, airports and spaceports are lost (StructureLost 7), off-world rows lose
their link for FUT.cutYears (they may become independent, 2.5.10), the veil fails (termination!), and `losses` sees
`pop < collapseShare · peak` [V system.ts losses], so fragile ideas are forgotten with the existing rule (future rows have
`fragile` 0.3–0.8 by tier: complex supply chains are fragile, cf. Tainter 1988 [verified-search: book listings; not
opened] on declining returns to complexity as a cause of collapse — a contested thesis).
**Recovery**: a new learning term in `learnAndConceive` for an idea the people held before (`ever[p·I + i]`, new Uint8):
exposure `E += FUT.recover · (1 + 2·a(longArchive) of the best met holder) · (rateOffWorld)` without a living holder, how =
`IdeaHow.Recovered` (14). Re-learning takes ~1/3 of first discovery (FUT.recover chosen so) [A]. Returning colonists
(OffWorldEnded extra 2) add a pulse. `EraRegained` (328) when a people regains its pre-collapse era.
Result: a world can fall from era 11 to a pre-industrial level and climb back in centuries, with ruins, archives and
colonists as the reasons in the chronicle. Extinction is impossible by construction (floor, world cap).
The literature on existential risk gives subjective century probabilities (Ord 2020 [verified-search: Wikipedia/review
pages]: about 1 in 6 this century); the sim does **not** use such numbers: its hazards are tuned for stories (harness, section 6).

#### 2.5.10 Off-world: decision — off-map rows, no orbital map layer
**Decision**: off-world settlements are rows of a small table (`History.offWorld`), not settlements. Reason: settlements
are cells with per-snapshot arrays, territory, polity membership and rendering; an orbital layer would need a second
grid, new movement rules and territory for no gain in the sim. Rows are cheap (≤ FUT.offMax 32) and the globe draws them
as orbital objects (section 4).
Row: kind (`Station`, `Lunar`, `Mars`, `Habitat`, `Starship`, `Colony` (fiction)), people, polity (at founding), launch
site (a Spaceport structure), founded, ended, `pop` per snapshot, status. Rules (yearly, ascending row):
- founding: a people holding the kind's idea and a Spaceport founds one with chance `FUT.offFound[kind] · K_p` per step
  (one draw), at most FUT.offPerPeople (4);
- growth: logistic to `FUT.offCap[kind]` (Station 50, Lunar 500, Mars 5000, Habitat 20000, sim people) [A] at rate
  `FUT.offG · K_p`, fed by emigration from the launch site's people (`min(FUT.emig · K_p · pop_site, room)`: an emigration
  sink that relieves crowding);
- remittance: `wealth[site] += FUT.remit · pop_row` (trade with orbit; with goods on, as Treasure-value income);
- learning: the row's people get `learn += 0.05` per active Lunar/Mars/Habitat row;
- independence: a Mars or Habitat row with pop > FUT.indepPop and a parent polity in crisis or ended declares
  independence (OffWorldEnded extra 1): it keeps growing, stops remitting, and can "return" after a GreatCollapse
  (extra 2: a Recovered pulse and a Migration of FUT.returnShare of its people to the parent's largest coastal town);
- abandonment: no living launch site of its people for FUT.cutYears and pop below FUT.selfSufficient → ended (extra 0).

### 2.6 Innovation pacing beyond the present
Conception chance for a future row i at people q: tech-tree's rule (its 3.1) times two factors of this plan only:
```
λ(q,i) = λ₀(q,i) · Mc(q,i) · H_q · AI_q          λ₀, Mc: tech-tree-innovation.md 3.1 (pressures, clamps mLo 0.2, mHi 5)
H_q  = 1 / (1 + FUT.hard · nF_q)^FUT.phi          ideas get harder: nF_q = future rows q holds
AI_q = 1 + FUT.aiAccel · (aiLevel_q / 3) · (0.5 + 0.5 · align_q)
```
KIND_BETA rows for the new kinds (conception; columns War / Rival / Labour / Land / Energy / Market / Open / Frag, then the
three registered channels Climate / Displaced / Race) [A], in tech-tree's format:
```
Energy     0.3  0.3  0.5  0    1.5  0.8  0.5  0.2   1.0  0    0
Computing  0.5  0.8  0.8  0    0    1.0  1.0  0.3   0    0    1.0
Life       0    0    0    0.5  0    0.3  1.2  0     0    0    0
Space      0.8  1.2  0    0    0    0.3  0.8  0.5   0    0    0.3
Earth      0    0    0    0.8  0.3  0    0.5  0     1.5  0    0
```
Existing kinds get 0 on the three new channels except Administration (Displaced 1.0) and Health (Climate 0.3). The War
and Rivalry betas on Space and Computing encode the historical pull of state rivalry on rocketry and computing; the size
of that pull is a design default, not a measured fact.
- Semi-endogenous growth (Jones 1995 [verified], JPE 103(4):759–784, doi:10.1086/262002): with diminishing returns to the
  stock of ideas (φ < 1) long-run growth needs a growing research population. Research productivity is falling: today
  more than 18× as many researchers are needed to double chip density as in the early 1970s (Bloom, Jones, Van Reenen &
  Webb 2020 [verified], AER 110(4):1104–1144, doi:10.1257/aer.20180338). `H_q` is that, crudely: the more future ideas a
  people holds, the harder the next. The existing recombination boost `(1 + combo · nHeld)` (Weitzman 1998
  [verified-search], QJE 113(2):331–360) would otherwise make the future explode; for future rows `nHeld` is capped at its
  value when the people first held its first era-8 row (FUT.comboFreeze), and `H_q` takes over.
- Scale: the existing `scale` term (population; Kremer 1993 [verified-search], QJE 108(3):681–716: more people, more
  ideas) is kept, so **the demographic transition slows discovery** — a world whose population shrinks stagnates (Jones
  2022 [verified], AER 112(11):3489–3527: with a declining population, growth in living standards and knowledge can
  stop, the "empty planet" result) unless AI substitutes for researchers.
- AI acceleration `FUT.aiAccel` (default 2, range 0–10) is **speculative**: Aghion, Jones & Jones 2019 [verified-search]
  show that automating idea production can in some parameterisations give explosive growth and in others be held back by
  tasks that resist automation; Davidson 2021 [verified] puts > 10% on explosive growth this century, conditional on
  advanced AI. The UI's world settings show it as "AI speeds research (speculative)", with 0 a valid choice.
- Stagnation is a real outcome: low fertility, no AI, and H give long plateaus. The harness reports the share of worlds
  with no new future idea for ≥ 500 years after reaching era 10.
- **When the tree is exhausted** (a people holds every enabled row): (1) **mastery**: its technology caps creep by
  `FUT.mastery / (1 + years since exhaustion / FUT.masteryHalf)` a year (log-like, never stops, tiny); (2) history goes on
  in politics, faith, language, collapse-and-recovery and off-world independence, which are open-ended; (3) Fiction tier if
  on. No row is repeatable (the held/since model would break).

### 2.7 Contract additions (`src/contract.ts`, codebase style)
```ts
// future: technology after the industrial age (HistoryOptions.future).
/** How plausible an idea is (IdeaInfo.tier): in use by the 2020s; near-future plausible; speculative (known physics, unproven engineering); fiction (unknown physics). */
export const IdeaTier = { Historical: 0, Near: 1, Speculative: 2, Fiction: 3 } as const
export type IdeaTier = (typeof IdeaTier)[keyof typeof IdeaTier]
export const OffWorldKind = { Station: 0, Lunar: 1, Mars: 2, Habitat: 3, Starship: 4, Colony: 5 } as const
export type OffWorldKind = (typeof OffWorldKind)[keyof typeof OffWorldKind]
/** Why a great collapse came (the `extra` of EventType.GreatCollapse). */
export const CollapseCause = { War: 0, Machine: 1, Sickness: 2, Climate: 3, Impact: 4 } as const
export type CollapseCause = (typeof CollapseCause)[keyof typeof CollapseCause]
export const MachineOutcome = { Contained: 0, Seized: 1, Catastrophe: 2, Steward: 3 } as const
export type MachineOutcome = (typeof MachineOutcome)[keyof typeof MachineOutcome]
export const VeilEnd = { SponsorFell: 0, Forgotten: 1, Renounced: 2 } as const
export type VeilEnd = (typeof VeilEnd)[keyof typeof VeilEnd]

// IdeaInfo:
  /** future: how plausible it is (IdeaTier; Historical for every idea before the future rows). */
  tier: IdeaTier

/** Off-world settlements (stations, bases, colonies), struct-of-arrays in founding order. */
export interface OffWorld {
  count: number
  kind: Uint8Array
  people: Int16Array
  polity: Int32Array
  /** Launch site (a settlement with a Spaceport). */
  site: Int32Array
  founded: Int16Array
  /** Year it ended (-1 if it lasts); how (OffWorldEnded extra), 255 while it lasts. */
  ended: Int16Array
  how: Uint8Array
  /** Year it declared independence (-1). */
  independent: Int16Array
  /** People per snapshot: pop[s * count + row]. */
  pop: Float32Array
}

/** The future's world series and per-people state. */
export interface FutureSeries {
  /** Per year: anthropogenic warming and the veil's offset (°C), cumulative emissions (sim units), mean effective distance of the 10 largest towns. */
  anthroT: Float32Array
  veil: Float32Array
  carbon: Float32Array
  effDist: Float32Array
  /** Per snapshot per people: automation ae (×255), displaced u (×255), alignment (×255), electrified share (×255, for night lights). */
  autom: Uint8Array
  displaced: Uint8Array
  align: Uint8Array
  light: Uint8Array
  /** Hub-to-hub edges, struct-of-arrays: ends (settlements), kind (HUB_*), first and last year in use. */
  hubA: Int32Array; hubB: Int32Array; hubKind: Uint8Array; hubFrom: Int16Array; hubTo: Int16Array
}

// History:
  /** future: (empty / zero-length when HistoryOptions.future is false) */
  offWorld: OffWorld
  future: FutureSeries

// HistoryOptions:
  /**
   * future: technology after the industrial age (electrification, computing, automation and AI, biotech, new energy, space,
   * fast transit, climate engineering), conceived and spread like every other idea, with honest plausibility tiers. Default
   * false (true for new worlds once the harness passes, step 14); false gives the history without them, bit-identical.
   */
  future?: boolean
  /** (future requires techTree: without it the option is ignored.) */
  /** future: also allow the Fiction tier (teleportation, faster-than-light travel). Default false. Ignored without future. */
  futureFiction?: boolean
  /** future: how much AI speeds research, 0..10 (speculative). Default 2. */
  futureAI?: number

// The era of a people at a year is tech-tree's `eraAt(h, p, year)` (8–14 for this plan's eras); ERA_LABELS gains
// 'Electrification', 'Computing and the atom', 'The networked present', 'The near future', 'The speculative future',
// 'The far future', 'Fiction'.
```

### 2.8 Params (`src/sim/history/future/params.ts`, `export const FUT`; one doc comment per line in the codebase style; all [A] design defaults unless a citation is given in 2.5)
| name | default | meaning |
|---|---|---|
| enabled / fiction / aiAccel | false / false / 2 | option defaults |
| maxDiv | 20 | cap on land/sea/air divisors |
| reachK | 0.5 | λ multiplier strength |
| hubPerPeople, hubMax | 3, 64 | hub caps |
| airBase, airKm, rocketKm, gateBase, vertiKm | 2, 0.002, 5000, 0.2, 150 | air edge costs (sim cost units; calibrated so a jet hub pair across a continent costs ~ a short sea leg) |
| airHalf, fastBeta | 40, 1.5 | disease on air edges |
| asK | 0.5 | Alesina–Spolaore openness term |
| hubMig, hubMigMax, crowd | 0.002, 16, 0.9 | hub migration |
| vfarmPerHead | 0.2 | urban food per head at full vfarm |
| urbanFert, dDesire | 0.6, 0.5 | demographic transition |
| foundDamp | 0.7 | founding damp at full urbanisation |
| aMax, aRate, nRate, nDecay, retrain, aGain | 0.9, 0.03, 0.02, 0.01, 15, 1.0 | automation |
| uMMP, uUnrest, dispEvent, reliefCost | 2, 0.5, 0.08, 0.3 | displacement |
| warCap, deterMul, escalate | 3, 0.15, 0.004 | war |
| eScale, tcre, dac | calibrated (step 9) | carbon |
| kHotProxy, kRate, rSafe | 0.05, 0.3, 0.05 | harvest proxies |
| veilAt, veilTarget, veilMax, veilRamp, veilGrace, veilTau, renounce | 1.5, 1.0, 3, 0.1, 2, 2, 0.01 | sky veil |
| alR, alAdmin, alRace, mh | 0.02, 0.5, 0.01, [0,0,0.002,0.01] | alignment and machine crisis |
| maxCollapses, collapseGap, lossMin, lossMax, worldLossMax, floorPop, cutYears | 2, 500, 0.3, 0.6, 0.7, 500, 30 | collapse cap |
| collapseHarvest, pandemicHubs, pandemicToll, impact | 0.6, 0.5, 0.1, 1e-5 | candidates |
| recover | 0.5 | Recovered channel strength |
| offMax, offPerPeople, offFound, offCap, offG, emig, remit, indepPop, selfSufficient, returnShare | 32, 4, [0.02, 0.01, 0.005, 0.003, 0.002, 0.01], [50, 500, 5000, 20000, 2000, 50000], 0.03, 1e-4, 0.5, 2000, 1000, 0.3 | off-world |
| hard, phi, comboFreeze | 0.15, 1.0, true | difficulty |
| mastery, masteryHalf | 0.001, 500 | exhausted tree |
| eqLat | 5° | elevator site latitude |
| energyRef | 4 | energy per head of a fully electrified people |

### 2.9 Step order and determinism
**Place in the year** (history/index.ts `step`): `ideasYear` (future rows conceived/learned there; `recompute` fills
`ix.fut`) → technology → … → **`futureYear(s, fs)`** after `disasterYear` / weather and before population's food system of
the next year: (1) automation and displacement per polity (ascending `ps.alive`), (2) alignment and machine-crisis draws
(people ascending, only in `year % IDEA.step === 0`), (3) emissions, carbon, warming, veil and termination, (4) hubs every
`TRADE.linkStep` (inside `rebuildLinks`, after edges), hub migration draws (sending regions ascending), (5) off-world rows
(ascending), (6) collapse candidates collected during the year and resolved here, in candidate order (War, Machine,
Sickness, Climate, Impact), at most one per year, (7) snapshot rows.
**Streams**: `'history-ideas-future'` (conception/adoption draws of this plan's rows, inside ideasYear, idea order),
`'history-future'` (everything in futureYear: crisis outcome, veil renounce, hub migration, off-world founding, collapse
share, impact). Fixed counts where possible: the impact hazard draws once a year from the first era-9 year on (whether or
not it fires); the crisis draws once per eligible people per step; founding once per eligible (people, kind) per step.
**Off switch**: `HistoryOptions.future` false (default until step 14) → `s.future = null`, the catalogue mask excludes the
rows, `CH` stays at tech-tree's value only if no plan needs 16 (CH is internal; the History hash does not see it), every
hook is guarded `s.future !== null ? new : old` with the old expression byte-for-byte. **Bit-identical** History (goldens of
perf-efficiency.md and tech-tree's). With `future` on but no row yet eligible (every default 2000-year run and every run
before the first era-8 prerequisites), no future draw happens and no hook changes a value (every lever is 1 until a row is
held): the History equals the future-off one except the new empty tables (golden test with a filter on `offWorld`,
`future`, events 320–329). `futureFiction` off: Fiction rows are skipped **before any draw** (as missing prerequisites are),
so worlds with and without it are identical until a Fiction row's prerequisites are first held.
**Float**: all accumulators Float64; `exp`/`log` only in H, AI, the veil decay; clamps before comparisons; no Map/Set
iteration; hub sets sorted by (pop desc, id asc).

---

## 3. UI

### 3.1 Tiers, labelled honestly (`ui/ideasData.ts`, `ui/ideasTree.ts` from tech-tree 10.1)
- Every future idea card shows a tier chip in words: **"In use today"**, **"Plausible soon"**, **"Speculative"**, **"Fiction"**,
  with a one-line meaning on hover/tap ("Speculative: consistent with known physics; nobody has built it at scale").
  Colour is secondary (chip outline style differs too, for colour-blind users).
- The tree graph (tech-tree 10.1) extends to era columns 8–14; Fiction columns are drawn only when the world has
  `futureFiction`, else a greyed note "Fiction tier off for this world".
- Contested labels carry a "contested" tag in the card (`generalAI`, `fusion`, `quantumComputer`, `molecularFab`,
  `deterrence`'s effect line).
- The idea detail's "history" line is the sourced sentence; for Speculative/Fiction rows it starts "Imagined:" or "Proposed:".
- World settings (landing.ts): "Future technology" (on/off), "Allow fiction (teleportation, faster-than-light)" (off),
  "AI speeds research (speculative)" slider 0–10 (2). URL `future=`, `fiction=`, `ai=`.
### 3.2 Future section of the Ideas panel (hidden without data; no new panel, see 0.3b)
World strip: warming and veil series sparkline (°C), the "world shrinks" effective-distance curve, off-world population,
collapses marked. Per people: era, automation and displaced share, alignment, energy mix (clean share). Off-world list with
status. Polity panel (society block): "work done by machines" and "displaced" lines.
### 3.3 Chronicle (hedged, plain; `ui/futureFormat.ts describeFutureEvent`; category 'discovery'/'nature'/'politics')
Era-appropriate register: from era 8 the hedged chronicle reads like a records office ("records suggest", "figures from the
time indicate"); from era 10 like a data desk ("by most counts", "estimates put"). Examples:
- 320: "By the records, the Velani were the first to run their towns on electric power (y. 3120)."
- 321: "Measured warming passed 1.5 °C; the largest share of the carbon came from the Orrish towns, by most estimates."
- 322: "Kesh began veiling the sky to hold back the heat, taking off about 0.8 °C."
- 323: "The veil failed after Kesh fell; temperatures rose by an estimated 0.3 °C a year for five years."
- 324: "A station was put into orbit from Tamar's launch site."
- 325: "The Mars settlement of the Velani declared itself independent, according to the last messages received."
- 326 (Contained): "A failure of the thinking machines in Ardun halted its industry for years; the details are disputed."
- 327: "A great collapse (war): records suggest about four in ten people died, and much knowledge was lost."
- 328: "The Orrish regained the knowledge of the networked age, 240 years after the collapse."
- 329: "In Lisk, perhaps one worker in ten had lost their trade to machines."
### 3.4 Sagas, both registers (`ui/sagas/future.ts`, phrase table `FUT_T` as `[chronicle variants, legend variants]`)
The Legend register keeps its heightened voice but changes its imagery by era (keys suffixed by era band:
`.ind` 8–9, `.net` 10–11, `.far` 12–14): industrial legend speaks of "lightning in wires" and "iron birds"; networked legend of
"the speaking glass" and "minds of light"; far legend of "the sky-roads" and "the silent stewards". The Chronicle register
stays plain. Keys and examples (Chronicle / Legend):
- `era.first.ind`: "{people} were the first to light their towns by electricity." / "In {city} they caught lightning in copper and made the night their day."
- `era.first.net`: "{people} first joined their towns into one network." / "And the cities of {people} spoke to one another through the air, and none was alone."
- `warming`: "The climate warmed by about {dT} °C." / "The world grew feverish, and the old harvests failed in the south."
- `veil.on`: "{state} began to dim the sunlight to cool the world." / "{state} drew a veil across the sun, and the world cooled under its shadow."
- `veil.fail`: "When {state} fell, the cooling stopped and the heat returned within a few years." / "The veil tore when {state} fell, and the sun came back in fury."
- `offworld.found`: "{people} founded a settlement on {kind}." / "From {city} the fire-towers climbed, and {people} set their feet on {kind}."
- `machine.crisis`: "Automated systems in {state} failed, with lasting harm." / "The thinking engines of {state} turned from their makers."
- `machine.steward`: "{state} handed much of its administration to well-controlled machines, and it prospered." / "In {state} the stewards of light kept the law, and none went hungry."
- `collapse`: "Around {year}, a collapse ({cause}) killed about {share} of the people." / "Then came the Unmaking, and of every ten, {n} were lost."
- `recover`: "Using old records, {people} relearned {idea}." / "From the vaults of the ancients, {people} won back {idea}."
- `displaced`: "Machines took over much of the work in {state}." / "In {state} the hands fell idle, for the engines did the labour."
- Partisan (experience 3.x): `collapse.us` / `.foe` variants ("our ruin" / "the doom they brought on themselves") with the
  same facts. No register invents an event; Fiction-tier events say "in this telling" once per saga (honesty marker).
Tests: every key filled in both registers for every band; no `{` left; deterministic per seed.

---

## 4. Rendering hooks (needs for city-renderer-eras.md and the globe)
Data the renderers read (no sim import): `eraAt(h, p, year)` (tech-tree), `heldAt`/`intensityAt` per key (tech-tree), the
new StructureTypes (6–11) with built/lost years, `History.future` series, `History.offWorld`.
### 4.1 City view, per era (triggering key → what to draw; intensity scales density where noted)
| era | townscape |
|---|---|
| 8 | electric street lighting in every street and lit windows (`electrification`, × intensity); petrol stations, asphalt roads with lorries (`motorRoad`); airfield with hangars at hubs (`aviation`, Airport structure); hospital blocks (`antibiotics`) |
| 9 | concrete towers and the first high-rises (towns ≥ CITY_POPULATION, × `ideaIndustrial`); power station by type from the energy mix (PowerStation: cooling towers for `fission`); container cranes at ports (`container`); jet runways and terminals (`jetAirliner`); elevated high-speed lines and viaducts (`highSpeedRail`); TV masts (`computer`/`radio`); launch pad and gantry at a Spaceport (`rocketry`) |
| 10 | glass skyscraper clusters; solar fields and wind turbines in the countryside (`solarWind` × clean share); data-centre blocks (`internet`); maglev guideways (`maglev`); driverless traffic (no drivers' cabs; `robotaxi`); desalination plants on dry coasts (Desalination structure); stacked greenhouse towers (`verticalFarm`); booster landing pads (`reusableRocket`) |
| 11 | vertiports on rooftops and **flying traffic lanes** between them (`eVTOL`, short hub edges); fusion plant (PowerStation, `fusion`); seawalls on coasts when anthroT ≥ 1.5 °C (render-only: no sim sea rise); air-capture units (`airCapture`) |
| 12 | **arcologies** (Arcology structure: single mega-structure replacing a block of town); hyperloop tubes on pylons between hubs (`hyperloop`); suborbital rocket port with plume trails (`pointRocket`, Spaceport); **space elevator** tether rising from an equatorial SkyTether anchor (`spaceElevator`); ocean-platform districts (`oceanCity`) |
| 13 | orbital-solar receiver arrays (rectennas, `orbitalSolar`); weather-control towers (`weatherControl`) |
| 14 (fiction) | gate rings at hubs (`teleport`, Gate hub kind); shimmering defensive domes (`forceField`) |
| any | collapse: ruined towers, dark grids, overgrown runways for `cutYears` after a GreatCollapse (structures lost; the renderer shows lost Airports/Spaceports as ruins for 100 y); sky haze tinted by `veil`; smog by (1 − clean share) × energy |
### 4.2 Globe
- **Night lights**: the existing per-cell light intensity [V globe.ts:92] × `History.future.light` (electrified share) of
  the cell's people, so the night side brightens from era 8 and darkens after collapse.
- **Air routes**: great-circle arcs between hub pairs from `hubA/hubB/hubFrom/hubTo` (drawn like long-haul legs; only those
  in use at the shown year, as perf-efficiency P4 asks).
- **Orbital layer (visual only)**: a thin ring of moving points per Station/Habitat row (count ∝ rows, not pop), a Moon
  marker for Lunar rows, a "Mars" label chip in the corner for Mars rows (off-map); the elevator tether as a line from the
  anchor cell up past the ring.
- **Rocket trails**: short animated trails from Spaceports, only while playing, honouring `prefers-reduced-motion` and the
  battery-saver preset (perf-efficiency P1–P3).
- **Veil haze**: atmosphere tint (sky.ts) by `veil`; **warming**: snow line raised by anthroT (palette.ts snowFactor gets an
  offset) — optional, cheap (a uniform).
- **Collapse**: lights out, routes gone, ring thins (rows ended).

---

## 5. Ordered commit-sized steps (each `npm test` + `npm run typecheck` green; goldens unchanged until step 14)
1. **Contract and plumbing**: enums (2.7, 0.2), EventTypes 320–329 with doc comments, `IdeaHow.Recovered` (CH 16; idea ids
   already Uint16 from tech-tree step 1), `HistoryOptions.future/futureFiction/futureAI` (default false), catalogue mask
   memo (0.3.3), empty History tables. Tests: goldens identical; `ideaIndex` resolves all keys; PRE topological incl. `preAny`.
2. **Catalogue rows** (2.2) with `tier`, `preAny`, `press`, levers; `'history-ideas-future'` stream; KIND_BETA rows; three
   registered channels (values 0 until step 4/6/8 fill them). Tests: with future on and years 2000, History equals off
   except filtered tables (2.9); Fiction rows never considered with futureFiction off (spy on the stream).
3. **Levers wired**: `ix.fut` in recompute; land-step on trade edges, longhaul land legs, polity λ; water, urban food;
   resil into disasters (null-guarded). Tests: spy test that each reader is called; neutral (all levers 1) bit-identical.
4. **Demographic transition and founding damp** (2.5.3). Tests: synthetic people with `pill` at a = 1 → growth falls to
   F·g; equilibrium sup·D; founding chance × (1 − damp·urban).
5. **Hub network** (2.5.2): hubs, Airport/Spaceport structures, air edges in `rebuildLinks`, disease channel, contact on
   air trade, hub migration, effective-distance series. Tests: caps (≤ 3 per people, ≤ 64); edges rebuilt only on link
   steps; disease reaches via an air edge in a two-hub fixture; deterministic order.
6. **Automation and displacement** (2.5.4) with society/finances/riots hooks and proxies; Displacement 329; RevoltCause 17.
   Tests: u rises on a jump in a*, decays with retrain half-life; relief reduces it; MMP term only with society.
7. **War terms** (2.5.6): warCap, deterrence on declaration, escalation candidate. Tests: two holders → declaration chance
   × deterMul exactly; holder vs non-holder unchanged; no change without the idea (bit-identical).
8. **AI level, alignment, machine crisis** (2.5.8) on `'history-future'`. Tests: align bounds; race term lowers align with
   rivals; outcome distribution by align in a 10⁴-draw unit test.
9. **Carbon, warming, veil, termination** (2.5.7): calibrate `eScale`/`tcre` (≈ 2 °C after 250 y of fossil
   industrialisation on seed 42), disasters hook + proxy. Tests: zero emissions → anthroT flat; termination decays veil with
   τ; VeilFailed logged once.
10. **Off-world table** (2.5.10). Tests: caps; emigration conserves people (site loses what the row gains); independence
    only under its conditions; table of a shorter run is a prefix of a longer one.
11. **Collapse and recovery** (2.5.9): candidates, cap, loss, Recovered channel, EraRegained. Tests: never > 2 per run, ≥ 500 y
    apart; floor respected; no people extinct by collapse; Recovered re-learning faster than first learning in a fixture.
12. **Pacing** (2.6): H, AI factor, comboFreeze, mastery tail. Tests: H monotone; aiAccel 0 → AI ≡ 1; mastery bounded.
13. **UI and prose** (3, 4): futureFormat (director registrations 320–329), the Ideas-panel Future section, FUT_T, tier chips, settings; render
    hooks (night lights, air arcs, orbital ring, structures) or hand-off to city-renderer-eras.md.
14. **Harness pass and defaults** (owner decision): harness 6 targets met on 4 + 22 seeds; flip `future` on for new worlds
    (techTree must be on); regenerate goldens; README build-order row (after tech-tree, before seat-mode follow-ups).

---

## 6. Stats harness (`src/sim/history/future/futureStats.ts [--off] [--fiction] [--ai N] [--json] [--years 6000] seeds...`; seeds 1, 7, 42, 1234, plus the 22-seed realism set)
| metric | baseline [M] (future off) | target (future on, 6000 y) |
|---|---|---|
| fraction of worlds whose leader reaches era 8 / 9 / 10 / 11 / 12 / 13 | 0 (tree ends at era 7) | ~0.9 / 0.8 / 0.65 / 0.45 / 0.25 / 0.1 (of 22) [A: spread, not a forecast] |
| first era-10 year (leader) | — | spread ≥ 800 y across seeds (divergence persists); not always the most populous people (≤ 15 of 22) |
| leader/median tech at first era-10 + 200 y | — | 1.2–2.0, then converging |
| last first-conception year | 2500–3180 (seeds 7, 42); 5720 on seed 1 (one late origin) | ≥ 5000 on ≥ 3 of 4 seeds (the tree lasts) |
| share of worlds with a ≥ 500-y stagnation after era 10 | — | 0.1–0.4 (stagnation possible, not universal) |
| world population peak / pre-industrial plateau | — | 2–5×; growth ≤ 1.5 %/yr in every century; not rising 400 y after `pill` |
| settlements alive at 6000 (on / off) | measure | ≤ 1.3× |
| GreatCollapse per run | 0 | mean 0.3–0.8; ≤ 2 always; ≥ 1 world of 22 with a collapse and an EraRegained within 600 y |
| extinct worlds | 0 | 0 (hard) |
| anthroT peak | 0 | 1–4 °C in ≥ 80% of era-10 worlds; ≥ 1 world of 22 with a VeilFailed |
| epidemic reach (peoples struck per outbreak) after hubs vs before | measure | ≥ 1.5×; deaths per outbreak lower after `vaccinesMass`/`pandemicWatch` |
| effective distance (10 largest towns) | measure | falls ≥ 3× from era 7 to era 10 |
| polity count / mean polity size after era 10 | measure | report (Alesina–Spolaore direction: more, smaller states with high openness — not enforced) |
| automation: Displacement events per era-11 world | — | 1–5; with society, real wage of relieved polities ≥ unrelieved |
| MachineCrisis per world with superAI | — | ≤ 3; Catastrophe share falls with align (rank corr ≤ −0.3) |
| off-world rows / independent | 0 | 2–20 / ≥ 1 in 22 worlds |
| run time 6000 y, on / off | 51–173 s (contended VM) | ≤ 1.3× |
Realism scorecard (realism-metrics.md) off vs on at 2000 years: identical (no future row eligible) [checked by the 2.9 test].

---

## 7. Performance and memory [A, estimated from the code paths; tech-tree's measurements as base]
- Ideas loop O(P²·I): I 107 → ~178 (+66%): tech-tree's ~2.4 s per 6000 y becomes ~4 s (~6% of a run). Future rows are
  skipped cheaply until prerequisites are held (the PRE check is first [V system.ts]).
- Channels O(P²·CH): CH 16 vs 15, +7%.
- Hubs: ≤ 64 nodes, ≤ 2016 air edges per link step added to partnerSearch's graph (edges today: thousands [A]); disease
  over air edges per year: O(edges).
- futureYear: O(polities + P + rows + living) for snapshots; carbon/veil O(1).
- The dominant risk is indirect: more people and settlements (foodSystem 11% of the profile, siteSearch 7% [perf M]).
  Mitigations: demographic transition, founding damp, hub migration (no long cell searches). Target ≤ 1.3× run time.
- Memory: History.future per-year series 4 × 6001 × 4 B ≈ 96 KB; per-snapshot per-people 4 × 1201 × P(≤ 11) B ≈ 53 KB;
  hubs ≤ ~2 000 rows × 13 B; offWorld pop 1201 × 32 × 4 B ≈ 154 KB; `ever` P·I B. Negligible next to 35–40 MB.
- Worker transfer list gains the new typed arrays; cache size +~0.3 MB raw.

---

## 8. Risks and open questions
1. **Owner: tier of `generalAI`.** Tagged Speculative (contested); many forecasters would say Near. Tier changes labels only,
   not mechanics. Same for `fusion` (Near, contested).
2. **Scale mismatch.** P is 6–11 peoples and world population ~1–1.5 M sim people at 6000 y [M]; "a global network", "a
   Mars colony of 5000" are scaled abstractions. The UI must not show real-world numbers next to sim numbers.
3. **Population explosion** if the transition is too weak (2.5.3) — the largest perf and realism risk; step 4 lands before
   any yield row is enabled in tests.
4. **Collapse tuning is taste.** Too rare: no drama; too common: worlds feel doomed. The cap makes the worst case bounded;
   the harness targets are design choices.
5. **Deterrence realism is contested** (Sagan & Waltz); the mechanic is a story device with a stated source of the debate.
6. **Machine-crisis and steward outcomes are invented.** They must stay labelled speculative in UI and help text.
7. **Migration's long-distance realism**: hub migration is the only long-range channel; refugee flows after collapse use the
   existing flight rules.
8. **Uint16 widening** is tech-tree's step 1; this plan's step 1 must not land before it.
9. **modern-ideologies-regimes.md unknown**: if it adds its own technocracy/AI-governance mechanics, the steward outcome
   should move there; IdeaKind numbering may shift.
10. **infrastructure.md**: hub ownership (0.3.10) must be settled between the two plans.
11. **No sea-level rise** in the sim (cells are fixed); seawalls are render-only. Open: a coastal flood hazard multiplier via
    disasters' Flood rows (∝ anthroT) is a cheap later addition.
12. **Seed 1's late origin at 5720** [M] shows independent re-conception late in long runs; with future rows the
    "last first-conception" metric must exclude Recovered and independent origins of old ideas.

---

## 9. Verified / measured / assumed summary
- [V] ideas system structure, draw order, lever readers, Uint8 idea ids at 8cabf09, logistic growth site, polity λ, trade edges,
  disease channels, StructureType values, EventType blocks, registry values (files and lines in sections 1 and 2).
- [M] 6000-year exhaustion table (1.2): my probe for seed 1 (`/home/claude/scratch-futuretech/probe/probe-long.ts`, output
  `probe/long2.out`) and tech-tree's `b6000-7/42.json`; ideas cost ~1 s per 6000-year run (tech-tree's probe).
- [A] every FUT constant, tier assignment where marked contested, all harness targets, KIND_BETA rows for new kinds, era
  labels, phrase tables.
- Literature/facts: tags inline; [verified] = page opened, [verified-search] = title/venue/identifier confirmed by a search
  listing only, [unverified] = not checked (mostly common historical dates in 2.2's grounding column, which the build agent
  must verify before writing them into `history` strings).

---

## References
- Acemoglu, D. & Restrepo, P. (2018). The Race between Man and Machine: Implications of Technology for Growth, Factor Shares, and Employment. *American Economic Review* 108(6):1488–1542. https://doi.org/10.1257/aer.20160696 [verified-search]
- Aghion, P., Jones, B. F. & Jones, C. I. (2019). Artificial Intelligence and Economic Growth. In *The Economics of Artificial Intelligence: An Agenda*, NBER/U. Chicago Press. https://www.nber.org/chapters/c14015 (working paper w23928) [verified-search]
- Alesina, A. & Spolaore, E. (1997). On the Number and Size of Nations. *Quarterly Journal of Economics* 112(4):1027–1056. https://econpapers.repec.org/RePEc:oup:qjecon:v:112:y:1997:i:4:p:1027-1056. [verified-search]
- Armstrong, S., Bostrom, N. & Shulman, C. (2016). Racing to the precipice: a model of artificial intelligence development. *AI & Society* 31(2):201–206. https://stafforini.com/works/armstrong-2016-racing-precipice-model/ [verified] (DOI not shown on the page opened)
- Besley, T. & Persson, T. (2011). *Pillars of Prosperity: The Political Economics of Development Clusters*. Princeton University Press. https://press.princeton.edu/node/19589 [verified-search]
- Bloom, N., Jones, C. I., Van Reenen, J. & Webb, M. (2020). Are Ideas Getting Harder to Find? *American Economic Review* 110(4):1104–1144. https://doi.org/10.1257/aer.20180338 [verified]
- Brockmann, D. & Helbing, D. (2013). The Hidden Geometry of Complex, Network-Driven Contagion Phenomena. *Science* 342(6164):1337–1342. https://doi.org/10.1126/science.1245200 [verified]
- Comin, D. & Hobijn, B. (2010). An Exploration of Technology Diffusion. *American Economic Review* 100(5):2031–2059. https://doi.org/10.1257/aer.100.5.2031 [verified]
- Davidson, T. (2021). Could Advanced AI Drive Explosive Economic Growth? Open Philanthropy (now Coefficient Giving). https://coefficientgiving.org/research/could-advanced-ai-drive-explosive-economic-growth/ [verified]
- Griliches, Z. (1957). Hybrid Corn: An Exploration in the Economics of Technological Change. *Econometrica* 25(4):501–522. https://www.econometricsociety.org/publications/econometrica/1957/10/01/hybrid-corn-exploration-economics-technological-change [verified-search]
- IPCC (2021). Summary for Policymakers, paragraph D.1.1. In *Climate Change 2021: The Physical Science Basis* (AR6 WG1). https://www.ipcc.ch/report/ar6/wg1/chapter/summary-for-policymakers/ [verified]
- Jinek, M., Chylinski, K., Fonfara, I., Hauer, M., Doudna, J. A. & Charpentier, E. (2012). A Programmable Dual-RNA–Guided DNA Endonuclease in Adaptive Bacterial Immunity. *Science* 337(6096):816–821. https://doi.org/10.1126/science.1225829 [verified-search]
- Jones, A. et al. (2013). The impact of abrupt suspension of solar radiation management (termination effect) in experiment G2 of the Geoengineering Model Intercomparison Project (GeoMIP). *J. Geophys. Res. Atmos.* 118(17):9743–9752. https://doi.org/10.1002/jgrd.50762 [verified]
- Jones, C. I. (1995). R&D-Based Models of Economic Growth. *Journal of Political Economy* 103(4):759–784. https://doi.org/10.1086/262002 [verified-search]
- Jones, C. I. (2022). The End of Economic Growth? Unintended Consequences of a Declining Population. *American Economic Review* 112(11):3489–3527. https://doi.org/10.1257/aer.20201605 [verified-search]
- Kremer, M. (1993). Population Growth and Technological Change: One Million B.C. to 1990. *Quarterly Journal of Economics* 108(3):681–716. https://ideas.repec.org/a/oup/qjecon/v108y1993i3p681-716..html [verified-search]
- Lee, R. (2003). The Demographic Transition: Three Centuries of Fundamental Change. *Journal of Economic Perspectives* 17(4):167–190. https://ideas.repec.org/a/aea/jecper/v17y2003i4p167-190.html [verified-search]
- Ord, T. (2020). *The Precipice: Existential Risk and the Future of Humanity*. Bloomsbury/Hachette. https://en.wikipedia.org/wiki/The_Precipice:_Existential_Risk_and_the_Future_of_Humanity [verified-search] (1-in-6 figure from secondary pages; book not opened)
- Sagan, S. D. & Waltz, K. N. (1995). *The Spread of Nuclear Weapons: A Debate*. W. W. Norton. https://cisac.fsi.stanford.edu/node/26995 [verified-search]
- Smith, W. & Wagner, G. (2018). Stratospheric aerosol injection tactics and costs in the first 15 years of deployment. *Environmental Research Letters* 13:124001. https://ui.adsabs.harvard.edu/abs/2018ERL....13l4001S [verified-search]
- Snyder, G. H. (1965). The Balance of Power and the Balance of Terror. In P. Seabury (ed.), *The Balance of Power*, Chandler. https://en.wikipedia.org/wiki/Stability%E2%80%93instability_paradox [unverified: only encyclopedia entries seen; original chapter not opened]
- Tainter, J. A. (1988). *The Collapse of Complex Societies*. Cambridge University Press. https://en.wikipedia.org/wiki/Joseph_Tainter [verified-search] (thesis contested; book not opened)
- Tatem, A. J., Rogers, D. J. & Hay, S. I. (2006). Global Transport Networks and Infectious Disease Spread. *Advances in Parasitology* 62:293–343. https://doi.org/10.1016/S0065-308X(05)62009-X [verified]
- Trisos, C. H., Amatulli, G., Gurevitch, J., Robock, A., Xia, L. & Zambri, B. (2018). Potentially dangerous consequences for biodiversity of solar geoengineering implementation and termination. *Nature Ecology & Evolution* 2:475–482. https://doi.org/10.1038/s41559-017-0431-0 [verified]
- Weitzman, M. L. (1998). Recombinant Growth. *Quarterly Journal of Economics* 113(2):331–360. https://ideas.repec.org/a/oup/qjecon/v113y1998i2p331-360..html [verified-search]
- Facts used for tiers (news/agency pages, search listings): NIF ignition 5 Dec 2022, 3.15 MJ from 2.05 MJ (https://www.energy.gov/articles/doe-national-laboratory-makes-history-achieving-fusion-ignition) [verified-search]; FDA approval of Casgevy, 8 Dec 2023 (https://www.statnews.com/2023/12/08/fda-approves-casgevy-crispr-based-medicine-for-treatment-of-sickle-cell-disease/) [verified-search]; Hyperloop One shutdown, Dec 2023 (https://fortune.com/2023/12/21/hyperloop-one-shut-down-richard-branson-dp-world-transportation/) [verified-search]; Caltech SSPD-1 wireless power transfer in space, 2023 (https://www.caltech.edu/about/news/space-solar-power-project-ends-first-in-space-mission-with-successes-and-lessons) [verified-search]; Climeworks Orca, Sept 2021, 4000 t/yr (https://climeworks.com/news/climeworks-launches-orca) [verified-search]; Singapore approval of cultivated chicken, Dec 2020 (https://www.cnbc.com/2020/12/01/singapore-issues-first-regulatory-approval-for-lab-grown-meat-to-eat-just.html) [verified-search]; Shanghai maglev, commercial 2004 (https://en.wikipedia.org/wiki/Shanghai_maglev_train) [verified-search]; Falcon 9 first booster landing, 21 Dec 2015 (https://www.planetary.org/articles/20151221-spacex-rtf-sticks-landing) [verified-search]; Waymo driverless public service, Phoenix Oct 2020 (https://waymo.com/blog/2020/10/waymo-is-opening-its-fully-driverless-service-in-phoenix/) and all of San Francisco June 2024 (https://techcrunch.com/2024/06/25/waymo-opens-up-san-francisco-robotaxi-service-to-everyone/) [verified-search].

## Addendum (coordinator)
Ownership resolved: infrastructure.md owns hub networks (air, rocket, gate); this plan unlocks them and sets per-mode costs/speeds. demography.md owns the demographic transition; step 4 here must use demography.md's model (keep the settlement-founding damp only if demography doesn't provide one). Owner decision pending: generalAI tier tag (Speculative vs Near).
- Mirror of infrastructure.md §Interfaces: future-tech's `L_p` land multiplier moves onto rail/highway mode costs (edge-wide division skipped); its `sqrt(L_p)` reach factor is replaced by infrastructure's `infraHeld`; its air disease channel reads infrastructure's Air links; infrastructure's layers replace its air arcs; its `light` field is fed by infrastructure's per-settlement electrification. Infrastructure adopts future-tech's hub rule and `c_air` price.

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **R13.** Displacement u_p is always grievance term 13 (RevoltCause 17) through riots' table (C2), with or without society. Drop "polity unrest += FUT.uUnrest·u_p".
- **R16.** You own the fertility slot `F_p` (`fertMul`, C5) until demography.md exists. religious-evolution's `faithFertility` multiplies into it, with F·faith clamped to [0.15, 1.3].
- **R27.** Stale body text: StructureType 12–20 are infrastructure's; `IdeaHow.Recovered` is **15** (§2.5.9 says 14); your seat orders take the next free values at build time (MASTER-PLAN §3.2).
- **C1.** `deterMul` is the dyad factor 5. **C4:** your single reach multiplier is the network factor, with `√L_p` replaced by infrastructure's held share when it is on.


## Addendum (barriers & cold war)
Overrides the body and earlier addenda where they differ. Source of truth: barriers-coldwar.md (formulas, params, ids).
- `deterrence` held by both principals lowers the cold-war parity requirement to 0.25 and multiplies crisis escalation
  by 0.3 (barriers §3.1, §3.5). `deterMul` stays C1 factor 5. Cold wars add no C1 damping (CW-R1), so the two are not
  counted twice.
- radio and internet set the news lag to 0.05 d and 0.01 d.
