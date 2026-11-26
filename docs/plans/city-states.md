# Plan: Forms of government and the birth of city-states

Target: worldseed at commit 8cabf09. Plan only; nothing in the repo is changed.

Markers: **[V]** I read it in the code at 8cabf09. **[M]** I measured it with the probes in section 1.7. **[A]** An
assumption or a tuning guess; check it while implementing.

Sibling plans and what this one takes from them:
- `grudges-and-oaths.md` (already written) takes EventTypes **190–199**, adds `BondEnd.Betrayed: 5`,
  `HistoryOptions.oaths`, and fields on PolityState. This plan uses **EventTypes 200–209** and adds **`BondKind.Charter: 3`**
  (no new BondEnd).
- `merchant-families.md` (written) takes EventTypes 161–169. Its section 8.2 offers `familiesAt`, `familyCapitalAt`,
  `familyInfluence`, `topFamilies`, `topFamilyAt` and `Ruler.family?`. Section 9 of this plan uses them and amends
  them.
- `state-finances.md` (being written) gets the interface it must provide in section 9.2. Until it lands, every rule here
  runs on the proxies given there.

---

## 1. Current behaviour

### 1.1 Polity formation (`src/sim/history/polity/formation.ts`) [V]
- `formation()` runs every `POLITY.slowStep` (10) years. A stateless settlement with `pop >= formPopOf(s)` can found a
  state. `formPopOf` is `formQuant * the formTop quantile`, clamped to `[formPopMin 800, formPop 1500]`. The settlement
  also needs `grainShare >= POLITY.formGrain (0.4)`, must be `formRatio` (1.5) times every stateless neighbour in reach,
  and needs `formDependents` (2) or more neighbours that pass the submission test. The new polity has
  `PolityOrigin.Formed`, and its dependents join it.
- `accretion()` adds stateless neighbours, at most 8 per polity per step. `absorption()` makes a polity with fewer than
  `absorbMembers` (6) members join a 3x larger neighbour whole. Leagues are excluded from both.
- `leagues()` runs every slow step. Two stateless towns of `LEAGUE.minPop` 2000 or more, joined by an open route of at
  least 100 loads, within a population ratio of 2 and threatened, found a polity with `PolityOrigin.League`. Its capital
  is the town with more `through`. A league whose mean danger stays under `calm` for 50 years sheds one member per step.
- `newPolity()` in `polity/state.ts` logs PolityFounded and calls `rulerNewPolity` (the rulers hook) **last**.
  `endPolity()` calls `rulerPolityEnded`.

### 1.2 Tiers [V]
`tierOf(pop, members, multi, worldPop)` in `polity/state.ts` returns Chiefdom, Kingdom or Empire. It is derived and
never stored. The UI has its own mirror, `PolityTier` and `TIER_WORDS` in `ui/politiesData.ts`.
`tierWord(pd, p, tier)` returns `'League'` for `origin === League` and the tier word otherwise.
`polityTitle` returns `"${tierWord} of ${name}"`.

### 1.3 Rulers and succession (`src/sim/history/rulers/`) [V]
- `rulerNewPolity` calls `electHead` for a League: no house, `AccessionHow.Elected`, age U(40,65), a term of
  U(`termMin` 3, `termMax` 12) years stored in `rDeath`. Every other polity gets a new house (`newHouseAccede`), except
  in the Partition and Civil contexts (`R.ctx`).
- In `rulerYear`, a reign with `rDyn < 0` is treated as a league head. At the end of its term it gets
  `endReign(TermEnded)` and `electHead` runs again. Nothing else happens to such a reign: no battle death, overthrow or
  births.
- `succession()` applies the people's law: Primogeniture, Partible, Elective or Seniority. Chiefdoms take a chief from
  another family with chance `chiefHouse`. An extinct house ends in a marriage claim, a cadet line or a new house. A
  contested succession opens a SuccessionCrisis and may lead to civil war or partition. An overthrow brings in a usurper
  house.
- Marriages and unions skip leagues (`marriage.ts:128`, `ps.pOrigin[p] !== PolityOrigin.League`).
- `rulers.test.ts:117` asserts **`dynasty < 0 ⇒ origin === League`**. Step 3 must relax this.
- UI: `rulersData.ts rulerWord` returns `'Elected head'` when `dynasty < 0` or the origin is League.
  `rulersFormat.ts:146` reads "X is elected head of the league".

### 1.4 Revolt, secession, defection (`unrest.ts`, `civil.ts`, `realm.ts`) [V]
- Grievance (`unrest.ts grievance`) is the sum of the peasant, provincial, ethnic, colonial and religious terms. A
  member with unrest `>= 0.55` rises with chance 0.06 per step and gathers a cluster of up to 15 discontented
  neighbours. The rebels win with probability `rb²/(rb²+sup²)`, where `sup = projAt` at the seat.
- A winning cluster becomes a successor state only if it has **`cluster.length >= 2` and `pop >= POLITY.minState`
  (1500)**. Otherwise each town defects to a neighbouring polity of its own people that it would submit to, or goes
  stateless.
- `successors()`, `civilWar()` (side `>= 2`) and `partition()` (groups `>= 2`) also require two or more settlements.

**So no rule today makes a single town into a state.** Single-member polities appear only through attrition: towns lost
in war or revolt, or a league shedding members (`leagues()` decline). The probe confirms how rare they are (1.7).

### 1.5 Bonds (`bonds.ts`, `policy.ts`) [V]
- Bond kinds are Vassal, Tribute and Alliance. `newBond` sets `pSub[a]` for any kind other than Alliance.
- `bound(ps,p,q)` reads `pSub`: bound pairs never fight and trade duty-free.
- `tributeFlows` takes `share * inFood[cap]` and `share * WEALTH.decay * wealth[cap]` from the vassal to the overlord.
- In `bondStep`, a vassal is freed when `proj < VASSAL.rebel * mass`. It is absorbed after 80 years if
  `proj >= 3.5 * mass`.
- `subject()` passes a new vassal's own subjects on to its overlord.
- `overawe` skips polities with `pSub >= 0` and leagues.

### 1.6 Other hooks this plan touches [V]
- `localOf` (submission, defence) and `projAt` are in `polity/state.ts`. Mass and reach are set in
  `control.ts controlOf`, with `rulerMass` applied.
- War declaration drive (`war.ts declarations`) is
  `rv * smoothstep(adv) * crisis * (1 - e) * rulerWar * holyDrive * orders`.
- Tariff and embargo are in `policy.ts tariffStep`: `embargoOn 1.2`, `off 0.85`, and the base by tier. The "need" term is
  `smoothstep(needHigh, needLow, wealth[cap]/mass)`.
- Rivalry is `relations.ts relationStep`.
- Peace terms are `bonds.ts peaceTerms`: vassal at advantage `>= 1.2`, tribute at `>= 0.6`.
- Goods: merchant capital `g.ext.merch.mw[id]` (`merchants.ts`) and the lane urge (`routes.ts:189`). Posts are
  `addPost` (`routes.ts:491-500`).
- Religion: `rel.holy[f]`, `rel.org[f]`, `rel.pilgrims[f]`, `polityFaith`, `majorityOf`, `faithGrievance` and
  `holyDrive` (`religion/system.ts`).
- Order of the year (`history/index.ts`): `tradeSystem → taxSystem → … → politySystem (which runs rulerYear first) → …
  → goodsYear → religionYear`.
- Inside `politySystem`, every `step` (5) years: `controlPass, dangerStep, cohesionStep, unrestStep, revoltStep,
  realmStep, bondStep, coastRaids, tariffStep`. Every `slowStep`: `formation, leagues, accretion, absorption, [overawe],
  relationStep, allianceStep, [kinStep], hubStep, declarations, raids, wallStep, hostileCells, [outlawStep]`.
- Off-switch convention: `s.pol`, `s.rul` and `s.rel` are `null` when off, and every hook is a no-op then. Golden tests
  pin `hashBaseFields` with the later systems off (`rulers.test.ts:220`, `polity.test.ts:267`, `goods.test.ts:294`).
- `history.test.ts:228` switches over every EventType, so new types must be added there.

### 1.7 Measurements (2000-year default runs; probes in `/home/claude/scratch-citystates/scripts/cityStateProbe{,2,3}.ts`) [M]

| seed | polities | origins F/Rv/Fr/Col/Part/CW/League | ever single-member (History, all snapshots) | max single-member alive at once (every 100y) | stateless towns ≥1500 at y2000 (grain<0.4) |
|---|---|---|---|---|---|
| 1 | 70 | 3/29/0/16/5/14/3 | 5 | 2 | 8 (4) |
| 7 | 83 | 6/43/0/6/8/15/5 | 2 | 1 | 28 (27) |
| 42 | 85 | 9/35/1/13/4/17/6 | 5 | 1 | 4 (2) |
| 1234 | 69 | 9/17/0/23/4/10/6 | 1 | 1 | 2 (2) |

The would-be city-state pool: non-capital member towns with pop ≥ 1500, sampled every 50 years from year 800.
W = wealth + merchant capital.

