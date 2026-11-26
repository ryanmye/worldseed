# Plan: Tech tree to the electrical age, and innovation driven by pressures (necessity, factor prices, resources, scale, openness, fragmentation)

Base commit 8cabf09 (pristine checkout `/home/claude/ryanmye/worldseed`, read-only). Scratch copy used for measuring: `/home/claude/scratch-tech`
(probe: `probe/probe-tech.ts`; it times `ideasYear` with a single instrumented line in the scratch `index.ts`).
Tags: **[V]** verified in code (file:line), **[M]** measured in the scratch copy, **[A]** assumed: a design default or calibration
constant, **not a fact**. **[R]** means a claim from the literature; **[R?]** means a debated claim, with the dispute named. Every [R]/[R?]
carries an inline (Author Year) resolved in the **References** section at the end, per the `_CONVENTIONS.md` citation rule.
Each reference there is tagged:
- **[verified]**: I opened a publisher, RePEc or library page confirming author, title, venue and year (and the quoted finding where one
  is used);
- **[verified-search]**: the title, venue and year were confirmed only by a search listing;
- **[unverified]**: the reason is given.
**Every number without a citation is a design default.** The `history` column of the catalogue (2.5) is documentation text, in the style
of the existing params.ts notes. Those dates and figures are general history, **[unverified]** item by item. They are not model inputs
and must be checked against a standard reference when written into params.ts.

Two switches, both off by default until step 14. With both off the run is **bit-identical**:
- `HistoryOptions.techTree` adds the catalogue v2: 62 ideas appended to `IDEA_DEFS` (ids 45–106), eras 5–7, new levers, coal and timber context.
- `HistoryOptions.innovation` adds the pressure model: conception and adoption multipliers, Bass intensities, bans, flight, catch-up drives, and
  Henrich-style loss. It works on either catalogue.

Both need `ideas` on. `techTree` without `innovation` is valid: the new ideas then follow today's rule (chance × preconditions).

---

## 0. Interfaces (one contract for the implementer and the sibling plans)

### 0.1 Ids and enum values (next free values; none are in the `_CONVENTIONS.md` registry yet, so these are claims to register)
| enum | new values | owner note |
|---|---|---|
| EventType | **300 IdeaBanned, 301 IdeaBanLifted, 302 InnovatorsFled, 303 IdeaTakeoff, 304 Industrialised, 305 CatchUpDrive, 306 TimberFamine**; 307–309 reserved | block 300–309 |
| IdeaKind (contract.ts:1644, 0–7 used) | **8 Industry, 9 Communication** | **Conflicts:** future-tech.md 0.2 provisionally claims 8–12 and future-politics.md uses MIR's `Ideology` as provisional 8. Both say they renumber to the next free value. Proposed registry: 8–9 here, 10 Ideology (MIR), 11–15 future-tech (Energy, Computing, Life, Space, Earth) |
| IdeaHow (contract.ts:1653, 0–13; 13 Lost is a sentinel) | **14 Hired** (foreign experts brought in by a catch-up drive). `CH` 14 → 15 (state.ts:15) | **Conflict:** future-tech.md claims 14 Recovered; proposed 15 Recovered, `CH` 16. `acc`, `rate`, `pulse` grow by 1/14 per value |
| IdeaResist (contract.ts:1661, 0–2) | **3 Vested** (incumbents of a displaced technique), **4 Ban** (a polity ban in force) | |
| IdeaLoss (contract.ts:1657, 0–2) | **3 Dwindled** (collective brain too small for the skill, Henrich) | |
| OrderKind (30–32 riots, 33–38 court-politics) | **39 BanIdea, 40 InviteExperts** (seat-mode orders; optional, step 13) | next free after court-politics |
| DecisionKind (0–24 used) | **25 BanIdea, 26 InviteExperts** (the matching decision cards) | next plans start at 27 |

### 0.2 Hooks this plan exposes (`ideas/hooks.ts`; O(1), RNG-free; callers guard with `s.ideas !== null`, as the existing levers do [V hooks.ts:128–183])
```ts
/** Index of an idea by key in this run's catalogue, -1 if absent (catalogue v1, or a key of a plan that is off). Lookup tables only, built at module load. */
ideaIndex(key: string): number
/** 1 when people p holds idea i now. */
ideaHeld(ix, p, i): boolean
/** Intensity 0..1 of a held idea in people p (the Bass S-curve, 4.7). It is 1 for era <= IDEA2.sFrom-1 ideas, and 0 when not held. */
ideaIntensity(ix, p, i): number
/** Literacy share 0..1 of people p (4.8). */
ideaLiteracy(ix, p): number
/** Industrial index 0..1 of people p: mean intensity over INDUSTRIAL_CORE (4.11). Wage labour share proxy for ideologies and society. */
ideaIndustrial(ix, p): number
/** Openness ("scope of thinking") 0..1 of people p this step (3.5). */
ideaOpenness(ix, p): number
/** New levers (section 2.3): tax extraction multiplier, interest-rate multiplier (<= 1), siege power, all-disease toll multiplier,
 *  famine death multiplier, battle fire multiplier, naval multiplier, ArmyEra (0..6), and infrastructure unlocks. */
ideaFisc(ix, p); ideaCredit(ix, p); ideaSiege(ix, p); ideaTollAll(ix, p); ideaFamine(ix, p); ideaFire(ix, p); ideaNaval(ix, p): number
ideaArmy(ix, p): number
ideaUnlock(ix, p, infra: InfraKey): number   // 0 locked; else the intensity of the best unlocking idea (cost and speed multipliers scale with it)
ideaInfraMul(ix, p, infra: InfraKey, what: 'cost' | 'speed'): number
/** Era frontier: the highest era of which people p holds at least half of the ideas. Read by renderers and sagas. */
ideaEra(ix, p): number
```
UI-side twins, computed from `History` (no sim import except params, like `ideasData.ts` [V ideasData.ts:11]):
`eraAt(h, p, year)`, `intensityAt(h, p, i, year)` (from the IdeaTakeoff rows plus the Bass closed form, 4.7), `literacyAt(h, p, year)` (snapshot).

### 0.3 The innovation-pressure interface (generic and era-agnostic; future-tech.md reuses it as is) — `ideas/pressure.ts`
```ts
/** Pressure channels: per-people log-indices, recomputed every IDEA.step years. 0 means the reference world. Ids 0..15 are fixed;
 *  future-tech.md registers 16+ at module load, in a fixed order. */
export const PressCh = { War: 0, Rivalry: 1, Labour: 2, Land: 3, Energy: 4, Market: 5, Open: 6, Frag: 7, Shock: 8, Scale: 9 } as const  // 10..15 reserved here
export interface PressSpec {
  /** β per channel for conception (log-multiplier per unit of z − ref). Absent: the kind's default row (KIND_BETA). */
  c?: Partial<Record<keyof typeof PressCh | string, number>>
  /** β per channel for adoption speed (profitability, Griliches). Absent: KIND_BETA_ADOPT. */
  a?: Partial<Record<keyof typeof PressCh | string, number>>
  /** Factor bias (Hicks): +1 labour-saving, +1 land-saving, +1 energy-using (enters Labour, Land, Energy with these signs). */
  bias?: { labour?: number; land?: number; energy?: number }
}
export interface InnovationPressure {
  K: number                 // channel count (10 + registered)
  z: Float64Array           // z[p * K + k], this step
  ref: Float64Array         // reference offsets c_k (measured, section 6.1); constant per build
  why: Float32Array         // scratch: per-channel log-multipliers of the last call
}
export function registerChannel(name: string, fn: (s: HistoryState, ix: IdeasState, p: number) => number, ref: number): number  // returns k
export function pressureStep(s: HistoryState, ix: IdeasState): void          // fills z (RNG-free)
export function conceiveMul(ix: IdeasState, p: number, i: number): number    // Π_k clamp(...), section 3.1
export function adoptMul(ix: IdeasState, p: number, i: number): number
export function pressureWhy(ix: IdeasState, p: number, i: number, out: Float32Array): void  // log-multipliers per channel (UI record)
```
**The contract for future-tech.md**: its ideas carry `era >= 8`, `press` specs over the same channels (and its own registered ones),
and `pre` keys from the **terminal frontier** (0.4). Nothing here is era-specific except the KIND_BETA defaults, which are per IdeaKind.

### 0.4 Where this tree stops (attach points for future-tech.md)
- Last era: **7, "The age of steel and electricity"** (real c. 1850–1914). Era 8+ belongs to future-tech.md.
- **Terminal frontier** (keys that no idea of mine rests on; future-tech should take its prerequisites from these):
  `electricPower, combustionEngine, radio, fertiliser, germTheory, sanitation, massSchooling, assemblyLine, bessemer, machineGun, ironclad,
  refrigeration, limitedLiability`.
  Suggested first future-tech attachments (theirs to decide): aviation ← combustionEngine + bessemer; antibiotics ← germTheory + chemistry;
  computing ← electricPower + radio + massSchooling; green revolution ← fertiliser + breeding; nuclear ← electricPower + chemistry + science.
- **Resolved against future-tech.md as written.** Its title is "electrification to an invented future", and its 0.3 dedupes any F0 row
  that duplicates this tree. So 1914 onward (aviation, antibiotics, broadcast, nuclear, computers) is theirs, and their eras start at
  `TT_LAST_ERA + 1 = 8`.
- Their indirection table `TT` (future-tech 0.3) maps to my keys as follows:
  `steam: 'steamEngine'`, `rail: 'railway'`, `telegraph: 'telegraph'`, **`power: 'electricPower'`** (their placeholder 'electricity'),
  **`chem: 'chemistry'`** ('industrialChemistry'), `germ: 'germTheory'`, `vaccine: 'vaccination'`, **`factory: 'factory'`**
  ('factorySystem'), **`steel: 'bessemer'`** ('bessemerSteel'), `combustion: 'combustionEngine'`, **`last: 'electricPower'`**.
- Their F0 rows that duplicate mine are dropped: electric power, the combustion engine, radio, mass production (assemblyLine) and
  fertiliser if they have them.
- They use my Bass intensity as `S_p,i` (`ideaIntensity`, 0.2) and my `conceiveMul` (0.3) as `chanceTT`.
- Catalogue size limit: `IdeaAdoptions.idea` is `Uint8Array` [V assemble.ts:16], so there can be at most 255 ideas in total. Mine: 107.
  With ideologies (~25?) and future-tech, the total gets close. Future-tech must widen it to `Uint16Array` (a contract change, 1 line plus the UI
  reader) if the total exceeds 240.

### 0.5 For modern-ideologies-regimes.md (its file did not exist when I finished; amend there)
- They append their ideas **after mine** (ids ≥ 107 when techTree is on). Their ideas may name my keys in `pre`. Mine never name theirs, so my
  tree builds alone. Since `PRE` throws on an unknown key [V state.ts:20], their ideas that need mine must be **filtered out of the catalogue
  when techTree is off**. Alternative: they gate on `ideaIndex(key) >= 0 && ideaHeld(...)` in `cond`.
- Keys to hang ideologies on (all mine):
  - print capitalism (Anderson 1983): `printing` (v1) → `newspaper` (era 5) → `massSchooling` (era 7)
  - Reformation: `printing`
  - learned elites: `university` (era 3)
  - natural philosophy and the Enlightenment: `science` (v1), `mechanics`, `statistics`
  - property and contract: `patent`, `jointStock`, `limitedLiability`
  - the fiscal-military state: `publicDebt`, `drill`
  - wage labour and the proletariat: `factory`; with `mechanisedSpinning` → Luddites (Vested resistance)
  - national market and mass mobilisation: `railway`, `telegraph`
  - the levée en masse: ideologies' `conscription`/`nationalism` should take `drill` as its pre
