# Plan: Infrastructure networks of the modern age (planned, financed, built, maintained, used, attacked, decaying)

Target: worldseed at commit 8cabf09 (pristine checkout `/home/claude/ryanmye/worldseed`). PLAN ONLY. Measurements were run in
`/home/claude/scratch-infra` (probe `probe-infra.ts`, raw output `meas/b2000-{1,7,42,1234}.json`, `meas/b6000-42.json`).

Tags: **[V]** verified in code at 8cabf09 (file:line or function), **[M]** measured here, **[A]** assumed / design default.
Citations follow the owner's rule in `_CONVENTIONS.md`: each source carries **[verified]** (a page confirming it was opened this
session) or **[unverified]** (with the reason). Every constant without a citation is a **design default**, not a fact.

Scope: railways, canals, paved highways, ports and container terminals, airports and air routes, power generation and grids,
pipelines, overland telecom (optical telegraph, wire, telephone, radio relay, fibre/internet), undersea cables, water supply
and sewerage, and the future-tech networks of `future-tech.md` (high-speed rail, maglev, hyperloop, vertiports, launch sites,
point-to-point rockets, orbital). Roads worn by trade (`History.road`), ports, dams, walls, forts stay as they are; this plan
builds on them and, where noted, upgrades them.

---

## 0. Interfaces (one contract for the implementer and the sibling plans)