| seed | samples | port / river-only / inland | W/W_cap p50 / p90 | grip p50 | distinct towns with W ≥ W_cap | distinct with W ≥ 0.3 W_cap and Local/Proj ≥ 0.3 |
|---|---|---|---|---|---|---|
| 1 | 121 | all port/river | 0.12 / 0.87 | 0.91 | 5 | 11 |
| 7 | 270 | 215 / 55 / 0 | 0.34 / 3.00 | 0.93 | 18 | 22 |
| 42 | 255 | 253 port/river, 2 inland | 0.36 / 1.44 | 0.86 | 20 | 27 |
| 1234 | 553 | 348 / 201 / 4 | 0.20 / 1.47 | 0.87 | 34 | 32 |

Further findings, from seeds 7 and 1234 [M]:
- **Every big town is on water and nearly every one is a mart** (`isMart`: 252/270 and 487/553). "Port or river" and
  "mart" therefore do not pick out trading towns. Use port over river, `through`, and merchant capital per head.
- Merchant capital per head among candidates: p50 2.1 / 4.1, p90 38 / 67.
- **The tariff "need" proxy is 0 for every candidate** (p90 0.00), so crowns are never short of money by that
  measure. Crown need must come from war, crisis or a lost war until finances lands.
- The overlord was at war in 5/67 and 17/110 candidate samples, and in crisis in 12/67 and 11/110.
- Almost every candidate town lies inside its overlord's reach (grip p50 about 0.9). "Distant" therefore has to mean a
  weak grip *relative to the town's own force*, not grip below 0.6: only 0–3 towns per seed had grip < 0.6.
- Big towns exist mainly after year 1300. Most city-state activity will fall in years 1300–2000.
- Run time: probe runs took 30–63 s per seed, two in parallel on 2 cores with probe overhead. The perf bench
  (`/home/claude/plans/perf-scripts/bench-2000.log`) gives 14–22 s of history per seed.

---

## 2. Design overview

Every polity has a **government form** that changes over time. Forms are recorded in History as a change log, like the
reigns.