- Quantities they can read: `ideaLiteracy` (receptivity), `ideaIndustrial` (wage-labour share), `ideaOpenness` (tolerance climate), and
  `newspaper`/`telegraph` intensities (speed of a movement's spread; riots 4.8 β_k could be multiplied by `1 + 0.5·intensity(newspaper)`).
- They should use the same pressure channels (Open, Shock, Frag) for their conception rates via `press`. Bans (IdeaBanned 300) and refusals
  (IdeaResist Ban 4) apply to their ideas too: a censor bans a pamphlet as readily as a press.

### 0.6 For infrastructure.md (networks are theirs; this plan only unlocks and scales; its file did not exist when I finished)
`InfraKey` strings are theirs to fix; proposed mapping:
| infra network | unlocking idea keys (any one unlocks; best intensity counts) | multipliers given by later ideas |
|---|---|---|
| paved road / highway | `roads` (v1), `courier` | `macadam` (cost 0.7, speed 1.5), `combustionEngine` (highway: speed 2.5) |
| canal | `poundLock` (era 3, river canals), `canals` (era 5, summit canals) | `steamEngine` (dredging: cost 0.8) |
| railway | `railway` | `bessemer` (steel rail: cost 0.7, speed 1.4), `telegraph` (signalling: speed 1.2) |
| port / harbour works | `keel` (v1, quays) | `steamship` (coaling ports), `ironclad` (dry docks) |
| telecom | `semaphore` (optical), `telegraph` (wire), `radio` (wireless) | each later one ×speed |
| submarine cable | `telegraph` + `ironclad` (cable ships; real 1858/1866) | |
| water and sewerage | `aqueduct` (era 2), `qanat` (era 2, dry lands) | `sanitation` (sewers: unlocks sewerage), `germTheory` (filtration) |
| power grid | `electricPower` | |
| pipeline | `combustionEngine` (oil, 1859–) | |
| airports, containers | none here (future-tech) | |
They read `ideaUnlock` / `ideaInfraMul` (0.2). No network logic lives in ideas.

### 0.7 For city-renderer-eras.md (file absent when I finished; per-era rendering needs; the renderer reads `eraAt(h, p, year)` and per-key `heldBy`)
| era | townscape markers (idea that triggers it) |
|---|---|
| 5 age of science and sail | bastioned star-fort trace (`starFort`, from era 4); observatory dome (`telescope`); printing houses and broadsheet stalls (`newspaper`); exchange/bourse hall (`jointStock`); polders with windmill rows (`drainage` + `windmill`); full-rigged three-masters and ships of the line in port (`carrack`, `broadside`); summit canals with locks (`canals`); pithead winding gear and engine house (`atmosphericEngine` + coal) |
| 6 first industrial age | multi-storey mills on rivers (`mechanisedSpinning`, water power); brick chimneys and smoke plumes, scaled by `ideaIndustrial` (`factory`, `steamEngine`); blast-furnace glow (`cokeSmelting`, `puddling`); rows of terraced workers' housing (`factory` + urban crowding); railway lines, stations, viaducts (`railway`); paddle and screw steamers with funnels (`steamship`); telegraph poles along roads and rails, semaphore towers on hills (`telegraph`, `semaphore`); macadam roads (`macadam`) |
| 7 age of steel and electricity | steel truss bridges, iron-and-glass halls (`bessemer`); street lights at night and tram wires (`electricPower`); wide boulevards (`sanitation`, Haussmann); ironclad warships (`ironclad`); schoolhouses in every town (`massSchooling`); radio masts (`radio`); oil derricks and storage tanks (`combustionEngine`); refrigerated warehouses at ports (`refrigeration`) |
| any | coal smoke darkens the city and sky tint by `ideaIndustrial` (it scales with intensity, so the change is gradual); timber famine (306) gives a bare-hill palette around the town |

---

## 1. Current behaviour [V]

### 1.1 The ideas system (`src/sim/history/ideas/`)
- **Catalogue** `params.ts` `IDEA_DEFS` (45 ideas, eras 0–4): key, name, kind, pre, technique (4 mirror species techniques: terrace,
  heavyPlough, rotation, breeding; `chance 0`), era, weight, chance, `cond(ctx,p)`, teach, use, fragile, resist flags (R_FAITH 1, R_RULER 2,
  R_GUILD 4), theft, caps [F,S,M,C], levers (farm, land, seaCost, range, war, defence, admin, toll, craft, learn, quarantine), effect, history.
  The header puts the sim's clock at "first villages (0) to about the industrial threshold (2000)" [V params.ts:5].
- **Conception** (system.ts:489–500): only when no living holder has been met. Chance =
  `conceive·chance/100·step·cond·(1+mix·min(mixMax,met))/(1+cardwell·recent)·(1+combo·nHeld)·scale·ideaMul`, with
  `scale = clamp(pop/popRef, 0.2, 2.5)` (linear, `scaleLinear: true`). One `rng.next()` per candidate with cond > 0. The site is the best
  settlement of a site flag (SITE_OF).
- **Learning** (system.ts:430–488): progress `+= Σ_h ((RSUM+theft)·dt + PSUM)·BACK[h]·learn/teach`. BACK is backwardness
  (`1 + 8·(x−1)`). At progress ≥ 1, adoption chance `adopt·use·(1−r)`, one draw, then a second draw for the channel. Resistance
  `r = 1−Π(1−r_k)` over faith (zeal), ruler (1−tol, war/piety), guild (renowned traditions). A draw refused only by resistance
  logs IdeaResisted once.
- **Loss** (system.ts:505–535): `fragile·…·(small + collapse)/(1 + support/supportHalf)`, small = `1 − ss(200, 3000, pop)`, collapse when
  pop < 0.4·peak. Dependants are lost in one forward pass (this needs prerequisites earlier in id order).
- **Effects** (hooks.ts:64–122 `recompute`): caps per field = `1 + capBase + Σ caps·m·capMul·capEra[era] + general·sqrt(score)`. Levers are
  `1 + lever·Σ share·m`. `m = useFloor + (1−useFloor)·useMax`. Irrigation is the only `farm` lever (dry river cells).
- **Technology coupling** (hooks.ts:126–141, technology.ts:221): below the cap a level closes `catchUp·dt·(C−L)` = 25% of the gap per
  5-year step, **bypassing TECH's quartic brake**. So the caps, not practice, set the level. Above the cap growth is damped by `(d/soft)^2`.
- **Lever readers**: trade.ts:331/368/568, goods/longhaul.ts:58/164 (land, sea), voyages.ts:262 and exploration.ts:339 (range),
  polity/state.ts:605 qualityOf (war), :629 localOf (defence), :638 reachOf (admin), disease/system.ts:138/486 (toll), :665 (quarantine),
  goods/market.ts:659 (craft), population.ts:112 (farm).
- **RNG**: everything on `'history-ideas'` (state.ts:131), in fixed people × idea order.
- **Orders**: OrderKind.Idea multiplies conception and learning of one target idea (`ideaMul`) [V orders/hooks.ts:92–98].
- **Sizes**: `held/since/prog/...` are P·I. `rate/pulse/gw*` are P²·CH. `acc` is P·I·CH. `since` is Int16 (fine to 32767). `idea` ids in
  IdeaAdoptions are Uint8.

### 1.2 Related systems
- technology.ts: four fields. Farming is the land-yield multiplier (`productivityOf`, state.ts:191); Metalworking feeds ore output;
  Crafts feeds transport and goods.
- techniques.ts: species techniques by trigger (the Boserup-like crowd trigger for terraces: `x/expected ≥ crowd`, techniques.ts:44).
- Terrain has `timber` (uncleared cell), `ore`, `salt` per cell (terrain.ts:74–160; ore from the `'history-ore'` simplex). It has **no
  coal**. `s.landUse[cell]` is the cultivated fraction (state.ts:115), so standing timber = `timber·(1 − landUse)`.
- Landmarks: `Library` needs writing (×2 with paper, ×4 with printing) [V landmarks/params.ts:96–100].
- Rulers: `rTol, rWar, rPiety, rAbility` [V rulers/state.ts:31–34]. Religion: `zeal[f]`.

### 1.3 Baseline measurements [M] (default options, `probe/probe-tech.ts`; seeds 1, 7, 42, 1234)
| seed | peoples | run ms (2000 y, 4 parallel on 2 cores) | conceptions | adoptions | **losses** | last first-conception | ideas held min/med/max at 2000 | mean tech med / max at 2000 (leader gap) |
|---|---|---|---|---|---|---|---|---|
| 1 | 6 | 27 544 | 50 | 97 | 0 | 1990 | 8 / 32 / 33 | 3.54 / 3.60 (+1.7%) |
| 7 | 10 | 28 691 | 48 | 290 | 0 | 1885 | 29 / 35 / 37 | 3.70 / 4.12 (+11%) |
| 42 | 10 | 28 545 | 54 | 311 | 0 | 1995 | 31 / 37 / 42 | 4.01 / 4.25 (+6%) |
| 1234 | 10 | 30 125 | 44 | 298 | 0 | 1870 | 28 / 36 / 37 | 4.18 / 4.46 (+6.7%) |

**6000-year runs** (seeds 42, 7): `ideasYear` costs **945 ms of 51 s** and **1 038 ms of 72 s** (1.4–1.9%). The tree is exhausted by
year ~2000–2500: the last first-conceptions are quarantine 3180 (seed 42) and heavyPlough 2500 (seed 7). Median ideas held go
37→42→43→44 at 2000/3000/4000/6000. Mean tech goes 4.0→4.6→4.8→5.05 (med) and 4.25→4.86→5.05→5.25 (max). **That is 4 000 years of
near-stagnation, and the leader gap shrinks to ~4%. The world never diverges.** Not one idea was lost in any of the 6 runs, so the Tasmania
mechanism is dormant at these population sizes. The 2000-year prefix equals the 6000-year run [M] (seed 7 first-years identical), as the
runner promises.

First-conception year per idea (−1 = never) — the **baseline the pressure model must reproduce at neutral pressures** (section 6.1):
```
key            s1    s7   s42 s1234 | key            s1    s7   s42 s1234 | key            s1    s7   s42 s1234
pottery       710   480   580   505 | alphabet     1435  1675  1440  1535 | rudder       1780  1440  1320  1150
sail          350   565   600   840 | glass        1460  1345  1520  1420 | compass      1890  1655  1310  1480
ard          1375   745   370  1285 | lawCode      1515  1675  1510  1435 | spinningWh.  1905  1520  1405  1520
loom         1100  1260  1160   560 | roads        1440  1325  1330  1400 | cartography  1850  1795  1685  1795
irrigation    900   845   990   895 | fortific.    1660  1310  1575  1575 | clock          -1  1825  1880  1870
calendar      820  1075  1215   920 | mathematics  1845  1650  1515  1700 | quarantine   1785  1735    -1    -1
bronze       1150  1105  1445   955 | stirrup        -1    -1  1545    -1 | banking        -1  1685  1730  1775
wheel        1540  1250   810  1230 | paper        1840  1635  1445  1555 | gunpowder    1665  1835  1555  1775
riding         -1  1390  1225    -1 | terrace        -1    -1  1640    -1 | printing       -1  1825  1615  1775
potterWheel  1050  1065  1250  1395 | castIron     1830  1520  1715  1505 | navigation   1990  1885  1845  1755
iron         1475  1440   915  1310 | windmill     1835  1595  1260  1645 | rotation     1740  1360  1020    -1
writing      1310  1545  1260  1380 | heavyPlough    -1    -1  1240  1480 | breeding     1800  1480  1380  1540
keel         1310  1230  1255  1030 | lateen       1600  1395  1515  1385 | drainage     1885  1745  1745  1695
coinage      1490  1515  1515  1270 | chariot        -1  1835  1470    -1 | inoculation  1860  1640  1745  1605
watermill    1595  1305  1195  1560 | collar         -1  1635  1315    -1 | science        -1    -1  1995  1825
```
Independent origins are rare (1 for most ideas; pottery 1–4, sail 2–3).

---

## 2. The expanded tree (`techTree`)

### 2.1 Pacing decision and what happens after the tree is exhausted
- **Stop at era 7** (c. 1850–1914), and hand era 8+ to future-tech.md (0.4).
- **Mapping of the clock.** Eras 0–4 compress ~10 000 real years into ~2 000 sim years (5:1) [M, table above]. Era 4 is already near 1:1:
  real 1300–1750 maps to sim ~1550–2000. I keep **≈1:1 to 1.5:1** for eras 5–7 (real 1550–1914, 365 years), giving targets for the
  **leading** people at neutral pressures [A]: era 5 first conceptions sim ~1900–2300, era 6 ~2200–2650, era 7 ~2450–2950. Laggards finish
  through adoption ~150–500 years later.
- **Why not faster.** A 2000-year default run would then be industrial on most seeds. The existing calibration of caps to the PRODUCTIVITY
  reference curve and the realism scorecard (urbanisation, Zipf at 2000) would all move. The divergence should be visible in runs of
  2500–3500 years.
- **Why not slower.** At 6000 years, 3 000+ years would be left with nothing to do. That is the stagnation measured above.
- **Default run length (owner decision, 9):** 2000 years shows the eve of the divergence (era 5 on leading seeds). Suggest 3000 as a
  "modern" preset.
- **After exhaustion, with future-tech off:**
  - Caps stop rising. Levels converge to the caps; laggards close in by learning (Comin & Hobijn 2010: an average lag of 45 years after invention, newer technologies adopted faster [R]).
  - The world plateaus at "1914 technology". Collapse and Dwindled losses (4.9) and bans (4.5) still give local reversals.
  - `ideasYear` keeps its cost (~2% of a run).
  - A one-line note in the Ideas panel, "every idea of this catalogue is known", is shown once all era-7 ideas have a first year. It is
    not an event.
- **With future-tech on**, its era 8 ideas take over the same machinery.

### 2.2 Ordering and ids
New ideas are **appended** (ids 45–106) so that existing ids, saved URLs (`idea=<key>`) and Uint8 rows stay stable. Prerequisites of
appended ideas reference earlier ids only, which keeps the forward-pass loss rule [V system.ts:528] valid. Existing ideas' `pre` lists
**are not changed** (e.g. navigation does not gain `astrolabe`); the gap-fillers act as boosts and gates for later ideas instead.
`ix.defs` becomes per-run: `techTree ? IDEA_DEFS : IDEA_DEFS.slice(0, 45)`. `PRE`, `SITE`, `IDEA_INDEX` and `I_COUNT` are computed for both
at module load (`CAT[0|1]`).

### 2.3 New context fields and levers
**IdeaCtx additions** (all per people, recomputed every step in `context()`; RNG-free):
| field | definition |
|---|---|
| `coal` | population share in settlements whose catchment holds coal (`Terrain` coal field, 2.4), weighted like `ore` (ORE_FULL) |
| `wood` | standing timber per head over its value at founding: `Σ catch timber·(1−landUse) / pop`, normalised by the people's year-0 figure |
| `woodLoss` | `1 − min(1, wood/woodRef)`, smoothed (τ 50 y) |
| `wage` | `socWage` (society) else the proxy `clamp((expected/pop)^0.7·(1 + 0.15·ln(1 + wealth/pop)), 0.3, 3)` summed population-weighted [A] |
| `crowd` | `Σ pop / Σ expected` over its settlements (as techniques.ts:44 uses per settlement) |
| `warShare` | EMA (τ 30 y) of 1 if its main polity had an active war that year |
| `rival` | max relR of its main polity (relations.ts), + arms `M_p` when grudges `arms` is on |
| `states` | effective number of polities (1/HHI of polity populations) among the peoples it has met plus its own |
| `lit` | literacy (4.8) |
| `univ` | Library landmarks among its settlements (landmarks on, else 0) |
| `open` | openness (3.5) |
| `lanesOcean` | its long-haul legs that cross ocean (goods), for era-5 sea ideas |
| `cMetal`, `cCraft` | aliases of `metal`, `crafts` for era thresholds |
**New levers** (fields on IdeaDef; summed in `recompute` exactly like the old ones; "×lever" means times `IDEA.lever` = 0.2, as land and war are today):
| lever | combine | reader (file: site) | neutral |
|---|---|---|---|
| `yield` | `1 + Σ yield·m·a` (direct) | population.ts:112 via `ideaFarm`: fx.farm[id] multiplied for **every** settlement (irrigation stays dry-river only) | 1 |
| `fisc` | ×lever | state-finances `taxMul[p] ×= ideaFisc` (2.4.1); without finances, folded into `admin` at half weight | 1 |
| `credit` | `Π (1 − credit·a)`, ≥ 0.3 | state-finances `rateMul_p ×= ideaCredit` (2.4.4); without finances, unused | 1 |
| `lit` | literacy target add (direct), 4.8 | ideas internal, `ideaLiteracy` | 0 |
| `siege` | ×lever | battles.md site/siege modifier (3.3); proxy without battles: in polity war.ts conquest roll, the defender's `wallFactor − 1` is divided by `ideaSiege(attacker)` [A: call site where attacker is known] | 1 |
| `tollAll` | `Π (1 + tollAll·a)`, ≥ tollMin | disease/system.ts:138/486, every disease kind (toll stays crowd-only) | 1 |
| `famine` | `Π (1 + famine·a)`, ≥ 0.3 | population.ts famine deaths (the hunger toll; disasters 1.2 cites the site) [A exact line] | 1 |
| `fire`, `naval` | ×lever | battles.md ρ (fire effectiveness) and naval strength (3.10); proxy: folded into `war` | 1 |
| `army` | max over held | battles.md ArmyEra: 0 Levy, 1 Chariot, 2 Horse, 3 PikeShot, 4 Linear, 5 Rifle, 6 MachineAge (break points, casualty rate) | 0 |
| `unlock` | list of InfraKey | infrastructure.md (0.6) | none |
| `infraMul` | per InfraKey cost/speed | infrastructure.md | 1 |
`a` is the idea's intensity (4.7; 1 for eras ≤ 4). Literacy, openness and industrial index are state, not levers.

### 2.4 Coal (new derived terrain field; RNG stream `'history-coal'`)
`coal[i] = G.coal · area · low · smoothstep(0.58, 0.8, nz)`, where:
- `nz = 0.5 + 0.5·fbm(coalNoise, P…, {octaves 3, frequency 2.2})`, from `createSimplex3(createRng(world.seed, 'history-coal'))`
  (same pattern as ore, terrain.ts:110/159);
- `low = 1 − smoothstep(0.55, 0.8, relief-or-elevation share)` (coal measures are in sedimentary lowlands and hill margins, not high
  mountains);
- deserts count at half (×0.5);
- if World.tectonic exists (disasters plan), plate interiors count ×1.3.

It is computed lazily in `createIdeas` when techTree is on, so Terrain is untouched when off. Target [A]: 8–15% of land cells, in 5–12
basins per world, and on every seed some cradles near coal and some not (checked in the harness).

### 2.5 The catalogue v2 (62 ideas)
Columns: **pre**; **e** era; **ch** chance; **t** teach; **f/R/θ** fragile / resist (F faith, R ruler, G guild, V vested, B bannable) / theft;
**cond** (shorthand below); **caps** [F,S,M,C]; **levers**; **press** (non-default β); history note (style of params.ts).
Shorthand: `C(a,b)=ss(a,b,crafts)`, `M(),S(),F()` the other fields, `cit(a,b)=ss(a,b,cities)`, `twn(n)=towns(c,p,n)`, `pop(a,b)`,
`port(a,b)`, `tier(a,b)`, `lanes(a,b)`, `coal(a,b)`, `wood(a,b)=ss(a,b,woodLoss)`, `war(a,b)=ss(a,b,warShare)`, `lit(a,b)`, `ore(a,b)`,
`dry(a,b)`, `horse`, `fibre`, `draught`.
**Effects are wired** through 2.3 readers; caps go to technology.ts. Unless a press is given, KIND_BETA applies (3.2).

**Gap-fillers, eras 0–4 (19)**
| key (name) | kind | pre | e | ch | t | f/R/θ | cond | caps | levers | history |
|---|---|---|---|---|---|---|---|---|---|---|
| outrigger (the outrigger canoe) | Seafaring | sail | 0 | 1.5 | 20 | .3/–/0 | port(.02,.2)·pop(300,1500) | [0,.2,0,0] | range .1 | Austronesian outriggers carried settlers from Taiwan to Remote Oceania (c. 3000 BCE–1200 CE); never used in the Atlantic. |
| liftIrrigation (the shaduf and water-wheel) | Farming | irrigation | 1 | .6 | 20 | .2/–/0 | dry(.1,.4)·twn(1) | [.08,0,0,0] | yield .04 (dry land) | Shadufs in Akkad (c. 2300 BCE); the saqiya and noria by Hellenistic and Roman times. |
| compositeBow (the composite bow) | War | riding | 1 | .5 | 40 | .1/–/1 | horse·war(.05,.4) | [0,0,.03,.02] | war .06, army≥2 | Horn-wood-sinew bows of the steppe and Egypt's New Kingdom; the weapon of mounted archers for 3000 years. |
| qanat (the qanat) | Farming | irrigation | 2 | .4 | 60 | .3/–/0 | dry(.3,.7)·tier(0,1) | [.1,0,0,.02] | yield .06 (dry), unlock water | Persian underground channels (early 1st millennium BCE), carried to Oman, the Sahara, Spain and Chile. |
| aqueduct (aqueducts) | Transport | roads | 2 | .3 | 60 | .2/–/0 | cit(0,2)·tier(.5,1.5) | [0,0,0,.05] | tollAll −.05, unlock water | Assyrian Jerwan (c. 690 BCE), Rome's eleven aqueducts; cities of a million needed them. |
| crossbow (the crossbow) | War | bronze | 2 | .4 | 30 | .1/R/1 | M(1.5,1.9)·war(.1,.5) | [0,0,.04,0] | war .06 | Massed in Warring States China (5th–4th c. BCE); Europe's 11th-century crossbow was banned against Christians by the Lateran Council (1139). |
| siegeEngine (siege engines) | War | wheel, mathematics | 2 | .4 | 60 | .2/–/1 | tier(.5,1.5)·war(.1,.5) | [0,0,.04,.04] | siege .3 | Assyrian rams, Greek torsion catapults (c. 400 BCE), the counterweight trebuchet carried from China by the Mongols. |
| camelSaddle (the camel saddle) | Transport | riding | 2 | .5 | 15 | .1/–/0 | dry(.3,.7)·trade≥ | [0,0,0,.02] | land .1 (dry cells) | The North Arabian saddle (c. 500–100 BCE) made the camel a war and caravan beast; the Sahara trade grew from the 3rd c. CE. |
| courier (relay posts) | Administration | roads, writing | 2 | .4 | 40 | .2/–/0 | tier(1,2) | [0,0,0,.03] | admin .08, unlock road | Achaemenid angarium, Han and Inca relay runners, the Mongol yam with its 1,400 stations. |
| civilExam (examined officials) | Administration | writing, lawCode | 2 | .2 | 120 | .3/–/0 | tier(1,2)·cit(1,3) | [0,0,0,.04] | admin .12, fisc .1, lit .01 | Han recommendation, Sui–Tang examinations (605 CE), Song's mass exams; Europe copied the idea in the 19th c. (Northcote–Trevelyan, 1854). |
| university (universities and madrasas) | Knowledge | writing, mathematics | 3 | .3 | 80 | .2/F/0 | cit(1,4)·C(1.9,2.4) | [.02,.02,.02,.08] | learn .1, lit .02 | Al-Qarawiyyin (859), Nizamiyya madrasas (1060s), Bologna (1088), Paris and Oxford; Europe had 60+ universities by 1500. |
| astrolabe (the astrolabe) | Seafaring | mathematics | 3 | .3 | 60 | .1/–/0 | cit(0,2)·S(1.6,2.0) | [0,.15,0,.02] | range .05 | Hellenistic astronomers, perfected in Abbasid Baghdad; the mariner's astrolabe on Portuguese ships by the 1480s. |
| lenses (spectacles and lenses) | Crafts | glass | 3 | .3 | 40 | .1/–/0 | cit(0,2)·C(1.9,2.4) | [0,0,0,.06] | craft .03, learn .03 | Reading stones in Ibn al-Haytham's optics; spectacles in Pisa c. 1286 doubled the working life of scribes and craftsmen. |
| paperMoney (paper money) | Administration | paper, coinage | 3 | .2 | 30 | .2/R/0 | tier(1,2)·ss(400,2000,trade) | [0,0,0,.08] | land .04, fisc .08 | Sichuan jiaozi (c. 1024) became the state's; Yuan and Ming over-issue ruined it, and China went back to silver by 1450. |
| poundLock (the pound lock) | Transport | watermill | 3 | .25 | 40 | .1/–/0 | river(.1,.4)·tier(.5,1.5) | [0,0,0,.04] | land .05, unlock canal | Qiao Weiyue's lock on the Grand Canal (984); mitred gates by Leonardo's day in Milan. |
| insurance (marine insurance) | Administration | banking? no: coinage, mathematics | 3 | .25 | 40 | .1/F/0 | port(.05,.3)·ss(400,2000,trade) | [0,.04,0,.04] | seaCost .03, credit .05 | Genoese contracts of 1343, Florence and Barcelona's codes; Lloyd's coffee house in the 1680s. |
| doubleEntry (double-entry bookkeeping) | Administration | banking, mathematics | 4 | .3 | 50 | .1/–/0 | cit(1,3)·lanes(1,4) | [0,0,0,.1] | credit .1, fisc .05 | Genoese ledgers of 1340, Pacioli's Summa (1494); Venetian method spread with printing. |
| cannon (cannon) | War | gunpowder, castIron | 4 | .4 | 40 | .1/R/1 | war(.1,.5)·M(2.1,2.6) | [0,.04,.15,.02] | siege .6, war .08, naval .1 | Cannon at Metz (1324); Ottoman guns broke Constantinople's walls in 1453 and French guns Italy's in 1494. |
| starFort (the bastion fort) | War | cannon, fortification | 4 | .4 | 50 | .1/–/0 | war(.15,.6)·cit(1,3) | [0,0,.04,.06] | defence .3 | The trace italienne (Sangallo, Michelangelo; after 1494) restored the defence; Parker's military revolution starts here. |
| carrack (the full-rigged ship) | Seafaring | rudder, lateen | 4 | .3 | 40 | .1/–/0 | port(.05,.3)·S(2.2,2.7) | [0,.5,0,.02] | range .15, seaCost .06 | Carracks and caravels mixed square and lateen sails (15th c.); da Gama's and Zheng He's fleets show both traditions. |
| musket (the arquebus and pike) | War | gunpowder | 4 | .4 | 40 | .1/R/1 | war(.2,.6)·M(2.2,2.7) | [0,0,.1,.02] | war .12, fire .3, army≥3 | Matchlocks at Cerignola (1503); Japan's Nagashino (1575) volleys; Tokugawa later restricted guns (Perrin's account, now disputed). |
(Correct `insurance.pre` to `[coinage, mathematics]`; there is no `banking` dependency, but in sim time it comes after it.)

