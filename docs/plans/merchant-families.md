# Plan: Named merchant families (houses of trade)

Status: PLAN ONLY. Written against the read-only checkout `/home/claude/ryanmye/worldseed` at commit 8cabf09.
Everything marked **[V]** was read in that tree (file:function given). **[A]** = assumed or a design decision not yet checked
in code. **[M]** = measured on the scratch copy (`/home/claude/scratch-merchants`, probe script `tmp/probe.ts`, Node 22.23,
full 2000-year default runs).

Sibling plans: `/home/claude/plans/state-finances.md`, `/home/claude/plans/city-states.md`,
`/home/claude/plans/grudges-and-oaths.md`. **None of these files existed when this plan was written** (only
`/home/claude/plans/perf-scripts/`), so section 8 sets out the interfaces this plan offers, and the sibling plans should
adopt or amend them. Nothing here depends on finances or city-states being implemented.

Naming used in code: **family** (`families/`, `History.families`, `FamilyFounded`...). "House" is already taken by the
ruling houses (`Dynasty`, saga kind `'house'`, "House of Mera"), and the existing comments already call the per-mart capital
"the merchant houses of the marts". The UI may still say "House Veckin" or "the Veckin of Rilko", with a distinct visual tag.

---

## 1. Current behaviour (verified)

### 1.1 Merchant capital is one number per settlement **[V]**
`src/sim/history/goods/merchants.ts`, `MerchantState` (in `GoodsState.ext.merch`, created by `createMerchants`):
- `mw: Float64Array`: merchant capital per settlement. No agents, no names, no ids.
- `toA/toB: Int32Array`: the lane ends a bypassed mart's merchants flee to. `moved: Uint8Array`: 1 once MerchantsMoved has been logged. `resale`: the year's stock sent on.
- Snapshot: `merchantSnapshot` (called from `index.ts` `snapshot()` with the population snapshots, every 5 years) is ragged, and
  `assembleMerchants` pads it to `History.merchantWealth` (Q x S Float32, the same layout as `population`).

**Inflows** (all in `longhaul.ts` `longHaulSweep`, lines ~670-676, inside the per-leg `k` loop):
- `merchantKeep(g, to, carrier)`: the buyer end keeps `MERCHANT.keep` = 0.6 of the carrier's return. The town's income loses it.
- `merchantKeep(g, from, q*(1-MART.carrier)*gap)`: the seller end keeps the same share of its share of the gap.
- `merchantTurnover(g, from, to, q*pf)`: both ends gain `turnover` = 0.4 of the cargo's worth.
- `merchantResale(g, from, q*pf)` marks the stock that is not charged to the town (habit.ts calls `merchantResaleNet`).
- The call sites know the simulation leg `k`. `merchantKeep` and `merchantTurnover` do not take it today.

**Yearly** `merchantYear(s, g)` (goods `system.ts` `goodsYear`, after `relayYear` and before the decadal phases):
- It pays `pay` = 0.0003 of the capital into `s.wealth` and loses `wear` = 0.0007.
- **Flight**: after `merchantsBypassed` set `toA/toB` (called from `routes.ts relayYear` at `Bypassed`), and while
  `relaySm < BYPASS.share * relayPeak`, 5% a year moves to the lane ends, split half and half. The town loses wealth and
  people with it. `MerchantsMoved` (160) is logged once, with `value` = the capital at that time.
- **Gathering**: 5% a year of a mart's capital moves to the open-leg partner with the most relay income, when that partner
  has 1.25 times its own.
- Cap: at most `maxHead` = 120 a head. An abandoned settlement's capital goes to 0.
- `merchantEcon` (after the trade settle) adds `econ*m/(m+half)` to `s.econ`, where m is the capital a head.

**Spending**: `routes.ts tradeExpedition` checks `s.wealth[h] + merchantFunds(g,h) >= cost` and pays through
`merchantPay(s,g,h,cost)`: merchant capital first, then the town's wealth. When the mart cannot pay, a Kingdom capital may
pay instead (`s.wealth[cap]`). This is the only place capital is spent (grep of `merchantPay`).

**Not wired today** **[V]**: `FleetLost` (64; `longhaul.ts laneYear`, one draw `g.rng.next() < h*X.fleetLost`) is only an
event. It takes no merchant capital. The cargo lost at sea goes through the sweep's `lost` factor instead. Nothing in
polities or rulers reads merchant capital. Crowns have no treasury apart from `s.wealth[capital]`.

### 1.2 Lanes, posts, bypass **[V]**
- Legs: `GoodsState.legA/legB/legKind/legOpen/legPath/legCap/legUse/legHazard/...`. `g.lanes` lists the lane legs, and a
  lane's home (sponsor) is `legA`. `History.longHaul` shows **records** (`legHistory.ts`: `g.ext.legHist.leg[record]` gives
  the sim leg and `legRecord(g,k)` gives the record of leg k). Event `value`s name records.
- `routePass` (every 10 years, `year%10===7`) builds the route-seeking urge, then `tradeExpedition`. On success it logs
  `DirectRoute` (60: settlement = home mart, other = far mart, value = record, extra = variety) and opens a lane, with
  a factory or fort post (`PostFounded` 61, `TradingPost.owner` = sponsor settlement, `host` for a factory, `leg`). A lost
  expedition logs `VoyageLost` (sea) and returns.
- `postYear`: a factory ends when its lane or a party is gone (cause 0), or is expelled in war (cause 2). `postConquered`
  gives cause 1.
- `relayYear`: once per decade a mart that lived on relay trade and fell under `BYPASS.share` of its peak, after a recent
  lane carried its top variety, logs `Bypassed` (63) and calls `merchantsBypassed`.
- Goods draws come from `'history-goods'` (`g.rng`). The goods decadal phases (`year%10`) are: 1 marts, 3 prospecting,
  5 traditions, 7 routes, 9 secrets.

### 1.3 UI today **[V]**
- `ui/goodsData.ts merchantWealthAt` and `wealthPerHead`, where wealth a head = (wealth + merchantWealth) / pop.
  `ui/historyIndex.ts` adds the two for the wealth view.
- `ui/goodsPanel.ts`: on the Marts tab, the row tooltip reads "its merchants hold N". The settlement inspector reads "Its merchants hold N"
  at a mart or at a bypassed town.
- `ui/goodsFormat.ts`: chronicle and inspector lines for 60-65 and 160, and `goodsGroupKey` groups MerchantsMoved per decade.
- The map layer `render/longhaul.ts LongHaulLayer.setHighlight(legs, settlements, rgb, cells)` already shows bold legs and
  rings around settlements. The family network map can reuse it.

### 1.4 Rulers, names, landmarks (what families hook into) **[V]**
- Rulers (`rulers/state.ts RulerState`): reigns `rPolity/rDyn/...`, houses `dFounder/dHome/dPeople/dVigour`. `R.cur[p]` is
  the current reign. Marriage ties are `mA/mB/mDA/mDB/mYear/mEnd/mActive`. `marriage.ts marriageStep` runs every
  `POLITY.slowStep` (10) years. `RoyalMarriage` (87) needs Kingdom tier. The survival table `survival()` is file-private
  in `rulers/state.ts`, and `deathYear(R, born, year, u)` takes the RulerState. Draws come from `'history-rulers'`.
  `contested()` in `rulers/system.ts` rolls a civil war with `rng.next() < S.civil*(1+members/CIVIL.sizeCrisis)` after
  `rivalCentre`.
- Names are assigned at **assembly**, not in the sim (`index.ts assemble`: `nameWorld`, then
  `assembleRulers(world, R, P, naming)` calls `names/rulerNames.ts nameRulers`). A house name comes from the language of
  its first capital (`naming.tribe[cap]`, `naming.level[cap]`, `naming.language()`, `naming.roots[cap]`), uses the streams
  `names-house-<id>` and `names-houseaffix-<tribe>-<level>`, and is unique and not nearly the same as an earlier one.
- Landmarks (`landmarks/`) are a pure consequence layer at the end of the year. Its own rows are `lKind/lSett/lBegun/...`,
  and its events are woven in at assembly (`renaming/assemble.ts weaveEvents`: extras go at the end of their year).
  `lm` is a local in `index.ts`, not on `s`. Kinds: `MarketHall`, `Guildhall`, `GreatTemple`, `Lighthouse`, `Library`, ...
- Pure-layer pattern (renaming, landmarks): "on or off, every other field is the same (events aside)". Toggle pattern:
  `HistoryOptions.x ?? X_ON`, with the state created as `null` when off.
