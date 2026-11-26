# Plan: State finances and credit (treasuries, loans, default, bankruptcy)

Status: PLAN ONLY. Written against the read-only checkout `/home/claude/ryanmye/worldseed` at commit 8cabf09.
Marks: **[V]** read in that tree (file:function named). **[M]** measured on the scratch copy `/home/claude/scratch-finance`
(probe scripts `probe-finance.ts` and `probe-shadow.ts` at its root, Node 22.23, full 2000-year default runs, about 32 s a
seed). **[A]** assumed, or a design decision not yet checked against code.
**(rev 2)** adds money and prices (quantity theory (Fisher 1911; Pigou 1917), price-revolution diffusion, fixed nominal claims, wage lag; 2.6), Gresham's law (2.7),
the state fiscal distress index `finSFD` for society-secular-cycles.md (2.8), the patronage amendment from that plan (2.4.2), and a
decision on Hotelling (Hotelling 1931; 2.9, rejected). New probe `probe-money.ts` in `/home/claude/scratch-finance` (args: seed years lag diff sdRef kappa piMax).
Rev-2 changes are marked "(rev 2)" in place.

Sibling plans (read them; this plan adopts or amends their interfaces, see section 0):
- `/home/claude/plans/merchant-families.md` (written): families own shares of the per-town merchant pools. Its section 8.1
  proposes that finances owns the loan table and families supply capacity. **Adopted** below, with names unchanged.
- `/home/claude/plans/grudges-and-oaths.md` (written): grievances between polities. **It claims EventTypes 190-199.**
  City-states claims 200-209 (its 3.2; CharterBought 200 … CharterRevoked 205). So finances uses **210-219**
  (checked: no EventType in contract.ts at 8cabf09 is 182 or above).
- `/home/claude/plans/city-states.md` (written): its section 9.2 asks finances for need, default flag, revenues, treasury, spend
  and credit, each with a proxy fallback. **Adopted with its names** in 0.3.

---

## 0. Interfaces (one consistent contract for the implementer)

### 0.1 Event id ranges
| range | owner |
|---|---|
| 160 | MerchantsMoved (exists) |
| 161-169 | merchant families (merchant-families.md 2.7) |
| 190-199 | oaths (grudges-and-oaths.md 3.2) |
| 200-209 | city-states (city-states.md 3.2) |
| **210-219** | **finance (this plan; 210-218 used, 219 spare; 218 PricesRose added in rev 2)** |

Enum registry (rev 2, from `_CONVENTIONS.md`): `RevoltCause.Taxes = 5` is this plan's (city-states renumbers Burghers to 6, society takes Urban 7);
`GrievanceKind.CrownDefault = 7` is this plan's.

### 0.2 Lenders: adopting merchant-families 8.1
Finances owns the loan table (`History.loans`). A lender is a pair (`LenderKind`, id):
- `LenderKind.Pool = 0`: the merchant pool of a town (`MerchantState.mw[town]`, goods/merchants.ts). `lender` is the
  settlement id. This is merchant-families' "lender -1" case: their -1 means "no family, the town pool". The table
  stores Pool plus the town, so the seat is never lost. **Default case: it works today, before families land.**
- `LenderKind.Family = 1`: a merchant family (`lender` = family id, History.families). Used only when families are on
  and `FAMILY.feedback` is true (merchant-families 8.1: lending moves money out of `mw`, so it is feedback).
- `LenderKind.Town = 2`: fallback when goods is off (no `mw`): a member town's own `s.wealth`, at a lower cap.

Finances calls only these functions from merchant-families' `families/api.ts`, with their names and meanings unchanged:
```ts
familyLendCapacity(s, f, p): number        // capital family f can lend to p now (lendShare and exposure netting are theirs)
lendersFor(s, p, out: Int32Array): number  // families able to lend to p, by capacity desc, ties by id
familyLend(s, f, p, amount): number        // money leaves f's seats' pools; returns the amount actually lent
familyRepaid(s, f, amount): void           // interest and principal back, to f's home seat
familyAbsorbDefault(s, f, p, amount): void // written off; their ruin check logs FamilyFell (ruin Default, other = p's capital)
```
Amendment, explicit: merchant-families 8.1 says "the default sizes (`lendShare` etc.) belong to finances". Finances
applies its own cap `FIN.lendCap` only to **Pool** and **Town** lenders. For families it trusts
`familyLendCapacity` as the cap, and families read `FIN.lendCap` as their `lendShare`, so there is one parameter.
Finances also exposes `finOwedTo(fin, LenderKind.Family, f): number` and `finOpenLoansOf(fin, kind, id, out)`. Families'
`fLoan`/`fLoanP` mirror these when finances is on (their 8.1, second bullet).

Finances wraps the three kinds behind one internal module, `finance/lenders.ts`:
```ts
interface LenderOffer { kind: number; id: number; seat: number; assets: number; expo: number; foreign: 0 | 1 }
lenderCandidates(s, fin, p, out: LenderOffer[]): void // fixed order: domestic first, then assets desc, then (kind, id) asc
lenderGive(s, fin, o: LenderOffer, x): number         // Pool: mw[id] -= x; Family: familyLend; Town: s.wealth[id] -= x
lenderTake(s, fin, kind, id, x): void                 // Pool: mw[id] += x; Family: familyRepaid; Town: s.wealth[id] += x
lenderLose(s, fin, kind, id, p, x): number            // bookkeeping; returns the loss as a share of the lender's assets. Family: familyAbsorbDefault
lenderSeat(s, kind, id): number; lenderAlive(s, kind, id): boolean
```
Ruin events: **Pool** lenders log `HousesRuined` (217). **Family** lenders do not: the families system logs `FamilyFell`
or nothing, and finances does not log 217 for them. This avoids saying the same thing twice.