**Era 5 — the age of science and sail (real c. 1550–1760; 17)**
| key | kind | pre | ch | t | f/R/θ | cond | caps | levers | press | history |
|---|---|---|---|---|---|---|---|---|---|---|
| telescope | Knowledge | lenses, science? no: lenses, mathematics | .3 | 30 | .1/F/0 | cit(1,4)·C(2.6,3.2) | [0,.1,0,.06] | learn .05, range .03 | Open .8 | Lippershey (1608), Galileo's moons (1610); Kepler's optics. |
| newspaper | Communication | printing | .3 | 15 | .1/FRB/0 | cit(1,4)·lit(.05,.2) | [0,0,0,.08] | learn .08, lit .05, land .02 | Open 1, Market .5 | Strasbourg's Relation (1605), Amsterdam corantos, London dailies (1702); censors licensed and taxed them. |
| mechanics (natural philosophy) | Knowledge | science, telescope | .2 | 120 | .2/F/0 | cit(2,6)·lit(.1,.3)·univ≥1 | [.04,.1,.15,.2] | learn .15 | Open 1.5, Frag .5 | Galileo, Huygens and Newton's Principia (1687); Mokyr's Republic of Letters spread it by post and print. |
| statistics (political arithmetic) | Administration | printing, mathematics | .25 | 50 | .1/–/0 | tier(1,2)·cit(1,4) | [0,0,0,.04] | admin .06, fisc .08 | War .3 | Graunt's bills of mortality (1662), Petty, Vauban's census; Sweden's Tabellverket (1749). |
| patent (patents for inventions) | Administration | printing, lawCode | .2 | 40 | .1/RG/0 | cit(1,4)·Open | [0,0,0,.04] | (raises Open, cuts Vested 3.6) | Open 1 | Venice's statute (1474), England's Statute of Monopolies (1624), the US Constitution (1787). |
| jointStock (the joint-stock company) | Administration | doubleEntry, banking | .25 | 40 | .1/R/0 | lanesOcean(1,4)·cit(1,4) | [0,.08,0,.1] | credit .1, seaCost .04, range .04 | Market 1 | The Muscovy Company (1555), the English and Dutch East India Companies (1600, 1602); the VOC's shares traded in Amsterdam. |
| publicDebt (the funded public debt) | Administration | doubleEntry, statistics | .2 | 60 | .2/–/0 | tier(1,2)·war(.2,.6) | [0,0,0,.02] | credit .25, fisc .1 | War 1, Frag .5 | Genoa's Casa di San Giorgio, Dutch provincial bonds, the Bank of England (1694); North–Weingast's credible commitment (contested). |
| postalService (public posts) | Communication | courier, paper | .3 | 30 | .1/–/0 | tier(1,2)·lit(.05,.2) | [0,0,0,.03] | land .03, learn .05, admin .04 | | The Taxis post (1490s), Royal Mail opened to the public (1635); the Republic of Letters ran on it. |
| drill (drill and standing armies) | War | musket, statistics? no: musket, lawCode | .25 | 60 | .1/R/0 | war(.3,.7)·tier(1,2) | [0,0,.04,0] | war .1, fire .3, army≥4 | War 1.5, Rival 1 | Maurice of Nassau's countermarch (1590s), Gustavus Adolphus; Roberts' and Parker's military revolution. |
| flintlock (flintlock and bayonet) | War | drill, castIron | .3 | 30 | .1/R/1 | war(.2,.6)·M(2.6,3.2) | [0,0,.1,0] | fire .3, war .08 | War 1.5 | Socket bayonet (1680s) and flintlock ended the pike by 1700; China's Qing armies lagged after a long peace (Andrade). |
| broadside (the ship of the line) | Seafaring | carrack, cannon | .25 | 60 | .1/–/1 | port(.05,.3)·war(.2,.6) | [0,.3,.05,0] | naval .4, range .05 | War 1.2, Rival 1 | Gunports (Mary Rose, 1510), line-of-battle tactics (1650s); Europe's navies vs Asia's coastal fleets. |
| chronometer (the marine chronometer) | Seafaring | clock, navigation | .2 | 60 | .1/–/0 | lanesOcean(1,4)·C(2.8,3.4) | [0,.3,.04,.02] | range .1, seaCost .03 | Market .5 | Harrison's H4 (1761) solved longitude; chronometers were common in navies by 1820. |
| quinine (quinine) | Health | navigation | .25 | 20 | .1/–/0 | lanesOcean(1,3) (and a tropical holder: use = tropical share) | [0,0,0,.01] | tollAll −.08 (tropical), range .03 | | Jesuit's bark from Peru (1630s); isolated in 1820, it opened tropical Africa to Europeans after 1850. |
| newHusbandry (convertible husbandry) | Farming | rotation? (technique, mirrored) else drainage, breeding | .3 | 40 | .1/–/0 | F(2.4,3.0)·crowd(1,1.6) | [.35,0,0,0] | yield .08 | Land 1.2 | Clover, turnips and the Norfolk four-course; Flemish and English yields rose ~40% 1600–1800 (Allen). |
| atmosphericEngine (the atmospheric engine) | Industry | castIron, mechanics | .2 | 60 | .1/–/1 | coal(.05,.3)·M(2.8,3.4)·wood(.2,.6) | [0,0,.2,.1] | (unlocks deep coal: coal access ×2) | Energy 1, Labour .5 | Newcomen's engine (1712) pumped coal mines; it ran on unsaleable slack coal, cheap only at the pithead. |
| cokeSmelting (coke smelting) | Industry | castIron | .2 | 60 | .1/–/1 | coal(.05,.3)·wood(.3,.7)·M(2.8,3.4) | [0,0,.5,.05] | war .03 | Energy 1.5 | Abraham Darby at Coalbrookdale (1709); Song China had used coal in furnaces in the 11th c. as its forests ran short (Hartwell). |
| canals (summit canals) | Transport | poundLock, mathematics | .2 | 40 | .1/V/0 | tier(1,2)·ss(800,3000,trade)·river≥ | [0,0,0,.08] | land .1, unlock canal | Market 1 | Canal du Midi (1681), the Bridgewater Canal (1761) halved Manchester's coal price; England's canal mania followed. |
(Fix `pre` entries marked "no:" to the second list. For `newHusbandry`, `pre: ['drainage', 'breeding']`, and it is boosted ×1.5 when `rotation` is held.)

