# Plan: Social structure and secular cycles (classes, wages and rents, elite overproduction, Ψ)

Status: PLAN ONLY, written against the read-only checkout `/home/claude/ryanmye/worldseed` at commit 8cabf09.
Marks: **[V]** read in that tree (file:function named). **[M]** measured on the scratch copy `/home/claude/scratch-society`
(probe `probe-society.ts` at its root, Node 22.23 with `--experimental-strip-types`, default options, 2000-year runs, about 115-135 s
a seed with probe overhead, two seeds at a time on 2 cores). **[A]** assumed, or a design choice not yet checked against code.
EventType block: **240-249** (240-246 used, 247-249 spare).

Depends on: polities (required). Rulers, disease, religion, goods are optional and only make the inputs better.
Sibling plans (build order grudges → finances → families → city-states → this): **state-finances.md** (SFD; optional, with a proxy),
**merchant-families.md** (mobility label; optional), **city-states.md** (urban pressure into risings; optional),
**riots-uprisings.md** (280-289, in progress: it owns everything below the revolt, see 0.5). Every coupling has a proxy fallback,
so this plan can land right after polities and rulers.

---

## 0. Interfaces

### 0.1 Event ids and enum values
| range | owner |
|---|---|
| 161-169 families · 190-199 oaths · 200-205 city-states · 210-219 finances · 220-229 battles · 230-239 beliefs | others |
| **240-249** | **society (this plan; 240-246 used)** |
| 280-289 | riots-uprisings |

**RevoltCause clash (found while reading, needs a decision):** state-finances.md 2.5 adds `RevoltCause.Taxes: 5` and city-states.md 3.1
adds `RevoltCause.Burghers: 5`. Both cannot be 5. Proposed resolution, in build order: **Taxes 5 (finances), Burghers 6 (city-states),
Urban 7 (this plan)**. City-states must renumber. This plan only needs the next free value; it reads `RevoltCause.Urban` by name.

### 0.2 What this plan reads from state-finances.md (SFD)
The coordinator says `finSFD(p)` is being added to state-finances.md now. It was **not in the file when I read it** (grep for
`finSFD`/`SFD` found nothing, 17:44 version). So I state the contract I need. If their signature differs, only `society/inputs.ts` changes:
```ts
/** Fiscal distress of p's crown, >= 0, 1 = an ordinary realm in ordinary times (e.g. debt / R° over FIN.needDebtLow, plus arrears). The fiscal part only: no trust or legitimacy term (society multiplies its own asabiya term, see 2.5). */
finSFD(s, p): number
```
- **Proxy when finances is off or not built** [A]: `fisc = 1 + 0.6·min(1, pExh) + 0.5·[year − R.lost[p] ≤ 10] + 0.3·[inCrisis] + 0.4·max(0, o_p − 1)`.
  The last term is how elite overproduction strains a crown: more claimants for offices and pensions.
- **Amendment to state-finances 2.4.2 (proposed, only when `s.soc !== null`)**: `court ×= clamp(0.7 + 0.3·o_p, 0.7, 1.6)`.
  An overproduced elite costs the crown more in patronage. This is the EMP→SFD link in Turchin's model, and it closes the loop
  through finances' own default and arrears machinery. With society off the factor is skipped, not multiplied by 1.

### 0.3 What this plan reads from merchant-families.md and city-states.md
- Families (8.2, names unchanged): `topFamilyAt(s, town)` and `familyCapitalAt(s, town)`. They are used **only to name** an Ennobled event (245).
  The mobility flow itself reads the pool `mw` (goods/merchants.ts). Families only divide that pool, so outcomes are identical with families
  on or off. This is the same rule city-states 9.3 uses, and it is not feedback. With `FAMILY.feedback` on, the named family also gets
  `fCourt[f] = p` (their field). That is optional and is their decision.
- City-states (4.4, proposed amendment): in the rising chance, multiply `· (1 + SOC.cityRise · socUrban(s, p))` (SOC.cityRise 1, socUrban 0..1, see 0.4).
  It stays one draw. This is a multiplier on their single draw; skip it when `s.soc === null`.

### 0.4 What this plan exposes (`src/sim/history/society/api.ts`, all O(1), RNG-free, valid from the first step after founding)
For riots-uprisings.md, city-states.md, the UI and the harness:
```ts
/** Political stress indicator Ψ = MMP · EMP · SFD of polity p (1 = reference; ~0.3 calm .. 6+ breakdown); 0 for p < 0 or ended. */
psi(s, p): number
/** Its three factors (each 1 at reference). */
mmp(s, p): number; emp(s, p): number; sfd(s, p): number
/** Settlement-level mass pressure: MMP of p with the local terms swapped in. A town (>= TOWN_POPULATION) uses the urban wage and its own crowding; a village uses its own pop / foodBase. 0 when stateless. */
mmpAt(s, id): number
/** Real wage index of p's peasants (1 = subsistence), of its townsfolk, rent index (1 = reference), coercion κ 0..1, elite share ε, elite overproduction o (ε / ε*). */
socWage(s, p); socUrbanWage(s, p); socRent(s, p); socCoercion(s, p); socElite(s, p); socOverprod(s, p): number
/** Urban pressure 0..1 = smoothstep(1, 2, MMP_urban) · u / (u + 0.1): for city-states 0.3 and riots-uprisings. */
socUrban(s, p): number
/** Secular phase (SecularPhase) and smoothed disorder D 0..1 (the share of this realm's recent years with internal violence, 2.6). */
socPhase(s, p): number; socDisorder(s, p): number
```
Without `s.soc` (system off), callers must not call these. Each caller guards with `s.soc !== null`, which is the codebase pattern [V: index.ts header, `s.x !== null` hooks].

### 0.5 Boundary with riots-uprisings.md (coordinator's scope note)
That plan owns the sub-revolt layer: the escalation ladder, thresholds, preference falsification, food riots, contagion waves, repression
and army defection, and the political causes. **This plan owns only the slow structural pressure** (classes, wages and rents, elites, Ψ) and the
hooks where that pressure meets the **existing** revolt-level machinery (unrest.ts, civil.ts, rulers). This plan specifies no riot mechanics.
- Riots-uprisings should read `psi`, `mmp`, `emp`, `sfd`, `mmpAt`, `socUrban` and `socWage` (0.4) as its structural "fuel".
- If riots-uprisings later routes revolts through its ladder, the revolt-chance multiplier `socRevoltMul` (2.7 h1) **moves into their
  ladder as an input**. It must not be applied twice. The rule: whoever calls `revolt()` applies Ψ once. Until that plan lands, h1 lives in revoltStep.
- Food riots are theirs. This plan's urban term (h2) is only the slow wage-and-crowding grievance of townsfolk at the revolt level.

---

## 1. Current behaviour

### 1.1 Relevant mechanics [V]
- **Population** (population.ts `populationSystem`): logistic, `pop += growth(0.018) · pop · (1 − pop / supply)`. Famine deaths are 0.5 of the shortfall.
  `supply = expected · harvest · harvestLeft(ps, id)` (war ravage). `foodBase(s, id) = expected + max(0, foodImport)` (migration.ts) is
  "the food it can count on". So **carrying capacity per settlement is `supply`/`foodBase`**. There is no global K.
- **Crowding already drives grievance** (unrest.ts `grievance`): the peasant term is `famine + crowding(0.2) · smoothstep(0.85, 1, pop / foodBase) + badTax`.
  Terms are grouped `[peasant, provincial, ethnic, colonial, religious]`, and `causeOf` takes the largest (strict `>`, k < 5).
