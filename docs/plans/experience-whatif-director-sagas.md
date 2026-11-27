# Plan: What-if comparison, the story director, and partisan sagas (worldseed, UI and presentation)

Status: PLAN ONLY. Written against the read-only checkout `/home/claude/ryanmye/worldseed` at 8cabf09.
Branch suggestion: `experience`. Probes ran on the scratch copy `/home/claude/scratch-whatif` (`probe/diff-probe.ts`,
`probe/spread-probe.ts`, run with `node --experimental-strip-types`, and `--import ./css-register.mjs` for the saga
imports; Node 22.23). The box has 2 cores shared with other agents, so the times are noisy upper bounds.

Tags: **[V]** verified in code (file:function named). **[M]** measured on the scratch copy, or quoted from
`perf-efficiency.md` §1 where it says so. **[A]** assumed, or a design decision not yet checked against code.

**No new simulation events, no sim RNG, no HistoryOptions.** All three features read a finished `History`. The sim's
golden hashes do not move. The one sim-adjacent change is a new worker request (`compare`), which runs
`createHistoryRun` with another order list, exactly as `reorder()` does today. `vite.config.ts` hashes `src/worker.ts`
into the cache version [V worker header, historyCache.ts header], so the first deploy invalidates the IndexedDB cache
once. That is harmless.

Depends on: nothing for the base of every feature. Optional hooks, each with a fallback, are listed in §0:
grudges (190s), finances (210s), families (161–169), city-states (200s), battles (220s, not yet written), beliefs (230s),
society (240s), language (250s), seat mode (270s, checkpoints), and perf-efficiency P6 (checkpoint resume). It can be
built at any point in the assumed order (grudges → finances → families → city-states → new plans). Each feature is
independent of the other two. The one shared module is `ui/story/drama.ts`, the drama score, which the what-if uses to
rank its first differences.

---

## 0. Interfaces with other plans

### 0.1 Story director: every plan's events get a drama rule or an explicit "ignore"
`ui/story/drama.ts` holds `DRAMA: Partial<Record<number, DramaRule>>` and `DRAMA_IGNORED: Set<number>`. A
coverage test enumerates `Object.values(EventType)` at run time. Any type that is in neither set fails the test. So the
first commit of a plan that adds event types must also decide how each type scores. It does this with
`registerDrama(type, rule)` called from its own `*Format.ts`, or by adding the type to `DRAMA_IGNORED`. Because the test
reads the live `EventType`, only types that have been built are required.

Provisional rules, which apply only if the type exists. Base weights are explained in §2.2. The owning plan may override
any of them.

