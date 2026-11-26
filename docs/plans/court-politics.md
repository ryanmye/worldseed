# Plan: Court politics — regimes, estates and councils, factions, offices (politics inside a realm)

Status: PLAN ONLY, built LAST (after every plan in README's build order). It is written against the read-only checkout
`/home/claude/ryanmye/worldseed` at commit 8cabf09. It ties together grudges-and-oaths, state-finances, merchant-families,
city-states, battles, beliefs-and-deception, society-secular-cycles, riots-uprisings, seat-mode and
experience-whatif-director-sagas (all read in full for this plan; their names are adopted unchanged unless an amendment
is stated in section 0).
Marks: **[V]** read in the 8cabf09 tree (file:function). **[M]** measured on the scratch copy `/home/claude/scratch-court`
(probe `scripts/courtProbe.ts`, Node 22.23, default options, 2000 years, seeds 1, 7, 42, 1234). **[A]** assumed: a design
choice or a constant to tune. **[D]** a contested or debated claim in the literature, cited as such.

Today a state acts as one mind: its ruler's traits (`rWar`, `rAbility`, `rPiety`, `rTol`) multiply single draws
(war.ts `declarations` `mul = rulerWar(...)` [V war.ts:89, rulers/system.ts:391]). This plan adds the people around
the throne, and the slow change of the kind of state they make:
1. **Regime** — a finer form under monarchy-like governments (tribal kingship, steppe khanate, patrimonial, feudal,
   estates, elective, absolutist, bureaucratic, military-slave, sultanistic, constitutional), a dated change log with
   causes, and a transition graph driven by sim quantities (section 3).
2. **Estates and assemblies** — nobles, clergy, towns and (rarely) peasants as corporate bodies; the crown summons them
   when it needs extraordinary money, and they bargain taxes against privileges (Rubinstein split with outside options,
   section 4). Privileges accumulate into institutions that change later behaviour (credible commitment).
3. **Offices** — a small fixed set per realm, held by named persons with competence and loyalty (section 5).
4. **Factions** — war, peace, faith, merchant, regent's and favourite's parties lobby the ruler. The winner sets a
   policy vector the other systems read. Losers plot (section 6).
5. **Seat mode** — the court becomes the main source of decision cards (section 9).
6. **Prose** — Chronicle and Legend, and partisan sagas told by a faction (section 10).

Cost is bounded: full courts only for Kingdom tier and above; chiefdoms keep a regime label and nothing else; civic
governments (republics, free cities, leagues) and theocracies are left to city-states (section 7).

---

## 0. Interfaces (one contract for the implementer)

### 0.1 Ids and enum values (this plan's)
| what | values | note |
|---|---|---|
| EventType | **290–299** (section 8.2) | the block given to this plan |
| RevoltCause | **16 Estates** | next free after riots' 8–15 |
| GrievanceKind | **13 Asylum** | next free after 12 KinAttacked |
| ReignEnd | **10 Murdered, 11 EstatesDeposed** | next free after 9 Revolution |
| OrderKind | **33 SummonEstates, 34 Appoint, 35 Dismiss, 36 Favour, 37 Arrest, 38 Reform** | contiguous after riots' 30–32; `ORDER_KIND_COUNT` → 39 |
| seat `DecisionKind` | **18 Estates, 19 Council, 20 Office, 21 Plot, 22 Reform, 23 Regency, 24 Exile** | seat-mode uses 0–17; the registry has no DecisionKind row: **asked of the coordinator to add "DecisionKind 0–17 seat-mode, 18–24 court-politics"** |
| RNG stream | `'history-court'` | created only when on |
| HistoryOptions | `court?: boolean` | needs polities and rulers |

New enums of this plan (contract, section 8.1): `Regime`, `RegimeCause`, `ArmyKind`, `EstateKind`, `AssemblyKind`,
`Privilege` (bit indices), `SessionOutcome`, `OfficeKind`, `OfficeEnd`, `HolderOrigin`, `FactionKind`, `PlotKind`,
`PlotEnd`, `CourtReformKind`.

### 0.2 The field it adds next to city-states' government type
city-states.md 3.1 gives every polity a `Government` (Monarchy 0, Republic 1, FreeCity 2, Signoria 3, Theocracy 4,
Confederation 5, League 6) in `History.governments` (change log, offsets by polity). This plan adds a **parallel change
log `History.regimes`** (same layout: `regimes`, `regimeOffsets`, `regimeIds`) holding a `Regime` per polity over time,
and in the sim `C.regime: Uint8Array` per polity, next to `G.form`. The two are kept consistent by one rule:

| Government (city-states) | allowed Regime | who changes it |
|---|---|---|
| Monarchy | Tribal, Patrimonial, Feudal, Estates, Elective, Absolutist, Bureaucratic, MilitarySlave, Sultanistic, Constitutional | this plan (3.4) |
| Signoria | Patrimonial (a family's lordship) or Sultanistic (a strongman's) at seizure; then as Monarchy | city-states seizes; this plan sets the first regime |
| Confederation | Nomadic (forced) | city-states; at `Settled` → this plan sets Patrimonial |
| Theocracy | Clerical (forced) | city-states; at `Secularised` → Patrimonial |
| Republic, FreeCity, League | Civic (forced) | city-states; a council abolishing a throne → Civic |

Hook asked of city-states: **`setForm` calls `courtGovChanged(s, p, form, cause)`** after it writes the row (one call,
no draws; null-guarded). When city-states is not built (`s.gov === null`), every polity is monarchy-like, except
`PolityOrigin.League` polities, which get Civic. `GOV` modifiers (city-states 4.11) act by Government; this plan's
regime modifiers (3.6) act **only for Government ∈ {Monarchy, Signoria}** (or every non-League polity with `s.gov`
null), so the two never multiply the same hook twice. UI helper `regimeAt(h, p, year)` in `ui/courtData.ts`, the
analogue of their `govAt`.

### 0.3 What this plan reads, per plan (each with a proxy fallback; every call guarded by `s.x !== null`)
| plan | read / called | proxy without it |
|---|---|---|
| rulers (in repo, **hard dependency**) | `R.cur, rAbility, rWar, rPiety, rTol, rBorn, rHow, rDyn, hN/hBorn…, law, lost, surv, kill`; `accede`, `succession`, `newHouseAccede` (with the born/female override battles adds), `deathYear` | court off (`createCourt` returns null without `s.rul`) |
| society (240s) | `socElite` ε, `socOverprod` o, `socCoercion` κ, `socRent`, clergy share `soc.cler[p]`, `socPhase`, `emp` | nobles 1, clergy 0.5, κ 0.5, rent 1 (constants: estates then differ only by towns and faith) |
| state-finances (210s) | `finNeed, finSFD, finMonetised, finRevenue (R), revOrd (R°), finTreasury, finSpend, finCredit, finTownRevenue, finDefaulted, fin.rate[p], fin.taxMul, finFundYears` (beliefs' amendment) | need = city-states' 4.3 proxy; monetised = the ruling people holds `coinage` (ideas) and capital wealth ≥ 2000; revenue = `WEALTH.decay·wealth[cap] + pRevSm` |
| merchant-families (161s) | `topFamilies, familyCapitalAt, familyInfluence, familyName (assembly)` — pure reads | towns' strength from `mw` only; Merchant-origin holders unnamed by family |
| city-states (200s) | `G.form`, `govCharterGrant`, `govRisingResolve`, `topFamilies` council, `setForm` hook | Government ≡ Monarchy (League origin → Civic); towns that win → `revoltAt` secession |
| battles (220s) | `Commanders` rows, `pVeteran`, fame, `battleCoup`, `generalBase`, CommanderDismissed (227) | Marshal is a plain holder; competence scales `rulerMass` by a small factor (5.4) |
| beliefs (230s) | `bel.spy[p]`, `bel.counter[p]`, `iSpy` channel, `cred` | spymaster acts only on plot detection and riots' perception |
| grudges (190s) | `recordGrievance`, `standingGrudges`, `threatOf` θ, `oathDelta` δ | War-party strength from rivalry `relR`; no Asylum row |
| riots-uprisings (280s) | `up.L` legitimacy, `cruelty(r)`, `up.T` tyranny memory, tyranny acts, policy bits `up.pol`, `revoltAt`, `rulerOverthrownByCrowd`, ConcessionKind.MinisterDismissed | legitimacy from AccessionHow table (their 4.6 L0); cruelty 0.3; no tyranny acts; estates' refusals raise `ps.unrest` directly |
| religion (in repo) | `rel.state[p]`, `rel.org[f]`, `rel.zeal`, `persUntil`, `polityFaith` | no clergy estate, no Faith faction, no ChiefPriest |
| ideas (in repo) | `ix.held[people·I + i]` for keys writing, lawCode, paper, printing, coinage, banking, gunpowder, riding, stirrup [V ideas/params.ts keys] | literacy proxy `0.7·smoothstep(500, 1500, year − firstStateYear)` [A] |
| seat-mode (270s) | watcher, `Decision` rows, `ORDER_KINDS`, `Choice`, `ox.rng` | — |
| experience/sagas | `registerDrama`, `Pov`, `lens.ts` | — |
| language-drift | names through `naming.language(tribe, level)` as all name sites do | unchanged |
| perf P6 | `CourtState` is part of `RunnerState` (no module-level state) | — |

### 0.4 Amendments asked of other plans (all small; each null-guarded and draw-neutral)
- **state-finances**: (a) `finCredit` kinds `'grant'` (an estates' grant) and `'venal'` (offices sold), booked as coin
  income this year; (b) `rateMul` becomes a product `govRate · courtRate`: city-states keeps `setRateMul`, this plan calls
  `setCourtRateMul(s, p, m)` (default 1; skipped when `s.court` is null); (c) the wealth-tax line multiplies
  `courtTaxEff(s, p)` (3.6, 5.4) — skipped, not ×1, when court is off; (d) under Privilege.Consent the tax-pressure rise
  `taxUp` is halved unless a grant was voted in the last 10 years (4.6); (e) export `finOutsideBorrow(s, p, x): number`
  (the headroom-limited amount the 2.4.5 rule would lend now, pure) and `finCanDebase(s, p): boolean` (the 2.4.9 gate,
  pure). Both are read-only extractions with identical arithmetic.
- **battles**: export `battleNewCommander(bs, p, born, female, skill, dyn): number` (row creation with given values, no
  draws) and `battleRecall(bs, p, cmd)` (sets `pVeteran[p]`). The court's Marshal is the commander battles recalls (5.4).
- **beliefs**: `beliefDefector(s, q, p, comp)` — a one-off hard-channel update of q's belief of p with precision
  `BELIEF.iSpy · comp` and source bit Spies (64); the spymaster multiplies `iSpy` and `counter` (5.4).
- **grudges**: `GrievanceKind.Asylum = 13`, weight `COURT.asylumW` 0.25, recorded by `recordGrievance` when a court
  exile is received (6.6).
- **riots-uprisings**: (a) their policy noise `ν` uses `(1.6 − max(ability, chancellor competence))`; (b) the policy
  biases of 6.4 add to their `taxLvl/relief/levy` scores and response utilities; (c) MinisterDismissed concession calls
  `courtDismiss(s, p, OfficeKind.Chancellor, OfficeEnd.Dismissed)` so a real person falls; (d) when this plan executes a
  noble holder it logs their Tyranny NoblesExecuted act through their exported `tyrannyAct(s, p, kind, site)`.
- **seat-mode**: DecisionKind rows 18–24 and option keys (9.1); `PRIORITY` gains them; court cards replace Credit (12)
  and General (8) when court is on (9.1).
- **experience-whatif-director-sagas**: `Pov.kind` gains `'faction'` (10.4) and drama rules for 290–299 (10.5).
- **city-states**: `courtGovChanged` hook (0.2); republics' Signoria seizure reads `courtPlotHeat(s, p)` (optional).

---

## 1. Current behaviour

### 1.1 One mind [V]
- War: `declarations` (war.ts:68) multiplies its single `ps.rngWar` draw by `rulerWar(s.rul, p)` = `RULERS.warBase + rWar`
  (rulers/system.ts:391), `holyDrive`, and orders. No one else at court has a say.
- Peace: `campaigns` (war.ts:413) `tired` uses one draw against `WAR.peaceChance`; no court input.
- Overthrow: `rulerYear` (rulers/system.ts:436–441) `x = overthrow · weak · (1 + e + crisis + lostRecently·overthrowLost)`,
  a "magnate" in the abstract. `succession` → `contested` (l.551) opens civil wars with a rival centre.
- Regency: `accede` logs Regency (84) and sets `pCrisisUntil` for a minor (l.240–247). No regent exists as a person.
- Mass: `rulerMass` = `1 + RULERS.mass·(ability − 1)` (l.384). Taxes: `taxSystem` (polity/system.ts:192) wealth tax
  `P.wealthTax · WEALTH.decay`. Tariffs: `tariffStep` (policy.ts). Persecution: religion's `rulersStep` (religion/system.ts:485).
- No offices, no estates, no assemblies, no factions, and no notion of regime beyond `PolityOrigin` and tier
  (`tierOf`, polity/state.ts; contract.ts:1213 doc).

### 1.2 Baseline at Kingdom tier and above [M] (`courtProbe.ts`; events counted when the event's settlement is a member of a Kingdom+ polity that year)
| seed | polities | ever Kingdom+ | Kingdom+ polity-years | Empire polity-years | mean / max Kingdom+ alive | reigns acceded | Overthrown | Deposed | SuccessionCrisis | Regency | CivilWar | wars declared | revolts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 70 | 58 | 20 607 | 1 485 | 10.3 / 22 | 885 | 14 | 10 | 215 | 133 | 13 | 93 | 381 |
| 7 | 83 | 62 | 14 596 | 1 457 | 7.3 / 20 | 688 | 11 | 9 | 153 | 101 | 15 | 90 | 388 |
| 42 | 85 | 63 | 15 742 | 2 701 | 7.9 / 20 | 768 | 9 | 6 | 185 | 118 | 15 | 92 | 476 |
| 1234 | 69 | 49 | 15 638 | 2 668 | 7.8 / 23 | 790 | 5 | 12 | 160 | 99 | 9 | 72 | 550 |

Reading: 7–10 full courts are alive on average and at most ~23 at once. That fixes the cost (section 13). Overthrows
plus depositions at Kingdom+ are **15–24 per run**. That is low against history (attributed to Blaydes & Chaney 2013: roughly a
fifth to a quarter of medieval European monarchs and more Islamic sultans deposed or killed [D: their coding];
**[unverified]: this figure was not confirmed on any fetched page and may come from another source; check before use**). Court
coups have room to add, within the guard of section 12. Run time was ~28 s per seed with four seeds in parallel on this VM.

---

## 2. Models and sources (cite in code headers; constants are design choices unless said)
- **Bargaining**: Nash (1950) *Econometrica* 18(2):155–162; Rubinstein (1982) *Econometrica* 50(1):97–109 (alternating
  offers; as the period shrinks, a player's share tends to the *other* side's rate over the sum, so the estates get
  `r_c/(r_c + r_e)` and the more patient side (lower r) gets more (MIT 6.972 2005); the limit is the Nash solution
  (Binmore, Rubinstein & Wolinsky 1986), asymmetric with weights ∝ 1/r **[unverified detail]**);
  Binmore, Rubinstein & Wolinsky (1986) *RAND J. Econ.* 17(2):176–188 — **outside options act as constraints, not threat points**
  (the outside-option principle). This plan uses the BRW form (4.4).
- **Fiscal bargains and assemblies**: Hoffman & Rosenthal (1997), "The political economy of warfare and taxation in
  early modern Europe", in Drobak & Nye eds., pp. 31–55; Bates & Lien (1985)
  "A note on taxation, development and representative government", *Politics & Society* 14(1):53–70 (mobile assets → bargaining power of their owners);
  Levi (1988) *Of Rule and Revenue* (quasi-voluntary compliance: consented taxes are paid more readily); Stasavage (2010)
  "When distance mattered" *APSR* 104(4):625–643 and (2011) *States of Credit* (compact polities with merchant-dominated assemblies
  borrowed cheaper); van Zanden, Buringh & Bosker (2012) *EHR* 65(3):835–861 (parliamentary activity in Europe 1188–1789).
- **Credible commitment**: North & Weingast (1989) *J. Econ. Hist.* 49(4):803–832 — after 1688 parliamentary control made English
  crown debt credible and cheaper (their Table 4: 14% on the first long-term loans of 1693, 6–8% by the late 1690s,
  3% by the 1730s). **[D]** Sussman & Yafeh (2006) *J. Econ. Hist.* 66(4):906–935 find British rates stayed high and
  volatile for about four decades after 1688; Clark (1996) finds no sharp fall in (private) interest rates after 1688,
  i.e. property was already secure by c. 1600 (as summarised by Pincus & Robinson 2011); Pincus & Robinson (2011) and
  Stasavage (2003) attribute the change to the Whigs and party politics rather than the institutions alone. Used here as a modest,
  tunable rate factor (4.6), not a law.
- **Factions and coups**: Bueno de Mesquita et al. (2003) *The Logic of Political Survival* (winning coalition and
  selectorate); Svolik (2012) *The Politics of Authoritarian Rule* (the ruler's main threat is his inner circle);
  Powell & Thyne (2011) *J. Peace Res.* 48(2):249–259 (about half of modern coup attempts succeed: 227 of 457 in 1950–2010 — modern data, used only as a
  loose check); Elias (1969) *Die höfische Gesellschaft* (Eng. *The Court Society*, 1983) (favour and factions at court).
- **State formation and regimes**: Tilly (1990) *Coercion, Capital, and European States* (coercion-intensive,
  capital-intensive and capitalised-coercion paths; "war and preparation for war produced the major components of European
  states"; the slogan "war made the state" is Tilly's 1975 formulation **[unverified]**) **[D: Eurocentric; Centeno 2002 for Latin
  America, Hui 2005 for ancient China]**; Ertman (1997) *Birth of the Leviathan* (timing of sustained geopolitical
  competition × type of local assemblies → patrimonial or bureaucratic, absolutist or constitutional) **[D]**;
  Downing (1992) *The Military Revolution and Political Change* (military revolution + domestic resource mobilisation
  → military-bureaucratic absolutism; foreign resources or geography let constitutionalism survive); Brewer (1989)
  *The Sinews of Power* (the fiscal-military state; Britain taxed more per head than France); Moore (1966) *Social
  Origins of Dictatorship and Democracy* (lords–peasants–bourgeoisie balance) **[D]**; Weber, *Economy and Society*
  (traditional, charismatic, rational-legal legitimacy; routinisation of charisma; patrimonialism and sultanism);
  Chehabi & Linz eds. (1998) *Sultanistic Regimes*; Ibn Khaldun, *Muqaddimah* (asabiya; already in unrest.ts
  cohesion); Barfield (1989) *The Perilous Frontier* (steppe–sedentary symbiosis, the outer-frontier strategy, rapid
  rise and fission of nomad confederations); Crone (1980) *Slaves on Horses* and Pipes (1981) *Slave Soldiers and
  Islam* (military slavery); Blaydes & Chaney (2013) *APSR* 107 (feudal Europe's rulers grew longer-lived than sultans
  relying on mamluks) **[D: coding of tenures]**; Bloch (1939–40) *Feudal Society* and Strayer (1970) for feudal
  fragmentation after the Carolingians; Elman (2000) *A Cultural History of Civil Examinations*; Doyle (1996) *Venality*
  (sale of offices in France); Fukuyama (2011) *The Origins of Political Order* as a synthesis.
- **Scope note**: these are verbal theories. The plan reduces each to a hazard with a few monotone factors. The
  factor directions are taken from the sources; every number is [A] — a **design default, not a sourced fact** — and
  tuned against the qualitative targets of 12. Verification status of each source: References (end of plan).

---

## 3. Regimes: the evolution of kingdom politics

### 3.1 The enum and what each regime is
```ts
/** Regime of a monarchy-like polity (History.regimes): the kind of state behind the throne. Civic and Clerical mirror city-states' non-monarchic Governments. */
export const Regime = {
  Tribal: 0, // chiefdom or tribal kingship: the chief's kin and the elders; no offices, no estates
  Nomadic: 1, // a steppe khanate or confederation of herding clans: tanistry, rapid rise, quick fission (Barfield)
  Patrimonial: 2, // the realm as the royal household: offices are household posts, given to kin and favourites (Weber)
  Feudal: 3, // lords hold fiefs and lead their own levies; the king is first among them (Bloch); the great council of barons
  Estates: 4, // the crown governs with the estates in a diet (Ständestaat): taxes by grant, privileges by charter
  Elective: 5, // the great men elect the king (Holy Roman Empire, Poland-Lithuania): electors bargain at every succession
  Absolutist: 6, // a standing army and salaried (often venal) officials; the estates lapse (France after 1614)
  Bureaucratic: 7, // an imperial bureaucracy of officials recruited by merit and examination (the Chinese model)
  MilitarySlave: 8, // the ruler's army of bought outsiders (mamluks, janissaries) comes to rule through him or in his place
  Sultanistic: 9, // personal rule by a strongman and his favourites, unbound by tradition or law (Weber; Chehabi & Linz)
  Constitutional: 10, // the crown bound by a standing parliament that controls taxes and accounts
  Civic: 11, // a republic, free city or league (city-states' Government): no crown; this plan keeps out
  Clerical: 12, // a theocracy (city-states' Government.Theocracy)
} as const
```
Weber's legitimacy type is derived for UI and prose, not stored: **Traditional** (Tribal, Nomadic, Patrimonial, Feudal,
Estates, Elective), **Charismatic** (Sultanistic, and any first reign of a house acceding Founded/Usurped/Claimed or a
general who seized the throne), **Rational-legal** (Bureaucratic, Absolutist with `lawCode`, Constitutional).

### 3.2 Indicators (per polity, every slow step; pure reads; all 0..1 unless said) — `court/regime.ts regimeInputs`
```
Wsh   = years at war in the last slowStep / slowStep  (ps.pWars[p] > 0, counted yearly in courtYear)
thr   = grudges ? max θ(c→p) over relations : smoothstep(0.3, 1.2, max relR over border relations)
W     ← W + 0.2 · (Wsh·(0.5 + 0.5·thr) − W)               war pressure, ~50-year memory
Wl    ← Wl + 0.05 · (Wsh·(0.5 + 0.5·thr) − Wl)            sustained geopolitical competition, ~200-year memory (Ertman's "timing")
Fis   = fin ? clamp(finSFD − 1, 0, 1) : need proxy         fiscal strain
Mon   = finMonetised(s, p)  (proxy 0.3)                     a coined budget
C     = smoothstep(0.5, 4, (Σ_m mw[m] + 0.5·Σ_{m town} wealth[m]) / (pPop + 1))
        · (0.5 + 0.5·min(1, u / 0.2))                      Tilly's capital: merchant capital a head × urban share u (society, else town pop / pPop)
K     = (1 − C) · (0.5 + 0.5·κ)                            Tilly's coercion-intensive: land-rich, few cities, bound peasants
Lit   = 0.3·writing + 0.3·lawCode + 0.2·paper + 0.2·printing   (ideas held by the ruling people; proxy in 0.3)
SigN  = nobles' estate share σ_N (4.2);  SigT = towns' σ_T
Asm   = assembly ? min(1, sessions in 100 y / 5) · (0.4 + 0.6·nPriv / 8) : 0
Herd  = city-states' herder test for Confederation, else [capital grainShare < 0.3 and the ruling people holds riding]
Coll  = 1 if within 50 y: p is a successor (Seceded, CivilWar, Partition, Fragmented parent) of a polity that was Empire tier,
        or p lost its capital to conquest, or (CrownDefault and a lost war within 20 y); else 0
Slave = Mon ≥ 0.5 · [a border relation with a Nomadic- or Tribal-regime polity of another people] · (1 − min(1, ps.pAsab[p] / 0.3))
Usurp = 1 when the current reign acceded Usurped/Claimed, or battles' GeneralSeized, or court's MinisterSeized (8.2: 297)
Su    = min(1, (SuccessionCrisis + contested + CivilWar at p in 100 y) / 3)
Ext   = house extinctions at p in 100 y (DynastyEnded of the house on its throne)
```
State per polity: `W, Wl: Float32Array`, plus the counters these need (kept in `C`, updated by the yearly event scan).

### 3.3 Founding regime (`courtNewPolity`, called in `newPolity` after `govNewPolity` and before `rulerNewPolity`)
- Government forced (0.2): Confederation → Nomadic, Theocracy → Clerical, Republic/FreeCity/League → Civic.
- Successor (origin Seceded, CivilWar, Partition, Revolt-secession) of parent q: **Feudal** if `Coll` holds for q (an
  empire breaking up re-feudalises its pieces; Bloch, Strayer), else q's regime. Civic parent → Patrimonial.
- Reunified (kinStep) of a Bureaucratic lineage with `Lit ≥ 0.5`: Bureaucratic (a restored dynasty restores the
  bureaucracy; the Chinese dynastic pattern). Otherwise the absorber's rules apply (the polity id continues).
- Formed: Tribal; Nomadic when `Herd ≥ 0.5`.
- No draw. `RegimeChanged` is **not** logged for a founding row (the PolityFormed/CivilWar events already tell it).

### 3.4 The transition graph (`court/regime.ts regimeStep`, every slow step; one `'history-court'` draw per eligible polity)
For each monarchy-like polity in `ps.alive` order, compute the hazard `h_k` of each allowed target k (a slow step = 10
years). If `H = Σ h_k > 0`, draw `u`; walk the targets in the table's order; the first with `u < Σ_{j ≤ k} h_j` is taken
(`H` capped at 0.9). Event-triggered transitions set a `pending[p]` boost read at the next slow step, so there is **still
one draw per polity per step**. `sm(a, b, x)` is smoothstep.

| # | from → to | hazard per slow step h | historical pattern; typical time to transition (≈ 10 y / h) |
|---|---|---|---|
| T1 | Tribal → Patrimonial | `0.15 + 0.35·Lit`, gate tier ≥ Kingdom for 2 steps | chiefdom to kingship as the realm outgrows kin rule; 20–70 y after Kingdom |
| T2 | Tribal → Nomadic | `0.5·Herd`, gate Kingdom | steppe confederation (Xiongnu, Mongols) |
| T3 | Nomadic → Patrimonial | `0.2·sm(0.5, 0.8, sedentary member share)·(0.5 + Lit)` for 50 y; or city-states `Settled` (forced) | conquest dynasty sedentarises (Barfield); 50–150 y |
| T4 | Patrimonial → Feudal | `0.3·Coll + 0.08·sm(15, 40, members)·(1 − Lit)·K·(1 − pReach/reachRef)` | Carolingian fragmentation, Zhou fiefs: a big realm with poor administration hands land for service; 50–150 y, or at once after collapse |
| T5 | Feudal → Patrimonial | `0.05·sm(1.1, 1.4, ability)·(1 − SigN)·(1 + W)` | a strong king recentralises (Capetian growth); 100–300 y |
| T6 | Feudal → Estates | `0.4·[≥ 3 sessions in 100 y]·[Consent or Standing held]` (emergent from section 4) | Ständestaat, 13th–14th c.: 150–300 y after monetisation |
| T7 | Feudal, Patrimonial, Estates → Elective | `0.3·[law Elective or Ext ≥ 2]·sm(0.4, 0.7, SigN)·(1 + [Succession privilege])` | HRE electors, Poland 1572 |
| T8 | Elective → Estates (or Patrimonial if no assembly) | `0.2·[the same house elected ≥ 4 times running]` | de-facto hereditary (Habsburgs) |
| T9 | Estates, Feudal → Absolutist | `0.12·sm(0.4, 0.8, Wl)·sm(0.4, 0.8, Lit)·Mon·(1 − Asm)·(1 + coerceWins)` | Ertman/Downing: early, sustained war, mobilised at home, assemblies divided by order; France 1614→1789; 100–250 y |
| T10 | Estates → Constitutional | `0.25·[Audit ∧ Consent ∧ Standing]·sm(0.3, 0.5, SigT)·(1 + 2·[crown default, EstatesDeposed or an Estates revolt won in 30 y])` | England 1688, the Dutch: strong territorial assembly + trade wealth; rare |
| T11 | Absolutist → Constitutional | pending 0.5 after a `Revolution` (riots ReignEnd 9) or an Estates revolt won with the assembly sitting | France 1789–91 |
| T12 | Constitutional, Estates → Absolutist | pending 0.3 after a successful Marshal coup (6.5) or a civil war won by the crown against the assembly's side | restorations, Cromwell inverted |
| T13 | Patrimonial → Bureaucratic | `0.1·sm(0.5, 0.9, Lit)·[Empire]·(1 − SigN)·(1 + [EliteThinned (246) or CivilWar in 50 y])·[polity age ≥ 100]` | Sui-Tang exams after reunification (589 → 605); aristocracy weakened first; 100–300 y |
| T14 | Bureaucratic, Absolutist → Feudal | `0.3·Coll + 0.1·[capital lost or Fragmented successors]·(1 − Lit)` | warlordism after dynastic collapse (late Tang, late Han) |
| T15 | Patrimonial, Sultanistic → MilitarySlave | `0.06·Slave·sm(0.3, 0.7, W)·[CourtReform SlaveCorps held ≥ 30 y]` | Abbasid Samarra (9th c.), the Mamluk sultanate (1250): the corps becomes the state; 30–100 y after the corps |
| T16 | MilitarySlave → Patrimonial / Sultanistic | `0.03 + pending 0.5 after CorpsDestroyed (an able ruler's purge, or the corps lost a war decisively)` | Mahmud II 1826 |
| T17 | any monarchy-like except Constitutional → Sultanistic | `0.2·Usurp·(1 − Asm)·cr·(1 − 0.5·Lit)` | personal rule of a usurper (Weber) |
| T18 | Sultanistic → Patrimonial | pending 0.5 at the first succession after the founder (routinisation of charisma) | the founder's heir rules by custom |

Rules:
- **Reversals** are T5, T12, T14, T16, T18 and the founding rule (3.3): re-feudalisation after collapse, restoration,
  re-patrimonialisation.
- **Absolutist and Bureaucratic need literacy, war and money** by construction (T9: `Lit`, `Wl`, `Mon`; T13: `Lit`,
  Empire). **Constitutional needs an assembly with three privileges and towns** (T10). That is the qualitative
  ordering asked for, and the harness checks it (12).
- Moore's balance enters through `κ` (society) in `K` and `SigT` in T10: bound peasants and strong lords push toward
  Feudal/Absolutist; strong towns toward Estates/Constitutional. **[D]**
- Tilly's paths: `C` high favours Estates/Constitutional (T6, T10 through SigT and the assembly) and city-states' risings
  (their plan); `K` high favours Feudal and Absolutist. A realm with both ("capitalised coercion") goes Estates → (Wl
  decides) Absolutist or Constitutional.
- `RegimeChanged` (292) is logged with `RegimeCause` (8.1).

### 3.5 Army kind (derived, stored per polity, `ArmyKind`)
`Levy 0` (Tribal, Patrimonial), `Host 1` (Feudal, Elective: vassals' levies), `Horde 2` (Nomadic), `Mercenary 3`
(Estates or Patrimonial with `Mon ≥ 0.7` and Σmw/pPop ≥ 2, or city-states' `GOV.merc > 0`), `Standing 4` (Absolutist,
Bureaucratic, Constitutional, or CourtReform StandingArmy), `Slave 5` (MilitarySlave, or SlaveCorps reform). Read by the
modifiers in 3.6, the factions (6.2) and the battles commander pool (Slave: commanders `kin = 0`).
Reforms are events (299): **StandingArmy** (Estates/Absolutist/Patrimonial, `Wl ≥ 0.5`, `Mon`, `gunpowder` held: one
gated draw `< 0.1` per step), **VenalOffices** (Absolutist with finances in arrears: offices sold, 5.3), **SlaveCorps**
(`Slave ≥ 0.5`, gated draw `< 0.08`), **CorpsDestroyed** (16 via 6.5 or a lost war with the corps' marshal slain). These
draws are part of the regime step's single draw: the reform hazards are appended to the transition list as pseudo-targets
(they change `C.reforms[p]` bits, not the regime).

### 3.6 What each regime changes (`court/params.ts REGIME`, arrays indexed by Regime; all [A])
Hooks act only for Government Monarchy/Signoria (0.2). Each is skipped (not ×1) when `s.court` is null.

| key | hook site | Tri | Nom | Pat | Feu | Est | Ele | Abs | Bur | MSl | Sul | Con | meaning |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `tax` | `taxSystem` wealth tax `w ·=` (and finances 2.4.1, amendment c) | 0.5 | 0.5 | 0.8 | 0.6 | 0.9 | 0.7 | 1.2 | 1.3 | 1.0 | 0.9 | 1.3 | tax capacity (design defaults; only the ordering Britain ≥ France follows Brewer 1989) |
| `rate` | `setCourtRateMul` | 1.3 | 1.3 | 1.15 | 1.1 | 0.95 | 1.05 | 1.1 | 1.0 | 1.15 | 1.3 | 0.85 | borrowing rate before privileges (4.6) |
| `mass` | `rulerMass` result `·` (control.ts) | 1 | 1.2 | 1 | 0.95 | 1 | 0.9 | 1.15 | 1.05 | 1.2 | 1 | 1.1 | army kind and size |
| `armyCost` | finances garrison and war cost `·` | 0.6 | 0.6 | 0.9 | 0.7 | 1 | 0.8 | 1.4 | 1.2 | 1.3 | 1 | 1.2 | standing armies cost money; feudal hosts do not |
| `contest` | `succession` contested chance `+` | 0.05 | 0.15 | 0 | 0.05 | 0 | 0.1 | −0.03 | −0.05 | 0.2 | 0.08 | −0.08 | succession stability (tanistry; mamluk rule of the strongest) |
| `overthrow` | `rulerYear` overthrow `x ·=` | 1 | 1.3 | 1 | 1.1 | 0.9 | 1 | 0.8 | 0.7 | 2.5 | 1.5 | 0.4 | design defaults; direction from Blaydes & Chaney 2013 [D] |
| `grief` | `unrest.ts grievance ·` | 1 | 1 | 1 | 1.05 | 0.95 | 1 | 1.1 | 0.95 | 1.1 | 1.2 | 0.85 | revolt odds through discontent |
| `frag` | realmStep `acrit` test and civil.ts lowCohesion chance `·` | 1 | 1.6 | 1 | 1.4 | 1 | 1.2 | 0.8 | 0.6 | 1 | 1.2 | 0.8 | feudal and nomad fission; bureaucracy holds |
| `reach` | `pReach ·=` | 0.9 | 1.1 | 1 | 0.85 | 1 | 0.9 | 1.1 | 1.2 | 1 | 1 | 1.05 | administration at a distance |

Which estates are summoned and how, which offices and factions exist (sections 4–6, summarised):
| regime | assembly (AssemblyKind) and when | offices | factions that can exist | seat cards |
|---|---|---|---|---|
| Tribal | none | none | none | — |
| Nomadic | Kurultai (succession only, no tax bargain) | Marshal | War, Peace | Regency, Council |
| Patrimonial | Council of magnates, rarely (need ≥ 0.8) | Chancellor (steward), Marshal, Treasurer, ChiefPriest | all | all |
| Feudal | Council (great council of barons) at need ≥ 0.5 | all | all; nobles weight ×1.5 | all |
| Estates | Diet at need ≥ 0.4; Standing → every slow step | all | all; towns weight ×1.3 | all |
| Elective | Sejm-like Diet at need and at every succession (election capitulations = privileges) | all | all; nobles ×1.5 | all |
| Absolutist | Diet only when credit is gone (`r_p ≥ refuse`) and the assembly has not lapsed | all; venal offices | all but Regent weight ×0.7 | all |
| Bureaucratic | none (officials) | all; Scholar holders | War, Peace, Faith, Regent, Favourite (no Merchant: merchants excluded from office) | no Estates card |
| MilitarySlave | none | all; Marshal = corps commander | War, Peace, Faith, Favourite; the corps acts as War party ×2 | no Estates card |
| Sultanistic | none | all; Favourite strong | Favourite ×2 | no Estates card |
| Constitutional | Parliament every slow step (supply); grants without crisis | all; Treasurer with Audit | all; Peace and Merchant ×1.2 | Estates card is a budget vote |

---

## 4. Estates and assemblies

### 4.1 Who (`EstateKind`): Nobles 0, Clergy 1, Towns 2, Peasants 3
### 4.2 Strength (every slow step, Kingdom+ monarchy-like; `court/estates.ts estateStrength`)
```
S_N = (ε_p / SOC.eps0) · (0.5 + 0.5·rent_p) · (0.5 + κ_p) · lords[regime]          lords: Feu 1.5, Ele 1.5, Est 1, Pat 0.8, Abs 0.6, others 0.5
S_C = (cler_p / SOC.clergy0) · (0.5 + org_f) · [state faith f exists]               (religion off: 0)
S_T = sm(0, 2, Σ_{m town ≥ TOWN_POPULATION} finTownRevenue(m) / max(R°, minRev)) · (1 + 0.5·famTop_p)
      famTop_p = the top family's share of Σ mw over members (families on, pure read), else 0
S_P = 0.6·(1 − κ_p)·[κ_p < 0.2]·[regime ∈ {Estates, Constitutional}]·(1 − u)      free peasants (Sweden, Tyrol, Frisia): rare
σ_e = S_e / Σ S;  an estate sits only when σ_e ≥ COURT.sitMin 0.1
```
Each estate also has **force** `F_e` (what it can do if refused): nobles' levies `F_N = σ_N·share[regime]·pMass`
(share Feu 0.6, Ele 0.5, Est 0.4, Pat 0.3, Abs 0.15); towns `F_T = Σ` city-states' `F_i` over the richest 3 towns (proxy
`localOf`); clergy `F_C = 0` (their weapon is legitimacy: a refused clergy lowers riots' `L` by 0.05); peasants `F_P = 0.2·σ_P·pMass`.
And **cohesion** `coh_e = 0.5 + 0.5·A_p` (asabiya; nobles), `0.5 + 0.5·[a League or ≥ 3 towns with Commune share]` (towns).

### 4.3 When the crown summons (`courtSlow`, deterministic)
```
gap  = fin ? max(0, chest·warCost + max(0, −treas) − finOutsideBorrow(s, p, ∞)) / R° + 0.5·Fis : proxyNeed · 2     (years of R°)
urg  = min(1, finNeed) + 0.5·[pWars > 0] + 0.5·[unpaid ≥ 1]
summon if: an assembly kind exists for the regime (3.6) and gap ≥ COURT.gapMin 0.3 and urg ≥ summonNeed[regime]
           and (the crown's outside option o_c < its inside share, 4.4) — or Standing/Constitutional (every slow step, G = 0.3 supply)
           or the SummonEstates order (33)
```
The first session founds the assembly (`AssemblyKind` by regime: Council, Diet, Parliament (Constitutional or Estates
with Standing), Sejm (Elective), Kurultai). Event AssemblyChanged (293, extra 0).

### 4.4 The bargain (deterministic; BRW: Rubinstein split of the inside surplus, outside options as constraints)
Units: years of R°. The crown asks `G = clamp(gap, 0.3, 3)`.
```
v_c  = 1 + 0.8·urg                                              value of a unit of coin to a crown in need
β̄    = Σ σ_e β_e,  β_e: share of the purpose the estate values  defensive war against θ ≥ 0.3: N 0.5, T 0.5, C 0.3; a war on a trade rival
                                                                 (city-states compete_pq ≥ 0.3): T 0.4; holy war: C 0.6; aggressive war: 0.1; debts/peace: 0
θ_cr = clamp(1 − 0.5·T_p − 0.3·[CharterRevoked by p in 60 y] − 0.3·[a privilege revoked in 60 y] + 0.2·(L_p − 0.5), 0.2, 1)
                                                                 credibility of the crown's promises (riots' tyranny memory T, legitimacy L)
inside surplus  Σ = (v_c − (1 − β̄)/θ_cr) · G                    the crown gains v_c·G; estates must be paid (1 − β̄)·G in privileges they value at θ_cr
patience        r_c = 1 + 3·urg (war, arrears) ;  r_e = 1 + 1.5·(1 − coh̄) + 1.5·[a foreign army in the realm]
estates' share  a = r_c / (r_c + r_e)                           (Rubinstein limit; the impatient side concedes)
crown outside   o_c = max( borrow: B·(v_c − COURT.loanYears 5 · r_p),  B = finOutsideBorrow(s, p, G·R°)/R°  (a loan costs ~5 years of interest before it is repaid; r_p ≥ refuse ⇒ B = 0)
                       debase: finCanDebase ? v_c·seign·debaseStep·Σwealth/R° − 0.3·(grief) : 0,
                       coerce: [no Consent privilege] · (v_c·G·(1 − pRevolt) − pRevolt·Lrev) )
                pRevolt = Σ σ_e · F_e² / (F_e² + S_c²) · coh_e  (S_c = projAt at the estate's seat: the crown's force there);  Lrev = 2 (a lost estates' war costs ~2 R°)
estates outside o_e = −(coerce chance)·(1 − β̄)·G  < 0          (refusing risks being taxed anyway)
```
- If `Σ ≤ 0` or `Σ ≤ o_c`: no deal. If the crown had summoned (it could not foresee θ_cr exactly: it estimates with
  `θ_cr + 0.1`), the session ends **Refused**; else the crown does not summon.
- Else the crown keeps `max((1 − a)·Σ, o_c)` and the estates get the rest. Privilege value owed:
  `X = (1 − β̄)·G/θ_cr + (Σ − max((1 − a)·Σ, o_c))`. Outcome **Granted** when `X` is covered by Redress alone, else **Bargain**.
- The grant: `G·R°` enters the treasury (`finCredit(s, p, x, 'grant')`), taken from members' wealth and `mw` in
  proportion to the estates' bases (towns' share from town wealth and `mw`, the rest from all members' wealth). Proxy
  without finances: into `wealth[cap]`.
- After **Refused**: the crown takes its best outside option. **Coerce** → finances `taxMul` to `taxMax` for 10 years,
  `ps.unrest[m] += COURT.refuseUnrest 0.1·σ` in members, and **one draw** `< pRevolt` for an estates' rising at the seat of
  the strongest sitting estate (nobles: the largest non-capital member; towns: the richest town): `revoltAt(..., RevoltCause.Estates)`
  (riots' refactor; without riots the old `revolt()` body with cause 16). A towns' rising passing city-states' gate goes to
  `govRisingResolve` — **towns that win outright become city-states**. Outcome Coerced. With Charter held, coercion also
  adds `T_p += 0.15` (a broken charter is tyranny).
- **Deposition** (Edward II 1327, Richard II 1399): gate `Charter ∧ nobles σ_N ≥ 0.4 ∧ T_p ≥ 0.3 ∧ ability < 0.9`;
  one draw `< 0.15·σ_N·(1 − L_p)` at a session → `R.kill[p] = ReignEnd.EstatesDeposed` (the heir succeeds by law;
  contested chance × 0.5: the estates name him). Outcome Deposition.

### 4.5 Privileges (bits; `Privilege`), chosen to cover X
| bit | privilege | value (R°-years) | demanded by (in this order) | effect while held |
|---|---|---|---|---|
| 0 | Charter (Magna Carta: no arbitrary seizure) | 1.0 | N, C, T | tyranny draws × 0.5 (riots); breaking it = tyranny act; deposition possible (4.4) |
| 1 | Exemption (the estate untaxed) | 0.6 | N, C | wealth-tax base × (1 − 0.5·σ_e); that estate's loyalty: plot propensity of factions it backs × 0.8 |
| 2 | Consent (no tax without the assembly) | 1.5 | T, N | coercion option removed; taxUp halved without a grant (0.4 d); taxGrief × 0.6 (Levi) |
| 3 | Standing (regular sessions) | 2.0 | T | summoned every slow step with G = supply 0.3; T6/T10 gates |
| 4 | Audit (appropriation and accounts) | 2.0 | T | rate factor (4.6); Treasurer competence floor 0.9; embezzlement 0 |
| 5 | TownCharters (liberties of named towns) | 0.5 per town | T | `govCharterGrant` for the richest towns passing city-states' gate (no draw), else TaxRemitted 10 y |
| 6 | Redress (grievances answered) | 0.5 | all | members' unrest × 0.8 once; the Chancellor dismissed if his faction is not the winner |
| 7 | Succession (the estates confirm the heir) | 1.5 | N | contested chance × 0.7; with Ext ≥ 1, T7 hazard × 2 |
Picking: estates in σ order each take their next missing privilege in their list until X is covered; Redress repeats.
Privileges are logged (291) and stored in the assembly's bits. **Accumulation**: an assembly keeps its bits for life;
an Absolutist crown may revoke one per slow step (gated: Wl ≥ 0.5 and the assembly not summoned 30 y; one draw inside
the regime draw as a pseudo-target), raising T_p by 0.2 and logging AssemblyChanged extra 3. **Lapse**: no session for
`COURT.lapseYears` 100 → AssemblyChanged extra 2 (the Estates-General 1614–1789); a lapsed assembly is re-founded with
its bits at the next session (crowns forget, charters do not). Successors (secession, civil war) inherit the assembly
and bits (the Dutch Revolt); an absorbed realm's assembly ends.

### 4.6 Credible commitment and other feedbacks
```
courtRate(p) = REGIME.rate[regime] · (Audit ∧ Standing ? 1 − 0.3·(0.5 + σ_T) : Consent ? 0.9 : 1)      (≥ 0.55)
```
North & Weingast (1989) **[D]**, Stasavage (2011) for the towns term (the 0.3, 0.9 and 0.55 factors are design
defaults). With rBase 0.05 this moves a constrained crown's rate by 1–2.5 points, against a debated historical fall
in England from 6–8% in the late 1690s to 3% by the 1730s (14% on the first loans of 1693; North & Weingast 1989,
Table 4), and Sussman & Yafeh's (2006) finding that rates stayed high and volatile for about four decades. Tune so the measured spread stays ≤ 2.5 points (12).

---

## 5. Offices and their holders

### 5.1 `OfficeKind`: Chancellor 0, Marshal 1, Treasurer 2, ChiefPriest 3, Spymaster 4, Regent 5
Which exist: Kingdom+ monarchy-like with a full court (3.6 table). Treasurer only if `Mon ≥ 0.5` or `coinage` held;
ChiefPriest only with a state faith; Spymaster only if beliefs' `spy[p] ≥ 0.2` (or, without beliefs, Kingdom+ at war or
Empire); Regent only during a regency (from the Regency event (84) until the ruler's majority). UI titles by regime
(Chancellor: "steward of the household" Patrimonial, "chancellor" Feudal/Estates/Elective/Absolutist/Constitutional,
"grand secretary" Bureaucratic, "vizier" MilitarySlave/Sultanistic, "the khan's minister" Nomadic).

### 5.2 Holders: origin, competence, loyalty (`court/offices.ts appoint`)
`HolderOrigin`: Noble 0 (a lord of a member town: `seat`), Kin 1 (of the ruling house), Cleric 2, Merchant 3 (a merchant
family's member, `family`), NewMan 4 (a commoner raised by the ruler), Slave 5 (a bought soldier or eunuch), Scholar 6
(an examination graduate), Foreigner 7 (an exile from another court: 6.6).
Origin mix by regime (weights; [A]):
| regime | Noble | Kin | Cleric | Merchant | NewMan | Slave | Scholar |
|---|---|---|---|---|---|---|---|
| Nomadic | 0.4 | 0.6 | | | | | |
| Patrimonial | 0.3 | 0.3 | 0.1 | | 0.3 | | |
| Feudal | 0.6 | 0.2 | 0.2 | | | | |
| Estates | 0.4 | 0.05 | 0.2 | 0.2 | 0.15 | | |
| Elective | 0.7 | | 0.3 | | | | |
| Absolutist | 0.3 | 0.05 | 0.1 | 0.2 (venal) | 0.35 | | |
| Bureaucratic | 0.15 | 0.05 | | | | 0.1 | 0.7 |
| MilitarySlave | | 0.1 | 0.2 | | | 0.7 | |
| Sultanistic | | 0.3 | | | 0.4 | 0.2 | (Foreigner 0.1) |
| Constitutional | 0.4 | | | 0.3 | 0.3 | | |
ChiefPriest is always Cleric; Regent is Kin (the queen mother when the late ruler's consort lives: `female = 1`; else an
uncle or the closest adult heir in the pool); Marshal with battles on comes from 5.4.
**Draws per appointment, fixed order (12)**: two candidates × [origin, competence u1, competence u2, loyalty, female,
temper uF], then for the chosen one: born `year − 28 − floor(22·u)` and death `deathYear(R, born, year, u')` (rulers'
survival table, as `rDeath`) — 12 draws always, whichever candidate is chosen.
```
competence c = clamp(1 + 0.35·(u1 + u2 − 1) + bonus[origin][office], 0.5, 1.5)     bonus: Scholar +0.15, Slave +0.1 (Marshal), Merchant +0.1 (Treasurer), Kin −0.05
loyalty    l = clamp(base[origin] + 0.3·(u − 0.5), 0, 1)                          base: Kin 0.55, Noble 0.5, Cleric 0.7, Merchant 0.6, NewMan 0.8, Slave 0.85, Scholar 0.75, Foreigner 0.6
faction    = by origin: Noble → War if uF < 0.5 + 0.3·(thr − 0.5) else Peace; Kin → the winning faction or Regent;
             Cleric → Faith; Merchant → Merchant; NewMan, Slave → the ruler's own (loyal to him, 6.3 "Crown"); Scholar → Peace; Foreigner → War
choice     = argmax over the two of  c·(0.4 + 0.6·min(1, ability)) + 0.4·[faction = winner]·(1.2 − ability) + 0.2·l
```
An able ruler picks competence; a weak one gives the office to the faction that holds him. Orders (34) override the choice.
**Merchant origin** names its family (`topFamilyAt(s, home)` of the richest member town; pure read) and, in Absolutist
with finances in arrears, the office is **venal**: `finCredit(s, p, 0.2·R°, 'venal')` at appointment; the holder's
loyalty is to Merchant; `tax` efficiency × 0.98 per venal office held (direction from Doyle 1996; 0.98 is a design default).
Record: `Officeholders` row (8.3). Names at assembly (10.1).

### 5.3 Tenure, fall, death (`court/offices.ts`)
- Death: the pre-drawn year (as rulers' `rDeath`; the seat watcher must never read it).
- **New reign**: each holder is kept with chance `0.6 + 0.2·[holder's faction = the new ruler's favoured]`; one draw per
  holder in office order. Not kept → end Replaced (no event).
- **Dismissal hazard** per slow step, one draw per holder in office order:
  `d = 0.03 + 0.25·fail + 0.1·[faction lost power this step] + 0.1·(1 − l)·(1 − ability)`, where `fail` is: Marshal — a
  war lost (`R.lost[p]` within 10 y) or battles' CommanderDismissed (227) of his commander (then the court follows battles:
  no second draw, `fail = 1` forces); Treasurer — CrownDefault/ArmyUnpaid in 10 y; Spymaster — a successful plot or
  SpyCaught against p's spies; Chancellor — a lost war and a refused session; ChiefPriest — the ruler converted.
- On dismissal: **Disgraced** if `fail` or `l < 0.4`; **Executed** if Disgraced and `cruelty(r) ≥ 0.6` and a second draw
  `< 0.5·cruelty` (Noble origin → riots' tyranny act NoblesExecuted; T_p += 0.15); **Fled** if the disgraced holder's
  faction plots Defection (6.6); else Dismissed. MinisterFell (297) for Disgraced/Executed, and for Dismissed of a
  Chancellor or Marshal with tenure ≥ 10.
- **Rising to the throne** (MinisterSeized 298): (a) a successful coup led by the holder (6.5); (b) a Regent with
  `l < 0.4` and an ill minor (the minor's pre-drawn death is **not** read; the gate is the holder's ambition only) —
  regent coup is a plot of the Regent faction; (c) MilitarySlave: when the ruler dies, the Marshal succeeds with chance
  0.6 (one draw, at the court's succession hook, before the law); (d) a Chancellor with favour ≥ 0.8 under two weak
  reigns running (ability < 0.8) seizes with chance 0.2 per step (the mayors of the palace, 751). Implementation:
  `newHouseAccede(s, ps, R, p, AccessionHow.Usurped)` with the battles born/female override, linked `reignAfter`.

### 5.4 What offices change (each multiplier read where the quantity is computed; skipped when court is off)
| office | quantity | rule |
|---|---|---|
| Treasurer | tax yield, waste, rate | wealth tax `× (0.85 + 0.15·c)`; peace spending `× (1.1 − 0.1·c)`; finances rate `− 0.5·rAble·(c − 1)`; embezzlement `(1 − l)·0.04·R` a year leaves the treasury (to his family's home `mw` if Merchant) unless Audit |
| Spymaster | beliefs accuracy | `iSpy · (0.5 + 0.5·c)`; `counter · (0.6 + 0.4·c)`; riots' perception `perc ← perc + 0.3·(c − 0.5)·(true − perc)` (their 0.8 spyDomestic); plot detection (6.5) |
| Marshal | battles skill | battles on: the Marshal **is** a Commanders row. At appointment in peace the court calls `battleNewCommander(bs, p, born, female, skill = clamp(0.85 + 0.3·(c − 1), 0.6, 1.5), dyn)` and `battleRecall(bs, p, cmd)`, so battles' next war recalls him (its veteran path draws nothing); when battles appoints a general itself (its draws), the court adopts him as Marshal with `c` from his skill (no court draws). Battles off: `rulerMass ·(0.95 + 0.05·c)` |
| Chancellor | policy, diplomacy, reach | riots' noise `ν` (0.4 a); alliance chance `× (0.8 + 0.2·c)`; `pReach × (0.97 + 0.03·c)`; his faction's weight `+0.2·c` |
| ChiefPriest | legitimacy, faith | riots' `L∞ + 0.05·(c − 1)`; Faith faction weight `+0.3·c`; persecution chance `× (1 + 0.5·zeal·[Faith winner])` |
| Regent | the minority | policy ability = `c` instead of the minor's; the regency's crisis ends `ceil((1.5 − c)·left)` years early if `l ≥ 0.6` |

---

## 6. Factions

### 6.1 `FactionKind`: War 0, Peace 1, Faith 2, Merchant 3, Regent 4, Favourite 5 (and Crown = 15, the ruler's own will, not a faction)
### 6.2 Strength (every slow step, full courts only)
```
F_War  = 0.6·σ_N + 0.3·thr + 0.3·min(1, G_max)         (G_max: grudges' strongest standing grudge, else 0) + 0.3·[army Slave or Standing] + 0.4·fame/renown of the Marshal (battles)
F_Pce  = 0.6·σ_T + 0.3·σ_C + 0.4·Fis + 0.3·min(1, pExh)
F_Fth  = σ_C·(0.5 + org_f)·(0.5 + zeal_f) + 0.3·disasterShock (riots' proxy)          (religion on, state faith)
F_Mer  = σ_T·(0.5 + C) + 0.5·famTop_p                                                (Bureaucratic: 0)
F_Reg  = [regency] · (0.8 + 0.4·c_regent)
F_Fav  = [a holder with favour ≥ 0.8] · favour · (1.6 − ability)                      (Sultanistic × 2)
each   += Σ_{holders h of faction k} officeW[office]·c_h     officeW: Chancellor 0.4, Marshal 0.4, Treasurer 0.2, ChiefPriest 0.3, Spymaster 0.1, Regent 0.5
each   ·= REGIME weight (3.6 table)
```
### 6.3 Lobbying and the winner (deterministic, no draw)
```
w_k  = F_k · aff_k · (0.5 + fav_k)                  aff: War (0.5 + rWar), Peace (1.5 − rWar), Faith (0.5 + piety), Merchant (0.7 + 0.6·[banking held]),
                                                    Regent 1, Favourite 1;  fav_k: ruler's favour of faction k, 0..1 (starts 0.5)
w_Crown = 0.5·min(1.5, ability)·Σ_k F_k / Nk        the ruler's own will: an able ruler rules himself
winner = argmax(w_k ∪ w_Crown), the incumbent × 1.15 (hysteresis); ties by kind id
fav_k ← fav_k + 0.1·(outcome_k − fav_k)            outcome_k = 1 when the faction's policy of the last step "worked" (a war won for War, a peace with
                                                    no loss for Peace, a session granted for Merchant/Peace, a holy war won for Faith), 0 when it failed, else fav_k
```
FactionAscendant (294) when the winner changes and both old and new are not Crown, or when Crown loses to a faction
after holding ≥ 20 years.

### 6.4 The policy vector (what the winner sets) — `courtPolicy(s, p)`, read by other systems
| slot | site | Crown | War | Peace | Faith | Merchant | Regent | Favourite |
|---|---|---|---|---|---|---|---|---|
| `war(q)` | war.ts declarations `mul` (replaces `rulerWar` when a faction wins; still one draw) | rulerWar | `warBase + 0.5` × 1.5 | × 0.6 | × 1.5 if q of another faith else 0.9 | × (1 + compete_pq) if trade rival, else 0.7 | 0.6 | rulerWar |
| `peace` | campaigns `tired` threshold `·` | 1 | 0.7 | 1.5 | 1 (holy war 0.6) | 1.3 | 1.5 | 1 |
| `ally(x, threat)` | grudges allianceStepBalance step-4 chance `·` (or bonds' ALLIANCE.chance) | 1 | 1.2 against the hegemon (θ) | 1.3 any defensive | 1.5 same faith, else 0.5 | 1.3 trade partner (relTradeV) | 1 | 1 |
| riots policy | their 4.9 scores | 0 | levy +1, uRepress +0.5 | relief +0.2, uConcede +0.5 | Persecution push: religion's persecution chance ×1.5; Toleration −∞ | relief +0.1, tax −0.1 (towns spared) | uConcede +0.3 | uRepress +0.3 |
| tariffs | policy.ts target `·` / embargo chance `·` | 1 | 1 / 1.3 | 0.9 / 0.7 | 1 / 1 | 0.85 / 1.3 vs trade rivals | 1 / 1 | 1.1 / 1 |
| estates stance | 4.4: crown's estimate of θ_cr and o_c | 0 | coerce preferred (o_c × 1.3) | summon preferred (o_c × 0.7) | — | summon (o_c × 0.7) | summon | coerce (× 1.3) |
Stored per slow step per polity in `History.court.policy` (winner) — "share of policies set by factions" is the share
of Kingdom+ polity-steps whose winner ≠ Crown.

### 6.5 Losers plot (`court/plots.ts`, every slow step)
Plotter: the strongest losing faction k with `F_k / ΣF ≥ 0.2`.
```
P_k = 0.04 · (F_k / ΣF) · min(1, out_k / 30) · (1.2 − L_p) · (1.5 − min(1.4, ability)) · REGIME.overthrow · (1 + [regency]) · (1 + [a leader Disgraced or Executed in 20 y])
       out_k: years the faction has been out of power
```
**Draws**: one `< P_k` (gated); if it fires, the kind by a second draw over the feasible weights; then a detection draw;
then (if undetected) a success draw.
| PlotKind | feasible when | weight | success p | on success |
|---|---|---|---|---|
| Coup 0 | the faction holds Marshal, or a famous general (fame ≥ renown/2) is of the faction or out of favour | 2 | `M / (M + loyal)`, M = the faction's military (Marshal c · σ_N share · (1 + fame/renown)), loyal = Crown-faction holders' weight + 0.3·L_p | ruler Deposed (or Murdered, 0.4); the faction's candidate accedes: a Kin holder or heir (Usurped), or the Marshal/leader (MinisterSeized 298 / battles' GeneralSeized path) |
| Poison 1 | Regent, Favourite or Faith faction; a holder with access (Chancellor, ChiefPriest, Regent) | 1 | 0.5·(1 − 0.5·c_spymaster) | `R.kill[p] = ReignEnd.Murdered`; succession by law (the faction backs the heir; a minor → regency of the Regent faction) |
| Pretender 2 | a contested succession, a regency or `Su ≥ 0.3`; a rival heir or a famous general exists | 1.5 | — (no success draw: it raises rulers' `contested` chance × 2 at the next succession, and battles' `generalBase` bar × 0.8) | the civil war of rulers' `contested` follows its own draws; families may back it (their FamilyBacked) |
| Defection 3 | the faction's leader is Disgraced or the faction is out ≥ 30 y; a rival q (relR ≥ 0.5, contacted) | 1 | 1 (he flees) | CourtExile (296) (6.6) |
Detection: `< 0.2 + 0.5·c_spymaster·(0.5 + spy[p])`. Detected → PlotEnd Foiled: the leader is Disgraced or Executed
(5.3 rule), `F_k ·= 0.5`, `fav_k = 0`. Undetected and failed → PlotEnd Failed (same, milder: Dismissed). Success →
PlotEnd Succeeded. CourtPlot (295) logged for every attempt at Kingdom+.
**Interaction with the existing overthrow draw** (rulers l.436–441, kept): with court on, its `x ·= REGIME.overthrow[regime]
· (1 + plotHeat_p)` where `plotHeat = min(1, P_k / 0.02)` (no extra draw). Court coups are additional; the harness
guard (12) bounds the total.

### 6.6 Defection to a foreign court (beliefs' leaks, grudges' Asylum)
The leader (a holder) flees to the capital of q: holder end Fled, a new holder row at q with origin Foreigner may be
appointed at q's next vacancy (`exile[q]` list). Effects: beliefs `beliefDefector(s, q, p, c)` (a precise read of p:
"what the exile told"); goods `secrets.ts leaks` Espionage multiplier `× (1 + c)` for q against p for 20 years (threshold
only); grudges `recordGrievance(Asylum 13, wronged = p, offender = q, w = 0.25, site = cap q)`; q's War faction
`+0.3` against p for 20 years and, if the exile is Kin with a claim, q's `war(p)` slot × 1.3 ("for the exile's right").
Event CourtExile (296, extra 1 if he carried secrets: Spymaster, Chancellor or Treasurer).

### 6.7 Favour and the favourite
Each holder has `favour` 0..1 (start 0.4): `+0.05` a year for holders of the winning faction or Crown, `−0.05` for the
rest; the highest ≥ 0.8 under a ruler of ability < 1 (or any Sultanistic ruler) is **the favourite**, which creates the
Favourite faction (Buckingham, Olivares, Lerma). Favour resets to 0.3 at a new reign (except Regent → 0.6).

---

## 7. Minimal model and scope limits (cost)
- **Chiefdom tier**: regime label only (Tribal/Nomadic), transitions T1/T2 checked; no offices, estates or factions;
  `courtPolicy` = Crown. Cost: one hazard evaluation per slow step.
- **Kingdom tier, < 6 members** cannot occur (tier needs ≥ 6 [V contract.ts:1213]).
- **Civic and Clerical**: no court (city-states' councils and theocracy cover them). `COURT.civicFactions` (default
  false) is an open question: Guelph/Ghibelline factions from city-states' top families.
- **Dropping below Kingdom**: offices vacant are not refilled; holders end Lapsed after 20 years; the assembly lapses on
  its own clock; factions freeze (Crown wins).
- Caps: at most 6 offices per realm; at most 1 plot and 1 session per realm per slow step; Officeholders ≤ 20 000 rows (hard
  cap: beyond it, appointments still happen but rows are recycled? **No** — prefix stability forbids recycling; at the cap,
  new appointments store no row and the office keeps an anonymous holder (UI "an unnamed minister"); expected rows ~7 k (13)).

---

## 8. Contract additions (`src/contract.ts`), drafted in the codebase's style

### 8.1 Enums
```ts
// court: regimes, estates and assemblies, offices and factions inside realms (HistoryOptions.court; all empty when it, rulers or polities is false).

/** Why a polity's regime became what it is (History.regimes.cause). */
export const RegimeCause = {
  Founded: 0, // the regime it was founded with (first row; a successor of a collapsed empire starts Feudal)
  Kingship: 1, // a chiefdom grown into a kingdom (T1)
  Horde: 2, // herders' confederation (T2)
  Sedentarised: 3, // a conquest dynasty of herders settled among its subjects (T3, or city-states' Settled)
  Fiefs: 4, // the crown gave land for service and its lords became its rivals (T4; T14 after a collapse)
  Recentralised: 5, // a strong king took back the fiefs (T5)
  Estates: 6, // the estates won consent to taxes and a place in government (T6)
  Elected: 7, // the great men took the election of kings (T7)
  Hereditary: 8, // one house kept being elected until the throne was its own (T8)
  Absolutism: 9, // the crown outgrew its estates: a standing army, salaried officials, the diet unsummoned (T9, T12)
  Revolution: 10, // the crown was bound by parliament after a deposition, a default or a revolution (T10, T11)
  Examinations: 11, // offices given by examination to a corps of officials (T13)
  SlaveSoldiers: 12, // the ruler's slave corps became the state (T15)
  CorpsBroken: 13, // the slave corps was destroyed (T16)
  Usurpation: 14, // a usurper ruled in person, unbound (T17)
  Routinised: 15, // the founder's heir ruled by custom (T18)
  Government: 16, // city-states changed the polity's form of government (History.governments)
} as const
/** How the realm's armies are raised (History.court.army per snapshot). */
export const ArmyKind = { Levy: 0, Host: 1, Horde: 2, Mercenary: 3, Standing: 4, Slave: 5 } as const
export const EstateKind = { Nobles: 0, Clergy: 1, Towns: 2, Peasants: 3 } as const
/** Kind of a realm's assembly (History.court.assemblies). */
export const AssemblyKind = { Council: 0 /* the great council of magnates */, Diet: 1 /* the estates by order (Estates-General, Cortes, Landtag) */, Parliament: 2 /* standing, with control of supply */, Sejm: 3 /* a diet of nobles that elects the king */, Kurultai: 4 /* the assembly of the clans (succession only) */ } as const
/** Privileges an assembly won (bit indices of History.court.assemblies.privileges and sessions.won). */
export const Privilege = { Charter: 0, Exemption: 1, Consent: 2, Standing: 3, Audit: 4, TownCharters: 5, Redress: 6, Succession: 7 } as const
/** How a session of the estates ended (the `extra` of EstatesSummoned). */
export const SessionOutcome = { Granted: 0 /* taxes for redress */, Bargain: 1 /* taxes for privileges */, Refused: 2, Coerced: 3 /* refused, and the crown took it anyway */, Dissolved: 4 /* sent home unheard */, Deposition: 5 /* they deposed the king */ } as const
export const OfficeKind = { Chancellor: 0, Marshal: 1, Treasurer: 2, ChiefPriest: 3, Spymaster: 4, Regent: 5 } as const
export const OfficeEnd = { Serving: 0, Died: 1, Replaced: 2, Dismissed: 3, Disgraced: 4, Executed: 5, Fled: 6, Rose: 7 /* took the throne */, Lapsed: 8, RealmEnded: 9 } as const
export const HolderOrigin = { Noble: 0, Kin: 1, Cleric: 2, Merchant: 3, NewMan: 4, Slave: 5, Scholar: 6, Foreigner: 7 } as const
/** Court factions (History.court.policy holds the winner per slow step, Crown 15 the ruler's own will). */
export const FactionKind = { War: 0, Peace: 1, Faith: 2, Merchant: 3, Regent: 4, Favourite: 5, Crown: 15 } as const
export const PlotKind = { Coup: 0, Poison: 1, Pretender: 2, Defection: 3 } as const
export const PlotEnd = { Succeeded: 0, Failed: 1, Foiled: 2 } as const
export const CourtReformKind = { StandingArmy: 0, VenalOffices: 1, SlaveCorps: 2, CorpsDestroyed: 3, PrivilegeRevoked: 4 } as const
RevoltCause: Estates: 16, // the estates of the realm (nobles, clergy or towns) in arms against an unconsented tax or a broken charter (court)
GrievanceKind: Asylum: 13, // the offender's court received the wronged's fugitive minister or faction leader (EventType.CourtExile) and backed his cause
ReignEnd: Murdered: 10, // killed by his own court: a palace coup or poison (History.court.plots)
          EstatesDeposed: 11, // deposed by the estates of the realm in session (History.court.sessions)
OrderKind: SummonEstates: 33, Appoint: 34, Dismiss: 35, Favour: 36, Arrest: 37, Reform: 38
```

### 8.2 Events 290–299
```ts
  // court: regimes, estates, offices and factions (290-299; none when HistoryOptions.court is false).
  EstatesSummoned: 290, // the crown ruled from `settlement` summoned the estates (History.court.sessions row `value`); `other` the seat of the strongest estate (its largest town; -1); `extra` the SessionOutcome
  PrivilegeWon: 291, // the estates of the realm ruled from `settlement` won a privilege at session `value`: `extra` the Privilege + 16 * the EstateKind that asked it; `other` the town chartered (TownCharters) or -1
  RegimeChanged: 292, // the polity `value` ruled from `settlement` became a regime `extra` (Regime) for the cause in History.regimes; `other` -1
  AssemblyChanged: 293, // the assembly `value` (History.court.assemblies) of the realm ruled from `settlement`: `extra` 0 first met, 1 became standing, 2 lapsed (unsummoned COURT.lapseYears), 3 a privilege revoked by the crown, 4 bound the crown (Constitutional); `other` -1
  FactionAscendant: 294, // a faction took the lead at the court ruled from `settlement`: `value` its leader (History.court.holders, -1); `extra` the FactionKind + 16 * the one it displaced (15 the ruler's own will); `other` -1
  CourtPlot: 295, // a plot at the court ruled from `settlement` (History.court.plots `value`): `extra` the PlotKind + 8 * the PlotEnd; `other` the pretender's seat or the foreign capital that backed it, -1
  CourtExile: 296, // the holder `value` (History.court.holders) fled the court ruled from `settlement` to the one ruled from `other`; `extra` 1 when he carried its secrets (a spymaster, chancellor or treasurer), else 0
  MinisterFell: 297, // the holder `value` lost his office at the court ruled from `settlement`; `extra` how (OfficeEnd: Dismissed, Disgraced, Executed); `other` -1
  MinisterSeized: 298, // the holder `value` (a minister, regent or marshal) took the throne of the polity ruled from `settlement`; `extra` the new reign (History.rulers); `other` -1. RulerAcceded (Usurped) follows
  CourtReform: 299, // the crown ruled from `settlement` made a reform `extra` (CourtReformKind): a standing army, offices for sale, a slave corps, the corps destroyed, a privilege revoked; `value` the polity id; `other` -1
```

### 8.3 History tables
```ts
/** court: everything the court system records (empty arrays and count 0 when HistoryOptions.court is false). */
export interface CourtHistory {
  /** Regimes over time, the analogue of History.governments: the regime of polity p at year y is that of the last of its rows with year <= y. */
  regimes: { count: number; polity: Int16Array; year: Int16Array; regime: Uint8Array; cause: Uint8Array; settlement: Int32Array }
  regimeOffsets: Uint32Array
  regimeIds: Int32Array
  /** Assemblies in order of first meeting; `privileges` the bits held at the end (or at its end); `standing` the year it became standing (-1). */
  assemblies: { count: number; polity: Int16Array; kind: Uint8Array; founded: Int16Array; ended: Int16Array; privileges: Uint8Array; sessions: Uint16Array; standing: Int16Array }
  /** Sessions of the estates in order: asked and granted in years of ordinary revenue (x100), the estates' shares (0..255 each, EstateKind order), the estates' Rubinstein share (0..255), the crown's best outside option (0 none, 1 borrow, 2 debase, 3 coerce), the privileges won (bits). */
  sessions: { count: number; year: Int16Array; polity: Int16Array; assembly: Int32Array; asked: Uint16Array; granted: Uint16Array; outcome: Uint8Array; shares: Uint8Array /* 4 per row */; split: Uint8Array; outside: Uint8Array; won: Uint8Array }
  /** Office holders in order of appointment; competence and loyalty 0..255 (competence 0.5..1.5); `family` (History.families), `dynasty` (History.dynasties), `commander` (History.commanders), `seat` (the noble's town) each -1 when not so. */
  holders: {
    count: number; polity: Int16Array; office: Uint8Array; from: Int16Array; to: Int16Array; end: Uint8Array
    born: Int16Array; female: Uint8Array; origin: Uint8Array; faction: Uint8Array; competence: Uint8Array; loyalty: Uint8Array
    family: Int32Array; dynasty: Int32Array; commander: Int32Array; seat: Int32Array; venal: Uint8Array
    /** "Aldo Veckin", "Ser Ivo of Kubeta" (assembly, in the court's language at appointment). */
    name: string[]
  }
  plots: { count: number; year: Int16Array; polity: Int16Array; kind: Uint8Array; faction: Uint8Array; leader: Int32Array; target: Int32Array /* reign */; end: Uint8Array; backer: Int16Array }
  /** Per slow snapshot (every POLITY.slowStep years: q = floor(year / 10)) and polity, row-major [q * polities.length + id], 0 outside its life:
   *  winning faction (FactionKind, 15 Crown, 255 no court), faction strengths (6 per cell, 0..255 for 0..2), estates' shares (4 per cell), army kind. */
  snapshots: number
  policy: Uint8Array
  factions: Uint8Array
  estates: Uint8Array
  army: Uint8Array
}
History.court: CourtHistory
HistoryOptions: /** court: regimes (tribal, feudal, estates, absolutist, bureaucratic ... constitutional) and their evolution, estates and assemblies that bargain taxes for privileges, named office holders, court factions that set policy and plot (needs polities and rulers). Default true once tuned; false leaves History.court empty and the history exactly the one without it. */ court?: boolean
HistoryDiagnostics.court?: CourtDiag   // counts: transitions by (from, to), sessions by outcome, privileges by kind, plots by kind and end, holders by end, faction turnovers, policy steps by winner, hazard sums for the harness
```
`history.test.ts` event switch +290–299; `worker.ts` transfer list +all typed arrays (`courtBuffers(h.court)`);
`emptyCourtHistory()`.

---

## 9. Seat mode: the court as the main source of decision cards

### 9.1 New DecisionKind rows (seat/watch.ts; pure reads; fog rules unchanged)
| DecisionKind | trigger (D = this year), seat polity p with a full court | options → orders (year D+1) | cool |
|---|---|---|---|
| Estates 18 | the 4.3 summon test passes (gap and urg), or a Standing assembly's supply step | Summon and concede (SummonEstates p, stance 0: generous) · Summon and demand (stance 1: the crown's estimate of o_c × 1.3; more refusals) · Do without them (∅: the crown takes its outside option: borrow/debase/coerce by 4.4) | 20 |
| Council 19 | a faction's `w_k ≥ 0.9·w_winner` (a divided court), or FactionAscendant this year | Side with {War/Peace/...} (Favour p→k, 2–3 strongest) · Rule yourself (Favour p→Crown) · Let the court decide (∅) | 15 |
| Office 20 | a vacancy in Chancellor, Marshal or Treasurer (the two drawn candidates are in the state: a pure read) | Appoint A · Appoint B (Appoint p→office·2+i) · Let the court decide (∅) | 0 |
| Plot 21 | a plot was Foiled this year, or `P_k ≥ COURT.cardPlot 0.02` and the spymaster's competence ≥ 0.9 ("your spymaster reports...") | Arrest them (Arrest p→k) · Buy them off (Placate 17) · Watch and wait (∅) | 15 |
| Reform 22 | a transition target has `h ≥ 0.05` among T5, T6, T9, T10, T13, T15 or a CourtReform is gated | Push the reform (Reform p→target: hazard × 5 for 20 y, cost finSpend 0.5 R°) · Hold to custom (∅) | 40 |
| Regency 23 | Regency (84) at p | Queen mother · Uncle · Council of regency (Appoint p→Regent·2+i, or ∅ = the council: no Regent office, crisis as today) | 0 |
| Exile 24 | a CourtExile from q arrives at p's capital (`other = cap p`) | Receive him (∅) · Send him back (Dismiss p→exile, the Asylum grievance not recorded; relR(p,q) −0.05) | 20 |
When court is on, **Estates replaces Credit (12)** and **Plot replaces General (8)** (General's Purge option moves into
Plot when the plotter holds the Marshal). `PRIORITY`: WarOnUs, Crisis, Regency, Plague, Plot, Overlord, Heir, Estates,
Revolt, Office, Council, Betrayal, Opening, Exile, Reform, AllianceMade, AllianceSought, Charter, Match, Faith,
Frontier, Idea, Crop. Expected share of cards from the court ≥ 50% for a Kingdom+ polity seat (12).

### 9.2 Order kinds 33–38 (`orders/courtOrders.ts`; every hook neutral when absent; extra decisions draw only from `ox.rng`)
| kind | key | actor → target | years | rule |
|---|---|---|---|---|
| SummonEstates 33 | `summon` | polity → stance 0/1 | 1 | a session at the next slow step even if 4.3 fails (G = max(gap, 0.5)); stance 1: o_c × 1.3 in 4.4. Fulfilled at EstatesSummoned |
| Appoint 34 | `appoint` | polity → office·2 + candidate | 1 | the vacancy's chosen candidate is `candidate` (the draws were made already); Regent·2+i selects queen mother (0) or uncle (1). NoTarget if no vacancy |
| Dismiss 35 | `dismiss` | polity → office + 8·mode | 1 | at give: the holder ends Dismissed (0), Disgraced (1) or Executed (2: tyranny act); the faction's `out` resets and its plot propensity × 1.5 for 20 y |
| Favour 36 | `favour` | polity → FactionKind | 15 | `fav_k = 1` in force (Crown: w_Crown × 2) |
| Arrest 37 | `arrest` | polity → FactionKind | 1 | at give: one `ox.rng` draw `< 0.15 + 0.3·F_k/ΣF` ⇒ the faction strikes first (a Coup plot now, resolved by 6.5's success draw from `ox.rng`); else its holders Disgraced, `F_k ·= 0.3`, `fav_k = 0` |
| Reform 38 | `reform` | polity → Regime or 16 + CourtReformKind | 20 | the target's hazard × 5 (still the court's one draw); cost `finSpend(0.5·R°)` or proxy 0.1 of capital wealth; Failed Refused if unpaid |
Existing kinds reused: Placate 17 → plot propensity × 0.5 for 15 y and favour of all factions +0.2; Purge 18 → Dismiss Marshal mode 1 with battles' rule; Levy 20 → coerce (4.4) without a session.

### 9.3 Card text (examples; hedged in the Chronicle register)
- Estates: "The treasury holds a year's pay for a war that will last three. The Diet of Ostra will grant it — for the
  right to audit the accounts."
- Plot: "Your spymaster, Taro Veckin, names the peace party: they meet at the house of the chancellor."
- Reform: "The constable proposes a standing army, paid from the salt tax and loyal to the crown alone."

---

## 10. UI and prose

### 10.1 Names (assembly, `src/sim/names/courtNames.ts`; draws only from `names-holder-<id>`, in id order; prefix-stable)
- Language: `naming.language(naming.tribe[cap], naming.level[cap])` at the appointment year's capital (works with language
  drift's node ids, its 9.1).
- Kin: a personal name from the house's stock (`nameRulers`' stocks) + the house name. Merchant: a family head-style
  personal name + `familyName(h, f)`. Noble: personal name + "of {seat town}". Others: a fresh personal name; Slave and
  Scholar get one word; Foreigner keeps his name from his first court (same row's name copied: the exile's row at q
  points to the original, `seat = -1`).

### 10.2 Data and panels
`ui/courtData.ts` (`regimeAt`, `courtAt(h, p, year)`: holders in office, winning faction, strengths, assembly and
privileges). Factions panel detail gets a **Court** section: regime with its legitimacy type, assembly with privilege
chips, the six offices with names and competence words, a faction bar (strengths), the last sessions. Rulers panel: the
regent and the favourite. Chronicle filter group "Court" (290–299).

### 10.3 Chronicle (hedged) and Legend (story) lines — phrase table `COURT_T` in `ui/sagas/court.ts`, both registers
| event | Chronicle | Legend |
|---|---|---|
| EstatesSummoned Bargain + PrivilegeWon Audit | "1288 — The king of Ostra summoned the estates for the war with the Vosk; they granted an aid of two years' revenue, and are said to have won the right to see the accounts." | "The barons gave Ivo his silver, and took from him the key to his own treasury." |
| EstatesSummoned Refused → Coerced | "1312 — The Diet refused the tax; the crown seems to have collected it regardless, and the towns of the coast were in arms by spring." | "They said no. The king's men came for the silver anyway, and Kubeta shut its gates." |
| RegimeChanged Constitutional | "1688 — After the deposition, the crown of Tarsa held its revenues only by vote of the Diet." | "The crown became the servant of the Diet." |
| RegimeChanged Absolutist | "From about 1640 the estates of Vosk were no longer summoned; the king's intendants ruled the provinces." | "The king stopped asking." |
| RegimeChanged Feudal (Fiefs, after collapse) | "As the empire broke apart, its governors became lords of the land they had held for the crown." | "Every captain a king in his own valley." |
| RegimeChanged Examinations | "1605 — Offices in Han-Sur were given by examination, and the great families' grip on the court is said to have loosened." | "From then on a peasant's son with a brush could rise higher than a prince." |
| RegimeChanged SlaveSoldiers | "By 1250 the sultan's bought soldiers, not his house, chose who ruled at Amra." | "The slaves of the throne became its masters." |
| FactionAscendant War over Peace | "1340 — The war party gained the king's ear; the chancellor, of the peace party, did not last the year." | "The hawks had the king now, and the doves went home." |
| CourtPlot Poison Succeeded | "1402 — The king died suddenly at table; the chroniclers, writing later, blamed the queen's party." | "A cup of wine, and a crown changed hands." |
| CourtPlot Coup Foiled | "1418 — A plot against the king was discovered; the constable and two lords were put to death." | "The spymaster heard the whisper first, and three heads went up on the gate." |
| CourtExile | "1420 — The disgraced chancellor fled to the court of the Vosk, taking, it was feared, the secrets of the treasury with him." | "He left by night with the king's secrets in his saddlebags." |
| MinisterSeized | "751 — The steward of the household, long the real power, set the last king aside and took the crown." | "He had carried the king's keys for twenty years; now he wore the king's crown." |
Hedging rules as seat-mode 6.4: the Chronicle never states a hidden motive as fact ("are said to", "blamed"); poison is
always "blamed" in the Chronicle (the record holds a cause the chroniclers could not know).

### 10.4 Partisan sagas take a faction's side (`ui/sagas/lens.ts`, experience plan 3.2)
- `Pov.kind = 'faction'`, `id = p·16 + FactionKind` (URL `pov=faction:3:1`, the peace party of polity 3).
- Stance: **Us** = holders of the faction and the ruler in years it led; **Foe** = the rival faction (War ↔ Peace, Faith ↔
  Merchant, Regent ↔ the faction that ended the regency) and any ruler who executed its leaders; Neutral otherwise.
  Foreign polities keep the state lens rules with V = p.
- Rhetoric: policies of Us that ended well are "our counsel"; failures under the Foe faction are its folly ("the war
  party's war"); a foiled plot of Us is "the false accusation of {year}", an executed leader of Us is a martyr; a coup of
  Us is "the deliverance of the realm". Wars: War faction's teller keeps the won wars and calls the white peace a
  betrayal by the peace party (the Dolchstoß reframe, used only when a FactionAscendant Peace precedes the peace within 5
  years, so nothing is invented); the Peace teller tells every lost war started under War leadership.
- Phrase keys `court.*.us` / `court.*.foe` in `PARTISAN_T`. Example: Peace teller, Chronicle — "In 1340 the war party
  carried the king into the Vosk war, against the counsel of the chancellor"; War teller, Legend — "In 1344 the peace
  party sold the victory at the table."
- Neutral texts are byte-identical (their test 1) because the new keys are used only with a faction pov.

### 10.5 Story director (experience 0.1) — `registerDrama` from `courtFormat.ts`
| type | cat | base | magnitude |
|---|---|---|---|
| RegimeChanged 292 | Politics | 6 (Constitutional, Absolutist, Examinations, SlaveSoldiers ×1.3; world's first of a kind ×1.5) | polity pop |
| EstatesSummoned 290 | Politics | 3 (Refused/Coerced/Deposition 5) | — |
| PrivilegeWon 291 | Politics | 3 (Consent/Audit/Standing 4) | — |
| CourtPlot 295 | Politics | 3 (Succeeded 6) | polity pop |
| MinisterSeized 298 | Politics | 6 | polity pop |
| CourtExile 296, MinisterFell 297 (Executed) | Politics | 3 | — |
| FactionAscendant 294, AssemblyChanged 293, CourtReform 299 | Politics | 2 | — |

---

## 11. Determinism, step order, off switch

### 11.1 Placement (politySystem [V polity/system.ts:139–161])
- **`courtYear(s, ps, C)`** yearly, after `rulerYear` and after riots' `uprisingYear` (so this year's successions,
  regencies, tyranny acts and revolutions are in the event list), before the step gate: event scan from `C.evSeen`
  (Regency → Regent vacancy; RulerAcceded → new-reign keep draws; CommanderDismissed → Marshal falls; CrownDefault,
  ArmyUnpaid → fail flags; ReignEnded → holder deaths of Kin; DynastyEnded → Ext), holder deaths by pre-drawn year,
  `Wsh` counters, pending plot outcomes from orders.
- **`courtSlow(s, ps, C)`** every slowStep, inside the slow block **after `absorption` and before `relationStep`**
  (so the policy vector of this step drives `allianceStep` and `declarations`; overawe and absorption are untouched).
  Order inside: (1) indicators (3.2), (2) regime step (3.4, draws), (3) estates strength, summon, bargain, refusal draws
  (4), (4) offices: vacancies (draws), dismissal hazards (draws), (5) factions and winner (no draws), (6) plots (draws),
  (7) policy vector write, (8) snapshot row. Polities in `ps.alive` order throughout; offices in OfficeKind order.
- Finances' `fiscalYear` runs earlier in the year [their 3.1], so grants credited in courtSlow are spent next fiscal year.

### 11.2 RNG
- Stream `createRng(seed, 'history-court')`, created only when on. All court draws use it, in the fixed order above.
  Counter-based hashes (`mix32`) are not needed.
- Hooks on other systems' draws are **threshold-only** (declarations, tired peace, alliance chance, overthrow, contested,
  revolt chance, persecution chance, leaks). Calls into rulers (`newHouseAccede`, `succession`), riots (`revoltAt`) and
  city-states (`govRisingResolve`, `govCharterGrant`) draw from their own streams, as those plans allow.
- Arithmetic `+ − * /`, smoothstep, sqrt; no pow/log/exp in the sim.

### 11.3 Off identity and shadow mode
- `court: false` (or rulers off) → `s.court = null`; every hook is `s.court !== null ? new : old`, and multipliers are
  skipped, not ×1. Test: History equal to the run without court on every pre-existing field (vitest 42:1200, 3:600,
  9:800 n=24) with all sibling plans at their defaults; existing goldens unchanged.
- **Shadow** `COURT.effects = false`: everything computed and recorded (History.court filled, events 290–299 logged),
  no hook reads it, no grants credited, no succession calls. Must equal off on all pre-existing fields (events aside).
  A real test until step 8, then dropped with a commit note (as grudges 3.8, finances 3.2, riots 6).
- Golden-hash filters skip key `court` and events 290–299.
- Prefix stability: yearly and per step, append-only rows; a 1200-year run equals the first 1200 years of a 2000-year one.
- Seat: the watcher reads candidates and `P_k` (state), never pre-drawn death years of holders (lint test greps
  `watch.ts` for `hDeathY`).
- Checkpoints (perf P6): `CourtState` is one object literal on `HistoryState` (`s.court`), captured by `RunnerState`.

---

## 12. Stats harness (`src/sim/history/court/courtStats.ts [--off] [--json] seeds…`; seeds 1, 7, 42, 1234, 2000 years; and the 22-seed sweep for regimes)
Targets (all [A] unless sourced; they guide tuning, and "by construction" rows are invariants that must hold exactly):
| metric | target |
|---|---|
| **Regime distribution** (share of Kingdom+ polity-years by regime, per quarter of the run after the first state) | Q1: Tribal + Patrimonial + Nomadic ≥ 0.7; Q2–Q3: Feudal 0.15–0.45; Q4: Estates + Elective 0.1–0.35, Absolutist + Bureaucratic 0.05–0.3, Constitutional ≤ 0.1; 22-seed sweep: each pattern holds in ≥ 70% of seeds |
| Re-feudalisation | ≥ 40% of successors of an Empire-tier polity that collapsed are Feudal within 100 y (by the founding rule, the share is the fraction that are not recentralised fast) |
| Absolutist/Bureaucratic preconditions | 100% of entries have Lit ≥ 0.5 and Wl ≥ 0.4 and (Absolutist) Mon (invariant); present in ≥ 2 of 4 seeds by year 2000 |
| Constitutional | 0–3 realms per seed; 100% of entries with Audit ∧ Consent ∧ Standing and σ_T ≥ 0.3 (invariant) |
| MilitarySlave, Sultanistic, Elective, Nomadic | 0–2, 1–8, 0–3 per seed; Nomadic only where Herd ≥ 0.5 (invariant) |
| Transitions per seed | 30–120; reversals ≥ 1 per seed |
| **Estates summoned per century in fiscally stressed realms** (Kingdom+ monarchy-like polity-centuries with finSFD ≥ 1.5 or finNeed ≥ 0.5, regime with an assembly) | 1–4 (England summoned ~1 parliament every 2–3 years in the 14th c.; this sim's grain is decadal, so 1–4 is "most crises") |
| Session outcomes | Granted + Bargain 0.5–0.8; Refused ≤ 0.35; Coerced → Estates revolt ≤ 15% of refusals; Deposition 0–3 per seed |
| Privileges | ≥ 1 assembly with Standing in ≥ 2 of 4 seeds by 2000; Consent held by 10–40% of assemblies |
| Credible commitment | median rate of crowns with Audit ∧ Standing lower than other monetised crowns by 0.5–2.5 points (bounded [D]) |
| **Share of policies set by factions** (Kingdom+ slow steps whose winner ≠ Crown) | 0.3–0.6 |
| Faction turnovers (FactionAscendant) | 1–4 per realm-century |
| **Coups per run** (successful palace coups + MinisterSeized) | 5–20 per seed; attempts' success share 0.35–0.6 (Powell & Thyne ≈ 0.5, modern [D]) |
| Poisonings | ≤ 25% of court killings (Murdered) |
| Total overthrow guard | Overthrown + Deposed + Murdered + EstatesDeposed at Kingdom+ within 1.0–2.0× the off run (baseline 15–24, 1.2) |
| Median reign length at Kingdom+ | ≥ 0.8× the off run |
| Office tenure | median 8–20 y; Executed ≤ 30 per seed; holders rising to the throne 2–10 per seed |
| Defections (CourtExile) | 5–30 per seed |
| Seat cards | ≥ 50% of cards for a Kingdom+ polity seat come from 18–24 (seatStats with court on) |
| Cost | history time +≤ 2% (bench-sim); History bytes +≤ 2% |

### 12.1 Realism scorecard (realism-metrics.md 6)
Run `realismStats.ts 1 7 42 1234 --json --opts '{"court":false}'` vs on. **Guard**: score rise ≤ 0.03; no WORSE on
Zipf, Gibrat, gravity, war.alpha, war.durCv (battles owns them), war.onsetPerDecade within ±20%. **Intended to
improve**: `lifeK.mean` toward ~220 years (feudal fission, coups, estates' revolts, collapse of bureaucracies) and the
count of Empire-tier states that ever end (T14 plus the Feudal `frag` factor); shared with city-states and finances —
by the README tie-break the later-built plan (this one) re-tunes. Accepted trade-off to state if it occurs: war onset
dispersion may rise slightly (War-party ascendancy clusters declarations), bounded by grudges' ≤ 1.6.

---

## 13. Performance and memory [A, from the measured counts in 1.2]
- Per slow step: full courts ≈ 8 on average (≤ 23): indicators O(members) via the existing per-polity sums (one pass over
  `s.living` per step, shared with society's pass when on), 6 offices, 6 factions, 4 estates, ≤ 1 bargain, ≤ 1 plot.
  Chiefdoms: one hazard. Yearly: an event scan from a cursor. Estimate < 1% of history time (~28 s/seed here).
- Rows per run: holders ≈ 8 realms × 5 offices × 2000 / 12-year tenure ≈ 7 k (≈ 50 bytes each with the name: 350 KB);
  sessions 0.3–1 k; plots 0.1–0.5 k; regimes 50–200; snapshots 200 × P(≤ 90) × 12 bytes ≈ 216 KB. Total < 1 MB
  (History is 35–39 MB [seat-mode 5]).
- State: per polity ~40 numbers (`W, Wl, regime, reforms, σ×4, F×6, fav×6, out×6, pending, …`) — a few KB.

---

## 14. Ordered commit-sized steps (each: `npm test`, `npm run typecheck` green)
1. **Contract and option.** Enums, events 290–299, `CourtHistory`, `emptyCourtHistory`, `HistoryOptions.court` (default
   false), registry values (RevoltCause 16, GrievanceKind 13, ReignEnd 10–11, OrderKind 33–38 as placeholders with
   SystemOff), golden filters, `history.test.ts` switch, worker transfer list, `registerDrama` stubs or DRAMA_IGNORED.
   Test: off ≡ 8cabf09 (+ siblings).
2. **State, founding regime, mapping** (`court/{params,state,regime}.ts`, `courtNewPolity`, `courtGovChanged`,
   snapshots, assembly into `History.court`). Shadow test ≡ off.
3. **Indicators and transitions** (3.2–3.5) in shadow; `courtStats.ts` regime tables; `ui/courtData.ts regimeAt`.
   Tests: invariants of 12 hold on 4 seeds; each transition reachable in a synthetic state test.
4. **Offices and holders** (5.1–5.3) in shadow, battles adoption read-only; `courtNames.ts`. Tests: draw count per
   appointment = 12; names unique per court-year; prefix stability.
5. **Estates and bargaining** (4.1–4.5) in shadow, with finances proxy and real. Tests: BRW properties — agreement iff
   Σ > max(o_c, 0); estates' share monotone in r_c; Σ ≤ 0 ⇒ Refused or no summon; privilege picking deterministic.
6. **Factions and policy vector** (6.1–6.4, 6.7) in shadow. Tests: Crown wins for an able ruler with weak factions;
   hysteresis; favour dynamics bounded.
7. **Plots** (6.5–6.6) in shadow (outcomes recorded, no kills). Tests: draw order; detection monotone in spymaster c.
8. **Regime effects** (3.6 hooks). Drop the shadow identity test (commit note). Realism guard run.
9. **Office effects** (5.4) incl. battles `battleNewCommander/battleRecall`, beliefs spymaster factors.
10. **Estates feedback**: grants, privileges' effects, rate factor (4.6), refusal paths (riots `revoltAt`, city-states
    `govRisingResolve/govCharterGrant`), ReignEnd 11.
11. **Faction policy hooks** (declarations, tired peace, alliances, riots' policy, religion, tariffs).
12. **Plot effects**: coups, poison (ReignEnd 10), pretenders (rulers `contested` factor), defection (beliefs, goods
    leaks, grudges Asylum), MinisterSeized.
13. **Seat mode**: DecisionKind 18–24, orders 33–38 (`orders/courtOrders.ts`), card texts; seatStats.
14. **UI**: Court section, Chronicle lines 290–299, filter group, drama rules (10.5).
15. **Sagas**: `COURT_T` both registers; regime narration in state/reigns/year sagas; partisan faction Pov (10.4) with
    tests (neutral byte-identical; a faction teller uses `.us/.foe` keys; no `{` left).
16. **Tuning** against 12 and 12.1 on 4 seeds, then the 22-seed sweep; flip `COURT.enabled` to true.

---

## 15. Risks and open questions

### Risks
- **Double counting with siblings.** Ψ already raises overthrows (society h5), riots owns legitimacy and capital
  revolutions, battles owns general coups (`battleCoup`), city-states' GOV owns non-monarchic behaviour. Mitigation: regime
  factors only on Monarchy/Signoria; court coups use a separate attempt path and the existing overthrow draw only gets
  `REGIME.overthrow · (1 + plotHeat)`; the total-overthrow guard (12) is a hard gate.
- **The faction layer erases rulers' character.** If factions win too often, `rulerWar` stops mattering. Gate: policies
  set by factions ≤ 0.6, and Crown weight scales with ability.
- **Regime mix is dominated by one path on small worlds** (7–10 Kingdom+ realms alive): distributions are noisy per seed;
  judge patterns on the 22-seed sweep.
- **BRW with crude utilities**: the surplus is linear in G, so deals are all-or-nothing in G. Acceptable at decadal grain;
  a partial grant (G scaled by θ_cr) is an option if refusals are too binary.
- **North & Weingast factor** could make Constitutional realms snowball through cheap credit. Cap 0.55 on courtRate and the
  2.5-point spread target.
- **Names of many holders** add assembly time; measure (step 4). Fallback: name only holders who appear in events or panels
  lazily in the UI (the name stream is per holder id, so lazy naming is equivalent).
- **Seat leakage**: candidates and plot propensity are state the court could plausibly know; holder death years are not.
- **Tone**: poisonings, executions and slave soldiers are told soberly; partisan faction sagas carry the same "the
  teller's numbers and blame" tag as the experience plan.

### Open questions
1. Civic factions (Guelph/Ghibelline) for republics from city-states' councils (`COURT.civicFactions`)?
2. Should successor states of a Constitutional realm keep its assembly bits whole, or at half (an untested crown)?
3. Should estates bargain at successions in Elective regimes with their own option (election capitulations as
   Succession/Consent privileges)? This plan does it through the Kurultai/Sejm summoning at every succession (3.6);
   check the cadence.
4. Eunuchs as a holder origin of their own (Han, Ming courts) rather than folded into Slave?
5. Should venal offices be inheritable (the *paulette*, 1604), giving holder rows a family succession?
6. DecisionKind registry: the coordinator should add 0–17 seat-mode, 18–24 court-politics to `_CONVENTIONS.md`.

### Verified [V]
`declarations` mul from `rulerWar` (war.ts:68–95, rulers/system.ts:391); `tired` peace draw (war.ts:413); overthrow
formula and draws (rulers/system.ts:436–441); Regency in `accede` (l.240–247); `rulerMass` (l.384); RulerState fields
(rulers/state.ts); politySystem order (polity/system.ts:117–169); `taxSystem` wealth tax (polity/system.ts:192–197);
`acrit` fragmentation (unrest.ts:219); POLITY.step 5, slowStep 10, mapStep 20 (polity/params.ts:12–15); idea keys and
`held[p·I + i]` (ideas/params.ts, state.ts); `ideaAdmin` exists (ideas/hooks.ts:169); Tier thresholds (contract.ts:1213);
ReignEnd 0–8 and AccessionHow (contract.ts:862–885). Sibling plans' names and ids: read in full on 2026-11-26.

### Measured [M]
Section 1.2 (`/home/claude/scratch-court/scripts/courtProbe.ts <seed> 2000`): Kingdom+ polity-years 14.6–20.6 k,
mean 7.3–10.3 and max 20–23 Kingdom+ realms alive, overthrows + depositions 15–24 per run, crises 153–215, regencies
99–133, civil wars 9–15; ~28 s per seed (4 in parallel).

### Assumed [A]
Every constant in 3.4, 3.6, 4.2–4.6, 5.2–5.4, 6.2–6.7 and the targets of 12; the literacy proxy; the costs in 13.

## References
Citation audit 2026-11-26. [verified] = a publisher, DOI, RePEc, library-catalogue or scholarly page confirming the
item (and, where stated, the attributed claim) was opened; [unverified] = not confirmed, with the reason. Every
REGIME/COURT number, privilege value and harness target in this plan is a **design default**, not a sourced fact.
The dated historical illustrations (Edward II 1327, Richard II 1399, Poland 1572, Estates-General 1614–1789, the
paulette 1604, Mamluk sultanate 1250, Mahmud II 1826, Samarra) are examples, not checked in this audit.
"Search budget" below means that the audit's shared web-search allowance ran out before the item was looked up; the
bibliographic details of every [unverified] entry are from memory and must be checked before they go into code headers.

- Barfield, T. J. (1989). *The Perilous Frontier: Nomadic Empires and China*. Oxford: Blackwell. [unverified: search budget]
- Bates, R. H., & Lien, D.-H. D. (1985). A Note on Taxation, Development, and Representative Government. *Politics &
  Society* 14(1): 53–70. https://doi.org/10.1177/003232928501400102 [verified: RePEc/SAGE]
- Binmore, K., Rubinstein, A., & Wolinsky, A. (1986). The Nash Bargaining Solution in Economic Modelling. *RAND
  Journal of Economics* 17(2): 176–188. https://ideas.repec.org/a/rje/randje/v17y1986isummerp176-188.html [verified:
  as the incentive to agree becomes negligible, the alternating-offers equilibria approach the Nash solution.
  "Outside options as constraints" also confirmed by MIT 6.972 (2005): an outside option matters only if it beats the
  equilibrium payoff]
- Blaydes, L., & Chaney, E. (2013). The Feudal Revolution and Europe's Rise: Political Divergence of the Christian
  West and the Muslim World before 1500 CE. *American Political Science Review* 107(1): 16–34. [unverified: the
  volume/pages are given from memory; the
  publisher page failed to load and the search budget ran out. The deposition-share figure in 1.2 is not confirmed]
- Bloch, M. (1939–40). *La société féodale*. Paris: Albin Michel (Eng. *Feudal Society*, 1961). [unverified: search budget]
- Brewer, J. (1989). *The Sinews of Power: War, Money and the English State, 1688–1783*. London: Unwin Hyman.
  [unverified: search budget; includes the per-head tax comparison with France]
- Bueno de Mesquita, B., Smith, A., Siverson, R. M., & Morrow, J. D. (2003). *The Logic of Political Survival*.
  Cambridge, MA: MIT Press. https://en.wikipedia.org/wiki/The_Logic_of_Political_Survival [verified: authors,
  publisher, year; the winning coalition and selectorate as subpopulations]
- Centeno, M. A. (2002). *Blood and Debt: War and the Nation-State in Latin America*. University Park: Penn State
  University Press. [unverified: search budget]
- Chehabi, H. E., & Linz, J. J. (eds.) (1998). *Sultanistic Regimes*. Baltimore: Johns Hopkins University Press.
  [unverified: search budget]
- Clark, G. (1996). The Political Foundations of Modern Economic Growth: England, 1540–1800. *Journal of
  Interdisciplinary History* 26(4): 563–588. https://faculty.econ.ucdavis.edu/faculty/gclark/research.html
  [verified: citation (issue 4 from the stable link and Pincus & Robinson 2011). The finding (no sharp fall in interest
  rates after 1688; property secure by c. 1600) is confirmed via Pincus & Robinson's summary, not Clark's text. The
  plan's earlier wording "no break in private returns" was reworded to match]
- Crone, P. (1980). *Slaves on Horses: The Evolution of the Islamic Polity*. Cambridge: Cambridge University Press.
  [unverified: search budget]
- Downing, B. M. (1992). *The Military Revolution and Political Change: Origins of Democracy and Autocracy in Early
  Modern Europe*. Princeton: Princeton University Press. [unverified: search budget]
- Doyle, W. (1996). *Venality: The Sale of Offices in Eighteenth-Century France*. Oxford: Clarendon Press.
  [unverified: search budget]
- Elias, N. (1969). *Die höfische Gesellschaft*. Neuwied/Berlin: Luchterhand. Eng. *The Court Society*, trans.
  E. Jephcott, Oxford: Blackwell, 1983. https://en.wikipedia.org/wiki/Norbert_Elias [verified]
- Elman, B. A. (2000). *A Cultural History of Civil Examinations in Late Imperial China*. Berkeley: University of
  California Press. [unverified: search budget]
- Ertman, T. (1997). *Birth of the Leviathan: Building States and Regimes in Medieval and Early Modern Europe*.
  Cambridge: Cambridge University Press. https://www.cambridge.org/core/product/identifier/9780511529016/type/book [verified:
  bibliographic. The argument (the timing of sustained geopolitical competition, before or after c. 1450, gives a
  patrimonial or bureaucratic apparatus; territorial vs. estate-divided assemblies give a constitutional or absolutist
  regime) is confirmed via a scholarly summary, https://adambrown.info/p/notes/ertman_birth_of_the_leviathan]
- Fukuyama, F. (2011). *The Origins of Political Order*. New York: Farrar, Straus and Giroux. [unverified: search budget]
- Hoffman, P. T., & Rosenthal, J.-L. (1997). The Political Economy of Warfare and Taxation in Early Modern Europe:
  Historical Lessons for Economic Development. In J. N. Drobak & J. V. C. Nye (eds.), *The Frontiers of the New
  Institutional Economics*, pp. 31–55. San Diego: Academic Press.
  https://authors.library.caltech.edu/records/shtw0-z9c51 [verified; the editors' role is listed as "Others" on the page]
- Hui, V. T. (2005). *War and State Formation in Ancient China and Early Modern Europe*. Cambridge: Cambridge
  University Press. [unverified: search budget]
- Ibn Khaldun (1377). *The Muqaddimah: An Introduction to History*, trans. F. Rosenthal. Princeton: Princeton
  University Press, 1958. [unverified: search budget]
- Levi, M. (1988). *Of Rule and Revenue*. Berkeley: University of California Press.
  https://www.ucpress.edu/books/of-rule-and-revenue/paper [verified: author/publisher (the page lists the 1989
  paperback) and a chapter on "Creating Compliance". The term "quasi-voluntary compliance" was not on the fetched page]
- MIT 6.972 (2005). Lecture 15: bargaining (Rubinstein; Nash). MIT OpenCourseWare.
  https://dspace.mit.edu/bitstream/handle/1721.1/73647/6-972-spring-2005/contents/lecture-notes/lec15.pdf
  [verified: limit share of player 1 = r₂/(r₁ + r₂); outside options matter only above the equilibrium payoff]
- Moore, B., Jr. (1966). *Social Origins of Dictatorship and Democracy: Lord and Peasant in the Making of the Modern
  World*. Boston: Beacon Press. [unverified: search budget]
- Nash, J. F. (1950). The Bargaining Problem. *Econometrica* 18(2): 155–162.
  https://www.econometricsociety.org/publications/econometrica/1950/04/01/bargaining-problem [verified]
- North, D. C., & Weingast, B. R. (1989). Constitutions and Commitment: The Evolution of Institutions Governing
  Public Choice in Seventeenth-Century England. *Journal of Economic History* 49(4): 803–832.
  https://doi.org/10.1017/S0022050700009451 [verified, including the Table 4 rates: 14% (1693), 6–8% by the late
  1690s, 3% by the 1730s]
- Pincus, S. C. A., & Robinson, J. A. (2011). What Really Happened During the Glorious Revolution? NBER Working Paper
  17206. https://www.nber.org/papers/w17206 [verified: the change came through Whig-dominated party ministries,
  not the solution of a credible-commitment problem]
- Pipes, D. (1981). *Slave Soldiers and Islam: The Genesis of a Military System*. New Haven: Yale University Press.
  [unverified: search budget]
- Powell, J. M., & Thyne, C. L. (2011). Global Instances of Coups from 1950 to 2010: A New Dataset. *Journal of Peace
  Research* 48(2): 249–259. https://doi.org/10.1177/0022343310397436 [verified: 457 attempts, 227 successful (≈ 50%)]
- Rubinstein, A. (1982). Perfect Equilibrium in a Bargaining Model. *Econometrica* 50(1): 97–109.
  https://www.econometricsociety.org/publications/econometrica/1982/01/01/perfect-equilibrium-bargaining-model [verified]
- Stasavage, D. (2003). *Public Debt and the Birth of the Democratic State: France and Great Britain, 1688–1789*.
  Cambridge: Cambridge University Press. https://doi.org/10.1017/CBO9780511510557 [verified: better access to finance
  after 1688 "had as much to do with the development of the Whig Party as with constitutional changes"]
- Stasavage, D. (2010). When Distance Mattered: Geographic Scale and the Development of European Representative
  Assemblies. *American Political Science Review* 104(4): 625–643.
  https://ideas.repec.org/a/cup/apsrev/v104y2010i04p625-643_00.html [verified: bibliographic]
- Stasavage, D. (2011). *States of Credit: Size, Power, and the Development of European Polities*. Princeton: Princeton
  University Press. https://doi.org/10.1515/9781400838875 [verified: bibliographic. The attributed claim (compact
  polities with merchant-dominated assemblies borrowed more cheaply) was not checked on a fetched page]
- Strayer, J. R. (1970). *On the Medieval Origins of the Modern State*. Princeton: Princeton University Press.
  [unverified: search budget]
- Sussman, N., & Yafeh, Y. (2006). Institutional Reforms, Financial Development and Sovereign Debt: Britain
  1690–1790. *Journal of Economic History* 66(4): 906–935.
  https://ideas.repec.org/a/cup/jechis/v66y2006i04p906-935_00.html [verified: rates high and volatile for four
  decades after 1688]
- Svolik, M. W. (2012). *The Politics of Authoritarian Rule*. Cambridge: Cambridge University Press.
  https://www.cambridge.org/core/product/identifier/9781139176040/type/book [verified: the problem of authoritarian
  power-sharing with "the elites with whom dictators rule" (https://politicalscience.yale.edu/node/1200)]
- Tilly, C. (1990). *Coercion, Capital, and European States, AD 990–1990*. Cambridge, MA: Basil Blackwell.
  https://cambridge.org/core/journals/international-review-of-social-history/article/charles-tilly-coercion-capital-and-european-states-ad-9901990-studies-in-social-discontinuity-basil-blackwell-cambridge-mass-etc-1990-xi-269-pp-maps-2500/93C92F2173EC42E0F41E1E92F1A17BC1
  [verified:
  publisher/year (IRSH review listing); the "coercion-intensive, capital-intensive, and capitalized coercion" paths
  and "war and preparation for war produced the major components of European states" (text of chs. 1, 3 and 6)]
- Tilly, C. (1975). Reflections on the History of European State-Making. In C. Tilly (ed.), *The Formation of National
  States in Western Europe*. Princeton: Princeton University Press. (Source of "war made the state, and the state made
  war".) [unverified: search budget]
- van Zanden, J. L., Buringh, E., & Bosker, M. (2012). The Rise and Decline of European Parliaments, 1188–1789.
  *Economic History Review* 65(3): 835–861. https://ideas.repec.org/a/bla/ehsrev/v65y2012i3p835-861.html [verified]
- Weber, M. (1922). *Wirtschaft und Gesellschaft*. Eng. *Economy and Society*, ed. G. Roth & C. Wittich. Berkeley:
  University of California Press, 1978. [unverified: search budget]
