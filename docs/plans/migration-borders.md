# Plan: Migration and borders — immigration, emigration, border policy, irregular migration, welfare and integration (antiquity to the future)

Status: PLAN ONLY, written against the read-only checkout `/home/claude/ryanmye/worldseed` at commit 8cabf09.
Marks: **[V]** read in that tree (file:function). **[M]** measured on the scratch copy `/home/claude/scratch-migration` (probe
`probe-migration.ts` at its root, Node 22.23 `--experimental-strip-types`, default options, 2000-year runs, seeds 1, 7, 42, 1234;
85–112 s a seed on a loaded 2-core box). **[A]** assumed: a design default or a constant to tune, not a fact. **[D]** contested in the
literature; modelled as a tunable parameter and labelled so. Literature citations follow the `_CONVENTIONS.md` citation rule:
inline (Author Year) tagged **[verified]** (I opened a page confirming it this session), **[verified-search]** (title, authors and
venue confirmed only by a search listing) or **[unverified]** (reason given); full list in **References**. Every number without a
citation is a design default.

- **EventType block 340–349** (340–348 used, 349 spare).
- **Off switch** `HistoryOptions.migrants` (default `false` until the harness passes, then `true`). Off ⇒ bit-identical history.
- **RNG stream** `'history-migrants'`, created only when on. It is drawn only for discrete political acts (expulsions, amnesties);
  every flow is deterministic.
- **Module** `src/sim/history/migrants/` (`state.ts`, `params.ts`, `system.ts`, `flows.ts`, `refugees.ts`, `policy.ts`, `welfare.ts`,
  `integrate.ts`, `opinion.ts`, `hooks.ts`, `assemble.ts`, `migrantsStats.ts`, `migrants.test.ts`).
- **Depends on:** polities (required: borders need states). Everything else is optional, each with a proxy (0.2): society,
  finances, riots-uprisings, merchant-families, court-politics, language-drift, religion, disasters, battles, tech-tree-innovation,
  future-tech, future-politics, and modern-ideologies-regimes (MIR, **not yet written** when this plan was finished; rechecked at the end).
  Build position: after riots-uprisings and court-politics (reads both), before or after the tech/future plans.

---

## 0. Interfaces (one contract for the implementer)

### 0.1 Ids and enum values (registry as read at the end of writing; code reads every value by name)
| what | values (this plan's) | note |
|---|---|---|
| EventType | **340–348** (3.17.2), 349 spare | the block given to this plan |
| GrievanceKind | none: an expulsion records riots' **KinAttacked 12** (integration rule: same wrong, kin harmed for being who they are) | 13 Asylum (court), 14 Drained (future-politics) |
| OrderKind | **42 Gates, 43 Asylum, 44 Amnesty** | 33–38 court, 39–41 future-politics; `ORDER_KIND_COUNT` → 45 |
| seat DecisionKind | **28 Borders, 29 Refugees** | 18–24 court, 25–27 future-politics |
| MovementKind (riots) | **Nativist** = next free after MIR's movement kinds (5 if MIR adds none) | riots owns 0–4 [riots 4.8]; future-politics also waits for MIR |
| JourneyKind | **5 Refugees** | 0–4 in repo [V contract.ts JourneyKind]; no plan claims JourneyKind (grep of all plans) |
| RevoltCause, ReignEnd, StructureType | none | nativist risings use riots' `RevoltCause.Ideology 13`; frontier works reuse `StructureType.Fort 3` |
| new enums (own) | `BorderPolicy`, `AsylumStance`, `WelfareRegime`, `IntegrationStance`, `MigrantKind`, `RefugeeCause`, `MigEra` | 3.17.1 |

Asked of the coordinator: add "migration-borders: events 340–349, OrderKind 42–44, DecisionKind 28–29,
JourneyKind 5, MovementKind Nativist (after MIR)" to the registry.

### 0.2 What this plan reads (each call guarded by `s.x !== null`; proxy otherwise)
| plan | read | proxy without it |
|---|---|---|
| polities (repo) [V] | `ps.polity`, `pPeople`, `pCapital`, `alive`, `danger/dangerAvg`, `dist`, `asab`, `pAsab`, `gNb` (graph neighbours), `atWar` (formation.ts), `enforcement(s, ps, x, p)` (policy.ts:127), `ps.smugYear`, `ps.corrupt`, `ps.fort`, `cPol` | — (required) |
| society (planned) | `socWage(s,p)`, `socUrbanWage(s,p)`, `socCoercion(s,p)` κ, `socOverprod`; **asked**: export `socScarcity(s,p)` (their internal `scar`, labour scarcity 0..1) | wage w = `food·foodBase/pop · (1 + 0.5·prosperity)` per settlement; scarcity = `smoothstep(0.85, 0.65, pop/foodBase)` (society's own formula, 2.4) |
| state-finances (planned) | `finSpend(s,p,x)` (enforcement, welfare), `finRevenue(s,p)` (fiscal capacity), `finNeed(s,p)` | spend from `s.wealth[cap]` if it has it; revenue `0.02·wealth[cap]`; need = policy.ts tariff need term |
| riots-uprisings (planned) | movement table and slots `mvId/mvSh`, `MovementFounded 285`, `MinorityAttacked 288` (extra 1 = a people), `up.L[p]`, `cruelty(r)` | nativist share = this plan's own opinion index (3.15); no movement events |
| court-politics (planned) | `C.regime[p]` (Regime), `courtPolicy(s,p)`, faction strengths; **asked**: a `migration` slot in their 6.4 policy vector (0.4) | ruler traits only (`rTol`, `rAbility`); regime from tier |
| future-politics (planned) | `ideoShare(s,p,k)` via MIR, `REGIME_FAMILY[g]` (Pluralist ⇒ opinion-led policy), `futDisplaced(s,p)` (automation push) | Pluralist = city-states' Republic/FreeCity/League or court `Constitutional`; displaced 0 |
| MIR (not written) | liberal / nationalist ideology shares, elections | 3.15 proxies (tolerance of the ruler, nativist movement) |
| merchant-families (planned) | live seats by town and `fPeople` (diaspora branches), `SeatClose.Expelled 4` | goods' Factory structures (`StructureType.Factory 5`, sponsor's people) count as one branch |
| religion (repo) [V] | faith slots `fId/fSh/fN`, `shareOf`, `majorityOf`, `rel.state[p]`, `persUntil[p]`, `rel.org[f]`; **asked**: export `mixInto` as `religionArrive(s, rel, from, to, g)` | migrants carry no faith |
| language-drift (planned) | language node of a people; **amendment** 0.4 | integration ignores language distance (factor 1) |
| disasters-climate (planned) | `dx.struckYear[id]`, `dx.struckLoss[id]` (3.4 there), `CityDestroyed 264` | `Famine`, `GreatEpidemic 67` events only |
| battles / war (repo + planned) | `Sacked 27`, `Conquered 26` events, war ids | same events (repo) |
| tech-tree-innovation (planned) | `ideaEra(ix,p)` (era 0–7), `ideaIndex(key)`, `ideaHeld`, `ideaLiteracy`, `ideaOpenness(ix,p)` (tolerance climate, 3.5), pressure channel `PressCh.Labour` z (labour scarcity when society is off) | `max era of held ideas` [V ideas/params.ts `IdeaDef.era` 0–4]; openness = ruler `rTol` |
| infrastructure (planned) | `infraNetCost` for long moves (their 2.7; `INFRA.migrateNet` was reserved for this plan) — route cost R_ij in 3.8 | trade route cost |
| future-tech (planned) | `futureEraAt` / FutureEra (Electric 1 … Fiction 7), `ftDistMul(s,q)` (travel cost multiplier), hub migration (their 2.5.1), off-world emigration sink | era ≤ 7; distance multiplier 1 |
| grudges-and-oaths (planned) | `recordGrievance(...)`, `relR` | rivalry `relR` (repo relations) |
| seat-mode / orders (repo + planned) | order plumbing (`orders/hooks.ts`), DecisionKind cards | — |

### 0.3 What this plan exposes (`migrants/hooks.ts`; O(1), RNG-free; callers guard with `s.mg !== null`)
```ts
/** Foreign-heritage share of settlement id (first + second generation of other peoples), 0..1. */
migHeritage(mg, id): number
/** Share of settlement id born elsewhere (first generation only, any origin), and the irregular part of it. */
migForeignBorn(mg, id): number; migIrregular(mg, id): number
/** Border policy, asylum stance, welfare regime and generosity g (0..1), enforcement E (0..1) of polity p now. */
migPolicy(mg, p): BorderPolicy; migAsylum(mg, p): AsylumStance; migWelfare(mg, p): WelfareRegime; migGenerosity(mg, p): number; migEnforce(mg, p): number
/** Perceived prestige of polity p in the eyes of people a (0..1; 0 when a does not know p): an observable, changeable quantity (3.6). */
migPrestige(s, mg, a, p): number
/** Nativist opinion N_p and pro-immigration coalition C_p (0..1), for riots, court, MIR, future-politics and the UI. */
migNativism(mg, p): number; migCoalition(mg, p): number
/** Join-score factor for a group of people `from` joining settlement occ (migration.ts hot loop; 1 when no border is crossed). */
migJoin(s, mg, from, occ): number
/** Founding-site factor for a group from `from` founding on cell c inside another polity's land (closed borders deter settlers). */
migSite(s, mg, from, c): number
/** Exit factor on a settlement's departure chances (exit bans, serfdom): multiplies migrationSystem's colonise and flee. */
migExit(s, mg, id): number
/** A group of g from `from` arrived at `to` by `kind` (MigrantKind): records heritage slots, faith, journey tag. Called by every mover. */
migArrive(s, mg, from, to, g, kind): void
```

### 0.4 Amendments asked of other plans (each null-guarded, skipped — not ×1 — when this plan is off)
- **court-politics 6.4**: add a `migration` row to the policy vector, read by this plan's policy score (3.15.4):
  Crown → ruler tolerance; War → `Invite` settlers on contested frontiers, `Closed` to enemy peoples; Peace → 0; Faith → `Closed`/`Expel`
  weight × (zeal) against other faiths; Merchant → `Open`/`Tolled` +0.4 and against `Expel` −0.6 (traders want hands and customers);
  Regent → inertia; Favourite → noise. Also `Absolutist`/`Bureaucratic` regimes × 1.3 enforcement capacity (3.10.2).
- **riots-uprisings 4.8**: a movement kind **Nativist** (anchor = host people), birth gate in 3.15.2, spread restricted to settlements of
  its anchor people (like Separatist). **4.11**: the minority gate also counts a heritage slot of share `m ∈ [0.03, 0.35]` (extra 1, value =
  that people), protect term multiplied by `(1 − 0.5·N_p)`; effect `migExpelFrom(s, mg, i, people, 0.4·m)` instead of `religionFlee`.
- **society 2.4**: export `socScarcity(s,p)`; with this plan on, exit bans read society's κ (`migExit`, 3.7). Wages already respond to
  arrivals through L (pop) [their 2.4] — no change.
- **state-finances 2.4.2**: two spending kinds booked through `finSpend`: `'border'` (enforcement) and `'welfare'` (3.12). Diag only.
- **merchant-families**: export `familySeatsAt(s, town, people): number` (live seats of families of `people` at `town`); on `Expulsion` of
  people a from polity p, close a's seats in p with `SeatClose.Expelled` (their enum, unused today).
- **religion (repo)**: export `religionArrive` (wraps `mixInto`, religion/system.ts:198 [V]); `flightStep` calls `migArrive(..., Persecuted)`
  after its Migration event (religion/system.ts:~614 [V]).
- **language-drift 4.6**: the shift hazard's share term becomes `share + heritage share of the ruling people in v` (immigrants of the rulers'
  people speed a shift), and a town whose single heritage slot exceeds 0.5 for `shiftMin` years is a shift candidate **towards that
  people's node** (an immigrant majority). Language shift of migrants themselves is this plan's integration rate (3.13); language-drift
  only renders it (speech rows of minorities are out of scope, open question 9.3).
- **future-tech 2.5.1**: hub migration calls `migArrive(..., Labour)`; off-world emigration is read as an emigration sink for the origin's
  stock accounting (no return, no remittance — as their table says).
