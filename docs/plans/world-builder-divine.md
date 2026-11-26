# Plan: World builder, divine favour, and world saving (worldseed, base commit 8cabf09)

Three features in one plan, because they share one idea: **a run is a recipe** (seed + edits + options + orders), and
the recipe is what the URL, a save and a file carry.

1. **World builder** (before the run): edit the generated world before history starts. Sculpt land, sea and mountains,
   paint climate, change plates, draw rivers, plant hearths, place rare deposits, schedule disasters. Edits are a compact
   ordered list applied to the seed's base world, and the later stages (climate, rivers, lakes, biomes) are derived again.
2. **Divine favour**: a budgeted mode beside today's free nudges (kept as **sandbox**). Favour is earned over time, from
   devotion and from hardship. It is spent on interventions priced by impact (portents, miracles, smiting, inspiration,
   prophets, blessings and curses on a house). Each one runs through existing or planned orders and events, with bounded
   effects. The faithful credit or blame the god, and overuse breeds disbelief.
3. **World saving** (added by the owner mid-plan): versioned recipes in named slots, autosave, a gallery with thumbnails,
   Continue on the landing page, IndexedDB with quota handling, `.worldseed` export/import, share by link, and branches.

Tags: **[V]** verified in code at 8cabf09 (file:line or function); **[M]** measured in my scratch copy
(`/home/claude/scratch-wbd`, scripts in its `probe/`); **[M\*]** measured on a heavily contended 2-vCPU VM (load average
7–35), so trust ratios rather than absolute times; **[A]** assumed or design default. Citations follow the Citation rule:
inline (Author Year), full entries in References, each tagged [verified] or [unverified].

---

## 0. Interfaces, ids, dependencies

### 0.1 Ids claimed (registry)
| enum | values | note |
|---|---|---|
| EventType | **380 Miracle, 381 Credited, 382 Blamed, 383 MiracleClaimed, 384 Heresy, 385 Disbelief**; 386–389 reserved | block 380–389 as assigned |
| OrderKind | **12 contiguous values, `DIVINE_BASE + 0..11`**: Portent, Heal, Feed, Bounty, Storm, Flood, Pestilence, Strike, Inspire, Prophet, Bless, Curse | **Collision to resolve:** tech-tree-innovation.md claims 39–40 and future-politics.md claims 39–41. OrderKind indexes the `ORDER_KINDS` array, so the values must be contiguous. I propose **44–55**, assuming the coordinator gives tech-tree 39–40 and moves future-politics to 41–43. `ORDER_KIND_COUNT` → 56. This plan uses names only; the numbers appear in this table alone. |
| OrderReason | **29 NoFavour, 30 NotAllowed, 31 TooSoon, 32 Nothing** | after seat-mode's 26–28. Provisional: no other plan claims 29+ at the time of writing. |
| OrderRole | **8 House** (History.dynasties id), **9 Scope** (0 town, 1 region, 2 realm) | existing roles are 0–7 [V contract.ts:1915] |
| DecisionKind, ReignEnd, RevoltCause, GrievanceKind | none | a smitten ruler ends with `ReignEnd.Natural`. The saga learns the cause from the order outcome. No new ReignEnd: future-politics already holds 12–13. |
| RNG streams | `'world-edits'` (ridge noise of the Ridge tool), `'history-deposit-wish'`, `'history-shocks-scheduled'`, and the existing `'history-orders'` for divine draws | each is touched only when its feature is used |

### 0.2 Depends on
- **Nothing unbuilt for the world builder's core** (sculpt, climate, plates, rivers, hearths, deposits).
- **disasters-climate.md** for scheduled disasters (Eruption, Earthquake, Flood, Drought) and for divine Flood and Storm.
  Proxy without it: `shocks/inject.ts` (2.5.3) applies a direct share loss and a regional harvest multiplier through
  the existing `s.harvest[region]` [V population.ts:175]. The disasters plan should later own `injectShock` and call
  its `strikeTown` (their 3.4).
- **seat-mode.md** (orders 10–22, live append, Choice records): divine budget inside seat mode (3.8). It is optional;
  without seat mode, divine works with kinds 0–9 plus the 12 new kinds.
- **perf-efficiency.md P6** (checkpoints): faster divine re-simulation and saved branches. Optional; without it, every
  intervention re-simulates from year 0, as nudges do today [V nudgePanel.ts header].
- **experience-whatif-director-sagas.md**: the `compare` request for "compare with parent branch" (4.6), and the
  director's drama weights for events 380–385 (3.9).
- **beliefs-and-deception.md**: none required. If built, MiracleClaimed can be told through its "beliefs, not truth" lens.
- scenarios-challenges.md (in progress, not readable yet) and a "character mode" (not in any plan I could read): 3.8
  defines the knobs they can set (`DivineOptions` preset, `allowed`, `priceMul`), with no dependency either way.

### 0.3 Amendments asked of other plans
- **disasters-climate**: export `strikeTown(s, dx, id, share, row)` and add a `scheduled` input to `shockYear` (2.5.3).
  The natural schedule stays a function of (seed, world) alone. Scheduled shocks are additive and come from their own
  stream, so their rule "orders cannot change the shocks" still holds for the natural ones.
- **seat-mode**: the Nudge panel's "sandbox" list (kinds 0–9) becomes the *Portents* tier when a divine budget is on
  (priced; 3.2.4).
- **realism-metrics**: the 6.x guard table gains a row for this plan (3.11, 2.12).
- **perf-efficiency**: the P6 checkpoint key includes `worldEditsHash` (a checkpoint of an edited world is not one of
  the base world).
- **historyCache.ts** (in repo): export the `pack`/`unpack` helpers it uses for typed arrays, so saves can reuse them (4.3).

---

## 1. Current behaviour [V]

### 1.1 World generation pipeline (`src/sim/index.ts` `generateWorld`)
`buildGrid(n)` (icosphere, cellCount = 10n² + 2, 23,042 at n = 48) → `worldRng = createRng(seed,'world')` draws
`oceanFraction ∈ U(0.58, 0.72)` and `continentalFraction` → `generatePlates(grid, 'plates', {continentalFraction})` →
`generateElevation(grid, plates, 'elevation', {oceanFraction})` → `generateClimate(grid, elevation, 'climate')` →
`classifyBiomes` → `computeRivers` → `computeLakes`. Every subsystem has its own named stream, "adding draws to one
never shifts another" (index.ts:17).

- **plates.ts**: a noisy-Voronoi flood fill from 12–20 seeds. Per plate: `axis` (unit vector), `speed ∈ U(0.3,1)`,
  `density`, and `continental` flags chosen up to a target area with a per-world `dispersal`. `plateVelocity` is a
  rigid rotation `s · (axis × p)`.
- **elevation.ts** is monolithic. In order: 7 simplex fields drawn first, `riftContinents` (one draw per plate pair,
  "so the stream does not depend on decisions"), crust = blurred plate flag + noise, then the **land mask by quantile of
  crust at `oceanFraction`** (two passes, `closeEnclosedWater`). Next come boundary stress from relative plate
  velocities, propagated tectonic relief (Himalaya/Andes/arc/trench/rift/ridge profiles in radians of arc), composition
  with a coast-distance profile, **erosion inside** (`erode(g, raw, {iterations: 12, k: 0.003·cellScale, diffusion:
  0.015})`), lake basins and lake districts, and last a **hypsometric remap to [−1, 1]** whose land reference is the
  0.995 land quantile. Implications for editing:
  1. Toggling a plate continental does **not** add land by itself. The quantile threshold keeps the ocean share at
     `oceanFraction`, so land moves rather than grows. Sea level must be its own edit (2.2).
  2. Any edit before the remap is renormalised globally: raising one peak shifts the land reference and so every land
     height. That is why sculpt edits apply **after** `generateElevation`, in final units (2.2).
- **erosion.ts**: an implicit stream-power law, h ← (h + f·h_r)/(1 + f) with f = K√A/dx and m = ½, n = 1, after Braun &
  Willett (2013); priority-flood receivers; then hillslope diffusion over all land. It works on any field with sea
  level at 0, so it also runs on normalised elevation.
- **climate.ts**: temperature = latitude + 0.05·fbm − 0.45·elevation (land lapse). Banded winds with fbm perturbation
  and a monsoon term (hops from the sea). Moisture advection is a Jacobi iteration to steady state, `iters = max(80,
  round(3.2·√(N/10)))` = 154 at n = 48, then rainfall = √(rain/RAIN_REF)·jitter. **Non-local**: a new range casts a rain
  shadow downwind.
- **rivers.ts**: priority-flood depression filling with an ε gradient (Barnes, Lehman & Mulla 2014), steepest descent
  on the filled surface (acyclic, ends in the ocean), downstream accumulation of rainfall·area. `computeLakes` keeps
  depressions that are deep and large enough.
- **biomes.ts**: a simplified Whittaker diagram of thresholds on (elevation, temperature, rainfall).
- World stats and invariants: `src/sim/stats.ts` `worldStats` (oceanPct, landmasses, largestLandPct,
  interiorShallowPct, lakePct, biome shares) and `sim.test.ts` (ocean 55–75 %, riverTo chains acyclic and ending at sea,
  flow monotone downstream, lakes < 5 % of land, desert < 50 % of land, no "pale blob" shallow seas, erosion carves
  valleys).

### 1.2 Stage costs [M\*] (`probe/stages.ts`, median of 3, seeds 1/7/42/1234, Node 22, contended VM)
| stage | n = 48 (23,042 cells) | n = 32 (10,242 cells) |
|---|---|---|
| grid | 3–26 ms | 1–6 ms |
| plates | 51–76 ms | 16–48 ms |
| elevation incl. 12 erosion iterations | 165–330 ms | 58–226 ms |
| erosion 12 iterations alone | 43–69 ms | 27–39 ms |
| climate (154 / 101 iterations) | 155–325 ms | 44–102 ms |
| climate setup only (noise, winds; iters = 0) | 56 ms | 20 ms |
| climate at 80 iterations | 93 ms | 41 ms |
| biomes | < 1 ms | < 1 ms |
| rivers + lakes | 5–31 ms | 2–5 ms |
| generateWorld total | 319–716 ms | 176–291 ms |
| `buildTerrain(world)` (history terrain, used by `cradleCount`) | 120–189 ms | 18–23 ms |
| `cradleCount(world)` | 146–164 ms | 32–49 ms |

perf-efficiency.md measured 460–494 ms for world generation at lower load [M there], consistent with these figures.
**Climate is the cost of re-deriving after a sculpt**; elevation is the cost after a plate edit.

Climate convergence [M] (`probe/climIters.ts`, seeds 1 and 42, cold start, against the default 154 iterations):
| iterations | max \|Δrain\| | land cells whose biome changes |
|---|---|---|
| 40 | 0.43–0.67 | 6.6–7.1 % |
| 60 | 0.11–0.25 | 1.4–1.8 % |
| 80 | 0.03–0.04 | 0.17–0.35 % |
| 100 | 0.013–0.021 | 0–0.07 % |

So an **80-iteration preview** is visually exact to within a third of a percent of land. The committed world always uses
the canonical iteration count (2.7).

### 1.3 Hearths, deposits, history set-up
- `HistoryOptions.cradles` [V contract.ts:1462]: one cell per people, −1 = the simulation's choice. The number of
  peoples is fixed by the world (`cradleCount`). `cradleWish.ts` places each wish, moves it to the nearest livable cell
  within `radiusHops`, or rejects it (`CradleOutcome` 0–3). Its draws use `'history-cradles-wish'` only.
  `previewCradles(world, cradles)` predicts the outcome without simulating. Picking is done in `ui/hearthPicker.ts`,
  from the landing page's "Choose where peoples begin" and from the Nudge panel's "Replant the hearths".
