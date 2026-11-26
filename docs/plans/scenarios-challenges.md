# Plan: Scenarios, goals, the daily challenge, and the prediction game (worldseed)

Plan only. The code is the read-only checkout `/home/claude/ryanmye/worldseed` @ 8cabf09. Probes ran on the scratch copy
`/home/claude/scratch-scenarios` (`probes/luck-floor.ts`, `probes/ens.ts`, `probes/finder-scan.ts`, run with
`node --experimental-strip-types`; logs `probes/*.log`). The box has 2 cores shared with other agents (load 7–31 during
the probes), so the times are loaded upper bounds.
Tags: **[V]** verified in code (file:function), **[M]** measured on the scratch copy, **[A]** assumed or a design default
to tune. Citations follow the `_CONVENTIONS.md` citation rule: inline (Author Year), tagged **[verified]** or
**[unverified]**, full entries in References. Every constant below that is not cited is a **design default**, not a fact.

Depends on: **seat-mode.md** phases A–B (live runner, `addOrders`, `SeatOptions`, `encodeSeat`, decision cards, the
auto-players of its stats harness) for every played scenario; **character-mode.md** (`SeatKind.Person`,
`SeatOptions.person`, `PersonView`, AmbitionKind 6–15) for character scenarios; **experience-whatif-director-sagas.md**
(the static drama score S0, `ui/story/drama.ts`) for the finder and the post-game "what decided it"; perf-efficiency P6
(checkpoints) only to make ensembles cheap. Optional: merchant-families (RichestHouse goal), tech-tree-innovation
(EraFirst; proxy below). Watch-only scenarios, the prediction game and the tutorials T1–T3 need **no** other plan
except one small live-runner request (5.2), which seat-mode step 2 provides and which is specified here as a proxy.

---

## 0. Summary

A **scenario** is a curated start: seed (+ `sub`, cradles), a start year, an optional seat or character, optional
pre-applied orders, goals, a time limit, allowed tools, and a fog setting. It is a small canonical JSON (in the repo or
deflated into the URL). Play always runs on the **live runner** (the worker never simulates past the year shown), so
"no peeking" holds by construction: a History of length Y is bit-identical to the first Y years of a longer run
[V worker.ts header], so it carries no future.

**Goals** are pure predicates over a `History` (`src/scenario/goals.ts`, DOM-free, usable in the worker and in Node).
Each goal yields a status, a progress fraction and a scalar **metric**. Scoring is against the **unplayed baseline**
(the same scenario with the court deciding every card) **and** a **null ensemble**: the same baseline under K alternative
harvest-weather draws from the start year (a new, off-by-default `HistoryOptions.ensemble`). The probes show why the
ensemble is needed: the sim is chaotic, and a do-nothing perturbation flips 9–20 % of 200-year survival outcomes [M].
A player's score is the percentile of their metric within the luck distribution, so "you beat 14 of 16 unplayed
worlds" is honest where "you improved on the baseline" alone would reward luck.

The **daily challenge** maps the UTC date to a scenario deterministically: from a baked calendar file when one exists
for the running sim version, else from a pure fallback (date → seed → in-browser finder). A **result link is the
proof**: it carries the scenario reference, the orders and the sim version, and anyone's browser replays it to verify.
Attempts are kept in `localStorage` (guarded). A leaderboard is evaluated honestly (3.12): v1 ships verified links only;
an optional GitHub-Issues-plus-Actions board is specified but not recommended for v1.

The **prediction game**: before a fast-forward the player puts probabilities on outcomes; resolution uses the same goal
predicates; scoring uses the Brier score (Brier 1950) and optionally the log score (Good 1952), both proper (Gneiting &
Raftery 2007), so calibration is rewarded. The null ensemble gives the "world's own odds" as a reference forecast.

No sim behaviour changes except the opt-in `ensemble` option (off ⇒ bit-identical, by construction). No EventTypes are
needed in v1 (370–379 stay reserved, 10). No registry enums are consumed; new local enums are listed in 10.

---

## 1. Current behaviour (verified)

### 1.1 URL state and the start page [V]
- `main.ts` lines 47–75 document every parameter. In use (grep of `params.get/has/numParam/intParam`): `az bake c
  cachecheck deposit disease dist epidemic faith fly idea ideas intro known lane lat legend library lon longhaul map
  mapcenter nocache o people perf play polity price quality saga secret seed select sickness species spin sub sun sunlat
  sunlon tilt tint told tradition travel view year years`, plus the layer toggles. Seat-mode adds `seat=`, the what-if
  plan `cmp=` and `pov=`.
- **`sub=` changes the world** (`WORLD_OPTIONS = { subdivisions: numParam('sub', 48, 4, 160) }`). A scenario must pin it.
- `o=` (orders, `encodeOrders`) and `c=` (cradles) are part of the history like the seed; `clearHistoryParams()` drops
  both on a new seed. `requestOrders()` re-simulates from year 0 (`worker.ts reorder`).
- `year=` sets the start year; `years=` the initial length (`initialYears()` rounds to `HISTORY_CHUNK_YEARS`, ≤ MAX_YEARS).
- The start page shows only at the bare URL or `intro=1` (`showLanding`, main.ts:79). Any parameter opens the app
  directly, "so shared links keep working". After Start the address gains `seed=`.
- `ui/landing.ts`: hero with title, seed field + dice (`randomSeed()` = 0..999 999), years field (200–6000, step 100),
  Start, "Choose where peoples begin" (hearth picker). `LandingDeps.onStart(seed, years)`. No notion of modes.

### 1.2 Orders and the Nudge panel [V]
- `contract.ts` ~l.1886: OrderKind 0–9, `Order {year, kind, actor, target?}`, `encodeOrders` (`year:key:actor[:target]`
  joined by `;`), `decodeOrders` (skips bad items), `orderFeasible(h, order, year)` judged on year−1. Header: "Not a
  game: no goals, no score." This plan is the game layer; the nudge semantics stay.
- `orders/state.ts createOrdersState`: sorted by (year, list index). `orders/system.ts`: an order "changes nothing before
  its year".
- `ui/nudgePanel.ts`: form, list, "Copy link" (`navigator.clipboard.writeText`, l.515).
- Seat-mode measured that orders failing at give are inert (identical history but for 170–173). **New [M]:** an order
  that is accepted but never acts can still be inert (seed 1234, Explore with reason NoExpedition: zero change), while
  one that acts once (an expedition searched or sent, reason OutOfReach or Reached) changes the world (table 2.1).

### 1.3 Cradle wishes [V]
`cradleWish.ts`: `previewCradles(world, cradles)` tells, **without simulating**, what the History will record (placed,
moved, rejected), and `cradleCount(world)` the number of peoples. A scenario may carry cradles (`c=`); the authoring
tool shows their preview for free.

### 1.4 Worker, cache, sim version, hosting [V]
- `worker.ts` header: one resumable run per world; `advanceTo` reproduces a shorter run bit for bit; orders and cradles
  are part of the cache key (`cacheKeys` serialises all history options but `years`).
- `historyCache.ts codeVersion()`: `__WORLDSEED_SIM_VERSION__`, a hash of `src/sim`, `contract.ts`, `worker.ts`,
  `historyCache.ts` (`vite.config.ts simVersion`). **Any sim change changes every history**, so a result link or a
  baked scenario is valid only for the sim version it was made on (3.9).
- `hashValue(value)` (historyCache.ts:390): two 32-bit FNV-style lanes over every field. `rng.ts hashString` is FNV-1a
  (constants 0x811c9dc5 / 0x01000193, which match the FNV draft, Fowler et al. 2023 [verified]); `mix32` a 32-bit
  finalizer.
- Hosting: `.github/workflows/ci.yml` builds with `--base=/worldseed/` and `upload-pages-artifact` on pushes to main.
  Each deploy **replaces** the whole site. A built `dist` is ~4.6 MB (measured on `/home/claude/plans/dist`) [M].
  GitHub Pages: published sites ≤ 1 GB, soft bandwidth 100 GB/month, deploy timeout 10 min (GitHub Docs 2026a)
  [verified].
- `ui/panels.ts loadPref/savePref`: every `localStorage` access is already in try/catch.

### 1.5 What the main thread holds [V]
Today the whole precomputed History (2000 years by default) is on the main thread; panels and sagas read lifetime fields
(`Polity.endedYear`, `Dynasty.ended`, `Faith.endedYear`, peaks). A timeline clamp would therefore leak the future through
panels. Only a **truncated** History (length = the year shown) is spoiler-free, and the code guarantees that (1.4).

### 1.6 Plans this one builds on (read)
- seat-mode.md: `SeatOptions {kind, id, from, ambitions}`, `seat=house:12:1180[:amb=0.1]`, live append exact [M there],
  `playSeat`, pause → History(D) + cards, take-back via P6, auto-players Court/Hawk/Dove/Random (its §8), AmbitionKind
  0–5, fog via `known/contact`.
