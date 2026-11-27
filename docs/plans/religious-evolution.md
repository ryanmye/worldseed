# Plan: Religious evolution (faiths whose doctrine changes; schisms along their strongest tension; reformations, councils, orders, syncretism; secularisation and revival)

Base commit 8cabf09. This plan only plans. Measurements were taken in `/home/claude/scratch-religion` (`probe-religion.ts`, `perf-rel.ts`).
Tags: **[V]** verified in the code or a fetched source; **[M]** measured; **[A]** assumed; **[D]** design default (no source; a tuning knob).

**Integration rule.** This plan adds no parallel subsystem. It extends the religion system that exists (`src/sim/history/religion/`):
- its faith records (`rel.zeal/org/appeal` become 3 of the 14 doctrine axes);
- `foundStep`, `schismStep`/`schism`, `spreadStep` (`fitOf`), `rulersStep` (persecution) and the hooks `holyDrive`, `faithGrievance`, `faithRivalry`;
- the existing Faiths panel (the radar, a time axis on its family tree), the existing Faiths map view (an "unaffiliated" toggle), the chronicle and sagas.

Reformations reuse riots-uprisings' Reform movement (MovementKind 0) and its spread, repression and Triumph machinery. Fundamentalism is a Reform movement with a strict programme. Every new record or field carries a one-line **Why new** note.

Depends on: religion (in repo, required). Optional, each with a proxy: riots-uprisings (movements), society-secular-cycles (wages, disorder), tech-tree-innovation (literacy, openness), disasters-climate (shocks), state-finances and merchant-families (usury), court-politics, city-states, demography (fertility), culture-soft-power, world-builder-divine, modern-ideologies-regimes (MIR).
Build: after riots-uprisings and tech-tree-innovation if possible. Every proxy is listed in §0.3.

---

## 0. Interfaces (one contract for the implementer)

### 0.1 Ids and enum values

The registry in `_CONVENTIONS.md` was re-read just before finishing (it now holds tech-tree, future-tech and character-mode entries).
**Rule:** code reads every value by name. If a value below has been taken by the time this is built, take the next free one.