### 0.3 For city-states: adopting city-states.md 9.2 (names unchanged)
These live in `finance/hooks.ts`. city-states' `government/econ.ts` calls them only when `s.fin !== null`, and otherwise uses its own proxies.
They take `s`, as that plan writes them:
```ts
/** Crown need 0..1: smoothstep(FIN.needDebtLow 0.5, FIN.needDebtHigh 4, debt / R°) + 0.4·[unpaid ≥ 1] + 0.3·[pWars > 0], plus 0.5 while finDefaulted, clamped to 1. 0 for an unmonetised realm (R° < minRev) unless at war (then the city-states proxy's war term, 0.4 + 0.6·min(1, pExh)). */
finNeed(s, p): number
/** In arrears (unpaid ≥ 1), or a CrownDefault or Repudiation within FIN.defaultedYears (20). */
finDefaulted(s, p): boolean
/** R, the crown's coin revenue a year now (pRevSm + taxSm + mineSm; charter dues included, see below). */
finRevenue(s, p): number
/** A town's taxable revenue a year: the duties collected at it (the collector's share booked via crownRev is per polity, so this is the proxy
 *  WEALTH.decay·wealth[id] + MERCHANT.pay·mw[id] plus the wealth tax it paid this year, fin.paidTax[id]: a per-settlement Float64 that taxSystem fills when finance is on). */
finTownRevenue(s, id): number
/** Coin in p's treasury (may be negative: arrears). */
finTreasury(s, p): number
/** p pays `amount` now if it can: from the treasury, else by borrowing at once (the 2.4.5 rule for this amount); true if paid. Booked as spending (kind 'suppress' / 'mercenary' in diag). */
finSpend(s, p, amount): boolean
/** Coin received by p: kind 'charter' (a price, one-off) or 'due' (a free city's yearly due, booked from tributeFlows like tribute). Goes to coinYear[p]. */
finCredit(s, p, amount, kind: 'charter' | 'due'): void
```
Amendments, explicit:
- **Charter bonds** (city-states' `BondKind.Charter: 3`) count like tribute in finance's accounting. The due is paid from the free city's treasury to the overlord's
  `coinNext` through `finCredit(..., 'due')`. A FreeCity is a polity with its own treasury (it already is one, by id), so no special case is needed.
- A charter price may be paid partly **by cancelling crown debt owed to the town's lenders**. Finances adds `finCharterOffset(s, p, town, price): number`:
  it closes or reduces p's accounts seated at `town` (LoanEnd.Charter) and returns the remainder. City-states then passes that remainder to `finCredit`.
  This is optional for city-states: without it, the whole price goes to finCredit.
- Extra queries finances also offers: `crownOwedAt(s, p, town)` (principal p owes lenders seated at the town) and `setRateMul(s, p, m)`
  (a government's credit multiplier, e.g. a merchant republic 0.6; default 1).
- "Crown defaults raise free cities' chance to stop paying" is city-states' rule (their 4.5), read through finDefaulted.
- **(rev 2) Charter dues are fixed in coin.** City-states stores a due as nominal at the grant, `dueNom = due · finPrice(s, overlord)`,
  and each year passes the real amount `dueNom / finPrice(s, overlord) · finAccept(s, free, overlord)` to `finCredit(..., 'due')`. So dues lose
  real value under inflation and are discounted when the free city's coin is debased (2.6, 2.7). Without the change (or with `FIN.money` false)
  finPrice is 1 and finAccept 1, so nothing changes. Price levels are per polity, and a FreeCity is a polity, so it has its own.

### 0.3b (rev 2) Money queries (`finance/hooks.ts`, O(1), RNG-free; all return the neutral value when `s.fin` is null, `FIN.money` is false or goods is off)
```ts
/** Price level of p's coin (1 when its trade zone's bullion equals the desired holding; 1 neutral). Range [FIN.pMin, FIN.pMax]. */
finPrice(s, p): number
/** Real value of `nominal` coin of p now: nominal / finPrice(s, p). */
finReal(s, p, nominal): number
/** Share of face value at which polity q accepts p's coin: 1 − FIN.gDisc · max(0, coin[q] − coin[p]), at least FIN.gAcceptMin (1 for p = q). */
finAccept(s, p, q): number
/** Wage-lag index ω = wage index / price level of p (1 neutral; < 1 while wages lag rising prices), clamped [FIN.wMin, FIN.wMax]. */
finWageLag(s, p): number
/** Smoothed yearly inflation of p's price level (a year's share; negative in deflation). */
finInflation(s, p): number
```

### 0.5 (rev 2) For society-secular-cycles.md (adopting its 0.2 contract, names and meaning unchanged)
```ts
/** Fiscal distress of p's crown, >= 0, 1 = an ordinary realm in ordinary times (e.g. debt / R° over FIN.needDebtLow, plus arrears). The fiscal part only: no trust or legitimacy term (society multiplies its own asabiya term, see 2.5). */
finSFD(s, p): number
```
- Formula in 2.8. It has no trust term, as society asks. The credit stain is not used (it is the lenders' distrust, close to their asabiya
  term), so nothing is counted twice. Arrears and a recent default are counted: they are fiscal facts.
- **Unmonetised realms** (R° < FIN.minRev) and polities with `s.fin === null`: finances returns nothing meaningful from its ledger. finSFD
  then returns the **fiscal part of society's own proxy**, `1 + 0.6·min(1, pExh) + 0.5·[year − R.lost[p] ≤ 10] + 0.3·[inCrisis]`.
  Extra query **`finMonetised(s, p): boolean`** (R° ≥ minRev). When it is false, society adds its own elite term `0.4·max(0, o_p − 1)` as in its
  proxy, because the patronage amendment below only acts through a coined budget. Society's `s.fin ? finSFD : fisc_proxy` stays correct with
  `s.fin` null, since that branch is already theirs.
- **Patronage amendment, adopted** (society 0.2, h8): in 2.4.2, `court ×= clamp(FIN.patronBase + FIN.patronK · socOverprod(s, p), FIN.patronBase, FIN.patronMax)`
  = clamp(0.7 + 0.3·o_p, 0.7, 1.6), **only when `s.soc !== null`**. With society off the factor is skipped, not multiplied by 1. EMP then
  feeds SFD through finances' own arrears, borrowing and default rules. Most of it returns to the capital (home 0.8): it is patronage spent
  at court, not burned.
- Optional for society: `finWageLag(s, p)` (0.3b) is the monetary part of the real wage (wages lagging prices). Society's `socWage` is the
  Malthusian part (food per head). A society implementer may multiply `w` by it (`w · finWageLag`), clamped. This is not required, and it is off unless they choose it.

### 0.4 For grudges-and-oaths
Amendment (to be added to their `GrievanceKind`): `CrownDefault: 7`. The lender's polity holds it against the debtor, for
a default or repudiation where the lender's seat is in another living polity. Finances calls their RNG-free
`record(GrievanceKind.CrownDefault, wronged = polity of the lender's seat, offender = p, w = FIN.grudgeW * min(1, lost / R°_wronged), site = seat, war = -1)`
when `ps.oaths`. Domestic lenders (seat inside p) record nothing there. City-states reads that grievance through
`crownOwedAt` and lastDefault. If oaths is off, nothing is recorded (no rivalry fallback: keep it simple).

---

## 1. Current behaviour (with references)

### 1.1 Where money is today [V]
- **Settlement wealth** `s.wealth[id]`, in arbitrary units (a load is about a person-year of grain at worth 1).
  trade.ts `settle`: `wealth = wealth * (1 - WEALTH.decay) + income[id]`, with decay 0.02. So a town's wealth is about 50 years of
  its income. Prosperity (migration.ts `prosperity`) and `econ` read wealth a head.
- **The capital's wealth is the de facto treasury.** Nothing keeps a separate state purse. Flows into it:
  - Wealth tax (polity/system.ts `taxSystem`): each payer sends `POLITY.wealthTax(0.05) * WEALTH.decay * g * wealth`
    (0.001 g W a year) to the capital. Grain tax `POLITY.tax(0.06)` of food goes to the capital's supply (in kind), and is
    smoothed in `ps.taxIn[cap]`.
  - Duties and seizures (polity/outlaw.ts `flushAccounts`, every `ACCOUNTS = 5` years, three sites at about lines 75, 98
    and 100; goods/longhaul.ts about lines 649 and 665, as legs move): `income[c] += rev; ps.pRevYear[q] += rev`.
    `pRevYear` is smoothed into `ps.pRevSm[p]` (outlaw.ts ~l.129, `TARIFF.smooth`). It is exported as `History.tariffRevenue`
    (polity/assemble.ts `polSnapshot`).
  - Tribute and vassal share (bonds.ts `tributeFlows`, called from taxSystem): `w = share * WEALTH.decay * wealth[ca]`
    moves capital to capital and is added to `pRevYear[b]`. Food: `share` of the vassal capital's grain take.
  - Plunder (war.ts `conquer`): a sack takes `WAR.sackWealth(0.5)` of the town's wealth, and `WAR.plunder(0.5)` of that goes to
    the conqueror's capital.
  - Raids (war.ts `raids`) move `WAR.raidWealth` of wealth from town to town (not to the crown).
- **Merchant capital** (goods/merchants.ts) `g.ext.merch.mw[id]`, kept apart from town wealth. It flows in from
  long-haul profits (`merchantKeep`, `merchantTurnover`). It pays `MERCHANT.pay(0.0003)` a year into the town and wears
  away at 0.0007. It is capped at `maxHead(120) * pop`. It gathers to entrepots and flees bypassed marts. Ventures spend it
  (`merchantPay`). It is exported as `History.merchantWealth`.
- **Mines**: deposits `g.dOut[d]` (class units a year) worked by `g.dWorker[d]` (goods/state.ts). Treasure worth is
  `GOODS.value[Good.Treasure] = 50`. The crown takes no royalty today.
- **(rev 2) There is no money or price level today [V].** trade.ts prices are real: per settlement and good, `ts.price[id*G+g]`, worth ×
  scarcity (bulk: worth · 2 / (1 + stock/need); HV classes, goods/market.ts `hvPrice`: worth · (1+k) / (k + S/D), up to 6× worth). No numeraire.
  Wealth, duties and every finance flow are in real "loads". The trade "regions" of trade.ts are per-settlement catchments of the link search,
  not trade blocs.
- **(rev 2) Bullion exists physically [V].** Treasure (gold, silver, gems from deposits.ts `mineYear`) goes into `g.held[sink*G+Treasure]`. It moves
  between settlements through the HV market (`hvPair`), so Treasure flows toward where it is scarce: Hume's price-specie flow (Hume 1752), already in the model.
  It wears at `STOCK.treasureWear = 0.02` a year, which is its only consumption. It has a **desired holding**:
  `ts.demand[id*G+Treasure] = DEMAND.treasure(0.002) · pop · (treasureBase 0.2 + w/(w+half)) · court` (market.ts ~l.212). That is a
  Cambridge-equation (Pigou 1917) money demand M_d = k·P·Y in real terms (k·Y ∝ pop and wealth). A Boom (52) is logged when a silver bonanza
  (`dRich ≥ DEPOSIT.bonanza 5`, reserve `bonanzaYears 250`) passes `DEPOSIT.boom 0.25` of world Treasure output. goodsStats T13 already tests that the
  Treasure *real* price falls ≤ 0.7 within 50 years of a bonanza.
- **(rev 2) Depletion [V]**: `out = yield · rich · lab · (1 + techMul(M−1)) · sqrt(R/R0)`, with no owner and no price-responsive pacing.

### 1.2 Tariffs [V] (polity/policy.ts `tariffStep`, every POLITY.step = 5 years)
The rate moves toward `base[tier] + war + need * smoothstep(needHigh, needLow, capitalWealth / (needRef * mass)) + rivalry * maxR`,
capped at `TARIFF.max = 0.6`. So the "need" signal is already capital wealth over mass.

### 1.3 War strength, exhaustion and peace [V] (polity/war.ts header and code)
- `projAt(ps, p, d) = pMass * grip(d, reach) / (1 + multiWar * (wars - 1)) * (1 - exhaustionProj * E)` (polity/state.ts).
  `pMass` is set in control.ts (`A * Σb`, crisis, stretch, `rulerMass`).
- Declaration (every slowStep = 10 years, `declarations`): `drive = smoothstep(rLow, rHigh, R) * smoothstep(advLow, advHigh, adv) * crisisMul * (1 - E)`.
  The chance is `slowStep * WAR.declare(0.01) * drive * mul`, with `mul = rulerWar * holyDrive * ordersMul`. **One draw of `ps.rngWar` per candidate
  direction, whatever `mul` is.** So multiplying `mul` changes no draw count.
- Campaigns (yearly): battles, conquest, sack. `exhaust`: `E += perYear(0.08) + deaths(3) * dead / pop + (capital wealth < poorShare(0.02) * mass ? poor(0.1) : 0)`.
  **The `poor` term is the only money effect on war today.** At peace E decays by 0.1 a year (`warYear`).
- Peace (`campaigns`): `spent` (E ≥ 1 on either side), `tired` (≥ peaceAfter = 5 years, no gain for `winning` = 2 years, chance 0.08),
  or `peaceUrged` (orders). Then `closeWar` → `peaceTerms` (vassalage or tribute by `advantageAt`) → truce of 30 years, rivalry halved.
- Rulers (rulers/system.ts): `rulerWar = RULERS.warBase + rWar` multiplies the declaration chance. `rulerMass` scales mass with ability.
  Overthrow chance rises with exhaustion, crisis and a recent lost war (`rulerYear`). Accession how: `AccessionHow` (contract.ts:862).

### 1.4 Step order [V] (history/index.ts `step`, polity/system.ts `politySystem`)
Yearly: weather → food → goodsProduce → **trade** (market; `flushAccounts` at year % 5 == 4; settle; merchantEcon) →
**taxSystem** (wealth and grain tax, tributeFlows) → tourism provision → population → migration → voyages → abandonment →
**politySystem** [newSettlements, abandoned members, mapPass every 20 years, **campaigns**, warYear, rulerYear, then every 5 years
control, danger, cohesion, unrest, revolts, realm, bonds, coastRaids, tariffStep, and every 10 years formation …
**declarations**, raids, walls …; cellDanger; taxShares; claims] → structures → … → goodsYear (merchantYear) → … → snapshots.

### 1.5 Off switches and RNG [V]
- Each optional system is a nullable field on HistoryState (`pol`, `goods`, `rul`, `rel`, `ideas`, `orders`; state.ts ~l.154). It is set in
  index.ts `createRunner` from `options?.x ?? X.enabled`. Every hook is `if (s.x !== null)`.
- Streams come from `createRng(seed, name)` (rng.ts). Each system has its own stream (index.ts header).
- Golden-hash tests in polity.test.ts, goods.test.ts, disease, tourism, renaming, ideas, orders and cradleWish hash every History key except later
  systems' keys and event ranges (e.g. tourism.test.ts `hashPreTourism` filters keys and event types). Re-recording is documented
  in comments with a "checked bit-identical with the switch off" note.
- The sim keeps to `+ - * / sqrt floor` for cross-engine identity (index.ts header). `Math.pow` appears once, in outlaw.ts. Finance avoids it.

### 1.6 Magnitudes [M] (seed 42, default options; largest 5 polities per year)
| year | p | members | pop | mass | capital wealth | members' wealth | duties `pRevSm` | merchant capital in members |
|---|---|---|---|---|---|---|---|---|
| 1000 | 2 | 98 | 18.7k | 8.0k | 14.7k | 21.5k | 202 | 1.3k |
| 1250 | 2 | 82 | 25.2k | 23.7k | 26.9k | 42.4k | 423 | 2.8k |
| 1500 | 2 | 67 | 33.6k | 68k | 13.0k | 100k | 1931 | 5.2k |
| 1750 | 27 | 112 | 43.4k | 84.8k | 37.3k | 107k | 1201 | 231k |
| 2000 | 27 | 166 | 140k | 249k | 155k | 1.70M | 2368 | 506k |

World merchant capital: 0 before about 500, 1.5k at 1000, 140k at 1500, 4.6M at 2000. Wars, seed 42: 116, median length 7 years, p90 13.
Outcomes: WhitePeace 13, AttackerGains 38, DefenderGains 15, Conquest 22, Tribute 5, Vassalage 16, Reunified 5.
**Consequences for the design:**
1. Duties dominate coin income (wealth tax ≈ 0.001 g W is 10-20 times smaller for trading realms before 1500). So expenses must be
   scaled to revenue, not to mass, which grows about 30 times faster than revenue over the run.
2. There are no lenders before about 800, and few before 1200. Credit matters from the high middle ages on, which is historically right [plan judgment; not sourced in the citation audit].
3. Late merchant capital is about 100 years of a crown's income, so late constraints come from debt service, not lender depth.

### 1.7 Shadow-ledger calibration [M] (probe-shadow.ts: the rules of section 2 as pure accounting, no feedback)
Peace spending 0.7 R°, war cost attacker/defender in R° per year, reserve cap 8 R°, lenders = 0.5 of members' `mw`, dsMax 0.5,
rate 0.05 + 0.06 stain (+0.03 at war), default after 2 unpaid years with debt > 0.5 R°, haircut 0.5:
| warAtt / warDef | seed | wars with ≥ 1 unpaid side-year | with ≥ 2 | defaults / 2000 y | polities that borrowed |
|---|---|---|---|---|---|
| 0.6 / 0.4 | 1 | 18% | 16% | 10 | 18 / 70 |
| 0.6 / 0.4 | 42 | 32% | 27% | 8 | 17 / 85 |
| 0.9 / 0.5 | 1, 42 | 51-53% | 42-45% | 16-37 | 22-27 |
| 1.2 / 0.7 | 1, 42 | 70-83% | 62-68% | 32-42 | 27-33 |
| 1.5 / 1.0 (peace 0.8, cap 5) | 1, 7, 42, 1234 | 81-88% | – | ~500 (counted per year, bug in that run) | 32-39 |

So **warAtt 0.6, warDef 0.4, peace 0.7** is the starting point. With feedback, bankruptcy ends wars early and cuts war-years, so the
share should fall toward the 10-25% target. These are no-feedback numbers: tuning in step 6 is still needed.

### 1.8 (rev 2) Money probe [M] (`probe-money.ts`; the 2.6 rule as pure accounting on full default runs, seeds 1, 7, 42, 1234; lag 0.1, diffusion 0.05, κ 1, πmax 0.08)
| measure | 1 | 7 | 42 | 1234 |
|---|---|---|---|---|
| world bullion S / desired D at 1000 / 1500 / 2000 | 2.40 / 1.87 / 1.36 | 2.49 / 1.04 / 0.62 | 1.81 / 1.23 / 0.41 | 2.08 / 1.03 / 0.56 |
| world bullion stock at 2000 (class units) | 602 | 568 | 329 | 731 |
| polity P at 2000, q10 / q50 / q90 | 0.61 / 0.71 / 1.25 | 0.35 / 0.46 / 0.82 | 0.13 / 0.25 / 0.57 | 0.38 / 0.50 / 0.70 |
| yearly inflation q01 / q50 / q99 | −3.2% / 0.0 / +4.2% | −3.9% / −0.1% / +5.2% | −3.5% / −0.1% / +8.0% | −4.5% / 0.0 / +6.1% |
| polity-years at the [pMin, pMax] clamp | 134 / 24.8k | 2 / 19.8k | 101 / 20.8k | 46 / 20.8k |
| real value of a 50-year-old fixed claim, q05 / q50 / q95 | 0.61 / 1.00 / 1.47 | 0.65 / 1.05 / 1.59 | 0.72 / 1.07 / 1.56 | 0.62 / 1.02 / 1.51 |
| Boom | 1244 (sink stateless) | 1736: own P ×1.22 / 1.39 at +10 / +25 y; zone median ×1.06 / 1.20 | none in History (sink stateless) | 1624 (stateless sink): zone median ×1.11 / 1.31 / 1.54 / 2.26 at +10/25/50/100 y |

Readings: (1) A bonanza raises prices first near the mine and later across its trade zone (seed 7: own ×1.22 at +10 y while the zone is at ×1.06), which is
the price-revolution diffusion. Seed 1234's zone doubled over a century. For scale, Hamilton (1934) has Spanish prices ×3.5 in silver (×4.6 in vellón) from 1511-15 to 1646-50, about 0.9-1.1% a year;
European estimates run 1-1.5% a year, ×3-4 over the sixteenth century (Kugler & Bernholz, as cited in Wikipedia "Price revolution"), and Fischer (1996)
dates that wave c. 1470-1590 [corrected in the citation audit: the text had "Spain and England at about ×4 over 1500-1650, about 1-1.5% a year", which is
internally inconsistent (×4 in 150 years is 0.9% a year); no England figure was verified]. The sim gives 0.3-0.8% a year: weaker, but the same shape [M; the
monetary cause of the historical rise is contested, since population growth (Goldstone 1984) explains part of it]. (2) **Late secular deflation**: the desired holding grows with pop × wealth faster than a stock that
wears 2% a year, so world S/D falls to 0.4-0.6 by 2000 on three seeds. Without credit money this is a lasting "bullion famine". Fixed claims then
*gain* real value (q95 ≈ 1.5). Accepted for v1 (see 8). (3) The first rule version, a per-polity S/D with no rate limiter, gave max |π| of 70-470% in a year and 25-35% of
polity-years at the floor. Most polities hold no bullion of their own, so the target fell to 0. That is why the target is shrunk toward the trade zone and the change is rate-limited (2.6.2).

---

## 2. Design

### 2.1 Principle
The crown gets a **real, separate purse** (`fin.treas[p]`). The coin flows that today land in the capital's wealth (wealth tax,
duties and seizures, tribute in coin, the crown's share of plunder, new mine royalties) are booked into it instead. The crown spends it
on court, garrisons, works, war, tribute and interest. Most peacetime spending flows back into the capital's wealth (court, garrison,
builders). War spending mostly leaves (spent on campaign). So at peace with a full reserve the capital's wealth comes close to today's
(it receives income minus the share burned). Wars become costly in real wealth.
Costs are **multiples of ordinary revenue R°** (era-invariant, see 1.6). Realms then differ by reserves, credit access (lenders
exist only in commercial realms), credit record, revenue lost to war (blockades and embargoes cut duties), war intensity and size
(court overhead), not by an arbitrary unit choice. Realms with no coin (chiefdoms, grain-tax realms) have R° ≈ 0: no fiscal
constraint. Exhaustion rules them as today. "War becomes a money problem as states monetise."

### 2.2 State (`src/sim/history/finance/state.ts`)
`HistoryState.fin: FinanceState | null` (state.ts, next to `rul`; null when off; set in index.ts). FinanceState, per polity, grown
by doubling with `ps.P` (`ensureFinPolities`, like rulers' `ensureRulerPolities`):
```ts
export interface FinanceState {
  rng: Rng                // createRng(seed, 'history-finance'): repudiation, debasement only
  pcap: number
  /** Coin in the treasury (wealth units); negative = bills in arrears (unpaid soldiers, contractors). */
  treas: Float64Array
  /** Coin booked this year (wealth tax, duties, seizures, tribute in, plunder, royalties) and booked for next year (tribute from vassals processed earlier in the order). */
  coinYear: Float64Array
  coinNext: Float64Array
  /** Smoothed wealth tax and royalties a year (duties come smoothed in ps.pRevSm). */
  taxSm: Float64Array
  mineSm: Float64Array
  /** R: revenue a year now (pRevSm + taxSm + mineSm); R°: ordinary revenue, the same smoothed over years at peace only (frozen at war). */
  rev: Float64Array
  revOrd: Float64Array
  /** Spending a year, smoothed (UI), and this year's parts (diag). */
  spendSm: Float64Array
  /** Principal outstanding (sum of the open accounts) and interest due this year. */
  debt: Float64Array
  /** Credit record: a stain that defaults raise and the years wash out; the rate it last borrowed at, or would. */
  stain: Float64Array
  rate: Float64Array
  /** Consecutive years in arrears; year of the last default or repudiation (NEVER); last debasement year. */
  unpaid: Int32Array
  lastDefault: Int32Array
  lastDebase: Int32Array
  /** Tax pressure (multiplies the wealth tax, 1..FIN.taxMax), silver content of the coin (1 sound), credit multiplier set by government (city-states). */
  taxMul: Float64Array
  coin: Float64Array
  rateMul: Float64Array
  /** A ruler acceded since the last fiscal year: AccessionHow + 1, 0 none (rulers hook). */
  acc: Int8Array
  // --- (rev 2) Money and prices (2.6-2.8); all stay at their neutral values when FIN.money is false or goods is off ---
  /** Price level of p's coin (1 neutral); last year's (for the erosion factor); the level at the last land-tax assessment and its year. */
  pl: Float64Array
  plPrev: Float64Array
  plAssess: Float64Array
  assessYear: Int32Array
  /** Wage index (follows pl more slowly); smoothed inflation, a year's share; smoothed deficit (spending + interest − coin income) / R° (SFD). */
  wage: Float64Array
  piSm: Float64Array
  defSm: Float64Array
  /** Gresham offset: bullion units of good coin that left p (< 0) or arrived from debasing partners (> 0); it decays as the market re-balances. */
  gx: Float64Array
  /** Tribute fixed in coin: nominal yearly tribute p owes its overlord (in p's coin), set at the bond's start or renewal; 0 none. */
  tribNom: Float64Array
  /** Wealth-tax real yield factor clamp(plAssess / pl, aMin, aMax), computed in fiscalYear, read by taxSystem the next year. */
  assessR: Float64Array
  /** Scratch, grown with s.count: union-find parents of the trade zones (open routes), and per-zone bullion and desired holding. */
  zPar: Int32Array; zB: Float64Array; zD: Float64Array
  /** Scratch per polity: bullion, desired holding, partner trade weight, weighted partner silver price, weighted partner coin. */
  mB: Float64Array; mD: Float64Array; mW: Float64Array; mWP: Float64Array; mWC: Float64Array
  /** P at the last PricesRose check (every FIN.riseStep years) per polity, and the year of the last PricesRose. */
  plRef: Float64Array; lastRise: Int32Array
  // --- Loan accounts (one per borrower and lender, opened at its first loan; JS arrays, prefix-stable) ---
  lPol: number[]; lKind: number[]; lId: number[]; lSeat: number[]
  lStart: number[]; lEnd: number[]; lCause: number[]
  lPrin: number[]; lRate: number[]; lRate0: number[]; lRateMax: number[]; lPeak: number[]; lPaid: number[]; lLost: number[]
  /** Open accounts per polity (ascending ids), and the open account of (polity, kind, id) by key (lookup only, never iterated). */
  open: number[][]
  acct: Map<number, number>
  /** Pool and Town lenders' crown exposure per settlement, and the wealth tax each settlement paid this year (finTownRevenue); both grown with s.count. */
  expo: Float64Array
  paidTax: Float64Array
  // --- Snapshots (ragged per polity as polity/assemble.ts tar/rev; per account per trade snapshot) ---
  snTreas: Float32Array; snDebt: Float32Array; snRev: Float32Array; snSpend: Float32Array; snRate: Uint8Array; snCoin: Uint8Array
  snOff: number[]; snN: number[]; snUsed: number
  lbSnap: Float32Array; lbOff: number[]; lbN: number[]; lbUsed: number
  diag: FinanceDiag
}
```
The acct Map key is `p * 2^24 + kind * 2^22 + id` (ids < 4M) [A: check the settlement or family id bounds; else use two Maps].
**PolityState addition** (one only): `pPay: Float64Array` (grown in `ensurePolities`, set to 1 in `newPolity`). It is the army's pay
factor, read in `projAt`. It stays 1 with finance off, and `x * 1 === x` in IEEE, so the run stays bit-identical.

### 2.3 Params (`src/sim/history/finance/params.ts`, `export const FIN`, doc comment per line in the codebase style)
| name | default | meaning |
|---|---|---|
| enabled | false → true at step 12 | HistoryOptions.finance default |
| minRev | 5 | below this R° a realm is unmonetised: no war-cost, drive or bankruptcy effects |
| revSmooth | 0.1 | EMA rate of taxSm, mineSm, revOrd, spendSm a year |
| court, courtRef, courtMin, courtMax | 0.3, 20, 0.6, 1.6 | court = court · R° · clamp(sqrt(members / courtRef), min, max) |
| garrison, rivalArmy | 0.25, 0.6 | garrison = garrison · R° · (1 + rivalArmy · min(1, max rivalry with a bordering polity)) |
| ring, fortW | 0.03, 0.02 | works = R° · (ring · Σ rings·pop / pPop + fortW · forts) |
| warAtt, warDef, siege, civil | 0.6, 0.4, 0.3, 1 | war cost per active war in R° a year (attacker / defender; +siege while it besieges; civil wars × civil) |
| home, warHome | 0.8, 0.3 | share of peace spending and of war spending that returns to the capital's wealth (the rest is consumed) |
| reserveCap | 8 | treasury above reserveCap · R° is spent into the capital (splendour) |
| chest | 1 | at war, borrow to keep chest · this year's war cost in hand |
| cushion, minLoan | 0.25, 0.2 | in arrears borrow the shortfall + cushion · spending; skip loans below minLoan · R° |
| dsMax, warlikeDs | 0.5, 0.3 | credit limit: rate · debt ≤ dsMax · R° · (1 + warlikeDs · (rWar - 0.5)) |
| lendCap | 0.5 | a Pool lender lends at most this share of its assets (mw + exposure); also families' lendShare |
| townCap, townMin | 0.1, 2000 | Town lenders (goods off): share of wealth; minimum wealth |
| rBase, rStain, rLoad, loadFree, rWar, rCoin, rAble, rForeign, rMin, rMax | 0.05, 0.06, 0.01, 2, 0.03, 0.10, 0.03, 0.015, 0.02, 0.40 | rate (2.4.4) |
| refuse | 0.30 | no lender lends at or above this rate |
| repayAbove, repay | 2, 0.5 | at peace with treasury > repayAbove · R°, repay this share of the excess, dearest account first |
| dsBreak, arrearYears | 0.75, 2 | default when interest due > dsBreak · R°, or arrears for arrearYears with debt |
| dsAfter, hMin, defaultGap | 0.25, 0.3, 10 | haircut leaves interest at dsAfter · R°, at least hMin; no second default within defaultGap years |
| stainDefault, stainRepudiate, stainKeep | 2, 3, 0.983 | stain += stainDefault · h; repudiation += stainRepudiate; × stainKeep a year (half-life ≈ 40 years) |
| repudiate, repudiateMin | 0.25, 1.5 | after a usurpation, conquest accession or new house: chance repudiate · (0.5 + rWar) when debt > repudiateMin · R° |
| ruinShare | 0.25 | HousesRuined when a Pool lender loses ≥ this share of its assets |
| grudgeW | 1 | grievance weight scale (0.4) |
| unpaidProj, unpaidFull, unpaidExh, mutinyYears | 0.3, 2, 0.25, 3 | unpaid army: proj × (1 - unpaidProj · min(1, unpaid / unpaidFull)); E += unpaidExh · min(unpaid, 3); war ends at mutinyYears |
| fundLow, fundHigh, declFloor, chestYears, chestMul, afterDefault, afterYears | 0.5, 4, 0.35, 6, 1.2, 0.5, 20 | declaration drive (2.4.6) |
| peaceDebt | 0.5 | tired-peace chance × (1 + peaceDebt · min(2, the more indebted side's debt / R°)) |
| unpaidOverthrow | 0.5 | overthrow chance × (1 + this · min(unpaid, 3)) |
| taxUp, taxMax, taxRate, taxGrief | 0.6, 1.6, 0.2, 0.25 | tax pressure (2.4.8) |
| needLow, needHigh | 0.5, 3 | tariff need reads treasury in years of R° (replaces capital wealth / mass when on) |
| needDebtLow, needDebtHigh, defaultedYears | 0.5, 4, 20 | finNeed and finDefaulted (0.3, city-states) |
| royalty | 0.2 | crown share of the worth of Treasure mined by members (the "royal fifth") |
| plunderCrown | 0.6 | share of the conqueror's plunder that goes to the treasury (the rest to the capital as today) |
| debase | false | debasement switch (optional hook, step 8) |
| debaseChance, debaseStep, coinMin, debaseGap, seign, seignMerch, seignKeep, coinGrief, reformCost | 0.3, 0.15, 0.4, 10, 0.5, 0.3, 0.7, 0.2, 1 | 2.4.9 |
| **(rev 2)** patronBase, patronK, patronMax | 0.7, 0.3, 1.6 | court × clamp(patronBase + patronK · socOverprod, patronBase, patronMax), only with society on (0.5) |
| **(rev 2)** money | false → true at step 12 | the money layer (2.6-2.7); false: pl ≡ 1, ω ≡ 1, accept ≡ 1, no erosion |
| **(rev 2)** sdRef, sdMin, kappa | 1, 0.1, 1 | P* = zone-shrunk S/D / sdRef; a zone with S/D < sdMin is unmonetised (P holds); κ: weight of the zone against the polity's own bullion |
| **(rev 2)** pLag, pDiff, pDiffHalf, piMax, pMin, pMax | 0.1, 0.05, 50, 0.08, 0.1, 10 | P moves pLag of the gap a year, plus diffusion pDiff·W/(W+pDiffHalf) toward partners; at most ±piMax a year; clamp |
| **(rev 2)** piSmooth, rInfl | 0.1, 0.5 | EMA of inflation; lenders add rInfl · max(0, piSm) to the rate (a partial Fisher premium; Fisher 1930) |
| **(rev 2)** wageLag, wShare, wMin, wMax, wageGrief, priceGrief | 0.03, 0.6, 0.6, 1.5, 0.3, 2 | wages follow P at wageLag a year; wShare of garrison + war cost is pay; ω clamp; grievance terms |
| **(rev 2)** reassessYears, reassessLow, aMin, aMax | 60, 0.7, 0.3, 2 | land tax is re-assessed every reassessYears, or early when assessR < reassessLow under tax pressure (2.6.3); clamp of assessR |
| **(rev 2)** tribRenew | 50 | tribute fixed in coin is renegotiated after this many years (or at a new bond) |
| **(rev 2)** gOut, gMax, gDecay, gDisc, gAcceptMin, rGresham | 0.05, 0.5, 0.1, 0.8, 0.5, 0.06 | Gresham (2.7) |
| **(rev 2)** sfdLoad, sfdDef, sfdArr, sfdDefault, sfdReserve, sfdMin, sfdMax, sfdSmooth | 0.25, 1, 0.3, 0.5, 0.3, 0.5, 6, 0.05 | finSFD (2.8) |
| **(rev 2)** riseStep, riseRatio, riseGap | 25, 1.4, 100 | PricesRose: P / P 25 years ago ≥ riseRatio, at most once per riseGap years per polity |

### 2.4 Rules (as formulas)
All per polity, in `ps.alive` order (ascending ids). One fiscal year runs per year.

**2.4.1 Income (booked where the flow happens; with finance on, the money goes to the treasury, not the capital's `income`/wealth)**
- Wealth tax (taxSystem): `w = wealthTax · decay · g · wealth[id] · taxMul[p]`; with fin, `coinYear[p] += w` instead of `s.wealth[cap] += w`.
  `taxMul` applies only with fin.
  **(rev 2)** The land and wealth tax is a quota fixed in coin at the last assessment: `w ·= assessR[p]` (last fiscal year's clamp(plAssess / pl, aMin, aMax)).
  The payer pays only `w`, so in inflation the taxpayers keep the difference. With FIN.money false, assessR ≡ 1.
- Duties and seizures (5 sites, 1.1): a helper `crownRev(s, ps, income, c, q, x)` in finance/hooks.ts. Off: exactly the old two statements
  (`if (c >= 0 && s.abandoned[c] < 0) income[c] += x; if (q >= 0) ps.pRevYear[q] += x`). On: `pRevYear[q] += x` (pRevSm keeps meaning), and
  `coinYear[q] += x` when q ≥ 0 is alive, else (q < 0) the old income[c] path.
- Tribute (bonds.ts tributeFlows): with fin, the food part stays and the wealth part is skipped. The fiscal year pays
  `trib = share · R_a` from a's treasury to `coinNext[b]` (share = VASSAL.share or VASSAL.tribute) and adds it to `pRevYear[b]` as today.
  **(rev 2) Fixed in coin**: at the bond's first fiscal year (tribNom[a] = 0), or when `year − bond start` is a multiple of tribRenew, set
  `tribNom[a] = share · R_a · pl[a]`. The payer then pays the real amount `trib = tribNom[a] / pl[a]`, capped at `share_max · R_a` with share_max = 2 · share
  (so a deflation cannot make it crushing; the cap is [A]). The overlord books `trib · finAccept(s, a, b)` (2.7). The rest is lost in exchange.
  Duties and royalties stay real: duties are ad valorem on real gaps and royalties are a share of output. This is the historical asymmetry:
  customs kept pace with prices while fixed rents and quotas did not [historical claim, unverified in the citation audit; read it as design rationale].
- Plunder (war.ts conquer): `x = WAR.plunder · loot`; with fin, `coinNext[p] += plunderCrown · x` and the capital gets the rest.
- Royalties (goods on): for each deposit with `dOut > 0`, worker `wk` alive and a member of p:
  `x = min(royalty · dOut · GOODS.value[Treasure], 0.5 · wealth[wk])`; `wealth[wk] -= x`, `coinYear[p] += x`. This loops over g.dCount (small).
- `taxSm += revSmooth (wealth tax − taxSm)`, the same for mineSm. `R = pRevSm + taxSm + mineSm`; `revOrd += revSmooth (R − revOrd)` only when `pWars[p] = 0`.
  At founding: revOrd = R = 0.

**2.4.2 Expenses E (with R° = revOrd)**
```
court    = court · R° · clamp(sqrt(members / courtRef), courtMin, courtMax)
garrison = garrison · R° · (1 + rivalArmy · min(1, maxR_p))            maxR_p: max relR over relations with border edges (one loop over relations)
works    = R° · (ring · Σ_m walls[m] · pop[m] / pPop + fortW · #forts)
war      = Σ_{active wars w with p a side} R° · (att ? warAtt · (1 + siege·[wSiege[w] ≥ 0]) : warDef) · (civil ? civil : 1)
tribOut  = share · R  (if pSub[p] ≥ 0)
interest = Σ_open k  lRate[k] · lPrin[k]
```
An unmonetised realm (R° < minRev) still books and spends, but has no effects (2.4.6, 2.4.7).
**(rev 2)** Two multipliers. (a) Patronage, only when `s.soc !== null`: `court ×= clamp(patronBase + patronK · socOverprod(s, p), patronBase, patronMax)` (0.5).
(b) Wage lag, with money on: `garrison, war ×= (1 − wShare + wShare · ω)`, ω = finWageLag. While wages lag rising prices, armies are cheaper in real terms.
When wages are sticky in a deflation (ω > 1), they cost more. ω ∈ [0.6, 1.5], so the factor stays in [0.76, 1.3].
**(rev 2) Erosion of nominal debt**, at the start of the fiscal year, before interest: each open account of p gets `lPrin[k] ·= plPrev[p] / pl[p]`, and diag
`yInfl += the change` (signed). Loans are in the borrower's coin. Debtors gain from inflation and lose from deflation (debt-deflation: Fisher 1933).
The factor is in [1/(1+piMax), 1/(1−piMax)] = [0.926, 1.087] by the limiter. Lenders' assets (`expo`) are reduced by the same amount, and the pool `mw` is untouched: the loss is real value never repaid.

**2.4.3 Paying**
```
treas += coinYear − (court + garrison + works + war + tribOut)
pay interest: if treas ≥ interest: treas −= interest, lenderTake(each account's interest), lPaid += …
              else: pay pro rata what is ≥ 0, capitalise the rest into lPrin (arrears of interest)
spend-back:   s.wealth[cap] += home · (court + garrison + works) + warHome · war      (capital alive)
overflow:     if treas > reserveCap · R°: s.wealth[cap] += treas − reserveCap · R°; treas = reserveCap · R°
```

**2.4.4 Interest rate offered to p** (lender-independent part; foreign lenders add rForeign)
```
r_p = clamp( rateMul_p · rBase + rStain · stain_p + rLoad · max(0, debt/R° − loadFree) + rWar·[pWars > 0]
             + rCoin · (1 − coin_p) − rAble · (ability − 1) ,  rMin, rMax )
```
`ability` is from `R.rAbility[R.cur[p]]` (rulers; 1 without). `r_p ≥ refuse` → no credit.
**(rev 2)** Add `+ rInfl · max(0, piSm_p)` inside the clamp: lenders ask an inflation premium, which is half of expected inflation and so only a partial Fisher
effect (Fisher 1930). Foreign lenders add `rForeign + rGresham · (1 − coin_p)`, because they are repaid in coin their own markets discount (2.7).

**2.4.5 Borrowing, repayment, default**
```
target   = pWars > 0 ? chest · war : 0
need     = target − treas + (treas < 0 ? cushion · E : 0)
headroom = max(0, dsMax · R° · (1 + warlikeDs (rWar − 0.5)) / r_p − debt)
if need > minLoan · R° and r_p < refuse:
   for o in lenderCandidates(p)  (domestic first, assets desc, (kind, id) asc):
      offer = Pool/Town: min(lendCap · (assets + expo) − expo, left);  Family: familyLendCapacity
      x = lenderGive(o, min(offer, left, headroom_left)); account (p, kind, id): open if none (LoanTaken), lPrin += x, lRate = r_p + rForeign·foreign (new money at the new rate: lRate = (lPrin·lRate + x·r)/(lPrin + x))
      treas += x; expo += x
repay  (peace, treas > repayAbove · R°): pay repay · (treas − repayAbove · R°) to accounts in rate-desc order (ties by id); account closes Repaid at 0
arrears: unpaid = treas < 0 ? unpaid + 1 : 0;  pPay[p] = 1 − unpaidProj · min(1, unpaid / unpaidFull)
default: if debt > 0 and year − lastDefault ≥ defaultGap and (interest > dsBreak · R° or unpaid ≥ arrearYears):
   h = clamp(1 − dsAfter · R° / (r_p · debt), hMin, 1)
   each open account: lost = h · lPrin; lPrin −= lost; lLost += lost; lenderLose(…) → ruin share; Pool: HousesRuined if ≥ ruinShare
   accounts at 0 close Defaulted; stain += stainDefault · h; lastDefault = year; treas = max(treas, 0)
   CrownDefault event; grudge (0.4) for foreign lenders
```
Repudiation: when `acc[p]` is set to Usurped, Conquered, or a new house's accession (rulers hook `finAccession(fin, p, how)` in
`succession` after the accession), and `debt > repudiateMin · R°`: one draw `rng.next() < repudiate · (0.5 + rWar)`. If it hits:
h = 1, LoanEnd.Repudiated, stain += stainRepudiate, Repudiation event, grudge. Then `acc[p] = 0`.

Account housekeeping, in the fiscal year before borrowing:
- the lender's seat is abandoned → LenderGone (forgiven: the crown keeps it);
- the seat is now a member of p (the crown conquered its creditors) → Seized;
- a Family lender ended → LenderGone.

On the polity's end (`finPolityEnded` hook in `endPolity`): if the cause is Absorbed or Reunified and `by` is a living capital, accounts pass to the absorber (old rows close
`Assumed`; new rows open for the absorber with the same lender and principal, with no LoanTaken event). Otherwise they close `Lost`,
lenders lose everything (HousesRuined as above), and no grievance is recorded (no debtor left).

**2.4.6 War**
- `projAt *= ps.pPay[p]` (polity/state.ts): unpaid armies fight worse.
- `exhaust` (war.ts): with fin, `E += unpaidExh · min(unpaid, 3)` **replaces** the `WAR.poor` term (with fin off, the old term stays).
- `campaigns` peace check, after exhaust: let `b` be the side with `unpaid ≥ 1` (attacker first). End the war if
  `spent || tired || (b ≥ 0 && unpaid_b ≥ mutinyYears)`. If b ≥ 0 and (spent by b, or mutiny), log **WarBankrupt** just before
  `closeWar`. Outcomes are computed as today (taken vs retaken, peaceTerms).
- ArmyUnpaid is logged when `unpaid` first becomes 1 for a side at war (at most once per war and side: keep a per-war bit pair in `fin`).
- tired: `rng.next() < peaceChance · (1 + peaceDebt · min(2, max(debt_p / R°_p, debt_q / R°_q)))` (the same single draw).
- Declarations: `mul *= finWarDrive(fin, p)` (still one draw):
```
monetised = R° ≥ minRev;  if not: 1
costYear  = warAtt · R°;  surplus = R − (court + garrison + works + interest)   (this year's)
fundYears = (max(0, treas) + headroom) / max(1e-9, costYear − max(0, surplus))   (∞ when the surplus covers the war)
drive     = declFloor + (1 − declFloor) · smoothstep(fundLow, fundHigh, fundYears)
          · (fundYears > chestYears ? chestMul : 1) · (year − lastDefault < afterYears ? afterDefault : 1)
```
- Rulers: overthrow chance `× (1 + unpaidOverthrow · min(unpaid, 3))` (`finOverthrow` in rulerYear).
- peaceTerms: unchanged in v1. [A: open question, should a bankrupt defender accept tribute more readily?]

**2.4.7 Tax pressure** (needs monetised)
`δ = max(0, E − coinYear) / R°`; `taxMul += taxRate · ((1 + taxUp · min(1, δ)) − taxMul)`, clamped to [1, taxMax], easing toward 1 in surplus.
Grievance (unrest.ts `grievance`): `terms[5] = taxGrief · (taxMul − 1) + coinGrief · (1 − coin)` (only with fin; `causeOf` loops k < 6,
and terms[5] stays 0 without fin, so the comparisons are unchanged). **(rev 2)** `terms[5] += wageGrief · max(0, 1 − ω) + priceGrief · min(0.1, max(0, piSm))`:
the dearth of the price revolution, wages behind bread. At most 0.12 + 0.2. It is the same Taxes cause, the "tax-gatherers and the price of bread"
[A: whether a separate cause reads better; the registry has no free slot planned, so it stays Taxes]. New `RevoltCause.Taxes = 5` (registry). tariffStep: with fin, the need term reads
`smoothstep(needHigh, needLow, treas / R°)` (in years) instead of capital wealth / mass.

**2.4.8 Credit record** `stain *= stainKeep` yearly. `rate[p] = r_p` stored for snapshots, even when it did not borrow.

**2.4.9 Debasement (optional, FIN.debase)**
When `unpaid ≥ 1` or (need > 0 and r_p ≥ refuse), `coin > coinMin` and `year − lastDebase ≥ debaseGap`:
one draw `< debaseChance · (1.5 − min(1.5, ability))`. If it hits:
```
coin *= 1 − debaseStep
L = seign · debaseStep · Σ_m wealth[m];   each member: wealth[m] *= 1 − seign · debaseStep;  member Pool lenders: mw *= 1 − seignMerch · debaseStep
treas += seignKeep · L    (the rest is deadweight)
```
Debasement event. While coin < 1: the rate rises (rCoin) and grievance rises (coinGrief). Reform: unpaid = 0, debt / R° < 2,
treas ≥ reformCost · R° · (1 − coin), ability ≥ 1 → pay that, coin = 1, CoinageRestored.
**(rev 2) The trade-off of debasement**, now with consequences in money (2.6, 2.7):
- *Short term*: seignorage `seignKeep · L` this year, which is unchanged.
- *Long term P*: p's price target scales by 1/coin, so P rises about 1/(1 − debaseStep) = ×1.18 per step. With pLag 0.1 and the limiter, 65% of that comes in 10 years.
  Fixed nominal receipts fall with it, so the land tax (via assessR), tribute received in p's coin, and dues lose real value. The crown's own fixed revenue
  erodes until the next reassessment. A debaser that reassesses recovers it, but only at the reassessment (60 years, or early under tax pressure).
- *Credit*: rCoin·(1 − coin) (rev 1), plus rInfl · piSm while prices rise, plus rGresham·(1 − coin) for foreign lenders. Good coin also leaves (2.7).
- CoinageRestored: the target falls back by coin, so prices deflate over about 10 years. Debtors (the crown included) then lose by 2.4.2 erosion, as after the English recoinage of 1696 [historical analogy, A; Narron & Skeie 2013 confirm the monetary contraction and credit strain of 1696, not a measured price fall].

### 2.5 Contract additions (`src/contract.ts`), drafted in the codebase style
```ts
// finance: crown treasuries, loans, default and debasement (210-219; none when HistoryOptions.finance is false).
LoanTaken: 210, // the crown of the polity ruled from `settlement` first borrowed from a lender seated at `other` (a mart's merchant houses, a merchant family's home, or a rich town): `value` the loan account (History.loans); `extra` the interest rate, a year's share (0.08)
CrownDefault: 211, // the crown of the polity ruled from `settlement` stopped its payments and wrote down its debts: `other` the seat of the lender that lost most (-1); `value` the polity id; `extra` the share of the debt written off (0..1)
Repudiation: 212, // a new ruler of the polity ruled from `settlement` (an usurper, a conqueror's choice or a new house) refused the crown's debts outright: `other` the seat of the largest lender; `value` the polity id; `extra` the debt repudiated (wealth units)
ArmyUnpaid: 213, // the soldiers of the polity ruled from `settlement` went unpaid in war `value` (History.wars): its treasury empty and its credit gone; `other` the enemy's capital; `extra` -1
WarBankrupt: 214, // war `value` ended because the polity ruled from `settlement` could no longer pay its armies (its PeaceMade follows the same year); `other` the enemy's capital; `extra` the years its soldiers had gone unpaid
Debasement: 215, // the polity ruled from `settlement` debased its coin; `other` -1; `value` the polity id; `extra` the silver content now (0..1, 1 sound)
CoinageRestored: 216, // the polity ruled from `settlement` restored its coin to full weight; `other` -1; `value` the polity id; `extra` the content before
HousesRuined: 217, // the merchant houses of `settlement` (a town pool, not a merchant family: those log FamilyFell) lost much of their capital when the crown ruled from `other` defaulted, repudiated or fell; `value` the loan account; `extra` the share of their capital lost
PricesRose: 218, // (rev 2) prices in the coin of the polity ruled from `settlement` rose by `extra` times (≥ 1.4) over the last 25 years; `other` the settlement whose mine's Boom lies behind it (the latest Boom within 100 years in the same trade zone), or -1 (a debasement or a slower drain); `value` the polity id
```
```ts
/** finance: who lent (History.loans.lenderKind). */
export const LenderKind = { Pool: 0, Family: 1, Town: 2 } as const // a town's merchant pool (History.merchantWealth; lender = settlement); a merchant family (History.families; lender = family id); a town's own wealth when goods are off (lender = settlement)
/** finance: how a loan account ended. */
export const LoanEnd = { Ongoing: 0, Repaid: 1, Defaulted: 2, Repudiated: 3, Lost: 4, LenderGone: 5, Seized: 6, Assumed: 7, Charter: 8 } as const
// Defaulted: written to nothing at defaults (an account written down only in part stays open, its `lost` counting it); Lost: the crown ended (conquered,
// fragmented, dwindled); LenderGone: the lender's seat abandoned or its family ended (the crown kept the money); Seized: the crown took the lender's seat
// (conquered its creditors); Assumed: the realm was absorbed or reunified and its debts passed to the absorber (a new account there); Charter: cancelled
// in exchange for a town's charter (city-states)
export const RevoltCause = { …, Taxes: 5 } // (finance: the heavy taxes and debased coin of a crown in want)

/** finance: crown loan accounts, struct-of-arrays in order of opening: one account per borrower and lender, opened at its first loan, closed when repaid or ended (a later loan from the same lender opens a new account). */
export interface Loans {
  count: number
  /** Borrowing polity; lender kind (LenderKind) and id; the lender's seat (settlement) when the account opened. */
  polity: Int16Array
  lenderKind: Uint8Array
  lender: Int32Array
  seat: Int32Array
  startYear: Int16Array
  /** -1 while open at the end of the run. */
  endYear: Int16Array
  end: Uint8Array
  /** Largest principal outstanding; rate at opening and the highest it reached (a year's share); interest paid; principal written off. */
  peak: Float32Array
  rate0: Float32Array
  rateMax: Float32Array
  paid: Float32Array
  lost: Float32Array
}
```
History fields (all empty, length 0, when finance is off):
```ts
// finance: crown treasuries and credit (all empty when HistoryOptions.finance is false).
/** Coin in each polity's treasury per snapshot (wealth units; negative: bills in arrears), row-major treasury[s * polities.length + id], like `tariff`; 0 outside its life. */
treasury: Float32Array
/** Principal each polity's crown owed per snapshot, same layout. */
crownDebt: Float32Array
/** Ordinary revenue (coin a year at peace, smoothed) and spending a year (smoothed: court, garrisons, works, war, tribute, interest), same layout. */
crownRevenue: Float32Array
crownSpending: Float32Array
/** Interest rate the crown could borrow at per snapshot, 0..255 for 0..0.5 (255 also: no credit), same layout. */
creditRate: Uint8Array
/** Silver content of each polity's coin per snapshot, 0..255 for 0..1 (255 sound; 0 outside its life), same layout. */
coinage: Uint8Array
/** (rev 2) Price level of each polity's coin per snapshot (1: its trade zone's bullion equals the desired holding; FIN.pMin..pMax; 0 outside its life), same layout. */
priceLevel: Float32Array
/** (rev 2) Wages against prices per snapshot (finWageLag), 0..255 for 0..2 (128 = 1; 0 outside its life), same layout. */
wageLag: Uint8Array
/** (rev 2) State fiscal distress per snapshot (finSFD), 0..255 for 0..FIN.sfdMax, same layout. */
fiscalDistress: Uint8Array
loans: Loans
/** Principal outstanding per trade snapshot per loan account: loanBalance[q * loans.count + k] (0 before it opened and after it closed). */
loanBalance: Float32Array
```
HistoryOptions: `/** finance: crown treasuries, borrowing from merchant capital, default and bankruptcy (needs polities). Default true; false leaves the finance fields empty and the history exactly the one without them. */ finance?: boolean`.
HistoryDiagnostics: `finance?: FinanceDiag` (counters; yearly world sums `yDebt, yTreas, yInterest, yLent, yLost`; bankrupt-war ids; per default {year, p, h, debt, R°}; rates of loans opened).
Also: the `history.test.ts` event switch gets 210-218, and the `worker.ts` transfer list gets the new typed arrays [V: merchant-families notes the list at worker.ts ~l.176].
(rev 2) HistoryDiagnostics.finance adds `yInfl` (yearly world nominal-debt erosion, signed), `yGresham` (good coin exported), `clampHits`, `limiterHits`.

### 2.6 (rev 2) Money and prices: the quantity theory as an overlay (`finance/money.ts`, `moneyYear`)

**2.6.1 Unit and scope: per polity, shrunk toward its trade zone.** The model already has M (bullion `g.held[·, Treasure]`) and the
desired holding M_d = k·Y (`ts.demand[·, Treasure]`, 1.1). In Cambridge form, M = k·P·Y gives **P = M / (k·Y) = S / D**: MV = PQ with V = 1/k (equation of exchange: Fisher 1911, whose own notation is MV = PT; Cambridge form: Pigou 1917).
The real economy has no numeraire, so P is a **nominal overlay**. It never feeds `ts.price`, `g.held` or any market flow. It acts only on contracts that
finance writes in coin (land tax quota, tribute, charter dues, loans) and on wage-lag effects. This is what keeps it cheap and stable (2.6.4).
- *Why a polity and not a world or trade.ts region*: coin is issued by polities (debasement and Gresham need an issuer). trade.ts regions are
  settlement catchments, not blocs (1.1). One world pool would make a bonanza raise prices simultaneously on unconnected continents, and would kill diffusion.
- *Why shrunk toward a trade zone*: most polities hold almost no bullion. It concentrates at marts and mine sinks. A pure per-polity S/D put 25-35% of
  polity-years at the floor and gave jumps of up to 470% a year [M, 1.8 (3)]. A **trade zone** is a connected component of the open-route graph (`ts.openList`, ends
  rA/rB), found yearly by union-find. It stands for the market where bullion arbitrages (hvPair moves Treasure along those same routes).

**2.6.2 Rule** (yearly, polities in `ps.alive` order; all sums in ascending settlement / openList order)
```
zones:   zPar[i] = i (i < s.count); for r in openList: union(rA[r], rB[r]) (root = smaller id; path halving)
         zB[z] = Σ_{living i in z} held[i,T];  zD[z] = Σ demand[i,T];  x_z = zB / zD   (zD > 0)
polity:  B_p = Σ_{members} held[m,T] + gx[p];  D_p = Σ_{members} demand[m,T];  z = zone of pCapital[p]
         partner weights from inter-polity open routes (ends in polities pa ≠ pb): W_p = Σ rVol,  WP_p = Σ rVol · pl_q · coin_q,  WC_p = Σ rVol · coin_q
target   if x_z < sdMin or zD = 0:            P* = pl_p                           (unmonetised zone: the level holds)
         elif D_p ≤ 1e-6:                     P* = x_z / (sdRef · coin_p)
         else:                                P* = (B_p + κ · D_p · x_z) / ((1 + κ) · D_p) / (sdRef · coin_p)
move     x = pl_p + pLag · (P* − pl_p)
diffuse  if W_p > 0: x += pDiff · W_p/(W_p + pDiffHalf) · (WP_p / (W_p · coin_p) − x)       (partners' silver price, in p's coin)
limit    x = clamp(x, pl_p (1 − piMax), pl_p (1 + piMax));  x = clamp(x, pMin, pMax)       (limiterHits / clampHits in diag)
         plPrev = pl;  pl = x;  piSm += piSmooth · ((pl / plPrev − 1) − piSm)
wages    wage += wageLag · (pl − wage);  ω = clamp(wage / pl, wMin, wMax)
assess   if year − assessYear ≥ reassessYears, or (assessR < reassessLow and taxMul > 1.2 and ability ≥ 1): plAssess = pl, assessYear = year
         assessR = clamp(plAssess / pl, aMin, aMax)
```
New polity (`ensureFinPolities`/newPolity): `pl = clamp(x_z/sdRef, pMin, pMax)` if its zone is monetised, else 1. Then `plPrev = wage = plAssess = pl`, `assessYear = year`,
and `assessR = 1`. A successor state (Seceded) starts from its parent's pl instead [A: decide which reads better in the UI].
`coin_p` is 1 unless debased (2.4.9). So with debase off, coin plays no part and Gresham is inert.

**2.6.3 Effects (who wins and who loses)**
| holder of a fixed nominal claim | where | effect of P ↑ |
|---|---|---|
| crown, land and wealth tax (quota) | taxSystem, `w ·= assessR` | real yield falls until reassessment; taxpayers gain |
| overlord, tribute in coin | tributeFlows, `tribNom / pl` | the vassal pays less in real terms; renegotiated after tribRenew |
| overlord, charter dues | city-states via finReal (0.3) | dues erode |
| lenders, crown loans | 2.4.2 erosion | creditors lose, the crown gains; reversed in deflation |
| soldiers, wage earners | ω < 1: pay costs less (2.4.2), grievance rises (2.4.7) | wages lag; the crown gains on pay and loses on unrest |
Duties, royalties and plunder are real, so they keep their value. In the price revolution, a crown that lives on customs fares better than one that
lives on land quotas. There is no direct effect on population, food, wealth or the market.

**2.6.4 Why it is bounded and deterministic** (to be asserted by tests, 5.)
- |pl_t+1 / pl_t − 1| ≤ piMax by construction (the limiter after every term), and pl ∈ [pMin, pMax]. The diffusion term is a convex step toward a weighted mean of
  partners' bounded levels (coefficient pDiff · W/(W+half) < pDiff ≤ 1), so it cannot overshoot. Every erosion factor plPrev/pl lies in [0.926, 1.087].
- **No market feedback** except one damped loop: P ↑ → assessR ↓ → less tax taken → payers' wealth ↑ → `w/(w+half)` ↑ → D ↑ → S/D ↓ → P ↓.
  This is a negative loop through a saturating term, with a one-year delay and pLag 0.1, so it is stable [A: check in step 8b that clampHits stays < 1%].
- No RNG. Union-find with min-root is order-independent in its result. Sums run in fixed orders. Only + − * / (no log or pow; the ratios are plain divisions).
- Cost: O(s.count + routes + Σ members) a year, a few thousand operations, with no allocation (scratch grown by doubling). Estimated < 0.3% of a run [A: not timed separately; the probe allocates per year and is not a fair measure. Time it in step 8b].

**2.6.5 PricesRose (218)**: every riseStep years per polity, if `pl / plRef ≥ riseRatio` and `year − lastRise ≥ riseGap`, log it (settlement = capital,
other = the worker or sink of the latest Boom within 100 years whose sink lies in the same zone, else -1). Then `plRef = pl`. To find the Boom,
goods keeps no Boom list in state, so finance records `(year, d, sink)` from a one-line hook after `logGoods(Boom)` in deposits.ts `mineYear`
(`finBoom(s, d, sink)`, a no-op when fin is null) [V: the Boom site at deposits.ts ~l.390].

### 2.7 (rev 2) Gresham's law ("bad money drives out good"; named by Macleod 1858), only when FIN.debase and some coin < 1
Inside moneyYear, after the partner weights and before the targets, for each p with coin_p < partner mean `c̄_p = WC_p / W_p`:
```
e      = min(gOut · (c̄_p − coin_p) · max(0, B_p),  gMax · Σ_members held[m,T] + gx[p])   (good coin, in bullion units, leaves p this year)
gx[p] −= e;  each partner q (inter-polity routes of p, openList order): gx[q] += e · w_pq / W_p          (Σ conserved exactly up to rounding)
then all: gx *= (1 − gDecay)                                                                          (the bullion market re-balances in ~10 years)
```
- Domestically the debased coin stays in use, and p's target rises by 1/coin (2.6.2). The **good coin that leaves** lowers B_p a little (it partly offsets the inflation) and
  raises partners' B, so they **import some inflation**. gx is finance's own offset. `g.held` is never touched, so the goods market is unchanged.
  |gx_p| ≤ gMax · B_p + decay; it is bounded.
- **Partners discount the debaser's coin**: `finAccept(s, p, q) = max(gAcceptMin, 1 − gDisc · max(0, coin_q − coin_p))`. It applies to tribute (2.4.1), charter dues
  (0.3) and any `finCredit` from p to q. Foreign lenders add `rGresham · (1 − coin_p)` (2.4.4), so a debaser's credit abroad worsens.
- Net: debasement gives revenue now (seignorage), higher P later (its own fixed revenue erodes), dearer credit, and an outflow of good coin. That is the trade-off
  medieval mints faced (Spufford 1988; Sargent & Velde 2002 for the small-change mechanics; Gresham's "law" is a textbook simplification, and
  Rolnick & Weber 1986 argue that good money drives out bad at market rates, which is why the discount `finAccept` is here and not a forced par).

### 2.8 (rev 2) State fiscal distress (`finSFD`, for society-secular-cycles.md 0.2)
Literature: Goldstone (1991: 141-145) proposed a Political Stress Indicator Ψ = MMP · EMP · SFD. Turchin (2013, Cliodynamics 4(2): 241-280) follows its logic with
modified functional forms and uses SFD = (Y/G) · D, state debt over GDP times public distrust in state institutions; Stachowiak & Pasek (2024, arXiv:2405.01163) restate both. Society wants **the fiscal part only** (its asabiya term, after Turchin 2003, stands in for distrust), so finSFD has no distrust factor.
debt / R° stands in for debt/GDP (R° ∝ GDP times a tax share that changes slowly; [A]).
```
defSm += sfdSmooth · ((E + interest − coinYear) / max(R°, minRev) − defSm)           (yearly, in fiscalYear; deficit trend, ~20 years)
if not monetised (R° < minRev) or s.fin null:   SFD = 1 + 0.6·min(1, pExh) + 0.5·[year − R.lost[p] ≤ 10] + 0.3·[inCrisis]   (society's proxy without its elite term)
else SFD = clamp( 1 + sfdLoad · max(0, debt/R° − needDebtLow)          (debt load beyond half a year: 0.25 per year of revenue)
                    + sfdDef · max(0, defSm)                         (structural deficit: +1 per revenue-year of deficit a year)
                    + sfdArr · min(unpaid, 3)                        (arrears)
                    + sfdDefault · [finDefaulted(s, p)]              (default or repudiation within 20 years)
                    − sfdReserve · min(1, max(0, treas) / (reserveCap · R°)) ,  sfdMin, sfdMax)
```
An ordinary realm (debt < 0.5 R°, balanced, paid) gives 1. A full reserve gives 0.7. A realm 4 years of revenue in debt and in arrears for 2 years
gives about 1 + 0.9 + 0.6 (+ deficit) ≈ 2.5-3.5. A defaulted one gives +0.5. The scale matches society's proxy (1 + up to 1.4). Through inflation it
also reads the monetary channel: eroded land quotas → deficit → defSm. With patronage (2.4.2), EMP → court → deficit → SFD closes Turchin's loop.
`finSFD` reads only fin and ps fields: O(1) and RNG-free. finSFDParts is not needed: the harness reads the terms from diag.

### 2.9 (rev 2) Hotelling rule: considered, not adopted
Hotelling (1931): an owner of an exhaustible stock extracts so that the net price rises at the rate of interest. deposits.ts has no owner choice.
Output is set by labour, technology and the physical `sqrt(R/R0)` decline. There is no forward Treasure price, and the only resource-dependent
price is the scarcity price of the stock, which a pacing rule would make circular (pace ↓ → S ↓ → price ↑ → pace ↑). A cheap version, `out ×= clamp(1 + h · (r − π_T), …)`,
would need an expected Treasure price trend (noisy at polity scale, 1.8) and a crown discount rate. It would only shift extraction by a few percent against a 250-year
bonanza that is already physically paced. Empirical support for the Hotelling path is weak (Krautkraemer 1998: "observed data are often inconsistent with the Hotelling rule"). **Not meaningful at this cost.**
Revisit only if a "crown monopoly mine" (royalty > 0.5) is added, because then the crown is the owner and its rate r_p exists.

---

## 3. Step order and determinism

### 3.1 Placement
- Booking hooks run where the flows already happen (trade/flushAccounts, longhaul, taxSystem, tributeFlows, conquer).
- **`fiscalYear(s, ps, fin)`** runs in `politySystem` after the abandoned-members block and the mapPass, **just before `campaigns`**.
  At that point this year's wealth tax and duties are booked (taxSystem and trade ran earlier in the year), and the wars are the
  ones in force. So campaigns this year see this year's `unpaid`/`pPay`. Plunder taken in campaigns goes to `coinNext` (next year).
- **(rev 2)** `moneyYear(s, ps, fin, ts, g)` runs first inside fiscalYear. By then trade has run this year's market and goodsSettle (g.held after
  Treasure wear), `ts.demand` holds this year's desired holdings, and `openList`/`rVol` hold this year's routes [V: trade runs before politySystem, 1.4;
  A: that ts.demand is not cleared in between; check in step 8b]. Then the erosion of debt, then income and expenses (using this year's ω and pl), then
  defSm and the SFD terms. `assessR` computed here is used by next year's taxSystem (a one-year lag, so the order is fixed). The PricesRose check runs at the end.
- Declarations (slow step, later in politySystem) read this year's fiscal state.
- rulerYear (after campaigns) sets `acc[p]` through `finAccession`. It is acted on at the next fiscalYear.
- Snapshots: `finSnapshot` in index.ts `snapshot()` after polSnapshot. `finTradeSnapshot` (loan balances) in `tradeSnapshot()`.
- Assembly: `assembleFinance(fin, P, snapshotCount, tradeSnapshotCount)` → spread into history; `emptyFinanceHistory()` when off.
- `fin` is created in createRunner after `rul` (it needs pol; goods optional): `pol && (options?.finance ?? FIN.enabled) ? createFinance(s) : null`.

### 3.2 Determinism
- New stream `'history-finance'`, created only when on. It is drawn only for repudiation (only when `acc` is set and debt qualifies) and
  debasement. Borrowing, default and repayment are deterministic.
- Orders: polities ascending (`ps.alive`); accounts ascending ids; lenders by (domestic, assets desc, kind, id). The `acct` Map is lookup only.
- No new draws on other streams. The declaration and tired-peace multipliers reuse their single existing draws.
- **(rev 2)** Money, Gresham and SFD draw nothing. Union-find over `openList` in its stored order (deterministic: order of (re)opening). FIN.money false: pl ≡ plPrev ≡ 1,
  assessR ≡ 1, ω ≡ 1, finAccept ≡ 1, piSm ≡ 0, gx ≡ 0. Every multiplication by these is IEEE-exact (×1, +0), so **finance with money off is bit-identical to rev-1 finance**.
  Test: hash all History fields on 42:1200 with FIN.money false against a golden recorded at the end of step 8, before step 8b. The patronage factor is
  skipped (not ×1) when `s.soc` is null, so society off ⇒ identical as well.
- Arithmetic: + − * / sqrt only (stainKeep is a literal; no pow).
- Prefix stability: everything is per year, with no knowledge of the run's length. Accounts and events only append.
- **Off identity**: every hook is `s.fin !== null ? … : old`. pPay is 1. Check 1: `finance: false` gives the same as 8cabf09 on every History field except the new
  empty keys (a vitest comparison on 42:1200, 3:600, 9:800 n=24, plus existing goldens unchanged). Check 2 (step 2, shadow mode
  `FIN.divert = false` and all effects off): finance on gives the same as off on every pre-existing field. This is a real test while it holds,
  removed or converted at step 3 with a commit note (as grudges-and-oaths 3.8 does).
- Hash filters: every existing golden hash function skips keys `treasury, crownDebt, crownRevenue, crownSpending, creditRate, coinage, loans,
  loanBalance` and (rev 2) `priceLevel, wageLag, fiscalDistress`, and events 210-219 (like the 120-129 and 140-149 filters).

---

## 4. UI

### 4.1 Data (`ui/politiesData.ts`)
Load `treasury`, `crownDebt`, `crownRevenue`, `crownSpending`, `creditRate`, `coinage` like `tariff` (length check `≥ S·P`). Add accessors
`treasuryAt/debtAt/rateAt/coinAt(pd, p, s)` and `loansOf[p]` (account ids by polity) plus `lendersAt(pd, p, year)` (open accounts at the year;
balance from loanBalance at the nearest trade snapshot). Add `PolityEvent` entries 210-217.

### 4.2 Polity panel (`ui/politiesPanel.ts` faction detail; next to the tariff line ~l.674 and `tariffSpark` ~l.543)
- Line: `Treasury 4,200 · debt 12,000 (3.1 years of revenue) at 9%`, with variants `· in arrears 2 years` (red), `· defaulted 1478`,
  `· coin 70% silver`. Without monetisation: `No coined revenue to speak of`.
- Chart (canvas 160×36, the tariffSpark style): revenue (amber line) and spending (white line) over its life, debt as a filled area on
  a second scale (red, 30% alpha), ticks for CrownDefault (red), Repudiation (black), Debasement (grey), WarBankrupt (orange). There is a cursor at the year.
  Tooltip: `Revenue, spending and debt over its life (debt peaked at 7.4 years of revenue in 1477)`.
- (rev 2) Second line when money is on: `Prices ×1.6 in 50 years · wages behind (80%) · fiscal distress 2.4`. Prices relative to the snapshot 10 back.
  Show the wage part only when ω < 0.95 or > 1.05. Tooltip: `Prices in its coin: bullion against what its markets want to hold, as in its trade zone`.
  The chart gains an optional dotted line for the price level (log-free: a second linear scale 0..max).
- "Creditors" list (top 3 open accounts at the year): `Oruma merchants 6,100 at 8%`, `House Veckin (Osk) 3,000 at 11%`; clicking selects the seat.
- City card (`ui/cityCard.ts`): `Its merchants are owed 6,100 by the crown of Vashtar` when crownOwedAt > 0.

### 4.3 Chronicle lines (`ui/polityFormat.ts` describeEvent; category 'politics', new optional filter "Money" in chronicleFilter.ts)
- 210 `Vashtar borrows from the merchants of Oruma (at 8%)`
- 211 `Vashtar stops payment to its creditors (half its debt written off)`
- 212 `The new king of Vashtar repudiates the crown's debts`
- 213 `The soldiers of Vashtar go unpaid`
- 214 `Vashtar, unable to pay its armies, makes peace with Kubeta` (and the PeaceMade line keeps its outcome; group 214 with 25 for the same war, as `isPolityHeadline` groups)
- 215 `Vashtar debases its coin (two-thirds silver)` / 216 `Vashtar restores its coin`
- 217 `The merchant houses of Oruma are ruined by Vashtar's default`
- (rev 2) 218 `Prices soar in Vashtar (half again in a generation), on the silver of Oruma` / with other −1: `Prices soar in Vashtar (half again in a generation)`
Headlines: 211, 212, 214. The rest show in the polity's event list. Group LoanTaken per polity per decade (`describeGroup`: "Vashtar borrows from three lenders").

### 4.4 Sagas (`ui/sagas/finance.ts`: phrase table FIN_T plus sentence builders used by state.ts, year.ts, city.ts, reigns.ts)
The chronicle register is plain for recorded facts, and **hedged for causal readings** (the war ended *because of* money is an inference):
"it is recorded", "by some accounts", "it seems". The legend register is heightened and certain. Numbers are rounded ("half", "about eight in the hundred").
| key | chronicle | legend |
|---|---|---|
| finLoan | From 1460 the crown borrowed from the merchant houses of Oruma, at about eight in the hundred. | From 1460 the crown drank from the coffers of Oruma. |
| finDefault | In 1478 the crown of the Vashtar could no longer meet its debts and stopped its payments; the houses of Oruma, it is recorded, lost half of what they had lent. | In 1478 the gold of the Vashtar ran dry, and the crown broke faith with the lenders of Oruma; half their silver was lost to them. |
| finWarBroke | {war} ended in 1481, it seems, less for want of men than of money: the soldiers of the Vashtar had gone unpaid two years. | In 1481 the Vashtar host, two winters unpaid, threw down its spears, and {war} was ended. |
| finRepudiate | When Teshar seized the throne in 1502 he is said to have refused the debts of the house before him. | Teshar took the crown in 1502 and burned the bonds of the house he had cast down. |
| finDebase | In 1510 the coin of the realm was debased, by some accounts to two parts silver in three. | In 1510 the king's coin was thinned with copper, and men weighed it in their palms and cursed. |
| finRuin (city saga) | The default of the Vashtar crown in 1478 cost the houses of Oruma a third of their capital. | In 1478 the crown's broken word emptied the counting-houses of Oruma. |
| finPrices (rev 2; 218 with a Boom) | After the silver of Oruma came to market, prices in the Vashtar lands rose by half within a generation; the crown's old rents, it seems, bought ever less. | The silver of Oruma ran like water through the Vashtar markets, and bread cost twice what the fathers had paid. |
| finGresham (rev 2; a Debasement followed by gx < 0 for 10 years) | The good coin of the old weight, it is said, went abroad, and only the thin coin stayed at home. | The heavy silver fled across the borders, and only the king's light coin remained. |
| finSound (state saga, never in debt over 300 years) | Its crown, as far as the records tell, never borrowed. | Its kings kept their gold and owed no man. |
Year saga: one sentence for the greatest default of the span ("In 1478 the Vashtar crown defaulted, and the houses of Oruma were ruined").
Epithets (legend only, ui/sagas/epithets.ts, from facts of the reign): two or more defaults → "the Bankrupt"; a debasement → "the Clipper";
a repudiation → "Bond-breaker". War names (wars.ts): a war ending in WarBankrupt and lasting ≥ 8 years may be called "the War of the Empty Chest" (optional, after the existing rules).

### 4.5 Map view (render/palette.ts `ViewMode.Credit = 'credit'`; render/polities.ts draws it; viewLegends.ts legend)
Territory by `debt / R°` at the snapshot, on a diverging ramp: reserve (treasury/R° up to 8) teal → balanced neutral → debt amber
(to 8 years) → arrears or default within 20 years red with hatching. Unmonetised realms are drawn grey. Lender seats are gold rings
sized by total crown exposure at the year. (rev 2) A sub-mode toggle "Prices" shades territory by `priceLevel` against the world median at the snapshot,
on a diverging ramp (cheaper blue, dearer red), so a bonanza's spread along the trade zone can be seen as a wave. Arcs from seat to borrower capital for open accounts, width ∝ loanBalance, reusing
render/longhaul.ts's arc code [A: check its API]. Hidden without finance data (`setViewModeAvailable(ViewMode.Credit, !!pd.treasury)`, as Danger does at
politiesPanel.ts ~l.1132).

---

## 5. Ordered commit-sized steps
Each step: `npm test` and `npm run typecheck` green; goldens unchanged until step 12.
1. **Contract and plumbing.** contract.ts (events 210-217, LenderKind, LoanEnd, RevoltCause.Taxes, Loans, History fields, HistoryOptions.finance);
   finance/params.ts (FIN.enabled false); finance/assemble.ts `emptyFinanceHistory`; index.ts wires the empty fields; the hash filters in every
   golden test (polity, goods, disease, tourism, renaming, ideas, orders, cradleWish, landmarks if any) and the history.test.ts event switch; worker.ts transfer list.
   Tests: all goldens unchanged.
2. **FinanceState and shadow ledger.** finance/state.ts, finance/system.ts `fiscalYear` (income measured through the hooks, but with `FIN.divert = false` the money is
   not moved; expenses and loans notional; no effects), snapshots, assembly. `HistoryState.fin`, `ps.pPay`. financeStats.ts skeleton (from probe-shadow.ts).
   Tests: shapes and invariants, prefix stability (1200 → 1500 vs 1500), **finance-on equals finance-off on all pre-existing fields** (shadow mode).
3. **Real treasury.** `crownRev` helper at the 5 duty sites (outlaw.ts ×3, longhaul.ts ×2), taxSystem wealth tax, tributeFlows, conquer plunder,
   royalties, spend-back and overflow. Tests: per-polity ledger identity from diag accumulators
   (Σ income − Σ spending − interest + borrowed − repaid = Δtreas, to 1e-9 relative); wealth conservation (treasury plus capital receipts equal the old flows when spending = income).
   The shadow-equality test is removed here (commit note).
4. **Lenders and loans.** finance/lenders.ts (Pool, Town; the Family branch calls families/api.ts behind `s.goods?.ext.fam && FAMILY.feedback`, stubbed until it lands),
   borrowing, interest, repayment, accounts, LoanTaken, account housekeeping (LenderGone, Seized), polity end (Lost, Assumed), loanBalance. Tests: Loans invariants
   (end Ongoing ⇔ endYear −1; startYear ≤ endYear; peak ≥ lost; LoanTaken.value indexes an account whose polity rules `settlement` at the year); snapshot debt equal to
   Σ loanBalance at shared years (float32 tolerance); mw ↔ treasury transfers exact.
5. **Default, credit record, repudiation, ruin, and the city-states API** (0.3: finNeed, finDefaulted, finRevenue, finTownRevenue, finTreasury, finSpend, finCredit, finCharterOffset; unit-tested against hand-built states). Rate function, default and haircut, stain, rulers hook `finAccession` (rulers/system.ts `succession`), HousesRuined,
   the grudges hook (`record` CrownDefault, guarded by `ps.oaths`, no-op until oaths lands). Unit tests for the rate and haircut; event semantics (211.extra in (0, 1]; 212 only after an accession that year or the year before).
6. **War coupling.** pPay in projAt; the exhaust hook (replacing WAR.poor when on); ArmyUnpaid, WarBankrupt and mutiny in campaigns; finWarDrive in declarations;
   the tired multiplier; finOverthrow in rulerYear. Tests: each 214 is followed by a 25 of the same war in the same year; no 214 for a side with unpaid 0.
   **Tune with financeStats here** (section 6).
7. **Tax pressure.** taxMul in taxSystem; terms[5] and RevoltCause.Taxes in unrest.ts; tariffStep need term. Update polityFormat revolt words ("Townsmen rise at X against the tax-gatherers of Y").
8. **Debasement** (FIN.debase false until tuned): rule, reform, events, grievance and rate terms. (rev 2) At the end of this step, record the
   `FIN.money = false` golden (all History fields, 42:1200), used by the off-identity test of 8b.
8a. **(rev 2) SFD and patronage.** `defSm` in fiscalYear; `finSFD`, `finMonetised` in hooks.ts (2.8); `fiscalDistress` snapshot; the patronage factor in 2.4.2 behind
   `s.soc !== null` (a stub import of `socOverprod` until society lands, guarded by `s.soc`). Tests: unit (hand-built: an ordinary realm → 1 ± 1e-12; full reserve → 0.7;
   debt 4 R° + unpaid 2 → in [2.4, 2.6] with defSm 0); always ≥ sfdMin and ≤ sfdMax and finite over a 42:1200 run; with fin null it equals the proxy formula; society off ⇒
   court cost unchanged bit for bit.
8b. **(rev 2) Money layer** (`finance/money.ts`; FIN.money false until tuned): zones, targets, diffusion, limiter, wages, assessment; `assessR` in taxSystem; debt erosion and
   the inflation premium; ω in garrison/war cost and grievance; tribute fixed in coin (tribNom, renewal); finPrice/finReal/finWageLag/finInflation; `finBoom` hook in
   deposits.ts; PricesRose 218; `priceLevel`/`wageLag` snapshots. Tests below (5.1). Tune with financeStats (6, rev-2 rows).
8c. **(rev 2) Gresham** (inert unless FIN.debase): gx export and decay, finAccept on tribute, dues and finCredit, rGresham. Tests: conservation, bounds, sign (5.1).
   City-states' dues amendment (0.3) is done in their plan, behind `s.fin`.
9. **UI data and panel.** politiesData accessors, the panel line, chart and creditors, the city-card line, chronicle lines (polityFormat) and the "Money" filter.
10. **Sagas.** finance.ts phrase table; state, year, city and reign sentences; epithets; optional war name. Saga tests: both registers fill every slot (no `{x}` left).
11. **Map view Credit.** palette, polities renderer, legend, availability.
12. **Flip `FIN.enabled = true`** (rev 2: and `FIN.money = true` if 8b's targets pass; FIN.debase stays as decided in step 8). Re-record goldens with the documented check ("with finance false the tree was checked bit-identical to 8cabf09+steps on every
   History field in every off configuration: all on, all off, and each system off, at 42:1200, 3:600, 9:800 n=24"). Update the index.ts header (systems and streams),
   the polity/system.ts header (hooks) and the war.ts header (bankruptcy). Add a finance-on golden (finance fields + events 210-219).

### 5.1 (rev 2) Money tests (vitest, `finance/money.test.ts`)
- **Bounded P (unit fuzz)**: drive `moneyStep` on a hand-built state of 8 polities and 3 zones with inputs from `createRng(1, 'test-money')`, 10,000 years:
  B and D jump by factors up to 100, zones split and merge, coin falls to coinMin and is restored. Assert each year: pl finite, pl ∈ [pMin, pMax],
  |pl/plPrev − 1| ≤ piMax + 1e-12, ω ∈ [wMin, wMax], assessR ∈ [aMin, aMax], |gx_p| ≤ gMax · B_p + previous gx.
- **Convexity**: with pLag = 0 and the limiter off, one diffusion step leaves pl inside [min, max] of {pl_p, partners' silver price / coin_p}.
- **Fixed points**: S = D everywhere, coin 1 ⇒ pl → 1 (within 1e-9 after 400 years); a zone with S/D < sdMin ⇒ pl unchanged exactly.
- **Debasement pass-through**: one polity alone in its zone, coin 1 → 0.85 ⇒ pl/pl₀ → 1/0.85 (within 1%) after 100 years, and ≥ 1.1 after 10.
- **Gresham conservation**: Σ_p gx before decay changes by 0 (≤ 1e-12 relative) in an export year; the exporter's gx < 0 and partners' > 0; with all coin = 1, gx ≡ 0.
- **Integration (42:1200, 3:600 and one full 42 run with money on)**: every `priceLevel` sample of a living polity in [pMin, pMax]; snapshot-to-snapshot ratio
  ≤ (1 + piMax)^5 (computed by repeated multiplication); clampHits / polity-years < 1%; ledger identity of step 3 still holds with `yInfl` as a term.
- **Determinism**: two runs 42:1200 give identical priceLevel/wageLag/fiscalDistress and events 218; prefix stability 1200 → 1500 vs 1500; FIN.money false equals the step-8 golden on all fields;
  money on leaves every non-finance History field *the same as money off except through the listed channels*. That last one is not a test, because taxes change wealth;
  the harness guards it (6).
- **Event semantics**: each 218 has extra ≥ riseRatio; consecutive 218s of a polity are ≥ riseGap apart; `other` ≥ 0 only if a Boom was logged in the 100 years before.

---

## 6. Stats harness (`src/sim/history/finance/financeStats.ts`)
Run with `node src/sim/history/finance/financeStats.ts [seed …] [--no-ab]`. The default seeds are 1, 7, 42, 1234; `--all` uses HISTORY_STATS_SEEDS. Each seed runs
finance on and off (A/B). The output is a target table (measure, target, result, verdict), as in polityStats.ts.
| measure | target (each of seeds 1, 7, 42, 1234) |
|---|---|
| share of ended wars with a monetised side that end in WarBankrupt | 10-25% (hard bounds 5-35%) |
| CrownDefault per 2000 years | 4-15 |
| Repudiation per 2000 years | 1-5 |
| HousesRuined (Pool) per 2000 years | 2-10 |
| share of world merchant capital lost to crown defaults over the run | 2-15% |
| Kingdom+ polity-years 1500-2000 with debt > 0 | 30-70% |
| median rate of loans opened | 6-12% |
| mean rate of loans opened ≤ 50 years after a default minus the same polity's rate before | ≥ +4 points |
| declarations per 100 polity-years, top tercile of fundYears / bottom tercile | ≥ 1.5 |
| median war length vs off | within ±2 years; p90 0-30% lower |
| revolts with cause Taxes | 3-15% of revolts |
| debasements per 2000 years (when on) | 2-10 |
| guards vs off: polities alive at 1500 and 2000, largest share, conquests, war deaths | within ±20-25% |
| guards vs off: world population at 2000; median capital wealth | within ±5%; within ±30% |
| runtime vs off | ≤ +3% |
| **(rev 2, money on vs money off)** | |
| polity-year price level q05 / q99 | ≥ 0.12 / ≤ 4 [M at 2000: q10 0.13-0.61, q90 0.57-1.25; seed 42 nears the floor late (deflation, 8)] |
| polity-years at the pMin/pMax clamp | < 1% [M: 0.01-0.54%] |
| yearly inflation q99 | 3-8% [M: 4.2-8.0%]; limiter-binding polity-years < 2% [A] |
| Boom with a stateful zone: zone-median P at +25 y / before; own polity's lead at +10 y over the zone median | ≥ 1.15; > 0 [M seed 7: 1.20, lead 0.16; seed 1234 zone 1.31] |
| real value of a 50-year-old fixed claim, q05 / q95 | 0.55-0.8 / 1.3-1.7 [M: 0.61-0.72 / 1.47-1.59] |
| share of crown coin income from land tax, 1500-2000 vs money off (fixed quotas erode in inflation, gain in deflation) | within ±25% (informational sign by seed) |
| Debasement (FIN.debase on): debaser P / zone median at +20 y | ≥ 1.1 |
| Debasement: the debaser's real land-tax yield 20 years later / at debasement (no reassessment in between) | ≤ 0.9 |
| Debasement: rate of new foreign loans within 20 y minus before | ≥ +3 points |
| finSFD: median over monetised polity-years; mean in the 10 years before a CrownDefault / median | 0.8-1.3; ≥ 2 |
| finSFD: Spearman with Revolt counts in the next 20 years per polity-decade (informational, for society) | report |
| guards money on vs off: CrownDefault count, WarBankrupt share, revolts (Taxes) | within ±25%; within the rev-1 bands |
It also reports (informational) income composition by era (duties, land tax, tribute, plunder, royalties), the top 10 debtors, and a timeline of defaults.

---

## 7. Performance and memory
- Per year: one loop over the living settlements to sum members' rings and pop (O(living), a few thousand). It can be skipped when no polity is monetised.
  One loop over relations (O(R)) for maxR. Per alive polity (tens), a lender scan: members' marts (from `ps.memList`) plus open-leg partners (O(legs)).
  Deposits O(dCount). Estimated **< 1% of a ~32 s run** [A: measure in step 6, target ≤ 3%].
- History bytes (P ≈ 70-120 polities a run [M: 70-85 on seeds 1, 42], 401 snapshots): 4 Float32 + 2 Uint8 = 18 B · P · 401 ≈ **0.5-0.9 MB**.
  Loans: shadow probe had 17-39 borrowing polities. With accounts per lender, expect 100-400 accounts × 46 B ≈ 20 KB, plus loanBalance 400 × 201 trade snapshots × 4 B ≈
  **0.3 MB**. Events: a few hundred.
- State: per polity ~25 arrays × pcap; accounts in JS arrays. Negligible.
- (rev 2) Money: per year one union-find over s.count + |openList|, one pass over the living settlements (bullion and demand per zone and polity), and one over
  the open routes (partner weights). That is about 3 × a few thousand operations with no allocation. SFD is O(1) per polity. History: priceLevel Float32 + wageLag and
  fiscalDistress Uint8 = 6 B · P · 401 ≈ **0.2-0.3 MB**. State: ~20 Float64 per polity, plus 3 arrays × s.count of scratch (Int32 + 2 Float64 ≈ 20 B · count ≈ 0.1-0.2 MB).

---

## 8. Risks and open questions
- **Capital wealth drift**: diverting duties into the treasury changes capital prosperity, migration and tariff need. Spend-back (home 0.8) is meant to keep it close;
  the guard in section 6 checks it. If it drifts, raise `home` or credit court spending to `income[cap]` before settle (same year).
- **Lumpy duties**: duties are booked every 5 years (flushAccounts). The treasury jumps then, while expenses are yearly. The reserve absorbs this, but a 4-year dry spell can
  show arrears in a poor realm at war. Mitigation: book flushed duties into a pending pool released 1/ACCOUNTS a year [A: decide in step 3 by looking at ArmyUnpaid timing].
- **Feedback loop**: bankruptcy shortens wars, which raises reserves, which raises the declaration drive, which brings more wars. The chestMul and afterDefault knobs balance this. Watch war counts.
- **Shadow-ledger numbers are without feedback**: the war-share targets may need warAtt in 0.5-0.9.
- **The Family path depends on merchant-families phase 2** (`FAMILY.feedback`). Until then only Pool lenders exist. LenderKind.Family is reserved.
- **Merchant cap**: loans are out of `mw`, so the `maxHead` cap does not see them. A house can hold more than 120 a head in total assets. Accept, or count `expo` against the cap [A].
- **Conqueror inheriting debts**: v1 drops them (Lost), except for absorption and reunification. Historically, conquerors sometimes honoured them. This is open.
- **Grain realms**: R° ≈ 0 means no constraint. If the harness shows big grain empires never constrained, add an in-kind part (grain worth FIN.loadWorth · taxIn) to R° and war cost [A].
- **City-states** may want a government type to change dsMax and repudiation odds as well as rateMul. Add those setters when that plan lands.
- **Event id coordination**: 210-219 settled with the coordinator (oaths 190-199, city-states 200-209, families 161-169).
- **(rev 2) Secular deflation**: without credit money or a rising velocity, world S/D falls 1500 → 2000 on three seeds of four [M], so the late world is
  in a slow "bullion famine". Fixed claims gain, debtors lose, and the real land tax rises between reassessments. That is defensible for a specie
  economy, but unlike the modern era. Option, not in v1: `V = 1 + vCredit · min(1, (Σ merchant capital + crown debt in zone) / (worth_T · zD))`, so bills of exchange
  economise on bullion. It would multiply P* and stay bounded by the limiter [A].
- **(rev 2) Weak price revolution**: a bonanza gives ×1.2-1.5 over 25-50 years in its zone [M], against ×3-4 over a century or more historically (Hamilton 1934 for Spain; Kugler & Bernholz via Wikipedia) [corrected from ×2-4 in the citation audit]. The size of the rise comes from goods' bullion
  stock. Finance's pLag, pDiff and κ shape only its timing and spread. The levers are the bonanza yield or `STOCK.treasureWear`, which are goods' parameters
  (goodsStats T13 depends on them). Coordinate with goods; do not change them from this plan.
  The monetarist reading of the price revolution is itself contested (Goldstone 1984; Outhwaite 1969 review): population pressure explains much of it.
  The model gets that part only through society's Malthusian wage, if society multiplies by finWageLag (0.5).
- **(rev 2) Stateless mine sinks**: on seeds 1 and 1234 the Boom's sink was stateless [M], so its bullion counts only toward its zone, not toward a polity. That is fine for P;
  PricesRose names the sink anyway.
- **(rev 2) ts.demand lifetime**: assumed still to hold this year's market values at fiscalYear. If anything resets it (tourism provision or migration), read it in a
  `finMarketTap` hook at the end of trade instead [A].
- **(rev 2) Patronage loop strength**: court is about 0.3 R°, and o_p up to about 3 makes it 1.6× (+0.18 R° a year). Structural deficits then lead through borrowing
  to default within decades in indebted realms. Watch CrownDefault counts with society on (the guard row in 6).
- **(rev 2) SFD's relation to the credit stain**: stain is left out of finSFD because society adds its own trust term. If society later drops sfdAsab
  (their open question 6), it could add `+ 0.3 · min(1, stain / 2)` here instead. That is a one-line change.
- `relR` max rivalry is recomputed inside tariffStep but not stored. Finance recomputes it (cheap) rather than reusing it.

### Verified vs assumed
**[V]**: every file and function reference in section 1; no EventType ≥ 182 in contract.ts (so 210-219 is free); the 5 duty booking sites and their two-statement form; taxSystem, tributeFlows and conquer plunder lines; the single
declaration draw and the single tired draw; WAR.poor as the only money effect on war; `HistoryState` nullable-system pattern; the golden filters' style; event ranges in use (0-19, 20-49, 50-65,
66-79, 80-97, 100-105, 110, 120-123, 130, 140-146, 150-151, 160, 170-173, 180); oaths' 190-199, city-states' 200-209 and families' 161-169 claims (from their plan files); `g.dOut`, `g.dWorker`, `GOODS.value`; `MERCHANT` params; the RevoltCause values;
the politiesPanel tariffSpark and setViewModeAvailable patterns; HISTORY_DEFAULTS (snapshot 5, trade 10, land 20).
(rev 2) [V] also: trade.ts real per-settlement prices with no numeraire; `g.held`/`ts.demand` for Treasure and the DEMAND.treasure form (market.ts ~l.191-216);
`STOCK.treasureWear 0.02`; deposits.ts mineYear output, depletion and the Boom rule; `ts.openList`, `rA/rB`, `rVol`; society-secular-cycles.md 0.2's finSFD contract,
its proxy and its patronage amendment; the `_CONVENTIONS.md` enum registry.
**[M]**: section 1.6 magnitudes (seed 42); 1.7 shadow ledger (seeds 1, 7, 42, 1234); run time about 32 s a seed. (rev 2) 1.8 money probe (seeds 1, 7, 42, 1234).
(rev 2) **[A]**: every money, Gresham and SFD default beyond the probed pLag/pDiff/κ/piMax; Cambridge k read from the existing Treasure demand; debt/R° standing in for debt/GDP;
the ts.demand lifetime; the money layer's cost; the historical magnitudes (Spain checked against a review of Hamilton 1934; England unverified). Turchin's SFD form was checked against the 2013 original in the citation audit
(2026-11-26) and agrees with Stachowiak & Pasek's restatement.
**[A]**: all parameter defaults beyond the shadow calibration; the acct key packing; render/longhaul.ts arc reuse; the families api (from their plan, not code);
city-states' econ.ts call sites; grudges' `record` signature and `GrievanceKind.CrownDefault = 7` (an amendment they must accept); perf < 1%; the behaviour of the pending-duty mitigation.

## Addendum (from court-politics.md §0.4)
court-politics.md (built last) requests interface additions from this plan — read its §0.4 before implementing this plan, and add the listed functions/hooks as no-op stubs if court-politics is not yet built.

## References
Citation audit 2026-11-26 (per `_CONVENTIONS.md` "Citation rule"). [verified] = a page confirming the citation was opened; [unverified] = not confirmed, reason given.
**Design defaults:** every `FIN.*` parameter, every stats-harness target (section 6) and every [A] number is a design default, not a fact from
outside work; [M] numbers are measurements of this sim. Only the items below are attributed to outside work.

- Fisher, I. (1911). *The Purchasing Power of Money*. New York: Macmillan. https://www.econlib.org/library/YPDBooks/Fisher/fshPPM.html [verified: author, year, publisher; the "equation of exchange" in Fisher's notation MV = PT]
- Fisher, I. (1930). *The Theory of Interest*. New York: Macmillan. https://www.econlib.org/library/YPDBooks/Fisher/fshToI.html [verified: bibliographic data; used for the Fisher premium]
- Fisher, I. (1933). The Debt-Deflation Theory of Great Depressions. *Econometrica* 1(4): 337-357. https://doi.org/10.2307/1907327 [verified]
- Pigou, A. C. (1917). The Value of Money. *Quarterly Journal of Economics* 32(1): 38-65. https://doi.org/10.2307/1885078 [verified; Cambridge equation M = kPY]
- Hume, D. (1752). Of the Balance of Trade. In *Political Discourses*, Edinburgh. https://en.wikipedia.org/wiki/Of_the_Balance_of_Trade [verified: 1752 and the price-specie flow mechanism; the collection name was not shown on the page opened]
- Macleod, H. D. (1858). Naming of "Gresham's law". https://en.wikipedia.org/wiki/Gresham%27s_law [verified via that page (Selgin: 1858; the lead says 1857); the title of Macleod's book, *The Elements of Political Economy*, is unverified]
- Hamilton, E. J. (1934). *American Treasure and the Price Revolution in Spain, 1501-1650*. Cambridge, MA: Harvard University Press. https://doi.org/10.4159/harvard.9780674332157 ; magnitudes from the EH.net review, https://eh.net/book_reviews/american-treasure-and-the-price-revolution-in-spain-1501-1650/ [verified: silver index 98.98 (1511-15) to 343.36 (1646-50), ×3.47; vellón ×4.61]
- Fischer, D. H. (1996). *The Great Wave: Price Revolutions and the Rhythm of History*. New York: Oxford University Press. ISBN 978-0195053777. https://en.wikipedia.org/wiki/The_Great_Wave_(book) [verified: bibliographic data and dating c. 1470-1590; no magnitudes on the page opened]
- Kugler, P. & Bernholz, P., as cited in Wikipedia, "Price revolution", https://en.wikipedia.org/wiki/Price_revolution (accessed 2026-11-26): "annual inflation rate ranged from 1% to 1.5%", prices 3-4 times higher by the century's end [unverified: the primary work was not identified or opened]
- Goldstone, J. A. (1984). Urbanization and Inflation: Lessons from the English Price Revolution of the Sixteenth and Seventeenth Centuries. *American Journal of Sociology* 89(5): 1122-1160. https://doi.org/10.1086/227986 [verified: bibliographic data; the abstract was paywalled, so its population/velocity argument is taken from the title and the literature]
- Outhwaite, R. B. (1969). *Inflation in Tudor and Early Stuart England*. London: Macmillan. https://doi.org/10.1007/978-1-349-00698-4 [verified]
- Spufford, P. (1988). *Money and its Use in Medieval Europe*. Cambridge: Cambridge University Press. ISBN 9780521375900 (paperback 1989). https://ideas.repec.org/b/cup/cbooks/9780521375900.html [verified]
- Sargent, T. J. & Velde, F. R. (2002). *The Big Problem of Small Change*. Princeton: Princeton University Press. https://doi.org/10.1515/9781400851621 [verified]
- Rolnick, A. J. & Weber, W. E. (1986). Gresham's Law or Gresham's Fallacy? *Journal of Political Economy* 94(1): 185-199. https://doi.org/10.1086/261368 [verified: bibliographic data; the paraphrase of their argument was not checked against the text]
- Goldstone, J. A. (1991). *Revolution and Rebellion in the Early Modern World*, pp. 141-145 (the Political Stress Indicator). Berkeley: University of California Press. [verified via Turchin 2013, which cites "Goldstone (1991: 141-145)"; the publisher was not checked]
- Turchin, P. (2013). Modeling Social Pressures Toward Political Instability. *Cliodynamics* 4(2): 241-280. https://doi.org/10.21237/C7clio4221333 [verified: SFD = Y·D/G (state debt Y, GDP G, distrust D); multiplicative Ψ]
- Stachowiak, T. & Pasek, Z. (2024). Political Stress Index of Poland. arXiv:2405.01163 [physics.soc-ph] (v3, Oct 2025). https://arxiv.org/abs/2405.01163 [verified: Ψ = MMP·EMP·SFD attributed to Goldstone 1991; SFD = y·D after Turchin 2013]
- Turchin, P. (2003). *Historical Dynamics: Why States Rise and Fall*. Princeton: Princeton University Press. https://press.princeton.edu/books/hardcover/9780691116693/historical-dynamics [verified: bibliographic data and its modelling of collective solidarity; the page does not name asabiya, so that link is unverified]
- Hotelling, H. (1931). The Economics of Exhaustible Resources. *Journal of Political Economy* 39(2): 137-175. https://doi.org/10.1086/254195 [verified]
- Krautkraemer, J. A. (1998). Nonrenewable Resource Scarcity. *Journal of Economic Literature* 36(4): 2065-2107. https://ideas.repec.org/a/aea/jeclit/v36y1998i4p2065-2107.html [verified: abstract says "Observed data are often inconsistent with the Hotelling rule"]
- Narron, J. & Skeie, D. (2013). Crisis Chronicles: The "Not So Great" Re-Coinage of 1696. *Liberty Street Economics*, Federal Reserve Bank of New York, 30 Sep 2013. https://libertystreeteconomics.newyorkfed.org/2013/09/crisis-chronicles-the-not-so-great-re-coinage-of-1696/ [verified: monetary contraction and credit strain; no price series]

Claims left without a source: the England price-revolution magnitude (1.8), "customs kept pace with prices while fixed rents and quotas did not" (2.4.1),
and "credit matters from the high middle ages on" (1.7). Each is tagged in place.
