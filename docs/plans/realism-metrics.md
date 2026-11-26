# Realism metrics: a harness that measures how much a run looks like real history

Target: worldseed at commit 8cabf09. This is a plan. The repo is not changed. Unlike the other plans, this one has
already **measured** the current sim: a first version of the harness ran in `/home/claude/scratch-realism`.

Tags: **[V]** verified in code or a source, **[M]** measured here, **[A]** assumed or a judgement call. **[R]** marks a
literature number I recalled but could not fetch and check this session. Treat [R] numbers as approximate.

Scripts (drop-in, already type-checked against 8cabf09 with `npx tsc --noEmit`, tests pass):
- `/home/claude/plans/realism-scripts/realismFit.ts`: pure estimators (CSN power law, Vuong LR, Hill, GI rank-size, OLS, PPML, censored exponential, Spearman).
- `/home/claude/plans/realism-scripts/realismFit.test.ts`: 4 vitest cases that recover known parameters from synthetic draws (pass, 1.7 s).
- `/home/claude/plans/realism-scripts/realismStats.ts`: the harness (target table, realism score, `--json`, `--from`, `--vs` A/B, `--opts`, `--boot`).
- `/home/claude/plans/realism-scripts/sweep.sh`: parallel seed sweep (JSON rows, then the aggregate table).
- Raw results: `main4.jsonl` / `main4.log` (seeds 1, 7, 42 and 1234, 100 bootstrap replicates), `sweep.jsonl` / `sweep.log` (18 more seeds, no bootstrap),
  `all22.jsonl` / `all22.log` / `all22-extra.log` (all 22 seeds pooled).

Dependencies: none. The harness only reads `History`, so it works on 8cabf09 today and on every later plan. It adds no
EventTypes, no RNG stream, no HistoryOptions toggle and no contract fields. The interfaces section (7) lists the optional
contract additions that would make a few metrics sharper.

---

## 0. Summary of the baseline [M]

Results over the 4 named seeds and a 22-seed sweep (HISTORY_STATS_SEEDS plus 7 and 1234). The realism score is the mean miss,
in band widths, capped at 2. On the 4 seeds it is **0.404** (45 of 104 seed×target cells in range). Over 22 seeds it is
**0.421** (212 of 572).