| plan | type (id) | cat | base B | magnitude X |
|---|---|---|---|---|
| grudges | Betrayal (190) | Politics | 7 | peak pop of the betrayed ally |
| grudges | OathBroken (191) | War | 5 | the war's dead at its end |
| grudges | Avenged (192, optional) | War | 5 | — |
| finances | CrownDefault (211), Repudiation (212) | Politics | 5 | the polity's pop |
| finances | WarBankrupt (214) | War | 5 | the war's dead |
| families | FamilyFell (169) | Trade | 3 | — |
| city-states | CommuneProclaimed (201) | Politics | 6 (×1.5 for the world's first) | town pop |
| city-states | SignoriaSeized (202), CharterRevoked (205) | Politics | 4 | town pop |
| beliefs | Coerced (230) | War | 4 | towns ceded × pop |
| beliefs | AllianceRevealed (235) | Politics | 5 | — |
| beliefs | BluffExposed (233) | Politics | 3 | — |
| society | SocialPhase (240) crisis phase only, EliteThinned (246) | Society | 4 | — |
| language | LanguageDied (253) | Culture | 4 | — |
| seat mode | SeatTaken/SeatLost/AmbitionFulfilled (270, 272, 273) | Nudge | 7 | — (plus the focus factor F = 1.5, §2.3) |
| battles | 220–229 | War | **must register** | battle dead (their `value`/`extra` semantics) |

The battles plan was not readable when this was written. Until it registers its types, ids 220–229 fall back to
`{ cat: War, base: 4, mag: none }` through a range rule (`rangeDrama(220, 229, …)`) so the coverage test passes. That
fallback must be replaced when battles lands.

### 0.2 What-if: checkpoint resume (perf-efficiency P6, seat mode)
- `perf-efficiency.md` P6 proposes `checkpoint()` / `createRunnerFrom(world, options, checkpoint)`, valid when the new
  order list *extends* the checkpoint's list. The compare request (§1.4) uses it whenever B's list is such an extension
  of a checkpoint in the worker's ladder: B = the shown orders plus a draft, or the orders minus the *last* one,
  resumed from a checkpoint taken before that order's year (P6 step 5 says that is allowed). Otherwise it runs from
  year 0. The fallback is today's path: a full run, 5.6–7.1 s for a nudge in Node [M perf §0.3].
- Seat mode's `HistoryRun.addOrders` and its checkpoints ("take a decision back") give the same thing for "what if I
  had picked the other card". The compare request takes a `resumeFrom?: CheckpointRef` once either plan provides one.
  Nothing else here depends on it.

### 0.3 Partisan sagas and beliefs-and-deception (230s)
The beliefs plan (§3.11, §5.1) provides `beliefAt(pd, k, year) → { est, sd, src }`, `truthAt(pd, t, year)`,
`Wars.believed / actual / motive`, `Bonds.known`, and the Deterred event (231) with `extra` 1 when the other side was
bluffing. A partisan chronicle reads those through one adapter, `PartisanFacts` (§3.5). With beliefs present, the
chronicle reports what its people's court believed. Without beliefs, the adapter returns the truth and only the
rhetorical distortions of §3.3 apply. Nothing is asked of the beliefs plan beyond what it already exports. One request:
`beliefAt` must not throw for `k = -1` (no row), and should return null.

### 0.4 grudges-and-oaths
The stance function (§3.2) uses `standingGrudges(pd, p, year)` [grudges §3.9] for the Foe test when it exists. The
proxy is the wars between the two lineages in the last 150 years. The partisan "betrayal" reframe of a lost war uses
Betrayal (190) when it exists.

---

## 1. Feature 1: What-if comparison

### 1.1 Current behaviour [V]
- `main.ts requestOrders(orders, keepYear)` (~line 502) canonicalises the list, posts
  `{ type: 'orders', requestId, orders, years, cradles }`, and labels the progress "Simulating with N orders…".
- `worker.ts reorder()` builds a new `kept` with `run: null`. It then reads the cache under the new options' keys, or
  calls `simulateAndPost`, which runs `createHistoryRun(world, options)` from year 0. The result is posted with
  `replace: true` and its arrays are **transferred**, so after posting the worker no longer holds the History. A newer
  request skips a queued orders request (`latestRequestId`).
- `main.ts onWorkerMessage`: `replace` → `historyView.replaceHistory(h, ms, resimYear)`. This restages every index and
  GPU layer while the old ones draw, then swaps (historyView.ts header; `replaceHistory` ~line 1298).
- There is one History on the main thread. Everything (indexes, PolitiesData, layers, panels) is built per History.
- Sagas (`ui/sagas/index.ts generateSaga(h, world, subject, legend, year)`) are pure functions of a History. They are
  cached per History in a WeakMap. `Ctx` (`facts.ts`) builds `politiesOf`, `rulersOf`, `faithsOf` and `sagaIndexOf`.
- `ui/landmarksFormat.ts` and `ui/renamingFormat.ts` import CSS. Node cannot load the saga modules without a CSS
  stub [M: `ERR_UNKNOWN_FILE_EXTENSION ".css"` from landmarks.css]. Vitest (vite) handles it. **Do not import sagas
  into the worker.** The design below keeps the worker to DOM-free and CSS-free modules.

### 1.2 Baseline measurements [M]
Fortify at year 800 on the town that was largest that year, against the run without orders, 2000 years
(`diff-probe.ts`, `spread-probe.ts`):

| seed | outcome | divergence year | settlement-id prefix kept | settlements matched by (cell, people) | polities A/B | wars A/B |
|---|---|---|---|---|---|---|
| 1 | Failed, AlreadyDone (walls up) | **none: bit-identical events** | 1284 / 1284 | all | 70 / 70 | 119 / 119 |
| 7 | Failed, AlreadyDone | **none** | 1143 / 1143 | all | 83 / 83 | 111 / 111 |
| 42 | Fulfilled (walls) | 800 | 535 of 1182 / 1199 | 791 (67%) | 85 / 76 | 116 / 110 |
| 1234 | Fulfilled | 800 | 649 of 1462 / 1450 | 964 (66%) | 69 / 92 | 90 / 120 |

Share of geo-keyed events (type, year, settlement cell) found in both runs, per century from the order's
(`spread-probe.ts`):

| seed | 800s | 900s | 1000s | 1100s | 1200s–1900s |
|---|---|---|---|---|---|
| 42 | 0.62 | 0.08 | 0.08 | 0.05 | 0.01–0.06 |
| 1234 | 0.99 | 0.88 | 0.17 | 0.09 | 0.02–0.07 |

**The sim shows sensitive dependence on small perturbations** (the "butterfly effect": Lorenz 1963; Lorenz 1972). One
fulfilled nudge leaves the two worlds sharing well under 10% of their events within one to two centuries. *Correction
(citation audit): an earlier draft said "chaotic in the strict sense". Two perturbation runs do not show that. Chaos in
the strict sense (Devaney 1989) also needs topological transitivity and dense periodic orbits (with those two,
sensitivity follows: Banks et al. 1992), and a finite-state deterministic sim cannot be tested for them this way. The
design consequences below rest only on the measured sensitivity.* The peoples' sizes are much more robust, because geography sets them. At year 2000,
per-people population differed by +1% to +28% on seed 42, and by −60% to +102% on seed 1234. 11 of the 20 peoples were
within ±10%. The design consequences:
1. A failed order changes nothing. The UI must say so ("Without this order the world would be the same: it failed in
   800 because the walls were already up"). It must not show a spurious comparison.
2. "Butterfly chain" (after Lorenz 1972) is honest only for the first decades near the nudge. After that, the other world is another draw
   of the same world, and its differences are not effects of the order in any fine-grained causal sense. The text says
   "in the world without it, …", never "your order caused …", for anything past the causal window (§1.6).
3. Matching after divergence must be by geography, not by id. Ids diverge at the first differing founding.

Sizes: a 2000-year History is 34.0–38.4 MB of typed arrays [M]. That agrees with perf §1.2 (35–39.5 MB). The largest
fields are landUse, degradation, road, crop, herd and cash at 2.33 MB each; population, food, wealth and
merchantWealth at 1.9–2.35 MB each; territory 1.54–1.80, priceIndex 1.19–1.47, longHaulVolume 1.06–1.23, polity
0.95–1.17. There are 401 snapshots, 101 land snapshots, 7,635–8,912 land cells and 23,042 cells. The world saga of the
nudged run took 227–401 ms in Node, and a state saga 10–13 ms [M, contended].

### 1.3 Design overview
```
 main: Nudge panel "What if not?" ─► requestCompare(ordersB) ─► worker 'compare'
 worker: fpA = kept.fp (computed when A was posted) ; run B (own run, chunked, cancellable; cache read/write)
         fpB = fingerprintOf(B) ; digest = diffFingerprints(fpA, fpB)
         post { digest, alt: B (full) | skeletonOf(B) (lite) }  (B's arrays transferred)
 main:   CompareView: Ctx(A) full, Ctx(B), digest ─► divergence timeline, lists, whatif saga, swipe layer (lazy)
```
- **A** is the History shown, with the player's orders. **B** is the alternative: by default A's orders minus one, or
  minus all of them. The general case is any list, including a draft order not yet urged ("What if instead…").
- The fingerprints and the digest are computed in the worker, so the main thread never holds a second large structure
  it does not need. They are struct-of-arrays and DOM-free (`src/whatif/fingerprint.ts`, `src/whatif/diff.ts`, which
  import only `contract.ts`).
- The prose and the ranking use Ctx (sagas, drama) and run on the main thread, which holds A in full and B as full or
  skeleton (§1.7).

### 1.4 Worker: the `compare` request
```ts
// WorkerRequest
| {
    /** Simulate the kept world with `orders` (and `cradles`) beside the history shown, `years` long, and post how the two differ (a `compare` response). The kept run is not replaced. */
    type: 'compare'
    requestId: number
    /** Echoed; a newer compare (or any generate/orders) cancels this one between chunks. */
    compareId: number
    orders: Order[]
    cradles?: number[]
    years: number
    /** Post a skeleton of the other history (phones, weak devices: §1.7) instead of the whole. */
    lite: boolean
  }
// WorkerResponse
| { type: 'compare'; requestId: number; compareId: number; digest: WhatIfDigest; alt: History; skeleton: boolean; ms: number; cached: boolean }
| { type: 'compareProgress'; requestId: number; compareId: number; years: number; target: number }
```
Rules:
- `Kept` gains `fp: HistoryFingerprint | null`. `simulateAndPost` and the two cache-hit paths compute
  `fingerprintOf(history)` **before** transferring, and store it on `kept`. The estimated cost is 10–30 ms per
  2000-year History [A; target in §1.10]. An extension replaces it.
- B gets its **own** `createHistoryRun(world, optionsB)`. `kept.run` is untouched, so extensions of A still resume.
  B is stepped in `PROGRESS_CHUNK_YEARS` chunks. After each chunk it posts `compareProgress` and **re-enqueues itself**
  on `queue`, so an `extend` of A can run between chunks and playback near the end is not held for the whole compare.
  Cancellation: before each chunk, `if (compareId !== latestCompareId || requestId !== latestRequestId) return`.
- Cache: B is a valid history of its options. It is read from the cache under `cacheKeys(…, optionsB)` when present,
  and written after it is simulated, so "Adopt the other world" (§1.8) is then an instant cache hit through `reorder`.
- With P6 or seat checkpoints available (§0.2), B resumes from the latest valid checkpoint.
- Memory in the worker during a compare: B's live run 28.6–40.9 MB [M perf §1.2] and B's History 34–39 MB [M] at
  assembly. Both are freed after posting, because the History is transferred and the run is dropped. That is a peak of
  about +75 MB on top of the kept run's 41 MB. With `lite`, the worker sets `kept.run = null` before starting B. The
  next extension of A then re-simulates from the cache's longest entry or from 0, which trades time for a ~41 MB lower
  peak. **[A]** This needs a real-phone check (§1.12).
- Equivalence: B's History must be bit-identical to what `reorder` would produce for the same options. A test checks
  `hashValue` of the two (§1.11, test 7).

### 1.5 The fingerprint (struct-of-arrays) — `src/whatif/fingerprint.ts`
```ts
/**
 * What the comparison of two histories needs of each, struct-of-arrays and small (well under 1 MB for 2000 years), built
 * in the worker before a History's arrays are transferred away. Settlement ids are kept for the shared prefix only:
 * after the first differing founding the two runs number their towns differently, so everything here that must be
 * matched across runs is keyed by geography (cells), not ids.
 */
export interface HistoryFingerprint {
  years: number
  snapshotInterval: number
  /** Events in chronological order, order events (170-179) and cradle events (180) left out. */
  evCount: number
  evYear: Int16Array
  evType: Uint16Array
  /** Index of the event in History.events (for the main thread to look it up in its own copy). */
  evIndex: Int32Array
  /** Geo hash of the event: type, year, the cell of `settlement`, the cell of `other` when it is a settlement (per type, EVENT_FIELDS), and its quantities rounded; never an entity id (war, polity, ruler ids shift after divergence). */
  evHash: Uint32Array
  /** Cell of the event's settlement (-1 none). */
  evCell: Int32Array
  /** Settlements: cell, people, founded, abandoned (-1), peak population. */
  sCell: Int32Array; sPeople: Int16Array; sFounded: Int16Array; sAbandoned: Int16Array; sPeak: Float32Array
  /** Per checkpoint (every CHECK_YEARS = 50 years, from 0) per people: population, land cells held by states of that people, settlements alive. Row-major [k * peoples + p]. */
  checkYears: Int16Array
  peoplePop: Float32Array; peopleLand: Uint32Array; peopleTowns: Uint16Array
  /** Polities: founded, ended (-1), people, the founding capital's cell, peak population and its year, the land snapshot of its peak extent, and a MinHash (MINHASH_K = 8 lanes) of its land cells (held and claimed) there. */
  pFounded: Int16Array; pEnded: Int16Array; pPeople: Int16Array; pCapCell: Int32Array
  pPeak: Float32Array; pPeakYear: Int16Array; pMinhash: Uint32Array
  /** Faiths: founded, the holy city's cell, the founding people, peak followers (share-weighted population). */
  fFounded: Int16Array; fHolyCell: Int32Array; fPeople: Int16Array; fPeak: Float32Array
  /** Wars: start, end, attacker and defender polity ids (this run's), dead, outcome. */
  wStart: Int16Array; wEnd: Int16Array; wA: Int16Array; wD: Int16Array; wDead: Float32Array; wOutcome: Uint8Array
  /** Great epidemics (EventType.GreatEpidemic): year, origin cell, disease id, share dead (EpidemicEnded extra, -1 open). */
  gYear: Int16Array; gCell: Int32Array; gDisease: Int16Array; gShare: Float32Array
}
```
- `EVENT_FIELDS: Uint8Array` per type, with flags `OTHER_IS_SETTLEMENT`, `VALUE_IS_QTY`, `EXTRA_IS_QTY`. It is built
  from the EventType comments. The UI already has the predicates (`goodsOtherIsSettlement`, `diseaseOtherIsSettlement`,
  `tourismOtherIsSettlement`, `ideasOtherIsSettlement`, `rulersOtherIsSettlement`, imported by historyIndex.ts [V]).
  Check that their modules are CSS-free before importing them into the worker. If they are not, copy the table into
  `src/whatif/eventFields.ts` with a test that it agrees with them on every type. A type absent from the table hashes
  only (type, year, cell). That is conservative: it can under-report a difference, but it never invents one.
- Quantities are rounded before hashing (`Math.round(v * 1000)` for fractions, `Math.round(v)` for counts), so float
  noise cannot split equal events. The sim is deterministic, so this is belt and braces.
- Hash: FNV-1a over 32-bit words, with `Math.imul` (FNV-1a 32-bit: offset basis 2166136261, prime 16777619; Noll et al.
  2026). Note that the standard FNV-1a consumes one octet per step; a word-at-a-time variant is a design choice and
  hashes differ from reference FNV-1a outputs, which is fine because the hash is only compared with itself.
- The peak-extent MinHash needs one pass over `territory` per land snapshot to find each polity's peak (101 × ~9k cell
  reads, ≈ 0.9 M operations) and then one pass at each needed snapshot. Owner =
  `polity[snap(q) * N + (territory[q * L + k] - 1)]`.
- Estimated size for seed 1234: 15.8k events × 16 B ≈ 0.25 MB; 1.46k settlements × 18 B ≈ 26 KB; 41 checks × 10 peoples
  × 10 B = 4 KB; polities, faiths, wars and epidemics < 20 KB. Total ≈ 0.3 MB [A, arithmetic on measured counts].

### 1.6 The diff — `src/whatif/diff.ts`
```ts
export interface WhatIfDigest {
  /** First year whose events differ (multisets of evHash per year), -1 when the two are the same throughout (a failed order). */
  divergence: number
  /** Per decade from 0: share of geo-keyed events in both, 0..1 (|A ∩ B| / max(|A|, |B|), multiset). */
  similarity: Float32Array
  /** Up to 200 events of each history in [divergence, divergence + CAUSAL_YEARS] that the other has not (History.events indices); ranked on the main thread (drama). */
  firstA: Int32Array; firstB: Int32Array
  /** Settlement match: for each settlement of B, the matched settlement of A or -1 (ids below `prefix` map to themselves). */
  prefix: number
  sMatch: Int32Array
  /** Polity match: for each polity of B, the matched polity of A or -1, and the match score. */
  pMatch: Int16Array; pScore: Float32Array
  /** Faith match (B → A), war match (B → A). */
  fMatch: Int16Array; wMatch: Int32Array
  /** The year compared at (the end of both runs) and the checkpoints, as in the fingerprints. */
  years: number
}
```
Algorithm, O(E log E_year + P_A·P_B):
1. **Divergence.** Walk the years in order. For each year, take the evHash run of each side, sort a copy (typed-array
   sort), and compare. The first year whose runs differ is the divergence year. Equal runs move on with no allocation
   beyond the two subarray copies.
2. **Similarity per decade.** Merge the sorted runs of the decade and count equal hashes. This is the curve the
   timeline draws (§1.8). It is what makes the chaos visible: "the worlds stay alike for 60 years, then part".
3. **First differences.** Within the causal window, `CAUSAL_YEARS = 40` (default, tuned by the harness), multiset
   difference by hash. List up to 200 per side. The main thread ranks them by drama score S0 (§2.2) and by distance to
   the order's place: chord ≤ 0.4 is "near the nudge", and those rank first.
4. **Settlement matching.** Ids below `prefix` (the first differing founding) map to themselves. After that, match by
   key (cell, people) to the candidate with the nearest `sFounded` within ±50 years. Measured: 66–67% of all
   settlements match by (cell, people) [M]. An unmatched B town is "only in the other world".
5. **Polity matching.** Candidates must have the same people. Score =
   `0.6·J(minhash) + 0.25·[same founding capital cell, or capitals matched by step 4] + 0.15·exp(−|ΔfoundedYear|/100)`,
   where J is the estimated Jaccard index (Jaccard 1901) of the peak-extent land sets: the share of matching MinHash
   lanes, 8 independent min-hashes (the k-permutation estimator, Broder 2000). With 8 lanes the estimate moves in
   steps of 1/8 and has standard error √(J(1−J)/8), up to ≈0.18 [C: binomial]. The weights 0.6/0.25/0.15, the
   100-year scale and the threshold are design defaults. Greedy assignment in order of score, threshold 0.35 [A]. Polity names come from the capital's language and can coincide, so name
   equality is **not** used; the UI shows both names.
6. **Faiths:** match by holy-city cell and founding people, |Δfounded| ≤ 150. **Wars:** match by matched attacker and
   defender with |Δstart| ≤ 10. **Epidemics:** by disease id, origin cell chord ≤ 0.3, |Δyear| ≤ 20.

**Consequences** (ranked on the main thread, `ui/whatif/consequences.ts`, at the year compared T, by default the end):
- Polities only in one world: weight = peak pop × ln(1 + lifespan). Top 4 per side.
- Matched polities whose peak or end differs a lot: |ln(peakB/peakA)| ≥ 0.5, or alive in one world and ended in the
  other at T.
- Peoples: `r = ln(popB/popA)` at T. Reported when |r| ≥ ρ (ρ = 0.2 [A], to be set from the noise floor in §1.10). The
  same test applies to land held by states of that people, and to the number of towns.
- Faiths only in one world (weight: peak followers). The state religion of matched Kingdom-tier-or-larger polities at
  T, where it differs.
- Wars only in one world with dead ≥ 3000 (the naming threshold of `sagas/wars.ts` [V]). Top 3 per side.
- Great epidemics only in one world.
- Each item carries both worlds' ids, so the UI can say "the Kingdom of Vashtar (in the other world, the Empire of
  Vashtar)".