**Era 6 — the first industrial age (real c. 1760–1850; 12)**
| key | kind | pre | ch | t | f/R/θ | cond | caps | levers | press | history |
|---|---|---|---|---|---|---|---|---|---|---|
| mechanisedSpinning (the spinning mill) | Industry | spinningWheel, watermill, clock | .25 | 30 | .1/V/1 | fibre·C(3.2,3.8)·cit(1,4) | [0,0,.04,.5] | craft .25 | Labour 1.5, Market 1 | Hargreaves' jenny (1764), Arkwright's water frame (1769), Crompton's mule; Luddites broke frames in 1811–16. |
| steamEngine (the steam engine) | Industry | atmosphericEngine | .2 | 60 | .1/–/1 | coal(.05,.3)·M(3.2,3.9)·C(3.2,3.9) | [.05,.1,.4,.4] | craft .15 | Energy 1.5, Labour 1 | Watt's separate condenser (1769, patent to 1800); rotary engines drove mills after 1785. |
| factory (the factory system) | Industry | mechanisedSpinning | .25 | 40 | .1/GV/0 | cit(2,6)·C(3.4,4) | [0,0,.05,.4] | craft .2 | Labour 1, Market 1 | Cromford (1771); by 1850 most British cotton workers were in mills: wage labour and the time-discipline of the bell. |
| puddling (puddled wrought iron) | Industry | cokeSmelting | .25 | 40 | .1/–/1 | coal(.05,.3)·M(3.2,3.9) | [.03,.03,.5,.05] | war .03 | Energy 1 | Cort's puddling and rolling (1784) made bar iron from coke pig; British output rose tenfold 1788–1830. |
| machineTools (machine tools) | Industry | steamEngine, clock | .2 | 60 | .1/–/1 | C(3.6,4.3)·M(3.6,4.3) | [0,0,.3,.3] | craft .1, fire .1 | Labour 1 | Wilkinson's boring mill (1774), Maudslay's lathe, the "American system" of interchangeable parts (Springfield, 1840s). |
| railway (the railway) | Transport | steamEngine, puddling | .2 | 40 | .1/V/0 | coal(.02,.2)·M(3.6,4.3)·ss(2000,8000,trade) | [.05,0,.1,.2] | land .5, famine −.3, admin .08, unlock rail | Market 1.5, Labour .5 | Stockton–Darlington (1825), Liverpool–Manchester (1830); Europe had 23,000 km of track by 1850 and grain moved overland at last. |
| steamship (the steamship) | Seafaring | steamEngine, carrack | .2 | 40 | .1/V/0 | port(.05,.3)·M(3.6,4.3) | [0,.6,.05,0] | seaCost .15, range .2, naval .2 | Market 1 | Fulton's Clermont (1807), the Sirius and Great Western across the Atlantic (1838); the screw and compound engine conquered the oceans after 1860. |
| telegraph (the electric telegraph) | Communication | chemistry, mathematics | .2 | 30 | .1/–/0 | cit(2,6)·C(3.6,4.3) | [0,.05,0,.15] | admin .15, learn .1, land .05, unlock telecom | Market 1, War .5 | Cooke–Wheatstone (1837), Morse (1844); the Atlantic cable of 1866 cut news from weeks to minutes. |
| semaphore (the optical telegraph) | Communication | telescope, postalService | .3 | 20 | .1/–/0 | tier(1,2)·war(.3,.7) | [0,0,0,.03] | admin .06, unlock telecom | War 1.5 | Chappe's towers (1794) for the French Republic at war; obsolete within 50 years (a leapfrog target, 4.10). |
| vaccination (vaccination) | Health | inoculation, printing | .3 | 20 | .1/F/0 | lit(.1,.3)·crowd | [0,0,0,.02] | toll −.3, tollAll −.05 | Open .8 | Jenner's cowpox (1796) reached Spain's colonies by the Balmis expedition (1803–06); smallpox deaths fell fast where it was compulsory. |
| chemistry (chemistry) | Knowledge | mechanics, glass | .2 | 80 | .1/–/0 | univ≥1·cit(2,6)·lit(.15,.4) | [.08,0,.15,.2] | learn .1, craft .05 | Open 1.5 | Lavoisier's Traité (1789), Dalton's atoms (1808), Liebig's teaching lab at Giessen (1820s). |
| macadam (turnpikes and macadam) | Transport | roads, statistics | .3 | 30 | .1/V/0 | ss(1500,6000,trade)·tier(1,2) | [0,0,0,.04] | land .15, infraMul road | Market 1 | Turnpike trusts (from 1706), McAdam's broken-stone roads (1820s); coach times London–Edinburgh fell from 10 days to 2. |

**Era 7 — the age of steel and electricity (real c. 1850–1914; 14)**
| key | kind | pre | ch | t | f/R/θ | cond | caps | levers | press | history |
|---|---|---|---|---|---|---|---|---|---|---|
| bessemer (cheap steel) | Industry | puddling, chemistry | .2 | 50 | .1/–/1 | coal(.02,.2)·ore(.05,.4)·M(4.2,5) | [.05,.05,.6,.1] | war .05, infraMul rail | Energy 1 | Bessemer (1856), Siemens–Martin (1865), Gilchrist–Thomas (1878) for phosphoric ores; steel prices fell ~80% by 1900. |
| rifledArms (breech-loading rifles) | War | machineTools, flintlock | .25 | 30 | .1/R/1 | war(.2,.6)·M(4,4.8) | [0,0,.1,0] | fire .5, war .1, army≥5 | War 1.5, Rival 1 | Minié ball (1849), Dreyse needle gun at Königgrätz (1866); the rifle made the frontal charge a massacre. |
| machineGun (the machine gun) | War | rifledArms, bessemer | .2 | 30 | .1/R/1 | war(.2,.6)·M(4.4,5.2) | [0,0,.1,0] | fire .6, army≥6 | War 1.5 | Gatling (1862), Maxim (1884); colonial wars, then the Western Front. |
| ironclad (the ironclad warship) | Seafaring | steamship, puddling | .2 | 40 | .1/–/1 | port(.05,.3)·war(.2,.6) | [0,.3,.1,0] | naval .6 | War 1.2, Rival 1.5 | La Gloire (1859), Monitor and Virginia (1862); the Dreadnought (1906) set off an arms race. |
| germTheory (germ theory) | Health | chemistry, lenses | .2 | 60 | .1/F/0 | univ≥1·lit(.3,.6) | [0,0,0,.04] | tollAll −.25, toll −.15 | Open 1.2 | Snow's Broad Street pump (1854), Pasteur, Koch's bacillus (1882); antisepsis (Lister, 1867). |
| sanitation (sewers and clean water) | Health | germTheory? no: aqueduct, statistics | .25 | 40 | .1/–/0 | cit(3,8)·crowd(1,1.6)·tier(1,2) | [0,0,0,.05] | tollAll −.2, unlock water | Land .5 | Chadwick's report (1842), Bazalgette's London sewers (1858–75) after the Great Stink; city death rates fell below rural ones by 1900. |
| fertiliser (chemical fertiliser) | Farming | chemistry, newHusbandry | .2 | 40 | .1/–/0 | F(4,5)·crowd(1.1,1.8) | [.6,0,0,0] | yield .15 | Land 1.5 | Lawes' superphosphate (1842), Chilean nitrate and guano; Haber–Bosch (1909–13) later fed half of humanity. |
| refrigeration (refrigeration) | Farming | steamship, chemistry | .2 | 30 | .1/–/0 | port(.05,.3)·ss(3000,10000,trade) | [.1,.05,0,.05] | famine −.15, yield .03 | Market 1 | The Frigorifique (1877), frozen mutton from New Zealand (1882); meat crossed the world. |
| electricPower (electric power) | Industry | telegraph, steamEngine | .2 | 50 | .1/V/0 | cit(3,8)·C(4.4,5.2) | [.05,0,.2,.6] | craft .2, unlock grid | Energy 1, Labour 1 | Faraday's dynamo (1831), Edison's Pearl Street (1882), AC grids (1890s); electric motors reorganised factories by 1920. |
| combustionEngine (the internal combustion engine) | Industry | machineTools, chemistry | .2 | 40 | .1/–/1 | M(4.4,5.2)·C(4.4,5.2) | [.1,.1,.2,.2] | land .2, unlock road+pipeline | Energy 1, Labour 1 | Otto (1876), Daimler and Benz (1885–86), Diesel (1897); oil from Titusville (1859) and Baku. |
| radio (wireless) | Communication | electricPower | .2 | 30 | .1/R/0 | C(4.6,5.4)·lit(.4,.7) | [0,.1,0,.1] | learn .05, admin .05, unlock telecom | Open .5, War .5 | Hertz (1887), Marconi across the Atlantic (1901); navies first, then broadcasting (1920). |
| massSchooling (compulsory schooling) | Knowledge | printing, statistics | .25 | 60 | .2/F/0 | tier(1,2)·lit(.2,.5)·Open | [0,0,0,.1] | lit .5, learn .1 | War .8 (Prussia after Jena), Shock 1 | Prussia's general school law (1763, enforced after 1806), France's Ferry laws (1881–82), Britain 1870/1880; literacy above 90% in NW Europe by 1900. |
| limitedLiability (limited liability) | Administration | jointStock, lawCode | .3 | 30 | .1/–/0 | cit(2,6)·ss(2000,8000,trade) | [0,0,0,.1] | credit .15 | Market 1 | France's société anonyme, Britain's Acts of 1855–62; incorporation became a right, not a privilege. |
| assemblyLine (mass production) | Industry | electricPower, machineTools | .15 | 40 | .1/V/0 | cit(4,10)·C(5,5.8) | [0,0,.2,.6] | craft .3 | Labour 1.5, Market 1.5 | Colt's and Singer's interchangeable parts, Chicago's disassembly lines, Ford's Highland Park (1913). |
(Fix: `sanitation.pre = ['aqueduct', 'statistics']`; germTheory boosts its conception ×2 when held, the miasma theory having driven
the first sewers.)

**INDUSTRIAL_CORE** (4.11): `cokeSmelting, steamEngine, mechanisedSpinning, factory, railway`.
**Era cap weights** (params `capEra`, `eraWeight` extended by three entries): `capEra: [2, 1.4, 0.6, 0.75, 1.5, 1.2, 1.4, 1.4]`,
`eraWeight: [3.2, 1, 0.6, 0.8, 1, 0.8, 0.8, 0.8]` [A]. Calibrate in step 4 so that holding every era-≤7 idea gives caps ≈ [7.5, 7, 8, 9]
(about 1.8–2× the 2000 levels). Real NW-European farm yields roughly doubled 1750–1914, and output per worker in industry rose more
[unverified: a rough reading of the British series in Broadberry et al. 2015, not a quoted figure; treat as design default]. The **yield** lever adds at most ~+40% at full intensity. Guard: world population growth (section 6).
**ERA_LABELS** (ui/ideasData.ts:36) gains `'The age of science and sail', 'The first industrial age', 'The age of steel and electricity'`.

---

## 3. Innovation is not just chance + prerequisites (`innovation`)

