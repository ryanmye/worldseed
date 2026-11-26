# Plan: Battles as first-class records (Lanchester resolution, commanders, replay)

Base: `main` @ 8cabf09 (pristine checkout `/home/claude/ryanmye/worldseed`). Branch `battles`. Plan only; no source edits.
Scratch copy with probes: `/home/claude/scratch-battles` (`probe-battles.ts`, `probe-raw.ts`, outputs `base-<seed>.json`,
`raw-<seed>.json`; `war.ts` there is instrumented with a `BDIAG` push in `battle()`, nothing else changed).
Tags: **[V]** read in the code (file:function). **[M]** measured with the probes (2000-year default runs, seeds 1, 7, 42, 1234).
**[A]** assumption or proposal to check during implementation.
Event block: **220–229** (used 220–227, 228–229 spare).

Goal: every contest roll of `war.ts battle()` becomes a recorded battle with a site, a kind, armies, commanders, weather,
a Lanchester-square-law resolution in closed form, casualties per side, a duration and a name. With modifiers neutral it
is bit-identical to today's war history. With modifiers on, war statistics stay near the baseline. Commanders can become
famous, become saga subjects, and turn into pretenders. Battles can be replayed: an MVP 2D tactical map, then full 3D in
the city view.

Depends on: nothing that is unbuilt. Rulers, disease, religion and blockades are in the repo. Optional hooks go to
grudges-and-oaths (betrayal by a general) and city-states (condottieri, signoria). Section 9 gives proxy fallbacks for
both. Build slot: after city-states, as conventions require.

---

## 1. Current behaviour

### 1.1 The contest (`src/sim/history/polity/war.ts`) [V]
- `campaigns(s, ps)` runs yearly from `polity/system.ts:137`. It comes before `warYear` (l.138) and before `rulerYear`
  (l.139). For each active war, in `activeWars` order: `blockade(s, ps, w, p, q)` from `outlaw.ts:477`, then one
  attacker battle on the best front (`campaignFront`). If `campaignFront(q→p) >= WAR.counter` (0.5), a counteroffensive
  battle follows. Then `exhaust` for both sides and the peace checks.
- `strike()` (l.210): `A = projAt(p, d) / (1 + 0.5 ravage_u)`,
  `D = projAt(q, dist_v) * (capital ? 0.5 : 1) * defense[cell_v] * (fieldWall ? wall : 1) + Local_v`. It returns `r = A/D`.
- `battle()` (l.341):
  1. `r = strike(...)`. If the attacker strikes a walled town or a capital (`siege`), the siege state updates
     (`wSiege/wSiegeYears/wSiegeFrom`, with `SiegeLifted` logged for an old siege) and `r *= 1.15^siegeYears`.
  2. `win = r²/(r²+1)`.
  3. Losses: `lu = 0.02 pop_u`, `lv = 0.02 pop_v`. These are deducted, added to `dead[]` by side, to `wDead` and to
     `diag.warDead`.
  4. Ravage, danger spikes, and field loss in v's catchment.
  5. `armyJourney(u, v, ...)`: a bounded Dijkstra over cells, logged as `JourneyKind.Army` (Dijkstra 1959) with
     `size = clamp(0.05 pMass_p, 50, 5000)` men. It also calls `learnPath`. **It makes no RNG draws.**
  6. **One draw** `ps.rngWar.next() < win`. A win calls `conquer()` (Conquered; a sack draws rngWar again) and
     `capitalFalls()` when the target was the capital. A loss during a siege adds `wSiegeYears++`.
- Since steps 3–5 make no rngWar draws, the draw can move to right after `armyJourney` without changing the stream.
  This is what makes the refactor exact.
- Military technology is already in A and D: `powerOf = pop * qualityOf * (1 + prosperity)`. `qualityOf` is built from
  Metalworking, Crafts, horses, goods arms stocks and `ideaWar` (`polity/state.ts:601`). Ruler ability enters through
  `rulerMass`, unpaid armies through finance's `pPay` in `projAt` (finance plan 2.2), exhaustion and multi-war load
  through `projAt`, terrain through `defense[cell_v]` (`defense.ts`: hill, island, peninsula, bend, confluence, pass,
  marsh, mountain, river; `T = 1 + 1.2 D`), and walls and forts through `localOf`. **New modifiers must not count
  these again** (section 3.3).
- `Wars` in `contract.ts:1253` holds kind, attacker, defender, start/end, outcome, `taken: Uint16Array` and
  `dead: Float32Array`. Nothing records a battle.
- Events: `Conquered 26` (value = war), `Sacked 27`, `SiegeLifted 28`, `Blockade 43`, `ArmyStricken 72`
  (`disease/system.ts:422`; value = war, other = the army's staging town).
- Blockade (`outlaw.ts:477`) is decided without a draw: `navyOf(p) > 0`, seafaring of p ≥ seafaring of q, and q has
  ports. It sets `pBlockade[q] = w` once and logs `Blockade`.
- Rulers [V]: `RULERS.battle` (0.012) gives a yearly chance of dying in battle while at war, drawn in `rulerYear` from
  'history-rulers' (l.~434). The overthrow chance is
  `RULERS.overthrow * max(0, 1.05 - ability) * (1 + exh + crisis + lostLately)`; its comment says "by a general (at war
  or lately) or a magnate". The usurper's house comes from `newHouseAccede`, which draws born and female from
  `R.rng`. `rAbility` is clamped to [0.45, 1.6], and `rWar` has mean 0.5 (`RULERS.warBase + rWar` has mean 1).
- Civil wars [V]: `contested()` → `rivalCentre()` → `civilWar()` (`civil.ts:77`). The pretender is the rival centre's
  claimant (`R.ctx*`).
- The sim may use only `+ - * / sqrt` (`rng.ts` header). `gauss(rng)` is Irwin-Hall (Irwin 1927; Hall 1927), from `weather.ts`. Weather
  (`weather.ts`) writes `s.harvest[region]` yearly from its own stream.
- Names [V]: `History.features: GeoFeature[]` (name, namedYear, anchorCell, spine) plus `FeatureMap`
  (per-cell `river/river2/relief/cover/water/lake`, `names/features.ts`). Both are available during assembly in
  `history/index.ts:~602`, where tourism already gets `(names, features, featureMap)`. `settlementNameAt(h, id, year)`
  is in `contract.ts:666`.
- Sagas [V]: `ui/sagas/voice.ts` has `PhraseTable = Record<key, [chronicle[], legend[]]>`. `wars.ts warName()` names
  wars. `scenes.ts` has set pieces: `sackScene` is the model to copy. `SagaKind` is
  `'world'|'people'|'state'|'city'|'house'|'decade'|'year'`.
- Render [V]: `render/cityView.ts` flies to a settlement and orbits it (`flyIn(id)`, `CityAim`, the Y shortcut at
  `main.ts:1020`). `dioramas/layer.ts` lays out models near the focus camera (`setFocus`) and has the `Banner`, `Smoke`,
  `Rubble`, `Ship`, `ShipMedium`, `Cart` and `Barracks` models (`models.ts:28`). `dioramas/surface.ts` `probe()` gives
  ground radius and normal anywhere. `render/quality.ts` has Phone presets (`townShadows: false`, `playFps 30`).

### 1.2 Baseline war statistics [M] (unmodified sim, `probe-battles.ts`)

| seed | wars | battles (att / counter) | att win | field win | at walled/capital (n, win) | counter win | taken | dead | len med / p90 | Conquest / AttGains / DefGains / White / Tribute / Vassal / Reunified | Sacked | SiegeLifted | Blockade | ArmyStricken |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 119 | 1250 (849 / 401) | .648 | .684 | 87, .322 | .439 | 1157 | 29k | 6 / 13 | 15/59/13/8/8/10/5 | 254 | 9 | 25 | 50 |
| 7 | 111 | 1078 (736 / 342) | .591 | .616 | 89, .348 | .541 | 992 | 30k | 6 / 13 | 15/47/23/5/2/10/9 | 210 | 16 | 34 | 42 |
| 42 | 116 | 1158 (792 / 366) | .568 | .624 | 148, .284 | .544 | 1204 | 64k | 7 / 13 | 22/38/15/13/5/16/5 | 226 | 17 | 25 | 55 |
| 1234 | 90 | 930 (622 / 308) | .548 | .641 | 141, .191 | .442 | 655 | 72k | 6 / 13 | 8/41/14/12/2/5/3 | 158 | 27 | 36 | 51 |

More [M]:
- `ln r` per battle (after siege attrition) has mean 0.20–0.29 and sd 1.09–1.84; p10 is −0.6 to −1.1 and p90 +1.6 to
  +1.7. The mean predicted attacker win equals the realised rate to ±0.03, which is a sanity check of the probe.
- Losses per battle: median 5–7 people, mean 19–69, p90 37–159. Front settlements (u + v) have median 263–361 people
  and p90 1.8k–7.9k. Losses are 2% of the front towns, so they are tiny next to the army.
- Army (journey) size: median 668 (seed 42) and 2368 (1234); p90 is the clamp of 5000, which binds in 11–24% of
  battles. Baseline loss / army has median 0.009–0.014 and p90 0.16. **So army-level Lanchester casualties of 10–40%
  cannot simply be deducted from the population.** Doing so would raise `Wars.dead` and exhaustion 10–40 times (see 3.5).
- Battles per war: median 8–10, p90 16–24, max 52. At most 2 battles per war-year (attack and counter). 2–10 battles
  per calendar year worldwide; 374–563 years of the 2000 see a battle.
- Siege year index at the assault: median 1, p90 4–5, max 9. 107–135 battles per run are at capitals.
- Approach path (`armyJourney`): length median 3–4 cells, p90 5–13. 28–40% of battles have a river cell on the last
  four cells of the approach, and 2–4% have a sea cell (overseas attacks). The best defence among the approach cells
  divided by `defense[cell_v]` has p50 1.00 and p90 1.17–1.57.
- Run time was about 205–220 s per seed with 4 runs in parallel on a shared, loaded box. Single-run timings in other
  plans are ~32 s.

