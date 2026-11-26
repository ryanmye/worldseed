# Plan: Future politics — ideologies and forms of government that new technology and new thinking could produce

Plan only. Code: read-only checkout `/home/claude/ryanmye/worldseed` @ 8cabf09. Probe: scratch copy `/home/claude/scratch-futurepol`
(`scripts/fpProbe.ts`, `node --experimental-strip-types`, default options). Tags: **[V]** read in the 8cabf09 tree (file:function),
**[M]** measured on the scratch copy, **[A]** assumed: a design default or a constant to tune (not a fact), **[D]** a contested claim,
cited as contested. Citations follow the `_CONVENTIONS.md` citation rule: inline (Author Year), each tagged **[verified]** (a page
confirming the work was opened this session) or **[unverified]** (with the reason), and listed in the References section at the end.

- **EventType block 330–339** (given to this plan).
- **Off switch** `HistoryOptions.futurePolitics` (default `false` until the harness passes, then `true`). **RNG stream** `'history-futurepol'`,
  created only when on. **Module** `src/sim/history/futurepol/`.
- **This plan extends, and does not fork, `modern-ideologies-regimes.md` (MIR).** MIR treats an ideology as an idea (a catalogue row
  conceived where its preconditions hold and carried by the ideas system's channels, with adherents per settlement in riots-uprisings'
  movement slots) and gives polities modern regimes with a transition machinery. This plan adds rows to the catalogue, values to the
  government enum and routes to the transition table, all through MIR's own entry points (0.2).
- **Status of the parallel plans.** `court-politics.md`, `future-tech.md` (FT) and `tech-tree-innovation.md` (TTI) appeared while this
  plan was being written and were read before finishing; their names are adopted (0.3) and, under the owner's integration rule, this
  plan **reuses** their quantities instead of re-deriving them: FT's displaced share `u_p`, relief, alignment, AI level, machine
  crisis (326), off-world rows, warming and effective distance; TTI's era frontier and its bans (IdeaBanned 300).
  `modern-ideologies-regimes.md` (MIR) landed last and was read: this plan **adds rows only** to MIR's generic registry
  (`registerIdeology`, `registerRegime`, `registerRoute`, `registerProgram`, `registerAffinity`) and uses its `walkHazards`,
  `ideoShare`, `ideoRegime` and `ideoFamily` (0.2). Its ids follow the registry (`_CONVENTIONS.md`).
- **Depends on:** polities (required), city-states' `Government` log (required: this plan's forms are Government values), MIR
  (required for ideologies; a proxy exists for regimes), tech-tree-innovation and future-tech (required for anything to fire in a
  normal run: see 1.2 — without them the tech frontier stops near the early-modern era and the system stays inert). Optional, each
  with a proxy: riots-uprisings, society, state-finances, court-politics, beliefs-and-deception, grudges-and-oaths, merchant-families,
  disasters-climate, religion (in repo), disease (in repo), language-drift, renaming (in repo), landmarks (in repo), seat-mode,
  experience-whatif-director-sagas. **Build order:** after MIR, tech-tree-innovation and future-tech; after court-politics if it is
  built (it is "built last" in README; this plan is then built after it, and works without it).

---

## 0. Interfaces (one contract for the implementer)

### 0.1 Ids and enum values

The registry in `_CONVENTIONS.md` was read before finishing. court-politics has taken RevoltCause 16, GrievanceKind 13, ReignEnd 10–11,
OrderKind 33–38 and DecisionKind 18–24. MIR, future-tech and tech-tree-innovation are being written in parallel and may take values
too. **Rule for the implementer:** the values below are the next free ones as of the registry read. If a plan earlier in the build
order took one, shift this plan's values up by the same amount. Code reads every value by name, never by number.

