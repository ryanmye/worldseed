# Plan: Causal explorer — "Ask the world why" (worldseed)

Base: `main` @ 8cabf09 (read-only checkout `/home/claude/ryanmye/worldseed`). Plan only: no source edits. Probes ran on the scratch
copy `/home/claude/scratch-causal` (`probe/causal-probe.ts`, `probe/abandon-probe.ts`; `node --experimental-strip-types`, Node 22,
default options, 2000 years, seeds 1, 7, 42, 1234; the host was shared with other agents, so timings are **contended**).
Tags: **[V]** read in the 8cabf09 code (file:function). **[M]** measured by the probes here. **[A]** assumption, design default or a
constant to tune (not a fact). **[P:x]** taken from sibling plan x and not re-checked in code. Citations follow the
`_CONVENTIONS.md` citation rule: inline (Author Year), each tagged **[verified]** or **[unverified]** (with a reason), and listed in
References. **Every citation in this plan is [unverified]:** the session's shared WebSearch budget ran out on my first lookup, and
the rule forbids citing from memory as verified. Their bibliographic data must be checked before merge (References, last section).
Every constant without a citation is a design default.

Goal: click any event, polity, town, faith, ruler or war and get the chain of causes that explains it. Each link is clickable, each
link says how sure it is, the chain is told in the hedged Chronicle register, and a whole polity's rise and fall can be summed up as
a few key turning points. Optionally, a cause can be tested against the world by re-running it without that cause, where an order
can remove it.

Summary of the design:
- **No new sim events, no new RNG streams.** The explorer is a UI feature, a pure function of a History. It is built lazily on the
  main thread and cached.
- **Three tiers of link, shown honestly.**
  - *Recorded* (certain): an id stored in a field, such as `Conquered.value` → war.
  - *Rule-derived* (probable): a structural pattern of place, polity and time window. Its confidence is measured against records
    where both exist.
  - *Contributing condition* (a weight): the share of a recorded drive or accumulator, or a background state read from snapshots.
- **Recording only (`HistoryOptions.causes`).** Five cheap, RNG-free side records close the largest gaps measured today:
  - the drive behind each war declaration, with an exact decomposition of rivalry;
  - the parts of each revolt's unrest;
  - the harvest of each weather region and year, and why each famine happened;
  - why each settlement was abandoned;
  - why each polity was absorbed, and why each succession was contested.
  The sim's trajectory is bit-identical with causes on or off. Only `History.why` differs.

---

## 0. Interfaces (one contract for the implementer)

### 0.1 Ids, switches, streams
- **EventType: none.** This plan adds no events, so it needs no block. The director's registry (experience plan 0.1) is unchanged.
- **HistoryOptions.causes** (default `true` once step 5 lands). Off leaves `History.why` empty. On, every other History field is
  identical to the off run's. That is a test (section 10).