| what | values (this plan's) | note |
|---|---|---|
| EventType | **410 Reformation, 411 CouncilHeld, 412 OrderFounded, 413 Syncretism, 414 Secularised, 415 Revival, 416 Disestablished, 417 DoctrineShift**; 418–419 reserved | the block given to this plan |
| `DoctrineAxis` (new) | 0–13 (§3.1) | new enum, owned here |
| `SplitKind` (new) | Realm 0, Heresy 1, Reformation 2, Syncretic 3, Divine 4 | new enum (`Faith.splitKind`) |
| `FaithOrder` (new) | Monastic 0, Mystic 1 | the `extra` of OrderFounded. Named so it cannot be confused with `OrderKind` |
| `RevivalCause` (new) | War 0, Disaster 1, Hunger 2, Plague 3 | the `extra` of Revival |
| `FoundingKind` (new) | Crisis 0, Affluence 1, NewMovement 2, Prophet 3 | the `extra` of FaithFounded 89 **only when this plan is on** (−1 when off, as today) |
| RevoltCause, GrievanceKind, ReignEnd, MovementKind | **none** | risings over doctrine are riots' Reform risings (their RevoltCause Ideology 13 / Persecution 11) |
| OrderKind | **Council**: provisional **next free after all claims** (character-mode 41–58, world-builder-divine's 12 contiguous divine kinds, MIR 41–43, migration 42–44: these overlap and await the coordinator) | `ORDER_KIND_COUNT` grows to match; rows in between must exist as placeholders. Optional seat-mode follow-up |
| seat DecisionKind | **Doctrine card**: provisional **next free** (character-mode claims 27–44; MIR 27–29 and migration 28–29 overlap) | optional follow-up |
| GovernmentCause | reuse city-states **Secularised 11** | no new value |
| riots `Movement` record | new field **`doctrine`** (§0.2) | an amendment to riots-uprisings |

Asked of the coordinator: register "religious-evolution: events 410–419, OrderKind Council (next free after character-mode), DecisionKind Doctrine (next free), new enums DoctrineAxis/SplitKind/FaithOrder/RevivalCause/FoundingKind, riots Movement.doctrine field".

### 0.2 What this plan reuses from riots-uprisings (amendments asked)

- **Movement programme field.** `Movement.doctrine: number`: `axis * 2 + (dir > 0 ? 1 : 0)`, or −1 for movements with no doctrine.
  It is filled at birth for Reform (kind 0) and Millenarian (kind 3) movements. *Why new:* a Reform movement must say what it wants changed; no existing field says that.
- **Reform birth gate.** riots §4.8: `0.01·R` becomes `0.01·R·(1 + REFORM.print·[printing held by the town's people])·(0.5 + lit_p)`.
  When this plan is off, the factor is 1. The programme is `reformProgramme(s, i, f)` (§3.6). A second gate opens a **strict revival**:
  realm secularity rose by ≥ `SEC.fundRise` within 50 years, or a Revival was logged, and the faith's strictness is ≥ 0.5. Its programme is Tolerance↓ or Inquiry↓.
- **Triumph.** When a Reform movement Triumphs (riots: a Toleration is granted, or its adherents hold ≥ 0.5 at the capital when the ruler changes), riots calls
  `religionReformation(s, rel, movementId, p)` (§3.6). That function runs religion's own `schism()` with the programme's axis.
- **Repression.** A Reform movement that is suppressed or fades still nudges the parent faith toward its programme (the Counter-Reformation, §3.6).
  riots calls `religionReformFailed(s, rel, movementId, peakShare)` at MovementChanged extra 2 (faded).
- **Tolerance.** riots' MinorityAttacked odds and its Persecution push are multiplied by `(1.5 − tol_f)` (1 at the initial 0.5).
- **Proxy (riots not built).** religion runs a direct Reformation draw itself (§3.6 proxy). It needs no movement table.

### 0.3 What this plan reads (each guarded `s.x !== null`) and the proxies

| quantity | source | proxy when absent |
|---|---|---|
| literacy `lit_p` | tech-tree `ideaLiteracy(ix, people)` (§4.8 there) | `0.02·[writing] + 0.08·[printing] + 0.02·[paper]` from `ix.held` (ideas, in repo [V ideas/hooks.ts `ix.held`]); 0 without ideas |
| printing held | `ix.held[q·I + idx('printing')]` [V ideas/params.ts:352] | — (ideas off: never) |
| real wage / insecurity | society `socWage(s,p)`, `socDisorder(s,p)`, `psi(s,p)` [society 0.4] | `s.food[i]`, `ps.danger[i]`, wealth per head relative to the world's town median |
| shocks | disasters `disasterShockAt(s, id)` (the API riots asked for) | religion's own `rel.woe[i]` (sack, conquest, plague) and `s.lastFamine[i]` [V religion/state.ts, system.ts:678] |
| welfare | future-tech relief R (`welfareState`, `basicIncome` held) [future-politics 0.2 row "relief R"]; MIR welfare regimes | 0 |
| openness O | tech-tree `ideaOpenness` | — |
| regime | city-states `Government`; court-politics `Regime` | Monarchy / Patrimonial |
| player-god pushes | world-builder-divine (written; §0.5) | none |
| modern regimes, revivalist ideology | MIR `Government` 7–11, ideology shares (written; §0.5) | Monarchy; riots' strict Reform gate |
| prestige | culture-soft-power (in progress) | 1 |

### 0.4 What this plan exposes (`religion/doctrine.ts`, O(1), RNG-free; each returns the neutral value when the plan is off)

```ts
/** Doctrine axis a (DoctrineAxis) of faith f, 0..1 (axes 0..2 are rel.zeal, rel.org, rel.appeal); 0.5 when evolution is off and a > 2. */
doctrineOf(rel, f, a): number
/** Share 0..1 of settlement i's people who keep no faith (0 when off). The faith slots are shares of the rest. */
secularAt(rel, i): number
/** Population-weighted secular share of polity p's members at the last slow step (0 when off). */
secularRealm(rel, p): number
/** Strictness of faith f: (1 - tolerance + ascetic + zeal) / 3 (Iannaccone 1994; §3.8). */
strictnessOf(rel, f): number
/** demography: fertility multiplier of settlement i's people from their faith's Roles axis and secularity (§4.1); 1 when off. */
faithFertility(s, rel, i): number
/** state-finances / merchant-families: multiplier on lenders' rates (rateMul) and on lending capacity of lenders whose faith is f (§4.2); 1 when off. */
usuryRate(rel, f): number; usuryLend(rel, f): number
/** tech-tree: replaces the openness term -0.25·zeal·[state faith] (§4.3); also litFaith[p]. */
faithOpennessTerm(s, rel, p): number; litFaith(s, rel, p): number
/** court-politics / riots: legitimacy a state church lends its ruler, 0..0.1 (§4.5). */
faithLegitimacy(s, rel, p): number
/** migration-borders / riots: tolerance 0..1 of polity p's state (or ruler's) faith. */
faithTolerance(s, rel, p): number
/** world-builder-divine: push faith f's axis a by delta (clamped), credited to the player; returns the applied change. */
divinePush(s, rel, f, a, delta): number
/** world-builder-divine / causal explorer: share 0..1 of faith f's displacement on axis a over the last `years` that came from divinePush. */
doctrineCause(rel, f, a, years): number
```

### 0.5 What other plans should adopt (re-checked just before finishing)

At finish, world-builder-divine.md, modern-ideologies-regimes.md (MIR) and migration-borders.md had been written. demography.md and culture-soft-power.md were still absent.

- **demography.md** (not yet written): multiply the fertility norm by `faithFertility(s, rel, i)`. This plan does **not** touch population itself.
- **culture-soft-power.md** (not yet written): if it exposes a realm or city prestige `prestigeOf(s, p)`, the exposure source weight in `spreadStep` gets
  `× (1 + CULT.faithPull·(prestige − 1))`. That is their parameter and their hook call. Pilgrims (`pilgrimsAt`, in repo) remain the faith's contribution to their soft power.
- **world-builder-divine.md** [V their 3.3 Prophet row, 3.4 Heresy]:
  - Their Prophet founds through `newFaith` (traits from their `ox.rng`). With this plan on, `newFaith` also runs `initDoctrine` on the doctrine stream and marks FaithFounded extra = FoundingKind.Prophet.
    They do not choose doctrine in their v1. `divinePush` is offered for a later "Inspire a teaching" gift.
  - Their Heresy 384 calls the existing `schism(s, rel, dv.faith, p)`. With this plan on, that child gets `splitKind = Divine` and the tension axis a* of §3.5 as its splitAxis. Their event stays their own, and our Schism 92 is logged as today.
  - Their devotion is belief in the player god and is separate from our secularity. They may scale plight income by `(1 − secularRealm)`. We do not read devotion (no cycle).
  - Favour and blame are theirs. They may read `doctrineCause`.
- **modern-ideologies-regimes.md** [V MIR rows 8–10, Government 11 TheocraticRepublic, MovementKind 5 Ideology]:
  - In the modern era, fundamentalism is **their `revivalist` ideology** (a MIR movement), not a second mechanism.
    This plan asks their receptivity formula `zeal·(1 − 0.5·lit)·(grief + 0.5·minor)` to gain `× (1 + strictnessOf(f)) × (1 + 2·max(0, ΔsecularRealm over 50 y))`. That is reaction to rising secularity.
  - Secular ideology rows (liberal, socialist) multiply their receptivity by `(0.5 + secularAt)`.
  - Their "radical root" test (a faith split from the ruler's in 300 y) automatically sees our Reformation splits.
  - A secular regime (ConstitutionalRepublic, PartyState) adds `SEC.regimePush` to S (§3.8).
- **migration-borders.md** [V their 0 table, Faith faction row]: their Faith faction's Closed/Expel weight `× zeal` gains `× (1.5 − faithTolerance)`. Their requested `religionArrive` export is compatible.

---

## 1. Current behaviour [V: religion/system.ts, params.ts, state.ts at 8cabf09]

- **Faiths**: one traditional faith per people (id = people id), with traits zeal U(0.05,0.15), org U(0,0.15), appeal U(0,0.3) (`createReligionSystem`, l.55–61).
  Universal faiths arise every slowStep (10 y) with chance `found·(1 + crisis·woeShare)·(lone if n=1)/(1 + crowd·(n−1))`. The candidate is a town with pop ≥ min(2500, max(1200, ½ the largest)),
  Crafts ≥ 1.45 and ≥ 2 open routes, weighted by pop·(1 + crisis·[woe]) (`foundStep`, l.655–696). New traits: zeal 0.2+0.8u, org u, appeal u. Holy city = the founding town.
- **Followers**: K = 3 faith slots per settlement (`fId/fSh`). Exposure along routes, lanes, neighbours, the state church and the ruler's faith, each × pull = 0.3 + zeal + 0.5·org.
  Gain `rate·exposure·fit·(1 − share)` plus a bandwagon. Fit is `townBase + townAppeal·appeal` for towns and `villageBase − villageAppeal·appeal` for villages (`fitOf`, l.312). Isolated villages drift back to folk practice (l.420).
- **Rulers and churches**: rulers convert (piety, the capital's and the realm's shares); a state religion is adopted with chance `adopt·(0.2 + org)`.
  Persecution: zeal ≥ 0.6, ruler tol < 0.3, minority ≥ 0.1, chance `0.03·zeal·(1 − tol)`. Flight follows (`rulersStep` l.486, `flightStep` l.566).
- **Schism** every 20 y (`schismStep` l.699): a universal faith ≥ 150 y old with ≥ 40,000 followers and no split for 250 y, in the largest realm of its faith ruled by another people, or by a rival (rel ≥ 0.5) of the holy city's holder; chance 0.1.
  The child's traits are the parent's ± a draw. Its share moves to the child (0.8 at the capital, 0.55 elsewhere). The realm adopts it as state church, and rivalry +0.3 (`schism` l.733).
  **The split has no axis: nothing says what it was about.**
- **Effects**: `faithGrievance` (rulers of another faith, persecution), `faithRivalry`, `holyDrive` (`1 + 0.6·zeal(·1.3 heathen) + 1.5 crusade`), holy-war logging, pilgrims, monastery tech links.
  Landmarks: houses of worship, a building tradition per faith fixed at founding, and rededication (`Converted`) when a town's majority changes [V landmarks/system.ts:626, contract LandmarkForm docs].
- **Static doctrine.** zeal, org and appeal never change after founding. There are no doctrines, councils, reformations, orders, syncretic faiths or secularisation.
  Printing (an idea, ideas/params.ts:352) has no religious effect. tech-tree's openness reads `zeal·[state faith]` only.

## 2. Baseline measurements [M] (probe-religion.ts; default options; 2000 years; follower-weighted = Σ pop·share over all 3 slots)

| seed | universal founded (years) | schisms (years) | first printing (peoples) | state-religion adoptions | holy wars | persecutions | live faiths 2000 (universal) |
|---|---|---|---|---|---|---|---|
| 1 | 5 (990, 1070, 1190, 1240, 1600) | 4 (1300, 1680, 1940, 1960) | never (0) | 51 | 14 | 3 | 14 (8) |
| 7 | 4 (700, 760, 1070, 1290) | 2 (1480, 1920) | 1825 (3) | 58 | 13 | 6 | 14 (4) |
| 42 | 3 (1160, 1250, 1460) | 2 (1560, 1780) | 1615 (6) | 61 | 10 | 4 | 14 (4) |
| 1234 | 3 (730, 1390, 1790) | 3 (1140, 1680, 2000) | 1775 (7) | 79 | 15 | 2 | 14 (4) |

Shares at year 2000 (follower-weighted). A *family* is a root universal faith with all its schisms.

| seed | top faith | top 4 faiths | top family | families ≥ 5% | families ≥ 10% | universal share | folk share | unaffiliated |
|---|---|---|---|---|---|---|---|---|
| 1 | 0.271 | 0.686 | 0.390 | 2 | 2 | 0.757 | 0.243 | 0 |
| 7 | 0.725 | 0.928 | 0.911 | 1 | 1 | 0.912 | 0.088 | 0 |
| 42 | 0.706 | 0.933 | 0.858 | 2 | 1 | 0.916 | 0.084 | 0 |
| 1234 | 0.491 | 0.932 | 0.920 | 1 | 1 | 0.920 | 0.080 | 0 |

Year 1500: top family 0.32 / 0.38 / 0.41 / 0.55, so concentration happens mostly after 1500.

- **Schisms and printing are unrelated.** Of the 7 schisms on the 3 seeds that print, 4 come before that world's first printing and 3 after. Seed 1 never prints, yet it has 4 schisms.
- **Family monopolies.** On 3 of 4 seeds one family holds 0.86–0.92 of the world at 2000. This matches realism-metrics' finding for single faiths (majority-only measure: top1 0.23/0.69/0.65/0.36 [V realism-metrics.md §4]; our follower-weighted top1 differs because minorities in slots 2–3 count).
- **Cost.** Religion costs about 0.9 s of a 51 s run (seed 42: 51.5 s on, 50.6 s off; one run each, noisy). The probe runs took about 165 s with 4 in parallel and probe overhead.

## 3. Design

### 3.1 Doctrine vector (`DoctrineAxis`, 14 axes, each 0..1; 0.5 is neutral)

| # | axis | 0 ↔ 1 (UI words) | ties to | grounding |
|---|---|---|---|---|
| 0 | Zeal (= `rel.zeal`) | keeps to itself ↔ seeks converts | spread pull, persecution, holy war (existing) | costly-signalling strictness (Sosis & Bressler 2003; Iannaccone 1994) |
| 1 | Hierarchy (= `rel.org`) | no priesthood over the congregation ↔ a ranked priesthood | pull, state-church adoption, monasteries, court clergy estate (existing reads) | Stark & Finke 2000 (religious firms) |
| 2 | Urbane (= `rel.appeal`) | a faith of the countryside ↔ a faith of the towns | fit (existing) | — (existing trait) |
| 3 | Monotheism | many gods ↔ one god | conversion distance (§3.4) | big gods (Norenzayan 2013) |
| 4 | Scripture | oral tradition ↔ a written canon | drift inertia, councils, literacy hook | Becker & Woessmann 2009; Rubin 2014 |
| 5 | Ethics | right ritual ↔ right conduct (moralising) | conversion distance; a faith of affluence | Baumard et al. 2015; Watts et al. 2015 |
| 6 | Ascetic | world-affirming ↔ world-renouncing | orders, strictness | Baumard et al. 2015 ("ascetic wisdoms") |
| 7 | Tolerance | exclusive ↔ tolerant of other ways | persecution, grievance, syncretism, riots, migration | Stark & Finke 2000 (pluralism; contested: Chaves & Gorski 2001) |
| 8 | Eschaton | the world endures ↔ the end is near | Millenarian movements (riots), revival | Bentzen 2019; Sibley & Bulbulia 2012 |
| 9 | Inquiry | revealed truth only ↔ open to natural philosophy | tech-tree openness, idea resistance | Bénabou, Ticchi & Vindigni 2022 |
| 10 | Usury | forbids interest ↔ permits interest | finances, families | Rubin 2011 |
| 11 | Icons | forbids images ↔ venerates images | conversion distance; iconoclast reformations | design [D] |
| 12 | Martial | forbids holy war ↔ sanctions holy war | holyDrive | design [D]; holy-war data: Iyigun 2008 |
| 13 | Roles | strictly separate roles ↔ open roles (gender and kin) | demography fertility | Pew 2015 fertility by religion; Kaufmann 2010 |

*Why new:* `rel.doc` (Float32 F·11 for axes 3–13). Axes 0–2 stay in the existing `rel.zeal/org/appeal` arrays, so no existing reader changes. Every reader of `zeal` sees the drifted value when the plan is on.

**Initial doctrine** (new stream, §5):
- **Traditional faiths at year 0.** Monotheism 0.10+0.15u; Scripture 0.02u; Ethics 0.15+0.15u (broad supernatural punishment, not moralising high gods: Watts et al. 2015); Ascetic 0.15u; Tolerance 0.65+0.2u (folk faiths are not exclusive: matches `EFFECTS.folk` [V]); Eschaton 0.15u; Inquiry 0.4+0.2u; Usury 0.4+0.2u; Icons 0.55+0.35u; Martial 0.35+0.3u; Roles 0.2+0.3u.
- **A universal founding.** The founding realm's desired doctrine d*_p (§3.2) plus U(−0.25, 0.25) per axis, clamped. Then Monotheism and Ethics are raised to at least 0.45 (a moralising universal faith [D]).
- **A schism.** As today for axes 0–2 (the existing rel.rng draws are kept). Then §3.5 moves the split axis.

### 3.2 Desired doctrine of a realm d*_p (computed in `rulersStep`'s existing per-realm loop, every slowStep)

Per polity p (members aggregated in the loop that already fills `tot/ppop`), with:
- `lit` literacy (§0.3); `aff` = smoothstep(0.8, 2.5, the realm's wealth per head ÷ the world's town median);
- `tier` = polity tier/3; `trade` = open routes per member town, smoothstep(0, 3);
- `com` = merchant wealth share (goods `mw` ÷ wealth, smoothstep 0.05–0.3; proxy `trade`);
- `print` = [printing held by the capital's people]; `warF` = the share of the last 30 y at war with a realm of another faith;
- `shock` = mean disasterShock/woe of members (0..1); `psiN` = smoothstep(1, 3, Ψ) (proxy 0); `sec` = secularRealm; `church` = [state church];
- `folkD` = the doctrine of the members' traditional faiths (pop-weighted).

```
Monotheism* = 0.25 + 0.5·tier                                          (moral high gods follow complexity: Watts 2015; Norenzayan 2013)
Scripture*  = 0.15 + 0.6·lit + 0.15·print
Ethics*     = 0.25 + 0.4·aff + 0.2·tier                                (affluence → moralising: Baumard et al. 2015)
Ascetic*    = 0.2 + 0.4·aff + 0.2·shock
Hierarchy*  = 0.45 + 0.3·church·tier − 0.45·lit·print                  (printing cities turned Protestant: Rubin 2014)
Tolerance*  = 0.45 + 0.3·trade − 0.3·warF − 0.2·[persecuting] + 0.2·sec
Eschaton*   = 0.2 + 0.5·shock + 0.2·psiN                               (disasters raise religiosity: Bentzen 2019)
Inquiry*    = 0.35 + 0.35·lit + 0.15·[city-state or republic] − 0.2·rel.zeal
Usury*      = 0.2 + 0.6·com·(1 − 0.5·church·org_f)                     (commerce loosened interest bans where the church legitimised rulers less: Rubin 2011)
Icons*      = 0.5·folkD.Icons + 0.5·(0.6 − 0.4·Scripture_f)             (localisation; literate reform turns against images [D])
Martial*    = 0.25 + 0.55·warF
Roles*      = 0.25 + 0.3·sec + 0.2·lit
Zeal*       = rel.zeal (no pull: zeal drifts only through events, §3.5–3.7)
Hierarchy, Urbane* = the faith's town share of followers (for Urbane)
```
All weights are **[D]**; the sign of each term is what the cited source supports. The formulas are deliberately linear, so the UI's "why" can name the largest term.

### 3.3 Drift (every slowStep, faiths in id order, living only)

```
d̄*_f,a  = Σ_p w_pf · d*_p,a / Σ_p w_pf            w_pf = followers of f in p (from rulersStep's tot); stateless followers use d* of a null realm (tier 0, church 0)
ι_f     = (1 + DOC.scriptInertia·Scripture_f) · (1 + DOC.fixInertia·fix_f)         scripture 2, fix 3 [D]: a written canon and a council slow change
τ       = DOC.tauUniversal 300 y (universal) | DOC.tauFolk 150 y (traditional, oral)  [D]
x_f,a  += dt·(d̄*_f,a − x_f,a)/(τ·ι_f) + DOC.sigma·√(dt/100)·(u − 0.5)·√12           sigma 0.03 per century [D]; u from the doctrine stream
fix_f  *= 0.5^(dt / DOC.fixHalf 300)
```
**DoctrineShift 417** is logged when an axis crosses 1/3 or 2/3, with a 0.05 hysteresis band, so a faith "came to forbid images".
Drift moves axes 0–2 too, but at a quarter of the rate (`DOC.legacyRate 0.25`), so spread calibration is not swamped.
*Why new:* `fix: Float32Array(F)`, `band: Uint8Array(F·14)` (the last band per axis, for the events).

### 3.4 Conversion distance ("religious capital") — a modulation of the existing `fitOf`

People convert more readily to a faith close to their own. Large doctrinal changes lose more religious capital (Stark & Finke 2000, via the secondary summary §R).

```
fit' = fit · (1 − DOC.capital · dist(f, m_i))        m_i = the majority faith at i (f ≠ m_i), capital 0.5 [D]
dist(f, g) = sqrt(mean over a ∈ {Monotheism, Scripture, Ethics, Icons, Ascetic} of (x_f,a − x_g,a)²)
```
The F×F distance table is rebuilt once per step (F ≤ ~30 living). This gives frontiers between families with different doctrines and is the plan's main lever on the 0.86–0.92 family monopolies.
Without it, a schism or a syncretic faith does not reduce *family* concentration (it stays in the same family). `RELIGION.rate` must be recalibrated (§7).
Other modulations, each 1 at the initial 0.5:
- persecution chance `× (1.5 − tol_f)`;
- `faithGrievance` `× (1.5 − tol_ruler's faith) × (1 − 0.8·sec_i)`;
- `holyDrive` `(m − 1) × (0.5 + Martial_sf) × (1 − sec_p)`;
- `faithRivalry` `× (1 − max(sec_a, sec_b))`;
- the ideas R_FAITH resistance `faithResist·zeal × (1.5 − Inquiry_f)` [V ideas/system.ts:375];
- exposure and bandwagon gains `× (1 − sec_i)`.

### 3.5 Tension and schism — `schismStep` extended, still one draw per candidate faith

```
T_f,a   = Σ_p w_pf (d*_p,a − x_f,a)² / Σ_p w_pf         (variance of what its realms want around what it teaches)
a*_f    = argmax_a T_f,a,  T*_f = T_f,a*
chance  = SCHISM.chance · (0.5 + 1.5·smoothstep(DOC.t0 0.01, DOC.t1 0.06, T*_f))     [D]
seceder = among the existing gate's candidate realms (another people or a rival of the holy city's holder; unchanged), argmax pop_p · (d*_p,a* − x_f,a*)²
```
- **Gates.** The existing age, size and gap gates stay. With evolution on, `SCHISM.followers` falls to 20,000 when T*_f ≥ t1, so tension splits smaller faiths too.
- **The child** g = `schism(s, rel, f, p)` as today; then `x_g,a* = x_f,a* + 0.7·(d*_p,a* − x_f,a*)`, and the other axes move 0.15 toward d*_p.
  `Faith.splitAxis = a*`, `splitKind = Realm`. The existing Schism 92 is logged unchanged.
- Historical calibration anchor, not used as a number: the first ecumenical council (Nicaea 325) and the Arian split (Britannica, §R).

**Councils** (every schismStep, before the schism draw, faiths in id order). A faith is gated if Hierarchy ≥ 0.55, Scripture ≥ 0.3, it has a patron (the largest realm with f as state church), T*_f ≥ DOC.councilT 0.02, and its last council was ≥ 100 y ago.
The chance is `COUNCIL.chance 0.15 · smoothstep(0.02, 0.06, T*)`, one draw. If held:
- `x_f,a* ← d̄*_f,a*` (the majority view prevails), `fix_f = 1`, CouncilHeld 411;
- the realm deviating most on a* (> `COUNCIL.heresy 0.25`) gets **one** heresy draw (chance 0.5). On success it runs `schism()` with splitKind Heresy and the dissenters' value.
*Why new:* `lastCouncil: Int32Array(F)`.

### 3.6 Reformation (riots' Reform movement, §0.2)

- **Programme** `reformProgramme(s, i, f)`: the axis a ∈ {Scripture, Hierarchy, Icons, Usury, Tolerance, Ascetic} with the largest |d*_p,a − x_f,a| at town i's realm.
  The direction is the sign. Under printing and literacy this is mostly Scripture↑ / Hierarchy↓, which is what Rubin (2014) and Becker & Woessmann (2009) point to; it is not forced.
- **Triumph** → `religionReformation(s, rel, m, p)`: g = `schism(s, rel, f, p)` (the existing transfer of shares, state church, rivalry), with `x_g,a = x_f,a + REFORM.step 0.45·dir` and `splitKind = Reformation`.
  Logged: Schism 92 (as today) and **Reformation 410** (value g, other the movement id, extra `axis·2 + dir`). The landmarks system's existing rule rededicates temples to g where g becomes the majority [V landmarks/system.ts:626]. An Icons↓ reformation is therefore iconoclasm, and no new landmark code is needed.
- **Counter-Reformation.** On a Reformation, the parent f holds a forced council (CouncilHeld, extra a*): `fix_f = 1`; Scripture +0.1; Tolerance −0.1; Hierarchy unchanged.
  A failed or faded movement moves `x_f,a` by `REFORM.nudge 0.05·peakShare·dir`, so reform from within (the Council of Trent pattern [A]).
- **Proxy (no riots).** Every slowStep, for each realm with a state church f whose capital's people print, with `lit ≥ 0.1` and T_f,a ≥ t0 on a programme axis, one draw:
  chance `REFORM.proxy 0.01·smoothstep(0.1, 0.3, lit)`. On success → religionReformation with movement −1.
- **Target**: Reformations follow printing (§7).

### 3.7 Orders, syncretism, new faiths

- **OrderFounded 412** (every slowStep, faiths in order). Gate: universal, age ≥ 200 y, the faith is rich (its pilgrims ≥ the 70th percentile of living faiths, or a state church in ≥ 2 realms), and Ascetic < 0.7.
  Chance `ORDERS_F.chance 0.03 · smoothstep(0.3, 0.8, 1 − Ascetic)`. A worldly, rich church provokes ascetic reform: Cluny (910) answered lay control and laxity (Britannica, §R).
  - **Monastic** (Hierarchy ≥ 0.5): Ascetic +0.08, Ethics +0.04.
  - **Mystic** (otherwise): Urbane −0.06 (it reaches villages), Tolerance +0.05.
  - Site: the faith's largest town without a recent order. The landmarks Monastery gate (`rel.org[m] ≥ monkOrg`, l.542) gains `|| (Ascetic_m ≥ 0.6 && an order of m within 100 y)` [V l.542].
  - *Why new:* `orderYear: Int32Array(F)`. No order record: orders are events plus doctrine pushes.
- **Syncretism 413** (every slowStep, towns in id order). Gate: the top two faiths each hold ≥ 0.3 (one may be folk) for ≥ 100 y (`mixSince[i]`); the ruler's tol ≥ 0.5; Tolerance ≥ 0.5 for both faiths.
  Chance `SYNC.chance 0.002`, and at most one per world per `SYNC.gap 100` y. The new faith g is universal, with holy city i, parent = the larger faith and `parent2` = the other.
  Its doctrine is the share-weighted mean plus U(±0.1); its traits follow the same mean. Share: 0.25 of i, transferred proportionally from both. Mixed faiths can resist or serve authority (Shaw & Stewart 1994).
  *Why new:* `mixSince: Int32Array(cap)` (per settlement; nothing existing remembers how long two faiths coexisted) and `parent2` on the faith.
- **Founding (Axial / affluence).** foundStep's candidate weight becomes `w × (1 + DOC.axial 1.5·aff_i)`, with chance `× (0.6 + 0.8·max aff)`. This keeps the existing crisis term and the single draw.
  FaithFounded extra is FoundingKind Affluence (1) when aff_i ≥ 0.5, else Crisis (0). The Axial Age's dating and unity are debated (Jaspers 1949; Bellah & Joas 2012; Mullins et al. 2018 find axial traits well before 800–200 BCE), so the plan models only affluence, not an "age".
- **New religious movements.** When the world's mean secularity is ≥ 0.1, foundStep's crowd divisor is halved for candidates with `0.15 ≤ sec_i ≤ 0.6` (FoundingKind.NewMovement). They start with share 0.05 and org × 0.5.
  The basis is cult formation where conventional faith is weak (Stark & Bainbridge 1985; their summary page was fetched, but this exact claim is [unverified detail]).

### 3.8 Secularisation and revival (per settlement; every RELIGION.step)

Existential security S_i in 0..1 (Norris & Inglehart 2004). The weights are [D]:
```
S_i  = clamp( 0.30·lit_p + 0.20·sm(1, 3, wage_p) + 0.15·(1 − danger_i) + 0.10·[town] + 0.15·welfare_p + 0.10·[no plague/famine within 25 y]
              + SEC.regimePush·[secular regime] − 0.5·shock_i , 0, 1)
strict = (1 − Tolerance_m + Ascetic_m + Zeal_m)/3      m = majority faith       (strict churches are strong: Iannaccone 1994; costly signals: Sosis & Bressler 2003)
plural = 1 − Σ_k share_k²                                                        (pluralism; its effect on participation is contested: Chaves & Gorski 2001 vs Stark & Finke 2000)
sec*_i = SEC.max 0.85 · sm(0.55, 0.85, S_i) · sm(0.25, 0.6, lit_p) · (0.6 + 0.4·plural) · (1 − 0.6·strict) · (1 − 0.5·welfareChurch)
sec_i += dt·(sec* − sec)/τ,   τ = SEC.tauUp 40 y if sec* > sec  (cohort replacement: Voas & Chaves 2016)
                                  SEC.tauDown 8 y otherwise     (insecurity returns religiosity fast: Bentzen 2019; Sibley & Bulbulia 2012)
```
- **Literacy gate.** `sm(0.25, 0.6, lit)` requires mass literacy. tech-tree's literacy targets put a printing-only people at 0.08–0.2 and newspaper-era peoples at 0.3–0.5 [V tech-tree 4.8].
  So **no world secularises before mass schooling**. A world that never reaches it never secularises. That is the "worlds that never secularise" case, and it is reported, not prevented.
- **Welfare.** `welfareChurch` is 1 where the church, not the state, provides relief (a state church with Hierarchy ≥ 0.6 and no welfare idea). State welfare lowers religiosity (Gill & Lundsgaarde 2004).
- **Revival 415.** Logged when a realm's secularRealm falls by ≥ 0.1 within 30 y (a ring of 3 slow-step values), at most once per 50 y. The cause is the argmax of (war years, shock, famine, plague) → RevivalCause.
- **Secularised 414.** A realm's secularRealm crosses 0.5 (hysteresis 0.4).
- **Disestablished 416.** A realm with secularRealm ≥ 0.5 and a state church, one draw per slowStep, chance `SEC.disestablish 0.08`. Effect: `rel.state[p] = −1` (the faith stays).
- **Fundamentalism.** A rapid rise in secularity (≥ `SEC.fundRise 0.1` in 50 y) or a Revival opens riots' strict-revival gate (§0.2). The programme is Tolerance↓ or Inquiry↓.
  Where MIR is built, the same trigger instead boosts MIR's `revivalist` receptivity (§0.5), and riots' strict gate is skipped (no double mechanism).
  This draws on fundamentalism as a reaction to modernity (Almond, Appleby & Sivan 2003; Emerson & Hartman 2006 review the debate). Proxy: d*_p gets Tolerance −0.2 and Inquiry −0.2 in such realms, so the drift and tension paths can produce a strict split.
- **Desecularisation.** Religion's persistence and resurgence is the counter-thesis (Berger 1999). It is supported here by `tauDown`, the strictness term and differential fertility through demography (Kaufmann 2010). The plan targets neither outcome.
- *Why new:* `sec: Float32Array(cap)` per settlement and `secR: Float32Array(pcap·3)` per realm. Unaffiliation is not a faith (no missions, holy city or doctrine). A faith slot would evict real minorities from the K = 3 slots.

### 3.9 Params (`religion/params.ts`, new exported objects; codebase style, one doc comment per line)

```ts
/** Doctrine: drift, inertia, conversion distance, tension (HistoryOptions.religiousEvolution). All [D] unless a cite is in the plan. */
export const DOCTRINE = {
  /** Off by default until calibrated (HistoryOptions.religiousEvolution overrides it). */
  enabled: false,
  /** Years for a universal (written) or traditional (oral) faith to move 1/e of the way to what its realms want, before inertia. */
  tauUniversal: 300, tauFolk: 150,
  /** Inertia multipliers: 1 + scriptInertia * Scripture, 1 + fixInertia * fix (a council's orthodoxy, halving every fixHalf years). */
  scriptInertia: 2, fixInertia: 3, fixHalf: 300,
  /** Random walk per axis, per century (uniform scaled to unit variance). */
  sigma: 0.03,
  /** Axes 0..2 (zeal, org, appeal) drift at legacyRate times the others' rate. */
  legacyRate: 0.25,
  /** Conversion distance: fit * (1 - capital * dist). */
  capital: 0.5,
  /** Tension band for the schism multiplier and the smaller-faith gate (followers 20000 above t1). */
  t0: 0.01, t1: 0.06, tensionFollowers: 20000,
  /** Councils: tension at least councilT; once per councilGap years. */
  councilT: 0.02, councilGap: 100,
  /** Affluence in founding: candidate weight * (1 + axial * aff). */
  axial: 1.5,
  /** A DoctrineShift is logged at band edges 1/3 and 2/3 with this hysteresis. */
  hysteresis: 0.05,
  /** Doctrine and secular snapshots every snapEvery years (History.doctrine, History.secularShare). */
  snapEvery: 50,
}
export const COUNCIL = { chance: 0.15, heresy: 0.25, heresyChance: 0.5 }
export const REFORM = { print: 3, step: 0.45, nudge: 0.05, proxy: 0.01 }
export const ORDERS_F = { chance: 0.03, minAge: 200, quantile: 0.7 }
export const SYNC = { chance: 0.002, share: 0.3, years: 100, gap: 100, newShare: 0.25 }
export const SEC = { max: 0.85, s0: 0.55, s1: 0.85, lit0: 0.25, lit1: 0.6, tauUp: 40, tauDown: 8, regimePush: 0.1, disestablish: 0.08, fundRise: 0.1, revivalDrop: 0.1 }
```

### 3.10 Player-god interventions (coordination with world-builder-divine.md)

- `divinePush(s, rel, f, a, delta)` adds to `x_f,a` at once, records `dvAcc[f·14 + a] += |delta|` with year, and does not touch the doctrine RNG.
  The drift's own displacement goes to `dvTot`. `doctrineCause` = dvAcc / (dvAcc + dvTot) over a window. *Why new:* the credit/blame split exists nowhere else.
- A schism, reformation or council within 50 y of a divine push on its axis gets `splitKind = Divine` (schisms) or extra bit 7 (CouncilHeld). The chronicle can then say "after the god's sign".
- A prophet's faith (world-builder-divine's Prophet) gets its doctrine from `initDoctrine`, the same as any founding. A later gift may let the player set it: `divinePush` per axis, clamped to [0.05, 0.95].
- Blame (a schism the player caused, a holy war a pushed Martial value enabled) is theirs to score. This plan only marks causes.

---

## 4. Effects on other systems (each a modulation of an existing quantity; neutral at the initial 0.5 values)

### 4.1 Demography (fertility norms)
`faithFertility(i) = (1 + 0.5·(0.5 − Roles_m)) · (1 − 0.35·sec_i)`. Range: open-roles secular 0.56 ↔ strict-roles devout 1.25.
Calibration anchor: the unaffiliated have TFR 1.7 against 2.7 for Christians and 3.1 for Muslims (2010–15), a ratio ≈ 0.55–0.63 (Pew 2015 [verified]). Religious fertility as a counter-trend comes from Kaufmann 2010.
Proxy without demography: none (this plan does not change growth on its own).

### 4.2 Usury, banking, families
- state-finances 2.4.4: `rateMul_p ← rateMul_p · usuryRate(f_p)`, with `usuryRate = 1 + 0.5·(0.5 − Usury_f)` (a ban → +25%: lending goes through costlier devices; Rubin 2011).
- The capacity of Pool/Town lenders and families (`familyLendCapacity`) whose majority faith is f is multiplied by `usuryLend = 0.6 + 0.8·Usury_f`. Lenders of another faith are not bound by f's ban.
- **Prose rule**: the chronicle never characterises lenders by faith or people (no "the X moneylenders"). It says "lenders of Oruma".

### 4.3 Science openness (tech-tree "scope of thinking")
- tech-tree 3.5 replaces `−0.25·zeal·[state faith]` with `faithOpennessTerm = −0.25·zeal·[state faith]·(2 − 2·Inquiry_sf)·(1 − sec_p)`.
- `litFaith[p] = 0.06·Scripture_f·[printing]` is the scripture-reading channel to literacy (Becker & Woessmann 2009).
- Religiosity and patenting are negatively related across countries (Bénabou et al. 2022). Their three regimes (secularisation, theocratic stagnation, progress with stable religiosity) are a target for qualitative variety, not a number.

### 4.4 Tolerance: migration, riots, persecution
`faithTolerance(p)` = the Tolerance of the state faith (else the ruler's). Readers:
- migration-borders (refugee acceptance, border openness: their hook, in progress);
- riots (MinorityAttacked, persecution push, §0.2);
- `rulersStep` persecution (§3.4).

### 4.5 Legitimacy and clergy (court-politics, city-states, riots)
- The court clergy estate's `S_C` and Faith faction read `org_f`. That is the Hierarchy axis, so they follow drift without code changes [V court-politics 4.1].
- `faithLegitimacy(p) = 0.1·Hierarchy_sf·church·(1 − sec_p)` is added to riots' `L∞`. Religious authorities legitimising rulers is Rubin 2011's mechanism.
- city-states theocracy: the gate gains `× smoothstep(0.4, 0.7, Hierarchy_f)`. Their **Secularised (cause 11)** also fires when the theocracy's capital has `sec ≥ 0.5`: one more condition in their rule, with no new cause.

### 4.6 War
`holyDrive` is modulated by Martial and secularity (§3.4). `holyWarDeclared` keeps its zeal/piety thresholds. A Martial ≤ 0.2 faith's state never logs a holy war: one more condition.
External threat dampened intra-faith conflict in Iyigun's (2008) Ottoman–Reformation data. This is a known effect the plan does **not** add in v1 (open question).

---

## 5. Determinism

- **Stream.** `createRng(seed, 'history-religion-doctrine')` is created only when the plan is on. The existing `'history-religion'` stream keeps all its draws (founding traits, schism traits, conversion, adoption, persecution, schism chance).
  The doctrine stream draws in this fixed order within a year:
  1. creation: 11 draws per new faith (axes 3..13 ascending), at the point the faith is made (`newFaith` order);
  2. slowStep drift: living faiths ascending, axes 0..13, one draw each;
  3. orders: gated faiths ascending, one each;
  4. syncretism: gated towns in `s.living` order, one each, then 14 for the new faith;
  5. the Reformation proxy: gated realms in `ps.alive` order;
  6. disestablishment: gated realms in `ps.alive` order;
  7. schismStep (20 y): councils (faiths ascending, one each, plus one heresy draw); schism chance draws stay on rel.rng.
- **Off is bit-identical.** `HistoryOptions.religiousEvolution` (default `DOCTRINE.enabled` = false) leaves `rel.evo = null`. Every new branch is `rel.evo !== null ? new : old`.
  FaithFounded extra stays −1, the new History fields are empty arrays, and Faith's new fields are `doctrine: []`, `parent2: −1`, `splitAxis: −1`, `splitKind: 0`.
  `religion.test.ts`'s hashReligion covers only the old fields and events 89–97, so it is unchanged off. A new test asserts that the full-History hash with the option absent equals the hash with it false.
- **Golden hashes.** perf-efficiency's golden History hashes must filter events ≥ 410 and the new fields when the plan is on, or record on-hashes separately.
- **Prefix stability.** A 1200-year run equals the first 1200 years of a 1500-year run (all rules are causal; snapshots every 50 y).
- **Order kept inside rulersStep's loop.** d*_p is computed after conversion and adoption for that realm, so this year's change is seen next slow step. That gives no order dependence across realms.

## 6. Contract additions (`src/contract.ts`), drafted in the codebase style

```ts
  // religious evolution: doctrine, councils, reformations, orders, syncretism, secularisation (410-419; none when HistoryOptions.religiousEvolution is false).
  Reformation: 410, // faith `value` (History.faiths) broke from its parent in a reformation seated at `settlement`; `other` the movement (History.movements) that carried it, or -1; `extra` axis * 2 + 1 when it raised that DoctrineAxis, + 0 when it lowered it
  CouncilHeld: 411, // the clergy of faith `value` met at `settlement` (its patron's capital or its holy city) and fixed its teaching on DoctrineAxis `extra & 127` (bit 7: after a sign of the god); `other` the patron polity's capital, or -1
  OrderFounded: 412, // an order of faith `value` was founded at `settlement` vowing to the ascetic or mystic life; `extra` the FaithOrder (0 monastic, 1 mystic); `other` -1
  Syncretism: 413, // faith `value` grew up at `settlement` from the two faiths long followed there (History.faiths[value].parent and .parent2); `other` -1; `extra` -1
  Secularised: 414, // most of the people of the polity ruled from `settlement` came to keep no faith; `value` the polity; `extra` its state faith, or -1; `other` -1
  Revival: 415, // faith returned among the people of the polity ruled from `settlement` after hard times; `value` the polity; `extra` the RevivalCause; `other` -1
  Disestablished: 416, // faith `extra` ceased to be the state religion of the polity ruled from `settlement`, as most of its people kept no faith; `value` the polity; `other` -1
  DoctrineShift: 417, // faith `value`'s teaching on DoctrineAxis `extra >> 1` passed a band edge (bit 0: 1 rose, 0 fell) over the years; `settlement` its holy city (or stronghold); `other` -1

/** Axes of a faith's doctrine (History.doctrine, Faith.doctrine), each 0..1. The first three are the old traits zeal, organisation and appeal. */
export const DoctrineAxis = { Zeal: 0, Hierarchy: 1, Urbane: 2, Monotheism: 3, Scripture: 4, Ethics: 5, Ascetic: 6, Tolerance: 7, Eschaton: 8, Inquiry: 9, Usury: 10, Icons: 11, Martial: 12, Roles: 13 } as const
export type DoctrineAxis = (typeof DoctrineAxis)[keyof typeof DoctrineAxis]
export const DOCTRINE_AXIS_COUNT = 14
/** How a faith split from its parent (Faith.splitKind). */
export const SplitKind = { Realm: 0, Heresy: 1, Reformation: 2, Syncretic: 3, Divine: 4 } as const
export const FaithOrder = { Monastic: 0, Mystic: 1 } as const
export const RevivalCause = { War: 0, Disaster: 1, Hunger: 2, Plague: 3 } as const
/** Why a universal faith arose (the `extra` of FaithFounded when religious evolution is on; -1 otherwise). */
export const FoundingKind = { Crisis: 0, Affluence: 1, NewMovement: 2, Prophet: 3 } as const

// Faith gains (empty/-1 when religious evolution is off):
  /** Doctrine at the end of the history, DOCTRINE_AXIS_COUNT values 0..1 (History.doctrine has it over time); [] when off. */
  doctrine: number[]
  /** Second parent of a syncretic faith, -1. Always lower than id. */
  parent2: number
  /** DoctrineAxis its split was over (schisms, reformations, heresies), -1. */
  splitAxis: number
  /** SplitKind (0 for a root faith). */
  splitKind: SplitKind

// History gains:
  /** religious evolution: doctrine of every faith every `every` years: values[(q * faiths + f) * 14 + a], 0..250 for 0..1, 255 before the faith existed. Empty when off. */
  doctrine: { every: number; count: number; faiths: number; values: Uint8Array }
  /** religious evolution: share of each settlement's people that keep no faith, every History.doctrine.every years, 0..255 (same settlement layout as `faith`). Empty when off. */
  secularShare: Uint8Array

// HistoryOptions gains:
  /** religious evolution: doctrines that drift and split along their tensions, councils, reformations, orders, syncretism, secularisation and revival (needs religion). Default false until calibrated; false leaves its fields empty and every other field bit-identical. */
  religiousEvolution?: boolean
```

State (`religion/state.ts`), one object `rel.evo: DoctrineState | null`, created in `createReligionSystem` when on:
`rng; doc: Float32Array(Fcap·11); fix: Float32Array(Fcap); band: Uint8Array(Fcap·14); lastCouncil, orderYear: Int32Array(Fcap); parent2, splitAxis, splitKind: number[];`
`dvAcc, dvTot: Float32Array(Fcap·14); sec: Float32Array(cap); mixSince: Int32Array(cap); secR: Float32Array(pcap·3); dstar: Float32Array(pcap·14); snDoc: Uint8Array; snSec: Uint8Array; diag`.
Grown by the existing `ensureReligionSettlements` / `ensureReligionPolities`, with faith capacity doubling in `newFaith`.

## 7. Stats harness and targets (`src/sim/history/religion/doctrineStats.ts`; seeds 1, 7, 42, 1234; 2000 years; A/B vs off; also realismStats `--opts '{"religiousEvolution":true}'`)

| metric | baseline [M] | target | basis |
|---|---|---|---|
| top family share at 2000 (follower-weighted) | 0.39 / 0.91 / 0.86 / 0.92 | 0.25–0.45 on ≥ 3 of 4 | Christianity 31.5% (Pew 2012 via realism-metrics §2.5) |
| families ≥ 5% at 2000 | 2 / 1 / 2 / 1 | 3–6 | Pew 2012: four traditions ≥ 5% plus folk 5.9% |
| realism `faith2000.top1/top4` | 2/4, 3/4 in band | ≥ 3/4 each; no row WORSE; score +≤ 0.03 | realism-metrics guard |
| schisms per run (all kinds) | 2–4 | 4–10 | [D] (a few great splits per tradition) |
| Reformations: share after the seceders' people print | n/a (4 of 7 schisms pre-print) | ≥ 80% of `splitKind = Reformation`; ≥ 1 within 150 y of a state-church realm's first printing, on ≥ 2 of the 3 printing seeds | Rubin 2014 |
| councils per run | 0 | 1–6 | [D] |
| foundings in affluent towns (aff ≥ 0.5) | not measured | ≥ 60% | Baumard et al. 2015 |
| unaffiliated share, worlds without lit ≥ 0.25 anywhere | 0 | exactly 0 | design (security gate) |
| unaffiliated share at 2000, worlds with mass schooling | 0 | 0.08–0.30 world; ≥ 0.5 in the most secure realm | Pew 2012 unaffiliated 16.3% |
| Revival after a ≥ 0.2 drop in S | n/a | sec falls ≥ 0.1 within 30 y in ≥ 70% of cases | Bentzen 2019 |
| mean doctrine change per axis per 500 y | 0 | 0.05–0.25; no axis pinned at 0/1 for > 30% of faith-years | [D] |
| DoctrineShift events per faith-millennium | 0 | 1–5 | [D] |
| folk share at 2000 | 0.08–0.24 | 0.04–0.15 | Pew 2012 folk 5.9% |
| religion runtime | ~0.9 s / 51 s (seed 42, one run) | ≤ +0.3 s | perf |

Report unscored: the doctrine radar of the 3 largest faiths at 500-y steps; the split axes histogram; worlds that never secularise (count).

## 8. UI and prose (extends the existing Faiths panel, Faiths view, chronicle and sagas; no new panel)

- **Doctrine radar** in the Faiths panel's selected-faith detail (`ui/faithsPanel.ts`, `ui/faithsData.ts` gains `doctrineAt(fd, f, year)`, `secularAt(fd, id, year)`).
  It is a 14-spoke SVG with neutral two-ended labels (§3.1). It draws a solid polygon at the cursor year, a ghost at founding and a dashed parent polygon.
  The axis whose band changed most recently is highlighted with a one-line "why": the largest d* term, e.g. "literate towns that print". *Why not a new panel:* it is a detail of the faith already selected there.
- **Family tree with drift** (the existing `fa-tree` block, l.444–458). Rows gain a time axis (x = year, a branch at each foundedYear).
  Each edge is coloured by `dist(child, parent)` at the split. Its label is the split axis in plain words ("split over images", "a reformation over scripture"). Syncretic faiths get a dashed second edge to parent2. Council marks are small ticks on the line.
- **Faiths view**: a toggle "Keep no faith" shades land by `secularShare` (grey), drawn over the majority colour. It is the same ViewMode (*why not new:* it is a layer of faith).
- **Chronicle** (`ui/polityFormat.ts describeV2`, `historyIndex.ts`, filter group "Faith"; hedged register):
  - Reformation: "In 1712, it is recorded, reformers in Vashtar broke with the Ashai priesthood over the reading of the scriptures; the new Ulmic church took the realm's temples."
  - CouncilHeld: "In 1104 the priests of the Ashai faith met at Oruma under the king of Vashtar and settled what was to be taught about images; those of Tarsk, it seems, would not agree."
  - OrderFounded: "Around 1020 a house of the Ashai at Kesh vowed itself to poverty, and others took up its rule."
  - Syncretism: "By 1390 a new teaching had grown up in Kesh, where the Ashai and the Ulmic faiths had long lived side by side."
  - Secularised: "By 1960 most people in Vashtar, it appears, no longer kept any faith."
  - Revival: "After the war of 1984 the temples of Vashtar were full again."
  - Disestablished: "In 1921 the Ashai faith ceased to be the faith of the Vashtar state."
  - DoctrineShift: "Over the centuries the Ashai came to forbid images in their temples."
- **Sagas** (`ui/sagas/voice.ts` tables; keys added to world.ts, year.ts, city.ts and people.ts, which already tell FaithFounded and Schism [V]). Each key has [chronicle] and [legend] variants:
  - reformation, legend: "In 1712 the word was loosed from the priests' hands; Vashtar read for itself, and the old altars went cold."
  - council, legend: "At Oruma the many voices of the Ashai were made one, and Tarsk, unbending, was cast out."
  - syncretism, legend: "In Kesh two rivers of faith met, and from their meeting rose a third."
  - secular, legend: "In Vashtar the gods fell silent, not in wrath but in a long forgetting."
  - revival, legend: "When the fires came, Vashtar remembered its gods."
- **Respect rules** (tests enforce them):
  - Only in-world faith names appear (existing `nameFaiths`).
  - Phrase tables, axis labels and tooltips must not contain real-world religion or denomination names. A denylist test lists the major religions, denominations and figures.
  - Axis words are descriptive, never evaluative ("forbids images", never "backward"). A fundamentalist movement is "a movement to return to the strict ways".
  - Doctrine is never tied to a people's character in prose. No lender-by-faith wording (§4.2).
  - Historical analogues appear only in this plan's grounding, never in the UI.

## 9. Ordered commit-sized steps (files; tests)

1. **Contract and option** (§6): enums, events 410–419 in the EventType list, Faith fields, History fields (empty), `HistoryOptions.religiousEvolution`, `DOCTRINE.enabled = false`. index.ts creates nothing.
   Tests: off hash == absent hash; shapes are empty.
2. **State, params, doctrine stream, initial doctrine** (`religion/state.ts`, `params.ts`, new `religion/doctrine.ts`; `newFaith` calls `initDoctrine`). Assembly and snapshots (`assemble.ts`, `religionSnapshot` every 50 y).
   Tests: bounds [0,1]; arrays own buffers; prefix stability; determinism (two runs equal).
3. **Desired doctrine and drift** (inside `rulersStep`'s realm loop; `driftStep` after it) plus DoctrineShift.
   Tests: a faith in a literate printing realm gains Scripture; a faith alone in no realm drifts by noise only; the hysteresis gives no event flapping.
4. **Modulations** (§3.4): `fitOf` distance, persecution, grievance, holy drive, rivalry, ideas resistance.
   Tests: with every axis at 0.5 and sec 0, the results of these functions equal the old ones (unit, stubbed state).
5. **Tension schisms and councils** (`schismStep`/`schism` extended; CouncilHeld; heresy).
   Tests: splitAxis set on every schism when on; the child moved along a*; councils raise fix and lower T.
6. **Reformation**: the proxy path first, then the riots hook functions (`religionReformation`, `religionReformFailed`, `reformProgramme`); counter-reformation.
   Tests: no Reformation where printing is unheld (proxy); a Reformation sets state church and logs 92 + 410.
7. **Orders and the landmarks monastery gate** (landmarks/system.ts l.542 condition).
   Tests: OrderFounded only for faiths ≥ 200 y; the monastery gate is unchanged when off.
8. **Syncretism** (`mixSince`, parent2).
   Tests: parent2 < id; at most one per 100 y.
9. **Secularisation, revival, disestablishment, NRMs** (§3.8, foundStep NRM branch).
   Tests: sec ≡ 0 where lit < 0.25 (stubbed); a shock lowers sec within 2 steps; Disestablished sets state −1.
10. **Cross-system hooks** (§4), each guarded and each a one-line call: tech-tree openness/litFaith, finances rateMul, families lend capacity, demography fertility, court/riots legitimacy, city-states theocracy, migration tolerance, riots MinorityAttacked.
    Tests: neutral at 0.5 axes; off unchanged.
11. **UI**: faithsData accessors, radar, tree time axis, Faiths-view toggle, chronicle lines, saga keys, denylist test.
12. **Stats harness and calibration** (`doctrineStats.ts`; realismStats A/B). Recalibrate `RELIGION.rate`/`bandwagon` under the distance term, then flip `DOCTRINE.enabled` only after the §7 targets and the realism guard pass.

## 10. Performance and memory [A, from the measured baseline]

- **Per slowStep (10 y).** d*_p is a few adds per member inside rulersStep's existing loop: O(S). Drift and tension are O(P_realms·F_live·14) ≈ 300·30·14 ≈ 1.3e5 flops.
  The F×F distance table is ≤ 30²·5. Secularity is O(S) per step with ~3–8 k living towns. Syncretism scans towns once per slowStep.
  The estimated total is ≤ 15% of the current religion cost (~0.9 s/run [M]), about +0.15 s per 2000-y run (~0.3% of 51 s).
- **Memory.** State: doc 250·11·4 = 11 KB worst; dv arrays 28 KB; sec and mixSince 8 B per settlement (64 KB at 8 k); per realm 68 B.
  History: doctrine 40 snaps × F × 14 B ≈ 11 KB at F = 20 (140 KB at the 250 cap); secularShare 40 × S ≈ 320 KB at S = 8 k (a 50-y cadence, not 5-y: 10× smaller than `faithShare`).

## 11. Risks and open questions

**Risks**
- **Knob count.** 14 axes and their d* formulas risk overfitting. Mitigations: linear d* with sourced signs; calibrate only `rate`, `capital`, the tension band and `tau*`; report, not tune, the rest.
- **Schism storms.** With tension, schisms could cascade. The existing 250-y gap per lineage, the per-faith-lineage gap for heresies and the 250-faith/Uint8 cap [V FOUNDING.max] bound them. The stats harness caps schisms at 10 per run.
- **Spread slowdown from conversion distance.** If `RELIGION.rate` is not recalibrated, more folk practice survives (folk share up) and realism faith rows could get WORSE. Step 12 gates the default on that.
- **Secularisation never triggers in v1.** Without tech-tree's literacy (the proxy caps at ~0.12), no world reaches the gate. That is the honest result for a pre-modern world, but it leaves §3.8 untested on default worlds.
  Tests use stubs. The harness reports it as "not reached".
- **Dependency web.** Six optional plans are unbuilt. Each hook is a guarded one-liner with a neutral default.
- **Sensitive content.** Real-world parallels in prose; stereotypes (lenders, "fanatics"). The respect rules and denylist test in §8 address them.
- **Cross-plan conflicts.** OrderKind/DecisionKind numbers are provisional (the registry has overlapping claims by future-politics, tech-tree and character-mode). future-politics' OracleSee schism hazard should call `schism()` and thus get a splitAxis (Inquiry).

**Open questions**
1. Should external threat (another faith's holy war) suppress intra-family schism and war (Iyigun 2008)? It is not in v1.
2. Should Zeal (axis 0) be split into proselytism and intolerance? v1 keeps one axis plus the new Tolerance, to preserve every existing reader.
3. Secular share per realm per 5-y snapshot as well (120 KB) for the polity panel sparkline, or derive it from the 50-y settlement table?
4. Should DoctrineShift feed language-drift's naming (a reformed faith renamed)? Not in v1.
5. Do the Axial targets need a "world era" notion? The sim's years are not calendar years. The affluence share target sidesteps this.

**Verified [V]**
- religion code paths and line numbers in §1;
- the landmarks rededication rule (l.626) and monastery gate (l.542);
- ideas `printing` (params l.352) and R_FAITH resistance (system l.375);
- the contract Faith record (l.988–1010), religion events 89–97 (l.189–198) and HistoryOptions.religion (l.1435);
- riots' movement table, Reform gate and Tolerate order (riots §0.6, 0.7, 4.8);
- court clergy estate reads `org_f` (court §4.1); city-states Secularised cause 11; tech-tree openness formula (§3.5) and literacy targets (§4.8); society API (§0.4).

**Measured [M]**: §2 tables (probe-religion.ts and perf-rel.ts on seeds 1, 7, 42, 1234).

**Assumed [A]**: perf estimate; that riots' Triumph hook can call into religion without an import cycle (put the hooks in `religion/hooks.ts` like `religionPlague`); the Council of Trent framing of internal reform.

## References

- Almond, G. A., Appleby, R. S. & Sivan, E. (2003). *Strong Religion: The Rise of Fundamentalisms around the World*. University of Chicago Press. ISBN 9780226014975. https://divinity.uchicago.edu/sightings/articles/strong-religion-martin-e-marty [verified: publisher and authorship confirmed via a Sightings review; the "reaction to modernity" framing is not stated on that page, so that claim is unverified detail]
- Baumard, N., Hyafil, A., Morris, I. & Boyer, P. (2015). Increased affluence explains the emergence of ascetic wisdoms and moralizing religions. *Current Biology* 25(1):10–15. doi:10.1016/j.cub.2014.10.063 [verified]
- Becker, S. O. & Woessmann, L. (2009). Was Weber Wrong? A Human Capital Theory of Protestant Economic History. *Quarterly Journal of Economics* 124(2):531–596. doi:10.1162/qjec.2009.124.2.531 [verified]
- Bellah, R. N. & Joas, H. (eds.) (2012). *The Axial Age and Its Consequences*. Harvard University Press. doi:10.4159/harvard.9780674067400 [verified]
- Bénabou, R., Ticchi, D. & Vindigni, A. (2022). Forbidden Fruits: The Political Economy of Science, Religion, and Growth. *Review of Economic Studies* 89(4):1785–1832. doi:10.1093/restud/rdab069 [verified]
- Bentzen, J. S. (2019). Acts of God? Religiosity and Natural Disasters Across Subnational World Districts. *Economic Journal* 129(622):2295–2321. doi:10.1093/ej/uez008 [verified]
- Berger, P. L. (ed.) (1999). *The Desecularization of the World: Resurgent Religion and World Politics*. Ethics and Public Policy Center / Eerdmans. OCLC 41445734, https://search.worldcat.org/oclc/41445734 [verified: title, year and publisher; the WorldCat page does not name the editor, so Berger as editor is from the Barnes & Noble listing title only]
- Britannica. First Council of Nicaea (325). https://www.britannica.com/event/First-Council-of-Nicaea-325 [verified]
- Britannica. Cluny Abbey (founded 910). https://www.britannica.com/place/Cluny-Abbey [verified]
- Bruce, S. (2002). *God is Dead: Secularization in the West*. Blackwell (Wiley). ISBN 978-0-631-23275-9. https://www.wiley-vch.de/en/areas-interest/humanities-social-sciences/god-is-dead-978-0-631-23275-9 [verified]
- Chaves, M. & Gorski, P. S. (2001). Religious Pluralism and Religious Participation. *Annual Review of Sociology* 27:261–281. doi:10.1146/annurev.soc.27.1.261 [verified]
- Emerson, M. O. & Hartman, D. (2006). The Rise of Religious Fundamentalism. *Annual Review of Sociology* 32. doi:10.1146/annurev.soc.32.061604.123141 [verified: the abstract was fetched; it reviews fundamentalism's relation to modernity. The page did not show authors, volume or pages, so those are from the search listing]
- Gill, A. & Lundsgaarde, E. (2004). State Welfare Spending and Religiosity: A Cross-National Analysis. *Rationality and Society* 16(4):399–436. doi:10.1177/1043463104046694 [verified]
- Iannaccone, L. R. (1994). Why Strict Churches Are Strong. *American Journal of Sociology* 99(5):1180–1211. doi:10.1086/230409 [unverified: the publisher page is paywalled; the DOI and title were confirmed, but the abstract, volume and pages were not; an NBER paper fetched cites "Iannaccone's (1994) insight that stricter religious groups are more efficient"]
- Iyigun, M. (2008). Luther and Suleyman. *Quarterly Journal of Economics* 123(4):1465–1494. doi:10.1162/qjec.2008.123.4.1465 [verified]
- Jaspers, K. (1949). *Vom Ursprung und Ziel der Geschichte* (Eng. *The Origin and Goal of History*, 1953). https://www.britannica.com/topic/The-Origin-and-Goal-of-History [verified: the axial period 800–200 BC]
- Johnson, B. (1963). On Church and Sect. *American Sociological Review* 28:539–549. https://hirr.hartfordinternational.edu/articles/4377/ [verified: the reference only; not used for a number]
- Kaufmann, E. (2010). *Shall the Religious Inherit the Earth? Demography and Politics in the Twenty-First Century*. Profile Books. ISBN 9781847651945. https://profilebooks.com/work/shall-the-religious-inherit-the-earth/ [verified]
- Mullins, D. A., Hoyer, D., Collins, C., Currie, T., Feeney, K., François, P., Savage, P. E., Whitehouse, H. & Turchin, P. (2018). A systematic assessment of "Axial Age" proposals using global comparative historical evidence. *American Sociological Review* 83(3):596–626. doi:10.1177/0003122418772567 [verified]
- Norenzayan, A. (2013). *Big Gods: How Religion Transformed Cooperation and Conflict*. Princeton University Press. https://press.princeton.edu/node/13297 [verified]
- Norris, P. & Inglehart, R. (2004). *Sacred and Secular: Religion and Politics Worldwide*. Cambridge University Press. doi:10.1017/CBO9780511791017 [verified]
- Pew Research Center (2012). *The Global Religious Landscape* (as used by realism-metrics.md §2.5). [verified there, not re-fetched here]
- Pew Research Center (2015). *The Future of World Religions: Population Growth Projections, 2010–2050*, "Main factors driving population growth" (TFR by religion). https://www.pewresearch.org/religion/2015/04/02/main-factors-driving-population-growth/ [verified: Muslims 3.1, Christians 2.7, world 2.5, Hindus 2.4, Jews 2.3, folk 1.8, unaffiliated 1.7, Buddhists 1.6]
- Rubin, J. (2011). Institutions, the Rise of Commerce and the Persistence of Laws: Interest Restrictions in Islam and Christianity. *Economic Journal* 121(557):1310–1339. doi:10.1111/j.1468-0297.2011.02456.x [verified]
- Rubin, J. (2014). Printing and Protestants: An Empirical Test of the Role of Printing in the Reformation. *Review of Economics and Statistics* 96(2):270–286. doi:10.1162/REST_a_00368 [verified: a press by 1500 means ≥ 29 pp more likely Protestant by 1600]
- Shaw, R. & Stewart, C. (eds.) (1994). *Syncretism/Anti-Syncretism: The Politics of Religious Synthesis*. Routledge. ISBN 9780415111171. https://www.routledge.com/products/9780415111164 [verified]
- Sibley, C. G. & Bulbulia, J. (2012). Faith after an Earthquake: A Longitudinal Study of Religion and Perceived Health before and after the 2011 Christchurch New Zealand Earthquake. *PLoS ONE* 7(12):e49648. doi:10.1371/journal.pone.0049648 [verified]
- Sosis, R. & Bressler, E. R. (2003). Cooperation and Commune Longevity: A Test of the Costly Signaling Theory of Religion. *Cross-Cultural Research* 37(2):211–239. doi:10.1177/1069397103037002003 [verified]
- Stark, R. & Bainbridge, W. S. (1985). *The Future of Religion: Secularization, Revival, and Cult Formation*. University of California Press (paperback 1986, ISBN 9780520057319). https://www.ucpress.edu/books/the-future-of-religion/paper [verified: the book and its framing; "cults form where conventional faith is weak" is unverified detail]
- Stark, R. & Finke, R. (2000). *Acts of Faith: Explaining the Human Side of Religion*. University of California Press. ISBN 9780520222021. https://www.ucpress.edu/books/acts-of-faith/paper [verified: religious economy / rational choice. The religious-capital conversion proposition is verified only via the secondary summary https://en.wikipedia.org/wiki/Religious_capital]
- Voas, D. & Chaves, M. (2016). Is the United States a Counterexample to the Secularization Thesis? *American Journal of Sociology* 121(5):1517–1556. https://hdl.handle.net/10161/11708 [verified: bibliographic details on Scholars@Duke; the cohort-replacement finding via the authors' LSE blog summary, https://blogs.lse.ac.uk/usappblog/2016/09/05/religion-is-in-decline-in-the-west-and-america-is-no-exception]
- Watts, J., Greenhill, S. J., Atkinson, Q. D., Currie, T. E., Bulbulia, J. & Gray, R. D. (2015). Broad supernatural punishment but not moralizing high gods precede the evolution of political complexity in Austronesia. *Proceedings of the Royal Society B* 282:20142556. doi:10.1098/rspb.2014.2556 [verified]
- Weber, M. (1904–05). *Die protestantische Ethik und der Geist des Kapitalismus*. https://www.britannica.com/topic/The-Protestant-Ethic-and-the-Spirit-of-Capitalism [verified]. Used only as the thesis Becker & Woessmann (2009) re-examine through the literacy channel; the plan models literacy, not a work ethic.
- Whitehouse, H., François, P., Savage, P. E. et al. (2019). Complex societies precede moralizing gods throughout world history. *Nature* (doi:10.1038/s41586-019-1043-4) — **retracted** 2021 (Nature 595:320, doi:10.1038/s41586-021-03656-3) after Beheim et al. showed missing data had been coded as absence. https://www.nature.com/articles/s41586-021-03656-3 [verified]. **Not used for any number.** The "moralising gods follow complexity" sign rests on Watts et al. 2015 and Norenzayan 2013, and the debate is flagged.

**Debated, flagged in the text**: the Axial Age as a period (Mullins et al. 2018); Whitehouse et al. 2019 (retracted); the supply-side pluralism → participation claim (Chaves & Gorski 2001 vs Stark & Finke 2000); secularisation vs desecularisation (Bruce 2002; Norris & Inglehart 2004 vs Berger 1999; Stark & Bainbridge 1985); Weber's work-ethic channel vs the literacy channel (Becker & Woessmann 2009).

## Addendum (central registry)
Final values: OrderKind 83 = Council, seat DecisionKind 54 = Doctrine (all earlier overlaps were resolved: tech-tree 39–40, character 41–58, migration 59–61, modern-ideologies 62–64, future-politics 65–66, infrastructure 68–70, divine 71–82). See _CONVENTIONS.md.

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **R15.** `prestigeOf(s, p)` comes from migration-borders (Π_p). culture-soft-power is not written.
- **R16.** `faithFertility` multiplies future-tech's fertility slot `F_p` (C5). It is therefore **dormant unless future (or a later demography plan) is on**. Pre-modern runs do not change growth.
- **C9.** `usuryRate` is a factor of the borrowing-rate stack, clamped with the others. `faithLegitimacy` adds to riots' L∞ hook only.


## Addendum (barriers & cold war)
Overrides the body and earlier addenda where they differ. Source of truth: barriers-coldwar.md (formulas, params, ids).
- **New stack C13, faith exposure** (`exposeFrom` w), owner you. The clamp is [0.3, 1.5]. Factors, in order:
  1. your `(1 − sec_i)` (moved from inline);
  2. barriers `(0.7 + 0.3·max(e_mass, I(L_town, L_f)))/ē`, where L_f is the faith's frozen liturgical language
     (mean-preserving, B-R5).
- A faith's liturgical language can be a polity's lingua franca (source Faith, barriers §2.2).