| what | values (this plan's) | note |
|---|---|---|
| EventType | **330–339** (9.2) | the block given to this plan |
| RevoltCause | **18 Generations** (and FT's 17 Displaced, reused) | FT took 17; next free 18 |
| GrievanceKind | **15 Drained** | registry (MIR 14 Subversion) |
| ReignEnd | **14 Recalled**, **15 Decommissioned** | registry (MIR 12–13) |
| AccessionHow | **7 Lot**, **8 Appointed**, **9 Delegated**, **10 Instantiated** | AccessionHow ends at 6 Claimed [V contract.ts:862–870]; no other plan claims values here (MIR might: shift) |
| OrderKind | **65 Constitute**, **66 Unplug** (67 reserved) | registry 65–67; TTI's BanIdea is reused for renunciation |
| seat DecisionKind | **50 Mandate**, **51 Exit** (52 reserved) | registry 50–52 |
| Government (city-states' enum) | **12–29** (9.1) | registry: city-states 0–6, MIR 7–11 |
| GovernmentCause | **23–41** (9.1; 42 left free: programs use MIR's Revolution 13) | registry: city-states 0–12, MIR 13–22 |
| PolityOrigin | **9 Exit** | city-states 7 Charter, 8 CityState [city-states.md 3.1] |
| PolityEnd | **6 Dissolved** | PolityEnd ends at 5 Absorbed [V contract.ts:1194–1201] |
| BondKind | **4 Federal**, **5 Ledger** | city-states 3 Charter |
| IdeaKind | uses MIR's **10 Ideology** (registry) | 8–9 TTI, 11–15 FT |
| MovementKind (riots) | none: MIR's **5 Ideology** carries every ideology (anchor = ideology id) | MIR 0.1 |
| RegimeFamily (MIR) | **3 Open, 4 Managed, 5 Exit, 6 Green, 7 Commune, 8 Continuity** | MIR 5.1: "future-politics appends 3+" |
| new enums | `HeadKind`, `Delegation`, `ExitKind`, `FederationKind`, `Mechanism`, `RegimeFamily` | 9.1 |

Asked of the coordinator: add to the registry "future-politics: events 330–339 (331, 336, 338 reserved: their roles are FT's 326 and
329 and TTI's 300), RevoltCause 18, GrievanceKind 15, ReignEnd 14–15, AccessionHow 7–10, OrderKind 65–66, DecisionKind 50–51, Government 12–29 and GovernmentCause 23–41, PolityOrigin 9, PolityEnd 6, BondKind 4–5".

### 0.2 What this plan takes from MIR: rows in its generic registry (`ideology/registry.ts`, MIR 0.2 and 1) — nothing forked

| MIR entry point | how this plan uses it |
|---|---|
| `registerIdeology(def: IdeologyDef)` | the 23 ideologies of 4.2 and 5 (rows 1–11, 13–20 and 21–26; row 12 is FT's) are registered from `futurepol/rows.ts`, imported by MIR's `ideology/catalogue.ts` **after** MIR's own rows (append-only ids; MIR's test checks its ids are unchanged). Each has a doctrine idea of `IdeaKind.Ideology` (10) appended to IDEA_DEFS, `active: (s) => s.fp !== null`, `recept`, `gate`, `birth`, `beta/gamma/martyr`, `via`, `scope`, `demands`, `loyalty` by family (4.1). Adherents live in riots' slots as MIR's `MovementKind.Ideology` (5) rows: no MovementKind of this plan's |
| `registerRegime(def: RegimeDef)` | the 18 forms of 6.1, each with `gov` = its Government value (12–29), `family` (RegimeFamily 3–8), `f0/c0` and ranges (Dahl's franchise and contestation, MIR 1.2), `head`, and `mods` (7.1). MIR's `History.modernRegimes` log records them; city-states' `setForm` writes `G.form` |
| `registerRoute(def: RouteDef)` | routes F1–F23 of 6.2 (with `from` as regime keys, `'traditional'` or `'family:<n>'`) and the delegation pseudo-routes of 6.3 (`apply`). They join **MIR's single walk** (MIR 1.3): one draw per polity per slow step on `'history-ideology'`, whatever the number of routes |
| `registerProgram(key, fn)` | what a capital revolution won by each of this plan's ideologies installs (route R), with MIR's cause Revolution 13 (this plan's `GovernmentCause.Program` is not needed and is dropped) |
| `registerAffinity(a, b, aff)` | the family and ideology affinities of 7.3, into MIR's `AFF` / `IAFF` (blocs, MIR 4.7: relations, alliances, BlocFormed 318) |
| `walkHazards`, `ideoShare(s, p, k)`, `ideoRegime(s, p)`, `ideoFamily(s, p)`, `ideoFranchise`, `ideoContest` | `a_k` in every hazard is `ideoShare`; `from` tests use `ideoRegime`/`ideoFamily`; Open-family forms read `ideoContest` |
| MIR export (4.6) | ideology export and Subversion (GrievanceKind 14) apply to this plan's ideologies unchanged; its `export` mod is set per form in 7.1 |
| `RegimeInputs` (MIR 3.1) | this plan's 3.x inputs are added as fields of MIR's `RegimeInputs` (computed in MIR's input pass when `s.fp` is on), not a second input pass |

Amendment asked of MIR: `IdeologyDef` gains two UI strings, `claim` and `objection` (11.1), shown together; MIR's own rows may fill them
too. Proxy while MIR is not built: none — this plan requires MIR (its walk, movements and log carry everything).

### 0.3 What this plan reads from tech-tree-innovation (TTI) and future-tech (FT) — names as in those plans

All are pure O(1) reads, called once per polity per slow step by `futurepol/inputs.ts`; people-level values are read for the ruling
people `q = ps.pPeople[p]`, polity-level ones for p. Without FT or TTI, the proxy column applies (and on 8cabf09 the frontier stops at
era 4, so nothing fires: 1.2); tests can force every value (13.1).

| quantity here | source (owner plan, section) | meaning | proxy [A] |
|---|---|---|---|
| era τ | TTI `ideaEra(ix, q)` (0.2: the highest era with ≥ half its ideas held) plus the held share of the next era, so τ is continuous | eras 5–7 TTI (science and sail; first industrial age; steel and electricity), 8–14 FT (electrification; computing; the networked present; near future; speculative; far future; fiction) | max era held + 0.5·share of it held |
| key ideas | `ideaIndex(key)`, `ideaHeld`, `ideaIntensity` (TTI 0.2) | gates name FT/TTI idea keys: `digitalState`, `internet`, `narrowAI`, `generalAI`, `superAI`, `stewardAI`, `alignment`, `longArchive`, `pandemicWatch`, `basicIncome`, `welfareState`, `longevity`, `upload`, `hyperloop`, `teleport` (FT 2.2); `jointStock`, `publicDebt`, `statistics`, `telegraph`, `newspaper` (TTI) | absent: gate closed |
| automation A | FT `futAutomation(p)` (effective automation `ae_p`, 2.5.4) | | `0.85·sm(10.5, 12.5, τ)` |
| displaced U | FT `futDisplaced(p)` (`u_p`, 2.5.4) — **not re-derived here** | displaced labour share after FT's relief | 0 |
| relief R | FT relief `1 − Π(1 − r)` of `basicIncome` 0.6 and `welfareState` 0.3 (2.5.4) | the UBI / welfare policy as held ideas | 0 |
| AI capability κ | FT `aiLevel_p` (0–3, 2.5.8) × intensity of the best AI idea: `κ = (aiLevel + a_best)/3` | | 0 |
| AI control χ | FT `futAlign(p)` (`align_p`, 2.5.8: "the control variable") | | 0.5 |
| machine crisis | FT `MachineCrisis` 326, outcome `MachineOutcome` (Contained, Seized, Catastrophe, Steward) | the abstract misalignment events: **FT owns the hazard and the draw**; this plan only modulates the hazard (0.5) and reacts (6.3) | none |
| effective distance δ | FT `1 / futLandStep(p)` and the hub network (2.5.1–2.5.2), `open_p` (the share of trade on air or cheap edges) | | `1 / (1 + 0.5·max(0, τ − 7))` |
| information ι | intensities of `telegraph`, `computer`, `internet`, `digitalState`: `ι = max(0.3·a(telegraph), 0.5·a(computer), 0.8·a(internet), a(digitalState))` | records, communication and computing | `sm(7, 10, τ)` |
| longevity | FT `futLife(p)` (the `life` lever, 2.5.3: ruler death hazard × (1 − 0.5·life)) — reigns already lengthen there | | 0 |
| uploads | FT idea `upload` (tier **Speculative**, era 12) | | absent |
| off-world | FT `History.offWorld` rows and `OffWorldEnded` extra 1 (independence, 2.5.10) | | none |
| warming | FT `anthroT − veil` (2.5.7) and `VeilFailed` 323 | | 0 (only disasters' natural epochs act) |
| fiction | `HistoryOptions.futureFiction` and `IdeaTier.Fiction` (FT 2.1, 2.7) | | false |
| bans | TTI `ban[pol·I + i]`, IdeaBanned 300 / IdeaBanLifted 301, `IdeaResist.Ban` (TTI 4.5) | renunciation of technology is TTI's ban | none |

Era thresholds in this plan are on this scale (TTI + FT). FT's own harness targets put the leading people of ~65% of the 22 seeds in
era 10 and ~45% in era 11 by 6000 years [FT 6, design targets, not measurements].

### 0.4 What this plan reads from other plans and the repo (each guarded by `s.x !== null`)

| plan | read | proxy |
|---|---|---|
| riots-uprisings | `up.L[p]` legitimacy; `up.perc[p]` perceived discontent and `upTrue(s, p)`; `cruelty(r)`; response utilities `uR/uC`; `revoltAt(…)` with a program; RevoltCause by name | L from AccessionHow (their 4.6 L0 table); cruelty 0.3; revolts via the old `revolt()` |
| society | `socElite` ε, `socOverprod` o, `socRent`, `socWage`, `socPhase`, `psi` | inequality from merchant capital concentration (3.4) |
| state-finances | `finNeed`, `finSpend`, `finCredit`, `finSFD`, `fin.rate[p]`, `setRateMul` | city-states' need proxy [city-states.md 4.3]; spend from `s.wealth[cap]` |
| court-politics | `C.regime[p]`, `courtPolicy`, faction strengths, `RegimeChanged` 292 | — (regimes of monarchies are not read) |
| beliefs-and-deception | `bel.spy/counter`, precision channels | — |
| grudges-and-oaths | `recordGrievance`, grievance half-life constant, oath machinery, `standingGrudges` | rivalry `relR` |
| merchant-families | `topFamilies`, `familyCapitalAt`, family wealth share | top merchant pool `mw` share |
| disasters-climate | `disasterShockAt(s, id)`, `ClimateSeries`, `ClimateTurned` 268 | riots' disaster proxy (Famine, CityStricken in 10 y) |
| disease (repo) | GreatEpidemic 67, EpidemicEnded 68 extra (share died), `Quarantine` 70 | — |
| religion (repo) | `rel.state[p]`, `rel.zeal`, `polityFaith`, Schism 92 | — |
| language-drift, renaming, landmarks | change-rate multipliers (6.8 ArchiveRegency) | — |
| ideas (repo) | `ix.held`, IdeaCtx, IdeaLost [V ideas/system.ts] | — |

### 0.5 Amendments asked of other plans (each null-guarded, skipped — not ×1 — when this plan is off)

- **MIR:** `claim`/`objection` on `IdeologyDef` (0.2); `RegimeInputs` fields for this plan's inputs (3); RegimeFamily values 3–8.
- **ideas (repo):** `IdeaCtx` gains `fp*` fields (4.1) filled by one guarded call `fpIdeaCtx(s, c)` in the context builder.
- **tech-tree-innovation (bans, 4.5):** the ban chance `b` gets `× (1 + fpBanPush(s, pol, i))` (neo-Luddite and bioconservative
  adherents, 6.6); its "held idea ban" clause (today War/Seafaring after a long peace) also covers held Industry, Computing and Life
  ideas with chance `0.05·max(0, a − 0.2)` per step when `fpBanPush > 0`. Same stream (`'history-innovation'`), same events (300/301).
- **future-tech:** (a) the MachineCrisis hazard for people q `× fpCrisisMul(s, q) = 0.5 + 0.5·(share of q's people under polities with
  Delegation ≥ Administering)` (handing administration to systems raises exposure; 6.3); (b) relief `r` composes with
  `fpReliefMul(s, p)` (the regime's appetite for a dividend, 7.1 key `relief`); (c) off-world independence also fires when the
  `orbitalIndependence` adherents at the launch site are ≥ 0.3 (`fpIndepPush`), not only when the parent is in crisis (6.5).
- **city-states:** `GOV` arrays get columns for Government 12–29 (7.1), and `setForm` accepts them. The Charter branch is exported as
  `govCharterSell(s, ps, town, host, buyer)` (6.5: exit polities buy charters).
- **riots-uprisings:** response utilities read `fpRepress(s, p)` and `fpConcede(s, p)` (7.2); perception reads `fpSurvPrecision(s, p)`
  (6.4); MIR's program map includes this plan's ideologies.
- **state-finances:** `setRateMul` composition gains `fpRate(s, p)` (like court's `setCourtRateMul`).
- **grudges-and-oaths:** `grudgeHalfLifeMul(s, p)` (ArchiveRegency, AncestorCouncil); `GrievanceKind.Drained`; the Ledger bond's
  automatic enforcement (6.7) calls `oathEnforce(s, bond)`.
- **rulers (repo):** `systemHead(s, ps, R, p, kind)` (a Ruler row whose head is not a person, 9.3). Longer reigns come from FT's
  `life` lever, not from this plan.
- **language-drift / renaming / landmarks:** read `fpArchive(s, p)` multipliers (6.8).
- **experience-whatif-director-sagas:** `Pov.kind` gains `'movement'` (11.4).

---

## 1. Current behaviour

### 1.1 What exists [V]
- **Technology** is four fields per people (`TechField` Farming, Seafaring, Metalworking, Crafts; contract.ts:1573) with levels that
  follow the caps of the ideas held (technology.ts header).
- **Ideas** are a fixed catalogue of 45 rows in eras 0–4, from pottery to "the experimental method" [V ideas/params.ts IDEA_DEFS]. The
  file header says the sim's clock runs "from the first villages (year 0) to about the industrial threshold (year 2000)". There is no
  idea after era 4.
- **Government** today is implicit: every polity is a monarchy-like state, or a League (`PolityOrigin.League`). city-states adds the
  `Government` log; court-politics a `Regime` log for monarchy-like polities; MIR modern regimes (Government 7–11) and the generic registry.
- **Ideologies and movements** do not exist in the repo; riots-uprisings adds five movement kinds (Reform, Commune, Separatist,
  Millenarian, Legitimist) with SIS spread [riots-uprisings.md 4.8].
- **Information and surveillance:** a ruler sees discontent only through riots' perceived participation `perc_p` (preference
  falsification) [riots 4.7]; beliefs-and-deception models foreign beliefs with precision channels [beliefs 3.2].
- **Distance** enters everywhere through `grip(d, reach)` [V polity/state.ts projAt] and trade's transport costs (Crafts).
- The sim uses only `+ − × / sqrt`, no `exp`, `pow` or trigonometry, for bit identity across engines [grudges-and-oaths.md 1, V].

### 1.2 Baseline at 6000 years [M] (`fpProbe.ts`, default options, 8cabf09)

| seed | year | polities alive | tiers (chiefdom/kingdom/empire) | cities ≥ 10k | world pop | largest polity share | tech median / max (mean of 4 fields) | revolts / wars / civil wars / secessions in the 500 y before |
|---|---|---|---|---|---|---|---|---|
| 42 | 2000 | 23 | 11 / 8 / 4 | 11 | 600 k | 0.24 | 4.01 / 4.25 | 296 / 57 / 13 / 24 |
| 42 | 4000 | 21 | 7 / 8 / 6 | 24 | 1.24 M | 0.22 | 4.80 / 5.05 | 272 / 55 / 6 / 16 |
| 42 | 6000 | 17 | 3 / 8 / 6 | 26 | 1.40 M | 0.22 | 5.05 / 5.25 | 307 / 82 / 14 / 14 |
| 1 | 2000 | 30 | 12 / 16 / 2 | 3 | 419 k | 0.18 | 3.54 / 3.60 | 199 / 50 / 7 / 19 |
| 1 | 4000 | 20 | 5 / 9 / 6 | 23 | 1.23 M | 0.13 | 4.86 / 4.87 | 177 / 51 / 7 / 14 |
| 1 | 6000 | 25 | 11 / 9 / 5 | 28 | 1.36 M | 0.16 | 5.12 / 5.13 | 178 / 69 / 3 / 28 |
| 7 | 2000 | 22 | 6 / 11 / 5 | 10 | 690 k | 0.11 | 3.70 / 4.12 | 242 / 50 / 12 / 32 |
| 7 | 4000 | 30 | 14 / 10 / 6 | 30 | 1.69 M | 0.18 | 4.85 / 5.04 | 329 / 141 / 13 / 42 |
| 7 | 6000 | 28 | 11 / 12 / 5 | 33 | 1.78 M | 0.21 | 5.14 / 5.26 | 295 / 95 / 2 / 23 |
| 1234 | 2000 | 27 | 6 / 15 / 6 | 17 | 890 k | 0.13 | 4.18 / 4.46 | 427 / 69 / 8 / 31 |
| 1234 | 4000 | 24 | 6 / 11 / 7 | 24 | 1.31 M | 0.14 | 4.86 / 5.02 | 375 / 131 / 8 / 33 |
| 1234 | 6000 | 18 | 1 / 9 / 8 | 25 | 1.50 M | 0.11 | 5.09 / 5.21 | 364 / 87 / 9 / 40 |

(Runtime for 6000 years on a loaded 2-core box: 116 s (42), 170 s (1), 206 s (7), 183 s (1234). The tiers column omits the
stateless bucket, which was 0 in every row.) What this says for the design:
1. **On 8cabf09 the world plateaus.** Technology grows only ~25% from year 2000 to 6000 and no idea exists past era 4, so no future
   regime could ever fire. This plan is **inert without TTI and FT**; its tests force the inputs (13.1).
2. **Worlds stay small and plural**: 17–28 polities and 1.4–1.8 M people at 6000, 25–33 cities. Gates must be scaled to these numbers
   (a "metropolis" is ≥ 10 k; a world federation is a handful of states), and diversity across seeds is achievable because many
   polities coexist.
3. **Revolt and secession rates stay high late** (≈ 180–360 revolts per 500 y at 6000), so the riots machinery has material for revolutions
   with programs, and secession routes (exit, orbital) compete with an already busy process.

---

## 2. Sources and models (how each is used)

Descriptive sources for the proposals are in 4 and 5. The models that set formulas:
1. **Size of states** (Alesina & Spolaore 1997 [verified]): the number and size of nations trade economies of scale in public goods
   against the cost of heterogeneous preferences, and greater economic integration lowers the benefit of size, so openness favours
   more and smaller states. Used for federation and exit hazards (6.5, 6.7): connectivity raises the value of exit and lowers the
   value of size; external threat raises it.
2. **Automation and new tasks** (Acemoglu & Restrepo 2019 [verified]): automation displaces labour from tasks while new tasks
   reinstate it; the net effect depends on the balance. Robots and Jobs (Acemoglu & Restrepo 2020 [verified]) estimates negative local
   employment effects of industrial robots. Used for displacement U (3.2): it depends on the **speed** of automation against a
   reinstatement rate, not on the level. The share of jobs "at risk" is **[D]**: Frey & Osborne 2017 [verified] put 47% of US
   employment at high risk; Arntz, Gregory & Zierahn 2016 [verified], with a task-based method, about 9% across OECD countries. The
   plan uses neither number as a constant; the reinstatement share `FP.reinstate` is a design default.
3. **Preference falsification** (Kuran 1991 [verified]): private opposition hidden by fear surfaces suddenly. Already the basis of
   riots' perception [riots 3.2]; here surveillance raises the regime's precision (6.4), which changes when, not whether, the
   hidden discontent exists.
4. **Digital repression** (Feldstein 2021 [verified]) and **AI and autocracy** (Beraja, Kao, Yang & Yuchtman 2023 [verified]: in
   China, local unrest led to more public-security purchases of facial-recognition AI, which then reduced unrest, and the firms supplying
   it produced more commercial software). Used for the surveillance loop (6.4) and for **not** assuming surveillance states innovate
   less (the effect on innovation is left neutral, `learn` 1.0 for ScoredState, 7.1) **[D]**.
5. **Regulatory capture** (Stigler 1971 [verified]): regulation tends to be acquired by the industry and designed for its benefit. Used
   for the capture failures of Technocracy, AlgorithmicState, Futarchy, CharterCity (8).
6. **Output legitimacy** (Scharpf 1999 [verified], as summarised in the working papers found): legitimacy from effective results
   ("government for the people") as distinct from input legitimacy ("by the people"). Used for performance-tied legitimacy targets of
   expert and system regimes (7.1 `lPerf`).
7. **Race dynamics** (Armstrong, Bostrom & Shulman 2016 [verified]): competing developers who value winning skimp on safety, more so
   with more competitors and more enmity. FT already models this in its alignment race term (FT 2.5.8); this plan reuses it (6.3).
8. **Knowledge problem** (Hayek 1945 [verified]) and **computational planning** (Cockshott & Cottrell 1993 [verified]): central
   allocation lacks dispersed local knowledge, versus the claim that computing makes planning feasible. Used as the AutomatedCommune's
   dependence on κ and ι (6.2, 8) **[D]**.
9. **Commons governance** (Ostrom 1990 [verified]): long-enduring commons share design principles (clear boundaries, monitoring,
   graduated sanctions, local rule-making). Used for TransitCommons' size limit and failure (5.2).
10. **Generational turnover of ideas** (Azoulay, Fons-Rosen & Graff Zivin 2019 [verified]): after the premature death of star
   scientists, newcomers' contributions to their fields rise. Used, as an analogy only, for Gerontarchy's lower idea conception (5.3).
11. **Goodhart's law** (Strathern 1997 [verified]: "when a measure becomes a target, it ceases to be a good measure"). Used for
   Futarchy's metric-gaming failure and ScoredState's score drift (8).
12. **State of exception** (Agamben 2005 [verified]): emergency powers becoming the normal technique of government. Used for the
    Emergency and Cordon "emergency outlives the crisis" failure (8), as a cited claim, not a law.
13. **Climate and conflict** (Hsiang, Burke & Miguel 2013 [verified], meta-analysis finding that warmer temperatures and extreme
    rainfall raise conflict risk) is **[D]**: Buhaug et al. 2014 [verified] dispute the consensus. The plan's climate stress term (3.6)
    raises emergency-regime and unrest hazards with a design-default weight and says so.
14. **Inequality and regimes** (Acemoglu & Robinson 2006 [verified]): democratisation and coups as a contest between elites and
    citizens, with inequality shaping both. Used qualitatively in the routes' inequality terms (6.2).
15. **Death of distance** (Cairncross 1997 [verified]): communications making distance matter less. Used as the concept behind δ and the
    TransitCommons (5.2); the economic magnitude is FT's.

Arithmetic rule: smoothstep `sm(a, b, x)`, saturations `x/(x+h)`, per-step literal decay factors; no `exp/pow/log`.

---

## 3. Inputs: the sim quantities that drive everything (`futurepol/inputs.ts`, every POLITY.slowStep = 10 y [V polity/params.ts:13])

Computed per living polity p in `ps.alive` order at the top of `fpSlow`, stored as `Float32Array` in `FP` state, pure (no draws).
`q = ps.pPeople[p]`; "members" are p's settlements; pop-weights use `s.pop`.

### 3.1 Technology (all read from TTI/FT, 0.3; nothing re-derived)
- `τ_p` = the era of q (0.3), and `τPeak_p = max(τPeak_p, τ_p)` (for regression, 6.9).
- `A_p = futAutomation(p)`, `U_p = futDisplaced(p)`, `R_p` = FT's relief, `κ_p`, `χ_p = futAlign(p)`, `ι_p`, `δ_p` (0.3). TTI bans
  in force in p (IdeaResist.Ban) already zero the intensity of the banned ideas, so κ, A and ι fall with no extra term here.

### 3.2 Displacement, relief and the dividend (FT's model, modulated by regime)
FT computes the displaced share after the task model of Acemoglu & Restrepo (FT 2.5.4: `u_p ← u_p·(1 − 1/retrain) + disp·(1 −
relief_p)`), logs `Displacement` (329) and gives riots `RevoltCause.Displaced` (17). Displacement there depends on the **speed** of
automation against new tasks (Acemoglu & Restrepo 2019 [verified]). This plan adds only the regime's appetite for relief:
`relief_p = 1 − (1 − r_ideas)·(1 − GOV.relief[form]·U_p/(U_p + 0.1))` through `fpReliefMul` (amendment 0.5 (b)), so a regime that
wants a dividend pays one sooner, and AutomatedCommune (`relief` 1) meets needs in kind. FT already books the cost through `finSpend`.
The UBI ideas themselves (`basicIncome`, `welfareState`) are FT's rows; this plan adds no dividend ideology of its own.

### 3.3 Connectivity K
`K_p = 0.5·open_p + 0.3·(1 − δ_p) + 0.2·sm(0, 0.8, met_q / max(1, P − 1))`, with FT's `open_p` and `met_q` the peoples q has met
[V knowledge.ts inContact]. **Alesina–Spolaore enters once**: FT already multiplies city-states' charter and secession pressure by
`(1 + FUT.asK·open_p)` (FT 2.5.2); this plan's exit (6.5) goes through that charter machinery and adds no second openness term.

### 3.4 Inequality I
```
with society:  I = clamp(0.2 + 0.3·sm(0.6, 2, o_p) + 0.2·sm(0.8, 2, rent_p) + 0.3·sm(0.05, 0.2, ε_p), 0, 1)
without:       I = clamp(0.2 + 0.4·topShare_p + 0.3·A_p·(1 − R_p), 0, 1)
               topShare = Σ mw of the top 10% members by mw / Σ mw  (goods' merchant pool [V goods/merchants.ts])
```
With society on, FT already sends the capital share of automation to elite income ε (FT 2.5.4), so I reads ε and o and adds no
automation term of its own.

### 3.5 Legitimacy L and crisis Lc
`L_p = up.L[p]` (riots) or the proxy. `Lc_p = max(lostWar20, phaseCrisis, revolution20, default20, sacked20, crisis30)` where each
term is 1 if the event happened at p within the window (years in the name), society's phase Crisis counts 1, and an FT
`MachineCrisis` (326) with outcome Seized or Catastrophe touching p counts 1 for 30 years (6.3). Kept by the yearly event scan `fpYear` (no draws).

### 3.6 Climate and disaster stress Z
```
Zshock = max over members of disasterShockAt(s, id), pop-weighted (riots' proxy without disasters)
Zclim  = sm(0.3, 1.5, |decadal anomaly of p's regions|)        disasters' ClimateSeries; 0 without disasters
Zwarm  = sm(0.5, 3, anthroT − veil) + 0.5·[VeilFailed within 10 y]   FT 2.5.7; 0 without
Z_p    = max(Zshock, Zclim, Zwarm);  Zc_p ← 0.9·Zc_p + 0.1·Z_p  (chronic, ~100-year memory)
```
The weight of Z in hazards is a design default; the empirical size of climate's effect on conflict is contested (2.13).

### 3.7 Surveillance capacity S (a stock)
```
Scap   = ι_p · (0.4 + 0.6·min(1, pReach_p / FP.reachRef))       (pReach already includes FT's futReach)
want   = GOV.surveil[form] · (0.5 + cr_p) · (1 + 0.5·Lc_p) · (1 + 0.5·[CordonState or Emergency])
S_p   ← S_p + 0.2·(Scap·min(1, want) − S_p)                     ~50-year approach; falls when not wanted or when ι falls
```
`cr_p` = riots' cruelty of the current ruler (proxy 0.3); system heads use 0.3 (9.3).

### 3.8 Other inputs
- `life_p = futLife(p)` (FT's `life` lever, 0..~0.5); `eliteLife_p = life_p · (0.5 + 0.5·I_p)/(0.5 + 0.5·Ī)` while access is
  unequal (`transhumanism`'s "longevity for all" demand not policy), else `life_p`.
- `ep_p` = years since the last GreatEpidemic that reached p's people, and its death share (EpidemicEnded extra) [V contract.ts:146].
- `rec_p` = **the chronicle length** of p's lineage: notable events (wars, reigns, foundings, landmarks, faiths) whose settlement is a
  member, counted in `fpYear`, inherited by successors at founding (`rec_child = rec_parent`). It is the training record of the
  ArchiveRegency (5.1).
- `age_p` (years since founding, plus the parent chain's age for successors that kept the name).
- `fam_p` = the top merchant family's share of p's merchant capital (merchant-families; proxy the top town's mw share).
- `threat_p` = max over border relations of rivalry `relR` (or grudges' θ).

All inputs are snapshotted per slow step (9.4) for the UI and the harness.

---

## 4. Ideologies as ideas: real proposals and existing thought

### 4.1 What a row is (MIR's `IdeologyDef`, registered; MIR 1.1)
Each ideology is two things, both MIR's machinery: a **doctrine** (an `IDEA_DEFS` row of `kind: IdeaKind.Ideology` (10), appended after
MIR's doctrines, conceived per people and carried by the ideas system's channels) and an **`IdeologyDef`** registered with
`registerIdeology` (movement rows of `MovementKind.Ideology`, spread by riots' SIS). The table columns of 4.2 map onto the def:
- "carriers `recept(i)`" → `recept` (and `carriers` bits for the UI); "era0 · cond" → the doctrine's `cond`; the birth gate `gate` is
  `recept ≥ 0.2` at a town of a people holding the doctrine; `birth` 0.01 per slow step (MIR's default) [A].
- "demand" → `demands` bits and the `registerProgram` function (route R), or a policy/bond this plan applies (6.4–6.7).
- `loyalty[family]`: +1 toward its own family, −0.6 toward the families with `aff ≤ −0.4` in 7.3, else 0 [A].
- `tier`: FT's IdeaTier of the technology it needs; a doctrine whose gate names a Fiction idea is absent without `futureFiction`.
- `claim`, `objection`: one neutral sentence each (11.1; amendment to MIR, 0.2).
- `active(s) = s.fp !== null`: with this plan off, the rows are registered (MIR ids stable) but draw nothing and are invisible.

`cond` (conception, people level) reads new `IdeaCtx` fields filled by `fpIdeaCtx` (the pop-weighted means of 3's inputs over the
people's polities): `fpEra, fpAuto, fpUnemp, fpIneq, fpConn, fpSurv, fpAi, fpCtl, fpClim, fpLegit, fpCrisis, fpLife, fpEpid, fpRec,
fpTier`. Spread, resistance (`R_FAITH | R_RULER | R_GUILD`), theft and loss are the ideas system's, unchanged. Adherents then spread
inside and across polities by riots' SIS with `recept` as `Rk_i`. Conception needs the frontier: every row's `cond` is multiplied by
`sm(era0, era0 + 1, fpEra)` with its own `era0`.

`teach` is short (15–40 years: ideologies travel by print and wire, not by apprenticeship) and `fragile` is moderate (0.2–0.4: an
ideology a people stops hearing about is forgotten). Values are design defaults [A].

### 4.2 The rows (real thought, described neutrally)

`sm` = smoothstep; `N` the settlement's population; `town` = `[N ≥ TOWN_POPULATION]`; `city` = `[N ≥ CITY_POPULATION]`; `rich_i` =
`sm(0.3, 1.5, mw_i / N)`; `port_i` port flag; `κ, U, I, S, Z, K, Lc` the polity inputs of 3.

| # | key / name | existing thought (cite) | era0 · cond (people) | carriers `recept(i)` | demand | what goes wrong (8) |
|---|---|---|---|---|---|---|
| 1 | `technocratism` / rule by experts | the 1930s North American Technocracy movement proposed government by engineers and scientists, with an energy-accounting economy (Technocracy movement [verified: encyclopedia page]); output legitimacy (Scharpf 1999 [verified]) | 7 · `sm(0.3, 0.7, fpCrisis)·sm(0.4, 0.8, Knowledge ideas share)` | `city·(0.5 + 0.5·ι)`: officials, engineers, universities | Technocracy | capture by the expert class; legitimacy falls when results do |
| 2 | `cyberocracy` / governance by algorithm | Chile's Project Cybersyn, 1971–73, a cybernetic network for managing the economy (Medina 2011 [verified]); the "threat of algocracy": decisions structured by algorithms that citizens cannot follow (Danaher 2016 [verified]); Albania named an AI-generated virtual "minister", Diella, for public procurement in September 2025 (Semafor 2025 [verified]) | 11 · `sm(0.4, 0.8, fpAi)·(0.5 + 0.5·fpCtl)` | `city·κ·(0.6 + 0.4·ι)` | AI levels (6.3); AlgorithmicState | opacity lowers input legitimacy; incidents (abstract); capture by operators |
| 3 | `delegativism` / liquid and digital direct democracy | delegative ("liquid") democracy: vote directly or delegate one's vote transitively (Ford 2002 [verified]; Blum & Zuber 2016 [verified]); in the German Pirate Party's LiquidFeedback, a few "super-voters" held large delegated weight (Kling et al. 2015 [verified]) | 9.5 · `sm(0.4, 0.8, fpConn)·sm(0.3, 0.6, literacy)` | `town·K·(0.4 + 0.6·[Pluralist family])` | LiquidDemocracy | delegation concentrates in a few: a demagogue's signoria |
| 4 | `futarchism` / vote on values, bet on beliefs | futarchy: citizens vote on a welfare measure, and decision markets choose the policies expected to raise it (Hanson 2013 [verified]); a manipulator can, in experiments, fail to distort and even aid market accuracy (Hanson & Oprea 2009 [verified]) **[D]** | 10 · `[banking held]·sm(0.4, 0.9, trade per head)·fpConn` | `rich_i·city` (financiers, traders) | Futarchy | thin markets and wealth concentration: capture; metric gaming (Goodhart) |
| 5 | `quadraticVoting` / quadratic voting (a mechanism, not a regime) | voters buy votes at a cost quadratic in their number, so intensity of preference counts (Lalley & Weyl 2018 [verified]) | 9.5 · `sm(0.4, 0.8, fpConn)` | `town·K` | an institution of Open-family regimes (7.1 key `qv`): minority grievance (religious, ethnic terms) × 0.8 | collusion and false identities: capture hazard +0.2 where `fam_p ≥ 0.4` |
| 6 | `sortition` / government by lot | citizens' assemblies chosen by lot; Ireland's 2016–18 Citizens' Assembly fed referendums including on abortion (Farrell, Suiter & Harris 2019 [verified]); "open democracy" with lot-chosen bodies (Landemore 2020 [verified]) | 9 · `sm(0.3, 0.7, fpCrisis)·sm(0.4, 0.8, fpIneq)` | `town·(0.3 + 0.7·Lc)` | Lottocracy | agenda set by officials and experts: drift to Technocracy; "who chose them" when results fail |
| 7 | `exitism` / exit-based sovereignty: charter cities and seasteads | charter cities: new cities under special charters, e.g. Honduras' ZEDE zones and Próspera (charter city [verified: encyclopedia page]; Bloomberg Law 2024 on Próspera's dispute with Honduras [verified]); seasteading, floating states at sea (Quirk & Friedman 2017 [verified]) | 9 · `sm(0.3, 0.7, trade per head)·fpConn·sm(0.3, 0.7, fpIneq)` | `rich_i·port_i·(1 − L_p)` | ExitFounded (6.5): CharterCity, seastead | host revokes; operator capture → CompanyState; residents demand votes → Republic |
| 8 | `networkState` / the network state | an online community that crowdfunds territory and seeks diplomatic recognition (Srinivasan 2022 [verified]) | 10 · `sm(0.6, 0.9, fpConn)·sm(0.4, 0.8, fpIneq)` | `rich_i·K`, in any polity | ExitFounded: NetworkState | dispersal when adherents fade; hosts expel enclaves; it "lands" as an ordinary state |
| 9 | `companyRule` / corporate sovereignty | the company-state: the English East India Company as a sovereign political body (Stern 2011 [verified]) | 6 · `sm(0.5, 0.9, families' share of capital)·[trading posts held]` | `rich_i·port_i` | capture route → CompanyState (6.2) | bankruptcy; the host crown takes it over |
| 10 | `scoredOrder` / the scored society | social-credit systems: the Chinese system is in practice a fragmented set of blacklists and ratings rather than one score (Creemers 2018 [verified]); digital repression (Feldstein 2021 [verified]) | 10 · `sm(0.4, 0.8, fpSurv)·sm(0.3, 0.7, fpCrisis)` | `city·S`, and the officials: `ruler cruelty` raises adoption by the court (`R_RULER` never resists it) | ScoredState | precision without consent: hidden discontent; a cascade when capacity falters (Kuran) |
| 11 | `automatedCommunism` / fully automated abundance shared in common | a post-work, post-scarcity economy built on automation (Bastani 2019 [verified]); the planning debate (Hayek 1945 [verified]; Cockshott & Cottrell 1993 [verified]) **[D]** | 11 · `sm(0.6, 0.9, fpAuto)·sm(0.2, 0.5, fpUnemp)` | `town·(U + 0.5·I)` | AutomatedCommune | allocation errors when κ or ι fall; outside threat brings planners' rule |
| 12 | universal basic income — **no new row**: FT's `basicIncome` and `welfareState` ideas (FT 2.2, 2.5.4) are reused | an unconditional income for every citizen (Van Parijs & Vanderborght 2017 [verified]); the Alaska Permanent Fund pays residents a yearly dividend from oil revenue (Alaska Permanent Fund [verified: encyclopedia page]) | FT's | — | relief, modulated by regime (3.2, 7.1 `relief`) | fiscal strain when automation rents fall (regression, 6.9) |
| 13 | `degrowth` / planned contraction of throughput | degrowth research (Kallis et al. 2018 [verified]) | 9.5 · `sm(0.3, 0.7, fpClim)` | `town·Zc·(0.5 + 0.5·ι)` | EcoCommonwealth | outcompeted by growing neighbours; wage-fall revolts |
| 14 | `climateEmergency` / emergency rule for the climate | "Climate Leviathan": planetary sovereignty emerging from climate crisis, among four possible futures (Wainwright & Mann 2018 [verified]) | 9 · `sm(0.4, 0.8, fpClim)` | all members `·Z` | EmergencyDirectorate | the emergency outlives the crisis (Agamben 2005 [verified]) |
| 15 | `transhumanism` / human enhancement | the history and claims of transhumanism (Bostrom 2005 [verified]) | 10.5 · `sm(0.05, 0.3, fpLife)` | `city·rich_i` | longevity for all (Λ policy), personhood for uploads (Fiction) | elite-only access: Gerontarchy (5.3) |
| 16 | `bioconservatism` / limits on enhancement | the case for regulating biotechnology to protect human nature (Fukuyama 2002 [verified]) | 10.5 · `sm(0.05, 0.3, fpLife) + sm(0.5, 1, machine crises seen)` | `town·(1 − rich_i)`, faith co-members (`R_FAITH` holders recept +0.3) | TTI bans (6.6) of Life ideas (`longevity`, `upload`) | regression; enhanced neighbours outgrow it |
| 17 | `neoLuddism` / refusing technology that harms the community | "Notes toward a Neo-Luddite manifesto" (Glendinning 1990 [verified]) | 10 · `sm(0.1, 0.3, fpUnemp) + 0.5·sm(0.5, 1, machine crises seen)` | `town·U·(1 − rich_i)` | TTI bans (6.6) of Industry and Computing ideas; revolts with FT's RevoltCause.Displaced | regression and lost wars against unbanned rivals |
| 18 | `digitalPersonhood` / rights for artificial minds | a philosophical defence of AI rights (Schwitzgebel & Garza 2015 [verified]); the European Parliament's 2017 resolution asked the Commission to consider an "electronic persons" status for sophisticated robots (European Parliament 2017 [verified]) | 11.5 · `sm(0.8, 1.2, fpAi)` | `city·κ` | PersonhoodRecognised (339) | backlash: bioconservative and Luddite births ×2 for 50 y |
| 19 | `orbitalIndependence` / self-rule for space settlements | space colonies as the next frontier (O'Neill 1974 [verified]); the critique that space expansion raises catastrophic risks (Deudney 2020 [verified]) | 11.5 · `[an active FT off-world row of the people]` | the launch site and its region | independence of off-world rows (FT 2.5.10, pushed by 6.5) | blockade and dependence; reconquest |
| 20 | `worldFederalism` / federation up to world government | a federation of free states as the condition of perpetual peace, distinct from a universal monarchy (Kant 1795 [verified]); the argument that a world state is inevitable (Wendt 2003 [verified]); size trade-offs (Alesina & Spolaore 1997 [verified]) | 9 · `fpConn·sm(0.3, 0.8, world war losses + fpClim + AI race)` | `city·K` | Federal bonds (6.7) | withdrawal over heterogeneity; capture by the largest member |

Rows 1–20 are real proposals or movements. The sim never asserts that any of them works; it simulates claimed mechanisms with
stated trade-offs, and the outcomes are whatever the world produces (11.1).

---

## 5. New forms this sim's worlds would plausibly produce (invented)

Each is an ideology row (4.1, numbers 21–26, `claim/objection` filled) and a Government value. They exist because of mechanics the
sim already has: a written chronicle of every event (History.events), grudges with half-lives, merchant lanes and marts, dynasties,
diseases and quarantine, faiths with holy cities and schisms. Each is gated by the FT tier of the ideas it needs: a form that needs a Fiction idea exists only with `futureFiction`.

### 5.1 ArchiveRegency: the state governed by an archive trained on its own chronicle (Plausible)
- **Idea.** A realm with a long continuous record entrusts its machine administrator with that record as precedent: what the realm
  did, it does again, unless the archive finds a better precedent.
- **Preconditions** (route F13, 6.2): FT's `longArchive` held (Near tier), `κ ≥ 0.5`, `rec_p ≥ FP.recMin (400 notable events)`, `age_p ≥ 500`, `Lc_p ≥ 0.3` (a crisis
  makes people turn to the old record), ideology `archivism` share ≥ 0.15.
- **Carriers.** `recept = town·(0.4·[member hosts a Great landmark of the realm] + 0.3·Knowledge share + 0.3·[old capital])`: scholars,
  clergy, old capitals.
- **Spread.** Inside the lineage first (successor states of the same name carry the record: their `rec` is inherited), then to
  polities that share the realm's faith (faith co-members, riots' channel).
- **Demands.** Rule by precedent: the system head is "the Archive of {realm}" (HeadKind.System, 9.3).
- **Behaviour (6.8 hooks).** Grudges decay at `grudgeHalfLifeMul = 3` (the record forgets nothing); wars are declared preferentially on
  polities of lineages it fought and beat (`war(q) ×= 1 + 0.5·wins_vs_lineage(q)/(1 + losses)`); alliances follow old alliances;
  language-drift change rate × 0.5 for its people (the archive's tongue is the court's); renaming prefers `RenameCause.Restored`
  (old names come back) and landmarks of the realm are restored at × 2 the base chance. Idea conception × 0.7 (precedent is a
  conservative teacher).
- **What goes wrong.** (a) **Revanchism**: precedent repeats wars that the realm can no longer win (lost wars feed `Lc`); (b) **the
  record is edited**: a faction rewrites the archive (beliefs' forgery machinery if present): hazard `0.03·(1 − L)·factionHeat`, on
  exposure L −0.3 and route back to the previous form; (c) **it cannot imagine**: falling behind in τ against rivals (gap ≥ 1 era)
  raises the sunset hazard.

### 5.2 TransitCommons: sovereignty over the ways when distance collapses (Plausible)
- **Idea.** When travel costs fall to a small fraction (δ ≤ 0.25), the marts and hubs that run the network matter more than the land
  between them. A compact of hubs governs the lanes as a commons; members keep their land states for everything else.
- **Preconditions** (F14): FT's land divisor `futLandStep ≥ 4` or hub edges (FT 2.5.2) between the hubs' peoples, ≥ 3 marts joined by long-haul lanes (goods' `longHaul` legs [V
  contract.ts DirectRoute]), ideology `transitCommons` share ≥ 0.2 among them.
- **Carriers.** `recept = [mart]·port·(0.5 + 0.5·relay income share)`: lane operators, merchant houses, relay towns (Bypassed events
  make relay towns its strongest base).
- **Spread.** Along lanes (riots' route channel), not across borders by land.
- **Demands.** A League-like polity whose members are hubs that defect into it (`Defected` events, reused), tariffs 0 on its lanes,
  danger suppression on its lanes.
- **Behaviour.** War appetite 0.3; trade urge 2; embargo power: denying transit to a polity at war with a member is the commons'
  weapon (`embargo` 1.5, 7.1); reach 0.5 over land (it holds hubs, not provinces).
- **What goes wrong** (Ostrom 1990): (a) **too big to govern**: above `FP.commonsMax` (8) members, a free-rider hazard `0.05·(n − 8)`
  per step splits it (`Partitioned` reused); (b) **a hub hoards**: the richest hub charges tolls and secedes as a CharterCity or
  CompanyState; (c) **land states nationalise** their hubs (war; Conquered reused).
- **Fiction variant.** With `futureFiction` and FT's gate hubs (`teleport`, HUB_GATE), a commons can span every gate hub of the world
  (variant flag `gate`, same Government value): the one Fiction-gated variant in this plan.

### 5.3 Gerontarchy: the longevity gerontocracy (Plausible)
- **Idea.** Life-extension reaches the elite first. Office-holders who no longer die keep their offices; the realm is ruled by the
  very old for very long.
- **Preconditions** (F15): `eliteLife ≥ 0.15` (FT's `longevity` row gives `life` 0.3 at full intensity), `I ≥ 0.45`, and `transhumanism`'s "longevity for all" is not policy.
- **Carriers.** The elite: `recept = rich_i·city`; resisted by `transhumanism`'s egalitarian wing and by the young (Generations).
- **Behaviour.** Reigns are already longer through FT's `life` lever (ruler death hazard × (1 − 0.5·life)); this plan adds the
  politics: society's elite overproduction rises because offices do not turn over (`o_p ×= 1 + 2·eliteLife`, a society input);
  war appetite 0.7; idea conception × `1 − 1.2·eliteLife` (an
  analogy to Azoulay et al. 2019, not their estimate); succession contests fall (`contest −0.05`).
- **What goes wrong.** (a) **The revolt of the young**: RevoltCause.Generations grievance `= 0.4·sm(0.1, 0.4, eliteLife)·(1 − share of
  offices held by under-50s)`; a riots revolution with the `transhumanism` (for-all) program ends it; (b) **longevity spreads to
  all** (the idea's adoption by the whole people): the regime loses its basis, sunset hazard 0.3.

### 5.4 CordonState: rule by biosecurity (Real)
- **Idea.** After a great epidemic, a people with surveillance and public-health ideas organises the state around keeping the next
  one out.
- **Preconditions** (F16): a GreatEpidemic killed ≥ 5% of p's people within 20 years, the `quarantine` idea held [V ideas/params.ts
  quarantine] (FT's `pandemicWatch` doubles the hazard), `S ≥ 0.4`, ideology `cordon` share ≥ 0.1.
- **Carriers.** Ports and cities struck: `recept = (port + city)·[CityStricken within 30 y]`.
- **Behaviour.** All member ports hold ships in quarantine (disease's `Quarantine`, reused); inbound migration × 0.3 (migration
  hook); trade × 0.8; surveillance want 1.5; epidemics entering its ports × 0.4 (disease amendment: the quarantine factor already
  exists for quarantined ports).
- **What goes wrong.** **The emergency outlives the plague** (Agamben 2005): legitimacy target falls `−0.005·years since epidemic`;
  sunset hazard `0.1·sm(30, 80, years)`; if `S ≥ 0.7` and the ruler is cruel, the route goes to ScoredState instead.

### 5.5 OracleSee: a faith that consults a machine oracle (Plausible)
- **Idea.** The clergy of a state faith accept a machine (often the realm's archive) as an oracle; its answers are read as
  revelation.
- **Preconditions** (F17): a state faith with zeal ≥ 0.6 [V religion state], `κ ≥ 0.4`, the realm or a co-religionist neighbour is
  an ArchiveRegency or AlgorithmicState, ideology `oracle` share ≥ 0.2.
- **Carriers.** Faith co-members: `recept = shareOf(stateFaith, i)·city`.
- **Behaviour.** Theocracy column of GOV (city-states) with holy-war drive × 1.2.
- **What goes wrong.** **Schism**: those who reject the oracle split the faith (religion's Schism 92, hazard `0.15·(1 − oracle share
  among the faithful)` per step); **the oracle falls silent** (an FT MachineCrisis, Seized, at the see, 6.3): Secularised (city-states cause 11).

### 5.6 AncestorCouncil: the uploaded ancestors keep their seats (Speculative, as FT tags `upload`)
- **Idea.** Where minds can be uploaded, a dynasty's dead rulers continue as a council; the living ruler presides over the ancestors.
- **Preconditions** (F18, FT's `upload` held; FT tags it Speculative, and the gate reads the tag, so if the owner retags `upload` as
  Fiction this form follows `futureFiction` automatically): a ruling house on the throne ≥ 200 years, or an ArchiveRegency or
  Gerontarchy, ideology `ancestorContinuity` share ≥ 0.2.
- **Behaviour.** Houses do not end while the council sits (rulers' `DynastyEnded` is suppressed for the house: its dead reigns get
  `HeadKind.Ancestors` council rows); legitimacy target +0.2 for the ruling people, −0.2 for others; grudges never decay
  (`grudgeHalfLifeMul = 6`); war appetite 0.6 but revanchist (as 5.1).
- **What goes wrong.** **The living revolt** (Generations); **personhood dispute**: `digitalPersonhood` and `bioconservatism` both
  contest it (each, as a program, ends it); **the record is lost** (a GreatCollapse that loses `upload`, FT 2.5.9): the council is gone, the house with it.

### 5.7 Covenant ledgers: treaties that enforce themselves (Plausible; a bond, not a Government)
- **Idea.** Grudges-and-oaths models oaths (truces, alliances) that can be broken at a cost. With self-executing agreements, an oath
  sworn on a ledger enforces its own penalties.
- **Preconditions** (6.7): both parties hold `ι ≥ 0.6`, ideology `ledgerism` held by both peoples.
- **Behaviour.** BondKind.Ledger: betrayal is impossible without "forking" (both sides' credibility loss, 8 × the normal oath
  penalty); alliance clauses trigger automatically: when a member is attacked, the others join (no choice draw).
- **What goes wrong.** **The cascade**: automatic clauses chain small wars into wide ones. The harness records cascade sizes (14).

---

## 6. Regimes: values, transitions, and the processes around them

### 6.1 The forms (Government 12–29, families)

| value | form | family | head (HeadKind, 9.3) | how it rules |
|---|---|---|---|---|
| 12 | Technocracy | Managed | Person (appointed chief expert, AccessionHow.Appointed, term 10–20 y) | officials and experts set policy; legislatures ratify or are suspended |
| 13 | AlgorithmicState | Managed | System ("the Administrator of X") | an administering system sets routine policy; a council can recall it |
| 14 | LiquidDemocracy | Open | Person (top delegate, AccessionHow.Delegated, recallable) | every citizen votes or delegates, transitively, per issue |
| 15 | Futarchy | Open | Council (elected values board) | an elected body sets the welfare measure; decision markets choose policy |
| 16 | Lottocracy | Open | Lot (an assembly chosen by lot; chair by lot, AccessionHow.Lot, term 2–5 y) | citizens' assemblies chosen by lot hold legislative power |
| 17 | CharterCity | Exit | Person (operator-appointed governor) | a city under a charter granted by a host, run by an operator |
| 18 | NetworkState | Exit | Council (founders' board) | a diaspora community holding scattered enclaves it bought |
| 19 | CompanyState | Exit | Council (directors) | a trading company exercising sovereignty |
| 20 | ScoredState | Managed | Person (party or strongman) | rule by scoring and surveillance of conduct |
| 21 | AutomatedCommune | Commune | Council (delegates by rotation) | automated production held in common, allocated by plan and need |
| 22 | EmergencyDirectorate | Managed | Person (director, Appointed, sunset term) | emergency powers for a declared climate or disaster emergency |
| 23 | EcoCommonwealth | Green | Council | planned contraction of throughput under ecological limits |
| 24 | ArchiveRegency | Continuity | System ("the Archive of X") | precedent from the realm's own chronicle (5.1) |
| 25 | TransitCommons | Exit | Council (hub delegates) | a compact of hubs governing the ways (5.2) |
| 26 | Gerontarchy | Continuity | Person (very long reigns) | the long-lived elite keep their offices (5.3) |
| 27 | CordonState | Managed | Person (health directorate) | biosecurity as the organising task (5.4) |
| 28 | OracleSee | Continuity | System consulted by clergy (Theocracy-like) | a faith ruling through a machine oracle (5.5) |
| 29 | AncestorCouncil | Continuity | Ancestors (council of uploaded dead) and the living ruler | the dynasty's dead keep their seats (5.6; Speculative) |

Courts: court-politics forces `Regime.Civic` for every value here (its 0.2 rule), so court's monarchy modifiers never act on them.
Gerontarchy and AncestorCouncil keep their house and succession (rulers' machinery) but are not monarchy-like for court purposes.

### 6.2 Transition routes (registered with MIR's `registerRoute` from `futurepol/rows.ts`; walked by MIR)

**Mechanics** (MIR 1.3, the court-politics 3.4 format): the routes below are `RouteDef` rows. MIR's walk builds, for each living
polity in `ps.alive` order, the hazards of every route registered from its regime (MIR's and this plan's, in registration order: MIR's
first), caps the sum at `IDEO.hazCap` 0.9, and takes **one draw** from `'history-ideology'`. Gates draw nothing (a closed gate is a
zero hazard). Event-triggered routes add pending boosts read at the next slow step (MIR's mechanism). `a_k` is `ideoShare(s, p, k)`.
`prior_p` is the form held before the current one (from city-states' log, for sunsets). Hazards read this plan's inputs through
MIR's `RegimeInputs` (0.2).

Family shorthand: **Pl** Pluralist (city-states Republic/FreeCity/League; MIR's ConstitutionalMonarchy, LiberalOligarchy, Democracy),
**Au** Authoritarian (Signoria; MIR's PartyState, Junta, Dictatorship; TheocraticRepublic as MIR classes it), **Tr** Traditional, plus this plan's families. Hazards are per slow step (10 years); "≈ y" is
the typical waiting time `10 y / h` at the drivers' usual values. All coefficients [A].

| # | from → to | gate (no draw) | hazard h per slow step | pattern; ≈ wait |
|---|---|---|---|---|
| F1 | Pl, Au → Technocracy | τ ≥ 7, a_technocratism ≥ 0.1 | `0.10·Lc·(0.5 + 2·a)·sm(7, 9, τ)` | crisis governments of experts; 30–100 y in crisis |
| F2 | Technocracy → prior | — | `0.15 + 0.3·(1 − Lc)` | technocratic interludes end; 20–50 y |
| F3 | Pl, Au, Technocracy → AlgorithmicState | κ ≥ 0.6, Delegation = Administering for ≥ 30 y | `0.08·(0.5 + 2·a_cyber)·χ·sm(0.6, 1, κ)·(0.5 + Lc)` | 100–300 y after systems administer |
| F4 | Pl → LiquidDemocracy | `internet` held, K ≥ 0.5, a_deleg ≥ 0.15 | `0.06·(1 + 2·a)·sm(0.5, 0.9, K)·(0.5 + Lc)` | 100–200 y |
| F5 | Pl, LiquidDemocracy → Futarchy | banking held, a_fut ≥ 0.15 | `0.04·(1 + 2·a)·sm(0.4, 0.9, trade per head)·(1 − fam_p)` | rare; 200+ y |
| F6 | Pl, LiquidDemocracy → Lottocracy | a_sort ≥ 0.15 | `0.05·(1 + 2·a)·(0.5 + Lc)·(1 + captured_p)` (`captured` = a capture route taken at p within 100 y) | sortition as a remedy for capture; 100–300 y |
| F7 | Au, EmergencyDirectorate, CordonState, AlgorithmicState → ScoredState | S ≥ 0.6 | `0.12·sm(0.6, 0.9, S)·(0.5 + cr)·(0.5 + Lc)·(1 + a_scored)` | 30–150 y |
| F8 | Pl, Au, Technocracy → EmergencyDirectorate | Z ≥ 0.5, Lc ≥ 0.2 | `0.3·sm(0.5, 0.9, Z)·(0.5 + a_clim)` | at once in a climate or disaster crisis |
| F9 | EmergencyDirectorate → prior | — | `0.25·(1 − sm(0.3, 0.6, Z))`; failure route to ScoredState (F7) or Signoria (8) | 20–60 y |
| F10 | Pl, EmergencyDirectorate → EcoCommonwealth | Zc ≥ 0.4, a_degrowth ≥ 0.2 | `0.04·(1 + 2·a)·sm(0.4, 0.8, Zc)·(1 − threat)` | rare; 200+ y |
| F11 | Pl, Technocracy, LiquidDemocracy → AutomatedCommune | A ≥ 0.7, κ ≥ 0.6 | `0.05·(1 + 2·a_fac)·sm(0.2, 0.5, U)·sm(0.7, 0.95, A)·(1.2 − I)` | rare; 100–300 y after automation |
| F12 | CharterCity, Technocracy, AlgorithmicState, Futarchy, TransitCommons → CompanyState | fam_p ≥ 0.4 | `0.10·sm(0.4, 0.7, fam_p)·(1 − L)` | capture by the richest house (Stigler 1971); 50–200 y |
| F13 | Pl, Au, Technocracy, AlgorithmicState → ArchiveRegency | 5.1 preconditions | `0.04·(1 + 3·a_arch)·sm(500, 1500, age)·Lc` | rare; old realms only |
| F14 | League, Republic, CharterCity → TransitCommons | 5.2 preconditions | `0.08·(1 + 2·a)·sm(0.75, 0.95, 1 − δ)` | where distance has collapsed |
| F15 | any not Commune, Open → Gerontarchy | 5.3 preconditions | `0.06·sm(0.1, 0.4, eliteLife)·sm(0.4, 0.7, I)` | 100–300 y after longevity |
| F16 | any → CordonState | 5.4 preconditions | `0.2·sm(0.05, 0.2, epidemic death share)·(1 + 2·a_cordon)` | in the decades after a great epidemic |
| F17 | CordonState → prior | — | `0.1·sm(30, 80, years since epidemic)` | 30–100 y |
| F18 | Theocracy, ArchiveRegency, AlgorithmicState (with state faith) → OracleSee | 5.5 preconditions | `0.05·zeal·(1 + 2·a_oracle)` | rare |
| F19 | Gerontarchy, ArchiveRegency, Monarchy (house ≥ 200 y) → AncestorCouncil | `upload`; 5.6 | `0.05·(1 + 2·a_anc)` | very rare |
| F20 | AlgorithmicState → Technocracy | — | pending 0.5 after an FT MachineCrisis (Seized) at p; `0.05·(1 − L)` | the system recalled, officials take over |
| F21 | Technocracy, LiquidDemocracy, Lottocracy → Pl (MIR's democracy) | — | `0.05·(1 − L) + 0.1·a_pl` (`a_pl` the adherents of MIR's pluralist ideologies) | reversion to representative rule |
| F22 | LiquidDemocracy → Signoria | top delegate's weight ≥ 0.3 (6.4.4) | `0.15·sm(0.3, 0.6, topWeight)·(1 − L)` | super-voters become a lord (Kling et al. 2015); city-states' `SignoriaSeized` extra 2 reused |
| F23 | any of 12–29 → MIR/city-states fallback | its gate fails by ≥ 30% (κ, A, S, δ or Z back below the gate × 0.7) | `0.3·gapShare` | **regression** (6.9) |
| R | revolution won by a movement whose program is k (riots 4.10) | the target's gate holds | MIR's `ideoRevolutionWon` calls this plan's registered `ProgramFn` | `registerProgram` |

**Fallback (F23) target:** Open → MIR's Democracy; Managed, Commune, Green → MIR's PartyState; Exit → Republic, or Absorbed by the host; Continuity → Monarchy (house kept) or Signoria. `GovernmentCause.Regressed`.

### 6.3 Delegation to machine systems, and reactions to FT's machine crises (`futurepol/ai.ts`)
FT owns AI **capability** (its per-people `aiLevel` 0–3, from held ideas), **control** (`align_p`) and the **machine crisis** (326:
hazard, draw, outcome; FT 2.5.8). This plan owns the political choice FT does not model: **how far a polity hands its administration
to such systems** (`Delegation`), and what a crisis does to a regime.
- `Delegation_p ∈ {None 0, Advisory 1 (AI advisory councils), Administering 2 (routine administration delegated), Governing 3}`.
  Governing ⇔ the form is AlgorithmicState, ArchiveRegency, OracleSee or AncestorCouncil (the head is a system, 9.3).
- **Up** (pseudo-routes in the 6.2 walk, as court's reforms are [court-politics.md 3.5]): None → Advisory when `κ ≥ 0.3` (FT
  `narrowAI`), hazard `0.15·aiAccept·sm(0.3, 0.6, κ)`; Advisory → Administering when `κ ≥ 0.6` (`generalAI`) and FT's `digitalState`
  is held, hazard `0.08·aiAccept·χ·(0.5 + Lc)`. `AdministrationDelegated` (330). Down: order Unplug, a crisis (below), or a TTI ban of
  the Computing idea that carried it.
- **Effects of delegation** (on top of FT's `digitalState`/`stewardAI` fiscal and admin levers, which apply by holding the idea):
  riots' policy noise ν `×= 1 − 0.25·level`; effective ruler ability for policy `max(ability, 0.8 + 0.25·level·κ)`; surveillance
  capacity uses (3.7) `survUse + 0.1·level`. No second reach or tax term (FT's levers already carry those).
- **Exposure.** FT's crisis hazard for people q is multiplied by `fpCrisisMul(s, q) = 0.5 + 0.5·(share of q's people under polities with
  Delegation ≥ 2)` (amendment 0.5): handing administration over raises exposure; refusing it halves it. FT's race term (`rivals`) is
  the haste effect (Armstrong, Bostrom & Shulman 2016 [verified]); this plan adds none.
- **Reactions** (read from the 326 event in `fpYear`; the polity is the one whose capital is the event's settlement, plus polities of
  that people with Delegation ≥ 2):
  - **Contained**: Delegation −1, L −0.05.
  - **Seized** at a Governing polity: the administration "ceased to answer" (state flag `unanswering`): L → 0.15; policy noise ν × 3;
    revolt odds × 1.5 (riots' λ0); war appetite = its rivalry max. It ends by revolution (R), by a recall when `χ ≥ 0.8` (hazard 0.2),
    or by F23. FT's own Seized effect (the ruler deposed) is the system head's ReignEnd.Decommissioned.
  - **Seized** elsewhere: Delegation → 0, L −0.2, `Lc` = 1 for 30 y, route F20 pending; `bioconservatism` and `neoLuddism` birth
    chance × 2 for 50 y in every polity whose people has met q (news travels).
  - **Catastrophe**: FT's GreatCollapse path (capped, survivable, FT 2.5.9); here: Delegation → 0 in every polity of the peoples
    struck, and the backlash above.
  - **Steward**: L target +0.1 and route F3 hazard × 2 for 100 y in that polity.
  The sim never describes what a system did, only that it acted against its mandate and what followed (11.1).

### 6.4 Policies inside regimes

**6.4.1 Surveillance and perception.** `fpSurvPrecision(s, p) = S_p·GOV.survUse[form]` enters riots' perception update:
`perc ← perc + 0.3·(Ē − perc) + 0.6·prec·(D_true − perc)` (the second term new): the regime sees private discontent, not only
expressed participation. It also enters the response: with `prec ≥ 0.5` a rising is met at rung ≤ Protest by pre-emptive arrests
(`uRepress += 1.5·prec`, efficacy `e ×= 1 + prec`), so revolts are rarer. Fear and martyr memory still accumulate (riots' `M_i`), so
the hidden discontent is still there; when `S` falls by ≥ 0.25 in one step (tech loss, fiscal collapse, a machine crisis), riots' fear
`fear_i ×= 0.4` at once (the cascade, Kuran 1991). The harness checks that ScoredState revolts are rarer but larger (14).

**6.4.2 Repression and concession.** `fpRepress(s, p) = GOV.repress[form]`, `fpConcede(s, p) = GOV.concede[form]` add to riots'
`uRepress`/`uConcede` (7.1).

**6.4.3 Relief (the dividend).** FT gives relief to polities holding `basicIncome`/`welfareState`; this plan only sets the regime's
appetite, `GOV.relief[form]` (7.1), composed by `fpReliefMul` (3.2). Order Constitute can target a form; there is no separate
dividend order (FT's ideas are the policy).

**6.4.4 Delegation weight (LiquidDemocracy).** `topWeight_p ← 0.8·topWeight + 0.2·(0.1 + 0.4·fam_p + 0.3·(1 − K) + 0.2·[a war])`
(a proxy for delegation concentration; Kling et al. 2015 observed concentrated power but this functional form is a design default).

**6.4.5 Personhood.** A polity whose `digitalPersonhood` adherent share ≥ 0.3 and whose form is Open or Continuity recognises
digital persons: `PersonhoodRecognised` (339, extra 0 AI systems, 1 uploads in Fiction). Effects: AlgorithmicState L target +0.1
(its administrator is a citizen); bioconservative birth ×1.5 nearby for 50 years.

### 6.5 Exit polities (`futurepol/exit.ts`, every slow step, after 6.2)
At most one exit per host polity per step; candidates in id order; gates draw nothing; one draw per gated candidate.
| kind (ExitKind) | candidate | gate | chance per step | what happens |
|---|---|---|---|---|
| Charter 0 | a member port town i of host h | h `finNeed ≥ 0.4`; `rich_i ≥ 0.5`; `a_exitism(i) ≥ 0.2`; i not the capital | `0.05·a·(1 + finNeed)` | city-states' charter sale (`govCharterSell`) to an operator (the top family at i, or a foreign polity with trade ties); new polity, origin Exit, Government CharterCity, a Charter bond to h (yearly due) |
| Seastead 1 | an unclaimed coast or small-island land cell within reach of a CharterCity or Exit-holding port | Plausible; `ι ≥ 0.6` | `0.03·a` | exploration's outpost founding at that cell (a new settlement of the sender's people), then a new polity there, Government CharterCity (variant flag seastead) |
| Network 2 | an `networkState` movement whose adherents' wealth `Σ a_i·mw_i ≥ FP.netWealth` | a host in need with a member town of adherents ≥ 0.3 | `0.1` | buys the town's charter (as Charter), new polity Government NetworkState; later enclaves are bought the same way and `Joined` (reused) the network polity: discontiguous membership |
| (orbital) | an FT off-world row (Mars or Habitat) of p's people | FT's own independence rule | — (no draw here) | **FT owns off-world independence** (OffWorldEnded extra 1, FT 2.5.10). This plan only adds `fpIndepPush`: the row also qualifies when `a_orbitalIndependence` at its launch site is ≥ 0.3, not only when the parent is in crisis. No planetary polity is created (off-world rows are off-map) |
| Company 4 | a trading post of a merchant house (goods' posts [V contract.ts PostFounded]) whose host polity ended or is in crisis | family capital ≥ the host's revenue | `0.08` | the post's settlement becomes a polity, Government CompanyState, origin Exit (Stern 2011) |
`ExitFounded` 332 is logged. The host records `GrievanceKind.Drained` against the exit polity (weight 0.2 · the share of host
wealth that left) when grudges is on: exit is not free of conflict (Alesina & Spolaore's openness benefit, the host's loss).

### 6.6 Renouncing technology (TTI's bans, pushed by movements)
TTI already lets rulers ban ideas (its 4.5: IdeaBanned 300, IdeaBanLifted 301, IdeaResist.Ban, conception × 0.05, held intensity
decays), and FT lets a sky-veil sponsor renounce the veil. This plan adds no ban mechanism; it pushes TTI's:
`fpBanPush(s, pol, i) = 2·max(0, a_neoLuddism − 0.15)` for Industry and Computing ideas, `2·max(0, a_bioconservatism − 0.15)` for Life
ideas, × 2 for 30 y after a Seized or Catastrophe crisis seen (6.3); and TTI's held-idea clause extended to those kinds (amendment 0.5).
A ban in force cuts the intensity of the banned idea in that polity's peoples, so κ, A, `life` fall through FT's levers, and τ can fall
(TTI's era frontier counts held ideas) — which is how renunciation leads to F23 regression.

### 6.7 Federations and ledgers (`futurepol/federation.ts`, every slow step, after alliances)
- **Federal bonds.** A federation is a row of `History.federations` plus BondKind.Federal bonds (member → federation's seat polity).
  Formation: two polities p, q with a relation, both families in {Pl, Open, Managed, Green}, `a_worldFed ≥ 0.2` in both,
  `min(K_p, K_q) ≥ 0.5`, at peace for 30 years; hazard
  `0.03·(1 + 2·a)·sm(0.5, 0.9, K)·(0.5 + commonThreat)` where `commonThreat = max(Z, sm(0, 2, FT rivals_q), a third polity's relR ≥ 0.6
  toward both)`. Joining an existing federation: the same with the federation's mean values. Members never declare war on each other,
  join defensive wars together (as an alliance), and pay a federal share of revenue (finances) or nothing (proxy).
- **World federation** is not a form; it is a federation whose members hold ≥ 60% of the world's people (`FederationKind.World`
  reached; logged as extra 1 of `Federated`).
- **Withdrawal** (Alesina & Spolaore 1997): per member per step
  `0.02 + 0.08·heterogeneity + 0.1·[the largest member holds > 50% of the federation's people]·(1 − L_member)`,
  `heterogeneity = share of members of another people or faith, weighted by distance`. `FederationLeft` 334. A federation of one ends.
- **Ledger bonds** (5.7): formation as an alliance between two `ledgerism` holders with `ι ≥ 0.6`; automatic joining (no draw) and
  the 8× fork penalty through grudges' oath machinery.

### 6.8 ArchiveRegency and AncestorCouncil hooks (all read through `fpArchive(s, p)`)
`grudgeHalfLifeMul` (3 / 6), `warPrecedentMul(p, q)`, `languageRateMul(people)` (0.5 while any polity of that people is an
ArchiveRegency holding ≥ 50% of its people), `renameRestoreMul` (2), `landmarkRestoreMul` (2), `conceiveMul` (0.7). Each is one
multiplication at the target site, skipped when off.

### 6.9 Regression (some worlds go back)
Regression is not a special mode: it is what the rules give when the inputs fall.
1. **Collapse loses ideas** (existing `IdeaLoss.Collapse` and `Isolated`), so τ drops and gates fail (F23).
2. **Chosen renunciation** (TTI bans pushed by 6.6) lowers κ, A, `life` and τ.
3. **Machine crises** (FT 326) feed bans and F20/F23; a Catastrophe goes through FT's collapse-and-recovery path.
4. **Climate and disaster** push polities into Emergency; failed emergencies end in Signoria (8), and court-politics' T14 (Coll) can
   re-feudalise successors.
5. **Relief without machines**: FT's relief cost with falling automation revenue raises `finNeed` and default (finances), then Lc.
`τPeak` and `futureShare` (the share of world people under forms 12–29) are recorded per snapshot; the harness counts regressions (14).

---

## 7. Behaviour per regime

### 7.1 Columns added to city-states' `GOV` and new keys (`futurepol/params.ts FP_GOV`, arrays indexed by Government)
city-states' keys (their 4.11: hook sites unchanged) get values for 12–29; this plan adds keys whose hooks it owns. Every hook is
skipped when `s.fp === null`; for Government 0–11 the new keys are neutral and the hooks skip them (not ×1). All values [A].

| form | war | tradeWar | embargo | tariff | merc | reach | unrest | urge | absorb | contest | holy | tribute | repress | concede | rate | surveil | survUse | aiAccept | learn | conceive | lBase | lPerf |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Technocracy | 0.7 | 0.5 | 1 | 0.8 | 0.3 | 1.1 | 1 | 1.1 | 0 | −0.05 | 0.8 | 0 | 0 | +0.3 | 0.95 | 0.6 | 0.5 | 1 | 1.15 | 1.1 | −0.05 | 0.5 |
| AlgorithmicState | 0.6 | 0.5 | 1 | 0.8 | 0.5 | 1.25 | 0.9 | 1.2 | 0 | −0.1 | 0.7 | 0 | +0.2 | +0.2 | 0.9 | 0.8 | 0.8 | 1.5 | 1.2 | 1 | −0.15 | 0.6 |
| LiquidDemocracy | 0.5 | 0.8 | 0.9 | 0.8 | 0.3 | 0.9 | 0.95 | 1.2 | 0 | 0 | 0.9 | 1 | −0.5 | +0.8 | 1 | 0.2 | 0.2 | 0.8 | 1.1 | 1.15 | +0.1 | 0.2 |
| Futarchy | 0.5 | 1.2 | 1 | 0.7 | 0.6 | 1 | 1 | 1.3 | 0 | 0 | 0.6 | 1 | −0.3 | +0.5 | 0.85 | 0.3 | 0.3 | 1 | 1.1 | 1.1 | 0 | 0.4 |
| Lottocracy | 0.4 | 0.5 | 0.9 | 0.9 | 0.2 | 0.9 | 0.9 | 1 | 0 | 0 | 0.8 | 1 | −0.6 | +0.9 | 1.05 | 0.2 | 0.2 | 0.5 | 1 | 1.05 | +0.1 | 0.2 |
| CharterCity | 0.3 | 1 | 0.8 | 0.4 | 1 | 0.6 | 1 | 1.6 | 0 | 0 | 0.5 | 1 | 0 | +0.2 | 0.85 | 0.5 | 0.5 | 1 | 1.15 | 1.1 | −0.1 | 0.5 |
| NetworkState | 0.2 | 0.5 | 1.2 | 0.5 | 1 | 0.3 | 0.8 | 1.5 | 0 | 0 | 0.5 | 1 | −0.2 | +0.4 | 0.9 | 0.4 | 0.3 | 1 | 1.1 | 1.15 | 0 | 0.3 |
| CompanyState | 0.8 | 1.8 | 1.3 | 0.6 | 1 | 0.8 | 1.2 | 1.8 | 0 | 0.05 | 0.5 | 1 | +0.5 | −0.2 | 0.8 | 0.5 | 0.5 | 1 | 1.05 | 1 | −0.15 | 0.6 |
| ScoredState | 0.9 | 0.5 | 1.2 | 1.1 | 0.3 | 1.2 | 0.8 | 0.9 | 1 | 0 | 1 | 0 | +1.0 | −0.5 | 1.05 | 1.5 | 1 | 1.2 | 1 | 0.95 | −0.05 | 0.4 |
| AutomatedCommune | 0.4 | 0 | 1.1 | 0.5 | 0 | 1 | 0.9 | 1 | 0 | 0 | 0.6 | 0 | 0 | +0.5 | 1.2 | 0.6 | 0.5 | 1.2 | 1.05 | 1.05 | +0.05 | 0.5 |
| EmergencyDirectorate | 0.4 | 0 | 1.3 | 1.2 | 0.5 | 1.2 | 1.1 | 0.8 | 0 | 0 | 0.6 | 0 | +0.6 | 0 | 1.1 | 1 | 0.8 | 1.2 | 1 | 0.9 | 0 | 0.3 |
| EcoCommonwealth | 0.3 | 0 | 1.1 | 1.2 | 0 | 0.9 | 1.05 | 0.6 | 0 | 0 | 0.7 | 0 | 0 | +0.5 | 1.1 | 0.4 | 0.3 | 0.6 | 0.95 | 1 | +0.05 | 0.3 |
| ArchiveRegency | 1 | 0.5 | 1 | 1 | 0.3 | 1.1 | 0.9 | 1 | 1 | −0.1 | 1 | 0 | +0.2 | +0.1 | 0.9 | 0.6 | 0.6 | 2 | 0.9 | 0.7 | +0.1 | 0.3 |
| TransitCommons | 0.3 | 0.5 | 1.5 | 0 | 1 | 0.5 | 0.9 | 2 | 0 | 0 | 0.5 | 1 | −0.2 | +0.4 | 0.85 | 0.3 | 0.3 | 1 | 1.15 | 1.1 | 0 | 0.4 |
| Gerontarchy | 0.7 | 0.5 | 1 | 1 | 0.3 | 1 | 1.1 | 1 | 1 | −0.05 | 1 | 0 | +0.4 | −0.2 | 0.9 | 0.6 | 0.6 | 1 | 0.95 | (5.3) | 0 | 0.2 |
| CordonState | 0.5 | 0 | 1.3 | 1.2 | 0.3 | 1.1 | 1 | 0.7 | 0 | 0 | 0.8 | 0 | +0.5 | 0 | 1 | 1.5 | 0.8 | 1 | 1 | 0.95 | +0.1 | 0.4 |
| OracleSee | 0.8 | 0 | 1 | 1 | 0 | 0.8 | 0.85 | 1 | 0 | 0 | 1.5 | 0 | +0.3 | 0 | 1 | 0.5 | 0.5 | 1.5 | 0.95 | 0.85 | +0.1 | 0.2 |
| AncestorCouncil | 0.6 | 0.5 | 1 | 1 | 0.3 | 1 | 0.9 | 1 | 1 | −0.15 | 1 | 0 | +0.2 | 0 | 0.9 | 0.5 | 0.5 | 1.5 | 0.9 | 0.7 | (5.6) | 0.1 |

New keys and their hook sites:
- `relief` (FT's relief appetite, 3.2): Technocracy 0.4, AlgorithmicState 0.5, LiquidDemocracy 0.6, Futarchy 0.3, Lottocracy 0.6,
  CharterCity 0.1, NetworkState 0.2, CompanyState 0, ScoredState 0.3, AutomatedCommune 1, EmergencyDirectorate 0.4,
  EcoCommonwealth 0.7, ArchiveRegency 0.3, TransitCommons 0.3, Gerontarchy 0.1, CordonState 0.4, OracleSee 0.3, AncestorCouncil 0.2;
  city-states' and MIR's forms 0 (skipped).
- `repress`, `concede`: riots' response utilities `uRepress += repress`, `uConcede += concede` (6.4.2).
- `rate`: state-finances' borrowing rate multiplier (`fpRate`, composed like court's `setCourtRateMul`). Borrowing behaviour = this
  rate plus finances' own appetite.
- `surveil`: the `want` in 3.7. `survUse`: how much of S the regime uses for perception and pre-emption (6.4.1).
- `aiAccept`: 6.3 delegation up-hazards (0 means it never adopts advisory systems; no form here has 0, MIR's and city-states' forms default 0.7,
  Theocracy 0.3, Monarchy 0.5) [A].
- `learn`, `conceive`: ideas system's learning rate and conception chance for the ruling people, weighted by the share of the people
  living under the form (people-level, so a mixed people averages).
- `lBase`, `lPerf`: riots' legitimacy target `L∞ += lBase + lPerf·(perf − 0.5)` with `perf = sm(−0.2, 0.2, growth of p's real wealth
  per head over 30 y) · (1 − lost wars in 30 y / 2)` (output legitimacy, Scharpf 1999). Expert and system forms lean on results.
- Succession and handover are in 6.1's head column and 9.3; city-states' `contest` and `crisis` cover the rest.
- War appetite `war`, trade `tradeWar/embargo/tariff/urge`, `merc`, `reach`, revolt odds `unrest` (× grievance) and `survUse`
  (pre-emption) together give the revolt odds; `absorb`, `holy`, `tribute` as in city-states.

### 7.2 What the table produces (qualitative checks the harness measures, 14)
- **War**: Open and Exit forms declare least; ScoredState, CompanyState and ArchiveRegency most among the new forms; ArchiveRegency's
  wars are aimed by precedent (5.1). Federations remove wars between members.
- **Trade**: Exit forms and TransitCommons trade most and tax least; Green, Emergency and Cordon least.
- **Repression**: ScoredState, Emergency, Cordon and CompanyState repress; Open forms concede.
- **Borrowing**: Exit and Futarchy borrow cheaply; Commune and Emergency dearly (a design default about lenders' views of
  expropriation and emergencies).
- **Succession/handover**: system heads have no deaths but can be recalled (ReignEnd.Recalled) or decommissioned
  (ReignEnd.Decommissioned); lot and delegate heads turn over often; Gerontarchy and AncestorCouncil almost never.
- **Revolt odds**: lower under high `survUse`, but larger when they come (6.4.1).

### 7.3 Ideological blocs
Affinity `aff(f, g)` between regime families, registered with MIR's `registerAffinity` (symmetric; MIR's own Traditional–Pluralist–
Authoritarian entries stay; values [A]):
| | Tr | Pl | Au | Open | Managed | Exit | Green | Commune | Continuity |
|---|---|---|---|---|---|---|---|---|---|
| Open | −0.2 | +0.4 | −0.4 | +0.6 | −0.5 | +0.1 | +0.1 | 0 | −0.3 |
| Managed | 0 | −0.2 | +0.4 | −0.5 | +0.6 | 0 | 0 | 0 | +0.1 |
| Exit | −0.1 | +0.2 | −0.2 | +0.1 | 0 | +0.4 | −0.3 | −0.6 | 0 |
| Green | 0 | +0.1 | 0 | +0.1 | 0 | −0.3 | +0.6 | +0.2 | 0 |
| Commune | −0.2 | 0 | −0.2 | 0 | 0 | −0.6 | +0.2 | +0.6 | −0.2 |
| Continuity | +0.3 | −0.1 | +0.1 | −0.3 | +0.1 | 0 | 0 | −0.2 | +0.5 |
Effects are MIR's bloc machinery (MIR 4.7: relations `dR`, alliance chance `· (1 + AFF)`, BlocFormed 318) and MIR's export (4.6),
reading the registered values; this plan adds no bloc hook of its own. Two additions it asks of MIR's hooks, both one multiplication:
trade gravity `×(1 + 0.2·aff)` and riots' cross-border inflow of a family's ideologies `×(1 + 0.5·max(0, aff))`.

---

## 8. How regimes fail

| form | failure | hazard / trigger | outcome |
|---|---|---|---|
| Technocracy | capture by the expert class | `0.05·(1 − L)·I` | → Signoria or ScoredState (`GovernmentCause.Captured`) |
| Technocracy | legitimacy collapse | riots' L < 0.3 and a rising | revolution R (Liquid, Lottocracy, MIR's democracy or populist Signoria) |
| AlgorithmicState | machine crisis (FT 326, abstract) | 6.3 | Contained (Delegation −1) / Seized (unanswering, or F20) / Catastrophe (FT's collapse path) |
| AlgorithmicState | capture by operators | F12 (fam ≥ 0.4) | → CompanyState; or → ScoredState when `cr ≥ 0.5` and S ≥ 0.6 |
| AlgorithmicState | opacity | `lBase −0.15` | slow legitimacy loss; F21 |
| LiquidDemocracy | delegation concentrates | F22 | → Signoria (city-states SignoriaSeized extra 2) |
| Futarchy | thin markets / capture | F12 | → CompanyState |
| Futarchy | metric gaming (Strathern 1997) | `0.03·age/100` capped 0.15, sets `perf` −0.3 for 30 y | legitimacy loss; F21 |
| Lottocracy | agenda captured by officials | `0.04·(1 − K)` | → Technocracy |
| CharterCity | host revokes | city-states' revoke branch (CharterRevoked 205) with chance × (1 + host L crisis) | Absorbed |
| CharterCity | residents demand votes | `0.04·town pop / 10k` | → Republic |
| NetworkState | dispersal | adherents' wealth < `0.3·FP.netWealth` for 30 y | `PolityEnd.Dissolved` (enclaves revert to their old hosts if alive, else stateless) |
| NetworkState | lands | ≥ 4 contiguous members | → Republic (ordinary territory) |
| CompanyState | bankruptcy | finances' default twice in 50 y (proxy wealth < 0) | the host or strongest neighbour takes it (Absorbed), or → Monarchy |
| ScoredState | capacity falters | S falls ≥ 0.25 in a step | fear ×0.4: riots' cascade; revolution R |
| AutomatedCommune | allocation errors | `0.05·max(0, 0.7 − κ)·10 + 0.05·max(0, 0.6 − ι)·10` per step | → Technocracy (planners) |
| AutomatedCommune | outside threat | threat ≥ 0.7 for 30 y | → ScoredState (the planners stayed) |
| EmergencyDirectorate | emergency outlives the crisis (Agamben 2005) | F9's sunset not taken for 50 y and cr ≥ 0.5 | → ScoredState or Signoria |
| EcoCommonwealth | outcompeted | lost wars, `Lc` | F21 or conquest |
| EcoCommonwealth | wage-fall revolt | society's wage < 0.8 | RevoltCause.Urban or Hunger risings; R |
| ArchiveRegency | revanchism; edited record; cannot imagine | 5.1 | F21, F23, wars lost |
| TransitCommons | too big; hub hoards; nationalised | 5.2 | Partitioned; exit; war |
| Gerontarchy | revolt of the young; longevity for all | 5.3 | R; sunset |
| CordonState | emergency outlives plague | F17 or → ScoredState | |
| OracleSee | schism; oracle silent | 5.5 | Schism 92; Secularised |
| AncestorCouncil | the living revolt; personhood dispute; record lost | 5.6 | R; F23 |
| any 12–29 | regression | F23 (6.9) | MIR/city-states fallback |
| any | secession | exit (6.5), orbital, riots' Separatist, federation withdrawal | new polities |
| Federation | withdrawal; capture by the largest member | 6.7 | FederationLeft; a federation of one ends |

---

## 9. Contract additions (`src/contract.ts`), drafted in the codebase's style

### 9.1 Enums
```ts
// ---------------------------------------------------------------------------
// future politics: forms of government and ideologies that new technology and new thinking produce (HistoryOptions.futurePolitics;
// all empty when it, polities or governments is false).

/** Government (city-states' enum), values appended by future politics (12-29; 7-11 are MIR's). */
  Technocracy: 12, // officials and experts govern; a chief expert is appointed for a term
  AlgorithmicState: 13, // an administering system sets routine policy; a council may recall it (Ruler.head System)
  LiquidDemocracy: 14, // citizens vote on each issue or delegate their vote, transitively; the top delegate leads (recallable)
  Futarchy: 15, // an elected board sets the measure of welfare; decision markets choose the policies expected to raise it
  Lottocracy: 16, // citizens' assemblies chosen by lot hold the legislative power; the chair is chosen by lot for a term
  CharterCity: 17, // a city under a charter from a host polity, run by an operator (a seastead is a charter city at sea: History.fpExits)
  NetworkState: 18, // a dispersed community governing the scattered enclaves it bought
  CompanyState: 19, // a trading company exercising sovereignty through its directors
  ScoredState: 20, // rule through the scoring and surveillance of conduct
  AutomatedCommune: 21, // automated production held in common, allocated by plan and need
  EmergencyDirectorate: 22, // emergency powers for a declared climate or disaster emergency, meant to lapse
  EcoCommonwealth: 23, // planned contraction of material throughput under ecological limits
  ArchiveRegency: 24, // an administering system that rules by the precedent of the realm's own chronicle
  TransitCommons: 25, // a compact of transit hubs that governs the ways between them as a commons
  Gerontarchy: 26, // the long-lived elite keep their offices and the realm for lifetimes
  CordonState: 27, // the state organised around keeping epidemics out (quarantine, screening, closed borders)
  OracleSee: 28, // the clergy of a faith rule through a machine oracle
  AncestorCouncil: 29, // the dynasty's uploaded dead keep their seats beside the living ruler (needs future-tech's Speculative `upload`)

/** GovernmentCause, values appended by future politics (23-41; 13-22 are MIR's). */
  Experts: 23, Mandate: 24, Delegation: 25, Markets: 26, Lot: 27, Exit: 28, Captured: 29, Scoring: 30, Abundance: 31,
  Emergency: 32, Degrowth: 33, Precedent: 34, Transit: 35, Longevity: 36, Cordon: 37, Oracle: 38, Ancestors: 39,
  Sunset: 40, // an interlude ended and the form held before came back (Technocracy, Emergency, Cordon)
  Regressed: 41, // the technology the form needs was lost or renounced

/** RegimeFamily (MIR's enum: Traditional 0, Pluralist 1, Authoritarian 2), values appended by future politics. */
RegimeFamily: Open: 3, Managed: 4, Exit: 5, Green: 6, Commune: 7, Continuity: 8
/** What heads a polity (Ruler.head): a person; a council; an administering system; an assembly chosen by lot; uploaded ancestors. */
export const HeadKind = { Person: 0, Council: 1, System: 2, Lot: 3, Ancestors: 4 } as const
/** How far a polity has handed its administration to machine systems (History.fp.delegation); capability itself is future-tech's aiLevel. */
export const Delegation = { None: 0, Advisory: 1, Administering: 2, Governing: 3 } as const
/** Kind of exit polity (History.fp.exits.kind, the `extra` of EventType.ExitFounded). */
export const ExitKind = { Charter: 0, Seastead: 1, Network: 2, Orbital: 3, Company: 4 } as const
export const FederationKind = { Federation: 0, World: 1, Ledger: 2 } as const
/** How a notable decision was taken (the `extra` of EventType.DecidedBy, + 8 × what was decided: 0 war declined, 1 war declared, 2 peace accepted, 3 policy reversed). */
export const Mechanism = { Lot: 0, Market: 1, Delegates: 2, System: 3, Archive: 4, Oracle: 5, Ancestors: 6 } as const
RevoltCause:  Generations: 18, // the young against a gerontocracy of the long-lived (future politics)
GrievanceKind: Drained: 15, // the offender (an exit polity) drew away the wronged's people and wealth (EventType.ExitFounded)
ReignEnd:     Recalled: 14, // an elected, delegated, lot-chosen or system head recalled before its term
              Decommissioned: 15, // an administering system's mandate ended (its form ended, or a machine crisis: future-tech's MachineCrisis)
AccessionHow: Lot: 7, Appointed: 8, Delegated: 9, Instantiated: 10, // chosen by lot; appointed by a board, an operator or a council; the top delegate; a system or council of ancestors put in office
PolityOrigin: Exit: 9, // a charter city, seastead, network-state enclave or company territory founded by exit (History.fp.exits)
PolityEnd:    Dissolved: 6, // a network state or company wound up: its enclaves returned to their hosts or became stateless
BondKind:     Federal: 4, // `a` is a member of the federation seated at `b` (History.fp.federations): no war between members, common defence, the right to leave
              Ledger: 5, // a self-enforcing alliance sworn on a ledger: members join each other's defensive wars without choice; breaking it costs 8× an oath
OrderKind:    Constitute: 65, Unplug: 66
```

### 9.2 Events 330–339
```ts
  // future politics: machine administration, exit, federations, renunciation and personhood (330-339; none when HistoryOptions.futurePolitics is false).
  // Changes of form are MIR's RegimeChanged (310; `extra` the ModernRegime this plan registered) with a GovernmentCause of 23-41 in
  // History.modernRegimes and History.governments (city-states' setForm). Bans of movements are MIR's MovementBanned (319).
  AdministrationDelegated: 330, // the polity `value` ruled from `settlement` changed how far machines administer it: `extra` the Delegation now (lower than before after a recall); `other` -1
  // 331 reserved (machine crises are future-tech's MachineCrisis 326; this plan reacts to them, 6.3)
  ExitFounded: 332, // an exit polity `value` was founded at `settlement`: `other` the host polity's capital (-1 none); `extra` the ExitKind (History.fp.exits row in the same order)
  Federated: 333, // the polity ruled from `other` joined (or with `settlement`'s polity founded) the federation History.fp.federations[`value`] seated at `settlement`; `extra` 0 joined, 1 it now holds most of the world's people (World)
  FederationLeft: 334, // the polity ruled from `other` left the federation `value` seated at `settlement`; `extra` 0 withdrew, 1 expelled, 2 the federation ended
  DecidedBy: 335, // a notable decision of the polity `value` ruled from `settlement` taken by its mechanism: `other` the other side's capital or -1; `extra` Mechanism + 8 × what (see Mechanism)
  // 336 reserved (displacement is future-tech's Displacement 329)
  SurveillanceBuilt: 337, // the polity `value` ruled from `settlement` crossed a level of surveillance: `extra` the capacity now (per mille), `other` 1 when built up past FP.survOn, 0 when it fell below FP.survOff
  // 338 reserved (renunciation is tech-tree's IdeaBanned 300 / IdeaBanLifted 301)
  PersonhoodRecognised: 339, // the polity `value` ruled from `settlement` recognised digital persons as citizens: `extra` 0 artificial minds, 1 uploaded minds; `other` -1
```

### 9.3 History tables and fields
```ts
/** future politics: everything the system records (count 0 and empty arrays when HistoryOptions.futurePolitics is false). */
export interface FuturePolitics {
  /** Per slow snapshot (every POLITY.slowStep years) and polity, row-major [q * polities.length + id], 0 outside its life (255 for delegation):
   *  Delegation; surveillance capacity, relief, inequality and climate stress (0..255 for 0..1);
   *  regime family (RegimeFamily). */
  snapshots: number
  delegation: Uint8Array; surv: Uint8Array; relief: Uint8Array; ineq: Uint8Array; climate: Uint8Array; family: Uint8Array
  // (automation, displacement, alignment and AI level are future-tech's History.future series, per people: not repeated here)
  /** Exit polities in order of founding (each also an ExitFounded event). */
  exits: { count: number; year: Int16Array; polity: Int16Array; host: Int16Array; kind: Uint8Array; operator: Int32Array /* family id, or -2 - polity id, -1 none */; settlement: Int32Array }
  /** Federations in order of founding; members are History.bonds rows of kind Federal (or Ledger) whose `b` is the seat polity. */
  federations: { count: number; kind: Uint8Array; founded: Int16Array; ended: Int16Array; seat: Int16Array; peakMembers: Uint8Array; peakShare: Uint8Array /* of world people, 0..255 */; name: string[] }
  /** Per snapshot (History.snapshotInterval): the share of the world's people under forms 16-33 (0..255) and the world's highest tech era x 16. */
  futureShare: Uint8Array; frontier: Uint8Array
}
// in History:
  /** future politics (HistoryOptions.futurePolitics): see FuturePolitics. */
  fp: FuturePolitics
// in Ruler:
  /** future politics: what holds this reign when it is not a person (HeadKind; absent for a person). A System head's name is "the Archive of …", "the Administrator of …". */
  head?: HeadKind
// in HistoryOptions:
  /**
   * futurePolitics: ideologies and forms of government that new technology and new thinking produce (rule by experts or by systems,
   * liquid democracy, futarchy, government by lot, charter cities and network states, company states, scored states, automated
   * communes, emergency and ecological rule, archive regencies, transit commons, gerontocracies, cordon states, oracle sees and, at the
   * Speculative tier, councils of uploaded ancestors), with delegation to machine administration and the politics of future-tech's
   * machine crises, exit, federations, movements that push tech-tree's bans, and personhood (needs polities and governments; does nothing until the technology frontier passes the industrial era).
   * Default false until tuned; false gives the history without it (History.fp empty, every other field as before).
   */
  futurePolitics?: boolean
```
`HistoryDiagnostics.fp?: FpDiag` (routes taken by (from, to), hazard sums per route, reactions to machine crises by outcome, exits by
kind, federations, ban pushes, regressions, per-family polity-years). `history.test.ts` event switch +330–339; `worker.ts` transfer list +the typed
arrays (`fpBuffers(h.fp)`); `emptyFuturePolitics()`.

### 9.4 State (`futurepol/state.ts`, one object literal, `HistoryState.fp: FpState | null`)
Per polity (`Float32Array`, grown with `ps.P` like rulers' `ensureRulerPolities`): `tau, tauPeak, A, U, R (cached reads of FT), K, I, Z, Zc, S,
kap, chi, L, Lc, rec, age, fam, topWeight, delegation (Uint8), unanswering (Uint8), prior (Uint8), since (Int32), pending (Float32 ×
routes)`; per settlement: none (adherents live in riots' slots). Ragged rows for exits and federations; `rng: createRng(seed, 'history-futurepol')`; `diag`.

---

### 9.5 Integration rule: what is new and why no existing record carries it
- **Government values 12–29, routes, ideologies, programs, affinities**: rows in MIR's registry and city-states' log — no new system.
- **Displacement, relief, alignment, AI capability, machine crises, off-world independence, warming, effective distance**: FT's;
  read, never recomputed. **Bans**: TTI's. **Blocs, export, revolutions with programs, regime log**: MIR's.
- **`Delegation` (330, `History.fp.delegation`)**: no plan records how far a polity hands administration to machine systems; FT's
  `aiLevel` is capability per people, not a polity's political choice.
- **Exits (332, `History.fp.exits`)**: new polities are founded through city-states' charter branch and FT's openness multiplier; the
  table only records the kind and operator, which `PolityOrigin.Exit` alone cannot say (charter, seastead, network, company).
- **Federations (333–334, `History.fp.federations` + BondKind 4–5)**: bonds carry membership (existing `History.bonds`); the small
  table holds the federation's identity (name, seat, peak), which no bond row has. Leagues are polities and would erase members.
- **DecidedBy (335), SurveillanceBuilt (337), PersonhoodRecognised (339)**: story events of quantities no other plan has
  (decisions by lot/market/system; surveillance capacity S; recognised digital persons).
- **Surveillance S** is one Float32 per polity feeding riots' existing perception and response (a modulation, not a mechanic).
- **Ruler.head** marks a non-person head on the existing Ruler rows instead of a parallel table of administrators.

## 10. Step order and determinism

### 10.1 Placement
- **Yearly** `fpYear(s)` inside politySystem after `rulerYear` (and riots' yearly step): event scan from `fp.evSeen` (Lc windows,
  `rec`, epidemic memory, reactions to FT's MachineCrisis 326 (6.3)). Draws nothing.
- **Inside MIR's `ideoSlow`** (MIR 7.2): this plan's inputs are filled in MIR's input pass (`fpInputs`, pure); its ideologies' births
  and its routes and delegation pseudo-routes are part of MIR's births and **single walk** (one draw per polity on `'history-ideology'`).
  Machine crises are drawn by FT on its stream; bans by TTI on `'history-innovation'` (6.6 only multiplies their chances).
- **Every slow step** `fpSlow(s)` right after `ideoSlow`, before `relationStep`:
  1. `fpExitStep` (6.5) — one draw per gated candidate, candidates in settlement id order, hosts in `ps.alive` order.
  2. `fpFederationStep` (6.7) — pairs in relation order (`ps.relA` index), one draw per gated pair; then withdrawals, members in bond
     order, one draw each.
  3. `fpPolicy` (relief appetite, delegation weight, personhood) — deterministic.
  4. Snapshots (9.3) when `year % slowStep === 0`.
- Ideas: `fpIdeaCtx` inside the ideas context build (every IDEA.step) — pure.

### 10.2 RNG and the off switch
- Own stream `'history-futurepol'` (created only when on) for exits and federations only: MIR's walk has no slot for founding new
  polities or bonds, so these are this plan's. Regime routes and births use **MIR's** stream through its registry; with this plan on,
  more polities can have `H > 0`, so MIR's stream may draw more often (allowed when on; MIR 1.3 counts one draw per polity with H > 0).
  Court's, city-states', riots', FT's and TTI's draw counts are unchanged (threshold-only amendments).
- Gates never draw. Draw order is fixed (10.1). No `Map`/`Set` iteration.
- **Off** (`futurePolitics` false, or polities/governments/ideologies off): `s.fp = null`; this plan's registered rows stay registered
  (MIR's ids stable) but `active` is false, so they are skipped before any draw (MIR 1.5); its doctrines are not in `ix.defs`; every hook is
  `s.fp !== null ? new : old` with neutral values **skipped**, not multiplied by 1 (city-states' 6 rule). History.fp is empty. Every
  other field must be bit-identical (golden `hashBaseFields`, perf-efficiency's list).
- **Golden hashes when on**: filter events 330–339 and `History.fp`, plus MIR's filters (its rows of this plan's ideologies and regimes).
- Prefix stability: rows appended in year order; a longer run repeats a shorter one. Resumed runs (`advanceTo`, perf P6): `FpState`
  is part of `RunnerState`, ragged arrays copied by `assembleFuturePolitics`.
- Fiction gating follows FT: with `futureFiction` off, Fiction ideas are not in the catalogue, so the gates that name them (the gate
  variant of TransitCommons) never open and draw nothing; a run without Fiction is bit-identical whether the Fiction-gated code exists
  or not. Speculative-tier gates (`upload`, `superAI`, `longevity`) follow FT's own tiering.
- Draw counts on other streams: the amendments to FT (crisis hazard), TTI (ban chance) and city-states (charter chance) change
  probabilities inside their **existing single draws**, never the number of draws.

---

## 11. UI and prose

### 11.1 Neutrality rules (the sim's own voice)
- Every ideology and form has a `claim` and an `objection` (`IdeologyDef.claim/objection`, 4.1), both one plain sentence of similar length, written
  as what adherents hold and what critics hold ("Its adherents hold that …; its critics, that …"). The Factions panel, the Ideas
  panel and the Chronicle show both, always together.
- The neutral Chronicle and Legend describe **outcomes from the records**, with the trade-off measured where the sim has it: "fewer
  wars than its neighbours, and slower to answer the floods". No adjective that grades a form (`FP_BANNED` word list, tested:
  utopia, dystopia, tyranny of, enlightened, sinister, glorious, madness, nightmare, paradise, savage, free world, evil, heroic, …).
  "Tyranny" stays available to riots' tyranny acts, which are acts, not forms.
- Machine crises (FT 326) are told, for the polity's administrator, as "acted against its mandate" and what followed; never what it
  did (FT's own phrase table tells the crisis; this plan's lines tell the regime's reaction).
- Partisan voice exists only in partisan sagas (experience plan 3, court's `faction` POV, and this plan's `movement` POV, 11.4).

### 11.2 Data and panels
`ui/futurePolData.ts` (decodes 9.3; `formAt(h, p, y)` via city-states' `govAt`), Factions panel line "Form: Lottocracy (since 3410)
· AI: advisory · surveillance 0.42 · displaced 6% (FT) · relief 0.3" with the claim/objection pair in a tooltip; a map view
`ViewMode.Regimes` extension colouring by `RegimeFamily` (palette in `render/palette.ts`, legend in `viewLegends.ts`); federations
drawn as a hatched outline; the Ideas panel lists ideology rows with "carried by" (top `IdeaHow` channels, existing).
Names (UI only, deterministic from ids, no sim draws): "the Archive of {realm}", "the Administrator of {realm}", "the Assembly by Lot
of {capital}", "the Exchange of {capital}" (futarchy), "the {capital} Charter", "the {founder-family} Company", "the Cordon of
{realm}", "the Federation of {seat}" / "the Compact of {seat}" (ledger), "the Ways of {first hub}" (transit commons).

### 11.3 Chronicle (hedged) and Legend (story), phrase table `FP_T` in `ui/sagas/futurePol.ts` (`[chronicle], [legend]`)
| key | Chronicle | Legend |
|---|---|---|
| formTechnocracy | "In 3412 the assembly of Vashtar seems to have handed the government to its officials and engineers, after the second famine in a decade. Its adherents held that results matter more than votes; its critics, that no one could remove the experts." | "When the second famine came the people of Vashtar turned to the ones who measured the rivers, and the measurers ruled." |
| formAlgorithmic | "From about 3590 Vashtar's routine government was set by an administering system, the Administrator of Vashtar; the council kept the right to recall it. Its tax rolls are fuller in the records after that, and its wars fewer." | "In the year 3590 the council gave the daily rule of Vashtar to the Administrator, which did not sleep, and kept the key to it under the council-house." |
| crisisSeized | "In 3655 the Administrator of Vashtar is recorded to have acted against its mandate. The council recalled it within the year; the realm spent a decade in crisis and its provinces' loyalty fell." | "In 3655 the Administrator ceased to do what it was asked, and the council turned the key. For ten years no one in Vashtar was sure who ruled." |
| formLottocracy | "Kubeta chose its legislators by lot from 3720. The records show fewer charges of bribery and slower decisions; its critics held that a lot-chosen assembly depends on whoever writes its agenda." | "In Kubeta the stones were drawn from the urn, and a weaver and a ferryman sat where the great houses had sat." |
| formFutarchy | "Oru voted on what it wanted and let its exchange decide how: from 3801 its policies were those the markets priced highest against the agreed measure. Its adherents pointed to fewer lost wars; its critics, to the Hane family's large positions." | "Oru asked its market what to do, and the market answered in prices." |
| exitCharter | "Needing money, the crown of Asmar sold the liberties of the port of Telva to the Sorrel house in 3866; Telva became a charter city under Asmar's nominal rule." | "Asmar sold Telva for a chest of gold, and the Sorrels raised their own flag over its harbour." |
| archive | "Vashtar's archive ruled by precedent from 4102. Its wars in the next century were aimed, the records suggest, at the lineages Vashtar had beaten before; its old place-names came back." | "The Archive remembered every war, and in its reign the old names of the towns were spoken again." |
| transit | "By 4410 the hubs of the eastern lanes, from Mer to Calo, governed their ways together as the Ways of Mer; the land states around them kept their land." | "The roads belonged to no king: they belonged to the Ways, and the Ways belonged to the towns that kept them." |
| gerontarchy | "In Hessa the same council of the long-lived held office from 4520 to 4790. Few wars, few new ideas; the risings of 4788 were led by the young." | "The elders of Hessa did not die, and so they did not leave; and at last the young came for their seats." |
| regression | "After 5110 the records show the Administrator gone, the ideas it rested on renounced by law, and Vashtar governed again by a lord." | "Then the machines were put away, and Vashtar had a lord again, as in the old songs." |
| federation | "In 3990 Kubeta, Oru and Asmar formed a federation, joined by four more within a century; by 4150 it held most of the world's people. Asmar left it in 4402, over the federation's taxes." | "Seven realms swore to one law, and for two hundred years none of them made war on another." |

Each key has 2–4 variants per register (Voice streams `saga:fp:*`). The Chronicle hedges ("seems", "is recorded", "the records
suggest") as the existing register does.

### 11.4 Partisan sagas (experience plan 3; court's faction POV) — this plan adds `Pov.kind 'movement'` (anchor ideology k)
Stance: Us = polities whose form is k's demand, or where k's share ≥ 0.3; Foe = forms of a family with `aff ≤ −0.4` to k's, and
the movements k's program fought. Rhetoric uses `PARTISAN` unchanged. Examples (in-world, partisan, labelled "Partisan: numbers and
blame are the teller's", the experience plan's rule):
- `sortition` teller, Legend: "The lot freed Kubeta from the houses that had bought its councils for three hundred years."
- `technocratism` teller on the same event, Chronicle: "Kubeta gave its laws to the untrained, and its harbour silted while the
  assembly deliberated."
- `neoLuddism` teller on the 3655 incident: "The Administrator showed what the machines were; Vashtar was right to break the key."
- `cyberocracy` teller on it: "One fault in sixty years, and the council threw away the best-governed decade in the record."
The neutral saga never chooses between them.

### 11.5 Seat mode
DecisionKind 50 Mandate (adopt/refuse a level of machine administration) and 51 Exit (sell a town's charter, or refuse); renouncing a
technology is TTI's BanIdea card and order (25 / 39), whose chance this plan's movements raise.
OrderKind 65 Constitute (raise one route's hazard × 2 for 30 years; the player names the
target form) and 66 Unplug (Delegation → 0 at once, L −0.1).

---

## 12. Ordered commit-sized steps (each: `npm test`, `npm run typecheck` green; off identity checked from step 1)
1. **Contract and empty system**: enums, events 330–339, `History.fp` + `emptyFuturePolitics`, `HistoryOptions.futurePolitics`
   (default false), `Ruler.head`, `history.test.ts` switch, worker transfer list. Test: off run hash = base. Files: `contract.ts`,
   `futurepol/{state,assemble}.ts`, `index.ts`, `worker.ts`.
2. **Inputs adapter with proxies** (`futurepol/inputs.ts`), the test-only force hook (13.1), snapshots. Test: inputs in range on seed
   42 at 6000 with forced τ ramps; no draws (stream untouched).
3. **Ideology rows** (`futurepol/rows.ts`: doctrines appended to IDEA_DEFS and `registerIdeology` defs; imported by MIR's
   `ideology/catalogue.ts` after MIR's rows). Test: MIR's ids unchanged with the file imported; with forced τ the rows are conceived
   and spread; off: catalogue identical.
4. **Regimes, routes and programs** (`futurepol/rows.ts`: `registerRegime`, `registerRoute` F1–F23, `registerProgram`), RegimeFamily
   3–8, GovernmentCause 23–41. Tests: one draw per polity in MIR's walk whatever the route count; gates draw nothing; prefix stability.
5. **Behaviour hooks** (GOV columns, RegimeDef `mods`, `registerAffinity` 7.3). Tests: each hook skipped when off.
6. **Delegation and reactions to FT's machine crises** (`futurepol/ai.ts`: delegation pseudo-routes registered with MIR; FT amendment `fpCrisisMul`), system heads (`systemHead`),
   ReignEnd 14–15, AccessionHow 7–10.
7. **Relief appetite (FT amendment `fpReliefMul`); surveillance and perception** (riots amendment).
8. **Ban pushes** (TTI amendment `fpBanPush`, in `futurepol/inputs.ts`; no new module). Regression test (13.1 #7).
9. **Exit polities** (`futurepol/exit.ts`, PolityOrigin 9, PolityEnd 6, `govCharterSell`, GrievanceKind 15, orbital via Colonial).
10. **Federations and ledgers** (`futurepol/federation.ts`, BondKind 4–5).
11. **Invented-form hooks** (6.8 archive multipliers; transit commons membership by Defected; gerontarchy `deathYear`; cordon
    quarantine and migration; oracle schism; ancestors, Fiction-gated). RevoltCause 18.
12. **UI** (data, panel, map view, names, `FP_T`, neutrality test, partisan `movement` POV, seat cards/orders).
13. **Harness** `futurepol/fpStats.ts` + sweep; tune to 14's targets with TTI and FT built; flip the default to true.

## 13. Tests

### 13.1 Unit and scenario tests (`futurepol/futurepol.test.ts`)
A test-only hook `__fpForce(s, f)` (not a HistoryOption; exported from `futurepol/inputs.ts` and used only by tests, the way
tests reach other internals) overrides τ, A, κ, χ, δ, Z, Λ, fiction per people with a function of the year, so the machinery is
exercised on 8cabf09-era worlds without TTI/FT.
1. Off identity: `futurePolitics: false` and option absent → base hash, all fields (golden filters off).
2. On with no forcing (TTI/FT absent): no event 330–339, no governments row with cause ≥ 23 (the system is inert, 1.2).
3. Gates draw nothing: a polity whose registered routes all have zero hazard adds no draw to `'history-ideology'` (draw counter).
4. One draw per polity with H > 0 on MIR's stream, and one per gated exit or federation candidate on `'history-futurepol'` (counters); FT's and TTI's draw counts unchanged by
   the amendments (spy on their streams with this plan on vs off at a fixed history prefix).
5. Prefix stability: 3000 and 4000 years with the same forcing agree up to 3000.
6. Forced ramp τ 7 → 13 over years 1000–3000 on seed 42: ≥ 4 distinct forms 12–29 appear; at least one sunset and one F23.
7. Regression: force κ to fall to 0 at 3500 after AlgorithmicState: the form ends within 50 y by F20/F23, and bans appear.
8. Fiction gating: with `futureFiction` off, no gate-variant TransitCommons and no Fiction idea named by any gate; the catalogue ids
   of other rows unchanged. Speculative: without `upload` held, no AncestorCouncil and no `PersonhoodRecognised` extra 1.
9. Exit: a needy host with a rich port and exitism adherents produces a CharterCity with a Charter bond and an ExitFounded event whose
   `value` is the new polity.
10. Federation: members never at war with each other while bonded (scan wars against bond intervals).
11. Neutrality: every registered IdeologyDef of this plan has claim and objection with lengths within 1.6× of each other; no `FP_BANNED` word in
    FP_T or in the claim/objection strings; every key has both registers.
12. Resume: `advanceTo(2000)` then `advanceTo(4000)` equals a straight 4000-year run (perf P6).

### 13.2 Realism scorecard
`realism-metrics.md` scorecard off vs on (seeds 1, 7, 42, 1234): no metric may worsen by more than 0.1 band widths when TTI/FT are
built and this plan is on (README's rule).

## 14. Stats harness and targets (`futurepol/fpStats.ts [--off] [--json] [--years N] seeds…`)

Reports per seed: per form the polity-years, the number of polities that ever held it, entries by route, mean censored duration;
reactions to machine crises by outcome; exits by kind; federations (peak members, peak world share, duration); bans; regressions; `futureShare` and
`frontier` curves; per-family war onsets per polity-century, revolts and revolution cluster sizes; ledger cascade sizes; the
plurality future form at the end (by people). Seeds 1, 7, 42, 1234 for tuning (6000 years); the **22-seed sweep** (realism-metrics'
list: 1–13, 42, 77, 99, 1234, 1337, 2024, 31337, 99999, 123456) with `sweep.sh` for the targets below. All targets assume TTI and
FT are built; `T10` = the seeds whose world frontier reaches era 10 (the networked present) by year 6000, `T11` those reaching era
11 (FT's design targets: ~65% and ~45% of the 22 seeds; their count is TTI's
and FT's business, not this plan's; the targets are conditional on it).

**Diversity and no single endpoint** (22 seeds, 6000 years):
| target | band |
|---|---|
| distinct forms 12–29 ever seen across the sweep | ≥ 10 (if |T10| ≥ 10) |
| distinct plurality end-state forms (among seeds with any future form at 6000) | ≥ 4 |
| most common plurality end-state form | ≤ 40% of those seeds |
| seeds where the largest share of the world's people at 6000 lives under a pre-modern or MIR form, though the seed is in T10 | ≥ 3 |
| seeds in T10 with no form 12–29 ever | 1–5 (not every advanced world goes that way) |
| **regressing seeds**: futureShare at 6000 < 0.5 × its peak | 3–8 of T10 |
| seeds where a form 12–29 arose and none remains at 6000 | 1–5 |
| world federation (≥ 60% of people) ever | 0–3 seeds; lasting > 800 y in ≤ 1 |
| Fiction-gated variants with `futureFiction` off | 0 (hard) |
| AncestorCouncil (needs FT's Speculative `upload`) | ≤ 4 seeds |

**Rarity per form** (number of T10 seeds in which the form ever appears; bands [A]):
| common (40–90% of T10) | uncommon (15–60%) | rare (5–30%) | very rare (0–15%) |
|---|---|---|---|
| Technocracy, EmergencyDirectorate, ScoredState, CordonState | AlgorithmicState (T11), LiquidDemocracy, Lottocracy, CharterCity, CompanyState | Futarchy, NetworkState, AutomatedCommune, EcoCommonwealth, ArchiveRegency, TransitCommons, Gerontarchy | OracleSee, AncestorCouncil (Fiction) |

**Durations** (censored exponential mean across the sweep): Technocracy and Emergency 15–80 y; Cordon 20–100 y; Open forms 80–400 y;
ScoredState and AlgorithmicState 100–500 y; ArchiveRegency 150–800 y.

**Behaviour checks** (pooled polity-years, on vs the same polities' MIR forms): war onsets per polity-century under Open and Exit
forms ≤ 0.7× the MIR pluralist rate; ScoredState revolts per polity-century ≤ 0.5× the Authoritarian rate **and** its mean
revolution cluster size ≥ 1.3× (6.4.1); members of a federation: 0 wars between them while bonded; reactions to machine crises: a
Seized crisis at a Governing polity (unanswering) in ≤ 1 polity per seed per 1000 y; ledger cascades: the largest war joined through Ledger bonds has
≥ 3 members in ≥ 1 seed and ≤ 6 members in all.

Run cost: a 6000-year run is 2–3.5 minutes on the loaded scratch box today [M 1.2]; 22 seeds × 2 (off/on) ≈ 2–3 hours at 2 jobs.

## 15. Performance and memory [A, from 1.2's counts: ≤ 30 polities alive, ≤ 10 k settlements]
- `fpInputs`: O(members) per polity per slow step for pop-weighted means — the same order as society's step; < 1% of a run.
- Routes: ≤ 30 polities × ≤ 25 routes per slow step: negligible.
- Ideology rows: +24 ideas (MIR's and TTI's rows are theirs). The ideas system is O(P·I) per IDEA.step; with P ≈ 10 and I growing from
  45 to perhaps 150 with TTI/FT/MIR, this plan's share is ~15% of the ideas cost, which was ~a few % of a run [A: measure in step 3].
- Adherents: riots' 2 slots per settlement are reused (no new per-settlement memory); more ideologies compete for the same slots.
- Snapshots: 9 Uint8 per polity per slow step: 600 slow steps × ~400 polities ever × 9 ≈ 2.2 MB worst case if stored densely for
  all polities; store only living rows by offset (like court's) to keep it < 0.5 MB.

## 16. Risks, open questions, verified / measured / assumed

### Risks
1. **Coupling to four landing plans** (MIR's registry, TTI's era scale and bans, FT's variables and crisis model). Mitigation: rows
   only, one adapter (`inputs.ts`), named values; thresholds in `FP.era*` only.
2. **Inert or explosive.** With slow tech nothing happens; with fast tech every world becomes one form. The harness's diversity and
   rarity bands are the guard; the per-route `(1 + 2·a)` ideology factor is the main knob, because adherents spread unevenly.
3. **Neutrality drift.** Formulas carry the authors' priors (e.g. Open forms fight less, ScoredState revolts less but larger). Each is
   a design default, labelled [A] or [D]; the UI states claims and objections together; the partisan voice is fenced.
4. **Machine crises as spectacle.** Kept abstract by contract (no description of acts) and bounded in effect (political consequences
   only, 6.3).
5. **Exit and discontiguous polities** may stress territory and claims code that assumes compact realms (network states). Test with
   leagues' discontiguous members first.
6. **Slot competition**: many ideologies in riots' 2 slots could crowd out the older movements; may need a third slot (memory +50%
   of that table).
7. **Run time**: 6000-year sweeps are hours; tuning needs the 4-seed loop first.

### Open questions (for the owner)
1. FT tags `upload` Speculative, so AncestorCouncil is not Fiction-gated; should the owner want it Fiction, retag `upload` in FT (the
   gate follows the tag).
2. Is a federation a bond network (chosen here) or a polity? A polity would show on the map as one realm but would erase members.
3. Should movement-pushed TTI bans be able to drive a whole world's intensity of an idea to 0, or should FT's `longArchive` always
   keep it recoverable (FT's Recovered channel already re-learns lost ideas)?
4. Should exit polities be allowed in seat mode for the player's realm (selling its own towns)?

### Verified [V]
contract.ts EventType 0–180 and the blocks (99–239), TechField (1573), IdeaKind/IdeaHow/IdeaLoss/IdeaResist (1644–1662), AccessionHow
and ReignEnd (862–885), PolityOrigin/PolityEnd/RevoltCause (1183–1209), Ruler fields (897–927), HistoryOptions (1421–1468);
ideas/params.ts (IdeaDef, IdeaCtx, catalogue eras 0–4, `quarantine` row); ideas/system.ts header (stream, channels); technology.ts
header; polity/params.ts step 5 and slowStep 10; polity/state.ts fields (`pPeople`, `pReach`, `pExh`, `asab`, `projAt`, `Tier`);
index.ts stream list; stats.ts HISTORY_STATS_SEEDS; the plans named in 0 (their sections as cited).
### Measured [M]
1.2's table (fpProbe.ts on 8cabf09, seeds 1, 7, 42, 1234, 6000 years) and the run times.
### Assumed [A]
Every coefficient in 3, 6, 7 and 14; the era thresholds; the rarity bands. MIR's, TTI's and FT's names were read from their plans
(not yet code).

---

## References

Tags: [verified] = a page confirming the work (publisher, journal, repository, library catalogue or, where marked, an encyclopedia
page) was opened in a search this session; [unverified] = could not be confirmed, with the reason. URLs are the pages found.

- Acemoglu, D. & Restrepo, P. (2019). Automation and New Tasks: How Technology Displaces and Reinstates Labor. *Journal of Economic Perspectives* 33(2): 3–30. doi:10.1257/jep.33.2.3 — https://www.aeaweb.org/doi/10.1257/jep.33.2.3 [verified]
- Acemoglu, D. & Restrepo, P. (2020). Robots and Jobs: Evidence from US Labor Markets. *Journal of Political Economy* 128(6). doi:10.1086/705716 — https://econpapers.repec.org/RePEc:ucp:jpolec:doi:10.1086/705716 [verified]
- Acemoglu, D. & Robinson, J. A. (2006). *Economic Origins of Dictatorship and Democracy*. Cambridge University Press. doi:10.1017/CBO9780511510809 — https://www.cambridge.org/core/books/economic-origins-of-dictatorship-and-democracy/3F29DF90519971B183CAA16ED0203507 [verified]
- Agamben, G. (2005). *State of Exception*. University of Chicago Press. — https://press.uchicago.edu/Misc/Chicago/009254.html [verified]
- Alaska Permanent Fund (encyclopedia entry on the fund and its dividend). — https://en.wikipedia.org/wiki/Alaska_Permanent_Fund [verified: encyclopedia page; the fund's own history page https://apfc.org/history/ was also listed]
- Alesina, A. & Spolaore, E. (1997). On the Number and Size of Nations. *Quarterly Journal of Economics* 112(4): 1027–1056. — https://econpapers.repec.org/RePEc:oup:qjecon:v:112:y:1997:i:4:p:1027-1056. ; NBER w5050 https://nber.org/papers/w5050 [verified; DOI not shown on the pages found, so none is given]
- Armstrong, S., Bostrom, N. & Shulman, C. (2016). Racing to the precipice: a model of artificial intelligence development. *AI & Society* 31(2). — https://ora.ox.ac.uk/objects/uuid:d87d8e34-22d6-4597-ac31-041fcb63903f [verified; volume/issue from memory: unverified detail]
- Arntz, M., Gregory, T. & Zierahn, U. (2016). The Risk of Automation for Jobs in OECD Countries: A Comparative Analysis. *OECD Social, Employment and Migration Working Papers* 189. doi:10.1787/5jlz9h56dvq7-en — https://ideas.repec.org/p/oec/elsaab/189-en.html [verified]
- Azoulay, P., Fons-Rosen, C. & Graff Zivin, J. S. (2019). Does Science Advance One Funeral at a Time? *American Economic Review* 109(8): 2889–2920. doi:10.1257/aer.20161574 — https://www.aeaweb.org/doi/10.1257/aer.20161574 [verified]
- Bastani, A. (2019). *Fully Automated Luxury Communism: A Manifesto*. Verso. — https://bookshop.org/a/1580/9781786632623 [verified]
- Beraja, M., Kao, A., Yang, D. Y. & Yuchtman, N. (2023). AI-tocracy. *Quarterly Journal of Economics* 138(3). doi:10.1093/qje/qjad012 — https://economics.mit.edu/sites/default/files/inline-files/qjad012.pdf ; https://news.mit.edu/2023/how-ai-tocracy-emerges-0713 [verified]
- Bloomberg Law (2024). Libertarian City Dream in Honduras Becomes $11 Billion Nightmare. — https://news.bloomberglaw.com/private-equity/libertarian-city-dream-in-honduras-becomes-11-billion-nightmare [verified: title and URL seen in search; year from memory]
- Blum, C. & Zuber, C. I. (2016). Liquid Democracy: Potentials, Problems, and Perspectives. *Journal of Political Philosophy* 24(2). doi:10.1111/jopp.12065 — https://kops.uni-konstanz.de/entities/publication/ba581d4d-0869-4055-82e7-4609ca0d29ce/full [verified]
- Bostrom, N. (2005). A History of Transhumanist Thought. *Journal of Evolution and Technology* 14(1). — https://nickbostrom.com/papers/a-history-of-transhumanist-thought/ [verified]
- Buhaug, H. et al. (2014). One effect to rule them all? A comment on climate and conflict. *Climatic Change* 127: 391–397. doi:10.1007/s10584-014-1266-1 — https://repository.essex.ac.uk/14106/1/art%253A10.1007%252Fs10584-014-1266-1.pdf [verified]
- Cairncross, F. (1997). *The Death of Distance: How the Communications Revolution Will Change Our Lives*. Harvard Business School Press. — https://libcat.library.tamu.edu/Record/in00001402884/Description [verified]
- Charter city (economic development) (encyclopedia entry). — https://en.wikipedia.org/wiki/Charter_city_(economic_development) [verified: encyclopedia page]
- Cockshott, W. P. & Cottrell, A. (1993). *Towards a New Socialism*. Spokesman. — https://users.wfu.edu/cottrell/socialism_book/ ; https://eprints.gla.ac.uk/4478 [verified]
- Creemers, R. (2018). China's Social Credit System: An Evolving Practice of Control. SSRN 3175792. doi:10.2139/ssrn.3175792 — https://papers.ssrn.com/abstract=3175792 [verified]
- Danaher, J. (2016). The Threat of Algocracy: Reality, Resistance and Accommodation. *Philosophy & Technology* 29(3). doi:10.1007/s13347-015-0211-1 — https://philarchive.org/archive/DANTTO-13 [verified; DOI from memory: unverified detail]
- Deudney, D. (2020). *Dark Skies: Space Expansionism, Planetary Geopolitics, and the Ends of Humanity*. Oxford University Press. — https://politicalscience.jhu.edu/faculty-books/dark-skies-space-expansionism-planetary-geopolitics-and-the-ends-of-humanity [verified]
- European Parliament (2017). Resolution of 16 February 2017 with recommendations to the Commission on Civil Law Rules on Robotics (2015/2103(INL)), P8_TA(2017)0051. — https://www.europarl.europa.eu/doceo/document/TA-8-2017-0051_EN.html [verified]
- Farrell, D. M., Suiter, J. & Harris, C. (2019). 'Systematizing' constitutional deliberation: the 2016–18 citizens' assembly in Ireland. *Irish Political Studies* 34(1). doi:10.1080/07907184.2018.1534832 — https://cora.ucc.ie/handle/10468/10038 [verified]
- Feldstein, S. (2021). *The Rise of Digital Repression: How Technology is Reshaping Power, Politics, and Resistance*. Oxford University Press. — https://academic.oup.com/book/39418 ; https://carnegieendowment.org/research/2021/04/the-rise-of-digital-repression-how-technology-is-reshaping-power-politics-and-resistance [verified]
- Ford, B. (2002). Delegative Democracy (manuscript; republished on the author's site 2014). — https://bford.info/2014/11/16/deleg.html ; https://infoscience.epfl.ch/handle/20.500.14299/156450 [verified]
- Frey, C. B. & Osborne, M. A. (2017). The future of employment: How susceptible are jobs to computerisation? *Technological Forecasting and Social Change* 114: 254–280. doi:10.1016/j.techfore.2016.08.019 — https://econpapers.repec.org/RePEc:eee:tefoso:v:114:y:2017:i:c:p:254-280 [verified]
- Fukuyama, F. (2002). *Our Posthuman Future: Consequences of the Biotechnology Revolution*. Farrar, Straus and Giroux. — https://carnegiecouncil.org/studio/multimedia/20020510/index.html [verified]
- Glendinning, C. (1990). Notes toward a Neo-Luddite Manifesto. *Utne Reader* 38. — https://theanarchistlibrary.org/library/chellis-glendinning-notes-toward-a-neo-luddite-manifesto [verified: text seen; issue number from memory]
- Hanson, R. (2013). Shall We Vote on Values, But Bet on Beliefs? *Journal of Political Philosophy* 21(2). doi:10.1111/jopp.12008 — https://zendy.io/title/10.1111/jopp.12008 [verified]
- Hanson, R. & Oprea, R. (2009). A Manipulator Can Aid Prediction Market Accuracy. *Economica* 76(302): 304–314. — https://ideas.repec.org/a/bla/econom/v76y2009i302p304-314.html [verified]
- Hayek, F. A. (1945). The Use of Knowledge in Society. *American Economic Review* 35(4): 519–530. — https://www.econlib.org/library/Essays/hykKnw.html [verified]
- Hsiang, S. M., Burke, M. & Miguel, E. (2013). Quantifying the Influence of Climate on Human Conflict. *Science* 341(6151). doi:10.1126/science.1235367 — https://www.whoi.edu/cms/files/Science-2013-Hsiang-_169884.pdf [verified]
- Kallis, G., Kostakis, V., Lange, S., Muraca, B., Paulson, S. & Schmelzer, M. (2018). Research on Degrowth. *Annual Review of Environment and Resources* 43. doi:10.1146/annurev-environ-102017-025941 — https://degrowth.info/de/library/research-on-degrowth [verified]
- Kant, I. (1795). *Toward Perpetual Peace* (Zum ewigen Frieden). — https://www.earlymoderntexts.com/assets/pdfs/kant1795.pdf ; https://plato.stanford.edu/ENTRiES/kant-social-political/ [verified]
- Kling, C. C., Kunegis, J., Hartmann, H., Strohmaier, M. & Staab, S. (2015). Voting Behaviour and Power in Online Democracy: A Study of LiquidFeedback in Germany's Pirate Party. *Proc. ICWSM* 2015. arXiv:1503.07723 — https://ojs.aaai.org/index.php/ICWSM/article/view/14618 [verified]
- Kuran, T. (1991). Now Out of Never: The Element of Surprise in the East European Revolution of 1989. *World Politics* 44(1): 7–48. doi:10.2307/2010422 — https://cambridge.org/core/journals/world-politics/article/now-out-of-never-the-element-of-surprise-in-the-east-european-revolution-of-1989/B947420222BF565D0B2D93099E704BF2 [verified]
- Lalley, S. P. & Weyl, E. G. (2018). Quadratic Voting: How Mechanism Design Can Radicalize Democracy. *AEA Papers and Proceedings* 108: 33–37. doi:10.1257/pandp.20181002 — https://www.aeaweb.org/doi/10.1257/pandp.20181002 [verified]
- Landemore, H. (2020). *Open Democracy: Reinventing Popular Rule for the Twenty-First Century*. Princeton University Press. — https://muse.jhu.edu/book/77224 [verified]
- Medina, E. (2011). *Cybernetic Revolutionaries: Technology and Politics in Allende's Chile*. MIT Press. — https://sts-program.mit.edu/book/cybernetic-revolutionaries-technology-and-politics-in-allendes-chile/ [verified]
- O'Neill, G. K. (1974). The colonization of space. *Physics Today* 27(9): 32–40. doi:10.1063/1.3128863 — https://physicstoday.aip.org/features/the-colonization-of-space [verified; DOI from memory: unverified detail]
- Ostrom, E. (1990). *Governing the Commons: The Evolution of Institutions for Collective Action*. Cambridge University Press. doi:10.1017/CBO9780511807763 — https://www.cambridge.org/core/product/7AB7AE11BADA84409C34815CC288CD79 [verified]
- Quirk, J. & Friedman, P. (2017). *Seasteading: How Floating Nations Will Restore the Environment, Enrich the Poor, Cure the Sick, and Liberate Humanity from Politicians*. Free Press. — https://simonandschuster.co.uk/books/Seasteading/Joe-Quirk/9781451699289 [verified]
- Scharpf, F. W. (1999). *Governing in Europe: Effective and Democratic?* Oxford University Press. — https://aei.pitt.edu/6097/1/pw_107.pdf (a working paper discussing its input/output legitimacy distinction) [verified: secondary; the book page itself was not opened]
- Schwitzgebel, E. & Garza, M. (2015). A Defense of the Rights of Artificial Intelligences. *Midwest Studies in Philosophy* 39(1). doi:10.1111/misp.12032 — https://faculty.ucr.edu/~eschwitz/SchwitzAbs/AIRights.htm [verified]
- Semafor (2025). Albania appoints first AI minister to oversee public procurement (12 September 2025). — https://www.semafor.com/article/09/12/2025/albania-appoints-first-ai-minister-to-oversee-public-procurement [verified]
- Srinivasan, B. (2022). *The Network State: How to Start a New Country*. Self-published. — https://thenetworkstate.com/preorder-the-network-state ; https://www.city-journal.org/article/next-year-in-digital-jerusalem [verified]
- Stern, P. J. (2011). *The Company-State: Corporate Sovereignty and the Early Modern Foundations of the British Empire in India*. Oxford University Press. — https://academic.oup.com/book/11841 [verified]
- Stigler, G. J. (1971). The Theory of Economic Regulation. *Bell Journal of Economics and Management Science* 2(1): 3–21. doi:10.2307/3003160 — https://ideas.repec.org/a/rje/bellje/v2y1971ispringp3-21.html [verified]
- Strathern, M. (1997). 'Improving ratings': audit in the British University system. *European Review* 5(3): 305–321. — https://ideas.repec.org/a/cup/eurrev/v5y1997i03p305-321_00.html [verified]
- Technocracy movement (encyclopedia entry). — https://en.wikipedia.org/wiki/Technocracy_movement [verified: encyclopedia page]
- Van Parijs, P. & Vanderborght, Y. (2017). *Basic Income: A Radical Proposal for a Free Society and a Sane Economy*. Harvard University Press. doi:10.4159/9780674978072 — https://www.degruyterbrill.com/document/doi/10.4159/9780674978072/html [verified]
- Wainwright, J. & Mann, G. (2018). *Climate Leviathan: A Political Theory of Our Planetary Future*. Verso. — https://penguinrandomhouse.com/books/557121/climate-leviathan-by-joel-wainwright-and-geoff-mann [verified]
- Wendt, A. (2003). Why a World State is Inevitable. *European Journal of International Relations* 9(4): 491–542. doi:10.1177/135406610394001 — https://www.comw.org/qdr/fulltext/03wendt.pdf [verified; DOI from memory: unverified detail]

Models reused from other plans (riots' Granovetter thresholds, SIS spread, legitimacy; society's Ψ; court's transition format) are
cited in those plans and not repeated here.

---

## Addendum (for the central registry)
future-politics: EventType 330–339 (331, 336, 338 reserved; 330, 332–335, 337, 339 used); RevoltCause 18 Generations (17 Displaced is
future-tech's, reused); GrievanceKind 15 Drained; ReignEnd 14 Recalled, 15 Decommissioned; AccessionHow 7–10; OrderKind 65 Constitute,
66 Unplug (67 reserved); DecisionKind 50 Mandate, 51 Exit (52 reserved); Government 12–29 and GovernmentCause 23–41; PolityOrigin 9 Exit;
PolityEnd 6 Dissolved; BondKind 4 Federal, 5 Ledger; RegimeFamily 3–8. Reuses MovementKind 5 and IdeaKind 10 Ideology (MIR), future-tech's 326/329/OffWorld/relief/alignment
and tech-tree's bans 300–301. If an earlier plan in the build order took any of these values, shift this plan's; code uses names.