- **Asabiya** (unrest.ts `cohesionStep`, every POLITY.step = 5 years): on frontiers `a += 5 · 0.03 · a(1 − a)` (× 1.5 on a steppe frontier), elsewhere `a −= 5 · 0.005 · a`.
  The realm's `pAsab` is the population-weighted mean (control.ts `controlOne`). It scales mass `M = A · Σ b g`. It also drives the crisis chance
  (realmStep without rulers: `0.15 + 0.3(1 − A) + 0.1·multi`), rulers' contested-succession chance (`SUCCESSION.cohesion · (1 − A)`),
  civil war without a crisis (civil.ts `lowCohesion`: `A < 0.3`, chance `5 · 0.01 · (1 − A/0.3)`), and fragmentation (`A < acrit 0.06` in a crisis).
  The step events are war won +0.03, capital lost −0.05, crushed −0.05.
- **Revolt** (unrest.ts `revoltStep`): a member with `unrest ≥ 0.55` rises with chance `UNREST.chance 0.06` per step. That is **one `ps.rng` draw**,
  and the outcome is a second one, `rb²/(rb² + sup²)`. A crushed revolt costs 3% pop, 30% wealth and exhaustion +0.1.
- **Civil war**: rulers `contested()` (rulers/system.ts ~l.551) opens a SuccessionCrisis of U(crisisMin, crisisMax) years (one R.rng draw). Then civil war
  follows with chance `SUCCESSION.civil · (1 + members / sizeCrisis)` (one draw), or else partition (one draw). Without rulers it is civil.ts `crisisOpened`.
  Overthrow (rulerYear ~l.440) is `overthrow(0.012) · max(0, 1.05 − ability) · (1 + E + crisis + 2·lostWar)`, one draw.
- **Disease** (disease/system.ts ~l.715-750): a struck settlement loses `actRate` a year, and `econ *= 1 − min(0.35, labour · r)`.
  After the outbreak a fed settlement regains `DZ.rebound = 0.03` of the gap a year. Unrest rises by `1.2 · toll`.
  GreatEpidemic (67) means at least 5% of its network killed. CityStricken (69) has `extra` = the expected share of the city to die.
- **Wealth** (trade.ts settle): `wealth = 0.98 · wealth + income`, so `0.02 · wealth` ≈ a year's income, in loads (a person-year of grain at worth 1; see state-finances 1.1).
  Merchant capital is `g.ext.merch.mw[id]`.
- **Religion**: `rel.org[f]` is how organised a faith's church is, and `polityFaith`. **No class, wage, rent or elite notion exists anywhere.**

### 1.2 Baseline instability and Malthusian pressure [M] (probe-society.ts; seeds 1, 7, 42, 1234; 2000 years)
Instability index per year: Revolt ×1, SuccessionCrisis ×1, CivilWar ×3, Partitioned ×2, ReignEnded Overthrown/Deposed ×1.
Each is attributed to the polity at the event (value or `ps.polity[other]`) and to the weather region of its settlement.

| seed | Revolt | Crisis | CivilWar | Partition | Overthrown/Deposed | polities ≥ 400 y | mean per-polity ACF (decadal, ±250 y detrend) lag 10 / 15 / 20 / 25 dec | regions ≥ 60 events: band 150-350 y p ≤ 0.05 (100 shuffles) |
|---|---|---|---|---|---|---|---|---|
| 1 | 458 | 239 | 14 | 4 | 14/13 | 24 | −0.02 / +0.02 / −0.03 / −0.03 | 1 of 2 |
| 7 | 460 | 173 | 15 | 7 | 11/10 | 16 | −0.03 / −0.04 / −0.08 / −0.01 | 0 of 3 |
| 42 | 568 | 211 | 17 | 3 | 9/6 | 15 | −0.05 / −0.06 / −0.01 / −0.01 | 1 of 4 |
| 1234 | 625 | 187 | 10 | 3 | 7/12 | 17 | −0.03 / −0.06 / −0.06 / −0.06 | 0 of 0 |

**The baseline instability is white noise at secular scales.** Per-polity ACF is within ±0.08 at every lag from 50 to 350 years. The
two "significant" regions (seed 1 r1 p = 0.04, seed 42 r43 p = 0.02) are what 2 hits among 9 tests at α = 0.05 would look like by chance.
Weather regions are too fine: only 0-4 per seed reach 60 events. **The harness therefore uses per-polity series as its primary test** (section 6).

Malthusian pressure, `c = pop / foodBase`, population-weighted over polity members:
- **c is compressed and stationary**: the world mean is 0.65-0.83 in every century on every seed. Per long-lived polity, the 50-year values
  range about 0.55-0.90 (outliers 0.44 and 1.04). Emigration and colonist founding (migration.ts) hold c down well before `supply`.
  So the sim has no "population piles up against the ceiling" phase on its own. [M]
- **Epidemics barely move c.** Seed 1234 had 3 polity-level city strikes with toll ≥ 0.08. Mean c was 0.753 five years before, 0.720
  five years after, then 0.750 / 0.739 / 0.755 at +20/+40/+80 years. Seed 42 had none with toll ≥ 0.08. GreatEpidemics are 0-3 a century worldwide.
  Two reasons: the labour hit lowers `econ` and so `expected` (K falls with L), and the rebound plus logistic growth refill the gap in ~20 years. [M]

**Consequences for the design:**
1. Wages must be computed against a **slow land capacity K̄** (an EMA of foodBase that ignores the year's labour loss), not against the same year's foodBase.
2. The sim's crowding range is narrow, so the wage elasticity has to be steeper than Cobb-Douglas's ½ (Cobb & Douglas 1928 form; ½ is a design default for the land share). This is a calibration, and is tagged so.
3. The MMP channel will be modest. **The cycle has to come mainly from elite dynamics (EMP) plus an internal-disorder feedback on K.**
   This matches Turchin's own emphasis in later work (Turchin 2023, *End Times*: elite overproduction is "the common theme" of
   past crises, with the "wealth pump" named as the root cause, per a 2023 interview), but it is a model choice and is stated as one.
4. Brenner-type outcomes will be rare (few deep epidemics). The labour-scarcity trigger is therefore generic: any fall of c below its slow level,
   whether from plague, war, famine or disorder. Epidemics are the headline cause, but not the only one.

---

## 2. Design

### 2.1 Principle and sources
Per **polity** (keep it cheap: tens alive), every POLITY.step (5 years), compute four classes and their incomes from things the sim
already has (pop, foodBase, towns, wealth, mw, church organisation, crown revenue). Evolve two slow state variables: **elite share ε** and
**coercion κ**. Form Ψ. Feed it as multipliers into the **existing single draws** of revolt, civil war, contested succession and overthrow. Add one
feedback on carrying capacity (disorder). Instability thins elites. The loop is: elites multiply in good times and do not shrink except through
violence or very slowly → overproduction → competition, fiscal strain, lost cohesion → violence → thinning and depopulation → recovery.
That is the structural-demographic cycle.

Sources (cite in code comments; marked where from memory):
- Goldstone, J. A. (1991) *Revolution and Rebellion in the Early Modern World*, pp. 141–145: the Ψ = MMP · EMP · SFD decomposition (Goldstone 1991, as credited in Turchin 2013).
- Turchin, P. (2003) *Historical Dynamics*, ch. 7 "The Demographic-Structural Theory" and ch. 8 "Secular Cycles in Population Numbers";
  Turchin & Nefedov (2009) *Secular Cycles*: the four phases (expansion, stagflation, crisis, depression/intercycle), elite overproduction, the
  "fathers-and-sons" (bigenerational) 40-60-year cycle inside disintegrative phases, and periods of roughly two to three centuries (the book's
  eight case cycles span about 160-335 years by their chapter dates; a review summarises them as ~300 years) (Alexander 2019, secondary). **Contested**: the periodicity is found in a selected set of agrarian states, and critics dispute both how regular it is and the fitting.
  Treat 150-350 years as a loose target, not a law.
