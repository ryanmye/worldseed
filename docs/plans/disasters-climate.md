# Plan: Natural disasters and climate regimes (eruptions, volcanic winters, climate epochs, megadroughts, earthquakes, tsunamis, floods)

Status: PLAN ONLY. Written against the read-only checkout `/home/claude/ryanmye/worldseed` at commit 8cabf09.
Marks: **[V]** read in that tree (file:function named). **[M]** measured on the scratch copy `/home/claude/scratch-disasters`
(probe scripts `probe-disasters.ts` and `probe-tecto.ts` at its root; Node 22.23 `--experimental-strip-types`; full
2000-year default runs on seeds 1, 7, 42, 1234, four in parallel, about 215-230 s each with the probe). **[A]** assumed,
or a design decision not yet checked against code. **[L]** a literature value: the source is named, and the text says when
it is a textbook approximation or contested.

EventType block: **260-269** (`_CONVENTIONS.md`). 260-268 are used here and 269 is spare (locusts, Phase 3).

---

## 0. Interfaces and dependencies

- **Depends on nothing unbuilt.** Every effect goes through systems that exist at 8cabf09: harvest, food, population,
  migration, polity (relations, raids, unrest), disease, landmarks, structures. The plan can be built before or after
  grudges, finances, families and city-states. The convention order puts it after city-states.
- **Optional hooks into sibling plans.** Each one is guarded by a null check and has a proxy fallback:
  - finances (`state-finances.md` 0.3): famine relief in Phase 2 calls `finSpend(s, p, amount)` when `s.fin !== null`.
    Without finances, relief comes from the capital's `s.wealth` (proxy: `s.wealth[cap] -= amount`, if it has that much).
  - merchant capital (goods, exists): a destroyed town loses the same share of `g.ext.merch.mw[id]`. With families on,
    families read `mw` (merchant-families 8.1), so their houses take the loss without any new interface.
  - grudges (`grudges-and-oaths.md`): no new GrievanceKind. Hunger raids already feed relations through the hunger term.
  - city-states: no interface.
- **One World field is added**: `World.tectonic` (section 2.1). This is a world-gen change. It adds a field and changes no
  existing one.

---

## 1. Current behaviour (what exists at 8cabf09)

### 1.1 Year-to-year climate variation today: `sim/history/weather.ts` [V]
- `createWeather` puts each cell in the nearest of `WEATHER.regions = 48` random centres (stream `'history-weather'`).
- `weatherSystem` runs first in the year (index.ts:330). It makes a **fixed number of draws per year** (comment: "the weather
  of a world never depends on what its settlements do"):
  - global AR(1): `g ← 0.6 g + 0.025·gauss` (Irwin-Hall gauss, arithmetic only);
  - **global "crisis"**: chance 1/130 a year, severity U(0.12, 0.3), lasting 2-6 years. The params.ts comment says "(volcanic
    winter, climate swing)". It is anonymous: no event, no place, no cause.
  - per region AR(1): `r ← 0.5 r + 0.07·gauss`;
  - per region **drought**: chance 1/90 a year, severity U(0.25, 0.6), lasting 1-3 years;
  - `harvest[r] = clamp(1 + g + r - crisis - drought, 0.15, 1.4)`.
- **No low-frequency climate.** The slowest component is the global AR(1) at φ = 0.6 (τ ≈ 2 y). There are no warm periods,
  no little ice ages and no megadroughts. The world climate fields (`climate.ts generateClimate`) are static.
- **Measured** [M] (population-weighted mean harvest per year, years 1-2000):

| seed | mean | sd | lag-1 | sd of 30-y means | min | years < 0.85 | years < 0.75 | regions < 0.7 per year |
|---|---|---|---|---|---|---|---|---|
| 1 | 0.987 | 0.056 | 0.61 | 0.017 | 0.658 | 56 | 15 | 1.10 |
| 7 | 0.988 | 0.062 | 0.63 | 0.023 | 0.612 | 60 | 19 | 1.09 |
| 42 | 0.988 | 0.054 | 0.58 | 0.016 | 0.695 | 54 | 11 | 1.05 |
| 1234 | 0.986 | 0.060 | 0.66 | 0.022 | 0.661 | 64 | 25 | 1.20 |

  The 30-year means barely move (sd about 0.02). That is the gap that climate regimes fill.