| form | how it rules | head | typical way in | typical way out |
|---|---|---|---|---|
| Monarchy (0) | crown and court | hereditary house (today's rulers) | default | council abolishes the throne; overthrown into a republic |
| Republic (1) | council of the great merchant houses | elected for a term (league-head machinery) | town rises against its lord; a free city stops paying its due; a stateless trading town governs itself; council at an extinct throne; league remnant | signoria; conquest |
| FreeCity (2) | own council under a **nominal overlord** (Charter bond) | elected for a term | buys a charter from an overlord in need (as imperial cities bought charters from princes in need of funds: Wikipedia "Free imperial city") | stops paying (becomes a Republic); charter revoked (absorbed) |
| Signoria (3) | a strongman or family through the old council (signoria: Britannica "Signoria"; Jones 1997) | hereditary house (usurper) | war captain, demagogue in a crisis, leading family (with families feedback) | crowned (becomes a Monarchy); republic restored |
| Theocracy (4) | clergy of a holy city's faith | elected for life by the priests | holy city secedes, is stateless, or its small realm's throne passes to the clergy | secularised (faith lost); conquest |
| Confederation (5) | tribal confederation of herding chiefs | elective among houses (khan) | a state founded by herders | settles into a Monarchy |
| League (6) | diet of member towns | elected for a term (unchanged) | `PolityOrigin.League` | a league shrunk to one town becomes a Republic |

**A city-state** is a polity whose form is Republic, FreeCity or Signoria and that began as one city and its contado (the countryside a city-state ruled: Jones 1997; Wikipedia "Contado").
Its origin is `Charter` or `CityState`, or it is a monarchy converted by its council. The concept exists only for
statistics and UI; the sim never tests for it.

The forces that drive transitions: **wealth**, meaning the town's revenue against the crown's; **force**, meaning what
the town can field (its own levy times the mercenaries its money hires) against what the crown can project at it; and
**need**, meaning an overlord in debt, at war, in crisis or just beaten. These are written as formulas in 4.

---

## 3. Contract (`src/contract.ts`), drafted in the codebase's style

### 3.1 Enums
```ts
// ---------------------------------------------------------------------------
// governments: forms of government and city-states (all empty when HistoryOptions.governments or polities is false).

/** Form of government of a polity (History.governments: it may change over the polity's life). */
export const Government = {
  Monarchy: 0, // a hereditary ruler and court (king, chief, emperor): the ruling house of History.rulers
  Republic: 1, // a merchant republic: a council of the great houses rules and elects a head for a term (no house; History.rulers.dynasty -1)
  FreeCity: 2, // a self-governing city under a nominal overlord (History.bonds kind Charter): its own council and elected head, a yearly due, no levy
  Signoria: 3, // a republic taken by a strongman or a family, who rule through its old council and pass it to their heirs (a house again)
  Theocracy: 4, // ruled by the clergy of a faith from its holy city: a head chosen for life by the priests (no house)
  Confederation: 5, // a confederation of herding chiefs who choose a paramount chief from among their houses (elective among houses)
  League: 6, // a league of trading towns (PolityOrigin.League): its diet elects a head for a term
} as const
export type Government = (typeof Government)[keyof typeof Government]

/** Why a polity's form of government became what it is (History.governments.cause). */
export const GovernmentCause = {
  Founded: 0, // the form it was founded with (a new state's first row)
  Charter: 1, // a town bought its liberties from its overlord (EventType.CharterBought): a free city
  Rising: 2, // the burghers rose against their lord and won (EventType.CommuneProclaimed, extra 0)
  Free: 3, // a stateless trading town constituted itself (CommuneProclaimed, extra 1)
  Freed: 4, // a free city stopped paying its due to its overlord (CommuneProclaimed, extra 2; its Charter bond ends Freed)
  Council: 5, // the great houses abolished an extinct or fallen throne, or a league shrank to its head town (CommuneProclaimed, extra 3)
  Restored: 6, // a signoria's lords were driven out and the republic restored (CommuneProclaimed, extra 4)
  Strongman: 7, // a war captain or a demagogue made himself lord of a republic (EventType.SignoriaSeized, extra 0 / 2)
  Family: 8, // the leading merchant family made itself master of a republic (SignoriaSeized, extra 1)
  Crowned: 9, // a signoria's lords took a crown, or a confederation's khans became kings (EventType.GovernmentChanged)
  Clergy: 10, // the clergy of a holy city took its rule (EventType.TheocracyProclaimed)
  Secularised: 11, // the clergy lost the rule (the holy city's faith gone or the city of another faith now) (GovernmentChanged)
  Settled: 12, // a confederation of herders settled into a kingdom (GovernmentChanged)
} as const
export type GovernmentCause = (typeof GovernmentCause)[keyof typeof GovernmentCause]
```

Additions to existing enums. Append only, so every existing value keeps its meaning:
```ts
PolityOrigin:
  Charter: 7, // a town (and its villages) that bought its liberties from its overlord: a free city, bound to it by a Charter bond
  CityState: 8, // a single city (and its villages) that made itself a state: it rose against its lord, a stateless trading town governed itself, or a holy city's clergy took it (see History.governments)
BondKind:
  Charter: 3, // `a` is a free city chartered by its overlord `b`: it governs itself, pays a yearly due, owes no levy and never fights `b`; it is Freed when it stops paying, Absorbed when `b` revokes the charter
RevoltCause:
  Burghers: 5, // the burghers of a rich trading town rose for their liberties (governments)
```

### 3.2 Events: 200–209 (190–199 are taken by oaths)
```ts
  // governments: charters, communes, signorie and theocracies (200-209; none when HistoryOptions.governments is false).
  CharterBought: 200, // the town `settlement` bought its liberties from the polity ruled from `other` and is now the free city `value` (a new polity, origin Charter, bound to it by a Charter bond); `extra` the price paid (wealth)
  CommuneProclaimed: 201, // `settlement` became the capital of a republic: `value` is the polity id (a new one for a rising or a stateless town, else its own); `other` the capital of the lord it rose against or stopped paying (-1 otherwise); `extra` how: 0 a rising won, 1 a free town constituted itself, 2 a free city stopped paying its due, 3 the council abolished the throne (or a league shrank to its head town), 4 the lords driven out and the republic restored
  SignoriaSeized: 202, // a strongman made himself lord of the republic ruled from `settlement`: `value` the polity id; `other` -1; `extra` how: 0 a war captain (condottiere; e.g. Francesco Sforza took Milan in 1450: Britannica "Condottiere"), 1 the leading merchant family, 2 a demagogue in a time of strife. The new lord's RulerAcceded (AccessionHow.Usurped) follows
  TheocracyProclaimed: 203, // the clergy of faith `extra` (History.faiths) took the rule of its holy city `settlement`: `value` the polity id (a new one when the city broke away or was stateless); `other` the capital of the realm it broke from, or -1
  GovernmentChanged: 204, // the polity `value` ruled from `settlement` took the form of government `extra` (Government) for a cause that has no event of its own (GovernmentCause Crowned, Secularised or Settled: History.governments says which); `other` -1
  CharterRevoked: 205, // the polity ruled from `other` revoked the liberties of the free city `settlement` (its polity `value` ends Absorbed; the Charter bond ends Absorbed)
```
A crushed burghers' rising uses the existing Revolt (`value` RevoltCause.Burghers) and RevoltCrushed events.

### 3.3 History tables
```ts
/**
 * governments: the form of government of every polity over time, struct-of-arrays in order of change (a polity's founding
 * row first: every polity has one when the system is on). The form of polity p at year y is that of the last of its rows
 * with year <= y (governmentIds[governmentOffsets[p] .. governmentOffsets[p + 1]), in year order). A change and the
 * founding in one year: the later row wins.
 */
export interface Governments {
  count: number
  polity: Int16Array
  year: Int16Array
  /** Government. */
  form: Uint8Array
  /** GovernmentCause. */
  cause: Uint8Array
  /** The reign (History.rulers) that began with the change (a new elected head or lord), -1 if none (rulers off, or the head stayed). */
  ruler: Int32Array
  /** The settlement whose story it is (the capital, the town that rose or bought its charter). */
  settlement: Int32Array
}
// in History:
  // governments: (all empty when HistoryOptions.governments or polities is false).
  /** Forms of government over time (see Governments). */
  governments: Governments
  /** The rows of each polity: those of polity p are governmentIds[governmentOffsets[p] .. governmentOffsets[p + 1]). */
  governmentOffsets: Uint32Array
  governmentIds: Int32Array
```
Doc changes:
- `Ruler.dynasty`: "Ruling house, -1 for an elected head: a league's, a republic's or free city's (for a term), or a
  theocracy's (for life)".
- `ReignEnd.TermEnded`: "an elected head's term ran out (a league, republic or free city)".
- `AccessionHow.Elected`: add "…, a league's, republic's, free city's or theocracy's head".
- `PolityOrigin.League`'s UI note stays as it is.

### 3.4 Options
```ts
  /**
   * governments: forms of government (History.governments): monarchies, merchant republics, free cities under a nominal overlord,
   * signorie, theocracies, tribal confederations and leagues, with the transitions wealth and force drive (charters bought,
   * burghers' risings, strongmen) and their effects on war, trade, succession and unrest (needs polities; rulers optional).
   * Default true; false gives the history without them (History.governments empty, every other field as before).
   */
  governments?: boolean
```
During steps 1–8 keep the default at `GOV_ON = false` and flip it in step 9.

---

## 4. Simulation

### 4.1 Module layout (`src/sim/history/government/`)
- `params.ts`: `CITY` (transition parameters) and `GOV` (behaviour tables, indexed by Government).
- `state.ts`: `GovState` and `createGovernment(s)`. It is a single object literal (see the V8 note in
  `createPolityState`), stored as `s.gov: GovState | null` on HistoryState next to `rul` and `rel`.
- `econ.ts`: **the adapter** for wealth, force and need (section 9). Finances and families plug in here, and so do the
  proxies.
- `system.ts`: `govNewPolity`, `govStep` (every POLITY.step), `govSlow` (every slowStep), `setForm`, `cityState`, the
  charter rules, signoria, theocracy and confederation.
- `hooks.ts`: small O(1) readers the polity, war, policy and goods code imports (`govOf`, `govLocal`, `govMassMul`,
  `govReachMul`, `govWarMul`, `govUnrestMul`, `govUrge`, `govAbsorbable`, `govElected`). Keeping them in their own file
  avoids import cycles, as `goods/hooks.ts` does.
- `assemble.ts`: `assembleGovernments(G, P)` and `emptyGovernmentHistory()`.
- `government.test.ts` and `governmentStats.ts` (the harness).

```ts
/** governments: state of the government system (per polity, grown with the polities; the change rows in order). */
export interface GovState {
  rng: Rng                 // createRng(seed, 'history-government')
  pcap: number
  /** Form of each polity now, and the year it took it. */
  form: Uint8Array
  since: Int32Array
  /** Year from which a free city's or republic's capital town has been rich (candidate bookkeeping), and the year a league fell to one member (-1). */
  lone: Int32Array
  /** Year of the last term end that opened factional strife (republics), NEVER. */
  strife: Int32Array
  /** Change rows (ragged). */
  gPolity: number[]; gYear: number[]; gForm: number[]; gCause: number[]; gRuler: number[]; gSettlement: number[]
  /** Context for the next newPolity (set around cityState): the form and cause of its first row, -1 none. */
  ctxForm: number
  ctxCause: number
  ctxSettlement: number
  diag: GovDiag            // charters, risings, risingsCrushed, freeTowns, freed, revoked, council, signorie, restored, crowned, theocracies, secularised, confederations, settled, mercWar
}
```

### 4.2 Founding form (`govNewPolity`, called in `newPolity` **just before** `rulerNewPolity`)
```
form = ctxForm >= 0                                            ? ctxForm      (cityState / charter / theocracy set it)
     : origin === League                                       ? League
     : origin ∈ {Formed, Revolt, Fragment} and herders(capital) ? Confederation
     : origin ∈ {Partition, CivilWar}                          ? form(parent) if parent form ∈ {Monarchy, Confederation, Signoria} else Monarchy
     : Monarchy
herders(c) = s.liveFrac[c] >= CITY.herdFrac (0.4, like WAR.herdFrac) && horseOf(s, c) === 1
```
This pushes a row with cause `Founded`, the given settlement and `ruler` filled in afterwards. `rulerNewPolity` runs
next and writes `gRuler` of that row through `govRulerSet(G, row, R.cur[p])`. It draws nothing from G.rng.

### 4.3 Wealth, force and need (econ.ts; full interface in 9)
For town i in polity p, with capital c:
- `m_i`: merchant capital per head, `mw[i] / pop_i`. With goods off it is `CITY.wealthHead * wealth[i] / pop_i`.
  When families feedback is on (9.3) it is the families' capital at i per head.
- `rev_i = WEALTH.decay * (wealth[i] + mw[i])`. This is the town's money income. Finances (9.2) replaces it with the
  town's taxable revenue.
- `crownRev_p = WEALTH.decay * (wealth[c] + mw[c]) + pRevSm[p]`. Finances replaces it with the treasury's revenue.
- `ρ_i = rev_i / (crownRev_p + ε)`. The merchants out-earn the crown when ρ ≥ 1.
- `trade_i = (port_i ? 1 : river_i ? CITY.river (0.6) : CITY.inland (0.15)) * smoothstep(CITY.thLow 1500, CITY.thHigh 6000, through_i)`.
  Port is `s.port[i] >= 0`; river is `world.flow[cell] >= RIVER_FLOW_THRESHOLD`. The through thresholds come from the
  measured p50 of 3.8k–5.8k [M].
- `merc(m) = 1 + CITY.merc (1.2) * m / (m + CITY.mercHalf (20))`. This is mercenaries: at m = 20 the town fields 1.6
  times its levy.
- `F_i = localOf(s, ps, i) * merc(m_i)`. This is the town's force.
- `S_i = projAt(ps, p, dist_i) * (inCrisis ? 1 - UNREST.crisisSupport : 1) * afford_p`. This is the crown's suppression.
  `afford_p` is 1 without finances; with finances it is `clamp(treasury_p / (CITY.suppressCost * F_i), 0.25, 1)`, and
  0.4 while bankrupt.
- `φ_i = F_i / (S_i + ε)`.
- `need_p ∈ [0,1]`. With finances it is `fin.need(p)`. The proxy is
  `max(pWars>0 ? 0.4 + 0.6·min(1,pExh) : 0, inCrisis ? 0.6 : 0, (rulers && year − R.lost[p] ≤ 10) ? 0.5 : 0, TARIFF need term)`.
  The tariff need term measured 0 for every candidate [M], so it is kept only for completeness.
- `δ_i = max(1 − grip(dist_i, reach_p), smoothstep(0.3, 1, φ_i))`. This is how distant or weak the lord is from where
  the town stands.

### 4.4 Member towns: charter or rising (`govStep`, every POLITY.step, after `realmStep` and before `bondStep`)
Candidates are scanned in `s.living` order (ascending ids). **The gates draw nothing.**
```
gate(i): p = polity[i] >= 0, c = cap(p) != i, !outpost, !abandoned, rose[i] != year,
         form(p) ∉ {FreeCity, League}, pop_i >= CITY.minPop (2000), year - joined[i] >= CITY.settle (20),
         ρ_i >= CITY.rich0 (0.3), m_i >= CITY.mHead (3), trade_i > 0, at most one act per polity per step
ω_i = smoothstep(CITY.rich0, CITY.rich1 (1.0), ρ_i) · trade_i · smoothstep(CITY.mHead, CITY.mHead1 (20), m_i)
```
- **Rising** when `φ_i ≥ CITY.defy (0.8)`:
  `chance = POLITY.step · CITY.rise (0.006) · ω_i · (0.5 + 0.5 δ_i) · (1 + need_p)`. One draw u decides whether it
  happens.
  - If it happens: `logEvent(Revolt, i, c, RevoltCause.Burghers)`. The town wins with probability
    `F_i² / (F_i² + S_i²)` (a second draw).
  - **Win:** `cityState(i, p, Republic, Rising)`, then `CommuneProclaimed(i, c, q, 0)`. The relation gets
    `relR = RELATION.secedeR` and a truce of `RELATION.truceSecede`.
  - **Loss:** use the crushed branch of `revolt()`: `pop *= 1−crushPop`, `wealth *= 1−crushWealth`,
    `unrest = crushAfter`. In addition `mw[i] *= 1 − CITY.crushMerch (0.4)`; the merchants flee or are fined. Log
    `RevoltCrushed(i, c, 1)` and `pExh[p] += crushExhaust`.
- **Charter** when `φ_i < CITY.defy`, `need_p > 0` and `tier(p) ≥ Kingdom`:
  `chance = POLITY.step · CITY.charter (0.01) · ω_i · need_p · (0.5 + 0.5 δ_i)`. One draw.
  - If it happens: `price = CITY.price (0.25) · (wealth[i] + mw[i])`. The merchants pay first (`merchantPay`); with
    finances the price goes to `fin.credit(p, price)`, otherwise to `wealth[c]`.
  - Then `cityState(i, p, FreeCity, Charter)`, `subject`-like `newBond(Charter, q, p)`, and
    `CharterBought(i, c, q, price)`. The relation gets `relR = min(relR, 0.2)`.
  - A chiefdom grants no charters: its towns can only rise.
- Otherwise nothing happens: the town is too weak to defy and the crown has no need to sell.

`cityState(i, p, form, cause)`:
1. Gather the **contado**: graph neighbours j of i that are members of p, not the capital, with
   `pop_j ≤ CITY.contado (0.3) · pop_i`, `pop_j < TOWN_POPULATION`, and `cost(i,j) < dist_j` (nearer the city than
   its capital). Take them in id order.
2. Set every one of them stateless, set `ctxForm/ctxCause/ctxSettlement`, then
   `q = newPolity(s, ps, i, origin, p)`. The origin is Charter for a FreeCity and CityState otherwise.
3. `setPolity` the contado into q, add `foundAsab` to cohesion, set unrest to 0, and run `controlOne` on q and on p.

### 4.5 Free cities (in `bondStep`, a Charter branch placed before the vassal branch; draws from G.rng)
For a Charter bond k, with city a and overlord b, `d = distAcross(b,a)`, `proj = projAt(b,d)` and
`F_a = localOf(cap a) · merc(m_cap)`:
- **Due:** in `tributeFlows`, the Charter kind moves `CITY.due (0.08) · WEALTH.decay · wealth[cap a]` of wealth and no
  food. With finances it goes into the overlord's treasury revenue. `pRevYear[b]` counts it, as today.
- **Stops paying:** if `proj < CITY.freeRebel (1.0) · F_a`, or `need_b ≥ 0.5` with chance `POLITY.step · CITY.stopPay
  (0.01)`, the bond ends with `endBond(k, Freed)`. Then `setForm(a, Republic, Freed)` and `CommuneProclaimed(cap a,
  cap b, a, 2)`, with `relR[a,b] = max(relR, CITY.freedR 0.6)`. The grudges plan records this as BondThrownOff.
  `endBond` logs the existing `BecameVassal extra 1` only for a Freed bond, so **skip that log for Charter bonds**, or
  the chronicle says it twice.
- **Revoked:** if `year − bStart ≥ CITY.revokeYears (60)`, `proj ≥ CITY.revoke (4) · F_a`, `pWars[b] === 0`,
  `need_b === 0`, and a draw against `POLITY.step · CITY.revokeChance (0.004)` succeeds, then log
  `CharterRevoked(cap a, cap b, a)` and absorb as `absorbVassal` does (members to b, bond Absorbed,
  `PolityEnded Absorbed`).
- `subject()` passes a free city on to its overlord's new overlord unchanged, as an imperial city passes with the crown.
  `bound()` keeps them at peace and duty-free with no change.

### 4.6 Stateless free towns and league remnants (`govSlow`, every slowStep, right after `leagues()`)
- Free town: a stateless, non-outpost i with `pop_i ≥ CITY.freePop (1500)`, `trade_i ≥ 0.3`, and `m_i ≥ CITY.mHead`
  or `through_i ≥ CITY.thHigh`.
  `chance = CITY.free (0.06) · trade_i · smoothstep(1500, 4000, pop_i) · (1 + ps.danger[i] / LEAGUE.danger)`. One draw.
  If it happens: `cityState(i, −1, Republic, Free)`. Its contado is stateless neighbours under the same size rule.
  Log `CommuneProclaimed(i, −1, q, 1)`. This catches the low-grain ports that `formation()` can never take: 27 of 28
  stateless towns on seed 7 at year 2000 have grain < 0.4 [M].
- League remnant: a League with `pMembers === 1` for `LEAGUE.calmYears` years (tracked in `lone`) becomes
  `setForm(Republic, Council)` and logs `CommuneProclaimed(cap, −1, p, 3)`. The head stays and no ruler changes.

### 4.7 Successions: council, restore, theocracy by the clergy (rulers hooks)
In `succession()`, before choosing an heir, when `s.gov !== null`, call `govAtSuccession(s, ps, G, R, p, cause)`. If it
returns true, the throne is settled and `succession` returns.

- **Council** (Monarchy, or Confederation never): `pMembers ≤ CITY.councilMembers (8)`, `trade_c ≥ 0.6` and
  `m_c ≥ CITY.councilHead (10)`. It applies to an extinct house, an overthrow, a deposition, or a minor heir.
  `chance = CITY.council (0.35) · smoothstep(10, 40, m_c)`, drawn from G.rng. If it happens: `abolishThrone(p)` (9.1),
  `setForm(Republic, Council)` and `CommuneProclaimed(c, −1, p, 3)`.
- **Restore** (Signoria): when the house is extinct or overthrown, with chance `CITY.restore (0.4)`: `abolishThrone`,
  `setForm(Republic, Restored)` and `CommuneProclaimed(c, −1, p, 4)`.
- **Clergy** (Monarchy): when c is the holy city of a living universal faith f with `rel.org[f] ≥ CITY.theoOrg (0.5)`,
  `polityFaith(p) === f` and `pMembers ≤ CITY.theoMembers (6)`, with chance `CITY.theoCrown (0.3)`:
  `abolishThrone(p, life = true)`, `setForm(Theocracy, Clergy)` and `TheocracyProclaimed(c, −1, p, f)`.
- **Confederation**: the law is read as Elective, `electOther` is replaced by `CITY.confedOther (0.35)`, and the
  contested chance gets `+ GOV.contest[Confederation] (0.12)`. Implement this as two lookups in `succession()` guarded
  by `s.gov`.

### 4.8 Republics: strife and signoria (`govStep`, polities in `ps.alive` order, one draw per Republic)
- **Strife:** the elected-head term-end hook in `rulerYear` (9.1) calls `govTermEnded(p)`. With chance
  `CITY.faction (0.08) · (1 + [pWars>0] + min(1,pExh))`, a crisis opens: `pCrisisUntil = year + U(crisisMin,
  crisisMax)` and `SuccessionCrisis(c, −1, p)` is logged. Without rulers, `realmStep`'s old timer applies with
  `crisisBase · GOV.crisis[form]`.
- **Signoria:**
  `chance = POLITY.step · CITY.signoria (0.0012) · (1 + CITY.sigWar (2)·[pWars>0] + CITY.sigCrisis (3)·[crisis] + CITY.sigLost (2)·[lost a war ≤ 10y] + CITY.sigFamily (4)·famTop_c)`.
  `famTop_c` is the top family's influence at the capital; it is 0 unless families feedback is on (9.3). If it happens,
  the cause is decided by a second draw weighted by the three terms: war gives Strongman with extra 0, family gives
  Family with extra 1, crisis gives Strongman with extra 2. Then `seizeSignoria(p)` (9.1), `setForm(Signoria, cause)`
  and `SignoriaSeized(c, −1, p, extra)`.
  Calibration: at base about 0.12% a year, and about 0.4% a year at war or in crisis, roughly 25–40% of republics fall
  within 300 years [A: design default, not a historical rate; for comparison most north-Italian republics had a signore by 1300 (Wikipedia "Italian city-states")].
- **Crowned:** a Signoria with the same house for `≥ CITY.crownYears (80)` years and (`tier ≥ Kingdom` or
  `pMembers ≥ 6`) becomes `setForm(Monarchy, Crowned)` with chance `POLITY.step · CITY.crown (0.01)`, and
  `GovernmentChanged(c, −1, p, Monarchy)` is logged.

### 4.9 Theocracy (`govSlow`, faiths in id order)
For each living universal faith f with holy city h, `rel.org[f] ≥ CITY.theoOrg` and `pop_h ≥ CITY.theoPop (1500)`:
- If h is stateless: with chance `CITY.theoFree (0.05)`, `cityState(h, −1, Theocracy, Clergy)` and
  `TheocracyProclaimed(h, −1, q, f)`.
- If h is a non-capital member of p, and p's faith is not f or (`φ_h ≥ CITY.defy` with pilgrims counted:
  `F_h` uses `merc(m_h + pilgrims[f] / pop_h)`): with chance `CITY.theoSecede (0.03) · (p's faith ≠ f ? 1.5 : 1)`, it
  secedes peacefully if p's ruler is of faith f, otherwise with the rising fight of 4.4. The result is
  `cityState(h, p, Theocracy, Clergy)` and `TheocracyProclaimed(h, cap p, q, f)`.