- `GoodsState` warns that it is at V8's dictionary-mode property limit. New state therefore goes under `g.ext`
  (today `{ legHist, merch }`).

### 1.5 Scale (measured, default 2000-year runs) **[M]**

| seed | S | marts y1000/1500/2000 | towns with mw>=1k at y1000/1500/2000 | top mw y2000 | total mw y2000 | total wealth y2000 | lanes | posts | Bypassed | FleetLost | RoyalMarriage | CivilWar | Sacked | CityStricken | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1284 | 8/39/75 | 1/20/61 | 2.2M | 4.55M | 2.98M | 7 | 4 | 35 | 2 | 20 | 14 | 254 | 11 | 84* |
| 7 | 1143 | 14/69/114 | 0/34/107 | 1.6M | 8.04M | 7.34M | 23 | 15 | 57 | 21 | 21 | 15 | 210 | 3 | 83* |
| 42 | 1182 | 9/65/87 | 1/23/92 | 0.73M | 4.64M | 5.07M | 13 | 9 | 20 | 8 | 16 | 17 | 226 | 3 | 31 |
| 1234 | 1462 | 10/73/131 | 3/52/104 | 2.4M | 12.7M | 9.73M | 33 | 24 | 43 | 30 | 22 | 10 | 158 | 15 | 88* |

(*three runs in parallel on one box.) Merchant capital is about 0 before year ~800 and grows about 1000-fold from 1000 to
2000. **All thresholds must therefore be relative (shares, ranks, medians), not absolute**, apart from small floors.
FleetLost, CityStricken and lanes are rare on some seeds (seed 1: 2 fleets, 7 lanes), so bankruptcy must have several causes.

---

## 2. Design

### 2.1 Core idea: families own *shares* of town pools (overlay, pure in phase 1)
Keep `merchants.ts` as the **pool** model, unchanged. A family is an agent that owns **seats**: one *home* seat and up to
`maxSeats-1` *branch* (factor) seats. Each seat holds a **share** `σ` of its town's pool `mw[town]`.
Seat capital = `σ * mw[town]`. Family capital = sum over its seats. The rest of the pool, `1 - Σσ`, is "the lesser merchants".

Why shares:
1. Every pool dynamic (pay, wear, flight, gathering, the head cap, abandonment) reaches families automatically, and the
   model stays scale-free while capital grows 1000-fold.
2. Phase 1 can be a **pure consequence layer**. Families only re-divide pools: the family pass never writes `mw`,
   `s.wealth`, `s.pop`, or any other system's state or RNG. Gains and losses (fleet losses, failed ventures, confiscation,
   defaults) move share between a family and the free pool of the same town, so the pool total stays fixed.
   With families on or off, every History field except `families` and the woven-in events is bit-identical.
3. Real feedback (lending to crowns, backing pretenders that changes the odds, city councils) comes in phase 2 behind
   explicit flags (section 3.4). The sibling plans plug in there.

### 2.2 Hooks needed in existing code (bookkeeping only)
All hooks are guarded by `const F = g.ext.fam; if (F !== null)`. They only add to family-owned arrays, so they do not
change any computed value or any draw.

| where | hook | records |
|---|---|---|
| `merchants.ts merchantKeep(g,id,x)` and `merchantTurnover(g,a,b,v)` | gain an optional `k = -1` parameter; `famIn(F, id, k, amount)` | `F.inY[id] += amount`; for a lane `k`: `F.inLegA[k]` or `F.inLegB[k] += amount` (by which end `id` is) |
| `longhaul.ts` sweep lines ~673-675 | pass `k` to the three calls | - |
| `merchants.ts merchantPay` | `F.payY[id] += taken` (the part taken from `mw`) | the venture cost borne by the pool |
| `merchants.ts merchantYear` flight and gather branches | `F.movInY[a] += x` (and b) | capital that arrived from another pool |
| `disease/system.ts` (the two strike sites where the toll at a settlement is known, ~l.133 and ~l.485) | `famToll(s, id, toll)`: `F.tollY[id] = max(F.tollY[id], toll)` | plague at a seat town (CityStricken only covers cities) **[A: check every strike path passes through these two sites]** |

Everything else comes from **scanning `s.events` from `F.evSeen`** at the family pass (the rulers and goods do the same):
DirectRoute, PostFounded, PostLost, Bypassed, MerchantsMoved, FleetLost, VoyageLost, ExpeditionSent, Sacked,
Conquered, Abandoned, WarDeclared, PeaceMade, CivilWar, Reunified, SuccessionCrisis, ReignEnded, DynastyEnded, PolityEnded,
CityStricken. Landmarks are read from `lm` rows (`lKind.length` past `F.lmSeen`).

### 2.3 Where the pass runs
`index.ts step()`: `if (fx) familiesYear(s, fx, lm)` comes **after** `landmarksYear` and before `ordersEnd` and the
snapshots. It runs at the very end of the year, so everything that touches `mw` (sweep, merchantYear, merchantPay) has
already run. Snapshot: `familiesSnapshot` inside `snapshot()`, next to `merchantSnapshot`. Assembly:
`assembleFamilies(world, fx, naming, rulHist.dynasties)` goes after `assembleRulers` (dynasty names are needed for
uniqueness), and its events are woven like the landmark events:
`weaveEvents(weaveEvents(weaveEvents(base, ren), lm), famEvents)`.

### 2.4 State (`src/sim/history/families/state.ts`)
```ts
export interface FamilyState {
  rng: Rng                       // createRng(seed, 'history-merchants')
  // --- per settlement (grown with s.count, doubling) ---
  cap: number
  inY: Float64Array; payY: Float64Array; movInY: Float64Array; tollY: Float64Array   // this year's hooks, cleared by the pass
  m0: Float64Array               // mw[id] at the last pass
  seatHead: Int32Array           // first seat at the town (-1), linked through seatNext
  // --- per sim leg (grown with g.legCount) ---
  lcap: number
  inLegA: Float64Array; inLegB: Float64Array
  laneOwner: Int32Array          // family operating lane k, -1
  // --- families (ragged JS arrays, append-only, ids in order of founding) ---
  fFounded: number[]; fEnded: number[]; fEnd: number[]; fRuin: number[]; fCause: number[]
  fFirstHome: number[]; fHome: number[]; fParent: number[]; fPeople: number[]
  fHomeSeat: number[]            // seat id of the home
  fVigour: number[]              // dynastic-cycle vigour of the present generation
  fHead: number[]                // current head id
  fPeak: number[]                // decaying peak capital (pk = max(c, pk * peakDecay))
  fPeakYear: number[]; fPeakCap: number[]   // lifetime peak, for History
  fLow: number[]                 // years in a row under the fade bar
  fTransit: number[]             // capital still on its way to a new home (emigration)
  fCourt: number[]               // polity whose court it is tied to (marriage or court banker), -1
  fLoan: number[]                // notional crown loan (phase 1 fallback; finances replaces it)
  fLoanP: number[]               // polity of that loan, -1
  alive: number[]                // live family ids, ascending
  // --- seats ---
  sFam: number[]; sTown: number[]; sKind: number[]; sFrom: number[]; sTo: number[]; sCause: number[]; sLeg: number[]; sPost: number[]
  sSig: number[]                 // share of the town pool (live seats)
  seatNext: number[]
  // --- heads ---
  hFam: number[]; hBorn: number[]; hFrom: number[]; hTo: number[]; hDied: number[]; hDeath: number[]; hHow: number[]; hAbility: number[]; hFemale: number[]
  // --- lanes operated, marriages, backings, patronage, home moves (rows) ---
  lnFam: number[]; lnLeg: number[]; lnFrom: number[]; lnTo: number[]
  mgFam: number[]; mgDyn: number[]; mgPolity: number[]; mgRuler: number[]; mgYear: number[]; mgEnd: number[]; mgDaughter: number[]
  bkFam: number[]; bkWar: number[]; bkSide: number[]; bkStake: number[]; bkOut: number[]
  ptFam: number[]; ptLandmark: number[]; ptYear: number[]
  mvFam: number[]; mvYear: number[]; mvFrom: number[]; mvTo: number[]; mvCause: number[]
  events: HistoryEvent[]         // own list (woven in at assembly)
  // --- snapshots (sparse, per population snapshot) ---
  snapFamOff: number[]; snapFam: Int32Array; snapFamCap: Float32Array; famUsed: number
  snapSeatOff: number[]; snapSeat: Int32Array; snapSeatCap: Float32Array; seatUsed: number
  evSeen: number; lmSeen: number
  surv: Float64Array             // survivalTable() (export it from rulers/state.ts; pure in RULERS params)
  diag: FamilyDiag
}
```
Build it with **one object literal** (see the V8 note in `rulers/state.ts createRulers`). Store it as `g.ext.fam` (type
`FamilyState | null`) and also as a local `fx` in `index.ts`.