### 1.2 Harvest to food to famine: `population.ts` [V]
- `foodSystem`: `h = harvest[weatherRegion[cell]]`. If h < 1, `h = stored(h, sp.damp[id])` (storage.ts: shortfall × damp,
  with the staples' storability). A dam damps the shortfall by DAM.droughtDamp. Then `supply = expected · h ·
  harvestLeft` (war). **Storage has no memory**: a third bad year in a row hits exactly like the first. (Phase 2 fixes this,
  section 3.8.)
- `populationSystem`: when unfed, deaths are `0.5 · (pop − supply)`. A **Famine** event (2) is logged when food < 0.65,
  the loss is ≥ 15 %, pop ≥ 300, and the town has had no famine for 30 years. Famine events therefore undercount famines,
  so the harness also uses a starvation-death estimate.
- `abandonmentSystem`: a settlement with fewer than 15 people is abandoned.

### 1.3 Where hunger already feeds the rest [V] (no new code needed for these)
| chain | code | term |
|---|---|---|
| hunger → migration | migration.ts (MIGRATION.hungerChance 0.25 at food ≤ 0.5) | groups leave |
| hunger → raids | polity/war.ts:475 | `drive = WAR.hungry(2)·(1 − food) + …` |
| hunger → hostility | polity/relations.ts:5,82 | `dR += 0.02·hunger` on borders |
| famine → unrest | polity/unrest.ts:60 | `UNREST.famine 0.3` for 10 y after `lastFamine`; `badTax` if harvest < 0.8 (polity/system.ts:218) |
| unrest → collapse | unrest.ts header | revolt, secession, fragmentation when cohesion is low |
| hunger → epidemic toll | disease/system.ts:136 | `toll *= 1 + DZ.famine(0.6)·(1 − food)` |
| famine → religion | religion/params.ts:64 | "woe: famine, sack, conquest or plague within woeYears" |
| abandonment, sack → ruins | landmarks/system.ts scanEvents (Abandoned, Sacked) | ruin, with chances |
| town shrinks → structures | structures.ts:95 | port/dam lost below `keep` |
| dam built after famine | structures.ts:104 | `DAM.famineRisk` |

### 1.4 Baseline rates and responses [M] (per century; full default runs)
Rates (famine events / Migration events / colonies founded / abandoned / revolts / polities ended / wars):

| seed | y500-1000 | y1000-1500 | y1500-2000 |
|---|---|---|---|
| 1 | 4.4 / 12.6 / 99 / 9.4 / 23 / 1.0 / 3.8 | 5.0 / 55 / 82 / 10.8 / 28 / 2.6 / 7.0 | 16.4 / 465 / 44 / 19.6 / 40 / 4.4 / 10.2 |
| 7 | 5.8 / 6.6 / 81 / 6.0 / 11 / 0.8 / 1.4 | 15.4 / 28 / 56 / 8.0 / 32 / 2.6 / 7.2 | 36.7 / 468 / 45 / 25.3 / 48 / 8.8 / 10.6 |
| 42 | 6.0 / 17.8 / 86 / 11.8 / 13 / 0.6 / 1.2 | 26.4 / 72 / 71 / 15.8 / 41 / 4.0 / 7.0 | 28.1 / 517 / 39 / 30.1 / 59 / 8.0 / 11.6 |
| 1234 | 4.4 / 16.4 / 86 / 10.6 / 5.8 / 0.2 / 0.2 | 17.8 / 148 / 112 / 25.0 / 33 / 1.6 / 2.0 | 29.1 / 691 / 47 / 43.1 / 86 / 6.6 / 13.8 |

Famine events in a run: 132 / 295 / 310 / 262 (seeds 1/7/42/1234). Starvation deaths in a run (Σ 0.5·max(0, pop − supply)):
286k / 350k / 289k / 346k. Peak single-year starvation: 10.7k / 16.1k / 6.9k / 20.5k.
Worst 10-year fall in world population after year 400: 11.3 % / 18.5 % / 10.1 % / 16.4 %.

**Famines are regional.** 91-94 % of famine events fall in region-years with harvest < 0.6, which are only 1.2-1.4 % of
region-years (years ≥ 300). Global bad years matter less: only 18-41 % of starvation deaths fall in years when the global
harvest is below 0.85.

Response to a **global** bad year (population-weighted harvest < 0.85; rate in that window ÷ rate in other years; n =
38-61 bad years):

| response | seed 1 | 7 | 42 | 1234 |
|---|---|---|---|---|
| famine, same year | 2.6× | 18.0× | 11.6× | 7.5× |
| migration, +0..2 y | 1.26× | 2.45× | 0.84× | 1.20× |
| abandoned, +0..3 y | 3.5× | 6.4× | 3.9× | 3.5× |
| revolts, +1..10 y | 1.00× | 1.72× | 0.94× | 1.59× |
| wars declared, +1..5 y | **0.73×** | **0.78×** | **0.27×** | **0.57×** |
| polities ended, +1..15 y | 0.22× | 1.51× | 0.39× | 1.68× |

Reading: harvest → famine → abandonment is strong. Migration and revolts respond weakly. **Wars become rarer after a bad
year.** My guess is that hunger lowers mass and wealth, and the declaration rule needs both, but I have not traced it in
war.ts. The raid chain (`WAR.hungry`) does fire, but Raid events are logged only for towns of 1,000 or more, so the
harness must read `ps.diag.raids`. This plan **does not retune these chains by default**. It names the shocks and makes
them bigger and longer, and the harness reports the same response table so the caller can decide (open question 1).

### 1.5 Plates and exposure [V][M]
- `World` holds only `plate` (id per cell) [V contract.ts:46]. Plate motions and boundary stress live in `elevation.ts`.
  `generateElevation` already returns `tectonic: Float64Array` ("signed boundary stress per cell after propagation (+
  convergent)") [V elevation.ts:25], but `sim/index.ts` drops it. goods/deposits.ts and tourism/scenery.ts find
  boundaries from plate-id changes only.
- A proxy for convergent boundaries from plate ids and elevation (relief ≥ 0.35 or a trench ≤ −0.55 within 2 hops) **is
  poor** [M probe-tecto.ts]. Against `tectonic > 0.05`, precision is 0.49-0.75 and recall 0.15-0.33. **Decision: pass
  `tectonic` through to World** (2.1). The proxy is kept only as a fallback for old saved worlds, if any.
- Boundary land is 4.7-11 % of land cells. Share of world population on boundary cells: 6-17 % (y1000-2000); within 2
  hops: 17-37 %. On the open-sea coast: 30-71 %, rising late. Cities (≥ CITY_POPULATION) at y2000: 3 / 10 / 11 / 17.
  Of those, coastal: 0 / 7 / 2 / 9; within 2 hops of a boundary: 0 / 1 / 0 / 0. **Cities rarely sit on boundaries**, so
  quakes mostly strike towns, and tsunamis are the main danger to late cities.
- Cell scale: about 149 km between cells at n = 48 (1.12/n rad × 6371 km) [A: mean Earth radius 6371 km, a standard constant
  not re-checked in this audit]. A settlement stands for a
  ~22,000 km² district. So only large events have effects beyond their own cell.

### 1.6 Determinism rules in force [V]
- index.ts header: "The sim uses only + - * / and sqrt (and floor), so output is bit-identical across engines. Nothing
  depends on the run's length."
  ⇒ **no Math.log / Math.exp / Math.pow at run time.** Power laws are sampled by comparison loops against literal ratios
  (3.3, 3.5).
- One stream per subsystem (`createRng(seed, name)`). Every optional subsystem has a `HistoryOptions` boolean, and with
  it off the history is bit-identical (polity, disease, rulers… pattern).
- history.test.ts:220: every event has `0 ≤ settlement < S`, falls within that settlement's lifetime, and has `other` <
  S (Discovery is the exception: its `other` is a cell). ⇒ **disaster events are logged only when a living settlement is
  involved.** Cells and remote events go in the `History.disasters` table.

---

## 2. Design

### 2.1 World: `tectonic` (world-gen change, step 1)
```ts
// contract.ts, World:
  /**
   * Plate-boundary stress per cell after propagation from the boundaries, in about [-1, 1]: > 0 convergent (mountain
   * belts, island arcs, trenches), < 0 divergent (rifts, ridges), near 0 within plates. The elevation stage's own field;
   * history uses it to place volcanoes and earthquakes.
   */
  tectonic: Float32Array
```
`sim/index.ts`: `const { elevation, tectonic } = generateElevation(...)` and then `tectonic: Float32Array.from(tectonic)`.
No draw changes. history.test.ts:29 hashes an explicit field list, so the world hash is unchanged [V]. Memory: +92 KB per
world.

### 2.2 Stream plan (all derived from world.seed; none touched when off)
| stream | draws | depends on |
|---|---|---|
| `'history-volcanoes'` | set-up: hotspot cells, each volcano's activity | world only |
| `'history-shocks-<c>'` (c = century index, created lazily when year 100·c is first reached) | per year, a **fixed** count: eruption 4, quake slots 16 × 4, flood 1 per region | world only |
| `'history-climate'` | per year, a **fixed** count: 3 global components + 48 regional temperature + 48 regional rain, as gauss (4 uniforms each) = 396 | world only |
| `'history-disaster-damage'` | which structures and landmarks fall, splits among towns | history state (its own stream only) |
| `'names-volcano-<id>'` | a volcano's name, when it is first named | world + the naming people |

**Every shock (when, where, how big) is a function of (seed, world) alone.** Its own streams draw a fixed count per year,
so orders (nudges) and cradle wishes **cannot change** the eruptions, quakes, floods or climate. They only change who
lives there. This is deliberate: an act of nature should not depend on the player. A new OrderKind (e.g. Granary) could
later let a nudge change the *response*, never the shock. Length independence: century streams are created on first use,
so a 3000-year run repeats a 2000-year run's first 2000 years exactly. Extending a run (HistoryRunner.advance) continues
the same streams.

The weather stream `'history-weather'` keeps its exact draws. With disasters on, `weatherSystem` **draws the crisis as
before but does not apply it**: named eruptions and climate epochs replace the anonymous crisis (2.4). Off: unchanged.

### 2.3 State: `sim/history/disasters/state.ts`
```ts
/** disasters: natural shocks and climate regimes (HistoryOptions.disasters; disasters/). */
export interface DisasterState {
  rngVolc: Rng; rngClimate: Rng; rngDamage: Rng
  /** Century stream for shocks, recreated at each century boundary ('history-shocks-<c>'). */
  rngShock: Rng; shockCentury: number
  // --- volcano catalogue (set-up) ---
  /** Volcano cells (at most DX.maxVolcanoes), activity weight per volcano (sum-normalised cumulative, for picks). */
  vCell: Int32Array; vCum: Float64Array; vKind: Uint8Array // VolcanoKind: Arc 0, Rift 1, Hotspot 2
  /** Disaster row of the volcano's name-giving eruption, or -1 if it is unnamed. */
  vNamed: Int32Array
  // --- quake sources (set-up) ---
  /** Boundary cells (|tectonic| >= DX.quakeMinStress, within 1 hop of a plate change) with cumulative weights; 1 = convergent. */
  qCell: Int32Array; qCum: Float64Array; qConv: Uint8Array
  /** Quake rate per year of M >= 7, scaled by this world's boundary length (3.5). */
  rate7: number
  // --- regions (set-up, from weather.region) ---
  /** Mean temperature, rain, |sin lat|, hemisphere sign (+1 N, -1 S), monsoon index per region. */
  rT: Float64Array; rRain: Float64Array; rLat: Float64Array; rHemi: Int8Array; rMon: Float64Array
  /** Harvest change per degC (kT, 3.2) and per unit of rain regime (kP) per region. */
  kT: Float64Array; kP: Float64Array
  /** Big-river cells per region (flood exposure): CSR. */
  fOff: Int32Array; fCell: Int32Array
  // --- climate regime (yearly) ---
  /** Global temperature components (fast, decadal, centennial), degC. */
  gT: Float64Array // length 3
  /** Regional temperature and rain regimes (AR(1), see 3.2). */
  rTa: Float64Array; rPa: Float64Array
  /** Volcanic growing-season anomaly per region this year, degC (<= 0). */
  rTv: Float64Array
  /** Eruptions still forcing the climate: disaster row ids (removed after 4 years). */
  forcing: number[]
  /** Drought detection per region: years below on / above off, the open row or -1. */
  dBelow: Int16Array; dAbove: Int16Array; dRow: Int32Array
  /** Epoch detection: current epoch (-1 cold, 0 none, +1 warm), open row or -1. */
  epoch: number; epochRow: number
  /** Consecutive bad years per region (harvest < DX.badRunAt), for storage exhaustion (Phase 2). */
  badRun: Int16Array
  // --- local shocks (per settlement, grown with s.cap) ---
  /** Extra harvest multiplier on a settlement's own fields (ash, flood), 1 = none; and years left. */
  local: Float64Array; localLeft: Int16Array; localList: number[]
  /** Last disaster row that struck the settlement and its loss share (for unrest, sagas). */
  struckRow: Int32Array; struckLoss: Float32Array; struckYear: Int16Array
  // --- output ---
  rows: DisasterRows // the History.disasters table being built (parallel number[] arrays)
  tempSeries: number[]; volcSeries: number[]; harvestSeries: number[]
  diag: DisasterDiag
}
```
`HistoryState.dx: DisasterState | null` (null when off; every hook checks it).

### 2.4 Contract additions (contract.ts)
```ts
// disasters: natural shocks and climate (HistoryOptions.disasters).
/** What a History.disasters row is. */
export const DisasterKind = {
  Eruption: 0,    // a volcano erupted (VEI >= 5): `size` the VEI, `dT` its peak growing-season cooling (degC, <= 0)
  Earthquake: 1,  // `size` the magnitude (Mw; tenths)
  Tsunami: 2,     // a great wave raised by the earthquake in row `cause`; `size` its reach in km
  Flood: 3,       // a great river flood in a region; `size` the share of that region's river towns struck
  Drought: 4,     // a persistent drought over a weather region; `size` its years (so far, if endYear is -1); `megadrought` when >= DX.megaYears
  ColdEpoch: 5,   // the world's slow climate turned cold: `dT` the lowest decadal anomaly reached
  WarmEpoch: 6,   // ... turned warm: `dT` the highest
} as const
export type DisasterKind = (typeof DisasterKind)[keyof typeof DisasterKind]

/**
 * Natural disasters and climate epochs, struct-of-arrays in order of recording (each row the year it began; the table of a
 * longer run begins with a shorter one's exactly). Shocks are drawn from the world alone, so the same seed always has the
 * same eruptions, earthquakes, floods and climate, whatever the orders or cradle wishes; what they do depends on who lives
 * there. Eruptions are all listed (VEI >= 5); earthquakes only when they killed someone in a settlement or reached M 8.5.
 */
export interface Disasters {
  count: number
  kind: Uint8Array
  year: Int16Array
  /** Last year of a drought or epoch (-1 while it lasts at the end of the run); the year itself for sudden shocks. */
  endYear: Int16Array
  /** Cell of the volcano, epicentre or flood's largest town; -1 for epochs. */
  cell: Int32Array
  /** Weather region (History.weatherRegion) for droughts and floods; -1 otherwise. */
  region: Int16Array
  /** VEI, magnitude, reach km, share, or years, by kind (see DisasterKind). */
  size: Float32Array
  /** Peak growing-season temperature anomaly it caused, degC (eruptions, epochs); 0 otherwise. */
  dT: Float32Array
  /** The settlement struck worst (largest loss in people), or -1 if none was struck. */
  settlement: Int32Array
  /** People killed outright (eruption, quake, wave, flood); famine deaths that followed are not counted here. */
  deaths: Float32Array
  /** Settlements that lost people to it outright. */
  struck: Int32Array
  /** Row of the event it followed from (a tsunami's earthquake), or -1. */
  cause: Int32Array
  /** Volcano's name (eruptions of named volcanoes; '' otherwise; see 3.3). */
  name: string[]
}

/** The world's climate per year (index = year), derived from the world alone except `harvest`. */
export interface ClimateSeries {
  /** Global growing-season temperature anomaly, degC (slow regime + volcanic), area mean over land regions. */
  temp: Float32Array
  /** Its volcanic part alone (<= 0). */
  volcanic: Float32Array
  /** Population-weighted mean harvest multiplier (1 = average year). */
  harvest: Float32Array
}

// History:
  /** disasters: (empty when HistoryOptions.disasters is false) */
  disasters: Disasters
  climate: ClimateSeries   // zero-length arrays when off
  /** Weather region per cell (the harvest regions), for drawing droughts and floods; empty when off. */
  weatherRegion: Uint16Array

// HistoryOptions:
  /**
   * disasters: volcanic eruptions and volcanic winters, slow climate epochs (warm ages, little ice ages), megadroughts,
   * earthquakes, tsunamis and great river floods, drawn from the world alone (the same seed has the same shocks) and felt
   * through the harvest, deaths and ruin. Default true; false gives the history without them (the anonymous harvest
   * crises of the weather instead, the disaster fields empty).
   */
  disasters?: boolean
```

EventTypes (260-268). In each, `value` is the History.disasters row, and `settlement` is always a living settlement:
```ts
  // disasters: natural shocks (260-269; none when HistoryOptions.disasters is false). `value` is the History.disasters row.
  Eruption: 260,       // a volcano erupted near `settlement` (the living settlement nearest it, within DX.witnessHops); `other` -1; `extra` the VEI
  VolcanicWinter: 261, // the harvest failed after an eruption: `settlement` the largest town whose region lost most; `other` the settlement nearest the volcano, or -1; `extra` the peak cooling in degC (< 0)
  Earthquake: 262,     // an earthquake struck `settlement` (the one that lost most people); `other` -1; `extra` the magnitude
  Tsunami: 263,        // a great wave struck the port `settlement` (the one that lost most); `other` the settlement struck worst by its earthquake, or -1; `extra` the number of coastal settlements struck
  CityDestroyed: 264,  // `settlement` (>= TOWN_POPULATION) lost at least DX.destroyedShare of its people to an eruption, quake, wave or flood at once; `other` -1; `extra` the share lost
  Flood: 265,          // a great flood of the river struck `settlement` (the largest river town struck); `other` -1; `extra` the share of its people lost
  DroughtBegan: 266,   // a persistent drought settled on the region of `settlement` (its largest town); `other` -1; `extra` the weather region
  DroughtEnded: 267,   // the drought broke; `settlement` the region's largest town (or the one where it began, if still alive); `other` -1; `extra` its years
  ClimateTurned: 268,  // the world's slow climate entered an epoch: `settlement` the world's largest town; `other` -1; `extra` +1 warm, -1 cold
```
Missing settlement rule: if no living settlement qualifies, **no event is logged**. The row is still written, and the UI
draws rows from the table.

### 2.5 Params: `sim/history/disasters/params.ts` (`DX`)
```ts
export const DX = {
  /** Default for HistoryOptions.disasters. Starts false; flipped to true in step 12 with the goldens re-recorded. */
  enabled: false,
  /** Phase 2 feedback hooks (storage exhaustion, disaster grievance, relief); behind their own flag. */
  feedback: false,
  /** No shock of the great class (VEI 7, quake reaching a town at M >= 8.5, tsunami) before this year (lets cradles take root). */
  graceYear: 200,

  // climate regime (3.2): global components tau years / stationary sd degC
  gTau: [4, 40, 250], gSd: [0.12, 0.18, 0.25],
  rTau: 20, rSd: 0.15,         // regional temperature
  pTau: 30, pSd: 0.07,         // regional rain regime (harvest units at kP = 1)
  // harvest per degC: kT = kBase + kCold * cold - kHot * hot (3.2)
  kBase: 0.03, kCold: 0.10, kHot: 0.05, kMon: 0.06,
  maxRegionLoss: 0.45, maxRegionGain: 0.12,

  // eruptions (3.3)
  maxVolcanoes: 60, hotspots: [2, 5], arcStress: 0.05, arcHops: 3,
  pVei5: 1 / 12,               // VEI >= 5 a year (VEI periodicity table after Newhall & Self 1982; 3.3)
  pStep: 0.126,                // P(VEI >= v+1 | >= v) = 10^-0.9
  maxVei: 7,
  sulfur: [0.15, 0.6, 1.6],    // VEI 5/6/7 base peak growing-season cooling degC, times U(0.4, 1.6)
  shape: [0.6, 1.0, 0.37, 0.14], // forcing by years after the eruption (e-folding ~1 y)
  tropicLat: 0.34,             // |sin lat| < 0.34 (20 deg): both hemispheres
  ownHemi: 1.4, otherHemi: 0.3,
  maxVolcanicDT: 3,
  ashLoss: [[0.05, 0.10], [0.15, 0.35], [0.40, 0.60]], // VEI 5/6/7 share killed in the volcano's cell
  ashRing: [0, 0.04, 0.15],    // ... in ring 1; ring 2 = ringLoss / 6 for VEI 7
  ashHarvest: [0.7, 0.4, 0.15], ashYears: [1, 2, 3],   // local harvest multiplier on struck cells, years
  witnessHops: 6,

  // earthquakes (3.5)
  quakeSlots: 16, rate7: 10,   // M >= 7 per year on an Earth-length boundary network
  refBoundaryCells: 2400,      // boundary cells (|tectonic| >= quakeMinStress) of that reference (n = 48)
  quakeMinStress: 0.02,
  bStep: 0.1,                  // P(M >= m+1 | >= m) = 10^-b, b = 1
  mmaxConv: 9.5, mmaxOther: 8.0,
  quakeLoss: [[7.0, 0.04], [7.5, 0.12], [8.0, 0.20], [8.5, 0.25]], // share killed at the epicentre by M (piecewise-linear)
  cityVuln: 1.3, villageVuln: 0.6,
  tsunamiM: 8.0, tsunamiReach8: 400, tsunamiLoss: [[8.0, 0.05], [9.0, 0.20]],

  // floods (3.6)
  floodFlowQ: 0.9,             // big river = flow in the top 10 % of river cells
  floodBase: 1 / 150, floodWet: 4, floodLoss: [0.01, 0.05], floodHarvest: 0.7, damFail: 0.3,

  // drought / epoch detection (3.7)
  droughtOn: -1.2, droughtOff: -0.4, droughtOnYears: 5, droughtOffYears: 3, megaYears: 15,
  epochOn: 0.35, epochOff: 0.1, // decadal-mean global anomaly degC

  // consequences (3.4)
  destroyedShare: 0.25, wealthMul: 1.5, portLoss: 2, damLoss: 2,
  quakeLandmark: 0.6,          // landmark ruin chance at loss 0.25 (scaled linearly)

  // Phase 2 (DX.feedback)
  badRunAt: 0.8, exhaustYears: 3, disasterGrievance: 0.3, disasterYears: 10, reliefShare: 0.02,
}
```
**Status of these numbers**: every DX value is a **design default** (tuned in step 9) unless 3.2-3.7 tie it to a source
tagged [L] (pVei5 and pStep from the VEI table, bStep from Gutenberg-Richter b = 1, the rupture-length coefficients from Wells
& Coppersmith 1994, rate7 scaled from USGS counts). The shape of sulfur, ashLoss, quakeLoss, tsunami reach and the flood and
drought thresholds are judgement calls, not literature values.
Literals that would otherwise need pow/log are written out: `pStep = 0.126` (10^-0.9), `bStep = 0.1`, and the decimal
table `TENTHS = [1, 0.7943, 0.6310, 0.5012, 0.3981, 0.3162, 0.2512, 0.1995, 0.1585, 0.1259]` (10^(-k/10)). The
rupture-length step 10^0.059 per 0.1 M is `1.1455`.

---

## 3. Rules

### 3.1 Order in the year (index.ts)
```
weatherSystem(s, weather)             // unchanged draws; with dx it skips the crisis term and calls climateYear first:
  climateYear(s, dx)                  //   global + regional regimes, forcing of recent eruptions -> rTv, then harvest[r] (3.2)
shockYear(s, dx)                      // NEW, right after weather: this year's eruptions, quakes, floods from the century
                                      //   stream; direct deaths, local multipliers, structures (3.3-3.6)
foodSystem(s)                         // reads dx.local[id] (hook, 1 line) and, in Phase 2, the storage hook
... (unchanged) ...
landmarksYear(s, lm)                  // scanEvents gains Earthquake/Eruption/Tsunami/Flood/CityDestroyed cases (3.4)
disasterYearEnd(s, dx)                // NEW, before snapshots: drought/epoch detection and events, series, badRun, decay
```
Why shocks come before food: deaths happen first, then the harvest is reaped from the survivors' fields with the ash or
flood multiplier. This matches 536/1815, where the harvest failed in the same and the following year.

### 3.2 Climate regime and harvest (climateYear)
Global temperature, three AR(1) components at τ = 4, 40, 250 years: `x_k ← φ_k x_k + c_k·gauss`, with `φ = 1 − 1/τ` and
`c = sd·sqrt(1 − φ²)` (sqrt at set-up). The sum of AR(1) processes at spread time scales is the standard way to get
approximately 1/f ("red") spectra (approximation; [L] Keshner 1982: 1/f behaviour needs about one state variable per decade
of time scale, each averaging over a different window, which is what spread-τ AR(1) components are). Combined sd ≈
0.33 °C. The τ and sd values are **design defaults**. Regional temperature `rTa ← φ_r rTa + c_r·gauss` (τ 20, sd 0.15) and rain regime `rPa` (τ 30, sd 0.07).

[L] Size check: PAGES 2k Consortium (2019) find coherent multidecadal global-mean variability in reconstructions and
CMIP5 runs, with volcanic forcing a large share of it in 1300-1800 CE. Neukom et al. (2019) find **warm and cold epochs that
were not globally synchronous**: the LIA peaked in the 15th century in the central/eastern Pacific, the 17th in NW Europe and
the mid-19th elsewhere. That is why a regional term exists. The amplitudes "about 0.1-0.3 °C globally" and "NH LIA about
0.5 °C below the medieval anomaly" are **[unverified]**: neither abstract gives a number, and no other source was fetched.
These sds are a **design default**, meant to be about 1.3× the reconstructions so that epochs read in a 2000-year story. Say so in params.ts.
**Contested**: how global the MCA and LIA were.

Volcanic forcing (rTv): for each eruption e in `forcing` and t = year − e.year ∈ [0, 3]:
`rTv[r] −= S_e · hemiW(e, r) · shape[t]`, where `S_e = sulfur[VEI−5] · U(0.4, 1.6)` is drawn at eruption time, and
`hemiW = 1` when |sin lat_e| < tropicLat, else ownHemi (1.4) in the eruption's hemisphere and otherHemi (0.3) in the other.
Then `rTv[r] ≥ −maxVolcanicDT`.
[L] Toohey et al. (2019): in proportion to their estimated stratospheric sulfur, extratropical eruptions since 750 CE cooled
the NH more than tropical ones, and model NH forcing was up to 80 % greater. VEI is a poor proxy for sulfur (the Wikipedia VEI
article, citing Miles et al. 2004; El Chichón 1982 was VEI 5 with a "sulfur-rich plume" per GVP 2024), hence the U(0.4,
1.6) factor, which is a **design default**. Peak cooling comes about one year after the eruption. For Pinatubo 1991, Self et
al. (1996) report NH surface cooling of up to 0.5-0.6 °C and about −0.4 °C over large parts of the Earth in 1992-93. Sigl et
al. (2015) find NH cooling proportional to volcanic forcing, lasting up to 10 years after the largest eruptions, and link
the sixth-century eruptions to pandemics and famine. Büntgen et al. (2016) date the cooling after the 536, 540 and 547
eruptions and name the period from 536 to about 660 the "Late Antique Little Ice Age". The size "−1.5 to −2.5 °C in NH
summers after 536/540" is **[unverified]**: neither abstract gives it. How far the LALIA reached is **contested**.

Harvest per region (replaces the crisis term when on):
```
T_r   = Σ_k x_k + rTa[r] + rTv[r]                         // degC
cold  = 1 - smoothstep(0.35, 0.65, rT[r]); hot = smoothstep(0.8, 0.95, rT[r])
kT[r] = kBase + kCold·cold - kHot·hot                      // harvest change per degC
kP[r] = 0.5 + aridity mean of the region's farmland        // dry land feels the rain regime more
D_r   = kT[r]·T_r + kP[r]·rPa[r] + kMon·rMon[r]·rTv[r]     // volcanic cooling also weakens the monsoon
D_r   = clamp(D_r, -maxRegionLoss, maxRegionGain)
harvest[r] = clamp(1 + global + regional[r] - drought[r] + D_r, harvestMin, harvestMax)
```
[L/A] Cold margins lose the most per °C of cooling. Parry (1978), *Climatic Change, Agriculture and Settlement*, describes
LIA abandonment of upland farms in Scotland (book verified; that it covers Scotland is recalled, not re-read). The per-°C
values (kBase, kCold, kHot, kMon) are **design defaults**, not fitted. Monsoon drying after eruptions: Iles et al. (2013) find
warm-season drying in most monsoon regions in HadCM3, though the Indian and Papua New Guinea regions get wetter and the
signal in observations is weaker. The Yunnan famine of 1815-17 after Tambora (VEI 7) is attributed to the eruption in Chinese
historiography (Fudan Journal 2005, as cited by Wikipedia's "Year Without a Summer"). `rMon` =
smoothstep(0.7, 0.9, T)·smoothstep(0.5, 0.8, rain) on the region's land.

Expected size: VEI 7 with S = 1.6 at t = 1 in a NH cold-margin region gives 0.13 × 1.6 × 1.4 ≈ −0.29. That is in the
range of today's anonymous crisis (0.12-0.3), but it is now placed, named and uneven between regions.

### 3.3 Eruptions
**Catalogue** (set-up, `'history-volcanoes'`):
- Arc: land or coast cells with `tectonic ≥ arcStress` within `arcHops` of a plate change, with score `tectonic·(1 +
  elevation⁺)`.
- Rift: land with `tectonic ≤ −arcStress` on a boundary, with score `0.3·|tectonic|`.
- Hotspots: 2-5 random cells (land or sea), score 1.
- Keep the top `maxVolcanoes` by score. Among cells within 2 hops of each other, keep only the higher (spacing).
- Activity weight = score. `vCum` is its cumulative sum, for a pick by binary search on U.

**Schedule** (per year, from the century stream, 4 draws always made):
- u1 < pVei5 → an eruption;
- u2 → the volcano (vCum);
- u3 → the VEI: `v = 5; if (u3 < pStep) { v = 6; if (u3 < pStep·pStep) v = 7 }` (truncated at 7; [L] no VEI 8: once in more
  than 50,000 years, and a civilisation-ender, so excluded by cap);
- u4 → the sulfur factor.
- Before `graceYear`, VEI 7 drops to 6.

[L] Rates from the VEI periodicity table in Wikipedia's VEI article, which defines the scale after Newhall & Self (1982) and
takes its VEI assignments from the Smithsonian GVP. The table itself is uncited there. It reads: VEI ≥ 4 every 18
months, ≥ 5 every 12 years, ≥ 6 every 50-100 years, ≥ 7 every 500-1000 years, ≥ 8 more than every 50,000 years. With
pVei5 = 1/12 and pStep = 0.126 this gives ≥ 6 every 95 years and ≥ 7 every 755 years. The relation log10 N(≥v) ≈ −0.18 −
0.9(v − 4) is a fit of that table (approximation). Expected per 2000 years: about 167 VEI ≥ 5, 21 VEI ≥ 6, 2.6 VEI 7.

**Local effects**: in the volcano's cell, `share = U(ashLoss[v])`. In ring 1 it is `ashRing[v]`, and in ring 2 (VEI 7) it
is `ashRing[2]/6`. Every living settlement there loses that share (3.4) and gets `local = ashHarvest[v]` for `ashYears[v]`.
Example: Pompeii (Vesuvius 79 CE, VEI 5 per the VEI article) was a town inside a district, so a ≤ 10 % district loss is right at this cell scale.

**Witness and name**: the nearest living settlement within `witnessHops` (BFS over cells) gets the Eruption event. The
first time a volcano erupts with a witness, it is named in that settlement's people's language
(`names-volcano-<vid>`). The name generator is [A]: use the place-name generator for that people as featureNames.ts does
for MountainRange, with the template "Mount {X}". The implementer should check the API in `names/featureNames.ts`.
**VolcanicWinter** (261) is logged in year t = 1 if the area-mean rTv ≤ −0.5 °C.

### 3.4 Consequences of a direct strike (shared by eruptions, quakes, waves, floods): `strikeTown(s, dx, id, share, row)`
- `lost = share · pop`; `pop -= lost`; `rows.deaths[row] += lost`; `struck++`.
- `wealth[id] *= 1 − min(0.9, wealthMul·share)`. With goods on, `mw[id]` gets the same factor.
- Port lost with chance `min(1, portLoss·share)` (`loseStructure`). Dam lost with chance `min(1, damLoss·share)`; a dam
  failure in a flood is `damFail`.
- `struckRow / struckLoss / struckYear` are set (Phase 2 unrest reads them; sagas read the table).
- If pop ≥ TOWN_POPULATION before the strike and share ≥ destroyedShare → **CityDestroyed** (264).
- Abandonment follows naturally if pop < 15 (abandonmentSystem).
- Landmarks (`landmarks/system.ts scanEvents`): new cases for 260, 262, 263, 264, 265. Each standing landmark of a struck
  town falls into ruin with chance `quakeLandmark · min(1, share / 0.25)`, half that for floods. The mark is
  `lSack[id] = year`, so the existing "rebuilt after the sack" revival path restores it later, and landmarks stays a
  consequence layer. Its draws come from `lm.rng`, landmarks' own stream. Amendment to that header: "ruined by sack, quake,
  eruption, wave or flood".
- Events need e.settlement to be alive at the event (test rule). Log events **before** abandonment runs (shockYear comes
  before abandonmentSystem, so this holds).

Chains this sets off, all through existing code: a town hit by a quake has fewer people, so its food per head may rise;
the knock-on effects are the lost wealth (trade, raids target the rich), the lost port (fishing, voyages), unrest, and,
for a capital, `moveCapital` when it is abandoned. A volcanic winter runs harvest → famine → abandonment (3.5-6×
measured) → migration → raids (WAR.hungry) and border hostility → unrest (famine term) → revolts → fragmentation when
cohesion is low. Malnourished towns have a higher epidemic toll (DZ.famine).

### 3.5 Earthquakes and tsunamis
Set-up: quake sources are the cells with |tectonic| ≥ quakeMinStress that touch a plate change. Weight `|tectonic|`;
convergent if `tectonic > 0.05`. `rate7 = DX.rate7 · nSources / (refBoundaryCells · (n/48)²)`. **[A] refBoundaryCells is
set from the measured 2221-2705 boundary cells** (probe-tecto.ts, every boundary cell). The implementer re-measures it for
the |tectonic| filter and records it.

Per year (16 slots × 4 draws, always made): slot occurs if `u1 < rate7/16`. The cell comes from u2. The magnitude is
M = 7.0 + whole + tenth: `while (u3 < 0.1^(k+1) && M < mmax) M += 1` is done as comparisons against literal powers (0.1,
0.01, 0.001). The tenth comes from u4 against `TENTHS`. Then `M = min(M, convergent ? 9.5 : 8.0)`.
[L] Gutenberg-Richter: log10 N(≥M) = a − bM (Gutenberg & Richter 1944), with b ≈ 1 in active regions and 0.5-2 in general.
Globally about 15 M ≥ 7 and about 1 M ≥ 8 a year: the USGS 2000-2021 table gives 13.8 M 7-7.9 and 1.2 M ≥ 8 a year (USGS
2024), and a ≈ 8.2 follows from that. So rate7 = 10 is slightly low. The low value is a **design choice**, because most real
M7s are offshore or remote. Truncation at M 8 for strike-slip and divergent quakes is an approximation and a **design default**.
The 2012 Indian Ocean Mw 8.6, the largest strike-slip quake recorded, is the exception.

Damage: rupture length `L = 10^(−2.44 + 0.59M)` km ([L] Wells & Coppersmith 1994, Table 2A, subsurface rupture length RLD,
all slip types: a = −2.44 ± 0.11, b = 0.59 ± 0.02, s = 0.16, n = 167, **fitted on M 4.8-8.1**, so M > 8.1 is an
extrapolation). It is computed as 1.1455^(10(M−7)) × L(7), a literal table at set-up. At M 7, L ≈ 49 km; at M 8, ≈ 190 km;
at M 9, ≈ 740 km. Reach `R = L/2 + 40` km (the +40 km is a **design default**). For each living settlement within R
(BFS over cells, using chord distance × 6371):
`share = lerp(quakeLoss, M) · (1 − smoothstep(0, R, d)) · (pop ≥ CITY ? cityVuln : pop < TOWN ? villageVuln : 1)`.
[L] Calibration points (all death tolls **contested**; figures from the Wikipedia articles): Tangshan 1976, Mw 7.6, 242,469
dead officially (other estimates are higher) in a city of about 1.06 M, so about 23 %. Lisbon 1755, estimated Mw 7.7-9.0,
quake + fire + tsunami, about 30-40k dead of about 200k, so about 15-20 %. Antioch 526, "250,000-300,000", is a late
ancient figure (mainly from Malalas) and not reliable. The quakeLoss table itself is a **design default**.

A row is written if any settlement lost people or M ≥ 8.5. An Earthquake event goes on the worst-hit settlement if one
exists. The grace rule applies: before graceYear, M ≥ 8.5 is capped at 8.4.

Tsunami (M ≥ tsunamiM at a convergent cell that is sea or seaCoast): reach `Rt = tsunamiReach8 · 10^(M−8)` km (literal
table by tenths), i.e. M 8: 400 km, M 9: 4000 km (**design default**). [L] The 2004 Indian Ocean tsunami (USGS Mw 9.1; later studies 9.2-9.3)
killed people in Somalia about 5000 km away, and as far as South Africa, about 8000 km away. BFS over **sea cells** from the epicentre, so land blocks the wave. Every seaCoast settlement next to a
reached sea cell gets `share = lerp(tsunamiLoss, M) · (1 − smoothstep(0, Rt, d))` and port loss as in 3.4. It gets its own
row (cause = the quake row) and a Tsunami event at the worst-hit port.

### 3.6 Great river floods
Set-up: per region, the big-river cells (flow ≥ the 90th percentile of land river cells). Per year per region, 1 draw:
`u < floodBase · (1 + floodWet · smoothstep(0.05, 0.15, wet))`, where `wet = weather.regional[r] + kP[r]·rPa[r]`. This is
read-only on the weather state, which is world-only, so the schedule stays world-only. If it fires, every living
settlement on a big-river cell of the region gets `share = U(floodLoss)` from rngDamage, `local = floodHarvest` this year,
and dam failure with chance damFail. The row is the region's flood; a Flood event goes at the largest town struck.
[L] The great Chinese floods show that floods kill largely through the famine and disease that follow. In the Yellow River
flood of 1887 (≥ 0.9 M dead, up to 2 M), disease and deprivation killed about as many as the water did. **Correction:** the
1931 flood was mainly the Yangtze-Huai, not the Yellow River. It killed 0.42-4 M (a contested range), mostly through famine
and disease. Those deaths come free from the harvest multiplier and DZ.famine. floodBase, floodWet and floodLoss are
**design defaults**.

**Course changes (avulsion)** are **not in this plan's scope**. The 1851-55 Yellow River shift, from the Yellow Sea outlet
(1128-1855) back north to the Bohai, is a real example, but
`world.riverTo`, `terrain.river` and the precomputed catchments are static, and changing them mid-run would touch
food, migration costs, trade and rendering (open question 4).

### 3.7 Droughts and epochs (disasterYearEnd)
- Drought: rPa[r] / pSd < droughtOn for droughtOnYears in a row opens a row. Its year is back-dated to the first year
  below; it is logged now. It closes after droughtOffYears above droughtOff. It is a megadrought when it lasts ≥ megaYears.
  Events are logged only if the region holds ≥ 300 people.
  [L] Megadroughts in western North America: Cook et al. (2004) find an "epic drought" period of high aridity around
  AD 900-1300. Stahle et al. (2007) find three western megadroughts between about 1300 and 1900, built from regional
  droughts of about 6 years that moved between regions. The phrase "emerging from persistent ocean-atmosphere states" is
  **[unverified]**: it is in neither abstract. The AR(1) τ = 30 regime yields such runs. The thresholds (droughtOn/Off,
  megaYears) are **design defaults**. The existing 1-3 year droughts stay as they are.
- Epoch: the 10-year running mean of Σ_k x_k + mean rTv crosses ±epochOn, with hysteresis at epochOff. A cold one gives
  "the Long Winter"/"a little ice age"; a warm one "the Warm Centuries". One row per epoch.
  Optional [L, contested]: Miller et al. (2012) propose that eruption clusters started the LIA through sea-ice/ocean
  feedback. They date the abrupt onset to 1275-1300 CE, intensifying in 1430-1455, after four large sulfur-rich eruptions
  within 50 years. Here it is a param `volcMemory = 0` (off); if set, a fraction of rTv feeds x_2.

### 3.8 Phase 2 feedback (DX.feedback; off at first)
- **Storage exhaustion**: in foodSystem, `damp_eff = damp + (1 − damp)·min(1, badRun[r]/exhaustYears)`. Multi-year
  failures bite harder; [L] the Great Famine of 1315-17 ran from the bad spring of 1315 through 1316 and ended with the 1317
  harvest, so it was about two to three failed harvests in a row (per Wikipedia; the count is uncited there). badRunAt and
  exhaustYears are **design defaults**. Hook:
  `stored(h, s.dx ? dxDamp(s.dx, region, damp) : damp)`.
- **Disaster grievance**: unrest.ts peasant term `+ disasterGrievance · [year − struckYear ≤ disasterYears] ·
  smoothstep(0.05, 0.25, struckLoss)`. "Mandate of Heaven" style legitimacy loss ([L] the traditional Chinese reading of
  famine and flood as signs of Heaven's displeasure, after which revolts often followed (Wikipedia, "Mandate of Heaven");
  the causal weight in dynastic collapse is contested). disasterGrievance and disasterYears are **design defaults**.
- **Relief**: a polity whose member town is struck spends `reliefShare · pop` via finSpend (or the capital's wealth). It
  halves the disaster grievance for that town. This adds no draws.
- Wars after bad years (1.4 shows they drop): **no change**. The harness reports it (open question 1).

---

## 4. Determinism and tests
- `HistoryOptions.disasters ?? DX.enabled`; `s.dx = null` when off. Off: no new streams are created, weatherSystem takes
  the old path with the crisis, and every hook is a no-op. **The history is bit-identical to 8cabf09.**
- Golden filters: every golden hash helper (polity.test.ts, rulers.test.ts hashBaseFields, cradleWish, renaming,
  disease, goods, tourism, ideas, orders, landmarks) skips the keys `disasters, climate, weatherRegion` and events
  260-269. Add `disasters: false` to their GOLDEN calls until step 12.
- New tests in `disasters/disasters.test.ts`:
  1. off == 8cabf09 (hashBaseFields, seeds 42:1200, 3:600, 9:800 n=24, as state-finances does);
  2. the shock schedule and ClimateSeries.temp/volcanic are equal across runs with different `orders` and `cradles`, and
     with polities/goods/disease off (world-only);
  3. prefix property: the first 800 years of a 1200-year run equal an 800-year run (table rows, series);
  4. invariants: events 260-268 have living settlements, rows are in year order, Tsunami.cause points at an Earthquake
     row, no VEI > 7, no great shock before graceYear, rTv ≥ −3;
  5. history.test.ts:228 event switch: cases for 260-268 (value < disasters.count; extra ranges).
- Cross-engine: only + − × ÷, sqrt and floor in the sim; check with grep for `Math.(log|exp|pow)` under disasters/ in a test,
  as the other systems' tests do if they have one [A].

## 5. UI (render + ui; hedged Chronicle / Legend story lines)
- **Globe layer** `render/disasters.ts` (same pattern as render/disease.ts: a pure function of the year, activity spans
  precomputed, nothing drawn when inactive):
  - eruption: an ash-grey cone glyph with an orange core at the volcano cell; a plume ring spreading in its year (while
    playing); fades over 5 years. VEI 6-7 get a faint grey wash over the cooled hemisphere for the forcing years.
  - quake: concentric ripples at the epicentre in its year, radius R; the struck towns flash.
  - tsunami: a pale-white arc running along the struck coasts.
  - drought: a dry-ochre wash over the region's cells while open (History.weatherRegion), stronger once mega. It must stay
    distinct from blight browns and the disease chartreuse/bone (the disease.ts header lists those palettes).
  - flood: a blue wash on the region's big-river cells for its year.
  - Known world: hidden in cells the viewing people does not know (as disease.ts does).
  - Marker slot: none needed (cell-based). CityDestroyed puts a cracked-ring on the town for 20 years in the ring band
    (markerSlots.ts: ring band, after the sickness rings).
- **Climate strip** (ui/timeline.ts): a thin line under the slider, beside the "world's people behind the slider" sparkline:
  ClimateSeries.temp as a line with a blue fill below 0 and red above; ticks for VEI ≥ 6 eruptions; spans for epochs. Click
  jumps to the year, using the same handler as `setMarks`. New API: `setClimate(temp: Float32Array, ticks: TimelineMark[])`.
- **Chronicle** (ui/format.ts describeEvent/eventKind; chronicleFilter.ts gets a kind 'disaster'):
  - 260 "Mount Ushtaan erupted near Varn (VEI 6)"; 261 "A volcanic winter: harvests failed round Varn (−1.8 °C summers)";
  - 262 "Earthquake (M 7.8) at Tessa: 14% of its people killed"; 263 "A great wave struck Lisk and 6 other ports";
  - 264 "Tessa destroyed (−31%)"; 265 "The river flooded at Amun (−4%)";
  - 266/267 "Drought settled on the land of Varn" / "The drought round Varn broke after 23 years";
  - 268 "The world turned colder" / "A warm age began".
- **Sagas**, both registers (voice.ts PhraseTable; year.ts, city.ts, people.ts):
  - Chronicle (hedged): "It is written that in 1257 Mount Ushtaan burst in the far south, and that the sun was weak for
    two summers; at Varn, they say, a fifth of the people died of hunger." / "The records speak of a great shaking at Tessa
    in 1402, which threw down its walls."
  - Legend (story): "In 1257 Ushtaan woke. Ash fell on the fields of the south, and that summer never came: the Year
    Without Summer, the old songs call it." / "The sea drew back from the harbour of Lisk as far as a man could see, and the
    children ran out to gather the fish. Then the sea came home."
  - **Omens** (omens.ts gets a separate `DISASTER_OMENS` table, never an order's): precursors told in the year before or at
    a ≥ CityDestroyed or VEI ≥ 6 event at the witness town. Most are real precursors: the springs ran hot and smelled of
    sulphur (volcano); the sea withdrew (tsunami; a real precursor of an arriving trough); the wells rose and fell, the dogs
    howled (quake; folklore, **not established science**). Pick them with the same seeded stream rule (seed + row id).
  - Naming: the first VEI 7, or any year with area-mean volcanic ≤ −1.5 °C, is "the Year Without Summer"; later ones are
    "the Ash Winter of {year}". Cold epoch: "the Long Winter" / "the Cold Centuries"; warm: "the Warm Centuries".
    Megadrought: "the Great Drought of {region's people}".
  - City saga: "Tessa was thrown down by the earthquake of 1402 and rebuilt in a generation" (when its pop regained the
    pre-strike level; read from snapshots).

## 6. Steps (commit-sized; each with `npm test` and `npm run typecheck` green; goldens unchanged until step 12)
1. **World.tectonic** (contract.ts, sim/index.ts, worker transfer list if World buffers are listed). Test: world hash
   unchanged (history.test.ts:29); `tectonic.length === cellCount`.
2. **Contract + plumbing**: DisasterKind, Disasters, ClimateSeries, EventTypes 260-268, HistoryOptions.disasters,
   History fields; `disasters/assemble.ts emptyDisasterHistory`; `HistoryState.dx = null`; golden filters; event switch.
   Test: all goldens unchanged.
3. **State + set-up** (`disasters/state.ts createDisasters`): regions (rT, rRain, rLat, rHemi, rMon, kT, kP), flood cells,
   volcano catalogue, quake sources. Test: catalogue sizes on 4 seeds (20-60 volcanoes; quake sources 1000-3000).
4. **Climate regime** (`disasters/climate.ts climateYear`; weather.ts hook: skip crisis when dx). Test: off bit-identical;
   on: series world-only (orders and cradles differ, series equal); prefix property.
5. **Eruptions + volcanic winter** (`disasters/shocks.ts`: schedule, forcing, local ash, witness, naming; events 260/261).
6. **strikeTown** consequences + CityDestroyed (264) + landmarks scanEvents cases (landmarks/system.ts) + structures.
7. **Earthquakes + tsunamis** (262/263) with sea BFS.
8. **Floods** (265) + **droughts/epochs** (266-268) in `disasterYearEnd`; series assembly.
9. **Stats harness** `disasters/disasterStats.ts` (section 7); tune DX to targets; record values in params.ts comments.
10. **Phase 2 hooks** behind DX.feedback (storage exhaustion, grievance, relief). Harness with feedback on/off.
11. **UI**: render/disasters.ts, timeline climate strip, format.ts lines, chronicleFilter kind, sagas (year/city/people,
    omens DISASTER_OMENS, naming). Unit tests for the formatting (as cradlesFormat/landmarksFormat tests do).
12. **Flip DX.enabled = true**: re-record the goldens with the note "with disasters false the tree was checked
    bit-identical to 8cabf09 + steps". Update the index.ts header (order, streams), the weather.ts header (crisis
    replaced when on), and params.ts WEATHER comment.

## 7. Stats harness (`node src/sim/history/disasters/disasterStats.ts [--off] [--json] seeds...`; seeds 1, 7, 42, 1234)
It reuses the probe's measures (copy `/home/claude/scratch-disasters/probe-disasters.ts`): harvest stats, rates per
century, the response table (1.4) to (a) global bad years and (b) **VolcanicWinter years**, the regional famine share,
starvation deaths, and the worst 10-year world population fall. `--off` runs the same world without disasters for ratios.

| target | value | baseline (off) |
|---|---|---|
| eruptions VEI ≥ 5 / 6 / 7 per 2000 y | 120-220 / 10-35 / 0-6 | — |
| volcanic winters (area rTv ≤ −0.5 at t=1) per 2000 y | 6-25 | (anonymous crises ≈ 15) |
| earthquake rows with deaths / CityDestroyed / tsunamis per 2000 y | 30-150 / 2-15 / 1-8 | — |
| megadroughts (≥ 15 y) per world per 2000 y; regions in drought at once | 2-12; ≤ 15 % | — |
| epochs per 2000 y | 3-10 | — |
| sd of 30-y means of harvest | 0.03-0.05 | 0.016-0.023 [M] |
| harvest sd / lag-1 | ≤ 0.08 / 0.6-0.8 | 0.054-0.062 / 0.58-0.66 [M] |
| mean harvest on − off | within ±0.01 | 0.986-0.988 [M] |
| famine events on/off; starvation deaths on/off | 0.9-1.6; 0.9-1.8 | 132-310; 286-350k [M] |
| famine response in volcanic-winter years | ≥ 3× | global-bad 2.6-18× [M] |
| abandonment +0..3 / migration +0..2 / revolt +1..10 after volcanic winters | ≥ 2× / ≥ 1.2× / ≥ 1.1× | 3.5-6.4 / 0.8-2.5 / 0.9-1.7 [M] |
| **caps**: worst 10-y world pop fall | ≤ 25 % | 10-18.5 % [M] |
| world pop at 2000 on/off | 0.8-1.05 | 420k-877k [M] |
| peoples extinct on − off | ≤ 1 | — |
| a single event's deaths / world pop | ≤ 3 % | — |

Hard caps in code: maxRegionLoss 0.45, maxVolcanicDT 3 °C, VEI ≤ 7, per-event town share ≤ 0.6, graceYear 200, and
harvestMin 0.15 as before. If the caps bind in more than 5 % of the years in which they could, the harness prints a warning
(they are meant to be safety rails, not the shape of the curve).

### 7.1 Realism guard (realism-metrics.md section 6)
- Run: `node --experimental-strip-types /home/claude/plans/realism-scripts/realismStats.ts 1 7 42 1234 --json --opts
  '{"disasters":false}' > off.jsonl`, the same with `{"disasters":true}` > on.jsonl, then `realismStats.ts --from off.jsonl
  --vs on.jsonl`. Do this in step 9 and again in step 12. Run the 22-seed `sweep.sh` once before merging.
- **Guard**: the overall realism score (0.404 baseline) must not rise by more than 0.03, and no target may be flagged
  WORSE. The caps in section 7 stay as they are.
- **Intended to improve**: `pop.worst50yFall`, which is 0.055 now against a band of [0.08, 0.35] ("too gentle"). Aim for
  0.08–0.15 on at least 2 of the 4 seeds, with world pop at 2000 no more than 10% lower (realism-metrics.md 5). Report the
  before and after values in step 9's table.
- **Famine depth**: the realism harness has no famine-depth target yet (I checked: TARGETS in realismStats.ts has none). So
  this plan reports its own measures, famine on/off, starvation deaths on/off and peak single-year starvation (section 7).
  It also proposes that the realism plan add `famine.peakYearShare` = peak single-year starvation ÷ world pop. Tentatively
  that would sit in [0.01, 0.05] (**design default**). **Corrected**: the Great Famine of 1315–17 is put at about 10–15 % in
  southern England (Freedman 2000) and about 10 % in northern France (Leguay 2000), and 10–25 % in many towns (Ruiz), all as
  cited by Wikipedia [L, contested]. It would be unscored
  until a band is agreed.
- **Reconciling the population-fall figures.** My "worst 10-year fall 10–18.5 %" (1.4) and realism's 0.055 measure
  different things. Mine uses yearly end-of-year living population, compares year y with y+10, and starts after year 400,
  so it catches sharp dips (y484, 690, 1558, 1987) that recover within decades. Realism's `pop.worst50yFall` uses the
  5-year snapshots, compares W[q] with W[q+50 y] point to point over the whole run, and so misses any dip that recovers
  within 50 years. Both are kept. The 10-year figure guards the caps (≤ 25 %), and the 50-year figure is the realism
  target. To push the 50-year figure up, a disaster has to leave a lasting loss (a multi-year volcanic winter running into
  famine, abandonment and epidemic, or a cold epoch), not just a one-year spike.
- **Option: volcanic-winter malnutrition makes epidemics worse** (closes the realism gap "epidemics too mild", target
  `epi.worstNet` 0.25–0.55, now 0.13). This would go behind `DX.feedback`, off by default. While a region's rTv ≤ −0.5 or
  `badRun ≥ 2`, the disease system's famine term uses a per-settlement `dxMalnut(s.dx, id) = min(1, badRun/3)`, so the
  multiplier becomes `1 + DZ.famine·max(1 − food, 0.5·dxMalnut)`. The effect outlasts the hunger itself (weakened
  survivors), and susceptibility gets +10 % during the forcing years. It is a one-line hook in disease/system.ts:136.
  [L] The Justinianic plague of 541 followed the 536/540 eruptions, and the timing is suggestive. Sigl et al. (2015) link
  the eruptions to sixth-century pandemics. That causal link is **contested**: Mordechai et al. (2019) even argue the
  plague's impact was small. Turn it on only if `epi.worstNet` moves
  toward its band without raising the overall score by more than 0.03.

## 8. Perf and memory [A, estimated from the code paths]
- Per year: 396 climate uniforms + 4 + 64 + 48 shock draws ≈ 510 sfc32 calls, plus 48-region arithmetic, about 0.02 ms.
  Strikes: BFS within ≤ 6 hops (≤ 130 cells) for about 1-3 events a year that reach people; sea BFS for about 1 tsunami
  candidate in 20 years (≤ 4000 km, about 27 hops, a few thousand sea cells). Local multipliers loop only over
  `localList`. foodSystem pays one multiply per settlement. **Total < 0.5 % of a year's cost** (about 16 ms/yr at 32 s
  per 2000 y on one core, per state-finances' timing).
- Memory: World +92 KB (tectonic). History +46 KB (weatherRegion) + 3 × 8 KB (series at 2000 y) + the table (about 300
  rows × 40 B). State: per-settlement 5 arrays (about 30 B × cap).

## 9. Risks and open questions
1. **Hunger → war is negative today** (1.4: wars 0.27-0.78× after global bad years). Real-world evidence that climate
   shocks raise intergroup conflict is **contested** (Buhaug et al. 2014). **Corrected figure**: Hsiang, Burke & Miguel
   (2013) give a median of +14 % intergroup conflict (and +4 % interpersonal) per 1 sd. The +11 % figure is the updated
   estimate in Burke, Hsiang & Miguel (2015): +11.3 % per 1 sd of warming. Should Phase 2 add a "hunger war" term? This plan leaves it out and reports the response.
2. Replacing the anonymous crisis changes the calibrated famine baseline. The harness's on/off famine ratio guards it; if
   famines fall, raise `sulfur` or `gSd` rather than bring the crisis back.
3. `refBoundaryCells` and the arc threshold depend on the `tectonic` distribution, which I measured only as a count of
   `tectonic > 0.05` cells (889-1096 per world). Re-measure in step 3.
4. River course changes are deferred (static rivers and catchments). A cheap middle way: a Flood with share > 0.04 in a
   delta (elevation < 0.03) marks `riverLost[id]`, read by the trade/food river terms. That needs its own design.
5. Locusts (269, Phase 3): outbreaks follow rains in desert-edge breeding grounds ([L] FAO 2024: rain favours breeding,
   and recessions are confined to deserts with < 200 mm/yr). The "then drought" concentration step is **[unverified]**:
   it is not on the FAO page. Could be a region rule `wet year then dry year in savanna/desert-edge regions`.
6. Naming volcanoes uses the people's place-name generator [A API]. If that couples the names module to history
   state, name at assembly time instead (from the witness settlement's people), as renaming does.
7. Sagas must not credit a disaster to an order. The omen tables are separate, and omens.ts must never pick a disaster
   omen for an order or the reverse.
8. Earth calibrations (rates per planet, 6371 km) assume an Earth-sized world. If worlds ever get a size option, scale
   rate7 and the km figures.

---

## References (citation audit 2026-11-26)
Tags: **[verified]** means a page confirming the citation and the claim it backs was opened this session. **[verified:
citation]** means the bibliographic record was confirmed but the specific number was not on the page read (it is flagged
[unverified] in the text). **[unverified]** means the source could not be confirmed this session; the reason is given.
The audit ran out of web-search budget near the end, so some items below were checked only through fetched pages.

1. Büntgen, U., Myglan, V. S., Ljungqvist, F. C., et al. (2016). Cooling and societal change during the Late Antique Little Ice Age from 536 to around 660 AD. *Nature Geoscience* 9, 231–236. https://doi.org/10.1038/ngeo2652 [verified: citation, LALIA 536–~660, the 536/540/547 eruptions; no °C figure in the abstract]
2. Buhaug, H., et al. (26 authors) (2014). One effect to rule them all? A comment on climate and conflict. *Climatic Change* 127(3), 391–397. https://doi.org/10.1007/s10584-014-1266-1 [verified]
3. Burke, M., Hsiang, S. M., & Miguel, E. (2015). Climate and conflict. *Annual Review of Economics* 7, 577–617 (NBER WP 20598, 2014). https://www.nber.org/papers/w20598 [verified: 11.3 % intergroup per 1σ warming]
4. Cook, E. R., Woodhouse, C. A., Eakin, C. M., Meko, D. M., & Stahle, D. W. (2004). Long-term aridity changes in the western United States. *Science* 306(5698), 1015–1018. https://doi.org/10.1126/science.1102586 [verified]
5. FAO (2024). Desert Locust. https://www.fao.org/locusts/en/ [verified: rain-driven breeding; the "then drought" step is unverified]
6. Gutenberg, B., & Richter, C. F. (1944). Frequency of earthquakes in California. *Bulletin of the Seismological Society of America* 34(4), 185–188. https://doi.org/10.1785/BSSA0340040185 [verified: citation]. b ≈ 1 (range 0.5–2): Wikipedia, "Gutenberg–Richter law", https://en.wikipedia.org/wiki/Gutenberg%E2%80%93Richter_law [verified]
7. Hsiang, S. M., Burke, M., & Miguel, E. (2013). Quantifying the influence of climate on human conflict. *Science* 341(6151), 1235367. https://fse.fsi.stanford.edu/node/27403 [verified: +4 % interpersonal, +14 % intergroup per 1σ (median); the article number comes from the page's link, and the DOI was not confirmed]
8. Iles, C. E., Hegerl, G. C., Schurer, A. P., & Zhang, X. (2013). The effect of volcanic eruptions on global precipitation. *Journal of Geophysical Research: Atmospheres* 118, 8770–8786. https://doi.org/10.1002/jgrd.50678 [verified]
9. Keshner, M. S. (1982). 1/f noise. *Proceedings of the IEEE* 70(3), 212–218. https://doi.org/10.1109/PROC.1982.12282 [verified: citation and the "one state variable per decade" description. "Sum of Lorentzians" is my reading of that, not Keshner's words]
10. Miller, G. H., et al. (2012). Abrupt onset of the Little Ice Age triggered by volcanism and sustained by sea-ice/ocean feedbacks. *Geophysical Research Letters* 39, L02708. https://doi.org/10.1029/2011GL050168 [verified: abstract. The article number comes from the ADS bibcode 2012GeoRL..39.2708M]
11. Mordechai, L., Eisenberg, M., Newfield, T. P., Izdebski, A., Kay, J. E., & Poinar, H. (2019). The Justinianic Plague: An inconsequential pandemic? *PNAS* 116(51), 25546–25554. https://econpapers.repec.org/RePEc:nas:journl:v:116:y:2019:p:25546-25554 [verified]
12. Neukom, R., Steiger, N., Gómez-Navarro, J. J., Wang, J., & Werner, J. P. (2019). No evidence for globally coherent warm and cold periods over the preindustrial Common Era. *Nature* 571, 550–554. https://doi.org/10.1038/s41586-019-1401-2 [verified: the finding of regional timing. The author list is recalled; the ADS page listed none]
13. Newhall, C. G., & Self, S. (1982). The volcanic explosivity index (VEI): an estimate of explosive magnitude for historical volcanism. *Journal of Geophysical Research* 87(C2), 1231–1238. https://doi.org/10.1029/JC087iC02p01231 [verified: citation]. Periodicity table: Wikipedia, "Volcanic explosivity index", https://en.wikipedia.org/wiki/Volcanic_explosivity_index [verified; the table is uncited on that page]
14. PAGES 2k Consortium (2019). Consistent multidecadal variability in global temperature reconstructions and simulations over the Common Era. *Nature Geoscience* 12, 643–649. https://doi.org/10.1038/s41561-019-0400-0 [verified: abstract. The end page is recalled]
15. Parry, M. L. (1978). *Climatic Change, Agriculture and Settlement*. Folkestone: Dawson (Studies in Historical Geography). ISBN 0-7129-0794-7. https://search.ub.tum.de/vufind/Record/DE-604.BV003281618 [verified: book record. The Scottish upland content is recalled]
16. Self, S., Zhao, J.-X., Holasek, R. E., Torres, R. C., & King, A. J. (1996). The atmospheric impact of the 1991 Mount Pinatubo eruption. In Newhall & Punongbayan (eds.), *Fire and Mud*. USGS / PHIVOLCS. https://pubs.usgs.gov/pinatubo/self/ [verified: cooling figures. The year and editors are recalled; the page did not state them]
17. Sigl, M., Winstrup, M., McConnell, J. R., et al. (2015). Timing and climate forcing of volcanic eruptions for the past 2,500 years. *Nature* 523(7562), 543–549. https://doi.org/10.1038/nature14565 [verified: citation and abstract. The −1.5 to −2.5 °C figure is unverified]
18. Smithsonian Global Volcanism Program. El Chichón (341120), eruptive history. https://volcano.si.edu/volcano.cfm?vn=341120 [verified: 1982 VEI 5, sulfur-rich plume]
19. Stahle, D. W., Fye, F. K., Cook, E. R., & Griffin, R. D. (2007). Tree-ring reconstructed megadroughts over North America since A.D. 1300. *Climatic Change* 83(1), 133–149. https://doi.org/10.1007/s10584-006-9171-x [verified]
20. Toohey, M., Krüger, K., Schmidt, H., Timmreck, C., Sigl, M., Stoffel, M., & Wilson, R. (2019). Disproportionately strong climate forcing from extratropical explosive volcanic eruptions. *Nature Geoscience* 12(2), 100–107. https://doi.org/10.1038/s41561-018-0286-2 [verified. The authors after Schmidt are recalled]
21. USGS Earthquake Hazards Program. Lists, Maps, and Statistics (Worldwide Earthquakes 2000–2021). https://www.usgs.gov/programs/earthquake-hazards/lists-maps-and-statistics [verified: 13.8 M7–7.9 and 1.2 M8+ a year]
22. Wells, D. L., & Coppersmith, K. J. (1994). New empirical relationships among magnitude, rupture length, rupture width, rupture area, and surface displacement. *BSSA* 84(4), 974–1002. https://www.resolutionmineeis.us/sites/default/files/references/wells-coppersmith-1994.pdf [verified: Table 2A, RLD all slip types a = −2.44, b = 0.59]
23. Event facts from Wikipedia articles, all fetched 2026-11-26 [verified as "Wikipedia says"; the death tolls are contested]: 1976 Tangshan earthquake; 1755 Lisbon earthquake; 526 Antioch earthquake; 2012 Indian Ocean earthquakes; 2004 Indian Ocean earthquake and tsunami; 1887 Yellow River flood; 1931 China floods; Yellow River (1855 course change); Year Without a Summer (Tambora VEI 7, Yunnan famine, citing *Fudan Journal (Social Sciences)* 2005 no. 1); Great Famine of 1315–1317 (citing Freedman 2000 and Leguay 2000 in *New Cambridge Medieval History* vol. 6, and Ruiz); Mandate of Heaven. URLs: https://en.wikipedia.org/wiki/<title>.
24. Miles, M. G., Grainger, R. G., & Highwood, E. J. (2004). Volcanic aerosols: the significance of volcanic eruption strength and frequency for climate. *QJRMS* 130. [unverified: known only as the VEI article's citation for "VEI matters less than SO2"; not opened]