- Turchin, P. (2013) "Modeling social pressures toward political instability", *Cliodynamics* 4(2): MMP = w⁻¹ · N_urb/N · A₂₀₋₂₉;
  EMP = ε⁻¹ · E/(sN); SFD = (Y/G) · D, with D the public distrust of state institutions (≈ 1 − trust T); Ψ = MMP · EMP · SFD (Turchin 2013).
  **Note:** in Turchin 2013, ε is the *relative elite income* and e = E/N the elite numbers; this plan's ε (elite share) and o = ε/ε* are its own
  design, not Turchin's notation.
- Brenner, R. (1976) "Agrarian class structure and economic development in pre-industrial Europe", *Past & Present* 70:30-75; the Brenner debate
  (Aston & Philpin eds. 1985). The same demographic shock gave serfdom's end in the West and a "second serfdom" in the East, depending on class power.
- Domar, E. (1970) "The causes of slavery or serfdom: a hypothesis", *J. Econ. Hist.* 30(1):18-32: free land, free peasants and non-working landowners cannot all coexist.
- Malthusian wage and land (Malthus 1798): Clark (2007) *A Farewell to Alms*; Ashraf & Galor (2011) *AER* 101(5). The textbook form is Cobb-Douglas (Cobb & Douglas 1928) with land.
- Asabiya: Turchin (2003, ch. 3-4; 2006 *War and Peace and War*). It is already in the sim. This plan **reads and modifies** `ps.asab`. It adds no second cohesion variable.