### 2.5 Params (`src/sim/history/families/params.ts`), defaults to tune
```ts
export const FAMILY = {
  /** Families on by default (HistoryOptions.families overrides; they need goods). Off: History.families empty, everything else identical. */
  on: true,
  /** Phase 2 feedback (pretender odds, real loans, councils). Off: a pure consequence layer. */
  feedback: false,
  // caps (performance; hard)
  maxAlive: 48, maxEver: 400, maxSeats: 8, perTown: 3,
  /** Sum of family shares at a town at most kappa (the lesser merchants keep the rest). */
  kappa: 0.9,
  // founding (decadal, year % 10 === 3)
  foundAbs: 200, foundRel: 0.5, foundChance: 0.2, foundTake: 0.4, ventureTake: 0.3,
  // capture
  own: 0.6, court: 0.3,
  // branches
  branchAbs: 300, branchRel: 1.0, branchChance: 0.3, branchTake: 0.1, branchHalfFree: 0.5, branchCloseShare: 0.03,
  // heads
  founderAge0: 28, founderAge1: 50, headAge: 18,
  howWeights: [0.62, 0.12, 0.10, 0.06, 0.06, 0.04], // Son, Brother, Nephew, Widow, SonInLaw, none (no heir)
  vig0: 1.1, vig1: 1.4, regress: 0.6, drift: 0.04, gen: 0.12, abilityNoise: 0.15, abilityMin: 0.5, abilityMax: 1.6,
  split: 0.15, splitRel: 2.0, splitSeats: 3,
  // shocks and ruin
  fleetMul: 2.0, fleetMax: 0.6, sackLoss: 0.6, seize: 0.5, plagueCourt: 1.5, plagueLoss: 0.5,
  loanShare: 0.3, defaultChance: 0.5, defaultShare: 0.8,
  peakDecay: 0.97, ruinRel: 0.3, ruinChance: 0.7,
  fadeRel: 0.05, fadeYears: 30,
  emigrate: 0.7,
  // marriage (year % 10 === 6), backing, patronage
  marryRel: 0.5, marryChance: 0.15, marryLoanMul: 2, marryYears: 60, marryTop: 2,
  backShare: 0.2, backGain: 0.5, confiscate: 0.3, backBoost: 0.5 /* feedback only */,
  patronRel: 0.3,
}
```

### 2.6 Rules, as formulas (one pass a year; order fixed)
Notation: for town m, `mw = g.ext.merch.mw[m]`. Seats at m are `S_m`. Free share `φ_m = 1 - Σ_{s∈S_m} σ_s`.
`med` = the median capital of the live families (0 when there are none). `a_f` = the current head's ability.

**P1. Event scan** (in event order, from `F.evSeen`). Each handler only marks things or applies the shocks in P3.

**P2. Share accounting** for every town m with a seat (towns in ascending id order, from the `seatHead` lists):
```
G_m  = m0[m] + inY[m] + movInY[m] - payY[m]                 // gross before the year's other outflows
ρ_m  = G_m > 0 ? min(1, mw[m] / G_m) : 0                     // wear, pay, flight, gather-out, cap, abandonment
for s in S_m (seat id order), f = sFam[s]:
  c0  = σ_s * m0[m]
  L_s = own * Σ_{lanes k with laneOwner[k] = f and an end at m} (m === legA[k] ? inLegA[k] : inLegB[k])
R_m  = max(0, inY[m] - Σ L_s)
w_s  = σ_s * a_f * (1 + court * [fCourt[f] === polity(m)]);   w_0 = φ_m
C_s  = R_m * w_s / (Σ w_s + w_0)
P_s  = payY[m] if s is this year's sponsor seat at m (P3 venture), else 0
M_s  = min(fTransit[f], movInY[m] * share) for the new home seat of an emigrating family; fTransit[f] -= M_s
c1   = max(0, c0 + L_s + C_s + M_s - P_s) * ρ_m
σ_s  = mw[m] > 0 ? c1 / mw[m] : 0;   if Σσ > kappa: scale all σ at m by kappa / Σσ
m0[m] = mw[m]
```
Then clear the hook arrays, for touched towns and legs only (keep `touched` lists so the clear costs O(touched)).
A sponsor that loses more than its capital only drops to 0. The remainder came out of the free pool, as `merchantPay` did.

**P3. Shocks** (from the P1 marks; each is applied to the seat as `σ_s *= (1 - loss)` and goes to the free pool):
- **Fleet**: `FleetLost` on lane record r. Leg `k = legHist.leg[r]`, and `f = laneOwner[k]`. The home seat loses
  `min(fleetMax, fleetMul * extra / c_f)`, where `extra` is the cargo value on the event.
- **Venture**: in a year with `ExpeditionSent` from h and `payY[h] > 0`, the sponsor is the seat at h of the richest family
  living there (ties: lower id). With no family at h, the cost stays with the free pool, as today. When no
  `DirectRoute` from h follows that year (`VoyageLost`, or no lane), the loss stands, and a ruin check follows.
- **War**: `Sacked` at a seat town loses `sackLoss` of that seat. `Conquered` of a seat town by a polity at war with the
  family's home polity confiscates the seat (closed, cause Seized). On `WarDeclared` between the home polity and a branch's
  host polity, the branch is seized with chance `seize` (one draw per such branch, in seat order).
- **Plague**: `tollY[home] = t > 0`. The head dies this year with chance `min(1, t * plagueCourt)`, and then succession
  (P4) applies. The home seat loses `plagueLoss * t`.
- **Crown default** (phase-1 fallback, used whenever finances is absent): a family whose `fCourt[f] = p`, or the richest
  family with its home at `pCapital[p]`, carries a notional loan `fLoan = loanShare * Σ_{seats in p} c_s` (re-marked every
  decade). Triggers for p: `ReignEnded` with cause Overthrown, Deposed, Battle or RealmEnded; `DynastyEnded` of the house
  it married; `PolityEnded`; `PeaceMade` of a war that p lost (`ps.wOutcome`; p loses by `AttackerGains` or `Conquest` as
  defender, or `DefenderGains` as attacker). With chance `defaultChance` the seats in p lose `defaultShare * fLoan`,
  pro rata by seat capital. **With finances, this whole bullet is replaced by `familyAbsorbDefault` (section 8.1).**
- **Ruin check** after every shock to f: `pk = fPeak[f]`. If `c_f < ruinRel * pk` and the draw is `< ruinChance`, f goes
  **Bankrupt** with `fRuin` = that shock's cause. All its seats close (cause Bankrupt), their shares go to the free pools,
  its lanes are unowned, and the event is `FamilyFell`.

**P4. Heads** (families in id order):
- **Accession**: a head's `born` is drawn. A founder is `year - U(founderAge0, founderAge1)`. Son or Nephew: the
  predecessor's `born + U(22, 36)`, at least `year - headAge`. Brother: the predecessor's `born + U(-4, 10)`. Widow or
  SonInLaw: `year - U(22, 40)`. The death year is `deathYear(surv, born, year, u)`, a copy of rulers' `deathYear` that
  takes the table. `female = 1` for a Widow. A Son or Nephew can be female with chance 0.08 where the people's law is
  cognatic (`R.cognatic[people]`, when rulers are on). **[A]**