- **RNG: none.** The recorders only do float arithmetic on side arrays that the sim never reads.
- **New enums** (contract.ts; they are not part of `_CONVENTIONS.md`'s registry yet, so these are claims to register):
  `RivalryPart`, `UnrestPart`, `WarWhyFlag`, `AbandonCause`, `CrisisBit`, `FamineFactor`. Values that other plans contribute
  are pre-allocated in 3.2, in the style of the RevoltCause registry.
- **UI modules:** `src/ui/why/` (DOM-free core: `graph.ts`, `causeIndex.ts`, `rules/*.ts`, `explain.ts`, `turning.ts`,
  `prose.ts`, `counterfactual.ts`), `src/ui/whyPanel.ts` and `why.css` (DOM), and `src/render/causal.ts` (map layer).

### 0.2 What this plan reads from each plan (all optional; each has a rules-only fallback when the plan is not built)
| plan | records read (recorded links unless noted) | fallback without it |
|---|---|---|
| grudges-and-oaths | `Wars.cause` → grievance row → `Grievances.war` / `.settlement` (the earlier wrong, recursively); `Wars.ally` (the war it joined); `Wars.race` → ArmsRaces; OathBroken/Betrayal `value`; grievance `heir` chain [P:grudges 3.2] | R4b–R4d rules (border dispute, earlier war, crisis), plus the `RecentWar` rivalry part (3.2) |
| beliefs-and-deception | `Wars.motive` (WarMotive), `Wars.believed` vs `Wars.actual` (optimism: believed ≥ 1.5·actual), Coerced/Deterred, BluffExposed `extra`, AllianceRevealed `value` [P:beliefs 3.11] | `WarWhy.odds` alone (the true odds) |
| battles | Battles row with `target` = the conquered town and `BattleFlag.TargetFell`; `Commanders.fateBattle` (ruler fell); GeneralSeized/GeneralRose/GeneralTurned `extra` [P:battles 3.2] | Conquered → war only |
| state-finances | WarBankrupt (war `value`), ArmyUnpaid, CrownDefault → HousesRuined (`value` = loan), Repudiation; `treasury`, `crownSpending`, `crownRevenue` snapshots as conditions [P:finances 2.5] | none (no money causes) |
| society-secular-cycles | `socPsi`, `socMMP`, `socEMP`, `socSFD` per snapshot (conditions on revolts, civil wars, crises); SocialPhase; LabourDear `other` (the epidemic) [P:society 2.9] | none |
| riots-uprisings | `Uprisings.cause/cause2/parent/wave/movement/end`; UprisingEnded Escalated → Revolt; ArmyDefected `extra`; Tyranny `value` (the ruler) [P:riots 5.3] | Revolt only |
| court-politics | `regimes.cause` (RegimeCause), sessions → PrivilegeWon, plots → ReignEnded Murdered, MinisterSeized → RulerAcceded, FactionAscendant `extra` [P:court 8] | none |
| disasters-climate | `Disasters.cause` (tsunami ← quake), VolcanicWinter `other` (the volcano) + `value` row, Drought rows by `region`; CityDestroyed same year [P:disasters 2.4] | `why.weather` (3.2) names the bad year, not its cause |
| tech-tree-innovation | `IdeaPressures` (the "why here, why now" log-multipliers per conception), IdeaBanned `extra`, CatchUpDrive `other` [P:tech-tree 5.3] | IdeaInfo.prerequisites + IdeaAdoptions.source |
| city-states / merchant-families / language-drift | GovernmentCause, CommuneProclaimed `extra`; FamilyCause, FamilyEnd·16+FamilyRuin, FamilyFell `other`; LanguageSplitCause [P] | none |
| seat-mode / orders | OrderOutcome.product (war id, new capital, walls...), OrderGiven/Fulfilled; Choice records (card → orders) [V contract.ts OrderOutcome; P:seat] | — (orders are in the repo) |
| experience-whatif-director-sagas | the `compare` worker request, fingerprints and diff (settlement and polity matching) for the counterfactual check (section 7); drama score **S0** (§2.2) to rank turning points; the caption card (`storyCard.ts`) for an entry point [P:experience 1.4–1.6, 2.2, 2.5] | the counterfactual check is hidden; S0 is stubbed with a per-type base weight |
| perf-efficiency P6 | `checkpoint()` / `createRunnerFrom` so that counterfactual runs resume near the cause [P:perf] | full runs from year 0, capped (section 7.4) |

### 0.3 Amendments asked of other plans (small; each null-guarded and draw-neutral)
1. **Every plan that adds a term to rivalry** (grudges: G; religion's `faithRivalry` is already in the base) calls
   `whyRivalry(ps, r, RivalryPart.X, d)` next to its `d +=`. It is one line and a no-op when `ps.why` is null. Grudges uses
   `RivalryPart.Grudge = 8`, and arms uses `Arms = 9` if arms raises rivalry.
2. **Every plan that adds a grievance term in `unrest.ts grievance()`** registers it with `whyUnrest(ps, i, UnrestPart.X, term)`:
   finances `Taxes 11`, city-states `Burghers 12`, society `Urban 13`, riots `14–20`, court `Estates 21`. Riots' `revoltAt`
   refactor must pass the seat through to `whyRevolt(...)` (3.3) so that the RevoltWhy row is written for revolts riots
   escalates too.
3. **beliefs:** when beliefs is on, `WarWhy.odds` is `Wars.actual`'s true front advantage. A test checks they are equal, so one
   number has one meaning. Set `WarWhyFlag.Bargained` when the war came out of a failed bargain.
4. **disasters:** its `History.weatherRegion` is the same mapping as `why.weather.region`, and a test checks that they agree.
   When disasters is on, the famine rule reads `Disasters` rows for the region and year (R16).
5. **experience plan:** the `compare` request gains `stopYear?: number` (stop B there instead of at `years`) and the explorer
   sends several variants (section 7). The fingerprint and diff are unchanged.

### 0.4 Dependencies and build order
- The plan needs no other plan. It can be built right after the base (steps 1–11 use only 8cabf09 records plus its own
  `History.why`).
- Adapters per plan (step 12) land with or after each plan: one rules module each, `src/ui/why/rules/<plan>.ts`.
- The counterfactual check (step 13) needs the experience plan's `compare` request. Checkpoints (perf P6) make it cheaper but are
  not required.

---

## 1. Current behaviour

### 1.1 What records causes today [V]
- **Event log** (`contract.ts` EventType comments, l.99–238). Many events carry an id that is a cause:
  - `Conquered.value` = the war id. `Sacked.other` = the army's base. `PolityEnded.other` = the conqueror's capital.
  - `Reunified.value` = the absorbed polity. `CivilWar.value` and `SuccessionWar.value` = the war. `SuccessionWar.extra` = the
    marriage tie of the claim. `HolyWar.value` = the war and `extra` = the faith. `HolyCityFell.extra` = the war.
  - `Epidemic.other` = the source people's settlement. `ArmyStricken.value` = the war.
  - `IdeaAdopted.other` and `extra` (IdeaHow); IdeaLost and IdeaResisted `extra` (the cause enums).
  - `TraditionMoved.extra` (0 migration, 1 deportation, 2 defection). `PostLost.extra`. `TradeForsaken.extra`.
    `ResortDeclined.extra`. `PlaceRenamed.extra` (RenameCause).
  - `Revolt.value` = RevoltCause, but only the **largest** group of terms. `ReignEnded.extra` = ReignEnd. `RulerAcceded.extra` =
    AccessionHow. `UnionDissolved.extra` = UnionEnd.
  - Orders: `OrderGiven.extra` = OrderKind. `OrderFulfilled.extra` = OrderOutcome.product. `OrderFailed.extra` and
    `OrderLapsed.extra` = OrderReason.
- **Tables.**
  - `Polity.origin`, `endCause` (PolityEnd), `parent`, `capitals` / `capitalYears` (l.1215).
  - `Wars.kind/attacker/defender/startYear/endYear/outcome/taken/dead` (l.1252). **There is no cause and no motive.**
  - `Ruler.how/end/predecessor/parent/ability/warlike/piety/tolerance/faith/law` (l.889). `Bonds` with BondEnd.
  - `Outbreaks.source` / `via` / `epidemic` (l.835): a recorded contagion chain.
  - `IdeaAdoptions.from/via/source/how` and `IdeaInfo.prerequisites` (l.1674, l.1689).
  - `OrderOutcome.status/reason/product/place` (l.1966).
- **What is not recorded** [V]:
  - **why a war was declared.** `war.ts declarations` computes
    `drive = smoothstep(rivalry) · smoothstep(adv) · crisisMul · (1 − exhaustion) · ruler · holy · order`, uses it in one roll,
    and drops it (war.ts l.68–95).
  - **rivalry and its parts.** `relations.ts relationStep` integrates
    `dR = step·[claim + differ + hunger + recentWar − trade − marriage ± faith] − step·decay·R`, clamped to [0, 2]
    (l.103–118), and none of it reaches History.
  - **the parts of a revolt's unrest.** `unrest.ts grievance()` fills `terms[0..4]`, and `causeOf()` keeps only the argmax
    (l.60–77).
  - **the harvest.** `weather.ts` draws a per-region harvest each year from a global AR(1), a global "crisis" and a regional
    drought [P:disasters 1.1]. None of it is in History.
  - **why a famine happened.** `population.ts` l.200–202 logs `Famine` with only the fraction lost.
  - **why a settlement was abandoned.** `state.ts abandon()` (l.401) is called from four sites: `population.ts
    abandonmentSystem` (dwindled below `abandonPop`), `exploration.ts` l.422 (an expedition base), `goods/routes.ts failPost`
    (a fort or station whose supply failed) and `tourism/system.ts` l.676 (a resort given up). The event carries the headcount
    and no cause.
  - **why a chiefdom was absorbed** (`formation.ts` l.196, `bonds.ts` l.225), and **why a succession was contested**
    (`rulers/system.ts` l.548–556: law, cohesion, peoples, a minor, bastard or woman heir, a weak predecessor).

### 1.2 The UI today [V]
- `ui/chronicle.ts`: 40 rows. A click calls `callbacks.onSelect(row.target)` (a settlement id); there is no per-event action.
  Entries are aggregated (`EntryKind` in `historyIndex.ts`, l.24–80), so a row may stand for many events (`notableMembers` CSR).
- `ui/historyIndex.ts buildHistoryIndex`: per-settlement event CSR (`eventOffsets/eventList`), chronological `order`.
- `ui/inspector.ts`: per-town panel with slots (`politySlot`, `rulersSlot`, ...) and "Recent events".
- `ui/sagas/facts.ts sagaIndexOf(h)`: `bySettlement`, `byType`, `ofPeople`, built once per History in a WeakMap. `Ctx` adds
  `politiesOf`, `rulersOf` and `faithsOf`. `PolitiesData` has `eventsOf[p]`, `warsOf[p]` and `alivePop` per snapshot
  (`politiesData.ts` l.108–152).
- `ui/sagas/voice.ts Voice`: phrase tables `[chronicle variants, legend variants]` with `{slots}`. A seeded stream picks only
  among the variants of a key, so the same subject always reads the same.
- `ui/sagas/state.ts`: "A History of the {state}". Its founding origin, wars and fall are told from the records, with no causal
  chain beyond "after the fall of {cap}".
- `ui/library.ts`: the full-screen book. Cross-references are links to sagas (`SagaRef`); there are no event anchors.
- `render/ideas.ts`: a layer with rings at settlements and great-circle ribbons from source to entry. Its shape can be reused for
  causal links. `render/markerSlots.ts` assigns glyph slots and a "selection and highlight ring" band.

### 1.3 Baseline: what today's records can explain [M] (`probe/causal-probe.ts`, `probe/abandon-probe.ts`)
| measure (2000 years) | seed 1 | seed 7 | seed 42 | seed 1234 |
|---|---|---|---|---|
| events / settlements / polities / wars | 12,251 / – / – / – | 13,149 / – / – / – | 13,683 / 1,182 / 85 / 116 | 15,470 / – / – / – |
| PolityEnded by cause (Conquered / Reunified / Absorbed; Fragmented and Dwindled) | 15 / 5 / 20; 0 | 15 / 9 / 37; 0 | 25 / 5 / 33; 0 | 10 / 4 / 28; 0 |
| Conquered ends with a Conquered event of the last capital in y−1..y, carrying a war id | 15/15 | 15/15 | 25/25 | 10/10 |
| Conquered events carrying a war id | – | – | 1204/1204 | – |
| conquest WarDeclared, n | 105 | 96 | 99 | 80 |
| … with a BorderDispute of the pair ≤ 100 y before | 13% | 11% | 26% | 21% |
| … with an earlier war of the pair that ended ≤ 50 y before | 10% | 15% | 9% | 6% |
| … with the defender in a SuccessionCrisis or Regency ≤ 10 y before | 37% | 24% | 22% | 24% |
| … holy war / succession war | 13% / 0% | 14% / 2% | 10% / 0% | 19% / 4% |
| **… with no visible precursor at all** | **42%** | **47%** | **48%** | **39%** |
| Revolts Provincial: linked to a war of the polity or a crisis ≤ 10 y | 189/374 (51%) | 144/297 (48%) | 190/386 (49%) | 223/548 (41%) |
| Revolts Ethnic: seat conquered ≤ 100 y | 77/84 | 153/160 | 158/179 | 70/74 |
| Revolts Peasant / Religious (rare) | – / – | 1/1, 2/2 | 2/2, 1/1 | 3/3 / – |
| Famines, n | 132 | 295 | 310 | 262 |
| … in a year with ≥ 3 famines (a wide bad harvest, itself unrecorded) | 43% | 78% | 69% | 68% |
| … blight of the same people ≤ 2 y, or war at the town ≤ 3 y | 0% / 1% | 0% / 0% | 0% / 0% | 0% / 0% |
| **… with nothing visible** | **56%** | **22%** | **31%** | **32%** |
| ReignEnded (Natural / Battle / Sack / Overthrown / Deposed / Plague / RealmEnded / TermEnded) | 954/14/8/14/13/9/34/56 | 684/18/7/11/10/1/55/291 | 798/12/7/9/6/1/58/186 | 746/13/5/7/12/1/38/360 |
| Sack reign ends with a Conquered/Sacked of the capital in y−1..y | 6/8 | 6/7 | 5/7 | 4/5 |
| Abandoned, n | 199 | 202 | 289 | 412 |
| … after a famine, sack, epidemic, conquest or raid ≤ 20 y | 7% | 6% | 2% | 2% |
| … after migration out ≤ 50 y / peak never above 100 people / food < 0.8 at the last snapshot | – | – | 154 (53%) / 196 (68%) / 11 | 184 (45%) / 246 (60%) / 19 |
| index build (per settlement and per type, all events) | 43 ms | 2.5 ms | 370 ms (contended outlier) | 9.5 ms |
| a naive 3-level chain for **every** PolityEnded | – | – | 0.6 ms | – |

Readings:
1. **The chain from a fallen state back to its war is already recorded** (65/65 conquered ends, every Conquered carries its war).
   The chain breaks at the declaration. 39–48% of conquest wars show no precursor in any record, because rivalry and the drive
   are not stored. This is the largest gap (priority 1 in section 9).
2. **Fragmented and Dwindled never occurred** in these four runs [M]. Absorbed is the most common end (20–37 per run). It has no
   cause beyond "a larger neighbour" (priority 5).
3. **Famines are mostly regional bad years** (43–78% fall in years with three or more famines), but the harvest that caused them
   is not in History (priority 2).
4. **Provincial revolts are half explained** by the visible war or crisis. The rest is distance and assimilation terms that
   are not recorded (priority 3).
5. **Abandonment is mostly hamlets emptying**: 60–68% never exceeded 100 people, about half saw people migrate out, and only 2–7%
   followed a shock. Population, food and the Migration events explain these today, as conditions, without new fields.
6. Building a lazy index and following the links is cheap: milliseconds, even contended.

---

## 2. Model and sources

- **What "cause" means here.** The sim is a known structural model: every variable is set by code from earlier variables and
  draws. A recorded cause is therefore a path in the model's own graph. That is the structural-causal-model view (Pearl 2009
  [unverified]). "Actual causation" (Halpern & Pearl 2005 [unverified]; Halpern 2016 [unverified]) asks which of the many
  ancestors made a difference in this run. The explorer approximates the answer in three ways:
  - by stored drive shares, which say which factors the roll weighed most;
  - by structural rules;
  - optionally, by an interventional check (section 7), which is Lewis's counterfactual dependence (Lewis 1973 [unverified]) made
    testable in a deterministic but chaotic simulator.
- **Conditions vs causes.** Mackie's INUS idea (Mackie 1965 [unverified]) is the reason the explorer keeps background
  conditions (geography, a weak ruler, worn soil) apart from triggering events. Conditions are shown with weights. They are
  never chained as "because".
- **Explanations people find good** are contrastive ("why this rather than that"), selective (a few causes, not all) and social
  (told to someone). That is the survey of Miller (2019) [unverified] and Lipton's contrastive explanation (Lipton 1990)
  [unverified]. Hence the design: top-k causes per link (k = 3 [A]), a short chain by default, and a "what if not?" check rather
  than a probability table.
- **Additive attribution.**
  - Rivalry and unrest are linear accumulators: an exponential moving average of a sum of terms, with a clamp. Their parts can be
    tracked exactly by running one accumulator per term (3.2). That needs no Shapley-style approximation.
  - The war drive is a product, so its factors are compared on a log scale (each factor's ln-multiplier), which is exact for a
    product. The general alternative for non-additive models is SHAP-style attribution (Lundberg & Lee 2017 [unverified]). It is
    not needed here.
- **Words for confidence.** The hedge words follow the idea of a calibrated likelihood scale, "likely" for ≥ 66% and so on
  (Mastrandrea et al. 2010 [unverified]). The thresholds are design defaults (6.2), not that guide's exact scale.
- **Chaos and counterfactuals.** One nudge leaves two runs sharing well under 10% of events within one to two centuries
  [P:experience 1.2, measured there]. Sensitive dependence on initial conditions (Lorenz 1963 [unverified]) means one re-run is
  one draw. The check therefore uses small ensembles (Leith 1974 [unverified]) and a placebo intervention as a control. The
  logic is that of placebo tests in comparative case studies (Abadie, Diamond & Hainmueller 2010 [unverified]). Section 7.
- **Turning points.** Breakpoints of a polity's log-population curve are found by top-down piecewise-linear segmentation (Keogh
  et al. 2001 [unverified]), then explained by the most dramatic event near each one (S0 of the experience plan).

---

## 3. Recording additions (sim side; `HistoryOptions.causes`)

### 3.1 Principle
- Recorders write side arrays only: `ps.why` (polity side) and `s.why` (base side), null when causes is off. No sim quantity
  reads them, and they make no draws.
- Every recorder runs at a site that already computes the value it records. It copies the value, at most scaled or split.
- The aim is minimal: each field closes a measured gap (section 9). Nothing is recorded "in case".

### 3.2 Contract additions (`src/contract.ts`), drafted in the codebase style
```ts
// ---------------------------------------------------------------------------
// causes: why things happened, recorded for the causal explorer (HistoryOptions.causes; all empty when it is false). Recording
// only: the history is the same with it on or off, but for History.why.

/** The parts of the rivalry between two polities (WarWhy.parts): each one an accumulator of one term of relations.ts' rule, so that they sum to the rivalry. */
export const RivalryPart = {
  Claim: 0, // contested farmland: cells in both states' base catchments (Carneiro's squeeze)
  Dispute: 1, // their claims meeting over unsettled land (BorderDispute)
  Differ: 2, // ruling peoples that differ
  Hunger: 3, // hunger on the border
  RecentWar: 4, // a war between them within RELATION.recentYears
  Trade: 5, // trade between their members (negative: it calms)
  Marriage: 6, // a marriage tie between their houses (negative; rulers)
  Faith: 7, // faiths opposed (positive) or shared (negative) (religion)
  Grudge: 8, // grievances (grudges-and-oaths)
  Arms: 9, // an arms race (grudges-and-oaths rev 2), if it feeds rivalry
  // 10-15 reserved for later plans
} as const
export const RIVALRY_PARTS = 16

/** What else drove a declaration (WarWhy.flags, bits). */
export const WarWhyFlag = {
  Crisis: 1, // the defender was in crisis (a contested succession, a regency, a civil war: WAR.crisisMul)
  Holy: 2, // the religion system's holy-war drive was above 1
  Order: 4, // a player's order urged it (OrderKind.War, or a seat card)
  Warlike: 8, // the ruler's warlike multiplier was above 1.25
  Joined: 16, // an ally or protector came to a defence (declare(..., joined)); WarWhy.parts are then the rivalry with the attacker it joined against
  Civil: 32, // a civil war (CivilWar): parts are those of the crisis, see History.why.crises
  Bargained: 64, // beliefs: the war followed a failed bargain (Wars.motive says why)
  Oath: 128, // grudges: declared against an oath (OathBroken)
} as const

/** Why a settlement was abandoned (AbandonWhy.cause). */
export const AbandonCause = {
  Dwindled: 0, // its people fell below POPULATION.abandonPop (died, or left for other towns: Migration events)
  Outpost: 1, // an expedition base given up (exploration)
  Supply: 2, // a fort or station whose supply failed (goods)
  Resort: 3, // a resort town whose visitors failed for good (tourism)
} as const

/** What made a succession contested (CrisisWhy.bits). */
export const CrisisBit = { Minor: 1, Woman: 2, Bastard: 4, WeakPredecessor: 8, LowCohesion: 16, ManyPeoples: 32, Law: 64, RivalCentre: 128 } as const

/** The parts of a settlement's unrest (RevoltWhy), finer than RevoltCause: each one an accumulator of one term of unrest.ts' grievance(). */
export const UnrestPart = {
  Famine: 0, Crowding: 1, BadTax: 2, // Peasant
  Distance: 3, Exhaustion: 4, Crisis: 5, Corruption: 6, // Provincial
  Foreign: 7, Conquest: 8, // Ethnic
  Colony: 9, // Colonial
  Faith: 10, // Religious (religion)
  Taxes: 11, // state-finances
  Burghers: 12, // city-states
  Urban: 13, // society
  // 14-20 riots-uprisings (Tyranny, Conscription, Hunger, Persecution, Usurpation, Ideology, Mutiny), 21 court-politics (Estates)
} as const
export const UNREST_PARTS = 24

/**
 * Why each war was declared (one entry per History.wars id). The drive of the declaration roll is the product
 * smoothstep(rivalry) · smoothstep(odds) · crisis · (1 − exhaustion) · ruler · holy · order (polity/war.ts); its numbers at the
 * roll are kept here, with the parts of the rivalry (RivalryPart order, each a signed share of the rivalry, -127..127 for
 * -1..1: parts[w * RIVALRY_PARTS + k]). A war that was not rolled for (an ally joining, a civil war, a war of succession) keeps
 * what applies and says so in `flags`.
 */
export interface WarWhy {
  /** Rivalry at the roll, 0..255 for 0..2. */
  rivalry: Uint8Array
  parts: Int8Array
  /** True front advantage (attacker projection / defender projection at the front), log-coded: b means 2^((b - 128) / 32); 0 when not rolled. */
  odds: Uint8Array
  /** Attacker's war exhaustion, 0..255 for 0..1. */
  exhaustion: Uint8Array
  /** ruler · holy · order multiplier, log-coded like `odds`. */
  mul: Uint8Array
  flags: Uint8Array
  /** The front town of the defender the attacker saw most exposed (frontV), -1. */
  front: Int32Array
}

/**
 * Why each Revolt (event index `event`) broke out: its seat's unrest at the roll, the four largest parts of it (UnrestPart and
 * share 0..255 for 0..1, part[k * 4 + j], 255 none), and the rebels' odds against the capital's support (0..255 for 0..1).
 */
export interface RevoltWhy { count: number; event: Int32Array; unrest: Uint8Array; part: Uint8Array; share: Uint8Array; odds: Uint8Array }

/** What a famine row splits the shortfall into (FamineWhy columns). */
export const FamineFactor = { Harvest: 0, Stored: 1, Ravaged: 2, Crowded: 3, Imports: 4 } as const

/**
 * Why each Famine (event index `event`) happened: the region's harvest multiplier (0..255 for 0..1.4), what storage left of it
 * (same scale), the share of the fields ravaged by war (0..255 for 0..1), people per expected food (0..255 for 0..2: crowding),
 * the share of food once bought that did not come (0..255 for 0..1), and the weather region.
 */
export interface FamineWhy { count: number; event: Int32Array; harvest: Uint8Array; stored: Uint8Array; ravaged: Uint8Array; crowded: Uint8Array; imports: Uint8Array; region: Uint8Array }

/**
 * The weather as the harvest felt it, per year and weather region (weather.ts; the same with or without settlements):
 * harvest[y * regions + r] 0..255 for 0..1.4, drought[y * regions + r] the regional drought's severity 0..255 for 0..1 (0 none),
 * crisis[y] the world's harvest crisis 0..255 for 0..1, region[cell] the weather region of each cell.
 */
export interface WeatherRecord { regions: number; harvest: Uint8Array; drought: Uint8Array; crisis: Uint8Array; region: Uint8Array }

/** Everything the causes switch records. */
export interface CauseRecords {
  wars: WarWhy
  revolts: RevoltWhy
  famines: FamineWhy
  weather: WeatherRecord
  /** Abandoned events: event index and AbandonCause. */
  abandons: { count: number; event: Int32Array; cause: Uint8Array }
  /** PolityEnded events with PolityEnd.Absorbed: event index, the absorber's people over its own (log-coded like WarWhy.odds), and 1 when it had been the absorber's vassal or tributary. */
  absorbed: { count: number; event: Int32Array; ratio: Uint8Array; bound: Uint8Array }
  /** SuccessionCrisis events: event index, CrisisBit, and the contest chance 0..255 for 0..1. */
  crises: { count: number; event: Int32Array; bits: Uint8Array; chance: Uint8Array }
}
// History:
  /** causes: (empty, counts 0, when HistoryOptions.causes is false) */
  why: CauseRecords
// HistoryOptions:
  /**
   * causes: record why things happened (the drive behind each war declared and the parts of the rivalry behind it, the parts
   * of each revolt's unrest, the harvest of each weather region and year and the factors of each famine, why each town was
   * abandoned, each chiefdom absorbed and each succession contested), for the causal explorer. Recording only: every other field
   * is the same with it on or off. Default true.
   */
  causes?: boolean
```
Notes:
- **Event indices are stable under extension.** A longer run of the same options begins with the same events [P:experience 1.5].
  Rows are appended in event order, so the tables of a longer run begin with the shorter run's.
- **Wars-aligned arrays** grow in `declare()`. Every war gets an entry, with zeros and flags when it was not rolled for.
- Size at 2000 years: wars ~120 × 23 B; revolts ~400–600 × 11 B; famines ~130–310 × 11 B; abandons ~200–410 × 5 B; weather
  48 × 2001 × 2 B + 2001 + 23,042 B ≈ 217 KB. **About 0.25 MB in all** [A: arithmetic on the counts in 1.3]. At 6000 years:
  ≈ 0.65 MB.
- `worker.ts` transfer list: add the typed arrays (`whyBuffers(h.why)`). `emptyCauseRecords()` for the off path and for histories
  from caches written before this plan. The UI tests `h.why?.wars.rivalry.length`.

### 3.3 Recorder rules
**R-rivalry (`polity/relations.ts relationStep`).**
- `ps.why.relPart: Float64Array[RIVALRY_PARTS]`, grown with the relations.
- Per relation r per step, with d's terms as computed:
  `c_k ← c_k + step·(term_k − decay·c_k)`, for each k.
  - The claim term `claim·c/(c+half)` is split between Claim and Dispute in the ratio `contested : CLAIM.dispute·relDispute`.
  - Trade and Marriage are negative terms.
- **Clamp:** if the new R was clamped to 0, every c_k = 0. If it was clamped to 2, every c_k ×= 2/Σc (Σc > 0).
- **Invariant:** `|Σ_k c_k − relR[r]| < 1e-9`, asserted in a test. The decomposition is exact without the clamp. With it, it is
  proportional, which is an approximation and is documented.
- Cost: about 10 mul-adds per relation per slow step [A: negligible beside the edge scan].

**R-war (`polity/war.ts declarations`, `declare`, `civil.ts civilWar`, rulers' succession war, grudges' oath wars).**
- `declarations` computes `rv, adv, e, inCrisis, mul` before its roll. When causes is on, it parks them in `ps.why.pending`
  (the same object every time).
- `declare()` pushes one WarWhy entry per war: from `pending` when the war was rolled for, else flags only (Joined, Civil,
  succession).
- `parts` = c_k / relR at that moment, as Int8.
- **Orders:** `warOrders` makes the rivalry read higher (`warRivalry`), so record the rivalry the roll used and set Order.
- **Test:** recompute the drive from the record (decoded) and match the drive the roll used to 1e-2 relative (coding error).

**R-weather (`weather.ts weatherSystem`).**
- After each year's draws, write `harvest[r]`, the drought severity per region and the crisis severity.
- `region[cell]` is written once from `createWeather`.
- The weather never depends on settlements, so this row is identical whatever happens [V comment in weather.ts, P:disasters 1.1].

**R-famine (`population.ts`).**
- Per settlement, `foodSystem` keeps `s.why.h[id]` (the region's harvest), `s.why.hs[id]` (after storage), `s.why.left[id]`
  (`harvestLeft`), `s.why.crowd[id]` (pop / expected) and `s.why.imp[id]` (the share of last year's food imports that did not
  come).
- When `Famine` is logged (l.202), push a row.
- [A: the exact variable names at the harvest and import sites of foodSystem, l.100–200, to be confirmed at implementation.]

**R-unrest (`polity/unrest.ts`).**
- `grievance()` already fills `terms`. With causes on it also fills `sub[UnrestPart]`.
- `unrestStep` keeps `ps.why.unrestPart[i·UNREST_PARTS + k]` by the same EMA as `ps.unrest[i]`:
  `u_k ← u_k + rate·(sub_k − u_k)`. This is exactly linear, so Σu_k = unrest.
- A capital's parts reset to 0, as its unrest does.
- `revolt()` pushes a RevoltWhy row with the top-4 parts and the odds `rb²/(rb² + sup²)` it rolled against.
- **Test:** the group with the largest summed instantaneous `sub` reproduces `causeOf()` on every revolt. (`causeOf` reads the
  instantaneous terms, l.75, so the record keeps both the EMA parts, which explain the build-up, and the cause value, which is the
  trigger. The UI says "the grievance that weighed most at the outbreak".)
- [A: confirm which of `unrest[i]` or `h` the revolt hazard reads, unrest.ts revolt scheduling.]

**R-abandon.**
- `abandon(s, id, cause = AbandonCause.Dwindled)` gains a parameter. The four call sites (1.1) pass theirs.
- The parameter is used only by the recorder, so the sim is unchanged.

**R-absorbed (`formation.ts` l.196, `bonds.ts` l.225).**
- Push a row with `ratio = pop(absorber)/pop(p)` and `bound` = 1 at the bonds.ts site.

**R-crisis (`rulers/system.ts` l.548–556; also `unrest.ts` l.214, the non-rulers path).**
- Push the bits and the contest chance the roll used.
- [A: the factor names in `contestChance`, read at implementation.]

---

## 4. The causal graph (UI side, DOM-free: `src/ui/why/`)

### 4.1 Nodes
```ts
/** What a node of the causal graph is. Keys are strings "kind:id" (stable for a History; URL-safe). */
export type WhyNodeKind =
  | 'event'      // History.events index
  | 'polity' | 'settlement' | 'faith' | 'ruler' | 'war' | 'people' | 'dynasty'
  | 'battle' | 'grievance' | 'uprising' | 'loan' | 'disaster' | 'order' | 'outbreak' | 'adoption'   // rows of plan tables
  | 'cond'       // a contributing condition (synthetic): id = condition code · 2^20 + subject; see 4.3

export interface WhyNode { key: string; kind: WhyNodeKind; id: number; year: number; place: number /* settlement or -1 */; label: string }

/** How sure a link is. */
export const WhyTier = { Recorded: 0, Rule: 1, Condition: 2 } as const

export interface WhyLink {
  cause: string        // node key
  effect: string
  tier: WhyTier
  /** Recorded 1; Rule: the rule's measured precision (else its prior, flagged); Condition: its weight 0..1 (share of the drive or accumulator). */
  conf: number
  /** Rule or record that made it ("R4a", "rec:Conquered.value", "cond:rivalry.Claim"): shown in the detail view, used by tests. */
  via: string
  /** For a Condition: the value shown ("rivalry 1.4", "harvest 0.45 of normal"). */
  value?: string
}

/** An explanation of one node: its causes to depth d, as a tree (a DAG cut into a tree, shared nodes marked), and effects one level. */
export interface WhyTree { root: string; nodes: Map<string, WhyNode>; links: WhyLink[]; depth: number; truncated: boolean; effects: WhyLink[] }
```
- **Time order:** a cause's year is ≤ its effect's year. Same-year links must follow log order: the cause's event index is lower,
  or it is a record row written before the event. The graph is therefore a DAG; `explain` also keeps a visited set.
- **Entities expand to events:**
  - a polity → its PolityFounded and its end (PolityEnded) or "it stands";
  - a town → Founded, BecameTown/City and Abandoned;
  - a faith → FaithFounded, StateReligion rows and FaithDied;
  - a ruler → RulerAcceded and ReignEnded;
  - a war → its declaration event and PeaceMade;
  - a people → its founder's Founded and its major contacts.
  The UI asks "Why did X rise?" (the founding chain plus turning points) or "Why did X fall?" (the end chain). One question is
  offered per entity state.

### 4.2 Rule catalogue (`src/ui/why/rules/base.ts`; per-plan files add rules for their events)
Each rule is a declarative row:
```ts
interface CauseRule {
  id: string; effect: number /* EventType */; tier: WhyTier
  /** Finds candidate causes of event index i; returns node keys with per-candidate conf multipliers (proximity, size). */
  find(ix: CauseIndex, i: number): { key: string; w: number; value?: string }[]
  prior: number      // conf used before calibration (A)
  window?: [number, number]  // years before the effect (documentation; find enforces it)
}
```
Base rules (8cabf09 records, plus `History.why` when present). The "src" column says recorded (rec), rule or condition (cond).
| id | effect ← cause | src | window / test | prior |
|---|---|---|---|---|
| R1 | PolityEnded(Conquered) ← Conquered of its last capital | rule | year −1..0, settlement = PolityEnded.settlement | 1.0 (65/65 [M]) |
| R2 | Conquered / Sacked / SiegeLifted / Blockade / ArmyStricken / HolyCityFell ← war | rec | `value` (`extra` for HolyCityFell) | 1 |
| R2b | Sacked ← Conquered same town same year | rule | same year | 0.95 |
| R3 | war ← its declaration (WarDeclared / CivilWar / SuccessionWar / HolyWar) | rec | `value` = war | 1 |
| R4a | WarDeclared ← rivalry parts, odds, crisis, exhaustion, ruler / holy / order | cond (exact weights) | `why.wars` | 1 (weights) |
| R4b | WarDeclared ← BorderDispute of the pair | rule | ≤ 100 y; with R4a present, used only to link the Dispute part to the event | 0.5 |
| R4c | WarDeclared ← PeaceMade of an earlier war of the pair | rule | ≤ RELATION.recentYears (50); with R4a, it backs the RecentWar part | 0.6 |
| R4d | WarDeclared ← SuccessionCrisis / Regency / CivilWar of the defender | rule | ≤ 10 y; with R4a, it backs the Crisis flag | 0.7 |
| R4e | WarDeclared ← OrderGiven (War) whose OrderOutcome.product = w | rec | | 1 |
| R4f | WarDeclared (Joined) ← the war its protégé was attacked in | rule | same year, defender = ally (Bonds Alliance / Vassal) | 0.9 |
| R4g | WarDeclared ← Famine on the border (Hunger part) | rule | ≤ 10 y, a member town on the pair's border; with R4a, weight = Hunger share | 0.4 |
| R5 | PeaceMade ← WarOutcome, Peace order (rec), exhaustion (cond: Wars.dead, war-years), capital fell (R1) | mix | | — |
| R6a | PolityFounded(Revolt / Colonial) ← Seceded ← Revolt at the same settlement | rule | same year | 0.95 |
| R6b | PolityFounded(Fragment) ← parent's PolityEnded or capital fall | rule | same year | 0.9 |
| R6c | PolityFounded(Partition) ← Partitioned ← ReignEnded of the parent + Ruler.law Partible (cond) | rule | same year | 0.95 |
| R6d | PolityFounded(CivilWar) ← CivilWar (rec) ← SuccessionCrisis of the parent | rule | same year | 0.9 |
| R6e | PolityFounded(Formed / League) ← conditions: the capital's share of the cluster's people; a common threat (Alliance) | cond | | — |
| R7 | PolityEnded(Absorbed) ← BecameVassal with the absorber (rule), size ratio (cond, `why.absorbed`) | mix | ≤ 200 y | 0.8 |
| R8 | PolityEnded(Reunified) ← Reunified event (rec `value`) ← the civil war (R3) | rec | | 1 |
| R9 | CapitalMoved ← Conquered of the old capital, Abandoned old capital (`other` −1), Seat order (rec), CityStricken | rule | same year / ≤ 2 y | 0.9 |
| R10a | Revolt ← unrest parts (cond, `why.revolts`); with them, each part is backed by an event: Famine ↔ Famine at the seat ≤ 10 y; Conquest ↔ Conquered of the seat; Crisis ↔ SuccessionCrisis; Exhaustion ↔ the polity's war; Faith ↔ Persecution / RulerConverted | cond + rule | | 1 (weights) |
| R10b | Revolt (no record) ← same backing rules, by RevoltCause | rule | Peasant ≤ 10 y (UNREST.famineYears); Ethnic ≤ 100 y; Provincial ≤ 10 y; Religious ≤ 50 y | 0.6 |
| R11 | RevoltCrushed / Seceded ← the Revolt at that seat (rule, same year) + odds (cond) | mix | | 0.95 |
| R12 | SuccessionCrisis ← ReignEnded at that capital (rule, same year) + CrisisBit (cond) | mix | | 0.95 |
| R13 | ReignEnded: Battle ← the polity's war that year (rule); Sack ← Conquered / Sacked of the capital (rule, 71–86% [M]); Overthrown / Deposed ← the next RulerAcceded Usurped of the polity (rule) + ability (cond); Plague ← CityStricken at the capital (rule); RealmEnded ← PolityEnded (rule); Natural ← age (cond: born, died) | mix | y −1..0 | 0.7–0.95 |
| R14 | RulerAcceded ← the predecessor's ReignEnded (rec `Ruler.predecessor`) + AccessionHow (rec) | rec | | 1 |
| R15 | DynastyEnded ← its last ReignEnded (rule) | rule | same year | 0.95 |
| R16 | Famine ← factors (cond, `why.famines`) ← the region's weather row (rec: drought, crisis) ← disasters rows (rec via region + year, when on); without a record: ≥ 3 famines the same year (rule "a bad year far and wide"), Blight of the people ≤ 2 y, Conquered / Raid / Siege at the town ≤ 3 y | mix | | 1 / 0.5 |
| R17 | Abandoned ← AbandonCause (rec); Dwindled ← Migration out ≤ 50 y (rule), peak population, food and soil wear from snapshots (cond); Sacked / Famine / CityStricken ≤ 20 y (rule) | mix | | 0.6 |
| R18 | Epidemic / CityStricken / GreatEpidemic ← Outbreaks.source chain (rec) ← FirstContact or the trade route of `via` (rec / rule) | rec | | 1 |
| R19 | IdeaAdopted ← source settlement + IdeaHow (rec); IdeaConceived ← prerequisites held (rec: ideaAdoptions) + IdeaPressures (cond, tech-tree); IdeaLost / IdeaResisted ← cause enum (rec) | rec | | 1 |
| R20 | StateReligion ← RulerConverted of that polity (rule ≤ 30 y) + ruler piety (cond); HolyWar ← faith rivalry (cond); Schism ← `extra` polity (rec); Persecution ← ruler tolerance (cond); FaithReached ← `other` (rec) | mix | | 0.8 |
| R21 | TradeClosed ← TradeForsaken (rec cause), war between the ends' polities (rule); PostLost, TraditionMoved, ResortDeclined, PlaceRenamed ← `extra` (rec) | rec | | 1 |
| R22 | Founded ← parent (`other`, rec), founding journey (rec), Landfall (rule) | rec | | 1 |
| R23 | Order events ← OrderGiven (rec); OrderFulfilled `product` → the effect (rec, forward) | rec | | 1 |

Plan adapters (`rules/<plan>.ts`, step 12), all recorded unless said:
- **grudges:** War ← `Wars.cause` → grievance row → its `war` (the earlier war) or the `settlement`'s Conquered / Sacked /
  HolyCityFell / CapitalTaken event, then recursion. Grievance → heir → inherited row. OathBroken / Betrayal → the war.
  ArmsRace → war (`Wars.race`).
- **beliefs:** War ← WarMotive (Optimism: "believed itself 2.1× stronger at the front, was 0.8×"; Preventive: the defender's
  rise; Indivisible: the holy city). Coerced → the Joined towns.
- **battles:** Conquered ← the battle with that target and TargetFell. ReignEnded Battle ← fateBattle. Defected ← GeneralTurned.
  CivilWar ← GeneralRose.
- **finances:** PeaceMade ← WarBankrupt ← ArmyUnpaid. HousesRuined ← CrownDefault (loan) ← spending over revenue (cond from
  snapshots). Revolt Taxes ← the default (rule ≤ 10 y).
- **society:** Revolt, CivilWar, SuccessionCrisis ← Ψ and its factors at the snapshot (cond: MMP, EMP, SFD shares of ln Ψ).
  SocialPhase ← Ψ trend (cond). LabourDear ← the epidemic (`other`).
- **riots:** Revolt ← UprisingEnded Escalated ← Uprising (cause, cause2) ← parent rising ← ... ← the first of the wave. Uprising
  ← Tyranny (rule, same town ≤ 5 y). ArmyDefected `extra` (unpaid → finances' ArmyUnpaid, rule).
- **court:** RegimeChanged ← RegimeCause (and its event: a deposition, a default, a revolution). ReignEnded Murdered ← the plot.
  MinisterSeized → RulerAcceded. War ← FactionAscendant War ≤ 10 y (rule, conf 0.5).
- **disasters:** VolcanicWinter ← Eruption (`other`, row). Tsunami ← Earthquake (`cause`). CityDestroyed ← the shock that year.
  Famine ← VolcanicWinter / Drought in its region (rule via `why.weather.region`, the same year, ≤ 2 y).
- **tech-tree:** IdeaConceived ← top channels of IdeaPressures (cond). IdeaBanned ← cause. InnovatorsFled ← IdeaBanned (rule).
  CatchUpDrive ← the defeat (rule) + `other`.
- **city-states / families / language / seat:** their cause enums and `other` fields, as listed in 0.2.

### 4.3 Conditions (synthetic nodes; leaves unless backed by an event)
| code | subject | value shown | weight |
|---|---|---|---|
| `rivalry.<Part>` | war | the part's share of rivalry | `max(0, part)` · w_rv, where `w_rv` = the ln-share of smoothstep(rivalry) in the drive's ln |
| `odds` | war | "2.1× at the front of {town}" | ln-share of smoothstep(odds) |
| `crisis`, `warlike`, `holy`, `order`, `exhaustion` | war | the multiplier | its ln-share |
| `unrest.<Part>` | revolt | the share | the part's share of unrest |
| `famine.<Factor>` | famine | "harvest 0.45 of normal; storage kept 0.6" | shortfall shares (6.3) |
| `geo.remote`, `geo.overseas`, `geo.defensible` | revolt, war, town | hops to the capital, another landmass, defence | rule weights [A] |
| `decline` | abandoned | "never above 80 people; food 0.7; soil worn 60%" | 1 (background) |
| `ruler.ability`, `ruler.age` | reign end, crisis | the trait / age | [A] |
| `psi.MMP/EMP/SFD` | revolt etc. (society) | Ψ factor | ln-share of Ψ |
| `press.<channel>` | idea conceived (tech-tree) | ×multiplier | ln-share |

**ln-share rule.** For a product drive `D = Π f_j`, the weight of factor j is `|ln f_j| / Σ_j |ln f_j|`, signed by whether
f_j > 1 (pushed toward the event) or < 1 (held it back). Smoothstep factors have no neutral value, so their ln is taken
against the value at the middle of the ramp, `smoothstep = 0.5` [A]. This is a presentation convention. The detail view shows
the raw factors as well.

### 4.4 The CauseIndex (`src/ui/why/causeIndex.ts`; built once per History, lazily, on the first "why")
- Reuses `sagaIndexOf(h)` (`bySettlement`, `byType`) and `politiesOf(h)` (`eventsOf`, `warsOf`, `alivePop`) [V facts.ts,
  politiesData.ts]. They are cached per History in WeakMaps already, so nothing is built twice.
- It adds CSRs, each one O(E):
  - `byWar` (events whose `value` is a war, per type list in `WAR_VALUE_TYPES`);
  - `byPolity` (events whose `value` is a polity, plus the capital-keyed ones, mapped by `polity[snapshot][settlement]`);
  - `byPair` (BorderDispute, Alliance and wars, keyed by the unordered polity pair);
  - `revoltOf[event]`, `famineOf[event]`, `abandonOf[event]` (row maps from `h.why`);
  - `reignOfPolity` (from `reignOffsets`).
- Memory ≈ 4 B × (E + several hundred thousand) ≈ **0.3–0.6 MB** at 2000 years [A: ~15k events, tables in 1.3]. It is built in
  ≤ 50 ms on desktop [M: 2.5–43 ms for the simpler index, contended].
- `extend` (a longer run of the same History) rebuilds the index. It is not incremental, because extensions are rare and the
  rebuild is cheap.

### 4.5 Explaining (`explain(ix, root, opts)`)
- Breadth-first from the root. For each node, gather candidates from the recorded fields first, then from the rules (in catalogue
  order).
- Sort by `conf × w` and keep the **top k = 3** causes per node [A]. The rest are listed as "and N lesser" in the detail view.
- **Chain confidence** = the product of link confidences along the path (an independence approximation [A]). A link whose chain
  confidence is below **0.2** is not drawn [A].
- **Depth:** 3 by default. Each "why?" press on a leaf expands it by 2 more. The **hard limit is 8** from the root [A]. Past it,
  the panel says "the record goes further back; open {node} to continue". Opening that node re-roots the tree there.
- **Dedup:** a node reached twice (a war that both made a grievance and was the "recent war" of a rivalry) is drawn once, with
  both links (it becomes a DAG in the timeline view, 8.2).
- **Effects ("What came of it?"):** the same rules read backwards, one level, top 5 by drama S0 (stubbed without the experience
  plan).
- **Contrast** (Miller 2019 [unverified]):
  - For a war, the explorer names the strongest rival pair that did **not** go to war, when its rivalry was as high: "Vashtar was
    as hostile to Oru, but held no advantage at that front." This is computed from `why.wars` and the pair's last record. It is
    shown only when such a pair exists, with conf ≤ the R4a weights.
  - For a revolt, it names the neighbouring member town with the lowest unrest.
  - This is optional and runs only on demand ("Why here and not there?").

### 4.6 Caching
- `WeakMap<History, LRU<string, WhyTree>>`, capped at **128 trees** on desktop and 32 on phones [A], plus the CauseIndex. A new
  History (reorder, a different world) drops everything with the WeakMap.
- The prose of a tree is cached in the same entry, per register.
- **Budget:** phones keep ≤ 1.5 MB in total (index + cache). Desktop keeps ≤ 4 MB.

---

## 5. Turning points: a polity's rise and fall (`src/ui/why/turning.ts`)
1. **Series.** Take `alivePop[snapshot]` of the polity (PolitiesData) over its life and work with `x = ln(1 + pop)`. The member
   count is a second series for ties.
2. **Segment.** Top-down piecewise-linear segmentation (Keogh et al. 2001 [unverified]). Split recursively at the point of
   largest residual until there are ≤ 5 segments, each ≥ 30 years (≥ 3 snapshots) long, or the residual falls below 0.15 [A].
   The breakpoints are the turns. Label each segment rise, plateau or decline by its slope (± 0.002 / y [A]).
3. **Attribute.** For each breakpoint b, take the candidate events of the polity in [b − 25, b + 10] (both as a party and at its
   towns), score each by `S0 · (1 + |Δslope|)`, and keep the top one. Founding and end are always turning points. With 2 to 7
   points in all, each gets its own depth-2 why-chain.
   - Candidate types: Conquered of a town ≥ TOWN_POPULATION, WarDeclared and PeaceMade with `taken` ≥ 3, capital moves,
     SuccessionCrisis, CivilWar, Partitioned, Seceded, BecameVassal, Alliance, great epidemics at members, StateReligion, plan
     events with S0 ≥ θ.
4. **Summary text** (prose 6.4): one paragraph plus the list. For example, "The rise of Vashtar (from 612) began with the
   submission of the river towns; it reached its height about 905, after the conquest of Oruma; the turn came with the
   contested succession of 931, and its fall with the loss of Kesh in 1012."
- Cost: O(life snapshots · log) per polity, about 1 ms [A]. It is cached per polity in the LRU.
- **Honesty:** a turning point is the event *nearest* a change in trend, not proven to have caused it. Its prose is always
  hedged one level ("seems to have marked the turn"). Its own why-chain uses the normal tiers.

---

## 6. Prose (`src/ui/why/prose.ts`, phrase table `WHY_T` `[chronicle], [legend]`, the Voice class)

### 6.1 Registers
- **Default: the Chronicle register.** The Legend register is offered by a toggle and is marked "as the legend tells it". It
  keeps the same links but may drop the hedges for Recorded links only.
- **Voice stream:** `new Voice(world.seed, 'why:' + rootKey, legend, WHY_T, SCENE_T, REIGN_T)`. The same click always reads the
  same, and the explorer's streams are separate from the sagas' (their stream names differ).
- Names: `settlementNameAt(h, id, year)` and the polity and ruler words from facts.ts (`tierWord`, `rulerWord`), as the sagas
  do.

### 6.2 Hedging by tier (design defaults)
| tier, conf | Chronicle form | example |
|---|---|---|
| Recorded | plain past tense | "Oruma fell in 1204 to the armies of Vashtar, in the war Vashtar had declared in 1197." |
| Rule ≥ 0.85 | "after", "following" | "The war followed the contested succession at Oru in 1195." |
| Rule 0.66–0.85 | "it seems", "probably" | "It seems to have grown out of the quarrel over the Kesh valley, first disputed in 1160." |
| Rule 0.33–0.66 | "perhaps", "it may be that" | "Hunger on the border in those years may have sharpened it." |
| Condition, weight ≥ 0.4 | "above all", "chiefly" | "Chiefly, Vashtar held the advantage at the front of Kesh, about two to one." |
| Condition, 0.15–0.4 | "also", "among the reasons" | "The ruler, a warlike man, was also eager." |
| Condition, < 0.15 | not said; the detail view only | — |
- Hidden motives are never stated as fact. The court-politics and seat-mode rules apply: poison is always "blamed"; beliefs are
  "it believed". The Chronicle states what a contemporary could know. The **detail view ("Show the record")** states the sim's
  numbers plainly and labels them "the record (what the world's rules did)".

### 6.3 Templates (examples; full table at implementation)
- `whyWar` (R4a): "{att} made war on {def} in {year}. {topCondition}. {secondCondition}. {backingEvent}." For example: "Vashtar made
  war on Oru in 1197. Chiefly, Vashtar was the stronger at the frontier town of Kesh, about two to one. The two were old rivals over
  the farmland of the Kesh valley, and had fought within living memory. The war came soon after the succession at Oru was
  contested in 1195."
  Legend: "Vashtar smelled weakness at Oru's throne, and Kesh lay open."
- `whyFall` (R1 → R2 → R3 → R4): "The {state} ended in {year} when {cap} fell to {conqueror}, in the war of {year0}. {whyWar}."
- `whyRevolt` (R10a): "{town} rose against {cap} in {year}, its people weighed down above all by {part1} and also by {part2}."
  Parts are spoken as: Distance "the distance of the capital"; Conquest "the memory of its conquest in {y}"; Famine "the famine of
  {y}"; Exhaustion "the long war with {foe}".
- `whyFamine` (R16): "Hunger struck {town} in {year}: the harvest of its region was less than half of a normal year's{, after the
  eruption of {volcano}}{, and war had ravaged a third of its fields}." The shortfall is split by factors: harvest deficit
  `1 − stored`, ravage `ravaged`, crowding `max(0, crowded − 1)`, imports `imports`, normalised to shares [A].
- `whyAbandon` (R17 Dwindled): "{town} was left empty in {year}. It had never grown beyond a hamlet of {peak}; in its last decades
  its people went away to {dest} and elsewhere."
- Turning points (`turnRise`, `turnHeight`, `turnTurn`, `turnFall`) as in 5.4.
- **Fallback:** a node with no cause found says "The record does not say why." It never invents one. A "{slot}" left unfilled
  fails the tests.

### 6.4 Where the prose appears
- In the why-panel (8.1).
- Optionally, as a "Why it fell" paragraph in the state saga's closing (`sagas/state.ts`, behind the explorer's switch, so the
  existing saga texts stay byte-identical when it is off). The Library gets a link "Ask why" per saga subject.

---

## 7. Counterfactual check (optional, expensive) — `src/ui/why/counterfactual.ts`

### 7.1 Which causes can be tested (an order that removes or counters the cause; seat and plan orders where built)
| cause node | intervention (orders added to A's list, at the cause's year unless said) | strength |
|---|---|---|
| a player order (OrderGiven) | remove that order from the list | **exact** (the experience plan's default "minus one") |
| a seat card's choice | the card's other option (seat Choice records) | exact for the decision |
| a war w | Peace (5) by the attacker on the defender at `startYear + 1` | counter (the war still began) |
| a town's conquest | Fortify (8) the town at the war's start (if no walls) | counter |
| a capital's fall | Seat (6): move the capital to the largest other member, 10 y before | counter |
| an epidemic reaching a port | Quarantine (9) the port before its outbreak year | counter |
| a revolt (Provincial / Peasant) | seat Placate (17), or riots Relief (31) | counter (if built) |
| persecution | riots Tolerate (32) | counter (if built) |
| a holy war's faith | Faith (7) the ruler to the defender's faith, 20 y before | weak |
| weather, a volcano, geography, a ruler's traits | — | **untestable** ("no order changes the weather") |

### 7.2 Procedure
- Effect E at year y_e; cause C with intervention I at year y_c (y_c < y_e, and y_e − y_c ≤ **60 y** [A], the causal window;
  beyond it the answer is "too far back to test: the worlds would part for other reasons" [P:experience 1.2 measured
  divergence]).
- **Runs:** K = 3 intervention runs and K = 3 placebo runs [A]. Each run is A's orders plus one order:
  - intervention runs: I at y_c, y_c + 1 and y_c + 2;
  - placebo runs: a Fortify on the largest town of another people at ≥ 0.6 chord from E's place, at the same three years. That
    town must have no walls, so that the placebo is fulfilled and perturbs the world.
  The three years give three chaotic draws without any sim change.
- Each run stops at `y_e + 10` (`stopYear`, amendment 0.3.5).
- **E present in a run** means a matching event by the experience plan's geo matching (settlement match, polity match, war match)
  of the same type in [y_e − 10, y_e + 10]. For PolityEnded, "present" means the matched polity has ended by y_e + 10.
- **Verdict:**
  - **Supported** if E is absent in ≥ 2 of 3 intervention runs and present in ≥ 2 of 3 placebo runs.
  - **Not supported** if E is present in ≥ 2 of 3 intervention runs.
  - **Inconclusive** otherwise (the world is too chaotic here to tell).
  - **Not tested** if the intervention failed (OrderStatus Failed or Expired in all K): the run is identical to A
    [P:experience 1.2 design consequence 1].
- **Display:** "Tested: without the war (peace sued in 1198), Oruma did not fall by 1214 in 2 of 3 trials; in the trials with an
  unrelated change, it fell in all 3." A link marked Supported gets a ✓ badge. Its tier does not change: it becomes "Rule,
  tested", or "Condition, tested".

### 7.3 Cost and memory
- One run costs (y_e + 10 − y_ckpt) years of simulation, where y_ckpt is the latest checkpoint before the earliest year of an
  intervention (perf P6), or 0 without checkpoints.
- A full 2000-year run is 5.6–7.1 s in Node [P:perf §0.3]. In this contended scratch it was 25–29 s [M].
- Six runs of about 300 years from a checkpoint: about 6 × 1 s on desktop [A]. Six runs from year 0 to year 1200: about
  6 × 3.5 s ≈ 20 s on desktop [A, scaled from the perf figure; years cost superlinearly, P:perf].
- The runs are sequential in the worker. Each is cancelled by a newer request. Each run's History is fingerprinted, and its
  arrays are dropped as soon as the verdict bit is known (lite mode: only the fingerprint is posted back). Extra peak worker
  memory is one live run plus one History, ≈ 70–80 MB [P:experience 1.4].
- **Phones:** off by default. It can be enabled with a confirm ("This may take a few minutes and use battery"). It is never run
  in the battery-saver preset (perf). The cap is **3 + 3 runs per hour** on phones [A].
- Results are cached per (History hash, cause key, intervention), in memory and optionally in the history cache's IndexedDB store
  under a `why:` key [A].

### 7.4 Without the experience plan or checkpoints
- The button is hidden, so the explorer works without it.
- Without P6, runs start from year 0. They are allowed on desktop only when `y_e ≤ 1500` [A].

---

## 8. UI

### 8.1 The why-panel (`ui/whyPanel.ts`, `why.css`)
- **Placement:** a panel in the right column, under the chronicle (desktop), or a bottom sheet (`ui/sheet.ts`) on phones.
  Header: "Why? {node label}". Toggles: [Tree | Timeline], [Chronicle | Legend], "Show the record". Close with Esc.
- **Tree view** (default): the root at the top and its causes indented below. Each link row shows:
  - a tier badge: ● recorded, ◐ probable (with conf as words: "very likely", "likely", "perhaps"), ○ condition (a small bar
    for its weight);
  - the cause's label and year;
  - a "why?" button that expands it, or re-roots past depth 8.
  Clicking the label selects that node on the map and moves the timeline to its year; it does not re-root. Keyboard: arrows
  move, Enter expands, Shift+Enter re-roots.
- **Timeline view:** the nodes on a horizontal year axis, with the DAG's links as curves. Conditions are lanes under it. This
  makes shared causes visible (one war feeding two later wars).
- **Prose block** above the tree: the explanation paragraph (6.3), with each named node a link.
- **"What came of it?"** collapsible: the effects (4.5).
- **"Test this cause"** on a testable link (7.1) when allowed: progress, then the verdict.
- **Polity: "Rise and fall"** tab: the turning points (5) as a list with a sparkline of ln-population, the breakpoints marked.
  Each point opens its own why.
- **Empty states:** "The record does not say why" (no causes found); "This history was made before causes were recorded:
  explanations use the rules only, and are less sure" (`h.why` empty).

### 8.2 Map highlighting (`render/causal.ts`, patterned on `render/ideas.ts`)
- Rings at each node's place, coloured by tier (recorded solid, probable dashed, condition faint), and numbered by chain depth in
  a marker slot (`markerSlots.ts`). The root has the selection ring.
- Ribbons along great circles from cause to effect, widening toward the effect; dashed for Rule links. Conditions have no ribbon.
- Visibility: drawn only while the panel is open. One instanced draw for the rings and one ribbon geometry, rebuilt when the tree
  changes, so nothing is done per frame beyond uniforms.
- The camera fits the bounding cap of the visible nodes (`cameraFly.flyTo`) once, when the tree is opened, unless reduced motion
  is set.

### 8.3 Entry points
| where | how |
|---|---|
| Chronicle (`chronicle.ts`) | a small "?" button in each row (`aria-label="Why?"`). For an aggregated entry (EntryKind ≠ Single), it explains the entry's representative event (the one the row's text names: the worst famine, the largest founding...), with a note "one of N". Keyboard: `?` on a focused row. |
| Inspector (`inspector.ts`) | in the header, "Why?" for the town: "Why here?" (founding) while it lives, "Why was it left?" after it was abandoned; plus a "?" on each line of "Recent events". |
| Polities panel | in the faction detail: "Why did it fall?" / "Rise and fall". |
| Rulers panel | per reign: "Why did the reign end?" |
| Faiths panel | "Why did it spread?" (FaithReached chain) / "Why did it die?" |
| Wars (the polity panel's war list) | "Why this war?" |
| Director caption card (experience 2.5) | a "Why?" button next to "Read more". It opens the panel on the beat's event. |
| What-if compare (experience 1.8) | "Why?" on each consequence opens the explorer in world A or B (whichever holds the event). |
| Sagas / Library | "Ask why" per subject. Per-paragraph anchors are optional (a `Book.add(text, mark, events?)` extension, later). |
| URL | `why=event:1234` (and `why=polity:12&tab=rise`), kept up to date like `saga=`. |

### 8.4 Phones
- The panel is a full-height sheet. Only the tree view is offered (the timeline needs width). The map highlight is still drawn
  while the sheet is collapsed to its handle.

---

## 9. Data gaps: what cannot be explained today, and the minimal fields (prioritised)
| # | gap (measured) | minimal field | owner | cost |
|---|---|---|---|---|
| **1** | **Why wars are declared.** 39–48% of conquest wars have no visible precursor; even those that have one lack its weight [M 1.3]. | `why.wars` (rivalry, parts, odds, exhaustion, mul, flags, front) + rivalry part accumulators | **this plan** (base `war.ts`, `relations.ts`); grudges and beliefs add parts and flags (0.3) | 23 B per war; 10 mul-adds per relation per slow step |
| **2** | **Why famines happen.** 22–56% of famines have nothing visible; the rest point to "a bad year" whose cause is not stored [M]. | `why.weather` (harvest, drought, crisis per region-year; region per cell) + `why.famines` | **this plan**; disasters links its rows through `region` (0.3.4) | ≈ 217 KB at 2000 y |
| **3** | **Revolts' parts.** 41–60% of Provincial revolts are not explained by a visible war or crisis; only the argmax is stored [M]. | `why.revolts` (top-4 unrest parts, odds) + unrest part accumulators | **this plan** (base `unrest.ts`); finances, city-states, society, riots and court register their parts (0.3.2) | 11 B per revolt; N × 24 floats in the sim |
| 4 | **Succession crises** have no stored factors (minor, woman, weak predecessor, cohesion) [V rulers/system.ts]. They are the defender-crisis precursor of 22–37% of wars [M]. | `why.crises` (CrisisBit, chance) | this plan (base rulers) | 6 B per crisis |
| 5 | **Absorption**, the most common polity end (20–37 per run) [M]: no reason beyond "a larger neighbour". | `why.absorbed` (ratio, bound) | this plan (base formation.ts, bonds.ts) | 6 B per end |
| 6 | **Abandonment cause** (4 code paths, one event) [V]. Dwindled hamlets are explainable today from Migration and snapshots [M: 45–53% migration out]. | `why.abandons` (AbandonCause) | this plan | 5 B per row |
| 7 | **Which battle took a town**, and which battle killed a ruler (Battle reign ends: 12–18 per run). | Battles TargetFell, Commanders.fateBattle | battles (already in its plan) | — |
| 8 | **Why a crown defaulted** (spending vs revenue, war). | none needed: treasury, spending and revenue snapshots are conditions | finances (already) | — |
| 9 | **Overthrow** (9–14 Overthrown and 6–13 Deposed per run): the ruler's ability is stored, the hazard's other terms (lost war, crisis) are not. | optional: `RulerEndWhy` (hazard terms at the roll) | this plan, **deferred** (rule R13 covers most) | 4 B per reign end |
| 10 | **Why a town grew** (BecameTown/City): only snapshots (trade, wealth, capital) | none: conditions from snapshots | — | — |
| 11 | **TechAdvance** has no cause (field levels). Ideas are covered by tech-tree's IdeaPressures. | none here; tech-tree's plan | tech-tree | — |
| 12 | **Migration** push and pull (food at the source, wealth at the destination) | none: snapshots | — | — |
- Priorities 1–3 are the minimum for the explorer to be worth shipping: they cover the declaration, famine and revolt links that
  every polity chain passes through. Priorities 4–6 are cheap and land in the same commit series. 7–8 come with their plans.
- **Rule precision calibration** (10.2) needs the records. Once they exist, the same rules (R4b–d, R10b, R16 fallback) are kept
  for cached histories without `why`, with their measured precision.

---

## 10. Determinism and tests

### 10.1 Determinism
- Recorders draw nothing and write only side state. **Test D1:** for seeds 42 and 1234 at 800 years, a run with `causes: true` and
  one with `causes: false` have equal hashes over every History field but `why`. The golden-hash tests elsewhere add `why` to
  their filters.
- The UI is pure: the same History and the same click give the same tree, prose and turning points. Voice streams are seeded by
  the root key.
- The counterfactual runs are ordinary order lists, and the cache keys of the experience plan's compare apply.

### 10.2 Tests (vitest; unit tests DOM-free in `src/ui/why/*.test.ts`)
1. **Invariants (sim):**
   - Σ rivalry parts = relR (1e-9) at every slow step on seed 42, 600 years.
   - Σ unrest parts = unrest (1e-9).
   - The decoded drive is within 2% of the drive the roll used (a test hook).
   - The group argmax of the parts reproduces `causeOf` on every revolt.
   - `why.weather.harvest` equals the harvest the sim used (a probe hook).
2. **Graph properties** on seeds 1, 7, 42 and 1234 at 1000 years, for every PolityEnded, WarDeclared, Revolt, Famine, Abandoned,
   ReignEnded and Conquered:
   - the tree builds;
   - causes come no later than effects (same-year links in log order);
   - there are no cycles;
   - every recorded id is in range;
   - depth ≤ 8;
   - conf ∈ (0, 1];
   - no unfilled `{slot}` in the prose, in both registers.
3. **Golden explanations** (`why.golden.test.ts`, inline JSON snapshots; re-recorded only with a commit note), seed 42 and seed
   1234 at 1000 years:
   - (a) the first PolityEnded(Conquered): the chain must be R1 → R2 → R3 → R4a, with its top two conditions;
   - (b) the deadliest war: its top-3 causes, as `{via, tier, conf rounded to 0.05}`;
   - (c) the first Ethnic revolt: R10a parts, Conquest present;
   - (d) a famine in a burst year: weather row present, Harvest the top factor;
   - (e) a Dwindled abandonment: Migration links;
   - (f) a ReignEnded(Sack): R13 → Conquered;
   - (g) the turning points of the longest-lived Kingdom: their years and event types;
   - (h) the Chronicle prose of (a) and (b), and the Legend prose of (a).
   Snapshots store node keys, so a change to the sim that shifts ids makes them fail, which is intended.
4. **Fallback:** the same golden subjects on a History with `why` emptied give rule-only trees with no Recorded condition links,
   and nothing crashes.
5. **Rule calibration test** (`stats`-tagged, slow): measures the precision of R10b, R4b–d and R16-fallback against the records
   on seeds 1, 7, 42 and 1234 at 2000 years. It fails if a rule shown as "likely" (prior ≥ 0.66) measures below 0.6. The measured
   values are written into `rules/base.ts` priors (commit note).
6. **Counterfactual** (with the experience plan): seed 42, a War order at year 800 that is Fulfilled. Removing the order gives
   "Supported" for the war's existence. A failed order gives "Not tested". A test on the placebo selection checks that it is
   fulfilled.
7. **UI** (jsdom): the chronicle "?" opens the panel on the representative event; Esc closes it; the URL round-trips.

### 10.3 Stats harness (`src/ui/why/whyStats.ts`, a Node script through vitest's environment; seeds 1, 7, 42, 1234, 2000 years)
| metric | baseline [M] (rules only, 8cabf09 records) | target (causes on) |
|---|---|---|
| WarDeclared (conquest) with ≥ 1 cause at conf ≥ 0.66 | 52–61% (any precursor visible; precision unknown) | **100%** (R4a) |
| … whose top cause is a rivalry part backed by an event (R4b–d) | n/a | 30–70% [A: a range, to be read, not tuned] |
| Revolt with ≥ 2 parts named | 0% (argmax only) | ≥ 90% |
| Famine with a harvest or ravage factor ≥ 0.3 | 0% | ≥ 95% |
| Abandoned with a cause | 0% | 100% |
| PolityEnded chain depth (median) | 3 (R1 → R2 → R3, then stops) | ≥ 5 |
| Explanations that say "the record does not say why" at the root | measured | < 2% of key events |
| Rule precision, R10b Peasant / Ethnic / Provincial | prior | measured; ≥ 0.6 to be shown as "likely" |
| Index build p95 (desktop, Node proxy) | 2.5–43 ms (contended) | ≤ 50 ms |
| One explanation (depth 3) p95 | 0.6 ms for all ends, naive [M] | ≤ 10 ms |
| Turning points of all polities | — | ≤ 100 ms total |
- The realism scorecard (`realism-metrics.md`) must be identical with causes on and off, because the sim is unchanged. The test is
  the D1 hash.

---

## 11. Ordered commit-sized steps (each with `npm test` and `npm run typecheck` green)
1. **Contract and plumbing.**
   - Change: the enums and `CauseRecords` types (3.2), `HistoryOptions.causes`, `History.why`, `emptyCauseRecords()`, assembly,
     the `worker.ts` transfer list, the `historyCache` read path that tolerates a missing `why`.
   - Test: D1 with all recorders still empty.
2. **Weather and famine recorders** (`weather.ts`, `population.ts`).
   - Test: invariant 1 (harvest equality); famine rows aligned to Famine events.
3. **Rivalry parts and WarWhy** (`relations.ts`, `war.ts`, `civil.ts`, the succession war site).
   - Test: invariants 1 (Σ parts, drive decode); D1.
4. **Unrest parts and RevoltWhy** (`unrest.ts`).
   - Test: Σ parts; causeOf reproduction; D1.
5. **Abandon, absorbed and crisis recorders.** `abandon()` gets its parameter, and the four call sites pass theirs.
   - Test: D1. Every Abandoned event has a row.
   - Turn `causes` default on.
6. **Graph core** (`ui/why/graph.ts`, `causeIndex.ts`, `rules/base.ts`, `explain.ts`).
   - Test: properties (10.2.2) and golden chains (10.2.3 a–f, structure only).
7. **Calibration harness** (`whyStats.ts`).
   - Writes the measured priors into `rules/base.ts`. Test 10.2.5.
8. **Prose** (`ui/why/prose.ts`, WHY_T).
   - Test: golden prose (10.2.3 h); no `{slot}`.
9. **Why-panel and entry points** (chronicle, inspector, polities, rulers and faiths panels, URL).
   - Test: 10.2.7.
10. **Map layer** (`render/causal.ts`).
    - Test: a jsdom-free unit test of the instance builder (rings and ribbons from a tree).
11. **Turning points** (`ui/why/turning.ts`, the "Rise and fall" tab, the optional state-saga paragraph behind the switch).
    - Test: golden g; the saga texts stay byte-identical with the switch off.
12. **Plan adapters**, one commit per plan as it lands: `rules/grudges.ts`, `beliefs.ts`, `battles.ts`, `finances.ts`,
    `society.ts`, `riots.ts`, `court.ts`, `disasters.ts`, `techTree.ts`, `cityStates.ts`, `families.ts`, `seat.ts`.
    - Each adds its golden subject (for example, grudges: a revenge war whose chain reaches the earlier conquest).
13. **Counterfactual check** (`ui/why/counterfactual.ts`; `compare` with `stopYear` and variants; caching).
    - Test 10.2.6. This step needs the experience plan's compare request.
14. **Director caption and what-if "Why?" buttons** (needs the experience plan).

---

## 12. Performance and memory
- **Sim (causes on)** [A: arithmetic].
  - Rivalry parts: 16 floats × relations (low thousands) ≈ 0.2–0.4 MB of state, plus ~10 mul-adds per relation per slow step.
  - Unrest parts: 24 floats × settlement capacity (~1.5k) ≈ 0.3 MB, plus ~12 mul-adds per member per step.
  - The weather row: 48 bytes × 2 per year.
  - Expected total < 1% of history time, to be measured with the perf harness in step 5.
  - History +0.25 MB at 2000 years (3.2).
- **UI.** CauseIndex 0.3–0.6 MB, built ≤ 50 ms on first use, in an idle callback after the history is shown, or synchronously on
  the first click when it is not built yet. Trees cache ≤ 128 entries (desktop) or ≤ 32 (phone), ≈ 2–10 KB each [A].
  - Phone budget: ≤ 1.5 MB and ≤ 150 ms for the first click on a mid phone [A, to be checked on a real phone in step 9].
- **Map layer.** ≤ 64 rings and ≤ 64 ribbons, with no per-frame work while the panel is closed.
- **Counterfactual:** section 7.3. It is the only expensive part, and it is opt-in.

---

## 13. Risks and open questions
1. **The narrative fallacy.** A tidy chain can mislead.
   - Mitigations: the tiers are visible; Conditions are never chained as "because"; there is a chance threshold; rules carry
     measured precision; "the record does not say why" is preferred to a guess; turning points are always hedged.
   - Open question: should the Legend register be allowed in the explorer at all? Default: yes, with the label, and hedges kept
     on Rule links.
2. **The ln-share convention for smoothstep factors** (4.3) is a presentation choice. Two factors at their ramp middles contribute
   0, and that can read oddly ("odds" weight 0 though the odds were needed). Mitigation: the detail view shows the raw factors,
   and a factor at 0 is shown as "needed, but not the reason". Open: a better neutral reference.
3. **Clamped rivalry** makes the part shares proportional rather than exact at the bounds (3.3). It is rare at 2 [A: measure the
   clamp-hit share in step 3].
4. **Sim drift between plan versions:** a later plan changes `grievance()` or the drive. Its recorder line must follow. Test
   invariants 1 catch a forgotten term, because Σ parts would differ.
5. **Old cached histories** have no `why`. The explorer falls back to rules and says so. The cache key includes the options, so
   new runs with causes on are recorded.
6. **Omniscient explorer vs partisan sagas.** The explorer tells the sim's truth, and the partisan sagas tell beliefs
   [P:experience 3.5]. They will disagree by design. The panel title says "What the record shows". Open: offer an "As {pov} tells
   it" mode that reuses the PartisanFacts adapter. Deferred.
7. **Chaos limits the counterfactual** [P:experience 1.2]. The 3 + 3 ensemble is small. Inconclusive is a common honest answer.
   Open: allow K = 5 on desktop. The window cap of 60 y is [A].
8. **Placebo choice** may itself be close to the effect in network terms (trade). Mitigation: chord ≥ 0.6 and another people. The
   risk remains [A].
9. **Aggregated chronicle entries** explain only their representative event. That is acceptable, and the panel says "one of N".
10. **Event-index stability** relies on the extension property. If perf P6 checkpoint-resume ever re-orders same-year events, the
    tables must be keyed by (year, type, settlement) instead. Test: extension keeps the `why` prefix.
11. **The UI space on phones** is tight. The timeline view is dropped there.
12. **Citations unverified** (header): every reference must be checked before merge.

---

## 14. Verified, measured, assumed
- **[V]** The event fields and tables in 1.1 (contract.ts lines cited); `war.ts declarations/declare` (the drive dropped after
  the roll); `relations.ts relationStep` (the linear rule with clamp); `unrest.ts grievance/causeOf/revolt` (argmax only);
  `state.ts abandon` and its four callers; `population.ts` Famine logging; the UI structures in 1.2.
- **[M]** The table in 1.3: four seeds, 2000 years; timings contended.
- **[P]** Sibling plans' records (0.2), the what-if divergence and costs (experience 1.2–1.4), and the perf run times.
- **[A]** Every threshold in 4.5, 5, 6.2, 7 and 12; the record sizes; the counterfactual costs; the exact variable names at the
  famine and crisis sites.

---

## References
All entries are **[unverified]**. The session's WebSearch budget (shared across agents) was exhausted on the first lookup, and
fetching guessed DOI URLs would have been a workaround the tool forbids. The bibliographic data below are from memory and must
be checked against the publisher pages before merge.
- Abadie, A., Diamond, A. & Hainmueller, J. (2010). Synthetic control methods for comparative case studies: Estimating the effect
  of California's tobacco control program. *Journal of the American Statistical Association* 105(490): 493–505.
  https://doi.org/10.1198/jasa.2009.ap08746 [unverified: search budget exhausted]
- Halpern, J. Y. & Pearl, J. (2005). Causes and explanations: A structural-model approach. Part I: Causes. *British Journal for
  the Philosophy of Science* 56(4): 843–887. https://doi.org/10.1093/bjps/axi147 [unverified: search budget exhausted]
- Halpern, J. Y. (2016). *Actual Causality*. Cambridge, MA: MIT Press. https://mitpress.mit.edu/9780262035026/actual-causality/
  [unverified: search budget exhausted; URL guessed from the ISBN]
- Keogh, E., Chu, S., Hart, D. & Pazzani, M. (2001). An online algorithm for segmenting time series. *Proceedings of the 2001 IEEE
  International Conference on Data Mining (ICDM)*: 289–296. https://doi.org/10.1109/ICDM.2001.989531 [unverified: search budget
  exhausted]
- Leith, C. E. (1974). Theoretical skill of Monte Carlo forecasts. *Monthly Weather Review* 102(6): 409–418.
  https://doi.org/10.1175/1520-0493(1974)102<0409:TSOMCF>2.0.CO;2 [unverified: search budget exhausted]
- Lewis, D. (1973). Causation. *The Journal of Philosophy* 70(17): 556–567. https://doi.org/10.2307/2025310 [unverified: search
  budget exhausted]