### 3.1 The rule (baseline × pressures; one formula for every era)
For people q and idea i, with λ₀ today's conception chance [V system.ts:495] and A₀ today's learning add / adoption chance [V :450, :456]:
```
λ(q,i) = λ₀(q,i) · Mc(q,i)              Mc = clamp( exp( Σ_k βc[i,k] · (z[q,k] − ref_k) ), mLo, mHi )      mLo 0.2, mHi 5
add(q,i) = add₀ · Ma(q,i)^½             Ma = clamp( exp( Σ_k βa[i,k] · (z[q,k] − ref_k) ), aLo, aHi )      aLo 0.3, aHi 3
adopt(q,i) = adopt₀ · use · (1 − r') · Ma(q,i)^½          r': the generalised resistance (3.6)
```
- βc and βa come from the idea's `press`, else the kind default (3.2). Factor bias enters as `βc[Labour] += bias.labour·ηL`,
  `βc[Land] += bias.land·ηT`, `βc[Energy] −= bias.energy·ηE` (dear energy deters energy-using inventions).
- **Neutral reproduction.** `ref_k` is the mean z_k at conception events in a pure-logging calibration run (section 6.1). So
  E[log Mc] ≈ 0 over baseline conceptions, and the era-0–4 first-years stay statistically where they are (target in 6.1).
- **No new draws.** Conception keeps its single `rng.next()` against a different threshold, so draw *counts* are unchanged and the draw
  order is preserved. Outcomes differ, as intended.
- Orders `ideaMul` stays a separate factor.

### 3.2 Channels z[q,k] (pressureStep; RNG-free; every IDEA.step years after `context()`)
| k | z | sources | model |
|---|---|---|---|
| War | `warShare` (0..1) | polity wars | necessity: the military revolution (Roberts 1956; Parker 1988) [R]; Hoffman's tournament (Hoffman 2015): innovation where rulers fight often with similar tech and cheap mobilisation [R]; China's lag after the long Qing peace (Andrade 2016) [R]. Debated: Black (1991) doubts a single "revolution" [R?] |
| Rivalry | `rival` (+ grudges arms M) | relations, grudges.arms | arms races (grudges 3.11) |
| Labour | `ln(wage / wRef)` | society `socWage`/`socUrbanWage` or proxy | induced innovation (Hicks 1932; Habakkuk 1962; Hayami–Ruttan 1971) [R]; Allen's high wages (2009) [R?]: disputed by Humphries–Schneider (2019) on spinners' wages and Kelly–Mokyr–Ó Gráda (2014) on skills |
| Land | `ln(crowd / cRef)` | pop/expected | Boserup (1965): land-saving under pressure [R] (as the species terrace trigger already does) |
| Energy | `ln(pE / eRef)`, `pE = 1/(ε + woodAvail + κc·coalAccess)` | 2.3 `wood`, `coal`; κc ×2 with atmosphericEngine | Wrigley (2010) organic → mineral economy; Pomeranz (2000) coal and colonies [R]; Clark–Jacks (2007) find coal supply elastic and not causal [R?] |
| Market | `ln(1 + trade/pop / mRef)` | `ctx.trade` | Sokoloff (1988): patenting follows market access [R]; Acemoglu's market-size effect (2002) [R] |
| Open | openness O (3.5) | rulers, religion, literacy, landmarks, city-states | Mokyr (2002, 2016): Industrial Enlightenment, culture of growth [R]; Squicciarini–Voigtländer (2015): upper-tail knowledge [R] |
| Frag | `ln(states / sRef)` | polity | Jones (1981); Mokyr (2016) market for ideas; Scheidel (2019) [R]; Ko–Koyama–Sng (2018): fragmentation costs as well as helps [R?] |
| Shock | 1 for 50 y after defeat by a people with tech ≥ 1.3× | war outcomes | Gerschenkron (1962) backwardness; Meiji and Petrine programmes as his examples' kin [R] (adoption only) |
| Scale | `ln(Neff / nRef)` | 4.9 | Kremer (1993), Henrich (2004) [R]. **βc = 0 by default** because λ₀ already scales with pop; it is used for loss (4.9) |

**KIND_BETA** (conception) [A], rows by IdeaKind, columns War / Rival / Labour / Land / Energy / Market / Open / Frag:
```
Farming        0    0    0.3  1.0  0    0.3  0.3  0
Crafts         0    0    0.6  0    0    0.6  0.5  0.2
Transport      0.3  0    0.3  0    0    1.0  0.3  0
Seafaring      0.3  0.3  0    0    0    0.8  0.3  0.3
War            1.5  1.0  0    0    0    0    0    0.6
Administration 0.6  0    0    0.3  0    0.6  0.3  0.3
Knowledge      0    0    0    0    0    0.3  1.5  0.5
Health         0    0    0    0.5  0    0.3  0.8  0
Industry       0    0    1.0  0    1.0  1.0  0.6  0.3
Communication  0.5  0    0    0    0    0.8  0.8  0.3
```
**KIND_BETA_ADOPT**: half of the conception row, plus Shock 1.0 for every kind and Market 0.5 for all. Adoption speed responds to
profitability (Griliches 1957) [R]. Shock only raises adoption (catch-up), never conception.

Magnitudes: with βWar = 1.5 and warShare ∈ [0, 1] around ref ≈ 0.3, Mc ∈ [0.64, 2.9]. Labour β 1.0 over wages 0.6–1.8× ref gives
×0.6–×1.8. So a high-wage, cheap-coal, war-torn, open people conceives industrial ideas ~5× (the clamp) faster than a crowded,
wood-starved, pious, unified one.

### 3.3 Factor bias (Hicks; Allen; Hayami–Ruttan)
`bias` defaults: Industry `{labour 1, energy 1}`, Farming `{land 1}`, except: mechanisedSpinning/factory/assemblyLine labour 1.5;
newHusbandry/fertiliser/drainage land 1.5; steamEngine/cokeSmelting/puddling/bessemer energy 1.5.
- A **high-wage, coal-rich people** goes the labour-saving, energy-using way (the British route, Allen).
- A **crowded, low-wage one** gets land-saving farming (the Yangzi delta / Japanese labour-intensive route, Sugihara (2013) and Hayami–Ruttan (1971) [R]).
- **Without society**, the wage is the proxy from crowding and wealth, so the two routes still separate by Malthusian pressure.

### 3.4 Resources and scarcity (gates and multipliers)
- **Hard gates** (in `cond`/`use`): coal for atmosphericEngine, cokeSmelting, puddling, steamEngine, railway, bessemer; fibre for
  mechanisedSpinning; ports for sea ideas; ore for bessemer.
- `use` makes the idea useless where the resource is absent, but **coal may be imported**: a people with a lane or route to a coal holder
  gets `coalAccess = max(own, 0.5·partner coal·lane share)`.
- **Scarcity drives substitution.** `woodLoss` enters Energy, and cokeSmelting/atmosphericEngine have `wood(.2..)` in `cond`. Deforestation
  pushes a coal-bearing people to coal (England's 16th–17th century timber crisis, debated: Wrigley 2010 vs Clark & Jacks 2007; Song China's coal and iron, Hartwell 1962) [R?].
- **TimberFamine 306** fires when `woodLoss` crosses 0.6 (hysteresis 0.5).
- **Depletion of coal** is not modelled in v1 (the real reserves outlasted the era).

### 3.5 Openness O_q ("scope of thinking"), 0..1
```
O = clamp( 0.35 + 0.25·(tol − 0.5) − 0.25·zeal·[state faith] + 0.4·lit + 0.08·univ/(univ+2) + 0.1·div + 0.1·[city-state or republic]
           + 0.1·[patent held] − 0.15·[ban in force on any idea in q's polity], 0, 1 )
```
- `tol` is the tolerance of the ruler of its capital's polity (0.5 without rulers).
- `zeal` is its universal faith's zeal (0 without religion); `[state faith]` is 1 when the polity has one (religion).
- `div` is the number of distinct cradles and faiths among the peoples met, over 6 (contact diversity; the mixing idea follows Henrich 2004, the 1/6 scaling is a design default).
- `[city-state or republic]` is from city-states.md governments when built (else 0).
- Weights are [A]. `ref_Open` is from calibration.