- Rare deposits: `goods/deposits.ts placeDeposits` at set-up places 7 internal kinds (placer, lode, silver, gems, amber,
  pearls, murex) with `DEPOSIT.count = [2,3,4,3,2,2,2]`. Each is weighted by a geology score (placer: river cells
  ≤ 4 steps below a Mountain; lode/silver: Mountain within 2 hops of a plate boundary at e ≥ 0.45/0.4; gems: rivers
  ≥ 10 hops from boundaries; amber/pearls/murex: sea coasts by temperature) and kept a spacing apart, drawing from
  `'history-goods'`. DepositKind 6–9 (copper, tin, fine iron, kaolin) exist in the contract but nothing places them at
  this commit.
- Peoples and cradles: `peoples.ts planCradles` (`'history-cradles'`).

### 1.4 Orders (nudges) and their prose
- `OrderKind` 0–9, `Order {year, kind, actor, target?}`, `describeOrderKinds()`, `encodeOrders`/`decodeOrders`
  (`year:key:actor[:target]` joined by `;`, URL `o=`), `orderFeasible(h, order, year)` [V contract.ts:1891–2060].
- `orders/system.ts`: `ordersBegin` (gives the year's orders, runs `check(s, ox, k)`, logs OrderGiven/OrderFailed) →
  system hooks (`orders/hooks.ts`, neutral when not ordered) → `ordersEnd` (OrderFulfilled/OrderFailed/OrderLapsed). The
  orders' own draws come from `'history-orders'`. With no orders, `ox` is null and every hook is a no-op.
- The Nudge panel re-simulates from year 0 on every change and swaps in at the order's year.
- **Sagas already tell orders as omens**: `ui/sagas/omens.ts` has an omen table per kind ("a light stood over the
  {dirAdj} horizon for three nights"), seeded per world and order so every saga tells the same omen, with chronicle
  hedging versus legend fact. Planted hearths are told as "set down by the Divine" (`DIVINE_T`, `divineOrigin`). The
  divine feature extends these tables and does not replace them.

### 1.5 URL and cache
- URL params (main.ts:47–76): `seed`, `sub`, `years`, `year`, view and camera (`lon/lat/az/dist`), `o=`, `c=`, `intro`,
  and many view toggles. `setUrlParam` writes with `replaceState`. A bare URL shows the landing page.
- `historyCache.ts`: IndexedDB `worldseed-cache`. Its key is the sim code version (vite.config.ts hashes `src/sim/**`,
  `contract.ts`, `worker.ts`, `historyCache.ts`) + seed + `stable(worldOptions)` + history options. Typed arrays
  ≥ 4 KB are gzipped. Budget: 24 entries / 200 MB, or a third of `navigator.storage.estimate().quota`. **Entries of
  other code versions are deleted**, so the cache cannot hold saves. All access is best-effort. `hashValue(value)` is an
  FNV-style hash over every field.
- Per perf-efficiency: a cache write of one 2000-year History costs snapshot 213 ms + gzip 890 ms, 34 MB raw → 2.85 MB
  stored [M there].

---

## 2. Feature 1: World builder

### 2.1 The model: an ordered edit list applied to the seed's base world
```ts
// contract.ts (new section after WorldOptions)
// ---------------------------------------------------------------------------
// world edits: the player reshapes the generated world before history starts (WorldOptions.edits), part of the input like
// the seed. Edits are applied in stage order (plates, sea level, sculpt, climate, rivers), in list order within a stage, to
// the seed's base world; the later stages are derived again. Positions are unit vectors (octahedral, 10 bits an axis), so
// an edit list means the same shapes at any subdivision (the result still depends on it, as the world does).

/** What an edit does. Keys are the text form's (encodeWorldEdits). */
export const WorldEditKind = {
  Raise: 0,      // sculpt: lift the ground under the stroke by `amount` at its centre line (elevation units), falling off to 0 at `radius`
  Lower: 1,      // sculpt: the reverse; land pushed below 0 becomes sea (a strait, a bay, an inland sea)
  Ridge: 2,      // sculpt: a mountain range along the stroke (a sharp crest broken into peaks by ridged noise)
  Smooth: 3,     // sculpt: relax toward the neighbours' mean (`amount` in (0, 1] the blend)
  Flatten: 4,    // sculpt: pull toward the height under the stroke's first point (a plateau, a plain)
  Land: 5,       // sculpt: paint land (to just above sea level) or, with amount < 0, sea (to the shelf)
  Channel: 6,    // rivers: carve a valley that descends along the stroke from its first point to its last (a river follows it)
  Spring: 7,     // rivers: extra flow entering at the stroke's first point (`amount` in river-threshold units): an exotic river through dry land
  Wetter: 8,     // climate: rainfall times (1 + amount·w) under the stroke (amount < 0: drier)
  Warmer: 9,     // climate: temperature + amount·w under the stroke (amount < 0: colder)
  PlateMotion: 10, // plates: plate `plate` gets rotation axis `axis` and speed `amount`
  PlateCrust: 11,  // plates: plate `plate` becomes continental (amount 1) or oceanic (0)
  PlatePaint: 12,  // plates: the cells under the stroke join plate `plate` (moves a boundary; plate = plateCount adds a plate)
  SeaLevel: 13,    // global: the ocean share becomes `amount` (0.45..0.85), replacing the seed's draw
  Climate: 14,     // global: whole-world temperature offset `amount` and rainfall factor `amount2`
} as const
export type WorldEditKind = (typeof WorldEditKind)[keyof typeof WorldEditKind]

/** One edit. Only the fields its kind uses are read (see WorldEditKind). */
export interface WorldEdit {
  kind: WorldEditKind
  /** The stroke: unit vectors xyz, 3 per point (1 point for a dab; Spring and PlateMotion use the first only). Quantized on encode. */
  points?: Float32Array
  /** Brush radius in radians of arc (0.01..0.6). */
  radius?: number
  /** Strength; units by kind. */
  amount?: number
  amount2?: number
  /** Plate id (PlateMotion, PlateCrust, PlatePaint). */
  plate?: number
  /** Unit rotation axis (PlateMotion). */
  axis?: [number, number, number]
}

export interface WorldOptions {
  subdivisions?: number
  /**
   * world edits: the player's reshaping of the world, applied to the seed's base world in stage order (WorldEditKind).
   * Default none: undefined or [] gives exactly the world without edits. encodeWorldEdits / decodeWorldEdits give the
   * compact URL text (w=); quantizeWorldEdits the canonical form (what decode(encode(x)) gives), which is what is applied.
   */
  edits?: readonly WorldEdit[]
}

/** What the edits changed, for the builder's report and History (World.edited is absent without edits). */
export interface WorldEditReport {
  /** Per edit (list order): cells it touched (0: it did nothing, e.g. a Channel that never reached lower ground). */
  touched: Int32Array
  /** Channel edits: the cell where the river that follows it reaches the sea or a lake, -1 if it found no outlet. */
  outlet: Int32Array
  /** 1 per cell whose elevation differs from the base world's. */
  changed: Uint8Array
}
// World gains: `edited?: WorldEditReport` (absent without edits, so the world hash of an unedited world is unchanged).
```
Adding `edited` changes nothing for unedited worlds: `history.test.ts` hashes an explicit field list [V per
disasters-climate 2.1, line 29] and the field is absent there.

**History-level edits stay in HistoryOptions**, because they act at history set-up and the world cache key must not
depend on them: `cradles` (existing), `deposits` (new, 2.5.2), `shocks` (new, 2.5.3). The builder UI shows all of these
as one set of tools.

### 2.2 Stages: what re-derives and what is kept
`generateWorld(seed, {subdivisions, edits})`, with edits grouped by stage (list order within a stage):

| # | stage | inputs from edits | what runs | kept from the base world |
|---|---|---|---|---|
| P | plates | PlateMotion, PlateCrust, PlatePaint | the base `generatePlates`, then edits change axis/speed/flag or relabel cells (a new id extends axis/speed/density/continental, with density from `amount2`, default 0.5 continental / 0.8 oceanic) | grid; the seed's plate draws (the plates stream is consumed exactly as today) |
| G | sea level | SeaLevel | replaces `oceanFraction` (continentalFraction is kept) | — |
| E | elevation | — | **re-runs `generateElevation` in full only if stage P or G has edits**. Its 7 noise fields are drawn first from the same stream, so the world keeps its texture; only `riftContinents`' per-pair draws shift when the plate count changes | otherwise the base elevation is reused (cached in the builder session) |
| S | sculpt | Raise, Lower, Ridge, Smooth, Flatten, Land, Channel | the strokes in list order on the **final, normalised** elevation; then a **settle pass**: `erode(g, h, {iterations: 4, k: 0.003·cellScale, diffusion: 0.015, mask})` on the strokes' halo (radius × 1.5); then the lake-basin floor rule for Lower strokes that leave closed depressions | everything outside the halo, bit for bit [M: 0 cells changed outside the mask, `probe/sculpt.ts`, 4 seeds] |
| C | climate | Wetter, Warmer, Climate | `generateClimate` in full, with `dT[]` added to `temp` before the evaporation cap and `rainMul[]` applied to the final rainfall | — (climate is non-local, so it always re-runs after S) |
| R | rivers | Spring | `computeRivers` with `extraFlow[]` added at spring cells before accumulation; `computeLakes` | — |
| B | biomes | — | `classifyBiomes` | — |

Decisions and why:
- **Sculpt after the remap, not before erosion.** Edits before the remap would be renormalised globally (1.1). Edits
  after it, in final units, are local and predictable: "raise by 0.2" means 0.2.
- **No full re-erosion after a sculpt.** Re-running 12 iterations on the whole surface changes every land cell
  (diffusion is global [V erosion.ts step 4]). The masked settle pass gives new mountains valleys without touching the
  rest. Needs a new optional `ErosionOptions.mask?: Uint8Array` ("only cells with mask 1 are lowered or diffused"). It
  is two `if`s in erosion.ts; undefined means today's code path, bit-identical [M: prototype in scratch]. **[A]** `k` was
  tuned on raw heights (land max about 0.2–0.5) while sculpt works in normalised units (up to 1). Step W3 calibrates
  `settleK` so that a Ridge stroke's valleys match the carving depth of natural ranges (sim.test "erosion carves
  valleys": mean −0.02 below neighbours).
- **Plate edits re-run elevation in full**, so boundary stress, mountain belts, trenches and rifts follow the new motion.
  That is the only honest way to "set their motion". Sculpt strokes are deltas, so they re-apply on the new terrain; the
  UI warns when a plate edit comes after strokes (2.8).
- **Climate, rivers, lakes and biomes always re-derive** after any edit. Painted climate is a nudge on top of derived
  climate, not a replacement, so rain shadows and monsoons stay physical.
- **Rivers are always derived**; Channel and Spring are hints that make the derivation go where drawn (2.3).

### 2.3 Tools as formulas
Let the stroke be points p₀…p_m (unit vectors). Densify at apply time to spacing ≤ r/4 by normalised linear
interpolation (`(1−t)a + tb`, then normalise with `sqrt`: deterministic, no trig). For cell i, d_i is the minimum chord
to any densified point, and the weight is `w_i = 1 − smoothstep(0, r, d_i)` for d_i < r (0 beyond). Cells come from a BFS
from the cell nearest p₀ over neighbours with d < r, not a scan of all cells, so a stroke costs O(cells in halo). Points
and cells are visited in index order, so the result is deterministic. Elevation is clamped to [−1, 1] after each stroke.
Defaults below are design defaults [A].

| tool | rule | amount range (default) |
|---|---|---|
| Raise / Lower | e += ±a·w | 0.01–0.4 (0.08) |
| Ridge | e += a·w²·(0.45 + 1.1·r(x)), with r = `ridged(nRidgeEdit, x,y,z, {octaves: 5, frequency: 6, gain: 0.55})` from `createSimplex3(createRng(seed, 'world-edits'))`, the same profile elevation.ts uses for natural belts [V elevation.ts:282] | 0.1–0.6 (0.3) |
| Smooth | two Jacobi passes: e' = (1 − a·w)·e + a·w·mean(neighbours) | 0.1–1 (0.5) |
| Flatten | e += a·w·(e(p₀) − e), with e(p₀) read when the stroke is applied | 0.1–1 (0.6) |
| Land / Sea | e ← e + w·(target − e)·a, target = +0.02 (land) or −0.06 (sea). −0.06 is shallower than the Coast cut (−0.1, BIOME_THRESHOLDS.coastDepth), so painted sea is shallow coastal water; Lower makes it deep | a ∈ (0, 1] |
| Channel | walk the cells nearest the densified points from p₀ to p_m (deduplicated, consecutive). Set `cap_k = min(e_k, cap_{k−1} − δ)` with δ = 0.002, and `e_k ← min(e_k, cap_k − depth·w)` along a 1-cell-wide core plus a w-weighted bank (depth 0.01). Stop at the first sea or lake cell. `outlet` = that cell, or −1 if the walk ends on land with no lower ground | depth 0.005–0.05 |
| Spring | `extraFlow[cell(p₀)] += a` (in units where RIVER_FLOW_THRESHOLD = 6), accumulated downstream like rain | 6–60 (12) |
| Wetter / Drier | `rainMul[i] *= 1 + a·w`; final rainfall = clamp(rain·rainMul, 0, 1) | a ∈ [−0.7, 1] |
| Warmer / Colder | `dT[i] += a·w`, clamp ±0.2 (temperature units, 0 polar to 1 equatorial; about 0.1 ≈ 18° of latitude by the `1 − y²` profile) | a ∈ [−0.2, 0.2] |
| Climate (global) | dT += a everywhere; rainMul *= amount2 | a ∈ ±0.1, amount2 ∈ [0.6, 1.5] |
| PlateMotion | axis ← normalise(axis), speed ← clamp(a, 0, 1.5) | UI: drag an arrow on the plate |
| PlateCrust | continental[p] ← a. With "keep coastline share" off (default on), SeaLevel is auto-added: oceanFraction' = clamp(of ∓ 0.8·size[p]/N, 0.45, 0.85) | — |
| PlatePaint | plate[i] ← p for w_i > 0.5. p = plateCount appends a plate (axis/speed/flag from the edit) | — |

"Remove a plate" is PlatePaint of all its cells into a neighbour; the UI picks the neighbour with the longest shared
boundary. Ids are not compacted: an empty plate is harmless. Elevation never divides by plate size [V], and `plateCount`
keeps the id range valid.

### 2.4 Encoding, size budget, determinism of quantisation
**Text form** `w=` = base64url(deflate-raw(binary)), using the platform's `CompressionStream('deflate-raw')` (WHATWG
Compression Standard; DEFLATE is RFC 1951; Deutsch 1996). Binary layout (all varints are LEB128-style):
```
u8 format (1) | varint editCount | per edit:
  u8 kind | u8 radius (0.01 + q·0.0025 rad) | i8 amount (kind-scaled: amount = q·scale[kind]) | [i8 amount2]
  | [varint plate] | [axis: 2 × u10 oct] | varint pointCount | first point: 2 × u10 oct | then per point: zigzag-varint Δu, Δv
```
Points use **octahedral unit-vector encoding** (Cigolle et al. 2014: projection onto the octahedron with abs and sign
only, no trigonometry, so decoding is engine-independent like grid.ts). 10 bits per axis gives about 0.003 rad, an eighth
of a cell at n = 48. The UI simplifies each stroke with Douglas–Peucker (Douglas & Peucker 1973) at tolerance r/4 before
storing it.

Measured sizes [M] (`probe/encode.ts`, synthetic random-walk strokes plus 12 hearth/deposit items):
| session | binary | deflated | base64url |
|---|---|---|---|
| light: 10 strokes × 6 points | 223 B | 201 B | 268 chars |
| typical: 40 × 8 | 919 B | 619 B | **826 chars** |
| heavy: 150 × 12 | 4,541 B | 2,537 B | 3,383 chars |
| typical, not simplified (40 × 25) | 2,280 B | 1,199 B | 1,599 chars |
| (16-bit points, not simplified, 40 × 25) | 3,611 B | 3,082 B | 4,110 chars |

**Budget:** `w=` ≤ 2 KB in the URL for normal use. The whole URL is capped at 8,000 octets, the request-line length
RFC 9112 §3 recommends every HTTP sender and recipient support (Fielding, Nottingham & Reschke 2022). Above that the
recipe moves to the fragment (4.5); the builder shows a meter ("link: 0.8 of 8 KB"). A hard cap of 400 edits keeps the
undo list and the apply time bounded.

**Canonical form.** The UI never applies an unquantised edit. `commitEdit(e)` stores `quantizeWorldEdits([e])[0]`
(= decode(encode)). The preview, the worker, the URL and a replay therefore all apply the same numbers. Test: for random
edits, `generateWorld(seed, {edits})` equals `generateWorld(seed, {edits: decode(encode(edits))})` bit for bit.

### 2.5 History-level builder tools

#### 2.5.1 Hearths and their peoples (wraps cradleWish)
- The Hearths tool is `ui/hearthPicker.ts` on the builder's globe. It writes `HistoryOptions.cradles` as today (c=).
  The number of peoples comes from `cradleCount(editedWorld)`, re-read after each canonical derive (146–164 ms at n = 48
  [M\*]), because sculpting can change the habitable land. In the probe, raising an island on seed 42 kept 10 peoples
  [M].
- Each hearth shows its people's number and colour; dragging a number onto another hearth swaps which people begins
  there (a permutation of `cradles`). Its outcome comes from `previewCradles(editedWorld, cradles)` (Placed / Moved /
  Rejected, crowded). After an edit sinks a wished cell, the preview shows the move.
- **Starting peoples' traits** (size, language seed, crops) are not in this plan. They would add mechanics; this is a
  later option and an owner question (6.2).

#### 2.5.2 Rare deposits: `HistoryOptions.deposits`
```ts
/** deposit wishes: a rare deposit the player places (HistoryOptions.deposits). */
export interface DepositWish {
  /** Text key: 'placer' | 'lode' | 'silver' | 'gems' | 'amber' | 'pearls' | 'murex' (the geology kinds goods/deposits.ts places). */
  kind: string
  cell: number
}
// HistoryOptions:
  /**
   * deposit wishes: rare deposits the player places, part of the input like the seed. Each is placed where its geology allows
   * (the kind's placement score > 0) on the wished cell, or on the nearest such cell within DEPOSIT_WISH.radiusHops (moved), or
   * rejected; placed wishes count against the kind's number (DEPOSIT.count), the rest are drawn as ever, kept apart from them.
   * Needs goods. Default none: undefined or [] gives exactly the history without wishes. encodeDeposits / decodeDeposits: `kind:cell;...`.
   */
  deposits?: DepositWish[]
// History gains (absent without wishes): depositWish?: { wish: Int32Array; cell: Int32Array; placed: Uint8Array /* CradleOutcome values */; deposit: Int32Array /* History.deposits id or -1 */ }
```
Rule, in `placeDeposits`, before the weighted draws: for each wish in list order, use `score(kind, cell)` [V
deposits.ts:75]. If it is > 0 and the spacing holds, place it; else take the nearest cell with score > 0 within 3 hops
(ties on the lower id); else reject. The kind's draw loop then runs `count − placed` times with the placed cells in the
spacing set. **Draws:** the loop's draws from `'history-goods'` shift when wishes exist (fewer draws, different
weights). That is acceptable because wishes are an input. Off means identical (the branch is not taken). Wish richness
is drawn from `'history-deposit-wish'`, so a wish never changes how rich the drawn deposits are (beyond their cells).
Validation is the same score function, so the builder can grey out cells where a kind cannot occur ("no gold without
mountains upstream"). **Realism guard:** a wish never creates a geologically impossible deposit; that is the point of
reusing the score.

#### 2.5.3 Scheduled disasters: `HistoryOptions.shocks`
```ts
/** A disaster the player schedules (HistoryOptions.shocks); divine Storm and Flood use the same path. */
export interface ScheduledShock {
  year: number
  /** 'eruption' | 'quake' | 'flood' | 'drought' | 'storm' */
  kind: string
  cell: number
  /** Kind-scaled: VEI 5..7, magnitude 7.0..9.0, flood share 0.02..0.15, drought years 3..30, storm harvest loss 0.1..0.3. */
  size: number
}
```
- With disasters-climate built: `shockYear` takes `scheduled` rows of the year and runs them through the same code as
  natural shocks (eruption local effects and volcanic forcing, quake reach `R = L/2 + 40` km with Wells & Coppersmith L,
  flood share, drought as a forced `rPa` below `droughtOn` for `size` years). Rows go to History.disasters with a new
  `scheduled: Uint8Array` column. Any extra draws (sulfur factor, damage splits) come from
  `'history-shocks-scheduled'`; the century streams are untouched. Their grace rule applies: scheduled great shocks
  before `graceYear` are refused with OrderReason.TooSoon, shown in the builder.
- **Proxy without disasters** (`sim/history/shocks/inject.ts`): at the start of the year, every living settlement
  within the kind's reach loses `share` (eruption VEI v: 0.05·(v − 4) in the cell, 0.3× that in ring 1; quake: lerp(0.02,
  0.2, (M − 7)/2) falling off to 0 at R; flood: `size` for river towns of the region; storm: none). The region's
  `s.harvest[r] *= 1 − loss` for the year (eruption 0.15·(v − 4), drought 0.2 each year, storm `size`, flood 0.3). It
  logs nothing new: the existing Famine, Abandoned and Epidemic consequences follow. These proxy numbers are design
  defaults; the disasters plan has the cited ones.