### 0.1 Ids and enum values
| enum | values (this plan's) | note |
|---|---|---|
| EventType | **350–359** (section 3.3) | the block given to this plan |
| GrievanceKind | **14 Expropriated** (a polity seized a company's lines that a family/company of another polity owned) | next free after court-politics' 13 Asylum |
| OrderKind | **59 BuildLine, 60 FundWaterworks, 61 Nationalise** (seat-mode cards; step 15, optional) | registry: tech-tree 39–40, character-mode 41–58, "later plans: OrderKind 59+" |
| DecisionKind | **45 Infrastructure** (one card kind, three orders) | registry: character-mode 27–44, "later plans 45+" |
| StructureType | **reused**: future-tech's 6 Airport, 7 Spaceport (launch sites), 8 PowerStation, 10 Desalination (a coastal waterworks), 11 SkyTether (orbital grade 2); with this plan on, this plan builds those rows (future-tech only unlocks). **New, 12–20**: 12 Station, 13 Interchange, 14 PortTerminal, 15 Substation, 16 Waterworks, 17 Sewerage, 18 Exchange, 19 CableLanding, 20 Vertiport | registry: "other plans adding StructureTypes start at 12". Nodes are Structure rows, not a new table (integration rule) |
| RNG stream | `'history-infra'` | created only when on |
| HistoryOptions | `infrastructure?: boolean` (default **false** until step 16 calibration) and `infraFeedback?: boolean` (default true when infrastructure is on; false = consequence layer only) | needs `polities` (owners are states); goods optional |
| New enums (contract) | `NetworkKind`, `InfraOwner`, `InfraEnd`, `CompanyEnd`, `InfraFuel`, `InfraKey` (string union) | section 3.1 |

**Integration rule (owner requirement): what is reused and what is new, with the reason.**
- Reused: nodes are **Structure rows** (History.structures; Built 4 / StructureLost 7 events, `render/structures.ts`), with two optional
  fields added to `Structure` (`size`, `fuel`); paved highways are **History.road** (a highway pins its cells' road level, 2.2), so the
  existing road layer and `ROAD.discount` carry them; trade's settlement graph, `pairCost` and `partnerSearch` carry network freight
  (links become edges); finances' treasury (`finSpend`/`finCredit`), families' lending, court's regime and policy vector, grudges'
  `record`/`g`, beliefs' channels, riots' kernel, disease's contact pass and DiseaseDef, tech-tree's `ideaUnlock`/`ideaInfraMul`/
  `ideaIndustrial`, future-tech's hub rule, air-edge price and night-light share, the globe's `setCityLights`, routeCurves.ts geometry.
- New, because nothing existing can carry it: **links** (a built asset with owner, condition and a cell path; trade routes are flows that
  open and close with prices and carry no owner or condition); **companies** (a firm pooling several towns' capital under a concession;
  families are single houses with seats, and their plan has no multi-owner entity); **manias** (a few rows: sentiment episodes needed by
  the stats and sagas; events alone cannot hold their totals); per-settlement **elec** and **water** snapshots (future-tech's `light` is
  per people and too coarse for towns; no History field holds water coverage).

### 0.2 Hooks this plan exposes (`infra/hooks.ts`; O(1) or O(degree), RNG-free; return the neutral value when `s.infra === null`)
```ts
/** Multiplier >= INFRA.corrFloor on the land step cost of cell c from the networks running through it (1 neutral). Applied inside refreshMoveCost. */
infraCellMul(s, c): number
/** Generalised freight cost between settlements a and b over the networks (cell units, Infinity when not both on a network). */
infraNetCost(s, a, b): number
/** Share 0..1 of settlement id's people with electricity (grid connected and supplied this year). */
infraElec(s, id): number
/** Share 0..1 of settlement id's people with piped clean water and sewers. */
infraWater(s, id): number
/** Telecom connectivity 0..1 between the capitals of polities p and q (best path's grade and condition; 0 when cut). */
infraWire(s, p, q): number
/** Commute radius in km of settlement id (Marchetti budget, 2.9). */
infraCommuteKm(s, id): number
/** Pop-weighted share 0..1 of p's members joined to its capital by rail or highway in condition >= INFRA.qUsable. */
infraHeld(s, p): number
/** Effective number of path cells for an army of polity p marching along `path` (own and allied lines count INFRA.marchRail). */
infraMarchLen(s, p, path: readonly number[]): number
/** Extra contact edges for disease spread this year (rail, highway, air), weights ∝ passengers; fills out arrays, returns count. */
infraContacts(s, outA: Int32Array, outB: Int32Array, outW: Float64Array): number
/** Market-access index ln(MA_i / MA_ref) of settlement id (2.4), 0 neutral. */
infraAccess(s, id): number
```
UI twins (no sim import except params), in `ui/infraData.ts`: `linksAt(h, year, kind?)`, `nodesAt(h, settlement, year)`,
`linkStateAt(h, link, year)` (condition, load, grade from the change rows), `elecAt`, `waterAt`, `commuteAt` (snapshots),
`infraAt(h, settlement, year)` (the bundle city-renderer-eras reads, 6.3).

### 0.3 What this plan reads, per plan (each guarded; each with a proxy)
| plan | reads | proxy without it |
|---|---|---|
| **tech-tree-innovation.md** (0.2, 0.6 there) | `ideaUnlock(ix, p, key)`, `ideaInfraMul(ix, p, key, 'cost' \| 'speed')`, `ideaIndustrial`, `ideaEra` | `unlockProxy(s, p, key)` = smoothstep(c0, c1, Crafts of p's people) per key (INFRA.proxyCrafts, 3.4). Measured max Crafts at 2000 y: 3.6 / 4.8 / 4.9 / 5.3 (seeds 1/7/42/1234) [M] |
| **future-tech.md** (0.3.10, 2.5.1, 2.5.2, 4.2, Addendum) | keys `motorRoad, aviation, jetAirliner, container, highSpeedRail, maglev, hyperloop, eVTOL, rocketry, reusableRocket, pointRocket, teleport, spaceElevator, grid, fission, solarWind, fusion, computer, satellite, internet` as unlocks; its per-mode multipliers `L_p` (land), `S_p` (sea), `A_p` (air), `K_p` (launch) and its air-edge price `c_air(a, b) = FUT.airBase + FUT.airKm · gc(a, b) / sqrt(A_pa · A_pb)` (gate edges `FUT.gateBase`); its hub rule (top `FUT.hubPerPeople` 3 cities ≥ CITY_POPULATION per people, ≤ `FUT.hubMax` 64); `futReach(p)` | absent: those kinds stay locked |
| **state-finances.md** (0.3, 0.3b) | `finRevenue`, `finTreasury`, `finSpend`, `finNeed`, `finCredit` (new kind, 0.4), `finPrice`, `fin.rate[p]` | revenue proxy `R = POLITY tax take smoothed` (`ps.pRevSm`) + `WEALTH.decay · wealth[capital]`; spending debits `wealth[capital]` |
| **merchant-families.md** (8.1) | `familyLendCapacity`, `lendersFor`; new `familyInvest`, `familyDividend`, `familyWriteOff` (0.4) | town merchant pool `mw[town]` (goods/merchants.ts) as `InfraOwner.Pool`; goods off: `s.wealth[town]` |
| **court-politics.md** (3.1, 6.4) | `Regime` of p; new policy slot `infra` (0.4) | tier + `ideaAdmin` (`stateCapacityProxy`, 2.5) |
| **grudges-and-oaths.md** | `g(p, q)` grudge, `record(...)` | rivalry `relR` (polity/relations.ts) |
| **beliefs-and-deception.md** (3.2) | adds channel bit `Wire = 256` (0.4) | — |
| **riots-uprisings.md** (4.4) | adds kernel term `wireW` (0.4) | — |
| **disasters-climate.md** (3.4) | scans events 262–265 and `struckRow` for damage | — |
| **battles.md** | nothing new: march speed enters through `infraMarchLen` in war.ts; supply via M_supply's food term | — |
| **society-secular-cycles.md** | its urban term (`Urban` revolt cause 7) may read `infraWater` (optional) | — |
| **city-states.md** | `InfraOwner.City` for free cities' municipal works | — |
| **city-renderer-eras.md** (in progress; file not readable when this plan was finished) | it reads `infraAt` (6.3) | — |
| **migration-borders.md** (its 0.x table, line 58) | it reads `infraNetCost` as its route cost R_ij (its 3.8) for long moves, using the flag `INFRA.migrateNet` reserved here; cell moves feel corridors via `s.moveCost` | its proxy: trade route cost |
| **perf-efficiency.md** | P4 draw-range culling, golden hashes `923881e7cd3fe59b` (1), `3bac8db3dfd723b5` (42), `2bb9f72e9e99433d` (1234) | — |

### 0.4 Amendments asked of other plans (small; null-guarded; draw-neutral when this plan is off)
- **tech-tree-innovation.md**: fix `InfraKey` = `'road' | 'canal' | 'rail' | 'port' | 'telecom' | 'cable' | 'water' | 'sewer' | 'grid' | 'pipeline' | 'highway' | 'air' | 'container' | 'hsr' | 'maglev' | 'hyperloop' | 'vertiport' | 'launch' | 'orbital'`.
  Its table (0.6) maps `poundLock, canals → canal`, `railway → rail`, `telegraph, semaphore, radio → telecom`, `telegraph + ironclad → cable`,
  `aqueduct, qanat → water`, `sanitation → sewer` (and filtration from `germTheory` as `infraMul water speed`), `electricPower → grid`,
  `combustionEngine → pipeline + highway`, `macadam → road` (turnpike grade). **Double counting:** with `infrastructure` on, the `land`
  lever of `railway` (.5), `canals` (.1), `macadam` (.15), `combustionEngine` (.2), `telegraph` (.05) is skipped in `recompute`
  (flag `infraLand: true` on those defs), because the network now carries that reach spatially. (`ideaLand` only multiplies trade
  partner-search reach, trade.ts:568 and longhaul.ts:164 [V], so the double count would be small, but it is avoidable.)
- **future-tech.md** (ownership resolved by the coordinator: this plan owns all networks, including air, rocket and gate hubs; future-tech
  unlocks them and sets per-mode cost and speed). With `infrastructure` on:
  - **Hubs** are this plan's Airport (6) / Spaceport (7) Structure rows, chosen by future-tech's hub rule (adopted unchanged as the
    Airport node rule, 2.2); future-tech's own hub builder in 2.5.2 is skipped. Its consequences there (first contact on air trade,
    disease beta `FUT.fastBeta` on air edges, the Alesina–Spolaore secession term, hub migration, "the world shrinks" stat) stay
    future-tech's and read this plan's Air links (`linksAt(…, NetworkKind.Air)` sim twin `infraAirLinks(s)`).
  - **Air links are priced by `c_air`** (future-tech's formula and constants); this plan adds only condition, ownership, and capacity.
  - **Land step `L_p`**: future-tech's `edgeCost /= sqrt(L_pa · L_pb)` on trade edges is skipped; instead `L_p` enters this plan's rail and
    highway mode costs as `ideaInfraMul(…, 'speed')` (mode cost ÷ L_p^0.5 per end, still capped by future-tech's FUT.maxDiv), so the
    saving lives on the lines that exist, not on every edge. Long-haul land legs keep ÷ L (future-tech) because legs do not use the
    network. `S_p` (container) stays on `ideaSea`; this plan's PortTerminal adds the port-local part (2.2), so `INFRA.containerSea`
    applies only where `container` is held **and** a terminal exists (no double count: S_p's container share is halved when infra is on).
  - **Reach**: one λ multiplier, future-tech's `λ *= 1 + FUT.reachK · (futReach(p) − 1)`, with its `sqrt(L_p)` factor replaced by
    `(1 + INFRA.reachRail · infraHeld(s, p))` when infra is on; this plan then adds nothing more to λ (its own `reachWire` term is
    dropped because futReach's `Σ reach·a` already carries telegraph, radio and the internet). Without future-tech, 2.7.6 applies.
  - **Night lights**: future-tech's `History.future.light` (electrified share per people) is set to the population-weighted mean of this
    plan's settlement `elec` when infra is on; the globe uses this plan's per-settlement value (6.1).
  - **Orbital**: launches go from Spaceport rows to future-tech's `History.offWorld` rows; `K_p` prices them; SkyTether (11) is the
    Orbital grade-2 node.
- **state-finances.md**: `finCredit(s, p, amount, kind)` gains kind `'infra'` (fares and tolls of state lines, concession fees);
  `finSpend` kinds gain `'build'` and `'upkeep'` (diag only).
- **merchant-families.md** (phase 2 feedback flag): `familyInvest(s, f, company, amount): number` (money leaves f's seat pools;
  returns amount), `familyDividend(s, f, amount)`, `familyWriteOff(s, f, amount)` (their ruin check may log FamilyFell, ruin Default).
  Without them, Pool owners stand in (2.6).
- **court-politics.md**: policy slot `infra` (multiplies a polity's build budget): Crown 1, War 1.3 (strategic lines first), Peace 1,
  Faith 0.8, Merchant 1.3 (and concessions approved ×1.5), Regent 0.8, Favourite 1.2 (prestige lines ×2). Regime budget factors in 2.5.
- **beliefs-and-deception.md**: channel `Wire (256)`, a cheap channel: `I += iWire · infraWire(s, o, t)` (iWire 1.5); cut lines in war
  give 0.
- **riots-uprisings.md** 4.4: kernel weight `+ wireW 0.4 · infraWire(polity(j), polity(k))` to the 6 largest towns of polities wired to j's
  (news of a rising travels by wire); normalisation unchanged, so the branching bound n0 < 1 still holds.
- **disease** (in repo; this plan edits): `diseaseSystem` reads `infraContacts` as extra edges; endemic and Crowd-kind tolls at a
  settlement × `(1 − INFRA.sanEff · infraWater(s, id))` for diseases with `water: true` (new DiseaseDef flag; `flux` only).
- **polities** (in repo): control.ts reach λ ×= `1 + INFRA.reachRail · infraHeld(s, p)`; war.ts march time uses `infraMarchLen`.

---

## 1. Current behaviour (what exists at 8cabf09)

### 1.1 Structures: ports and dams (`src/sim/history/structures.ts`) [V]
- `structureSystem(s, scratch, ps)` (structures.ts:93): per living settlement, a **Port** is built with yearly chance
  `PORT.chance (0.05) · buildSkill` once `pop ≥ PORT.pop (400)` on a sea-coast cell, lost below `PORT.keep · PORT.pop`.
  `buildSkill = c / (1 + TECH.build·(c − 1))` from Crafts c. A **Dam** needs `DAM.pop 3000`, risk = aridity + famine memory, and
  `damSite` picks the river cell that irrigates most farmland downstream net of the reservoir (structures.ts:42–80).
- Effects: ports widen founders' sea reach (`markPortReach`, PORT.range 10 hops), fish ×(1 + PORT.fish), cheaper sea legs for trade
  (`TRADE.seaPort 0.2` vs `seaNoPort 1.3`, `oceanPort 0.12`, params.ts:692–694) and migration; dams set `s.farmMul` and call
  `refreshCapacity` (`rebuildIrrigation`).
- Contract: `StructureType` Port 0, Dam 1, Walls 2, Fort 3, Mine 4, Factory 5 (contract.ts:1399–1406); `Structure {id, type, cell,
  settlement, builtYear, lostYear}` (contract.ts:1409–1419). Events Built (4) and StructureLost (7), `other` = structure id.

### 1.2 Roads and the travel-cost field [V]
- **Static field**: `T.moveCost[c]` (terrain.ts:285–306): `MOVE_COST.biome[b] + highland·smoothstep(0.3, 0.7, elev)`, rivers
  `riverBase 0.45 + riverScale 0.25 · c`, coastal ×`coastal`, times `cellScale`; deep ocean flagged (`T.deep`), shallow sea at its biome cost.
- **Live field**: `s.moveCost` (state.ts:123, initialised from T.moveCost at state.ts:243). **Only roadSystem writes it**
  (trade.ts:1160–1201): every `ROAD.step (4)` years, route traffic `rRoadAcc / dt` is added along the land cells of each route path;
  road level x → `x += (tg − x)·(rise | fade)` with `tg = tr / (tr + ROAD.half 400)`, and `s.moveCost[c] = T.moveCost[c]·(1 −
  ROAD.discount 0.35 · x)`; x below epsilon resets the cell. So a major highway today is at most a 35% discount.
- **Who reads s.moveCost** (grep [V]): migration Dijkstra (migration.ts:241–343), trade link search (`rebuildLinks`, trade.ts:340),
  route cost (`routeCost`, trade.ts:489), long-haul legs (goods/longhaul.ts:66), polity territory map (polity/territory.ts:121–264),
  army paths (polity/war.ts:184), re-routing (polity/reroute.ts:58), tourism travel (tourism/system.ts:281–302). Claims use the static
  field (polity/claims.ts:40).
- **Bucket queues**: migration (Dial, `MIGRATION.bucketWidth 0.25`, params.ts:415) and territory (`BUCKET = 0.25`,
  territory.ts:28, "below the cheapest step: a road along a coastal river, about 0.39") assume no land step below 0.25 cell units.
  Migration re-settles improved cells (migration.ts:50–60), so a cheaper step stays correct but costs time; territory's comment
  states the assumption outright. **Any network discount on `s.moveCost` must keep steps ≥ 0.26·cellScale** (risk R1).

### 1.3 Trade links, pairs, costs [V]
- Every `TRADE.linkStep (50)` years `rebuildLinks` runs one bounded multi-source search (radius 13; ports' regions ×1.6 over water)
  and links settlements whose regions touch, with the cheapest crossing as `edgeCost`; CSR adjacency `adjOff/adjNode/adjEdge`
  (trade.ts:340–440). `rebuildPairs` then searches the settlement graph for partners (2 nearest + 1 gravity `pop/cost²`, reach 20 ×
  (1 + transportTech·(Crafts − 1)), maxNodes 40) and stores `pairCost` (trade.ts:542–690).
- Market transport per unit of good g on pair p: `GOODS.transport[g] · pairCost[p] · (route open ? 1 : 1 + openHurdle) ·
  ½(pack_a + pack_b) / (1 + transportTech·(Crafts̄ − 1))`, times danger, disease and policy factors (trade.ts:979–985).
  **pairCost is frozen for up to 50 years** between link rebuilds (trade.ts:801–806): a new line would not show in prices until then.
- Ports: sea-leg multipliers by whether each end has a port (`routeCost`, trade.ts:489–505); `oceanCost` from Seafaring and
  `ideaSea` (trade.ts:329–332).

### 1.4 Polity reach, armies, disease [V]
- `projAt(ps, p, d) = pMass · grip(d, pReach) / (1 + multiWar·…) · (1 − exhaustionProj·e)`, `grip = 1/(1 + (d/λ)²)`
  (polity/state.ts:567–652); λ = `lambda0 9 · (1 + reachCrafts·(Crafts − 1)) / sqrt(1 + members/overload)` (polity/params.ts:50,
  control.ts:41).
- Army march: Dijkstra over `s.moveCost` (war.ts:170–190); arrival `years = 0.2 + 0.02 · path.length` (war.ts:~199).
- Disease passes over trade routes, long-haul legs, neighbours and journeys (disease/system.ts header). The `flux` crowd disease
  (`endemicDeath 0.00005`, load 0.22; disease/params.ts:38) is the only waterborne-like one.

### 1.5 Render [V]
- `render/roads.ts` draws roads as the land part of the bundled trade network (`routeCurves.ts tradeNetwork`): one curve per
  cell-to-cell link, road level from a 2-snapshot texture interpolated in the vertex shader; bridges where road curves cross rivers.
- `render/routeCurves.ts` builds smoothed, bundled curves from cell paths (Catmull-Rom through decimated knots, land/sea aware),
  cached per history. `render/structures.ts` draws ports, dams, walls, forts. `render/longhaul.ts` draws lanes as ribbons.

### 1.6 Baseline measurements [M] (`probe-infra.ts`, default options, 2000 years; seed 42 also to 6000 years)
Cell spacing at n = 48: ≈ 149 km (√(4π/23,042)·6371 km) [M, derived]. `cellScale` = 1.

| seed, year | living | pop | towns ≥3k | cities ≥10k | traders | road cells (share of land) | road ≥0.5 | mean road level | mean cost mul on road cells |
|---|---|---|---|---|---|---|---|---|---|
| 1, 2000 | 1074 | 419,679 | 21 | 3 | 134 | 974 (12.0%) | 666 | 0.62 | 0.78 |
| 7, 2000 | 938 | 693,286 | 42 | 10 | 227 | 1548 (18.9%) | 885 | 0.53 | 0.81 |
| 42, 2000 | 889 | 599,860 | 34 | 11 | 152 | 1112 (14.8%) | 705 | 0.59 | 0.79 |
| 1234, 2000 | 1037 | 876,753 | 59 | 17 | 212 | 1532 (17.5%) | 1058 | 0.63 | 0.78 |
| 42, 3000 | 928 | 1,096,380 | 60 | 22 | 243 | 1767 (23.5%) | 1158 | 0.62 | 0.79 |
| 42, 4000 | 864 | 1,234,809 | 74 | 24 | 283 | 1918 (25.5%) | 1344 | 0.65 | 0.77 |
| 42, 6000 | 806 | 1,390,120 | 94 | 26 | 268 | 2057 (27.4%) | 1478 | 0.68 | 0.76 |

| seed, year | ports in use (ever) | dams | walls | forts | open routes | route cost p10/p50/p90 (cell units) | path cells p50/p90 | sea share of path p50/p75 | grain price CV over traders | \|ln gap\| p50/p90 on routes | slope of \|ln gap\| on ln route cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1, 2000 | 68 (69) | 4 | 70 | 48 | 445 | 2.2 / 8.0 / 31.5 | 12 / 30 | 0 / 0.56 | 0.26 | 0.18 / 0.59 | −0.02 |
| 7, 2000 | 170 (171) | 3 | 81 | 58 | 790 | 2.6 / 6.5 / 19.6 | 10 / 25 | 0.45 / 0.71 | 0.28 | 0.19 / 0.48 | 0.02 |
| 42, 2000 | 80 (83) | 13 | 87 | 59 | 495 | 2.2 / 6.5 / 20.6 | 10 / 23 | 0 / 0.50 | 0.30 | 0.16 / 0.51 | 0.02 |
| 1234, 2000 | 156 (162) | 13 | 143 | 76 | 714 | 2.7 / 7.3 / 34.3 | 12 / 31 | 0.50 / 0.71 | 0.30 | 0.15 / 0.45 | 0.02 |
| 42, 4000 | 165 (194) | 19 | 247 | 173 | 1061 | 2.4 / 5.9 / 21.6 | 9 / 23 | 0.14 / 0.60 | 0.32 | 0.19 / 0.57 | −0.01 |
| 42, 6000 | 167 (225) | 22 | 276 | 178 | 1164 | 2.3 / 6.1 / 20.7 | 10 / 24 | 0.08 / 0.60 | 0.30 | 0.18 / 0.55 | 0.00 |

Readings:
- The world is small: 21–59 towns ≥ 3,000 at year 2000, 60–94 by 3000–6000 [M]. A railway network here links tens of towns, so
  link counts stay in the hundreds (perf, section 9).
- Roads saturate at ~25–27% of land cells and a mean cost multiplier of ~0.77 [M]: the pre-modern network is already there.
- A median open route is 10–12 cells (~1,500–1,800 km) and costs 6–8 cell units; the p90 sea share is high (0.5–0.7) [M].
- **Prices are not integrated by distance today**: the gap between route ends does not rise with route cost (slope ≈ 0, all
  seeds and years) and the grain price CV across traders stays 0.26–0.32 from year 1500 to 6000 [M]. So "price convergence along
  new lines" cannot be tested as a cross-section slope; it is measured as a difference-in-differences on pairs newly joined (7, T3).
- Pair costs track route costs closely (pairs p50 6.4–7.8) and are re-priced only at link rebuilds (1.3).
- The realism harness measured a PPML gravity distance elasticity of −0.48 at 2000 (realism-metrics.md §0, [M] there), already
  above its band [−1.3, −0.6]; networks must not push it toward 0 (T4).
- Probe run time: 279–303 s per 2000-year run and 445 s for 6000 years, on a 2-vCPU VM at load average ~25 (other agents' runs),
  so these times are not a perf baseline; perf-efficiency.md's uncontended 4.9–7.3 s per 2000 years is [M there].

---

## 2. Design

### 2.1 Principles
1. **A network is a sparse graph over settlements (nodes) whose links are cell paths.** Links have kind, owner, capacity grade,
   condition and years; nodes (stations, terminals, plants, waterworks, airports, launch sites) sit at settlements. Nothing dense per
   cell is stored in History except the relict corridors (2.8, sparse).
2. **Two layers of effect.** (a) Node-graph costs: a link is an edge in the trade settlement graph and in the polity graph at its mode
   cost, so far partners become cheap without distorting every cell search. (b) A bounded corridor discount on `s.moveCost` along
   land cells (floored, R1), so migration, territory and armies feel the line locally.
3. **Investment is a decision with a payer.** Each candidate link is scored by gravity-style market-access gain, strategic and
   prestige value, against a construction cost from terrain; it is built by a state (finance capacity, regime, faction) or by private
   capital (companies of merchant pools or families, under a concession), and must be maintained.
4. **Off is bit-identical.** `s.infra === null` → no state, no draws, every hook neutral. `infraFeedback: false` → networks are built
   and logged (a consequence layer), and the effect hooks return neutral values; spending is still booked only in infra's own ledger
   (no finSpend, no mw debit), so other fields stay bit-identical (test 8.2).

### 2.2 Networks and what each does
| NetworkKind | unlock key(s) (tech plan) | link medium | grades (upgrade path; grade from `ideaInfraMul` speed and age) | freight mode cost per cell, grade 0 → top [A] | main effects |
|---|---|---|---|---|---|
| Canal 0 | canal (`poundLock` river canals; `canals` summit canals) | land + river cells, low ground | 0 river navigation, 1 summit canal, 2 ship canal | 0.30 → 0.18 | bulk freight, coal; obsolete once rail parallels it |
| Rail 1 | rail; hsr, maglev, hyperloop (future-tech) | land; bridges, tunnels | 0 horse/early steam, 1 steam, 2 steel (`bessemer`), 3 electrified/high-speed, 4 maglev, 5 hyperloop | 0.20 → 0.08 (passenger speed rises with grade; freight cost floors at grade 2) | freight, migration, armies, epidemics, reach |
| Highway 2 | road (turnpike, `macadam`), highway (`combustionEngine`/`motorRoad`) | land | 0 turnpike, 1 paved motor road, 2 motorway | 0.55 → 0.30 as a node-graph edge; on cells it **pins `History.road` at 1** (roadSystem target `tg = max(tg, q)` on its cells), so the existing 35% road discount and road layer carry it | short-haul freight, commuting (suburbs), armies |
| Power 3 | grid (`electricPower`, future `grid`) | land and short sea | 0 local DC (no links, plant only), 1 AC transmission, 2 HV, 3 UHV/HVDC | not a freight mode | electrification, night lights, industry; cascades |
| Pipeline 4 | pipeline (`combustionEngine`) | land | 0 oil, 1 gas+oil | not freight: energy delivery to plants and towns | fuel to plants; war target |
| Telecom 5 | telecom (`semaphore`, `telegraph`, `radio`; future `computer`, `internet`) | land (towers, wires) | 0 optical, 1 wire telegraph, 2 telephone, 3 radio relay, 4 fibre | not freight | beliefs `Wire`, riot news, idea learning, price information (Steinwender) |
| Cable 6 | cable (`telegraph` + `ironclad`) | sea cells between coastal towns | 0 telegraph cable, 1 telephone cable, 2 fibre | not freight | as Telecom across seas; cut in blockade |
| Air 7 | air (`aviation`, `jetAirliner`), vertiport (`eVTOL`), launch (`pointRocket`), gate (`teleport`) | no cells: great-circle between Airport (6) / Spaceport (7) rows; Vertiport (20) hops to towns within `FUT.vertiKm` | 0 props, 1 jet, 2 vertiport, 3 point-to-point rocket, 4 gate | future-tech's `c_air` (0.3) | contact, epidemics, hub migration (future-tech 2.5.2, reading these links); Brockmann & Helbing 2013 |
| Orbital 8 | launch (`rocketry`, `reusableRocket`, `spaceElevator`) | Spaceport (7) row ↔ an off-world row of future-tech (`History.offWorld`) | 0 expendable, 1 reusable, 2 tether | not freight | future-tech's off-world rows; launch-site economy |
Airports: when future-tech is on, Airport rows go to the cities its hub rule picks (top 3 per people, ≤ 64 in the world); Air links
are proposed between hub pairs that trade (or whose MA gain is positive) and built as commercial lines (2.6) or national prestige lines
(2.5). Ports and **containerisation** are node upgrades, not a network kind: a `PortTerminal` (14) Structure at an existing Port (key
`container`) multiplies that port's sea-leg multiplier by `INFRA.containerSea 0.6` and its transshipment toll by 0.5
(Bernhofen et al. 2016 [verified] find "economically large" effects of containerisation on trade, 1962–1990; the multipliers here are
design defaults). **Water supply and sewerage** are node-local: a `Waterworks` (16; supply; filtration with `germTheory`; a
`Desalination` (10) row on dry coasts with future-tech's `desalination`) and a `Sewerage` (17) row at a town set its coverage `water_i`
(2.10); aqueduct/qanat (era 2) give a low-grade Waterworks that pre-modern cities can build.

Mode costs are **design defaults** set in cell units against a grassland step of 1.0 and a worn road's 0.65. They encode the familiar
ordering (canal and rail far cheaper per ton-km than carts; motor roads between) [unverified as magnitudes: no freight-rate source was
opened; calibrate against T3 and T4]. Donaldson (2018) [verified] shows railroads "decreased trade costs and interregional price gaps"
and raised real income in colonial India, which fixes the direction and the mechanism (trade costs → prices → income), not the size.

### 2.3 Representation (contract.ts, struct-of-arrays; drafted doc comments)
See 3.1 for the code. In short:
- `History.infra.links` — one row per link ever built: `kind, a, b, ownerKind, owner, company, partner (polity across a border, −1),
  beganYear, openedYear, lostYear, endCause, grade0, gauge, lengthKm, cost, pathOffsets/path` (land/sea cells; Air and Orbital have
  empty paths).
- Nodes — **Structure rows** (`History.structures`, types 6–8, 10–20) with the optional `size` (1..3) and `fuel` (InfraFuel) fields;
  `History.infra.nodeIds` lists the infra-built structure ids in building order (an index, not a copy).
- `History.infra.companies` — `kind, seat, polity, founded, ended, endCause, capital, monopoly, guarantee, name`.
- `History.infra.changes` — sparse change rows per link: `(year, link, cond, load, grade)` written when any quantised byte moves by
  ≥ INFRA.changeStep (16/255) or the grade changes; the renderer reconstructs per-year state by binary search.
- Per settlement per land snapshot (20 years), from the first snapshot with any infra (`snap0`): `elec`, `water` (Uint8). Market access
  and commute radius are not stored: the stats harness reads them from diagnostics, the UI recomputes commute radius from the nodes and
  links present (`infraAt`, 6.3).
- `History.infra.relict` — sparse (cell, fromYear, level0, halfLife) rows of abandoned corridors (2.8).
- `History.infra.manias` — (kind, exchange settlement, start, peak, crash, floated, lost, abandonedShare).

### 2.4 Demand, market access and the node graph (`infra/access.ts`)
**Node set per polity** p: members with `pop ≥ INFRA.nodePop[k]` (Canal 1500, Rail 2000, Highway 1000, Telecom 1000, Power 3000,
Air 10,000, Launch CITY + coast or equator) [A], capped at the `INFRA.maxNodes 64` largest, plus the up-to-16 largest foreign nodes
that are p's open trade partners (for cross-border candidates).

**Generalised cost** between nodes i, j: `c_ij` = shortest path over the **node graph** whose edges are (a) every live link of
every kind at its mode cost `Σ_cells m_k(grade) · cellLen / (0.4 + 0.6·q)` (q = condition, 2.8), plus a transfer cost
`INFRA.transfer 0.5` cell units at each change of mode, and `INFRA.gaugeBreak 0.8` where two rail links of different gauge meet;
(b) the current trade pair costs `pairCost` between nodes (the cell-layer alternative); (c) the cell-layer link edges `edgeCost` of
`rebuildLinks` between node settlements. Computed by V Dijkstras (V ≤ 80) every `INFRA.step` (5) years into a V×V Float64 matrix
per polity component (scratch, reused).

**Market access** (Donaldson & Hornbeck 2016 [verified]: a "reduced-form expression derived from general equilibrium trade theory";
Hansen 1959 [unverified] for the accessibility idea):
```
MA_i = Σ_j P_j · τ_ij^(−θ),     τ_ij = 1 + c_ij / c0,     θ = INFRA.theta 3,   c0 = INFRA.c0 5 (cell units, ≈ the median route cost, 1.6)
```
θ = 3 follows Limão & Venables (2001) [verified]: an elasticity of trade flows with respect to the trade-cost factor "of around −3"
(their sample, modern; a design choice to reuse it). `infraAccess(s, i) = ln(MA_i / MA_ref)`, MA_ref = MA_i at the polity's first
network year (stored), clamped ±3.

**Gain of a candidate link e** (a → b, cost c_e): for every node pair, `c'_ij = min(c_ij, c_ia + c_e + c_bj, c_ib + c_e + c_aj)`;
```
B_e  = v_MA · Σ_i P_i · Σ_j P_j · (τ'_ij^(−θ) − τ_ij^(−θ)) / P_p          (gravity-weighted access gain, wealth units a year)
F_e  = f0 · Σ_{(i,j) routed via e} P_i P_j τ'_ij^(−θ) / P_p                 (predicted loads on e, for fares and capacity)
```
O(V²) per candidate. `v_MA` converts access to wealth a year (calibrated so that B of the first trunk line ≈ INFRA.firstReturn 0.08
of its cost; step 16). Pre-existing open trade on (a, b) adds its measured loads `ts.rVol` to F_e.

### 2.5 Candidates and placement (`infra/plan.ts`; every INFRA.step years, in polity id order, each unlocked kind in kind order)
Unlocked: `u_k(p) = ideaUnlock(ix, people(capital p), key_k)` (0..1, the Bass intensity there), proxy `smoothstep(c0, c1, Crafts)`
with INFRA.proxyCrafts: canal [2.8, 3.4], rail [3.8, 4.4], telecom [3.6, 4.2], water [3.4, 4.2], grid [4.4, 5.0], highway/pipeline
[4.6, 5.2], cable [4.0, 4.6]; air, container, future kinds: never in proxy mode [A, set against the measured Crafts range of 1.6].
A people's `u_k > 0` is necessary; the polity's capital must hold it (a vassal's capital its own).

**Candidate generators** (at most `INFRA.cands 8` per polity per kind per step, de-duplicated by (a, b)):
1. **Trunk**: capital ↔ each of the 3 largest member nodes not yet joined to the capital by k.
2. **Extension**: from each end node of each component of k (degree 1), to the nearest unjoined member node by cell cost.
3. **Branch**: the 2 largest unjoined member nodes → their nearest node already on k.
4. **Demand**: the 2 busiest open trade routes (`ts.rVol`) between nodes of p not joined by k.
5. **Strategic** (state only): capital → the member node nearest the border of the rival with the highest threat
   (`relR` × that rival's projection; grudges' θ when built), and capital → the most remote member town ≥ TOWN_POPULATION
   (imperial railways holding the realm together).
6. **Cross-border** (2.11): the busiest open route from a node of p to a foreign node.

**Path and construction cost** (`infra/path.ts`): bounded A* over cells (heuristic: great-circle cells × the kind's cheapest cell
weight), at most `INFRA.pathVisits 6000` visits, length ≤ `INFRA.maxLen[k]` cells (Canal 12, Rail 20, Highway 12, Telecom 30, Power 15,
Pipeline 30, Cable 60 sea cells). Weight per entered cell:
```
w_k(c) = base_k · (T.moveCost[c] / cellScale)^γ_k                                   γ: rail 1.3, highway 1.0, canal 1.6, telecom 0.5, power 0.7, pipeline 0.8
       + bridge_k · [T.river[c] and the previous cell is not on the same river]      (river crossing)
       + tunnel_k · smoothstep(0.55, 0.8, elev[c])                                     (rail, highway; impassable above elev 0.8 without tunnelling: ideaInfraMul 'cost' < 0.8 of a 'tunnel' key, else +∞)
       + lock_k · max(0, elev[c] − elev[prev]) · 10                                    (canal only; canals never leave cells below elev 0.45)
       − reuse_k · road[c]                                                             (an old road's bed: highways 0.5, rail 0.2)
Canal: river cells count base · 0.4 (canalised river). Cable: sea cells only, deep cells × 1.5, ice impassable, both ends sea-coast towns.
C_e = cellCost_k · Σ w_k · labour(p) · ideaInfraMul(ix, p, key, 'cost')       labour(p) = 1 + 0.5·(Crafts − 1)   (dearer, better-paid labour)
```
All weights and `cellCost_k` are design defaults; the shape (gradients penalised more for rail than for roads, rivers as bridges,
mountains as tunnels gated by technology) is the ordinary engineering logic [A]. Paths reuse the trade module's `Heap` and the
`stamp`/`dist` buffers pattern (TradeState, trade.ts:100–112) in infra's own scratch (no allocation per search).

**Score** (state view; one per candidate):
```
A     = (1 − (1 + r)^(−H)) / r                     r = fin.rate[p] (proxy INFRA.rate 0.05), H = INFRA.horizon 40 years
U_e   = upkeep_k · C_e                              upkeep_k a year: rail 0.02, canal 0.015, highway 0.03, telecom 0.04, power 0.03, cable 0.03 [A]
S_e   = σ_hold · Σ_m P_m · (grip(d'_m, λ') − grip(d_m, λ)) / P_p · M_p           (members' grip gain from the capital; "holding the realm together")
      + σ_war · threat_p · ΔAccess(front node)                                     (strategic lines toward the main rival)
X_e   = ρ · [e touches the capital or the largest city] · prestige(p)             prestige: Favourite 2, Absolutist/Sultanistic 1.5, else 1
Score = (B_e + S_e + X_e + fare_k · F_e) · A − C_e − U_e · A
```
`d'_m` uses `c_cap,m` after the link; λ' adds the reach bonus of 2.7. `M_p` is the polity's mass (`pMass`). σ, ρ, fare_k design defaults.

**State decision**: budget `Bud_p = INFRA.budgetShare 0.12 · R_p · regime_p · court_infra_p · (1 − finNeed_p)`, R_p = `finRevenue`
(proxy 1.3). Regime factors [A]: Bureaucratic 1.3, Absolutist 1.2, Constitutional 1.0, Estates 0.9, Patrimonial 0.7, Feudal 0.4,
Elective 0.6, MilitarySlave 0.8, Sultanistic 0.9, Nomadic 0.2, Tribal 0, Civic 1.1, Clerical 0.7; proxy `stateCapacityProxy` =
`smoothstep(0, 2, tier) · ideaAdmin(ix, p)`. Candidates are sorted by Score/C_e (ties: lower a, then b); the best with Score > 0 is
**begun** if `C_e / buildYears_e ≤ Bud_p − committed_p`, where `buildYears_e = max(2, lengthCells / INFRA.buildRate[k])` (rail 2 cells a
year at grade 0 rising with `ideaInfraMul speed`) [A]. Then **one draw** `rng.next() < INFRA.will · u_k(p)` (will 0.6) decides whether the
crown acts this step at all (the draw is made whenever a positive candidate exists, so draws per step are fixed by state, not by
outcome). At most one state line begun per polity per kind per step. The link opens (`openedYear`) after buildYears if paid for; each
year's instalment goes through `finSpend(s, p, C_e / buildYears, 'build')`; an unpaid instalment delays the opening a year (cost
overrun ×1.05).

**Growth dynamics that emerge** (and are tested, 7): incremental extension (generator 2), trunk-and-branch (1 then 3), preferential
attachment (big hubs have the largest B because MA weights pairs by P_i P_j; Barabási & Albert 1999 [verified] for the network
mechanism, not claimed for railways specifically), and an S-curve in total length: early candidates have the highest B/C, gains
fall as nodes are joined, and finance limits the rate (logistic growth and substitution of infrastructures: Grübler 1990
[verified: the book record exists; its specific fits were not opened]; Fisher & Pry 1971 [verified: record] for the substitution form).

### 2.6 Private capital: companies, concessions, manias and crashes (`infra/capital.ts`)
Commercial kinds: Canal, Rail, Pipeline, Telecom, Cable, Air (and private power plants in towns). Evaluated after the state
decision, same step, same candidate list (state-begun candidates removed).
- **Investors**: the polity's **exchange** is its largest mart (goods) or largest town. Capital available
  `K_p = INFRA.investShare 0.25 · Σ_{towns of p} mw[town]` (Pool) or, with families on and feedback, `Σ familyLendCapacity` of
  `lendersFor`-ordered families (ownership `InfraOwner.Family`, the largest backer; others Pool). Goods off: `0.1 · Σ wealth`.
- **Expected return** of e: `ER_e = (fare_k · F_e − U_e) / C_e`. **Sentiment** per (polity, kind): `E` starts at INFRA.e0 0.05 and
  each step `E ← E + λ_s · (R̄ − E) + β_s · (E − E_prev)` (λ_s 0.3, β_s 0.6: adaptive plus extrapolative), where R̄ is the realised
  return of p's open private lines of kind k over the last 5 years. A project is floated if `ER_e · (E / INFRA.e0) > r + premium`
  (premium 0.02, ×0.5 with `limitedLiability` held) and `C_e ≤ K_p − committed`. Floated projects need a **concession**: approved
  deterministically when `courtPolicy infra ≥ 1` or the regime is Constitutional/Civic, else one draw at `INFRA.concede 0.5` (Merchant
  faction ×1.5). Monopoly concessions (`monopoly = 1`; Patrimonial/Absolutist/Sultanistic regimes) exclude other companies of the same
  kind from p's nodes for 40 years. A company row is created (named, 5.2) with capital = C_e paid in instalments from its backers.
- **Mania**: when ≥ INFRA.maniaFloat 4 companies of one kind are floated in p within 10 years and `E / R̄ ≥ 2`, a Mania row and event
  (355) start; at most one open mania per (polity, kind).
- **Crash**: each step during a mania, if `R̄ < INFRA.crashRatio 0.5 · E` (realised far below expected) → crash (356): `E ← R̄`; every
  unopened private project of that kind in p is abandoned with chance `INFRA.crashCancel 0.5` (one draw each, in link id order); paid-in
  capital of an abandoned project is lost (Pool: `mw[seat] −= paid`, capped at what the pool holds; Family: `familyWriteOff`); opened lines
  of bankrupt companies (revenue < interest for 10 years) pass to the state (353, CompanyEnd Nationalised) if Score > 0 for the state,
  else close at the next decay check. Calibration anchors: in Britain investors implicitly expected railway revenues of about
  £60 m by 1850–52 against £6 m in 1845 and about £15 m achieved in 1852; about £250 m (≈ half of GDP) was invested by 1850 and about a
  third of it lost (Odlyzko 2010 [verified: manuscript opened; a preliminary working paper, not a refereed article]). Hence targets
  (7, T7): peak `E/R̄` of 2–5, mania investment ≈ 3–6% of the GDP proxy a year, losses 20–40% of mania capital.
- **Revenue**: each year the owner receives `fare_k · loads_e` (loads from the market, 2.7): state → `finCredit(.., 'infra')`;
  company → dividends to its backers' pools/families pro rata; city → `wealth[city]`. The fare is taken from the transport cost saving, so
  traders still gain (fare ≤ INFRA.fareCap 0.5 of the saving).
- **Nationalisation / expropriation**: a polity whose regime becomes Absolutist/Sultanistic/Clerical, or that conquers a node of a
  foreign company, takes its lines with chance `INFRA.seize 0.3` per step (draw); a company of another polity's town records
  `GrievanceKind.Expropriated (14)` against it (grudges: `record`), event 353.

### 2.7 Effects on movement, trade, reach and war (feedback; `infraFeedback`)
1. **Trade edges.** At each `rebuildLinks` (trade.ts:340), after the CSR is built, live links whose both ends are traders are appended
   as extra edges (`edgeCost = linkCost`, `edgeCellA/B = −1` marks a network edge; `edgePath` returns the link's own path). The partner
   search then reaches far network partners (maxNodes 40 still bounds it).
2. **Pair re-pricing between rebuilds.** `pairCost0[p]` stores the cell-layer cost at the rebuild; whenever the network's epoch changes
   (a link opens, closes, is cut or changes grade), `infraReprice(s, ts)` sets `pairCost[p] = min(pairCost0[p], infraNetCost(s, a, b) +
   ½(transfer_a + transfer_b))` for pairs whose ends are both nodes. Deterministic, RNG-free. This fixes the 50-year freeze (1.3) for
   the pairs that matter.
3. **Corridor discount on cells.** A single writer: `refreshMoveCost(s, c) = max(INFRA.costFloor · cellScale, T.moveCost[c] ·
   (1 − ROAD.discount · road[c]) · infraCellMul(s, c))`, `infraCellMul = min over live land links through c of (1 − corr_k · q · g_k)`
   (corr: canal 0.3 on canal cells, rail 0.5; highways act through the road level they pin, 2.2) and the relict term (2.8). **costFloor = 0.26** (R1). roadSystem
   (trade.ts:1194, 1197) calls `refreshMoveCost` instead of writing the product itself (identical when infra is off:
   `infraCellMul = 1`, and the max with the floor is skipped when `s.infra === null`, so off-runs keep the exact old arithmetic).
4. **Migration** reads `s.moveCost`, so rail corridors cheapen moves locally (automatic). Optional (flag `INFRA.migrateNet`, off by
   default, for migration-borders.md): a group leaving a node may join a node within `infraNetCost ≤ budget` (long rail moves).
5. **Price information** (Steinwender 2018 [verified]: "the average and volatility of the transatlantic price difference fell after the
   telegraph"): on a pair whose ends are wired (Telecom/Cable path, grade ≥ 1), the market's damping is `TRADE.damping · (1 + INFRA.info
   0.4 · wire)`, capped 0.8 (trade.ts:850 `damping`), so gaps close faster and fluctuate less.
6. **Capital reach and cohesion.** Without future-tech: `λ_p ×= 1 + INFRA.reachRail 0.6 · infraHeld(s, p) + INFRA.reachWire 0.2 · wired share`
   (control.ts:41). With future-tech on: its single λ multiplier with `sqrt(L_p)` replaced by `(1 + reachRail · infraHeld)` and no reachWire (0.4).
   This lets polities hold more land; it is the riskiest effect for realism (empires are already too long-lived, realism-metrics §0;
   guard T10).
7. **Mobilisation.** war.ts arrival `years = 0.2 + 0.02 · infraMarchLen(s, p, path)`; own or allied live Rail/Highway cells count
   `INFRA.marchRail 0.25` / `marchRoad 0.5` of a cell. Battles' supply term is unchanged (food at the front town).
8. **Epidemics.** `infraContacts` adds rail/highway links (weight ∝ loads) to the disease contact pass; air links are added here only
   when future-tech is off — with it on, its 2.5.2 air-edge disease channel (`FUT.fastBeta`) reads this plan's Air links, so they are not
   counted twice. Brockmann & Helbing (2013) [verified: record] show arrival times follow "effective distance" on the air
   network rather than geographic distance — the qualitative behaviour expected here.
9. **Urban form** (2.9) and **agglomeration**: a town's econ multiplier `×(1 + INFRA.agg 0.04 · clamp(infraAccess, −1, 2))`
   (design default; the literature on agglomeration economies is surveyed by Rosenthal & Strange 2004 [verified: record; the abstract
   gives no magnitudes, so 0.04 is not sourced]).
10. **Electrification** (2.10): Crafts goods output (`stock[o+3..5]`, trade.ts:820–826) × `(1 + INFRA.elecCraft 0.3 · elec_i)`.
11. **Sanitation** (2.10): disease toll multiplier.
12. **Containers**: port sea-leg multiplier (2.2).

### 2.8 Maintenance, decay, obsolescence, ruins (`infra/upkeep.ts`, yearly for live links, cheap)
```
q ← q − δ_k · (1 + w_war + w_collapse)                δ: rail 0.03, canal 0.02, highway 0.04, telecom 0.05, power 0.04, cable 0.02 a year [A]
paid = owner pays U_e this year (state: finSpend 'upkeep'; company: from revenue then capital; city: wealth)   → f ∈ [0, 1]
q ← min(1, q + f · δ_k · (1 + INFRA.catchUp 0.5 · [q < 0.8]))      (deferred maintenance is made good slowly)
```
`w_war` = 1 while a war front or raid touches a path cell; `w_collapse` = 1 when the owner polity ended and no successor holds both
ends. Effective cost `/ (0.4 + 0.6 q)`. **Closure** (event 351): `q < INFRA.qClose 0.25` (Decay); loads `< INFRA.minLoad` for
`INFRA.closeYears 30` years (Abandoned: "ghost lines"); a canal whose ends are joined by rail of grade ≥ 1 and whose loads fell below
30% of their peak (Obsolete); an end abandoned (Abandoned). **Relicts**: a closed land link leaves a relict row per path cell
(level 1 at closure, half-life rail/highway 400 years, canal 150) that gives `infraCellMul ×(1 − INFRA.relictK 0.1 · level)`, the
embankments and cuttings later roads follow. Roman-road persistence is documented by Dalgaard et al. (2022) [verified], who also find
the link fades where wheeled transport was abandoned — here a relict's discount only matters where something still travels.
A rebuilt link along ≥ 50% relict cells costs ×0.7.

### 2.9 Urban form: Marchetti's constant (`infra/urban.ts`, per snapshot, per town ≥ TOWN_POPULATION)
Marchetti (1994) [verified]: "the mean exposure time (i.e., mean traveling time) for people all over the world is one hour per day"
(Technological Forecasting and Social Change 47(1):75–88). So a city's commuting radius scales with the fastest common mode:
```
commuteKm_i = v_i · 0.5 h          v_i = max over modes held at i: walk 5, horse tram 8, electric tram / suburban rail 20, car 35, rapid transit 30, maglev metro 60 km/h  [A: speeds are design defaults, not sourced]
```
Trams/suburban rail need a Rail node with grade ≥ 1 and Power at the town; cars need Highway grade ≥ 1. Stored in `commute` (km, Uint8).
The renderer (city-renderer-eras) sizes the built-up footprint by min(commuteKm, density cap); the sim uses it only for the
agglomeration access radius. Baum-Snow (2007) [verified]: "one new highway passing through a central city reduces its population by
about 18 percent" — the renderer's suburb spread follows highways (6.3); the sim has one population per settlement, so there is no
central-city population to move (open question Q4).

### 2.10 Power grids, electrification, water and sanitation
- **Plants** (`StructureType.PowerStation` 8, `fuel` fuel Coal/Hydro/Oil/Gas/Nuclear/Solar/Wind/Fusion): built by the state, a town or a company
  at towns ≥ 3000 with `grid` unlocked; Hydro only at an existing Dam structure's settlement (reuse); capacity `cap = INFRA.plantCap ·
  pop_i^0.8` at building; fuel by held ideas and resources (coal from tech-tree's coal field; Oil/Gas need a Pipeline to a Mine of
  oil, or a port). Links of kind Power join towns to plants.
- **Supply** (every INFRA.step years and after any failure): each grid component's demand `D = Σ elecDemand_i` (∝ pop_i · ideaIndustrial),
  supply `Σ cap`; served share `σ = min(1, supply/D)`; `elec_i = σ · u_grid(p) · [connected]`. Night lights = elec × pop (render);
  Henderson, Storeygard & Weil (2012) [verified: record] use night lights as a measure of economic activity, which is why lights here are
  driven by electrified population rather than a decorative glow.
- **Cascades** (Motter & Lai 2002 [verified]: node capacity `C_j = (1 + α) L_j` "where the constant α ≥ 0 is the tolerance parameter"):
  each grid node j (plant or substation at a town) gets `C_j = (1 + INFRA.alpha 0.25) · L_j` at its last rebuild. When a node fails
  (war damage, disaster, fuel cut), its load is shared by the nodes of its component in proportion to their capacity; any node with
  load > C_j fails; ≤ 8 rounds. If ≥ 3 towns go dark → **Blackout (357)**; dark towns have elec 0 for 1–3 years (draw).
  Interdependence (Buldyrev et al. 2010 [verified]: a failure in one network causes failures in the networks that depend on it): a dark
  town's Telecom/Cable nodes are out that year (infraWire 0 through them).
- **Water** (`Waterworks`, `Sewerage` nodes): a town ≥ TOWN_POPULATION with `water`/`sewer` unlocked builds when its crowd disease
  deaths in the last 30 years ≥ INFRA.waterTrigger, or by order (FundWaterworks). Payer: City (free cities and towns with wealth ≥ cost),
  else state. Coverage `water_i` = supply 0.5 + sewer 0.5, times filtration (germTheory) for supply. Effect on mortality:
  `toll ×= 1 − INFRA.sanEff 0.6 · water_i` for diseases with `water: true` (flux) and for endemic deaths of Crowd kinds at ×0.3.
  Anchors: clean water (filtration, chlorination) "was responsible for nearly half the total mortality reduction in major cities,
  three quarters of the infant mortality reduction, and nearly two thirds of the child mortality reduction" in the early-20th-century
  US (Cutler & Miller 2005 [verified]); effective water and sewerage together "account for approximately one-third of the decline in log
  child mortality" in Massachusetts 1880–1920 (Alsan & Goldin 2019 [verified]). sanEff 0.6 is a design value inside that range.
  CleanWater (358) logs the city and its waterborne deaths before.

### 2.11 Cross-border links, treaties and gauges
A candidate whose path leaves p's territory (land snapshot `territory`) or ends at a foreign node needs the other polity q's consent:
deterministic refusal if p and q are at war, `relR(p, q) ≥ 0.5`, a grudge `g(q, p) ≥ 0.3`, or an embargo (`relEmb`); otherwise q accepts
with one draw at `INFRA.treaty 0.5 · (1 + trade share)`. The link gets `partner = q`. Each polity picks a **gauge** at its first rail
line (one draw of 3, weighted to the gauge of its largest rail-holding neighbour with weight 2 if relR < 0.3, else to a different one
"for defence" with weight 2 if relR ≥ 0.5) [A]; a break of gauge adds `gaugeBreak` at the transfer (2.4). During a war between p and q
all their cross-border links are **Cut (352)** and carry nothing; they reopen at peace if condition allows. Conquest: state-owned links
of a captured town's realm pass to the conqueror when both ends end up in it; company lines stay with their company (2.6 seizure).

### 2.12 War, blockade, disasters
- **War damage**: each war-year, every live link with a path cell on the war path or at a besieged/sacked town is damaged with one draw
  at `INFRA.warHit 0.3` (×2 if the enemy holds `aviation`, strategic bombing; ×1.5 for the losing side's own lines, scorched earth):
  `q −= 0.3`; a link at q < qClose is **Cut (352)** (cause War) and repaired (q back to 0.6) when peace comes if its owner pays 30% of C.
  Sacked towns lose their nodes' size by half.
- **Blockade** (existing Blockade event 43): the blockaded port's PortTerminal and its Cable links are Cut for the war.
- **Disasters** (scan of events 262 Earthquake, 263 Tsunami, 264 CityDestroyed, 265 Flood): links with a path cell within the strike's
  cells (disasters' row) take `q −= share · 2`; plants, waterworks at struck towns fail (cascade check). Without disasters, the
  existing Famine/Abandoned events still close links via ends.

---

## 3. Contract additions (`src/contract.ts`), drafted in codebase style

### 3.1 Enums and records
```ts
/** infrastructure: a network of the modern age (History.infra.links[].kind). */
export const NetworkKind = {
  Canal: 0, // a canal between two towns: canalised rivers, then summit canals with locks over low ground (poundLock, canals)
  Rail: 1, // a railway: horse and early steam, steam, steel, electrified and high-speed, maglev, hyperloop (by grade)
  Highway: 2, // a paved road for wheeled traffic: turnpike and macadam, then the motor road and the motorway (by grade)
  Power: 3, // electric transmission lines joining towns to power plants (a local plant alone needs no line)
  Pipeline: 4, // an oil or gas pipeline from a field or port to plants and towns
  Telecom: 5, // overland lines of news: optical telegraph towers, wire telegraph, telephone, radio relay, fibre (by grade)
  Cable: 6, // an undersea cable between two coastal towns (telegraph, telephone, fibre by grade)
  Air: 7, // a scheduled air route between two airports (no cells: a great circle); vertiport hops and rocket hops by grade
  Orbital: 8, // launch traffic from a launch site to an off-world settlement of future-tech (History.offWorld)
} as const
export type NetworkKind = (typeof NetworkKind)[keyof typeof NetworkKind]
export const NETWORK_KIND_COUNT = 9

// StructureType additions (append to the existing table, contract.ts:1399; 6–11 are future-tech's, reused here as nodes:
// Airport 6 (`size` 1 regional .. 3 hub), Spaceport 7 (launch site), PowerStation 8 (`fuel` the InfraFuel), Desalination 10, SkyTether 11).
  Station: 12, // infrastructure: a railway station on the settlement's cell; `size` 1 halt, 2 junction (3+ lines), 3 terminus with yards
  Interchange: 13, // infrastructure: where rail, highway and port meet at one town (built when a town has two of them)
  PortTerminal: 14, // infrastructure: a deep-water, later container, terminal beside the town's Port; `size` 1 deep-water, 2 container
  Substation: 15, // infrastructure: a grid node at a town supplied from a power station elsewhere
  Waterworks: 16, // infrastructure: piped supply (aqueduct or qanat at size 1; filtered water after germ theory, size 2)
  Sewerage: 17, // infrastructure: sewers and outfall works
  Exchange: 18, // infrastructure: a telephone exchange, later the data centre of the town's network
  CableLanding: 19, // infrastructure: where an undersea cable comes ashore
  Vertiport: 20, // infrastructure: air-taxi pads (eVTOL) at a town near a hub

// Structure gains two optional fields (absent on every older type, so existing rows and their hashes are unchanged):
//   /** infrastructure: size class 1..3 of a node (station, airport, terminal, waterworks), absent otherwise. */
//   size?: number
//   /** infrastructure: fuel of a PowerStation (InfraFuel), absent otherwise. */
//   fuel?: number

/** infrastructure: what a power station burns or harnesses (Structure.fuel). */
export const InfraFuel = { Coal: 0, Hydro: 1, Oil: 2, Gas: 3, Nuclear: 4, Solar: 5, Wind: 6, Fusion: 7 } as const
export type InfraFuel = (typeof InfraFuel)[keyof typeof InfraFuel]

/** infrastructure: who owns a link, node or company's assets. */
export const InfraOwner = {
  State: 0, // a polity (`owner` the polity id)
  City: 1, // a town's own works (`owner` the settlement id): free cities and municipal water and trams
  Family: 2, // a merchant family (History.families id; merchant-families)
  Company: 3, // a company of investors (History.infra.companies id)
  Pool: 4, // the merchant pool of a town (`owner` the settlement id), when no family or company stands behind it
} as const
export type InfraOwner = (typeof InfraOwner)[keyof typeof InfraOwner]

/** infrastructure: why a link or node fell out of use. */
export const InfraEnd = {
  Decay: 0, // maintenance unpaid until it fell apart
  Obsolete: 1, // superseded (a canal beside a railway, a telegraph by the telephone)
  Abandoned: 2, // its traffic or one of its towns was gone (a ghost line)
  War: 3, // destroyed in war and never repaired
  Disaster: 4, // destroyed by an earthquake, wave or flood and never repaired
  Bankrupt: 5, // its company failed and nobody took it over
  Severed: 6, // a border closed for good across it
} as const
export type InfraEnd = (typeof InfraEnd)[keyof typeof InfraEnd]

/** infrastructure: how a company ended. */
export const CompanyEnd = { Merged: 0, Bankrupt: 1, Nationalised: 2, Expropriated: 3, Wound: 4 } as const
export type CompanyEnd = (typeof CompanyEnd)[keyof typeof CompanyEnd]

/** infrastructure: the networks, nodes, companies and manias of a run (empty arrays when HistoryOptions.infrastructure is false). */
export interface InfraHistory {
  /** Links in order of beginning (struct of arrays, length linkCount). */
  linkCount: number
  kind: Uint8Array
  /** The two end settlements, lower id first (Orbital: b is -1 and `offWorld` holds the History.offWorld row). */
  a: Int32Array
  b: Int32Array
  ownerKind: Uint8Array
  owner: Int32Array
  /** Company that built it (History.infra.companies id), or -1. */
  company: Int32Array
  /** Polity across a border it was agreed with (the far end's), or -1 for a line inside one realm. */
  partner: Int32Array
  /** Year work began; year it opened (-1 if never: abandoned unbuilt); year it fell out of use (-1 if in use at the end); the InfraEnd (255 none). */
  beganYear: Int16Array
  openedYear: Int16Array
  lostYear: Int16Array
  endCause: Uint8Array
  /** Grade at opening (see NetworkKind; later grades are in `changes`), rail gauge 0..2 (255 for other kinds). */
  grade0: Uint8Array
  gauge: Uint8Array
  /** Length along its path in km, and what it cost to build (wealth units of the year). */
  lengthKm: Float32Array
  cost: Float32Array
  /** Cell path a's cell first (empty for Air and Orbital); consecutive cells are neighbours. */
  pathOffsets: Uint32Array
  path: Uint32Array
  /** Sparse state changes, in year order: from year chYear[k] link chLink[k] had condition chCond, utilisation chLoad (0..255) and grade chGrade. */
  changeCount: number
  chYear: Int16Array
  chLink: Int32Array
  chCond: Uint8Array
  chLoad: Uint8Array
  chGrade: Uint8Array
  /** History.structures ids of the nodes this system built (stations, terminals, airports, power stations, water works...), in building order. */
  nodeIds: Int32Array
  /** Companies. */
  companyCount: number
  cKind: Uint8Array
  cSeat: Int32Array
  cPolity: Int32Array
  cFounded: Int16Array
  cEnded: Int16Array
  cEnd: Uint8Array
  cCapital: Float32Array
  cMonopoly: Uint8Array
  cName: string[]
  /** Manias: kind, exchange town, start, crash year (-1 none), companies floated, capital lost. */
  maniaCount: number
  mKind: Uint8Array; mExchange: Int32Array; mStart: Int16Array; mCrash: Int16Array; mFloated: Int16Array; mLost: Float32Array
  /** Per settlement per land snapshot from land snapshot `snap0` on: elec[(q - snap0) * settlements.length + id], shares 0..255 of its people with electricity, and with piped water and sewers. */
  snap0: number
  elec: Uint8Array
  water: Uint8Array
  /** Relict corridors of closed land links: cell, year closed, half-life in years (level = 0.5^((year - from) / half)). */
  relictCount: number
  rCell: Int32Array; rFrom: Int16Array; rHalf: Int16Array
}
```
`History.infra: InfraHistory` (empty instance from `emptyInfraHistory()` when off). Int16 years cover 6000-year runs [V: other Int16
year fields exist, e.g. `repathYear`]. Nodes are built with the existing `build(s, id, type, cell)` (state.ts) and lost with
`loseStructure`, so they log Built (4) and StructureLost (7) like ports; `render/structures.ts` gains glyphs for types 12–20.

### 3.2 InfraState (`src/sim/history/infra/state.ts`)
```ts
export interface InfraState {
  rng: Rng                       // createRng(seed, 'history-infra')
  on: boolean; feedback: boolean
  // links (JS arrays while running; assembled to typed arrays), live list ascending
  lKind: number[]; lA: number[]; lB: number[]; lOwnK: number[]; lOwn: number[]; lCo: number[]; lPartner: number[]
  lBegan: number[]; lOpened: number[]; lLost: number[]; lEnd: number[]; lGrade: number[]; lGauge: number[]
  lKm: number[]; lCost: number[]; lPath: number[][]; lQ: number[]; lLoad: number[]; lPaid: number[]; lCut: number[]
  live: number[]
  /** Cells' live land links (CSR rebuilt on epoch change) and the per-cell multiplier infraCellMul (Float32, all cells, 1 default). */
  cellOff: Int32Array; cellLink: Int32Array; cellMul: Float32Array
  /** Node graph scratch: node ids per polity component, V×V cost matrix, Dijkstra buffers (Float64Array / Int32Array, reused). */
  ng: NodeGraph
  /** Per settlement (grown with s.count): node bitmask by kind, elec, water, access, commute, MA_ref. */
  nodeMask: Int32Array; elec: Float32Array; water: Float32Array; access: Float32Array; commute: Float32Array; maRef: Float64Array   (live only; History keeps elec and water)
  /** Per polity (grown with ps.P): committed build budget, gauge, first-year per kind, sentiment E and E_prev per kind, open mania per kind. */
  committed: Float64Array; gauge: Int8Array; firstYear: Int16Array; sentE: Float64Array; sentPrev: Float64Array; mania: Int32Array
  nodeIds / companies / manias / changes / relicts: append-only JS arrays as in the contract (nodes themselves live in s.structures)
  epoch: number                  // bumped on any open, close, cut, grade change (re-pricing, cell CSR, render)
  events: HistoryEvent[]         // own list, woven in at assembly (as landmarks')
  diag: InfraDiag                // candidates, begun, refused, budget-limited, crash counts, cascade sizes, time per phase
}
```
`HistoryState.infra: InfraState | null`, next to `fin`/`rul`; created in `createRunner` when `options.infrastructure && pol`.

### 3.3 Events (block 350–359)
| id | name | settlement | other | value | extra |
|---|---|---|---|---|---|
| 350 | `LineOpened` | end a | end b (−1 for Orbital) | link id | NetworkKind + 16 if the first line of its kind for the people of `settlement` |
| 351 | `LineClosed` | end a, or b if a is gone, else the largest living town on its path; none logged if no living settlement qualifies | the other end or −1 | link id | InfraEnd |
| 352 | `LineCut` | the end nearest the damage | the capital of the enemy (war, blockade) or −1 | link id | 0 war, 1 disaster, 2 blockade, 3 border closed |
| 353 | `CompanyTaken` | the taking polity's capital | the company's seat | company id | CompanyEnd (Nationalised, Expropriated, Bankrupt when the state rescued it) |
| 354 | `Concession` | the company's seat | the granting capital | company id | NetworkKind + 16 if a monopoly |
| 355 | `Mania` | the exchange town | −1 | mania row | NetworkKind |
| 356 | `ManiaCrashed` | the exchange town | −1 | mania row | permille of the mania's authorised length abandoned |
| 357 | `Blackout` | where the failure began | −1 | towns left dark | 0 war, 1 disaster, 2 overload cascade, 3 fuel cut |
| 358 | `CleanWater` | the town | its polity's capital or −1 | structure id | waterborne deaths in the 30 years before, per mille of the town |
| 359 | `HubOpened` | the town | −1 | structure id | StructureType (Airport size 3, PortTerminal size 2 container, Spaceport, Station terminus of ≥ 3 lines); lesser nodes log only Built (4) |
Rule (as disasters-climate 2.4): an event needs a living `settlement` at the event; else it is not logged (the row still is).
Director registrations (experience-whatif-director-sagas 0.1) [A]: 350 Settlement 3 (×2 first of kind), 351 Settlement 2 (Decay/Abandoned 3),
352 War 4, 353 Politics 4, 354 Politics 2, 355 Economy 5, 356 Economy 7 (mag: capital lost / GDP proxy), 357 Nature/Society 5 (mag: towns),
358 Society 5, 359 Discovery 3 (Spaceport 6).

### 3.4 Params (`src/sim/history/infra/params.ts`, `export const INFRA`, a doc comment per line in the codebase style)
```ts
export const INFRA = {
  /** Infrastructure off by default (HistoryOptions.infrastructure overrides); needs polities. Off: History.infra empty, everything else identical. */
  on: false,
  /** Planning and finance every `step` years (staggered: polity id % step === year % step). */
  step: 5,
  /** Node thresholds by NetworkKind (people), and the most nodes per polity in the node graph. */
  nodePop: [1500, 2000, 1000, 3000, 2000, 1000, 1000, 10000, 10000], maxNodes: 64, maxForeign: 16,
  /** Candidates per polity per kind per step; path search visits and length caps in cells (n = 48). */
  cands: 8, pathVisits: 6000, maxLen: [12, 20, 12, 15, 30, 30, 60, 0, 0],
  /** Market access: tau = 1 + c / c0, exponent theta (Limão & Venables 2001: trade elasticity to the cost factor about -3). */
  theta: 3, c0: 5,
  /** Freight cost per cell by kind and grade (cell units; grassland 1, worn road 0.65): design defaults. */
  mode: [[0.30, 0.24, 0.18], [0.20, 0.14, 0.10, 0.08, 0.08, 0.08], [0.55, 0.40, 0.30]],
  /** Mode change cost (cell units) and break of gauge; floor of any land step after discounts (keeps the bucket queues exact, R1). */
  transfer: 0.5, gaugeBreak: 0.8, costFloor: 0.26,
  /** Corridor discount on cells by kind (rail, highway, canal) at full condition; relict corridors. */
  corr: [0.3, 0.5, 0], relictK: 0.1, relictHalf: [150, 400, 400],
  /** Construction: cost per weighted cell by kind (wealth units at Crafts 1), cells built a year at grade 0, upkeep share a year. */
  cellCost: [6, 10, 4, 3, 3, 1, 4, 0, 0], buildRate: [1.5, 2, 3, 3, 3, 6, 10, 0, 0], upkeep: [0.015, 0.02, 0.03, 0.03, 0.02, 0.04, 0.03, 0.05, 0.05],
  /** Decay a year at full use; condition below which a link closes; condition needed to count as usable. */
  decay: [0.02, 0.03, 0.04, 0.04, 0.03, 0.05, 0.02, 0, 0], qClose: 0.25, qUsable: 0.5, catchUp: 0.5,
  /** Closure for disuse: loads below minLoad for closeYears. */
  minLoad: 2, closeYears: 30,
  /** State budget: share of revenue a year, will to act, horizon and fallback rate; strategic and prestige weights. */
  budgetShare: 0.12, will: 0.6, horizon: 40, rate: 0.05, sigmaHold: 1, sigmaWar: 0.5, prestige: 0.3,
  /** Private capital: share of merchant pools investable, starting sentiment, adaptive and extrapolative weights, risk premium, concessions. */
  investShare: 0.25, e0: 0.05, lambdaS: 0.3, betaS: 0.6, premium: 0.02, concede: 0.5, maniaFloat: 4, crashRatio: 0.5, crashCancel: 0.5, seize: 0.3,
  /** Fares: share of the transport saving taken, by kind. */
  fare: [0.3, 0.35, 0.1, 0, 0, 0, 0, 0.4, 0], fareCap: 0.5,
  /** Effects: reach, march, price information, agglomeration, electrification, sanitation, containers. */
  reachRail: 0.6, reachWire: 0.2, marchRail: 0.25, marchRoad: 0.5, info: 0.4, agg: 0.04, elecCraft: 0.3, sanEff: 0.6, containerSea: 0.6,
  /** Grids: tolerance alpha (Motter & Lai 2002), plant capacity scale, cascade rounds; water-works trigger (crowd deaths per mille in 30 years). */
  alpha: 0.25, plantCap: 0.05, cascadeRounds: 8, waterTrigger: 50,
  /** Cross-border: consent chance; war damage chance per war-year. */
  treaty: 0.5, warHit: 0.3,
  /** Proxy unlock Crafts thresholds [c0, c1] by InfraKey when tech-tree-innovation is off. */
  proxyCrafts: { canal: [2.8, 3.4], rail: [3.8, 4.4], telecom: [3.6, 4.2], water: [3.4, 4.2], sewer: [3.8, 4.6], grid: [4.4, 5.0], highway: [4.6, 5.2], pipeline: [4.6, 5.2], cable: [4.0, 4.6] },
  /** Change rows: quantised condition / load step that writes a row. */
  changeStep: 16,
  /** Optional long rail migration (migration-borders). */
  migrateNet: false,
}
```
Every number above is a **design default** except θ (sourced choice, 2.4) and α's form (Motter & Lai's model; 0.25 is a default).

---

## 4. Step order and determinism

### 4.1 Placement in `index.ts step()` [V for the existing order, index.ts:526–580]
- `infraYearStart(s, ix)` right after `tradeSystem` is not needed; network effects are read inside trade through hooks.
- **`infraYear(s, ix, trade)`** after `structureSystem` (index.ts:542) and **before** the road step (index.ts:547): upkeep and decay
  (yearly), war/disaster damage (yearly, from the year's events scanned from `ix.evSeen`), revenue booking (yearly), then on planning
  years (`id % step`) per polity: unlock → node graph → candidates → state decision → private decision → manias; then grid supply and
  cascades; water coverage. Then `if (epoch changed) { rebuild cell CSR + cellMul for touched cells; refreshMoveCost for them;
  infraReprice(s, trade) }`.
- Trade link rebuild (`rebuildLinks`) appends network edges (2.7.1) when `s.infra?.feedback`.
- Snapshots: `infraSnapshot` inside `snapshot()` (per settlement Uint8 rows); change rows written as they happen.
- Assembly: `assembleInfra(world, ix, naming)` after `assembleGoods` (company names use town and family names); events woven like the
  landmarks': `weaveEvents(…, infraEvents)`.

### 4.2 Determinism
- Own stream `'history-infra'`; draws in fixed order: per year, war damage draws in live-link id order; per planning step, polities in id
  order, kinds in NetworkKind order: will draw (one, if a positive candidate), concession draw(s) in candidate order, treaty draw(s),
  gauge draw (first rail line), crash cancel draws in link id order, seizure draws in company id order, blackout repair draws in town order.
- No Maps iterated (lookups only); node lists sorted by id; candidate ties broken by (a, b).
- Floating point: MA sums in fixed node order; Dijkstra ties by node id.
- **Off** (`infrastructure: false`): `s.infra = null`, no stream created, every hook returns its neutral value via an early `null` check,
  roadSystem keeps its exact expression (2.7.3), `rebuildLinks` appends nothing. Golden hashes of perf-efficiency must match
  (`923881e7cd3fe59b`, `3bac8db3dfd723b5`, `2bb9f72e9e99433d` at 2000 years; test filters History.infra out only when on).
- **Consequence mode** (`infraFeedback: false`): networks built, no hook changes anything, no spending leaves infra's ledger; all
  pre-existing fields bit-identical to off (test 8.2 compares every field except `infra` and the woven events).

---

## 5. UI and prose

### 5.1 Data and panels
- `ui/infraData.ts` (0.2 twins). A new **Infrastructure** tab in the polity panel: network length by kind over time (sparkline),
  companies and their fate, manias, coverage of electricity and water among its towns, "lines cut" in its wars.
- Town panel: nodes at the town, lines through it with their opened year and owner, electricity and water coverage, commute radius.
- Map view `ViewMode.Networks` (render/palette.ts): links coloured by kind, width by load, dashed when cut, faded by condition.

### 5.2 Names (`src/sim/names/infraNames.ts`)
Company: "the {A} and {B} Railway" (ends), "the {Polity} Canal Company", "{Family} & Sons Telegraph", "the {Town} Water Works".
State lines: "the {Polity} State Railways", "the Imperial {Town} Line" for strategic lines. Air: "{Polity} Air". Uses existing
naming tables (`nameWorld` naming object) so language-drift's exonyms apply.

### 5.3 Chronicle (hedged, `ui/infraFormat.ts describeEvent`)
- 350: "1873 · The railway from Ostrava reached Vel Tarn, the first in the realm." / "A canal now joins Ammar and the river port of Suhl."
- 351: "The line from Kesh to Ombro, unpaid for years, was given up; its cuttings are still walked."
- 352: "In the war the bridges on the Vel Tarn line were blown; trains no longer ran to the border."
- 355/356: "Railway shares were the talk of Ostrava (12 companies floated in four years)." / "The railway boom at Ostrava broke; half the
  lines it promised were never laid, and many merchant houses were poorer for it."
- 357: "Ostrava and six other towns went dark when the Kesh works failed."
- 358: "Vel Tarn's new water works opened; the town had buried many of the flux before."
- 359: "An airport opened at Suhl."
### 5.4 Legend (story register, sagas phrase table `INFRA_T`)
- LineOpened: "The iron road came to {b} in {year}, and the old carters of {a} cursed it from the inns."
- ManiaCrashed: "Everyone in {town} had bought a railway; by winter nobody would buy one back."
- Blackout: "The lights of {town} went out, and then the lights of {n} towns more."
- CleanWater: "They dug the sewers under {town}, and the summer sickness that took the children came no more."

---

## 6. Rendering (budgets per perf-efficiency.md)

### 6.1 Globe and map overlays (`src/render/infra.ts`, one module, one layer per kind)
- Geometry from `History.infra` paths through **routeCurves.ts `smoothPaths`** (per-link smoothing; links do not need trade's bundling,
  but rail and highway on the same cells should share a curve: build a second `routeNetwork` over infra paths, cached per history).
- Rail: dark ribbon with a lighter core, ties as a dashed texture from mid zoom; viaducts/bridges where it crosses rivers (reuse the
  bridge detection of roads.ts). Highway: pale grey, wider, from grade 1. Canal: thin water-coloured line using the river shader colour.
  Power: thin lines with pylon glyphs (instanced) at mid zoom only. Telecom: faint dotted line, hidden at globe zoom. Pipeline: brown
  dashed. Cable: faint line over ocean (seabed tint). Air: great-circle arcs lifted `0.02·angle` above the surface (like longhaul arcs),
  optional plane glyphs moving along them. Orbital: short vertical arcs at launch sites. With infra on these layers **replace** future-tech 4.2's hub arcs and rocket trails
  (same look, drawn from `History.infra` Air/Orbital links; its orbital ring of off-world rows stays future-tech's).
- **Per-era visibility**: each layer's vertices carry (openedYear, lostYear); the shader fades by year; P4 draw-range culling: links sorted
  by openedYear, `setDrawRange` up to the year; a layer is `visible = false` before its first link.
- **Condition and load**: a 2-snapshot `DataTexture` of (cond, load) per link rebuilt from change rows when the bracketing snapshot pair
  changes (as roads.ts does for road levels).
- **Night lights**: reuse the globe's existing `setCityLights(perCell, intensity)` (globe.ts:92–96 [V]: per-cell intensity uploaded to
  a float texture, night side only). The per-cell value becomes `lightBase(pop) · (0.3 + 0.7 · elec)` from the bracketing land snapshot;
  no new texture. future-tech 4.2's `History.future.light` factor is then 1 (this plan supplies the electrified share).

### 6.2 Budgets [A, to verify with `profile-playback.mjs`]
- ≤ 6 extra draw calls when all layers show (rail, highway, power+pylons as one, telecom+cable, air, canal+pipeline); ≤ 60k triangles at
  4000 years (links ~300–800 [A from 9.1] × ~40 samples × 2 tris); CPU geometry ≤ 3 MB (freed after upload per P5); 0 per-frame
  allocation; nothing built until the shown year passes the first link (lazy build at first visibility).

### 6.3 City-level hooks for city-renderer-eras.md
`infraAt(h, settlement, year)` → `{ stations: [{ kind: 'halt' | 'junction' | 'terminus', bearings: number[] (degrees of the lines leaving),
yards: boolean }], interchange: boolean, portTerminal: 0 | 1 | 2 (none, deep-water, container), airport: 0..3, plants: InfraFuel[],
substation: boolean, waterworks: boolean, sewers: boolean, elec: 0..1, commuteKm: number, highways: number[] (bearings),
trams: boolean }`. The city renderer places the station on the side of the town the first line arrives from, yards beside a terminus,
an interchange where rail meets highway, substations at the edge, the airport at `0.6 · commuteKm` on the flattest bearing away from the
sea, a waterworks by the river, and spreads suburbs along highway bearings up to commuteKm (Baum-Snow 2007 [verified]: highways and
suburbanisation).

---

## 7. Stats harness and targets (`src/sim/history/infra/infraStats.ts`; `node --experimental-strip-types … [--off] [--json] seeds…`)
Seeds 1, 7, 42, 1234; 2000-year runs (proxy unlocks reach rail by 2000 only where Crafts ≥ 3.8: seeds 7, 42, 1234 [M: max Crafts
4.8–5.3]) and 4000-year runs (all seeds); with tech-tree-innovation on, 3500-year runs (its divergence runs).

| # | target | metric | band | basis |
|---|---|---|---|---|
| T1 | rail network grows in an S-curve after its unlock | logistic fit of total open rail km in the 3 largest rail polities over 200 years after the first line: R² ≥ 0.9; 10%→90% time 40–150 years | design target | Grübler 1990 (logistic growth of infrastructures) [verified: record only] |
| T2 | network length scales with economy | log-log slope of rail km on the GDP proxy (Σ smoothed `income` of members) across polities with rail at the last year | 0.6–1.4 | design target, no source |
| T3 | price convergence along new lines | diff-in-diff: mean \|ln p_a/p_b\| (grain and Crafts goods) for pairs whose network cost fell ≥ 40% vs matched pairs (same baseline cost tercile) over 30 years | ≥ 20% relative fall | direction from Donaldson 2018 [verified]; size a design target |
| T4 | gravity guard | realismStats PPML distance elasticity at the last year, on vs off | not closer to 0 by > 0.1 | Disdier & Head 2008 [verified]: the distance effect "rose around the middle of the century" and stayed high |
| T5 | access → towns | regression of 30-year ln pop growth on Δ infraAccess (towns ≥ 1000): positive; on rural settlements < 1000: \|β\| small | β_town > 0, β_rural ≤ ½ β_town | Atack et al. 2010 [verified]: railroads caused much of Midwestern urbanisation with little effect on density; Donaldson & Hornbeck 2016 [verified]: removing 1890 railroads would cut farm land value 64% |
| T6 | sanitation | waterborne (flux) deaths per head in towns with waterworks+sewers vs before | −40% to −75% | Cutler & Miller 2005 [verified]; Alsan & Goldin 2019 [verified] |
| T7 | manias | ≥ 1 mania per 2 seeds with private rail; peak E/R̄ 2–5; capital lost 20–40% of mania capital | as stated | Odlyzko 2010 [verified: working paper] |
| T8 | telegraph | variance of ln price gap on wired pairs falls vs unwired | ≥ 15% | Steinwender 2018 [verified] direction |
| T9 | night lights | ln(Σ elec·pop) vs ln(GDP proxy) across polities: positive, R² ≥ 0.5 | as stated | Henderson et al. 2012 [verified: record] (lights track activity) |
| T10 | empire guard | Kingdom+ censored-exponential lifespan and largest-state land share at the last year, on vs off | lifespan ≤ +10%; share ≤ +0.05 | realism-metrics.md §2.4 (already too long-lived) |
| T11 | ruins | share of relict cells later reused by a road (road ≥ 0.25) within 300 years | > share of random land cells | Dalgaard et al. 2022 [verified] |
| T12 | cascades | blackout size distribution: most failures small, a few large (top 10% of blackouts ≥ 5× median towns) | as stated | Motter & Lai 2002; Buldyrev et al. 2010 [verified] (qualitative) |
Realism scorecard (`realism-scripts/realismStats.ts --from off --vs on`) must not worsen by more than 0.02 in total score.
Diagnostics printed: candidates by generator, begun/refused (budget, treaty, will), mean B/C of begun lines, km by kind and owner kind,
mean condition, closures by cause, manias, cascade sizes, time per phase.

---

## 8. Ordered commit-sized steps (each with `npm test` and `npm run typecheck` green; goldens unchanged until step 16)
1. **Contract + switch**: enums, `InfraHistory`, `emptyInfraHistory`, `HistoryOptions.infrastructure/infraFeedback`, `History.infra`.
   Test: default run hashes equal the perf goldens.
2. **State, params, RNG, unlocks**: `infra/state.ts`, `params.ts`, `unlock.ts` (ideaUnlock or proxy). Test: unlock is monotone in Crafts;
   with the switch on and nothing unlocked, every other field is bit-identical.
3. **Path finder**: `infra/path.ts` (A*, weights per kind, tunnels gated, cable sea-only). Tests: synthetic grids (a mountain forces a
   detour without tunnelling; a river costs one bridge; canal refuses highlands), determinism, visit cap.
4. **Node graph + market access + candidates + state builder (consequence layer)**: `access.ts`, `plan.ts`; events 350/351; assembly of
   links and nodes. Tests: MA gain is ≥ 0 and 0 for a link duplicating a cheaper path; trunk first; feedback-off bit-identity of all other
   fields; stats v1 (T1, T2 shapes).
5. **Upkeep, decay, closure, relicts**: `upkeep.ts`, change rows. Tests: unpaid → closes in ~(1 − qClose)/δ years; relict half-life.
6. **Feedback on movement and trade**: `refreshMoveCost` (single writer; floor), cell CSR and `cellMul`, network edges in `rebuildLinks`,
   `infraReprice`. Tests: no land step < 0.26 (assert in a test run); migration and territory searches give the same results as an
   exact Dijkstra on a sample (bucket assumption, R1); T3, T4 measured.
7. **Finance wiring**: finSpend/finCredit (or proxies); budget, regime and court factors. Test: a bankrupt crown begins nothing; budget
   bound respected.
8. **Private capital**: companies, concessions, sentiment, manias, crashes, nationalisation (Pool owners; families behind feedback).
   Tests: a forced over-optimistic sentiment produces a crash; lost capital is debited once; T7.
9. **Borders, gauges, war damage, blockade, conquest, disasters**: 352, 353; grudge 14. Tests: no line built between polities at war;
   cut lines carry nothing; repaired at peace.
10. **Grids**: plants (Hydro at dams), supply, elec, cascades (357), interdependence. Tests: Motter–Lai cascade on a toy star graph
    matches a hand computation; bounded rounds.
11. **Telecom and cables**: infraWire, beliefs channel, riots kernel, price information damping. Tests: T8; branching bound unchanged.
12. **Water and sewerage**: nodes, coverage, disease toll hooks, 358. Tests: T6; off → disease identical.
13. **Reach, march, epidemics, agglomeration, electrified industry**: control.ts, war.ts, disease contacts, econ multiplier. Tests: T5,
    T10 guard.
14. **Air, containers, future kinds** (with future-tech): airports (Structure 6), container terminals, launch sites, maglev/hyperloop
    grades, vertiports. Tests: air links have empty paths; containers lower port sea-leg costs.
15. **Assembly + UI + prose + director + seat orders**: infraData, panels, Chronicle/Legend, registrations, OrderKind 59–61, DecisionKind 45.
16. **Rendering**: overlays, night lights, city hooks; perf census; then calibration (cellCost, v_MA, fares, budgets) against section 7
    and the realism guards; flip `INFRA.on` only when T4 and T10 pass.

---

## 9. Performance and memory

### 9.1 Sizes [A, from 1.6]
Nodes per polity ≤ 64; polities with networks ~10–40 [A]; towns ≥ 3000 world-wide 21–94 [M]; links ever: rail ~100–400, highway ~200–600,
telecom ~100–400, power ~100–300, canals ~30–100, cables ~20–80, air ~50–200 per 4000-year run [A] → ≲ 2,500 links.

### 9.2 CPU [A, to measure in step 16 with perf-scripts/bench-sim.ts]
- Per planning step per polity: node graph V ≤ 80 Dijkstras over E ≤ ~1,500 edges ≈ 80 · 1,500 · log 80 ≈ 0.8 M operations; candidates
  8 × kinds 6 × V² (6,400) ≈ 0.3 M; paths 48 A* × ≤ 6,000 visits ≈ 0.3 M relaxations. ~1.4 M per polity-step; 30 polities / 5 years →
  ~8 M ops a year ≈ 5–15 ms a year in V8 [A]. Over a 2000-year modern era: ~10–30 s of a ~10–20 s history: **too much** if every polity
  plans every step. Mitigations, all in the plan: stagger (`id % step`), skip a polity's kinds whose candidate set did not change since
  its last step (cache by epoch and member set hash), cap V at 64, A* only for candidates whose straight-line B/C bound beats the best
  found. Budget: **≤ +8% of history time on 4000-year runs** (fail the step otherwise).
- Yearly: upkeep over live links (≤ 2,500) and damage scans: negligible. `infraReprice`: O(pairs) ≤ ~1,200 per epoch change.
- Trade: network edges add ≤ ~1,000 edges to the CSR at a rebuild; partner search cost unchanged in order (maxNodes 40).
- Cell searches: unchanged in order; with the floor, migration's Dial buckets stay exact.

### 9.3 Memory
- History: links 2,500 × ~45 bytes + paths (~15 cells × 4 bytes) ≈ 0.26 MB; change rows ≤ 50,000 × 9 bytes ≈ 0.45 MB; nodes, companies,
  manias ≈ 0.1 MB; per-settlement land snapshots 2 × Uint8 × settlements ever (~3,000–6,000) × modern land snapshots (~50–150) ≈ 0.3–1.8 MB for 6000
  years — the largest part (only elec and water are stored; access and commute are recomputed).
  Target: **≤ +3 MB History at 2000 years, ≤ +5 MB at 6000** (perf plan: History 34–39 MB per 2000 years [M there]).
- Live state: cellMul Float32 per cell (92 KB), cell CSR (≤ 40k ints), node graph scratch 80² Float64 (51 KB), per-settlement arrays.

---

## 10. Risks and open questions
- **R1 (bucket queues).** A network discount below 0.25 cell units breaks the assumption of territory.ts (`BUCKET = 0.25`) and slows
  migration's Dial queue (re-settles). Hence the 0.26 floor on `s.moveCost` and the node-graph layer for the big savings. If the
  floor makes rail corridors too weak for armies and migrants, lower both bucket widths to 0.1 (both files) behind the switch and
  re-measure (cost: ~2.5× more buckets).
- **R2 (pairCost freeze).** Without `infraReprice`, lines would not reach prices for up to 50 years (1.3). Re-pricing on epoch changes
  touches trade's internals; keep it a pure function of (pairCost0, net costs).
- **R3 (empires).** Reach bonuses make big realms bigger and longer-lived, already the sim's weakest realism metric. T10 is a hard gate;
  if it fails, cut `reachRail` and rely on mobilisation speed only, or let wired polities also spread ideologies faster (riots), which
  historically cut both ways.
- **R4 (distance).** Cheap networks pull the distance elasticity toward 0; real-world distance effects persisted (Disdier & Head 2008).
  Freight costs here floor at grade 2; transfer costs and gauge breaks keep distance in play. T4 gates it.
- **R5 (scale).** With 20–100 towns, networks are small; manias with ≥ 4 companies need several big polities. If T7 fails, lower
  `maniaFloat` to 3 rather than inflating sentiment.
- **R6 (pacing).** In proxy mode rail arrives late in 2000-year runs on seed 1 (max Crafts 3.6 [M]); the plan's effects are mostly seen in
  long runs or with tech-tree-innovation's pacing. Stats use 4000-year runs.
- **R7 (calibration of money).** cellCost and v_MA are in wealth units whose scale differs by seed; calibrate as shares of revenue
  (first trunk ≈ 1–3 years of a Kingdom's revenue [A]) rather than absolute numbers.
- **Q1** Should Air links be built by states as prestige (national airlines) more than by B/C? Proposed: Air is commercial, with a
  prestige bonus for capitals.
- **Q2** future-tech overlap: resolved by the coordinator (this plan owns all networks; future-tech unlocks and prices). The remaining
  edits to future-tech (skip its hub builder, its edge-wide `L_p` division and its `sqrt(L_p)` reach factor when infra is on) are listed
  in 0.4 and should be mirrored there as an addendum.
- **Q3** city-renderer-eras.md was not readable when this plan was finished; the hooks in 0.2/6.3 are offered, names to be confirmed
  there. migration-borders.md has adopted `infraNetCost` (checked).
- **Q4** Suburbanisation: the sim keeps one population per settlement; splitting a city into core and suburbs is out of scope; the renderer
  shows it.
- **Q5** Should canals exist before the modern age (Grand Canal era)? With tech-tree's `poundLock` (era 3), yes: canals are this plan's
  earliest network, which also makes the plan testable on 2000-year runs.

---

## 11. Verified vs assumed (summary)
- [V] Structures, roads, the travel-cost field and its readers, bucket widths, trade links/pairs/market transport, reach and march formulas,
  disease edges, render modules: section 1 with file:line references at 8cabf09.
- [M] Section 1.6 table (probe-infra.ts, 4 seeds × 2000 years, seed 42 × 6000 years).
- [A] All INFRA parameters, mode costs, speeds, regime factors, decision rules, budgets and the CPU/memory estimates.
- Sourced: Marchetti's one-hour travel budget; market access form (Donaldson & Hornbeck); trade-cost elasticity −3 (Limão & Venables);
  railway effects on prices and income (Donaldson); railways and urbanisation (Atack et al.); highways and suburbs (Baum-Snow); telegraph
  and price gaps (Steinwender); clean water and mortality (Cutler & Miller; Alsan & Goldin); railway mania figures (Odlyzko, working paper);
  persistence of Roman roads (Dalgaard et al.); cascades (Motter & Lai; Buldyrev et al.); night lights (Henderson et al.); distance
  persistence (Disdier & Head); containers (Bernhofen et al.); epidemics on air networks (Brockmann & Helbing); preferential attachment
  (Barabási & Albert); infrastructure S-curves (Grübler; Fisher & Pry, records only).

---

## References
- Alsan, M. & Goldin, C. (2019). Watersheds in Child Mortality: The Role of Effective Water and Sewerage Infrastructure, 1880–1920. *Journal of Political Economy* 127(2). https://doi.org/10.1086/700766 — [verified] (NBER w21263 abstract opened: "together account for approximately one-third of the decline in log child mortality").
- Atack, J., Bateman, F., Haines, M. & Margo, R. A. (2010). Did Railroads Induce or Follow Economic Growth? Urbanization and Population Growth in the American Midwest, 1850–1860. *Social Science History* 34(2):171–197. https://www.nber.org/papers/w14640 — [verified] (NBER abstract opened).
- Barabási, A.-L. & Albert, R. (1999). Emergence of Scaling in Random Networks. *Science* 286(5439):509–512. https://doi.org/10.1126/science.286.5439.509 (arXiv: https://arxiv.org/abs/cond-mat/9910332) — [verified] (records found by search; abstract not opened, cited only for the concept of preferential attachment).
- Baum-Snow, N. (2007). Did Highways Cause Suburbanization? *Quarterly Journal of Economics* 122(2):775–805. https://ideas.repec.org/a/oup/qjecon/v122y2007i2p775-805..html — [verified] (abstract opened: one new highway "reduces its population by about 18 percent").
- Bernhofen, D. M., El-Sahli, Z. & Kneller, R. (2016). Estimating the effects of the container revolution on world trade. *Journal of International Economics* 98:36–50. https://doi.org/10.1016/j.jinteco.2015.09.001 — [verified] (abstract opened; it reports "economically large" effects but no single number).
- Brockmann, D. & Helbing, D. (2013). The Hidden Geometry of Complex, Network-Driven Contagion Phenomena. *Science* 342(6164):1337–1342. https://doi.org/10.1126/science.1245200 — [verified: record only] (title and venue confirmed by search records; DOI not confirmed on a page; cited for "effective distance").
- Buldyrev, S. V., Parshani, R., Paul, G., Stanley, H. E. & Havlin, S. (2010). Catastrophic cascade of failures in interdependent networks. *Nature* 464:1025–1028. https://doi.org/10.1038/nature08932 — [verified] (PDF header with DOI found).
- Cutler, D. & Miller, G. (2005). The role of public health improvements in health advances: the twentieth-century United States. *Demography* 42(1):1–22. https://doi.org/10.1353/dem.2005.0002 — [verified] (PubMed abstract opened).
- Dalgaard, C.-J., Kaarsen, N., Olsson, O. & Selaya, P. (2022). Roman roads to prosperity: Persistence and non-persistence of public infrastructure. *Journal of Comparative Economics* 50(4):896–916. https://doi.org/10.1016/j.jce.2022.05.003 — [verified] (EconPapers abstract opened).
- Disdier, A.-C. & Head, K. (2008). The Puzzling Persistence of the Distance Effect on Bilateral Trade. *Review of Economics and Statistics* 90(1):37–48. https://doi.org/10.1162/rest.90.1.37 — [verified] (abstract opened: the distance effect "rose around the middle of the century"; the 0.91 mean elasticity is quoted from realism-metrics.md, which fetched it).
- Donaldson, D. (2018). Railroads of the Raj: Estimating the Impact of Transportation Infrastructure. *American Economic Review* 108(4–5):899–934. https://doi.org/10.1257/aer.20101199 — [verified] (NBER w16487 abstract opened).
- Donaldson, D. & Hornbeck, R. (2016). Railroads and American Economic Growth: A "Market Access" Approach. *Quarterly Journal of Economics* 131(2):799–858. https://nber.org/papers/w19213 — [verified] (abstract opened: removing 1890 railroads would "decrease the total value of US agricultural land by 64%").
- Fisher, J. C. & Pry, R. H. (1971). A simple substitution model of technological change. *Technological Forecasting and Social Change* 3:75–88. https://swov.nl/en/publicatie/simple-substitution-model-technological-change — [verified: record only] (bibliographic records found by search; text not opened; DOI not confirmed).
- Grübler, A. (1990). *The Rise and Fall of Infrastructures: Dynamics of Evolution and Technological Change in Transport.* Heidelberg: Physica-Verlag. https://pure.iiasa.ac.at/id/eprint/3351/ — [verified: record only] (IIASA and library records found; the repository page was bot-blocked, so its logistic fits are not quoted).
- Hansen, W. G. (1959). How accessibility shapes land use. *Journal of the American Institute of Planners* 25(2):73–76. https://doi.org/10.1080/01944365908978307 — [unverified] (pages found were captcha-blocked; DOI and pages not confirmed; cited only for the accessibility idea, which Donaldson & Hornbeck's verified form already carries).
- Henderson, J. V., Storeygard, A. & Weil, D. N. (2012). Measuring Economic Growth from Outer Space. *American Economic Review* 102(2):994–1028. https://doi.org/10.1257/aer.102.2.994 — [verified: record only] (EconPapers/NBER records found; no number from it is used).
- Limão, N. & Venables, A. J. (2001). Infrastructure, Geographical Disadvantage, Transport Costs, and Trade. *World Bank Economic Review* 15(3):451–479. https://ideas.repec.org/a/oup/wbecrv/2001153451--479.html (JSTOR 3990110) — [verified] (abstract opened: elasticity "around -3"; median → 75th percentile infrastructure raises transport costs 12 points and cuts trade 28%).
- Marchetti, C. (1994). Anthropological invariants in travel behavior. *Technological Forecasting and Social Change* 47(1):75–88. https://trid.trb.org/View/716444 (IIASA RR-95-04: https://pure.iiasa.ac.at/id/eprint/4071/) — [verified] (TRID abstract opened: "mean traveling time … is one hour per day").
- Motter, A. E. & Lai, Y.-C. (2002). Cascade-based attacks on complex networks. *Physical Review E* 66:065102. https://doi.org/10.1103/PhysRevE.66.065102 — [verified] (arXiv cond-mat/0301086 opened: C_j = (1 + α)L_j, "the constant α ≥ 0 is the tolerance parameter").
- Odlyzko, A. (2010). Collective hallucinations and inefficient markets: The British Railway Mania of the 1840s. Preliminary working paper, University of Minnesota. https://www-users.cse.umn.edu/~odlyzko/doc/hallucinations.pdf — [verified] (manuscript opened; not peer-reviewed).
- Rosenthal, S. S. & Strange, W. C. (2004). Evidence on the nature and sources of agglomeration economies. In *Handbook of Regional and Urban Economics* vol. 4, ch. 49:2119–2171. https://ideas.repec.org/h/eee/regchp/4-49.html — [verified] (abstract opened; it gives no magnitudes, so INFRA.agg is a design default).
- Steinwender, C. (2018). Real Effects of Information Frictions: When the States and the Kingdom Became United. *American Economic Review* 108(3):657–696. https://doi.org/10.1257/aer.20150681 — [verified] (abstract opened).

## Addendum (central registry)
Renumbered: GrievanceKind 16 Expropriated (14 = modern-ideologies, 15 = future-politics), OrderKind 68–70 and DecisionKind 53 (migration-borders holds 59–61 / 45–46). See _CONVENTIONS.md.

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **Semantic owner of C4 (empire reach)** (MASTER-PLAN §2.3): form × Chancellor × one network factor, clamp [0.5, 3].
- **R4c.** Event 354 `Concession` is renamed **`ConcessionGranted`**: riots owns `Concession: 282`.
- **§2.10 CPU gate.** Measure the planning cost (step 4) with `bench-sim.ts` on a 4000-year run before steps 6–13 start. If it exceeds +8% of history time, implement the 9.2 mitigations first.
