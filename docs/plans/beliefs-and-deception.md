# Plan: Beliefs and deception (misjudged wars, coerced cessions, bluffs, spies, secret alliances)

Status: PLAN ONLY. Written against the read-only checkout `/home/claude/ryanmye/worldseed` at 8cabf09. Branch `beliefs`.
Marks: **[V]** read in that tree (file:function named). **[M]** measured on the scratch copy `/home/claude/scratch-beliefs`
(instrumented `war.ts`/`bonds.ts` with `globalThis` counters only, which draw nothing; probes `probe-beliefs.ts` and
`probe-rel.ts` at its root; Node 22.23; full 2000-year default runs). **[A]** assumed, or a design decision not yet checked
against code.

EventType block: **230–239** (`_CONVENTIONS.md`). Off switch: `HistoryOptions.beliefs`. RNG stream: `'history-beliefs'`.

Depends on: polities v2 (exists). Optional and with proxies: grudges-and-oaths (GrievanceKind rows, `oathBroken`, the
ceding helper), state-finances (`finSpend`, a new `finFundYears`), battles (`battles.md` was still being written when this
plan was written. I could not read it, so section 0.4 defines only a narrow hook it can adopt), religion (holy cities),
rulers (traits, marriages), goods (secrets' espionage channel). Build order: after grudges → finances → families →
city-states. The plan works on 8cabf09 alone if every optional dependency is missing.

---

## 0. Interfaces with other plans

### 0.1 Event ids (230–239)
| id | name | used |
|---|---|---|
| 230 | Coerced | yes |
| 231 | Deterred | yes |
| 232 | BluffBegun | yes |
| 233 | BluffExposed | yes |
| 234 | SecretAlliance | yes |
| 235 | AllianceRevealed | yes |
| 236 | SpyCaught | yes |
| 237 | ClaimForged | optional (step 9) |
| 238 | ClaimExposed | optional (step 9) |
| 239 | spare | |

### 0.2 grudges-and-oaths (amendments; they must accept these)
- New `GrievanceKind` values. CrownDefault = 7 is finances'. Beliefs adds:
  - `TownCeded: 8`: the offender took `settlement` from the wronged under threat, without war (Coerced). Merged per
    crisis like TownConquered. Weight `OATH.w.ceded` 0.08 per town, capped at 0.4.
  - `SpyCaught: 9`: the wronged caught the offender's spies (weight 0.2).
  - `ClaimForged: 10`: the offender's forged claim on the wronged was exposed (weight 0.4).
- Calls, all RNG-free on their side: `recordGrievance(s, ps, kind, wronged, offender, w, site, war)`, and
  `oathBroken(s, ps, p, q, w, 1)` for the double-alliance case in 3.7.
- **Ceding helper.** Grudges step 6 cedes towns for a separate peace. Both plans need the same thing, so it should be one
  exported function in `polity/war.ts`:
  `cedeTowns(s, ps, from, to, towns: number[], unrest = 0.3): number`. It runs `setPolity(v, to, d)` with
  `d = distAcross`-based cost, sets `conqueredAt[v]` and `unrest[v]`, logs `Joined(v, capital to, to)`, and never cedes
  `pCapital[from]`. Whichever plan lands first writes it; the other reuses it.
- Proxy if grudges is absent: no grievance rows. Coerced adds `relR += BELIEF.coerceR` (0.2) between the two. Spies
  caught add `relR += caughtR`.

### 0.3 state-finances
- Costs paid through `finSpend(s, p, amount)` (kind `'intel'`): spies and bluffs. Proxy: debit the capital's wealth,
  exactly as `goods/secrets.ts leaks` already does for espionage (`s.wealth[cap] -= cost`, floored at 0) [V].
- **Amendment:** finances exposes `finFundYears(s, p): number` (the `fundYears` quantity of their 2.4.6; Infinity when
  the realm is unmonetised). Beliefs scales the war cost with it (3.4). Proxy: `WAR.poor`'s test
  (`wealth[cap] < WAR.poorShare * pMass`) [V war.ts exhaust] gives cost × 1.5.
- Unit for costs: with finances, `R°` (their revOrd). Without it, `pMass` (3.8).

### 0.4 battles (220–229, written in parallel)
- Beliefs needs one call per engagement, after its outcome is known:
  `beliefBattle(s, w, p, q, aTrue, dTrue)`, where p strikes and q defends, and aTrue and dTrue are the strength
  numbers the battle used. Today these are `strikeA` and `strikeD` in `war.ts strike()` [V]. If battles rewrites
  `battle()`, it must keep this call.
- **Feints** are battle mechanics and belong to battles. Beliefs offers `intelEdge(s, p, q): number` in [-1, 1]: p's
  precision about q minus q's about p, saturated. Battles may use it for surprise or feints. With no battles plan
  built, nothing reads it.
- If battles adds its own `Wars` fields, the names chosen here (`believed`, `actual`, `motive`) must not collide.

### 0.5 Others
- religion: `rel.holy[f]` (holy city of faith f), `rel.state[p]` (state faith), `polityFaith(s, rel, q)` [V
  religion/system.ts holyDrive].
- rulers: `R.cur[p]`, `R.rWar`, `R.rAbility` (measured range 0.67–1.6, median 1.06 [M seed 42]), `tied(R, a, b)` [V
  rulers/marriage.ts].
- goods: `secrets.ts leaks` gets a threshold-only multiplier on `r[LeakChannel.Espionage]` (3.9).
- merchant-families (optional): a family with seats in both realms adds to the trade channel's precision (3.2).
- city-states: nothing needed. A FreeCity is a polity like any other.

---

## 1. Current behaviour (verified)

### 1.1 Declarations use true strength [V] (`polity/war.ts declarations`, lines 68–95)
- For each relation r in creation order and both directions, p→q, the code skips the pair if: either side has ended,
  the two are at war, a truce holds, `rv = smoothstep(.6, 1.2, relR) <= 0`, there are no border edges, the pair is
  `bound` (vassal and overlord), or `pWars[p] >= maxWars`. It also skips when `exposedFront <= 0`.
- `exposedFront` picks q's border member v maximising `projAt(p, dist[u]+c) / Local_v`, and sets
  frontU, frontV and frontD.
- **`adv = projAt(ps, p, frontD) / projAt(ps, q, dist[frontV])`.** Both terms are true values. `projAt` =
  `pMass · grip(d, reach) / (1 + multiWar·(wars−1)) · (1 − exhaustionProj·E)` [V polity/state.ts:647].
- `drive = rv · smoothstep(1, 2, adv) · (crisis(q) ? 2 : 1) · (1 − E_p)`, and
  `mul = rulerWar · holyDrive · ordersMul`.
  **There is exactly one `rngWar` draw per surviving candidate**, against `slowStep · 0.01 · drive · mul`.
- q's allies are **ignored** in the decision. `protectorsOf(q)` joins only after `declare()`, each with chance
  `ALLIANCE.join` = 0.5 from rngWar, as a *separate* war x→p [V war.ts declare]. The ally's war raises p's `pWars`,
  which divides p's projAt by `1 + multiWar·(wars−1)`. That is the only way allies matter on the battlefield.
- Because `smoothstep(1, 2, adv)` is 0 at adv ≤ 1, **no war is ever declared by a side that is truly weaker on its
  chosen front** (confirmed: `advBelow1 = 0` on all four seeds [M]).

### 1.2 Peace terms use true strength [V]
- `bonds.ts peaceTerms(p, q)`: `advantageAt(p, q)` = p's projection at q's capital over max(pMass_q, Local_cap). It
  gives vassalage at ≥ 1.2 (when q is large or foreign) and tribute at ≥ 0.6. It is called from `closeWar` for
  unfinished conquest wars.
- `bonds.ts overawe` (every mapStep): a large realm whose capital would submit to a neighbour with twice its people
  becomes its vassal **without war**, on true projAt. This is already a "coercion without war" path: 38–48 times per
  run [M]. There is **no** peaceful cession of towns.
- `bondStep`: a vassal throws off its bond when the overlord's true projAt at its capital falls below
  `VASSAL.rebel·mass` (bonds.ts:203).

### 1.3 Information today [V]
- Peoples know cells and contacts (`knowledge.ts`: `know.contact[a*P+b]` = year met, else < 0). States know each
  other's strength perfectly whenever a relation exists.
- There are no embassies. `relEmb` is the **embargo** flag (policy.ts:160), not an embassy.
- The only espionage is industrial: `goods/secrets.ts leaks` gives Kingdom+ polities whose import bill of a secret's
  goods is high a `LeakChannel.Espionage` rate `SECRET.espionage · smoothstep(spyLow, spyHigh, bill/income) ·
  (1 − protect·pi) · cr`, paying `SECRET.spyCost · bill` from the capital's wealth. Leaks use one `g.rng` draw per
  people and secret.
- Alliances are public: `ally()` logs `Alliance(39)` [V bonds.ts:266].
- Trade volume between two polities is computed inside `relationStep` as a local `vol[r]` from `ts.openList`/`rVol`
  [V relations.ts:94–100] and not stored.

### 1.4 Step order [V polity/system.ts]
Yearly: campaigns → warYear → rulerYear. Every 5 years: control … bondStep, tariffStep. Every 10 years (slowStep):
… overawe (every mapStep) → **relationStep → allianceStep** → kinStep → hubStep → **declarations** → raids → walls.

### 1.5 Baseline outcomes [M] (`probe-beliefs.ts`; "initiated" = declared in `declarations`, not ally-joined; attacker win = AttackerGains/Conquest/Tribute/Vassalage)
| seed | conquest wars | initiated | attacker wins | defender wins | white | ally-joined: att / def wins | adv at decl p10/50/90 | adv < 1 | defender mass ×1.5 in prior 30 y | overawe | median length |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 105 | 91 | 78 (87%) | 7 (8%) | 5 | 8 / 3 of 14 | 1.46 / 2.35 / 8.2 | 0 | 7 | 39 | 6 |
| 7 | 96 | 66 | 58 (88%) | 6 (9%) | 2 | 15 / 10 of 28 | 1.68 / 3.77 / 134 | 0 | 4 | 48 | 6 |
| 42 | 99 | 83 | 71 (86%) | 3 (4%) | 8 | 10 / 3 of 16 | 1.90 / 3.41 / huge | 0 | 6 | 38 | 6 |
| 1234 | 80 | 61 | 48 (79%) | 4 (7%) | 5 | 7 / 3 of 16 | 1.48 / 3.76 / 47 | 0 | 7 | 40 | 6 |

The probe's denominators include 1–5 ongoing wars per seed. The win shares above are of all initiated wars.

By the attacker's true advantage (seed 1): 1–1.5: 10/12 won; 1.5–2: 16/23; 2–4: 26/30; 4+: 26/26.

**Reading.** Wars are almost always won by their initiator: 79–88% win, and only 4–9% are lost outright. A
historical reference point is Wang & Ray (1994, *ISQ* 38(1):139–154), "Beginners and Winners", on great-power wars
since 1495. Per Lindley & Schildkraut (n.d.), Wang & Ray report initiator win rates of 56%, 52%, 53%, 74% and 67% in
the five centuries 1495–1991: about 60% on average, and *higher* (not lower) in the 19th–20th centuries. The
downward trend often quoted comes from Correlates of War data for 1815–1991 instead (initiators won 73% of the 32
wars before 1900, 43% of the 47 after, 33% of the 23 after 1945; Lindley & Schildkraut n.d.). **The Wang & Ray
figures are confirmed only through that secondary source; the paper itself was not opened. Treat ~60% as an
approximate, contested benchmark.**
Misjudgment is the gap this plan fills.

---

## 2. Model (sources)

- **Fearon (1995), "Rationalist Explanations for War", *IO* 49(3):379–414.** War is costly, so for risk-neutral
  states some negotiated split leaves both better off than fighting. The bargaining range is `[π_A − c_A, π_A + c_B]`
  in A's share of the pie, when both sides agree on π. War needs one of three things:
  1. private information plus an incentive to misrepresent;
  2. commitment problems (preventive war when power shifts fast);
  3. issue indivisibility. Fearon himself argues this is rare in principle because side payments exist, and that
     claim is contested: Hassner (2003), "To Halve and to Hold", *Security Studies* 12(4), on sacred space.
- **Blainey (1973), *The Causes of War*:** wars start when states disagree about their relative strength and end when
  fighting resolves the disagreement.
- **Learning in war:** Slantchev (2003), "The Principle of Convergence in Wartime Negotiations", *APSR* 97(4):621–632.
  Smith & Stam (2004), "Bargaining and the Nature of War", *JCR* 48(6):783–813. Battles are signals, and peace comes as
  beliefs converge.
- **Commitment and preventive war:** Powell (2006), "War as a Commitment Problem", *IO* 60(1):169–203. On how rare purely
  preventive wars are: Levy (1987), *World Politics* 40(1). Exact frequencies are contested.
- **Misperception and overconfidence:** Jervis (1976), *Perception and Misperception in International Politics*;
  D. Johnson (2004), *Overconfidence and War*. These motivate the ruler bias.
- **Signalling and bluffs:** Jervis (1970), *The Logic of Images in International Relations*; Fearon (1997), "Signaling
  Foreign Policy Interests: Tying Hands versus Sinking Costs", *JCR* 41(1):68–90. Cheap talk versus costly signals is why bluffs here cost money.
- **The estimation rule** is a scalar Kalman filter (Kalman 1960) on log-strength (a Gaussian conjugate update), implemented with
  rational approximations because the sim forbids exp/log/pow [V index.ts header; grudges 1].
  It is "Bayesian-ish": exact for log-normal beliefs with Gaussian log-noise, approximate as implemented.

### 2.1 What a belief is
For each ordered pair (observer o, target t) with a relation, o holds:
- `m̂` = its estimate of t's **mass** (`pMass`, the base of Proj), in mass units;
- `v` = the variance of `ln m̂` (its uncertainty);
- `T` = a smoothed growth ratio of `m̂` per slow step (for commitment problems).

Everything else in `projAt` stays public: grip from distance and reach, the number of wars, and exhaustion. A state
can see that its neighbour is at war or worn out, but not how many men it can field. The believed projection is:
```
projBel(o, t, d) = m̂_ot · grip(d, reach_t) / (1 + multiWar·(wars_t − 1)) · (1 − exhaustionProj·min(1, E_t))
```
The true mass keeps moving (control.ts), while `m̂` moves only when o observes. **A stale belief is therefore the
default source of error**, and a fast-rising neighbour that o watches poorly is underrated. That gives "believing Oru
weak, …" without any special case.

---

## 3. Design

### 3.1 State (`src/sim/history/beliefs/state.ts`)
`HistoryState.bel: BeliefState | null`, next to `fin` and `rul`. It is set in index.ts `createRunner`:
`pol && (options?.beliefs ?? BELIEF.enabled) ? createBeliefs(s) : null`.
```ts
export interface BeliefState {
  rng: Rng                       // createRng(seed, 'history-beliefs')
  // --- Per directed pair: row k = 2·r + dir (dir 0: relA observes relB; 1: relB observes relA); grown with ps.relA ---
  /** Estimate of the target's mass (mass units; 0 = not yet formed), log-variance of it, smoothed growth ratio per slow step, its last value (for T). */
  est: number[]; varL: number[]; trend: number[]; prev: number[]
  /** Year of the last observation; bitmask of the channels that informed it at the last belief step (BeliefSource). */
  seen: number[]; src: number[]
  /** Trade loads a year between the two (relationStep's vol, stored). */
  vol: number[]
  // --- Per polity (Float64Array, grown with ps.P like rulers' ensureRulerPolities) ---
  /** Bluff: shown strength factor minus 1 (0 none), the year it ends, the year it began. */
  bluff: Float64Array; bluffUntil: Int32Array; bluffFrom: Int32Array
  /** Credibility 0..1 (1 trusted); falls when a bluff or forgery is exposed, recovers by credKeep. */
  cred: Float64Array
  /** Spy service 0..1 and counter-espionage 0..1. */
  spy: Float64Array; counter: Float64Array
  // --- Per bond (grown with ps.bKind): year it became known to non-members (-1 secret; = bStart if public) ---
  bKnown: number[]
  // --- Per war (pushed in declare): attacker's perceived and true front advantage, motive (WarMotive), gap at start ---
  wBel: number[]; wTrue: number[]; wMotive: number[]; wGap0: number[]
  // --- Snapshots (every slowStep years at snapshot time): see 3.11 ---
  snEst: Float32Array; snSd: Uint8Array; snSrc: Uint8Array; snUsed: number
  snBluff: Uint8Array; snSpy: Uint8Array; snCred: Uint8Array
  diag: BeliefDiag
}
```
Rows are created lazily. `beliefStep` grows the pair arrays to `2·ps.relA.length`, filling `est = 0`. So `ensureRelation`
(relations.ts) is **not** touched, and other plans' pushes there are unaffected.

### 3.2 Information channels (precision I = 1/σ² in log units, per slow step)
For observer o and target t (all **[A]** first guesses, to be tuned):

| channel (BeliefSource bit) | condition [V where it is read] | I |
|---|---|---|
| Contact (1) | peoples of o and t in contact (`inContact(s, pPeople[o], pPeople[t])`, state.ts) | `iContact` 0.4 |
| Border (2) | `relEdges[r].length > 0` | `iBorder · min(1, edges/3 / 6)` (iBorder 0.6) |
| Trade (4) | `vol[r]` (stored from relationStep) | `iTrade · v/(v + RELATION.tradeHalf)` (iTrade 2.0) |
| Marriage (8) | `s.rul && tied(R, o, t)` | `iMarriage` 2.0 |
| Faith (16) | `s.rel && rel.state[o] ≥ 0 && rel.state[o] === rel.state[t]` (clergy and pilgrims) | `iFaith` 0.8 |
| Envoys / ally (32) | `allied(o, t)` (known to o, which it is when o is a member) or a Vassal/Tribute bond between them | `iAlly` 4.0 |
| Spies (64) | `spy[o] > 0` and t is a rival (relR ≥ `spyR` 0.5) | `iSpy · spy[o] · (1 − counterK · counter[t])` (iSpy 4.0, counterK 0.7) |
| War (128) | per battle and at peace (3.5), not in this table | |

Two modifiers apply to the total. Ruler ability: `I ×= clamp(ability, 0.6, 1.5)` (able rulers keep better
intelligencers; rulers on). Merchant families (optional): `+ iFamily` per family with seats in both realms.

**Cheap channels** are bits 1, 2, 4, 16: these are what a bluff fools. **Hard channels** are 8, 32, 64 and war: these
see the truth and can expose a bluff.
Embassies: none in the code. "Envoys" are approximated by alliance and vassal bonds plus marriage ties. A separate
embassy object would duplicate them; **[A]** revisit if the player orders system wants "send an envoy".

### 3.3 Update rule (every slow step, `beliefStep`, after `allianceStep`, before `declarations`)
For each relation r in order (both sides alive), and dir 0 then 1 (o observes t):
```
init (est == 0):  parent seed: if pParent[o] ≥ 0 has a formed row about t → est = that est, varL = that varL + vInherit
                  else est = mass_t · noise(σ0), varL = σ0² (σ0² = 0.6)                                          [2 draws]
drift:            varL += vDrift (0.03 per slow step: ≈ a 0.17 log-sd step a decade; uncertainty grows when unwatched)
I_cheap, I_hard per 3.2;  I = I_cheap + I_hard;  if I == 0: no observation (no draws)
shown_t = 1 + bluff[t] · cred[t]           (cheap channels only; see 3.6)
obs mass y = mass_t · (I_cheap·shown_t + I_hard) / I · noise(1/sqrt(I))                                         [2 draws]
Kalman:   k = varL / (varL + 1/I);   est ← est · rpow(y/est, k);   varL ← (1 − k)·varL
trend:    T ← T + 0.3 · (est/prev − T);  prev = est   (T starts at 1)
clamp:    varL ∈ [vMin 0.01, vMax 1.5];  y/est clamped to [1/8, 8] before rpow
```
These helpers are exp/log/pow-free and **use only + − * /**:
- `noise(σ)`: `n = σ · 2.449489742783178 · (u1 + u2 − 1)` (triangular with variance σ²; the literal is √6), clamped
  to ±1.5. It returns `(2 + n)/(2 − n)`, the [1/1] Padé approximant of eⁿ, which is exactly log-symmetric
  (n → −n gives the reciprocal).
- `rpow(r, k)` ≈ r^k: `((1+k)·r + (1−k)) / ((1−k)·r + (1+k))`. This is the [1/1] Padé form of r^k around r = 1. It is
  exact at k = 0 and k = 1 and log-symmetric. Its error is under 3% for r ∈ [1/4, 4]. Unit-test both against Math.pow
  and Math.exp in a test file only.

Draws per slow step: at most 2 per directed pair observed, plus 2 per initialisation. Order: relation order, dir 0
then 1, then the bluff and spy steps (3.6, 3.9) in `ps.alive` order. **All from `bel.rng`.**

### 3.4 Belief-driven declarations: the bargaining crisis (`war.ts declarations`, with `s.bel !== null`)
The candidate filter (truce, rivalry, edges, bound, maxWars, exposedFront) stays exactly as it is. `exposedFront`
still uses true `Local_v`, since the sight of the walls is public. Then:
```
coal_p   = Σ over protectors x of q KNOWN to p (bKnown ≥ 0, or p is a member), x borders p, not at war with p: ALLIANCE.join
â        = projAt(p, frontD) / (projBel(p, q, dist[frontV]) + 1e-9) / (1 + multiWar · coal_p) · bias_p
bias_p   = rulers ? 1 + optimism · (rWar_p − 0.5) : 1                                         (optimism 0.4: ±20%)
ă        = projBel(q, p, frontD) / (projAt(q, dist[frontV]) + 1e-9) / (1 + multiWar · coal_q)  (q's view of p's advantage;
           coal_q counts all of q's protectors, secret ones included: q knows its friends)
drive    = rv · max( smoothstep(advLow, advHigh, â),  prevent · Δπ⁺ ) · crisis · (1 − E_p)           (Δπ⁺ below)
draw     = the SAME single rngWar draw against slowStep · declare · drive · mul · pressMul     (pressMul tuned, ≈ 1.5–2.5)
```
So with beliefs on, a draw that succeeds means "p presses its claim on q", not "p declares war". Then the bargain
(Fearon, take-it-or-leave-it by the challenger) is worked out without RNG except one draw:
```
π(x)     = x² / (x² + 1)                          (the battle law A²/(A²+D²) of war.ts battle [V])
πp = π(â)           (p's belief that it wins)      πq = π(ă)       (q's belief that p wins)
c_p      = cWar · (1 + E_p) · fundMul_p ;  c_q = cWar · cDef · (1 + E_q) · fundMul_q          (cWar 0.12, cDef 0.8)
fundMul  = finances ? 1 + fundK · (1 − smoothstep(0.5, 4, finFundYears)) : (poor ? 1.5 : 1)    (fundK 1)
κ        = holyK if q holds p's or q's state-faith holy city among its border towns facing p, or frontV is one (0.15)
pie      = q's members on the p–q border (relEdges), excluding pCapital[q] and holy cities, by pop desc, at most cedeMax (3)
share(v) = pop_v / Σ_pie pop
x*       = πq + c_q − κ                           (the most q will yield, in pie share)
towns    = greedy over the pie by pop desc: take v while Σ share ≤ x*      (discrete: Fearon's indivisibility in small)
x_got    = Σ share(towns)  (or tribute: if towns = ∅ and x* ≥ tributeX (0.25) and pSub[q] < 0, x_got = tributeVal (0.3))
peace    = πp − c_p ≤ x_got  and  not commitment  and  not ruler-fail
```
- **Commitment problem (preventive war).** Let `T_pq` be p's believed trend of q and `G_p` p's own true growth ratio
  over the last slow step (bel.prev of the reverse row is q's belief, so use `pMass` history, kept as one Float64 per
  polity `massPrev`). Then `F = (T_pq / G_p)³`: the projected relative shift over 3 slow steps (30 years), computed as
  multiplications only.
  `â_fut = â / F` and `Δπ = π(â) − π(â_fut)`.
  With `commitment = Δπ > c_p + c_q`, no deal is credible, because q cannot promise not to use its future strength
  (Powell 2006).
  `Δπ⁺ = smoothstep(0, 0.25, Δπ − c_p)` also feeds the drive above, so a declining power can press even at â ≈ 1.
- **Ruler failure.** One `bel.rng` draw: `u < settleFail · (rulers ? 2·rWar_p : 1)` (settleFail 0.15). This stands for
  agency and domestic politics: the unitary-rational-actor assumption breaks, which Fearon names as a non-rationalist
  path. It keeps a floor of wars even with perfect information.
- **Outcome:**
  - **War:** `declare(...)` exactly as today (its rngWar draws and ally cascade unchanged). Then record
    `wBel = â`, `wTrue = adv` (the true front advantage, computed as today), `wGap0 = max(0, πp − πq)`, and
    `wMotive` = Preventive if commitment; else Indivisible if κ > 0 and a share-based peace would have held without
    κ; else Discrete if a continuous x would have satisfied p (`πp − c_p ≤ x*`) but no town fit; else Ruler if it was
    the failure draw; else Optimism (gap > costs).
  - **Coerced:** `cedeTowns(q → p, towns)` or `subject(q, p, true)` (tribute). Log `Coerced(capital p, capital q, p,
    towns.length)` first, then the Joined events. Set the truce `relTruce = year + cedeTruce` (15).
    Grudges: TownCeded row (or the proxy `relR += coerceR`). `relR *= coercePeace` (0.8) also applies: the
    immediate quarrel is settled.
  - **Deterred:** if `πp − c_p ≤ 0` (p sees nothing to gain) the crisis ends with nothing. Log `Deterred(capital p,
    capital q, q, wasBluff)` **only** when both are Kingdom+ and either q is bluffing or `â < 0.7 · adv` (p
    overrated q). This avoids log spam [A].
- **Orders:** a player-ordered war (`(wo & (1 << dir)) !== 0`) skips the bargain and declares as today. The player
  chose war **[A]**.
- **Draw invariant:** the rngWar draw count per candidate is unchanged (one). The bargain draws only from `bel.rng`.
  So turning beliefs on changes rngWar draws only through different outcomes (which wars exist). That is unavoidable
  and documented, as grudges 3.8 does.

### 3.5 War reveals truth (`beliefBattle`, called from war.ts battle; at closeWar)
- Per battle between p and q, each side observes the other's strength at that front. The observation is
  `y = mass_other · noise(σBattle)` (σBattle 0.25, i.e. I = 16), applied with the Kalman update of 3.3. That is 4
  draws from bel.rng: noise for both sides. A bluff of either side is seen through (the war channel is hard). If the
  bluffer is Kingdom+, log `BluffExposed(..., extra = 1 war)`.
- At `closeWar`: one more observation each way at σPeace 0.15.
- **Convergence** (Slantchev): in `campaigns`, the existing single tired-peace draw's threshold becomes
  `WAR.peaceChance · (1 + converge · max(0, 1 − gapNow / max(wGap0, 0.05)))` (converge 1.0). Here `gapNow = πp − πq`
  is recomputed from the current beliefs at the front. The change is threshold-only, with no extra rngWar draw.
- **Peace terms:** `peaceTerms` keeps true `advantageAt` in v1. The war has revealed it. **[A]** An alternative is the
  mean of the two beliefs. Leave it for tuning.

### 3.6 Bluffs, exposure, credibility (`beliefs/deception.ts`, in beliefStep after the updates)
- **Begin:** each alive polity t that is Kingdom+, not bluffing, and `cred[t] ≥ credMin` (0.4) computes its fear.
  `ψ = max over rivals q with relR ≥ WAR.rLow of est(t→q)/pMass_t`: how outmatched t thinks it is.
  The chance is `bluffChance · smoothstep(1.3, 3, ψ) · (rulers ? clamp(ability, .6, 1.5) : 1)` (bluffChance 0.15),
  with one draw. If it hits: `bluff[t] = bluffSize` (0.6, so 1.6× shown), `bluffUntil = year + bluffYears` (30), and
  `BluffBegun` is logged.
- **Cost:** a yearly cost of `bluffCost · bluff · unit_t` (bluffCost 0.15; unit = R° with finances, else
  `0.002·pMass`), paid through finSpend or the capital wealth proxy. If unpaid, the bluff ends (a show of strength
  needs money: Fearon 1997's costly signal).
- **Effect:** the observations of t that others make through cheap channels see `1 + bluff·cred` times its mass
  (3.3). Bluffs deter through â (lower drive, more Deterred) and coerce better through ă (q yields less when t is the
  challenger). They also feed overawe (3.8).
- **Exposure:** per slow step, for each observer o with a hard-channel precision `Ih(o→t) > 0`, one draw:
  `u < exposeK · Ih/(Ih + 1)` (exposeK 0.25). It also happens in any battle with t (3.5). On exposure: o's row snaps
  with a hard observation (k = 0.8); `cred[t] *= credHit` (0.5); the bluff ends; `BluffExposed(capital t, capital o,
  o, channel bit)` is logged. Rivals of o in contact with t learn second-hand: their rows get one extra observation at
  I = 2 with no bluff factor, and no extra draws because they reuse the noise of o's update **[A]**.
- **Credibility** recovers by `cred += credRecover · (1 − cred)` per slow step (credRecover 0.13 ≈ a 50-year
  half-life). The same per-realm logic as grudges' faithless score applies: realms, not rulers, carry reputation.

### 3.7 Secret alliances (`bonds.ts allianceStep`/`ally`, hooks)
- At formation with beliefs on, one bel.rng draw makes the alliance secret:
  `u < secretShare · smoothstep(1, 2, mass_c / (mass_x + mass_y))` (secretShare 0.5). The secret pacts are the ones
  against an overwhelming threat c. The draw happens after the `ps.rng` draw that formed it, which is unchanged.
  - Secret: `bKnown = -1`, and `SecretAlliance(capital x, capital y, y, c)` is logged **instead of** `Alliance(39)`.
  - Public: `bKnown = year`, and `Alliance` is logged as today.
- **Effect:** a secret ally is absent from the attacker's `coal_p` (3.4) but present in the defender's `coal_q`. So a
  secret alliance deters less and makes the defender bolder. That is exactly the private information that produces
  war.
- **Reveal when invoked:** in `declare()`'s protector loop, when x joins, if `bKnown < 0` then set `bKnown = year` and
  log `AllianceRevealed(capital x, capital q, w_new, years secret)` before x's WarDeclared.
  - **Double-dealing:** if x is also publicly allied with p, the attacker, it is a betrayal. Call grudges'
    `oathBroken(s, ps, x, p, w_new, 1)`, which ends the x–p bond `Betrayed` and records an AllyBetrayed row. Without
    grudges, end the x–p bond `Lapsed` immediately (what bondStep would do anyway [V grudges 1]).
  - Today `declare`'s join test checks `bound`, not `allied`, so x already joins against its own ally [V war.ts:117].
- **Discovery by spies:** per slow step, for each secret bond and each polity c whose threat it is (bThreat), one
  draw: `u < discoverK · spy[c] · (1 − counterK · max(counter[x], counter[y]))` (discoverK 0.3). On a hit, set
  bKnown and log `AllianceRevealed(..., value −1, extra years)`.

### 3.8 Overawe and vassal revolt read beliefs
- `overawe`: the ratio uses `projBel(p, q, d)` in place of `projAt(q, d)` (p's belief of q). A bluff can win a vassal.
  There is no new draw.
- `bondStep` rebel test: the vassal compares its **belief** of the overlord's projection with `rebel · mass`. Vassal
  bonds are a hard channel (iAlly), so beliefs converge within one or two steps. A vassal won by bluff therefore
  throws the bond off soon after it sees through the bluff. That gives the story "bowed to Oru's show of strength and
  threw off the yoke when it saw the truth".
- Both changes are threshold-only. **[A]** Measure the overawe count change (target ±25%).

### 3.9 Spies and counter-espionage (`beliefs/deception.ts`)
- **Service level:** `spyTarget = smoothstep(0.3, 1.2, max relR with any neighbour) · [Kingdom+]`, plus `0.3·[at war]`.
  `spy += 0.5·(spyTarget − spy)`; `counter = 0.5·spy + 0.3·[Empire]`.
  The cost per year is `spyCost · spy · unit` (spyCost 0.08), paid through finSpend or the proxy. If it is unpaid,
  `spy *= 0.5`.
- **Caught:** per slow step, for each spying o (spy ≥ 0.2) and each rival t (relR ≥ spyR), one draw:
  `u < caughtK · spy[o] · counter[t]` (caughtK 0.15). On a hit: o's spy channel against t is 0 this step;
  `relR += caughtR` (0.15); grudges `SpyCaught` row; `SpyCaught(capital t, capital o, o, 0)` logged when both are
  Kingdom+.
- **Goods hook** (secrets.ts leaks): `r[LeakChannel.Espionage] *= 1 + spyLeak · spy[qp]` (spyLeak 1.0), guarded by
  `s.bel !== null`. The change is threshold-only, with the same single g.rng draw.
- **Spymasters:** v1 has **no office entity**. The UI says "its spymasters" when `spy ≥ 0.5`, and an able ruler gets
  credit in the legend register. **[A]** A council or office system could own this later.

### 3.10 Forged claims (optional, `BELIEF.forgery`, default false until tuned)
- **Eligible:** a Kingdom+ polity p with a rival q where `0.3 ≤ relR < WAR.rLow` (a quarrel short of war), and a
  warlike, able ruler. One draw: `u < forgeK · rWar · ability` (forgeK 0.05). On a hit: `forged[r] += 1` (a per-
  relation number in bel), and `ClaimForged(capital p, a border town of q, q, 0)` is logged. relationStep adds
  `+ forgeW · forged/(forged+1)` (0.04/yr) to dR when beliefs are on.
- **Exposure:** q's (or its allies') hard precision about p gives a per-step draw, `exposeK · Ih/(Ih+1)`. On exposure:
  forged → 0, `cred[p] *= credHit`, grudges ClaimForged row, `ClaimExposed(...)`, and witnesses (grudges' witnessR,
  or the proxy +0.05 rivalry with p's other neighbours).
- Forgeries decay at `× 0.8` per step.

### 3.11 Contract additions (`src/contract.ts`)
```ts
// beliefs: states act on what they believe of each other: coerced cessions, bluffs, spies, secret alliances (230-239; none when HistoryOptions.beliefs is false).
Coerced: 230, // the polity ruled from `settlement` pressed the one ruled from `other` and it yielded without war: `value` the pressing polity's id; `extra` the towns ceded (their Joined events follow that year), 0 when it agreed to pay tribute instead (a Tribute bond)
Deterred: 231, // the polity ruled from `settlement` pressed the one ruled from `other` and backed down, judging war not worth it: `value` the other's polity id; `extra` 1 when the other's show of strength was a bluff (BluffBegun), else 0
BluffBegun: 232, // the polity ruled from `settlement` began to show more strength than it had (musters, parades, rumours): `other` -1; `value` its polity id; `extra` the strength shown, as a multiple of its own (1.6)
BluffExposed: 233, // the polity ruled from `other` saw through the bluff of the one ruled from `settlement`: `value` the other's polity id; `extra` how (BeliefSource bit: 8 marriage, 32 envoys or allies, 64 spies, 128 war)
SecretAlliance: 234, // the polities ruled from `settlement` and `other` allied in secret (History.bonds, known −1) against the polity `extra`; `value` the other's polity id. No Alliance event is logged for it
AllianceRevealed: 235, // the secret alliance of the polity ruled from `settlement` with the one ruled from `other` came to light: `value` the war it joined (History.wars), or −1 when the threat's spies found it out; `extra` the years it had been secret
SpyCaught: 236, // the polity ruled from `settlement` caught the spies of the one ruled from `other`: `value` the spying polity's id; `extra` 0
ClaimForged: 237, // the polity ruled from `settlement` put forward a forged claim to the town `other` of another polity: `value` that polity's id; `extra` 0
ClaimExposed: 238, // the forged claim of the polity ruled from `settlement` to the town `other` was exposed: `value` the exposing polity's id; `extra` the years it stood
```
```ts
/** beliefs: why a declared war was not settled by a bargain (Wars.motive). */
export const WarMotive = {
  Other: 0,       // not a bargained war (an ally joining, a civil or kin war, a player's order), or beliefs off
  Optimism: 1,    // the two disagreed about who would win by more than war would cost them (Blainey; Fearon's private information)
  Preventive: 2,  // the attacker feared the other's rising power: no bargain could bind the future (a commitment problem)
  Indivisible: 3, // a holy city was at stake, and no division of it would do
  Discrete: 4,    // a bargain existed in principle, but no town or tribute fit it
  Ruler: 5,       // the bargain failed for the ruler's will (a warlike king), though a peace was there to be had
} as const
/** beliefs: how an observer knew of a target (bits). */
export const BeliefSource = { Contact: 1, Border: 2, Trade: 4, Marriage: 8, Faith: 16, Envoys: 32, Spies: 64, War: 128 } as const

/** beliefs: one row per ordered pair of polities that ever formed a belief of the other (observer of target), in order of first forming. */
export interface Beliefs {
  count: number
  observer: Int16Array
  target: Int16Array
  /** Year the observer first formed it. */
  from: Int16Array
}
```
Wars gains:
- `believed: Float32Array`: the attacker's perceived front advantage at declaration (−1 when not bargained);
- `actual: Float32Array`: the true front advantage at declaration (−1 likewise);
- `motive: Uint8Array` (WarMotive).

All three are empty when beliefs is off; compare only the old fields.

Bonds gains `known: Int16Array`: the year it became known to other polities. It equals startYear for a public bond and
is −1 for one never revealed. The array is empty when beliefs is off.

History fields (empty when off):
```ts
/** beliefs: each polity's true strength (mass) per snapshot, like `tariff`: strength[s * polities.length + id]; 0 outside its life. */
strength: Float32Array
beliefs: Beliefs
/** Belief of each row per slow snapshot (every 10 years: q = floor(snapshot year / 10)): the observer's estimate of the target's strength (mass units; 0 none), beliefEst[q * beliefs.count + k]. */
beliefEst: Float32Array
/** Its uncertainty: log standard deviation 0..255 for 0..2.55, same layout. */
beliefSd: Uint8Array
/** The channels that informed it (BeliefSource bits), same layout. */
beliefSource: Uint8Array
/** Per snapshot per polity, like `tariff`: shown strength factor minus 1 (0..255 for 0..1), spy service (0..255), credibility (0..255). */
bluffShown: Uint8Array
spyService: Uint8Array
credibility: Uint8Array
```
`HistoryOptions.beliefs?: boolean`: "beliefs: states judge each other's strength from what they see, trade, marry,
spy and fight, and may bluff, ally in secret and misjudge (needs polities). Default true; false leaves the belief
fields empty and the history exactly the one without them."
`HistoryDiagnostics.beliefs?: BeliefDiag`: crises, coerced, deterred, wars by motive, bluffs and exposures, spies
caught, secrets revealed, mean |ln(est/true)| per decade (computed in the harness only, with Math.log).

### 3.12 Params (`src/sim/history/beliefs/params.ts`, `export const BELIEF`, a doc comment per line)
| name | default | meaning |
|---|---|---|
| enabled | false → true at step 12 | |
| shadow | false | track beliefs but declare on truth (for the step-2 identity test) |
| sigma0Sq, vDrift, vMin, vMax, vInherit | 0.6, 0.03, 0.01, 1.5, 0.1 | 3.3 |
| iContact, iBorder, iTrade, iMarriage, iFaith, iAlly, iSpy, counterK | 0.4, 0.6, 2, 2, 0.8, 4, 4, 0.7 | 3.2 |
| trendRate, horizon | 0.3, 3 | T smoothing; slow steps ahead for commitment (3 → F = ratio³ by multiplication) |
| optimism | 0.4 | ruler bias |
| pressMul | 2 | the press chance relative to today's declare chance (tuned so wars stay ±20%) |
| cWar, cDef, fundK, holyK | 0.12, 0.8, 1, 0.15 | 3.4 |
| cedeMax, tributeX, tributeVal, cedeTruce, coerceR, coercePeace | 3, 0.25, 0.3, 15, 0.2, 0.8 | |
| prevent | 0.6 | preventive drive weight |
| settleFail | 0.15 | |
| σBattle, σPeace, converge | 0.25, 0.15, 1 | 3.5 |
| bluffChance, bluffSize, bluffYears, bluffCost, credMin, exposeK, credHit, credRecover | 0.15, 0.6, 30, 0.15, 0.4, 0.25, 0.5, 0.13 | 3.6 |
| secretShare, discoverK | 0.5, 0.3 | 3.7 |
| spyR, spyCost, caughtK, caughtR, spyLeak | 0.5, 0.08, 0.15, 0.15, 1 | 3.9 |
| forgery, forgeK, forgeW, forgeDecay | false, 0.05, 0.04, 0.8 | 3.10 |
| snapStep | 10 | belief snapshot cadence (years) |

Every value is **[A]**: a **design default, not a sourced fact**. The cost and noise scales are textbook-style
guesses, not estimates. Fearon gives no numbers.

---

## 4. Determinism
- **The new stream `'history-beliefs'`** is created only when on. Its fixed draw order per slow step:
  1. inits and observations: relations in order, dir 0 then 1;
  2. exposures: rows in order;
  3. bluff decisions: `ps.alive` ascending;
  4. spies caught: spying polity ascending, then target in relation order;
  5. secret-alliance discovery: activeBonds order;
  6. forgeries.

  Then, inside declarations, the settleFail draw (at most one per crisis, in candidate order). Inside allianceStep,
  the secret draw. Inside campaigns, the battle draws.
- **Existing streams.** rngWar keeps one draw per candidate, and only its threshold changes. ps.rng is unchanged
  (alliance formation). g.rng is threshold-only in leaks. The tired-peace draw is threshold-only.
- **Arithmetic:** + − * / sqrt only. Padé noise and rpow; literal √6; F by repeated multiplication. No Map
  iteration.
- **Off identity:** every hook is `s.bel !== null ? … : old`. Check 1: `beliefs: false` gives 8cabf09 on every
  History field (42:1200, 3:600, 9:800 n=24, the repo's standard configurations).
- **Shadow identity:** check 2 (step 2): `beliefs: true, BELIEF.shadow = true` (beliefs updated, all decisions on
  truth, no bluffs, secret flag forced public, spies cost nothing) must equal off on every pre-existing field. That
  holds because bel.rng is a separate stream. This is a real vitest test while it holds, removed at step 3 with a
  commit note (the grudges 3.8 convention).
- **Golden filters:** the existing golden-hash helpers skip the keys `strength, beliefs, beliefEst, beliefSd,
  beliefSource, bluffShown, spyService, credibility`, `wars.believed/actual/motive` and `bonds.known`, and the events
  230–239. Add a beliefs-on golden at step 12.

---

## 5. UI and prose

### 5.1 Data (`ui/politiesData.ts`)
- Load `strength`, the beliefs rows and the snapshots.
- `beliefsOf(pd, o)` (rows by observer) and `heldAbout(pd, t)` (rows by target).
- `beliefAt(pd, k, year)` returns `{ est, sd, src }` from the nearest slow snapshot at or before the year, and
  `truthAt(pd, t, year)`.
- `PolityEvent` gets 230–238. Extend the `eventsOf` filter so both polities get the event.

### 5.2 "As X sees it" (`ui/politiesPanel.ts`, a new section after "Grudges"/"Bonds": `cap('As ' + name + ' sees its neighbours')`)
- At most 6 rows, sorted by rivalry, for example:
  `Oru · thought 0.6× its strength · hazy (trade, border) · ▮▮▯ vs ▮▮▮▮`.
  - The two bars are the believed and true strength on a shared log scale.
  - The confidence words come from sd: `sure` < 0.2, `fair` < 0.45, `hazy` < 0.8, else `in the dark`.
  - The sources are the BeliefSource bits in words.
  - Tags: `bluffing` when the target's bluffShown > 0 at that year and the observer still believes the shown value
    (the user sees the truth); `secret ally of …` when a bond with known −1 or known > year involves the target and a
    rival.
- The reverse line: `Seen by others as: Kubeta 1.4× · Ilun 0.9×`.
- Under the war list, for each initiated war, a tooltip: `believed 2.1× on the front, was 0.8×`.
- The memo key includes the slow snapshot index.

### 5.3 Map view `ViewMode.Beliefs = 'beliefs'` (`render/palette.ts`, `render/polities.ts`, `viewLegends.ts`)
- With a polity X selected, every other polity's territory is coloured by `ln(est_X(t)/true_t)` on a diverging ramp
  (blue: X underrates; red: X overrates; neutral: about right), with saturation falling with sd. Polities X has no
  belief of are left grey.
- **Tie-in with the known world** (`ui/peoplesPanel.ts`, `render/knownWorld.ts`): the view applies the known-world
  mist of X's ruling people (`knownCells` for `pPeople[X]`, the same mask the people=<id> view builds), so cells
  that X's people does not know are under fog.
- The banner reads `The world as the court of X saw it in 1240`. The view is available only with belief data
  (`setViewModeAvailable`, as Danger does [V politiesPanel ~l.1132 per finances 4.5]).

### 5.4 Chronicle (`ui/polityFormat.ts describeV2`, `historyIndex.ts`, `chronicleFilter.ts`)
- The WarDeclared line, when `believed ≥ 0` and `believed ≥ 1.5 · actual` (a misjudged start) or the motive is
  special, gets a clause:
  - Optimism: `Vashtar, which seems to have thought Oru weaker than it was, makes war on it`.
  - Preventive: `Vashtar makes war on the rising Oru, it seems to strike before it grew stronger`.
  - Indivisible: `… over the holy city of Tesh`.
  - The PeaceMade line of a war lost by its initiator with `believed ≥ 1.5·actual` adds `(it had misjudged Oru's
    strength)`.
- 230: `Oru yields Tesh and Mabri to Vashtar without a fight` / `Oru agrees to pay tribute to Vashtar rather than fight`.
- 231: `Vashtar presses Oru, then draws back`. When the other was bluffing it adds `(Oru's strength, it later
  appeared, was largely show)`.
- 232 (only for the polity's own event list, not a headline): `Oru makes a great show of its strength`.
  233: `Kubeta sees through Oru's show of strength`.
- 234 (not a headline; the user's god's-eye view): `Oru and Ilun ally in secret against Vashtar`.
  235: `Ilun's secret alliance with Oru comes to light as it joins the war`.
- 236: `Oru catches Vashtar's spies`. 237/238: `Vashtar lays a claim to Tesh` / `Vashtar's claim to Tesh is shown to
  be forged`.
- Headlines: 230, 235, 233 (Kingdom+). Group 230 per decade per coercer (`describeGroup`).
- The shown-type predicate gets `|| (type >= 230 && type <= 239)` [V historyIndex.ts:423, per grudges]. Category key
  `'intrigue'` (colour in polities.css). New filter group "Intrigue" in chronicleFilter.ts.
- The Chronicle register is hedged ("seems to have thought", "it later appeared"). Beliefs are inferences about
  minds, so the hedging is mandatory there.

### 5.5 Sagas (`ui/sagas/intrigue.ts`: phrase table `INT_T` `[chronicle], [legend]`, used by state.ts hWar, year.ts, reigns.ts, wars.ts)
| key | chronicle | legend |
|---|---|---|
| misjudged | In {year} the {state} went to war with the {foe}, believing it weak; the records suggest it was {k} times stronger than the {state} thought, and the war {ended}. | In {year} {ruler} looked on the quiet marches of the {foe} and thought them ripe; he had counted its spears by the light of a single lamp. |
| preventive | Fearing the growth of the {foe}, the {state} struck first in {year}. | The {foe} was waxing like the spring flood, and in {year} the {state} rode out to break the dam before it burst. |
| coercedGain | In {year} the {foe} gave up {towns} to the {state} rather than fight. | In {year} the {foe} looked on the host of the {state} and handed over {towns} without a blow. |
| coercedLoss | In {year} it yielded {towns} to the {foe} without war. | In {year} it bent the knee and gave {towns} to the {foe}, and the shame of it was long remembered. |
| bluffHeld | Its show of strength in {year}, by some accounts larger than its real strength, seems to have kept the {foe} at bay. | In {year} it lit a thousand fires for a hundred men, and the {foe} turned back. |
| bluffExposed | In {year} the {foe} saw through its show of strength. | In {year} the {foe}'s spies counted its tents and laughed. |
| secretAlly | Its alliance with the {ally}, kept secret {n} years, came to light in {year} when the {ally} joined its war. | For {n} years the pact with the {ally} lay hidden like a blade in a sleeve, until {year}, when the {ally} drew it. |
| spies | Its spies were caught at the court of the {foe} in {year}. | In {year} the {foe} hanged its spies from the city gate. |
| forged | Its claim to {town}, put forward in {year}, was afterwards shown to be forged. | Its scribes forged a claim to {town}, and the forgery was found out. |

- **Year saga:** one sentence per decade for the most striking item (a misjudged war lost, else a coerced cession).
- **Epithets** (legend register, `epithets.ts`; checked free against the existing list [V]): "the Rash" (began a war
  with believed ≥ 2·actual and lost it); "the Fox" (a bluff that deterred, or a forgery never exposed). Place them
  after "the Faithless" (grudges) and before Pretender. **[A]** Check tests that pin epithets.
- **War names** (optional, `wars.ts`): a Preventive war might be called "the War of the Rising {foe}".

### 5.6 Stats line (`polityStats.ts`) and README
- `formatPolityV2` gains crises, coerced, deterred, wars by motive, bluffs, spies and secret pacts.
- README "States" bullet: add "…judge one another by what they can see and learn, so they bluff, ally in secret, spy,
  give up towns under threat and sometimes start wars they lose".

---

## 6. Ordered commit-sized steps
Each step ends with `npm run typecheck` and the targeted vitest files green. Re-run `npm test` on an idle clean tree
first: grudges recorded 2 history.test.ts failures under load.

0. **Harness.** Copy `/home/claude/scratch-beliefs/probe-beliefs.ts` into `src/sim/history/beliefs/beliefStats.ts`,
   reading `Wars.believed/actual/motive` instead of the `globalThis` counters. It prints the section 7 table and
   runs A/B (beliefs off and on).
1. **Contract and plumbing.** Events 230–238, WarMotive, BeliefSource, Beliefs, the Wars and Bonds fields,
   HistoryOptions.beliefs, the empty assembly, the golden filters, the history.test.ts event switch, and the worker.ts
   transfer list. Goldens unchanged.
2. **BeliefState, channels, Kalman update, snapshots, strength export, shadow mode.** Add `vol` storage in
   relationStep, as a store into bel only.
   Tests:
   - `noise` and `rpow` against Math.exp and Math.pow (test file only);
   - est > 0 once formed; sd within its bounds;
   - beliefs with more channels have lower mean |ln err| (seed 42, harness assert);
   - **shadow ≡ off** test.
3. **Belief-driven drive and war learning.** Use â in drive. Add beliefBattle, the closeWar update, convergence, and
   Wars.believed/actual. Delete the shadow test (commit note).
   Tests: `believed ≥ 0` ⇔ bargained war; battles lower varL of both rows.
   Run the harness; expect more misjudged wars.
4. **Bargaining:** crisis, cession via `cedeTowns`, tribute, Deterred, motive, holy κ, preventive.
   Tests:
   - each Coerced with extra > 0 is followed that year by exactly `extra` Joined events from the yielding polity's
     members to the coercer;
   - no capital is ever ceded;
   - extra 0 ⇒ a Tribute bond starts that year;
   - motive Preventive ⇒ `F > 1`, recorded in diag.
5. **Coalitions and secret alliances:** coal_p/coal_q, the secret flag, reveal on join, discovery, the double-dealing
   betrayal (grudges hook or proxy).
   Tests:
   - every alliance bond has exactly one Alliance or SecretAlliance event at its start;
   - every AllianceRevealed belongs to a bond with known = that year;
   - bonds.known ∈ {start, −1, > start}.
6. **Spies:** service, cost, caught, the goods leak hook. Tests: SpyCaught implies both are Kingdom+ and rivals; with
   goods off, nothing breaks.
7. **Bluffs:** begin, cost, cheap-channel effect, exposure, credibility, overawe and rebel reading beliefs.
   Tests: BluffExposed always follows a BluffBegun of the same polity within bluffYears + 10; the cred snapshot
   drops after exposure.
8. **Finances and grudges coupling:** fundMul through finFundYears; finSpend for costs; grievance kinds 8–10. Each
   is guarded behind its system being present, with proxies otherwise.
9. **Forged claims** (default off).
10. **UI data, panel section, Beliefs map view, known-world tie-in.**
11. **Chronicle, sagas, epithets, polityStats, README.** Saga test: both registers fill every slot.
12. **Tuning on seeds 1, 7, 42, 1234** (section 7), then flip `BELIEF.enabled = true`. Re-record the goldens with the
    documented check ("with beliefs false the tree was checked bit-identical to …").

---

## 7. Stats harness targets (`beliefStats.ts`; each of seeds 1, 7, 42, 1234; sensitivity seeds 2, 3, 99)
| measure | baseline [M] | target |
|---|---|---|
| initiated wars won by the attacker | 79–88% | **55–70%** (the Wang & Ray benchmark, ~60%, via Lindley & Schildkraut n.d.) |
| initiated wars lost outright (DefenderGains): "misjudged" | 4–9% | **15–30%** |
| initiated wars with believed ≥ 1.5 × actual | 0 (no beliefs) | 20–40% |
| share of those the attacker lost | n/a | ≥ 2× the share for wars with believed < 1.5·actual |
| total conquest wars | 80–105 | within ±20% of baseline (tune pressMul first) |
| Coerced events | 0 | 20–60 per run |
| Deterred events (logged, Kingdom+) | 0 | 5–25 |
| wars by motive: Preventive | (defender rose ≥ 1.5× in 4–7 wars) | 3–10% of bargained wars |
| wars by motive: Indivisible | n/a | 2–8% (only where holy cities exist) |
| BluffBegun / BluffExposed | 0 | 5–20 / 30–70% of bluffs |
| SecretAlliance / AllianceRevealed | 0 | 25–50% of alliances / ≥ 1 per run |
| SpyCaught | 0 | 3–15 |
| overawe vassalages | 38–48 | ±25% |
| median war length | 6 | 4–7 (convergence shortens long wars) |
| mean abs ln(est/true) over rows with a relation: contact-only vs trade+marriage | n/a | ≥ 0.4 vs ≤ 0.2 |
| runtime vs off | n/a | ≤ +2% |

Knobs, in order of leverage:
- pressMul and settleFail: war count;
- vDrift and the precisions: the misjudged share;
- cWar: the coerced/war ratio. Higher costs widen the bargaining range, giving more cessions and fewer wars;
- bluffChance, exposeK;
- secretShare.

Baseline check: run the harness with beliefs on and BELIEF.shadow = true. It must print the section 1.5 numbers
exactly.

---

## 8. Performance and memory
- **Per slow step:**
  - O(relations · 2) observations, about 280 relations created by year 2000, 70 live [M seed 42];
  - `tied()` and `allied()` scans are O(marriages + bonds) per pair, so a few thousand operations;
  - bluff and spy loops are O(alive · relations of each).
- **Per candidate in declarations:** `protectorsOf` (O(bonds)) twice, plus the pie scan over `relEdges[r]`. Per battle:
  O(1).
- **Estimate:** under 0.5% of a 32 s run **[A]**. Measure at step 12 (target ≤ 2%).
- **History:**
  - rows ≤ 2 × relations ≈ 560, × 201 slow snapshots × 6 B ≈ **0.7 MB** (Float32 est + 2 Uint8);
  - `strength` P(70–120) × 401 × 4 B ≈ 0.1–0.2 MB;
  - 3 Uint8 per polity per snapshot ≈ 0.1 MB.

  Total about 1 MB. Halve it by storing est as Uint16 log-coded in assemble if needed. Assembly runs outside the sim
  loop, but the tests hash it, so the encoding must be deterministic: use a lookup table, not Math.log.
- **State:** JS arrays per row (8 numbers) and ~10 Float64Arrays per polity. Negligible.

---

## 9. Risks and open questions
1. **War count.** Under Fearon a perfectly informed world has no rationalist war. Here, wars come from noise,
   staleness, discreteness, commitment and settleFail. If pressMul has to be large to keep wars at baseline, the
   Coerced count will overshoot. In that case lower cWar (narrower range) rather than raising pressMul further.
   Measure the ratio early (step 4).
2. **Coerced cessions and existing events.** Joined events from `cedeTowns` read like voluntary joining in the
   current Chronicle. polityFormat must group them under the Coerced line in the same year (as grudges' separate peace
   does).
3. **polity2.test.ts tables** check every v2 event against its rows: Alliance ⇒ bond. SecretAlliance needs the same
   check, and a bond ⇒ Alliance check (if any) must accept SecretAlliance.
4. **`exposedFront` uses true Local_v.** That is acceptable (walls are visible), but it means front choice is
   true-informed. Battles may want a belief-based front choice with feints (0.4).
5. **The tribute fallback** reuses `subject(q, p, true)`, which ends alliances between the two and hands over q's
   subjects [V bonds.ts subject]. That is fine for tribute (`ps.pSub[q] < 0` is required).
6. **Parent seeding** of successor beliefs uses `pParent` [V state.ts:95]. Check that successors are created before
   the belief step in the same year [A].
7. **Overawe and rebel on beliefs** might cascade: a vassal won by bluff, freed, then war. That is intended, but watch
   the Freed counts (grudges records BondThrownOff for them).
8. **Orders.** Ordered wars skip bargaining. Should the player see "as X sees it" for their own polity's orders? Yes,
   panel-only.
9. **Feints and battles.** Deferred to battles.md through `intelEdge`. If battles is never built, feints don't exist.
   Say so in the README only once built.
10. **Spymasters as entities** are not modelled. A council plan could take pSpy over.
11. **Contested numbers.** The ~60% initiator win rate, the rarity of preventive war (Levy 1987, Reiter 1995 on
    pre-emption), and indivisibility (Fearon vs Hassner) are all debated. The targets are ranges, not fits.

## 10. Verified vs measured vs assumed
- **[V]:**
  - the declaration formula and its single rngWar draw;
  - `exposedFront`/`adv` on true projAt; allies ignored in declarations; join as a separate war; join not checking
    `allied`;
  - `peaceTerms`/`advantageAt`, `overawe` and rebel on true values;
  - no embassies (relEmb is the embargo flag); secrets.ts espionage and its capital-wealth cost; Alliance logged at
    `ally`; trade volume local to relationStep;
  - step order; `pParent`; `tied`; `holyDrive`/`rel.holy`/`rel.state`; `probe` called yearly; the epithet list;
  - 230–239 free in contract.ts at 8cabf09 (the highest id there is 180; grudges, city-states and finances claim
    190–219).
- **[M]:** section 1.5 (four seeds, 2000 years, about 250 s each with four runs at once); the relation counts and
  ruler-ability range (seed 42).
- **[A]:**
  - all parameters; the Padé approximations' adequacy;
  - the take-it-or-leave-it bargaining protocol (a simplification: Fearon's private-information case has screening
    offers with risk-return trade-offs, which this does not compute);
  - the second-hand exposure spread; perf; the battles hook names (battles.md unread);
  - grudges' `recordGrievance`/`oathBroken`/`cedeTowns` signatures; finances' `finFundYears` (an amendment they must
    accept);
  - the Wang & Ray figures (confirmed only via Lindley & Schildkraut's summary, not the paper).

## Addendum (from court-politics.md §0.4)
court-politics.md (built last) requests interface additions from this plan — read its §0.4 before implementing this plan, and add the listed functions/hooks as no-op stubs if court-politics is not yet built.

## References
Citation audit 2026-11-26. [verified] = a publisher, DOI, RePEc, library-catalogue or scholarly page confirming the
item (and, where stated, the attributed claim) was opened; [unverified] = not confirmed, with the reason. All BELIEF
parameters, the target ranges of section 7 and the cost/noise scales are **design defaults**, not sourced facts.

- Blainey, G. (1973). *The Causes of War*. New York: Free Press. https://www.cambridge.org/core/journals/american-political-science-review/article/causes-of-war-by-geoffrey-blainey-new-york-the-free-press-1973-pp-x-278-795-war-without-weapons-nonviolence-in-national-defense-by-anders-boserup-and-andrew-mack-new-york-schocken-books-1975-pp-194-650/079B9B1CAFAD9F31A0C30563B3D22F21
  [verified: bibliographic (APSR review listing); the summary of the thesis is standard but was not checked on a fetched page]
- Fearon, J. D. (1995). Rationalist Explanations for War. *International Organization* 49(3): 379–414.
  https://doi.org/10.1017/S0020818300033324 [verified: bibliographic (RePEc, Cambridge PDF); the abstract confirms that
  rational states generally have mutually preferred settlements. The bargaining-range formula [π_A − c_A, π_A + c_B] and
  the "indivisibility is rare" claim sit in the body/appendix, which the fetched copy lacked: unverified on a page,
  though standard]
- Fearon, J. D. (1997). Signaling Foreign Policy Interests: Tying Hands versus Sinking Costs. *Journal of Conflict
  Resolution* 41(1): 68–90. https://econpapers.repec.org/RePEc:sae:jocore:v:41:y:1997:i:1:p:68-90 [verified]
- Hassner, R. E. (2003). "To Halve and to Hold": Conflicts over Sacred Space and the Problem of Indivisibility.
  *Security Studies* 12(4). https://relbib.de/Record/1742986714 [verified: title and venue; page range not confirmed]
- Jervis, R. (1970). *The Logic of Images in International Relations*. Princeton: Princeton University Press.
  https://cambridge.org/core/journals/american-political-science-review/article/abs/logic-of-images-in-international-relations-by-robert-jervis-princeton-princeton-university-press-1970-pp-281-830/48DEAA9CDD36706E7F5752158DB46C28
  [verified; title corrected from "The Logic of Images"]
- Jervis, R. (1976). *Perception and Misperception in International Politics*. Princeton: Princeton University Press.
  https://press.princeton.edu/isbn/9780691177434 [verified]
- Johnson, D. D. P. (2004). *Overconfidence and War: The Havoc and Glory of Positive Illusions*. Cambridge, MA:
  Harvard University Press. https://doi.org/10.4159/9780674039162 [verified]
- Kalman, R. E. (1960). A New Approach to Linear Filtering and Prediction Problems. *Transactions of the ASME,
  Journal of Basic Engineering* 82 (Series D): 35–45. https://www.cs.unc.edu/~welch/kalman/kalmanPaper.html [verified]
- Levy, J. S. (1987). Declining Power and the Preventive Motivation for War. *World Politics* 40(1): 82–107.
  https://www.cambridge.org/core/journals/world-politics/article/declining-power-and-the-preventive-motivation-for-war/FC03E7DCEF2AC38C28687D2B451518A7
  [verified: title/venue; volume and pages not shown on the fetched result. Note that a later count puts pre-emptive
  and/or preventive wars at 29% (range 19–33%) of 79 major interstate wars 1816–1997 (Lindley n.d., handout
  https://academicweb.nd.edu/~dlindley/handouts/Pre-emptive%20and%20Preventive%20Wars.pdf), so "rare" is itself contested]
- Lindley, D., & Schildkraut, R. (n.d., c. 2005). Is War Rational? The Extent of Miscalculation and Misperception as
  Causes of War. Working paper, University of Notre Dame. https://academicweb.nd.edu/~dlindley/IWR/IWR%20Article.htm
  [verified: source of the Wang & Ray per-century rates and the COW 1815–1991 rates; venue/year not stated on the page]
- Powell, R. (2006). War as a Commitment Problem. *International Organization* 60(1): 169–203.
  https://doi.org/10.1017/S0020818306060061 [verified: Crossref metadata]
- Reiter, D. (1995). Exploding the Powder Keg Myth: Preemptive Wars Almost Never Happen. *International Security*
  20(2). [unverified: details from memory; the search budget for this audit ran out before it could be looked up]
- Slantchev, B. L. (2003). The Principle of Convergence in Wartime Negotiations. *American Political Science Review*
  97(4): 621–632. https://ideas.repec.org/a/cup/apsrev/v97y2003i04p621-632_00.html [verified]
- Smith, A., & Stam, A. C. (2004). Bargaining and the Nature of War. *Journal of Conflict Resolution* 48(6): 783–813.
  https://ideas.repec.org/a/sae/jocore/v48y2004i6p783-813.html [verified]
- Wang, K., & Ray, J. L. (1994). Beginners and Winners: The Fate of Initiators of Interstate Wars Involving Great
  Powers since 1495. *International Studies Quarterly* 38(1): 139–154. https://doi.org/10.2307/2600875
  [verified: Crossref metadata and RTI publication page; the figures only via Lindley & Schildkraut]


## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **C1 placement** (MASTER-PLAN §2.3). Beliefs replaces the drive term (â, the preventive max-term, the press semantics). It does not add a factor to the multiplier stack. `pressMul` is a calibration constant outside C1's clamp.
- **Hard stop (§9.1).** If `pressMul` must exceed 3 to hold wars at baseline, lower `cWar` before merging.
- Domestic precision from spies goes through riots' perception update only (MASTER-PLAN D-dup 12).


## Addendum (barriers & cold war)
Overrides the body and earlier addenda where they differ. Source of truth: barriers-coldwar.md (formulas, params, ids).
- **Channel modifiers (barriers §2.5), inside your §3.3 update, not a stack:**
  - cheap bits Contact, Border and Trade `×(0.3 + 0.7·e_elite(o,t))`;
  - Faith (16) × I to the faith's liturgical language;
  - Spies (64) `×(0.5 + 0.5·e_elite)`;
  - hard channels Marriage and Envoys are unchanged (interpreters).
  - Seclusion: cheap channels to and from a secluded polity ×0.5.
- **Staleness:** each channel `I ← I/(1 + I·IB.q·ℓ/365)`, where ℓ is the news lag in days (barriers §2.3) and `IB.q`
  is the measured per-year variance of Δln mass. It is small before the telegraph by design (B-R4).
- **Cold war:** `spyTarget += CW.spy 0.3·κ_ab`. Add **WarMotive 6 Crisis** for crisis-escalated wars (barriers §3.5).
  The backdown loser's `cred −= 0.5·credHit`.
- Your §9.1 war-count gate now includes crisis wars.