- character-mode.md: `SeatKind.Person 4`, `SeatOptions.person: PersonStart`, `seat=person:<role>:<birthKind>.<of>:<born>[f]:<from>`,
  `PersonView` pauses with a full History every 25 years, AmbitionKind 6–15, life score and lineage score (its §3.12).
- experience-whatif-director-sagas.md: `S0(n) = B·M·U·R·F1` per chronicle entry (`ui/story/drama.ts`, DOM-free), the
  StoryPlan beats, the "differences, not effects" rule after ~40 years (owner decision), measured chaos (one fulfilled
  nudge leaves < 10 % shared events within one to two centuries).

---

## 2. Measurements [M]

### 2.1 The luck floor: do do-nothing perturbations flip goal outcomes? (`probes/luck-floor.ts`, `probes/ens.ts`)
Setup: seeds 1, 7, 42, 1234; Y0 = 1000; horizon H = 200; candidates = the top 7–8 polities by population at Y0. Goal
predicates: **Survive** (polity alive at 1200) and **Hold** (its Y0 capital in it at 1200). Two perturbation families:
(a) one Explore order of a far people at 1001 (a "null nudge"); (b) the proposed `ensemble` option: the weather stream
re-seeded from 1001 (`createRng(seed, 'history-weather-ens:' + member)`, a 1-line scratch patch in `index.ts step`).

| seed | baseline survivors (of top-n) | (a) null nudge: survival flips per run (3 runs) | (b) weather member: flips per run (6 members) | largest polity at 1200 changed, (b) | median \|ln Δ people pop\| at 1200, (b) |
|---|---|---|---|---|---|
| 42 | 4 / 7 | 0, 0, 0 | 0, 2, 0, 1, 0, 2 | 0 / 6 | 0.05–0.36 |
| 7 | 6 / 7 | 1, 1, 1 (identical runs) | 2, 1, 1, 1, 0, 0 | **6 / 6** | 0.05–0.13 |
| 1 | 7 / 8 | 1, 2, 1 | 2, 3, 3, 3, 2, 3 | 1 / 6 | 0.03–0.06 |
| 1234 | 5 / 7 | 0, 1, 0 (k=2 inert) | 1, 3, 0, 2, 1, 2 | 0 / 6 | 0.05–0.18 |
| **all** | | **8 / 87 = 9 %** of (polity, run) outcomes | **35 / 174 = 20 %** | | |

Hold flipped almost exactly when Survive did. Readings:
1. **Binary 200-year outcomes are ~10–20 % luck.** A player who "rerolls" with throwaway orders can flip a lost goal
   with a few tries. Anti-scrub rules (3.7) and ensemble scoring (3.4) are required, not optional.
2. Null nudges are a poor ensemble: three different Explore orders on seed 7 gave the **same** perturbed world (the
   perturbation came from the shared mechanism, not the order), and an order that never acts perturbs nothing. Weather
   members are diverse (every member differs) and act everywhere, so they are the ensemble mechanism (3.4, 4).
3. Aggregates are more robust than binaries: per-people population moves by a median 3–36 % (|ln|), the largest polity
   at 1200 is the same in 3 of 4 seeds. Goal metrics should prefer such quantities over knife-edge events.
4. Times (loaded): 1200 years 11.8–30 s; a perturbed run 2.2–16 s as the load fell. Unloaded the perf plan measured
   ~2.5–3.6 ms/year, so a 200-year member from a Y0 checkpoint would be ~0.5–0.7 s [A, arithmetic].

### 2.2 Finder yield on one baseline (`probes/finder-scan.ts`, 2000 years, Y0 = 300…1700 step 100, top-8 polities)
| seed | sim (loaded) | events | polities | brink (seat ends 30–120 y after Y0) | hegemon (×3 pop in 150 y and becomes largest) | plague (GreatEpidemic at a seat town 5–40 y after) | schism (any, 10–60 y after) |
|---|---|---|---|---|---|---|---|
| 1 | 14.9 s | 12 251 | 70 | 7 | 0 | 1 | 0 |
| 7 | 19.9 s | 13 149 | 83 | 5 | 1 | 1 | 0 |
| 42 | 30.3 s | 13 683 | 85 | 8 | 0 | 1 | 1 |
| 1234 | 28.2 s | 15 470 | 69 | 3 | 0 | 0 | 1 |

- No polity exists before Y0 ≈ 400–500 on these seeds, so political scenarios start ≥ 500.
- "Brink" setups are common (3–8 per seed). Hegemon, plague and schism setups are **rare** (0–1 per seed), so the finder
  must scan many seeds (≥ 30 per year of daily scenarios, 3.9), and the hegemon rule needs loosening (×2 and top-2: a
  harness target in 8).
- The scan itself is 5–42 ms per seed; the cost is the simulation.

---

## 3. Design

### 3.1 The scenario record (`src/scenario/types.ts`, DOM-free)
```ts
/** Format version of Scenario (bumped on any incompatible change; readers refuse newer). */
export const SCENARIO_FORMAT = 1

/** How the player enters the scenario. */
export const StartAs = {
  Watch: 0, // no seat: the player watches (and may nudge, if tools allow) from the start year
  Seat: 1, // seat mode (seat-mode.md SeatOptions; kind People, Polity, House, Family)
  Person: 2, // character mode (character-mode.md: SeatKind.Person with SeatOptions.person)
} as const

/** What the fog lets the player see (3.6). */
export const FogMode = {
  Gods: 0, // everything up to the year shown (the sandbox's view)
  Known: 1, // the seat's people's knowledge (the existing people=<id> view); default for seat and person scenarios
  Strict: 2, // Known, plus world-scale panels (rankings, other peoples' sagas, the Library) hidden
} as const

/** Tools a scenario may allow (bits of Scenario.tools). */
export const Tool = {
  Nudge: 1, // free orders from the Nudge panel (kinds in Scenario.nudgeKinds, budget Scenario.limit.orders)
  Cards: 2, // seat / person decision cards (always on with a seat)
  TakeBack: 4, // seat-mode take-back (never in Ranked)
  WhatIf: 8, // the what-if compare panel (only after the end in Ranked)
  GodsView: 16, // "as the gods see it" toggle
  Follow: 32, // the story director (Follow the story)
  Sagas: 64, // sagas of the past (always spoiler-free on a truncated History)
  Predict: 128, // prediction questions (3.13)
} as const

/** A curated start (canonical JSON: keys sorted, no defaults written; see canonicalScenario). */
export interface Scenario {
  format: 1
  /** Stable id ("daily-2026-11-26", "tut-2-walls", "brink-42-0900"); [a-z0-9-], ≤ 48 chars. */
  id: string
  title: string
  /** 1–3 sentences told only from facts at or before `start.year` (3.14 spoiler rule). */
  blurb: string
  /** __WORLDSEED_SIM_VERSION__ the scenario was authored and baked on (3.9). */
  sim: string
  world: { seed: number; sub?: number /* default 48 */ }
  /** Cradle wishes (contract canonicalCradles), as c=. */
  cradles?: number[]
  start: {
    year: number
    as: StartAs
    /** For Seat and Person: the seat (seat-mode SeatOptions; `from` must equal start.year). */
    seat?: SeatOptions
    /** Geographic anchors of the ids used, for rebasing after a sim change (3.15): per id, its cell and people at start.year. */
    anchors?: Anchor[]
  }
  /** Orders applied before the player acts (any year >= 1, kinds 0..ORDER_KIND_COUNT-1): written first in o=. */
  pre?: Order[]
  goals: GoalSpec[]
  /** How goals combine: 0 all (default), 1 any, 2 weighted score only (no pass/fail). */
  combine?: 0 | 1 | 2
  limit: {
    /** The run ends at this year (goals resolved). */
    endYear: number
    /** Free orders allowed (Tool.Nudge), default 0; card choices do not count. */
    orders?: number
  }
  tools: number
  nudgeKinds?: number[]
  fog: FogMode
  /** Ranked: no take-back, no what-if before the end, the anti-scrub rules (3.7). */
  ranked?: boolean
  questions?: QuestionSpec[]
  /** Baked by scripts/scenario.ts bake (3.4): absent until baked; recomputed in the browser for ad-hoc scenarios. */
  baseline?: BaselineDigest
  tags?: string[] // finder archetype: brink, hegemon, plague, schism, tutorial, ...
}
export interface Anchor { role: 'polity' | 'settlement' | 'dynasty' | 'faith' | 'people'; id: number; cell: number; people: number }
```
`SeatOptions` and `Order` are imported from `contract.ts` (seat-mode adds `SeatOptions`).

Validation (`validateScenario(s, world): ScenarioError[]`, pure): format, id charset, `start.year` ≥ 1, `endYear >
start.year`, `endYear - start.year ≤ 1000` (design cap), `seat.from === start.year`, pre-orders decode, goals well-formed
(3.3), questions mutually exclusive and exhaustive (3.13), tools consistent (Ranked ⇒ no TakeBack). Id validity at
`start.year` needs a History and is checked by `resolveScenario(s, h)` (the worker, at start).