- **Secularised:** when a Theocracy's capital no longer has f as its majority (`majorityOf`), or f has ended, apply
  `setForm(Monarchy, Secularised)`, `newHouseAccede(Founded)` (9.1) and `GovernmentChanged(c, −1, p, Monarchy)`.
- With religion off, there are no theocracies.

### 4.10 Confederation settling (`govSlow`)
A Confederation that has been `tier ≥ Kingdom` with mean member grainShare `≥ POLITY.formGrain` for `CITY.settleYears
(100)` years becomes `setForm(Monarchy, Settled)` with chance `CITY.settle2 (0.3)` per slow step, and logs
`GovernmentChanged`. The ruler stays; the law is no longer forced.

### 4.11 Behaviour modifiers (`GOV`, arrays indexed by Government)
All values are [A] tuning guesses. Every hook is a no-op when `s.gov === null`.

| key | hook site | Mon | Rep | Free | Sig | Theo | Conf | League | meaning |
|---|---|---|---|---|---|---|---|---|---|
| `war` | `war.ts declarations` mul | 1 | 0.5 | 0.3 | 0.9 | 0.7 | 1.3 | 0.5 | appetite for conquest |
| `tradeWar` | declarations: `· (1 + tradeWar · compete_pq)` | 0 | 1.5 | 0.5 | 1 | 0 | 0 | 1 | wars against trade rivals |
| `tradeRival` | `relations.ts` `dR += step · CITY.tradeRival (0.03) · max(tradeRival_p, tradeRival_q) · compete_pq` | 0 | 1 | 0.5 | 0.8 | 0 | 0 | 1 | Venice against Genoa (trade wars, e.g. Chioggia 1378–81: Wikipedia "War of Chioggia") |
| `embargo` | `policy.ts` embargoOn and off `·` min of the two sides | 1 | 0.8 | 1 | 0.9 | 1 | 1 | 0.8 | quicker to embargo |
| `tariff` | `policy.ts` target `· tariff` | 1 | 0.8 | 0.8 | 1 | 1 | 0.7 | 0.6 | open entrepôts |
| `merc` | `control.ts` mass `· (1 + merc · (merc(m_c) − 1))`; `localOf` of the capital | 0 | 1 | 1 | 1 | 0 | 0 | 1 | money hires armies |
| `reach` | `control.ts` `pReach ·=` | 1 | 0.7 | 0.6 | 0.8 | 0.8 | 1.1 | 1 | a small contado, not provinces |
| `unrest` | `unrest.ts grievance ·` | 1 | 1.1 | 1 | 1.15 | 0.85 | 1.2 | 0.9 | subjects of a republic are not citizens; tyranny; faith binds |
| `urge` | `goods/routes.ts:189` urge `·` | 1 | 1.5 | 1.3 | 1.3 | 1 | 0.8 | 1.5 | lanes and posts instead of provinces |
| `absorb` | `formation.ts absorption` / `bonds.ts overawe` skip when 0 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | a city does not bow whole: it must be conquered |
| `contest` | `succession` contested `+` | 0 | 0 | 0 | 0.05 | 0 | 0.12 | 0 | |
| `crisis` | rulers-off timer `·` | 1 | 0.6 | 0.6 | 1.2 | 0.5 | 1.3 | 0.6 | |
| `holy` | `religion holyDrive ·` | 1 | 1 | 1 | 1 | 1.5 | 1 | 1 | |
| `tribute` | `bonds.ts peaceTerms`: 1 means a winning attacker takes Tribute (trading privileges), never Vassalage | 0 | 1 | 1 | 0 | 0 | 0 | 1 | |