### 1.3 Sensitivity of the attacker-win rate [M] (Monte Carlo on a normal fit of the measured ln r)
Let `M` be a battle's multiplicative modifier on the odds (section 3). Then `P = E[σ(2 ln r + ln M)]`:
- Zero-mean noise in `ln M` with sd 0.4 changes the win rate by ≤ 0.0013. With sd 0.6 the change is ≤ 0.0018 on all
  four fits. This matches the probit approximation `slope' = slope / sqrt(1 + π s²/8)` (MacKay 1992).
- A **bias** of −0.1 in mean `ln M` lowers the attacker win rate by 0.010–0.014.
- So the calibration target is the **mean** of `ln M`, `|E ln M| ≤ 0.05` (about ±0.006 in win rate). The spread is free.

---

## 2. Model: Lanchester square law in closed form, and why it reduces to today's roll

### 2.1 Equations
For aimed fire or massed melee, the square law (Lanchester 1916, *Aircraft in Warfare*):
`dA/dt = −β D`, `dD/dt = −α A`, where α and β are the per-man effectiveness of attacker and defender.
- Invariant: `α A² − β D² = const`. No time integration is needed for who wins or how many are left.
- Break points (morale): a side quits when it falls to a fraction `b` of its strength. The loss at which a unit breaks is not a fixed
  number: Clark (1954, ORO) called a fixed casualty breakpoint "a gross oversimplification not supported by combat
  data", and 15 of her 43 broken battalions had lost more than 40% (both as summarised by The Dupuy Institute 2018a); the later HERO
  study behind Dupuy (1990, *Understanding Defeat*) was inconclusive. The figure "10–30% losses (Dupuy 1987)" given
  here before could not be sourced and is withdrawn. **Default `b = 0.8` (break after 20% loss) is a design default.**
- Let `x = α A0² / (β D0²)`, the attacker's square-law strength ratio. The attacker wins when D reaches `b_D D0` before
  A reaches `b_A A0`. That holds iff `x · (1 − b_A²) ≥ (1 − b_D²)`, i.e. `x ≥ x* = (1 − b_D²)/(1 − b_A²)`.
- Survivors, with sqrt only:
  - Attacker wins: `fA = 1 − sqrt(1 − (1 − b_D²)/x)` and `fD = (1 − b_D) + b_D ρ` (rout).
  - Defender wins: `fD = 1 − sqrt(1 − x (1 − b_A²))` and `fA = (1 − b_A) + b_A ρ`.
  - A close fight (x near x*) has the winner left near its own break point: a Pyrrhic victory emerges without a rule.
- Duration, with τ = k t and k = sqrt(αβ), and ρs = sqrt(x) (side strengths normalised). The breaking side's strength
  is `cosh τ − ρs sinh τ` (or the mirror). For ρs ≠ 1, the time to reach b solves
  `z = e^τ = (sqrt(b² + ρs² − 1) − b)/(ρs − 1)`, so `τ = ln z`. For ρs = 1, `τ = ln(1/b)`. `ln` is not allowed in the
  sim, so `lnSqrt(y)` (new in `util.ts`) takes 12 square roots, `y^(1/4096) = 1 + ε`, and returns
  `4096 (ε − ε²/2 + ε³/3)`: error < 1e-9 for y in [1e-6, 1e6], `+ - * / sqrt` only. Hours = `BATTLE.hourScale * τ`,
  clamped to [0.5, 14]. Beyond 14 h the battle is told as "two days". With hourScale = 20, an even fight with x' = 1.2
  and b = 0.8 gives τ = 0.204, i.e. 4.1 h.
- Empirical standing (say so in the file header): Engel (1954, *J. Operations Research Society of America* 2(2):163)
  fitted Iwo Jima with the square law. Willard (1962, "Lanchester as Force in History", Research Analysis Corp.) fitted
  land battles of 1618–1905 and got parameters far from the square law (fitted g between −0.27 and −0.87, mostly near
  −0.5, as summarised by The Dupuy Institute 2018b). Bracken (1995, *Naval Research Logistics* 42(4):559) found that the **linear**
  law fit the Ardennes 1944 data in all four of his model variants. Lucas & Turkes (2004, *NRL* 51(1):95) found that
  neither the square, linear nor logarithmic law fits Kursk or the Ardennes well. **The square law is a stylised model. We keep exponent 2 because the
  baseline is exponent 2 (section 2.2).** A Helmbold-type exponent (Helmbold 1965) would need `pow` and would break the reduction.
  (Citations checked; see References.)

### 2.2 Reduction to `r²/(r²+1)` (exact, not only on average)
Today `A` and `D` are strengths in which quality counts twice: `(q N)² = q² N²`. Read this as quality acting once on
lethality and once on protection. That is the square law with `α ∝ q_A²` per man, which equals `α A0²` with
A0 = qN counted once. So the neutral Lanchester ratio is exactly `x = r² = (A/D)²`.

Randomness: the day's luck multiplies the attacker's effectiveness by a factor L. Take L log-logistic(1): `L = (1−U)/U`
for the uniform draw U. Then P(win) = P(x L ≥ x*) = P(U ≤ x/(x + x*)), the ratio-form (Tullock 1980) contest success function.
A Gumbel noise derivation gives the same (Jia 2008, *Public Choice* 135:125; Hirshleifer 1989, *Public Choice* 63:101
for the ratio form). The comparison `U < x/(x+x*)` is the same single rngWar draw as today's `rng.next() < win`. With
M = 1 and b_A = b_D, x* = 1, and `x/(x+1)` is computed with the same float operations as `r*r/(r*r+1)`.
**The outcome is bit-identical draw for draw.** The realised ratio `x' = x · L` (with M) then drives casualties,
duration and the replay. So the record is consistent with the outcome: the winner is always the side the closed form
says breaks the other first.

With modifiers on: `x = r² · M`, `x* = (1−b_D²)/(1−b_A²)`. Win rate statistics move only through `E[ln M − ln x*]`
(1.3). The harness measures that mean directly; the UI and stats code may use `Math.log`.

---

## 3. Design

### 3.1 Module layout (`src/sim/history/battles/`, a sibling of `rulers/` and `disease/`)
| file | content |
|---|---|
| `params.ts` | `export const BATTLE = {...}` (3.6), `BATTLES_ON` default |
| `state.ts` | `BattleState` (3.7), `createBattles(s)` with rng `'history-battles'` |
| `lanchester.ts` | pure: `resolve(x, xs, bA, bD, rho, U) → {winner, fA, fD, xEff, tau}`, `lnSqrt`, `strengthAt(t)` docs for the UI |
| `site.ts` | `pickSite(s, bs, path, u, v, kind, rngDraw)`, `siteFlags(cell)` |
| `commanders.ts` | appoint, skill, fame, death, dismissal, retirement; rulers hooks |
| `system.ts` | `battleFought(...)` (the war.ts hook), `navalBattle(...)` (the blockade hook), `battlesYear()` (fame decay, coups), event scan for ArmyStricken |
| `assemble.ts` | `assembleBattles(bs, h, names, features, featureMap) → {battles, commanders}`, `emptyBattleHistory()` |
| `battleStats.ts` | the stats harness CLI (section 6) |
| `battles.test.ts` | tests (section 5) |
`HistoryState` gains `bat: BattleState | null`. It is null when off or when polities are off. Every hook guards on
`s.bat !== null` (the `s.rul` pattern).

### 3.2 Contract (`src/contract.ts`), drafted in codebase style