### 3.2 Formats: repo JSON and URL
- **Repo**: `public/scenarios/<id>.json` plus `public/scenarios/index.json` (`[{id, title, tags, sim, difficulty}]`),
  served by Pages. URL `scn=<id>` loads it (`fetch(import.meta.env.BASE_URL + 'scenarios/' + id + '.json')`).
- **Inline**: `sc=<base64url(deflate-raw(canonical JSON))>`. `CompressionStream('deflate-raw')` exists in all current
  engines (web.dev 2023 lists Safari 16.4 [verified]); fallback: `sc0=<base64url(JSON)>` uncompressed when the API is
  missing. A typical scenario is ~600–1200 bytes of JSON [A], ~400–700 deflated.
- **Canonical form**: `canonicalScenario(s)` = keys sorted, defaults omitted, orders canonical (`decodeOrders(encodeOrders)`).
  `scenarioHash(s)` = `hashValue(canonical)` (64-bit hex). It identifies content in result links. FNV is non-
  cryptographic (Fowler et al. 2023 [verified]): it guards against accidents, not forgery, which is fine because
  verification replays (3.8).
- **Play URL** (what the address bar holds during play): `scn=<id>` or `sc=…`, plus seat-mode's `seat=`, plus `o=`
  (= `pre` followed by the player's orders, so the sim input is one list; the first `pre.length` items must equal `pre`,
  or the link is rejected), plus `v=<sim8>` (first 8 hex of the sim version). `seed=`, `sub=`, `c=`, `year=` are written
  too so the address is a plain worldseed link even for an old build. New names (none clash with 1.1): `scn`, `sc`,
  `sc0`, `v`, `daily`, `res`, `pr`, `att`, `author`, `tut`.

### 3.3 Goals: predicates over History (`src/scenario/goals.ts`, DOM-free, no CSS imports)
```ts
/** What a goal asks (GoalSpec.kind). Every goal is judged on a History alone, at a year (3.3). */
export const GoalKind = {
  Survive: 0, // the seat (or polity `subject`) still exists at `year` (seat: SeatHistory.polityAt >= 0; else Polity.endedYear)
  HoldCity: 1, // settlement `subject` is in the seat's polity (or polity `by`) at `year`; continuous=1: at every snapshot from start
  Dynasty: 2, // house `subject` rules polity `by` (or any throne when by = -1) at `year`; continuous=1: never lost it
  ContainFaith: 3, // faith `subject` has share <= `value` of the followers in region `by` (-1: the world; >= 0: a landmass id) at `year`
  SpreadFaith: 4, // faith `subject` has share >= `value` (as above)
  Richest: 5, // the seat's polity (or family `subject` with merchant-families) is the richest by wealth (3.3.1) at `year`; span: for `span` years running
  EraFirst: 6, // the seat's people (or people `subject`) is the first to hold >= ERA.share of era `value`'s ideas (3.3.2)
  Rank: 7, // the seat's polity is in the top `value` by population at `year`
  Share: 8, // the seat's polity holds >= `value` of the settled population of landmass `by` at `year` (seat-mode Unify generalised)
  NoEvent: 9, // no event of type `value` touching polity/settlement `subject` (EventRef rules) in (start, year]
  Event: 10, // at least one such event in (start, year]
  Ambition: 11, // seat-mode / character-mode AmbitionKind `value` fulfilled (AmbitionFulfilled 273 in (start, year])
  Life: 12, // character mode: the life score (character-mode 3.12) >= `value` at the person's death or `year`
  Population: 13, // the seat's polity (or people `subject`) population >= `value` × its population at start
} as const
// 14..39 reserved for this plan; 40..59 reserved for character-mode goals (persons, offices, ventures).

export interface GoalSpec {
  kind: GoalKind
  subject?: number
  by?: number
  value?: number
  /** Judged at this year (default the scenario's endYear); an event goal over (start.year, year]. */
  year?: number
  continuous?: 0 | 1
  span?: number
  /** Weight in the score (default 1). */
  w?: number
  /** Short label override (else the UI's phrase table, ui/scenario/goalWords.ts). */
  label?: string
}

export const GoalStatus = { Pending: 0, Met: 1, Failed: 2 } as const
export interface GoalState {
  status: GoalStatus
  /** 0..1 toward the goal, for the HUD (3.16). */
  progress: number
  /** The scalar compared with the baseline and the ensemble (3.4), higher is better (per-kind direction in METRIC). */
  metric: number
  /** The year it was decided (met for good, or failed), -1 while pending. */
  decided: number
}

/** Judge goal g on History h as of year y (y <= h.years). Pure, no allocation beyond small scratch; O(snapshots·settlements) worst case. */
export function evalGoal(h: History, sc: Scenario, g: GoalSpec, y: number): GoalState
```
Rules per kind (status at y; decided early when it cannot change):

