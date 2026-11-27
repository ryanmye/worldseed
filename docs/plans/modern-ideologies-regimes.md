# Plan: Modern ideologies and the regimes they make possible (hard to form, late, often failing)

Plan only. Code: read-only checkout `/home/claude/ryanmye/worldseed` @ 8cabf09. Probes ran on the scratch copy
`/home/claude/scratch-ideologies` (`scripts/ideoProbe.ts`, `node --experimental-strip-types`, default options, 2000 years).
Tags: **[V]** read in the 8cabf09 tree (file:function), **[M]** measured on the scratch copy, **[A]** assumed (a design default
or a constant to tune, not a fact), **[D]** a claim cited as contested. Citations follow the `_CONVENTIONS.md` citation rule:
inline (Author Year), each tagged **[verified]** (a page confirming the work was opened this session: a publisher, RePEc,
library, archive or encyclopedia page), **[verified-search]** (title, authors, venue and year confirmed in a search listing of
the publisher's or an index's page, but the page itself was not opened) or **[unverified]** (reason given). Every number without
a citation is a design default. Full list in **References** at the end.

- **EventType block 310–319** (given to this plan; all used, 5.2).
- **Off switch** `HistoryOptions.ideologies` (default `false` until the harness passes, then `true`). **RNG stream**
  `'history-ideology'`, created only when on. **Module** `src/sim/history/ideology/`.
- **Depends on (hard):** polities, ideas (both in repo). **Depends on (soft, each with a proxy, section 0.4):** tech-tree-innovation
  (TTI: literacy, newspapers, factories, industrial index; without it doctrines that need industry never form), riots-uprisings
  (movements, revolutions, repression), city-states (the `Government` log and `setForm`), court-politics (regimes of monarchies,
  assemblies), society, state-finances, rulers (repo), religion (repo), battles, grudges, beliefs, seat-mode, experience/sagas,
  language-drift (names only). **Build order:** after TTI and riots-uprisings; after city-states and court-politics if built; before
  future-politics and future-tech's ideology hooks.
- **Generic by design (coordinator requirement).** Ideologies, regimes and transition routes are **registered rows** in three
  tables (`IDEOLOGIES`, `REGIMES`, `ROUTES`, section 1). This plan registers 11 ideologies, 7 regimes and ~30 routes; future-politics
  appends its own rows through the same three functions without forking any code.

---

## 0. Interfaces (one contract for the implementer)

### 0.1 Ids and enum values
Read from `_CONVENTIONS.md` (registry) and the sibling plans before finishing. Build order puts this plan **after TTI and before
future-politics**; future-politics' own rule ("if a plan earlier in the build order took one, shift up") applies to the rows marked ⇧.