`compete_pq = min(T_p,T_q) / max(T_p,T_q) · smoothstep(1000, 10000, min(T_p,T_q))`, where `T_x` is the sum of `through`
over x's port members. It is computed once per step per polity into `G.trade` (O(N)).

Mercenaries cost money: each step a polity with `merc > 0` at war pays `CITY.mercPay (0.02) · (mult − 1) · (wealth[c]
+ mw[c])`, merchants first (`merchantPay`); with finances it is a treasury expense. A republic stops hiring when the
capital's W is below `CITY.mercFloor`; mult is then 1. This is what stops rich cities from snowballing.

`localOf` hook: `x *= govLocal(...)`, which is the merc multiplier only when `id` is the capital of a polity with
`GOV.merc > 0`. It is an O(1) lookup.

---

## 5. Rulers integration (reuse the league-head machinery)

### 5.1 New and changed functions in `rulers/system.ts`
- `electHead(s, ps, R, p, life = false)`. `life` is used for theocracies: the born year is `year − U(45, 70)` and
  `rDeath = deathYear(R, born, year, u)`. Otherwise the term is `U(termMin, termMax)` as today. Export it.
- `rulerNewPolity`: `if (origin === League || (s.gov !== null && govElected(s.gov, p)))` → `electHead(…, life =
  form === Theocracy)`.
- `rulerYear`, branch `rDyn[r] < 0`: the end cause is `form === Theocracy ? Natural : TermEnded`, then re-elect. Call
  `govTermEnded` (strife) for Republic and FreeCity. Also honour `R.kill` (a sack kills the head) with cause Sack, then
  re-elect.
- `abolishThrone(s, ps, R, p, life = false)`: `endReign(Deposed)`, `R.hN[p] = 0`, `checkHouse(dyn)`, `electHead`.
  Returns the new reign for `gRuler`.
- `seizeSignoria(s, ps, R, p)`: `endReign(Deposed)` of the elected head, then `newHouseAccede(Usurped)`. With
  families feedback on and the Family cause, the house is tied to the family (9.3). Returns the reign.