- **Vigour** [design default; the decline across heirs echoes Ibn Khaldun's dynastic life span (Ibn Khaldun, via Wikipedia "Asabiyyah"), no parameter is taken from it]: a founder gets `U(vig0, vig1)`. Each Son, Brother or Nephew generation gets
  `V ← 1 + regress*(V-1) - drift + U(-gen, gen)`. A SonInLaw (the factor who married the daughter) gets a fresh
  `U(0.9, 1.3)` (renewal). Ability = `clamp(V * U(1-abilityNoise, 1+abilityNoise), abilityMin, abilityMax)`.
- **Death** (`year >= hDeath` or a plague kill) draws the next head's how from `howWeights`. A plague year doubles the
  "none" weight. "None" ends the family with **NoHeir** (`FamilyFell`, its seats to the free pools).
- **Split** at a succession when the family has at least `splitSeats` seats, `c_f ≥ splitRel * med`, alive < maxAlive,
  ever < maxEver, and the draw is `< split` (x2 where the people's law is Partible). The richest branch seat becomes the
  home of a new cadet family (`fParent = f`; σ moves with the seat; `FamilyFounded` extra Split, other = the parent's home).

**P5. Home moves**:
- **Bypass emigration**: on `MerchantsMoved` at the home h (this year), with chance `emigrate`, the new home n is
  whichever of `toA/toB` (from `merch`) is alive and has the higher `g.relaySm`. `fTransit[f] = c_home`. The home seat at h
  becomes a branch (it shrinks through ρ as the flight drains h). A seat opens at n (or the family's existing branch there
  becomes the home), and P2 credits it from `movInY[n]`. Event `FamilyMoved`, cause Bypassed. Families that stay fade
  naturally.
- **Town lost**: when the home is abandoned and the family has a branch, its largest branch becomes the home (cause
  TownLost). With no branch, the family ends **TownLost**.
- **Entrepot** (optional, decadal): when gathering has drained the home for 30 years (`mw[h]` fell below half its peak) and
  the family has a branch at the gather target, the home moves there (cause Entrepot). **[A: needs a peak per town; skip
  this in v1 if it gets in the way]**

**P6. Decadal steps** (`year % 10 === 3`, after the goods marts were rebuilt at phase 1):
- **Founding (capital)**: for living settlements in `s.living` order with `g.isMart[m]`, a family is founded when
  `F_m = φ_m*mw[m] ≥ max(foundAbs, foundRel*med)`, homes at m < perTown, alive < maxAlive, ever < maxEver, and the draw is
  `< foundChance`. New home share `σ = foundTake * φ_m`. Event `FamilyFounded`, cause Capital.
- **Founding (venture)** (in P1, at once): on `DirectRoute` from h, the lane `k = legHist.leg[value]` is owned by the
  sponsor family when a family seat paid (`payY[h] > 0`). Otherwise, when h has no family and the caps allow, a family is
  founded at h with cause Venture, `σ = min(ventureTake, φ_h)`, and it owns k (`other` = the far mart: "on the profits of
  the lane to X"). A crown-paid lane is owned by the richest family at h if there is one, or stays unowned.
- **Factories** (P1, at once): `PostFounded` of kind Factory whose post leg is owned by f opens a branch at the host (cause
  Factory, `sPost` = post id). `PostLost` of that post closes it (cause = PostLost's cause mapped: upkeep → Withdrawn,
  conquest → Seized, expelled → Expelled).
- **Branches**: for each live family in id order with fewer than maxSeats seats and `c_f ≥ max(branchAbs, branchRel*med)`,
  the candidates are (a) the far ends of the open lanes it owns, then (b) the open relay-leg partners of its home that are
  marts. A candidate must not be a seat already, must be alive, and its polity must not be at war with the home's. The
  best is the one with the highest `g.relaySm` (ties: lower id). The family opens it with chance `branchChance`:
  `v = branchTake * c_home`, `σ_b = min(v / mw[b], branchHalfFree * φ_b)`, and `σ_home -= σ_b * mw[b] / mw[home]`.
- **Closure**: a branch whose capital stays under `branchCloseShare * c_f` closes (cause Withdrawn).
- **Fade**: `c_f < fadeRel * med` for `fadeYears` years in a row ends the family as **Faded**.

**P7. Court** (`year % 10 === 6`; only with polities **and** rulers on). For each live family f in id order and each
candidate polity p (the home's polity, then the polities whose capital holds a branch of f, in seat order):
- Conditions: p has a reigning house (`R.cur[p] ≥ 0`, `rDyn ≥ 0`) of tier ≥ Kingdom; f has no marriage in force with
  that house; f is among the `marryTop` richest families by capital held in p; and `c_f ≥ marryRel * s.wealth[pCapital[p]]`.
- **Marriage**: with chance `marryChance * (fLoanP[f] === p ? marryLoanMul : 1)`, add a row (dyn = `rDyn[R.cur[p]]`,
  ruler = `R.cur[p]`, daughter = whether a daughter of the house married in (draw 0.7) or a son married a princess), set
  `fCourt[f] = p`, and log `FamilyMarriage`. A tie lapses after `marryYears`, or when that house loses p's throne (seen in
  P1: DynastyEnded, a ReignEnded followed by a new house), or on a war between p and f's home polity. When it lapses,
  `fCourt` returns to -1.
- Effects (pure): the capture bonus `court` at seats in p (privileges, farms of revenue, mines), and the family becomes
  p's court banker, which raises its default exposure. Both are honest trade-offs that the stats can show.

**P8. Backing** (P1, on `CivilWar` e, where `e.settlement` = the pretender seat, `e.other` = the capital and
`e.value` = the war). The families that back the pretender are those whose home is now in the pretender's polity
(`ps.polity[home] === ps.polity[e.settlement]` after the split). Those whose home is the capital back the crown.
- `stake = backShare * Σ_{seats in the old realm} c_s` moves out of the seats (to the free pool, so the pool stays pure)
  and is held on the backing row. Event `FamilyBacked`, extra = war.
- At that war's end (`PeaceMade` or `Reunified` with value = the war or the absorbed polity), the backer's side is read from
  `ps.wOutcome` and the Reunified winner.
  - Won: `stake * (1 + backGain)` returns to the home seat (taken from the free pool, at most `φ`).
  - Lost: the stake is gone. When the family's home is under the winner, it also loses `confiscate` of its home seat, and
    a ruin check follows (cause War).
- Feedback (phase 2 only): in `rulers/system.ts contested()`, the civil roll is multiplied by
  `(1 + backBoost * min(1, Σ_{f with seat at rc} c_f / (s.wealth[pCapital[p]] + 1)))`. This changes only the threshold, not
  the number of draws, so `'history-rulers'` stays in step.

**P9. Patronage** (each year, new `lm` rows): for a landmark begun at town t, of kind MarketHall, Guildhall, GreatTemple,
Lighthouse or Library (and Temple when rank is Lesser: no event, row only), the richest family with a seat at t is its
patron when `c_seat ≥ patronRel * s.wealth[t]`. A patron row is added, and `FamilyPatron` is logged for great landmarks only.
This needs `lm !== null`.

**P10. Bookkeeping**: `fPeak = max(c_f, fPeak * peakDecay)`, the lifetime peak, the fade counter, and at a snapshot year
the snapshot (live families, then live seats, ascending, with their capital).

### 2.7 Contract additions (`src/contract.ts`), in the codebase's style
EventTypes: the "goods: merchant capital (160-169)" block has 161-169 free **[V]**. Use all nine:
```ts
  // goods: merchant families (161-169; none when HistoryOptions.families or goods is false). In each, `value` is the family id (History.families).
  FamilyFounded: 161, // family `value` was founded at its home `settlement`; `other` the far mart of the lane whose venture made it (FamilyCause.Venture), the parent family's home (Split), or -1; `extra` the FamilyCause
  FamilyBranch: 162, // family `value` opened a factor (branch) at `settlement`; `other` its home; `extra` the seat id (History.families.seat*)
  BranchClosed: 163, // the factor of family `value` at `settlement` closed; `other` its home; `extra` the SeatClose cause
  FamilyHead: 164, // a new head took over family `value` at its home `settlement`; `other` -1; `extra` the head id (History.families.head*: who and how)
  FamilyMoved: 165, // family `value` moved its home to `settlement` from `other`; `extra` the MoveCause (bypassed, the town lost, the entrepot)
  FamilyMarriage: 166, // family `value` (home `settlement`) married into the ruling house of the polity ruled from `other`; `extra` the marriage row (History.families.marriage*)
  FamilyBacked: 167, // family `value` (home `settlement`) backed a side in the civil war `extra` (History.wars) whose pretender's seat is `other`; its row says which side and how it ended
  FamilyPatron: 168, // family `value` paid for the great landmark `extra` (History.landmarks row) at `settlement`; `other` -1
  FamilyFell: 169, // family `value` ended at its home `settlement`; `other` the capital of the defaulting polity, the sackers' base, or -1; `extra` FamilyEnd * 16 + FamilyRuin
```
Enums:
```ts
/** How a merchant family began (History.families.cause, the `extra` of FamilyFounded). */
export const FamilyCause = { Capital: 0 /* a trader's fortune at a mart */, Venture: 1 /* a trade expedition that opened a lane */, Split: 2 /* a cadet line took a branch as its home */ } as const
/** How a family ended. */
export const FamilyEnd = { Alive: 0, Bankrupt: 1, Faded: 2, NoHeir: 3, TownLost: 4 } as const
/** What ruined a bankrupt family (0 unless Bankrupt). */
export const FamilyRuin = { None: 0, Fleet: 1, Venture: 2, Default: 3, War: 4, Plague: 5 } as const
export const SeatKind = { Home: 0, Branch: 1 } as const
export const SeatOpen = { Founded: 0, Lane: 1, Factory: 2, Relay: 3, Moved: 4, Split: 5 } as const
export const SeatClose = { Open: 0, Withdrawn: 1, Bankrupt: 2, Seized: 3, Expelled: 4, Sacked: 5, TownLost: 6, Ended: 7 } as const
export const HeadHow = { Founder: 0, Son: 1, Brother: 2, Nephew: 3, Widow: 4, SonInLaw: 5 } as const
export const MoveCause = { Bypassed: 0, TownLost: 1, Entrepot: 2 } as const
```
History field (one object so the History stays tidy):
```ts
  // goods: merchant families (empty when HistoryOptions.families or goods is false; then every other field is as without them, events aside).
  /** Named merchant families: their seats (home and factors), heads, lanes, marriages into ruling houses, backings and patronage. */
  families: MerchantFamilies

/**
 * Named merchant families, struct-of-arrays in order of founding (row = family id; prefix-stable: a longer run repeats a
 * shorter one's rows, except ended / end / peak fields set later). A family owns shares of its towns' merchant capital
 * (History.merchantWealth): its capital at a town at a snapshot is in seatSnap*, and never exceeds that town's merchant capital.
 */
export interface MerchantFamilies {
  count: number
  /** Surname in the language of its first home (the UI says "House Veckin" or "the Veckin of Rilko"); unique among families and ruling houses. */
  name: string[]
  founded: Int16Array
  /** Year it ended, -1 while it trades at the end of the run. */
  ended: Int16Array
  end: Uint8Array // FamilyEnd
  ruin: Uint8Array // FamilyRuin
  cause: Uint8Array // FamilyCause
  firstHome: Int32Array
  /** Parent family (a cadet line split off at a succession), -1. */
  parent: Int32Array
  people: Int16Array
  /** Largest capital it held at a snapshot, and the snapshot's year. */
  peakCapital: Float32Array
  peakYear: Int16Array
  // Seats: a home or a factor at a town, in order of opening. A family's home at year y is its Home seat open at y (moves close one and open another).
  seatCount: number
  seatFamily: Int32Array
  seatTown: Int32Array
  seatKind: Uint8Array // SeatKind
  seatFrom: Int16Array
  /** -1 while open at the end. */
  seatTo: Int16Array
  seatOpen: Uint8Array // SeatOpen
  seatClose: Uint8Array // SeatClose
  /** Lane it serves (History.longHaul record), -1; factory post (History.posts), -1. */
  seatLeg: Int32Array
  seatPost: Int32Array
  // Heads, in order of accession (head id = index); a family's heads are consecutive in time, not in id.
  headCount: number
  headFamily: Int32Array
  /** Personal name in the family's language (the UI adds the surname: "Taro Veckin"). */
  headName: string[]
  headFemale: Uint8Array
  headBorn: Int16Array
  headFrom: Int16Array
  /** -1 while head at the end. */
  headTo: Int16Array
  headDied: Int16Array
  how: Uint8Array // HeadHow
  /** Ability 0.5..1.6, x100 (100 average). */
  headAbility: Uint8Array
  // Lanes operated: family laneFamily ran the lane (History.longHaul record) laneLeg from laneFrom to laneTo (-1 still).
  laneCount: number; laneFamily: Int32Array; laneLeg: Int32Array; laneFrom: Int16Array; laneTo: Int16Array
  // Marriages into ruling houses (History.dynasties), in order of making.
  marriageCount: number; marriageFamily: Int32Array; marriageDynasty: Int32Array; marriagePolity: Int16Array
  /** The reign (History.rulers) at the marriage; 1 when a daughter of the family married into the house, 0 a son wed one of its women. */
  marriageRuler: Int32Array; marriageDaughter: Uint8Array; marriageYear: Int16Array; marriageEnd: Int16Array
  // Backing of sides in civil wars.
  backCount: number; backFamily: Int32Array; backWar: Int32Array
  /** 0 the crown, 1 the pretender; outcome 0 ongoing, 1 won, 2 lost; stake: capital put in. */
  backSide: Uint8Array; backOutcome: Uint8Array; backStake: Float32Array
  // Patronage of landmarks (History.landmarks rows).
  patronCount: number; patronFamily: Int32Array; patronLandmark: Int32Array; patronYear: Int16Array
  // Capital per population snapshot, sparse: snapshot q holds families famSnapFamily[famSnapOffsets[q] .. famSnapOffsets[q+1]) (alive, ascending) with famSnapCapital.
  famSnapOffsets: Uint32Array
  famSnapFamily: Int32Array
  famSnapCapital: Float32Array
  // The same per open seat (the city-states' "wealth of each family in this city").
  seatSnapOffsets: Uint32Array
  seatSnapSeat: Int32Array
  seatSnapCapital: Float32Array
}
```
`HistoryOptions.families?: boolean`: "merchant families: named houses of trade owning shares of the marts' merchant capital
(History.families). Default true. Needs goods. A pure consequence layer: on or off, every other field is the same (events
aside, which gain 161-169)." Diagnostics: `HistoryDiagnostics.families?: FamilyDiag` (founded by cause, ended by cause,
ruin by cause, splits, marriages, backings, emigrations, cap hits).

Also update: `worker.ts` line 176's transfer list, adding the families' typed arrays (helper `familyBuffers(h.families)`);
`history.test.ts`'s exhaustive event switch (add 161-169 next to MerchantsMoved); and `emptyFamilyHistory()`.

### 2.8 Names (`src/sim/names/familyNames.ts`)
`nameFamilies(world, naming, families: {home: number}[], heads: {family, female, parent}[], taken: Set<string>)`, modelled on
`nameRulers`:
- Language: `naming.language(naming.tribe[firstHome], naming.level[firstHome])`.
- Surname: from stream `names-family-<id>`, with endings from `names-familyaffix-<tribe>-<level>` (two morphs, as in
  `morphs()`). With 0.3, fuse the home's root with an ending (a toponymic, "da Rilko" style). With 0.45, fuse a fresh root
  with an ending. Otherwise use a bare fresh root. 3-10 letters, `fluentName`. Unique and not nearly the same as anything in
  `taken` (the dynasty names plus earlier families). A cadet split takes the parent's surname plus a qualifier from
  `placeNames.qualify`-like logic? **Decision: a cadet keeps the parent's surname. The UI distinguishes it as "the Veckin of
  Osk"**, so no new name and no new stream.
- Personal names: from stream `names-familyhead-<id>`, a stock of 6 male and 4 female names per family, drawn the first
  time (as in houses). A Son takes the father's name with 0.3, else one from the stock (favouring the first). SonInLaw and
  Widow names are fresh words of the language.
- Draws only from those streams, in id order, so prefix-stable. Called in `assemble` after `assembleRulers`.

### 2.9 Module layout
`src/sim/history/families/{params.ts, state.ts, system.ts (familiesYear: P1-P10), shocks.ts, court.ts (P7-P8), hooks.ts
(famIn/famPay/famMovIn/famToll; imports nothing of polity), assemble.ts, familiesStats.ts, families.test.ts}`.

---

## 3. Determinism

1. **Stream**: `createRng(seed, 'history-merchants')`, created only when families are on. No other system's stream is touched.
2. **Draw order** within `familiesYear`: P1 event handlers in event order (a draw only inside the handlers that need one:
   seize, plague, defaults, emigration, daughter). Then P3 ruin checks in the order shocks were applied. Then P4 heads in
   live-family id order (deaths, then accessions: born, u for death, how, vigour noise, ability noise, split). Then P6 (only at
   `year%10===3`): founding over `s.living` order, then branches in family id order. Then P7 (at `year%10===6`) and P9.
   P2, P5 (apart from the emigrate draw in P1) and P10 draw nothing. No Map or Set is iterated (membership only).
   Arithmetic uses + - * / and sqrt, as in the rest of the sim.
3. **Prefix stability**: rows are append-only and ids are in creation order. Snapshots are taken at snapshot years only.
   Names are made at assembly from id streams. Test: a 1300-year run equals the first 1300 years of an 1800-year run
   (families, seats, heads, snapshots), as `goods.test.ts` does for `merchantWealth`.
4. **Pure-layer guarantee (phase 1)**: with `FAMILY.feedback = false`, the family pass writes only `F.*`, and the hooks
   only add to `F.*`. Test: for seeds 42:1200, 3:600, 9:800 (n = 24) and 7:900 with goods on, `hashPre` and `hashGoods`
   (from `goods.test.ts`) with families on equal those with families off. The family events must be filtered out of the
   on-run, or compared before the weave. Also compare every History key except `families` and `events`. **The GOLDEN
   hashes in `goods.test.ts` should not change at all**, because the events woven in are not in the off-run. Since families
   default to on, the hash that includes events changes, so the plan is: `hashPre` takes events with type 161-169 filtered
   out (add the filter in the test helper), and then GOLDEN stays.
5. **Toggle**: `HistoryOptions.families ?? FAMILY.on`. The state is `null` when off or when goods is off. `g.ext.fam = null`
   means every hook is a no-op. `History.families` is empty, from `emptyFamilyHistory()`.
6. **Phase 2 (`feedback: true`)**: re-record the goldens with the usual note ("with FAMILY.feedback false the tree was checked
   bit-identical to <hash> on every History field").

---

## 4. UI

### 4.1 Merchant Houses: a new tab in "Goods and trade" (`ui/goodsPanel.ts`)
This avoids yet another right-column panel, which would push others out of the accordion (`panels.ts maxOpenPanels`).
Add `TABS` 'Houses' (index 5), a selection kind `'family'`, and a URL param `family=<id>`.
- **List** (as of the year shown): the live families sorted by capital, each row with a colour dot (a hue from the family id;
  reuse the polity hue function style), the name ("House Veckin"), the home town as sub, a capital bar (share of the top),
  and the number of factors. Below them: "Fallen houses" (collapsed). Ended families are dimmed and show "1312-1488,
  bankrupt (a fleet lost)".
- **Detail** (`familiesPanel.ts`, a section that the goods panel's detail hosts):
  - A title line: "House Veckin of Rilko · founded 1312 on the profits of the lane to Osk".
  - Head now: "Taro Veckin, 54, head for 19 years (son of Ondo)", ability in plain words ("shrewd", "middling",
    "spendthrift"), widow or son-in-law notes.
  - A capital sparkline from `famSnap*`, with marked points for shocks (from events).
  - Seats: the home, then factors with "since 1340", the lane served and the post. Closed ones are dimmed, with the cause.
  - Lanes operated (clicking one selects the lane in the Lanes tab).
  - Marriages: "a daughter wed into House Rilkoik, Kingdom of X (1402)", linking to the Factions detail and the ruler.
  - Wars backed ("backed the pretender at Osk in the war of 1455: lost").
  - Patronage (linking to the landmark).
  - Heads strip, like the rulers lineage strip: name, years, kin to the predecessor.
  - The end.
- **Map**: on select, `longHaul.setHighlight(legs, settlements, rgb, [])`:
  - legs = the sim legs of the lanes it operates (via `legPair` and records), plus the open legs between its home and each
    open factor;
  - settlements = home (gold ring) + factors (the family hue);
  - and fly to the home.
  **[V: setHighlight exists with that signature; A: whether rgb per ring may differ per settlement: the doc says "sRGB per
  ring or one colour"]**
- **Inspector** (goods section): replace "Its merchants hold N" with "Its merchants hold N: House Veckin 41%, House Osra 12%
  (a factor of Osk)", from `seatSnap*` at the population snapshot of the year.
- **Factions detail** (rulers section): "Bankers to the crown: House Veckin" and the marriage lines, via
  `setPolityRulersHooks` or a parallel hook.
- **Chronicle**: `ui/familiesFormat.ts` with `isFamilyEvent(t)` (161-169), `describeFamilyEvent`,
  `describeFamilyEventFor(h,e,id)`, and `familyGroupKey`, which groups FamilyBranch per family per decade and FamilyHead never.
  Wire it into `format.ts` next to `describeGoodsEvent`, into `historyIndex.ts` grouping, and into `chronicleFilter.ts` as
  TRADE (FamilyMarriage and FamilyBacked go to POLITICS).

Chronicle and inspector lines (plain, as the existing goods lines):
- 161: "House Veckin is founded at Rilko on the profits of the lane to Osk" / "Taro Veckin, a trader of Rilko, founds House Veckin".
- 162: "House Veckin opens a factor's house at Osk".
- 163: "The Veckin factor at Osk is seized as war breaks out".
- 164: "Ondo Veckin succeeds his father at the head of House Veckin".
- 165: "House Veckin leaves Rilko for Osk as the lane passes Rilko by".
- 166: "A daughter of House Veckin marries into the royal House of Rilkoik".
- 167: "House Veckin backs the pretender at Osk".
- 168: "House Veckin pays for the Market Hall of Rilko".
- 169: "House Veckin is ruined when the crown of Mera defaults" / "...when its fleet is lost on the lane to Osk" / "House
  Veckin dies out: Ondo Veckin leaves no heir".

### 4.2 Sagas: subject `family` (the analogue of `house`)
- `ui/sagas/types.ts`: add `'family'` to `SagaKind`. In `index.ts`: `case 'family': s = familySaga(c, id, legend)`, the
  `sagaSubjectValid` rule (`id < h.families.count && founded <= year`), and the `parseSubject` regex. In `refs.ts`: the title
  text. In `library.ts`: the group 'Merchant houses'. In `sagasPanel.ts`: the kinds list, disabled without families.
  `ui/sagas/family.ts` follows `house.ts`, with a `PhraseTable` and `Voice(c.seed, 'family:'+id, legend, T, OMEN_T)`.
- Chapters: Founding · The lanes and the factors · The heads · Crowns and courts (marriages, loans, backings) ·
  Patronage · The fall (or "In {Y} it still trades").
- City saga (`city.ts`) gains one line: "It was the home of House Veckin from 1312".
- State saga: "Its crown borrowed from House Veckin" (phase 2 with finances).

The chronicle register hedges, as `omens.ts` does ("It is held that...", "the records say"). The legend register tells a
story. Example `T` entries (`[chronicle variants], [legend variants]`):
```ts
title: [['The Chronicle of House {name}'], ['The Saga of the {name}']],
founder: [
  ['The ledgers of {home} record that House {name} was founded in {year} by {head}, it seems on the profits of a venture to {far}.',
   'House {name} appears in the records of {home} in {year}; its founder, {head}, is said to have made his fortune on the lane to {far}.'],
  ['{head} came home to {home} from {far} with holds full of {good}, and on that cargo the house of {name} was built.'],
],
founderCapital: [
  ['By {year} the name of {name} stands among the great merchants of {home}; the first of them recorded is {head}.'],
  ['In {home} the counting-houses grew rich, and the richest of them was the house of {head}, called {name}.'],
],
branch: [
  ['It kept factors at {list}, as far as the records show.'],
  ['Its factors sat in {list}, and wherever its ships put in a {name} was waiting on the quay.'],
],
head: [
  ['{head} is recorded as head of the house from {from}; {kin}.'],
  ['{head}, {kin}, took up the keys of the house in {from}.'],
],
sonInLaw: [
  ['When {prev} died without a son, the house seems to have passed to {head}, who had married his daughter.'],
  ['{prev} left no son; but his daughter had wed {head}, the cleverest of his factors, and the house went on.'],
],
marriage: [
  ['In {year} a daughter of the house is said to have married into House {dyn}, then ruling {state}.'],
  ['In {year} a {name} bride was led into the halls of House {dyn}, and the counting-house sat at the king\'s table.'],
],
backed: [
  ['In the civil war of {year} the house appears among the backers of {side}; the cause {won}.'],
  ['When {state} broke in two, the {name} put their gold behind {side}, and {wonL}.'],
],
patron: [
  ['{lm} at {town} is ascribed to the house\'s money ({year}).'],
  ['They raised {lm} at {town} in {year}, that men would remember the name of {name}.'],
],
fellFleet: [
  ['The house seems to have failed in {year}, after a fleet was lost on the lane to {far}.'],
  ['In {year} the sea took the {name} fleet off {far}, and with it the house: the creditors came before the mourners.'],
],
fellDefault: [
  ['In {year}, the records suggest, the crown of {state} would not repay, and House {name} failed.'],
  ['The king of {state} would not pay what he owed, and in {year} the house of {name} broke like a dropped jar.'],
],
fellWar: [['The house is not heard of after the sack of {town} in {year}.'], ['When {town} burned in {year}, the ledgers of the {name} burned with it.']],
faded: [['After {year} the name of {name} drops from the lists of the great merchants.'], ['The {name} grew small, and by {year} none sang of them.']],
noHeir: [['It ended in {year} with {head}, who left no heir.'], ['{head} was the last of the {name}; in {year} the house went into the dark with him.']],
trades: [['In {Y} it still trades from {home}, under {head}.', 'It is recorded as trading in {Y}, headed by {head}.'], ['In {Y} the {name} still trade from {home}, and {head} holds the keys.']],
closing: [['Here ends the chronicle of House {name}.'], ['So ends the saga of the {name}.']],
```

---

## 5. Ordered commit-sized steps

Each step ends with `npm run typecheck` and `npx vitest run src/sim/history/goods src/sim/history/families
src/sim/history/history.test.ts` (plus the UI tests touched).

1. **Contract and skeleton.** In `contract.ts`: the enums, EventTypes 161-169, `MerchantFamilies`, `History.families`,
   `HistoryOptions.families`. Add `families/params.ts`, `families/assemble.ts emptyFamilyHistory`. In `index.ts`: assemble
   with an empty table. In `worker.ts`: the transfer list. In `history.test.ts`: the switch cases. Test: the shapes are
   empty with goods off, and every existing golden is unchanged.
2. **Hooks.** In `merchants.ts`: the optional `k` on `merchantKeep` and `merchantTurnover`, and `famIn`, `famPay` and
   `famMovIn` calls. In `longhaul.ts`: pass `k`. In `disease/system.ts`: `famToll`. Add `families/hooks.ts`. State is
   created with no pass yet. Test: goldens unchanged with the state created (hooks live).
3. **Share accounting and founding (capital, venture), lanes owned, snapshots, assembly (names stubbed "F<id>").**
   `families/state.ts`, and in `system.ts`: P1 (DirectRoute only), P2, P6 founding, P10. Tests:
   - invariant `Σ seat capital at town ≤ kappa*merchantWealth + 1e-3`;
   - snapshots sparse and sorted;
   - pure-layer equality (section 3.4);
   - prefix stability.
4. **Names.** `names/familyNames.ts`, called in `assemble`. Tests:
   - unique;
   - not equal to any dynasty name;
   - same with a longer run;
   - the language is the first home's (the name built from the home's root in about 30%; check `naming.roots` usage).
5. **Heads and succession, vigour, NoHeir, splits** (P4). Export `survivalTable()` from `rulers/state.ts` (pure), and add
   `famDeathYear`. Tests:
   - head intervals tile the family's life;
   - `headBorn < headFrom`;
   - a cadet's parent is alive at the split;
   - FamilyHead event and head rows agree.
6. **Branches and factories, closures, emigration on bypass, town lost** (P5, P6 branches, P1 PostFounded and PostLost,
   MerchantsMoved, Abandoned). Tests:
   - every Factory post whose lane has an owner has a branch;
   - every FamilyMoved follows a MerchantsMoved at its `other` (Bypassed cause);
   - exactly one open home per live family at every year.
7. **Shocks and bankruptcy** (P3: fleet, venture, sack, conquest, seizure, plague, notional crown default; the ruin check;
   FamilyFell). Tests:
   - a bankrupt family has no open seat after its end;
   - ruin causes match their precipitating events (FleetLost on its lane, the same year);
   - `end`, `ruin` and the event extra agree.
8. **Court: marriages and backing** (P7, P8; gated on polities and rulers). Tests:
   - every marriage's dynasty reigned in that polity at that year (`reignIds`);
   - tier ≥ Kingdom;
   - lapse rules;
   - backing rows reference CivilWar wars (`h.wars.kind === CivilWar`), with the outcome consistent with the war's outcome.
9. **Patronage** (P9, when lm is on). Test: the patron had a seat at the landmark's town at its begun year.
10. **Stats harness** `families/familiesStats.ts` and tuning (section 6). Commit the tuned params.
11. **UI data and chronicle**: `ui/familiesData.ts` (indexes: seats by town, families by year, capital at snapshot,
    `councilAt`), `ui/familiesFormat.ts`, wiring into `format.ts`, `historyIndex.ts` and `chronicleFilter.ts`, and the
    inspector line. Tests: the format tests in the existing UI-test style (look at `src/ui/*.test.ts` if present
    **[A]**).
12. **Goods panel Houses tab, detail, and map highlight.**
13. **Sagas** `family` subject, refs, library, sagasPanel, and the city saga line. Test: a saga generates for every family
    on seed 42 with no `{slot?}` left, in both registers.
14. **Interfaces for siblings** (section 8): `families/api.ts`, with the feedback flag default off and unit tests on a
    synthetic state. Pure-layer equality is still green.
15. (Phase 2, after finances or city-states land) `FAMILY.feedback = true`: real loans, the pretender boost, council
    wiring. Re-record the goldens with the bit-identity note.

---

## 6. Stats harness (`src/sim/history/families/familiesStats.ts`)
Run with: `node src/sim/history/families/familiesStats.ts [seed ...]`, default seeds `1 7 42 1234`. It runs the history once
per seed with families on, plus once with them off when `--check-off` is given (the pure-layer check on all fields). Report
per seed and in summary:

| metric | target (tune toward) |
|---|---|
| first family founded (year) | 600-1100 (capital appears ~800, section 1.5) |
| live families at 500/1000/1500/2000 | 0-2 / 3-12 / 15-40 / 30-48 (the cap binding in < 30% of decades after 1500) |
| families ever | 80-300 |
| lifetime (ended families): median / p90 / max | 90-200 / ≥ 300 / ≥ 500 on at least 2 of 4 seeds |
| end causes: Bankrupt / Faded / NoHeir / TownLost | 20-40% / 30-50% / 10-25% / ≤ 10% |
| ruin causes (over the 4 seeds) | every cause ≥ 1; no cause > 50% of bankruptcies; Default ≥ 15% |
| heads per family, tenure mean | 3-8, 18-30 years |
| splits | 5-25 per seed |
| marriages into ruling houses | 3-15 per seed, ≥ 1 on every seed; ≥ 1 into an Empire across the 4 seeds |
| backings | 30-70% of CivilWars after year 1000 have ≥ 1 backer |
| emigrations | ≥ 30% of MerchantsMoved at towns with a family home produce FamilyMoved |
| capital concentration: top family / all family capital at 2000 | 0.08-0.3 (no single runaway) |
| family share of all merchant capital at 2000 | 0.35-0.7 |
| factors per live family at 2000: mean, max | 1.5-4, ≤ maxSeats |
| lanes with an owner | ≥ 60% of open lanes |
| invariant breaches (Σσ > kappa + 1e-9, negative capital, a family with ≠ 1 home) | 0 |
| time: families pass and hooks | < 1% of the run (`performance.now()` around `familiesYear`) |

Print a per-seed list of the top 5 houses at 1500 and 2000 (name, home, founded, capital, factors, marriages), so their
names and stories can be read in review.

---

## 7. Performance and memory
- Per year: an event scan of the new events (tens a year), P2 over ≤ 48×8 = 384 seats plus their towns, the decadal steps
  over ≤ ~150 marts and ≤ 48 families, and no path searches. This is O(10³) operations a year, so ≲ 0.1 s per 2000-year
  run against 31-85 s **[M]**: < 0.3%.
- Hooks: in the sweep's inner loop, 3 extra guarded array adds per cargo moved: negligible (< 0.5%). They cost a null check
  when off.
- State: per-settlement Float64 ×5 (`inY`, `payY`, `movInY`, `tollY`, `m0`) plus Int32 `seatHead` at a cap of ~2048 is
  ~90 KB. Per-leg Float64 ×2 plus Int32 at ~2048 legs is ~40 KB. The ragged JS arrays hold ≤ 400 families, ~1500 seats and
  ~2000 heads: < 0.5 MB.
- History: `famSnap` 401 × ≤ 48 × 8 B ≈ 150 KB. `seatSnap` 401 × ≤ 384 × 8 B ≈ 1.2 MB worst, ~0.3 MB typical. Tables are
  < 100 KB. Names: ~2400 short strings. Worker transfer: add the typed arrays to the transfer list.
- Hard caps: `maxAlive` 48, `maxEver` 400, `maxSeats` 8 and `perTown` 3 bound everything. A founding when the caps are full
  is skipped, which is deterministic, and counted in the diagnostics.

---

## 8. Interfaces for the sibling plans

### 8.1 For `state-finances.md` (royal borrowing and defaults)
Proposal: **finances owns the loan table** (the polity side: principal, rate, year, status, `lender`). Families provide
capacity and absorb defaults. `families/api.ts`:
```ts
/** Capital family f can lend to polity p now: lendShare of its seats' capital in p's towns (its home's polity counts its home seat whole), less what it has out to p. 0 when families are off. */
export function familyLendCapacity(s: HistoryState, f: number, p: number): number
/** Families able to lend to p, by capacity (desc; ties by id), into `out`; returns the count. */
export function lendersFor(s: HistoryState, p: number, out: Int32Array): number
/** f lends `amount` to p: its seats in p give it pro rata (mw of those towns falls: FEEDBACK). Returns the amount lent. */
export function familyLend(s: HistoryState, f: number, p: number, amount: number): number
/** Repayment (interest included) to f: credited to its home seat's town pool and share. */
export function familyRepaid(s: HistoryState, f: number, amount: number): void
/** p defaults on `amount` owed to f: the loss is written off (the loan was already out of the pool); the ruin check runs with cause Default and `other` = p's capital. */
export function familyAbsorbDefault(s: HistoryState, f: number, p: number, amount: number): void
```
- When families are off or absent, finances should lend from the town pools directly
  (`merchantFunds`/`merchantPay`-style, lender -1), so finances works without families.
- When finances is absent, P3's notional crown default stands in (pure). When finances is on, `fLoan`/`fLoanP` mirror its
  table (kept for the marriage multiplier), and the notional default rule is switched off.
- `familyLend` moves money out of `mw` into the treasury, so it is **feedback**. It is only active with
  `FAMILY.feedback && finances on`. The pure-layer test then runs with finances off.
- The default sizes (`lendShare` etc.) belong to finances. Families only guarantee that capacity ≥ 0 and that a seat never
  goes below 0.

### 8.2 For `city-states.md` (councils of families)
- In-sim: `familiesAt(s, town, out): number` (open seats at the town sorted by capital desc, ties by family id),
  `familyCapitalAt(s, town)`, and `familyInfluence(s, f, town) = c_seat / (s.wealth[town] + mw[town] + 1)` in [0, 1).
  `topFamilies(s, town, k, out)` gives the council.
- History or UI: `seatSnap*` gives each family's wealth per city per snapshot. Helper `councilAt(h, town, year, k)` in
  `ui/familiesData.ts`.
- Ruler link (city-states' decision): for a league or elective head (`electHead`, `rDyn = -1`), the head of the top family
  of the capital could be the elected head. That would need `Ruler.family?: number` and a name handed over at assembly
  (`headName` + surname). Families can provide `topFamilyAt(s, capital)`. Changing who is elected is feedback (phase 2).
- A merchant republic losing its families (a bankruptcy wave) is a natural trigger for the city-states plan to read
  (FamilyFell events at its towns).

### 8.3 For `grudges-and-oaths.md`
A crown default (FamilyFell with ruin Default) and a seized factor (BranchClosed Seized) are natural grievance sources,
family against polity. Expose them through the events. No API is needed.

---

## 9. Risks, open questions, verified vs assumed

**Verified [V]:**
- Merchant capital is per settlement (`mw`), and only `merchantPay` spends it. FleetLost has no capital effect.
- The sweep call sites know leg k.
- Event ids 161-169 are free. MerchantsMoved = 160.
- `GoodsState.ext` is the place for new goods-side state (V8 note).
- Names are made at assembly, and the house naming pattern is in `rulerNames.ts`.
- `LongHaulLayer.setHighlight` exists.
- Landmarks are a pure layer, with `lm` local in `index.ts` and events woven via `weaveEvents`.
- `RulerState` fields (`cur`, `rDyn`, `mActive`, `law`, `cognatic`), `deathYear`'s signature, and `survival()` being private.
- `POLITY.slowStep` = 10. `MARRIAGE.chance` = 0.035. Tier enum. `ps.wOutcome`/`wAtt`/`wDef` exist.
- The scale numbers in 1.5 [M].
- The sibling plan files did not exist at writing time.

**Assumed [A] or open:**
1. `disease/system.ts` strikes pass through the two sites found (l.133 and l.485). Check that every toll path is covered, or
   read `CityStricken` plus the population drop instead.
2. Telling which side won a civil war from `ps.wOutcome` and Reunified needs a careful read of `polity/civil.ts` and
   `war.ts` (who is attacker: the pretender declares, `declare(...)`).
3. Share capture with weight `w_0 = φ` may let families' share drift down (the free pool absorbs inflows). Tune `own`,
   `court` and ability, or give the free pool a weight `< φ`. The harness's "family share of capital 0.35-0.7" catches this.
4. `G_m` treats all outflows as after the inflows (merchantYear interleaves pay, flight and the cap). This is fine for an
   accounting split, and it cannot breach the pool bound because σ is re-derived from `mw`.
5. Scale-free thresholds use `med` of the live families. With 0 or 1 families early, the floors (`foundAbs`, `branchAbs`)
   decide alone. This may need a rank-based alternative (top-k free capital among marts).
6. Tuning pressure on rare events: on seed 1, FleetLost = 2 and lanes = 7, so Fleet ruin will be rare there. Defaults and
   ventures should carry the bankruptcy share. Without polities there are no defaults, war or backing: only fleet, venture
   and plague ruin, plus fade.
7. Name uniqueness against dynasties needs the dynasty names at assembly (`rulHist.dynasties`), so
   `assembleFamilies` must come after `assembleRulers`. With rulers off the set is empty.
8. The `hashPre` filter of 161-169: since families default to on, `goods.test.ts` GOLDEN entries that hash events will
   change unless the helper filters the family events. Filtering is preferred (it keeps the bit-identity statement exact).
   Confirm with a run.
9. Event-id room: the 160-block is now full. Later family events (loans with finances, council seats) should use a new
   block (e.g. 190-199), or finances' own block.
10. Partible-law split doubling and cognatic female heirs read `R.law` and `R.cognatic` only when rulers are on. With rulers
    off, use the defaults.
11. Whether the UI may show a per-settlement ring colour for each family seat at once (`setHighlight` rgb list) needs
    checking in `render/longhaul.ts`. The fallback is one colour.
12. Phase 2's pretender boost changes polity outcomes. It must stay behind `FAMILY.feedback`, with goldens re-recorded and
    the Conquest and CivilWar stats (`polityStats.ts`) checked for drift.
13. Open design questions for the user:
    - Should families also exist at non-mart towns (rich hubs without legs)? The plan says no: seats need `mw > 0`, and
      founding needs `isMart`.
    - Should a cadet split keep the surname (as planned) or get a new one?
    - Should a family's ships show on the map as moving glyphs? (Not planned. The lane highlight only.)

## Owner decisions (2026-11-26)
- Families MAY be founded at non-mart towns (design the rule; keep the caps).
- Cadet lines KEEP the parent surname, distinguished as "the <Surname> of <new home>" — matches the ruling-house convention (rulers/system.ts cadetAccede carries the same dynasty; a new house name only when no kinsman continues it).
- Ship glyphs on the map along a family's lanes: YES (respect the perf plan budgets: instanced, only lanes active at the shown year).

## References
Citation audit 2026-11-26 (per `_CONVENTIONS.md` "Citation rule"). This plan attributes no statistic, equation or model to outside work.
**Design defaults:** every `FAMILY.*` parameter (section 2.5, including `howWeights`, the vigour terms `vig0`, `vig1`, `regress`, `drift`, `gen`
and the SonInLaw renewal), every stats-harness target (section 6) and every [A] item are design defaults. [M] numbers (section 1.5) are measurements
of this sim, not historical facts. House and town names are fictional.

- Ibn Khaldun, *Muqaddimah* (14th c.): the "dynastic-cycle vigour" of 2.4 / P4 echoes his view that "dynasties have a natural life span like individuals",
  about three generations, as summarised in Wikipedia, "Asabiyyah", https://en.wikipedia.org/wiki/Asabiyyah [verified: that summary; the plan's
  decay rule and parameters are design defaults, not taken from it]

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **R4.** `SeatKind` collides with seat-mode's `SeatKind` in contract.ts. Rename it to **`FamilySeatKind`**, and rename `SeatOpen`/`SeatClose` to **`FamilySeatOpen`/`FamilySeatClose`**. Values are unchanged: riots and migration use `FamilySeatClose.Expelled = 4`.
- **D-dup 9.** If your pass needs per-polity aggregates, read `polity/aggregates.ts`; do not add a second pass.