- Warnings in the builder: a great shock on or next to a hearth before year 200 ("this will likely end the Krakinoth
  before they spread").

### 2.6 Validation (computed after each canonical derive; DOM-free `src/sim/worldEditCheck.ts`)
| check | rule | level |
|---|---|---|
| peoples can begin | `cradleCount(world) ≥ 2` | **error**: Start disabled |
| land share | land cells / N within [0.15, 0.60] (natural worlds: 0.25–0.45, from oceanFraction ∈ [0.58, 0.72]) | warn outside; error below 0.03 |
| river sanity | every riverTo chain ends at sea or in a lake; flow monotone | invariant (asserted in tests; can never fail by construction) |
| channels | every Channel has `outlet ≥ 0` | warn "the river you drew ends in a basin" |
| desert / ice | desert < 50 % and ice < 40 % of land (sim.test bounds) | warn |
| interior shallow sea | `interiorShallowPct` (stats.ts) ≤ the max over 22 natural seeds | info ("pale blob" artefact) |
| hearths | per hearth `previewCradles` outcome; a hearth on a landmass of < 30 habitable cells | warn |
| deposits | outcome per wish | info |
| shocks | before graceYear; on a hearth | warn |
| "unusual world" | each worldStats key outside the p5–p95 of natural seeds | info card: "more mountains than any natural world" |

Warnings never block Start. Errors do. Habitability uses `buildTerrain`'s `baseHabitable`, the same set cradleWish uses.

### 2.7 Worker protocol, preview and canonical derive
New worker requests (worker.ts):
```ts
| { type: 'buildBegin'; requestId: number; seed: number; options?: WorldOptions }   // base world + stage caches; answers 'world'
| { type: 'buildEdits'; requestId: number; edits: WorldEdit[]; preview: boolean }    // answers 'buildPreview' (preview) or 'world' (canonical) + 'buildReport'
| { type: 'buildEnd'; requestId: number }                                            // drop the session
// responses
| { type: 'buildPreview'; requestId: number; elevation: Float32Array; temperature: Float32Array; rainfall: Float32Array; biome: Uint8Array; changed: Uint8Array }
| { type: 'buildReport'; requestId: number; report: WorldEditReport; checks: EditCheck[]; peoples: number; cradles: CradlePreview; ms: Record<string, number> }
```
The builder session (`src/sim/worldBuilder.ts`) keeps stage outputs:
- `base` (grid, plates, elevation), held until a P or G edit changes it;
- `afterS` (elevation after strokes), rebuilt by replaying the strokes from `base`. A stroke costs about the cells in its
  halo (a few ms), so undo is "replay from base", with no snapshots;
- `climateNoise`: the elevation-independent parts of generateClimate (the 4 simplex fields' samples, wind before the
  monsoon term, the rain jitter). That is a refactor of generateClimate into `climateSetup(g, rng)` +
  `climateSolve(g, elevation, setup, opts)` with the same arithmetic in the same order, so it stays bit-identical (golden
  test). It saves the 56 ms setup [M] per derive.

Three refresh levels:
1. **During a drag** (main thread, per pointer move, throttled to one frame): apply the stroke to a local copy of
   elevation for the halo cells only. Recompute temperature for those cells as `T_base(i) − 0.45·(e' − e)` on land, and
   their biome with the old rainfall. Push the colours and heights of those vertices. No worker round trip. This is
   exact for elevation and only approximate for climate: no rain shadow yet.
2. **Preview** (worker, 120 ms after the stroke ends): settle pass + `climateSolve` at **80 iterations** + rivers +
   biomes. Biomes differ from canonical on ≤ 0.35 % of land [M]. Badge: "preview".
3. **Canonical** (worker, when idle 600 ms after the last edit, or at Start): the exact `generateWorld(seed, {edits})`
   path (full iterations), the WorldEditReport, the checks, cradleCount. This world is the one that is cached, hashed and
   simulated. The badge clears. **Start always waits for canonical**: preview numbers never reach history.

### 2.8 UI (desktop and touch)
- **Entry**: the landing page gains "Shape this world" under "Choose where peoples begin", and the app gains a Builder
  button (B) shown only at year 0, before any history is viewed past year 0. Opening the builder on a running world
  asks: "Reshaping restarts history from year 0 (your orders are kept)".
- **Layout**: a tool rail (left; a bottom sheet on compact screens, `ui/compact.ts`) with groups:
  - Land: Raise, Lower, Ridge, Smooth, Flatten, Land/Sea
  - Water: Channel, Spring
  - Climate: Wetter/Drier, Warmer/Colder, global sliders
  - Plates: select, motion arrow, crust toggle, paint, add, remove; and Sea level (a slider)
  - Life: Hearths, Deposits
  - Fate: Disasters
  Each group has radius and strength sliders.
- **Overlays**: a view toggle that reuses the existing `ViewMode` palettes (elevation, temperature, rainfall, biomes,
  plates), redrawn live on preview. A diff overlay tints changed cells (`edited.changed`). The plate tool draws the
  existing plate palette (render/palette.ts:338) plus velocity arrows.
- **Desktop**: left drag paints; right drag or Space + drag orbits; wheel zooms; `[` and `]` change the radius; Shift
  inverts the tool (Raise ↔ Lower, Wetter ↔ Drier); Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo; hover shows the brush ring
  projected on the surface; Esc leaves the tool. The keys go through `ui/shortcuts.ts` `addShortcut`.
- **Touch**: one finger paints; two fingers orbit and pinch-zoom (OrbitControls takes two-pointer gestures while a tool
  is active); a long press samples (Flatten target, plate select). Undo/redo are large buttons on the sheet. The brush
  radius has a minimum of 0.03 rad on phones, so a fingertip stroke is not a one-cell scribble. Touch reuses
  `ui/pointer.ts` slop (`TOUCH_PICK_SLOP_PX`).
- **Undo/redo**: the edit list is the model. Undo moves the last edit to a redo stack, redo moves it back, a new edit
  clears redo. A whole drag is one edit (one stroke). "Reset to the seed's world" asks to confirm and is itself undoable.
  The edit list (and the history-level lists) go to the URL on every commit (`w=`, `dep=`, `sh=`, `c=`), so reload keeps
  the work.
- **Plate edits after strokes**: a toast says "Plates changed: your 12 strokes were re-applied on the new terrain".
  Re-apply is automatic; strokes are deltas.
- **Report card** (on canonical): peoples N; land %; checks with icons; "unusual world" notes; link-size meter.
- **Start**: as today (landing Start, or "Begin history" in the app), with the canonical world.

### 2.9 Perf budget
| action | desktop target | phone target (n = 48; phones about 1.5–5× slower: perf and seat-mode plans disagree, README) | from |
|---|---|---|---|
| drag frame (local halo update) | ≤ 4 ms main thread | ≤ 8 ms | halo ≈ 50–500 cells [A]; requires partial vertex-attribute updates of the globe mesh (step W6 measures; if `buildGlobeMesh` cannot update a sub-range, the drag shows a brush-ring decal instead) |
| preview (settle + climate@80 + rivers + biomes) | ≤ 200 ms | ≤ 600 ms | climate@80 93 ms + settle ≈ 20 ms + rivers 5–30 ms [M\*] |
| canonical after a sculpt (no P/G edits) | ≤ 400 ms | ≤ 1.2 s | settle + climate 155–325 + rivers + biomes [M\*]; + cradleCount 150 ms |
| canonical after a plate/sea-level edit | ≤ 800 ms | ≤ 2.5 s | elevation 165–330 + the above [M\*] |
| memory (worker builder session) | +2.5 MB | same | base elevation 92 KB, climate setup fields about 1.3 MB (N × 7 doubles), stroke masks |

If a phone misses the preview budget: preview at n/2? No. The world must not change resolution under the player.
Instead, drop preview to 60 iterations (biomes ≤ 1.8 % off [M]) and lengthen the idle wait for canonical.

### 2.10 Determinism and tests
- `edits` undefined or `[]` → the code path is not taken. Golden world hashes at seeds 1/7/42/1234 are unchanged.
  `ErosionOptions.mask` undefined → bit-identical erosion (test). The climateSetup/solve split → bit-identical (test).
- Same (seed, sub, edits) → bit-identical world, in Node and in the browser worker (a vitest hash test plus the existing
  `cachecheck=1` path).
- Stage order is fixed, not list order across stages: [PlatePaint, Raise] gives the same world as [Raise, PlatePaint].
  This is tested and documented in the WorldEditKind header.
- Quantisation round-trip (2.4). Text round-trip: `decode(encode(x))` is idempotent.
- No trig in apply code (lint rule in the test: `worldEdits.ts` source must not contain `Math.sin|cos|tan|atan|exp|log`
  outside UI files).
- Sculpt locality: cells outside the halo are bit-identical to the base elevation [M].
- Invariants on edited worlds (canned scripts E1–E6, 2.12): the sim.test.ts invariants (chains, flow, lakes, biome
  consistency, typed-array ownership) all pass.
- Cache: `cacheKeys` gets `worldOptions` with `edits` replaced by `hashValue(encodeWorldEdits(edits))`, so keys stay short.
  The history group key then covers edits as well.

### 2.11 Steps (commit-sized; `npm test` and `npm run typecheck` green at each)
- **W1** `contract.ts`: WorldEditKind, WorldEdit, WorldOptions.edits, WorldEditReport, encode/decode/quantize (octahedral
  10-bit, varints, deflate via an injected codec so Node tests use `node:zlib`). Tests: round-trip and idempotence; sizes
  for a canned list.
- **W2** `erosion.ts` mask option; `climate.ts` split into `climateSetup`/`climateSolve` and add `dT`/`rainMul` options;
  `rivers.ts` `extraFlow` option. Tests: all bit-identical without options (golden world hashes).
- **W3** `src/sim/worldEdits.ts`: stroke densify, halo BFS, the tools of 2.3, stage application; `generateWorld` applies
  edits. Tests: locality; stage-order invariance; Channel reaches the sea on a canned world; a Spring makes a river
  through a desert; calibrate `settleK` (Ridge valley depth within ±30 % of the natural mean).
- **W4** plate edits (P stage), SeaLevel, PlateCrust auto sea level. Tests: reversing a plate's motion turns a
  convergent boundary's mountain belt into a rift on seed 42 (sign of mean `tectonic` along that boundary flips); land
  share follows SeaLevel to ±1 %.
- **W5** `worldEditCheck.ts` (2.6) + `worldBuilder.ts` session + worker requests. Tests: checks on canned worlds; preview
  vs canonical biome agreement ≥ 99.5 % at 80 iterations.
- **W6** UI: `ui/builder/builderPanel.ts`, `ui/builder/brush.ts` (pointer, ring, desktop/touch), `render/globe.ts`
  partial attribute update (measure); landing button; URL `w=` (main.ts URL doc block). Manual test on a phone profile.
- **W7** deposits wishes (2.5.2): contract, `placeDeposits` branch, encode `dep=`, builder tool with greyed-out cells.
  Tests: off is identical; a wish on a valid cell is placed; an invalid one is moved or rejected; the count is conserved.
- **W8** shocks (2.5.3): contract, `shocks/inject.ts` proxy, `sh=`, builder Fate tool, warnings. Tests: off is
  identical; a scheduled eruption at a town takes its share in that year; with disasters on, it goes through `shockYear`
  (when that plan exists).
- **W9** stats harness `src/sim/worldEditStats.ts` (2.12) and the realism run.

### 2.12 Harness: `node --experimental-strip-types src/sim/worldEditStats.ts [seeds] [--json] [--history]`
Canned scripts per seed (positions picked from the world, so they are deterministic):
- E1: raise an island from the deepest ocean;
- E2: cut a sea channel through the largest continent;
- E3: a 40°-long Ridge across the largest continent;
- E4: Wetter over the largest desert;
- E5: reverse the largest continental plate's motion;
- E6: PlateCrust on the largest oceanic plate with auto sea level.

| key | target |
|---|---|
| sim.test invariants | all pass, E1–E6 × seeds 1/7/42/1234 |
| elevation changed outside halo (E1–E4) | 0 cells |
| oceanPct | E1–E4: within ±2 points of base; E6: base − 0.8·plate share ± 2 |
| E3 rain shadow | mean rainfall of the 20 % of continent cells leeward of the ridge falls ≥ 10 % (prevailing wind from climate's `wind`) |
| E4 | desert share of that region falls; neighbouring regions' rainfall changes ≤ 5 % |
| E5 | mean `tectonic` on the reversed boundary changes sign |
| stage times | reported; no target on the VM |
| **history realism (`--history`, E1, E3, E5; 2000 y; `realismStats.ts --boot 0`)** | only where meaningful: `zipf2000.zeta` within [0.7, 1.3], `gibrat1500.beta` within [−0.03, 0.03], `pol.largestLand2000` ≤ 0.35, `faith2000.top1` ≤ 0.7 (the baseline is already bimodal). War and epidemic keys are reported but not scored: a sculpted world may rightly differ. |

Probe result to start from [M]: seed 42 with E1-like edits ran 400 years with 87 settlements and 10 peoples, and nobody
reached the remote island in 400 years. Plausible.

---

## 3. Feature 2: Divine intervention with a budget

### 3.1 What stays
**Sandbox** is today's behaviour: free nudges, unlimited, `HistoryOptions.divine` undefined. It stays the default in
v1 and is reachable from the mode switch. Budget mode is a new option. With it off, everything is bit-identical
(no state, no events 380–389, and the new kinds are not offered).

### 3.2 Design

#### 3.2.1 Options and presets
```ts
// contract.ts
/** divine: the player as a god with a budget of favour (HistoryOptions.divine). */
export interface DivineOptions {
  /** 'patron' | 'distant' | 'silent' | 'custom' (DIVINE_PRESETS); the fields below override the preset. */
  preset?: string
  /** Favour at year 0, and the most that can be held. */
  start?: number
  cap?: number
  /** Income weights (per year): base, devotion (per 10,000 devoted people), plight (per 1,000 deaths to famine, plague, war, disaster), peace (per devoted people at peace). */
  income?: { base?: number; devotion?: number; plight?: number; peace?: number }
  /** Price multiplier on every intervention (a difficulty knob). */
  priceMul?: number
  /** Order kinds offered (scenarios, challenges); default all. */
  allowed?: OrderKind[]
}
// HistoryOptions:
  /**
   * divine: the player's orders cost favour, earned over time, from the devotion of peoples who credit the god and from prayers in
   * hard times, and capped; interventions beyond nudges (portents, miracles, smiting, inspiration, prophets, blessings and curses)
   * become available. An order the favour cannot pay for fails (OrderReason.NoFavour) and costs nothing. Peoples credit or blame the
   * god, and too many wonders breed disbelief. Default none: undefined gives exactly the sandbox (free nudges, no favour).
   * encodeDivine / decodeDivine: `div=` text.
   */
  divine?: DivineOptions
```
| preset | start | cap | base | devotion | plight | peace | priceMul | feel |
|---|---|---|---|---|---|---|---|---|
| patron | 120 | 400 | 0.8 | 1.0 | 0.5 | 0.2 | 1 | about one miracle a generation |
| distant | 60 | 250 | 0.4 | 0.6 | 0.3 | 0.1 | 1.25 | a few great acts a millennium |
| silent | 0 | 200 | 0 | 0 | 1.0 | 0 | 1 | the god is heard only when people cry out |
| custom | — | — | — | — | — | — | — | URL fields |

All are design defaults [A], tuned by the harness to the targets in 3.11.

#### 3.2.2 The ledger (in-sim, `sim/history/divine/`, `HistoryState.divine`, null when off)
Per year, in `divineYearEnd(s, dv)` after `ordersEnd`:
```
F ← min(cap, F + income − spent_this_year)
income = base
       + devotionK · Σ_p devotion[p] · pop_p / 10,000 · (1 − doubt)
       + plightK · min(plightMax, D_y / 1,000)  · (Σ_p devotion[p]·pop_p / Σ_p pop_p + plightFloor)
       + peaceK  · Σ_{p devoted, at peace this year} devotion[p] · pop_p / 10,000
```
- `D_y` = deaths this year from famine (population.ts famine losses), epidemics (disease toll), war (war dead), and
  shocks. These are already tallied by their systems; this plan reads the tallies, or adds a one-line accumulator where
  none exists.
- **Why plight earns favour**: religiosity rises after disasters. Bentzen (2019) finds that people near an earthquake
  become more religious shortly afterwards, which she reads as religious coping. Norris & Inglehart (2004) argue more
  generally that existential insecurity sustains religiosity. Turning "prayer in hard times" into income is a game
  abstraction of those findings, not a calibrated quantity. `plightFloor` 0.1 lets a god with no devotees still hear
  some prayers.
- `devotion[p] ∈ [0, 1]` per people starts at 0 (0.3 for peoples whose hearth the player planted: "set down by the
  Divine", reusing the existing story). It decays toward 0 with τ = 80 years (`devotion *= 1 − 1/80` yearly;
  multiplication only). It moves on credit and blame (3.4).
- `doubt ∈ [0, 1]` = smoothstep(R0 = 3, R1 = 8, recent), where `recent` counts interventions (not portents) and decays
  `recent *= 1 − 1/40` per year (3.4).
- Belief by worshippers: if the player founded a faith (Prophet), devotion of its followers has a floor of 0.5 and its
  followers count instead of the people's population. Followers are Σ over settlements of pop · share(faith), already
  tracked by religion (`shareOf`, [V religion/system.ts:85]). This is the "number of worshippers of a player-founded
  faith" income.
- Precedent: Lionhead's *Black & White* (2001) powers miracles from villagers' worship, and its villagers must be fed and
  healed to worship. It is the genre's clearest form of "belief as mana". This plan borrows the loop, not the numbers.

#### 3.2.3 Paying
In `ordersBegin`, for each order of the year with budget on: run the existing `check(s, ox, k)`. If the check fails,
the order fails with that reason and costs nothing. Next, the kind must be in `allowed`, else `NotAllowed`. Then
`price = basePrice[kind] · scopeMul[scope] · (1 + overuse · recent) · priceMul`, rounded to a whole number. If price > F,
the order fails with `NoFavour` (logged OrderFailed, extra = reason). Otherwise `F −= price`, the price is recorded
(`dv.price[k]`), and the order proceeds as usual. **No refund** when the rules later make it fail or lapse: a god's
favour is spent on the asking. The UI says so.

**Prices depend only on the order list**: kind, scope, and `recent`, which is a function of the given years and kinds of
earlier interventions. That makes them exact in the UI before simulating (`divinePrice(orders, k, options)` in
contract.ts, shared with the sim). The balance is exact from `History.divine.favour[year]`. So the UI's "can I afford
it" check is exact, with no estimates.

#### 3.2.4 Price table (favour; design defaults [A], tuned in 3.11)
| tier | kinds (base price) |
|---|---|
| **Portents** (the existing nudges, told as omens already) | Explore 10, Settle 10, Fortify 10, Seat 15, Crop 15, Quarantine 15, Idea 25, Peace 25, War 30, Faith 35; Portent 15 |
| **Miracles** | Bounty 40, Feed 50, Heal 60 |
| **Smiting** | Storm 40, Flood 70, Pestilence 120, Strike 150 |
| **Gifts** | Inspire 90, Bless 80, Curse 80, Prophet 200 |
| scope multipliers (Heal, Feed, Bounty, Storm, Flood) | town ×1, region ×2.5, realm ×4 |
| overuse surcharge | `overuse` = 0.15 per unit of `recent` |
| seat-mode kinds 10–22 in a budgeted seat run | 0 (they are the ruler's own acts, not the god's) |

### 3.3 Interventions → mechanics (each bounded; hooks neutral when absent)
| kind (key) | actor → target | years | effect (formula; bound) | maps onto | fails (reason) |
|---|---|---|---|---|---|
| Portent (`portent`) | polity → Scope 0 good / 1 ill | 10 | good: members' unrest × 0.85 once, overthrow hazard × 0.8 in force. Ill: unrest + 0.06 once, overthrow × 1.3 | the rulers' overthrow term (`rulerYear` hook, as seat-mode's Placate) and unrest | NoActor |
| Heal (`heal`) | settlement → Scope | 0 | every active outbreak (`dz.act`) at the target set ends this year: `actEnd = year`. Set = the town (≤ 1), its weather region's towns (≤ 12, largest first), or its realm's towns (≤ 12) | disease (EpidemicEnded logged by the system's own end rule) | SystemOff (disease off), Nothing (no sickness there) |
| Feed (`feed`) | settlement → Scope | 2 | `local harvest = max(h, 1.0)` for towns in the set: a harvest no worse than an average year. No surplus | population.ts harvest read (one hook line at :175) | Nothing (no famine in the last 2 years and food ≥ 1) |
| Bounty (`bounty`) | settlement → Scope | 5 | harvest × 1.15, capped at the system's max harvest | same hook | — |
| Storm (`storm`) | settlement → Scope | 1 | harvest × 0.8 for the year; each port in the set loses its port with chance 0.15 (`loseStructure`); voyages leaving it this year are lost with chance 0.3 | harvest hook; structures; voyages | — |
| Flood (`flood`) | settlement → Scope | 1 | a ScheduledShock `flood` at the town's cell, size 0.06 (region scope 0.04 each) | 2.5.3 `injectShock` | — |
| Pestilence (`pestilence`) | settlement | 0 | a new epidemic of the world's most virulent crowd disease the people lacks immunity to (plague if a reservoir exists) begins at the town through the system's own entry `strike(s, dz, j, d, epi = −1, src = −1, via)` [V disease/system.ts:124, module-private: export it]; it then spreads by the system's own rules | disease | SystemOff; Nothing (all immune) |
| Strike (`strike`) | polity | 1 | its reigning ruler dies: `R.kill[p] = ReignEnd.Natural`, enacted at the next rulers' year; succession follows the law | rulers (as seat-mode Purge) | SystemOff (rulers off), NoActor |
| Inspire (`inspire`) | people → idea | 0 | if the prerequisites are held and the idea is not, the people conceives it this year at its largest town (the conceive branch of `learnAndConceive` [V ideas/system.ts:395], factored into an exported `conceiveAt(s, ix, q, i, at)`; IdeaConceived); a resisted idea may still be resisted | ideas | as Idea (Prerequisite, AlreadyDone, SystemOff) |
| Prophet (`prophet`) | settlement | 0 | a universal faith is founded at the town (newFaith as foundStep, zeal/org/appeal from `ox.rng`, founding share `FOUNDING.share`), marked as the player's (`dv.faith`). The town must have `pop ≥ FOUNDING.popMin` and not be a holy city; `FOUNDING.max` is respected; at most one prophet per 100 years | religion foundStep (FaithFounded 89) | SystemOff, TooWeak, TooSoon |
| Bless (`bless`) | House | 30 | house vigour + 0.15 (clamped to the founder range) for rulers born or acceding in force; overthrow × 0.7 for its rulers | rulers (vigour regression, overthrow) | SystemOff, NoActor (house gone) |
| Curse (`curse`) | House | 30 | vigour − 0.15; overthrow × 1.4; succession contest chance × 1.3 | same | same |

Abstract content rule: smiting is told as weather, sickness and sudden death, never as gore. The prose is in 3.9.

### 3.4 Consequences: credit, blame, claims, heresy, disbelief (`divine/belief.ts`; draws from `ox.rng` only)
Run at `ordersEnd` for each intervention that took effect this year (a Miracle event 380 was logged):
- **Who notices**: the peoples with a settlement in the target set (the witnesses).
- **Credit** (beneficial: Heal, Feed, Bounty, good Portent, Bless of the witnesses' ruling house, Inspire):
  `devotion[p] += credit · (1 − devotion[p])`, with credit 0.25 (scope town 0.15). If the player's faith exists, its
  share at the struck towns grows: `addShare(rel, id, dv.faith, 0.04 · devotion[p])`, ≤ 0.05 a town a year. Event 381
  Credited at the people's largest town.
- **Blame** (harmful acts on the witnesses: Storm, Flood, Pestilence, Strike of their own ruler, Curse of their house,
  ill Portent): `devotion[p] *= 1 − blame`, blame 0.3. The player's faith share at the struck towns × 0.9 (apostasy).
  Event 382 Blamed. **Fear-credit:** peoples at war with the victims (or rivals with rivalry ≥ 0.5) read it as judgment:
  `devotion += 0.1·(1 − devotion)` for them.
- **Claimed miracles**: if the town's majority faith is another universal faith (not the player's), then with chance
  `pClaim = 0.35 · zeal_f` its clergy claim the wonder: the credit to devotion is halved, and the other faith gains the
  share instead (`addShare(rel, id, f, 0.03)`). Event 383 MiracleClaimed (other = f's holy city, extra = f). This is the
  "prophets claiming your miracles" rule. Weber (1922; Henderson & Parsons translation 1947) puts the validity of
  charisma in its recognition by followers: a charismatic leader must keep proving himself, and if his leadership fails
  to benefit his followers his authority is likely to disappear. A rival clergy that takes the proof takes the
  recognition. Lainer-Vos & Parigi (2014) show how cults of miracle workers kept their charisma by having the Church
  recognise their leaders as saints; claiming is the competitive side of the same market.
- **Heresy**: when the player's faith exists and the god both blesses and curses (or credits and blames) the same people
  within 30 years, then with chance 0.5 the existing `schism(s, rel, dv.faith, p)` [V religion/system.ts:733] splits the
  faith in that people's largest realm. Event 384 Heresy (value = new faith). The player's devotion floor does not apply
  to the schism's followers.
- **Disbelief from overuse**: every new intervention while `doubt > 0.5` has chance `0.3 · doubt` of event 385
  Disbelief at the witnesses' largest town. Their devotion halves, and the wonder "is explained away" in the saga. Its
  effects still happen; only the credit is lost. Belief income is × (1 − doubt) at all times. That overuse turns
  wonders into the ordinary is a design default, with no source. It follows the spirit of Weber's "proof", which needs
  rarity to count as proof, but no study measures it.
- Bounds: devotion ∈ [0, 1]; the player's faith share at a town gains at most +0.05 a year from credit; no rule creates
  or kills people except through existing systems.

### 3.5 Contract additions
```ts
// EventType
  // divine: interventions with a budget (380-389; none when HistoryOptions.divine is undefined). `value` is the order index (History.orders).
  Miracle: 380,        // intervention `value` took effect at `settlement` (the town, or the largest of its set); `other` the related settlement (the house's capital, the new faith's holy city) or -1; `extra` the OrderKind
  Credited: 381,       // a people credited the god for intervention `value`: `settlement` its largest town; `other` -1; `extra` its devotion after, x100
  Blamed: 382,         // ... blamed the god for it; same fields
  MiracleClaimed: 383, // the clergy of faith `extra` claimed intervention `value` at `settlement`; `other` that faith's holy city
  Heresy: 384,         // the player's faith split in the realm of `settlement`'s people after intervention `value`: `other` -1; `extra` the new faith (History.faiths)
  Disbelief: 385,      // the witnesses of intervention `value` explained it away: `settlement` their largest town; `other` -1; `extra` doubt x100
// ORDER_KINDS rows (keys): portent, heal, feed, bounty, storm, flood, pestilence, strike, inspire, prophet, bless, curse (3.3 table: actor/target roles, years, effect sentence)
// OrderReason: NoFavour: 29, NotAllowed: 30, TooSoon: 31, Nothing: 32
// OrderRole: House: 8, Scope: 9
/** divine: the god's ledger (History.divine; absent when HistoryOptions.divine is undefined). */
export interface DivineHistory {
  /** Favour held at the end of each year (index = year, 0..years). */
  favour: Float32Array
  income: Float32Array
  spent: Float32Array
  doubt: Float32Array
  /** Devotion per people per snapshot (P x snapshots, row-major by snapshot). */
  devotion: Float32Array
  /** Price paid per order (History.orders index); NaN when not paid (sandbox kinds in a seat run, failed checks). */
  price: Float32Array
  /** The player's faith (History.faiths), -1 if no prophet was sent. */
  faith: number
}
/** The price of order k of `orders` under `opts` (exactly what the simulation charges). */
export function divinePrice(orders: readonly Order[], k: number, opts: DivineOptions): number
export function encodeDivine(opts: DivineOptions): string   // 'patron' | 'custom,s120,c400,b0.8,d1,p0.5,q0.2,m1,a<keys>'
export function decodeDivine(text: string): DivineOptions | undefined
```
OrderOutcome.product per new kind: Heal the number of outbreaks ended; Prophet the faith id; Strike the ruler id;
Inspire the settlement; others −1.

### 3.6 Params `sim/history/divine/params.ts` (DV; design defaults with a doc comment each)
`credit 0.25, creditTown 0.15, blame 0.3, fearCredit 0.1, devotionTau 80, planted 0.3, faithFloor 0.5, faithGain 0.04,
faithGainMax 0.05, apostasy 0.1, pClaim 0.35, heresyWindow 30, heresyChance 0.5, recentTau 40, doubtR0 3, doubtR1 8,
disbelief 0.3, plightMax 20, plightFloor 0.1, overuse 0.15, prophetGap 100, scopeMul [1, 2.5, 4], scopeCap 12, healHops
3, portentUnrest 0.85/+0.06, portentOverthrow 0.8/1.3, feedFloor 1.0, bountyMul 1.15, stormHarvest 0.8, stormPort 0.15,
stormVoyage 0.3, floodShare 0.06, vigour 0.15, houseOverthrow 0.7/1.4, curseContest 1.3`.

### 3.7 Determinism
- Off (undefined): no `dv`, the new kinds are not decoded (`decodeOrders` already skips unknown keys [V]), no events.
  Bit-identical: golden hashes unchanged.
- On: all new decisions draw from `'history-orders'` and only where an intervention acts, so other streams keep their
  counts. Effects that reuse a system's existing draw (Pestilence's spread, Strike's succession) keep that system's
  draws.
- Prices are a pure function of the order list (3.2.3). The ledger is a pure function of the state. URL replay is one
  run from year 0 with `{orders, divine}`, the same as the live session.
- With P6 or seat live append: an intervention given at year D + 1 changes nothing ≤ D (the order invariant), so
  appending is exact, as seat-mode verified for orders [M there].
- Golden-hash filter for "on vs off" comparisons: drop events 380–385, History.divine, orderOutcomes of the new kinds.

### 3.8 Integration with seat, character and scenario modes
- **Seat mode**: `seat` + `divine` together means the player is a ruler with a patron god. Cards' orders (10–22) are
  free. The god's interventions cost favour. Devotion of the seat's people counts double in income (the ruler's own
  piety). A good Portent or Bless on one's own house is credited by one's own people. A Strike on a rival's ruler is
  told as judgment. The budget is the difficulty knob: preset `patron` = easy, `distant` = normal, `silent` = hard,
  `allowed: []` = "no god" (pure statecraft).
- **Character mode** (not planned yet): the same knobs. A character can be the prophet: Prophet's actor town is their
  town, and devotion is tracked for their faith.
- **Scenarios/challenges** (in progress): a scenario sets `divine` (preset, start, cap, allowed, priceMul) as part of its
  recipe. Challenge goals can read `History.divine` ("found a faith that holds a third of the world by year 1500 with
  favour never below 20"). No dependency in this plan.

### 3.9 UI and prose
- **Mode switch** in the Nudge panel header: Sandbox | Divine (preset). In Divine, a favour bar shows the balance at the
  year shown, income per year, and doubt. The bar is drawn from `History.divine.favour` and is exact.
- **Kind picker**: grouped by tier (Portents, Miracles, Smiting, Gifts), each with its price (exact,
  `divinePrice`) and a scope selector where it applies. Unaffordable kinds are greyed with "needs 60 favour, you will
  have 41 in 1200 (+0.9 a year)". The panel keeps its "pick a place" mode for targets; the House picker reuses the
  rulers panel's houses list.
- **Ledger list** (the orders list in budget mode): each act with price, status, and its consequences (credited by the
  Krakinoth; claimed by the priests of Ashur).
- **Map marks**: reuse `render/nudges.ts` marks with tier icons.
- **Story director**: drama weights (their 2.2 table): Miracle 6 (×2 for Prophet and Strike), MiracleClaimed 5,
  Heresy 6, Disbelief 4, Credited/Blamed ignored (aggregated into Miracle).
- **Chronicle (hedged)** and **Legend (story)** lines, added to `ui/sagas/omens.ts` tables. The existing nudge kinds keep
  their omen tables (they are the Portents tier):
  - Heal. Chronicle: "It is recorded that in 1214 the fever left Ankar within a night; the priests of Ashur claimed it
    for their god." Legend: "The god put out a hand over Ankar, and by morning the sick were asking for bread."
  - Storm. Chronicle: "In 1302 a tempest out of the west sank the fleet at Oru, which the Velani called a judgment."
    Legend: "The sky over Oru went the colour of iron, and the sea rose and took every ship."
  - Strike. Chronicle: "King Harun died suddenly at table in 1350; some said it was the hand of heaven." Legend: "Harun
    was at meat when the god called his name, and he rose and fell and did not rise again."
  - Prophet. Chronicle: "Tradition holds that a shepherd of Mesh began to preach in 1401, saying he had been sent." Legend:
    "In the year 1401 the god spoke to a shepherd of Mesh, and he came down from the hills with a new word."
  - Disbelief. Chronicle: "By then such wonders were common talk, and the Krakinoth said the fever had simply run its
    course." Legend: "But the Krakinoth had seen too many wonders, and they shrugged."
  - Credited. Legend: "And the Krakinoth raised a stone to the god at Ankar." Chronicle: "The Krakinoth, it seems, gave
    thanks."

### 3.10 Steps
- **D1** contract: DivineOptions, DivineHistory, events 380–385, OrderKind rows, OrderReason, OrderRole, `divinePrice`,
  encode/decode. Tests: price determinism; round-trips; unknown keys still skipped.
- **D2** `divine/state.ts`, `divine/ledger.ts` (income, pay at give, NoFavour) with existing kinds 0–9 only. Tests: off
  bit-identical; NoFavour costs nothing; balance never exceeds cap; prices equal `divinePrice`.
- **D3** miracles (Heal, Feed, Bounty) via hooks in disease/system.ts and population.ts. Tests: Heal ends outbreaks at
  the target only; Feed never pushes food above the fed level.
- **D4** smiting (Storm, Flood via `shocks/inject.ts`, Pestilence, Strike). Tests: Strike's ruler ends Natural at the
  next rulers' year; Pestilence is SystemOff with disease off.
- **D5** gifts (Inspire, Prophet, Bless, Curse). Tests: Prophet respects FOUNDING.max and prophetGap; Bless raises the
  next ruler's ability on average over 50 seeds.
- **D6** `divine/belief.ts` consequences (3.4), events 381–385. Tests: credit and blame signs; Heresy only with
  contradictory acts; Disbelief only above doubt 0.5.
- **D7** UI: mode switch, favour bar, priced picker, ledger list, URL `div=`. Sagas: omen tables for 12 kinds and the
  consequence lines.
- **D8** seat integration (free cards, own-people devotion ×2). Harness `divineStats.ts`.

### 3.11 Harness `node --experimental-strip-types src/sim/history/divine/divineStats.ts [seeds] [--preset p] [--bot thrifty|greedy|smiter]`
Bots are scripted policies that generate orders from a History, iterated by re-simulation every 100 years (slow but
exact). **thrifty**: Heal the year's largest epidemic when favour ≥ 2 × price. **greedy**: the most expensive
affordable act every time. **smiter**: Storm and Strike on the largest polity.
| key | target (patron preset, seeds 1/7/42/1234) |
|---|---|
| median years between affordable Miracle-tier acts (thrifty) | 25–60 |
| Fulfilled share of paid acts | ≥ 0.6 |
| Disbelief events per 2000 y | thrifty 0–1; greedy ≥ 2 (overuse must bite) |
| player-faith share at 2000 (greedy with a prophet at 500) | ≤ 0.5 and `faith2000.top1` ≤ 0.7 (do not create monoliths beyond the baseline's bimodality) |
| smiter: largest polity survives with chance | ≥ 0.5 (smiting is bounded, not an "end the empire" button) |
| realism guards with thrifty vs off (realism-metrics 6.x) | `zipf2000.zeta`, `gibrat1500.beta`, `war.alpha` within ±10 %; world pop at 2000 within −10 % |
| ms per year added by the ledger | ≤ 0.05 ms |

---

## 4. Feature 3: World saving

### 4.1 The save: a recipe, plus optional caches
```ts
// src/save/recipe.ts (DOM-free; imports contract.ts only)
/** Everything needed to rebuild a run exactly: the seed and every input, the player's state as checks, and the view. */
export interface SaveRecipe {
  /** Save format; migrations below are keyed by it. */
  format: 1
  id: string                       // random UUID (crypto.randomUUID)
  name: string
  created: number; updated: number; opened: number  // ms since epoch
  /** The engine it was made with: engine = hash of src/sim/** + contract.ts (new vite define __WORLDSEED_ENGINE__); app = git short commit (__WORLDSEED_COMMIT__). */
  engine: string; app: string
  /** Inputs (exactly what the URL carries). */
  seed: number
  world: { subdivisions: number; edits: string /* encodeWorldEdits */ }
  history: {
    years: number
    /** HistoryOptions minus the lists below, canonical (flags only: polities, goods, ...). */
    options: Record<string, boolean | number>
    orders: string            // encodeOrders (all orders: nudges, seat cards' Choice records and orders, divine acts)
    cradles: string           // encodeCradles
    deposits: string; shocks: string
    divine?: string           // encodeDivine
    seat?: string             // encodeSeat (seat-mode)
  }
  /** The player: mode, and state that is derivable (kept as checks, never as inputs). */
  player: { mode: 'watch' | 'sandbox' | 'divine' | 'seat' | 'character' | 'scenario'; favour?: number; seatYear?: number; scenario?: string }
  /** View: not part of the run, not hashed. */
  view: { year: number; lon: number; lat: number; az: number; dist: number; mode: string; map: boolean; select?: string }
  /** Branching. */
  parent?: { id: string; year: number }
  /** Integrity: hashValue of the World and of the History at `years` when saved (historyCache.ts hashValue). */
  check: { world: string; history: string; years: number }
}
export function recipeToUrl(r: SaveRecipe, base: URL): URL       // the same params main.ts reads today, plus w= dep= sh= div=
export function urlToRecipe(u: URL): Omit<SaveRecipe, 'id' | 'name' | 'created' | 'updated' | 'opened' | 'check'>
export function recipeOptions(r: SaveRecipe): { seed: number; world: WorldOptions; history: HistoryOptions }
```
- **The URL is the recipe's link form**. `recipeToUrl` / `urlToRecipe` are inverses on the inputs (test), so a shared
  link, a save and a file describe the same run.
- The favour balance is a **check, not an input**: the ledger is derived from the orders. On load, a mismatch with
  `History.divine.favour[view.year]` is flagged like a hash mismatch.
- **Optional caches** beside the recipe: a thumbnail (WebP ~256 px) and the History blob (packed with historyCache's
  per-typed-array gzip: about 2.4–2.85 MB per 2000 years [M in historyCache.ts header and perf plan]).

### 4.2 Engine versions: policy
Options weighed:
- (a) **Pin**: open old saves in the old engine. That needs every release archived on the static host (GitHub Pages):
  `/<base>/e/<engine>/`. It is possible, but grows the site by one build (~1–2 MB [A]) per engine change.
- (b) **Migrate**: semantic migration is impossible. A different engine gives a different history from the same inputs.
  Only syntax can migrate (renamed order keys, new option defaults).
- (c) **Warn**: replay in the current engine, verify by hash, flag differences.

**Decision for v1: (c) warn + verify, plus syntactic migrations (b, syntax only).** (a) is an owner option for v2 (6.2).
- `engine` is a new narrower hash than the cache's version: `src/sim/**` + `contract.ts` only. UI and worker changes do
  not mark saves old.
- Load flow: `format` migrations (a table `MIGRATIONS[format] = (r) => r'`) → if `engine === current`, replay and
  expect `check.history`, and a mismatch is a bug (logged). If the engine differs, replay. When done: same hash →
  badge "replays exactly in this engine" and quietly re-stamp the engine. Different hash → badge "made with an older
  world engine; this history differs from the one saved" with choices: **Keep this version** (re-stamp engine and hash),
  **View the saved history** (only if a History blob is stored *and* its `contract schema` matches, i.e. the History
  type's field list hash, read-only; otherwise hidden), **Export the original** (the untouched recipe file).
- Orders whose keys the new engine no longer knows are dropped by `decodeOrders` [V]. The badge lists them ("2 orders
  of a kind this engine no longer has were skipped").

### 4.3 Storage
- **A separate IndexedDB database `worldseed-saves`** (version 1; stores `recipes` key id, `thumbs` key id, `blobs` key
  id). It is separate because the cache deletes other-version entries and is LRU-evicted, and saves must never be
  silently lost. Wrapped like historyCache: every call is guarded and timed (`within(p, 1000, fallback)`), and a failure
  degrades to "saves unavailable", never an exception into the app.
- **Budget**: recipes and thumbnails are never evicted automatically (1–20 KB + ~20 KB each [A]). History blobs are
  limited to `min(60 MB, quota/6)`: the cache's own budget is a third of the quota [V], so the two together stay ≤ half.
  Blobs are evicted LRU by `opened`, and the slot keeps its recipe ("this save will re-simulate on open").
  `QuotaExceededError` on a blob write: halve the blob budget, evict, retry once, else drop the blob. On a recipe write:
  evict all blobs and retry; if it still fails, toast "Couldn't save on this device: download the save file instead"
  and offer export.
- **Persistence**: call `navigator.storage.persist()` on the first explicit named save, never on autosave. Firefox
  shows a prompt, while Chromium and Safari decide by engagement without a prompt (MDN, Storage quotas and eviction
  criteria). Show "kept until you delete it" or "may be cleared by the browser" in the gallery footer.
- **Browser eviction facts** (MDN): best-effort data persists while the origin is under quota and the device has space.
  Under pressure, browsers evict whole origins in LRU order, skipping persistent ones. Private modes may use other quotas
  and usually delete data when the session ends. **Safari**: with tracking prevention on, script-written data of an
  origin with no user interaction in the last seven days of Safari use is deleted. Wilander (2020) applies this to
  IndexedDB, LocalStorage and service-worker storage. Home Screen web apps keep their own day count, and WebKit does not
  expect their first-party data to be deleted.
  Consequences: on Safari (detected by UA feature tests, not version), the gallery shows "Safari may clear saves after
  a week away: export a file to keep one safe", and an "Add to Home Screen" hint. Exported files are the durable copy.
- **Private mode / blocked storage**: `indexedDB.open` failing or timing out → saves disabled with a banner. Export,
  import and share-by-link still work.
- **localStorage mirror**: the latest autosave recipe (≤ 20 KB) is also written to localStorage synchronously on
  `pagehide`, because an IndexedDB transaction begun there may not finish. localStorage allows about 5 MiB per origin
  (MDN), plenty for one recipe. On the next start the mirror is copied into IndexedDB if newer.
- Reuse: export `pack`/`unpack` from historyCache.ts (typed arrays ≥ 4 KB gzipped via CompressionStream) for blobs.

### 4.4 Slots, autosave, gallery, thumbnails, Continue
- **Named slots**: "Save" (Ctrl/Cmd+S) asks for a name (default: "<first people> world, year 1240"). "Save as" makes a
  copy. Rename, delete (5 s undo toast), duplicate. All are in the gallery.
- **Autosave**: a ring of 3 autosave slots per run lineage (by root id). Triggers:
  1. after a decision (order given or removed, seat card answered, divine act, builder canonical commit), debounced 2 s;
  2. every 5 minutes of active use if anything changed (view changes do not count);
  3. `visibilitychange` → hidden and `pagehide`, recipe only, plus the localStorage mirror.
  An autosave writes the recipe and thumbnail; the History blob is written only on a named save or if the run took more
  than 20 s to simulate (worth caching), and within budget.
- **Thumbnails**: on save, the main thread renders the current scene once into a 256 × 256 `WebGLRenderTarget` (the app's
  renderer and camera; clouds off), `readPixels`, then flips into an `OffscreenCanvas` and calls `convertToBlob({type:
  'image/webp', quality: 0.8})`. Estimate [A]: 5–15 ms GPU + encode off the main thread; step S4 measures. On phones in
  battery-saver quality (perf P3), the thumbnail uses the current frame's canvas via `drawImage` instead of an extra
  render.
- **Gallery** (`ui/saves/gallery.ts`; the landing page and an app menu): a card grid on desktop and a list on compact
  screens. Each card shows thumbnail, name, seed, year, mode badge (Sandbox / Divine / Seat …), engine badge (current /
  older), size, "kept / may be cleared". Actions: Open, Rename, Duplicate, Delete, Export, Show branches (a tree, 4.6).
  Sort by last opened.
- **Continue** on the landing page: if a save or autosave exists, a primary "Continue: Krakinoth world · 1240 · Divine"
  button above Start. It opens the most recently opened recipe: blob if present and the engine matches, else replay with
  the progress bar. The bare URL still shows the landing page [V main.ts showLanding].

### 4.5 Export, import, share
- **File `.worldseed`** (v1): UTF-8 JSON `{ "worldseed": 1, "recipe": SaveRecipe, "thumb"?: "data:image/webp;base64,..." }`,
  ~2–25 KB. "Include history" (v2) appends the packed History in a binary container (magic `WSEED\0\x02\0`, u32 JSON
  length, JSON, then a typed-array TLV) of ~2.5–3 MB per 2000 years. v1 leaves it out because structured clone is not
  portable as a file and the recipe replays.
- Export: Blob + `<a download>`. On iOS, `navigator.share({files})` where available (feature-tested).
- Import: file input, drag-and-drop on the gallery, or opening a `.worldseed` link. Integrity: replay and compare
  `check.history`, giving the same badges as 4.2 ("verified", "differs: made with an older world engine"). The world
  hash (`check.world`) is checked first; it is cheap (one generateWorld, about 0.5 s) and catches a wrong seed or edits
  before the long replay.
- **Share by link**: `recipeToUrl`. While the whole URL is ≤ 8,000 octets (RFC 9112's recommended minimum request-line
  support), the recipe stays in the query, as today. Above that, the inputs move into the fragment `#r=<base64url(deflate-raw(recipe JSON))>`.
  RFC 3986 §3.5 (Berners-Lee, Fielding & Masinter 2005) separates the fragment before dereferencing and has the user
  agent alone interpret it, so the static host never sees the long part. main.ts reads `#r=` before the query. The
  view params (`year`, camera) stay in the query.
- **Future (no backend now)**: a native Mac/iPad wrapper could store recipes as files in iCloud Drive (the format is
  already a file). CloudKit sync is a later option; no design here, only the constraint that recipes stay small,
  self-describing JSON so any sync layer can carry them.

### 4.6 Branching saves
- "Branch here" (timeline context menu, seat take-back, the divine ledger's "what if I hadn't"): a new recipe with
  `parent = {id, year: Y}`, orders filtered to `year ≤ Y` (an order given at Y + 1 changes nothing ≤ Y [M in
  seat-mode]), and `view.year = Y`. The player then continues. Autosave names it "<parent> · branch at Y".
- Seat-mode take-back (P6): before restoring a checkpoint, autosave the current line as a branch, so nothing is lost.
- What-if pairing: a branch card's "Compare with parent" sends the existing `compare` request
  (experience-whatif 1.4) with ordersB = the parent's orders.
- The gallery shows the lineage as a small tree (root, branches by year). Deleting a parent keeps its children (the
  `parent` link becomes a dangling "branch of a deleted save").

### 4.7 Tests
- **save → load → identical**: in Node, for seeds 1/7/42/1234 with a canned recipe (edits, cradles, 5 orders, divine
  patron), recipe → `recipeOptions` → `generateWorld` + `simulateHistory(years 600)` → `hashValue` equals `check.history`
  written at save. URL round trip: `urlToRecipe(recipeToUrl(r))` equals r's inputs. File round trip: export → import.
- **Version mismatch**: a recipe with `engine = 'old'` and the right hash → "replays exactly" and gets re-stamped; a
  wrong `check.history` → "differs" with the three choices; an unknown order key → listed as skipped; a format-0 recipe
  migrates.
- **Quota full**: the store is behind a `SaveStore` interface (put/get/delete/list/estimate). A memory implementation
  with injectable failures (QuotaExceededError on the nth put, open failure, a never-resolving open) is used in vitest
  without new dependencies: the blob is dropped and the recipe kept; budget halved; open failure → `available = false`
  with no throw; timeout → falls back in ≤ 1 s. The IDB adapter is checked by hand and by a Playwright smoke test (the
  perf plan's preview server).
- Autosave: the debounce and trigger rules (fake timers); the pagehide mirror is written synchronously.

### 4.8 Steps
- **S1** `src/save/recipe.ts` (types, recipeToUrl/urlToRecipe, recipeOptions, migrations) + vite defines `__WORLDSEED_ENGINE__`,
  `__WORLDSEED_COMMIT__`. Tests: round trips.
- **S2** `src/save/store.ts` (SaveStore interface, IDB adapter, memory adapter, budget/eviction) + historyCache `pack`/`unpack`
  export. Tests: quota paths.
- **S3** `src/save/autosave.ts` + main.ts wiring (decision hooks from the Nudge panel, seat, divine, builder), the
  localStorage mirror, and `#r=` fragment reading.
- **S4** thumbnails (`render/thumbnail.ts`; measure), gallery UI, landing Continue.
- **S5** export/import `.worldseed`, verify-by-replay badges, engine policy UI.
- **S6** branches (parent links, timeline "Branch here", tree view, compare-with-parent hook).

---

## 5. Performance and memory summary
- World builder: see 2.9. The worker session costs +2.5 MB. History simulation cost is unchanged by edits (the same
  systems run on a different map).
- Divine: the ledger is O(P + living) a year, ≤ 0.05 ms a year [A], plus `History.divine` ≈ 4 × years × 4 B + P × 401
  × 4 B ≈ 50 KB.
- Saving: a recipe is 1–25 KB. A blob is 2.4–2.85 MB per 2000 years. Writing one costs snapshot 213 ms + gzip 890 ms
  of worker CPU [M perf plan], done off the main thread and only on named saves or expensive runs. Hashing a History for
  `check` (hashValue over ~35 MB): ~50–150 ms [A], in the worker, measured in S1.

## 6. Risks and open questions

### 6.1 Risks
- **Edited worlds outside the tuned envelope.** History parameters were tuned on natural worlds. Extreme sculpts (one
  giant continent, a desert planet) may give odd histories. Mitigations: the validation errors and warnings, and the
  E-script harness with realism guards. This is an accepted risk: odd worlds are part of the fun.
- **Settle-pass calibration** (normalised versus raw units). W3 calibrates it; if valleys look wrong, fall back to
  running the settle pass on a raw-like field (`h · rawScale`, rawScale = the base world's land ref, which is
  recoverable from the remap).
- **Mesh partial updates** may not be cheap in `render/globe.ts`. Fallback: ring decal while dragging, full rebuild on
  preview only.
- **Determinism across engines**: only basic IEEE ops + sqrt in apply code. `fbm`/`ridged` already run the same in Node
  and the browser (world hashes match via `cachecheck`) [V by the existing cache-check design].
- **Divine balance tuning** is design-driven, with no empirical target. The harness gives procedural targets (intervals,
  overuse bites, no monoliths) but "fun" needs play-testing.
- **Abstract smiting** must stay abstract in prose (the content rule in 3.3); a review of the omen tables is part of D7.
- **Safari eviction** can delete saves the player thinks are safe. Mitigation: export prompts and the Home Screen
  hint. The risk is not removable without a backend.
- **OrderKind numbering collision** (0.1) must be settled by the coordinator before D1.

### 6.2 Open questions for the owner
1. Engine pinning: archive each engine build on GitHub Pages (`/e/<engine>/`) so old saves can open in the old engine
   (v2)? It costs site size and a release step.
2. Starting-people traits in the builder (size, crops, language seed): add, or keep hearths as the only "people" control?
3. Divine as the default mode for new players, or keep Sandbox default (this plan: Sandbox default)?
4. Should the world builder be available mid-run (geo-engineering in year 1200)? This plan says no: edits are inputs at
   year 0, and mid-run terrain change would break static terrain caches (`buildTerrain`, catchments), as
   disasters-climate notes for avulsion.
5. `.worldseed` with embedded history (v2 binary container): needed for sharing finished histories with people on
   slow devices?

## 7. Verified / measured / assumed (summary)
- **[V]** pipeline order and streams (index.ts); elevation's quantile land mask, internal erosion, and remap
  (elevation.ts); global diffusion in erode; climate iteration formula; Barnes-style rivers; cradle wishes and
  previewCradles; placeDeposits score and counts; DepositKind 6–9 unplaced; orders flow (check, ordersBegin/End, hooks
  neutral); decodeOrders skips unknown keys; omens.ts tables; historyCache key, budget, version eviction, hashValue;
  ReignEnd values; foundStep, schism, shareOf; disease `act/actEnd`, `strike` entry (system.ts:124); harvest hook at population.ts:175.
- **[M]/[M\*]** stage costs (1.2); climate convergence; edit encoding sizes; masked settle leaves cells outside the halo
  unchanged and keeps chains and flow valid (4 seeds); a sculpted world runs a 400-year history (seed 42: 87
  settlements, 10 peoples, cradleCount unchanged).
- **[A]** all tool strengths, prices, presets, devotion and doubt constants; phone factors; thumbnail cost; hash cost;
  mesh partial-update feasibility; proxy shock numbers.

---

## References
- Bentzen, J. S. (2019). Acts of God? Religiosity and Natural Disasters Across Subnational World Districts. *The Economic
  Journal* 129(622), 2295–2321. https://doi.org/10.1093/ej/uez008 — [verified] (RePEc record: an earthquake nearby
  raises religiosity shortly after; religious coping is the main mechanism).
- Barnes, R., Lehman, C., & Mulla, D. (2014). Priority-Flood: An Optimal Depression-Filling and Watershed-Labeling
  Algorithm for Digital Elevation Models. *Computers & Geosciences*. https://doi.org/10.1016/j.cageo.2013.04.024
  — [verified] for authors, title and DOI (arXiv 1511.04463 abstract page). The journal name is inferred from the DOI
  prefix; volume and pages were not confirmed and are left out.
- Berners-Lee, T., Fielding, R., & Masinter, L. (2005). Uniform Resource Identifier (URI): Generic Syntax. RFC 3986,
  §3.5. https://www.rfc-editor.org/rfc/rfc3986#section-3.5 — [verified] (fragment separated before dereference and
  dereferenced solely by the user agent).
- Braun, J., & Willett, S. D. (2013). A very efficient O(n), implicit and parallel method to solve the stream power
  equation governing fluvial incision and landscape evolution. *Geomorphology* 180–181, 170–179.
  https://doi.org/10.1016/j.geomorph.2012.10.008 — [verified] (record at that DOI path: title, authors, journal,
  volume, pages).
- Cigolle, Z. H., Donow, S., Evangelakos, D., Mara, M., McGuire, M., & Meyer, Q. (2014). A Survey of Efficient
  Representations for Independent Unit Vectors. *Journal of Computer Graphics Techniques* 3(2), 1–30.
  https://jcgt.org/published/0003/02/01/ — [verified] (paper PDF: oct encoding recommended; encode/decode use only abs,
  sign and arithmetic).
- Deutsch, P. (1996). DEFLATE Compressed Data Format Specification version 1.3. RFC 1951.
  https://www.rfc-editor.org/rfc/rfc1951 — [verified] (cited by the WHATWG Compression Standard as the
  `deflate-raw` format; the RFC page itself not opened).
- Douglas, D. H., & Peucker, T. K. (1973). Algorithms for the Reduction of the Number of Points Required to Represent a
  Digitized Line or Its Caricature. *Cartographica* 10(2), 112–122. https://doi.org/10.3138/fm57-6770-u75u-7727 —
  [verified] (bibliographic record).
- Fielding, R., Nottingham, M., & Reschke, J. (Eds.) (2022). HTTP/1.1. RFC 9112, §3.
  https://www.rfc-editor.org/rfc/rfc9112.html — [verified] ("It is RECOMMENDED that all HTTP senders and recipients
  support, at a minimum, request-line lengths of 8000 octets.").
- Lainer-Vos, D., & Parigi, P. (2014). Miracle Making and the Preservation of Charisma. *Social Science History* 38(3–4),
  455–481. https://doi.org/10.1017/ssh.2015.21 — [verified] (Cambridge abstract page).
- Lionhead Studios (2001). *Black & White* (video game). https://en.wikipedia.org/wiki/Black_%26_White_(video_game) —
  [verified] (worship generates the power to cast miracles; villagers must be fed and healed to worship). A precedent,
  not a source of numbers.
- MDN Web Docs (accessed 2026-11-26). Storage quotas and eviction criteria.
  https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria — [verified] (best-effort
  vs persistent; `persist()` prompt behaviour by browser; LRU origin eviction skipping persistent origins; private
  browsing; Safari 7-day proactive eviction; Web Storage 5 MiB).
- Norris, P., & Inglehart, R. (2004). *Sacred and Secular: Religion and Politics Worldwide*. Cambridge University Press.
  https://doi.org/10.1017/CBO9780511791017 — [verified] (Cambridge book page: theory of secularization and existential
  security). Contested in the sociology of religion; used here only as motivation for "plight" income.
- Weber, M. (1922). *Wirtschaft und Gesellschaft*. Tübingen: Mohr. English: *The Theory of Social and Economic
  Organization*, trans. A. M. Henderson & T. Parsons, Free Press, 1947, pp. 358–363. Excerpt:
  https://germanhistory-intersections.org/en/knowledge-and-education/ghis:document-156 — [verified] (recognition by
  followers is decisive for charisma; "if proof of his charismatic qualification fails him for long"; leadership that
  fails to benefit followers likely loses charismatic authority).
- Wells, D. L., & Coppersmith, K. J. (1994), rupture-length regression: cited via disasters-climate.md 3.5 — [unverified
  here] (not re-checked by this plan; owned by that plan).
- WHATWG (living standard). Compression Standard. https://compression.spec.whatwg.org — [verified] (formats deflate,
  deflate-raw, gzip, brotli; deflate-raw = RFC 1951).
- Whittaker, R. H. (1975). *Communities and Ecosystems* (2nd ed.). Macmillan. Named in biomes.ts as the basis of the
  biome diagram — [unverified] (not re-checked: no search budget spent; this plan changes nothing in biomes).
- Wilander, J. (2020, March 24). Full Third-Party Cookie Blocking and More. WebKit blog. https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
  — [verified] (7-day cap on all script-writable storage: IndexedDB, LocalStorage, media keys, SessionStorage, service
  worker registrations and cache; Home Screen web apps keep their own day count, and WebKit does not expect their
  first-party data to be deleted).

## Addendum (central registry)
Renumbered: divine OrderKinds are 71–82 (39–40 tech-tree, 41–58 character, 59–61 migration, 62–64 modern-ideologies, 65–67 future-politics, 68–70 infrastructure); OrderReason 35–38; OrderRole 9 House, 10 Scope. See _CONVENTIONS.md.