- Lipton, P. (1990). Contrastive explanation. *Royal Institute of Philosophy Supplement* 27: 247–266.
  https://doi.org/10.1017/S1358246100005130 [unverified: search budget exhausted]
- Lorenz, E. N. (1963). Deterministic nonperiodic flow. *Journal of the Atmospheric Sciences* 20(2): 130–141.
  https://doi.org/10.1175/1520-0469(1963)020<0130:DNF>2.0.CO;2 [unverified: search budget exhausted]
- Lundberg, S. M. & Lee, S.-I. (2017). A unified approach to interpreting model predictions. *Advances in Neural Information
  Processing Systems 30 (NeurIPS 2017)*: 4765–4774. https://arxiv.org/abs/1705.07874 [unverified: search budget exhausted]
- Mackie, J. L. (1965). Causes and conditions. *American Philosophical Quarterly* 2(4): 245–264.
  https://www.jstor.org/stable/20009173 [unverified: search budget exhausted; stable id from memory]
- Mastrandrea, M. D. et al. (2010). *Guidance Note for Lead Authors of the IPCC Fifth Assessment Report on Consistent Treatment of
  Uncertainties*. IPCC. https://www.ipcc.ch/site/assets/uploads/2017/08/AR5_Uncertainty_Guidance_Note.pdf [unverified: search
  budget exhausted; URL from memory]
- Miller, T. (2019). Explanation in artificial intelligence: Insights from the social sciences. *Artificial Intelligence* 267:
  1–38. https://doi.org/10.1016/j.artint.2018.07.007 [unverified: search budget exhausted]
- Pearl, J. (2009). *Causality: Models, Reasoning, and Inference* (2nd ed.). Cambridge University Press.
  https://doi.org/10.1017/CBO9780511803161 [unverified: search budget exhausted]
- Carneiro's "squeeze" is named in the RivalryPart.Claim comment because `relations.ts` already cites it [V relations.ts header].
  Its source (Carneiro, R. L. 1970, A theory of the origin of the state, *Science* 169(3947): 733–738,
  https://doi.org/10.1126/science.169.3947.733) is [unverified: search budget exhausted].

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **R36.** UnrestPart adds **22 Displaced** (future-tech), **23 Generations** (FP), **24 Disaster** (disasters), **25 Immiseration** and **26 Coercion** (society h2); `UNREST_PARTS` = 32. RivalryPart adds **10 TradeRival** (city-states), **11 Bloc** (MIR) and **12 Reputation** (grudges).
- The counterfactual check (step 13) is off by default on D-phone (MASTER-PLAN §5.4).
