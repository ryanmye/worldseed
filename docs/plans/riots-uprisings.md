# Plan: Riots, protests and uprisings (the escalation ladder below revolt; contagion waves; repression; political causes and ideologies)

Plan only. Code: read-only checkout `/home/claude/ryanmye/worldseed` @ 8cabf09. Probes ran on the scratch copy
`/home/claude/scratch-riots` (`probe-riots.ts`, `proto/gran.mjs`; run with `node --experimental-strip-types`).
Tags: **[V]** verified in code, **[M]** measured, **[A]** assumed / to be tuned. Citations were checked on 2026-11-26; see References for
which are [verified] and which are not.

- **EventType block 280–289** (this plan; added to the `_CONVENTIONS.md` block list in 0.1).
- **RevoltCause 8–15** (registry): Tyranny 8, Conscription 9, Hunger 10, Persecution 11, Usurpation 12, Ideology 13, Mutiny 14, 15 reserved.
- **OrderKind 30–32** (new: Crackdown, Relief, Tolerate). Seat-mode's Placate 17, Purge 18, Levy 20 and Charter 21 are reused (0.7).
- Off switch `HistoryOptions.uprisings`. RNG stream `'history-uprisings'`. Module `src/sim/history/uprisings/`.
- Depends on: polities (required). Rulers, religion, goods, finances, city-states, society, families, grudges, beliefs and disasters are
  optional. Each has a proxy (section 0). Build order: after grudges → finances → families → city-states; society can come before or after.

---

## 0. Interfaces (one contract for the implementer)

### 0.1 Ids and enums
| what | values | owner |
|---|---|---|
| EventType | **280–289** (Uprising 280 … Wave 289, 5.2) | this plan. Conventions list: families 161–169, grudges 190–199, city-states 200–205, finances 210–219, battles 220–229, beliefs 230–239, society 240–249, language 250–259, disasters 260–269, seat/orders 270–279, **riots 280–289** |
| RevoltCause | 8 Tyranny, 9 Conscription, 10 Hunger, 11 Persecution, 12 Usurpation, 13 Ideology, 14 Mutiny, 15 reserved | this plan. 5 Taxes is finances', 6 Burghers city-states', 7 Urban society's |
| ReignEnd | **9 Revolution** (a crowd and its soldiers drove the ruler from the capital) | proposed for the registry (no one else claims ReignEnd values) |
| GrievanceKind | **11 KinAttacked** (proposed; 0–6 grudges, 7 finances, 8–10 beliefs) | needs registry approval |
| OrderKind | **30 Crackdown, 31 Relief, 32 Tolerate** | this plan (others start at 30, per seat-mode) |

### 0.2 Society (`society-secular-cycles.md` 0.4/0.5) — where Ψ enters, exactly once
Society's rule: "whoever calls `revolt()` applies Ψ once". With `s.up !== null`, **revoltStep is not called** (4.10), so society's h1
(`U.chance · m(Ψ)` inside revoltStep) is never applied. My ladder takes it over in **one place only**:

- **Ψ enters only the spark base rate**: `μ_i = λ0 · D_i² · socRevoltMul(s, p)` (4.4). `socRevoltMul` is society's `m(Ψ_p)` (their 2.5 formula,
  exported as named in their 0.5). It is **not** used in the Granovetter thresholds, the response choice, the rebels' strength or any other term.
- Society's **h2** (the grievance terms: peasant `immis`/coercion and `terms[6]` Urban) stays. It is a grievance input to private discontent
  `D_i = ps.unrest[i]`, not a Ψ multiplier, so it is not double counting. Society's **h2b** (`rb ·= 1 + eliteLead·…` inside `revolt()`) stays
  inside the shared `revoltAt` (4.10). It scales rebel strength, not the chance of a rising.
- `mmpAt`, `socUrban`, `socWage` are **not read by the sim** here. They are shown in the UI tooltip (7.3) only. `socUrban` already drives
  city-states' rising draw, and `mmpAt` is a component of Ψ, so reading either would count it a second time.
- `socElite`/`emp(s,p)` gives **organisation** (elite leadership) for the insurrection gate: `org_i ≥ … max(a_i/0.15, eliteLead·min(1, max(0, emp − 1)))` (4.6).
  This is a gate (who can lead), not a hazard multiplier. Society already counts EMP in h2b's rb, and I do not apply it to rb again.
- Proxy without society: `socRevoltMul = 1`, `eliteLead = 0`.
- **Asked of society:** export `socRevoltMul(s, p)` from society/api.ts (their 0.5 names it but 0.4 does not list it).

### 0.3 Finances (`state-finances.md` 0.3, 2.4)
Read: `ps.pPay[p]` (pay ratio 0..1, their 2.4.6) → soldier loyalty Λ (4.7); `finNeed(s, p)` → the crown's need (policy and concessions);
`finSpend(s, p, x)` → the cost of a grain dole and of repression; `finCredit(s, p, x, 'charter')` (unchanged) for despoiled merchants' wealth.
- **Tax policy belongs to finances when it is on.** My `taxLvl` (4.9) is chosen only when `s.fin === null`. With fin, `taxLvl` is read as
  `taxMul` (no choice is made), and the Taxes grievance is finances' `terms[5]`. Without fin, I fill `terms[5] = taxGrief · max(0, lvlMul − 1)` (same
  slot, same cause 5, so the label is the same with or without finances).
- Amendment asked: `finTaxRelief(s, p, town, years)`. It excludes `town` from the wealth tax for `years`. Proxy: my `remit[i]` only removes the grain tax (taxShares hook).
- Debasement stays finances' (`coinGrief` in terms[5]).
- Proxy without fin: `pay = 1 − 0.5·min(1, pExh)` (exhausted crowns pay late), `need = max(0.4·[pWars>0], smoothstep(0.6, 0.1, wealth[cap]/pMass))`, the same expression as tariffStep's need term [V policy.ts header].

### 0.4 City-states (`city-states.md` 4.4, 9)
- **Republicanism = the Commune movement** (4.8). It is a per-settlement adherent share `a_i` of a movement of kind Commune.
- City-states reads: `upCommune(s, id): number` (0..1, the Commune share at id). Proposed amendment to their rising chance:
  `· (1 + CITY.communeRise (2) · upCommune(s, i))`. Their chance stays one draw (skipped when `s.up === null`).
- I call: `govRisingResolve(s, ps, i, p): boolean`. This is their win/loss branch (F²/(F²+S²), Win → `cityState(... Rising)` + CommuneProclaimed extra 0;
  Loss → their crushed branch) **without** their happen-draw. It is called when a Commune-program insurrection in a town passing their
  gate escalates (4.10). Without city-states: the plain `revoltAt` path.
- Concession "Charter" (4.8) calls `govCharterGrant(s, ps, i, p): boolean` (their charter branch with chance 1, their price; the same as
  seat-mode's Charter 21 order). Without city-states: fall back to TaxRemitted.
- A broken charter (`CharterRevoked` 205) is a **tyranny act** (TyrannyKind.CharterBroken). I read the event; no API is needed.

### 0.5 Rulers (in repo: `src/sim/history/rulers/`)
Traits exist [V state.ts]: `rAbility` (0.45–1.6), `rWar`, `rPiety`, `rTol` (U(0,1), drawn at rulers/system.ts:227–228).
- **Cruelty is derived. No new draw, so existing streams keep their draw counts:**
  `cruelty(r) = clamp(0.45·(1 − rTol[r]) + 0.25·rWar[r] + 0.30·hash01(seed, r), 0, 1)`, with
  `hash01(seed, r) = mix32(seed ^ mix32(r + 0x9e3779b9)) / 2^32` (`sim/rng.ts mix32` [V]). The hash is counter-based: a reign id
  always gets the same temper, whatever else was drawn. It is stored as `up.cr[r]` lazily (Float32, grown with the reign count).
  [A] the weights. Rationale: intolerance and martial temper correlate with cruelty in chronicles, but not fully, hence the free part.
- Read: `R.cur[p]`, `R.rHow[r]` (AccessionHow), `R.rDyn`, `dPeople`, `R.rFaith[r]`, `R.lost[p]` (year of the last war lost [V]), `R.rAcc`.
- New hook in rulers/system.ts: `rulerOverthrownByCrowd(s, ps, R, ts, p, killed: boolean, restore: number)`.
  It calls `succession(s, ps, R, ts, p, ReignEnd.Revolution)`. In `succession`, Revolution is treated like Overthrown/Deposed (new house, Usurped),
  except that `restore ≥ 0` (a Legitimist rising) puts the eligible heir of house `restore` on the throne if one lives (AccessionHow.Claimed).
- Proxy without rulers: cruelty 0.3, ability 1, tolerance 0.5, warlike 0.5. Legitimacy from polity age (4.5). A capital revolution
  sets `pCrisisUntil = year + crisisMin` (a crisis) instead of a deposition.

### 0.6 Religion (in repo)
Read: settlement faith slots `rel.fId/fSh/fN` (K slots), `shareOf`, `majorityOf`, `polityFaith`, `rel.persUntil[p]`, `rel.kind`, `rel.zeal`
[V religion/system.ts, state.ts]. Persecution policy stays religion's (its `rulersStep`). I only (a) label risings Persecution when
`faithGrievance`'s persecute part leads, and (b) a **Toleration** concession or the Tolerate order sets `rel.persUntil[p] = year` (an
amendment to religion: one assignment; persecution then has to restart by its own rule).
- Amendment asked: `religionFlee(s, rel, i, f, share, ts)`. It is the body of `flightStep` for one (town, faith), exported, used by MinorityAttacked.
  Proxy: the share is removed from the slot (converted or fled; no Migration event).