```ts
// ---------------------------------------------------------------------------
// battles: the battles of the wars (HistoryOptions.battles; all empty when it or polities is false).

/** Kinds of battle (History.battles). */
export const BattleKind = {
  Field: 0, // two field armies met on the way to the town struck (`target`), at `site` on the approach
  Siege: 1, // an assault on a walled town or a capital under siege (`siegeYear` the year of the siege it fell in, 0 the first)
  Relief: 2, // the besieged side's army struck the besiegers' base or lines (a counteroffensive while the enemy besieged one of its towns)
  Naval: 3, // fleets fought for the sea off the enemy's main port (before a blockade); men are ships
  Ambush: 4, // a field battle the defenders opened by surprise from cover (wood, hills, a pass)
  Landing: 5, // an army come over the sea fought at the shore where it landed
} as const
export type BattleKind = (typeof BattleKind)[keyof typeof BattleKind]

/** Weather on the day of a battle. */
export const BattleWeather = { Clear: 0, Rain: 1, Fog: 2, Snow: 3, Heat: 4 } as const
export type BattleWeather = (typeof BattleWeather)[keyof typeof BattleWeather]

/** What a battle's ground and course were (History.battles flags, bits). */
export const BattleFlag = {
  Ford: 1, // the attackers crossed a river at `site`
  Pass: 2, // a narrow way between heights
  Hill: 4, // one side held high ground (the side that chose the ground: GroundByDefender)
  Wood: 8, // in or beside a forest
  Marsh: 16,
  Coast: 32, // on the shore (a landing) or, for a naval battle, within sight of land
  Surprise: 64, // one side was caught unready (SurpriseByDefender says which)
  SurpriseByDefender: 128,
  GroundByDefender: 256, // the defenders chose where to stand
  Flank: 512, // the winners turned a flank (cavalry or a second line): the replay's flank phase
  Pursuit: 1024, // the beaten side was cut down in flight (rout losses at least BATTLE.pursuitLog of its men)
  Pyrrhic: 2048, // the winners lost at least BATTLE.pyrrhic of their men
  Outnumbered: 4096, // the winners had fewer men
  TargetFell: 8192, // `target` was taken this year as a result (Conquered follows)
  RulerLed: 16384, // a ruler led one of the armies in person (cmdA or cmdD is a ruler: Commanders.reign >= 0)
  Feint: 32768, // the better-informed side drew the other onto ground of its choosing (beliefs: intelEdge)
} as const

/**
 * Battles, struct-of-arrays in the order they were fought (the battle id is the index). Every contest of a war-year is
 * one battle: the attacker's strike on its best front, the defender's counterstroke, a naval battle before a blockade.
 * The battle's attacker is the side that struck (for a counterstroke the war's defender: `counter` 1). The armies'
 * figures are men under arms (ships for a naval battle); `lossA` and `lossD` are their casualties (killed, wounded, taken
 * and scattered) from the Lanchester solution (`ratio`, `breakA`, `breakD`), while `dead` is the people the front towns
 * lost, counted in Wars.dead.
 */
export interface Battles {
  count: number
  /** History.wars id, and the year. */
  war: Int32Array
  year: Int16Array
  kind: Uint8Array
  counter: Uint8Array
  /** Cell where it was fought; the town struck (Siege: the besieged; Naval: the enemy's main port); where the attackers marched from (Naval: their main port). */
  site: Int32Array
  target: Int32Array
  from: Int32Array
  /** Polity ids of the battle's attacker and defender. */
  attacker: Int16Array
  defender: Int16Array
  /** History.commanders ids, or -1 (no named commander: a levy, a garrison). */
  cmdA: Int32Array
  cmdD: Int32Array
  menA: Float32Array
  menD: Float32Array
  lossA: Float32Array
  lossD: Float32Array
  dead: Float32Array
  /** 0 the attacker won (the defenders broke), 1 the defender won. */
  winner: Uint8Array
  /** Hours from the first clash to the break (BattleFlag aside, about 0.5 to 14). */
  hours: Float32Array
  weather: Uint8Array
  flags: Uint16Array
  /** Lanchester terms as fought: x' = alpha A0^2 / (beta D0^2) with the day's luck, and the break fractions (strength left when each side would break). */
  ratio: Float32Array
  breakA: Float32Array
  breakD: Float32Array
  siegeYear: Uint8Array
  /** "the Battle of Vebena Ford", "the Siege of Kubeta", "the Second Battle of Ashtar Field" (names at the battle's year). */
  name: string[]
}

/** How a commander's career ended (History.commanders). */
export const CommanderFate = {
  Serving: 0, // still in command (or in the realm's service) at the end of the run
  Slain: 1, // killed in battle (`fateBattle`)
  Taken: 2, // captured in battle and never heard of in command again
  Dismissed: 3, // relieved after a defeat
  Retired: 4, // old age or death in bed
  Seized: 5, // overthrew the ruler and took the throne (History.rulers reign `reignAfter`)
  Rose: 6, // led a rising against the realm (a civil war, Wars id in `fateWar`)
  Turned: 7, // went over to the enemy with the town he held (grudges: a betrayal)
  RealmEnded: 8,
} as const

/**
 * Commanders of armies, struct-of-arrays in order of first command. A commander is the realm's ruler leading in person
 * (`reign` >= 0, one row per reign that led) or a general appointed for a war (`reign` -1; `dynasty` >= 0 when a kinsman of
 * the ruling house). `skill` (about 0.6..1.5, mean 1) multiplies his army's effectiveness (Lanchester alpha); `fame` grows
 * with victories (more for a decisive one, against odds, over a famous enemy, a capital taken) and fades slowly; a
 * commander of BATTLE.renown fame is a saga subject (CommanderRenowned).
 */
export interface Commanders {
  count: number
  polity: Int16Array
  people: Int16Array
  reign: Int32Array
  dynasty: Int32Array
  born: Int16Array
  female: Uint8Array
  skill: Float32Array
  firstYear: Int16Array
  lastYear: Int16Array
  battles: Uint16Array
  wins: Uint16Array
  /** Fame at its peak, the year of the peak. */
  fame: Float32Array
  fameYear: Int16Array
  fate: Uint8Array
  fateYear: Int16Array
  /** Battle he fell or was taken in; war he rose in; reign he founded (-1 each when not so). */
  fateBattle: Int32Array
  fateWar: Int32Array
  reignAfter: Int32Array
  /** Personal name (a ruler's: his regnal name); epithets are the UI's. */
  name: string[]
}
```
- `History.battles: Battles`, `History.commanders: Commanders`.
- `HistoryOptions.battles?: boolean`: "battles: every contest of a war is a recorded battle (History.battles) with its
  site, armies, commanders, weather and Lanchester resolution; commanders may grow famous and seize thrones. Default
  true (needs polities); false gives the history without them. With BATTLE.neutral the battles are recorded but change
  nothing: every other field is the same as with battles off (events aside, which gain 220–227)."
- EventTypes (220–229):
```ts
  // battles (220-229; none when HistoryOptions.battles is false). `value` is the History.battles or History.commanders row.
  BattleFought: 220, // battle `value` was fought for `settlement` (its target; Naval: the enemy's main port); `other` the settlement the attackers came from; `extra` kind | winner << 3 (0 the attackers won). Logged when menA + menD >= BATTLE.logMen, or a commander fell, or the target fell, or it is the first battle of its war
  SiegeLaid: 221, // a siege of `settlement` began (the first assault of a siege); `other` the besiegers' base; `value` the war id. (SiegeLifted 28 or Conquered 26 ends it)
  CommanderFell: 222, // commander `value` was killed (extra 0) or taken (extra 1) in battle at `settlement`; `other` -1. Logged for named commanders with >= 2 battles, rulers always
  CommanderRenowned: 223, // commander `value` won the fame of a saga's hero (fame reached BATTLE.renown) with the battle at `settlement`; `other` the capital he served
  GeneralSeized: 224, // general `value` overthrew the ruler of the polity ruled from `settlement` and took its throne; `other` the town he came from (his last base); `extra` the new reign (History.rulers)
  GeneralRose: 225, // general `value` led a rising from `settlement` against the realm ruled from `other` (a CivilWar event follows); `extra` the war id
  GeneralTurned: 226, // general `value` went over to the enemy ruled from `other` with the town he held, `settlement` (Defected follows); `extra` the war id
  CommanderDismissed: 227, // commander `value` (a general) was relieved after a defeat at `settlement`; `other` the capital; logged for commanders with fame >= BATTLE.renown / 2 only
```
`Wars` is unchanged. A war's battles are found from `Battles.war`; `ui/battlesData.ts` keeps an index.

### 3.3 Modifiers: what enters x, x*, ρ (and what must not)
Already in r (section 1.1): numbers, quality (tech, arms, horses), distance, exhaustion, ruler ability (mass), pay,
the target cell's terrain, walls and forts. Each new term is a ratio of the attacker's term to the defender's, so that
`E[ln M] ≈ 0` by symmetry. Any asymmetry is measured.

`x = r² · M_ground · M_cmd · M_supply · M_sick · M_surprise · M_weather` (where M_weather may also compress, see below)