| regularity | real world | worldseed now (median of 22 seeds; 4-seed values) | verdict |
|---|---|---|---|
| Zipf ζ (CCDF slope), towns, year 2000 | ≈ 1.0 | CSN 0.85 (1.08 / 0.78 / 0.99 / 0.74); Hill above 1,000 people **0.995**, 22/22 seeds in 0.8–1.25 | **good late** |
| Zipf ζ, years 1000 and 1500 | ≈ 1 (pre-modern often flatter) [R] | 1000: **1.61** (1.80 / 1.87 / 2.24 / 1.61); 1500: 1.14 | too steep early: no big early cities |
| Primacy (largest / 2nd) at 2000 | 2 (Zipf) | 1.25 | weak primate cities |
| Gibrat β (50-year log growth on log size) | ≈ 0 | +0.008 (1500–2000), +0.018 (1000–1500); σ of growth falls slightly with size | **good** |
| War severity α (pdf), CSN | 1.53 ± 0.07 | **2.18** (2.32 / 1.88 / 1.91 / 2.26); seed 7 favours lognormal (p 0.01) | tail too thin |
| War duration CV (exponential = 1) | ≈ 1 [A] | **0.53**; mean 8.1 years, median 7, max 20 | too regular |
| War onset dispersion (Poisson = 1) | ≈ 1 | 1.72 | onsets too clustered |
| Kingdom+ lifespan, censored exponential mean | ~220 years | **517 years** (median 145); CV 0.85 | too long-lived |
| Empire-tier states that ever end | most do | **0–1 of 3–8 per seed** | empires effectively immortal |
| Largest state's share of world people at 1500 / 2000 | ≈30–37% at peaks (Rome 30, Han 32, Qing 37; corrected from 25–35%) | 0.16 / 0.15 | low-ish (half the seeds in range) |
| Largest state's share of land at 2000 | 16–24% at peaks (Mongol, British; Taagepera via Wikipedia) | 0.11 | ok |
| Top faith share at 2000 | 31.5% (Pew 2012) [R, unverified] | 0.23, bimodal (0.23 / **0.69** / **0.65** / 0.36) | monolithic on half the seeds |
| Worst epidemic, deaths / network | Black Death 30–60% (corrected from 30–50%) | **0.13** (0.19 / 0.12 / 0.10 / 0.10) | no Black Death |
| Worst 50-year world population fall | ~15–25% (14th c. Eurasia) [R] | 0.055 | too gentle |
| ≥10k share at 2000 (sim's town includes its farmland) | ≤ 10–15% pre-industrial | **0.38** | over-urbanised, or a definitional caveat (2.7) |
| Gravity distance elasticity (PPML, routes, 2000) | −0.91 mean, −0.87 median | −0.48 (OLS −0.72); mass +0.55 | distance matters too little (partly circular, 2.6) |

The 4-seed table (realismStats.ts, `--boot 100`) is reproduced in section 4.

---

## 1. What the sim does now (relevant mechanisms)

- **Data available.** All metrics come from `History` (contract.ts 253–556) [V]. Sources: `population` per 5-year snapshot per settlement; `settlements[].outpost`;
  `wars` (struct-of-arrays: kind, startYear, endYear, `dead`); `polities` (foundedYear, endedYear); `polity` per snapshot
  per settlement; `territory` per 20-year land snapshot (owner settlement + 1) with `landCells`; `faith`/`faithShare` per snapshot
  (majority only); `epidemics` (deaths, network) and `outbreaks` (mortality byte); `trade` (a, b) plus `tradeVolume`
  per 10-year trade snapshot; `longHaul` plus `longHaulVolume`; `w.grid.positions` (unit sphere; goodsStats.ts uses chord × 6371 km).
- **Settlement = town + its farmland.** population.ts 3–12: each settlement claims and farms its catchment, so `population`
  counts the farmers of the hinterland [V]. "Share in places ≥ 10,000" is therefore not urbanisation in de Vries' sense. See 2.7.
- **Growth** is logistic toward food supply: `pop += growth·p·(1 − p/sup)` (population.ts 186–195) [V]. On its own that
  would give mean reversion (anti-Gibrat). Supply also grows with technology, trade and wealth, and migration moves people.
  The measured β ≈ 0 says these balance (4.2) [M].
- **Trade partners are gravity-chosen**: every trader keeps `TRADE.nearest = 2` cheapest partners and `TRADE.gravity = 1` partner
  with the best `pop / cost²` (trade.ts 680–692, params.ts 672–675) [V]. Flows then follow price gaps net of transport cost
  (trade.ts header 32–40) [V]. So which routes exist is gravity by construction (mass exponent 1, cost exponent −2). The volume
  on an open route is not set by a gravity formula, but distance enters it through transport cost and mass through need ∝ pop.
- **War deaths**: each war-year of battle kills `WAR.battle = 0.02` of both front towns (polity/war.ts 340–362). A sack kills
  `sackPop = 0.12` of the town, with chance `sack = 0.35` (doubled for a foreign capture of a capital) (war.ts 252–265,
  polity/params.ts 141–151) [V]. Deaths are therefore ≈ Σ over war-years of 0.02 × front town sizes. A war's severity is
  roughly a sum of a few draws from the town-size distribution, whose pdf exponent is ζ + 1 ≈ 2. That matches the measured
  war α ≈ 2.2 [M + A: the mechanism is my reading, not a test].
- **War ends**: exhaustion grows by `perYear = 0.08` per war-year plus `deaths·dead/pop`. Peace comes at exhaustion ≥ 1, or
  by a yearly chance `peaceChance = 0.08` after `peaceAfter = 5` years, and not while winning (polity/war.ts 380, 413;
  params.ts 170–183) [V]. Durations are therefore bunched at about 5–13 years. That fits the measured CV of 0.53 and median of 7 [M].
- **Polity tiers** (tierOf, polity/state.ts 774–781): Empire needs ≥ max(20,000, 8% of W). The harness copies this rule but
  drops the multi-people clause [A: undercounts a few empires].
- **Epidemic toll** = mortality × attack(pop) × susceptible × virgin(1.4) × famine term, capped at maxToll
  (disease/params.ts 63; system.ts 139, 487) [V]. Plague mortality is 0.46 and attack 0.85 (params.ts 39), so a single
  outbreak tops out near 0.4 (measured max 0.30–0.45) [M]. `EpidemicInfo.network` is the people of every people it reached,
  counted when first reached (contract.ts 798–818). Deaths/network is therefore the "Europe-wide" share.

---

## 2. Empirical targets (with sources and how far to trust them)

Each target band is wider than the literature point. The sim is a 2000-year world of 0.4–1.0 M people, starting from
tribes [M], so it is compared with pre-modern regularities where those differ from modern ones.

### 2.1 Zipf / rank-size of town populations
- Estimator: **continuous power-law MLE above xmin, xmin by KS minimisation (Clauset, Shalizi & Newman 2009)**, ζ = α − 1.
  A semi-parametric bootstrap p tests goodness of fit; p ≤ 0.1 rejects. Vuong (1989) LR tests compare against the truncated
  lognormal and exponential. Also reported, **as cross-checks only**: Hill (1975) at a fixed xmin of 1,000 people (comparable
  across seeds), and the Gabaix & Ibragimov (2011) OLS of ln(rank − ½) on the top 50. OLS on the log-log plot is not used:
  it is biased and its standard errors are wrong (CSN 2009 §3; Gabaix & Ibragimov 2011, whose abstract states the
  small-sample bias) [V for both].
- Target: ζ ∈ **[0.8, 1.25]** per era from 1500 on. The band is a **design default**. Sources: Gabaix (1999) states Zipf's
  law as N(>S) ∝ 1/S, i.e. ζ = 1, "for most countries" [V]. The "≈ 1.0 for US metro areas" estimate is [R]. Soo (2005)
  tested 73 countries and rejected Zipf in 53 by OLS and 30 by Hill; the OLS exponents are roughly normal and the Hill
  exponents bimodal [V]. Its "cross-country OLS mean ~1.1" is [R]: the abstract gives no mean. Pre-modern urban systems are often
  flatter at the top or "convex". I flag this as [A], so earlier eras are reported but not scored. Primacy (largest / second):
  Zipf predicts 2, and the band is [1.3, 4] because primate capitals are common [A].

### 2.2 Gibrat's law
- 50-year log growth of towns ≥ 1,000 people, demeaned per window, regressed on log size per era. Target β ∈ **[−0.06, 0.03]**.
  The band is a **design default**. Eeckhout (2004) finds proportionate (Gibrat) growth for all US places in Census 2000,
  with a full size distribution that is lognormal rather than Pareto [V]. The law is named after Gibrat (1931) [R]. Mild mean reversion is common in historical panels [A]. The
  harness also reports σ(growth) for small and large terciles (Gibrat: equal; firm and city data usually show σ falling with
  size [R]) and the exit rate.

### 2.3 Richardson's law: war severity, duration and onsets
- Severity: CSN fit on `wars.dead`. **Clauset (2018, Sci. Adv. 4:eaao3580): α̂ = 1.53 ± 0.07, x̂min = 7,061 battle deaths, 51 wars
  in the tail of interstate wars 1823–2003, p_KS = 0.78 ± 0.03** [V, re-fetched 2026-11-26, Europe PMC full text].
  **Cederman (2003, APSR 97:135–150): CCDF slope −0.41** on COW interstate wars 1820–1997. The citation was re-verified (it
  is Clauset 2018's ref. 6), but the −0.41 slope was **not re-checked** in this audit because the APSR page failed to load.
  These agree: pdf α ≈ 1 + 0.41 to 1.53. Richardson (1948, JASA 43:523–546; 1960, *Statistics of Deadly Quarrels*) is the
  original [V, via Clauset 2018's references]. Target
  α ∈ **[1.3, 1.9]**. The sim's absolute scale (deaths of hundreds to thousands) is not comparable, so only the exponent is scored.
  The largest war's share of world people is scored loosely in [0.5%, 5%] (WWII: 60–75 M dead, about 3% of the 1940 world
  population of 2.3 bn, per Wikipedia [V]).
- Onsets: Clauset (2018) finds delays between onsets geometric (q̂ = 0.428 ± 0.002, p_KS = 0.13), as a Poisson process
  counted by year implies [V, re-fetched]. The target band is a **design default**. Scored as variance/mean of onsets per decade ∈ **[0.6, 1.6]**.
- Durations: Richardson-style results put war durations near exponential [A/R: the fit is weaker than for severity]. Scored as
  CV of ended wars' durations ∈ **[0.7, 1.4]**. The censored exponential mean is reported unscored.

### 2.4 Polity lifespans and sizes (Arbesman, Taagepera)
- **Arbesman (2011, Historical Methods 44(3):127–129)**: 41 empires, 3000 BCE–600 CE, lifetimes from Taagepera (1978, 1979).
  They fit an exponential with λ = 0.46 per century, **mean ≈ 220 years**. This was [V, fetched] in the earlier session.
  **Re-check failed** in this audit: Europe PMC was rate-limited and Taylor & Francis needed a permission that was not
  given. So treat it as [unverified this pass]. (1/0.46 per century ≈ 217 y is consistent.) This is approximate: a small,
  hand-coded, ancient-only sample, with ranges replaced by midpoints. Targets: censored exponential mean of Empire-tier
  lifespans ∈ **[130, 350]**, and the same loosely for Kingdom+ states ([100, 350]). CV ∈ [0.6, 1.4] (exponential ≈ 1).
- Taagepera (1978 Soc. Sci. Res. 7:108; 1979 Soc. Sci. Hist. 3:115; 1997 Int. Stud. Q. 41:475) compiled area-time curves of
  large polities [R: the papers were not opened]. Peak shares of the world's land, from Taagepera-based figures on Wikipedia's
  "List of largest empires" [V]: Mongol 24.0 M km² (~16 % of ~149 M km²), British 35.5 M km² in 1920 (~24 %). That page
  gives 17.8 % and 26.4 % of land excluding Antarctica. Target: largest state's share of world land at 2000 ∈ [0.08, 0.25]
  (**design default**). The share of the world's people at peaks, from the same page [V]: Qing 37 % (1800), Western Han
  32 % (1 CE), Rome 30 % (150 CE). **Corrected**: the plan had said 25–35 %; it is about 30–37 %. The oft-quoted 44 % for the
  Achaemenids is doubtful, and that page lists a far lower share. Target:
  largest share of world people at 1500 and 2000 ∈ [0.15, 0.40]. Reported unscored: rise fraction (founding → peak area ÷
  lifetime), peak-area distribution, and the ζ of polity populations.

### 2.5 Faith shares
- Pew (2012, Global Religious Landscape, 2010 data): Christian 31.5%, Muslim 23.2%, unaffiliated 16.3%, Hindu 15.0%,
  Buddhist 7.1%, folk 5.9% [R: the Pew page fetch was blocked in this audit (a permission request went unanswered), so
  this is unverified]. For comparison, Pew's 2025 report (2020 data, as quoted by Wikipedia) gives Christian 28.8 %,
  Muslim 25.6 %, unaffiliated 24.2 % and Hindu 14.9 % [V via Wikipedia]. The bands do not change. Targets at 2000: top faith ∈ [0.20, 0.40]; top 4 ∈ [0.55, 0.90]. Caveat: History stores only
  the majority faith and its share per town, so followers = pop × share, and every faith is a lower bound.

### 2.6 Gravity model of trade
- Disdier & Head (2008, REStat 90:37–48): 1,467 estimates from 103 papers [V, re-fetched]. The mean distance elasticity
  **0.91** and median 0.87 are not in the abstract and were **not re-checked** in this audit (they were [V] earlier, from the
  paper body). PPML (Santos Silva & Tenreyro 2006, REStat 88:641–658) is preferred to OLS on logs, because log-linear OLS is
  biased under heteroskedasticity [V]. Target for the PPML distance
  coefficient on open routes at 2000: [−1.3, −0.6]. For long-haul legs it is [−1.3, −0.4], a looser band for pre-modern trade [A].
  Mass is ln(Pa·Pb), with population standing in for GDP; it is reported unscored.
- **Circularity [V]**: route existence is chosen by `pop/cost²` (1). The fitted elasticities are on the **intensive margin**
  (volume on open routes), which is conditional on gravity-based selection. A distance elasticity near −2 or a mass elasticity
  near 1 would be suspect as an echo of the selection rule. The measured −0.48 / +0.55 are neither, so they are not just the
  selection rule [M + A]. Long-haul legs are formed by mart and lane logic, not by the `pop/cost²` score, and serve as the
  less circular check. For an extensive-margin test, see section 7 (optional `candidatePairs` diagnostic).

### 2.7 Epidemics, demographic shocks, urbanisation
- Black Death: Wikipedia gives **30–60 %** of Europe's population for 1346–53 [V]. (**Corrected**: the plan had said
  "30–50 % is the usual range".) Benedictow argues ~60 %, which is contested; Wikipedia cites the 2021 edition of *The Black
  Death 1346–1353: The Complete History*, first published 2004 [V for the claim; edition details R]. The Justinianic
  plague's toll is disputed: Mordechai et al. (2019) argue for a small impact [V]. Targets (**design defaults**): worst
  epidemic deaths/network ∈ [0.25, 0.55], also for plague alone. The worst 50-year world population fall is
  ∈ [0.08, 0.35] [A: "14th-century Eurasia lost something like 15–25 %" is R, unverified].
- Urbanisation: Europe, share in cities ≥ 10,000 is **5.6% in 1500 and 7.6% in 1600** (Britannica, after Bairoch and de
  Vries). This was [V] earlier, but the **re-check failed**: Britannica's "urbanization" article, the one re-fetched, does
  not contain these figures, so the earlier source was probably a different Britannica page. Treat it as [unverified this
  pass]. It is ~10% in 1800 (de Vries 1984, *European Urbanization 1500–1800*) [R]. Targets: 1500 ∈ [0.03, 0.12]; 2000 (the sim's end ≈ early
  modern) ∈ [0.05, 0.15]. **Caveat [V]**: a sim settlement includes its farming catchment, so `u10` overstates urbanisation.
  The plan's fix (step 5) is to also report `u10core`, using an urban core estimate of pop minus the catchment's farm
  labour, once a contract field exposes it. Until then, read `u10` as an upper bound.

---

## 3. Harness design (`src/sim/history/realismStats.ts` + `realismFit.ts`)

Style follows `goods/goodsStats.ts` and `polityStats.ts`: a header comment with run lines, an exported per-seed function, a
target table with verdicts, and per-seed detail. One difference: the run line needs `--experimental-strip-types` on Node 22.23 [V].

- `realism(h: History, w: World, boot = 0, seed = 0): Record<string, number>` is pure over History. It does not touch sim
  state or RNG. The bootstrap uses its own mulberry32 seeded from (seed, year) [V].
- Measures (keys as emitted; all in the jsonl):
  - `zipf{500,1000,1500,2000}.{zeta,alpha,se,xmin,nTail,n,p,lnR,lnP,expR,zeta1k,n1k,zetaGI50,primacy}`. Outposts are excluded.
  - `gibrat{500,1000,1500}.{beta,betaSe,rho,n,exit,sdSmall,sdLarge}`: 50-year steps, towns ≥ 1,000.
  - `war.{count,zeroDead,alpha,se,xmin,nTail,p,lnR,lnP,expR,maxShare,medDead,p90Dead,durMean,durMedian,durCv,durKs,durMax,deadDurRho,onsetPerDecade,onsetDispersion}`,
    and `warConq.*` (conquest wars only).
  - `life2.*` (≥ 2 members), `lifeK.*` (peak Kingdom+), `lifeE.*` (peak Empire), each `{n,ended,mean,median,cv,ks}`.
    The mean is the right-censored exponential MLE (exposure / ended).
  - `pol.largestPop{100..2000}`, `pol.largestLand{100..2000}` (of all land cells), `pol.largestOwned{…}` (of owned land),
    `pol.{empires,kingdoms,riseFracMed,riseN,peakLandMed,peakLandMax,zeta1500,zeta2000}`.
  - `faith{500..2000}.{top1,top4,n5,hhi,universal}`.
  - `epi.{count,great,worstNet,worstWorld,medNet,n10,n25,plagueWorstNet,obP50,obP90,plagueObP50,plagueObP90,plagueObMax}`, `pop.worst50yFall`.
  - `urb{100..2000}.{u10,u5,world,largest}`.
  - `grav{1000,1500,2000}.{n,olsMass,olsDist,olsR2,ppmlMass,ppmlDist,olsSmall,olsBig}`, and `gravLH…` for long-haul legs.
- `TARGETS: [key, lo, hi, source][]`: 26 scored targets (section 2). `miss(v, lo, hi)` is the distance outside the band in
  band widths, capped at 2, with NaN counting 2. `realismScore(rows)` is the mean miss and the in-range count.
- CLI: `[seeds] [--boot N] [--json] [--from rows.jsonl] [--from A.jsonl --vs B.jsonl] [--opts '<HistoryOptions JSON>'] [--detail]`.
  With more than 6 rows the table shows p10, median and p90 instead of per-seed columns.
- `sweep.sh <checkout> <out.jsonl> <jobs> <boot> seeds…` runs the seeds as parallel JSON rows, then aggregates.

Cost [M]: the stats take 0.1–0.4 s per seed without bootstrap and 3.5–11 s with `--boot 100` (two bootstraps: Zipf at four
eras, then war). Sim runs took 9 s uncontended (seed 42, idle machine) and 40–120 s on this shared 2-core box. Memory is
negligible (a few arrays of length S, polities or land cells).

---

## 4. Baseline (measured, commit 8cabf09, `--boot 100`)

```
measure                 target                1        7       42     1234  ok  source
zipf1000.zeta           0.800..1.25        1.80     1.87     2.24     1.61  0/4   Zipf/Gabaix99, Soo05
zipf1500.zeta           0.800..1.25        1.49     1.14     1.19     1.07  3/4   Zipf/Gabaix99, Soo05
zipf2000.zeta           0.800..1.25        1.08    0.778    0.994    0.736  2/4   Zipf/Gabaix99, Soo05
zipf2000.zeta1k         0.800..1.25        1.15     1.02    0.995    0.959  4/4   Zipf (xmin 1000)
zipf2000.primacy        1.30..4.00         1.33     1.14     1.46     1.14  2/4   Zipf: 2 (Jefferson primacy wider)
gibrat1000.beta         -0.060..0.030     0.018    0.002    0.020    0.012  4/4   Gibrat (Eeckhout04)
gibrat1500.beta         -0.060..0.030     0.007    0.013    0.023   -0.002  4/4   Gibrat (Eeckhout04)
war.alpha               1.30..1.90         2.32     1.88     1.91     2.26  1/4   Clauset18 1.53+-0.07; Cederman03
war.durCv               0.700..1.40       0.511    0.492    0.611    0.565  0/4   Richardson: ~exponential
war.onsetDispersion     0.600..1.60        1.43     1.58     1.46     2.33  3/4   Richardson: Poisson onsets
war.maxShare            0.005..0.050      0.012    0.010    0.016    0.012  4/4   WWII ~3% of world
lifeE.mean              130..350              -     6818     5744        -  0/4   Arbesman11 ~220y
lifeK.mean              100..350            692      434      394      706  0/4   Arbesman11 (loose)
lifeE.cv                0.600..1.40           -    0.000    0.000        -  0/4   Arbesman11 exponential
pol.largestPop1500      0.150..0.400      0.184    0.106    0.129    0.301  2/4   Han/Rome/Qing 25-35%
pol.largestPop2000      0.150..0.400      0.168    0.106    0.232    0.110  2/4   Han/Rome/Qing 25-35%
pol.largestLand2000     0.080..0.250      0.112    0.080    0.147    0.078  2/4   Taagepera: Mongol 16%, British 24%
faith2000.top1          0.200..0.400      0.233    0.689    0.647    0.357  2/4   Pew 2012: 31.5%
faith2000.top4          0.550..0.900      0.588    0.739    0.733    0.538  3/4   Pew 2012: ~77%
epi.worstNet            0.250..0.550      0.186    0.117    0.099    0.097  0/4   Black Death 30-50%
epi.plagueWorstNet      0.250..0.550      0.186    0.117        -    0.097  0/4   Black Death 30-50%
pop.worst50yFall        0.080..0.350      0.105    0.050    0.074    0.056  1/4   C14 Eurasia ~15-25% (approx)
urb1500.u10             0.030..0.120      0.073    0.043    0.065    0.167  3/4   de Vries84: Europe 5.6%
urb2000.u10             0.050..0.150      0.193    0.311    0.396    0.412  0/4   de Vries84: Europe 1800 10%
grav2000.ppmlDist       -1.30..-0.600    -0.535   -0.342   -0.407   -0.548  0/4   Disdier-Head08 ~-0.9
gravLH2000.ppmlDist     -1.30..-0.400    -0.909   -0.203   -0.493   -0.520  3/4   Disdier-Head08 (pre-modern looser)
realism score (mean miss, lower is better): 0.404; in range 45/104
```
(The `source` column is the label string in realismStats.ts TARGETS, kept verbatim as measured output. Per the 2026-11-26
audit, "Han/Rome/Qing 25-35%" should read 30-37%, and "Black Death 30-50%" should read 30-60%, when the script is next
edited. The bands are unchanged.)

Other 4-seed numbers worth knowing [M]:
- Zipf: the CSN xmin falls to ~75–150 people at 1500 and 2000 because the hamlet body dominates. The bootstrap p is 0.00
  there (seed 42 at 2000: 0.33 with xmin 1,077). The pure power law is rejected for the whole size range, but the Vuong test
  cannot separate it from lognormal (|R| < 1.8, p > 0.07). Real city data show the same pattern. ζ above 1,000 people is the
  stable number.
- Gibrat: σ(growth) is 0.21 for small towns and 0.18 for large (1500–2000). Exits of towns ≥ 1,000 within 50 years: ~0% (real
  towns that size rarely vanish either [A]).
- War: 90–119 wars per run. Median deaths 129–468, p90 477–2014. Spearman ρ(duration, deaths) is 0.11–0.39 (positive, as
  expected). Censored mean duration is 7.8–8.4 years and the longest war 17–27 years.
- Polities: 48–60 Kingdom+ states per run, 26–46 of them ended. Medians are 125–221 years, close to Arbesman. The means are
  inflated by long-lived survivors: the KS distance from the exponential is 0.28–0.47, which points to a mixture of short-lived
  states and immortal cores. Only 3–7 states reach Empire tier, and 2 of the 19 across the 4 seeds ever end.
- Faith 1500: top faith 0.23–0.37 (in band). Consolidation to 0.65–0.69 by 2000 happens on seeds 7 and 42.
- Epidemics: 58–87 per run, 2–8 "great". Worst per-epidemic share of the world's people is 2.5–14%. Plague outbreak
  mortality p90 is ~0.2 and max 0.30–0.42. Seed 42 never gets plague.
- Gravity, routes 2000: OLS mass 0.52–0.59, distance −0.62 to −0.80, R² 0.30–0.42. PPML mass 0.55–0.58, distance −0.34 to −0.55.

22-seed sweep: see the table in section 0 and `all22-extra.log` for p10, median and p90 of every key.

---

## 5. Diagnosis and where each gap should be fixed

| gap | likely cause | knob / owner plan |
|---|---|---|
| war α 2.2 vs 1.5 | deaths ≈ few × 0.02 × front-town sizes, so the tail inherits the town-size pdf (≈ 2) [A] | **battles plan (220–229)**: escalation. Deaths should multiply with army size and the number of fronts and allies, e.g. the escalation model of Clauset, Walter, Cederman & Gleditsch (2025, arXiv 2503.03945), which ties Richardson's law to within-war escalation [V]. grudges (joined wars) and finances (bigger chests, bigger armies) should push α down. Check α moves toward 1.5 without `maxShare` > 5% |
| war duration CV 0.53 | peace by exhaustion at a near-constant 0.08 a year, plus a chance only after 5 years [V] | finances' WarBankrupt ends wars at random times (lowers the floor); battles plan: lower `perYear`, `peaceAfter` 5 → 1, `peaceChance` ≈ 1/mean. Target CV 0.7–1.4 |
| onsets overdispersed (1.7) | wars cluster in successions, civil wars and chains of joined wars [A] | grudges plan (revenge) will raise it, so guard ≤ 1.6. Fine if only conquest wars are Poisson-like |
| Empire immortality; Kingdom+ mean 517 years | an Empire-tier core rarely loses its capital, and cohesion decay is weak at the top [A] | city-states, finances (default → revolt), grudges (coalitions vs a hegemon). Target `lifeE.ended / lifeE.n ≥ 0.5` and `lifeK.mean` 100–350 |
| ζ 1.6 at 1000; primacy 1.25 | few towns ≥ 1,000 before ~1100; no capital premium in growth [A] | city-states (port capitals), seat/orders plan (capital draws people and wealth), merchant-families (mart capital). Guard: Gibrat β stays in band |
| faith monopolies at 2000 (2 of 4 seeds) | universal faiths spread without a stable frontier [A] | beliefs plan (230–239): schism and frontier resistance. Target top1 0.2–0.4 |
| epidemics too mild | plague 0.46 × attack 0.85 × susceptible, and network counts peoples reached, not towns struck [V] | disasters plan (260–269): a rare high-virulence plague strain or famine synergy. Target worstNet 0.25–0.55 in ≥ 1 epidemic per run, without dropping world pop at 2000 > 10% |
| u10 0.38 | catchment population counted in towns [V] | measurement fix first (step 5). Then society plan (240–249) |
| gravity distance −0.48 | transport cost falls with Crafts tech, and sea routes are cheap [A] | not a tuning target in itself. The guard is that it should not drift toward −2 (an echo of selection) |

---

## 6. How each sibling plan checks itself against these

Rule for every plan (add to its tuning step):
1. Before tuning: `node --experimental-strip-types src/sim/history/realismStats.ts 1 7 42 1234 --json --opts '{"<feature>":false}' > off.jsonl`, and the same
   with the feature on, saved as `on.jsonl`. Then `realismStats.ts --from off.jsonl --vs on.jsonl`.
2. **Guard**: the realism score must not rise by more than 0.03, and no target may be flagged `WORSE` (mean miss up by more than
   0.1 band widths) unless the plan lists it below as an accepted trade-off, with a reason.
3. **Improve**: each plan names the targets it is meant to move (below). Report their before and after values in its final
   table. The sweep (`sweep.sh`, 22 seeds, no bootstrap, ~15–20 min on 2 cores) is run once before merging.

| plan | guard (must not get worse) | intended to improve | specific checks |
|---|---|---|---|
| grudges-and-oaths.md | war.alpha, war.durCv, lifeK.mean | war.onsetDispersion should stay ≤ 1.6 (revenge clusters wars) | its "conquest wars ±20%" guard → also `war.onsetPerDecade` within ±20% |
| state-finances.md | Zipf, Gibrat, gravity | war.durCv (WarBankrupt), lifeK.mean (defaults → revolts) | its "median war length ±2 y" → add `war.durCv` ≥ baseline; `war.maxShare` ≤ 0.05 |
| merchant-families.md | Gibrat β in band (family wealth must not make big towns grow faster: β ≤ 0.03), grav*.ppmlDist | gravLH2000.ppmlDist toward −0.9 (owned lanes) | family capital concentration vs Zipf primacy: top family share 0.08–0.3 is consistent with primacy ≤ 4 |
| city-states.md | pol.largestPop, lifeE | zipf2000.primacy, zipf1000.zeta (ports) | its "people in city-states 2–10%" + `lifeK.mean` should fall toward 100–350 |
| perf-efficiency.md | **every key bit-identical** (the harness is a semantic hash) | none | `--from base.jsonl --vs perf.jsonl` must show 0.00 → 0.00 on all rows, and identical jsonl except msRun/msStats |
| battles (220–229, not written) | Zipf, Gibrat | war.alpha → [1.3, 1.9], war.durCv → [0.7, 1.4] | primary owner of Richardson's law |
| beliefs (230–239) | | faith2000.top1/top4 | |
| society (240–249) | Gibrat | urb*.u10 (once u10core exists) | |
| disasters (260–269) | world pop at 2000 within −10% | epi.worstNet, pop.worst50yFall | |
| seat/orders (270–279) | Gibrat | zipf2000.primacy | |
| language (250–259) | all (it should not change demography) | none | identical to perf rule if purely cosmetic |

Tie-break if two plans fight over the same metric: battles owns war severity and duration. Polity lifespans are shared
between city-states and finances, and the later-built plan re-tunes [A].

---

## 7. Interfaces (optional contract additions; not needed for v1)

- `History.urbanCore?: Float32Array`: per snapshot per settlement, the non-farming population (pop minus farm labour of the
  catchment). This enables `u10core` and a Zipf of cores. Owner: society plan. Fallback until it exists: `u10`, flagged as an upper bound.
- `HistoryDiagnostics.candidatePairs` (stats only, not contract): the pairs considered at each link step and whether each
  opened. This allows an extensive-margin gravity test (logit of opening on ln mass, ln cost), which would make the
  circularity explicit. Fallback: long-haul legs.
- `Wars.battleDead` split from sack deaths (Float32Array). Only needed if the battles plan wants the Clauset fit on battle
  deaths alone, like COW.

No EventTypes are claimed.

---

## 8. Steps (commit-sized)

1. **Estimators**: add `src/sim/history/realismFit.ts` and `realismFit.test.ts` (copy from realism-scripts; 4 tests,
   ~2 s). Run `npx vitest run src/sim/history/realismFit.test.ts` and `npm run typecheck`.
2. **Harness**: add `src/sim/history/realismStats.ts` (copy). Check: `node --experimental-strip-types src/sim/history/realismStats.ts 42`
   reproduces the seed-42 column of section 4 exactly (it is deterministic: the bootstrap uses its own seeded PRNG).
3. **Sweep script**: add `scripts/realism-sweep.sh` (from sweep.sh), and a README line under the stats harnesses.
4. **Golden realism rows**: commit `docs/realism-baseline.jsonl` (the 4 seeds, `--boot 0`) so later plans can `--vs` against
   8cabf09 without re-running it. There is no test on it, because runs take minutes.
5. **Urban core** (needs §7 `urbanCore`, society plan): add `u10core` and core Zipf, then retarget `urb*` to the core and keep
   `u10` unscored.
6. **Extensive-margin gravity** (optional, needs the candidatePairs diagnostic).
7. Each later plan adds its §6 row to its own tuning step.

Determinism: the harness reads only History, so on and off runs of any feature are untouched. A golden-hash test is not
affected because nothing in the sim changes.

UI / Chronicle / Legend: none. This is a headless tuning tool.

---

## 9. Risks and open questions

- **Literature numbers are partly recalled [R]**. After the 2026-11-26 citation audit, these are re-verified: CSN 2009, Vuong 1989,
  Gabaix & Ibragimov 2011, Gabaix 1999 (its definition), Soo 2005 (its rejection counts), Eeckhout 2004, Clauset 2018, Cederman 2003 (citation),
  Disdier & Head 2008 (sample), Santos Silva & Tenreyro 2006, Mordechai 2019, the Black Death range, the WWII share and the empire
  area and population shares. Still unverified: Pew 2012, Arbesman 2011 (re-check failed), the Britannica 1500/1600 urbanisation
  figures (re-check failed), de Vries 1800 = 10%, Taagepera's papers, Gibrat 1931, Hill 1975, Soo's mean 1.1, Gabaix's US 1.0,
  Cederman's −0.41 and Disdier & Head's 0.91/0.87. See References. Bands are deliberately wide, so ±10% errors in the recalled numbers do not
  change any verdict.
- **Scale mismatch**: the world is 0.4–1 M people at year 2000 [M], about the size of one ancient region, not the world. Only
  scale-free statistics (exponents, CVs, shares) are scored. Absolute deaths and city sizes are not.
- **Arbesman's sample** is 41 ancient empires: small, and selected on bigness. The sim's Kingdom+ class is broader, hence
  its looser band.
- **Censoring**: 30–50% of Kingdom+ states are alive at 2000, so the means depend on the exponential assumption. The KS of
  0.25–0.6 says the exponential fits badly, and the median (145) is the robust number. Consider a Weibull fit if the
  battles or finances plans make lifetimes bimodal.
- **Zipf xmin choice**: CSN picks hamlets (xmin ~100) and rejects the power law. That is a true statement about the full
  distribution, not a bug. The scored `zipf2000.zeta` uses the CSN choice, and `zeta1k` is the stable cross-check. If the
  later tuners prefer, score `zeta1k` from 1500 on and leave CSN for reporting [A].
- **Faith lower bound**: minority followers are invisible, so `top1` is biased down and HHI up. Low priority.
- **Runtime noise**: the 2-core box was shared, so run times in the jsonl (msRun 13–123 s) are not perf data.

---

## References (citation audit 2026-11-26)
Tags: **[verified]** means re-opened this session, with the claim confirmed. **[verified: citation]** means the record was
confirmed but the specific number was not on the page read. **[unverified]** gives the reason. All target bands (§2, TARGETS)
are **design defaults** set around the literature points, not literature values themselves.

1. Arbesman, S. (2011). The life-spans of empires. *Historical Methods* 44(3), 127–129. https://doi.org/10.1080/01615440.2011.577733 [unverified this pass: Europe PMC rate-limited, and the Taylor & Francis fetch needed a permission that was not given. It was verified in the earlier session]
2. Benedictow, O. J. (2004; 2nd ed. 2021). *The Black Death 1346–1353: The Complete History*. Woodbridge: Boydell. [verified: the ~60 % claim via Wikipedia, "Black Death", https://en.wikipedia.org/wiki/Black_Death. The publisher and edition details are recalled]
3. Cederman, L.-E. (2003). Modeling the size of wars: from billiard balls to sandpiles. *American Political Science Review* 97(1), 135–150. [verified: citation, via Clauset 2018's reference list. The −0.41 slope is unverified this pass because the APSR page failed to load. The issue number is recalled]
4. Clauset, A. (2018). Trends and fluctuations in the severity of interstate wars. *Science Advances* 4(2), eaao3580. https://doi.org/10.1126/sciadv.aao3580 (full text: https://www.ebi.ac.uk/europepmc/webservices/rest/PMC5834001/fullTextXML) [verified: α̂ = 1.53 ± 0.07, x̂min = 7,061, 51 wars, p_KS = 0.78; onsets geometric]
5. Clauset, A., Walter, B. F., Cederman, L.-E., & Gleditsch, K. S. (2025). Escalation dynamics and the severity of wars. arXiv:2503.03945. https://arxiv.org/abs/2503.03945 [verified]
6. Clauset, A., Shalizi, C. R., & Newman, M. E. J. (2009). Power-law distributions in empirical data. *SIAM Review* 51(4), 661–703. https://doi.org/10.1137/070710111 [verified: venue, start page and DOI. The issue and end page are recalled]
7. de Vries, J. (1984). *European Urbanization 1500–1800*. London: Methuen. [unverified: not fetched. The 1500/1600 figures attributed to Britannica could not be found on the Britannica "urbanization" page]
8. Disdier, A.-C., & Head, K. (2008). The puzzling persistence of the distance effect on bilateral trade. *Review of Economics and Statistics* 90(1), 37–48. https://ideas.repec.org/a/tpr/restat/v90y2008i1p37-48.html [verified: citation, 1,467 estimates from 103 papers. The mean 0.91 / median 0.87 are not in the abstract]
9. Eeckhout, J. (2004). Gibrat's law for (all) cities. *American Economic Review* 94(5), 1429–1451. https://doi.org/10.1257/0002828043052303 [verified]
10. Gabaix, X. (1999). Zipf's law for cities: an explanation. *Quarterly Journal of Economics* 114(3), 739–767. https://ideas.repec.org/a/oup/qjecon/v114y1999i3p739-767..html [verified: citation and the N(>S) ∝ 1/S statement. "≈1.0 for US metros" is unverified]
11. Gabaix, X., & Ibragimov, R. (2011). Rank − 1/2: a simple way to improve the OLS estimation of tail exponents. *Journal of Business & Economic Statistics* 29(1), 24–39. https://doi.org/10.1198/jbes.2009.06157 [verified]
12. Gibrat, R. (1931). *Les inégalités économiques*. Paris: Sirey. [unverified: not fetched; recalled]
13. Hill, B. M. (1975). A simple general approach to inference about the tail of a distribution. *Annals of Statistics* 3(5), 1163–1174. [unverified: the RePEc page failed; recalled]
14. Mordechai, L., et al. (2019). The Justinianic Plague: an inconsequential pandemic? *PNAS* 116(51), 25546–25554. https://econpapers.repec.org/RePEc:nas:journl:v:116:y:2019:p:25546-25554 [verified]
15. Pew Research Center (2012). *The Global Religious Landscape*. https://www.pewresearch.org/religion/2012/12/18/global-religious-landscape-exec/ [unverified: the fetch was blocked (a permission request went unanswered). The 2010 shares are recalled]
16. Richardson, L. F. (1948). Variation of the frequency of fatal quarrels with magnitude. *JASA* 43, 523–546; Richardson, L. F. (1960). *Statistics of Deadly Quarrels*. Pittsburgh: Boxwood Press. [verified: citations, via Clauset 2018's references]
17. Santos Silva, J. M. C., & Tenreyro, S. (2006). The log of gravity. *Review of Economics and Statistics* 88(4), 641–658. https://doi.org/10.1162/rest.88.4.641 [verified]
18. Soo, K. T. (2005). Zipf's Law for cities: a cross-country investigation. *Regional Science and Urban Economics* 35(3), 239–263. https://ideas.repec.org/a/eee/regeco/v35y2005i3p239-263.html [verified: citation, 73 countries, rejection counts. The "OLS mean ~1.1" is not in the abstract]
19. Taagepera, R. (1978). Size and duration of empires: systematics of size. *Social Science Research* 7, 108–127; (1979) Size and duration of empires: growth-decline curves, 600 B.C. to 600 A.D. *Social Science History* 3, 115–138; (1997) Expansion and contraction patterns of large polities: context for Russia. *International Studies Quarterly* 41, 475–504. [unverified: not fetched; titles and pages are recalled. The area and population shares are verified via Wikipedia, "List of largest empires", https://en.wikipedia.org/wiki/List_of_largest_empires, which uses Taagepera's figures]
20. Vuong, Q. H. (1989). Likelihood ratio tests for model selection and non-nested hypotheses. *Econometrica* 57(2), 307–333. https://ideas.repec.org/a/ecm/emetrp/v57y1989i2p307-33.html [verified]
21. Wikipedia, "World War II casualties" (60–75 M dead, ~3 % of 2.3 bn in 1940). https://en.wikipedia.org/wiki/World_War_II_casualties [verified]