- **experience-whatif-director-sagas 0.1**: drama rules for 340–348 (5.5); `Pov.kind` unchanged (people and state povs suffice, 5.4).
- **riots-uprisings 4.9**: under a standing `PoorRelief` or later welfare regime, their `relief` flag is 1 by default (the dole is policy,
  not a ruler's mood) and its cost is part of this plan's welfare bill, not booked twice.
- **tech-tree-innovation 4.6**: the flight target of InnovatorsFled is weighted by the host's `admit` (a Closed host does not take them in),
  and the pulse is logged through `migArrive(..., Labour)` with σ = 0.8 when a group ≥ 20 moves with it (optional, their decision).
- **migration.ts (repo)**: export `seekRefuge(s, search, from, g)` — migrate()'s setup without its draws (mean budget, no voyage, leap on)
  calling `siteSearch(restrict = true, jitter = false)`, which already draws nothing [V migration.ts: the shadow search]. Refugee waves use it.
- **trade.ts (repo)**: lift religion flightStep's route CSR (open routes per settlement) into `routeAdjacency(s, ts)` shared by religion
  flight and labour flows (one builder, rebuilt when `ts.openList` changes).

### 0.5 Integration (owner rule: extend what exists; justify each new record, system or panel)
Reused as is: Migration events and Journeys for every move; migration.ts's join test, room and food rules, and its shadow site search for
refuge; religion's route flight, `mixInto` and `fleeSkills`; polity `enforcement()`, smuggling hubs, `smugYear`, corruption, `SmugglingRing`;
forts (`StructureType.Fort`) and walls; `refugeeKnowledge`; riots' movements, minority gate, `relief` and `KinAttacked`; society's wages, κ, Ψ
and scarcity; finances' `finSpend`; court's policy vector; MIR / future-politics regime families and ideology shares; tech-tree's era,
openness and Labour pressure; infrastructure's network cost; language-drift's shift rule; the politiesPanel faction detail and settlement card.
| new thing | why no existing one can carry it |
|---|---|
| heritage slots (per settlement) | a settlement has one people for life (`s.people`), religion's slots carry faith not origin, `ps.assim` is conquest-to-realm; nothing records origin, generation or legal status |
| labour flows (flows.ts) | existing movers are push-only (pressure, hunger, danger, persecution); wage pull along routes with networks has no carrier. Built on the religion-flight route machinery and migration's join rules |
| border policy, enforcement and asylum per polity | no record of entry rules exists; tariff policy (policy.ts) is per goods, and enforcement is reused from it |
| welfare regime and generosity | riots' relief is a one-off dole, disasters' relief a one-off grant; a standing regime (and migrants' eligibility) has no carrier |
| prestige (3.6) | no plan or system defines a state's standing as seen by others (infrastructure's "prestige" is a regime factor for building); built only from existing quantities |
| nativist opinion N / coalition C | MIR is unwritten; riots' movements give adherents but not a polity's opinion in regimes without a movement. When MIR lands, N = MIR's nationalist share + this plan's visible-change term, and C its liberal share + employers |
| events 340–348 | the existing Migration event carries every move; these mark policy acts and community milestones that no event describes |
| migration-flow map layer | journeys.ts draws one trail per group; decadal aggregates between polities need arcs with widths, which its buffers cannot express. It reuses routeCurves.ts |
| Migration tab in politiesPanel, Heritage view mode | extensions of the existing panel and ViewMode list, not new panels |

---

## 1. Current behaviour

### 1.1 Mechanics [V]
- **Who leaves** (`migration.ts migrationSystem`): per living settlement one draw `roll` from `rngMigration`. Colonists leave under population
  pressure `pressureChance·smoothstep(0.5, 0.9, pop/foodBase)/(1 + WEALTH.stay·prosperity)`; refugees under hunger
  `hungerChance·(1 − smoothstep(0.5, 0.9, food))` plus polity danger `fleeChance` (polity/system.ts:239: `DANGER.flee·smoothstep(0.35, 0.8, z)`).
  Groups are 12–30 % of the town. Small hamlets leave whole.
- **Where** (`siteSearch`): Dijkstra over terrain cost within a budget; a group may **join** an occupied cell (food ≥ joinFood, spare room,
  of its own people or a people it has met, not an enemy at war: `joinBlocked`), scored by spare room × urban draw × prosperity, × polity
  `joinFactor` (walls, danger), × goods rush, × orders; or **found** a new site (`siteFactor`: danger, defensibility, other states' claims).
- **On arrival** (`migrate`): `s.pop[from] -= g; s.pop[bestJoin] += g`; event `Migration 3`; one Journey (Migrants); `refugeeKnowledge`
  passes skills when the hosts are another people under danger. **The migrants become the host settlement's people at once**: a settlement
  has one people for life (`s.people[id]`, set at founding), so nothing remembers that they came, from where, or that they differ.
- **Persecution flight** (`religion/system.ts flightStep`): minorities of a persecuting state flee along open trade routes to tolerant towns
  (food ≥ 0.9), carrying faith (`mixInto`) and skills (`fleeSkills`). Logs Migration + Journey. This is the only route-following move.
- **Assimilation** (`polity/unrest.ts:91`): `ps.assim[i]` of a conquered member of another people rises `UNREST.assim = 0.004` a year
  (≈ 250 years to full); `1 − assim` is a grievance term. This is assimilation of **conquered towns** to the realm, not of migrants.
- **Smuggling** (`polity/policy.ts`, `outlaw.ts`): goods under duty or embargo evade it with share `σ = share·hide·(1 − enforcement)·incentive`;
  the smugglers' cut goes to the hub (the least policed place on the way); `ps.smugYear[hub]` accumulates contraband income; a hub with
  contraband ≥ 70 % of its income logs `SmugglingRing`; corruption follows the contraband share and weakens enforcement. **Reusable as is**
  for people-smuggling (3.11).
- **Frontier works**: `StructureType.Fort 3` at hostile borders (polity/danger.ts:185), `ps.fort[id]`; town walls `ps.walls`.
- **No border policy** exists: a state never admits, tolls, refuses or expels people; no welfare; no migrant stock, diaspora or return.
- **Journeys** are drawn as animated trails (render/journeys.ts); there is no aggregated flow layer.
- The sim uses only `+ − × /`, `sqrt` and `floor` [V index.ts header]: every formula below obeys this (no exp/log/pow).

### 1.2 Baseline flows [M] (probe-migration.ts; shadow stock: arrivals of another people, or across a polity border, decaying 1/40 a year)
| measure (by 250-year bin; 4 seeds) | 0–500 | 500–1000 | 1000–1250 | 1250–1500 | 1500–1750 | 1750–2000 |
|---|---|---|---|---|---|---|
| people moved by Migration events, per 1000 people per year | 0.03–0.14 | 0.02–0.14 | 0.08–0.24 | 0.15–0.45 | 0.53–0.65 | 0.70–0.78 |
| share of moved people crossing a polity border | 0–0.20 | 0.09–0.56 | 0.42–0.53 | 0.21–0.70 | 0.47–0.57 | 0.44–0.49 |
| share joining a settlement of another people | 0.06–0.54 | 0–0.53 | 0.12–0.32 | 0.20–0.53 | 0.18–0.35 | 0.10–0.36 |
| share driven by hunger (food < 0.9 at origin) | 0.2–1 | 0.28–0.78 | 0.13–0.65 | 0.07–0.16 | 0.07–0.08 | 0.05–0.07 |
| share driven by danger (smoothed danger > 0.35) | 0 | 0–0.23 | 0–0.14 | 0–0.11 | 0.01–0.10 | 0.02–0.13 |
| new settlements founded per 1000 people per year | 1.4–2.5 | 0.3–0.8 | 0.16–0.29 | 0.12–0.17 | 0.06–0.09 | 0.02–0.06 |

| snapshot | year 1000 | 1500 | 2000 |
|---|---|---|---|
| world share of foreign-people stock (shadow) | 0–0.15 % | 0.12–0.63 % | 0.28–1.10 % |
| world share of cross-border stock (shadow) | 0.01–0.40 % | 0.20–1.05 % | 1.28–1.94 % |
| towns (≥ TOWN_POPULATION) with ≥ 10 % foreign-born / with ≥ 25 % | 0 / 0 | 0–1 / 0 | 1–3 / 0–1 |
| highest foreign-born share in a town | 0–0.6 % | 1.3–17 % | 10–30 % |
| peoples with ≥ 100 people abroad | 0 | 1–5 | 3–10 |
| share of a people's abroad-stock in its top-3 host towns (median) | — | 0.86–1.0 | 0.82–1.0 |

**Shock response** [M]: departures from a settlement in the 6 years from a shock, as a multiple of the unconditional rate (0.062–0.069 %/yr):
famine **5.7–7.5×**, sacked **0.35–2.6×**, conquered **0.8–2.1×**, persecution 0× (measured at the persecuting capital, where nobody
flees — a probe artefact; the flight is from member towns, religion `diag.fled`).
**Network term** [M]: share of cross-people migrants who land where their own people already makes ≥ 2 % of the town: 0.2–0.57
after 1250 — but there is **no network term** in the code; it is the pull of large rich towns where earlier groups also went.

Reading: (1) flows are a push system (pressure, hunger, danger); there is no wage pull across peoples, no networks, no policy; (2) migrants
are invisible after arrival, so there are no diasporas, no integration, no backlash; (3) war refugees are too few (a sack barely moves
anyone); (4) cross-border stock (1.3–1.9 % at 2000) is in the plausible range for an early-modern world, not too high — the plan must add
structure without inflating volume.

---

## 2. Models and sources (how each is used)
1. **Push–pull** (Lee 1966 [verified]): migration as the balance of unfavourable conditions at origin and attractions at destination, net of
   obstacles. → Utility gap U_j/U_i (3.5) with barriers (distance, policy, cost). The four-way split (origin, destination, intervening
   obstacles, personal factors) is the usual reading of Lee [unverified: the page I opened gives only push and pull].
2. **Expected wage** (Harris & Todaro 1970 [verified]): migrants move until the destination wage × probability of employment equals the
   origin wage; unemployment persists in equilibrium. → `U = w · emp` with `emp` falling as arrivals outrun jobs (3.5), which also caps the
   flow into towns (protects the realism `urb.u10` guard).
3. **Self-selection** (Roy 1951 [verified]; Borjas 1987 [verified]): who moves depends on the returns to skill at origin and destination.
   Borjas derives the conditions from the economic and political characteristics of both countries [verified: NBER abstract]; the reading
   that more unequal destinations draw positively selected migrants is [unverified: full text not opened]. → a selection index σ per flow
   (3.7), used for fiscal balance, wage pressure and brain drain / gain — tunable, small.
4. **Networks and cumulative causation** (Massey et al. 1993 [verified]): ties to earlier migrants "lower the costs and risks of movement",
   migration becomes self-perpetuating past a threshold and can outlast its causes; **chain migration** (MacDonald & MacDonald 1964
   [verified]): newcomers hear of work, travel and housing through earlier migrants. → network multiplier on the heritage share of the
   origin people at the destination and on diaspora merchant seats (3.8).
5. **Mobility transition / migration hump** (Zelinsky 1971 [verified]; de Haas 2010 [verified]; Clemens 2014 [verified]): emigration rises
   with development and falls only at upper-middle income. **[D]**: fixed-effects panels find emigration falls as income rises within
   countries (Schneiderheinze & Benček 2024 [verified]). → hump with a tunable rising branch `humpRise` (default 0.5; 0 = monotone decline);
   the harness reports which shape emerged.
6. **Mass migration** (Hatton & Williamson 1998 [verified]: some 55 million Europeans to the Americas and Australia 1850–1914; emigration
   rising with early industrialisation) → era-7 targets (7.2).
7. **New economics of labour migration** (Stark & Bloom 1985 [verified-search: authors, year, AER; volume and pages not confirmed]): migration
   as a household strategy; remittances as insurance. → remittances follow origin hardship (3.14).
8. **Welfare regimes** (Esping-Andersen 1990 [verified]): liberal (means-tested, modest), conservative (insurance by status and family),
   social-democratic (universal). Earlier: poor relief before 1880 and the growth of social transfers after (Lindert 2004 [verified]).
   **Welfare magnet [D]**: immigrant welfare recipients cluster in high-benefit US states (Borjas 1999 [verified]); in 19 EU countries the
   effect of unemployment benefits on non-EU inflows is "substantially smaller and statistically insignificant" once reverse causality is
   handled (Giulietti et al. 2013 [verified]). → `magnet` default 0.05, range 0–0.3 (3.12).
9. **Fiscal effects** depend on age and education (Blau & Mackie 2017 [verified: the report's tables of net fiscal impact by age, education
   and nativity]). → fiscal balance per slot from age structure (years since arrival) and σ (3.12.3).
10. **Acculturation** (Berry 1997 [verified: citation]; the four strategies assimilation / integration / separation / marginalisation are
    [unverified: no abstract on the page, from my knowledge]); **segmented assimilation** of the second generation (Portes & Zhou 1993
    [verified]); language loss by the third generation (Alba et al. 2002 [verified: citation; finding not read]). → generations and
    integration stances (3.13).
11. **Segregation from mild preferences** (Schelling 1971 [verified]: above a threshold of in-group preference a mixed population sorts).
    → quarters form by threshold dynamics (3.13.4).
12. **Trade diasporas** (Curtin 1984 [verified: book; his chapter on Armenian trade carriers]) → merchant families' branches as diasporas (3.13.6).
13. **Brain drain / gain** (Docquier & Rapoport 2012 [verified]: high-skill emigration need not deplete human capital and can create network
    externalities; Beine, Docquier & Rapoport 2001 [verified]: the prospect of migration raises education, a "beneficial brain drain").
14. **Remittances** exceeded FDI and ODA to low- and middle-income countries in 2023, $656 bn (World Bank 2024 [verified]) → remittances are
    a first-order origin effect, not decoration.
15. **Border enforcement backfiring** (Massey, Durand & Pren 2016 [verified]): militarisation turned a circular flow of workers into a settled
    population. → enforcement lowers return as well as entry (3.11.4).
16. **Smuggling** (UNODC 2018 [verified]: ≥ 2.5 million migrants smuggled in 2016, up to $7 bn income; small smugglers are often of the
    migrants' own group; refugees most dependent on smugglers). **Deaths en route** (IOM Missing Migrants Project [verified]: > 50,000 documented
    since 2014, an undercount). → irregular channel with hub income and an abstract risk (3.11).
17. **Documents and controls** (Torpey 2000 [verified]): passports and identity papers as the modern state's monopoly of legitimate movement,
    largely 19th–20th century. → era gates (3.4): pre-modern states control subjects, tolls and frontiers, not entry.
18. **Attitudes** (Hainmueller & Hopkins 2014 [verified]): attitudes track sociotropic, especially cultural, concerns more than personal
    economic exposure; (Card, Dustmann & Preston 2012 [verified: citation; finding not read]) on compositional amenities. → nativist opinion
    weights culture and pace of change above personal wages (3.15.1).
19. **Immigration politics** (Freeman 1995 [verified]: institutionalised politics in the English-speaking settler states "favors expansionary
    policies" and resists sharp swings). → the pro-immigration coalition (employers, merchants) has organised weight; swings need opinion
    shocks (3.15.3). **Nativism as an ideology** of radical-right parties (Mudde 2007 [verified: book page]).
20. **Stocks and flows today** (UN DESA 2021 [verified]: 281 million international migrants in 2020, ≈ 3.6 % of the world; refugees 12 % of them;
    displaced 17 m in 2000 → 34 m in 2020); 5-year flows ≈ 0.6 % of world population since 1995 (Abel & Sander 2014 [verified]); 117.3 million
    forcibly displaced at the end of 2023 (UNHCR 2024 [verified]). → modern-era targets (7.2).
21. **Distance and steps** (Ravenstein 1885 [verified-search: the laws as summarised by CSISS: most moves are short, long moves go to great
    centres, every flow has a counter-flow; journal volume and pages not opened]) → candidate destinations along routes; return flows.

---

## 3. Design

### 3.1 Principles
- **No inherent ranking of peoples.** Every term in a destination's attractiveness is a measured, changeable quantity of that place or state
  (wages, jobs, safety, tolerance, welfare, prestige, networks, distance, policy). No parameter, table or code path is indexed by a people's
  identity. **Symmetry test** (6, step 10): permuting people ids (and their names) leaves every flow, stock and policy invariant.
- **Prestige is perceived.** It is computed from observables (3.6) and weighted per viewing people by knowledge, faith, language and
  grievance. Two peoples can rank the same state very differently.
- **Claims of superiority exist only inside the world**, as the doctrine of a Nativist movement, attributed in prose ("its preachers held
  that…"). The narrator never asserts them; consequences (riots, expulsions, policy swings) come from the mechanics.
- **Sobriety.** Deaths en route, expulsions and attacks are counted abstractly and told briefly, never as spectacle or heroism (5.6).
- **Add structure, not volume.** The baseline's volumes are near plausible (1.2). Labour flows replace part of what pressure migration does
  today in towns; the harness guards total moves (7.2).

### 3.2 State (`migrants/state.ts`; `HistoryState.mg: MigrantsState | null`)
```ts
/** Migration and borders (HistoryOptions.migrants): heritage slots per settlement, flows, refugee pools, policies and opinion per polity. */
export interface MigrantsState {
  rng: Rng                          // createRng(seed, 'history-migrants'): expulsions and amnesties only (3.15.5, 3.11.5)
  // --- per settlement (capacity cap; ids [0, seen) initialised; grown by doubling with s.count) ---
  cap: number; seen: number
  /** Heritage slots, K = MIG.slots (3) per settlement at [id * K + k]: origin people (-1 empty), first-generation share (born elsewhere),
   *  second-generation share (born here to migrant parents), irregular part of the first generation, mean arrival year, origin settlement
   *  (for remittances and return; -1 when gone), selection index σ (−1..1), segregation 0..1 (a quarter at ≥ MIG.quarterOn). */
  oPeople: Int16Array; oFirst: Float32Array; oSecond: Float32Array; oIrr: Float32Array
  oYear: Float32Array; oFrom: Int32Array; oSel: Float32Array; oSeg: Float32Array
  /** Peak heritage share of the slot's people at the town, and flags (bit 0 DiasporaFounded logged, bit 1 QuarterFormed logged). */
  oPeak: Float32Array; oFlag: Uint8Array
  /** Refugee pool waiting to leave (people), its cause (RefugeeCause) and the year it empties. */
  refPool: Float32Array; refCause: Uint8Array; refUntil: Int32Array
  /** Labour-flow accumulators: up to MIG.pairs (4) destinations per origin, [id * PAIRS + k]: destination, accumulated people (moves a
   *  group when ≥ MIG.chunk), route id used for the journey path. Rebuilt every MIG.pairStep years. */
  fTo: Int32Array; fAcc: Float32Array; fRoute: Int32Array
  /** Remittances received this year and smoothed (loads), for the panel. */
  remY: Float32Array; remSm: Float32Array
  // --- per polity (capacity pcap) ---
  pcap: number
  /** Border policy, asylum stance, welfare regime, integration stance (enums), and the year each last changed. */
  bp: Uint8Array; asy: Uint8Array; wr: Uint8Array; ist: Uint8Array; bpYear: Int32Array; wrYear: Int32Array
  /** Expel target people (-1), quota (people a year), welfare generosity g 0..1, enforcement E 0..1, spending on borders and welfare (loads a year). */
  expel: Int16Array; quota: Float32Array; gen: Float32Array; enf: Float32Array; spendB: Float32Array; spendW: Float32Array
  /** Nativist opinion N, pro-immigration coalition C, prestige components (wealth, cities, learning, faith, arms; 0..1 each), era (MigEra). */
  nat: Float32Array; coal: Float32Array; pres: Float32Array /* 5 per polity */; era: Uint8Array
  /** Immigration and emigration this step (people), irregular entries, deaths en route (expected value), amnesties granted (people). */
  inY: Float32Array; outY: Float32Array; irrY: Float32Array; diedY: Float32Array; amnY: Float32Array
  // --- per people (P) ---
  /** People abroad (first + second generation) and their main host polity; host-town index (towns where a's heritage ≥ MIG.diasporaMin), rebuilt each step. */
  abroad: Float64Array; hostOff: Int32Array; hostList: Int32Array
  evSeen: number
  // --- assembly buffers (sparse snapshots: settlements with heritage ≥ MIG.snapMin only) ---
  snOff: number[]; snId: Int32Array; snPeople: Int16Array; snFirst: Uint8Array; snSecond: Uint8Array; snIrr: Uint8Array; snSeg: Uint8Array; snUsed: number
  snPol: Uint8Array /* per snapshot per polity: bp, asy, wr, ist, enf·255, gen·255, nat·255, coal·255 */
  flowRows: FlowRows      // decadal aggregated flows (3.17.3)
  rows: MigRows           // diasporas, expulsions, amnesties, refugee waves (3.17.3)
  diag: MigrantsDiag
}
```

### 3.3 Params (`migrants/params.ts`, `export const MIG`; one doc comment per line in codebase style; all [A] unless cited)
| name | default | meaning |
|---|---|---|
| slots, snapMin | 3, 0.01 | heritage slots per settlement; snapshot only settlements with heritage ≥ 1 % |
| genYears | 25 | first → second generation: `x = oFirst·(1/genYears)` a year moves to oSecond (children born here), less deaths (below) |
| firstDeath | 0.012 | first generation leaves the slot by death a year beyond what turns into children (≈ 40-year adult span) |
| assim0 | 0.03 | base yearly assimilation of the second generation into the host (half-life ≈ 23 y: "third generation") (3.13.2) |
| intermarry | 0.6 | intermarriage multiplier on assimilation, × 4·m·(1 − m)·(1 − seg) at share m |
| faithGap, langGap | 0.5, 0.4 | assimilation × (1 − faithGap) when the slot's faith differs from the town's majority; × (1 − langGap·distance) |
| quarterOn, quarterOff | 0.45, 0.25 | segregation thresholds (QuarterFormed / dissolved), Schelling-type hysteresis |
| segRate, segPref | 0.04, 0.3 | seg += segRate·(hostility + segPref·[m ≥ 0.05] − seg) a year |
| diasporaMin | 0.05 | heritage share at a town ≥ TOWN_POPULATION that founds a diaspora (DiasporaFounded) |
| pairs, pairStep, chunk | 4, 5, 30 | labour destinations per origin, rebuild period (years), group size moved when an accumulator fills |
| mu | 0.004 | labour emigration per year at full desire (share of pop), before hump, network and admission |
| gapLow, gapHigh | 1.15, 2.5 | desire = smoothstep(gapLow, gapHigh, U_j / U_i) |
| empFloor | 0.35 | Harris–Todaro employment probability never below this (casual work) |
| net, netHalf | 3, 0.05 | network multiplier 1 + net·h/(h + netHalf), h = heritage share of origin people at j |
| fam | 0.5 | + fam per diaspora merchant seat of the origin people at j (cap 3) |
| distK | 1.0 | 1/(1 + distK·route cost / MIG.costRef) distance decay (Ravenstein) |
| humpPeak, humpRich, humpRise **[D]** | 1.6, 4.0, 0.5 | emigration propensity e(w) = (1 − humpRise + humpRise·smoothstep(0.6, humpPeak, w))·(1 − 0.7·smoothstep(humpPeak, humpRich, w)); w = origin wage index (1 = subsistence) |
| sel, selCap | 0.6, 0.8 | σ = clamp(sel·(ineq_j − ineq_i), −selCap, selCap), ineq = society rent index or proxy |
| magnet **[D]** | 0.05 (0–0.3) | welfare pull U ×(1 + magnet·g_j·elig) (Borjas 1999 vs Giulietti et al. 2013) |
| safety, tolerance, prestige | 1.0, 0.6, 0.4 | U ×(1 + safety·(1 − z_j)) / (1 + safety·(1 − z_i)); ×(1 + tolerance·(tol_j − tol_i)) for a faith minority; ×(1 + prestige·Π_a,j) |
| refShare, refYears | sack 0.15, conquest (other people) 0.06, disaster 0.6·loss, expulsion = expelled; 3 | refugee pool share of pop; released over refYears |
| refBudget | 0.6 | refuge search budget as a share of MIGRATION.budget (seekRefuge: refugees flee near, then onward) |
| retBase, retEnf | 0.02, 0.7 | yearly return of first generation when origin safe and U_i ≥ 0.8·U_j: retBase·(1 − retEnf·E_j) (Massey et al. 2016) |
| refReturn | 0.06 | refugees' return a year once the origin's danger < 0.2 and not under the conqueror they fled |
| remit, remitFade | 0.08, 0.04 | remittance = remit·wage_j·first-gen people·(1 − remitFade·years since arrival, ≥ 0.2), ×1.5 when origin food < 0.9 (insurance) |
| brain | 0.002 | origin people tech gain a year from returnees with σ > 0: brain·σ·returned/pop_people, per field, ≤ REFUGEE.max |
| enfA, enfFin, enfFort, enfEra | 0.2, 0.5, 0.15, table | E* (3.10.2) |
| enfCost | 0.004 | loads a year per member settlement per unit E (× 1 + 0.5·border share) |
| irr, irrRisk, smugFee | 0.6, 0.01, 2 | irregular share of refused desire; deaths en route (expected, abstract) per crossing ∝ irrRisk·E·hardness; fee per person (loads) to the hub |
| amnLow, amnChance | 0.04, 0.15 | amnesty gate: irregular share ≥ amnLow of the polity; one draw per slow step |
| natShare, natPace, natHard, natCulture, natNorm | 0.6, 0.8, 0.4, 0.6, 0.3 | nativist opinion terms (3.15.1), culture and pace above wages (Hainmueller & Hopkins 2014) |
| coalLabour, coalMerch, coalLib, coalVoice | 0.8, 0.5, 0.5, 0.3 | coalition terms (3.15.3) |
| inertia | 0.25 | current policy's score bonus (hysteresis; Freeman's resistance to swings) |
| expel0 | 0.02 | expulsion chance per eligible polity-step × gate (3.15.5) |

### 3.4 Era gates (`MigEra`, per polity = the ruling people's era; `era = ideaEra(ix, q)` from tech-tree, + 7 + FutureEra when future-tech is on; proxy max held era)
| era (sim) | real analogue | policies allowed | welfare | enforcement tools (enfEra) |
|---|---|---|---|---|
| no polity | tribes | — (no border) | kin only | 0 |
| 0–1 | early states, antiquity | `Frontier`, `Tolled` (needs `coinage`), `Closed` (a hostile frontier, mostly unenforceable), `Invite` (settler grants) | `Alms` (temple, kin) | 0.15 |
| 2 | classical (`lawCode`) | + `Expel` (edicts against a people or faith) | + `Alms` by a state church | 0.25 |
| 3–4 | medieval, early modern (`printing` era 4) | + residence rules: welfare eligibility after `elig` years; passes and registers (+0.1 E) | + `PoorRelief` (lawCode, monetised revenue) (Lindert 2004) | 0.35, 0.45 |
| 5–6 | science and sail; first industrial | + `AsylumStance` formal; exit controls relax (exit ban only under κ ≥ 0.5 or Closed regimes) | `PoorRelief` common | 0.5, 0.55 |
| 7 | steel and electricity (≈ 1850–1914) | + `Quota` (numbers per origin people) — mass migration era | + `Liberal`, `Conservative` social insurance (after 1880, Lindert 2004) | 0.65 |
| 8–9 (FutureEra Electric, Computing) | 20th century | + `Skills` (points: admits σ > 0), `Family` (reunification: admits network-weighted share), passports universal (Torpey 2000) | + `SocialDemocratic` (Esping-Andersen 1990) | 0.75, 0.8 |
| 10–11 (Networked, Near) | present to near future | + `Union` (free movement among a bloc of allied polities), biometric registers (+0.1 E), climate-displacement asylum (disasters / warming push) | all; plus future-politics' dividend counts as g | 0.85, 0.9 |
| 12+ (Speculative …) | far future | `Union` may cover whole continents; off-world emigration (future-tech) is a sink | as above | 0.9 |
Before the polity's era permits a policy, it is not in the menu (3.15.4). Pre-modern `Closed` is mainly a **frontier** posture: it raises the cost
of settling or joining across the border by `E` but most people still get through (low enfEra) — "states controlled subjects, tolls and frontiers".

### 3.5 Utility of a place (expected wage, safety, tolerance, welfare, prestige; per settlement j for a migrant of people a)
```
w_j    = society socWage(p_j) (socUrbanWage for towns ≥ TOWN) — proxy: food_j · foodBase_j / pop_j · (1 + 0.5·prosperity_j)
emp_j  = max(empFloor, min(1, (foodBase_j + jobs_j) / pop_j))            jobs_j = 0.02·wealth_j / 1 (loads) — Harris–Todaro: jobs fall behind arrivals
safe_j = 1 + safety·(1 − z_j)                                             z = smoothed danger (ps.dangerAvg), war ravage
tol_j  = for a faith minority f of a: 1 + tolerance·(1 − pers_j)·open_j      pers_j = 1 while p_j persecutes f, else 0; open_j = ideaOpenness of the ruling people (proxy 0.5 + 0.5·rTol)
wel_j  = 1 + magnet·g_pj·elig_a,j                                        elig: 0 irregular, residence-years rule, 1 citizens (3.12)
pre_j  = 1 + prestige·Π_a(p_j)                                           3.6; 0 when a does not know p_j
U_a,j  = w_j · emp_j · safe_j · tol_j · wel_j · pre_j
```
`U_a,i` at origin uses the same terms (own polity, `Π` of own state). The ratio `U_a,j / U_a,i` drives desire; nothing depends on who the people
are, only on these numbers.

### 3.6 Prestige / soft power (per polity, every POLITY.step; observable; `pres[5p+k]`)
```
wealth   = smoothstep(0, 2·med, wealth per head of members)                        (med over live polities)
cities   = smoothstep(TOWN, 4·CITY, largest member pop)
learning = held ideas of the ruling people / max held by any people (ideas on; else Crafts tech ratio)
faith    = [holds a holy city of a universal faith] · 0.6 + 0.4·smoothstep(0, 0.2, pilgrim share)   (religion's rel.holy, pilgrims)
arms     = smoothstep(0, 3, wars won − lost in the last 100 years)
Π_p      = 0.3·wealth + 0.2·cities + 0.2·learning + 0.15·faith + 0.15·arms
Π_a(p)   = Π_p · known_a(p) · (1 + 0.3·[a shares p's state faith]) · (1 − 0.5·min(1, grievance_a,p + rivalry_a,p)) · (1 + 0.3·[a is p's ruling people])
```
`known_a(p)`: a knows p's capital cell (`s.know.known`) — else 0. Grievance from grudges (`standingGrudges` of a's polity against p), rivalry
`relR`, at war → 0. It rises and falls with what the state does; nobody's prestige is fixed. Shown in the panel as "how others see it".

### 3.7 Emigration propensity (origin side)
```
e_i   = mu · hump(w_i) · exit_i · (1 + 0.5·scar_none_i)       scar_none = 1 − socScarcity (where labour is scarce people stay)
hump(w) = (1 − humpRise + humpRise·smoothstep(0.6, humpPeak, w)) · (1 − 0.7·smoothstep(humpPeak, humpRich, w))      [D] (2.5)
exit_i = 1 − exitBan_p·E_p,   exitBan_p = max(0.6·κ_p [society coercion: serfs bound to the land], 0.8·[bp = Closed and regime family Authoritarian])
σ_ij  = clamp(sel·(ineq_j − ineq_i), −selCap, selCap)        (Roy/Borjas, [unverified] direction; tunable)
```
`migExit(s, mg, id)` multiplies migrationSystem's `colonise` and `flee` chances (same single draw [V migration.ts:176–186]), so exit bans
also restrain the existing push migration. Famine flight is never banned below `exit ≥ 0.4` (people flee hunger whatever the law).

### 3.8 Labour flows (`flows.ts`; yearly, after migrationSystem; deterministic)
Every `pairStep` years each living settlement i with pop ≥ MIG.minPop (60) rebuilds its candidate list: the **open trade-route partners** of i
(CSR as religion's `flightStep` builds it [V]) of another people or polity, plus any host town in `hostList[people_i]` that is a route partner of
a partner (two route legs; path = concatenated route paths). It keeps the `pairs` best by
```
D_ij  = smoothstep(gapLow, gapHigh, U_a,j / U_a,i)
N_ij  = (1 + net·h_a,j / (h_a,j + netHalf)) · (1 + fam·min(3, seats_a,j))        h = heritage share of a at j; seats = familySeatsAt or Factory count
A_ij  = admit_pj(a, σ_ij) + (1 − admit)·irrPass_pj                                3.10, 3.11
R_ij  = 1 / (1 + distK·routeCost_ij / costRef) · ftDistMul(p_i)
F_ij  = e_i · pop_i · D_ij · N_ij · A_ij · R_ij          (people a year)
```
Each year `fAcc[k] += F_ik`. When `fAcc ≥ chunk` and j has room (`MIGRATION.joinRoom·foodBase_j − pop_j ≥ chunk`, food_j ≥ joinFood — the
same test as migration's join [V]), a group of `chunk` moves: `pop_i −= chunk`, `pop_j += chunk`, `Migration` event, Journey (Migrants,
path = the route's cells), `migArrive(…, Labour or Irregular share)`. Accumulators are capped at 3·chunk (no bursts after a closed spell).
Same-people moves inside one polity are **not** labour flows (internal urbanisation stays migration.ts's job: protects `urb.u10`).
Networks make flows self-reinforcing (Massey et al. 1993); employment saturation (`emp`) and room make them self-limiting.

### 3.9 Refugees (`refugees.ts`)
- **Triggers** (event scan from `evSeen`, yearly): `Sacked` (pool `refShare.sack·pop`), `Conquered` by a polity of another ruling people
  (`refShare.conquest·pop`, doubled when the conqueror's state faith persecutes the town's majority), disasters (`CityDestroyed`, or
  `struckLoss ≥ 0.1`: `0.6·loss·pop`), `Expulsion` (the expelled count). Famine, war danger and persecution keep their existing channels
  (migration.ts hunger/danger, religion flight) and are only **tagged** (`migArrive(..., Refugee, cause)`), so nothing is counted twice.
- **Release**: the pool leaves over `refYears` (a third a year) in groups ≥ 20 (at most 3 groups per pool per year) toward the refuge found by
  migration's own RNG-free shadow search `seekRefuge` (0.4): the join score already includes room, prosperity, walls and danger, and with this
  plan on `migJoin` multiplies it by `asylum_pj(a)` (1 Open, 0.5 Limited, 0.05 Refuse; internal refuges in the own polity always 1: internal
  displacement) and the network term. If no settlement takes them the search's best free site is founded (a refugee hamlet). Path from the
  search (`reconstructPath`). No draw.
  Event `RefugeeWave` once per pool (at its largest destination), Journeys of kind **Refugees**.
- **Return** (`refReturn`) once the origin is safe and not held by the polity they fled; return enforced home rises with host hostility N.
- Refugees carry skills (`refugeeKnowledge` path already exists when danger is high [V]); faith via `religionArrive`.

### 3.10 Border policy, enforcement and cost (`policy.ts`)
**3.10.1 Admission** `admit_p(a, σ)` (share of desired entry that is legal), by policy:
| BorderPolicy | admit | other effects |
|---|---|---|
| Frontier 0 | 1 | no control (pre-state default; also any polity at era 0) |
| Tolled 1 | 1 | entrants pay `toll = 0.5·smugFee` loads a head to the capital (`finCredit` / capital wealth); join score ×(1 − 0.2·E) |
| Open 2 | 1 | join score ×1.1 for its pull among those who know of it |
| Quota 3 | `min(1, quota_p / desired_p)`, quota_p = 0.002·pPop·(1 + C − N) | |
| Skills 4 | `smoothstep(−0.2, 0.4, σ)` | brain gain for p (3.14) |
| Family 5 | `smoothstep(0.01, 0.1, h_a,j)` | reunification: admits where a's heritage exists |
| Invite 6 | 1, plus settlers' site score ×1.3 on p's thinly settled frontier cells | colonisation drives (era ≤ 4) |
| Closed 7 | 0 | `migSite` ×(1 − E) for founders inside p's claimed land |
| Expel 8 | 0 for the target people, policy-before otherwise | active removal (3.15.5) |
| Union 9 | 1 for members of the bloc (alliance bond partners with Union), else the polity's fallback policy | era ≥ 10 |
Asylum stance (`Open 0`, `Limited 1`, `Refuse 2`) governs refugees separately.

**3.10.2 Enforcement** (every POLITY.step)
```
e_p  = mean over border members x of enforcement(s, ps, x, p)      (policy.ts:127 [V]: grip · A/(A + 0.2) · crisis · (1 − 0.5·corruption))
E*_p = enfEra[era] · e_p · (1 + enfFort·forts_p/borderMembers_p) · (1 + 0.3·[regime Absolutist|Bureaucratic]) ·
       (fin ? smoothstep(0, enfFin, paid share of the enforcement bill) : 1)
E_p  += 0.2·5·(E*_p − E_p)                (slow build-up; walls and offices take years)
bill = enfCost · members · E*_p · (1 + 0.5·borderShare)   → finSpend(s, p, bill, 'border') (proxy: capital wealth)
```
The people-border uses the very enforcement the goods-border uses, so its corruption is the existing smuggling corruption: a border that
smugglers buy weakens itself for goods and people alike. With `Closed` and irregular pressure `irrY ≥ 0.002·pPop`, danger.ts's
fort builder gets a migration motive (amendment in `danger.ts`: a border member with `ps.fort < 0` and high inbound irregular pressure is a
fort site; one structure per member, existing Built event) — "frontier works" use the structures that exist.

### 3.11 Irregular migration, smuggling, risk, amnesty
1. **Who**: the refused part of desire, `(1 − admit)·irr`, attempts entry. Success `irrPass = 1 − E_p·catch(route)`, catch = 0.6 on land, 0.8 by sea
   (sea legs are watched at ports), × 0.7 when the route passes a stateless place (shatter zones, `hideTransit` [V]).
2. **Smugglers**: the hub is the least policed settlement on the route (outlaw/policy's rule [V]); it earns `smugFee · people · (1 + E_p)` a year
   into `ps.smugYear[hub]` — the existing smoothing, corruption and `SmugglingRing` logic then apply unchanged (UNODC 2018: fees rise with
   enforcement; small smugglers of the migrants' own group → hubs in co-ethnic diaspora towns get ×1.3).
3. **Risk, abstract**: expected deaths `irrRisk · E_p · hardness · crossers`, hardness = 1 + 2·(sea cells share) + desert/mountain share of the path.
   Subtracted from the moved group, counted in `diedY` and in the decadal flow row; **no event, no individual narrative** — the panel shows
   "many did not arrive" with the count rounded (5.6).
4. **Settling in** (Massey et al. 2016): return rate × (1 − retEnf·E_p) for the whole first generation in p: tight borders keep people in.
5. **Amnesty / regularisation**: every slow step, a polity with irregular share ≥ amnLow and `C − N ≥ 0.1` (or a new reign / regime change
   that tilts that way) draws once `< amnChance·(C − N + 0.5)`: oIrr → 0 for its members; event `Amnesty` (value = people regularised).
   The expectation of future amnesties (moral hazard) is **not** modelled in v1 (assumption; open question 9.2).
6. **Employer demand**: labour scarcity (`socScarcity`, or proxy) raises `C_p` (3.15.3) and lowers `catch` by 0.3·scarcity (employers hire
   whom they find: a lax interior even under a strict policy) [A].

### 3.12 Welfare (`welfare.ts`)
1. **Regime** (WelfareRegime: `None 0, Alms 1, PoorRelief 2, Liberal 3, Conservative 4, SocialDemocratic 5`), era-gated (3.4), chosen each slow step:
   Alms where religion org > 0.3 (church charity); PoorRelief needs `lawCode` and monetised revenue (`finRevenue ≥ FIN.minRev` or capital
   wealth proxy); Liberal / Conservative / SocialDemocratic by regime family and ideology (MIR; proxy: Pluralist + tolerance > 0.6 →
   SocialDemocratic when wealth per head ≥ 1.5·median, Conservative when the state church is strong (org ≥ 0.6), else Liberal).
2. **Generosity** g: Alms 0.05·org, PoorRelief 0.15, Liberal 0.25, Conservative 0.4, SocialDemocratic 0.6 (× wealth factor
   `smoothstep(0.5, 2, wealth per head / median)`). Bill = `g · needy · 0.5` loads a year, needy = Σ members `max(0, 1 − food)·pop + 0.05·pop`;
   `finSpend(..., 'welfare')`. Effects: needy towns' famine mortality × (1 − 0.5·g) (a hook on `populationSystem`'s shortfall deaths, null-guarded),
   emigration desire at origin ×(1 − 0.5·g) (people with a floor stay).
3. **Migrants' fiscal balance** (UI and opinion, not money): per slot
   `FB = tax·w·emp·work(age) − g·need·elig`, work(age) = 0.85 for arrivals < 20 years ago falling to 0.4 at 45 years (ageing first generation),
   second generation counted as natives; σ > 0 raises w. Eligibility `elig`: 0 for irregular, `smoothstep(0, eligYears, years)` for
   residents (eligYears = 5 PoorRelief "settlement" rule, 3 Liberal, 1 SocialDemocratic, 0 Alms), 1 for the second generation. (Blau & Mackie
   2017: net fiscal impact differs by age and education.) Stored per polity as `fiscal_p` (signed), shown in the panel, read by opinion (3.15.1).
4. **Welfare magnet [D]**: only the `wel_j` term in U (3.5), default 0.05; the harness reports flows with magnet 0 vs 0.3 (7.3).

### 3.13 Integration (`integrate.ts`; yearly per settlement with slots; ascending id)
1. **Arrival** (`migArrive`): if host people ≠ a (or a crossed a border and is of another people), add `g/pop_to` to a's slot (new slot in an
   empty one, or replacing the smallest when its share < the newcomers'; the replaced remainder joins the host: already "assimilated").
   `oYear` is the share-weighted mean year, `oFrom` the origin settlement of the largest group, `oSel` the share-weighted σ, `oIrr += irregular`.
   Shares are rescaled by `pop_before/pop_after` at every population change (they are shares of the current pop).
2. **Generations**: `first −= first·(1/genYears + firstDeath)`; `second += first·(1/genYears)·birthsAdj`; `second −= second·α`,
   `α = assim0·ist_mul·(1 + intermarry·4m(1 − m)(1 − seg))·(1 − faithGap·[faith differs])·(1 − langGap·langDist)·(1 − 0.5·seg)`.
   `ist_mul`: Assimilationist 1.4, Multicultural 0.8 (second generation keeps heritage, but discrimination term in N is lower), Segregationist
   0.4 (and seg target +0.3), Laissez-faire 1 (pre-modern default). Integration stance is chosen with the border policy (3.15.4).
3. **Language and faith**: language shift of migrants is α itself (rendered by language-drift through heritage snapshots, 0.4); faith
   travels with arrivals (`religionArrive`) and converts at religion's own rates — no extra rule.
4. **Quarters / ghettos**: `seg += segRate·(H_i + segPref·[m ≥ 0.05] − seg)`, H_i = local hostility (3.15.1); `seg ≥ quarterOn` (from below)
   → `QuarterFormed` (once per slot); `seg ≤ quarterOff` → dissolved (no event, UI shows it). A quarter: network pull ×1.3, assimilation ×0.5,
   and it is the place riots' minority gate looks at first. Schelling 1971: modest preferences can sort a town; here segregation comes from
   both hostility (imposed) and preference (chosen) and the UI says which dominated.
5. **Second generation** (Portes & Zhou 1993): when w_j falls (society's wage index down ≥ 20 % in 20 y) and seg ≥ 0.3, the second generation's
   grievance term in riots' private discontent `+0.15·second share` (blocked mobility); otherwise none [A].
6. **Diasporas** (Curtin 1984): a slot with share ≥ diasporaMin in a town ≥ TOWN_POPULATION logs `DiasporaFounded` once; merchant families of
   people a with seats there and the Factory quarters (`StructureType.Factory` sponsored by a) mark it a **trade diaspora** (extra bit), which
   doubles its network pull for a's merchants and makes it the first target of Expel policies (they are visible and rich).
7. **Absorbed**: a slot whose people's share fell below 0.01 after a peak ≥ 0.1 logs `Absorbed` (348) — "the X of Y were no longer
   counted apart". Natural end of integration, not a loss.

### 3.14 Origin effects
- **Remittances**: each year per slot with first-generation stock: `rem = remit·w_j·first·pop_j·max(0.2, 1 − remitFade·(year − oYear))`
  × 1.5 when the origin's food < 0.9 (insurance, Stark & Bloom 1985); `wealth_j −= rem`, `wealth[oFrom] += rem` (or the origin polity's
  capital). Not paid across a war between the two polities, and taxed by a Closed origin's crown at 30 % (to its capital) [A].
- **Brain drain / gain**: departures with σ > 0 from i lower i's wealth by `0.2·σ·chunk·w_i` loads (lost training) [A]; returnees with σ > 0 raise
  the origin people's tech by `brain` (Beine et al. 2001; Docquier & Rapoport 2012 — the network externality); Skills-policy hosts get
  refugeeKnowledge-like gains capped at REFUGEE.max [V polity/params.ts].
- **Depopulation**: emigration is real pop loss; heavy emigration (`outY ≥ 0.01·pPop` a year for a decade) logs `EmigrationWave` (347).
- **Return**: 3.11.4 / 3.9 rules; returnees re-enter their origin with `migArrive(..., Return)` (no slot: they are of the host people at home).

### 3.15 Politics (`opinion.ts`, `policy.ts`; every POLITY.step, polities ascending)
**3.15.1 Nativist opinion** per member town i (≥ TOWN) and polity N_p (pop-weighted):
```
m_i   = heritage share at i;  dm_i = m_i − m_i(20 y ago) (ring of 4 steps)
H_i   = natShare·smoothstep(0.03, 0.25, m_i) + natPace·smoothstep(0, 0.08, dm_i) + natCulture·cult_i + natHard·max(0, 1 − w_i/w_i,20y)
        + 0.3·[fiscal_p < 0 and g_p ≥ 0.25] + adherents of the Nativist movement at i − natNorm·tol_ruler
cult_i = share of slots whose faith differs from i's majority and whose people's language is not the host's (language-drift distance; proxy 1)
N_p   = clamp(Σ pop_i·H_i / Σ pop_i, 0, 1)
```
Weights put the pace and visibility of change and culture above personal wage loss (Hainmueller & Hopkins 2014). A tolerant ruler and
long-settled minorities (dm ≈ 0) calm it.

**3.15.2 Nativist movement** (riots 4.8, kind Nativist, anchor = host people): birth gate at a town with `H_i ≥ 0.5`, `m_i ≥ 0.05`,
and hardship (Ψ ≥ 1.2 with society, or famine in 10 y) — chance `0.01·R` like their other kinds, spreading only among towns of the anchor people.
Its in-world doctrine (UI only) holds the host people to be above the newcomers and the realm endangered by them. It adds to `H_i`
(above), to riots' minority gate (0.4), and to the policy score of Closed/Expel. It fades by riots' SIS outflow when m stops rising.

**3.15.3 Pro-immigration coalition** C_p:
```
C_p = coalLabour·scar_p + coalMerch·(merchant pool growth over 20 y, smoothstep(0, 0.5)) + coalLib·(liberal ideology share | proxy rTol)
      + coalVoice·(second-generation share of members, only in Pluralist regimes) + 0.3·[court Merchant faction leads]
```
scar_p = society's `socScarcity` (else tech-tree's Labour pressure `smoothstep(0, 1, z_Labour)`, else the food-based proxy in 0.2).
Employers want hands, merchants want trade and customers, liberals and the descendants of migrants vote (Freeman 1995: organised expansionist
interests). Without MIR the liberal share proxy is the ruler's tolerance in monarchies and 0.5·tolerance + 0.5·(1 − N) in Pluralist regimes.

**3.15.4 Choosing policy** (deterministic, no draw):
```
for each allowed (BorderPolicy, AsylumStance, IntegrationStance) bundle b (a small fixed table of 3–14 bundles per era, 3.17.1):
  S(b) = wR·ruler(b) + wF·court(b) + wO·opinion(b) + wI·ideology(b) − cost(b)/(R° + 1) + inertia·[b = current] + hashNoise
  ruler(b)   = tolerance·openness(b) − (1 − tolerance)·closure(b);   court(b) = courtPolicy migration row (0.4)
  opinion(b) = (C_p − N_p)·openness(b);   ideology(b) = MIR / future-politics lean (proxy: Nativist movement share · closure(b))
  cost(b)    = enforcement bill at E*(b) + welfare bill of the stance
weights by regime family: Traditional (wR 0.6, wF 0.3, wO 0.1), Authoritarian (0.7, 0.2, 0.1), Pluralist (0.2, 0.2, 0.6)
hashNoise = (hash01(seed ^ p·7919, year/5) − 0.5)·0.1·(1.6 − ability)      (counter-based, as riots 4.9; no draw)
```
War: bundles closing to the enemy's people (Closed, Refuse) get +0.3 while at war with a polity of that people; Invite +0.3 on a frontier with
unclaimed land. Orders 42–44 override (seat-mode). The chosen bundle changes only when its score beats the current by > inertia: swings follow
opinion shocks (refugee waves, hard years, a nativist movement, a new liberal ruler), and elections (Pluralist regimes, future-politics or MIR)
replace the ruler term by the winning platform.
Event `BorderPolicyChanged` (340) on a border-policy change; `WelfareRegimeChanged` (346) on a welfare change.

**3.15.5 Expulsion** (`Expel` chosen with a target): the target is the heritage people with the largest stock in p whose kin-state is a rival
(`relR ≥ 0.5`) or whose faith p persecutes; one draw per slow step `< expel0·(N_p + 0.5·[persecuting] + 0.3·[at war with the kin-state])·(1 − C_p)`.
On success: 40 % of that people's first + second generation in p's towns becomes a refugee pool (cause Expulsion), their merchant seats close
(Expelled), the towns lose `0.5·share` of `mw` and wealth (lost trades and stolen property, told plainly), grudges `KinAttacked` (12, riots' kind; site = the largest town expelled from) for the
polity ruled by that people (w 0.6), riots tyranny is not raised (an expulsion is policy, not a ruler's private cruelty). Event `Expulsion` (342).

**3.15.6 Backlash riots**: riots' existing ladder, with the Nativist program and the extended minority gate (0.4). This plan adds no riot rule.

### 3.16 Hooks into existing code (each `s.mg !== null ? new : old`; no new draw in an existing stream)
| site | change |
|---|---|
| `migration.ts siteSearch` join branch (after `joinFactor`) | `if (s.mg !== null) score *= migJoin(s, s.mg, from, occ)` = `U_a,occ/U_a,from` clamp [0.5, 2] × admission (admit + (1 − admit)·irrPass) × network ×(1 + net·h/(h + netHalf)) — O(1) |
| `siteSearch` found branch (after `siteFactor`) | `if (s.mg !== null) score *= migSite(s, s.mg, from, c)` (Closed / Invite on claimed land) |
| `migrationSystem` colonise and flee | `if (s.mg !== null) { colonise *= migExit(...); flee *= max(0.4, migExit(...)) }` |
| `migrate()` after the Migration event (join) | `if (s.mg !== null) migArrive(s, s.mg, from, bestJoin, g, refugees ? Refugee : Settler)` |
| `religion/system.ts flightStep` | after its Migration event: `if (s.mg !== null) migArrive(..., Persecuted)` |
| `index.ts` step | `if (mg) migrantsYear(s, mg, trade)` after `voyageSystem`, before `abandonmentSystem` (flows, refugees, integration, remittances; policy on `year % POLITY.step === 0`) |
| `index.ts` snapshot | `if (mg) migrantsSnapshot(s, mg)` |
| `population.ts populationSystem` shortfall deaths | `if (s.mg !== null) lost *= migRelief(s.mg, id)` (welfare, 3.12.2) |
| `polity/danger.ts` fort site | migration motive (3.10.2) when `s.mg !== null` |
| `state.ts abandon` | slots of an abandoned settlement are dropped (their people counted as returned or lost in diag) |

### 3.17 Contract additions (`src/contract.ts`), drafted in the codebase's style
**3.17.1 Enums**
```ts
/** migrants: a polity's border policy (History.migrants.policy). Era-gated: before passports a state controls tolls and frontiers, not entry. */
export const BorderPolicy = {
  Frontier: 0, // no control: anyone may settle or join (stateless lands, the first states)
  Tolled: 1, // entrants pay at the gates and fords; nobody is refused
  Open: 2, // entry free and welcomed
  Quota: 3, // a yearly number admitted; the rest refused (from the age of steel and electricity)
  Skills: 4, // admits those whose skills it rewards (points; from the 20th-century eras)
  Family: 5, // admits kin of those already settled
  Invite: 6, // settlers invited onto thinly settled frontier land (charters, grants)
  Closed: 7, // entry refused; pre-modern: a hostile frontier, mostly unenforced
  Expel: 8, // a people (or faith) ordered out (History.migrants.expulsions)
  Union: 9, // free movement among allied members of a bloc
} as const
export const AsylumStance = { Open: 0, Limited: 1, Refuse: 2 } as const
export const WelfareRegime = { None: 0, Alms: 1, PoorRelief: 2, Liberal: 3, Conservative: 4, SocialDemocratic: 5 } as const
export const IntegrationStance = { LaissezFaire: 0, Assimilationist: 1, Multicultural: 2, Segregationist: 3 } as const
/** How a migrant group came (heritage bookkeeping and the flow layer). */
export const MigrantKind = { Settler: 0, Labour: 1, Irregular: 2, Refugee: 3, Persecuted: 4, Expelled: 5, Return: 6 } as const
export const RefugeeCause = { Sack: 0, Conquest: 1, Disaster: 2, Expulsion: 3, Famine: 4, War: 5, Persecution: 6 } as const
/** Era of a polity for migration (the ruling people's idea era; 7 + FutureEra with future-tech). */
export type MigEra = number
```
Allowed bundles per era (`MIG_BUNDLES[era]`, fixed order, ties to the lower index): era 0–1: (Frontier, Open, LaissezFaire), (Tolled, Open,
LaissezFaire), (Closed, Limited, LaissezFaire), (Invite, Open, Assimilationist); era 2+ adds (Expel, Refuse, Segregationist) and (Tolled, Limited,
Segregationist); era 7+ adds Quota bundles with each stance; era 8+ Skills and Family bundles; era 10+ Union. Total ≤ 14.

**3.17.2 Events 340–348**
```ts
  // migrants: immigration, emigration, borders, refugees, integration (340-349; none when HistoryOptions.migrants is false).
  BorderPolicyChanged: 340, // the polity ruled from `settlement` changed its border policy; `other` -1; `value` the new BorderPolicy; `extra` the old one + 16 * the AsylumStance
  RefugeeWave: 341, // people fled `settlement` (a RefugeeCause in `extra`) and most found refuge at `other`; `value` how many fled in all
  Expulsion: 342, // the polity ruled from `settlement` expelled the people `value` (History.peoples) from its towns; `other` the main refuge (-1); `extra` how many left
  Amnesty: 343, // the polity ruled from `settlement` regularised `value` people living there without leave; `other` -1; `extra` the largest origin people
  DiasporaFounded: 344, // the people `value` became a community of note at `settlement`; `other` the town most came from (-1); `extra` 1 for a trade diaspora (merchant seats or a factory)
  QuarterFormed: 345, // the community of the people `value` at `settlement` came to live apart (a quarter); `other` -1; `extra` 1 when hostility, 0 when its own preference, drove it most
  WelfareRegimeChanged: 346, // the polity ruled from `settlement` changed how it relieves the poor; `value` the new WelfareRegime; `extra` the old
  EmigrationWave: 347, // a decade of heavy emigration from the polity ruled from `settlement` (the town most left from is `other`); `value` emigrants a year; `extra` the main destination polity's capital
  Absorbed: 348, // the community of the people `value` at `settlement`, once at least a tenth of the town, was no longer counted apart; `other` -1; `extra` years since its diaspora was founded
```
Missing-settlement rule (as disasters 2.4): an event needs a living `settlement`; otherwise only the row is written.

**3.17.3 History tables**
```ts
/** migrants: borders, flows and communities (HistoryOptions.migrants; absent when off). Snapshots follow History.snapshotInterval. */
export interface Migrants {
  /** Per snapshot per polity (row-major snapshotCount × P, ragged like polity tariffs): BorderPolicy, AsylumStance, WelfareRegime, IntegrationStance,
   *  enforcement, generosity, nativist opinion and coalition (×255). */
  policy: Uint8Array; asylum: Uint8Array; welfare: Uint8Array; integration: Uint8Array
  enforcement: Uint8Array; generosity: Uint8Array; nativism: Uint8Array; coalition: Uint8Array
  /** Sparse heritage per snapshot: rows heritageOffsets[q] .. heritageOffsets[q + 1] give settlement, people and first/second/irregular share (×255) and segregation. */
  heritageOffsets: Uint32Array; heritageSettlement: Int32Array; heritagePeople: Int16Array
  heritageFirst: Uint8Array; heritageSecond: Uint8Array; heritageIrregular: Uint8Array; heritageSegregation: Uint8Array
  /** Decadal flows between polities (rows in decade order, then origin, then destination): decade start year, origin and destination polity
   *  (-1 stateless), MigrantKind, people a year, deaths en route a year (expected), remittances back a year. */
  flows: { count: number; decade: Int16Array; from: Int16Array; to: Int16Array; kind: Uint8Array; people: Float32Array; died: Float32Array; remit: Float32Array }
  /** One row per refugee wave, expulsion and amnesty (event `value`s point here where a row is needed). */
  waves: { count: number; year: Int16Array; origin: Int32Array; cause: Uint8Array; people: Float32Array; returned: Float32Array }
}
// History: migrants?: Migrants.   HistoryOptions: migrants?: boolean  // migration and borders (needs polities); default false until tuned
// JourneyKind: Refugees: 5, // migrants: people fleeing a sack, conquest, disaster or expulsion to `to`
```

---

## 4. Step order and determinism
- **Placement** [V index.ts:536–538]: `migrationSystem → voyageSystem → migrantsYear → abandonmentSystem → … politySystem`. Inside `migrantsYear`, fixed order:
  (1) event scan from `evSeen` (refugee triggers, ascending event index); (2) refugee release (pools in settlement id order); (3) labour flows
  (origins ascending, their pairs in k order); (4) returns; (5) integration, generations, segregation (ascending id); (6) remittances;
  (7) on `year % POLITY.step === 0`: prestige, opinion, enforcement, policy, welfare, expulsions, amnesties (polities ascending in `ps.alive`);
  (8) host index rebuild. Policy runs before politySystem's step of the same year and reads last step's polity state (one-step lag, documented).
- **RNG**: `'history-migrants'` only; draws only in (7): one per eligible polity for Expel (if the gate passes), one for Amnesty. Gates draw nothing.
  Flows, refugees, integration, remittances and policy choice are RNG-free (accumulators, argmax, counter-based hash noise).
- **Off identity**: with `migrants` false no state is created, no hook multiplies (skipped, not ×1), the stream is never created ⇒ every existing
  stream sees the same draws in the same order. Test `migrants-off ≡ main` on seeds 1, 42, 1234 × 600 years: all History fields equal.
- **Golden hashes** (perf-efficiency's `923881e7cd3fe59b` seed 1, `3bac8db3dfd723b5` seed 42, `2bb9f72e9e99433d` seed 1234 at 2000 y): unchanged
  with the option off. With it on, the golden test filters out `migrants` and compares only when on — a new golden set is recorded at step 11.
- **Prefix stability**: a longer run repeats a shorter one up to its end (no look-ahead; decadal flow rows are written at the decade's end and
  the partial decade is flushed at assembly from accumulators, never back-written).
- **Floating point**: only `+ − × /`, sqrt, floor; smoothstep from util.ts; shares are Float32 in state but every update is computed in Float64 then
  stored (the codebase's pattern for snapshots).

---

## 5. UI and prose

### 5.1 Map: migration flows (`render/migrationFlows.ts`, toggle "Migration" in the layers menu, beside Journeys)
- Data: `History.migrants.flows` by decade. For the shown year, the rows of its decade and the previous one (cross-faded by year).
- Arcs between the origin and destination polities' **centres of their emigrant / immigrant towns** (pop-weighted, from heritage snapshots), lifted
  great-circle curves (routeCurves.ts sampling), width ∝ sqrt(people), colour by kind: labour amber, refugees pale blue, irregular dashed amber,
  return thin grey, expelled deep red-violet (sober, no flashing). Animated dashes move along the arc at a speed ∝ flow; a small count label on hover.
- Refugee waves also show their Journeys (JourneyKind 5) as trails in the Journeys layer (journeys.ts: a separate colour; same buffers).
- Heritage view: `ViewMode.Heritage = 'heritage'` (palette.ts): settlement markers tinted by foreign-heritage share; quarters ringed.
- Phones: arcs ≤ 40 drawn (largest first), labels on tap.

### 5.2 Polity immigration panel (`ui/politiesPanel.ts`, Factions detail → tab "Migration"; `ui/migrantsData.ts` readers)
Chips: border policy (since year), asylum stance, welfare regime, integration stance; bars: enforcement E and its yearly cost, generosity;
numbers: foreign-born share, second generation, irregular (labelled "estimate"), inflow / outflow a year (sparklines over the shown century),
remittances in and out, deaths en route (rounded, "recorded on the way"), refugees hosted; lists: top origin peoples (shares), diasporas abroad
(host towns); opinion: nativist N vs coalition C with what drives each (the largest terms); "How others see it": prestige by the three peoples
that know it best. Settlement card: heritage slots (people, first/second generation, quarter), year the community began.

### 5.3 Chronicle (`ui/migrantsFormat.ts` describeEvent; category 'society'; filter group "Migration" in chronicleFilter.ts). Plain, hedged:
- 340: "In 1412 the crown at Vebena closed its frontier to newcomers; the records speak of the fords watched and tolls doubled."
- 341: "After the sack of Hessa in 1301 perhaps two thousand of its people fled; most found refuge at Oruma."
- 342: "In 1488 the court at Kubeta ordered the Temuk of its towns to leave. About three thousand went, most to Lessa."
- 343: "In 1902 Lessa allowed some four thousand who had settled without leave to stay."
- 344: "By 1580 the Temuk had become a community of note at Lessa, most of them from the hill towns of Aram."
- 345: "The Temuk of Lessa came to live in a quarter of their own; the sources suggest they were pressed into it."
- 346: "From 1620 the parishes of Vebena relieved their own poor; newcomers were relieved only after five years' residence."
- 347: "In the decade after 1840 many left Aram each year, most for Lessa."
- 348: "By 1730 the Temuk of Lessa were no longer counted apart; their names had passed into the town's."
- Nativist movement (riots 285 with kind Nativist): "A movement arose at Vebena that held the newcomers to be a danger to the realm; its
  preachers claimed the Kubetans stood above other peoples." (the claim is always attributed).

### 5.4 Sagas (`ui/sagas/migration.ts`: phrase table `MIG_T`, `[chronicle], [legend]`; used by state.ts, city.ts, people.ts, year.ts)
- People saga: "The Wanderings" chapter (emigration waves, diasporas, returns); state saga: who it let in and who it drove out; city saga: its
  communities and quarters; year saga: waves of that year.
- Legend register examples (heightened, not glorifying harm): "They came over the passes with nothing but their names, and Lessa took them in."
  / "In 1488 the gates of Kubeta were shut against the Temuk, and a people that had lived there four generations took the road." / "Many set out
  across the strait; not all came to the far shore." / "Aram emptied as the young went west, and the money they sent home roofed its houses."
- Partisan (experience 3.2) with a people pov: the expelled people's teller uses `expelled.us` ("our people were driven from Kubeta"), the
  expelling state's teller uses neutral administrative wording (`expelled.foe` never praises it: "the court ordered the Temuk out"), and the
  "Partisan: numbers and blame are the teller's" tag applies.

### 5.5 Story director (experience 0.1; `registerDrama` from migrantsFormat.ts)
340 Politics B 3 (×1.5 for Closed/Expel); 341 Society B 5, mag = people fled; 342 Politics B 6, mag = people expelled; 343 Politics B 3;
344 Society B 2; 345 Society B 3; 346 Society B 2; 347 Society B 4, mag = emigrants a year; 348 ignored (DRAMA_IGNORED; told in sagas only). [A]

### 5.6 Tone rules (tests in step 9)
No phrase in either register celebrates an expulsion, an attack or deaths en route; deaths are counted, rounded and stated once ("many did not
arrive"; "about 300 are thought to have died on the way"); victims are named only as a people or a faith; nativist doctrine is always attributed
to the movement ("held", "claimed"); no people is described as better or worse in the narrator's voice. A word-list test rejects a fixed list of
slurs and glorifying verbs in `MIG_T` and in assembled saga text for seeds 42 and 1234.

---

## 6. Ordered commit-sized steps (each: `npm test`, `npm run typecheck` green)
1. **Contract, options, empty plumbing**: enums, events 340–348, `Migrants` table, `HistoryOptions.migrants`, JourneyKind 5; `migrants/state.ts`
   with growth helpers; `s.mg = null` default. Test: off ≡ main (600 y, seeds 1, 42, 1234).
2. **Heritage bookkeeping only**: `migArrive` hooked into migrate() and flightStep (no behaviour change: the slots only record); generations,
   assimilation, rescaling; sparse snapshots; assembly. Tests: slot shares in [0, 1], sum ≤ 1; with migrants on but all other rules disabled
   (`MIG.passive`), every non-migrants History field equals main (pure overlay); half-life of a lone slot ≈ 23 y.
3. **Prestige, utility, era** (`MigEra` with proxies): pure reads; harness prints them. Test: symmetry (permute people ids in a synthetic state).
4. **Join and exit hooks** (`migJoin`, `migSite`, `migExit`) with policy fixed at Frontier: network and utility shape where groups go.
   Harness: network share ≥ target, total moves within ±15 %.
5. **Labour flows** (flows.ts) with route candidates, accumulators, Journeys. Tests: one Journey per Migration event; flows obey room and food;
   no same-people internal labour moves.
6. **Refugees** (refugees.ts): triggers, `seekRefuge` export in migration.ts (shadow search, no draw), waves, return; RefugeeWave events; Journeys kind 5. Tests: event fields valid;
   pools empty in refYears; sacked-town departure multiple ≥ 5× on all seeds.
7. **Border policy and enforcement** (policy.ts), finances hook, fort motive, BorderPolicyChanged; menus by era. Tests: no Quota before era 7
   (forced-era test helper), enforcement in [0, 1], spending booked.
8. **Irregular channel, smuggling hubs, abstract risk, amnesty** (draws begin). Tests: smugYear grows on irregular routes; SmugglingRing reachable;
   deaths ≤ crossers; amnesty zeroes oIrr.
9. **Welfare regimes and fiscal balance** (welfare.ts), relief hook in populationSystem, WelfareRegimeChanged. Tone-rule tests for MIG_T (5.6).
10. **Opinion, coalition, policy choice, expulsion, Nativist movement hooks into riots and court** (null-guarded proxies first). Tests: symmetry
    test on full runs (people ids permuted via a test-only remap: flows and stocks equal up to the permutation); expulsion rate ≤ target.
11. **Remittances, brain drain / gain, emigration waves, diasporas, quarters, Absorbed**; record new goldens with the option on.
12. **UI**: migrantsData, Migration tab, settlement card, Heritage view, migrationFlows layer, chronicle lines, MIG_T sagas, director rules.
13. **Seat-mode**: DecisionKind 28 Borders, 29 Refugees; OrderKind 42 Gates (polity → bundle index), 43 Asylum (stance), 44 Amnesty (now).
14. **Tuning and the switch** (7): realism guard off vs on; 22-seed sweep; flip the default to true.

---

## 7. Stats harness (`src/sim/history/migrants/migrantsStats.ts [--off] [--json] seeds…`; seeds 1, 7, 42, 1234; 2000 years; `--years 6000` with tech/future on)
With `--off` it runs the shadow stock of probe-migration.ts (the baseline in 1.2); with the option on it reads `History.migrants`.

### 7.1 Measures
Moves per 1000 a year by era bin and kind; cross-border and cross-people shares; world first-generation and heritage stock shares by era;
top host polity's foreign-born share; departures after shocks (multiples, by cause); network share (arrivals where own people ≥ 2 %);
top-3 host concentration per people; diasporas, quarters, Absorbed counts and diaspora half-lives; policy-years by bundle and era; policy
changes per polity-century; expulsions and amnesties per 1000 polity-years; irregular share; deaths per 1000 crossers; remittances / origin
wealth; emigration vs origin wage index (binned, the hump shape); share of Nativist movements per town-step with m ≥ 0.1.

### 7.2 Targets [A unless cited]
| measure | target | why |
|---|---|---|
| total moves per 1000 a year, 1750–2000 | 0.6–1.2 (baseline 0.70–0.78 [M]) | structure, not volume; modern 5-y international flows ≈ 0.6 % of the world ≈ 1.2 per 1000 a year (Abel & Sander 2014) |
| world first-generation cross-border stock, era ≤ 4 (sim ≤ ~1600) | 0.3–2 % | no reliable pre-modern data; design band around the baseline 0.2–1.9 % [M] |
| world first-generation stock, era 7 (mass migration) | 1.5–5 % | — (Hatton & Williamson 1998 give volume, not a world share) |
| world first-generation stock, era 8–10 (6000-y runs) | 2.5–4.5 % | UN DESA 2021: ≈ 3.6 % in 2020 |
| refugees among first generation, era ≥ 8 | 5–20 % | UN DESA 2021: 12 % in 2020 |
| top host polity foreign-born share, era 7 | 10–35 % | design band [A] |
| departures within 6 y after a sack / foreign conquest / destroyed town | ≥ 5× / 2–5× / ≥ 3× baseline (now 0.35–2.6 / 0.8–2.1 / —) | wars and sacks drive flight |
| famine response | stays 4–9× (now 5.7–7.5 [M]) | unchanged channel |
| network share (cross-people arrivals into own-people ≥ 2 %), after era 3 | 0.6–0.85 (now 0.2–0.57 [M]) | chain migration (MacDonald & MacDonald 1964; Massey et al. 1993) |
| peoples with ≥ 100 abroad at 2000 | ≥ baseline (3–10) and top-3 host share median 0.5–0.9 | clustering without monopoly |
| heritage half-life (second generation into host) | 20–60 y | "third generation" (Alba et al. 2002, finding [unverified]) |
| quarters | 5–30 % of diasporas | — |
| expulsions | 0.3–3 per 1000 polity-years; never in era 0–1 | rare but real |
| amnesties | only where irregular ≥ 4 % | — |
| policy changes | 0.5–3 per polity-century (era ≥ 7); ≤ 1 before | Freeman 1995: resistant to sharp swings |
| deaths en route | ≤ 2 % of irregular crossers; ≈ 0 for legal flows | abstract (IOM: > 50,000 documented 2014–2023 — an undercount) |
| hump shape | reported, not scored: with humpRise 0.5 the binned emigration rate peaks at w ≈ 1.3–2 | [D] (de Haas 2010 vs Schneiderheinze & Benček 2024) |
| welfare magnet | flows with magnet 0.3 vs 0: destination shares change ≤ 10 % | [D] small by construction |
| Nativist movements | in 10–40 % of towns that reach m ≥ 0.1 within 50 y | — |
| symmetry | exact (people-id permutation) | principle 3.1 |

### 7.3 Realism scorecard (realism-metrics.md 6)
Off vs on with `realismStats.ts --from off.jsonl --vs on.jsonl` (seeds 1, 7, 42, 1234; then the 22-seed sweep). Baseline (theirs, [M] at 8cabf09):
score 0.404, 45/104 in range; `urb2000.u10` 0.19–0.41 (already above band), `zipf2000.primacy` 1.14–1.46, `gibrat1500.beta` −0.002–0.023.
- **Guard**: score rise ≤ 0.03; no WORSE flag. Specific: `gibrat{1000,1500}.beta` ≤ 0.03 (flows favour big rich towns: the main risk),
  `urb*.u10` not up by > 0.02 (labour flows exclude internal same-people moves; Harris–Todaro employment caps), `grav*.ppmlDist` unchanged ±0.05.
- **Intended to improve**: `zipf2000.primacy` toward 2 (immigrant capitals and ports grow), `pop.worst50yFall` slightly (expulsions and refugee
  losses on the origin) — both small; this plan is not a realism fix.

---

## 8. Performance and memory [A, from the counts in 1.2]
- Per settlement: 3 slots × (2 + 4·6 + 1 + 1) bytes + pairs 4 × 12 + 12 ≈ 150 B. At 10–20 k settlements ever: 1.5–3 MB (state, grown by doubling).
- Yearly: integration over settlements with any slot (≤ 1–3 k late) × 3 slots; flows: origins with pairs (≤ living) × 4 → ≤ 80 k ops; candidate
  rebuild every 5 y: route CSR (as flightStep, O(routes + S)). Refuge searches: one shadow siteSearch per refugee group (≤ 3 per pool a year, a few pools a year): ≪ migration's own ~1–2 k searches a year late in a run [A].
- Hot loop: `migJoin` is one call per occupied cell reached in siteSearch (not per cell): a slot scan (3) and two table reads (utility cached
  per settlement per year, prestige per (people, polity) per step: P × pcap ≤ 16 × 200 floats). Expected +2–4 % on migrationSystem, which is
  itself a minor share of the year [A; measure in step 4 with perf-efficiency's tracer].
- Snapshots: sparse heritage ≈ 500 rows × 400 snapshots × 9 B ≈ 1.8 MB at 2000 y (6000 y: ≈ 6 MB, rows grow with diasporas; cap with snapMin).
  Policy per snapshot per polity: 8 B × P × 400 ≈ 0.6 MB. Flows: ≤ 200 decades × ≤ 300 rows × 19 B ≈ 1.1 MB.
- Total run-time overhead target ≤ 5 % (2000 y, seed 42); memory ≤ +10 MB at 6000 y.

---

## 9. Risks and open questions

### 9.1 Risks
- **One people per settlement**: heritage is an overlay; a town that becomes 70 % Temuk still has its founder's people for tech, knowledge and
  ruling-people logic. Acceptable in v1 (language-drift renders the shift; 0.4). A later `PeopleShift` (a town's `s.people` flips after a long
  majority) would touch tech, knowledge and polities' pPeople everywhere — out of scope, flagged.
- **Gibrat / primacy drift** from network and wealth pull (guards in 7.3); mitigation: employment saturation, room test, chunked moves.
- **Double counting** with existing push migration and religion flight: every existing channel only **tags** (migArrive); only Sack, foreign
  Conquest, Disaster and Expulsion add new departures.
- **Era gates leave 2000-year runs pre-modern**: Quota, Skills, Family and modern welfare appear only with tech-tree / future-tech and longer
  runs. Tests force eras with a helper (`MIG.forceEra`, test-only).
- **Tone and fairness**: expulsions, quarters and nativist doctrine are sensitive. Mitigations: 3.1 principles, the symmetry test, attributed
  doctrine, word-list test, owner review of `MIG_T` before step 12 merges.
- **Contested parameters** (hump, welfare magnet, selection direction): exposed, defaults small, harness reports alternatives.
- **Coupling chains** (opinion → policy → flows → opinion) may oscillate: inertia and the 5-year step damp it; the harness counts policy changes.
- **Registry drift**: MIR, future-tech and future-politics are being written in parallel (future-tech and future-politics both claim RevoltCause 17;
  not this plan's values). This plan's values are read by name; shift them if the registry moves.

### 9.2 Open questions
1. Should the expectation of amnesty raise irregular attempts (moral hazard)? Left out (no source checked); a parameter could be added.
2. Should welfare regimes be chosen here or by MIR / future-politics? Here with proxies; MIR may take the choice and leave the effects here.
3. Minority languages as speech rows (a Temuk-speaking quarter in Lessa) in language-drift: desirable for the inspector; needs their table change.
4. Internal migration between towns of one people inside a polity (rural–urban) stays migration.ts's: should labour flows include it once the
   realism `u10` measurement is fixed (realism-metrics step 5)?
5. Citizenship / naturalisation as a separate status (now: second generation = citizen; first generation never). Add with MIR's regimes?
6. Forced labour migration (slave trades, indenture) is not modelled here; it would need its own sober design and owner decision.

### 9.3 Verified [V] / measured [M] / assumed [A]
- [V] migration.ts (`migrationSystem`, `siteSearch`, `migrate`, join tests, one Journey per Migration event), polity/system.ts (`fleeChance`,
  `siteFactor`, `joinFactor`, `joinBlocked`, `refugeeKnowledge`), polity/unrest.ts (assim 0.004), polity/policy.ts (`enforcement`, smuggling σ),
  polity/outlaw.ts (hubs, `smugYear`, rings), polity/danger.ts (forts), religion/system.ts (`flightStep`, `mixInto`, `fleeSkills`), peoples.ts
  and state.ts (`s.people` fixed at founding), index.ts (system order, streams, arithmetic rule), contract.ts (EventType numbering, JourneyKind,
  StructureType), ideas/params.ts (`era` 0–4), render/journeys.ts (trails).
- [M] all of 1.2 (probe-migration.ts, 4 seeds × 2000 y).
- [A] every constant in 3.3 and the formulas' functional forms; targets marked [A] in 7.2; perf estimates in 8.
- Plans read: society-secular-cycles, state-finances, riots-uprisings, merchant-families, language-drift, disasters-climate, battles,
  court-politics, future-politics, future-tech, tech-tree-innovation, infrastructure (its migration hooks), realism-metrics, experience-whatif-director-sagas, grudges-and-oaths
  (GrievanceKind), city-states (registry). **modern-ideologies-regimes.md did not exist** at the final check (19:5x, 2026-11-26): MIR reads are
  provisional names with proxies.

---

## References
(Tag = what I confirmed this session. "page" = publisher, repository or catalogue record opened.)
- Abel, G. J. & Sander, N. (2014). Quantifying global international migration flows. *Science* 343(6178), 1520–1522. doi:10.1126/science.1248676 [verified: phys.org report of the paper, with citation and the ~0.6 % finding]
- Alba, R., Logan, J., Lutz, A. & Stults, B. (2002). Only English by the third generation? *Demography* 39(3), 467–484. doi:10.1353/dem.2002.0023 [verified: RePEc record; finding not read]
- Beine, M., Docquier, F. & Rapoport, H. (2001). Brain drain and economic growth: theory and evidence. *Journal of Development Economics* 64(1), 275–289. doi:10.1016/S0304-3878(00)00133-4 [verified: IDEAS record and abstract; DOI built from the PII shown there]
- Berry, J. W. (1997). Immigration, acculturation, and adaptation. *Applied Psychology* 46(1), 5–34. doi:10.1111/j.1464-0597.1997.tb01087.x [verified: Scilit record; content unverified]
- Blau, F. D. & Mackie, C. (eds.) (2017). *The Economic and Fiscal Consequences of Immigration*. National Academies Press. doi:10.17226/23550 [verified: NAP chapter page and table list]
- Borjas, G. J. (1987). Self-selection and the earnings of immigrants. *American Economic Review* 77(4), 531–553. https://ideas.repec.org/a/aea/aecrev/v77y1987i4p531-53.html [verified: IDEAS record; NBER w2248 abstract]
- Borjas, G. J. (1999). Immigration and welfare magnets. *Journal of Labor Economics* 17(4), 607–637. doi:10.1086/209933 [verified: IDEAS record and abstract]
- Card, D., Dustmann, C. & Preston, I. (2012). Immigration, wages, and compositional amenities. *Journal of the European Economic Association* 10(1), 78–119. doi:10.1111/j.1542-4774.2011.01051.x [verified: EconPapers record; finding not read]
- Clemens, M. A. (2014). Does development reduce migration? IZA Discussion Paper 8592. https://econpapers.repec.org/RePEc:iza:izadps:dp8592 [verified: record and abstract]
- Curtin, P. D. (1984). *Cross-Cultural Trade in World History*. Cambridge University Press. https://econpapers.repec.org/RePEc:cup:cbooks:9780521269315 [verified: record]
- de Haas, H. (2010). Migration transitions: a theoretical and empirical inquiry into the developmental drivers of international migration. IMI Working Paper 24, University of Oxford. https://www.oxfordmartin.ox.ac.uk/publications/migration-transitions-a-theoretical-and-empirical-inquiry-into-the-developmental-drivers-of-international-migration [verified: page]
- Docquier, F. & Rapoport, H. (2012). Globalization, brain drain, and development. *Journal of Economic Literature* 50(3), 681–730. doi:10.1257/jel.50.3.681 [verified: EconPapers record and abstract]
- Esping-Andersen, G. (1990). *The Three Worlds of Welfare Capitalism*. Princeton University Press. ISBN 0-691-02857-5. https://press.princeton.edu/node/28277 [verified: Wikipedia summary of the regimes; ISBN from the Cambridge review record's title]
- Freeman, G. P. (1995). Modes of immigration politics in liberal democratic states. *International Migration Review* 29(4), 881–902. doi:10.1177/019791839502900401 [verified: Scilit record and abstract; author from the search listing]
- Giulietti, C., Guzi, M., Kahanec, M. & Zimmermann, K. F. (2013). Unemployment benefits and immigration: evidence from the EU. *International Journal of Manpower* 34(1), 24–38. doi:10.1108/01437721311319638 [verified: IDEAS record and abstract]
- Hainmueller, J. & Hopkins, D. J. (2014). Public attitudes toward immigration. *Annual Review of Political Science* 17, 225–249. doi:10.1146/annurev-polisci-102512-194818 [verified: Refugee Economies record and abstract]
- Harris, J. R. & Todaro, M. P. (1970). Migration, unemployment and development: a two-sector analysis. *American Economic Review* 60(1), 126–142. JSTOR 1807860 [verified: Wikipedia article with citation and the equilibrium condition]
- Hatton, T. J. & Williamson, J. G. (1998). *The Age of Mass Migration: Causes and Economic Impact*. Oxford University Press. ISBN 9780195116519 [verified: EconPapers record and abstract]
- IOM Missing Migrants Project (2023). "IOM decries 50,000 documented deaths during migration worldwide". https://www.iom.int/news/iom-decries-50000-documented-deaths-during-migration-worldwide [verified: page]
- Lee, E. S. (1966). A theory of migration. *Demography* 3(1), 47–57. doi:10.2307/2060063 [verified: IDEAS record]
- Lindert, P. H. (2004). *Growing Public: Social Spending and Economic Growth since the Eighteenth Century*. Cambridge University Press. doi:10.1017/CBO9780511510717 [verified: Cambridge page]
- MacDonald, J. S. & MacDonald, L. D. (1964). Chain migration, ethnic neighborhood formation and social networks. *Milbank Memorial Fund Quarterly* 42(1), 82–97. doi:10.2307/3348581 [verified: Milbank PDF (authors, definition); volume/issue from its URL; DOI from a library catalogue URL]
- Massey, D. S., Arango, J., Hugo, G., Kouaouci, A., Pellegrino, A. & Taylor, J. E. (1993). Theories of international migration: a review and appraisal. *Population and Development Review* 19(3), 431–466. doi:10.2307/2938462 [verified: Princeton record; network and cumulative-causation text read]
- Massey, D. S., Durand, J. & Pren, K. A. (2016). Why border enforcement backfired. *American Journal of Sociology* 121(5), 1557–1600. doi:10.1086/684200 [verified: Princeton record and abstract]
- Mudde, C. (2007). *Populist Radical Right Parties in Europe*. Cambridge University Press. doi:10.1017/CBO9780511492037 [verified: Cambridge page]
- Portes, A. & Zhou, M. (1993). The new second generation: segmented assimilation and its variants. *Annals of the AAPSS* 530, 74–96. doi:10.1177/0002716293530001006 [verified: IDEAS record and abstract]
- Ravenstein, E. G. (1885). The laws of migration. *Journal of the Statistical Society of London* 48(2), 167–235 [verified-search: the laws as summarised on the Ravenstein Wikipedia page (CSISS); journal volume and pages unverified: JSTOR not reachable]
- Roy, A. D. (1951). Some thoughts on the distribution of earnings. *Oxford Economic Papers* 3(2), 135–146. doi:10.1093/oxfordjournals.oep.a041827 [verified: Wikipedia "Roy model" citation]
- Schelling, T. C. (1971). Dynamic models of segregation. *Journal of Mathematical Sociology* 1(2), 143–186. doi:10.1080/0022250X.1971.9989794 [verified: Wikipedia article]
- Schneiderheinze, C. & Benček, D. (2024). Higher economic growth in poor countries, lower migration flows to the OECD — revisiting the migration hump with panel data. *World Development* 182, 106655. doi:10.1016/j.worlddev.2024.106655 [verified: Kiel Institute page]
- Stark, O. & Bloom, D. E. (1985). The new economics of labor migration. *American Economic Review* 75(2) [verified-search: authors, year, journal on migrationresearch.com; pages unverified]
- Torpey, J. (2000). *The Invention of the Passport: Surveillance, Citizenship and the State*. Cambridge University Press. https://search.worldcat.org/oclc/59408523 [verified: WorldCat record (year, publisher, summary); author from the search listing]
- UN DESA (2021). "International Migration 2020 Highlights" press release DEV/3436. https://press.un.org/en/2021/dev3436.doc.htm [verified: page]
- UNHCR (2024). *Global Trends: Forced Displacement in 2023*. https://data.unhcr.org/en/documents/details/109334 [verified: page]
- UNODC (2018). *Global Study on Smuggling of Migrants 2018*. doi:10.18356/c7955797-en; summary https://www.unodc.org/unodc/en/frontpage/2018/June/at-least-2-5-million-migrants-smuggled-worldwide-in-2016--says-unodc-study.html [verified: press page]
- World Bank (2024). "Remittances slowed in 2023, expected to grow faster in 2024" (Migration and Development Brief 40). https://www.worldbank.org/en/news/press-release/2024/06/26/remittances-slowed-in-2023-expected-to-grow-faster-in-2024 [verified: page]
- Zelinsky, W. (1971). The hypothesis of the mobility transition. *Geographical Review* 61(2), 219–249. doi:10.2307/213996 [verified: Wikipedia "Zelinsky model" citation and phases]

## Addendum (central registry)
Renumbered: OrderKind 59–61 (not 42–44) and DecisionKind 45–46 (not 28–29); character-mode holds 41–58 / 27–44. See _CONVENTIONS.md.