| kind | Met / Failed | progress | metric (higher better) |
|---|---|---|---|
| Survive | Met at y ≥ year if alive; Failed (decided) the year it ends | (y − start)/(year − start) while alive | years survived after start, capped at year − start |
| HoldCity | at the snapshot of `year` (`polity[q·S + id] === p`); continuous: Failed at the first snapshot it is not | share of snapshots held | years held |
| Dynasty | the reign at `year` of polity `by` (reignIds/rulers.dynasty); any throne: some living polity's current reign has dynasty d | as Survive | years on a throne |
| ContainFaith / SpreadFaith | share = Σ pop·faithShare of settlements whose majority faith is f, in region, over Σ pop (snapshot of `year`) | 1 − share/value (Contain), share/value (Spread) | −share (Contain), share (Spread) |
| Richest | max over polities of Σ member `wealth` (snapshot), or with merchant-families the family capital | rank-based: 1/rank | ln(own wealth / best other's wealth) |
| EraFirst | Met the year the people crosses ERA.share first; Failed when another people does first | own share / ERA.share | −(year reached − start), −∞ → −(year − start) − 1 when never |
| Rank / Share / Population | at `year` | value achieved / value asked | the achieved quantity (log for Population) |
| NoEvent / Event | from the event list; EventRef: `settlement === subject` or the polity of `settlement` at the event year is `subject` (polityOfCap) | Event: 0/1; NoEvent: (y − start)/(year − start) until it happens | 0/1 (NoEvent: years without it) |
| Ambition | AmbitionFulfilled 273 with value = kind (seat-mode) | 0/1 | 0/1 |
| Life | Persons.score of the current person (character-mode) | score/value | score |

3.3.1 **Wealth**: `History.wealth` per snapshot per settlement (same layout as population [V contract]) plus
`merchantWealth` (the town's merchant houses' capital; contract: "a town's wealth a head is (wealth + merchantWealth) /
population" [V]); a polity's wealth = Σ over member towns of both. With state-finances present, use its revenue (seat-mode's Riches rule) — a later swap
behind `GOALS.wealthSource`.

3.3.2 **Eras** (until tech-tree-innovation.md provides real eras): `IDEA_DEFS[i].era` (0–4) exists in
`sim/history/ideas/params.ts` [V] but not in History. `goals.ts` imports a tiny `ideaEra(key): number` exported from that
params file (DOM-free, no History change, so no golden hash moves). A people holds era e when it holds ≥ `ERA.share`
(0.5, design default) of the era's ideas (`ideasHeldAt` [V contract]). If tech-tree-innovation adds named eras, EraFirst
reads those instead (Interfaces 10).

Seat-relative goals resolve the seat's polity per year through `History.seat.polityAt` (seat-mode), so a goal follows a
house through a partition exactly as the seat does. Progress for the HUD is evaluated on each History the worker posts
(seat pauses, character-mode full Histories every 25 years) and shown "as of <year>"; the final verdict is evaluated on
the History at `endYear` (or at the seat's loss).

### 3.4 Baseline, null ensemble, difficulty and score (`src/scenario/score.ts`, pure; runs in `scenario/bake.ts`)
Definitions (all runs use the scenario's inputs: seed, sub, cradles, pre, seat):
- **B0, the unplayed baseline**: the run with no player orders. With a seat every card is "let the court decide" (its
  Choice records are inert [M seat-mode]), so B0 = the seat-on run with `pre` only.
- **N, the null ensemble**: B0 under weather members m = 1..Kn: `HistoryOptions.ensemble = {from: start.year + 1,
  member: m}` (4). It is the distribution of unplayed outcomes "with other harvests". Kn = 12 offline, 4 in the browser.
- **P, the policy ensemble**: seat-mode's auto-players (Hawk, Dove, Random_j for j = 1..Kr, Kr = 6) under real weather.
  It measures leverage: can choices change the outcome at all?

For each goal g and run r: metric `m_g(r)` and met flag `μ_g(r)` from `evalGoal` at the end.
- **Luck percentile** of the player's metric x: `π_g = (#{r ∈ {B0} ∪ N : m_g(r) < x} + 0.5·#{… = x}) / (Kn + 1)` (mid-rank).
- **Score** (0–1000): `S = 1000 · Σ_g w_g·(0.5·μ_g + 0.5·π_g) / Σ_g w_g`. **Par** = S of B0 itself. The card shows
  "Score 812 (par 310): you beat 11 of 13 unplayed worlds". With `combine = 2` the μ term is dropped.
- **Difficulty** `D = 1 − mean over r ∈ N ∪ P of [all goals met by r]`, shown as stars (★ < 0.25 ≤ ★★ < 0.5 ≤ ★★★ <
  0.75 ≤ ★★★★; D = 1 is "unproven: no auto-player has done it").
- **Leverage** `L = share of P whose (μ vector) differs from B0's`. **Luck** `Λ = share of N whose μ vector differs from
  B0's`. A scenario is publishable when `L ≥ Λ + 0.15` (choices matter more than the weather) and `0.3 ≤ D ≤ 0.9`
  (design defaults, tuned by the harness, 8). Standard error of D with K = 18 runs is up to ≈ 0.12 (√(0.25/18)), so the
  stars are coarse by design.
- `BaselineDigest { sim; kn; kr; metrics: Float32Array /* (1 + Kn + 2 + Kr) × goals */; met: Uint8Array; D; L; Λ; par }`,
  stored base64 in the scenario JSON. It is a spoiler for anyone who reads the file; the UI shows nothing of it before
  the end (3.7).

Costs: each member is H years from the start year. With P6 checkpoints the prefix 0→start.year is shared, so a bake is
`(1 + Kn + Kr + 2) · H · ~3 ms` ≈ 21 · 300 · 3 ms ≈ 19 s offline unloaded; without P6 each member re-runs from 0
(≈ 21 × 3–5 s ≈ 1–2 min) [A from 2.1 and perf's ms/year]. In the browser (ad-hoc scenarios) the lite bake (Kn = 4, Kr = 2)
runs after the attempt, in the background, cancellable.

### 3.5 Play: the live runner and the time limit
- Start: the worker builds the run with `{orders: pre, seat, cradles}` and `simulateTo(start.year)`, then posts
  History(start.year). Seat and Person scenarios use seat-mode's `seat` request unchanged (it already posts only to the
  pause year). Watch scenarios use `liveAdvance` (5.2): the worker posts History(Y + step) per step (default 25 years at
  normal speed, 5 years when a goal is near decided), never beyond `endYear`.
- Orders the player gives must have `year > run.year` (`addOrders` throws otherwise), so a nudge can only act on the
  future of the year shown. That is also the main anti-scrub rule (3.7).
- At `endYear` (or SeatLost, or the person's line ending with a Survive/Life goal), the worker posts the final History
  and a `GoalReport` (goals evaluated in the worker, `scenario/goals.ts`), and the main thread shows the result card.
- After the end, the scenario becomes a normal sandbox history (Extend, What-if and the sagas unlocked), with the
  baseline comparison offered through the what-if panel (`cmp=` with B0's order list = `pre`).

### 3.6 Fog-of-war options
- `Gods`: the truncated History, everything visible (the past only).
- `Known` (default with a seat): seat-mode 6.2's forced `people=<st.people>` knowledge view and chronicle filter;
  GodsView toggle allowed only when `tools & GodsView` (never in Ranked).
- `Strict`: Known, plus hide the panels that rank or summarise the whole world (Factions list beyond contacted polities,
  the Library, other peoples' sagas, world saga), since they leak positions of unknown peoples. Implemented as a
  `ScenarioView.hidden: Set<string>` of panel names the panels consult (`registerPanel(name, …)` already names them
[V panels.ts:134]).
- Prediction questions name only contacted polities and known faiths under Known/Strict.

### 3.7 Difficulty, fairness, anti-scrub (what can and cannot be enforced)
What the design enforces:
1. **No future in the client**: truncated Histories only (1.5); the baseline and ensembles are baked offline or run
   after the end; challenge runs never write the IndexedDB history cache until the end (the cache key would let a
   second tab read it). The what-if panel is off until the end in Ranked.
2. **Orders only forward** (`year > run.year`, 3.5).
3. **Actor-in-realm rule** (Ranked, verifier-checked): a free order's actor must be the seat's polity, the seat's people
   or a member town of the seat's polity at the order's year − 1, and its target must be known to the seat's people
   (`knownYear`, `contactYear`). This kills the cheapest reroll (a far people's Explore order, 2.1).
4. **Order budget** `limit.orders` for free orders; card choices are free (they are the game).
5. **No take-back in Ranked** (seat-mode take-back is a reroll).

What cannot be enforced without a backend, stated in the UI ("How fair is this?"):
- **Repeated attempts**: a deterministic puzzle can be retried, in a private window if need be. The link proves the
  orders produce the result, not that it was a first try. The result card shows the local attempt number (`att=`,
  self-reported, 3.11), and leaderboards (3.12) keep "first try" as an honour column.
- **Foresight from outside**: anyone can open the plain seed with `o=<pre>` in another tab and watch B0, or read the
  baked digest. Daily challenges with a seat reduce the value of this: once the player chooses one card differently,
  the world diverges (chaos, 2.1).
- **Luck**: ensemble scoring dampens it (π compares against the luck distribution), goal horizons are kept ≤ 300 years
  (design cap for Ranked; 2.1 shows 9–20 % flips at 200 years), and aggregates are preferred to knife-edge events.

### 3.8 Result links: the link is the proof
`?scn=daily-2026-11-26&v=1a2b3c4d&seat=house:12:900&o=<pre;player>&res=<claim>&att=2[&pr=<predictions>]`
- `res` = base64url of `{score, met: bitmask, metrics: quantised int16 per goal, end}` (≈ 20–40 chars). It is a claim,
  never trusted: the verifier replays and compares, and shows the replayed values either way.
- **Verify** (button "Check this result", or automatically when a link with `res=` opens): the worker runs the scenario
  with the link's orders headlessly to `endYear` (no History posted: only the `GoalReport`; ~3–5 s desktop at ≤ 2000
  years [A from perf]), checks the rules of 3.7 (pre prefix, budget, actor-in-realm, kinds allowed, years in
  (start, end]), and shows "Verified: score 812" or "Does not match: the replay gives 640" or "Rule broken: order 3 is
  given by a people outside the realm".
- **Sim version**: `v` ≠ the running version ⇒ the replay would be another world. Options, in order of preference:
  (a) **archived builds**: keep each released sim version at `/worldseed/v/<sim8>/` and redirect such links there
  (≈ 4.6 MB a build [M]; 20 versions ≈ 92 MB, far below the 1 GB Pages limit, GitHub Docs 2026a [verified]). This needs
  the deploy to keep old folders: switch `ci.yml` to deploy a `gh-pages` branch that accumulates `v/<sim8>/` (an
  `actions/checkout` of that branch, copy the new build into `v/<sim8>/` and the root, push), or re-download the previous
  Pages artifact. (b) without archives: say "made on an older version of the world; it cannot be checked here".
  Recommendation: (a), keep the last 20 versions, prune older (their links then fall back to (b)).
- Predictions (3.13) ride along in `pr=` and are re-scored on replay of the baseline facts (they resolve on B0).

### 3.9 The daily challenge
- **Key**: `dailyKey(d) = d.toISOString().slice(0, 10)` in **UTC** (so everyone shares a day; the UI shows the local
  time of the next rollover). `daily=2026-11-26` in the URL picks a past day.
- **Calendar first**: `public/daily/<yyyy-mm>.json` holds `{sim, days: {[key]: Scenario}}`, baked by
  `scripts/scenario.ts daily --from <date> --days 45` (the finder 3.14 + bake 3.4, ≈ 1–3 min per day offline without
  P6 [A]). Used only when `sim` equals the running version.
- **Fallback** (no calendar entry for this version): a pure function of the key, so every browser derives the same:
  `seed = hashString('worldseed-daily/' + key) % 1_000_000`; archetype = `ARCHETYPES[(dayOfYear(key)) % 5]` (brink,
  hegemon, plague, faith, predict); the worker simulates the seed's 2000-year baseline (3–7 s desktop, ×3–5 on phones per
  seat-mode, ×1.5–3 per perf — an unresolved cross-plan figure, README) and runs the finder's stage 1 (3.14) for that
  archetype with ties broken by `mix32(hashString(key))`, falling back through the archetype list, then to "survive 200
  years as the largest polity at 1000". Result: a Scenario with `baseline` absent (unrated: difficulty "?"; the lite bake
  runs after the attempt). The fallback's 2000-year run stays in the worker only (not cached until the end, 3.7).
- **CI**: a weekly scheduled workflow re-bakes the next 45 days when the sim version changed (scheduled workflows can be
  delayed under load and are disabled after 60 days without repository activity in a public repo, GitHub Docs 2026b
  [verified]; the fallback covers both). Calendar files are small (~45 × 1.5 KB ≈ 70 KB a month [A]).
- **Same for everyone**: same key → same calendar entry or same fallback, same sim version → same world [V determinism].
  Test 7.4.

### 3.10 Daily and scenario UI flow
Landing → "Daily challenge" card (title, blurb, difficulty, "played: 2 tries, best 640") → Begin → app opens on the
start year (fly to the seat's capital) → HUD with goals and the years left → play → result card (score, par, luck
percentile, goals with ✓/✗, "What decided it": the top drama beats of the seat in (start, end], 3.14) → Share / Try again
/ Explore this world (unlocks the sandbox and the what-if against B0).

### 3.11 Local attempt history (`src/scenario/attempts.ts`)
- Key `worldseed.attempts.v1`; value JSON `{v: 1, items: Attempt[]}`, `Attempt = {scn: string /* id or scenarioHash */,
  day?: string, at: number /* Date.now() */, n: number /* attempt no. for this scn */, sim8: string, score: number,
  met: number, link: string, pr?: number /* prediction points */}`. Cap 300 items, oldest dropped; links > 4 KB are
  stored without `o=` (then "replay unavailable").
- Every read and write in try/catch, as `panels.ts` does: `localStorage` throws `QuotaExceededError` when full (5 MiB
  per origin, MDN 2026 [verified]); it may be unavailable or wiped in private modes, and Safari deletes script-written
  storage of a site not interacted with for seven days under tracking prevention (MDN 2026 [verified]). On failure the
  attempts live in memory for the session and the UI says "attempts are not being saved on this device".
- Size: 300 × ≤ 2 KB ≈ 600 KB worst case, well under the quota [A].
- Calibration history for the prediction game (3.13) is stored in the same record (`pr` and a separate
  `worldseed.forecasts.v1`: per binary-equivalent forecast `[p_q8, outcome]` pairs, cap 2000 = ~8 KB).

### 3.12 Leaderboards without a backend (honest evaluation)
| option | how | verifiable? | cost / risk | verdict |
|---|---|---|---|---|
| 1. Shared verified links | Share → link; anyone opening it verifies by replay (3.8) | yes, per link | none; no ranking across players | **v1** |
| 2. "Paste links" local board | a player pastes friends' links; the page verifies each and ranks them locally | yes | none; manual | v1 (cheap: a list over option 1) |
| 3. GitHub Issues + Actions | Share → "Submit" opens `github.com/<owner>/worldseed-scores/issues/new?title=…&body=<link>`; an `issues: opened` workflow replays in Node, comments the verified score, labels it, and rebuilds `leaderboard/<day>.json` served by Pages | yes (CI replays) | needs a GitHub account; prefilled URLs over the server limit fail with 414, and `labels` needs permission (GitHub Docs 2026c [verified]); public issues, spam, moderation by the owner; Actions minutes per replay (~5–10 s each [A]) | optional later, separate repo |
| 4. Gist per player | the player creates a gist via the API | only by replay | needs an OAuth token in the client; no safe client-only flow without a backend [A, not checked] | rejected |
| 5. Hosted DB (Firebase etc.) | — | — | violates "no backend" | rejected |
Recommendation: options 1 + 2 in v1. Option 3 only if the owner wants a public board; its workflow reuses
`scripts/scenario.ts verify <link>` (the same code as the browser verifier, 7 step 6).

### 3.13 The prediction game (`src/scenario/predict.ts`, `ui/scenario/predictSheet.ts`)
A **question** is a set of mutually exclusive, exhaustive outcomes, each a goal predicate, resolved at a year:
```ts
export const QuestionKind = {
  Survives: 0, // binary per polity: "Will the Kingdom of Vashtar still stand in 1300?" (several binaries, scored independently)
  Largest: 1, // categorical: which of up to 4 named polities is largest by population at `year` (+ "another")
  FaithFirst: 2, // categorical: which faith has the most followers at `year` (+ "another")
  EraFirst: 3, // categorical: which people first reaches era `value` (+ "another" + "nobody by year")
  When: 4, // buckets: in which span does an event happen (e.g. "when does the capital fall": 4 spans + "not by year")
} as const
export interface QuestionSpec { kind: QuestionKind; subjects: number[]; value?: number; year: number; buckets?: number[] }
```
- **Auto questions** (watch mode, Tool.Predict): at the year shown Y, `suggestQuestions(h, Y, fog)` builds 3–5: Survives
  for the top 4 contacted polities at Y + 200; Largest at Y + 200; FaithFirst among the top 3 faiths by followers at Y;
  EraFirst for the next era among the 3 peoples holding most of the current one. Scenarios may fix their own.
- **Commit, then fast-forward**: the player enters probabilities, presses "Seal and fast-forward"; the forecast is
  hashed into the attempt (`pr=` in the link). The worker then runs (live) to the resolve year at the fastest speed;
  nothing after Y was ever computed before sealing (3.5), so there is nothing to peek at in-app.
- **Input UI**: probabilities default to uniform; desktop: a stacked 100 % bar with drag handles between outcomes;
  phone: one row per outcome with −/+ steppers (5 % steps) and live renormalisation, plus "I don't know" (uniform). A
  floor of p_min = 1 % per outcome (design default) keeps the log score finite.
- **Scoring** (outcome o, forecast p over K outcomes):
  - Brier score in its original multi-category form, `BS = Σ_k (p_k − [k = o])²`, range 0..2 (Brier 1950 [verified]).
    Shown as **points** relative to "I don't know": `pts = round(100 · (BS_u − BS) / BS_u)` with `BS_u = 1 − 1/K`. A
    positive affine transform of a proper score keeps the same optimal report, so the points stay proper; overconfident
    misses go negative (a K = 2 question at p = 0.99 wrong gives −292).
  - Log score `ln p_o` (Good 1952 [verified, citation via scilit record]) as "expert" readout: surprise in bits `−log2
    p_o`. The 1 % floor bounds it at 6.6 bits; the floor means a true belief below 1 % cannot be reported exactly, a
    minor departure from strict propriety (stated in the help text).
  - Both are strictly proper (Gneiting & Raftery 2007 [verified via the UW technical report 463R; journal pagination
    unverified]): reporting one's real beliefs maximises the expected score, which is why calibration, not boldness,
    wins.
- **The world's own odds**: the frequency of each outcome over {B0} ∪ N (the baked null ensemble; ensemble forecasting
  in the weather sense, Leutbecher & Palmer 2008 [verified]). Shown after resolution: "the world's dice: Vashtar survived
  in 9 of 13 draws; you said 40 %". Its own Brier score is the reference skill line. Note the truth is B0, itself one
  draw of that ensemble, so even the ensemble's forecast is not perfect.
- **Calibration over time**: from `worldseed.forecasts.v1`, a reliability diagram (10 bins of forecast probability vs
  observed frequency) and, in expert view, Murphy's decomposition BS = reliability − resolution + uncertainty (Murphy
  1973 [verified]).
- **Teaching**: the resolution card lists "what decided it": the top 3 director beats (S0 · F with focus on the
  question's subjects, experience plan §2.2–2.3) between Y and the resolve year, each with "Go" to fly there.

### 3.14 The scenario finder (`src/scenario/finder.ts`, pure over a History; `scripts/scenario.ts find`)
Two stages: stage 1 scans one baseline History per seed (cheap, 2.2); stage 2 bakes ensembles (3.4) only for the top
candidates.

Stage 1, per seed and per Y0 ∈ {500, 600, …, 1700} (design grid), per seat candidate p (top 8 polities by population at
Y0, contacted-agnostic), archetype rules on the baseline (future known here, offline only):
| archetype | rule (baseline) | default goal set | tag |
|---|---|---|---|
| Brink | p ends (PolityEnded) in [Y0 + 30, Y0 + 120]; or a SuccessionCrisis/CivilWar of p in [Y0, Y0 + 20] followed by losing ≥ 40 % of its towns | Survive to Y0 + 150; HoldCity(capital) continuous | brink |
| Hegemon | the polity q ≠ p with the largest pop growth ratio over [Y0, Y0 + 150] (≥ 2, ends in top 2) borders or contacts p | Survive; Share ≥ own Y0 share of the landmass (do not be swallowed) — or, playing q, Rank 1 by Y0 + 150 | hegemon |
| Plague | a GreatEpidemic (67) starts in [Y0 + 5, Y0 + 40] at a town of p or within 3 hops of its land | Population ≥ 0.8 × Y0 at Y0 + 60; HoldCity(capital) | plague |
| Schism | a Schism (92) in [Y0 + 10, Y0 + 60] of the state faith of p (stateFaith) | SpreadFaith (the parent keeps ≥ its Y0 share in p's landmass) or ContainFaith (the schism ≤ 0.25) | schism |
| Hearth | Y0 < 400 (pre-state): a people's growth | EraFirst (next era); Population ×3 | hearth |
Candidate interest score: `I = Σ S0(n)` over chronicle entries n in [Y0, Y0 + H] involving p (drama.ts, the
experience plan's static score), × `(1 + 0.5·[archetype event is a director beat])`. Candidates are de-duplicated (one
per seed per archetype per 300 years) and ranked by I.

Causal data for blurbs, **past only**: `blurbFacts(h, p, Y0)` reads ages of the ruler and heirs (rulers, never deaths
after Y0), wars running at Y0, the neighbours' sizes and rivalries, the faith shares at Y0, ongoing epidemics before Y0.
"The old king is 61; two sons; the Vosk have doubled in fifty years and hold the river." The archetype tag itself hints
at the future ("on the brink"), which is the puzzle's premise and acceptable; dates of the future are never shown.

Stage 2: bake (3.4) the top 3 per archetype per seed; keep if publishable (L ≥ Λ + 0.15, 0.3 ≤ D ≤ 0.9).

Throughput (offline, unloaded desktop, without P6): stage 1 ≈ 4–7 s per seed (one 2000-year run); stage 2 ≈ 1–2 min
per candidate. Daily needs ~1 scenario a day: with rare archetypes at ~0.5 per seed (2.2), ~30 seeds a month for stage 1
and ~60 stage-2 bakes, ≈ 1–2 h of CPU a month [A].

### 3.15 Authoring tools (for the owner)
- **In-app author mode** (`author=1`): a "Make a scenario from here" panel (`ui/scenario/authorPanel.ts`): takes the
  seed, sub, cradles, the shown orders as `pre`, the selected polity/house/people (or a character-mode start) as seat,
  the shown year as start; a goal builder (kind list, subject from the current selection, year, weight; live preview of
  `evalGoal` on the sandbox History, which in author mode knows the future: spoilers are the point here); tools and fog
  checkboxes; questions builder; "Validate" (validateScenario + resolveScenario), "Bake (lite)" in the worker, "Test play"
  (opens the play URL in a new tab), "Export JSON" (download) and "Copy link" (`sc=`).
- **CLI** `scripts/scenario.ts` (Node, `--experimental-strip-types`): `validate <file|dir>`, `bake <file>` (3.4),
  `find --seeds 1-200 --archetype brink --out public/scenarios/`, `daily --from 2026-12-01 --days 45`, `verify <link>`
  (3.8), `rebase <file>` (below). It imports only DOM-free modules: `goals.ts`, `score.ts`, `finder.ts`, and drama S0
  (the experience plan's `ui/story/drama.ts`, which it states is DOM-free; this plan asks that it also stay CSS-free:
  Interfaces 10).
- **Rebase after a sim change**: ids in a scenario are valid only for (seed, sub, cradles, pre, sim version).
  `rebase` re-simulates to `start.year` on the new version, maps each `anchors` entry by (cell, people) to the nearest
  live entity (the what-if plan's matching rule: same people, nearest founding), re-validates and re-bakes, or marks the
  scenario `broken` for the owner. CI runs `scenario.ts validate public/scenarios` on every push (cheap: schema and sim
  match) and a weekly `rebase --check` (heavy).

### 3.16 Onboarding: tutorial scenarios (`public/scenarios/tut-*.json`, `ui/scenario/coach.ts`)
Each is short (≤ 100 simulated years, so it starts in seconds), on a curated seed, with coach marks (an arrow and one
sentence anchored to an existing element id; Next / Skip all) and a goal that cannot be missed by accident but can be
failed by ignoring it. Progress in localStorage (`worldseed.tutorial.v1`, guarded).
| step | teaches | start | goal | tools |
|---|---|---|---|---|
| T1 Watch | play/pause, speeds, timeline, Follow the story, a town card | Watch, a cradle at 300, 60 years | Event: open three chronicle entries (UI-side goal, not scored) | Follow, Sagas |
| T2 Walls | the Nudge panel, Fortify, outcomes | Watch, a town raided often, 50 years | HoldCity 50 years; NoEvent Sacked | Nudge (Fortify), 1 order |
| T3 Explore | Explore/Settle, knowledge fog | Watch, Known fog, 80 years | Event Landfall/Discovery by the people | Nudge (Explore, Settle), 2 orders |
| T4 The throne | seat mode, a WarOnUs card and an Heir card (chosen so both fire within 40 years on B0) | Seat House, 60 years | Dynasty continuous | Cards |
| T5 The odds | the prediction sheet, Brier points, the world's odds | Watch, 2 questions at 150 years | — (prediction points) | Predict |
| T6 A life | character mode, one venture card (Merchant role) | Person Merchant, 30 years | Ambition MerchantPrince or Life ≥ value | Cards |
Tests pin each tutorial's B0 (the coach marks rely on cards firing): step 7.10.

### 3.17 UI, desktop and phone
- **Landing** (`ui/landing.ts`, `landingCopy.ts`): a "Play" row under Start: **Daily challenge** card, **Tutorials**
  (progress dots), **Scenarios** (list from `index.json`, tag filters), **Predict** (watch-mode prediction on the seed in
  the field). Start stays the sandbox. `LandingDeps.onPlay(ref: ScenarioRef)`; main.ts handles `scn/sc/daily/tut`
  parameters exactly like `seed` (any of them skips the landing, as today's rule).
- **HUD** (`ui/scenario/hud.ts`, `scenario.css`): desktop: top-left card under the seed box, 280 px: title, years left
  (bar), goals with progress bars and ✓/✗, free orders left, a "?" opening the rules (3.7 text). Phone (`isCompact()`):
  a one-line strip above the timeline ("⏳ 112 y · 2/3 goals") that opens a sheet tab "Goals" (the sheet's tab system,
  `ui/sheet.ts`).
- **Result card**: desktop modal 420 px; phone half sheet; Share uses `navigator.share` when present (phones) else the
  clipboard (as nudgePanel's Copy link); "Check" shows the verification state.
- **Prediction sheet**: phone steppers, desktop bar (3.13); 48 px targets on phone; keyboard: Tab between outcomes,
  arrows ±5 %.
- **Attempts**: "My attempts" list (Library-like) with replay links.
- Accessibility: HUD progress uses text + bars; result and seal dialogs focus-trapped, Esc closes (not seals).

### 3.18 Chronicle (hedged) and Legend (story) lines
No sim events, so these are UI lines in the result card and the scenario saga preface:
- Brink met, Chronicle: "By 1050 the realm of Tarsa, which many had thought lost after 912, still held its river towns."
  Legend: "They said Tarsa would not see another harvest. It saw a hundred and fifty."
- Brink failed, Chronicle: "Tarsa's last town fell in 1031; the record does not say whether another course would have
  saved it." Legend: "The river took Tarsa in the end, as the river takes everything."
- Prediction resolved, Chronicle: "The forecaster gave the Vosk two chances in five; the Vosk endured." Legend: "You
  doubted the Vosk. The Vosk did not doubt themselves."
Hedging rule (the experience plan's): beyond ~40 years after the player's last order, the card says "in the world
without your orders…" about B0, never "your order caused…".

---

## 4. Determinism and the off switch
- **New HistoryOptions field** (contract.ts, drafted):
  ```ts
  /**
   * ensemble: an alternative draw of the harvest weather from year `from` on, for null ensembles (scenarios' baselines,
   * the prediction game's odds). At the start of year `from` the weather stream is replaced by
   * createRng(seed, 'history-weather-ens:' + member); the weather makes a fixed number of draws per region per year
   * (weather.ts header), so nothing else's draw order moves. Default none: undefined gives exactly the history without it.
   */
  ensemble?: { from: number; member: number }
  ```
  Implementation: one guarded line at the top of `step` before `weatherSystem` (probed in scratch, 2.1). Off ⇒ the line
  is a null check, so the history is bit-identical: golden hashes unchanged without a filter (perf-efficiency's s1
  `923881e7cd3fe59b`, s42 `3bac8db3dfd723b5`, s1234 `2bb9f72e9e99433d`). With P6 the swap must be part of
  `RunnerState` (the weather rng is already one of the 13+ RNG objects P6 exports).
- `cacheKeys` serialises every option but `years`, so ensemble runs get their own cache entries [V worker header]. Bakes
  run with `nocache`.
- Everything else is pure functions of (Scenario, History): goals, score, finder, questions; no RNG; tie-breaks by
  `mix32` of fixed keys. The daily key is UTC. Canonical JSON for hashing.
- Seat Choice records are inert [M seat-mode], so B0 with a seat has no player-made perturbation.
- No sim events, no director registrations (the coverage test is unaffected). 370–379 unused.

---

## 5. Worker protocol and main thread

### 5.1 Requests (worker.ts, header doc extended)
```ts
| { type: 'scenario'; requestId: number; scenario: Scenario; orders: Order[] }        // build the run: pre + orders, seat, cradles; simulate to start.year (or the URL's progress year: replay) and post History; seat scenarios then follow seat-mode's protocol
| { type: 'liveAdvance'; requestId: number; to: number }                               // watch scenarios: step to `to` (<= endYear) and post History(to)
| { type: 'liveOrders'; requestId: number; orders: Order[] }                           // watch scenarios: addOrders (years > run.year), as seat-mode's seatChoose
| { type: 'verify'; requestId: number; scenario: Scenario; orders: Order[]; predictions?: number[] }  // headless replay to endYear: GoalReport only
| { type: 'bake'; requestId: number; scenario: Scenario; kn: number; kr: number }      // B0 + N + P (3.4), chunked, cancellable, progress posts; BaselineDigest
| { type: 'dailyFallback'; requestId: number; key: string }                            // 3.9 fallback: seed baseline + finder stage 1 -> Scenario
// responses
| { type: 'goalReport'; requestId: number; year: number; goals: GoalState[]; violations: string[]; score?: number }
| { type: 'baseline'; requestId: number; digest: BaselineDigest }
| { type: 'scenarioReady'; requestId: number; scenario: Scenario }
| { type: 'bakeProgress'; requestId: number; done: number; total: number }
```
- `liveAdvance`/`liveOrders` are seat-mode's live runner without a seat (its `HistoryOptions.seat`-less `live` flag, its
  step 2 `appendOrders`). Proxy before seat-mode lands: `liveAdvance` = `advanceTo(to)` on the kept run (already exists),
  and `liveOrders` = a new run from 0 with the extended list (today's `reorder` cost, 3–7 s) to the current year: exact,
  only slower.
- Verify and bake never post a History (memory: only small digests cross).
- A `bake` after an attempt runs at background priority: re-enqueued per member like the what-if compare (§1.4 there),
  cancelled by any new request.

### 5.2 Main thread (`ui/scenario/controller.ts`)
Keeps `currentScenario`, the attempt number, the HUD, the URL (`setUrlParam` for `scn/sc/v/o/seat/res/att/pr`); maps
the timeline's max to the History length (no seek beyond it, the current behaviour for a shorter History); disables the
what-if panel, Extend and GodsView per tools; writes the attempt record at the end; loads `public/scenarios/index.json`
lazily.

---

## 6. Interfaces (amendments, enum values)
**Enum registry:** no registry enums consumed (no OrderKind, DecisionKind, RevoltCause, GrievanceKind, ReignEnd). No
EventTypes in v1: **370–379 reserved** for a later in-sim goal watcher (e.g. GoalMet/GoalFailed if goals move into the
sim for cards). New local enums (this plan's, `src/scenario/types.ts`): `StartAs` 0–2, `FogMode` 0–2, `Tool` bits 1–128,
`GoalKind` 0–13 (14–39 this plan, **40–59 reserved for character-mode**), `GoalStatus` 0–2, `QuestionKind` 0–4. RNG
streams: `'history-weather-ens:<member>'` (only with `HistoryOptions.ensemble`).
- **seat-mode**: consumes `SeatOptions`, `encodeSeat/decodeSeat`, `History.seat.polityAt`, AmbitionKind,
  `playSeat`, the worker `seat*` requests; asks (a) the `live` flag without a seat (it lists it as an option in 3.2) and
  (b) its auto-players exported as `autoChoose(policy: 'court'|'hawk'|'dove'|'random', card, key): optionIndex` from
  `seatStats.ts` into `seat/autoPlayers.ts` (pure), (c) a `takeBackAllowed` flag in `seatController` (Ranked off).
- **character-mode**: consumes `SeatKind.Person`, `PersonStart`, `History.persons.score`, AmbitionKind 6–15; GoalKind
  40–59 reserved for its person goals; tutorial T6 uses its Merchant MVP. Its PersonView pauses mean goal progress is
  refreshed only with its full History (every 25 years): stated in the HUD ("as of 1210").
- **experience-whatif-director-sagas**: consumes `S0`, `StaticDrama`, `buildStoryPlan` (finder interest and "what
  decided it"); asks that `ui/story/drama.ts` stay **CSS-free** (it is DOM-free by its plan) so Node scripts can import
  it; what-if `cmp=` reused for "compare with the unplayed world" after the end; anchors-based rebase reuses its (cell,
  people) settlement matching (§1.6 step 4).
- **perf-efficiency P6**: ensembles share a checkpoint at `start.year`; the ensemble swap is part of `RunnerState`.
- **merchant-families**: Richest goal reads family capital when present (proxy: polity wealth).
- **tech-tree-innovation**: EraFirst reads its eras when present (proxy: `ideaEra(key)` from ideas/params.ts).
- **contract.ts**: `HistoryOptions.ensemble` (4); export `ideaEra` from `sim/history/ideas/params.ts` (no History change).
- **ci.yml**: archived builds `v/<sim8>/` (3.8), `scenario.ts validate` on push, weekly daily bake.

---

## 7. Ordered commit-sized steps (each: `npm run typecheck`, `npm test` green)
1. **Types + canonical form** (`src/scenario/types.ts`, `canon.ts`: `canonicalScenario`, `scenarioHash`,
   `encodeScenarioUrl/decode` with deflate-raw and the `sc0` fallback, `validateScenario`). Tests: round-trip (JSON →
   URL → JSON equal); canonical hash stable under key order; validation errors for each rule of 3.1.
2. **Goals** (`goals.ts`, `ideaEra` export). Tests (`goals.test.ts`) on one short history (seed 42, 900 years, cached in
   the test via a fixture of `simulateHistory`): Survive Met/Failed on a polity whose `endedYear` is known; HoldCity
   continuous fails at the first missing snapshot; Dynasty via reignIds; Contain/Spread shares equal a hand sum on 3
   settlements; EraFirst equals the first crossing computed by `ideasHeldAt`; NoEvent/Event; monotone `decided`
   (once decided, later y gives the same status); evalGoal on History(Y) equals evalGoal on the longer History at y ≤ Y
   (prefix property).
3. **`HistoryOptions.ensemble`** (`index.ts step`, contract doc). Tests: off ⇒ golden hashes unchanged; `{from: Y,
   member}` ⇒ identical History before Y (hash of the prefix History(Y−1)); two members differ after Y; same member twice
   ⇒ identical.
4. **Score** (`score.ts`: percentile, S, par, D, L, Λ, BaselineDigest encode). Tests: mid-rank ties; S bounds; D = 0
   when every run meets; digest round-trip.
5. **Worker: scenario, liveAdvance, liveOrders (proxy), verify** + `controller.ts` + URL params in main.ts. Tests:
   `verify` on a hand-made scenario gives the same GoalReport as evalGoal on a full `simulateHistory` with the same
   options; rule violations (pre prefix altered, budget exceeded, actor outside realm, order year ≤ start) each
   rejected. Manual: play a watch scenario on seed 42 to the end on desktop and in phone emulation.
6. **Result links + verification UI** (`res=`, `att=`, `v=`; result card; Check). Test (link verification):
   `encodeResult(report)` → link → `verify` ⇒ "Verified"; a tampered `res` ⇒ "Does not match" with the true score; a
   different `v` ⇒ the version message. `scripts/scenario.ts verify` uses the same function (one code path).
7. **Bake** (worker `bake`, `scripts/scenario.ts bake`). Test: bake twice ⇒ identical digest; Kn = 0, Kr = 0 ⇒ D from
   B0 alone.
8. **Daily** (`daily.ts`: `dailyKey`, `dailySeed`, calendar loader, fallback via worker `dailyFallback`; landing card).
   Tests (deterministic daily seed): `dailyKey` of a Date at 23:59:59Z and 00:00:00Z the next day differ, and of the same
   instant in any `TZ` env are equal; `dailySeed('2026-11-26')` is a pinned number; `dailyFallback` for two pinned keys
   yields pinned `scenarioHash` values (golden; run under `SCENARIO_SLOW=1` in CI weekly, since it simulates 2000 years).
9. **Attempts** (`attempts.ts`) with a throwing-storage test double (getItem/setItem throw, QuotaExceededError on
   setItem): no exception escapes, memory fallback used, cap enforced.
10. **Tutorials T1–T5** (JSON + `coach.ts` + landing row). Tests: each tutorial validates; B0 of T4 has a WarOnUs and an
    Heir card within 40 years (needs seat-mode step 8; until then T4 ships as a Watch tutorial); T2's goal is failed on
    B0 and met with the intended Fortify (so the lesson works).
11. **Prediction game** (`predict.ts`, `predictSheet.ts`, forecasts store, reliability diagram). Tests: Brier and log on
    hand cases (uniform K = 4 ⇒ BS 0.75, pts 0); propriety check by grid (for q on a 0.05 grid, the expected points of
    reporting p are maximal at p = q, 1 % floor aside); suggestQuestions only names contacted polities under Known fog;
    outcomes exhaustive (exactly one true on any History).
12. **Finder + authoring** (`finder.ts`, `scripts/scenario.ts find/daily/rebase`, `authorPanel.ts`). Tests: finder on
    the seed-42 fixture finds the brink candidates of 2.2 (a pinned list); blurbFacts reads nothing after Y0 (a test
    that runs it on History(Y0) and on History(2000) and expects equal output).
13. **Fog Strict, Ranked rules, archived builds in CI, T6 (after character-mode MVP), Issues board (optional).**

---

## 8. Stats harness (`scripts/scenarioStats.ts`, Node; one JSON line per row; seeds 1, 7, 42, 1234)
| metric | target |
|---|---|
| luck flip rate Λ per goal kind at H = 100 / 200 / 300 (Kn = 12) | report; Ranked goal kinds must have Λ ≤ 0.2 at their horizon (2.1 measured 0.20 at 200 y for Survive) |
| leverage L − Λ for brink scenarios | ≥ 0.15 for ≥ 60 % of baked candidates (else the cards do not matter enough: feed back to seat-mode tuning) |
| difficulty D of publishable candidates | spread over 0.3–0.9, no star class > 40 % |
| finder yield per seed (stage 1) | brink 3–8 (as measured), hegemon/plague/schism ≥ 0.5 each after loosening (2.2 measured 0–1) |
| bake time per candidate, unloaded desktop | ≤ 30 s with P6, ≤ 2 min without |
| verify time to endYear ≤ 2000 | ≤ 6 s desktop, ≤ 20 s phone [A] |
| play URL length (Ranked seat scenario, 300 y) | p95 ≤ 4 KB (seat-mode estimates ~2 KB per 60 decisions) |
| ensemble odds vs B0 (prediction reference) | the ensemble's Brier on Survives questions < uniform's on ≥ 3 of 4 seeds (the odds carry information) |
| determinism | verify(link) ≡ live session; dailyFallback ≡ pinned; bake twice ≡ |

---

## 9. Performance and memory
- Goals: O(goals × snapshots × settlements) worst case (continuous HoldCity reads one entry per snapshot; shares read
  one snapshot): < 5 ms on a 2000-year History [A]. Evaluated per posted History only.
- Play uses the live runner: forward cost only, ~3 ms/year desktop [perf M]; one History assembly per post (seat-mode's
  pause cost; watch steps every 25 years ⇒ ~80 posts per 2000 years; assembly 25 ms unloaded per the worker comment,
  200–750 ms loaded [M seat-mode]). Watch steps should grow to 50 years when the assembly exceeds 150 ms (measured
  per device at runtime).
- Verify: one run, no History posted (no 35–39 MB transfer). Bake in the browser (lite, 7 runs): ≈ 7 × (start + H) ×
  3 ms, 15–40 s desktop without P6 [A]; in the background after the attempt only.
- Worker memory: one extra run during verify/bake (28.6–40.9 MB, perf P6 [M]); bake members run one at a time.
- localStorage ≤ ~0.6 MB; calendar files ~70 KB/month; scenario JSON ~1 KB each.
- Pages: archived builds 4.6 MB each [M]; 20 kept ≈ 92 MB.

---

## 10. Risks and open questions

### Verified [V]
URL parameters and the landing rule; `sub=` changes the world; orders' encoding and forward-only semantics; cradle
preview without simulation; the worker's shorter-run-is-a-prefix property; sim version hashing; CI deploy replacing the
site; panels' guarded localStorage; whole History on the main thread today; History fields used by goals (polity,
population, wealth, reignOffsets/reignIds, rulers.dynasty, faith/faithShare/stateFaith, ideaAdoptions); IDEA_DEFS.era
not in History; weather's fixed draws per year.

### Measured [M]
Luck floor (null nudge 9 %, weather ensemble 20 % flips of 200-year survival; 4 seeds, small samples: 12 and 24 runs);
null nudges collapse to one perturbation on seed 7; weather members diverse; finder yields per archetype; dist size;
run times (loaded).

### Assumed [A]
Phone speed factors (seat-mode 3–5× vs perf 1.5–3×, unresolved in README); bake and verify times unloaded; JSON and
link sizes; goal evaluation cost; Actions replay time; all thresholds (D range, L − Λ ≥ 0.15, ERA.share 0.5, p_min 1 %,
horizon cap 300 y, Kn/Kr, step lengths) are design defaults.

### Risks
- **Chaos makes long goals a lottery** (2.1). Mitigation: ensemble percentile scoring, ≤ 300-year Ranked horizons,
  aggregate metrics, publish only when L ≥ Λ + 0.15. Residual: a lucky reroll through card choices remains possible; this
  is disclosed, not hidden.
- **Sim-version drift breaks links and baked scenarios** with every sim commit. Mitigation: `v=`, archived builds,
  rebase via anchors, the daily fallback. Risk that archives accumulate: prune to 20.
- **Spoilers via outside channels** (second tab, reading JSON). Disclosed; Ranked reduces their value.
- **Live-play cost on phones**: frequent History assembly. Mitigation: adaptive step length; seat-mode's merge of close
  pauses.
- **Finder depends on director weights** (taste, [A] in that plan). Stage 2's L/Λ/D gates are weight-independent.
- **Weather ensemble realism**: it perturbs harvests only; other luck (a ruler's natural death year is pre-drawn from
  'history-rulers') is not resampled, so Λ is a lower bound on luck. Open question 3.
- **Prediction anchoring**: auto questions about "the top 4 polities" can be gamed by base rates (big polities
  survive). The world's odds line makes that visible; tune question selection to mid-probability events (ensemble
  frequency in [0.2, 0.8]) when baked.

### Open questions
1. UTC rollover for the daily (proposed) or the owner's time zone?
2. Ship the GitHub Issues board (3.12 option 3) at all? Proposed: not in v1.
3. Add a second ensemble lever (re-seed `'history-rulers'` deaths after `from`) to make Λ cover dynastic luck? It
   would need care: pre-drawn death years are drawn at birth.
4. Allow free nudges (kinds 0–9) in Ranked seat scenarios at all, or cards only? Proposed: budget 0 by default.
5. Should a failed Ranked attempt reveal B0 (the what-if against it) immediately? Proposed: yes, after the end only.
6. Archived builds: `gh-pages` branch vs re-downloading the last artifact: owner's choice of CI style.

---

## References
- Brier, G. W. (1950). Verification of forecasts expressed in terms of probability. *Monthly Weather Review* 78(1),
  1–3. DOI 10.1175/1520-0493(1950)078<0001:VOFEIT>2.0.CO;2 (DOI not confirmed on a fetched page). Citation confirmed in
  Glahn (2004) reference list, https://www.weather.gov/media/mdl/Glahn_2004_PractitionersGuideInAtmos.pdf **[verified]**
  (venue, volume, pages; DOI [unverified]).
- Good, I. J. (1952). Rational decisions. *Journal of the Royal Statistical Society: Series B* 14(1), 107–114. DOI
  10.1111/j.2517-6161.1952.tb00104.x. https://scilit.com/publications/07a6584a514a5e9b9c4ce7cabdba958f **[verified]**
  (record lists title, venue, pages, DOI; the author's name was not shown on the record page).
- Gneiting, T., & Raftery, A. E. (2007). Strictly proper scoring rules, prediction, and estimation. *Journal of the
  American Statistical Association* 102(477), 359–378. DOI 10.1198/016214506000001437. Content verified on the
  preprint, University of Washington Statistics Technical Report 463R (2005), https://apps.dtic.mil/sti/pdfs/ADA454828.pdf
  (quadratic/Brier score strictly proper, §3.1; logarithmic score strictly proper, §4.1) **[verified: content;
  unverified: journal volume, pages, DOI — the publisher and DOI pages could not be fetched]**.
- Murphy, A. H. (1973). A new vector partition of the probability score. *Journal of Applied Meteorology* 12(4),
  595–600. DOI 10.1175/1520-0450(1973)012<0595:ANVPOT>2.0.CO;2. https://websitemetadata.com/doi.org/10.1175/1520-0450(1973)012%3C0595:ANVPOT%3E2.0.CO;2
  **[verified]** (title, venue, start page, DOI; end page 600 [unverified]).
- Leutbecher, M., & Palmer, T. N. (2008). Ensemble forecasting. *Journal of Computational Physics* 227, 3515–3539. DOI
  10.1016/j.jcp.2007.02.014. https://mesoscale.agron.iastate.edu/agron540/Leutbecher_and_Palmer-ensemble.pdf
  **[verified]**.
- Fowler, G., Noll, L., Vo, K.-P., Eastlake, D., & Hansen, T. (2023). The FNV non-cryptographic hash algorithm.
  IETF Internet-Draft draft-eastlake-fnv-20. https://www.ietf.org/archive/id/draft-eastlake-fnv-20.html **[verified]**
  (32-bit prime 0x01000193 and offset basis 0x811C9DC5; "not suitable for cryptographic use").
- MDN Web Docs (2026). Storage quotas and eviction criteria.
  https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria **[verified]** (5 MiB
  localStorage per origin; QuotaExceededError; Safari seven-day eviction; private browsing).
- web.dev (2023). Compression Streams are now supported on all browsers. https://web.dev/blog/compressionstreams
  **[verified]** (gzip, deflate, deflate-raw; Safari 16.4).
- GitHub Docs (2026a). GitHub Pages limits.
  https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits **[verified]** (1 GB site,
  100 GB/month soft bandwidth, 10-minute deploy timeout).
- GitHub Docs (2026b). Events that trigger workflows (`issues`, `schedule`).
  https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows **[verified]**
  (issues opened triggers; schedule ≥ 5 min, may be delayed, disabled after 60 days without activity in public repos).
- GitHub Docs (2026c). Creating an issue (from a URL query).
  https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue **[verified]**
  (title, body, labels, template parameters; permissions; 414 when over the server limit).