### 3.6 Generalised refusal (Cardwell's law; vested interests; bans)
The existing `cardwell` param (recent conceptions damp a people's next) is a fatigue term, not Cardwell's law proper. Cardwell (1972) and
Mokyr (1994) [R] describe leaders becoming conservative as incumbents defend their rents. The name is kept for compatibility; the doc
comment is corrected. New resistance terms are added to `resistance()` [V system.ts:369], combined as `1 − Π(1 − r_k)`:
- **Vested** (flag V; IdeaResist 3): `r_V = vested · Σ_{j∈displaces(i)} intensity_j · age_j/(age_j + 150) · (1 − protect)`, where
  `vested` = 0.5 and `age_j` is the years j has been held. Displacement lists:
  - mechanisedSpinning ⟂ spinningWheel
  - factory ⟂ loom
  - railway ⟂ canals and macadam
  - steamship ⟂ carrack
  - telegraph ⟂ semaphore and postalService
  - electricPower ⟂ steamEngine
  - assemblyLine ⟂ factory
  - newspaper ⟂ (printing's guild, R_GUILD)
  - printing ⟂ writing (scribes), applied only when innovation is on
- **protect** = `0.5·[patent held]·intensity + 0.3·[city-state/republic]`. Protection of innovators follows Mokyr (2016) [R]; the weights are design defaults.
- **Ban** (IdeaResist 4): 4.5.

---

## 4. Rules (sim)

### 4.1 Step order (inside `ideasYear`, every IDEA.step years) [V system.ts:130–142]
`context → (new) contextV2 [coal, wood, wage, crowd, warShare, rival, states, lit, univ] → (new) pressureStep → channels → learnAndConceive
(pressures applied) → (new) intensityStep (Bass) → (new) bansStep → (new) driveStep → losses (Henrich) → recompute (new levers, literacy)`.
Yearly (cheap): `warShare` EMA update from polity war flags; event scan for defeats (Shock) reuses `scanEvents` (WarEnded rows).

### 4.2 Conception and learning under pressures
As 3.1. The site picker gets new flags: SITE_COAL for coal ideas (largest coal-catchment settlement) and SITE_UNIV for Knowledge ideas
(largest Library city). Ideas with id ≥ 45 draw from **`'history-ideas-v2'`** (`ix.rng2`), so with techTree on and innovation off, the
draws for v1 ideas come from the old stream in the old order. Note this gives only *early-segment* equality: once a v2 idea is held its
caps change the world. That is acceptable, and the tests say so.

### 4.3 Recording "why here, why now"
- At each conception, and at each adoption by Hired/Shock, store the per-channel log-multipliers `pressureWhy` (K floats) in
  `ix.whyRow[]` aligned with the adoption row. Rows of other kinds get no entry: `ix.whyOf[row] = -1`.
- Also store `cond` and `boost` (scale × recombination) as two more floats, so that the UI can say "a large and learned people".
- The History table is in 5.3.

### 4.4 Diffusion as S-curves inside a people (Bass 1969; Griliches 1957; Rogers 1962) [R]
- For held ideas with era ≥ `IDEA2.sFrom` (default **5**, so eras 0–4 keep intensity 1 and today's effects), intensity a ∈ [0,1].
- It starts at `a0 = 0.05` (conceived) or `0.1` (learned), then:
```
da/dt = (pB + qB·a)·(1 − a)·Ma(q,i)^½ · (1 + gB·max(0, xLead − 1))      pB 0.004/y, qB 0.06/y   [A: midpoint ~45–60 y; Comin–Hobijn 2010 lags]
```
- `xLead` is the leader's intensity over own (a late adopter copies a mature technology faster: **catch-up**, Gerschenkron), with
  `gB` = 0.5.
- Euler step of 5 years, clamped. A ban (4.5) sets the drift to `−banDecay·a`.
- IdeaTakeoff 303 is logged when a crosses 0.5.
- Effects of the idea are multiplied by `a` (2.3).
- `ideasStats` "share of peoples holding" stays binary; a new "mean intensity" curve is added.
- Option `IDEA2.sFrom = 0` puts every idea on S-curves. That changes era 0–4 effects and is **off by default**, owner decision (9).

### 4.5 Bans (unified empires can ban; fragmented worlds cannot) — stream `'history-innovation'`
- **Model:** the Ottoman case is read as a legitimacy bargain between rulers and religious authorities (Coşgel, Miceli & Rubin 2012;
  Rubin 2017) [R]. A ban is a ruler's choice that is cheap when the clergy's support matters and rivals cannot exploit the gap.
- **When:** a refusal that `resistance` attributes to Ruler or Faith (the existing IdeaResisted path, system.ts:481), in a polity of tier ≥ 1.
- **Chance:** `b = banK·r·(1 − tol)·U`, where `banK` = 0.5 and U = the polity's population share of the peoples q has met (an empire
  that is most of the known world bans effectively). One draw on `ix.rngInn`. If it hits, set `ban[pol·I + i] = year` and log
  IdeaBanned 300 (settlement capital, value i, extra cause).
- **Also** a ruler with tol < 0.25 may ban a **held** War or Seafaring idea after a long peace. Chance `0.02·(1 − warShare)·(1 − tol)` per
  step. This models the Tokugawa gun restriction (Perrin 1979, whose account is disputed by later historians [R?]) and the Ming sea ban
  (haijin; general history, [unverified]).
- **While banned**, for peoples whose capital lies in the polity: conception ×`banMul` (0.05), no adoption, held intensity decays
  (4.4), and Open −0.15.
- **Lift:** per step, chance `liftK·tol_now` (new ruler), with liftK = 0.3. It is 0.5 at once after a defeat by a holder (Shock), and the
  ban lapses if the polity ends. IdeaBanLifted 301, extra 0 ruler, 1 defeat, 2 polity ended.
- **Fragmentation follows by construction.** A ban only covers one polity's peoples. Holders outside it go on, and exposure still
  accrues (progress builds while adoption is blocked), so the idea floods in when the ban lifts. The Frag channel adds the competitive
  premium on top.

### 4.6 Flight of innovators (InnovatorsFled 302)
- **When:** a ban is placed on an idea that the people already **holds** (with a ≥ 0.3).
- **What:** a pulse `pulseFlight` = 12 years of strong link is given to the most open people (max O) among those q has met **outside the
  banning polity**, through IdeaHow.Migration (`addPulse`).
- Settlement: q's largest; other: the target's largest.
- No population moves; migration-system emigrants are a possible later addition. Historical parallels: Huguenots after 1685; the Iberian
  expulsions; Ottoman guncraft from European renegades.

### 4.7 Catch-up drives (CatchUpDrive 305; IdeaHow Hired 14)
- **Trigger:** a polity of tier ≥ 1 loses a war (WarEnded, loser) to a polity whose people's mean tech ≥ 1.3× its own.
- **Chance:** `driveK·(0.5 + 0.5·ability)·(0.3 + 0.7·tol)`, with driveK = 0.6, one draw on `rngInn`.
- **For `driveYears` (60):**
  - the Hired channel rate is `hire` = 1.0 from that people;
  - resistance ×0.4 and bans lifted;
  - Shock = 1 in Ma, and learning ×(1 + `driveLearn` 1.5).
- Logged at the capital, other = the model people's capital, value = the number of ideas it lacks.
- Historical examples (in the spirit of Gerschenkron 1962; the list itself is general history, [unverified]): Petrine Russia after Narva (1700), the Ottoman Nizam-ı Cedid, Qing Self-Strengthening after
  1860, Meiji after 1853.

### 4.8 Literacy (state `lit[p]`, `ideaLiteracy`)
```
L* = min(0.97, Σ_held lit_i·a_i·(0.5 + 0.5·cities/(cities+3)) )      dL/dt = (L* − L)/τL,  τL = 40 y (a generation of schooling)
```
- `lit` levers: writing .01, alphabet .02, paper .02, civilExam .01, university .02, printing .08 (added to v1's printing when
  innovation is on), newspaper .05, postalService .02, massSchooling .5.
- Hook for ideologies and religion: `+ litFaith[p]` (a Protestant-style scripture-reading faith; theirs) [A].
- Anchors [R]: about 12% of the world was literate around 1820; in England two-thirds of men and about half of women were literate
  by 1840, and nearly three-quarters of both by the late 19th century (Roser & Ortiz-Ospina, Our World in Data, "Literacy", citing
  Clark 2008). Northwest Europe's book output rose steeply after print (Buringh & van Zanden 2009). The sim targets below are design
  defaults set against these anchors. In sim terms: a printing people at ~0.1–0.15, newspaper+ at 0.3–0.5, massSchooling at ≥ 0.85 after 100 years.
- Literacy enters Open, the `lit()` conditions, and learning: `learn ×= 1 + 0.5·L`. Dittmar (2011) [R]: cities that adopted print early grew faster.

### 4.9 Losses made principled (Henrich 2004; Tasmania effect) [R?]
Henrich's model:
- An imitator learns from the best of N models.
- Skill change per generation is Δz = −α + β(ε + ln N).
- A skill of difficulty α/β is kept only if N > N* = exp(α/β − ε).
- Critics: Vaesen et al. (2016, PNAS) find no link between population size and toolkit complexity in ethnographic data; Henrich et
  al. replied (2016) [R?].

The rule:
- `N_eff(q) = pop_q + ψ·Σ_h (RSUM[q,h]/rMax)·pop_h`, with ψ 0.3 (the effective connected population).
- `N*_i = N0·exp(teach_i/τH)`, with N0 = 150 and τH = 60 (teach 15 → 193; teach 60 → 600; teach 150 → 1 800).
- Replace `small` in losses (system.ts:515) by
  `small_H = 1 − smoothstep(ln N*_i − 0.7, ln N*_i + 0.7, ln N_eff)`.
- `support` and `collapse` are unchanged; the loss is logged with IdeaLoss 3 Dwindled when small_H dominates.
- Scales are close to today's (lossLow 200, lossHigh 3000), so big peoples still never lose anything [M: 0 losses on 4 seeds]. A cut-off
  island band of ~400 now loses high-teach ideas (writing, navigation) and keeps pottery.
- Test: a synthetic isolated band loses writing within ~500 years with ≥ 80% probability, and a connected one never.

### 4.10 Leapfrogging
- An idea may list `skip: [key]` (telegraph skips semaphore; railway skips canals and macadam; steamship skips broadside; electricPower
  skips gasless lighting...).
- A people may **learn** (not conceive) an idea whose missing prerequisites are only skippable ones, if a holder it has met also holds
  them. The missing ones are then marked "skipped": they are held for prerequisite checks but not as effects.
- Logged as IdeaAdopted with `extra` how as usual. The panel shows "(skipped semaphore)".

### 4.11 Industrialisation (Industrialised 304)
- `X_q = mean_{j∈INDUSTRIAL_CORE} a_j`.
- When X_q first crosses 0.5, log Industrialised at the largest settlement, with value = era (6), extra = rank in the world
  (0 = first). When the era-7 core (bessemer, electricPower, assemblyLine) crosses 0.5, log value 7.
- `ideaIndustrial` returns X_q.
- The **great divergence** is read from these rows (section 6.2).

---

## 5. Contract additions (`src/contract.ts`), drafted in codebase style

### 5.1 Enums (append)
```ts
export const IdeaKind = { Farming: 0, Crafts: 1, Transport: 2, Seafaring: 3, War: 4, Administration: 5, Knowledge: 6, Health: 7, Industry: 8, Communication: 9 } as const
export const IdeaHow = { ..., Theft: 12, Lost: 13, Hired: 14 } as const   // Hired: experts brought in by a catch-up drive (CatchUpDrive)
export const IdeaLoss = { Isolated: 0, Collapse: 1, Prerequisite: 2, Dwindled: 3 } as const  // Dwindled: too few connected people to keep a skill this hard
export const IdeaResist = { Faith: 0, Ruler: 1, Guild: 2, Vested: 3, Ban: 4 } as const       // Vested: the holders of a technique it would displace; Ban: forbidden by its polity
/** Armies by their weapons (ideaArmy; battles.md): massed levies, chariots, horse archers and knights, pike and shot, drilled line, rifles and rail, machine guns. */
export const ArmyEra = { Levy: 0, Chariot: 1, Horse: 2, PikeShot: 3, Linear: 4, Rifle: 5, MachineAge: 6 } as const
```
**HOW arrays are hard-coded in ideasStats.ts:17 and the UI's HOW_SHORT/HOW_CSS**: add 'Hired'. `CH` = 15.

### 5.2 Events (block 300–309)
```ts
  IdeaBanned: 300, // the polity of `settlement` (its capital) forbade idea `value` (History.ideas) to its peoples; `other` -1; `extra` the cause (IdeaResist Faith or Ruler)
  IdeaBanLifted: 301, // the ban on idea `value` by the polity of `settlement` (its capital) ended; `other` -1; `extra` why (0 a new ruler, 1 a defeat by a people holding it, 2 the polity ended)
  InnovatorsFled: 302, // makers of idea `value`, banned at home (`settlement`, their people's largest), carried it to `other` (the largest settlement of the most open people met); `extra` -1
  IdeaTakeoff: 303, // idea `value` came into general use among the people of `settlement` (intensity passed one half); `other` -1; `extra` years since the people took it up
  Industrialised: 304, // the people of `settlement` (its largest) entered the industrial age: `value` the era (6 steam and mills, 7 steel and electricity), `extra` its rank in the world (0 the first); `other` -1
  CatchUpDrive: 305, // the polity of `settlement` (its capital), beaten by a more advanced one (`other`: that one's capital), set out to learn its ways; `value` the ideas it lacked; `extra` 0
  TimberFamine: 306, // the people of `settlement` (its largest) had cut most of its woods; `value` the share gone (percent); `extra` 1 when it has coal to turn to, else 0
```
`ideasOtherIsSettlement` (ui/ideasFormat.ts:16): 302 and 305 are settlements. Director registry weights (experience plan): 304 rank 0
weight 5, 305 weight 4, 300 weight 3, 302 weight 3, 303 weight 1, 306 weight 2.

### 5.3 History tables
```ts
/** Why each conception (and each drive-led adoption) happened where and when (HistoryOptions.innovation): per IdeaAdoptions row, the log-multiplier each
 *  innovation pressure gave (PressCh order; positive sped it), plus the preconditions' weight and the scale of the people. Rows without an entry have
 *  `row` absent. Empty when innovation is off. */
export interface IdeaPressures {
  count: number
  /** IdeaAdoptions row of each entry. */
  row: Int32Array
  /** K = channels; log-multipliers: why[e * K + k]. */
  K: number
  why: Float32Array
  /** Preconditions' weight (cond) and scale (recombination × population) at the time. */
  cond: Float32Array
  boost: Float32Array
}
/** Per snapshot and people (snapshotInterval): literacy and the industrial index, 0..255. Empty when innovation is off. */
literacy: Uint8Array; industrial: Uint8Array
/** Intensity rows: IdeaTakeoff is an event; the Bass curve is reproduced in the UI from (since, takeoff year) by the closed form. */
```
`IdeaInfo` gains `era`, `kind` (already present), `skip?: number[]`, `displaces?: number[]` (UI graph edges).

### 5.4 IdeasState additions (`ideas/state.ts`)
- `rng2` (`'history-ideas-v2'`) and `rngInn` (`'history-innovation'`);
- `press: InnovationPressure`;
- `inten: Float32Array(P·I)`;
- `lit: Float64Array(P)`, `woodRef: Float64Array(P)`, `warEma: Float64Array(P)`;
- `ban: Int16Array(polCap·I)` (−1 none; grows with polities);
- `drive: Int32Array(polCap)` (end year), `driveFrom: Int32Array(polCap)`;
- `skipped: Uint8Array(P·I)`;
- `whyRow`, `whyF` (number[]), `industrialRank`.

Params: `IDEA2` (sFrom, a0, pB, qB, gB, banK, banMul, banDecay, liftK, driveK, driveYears, hire, driveLearn, pulseFlight, vested, ψ, N0,
τH, τL, mLo/mHi/aLo/aHi, ηL/ηT/ηE, refs), with one doc comment per line in codebase style.

---

## 6. Stats harness and targets (`src/sim/history/ideas/innovationStats.ts`; seeds 1, 7, 42, 1234; plus the 22-seed realism set for divergence)
CLI as `ideasStats.ts`: `[--tree] [--innov] [--years N] [--json] seeds...`. It reuses `ideasSeedStats` and adds the figures below.

### 6.1 Calibration (step 6) and neutral reproduction
1. **Logging run:** innovation on with all β = 0 (Mc ≡ 1: still bit-identical in outcomes, verified by the golden hash minus the
   IdeaPressures table). Record z at every conception and set `ref_k` = mean over seeds 1, 7, 42, 1234 (and the 22).
2. **With β on:**
   - Per v1 idea, the mean first-year over the 4 seeds moves by ≤ 60 years.
   - The mean over all ideas moves by ≤ 25 years.
   - The count never conceived differs by ≤ 2 per seed.
   - Median ideas held at 1000/2000 within ±10%.
   - Baseline table in 1.3.
3. If not met, rescale βs by kind (one factor per kind) rather than touching ref.

### 6.2 Divergence targets (techTree + innovation, 3500-year runs)
| metric | baseline [M] | target |
|---|---|---|
| leader / median mean tech at 2000 | 1.02–1.11 | unchanged ±0.05 (pre-industrial) |
| leader / median mean tech at (first Industrialised + 150 y) | n/a (at 3000 today: 1.04–1.06) | **1.25–1.8** |
| years from first Industrialised (rank 0) to median people's | n/a | 150–600 |
| first Industrialised year (leader) | none | 2200–3000 on ≥ 3 of 4 seeds; at least one seed outside ±150 y of the others (variety) |
| identity of the first industrialiser | — | not always the most populous people (≤ 15 of 22 seeds); predicted better by the pressure score Σ log Mc at its steamEngine conception than by population rank (AUC ≥ 0.65 vs population's) |
| Theil index of tech across peoples | ~0.001–0.003 at 3000 (measure) | peak ≥ 5× baseline within 300 y of rank 0, then declining (convergence) |
| adoption lags (first conception → 50% of peoples) by era | measure (era 4 ≈ 150–300 y) | era 6–7 lags shorter than era 4 (Comin & Hobijn 2010 [R]) |
| independent origins of era 5–7 ideas | — | rare (≤ 1.3 per idea mean): contact dominates |
| bans per run | 0 | 1–6 events; ≥ 1 seed in 4 with a ban lifted by defeat (Shock) |
| losses (Dwindled) | 0 | ≥ 1 on seeds with a cut-off small people; 0 for peoples > 5 000 connected |
| TimberFamine | — | ≥ 1 per run; the first industrialiser has coal on ≥ 15 of 22 |
| persistence | — | rank correlation of ideas held at 1000 with tech at 3000 ≥ 0.3 (Comin, Easterly & Gong 2010 [R]: technology in 1000 BC predicts later outcomes) |
| literacy | — | leader ≥ 0.85 within 150 y of massSchooling; a printing-only people 0.08–0.2 |

### 6.3 Realism scorecard guards (`realism-scripts/realismStats.ts --from off --vs on`)
- Zipf ζ at 2000 in 0.8–1.25; Gibrat |β| ≤ 0.03.
- Mean war α and duration CV no worse than baseline ±0.1 (War pressure makes militaries better, not wars more frequent).
- **World population growth** ≤ 1.0%/yr in any century, and the leader's population ×1.8–4 in the 150 years after Industrialised
  (design default; Europe's 19th-century growth is the loose model, not a cited figure).
- u10 does not exceed 0.6 by 3000 (real urbanisation rose to ~40% in industrial NW Europe; the sim's u10 is catchment-inflated).
- Faith, polity lifespan rows: no worse than ±10%.
- With society on: the leader's real wage index rises after industrialisation (escape from Malthus) on ≥ 3 of 4 seeds.

### 6.4 Attribution output
For each Industrialised rank-0 people, print its top 3 pressure channels at the steamEngine/factory conceptions and compare them with
the median people. This is the harness version of "why here".

---

## 7. Performance and memory
- Measured [M]: `ideasYear` 945–1 038 ms per 6000-year run (1.4–1.9% of 51–72 s), P = 10, I = 45.
- Cost is dominated by `learnAndConceive`, O(P²·I) per step [V system.ts:403–446], plus `channels` O(P²·CH).
- I = 107: ~2.4× the learn loop → ~2.3–2.5 s per 6000-year run (~4% of the run). CH 15: +7% on channels.
- New work per step:
  - pressureStep: O(P·K + living) (coal, wood, crowd sums ride the existing living loop in `context`);
  - Bass: O(P·I);
  - bans and drives: O(polities);
  - Henrich N_eff: O(P²) once per step.
  - Together < 10% of the ideas cost.
  - wood needs catchment timber per settlement: cache `timberBase[id]` like `oreBase`, which is static per settlement
    [V technology.ts:96–103]. Recompute standing timber only every LAND.step via landUse.
- Precompute KIND_BETA rows into a `Float32Array(I·K)` per catalogue at module load; no closures in the hot loop.
- **Caps:**
  - I ≤ 255 (Uint8 ids; 0.4).
  - K ≤ 32 (`why` Float32 per conception row: ~60–120 rows × K × 4 B, negligible).
  - `ban` per polity: polCap·I·2 B (~2 000 × 107 × 2 = 428 KB). Store sparse: `banList` of (pol, idea, year) instead, since bans are
    rare (≤ 10). **Use the list.**
- Memory per run:
  - acc P·I·CH·8 = 10·107·15·8 = 128 KB;
  - held/prog/inten ~10 KB;
  - snapshots literacy+industrial: P × snapshots (1 200 at 6000 y/5) × 2 B = 24 KB.
- Worker transfer: add the new typed arrays to worker.ts' transfer list.
- If P grows (bigger worlds), cost is P²·I. With 40 peoples, the learn loop would be 16× slower. Mitigation (perf plan): skip holders with
  `contact < 0` via a per-people met list (already sparse in practice).

---

## 8. Ordered commit-sized steps (each: `npm test`, `npm run typecheck` green; goldens unchanged until the switch flips)
1. **Catalogue plumbing**:
   - `ix.defs` per run; CAT[0|1] tables (PRE, SITE, IDEA_INDEX, technique map) for v1 and v2; `I` from the catalogue.
   - `HistoryOptions.techTree`, `innovation` (contract; default false).
   - Tests: v1 golden hash identical; PRE order invariant (every pre id < own id) for both catalogues; unknown keys throw.
2. **Contract enums and events** (5.1, 5.2), `CH` 15, HOW arrays (ideasStats, ideasData HOW_SHORT/HOW_CSS, ideasFormat), worker transfer
   list. Golden: identical (CH grows, but the new channel's rate is 0 and `acc` is internal; the hash covers History only). Test: event switch
   in history.test.ts lists 300–306.
3. **Coal field and v2 context**: `'history-coal'` field (2.4), `timberBase` cache, ctx fields (coal, wood, woodLoss, crowd, wage proxy,
   warShare, rival, states, univ). Tests: coal coverage 8–15% of land on the 4 seeds; deterministic; computed only with techTree.
4. **The 62 ideas** (2.5) with `rng2`, new levers in `recompute`, readers wired (population yield, disease tollAll, famine, siege proxy,
   finances/battles hooks behind null checks), ERA_LABELS.
   - Tests: with techTree on and innovation off, the first v2 idea's year ≥ the last v1 draw changed (early-segment equality: a v1-only hash
     prefix up to the first v2 conception); every new lever's reader is called (spy test); caps of "all held" ≈ targets.
   - Calibrate `chance`/`cond` for era timing (2.1).
5. **Pressure module** (`ideas/pressure.ts`, 0.3) with β = 0. Tests: Mc ≡ 1 → bit-identical History (except IdeaPressures);
   `registerChannel` ordering is stable; the why vector is recorded.
6. **Calibration of ref** (6.1) on 4 + 22 seeds; commit ref constants with the measured table in a comment. Turn β on. Tests: neutral
   reproduction bands (6.1) in a slow test tagged `stats`.
7. **Bass intensities** (4.4), IdeaTakeoff, effects × a for era ≥ 5. Tests: closed form vs Euler for constant Ma (logistic within 2%);
   eras 0–4 unchanged.
8. **Literacy and openness** (4.8, 3.5), snapshot tables. Tests: monotone in printing/massSchooling; bounds.
9. **Generalised refusal** (3.6 Vested, protect) and **bans + flight** (4.5, 4.6) on `rngInn`. Tests: a ban only affects member peoples;
   lift after defeat; flight pulse target is outside the polity; draws only on rngInn (v1 stream untouched in a ban-free run segment).
10. **Catch-up drives** (4.7), IdeaHow Hired. Tests: trigger only on a defeat by a ≥ 1.3× more advanced polity; the drive ends after
    driveYears.
11. **Henrich losses** (4.9) and **leapfrogging** (4.10). Tests: synthetic isolated band; skip flags; the forward-pass loss handles
    skipped prerequisites (a skipped pre is not lost).
12. **Industrialised** (4.11), `ideaIndustrial`/`ideaEra` hooks, the IdeaPressures History table, assemble + worker; harness
    `innovationStats.ts` (6); realism runs.
13. **UI** (section 10) and seat-mode OrderKind 39/40 and DecisionKind 25/26 (optional).
14. **Defaults** (owner decision): flip `techTree` and `innovation` on; regenerate goldens; README build-order row.

---

## 9. Determinism
- **Streams:**
  - `'history-ideas'` (unchanged, v1 ideas);
  - **`'history-ideas-v2'`** (conception/adoption/channel draws of ids ≥ 45);
  - **`'history-innovation'`** (bans, ban lifts, drives; flight has no draw);
  - **`'history-coal'`** (a simplex seed only).
  - No other stream is touched.
  - Fixed orders: people ascending, idea ascending, polities in `ps.alive` order; no Map/Set iteration (IDEA_INDEX is lookup-only, as today).
- **Off/off:** every new branch is behind `ix.v2`/`ix.inn` flags set from the options. `I = 45`, `CH` affects internal arrays only →
  bit-identical History (golden tests in ideas.test.ts, polity, goods, disease, tourism, renaming, orders, cradleWish, landmarks).
- **Golden filters:** with innovation on, the goldens skip keys `ideaPressures, literacy, industrial` and events 300–309 (like the other
  plans' filters).
- **Float stability:** `exp`/`ln` in Mc on Float64 only; clamps before comparison; no `Math.random`.
- **The UI's Bass closed form** must reproduce the sim's Euler discretisation exactly. Either store intensity snapshots
  (P × I × snapshots Uint8: 10 × 107 × 1 200 = 1.3 MB at 6000 y; too much) or **store per (people, idea) the years a crossed 0.25/0.5/0.75**
  in the IdeaTakeoff extra field. Decision: log 303 at 0.5 only; the UI interpolates a logistic through (since, a0) and (takeoff, 0.5),
  labelled "about".

---

## 10. UI

### 10.1 Ideas panel: tech tree graph (`ui/ideasTree.ts`, pure layout + SVG; no THREE)
- **Layout:** columns = eras (0–7, + future-tech's), rows = IdeaKind lanes (10 lanes). Node x = era column + an offset by
  prerequisite depth within the era; y = kind lane, packed.
- **Edges:** `pre` (solid), `skip` (dotted), `displaces` (red tick, Vested).
- The layout is deterministic, from `h.ideas` only, cached per catalogue. A pure function `treeLayout(ideas): {x, y, edges}` is
  unit-tested for no overlaps and stable order.
- **Node state at the timeline year, for the selected people (else the world):**
  - held: filled, fill = intensity;
  - known in the world but not held: outline;
  - refused: hatched;
  - banned: red bar;
  - lost: dashed.
  - **Not yet conceived anywhere: a grey silhouette with no name.** This keeps the panel's no-spoiler rule [V ideasPanel.ts:1–3]: only
    "n more in this era" is shown.
- Hover gives the effect line; click opens the existing detail.
- A mobile fallback is the existing list by era (the graph only above 700 px width).
- **Divergence strip** above the graph: one line per people over time, its era frontier (`eraAt`) and industrial index, with an
  Industrialised marker; the first industrialiser is gold. Click a line to select the people.

### 10.2 "Why here, why now" (idea detail, from IdeaPressures)
- The top two positive and the top negative channel, each with its multiplier and a concrete reading drawn from History: the war years,
  the polity, the wage index, coal in the catchment, the ruler's tolerance, the Library count, the number of rival states.
- Example detail line:
  > **The steam engine** was first built at Ashford in 2412 by the Velmar. Why there: coal under the hills and woods long cut down
  > (cheap fuel ×1.9), dear labour after the plague of 2380 (×1.5), and a fragmented, quarrelsome world of seven rival crowns (×1.3).
  > Held back by: little (an orthodox court ×0.9).
- Hedged when the channel is a proxy (no society: "labour was scarce, it seems").

### 10.3 Chronicle (`ui/ideasFormat.ts describeIdeasEvent`; plain and hedged)
- 300: "The court at Kesh forbade the printing press, it is said for fear of the scribes and the priests."
- 301: "After its defeat at the hands of the Oru, Kesh lifted its ban on the printing press."
- 302: "Makers of guns, unwelcome at home, are said to have carried their craft from Hollin to Tarrow."
- 303: "Spinning mills came into common use among the Velmar (some 40 years after the first)."
- 304: "The Velmar, first of all peoples, turned to steam and mills (Ashford, 2460)." For rank > 0: "…the third people to do so."
- 305: "Beaten by the Velmar, Kesh resolved to learn their ways, and hired their engineers."
- 306: "The woods around Ashford were nearly all cut; coal, it seems, would have to serve."
- Filters: a new group "Innovation" in chronicleFilter.ts (300–306). Headlines: 304 rank 0, 305.

### 10.4 Sagas, both registers (`ui/sagas/tech.ts`, phrase table `TECH_T` as `[chronicle variants, legend variants]` [V voice.ts:9])
| key | chronicle | legend |
|---|---|---|
| industrialised | "In {year} the {people} at {town} set fire and iron to work, and their mills outran every hand." | "In the year {year} the {people} woke the fire-horse beneath {town}, and the smoke of their forges hid the sun." |
| banned | "{ruler} of {polity} would not suffer {idea} in his lands." | "{ruler} cast {idea} out of the realm, and called it the devil's craft." |
| fled | "Its makers took {idea} to {town}, where they were let be." | "The banished masters carried the secret of {idea} over the border, to {town} of the open gates." |
| drive | "Humbled by {winner}, {polity} sent for their masters and learned their arts." | "Shamed in war, {polity} swore to learn the sorcery of {winner}, and bought it with gold." |
| timber | "The forests of {people} were gone by {year}." | "The last great oak of {people} fell in {year}, and the hills stood bare." |
| divergence (world.ts) | "By {year} the {people} held {n} arts the rest of the world had not." | "By {year} the {people} had outstripped all the earth, and the others came to their ports to wonder." |
- Wiring: world.ts adds "the Great Divergence" paragraph when a 304 rank 0 exists (who, where, the why channels); year.ts adds 304/305/300;
  people.ts adds the people's industrial age and literacy; city.ts adds "the first engine was built here".
- Partisan sagas (experience plan): a banning polity's own saga words a ban as "kept the realm pure of {idea}", and the fled-to people's as
  "gave refuge to the masters".
- MILESTONES (sagas) add `steamEngine, railway, telegraph, electricPower, newspaper, massSchooling`.

### 10.5 Map
- Ideas view legend: "era frontier" mode colours peoples by `eraAt` (8 steps) plus an industrial index hatch.
- The per-idea "when taken up" mode is unchanged.
- Coal is shown as a resource overlay in the Ideas view when techTree is on (dark dots).

---

## 11. Risks and open questions
1. **Population explosion.** The yield + Farming caps of eras 5–7 can double carrying capacity in a few centuries. Guard 6.3; the knobs
   are `capEra[5..7]` and the `yield` total.
2. **Neutral reproduction is statistical, not exact.** A world where one people is far above ref on several channels will diverge
   earlier even in eras 0–4. That is the point, but it moves the era-0–4 calibration of caps to the PRODUCTIVITY curve. The harness 6.1
   bands are the contract.
3. **Proxy wages without society** may make the Labour channel mostly a mirror of Land (both from crowding). Then the induced-bias split
   (3.3) is weaker. Acceptable; document it in the "why" text as hedged.
4. **Coal as a near-gate makes geography destiny** (an Allen/Pomeranz reading). Mokyr (2016), Kelly, Mokyr & Ó Gráda (2014) and Clark & Jacks (2007) argue otherwise [R?]. Mitigation:
   coal imports along lanes (3.4) and non-coal routes (mechanisedSpinning on water power; electricPower via hydro on rivers, `use` =
   coal or river). Owner can lower coal weight (`IDEA2.coalW`).
5. **Fragmentation premium vs unity bans may overfit "Europe".** The Frag channel is weak (β ≤ 0.6) and bans need a refusal first. Ko,
   Koyama & Sng's trade-off (unity gives peace and scale) is partly in the existing scale term and the Rivalry cost. Watch that the first
   industrialiser is not always the most fragmented region (harness attribution).
6. **Only 6–10 peoples per world** [M]. "Regions" are peoples, so divergence statistics are noisy. Use the 22-seed set for 6.2.
7. **The UI Bass interpolation is approximate** (9); labelled "about".
8. **Catalogue size and Uint8 ids** with ideologies and future-tech (0.4).
9. **Battles/finances readers depend on unbuilt plans.** Each reader has a proxy (siege → wall divisor in war.ts; fire/naval → war lever;
   fisc → admin; credit unused). The exact war.ts call site for the siege proxy is [A].
10. **Owner decisions:**
    - (a) default run length 2000 vs 3000 preset;
    - (b) `sFrom` 5 vs 0;
    - (c) whether future-tech starts at 1914 (0.4);
    - (d) whether bans of held War ideas (Tokugawa) are on by default;
    - (e) Vested resistance on `printing ⟂ writing` (changes a v1 idea's behaviour when innovation is on).

### Verified / measured / assumed summary
- **[V]** ideas system structure and every line ref in 1.1–1.2; catchUp bypassing the quartic brake; lever reader sites; Uint8/Int16
  sizes; terrain timber/ore streams; `Library` gating; ruler/religion fields; OrderKind.Idea.
- **[M]** baseline first-years, held counts, tech gaps, 0 losses, 6000-year stagnation, ideas cost 1.4–1.9%.
- **[A]** all new chances, conds, caps, βs, refs (to be measured), Bass constants, ban/drive chances, Henrich N0/τH, coal coverage,
  wage proxy.
- **[R]/[R?]** as tagged in 3.2–4.9.

---

## References
Tags (see the header): **[verified]**, a publisher, RePEc, journal or library page was opened this session and confirmed the
bibliographic data (and the finding where one is quoted). **[verified-search]**, only a search listing confirmed title, venue and year.
**[unverified]**, with the reason given. DOIs are given only where a fetched page showed them; otherwise a stable URL.

- Acemoglu, D. (2002). Directed Technical Change. *Review of Economic Studies* 69(4): 781–809. doi:10.1111/1467-937X.00226. [verified] (the abstract names the price effect toward scarce factors and the market-size effect)
- Allen, R. C. (2009). *The British Industrial Revolution in Global Perspective*. Cambridge University Press. https://www.cambridge.org/core/books/the-british-industrial-revolution-in-global-perspective/29A277672CCD093D152846CE7ED82BD9 [verified-search]
- Anderson, B. (1983). *Imagined Communities: Reflections on the Origin and Spread of Nationalism*. Verso. https://en.wikipedia.org/wiki/Imagined_Communities [verified-search]
- Andrade, T. (2016). *The Gunpowder Age: China, Military Innovation, and the Rise of the West in World History*. Princeton University Press. https://press.princeton.edu/isbn/9780691178141 [verified-search]
- Bass, F. M. (1969). A New Product Growth for Model Consumer Durables. *Management Science* 15(5): 215–227. doi:10.1287/mnsc.15.5.215. [verified]
- Black, J. (1991). *A Military Revolution? Military Change and European Society, 1550–1800*. Macmillan. https://www.palgrave.com/978-1-349-11361-3 [verified-search]
- Boserup, E. (1965). *The Conditions of Agricultural Growth: The Economics of Agrarian Change under Population Pressure*. Allen & Unwin. https://eh.net/book_reviews/the-conditions-of-agricultural-growth-the-economics-of-agrarian-change-under-population-pressure/ [verified-search]
- Broadberry, S., Campbell, B. M. S., Klein, A., Overton, M., van Leeuwen, B. (2015). *British Economic Growth, 1270–1870*. Cambridge University Press. https://econpapers.repec.org/RePEc:cup:cbooks:9781107070783 [verified-search] (the yield figure attributed to it in 2.5 is not quoted from it: [unverified])
- Buringh, E., van Zanden, J. L. (2009). Charting the "Rise of the West": Manuscripts and Printed Books in Europe, a Long-Term Perspective from the Sixth through Eighteenth Centuries. *Journal of Economic History* 69(2): 409–445. https://econpapers.repec.org/RePEc:cup:jechis:v:69:y:2009:i:02:p:409-445_00 [verified-search]
- Cardwell, D. S. L. (1972). *Turning Points in Western Technology: A Study of Technology, Science and History*. Science History Publications. https://catalog.hathitrust.org/Record/001510213 [verified-search]
- Clark, G. (2008). *A Farewell to Alms*. Princeton University Press. Cited only through Our World in Data's literacy page. [unverified: not opened]
- Clark, G., Jacks, D. (2007). Coal and the Industrial Revolution, 1700–1869. *European Review of Economic History* 11(1): 39–72. https://econpapers.repec.org/RePEc:cup:ereveh:v:11:y:2007:i:01:p:39-72_00 [verified] (the abstract: output growth was demand-driven, and English ownership of coal made a "negligible contribution" to IR incomes)
- Comin, D., Easterly, W., Gong, E. (2010). Was the Wealth of Nations Determined in 1000 BC? *American Economic Journal: Macroeconomics* 2(3): 65–97. https://econpapers.repec.org/RePEc:aea:aejmac:v:2:y:2010:i:3:p:65-97 [verified-search]
- Comin, D., Hobijn, B. (2010). An Exploration of Technology Diffusion. *American Economic Review* 100(5): 2031–59. doi:10.1257/aer.100.5.2031. [verified] (the abstract: an average adoption lag of 45 years after invention; newer technologies adopted faster)
- Coşgel, M. M., Miceli, T. J., Rubin, J. (2012). The Political Economy of Mass Printing: Legitimacy and Technological Change in the Ottoman Empire. *Journal of Comparative Economics* 40(3): 357–371. https://econpapers.repec.org/RePEc:eee:jcecon:v:40:y:2012:i:3:p:357-371 [verified-search]
- Dittmar, J. E. (2011). Information Technology and Economic Change: The Impact of the Printing Press. *Quarterly Journal of Economics* 126(3): 1133–1172. https://ideas.repec.org/a/oup/qjecon/v126y2011i3p1133-1172.html [verified-search]
- Gerschenkron, A. (1962). *Economic Backwardness in Historical Perspective*. Belknap Press of Harvard University Press. https://www.cambridge.org/core/journals/journal-of-economic-history/article/economic-backwardness-in-historical-perspective-a-book-of-essays-by-alexander-gerschenkron-cambridge-the-belknap-press-of-harvard-university-press-1962-pp-456-875/336E1D390D17B360174CEE370E6E0B6A [verified-search]
- Griliches, Z. (1957). Hybrid Corn: An Exploration in the Economics of Technological Change. *Econometrica* 25(4): 501–522. https://www.jstor.org/stable/1905380 [verified] (logistic adoption curves; differences explained by profitability)
- Habakkuk, H. J. (1962). *American and British Technology in the Nineteenth Century: The Search for Labour-Saving Inventions*. Cambridge University Press. https://econpapers.repec.org/RePEc:cup:jechis:v:23:y:1963:i:01:p:104-106_10 (review) [verified-search]
- Hartwell, R. (1962; the year is from memory, and the listing did not show it: [unverified] for the year). A Revolution in the Chinese Iron and Coal Industries during the Northern Sung, 960–1126 A.D. *Journal of Asian Studies*. https://www.cambridge.org/core/journals/journal-of-asian-studies/article/revolution-in-the-chinese-iron-and-coal-industries-during-the-northern-sung-9601126-ad/C4ED428E19B0A04C7225BB57822C89DF [verified-search]
- Hayami, Y., Ruttan, V. W. (1971). *Agricultural Development: An International Perspective*. Johns Hopkins Press. https://en.wikipedia.org/wiki/Vernon_Wesley_Ruttan [verified-search]
- Henrich, J. (2004). Demography and Cultural Evolution: How Adaptive Cultural Processes Can Produce Maladaptive Losses: The Tasmanian Case. *American Antiquity* 69(2): 197–214. doi:10.2307/4128416. [verified] (the abstract: a population drop isolating Tasmania kept simple skills while complex ones were lost). The threshold form N* = exp(α/β − ε) in 4.9 is my restatement of the model: [unverified against the full text, not opened]
- Henrich, J., Boyd, R., Derex, M., et al. (2016). Understanding cumulative cultural evolution. *PNAS* (2016), reply to Vaesen et al. https://henrich.fas.harvard.edu/publications/understanding-cumulative-cultural-evolution [verified-search]
- Hicks, J. R. (1932). *The Theory of Wages*. Macmillan. https://en.wikipedia.org/wiki/The_Theory_of_Wages [verified-search]
- Hoffman, P. T. (2015). *Why Did Europe Conquer the World?* Princeton University Press. https://authors.library.caltech.edu/records/gb7da-cgb58 [verified-search]
- Humphries, J., Schneider, B. (2019). Spinning the Industrial Revolution. *Economic History Review* 72(1): 126–155. doi:10.1111/ehr.12693. [verified] (the abstract: "no such 'high wage economy' in spinning")
- Jones, E. L. (1981). *The European Miracle: Environments, Economies and Geopolitics in the History of Europe and Asia*. Cambridge University Press. https://en.wikipedia.org/wiki/The_European_Miracle [verified-search]
- Kelly, M., Mokyr, J., Ó Gráda, C. (2014). Precocious Albion: A New Interpretation of the British Industrial Revolution. *Annual Review of Economics* 6: 363–389. doi:10.1146/annurev-economics-080213-041042. [verified]
- Ko, C. Y., Koyama, M., Sng, T.-H. (2018). Unified China and Divided Europe. *International Economic Review* 59(1): 285–327. https://econpapers.repec.org/RePEc:wly:iecrev:v:59:y:2018:i:1:p:285-327 [verified-search]
- Kremer, M. (1993). Population Growth and Technological Change: One Million B.C. to 1990. *Quarterly Journal of Economics* 108(3): 681–716. http://hdl.handle.net/10.2307/2118405 [verified] (the abstract: technology growth rises with population, and isolated regions with larger populations advanced faster)
- Mokyr, J. (1994). Cardwell's Law and the Political Economy of Technological Progress. *Research Policy* 23(5): 561–574. https://econpapers.repec.org/RePEc:eee:respol:v:23:y:1994:i:5:p:561-574 [verified] (bibliographic data only; the statement of the law in 3.6 is from the secondary literature: [unverified])
- Mokyr, J. (2002). *The Gifts of Athena: Historical Origins of the Knowledge Economy*. Princeton University Press. https://press.princeton.edu/books/ebook/9781400829439/the-gifts-of-athena-0 [verified-search]
- Mokyr, J. (2016). *A Culture of Growth: The Origins of the Modern Economy*. Princeton University Press. https://ideas.repec.org/b/pup/pbooks/10835.html [verified-search]
- North, D. C., Weingast, B. R. (1989). Constitutions and Commitment: The Evolution of Institutions Governing Public Choice in Seventeenth-Century England. *Journal of Economic History* 49(4): 803–832. doi:10.1017/S0022050700009451. [verified-search] (cited in the publicDebt note as contested)
- Parker, G. (1988). *The Military Revolution: Military Innovation and the Rise of the West, 1500–1800*. Cambridge University Press. https://doi.org/10.1017/s0018246x00015405 (review) [verified-search]
- Perrin, N. (1979). *Giving Up the Gun: Japan's Reversion to the Sword, 1543–1879*. David R. Godine. https://www.cambridge.org/core/journals/journal-of-asian-studies/article/giving-up-the-gun-japans-reversion-to-the-sword-15431879-by-perrinnoel-boston-david-r-godine-publisher-1979-xii-122-pp-notes-bibliography-illustrations-895/FB19833A0C0D0B18725BC46CAF202A4A [verified-search]. The critique is general knowledge, not a specific cited work: [unverified]
- Pomeranz, K. (2000). *The Great Divergence: China, Europe, and the Making of the Modern World Economy*. Princeton University Press. https://www.degruyterbrill.com/document/doi/10.1515/9781400823499/html [verified-search]
- Roberts, M. (1956). *The Military Revolution, 1560–1660* (inaugural lecture, Queen's University Belfast). https://en.wikipedia.org/wiki/Michael_Roberts_(historian) [verified-search]
- Rogers, E. M. (1962). *Diffusion of Innovations*. Free Press. https://en.wikipedia.org/wiki/Diffusion_of_Innovations [verified-search] (the listings showed later editions; 1962 as the first edition is from the Wikipedia listing)
- Roser, M., Ortiz-Ospina, E. "Literacy". Our World in Data. https://ourworldindata.org/literacy [verified] (world ~12% literate c. 1820; England: two-thirds of men and about half of women by 1840, nearly three-quarters by the late 19th century)
- Rubin, J. (2017). *Rulers, Religion, and Riches: Why the West Got Rich and the Middle East Did Not*. Cambridge University Press. https://digitalcommons.chapman.edu/economics_books/22 [verified-search]
- Scheidel, W. (2019). *Escape from Rome: The Failure of Empire and the Road to Prosperity*. Princeton University Press. https://press.princeton.edu/isbn/9780691172187 [verified-search]
- Sokoloff, K. L. (1988). Inventive Activity in Early Industrial America: Evidence from Patent Records, 1790–1846. *Journal of Economic History* 48(4): 813–850. https://econpapers.repec.org/RePEc:cup:jechis:v:48:y:1988:i:04:p:813-850_00 [verified] (the abstract: patenting strongly associated with proximity to navigable waterways, and so with market growth)
- Squicciarini, M. P., Voigtländer, N. (2015). Human Capital and Industrialization: Evidence from the Age of Enlightenment. *Quarterly Journal of Economics* 130(4): 1825–1883. doi:10.1093/qje/qjv025. [verified]
- Sugihara, K. (2013). Labour-intensive industrialization in global history: an interpretation of East Asian experiences. In G. Austin and K. Sugihara (eds.), *Labour-Intensive Industrialization in Global History*. Routledge. https://www.routledge.com/Labour-Intensive-Industrialization-in-Global-History/Austin-Sugihara/p/book/9781138901148 [verified-search]
- Vaesen, K., Collard, M., Cosgrove, R., Roebroeks, W. (2016). Population size does not explain past changes in cultural complexity. *PNAS* 113: E2241–E2247 (pages from the repository file name). https://www.universiteitleiden.nl/en/news/2016/04/population-size-fails-to-explain-the-evolution-of-complex-culture [verified] (the models hold only under implausible conditions; the Tasmanian record contradicts them)
- Wrigley, E. A. (2010). *Energy and the English Industrial Revolution*. Cambridge University Press. https://www.cambridge.org/core/product/identifier/9780511779619/type/book [verified-search]

**Not sourced (design defaults, stated as such):** every β in KIND_BETA, the clamps, the Bass pB/qB, the ban/drive/flight constants,
Henrich's N0/τH, the coal coverage, the wage proxy, the literacy weights, the cap and era weights, and all harness targets in 6.2–6.3
except the literature anchors cited there.

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **R3.** Step 1 also widens `IdeaAdoptions.idea` to **Uint16** (contract, assemble, UI reader, cache version bump), with the G0 projection rule (MASTER-PLAN §2.1). §0.4's "future-tech must widen it" is stale.
- **D-dup 8.** Export one `litProxy(s, p)` from `ideas/hooks.ts`: court's form × `(0.3 + 0.7·held(printing))`. Court, MIR, religious-evolution and migration use it when techTree is off.
- **C5.** `ideaFarm` (yield, including future-tech's rows) is the supply factor, `ideaFamine` a death factor, `ideaFisc` the C8 capacity factor and `ideaCredit` a C9 factor.