### 0.7 Orders (in repo) and seat-mode
New `ORDER_KINDS` rows 30–32 (`ORDER_KIND_COUNT` → 33 after seat-mode's 23). Rows 23–29 must exist as placeholders if seat-mode has not filled them.
| kind | actor | years | effect |
|---|---|---|---|
| Crackdown 30 | polity | 10 | response utilities: `uR += 2`; intensity × 1.3 |
| Relief 31 | polity | 15 | policy forced: `relief = 1`, `taxLvl = 0` (fin off; with fin it calls `finTaxRelief` for the members hit by a bad harvest) |
| Tolerate 32 | polity | 20 | `rel.persUntil[p] = year` at give; `uC += 1` for Reform/Persecution risings |
Seat-mode reuse: **Placate 17** in force → `uC += 2` and `T_p *= 0.7` once. **Purge 18** at give → a NoblesExecuted tyranny act (T_p += w).
**Levy 20** → `taxLvl = 2` (fin off; with fin, theirs). **Charter 21** → the same branch as my Charter concession. No duplicate kinds.

### 0.8 Beliefs (`beliefs-and-deception.md`)
That plan models foreign beliefs only (pairs of polities, mass estimates [V its 2.1]). **Domestic perception is owned here** (Kuran, 3.2):
`up.perc[p]` = the ruler's estimate of discontent (expressed participation, lagged). Exposed for beliefs and seat-mode:
`upPerceived(s, p): number`, `upTrue(s, p): number` (pop-weighted D), `upRevealed(s, p): number` (year of the last revelation).
Optional amendment for beliefs: a spy service `spy[p]` raises domestic precision, `perc ← perc + spyDomestic·spy·(true − perc)`. Proxy: 0.

### 0.9 Grudges, families, disasters, battles
- Grudges: on MinorityAttacked or a Massacre of a town whose faith or people is the state faith or ruling people of another
  polity q with a border relation: `record(GrievanceKind.KinAttacked (11), wronged = q, offender = p, w = OATH… 0.3·share, site = i, war = -1)`.
  This runs only with `ps.oaths`. With oaths off, nothing is recorded.
- Merchant families: on MinorityAttacked with cause "people", the families of that people seated at i lose their seat:
  `familyExpelled(s, f, i)` (their SeatClose.Expelled 4 [V merchant-families.md l.389]). Proxy: `mw[i] *= 1 − pogMerch · m`.
- Disasters (260–269, not written when this plan was finished): a Millenarian trigger wants `disasterShockAt(s, id): number` (0..1, the
  severity of a disaster within 10 years). Proxy: `max(Famine within 10 y, CityStricken extra, 0.5·[GreatEpidemic touching the people in 10 y])`
  from the event scan.
- Battles (220–229): a defeat trigger reads `R.lost[p] === year − 1` (rulers) or, without rulers, a PeaceMade in which p lost towns (event
  scan). No battles API is needed.

---

## 1. Current behaviour [V]

### 1.1 Grievance → unrest → revolt (`polity/unrest.ts`)
- `grievance(s, ps, i, p)` (l.53) sums the terms peasant (famine in 10 y +0.3, crowding `0.2·smoothstep(0.85, 1, pop/foodBase)`, badTax +0.1),
  provincial (`0.4(1−g) + 0.2·E + 0.2·crisis + corruption`), ethnic (`0.3(1−assim) + conquest·fade(60 y)`), colonial (0.2 overseas), and
  religious (`faithGrievance`). It fills `terms[0..4]`, and `causeOf()` returns the argmax as RevoltCause.
- `unrestStep` (every `POLITY.step` = 5 y): `u += min(1, 5·0.1)·(h − u)` for non-capital members. **Capitals have unrest 0 always** (l.87).
- `revoltStep`: a member with `u ≥ 0.55` rises with chance `0.06` per step, in `s.living` order, one `ps.rng` draw.
- `revolt()` (l.96, private): a BFS cluster over `ps.gNb` of members with `u ≥ 0.4`, **at most `U.cluster = 15`**. It logs `Revolt(seat, cap, cause)`.
  Rebels win with `Rb²/(Rb² + Sup²)`, where `Rb = Σ asab·str·defense`, `Sup = projAt(p, dist[seat])·(crisis ? 0.6 : 1)`.
  - Crushed: pop −3 %, wealth −30 %, `u = 0.2`, cohesion `+COHESION.crushed`, `pExh += 0.1`; RevoltCrushed(seat, cap, cluster size).
  - Won with ≥ 2 towns and ≥ minState people: `successors()` (Revolt/Colonial origin, Seceded events); otherwise each town defects to a kin
    polity it submits to (Defected) or goes stateless.
- `fragment()` resolves all revolts at once in a crisis with low cohesion. `realmStep` handles successions, crises (civil.ts) and capital moves.
- Civil war and partition (civil.ts) are separate (rival centres, crises). This plan does not change them.

### 1.2 Other hooks used
- Yearly order (index.ts l.525–570): weather, food, goods produce, **trade (prices)**, tax, population, migration, …, abandonment,
  **politySystem** (campaigns, warYear, **rulerYear**, then the step-gated block: control, danger, cohesion, unrest, revolts, realm, bonds,
  raids, tariffs, slow step…), …, religionYear late in the year.
- Prices (trade.ts `setFoodPrices` l.695): `price = bid · V · (dw · 2/(1 + stock/D) + (1 − dw)·h)`, with the hunger term
  `h = 1 + hungerSlope(1 − y)` for food per head `y < 1`. Only **traders** (`pop ≥ TRADE.minPop`, posts, resorts) have prices.
- Grain tax (`polity/system.ts taxShares/taxSystem`): `share = POLITY.tax · grainShare · grip / defense`. **It is taken even in a bad
  harvest** (it then sets `badTax`): this is the "grain taken in famine" policy (today's only behaviour).
- Events carry `extra` through `logX`/`logEventExtra` pushes (`HistoryEvent.extra?`) [V contract.ts l.242].
- Religion: persecution (`persUntil`) and flight already exist. Goods: deportation exists as TraditionMoved extra 1 (traditions.ts l.10).
- The ideas system (`ideas/`) is **per (people × idea) held bit + progress** [V ideas/hooks.ts `record`, `ix.held[q·I + i]`]. It has no
  per-settlement share, so it **cannot carry partial, local adherence**. Religion's per-settlement faith slots and exposure spread are the
  right template, and movements reuse that pattern (4.8) rather than the ideas system.

---

## 2. Baseline measurements [M] (`probe-riots.ts`, default options, 2000 years)

| seed | revolts | crushed | won (incl. defect/stateless) | Defected | causes P/Pr/E/C/R | cluster size p50 / p90 / max | singletons | revolts per step: mean, Fano, lag-1 ACF |
|---|---|---|---|---|---|---|---|---|
| 1 | 458 | 337 | 121 (26 %) | 132 | 0 / 374 / 84 / 0 / 0 | 4 / 15 / 15 | 26 % | 1.15, 1.78, 0.31 |
| 7 | 460 | 352 | 108 (23 %) | 70 | 1 / 297 / 160 / 0 / 2 | 5 / 15 / 15 | 20 % | 1.15, 1.73, 0.45 |
| 42 | 568 | 441 | 127 (22 %) | 144 | 2 / 386 / 179 / 0 / 1 | 8 / 15 / 15 | 22 % | 1.42, 2.18, 0.42 |
| 1234 | 625 | 518 | 107 (17 %) | 79 | 3 / 548 / 74 / 0 / 0 | 8 / 15 / 15 | 20 % | 1.56, 3.23, 0.72 |

Other measurements:
- Member unrest at step years (all four seeds): `u ≥ 0.4` is 15–19 % of member-steps, `u ≥ 0.55` is 3.9–6.1 %. The median is ≈ 0.2.
- Famine events: 132–310 per run, but **Peasant-cause revolts are 0–3 per run**. Provincial is 65–88 % and Religious ≤ 0.4 %. The argmax
  over summed terms is dominated by the distance term (0.4·(1−g)).
- Normalised grain price at traders inside polities against its 10-year EMA (`price/bid` vs EMA α 0.1): ratio ≥ 1.3 in 7–8 % of trader-years,
  ≥ 1.5 in 2.8–3.3 %, ≥ 1.7 in 1.0–1.5 %. Only ~40–50 traders-in-polities per year on average (71–102 k samples / 2000 y), against
  ~350 members per step: **most members are non-traders**, so a food-per-head proxy is required (4.3).
- There are no events below Revolt: no riots, protests or concessions exist.

**What is wrong, against the targets:** sizes are capped (p90 = max = 15) rather than heavy-tailed; there is nothing smaller than a
revolt; causes are monotone (provincial); hunger never starts anything; clustering in time is mild (Fano 1.7–3.2) and comes from crises
and fragmentation, not contagion; capitals never rise.

Runtime: 213–220 s per 2000-year run on the shared 2-core box (noisy, upper bound).

---

## 3. Models (sources) and how each is used

1. **Threshold model** (Granovetter 1978, *AJS* 83(6):1420–1443, "Threshold Models of Collective Behavior"). Each person joins when the share
   already acting exceeds their threshold. Participation solves `r = F(r)`, where F is the threshold CDF. The smallest fixed point above the
   seed is reached by iteration. With a unimodal F the equilibrium **jumps** as the mean threshold falls past a fold. That is the sudden mass rising.
   [M proto/gran.mjs, logistic F, δ = 0.05]: s = 0.10 gives r* = 0.045 at μ = 0.40 and 0.999 at μ = 0.35. With s = 0.05 the jump comes at μ ≈ 0.2;
   with s = 0.25 there is no jump, only a gradual rise. Higher variance (heterogeneity) creates both instigators and hold-outs. Usage: 4.5.
2. **Preference falsification** (Kuran 1989, *Public Choice* 61(1) "Sparks and prairie fires"; Kuran 1991, *World Politics* 44(1) "Now out of never";
   Kuran 1995, *Private Truths, Public Lies*). Private discontent D differs from expressed participation E. Fear (repression) widens the gap. A trigger
   that lowers thresholds a little can reveal it all at once, and rulers who see only E are surprised. Usage: 4.5, 4.7.
3. **Moral economy** (Thompson 1971, *Past & Present* 50:76–136; Rudé 1964 *The Crowd in History*; Scott 1976 *The Moral Economy of the Peasant*).
   Crowds judge the price of bread against a customary "just" price. The riot is a disciplined price-setting (taxation populaire), often
   with seizures sold at the old price (the term *taxation populaire* is attributed to this literature from memory; unverified). Quantitative
   support for price spikes → unrest: Bellemare 2015 *AJAE* 97(1):1–21. Lagi, Bertrand & Bar-Yam (2011, a fixed FAO-index threshold) is
   **contested** and is not used for constants. Usage: 4.3.
4. **Self-exciting contagion** (Hawkes 1971, *Biometrika* 58(1); stationarity needs branching ratio n < 1, via the cluster (branching)
   representation of Hawkes & Oakes 1974). Evidence of contagion in civil unrest: Braha 2012, *PLoS ONE* 7(10) "Global civil unrest: contagion,
   self-organization, and prediction". **Correction:** Braha fits a nonlinear, spatially extended spreading model, not a Hawkes process; the Hawkes
   form here is this plan's choice. Usage: 4.4.
5. **Repression–dissent** (Lichbach 1987 *JCR* 31(2); Francisco 1995 *JCR* 39(2); Davenport 2007 *Annu. Rev. Polit. Sci.* 10). Repression deters or
   backfires. The evidence is mixed. Inverted-U and backlash effects depend on legitimacy and proportionality, so **this is a modelling choice, not a
   settled law**. Usage: 4.7.
6. **Army defection** (Chorley 1943 *Armies and the Art of Revolution*; Russell 1974 *Rebellion, Revolution, and Armed Force*; Barany 2016 *How
   Armies Respond to Revolutions and Why*). No revolution succeeds while the army stays loyal and willing. Unpaid soldiers and soldiers who share
   the crowd's people or faith defect more. Usage: 4.7.
7. **Legitimacy** (Weber's traditional/legal/charismatic types (Weber 1922), as habituation [A]). Usurpers and foreign or heretic rulers start low and gain by
   duration. Defeats cost legitimacy. Usage: 4.6.
8. **Rising expectations** (Tocqueville 1856, attribution of the idea unverified; Davies 1962 *ASR* 27:5–19 J-curve, contested). Concessions embolden, so fear falls after one. Used weakly (4.7).
9. **Ideology diffusion**: an SIS (susceptible-infected-susceptible; standard epidemic model, uncited) contagion on a network, the same pattern as religion's exposure spread [V religion/system.ts header]. Millenarian
   movements after disasters: Cohn 1957 *The Pursuit of the Millennium*. Persistence after defeat: martyrdom slows decay.
10. **Scapegoating violence** after hardship: Voigtländer & Voth 2012 *QJE* 127(3) (persistence); Anderson, Johnson & Koyama 2017 *Economic
    Journal* 127(602) (weather shocks raise persecutions). Modelled abstractly (4.11).
11. **Size distributions**: heavy tails tested with Clauset, Shalizi & Newman 2009 *SIAM Review* 51(4) (CCDF, discrete MLE α).

---

## 4. Design

### 4.1 Overview (yearly, inside politySystem, after rulerYear, before the step gate)
```
uprisingYear(s, ps, up, ts):
  scanEvents          (triggers: ReignEnded, SuccessionCrisis, lost wars, Conquered, Sacked, CharterRevoked, Famine, CityStricken, TraditionMoved extra 1, Persecution)
  pricesAndCustom     (moral-economy ratio ρ_i, customary price c_i)               4.3
  legitimacyYear      (L_p; cruelty cache; tyranny memory decay; tyranny acts)     4.6
  excitationDecay     (X_i ← e^{−β} X_i)                                            4.4
  sparks              (living order; λ_i; one draw per eligible town)               4.4
  for each spark:  rung by threshold fixed point (4.5) → response (4.7) → outcome/escalation (4.10)
  waves bookkeeping   (Hawkes parent trees → Wave events)                           4.4
every POLITY.step (inside the step block): unrestStep gets the new terms (4.2); policyStep (4.9); movementStep (4.8);
  revoltStep is skipped when s.up !== null (4.10)
```

### 4.2 Private discontent D (the slow channel: `ps.unrest`, unchanged update rule)
`grievance()` gains terms. `terms` grows from 5 to 13 entries, and `causeOf` maps term index → cause through a table:
```
const CAUSE_OF_TERM = [Peasant 0, Provincial 1, Ethnic 2, Colonial 3, Religious 4, Taxes 5, Urban 7, Tyranny 8, Conscription 9, Hunger 10, Persecution 11, Usurpation 12, Ideology 13]
terms[5]  Taxes        finances' (fin on) | taxGrief · max(0, taxMulOf(lvl) − 1) (fin off, up on)
terms[6]  Urban        society's h2
terms[7]  Tyranny      tyrW · (T_p + M_i)                                   (4.6)
terms[8]  Conscription levyW · levy_p · [pWars_p > 0] · (1 − 0.5·[town ≥ TOWN])  (peasant levies)
terms[9]  Hunger       hungerW · max(0, ρ̄_i − 1) + famineW · [famine ≤ 10 y ∧ relief_p = 0 ∧ taxed in bad harvest]   (the policy part)
terms[10] Persecution  moved from terms[4]: faithGrievance's persecute share (religion exposes `faithGrievanceParts` → [rival, persecute])
terms[11] Usurpation   legW · max(0, Lref − L_p)
terms[12] Ideology     ideoW · a_i · kindWeight                              (4.8)
```
- `ρ̄_i` is the EMA of the price ratio (the slow memory of dear years), not this year's spike (the spike is a trigger, 4.4).
- With `s.up === null` every new term is skipped (not added as 0: the codebase rule from city-states' section 6), and terms[4] keeps the persecute part.
- **Capital discontent** `Dcap_p` (new, `up.dCap`): at the capital, `grievance` is evaluated for the terms peasant, Taxes, Urban, Tyranny,
  Conscription, Hunger, Persecution, Usurpation and Ideology. Provincial, ethnic and colonial do not apply at the capital. It follows the same
  EMA. `ps.unrest[cap]` stays 0 so that the old code paths are untouched.
- Cause balance: the distance term dominates today (2.). The new terms are additive and do not rescale it. Hunger and Tyranny win
  argmax where they are large, and the target is that no cause exceeds 50 % of revolutions (8.).

### 4.3 Moral economy: customary price and food riots (pricesAndCustom)
Staple index (scale ≈ 1 in normal years), for every living member:
```
trader:      q_i = ts.price[i·G + Grain] / (ts.bid[i] · GOODS.value[Grain])          (removes the prosperity bid; = dw·2/(1+stock/D) + (1−dw)·h)
non-trader:  q_i = dw · 2/(1 + y_i) + (1 − dw) · h(y_i),  y_i = s.supply[i]/s.pop[i]   (the same formula with food per head as stock/need)
customary:   c_i ← c_i + (q_i > c_i ? αUp : αDown) · (q_i − c_i)        αUp = 1/30, αDown = 1/10   (custom resists rises: an asymmetric memory) [A]
ratio:       ρ_i = q_i / c_i ;   ρ̄_i ← ρ̄_i + 0.2 (ρ_i − ρ̄_i)
food trigger  b_i = smoothstep(τ, τ + 0.6, ρ_i),  τ = MORAL.tolerance 1.35 [A; at the measured 10-y-EMA distribution, ρ ≥ 1.3 in 7–8 % of trader-years]
```
- The trigger adds `λ_b · b_i` to the spark rate and `δ_b · b_i` to the threshold shift (4.4–4.5). The cause vector of the spark gets `+b_i` on Hunger.
- **Just-price seizure** (a Hunger-led rising at rung ≥ Riot): merchants' grain is sold at the customary price. As wealth:
  `x = seize · min(1, ρ_i − 1) · mw_i` (goods on; else `· wealth_i`), with `mw_i −= x`, `wealth_i += 0.5 x` (the rest is lost). seize = 0.2.
  The town's next-year price is not touched (trade has already run this year; an export ban is open question 3).
- At the first year a settlement is seen (or becomes a member), `c_i = q_i`, `ρ̄ = 1`.
- Timing: trade has run this year before politySystem [V index.ts order], so `ts.price` is this year's post-market price.

### 4.4 Contagion: a Hawkes process (when risings start)
Per member settlement i (stateless settlements have no uprisings in v1):
```
λ_i(t) = μ_i + X_i(t)
μ_i    = λ0 · D_i² · socRevoltMul(s, p)                       λ0 = 0.12 / y        (Ψ: the only place it enters, 0.2)
       + λ_b · b_i                                            λ_b = 0.8            (bread)
       + Σ triggers: ruler died/deposed this year 0.25 · [D_i ≥ 0.25];  defeat 0.25;  succession crisis opened 0.2;  tyranny act at i 0.5, in p 0.1;
                     town sacked/conquered by p in 10 y 0.15;  plague (CityStricken) 0.2;  Millenarian disaster 0.3·shock
       + λ_m · M_i                                            λ_m = 0.3            (martyr memory, 4.6)
X_i(t+1) = e^{−β} X_i(t) + Σ_j α_ij · mark_j                  β = 0.5 / y (mean lag 2 y)
P(spark) = 1 − e^{−λ_i}                                       one rng.next() per eligible i, in s.living order
eligible  = member, not abandoned, λ_i ≥ λmin 0.002, and rose ≠ year           (gates draw nothing)
```
- **Marks** by rung reached: Protest 0.25, Riot 0.6, Insurrection 1, Revolution 1 (Grumbling does not excite).
- **Kernel weights** (the source j excites its neighbourhood). For each j that rose this year:
  `w_jk` = 1/(1 + gCost/λ_p) for graph neighbours k (`ps.gNb`, the same polity ×1, across a border × crossW 0.4)
        + tradeW 0.6 · rVol share for the far ends of j's open routes (`ts.openList`, adjacency rebuilt every step)
        + faithW 0.3 for the 4 largest towns sharing j's majority universal faith (only when j's rising has a Reform or Millenarian program).
  Normalise per source: `α_jk = n0 · (1 − e^{−β}) · w_jk / Σ_k w_jk`, n0 = 0.6.
- **Stability**: the expected number of direct offspring of one rising is at most
  `Σ_k α_jk · mark / (1 − e^{−β}) ≤ n0 · max(mark) = 0.6 < 1`, because `P(spark) ≤ λ`. So the process is subcritical: waves always end.
  Test: n0 = 0.95 still terminates; a `diag.branch` estimate (offspring per parent) stays < 1 in the stats.
- **Parent attribution** (for waves): `src_i` = the uprising row whose contribution to X_i was largest (kept at the same time as X_i; ties go to the lower row id).
  A spark whose X_i share of λ_i is ≥ 0.5 is a child of `src_i`; otherwise it is a root. Wave = a root with all its descendants.
  When a wave has had no new member for 6 years and has ≥ 8 risings of rung ≥ Riot, log **Wave(289)** (first town, last town, wave id,
  towns). The "visible wave" stats target counts waves spanning ≥ 3 polities.
- **Demonstration effect**: X_i also lowers thresholds (4.5, `a_X`). That changes sizes, not counts, so the branching bound holds.

### 4.5 Thresholds and the ladder (how big)
Per spark at i, in town population N_i:
```
heterogeneity  H_i = 1 − Σ_f fSh_f²   (faith, Gini–Simpson; Simpson 1949)  + 0.5 · (1 − assim_i)·[people_i ≠ ruling people]  + 0.3 · classMix_i
               classMix_i = smoothstep(TOWN_POPULATION, CITY_POPULATION, N_i)  (proxy; society's socElite when on)  ; clamp [0, 1]
mean threshold μθ_i = θ0 − aD·D_i − aI·a_i − aX·min(1, X_i) − aB·b_i + aF·fear_i·Λ_p
spread         sθ_i = s0 + sH·H_i
available      A_i  = 1 − loyal_i,  loyal_i = 0.2 + 0.25·[people_i = ruling people]·assim_i + 0.15·[majority faith = ruler's]   (never join)
F(x)           = A_i / (1 + exp(−(x − μθ_i)/sθ_i))
shift          δ = δ0 + δ_b·b_i + δ_T·trigger_i + δ_X·min(1, X_i)
solve          r ← F(δ); repeat K = 12 times: r ← F(r + δ)          (monotone from below: the smallest fixed point above the seed)
quiet          E_i = F-fixed point with δ = 0 (same K)               (expressed discontent; computed every step for every member, 4.7)
```
Defaults [A, to tune]: θ0 0.75, aD 0.7, aI 0.6, aX 0.15, aB 0.15, aF 0.25, s0 0.06, sH 0.08, δ0 0.02, δ_b 0.08, δ_T 0.05, δ_X 0.05.
With D = 0.55 (the old revolt bar) and nothing else, μθ = 0.365 and sθ ≈ 0.08–0.12: just above the fold (3., model 1). A bread spike
or news then tips such towns into mass participation, while a town with D = 0.3 (μθ = 0.54) only protests.
K = 12 is not always converged near the fold (proto: K = 8 gives 0.41 where the exact value is 0.999). That residue is read as "a rising still
growing": it stays at Riot rather than Insurrection this year, and the town's X_i keeps it hot for the next. [A] This is deliberate, and it is cheap.

**Rungs** from participation `r*` (share of all people of the town):
| rung | r* | logged | meaning |
|---|---|---|---|
| 0 Grumbling | < 0.01 | never | private discontent only (seen in the heat view) |
| 1 Protest / petition | 0.01–0.04 | no (counted in diag; uprising row only if the response is a Concession) | a petition, a crowd at the gate |
| 2 Riot | 0.04–0.12 | row always; event if notable | crowds, seizures, burnings |
| 3 Insurrection | ≥ 0.12 **and** `org_i ≥ orgMin` (4.6) | row + event | armed, organised, holds the town |
| 4 Revolution | an insurrection that escalates (4.10) | Revolt(30) etc. | the existing revolt machinery (or a capital overthrow) |
Without organisation, r* ≥ 0.12 is capped at Riot (a great riot that burns out). **Notable** (Uprising 280 event): rung ≥ 3, or rung 2 with
`N_i ≥ TOWN_POPULATION`, or the root of a wave, or the first riot in the polity in 20 years. Estimate: 10–20 % of rows (8.).

### 4.6 Political causes: legitimacy, cruelty, tyranny, organisation
**Legitimacy** `L_p ∈ [0, 1]` (per polity, Float32, yearly):
```
L0 at accession by AccessionHow: Inherited 0.85, Elected 0.8, Founded 0.75, Union 0.6, Claimed 0.5, Usurped 0.4, Conquered 0.3
L∞ = min(1, L0 + 0.3) − 0.15·[dPeople(house) ≠ pPeople]  − 0.25·heresy_p                  heresy_p = members' pop share not of the ruler's faith (religion on)
L ← L + (L∞ − L)/30   yearly (habituation)
shocks: lost war (R.lost[p] = year−1) −0.12;  a war won with gains +0.05;  capital sacked −0.2;  Massacre ordered −0.1;  concession +0.03 (not for MinisterDismissed: −0.02)
no rulers: L0 = 0.7 at founding, the same L∞ rule without the house term
```
**Tyranny memory**: `T_p` (polity) and `M_i` (local martyr/atrocity memory) decay as grudges do: `w·0.5^(Δy / halfLife)`, with halfLife
25 y (T) and 60 y (M) (same form as grudges-and-oaths 3.2). They are applied yearly as `T *= 0.5^(1/25)`.
**Acts of tyranny** (`TyrannyKind`, logged as Tyranny 287). After `rulerYear`, polities in `ps.alive` order. **Gate** (no draw): ruler
`cr ≥ 0.5` and a motive. **One draw**: `< tyr0 (0.04) · (cr − 0.4) · motive`.
| kind | motive | effect | T_p | M_site |
|---|---|---|---|---|
| NoblesExecuted 0 | overthrow hazard (`overthrowHazard` from seat-mode's helper, or `max(0, 1.05 − ability)`) + crisis + Purge order | rulers: the overthrow chance this reign × 0.5 (fear) [A]; asab of the capital −0.02 | +0.15 | — |
| MerchantsDespoiled 1 | need_p ≥ 0.5 | the richest member by mw: `x = 0.3·mw`, `mw −= x`, `finCredit(x)` or `wealth[cap] += x`; families: `familyFined` (proxy no-op) | +0.1 | +0.3 |
| CharterBroken 2 | read from CharterRevoked 205 (not drawn) | — | +0.15 | +0.4 |
| Deportation 3 | read from TraditionMoved extra 1 by p (not drawn) | — | +0.05 | +0.4 at the source |
| TownMassacred 4 | from repression (4.7, not drawn) | — | +0.25 | +0.6 |
| Persecution 5 | read from the Persecution event 93 (not drawn) | — | +0.1 | — |
**Organisation** `org_i = max(a_i / 0.15, eliteLead · min(1, max(0, emp_p − 1)), [N_i ≥ CITY_POPULATION]·0.6, [a defection at i this year], [rich Commune town]·…)`;
`orgMin = 0.5`. Leaders come from a movement, from overproduced elites (society), from a great city's guilds, or from soldiers who went over.

### 4.7 Perception, response, repression and defection
**Perception (Kuran)**: `perc_p ← perc_p + 0.3·(Ē_p − perc_p)` yearly, where Ē_p = pop-weighted quiet E_i over members and the capital, times
`(0.6 + 0.4·min(1, ability))` (an able ruler hears more), plus a revelation: when a spark's `r* − E_i ≥ 0.1` in a notable town, `perc_p` jumps to
`max(perc_p, Ē_p + r*·N_i/pPop)` and `up.revealed[p] = year`. Policies (4.9) and responses use `perc`, never D. A fearful realm (high fear, so low E)
therefore looks calm and keeps ruinous policies until a spark reveals it.
**Fear**: `fear_i` (local) and `fear_p`, raised by effective repression, half-life 15 y. It enters μθ as `+aF·fear·Λ_p`: fear holds only while the
army is believed loyal.
**Soldier loyalty** `Λ_p = pay_p · (1 − 0.35·kin_i) · (0.7 + 0.3·L_p)`, with `kin_i = [people_i = ruling people] · 0.5 + [majority faith_i = ruler's faith] · 0.5`.
These are the soldiers raised from the crowd's own kind (the garrison is local). pay_p is `ps.pPay[p]` or the proxy (0.3).
**Response** (rung ≥ Protest; one draw, a softmax over three options):
```
uIgnore  = 1.0 − 0.9·rung
uConcede = −0.5 + 1.2·(ability − 1) + 1.0·(tol − 0.5) − 1.5·cr − 1.0·need_p + negot(program) + 0.6·perc_p/0.05 + orders
uRepress = −0.3 + 1.6·cr + 0.8·(war − 0.5) + 1.2·(Λ_p − 0.5) − 0.8·(1 − L_p) + 0.4·rung + orders
negot: Hunger, Taxes, Conscription +0.5; Commune (charter possible) +0.3; Reform/Persecution +0.2·tol; Separatist −0.5; Millenarian −∞; Tyranny 0
```
**Concede** (the kind by the primary cause): Hunger → GrainDole (`finSpend(p, dole·N_i)` or `wealth[cap] −= …`; remit[i] = year + 5) or
TaxRemitted (remit[i] = year + 10: `taxShare[i] = 0` in the taxShares hook; fin: finTaxRelief); Taxes → TaxRemitted; Tyranny or Usurpation →
MinisterDismissed (`T_p *= 0.5`, L −0.02); Commune/Burghers → Charter (govCharterGrant; else TaxRemitted); Persecution or Reform → Toleration
(`persUntil[p] = year`); Conscription → LevySuspended (levy_p = 0 for 10 y); Urban → DutiesLifted (`pTariff[p] *= 0.6` once, an amendment to policy.ts).
Effects: `ps.unrest[i] *= 0.6`, the participation ends, `fear_i *= 0.7` (concessions embolden, the J-curve, weak), L +0.03. Event Concession 282 if notable.
**Repress**: intensity `ι = 0.25·rung·(1 + cr)·(Crackdown ? 1.3 : 1)`, clamped to 1.5.
```
capacity  κ = projAt(p, dist_i) / (projAt(p, dist_i) + ps.str[i]·defense_i)
efficacy  e = Λ_p · κ
defection: only if rung ≥ 2; a second draw: < def0 (0.25) · (1 − Λ_p) · min(1, 5 r*) · (1 + [unpaid ≥ 2 y])
   → ArmyDefected 284 (extra 0 unpaid, 1 kin, 2 both); org_i = 1; the rising escalates (4.10) with rbMul = 1 + defBoost (1.0)
otherwise:
   deterrence   fear_i += 0.6·e·L_p·min(1, ι);   fear_p += 0.1·e·L_p
   backfire     M_i += 0.5·ι·(1 − L_p)·max(0, ι − 0.25·rung·prop) + [ι ≥ 1]·0.3       prop = 1.2 (proportionality slack)
   dead         pop_i −= kill·ι·r*·N_i  (kill 0.05);  ι ≥ 1 and r*·N_i ≥ 200 → Massacre 283 (extra per-mille dead), TyrannyKind.TownMassacred
   outcome      the rising is Suppressed if e ≥ 0.5 or rung ≤ 2; else it escalates (4.10)
```
This gives the repression dilemma as an outcome, not a rule. Against a legitimate ruler with a loyal army, repression deters (fear up, little
M). Against an illegitimate or disproportionate one, it backfires (M raises future sparks through λ_m and D through terms[7]). With a
disloyal or unpaid army, it brings defection and revolution. [A] The coefficients are a modelling choice (3., model 5 is contested).
**Ignore**: the rising runs its course. Riots end Dispersed (D unchanged; the town's E rises to r*/2 for 5 years: it has spoken).
An Insurrection that is ignored escalates (4.10).

### 4.8 Ideologies: movements that spread, are crushed, resurface
Movement table (ragged arrays, ids in founding order; at most `MOV.maxLive 24` live at once; dormant ones do not count):
`kind` (MovementKind: Reform 0, Commune 1, Separatist 2, Millenarian 3, Legitimist 4), `anchor` (faith id / −1 / people id / faith or −1 /
dynasty id), `origin` settlement, `founded`, `state` (Live, Dormant, Faded, Triumphed), `stateYear`, `memSites` (up to 3 towns, for resurfacing),
`peakShare`, `peakTowns`.
Per settlement: 2 slots `mvId: Int16Array(2·cap)` (−1 empty), `mvSh: Float32Array(2·cap)`.
**Birth** (every POLITY.step, members in id order, at most one per polity per step; gates draw nothing, one draw per gated town):
| kind | gate (receptivity R) | chance |
|---|---|---|
| Reform | religion on, N ≥ TOWN, state church or persecution in p, off-share of the ruler's faith 0.15–0.6, Crafts ≥ 2 | 0.01·R |
| Commune | N ≥ TOWN, `mw/N ≥ CITY.rich0` (city-states' gate value, or 0.3 without them), (Taxes + Urban) term ≥ 0.15 | 0.01·R |
| Separatist | `1 − assim ≥ 0.5` and the town's people ruled a polity of its own before (a pPeople history scan, cached per people) | 0.008·R |
| Millenarian | disasterShock ≥ 0.4 (0.9 proxy) and D ≥ 0.35 | 0.02·R |
| Legitimist | a house ended or was deposed in p within 30 y, its dHome a member, and its heir pool non-empty (rulers) | 0.02·R |
R ∈ [0, 1] is the gate's smoothstep score. The origin gets `a = 0.1`; MovementFounded 285.
**Spread** (every step, an Euler step of 5 years, SIS):
```
inflow_i  = β_k · Rk_i · (1 − a_i) · Σ_j w_ij a_j          over gNb (same polity 1, across a border 0.5), open-route partners (tradeW·vol share),
                                                          and, for Reform/Millenarian, faith co-members (anchor faith share at i ≥ 0.1)
outflow_i = γ_k · a_i · (1 − ζ·min(1, M_i))                ζ = 0.7: martyrs keep a cause alive
a_i ← clamp(a_i + 5·(inflow − outflow), 0, 1)              β_k ≈ 0.08–0.15/y, γ_k ≈ 0.05/y [A]
```
Kind restrictions: Separatist spreads only among settlements of its anchor people. Commune spreads only among towns (N ≥ TOWN), mostly along
routes (the league channel). Legitimist stays inside its polity. Slots: a newcomer takes an empty slot, or replaces the weaker one when its
inflow exceeds that share.
**Repression of adherents**: a suppressed rising with a movement cuts `a_i *= 1 − 0.5·e`, but adds to `M_i`, which slows the outflow.
**Dormant and resurfacing**: when the total adherents (Σ a·pop) fall below `MOV.dormant`, state → Dormant (MovementChanged 286, extra 0). Its 3
best towns are kept. Each step for up to 200 years, a dormant movement resurfaces with chance `0.05·max_site(λ_i trigger part + λ_m·M_i)`
(a = 0.08 at that site; extra 1). After 200 years it is Faded (extra 2). Triumphed (extra 3): its program came to pass (a Separatist secession, a
Commune proclaimed, a Toleration granted to Reform, a Legitimist restoration).
**Effects**: `a_i` lowers thresholds (`aI`), gives organisation, adds terms[12], gives the rising a **program** (its demand, which sets `negot` and
the concession kind) and a name (7.4). The movement id is stored on the uprising row.

### 4.9 Policy (per polity, every POLITY.step; chosen from perceived unrest and ruler traits)
`up.pol[p]` packs: `taxLvl` 0 light / 1 customary / 2 heavy (fin off only), `relief` 0/1 (remit the grain tax in bad harvests), `levy` 0–2 (at war only).
Persecution is religion's, and tariffs are policy.ts'. Their grievance is read (Persecution term; `Urban`/Taxes and the DutiesLifted concession).
```
noise ν = (hash01(seed ^ p·7919, year/5) − 0.5) · (1.6 − ability)            (incompetent rulers choose noisily; counter-based, no draw)
heard  = perc_p · (1 − cr)                                                   (a cruel ruler discounts the crowd)
taxLvl = need_p − 2·heard + ν > 0.45 ? 2 : (need_p − 2·heard + ν < −0.1 ? 0 : 1)        mul 1.35 / 1 / 0.75 on taxShares
relief = ability·(1 − cr) + 0.5·(tol − 0.5) − need_p + ν > 0.4 ? 1 : 0       (relief costs the capital its grain)
levy   = pWars > 0 ? (war ≥ 0.6 || threat) + (pExh < 0.5 && cr > 0.5) : 0
orders override (Relief 31, Levy 20).
```
Effects: `taxShares` hook: `x *= TAXMUL[taxLvl]` and `x = 0` when `remit[i] > year`, or `relief = 1` and the region's harvest < UNREST.badHarvest
(then badTax is not set). Levy: grievance terms[8]; optional `ps.pMass ×(1 + 0.05·levy)` (`UP.levyMass`, **default off** until battles/finances
decide whether levies are a war-strength lever) [A]. Policies are snapshotted per polity (`History.policies`, a Uint8 per slow step).

### 4.10 Escalation to revolution (the existing machinery, shared)
Refactor `revolt()` into an exported `revoltAt(s, ps, seat, p, cause, cluster: number[] | null, rbMul, rng)`:
- `cluster === null`: builds the old BFS cluster (cap U.cluster), and the caller passes `ps.rng`, cause = causeOf(), rbMul = 1. That is the old
  behaviour, so the off run stays bit-identical (the same draws, the same order, the same arithmetic: `rb * rb` with rbMul skipped, not multiplied).
- `cluster` given (riots): the rising's own cluster (below), and `rb = Σ_j asab·str·defense · (r*_j / 0.12)` · rbMul. `Sup = projAt · crisis · Λ_p`.
  The rng is `up.rng`. The win/loss/successor/defect branches are unchanged.
- **Cluster**: from the seat, BFS over gNb members (not the capital). Each neighbour j solves its own fixed point with `δ_j = δ·0.5 + 0.5·r*_parent`
  and joins when `r*_j ≥ 0.04` (rung ≥ Riot). The cap is `UP.cluster` 60. This is where heavy-tailed sizes come from, together with Zipf town sizes (Zipf 1949).
  The towns that join get `rose = year` and a mark (4.4).
- **Escalation rule**: an Insurrection escalates to Revolution when (a) the response was Ignore, (b) repression failed (`e < 0.5`), or (c) soldiers
  defected, **and** (cluster ≥ 2 towns, or the seat is the capital, or `N ≥ CITY_POPULATION`). Otherwise it ends Suppressed or Dispersed after the
  response. At most one revolution per polity per year.
- **Province** → `revoltAt` with the primary cause (RevoltCause 0–14). A Commune program in a town that passes city-states' gate → `govRisingResolve`.
  A Separatist program: when the cluster wins, all of it goes to `successors()` (as today), and the movement is Triumphed.
- **Capital** → no secession. `win = rbCap² / (rbCap² + guard²)`, with `rbCap = r*·N·asab_cap`, `guard = Λ_p·(local_cap + 0.3·pMass)`.
  Win → `rulerOverthrownByCrowd(p, killed = draw < 0.3, restore = Legitimist ? anchor : −1)`; Commune program and city-states on →
  `govAbolishThrone` (their CommuneProclaimed extra 3); `L_p = 0.4`. Loss → crushed as in revolt() (pop, wealth), Massacre if ι ≥ 1.
- **revoltStep** is not called when `s.up !== null`. **Fragmentation** (`fragment()`) still calls the old path (`cluster = null`) with `ps.rng`:
  a realm breaking up in crisis is the existing civil-war-scale mechanism and is left alone. Civil wars and partitions are unchanged.

### 4.11 Attacks on minorities (handled abstractly)
This is the darkest thing the model does. It is included because scapegoating after hardship is a documented and recurring pattern (3., model 10), and
leaving it out would make the history falsely gentle. The prose stays sober, brief and non-graphic, it never frames such an act as heroic,
and the victims are named only as a faith or people.
- Gate (no draw): a rising at i with rung ≥ Riot whose primary cause is Hunger or Ideology (Millenarian), or with a plague trigger this year,
  and a minority: a faith f with share `m ∈ [0.03, 0.35]` at i that is not the town's majority and not the crowd's own (or merchant
  families of another people, families on).
- One draw: `< pog0 (0.15) · m · (1 − tol_ruler) · (rel.kind[f] universal and a rival of the majority ? 1 : 0.5) · (1 − protect)`, where
  `protect = Λ_p · L_p · min(1, ability) · tol_ruler` (a strong, tolerant ruler protects the minority).
- Effect: `religionFlee(i, f, 0.4·m)` (or proxy), `pop_i −= 0.02·m·N_i`, families of that people expelled (0.9), merchant pool `mw_i *= 1 − 0.5·m`,
  grudge KinAttacked to a polity whose state faith is f (0.9). `M_i` is **not** raised: the minority's suffering is not counted as a grievance of
  the crowd. Event MinorityAttacked 288 (value faith id, extra 0; or people id, extra 1).
- Target: rare. ≤ 3 % of risings at rung ≥ Riot, and rarer under tolerant rulers (8.).

---

## 5. Contract additions (`src/contract.ts`), drafted in the codebase's style

### 5.1 Enums
```ts
export const RevoltCause = { …, Tyranny: 8, Conscription: 9, Hunger: 10, Persecution: 11, Usurpation: 12, Ideology: 13, Mutiny: 14 } as const
// (uprisings: Tyranny, a cruel ruler's acts; Conscription, levies for war; Hunger, dear bread against its customary price or grain taken in a
//  famine; Persecution, a state that persecutes the townsfolk's faith; Usurpation, a ruler without legitimacy (a usurper, a foreign or heretic
//  house, lost wars); Ideology, a movement's program (History.movements); Mutiny, soldiers who went over to the crowd)

/** The highest step a rising reached on the ladder below revolt (History.uprisings). */
export const UprisingRung = { Grumbling: 0, Protest: 1, Riot: 2, Insurrection: 3, Revolution: 4 } as const

/** How a rising ended. */
export const UprisingEnd = {
  Dispersed: 0, // the crowd went home: ignored, it ran its course
  Conceded: 1, // the authorities gave way (History.uprisings concession says how)
  Suppressed: 2, // put down by force
  Massacre: 3, // put down with great slaughter (EventType.Massacre)
  Escalated: 4, // became a revolution: the Revolt (30) event of the same year follows, or a capital overthrow (ReignEnd.Revolution)
  Overthrew: 5, // a rising at the capital drove the ruler out
} as const

export const ConcessionKind = { TaxRemitted: 0, GrainDole: 1, MinisterDismissed: 2, Charter: 3, Toleration: 4, LevySuspended: 5, DutiesLifted: 6 } as const
export const TyrannyKind = { NoblesExecuted: 0, MerchantsDespoiled: 1, CharterBroken: 2, Deportation: 3, TownMassacred: 4, Persecution: 5 } as const
export const MovementKind = { Reform: 0, Commune: 1, Separatist: 2, Millenarian: 3, Legitimist: 4 } as const
export const MovementState = { Live: 0, Dormant: 1, Faded: 2, Triumphed: 3 } as const
export const UprisingResponse = { Ignored: 0, Conceded: 1, Repressed: 2 } as const
ReignEnd: Revolution: 9, // driven from the capital by a rising of its people (uprisings: EventType.Uprising, UprisingEnd.Overthrew)
```

### 5.2 Events 280–289
```ts
  // uprisings: riots, protests and risings below revolt, contagion waves, repression, movements (280-289; none when HistoryOptions.uprisings is false).
  // Only notable risings are logged (a riot in a town of TOWN_POPULATION or more, any insurrection, a wave's first); every riot and larger is a row of History.uprisings.
  Uprising: 280, // the people of `settlement` rose against the polity ruled from `other`; `value` the rising's row (History.uprisings); `extra` the UprisingRung it reached (2 riot, 3 insurrection)
  UprisingEnded: 281, // the rising `value` at `settlement` ended; `other` the capital; `extra` how (UprisingEnd). Escalated is followed by Revolt (30) or ReignEnded (ReignEnd.Revolution)
  Concession: 282, // the polity ruled from `other` gave way to the rising `value` at `settlement`; `extra` the ConcessionKind
  Massacre: 283, // the rising `value` at `settlement` was put down with great slaughter by the forces of `other`; `extra` the dead per thousand of the town's people
  ArmyDefected: 284, // the soldiers sent against the rising `value` at `settlement` went over to it; `other` the capital; `extra` 0 unpaid, 1 of the crowd's own people or faith, 2 both
  MovementFounded: 285, // a movement (History.movements `value`) began at `settlement`; `other` -1; `extra` its MovementKind
  MovementChanged: 286, // movement `value` changed state at `settlement` (its largest seat, or where it resurfaced); `other` -1; `extra` 0 went underground (Dormant), 1 resurfaced, 2 faded away, 3 its program came to pass
  Tyranny: 287, // an act of tyranny by the ruler of the polity ruled from `other` at `settlement`; `value` the ruler (History.rulers) or -1; `extra` the TyrannyKind
  MinorityAttacked: 288, // a rising at `settlement` turned on a minority: `value` its faith (History.faiths) when `extra` is 0, its people when `extra` is 1; `other` -1
  Wave: 289, // a wave of risings spread from `settlement` (its first) to `other` (its last); `value` the wave id (History.uprisings wave); `extra` the number of towns that rose
```

### 5.3 History tables
```ts
/**
 * Risings at the riot rung or above (and protests answered by a concession), struct-of-arrays in order of occurrence. A rising is one town's
 * crowd in one year; the towns that joined it in the same year are in `towns`. `parent` is the earlier rising whose news set it off (the
 * largest share of its intensity), or -1 for one that began on its own; risings with a common root form a wave (`wave`, -1 if none was logged).
 */
export interface Uprisings {
  count: number
  year: Int16Array
  settlement: Int32Array
  polity: Int16Array
  rung: Uint8Array        // UprisingRung reached
  cause: Uint8Array       // RevoltCause, primary
  cause2: Uint8Array      // RevoltCause, second (255 none)
  people: Float32Array    // participants (r* times the town's people, summed over its towns)
  towns: Uint8Array       // towns that rose with it (1 = alone)
  response: Uint8Array    // UprisingResponse
  concession: Uint8Array  // ConcessionKind, 255 none
  end: Uint8Array         // UprisingEnd
  movement: Int16Array    // History.movements id, -1
  parent: Int32Array
  wave: Int32Array
  revealed: Uint8Array    // 1 when it showed far more discontent than was expressed (preference falsification revealed)
}
/** Movements (ideologies), in founding order; `anchor` is a faith, a people or a dynasty by kind (-1 none). */
export interface Movement { id: number; kind: MovementKind; anchor: number; origin: number; founded: number; state: MovementState; stateYear: number; peakShare: number; peakTowns: number }
History.uprisings: Uprisings
History.movements: Movement[]
/** Per snapshot and settlement: heat 0..255 = 255·max(D, r* of the year's rising) (uprisings). */
History.unrestHeat: Uint8Array
/** Per slow step and polity: legitimacy 0..255, perceived and true discontent 0..255, policy bits (taxLvl | relief<<2 | levy<<3). */
History.realmMood: { snapshots: number; legit: Uint8Array; perceived: Uint8Array; truth: Uint8Array; policy: Uint8Array }
/** Movement adherents, sparse: rows (snapshot, settlement, movement, share 0..255) for shares >= 0.05, at slow-step snapshots. */
History.adherents: { count: number; snap: Int16Array; settlement: Int32Array; movement: Int16Array; share: Uint8Array }
HistoryOptions: /** uprisings: riots, protests and risings below revolt (thresholds, food riots, contagion waves, repression and army defection),
 * rulers' legitimacy and tyranny, policies and movements (needs polities). Default true once tuned; false gives exactly the history without them. */ uprisings?: boolean
HistoryDiagnostics.uprisings?: { sparks, byRung[5], conceded, repressed, ignored, defections, massacres, revelations, branch, waves, minorityAttacks, movements }
```

### 5.4 State (`src/sim/history/uprisings/state.ts`) and params (`uprisings/params.ts`: `UP`, `MORAL`, `HAWKES`, `THRESH`, `RESP`, `MOV`, `LEGIT`, `TYR`)
`HistoryState.up: UprisingState | null`. It is created in createRunner after rulers/religion/fin:
`pol && (options?.uprisings ?? UP.enabled) ? createUprisings(s) : null`.
Per settlement (grown with the settlement capacity): `c, rhoBar, X: Float32Array; src: Int32Array; fear, M, E, rStar: Float32Array; remit: Int16Array;
seenAt: Int32Array; mvId: Int16Array(2·cap); mvSh: Float32Array(2·cap)`.
Per polity: `L, T, fearP, perc, dCap: Float32Array; revealed: Int32Array; pol: Uint8Array; levyUntil: Int16Array; lastRiot: Int32Array`.
Per reign: `cr: Float32Array` (lazy). Rows: the Uprisings arrays as JS number[] until assembly, plus movements' arrays and the wave table
(root row, first, last, towns, polities, lastYear). `evSeen` (event cursor), `routeAdj` (CSR of open-route partners, rebuilt every step), `rng`, `diag`.
Every param has a doc comment in the codebase style; the defaults are the values given in 4.3–4.11.

---

## 6. Step order and determinism
- **Placement**: `uprisingYear` in politySystem right after `rulerYear` and before `if (s.year % POLITY.step !== 0) return`. In the step block:
  `unrestStep` (with the new terms, and dCap), then `policyStep`, `movementStep`, and **instead of** `revoltStep` nothing (when `s.up`). taxShares
  (end of the step block) reads `taxLvl/relief/remit`.
- **Stream** `createRng(seed, 'history-uprisings')`, created only when on. Draws, in fixed order per year: tyranny acts (polities in `ps.alive` order, gated);
  sparks (`s.living` order, gated); per spark: response (1), defection (1, only when repressed at rung ≥ 2), win (1, only on escalation),
  capital kill (1), minority attack (1, gated). Per step: movement births (members in id order, gated), resurfacing (movements in id order).
- Cruelty and policy noise are counter-based hashes, not draws.
- Calls into other systems draw from their own streams (rulers' succession: `R.rng`; `newPolity` in successors: `ps.rng`). That is allowed:
  with uprisings on, the history may differ.
- **Off identity**: every hook is `s.up !== null ? … : old`. `revoltAt(cluster = null)` is the old revolt() body, line for line. Test:
  `uprisings: false` equals 8cabf09 on every History field except the new empty keys (vitest on 42:1200, 3:600, 9:800), and the existing goldens are
  unchanged. A **shadow mode** (`UP.effects = false`: everything is computed and recorded, but D, the taxes, pop, wealth, revolts and rulers are untouched,
  revoltStep still runs) must equal off on all pre-existing fields. It is a real test until step 6, when it is dropped with a commit note
  (the same as grudges 3.8 and finances 3.2).
- Golden-hash filters skip `uprisings, movements, unrestHeat, realmMood, adherents` and events 280–289 (like the 120–129 and 140–149 filters).
- Prefix stability: everything is per year and appends only. A test compares a 1200-year run against the first 1200 years of a 2000-year run.
- Arithmetic: `exp` appears in the logistic and `e^{−β}`. `Math.exp` is deterministic on one engine, and the codebase already uses
  smoothstep, not exp, in hot paths. Precompute `e^{−β}` and use `Math.exp` in F (the same engine is assumed for goldens, as today [A]).

---

## 7. UI and prose

### 7.1 Data (`ui/uprisingsData.ts`)
Row accessors, waves, `heatAt(h, snap, id)`, `moodAt(h, p, snap)`, `movementsAt(h, id, snap)`, and the name builder (7.4).

### 7.2 Map: `ViewMode.Unrest = 'unrest'` (`render/palette.ts`, drawn in `render/polities.ts` beside Danger, `viewLegends.ts`)
- The heat per settlement's land (unrestHeat) on a neutral base: amber → red, with a ring pulse on towns that rose this year (rung colour).
- **Wave animation**: for the current year ±3, draw the parent → child arcs of each wave along `routeCurves.ts` (trade links) or straight
  for graph neighbours. Each arc grows over 1.5 s in playback, coloured by the wave's root cause. A legend chip lists the active waves ("The
  Bread Risings, 1342–1349: 23 towns, 5 realms").
- Toggle "movements": colour by the leading movement's kind, with opacity = share.

### 7.3 Panels
- Settlement card: "Mood: discontented (privately much more than it shows)", shown when `D − E ≥ 0.15`. It lists its risings and movements,
  and the society tooltip (mmpAt, socUrban) when society is on.
- Polity panel (after Society/finances): legitimacy bar, "Perceived calm / true unrest" as two bars (Kuran), policy line ("Heavy taxes ·
  grain taken in famine · levies raised"), and the risings of the last 50 years in a mini-timeline.

### 7.4 Names (UI only, deterministic from ids; no sim draws)
- Movements: `{Emblem} {Noun}`. Emblems come from a fixed table (Lantern, Plough, Ash, Lamb, Iron Ring, Green Branch, Salt, Wheel…) by
  `mix32(seed ^ id) % n`. The noun is by kind: Reform "Brethren"/"Reform", Commune "Commune"/"League of Burghers", Separatist "the {People} Cause",
  Millenarian "Prophets of the {Emblem}", Legitimist "{House} Loyalists". Real-world group names are avoided.
- Risings: Hunger → "the Bread Rising of {town}". Taxes → "the Rising against the {Tax}", where Tax comes from a table (the Tax of Ninths, the
  Hearth-Penny, the Salt Dues, the Bridge Toll…) by hash of polity and decade. Tyranny → "the Rising against {Ruler} the {epithet}" (sagas/epithets.ts).
  Ideology → the movement's name. Waves → "the {Cause} Risings of {first year}" or "the Year of {Emblem}s".
- Slogans (for the sagas): by cause and program: "Bread at the old price!", "No Ninths!", "Freedom for the city!", "The true {faith}!",
  "{House} and the old law!".

### 7.5 Chronicle (`ui/polityFormat.ts describeV2`, `historyIndex.ts`, filter "Unrest" in chronicleFilter.ts). Plain and hedged:
| event | line |
|---|---|
| Uprising rung 2 Hunger | "Bread riots in Oruma: crowds seize grain and sell it at the old price" |
| Uprising rung 3 Ideology | "The Lantern Commune takes up arms in Genva against the Kingdom of Vashtar" |
| Concession GrainDole | "Vashtar sends grain to quiet Oruma" |
| Concession MinisterDismissed | "To appease the crowds of Tessa, the king's minister is dismissed" |
| Massacre | "The rising at Oruma is put down with great slaughter (about 40 in every thousand dead)" |
| ArmyDefected | "Soldiers sent against Oruma go over to the crowd; many had not been paid in two years" |
| UprisingEnded Overthrew | "A rising in the capital drives King Adro III from Vashtar" |
| Tyranny MerchantsDespoiled | "King Adro seizes the wealth of the merchants of Tessa" |
| MinorityAttacked | "Violence against the Ashen faithful of Oruma during the riots; many flee the town" |
| MovementChanged 1 | "The Lantern Commune, thought crushed, resurfaces at Genva" |
| Wave | "A wave of risings, begun at Oruma, has spread to 23 towns in five realms" |
| Revolt (Hunger) | "Hungry townsfolk rise at Oruma against Vashtar" (the polityFormat l.379 switch gains 8–14) |
The chronicle register hedges reported numbers ("about", "it is said"). It does not hedge the events themselves.

### 7.6 Sagas (`ui/sagas/unrest.ts`: phrase table `UP_T` with `[chronicle], [legend]`; used by state.ts, city.ts, year.ts, reigns.ts)
- Chronicle: "In 1342 the bread was dear in Oruma, and the townsfolk rose against the Tax of Ninths. The king sent grain; the crowds went home."
- Legend: "In the year the bread failed, Oruma rose with one voice: *No Ninths!* Grain came down the river from the king's own barns."
- Martyrs (legend only, when M is high and a movement survives): "They hanged the Lantern-bearers at the gate, and the lanterns were lit again
  in every window." Chronicle: "The leaders were executed; the movement survived in secret."
- **Partisan framing** (for the experience plan's partisan sagas: a `stance: 'crown' | 'rebel'` Voice option, default neutral). The same row is told
  as "rebellion/traitors/restored order" (crown) or "rising/liberation/martyrs" (rebel). Phrase keys carry a third and fourth variant list where
  wording differs. [A] The interface is pending that plan.
- MinorityAttacked: the legend variants are **empty** (it falls back to the sober chronicle line). The legend register never mythologises such acts.
- state.ts `revolts` line gains: "{riots} riots and {ins} risings troubled it; {conceded} ended in concessions, {massacres} in massacres."

---

## 8. Ordered commit-sized steps
1. **Contract and plumbing**: enums, events 280–289, History fields (empty), `HistoryOptions.uprisings`, `UP.enabled = false`; history.test.ts
   EventType switch cases; hash filters. Test: off identity.
2. **revoltAt refactor** (unrest.ts): extract, with the old path via `cluster = null`. Test: bit-identical goldens.
3. **State, moral economy, legitimacy, cruelty, tyranny memory in shadow mode** (`UP.effects = false`): uprisings/state.ts, params.ts,
   economy.ts (4.3), legit.ts (4.6). Tests: the hand-built price series → c, ρ; legitimacy after usurpation → 0.4 then rises; cruelty is the same
   across runs and independent of other draws; shadow = off on old fields.
4. **Sparks, thresholds, Hawkes, the ladder (still shadow)**: system.ts `uprisingYear`, threshold.ts (fixed point, unit tests at hand values:
   μ 0.4/0.35 with s 0.1 reproduces the fold), hawkes.ts (branching test with n0 = 0.95: it terminates; offspring estimate < n0).
   Rows recorded; no effects. Harness v1 counts rungs.
5. **Responses and outcomes** (still shadow, the decisions recorded): response.ts (4.7), with perception and fear. Tests: a cruel ruler with a loyal army
   represses more; a ruler with unpaid soldiers sees more defections.
6. **Effects on**: grievance terms (4.2), concessions, repression effects, the taxShares hook, revoltAt from the ladder, revoltStep skipped, capital
   overthrows (rulers hook `rulerOverthrownByCrowd`, ReignEnd.Revolution). Drop the shadow test (commit note). Tune with the harness (9).
7. **Policies** (4.9) and orders 30–32, plus the seat-mode reuse hooks (Placate, Purge, Levy, Charter).
8. **Movements** (4.8): birth, spread, dormancy, resurfacing; the city-states (`upCommune`, govRisingResolve) and rulers (restore) hooks.
9. **Minority attacks** (4.11) with the religion/families/grudges hooks and proxies.
10. **Assembly and snapshots**: assembleUprisings, unrestHeat, realmMood, adherents (sparse). Prefix-stability and resume (`advanceTo`) tests.
11. **UI**: data, the Unrest view + wave arcs, panels, names, chronicle lines, sagas (both registers, partisan variants behind a flag).
12. **Tune and default on**: `UP.enabled = true` once the targets hold on all four seeds and three sensitivity seeds (2, 3, 99). README section.

---

## 9. Stats harness (`src/sim/history/uprisings/uprisingStats.ts`, seeds 1, 7, 42, 1234; 2000 years; A/B against off)
| metric | baseline [M] | target |
|---|---|---|
| Revolutions (Revolt events + capital overthrows) | 458–625 | 0.7–1.3 × baseline (realm dynamics stay comparable) |
| Riots (rung ≥ 2 rows) | 0 | 10–30 × revolutions |
| Protests (diag) | 0 | ≥ 3 × riots |
| Size (people per rising, rung ≥ 2): CCDF tail | capped at 15 towns | discrete MLE α (Clauset, Shalizi & Newman 2009) 1.6–2.6 (design band) over the top 20 %; max ≥ 30 towns at least once per run |
| Towns per rising | p90 = max = 15 | p50 1, p90 3–8, max ≥ 30 |
| Yearly riot counts: Fano factor in 10-year windows | 1.7–3.2 (revolts per step) | ≥ 3 |
| Waves (≥ 8 risings, ≥ 3 polities) | none | 3–15 per run |
| Branching estimate (children per parent) | n/a | 0.3–0.8 (< 1 always) |
| Cause shares of revolutions | Provincial 65–88 % | no cause > 50 %; Hunger ≥ 10 %; Tyranny + Usurpation 5–20 %; Ideology 3–15 % |
| Hunger riots following ρ ≥ τ | n/a | Spearman(ρ, P(riot) next year) ≥ 0.2 |
| Response mix at rung ≥ 2 | n/a | concede 25–45 %, repress 35–60 % |
| Repression backfire (M ↑ more than fear) | n/a | 10–30 % of repressions; higher (×2) under L < 0.4 |
| Defections | n/a | 3–10 % of repressions; ≥ 2 × as frequent with unpaid armies (finance on) |
| Capital overthrows | 0 | 5–25 per run; ReignEnd.Revolution ≤ 15 % of reign ends |
| Revelations (r* − E ≥ 0.1) | n/a | ≥ 30 % of insurrections were "surprises" |
| Movements founded / reaching ≥ 10 towns / resurfaced | 0 | 20–80 / 5–20 / ≥ 3 per run |
| Minority attacks | 0 | ≤ 3 % of rung ≥ 2 risings; ≥ 2 × rarer under tolerant rulers (tol > 0.7) |
| Logged events 280–289 | 0 | ≤ 2000 per run (only notable) |
| A/B guards | — | polity count, largest share, wars/century within ±15 % of off |
| Runtime overhead | 213–220 s/run | ≤ +6 % |
The harness also prints per-polity timelines (L, perc vs true D, policy, risings per decade) for the five longest-lived polities and a list of the
largest waves with their causes. Shapes, not exact numbers, are the goal. Each target is [A] until tuned.

---

## 10. Performance and memory (estimates [A], based on [M] counts: ~350 members per step, ~3–8 k living settlements)
- Yearly: prices and custom O(living); sparks O(living) cheap math; per spark the fixed point K = 12 `exp` calls. With ~30–80 sparks a year and
  clusters of ~10 neighbour solves, that is ~10⁴ exp/year, so ~2·10⁷ per run: well under 1 s.
- Quiet E_i: every step, for members only (350 × 12 exp): negligible.
- Hawkes propagation only from towns that rose (sparse): O(risings × degree).
- Movements every step: O(2 slots × edges) ≈ 2·10⁴ per step, so ~10⁷ per run.
- Memory: per settlement ~14 numbers (~50 B) → ≤ 0.5 MB at 10 k settlements. Uprising rows ~45 B × 5–15 k → ≤ 0.7 MB.
  unrestHeat: snapshotInterval 5 → 401 × S bytes ≈ 1.2–3.2 MB (the same order as the existing per-snapshot Uint8 fields). Option: store it every
  10 y (`UP.heatInterval`) to halve it. Adherents are sparse (≤ 0.3 MB).
- Expected total runtime overhead: 2–5 %.

---

## 11. Risks, open questions, verified vs assumed

### Risks
1. **Too many revolutions** (the cascade and contagion feed each other). Guards: subcritical n0, at most one revolution per polity per year,
   the escalation rule needs ignore/failure/defection plus size, and the A/B targets.
2. **Capital overthrows destabilise rulers' dynastic stats**: ReignEnd.Revolution is capped by target (≤ 15 % of reign ends). rulers.test
   expectations on usurpation shares may need relaxing (as city-states 5.2 did).
3. **Cause labels flip with small terms**: argmax over 13 terms is noisy. `cause2` is recorded and the UI shows both. Open: argmax vs a draw ∝ terms.
4. **Moral-economy ratio and the bid**: dividing by `bid` removes the prosperity premium, but goods' scarcity prices for high-value classes do not touch
   grain [V trade.ts l.726]. Fine. Non-trader proxy prices are not market prices, so the two populations may differ in spike frequency. The harness
   reports both.
5. **Double counting with society**: resolved by 0.2 (Ψ in μ only). Review again when society lands. **With finances**: Taxes term is theirs (0.3).
6. **Shadow-mode equality** depends on taxShares/grievance hooks being skipped, not neutral-multiplied.
7. **Sensitive content** (4.11): keep it rare, abstract, sober. No legend embellishment. An option `UP.minorities` (default true) can turn it off.

### Open questions
1. Should stateless settlements have riots (against local elites, food riots)? v1: no.
2. Should concessions ratchet expectations more strongly (Tocqueville)? v1: fear × 0.7 only.
3. An export ban as a Hunger concession needs a trade hook (pairPolicy). Deferred.
4. Should revolutions inherit the riot's cluster as the successor state's members, even when the cluster spans > 60 towns? (cap 60 for now)
5. Partisan saga stance: waiting for the experience plan's Voice interface.
6. Levies as a war-strength lever (`UP.levyMass`): decide with battles/finances.

### Verified [V]
unrest.ts grievance/causeOf/unrestStep/revolt/revoltStep/fragment/realmStep bodies and line refs; civil.ts functions; UNREST params (revolt 0.55,
chance 0.06, spread 0.4, cluster 15, crush constants); POLITY.step 5; capitals' unrest 0; RevoltCause 0–4 at contract.ts l.1209; EventType list
(none ≥ 182 in the repo); HistoryEvent.extra; logX/logEventExtra; the yearly order in index.ts (trade before politySystem, rulerYear inside it);
setFoodPrices formula; taxShares/taxSystem (the tax is taken in bad harvests and sets badTax); rulers traits and their draws (system.ts 225–228),
AccessionHow 0–6, ReignEnd 0–8, R.lost; religion slots, persUntil, faithGrievance and flightStep; ideas are per people (not per settlement);
goods TraditionMoved deportation (cause 1); merchant pool mw (goods/merchants.ts); OrderKind 0–9 [contract l.1891]; ViewMode list; Voice registers
(`[chronicle], [legend]` phrase tables, ui/sagas/voice.ts); sagas state.ts revolts line; `mix32` in sim/rng.ts.
From other plans (read): finances 0.3/2.4 (pPay, finNeed, finSpend, taxMul, terms[5] Taxes); city-states 4.4/9 (rising draw and branches,
Charter); society 0.4/0.5/2.7 (psi, mmpAt, socUrban, h1/h2/h2b, the Ψ-once rule); beliefs 2.1/3.1 (foreign beliefs only); seat-mode 3.6
(Placate 17, Purge 18, Levy 20, Charter 21; OrderKinds from 30); grudges GrievanceKind 0–6; families SeatClose.Expelled.
### Measured [M]
Section 2 (four seeds), the Granovetter prototype (3., model 1), runtime 213–220 s per run.
### Assumed [A]
Every default constant in 4.3–4.11 and every target in 9; cruelty weights; the domestic-perception
model; the non-trader price proxy; Math.exp determinism across the engines used for goldens; disasters' and experience plans' interfaces.

## Addendum (central registry)
`GrievanceKind.KinAttacked` is **12**, not 11 (11 is battles' GeneralTurned). `ReignEnd.Revolution = 9` and OrderKind 30–32 are approved. See _CONVENTIONS.md.

## Addendum (from court-politics.md §0.4)
court-politics.md (built last) requests interface additions from this plan — read its §0.4 before implementing this plan, and add the listed functions/hooks as no-op stubs if court-politics is not yet built.

## References
Citation audit 2026-11-26. [verified] = a publisher, index (RePEc/IDEAS), catalogue or author page was opened and confirmed the entry;
notes say what it did not confirm. Every constant in 4.3–4.11 (λ0, n0 = 0.6, β, τ = 1.35, θ0, the response utilities, L0 by accession,
half-lives, pog0, …) and every target in 9 is a design default or [M] probe measurement, not a sourced fact. Not present in this plan,
so not cited: Chenoweth, Epstein (2002).

- Anderson, R. W., Johnson, N. D. & Koyama, M. (2017). Jewish persecutions and weather shocks: 1100–1800. *Economic Journal* 127(602):924–958. https://econpapers.repec.org/RePEc:wly:econjl:v:127:y:2017:i:602:p:924-958 [verified]
- Barany, Z. (2016). *How Armies Respond to Revolutions and Why*. Princeton Univ. Press. https://press.princeton.edu/isbn/9780691157368 [verified]
- Bellemare, M. F. (2015). Rising food prices, food price volatility, and social unrest. *American Journal of Agricultural Economics* 97(1):1–21. https://ideas.repec.org/a/oup/ajagec/v97y2015i1p1-21..html [verified]
- Braha, D. (2012). Global civil unrest: contagion, self-organization, and prediction. *PLoS ONE* 7(10):e48596. https://doi.org/10.1371/journal.pone.0048596 [verified; abstract: a nonlinear spatially extended spreading model, 170 countries 1919–2008, not a Hawkes process]
- Chorley, K. (1943). *Armies and the Art of Revolution*. London. https://libcat.library.tamu.edu/Record/in00000208794/Description [verified title and year; publisher (Faber) not confirmed]
- Clauset, A., Shalizi, C. R. & Newman, M. E. J. (2009). Power-law distributions in empirical data. *SIAM Review* 51(4):661–703. https://arxiv.org/abs/0706.1062 [verified]
- Cohn, N. (1957). *The Pursuit of the Millennium*. London: Secker & Warburg. https://www.cambridge.org/core/journals/church-history/article/abs/pursuit-of-the-millennium-by-norman-cohn-london-secker-and-warburg-1957-xvi-476-pp-including-an-appendix-bibliography-and-index-42-shillings/F0581B2CC5D7652461EDDBAE01F01E60 [verified]
- Davenport, C. (2007). State repression and political order. *Annual Review of Political Science* 10:1–23. https://doi.org/10.1146/annurev.polisci.10.101405.143216 [verified]
- Davies, J. C. (1962). Toward a theory of revolution. *American Sociological Review* 27:5–19. https://en.wikipedia.org/wiki/James_Chowning_Davies [verified via the Wikipedia reference; issue (1) not confirmed]
- Francisco, R. A. (1995). The relationship between coercion and protest: an empirical evaluation in three coercive states. *Journal of Conflict Resolution* 39(2):263–282. https://ideas.repec.org/a/sae/jocore/v39y1995i2p263-282.html [verified]
- Granovetter, M. (1978). Threshold models of collective behavior. *American Journal of Sociology* 83(6):1420–1443. JSTOR 2778111. https://sociology.stanford.edu/publications/threshold-models-collective-behavior [verified; the scanned first page reads 1420–1442, indexes give 1420–1443]
- Hawkes, A. G. (1971). Spectra of some self-exciting and mutually exciting point processes. *Biometrika* 58(1):83–90. https://doi.org/10.1093/biomet/58.1.83 [verified]
- Hawkes, A. G. & Oakes, D. (1974). A cluster process representation of a self-exciting process. *Journal of Applied Probability* 11(3):493–503. https://www.cambridge.org/core/journals/journal-of-applied-probability/article/cluster-process-representation-of-a-selfexciting-process/E836A3D07D808068E2F9F3E7E366B081 [verified authors, title and journal; volume, issue and pages not shown on the page]
- Kuran, T. (1989). Sparks and prairie fires: a theory of unanticipated political revolution. *Public Choice* 61(1):41–74. https://doi.org/10.1007/BF00116762 [verified]
- Kuran, T. (1991). Now out of never: the element of surprise in the East European revolution of 1989. *World Politics* 44(1):7–48. https://doi.org/10.2307/2010422 [verified]
- Kuran, T. (1995). *Private Truths, Public Lies: The Social Consequences of Preference Falsification*. Harvard Univ. Press. ISBN 978-0-674-70758-0. https://openlibrary.org/isbn/9780674707580 [verified]
- Lagi, M., Bertrand, K. Z. & Bar-Yam, Y. (2011). The food crises and political instability in North Africa and the Middle East. arXiv:1108.2455. https://arxiv.org/abs/1108.2455 [verified]
- Lichbach, M. I. (1987). Deterrence or escalation? The puzzle of aggregate studies of repression and dissent. *Journal of Conflict Resolution* 31(2):266–297. https://ideas.repec.org/a/sae/jocore/v31y1987i2p266-297.html [verified]
- Rudé, G. (1964). *The Crowd in History: A Study of Popular Disturbances in France and England, 1730–1848*. https://libcat.library.tamu.edu/Record/in00000458539/Description [verified title and year; publisher (Wiley) not confirmed]
- Russell, D. E. H. (1974). *Rebellion, Revolution, and Armed Force: A Comparative Study of Fifteen Countries*. Academic Press. https://shop.elsevier.com/books/rebellion-revolution-and-armed-force/russell/978-0-12-785745-9 [verified]
- Scott, J. C. (1976). *The Moral Economy of the Peasant: Rebellion and Subsistence in Southeast Asia*. New Haven: Yale Univ. Press. https://yalebooks.yale.edu/book/9780300021905/moral-economy-peasant [verified]
- Simpson, E. H. (1949). Measurement of diversity. *Nature* 163:688. https://doi.org/10.1038/163688a0 [verified]
- Thompson, E. P. (1971). The moral economy of the English crowd in the eighteenth century. *Past & Present* 50:76–136. https://doi.org/10.1093/past/50.1.76 [verified]
- Tocqueville, A. de (1856). *L'Ancien Régime et la Révolution* (*The Old Regime and the Revolution*). https://en.wikipedia.org/wiki/Old_Regime_and_Revolution [verified title and year; the page does not confirm the rising-expectations / "reform is the dangerous moment" reading, so that attribution stays unverified]
- Voigtländer, N. & Voth, H.-J. (2012). Persecution perpetuated: the medieval origins of anti-Semitic violence in Nazi Germany. *Quarterly Journal of Economics* 127(3):1339–1392. https://econpapers.repec.org/RePEc:oup:qjecon:v:127:y:2012:i:3:p:1339-1392 [verified]
- Weber, M. (1922). *Wirtschaft und Gesellschaft*; Engl. *Economy and Society*, ed. G. Roth & C. Wittich, Berkeley: Univ. of California Press, 1978, pp. 215–216 (the three types of legitimate rule). https://en.wikipedia.org/wiki/The_Three_Types_of_Legitimate_Rule [verified via the Wikipedia reference]
- Zipf, G. K. (1949). *Human Behavior and the Principle of Least Effort: An Introduction to Human Ecology*. Cambridge, MA: Addison-Wesley. https://www.mpi.nl/node/44454 [verified]
- Uncited concepts, labelled in the text: *taxation populaire* (attributed to the moral-economy literature) and the SIS epidemic model [unverified]

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **Semantic owner of C2 (revolt) and C10 (movement spread)** (MASTER-PLAN §2.3).
- **Terms (R13, R36).** `CAUSE_OF_TERM` gains `terms[13]` **Displaced** → RevoltCause 17 (future-tech) and `terms[14]` **Generations** → RevoltCause 18 (FP). The disasters grievance adds to term 0 (Peasant). No plan may add a multiplicative hazard term other than `socRevoltMul`.
- **R10.** City-states' burghers draw becomes a Commune trigger (`UP.communeSpark` 0.5) when you are on. Resolution only through `govRisingResolve`. A shared `rose[i]` gate covers you, city-states and court's estates.
- §0.1 and §0.9 `KinAttacked = 11` are stale: it is **12**. ConcessionKind is unchanged, but infrastructure's EventType 354 is renamed `ConcessionGranted` so that your `Concession: 282` stays unique (R4c).
- **§2.6.** Store `unrestHeat` every 10 years (`UP.heatInterval = 10`) for everyone.


## Addendum (barriers & cold war)
Overrides the body and earlier addenda where they differ. Source of truth: barriers-coldwar.md (formulas, params, ids).
- **Cross-polity kernel edges** (§4.4) get weight `× e_mass` between the two polities, inside the normalisation, like
  `wireW`. The branching bound is unchanged. There is no cold-war term in C2 (CW-R3). Aid to rebels exists only as
  aid to a CivilWar side.
