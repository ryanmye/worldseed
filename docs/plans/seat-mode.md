# Plan: Seat mode, "Take a throne" (play through history as a people, polity, house, later a merchant family)

Plan only. The code is the read-only checkout `/home/claude/ryanmye/worldseed` @ 8cabf09. Probes ran on the scratch copy
`/home/claude/scratch-seat` (probes in `/home/claude/scratch-seat/probes/*.ts`, run with `node --experimental-strip-types`).
Tags: **[V]** verified in code, **[M]** measured here (probes in `/home/claude/scratch-seat/probes/`, named per row in 2;
2-core box shared with other agents, so times are noisy upper bounds), **[A]** assumed or to be decided. Outside facts carry
(Author Year) cites, listed under References at the end.

Blocks: **EventType 270–279** (this plan's). **OrderKind 10–22** for this plan. OrderKind is a dense enum that indexes
`ORDER_KINDS`, so it cannot live at 270+. 23–29 are reserved for seat follow-ups; other plans start at 30. This is an
amendment to `_CONVENTIONS.md`, see 12.

Depends on: nothing for phases A–B (steps 1–9). Phase C (steps 10–11, checkpoints) **reuses perf-efficiency.md P6**
(its steps 9–10) and does not re-specify it. Phase D (step 13) uses grudges (Betray), finances (Borrow, Levy) and
city-states (Charter). Each has a proxy, or its card is simply absent, while the dependency is not built. Phase E
(step 15, the Family seat) needs merchant-families. beliefs-and-deception.md is optional (6.5).

---

## 0. Summary

The player picks a seat (`HistoryOptions.seat`, also in the URL). The worker keeps a **live runner** and simulates year by
year. After each year a pure-read **watcher** (`seat/watch.ts`) checks for a decision point. If it finds one, the run
pauses at year D and the worker assembles and posts the History up to D with 1–2 **decision cards**. Each card has 2–4
options. Each option is a list of orders for year D+1 (existing kinds plus new ones), plus one record-only `Choice`
order. When the player picks, the orders are **appended to the live runner** (`HistoryRun.addOrders`) and play goes on.
Nothing is re-simulated.

This is exact, and it was measured: appending orders of year Y to a runner paused at Y−1 gives a History bit-identical to
the from-scratch run with those orders. That held for single and chained decisions on seeds 42 and 7 [M]. Checkpoints
(perf-efficiency P6: `RunnerState`, `checkpoint()`, `createRunnerFrom`) are needed only to take a decision back and to
start a reign at any year quickly. A checkpoint holds 28.6–40.9 MB of worker state (P6 [M]), or ~17–29 MB if the 11.7 MB
of static species arrays are shared (3.3, an amendment to P6). The phone budget is 2 checkpoints.

---

## 1. Current behaviour (verified)

### 1.1 Orders today [V]
- `contract.ts` ~l.1886–2110: `OrderKind` 0–9 (Explore, Settle, Crop, Idea, War, Peace, Seat, Faith, Fortify, Quarantine),
  `ORDER_KIND_COUNT = 10`, `Order {year, kind, actor, target?}`, `OrderRole`, `OrderStatus`, `OrderReason` 0–25,
  `OrderOutcome`, and `ORDER_KINDS` (an array indexed by kind: key, label, roles, years in force, effect). Also
  `encodeOrders`/`decodeOrders` (`year:key:actor[:target]` joined by `;`, the URL `o=`) and `orderFeasible(h, order, year)`
  (a cheap check against a History, judged on year−1). The header says "Not a game: no goals, no score". This plan adds
  the game on top and leaves the nudges as they are.
- `orders/state.ts` `createOrdersState`: fixed-size per-order typed arrays (n = orders.length) and `sorted` (year, then list
  index). `next` is the next order to activate, `active` the orders in force, plus per-people tables of the people kinds.
- `orders/system.ts`: `ordersBegin` (first in the year: OrderGiven 170, `check` → OrderFailed 172 or Active),
  `ordersPolity` (after politySystem: Seat consent, drawn from `ox.rng`), `ordersEnd` (last in the year: events from
  `evSeen` matched → OrderFulfilled 171, gone → Failed, out of time → OrderLapsed 173), `assembleOrders`.
- `orders/hooks.ts`: neutral for anyone not ordered. `peaceUrged` draws from `'history-orders'`, only for an ordered pair
  (war.ts:413 sits behind `||`, so it is not evaluated when the war's own `tired` is true). Hooks are called from
  migration.ts, exploration.ts, species.ts, ideas/system.ts, polity/war.ts, polity/danger.ts, disease/system.ts and
  religion/system.ts, always as `s.orders !== null && …`.
- `index.ts:430` creates `ox` only when `options.orders` is non-empty, so with no orders the history is exactly the
  unordered one. `step()` calls `ordersBegin` first and `ordersEnd` last, before the snapshots and the probe.

### 1.2 Every nudge re-simulates from year 0 [V]
- `worker.ts` header ("new orders start a new createHistoryRun from year 0 … a run cannot be forked") and `reorder()`: it
  builds a new `kept` with `run: null`, so `simulate()` calls `createHistoryRun(world, historyOptions)` and runs 0→years.
  A cache hit (the IndexedDB key includes the canonical orders) skips the run.
- `main.ts:502 requestOrders` posts `{type:'orders', orders, years, cradles}`. The history on screen stays until the
  replacement arrives (`replace: true`), and is then swapped in at `keepYear`.

### 1.3 Resumable runs [V]
- `index.ts createRunner` → `HistoryRunner {year, advance(years), simulate(years)}`. `createHistoryRun` (contract
  `HistoryRun {year, advanceTo, simulateTo?}`, contract.ts:1485) wraps it. `advanceTo(t < year)` re-runs from scratch.
  Nothing in a year depends on the run's length, and assembly copies everything out (the run goes on).
- **The runner's state is not only HistoryState.** The closure locals of `createRunner` also hold state: `weather`,
  `voyages`, `trade`, `techState`, `explore`, `polSnaps`, `rn`, `lm`, `ox`, `cradles`, all the snapshot buffers
  (`landUse/degradation/road/crop/herd/cash`, `snapPop/Food/Wealth`, `snapOff/Count`, `snapTech`, `snapVol`, `volOff/Count`,
  `goodVolume`, counters), and `featureMapCache`. Scratch: `search`, `scratch`, `portSearch`.
- **RNGs are closures** (`rng.ts sfc32`, Doty-Humphrey's PractRand generator, Doty-Humphrey n.d.: state `a,b,c,d`
  captured, no getter). A probe walking `{s, trade, tech}` at year
  300 found 13 RNG objects and no other functions [M, fork-probe2]: `s.sp.rng`, `s.sp.v2.rngHazard/rngTech`,
  `s.rngMigration`, `s.rngStructures`, `s.pol.rng/rngWar`, `s.goods.rng`, `s.dz.rng`, `s.rul.rng`, `s.rel.rng`, `s.tz.rng`,
  `s.ideas.rng`. More sit outside s: weather, voyages, expeditions, orders, cradles, tourism-springs, species-origins and
  disease-pool (the last four are used at creation, [A] verify no later draws). So `structuredClone` of the state throws
  (`DataCloneError`: functions cannot be structured-cloned, MDN 2026a) until RNGs can export their state.
- Module-level mutable arrays exist (habit.ts, cashCrops.ts `RATE/CASH0/CASH1/CASH_Q`, blight.ts `ORIGIN_*`,
  techniques.ts, migration.ts `found*`, trade.ts `TRADERS`, peoples.ts, speciesV2.ts `ALIVE`, species.ts `LABOUR0/STAPLE0…`).
  Most are per-call scratch. Any that carries meaning across years would break a checkpoint restore **[A: test, step 10]**.

### 1.4 What seat mode hooks into [V]
- Rulers: `rulers/system.ts` (`pickHeir` l.126, `succession` l.452, `contested` l.551 sets `pCrisisUntil` and logs
  SuccessionCrisis 34; overthrow in `rulerYear` l.436–441: `x = overthrow·weak·(1 + e + crisis + lostRecently·overthrowLost)`,
  drawn from `R.rng`; `R.kill[p]` is a cause waiting for the next rulers' year). Heirs pool `hN/hBorn/hDeath/hLegit/hFemale/
  hChild/hParent` [p·H+k]. **`rDeath` is a pre-drawn natural death year: the watcher must never read it** (it would leak
  the future).
- Marriage: `rulers/marriage.ts marriageStep` gives each eligible relation one `R.rng` draw `< MARRIAGE.chance` and logs
  RoyalMarriage 87 when both realms are Kingdom-tier or larger.
- Bonds: `polity/bonds.ts` (`newBond` private l.80, `endBond` l.90, `subject` l.101 (vassal or tribute), `allied`,
  `peaceTerms`, `overawe`, `bondStep` l.185). Alliances form per slow step with chance `ALLIANCE.chance` under a common
  threat. BondKind is Vassal 0, Tribute 1, Alliance 2. BondEnd is 0–4 (grudges adds Betrayed 5).
- War: `polity/war.ts declare` l.98 (exported), `closeWar` l.128 (private; grudges plan also asks to export it).
- Knowledge: `s.know.known[p·N+c]` (year or −1) and `s.know.contact`. History has `knownYear`/`contactYear` (Int16). The
  UI's `people=<id>` already shows the world as one people knew it (main.ts URL doc, `ui/peoplesData.ts`).
- Terrain: `terrain.landmass` (Int32 per cell) and `landmassSize`, for "unify the continent".
- UI: `ui/nudgePanel.ts` (the order form, the list, Copy link), `ui/nudgeFormat.ts` (orderStory), `ui/sheet.ts` and
  `ui/compact.ts` (the phone bottom sheet, tabs), `ui/sagas/` (subjects people, state, city, **house**, decade, year;
  `epithets.ts`, `reigns.ts`), `ui/rulersPanel.ts`, `ui/politiesPanel.ts`, `ui/chronicle.ts`, `ui/timeline.ts`.

---

## 2. Measurements [M]

| probe (scratch-seat/probes) | result |
|---|---|
| `live-empty.ts` s42, 600 y: runner with an **empty** live orders state vs no orders | identical except the two extra empty fields `orders: []`, `orderOutcomes: []` (the assembly must omit them when n = 0) |
| `live-append.ts` s42 Y=600→900 (Fortify, Explore) | **append at Y−1 ≡ from-scratch** (hash equal, outcomes equal), and the history did change |
| `live-append.ts` s7 Y=1000→1150 (Fortify, Explore, War 1→2) | ≡; the War order was Fulfilled in 1010 in both |
| `chain.ts` s7: 3 decisions appended in sequence (War@1000; Peace + Seat@1015; Explore@1040) | ≡ from-scratch with the whole list |
| `inert.ts` s1, 700 y: orders that fail when given (no such actor) | every field identical to no orders, apart from 170–173 events and the orders fields. This is the premise of the record-only `Choice` kind |
| times (loaded box) s42: 0→599 | 3.9 s; resume 600→900 2.9 s; from scratch 0→900 9.0 s (s7 0→999 5.7 s) |
| ms/year by 250-year era, s42 (loaded) | 11, 12, 24, 18, 18, 26, 17, 44. The perf agent's unloaded run (perf-scripts/bench-hash.log): 2000 y in 4.9–7.3 s, about 2.5–3.6 ms/y on average |
| `clone-cost.ts` s42: structuredClone of {s, trade, tech} with RNGs set aside (world, terrain excluded) | y300: 26.6 MB serialised, clone 420 ms; y1000: 30.3 MB, 303 ms; y2000: 39.2 MB, 178 ms (noisy) |
| `static-parts.ts` s42: large arrays unchanged from year 1 to 2000 | `s.sp.fit` 3.69, `val` 2.12, `iratio` 2.12, `siteCrop` 1.84, `siteLive` 1.94 = **11.7 MB shareable** (`fitCatch` is mutated by catchCash) |
| `fork-probe3.ts` (the perf agent's, re-run) | typed-array bytes 28.6 / 32.4 / 40.9 MB at 300 / 1000 / 2000; largest parts s.sp ~19–22, goods 1–6.6, pol 2.6–3.9 |

So a checkpoint costs **~17–29 MB** once the static arrays are shared (perf-efficiency's 28.6–40.9 MB minus 11.7, see 3.3).
The History posted at 2000 years is ~35–39 MB (perf-scripts/bench-2000.log) and takes 209–747 ms to assemble under
load. The worker's own comment says ~25 ms unloaded.

---

## 3. Design

### 3.1 The loop
```
pick seat (kind, id) at year Y0 (the year shown)  →  worker: live runner at Y0 (restore checkpoint ≤ Y0, else 0→Y0)
loop:
  worker: step years Y+1…; after each year, watch(s) → cards? ; stop at first year D with cards, or at Y+maxRun (50) with none
  worker: assemble History(D); post {history, cards}; take a pause checkpoint (after posting: hidden behind the card)
  main: play the years since the last pause up to D (reign speed), fly to the card's place, show the card(s)
  player picks an option per card (or "Take back" → restore the previous pause checkpoint)
  main: URL o= gains the orders; worker: addOrders(orders of year D+1, incl. Choice records); continue
end when the seat is lost (SeatLost) or the run reaches the length cap (6000, as today: YEARS_MAX)
```
- Decision orders always have year D+1 and the runner stands at D, so `addOrders` is valid (it throws RangeError for
  `year <= run.year`).
- With no card for `maxRun` years the worker still posts the History. The UI then plays on without a pause.

### 3.2 Continuing without re-simulating: live append (phase A, no checkpoints)
- `orders/state.ts`: new `appendOrders(ox, more: readonly Order[])`. It rebuilds the per-order arrays at n + m, copies
  the dynamic per-order fields (until, status, reason, done, acted, product, place, best, reach, refused), and keeps
  `next`, `active`, `nPolity`, `nTown`, `evSeen`, the per-people tables and the same `rng` object. `sorted` is
  recomputed by (year, list index). Invariant (assert): `sorted[0..next)` is unchanged, because every appended order has
  year > s.year ≥ year of every activated order, and its index n+i sorts after all equal years. This is exactly the
  from-scratch order for `given.concat(more)` [M: probe implementation in scratch `orders/state.ts`].
- `index.ts`: `HistoryOptions.seat` set (or an internal `live` flag) ⇒ create `ox` even with no orders.
  `assembleOrders` emits `orders/orderOutcomes` only when `ox.n > 0` (otherwise the History is not identical, [M]
  live-empty). Hooks are untouched: with no active orders they are neutral [M].
- `HistoryRunner.addOrders(orders)`, and on the contract `HistoryRun.addOrders?(orders: Order[]): void` (optional like
  `simulateTo`). It throws if the run was not created live or if an order's year ≤ year.
- Contract statement (doc comment): "addOrders(o) after advancing to Y−1 gives exactly the history of a run created with
  the orders given so far followed by o, as long as every order of o is for year Y or later". The tests in 7 pin it.

### 3.3 Checkpoints: reuse perf-efficiency P6 (take-back, fast start at any year)
**Not re-specified here.** perf-efficiency.md P6 owns the mechanism: `sfc32.getState()/fromState()`, every mutable
`createRunner` local moved into one `RunnerState`, `checkpoint(): RunnerCheckpoint` (a memoised deep copy that skips
`world`/`terrain`), `createRunnerFrom(world, options, checkpoint)`, the rebuild of `ox` for an extended order list (the
old canonical list is a prefix, the appended orders' years are > the checkpoint year, per-order state copied), the
mandatory `resume.test.ts` (seeds 1/42/1234 × years 50/600/1500 × five kinds, a chained case, a no-alias test), and the
unchanged no-order hashes (2000 y: s1 `923881e7cd3fe59b`, s42 `3bac8db3dfd723b5`, s1234 `2bb9f72e9e99433d`). Seat mode
**depends on its step 9** (`sim: runner state in one object; checkpoint and resume`) and calls only those names.

Seat-specific use and the amendments to P6:
- **Forward play needs no checkpoint.** It uses live append (3.2). That is P6's ox-rebuild rule applied to the *live* run
  (the same prefix + later-year invariant), so `appendOrders` should be the one function P6.3 calls too (amendment:
  P6.3 builds the new `ox` via `appendOrders(oldOxCopy, added)`).
- **Shared static arrays (amendment):** `s.sp.fit, val, iratio, siteCrop, siteLive` (11.7 MB [M], `static-parts.ts`)
  are identical from year 1 to 2000. P6's deep copy should treat them like terrain (shared, not copied). The guard test is
  to hash them at year 1 and at the checkpoint year, which must be equal. This takes a checkpoint from 28.6–40.9 to
  ~17–29 MB.
- **Copy cost:** P6 measured 20–70 ms for the typed-array copy. My `structuredClone` of the whole graph (RNGs set aside)
  took 178–420 ms on the loaded box [M, `clone-cost.ts`], which is dominated by the object graphs (events, records). Use
  P6's custom copy. Take seat checkpoints after posting the History, while the card is read, so they are not on the
  critical path either way.
- **The seat ring** (worker, `seat/cpRing.ts`, on top of P6's ladder; the same storage):
  - pause checkpoints: the latest `cpPauses` pauses, for "Take back";
  - P6's ladder has 500-year marks from the shown run, which a seat started at Y0 reuses: restore the latest ≤ Y0 for
    the seat's options (the seat-off ladder is valid, because seat on changes nothing but its own fields before
    `from`), then simulate ≤ 500 years.
- **Memory budget (phones):** P6 caps phones at **2 checkpoints**, and seat mode keeps that cap in total (P6 ladder plus
  seat ring together): the latest pause plus one older (a pause or a 500-year mark). At ~17–29 MB each that is
  **≤ ~60 MB** (≤ 82 MB without the shared-array amendment). This sits beside the main thread's History (35–39 MB at
  2000 y), scene geometry (73.5 MB) and bakes (128 MB GPU), all per perf-efficiency 1.2. So on a phone, "Take back" goes
  one decision back, and two decisions only if the older slot is a pause. Desktop: 6 checkpoints (≤ ~180 MB). Eviction
  drops the oldest first, but never the latest pause. A device counts as a phone by `isCompact()` or
  `navigator.deviceMemory ≤ 4`. Safari and Firefox have no deviceMemory (MDN BCD 2026; perf-efficiency 1.4 only lists it
  as not measured), so they fall back to `isCompact()`. Chrome reports coarse power-of-two GiB buckets: 0.25–8 before
  Chrome 147 and 2, 4, 8, 16, 32 from Chrome 147 (MDN BCD 2026), so `≤ 4` means 2 or 4 on current Chrome.
- The cost of a fresh start without a checkpoint ≤ Y0 is one run 0→Y0. P6 measured the share of the sim time before
  year 1000 at 30–43 %, so Y0 = 1000 costs ~1.5–3 s of the 4.9–7.3 s full run on the VM; a phone is ×1.5–3 (P6 [G]).

### 3.4 Seats and how a seat follows history (`src/sim/history/seat/`)
```ts
// contract.ts (drafted)
/** What the player rules in seat mode (HistoryOptions.seat). */
export const SeatKind = {
  People: 0, // a people (History.peoples id): its largest polity when it has one, else its towns (people orders only)
  Polity: 1, // a polity (History.polities id); passes to a successor of its own house when it ends (SeatPassed), else is lost
  House: 2, // a ruling house (History.dynasties id): the largest realm it rules; lost when the house ends (DynastyEnded)
  Family: 3, // a merchant family (History.families id; merchant-families plan): later, step 15
} as const
export type SeatKind = (typeof SeatKind)[keyof typeof SeatKind]

/** seat: the player's seat, part of the simulation's input like the seed and the orders (see SeatKind). */
export interface SeatOptions {
  kind: SeatKind
  id: number
  /** The year the player takes the seat (decision cards from the year after it; nothing changes before). */
  from: number
  /** AmbitionKind values the player set out to achieve (scored only; they change nothing in the run). */
  ambitions?: number[]
}
```
`HistoryOptions.seat?: SeatOptions`. Doc: "Default none: undefined gives exactly the history without a seat (History.seat
absent). With a seat and no orders, every field but History.seat and the seat events 270–279 is identical to the run
without one." Seat on, no orders ⇒ hooks neutral, watcher pure read, events pushed only with types 270–279. Risk [A]:
a system that reads `s.events` by index. ordersEnd does, from `evSeen`; renaming and landmarks read the assembled lists.
A test pins it.

Resolution, yearly at the end of `step` (after `ordersEnd`, before the snapshots), `seatYear(s, st)`:
- `st.polity` = the polity the seat holds this year:
  - People: the polity with the largest `pPop` whose capital's people is the seat (−1 none).
  - Polity: itself while `pEnded < 0`. When it ends, check in order: (a) the house of its last ruler rules another
    living polity → that one (cause 0); (b) a successor of this polity's own lineage (Partitioned heir's share,
    CivilWar pretender of the same house, Seceded with the same house) → the largest (cause 1/2/3); else SeatLost.
  - House: the polity with the largest `pPop` among those whose current ruler `R.cur[p]` is of house id. SeatLost at
    DynastyEnded.
- Events: SeatTaken (at `from`), SeatPassed, SeatLost (see 3.7). After SeatLost the watcher stops. The UI offers
  "Take another seat" (a new seat from that year, a new HistoryOptions.seat: a new run) or "Watch on".
- `st.people` = the people of the seat polity's capital (or the People seat). This is the fog's knower.

### 3.5 The watcher and the cards (`seat/watch.ts`, pure reads of HistoryState)
After `seatYear`, `seatWatch(s, st)` scans the year's events (`s.events` from `st.evSeen`) and a few state conditions
for the seat polity `p` (people `k`). Each trigger makes a **Decision** row: `{year, kind, polity, subject, place,
options}`. Rules:
- **No randomness from sim streams.** Tie-breaks and phrasing variants use `mix32(seed ^ year·977 ^ kind·131 ^ subject)`.
  The watcher draws nothing, so the run is untouched.
- **Fog**: a subject polity q needs `contact[k·P + people(q)] ≥ 0`. A subject cell needs `known[k·N + c] ≥ 0`. Events
  are used only if their settlement's cell is known to k.
- **Cadence**: at most `SEAT.maxCards` = 2 rows per year (by `PRIORITY`), none within `SEAT.minGap` = 4 years of the last
  card unless the kind is urgent (WarOnUs, Crisis, Plague), and a per-kind cooldown `SEAT.cool[kind]`. Cards not chosen
  by priority are dropped, deterministically. Warm-up: no card in the year of `from` itself.
- **Options** are computed at detection. Each is `{key: SeatOptionKey, orders: Order[]}` with `year = D+1`, actor p (or
  k, or a town), plus feasibility through the same `check` the orders system uses. Infeasible options are dropped. Every
  card keeps a "let the court decide" option (`orders: []`). Every chosen option also gets the record
  `Choice(actor p, target row·8 + optionIndex)` (OrderKind 10).

| DecisionKind | trigger (D = this year) | options → orders (year D+1) | cool |
|---|---|---|---|
| WarOnUs 0 | WarDeclared with defender p (attacker q) | Fight on (∅) · Sue for peace (Peace p→q) · Offer tribute (Submit p→q) · Seek an ally (Ally p→r, r = the strongest contacted polity with rivalry(r,q) ≥ ALLIANCE.threat, if any) | 0 |
| Opening 1 | a contacted neighbour q in a succession crisis, civil war or regency, `advantageAt(p,q) ≥ SEAT.openAdv` 1.2, no truce, p not at max wars | Strike (War p→q) · Stay out (∅) · Offer a match (Marry p→q, if rulers) | 25 |
| Heir 2 | rulers on, ruler of p aged ≥ SEAT.oldAge 58 (age from rBorn only, never rDeath), or `contestChance(p) ≥ 0.25`, and ≥ 2 eligible heirs | Name A / Name B (Designate p, target hBorn of up to 2 heirs: the law's pick and the best other by legitimacy, then age) · Let the law decide (∅) | 20 |
| Crisis 3 | SuccessionCrisis at p, or a regency opened at p | Placate the magnates (Placate p) · Crush the pretender (War p→pretender polity, when a CivilWar split one off this year) · Endure (∅) | 0 |
| AllianceMade 4 | Alliance event with p as a party | Honour it (∅) · Renounce it (Repudiate p→q) | 30 |
| AllianceSought 5 | rivalry(p, r) ≥ ALLIANCE.threat with r ≥ p in size, and a contacted q also threatened by r (≥ threat), not allied, calm with p (< ALLIANCE.calm) | Seek alliance (Ally p→q) · Go alone (∅) | 30 |
| Overlord 6 | BecameVassal with p as vassal or tributary (value ≥ 1000: tribute), or every 30 years while p is a vassal | Pay (∅) · Defy (Defy p→overlord) | 30 |
| Match 7 | rulers on, a contacted neighbour q with a house, no tie, no war, relR(p,q) < MARRIAGE.maxR, an heir of p aged 14–30 | Arrange the match (Marry p→q) · Decline (∅) | 25 |
| General 8 | rulers on, `overthrowHazard(p) ≥ SEAT.riseX` 0.015, at war or a war lost ≤ 10 y ago | Honour him (Placate p) · Purge him (Purge p) · Ignore (∅) | 15 |
| Plague 9 | GreatEpidemic or CityStricken at a member town of p (known), first time per epidemic | Quarantine the ports (Quarantine on up to 3 member ports, largest first) · Move the court (Seat p→largest unstricken member ≥ seatShare) · Endure (∅) | per epidemic |
| Faith 10 | religion on, a universal faith f with share ≥ 0.25 of p's realm, not the ruler's, founded | Embrace it (Faith p→f) · Keep the old ways (∅) | 40 |
| Revolt 11 | Revolt at a member town of p | Placate (Placate p) · Fortify the loyal (Fortify on p's capital, if no walls) · Crush it (∅, the sim's own response) | 15 |
| Credit 12 | finances on: `finNeed(s,p) ≥ 0.5` | Borrow (Borrow p) · Raise taxes (Levy p) · Retrench (∅) | 20 |
| Charter 13 | city-states on: a member town passes their charter-demand test (their 4.4 `wealth/force` ≥ demand) | Grant (Charter p→town) · Refuse (∅) | 30 |
| Betrayal 14 | grudges on: p is ally x in an alliance war and their `case` ≥ SEAT.betrayCase 0.5 | Make a separate peace (Betray p→q) · Stand by (∅) | 20 |
| Frontier 15 | ExpeditionReturned at a town of k with value ≥ 20 new cells | Settle toward (Settle k→c: c = the newly known free cell with the best capacity, no town within 3 hops) · Explore further (Explore k→c' at the frontier) · Stay (∅) | 30 |
| Crop 16 | a contacted people holds species x that k lacks and that fits a town of k (`check` says None) | Take it up (Crop k→x) · Ignore (∅) | 30 |
| Idea 17 | IdeaAdopted or IdeaConceived by a contacted people, idea i not held by k, prerequisites held | Seek it (Idea k→i) · Ignore (∅) | 30 |

`PRIORITY` = WarOnUs, Crisis, Plague, Overlord, General, Heir, Revolt, Betrayal, Opening, AllianceMade, AllianceSought,
Credit, Charter, Match, Faith, Frontier, Idea, Crop. Kinds 12–14 exist only when their system is on. Kinds 15–17 are the
whole game for a People seat without a polity. Measured cadence targets are in 8.

Pure helpers extracted from existing code, with identical arithmetic so hashes do not move:
`overthrowHazard(s, ps, R, p)` from rulerYear l.436–440, `contestChance(s, ps, R, p)` from `succession`, and
`eligibleHeirs(R, p, year, out)`. The rulers code then calls the helpers.

### 3.6 New order kinds (contract `ORDER_KINDS` rows, hooks in `orders/hooks.ts`, effects in `orders/seatOrders.ts`)
Every hook is neutral when the order is absent. An ordered branch **keeps the existing draw** and only reinterprets it.
Any extra decision draws from `ox.rng` (`'history-orders'`), so other streams keep their draw counts.

| kind | key | actor → target | years | rule |
|---|---|---|---|---|
| Choice 10 | `choice` | polity or people → `row·8 + option` | 0 | Records the player's choice. No effect. `check` = None, so it is Fulfilled (Done) at give. With the OrderGiven event, this is what the saga reads. |
| Repudiate 11 | `renounce` | polity → polity | 1 | At give: end the alliance bond (a,b) with `BondEnd.Renounced: 6` (new) and any marriage tie (`endTie`); `relR += SEAT.renounceR` 0.25. With oaths on, record `GrievanceKind.AllyBetrayed` with w × 0.5 (amendment to grudges, 10). Event BondRenounced 277. Reasons: NoTarget when there is no bond or tie. |
| Defy 12 | `defy` | vassal or tributary → overlord | 1 | At give: `endBond(k, BondEnd.Freed)` as bondStep's throw-off does (BecameVassal extra 1), `relR = max(relR, VASSAL.secedeR)` (the same as grudges' line 71 rule). War follows by the usual drive. Event BondRenounced 277 (extra BondKind). |
| Submit 13 | `submit` | polity → its enemy in war | 10 | Yearly while in force, after `peaceAfter`: one `ox.rng` draw `< SEAT.submitChance` 0.35 ⇒ `closeWar(w, outcome = enemy gains)` + `subject(s, ps, p, q, tribute=true)` (the existing tribute terms: VASSAL.tribute for tributeYears). Fulfilled on the bond. Event TributeOffered 278. Needs `closeWar` exported (also asked by grudges). |
| Ally 14 | `ally` | polity → polity | 20 | In the alliance pass of bondStep, for an ordered pair: the threat test reads `threat·SEAT.allyThreat` 0.6, the calm test is unchanged, and the existing draw compares with `ALLIANCE.chance·SEAT.allyMul` 4. Tier rules are unchanged (TooWeak). Fulfilled on the Alliance event. |
| Marry 15 | `marry` | polity → polity | 15 | In marriageStep, for an ordered pair: the `relR ≥ maxR` test is waived, the other tests stay, and the draw is still made: `if (rng.next() >= chance && !(ordered && ox.rng.next() < consent)) continue` with `consent = SEAT.marryConsent 0.6 · (1 − relR(a,b))`. Fulfilled on the tie. |
| Designate 16 | `designate` | polity → heir's hBorn | 40 | `pickHeir`: if a living heir of p with `hBorn = target` is eligible under the law (cognatic or male; legitimate unless the law takes bastards), it is chosen. `contested` chance × SEAT.designateLaw 0.6 when the designee is the law's own pick, × SEAT.designateOver 1.6 when it is not (designations against custom were contested, e.g. the Anarchy after Henry I named Matilda: his barons swore to her in 1127, Stephen took the crown in 1135 and civil war followed, Royal Household n.d.; illustrative, not a calibrated rate). Event HeirNamed 274 at give. Fulfilled at the designee's accession, Failed (TargetGone) if the designee dies first. |
| Placate 17 | `placate` | polity | 15 | At give: cost `SEAT.placateCost` 0.15 of the capital's wealth (with finances: `finSpend(s, p, SEAT.placateR 0.5 · R°)`, not paid ⇒ Failed Refused). In force: overthrow x × SEAT.placateMul 0.35; an open crisis ends ≤ year+1 (`pCrisisUntil = min(…, year + 1)`); member unrest × 0.7 once. Event CourtPlacated 275. |
| Purge 18 | `purge` | polity | 12 | At give: one `ox.rng` draw `u < SEAT.purgeFail 0.15 + 0.4·max(0, 1 − ability)` ⇒ `R.kill[p] = ReignEnd.Overthrown` (enacted the next rulers' year: the general struck first). Otherwise, in force, overthrow x = 0 and `rulerMass × SEAT.purgeMass 0.9` (the army's best men gone). Event GeneralPurged 276 (extra 0 purged, 1 struck first). |
| Borrow 19 | `borrow` | polity | 10 | finances only: in 2.4.5 the target = `chest·war` even in peace (a war chest). Without finances the kind is SystemOff. |
| Levy 20 | `levy` | polity | 10 | finances: taxMul eases to taxMax (their 2.4.7, rate × 3). Proxy without finances: at give, the capital's wealth += SEAT.levyShare 0.1 · Σ member wealth (taken from members), member unrest += 0.08. Event LevyRaised 279. |
| Charter 21 | `charter` | polity → member town | 10 | city-states: their charter branch for that town runs with chance 1 (their draw kept) at their price. Without city-states: SystemOff. |
| Betray 22 | `betray` | polity → ally | 5 | grudges: in `betrayalStep` the ordered pair defects if `offer > 0 or tired > 0.5`, with chance 1 (`rngOath` draw kept). Without grudges: SystemOff. |

`ORDER_KIND_COUNT` = 23. `orderFeasible` gains the same checks (UI greying), and the OrderReason values gain `NoBond: 26`,
`NoHeir: 27`, `NoGeneral: 28` (for Purge or Placate when nothing threatens; the UI hint only, `check` still allows it).
The Nudge panel lists 11–22 only in seat mode (they need the court's context), and never Choice.

### 3.7 Contract: events 270–279, tables, params
```ts
  // seat: the player's seat (270-279; none when HistoryOptions.seat is undefined).
  SeatTaken: 270, // the player took the seat (HistoryOptions.seat) at its year: `settlement` the seat polity's capital (or the people's largest town); `other` -1; `value` the seat's id; `extra` the SeatKind
  SeatPassed: 271, // the seat passed to the polity `value` ruled from `settlement`: `other` the old capital (-1); `extra` how: 0 the house's other throne, 1 a partition heir's share, 2 the pretender's realm (civil war), 3 a seceded realm of the same house
  SeatLost: 272, // the seat ended: `settlement` its last capital; `other` the conqueror's capital or -1; `value` the seat's id; `extra` the SeatEnd (0 realm conquered or absorbed, 1 house ended, 2 people gone, 3 overthrown with no throne left)
  AmbitionFulfilled: 273, // the seat achieved ambition `value` (AmbitionKind) at `settlement` (its capital then); `other` -1; `extra` the years since the seat was taken
  HeirNamed: 274, // the ruler `value` (History.rulers) of the polity ruled from `settlement` named an heir by order; `other` -1; `extra` the heir's birth year
  CourtPlacated: 275, // the court ruled from `settlement` bought off its restive (a general, magnates, rebels): `other` -1; `value` the polity id; `extra` the wealth spent
  GeneralPurged: 276, // the ruler of the polity ruled from `settlement` moved against a too-popular general: `value` the polity id; `other` -1; `extra` 0 purged, 1 the general struck first (an Overthrown ReignEnded follows the next year)
  BondRenounced: 277, // the polity ruled from `settlement` renounced its bond with the one ruled from `other` by order: `value` the other polity's id; `extra` the BondKind (+16 when a marriage tie was ended with it)
  TributeOffered: 278, // the polity ruled from `settlement` bought peace in war `value` (History.wars) with tribute to the one ruled from `other`; `extra` the years of tribute
  LevyRaised: 279, // the crown ruled from `settlement` raised an extraordinary levy by order (the proxy without finances): `value` the polity id; `other` -1; `extra` the wealth raised
```
```ts
/** Ambitions the player may set (SeatOptions.ambitions), judged yearly while the seat is held. */
export const AmbitionKind = {
  Endure: 0, // hold the seat for SEAT.endureYears (300) years from its year
  Unify: 1, // rule >= 80% of the settled people of the capital's landmass, with >= 5 member towns, for 10 years running
  Faith: 2, // a universal faith founded in a member town, or the state faith's holy city in the realm
  Riches: 3, // the richest realm (coin revenue with finances, else the sum of member wealth) for 25 years running
  Union: 4, // the house holds two thrones at once (a personal union, or two realms ruled by it)
  Monument: 5, // a great landmark completed in the capital while the seat is held
} as const

/** seat: the decisions offered to the player, struct-of-arrays in order (History.seat.decisions). */
export interface SeatDecisions {
  count: number
  /** Year of the decision (its orders act from year + 1); the DecisionKind; the seat polity then (-1); the subject (polity, town, heir birth year, faith, species, idea or cell, per kind); the settlement it is told at. */
  year: Int32Array
  kind: Uint8Array
  polity: Int32Array
  subject: Int32Array
  place: Int32Array
  /** Options of decision d: optStart[d] .. optStart[d + 1] - 1, each an option key (SeatOptionKey) and its orders orderStart[o] .. orderStart[o + 1] - 1 (kind, actor, target; year is year[d] + 1). */
  optStart: Uint32Array
  optKey: Uint8Array
  orderStart: Uint32Array
  orderKind: Uint8Array
  orderActor: Int32Array
  orderTarget: Int32Array
  /** The option chosen (from the Choice orders given at year + 1), -1 when none was (the court's own course). */
  chosen: Int8Array
}
/** seat: (absent when HistoryOptions.seat is undefined). */
export interface SeatHistory {
  seat: SeatOptions
  /** Per year from seat.from to years: the polity the seat held (-1 none): polityAt[y - seat.from]. */
  polityAt: Int32Array
  decisions: SeatDecisions
  /** Per AmbitionKind asked: the year fulfilled, -1 not (yet). */
  ambitionYear: Int32Array
  /** The year the seat was lost, -1 while held. */
  lostYear: number
}
```
`History.seat?: SeatHistory`. `SeatOptionKey` is a small enum (FightOn, SuePeace, OfferTribute, SeekAlly, Strike,
StayOut, OfferMatch, NameHeir, LawDecides, Placate, CrushPretender, Endure, Honour, Renounce, Pay, Defy, Arrange,
Decline, Purge, Ignore, Quarantine, MoveCourt, Embrace, KeepWays, Fortify, Crush, Borrow, Levy, Retrench, Grant, Refuse,
SeparatePeace, StandBy, Settle, ExploreOn, Stay, TakeUp, Seek). `encodeSeat`/`decodeSeat` give the URL form
`seat=house:12:1180[:amb=0.1]`.

Params `seat/params.ts` (`export const SEAT`, one doc line each in the codebase style): `maxCards 2, minGap 4, maxRun 50,
cool[] (table above), openAdv 1.2, oldAge 58, riseX 0.015, betrayCase 0.5, frontierCells 20, renounceR 0.25,
submitChance 0.35, allyThreat 0.6, allyMul 4, marryConsent 0.6, designateLaw 0.6, designateOver 1.6, placateCost 0.15,
placateR 0.5, placateMul 0.35, purgeFail 0.15, purgeMass 0.9, levyShare 0.1, endureYears 300, cpPauses 3,
cpMax {desktop 6, phone 2 (total with P6's ladder)}`. These are all design defaults to tune (8), not historical estimates.

### 3.8 Ambitions, reign summaries and the saga (the payoff)
- Ambitions are judged in `seatYear` (cheap: Unify uses `terrain.landmass` with a sum over `s.living` once a slow step).
  AmbitionFulfilled 273 is logged once.
- **End-of-reign card** (UI only, `ui/seat/reignSummary.ts`) at each ReignEnded of the seat's ruler. It shows the years,
  the cause, wars won/lost/drawn (wars table outcomes with p a party), towns gained and lost (membership snapshots at the
  accession and the end), population ×, decisions taken (count by kind and the chosen keys), and an epithet
  (`sagas/epithets.ts` from the same facts).
- **End of the seat** (SeatLost, or the player stops): "The Saga of House X" through `sagasPanel` subject `house`
  (or `state`/`people`) in both registers. Seat decisions become saga facts in `sagas/facts.ts`: kind `decision` (year,
  DecisionKind, chosen key, outcome of its orders from orderOutcomes). Plus a short "deeds" list (ambitions with years).
  No numeric score in v1 [A: an optional "renown" later].

---

## 4. Determinism and the off switch
- **Seat off (undefined)**: no `ox` unless there are orders, no watcher, no events 270–279. Bit-identical, so the golden
  hashes are unchanged (no filter needed).
- **Seat on, no orders**: identical but for History.seat and the events 270–279 (the filter for the comparison test).
  `ox` exists but is empty [M].
- **URL replay** = one run from year 0 with `{seat, orders}`: identical to the live session, because the orders of year
  D+1 change nothing ≤ D [M], the watcher is a pure function of the state, and it draws nothing. The decisions table on
  replay is the same. `chosen` is read from the Choice orders at assembly, so a replay knows what the player chose.
- Draw order: new kinds draw only from `'history-orders'`, and only where ordered. Ordered branches keep the existing
  draws of R.rng, ps.rng and rngOath (Marry, Ally, Betray, Charter), so the other streams' sequences are unchanged.
- Checkpoints: a restore must be ≡ an uninterrupted run (test 7.6), including module-level state.
- Choice target `row·8 + option` (≤ 8 options) depends on row ids, which depend only on the sim and the watcher
  (deterministic).
- **Cache**: `cacheKeys` serialises every option but years, so seat runs are cached like nudges. A fresh session's
  intermediate histories need not be cached; cache the History at each SeatLost or stop [A].

---

## 5. Worker protocol and main thread
New requests in `worker.ts` (header doc updated):
```ts
| { type: 'seat'; requestId: number; seat: SeatOptions; orders: Order[]; cradles?: number[] }   // start or resume: live runner at the URL's state
| { type: 'seatChoose'; requestId: number; orders: Order[] }  // append (year D+1) and play on to the next pause
| { type: 'seatBack'; requestId: number }                      // restore the previous pause checkpoint (take back)
| { type: 'seatStop'; requestId: number; years: number }       // leave seat mode: extend to `years` without pausing (watch on)
```
Response: `{ type: 'seatPause'; requestId; history: History; cards: number[] /* decision rows at history.years */; lost: boolean }`
(the History is transferred as in `simulateAndPost`: zero-copy, detached in the worker, MDN 2026b).
- `seat` (new or URL load): find the checkpoint ≤ min(from, first order year) for these options. Sparse checkpoints from
  the plain first run are valid for any seat whose `from` and orders are later. Restore it or start from 0, `simulateTo`
  the replay target (the URL `year=` or `from`) with progress posts, then `play()`.
- `play()`: `for (;;) { step one year; rows = watcher's new rows; if (rows || year - last >= maxRun || lost) break }`,
  then assemble and post, then checkpoint (ring). The runner exposes this as `HistoryRunner.playSeat(limit): {year, rows}`
  (`simulateTo` in a loop that breaks on `st.newRows > 0`), so the worker does not need internal state.
- Main (`main.ts`, new `ui/seat/seatController.ts`): keeps `currentSeat` and the orders. Each choice appends to `o=` and
  writes `seat=` with `replaceState` (replaces the current history entry, MDN 2026c), as nudges do. It plays the timeline from the last pause to D at reign speed (default
  4 years/s, adjustable; Space pauses), then flies to the card's place (`flyIn.ts`) and shows the card. While a card is
  open, the timeline can be scrubbed back for reading, never past D.
- Perf note: each pause assembles and transfers the whole History (35–39 MB at 2000 years). At ≤ 1 pause per ~8 years
  this is acceptable on desktop. The main thread's rebuild per History (HistoryIndex, panels) is **not yet measured**
  [A]. Measure in step 7. If > 150 ms on a phone, merge pauses less than 5 years apart (show both cards), and coordinate
  with perf-efficiency on incremental assembly.

---

## 6. UI

### 6.1 Entry
"Take this throne" buttons: Factions panel detail (polity), Rulers panel (house, from the dynasty row), Peoples panel
(people). Later the Goods → Merchant Houses tab (family). Each opens a small sheet: the seat name, the year (the year
shown, editable), the ambitions (checkboxes, max 3), and Begin. Disabled if the subject is not alive at the year
(`sagaSubjectValid` style).

### 6.2 The court (existing panels re-labelled in seat mode; no new data)
- **Realm** (Factions panel pinned to `st.polity` at the year): capital, towns, wars, allies, vassals, tariffs, treasury
  (finances) and rivals (contacted only).
- **Court** (Rulers panel): the ruler (age, ability as words), heirs with ages, the house's thrones, marriages. While a
  Heir card is open, its options are highlighted on the heirs list.
- **Annals** (Chronicle), filtered: events whose settlement's cell `knownYear[k·N + c] ≤ year` and whose polities are
  contacted. Seat events and Choice orders are highlighted.
- **Decrees** (Nudge panel): hidden in seat mode by default. A setting "free decrees" shows it with the people and polity
  kinds 0–9 (sandbox). Otherwise orders come only from cards.
- Fog on the map: seat mode forces the existing `people=<st.people>` knowledge view (switchable to "as the gods see it"
  with a "spoilers" warning).

### 6.3 The decision card (`ui/seat/decisionCard.ts`, `seat.css`)
- Title (kind phrase + subject name), 2–3 lines of situation from what the people knows, and 2–4 option buttons. Each
  button has a one-line "the court expects…" (from ORDER_KINDS.effect and feasibility words, `nudgeFormat.reasonWords`)
  and a small risk note where the rule has one (Purge: "the general may strike first"; Designate against the law: "the
  lords may contest it").
- Desktop: a modal card at the top centre, 420 px, keys 1–4, Esc = "let the court decide" (no confirm needed: it is an
  option, recorded by Choice).
- Phone (`isCompact()`): the bottom sheet goes to `half` with the card as its active tab ("Decision"). Options are stacked
  full-width buttons ≥ 48 px tall in thumb reach (above Android/Material's 48 dp minimum, Android Developers 2026, Apple's
  44×44 pt default, Apple 2026, and WCAG 2.5.5's 44 CSS px, W3C 2023), with no swipe gestures for a choice (accidental). The map above stays
  interactive, and "Show me" flies to the place. Two cards in one year are shown one after another, with "1 of 2" in the
  title.
- After the choice: a toast "Envoys ride for the Oreni court…" and the timeline plays on. "Take back" (in the toast, for
  10 s, and in the menu) is enabled while a pause checkpoint exists.

### 6.4 Chronicle (hedged register) and Legend (story register) lines
`ui/polityFormat.ts describeEvent` (270–279) and `nudgeFormat.orderStory` for Choice, phrased by DecisionKind and key:
- WarOnUs + SuePeace, Chronicle: "1214 — When the Oreni declared war, the court of Tarsa seems to have sought terms at
  once; the annals record envoys, not battles." Legend: "When the Oreni came over the river, Asha did not reach for the
  sword. She sent salt and silver, and the war was over by harvest."
- Heir + NameHeir against the law, Chronicle: "1231 — Queen Asha named her younger son Ivo her heir, passing over the
  law's choice; the lords are said to have murmured." Legend: "Ivo was not the law's heir. Asha made him one, and the
  lords never forgave her for it."
- General + Purge, struck first, Chronicle: "1240 — The king moved against the general Varo; by the next spring Varo, not
  the king, sat in the palace." Legend: "The king reached for Varo's head and lost his own."
- Overlord + Defy, Chronicle: "1302 — Tarsa stopped paying the Vosk their tribute; war, as the chroniclers expected,
  followed within three years." Legend: "Tarsa sent the Vosk an empty chest, and the Vosk came to fill it."
- AmbitionFulfilled Unify, Chronicle: "By 1355 nearly all the towns of the Amber Coast answered to Tarsa." Legend: "From
  the cliffs to the salt marsh, one banner."
- Hedging: a Chronicle line never states the player's motive and never says the choice caused the result, beyond what
  the outcome records (Fulfilled or Failed). "Seems", "is said to" and "the annals record" go where the fact is the
  order and not its effect.

### 6.5 Beliefs (beliefs-and-deception.md, optional; `s.bel !== null`)
- The watcher reads p's beliefs, not the truth, where that plan has them: for the Opening trigger, the believed mass of q
  is `bel.est[2·r + dir]` for relation r = relIdx(p, q) (dir 0 when relA = p). The advantage test uses
  `est / ownMass` in place of `advantageAt` when `est > 0` (0 = not yet formed: fall back to the true advantage only if
  the pair borders, else no card). The card says "our spies/merchants report…" by the `src` bitmask (BeliefSource), and
  gives the uncertainty in words from `varL` ("they may be half again as strong").
- Secret alliances: a protector x of q appears on a WarOnUs/Opening card only if `bKnown[bond] ≥ 0` or p is a member.
- Outcomes still follow the true state, so the player can be deceived by bluffs (`bluff`). That is the intended drama.
  The UI never shows the true value in seat mode unless "as the gods see it" is on.
- No new draws; beliefs off ⇒ the true-state rules above.

---

## 7. Ordered commit-sized steps (files; tests)
Phase A: the continuation (no UI)
1. (Rng state is perf-efficiency P6.1, `getState`/`fromState`; phase A does not need it.)
2. **Live append** (`orders/state.ts appendOrders`, `orders/system.ts` export, `index.ts` live flag + `addOrders` +
   assemble without empty fields, `contract.ts HistoryRun.addOrders?`). Tests (`orders/seatAppend.test.ts`, seed 42,
   short runs ≤ 400 y): (a) live with no orders ≡ no orders (hashAll); (b) append at Y−1 ≡ from scratch (Fortify,
   Explore, War, Peace); (c) a 3-step chain ≡; (d) addOrders with year ≤ run.year throws; (e) a pending later order plus
   an earlier append sorts as from scratch.
3. **Choice kind** (contract row 10, `check` None, Fulfilled at give; encode key `choice`). Test: a run with only Choice
   orders ≡ no orders apart from the orders fields and 170–173 (`hashPreOrders` from orders.test.ts).

Phase B: the seat, cards on existing kinds, a playable minimum
4. **Contract**: SeatKind, SeatOptions, AmbitionKind, DecisionKind, SeatOptionKey, events 270–279, SeatDecisions,
   SeatHistory, HistoryOptions.seat, encode/decodeSeat, describeDecisionKinds (labels). Test: encode round-trip.
5. **Seat resolution** (`seat/state.ts`, `seat/system.ts seatYear`, `seat/assemble.ts`; hook in `index.ts step` after
   ordersEnd). Tests: seat-off golden hash unchanged; seat-on ≡ seat-off filtered (events 270–279 and History.seat);
   Polity seat passes on Partition (find a seed-42 partition via the stats harness) and is lost on conquest; House seat
   follows a union.
6. **Watcher v1** (`seat/watch.ts`, `seat/params.ts`, `rulers/system.ts` extracts overthrowHazard, contestChance,
   eligibleHeirs with unchanged hashes) for kinds 0, 1, 9, 10, 11, 15, 16, 17 (existing order kinds only). Tests: a run
   that pauses (playSeat) ≡ an unpaused run with the same orders (same decisions table); the watcher draws nothing
   (RNG states equal with the watcher on and off); fog (no card about an uncontacted polity); cadence limits.
7. **Worker and minimal UI** (`worker.ts` seat requests, `HistoryRunner.playSeat`; `ui/seat/seatController.ts`,
   `decisionCard.ts`, `seat.css`; main.ts URL `seat=`; the entry button in politiesPanel). Measure the main-thread swap
   cost per pause (perf=1 readout) on desktop and in a phone emulation. Manual check: play 200 years on seed 42 as the
   largest polity of year 800; reload the URL and the same state comes back.

Phase B2: court kinds
8. **Rulers kinds**: Designate, Marry, Placate, Purge (hooks in rulers/system.ts pickHeir, contested, rulerYear;
   marriage.ts; control.ts rulerMass) + cards 2, 3, 7, 8 + events 274–276. Tests per kind: neutral when absent (hash),
   an effect when present (a designee accedes; an ordered match forms more often than unordered across 20 pairs), Purge
   backfire rate ≈ the formula over 200 trials (stats, not a unit test).
9. **Bond kinds**: Ally, Repudiate, Defy, Submit (bonds.ts alliance pass, export closeWar, `BondEnd.Renounced: 6`) +
   cards 4, 5, 6 and the WarOnUs options + events 277, 278. Tests as in step 8.

Phase C: checkpoints (after perf-efficiency step 9 has landed: RunnerState, checkpoint, createRunnerFrom, resume.test.ts)
10. **Seat additions to P6**: the shared static species arrays in the checkpoint copy (the SHARED list in
    `seat/checkpoint.ts` or in P6's copier), and P6.3 built on `appendOrders`. Tests on top of P6's resume.test.ts:
    (a) seat-on run: checkpoint at a pause, take back, choose another option ≡ the from-scratch run with the other
    option; (b) restore twice from one checkpoint gives the same result; (c) interleave two runners (seeds 1 and 42)
    year by year ≡ solo runs (module-level state, P6 Q7); (d) the static-arrays guard.
11. **Seat ring + take-back** (`seat/cpRing.ts`, worker `seatBack`, sharing P6's ladder storage and its phone cap of 2).
    Measure the ms and MB per checkpoint at 500/1000/2000 on seeds 1, 7, 42, 1234 with the shared arrays; check that
    phone eviction holds ≤ 2 checkpoints (≤ ~60 MB).

Phase C2: the court and the payoff
12. **Court panels, fog filter, phone layout, ambitions, reign summary, saga facts** (`ui/seat/*`,
    politiesPanel/rulersPanel/chronicle filters, `sagas/facts.ts`, `polityFormat.ts` 270–279, `nudgeFormat.ts` Choice
    stories). Tests: chronicle filter unit test; saga facts include decisions; every DecisionKind × key has a phrase in
    both registers (table-completeness test).

Phase D: dependent kinds
13. Borrow and Levy (finances, Levy proxy), Charter (city-states), Betray (grudges) + cards 12, 13, 14, event 279. Each
    is off (SystemOff, card absent) without its system. Tests: absent system ⇒ no such card; neutral when absent.
14. **Stats harness and tuning** (`seat/seatStats.ts`, 8).

Phase E
15. **Family seat** (merchant-families' api): actor = family. Cards: lend to the crown or refuse (finances lenders: an
    order `Lend` sets `familyLendCapacity` × 1.5 or 0 for a term), back a side in a civil war (their FamilyBacked rule
    with the side chosen), marry into the ruling house (their FamilyMarriage with chance × 3), move home (their
    FamilyMoved). OrderKinds 23–26 (reserved). Ambition Riches judged on family capital. Separate sub-plan once families
    exist.

---

## 8. Stats harness (`src/sim/history/seat/seatStats.ts`, `npx tsx`/`node --experimental-strip-types`)
Auto-players: **Court** (always ∅: the court's course), **Hawk** (first aggressive option: Strike, Defy, Purge, Fight
on), **Dove** (Peace, Submit, Placate, Marry, Ally), **Random** (hash-chosen). For seeds 1, 7, 42, 1234, seat = the
largest polity at Y0 ∈ {500, 1000}, plus a House seat (the house of that polity's ruler), play 300 years.

| metric | target |
|---|---|
| cards per century held | 4–10 (median), ≤ 2 in any 5-year window |
| largest kind share | ≤ 35 % (no single kind dominates) |
| cards with ≥ 2 feasible options | ≥ 95 % |
| a chosen option's orders Fulfilled or Partly (non-∅ options) | 40–80 % (orders can fail; too high means too easy) |
| divergence: seat survival 300 y, Hawk vs Dove vs Court | the policies differ by ≥ 15 points on at least 2 of 4 seeds (decisions matter); Court survival ≈ the baseline survival of polities of that size [A: measure] |
| Purge backfire rate | 15–35 % |
| determinism | the replay hash of every session ≡ the live session; seat-on-no-orders ≡ off (filtered) |
| sim time from a choice to the next pause | median ≤ 150 ms desktop unloaded (≈ 8 y × ~3 ms + assembly), p95 ≤ 600 ms |
| checkpoint | ≤ 29 MB with the shared arrays, P6 copy ≤ 100 ms (unloaded desktop) |

Output one JSON line per (seed, Y0, policy). Report the cards by kind, options chosen, outcomes, survival, ambitions
reached and timings.

---

## 9. Performance and memory
- Watcher: a scan of the year's events (tens) plus O(relations of p) checks, and Unify once a slow step O(living):
  < 0.1 ms/year [A].
- Forward play costs only the years actually simulated, ~3 ms/year unloaded desktop [M via perf logs], 3–5× on phones
  [A], plus one assembly per pause (25 ms unloaded per the worker comment; 200–750 ms loaded [M]).
- Start of a reign at Y0 without a checkpoint is one run 0→Y0: about 30–43 % of the full run's 4.9–7.3 s at Y0 = 1000
  (P6 [M]), ×1.5–3 on a phone. With P6's 500-year ladder it is ≤ 500 years.
- Memory: see 3.3. The phone total is ≤ 2 checkpoints (≈ 60 MB with the shared arrays) on top of perf-efficiency 1.2's
  budget. Desktop has 6.
- 9.4 Alignment: checkpoint and resume belong to perf-efficiency P6 (its steps 9–10). This plan adds the live-append
  path (no checkpoint, exact [M]), the shared-arrays amendment, and the seat ring on P6's storage. Ordinary nudges gain
  live append too, when the order year is > run.year (open question 2).

---

## 10. Interfaces (amendments to other plans)
- **perf-efficiency P6**: seat consumes `RunnerState`/`checkpoint()`/`createRunnerFrom`/`getState`/`fromState` as
  named there. Amendments: P6.3 uses `appendOrders` (3.2); the copy shares the 5 static `s.sp` arrays (11.7 MB); the phone
  cap of 2 checkpoints is the total across the P6 ladder and the seat ring.
- **beliefs-and-deception**: the watcher reads `s.bel` when it is not null (6.5).
- **Conventions**: OrderKind 10–22 used here, 23–29 reserved for seat (Family), 30+ for other plans. EventTypes 270–279
  are this plan's.
- **grudges-and-oaths**: export `closeWar` (they ask for it too). `betrayalStep` reads `betrayOrdered(ox, x, q)` (forces
  the defection if `offer > 0 || tired > 0.5`, rngOath draw kept). Repudiate records `GrievanceKind.AllyBetrayed` at w × 0.5
  (new small amendment). `BondEnd.Renounced: 6` follows their `Betrayed: 5`. Ordered War still respects truces (their
  [A] line 565); a seat "break the truce" option is deferred to their OathBroken flow.
- **state-finances**: hooks `finWarChest(fin, p, ordered)` for Borrow (target = chest in peace), `finLevy(fin, p)` for
  Levy (taxMul toward taxMax at 3× rate), and Placate's cost through their `finSpend`. Card 12 uses `finNeed ≥ 0.5`.
- **city-states**: `charterOrdered(ox, p, town)` in their 4.4 member-town charter branch (chance 1, their draw kept,
  their price). Card 13 uses their demand test as a pure function (`charterDemand(s, town): number`, an amendment: they
  compute it inline).
- **merchant-families**: SeatKind.Family and step 15 use only their api.ts (`familyLendCapacity`, FamilyBacked and
  FamilyMarriage rules) plus a `familyOrdered` hook. Details are deferred.
- **rulers (in repo)**: extract `overthrowHazard`, `contestChance`, `eligibleHeirs` (pure, identical arithmetic). Add
  hooks to `pickHeir` (Designate), `contested` (designate factor), `rulerYear` (Placate/Purge factor) and `marriageStep`
  (Marry).
- **bonds (in repo)**: export `newBond` (Submit's tribute through `subject`, already exported), and an alliance-pass hook
  for Ally.

---

## 11. Risks, open questions; verified / measured / assumed

### Verified [V]
Orders' structure, hooks and their neutrality, sorted activation; nudges re-simulate from 0 (worker.ts `reorder`); runner
state includes closure locals and closure RNGs; `rDeath` is pre-drawn; the existing UI knowledge view `people=`;
terrain.landmass; the BondKind/BondEnd values; `closeWar` is private and `declare` exported.

### Measured [M]
Live append ≡ from scratch (2 seeds, single and chained, incl. War/Peace/Seat/Explore/Fortify); empty live orders ≡ none
(minus the empty fields); inert orders ≡ none (filtered); state size 26.6–39.2 MB serialised, 11.7 MB static; clone
0.18–0.42 s; ms/year by era (loaded); full and partial run times.

### Assumed [A]
Phone speed 3–5× desktop (an unsourced guess; perf-efficiency guesses 1.5–3×, also unsourced); no module-level state carries across years (test 10c, P6 Q7); events are never mutated after push
(only for the v2 log truncation); the watcher costs < 0.1 ms/y; the main-thread swap cost per pause; all SEAT constants
(design defaults to tune); the RNGs used only at creation (cradles, tourism-springs, species-origins, disease-pool) draw
nothing later (if they do, they are simply registered like the others).

### Risks
- **Pause cadence vs the assembly cost** on long histories (6000 y: ~80 ms unloaded, plus the transfer of a large
  History). Mitigation: merge close pauses, and incremental assembly (perf-efficiency).
- **Seat events shift something that reads `s.events` by position** (ordersEnd scans from evSeen; it only matches its
  own orders). Test 5 pins it.
- **The RunnerState refactor** touches the core loop. Keep it a pure move with golden hashes (step 10a) and land it
  separately from the checkpoint logic.
- **Gameplay balance**: cards that always have one obviously best option. The divergence metric and the Hawk/Dove
  spread show it. Tune the costs (Placate, Purge risk, Designate-over-law) first.
- **Leaking the future**: any watcher read of pre-drawn values (rDeath, a scheduled `R.kill`, `pCrisisUntil` length).
  The rule: the watcher reads only what a court could know (ages, events, sizes, rivalries). Code review checklist plus a
  lint-style test that greps watch.ts for `rDeath`/`kill`.
- **URL length**: ~2 orders per decision × ~15 chars, so ~60 decisions ≈ 2 KB. That is acceptable; beyond ~8 KB, gzip
  (Deutsch 1996) and base64 the `o=` (open question). The 8 KB line follows HTTP's recommendation that senders and
  recipients support URIs of at least 8000 octets (Fielding et al. 2022); browsers accept longer ones.

### Open questions
1. Should "let the court decide" also emit a Choice (it does in this plan, so the saga can say "the king held his
   peace")? It costs URL characters.
2. Should ordinary nudges become live-append when the shown history is not finished (the order year ≥ run.year)? That
   is cheap to add with step 2.
3. Should free decrees (kinds 0–9) be allowed in seat mode by default, or rationed (1 per 20 years)?
4. Polity seat at a civil war: follow the house (pretender or loyalist)? This plan follows the house of the last ruler.
5. Should a seat in a cradle-wished world (c=) carry the wish into the start sheet? It is already part of the options.

## References

Citation audit 2026-11-26. [verified] = a page confirming the claim was opened during the audit;
[unverified] = could not be confirmed (reason given). Web docs are dated by access.

**Outside sources**
- (Royal Household n.d.) The Royal Household. "Stephen and Matilda (r. 1135–1154)". https://www.royal.uk/stephen-and-matilda
  [verified: Stephen's election "contravened the oath he and his fellow barons had sworn in 1127 to Henry's daughter, the
  Empress Matilda"; civil war after Matilda's 1139 invasion]. Corroborated by "The Anarchy", Wikipedia,
  https://en.wikipedia.org/wiki/The_Anarchy (oaths of 1127, 1128, 1131) [verified].
- (MDN BCD 2026) MDN contributors. *browser-compat-data*, `api/Navigator.json` (deviceMemory). https://github.com/mdn/browser-compat-data
  [verified: Chrome 63+ only; Firefox and Safari never; values 0.25–8 before Chrome 147, 2–32 from 147]
- (MDN 2026a) MDN. "The structured clone algorithm". https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
  [verified: Function objects throw DataCloneError]
- (MDN 2026b) MDN. "Transferable objects". https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
  [verified]
- (MDN 2026c) MDN. "History: replaceState() method". https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState
  [verified]
- (Android Developers 2026) Google. "Accessibility: API defaults" (Compose), minimum touch target 48 dp per Material
  Design. https://developer.android.com/develop/ui/compose/accessibility/api-defaults [verified]
- (Apple 2026) Apple. *Human Interface Guidelines*: Accessibility, "Offer sufficiently sized controls" (iOS/iPadOS default
  44×44 pt, minimum 28×28 pt). https://developer.apple.com/design/human-interface-guidelines/accessibility [verified]
- (W3C 2023) W3C. *Understanding WCAG 2.2*, SC 2.5.5 Target Size (Enhanced), Level AAA: at least 44 × 44 CSS px.
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html [verified]
- (Fielding et al. 2022) Fielding, R., Nottingham, M., Reschke, J. *HTTP Semantics*. RFC 9110, IETF, June 2022, §4.1.
  https://www.rfc-editor.org/rfc/rfc9110 [verified: "RECOMMENDED that all senders and recipients support, at a minimum,
  URIs with lengths of 8000 octets"]
- (Deutsch 1996) Deutsch, L. P. *GZIP file format specification version 4.3*. RFC 1952, IETF, 1996.
  https://www.rfc-editor.org/rfc/rfc1952 [verified]
- (Doty-Humphrey n.d.) Doty-Humphrey, C. *PractRand* RNG engines (sfc32). http://pracrand.sourceforge.net/RNG_engines.txt
  [verified]

**Design defaults (no source; not facts)**
- Every `SEAT` constant in 3.7 (maxCards, minGap, maxRun, cool[], openAdv, oldAge, riseX, betrayCase, frontierCells,
  renounceR, submitChance, allyThreat, allyMul, marryConsent, designateLaw, designateOver, placateCost, placateR,
  placateMul, purgeFail, purgeMass, levyShare, endureYears, cpPauses, cpMax), the stats targets in 8, the reign speed of
  4 years/s, the 420 px card, the 150 ms swap threshold, and the 6-checkpoint desktop budget.
- The phone speed factor 3–5× (unsourced; perf-efficiency uses 1.5–3×, also unsourced).

**Measured here**
- Probes in `/home/claude/scratch-seat/probes/`: `live-empty.ts`, `live-append.ts`, `chain.ts`, `inert.ts`,
  `clone-cost.ts`, `static-parts.ts`, plus the perf agent's `/home/claude/plans/perf-scripts/fork-probe3.ts` (re-run) and
  `perf-scripts/bench-hash.log`, `bench-2000.log`. Checkpoint sizes 28.6–40.9 MB and the 30–43% share are quoted from
  perf-efficiency.md (measured there with `fork-probe3.ts` and `bench-nudge.ts`).