### 1.7 Memory tiers on the main thread
| tier | when | alt posted | what it allows | extra main-thread memory |
|---|---|---|---|---|
| full | `!device.phone && !device.weak` (`render/device.ts detectDevice` [V]) | the whole B History | whatif saga at any year, alt PolitiesData, swipe layer, optional "read the other world's sagas" | +34–39 MB of typed arrays [M], plus alt PolitiesData and the polity layer's textures (≈ 1–2 MB [A]) |
| lite | phone or weak | `skeletonOf(B)` | whatif saga, swipe layer (Political/Tint views only) | ≈ 8–10 MB [A, sum of the measured field sizes below] |

`src/whatif/skeleton.ts`, `skeletonOf(h): History`, is a shallow copy. These fields are kept: events, settlements,
population, polities, polity, landCells, territory, claimed, wars, bonds, embargoes (small), rulers, dynasties,
reignOffsets, reignIds, marriages, unions, successionWars, faiths, faith, faithShare, stateFaith, holyWars, landmarks,
renamings, peoples, structures, capacity, epidemics, diseases, orders, orderOutcomes, features, and the counts and
intervals. Every other typed array is replaced by an empty array of the same type: landUse, degradation, road, crop,
herd, cash, food, wealth, merchantWealth, priceIndex, longHaulVolume, tradeVolume, knownYear, contactYear, technology,
danger, tariff and the rest of goods, tourism, fever and so on.
- Kept, measured: territory 1.8, population 2.35, polity 1.17, claimed ~0.9 MB [M seed 1234], plus events (~16k objects,
  ~1.3 MB heap [A]) and small tables.
- A skeleton is never handed to `historyView`. Only `politiesOf`, `rulersOf`, `faithsOf`, `Ctx`,
  `buildPolityLayer` and the whatif generator see it. A test runs exactly those on a skeleton and checks that the output
  has no NaN and no `{slot}` (§1.11, test 5).
- Disposal: closing the comparison drops the alt History, its PolitiesData and its layer (`dispose()`). A new A
  (reorder, extend) marks the digest stale ("compared at year 2000; the history now runs to 2400 — Compare again").

### 1.8 UI
**Entry points.**
- Nudge panel (`nudgePanel.ts`): each order row gets **What if not?**, which compares with the list minus that order.
  The list head gets **Compare with no orders**. The order form gets **What if instead…**, which compares with the
  list plus the drafted order without urging it.
- A compare panel `ui/whatifPanel.ts` (right column accordion, like Nudge; shortcut **W**, which is free [V shortcuts
  in use: a–g, i–v, x–z]).
- URL: `cmp=<encodeOrders(B)>`, with `cmp=-` for "no orders", so a link reopens the comparison. It is cleared with a
  new seed, like `o=`.

**Panel contents, top to bottom.**
1. Header: "The world without *Fortify Oruma (800)*". When `divergence < 0`: "Without this order the world would be
   the same: {orderStory}" (nudgeFormat.ts `orderStory` [V]), and nothing else.
2. **Divergence timeline** (canvas, 56 px; 72 px on desktop):
   - x is years 0…T. The similarity curve is a filled area: grey up to the divergence year, then the accent colour as
     it falls.
   - A notch marks the divergence year.
   - Above the axis, ticks for A's top-8 drama entries after divergence; below it, B's. Matched pairs (by polity or war
     match) are joined by a faint line.
   - Click or tap sets the timeline year (and, in swipe mode, both worlds show it).
3. **What changed first** (the causal window): up to 3 lines per side, ranked as in §1.6 step 3, in the chronicle
   wording (`describeEvent` [V format.ts:367]). Lines near the nudge are tagged "near Oruma".
4. **What came of it by {T}** (the long divergence), under the heading "The worlds part" and introduced by a fixed
   caution: "After {k} years the two worlds share fewer than one event in ten. What follows are differences, not
   effects."
   - Polities only here or only there, people deltas as diverging bars (|r| ≥ ρ), faiths, the great wars, plagues.
   - Each row has "show" (flies to the place and sets the year).
5. **In the world without your order…**: the whatif saga (§1.9) with the Chronicle/Legend switch, Copy, and
   Download .md.
6. Buttons:
   - **Swipe** (toggle the swipe globe).
   - **Adopt the other world**: `requestOrders(B)`, which is a cache hit, so the swap is instant [V the cache written
     in §1.4].
   - **Close**.

**Swipe globe** (one camera, one render).
- The polity overlay of A and an alt `PolityLayer` built from B (`buildPolityLayer(world, B, politiesOf(B))` [V
  render/polities.ts:759]) are both drawn. Each is clipped at a screen-space divider by a new uniform `uClip: vec3`
  (divider x in device px, side ±1, enabled 0/1) tested on `gl_FragCoord.x` in the overlay fragment shader. The same
  uniform goes into the settlement marker shader (`render/settlements.ts`). A's markers draw left of the divider and
  B's capitals (stars from its polity layer) right of it.
- Labels (`render/labels.ts`, a full-window 2D canvas [perf §0.2]) are drawn only on A's side, with a canvas clip
  rect. B's side gets up to 8 DOM tags at its largest polities' centroids, rewritten per snapshot change.
- The divider is a draggable vertical bar with a grip, and is keyboard-movable with `[` and `]`. On the flat map it
  works the same, because the clip is in screen space.
- B's side always shows the Political view (or Tint when A is on Terrain). The Danger view is unavailable on a
  skeleton.
- Cost: one extra overlay draw of the planet geometry (the existing overlay is a "second draw of the planet's own
  geometry" [V polities.ts header]) and one more cell texture.
- Rejected: a true split view with two cameras. It doubles every frame's ~560k triangles and ~24 draw calls [M perf
  §0.2], and phones cannot afford that.
- **Phones:** the divider is horizontal-drag only, with a 44 px hit target (Apple's 44×44 pt default control size,
  Apple 2026; WCAG 2.5.5 AAA asks 44 × 44 CSS px, W3C 2023). There is also **Hold to peek**, a button
  that shows B full-screen while pressed. It suits one thumb better than dragging on a small screen.

**Progress and cancel.** `compareProgress` drives `timeline.setProgress('Simulating the other world…', frac)` [V
timeline API]. The panel shows **Cancel**, which bumps `compareId`.