- Marriage and unions: change `marriage.ts:128`'s `origin !== League` to `!(s.gov ? govElected(s.gov, p) : origin ===
  League)`. `marriageStep` already needs houses.
- Rulers off: forms still change, `gRuler = −1`, and the elected-head rules apply only through `realmStep`'s timer.

### 5.2 Tests to relax
`rulers.test.ts:117` becomes: dynasty < 0 implies the polity's form at the accession is League, Republic, FreeCity or
Theocracy (via `h.governments`), or the origin is League when governments are off.

---

## 6. Determinism and the off switch

- One new stream: `createRng(seed, 'history-government')`, created only when the system is on. It is used by govStep
  (candidate acts and rising outcomes, then republics in alive order), bondStep's Charter branch, govSlow (free towns
  in living order, then faiths in id order, then confederations in alive order) and `govAtSuccession`.
- **The gates never draw.** There is exactly one draw per gated candidate per step, plus one for each rising's outcome
  and one for the signoria cause.
- Consequences call rulers functions that draw from `R.rng` (elected heads and usurpers), and polity functions that
  draw from `ps.rng` (`newPolity` draws `pNextSucc`). That is fine: with the system on, the history is allowed to
  differ.
- **Off** (`options.governments === false`, or polities off): `s.gov = null`. Every hook is `s.gov !== null ? … :
  old`, `GOV`'s Monarchy column is all neutral, no G.rng exists, and `History.governments` has `count 0` with empty
  offsets. Every other field must be bit-identical to 8cabf09 (`hashBaseFields` with the GOLDEN list).
- Neutral multipliers must be *skipped*, not multiplied by 1. `x * 1` is bitwise x in IEEE arithmetic, but code such as
  `smoothstep · 1` must never be routed through a different expression order.
- Prefix stability: rows are appended in year order and polity ids never change, so a longer run repeats a shorter
  one. Test it the way rulers do.
- Resumed runs (`advanceTo`) need `assembleGovernments` to copy the ragged arrays.
- Within politySystem, govStep runs after `realmStep`, before `bondStep`, so a new Charter bond is first checked at the
  next step. govSlow runs after `leagues()`, before `accretion()`, so a new republic can take stateless villages in the
  same slow step. The order is fixed and documented in the file comment of `polity/system.ts`.

---

## 7. UI

### 7.1 Data (`ui/politiesData.ts`, plus a new `ui/governmentsData.ts`)
- `governmentAt(pd, p, year)` is the last row of p with year ≤ y, via the offsets. Return Monarchy, or League for a
  league, when the table is empty, so old histories read as before.
- `tierWord(pd, p, tier, year)`: the government overrides the tier word. **Callers must pass the year.** Today
  `tierWord` takes a tier only, so update the three call sites (`politiesPanel.ts:503`, `polityTitle`, `sagas/world.ts:232`).

| form | city-sized (members ≤ 3, or tier Chiefdom) | larger |
|---|---|---|
| Republic | Republic of X | Republic of X |
| FreeCity | Free City of X | Free City of X |
| Signoria | Lordship of X | Duchy of X |
| Theocracy | Holy City of X | Theocracy of X |
| Confederation | Confederation of X | Confederation of X (Empire tier: "X Horde" was considered; keep "Confederation") |
| League | League of X | League of X |
| Monarchy | tier word (today) | tier word |

- Naming (`src/sim/names/polityNames.ts`): add `city: boolean` to `PolityLike`. It is true for origin Charter or
  CityState. For such a polity, the name is the **capital settlement's own name** at founding (from `names[capital]`,
  the root name, not a renaming), when it is not already used and not near another polity name. Otherwise fall back to
  the usual draw from `names-polity-<id>`. This is unchanged for all other polities, and with governments off no such
  polity exists, so names are bit-identical. A council conversion keeps the old name ("Republic of Vashtar").
- Ruler titles (`rulersData.ts rulerWord`), by form at the year: Republic "Consul", FreeCity "Burgomaster" [design choice; titles not sourced], Signoria
  "Lord"/"Lady" (Duchy: "Duke"/"Duchess"), Theocracy "High Priest"/"High Priestess", Confederation "Khan"/"Khatun",
  League "Elected head" (as today).
- `rulersFormat.ts:146`: "X is elected Consul of the Republic of Genva" and "the clergy raise X as High Priest of
  Sanktar".

### 7.2 Factions panel and view (`ui/politiesPanel.ts`, `polities.css`, `render/polities.ts`)
- List row: a small form badge after the name (`span.fp-gov.republic|free|signoria|theocracy|confed|league`). Monarchy
  has no badge. The tooltip is "Merchant republic since 1420". Free cities are listed under their overlord like
  tributaries, tagged "free city", and are **counted** in the sphere subtotal. `politiesData.ts:751` sends non-Vassal
  bonds to `tributaries`; add a `chartered` list.
- Detail section, a "Government" block:
  - "Merchant republic since 1420: rose against the Kingdom of Vashtar (1420). Ruled by a council; Consul Aranu,
    elected 1688 for 7 years."
  - With families: "Council: House Medra, House Corvi, House Tash" (`councilAt`, 9.3).
  - A free city: "Free city under the Kingdom of Vashtar since 1388 (charter bought for its liberties); pays a yearly
    due."
  - The form history as a compact timeline: "Monarchy 900–1420 · Republic 1420–1610 · Lordship 1610–".
- Bond lines (`politiesPanel.ts:726,759,961,1256`): kind Charter reads "Free city under" / "Chartered the free city of".
  **Today any non-Vassal bond falls into the "tribute" wording, so these need explicit cases.**
- Map (`render/polities.ts`): the capital mark (`Mark.Capital`, gold star, line ~991) gets a colour by form (gold
  monarchy, silver republic and free city, bronze signoria, violet theocracy, copper confederation, pale blue league)
  through `capitals.col`. A free city's land is drawn like a tributary's (own colour, thin stripes of the overlord's):
  `relData kind` 2, so add `B.kind === Charter ? 2` explicitly at line ~1038. Optional: a "colour by government" toggle
  on the Factions view, with one palette entry per form written into the existing per-polity colour texture.
- Inspector (settlement): "Capital of the Republic of Genva (a merchant republic since 1420)", or "A free city under
  the Kingdom of Vashtar since 1388".

### 7.3 Chronicle (`ui/polityFormat.ts`)
Add `PolityEvent.CharterBought … CharterRevoked` (200–205) and an `isGovernmentEventType` range, and give them their
own chronicle filter group, "Councils and crowns".

| event | chronicle line | inspector line (self / other) |
|---|---|---|
| CharterBought | "Lubeka buys a charter of liberties from the Kingdom of Vashtar and governs itself as a free city" | "Bought its liberties from the Kingdom of Vashtar: a free city" / "Sold Lubeka a charter of liberties" |
| Revolt (Burghers) | "The burghers of Genva rise for their liberties against the Kingdom of Vashtar" | (existing pattern) |
| CommuneProclaimed 0 | "Genva throws off the Kingdom of Vashtar and proclaims itself a republic" | "Rose against Vashtar and proclaimed a republic" |
| CommuneProclaimed 1 | "The merchants of Novra govern themselves: the Republic of Novra" | "Its merchants made it a republic" |
| CommuneProclaimed 2 | "The free city of Lubeka stops paying its due to Vashtar: the Republic of Lubeka" | |
| CommuneProclaimed 3 | "The great houses of Vashtar abolish the throne: the Republic of Vashtar" (league: "What is left of the League of Hansa governs itself as the Republic of Hansa") | |
| CommuneProclaimed 4 | "Florenza drives out its lords and restores the republic" | |
| SignoriaSeized 0/1/2 | "Arnu, captain of Genva's hired armies, makes himself its lord" / "House Medra makes itself master of Florenza" / "Amid strife Tavo seizes Florenza and rules it as its lord" | |
| TheocracyProclaimed | "The priests of the Ashai faith take the rule of Sanktar" | |
| GovernmentChanged | Crowned: "The lords of Genva take a crown: the Duchy of Genva becomes the Kingdom of Genva"; Settled: "The khans of Orda rule as kings now"; Secularised: "Sanktar's priests lose the rule of the city" | |
| CharterRevoked | "The Kingdom of Vashtar revokes the liberties of Lubeka" | "Its liberties were revoked by Vashtar" |

For the head's name, read the RulerAcceded event of the same year; the rulers hooks supply the title.

### 7.4 Sagas (`ui/sagas/state.ts`, `world.ts`, `city.ts`): phrase tables in both registers
Add `originKey` cases `charter` and `cityState`. Add a section `hGovernment`: `[['Council and Crown'], ['Who Held the Rod']]`.
```ts
  charter: [['In {year} the merchants of {cap} paid the crown of {parent} for a charter, and the town governed itself from then on, owing only a yearly due.'],
            ['In {year} the moneyed men of {cap} weighed out silver before the throne of {parent}, and bought with it the right to rule themselves.']],
  cityState: [['In {year} {cap} made itself a state: {how}.'],                          // how: "its burghers rose against {parent} and won" / "its merchants chose to govern themselves"
              ['In {year} the bells of {cap} rang and its guilds swore on the market cross that no lord would rule them again.']],
  theocracy: [['In {year} the priests of the {faith} faith took the rule of {cap}, their holy city.'],
              ['At {cap} the servants of the {faith} god took up the sceptre; the city was the god\'s, and its priests ruled in the god\'s name.']],
  signoria: [['In {year} {lord} made himself lord of {state}, and the council ruled at his word.'],
             ['The captain of the hired swords came home from the war and did not lay down his sword; the council bowed, and {cap} had a lord.']],
  restored: [['In {year} {cap} drove out its lords and restored the republic.'], ['In {year} {cap} broke its master\'s chair in the square, and the council sat again.']],
  freed: [['In {year} {cap} stopped paying its due to {parent} and stood alone as a republic.'], ['In {year} {cap} sent back the tax-collectors of {parent} with empty hands.']],
  revoked: [['In {year} {parent} revoked the liberties of {cap}.'], ['{parent} remembered what it had sold, and in {year} took it back with spears.']],
  council: [['When the throne fell vacant in {year}, the great houses of {cap} set no one on it and ruled as a council.'],
            ['In {year} the throne of {cap} stood empty, and the merchant princes would not fill it.']],
  consuls: [['It was ruled by {n} elected heads in turn.'], ['{n} heads it chose, and {n} it sent home when their years were done.']],