### 2.2 State (`src/sim/history/society/state.ts`), one object literal, `HistoryState.soc: SocietyState | null`
Grown with `ps.P` by doubling (`ensureSocPolities`, like rulers' `ensureRulerPolities`):
```ts
export interface SocietyState {
  pcap: number
  /** Slow land capacity: EMA of Σ foodBase over members (loads a year), rate SOC.kRate a year; reset to the sum at founding. */
  kBar: Float64Array
  /** Commoners (Σ pop), urban share (people in members >= TOWN_POPULATION / Σ pop), trade income a head (0.02 · Σ wealth / L, loads). */
  pop: Float64Array; urb: Float64Array; trade: Float64Array
  /** Population every step for the last SOC.ring steps (youth bulge, lagged elite income): ring[p * RING + k], head in ringAt. */
  ring: Float64Array; oRing: Float64Array; ringAt: number
  /** Elite share of the people (0..SOC.epsMax), coercion (0..1), clergy share. */
  eps: Float64Array; kappa: Float64Array; cler: Float64Array
  /** Last computed indices (for hooks and snapshots): peasant and urban real wage, rent, o = ε/ε*, MMP, EMP, SFD, Ψ, urban pressure. */
  w: Float64Array; wU: Float64Array; rent: Float64Array; o: Float64Array
  mmp: Float64Array; emp: Float64Array; sfd: Float64Array; psi: Float64Array; urbP: Float64Array
  /** Smoothed wage (LabourDear trigger), disorder D (0..1), violence memory M (fathers-and-sons), labour-scarcity drive. */
  wSm: Float64Array; dis: Float64Array; mem: Float64Array; scar: Float64Array
  /** This step's weighted instability count (filled by the yearly event scan); elite peak and its year (EliteThinned); phase and since. */
  instY: Float64Array; ePeak: Float64Array; ePeakYear: Int32Array; phase: Uint8Array; phaseSince: Int32Array
  /** Hysteresis flags: 1 serf regime (kappa crossed serfOn), 1 factions declared; last LabourDear and Ennobled years. */
  serf: Uint8Array; fact: Uint8Array; lastDear: Int32Array; lastNoble: Int32Array
  /** Mobility accumulator (elite share bought in since the last Ennobled event). */
  mobAcc: Float64Array
  evSeen: number
  // --- snapshots: ragged per polity like polity/assemble.ts tariff (row-major S · P at assembly) ---
  snW: Uint8Array; snWU: Uint8Array; snRent: Uint8Array; snPsi: Uint8Array; snMMP: Uint8Array; snEMP: Uint8Array; snSFD: Uint8Array
  snEps: Uint8Array; snUrb: Uint8Array; snCler: Uint8Array; snKappa: Uint8Array; snPhase: Uint8Array
  diag: SocietyDiag
}
```
There is **no RNG stream**: every rule is deterministic, and every stochastic effect rides an existing single draw (3.2). The name
`'history-society'` is reserved in the index.ts stream list for a later version. It is not created in v1, so there is no draw order to fix.
This deviates from the convention ("own named RNG stream") because v1 needs no draws, and adding one would only create a stream nobody draws from.

### 2.3 Params (`society/params.ts`, `export const SOC`, one doc comment per line in codebase style; all [A] unless noted)
| name | default | meaning |
|---|---|---|
| enabled | false → true at step 10 | HistoryOptions.society default |
| kRate | 0.05 | K̄ += 5·kRate·(Σ foodBase − K̄) per step (20-year memory: land does not vanish when hands die) |
| cRef | 0.80 | crowding at which the peasant wage is subsistence (≈ p75 of measured polity crowding 0.55-0.90 [M]) |
| eta | 1 | output a head ∝ (cRef K̄ / L)^η. **Calibration**: Cobb-Douglas land would be ½. η = 1 because the sim's crowding range is compressed [M 1.2] |
| alpha | 0.5 | labour share of farm output (design default; Cobb-Douglas form, Cobb & Douglas 1928) |
| chi | 0.4 | at κ = 1 lords take chi of the peasants' share by coercion (labour services, fixed wages) |
| urbPrem, urbShare | 1.3, 0.5 | urban wage = urbPrem · w · (1 + urbShare · ι / (ι + 1)) / (1 + crowd premium, below) |
| urbCrowd | 0.5 | urban real wage ÷ (1 + urbCrowd · max(0, ĉ − 1)) (bread dearer when the land is full) |
| tithe, clergy0 | 0.06, 0.008 | tithe share of farm output · (0.5 + org_f); clergy share of the people = clergy0 · (0.5 + org_f) (no religion: 0.5 + 0.5) |
| urbTake, office | 0.3, 0.5 | elite share of trade income ι; share of crown revenue spent on offices (finRevenue, else 0.02·wealth[cap]) |
| e0 | 40 | customary income of an elite head in loads (≈ 40× subsistence) → ε* ≈ 2-3% at reference |
| eps0, epsNew, epsMax | 0.02, 0.6, 0.12 | elite share at reference; a new state (Formed/League) starts at epsNew · ε*; hard cap |
| gUp, gFloor, gDown, lagSteps | 0.02, 0.004, 0.01, 4 | yearly ε growth `gUp·max(0, 1 − o_lag) + gFloor − gDown·max(0, o − 1)`, o_lag 20 years back (a generation) |
| mob, mobHalf | 0.002, 2 | yearly upward mobility from trade: `mob · ι / (ι + mobHalf)` (merchants buying land and titles) |
| thinRevolt, thinCrisis, thinCivil, thinOverthrow, thinPartition, thinLost, thinFrag | 0.03, 0.02, 0.15, 0.02, 0.05, 0.03, 0.2 | ε *= 1 − thin per event (2.6) |
| factionTake | 0.3 | a civil war's pretender polity starts at ε_parent · (1 + factionTake); the parent keeps ε (thinCivil applies) |
| uRef, mmpUrb | 0.15, 1.5 | urb factor = clamp(1 + mmpUrb · (u − uRef), 0.6, 2) |
| youthRef, mmpYouth | 0.05, 1 | youth = clamp(1 + mmpYouth · max(0, g₂₀ago) / youthRef, 1, 2); g₂₀ago = L(t−20)/L(t−40) − 1 |
| empAsab, aRef | 0.8, 0.4 | EMP = o · clamp(1 + empAsab · (aRef − A), 0.5, 1.6) (cohesive elites compete less) |
| sfdAsab | 0.6 | distrust factor (1 − T) ≈ clamp(1 + sfdAsab · (aRef − A), 0.6, 1.5) |
| mLow, mHigh, psiHalf | 0.5, 3.0, 1.6 | hazard multiplier m(Ψ) = mLow + (mHigh − mLow) · Ψ² / (Ψ² + psiHalf²) (m(1) ≈ 1.2) |
| memGain, memKeep, memDamp | 0.15, 0.87, 0.6 | violence memory M += memGain · inst per step; M *= memKeep per step (half-life ≈ 25 y); hazard ×(1 − memDamp · min(1, M)) |
| disGain, disKeep, disorder | 0.08, 0.8, 0.25 | D = disKeep · D + disGain · inst (clamped 1); supply × (1 − disorder · D) |
| erode | 0.02 | asabiya erosion a year: a −= erode · max(0, EMP − 1) · a (elite infighting) |
| immis, coerceGrief, urban | 0.25, 0.3, 0.35 | grievance terms (2.7 h2) |
| eliteLead | 0.5 | rebels' strength × (1 + eliteLead · min(1, max(0, EMP − 1))) (disaffected elites lead) |
| civilPsi, contest, overthrow, crisisPlus | 1, 0.15, 1, 10 | 2.7 h3-h5 |
| scarLow, scarHigh | 0.85, 0.65 | labour-scarcity drive = smoothstep(scarLow, scarHigh, ĉ) |
| kUp, kDown, kRate2, serfOn, serfOff | 0.6, 0.15, 0.1, 0.5, 0.2 | coercion (2.4) |
| dearRise, dearGap | 1.3, 50 | LabourDear when w / wSm ≥ dearRise (at most every dearGap years) |
| psiLow, psiHigh, dLow | 0.9, 1.8, 0.1 | phases (2.8) |
| factOn, factOff | 1.5, 1.1 | EliteFactions hysteresis on EMP |
| thinEvent | 0.3 | EliteThinned when ε ≤ (1 − thinEvent) · peak within 40 years |
| nobleAcc | 0.002 | Ennobled when mobAcc ≥ nobleAcc (then mobAcc = 0) |
| cityRise | 1 | city-states amendment (0.3) |

### 2.4 Rules per polity p (societyStep, every POLITY.step; polities ascending in `ps.alive`)
One pass over `s.living` accumulates members' `pop`, `foodBase`, the town pop, `wealth` and `mw` (scratch arrays indexed by polity). Then per p:
```
L  = Σ pop;  K̄ += 5·kRate·(Σ foodBase − K̄);   ĉ = L / (cRef · K̄)              (ĉ = 1: Malthusian reference)
y  = (1/ĉ)^η / α            output a commoner, loads (η = 1: 1/(α ĉ); at ĉ = 1 the wage α·y = 1 = subsistence)
ι  = 0.02 · Σ wealth / L     trade income a head (loads)
q  = clergy0 · (0.5 + org_f);   τ = tithe · (0.5 + org_f)
w  = α·y·(1 − chi·κ)·(1 − τ)                                    peasant real wage (1 = subsistence)
wU = urbPrem · w · (1 + urbShare · ι/(ι + 1)) / (1 + urbCrowd · max(0, ĉ − 1))
r  = (1 − α)·y + α·y·chi·κ                                       agrarian rent + coerced take, a commoner
σ  = r + urbTake·ι + office·Rev_p / L − τ·y                       elite surplus a commoner (Rev_p: finRevenue or 0.02·wealth[cap])
ε* = σ / (σ + e0)                                                 share the surplus supports at the customary standard
o  = ε / ε*;   rent index = r / ((1 − α)/α)                        (1 at reference)
```
**Elites** (per step, with Δt = 5, as a product, no pow):
```
γ   = gUp·max(0, 1 − o_lag) + gFloor − gDown·max(0, o − 1) + mob·ι/(ι + mobHalf)     o_lag = oRing 4 steps back (else o)
ε  ← clamp(ε · (1 + 5γ), 0.002, epsMax);   mobAcc += 5·mob·ι/(ι + mobHalf)·ε
```
Without violence ε settles at `o* ≈ 1 + gFloor/gDown = 1.4`. **Overproduction is the steady state, and only violence or very slow decline resets it.**
That asymmetry is the core SDT claim. With growth from o ≈ 0.6 at about 0.6-1%/yr, the build-up takes about 80-140 years, and the crisis and
depression add about 50-100 years. So the cycle should come out at roughly 150-250 years [A: tune gUp/gFloor in step 7].

**Coercion κ (Brenner 1976; Domar 1970)**:
```
scar  = smoothstep(scarLow, scarHigh, ĉ)                          labour scarce (Domar's "free land")
λ     = A_p · (1 − 0.5·u) · (0.5 + 0.5·min(1, o))                 lords' power: cohesion of the class, towns as escape ("town air makes free", the medieval maxim; uncited), a numerous elite
π     = 0.3 + 0.4·(1 − κ) + 0.3·min(1, revoltsWon_p in 50 y / 2)  peasants' power: free communities organise; a won rising
κ*    = scar > 0 ? clamp(κ + kUp·scar·(λ − π), 0, 1) : κ·(1 − kDown)
κ    += kRate2·5·(κ* − κ)                                         (clamped 0..1)
```
Read it like this. When hands are scarce, lords try to bind them. If λ > π they succeed (second serfdom: wages are held down, so w stays low
despite scarcity). If π > λ coercion collapses (serfdom erodes: wages rise to market). When land is full, coercion decays, because the market
already gives rents (Domar). Events: SerfdomImposed when κ rises through serfOn (serf 0 → 1); SerfdomEnded when it falls through serfOff (1 → 0).
A failed reimposition (scar > 0.5, λ < π, κ falling) raises the grievance via `coerceGrief` (h2): the 1381 pattern (the English Peasants' Revolt; illustrative, uncited).

**LabourDear**: `wSm += 0.1·5·(w − wSm)`. When `w ≥ dearRise·wSm` and `year − lastDear ≥ dearGap`, log 241 with `extra = w / wSm`.
`other` is the settlement of the latest GreatEpidemic or CityStricken among the members within 10 years, else −1. The chronicle then says "after the pestilence".

**Clergy**: share q, income τ·y·(1 − ε − q)/q. This is for the UI only in v1: no clerical overproduction term [open question 9].

### 2.5 Ψ
```
imm   = clamp(1 / w, 0.3, 4)
urbF  = clamp(1 + mmpUrb·(u − uRef), 0.6, 2)
youth = clamp(1 + mmpYouth·max(0, L(t−20)/L(t−40) − 1)/youthRef, 1, 2)          (ring buffer; youth = 1 until 40 years of history)
MMP   = imm · urbF · youth
EMP   = o · clamp(1 + empAsab·(aRef − A_p), 0.5, 1.6)
SFD   = (s.fin ? finSFD(s, p) : fisc_proxy) · clamp(1 + sfdAsab·(aRef − A_p), 0.6, 1.5)
Ψ     = MMP · EMP · SFD
m(Ψ)  = (mLow + (mHigh − mLow)·Ψ²/(Ψ² + psiHalf²)) · (1 − memDamp·min(1, M))       hazard multiplier, used by h1, h3-h5
```
Asabiya enters twice (elite cooperation, trust in the crown) and is eroded in return (h6). It is integrated, not duplicated.
The `memDamp` factor is the "fathers-and-sons" refractory period: a generation that saw the killing is slow to start it again (Turchin & Nefedov 2009).
`mmpAt(id)`: the same as MMP with `imm = 1/wU` and its own `pop/foodBase` crowding for a town, or its own crowding in place of ĉ for a village.

### 2.6 Instability accounting, thinning and disorder (socYear: yearly event scan from `soc.evSeen`, after rulerYear)
Weights: Revolt 1, Seceded after a revolt 1, SuccessionCrisis 1, CivilWar 3, Partitioned 2, ReignEnded extra Overthrown/Deposed 1, PolityEnded Fragmented 3.
Attribution uses the same rules as the probe (value = polity, or `ps.polity[other]` for revolts and civil wars). `instY[p] += weight`, and
ε is thinned at once by the matching `thin*` (revolt thinning only for a won revolt: a Seceded or Defected in the same year at that seat;
crushed revolts kill rebels, not lords). CivilWar: parent `ε *= 1 − thinCivil`; the new polity q gets `ε_q = ε_p·(1 + factionTake)`
(the disaffected faction left with the pretender). A PeaceMade of a war p lost (ps.wOutcome, as merchant-families reads it) applies thinLost.
Per step: `D = min(1, disKeep·D + disGain·instY)`, `M = memKeep·M + memGain·instY`, then `instY = 0`.
**Disorder on K** (population.ts foodSystem, at the harvestLeft site): `supply *= 1 − disorder·D_{polity[id]}` for members.
This is Turchin's point that a failing state lowers effective carrying capacity (insecurity, abandoned fields) (Turchin 2003, ch. 7; chapter not re-read). Pop follows supply down, so
c falls and wages rise in the depression. It must be a separate guarded branch: with `s.soc === null` the old expression stays exactly.

New polities (`socNewPolity` in `newPolity`, before the rulers hook): K̄ = Σ foodBase of its members (set after setPolity in the callers, so it
is done lazily at the next step: `kBar = 0` means initialise); ε = parent ≥ 0 ? ε_parent (CivilWar: × (1 + factionTake)) : epsNew·eps0;
κ = parent's or 0. Absorption, conquest and reunification move people, not ε: the realm's ε stays, because conquered elites are displaced or absorbed. That is acceptable at this grain.

### 2.7 Hooks into existing code (every one `s.soc !== null ? new : old`; each keeps the single existing draw)
| id | site | change |
|---|---|---|
| h1 | unrest.ts `revoltStep` | `rng.next() >= U.chance · m(Ψ_p)` (moves into riots-uprisings' ladder when that lands, 0.5) |
| h2 | unrest.ts `grievance` | peasant += `immis · max(0, 1/w − 1) + coerceGrief · κ · scar · [λ < π]`; new `terms[6] = urban · max(0, 1/wU_p − 1) + urban · max(0, ĉ_town − 1)` for members ≥ TOWN_POPULATION. `causeOf` loops k < 7 → RevoltCause.Urban. terms[5] is finance's Taxes (0 without it); with society off terms[6] stays 0, and strict `>` leaves the old choice |
| h2b | unrest.ts `revolt` | `rb ·= 1 + eliteLead · min(1, max(0, EMP − 1))` before the win draw |
| h3 | civil.ts `crisisOpened`, `lowCohesion`; rulers `contested` | civil-war chance `· (1 + civilPsi · max(0, m(Ψ) − 1))` (one draw each) |
| h4 | rulers `succession` contested chance; realmStep (rulers off) crisis chance | `+ contest · min(1, max(0, EMP − 1))`; crisis length: `crisisMax + floor(crisisPlus · min(1, max(0, EMP − 1)))` inside the same draw expression |
| h5 | rulers `rulerYear` overthrow | `x ·= 1 + overthrow · min(1, max(0, EMP − 1))` (ambitious magnates) |
| h6 | unrest.ts `cohesionStep` (after the existing update) | `asab[i] = clampAsab(asab[i] − 5 · erode · max(0, EMP_p − 1) · asab[i])` for members (elite infighting rots asabiya → lowCohesion civil war, acrit fragmentation) |
| h7 | population.ts `foodSystem` | disorder on supply (2.6) |
| h8 | finances court cost; city-states rising | amendments 0.2, 0.3 |

### 2.8 Secular phase (labels for the UI and events; deterministic, with hysteresis)
`SecularPhase = { Expansion: 0, Stagflation: 1, Crisis: 2, Depression: 3 }` (Turchin & Nefedov's four phases; Turchin & Nefedov 2009).
- Expansion → Stagflation when `o ≥ 1` and `Ψ ≥ psiLow`.
- Any phase → Crisis when `Ψ ≥ psiHigh` or `D ≥ 0.5`.
- Crisis → Depression when `Ψ < psiHigh` and `D < 0.5`.
- Depression → Expansion when `Ψ < psiLow` and `D < dLow`.
- Stagflation → Expansion when `o < 0.9`.

Only entries into Crisis and the return to Expansion are logged (240). That is about 2 events a cycle per polity.

### 2.9 Contract additions (`src/contract.ts`), drafted in codebase style
```ts
  // society: classes, wages and rents, elites and the secular cycle (240-249; none when HistoryOptions.society is false).
  SocialPhase: 240, // the polity `value` ruled from `settlement` entered a secular phase: `extra` the phase (SecularPhase: 2 a crisis of the social order, 0 a new expansion); `other` -1
  LabourDear: 241, // labour grew dear in the polity `value` ruled from `settlement` (its people fewer than its land wants): `other` the settlement of the epidemic that thinned it, or -1; `extra` the rise of the real wage (2 = doubled)
  SerfdomImposed: 242, // the lords of the polity `value` ruled from `settlement` bound its peasants to the land (labour scarce, the lords strong); `other` -1; `extra` the coercion now (0..1)
  SerfdomEnded: 243, // the peasants of the polity `value` ruled from `settlement` threw off their bondage (labour scarce, the lords weak); `other` -1; `extra` the coercion before (0..1)
  EliteFactions: 244, // the great families of the polity `value` ruled from `settlement` divided into factions (too many for the offices and lands; History.society elite share); `other` -1; `extra` the elite pressure (EMP, 1 = reference)
  Ennobled: 245, // merchants of `settlement` bought land and titles among the nobility of the polity ruled from `other`: `value` the merchant family (History.families), -1 for the town's merchants; `extra` the elite share bought in (a share of the people)
  EliteThinned: 246, // the nobility of the polity `value` ruled from `settlement` was thinned by its wars and risings: `other` -1; `extra` the share of it lost since its peak (0..1)
```
```ts
/** society: phase of a polity's secular cycle (Turchin & Nefedov's four phases; History.society.phase). */
export const SecularPhase = { Expansion: 0, Stagflation: 1, Crisis: 2, Depression: 3 } as const
export const RevoltCause = { …, Urban: 7 } // (society: townsfolk rising over dear bread and low wages; see 0.1 on 5 and 6)
```
History fields (all empty, length 0, when society is off). Row-major `x[s · polities.length + id]` per snapshot like `tariff`, 0 outside the polity's life:
```ts
// society: classes and the secular cycle (all empty when HistoryOptions.society is false).
/** Real wage of each polity's peasants and townsfolk per snapshot, 0..255 for 0..4 (64 = subsistence). */
socWage: Uint8Array; socUrbanWage: Uint8Array
/** Rent index (1 = reference), same 0..255 for 0..4. */
socRent: Uint8Array
/** Ψ and its factors MMP, EMP, SFD, 0..255 for 0..8 (32 = 1). */
socPsi: Uint8Array; socMMP: Uint8Array; socEMP: Uint8Array; socSFD: Uint8Array
/** Shares of the people: elites 0..255 for 0..0.128, townsfolk 0..255 for 0..1, clergy 0..255 for 0..0.032; coercion 0..255 for 0..1. Peasants are the rest. */
socElite: Uint8Array; socUrban: Uint8Array; socClergy: Uint8Array; socCoercion: Uint8Array
/** Secular phase (SecularPhase; 255 outside the polity's life). */
socPhase: Uint8Array
```
HistoryOptions: `/** society: classes, wages and rents, elite overproduction and political stress (Ψ) feeding revolts, civil wars and successions (needs polities). Default true; false leaves the society fields empty and the history exactly the one without them. */ society?: boolean`.
HistoryDiagnostics: `society?: SocietyDiag` (counts per event kind; per-step `Ψ, instability` pairs for the harness; thinning totals).
`history.test.ts` event switch +240-246; `worker.ts` transfer list +12 arrays [V: merchant-families notes the list near worker.ts l.176].

---

## 3. Step order and determinism

### 3.1 Placement [V: polity/system.ts politySystem order]
- Yearly: `socYear(s, ps, soc)` (event scan, thinning, instY) **after rulerYear** in politySystem, so this year's crises and overthrows are counted.
- Every POLITY.step: `societyStep` **after cohesionStep, before unrestStep** (controlPass has refreshed members and pAsab; grievance and revolts read this step's Ψ).
  h6 erosion runs inside societyStep, right after cohesionStep's update, in the same `s.living` order.
- foodSystem reads `soc.dis` (last step's value). Snapshots go in `socSnapshot` after polSnapshot; assembly in `assembleSociety(soc, P, S)` /
  `emptySocietyHistory()`. Created in createRunner after `rul` (and after `fin` when it exists): `pol && (options?.society ?? SOC.enabled) ? createSociety(s) : null`.

### 3.2 Determinism
- No draws of its own. Every hook multiplies a probability **inside an existing single draw**, so draw counts per call site are unchanged.
  (Downstream counts change only because outcomes change, which is allowed with the system on.)
- Fixed orders: `ps.alive` ascending, `s.living` order, and the event scan in log order. Arithmetic is `+ − * / sqrt` only: η = 1 avoids pow, and squares are products.
- Prefix-stable: everything is causal per step, appended only.
- **Off identity**: `s.soc === null` → every hook takes the old expression. Test: `society: false` gives the same as 8cabf09 (+ earlier plans' steps)
  on every History field except the new empty ones, at 42:1200, 3:600, 9:800 n=24, and the existing goldens are unchanged.
- **Shadow mode** (step 2): `SOC.effects = false` computes and snapshots everything but applies no hook. Society on equals society off on every
  pre-existing field. This test is real while it holds; it is dropped at step 4 with a commit note (as grudges-and-oaths 3.8 does).
- Hash filters: every golden hash function skips the `soc*` keys and events 240-249 (like the 120-129/140-149 filters).

---

## 4. UI

### 4.1 Data (`ui/societyData.ts`; loaded in politiesData like `tariff`, length check ≥ S·P)
`wageAt, urbanWageAt, rentAt, psiAt, factorsAt, sharesAt (peasants, townsfolk, clergy, elites), coercionAt, phaseAt(pd, p, snap)`, and
`phaseSpans(pd, p)` (runs of equal phase). PolityEvent entries 240-246.

### 4.2 Society view (Factions detail, `ui/politiesPanel.ts`, a "Society" block under the finance line; hidden without data)
- **Class bar**: a 100%-wide stacked bar of peasants / townsfolk / clergy / elites at the cursor year. Tooltip:
  `Peasants 86% (wage 1.3× bread) · townsfolk 11% · clergy 0.9% · nobility 2.4% (38× a peasant)`.
- **Line**: `Wages high and rising · rents falling · stress Ψ 0.7 (calm) — expansion since 1430`, with variants such as `serfs bound to the land since 1388`
  and `nobles divided into factions (1512)`.
- **Chart** (canvas 200×48, the tariffSpark style ~l.543): wage (green), rent (amber) and Ψ (red, own scale, dashed line at 1).
  Background bands by phase (crisis pale red, depression grey, expansion none, stagflation pale amber). Ticks for 241/242/243/246.
  There is a cursor at the year. Tooltip: `Wages, rents and political stress over its life (stress peaked at 3.1 in 1486)`.
  A small toggle "Ψ parts" swaps in MMP/EMP/SFD.
- A **world chart** in the history view (optional, step 9b): the mean Ψ of the five largest polities, for a quick look at cycles.

### 4.3 Chronicle (`ui/polityFormat.ts`; category 'politics'; new filter group "Society" in chronicleFilter.ts)
- 240 Crisis: `The social order of Vashtar falls into crisis` · Expansion: `Vashtar enters a new age of growth`
- 241 `After the pestilence, labour grows dear in Vashtar (wages up by half)`
- 242 `The lords of Vashtar bind the peasants to the land` / 243 `The peasants of Vashtar are free of their bondage`
- 244 `The great families of Vashtar divide into factions` / 245 `House Veckin of Oruma buys its way into the nobility of Vashtar` (no family: `The merchants of Oruma …`)
- 246 `Vashtar's nobility is thinned by its wars (a third of the great families gone)`
- Revolt with RevoltCause.Urban: `The townsfolk of Oruma rise against Vashtar` (polityFormat l.379 switch).

Headlines: 240 (crisis), 242, 243, 246. Group 245 per polity per 50 years.

### 4.4 Sagas (`ui/sagas/society.ts`: phrase table SOC_T, used by state.ts, year.ts, city.ts, world.ts)
Chronicle register: plain for recorded facts, **hedged for every causal reading** (cycles and causes are inferences): "it seems", "by some accounts", "it is said".
Legend register: heightened and certain. Numbers are rounded.
| key | chronicle | legend |
|---|---|---|
| socCrisis | From about 1480 the realm of Vashtar seems to have had more lords than lands to give them, and the quarrels of the great houses, by most accounts, opened its troubles. | In 1480 the sons of the great houses were too many for the halls of Vashtar, and they turned their swords on one another. |
| socDear | After the pestilence of 1347, it is recorded, hands were few in Vashtar and a labourer could ask twice the old wage. | The plague passed, and the fields of Vashtar called for reapers who were not there; the poor man named his price. |
| socSerf | In 1352 the lords of Vashtar bound their peasants to the land; the old freedoms, it seems, did not return for two centuries. | In 1352 the lords of Vashtar put the yoke on the ploughman's neck, and his sons and their sons wore it. |
| socFree | By 1390 bondage had ended in Vashtar; the lords, by some accounts, could no longer hold men who could find better masters. | In 1390 the chains of Vashtar rusted through, and no lord could forge them again. |
| socThinned | The wars of 1480-1520 left the nobility of Vashtar, it is said, a third fewer. | Of every three great houses that rode to war in 1480, two came home. |
| socEnnobled | House Veckin, merchants of Oruma, bought land and a title in 1601. | In 1601 the silver of the Veckins bought them a crest and a manor, and the old lords sneered and bowed. |
| socCycle (state saga, ≥ 2 crises) | Its history, read at a distance, rose and fell in long tides: growth, then crowding, then strife, about every two centuries. | Three times Vashtar grew fat, and three times it bled; so turns the wheel. |
| socCalm (≥ 300 years without a crisis) | It knew, as far as the records tell, no great breakdown of its order. | Its lords and peasants kept the peace for three hundred years. |

Year saga: one sentence for the greatest crisis entry in the span. Epithets (legend only, epithets.ts): a ruler under whom SerfdomEnded happened → "the Liberator";
SerfdomImposed → "the Binder".

---

## 5. Ordered commit-sized steps
Each step: `npm test` and `npm run typecheck` green; goldens unchanged until step 10.
1. **Contract and plumbing**: contract.ts (240-246, SecularPhase, RevoltCause.Urban, History fields, HistoryOptions.society, diag), society/params.ts (`enabled: false`),
   assemble `emptySocietyHistory`, index.ts wiring, hash filters in every golden test (polity, goods, disease, tourism, renaming, ideas, orders, cradleWish, rulers,
   and the earlier plans' new ones), history.test.ts switch, worker.ts transfers. Tests: goldens unchanged.
2. **State, classes and Ψ in shadow mode**: society/state.ts, system.ts `societyStep`/`socYear` with `SOC.effects = false`, inputs.ts (finSFD or proxy,
   finRevenue or proxy, religion org), snapshots, assembly, api.ts (0.4). societyStats.ts skeleton. Tests: shapes; indices finite and in clamp ranges; prefix stability (1200→1500
   vs 1500); a hand-built two-polity state checks w, r, ε*, o, Ψ against hand values; **society-on equals society-off on all pre-existing fields**.
3. **Elite dynamics and thinning** (still shadow): ε update, event scan, thinning, factions on civil war, memory, disorder accumulators, phases, events 240, 244, 245, 246.
   Tests: 246 only after ≥ 1 weighted event in the 40 years before; a 245 family id is alive and seated at `settlement` (families on); phase transitions follow 2.8.
4. **Effects h1-h6**: the revolt mul, grievance terms + RevoltCause.Urban + polityFormat words, rebels' strength, civil-war, contested and crisis-length, overthrow, asabiya erosion.
   The shadow test is dropped (commit note). Tests: with Ψ forced to 1 and memory 0, h1-h5 multipliers equal `m(1)`; the off hash is unchanged.
5. **Disorder on K (h7)**. Tests: supply ≤ the old supply for members; equal for non-members.
6. **Coercion (Brenner)**: κ, scar, λ, π, events 241-243, the coerceGrief term. Tests: a unit test with a hand state: scarce labour with λ > π raises κ, λ < π lowers it; an
   SerfdomImposed/Ended alternation needs hysteresis (no two in 10 years).
7. **Tune with societyStats (section 6)**: gUp, gFloor, gDown, thin*, mLow/mHigh/psiHalf, disorder, memDamp. Record the tuned table in params doc comments.
8. **Amendments for siblings** (when they exist): finances court factor (0.2) and finSFD; city-states rising mul (0.3); families naming of 245. Each is guarded and off-identity tested in both plans.
9. **UI**: societyData, the Society block (bar, line, chart, Ψ-parts toggle), chronicle lines, the Society filter. 9b (optional): world Ψ chart.
10. **Flip `SOC.enabled = true`**: re-record goldens with the documented check ("with society false the tree is bit-identical on every History field in every
    off configuration at 42:1200, 3:600, 9:800 n=24"); update the index.ts header (systems; the reserved stream), the polity/system.ts and unrest.ts headers; add a society-on golden.
11. **Sagas**: society.ts phrase table, state/year/world sentences, epithets. Saga tests: both registers fill every slot.

---

## 6. Stats harness (`src/sim/history/society/societyStats.ts`)
Run with `node --experimental-strip-types src/sim/history/society/societyStats.ts [seed …] [--no-ab]` (default seeds 1, 7, 42, 1234). Each seed is run on and off (A/B).
Instability index as in 1.2 (port probe-society.ts). **Periodicity tests**:
- (P1, primary) For polities that live ≥ 400 years: decadal instability series, detrended with a ±25-decade moving mean; ACF at lags 5-35 decades, averaged over polities.
- (P2) Per polity, the intervals between successive SocialPhase-Crisis entries.
- (P3) Per polity, a periodogram band share for 150-350 years against 100 shuffled surrogates from a fixed LCG. Report the share of polities with p ≤ 0.05; 5% is expected by chance.
- (P4, secondary) The same for weather regions with ≥ 60 events. Few qualify [M], so this is informational.

| measure | baseline (off) [M] | target (each of seeds 1, 7, 42, 1234) |
|---|---|---|
| P1 mean ACF: minimum over lags 7-17 dec | −0.03 … −0.08 | ≤ −0.12 |
| P1 mean ACF: maximum over lags 15-35 dec, after that minimum | ≤ +0.03 | ≥ +0.08 |
| P3 share of long-lived polities with band p ≤ 0.05 | ~0.05 (chance) | ≥ 0.25 |
| P2 median interval between crisis entries | n/a | 150-350 y (design band; Turchin & Nefedov 2009 cycles span ~160-335 y) |
| crisis phases per 1000 polity-years (≥ 400 y polities) | n/a | 3-6 |
| Spearman(Ψ at a step, instability in the next 25 y), all polity-steps | n/a | ≥ 0.25 |
| elite share ε: median / p90 over polity-steps | n/a | 1.5-4% / ≤ 8% |
| wage after a ≥ 8% population loss to disease in 10 y (median w(+10)/w(−5)) | n/a | ≥ 1.2 (on seeds with ≥ 3 such events; report the count) |
| Brenner: share of LabourDear episodes that end in κ up vs κ down | n/a | both outcomes on ≥ 2 seeds; sign(λ − π) predicts the outcome ≥ 80% |
| revolts with cause Urban | 0 | 3-15% of revolts |
| guards vs off: revolts, civil wars, successions contested | (1.2 table) | ±25%, ±35%, ±25% |
| guards vs off: polities alive at 1500 / 2000, largest share, world pop 2000 | — | ±20%, ±20%, ±5% |
| runtime vs off | ~115-135 s with probe; bench 14-22 s | ≤ +2% |

It also reports (informational): per-polity timelines (Ψ, w, ε, phase per 25 years) for the five longest-lived polities, the elite share by era, and the event counts.
**If P1/P3 miss**, first raise the contrast `mHigh/mLow` and `thinCivil`, then `gFloor`. If periods come out too short, lower `gUp`.
If the targets still cannot be met, report the best achieved and say the cycle is weak. **Do not fit the targets by adding a clock**: no explicit oscillator is allowed.

---

## 7. Performance and memory
- Per step: one pass over `s.living` (a few thousand settlements) into per-polity scratch sums; O(alive) formulas; the h6 erosion runs in the same member pass.
  Yearly: an event scan of new events (tens a year). Hooks: O(1) lookups. foodSystem: one multiply-add per member settlement a year when on.
  Estimate **< 0.5% of a run** (< 100 ms of 14-22 s) [A: bench in step 7 with perf-scripts/bench-sim.ts].
- History: 12 Uint8 · P (70-85 [M]) · 401 snapshots ≈ **0.3-0.4 MB**. Events: ~1-2k (mostly 240).
- State: ~30 per-polity typed arrays plus a 2 × 8 ring per polity. Negligible.

---

## 8. Risks and open questions
1. **No cycle emerges, or it is drowned by territorial churn.** Polities are short-lived and change shape (1.2: 15-24 live ≥ 400 years). The ε and κ of a realm go
   with the realm, not the land. Mitigation: the primary test is per long-lived polity, and successors inherit ε. If the churn still dominates, store ε per settlement (as asab is)
   and aggregate. That costs about 3 arrays × N, still cheap [A].
2. **Too much instability**: m(Ψ) at the stationary o* ≈ 1.4 raises all baselines. The guard targets catch it. Lower gFloor or raise psiHalf.
3. **Feedback runaway**: disorder → famine → crowding falls → wages up → MMP down is stabilising. EMP → erosion of asabiya → lowCohesion → more
   civil war → thinning is also self-limiting. But fragmentation (`acrit`) could rise. Watch fragmentations and polity counts.
4. **The Malthusian channel is weak by construction** [M 1.2]. The cycle is mostly elite-driven. Raising η beyond 1 needs pow or repeated multiplication (fine for integer η = 2). Decide in tuning.
5. **Rebound vs Black Death**: disease's 3%/yr rebound refills epidemic losses in ~20-30 years, much faster than history's: England fell from
   4.81 M in 1348 to 2.50 M by 1377 and was still only 2.83 M in 1541, so recovery took well over 190 years (Broadberry, Campbell & van
   Leeuwen n.d.; the earlier "~100-150 years" was wrong). Wages spike briefly, so
   coercion must act within ~20 years to matter. Optional: slow DZ.rebound when society is on (an amendment to disease, not done here).
6. **finSFD's real form is unknown** (0.2). If finances defines SFD with its own trust term, drop `sfdAsab` here to avoid double counting.
7. **RevoltCause numbering** (0.1) must be settled between finances and city-states before either builds.
8. **Riots-uprisings overlap** (0.5): h1 and h2's urban term must move into or be read by their ladder, not stack with it. Coordinate when that plan is written.
9. Clergy as a competing elite (clerical overproduction, Goldstone's university graduates (Goldstone 1991; unverified page)), and a theocracy link to city-states: left out of v1.
10. Elites of conquered lands: v1 keeps the conqueror's ε, so conquest neither creates nor destroys elites. A "displaced nobility" term is a possible follow-up.
11. The 1.2 instability weights are arbitrary [A]. The harness uses the same weights on and off, so comparisons are fair.

### Verified / measured / assumed
**[V]**: population.ts logistic and `supply`, `foodBase`, harvestLeft site; unrest.ts grievance terms, causeOf strict loop, revoltStep single draw, revolt win draw, cohesionStep
formula; COHESION and UNREST constants; civil.ts crisisOpened and lowCohesion draws; rulers contested/crisis-length draw and overthrow formula (~l.440, ~l.551); disease labour, rebound
0.03 and unrest 1.2; events 30-37, 67, 69, 80, 81 semantics; RevoltCause 0-4; TOWN_POPULATION 3000; politySystem step order; nullable-system pattern; no `finSFD` in state-finances.md
as read; the RevoltCause 5 clash between finances and city-states.
**[M]**: section 1.2 table (seeds 1, 7, 42, 1234): event counts, ACFs, region tests, crowding range and stationarity, epidemic crowding response (seed 1234; none on 42).
**[A]**: every SOC default; the elasticity η = 1; the forms of λ and π; the cycle-length estimate; the finSFD signature; perf. (The Turchin 2013 factor forms are now checked; see References.)

## References
Citation audit 2026-11-26. [verified] = a publisher, index, catalogue or author page was opened and confirmed the entry; notes
say what it did not confirm. Every SOC parameter, the η = 1 elasticity, the λ/π forms, ε* and e0 ≈ 40× subsistence, the cycle-length
estimate (150-250 y) and all harness targets are design defaults or [M] probe measurements, not sourced facts.

- Alexander, S. (2019). Book review: *Secular Cycles*. Slate Star Codex. https://slatestarcodex.com/2019/08/12/book-review-secular-cycles/ [verified; secondary source for the phase names, the 40-60-year fathers-and-sons cycle and the ~300-year summary]
- Ashraf, Q. & Galor, O. (2011). Dynamics and stagnation in the Malthusian epoch. *American Economic Review* 101(5):2003-2041. https://econpapers.repec.org/RePEc:aea:aecrev:v:101:y:2011:i:5:p:2003-41 [verified]
- Aston, T. H. & Philpin, C. H. E. (eds.) (1985). *The Brenner Debate: Agrarian Class Structure and Economic Development in Pre-Industrial Europe*. Cambridge Univ. Press. https://doi.org/10.1017/CBO9780511562358 [verified]
- Brenner, R. (1976). Agrarian class structure and economic development in pre-industrial Europe. *Past & Present* 70:30-75. https://en.wikipedia.org/wiki/Brenner_debate [verified via the Wikipedia reference; the West/East "second serfdom" contrast confirmed there; no DOI checked]
- Broadberry, S., Campbell, B. M. S. & van Leeuwen, B. (n.d., working paper). English medieval population: reconciling time series and cross sectional evidence. Univ. of Warwick. https://warwick.ac.uk/fac/soc/economics/seminars/seminars/conferences/venice3/programme/english_medieval_population.pdf [verified: 4.81 M (1348), 2.60 M (1351), 2.50 M (1377), 2.83 M (1541)]
- Clark, G. (2007). *A Farewell to Alms: A Brief Economic History of the World*. Princeton Univ. Press. https://en.wikipedia.org/wiki/A_Farewell_to_Alms [verified]
- Cobb, C. W. & Douglas, P. H. (1928). A theory of production. *American Economic Review* 18(1, Suppl.):139-165. JSTOR 1811556. https://www.jstor.org/stable/1811556 [verified via the Wikipedia reference]
- Domar, E. D. (1970). The causes of slavery or serfdom: a hypothesis. *Journal of Economic History* 30(1):18-32. https://econpapers.repec.org/RePEc:cup:jechis:v:30:y:1970:i:01:p:18-32_07 [verified]
- Goldstone, J. A. (1991). *Revolution and Rebellion in the Early Modern World*. Berkeley: Univ. of California Press. https://www.cambridge.org/core/journals/journal-of-economic-history/article/revolution-and-rebellion-in-the-early-modern-world-by-jack-goldstone-berkeley-and-los-angeles-university-of-california-press-1991-pp-xxix-608-1700-paper/F3FB42C0DE7A029645E2A8779951AF2F [verified; PSI at pp. 141-145 per Turchin 2013; the university-graduates point is unverified]
- Malthus, T. R. (1798). *An Essay on the Principle of Population*. London: J. Johnson. https://en.wikisource.org/wiki/An_Essay_on_the_Principle_of_Population [verified]
- Turchin, P. (2003). *Historical Dynamics: Why States Rise and Fall*. Princeton Univ. Press. https://press.princeton.edu/books/hardcover/9780691116693/historical-dynamics [verified; chapter titles from the 2018 reissue's table of contents, https://muse.jhu.edu/book/58326]
- Turchin, P. (2006). *War and Peace and War: The Life Cycles of Imperial Nations*. Pi Press. https://www.publishersweekly.com/9780131499966 [verified]
- Turchin, P. (2013). Modeling social pressures toward political instability. *Cliodynamics* 4(2):241-280. https://doi.org/10.21237/C7clio4221333 [verified; MMP, EMP, SFD and Ψ forms read from the PDF, https://escholarship.org/uc/item/6qp8x28p]
- Turchin, P. (2023). *End Times: Elites, Counter-Elites, and the Path of Political Disintegration*. Penguin Press. https://www.publishersweekly.com/9780593490501 [verified; the "common theme" vs "wealth pump" wording is from a Niskanen Center interview, https://www.niskanencenter.org/are-we-overproducing-elites-and-instability/]
- Turchin, P. & Nefedov, S. A. (2009). *Secular Cycles*. Princeton Univ. Press. https://muse.jhu.edu/book/30171 [verified (table of contents and case-cycle dates); the phase names and the fathers-and-sons cycle were confirmed only through Alexander 2019]
- Uncited, labelled in the text: "town air makes free" (a medieval maxim) and the 1381 Peasants' Revolt (an illustration) [unverified: no source opened]

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **Owner of `polity/aggregates.ts`** (MASTER-PLAN D-dup 9): one O(living) pass per `POLITY.step` that court, MIR, FP and migration read instead of their own passes.
- **Interim owner of C2's hazard multiplier** (h1) until riots lands. Then `socRevoltMul` is the only multiplicative revolt-hazard term (Ψ once).
- Causal UnrestPart **25 Immiseration** and **26 Coercion** record the two h2 additions to the peasant term (R36).
- Feedback F8 (the secular cycle) is an intended oscillation. Test: period 150–250 y and Ψ p90 < 6.