### 1.9 The whatif saga — `ui/sagas/whatif.ts`
`whatifSaga(cA: Ctx, cB: Ctx, d: WhatIfDigest, order: Order | null, legend: boolean): Saga`, with kind `'whatif'`
added to `SagaKind` (not listed in the library's contents). It is told at T (the year shown, clamped to ≥ divergence).
It uses phrase table `WHATIF_T`, with `Voice(seed, 'whatif:' + hash(B orders), legend, WHATIF_T, OMEN_T)`.

Structure:
1. The fork: the order told as its omen (`omens.ts`: "It is written that in 800 the entrails…"). Then a sentence on
   what did not happen in the other world.
2. The first differences in the causal window, with names from both Ctx.
3. The parting: the year similarity falls below 0.5, as a fact, hedged.
4. The great differences: polities, peoples, faiths, wars.
5. A closing line on what stayed the same: the peoples within ±ρ, which are the majority on the measured seeds.

| key | Chronicle (hedged) | Legend |
|---|---|---|
| fork | Had the walls of {town} not been raised in {year}, the record would have run otherwise from that very year. | In the world that was not, no walls rose at {town} in {year}, and the threads of the years ran another way. |
| same | Without this order nothing would have been otherwise: {story}. | The sign was given and misread, and the world went on as it would have gone. |
| first | Within {n} years {eventB} instead of {eventA}. | Within {n} winters {eventB}, where in our world {eventA}. |
| part | By {year} the two records share hardly one event in ten. | By {year} the two worlds had forgotten each other. |
| noState | The {state}, which in our world ruled {n} towns at its height, would never have been founded. | No one would ever have sung of the {state}. |
| newState | In its place the records of that other world know the {stateB}, founded in {year} at {cap}. | Instead the {stateB} rose at {cap} in {year}, a realm our world never saw. |
| people | The {people} would number some {nB} by {T} instead of {nA}. | The {people} would have been {more/fewer}, {nB} souls and not {nA}. |
| samePeoples | Most peoples would have numbered much as they do: {list}. | Yet the great peoples stood where they stand, for the land does not forget. |

Tests: both registers fill every slot. A failed order yields the `same` line only. The divergence year appears. The
saga is deterministic (same digest, same text).

### 1.10 Stats harness — `src/whatif/whatifStats.ts` (Node script, like the sim `*Stats.ts`)
On each of seeds 1, 7, 42, 1234, for orders {fortify largest town, explore toward a far cell, war on the nearest
neighbour, settle} at years {300, 800, 1500}:
- Divergence year: −1 exactly when the outcome is Failed with nothing done (target: 100% agreement), else ≥ the
  order year. Checked on seeds 1 and 7 [M].
- Similarity curve: report the year it falls below 0.5. Expected tens of years to 2 centuries [M on 42 and 1234].
- **Noise floor for ρ.** Repeat with K = 8 "trivial" orders: Fortify on a town of 500–800 people far from everything
  that is fulfilled. Take the 90th percentile of |ln(popB/popA)| over peoples and set ρ to it. Rationale: if a trivial
  nudge moves a people by that much, a real nudge's delta of that size is indistinguishable from chance.
- Matching quality: the share of B's polities with peak ≥ 10k people that are matched (target ≥ 60% [A]). Spot-check
  10 matches by eye in the panel.
- Timing targets (desktop, Node): `fingerprintOf` < 40 ms, `diffFingerprints` < 60 ms per pair. The probe's naive
  string keys took 150–590 ms [M], hence typed arrays and integer hashes. Fingerprint size < 0.5 MB.

### 1.11 Tests
1. `whatif/fingerprint.test.ts` (vitest, a 400-year run of seed 42): fingerprinting a History and its `snapshot()` copy
   gives the same fingerprint, and order and cradle events are excluded.
2. `whatif/diff.test.ts`: identical histories give `divergence = -1`, similarity 1 everywhere, and identity matches.
   A Fortify order fulfilled at year 200 on a 400-year run gives divergence ≥ 200 and `prefix` > 0.
3. Synthetic fingerprints test the polity matching: Jaccard 1 and the same people match; different peoples never match.
4. `EVENT_FIELDS` agrees with the UI's `*OtherIsSettlement` predicates on every type.
5. A skeleton runs through politiesOf, rulersOf, faithsOf, Ctx, buildPolityLayer (data part only) and whatifSaga with
   no NaN in the text and no `{` left.
6. `whatifSaga` fills every slot in both registers and is deterministic.
7. Worker logic factored as `runCompare(world, keptOptions, ordersB)` (pure apart from the cache): B's
   `hashValue` equals that of a `createHistoryRun(world, optionsB).advanceTo(years)` run.

### 1.12 Risks and open questions (what-if)
- **Chaos framing** (above). The owner should confirm the wording "differences, not effects".
- Worker memory peak during a compare on phones (+~75 MB for B's run and History) [A]. Measure on an iPhone. If it is
  too much, the lite tier could post the History in two halves, or fingerprint B in chunks during the run (needs
  `simulateTo` without assembly [V the worker already uses it]) and post only the skeleton fields.
- Polity-matching thresholds [A]. Tune them by eye on seeds 42 and 1234.
- Compare length = A's years at the time of the request. Comparing beyond 2000 years scales linearly.
- `cmp=` links: B is recomputed on open (or read from the cache). That costs a full run on a cold cache.

---

## 2. Feature 2: The story director

### 2.1 Current behaviour [V]
- `ui/historyIndex.ts buildHistoryIndex` builds the chronicle's entries as CSR. `notableKind`, `notableYear`,
  `notableOffsets`, `notableMembers` and `notableMemberYear` aggregate noisy event families (famine bursts, decades of
  foundings, raids, gains, revolts, bonds, walls…) into entries, with a representative first event.
- The chronicle (`ui/chronicle.ts`) shows the newest 40 rows, as a pure function of the year.
- Camera: `render/cameraFly.ts createCameraFly(camera, duration = 0.9)` slerps (Shoemake 1985) the camera to look down a direction at
  a distance. `historyView.ts` flies to a cell with `deps.fly.flyTo(tmp, Math.min(camera.position.length(),
  FLY_DIST = 2.3))` (lines 393, 1373). `deps.onFly()` stops the spin. `main.ts` cancels a fly on user control and
  aborts the city view when a panel fly-to starts (~line 1503).
- Timeline: `SPEEDS = [0.25, 1, 4, 16]` and `YEARS_PER_SECOND = 20/3`. `tick(dt)` advances by
  `dt · speed · YEARS_PER_SECOND`. `setMarks(TimelineMark[])` draws spans under the slider (great epidemics).
- Scenes (`sagas/scenes.ts`) already score drama roughly: sack = 3·share·pop, and plague, founding, landfall,
  conversion and work scenes. Each yields a 2–3 sentence set piece in both registers. `sackScene(c, v, i)` and the
  rest take an event index.
- Reduced motion is honoured only in CSS and on the landing page (`style.css` media queries; `landing.ts`). Perf P1
  proposes honouring it for the spin.

### 2.2 The drama score (static part) — `ui/story/drama.ts`, DOM-free
For a chronicle entry n with representative event e (and member count m):

**S0(n) = B[type] · M(n) · U(e) · R(e) · F1(e)**

- **B, base weight** by type (0–10), with a category (War, Politics, Dynasty, Faith, Plague, Discovery, Settlement,
  Culture, Trade, Nature, Society, Nudge). The table for existing types follows. The weights are design choices
  **[A]**, tuned by the harness for spread across categories.
  - PolityEnded 8; HolyCityFell 8; FaithFounded 8; GreatEpidemic 9; CivilWar 7; FirstContact 7; OrderFulfilled 7;
    Sacked 6; Partitioned 6; Reunified 6; DynastyEnded 6; Schism 6; HolyWar 6; Landfall 6; Epidemic (19) 6;
    UnionFormed 5; SuccessionWar 5; FaithDied 5; Discovery 5; LandmarkCompleted 5 (×rank); LandmarkRuined 5;
    ReignEnded 5 (only when killed in battle or by plague, else ignored).
  - Conquered 4 (×2.5 when it is the defender's capital: "the capital falls"); SiegeLifted 4; Seceded 4; PolityFounded 4;
    DynastyFounded 4; StateReligion 4; RulerConverted 4; Persecution 4; CityStricken 4; IdeaConceived 4 (first origin
    only); Boom 4; MonopolyBroken 4; DirectRoute 4; Abandoned 4 (town or larger only); OrderFailed 4; Famine burst 4.
  - WarDeclared 3; Revolt 3; BecameVassal 3; SuccessionCrisis 3; BecameCity 3; DiseaseAppeared 3; EpidemicEnded 3;
    ArmyStricken 3; VoyageLost 3; FleetLost 3; TraditionRenowned 3; SecretLeaked 3; TradeForsaken 3; PiratesRise 3.
  - PeaceMade 2 (scored by its war's outcome and dead); CapitalMoved 2; Alliance 2; Regency 2; DepositFound 2.
  - `DRAMA_IGNORED`: Founded (except through Landfall), Migration, Built, StructureLost, TradeOpened, TradeClosed,
    ExpeditionSent, ExpeditionReturned, TechAdvance, Domesticated, SpeciesAdopted, the technique and habit types,
    Joined, Raid, Defected, BorderDispute, tourism 100–105, PlaceRenamed, IdeaAdopted, IdeaLost, IdeaResisted, landmark
    begin/neglect/restore/convert, the trading-post types, OrderGiven, OrderLapsed, CradlePlaced, and so on.
- **M, magnitude** = `1 + 0.5·log10(1 + X/1000)`, where X depends on the type:
  - people lost: Sacked `value · pop(before)`, Famine burst summed loss, CityStricken `extra · pop`, Epidemic `value ·`
    people pop;
  - the war's `dead` for PeaceMade, WarDeclared (known at its end: the whole History is precomputed), CivilWar and
    SuccessionWar;
  - the polity's peak pop for PolityEnded, PolityFounded and DynastyEnded (the realm's);
  - `value` (landmass cells) × 50 for Landfall.
  For aggregated entries, X sums over members and M gets `× (1 + 0.1·min(10, m − 1))`.
- **U, upset (underdog)**, for decisive outcomes (Conquered of a capital, PolityEnded by conquest, PeaceMade with
  AttackerGains / DefenderGains / Conquest, SiegeLifted): `U = min(3, sqrt(P_loser / P_winner))` when the winner had
  fewer people that year (polity pop from `pstat`), else 1. A siege lifted by the smaller side counts as an upset for
  the defender.
- **R, reach**: `× 1.6` if an Empire-tier polity is involved, `× 1.25` for a Kingdom, `× 0.8` for a Chiefdom (tierAt
  [V politiesData.ts:572]); `× 1.2` if the settlement is a city (≥ CITY_POPULATION).
- **F1, firsts**: `× 1.5` for the world's first of a kind: the first Kingdom, first Empire, first great epidemic, first
  universal faith, first contact between two peoples of different continents. The world saga already detects some of
  these (`sagas/world.ts`, firstKingdom [V per city-states.md:627]). Reuse that.
- Output: `StaticDrama { score: Float32Array; cat: Uint8Array; cell: Int32Array; scale: Uint8Array /* 0 town, 1 region, 2 continent */; key: Int32Array /* cat·4096 + main polity or people id */ }`,
  one row per notable entry, built once per History in O(entries).

### 2.3 Live score, the story plan, and prominence — `ui/story/plan.ts`, pure
The live score of entry n at time t, given the beats already chosen (j < n):

**S(n, t) = S0(n) · N(n, t) · D(n) · F(n)**

- **N, novelty decay**: `N = 1 / (1 + Σ_j [ e^{−(t − t_j)/τ_key}·[key_j = key_n] + 0.5·e^{−(t − t_j)/τ_cat}·[cat_j = cat_n] ])`,
  with τ_key = 120 years (the same state again) and τ_cat = 40 years (the same kind of story again) [A].
- **D, diversity versus the previous beat**: `1 − 0.3·[cat = cat_prev] − 0.3·[shares a polity with prev]`.
- **F, focus**: `1.5` when the entry involves the selected polity or people, or the seat-mode seat (§0.1). Otherwise 1.

**The plan** is built once per History (and after an extension, from the old plan's last beat on). It is a greedy
chronological pass:
1. From the last beat's year `t_b`, consider the entries with year in `(t_b + G_min, t_b + G_min + W]`, with G_min = 25
   years and W = 50 years [A].
2. Take the argmax of S. If S ≥ θ (θ = 6 [A]), it is a beat. Otherwise the stretch is quiet: move t_b forward by W.
3. Each beat records its `prominence`: the distance in years to the nearest beat of higher S0·N, or ∞ for the top one.
   (Topography calls this distance-to-the-nearest-higher-point *isolation*, not prominence: Funke et al. 2023. The
   field name is this plan's.)
   At run time, playback speed k keeps beat b only if `prominence ≥ G_min · k`. So at 16× only the peaks remain
   (about 4–10 per 2000 years, target in §2.7), at O(1) cost per frame.
4. Entries with S ≥ θ_n (3.5) that are not beats become **notifications** (§2.5).

The output is struct-of-arrays:
`StoryPlan { beatEntry: Int32Array; beatYear: Float64Array; beatScore: Float32Array; beatProminence: Float32Array; beatCell: Int32Array; beatScale: Uint8Array; noteEntry: Int32Array; noteYear: Float64Array; noteScore: Float32Array }`.

Why precompute: the codebase shows everything as a pure function of the year (historyIndex.ts header [V]). A plan
fixed per History keeps scrubbing exact, keeps tests deterministic, and lets the timeline draw the beats as marks. There
is no RNG. Ties break by entry index.

Cost: there are a few thousand notable entries. The window scan is linear, so the plan takes < 5 ms [A].

### 2.4 Follow the story: runtime — `ui/story/director.ts`
A toggle **Follow the story** (shortcut **H**, which is free; a button in the timeline bar, `aria-pressed`, the toggle-button state, MDN 2026b). Its state
machine runs in real seconds, driven from `main.ts`'s frame loop with `dt`:

| state | enter when | does | leaves |
|---|---|---|---|
| Idle | follow on | finds the next kept beat b with `beatYear ≥ year` | lead time reached → Lead |
| Lead | `beatYear − year ≤ L·yps`, with L = 1.6 s and yps = `timeline.yearsPerSecond` | `fly.flyTo(dir(cell), dist(scale), 1.6)`, where dist is 1.8 for a town, 2.3 (FLY_DIST) for a region and 2.8 for a continent | the flight ends → Dwell |
| Dwell | the beat's year is reached | `timeline.setSlow(0.25)` eased over 0.4 s; caption card shown (§2.5) for 6 s | 6 s or Next → Release |
| Release | — | `setSlow(1)` over 0.8 s | → Idle |
| Suspended | user drag, zoom, pick or fly (`controls` 'start', `onFly` from a panel) | chip "Following paused — Resume"; nothing moves | 12 s idle, or Resume → Idle |

Rules:
- A beat whose cell is already in view (angle to the camera's look direction < 0.5 × the view's half-angle) gets **no
  flight**, only a pulse ring at the place. This saves motion and battery (perf §0.2: motion is what costs).
- The city view engaged (`cityView.engaged`) → Suspended. Follow never flies into a city.
- `prefers-reduced-motion: reduce` (matchMedia, which perf P1 also adds; MDN 2026a): no flights. The camera stays put, and the
  card has a "Show" button that does a single instant cut (`fly` with duration 0).
- Scrubbing backwards or jumping more than 50 years: the director resets to Idle at the new year. The plan is fixed,
  so this is exact.
- The intro animation (`timeline.intro`): follow is unavailable until it ends.

Changes needed:
- `render/cameraFly.ts`: `flyTo(dir, dist, duration?)`, defaulting to the current 0.9 s.
- `ui/timeline.ts`: `setSlow(k: number, easeSeconds: number)`, a transient factor applied in `tick` on top of `speed`.
  It does not change the speed buttons, and `yearsPerSecond` includes it. Also `setBeats(years: Float64Array | null,
  prominence: Float32Array | null)`: thin ticks drawn like `setMarks`, filtered by the current speed.

### 2.5 Caption card and notification queue — `ui/story/storyCard.ts`, `story.css`
- **Caption card:**
  - Title: the scene title when the sagas have a scene for the event (`sackScene`, `plagueScene`, `landfallScene`,
    `conversionScene`, `workScene` [V scenes.ts]), else a short form of the chronicle line.
  - Body: the scene text (2–3 sentences) in the register chosen in the Sagas panel (Chronicle/Legend), else the
    chronicle line(s) of the entry (`describeEvent`, or the group describers the chronicle already uses [V
    chronicle.ts imports]).
  - "Read more" opens the saga of the main subject (state, city, people).
  - If a partisan viewpoint is set in the Sagas panel (§3), the scene is told through it.
- **Placement:**
  - Desktop: lower left, above the chronicle, max-width 360 px.
  - Phone (`isCompact()` [V ui/compact.ts]): a 2-line strip directly above the timeline, which "runs full width above
    the sheet's handle" [V compact.ts header]. Tap to expand to the full text in a sheet.
- **Notification queue:**
  - Non-beat entries with S ≥ θ_n raise toasts ("⚔ Vashtar takes Oruma · Go"). A toast's **Go** sets the year if
    needed and flies there.
  - Queue rules: at most 3 visible on desktop and 1 on phones; at most one new toast per 2 s of real time; a toast
    expires when its event is more than 30 years behind the year shown.
  - Toasts with the same `key` coalesce ("+2 more in the war of Vashtar").
  - Toasts appear only while playing. A pause keeps the visible ones and stops new ones.
  - Off by default, unless Follow is on. There is a separate toggle in the View menu.
  - Accessibility: toasts live in an `aria-live="polite"` region (announced without interrupting, MDN 2026c). The card is focusable, and Esc closes it.

### 2.6 New event types from other plans
The registry and the coverage test (§0.1) are the whole mechanism. A plan's `*Format.ts` calls:
```ts
registerDrama(EventType.Betrayal, {
  cat: DramaCat.Politics, base: 7,
  /** People affected: the betrayed ally's population that year. */
  mag: (c, e) => c.pstatAt(polityOfCap(c, e.other, e.year), e.year)?.pop ?? 0,
  /** Where the camera goes: the betrayer's capital. */
  place: (c, e) => e.settlement,
  /** The two polities, for the novelty key and the focus test. */
  polities: (c, e) => [polityOfCap(c, e.settlement, e.year), polityOfCap(c, e.other, e.year)],
})
```
`DramaRule = { cat; base; mag?(c, e): number; upset?(c, e): number; place?(c, e): number; polities?(c, e): number[]; scale?: 0|1|2 }`.
`c` is a small `DramaCtx` over the History (politiesOf, tierAt and population lookups). It is not the saga Ctx, so it
stays cheap and needs no year cut. Defaults: place = `e.settlement`; polities = `eventPolities(pd, e)` [V
politiesData.ts:494]; no magnitude, so M = 1. Only types the chronicle shows reach the director, because it reads
notable entries: a plan that adds a type must make it a chronicle headline (as its plan already does, e.g. grudges §3.9
"Extend the shown predicate") for it to become a beat.

### 2.7 Stats harness — `ui/story/storyStats.ts` (Node, through vitest's environment or the CSS stub)
On each of seeds 1, 7, 42, 1234, 2000 years:
- Beats at 1×: **20–40**. Median gap ≥ 40 years. No gap > 250 years unless the stretch has no entry with S ≥ θ
  (reported).
- Category spread: no category > 35% of beats, and ≥ 6 categories represented.
- No more than 2 beats in a row about the same polity.
- At 4×: 8–15 beats; at 16×: 4–10.
- Notifications at 1×: 60–150, so at most ~one per 2–3 s of real time at 1× over 300 s.
- Print the top-10 beats with their factors (B, M, U, R, F1, N) for review.

### 2.8 Tests
- `story/drama.test.ts`: the coverage test (§0.1). M is monotone in X. U = 1 when the stronger side wins, and is >1 and
  ≤ 3 otherwise. A capital-fall Conquered scores > a plain Conquered of the same town.
- `story/plan.test.ts`: the plan is deterministic (two builds are equal). Gaps ≥ G_min. Every beat has S ≥ θ. The
  prominence filter is monotone in speed (the beats at 16× are a subset of those at 4×, which are a subset of those at
  1×). Extending a History by 400 years leaves the old beats before the old end unchanged.
- `story/director.test.ts`, the state machine with a fake clock and fake fly/timeline: the lead time is respected; user
  input suspends; reduced motion means no flyTo; a jump backward resets.

### 2.9 Risks (director)
- Weights are taste [A]. The harness only guards spread and pacing. The owner should watch 2–3 seeds at 1×.
- Motion sickness and battery. Mitigations: no-flight-when-visible, the 25-year minimum gap, reduced motion, and the
  suspend on any input.
- Captions duplicate the chronicle's text. That is intentional (one wording source), but the scene text can be long on
  phones: cap it at 220 characters with "more".

---

## 3. Feature 3: Partisan history

### 3.1 Current behaviour [V]
- Two registers: Chronicle (plain, hedged) and Legend (heightened). Each phrase key has
  `[chronicle variants, legend variants]` (`voice.ts PhraseTable`). `Voice(seed, stream, legend, ...tables)` chooses
  variants by a seeded stream `saga:${stream}:${L|C}`. It never chooses what is said.
- Subjects: world, people, state, city, house, decade, year (`types.ts SagaKind`). They are cached per
  `kind:id:legend:Y` (`index.ts generateSaga`).
- Wars: `state.ts` lines ~253–292 count wars won and lost, the bloodiest with its dead, the towns lost, and secessions.
  `wars.ts warName / warCalled` give every war one name from the records.
- Scenes: `sackScene` says who came, from where, the town's people, and the share lost, in one voice for everyone.
- Omens: the player's orders told as signs (`omens.ts`).
- Library and Sagas panel: register switch, URL `saga=`, `legend=`, `told=` [V library.ts, sagasPanel.ts].

### 3.2 Viewpoint and stance — `ui/sagas/lens.ts`
```ts
/** Whose telling: a people's or a state's (null: the neutral record, as today). */
export interface Pov { kind: 'people' | 'state'; id: number }
/** How the teller stands to a polity at a year. */
export const Stance = { Us: 0, Kin: 1, Friend: 2, Neutral: 3, Foe: 4 } as const
```
For a state viewpoint V, `stance(p, y)` is the first that applies:
1. **Us**: `p === V`, or p is in V's lineage (the `parent` chain either way) with V's people ("our forefathers").
2. **Foe**: at war with V at y (`warsOf`), or `standingGrudges(pd, V, y)` weight ≥ 0.3 toward p (grudges). The proxy is
   any war between the two lineages that started in (y − 150, y].
3. **Friend**: an Alliance, Vassal or Tribute bond with V in force at y (`bondActive` [V politiesData.ts:593]), or the
   same state faith at y.
4. **Kin**: the same people as V.
5. **Neutral** otherwise.

For a people viewpoint P, Us = any polity whose `people === P`, and Foe = any polity at war with an Us polity at y, or
by the proxy. Stances are memoised per (p, decade).

`sideOfWar(w)` gives the teller's side (attacker, defender, or none), and whether the teller won or lost (the
WarOutcome logic of `state.ts` [V lines 258–265]).

### 3.3 Rhetoric rules — `ui/sagas/partisanParams.ts` (UI constants, a doc comment per line)
```ts
export const PARTISAN = {
  /** Our people's dead at the hands of a foe, told as this multiple (chronicle, legend): suffering is remembered large. */
  ourDeadByFoe: [1.5, 3],
  /** The foe's dead at our hands: minimised in the chronicle, unspoken in the legend (0: omit the number). */
  foeDeadByUs: [0.6, 0],
  /** Our own dead at our own hands (a revolt crushed, a civil war won): omitted in both. */
  ourDeadByUs: [0, 0],
  /** A lost war is left out of the chronicle when it cost fewer than this many dead and at most one town and no capital fell. */
  omitLostDead: 2000,
  /** The legend leaves out every lost war in which no capital of ours fell. */
  legendOmitLost: true,
  /** A white peace is told as a victory in the legend. */
  legendWhitePeaceWon: true,
  /** Chronicle numbers: two significant figures, "some". Legend numbers snap to the formulaic set, nearest in log space. */
  legendNumbers: [100, 300, 1000, 3000, 10000, 30000, 100000],
} as const
```
Grounds, cited, with the constants as design choices **[A]**:
- Inflated figures in pre-modern narrative sources: Hans Delbrück, *Geschichte der Kriegskunst im Rahmen der
  politischen Geschichte*, vol. 1 (1900), on ancient army and casualty numbers, starting with Herodotus' Persian host
  (Delbrück 1900; his short English statement of the argument, including Herodotus' 5,100,000 for Xerxes' army, is
  Delbrück 1913). His specific reconstructed numbers are contested, but the inflation itself is the standard view
  [unverified as a survey claim: Delbrück's argument is verified, "standard view" is this plan's judgement]. The factors
  1.5 and 3 are not taken from him: they are presentation constants (design defaults).
- Formulaic and round numbers: the Greek *myrioi* "ten thousand", which also meant "countless" (grammarians accent the
  definite numeral μύριοι and the indefinite μυρίοι differently, a distinction the manuscripts do not keep; Wiktionary
  2026), and Chinese 万 *wàn* "ten thousand", as in 万岁 "ten thousand years", for "very many" (Wikipedia 2026). In
  demography, the excess of reported ages ending in 0 and 5 is age heaping, measured by Whipple's index (100 = no
  preference, 500 = every age ends in 0 or 5; UN DYB 2023). The legend's snapping to a formulaic set imitates this.
- Reattributing defeat to treachery: the German *Dolchstoßlegende* after 1918 (defeat blamed on the home front, as in
  Hindenburg's 1919 testimony; GHDI n.d.) is the standard modern example. The rule
  in §3.4 uses it only when the records hold a betrayal or a separate peace; otherwise the legend blames numbers or
  guile.

**Omissions.**
- Chronicle (court chronicle): a lost war is omitted when `dead < omitLostDead`, `taken ≤ 1`, and none of our capitals
  fell. Revolts we crushed become "order was restored at {town}". Our sacks of foreign towns keep the town and the
  year but drop the toll.
- Legend: lost wars are omitted unless our capital fell (`legendOmitLost`). A white peace becomes "the {foe} sued for
  peace".
- Neither register invents an event. Omission and wording are the only distortions without beliefs.

**Euphemism and condemnation**: verb keys chosen by stance (`Voice.ps(key, stance, vars)` tries `key.us`, `key.foe`,
…, then falls back to `key`):

| record (neutral key) | teller's side acted (key.us) | done to the teller (key.foe) |
|---|---|---|
| Conquered | took {town} under its protection / (if the town's people is ours) liberated {town} | seized {town} |
| Sacked | punished {town} for its defiance | sacked {town}, putting {toll} to the sword |
| Seceded (from us) | — | rebels at {town} broke faith and set up a false crown |
| Seceded (we broke away) | threw off the yoke of the {foe} | — |
| CivilWar (us = defender) | put down the pretender of {town} | — |
| BecameVassal (they to us) | the {foe} bent the knee | — |
| BecameVassal (we to them) | made an honourable peace with the {foe} | — |
| HolyCityFell (ours fell) | — | the infidel defiled {city} |

### 3.4 Hero, villain, the lost war that cannot be omitted
- **Hero** of a partisan state saga: the Us ruler with the highest `2·wars won + towns gained + reign years / 20`
  (`reignFacts` [V epithets.ts]). The legend gives him the epithet line, which exists already, and one extra sentence.
- **Villain**: the ruler of the Foe polity that dealt the worst blow, meaning the sack or conquest of our largest town
  or the fall of our capital. If no ruler is recorded (rulers off), the villain is the foe polity itself.
- **A lost war with our capital fallen** is always told:
  - Chronicle: "after a long resistance".
  - Legend: "betrayed" when a Betrayal (190) by one of our allies, or a separate peace by an ally, falls inside the war.
    Otherwise "the {foe} came in numbers past counting", or "by guile" when the beliefs plan records a forged claim or
    a bluff against us in the 20 years before.
- **War names** (`wars.ts`): `warCalledBy(c, w, lens)`. A defensive war we won with dead ≥ 3000 becomes "the War of
  Deliverance"; a war the foe won against us becomes "the {Foe} Invasion of {year}"; a war of ours becomes "the
  {Our} Campaign against {foe}". The neutral `warName` is unchanged, because the neutral sagas and the chronicle rely
  on one name per war [V wars.ts header].

### 3.5 Beliefs, not truth — `PartisanFacts` adapter (in lens.ts)
| method | with beliefs-and-deception | proxy (no beliefs) |
|---|---|---|
| `strengthWord(foe, y)` | `est/true` from `beliefAt` for the row (our strongest polity at y observing foe): ≥ 1.5 → "the mighty {foe}", ≤ 0.67 → "the feeble {foe}", else plain | plain |
| `motiveOf(w)` (our wars) | `Wars.motive`: Preventive → "to forestall the {foe}'s designs"; Optimism → "to punish the insolent {foe}"; Indivisible → "for the holy city of {city}" | "to right old wrongs" when the proxy grudge holds, else none |
| `motiveOf(w)` (their wars on us) | always "unprovoked" (the teller never grants the foe's motive) | same |
| `allianceKnown(bond, y)` | `Bonds.known` ≤ y. A secret alliance against us is not told before it came to light. Our own secret alliance is told only in the legend, as cunning | always known (secret bonds do not exist) |
| `foeShown(foe, y)` | if a Deterred (231, extra 1) of ours against foe is within 10 years, the foe's *shown* strength is reported ("a host beyond counting barred the way") | — |
| `toll(event)` | truth × PARTISAN factors (beliefs has no casualty beliefs) | same |

A people's viewpoint uses, per year, its strongest polity as the observer. A chronicle told at year Y uses the belief
snapshot at Y (the nearest slow snapshot at or before). There is no hindsight: the teller never learns the truth later.
To avoid double distortion, the strength words come only from beliefs, never from a multiplier.

### 3.6 Code changes
- `types.ts`: `SagaSubject` and `Saga` gain `pov?: Pov` (the Saga echoes it).
- `index.ts generateSaga`: the cache key gains `:${pov ? pov.kind[0] + pov.id : '-'}`. With a pov,
  `new Ctx(h, world, Y, pov)`. The title gets a suffix line: "as the Vashtari tell it" or "as told in the Kingdom of
  Vashtar". The epigraph is credited in the legend: "— the Song of {cap}".
- `facts.ts Ctx`: `readonly lens: Lens | null`. With no pov it is null, and every edit below checks `c.lens` first.
- `voice.ts`: `ps(key, stance, vars)`, and the stream name `saga:${stream}${pov ? '@' + povKey : ''}:${L|C}`. **The
  neutral stream names are unchanged, so neutral text is byte-identical** (test 1).
- Edit points, in order of value:
  - `state.ts` wars block (record counts only the wars the lens keeps; bloodiest via `toll`; lostTowns and seceded via
    `ps`);
  - `scenes.ts sackScene` (side, verb, toll);
  - `wars.ts warCalledBy`;
  - `people.ts` wars and sufferings;
  - `reigns.ts` (battle deaths: "fell gloriously" versus "the tyrant was struck down");
  - `year.ts` and `city.ts` last.
  World and house sagas accept a pov but only change their war and sack sentences.
- Phrase table `PARTISAN_T` in `ui/sagas/partisan.ts`, keys `key.us` and `key.foe`, both registers. Examples:

| key | Chronicle (court chronicle, hedged but slanted) | Legend |
|---|---|---|
| conquered.us | In {year} the {state} took {town} under its protection. | In {year} our host freed {town} from the yoke of the {foe}. |
| conquered.foe | In {year} the {foe} seized {town}. | In {year} the {foe} fell upon {town} like wolves upon the fold. |
| sacked.foe | In {year} the {foe} sacked {town}; our chroniclers count {toll} dead. | In {year} the {foe} put {town} to the torch, and {toll} of our people were slain. |
| sacked.us | In {year} {town} was punished for its defiance. | In {year} {town} learned the price of defiance. |
| lostWarCapital | After a long resistance {cap} fell to the {foe} in {year}. | In {year} {cap} was betrayed, and the gates were opened from within. |
| peaceWhite | In {year} peace was made with the {foe}. | In {year} the {foe} sued for peace. |
| bloodiest.us | The hardest of its wars was {war}, {span}, which cost our people {toll}. | Bitterest of all was {war}: {toll} of our people fell, and the {foe} paid dearly for each. |
| hero | Of its rulers the chroniclers praise {ruler} most, who won {n}. | {ruler}{ep} was the shield of the {people}; {n} times the foe broke upon him. |
| villain | Its gravest wrong it suffered from {ruler} of the {foe}. | {ruler} of the {foe}, whose name is spat in {cap} to this day. |

- UI: the Sagas panel and the Library get a **Told by** selector under the register switch: "The record (neutral)",
  then peoples, then states existing by the year told (the same lists the picker builds). URL `pov=state:3` or
  `pov=people:2`. A subtitle tag reads "Partisan: numbers and blame are the teller's", with a link to "the record",
  which shows the neutral version of the same subject. This keeps the god's-eye truth one tap away. Phones: the
  selector is one native `<select>`.

### 3.7 Stats and tests (partisan)
- `sagas/partisan.test.ts`, seeds 42 and 1234 at year 2000, top 3 states by peak:
  1. **Neutral golden**: the world, people and state saga texts hash to the values recorded in the commit *before* the
     partisan change (step 12 records them first).
  2. With pov = the state itself, its won wars are all mentioned and its minor lost wars are not (per the rule).
  3. Every sack told by its victim's pov has a toll ≥ the true toll × 1.5 (chronicle), rounded as specified.
  4. No `{` is left in either register for any pov.
  5. Stance: a synthetic history with a war gives Foe during and within 150 years after, and Friend under an Alliance
     bond.
  6. With pov = a polity's enemy, the same state's saga uses the `*.foe` keys.
- Harness numbers to report (not gates): the share of a state's wars omitted per register (expect chronicle 20–40%, legend
  40–70% for an average realm [A]), and the mean toll multiple.

### 3.8 Risks (partisan)
- Tone: the euphemisms could read as endorsing violence. Mitigation: the tag line, the neutral link, and wording drawn
  from the register of real court chronicles rather than modern propaganda. The owner should review the table.
- Kin and lineage stances can be ambiguous (a successor state of our people that fought us). Rule order: Foe beats Kin.
- Without grudges, "Foe" by the proxy may be too broad. Tune the 150-year window by reading.

---

## 4. Determinism, toggles, and the cache
- No sim code changes, no new RNG streams, no HistoryOptions. All sim golden hashes stay. [V by construction: the new
  files are under `src/ui/**`, `src/whatif/**` and `src/render/**`, plus `src/worker.ts`.]
- The compare run is `createHistoryRun(world, optionsB)` with canonical options (`canonicalOptions` [V worker.ts]), so
  it is bit-identical to `reorder` with B (test §1.11 #7). Its cache entries are ordinary entries.
- The director and the partisan lens use no RNG. Partisan wording variants come from Voice streams with new names; the
  neutral streams are untouched.
- Toggles: Follow (H), toasts (View menu), compare (W panel), pov (selector). All are off by default, so the default
  page behaves exactly as now.

## 5. Ordered, commit-sized steps
Each step passes `npm run typecheck` and `npm test`.

**Director (independent):**
1. `ui/story/drama.ts`: DramaCtx, rules for the existing types, `registerDrama`, `DRAMA_IGNORED`, static scores over a
   HistoryIndex. Test: `drama.test.ts` with the coverage test.
2. `ui/story/plan.ts`: novelty, diversity, focus, greedy plan, prominence, notifications. Tests: `plan.test.ts`. Script:
   `storyStats.ts`, with first numbers recorded in the commit message.
3. `render/cameraFly.ts`: duration parameter. `ui/timeline.ts`: `setSlow`, `setBeats`. Manual check: the speed
   buttons are unaffected.
4. `ui/story/director.ts` + `storyCard.ts` + `story.css`. Wiring: `historyView.ts` exposes its index and selection and
   builds the plan in a build step (`buildSteps` [V]); `main.ts` adds the frame hook, the H shortcut, the timeline
   button, and Suspended on `controls` 'start'. Test: `director.test.ts`.
5. Notifications and the View-menu toggle; reduced motion; the compact layout (strip, 1 toast). Manual on a phone-size
   window.

**What-if:**

6. `src/whatif/eventFields.ts`, `fingerprint.ts`, `diff.ts` (DOM-free). Tests §1.11 #1–4. Script: `whatifStats.ts`
   (noise floor → ρ, divergence agreement, timings).
7. `worker.ts`: `kept.fp`; `compare` request (own run, chunked, re-enqueued, cancellable, cache read/write, lite
   frees `kept.run`); `compareProgress`. Factor `runCompare` for test #7.
8. `src/whatif/skeleton.ts`; `main.ts requestCompare`, message handling, the `cmp=` URL param, the memory tier. Test #5.
9. `ui/whatif/consequences.ts` (ranking with drama S0) and `ui/whatifPanel.ts` + `whatif.css`: header, divergence
   timeline, lists, Adopt, Cancel. Entry points in `nudgePanel.ts`. W shortcut.
10. Swipe: `uClip` in the polity overlay shader (`render/polities.ts`) and the marker shader (`render/settlements.ts`),
    the label clip, the alt PolityLayer lifecycle in `historyView.ts` (`setAlt(h | null)`), the divider UI, and
    hold-to-peek.
11. `ui/sagas/whatif.ts` (WHATIF_T) and the panel's saga section. Test #6.

**Partisan:**

12. Record the neutral golden saga hashes (test 1 of §3.7) with no behaviour change.
13. `ui/sagas/lens.ts` (Pov, Stance, stance, sideOfWar, toll, rounding, omissions, hero and villain) and
    `partisanParams.ts`. `voice.ts ps()` and the stream suffix. `Ctx.lens`. Unit tests 5, rounding and toll.
14. `ui/sagas/partisan.ts` PARTISAN_T, and edits in `state.ts`, `scenes.ts`, `wars.ts warCalledBy`, `people.ts`. Tests
    2–4 and 6.
15. "Told by" in `sagasPanel.ts` and `library.ts`, the `pov=` URL param, the tag line, and "the record" link.
16. `PartisanFacts` beliefs adapter. It is built when beliefs-and-deception has landed (proxies until then). Tests with
    a beliefs-on history: a secret alliance is omitted before `known`.
17. Optional: captions through the lens (the director honours the Sagas panel's pov), and `reigns.ts`, `year.ts` and
    `city.ts` partisan lines.

Dependency notes: step 9 uses step 1 (S0), so build the director's step 1 first or stub S0 = B. Steps 12–16 are
independent of 1–11.

## 6. Performance and memory summary
| item | cost | tag |
|---|---|---|
| Static drama + story plan per History | < 10 ms total, a few hundred KB of typed arrays | [A] |
| Director per frame | O(1): next-beat pointer, a state machine | [A] |
| Fingerprint per History (worker) | < 40 ms target, ≈ 0.3 MB | [A on measured counts] |
| Diff (worker) | < 60 ms target (naive string version 150–590 ms) | [M naive] |
| Compare run (worker) | = a nudge's re-simulation: 5.6–7.1 s in Node [M perf]; less with P6 resume | [M] |
| Worker peak during compare | +~75 MB transient (B's run 28.6–40.9 MB [M perf] + B's History 34–39 MB [M]); lite frees the kept run (−41 MB) | [M sizes, A peak] |
| Alt History on the main thread | full +34–39 MB [M]; skeleton ≈ 8–10 MB [A] | |
| Swipe | one extra overlay draw of the planet geometry and one cell texture | [V structure, A cost] |
| Partisan saga | as a neutral saga, plus stance memo (state saga 10–13 ms, world 227–401 ms in Node [M]) | [M] |

## 7. Risks and open questions (all)
1. **Chaos** (§1.2): only the causal window is a "butterfly chain". The owner should approve the "differences, not
   effects" framing and the ρ noise-floor rule.
2. Worker memory on phones during a compare [A]. Needs a real-device measurement, which perf §6 already asks for.
3. Director weights are taste [A]. Watch seeds 1, 7, 42 and 1234 at 1× and at 4× before tuning.
4. The battles plan must register its 220s rules. Until then a range fallback is used.
5. Partisan tone (§3.8) needs the owner's review of PARTISAN_T.
6. `cmp=` links on a cold cache cost a full run on open. Acceptable? Alternative: open the panel only on request.
7. Should "Adopt the other world" keep the comparison open the other way round, so the old world becomes B? Proposed:
   yes, as it is free (both are cached).

## 8. Verified vs measured vs assumed
- **[V]**:
  - the worker's orders, reorder, transfer, cache and canonicalisation paths;
  - the HistoryIndex notable CSR;
  - cameraFly's API and fixed 0.9 s duration;
  - the timeline's SPEEDS, `setMarks` and `tick`;
  - the sagas' Voice, PhraseTable and stream naming;
  - `generateSaga`'s cache key;
  - `state.ts`'s war accounting, `sackScene`, and `wars.ts` names;
  - the polity layer as a second draw of the planet geometry;
  - the free shortcut letters H and W;
  - detectDevice's phone and weak flags;
  - the CSS imports in landmarksFormat.ts and renamingFormat.ts.
- **[M]**:
  - no divergence for failed orders (seeds 1, 7);
  - divergence at the order year and id prefix, matching shares, and polity and war counts (seeds 42, 1234);
  - the similarity per century;
  - per-people deltas at year 2000;
  - History field sizes and land-cell counts;
  - saga timings;
  - the naive diff's time;
  - Node failing on saga CSS imports;
  - perf-efficiency's sim, memory and checkpoint numbers (quoted).
- **[A]**:
  - all drama weights and pacing constants;
  - matching thresholds;
  - ρ until the harness sets it;
  - skeleton size;
  - fingerprint and diff timings;
  - the worker peak on phones;
  - partisan factors (presentation constants, not historical estimates);
  - the expected partisan omission shares.

## Addendum
battles.md is now written: events 220–227 are defined there (228–229 spare). Replace the 220–229 placeholder in the director's event registry with battles.md's actual EventTypes and weights (Battle magnitude = casualties × decisiveness, upset from pre-battle odds). Also register 161–169, 190–194, 200–205, 210–218, 230–239, 240–246, 250–253, 260–268, 270–279 and riots 280–289 from their plans.

## Owner decisions (2026-11-26)
- Approved: label long-run divergences "differences, not effects" after ~40 years; set the "about the same" threshold by calibrating against trivial orders.

## Addendum (from court-politics.md §0.4)
court-politics.md (built last) requests interface additions from this plan — read its §0.4 before implementing this plan, and add the listed functions/hooks as no-op stubs if court-politics is not yet built.

## References

Citation audit 2026-11-26. [verified] = a page confirming the claim was opened during the audit;
[unverified] = could not be confirmed (reason given). Web docs are dated by access.

**Dynamics, hashing, similarity, animation**
- (Lorenz 1963) Lorenz, E. N. "Deterministic nonperiodic flow". *Journal of the Atmospheric Sciences* 20(2), 130–141.
  DOI 10.1175/1520-0469(1963)020<0130:DNF>2.0.CO;2 (DOI did not resolve through the fetch tool) [verified: volume and pages from the MIT Lorenz bibliography,
  https://wind.mit.edu/~emanuel/Lorenz/EdLorenz/publications_all.htm, and the title from Britannica "butterfly
  effect", https://www.britannica.com/science/butterfly-effect; the AMS publisher page refused the fetch]
- (Lorenz 1972) Lorenz, E. N. "Predictability: Does the flap of a butterfly's wings in Brazil set off a tornado in
  Texas?" Talk, AAAS Section on Environmental Sciences, Boston, 29 December 1972. Same two URLs as above [verified]
- (Devaney 1989) Devaney, R. L. *An Introduction to Chaotic Dynamical Systems*, 2nd ed. Addison-Wesley, 1989. Definition
  reproduced in Banks et al. 1992 [verified via that reproduction; the book itself was not opened]
- (Banks et al. 1992) Banks, J., Brooks, J., Cairns, G., Davis, G., Stacey, P. "On Devaney's definition of chaos".
  *American Mathematical Monthly* 99(4), 332–334 (DOI not checked).
  https://home.csulb.edu/~scrass/teaching/math456/articles/devaney_defn_chaos.pdf [verified: transitivity + dense
  periodic points imply sensitive dependence]
- (Broder 2000) Broder, A. Z. "Identifying and filtering near-duplicate documents". *Combinatorial Pattern Matching
  (CPM 2000)*, LNCS 1848, 1–10. Springer. DOI 10.1007/3-540-45123-4_1 [verified: sketch of t independent random
  permutations' minima; resemblance estimated by the count of agreeing elements]
- (Jaccard 1901) Jaccard, P. "Distribution de la flore alpine dans le bassin des Dranses et dans quelques régions
  voisines". *Bulletin de la Société Vaudoise des Sciences Naturelles* 37, 241–272. https://en.wikipedia.org/wiki/Paul_Jaccard
  [verified: bibliographic record only; the 1901 paper itself was not opened]
- (Noll et al. 2026) Noll, L., Vo, K., Eastlake 3rd, D., Hansen, T. *The FNV Non-Cryptographic Hash Algorithm*. RFC 9923
  (Informational, Independent Submission), February 2026. https://www.rfc-editor.org/rfc/rfc9923 [verified: FNV-1a
  per-octet loop; 32-bit prime 16777619, offset basis 2166136261]
- (Shoemake 1985) Shoemake, K. "Animating rotation with quaternion curves". *ACM SIGGRAPH Computer Graphics* 19(3),
  245–254 (SIGGRAPH '85). DOI 10.1145/325165.325242 [verified: venue, volume, pages and DOI from Scilit,
  https://www.scilit.net/publications/5d6090c0be12cac7bb130a0c6c3fb47c]
- (Funke et al. 2023) Funke, D., Hüning, N., Sanders, P. "A sweep-plane algorithm for calculating the isolation of
  mountains". arXiv:2305.08470. https://arxiv.org/abs/2305.08470 [verified: isolation = "the distance between a peak and
  the closest point of higher elevation"]

**Web platform and UI guidance**
- (MDN 2026a) MDN. "prefers-reduced-motion". https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion [verified]
- (MDN 2026b) MDN. "aria-pressed". https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-pressed [verified]
- (MDN 2026c) MDN. "aria-live". https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-live
  [verified: polite = announced at the next graceful opportunity, without interrupting]
- (Apple 2026) Apple. *Human Interface Guidelines*: Accessibility (iOS/iPadOS default control size 44×44 pt).
  https://developer.apple.com/design/human-interface-guidelines/accessibility [verified]
- (W3C 2023) W3C. *Understanding WCAG 2.2*, SC 2.5.5 Target Size (Enhanced), AAA, 44 × 44 CSS px.
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html [verified]

**History, philology, demography (partisan sagas)**
- (Delbrück 1900) Delbrück, H. *Geschichte der Kriegskunst im Rahmen der politischen Geschichte*, Teil 1: Das Altertum.
  Berlin: G. Stilke, 1900. Listing: https://onlinebooks.library.upenn.edu/webbin/who/Delbr%26uuml%3bck%2c%20Hans%2c%201848%2d1929
  [verified that a 1900 Stilke edition exists; the volume itself was not opened (HathiTrust refused), so "vol. 1 is on
  Herodotus' host" rests on Delbrück 1913]
- (Delbrück 1913) Delbrück, H. *Numbers in History: Two lectures delivered before the University of London*. London:
  University of London Press / Hodder & Stoughton, 1913. https://archive.org/download/numbersinhistory00delb/numbersinhistory00delb.pdf [verified:
  Herodotus gives 5,100,000 for Xerxes' army; ancient army figures inflated by patriotic legend]
- (Wiktionary 2026) "μυρίος", Ancient Greek entry. https://en.wiktionary.org/wiki/μυρίος [verified: "numberless,
  countless"; plural definite numeral "ten thousand"; accent distinction not kept in manuscripts]. LSJ itself could not
  be fetched (Perseus robots, lsj.gr error); Perseus' short definition "numberless, countless, infinite" was seen at
  https://atlas.perseus.tufts.edu/lemma/23031 [verified]
- (Wikipedia 2026) "Ten thousand years" (万岁). https://en.wikipedia.org/wiki/Ten_thousand_years [verified: 万 used as a
  synonym for an indefinitely large number]
- (UN DYB 2023) United Nations Statistics Division. *Demographic Yearbook 2023*, Technical notes to Table 3a (Whipple's
  index). https://unstats.un.org/unsd/demographic-social/products/dyb/documents/dyb2023/Notes03a.pdf [verified: 100 = no
  preference for 0 or 5; 500 = all reported ages end in 0 or 5]
- (GHDI n.d.) German History in Documents and Images. "Paul von Hindenburg's Testimony before the Parliamentary
  Investigatory Committee ['The Stab in the Back'] (November 18, 1919)".
  https://germanhistorydocs.org/en/weimar-germany-1918-1933/ghdi:document-3829 [verified: "the defeat of the German Empire
  in 1918 had been caused by the revolution on the home front"]

**Not cited because no outside source is claimed:** the drama score (B, M, U, R, F1), novelty decay N (τ_key 120,
τ_cat 40), diversity D, focus F 1.5, G_min 25, W 50, θ 6, θ_n 3.5, CAUSAL_YEARS 40, CHECK_YEARS 50, MINHASH_K 8, the
polity-match weights and threshold, ρ 0.2, the toast and dwell timings, PARTISAN factors and `legendNumbers`, and every
stats target. They are all design defaults [A], not facts. The plan cites no drama-management or narrative-generation
literature, so none is listed.

**Measured here:** `/home/claude/scratch-whatif/probe/diff-probe.ts` and `probe/spread-probe.ts` (divergence, id prefix,
matching shares, similarity per century, per-people deltas, field sizes, saga timings, naive diff timing). Sim, memory and
checkpoint figures are quoted from perf-efficiency.md (measured there; scripts in `/home/claude/plans/perf-scripts/`).

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **R5.** `Pov.kind` values: 'people', 'state', 'faction' (court), 'ideology' (MIR and FP; FP's 'movement' is dropped) and 'person' (character).
- **R6.** Shortcuts: `W` what-if and `H` director stand. Battle replay is `R`. All keys go through `ui/shortcuts.ts addShortcut` with a duplicate test.
- **R37.** Register drama rules for every block in MASTER-PLAN §3.1, through 419: 290–299, 300–306, 310–319, 320–329, 330–339, 340–348, 350–359, 360–369 and 380–385, besides those in the earlier addendum.
- **§5.4.** D-phone uses the lite tier only. The compare's worker transient counts against the shared 2-checkpoint phone cap.

## Addendum (phase0/director implementation)
Key R is already bound by existing code — battle replay must pick another free key (check main.ts key map; not B, H, W, R). Director tuning changed from plan defaults: τ_cat 150, θ_n 9.5, beat kept at speed k when prominence ≥ 18·k, DynastyEnded base 5 (results: 28–30 beats at 1×, 11–14 at 4×, 3–5 at 16×, 82–132 notices). Turning Follow on ends the intro. `follow=1` URL param; H toggles.


## Addendum (barriers & cold war)
Overrides the body and earlier addenda where they differ. Source of truth: barriers-coldwar.md (formulas, params, ids).
- Register events 390–398 (barriers-coldwar §4) in the director coverage table. Drama weights:
  - high: ColdWarBegan, Crisis(Escalated), ColdWarEnded(Collapsed);
  - medium: ProxyWar, LateBattle;
  - low: LinguaFranca, Detente, ClientDefected, Seclusion.