```
- World saga: "the first republic" line, as for `firstKingdom` (`world.ts:232`): "The first city to govern itself was
  {city}, in {year}" / "{city} was the first to say no lord would rule it".
- City saga: if the city was ever a city-state capital, add one line from these tables.

---

## 8. Ordered commit-sized steps

1. **Contract and off switch.** Add the 3.1–3.4 enums, events, `Governments`, `History.governments`/offsets/ids,
   `HistoryOptions.governments` (default `GOV_ON = false`), `HistoryState.gov = null`, and empty assembly.
   - Files: `contract.ts`, `history/state.ts`, `history/index.ts`, `government/{params,state,assemble}.ts`.
   - Tests: `government.test.ts` checks that off equals the 8cabf09 golden (`hashBaseFields`) and that the new fields
     are empty. Add cases for 200–205 to the `history.test.ts:228` switch. Add `governments: false` to the GOLDEN calls
     in `rulers.test.ts:225`, `polity.test.ts:267` and `goods.test.ts:294`, with the "later, off here too" comment.
2. **Founding forms and the table.**
   - Files: `govNewPolity` hook in `polity/state.ts newPolity` (before the rulers hook), `setForm`,
     `assembleGovernments`, a League row for leagues, Confederation for herders.
   - Tests: every polity has a first row with `year === foundedYear`; rows are sorted per polity; offsets are
     consistent; leagues read as League; the run is prefix-stable and equals a resumed run.
3. **Rulers integration.**
   - Files: `electHead(life)`, `abolishThrone`, `seizeSignoria`, the `rulerNewPolity`/`rulerYear` branches, marriage
     exclusion, `govAtSuccession` hook (it returns false for now). Relax `rulers.test.ts:117`.
   - Tests: elected heads only under elected forms; every gRuler is a reign of that polity acceded in that year.
4. **Charters and risings.**
   - Files: `econ.ts` (proxies), the `govStep` scan, `cityState` with contado, `BondKind.Charter` in `newBond`,
     `tributeFlows` due, the `bondStep` Charter branch (freed and revoked; suppress the duplicate BecameVassal log),
     `absorption`/`overawe` skips, `RevoltCause.Burghers`, events 200, 201(0,2) and 205.
   - Tests: every CharterBought matches a Charter bond with `a === value` starting that year; every FreeCity interval
     has an active Charter bond; Freed bonds coincide with CommuneProclaimed extra 2; city-state origins are only
     Charter or CityState; contado members ≤ 0.3 of the capital's pop at founding.
5. **Free towns, councils, signorie.**
   - Files: `govSlow` free towns and league remnant; `govAtSuccession` council and restore; strife; signoria; crowned;
     events 201(1,3,4), 202 and 204.
   - Tests: SignoriaSeized is followed in the same year by RulerAcceded(Usurped) of that polity; a form is never
     changed twice in one year except the founding row.
6. **Theocracy and confederation.**
   - Files: `govSlow` religion branch (guarded by `s.rel`), secularised, confederation succession overrides, settled,
     event 203.
   - Tests: a theocracy's capital is the holy city of the faith in `extra`; with religion off there are no
     theocracies.
7. **Behaviour modifiers.**
   - Files: the GOV table hooks in `control.ts`, `state.ts localOf`, `war.ts`, `relations.ts`, `policy.ts`, `bonds.ts
     peaceTerms`, `unrest.ts`, `goods/routes.ts`, `religion/system.ts`, plus the mercenary pay.
   - Test: the off hash is unchanged.
8. **Stats harness and tuning.**
   - Files: `government/governmentStats.ts` (run as `node --experimental-strip-types
     src/sim/history/government/governmentStats.ts [seeds]`; Node 22.23 works with the flag, which I verified with the
     probes), plus `--no-ab` and on/off A/B as in `polityStats.ts`. Tune `CITY` to the targets below.
9. **Turn it on by default** (`GOV_ON = true`).
   - Update the golden hashes of default-option tests (grep `toBe('` hashes in `*.test.ts`). Re-run `polityStats`
     A/B and the perf bench.
10. **UI data and words.** `governmentAt`, `tierWord(…, year)` call sites, `polityNames` city naming, `rulerWord`
    titles, the `rulersFormat` elected lines.
11. **UI panel, map, chronicle, sagas** (7.2–7.4), with a chronicle filter group.
12. **Sibling hookups**, when each lands: finances (9.2) replaces the proxies in `econ.ts`; families (9.3) supplies the
    council, `famTop` and `Ruler.family`.

### Stats harness: what `governmentStats.ts` reports and targets per seed (1, 7, 42, 1234; 2000 years)

| measure | target |
|---|---|
| city-states founded (forms Rep/Free/Sig, origin Charter or CityState, or council conversions) | 4–15 per seed, ≥ 3 on every seed |
| of which charters / risings / stateless free towns / council | charters ≥ 1 on ≥ 3 seeds; risings ≥ 1 on ≥ 3 seeds; free towns ≤ 60% of the total; council ≤ 30% |
| city-states alive at 1500 / 2000 | 1–6 / 2–8 per seed; ≤ 25% of alive polities |
| capitals: port / port or river / inland | ≥ 65% / ≥ 90% / ≤ 10% (inland is naturally rare, [M]) |
| median city-state lifetime | ≥ 150 years; ≥ 20% end by conquest or revocation (they must be mortal) |
| republics that last ≥ 100 years and fall to a signoria within 300 years | 20–50% |
| restorations | some, ≤ signorie |
| theocracies | 0–3 per seed, ≥ 1 across the four seeds (needs a universal faith with an org'd church) |
| confederations | ≥ 1 on seeds with herder states; settled ≥ 1 across seeds |
| wars declared by republics against a trade rival (`compete > 0.3`) | ≥ 50% of their wars |
| settlements taken per war: republic attacker / monarchy attacker | ≤ 0.6 |
| republic and free-city marts' lane expeditions per mart-century / monarchy marts' | ≥ 1.3 |
| people in city-states at 2000 | 2–10% of the world |
| A/B against off (`polityStats`): polity count, wars per century, largest-state share, revolts | within ±15% |
| off-run hash | identical to 8cabf09 |

---

## 9. Interfaces

### 9.1 Rulers (in-repo, this plan adds them)
```ts
export function electHead(s, ps, R, p, life?: boolean): number            // reign id
export function abolishThrone(s, ps, R, p, life?: boolean): number        // ends the reign Deposed, ends the house if it holds no throne, elects; reign id
export function seizeSignoria(s, ps, R, p, family?: number): number        // elected head Deposed; a new house Usurped (tied to `family` when given); reign id
// called by rulers:
export function govElected(G, p): boolean                                  // Republic, FreeCity, Theocracy, League
export function govTermEnded(s, ps, G, p): void                            // strife
export function govAtSuccession(s, ps, G, R, p, cause): boolean            // council / restore / clergy took the throne
export function govRulerSet(G, row: number, r: number): void
```

### 9.2 What this plan needs from `state-finances.md`
All of these are read in `government/econ.ts`. When finances is off or absent, each falls back to the proxy given.

| need | finances function (proposed) | proxy without finances |
|---|---|---|
| crown need 0..1 ("overlord indebted / bankrupt") | `finNeed(s, p): number` (e.g. `smoothstep(debt/revenue)` plus 1 while in default or a recent default) | `max(war, crisis, lost war, tariff need)` (4.3) |
| crown in default | `finDefaulted(s, p): boolean` (in default, or within N years of one) | false |
| crown revenue a year | `finRevenue(s, p): number` | `WEALTH.decay · W_cap + pRevSm[p]` |
| town's taxable revenue a year ("town's revenue vs crown's") | `finTownRevenue(s, id): number` (customs, market dues and merchant income at id) | `WEALTH.decay · (wealth[id] + mw[id])` |
| can afford to suppress | `finTreasury(s, p): number` and `finSpend(s, p, amount): boolean`: govStep calls `finSpend(p, CITY.suppressCost · F_i)` when a rising starts; a crown that cannot pay suppresses at `afford = 0.4` | `afford = 1` |
| charter price received | `finCredit(s, p, amount, kind: 'charter')` | `s.wealth[cap] += price` |
| charter due received a year | `finCredit(s, p, amount, kind: 'due')` (in `tributeFlows`) | wealth to the capital |
| mercenary pay | `finSpend(s, q, amount)` for republics (a city treasury) | `merchantPay` at the capital |

Finances should treat Charter bonds like tribute in its revenue accounting, and treat a FreeCity as a polity with its
own treasury. A default of a crown that has free cities raises their chance to stop paying (`need_b ≥ 0.5` in 4.5).
That holds with no further coupling.

### 9.3 Families (`merchant-families.md` section 8.2), used and amended
Used:
- `topFamilies(s, town, k, out)` is the **republic's council**: the top `CITY.council_k (5)` families at the capital.
  It is read by the UI (`councilAt(h, town, year, k)` from seat snapshots) and, with feedback, by the sim.
- `familyInfluence(s, f, town)` gives `famTop_c`, the influence of the top family at a republic's capital. It feeds
  the **Family** signoria term (4.8).
- `familyCapitalAt(s, town) / pop_town` replaces `m_i` as merchant capital per head **only with feedback**. Without
  feedback the pool `mw` is the same money (families only divide it), so the result is identical either way.
- Events: a wave of FamilyFell (ruin) at a republic's capital, two or more within 20 years, opens strife (a crisis):
  feedback only.

Amendments I propose to their 8.2:
1. **Feedback gating.** The Family signoria cause and the families-driven strife change sim outcomes, so they run only
   when `FAMILY.feedback && s.gov !== null`. With feedback off, `famTop_c = 0` and families stay a pure layer. The
   city-states run is then identical with families on or off. That is a test in both plans.
2. **Elected head from the top family: a pure label.** `electHead` sets `R.rFam[r] = topFamilyAt(s, capital)` (−1 if
   none, or families off). It reads only, so it is **not feedback**. Families runs at the end of the year, so this is
   last year's state, which is deterministic. In the contract: `Ruler.family?: number` ("the merchant family the
   elected head came from (History.families), -1"). At assembly the head's surname comes from the family name, and the
   personal name stays the rulers' draw. This applies to leagues, republics and free cities, but not theocracies. The
   families plan offered the same for leagues; extend it to these forms.
3. **The Family signoria makes the house the family.** `seizeSignoria(p, family)` creates the dynasty with
   `Dynasty.family?: number`, and at assembly the house name is the family name ("House Medra"), not a new draw. The
   families side needs `familyNameOf(f)` at assembly, or one name table shared between the two. That keeps house names
   unique: **families names must avoid dynasty names, and a family-born dynasty takes the family's name**. Ask families
   to export `familyName(h, f)`.
4. **One event for the UI.** When a republic's head or lord comes from a family, the families plan does not need its
   own event: `RulerAcceded` plus `Ruler.family` suffice.

### 9.4 Grudges and oaths
A Charter bond ending **Freed** should record `GrievanceKind.BondThrownOff`, the same as a vassal's. A rising that wins
is already a Seceded-like wrong, so the grudges plan's scan of `CommuneProclaimed extra 0, 2` (and `CharterRevoked`
the other way) should add it. No API is needed; these events carry the polities.

---

## 10. Performance estimate

- **govStep** is O(living) every 5 years with cheap gates (pop ≥ 2000 first). Only tens of towns pass [M: 2–58 member
  towns ≥ 2000 at a time]. Each costs `localOf` and `projAt`, which are O(1). Republics' signoria checks are O(alive).
- **compete** (trade-rival term) is O(N) per step for `T_x` plus O(relations).
- **govSlow** is O(living) for free towns plus O(faiths) plus O(alive).
- **Hooks**: `localOf` gets one null check and one array read (it is hot in accretion and submission tests, but O(1)).
  `controlOf` gets one multiply per polity. declarations, policy and relations get one lookup per pair.
- **Total**: estimated < 0.5% of a 2000-year run (< 100 ms of 14–22 s) [A]. Check with
  `perf-scripts/bench-sim.ts` before and after step 9.
- **Memory**: per-polity typed arrays of about 4 × pcap; Governments rows ≈ polities + changes (about 100–250 rows ×
  13 bytes). The History grows by a few KB.

---

## 11. Risks, open questions, verified vs assumed

### Verified [V]
- No rule today creates a single-town polity (1.4).
- Leagues have elected heads on terms through `electHead` and `rDyn < 0` (1.3).
- `rulers.test.ts:117` must change.
- Every non-Vassal bond falls into the "tribute" wording in the UI.
- `bound()` and `newBond` set `pSub` for any non-Alliance kind, so a Charter bond is at peace and duty-free for free.
- `endBond(Freed)` logs BecameVassal extra 1.
- `history.test.ts` switches over EventTypes.
- Grudges uses 190–199; families uses 161–169.

### Measured [M]
- Single-member polities: 1–5 ever per seed.
- Every candidate town is on water, and nearly every one is a mart.
- The tariff-need proxy is 0.
- The candidate pool is 11–32 distinct towns per seed, and stateless low-grain ports number up to 27 on seed 7.

### Assumed [A]
- All `CITY` and `GOV` numbers.
- The mercenary scale `m/(m+20)`.
- The 0.5% performance estimate.
- That one-town polities behave in every subsystem. Claims, renaming, landmarks, the panel and sagas have seen 1–5 per
  seed so far, not 5–15. Run the full test suite at step 4 with the charter chance raised tenfold as a stress test.

### Risks
- **City-states too strong.** The mercenary multiplier, the absorption exclusion and the walls could make them immortal
  or let them snowball into empires. Mitigations: reach 0.7, war 0.5, the mercenary pay and floor, revocation, and the
  lifetime and conquest targets.
- **Too many free towns on seed 7** (28 stateless towns of 1500 or more at year 2000). Guard with the 60% cap target
  and `trade ≥ 0.3`, and if needed require `m_i ≥ mHead` (not `through` alone).
- **Weak crown need without finances.** Need comes only from war, crisis and lost wars, about 25% of candidate samples
  [M]. Charters may then cluster in wartime. That is historically fine, but tune `CITY.charter`.
- **Free cities and rulers.** Each free city re-elects a head every 3–12 years, which adds many reigns and RulerAcceded
  events (chronicle noise). `rulersFormat` already groups chiefdom successions; group elected terms the same way.
- **`tierWord` signature change.** Three call sites need the year.
- **Contado taking villages.** The parent loses taxpayers, which shifts its mass slightly. That is intended.

### Open questions
1. Should a free city also be able to **join a league** (Lübeck in the Hansa: a free imperial city from 1226 and the league's leading town; Wikipedia "Lübeck", Britannica "Hanseatic League")? This would need leagues as a bond
   between polities, not a polity. It is left out here; a natural follow-up would be `BondKind.League` among
   republics.
2. Should a republic's **conquered towns** be a separate status (subject towns, "Terraferma": Venice's mainland domain, from 1337; Wikipedia "Domini di Terraferma") with their own
   grievance? This plan uses the `GOV.unrest` multiplier as a stand-in.
3. Theocracy titles for very large realms: "Theocracy of X" or a faith-derived name? This is a UI choice.
4. Should the Confederation form apply to existing herder polities via the founding rule only (as here), or also to
   unions of chiefdoms formed by absorption?
5. Rulers off but governments on: elected forms have no reigns, and strife then uses the old `realmStep` timer with
   `GOV.crisis`. Is that acceptable, or should governments require rulers?

## Addendum (central registry)
`RevoltCause.Burghers` is **6**, not 5 (5 is `Taxes` from state-finances; 7 is `Urban` from society-secular-cycles). See _CONVENTIONS.md "Enum value registry".

## References
Citation audit 2026-11-26 (per `_CONVENTIONS.md` "Citation rule"). [verified] = a page confirming the citation was opened; [unverified] = not confirmed, reason given.
**Design defaults:** every `CITY.*`, `LEAGUE.*` and `GOV.*` number, the mercenary curve `m/(m+20)`, the calibration "25–40% of republics fall within 300 years",
and every stats-harness target are design defaults, not historical rates. The historical items below are illustrations of the forms, not calibration.
Place and house names in the chronicle lines (Genva, Lubeka, Novra, Florenza, House Medra, Hansa) are fictional echoes of Genoa, Lübeck, Novgorod,
Florence, the Medici and the Hanse; no claim about those is made beyond what is cited here.

- Jones, P. (1997). *The Italian City-State: From Commune to Signoria*. Oxford: Clarendon Press / Oxford University Press. https://doi.org/10.1093/oso/9780198225850.001.0001 [verified: bibliographic data]
- Encyclopaedia Britannica, "Signoria". https://www.britannica.com/topic/signoria [verified: government by a signore that replaced republican institutions, mid-13th to early 16th c.; power often grew out of a communal office such as Captain of the People and became hereditary; Milan (Visconti), Verona (Della Scala) and others by the early 14th c.]
- Wikipedia, "Italian city-states". https://en.wikipedia.org/wiki/Italian_city-states [verified: "By 1300, most of these republics had become princely states dominated by a signore"]
- Encyclopaedia Britannica, "Condottiere". https://www.britannica.com/topic/condottiere [verified: mercenary captains, mid-14th to 16th c.; Francesco Sforza "won control of Milan in 1450"]
- Wikipedia, "Contado". https://en.wikipedia.org/wiki/Contado [verified: "the countryside surrounding, and controlled by, the city state"]
- Wikipedia, "War of Chioggia". https://en.wikipedia.org/wiki/War_of_Chioggia [verified: Venice against Genoa, 1378-1381, Treaty of Turin 8 Aug 1381; a trade rivalry that "had generated a number of wars"]
- Encyclopaedia Britannica, "Hanseatic League". https://www.britannica.com/topic/Hanseatic-League [verified: Lübeck the leading town, the diet generally met at Lübeck; Kontor at Novgorod]
- Wikipedia, "Lübeck". https://en.wikipedia.org/wiki/L%C3%BCbeck [verified: imperial immediacy granted by Frederick II in 1226]
- Wikipedia, "Free imperial city". https://en.wikipedia.org/wiki/Free_imperial_city [verified: some cities "purchased one [a charter] from a prince in need of funds"; others by gift or force]
- Wikipedia, "Domini di Terraferma". https://en.wikipedia.org/wiki/Domini_di_Terraferma [verified: Venice's mainland hinterland; Mestre taken 1337, Treviso 1339]
- Wikipedia, "House of Medici". https://en.wikipedia.org/wiki/House_of_Medici [verified: the historical pattern behind "House Medra" and "Florenza restores the republic": Cosimo's de facto rule from 1434, expulsions 1494 and 1527, returns 1512 and 1530, hereditary Duke of Florence 1532 (1531 in the page's own table), Grand Duchy 1569]
- Ruler titles "Consul" (Republic) and "Burgomaster" (FreeCity) [unverified: chosen as design; no source opened for communal consuls or the burgomaster office]

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **R10.** With `s.up !== null`, the burghers' rising draw (4.4) is kept, so G.rng stays aligned, but it no longer resolves. A hit adds a Commune trigger at the town (riots resolves through `govRisingResolve`). The charter branch is unchanged. Your gate, riots and court's estates rising share one `rose[i] = year` gate.
- **R11.** For Monarchy and Signoria with court on, court's `REGIME` values replace `GOV` on every key both define (unrest/grief, reach, contest, overthrow). Without court, GOV applies.
- **The GOV table is the single Government-indexed table.** MIR adds columns 7–11 and FP adds 12–29. GOV.war is factor 2 of C1, GOV.unrest is the form multiplier of C2, and GOV.reach is factor 1 of C4 (MASTER-PLAN §2.3).
- **R38.** Event block 200–209 is yours: 200–205 used, 206–209 spare.
