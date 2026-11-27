# Barriers and cold wars (coordinating doc; no new subsystem)

Scope: (1) **communication barriers**: language intelligibility, lingua francas, interpreters, news lag, and deliberate
closure; (2) **cold wars**: an emergent condition between two strong, deterred rivals, with proxy wars, spheres,
espionage, crises and endings. Every effect is a factor in an existing composition stack, or in a formula that an existing
plan owns. Nothing here is a parallel system. The owners' `## Addendum (barriers & cold war)` sections carry the
binding text. This file sets the formulas, the ownership and the order.

Tags: [V] verified in code (`/home/claude/ws-main`, main @ 4484b19), [M] measured, [A] design default (not a fact),
[R] ruling. Citations: References at the end, each tagged per _CONVENTIONS.

## 0. What exists (verified)
- **Language drift is assembly-only** [V `history/language/assemble.ts` header: "Nothing here is read by the
  simulation"]. `prepareLanguage` runs inside `assemble()` (history/index.ts:616) after the year loop. So the sim
  **cannot** call `languageAt` (spoken.ts) during a run: `History.speech` does not exist yet.
- The tree is pure in (world, settlement table), and "the tree of a prefix of the table is the prefix of the tree"
  [V languageTree.ts header]. Native lexical replacement is a renewal process per (language, meaning) from its own
  stream `lang-lex-<n>-<m>`, drawn up to `years` [V lexicon.ts `drawLexicon`]. Both are prefix-stable, so both can be
  advanced inside the loop with identical results. Contact (loans and shifts) is computed from snapshots at assembly
  [V contact.ts].
- The shared-cognate share is `cognatePoints` / `wordRow` (languageStats.ts): c = the share of the 100 core meanings
  whose word in force descends from the same row. The loan-inflated `cLoan` also counts a borrowing from the partner.
- Probe [M] (`scratch-barriers/probe/barrierProbe.ts`, seeds 1 and 42, 2000 y, language on):
  - live polities: 20–30 at 1500–2000;
  - median c between related capital languages (same people, different language): 0.77–0.80 at 0.5–1 ky of
    separation, 0.61–0.67 at 1–1.5 ky, 0.58–0.63 beyond (c floors near 0.58 because `meaningShape` makes some meanings
    very stable);
  - unrelated pairs (different peoples): c = 0, with loans > 0 in only 2–17 of 188–316 pairs;
  - wars by the two capitals' languages: seed 1: 10 same language, 62 related, 33 unrelated (of 105); seed 42: 4, 26,
    69 (of 99). So intelligibility separates many actual war dyads;
  - a naive all-pairs c pass costs 0.7–12.6 ms;
  - language shifts at capitals: 0 of 2504 and 0 of 2099 capital-decades (`probe/shiftProbe.ts`; no LanguageShift
    occurred on either seed). Ignoring shifts in the loop is therefore safe at today's `shiftRate`.
- Information today: beliefs' channels (beliefs §3.2) have no lag. Trade pair cost is `c0·pc.cost·dzMul`
  (trade.ts:982–984), with no stack. Idea learning (`ideas/system.ts learnAndConceive`) and faith exposure
  (`religion/system.ts spreadStep`/`exposeFrom`) have no stack either.

## 1. Rulings [R]
- **B-R1 Live drift.** language-drift adds `LiveDrift`, which advances the tree and the native lexicon inside the year
  loop at each `POLITY.slowStep`. The tree is built incrementally over newly founded ids, and the lexicon lists are
  drawn lazily, each (n, m) keeping its own rng and time.
  - Assembly reuses this state instead of calling `buildDrift`, so the extra CPU is roughly zero (the work moves from
    assembly into the loop).
  - Test: rows identical to `buildDrift` for every prefix year.
  - In-loop intelligibility uses **native cognates only**. Loans and shifts stay assembly-only, so the loop never
    sees them. The UI's "said in the year" names are unchanged.
  - Consistency guard B2 (§5).
- **B-R2 No language, still barriers.** With `language` off, the proxy is I = 1 for the same people and 0 otherwise.
  Lingua francas and interpreters still apply.
- **B-R3 Two audiences.** `e_elite` is for courts, envoys, merchants and scholars: lingua francas and interpreters
  count fully. `e_mass` is for migrants, converts and crowds: lingua francas count weakly. This follows Ostler (2010):
  lingua francas spread through conquest, commerce and conversion, and are learned on purpose.
- **B-R4 Lag is sub-annual before the telegraph and must not be overclaimed.** News lag (days) changes:
  - beliefs' precision, through a staleness variance (small for slowly changing strength);
  - discrete timing events (war after peace);
  - crisis escalation.

  It does **not** enter C4 reach (infrastructure owns reach) or C1.
- **B-R5 Mean-preserving spread factors.** The new idea and faith factors are divided by their exposure-weighted
  world mean over the previous decade. Barriers then redistribute diffusion rather than slow it (the tech-tree era
  bands stay calibrated).
- **CW-R1 Deterrence is the cause, not an effect.** Detection requires that direct war was already not happening. A
  cold war adds **no** C1 damping: that would double-count parity, arms (inside `adv`) and FT `deterMul` (C1 factor 5).
  What it adds is the displacement of conflict (stability–instability paradox, Snyder 1965): proxies, courting,
  espionage and crises.
- **CW-R2 Crisis escalation declares through `war.ts declare()`** on its own path, as the holy-war path does (outside
  the C1 product). It counts in the C1 test totals (declarations ±20%).
- **CW-R3 Proxy aid acts only through strength and money.** It acts through battles' `M_aid` and finances' subsidy
  (which C6's debt factor then sees). It adds no C6 factor and no C2 term. Pre-modern subversion is aid to a side of a
  `CivilWar` (35). Ideological subversion is MIR's export pulse (Phase 4).

## 2. Communication barriers

### 2.1 Mutual intelligibility (owner: language-drift; `names/intelligibility.ts`, RNG-free)
```
c_ab(Y)  = native core cognates of languages a, b at Y / LANG.core                       (wordRow logic on LiveDrift)
I(a,b)   = smoothstep(IB.cLo 0.60, IB.cHi 0.95, c_ab)      a == b → 1;  unrelated → 0 (proxy B-R2 when language off)
L_p(Y)   = live tree node of p's capital (B-R1; the realm's "tongue", as contact.ts defines it)
```
- Calibration [A, checked against the probe]: c 0.91 (≈300 y) → I 0.97; c 0.77–0.80 (0.5–1 ky) → I 0.48–0.65;
  c 0.64 (1.5 ky) → I 0.04.
- The direction (less shared vocabulary means less understanding) follows Gooskens et al. (2009), who also find
  **phonetic** distance a better predictor than lexical distance. Option `IB.phon` (default 0, Phase 4):
  `I ·= 1 − IB.phon·min(1, ΔR/IB.r50)`, where ΔR is the sound changes on both lines since parting (`rulesCrossed`).
  It is off until LiveDrift also advances rules.
- Cache: `Float32` per unordered pair of language ids, keyed per decade, filled lazily for the pairs asked (relations,
  trade pairs, contact pairs). Cleared each decade. Cost ≤ 0.3 s per 2000 y [A, from the 0.7–12.6 ms all-pairs probe].

### 2.2 Lingua francas and interpreters (owner: language-drift for ε; prestige read from migration Π, R15)
Per Kingdom+ polity p, every slowStep:
```
cand 1 (prestige/trade): q* = argmax over known q (I(L_p, L_q) < 0.5) of Π_{a_p}(q)·(1 + 0.5·[trade share of p with q ≥ 0.2])
cand 2 (faith):          L_f = the state faith's founding language frozen at its founding year (liturgical; c across years
                         works on lexicon rows); score = 0.8·org_f
L*_p = the best candidate (switch only if it beats the holder by 0.15; on a switch ε ← 0.3ε: Ostler's "relegation")
ε_p  += 0.2·(smoothstep(0.3, 0.7, score) − ε_p)                                    (elite adoption 0..1)
e_elite(p,q) = max( I(L_p,L_q), η·ε_p·I(L*_p,L_q), η·ε_q·I(L*_q,L_p), η·min(ε_p,ε_q)·I(L*_p,L*_q), e_int(p,q) )   η 0.85
e_mass(p,q)  = max( I(L_p,L_q), IB.massLF 0.3 · (the same lingua-franca terms) )
e_int(p,q)   = IB.interp 0.4 if p or q is Kingdom+ and paid its interpreters this step, else 0
```
- **Interpreters' cost:** `finSpend(s, p, IB.interpCost 0.01·revenue·min(1, n_p/4))`, where n_p is p's relations with
  I < 0.5. It is booked as diag kind 'envoys'. If it is unpaid, `e_int = 0` that step. Without finances it is not
  charged. Melitz & Toubal (2014) find that translation and interpreters matter where ease of communication matters.
- **Π before migration lands (Phase 2):** barriers computes `prestigeProxy`, migration §3.6's wealth and cities terms
  renormalised. It is deleted when `migPrestige` exists (R15: migration owns Π).
- Event **LinguaFranca 390** when ε_p rises through 0.5.

### 2.3 News lag (owner: infrastructure `infraLag(s, p, q)` in days; proxy here until infrastructure lands)
```
d   = great-circle km between capitals (cell spacing ≈ 149 km at n = 48, infrastructure §1)
σ   = 1 if the capitals are on different landmasses, else the sea share of their trade pair path (0 if none)
ℓ   = 1.3·d·((1 − σ)/v_land + σ/v_sea)
v_land = 25 foot (ORBIS marching 20–30 km/day) | 67 courier (cursus publicus median; both peoples hold `courier`, or
         Empire tier before tech-tree) | ×1.5 postalService [A] | 500 rail (both infraHeld ≥ 0.3) [A]
v_sea  = 120 sail [A] | 350 steam (both hold `steamship`) [A]
wired (infraWire(p,q) > 0; telegraph + cable at sea) → ℓ = 0.5 d;  radio both → 0.05;  internet both → 0.01
```
- The sail and steam speeds are design defaults (ORBIS simulates sailing, and gives no single figure). The harness
  checks the direction only: Kaukiainen (2001) finds dispatch times fell to about a third of 1820 levels by 1860,
  mostly before the telegraph.
- **Uses:**
  1. **beliefs staleness:** each channel `I ← I/(1 + I·IB.q·ℓ/365)`. `IB.q` is the per-year variance of Δln mass,
     **measured** by the harness and written as a constant (initial 0.01 [A]).
  2. **War after peace (LateBattle 391).** At `closeWar` by treaty (not conquest or capital fall), with battles on and a
     battle of that war in the last 2 years:
     - `ℓ_f` = the lag from the peace-maker's capital to the last battle site;
     - if `ℓ_f ≥ 14` days, a hit when `hash01(seed, war·8 + 1) < min(0.5, ℓ_f/120)` (counter-based, no stream; D-dup 10);
     - battles fights one more battle at the last site. It counts toward toll and renown, not toward the terms.
     - Anchor: the Treaty of Ghent was signed on 24 Dec 1814, and New Orleans was fought on 8 Jan 1815 (NPS).
  3. **Crisis escalation** (§3.5).

### 2.4 Deliberate barriers (no new quantity)
- **Censorship** is MIR's regime `climate` and FP surveillance, already in C10. Barriers reads `climate_p` as C12's
  factor for incoming **Ideology-kind** ideas only. This is consistent with King, Pan & Roberts (2013): censorship
  targets collective expression.
- **Seclusion (Seclusion 392)** = a tech-tree ban in force on a held Seafaring idea **and** migration policy Closed
  (with migration off: the ban, plus ruler tol < 0.25). It ends when either lifts; IdeaBanLifted extra 1 (defeat) is
  the "forced opening". While secluded:
  - trade: every foreign pair of p is blocked except at one licensed port (the largest coastal town), through the
    polities-v2 `pc.block` gate;
  - C12: incoming ideas ×IB.secludeIdea 0.3;
  - beliefs: cheap channels to and from p ×0.5.
- **Closed borders** (migration-borders) already cut flows. Barriers adds nothing, so nobody double-counts them.

### 2.5 Where e and ℓ enter (composition) — every factor through `compose.ts`
| hook | owner (stack) | factor [A] | quantity |
|---|---|---|---|
| trade pair cost, trade.ts:982 `c` | infrastructure, **new C11** pair cost, clamp [0.5, 2] | `1 + IB.trade 0.3·(1 − e_elite)` | e of the two ends' polities (town languages if stateless) |
| idea exposure, `learnAndConceive` E | tech-tree, **new C12**, clamp [0.3, 1.5] | `((0.7 + 0.3·e_elite)/ē)` · climate (Ideology kind) · seclusion | people pair → their main polities |
| faith exposure, `exposeFrom` w | religious-evolution, **new C13**, clamp [0.3, 1.5] | `((0.7 + 0.3·max(e_mass, I(L_town, L_f)))/ē)`; religious' `(1 − sec_i)` becomes factor 1 | town ↔ faith |
| alliance chance | grudges **C7** factor 5 `talk` | `0.6 + 0.4·e_elite` | |
| beliefs precision | beliefs (own §3.3 update; not a stack) | cheap bits (1, 2, 4) `×(0.3 + 0.7·e_elite)`; Faith (16) × I to the liturgical language; Spies `×(0.5 + 0.5·e_elite)`; staleness (2.3) | |
| migrant assimilation α | migration §3.13 `langDist` | `langDist = 1 − e_mass(town language, slot's people)` | replaces its "factor 1" proxy |
| riots cross-border kernel | riots §4.4 (a weight inside the normalisation, like `wireW`) | `× e_mass` on cross-polity edges | branching bound unchanged |
| merchant branch choice | families P1 branches | rank by `relaySm·(0.6 + 0.4·e_elite)` | the licensed port only, if secluded |
- New stacks C11–C13 (Integration rule): each of these draws already has, or is about to get, more than one plan's
  factor:
  - trade: disease `dzMul` and polities' `pc.cost` stay outside the stack as 8cabf09 terms, and infrastructure re-prices;
  - ideas: tech-tree, MIR censorship, seclusion;
  - faith: religious' `sec`, and barriers.
  Without a stack, those factors would be inline. Each stack is pass-through and G0-neutral in Phase 0 style (§2.3
  shared rule).

## 3. Cold wars (owner: grudges, as the rivalry, C1 and C7 owner; code `polity/coldwar.ts` beside `arms.ts`/`align.ts`)

### 3.1 Detection (every slowStep after `armsStep` and `beliefStep`, before `declarations`)
For relation r = (a, b):
```
κ_ab = smoothstep(1.0, 1.8, R_ab) · π_ab,  π_ab = min(M̂_a, M̂_b)/max(M̂_a, M̂_b)
  (M̂ = beliefs' estimate when beliefs is on, else pMass)
Begin when ALL hold:
  - both Kingdom+;
  - each ≥ CW.great 0.15 of the summed pMass of polities in contact with either (Waltz's bipolar dominance);
  - R_ab ≥ CW.rOn 1.2 for ≥ CW.rivalYears 30;
  - an arms race is open (relRace ≥ 0; arms off: R ≥ 1.4);
  - π ≥ CW.parity 0.5 (0.25 if both hold FT `deterrence`);
  - no war between them for ≥ CW.quiet 25 y.
```
- A `ColdWars` table (struct-of-arrays, like ArmsRaces): a, b, start, end, end cause, ideological flag, proxies,
  crises, defections, peak κ. Justification: no existing record holds a dyadic condition with a start and an end other
  than ArmsRaces, and a race is a component of a cold war, not the same thing.
- Event **ColdWarBegan 393**.
- The two principals are "the principals"; their clients are polities bound to one of them by alliance, Vassal or
  Tribute bond, or by bandwagoning.

### 3.2 Proxy wars (stream `history-coldwar`)
For each active cold war (id order), each principal P (a, then b), and each active war w in id order (including
CivilWar 35) where P is not a belligerent:
- **Eligibility:** side s qualifies if its opponent o is the rival principal Q, a client of Q, or has R(P, o) ≥ 0.6;
  s is not Q's client; and P is in contact with s.
- **Draw:** one draw per (cw, P, w) for the best s:
  `u < CW.proxy 0.25·κ·4r(1 − r)·(1 + [Q already aids o])`, where r is s's front share A/(A + D). The
  `4r(1 − r)` term encodes Salehyan et al. (2011): support goes more often to moderately strong groups, where rivalries
  exist, and where the other side already has foreign backing.
- **Aid:**
  - money: yearly `finSpend(P, CW.aidShare 0.03·revenue_P)`, then `finCredit(s, 0.7·that, 'subsidy')` (finances
    addendum);
  - arms and advisers: battles `M_aid = (1 + CW.aidK 0.25·aid_A)/(1 + CW.aidK·aid_D)` in x;
  - grievance: o records **GrievanceKind 17 ProxyAid** against P;
  - aid stops when w ends, P cannot pay, or the cold war ends.
- Mumford (2013) defines this as aid to a surrogate without the benefactor's own forces in combat, used as "warfare
  on the cheap".
- Event **ProxyWar 394**, once per (w, P).

### 3.3 Spheres of influence
- **Courting:** **C7 factor 6 `sphere`** = `1 + CW.sphere 0.5·κ` when one member of the candidate pair is a principal
  and the shared threat is the other principal.
- **Defection:** per slowStep, for each client x of P in contact with Q, one draw:
  `u < CW.defect 0.03·κ·smoothstep(0, 0.3, Π_x(Q) − Π_x(P) + 0.5·(AFF_xQ − AFF_xP) + aidBal)`,
  - with AFF = 0 before Phase 4, and aidBal = 0.2·sign(Q's aid to x minus P's).
  - A hit lapses x's bond to P (the existing lapse path, no Betrayed) and calls `ally(x, Q, P)` or `subject(x, Q)` for
    a tribute client. Event **ClientDefected 395**.
  - Pre-modern case: a buffer kingdom's tribute flips between two empires (Armenia between Rome and Persia: Dignas &
    Winter 2007 treat Armenia's geopolitical importance in that rivalry).

### 3.4 Espionage and subversion
- beliefs `spyTarget += CW.spy 0.3·κ` (counter follows by beliefs' own rule), with SpyCaught (236, grievance 9) as is.
- Phase 4: MIR export pulse `×(1 + CW.subvert 1.0·κ)` into Q and Q's clients (Subversion 14, as is).

### 3.5 Crises, détente, endings
- **Crisis (Crisis 396):** per slowStep, `u < CW.crisis 0.08·κ·(1 + 0.5·[a proxy began or a client defected this
  step])`. Resolve with a second draw u2:
  - **backdown** (u2 < 0.6): by the side with lower `â·cred·rulerWar` (rulerWar 1 when rulers are off). The loser's cred falls by
    `0.5·credHit`, and migration Π's arms term counts it as half a defeat;
  - **compromise** (u2 < 0.85): R −0.1;
  - **otherwise escalation**, with chance `CW.esc 0.12·lagMul·(both hold deterrence ? 0.3 : 1)`, where
    `lagMul = 0.2 + 0.8·ℓ/(ℓ + 3)` (ℓ in days). A hit calls `declare(stander, other)`, with WarMotive **6 Crisis**
    (beliefs enum, next free).
  - Fast communication lowers escalation. The 1963 Washington–Moscow link was set up "for use in time of emergency"
    after Cuba. The size of the effect is [A].
- **Détente (Detente 397):** κ < 0.5·κ_peak while active (extra 0); κ back above 0.7·κ_peak (extra 1). Trade's existing
  rivalry term does the thawing. Détente adds nothing.
- **Endings (ColdWarEnded 398, extra ColdWarEnd):**
  - 0 **Thaw**: R < 0.7 for 20 y;
  - 1 **HotWar**: any war declared between a and b;
  - 2 **Collapsed**: one side, while the cold war is active, has `finDefaulted` or Ψ ≥ society's crisis level and lost
    ≥ 30% of its peak pMass within 30 y, or ended by revolution or civil war. The material-decline reading of 1989–91
    is in Brooks & Wohlforth (2000/01);
  - 3 **Eclipsed**: π < 0.3 for 20 y without such a crisis;
  - 4 **Ended**: a side ended by another cause.
- A pair can start a new cold war after `quiet` years. Rome–Persia is a chain of cold spells broken by hot wars.

### 3.6 Eras
- **Phase 2 core:** everything above with AFF = 0 and lag from the proxy.
- **Phase 4 (with MIR):** ideological flag when `AFF(fam_a, fam_b) ≤ −0.5`; κ `+= CW.ideo 0.3`; proxy eligibility adds
  "o's regime family is hostile to P's"; defection reads AFF; BlocFormed 318 stays MIR's. Gaddis (1986) and Jervis
  (1989) frame the nuclear-era long peace. The UI help says that whether it was deterrence is contested (FT §2.5.6).

## 4. Registry (MASTER-PLAN §3 rows in its addendum)
- EventType block **390–399** (from unassigned 390–409): 390 LinguaFranca, 391 LateBattle, 392 Seclusion,
  393 ColdWarBegan, 394 ProxyWar, 395 ClientDefected, 396 Crisis, 397 Detente, 398 ColdWarEnded; 399 spare. Semantics:
  - 390: `settlement` = p's capital, `other` = the capital (or faith seat) whose tongue, `value` = language id, `extra`
    = source (0 prestige, 1 faith, 2 trade);
  - 391: site, peace-maker's capital, war id, days late;
  - 392: capital, −1, polity, 0 closed / 1 opened;
  - 393 and 398: a's capital, b's capital, cold-war id, extra flag or ColdWarEnd;
  - 394: sponsor's capital, backed side's capital, war id, cw id;
  - 395: client's capital, new patron's capital, cw id, old patron's polity;
  - 396: a's capital, b's capital, cw id, CrisisOutcome;
  - 397: a, b, cw id, 0/1.
- Enums:
  - `ColdWarEnd` {Thaw 0, HotWar 1, Collapsed 2, Eclipsed 3, Ended 4};
  - `CrisisOutcome` {BackdownA 0, BackdownB 1, Compromise 2, Escalated 3};
  - `LinguaFrancaSource` {Prestige 0, Faith 1, Trade 2};
  - **GrievanceKind 17 ProxyAid** (next 18);
  - beliefs-local **WarMotive 6 Crisis**;
  - **RivalryPart 13 ColdWar** (causal: records κ at a crisis-declared war);
  - finances kinds 'subsidy' (credit) and 'envoys' (spend).
  - Optional (Phase 3, seat): DecisionKind 55 Brink, OrderKind 84 Brink.
- HistoryOptions: **`barriers`**, **`coldWars`** (default false; flip after harness, one flip per PR, R29). `barriers`
  reads real intelligibility only if `language` is on (B-R2).
- RNG: **`history-coldwar`** only. Barriers is RNG-free (LateBattle uses `hash01`). Draw order: §3.2 → §3.3 → §3.5,
  cold wars in id order.
- Stacks: **C11** pair cost (owner infrastructure), **C12** idea exposure (owner tech-tree), **C13** faith exposure
  (owner religious-evolution); **C7** factors 5 `talk`, 6 `sphere`.

## 5. Harness and realism guard (`polity/rivalryStats.ts`; seeds 1, 7, 42, 1234; 2000 y; `--years 3000` for lag and blocs)
| # | measure | target [A unless noted] |
|---|---|---|
| B1 | median I of related capital pairs by separation | ≥ 0.8 at < 300 y; 0.3–0.7 at 0.5–1 ky; ≤ 0.15 at ≥ 1.2 ky; non-increasing by bin |
| B2 | capital-decades whose live node ≠ assembled `languageAt` | ≤ 5% (0% measured today [M]) |
| B3 | Kingdom+ polities with ε ≥ 0.5 at 1500; the largest lingua franca's elite share | 0.15–0.5; ≤ 0.6 |
| B4 | trade volume between pairs with e_elite < 0.3, on vs off; world trade | falls 5–20% (Melitz–Toubal direction); world ±5% |
| B5 | C12 and C13 mean factor; tech-tree era first-years | 1 ± 0.02; inside tech-tree §6.1 bands |
| B6 | LateBattle per seed and 2000 y | 0–3, only where ℓ_f ≥ 14 d |
| B7 | median capital-pair ℓ, sail era vs telegraph era (3000 y) | falls ≥ 3× (Kaukiainen direction) |
| B8 | heritage half-life, unintelligible vs intelligible slots | ≥ 1.3× |
| CW1 | long rivalries (R ≥ 1.2 for ≥ 30 y, both Kingdom+) that become cold wars | 10–35% |
| CW2 | cold wars per seed and 2000 y | 1–6; ≥ 1 on 3 of 4 seeds |
| CW3 | duration | median 40–150 y (1947–91 ≈ 45 y) |
| CW4 | proxy interventions per cold war | median 1–5; ≥ 60% of cold wars have ≥ 1 |
| CW5 | endings | HotWar 20–50%, Thaw 20–50%, Collapsed + Eclipsed 10–40%, none > 60% |
| CW6 | crises per cold-war century; escalated share | 1–5; 5–25% |
| CW7 | stability–instability: principals' direct-war rate during vs before; their war participation incl. proxies | < 0.5×; ≥ 1× |
| CW8 | share of wars between pairs with R ≥ 1, on vs off | not lower by > 5 pts (rivals fight most wars: Colaresi et al. 2008, 77% since 1816, direction only) |
- **Realism guard:**
  - realism A/B with each switch on vs off: Δscore ≤ 0.03, and no WORSE row (no accepted trade-offs listed);
  - C1 test (declarations ±20%, crisis wars included), C6 (`war.durCv` ∈ [0.7, 1.4]; aid lengthens wars), C7
    (alliances −20%/+40%);
  - clamp-hit share ≤ 1% on C7 and C11–C13;
  - G0 with both switches off.
- **Perf:**
  - barriers ≤ +3% of history CPU (pair cache ≤ 0.3 s, ε per slowStep O(P·known));
  - LiveDrift moves assembly work into the loop (net ≈ 0);
  - cold war O(cw·wars) per slowStep, negligible;
  - memory ≤ 50 KB.

## 6. Roadmap and steps (MASTER-PLAN §4)
- **Phase 2, lane D (after beliefs#0–12):**
  1. LiveDrift (language-drift step, B-R1).
  2. `intelligibility.ts` with ε and e_int.
  3. compose C11–C13 as pass-throughs, then the consumers, plus C7 `talk`.
  4. beliefs hooks and lag proxy, LateBattle (battles merged in Phase 1), seclusion (no-op until tech-tree).
  5. Barriers harness B1–B6.
- **Phase 2, lane D′ (after grudges arms/balance, finances and beliefs merge):**
  1. Detection and the `ColdWars` table, events 393/398, the polity-panel line "In a cold war with X since Y".
  2. Proxies (finances subsidy, battles M_aid, grievance 17).
  3. Spheres (C7 `sphere`, defection).
  4. Espionage and crises.
  5. Harness CW1–CW8, then the A/B, then the flips.
- **Phase 4:**
  - migration replaces `prestigeProxy`, and `langDist` is wired;
  - infrastructure replaces the lag proxy with `infraLag` (wires, cables);
  - tech-tree media ideas and the seclusion detection go live;
  - MIR ideological blocs and the subversion boost; B7 and the `IB.phon` option.
- Director: register 390–398 (experience §0.1).
- Chronicle, hedged: "News of the peace had not reached the army at X; the battle was fought anyway." /
  "For forty years Kesh and Oru armed against each other but never fought; their quarrel was waged in other lands."

## 7. Risks and open questions
- Every CW and IB constant is [A]. Cold-war frequency is untestable against data. CW1–CW6 are plausibility bands, not
  facts.
- **Small-P worlds:** 20–30 live polities mean few qualifying dyads. CW2 may fail low, so lower `great` before
  loosening parity.
- **Pre-modern lag:** effects are small by design (B-R4). If B6 shows 0 everywhere, keep the event and do not inflate
  it.
- **Intelligibility affects many war dyads** (related languages: 26–62 of ~100 wars). Watch C7 after the `talk`
  factor.
- **Open:** do crises get seat cards (DecisionKind 55)? Should a cold war count in partisan sagas as one long "war"?

## References
- Brooks, S. G. & Wohlforth, W. C. (2000/01). Power, Globalization, and the End of the Cold War: Reevaluating a
  Landmark Case for Ideas. *International Security* 25(3). https://www.belfercenter.org/publication/power-globalization-and-end-cold-war-reevaluating-landmark-case-ideas
  [verified: publisher page (Belfer); volume/issue from memory, unverified]
- Colaresi, M. P., Rasler, K. & Thompson, W. R. (2008). Defining and identifying strategic rivalries in world politics.
  In *Strategic Rivalries in World Politics*, ch. 2, pp. 21–72. Cambridge UP. https://www.cambridge.org/core/books/strategic-rivalries-in-world-politics/defining-and-identifying-strategic-rivalries-in-world-politics/CCF2E2D1E29D15D3C298BEA80FA5375E [verified: 58 of 75 wars since 1816]
- Dignas, B. & Winter, E. (2007). *Rome and Persia in Late Antiquity: Neighbours and Rivals*. Cambridge UP. https://bmcr.brynmawr.edu/?p=26938 [verified: BMCR review; Armenia subchapter]
- Gaddis, J. L. (1986). The Long Peace: Elements of Stability in the Postwar International System. *International
  Security* 10(4), 99–. https://muse.jhu.edu/article/446174/summary [verified]
- Gooskens, C., Heeringa, W. & Beijering, K. (2009). Phonetic and lexical predictors of intelligibility. In *Computing
  and Language Variation* (IJHAC 2), 63–82. Edinburgh UP. https://www.cambridge.org/core/books/abs/computing-and-language-variation/phonetic-and-lexical-predictors-of-intelligibility/60566F7A4B215DD7C5B08E976FBEC505 [verified]
- Jervis, R. (1989). *The Meaning of the Nuclear Revolution*. Cornell UP. https://www.kirkusreviews.com/book-reviews/a/robert-jervis/the-meaning-of-the-nuclear-revolution-statecraf/ [verified: review]
- Kaukiainen, Y. (2001). Shrinking the world: improvements in the speed of information transmission, c. 1820–1870.
  *European Review of Economic History* 5(1), 1–28. https://ideas.repec.org/a/cup/ereveh/v5y2001i01p1-28_00.html [verified]
- King, G., Pan, J. & Roberts, M. E. (2013). How Censorship in China Allows Government Criticism but Silences Collective
  Expression. *APSR* 107(2), 326–343. https://ideas.repec.org/a/cup/apsrev/v107y2013i02p326-343_00.html [verified]
- Melitz, J. & Toubal, F. (2014). Native language, spoken language, translation and trade. *Journal of International
  Economics* 93(2), 351–363. https://doi.org/10.1016/j.jinteco.2014.04.004 [verified]
- Memorandum of Understanding … Regarding the Establishment of a Direct Communications Link (Geneva, 20 June 1963).
  https://avalon.law.yale.edu/20th_century/sov003.asp [verified]
- Mumford, A. (2013). *Proxy Warfare*. Polity. https://blogs.lse.ac.uk/lsereviewofbooks/2013/09/06/book-review-proxy-warfare [verified: LSE review]
- National Park Service. The Treaty of Ghent. https://www.nps.gov/jela/learn/historyculture/the-treaty-of-ghent.htm [verified: signed 24 Dec 1814; battle 8 Jan 1815]
- Ostler, N. (2010). *The Last Lingua Franca: English Until the Return of Babel*. https://omniglot.com/language/articles/lastlinguafranca.htm [verified: review; year from the British Library catalogue entry]
- Salehyan, I., Gleditsch, K. S. & Cunningham, D. E. (2011). Explaining External Support for Insurgent Groups.
  *International Organization* 65(4), 709–744. https://ideas.repec.org/a/cup/intorg/v65y2011i04p709-744_00.html [verified]
- Scheidel, W. (2014). The shape of the Roman world: modelling imperial connectivity. *Journal of Roman Archaeology*
  27, 7–32. https://doi.org/10.1017/S1047759414001147 [verified]. Speeds from the 2013 working paper:
  https://www.ltrr.arizona.edu/~rtouchan/Mediterranean_publications/scheidel.pdf [verified: marching 20–30 km/day,
  cursus publicus median 67 km/day]
- Snyder, G. H. (1965). The Balance of Power and the Balance of Terror. https://en.wikipedia.org/wiki/Stability-instability_paradox [verified-secondary: original not opened]
- Swadesh, M. (1955), as cited in language-drift.md (lambda).
- Waltz, K. N. (1964). The Stability of a Bipolar World. *Daedalus* (Summer 1964). https://www.siwps.org/publications/the-stability-of-a-bipolar-world-daedalus-summer-1964 [verified: citation listing; argument not opened]

## Addendum (coordinator, registry)
RivalryPart 13 and 14 are taken on main by causal-explorer (Secession, Alarm). The cold war rivalry part is **RivalryPart.ColdWar = 15** (the last reserved slot). EventType blocks: barriers-coldwar 390–399, language-typology-scripts 400–409.