| what | values (this plan's) | note |
|---|---|---|
| EventType | **310–319** (5.2) | block given to this plan |
| IdeaKind | **10 Ideology** | registry (coordinator, 2026-11-26): TTI 8 Industry, 9 Communication; 10 Ideology (this plan; future-politics reuses it); future-tech 11–15 |
| RevoltCause | none new | riots' `Ideology 13` carries every program; the movement row says which ideology |
| MovementKind (riots 4.8) | **5 Ideology** (one value; the movement row's `anchor` is the `IDEOLOGIES` id) | riots uses 0–4. future-politics needs **no** MovementKind of its own (its 0.1 row "none if MIR's movement carries an ideology id": it does) |
| Government (city-states 3.1) | **7 ConstitutionalRepublic, 8 PartyState, 9 Junta, 10 Dictatorship, 11 TheocraticRepublic** | city-states 0–6. future-politics assumed 7–15 reserved for this plan and starts at 16: unchanged. 12–15 left free |
| GovernmentCause | **13 Revolution, 14 Reform, 15 Coup, 16 Elected, 17 SelfCoup, 18 Restored, 19 Thermidor, 20 Imposed, 21 Collapse, 22 Handover** | city-states 0–12; future-politics assumed 13–29 reserved and starts at 30: unchanged |
| ReignEnd | **12 Abolished** (the throne itself was abolished), **13 Voted** (an elected head turned out at an election) | ⇧ future-politics claimed 12–13 provisionally: it shifts to 14–15 |
| GrievanceKind | **14 Subversion** (a foreign power sponsored a movement that rose against the wronged) | ⇧ future-politics' 14 Drained → 15 |
| OrderKind | **41 Franchise, 42 Sponsor, 43 Censor** | after TTI's 39–40. ⇧ future-politics' 39–41 → 44–46; `ORDER_KIND_COUNT` → 44 here |
| seat DecisionKind | **27 Franchise, 28 RevolutionAbroad, 29 ArmyDemands** | after TTI's 25–26. ⇧ future-politics' 25–27 → 30–32 |
| AccessionHow | none (Elected, Usurped, Founded cover every head here) | future-politics' 7–10 unchanged |
| new enums (this plan's, 5.1) | `ModernRegime`, `RegimeFamily`, `Carrier` (bits), `Demand` (bits), `SpreadVia` (bits), `BrintonStage`, `RevolutionEnd`, `ElectionOutcome`, `CoupKind`, `ExportKind` | 5.1 |
| RNG stream | `'history-ideology'` | created only when on |
| HistoryOptions | `ideologies?: boolean` | needs polities and ideas |

**Asked of the coordinator** (registry line): "modern-ideologies-regimes: events 310–319, IdeaKind 10, MovementKind 5, Government 7–11,
GovernmentCause 13–22, ReignEnd 12–13, GrievanceKind 14, OrderKind 41–43, DecisionKind 27–29; future-politics shifts ReignEnd → 14–15,
GrievanceKind → 15, OrderKind → 44–46, DecisionKind → 30–32."

### 0.2 The generic registry (for future-politics; section 1 gives the full types)
```ts
// ideology/registry.ts — imports only types, smoothstep and contract enums (no system module), so any plan can register rows.
registerIdeology(def: IdeologyDef): number   // returns the ideology id (registration order); throws on a duplicate key
registerRegime(def: RegimeDef): number       // returns the ModernRegime value; def.gov is the Government value it writes
registerRoute(def: RouteDef): number         // appended to the walk order of every `from` regime it lists
registerProgram(ideologyKey: string, fn: ProgramFn): void   // what a revolution won by this ideology installs
registerAffinity(a: string, b: string, aff: number): void   // regime-family or ideology affinity for blocs, -1..1
walkHazards(h: Float64Array, n: number, u: number, cap: number): number   // court-politics 3.4 format: first k with u < Σ_{j≤k} h_j, -1 none
ideoShare(s, p, k): number                   // pop-weighted adherent share of ideology k among p's members, 0..1 (O(members) cached per slow step)
ideoRegime(s, p): number                     // ModernRegime of p, 255 for a traditional polity
ideoFranchise(s, p): number; ideoContest(s, p): number      // Dahl's inclusiveness f and contestation c, 0..1
ideoFamily(s, p): number                     // RegimeFamily of p (REGIME_FAMILY of its regime, Traditional for 255)
```
**Registration order is the id order** and is fixed by one file, `ideology/catalogue.ts`, which imports, in this order:
`ideology/rows.ts` (this plan) then, when built, `futurepol/rows.ts` (future-politics). A test asserts that this plan's ids are the same
with and without the future-politics rows (append-only). Rows of a plan whose option is off are still registered (ids stable) but
`active(s)` returns false, so they draw nothing and are invisible in History (1.5).

### 0.3 TTI (tech-tree-innovation.md 0.2/0.5): keys and hooks used, through one indirection table
```ts
/** Keys of tech-tree-innovation ideas this plan hangs doctrines on (resolved by ideaIndex at load; -1 when techTree is off). */
export const TTK = { press: 'newspaper', school: 'massSchooling', factory: 'factory', rail: 'railway', telegraph: 'telegraph',
  drill: 'drill', debt: 'publicDebt', stock: 'jointStock', university: 'university' } as const
```
- Hooks read: `ideaIndex`, `ideaHeld`, `ideaIntensity`, `ideaLiteracy` (L), `ideaIndustrial` (X, wage-labour share), `ideaOpenness` (O).
- **Doctrines name only v1 keys in `pre`** (`printing`, `lawCode`, `banking`, `science`, `writing`), so `PRE` never throws with techTree off
  (TTI 0.5's warning). TTI keys enter through `cond` as `held(TTK.x)` with a proxy when `ideaIndex(TTK.x) < 0`.
- Doctrine rows use TTI's pressure channels via `press: { c: { Open: 1, Shock: 0.5, Frag: 0.5 } }` (TTI 0.3) when TTI is on; TTI's bans
  (IdeaBanned 300, IdeaResist.Ban 4) apply to doctrines, and this plan's Censor order (43) calls TTI's ban when TTI is built.
- Proxies without TTI [A]: `L = 0.7·smoothstep(500, 1500, year − firstStateYear)·(0.3 + 0.7·held(printing))` (court-politics' Lit proxy
  form); `X = 0`; press intensity `0.3·held(printing)`; O = 0.5. **Consequence (by design): without TTI no socialist, Marxist or anarchist
  doctrine can form**, because their `cond` needs X > 0.
- TTI pacing (its 2.1): era 5 (newspaper) on leading peoples at sim ~1900–2300, era 6 (factory, railway) ~2200–2650, era 7 (massSchooling)
  ~2450–2950; "suggest 3000 as a modern preset". This plan's primary calibration runs are therefore **3000 years** (section 9).

### 0.4 What this plan reads from other plans (every call guarded by `s.x !== null`)
| plan | read / called | proxy without it |
|---|---|---|
| riots-uprisings | movement table and slots `mvId/mvSh` (4.8), birth and SIS spread, `up.L` legitimacy, `up.perc`/`upTrue`, Λ (army loyalty), response utilities `uR/uC`, `revoltAt`, `rulerOverthrownByCrowd`, Revolution events, `tyrannyAct` | own per-polity adherence `A[p,k]` (logistic, 2.3 proxy); revolutions from `revoltStep` capital wins (none exist today: then regimes change only by reform and coup routes) |
| city-states | `G.form`, `setForm(s, p, form, cause, settlement)` (silent: this plan logs its own event), `GOV` columns 7–11 (7.1), `govRisingResolve` | own `I.form[p]` and `History.modernRegimes` alone; Government not written |
| court-politics | `C.regime[p]` (Constitutional 10, Absolutist 6, Estates 4, …), assemblies and privileges (Audit, Consent, Standing), `courtGovChanged`, `SigT/SigN`, `courtPolicy` | assembly ⇔ `lit ≥ 0.3 ∧ bour ≥ 0.3` [A]; regime ⇔ Government |
| society | `socElite` ε, `socCoercion` κ, `socRent`, `socWage/socUrbanWage` and its smoothed trend, `soc.urb`, `psi` | κ 0.5; urb = town pop share; crisis from famine events |
| state-finances | `finSFD`, `finDefaulted`, `setRateMul` composition (adds `ideoRate`), `finSpend` | crisis = `pExh` and lost-war terms |
| rulers (repo) | `R.cur`, `rAbility`, elected-head machinery (city-states 9.1 `electHead`), `succession`, `newHouseAccede`, restore of a house (riots' `restore` argument) | without rulers: head changes are not modelled; regimes still change |
| religion (repo) | `rel.state[p]`, `rel.zeal`, `rel.org[f]`, `shareOf`, `polityFaith` | no revivalist or egalitarian receptivity from faith (zeal 0.3) |
| battles | general fame `battleCoup`, commanders (junta heads), GeneralSeized 224 | military politicisation from wars in 30 y |
| grudges | `recordGrievance(Subversion)`, `standingGrudges` | — |
| beliefs | `bel` precision (regimes' perception of dissent in partisan sagas only) | — |
| language-drift | `languageAt` for naming nations in the UI only (it is assembly-time, not sim state [V language-drift.md 1: "No sim state changes"]) | people name |
| seat-mode | watcher, `Decision`, `ORDER_KINDS`, `ox.rng` | — |
| experience/sagas | `Pov`, `lens.ts`, `registerDrama` | — |

### 0.5 Amendments asked of other plans (each null-guarded; skipped, not ×1, when this plan is off)
- **ideas (repo) and TTI**: (a) the per-run catalogue `ix.defs` (TTI 2.2) becomes `base + (techTree ? TTI : []) + (ideologies ? DOCTRINES : [])
  + (futurePolitics ? FP_DOCTRINES : [])`; doctrines are a **suffix** (test). (b) `IdeaCtx` gains the fields of 2.1, filled by one guarded
  call `ideoIdeaCtx(s, c)` at the end of `context()`. (c) In `learnAndConceive`, rows of kind Ideology draw from `s.ideo.rng`, not
  `ix.rng` (one ternary at the draw site), so technology draws are not shifted by doctrines. (d) Doctrines have `caps 0`, `weight 0` and no
  levers, so `recompute` and the technology caps are untouched by them (test: tech levels equal with doctrines forced held vs not, other
  things equal, on a synthetic state). (e) Widen `IdeaAdoptions.idea` to Uint16 (coordinator: already decided).
- **riots-uprisings**: (a) `MovementKind.Ideology 5` with `anchor` = ideology id; births of kind 5 come from this plan's birth rule (2.3)
  and draw from `s.ideo.rng`; spread, dormancy, resurfacing and repression are theirs, unchanged, with β/γ/scope/channels read from the
  ideology row. (b) Slots per settlement `MOV.slots = s.ideo ? 3 : 2` (sized at creation; off identity kept). (c) Program table: a rising
  whose movement is kind 5 gets the ideology's `demands` as its program and concession kinds (2.4). (d) A capital revolution won by a
  kind-5 movement calls `ideoRevolutionWon(s, p, k, year)` instead of their plain `rulerOverthrownByCrowd` when the program installs a
  regime (3.3 R-routes). (e) Response utilities add `REGIME_MODS.repress[r]`.
- **city-states**: `Government` 7–11, `GovernmentCause` 13–22, `GOV` columns 7–11 (7.1), `setForm(..., silent = true)` writes the row and
  calls `courtGovChanged` without logging 204 (this plan logs RegimeChanged 310).
- **court-politics**: the 0.2 table gains "Government 7–11 → Regime Civic (forced; court keeps out)". Its Constitutional (10) regime is the
  monarchy side of this plan's ConstitutionalMonarchy (no second regime value).
- **state-finances**: `rateMul = govRate · courtRate · ideoRate` (`setIdeoRateMul`, like court's).
- **rulers (repo)**: ReignEnd 12 Abolished, 13 Voted; elected-head term machinery for Government 7 (city-states 9.1) with an incumbency draw
  (3.5) from `s.ideo.rng`.
- **grudges**: `GrievanceKind.Subversion 14`, weight `IDEO.subvW` 0.3.
- **experience/sagas**: `Pov.kind 'ideology'` (6.5); future-politics' proposed `'movement'` is the same kind (one name: `'ideology'`).
- **seat-mode**: DecisionKind 27–29, OrderKind 41–43 (6.6).

---

## 1. The registry (generic machinery; future-politics adds rows only)

### 1.1 `IdeologyDef`
```ts
/** A governance ideology: a doctrine (an IDEA_DEFS row of kind Ideology, held per people) and the movement that carries it (riots'
 *  movement slots, MovementKind.Ideology). Registered once at module load (ideology/catalogue.ts); ids are registration order. */
export interface IdeologyDef {
  key: string
  name: string
  /** Key of its doctrine idea (kind Ideology), or null for a precursor movement that needs no doctrine (born from conditions alone). */
  idea: string | null
  /** Which plan owns it: rows whose option is off are inactive (no births, no draws, absent from History). */
  active: (s: HistoryState) => boolean
  /** Who carries it (Carrier bits): for the UI, and the default receptivity when `recept` is absent. */
  carriers: number
  /** Receptivity of settlement i (member of polity p, -1 stateless), 0..1: a pure read of IdeoInputs (2.2). */
  recept: (x: IdeoInputs, s: HistoryState, i: number, p: number) => number
  /** Birth gate at settlement i (0..1; 0 = no draw). Births need the doctrine held by i's people unless `idea` is null. */
  gate: (x: IdeoInputs, s: HistoryState, i: number, p: number) => number
  /** Birth chance per slow step at a gated town, times gate · recept. */
  birth: number
  /** SIS spread rate β (per year), recovery γ (per year), martyr damping ζ (riots 4.8). */
  beta: number; gamma: number; martyr: number
  /** SpreadVia bits: neighbours, routes, faith co-members, print (β · (1 + 0.5·press intensity)), exiles (to the host's towns), army (garrison towns). */
  via: number
  /** Spread restriction: 'all', 'people' (only towns of the anchor people), 'faith' (co-religionists), 'towns' (N >= TOWN only). */
  scope: 'all' | 'people' | 'faith' | 'towns'
  /** What adherents demand (Demand bits): the rising's program and the concession kinds that satisfy it (2.4). */
  demands: number
  /** Loyalty to each regime family (RegimeFamily index → -1 hostile .. 1 loyal): anti-system shares (3.2) and polarisation. */
  loyalty: number[]
  /** Spread multiplier when the polity's regime family is f (exported by regimes of that family; persecuted by hostile ones). */
  climate?: number[]
  /** Documentation only: real-world grounding with citations. */
  history: string
}
```

### 1.2 `RegimeDef`, `RouteDef`, `ProgramFn`
```ts
/** A modern regime: a Government value (city-states' log) with a franchise band and behaviour multipliers. */
export interface RegimeDef {
  key: string
  name: string
  /** Government value written by setForm; for a constitutional monarchy Government.Monarchy (court's Regime.Constitutional stays). */
  gov: number
  family: number            // RegimeFamily
  /** Franchise f and contestation c set on entry (Dahl's two dimensions), and their allowed ranges while in this regime. */
  f0: number; c0: number; fRange: [number, number]; cRange: [number, number]
  /** Head: 'crown' (rulers' house stays), 'elected' (term, incumbency draw), 'party' (chosen by the party: Elected, for life or until ousted),
   *  'officer' (a commander: Usurped; rotations by counter-coup), 'leader' (for life; Elected or Usurped at entry). */
  head: 'crown' | 'elected' | 'party' | 'officer' | 'leader'
  /** Behaviour multipliers (REGIME_MODS, section 4), indexed by name. */
  mods: Record<string, number>
}
/** A transition route: from any of `from` (regime keys, or 'traditional', or 'family:<n>') to `to`, with a hazard per slow step. */
export interface RouteDef {
  key: string
  from: string[]
  to: string                // regime key, or a pseudo-target ('franchise+', 'franchise-', 'counterCoup', 'stage') handled by `apply`
  cause: number             // GovernmentCause
  /** Hazard per slow step (10 years), >= 0: a pure read of RegimeInputs (3.1) and the polity's pending boosts. */
  hazard: (x: RegimeInputs, s: HistoryState, p: number) => number
  /** For pseudo-targets: what happens when it is drawn. */
  apply?: (s: HistoryState, p: number) => void
}
/** What a revolution won by ideology k at p's capital installs: a regime key, or null (no regime: crisis and the strongman boost). Deterministic. */
export type ProgramFn = (x: RegimeInputs, s: HistoryState, p: number) => string | null
```

### 1.3 Walk (court-politics 3.4 format, reused)
Every slow step, for each living polity p in `ps.alive` order: build `h[]` for the routes registered from p's regime, in registration order;
`H = Σ h`, capped at `IDEO.hazCap` 0.9 by scaling; if `H > 0` draw one `u` from `s.ideo.rng` and take `walkHazards(h, n, u, cap)`. **One draw
per polity per slow step**, whatever the number of routes, so adding future-politics routes changes which route fires, not how many draws
there are. Pending boosts (set by events: a lost war, a revolution, a leader's death) are added inside the hazards at the next slow step.

### 1.4 Program map and affinities
`registerProgram(key, fn)`: a capital revolution won by a movement of ideology k installs `fn(x, s, p)` with cause Revolution 13. `registerAffinity`
fills `AFF[family×family]` and `IAFF[ideology×ideology]` (symmetric; default 0). future-politics extends both (its 7.3).

### 1.5 Off identity for registered rows
- `HistoryOptions.ideologies` false: `s.ideo = null`, doctrines are not in `ix.defs` (0.5a), no MovementKind 5 births, no route walk, no
  draws on `'history-ideology'` (the stream is not created). Every pre-existing History field is bit-identical (test 8.1).
- On but a registered row's `active(s)` false (e.g. a future-politics row with futurePolitics off): skipped before any draw.

---

## 2. Ideologies as ideas with preconditions

### 2.1 The doctrines (IDEA_DEFS rows of kind Ideology; per people; spread by the ideas system's channels)
New `IdeaCtx` fields (per people; filled by `ideoIdeaCtx`, else 0): `lit` (literacy L), `press` (newspaper intensity, proxy 0.3·printing),
`ind` (industrial index X), `asm` (share of the people's population in polities with an assembly: court Diet/Parliament, or Government
Republic/FreeCity/League, or ConstitutionalMonarchy), `refm` (share of its towns with a Reform movement (riots kind 0) share ≥ 0.1, or under a
faith that split from the ruler's in a Schism (religion 92) in 300 y: the radical-Protestant root), `bour` (population-weighted merchant
capital per head index, 2.2), `revs` (revolutions with a program at polities of peoples it has met, last 50 y, ≤ 3, /3), `foreign` (share of
its population ruled by a polity of another people), `split` (1 − largest share of its population in one polity), `zeal` (mean zeal of its
universal faith), `ineq` (mean elite share/rent index, 2.2).

All rows: `caps [0,0,0,0]`, `weight 0`, no levers, `fragile` low, `era 4` (index into existing arrays; weight 0 so the era has no effect),
`theft 0`. `sm` = smoothstep. `chance` and `teach` are design defaults to tune (section 9).

| key (name) | pre (v1 keys) | cond (TTI keys via `held`) | ch | teach | resist | grounding |
|---|---|---|---|---|---|---|
| `naturalRights` (natural rights: "all men are created equal") | printing, lawCode | `sm(0.15,0.4,lit)·sm(0.05,0.3,refm+asm)·sm(1,4,cities)·[printing held ≥ IDEO.printLag 100 y]` | 0.15 | 40 | F, R | Locke's *Second Treatise* (1689) [verified-search]; the US Declaration (1776) [verified-search]; Protestant missions spread literacy, print and voluntary association, which predict later democracy (Woodberry 2012) [verified]; Protestant literacy (Becker & Woessmann 2009) [verified-search] |
| `liberalism` (liberalism: limited government, property, free trade) | naturalRights, banking | `sm(0.2,0.6,bour)·sm(0.1,0.4,asm)` | 0.2 | 30 | R | North & Weingast (1989) on credible commitment after 1688 [verified-search] |
| `republicanism` (republicanism: rule without a crown) | naturalRights | `sm(0.1,0.4,asm)·(0.5 + 0.5·[a Republic/FreeCity/League in its peoples' history])` | 0.15 | 30 | R | |
| `popularSovereignty` (democracy: the people's vote) | naturalRights | `sm(0.3,0.6,lit)·sm(0.05,0.3,press)` | 0.1 | 30 | R | Dahl (1971): inclusiveness and contestation as two dimensions [verified-search] |
| `nationalism` (the nation as the state's measure) | printing | `sm(0.3,0.6,lit)·sm(0.1,0.4,press)·max(foreign, split, warLost)` | 0.2 | 20 | R | Anderson (1983): print-capitalism and vernacular reading publics make "imagined communities" [verified-search]; Gellner (1983): industrial literacy [verified-search]; Hroch (1985) phases A–B–C [verified-search] |
| `socialism` (socialism: labour's claim on the product) | naturalRights | `held(factory)·sm(0.08,0.25,ind)·sm(0.2,0.4,urbanShare)` | 0.2 | 25 | F, R, G | |
| `marxism` (Marxism: class struggle and a workers' state) | socialism, science | `sm(0.15,0.35,ind)·sm(0.3,0.6,lit)` | 0.08 | 40 | F, R | Marx & Engels (1848) [verified-search]; Lenin (1902) on the vanguard party [verified-search] |
| `anarchism` (anarchism: abolition of the state) | socialism | `sm(0.05,0.2,ind)·(0.5 + 0.5·ineq)` | 0.1 | 30 | F, R | Proudhon (1840) [verified-search] |
| `conservatism` (conservatism: order, throne and altar as reaction) | naturalRights | `sm(0.2,0.6,revs)` (reaction needs revolutions to react to) | 0.4 | 10 | — | Burke (1790) [verified-search]; conservative parties' role in democratisation (Ziblatt 2017) [verified-search] |
| `revivalism` (theocratic revivalism: the faith as law) | printing | `sm(0.4,0.8,zeal)·max(foreign, sm(0.2,0.5,lit)·ineq)` | 0.1 | 20 | R | modelled abstractly; no real movement is named in sim text |

Spread of doctrines uses the ideas channels (trade, lanes, pilgrims, migration, conquest, marriage) and backwardness unchanged; with TTI on,
`press` multiplies learning of Ideology rows by `1 + IDEO.pressLearn 1.0 · press` (a newspaper culture carries doctrines fast). A doctrine
can be **refused** (ideas' R_FAITH/R_RULER resistance: intolerant rulers and zealous faiths) and **lost** (collapse; and IdeaLoss 3 via
TTI's Dwindled for small peoples).

### 2.2 Inputs per settlement and per polity (`ideology/inputs.ts`, every slow step, RNG-free)
Per settlement i (Float32, grown with capacity; town = `N_i ≥ TOWN_POPULATION`):
```
lit_i   = L(people_i) · (town ? 1 : 0.5)
press_i = press(people_i)
burg_i  = sm(0.1, 1, (mw_i / N_i) / IDEO.richRef)                 merchant capital per head (city-states' rich0 when built) [A]
work_i  = X(people_i) · town · sm(1, 4, N_i / TOWN_POPULATION)     urban wage workers (TTI industrial index)
peas_i  = (1 − town) · (0.4 + 0.6·(1 − κ_p))                      free or bound peasants (Moore; Skocpol's village autonomy)
grief_i = riots D_i (else ps.unrest[i])
minor_i = [people_i ≠ ruling people of p] max [majority faith ≠ state faith]
zeal_i  = zeal(majority universal faith) · share
```
Per polity p: `lit, urb, ind` (pop-weighted), `bour` = court's C (else mean burg over towns), `lord` = court's K or SigN (else society ε·κ /
SOC.eps0, else 0.5), `ineq` = sm(0.8, 1.6, socRent·ε/ε*) (else merchant concentration: top-3 `mw` share), `inc` = sm(0.5, 3, (Σwealth + Σmw) / pPop
/ IDEO.incRef) [A], `brk`, `thr`, `rep`, `crisis`, `mil`, `pol`, `anti`, `wave` (3.1).

### 2.3 Movements (riots' machinery, MovementKind.Ideology)
- **Birth** (every POLITY.step, after riots' own births, polities in `ps.alive` order, towns in member order; at most one ideology birth per
  polity per step): for each active ideology k, a town i whose people holds k's doctrine (or any town for `idea: null`) with
  `g = gate_k(i) > 0`: one draw `< birth_k · g · recept_k(i) · IDEO.birthMul`. Origin share 0.1; MovementFounded 285 (riots) with extra 5.
- **Spread**: riots' SIS (4.8) with `β_k, γ_k, ζ_k` and `scope_k`; receptivity `Rk_i = recept_k(i)`; channels from `via_k`; print:
  `β ·= 1 + 0.5·press_i`; regime climate: `β ·= climate_k[family(p)]` (persecution by hostile regimes, sponsorship by friendly ones; 4).
  Exported pulses (4.6) add inflow at the target's towns.
- **Proxy without riots** [A]: per polity `A[p,k] ← A + 10·(β_k·R̄_pk·A(1 − A) − γ_k·A + 0.02·Σ_q contact_pq·A[q,k])`, seeded at 0.02 when
  the doctrine is first held by the ruling people and `R̄ ≥ 0.2`; `ideoShare = A`. No risings carry programs then; only reform and coup routes.

### 2.4 The ideologies (registered rows)
Carrier bits: Burghers, Literati, Workers, Peasants, Clergy, Landed, Officers, Minority. Demand bits: Toleration, Constitution, Franchise,
Republic, FreeTrade, Nation, Wages, Land, Collective (property in common), PartyRule, NoState, Throne (restoration), Order, FaithLaw, Commons.

| id key | doctrine | carriers | recept (x per settlement i) | gate | β / γ / ζ | scope, via | demands → concessions (riots ConcessionKind) | program (3.3) |
|---|---|---|---|---|---|---|---|---|
| 0 `rights` (reform societies, abolitionist and toleration leagues) | naturalRights | Lit, Burg | `lit·(0.5+0.5·burg)` | town | .10/.04/.5 | all; nb, route, print, exile | Toleration, Constitution → Toleration, Charter | → liberal's program |
| 1 `liberal` | liberalism | Burg, Lit | `burg·(0.4+0.6·lit)` | town ∧ burg ≥ .2 | .10/.04/.5 | towns; route, print | Constitution, Franchise (limited), FreeTrade → DutiesLifted, Charter, Franchise+ | ConstMon if the house survives (not killed, heir lives), else LiberalOligarchy |
| 2 `republican` | republicanism | Lit, Burg | `lit·burg + 0.3·[a republic in p's lineage]` | town | .09/.05/.6 | towns; nb, route, print | Republic, Constitution | LiberalOligarchy (f = 0.15 + 0.4·a_democratic) |
| 3 `democratic` | popularSovereignty | Lit, Workers, Peasants | `lit·(0.3 + 0.7·max(work, 0.6·peas·(1−κ), 0.5·burg))` | town | .10/.05/.6 | all; nb, route, print | Franchise (full) → Franchise+ | crown kept: ConstMon with f ← max(f, 0.6); else Democracy |
| 4 `nationalist` | nationalism | Lit, Minority, Officers | `lit·press·(minor ? 1 : 0.6)·(1 + [p lost a war ≤ 20 y])` | town | .12/.04/.7 | **people** (only the anchor people's towns); nb, print, army | Nation | minority uprising: secession (riots' Separatist path; the successor's regime from its second-largest ideology); at the capital: Dictatorship if `lord ≥ bour` (Moore's route 2, 3.3) else LiberalOligarchy |
| 5 `socialist` | socialism | Workers, Lit | `work·(0.5+0.5·lit) + 0.3·peas·grief` | town ∧ work ≥ .1 | .10/.04/.6 | towns; route, print | Wages, Franchise, Land → TaxRemitted, Franchise+ | Democracy (f ← max(f, 0.7)) if `f ≥ 0.3` before; else as `marxist` when `a_marxist ≥ 0.08` |
| 6 `marxist` | marxism | Workers, Lit | `work·lit·(1 + brk) + 0.2·peas·grief` | town ∧ work ≥ .15 | .08/.04/.8 | towns; route, print, exile | Collective, PartyRule (no concession satisfies it) | **PartyState iff `brk ≥ IDEO.brkParty 0.4` and capital share ≥ 0.08** (Skocpol); otherwise no regime (the revolution is a crisis, 3.3) |
| 7 `anarchist` | anarchism | Workers, Peasants | `grief·(work + 0.5·peas)·(1 − 0.3·lit)` | grief ≥ .3 | .09/.06/.8 | all; nb, route | NoState | null: capital crisis (`pCrisisUntil`), towns with share ≥ 0.3 may secede as free communes (city-states Republic of a town), Brinton strongman boost 0.3 |
| 8 `conservative` | conservatism | Landed, Clergy, Peasants | `lord·(1 − urb)·(0.5 + 0.5·zeal) + 0.3·[state church]` | — (any member) | .10/.03/.4 | all; nb, faith | Order, Throne → (none needed) | Restored (riots' `restore` = last deposed house) when one lives, else Junta |
| 9 `revivalist` | revivalism | Clergy, Peasants, Minority | `zeal·(1 − 0.5·lit)·(grief + 0.5·minor)` | zeal ≥ .3 | .11/.04/.8 | **faith**; faith, nb | FaithLaw → Toleration (for a minority faith) | TheocraticRepublic if `rel.state[p]` is its faith or the faith is the majority at the capital; else as conservative |
| 10 `egalitarian` (pre-modern precursor; no doctrine) | null | Peasants, Clergy | `peas·grief·(0.3 + 0.7·zeal)` | **gate:** universal faith at i, `grief ≥ .4`, `ineq ≥ .5`, and a disaster/plague/lost war ≤ 10 y (riots' Millenarian trigger) | .12/.08/.5 | faith; nb, faith | Land, Commons, Collective | a single-town commune (city-states Theocracy or Republic of that town) with crush hazard × IDEO.crushEgal 3 |

The precursor row stands for the Mazdakite movement under Kavad I (late 5th–early 6th century; property in common, suppressed by nobles and
clergy) (Britannica, "Mazdakism") [verified], the Taborites (1420s–1434) (Britannica, "Taborite") [verified-search], the Anabaptist kingdom of
Münster (1534–35) (Cambridge University Library exhibition page) [verified-search], the Diggers (1649–50) (Britannica, "Digger")
[verified-search], and the Taiping Heavenly Kingdom (1851–64; property in common, about 20 million dead) (Britannica, "Taiping Rebellion")
[verified]; and the medieval millenarian movements of Cohn (1957) [verified-search]. All were crushed or faded; the sim makes them early
(no print needed), common in hard times, and almost always short.

`loyalty` (by RegimeFamily Traditional / Pluralist / Authoritarian) and the ideology affinity matrix `IAFF` are listed in `rows.ts`; e.g.
`marxist` [−1, −0.6, 0.3 (only its own PartyState is loyal; others −0.5)], `conservative` [1, 0.2, 0.3], `liberal` [−0.3, 1, −0.8]. Each row's
`loyalty` for its own program regime is +1 regardless of family. **Opposed pairs** (IAFF ≤ −0.6) drive polarisation (3.1): marxist–liberal,
marxist–conservative, republican–conservative, revivalist–liberal, nationalist–marxist, anarchist–everyone except socialist.

---

## 3. Regimes and transitions

### 3.1 Inputs (`RegimeInputs`, per polity, every slow step)
```
a_k     = ideoShare(p, k)
f, c    = franchise and contestation (Dahl 1971: inclusiveness, contestation) [verified-search]; 0 for traditional regimes
                                     (court's Constitutional with no elected chamber: f = 0, c = 0.4)
brk     = max( fin ? clamp(finSFD − 1, 0, 1) : min(1, pExh),
               [lost a war ≤ 10 y]·(0.5 + 0.5·min(1, towns lost / 3)),
               [capital taken ≤ 10 y],
               riots' defection: 1 − Λ_p )                          state breakdown under external pressure (Skocpol 1979) [verified-search]
thr     = max_i∈towns(riots E_i · N_i / N_cap) + Σ_k∈radical a_k    revolutionary threat (Acemoglu & Robinson 2000) [verified];
                                                                    radical = {democratic, socialist, marxist, anarchist, republican}
rep     = Λ_p · (0.5 + 0.5·pay_p) · min(1, pMass / (3·rebMass))     repression capacity (riots' Λ, finances' pay)
crisis  = max( sm(0.1, 0.3, −wage trend over 20 y), clamp(finSFD − 1.5, 0, 1), [famine ≤ 5 y] )
mil     = battles ? min(1, fame/renown of the top general) : sm(1, 4, wars in 30 y)   military politicisation
pol     = max over opposed pairs (k, l) of 4·a_k·a_l·(−IAFF_kl)      polarisation (Linz 1978) [verified-search]
anti    = Σ_k a_k · max(0, −loyalty_k[family(r)])                    disloyal opposition (Linz)
age     = years since the regime began;  young = 30 / (30 + age)
wave_F  = share of contacted Kingdom+ polities that entered family F in the last 20 y   demonstration and diffusion (Weyland 2009; Huntington 1991)
inc, lit, urb, ind, bour, lord, ineq, peas = Σ peas_i N_i / pPop    (2.2)
```

### 3.2 The regimes (registered rows; `ModernRegime` values; `REGIME_FAMILY`: Traditional 0, Pluralist 1, Authoritarian 2)
| ModernRegime | gov (Government) | family | f0 / c0 | head | what it is |
|---|---|---|---|---|---|
| 0 ConstitutionalMonarchy | Monarchy 0 (court Regime Constitutional) | Pluralist | f 0.05, c 0.6 | crown (ministers not modelled as rulers) | a crown with an elected chamber that votes supply; franchise widens or not |
| 1 LiberalOligarchy | ConstitutionalRepublic 7 | Pluralist | f 0.15, c 0.7 | elected (term 5 y) | elected republic with a narrow franchise (property or literacy qualifications) |
| 2 Democracy | ConstitutionalRepublic 7 | Pluralist | f 0.6, c 0.8 | elected | the same with f ≥ IDEO.fDem 0.5 and c ≥ 0.5 (RoW's electoral democracy is the reference category; Lührmann et al. 2018) [verified-search] |
| 3 PartyState | PartyState 8 | Authoritarian | f 1, c 0.05 | party | one revolutionary party rules; plebiscitary votes; a vanguard (Lenin 1902) [verified-search] |
| 4 Junta | Junta 9 | Authoritarian | f keeps, c 0.05 | officer | officers rule as a body; rotations by counter-coup |
| 5 Dictatorship (populist / personalist) | Dictatorship 10 | Authoritarian | f 1, c 0.1 | leader | a leader rules personally, often after an election, by plebiscite and patronage |
| 6 TheocraticRepublic | TheocraticRepublic 11 | Authoritarian | f 0.6, c 0.3 | elected under clerical veto | elected offices supervised by the clergy of the state faith |

LiberalOligarchy ↔ Democracy is **one Government (7)** with the regime key moved by franchise (hysteresis: up at f ≥ 0.55 and c ≥ 0.5, down at
f < 0.45 or c < 0.4; logged as RegimeChanged with cause Reform). ConstitutionalMonarchy with f ≥ 0.5 is shown as "parliamentary democracy under
a crown" in the UI (same regime value; f decides the label).

### 3.3 Routes (hazards per slow step; `ROUTES` in registration order; all constants [A] unless cited)
Pseudo-targets do not change the regime. "Pending x" means a boost x added at the next slow step after the event.

**Entry from traditional regimes (hard: needs doctrine adherents, literacy and an assembly or a revolution)**
| # | from → to | hazard h | grounding |
|---|---|---|---|
| E1 | court Constitutional (10) monarchy → ConstitutionalMonarchy | `0.25·sm(0.08,0.3,a_liberal + a_rights)·sm(0.2,0.5,lit)` | an elected chamber grows out of a parliament of estates |
| E2 | Absolutist, Estates, Bureaucratic, Patrimonial monarchy (Kingdom+) → ConstitutionalMonarchy | `0.15·sm(0.2,0.6,thr)·sm(0.1,0.3,a_liberal + a_democratic)·(1 − 0.7·rep)·4·ineq·(1 − ineq)` | concession under revolutionary threat when repression is costly and inequality intermediate (Acemoglu & Robinson 2000 [verified]; 2006 [unverified]); reform from above |
| E3 | Republic/FreeCity/League (city-states) → LiberalOligarchy | `0.2·sm(0.1,0.4,a_liberal + a_republican)·sm(0.2,0.5,lit)` | merchant republics adopting written constitutions |
| R* | any → program of the winning ideology | **no draw**: a capital revolution (riots' Revolution, ReignEnd 9) won by a kind-5 movement calls `ideoRevolutionWon`, which installs `program_k(x)` (2.4) with cause Revolution; ReignEnd 12 Abolished for the crown when the program is a republic | Moore (1966): the route depends on who made the revolution [verified-search]; Skocpol (1979) [verified-search] |

**Moore's three routes, as emergent outcomes of R\***: (1) a revolution led by `liberal`/`republican`/`democratic` movements where `bour > lord`
installs ConstitutionalMonarchy, LiberalOligarchy or Democracy ("no bourgeois, no democracy"); (2) where `lord ≥ bour` and `nationalist +
conservative ≥ 0.3` the program of a nationalist or conservative rising (or route B2 below) installs a Dictatorship or Junta: modernisation
"from above" by a landed–bureaucratic coalition, Moore's path to fascism; (3) a `marxist` revolution in a polity with large `peas` and `brk ≥ 0.4`
installs a PartyState (peasant revolution, Moore's communist route). Moore's routes are **[D]**: Skocpol, Przeworski & Limongi and the
elite-competition account of Ansell & Samuels (2014) [verified-search] dispute or refine them; the sim makes them tendencies through the
program conditions, not rules.
**Skocpol by construction**: the PartyState program needs `brk ≥ 0.4` (war collapse or bankruptcy of the old state) and a Marxist share at the
capital; peasant support enters through `recept` (0.2·peas·grief) and the riots cluster. An industrial state at peace (brk < 0.4) gets no
PartyState from a Marxist rising: the rising is a crisis (and usually crushed). The harness checks that ≥ 60% of PartyStates arise in polities
with `ind < 0.4` and `brk ≥ 0.4` (Russia 1917, China 1949 pattern) (section 9).

**Franchise (Pluralist regimes; pseudo-targets)**
| F+ | ConstMon, LiberalOligarchy, Democracy → `franchise+` (f += 0.15·(1 − f) + 0.05) | `0.3·sm(0.15,0.5,thr + 0.5·a_democratic + 0.3·a_socialist)·(1 − 0.6·rep)·4·ineq·(1 − ineq)·(0.5 + lit)·(1 + 0.5·a_conservative·[c ≥ 0.5])` | A&R 2000: extension as a credible commitment to future redistribution under threat [verified]; Ziblatt 2017: a strong conservative party makes elites accept it [verified-search]; Lipset 1959: literacy and income [verified-search] |
| F− | the same → `franchise-` (f −= 0.1) | pending 0.3 after a crushed rising with a democratic/socialist program; `0.05·a_conservative·sm(0.3,0.6,lord)` | restrictions after 1848–49 |
The franchise is recorded per slow step (History.franchise) and is a real variable: a crown can sit at f 0.05 for a century.

**Breakdown of pluralist regimes (Linz; reverse waves)**
| B1 | ConstMon, LiberalOligarchy, Democracy → Junta (coup, CoupKind Junta) | `0.04·(1 + 3·crisis)·(1 + 4·pol)·sm(0.2,0.6,mil)·(0.3 + 0.7·young)·(1 − 0.6·inc)·(1 + 2·wave_Auth)` | Linz 1978 [verified-search]; income protects democracies once in place (Przeworski & Limongi 1997) [verified-search] **[D]** against Boix & Stokes 2003 [verified-search] and AJRY 2008 [verified-search]; reverse waves (Huntington 1991) [verified] |
| B2 | LiberalOligarchy, Democracy → Dictatorship (an anti-system leader elected, then a self-coup) | `0.03·sm(0.15,0.4,anti)·(1 + 3·crisis)·(0.3 + 0.7·young)·(1 − 0.5·inc)·(1 + wave_Auth)` | Linz's disloyal opposition; Moore route 2 when `lord ≥ bour` (×1.5) |
| B3 | ConstMon → Monarchy with court Absolutist (crown takes back supply) | `0.03·a_conservative·sm(0.4,0.8,lord)·(1 + crisis)` | |

**Authoritarian dynamics (durations calibrated to Geddes, Wright & Frantz 2014: median autocratic spell 14 y, military and personalist medians
8 y, party regimes the most durable; Geddes 1999: military regimes most likely to hand power back and least likely to end violently) [verified]; Geddes 1999 summary page opened, the article [verified-search]**
| J1 | Junta → previous Pluralist regime (or LiberalOligarchy) (Handover) | `0.08 + 0.15·sm(0.1,0.3,a_democratic + a_liberal) + 0.2·[lost a war ≤ 10 y] + 0.1·wave_Plur` | |
| J2 | Junta → `counterCoup` (new officer head, same regime) | `0.08·(1 + crisis)` | coups succeed about half the time; 457 attempts 1950–2010, 227 successful (Powell & Thyne 2011) [verified] |
| J3 | Junta → Dictatorship (one officer personalises) | `0.05·[same head ≥ 10 y]` | |
| P1 | Dictatorship → Democracy or LiberalOligarchy (by f) | pending 0.4 at the leader's death or ouster; `0.03 + 0.2·[lost a war ≤ 10 y] + 0.1·wave_Plur` | personalist regimes end violently and rarely in democracy (GWF 2014) [verified] |
| P2 | Dictatorship → Junta | `0.05·(1 + crisis)·mil` | |
| P3 | Dictatorship → Monarchy (court Sultanistic 9): the leader founds a house | `0.02·[his heir succeeded him]` | |
| S1 | PartyState → LiberalOligarchy/Democracy (Collapse) | `0.01 + 0.15·crisis·(1 − a_marxist/peak a_marxist) + 0.2·wave_Plur + 0.15·[lost a war ≤ 10 y]` | durable; sudden collapse when preference falsification unravels (Kuran 1991) [verified-search]: riots' revelation events add pending 0.2 |
| S2 | PartyState → Dictatorship or Junta | pending from the Brinton strongman stage (3.4) | |
| T1 | TheocraticRepublic → Dictatorship / Junta / LiberalOligarchy | `0.02·(1 + crisis)`, `0.02·mil`, `0.01 + 0.1·wave_Plur` | |
| X1 | any modern regime ≤ 30 y old → Monarchy (Restored; riots' `restore` of the last deposed house) | `0.08·sm(0.15,0.5,a_conservative)·(1 + [lost a war ≤ 10 y] + [a counter-revolutionary intervention, 4.6])` | 1815, 1849–51: revolutions often end in restoration (Weyland 2009 on 1848's rapid spread and failure) [verified-search] |
| X2 | the loser of a war → the winner's regime (Imposed) | pending 0.5 when the winner took the capital and `REGIME_MODS.export[winner] ≥ 0.5` | regime imposition after conquest |

### 3.4 Revolutionary stages (Brinton 1938) [verified-search] — **[D]**: a descriptive pattern drawn from four cases, not a law
Every regime installed by R* gets `stage = Moderates`. Pseudo-route `stage` (its hazard per slow step, then `apply` advances it; `BrintonStage`
logged with RevolutionStage 315):
```
Moderates → Radicals   0.3·sm(0.05, 0.3, a_radicalOther − a_programIdeology + [at war]·0.3)
Radicals  → Terror     0.4·[riots repression of a rising, or a Tyranny act, this step]
Terror    → Thermidor  0.3·sm(0.3, 0.8, pExh + years in stage / 20)
Thermidor → Strongman  0.25·(1 + 2·mil + crisis)  → apply: route to Dictatorship (or Junta when mil ≥ 0.5), cause Thermidor
any stage → Consolidated after 30 y with crisis < 0.2 (no further stage)
```
Target: 50–80% of revolutions that installed a regime end, within 30 y, in a restoration (X1) or a strongman (Thermidor) (section 9). 1848's
pattern (spread in months, reversed within ~3 years) comes from riots' wave contagion plus X1 and F−.

### 3.5 Heads and elections
- **Elected** (Government 7): term `IDEO.term` 5 y via city-states' elected-head machinery; at term end one `s.ideo.rng` draw: incumbent kept with
  chance `0.6 − 0.3·crisis`, else a new head (ReignEnd 13 Voted, AccessionHow Elected; Election 313 logged only for a turnover or an anti-system
  winner). An anti-system winner (the largest share `anti`-weighted ideology) sets B2's pending 0.3.
- **Party**: head for life or until a party coup (overthrow chance × 0.5); succession by the party (Elected), contested 0.15 (struggle).
- **Officer**: a battles commander (else a new head) at the coup; counter-coups rotate heads (AccessionHow Usurped).
- **Leader**: for life; at death P1's pending.
- **Crown** (ConstMon): rulers unchanged; overthrow × 0.4 (court Constitutional already applies it).

---

## 4. Behaviour of each regime (`REGIME_MODS`, arrays by ModernRegime; all [A] unless cited)
Hooks: for Government 7–11 the city-states `GOV` columns carry the base table (7.1); for ConstMon the court Constitutional column applies and this
plan adds only franchise terms. Every hook is skipped (not ×1) when `s.ideo` is null.

| key | hook | CM | LO | Dem | Party | Junta | Dict | Theo | grounding |
|---|---|---|---|---|---|---|---|---|---|
| `war` | declarations mul | 0.9 | 0.9 | 0.8 (×1.2 while `age < 20`) | 0.9 | 1.2 | 1.3 | 1.1 | personalist and military regimes initiate more conflict than party regimes (Weeks 2012) [verified-search]; democratising states war-prone (Mansfield & Snyder 1995) [verified-search] **[D]** |
| `pairPeace` | dyad (both Pluralist, c ≥ 0.5) war mul | `1 − 0.35·both − 0.35·sm(100, 1000, trade vol)` | | | | | | | democratic peace (Maoz & Russett 1993) [verified-search] **[D]**: Gartzke (2007) attributes it to markets [verified-search]; the sim splits the effect between regime and trade |
| `tax` | wealth-tax `w ·=` | (court) | 1.2 | 1.3 | 1.4 | 0.9 | 1.0 | 1.0 | |
| `rate` | `setIdeoRateMul` | (court) ·(1 − 0.1·f) | 0.85 | 0.85 | 1.2 (no foreign lenders) | 1.2 | 1.3 | 1.15 | credible commitment (North & Weingast 1989) [verified-search] **[D]** |
| `repress` | riots `uR +=` | 0 | 0 | −1 | +2 | +2 | +1 | +1.5 | |
| `concede` | riots `uC +=` | +0.5 | +0.5 | +1 | −1 | −0.5 | 0 | −0.5 | |
| `grief` | grievance mul | 0.9 | 0.95 | 0.85 | 1.0 | 1.1 | 1.0 | 1.05 | |
| `overthrow` | rulers overthrow `x ·=` | 0.4 | — | — | 0.5 | 3 | 2 | 1 | coups (Powell & Thyne 2011) [verified] |
| `tariff` | policy.ts target mul | 0.9 | 0.8 | 0.9 | 1.5 | 1.1 | 1.3 | 1.2 | |
| `export` | sponsorship strength (4.6) | 0.2 | 0.3 | 0.4 | 1.0 | 0.1 | 0.6 | 0.8 | |
| `bloc` | affinity weight (4.7) | 0.5 | 0.6 | 0.8 | 1.0 | 0.3 | 0.5 | 0.8 | |
| `climate` (spread mul of hostile ideologies inside) | `β ·=` | 0.9 | 1 | 1 | 0.4 | 0.6 | 0.6 | 0.5 | censorship and bans |
Signs differ by key: no regime is better on every axis (durability favours PartyState, credit and tax favour Pluralist regimes, short-run war
appetite is highest under Dictatorships, young democracies are fragile). That is a property the harness checks (9.4) to keep the sim even-handed.

**4.6 Ideology export.** Every slow step a polity with `export_r · a_program(r) ≥ 0.3` sponsors its program ideology in contacted polities q of
another family: pulse `IDEO.pulse 0.02·export` into q's towns with adherents (riots inflow); if the sponsored movement rises within 10 y, q records
`Subversion` against p (grudges) and RevolutionExported 317 (extra 0). Counter-revolution: a Traditional or Authoritarian Kingdom+ with `a_conservative
≥ 0.3` bordering a regime installed by R* in the last 10 y gets war drive `+IDEO.intervene 0.3·relR` against it (the Holy Alliance pattern; extra 2).

**4.7 Ideological blocs.** In `relationStep` (after `faithRivalry`, same pattern [V relations.ts:113]): `dR += step·IDEO.blocR 0.02·(−AFF[fam p][fam q])·
max(bloc_p, bloc_q)` (AFF: same family +0.5, Pluralist–Authoritarian −0.6, PartyState–Dictatorship −0.2, Traditional–Pluralist −0.2 within 50 y
of a revolution). Alliance chance (bondStep [V bonds.ts:230]) `· (1 + AFF)` and the threat test reads rivalry with a bloc rival at ×1.2.
BlocFormed 318 when the first alliance between two polities of one modern family forms (extra 0), or breaks (extra 1).

---

## 5. Contract additions (`src/contract.ts`), drafted in the codebase's style

### 5.1 Enums
```ts
// ideologies: modern governance ideologies and the regimes they make possible (HistoryOptions.ideologies; all empty when it, polities or ideas is false).

/** A modern regime of a polity (History.modernRegimes): 255 none (a traditional form: see History.governments and History.court.regimes). */
export const ModernRegime = {
  ConstitutionalMonarchy: 0, // a crown with an elected chamber that votes its revenues; the franchise may widen (History.franchise)
  LiberalOligarchy: 1, // an elected republic with a narrow franchise
  Democracy: 2, // an elected republic in which most adults vote and offices are contested
  PartyState: 3, // one revolutionary party rules; elections without rivals
  Junta: 4, // officers rule as a body
  Dictatorship: 5, // a leader rules in person, by plebiscite and patronage
  TheocraticRepublic: 6, // elected offices under the veto of the state faith's clergy
} as const
/** Families of regimes (blocs, loyalty of ideologies): future-politics appends 3+. */
export const RegimeFamily = { Traditional: 0, Pluralist: 1, Authoritarian: 2 } as const
Government: ConstitutionalRepublic: 7, PartyState: 8, Junta: 9, Dictatorship: 10, TheocraticRepublic: 11
GovernmentCause: Revolution: 13, Reform: 14, Coup: 15, Elected: 16, SelfCoup: 17, Restored: 18, Thermidor: 19, Imposed: 20, Collapse: 21, Handover: 22
IdeaKind: Ideology: 10, // a governance doctrine (History.ideologies says which movement carries it); no technology effect
MovementKind: Ideology: 5, // a movement of a modern ideology: `anchor` is its History.ideologies id
ReignEnd: Abolished: 12, // the throne itself was abolished (a republic or a party state took the realm)
          Voted: 13, // an elected head turned out at an election
GrievanceKind: Subversion: 14, // the offender sponsored a movement that rose against the wronged (RevolutionExported)
OrderKind: Franchise: 41, Sponsor: 42, Censor: 43
/** Revolutionary stages (Brinton): the `extra` of RevolutionStage. */
export const BrintonStage = { Moderates: 0, Radicals: 1, Terror: 2, Thermidor: 3, Strongman: 4, Consolidated: 5 } as const
export const RevolutionEnd = { Ruling: 0, Consolidated: 1, Strongman: 2, Restored: 3, Overthrown: 4, Collapsed: 5, Conquered: 6 } as const
export const ElectionOutcome = { Kept: 0, TurnedOut: 1, AntiSystem: 2, Suspended: 3 } as const
export const CoupKind = { Junta: 0, CounterCoup: 1, SelfCoup: 2, Failed: 3 } as const
export const ExportKind = { Sponsored: 0, Imposed: 1, Intervened: 2 } as const
// Carrier, Demand and SpreadVia are bit indices (documented beside IdeologyInfo).
```

### 5.2 Events 310–319
```ts
  // ideologies: modern ideologies and regimes (310-319; none when HistoryOptions.ideologies is false). Doctrines are ideas: their
  // conception and adoption are IdeaConceived / IdeaAdopted (value the idea id); their movements are riots' MovementFounded/MovementChanged (extra 5).
  RegimeChanged: 310, // the polity `value` ruled from `settlement` took the modern regime `extra` (ModernRegime; 255 back to a traditional form) for the cause in History.modernRegimes (GovernmentCause); `other` the capital of the power that imposed it, or -1
  FranchiseExtended: 311, // the polity ruled from `settlement` widened its franchise: `value` the polity id; `extra` the new share of adults who vote, percent; `other` -1
  FranchiseRestricted: 312, // the polity ruled from `settlement` narrowed its franchise: `value` the polity id; `extra` the new share, percent; `other` -1
  Election: 313, // an election in the polity ruled from `settlement` changed its head: `value` the new reign (History.rulers, -1); `extra` the ElectionOutcome; `other` -1
  Coup: 314, // officers struck at the government ruled from `settlement`: `value` the polity id; `other` the garrison town they came from (-1); `extra` the CoupKind
  RevolutionStage: 315, // the revolution `value` (History.revolutions) at `settlement` (the capital) entered stage `extra` (BrintonStage); `other` -1
  Restoration: 316, // the house of the reign `value` (History.rulers) was restored at `settlement`, ending the revolution's regime; `other` the capital of a power that intervened, or -1; `extra` years the house was out
  RevolutionExported: 317, // the polity ruled from `settlement` carried ideology `value` (History.ideologies) to the one ruled from `other`; `extra` the ExportKind
  BlocFormed: 318, // the polities ruled from `settlement` and `other`, of one RegimeFamily `value`, formed their first alliance (`extra` 0) or broke it (`extra` 1)
  MovementBanned: 319, // the polity ruled from `settlement` banned (`extra` 0) or legalised (`extra` 1) the movements of ideology `value`; `other` -1
```

### 5.3 History tables
```ts
/** A governance ideology (History.ideologies; registration order). */
export interface IdeologyInfo {
  id: number
  key: string
  name: string
  /** Its doctrine (History.ideas id), -1 for a precursor movement without one. */
  idea: number
  carriers: number   // Carrier bits
  demands: number    // Demand bits
  /** First movement founded (year, settlement), -1 if never; movements founded; peak adherents (people) and its year. */
  firstYear: number; firstSettlement: number; movements: number; peak: number; peakYear: number
}
/** Modern regimes over time, the analogue of History.governments: polity p's regime at year y is that of its last row with year <= y (255 = traditional). */
export interface ModernRegimes { count: number; polity: Int16Array; year: Int16Array; regime: Uint8Array; cause: Uint8Array; settlement: Int32Array; imposedBy: Int16Array }
/** Revolutions that installed a regime or tried to (a capital revolution with a movement's program), in order. */
export interface Revolutions { count: number; year: Int16Array; polity: Int16Array; ideology: Uint8Array; movement: Int16Array; regime: Uint8Array /* 255 none */; stage: Uint8Array /* last BrintonStage */; end: Uint8Array /* RevolutionEnd */; endYear: Int16Array }
History.ideologies: IdeologyInfo[]
History.modernRegimes: ModernRegimes
History.modernRegimeOffsets: Uint32Array; History.modernRegimeIds: Int32Array
History.revolutions: Revolutions
/** Per slow snapshot (q = floor(year / 10)) and polity, row-major: franchise f and contestation c (0..255 each), Brinton stage (255 none). */
History.franchise: { snapshots: number; f: Uint8Array; c: Uint8Array; stage: Uint8Array }
/** Ideology shares, sparse: (snapshot, polity, ideology, share 0..255) for shares >= 0.02, at slow snapshots. */
History.ideoShares: { count: number; snap: Int16Array; polity: Int16Array; ideology: Uint8Array; share: Uint8Array }
HistoryOptions: /** ideologies: modern governance ideologies (doctrines conceived and spread as ideas, carried by movements) and the regimes they make
 * possible — constitutional monarchies with a widening franchise, liberal oligarchies and democracies, party states, juntas, dictatorships and
 * theocratic republics — with their transitions, breakdowns and restorations (needs polities and ideas). Default false until tuned; false gives exactly the history without them. */ ideologies?: boolean
HistoryDiagnostics.ideologies?: { births: number[]; routes: Record<string, number>; revolutions: number; programs: number[]; coups: number; elections: number; exports: number; bans: number }
```
`emptyIdeologyHistory()`; `history.test.ts` event switch + 310–319; `worker.ts` transfer list + the typed arrays.

### 5.4 State (`ideology/state.ts`, one object literal `HistoryState.ideo: IdeoState | null`)
Per polity (grown by doubling with `ps.P`): `reg: Uint8Array` (255), `regSince: Int16Array`, `f, c: Float32Array`, `stage: Uint8Array`, `rev: Int32Array`
(current revolution row), `pend: Float32Array (P · nRoutes)` pending boosts, `peakA: Float32Array (P · K)`, `banned: Uint32Array` (ideology bits),
`share: Float32Array (P · K)` (ideoShare cache), `inputs` (RegimeInputs as Float32 arrays). Per settlement: the 2.2 arrays. Rows: the History tables
as `number[]` until assembly. `rng`, `evSeen`, `diag`. Params `ideology/params.ts`: `IDEO` (every constant above with a doc comment per line).

---

## 6. UI and prose

### 6.1 Data (`ui/ideologyData.ts`): `modernRegimeAt(h, p, y)`, `franchiseAt(h, p, y)`, `ideoSharesAt(h, p, y)`, `revolutionsOf(h, p)`.

### 6.2 Regime timeline (Factions panel detail, "Government" block, beside city-states' form and court's regime)
A band per polity across its life: traditional segments in grey tones labelled by court Regime/Government; modern segments by RegimeFamily
hue, with the franchise as a line over the band (0–100%) and revolution markers (stage ticks). Hover: "1912–1941 Democracy (franchise 64%;
entered by Reform; ended by Coup)". **Colours avoid real-world party conventions** (no red/blue/black/green coding of families): the palette uses
the existing neutral categorical set from `render/palette.ts`, so no in-world regime is read as a real one.

### 6.3 Ideology spread view (`ViewMode.Ideology = 'ideology'`, render/polities.ts beside Unrest; viewLegends.ts)
Towns coloured by their largest kind-5 movement share (alpha by share), polities outlined by RegimeFamily. Picker: one ideology (its share
0–100%) or "largest". Time slider uses `History.adherents` (riots) and `ideoShares`. An **Ideologies panel** lists each `IdeologyInfo`: the
doctrine (first conceived where and when; peoples holding it, from ideaAdoptions), carriers and demands in plain words, adherents over time
(sparkline), movements and their fates, regimes its revolutions installed and how long they lasted.

### 6.4 Chronicle (hedged, neutral) and Legend (story, neutral) lines — `IDEO_T` in `ui/sagas/ideology.ts`, used by state.ts, year.ts, city.ts, world.ts
| event | Chronicle | Legend |
|---|---|---|
| doctrine conceived (IdeaConceived, kind Ideology) | "Around 2310 writers in Vasa are said to have argued that all men are born with equal rights." | "In Vasa men began to say that no one is born to rule." |
| MovementFounded (kind 5) | "A workers' association, later called the League of the Common Hearth, appears in the records of Genva in 2405." | "In the mill towns of Genva the Common Hearth was lit." |
| RegimeChanged Revolution → PartyState | "After the army's collapse in 2442 the Hearth party held the capital and ruled alone; elections thereafter had one list." | "The old crown fell with its army, and the Hearth ruled in its place." |
| RegimeChanged Revolution → LiberalOligarchy | "In 2380 the assembly of Tarsa declared the crown void and a republic of property-holders; about one man in seven could vote." | "Tarsa made itself a republic of those who owned land and shops." |
| FranchiseExtended | "In 2391 the vote in Ostra was extended to about 40% of grown men, during a winter of strikes." | "Ostra widened the vote while the streets were full." |
| Coup | "In 2455 officers from the Brenn garrison took the capital and suspended the assembly; casualties are not recorded." | "The colonels came down from Brenn, and the assembly did not meet again." |
| Election (TurnedOut) | "The ministry of 2470 lost the election and handed over office." | "The people voted, and the government changed." |
| RevolutionStage Thermidor | "By 2449 the committee's executions had stopped, and moderates returned to the council." | "The killing ended, and tired men took the seats of the zealous." |
| Restoration | "In 2385 the house of Arn returned to Tarsa with the backing of the Kingdom of Vosk." | "The exiled house came home behind foreign banners." |
| precursor crushed (egalitarian) | "The commune of Lisk, which held its goods in common, was taken by the bishop's levy in 1430; about 3,000 are said to have died." | "Lisk shared its bread for two summers, and then the levy came." |
Every regime's entries use the same templates for repression ("executions", "dead", "banned") and success ("revenues grew", "the vote widened",
"held office for N years"): the neutral voice states mechanics and outcomes only. **Lint test** (8.1): neutral tables (`IDEO_T`, both registers)
contain none of a list of evaluative words (`tyrann*, glorious, heroic, evil, wicked, noble cause, liberat*, oppress*, savage, righteous, despot*,
freedom-loving, enlightened`) — those may appear only in partisan tables.

### 6.5 Partisan sagas by ideology (experience 3.2: `Pov.kind 'ideology'`, id = ideology id)
- **Stance** for an ideology viewpoint k at year y: Us = polities whose regime is k's program regime installed by k (or whose ruling party/
  coalition is k: the largest-share loyal ideology), and k's movements; Kin = polities where `a_k ≥ 0.2`; Friend = regimes with `IAFF(k, program
  ideology) ≥ 0.3`; Foe = regimes that banned or crushed k's movements in the last 50 y, and regimes of ideologies with `IAFF ≤ −0.6`; Neutral else.
- **Rhetoric** (PARTISAN rules reused: own dead inflated, foe's dead minimised, omissions) plus `PARTISAN_IDEO_T` keys per ideology, `key.us`
  and `key.foe`, both registers. **Every ideology row has the same key set** (test: identical key sets across ideologies, both registers, no `{`
  left), so each gets an equally slanted voice. Examples:

| key | liberal (Us) | marxist (Us) | conservative (Us) | revivalist (Us) |
|---|---|---|---|---|
| revolution.us (chronicle) | "In {year} the friends of the constitution ended arbitrary rule in {cap}." | "In {year} the workers of {cap} took power from the exploiters." | "In {year} order was restored in {cap} after years of agitation." | "In {year} {cap} returned to the law of the faith." |
| crushed.foe (legend) | "The {foe} filled its prisons with men whose only crime was to ask for a vote." | "The {foe} shot the hungry in the squares, {toll} by our count." | "The {foe} mob burned the churches of {town}." | "The {foe} closed the houses of prayer and hanged the preachers." |
| regimeFell.us (chronicle) | "In {year} the republic fell to a conspiracy of officers." | "In {year} the revolution was betrayed by careerists." | "In {year} the crown was overthrown by faction and foreign gold." | "In {year} the faithful government was undone by unbelievers." |
- The tag line from experience 3.6 ("Partisan: numbers and blame are the teller's") and the link to the neutral record are always shown. The
  owner reviews `PARTISAN_IDEO_T` (experience 3.8 risk applies). Real ideologies get partisan voices **only** inside partisan sagas.

### 6.6 Seat-mode cards and orders (seat-mode 3.5/3.6 format; options' orders at year D+1)
| DecisionKind | trigger | options → orders |
|---|---|---|
| Franchise 27 | p Pluralist (or E2-eligible monarchy) and `thr ≥ 0.3` | Widen the vote (Franchise 41 p) · Hold firm (∅) · Crack down (Crackdown 30, riots) |
| RevolutionAbroad 28 | RegimeChanged with cause Revolution at a contacted polity q | Back them (Sponsor 42 p→q, their ideology) · Intervene for the old order (War p→q, with the counter-revolution drive) · Stay out (∅) |
| ArmyDemands 29 | p Pluralist with B1's hazard ≥ 0.05 | Give the officers what they ask (Placate 17) · Purge the command (Purge 18) · Ignore (∅) |
| order | key | rule |
|---|---|---|
| Franchise 41 | `franchise` | at give: f += 0.15 (Pluralist or ConstMon); for an eligible monarchy, route E2 fires at the next slow step with chance 1 (its draw kept); lords' grievance (court SigN) +0.1. Event FranchiseExtended |
| Sponsor 42 | `sponsor` | polity → polity + ideology (target `q·64 + k`): export pulses × 5 for 20 y; Subversion grievance as 4.6 |
| Censor 43 | `censor` | polity + ideology: β × 0.3 inside p for 20 y, adherents' grievance +0.05, riots' preference falsification (fear) up; with TTI, its ban (IdeaBanned 300) on the doctrine. Event MovementBanned |

### 6.7 Director (experience 0.1) registrations (`ui/ideologyFormat.ts`, weights [A]): 310 Politics 7 (×1.5 for the world's first of a regime),
311 Politics 3, 313 Politics 2 (TurnedOut 1, AntiSystem 4), 314 War 5, 315 Politics 3, 316 Politics 5, 317 Politics 4, 318 Politics 3, 319 Politics 2.

---

## 7. Determinism, step order, off switch

### 7.1 City-states GOV columns for Government 7–11 (their 4.11 table, [A])
| key | ConstRep | Party | Junta | Dict | TheoRep |
|---|---|---|---|---|---|
| war | 0.85 | 0.9 | 1.2 | 1.3 | 1.1 |
| tradeWar | 0.5 | 0.5 | 0.5 | 0.5 | 0 |
| tariff | 0.85 | 1.5 | 1.1 | 1.3 | 1.2 |
| merc / absorb / tribute | 0 / 1 / 0 | 0 / 1 / 0 | 0 / 1 / 0 | 0 / 1 / 0 | 0 / 1 / 0 |
| reach | 1.1 | 1.2 | 1.0 | 1.0 | 0.95 |
| unrest | 0.9 | 1.0 | 1.1 | 1.0 | 1.05 |
| crisis | 0.6 | 0.8 | 1.3 | 1.5 | 1.0 |
| holy | 1 | 0.5 | 1 | 1 | 1.5 |
REGIME_MODS (4) then covers only the keys GOV lacks (rate, repress, concede, overthrow, export, bloc, climate, pairPeace) for these values.

### 7.2 Placement [V polity/system.ts politySystem order; court-politics 11.1]
- `ideoYear(s, ps, I)` yearly after rulerYear, riots' uprisingYear and courtYear: event scan from `I.evSeen` (Revolution with a kind-5 program →
  `ideoRevolutionWon`; ReignEnded → leader-death pendings; PeaceMade → X2 pendings and the lost-war flags; riots' revelations → S1 pending), term-end
  elections (draws), RegimeChanged logging.
- `ideoSlow(s, ps, I)` every slowStep **right after `courtSlow`** and before `relationStep` (so blocs act this step): (1) inputs 2.2 and 3.1
  (no draws), (2) movement births (2.3, draws, after riots' births), (3) route walk (1.3: one draw per polity in `ps.alive` order), (4) Brinton
  stage pseudo-route is inside the walk (no extra draw), (5) exports (deterministic pulses; Subversion grievance), (6) bloc matrix write, (7) snapshot rows.
- Doctrine conception/learning: inside the ideas system's step (`learnAndConceive`) with draws on `s.ideo.rng` for kind-Ideology rows (0.5c), in
  people-then-idea order; these come before `ideoSlow` in the year.

### 7.3 RNG and identity
- Stream `createRng(seed, 'history-ideology')`, created only when on. All this plan's draws use it, in the fixed order above. Hooks on other systems'
  draws are threshold-only (declarations, alliance chance, overthrow, riots' response). `hash01` is not needed.
- Off: `s.ideo = null`; doctrines absent from `ix.defs`; MOV.slots 2; every hook `s.ideo !== null ? new : old`; multipliers skipped. Test: History
  equal to the run without ideologies on every pre-existing field (seeds 42:1200, 3:600, 9:800), with all sibling plans at defaults; goldens
  unchanged (perf-efficiency's hashes `923881e7cd3fe59b` seed 1 etc. [from future-tech 0.4]).
- **Shadow** `IDEO.effects = false`: doctrines, movements, inputs and route walks computed and recorded, regimes logged in `modernRegimes` but not
  written to `G.form`, no hooks read them, no `ideoRevolutionWon`. Must equal off on all pre-existing fields except ideas/movements rows of kind
  Ideology (filtered). Kept as a test until step 9.
- Golden-hash filters skip keys `ideologies, modernRegimes*, revolutions, franchise, ideoShares`, events 310–319, ideas of kind Ideology and riots
  movements of kind 5.
- Prefix stability: append-only rows; a 1500-year run equals the first 1500 years of a 3000-year one (test).
- Checkpoints (perf P6): `IdeoState` is one object on `HistoryState`, captured by `RunnerState`.
- Arithmetic only `+ − * /`, smoothstep, min/max (no exp/log/pow in the sim; `young = 30/(30+age)` instead of an exponential).

---

## 8. Ordered commit-sized steps (each: `npm test`, `npm run typecheck` green)
1. **Registry and contract** — `ideology/registry.ts` (types 1.1–1.2, `walkHazards`, register functions), contract enums 5.1, events 5.2 (unused),
   tables 5.3 empty, `emptyIdeologyHistory`, option `ideologies` (default false), state 5.4. Tests: registration order = ids; duplicate key throws;
   `walkHazards` table cases; off identity trivially holds.
2. **Doctrines as ideas** — `ideology/doctrines.ts` rows 2.1; `ix.defs` suffix (0.5a); `ideoIdeaCtx` (0.5b); Ideology draws on `s.ideo.rng` (0.5c);
   caps/weight 0. Tests: suffix property; tech levels unaffected by doctrines held (synthetic); `PRE` resolves with techTree off; off identity on 3 seeds.
3. **Inputs** — `ideology/inputs.ts` (2.2, 3.1) with every proxy. Tests: bounds 0..1, proxies when siblings are null, RNG-free (stream untouched).
4. **Movements** — MovementKind 5 rows 2.4 through riots (0.5 riots a–c), birth rule 2.3, slots 3; proxy A[p,k] without riots. Tests: no births where the
   doctrine is not held (except egalitarian); scope 'people' never spreads to another people's towns; egalitarian gate needs a shock.
5. **Regimes and routes** — `ideology/rows.ts` regimes 3.2 and routes 3.3, `ideoSlow` walk, `setForm` silent, `modernRegimes` log, RegimeChanged,
   franchise/contestation. Tests: by-construction invariants (8.1 list); one draw per polity per slow step (counter); hysteresis LO↔Dem.
6. **Revolutions with programs** — `ideoRevolutionWon`, programs 2.4, ReignEnd 12, revolutions table, Brinton stages 3.4, restoration X1 via riots'
   `restore`. Tests: Skocpol gate (Marxist rising with brk < 0.4 never installs a PartyState); synthetic revolution reaches Thermidor → Strongman.
7. **Heads and elections** — 3.5 through city-states' elected-head machinery and rulers; ReignEnd 13; Election events. Tests: term lengths; incumbency rate.
8. **Behaviour** — REGIME_MODS (4), GOV columns 7.1, `setIdeoRateMul`, riots utilities, overthrow, tariffs; exports 4.6 and Subversion; blocs 4.7.
   Tests: each hook skipped with `s.ideo` null; dyad peace term only for Pluralist pairs; sign-diversity check (9.4).
9. **Harness and tuning** — `ideology/ideologyStats.ts` (section 9), the 21-seed sweep at 2000 and 3000 years, realism scorecard A/B; shadow test dropped
   with a commit note; default flips to true only if every target row passes.
10. **UI** — `ui/ideologyData.ts`, regime timeline, `ViewMode.Ideology`, Ideologies panel, Chronicle/Legend `IDEO_T`, director registrations. Tests:
    no `{` left; lint of evaluative words in neutral tables; URL `view=ideology&ideo=<key>`.
11. **Partisan sagas** — `Pov.kind 'ideology'`, stance rules 6.5, `PARTISAN_IDEO_T`. Tests: neutral sagas byte-identical (experience test 1); identical
    key sets per ideology; foe keys used for a Foe regime.
12. **Seat mode** — DecisionKind 27–29, OrderKind 41–43 (6.6). Tests: orders neutral when absent; Franchise order fires E2 with the draw kept.

### 8.1 Invariant tests (by construction; must hold on every seed)
- No doctrine held without its prerequisites; no `naturalRights` before `printing` has been held 100 years by that people.
- No modern regime in a polity whose ruling people holds no doctrine of the program or route that produced it (E1–E3 need liberal/rights/republican
  adherents; R* needs a kind-5 movement).
- No PartyState without `marxism` held and `brk ≥ 0.4` at its revolution; no TheocraticRepublic without religion on.
- No socialist/marxist/anarchist movement without TTI's `factory` held (or X > 0).
- Every RegimeChanged has a matching `modernRegimes` row and (with city-states) a `governments` row of the same year.
- Partisan/neutral lint (6.4) and key-set symmetry (6.5).

---

## 9. Stats harness and calibration targets

### 9.1 Baseline [M] (`ideoProbe.ts`, default options, 2000 years, 21 distinct seeds)
The "22-seed sweep" (realism-metrics.md: HISTORY_STATS_SEEDS plus 7 and 1234) has **21 distinct seeds**: 7 is already in HISTORY_STATS_SEEDS [V stats.ts:25].
| quantity | value over 21 seeds |
|---|---|
| peoples per world | 6–12 |
| Kingdom+/Empire polities alive at 2000 | kingdoms 1–19, empires 0–8 |
| `printing` ever conceived | 17 / 21; first year 1320–1910, median ≈ 1750 |
| `printing` held ≥ 300 years by 2000 (first ≤ 1700) | 7 / 21 (seeds 2024, 3, 6, 9, 42, 5, 1337) |
| `science` ever conceived | 11 / 21 (first 1610–1995) |
| `banking` ever conceived | 18 / 21 |
Reading: with the 8cabf09 tree, a 2000-year default run reaches print on most worlds but the late eras only on a few; TTI puts newspapers at
~1900–2300 and factories at ~2200–2650 on leading peoples (its 2.1). So at 2000 years only rights/liberal doctrines can appear, on a few worlds;
industrial doctrines need runs of ≈ 3000 years. That gives "late and only some worlds" from the preconditions themselves, before any tuning.

### 9.2 Targets (`ideologyStats.ts [--off] [--json] [--years N] seeds…`; seeds 1, 7, 42, 1234 for the gate; the 21-seed sweep once before merging)
Primary runs: **3000 years with techTree on** (TTI's "modern preset"); guard: 2000 years (the default). Counts are worlds out of 21. All are design
targets [A] chosen against the real-world rarity below, not facts.

| metric | 2000 y (guard) | 3000 y (primary) | real-world anchor |
|---|---|---|---|
| worlds with any doctrine conceived | 2–8 | 10–18 | — |
| `naturalRights` first conception | ≥ printing + 100 y everywhere (invariant) | median ≥ 2150 | Locke 1689 is ~240 y after Gutenberg |
| worlds with `nationalism` | 0–4 | 7–15 | |
| worlds with `socialism` / `marxism` | 0 / 0 | 4–12 / 2–8 | |
| worlds with ≥ 1 ConstitutionalMonarchy or LiberalOligarchy ever | 0–5 | 6–14 | |
| worlds with ≥ 1 **Democracy** ever | 0–2 | **2–7** | no country was a democracy in 1800 (OWID, RoW) [verified]; Huntington counts 12 democracies after the first reverse wave [verified] |
| of democracies ever, share that reverted at least once | — | ≥ 30% | first and second reverse waves (Huntington 1991) [verified] |
| worlds with ≥ 1 **PartyState** ever | 0 | **1–5** | |
| PartyStates arising with `ind < 0.4` and `brk ≥ 0.4` | — | ≥ 60% | Skocpol 1979 [verified-search] |
| PartyState median duration | — | 30–80 y | party regimes the most durable (Geddes 1999) [verified-search] |
| worlds with a Junta ever; Junta median spell | 0–3 | 5–14; 5–15 y | military median 8 y (GWF 2014) [verified] |
| Dictatorship median spell | — | 5–20 y | personalist median 8 y (GWF 2014) [verified] |
| coup attempts succeeding (Coup events extra 0/1/2 vs 3) | — | 35–65% | 227 of 457 (Powell & Thyne 2011) [verified] |
| revolutions with a regime ending in Restoration or Strongman within 30 y | — | 50–80% | 1848 (Weyland 2009) [verified-search]; Brinton [verified-search] |
| egalitarian precursor movements: worlds with ≥ 1; share crushed or faded; triumphs lasting > 30 y | 6–16; ≥ 85%; ≤ 3% | same | Britannica entries above |
| Kingdom+ polities under a modern regime at the last year (median over worlds) | ≤ 5% | 5–25% | |
| wave clustering: dispersion index of Pluralist entries per decade (Poisson = 1) | — | ≥ 1.5 | Huntington's waves; Doorenspleet (2000) [verified-search] disputes the wave count **[D]**: reported, not gated |
| franchise: share of Pluralist polity-decades with f ≥ 0.5 | — | 20–50% | widening over a century (A&R 2000) |
| 6000 y (secondary, report only) | | democracy and party states more common, still reverting | |

### 9.3 Realism scorecard (realism-metrics.md 6): off vs on, seeds 1, 7, 42, 1234
- Guard: realism score must not rise by > 0.03; no WORSE row; in particular `lifeK.mean`, `war.alpha`, `war.durCv`, Zipf, Gibrat. At 2000 years the
  feature should be nearly inert: expect every row within ±0.02.
- Intended to improve: none at 2000 y. At 3000 y, report `lifeK.mean` (regime breakdowns and coups shorten no polity's life: they change its
  regime, not its existence; any drift > 5% is a bug to explain).
- Specific: wars initiated per polity-year under each family (report; Weeks' ordering Dictatorship > Junta > PartyState should hold in sign).

### 9.4 Even-handedness checks (report, gate on sign diversity)
- For each regime, its rank on war appetite, tax capacity, credit, durability and repression: no regime ranks first (best for its people by the
  measure) on all of them, and no regime ranks last on all.
- Neutral-table lint and partisan key symmetry (8.1).

---

## 10. Performance and memory [A, from counts: ~200 polities alive, 3–8 k settlements, 11 ideologies, ~30 routes]
- Inputs: O(settlements) per slow step (~8 k × 10 floats) ≈ 0.1 ms; route walk O(P · routes) ≈ 6 k hazard evaluations per slow step ≈ 0.2 ms.
- Movements: riots' spread with 3 slots instead of 2 (+50% of their spread cost; riots estimated it small).
- Doctrines: 10 more ideas × 6–12 peoples in the ideas step: negligible (ideas cost ~1 s of a 51–72 s 6000-year run [M, future-tech 1.2]).
- Memory: per settlement ~40 B, per polity ~300 B + P·K shares; History rows: a few thousand. Under 1 MB for a 3000-year run.

---

## 11. Risks, open questions; verified / measured / assumed

### Risks
- **Inert at 2000 years.** By design most worlds show nothing modern at the default length. If the owner wants ideologies visible at 2000, the only
  honest lever is TTI's pacing (or the 3000-year preset), not lowering this plan's thresholds.
- **Too many moving parts upstream.** Without riots, revolutions with programs do not exist and only reform/coup routes act; without city-states,
  Government is not written. The proxies keep the system coherent but thinner; the harness reports which siblings were on.
- **Real ideologies in a game.** Mitigations: neutral templates and lint (6.4), symmetric partisan voices (6.5), colours without party conventions
  (6.2), behaviour multipliers whose signs differ by axis (9.4), every contested empirical claim marked [D]. The owner should review `IDEO_T`,
  `PARTISAN_IDEO_T` and the REGIME_MODS table.
- **Theory fit is loose.** Moore, Skocpol, Brinton and Huntington are case-based and contested; the sim encodes tendencies (program conditions and
  hazards), not their causal claims. The harness checks the qualitative orderings, not historical frequencies.
- **Slot pressure.** 3 movement slots per town may still crowd out medieval kinds (Reform, Commune) in modern towns; they decay naturally, but watch
  riots' Ideology cause share (their target 3–15%).
- **Double counting** of court Constitutional and ConstMon modifiers: handled by "court column applies, this plan adds franchise terms only" (4).

### Open questions (owner)
1. Default run length for the "modern" experience: 3000 years (TTI's suggestion) or keep 2000 and accept near-absence?
2. Should an in-world regime ever be labelled with a real ideology's name in the UI ("Marxist party state"), or always with the in-world movement's
   name plus a generic category ("a one-party state of the Common Hearth")? The plan uses doctrine names in the Ideologies panel and in-world names
   in prose.
3. Imposition (X2) after conquest: keep, or leave regime change to internal routes only?

### Verified [V]
Ideas per people, `IDEA_DEFS` 45 rows eras 0–4, draws per (people, idea), `PRE` throws on unknown key (ideas/state.ts, params.ts, system.ts header);
IdeaKind 0–7, IdeaHow 0–13, `IdeaAdoptions.idea` Uint8 (contract.ts:1644–1699); ReignEnd 0–8, AccessionHow 0–6 (contract.ts:862–885); POLITY step 5,
slowStep 10 (polity/params.ts:12–13); ALLIANCE params (polity/params.ts:571); `faithRivalry` in relationStep (relations.ts:113); 2000-year default
(history/params.ts:8); HISTORY_STATS_SEEDS (stats.ts:25). Sibling plans read: riots-uprisings, city-states, court-politics, society, state-finances,
seat-mode, experience-whatif-director-sagas, language-drift, realism-metrics, tech-tree-innovation, future-tech, future-politics.

### Measured [M]
Section 9.1 (21 seeds, 2000 years, 4 in parallel on 2 cores, ~7 s per run alone).

### Assumed [A]
Every hazard constant, threshold, receptivity formula, REGIME_MODS and GOV column value, IDEO param and target band. Doctrine `chance`/`teach`.

---

## References
Tags: [verified] = a page confirming the work was opened this session; [verified-search] = confirmed in a search listing of the publisher's or an
index's page (title, author, venue, year), page not opened.

- Acemoglu, D. & Robinson, J. A. (2000). Why did the West extend the franchise? Democracy, inequality, and growth in historical perspective. *Quarterly
  Journal of Economics* 115(4), 1167–1199. doi:10.1162/003355300555042 (handle shown on https://ideas.repec.org/a/oup/qjecon/v115y2000i4p1167-1199..html). [verified]
- Acemoglu, D. & Robinson, J. A. (2006). *Economic Origins of Dictatorship and Democracy*. Cambridge University Press. https://www.cambridge.org/core/books/economic-origins-of-dictatorship-and-democracy/ [unverified: not searched this session; cited only alongside the 2000 article]
- Acemoglu, D., Johnson, S., Robinson, J. A. & Yared, P. (2008). Income and democracy. *American Economic Review* 98(3), 808–842. https://econpapers.repec.org/RePEc:aea:aecrev:v:98:y:2008:i:3:p:808-42 [verified-search]
- Anderson, B. (1983). *Imagined Communities: Reflections on the Origin and Spread of Nationalism*. Verso. https://en.wikipedia.org/wiki/Print_capitalism ; library record https://search.libraries.emory.edu/catalog/9936928809702486 [verified-search]
- Ansell, B. W. & Samuels, D. J. (2014). *Inequality and Democratization: An Elite-Competition Approach*. Cambridge University Press. https://www.cambridge.org/core/product/identifier/9780511843686/type/book [verified-search]
- Becker, S. O. & Woessmann, L. (2009). Was Weber wrong? A human capital theory of Protestant economic history. *Quarterly Journal of Economics* 124(2), 531–596. https://econpapers.repec.org/RePEc:oup:qjecon:v:124:y:2009:i:2:p:531-596. [verified-search]
- Boix, C. & Stokes, S. C. (2003). Endogenous democratization. *World Politics* 55(4), 517–549. https://www.cambridge.org/core/journals/world-politics/article/abs/endogenous-democratization/B813380A747708BE21A0B28742640EBA [verified-search]
- Brinton, C. (1938). *The Anatomy of Revolution*. Project Gutenberg eBook 78065. https://www.gutenberg.org/ebooks/78065 [verified-search]
- Britannica. "Mazdakism". https://www.britannica.com/topic/Mazdakism [verified]
- Britannica. "Taiping Rebellion". https://www.britannica.com/event/Taiping-Rebellion [verified] (1850–64, ~20 million dead, property in common)
- Britannica. "Taborite". https://www.britannica.com/topic/Taborites [verified-search]
- Britannica. "Digger". https://www.britannica.com/event/Digger [verified-search]
- Burke, E. (1790). *Reflections on the Revolution in France*. Project Gutenberg subject page https://www.gutenberg.org/ebooks/subject/17871 [verified-search]
- Cambridge University Library. "The Anabaptist kingdom of Münster" (exhibition). https://exhibitions.lib.cam.ac.uk/reformation/artifacts/the-anabaptist-kingdom-of-munster/ [verified-search]
- Cohn, N. (1957). *The Pursuit of the Millennium*. Secker & Warburg. Review: https://www.cambridge.org/core/journals/church-history/article/abs/pursuit-of-the-millennium-by-norman-cohn-london-secker-and-warburg-1957-xvi-476-pp-including-an-appendix-bibliography-and-index-42-shillings/F0581B2CC5D7652461EDDBAE01F01E60 [verified-search]
- Dahl, R. A. (1971). *Polyarchy: Participation and Opposition*. Yale University Press. https://en.wikipedia.org/wiki/Polyarchy [verified-search]
- Dittmar, J. E. (2011). Information technology and economic change: the impact of the printing press. *Quarterly Journal of Economics* 126(3), 1133–1172. doi:10.1093/qje/qjr035. https://ideas.repec.org/a/oup/qjecon/v126y2011i3p1133-1172.html [verified]
- Doorenspleet, R. (2000). Reassessing the three waves of democratization. *World Politics* 52(3). https://cambridge.org/core/journals/world-politics/article/reassessing-the-three-waves-of-democratization/25A6CB38E6746F98D882DFC43A54D211 [verified-search]
- Gartzke, E. (2007). The capitalist peace. *American Journal of Political Science* 51(1), 166–191. https://ideas.repec.org/a/wly/amposc/v51y2007i1p166-191.html [verified-search]
- Geddes, B. (1999). What do we know about democratization after twenty years? *Annual Review of Political Science* 2, 115–144. doi:10.1146/annurev.polisci.2.1.115 (DOI shown in the listing https://www.citedrive.com/en/discovery/what-do-we-know-about-democratization-after-twenty-years/) [verified-search]; qualitative summary opened at https://adambrown.info/p/notes/geddes_what_do_we_know_about_democratization_after_20_years [verified]
- Geddes, B., Wright, J. & Frantz, E. (2014). Autocratic breakdown and regime transitions: a new data set. *Perspectives on Politics* 12(2). doi:10.1017/S1537592714000851. PDF opened: https://sites.psu.edu/dictators/wp-content/uploads/sites/12570/2014/06/GeddesWrightFrantz_Autocratic-Breakdown.pdf (median spells: all autocracies 14 y, military and personalist 8 y; military the only type more likely to democratise than not; fewer than one in five coerced breakdowns lead to democracy) [verified]
- Gellner, E. (1983). *Nations and Nationalism*. Blackwell. https://www.lse.ac.uk/researchAndExpertise/units/gellner/ReviewNaN.html [verified-search]
- Hroch, M. (1985). *Social Preconditions of National Revival in Europe*. Cambridge University Press. Review essay: https://cambridge.org/core/journals/nationalities-papers/article/twentyfive-years-of-abc-miroslav-hrochs-impact-on-nationalism-studies/D58DCCBFFDCCAEF90542B046C917E5A0 [verified-search]
- Huntington, S. P. (1991). Democracy's third wave. *Journal of Democracy* 2(2), 12–34. doi:10.1353/jod.1991.0016. PDF opened: https://www.ned.org/docs/Samuel-P-Huntington-Democracy-Third-Wave.pdf (first wave 1820s–1926; first reverse wave 1922–42 to 12 democracies; second wave peaking at 36 in 1962; second reverse 1960–75 to 30; third wave from 1974) [verified]; book *The Third Wave* (University of Oklahoma Press, 1991) https://search.worldcat.org/title/third-wave-democratization-in-the-late-twentieth-century/oclc/23649664 [verified-search]
- Kuran, T. (1991). Now out of never: the element of surprise in the East European revolution of 1989. *World Politics* 44(1). doi:10.2307/2010422. https://sites.duke.edu/timurkuran/1991/10/01/article-now-out-of-never-the-element-of-surprise-in-the-east-european-revolution-of-1989/ [verified-search]
- Lenin, V. I. (1902). *What Is To Be Done?* https://marxists.org/archive/lenin/works/1901/witbd/index.htm [verified-search]
- Linz, J. J. (1978). *The Breakdown of Democratic Regimes: Crisis, Breakdown, and Reequilibration*. Johns Hopkins University Press. https://www.press.jhu.edu/books/title/8633/breakdown-democratic-regimes [verified-search]
- Lipset, S. M. (1959). Some social requisites of democracy: economic development and political legitimacy. *American Political Science Review* 53(1), 69–105. doi:10.2307/1951731 (listing https://www.doi.org/10.2307/1951731) [verified-search]
- Locke, J. (1689). *Two Treatises of Government*. Project Gutenberg eBook 7370. https://www.gutenberg.org/ebooks/7370 [verified-search]
- Lührmann, A., Tannenberg, M. & Lindberg, S. I. (2018). Regimes of the World (RoW): opening new avenues for the comparative study of political regimes. *Politics and Governance* 6(1), 60–77. https://www.cogitatiopress.com/politicsandgovernance/article/view/1214/1214 [verified-search]
- Mansfield, E. D. & Snyder, J. (1995). Democratization and the danger of war. *International Security* 20(1). https://muse.jhu.edu/article/447386/summary [verified-search]
- Maoz, Z. & Russett, B. (1993). Normative and structural causes of democratic peace, 1946–1986. *American Political Science Review* 87(3), 624–638. https://ideas.repec.org/a/cup/apsrev/v87y1993i3p624-638_7.html [verified-search]
- Marx, K. & Engels, F. (1848). *Manifesto of the Communist Party*. https://www.marxists.org/archive/marx/works/1848/communist-manifesto/preface.htm [verified-search]
- Moore, B., Jr. (1966). *Social Origins of Dictatorship and Democracy: Lord and Peasant in the Making of the Modern World*. Beacon Press. https://archive.org/details/socialoriginsofd00barr [verified-search]
- North, D. C. & Weingast, B. R. (1989). Constitutions and commitment: the evolution of institutions governing public choice in seventeenth-century England. *Journal of Economic History* 49(4), 803–832. doi:10.1017/S0022050700009451 (listing https://www.doi.org/10.1017/S0022050700009451) [verified-search]
- Our World in Data. "Democracy". https://ourworldindata.org/democracy (opened: "No country was a democracy" in 1800; about 1.6 billion people in electoral and 600 million in liberal democracies in 2025) [verified]
- Powell, J. M. & Thyne, C. L. (2011). Global instances of coups from 1950 to 2010: a new dataset. *Journal of Peace Research* 48(2), 249–259. PDF opened: https://www.uky.edu/~clthyn2/powell-thyne-JPR-2011.pdf (457 attempts, 227 successful) [verified]
- Proudhon, P.-J. (1840). *What is Property?* Project Gutenberg eBook 360. https://gutenberg.org/ebooks/360 [verified-search]
- Przeworski, A. & Limongi, F. (1997). Modernization: theories and facts. *World Politics* 49(2), 155–183. https://muse.jhu.edu/article/36370 [verified-search]
- Skocpol, T. (1979). *States and Social Revolutions: A Comparative Analysis of France, Russia and China*. Cambridge University Press. https://www.cambridge.org/core/books/states-and-social-revolutions/9481262B2BDA1BFFB3C9218DBD447190 [verified-search]
- Svolik, M. W. (2012). *The Politics of Authoritarian Rule*. Cambridge University Press. https://www.cambridge.org/core/product/identifier/9781139176040/type/book [verified-search] (background for party-regime durability; no constant taken from it)
- Treisman, D. (2020). Democracy by mistake: how the errors of autocrats trigger transitions to freer government. *American Political Science Review* 114(3), 792–810. https://www.cambridge.org/core/journals/american-political-science-review/article/democracy-by-mistake-how-the-errors-of-autocrats-trigger-transitions-to-freer-government/7F9054A5F636EEE21B3BF56EF1BF8930 [verified-search] (supports the noise term: E2's incompetent-ruler concessions use riots' policy noise ν)
- United States National Archives. Declaration of Independence: a transcription. https://www.archives.gov/founding-docs/declaration-transcript [verified-search]
- Weeks, J. L. (2012). Strongmen and straw men: authoritarian regimes and the initiation of international conflict. *American Political Science Review* 106(2), 326–347. doi:10.1017/S0003055412000111 (listing https://www.doi.org/10.1017/S0003055412000111) [verified-search]
- Weyland, K. (2009). The diffusion of revolution: "1848" in Europe and Latin America. *International Organization* 63(3), 391–423. https://ideas.repec.org/a/cup/intorg/v63y2009i03p391-423_09.html [verified-search]
- Woodberry, R. D. (2012). The missionary roots of liberal democracy. *American Political Science Review* 106(2), 244–274. https://ideas.repec.org/a/cup/apsrev/v106y2012i02p244-274_00.html (opened: missionary presence linked to about half the variation in democracy outside the West) [verified]
- Ziblatt, D. (2017). *Conservative Parties and the Birth of Democracy*. Cambridge University Press. https://www.cambridge.org/core/product/identifier/9781139030335/type/book [verified-search]
- Sibling sources cited through other plans (not re-verified here): Tilly (1990), Ertman (1997), Weber (*Economy and Society*) via court-politics.md; Granovetter (1978), Kuran (1989) via riots-uprisings.md.

## Addendum (central registry)
Renumbered: OrderKind 62–64 (not 41–43) and DecisionKind 47–49 (not 27–29); character-mode and migration-borders hold the earlier values. future-politics therefore uses OrderKind 65–67 and DecisionKind 50–52. See _CONVENTIONS.md.

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **R4b.** Event 310 is renamed **`ModernRegimeChanged`**: court-politics owns `RegimeChanged: 292`.
- **R12.** Apply `REGIME_MODS` only for `rate, repress, concede, overthrow, export, bloc, climate, pairPeace`, and never the ConstitutionalMonarchy column (court's Constitutional supplies it). The `war`/`grief`/`tax`/`tariff` cells are documentation. GOV columns 7–11 carry those hooks.
- **R14 and stale numbers.** OrderKind **62–64**, DecisionKind **47–49** (not 41–43 / 27–29). FP uses OrderKind 65–66, DecisionKind 50–51, Government 12–29, GovernmentCause 23–41 (not 16+ / 30+).
- **D-dup 1.** With city-states on, `History.modernRegimes` is an extension table keyed to `History.governments` rows (franchise, contestation, stage), not a second form log.
- `pairPeace` and `intervene` are C1 factors 5 and 6.


## Addendum (barriers & cold war)
Overrides the body and earlier addenda where they differ. Source of truth: barriers-coldwar.md (formulas, params, ids).
- **Phase 4, ideological cold wars** (barriers §3.6):
  - `AFF(fam_a, fam_b) ≤ −0.5` flags a cold war as ideological, and κ `+= 0.3`;
  - the §4.6 export pulse `×(1 + CW.subvert 1.0·κ)` into the rival principal and its clients (Subversion 14 as is);
  - client defection reads AFF.
  - BlocFormed 318 stays yours. Do not add a bloc factor to C7: cold-war `sphere` is C7 factor 6.
- `climate_p` is also C12's censorship factor, for incoming Ideology-kind ideas only. It is not a second C10 factor.