1. **Ground** (field, ambush, landing only; sieges keep T_v). The site's terrain replaces half of the target cell's
   terrain in D: `D' = D sqrt(T_site / T_v)`, so `M_ground = T_v / T_site`. Who chooses the ground: the defender with
   chance `sD / (sA + sD)` (the commanders' skill, 0.5 without commanders), one draw. A choosing defender takes the
   highest-T cell on the approach; a choosing attacker takes the lowest (forcing battle on open ground). This is
   symmetric, so E ln M_ground ≈ 0 [A; the harness checks, and today's best/target ratio has p50 1.0, p90 1.17–1.57 [M]].
2. **Commanders**: `M_cmd = skill_A / skill_D` (skill multiplies α, Lanchester's per-man rate; exponent 1). Skill is
   iid at appointment, so the mean is 0 up to selection effects: winners keep command, and attackers win more often.
   Veterancy is +BATTLE.veteran per battle, capped. [A] The harness reports E ln M_cmd.
3. **Supply**: `M_supply = (0.8 + 0.2 fA) / (0.8 + 0.2 fD)`, where `f = clamp(food, 0, 1)` at the side's front town,
   times `s.harvest[region(site)]` capped at 1 for the side that marched (the attacker, or the relief). This reads
   weather.ts's regional anomaly: a drought year starves the marching army.
4. **Disease**: an army whose war logged ArmyStricken against its side in the last BATTLE.sickYears (2) gets
   `α × BATTLE.sick` (0.8). It is found by scanning `s.events` from `bs.evSeen` for type 72, `value = w`, and
   `polity(other)` = the side. disease/ is not touched. This bias always falls on the marching side; expect about
   −0.01 in E ln M from ~5% of battles [M: 42–55 ArmyStricken per ~1000 battles].
5. **Surprise / ambush**: one draw. The chance is
   `BATTLE.surprise (0.06) · (fog ? 3 : 1) · (1 + cover)`, where cover = 1 if the site has Wood, Pass or Hill, and the
   result is times `(skill of the better commander / skill of the worse)`. Who surprises: a second draw, the defender
   with chance `0.5 + 0.25 (sD − sA)` (clamped .25–.75). The surprised side loses BATTLE.surpriseLoss (0.15) of its men
   in the opening volley, before the square-law phase. With beliefs built, `e = intelEdge(s, att, def)` in [-1, 1]
   (9.6): the chance is × (1 + 0.5|e|), and the defender's share of surprises is shifted by −0.2e (a side that knows
   more surprises more). A **feint**: if |e| ≥ BATTLE.feintEdge (0.5), the better-informed side chooses the ground
   (3.3.1), overriding the skill-based draw outcome (the same draw is made). Flag `Feint = 32768`. The
   surprise effect itself: `M_surprise = 1/(1 − 0.15)² = 1.384` for the surpriser
   (inverted for the surprised). A defender's surprise in a field battle makes the kind **Ambush**.
6. **Weather** (one draw for wet, one for fog, always):
   - Rain: chance `BATTLE.rain · (0.5 + rainfall_site) · (harvest > 1.1 ? 1.5 : 1)`. It **compresses** the advantage,
     `x → sqrt(x)`: mud and wet bowstrings blunt both cavalry and missile superiority. This is not a bias, only a
     spread change (1.3).
   - Fog: chance `BATTLE.fog · coastal/valley factor`. It triples the surprise chance and has no α change.
   - Snow: `temperature_site < BATTLE.snowT` and the rain roll succeeded (precipitation): the attacker's α × 0.9.
   - Heat: hot desert or steppe biome on a clear day: the attacker's α × 0.92.
   - Snow and heat are small biases against the marching side, measured.
7. **Morale (x\*)**: `b_side = clamp(BATTLE.break0 − 0.1 (asab − 0.5) − (zealous ? 0.05 : 0) − (fame ≥ renown ? 0.04 : 0) + 0.1 min(1, exh), 0.6, 0.92)`.
   asab is the side's front town cohesion `ps.asab[u|v]`. Zealous = a holy war (`religion` HolyWar for this war) for the
   side whose faith declared it. Lower b fights longer. x\* moves the threshold; both sides' terms come from the same
   function.
8. **Rout ρ** (only casualties, never the outcome):
   `ρ = BATTLE.rout (0.15) · (1 + horse_winner − horse_loser, clamped 0.5..2) · (river behind the loser ? 1.5 : 1) · (snow or wood ? 0.6 : 1)`.
   "River behind" = the site has Ford and the loser is the side that crossed.
9. **Flank flag** (replay and prose only): the winner had `horse_winner > horse_loser + 0.2`, or surprise, or
   `x' > 4` (or `< 1/4`).

Neutral mode (`BATTLE.neutral = true`): every M = 1, b_A = b_D = break0, ground and weather drawn but not applied,
toll not split. **The outcome uses `x = r*r`, `xs = 1`.** Test: wars and events are bit-identical to battles off
(section 5).

### 3.4 Site (`site.ts`)
- `armyJourney` returns its `path` (today it returns void after `logJourney`). Refactor: it returns
  `number[] | null` and the logging is unchanged. If the path is null (no route within budget), the site is
  `cell_v` for a siege, else the first neighbour of `cell_v` toward `cell_u` by dot product (deterministic).
- Siege: site = `cell_v`.
- Landing: the path has a sea cell; site = the first land cell after the last sea cell, flag Coast.
- Field / Ambush: candidates are the last `BATTLE.reach` (3) land cells of the path before `cell_v`, plus `cell_v`'s
  path predecessor. The ground draw (3.3.1) picks max or min `T`. Ties go to the cell nearest v. If the path crosses a
  river (a cell c with `flow ≥ RIVER_FLOW_THRESHOLD`, not a lake, whose path predecessor is not on the same river
  feature), that cell counts its `T + BATTLE.fordBonus (0.3)` for the defender's choice: defenders hold the crossing.
- Flags per cell come from a new `defenseFeat: Uint8Array` returned by `buildDefense` (`defense.ts`). It holds the bits
  already computed there (hill, river, bend, confluence, pass, marsh, mountain), plus Wood from `biome` (forest
  biomes). **`defense` and `defenseD` are unchanged**, so there is no behaviour change. ps gets `defenseFeat`.
- Naval: site = the sea cell next to q's main port that is nearest p's capital (graph cost through `T.moveCost`,
  within 6 hops, else the port's first sea neighbour). Coast flag if it borders land.

### 3.5 Casualties and the population toll
- Men:
  - `menA = clamp(WAR.army · pMass_att, armyMin, armyMax)`. This is exactly the Journey's `size`, so the map's army and
    the battle agree.
  - `menD = menA · (D/A) · (q_A / q_D)`, with q = `qualityOf` at u and v. For a siege the result is divided by
    `wallFactor(v)`: walls multiply strength, not men. Clamped to [armyMin/2, 3 armyMax]. [A: the defender figure is
    derived; it is a chronicler's number, not a state variable.]
  - Naval: ships = `clamp(BATTLE.shipsPerPort · pPorts · navyOf, 3, 300)` per side.
- `lossA = fA · menA` and `lossD = fD · menD` (3.3, 2.1).
- **Population toll** (`BATTLE.toll = 'split'`, default; 'baseline' in neutral):
  - The total is unchanged: `T = WAR.battle · (pop_u + pop_v)`, the same as today.
  - It is split by casualties: `dead_A = T · lossA / (lossA + lossD)`, with the attacker's share taken from u and the
    defender's from v, each capped at `2 WAR.battle` of its town. Any excess goes to the other side.
  - So `Wars.dead` per battle is identical to baseline, and the loser pays more.
  - Exhaustion `dead[]` follows the split, so the beaten side tires faster. The harness checks war length.
  - Deducting all army casualties from the realm would be 10–40× today's toll [M: loss/army median ~1%]. Because of
    that, the realm toll is only partial, in the `'escalate'` mode of 3.12.
- `BATTLE.toll` has three modes: `'baseline'` (neutral), `'split'` (step 6: the mean is preserved, the loser pays
  more) and `'escalate'` (step 6b: the heavier tail of 3.12, which becomes the default once realism passes).

### 3.6 Params (`battles/params.ts`, `export const BATTLE`, doc comment per line)
| name | default | meaning |
|---|---|---|
| neutral | false | record only: M = 1, equal breaks, baseline toll (bit-identical wars) |
| break0 | 0.8 | strength left when a side breaks (lost 20%) [design default; the data show no fixed breakpoint: Clark 1954, Dupuy 1990] |
| rout | 0.15 | pursuit loss share of what is left of the beaten side |
| hourScale | 20 | hours per unit τ (an even fight ~4 h) |
| reach | 3 | approach cells considered for the field |
| fordBonus | 0.3 | added T for a defended crossing in the defender's choice |
| surprise, surpriseLoss | 0.06, 0.15 | surprise chance base, share lost to the opening volley |
| rain, fog, snowT | 0.18, 0.06, −2 °C | weather chances and snow threshold [A] |
| snowMul, heatMul | 0.9, 0.92 | the attacker's α in snow, in heat |
| sick, sickYears | 0.8, 2 | stricken army's α; how long after ArmyStricken |
| skillSd, skillMin, skillMax | 0.2, 0.6, 1.5 | new general's skill = clamp(1 + skillSd·gauss) |
| veteran, veteranMax | 0.02, 0.1 | skill gained per battle survived |
| rulerLead | [0.9, 0.6, 0.4, 0.2] by Tier (Chiefdom..Empire) × (0.5 + rWar) | chance the ruler leads a war's army himself |
| kin | 0.25 | an appointed general is a kinsman of the ruling house |
| slainLoser, slainWinner, taken | 0.06 + 0.3 ρ, 0.01, 0.03 | commander killed / captured per battle |
| rulerSlain | same as slainLoser | ruler commanding: sets R.kill = ReignEnd.Battle |
| rulerBattleCut | 0.5 | RULERS.battle × this when battles are on and not neutral (keeps ruler battle deaths near baseline; harness) |
| dismiss | 0.35 × (1 − min(1, fame / renown)) | chance a beaten general is relieved |
| retireAge | U(55, 72) drawn at appointment | |
| fameWin, fameDecisive, fameOdds, fameCapital, fameDecay | 1, +1 if loser f ≥ 0.3, × menEnemy/menOwn (≤ 3), +2, ×0.97/yr | fame |
| renown | 6 | CommanderRenowned, a saga subject |
| coup, coupFame | 1.0, 1/renown | overthrow chance × (1 + coup · min(2, fame · coupFame)) when a general of fame ≥ renown/2 serves |
| riseBar | 0.6 | a famous general's base qualifies as a rival centre at riseBar × the usual bar |
| turn | 0.004 / yr | a famous general passed over (dismissed while fame ≥ renown/2) turns, if grudges are on |
| logMen, pursuitLog, pyrrhic | 1500, 0.1, 0.15 | event and flag thresholds |
| shipsPerPort | 12 | |
| navalDecides | false (step 7 → true after harness) | a lost naval battle prevents the blockade that year |
| toll | 'split' → 'escalate' at step 6b | population toll mode (3.5, 3.12) |
| realmShare, kill, coalition, annihilate | 0.5, 0.25, 0.5, 0.15 | escalation (3.12) [A, tuned against realism] |
| tempo, decisivePeace | true (step 6c), 0.3 | war tempo (3.12) |
| feintEdge | 0.5 | beliefs intelEdge needed for a feint |

### 3.7 BattleState (`battles/state.ts`)
- `rng: Rng` (`createRng(seed, 'history-battles')`), `neutral: boolean`.
- Battle rows: ragged `number[]` per field of `Battles` (prefix-stable, the rulers style), plus `bWar…`.
- Per war (pushed when the hook first sees a war id, grown to `ps.wKind.length`): `wCmd: number[]` (2 per war:
  attacker side, defender side), `wSiegeBattle0` (for SiegeLaid), `wSick: number[]` (2 per war: last ArmyStricken
  year per side).
- Per polity (grown with ps.P): `pVeteran: Int32Array` (best surviving general to recall in the next war, -1).
- Commander rows: cPolity, cPeople, cReign, cDyn, cBorn, cFemale, cSkill, cFirst, cLast, cBattles, cWins, cFame, cPeak,
  cPeakYear, cFate, cFateYear, cFateBattle, cFateWar, cReignAfter, cRetire, cBase (last staging town).
  `cActive: number[]`. Map `reignCmd: Map<reign, cmd>`.
- `evSeen` (event scan cursor), `diag: BattleDiag` (counts by kind, weather and surprise; the M factors per battle are stored
  raw, and battleStats takes the logs, because the sim may not use Math.log).

### 3.8 The hook in `war.ts battle()` (refactor, exact in neutral)
```
let r = strike(...); siege/attrition as now
const lu0 = WAR.battle * s.pop[u], lv0 = WAR.battle * s.pop[v]
const path = armyJourney(s, ps, u, v, d - ps.dist[u], ps.pMass[p])        // moved up: no draws, no pop dependence
const U = rng.next()                                                       // the same single rngWar draw
let won: boolean, lu = lu0, lv = lv0
if (s.bat !== null) { const o = battleFought(s, s.bat, ps, w, p, q, u, v, d, attacker, siege, r, U, path, lu0, lv0); won = o.won; lu = o.lu; lv = o.lv } // battles:
else won = U < (r * r) / (r * r + 1)
pop deductions (lu, lv), dead[], wDead, diag, ravage, spikes, fields     // as now, before conquer
beliefBattle(s, w, p, q, strikeA, strikeD)                                 // beliefs plan 0.4: keep this call (pre-modifier strengths)
if (won) { conquer...; capitalFalls... } else if (attacker && siege) wSiegeYears++
```
- Checks: `armyJourney` reads `s.founded`, `ps.pMass`, terrain and scratch arrays. It does not read `s.pop`. `learnPath`
  reads the path, not pop [A: verify `learnPath` reads no pop or danger that the spikes change; if it does, keep the
  journey after the spikes and compute the site after it. The draw stays where it is.]
- In `conquer`, `Battles.flags |= TargetFell` is set through `s.bat.lastBattle`.
- Counter battles: `attacker=false`. They are `counter = 1`. The kind is Relief when `ps.wSiege[w] >= 0` and the
  besieged town's graph neighbours include v or v = `wSiegeFrom[w]`.
- SiegeLaid: logged when `siege && attacker && ps.wSiegeYears[w] === 0 && ps.wSiege[w] === v` before the roll, i.e.
  the first assault.
- Blockade hook: in `outlaw.ts blockade()`, after the guards and the port search, and only if `navyOf(q) > 0`:
  `if (s.bat !== null && !navalBattle(s, s.bat, ps, w, p, q, port)) return`. With `navalDecides` false,
  `navalBattle` records the battle, forces the attacker's win (the outcome is decided by today's rule) and returns
  true. Its draws are from the battle stream only.

### 3.9 Commanders (`commanders.ts`)
- **Appointment** happens at a war side's first battle. Order: the ruler leads with chance `rulerLead` (rulers on;
  the reign's commander row is reused via `reignCmd`). Else the side's veteran `pVeteran[p]` is recalled if alive and
  not retired. Else a new general: skill draw, born = year − int(25, 45), female 0.03, kin draw (dynasty = ruler's
  house), retire age draw.
- A ruler's skill comes from his traits, with no draw: `clamp(0.85 + 0.3 (rAbility − 1) + 0.3 (rWar − 0.5), 0.6, 1.5)`
  [A: rWar range ~[0, 1]].
- Draw order per battle (battle stream), fixed: `[ground, wet, fog, surprise, surpriseSide]` (5 always) → appointment
  draws (only when appointing) → `[slainA, slainD]` (2 always) → dismissal (only on a loss, when a general).
- A slain or taken ruler: `R.kill[p] = ReignEnd.Battle` if `R.kill[p] === 0`. rulerYear applies it the same year
  (it runs after campaigns). The generic `RULERS.battle` draw stays; its threshold is × `rulerBattleCut`. The draw
  count is unchanged, so the rulers stream stays aligned.
- **Fame**: on a win, `+ fameWin · (decisive ? 2 : 1) · min(3, menLoser/menWinner)^½ (sqrt) + (capital fell ? 2 : 0) + 0.5 · fame_enemy / renown`.
  Decay is yearly in `battlesYear`. Crossing `renown` logs CommanderRenowned (once per commander).
- **Pretender hooks** (rulers on):
  - Coup: in rulerYear's overthrow branch, `x *= battleCoup(s.bat, p)`, i.e. `1 + coup · min(2, fame/renown)` for p's
    most famous serving general with `fame ≥ renown/2` (0 multiplier change otherwise). This is a threshold change on
    the existing draw. If the overthrow fires and `battleCoup > 1`, `succession → newHouseAccede` gets the general:
    after its usual born and female draws (the stream stays aligned), override `born/female` with the general's and
    link `cReignAfter`. Log GeneralSeized and set fate Seized. `AccessionHow.Usurped` is unchanged.
  - Rising: in `contested()`, before `rivalCentre`, `generalBase(s.bat, p, members)` returns the base of a famous
    general if it is a member that passes `rivalCentre`'s test at `riseBar` × the bar. That town is the rival centre;
    `R.ctxDyn = -1` (his own new house), with born and female from the general. Log GeneralRose after CivilWar
    (`civil.ts` returns the war id: `ps.wKind.length - 1` after `declare`). Fate Rose.
  - Turned (needs grudges' `betrayalStep`; 9.1): every POLITY.step, a dismissed general with `fame ≥ renown/2` whose
    base town borders the enemy of the current war turns with chance `turn · step`. `setPolity(base, enemy)` →
    Defected (the existing event) + GeneralTurned + grudges `record(GeneralTurned …)`.
- Retirement and death: yearly, at `cRetire`. RealmEnded when the polity ends.

### 3.10 Naval battles
`navalBattle(s, bs, ps, w, p, q, port)`:
- ships from 3.5. x = `(ships_p · sp / (ships_q · sq))² · M_cmd · M_weather`, with sp and sq = Seafaring.
- An admiral is the side's war commander (one commander per side and war; naval and land are the same office in this
  model) [A].
- The outcome draw is from the battle stream. Losses are ships. Kind Naval, site from 3.4.
- Square law for fleets is Lanchester's (1916) and Fiske's (1905) original naval use. Hughes' salvo model (Hughes 1995, *NRL* 42(2):267) is
  the modern alternative for missile-era fleets; not needed here.

### 3.12 War severity and tempo (owner of Richardson's law (Richardson 1948, 1960); realism-metrics.md 2.3 and section 5)
Baseline (realism-metrics, `realismStats.ts`):
- war-death power-law α̂ = 2.18–2.32 (per seed 2.32 / 1.88 / 1.91 / 2.26). The target [1.3, 1.9] is a design band; the
  real values are α̂ = 1.53 ± 0.07 for interstate wars 1823–2003 above x_min = 7,061 battle deaths (Clauset 2018), and a
  CCDF slope of −0.41 for COW interstate wars 1820–1997, i.e. a density exponent ≈ 1.41 (Cederman 2003).
- Duration CV is 0.49–0.61 (target [0.7, 1.4], about exponential), with mean 8 y.
- Onset dispersion (var/mean per decade) is 1.43–2.33 (target [0.6, 1.6]).
- maxShare is 1.0–1.6% (target 0.5–5%).

Diagnosis [V war.ts + realism-metrics]:
- Deaths are 0.02 × the front towns per war-year, so the tail inherits the town-size pdf (about 2). Nothing scales
  with the armies, the realm or the coalition.
- Peace comes from near-constant exhaustion (+0.08 a year), with a peace chance only after 5 years. That makes the
  duration distribution unimodal and too regular.

**Severity (`toll = 'escalate'`)**:
`dead = (1 − w) · T_front + w · κ · (lossA + lossD) · C`
- `T_front`: today's `WAR.battle (pop_u + pop_v)`, split as in 3.5.
- `lossA + lossD`: the Lanchester casualties of **unclamped** armies. For the toll,
  `men = WAR.army · pMass` scales with the realm, not with the front town. The 5000 clamp stays for the Journey
  display only. Realm masses are far heavier-tailed than front towns. Wars between great realms also have more
  battles and last longer, so the per-war sum compounds.
- `C`, coalition mobilisation: `1 + BATTLE.coalition (0.5) × (number of other active wars linked to this one)`.
  Linked wars are joined wars with the same defender or attacker in the same year; with grudges built, use
  `Wars.ally`. Without grudges, the proxy is: wars in which the same polity fights the same enemy's protector this year.
  This is a design analogue, not the mechanism of Clauset et al. (2025, arXiv 2503.03945): there, escalation is the
  year-to-year multiplicative change in a war's battle deaths, and alliances appear only as one reason interstate wars
  escalate more readily. "Bigger conflicts draw in more and bigger armies" is this plan's choice.
- Decisive battles: rout losses already grow with `ρ` (cavalry, a river behind). A decisive defeat
  (`x' > 6` or `< 1/6`) adds `BATTLE.annihilate (0.15)` of the loser's remaining men, as at Cannae or Adrianople.
  Rare by construction: such x' occur in ~5–8% of battles [A].
- Distribution: up to `2 WAR.battle` of u and v as in 3.5. The remainder is spread over the side's members in
  proportion to their population (levies). This is O(members) per battle, at most ~1,200 battles × 100 members.
- `w = BATTLE.realmShare (0.5)`. `κ = BATTLE.kill (0.25)`, the share of casualties that are deaths among the realm's
  people (the rest are wounded, taken or deserted [A]). Tune κ so that the **median** war's dead stays within ±25% of
  baseline (129–468 [realism M]) while α falls into range.
- Exhaustion already divides by `pPop` (realm). Realm-scaled deaths therefore stay scale-free in exhaustion: big wars
  do not end proportionally sooner. Check this with deadDurRho (must stay > 0).

**Tempo (`BATTLE.tempo = true`, step 6c; edits WAR values only when battles are on and not neutral)**:
- `WAR.peaceAfter` 5 → 1 and `WAR.peaceChance` 0.08 → 0.10: a near-constant hazard, close to exponential.
- `WAR.perYear` 0.08 → 0.04: exhaustion is driven more by deaths, less by the calendar.
- A decisive battle ends wars: after a battle with Pursuit and loser `f ≥ 0.35`, or a ruler slain or taken, the
  peace chance that year is `+ BATTLE.decisivePeace (0.3)`. This reuses the existing `rng.next() < WAR.peaceChance`
  draw with a raised threshold. The `s.year - start >= peaceAfter` gate is relaxed for it, which means the draw is now
  made in years where it was not. That is acceptable, because the mode is not neutral.
- Short wars ended by one battle and long attritional wars together raise the CV.
- Onsets: battles do not touch declarations. Guard: dispersion must not rise (≤ baseline + 0.1). Shorter wars free
  `maxWars` slots, so watch onsetPerDecade (±20%).

---

## 4. Determinism
- The new stream is `'history-battles'`, with a fixed draw order per battle (3.9). No existing stream is drawn more or
  fewer times by battles code. Exceptions, when battles are on and not neutral: rulers' threshold changes (rulerBattleCut,
  coup) use existing draws, while the newHouseAccede override keeps draws. The rising path may skip or add R.rng draws
  inside `civilWar` sides; this is acceptable because it is not neutral.
- `HistoryOptions.battles` false: `s.bat = null`. No hook runs and `armyJourney`'s refactor returns the same path it
  logs, so off is bit-identical to today (golden hash unchanged).
- Neutral: wars, settlements, pop, events except 220–227, rulers, everything else are bit-identical to off. The test
  hash filters events with `type >= 220 && type <= 229` and skips `battles`/`commanders`.
- The site, men, hours and names are pure functions of state plus the battle stream, with arithmetic plus sqrt only
  (`lnSqrt` for τ).
- Assembly (names) uses `settlementNameAt` after renamings are assembled, and features with `namedYear <= year`. It is
  pure in (history, features, featureMap).

---

## 5. Ordered commit-sized steps
1. **Lanchester core.** `battles/lanchester.ts` and `util.ts lnSqrt`. Tests: `lnSqrt` against `Math.log` (≤ 1e-9 rel);
   `resolve` against an RK4 integration of the ODEs in the test (Math allowed), for x in {0.3, 0.9, 1, 1.1, 4}: winner,
   survivors to 1e-6 and τ to 1e-4; and `U < x/(x+1)` ≡ `U < r*r/(r*r+1)` bitwise for 1e5 random r.
2. **Contract and option.** Contract types, enums, EventTypes 220–227 and `HistoryOptions.battles` (default false for
   now). `emptyBattleHistory()` in assembly. Tests are unchanged.
3. **Refactor war.ts without behaviour change.** `armyJourney` returns its path, and the draw moves (3.8) with
   `s.bat = null` throughout. Golden hash unchanged.
4. **Record in neutral mode.** `state.ts`, `system.ts battleFought` with `neutral = true`: kinds, site (needs the
   `defenseFeat` addition in `defense.ts`, with a test that `defense` is unchanged), men, losses from `resolve` with
   x = r², weather and surprise drawn but not applied, events 220/221. Test: neutral vs off hashes are equal under the
   filter, on seeds 1 and 42 at 600 years (fast). Assembly writes `Battles` (names in step 5).
5. **Names.** `assembleBattles` naming (3.11) with ordinals. `features.test`-style unit tests on a small world: a ford
   battle named after its river when the river was named by then, else after the town.
6. **Modifiers and toll split** (`neutral = false` path): 3.3 items 1–8 and 3.5 split. Run the harness (section 6) on
   all four seeds and tune only `fordBonus`, `surprise`, `rain` and `break0` terms if `E ln M` or the targets drift.
6b. **Escalation toll** (3.12). Run `realismStats.ts --json` with battles off and with them on, then
    `--from off.jsonl --vs on.jsonl`. Tune κ, realmShare and coalition until war.alpha is in [1.3, 1.9] on ≥ 3/4 seeds,
    maxShare ≤ 5%, the median war dead is within ±25% of baseline, and deadDurRho > 0. The section 6 targets for
    `dead` are replaced by these in this step.
6c. **Tempo** (3.12). Targets: war.durCv in [0.7, 1.4] on ≥ 3/4 seeds, mean duration 6–12 y, onsetDispersion ≤
    baseline + 0.1, and wars within ±20%. Re-check the outcome mix.
7. **Commanders.** Appointment, skill, fame, death, dismissal, retirement, ruler-in-field with `R.kill`, and
   rulerBattleCut. Events 222, 223, 227. Rulers tests (`rulers.test.ts`) may need a relaxed count for ReignEnd.Battle.
   Harness: ruler battle deaths within ±25% of baseline (measure that baseline in this step, before the change).
8. **Naval.** `navalBattle` in record-only mode, then `navalDecides = true` behind the harness (Blockade count may fall;
   target ≥ 60% of baseline).
9. **Pretenders.** Coup and rising hooks (events 224, 225); Turned only when grudges is built (226).
10. **UI data and Chronicle.** `ui/battlesData.ts` (by war, by settlement, by commander, sieges grouped: consecutive
    Siege rows of one war and target), `ui/battleFormat.ts`, chronicle lines in `ui/polityFormat.ts` (category
    'politics', filter "Battles" in `chronicleFilter.ts`), war panel rows in `politiesPanel.ts` (the Wars list at
    ~l.807: each war's notable battles with winner and losses), and the city card "Battles fought here".
11. **Sagas.** `scenes.ts` battle scene (kind 'battle') and siege scene, `BATTLE_T` phrase table, epithets
    (`epithets.ts`: "the Victor of Vebena Ford", "Hammer of the Kubetans"), the commander saga (`SagaKind` +
    'commander', `ui/sagas/commander.ts`), and refs from state and house sagas.
12. **Replay MVP (2D tactical map).** Section 7.2.
13. **Replay 3D in the city view.** Section 7.3.
14. **Default on.** `HistoryOptions.battles` default true. Golden hashes are updated in that commit, with a note.
    Run the full test suite and the harness, and record the numbers in the commit message.

### 3.11 Naming rules (assembly; English generic word, proper noun from features or towns)
Let town = the target's name at the year, near = the nearest settlement to the site existing that year.
- Ford → "the Battle of the {River} Ford" if the river feature at site was named by then, else "the Battle of {near} Ford".
- Pass → "the Battle of the {Range} Pass" / "the Battle of {near} Pass".
- Hill → "the Battle of {near} Hill". Marsh → "the Battle of the {near} Marshes".
- Ambush → "the Ambush in the {Forest}" / "the Ambush at {near}". Landing → "the Battle of {near} Strand".
- Siege → "the Siege of {town}" (the UI merges a run of years: "the Siege of Kubeta, 1203–1207").
  Relief won → "the Relief of {town}".
- Naval → "the Battle of the {Sea/Strait}" (water feature at site) or "the Battle off {port}".
- Else "the Battle of {near} Field".
- Repeats get ordinals in order of battle, as `wars.ts nameAll` does ("the Second Battle of Ashtar Field").

---

## 6. Stats harness (`battles/battleStats.ts`, CLI like `polityStats.ts`; seeds 1, 7, 42, 1234, 2000 years)
It reports, per seed and in the median, the 1.2 table recomputed, plus battle-specific rows. Targets with battles on
(not neutral) are compared with the 1.2 baseline:

| metric | target |
|---|---|
| wars, battles | ±10% of baseline per seed |
| attacker win (all, field, walled, counter) | ±0.03, ±0.03, ±0.05, ±0.04 |
| taken, dead | ±12%, ±10% (dead per battle is preserved exactly; changes come from fewer or more battles) |
| war length med / p90 | ±1 / ±2 years |
| outcomes summed over 4 seeds | Conquest 60 ±15, DefenderGains 65 ±15, Vassalage 41 ±12 |
| Sacked, SiegeLifted | ±15%, ±30% |
| E ln M (all parts), and per part | within ±0.05; reports ground, cmd, supply, sick, surprise, weather separately |
| E ln x\* | within ±0.05 |
| kinds | Field 55–75%, Siege 8–16%, Relief 2–8%, Ambush 3–8%, Landing 1–5%, Naval ≤ Blockade count |
| ground flags | Ford 15–35% of field (28–40% have a river on the approach [M]) |
| casualties | winner fA median 3–10%; loser 20–40%; Pyrrhic 3–8%; hours median 2–6, p90 ≤ 12 |
| commanders | 120–300 per run [A]; ruler-led 20–40% of battles; named commander killed per lost battle 5–12% |
| fame | Renowned 5–20 per run; GeneralSeized 1–6; GeneralRose 0–4 |
| rulers | ReignEnd.Battle count ±25% of baseline; overthrows ±25% |
| events | BattleFought 200–600 per run (tune logMen) |
| neutral run | hash equality with off (filtered), printed as a check |
| realism (from step 6b/6c, via `realismStats.ts --from off --vs on`) | war.alpha 1.3–1.9 (baseline 1.88–2.32), war.durCv 0.7–1.4 (0.49–0.61), onsetDispersion ≤ baseline + 0.1 and ideally ≤ 1.6, maxShare 0.5–5%, median war dead ±25% |

The ±10% `dead` and ±1/±2 year length targets apply to `toll='split'`, `tempo=false` (step 6) only. After 6b and 6c
the realism rows govern, and wars, taken and the attacker-win rows still apply.

---

## 7. Viewer: deterministic battlefield replay

### 7.1 Timeline (`src/ui/battleTimeline.ts`, pure, unit-tested; no THREE)
Input: one battle row and the world. Output:
`Timeline { seconds, phases: {kind, t0, t1}[], sides: [SideTrack, SideTrack], blocks: Block[] }`.
- Local frame: a tangent plane at the site cell's position. +x points from `from` toward `target` (the attack axis),
  and the units are cell fractions (one cell ≈ 150 km on the globe, so a replay is a stylised 5 km box; this scale is
  stated in the UI).
- Blocks per side: `n = clamp(round(sqrt(men / 150)), 3, 12)`, with widths ∝ men. Lines are at ±0.3 along x. If the
  defender chose the ground with a Hill, Ford or Pass flag, its line goes on the feature: behind the river, or across
  the pass corridor (from `defenseFeat` neighbours).
- Strength curves are in closed form, so the UI can use `Math.cosh/sinh`: `A(t)/A0`, `D(t)/D0` from `ratio`, `breakA`
  and `breakD`. Block depth ∝ the remaining strength.
- Phases (seconds at 1×; total 20–40 s): Deploy 2 s → Advance (the attacker's line moves to contact, 3–6 s, longer when
  a Ford is crossed) → Clash (τ mapped to 8–20 s; skirmish puffs) → Flank (if flagged: the winner's end blocks wheel
  around at the moment the loser is halfway to its break) → Break (the loser's blocks turn) → Rout (they scatter
  backward, the pursuers follow; pursuit losses shrink them) → End (the winner holds the field; if TargetFell, a
  banner change at the town).
- Siege: the besieged town's wall ring (dioramas already draw walls) is the defender's line. The attacker's blocks
  plus a ram/ladder block approach in Clash. Relief: a third block group arrives from the relief side.
- Naval: ships in two lines (`ships / 10` hulls, clamped 3–14 per side). Sinking hulls are removed at the loss
  fraction.
- Jitter is seeded by `rand4(battleId, k, 0, 0)` (surface.ts), so the replay is deterministic per battle.
- Tests: phases are monotone, final strengths match `1 − lossA/menA`, and the same battle gives the same timeline.

### 7.2 MVP: 2D tactical map (no 3D; mobile-safe)
- Files:
  - `src/ui/battleMap.ts` + `battleMap.css`: a panel with a `<canvas>`.
  - `src/ui/battleReplay.ts`: playback controller shared with 3D: play/pause, speed 0.5/1/2/4×, a scrubber with phase
    ticks, prev/next battle of the war, Esc closes.
- Terrain patch: the cells within 3 hops of the site, gnomonically projected onto the tangent plane. They are drawn
  once to an offscreen canvas (≤ 512², 1 MB): biome fill from `palette.ts`, hillshade from elevation, rivers as
  polylines from `riverTo` and `flow`, the sea, and town markers with names. Then per frame: blocks as rotated
  rectangles in polity colours (`politiesData` colours), arrows for the advance and the flank, and a dust overlay in
  Clash.
- Cost: redraw only while playing, at `playFps` (30 on Phone). Each frame is ≤ 30 rectangles and ≤ 6 arrows, under
  1 ms. Nothing is drawn at rest.
- Entry points:
  - a "replay" link on BattleFought chronicle lines (`chronicle.ts` row action);
  - the war panel's battle rows;
  - the city card's "Battles fought here";
  - saga battle-scene titles (`refs` with a new `{kind: 'battle'}` target, or a direct link);
  - shortcut **B** with a battle selected [A: check B is free; `main.ts:829–1020` shows m, Esc, q, e, x, z, +, −, y].
  Opening a replay sets the timeline year to the battle's year.

### 7.3 Full 3D in the city view
- `render/cityView.ts`: add `flyInAt(aim: CityAim, label)`, a fly-in to an arbitrary ground point. Build the aim
  from the site cell's position through `surface.probe`, with `extent` = 0.6 cell and the focus along the attack axis.
  `flyIn(id)` becomes a wrapper. The diorama layer's `setFocus` lays out the nearby towns and fields during the flight,
  as today.
- `render/battle/battleLayer.ts` (new):
  - Two InstancedMeshes: "stand" (a low-poly figure group, ~12 triangles, built procedurally in `shapes.ts` style; no
    new glTF) and the existing Banner model (in its polity colour via the instance colour, as `layer.ts` does for walls
    and banners).
  - Per frame it writes block transforms from the timeline (positions on the ground via `surface.probe` cached per
    block lane; ≤ 1 probe per block per frame).
  - Smoke and dust reuse `Model.Smoke` instances during the clash.
  - Ships reuse `Model.Ship/ShipMedium`.
- Camera: the orbit pivot is at the site. A "follow" toggle eases the pivot to the centroid of the clash.
  The replay card replaces the city card while engaged.
- Budget:
  - High/Balanced: ≤ 1,500 stand instances (figures per block ∝ strength), 3 draw calls, shadows as the town's.
  - Phone/Low: ≤ 24 slab instances (one per block, a flat textured ranks slab) + 24 banners, 2 draw calls, no shadow
    map, ≤ 0.5 ms CPU per frame.
  - Memory < 1 MB.
  - The render loop sleeps when the replay is paused (requestRender only while playing).
- Year: entering the replay sets the history year to the battle's year, so the dioramas show the towns and walls as
  they were. On exit, the old year is restored.

---

## 8. Sagas and Chronicle

### 8.1 Chronicle lines (hedged; `polityFormat.ts describeEvent`)
- BattleFought, field: "1203 · **the Battle of Vebena Ford**: some 3,000 Kubetans under Tsoro Ankh forced the crossing
  against perhaps 2,400 of Temuk. The Temuk line broke after some four hours and lost, it is said, a third of its men.
  Vebena fell."
- Siege: "1205 · **the Siege of Kubeta**, third year: an assault on the walls failed; the besiegers are said to have
  lost near a thousand."
- Ambush: "1188 · **the Ambush in the Olmwood**: the army of Ashtar was caught on the march by the Vesh and scattered."
- Naval: "1301 · **the Battle off Hessa**: the fleet of Kubeta, some forty ships, drove off the Temuk ships;
  the blockade of Hessa followed."
- CommanderFell: "Tsoro Ankh fell at the Battle of Ashtar Field." CommanderRenowned: "After Vebena Ford, Tsoro Ankh's
  name was known across Kubeta."
- GeneralSeized: "1210 · the general Tsoro Ankh, victor of Vebena Ford, overthrew King Ulem II and took the throne
  of Kubeta."

### 8.2 Phrase table `BATTLE_T` (both registers; examples per key)
- `battleTitle`: C "The Battle of {name}, {year}" / L "{name}: The Red Ford" (for Ford) and "The Day of {near}".
- `battleA`: C "In {year} the army of {att}, some {menA} strong under {cmdA}, met {def}'s {menD} at {site}{war}." /
  L "In the year {year}{war2} {cmdA} led the spears of {att} down to {site}, where the host of {def} stood waiting."
- `battleFord`: C "They forced the crossing of the {river} under the enemy's missiles." / L "The {river} ran red
  where they waded."
- `battleAmbush`: C "The {def} fell on them from the {forest} before they could form." / L "Out of the trees of
  {forest} came the {def}, and the road became a grave."
- `battleRain`: C "Rain had soaked the field, and neither side could make its horse tell." / L "Heaven wept on both
  hosts alike."
- `battleBreak`: C "After some {hours} the {loser} line broke; perhaps {lossL} fell or were taken, against {lossW}
  of the victors." / L "At {hourWord} the {loser} broke like ice in spring, and {lossL} did not go home."
- `battlePyrrhic`: C "It was a victory that cost {winner} nearly as much as defeat." / L "{cmdW} won the field and
  wept over it."
- `battleOdds`: C "{cmdW} won outnumbered, near {ratio} to one." / L "Few against many, and the many fled."
- `battleRuler`: C "{ruler} commanded in person{fell}." / L "{ruler} rode at the head of the host{fellL}."
- `siegeA/siegeB`, `navalA/navalB`, `reliefA`.
- `commanderSaga` (new SagaKind 'commander'): an epigraph from the biggest win; chapters for first command, great
  victories (scenes), defeats, and fate (slain, seized throne, rose, turned, retired). Example L epigraph: "Of Tsoro
  Ankh, who held the ford when the river was red."
- Every clause comes from the record: men, losses, hours, weather, flags, commanders, fate. Numbers are hedged in the
  chronicle ("some", "it is said") and inflated in the legend? **No**: the legend changes wording, not figures
  (the voice.ts rule: "never what is said").

---

## 9. Interfaces with other plans
### 9.1 grudges-and-oaths (optional)
- Add `GrievanceKind.GeneralTurned = 8` (7 is finance's CrownDefault). The wronged party is the general's polity, the
  offender the enemy he went over to, site = his base town, war = the war. Weight
  `OATH.townW × (1 + fame/renown)`. Logged after GeneralTurned 226 and Defected 33.
- Battles reads nothing else. Grudges may read `Battles` for revenge targets: "the slaughter at {name}" grievance on
  Pursuit-flagged defeats with lossD ≥ 3000, `GrievanceKind.Massacre = 9`, an open question for grudges.
- Proxy without grudges: GeneralTurned is still possible (setPolity + Defected + 226); no grievance row is written.

### 9.2 city-states (optional)
- Republics and leagues have no ruler to lead, so `rulerLead = 0` when `Government` is Republic, League or
  Confederation. Generals there are hired captains (condottieri) with `kin = 0`.
- A famous captain's coup in a Republic is city-states' **signoria** (its 4.8). Expose
  `battleCoup(s.bat, p)` so `govStep` can multiply its signoria chance. GeneralSeized is then logged by city-states
  with `extra` its reign.
- Proxy without city-states: everyone uses the rulers path.

### 9.3 state-finances / merchant-families
- None required: `pPay` is already inside `projAt`, so unpaid armies fight worse through r.
- Open question: ransom of taken commanders (finances `crownPay`) and mercenary captains from merchant families.
  Not in v1.

### 9.4 rulers (in-repo; this plan edits)
- `rulerYear` gets `× rulerBattleCut` and `× battleCoup` multipliers on existing draws.
- `newHouseAccede` takes an optional `{born, female}` override, applied after its own draws.
- `contested` calls `generalBase`.
- Each `ReignEnd.Battle` that coincides with a battle the ruler led gets `fateBattle` on the ruler's commander row,
  so UI and sagas can say where he fell.

### 9.5 disease, religion, ideas, goods
- Disease: read-only scan of ArmyStricken (3.3.4).
- Religion: read-only HolyWar war ids for zeal.
- Ideas and goods: already in quality. A future idea "drill" or "gunpowder field artillery" could raise α in battles;
  out of scope.

### 9.6 beliefs-and-deception (its 0.4, adopted)
- **Kept**: `beliefBattle(s, w, p, q, aTrue, dTrue)` is called once per engagement after the outcome, with
  `aTrue = strikeA` and `dTrue = strikeD` (the pre-modifier strengths, as beliefs specifies), in both off and on modes
  (3.8). Naval battles call it with the fleet strengths `ships · seafaring`.
  - Amendment proposed to beliefs: also pass the battle id (`-1` when battles is off), so belief updates can be
    stronger for decisive battles (`flags & Pursuit`). This is optional; beliefs ignores the argument if it doesn't
    want it.
- **Adopted**: `intelEdge(s, p, q)` feeds surprise chance and side, and feints (3.3.5). It is read only when beliefs
  is built. Proxy: e = 0.
- Names: no `Wars` fields are added by battles, so there is no collision with `believed`, `actual` or `motive`.

### 9.7 realism-metrics
- Battles owns war.alpha, war.durCv and the onset guard (3.12, section 6).
- `Wars.battleDead` is not needed: the harness can sum `Battles.dead` per war (sacks excluded) for a COW-like fit (Correlates of War; Sarkees & Wayman 2010).
  Expose `battleDeadOf(h, w)` in `ui/battlesData.ts`.

---

## 10. Performance and memory
- Sim: about 930–1250 battles per run [M]. Each costs O(path ≤ 13 cells) for the site, ~30 flops for Lanchester, 12
  sqrt for `lnSqrt`, and ≤ 10 draws, i.e. < 2 µs. **< 5 ms per 2000-year run.** The event scan for ArmyStricken is
  O(new events) per year. Commanders yearly: O(active ≤ 50).
- Memory: Battles about 1,200 rows × ~80 bytes ≈ 100 KB typed, plus names. Commanders ≈ 300 rows × 70 bytes.
  Events +200–600 (~3% of 14–15k events [M]).
- Assembly: naming O(battles × feature lookups) is trivial.
- UI: battlesData index is O(battles). Replay costs are in 7.2 and 7.3.
- `perf-efficiency.md` is in progress: nothing here touches the hot per-settlement loops.

---

## 11. Risks and open questions
1. **Selection bias in commanders** (winners keep command, attackers win more) may push E ln M_cmd positive for
   attackers. Mitigations: skill veterancy on both sides; a recall of veterans for defenders too. Measure before tuning.
2. **Ground choice**: the min/max rule may be too extreme. Alternative: a weighted pick, which costs a draw that we
   already make. The harness decides.
3. **Toll**: army casualties versus the town toll (3.5). The split keeps baseline demography but makes `lossA/lossD`
   chronicle figures larger than the population change. The UI must say "casualties" for those and must not equate
   them with `Wars.dead`. Alternative: realm-wide toll behind `BATTLE.toll = 'realm'`. Not recommended now.
4. **Exhaustion split** may shorten wars that one side keeps losing, which is realistic but can shift outcome mix
   (Tribute/Vassalage are decided at peace by advantage). Watch the outcome targets.
5. `learnPath` ordering (3.8 [A]). Verify that it reads nothing the spikes and pop deduction change.
6. Defender men (`menD`) are derived. With walls, garrisons can be implausibly small or large. Clamp, and consider
   `localOf` share.
7. Naval `navalDecides` changes blockade frequency, which feeds trade (blockade costs, piracy). Keep it off until the
   trade stats harness (`wayStats.ts`) is checked.
8. Breakpoints of 0.8 are a design default. Real breaking points vary widely: 15 of 43 broken battalions in Clark
   (1954) had lost over 40%; the "5%" lower end given here before is unsourced. Spread
   them by cohesion as designed; do not chase realism beyond the stats.
9. Replay scale: one cell is ~150 km, so the "battlefield" is stylised. The diorama layer's 400× model scale already
   sets that convention.
10. Shortcut key B and the chronicle row actions need UI review.
11. Escalation could overshoot. A few great-realm wars could kill > 5% of the world (maxShare) or depopulate their
    levies. Cap realm deaths per war-year at `0.02 pPop` per side.
12. Tempo changes interact with grudges (revenge wars) and finances (WarBankrupt), which also move durCv. Measure
    each plan's realism A/B in build order. Battles' tempo goes last, as the tie-breaker owner.

### Verified vs measured vs assumed (summary)
- [V] war.ts flow and draw positions; that `armyJourney` makes no draws; the tech, terrain, walls and pay already in
  r; rulers' battle death and overthrow formulas; blockade without a draw; ArmyStricken value = war; sagas phrase
  table format; city view and diorama APIs; `features`/`featureMap`/`settlementNameAt` available at assembly.
- [M] the baseline war stats table (1.2); the ln r distribution; losses vs army size; approach path lengths and
  river/sea shares; the sensitivity of win rate to modifier mean and spread (1.3, Monte Carlo on a normal fit).
- [A] the parameter values in 3.6; the commander counts; the rulers' trait-to-skill mapping; that `learnPath` is
  independent of pop; derived defender men; the weather chances; that B is a free key.

## Addendum (central registry)
- `GrievanceKind.GeneralTurned` is **11**, not 8 (8–10 belong to beliefs-and-deception). See _CONVENTIONS.md.
- Keyboard: `B` is already the Library shortcut (README). Do not use it for battle replay; pick a free key after checking main.ts's key map (e.g. `W` for war/battle, if free).

## Addendum (from court-politics.md §0.4)
court-politics.md (built last) requests interface additions from this plan — read its §0.4 before implementing this plan, and add the listed functions/hooks as no-op stubs if court-politics is not yet built.

## References
Citation audit 2026-11-26. [verified] = a publisher, index (RePEc/IDEAS, DTIC, library catalogue) or author page was opened and
confirmed the entry; notes say what it did not confirm. Everything not listed here (parameter values, targets, ~5–8%
decisive battles, κ, realmShare, etc.) is a design default or a probe measurement [M], not a sourced fact.

- Bracken, J. (1995). Lanchester models of the Ardennes campaign. *Naval Research Logistics* 42(4):559–577. https://ideas.repec.org/a/wly/navres/v42y1995i4p559-577.html [verified; abstract: the linear law fits in all four cases]
- Cederman, L.-E. (2003). Modeling the size of wars: from billiard balls to sandpiles. *American Political Science Review* 97(1):135–150. https://ideas.repec.org/a/cup/apsrev/v97y2003i01p135-150_00.html [verified; slope −0.41 read from the 2002 draft, https://pdodds.w3.uvm.edu/files/papers/others/2002/cederman2002u.pdf]
- Clark, D. (1954). Study of 43 battalion-level engagements in which units broke. Operations Research Office (ORO). [unverified directly: known only from The Dupuy Institute 2018a's summary; title and report number not checked]
- Clauset, A. (2018). Trends and fluctuations in the severity of interstate wars. *Science Advances* 4, eaao3580. https://experts.colorado.edu/display/pubid_235718 [verified; α̂ = 1.53 ± 0.07, x_min = 7061 confirmed in Clauset's chapter "On the frequency and severity of interstate wars", https://arxiv.org/abs/1901.05086]
- Clauset, A., Walter, B. F., Cederman, L.-E. & Gleditsch, K. S. (2025). Escalation dynamics and the severity of wars. arXiv:2503.03945. https://arxiv.org/abs/2503.03945 [verified]
- Dijkstra, E. W. (1959). A note on two problems in connexion with graphs. *Numerische Mathematik* 1:269–271. https://doi.org/10.1007/BF01386390 [verified]
- Dupuy, T. N. (1987). *Understanding War: History and Theory of Combat*. ISBN 9780913729571. https://www.publishersweekly.com/9780913729571 [verified that the book exists; the breakpoint claim formerly cited to it could not be found and was withdrawn]
- Dupuy, T. N. (1990). *Understanding Defeat*. [unverified directly: known from The Dupuy Institute 2018a; publisher not checked]
- The Dupuy Institute (2018a). C-WAM 4 (Breakpoints). https://dupuyinstitute.org/2018/04/16/c-wam-4-breakpoints/ [verified; secondary source for Clark 1954 and Dupuy 1990]
- The Dupuy Institute (2018b). The Lanchester equations and historical warfare. https://dupuyinstitute.org/2018/05/02/the-lanchester-equations-and-historical-warfare [verified; secondary source for Willard 1962 and Engel 1954]
- Engel, J. H. (1954). A verification of Lanchester's law. *J. Operations Research Society of America* (now *Operations Research*) 2(2):163–171. https://doi.org/10.1287/opre.2.2.163 [verified]
- Fiske, B. A. (1905). American naval policy (prize essay). *Proceedings of the U.S. Naval Institute*, January 1905. https://www.usni.org/magazines/proceedings/1905/january/american-naval-policy [verified that the essay exists and is credited with an earlier square law by "The Fiske model of warfare", *Operations Research* 10(4):569, 1962, https://doi.org/10.1287/opre.10.4.569; issue number not checked]
- Hall, P. (1927). The distribution of means for samples of size N drawn from a population (…). *Biometrika* 19(3/4):240–245. https://doi.org/10.1093/biomet/19.3-4.240 [verified]
- Helmbold, R. L. (1965). A modification of Lanchester's equations. *Operations Research* 13(5):857–859. https://doi.org/10.1287/opre.13.5.857 [verified]
- Hirshleifer, J. (1989). Conflict and rent-seeking success functions: ratio vs. difference models of relative success. *Public Choice* 63(2):101–112. https://doi.org/10.1007/BF00153394 [verified]
- Hughes, W. P. (1995). A salvo model of warships in missile combat used to evaluate their staying power. *Naval Research Logistics* 42(2):267–289. https://ideas.repec.org/a/wly/navres/v42y1995i2p267-289.html [verified]
- Irwin, J. O. (1927). On the frequency distribution of the means of samples from a population having any law of frequency (…). *Biometrika* 19(3/4):225–239. https://doi.org/10.1093/biomet/19.3-4.225 [verified]
- Jia, H. (2008). A stochastic derivation of the ratio form of contest success functions. *Public Choice* 135(3):125–130. https://doi.org/10.1007/s11127-007-9242-1 [verified]
- Lanchester, F. W. (1916). *Aircraft in Warfare: The Dawn of the Fourth Arm*. London: Constable. https://libcat.library.tamu.edu/Record/in00000518310/Description [verified]
- Lucas, T. W. & Turkes, T. (2004). Fitting Lanchester equations to the battles of Kursk and Ardennes. *Naval Research Logistics* 51(1):95–116. https://doi.org/10.1002/nav.10101 [verified]
- MacKay, D. J. C. (1992). The evidence framework applied to classification networks. *Neural Computation* 4(5):720–736. https://doi.org/10.1162/neco.1992.4.5.720 [verified as a bibliographic entry; that the (1 + πs²/8)^−½ factor is stated in it was not re-read]
- Richardson, L. F. (1948). Variation of the frequency of fatal quarrels with magnitude. *J. American Statistical Association* 43:523–546. [verified volume and pages via the reference list of Clauset's chapter, https://arxiv.org/abs/1901.05086; no DOI checked]
- Richardson, L. F. (1960). *Statistics of Deadly Quarrels*. Pittsburgh: Boxwood Press. https://www.americanscientist.org/node/424 [verified]
- Sarkees, M. R. & Wayman, F. W. (2010). *Resort to War: A Data Guide to Inter-State, Extra-State, Intra-State, and Non-State Wars, 1816–2007*. CQ Press. https://public.websites.umich.edu/~fwayman/book_resorttowar.html [verified via catalogue listing]
- Tullock, G. (1980). Efficient rent seeking. In Buchanan, J. M., Tollison, R. D. & Tullock, G. (eds.), *Toward a Theory of the Rent-Seeking Society*, Texas A&M Univ. Press, 97–112. Reprinted in Lockard, A. A. & Tullock, G. (eds., 2001), *Efficient Rent-Seeking*, Springer, 3–16. https://link.springer.com/978-0-7923-7242-4 [verified via the 2001 reprint; the 1980 page range not confirmed]
- Willard, D. (1962). *Lanchester as Force in History: An Analysis of Land Battles of the Years 1618–1905*. Research Analysis Corporation, RAC-TP-74. [verified via The Dupuy Institute 2018b, which gives the number as "RAC-TD-74"; number unresolved]
