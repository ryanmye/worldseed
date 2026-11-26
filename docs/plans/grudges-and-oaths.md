# Grudges and oaths: implementation plan (worldseed)

Base: `main` @ 8cabf09, branch `grudges-and-oaths`. No source edits made yet; this is a plan only.
Tags: **[V]** = I read it in the code. **[M]** = I measured it with a script. **[A]** = an assumption or a proposal that still needs checking.

Goal: diplomacy should produce betrayal and grudges that last. A per-pair grievance memory that decays over time feeds
rivalry and casus belli. Truces become oaths that can be broken. An ally fighting alongside you may defect. All of it
is shown in the Chronicle, the sagas (both registers) and the polity panel.

**(rev 2) Scope added.** Three changes, each with its own off switch:
- **Shadow of the future** (3.6a): the fixed `honour = 0.5·piety + 0.5·(1−warlike)` is replaced by a discount factor δ for
  each ruler, worked out from the ruler's age, the expected rest of the reign, how secure the heir is and how dangerous
  the realm's position is. A ruler breaks an oath when the one-shot gain beats the discounted value of keeping
  cooperation going plus the cost to reputation. This is the folk-theorem condition δ ≥ (T−R)/(T−P) of the repeated
  Prisoner's Dilemma (Axelrod 1984; Friedman 1971). It uses no new draws, so the `'history-oaths'` draw count does not
  change. Part of `oaths`.
- **Balance of threat** (3.10): alliance choice is weighted by Walt's threat = power × proximity × offensive intent
  (Walt 1987). Weak states next to a hegemon bandwagon with it. New switch `HistoryOptions.balance`.
- **Richardson arms races** (3.11): per rival pair, dx/dt = k·y − a·x + g, with g fed by grievances, rivalry and threat
  (Richardson 1960). Arms raise war power and cost money. Each race is a Chronicle precursor and a Factions-view border
  overlay. New switch `HistoryOptions.arms`.
Rev-2 measurements come from the scratch copy `/home/claude/scratch-grudges-rev2` (pristine 8cabf09 plus npm install),
using `/home/claude/scripts/rev2-balance.ts <seed>`.

---

## 1. Current behaviour (verified)

### Rivalry: `src/sim/history/polity/relations.ts`
- **[V]** There is one scalar `relR[r]` in [0, 2] per pair. A pair exists only while the two polities border each
  other and their peoples are in contact. `relationStep` runs every `POLITY.slowStep` = 10 years, after `allianceStep`'s
  inputs, per the order in `system.ts`:
  `dR = step*[claim*c/(c+6) + differ + hunger*h + recentWar*[war within 50y] - trade*v/(v+200) - marriage tie + faithRivalry] - step*0.02*R`
  (`RELATION` in `polity/params.ts:114`: claim .04, differ .01, hunger .02, recentWar .03, recentYears 50, decay .02).
- **[V]** The `recentWar` term (+0.03/yr for 50 years after any war) is the only memory today. It is symmetric and
  does not know who wronged whom. Grievances replace or supplement it. Keep it, so that turning oaths off stays
  bit-identical.
- **[V]** Per-relation arrays are built in `ensureRelation`: relA, relB, relR, relTruce, relWar, relLastWar, relEmb,
  relEmbRec, relEdges, relContested, relDispute, relDisputeOn. **Every new per-relation array must be pushed there.**
- **[V]** The key is `lo*65536 + hi`. `relIndex` is a Map used only for lookup; the arrays are kept in creation order.

### Truces
- **[V]** Truces are stored as `ps.relTruce[r]` = the first year war is allowed again. It is set in four places:
  - `war.ts closeWar`: after every war, `year + WAR.truce` (30).
  - `realm.ts:85 successors`: `year + RELATION.truceSecede` (15) between a parent and its successor.
  - `civil.ts:104`: `= year`, i.e. no truce, before a civil war is declared.
  - `civil.ts:144 partition`: `year + WAR.truce` between heirs.
- **[V]** `war.ts declarations` skips any pair with `s.year < relTruce[r]`, so a truce can never be broken today.
- **[V]** `orders/system.ts:356` returns OrderReason `Truce` when the player orders war during a truce.
- **[M]** War again between the same pair: the gap after the previous war has p10 = 30–45 years, which is right at
  truce expiry. The truce is binding, and it is the reason the gap is never shorter than 30.

### Bonds: `src/sim/history/polity/bonds.ts`
- **[V]** Parallel arrays bKind/bA/bB/bStart/bEnd/bCause/bUntil/bThreat plus `activeBonds`. `BondKind` is
  Vassal 0, Tribute 1, Alliance 2. `BondEnd` is Ongoing 0, Freed 1, Absorbed 2, Lapsed 3, Ended 4
  (`contract.ts:1268-1283`).
- **[V]** `allianceStep` runs every slow step after rivalry. x and y ally when a common rival c has R >= 0.7 with both,
  R(x,y) < 0.3, both are Kingdom tier or higher, c is at least as populous as each, and neither holds 2 alliances
  already. The chance is 0.25 per slow step (×MARRIAGE.alliance if the houses are tied). It draws from `ps.rng`
  ('history-polities'). `ally()` logs `Alliance(39)`.
- **[V]** `bondStep`: an alliance ends `Lapsed` when the allies are at war with each other, when the threat has ended
  or gone, or when both rivalries with the threat fall below 0.35. Nobody is blamed for it.
- **[V]** `declarations` does **not** check `allied()`; it checks only `bound()` (vassal/overlord). So allies can
  already declare war on each other. The bond then lapses silently at the next `bondStep`.
- **[V]** Allies join only **defensive** wars. In `war.ts declare()`, for each `protectorsOf(q)` (allies, plus q's
  overlord), with chance `ALLIANCE.join` = 0.5 from `rngWar`, the ally calls `declare(rx, x, p, Conquest, joined=true)`.
  This creates a **separate war** x→p. Nothing links that war back to q's war.
- **[V]** `peaceTerms(p,q)`: at the end of an unfinished conquest war, `advantageAt(p,q) >= VASSAL.vassalAdv` (and q is
  large or foreign) gives vassalage; `>= tributeAdv` gives tribute; anything else keeps the outcome.
- **[V]** A vassal throws off its bond in `bondStep` when the overlord's projection falls below `VASSAL.rebel * mass`.
  This gives `BondEnd.Freed`, the event `BecameVassal` with extra 1, and `relR := max(relR, secedeR)`.
  `rulers/marriage.ts:102` also frees vassals.

### Wars: `src/sim/history/polity/war.ts`
- **[V]** The file header documents declaration, campaign and peace formulas. Declaration chance per slow step:
  `slowStep*WAR.declare(0.01)*smoothstep(.6,1.2,R)*smoothstep(1,2,adv)*(crisis?2:1)*(1-E) * rulerWar * holyDrive * orders`.
  The draw is from `ps.rngWar`, for each pair in relation order and both directions.
- **[V]** `conquer()` logs `Conquered(26)` (value = war id). It may sack, drawing from rngWar, and log `Sacked(27)`.
  `capitalFalls()` handles a capital that falls: the polity becomes a vassal, keeps a rump, or ends.
- **[V]** `closeWar()` sets the truce, `relR *= 0.5` and `relLastWar`, and logs `PeaceMade`.
- **[V]** `Wars` in contract.ts has count, kind, attacker, defender, startYear, endYear, outcome, taken, dead.
  It has no "cause" field.

### Rulers: `src/sim/history/rulers/`
- **[V]** Each reign has traits `rAbility`, `rWar` (warlike, 0.5·house temperament + 0.5·U), `rPiety` (U) and
  `rTol` (U). All are drawn from `R.rng` ('history-rulers') in `accede` (system.ts:225-228). `rulerWar(R,p)` returns
  `RULERS.warBase(0.5) + rWar`.
- **[V]** `s.rul` is null when rulers are off. Every hook guards on `s.rul !== null`.
- **[V]** The epithet "the Betrayed" already exists (`sagas/epithets.ts:79`, for an overthrown ruler). Don't reuse it.

### Religion
- **[V]** `religion/system.ts:~245` scans events. On a `Conquered` event of a holy city by a polity of another faith
  it logs `HolyCityFell(95)` with settlement v, other = army's settlement, value = faith, extra = war id.

### RNG streams (`src/sim/rng.ts`)
- **[V]** sfc32 streams come from `createRng(seed, name)`. The header says adding draws to one stream never shifts
  another. The polity system uses `'history-polities'` (`ps.rng`) and `'history-war'` (`ps.rngWar`).
- **[V]** The whole sim avoids `exp`, `sin` and `pow` (only `+ - * / sqrt`), for bit-identity across engines.
  **A half-life must not be computed with Math.pow inside the sim.**

### Events, assembly, UI
- **[V]** `EventType` is in contract.ts:99. Polity ids are 20–43, claims 130, trade-danger 150–151, orders 170–173,
  cradles 180. **190–199 are free** (proposed: oaths).
- **[V]** `polity/assemble.ts` builds `History.bonds` and `embargoes` from ps arrays. When polities are off it builds
  empty versions (line 194).
- **[V]** The UI duplicates the ids in `src/ui/politiesData.ts:74 PolityEvent`. The Chronicle lines are in
  `src/ui/polityFormat.ts`: `describeV2` gives headline text and `describeV2For` the inspector text for a settlement.
  The category key (`'alliance'`, `'vassal'`, …) is at ~line 505. Grouped decade lines are `describeBonds` and
  `describeAlliances`.
- **[V]** `src/ui/historyIndex.ts`: line 423 is the shown-type range `(type >= 20 && type <= 43)`; line 438 is the
  headline list; line 756 is `v2Kind` grouping; line 786 dedupes a vassal line already said by the peace line.
  `src/ui/chronicleFilter.ts` maps EntryKind to filter groups.
- **[V]** `src/ui/politiesPanel.ts:707-768` is the "Bonds" section, current then past. In past lines, `endW`
  distinguishes Freed and Absorbed.
- **[V]** In the sagas (`src/ui/sagas/`), each file has a `PhraseTable` T, with `[chronicle variants]` and
  `[legend variants]` per key, chosen by `new Voice(seed, key, legend, …)`. `state.ts stateSaga` is "A History of the
  {state}", with sections hFounding, hRulers, hWar, hFaith, hEnd/hNow; bonds appear in hFaith (vassals/overlord).
  `year.ts` is the decade chronicle (wars begun and ended). `wars.ts` names wars. `epithets.ts` gives ruler epithets.
- **[V]** The UI generally does not import sim params; only `ideasData.ts` does.
- **[V]** The README "What it simulates" → **States** bullet is at README.md:50-52.

### (rev 2) Inputs for δ, threat and arms (verified)
- **[V]** Rulers (`rulers/state.ts`): `cur[p]` is the reign; `rBorn[r]` is the birth year (age = year − rBorn). `rDeath[r]`
  is the *scheduled* death year, or the end of term for a league head. Do not use it for hereditary rulers, because it is
  omniscient. The heir pool for slot `p*H+k` (H = `RULERS.heirs` = 6) is `hN[p]`, `hBorn`, `hDeath`, `hLegit`, `hChild`.
  `law[people]` indexes `RULERS.lawWeights` order (0 Primogeniture, 1 Partible, 2 Elective, 3 Seniority).
  `SUCCESSION.base = [0.05, 0.06, 0.1, 0.14]` is the contest chance by law. `R.surv` is survival to each whole age (built
  by the private `survival()`, multiplication only). `RULERS.majority` = 16.
- **[V]** Crisis: `ps.pCrisisUntil[p] > year` (`inCrisis`). Danger: `ps.dangerAvg[settlement]` is smoothed danger in 0..1
  (`polity/danger.ts`).
- **[V]** Power: `projAt(ps,p,d) = pMass·grip(d,pReach)/(1+multiWar·(wars−1))·(1−exhaustionProj·E)`. `advantageAt(s,ps,p,q)`
  is Proj_p at q's capital ÷ q's defence there, which is power × proximity in a single number. `pMass` already includes
  ruler ability and the crisis penalty (`control.ts:91-95`).
- **[V]** `allianceStep` (bonds.ts:229) builds `hostA/hostB` from relations with R ≥ `ALLIANCE.threat` 0.7. It loops
  O(H²) over pairs of those relations that share a rival c. The other filters are R(x,y) < `calm` 0.3, no war, no bond,
  contact, `alliances() < 2` each, both Kingdom tier or higher, and `pPop[c] ≥ pPop[x], pPop[y]`. One `ps.rng` draw is
  made per candidate that passes all filters, against `chance` 0.25 (×`MARRIAGE.alliance` 2 if the houses are tied).
  `bufferAlarm` (bonds.ts) also makes alliances (with `roll`), and so does nothing else. **No polity ever allies with the
  realm that threatens it.** Alliances are pairwise, so a "coalition" here means ≥ 2 alliances whose `bThreat` is the
  same c.
- **[V]** `declarations` (war.ts:67): the `rngWar` draw happens only when `drive > 0`, and drive depends on `adv`.
  **Anything that changes adv (arms) therefore changes the rngWar draw count.** In-truce pairs `continue` before any draw.
- **[V]** Finances plan (state-finances.md 2.4.2) has `garrison = garrison·R°·(1 + rivalArmy·min(1, maxR_p))`. That term
  is already a static stand-in for armament against rivals. Arms (3.11) replaces it when both are built.
- **[V]** Factions-view borders (`render/polities.ts`): war borders pulse red, and embargoes are amber/black dashes drawn
  from a uniform list (`uEmbCount`, `pl_embargo`, filled from `politiesData embargoesAt`). An arms-race border uses
  the same mechanism.

### Tests
- **[V]** `history.test.ts:1043` checks that the same world gives a bit-identical history. `sim.test.ts:132` does the
  same for arrays.
- **[V]** `history.test.ts:~330-360` has a switch over every EventType (new types must be added). `polity2.test.ts:180+`
  checks each v2 event against its table (BecameVassal ⇒ bond, Alliance ⇒ bond).
- **[V]** The off-switch pattern: every subsystem (rulers, religion, ideas, …) has a `HistoryOptions` boolean.
  Test-file comments record that "the tree was checked bit-identical to main <sha> on every History field in every off
  configuration".
- **[M] Clean-tree test run (before any change):** `npm test` had **2 failures in `history.test.ts`**: "matrices have
  contract shapes and own their buffers" and "respects options and shorter runs replay the same start". That run shared
  the CPU with 3–4 concurrent 2000-year sims, so the failures may be timeouts. **The executor must re-run `npm test`
  on an idle clean tree first and record the pre-existing failures.** The full suite takes well over 4 minutes;
  history.test.ts alone took 209 s under load. Typecheck on the clean tree was not recorded.

---

## 2. Baseline measurements [M]

Script: `/home/claude/scripts/baseline.ts`. It is read-only and runs with `node <script> <seed>` on Node 22.23 (native
type stripping works). It uses `runHistory(generateWorld(seed))` with defaults (2000 years, all systems on). Each seed
takes about 35–70 s.

| seed | conquest wars | civil | alliances | alliance ends (Ongoing/Lapsed/Ended) | ally-joined wars* | vassal+tribute bonds | Freed | sacks | holy city fell | "revenge-like"** | re-war pairs | re-war gap 30–40y | allies who fought each other*** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1    | 105 | 14 | 54 | 9 / 3 / 42 | 13 | 64 | 21 | 254 | 4 | 3 | 44 | 2 | 0 |
| 7    |  96 | 15 | 37 | 6 / 4 / 27 | 25 | 64 | 12 | 210 | 0 | 4 | 45 | 3 | 1 |
| 42   |  99 | 17 | 46 | 6 / 2 / 38 | 14 | 63 | 14 | 226 | 1 | 6 | 32 | 4 | 1 |
| 1234 |  80 | 10 | 36 | 11 / 8 / 17 | 16 | 50 | 13 | 158 | 0 | 1 | 27 | 3 | 4 |

\* A heuristic: a war starting the same year whose defender is the attacker of another war, with an id within 6.
This approximates `declare(..., joined=true)`. These wars are the only opportunities for a betrayal by defection.
\*\* q attacks p within 100 years of a war p won against q.
\*\*\* The alliance ended Lapsed in the same year as, or 5 years after, a war between the two allies.

What the numbers say:
- Most alliances end `Ended`: one ally ended or was made a vassal. Few lapse. Alliance median life is 65–100 years.
- Only 13–25 joined wars per run. To get "a handful" of defections (3–6), roughly 25–35% of joined wars must end in a
  defection. Counting attacks on one's own ally as betrayals (0–4 per run today) also helps.
- Revenge wars today are 1–6 per run, about 1–6% of conquest wars. Target with grudges: 10–25%.

### (rev 2) Hegemony, coalitions, rivalry before wars, ruler horizon [M]
Script `/home/claude/scripts/rev2-balance.ts`. A per-year probe samples every 10 years. The "top realm" is the alive
polity with the largest `pPop`; its share is of the total polity population. A coalition decade is one in which ≥ 1
alliance in force has `bThreat` = the top realm.

| seed | top share mean / median / p90 / max | decades with coalition vs top (vs any top-3) | alliances formed: vs top / vs top-3 / all | neighbour-decades of top: Kingdom+ / chiefdom / its vassals / allied with it / R ≥ 0.7 | conquest wars with R ≥ 0.6 for the 20 y (30 y) before | ruler age median; adult heir %; crisis % |
|---|---|---|---|---|---|---|
| 1    | .24 / .25 / .32 / .47 | 86% (86%) | 32 / 43 / 54 | 810 / 223 / 232 / 0 / 768 | 98 (91) of 103 | 44; 89; 10.5 |
| 7    | .26 / .19 / .47 / .60 | 42% (76%) | 18 / 32 / 37 | 405 / 93 / 81 / 33 / 355 | 82 (78) of 90 | 45; 79; 9.1 |
| 42   | .29 / .29 / .44 / .62 | 53% (60%) | 21 / 31 / 46 | 583 / 224 / 135 / 0 / 430 | 80 (76) of 91 | 45; 84; 10.3 |
| 1234 | .42 / .48 / .61 / .69 | 54% (54%) | 19 / 23 / 36 | 763 / 333 / 147 / 39 / 512 | 71 (68) of 79 | 46; 79; 9.3 |

What the numbers say (these push back on the brief):
- **Balancing already exists.** 49–59% of alliances already form against the top realm, because `allianceStep` requires
  c to be at least as populous as each ally. "Coalitions against the top realm" is therefore not missing. What is weak is
  *proportionality*: seed 1234 has the strongest hegemon (median 48%) but only 54% coalition decades, while seed 1 has a
  weak hegemon (25%) and 86%. The threat measure is population plus rivalry, with no proximity or intent. Rev-2 targets
  are therefore conditional on hegemon share, not raw frequency.
- **Bandwagoning exists only as coercion.** Vassals make up 14–23% of the top realm's neighbour-decades (overawe and
  peace terms). Voluntary alignment is nearly absent: the "allied with it" decades on seeds 7 and 1234 come from
  alliances the top realm made against a third party.
- **Sustained rivalry precedes 86–95% of wars.** That follows from construction: declaration needs `smoothstep(0.6, 1.2, R)`.
  So an arms-race signal driven by R alone would precede almost every war and carry no information. 3.11 makes R-only
  equilibria sit below the race threshold, so a race needs grievances or threat.
- Median ruler age at a sample is 44–46, an adult heir is present 79–89% of the time, and a crisis is in progress ~10%
  of the time. Survival from `R.surv` (computed): 10-year survival s10 = .81 (age 25), .72 (44), .57 (55), .33 (65),
  .08 (75); curtate expected remaining life e(a) = 26.7, 17.3, 11.8, 7.4, 3.9 years.
- **Not measured** (to add to the step-0 harness): the coalition rate conditional on top share ≥ 0.30, and how many
  wars the top realm fights as defender with an ally joining.

---

## 3. Design

### 3.1 Off switch
- **[A]** Add `HistoryOptions.oaths?: boolean` (default true; it needs polities). In `index.ts`, set `ps.oaths = false`
  when it is off. With it false, every hook below is a no-op, no `rngOath` draws happen, and the new History fields are
  empty or zero. **The history must then be bit-identical to main 8cabf09 on every existing field.** Check this with a
  script and record it in a test comment, following the repo convention.
- **(rev 2)** The shadow-of-the-future δ (3.6a) is part of `oaths`, with no separate switch: it replaces the honour
  formula inside oath decisions.
- **(rev 2)** `HistoryOptions.balance?: boolean` (default true; needs polities) controls the threat-weighted alliance
  choice and bandwagoning (3.10). With it off, `allianceStep` and the join chance are byte-for-byte today's code
  (keep the old path as `allianceStepLegacy`).
- **(rev 2)** `HistoryOptions.arms?: boolean` (default true; needs polities) controls Richardson arms (3.11). With it off,
  no arms arrays are read, and every power multiplier is skipped rather than multiplied by 1.
- Each switch off ⇒ bit-identical to main on every pre-existing History field, given the others at their defaults
  relative to a run with that switch off. Test all 8 on/off combinations for crashes and shapes on a 300-year run.
  Test bit-identity for `{oaths, balance, arms}` = all off versus main.

### 3.2 New contract.ts records (drafted doc comments)

```ts
/** Kinds of grievance one polity holds against another (History.grievances). */
export const GrievanceKind = {
  TruceBroken: 0,     // the offender declared war while a truce sworn after a war between them held (EventType.OathBroken, extra 0)
  AllyBetrayed: 1,    // the offender, its ally, made a separate peace with their common enemy or turned on it (EventType.Betrayal), or attacked it while allied (OathBroken, extra 1)
  BondThrownOff: 2,   // the offender, its vassal or tributary, threw off the bond (BecameVassal, extra 1); the overlord holds it
  TownConquered: 3,   // the offender took `settlement` from it in war (Conquered events of one war merged: `count` towns)
  TownSacked: 4,      // the offender sacked `settlement` (Sacked)
  HolyCityTaken: 5,   // the offender, of another faith, took the holy city `settlement` (HolyCityFell); the polity that lost it holds it
  CapitalTaken: 6,    // the offender took its capital `settlement`
} as const
export type GrievanceKind = (typeof GrievanceKind)[keyof typeof GrievanceKind]

/**
 * Grievances between polities, struct-of-arrays in order of recording (one row per wrong; the towns one war took from one
 * polity merge into one TownConquered row). A grievance's weight w0 fades with age: w(y) = w0 * 0.5^((y - year) / halfLife),
 * and it is put aside (endYear) once w < OATH.forget, when it is avenged (the town taken back, or a war won against the
 * offender: weight * OATH.avenged), or when either polity ends without heirs. A successor state, or the realm that
 * reunifies it, inherits its parent's grievances at OATH.inherit of their weight (`heir` is the row it came from).
 * The grudge of p against q is G = sum of w over p's open rows against q; it raises rivalry and p's will to make war on q.
 */
export interface Grievances {
  count: number
  kind: Uint8Array
  /** Polity ids: the wronged and the offender. */
  wronged: Int16Array
  offender: Int16Array
  year: Int16Array
  /** Weight when recorded (after merging), and the year it was put aside (-1 still held at the end of the run). */
  weight: Float32Array
  endYear: Int16Array
  /** 0 faded, 1 avenged, 2 a polity ended, 3 passed to an heir (see `heir`). */
  endCause: Uint8Array
  /** Settlement it concerns (town, capital, holy city) or -1; the war it came from (History.wars) or -1; towns merged. */
  settlement: Int32Array
  war: Int32Array
  count_: Uint16Array      // name it `towns`, since `count` is taken
  /** Row this one was inherited from, or -1. */
  heir: Int32Array
  /** OATH.halfLife (years), for readers that compute w(y). */
  halfLife: number
}
```

The UI may use `Math.pow` to compute w(y); only the sim may not.

Further contract changes:
- `History.grievances: Grievances` (empty when polities or oaths are off).
- `History.faithless: Uint8Array`: each polity's reputation for faithlessness per snapshot, 0..255 for 0..OATH.repMax,
  laid out like `tariff` (`[s * polities.length + id]`).
- `Wars.cause: Int32Array`: the grievance row that drove the declaration (the strongest of the attacker's grudges
  against the defender when `g >= OATH.revengeMin`), or -1. A revenge war is a war with `cause >= 0`.
- `Wars.ally: Int32Array`: for a war an ally joined in defence (`declare(..., joined=true)` from `protectorsOf`), the
  war it joined; otherwise -1. This is needed for betrayal and for the UI ("came to the aid of").
- `BondEnd.Betrayed: 5`: "one ally broke faith: made a separate peace with the common enemy, turned on its ally, or
  attacked it (EventType.Betrayal / OathBroken extra 1); bA or bB, the one whose capital is the event's `settlement`,
  is the betrayer". Also update the comment on `Lapsed`, which today includes "or the allies fell out".
- EventTypes (oaths: 190–199):
  ```ts
  // oaths (polities): broken truces and betrayed allies (190-199; none when HistoryOptions.oaths is false).
  Betrayal: 190, // the polity ruled from `settlement` broke faith with its ally ruled from `other` in a war they fought together (the bond ends BondEnd.Betrayed): `value` is the war the betrayer left (History.wars; its attacker the betrayer, its defender the common enemy); `extra` is 0 when it made a separate peace, 1 when it also turned on its ally (a WarDeclared follows that year). Towns the enemy ceded follow as Joined
  OathBroken: 191, // the polity ruled from `settlement` declared war on the one ruled from `other` against its oath: `value` is the war (WarDeclared the same year); `extra` is 0 when a truce sworn at the end of an earlier war still held, 1 when the two were allies (the bond ends BondEnd.Betrayed)
  ```
  Optional, step 8: `Avenged: 192`, "the polity ruled from `settlement` took back or repaid the wrong of grievance
  `value` (History.grievances) from the one ruled from `other`; `extra` the GrievanceKind". It is useful for the prose.
  Log it only for kinds 0, 1, 5 and 6 (rare), to avoid spam.

**(rev 2) Further contract additions**
```ts
/** How an arms race between two polities ended (History.armsRaces). */
export const ArmsRaceEnd = { Ongoing: 0, War: 1, Eased: 2, Ended: 3 } as const // War: one declared on the other; Eased: both fell back below ARMS.raceOff; Ended: a polity ended or became the other's vassal
export type ArmsRaceEnd = (typeof ArmsRaceEnd)[keyof typeof ArmsRaceEnd]

/**
 * Arms races, struct-of-arrays in order of starting (arms, rev 2). Each pair of rival polities carries two arms levels
 * x (a against b) and y (b against a) in 0..1, a share of the realm's strength kept under arms against that rival, moving
 * by Richardson's equations every POLITY.slowStep years: dx/dt = k_a·y − a_a·x + g_a (reaction, fatigue, grievance). A race
 * is open while min(x, y) >= ARMS.raceOn and both rose over the last step, until min(x, y) < ARMS.raceOff, war, or the end
 * of either. `level` holds min(x, y) at each decade of the race, 0..255 for 0..1 (levelOff[i]..levelOff[i+1]).
 */
export interface ArmsRaces {
  count: number
  a: Int16Array
  b: Int16Array
  start: Int16Array
  /** Year it ended (-1 open at the end of the run), how (ArmsRaceEnd), and the war it ended in (History.wars) or -1. */
  end: Int16Array
  endCause: Uint8Array
  war: Int32Array
  /** Peak of min(x, y), 0..255, and its year. */
  peak: Uint8Array
  peakYear: Int16Array
  levelOff: Int32Array
  level: Uint8Array
}
```
- `History.armsRaces: ArmsRaces` (empty when arms is off).
- `History.arms: Uint8Array`: per snapshot, each polity's armament M_p (3.11) as 0..255 for 0..1. The layout is like
  `tariff`. All zero when arms is off.
- `Wars.race: Int32Array`: the arms race between the two sides that was open at the declaration, or that ended ≤
  `ARMS.precede` (10) years before it; -1 otherwise.
- EventTypes (oaths block, 190–199):
  ```ts
  Bandwagon: 193, // the polity ruled from `settlement`, too weak to balance, sided with the far stronger one ruled from `other` (HistoryOptions.balance): `value` the stronger polity; `extra` 0 an alliance against the stronger one's rival (Alliance follows), 1 tribute offered unasked (BecameVassal, value + 1000, follows)
  ArmsRace: 194,  // the polities ruled from `settlement` and `other` armed against each other (HistoryOptions.arms): `value` the race (History.armsRaces); `extra` 0 it began, 1 it ended in war (WarDeclared the same year), 2 it eased
  ```
  192 stays reserved for the optional `Avenged`. 195–199 are spare.

### 3.3 PolityState additions (`polity/state.ts`)
- `rngOath: Rng`, created with `createRng(s.world.seed, 'history-oaths')`. Put it in the `v2` literal: the comment at
  `createPolityState` says the `base` literal must stay under 128 properties.
- `oaths: boolean`.
- Grievance rows: `gKind, gWronged, gOffender, gYear, gW0, gW (current), gEnd, gEndCause, gSite, gWar, gTowns, gHeir:
  number[]`, plus `gActive: number[]`, ascending row ids.
- `gEvSeen: number`: the event-scan cursor, like `ps.evSeen`.
- Per relation, pushed in `ensureRelation`: `relOath: number[]` (the war whose peace set the truce, or -1 for
  secession, partition and civil truces). Optional `relGrudge: number[]` caches G(a→b) and G(b→a) as two entries per
  relation, recomputed each slow step.
- Per polity, grown in the polity grow function alongside pTariff etc: `pFaith: Float64Array` (the faithless score)
  and `pFaithSnap` (or write snapshots in the existing snapshot hook where tariff is snapshotted).
- Per war: `wCause: number[]` and `wAlly: number[]`, pushed in `declare()`.
- Diag counters: `betrayals, separatePeace, turned, trucesBroken, alliesAttacked, revengeWars, grievances, avenged,
  inherited`.
- **(rev 2)** δ: no state. It is computed on demand by `oathDelta(s, ps, p)` in the new `polity/shadow.ts`, from rulers
  and polity state. Rulers gets one addition: `R.remain: Float64Array` (curtate expected remaining life per whole age,
  built next to `surv` in `createRulers` by summation, for the UI and prose only). Diag counters: `deltaSum, deltaN`
  (mean δ at decisions), `breaksByLowDelta` (δ < 0.6).
- **(rev 2) balance**: `rngAlign: Rng` = `createRng(seed, 'history-align')` (in the `v2` literal), `balance: boolean`.
  Per relation, pushed in `ensureRelation`: `relThrAB, relThrBA: number[]`, the cached θ(a→b) and θ(b→a) for this slow
  step (3.10). `relTradeV: number[]` caches the trade volume v that relationStep already computes **[A]: confirm v is
  per relation there**. Per polity: `pAggr: Float64Array`, conquest wars started in the last `ALIGN.aggrYears`, decayed.
  `hegemon: number` is the current top realm by pMass (-1). Diag: `balancing, coalitionAlliances, bandwagonAlly,
  bandwagonTribute`.
- **(rev 2) arms**: `arms: boolean`. Per relation, pushed in `ensureRelation`: `relArmA, relArmB: number[]` (x, y),
  `relArmPrevA/B` (the values one step back, for the "rising" test) and `relRace: number[]` (open race row, -1). Race rows
  are `raA, raB, raStart, raEnd, raCause, raWar, raPeak, raPeakY: number[]`, plus `raLevel: number[][]`. Per polity:
  `pArms: Float64Array` (M_p) and its snapshots. Diag: `races, racesWar, racesEased, armsCapYears`.

### 3.4 Params (`polity/params.ts`, new `export const OATH`, with a doc comment per line like the others)

All defaults in this table and in the rev-2 OATH, ALIGN and ARMS tables below are **design defaults, not sourced
facts**. The models they parameterise are cited (References); the numbers are tuning choices.

| name | default | meaning |
|---|---|---|
| `halfLife` | 30 | years. After 100 years w ≈ 0.10·w0, which matches the brief's "fade over ~a century" |
| `keep` | `0.7937005259840998` | per-slow-step factor = 0.5^(slowStep/halfLife), **written as a literal**; a unit test asserts `Math.abs(keep - 0.5 ** (POLITY.slowStep / halfLife)) < 1e-12` |
| `forget` | 0.05 | put aside below this weight |
| `w.truce` | 1.0 | TruceBroken |
| `w.ally` | 1.5 | AllyBetrayed |
| `w.bond` | 0.5 | BondThrownOff |
| `w.town` | 0.12 per town, merged per (war, wronged); capped at 0.6 per row | TownConquered |
| `w.sack` | 0.35 | TownSacked |
| `w.holy` | 0.9 | HolyCityTaken |
| `w.capital` | 0.8 | CapitalTaken |
| `half` | 1.0 | saturation: g = G / (G + half) in [0, 1) |
| `rivalry` | 0.03 | dR per year += rivalry · (g_ab + g_ba) / 2·2, i.e. up to +0.03 per side (comparable to `claim` 0.04 and `recentWar` 0.03) |
| `drive` | 1.5 | declaration mul ·= 1 + drive · g_pq (p's grudge against q) |
| `revengeMin` | 0.3 | g at which a declaration counts as revenge (`Wars.cause`) |
| `avenged` | 0.3 | weight multiplier on the grievances behind a won revenge war; a TownConquered/CapitalTaken/HolyCityTaken row whose town is back with the wronged ends avenged |
| `inherit` | 0.5 | share passed to each successor state |
| `breakMul` | 0.12 | truce-breaking chance multiplier (see 3.6) |
| `faithTruce` | 0.6 | faithless score added per broken truce |
| `faithAlly` | 1.0 | faithless score added per betrayal / attack on an ally |
| `repHalfLife` | 50 | and `repKeep = 0.5^(10/50) = 0.8705505632961241` (literal) |
| `repMax` | 3 | clamp; also the snapshot scale |
| `witnessR` | 0.08 | one-off rivalry with the breaker for each other polity bordering it or allied with the victim |
| `repRivalry` | 0.004 | per year, rivalry of the breaker's neighbours += repRivalry · f/(f+1) |
| `repAlliance` | 1.5 | alliance and join chance ÷ (1 + repAlliance · f) |
| `defect` | 0.12 | yearly base defection chance when the case is full (see 3.7) |
| `cedeMax` | 2 | border towns the enemy may cede to buy a separate peace |
| `turnR` | 0.5 | rivalry with its ally above which a defector also turns on it |

All values are **[A]** first guesses; tune them in step 9.

**(rev 2) Shadow-of-the-future params (in `OATH`)**. The payoffs are in *realm shares per period*, where a period is
`POLITY.slowStep` = 10 years and 0.1 ≈ a tenth of the realm's people.

| name | default | meaning |
|---|---|---|
| `delta0` | 0.9 | base patience per period: the realm's institutions, before the ruler. Assumed |
| `lawSec` | `[0.9, 0.6, 0.3, 0.7]` | heir-security weight λ by law (Primogeniture, Partible, Elective, Seniority). Assumed ordering: an elected successor owes the dead ruler's promises least |
| `heirMinor`, `heirNone` | 0.6, 0.25 | λ multiplier when the best living heir in the pool is a minor or illegitimate, or when there is no heir at all |
| `crisisSec` | 0.5 | λ × this while `inCrisis` |
| `dDanger` | 0.3 | δ × (1 − dDanger·dangerAvg[capital]): a besieged realm's future is uncertain |
| `deltaMin`, `deltaMax` | 0.05, 0.95 | clamp (δ/(1−δ) ≤ 19) |
| `deltaNoRulers` | 0.72 | δ when rulers are off: the value for a 44-year-old with a secure heir and moderate danger |
| `takeMax` | 3 | border towns counted in the gain of a broken truce (capital excluded) |
| `warCost` | 0.04 | c_w: cost of one war per period, in realm share (deaths, exhaustion). With finances: × (1 + finNeed) |
| `hostile` | 0.5 | h: expected wars per period once the pair are enemies for good (grim-trigger punishment) |
| `tradeW` | 0.05 | t = tradeW·v/(v+200): trade lost with the partner |
| `allyW` | 0.15 | a = allyW·θ(c→p): value of an alliance = the threat it balances (3.10; proxy without balance: smoothstep(0.7, 1.2, R(p,c))) |
| `tieW` | 0.03 | marriage tie (rulers) |
| `threatW` | 0.1 | gain from removing a threat: threatW·θ(q→p) |
| `repCost` | 0.03 | value lost per period per unit of faithless score (fewer alliances and joins) |
| `breakSpan` | 0.1 | smoothstep width of the excess E (3.6a) |
| `bondW` | 0.05 | for defection: value of the old reasons to stay (grudge against the enemy, rivalry, same people, tie) per unit |

**(rev 2) `export const ALIGN`** (balance of threat, 3.10)

| name | default | meaning |
|---|---|---|
| `preR` | 0.3 | θ is computed only for pairs with R ≥ preR or a grudge > 0 (perf) |
| `thetaMin`, `thetaFull` | 0.25, 0.6 | alliance chance ramps smoothstep(thetaMin, thetaFull, min(θx, θy)) |
| `wR`, `wG`, `wF`, `wA` | 0.6, 0.4, 0.3, 0.3 | intent = clamp01(wR·smoothstep(0.3,1.2,R) + wG·g(x,c) + wF·f_c/(1+f_c) + wA·aggr_c) |
| `aggrYears` | 50 | aggr_c = n/(n+2), n = conquest wars c started within aggrYears |
| `coalition` | 1.5 | chance × (1 + coalition) when c is the hegemon |
| `maxAlliances` | 3 | cap when the new alliance is against a threat one of its alliances already faces (else 2, as today) |
| `joinBase`, `joinTheta` | 0.6, 0.8 | join chance = ALLIANCE.join·(joinBase + joinTheta·θ(p→ally)), ≤ 0.95 |
| `hegemonMin` | 0.25 | the top realm by pMass counts as a hegemon when it holds ≥ this share of polity population |
| `weak` | 0.15 | a bandwagoner: Chiefdom, or pPop < weak·pPop[h] |
| `bandTheta` | 0.5 | θ(h→x) needed to bandwagon |
| `band` | 0.08 | chance per slow step × smoothstep(bandTheta, 1, θ) × (1 − f_h/(1+f_h)) |
| `bandR` | 0.2 | relR(x,h) := min(relR, bandR) after bandwagoning |

**(rev 2) `export const ARMS`** (Richardson, 3.11; rates per year, integrated by `substeps` = 2 explicit-Euler steps of dt = slowStep/2 = 5 years each slow step)

| name | default | meaning |
|---|---|---|
| `substeps` | 2 | Euler substeps per slow step (dt = 5 y) |
| `a` | 0.05 | fatigue (cost of keeping arms): a_x = a·(1 + fatigue·need_x) |
| `k` | 0.025 | reaction to the rival's arms: k_x = k·rulerWar(x) (0.5..1.5; 1 without rulers) |
| `fatigue` | 1 | need_x = finNeed(s,x) with finances, else min(1, pExh[x]) |
| `gR`, `gG`, `gT`, `gTrade` | 0.006, 0.008, 0.006, 0.004 | g_x = gR·smoothstep(0.5,1.2,R) + gG·g(x,y) + gT·θ(y→x) − gTrade·v/(v+200) (may be < 0: Richardson's goodwill) |
| `max` | 1 | clamp x to [0, max] |
| `proj` | 0.3 | war power × (1 + proj·x) on that pair's fronts |
| `pool` | 0.3 | M_p = min(1, max_q x_pq + pool·(Σ_q x_pq − max)) |
| `costMul` | 2 | finances: garrison × (1 + costMul·M_p), replacing (1 + rivalArmy·min(1, maxR)) |
| `drain` | 0.3 | proxy without finances: capital wealth −= drain·M_p·WEALTH.decay·wealth each year |
| `raceOn`, `raceOff` | 0.3, 0.18 | race opens when min(x,y) ≥ raceOn and both rose; closes below raceOff (hysteresis) |
| `peace` | 0.5 | x, y × peace at closeWar (demobilisation) |
| `precede` | 10 | years: a race closed this recently still counts as the war's precursor (`Wars.race`) |

Unit tests on the constants: `ARMS.k·1.5·ARMS.k·1.5 < ARMS.a·ARMS.a` (continuous stability for the most warlike pair,
k_x·k_y < a_x·a_y), and `(POLITY.slowStep/ARMS.substeps)·(ARMS.a·(1+ARMS.fatigue) + 1.5·ARMS.k) < 1`, i.e. 5·0.1375 = 0.69 (the explicit-Euler
map is monotone, with no overshoot or oscillation). With a single 10-year step this would be 1.375: still stable (< 2)
but oscillating, which is why there are two substeps.

### 3.5 Grievance rules (new file `polity/grievances.ts`, with a file-header design comment in the style of war.ts)

```
record(kind, p_wronged, q_offender, w, site, war):
  if p == q or either ended: skip
  TownConquered: merge into the open row with (kind, p, q, war) -> towns++, w0 = gW = min(capTown, w0 + w.town)
  else: new row, w0 = gW = w
decay (every slow step, in gActive order):  gW *= OATH.keep;  if gW < forget -> end (Faded)
avenge (every slow step): TownConquered / CapitalTaken / HolyCityTaken row whose site is again a member of p -> end (Avenged)
                          closeWar of a war with cause >= 0 won by the wronged attacker: every open row (p, q) gW *= avenged
grudge G(p, q) = sum gW over p's open rows against q;   g(p, q) = G / (G + half)
```

Where wrongs are recorded. Keep it **RNG-free**, so that recording alone, with no effects, changes no draws.
- **TownConquered, TownSacked, CapitalTaken**: inline in `war.ts conquer()` and `capitalFalls()`. The wronged is the
  polity that held v before `setPolity`; read `ps.polity[v]` before the call. The offender is p. `conquer` knows
  `wasCap`.
- **HolyCityTaken**: an event scan at the start of `grievanceStep` (`for k in gEvSeen..events.length`) for
  `HolyCityFell`. The wronged is the defender, or attacker, of war `extra` other than the polity now holding v.
  Religion logs HolyCityFell inside its own yearly system, so the scan avoids coupling and catches it at the next slow
  step. **[A]** Check the system order in `history/index.ts` and whether a one-step lag matters (it doesn't for
  decay-scale effects).
- **BondThrownOff**: in `bonds.ts endBond` when `cause === Freed`. The wronged is bB (the overlord) and the offender
  is bA. This also covers `rulers/marriage.ts:102`, which calls endBond.
- **TruceBroken** and **AllyBetrayed**: in 3.6 and 3.7.

Effects:
- `relations.ts relationStep`: inside the loop, when `ps.oaths`, add
  `d += OATH.rivalry * (g(a,b) + g(b,a))`. It applies even with no border edges, since grudges cross a gap.
  **[A]** Decide whether it applies only while they border each other; relationStep only updates pairs that exist
  anyway. Plus `+ repRivalry * f/(f+1)` for each side's faithless score.
- `war.ts declarations`: `mul *= 1 + OATH.drive * g(p, q)`. This is directional (p avenges a wrong done to p).
  When `g(p,q) >= revengeMin`, `wCause[w]` = the row with the largest gW for (p, q).
- Optional: a grudge raises the vassal's will to revolt, `VASSAL.rebel * (1 + g(vassal, overlord))`. Left out of v1.

Inheritance (step 7):
- `realm.ts successors()` (Fragment/Revolt/Colonial origins), `civil.ts partition`/civil war, and `capitalFalls` →
  `successors`: each new successor q of `parent` copies every open row where `parent` is wronged, with
  `w = inherit·gW` and `heir = row`, while the offender lives and is not q. The parent's own rows stay if it lives.
  If it ended, they end with cause 3, passed to an heir.
- Rows where the ended polity is the **offender** end with cause 2 (the wrong died with the realm). Exception: on
  `PolityEnd.Reunified` / `Absorbed` (`endPolity(..., by)`), rows against the absorbed realm are re-pointed to the
  absorber. Rows held **by** the absorbed realm pass to the absorber at full weight, except rows against the absorber
  itself, which end. This is "the reunified realm takes up the old quarrels".
- **[A]** Rows between a parent and its own successor ("the rebels took our towns") come from Conquered events in a
  civil war. Keep them; they drive reconquest wars, which matches kinStep's spirit.

### 3.6 Truces as oaths (step 5)
- `closeWar` sets `relOath[r] = w` along with relTruce. `successors`/`partition`/`civil` set `relOath[r] = -1`.
  **[A]** Whether a partition truce among heirs should count as an oath: proposed no for v1, and documented.
- `declarations`: replace the hard skip with the following:
  ```
  inTruce = s.year < relTruce[r]
  if inTruce && !(ps.oaths && relOath[r] >= 0): continue          // unchanged for non-oath truces and oaths off
  ... compute drive and mul as now ...
  if !inTruce: draw from rngWar exactly as now
  else:        (rev 2) E = oathExcess(s, ps, p, q, r, OathCase.Truce)          // 3.6a; RNG-free
               chance = slowStep*declare*rv*mul * OATH.breakMul * smoothstep(0, OATH.breakSpan, E) * (1 + OATH.drive*g(p,q))
               draw from **rngOath** (so the rngWar sequence of the non-truce pairs is untouched)
               (rev 2) exactly one rngOath draw per in-truce oath candidate that reaches this line, whatever E is:
               the same draw count as the rev-1 honour rule. Do not skip the draw when E <= 0.
               (rev 1 had honour_p = 0.5*rPiety + 0.5*(1 - rWar) and the factor 2*(1 - honour_p); superseded.)
               (rev 2) In-truce candidates must still pass `exposedFront > 0` (RNG-free) so that adv is known; drive's
               smoothstep(advLow, advHigh, adv) is not applied, because E carries the odds through `win`.
  on success: declare(...); then oathBroken(s, ps, p, q, w, 0)
  ```
  **Draw-order caveat [V]:** `rngWar` draws happen per candidate in the loop. Routing truce-pair draws to `rngOath`
  keeps the rngWar sequence identical until the world actually diverges, because the extra war itself consumes rngWar
  in `declare()` for buffer and join draws. That is the best available.
- `oathBroken(p, q, w, extra)`: record a TruceBroken row (w.truce) or an AllyBetrayed row (w.ally). Add
  `pFaith[p] += faithTruce|faithAlly` (clamp repMax). Witnesses: every relation (p, c) with c ≠ q, c alive, and
  (c borders p, or allied(c, q), or c shares q's people) gets `relR += witnessR`, clamped to 2. Log
  `OathBroken(capital p, capital q, w, extra)`. Bump diag.
- **Attacking one's own ally:** in `declarations`, if `ps.oaths && allied(ps, p, q)`, end that bond with
  `BondEnd.Betrayed` immediately after `declare`, then call `oathBroken(..., extra 1)`. Otherwise bondStep would later
  mark it Lapsed. Give this a damping factor as well: multiply the chance by `OATH.breakMul * smoothstep(0, breakSpan, E)` with
  `E = oathExcess(..., OathCase.AllyAttack)` (rev 2; rev 1 used `2*(1-honour)`), drawn from rngOath like a truce break. **[A]** This changes the frequency of a behaviour that exists today (0–4 per seed);
  acceptable.
- Reputation: `pFaith[p] *= OATH.repKeep` each slow step (in grievanceStep). In `allianceStep`, the chance is divided
  by `(1 + repAlliance*(f_x + f_y))`. **Do not add or skip a `ps.rng` draw**: keep the same draw and only change the
  threshold. In `declare()`'s protector loop, the join chance is `ALLIANCE.join / (1 + repAlliance * f_q)`, also
  threshold-only, with no extra draws. These threshold changes are no-ops when f = 0, so with oaths on and nobody
  faithless the rngWar and rng sequences stay identical.
- **Why per polity, not per ruler:** treaties are between realms, and the History stores bonds and wars by polity.
  Reigns average around 20 years (sim behaviour, not a historical statistic); a per-ruler score would vanish with each succession and the world would forget a
  betrayal in a decade. A realm-level score that decays (half-life 50) outlives the ruler but fades within about two
  generations. It is also cheap: one Float64Array per polity, with no RulerState dependency, so it works with rulers
  off. The ruler is still blamed in the prose: the UI finds the reign at the event year and can give the epithet
  "the Faithless" / "Oath-breaker" (3.9). That costs no sim state.
- Orders: keep `orders/system.ts:356` returning `Truce`. Player-ordered wars still respect truces in v1. **[A]**
  Revisit later as an "order a treacherous war" feature.

### 3.6a (rev 2) Shadow of the future: δ and the oath calculus (new file `polity/shadow.ts`)

**Model.** Each oath (a truce sworn at a peace, or an alliance) is a repeated Prisoner's Dilemma played once per period
(slowStep = 10 years). With grim-trigger punishment, a player keeps faith iff δ ≥ (T − R)/(T − P) (the folk-theorem
condition; Friedman 1971; Axelrod 1984, whose continuation weight w is "the shadow of the future"; the grim-trigger
derivation is textbook, e.g. Kariv n.d.). Rearranged, it breaks iff
`T − R > δ/(1−δ)·(R − P)`. Two caveats, stated in the code header: grim trigger is the harshest punishment, so this
condition is the most permissive version of cooperation; and real rulers do not solve the game. The rule is used as a
*propensity*, smoothed by smoothstep, not as a hard threshold. On top of it sits a reputational cost C: breaking adds
to the faithless score, which costs alliances and joins (3.6) for a stream that decays by `repKeep` each period.

**Payoffs in sim quantities** (realm shares per period; p considers breaking with q):
```
gain   = rulerWar(p) · win · Σ_{t ∈ take} pop_t / (pPop[p] + 1)
         take = up to OATH.takeMax of q's members on the p–q border (relEdges), by pop, excluding pCapital[q]
         win  = adv² / (1 + adv²), adv from exposedFront (as in declarations; the campaign's A²/(A²+D²) form)
t      = tradeW · v/(v+200)                         (trade lost; v = relTradeV[r])
a      = allied(p,q) ? allyW · θ(c→p) : 0           (the alliance is worth the threat c it balances; 3.10, or proxy)
       + (tied(p,q) ? tieW : 0)
T − R  = gain + threatW·θ(q→p) − warCost − (t + a)  (towns offered, threat removed, minus the war and this period's peace dividend)
R − P  = t + a + hostile·warCost                    (each period of cooperation vs. permanent enmity)
C      = faith·repCost·(0.5 + piety_p) / (1 − δ·repKeep)   (faith = faithTruce or faithAlly; the pious fear perjury; piety 0.5 without rulers)
E      = (T − R) − δ/(1 − δ)·(R − P) − C
```
`OathCase` = Truce (3.6), AllyAttack (3.6) or Defect (3.7, its own T − R and R − P, given there). `oathExcess(s, ps, p,
q, r, case)` returns E. It is pure and RNG-free.

**δ for each ruler** (`oathDelta(s, ps, p)`, pure):
```
age    = year − rBorn[cur[p]];  s10 = surv[min(age+10, MAX_AGE+1)] / surv[age]     // reign survival over one period
         league head / elective term: s10 = min(s10, max(0, rDeath − year) / 10)     // the term end is public
heir   = best living heir in the pool (pickHeir's order, read-only): adult & legitimate → 1, minor or bastard → heirMinor, none → heirNone
λ      = lawSec[law[people]] · heir · (1 − SUCCESSION.base[law]) · (inCrisis ? crisisSec : 1)
δ      = clamp(delta0 · (s10 + (1 − s10)·λ) · (1 − dDanger·dangerAvg[pCapital[p]]), deltaMin, deltaMax)
rulers off: δ = deltaNoRulers
```
λ is how much the ruler values payoffs after their own reign, as the dynasty's continuation. Worked values ([A]
inputs, s10 from the computed table in section 2): a 25-year-old with an adult heir under primogeniture gets δ ≈ 0.87,
so δ/(1−δ) ≈ 6.7. A 44-year-old, same heir, danger 0.3, gets ≈ 0.78 (3.6). A 65-year-old with no heir under an
elective law gets ≈ 0.33 (0.49). So old, heirless, elected or embattled rulers break oaths; young dynasts with heirs
keep them. Typical magnitudes: 3 border towns of 3k against a 60k realm at win 0.6 give gain ≈ 0.09, so T − R ≈ 0.03,
R − P ≈ 0.04, and C ≈ 0.056 at δ 0.78. That gives E ≈ −0.17: no break. At δ 0.33: E ≈ 0.03 − 0.02 − 0.03 ≈ −0.02, near
breaking. A doubled gain breaks. **[A]** This is the intended regime; tune `breakMul` and `breakSpan` in step 9 toward
the targets in section 5.

**Determinism.** δ and E only read state. No new draws are made, and the draw sites and counts are exactly those of rev
1. **The `'history-oaths'` draw count is unchanged** whenever the world state is the same. The world itself diverges
once a decision differs, which is expected. Arithmetic is `+ − * /` and table lookups only, with no pow.

**Tests.** (1) Property test: for random T > R > P and C = 0, `E > 0` ⇔ `δ < (T−R)/(T−P)` (to 1e-12). (2) δ is
monotone: δ is non-increasing in age, and λ is non-decreasing in heir status. (3) δ ∈ [deltaMin, deltaMax]. (4) Stats:
at OathBroken events, mean δ is below the mean δ over all candidate checks (diag `deltaSum/deltaN`), by ≥ 0.05.

### 3.7 Alliance betrayal (step 6)
- Linking: in `declare()`'s protector loop, before the recursive declare, note `const wq = w` (the war being declared,
  p→q). After `declare(s, ps, rx, x, p, Conquest, true)`, set `ps.wAlly[newW] = wq`. Every war pushes `wAlly = -1`
  and `wCause = -1` by default.
- Defection check: yearly in `campaigns`, or every POLITY.step in a new `betrayalStep` called from `system.ts` right
  after `bondStep`. **Proposed: every step (5 years), in `grievanceStep`'s sibling `betrayalStep`.** Fewer draws, and
  it sits after bondStep, so bonds are already current. For each active war wx with `wAlly[wx] = wq >= 0`, where wq is
  still active and the alliance between x and q is still in force:
  ```
  x = wAtt[wx] (the ally), e = wDef[wx] (the common enemy), q = wDef[wq] (the ally it came to help)
  (rev 2) the rev-1 honour line is replaced by delta_x = oathDelta(s, ps, x) (3.6a); no new trait draw
  offer  = towns e could cede: e's members on the x–e border (relEdges), ranked by pop, up to cedeMax:
           value_t = sum pop of those towns / (pPop[x] + 1)  -> o = value_t / (value_t + 0.05)
  fear   = smoothstep(1, 2, advantageAt(e, x))                                                // e can hurt x more than x gains
  tired  = min(1, pExh[x])
  bond   = g(x, e) + relationOf(x, e) / 2 + (tied(x, q) ? 0.5 : 0) + (pPeople[x] == pPeople[q] ? 0.25 : 0)  // reasons to stay
  (rev 2) the payoffs, in realm shares per period (3.6a, OathCase.Defect):
  T − R  = value_t + threatW·θ(e→x) + warCost·(1 + tired) − a_xq      // towns ceded, enemy's threat removed, war cost avoided, alliance lost
  R − P  = a_xq + bondW·bond + hostile·warCost                        // keeping q as a friend vs. q as an enemy for good
  E      = (T − R) − δ_x/(1 − δ_x)·(R − P) − C(faithAlly, δ_x)
  chance = POLITY.step * OATH.defect * smoothstep(0, OATH.breakSpan, E)   (one rngOath draw per eligible war, as in rev 1)
  (rev 1's case = 0.5*o + 0.3*fear + 0.4*tired - 0.6*bond and the factor 2*(1-honour) are superseded; fear = smoothstep(1,2,adv(e,x))
   is kept as the proxy for θ(e→x) when balance is off.)
  ```
  This needs `offer > 0 || tired > 0.5`: the enemy has something to give, or the ally is spent.
- On defection:
  1. `endBond(alliance(x, q), Betrayed)`.
  2. **Separate peace:** e cedes the chosen towns to x. Use `setPolity(v, x, dist)`, set `conqueredAt[v]` and
     `unrest[v] = 0.3`, and log `Joined(v, capital x, x)`. **[A]** Check that capital-adjacent and capital towns are
     never ceded: exclude `pCapital[e]`. Then `closeWar(wx, ceded > 0 ? AttackerGains : WhitePeace)` (closeWar is
     module-private in war.ts, so export it). This sets the truce and oath between x and e as usual.
  3. **Turn on the ally**, if `relationOf(x, q) >= turnR`, x borders q, and `exposedFront`/adv against q is >= 1:
     x declares on q with `declare(rxq, x, q, Conquest, joined=true)` (no cascade). The new war gets `wCause` = the
     betrayal row, and extra = 1. **[A]** Do this only if pWars[x] < maxWars after closing wx.
  4. Record `AllyBetrayed(q wronged by x, w.ally, war wx)`, `pFaith[x] += faithAlly`, apply witnesses as in 3.6, and
     log `Betrayal(capital x, capital q, wx, extra)`. Order: the Betrayal event first, then Joined, PeaceMade and
     WarDeclared, so readers can attach them.
- q's grudge then drives revenge after its war with e ends (through drive and rivalry). With two-sided grudges
  (e also took q's towns), the history gets three-cornered feuds. That is the intended drama.

### 3.8 Determinism strategy (summary)
- All new random decisions draw from **`'history-oaths'`** (`ps.rngOath`). Existing streams are never drawn more or
  less often by the oaths code itself. Threshold changes (alliance and join chances) reuse the existing draw.
- Iteration orders: `gActive` in ascending row order; wars in `activeWars` order (creation order); relations in
  relation order. There is no Map iteration; `relIndex` is lookup only.
- Arithmetic: decay uses literal per-step factors, with no pow or exp. Saturation uses `G/(G+half)`.
- Bit-identity checks:
  1. `oaths: false` ⇒ identical to main 8cabf09 on every History field (script comparing JSON of all typed arrays and
     events; record it in a test comment, following the repo convention).
  2. **After step 3** (grievances recorded, effects not yet on): oaths on ⇒ identical to oaths off on every pre-existing
     field. Write this as a real vitest test on a short run (e.g. 600 years, one seed) while it holds. Then delete or
     convert the test in step 4, because effects make it diverge (this is expected; say so in the commit message).
  3. The existing same-seed determinism tests keep passing throughout.
- **(rev 2)** Streams: δ is RNG-free. `balance` draws only from `'history-align'` (`ps.rngAlign`): new alliance draws
  and bandwagon draws. **With balance on, `allianceStep` makes no `ps.rng` draws, so the `'history-polities'` sequence
  (raids, etc.) shifts relative to balance off.** This is accepted and documented in the commit. The alternative (still
  drawing ps.rng for legacy candidates) couples two rule sets for no gain. `bufferAlarm` keeps its `roll` (rngWar)
  unchanged. Join-chance changes are threshold-only on the existing rngWar draw. `arms` is RNG-free, but it changes
  `adv` and so changes which declaration candidates reach their rngWar draw. That coupling is unavoidable, and is
  documented as in risk 3.
- **(rev 2)** Iteration: θ is computed in relation order; bandwagon candidates in `ps.alive` order; arms updates in
  relation order, with both substeps reading the previous substep's (x, y) pair simultaneously (compute both
  derivatives before writing).
- Golden or stat-sensitive tests that change after step 4: expected, since this is a sim change. Record which tests
  and why ("grudges raise rivalry → more and earlier wars").

### 3.9 UI and sagas

**`src/ui/politiesData.ts`**
- Add `PolityEvent.Betrayal: 190, OathBroken: 191`. Include them in `eventsOf` for both polities: the builder filters
  types, so extend the filter (~line 424).
- Add `grudgesOf: number[][]`: grievance rows per wronged polity.
- Add `standingGrudges(pd, p, year)`, which returns per offender `{ offender, w, rows[] }` with
  w = Σ w0·0.5^((year−y0)/halfLife) over rows open at that year (endYear < 0 or > year), sorted by w descending.
- Add `faithlessAt(pd, p, snap)`, read from `History.faithless`.

**`src/ui/polityFormat.ts`**
- In `describeV2` (Chronicle headline):
  - Betrayal, extra 0: `${x} breaks faith with ${q} and makes a separate peace with ${e}`, plus
    ` (${n} towns ceded)` when the Joined events of that year from e to x are counted.
  - Betrayal, extra 1: `${x} abandons ${q} and turns on it`.
  - OathBroken, extra 0: `${p} breaks the truce of ${y0} and makes war on ${q}`. y0 is the end year of the war whose
    truce it was: the latest war between them that ended before this one.
  - OathBroken, extra 1: `${p} makes war on its own ally ${q}`.
- In `describeV2For` (inspector):
  - self: "Broke faith with its ally X (a separate peace with Y)" / "Broke the truce with X".
  - other side: "Betrayed by its ally X" / "X broke the truce with it".
- Category key: `'betrayal'` for both types. Add a colour or icon wherever the category keys are mapped (grep
  `'alliance'` in polities.css and historyIndex.ts).
- Chronicle register is careful and hedged: "breaks faith with" states the record, with no motives.

**`src/ui/historyIndex.ts`**
- Extend the shown predicate at line 423 with `|| (type >= 190 && type <= 199)`.
- Add 190 and 191 to the headline list at line 438. They are rare, so leave them ungrouped.
- If `Avenged` exists, give it non-headline display.

**`src/ui/chronicleFilter.ts`**: put them in the same group as war and alliance entries.

**`src/ui/politiesPanel.ts`**
- In past bonds: `endW` for `BondEnd.Betrayed` reads `', betrayed by it'` or `', it betrayed'`, depending on who the
  betrayer is (resolve it through the Betrayal/OathBroken event in that year).
- New section after Bonds, `cap('Grudges')`. Show at most 4 offenders:
  "Against Rilkochal: the sack of Vebena (1203), the broken truce of 1240 · strong" (strong ≥ 1, held ≥ 0.4,
  fading < 0.4). Then "Held against it by: Tiboizo (the betrayal of 1241) · …" (rows where selected is the offender).
- Reputation line: `Faithless` (f ≥ 1), `Doubted` (≥ 0.3), else nothing. It always shows "Broke N oaths, last in Y"
  when N > 0.
- The panel memo key (~line 1218 hashes bonds): include grievances or faithless if the panel caches per year.

**`src/ui/sagas/state.ts`** (stateSaga, in section hWar after civil wars). New T keys, `[chronicle], [legend]`:
```
betrayer:  [['In {year} it broke faith with its ally, the {ally}, and made a separate peace with the {enemy}{gain}.'],
            ['In {year} {ruler} sold the friendship of the {ally} to the {enemy}{gain}, and the name of the {state} was spoken with scorn for a generation.']]
turned:    [[' It then made war on its former ally.'], [' Then it turned its spears on the friend it had forsaken.']]
betrayed:  [['In {year} its ally, the {ally}, deserted it in its war with the {enemy}.'],
            ['In {year} the {ally}, sworn to stand by it, left it alone before the {enemy}.']]
truceBroke:[['It broke a sworn truce {times}, first in {year}, against the {victim}.'],
            ['{times} its kings forswore the peace, first in {year}, against the {victim}.']]
revenge:   [['The {wrong} was not forgotten: in {year} it went to war with the {foe}, it seems in part to avenge it.'],
            ['The {wrong} cried out for {n} winters, until in {year} the {state} rode against the {foe} to answer it.']]
faithless: [['Among its neighbours it had a name for faithlessness.'], ['Its word, men said, was written on water.']]
```
- `{wrong}` comes from GrievanceKind: "sack of Vebena in 1203", "loss of its capital, Vebena, in 1203", "fall of the
  holy city of X", "broken truce of 1240", "betrayal of 1241".
- Use the revenge line once, for the strongest `Wars.cause` row among the state's wars as attacker.
- The Chronicle register hedges ("it seems in part", "had a name for"), since the sim knows causes only as weights.
  The Legend register is storylike.

**`src/ui/sagas/year.ts`**: one sentence per decade if any: Chronicle "In 1241 Kloson broke faith with Tiboizo." /
Legend "In 1241 Kloson forsook Tiboizo, its sworn friend."

**`src/ui/sagas/epithets.ts`**: in `reignFacts`, add `betrayals` (Betrayal or OathBroken events whose settlement was
the reign's capital during the reign). In `rulerEpithet`, `if (f.betrayals >= 1) return 'the Faithless'`; place it
after Usurper and before Pretender. **[A]** Check the ordering against existing tests in rulers or sagas tests that pin
epithets.

**`src/ui/sagas/wars.ts`** (optional): a revenge war against the town it lost could be named "the War of Vebena's
Vengeance". Lower priority; skip unless it is cheap.

**`src/sim/history/polityStats.ts`**: add the counts to the v2 report (`formatPolityV2`) and add lines at ~826 for
the new events.

**README.md:50**: change to "States form, hold land and claim the empty land around it, fight wars and civil wars,
take vassals and pay tribute, swear alliances and truces and sometimes break them; wrongs (towns taken, sacks, broken
oaths) are remembered for generations and feed revenge wars; groups of trading towns can form leagues."
(rev 2) Append: "Old or heirless rulers keep faith less; coalitions gather against the most threatening realm, and its
weak neighbours side with it; rivals arm against each other, and arms races often, but not always, end in war."

**(rev 2) UI for δ, balance and arms**
- `polityFormat.ts describeV2For`, OathBroken/Betrayal (self): a hedged clause, computed in the UI from rulersData at
  the event year, never from sim internals: `, its ruler old and without an heir` when age ≥ 60 and there is no adult
  heir in the king list's next reign (approximate, since the UI has no heir pool), or `, during a disputed succession`
  when a crisis covers the year.
- Alliance headline (existing `Alliance(39)`, `extra` = the threat c): when ≥ 1 other alliance in force that year has the
  same `bThreat`, say `${x} and ${y} join the league against ${c} (${n} realms)`. Chronicle register: "join the league
  against"; Legend: "bound themselves with the others who feared ${c}".
- Bandwagon (193): Chronicle `${x} sides with the mighty ${h}` (extra 0) / `${x} offers tribute to ${h} unasked`
  (extra 1). Legend (state saga, hWar): `['Too small to stand against the {h} and with no friend to stand beside it,
  the {state} chose to bend rather than break.']`.
- ArmsRace (194), Chronicle (hedged): extra 0 `${a} and ${b} arm against each other`; extra 2 `The arming of ${a}
  and ${b} slackens`; extra 1 is not shown as its own line. Instead, the WarDeclared headline of `Wars.race >= 0`
  gains ` after ${n} years of arming`. Inspector: "Armed against X from 1230 (X armed in turn)". historyIndex: show
  194 as a non-headline entry (it is less rare than oaths). 193 is a headline. Extend the shown predicate already planned
  for 190–199.
- `sagas/state.ts` key `armsRace`: `[['From {year} it armed against the {rival}, and the {rival} against it{end}.'],
  ['From {year} the forges of the {state} were never cold, for every spear the {rival} raised it raised two{end}.']]`.
  The `{end}` slot is `, until war came in {y}` / `, until both tired of it by {y}`. `year.ts`: `In the 1230s Kloson and
  Tiboizo raised levies against each other.` / Legend `In the 1230s Kloson and Tiboizo counted each other's spears.`
- **Factions-view overlay** (`render/polities.ts`): a border between two polities in an open race, short of war,
  is drawn as steel-blue ticks across the line. The tick density and alpha come from the race level at the year
  (interpolated from `level`), uploaded like the embargo list (`uArmsCount`, `pl_arms(dom, sec)`, filled from a new
  `politiesData armsRacesAt(pd, year)` → `[a, b, level]`). War and embargo styles take precedence. It is off by
  default and toggled with "Arms races" in the Factions legend. A per-polity tint is not added (it would clash with
  the political colours). M_p instead appears in the panel.
- `politiesPanel.ts`: a line after Grudges: `Arms: heavy (0.62) · racing Tiboizo since 1230`, with bands light < 0.2 ≤
  armed < 0.5 ≤ heavy. Then `Coalition: allied with A and B against C` when ≥ 2 of its alliances share a threat, or
  `Against it: a league of N realms` when the selected polity is that threat.

### 3.10 (rev 2) Balance of threat and bandwagoning (`bonds.ts`, new `polity/align.ts`; switch `balance`)

**Model.** States ally against the greatest *threat*, not the greatest power. Threat is aggregate power × proximity ×
offensive intent (Walt 1987, *The Origins of Alliances*, whose four sources of threat are aggregate power, proximity,
offensive capability and offensive intentions; offensive capability is folded into proximity here). Weak
states with no available ally bandwagon: they align with the threat to deflect it (Walt 1987, ch. 2; Schweller 1994 argues
bandwagoning is more often for profit. That is not modelled; noted). Empirically, balancing dominates bandwagoning
among great powers. That is contested for small states, and the params reflect it: bandwagoning is rare and limited
to weak states.

**Threat** (`threatOf(s, ps, c, x)`, pure, cached per slow step in `relThrAB/BA` for relations with R ≥ preR or a grudge):
```
adv     = advantageAt(s, ps, c, x)                  // Proj_c at x's capital / x's defence = power × proximity  [V]
base    = adv / (adv + 1)                           // 0..1
intent  = clamp01( wR·smoothstep(0.3, 1.2, R(c,x)) + wG·g(x,c) + wF·f_c/(1+f_c) + wA·aggr_c )   // rivalry, x's grudges against c, c's faithlessness, c's recent conquests
θ(c→x)  = base · intent                             // oaths off: g = f = 0
```
`aggr_c` = n/(n+2), where n = conquest wars c started within aggrYears. Keep it incrementally in `pAggr` (+1 at declare, as
a ring of start years, or recount `wStart` over `activeWars` plus a 50-year window; count only Conquest kind).

**allianceStep with balance on** (`allianceStepBalance`; the old body is kept verbatim as `allianceStepLegacy`):
1. `hegemon` = alive polity with max pMass (ties: lower id), if its pPop share ≥ hegemonMin; else -1.
2. Threat list in relation order, both directions: entries (c, x, θ) with θ(c→x) ≥ thetaMin, x Kingdom tier or higher,
   x not c's vassal or bandwagon ally. This replaces `hostA/hostB` (R ≥ 0.7).
3. Pairs i < j of entries with the same c and x ≠ y. Keep every existing filter except `pPop[c] ≥ pPop[x], pPop[y]`,
   which θ subsumes. The cap is `alliances(x) < 2`, or `< maxAlliances` when x already has an alliance whose bThreat = c
   (a coalition grows).
4. `chance = ALLIANCE.chance · smoothstep(thetaMin, thetaFull, min(θx, θy)) · (c === hegemon ? 1 + coalition : 1) ·
   marriageMul / (1 + repAlliance·(f_x + f_y))`. Make one `rngAlign` draw per pair that passes the filters.
5. Effect on bondStep (both modes): the lapse rule also lapses an alliance when `θ(c→a) < thetaMin/2` and the same holds
   for b. This applies only with balance on; with balance off the R rule is unchanged.

**Joining a defensive war** (`declare()` protector loop, threshold only): with balance on,
`joinP = min(0.95, ALLIANCE.join · (joinBase + joinTheta·θ(p→x))) / (1 + repAlliance·f_q)`, where p is the attacker and
x the ally. A coalition partner that fears the attacker comes more readily. Same rngWar draw.

**Bandwagoning** (`bandwagonStep`, every slow step right after allianceStep, only if hegemon h ≥ 0): for x in `ps.alive`
order, x is a candidate if it is alive, x ≠ h, its border touches h (relEdges non-empty), it is not bound, not allied
with h, not at war with h, has `pSub[x] < 0`, and is Chiefdom tier or has `pPop[x] < weak·pPop[h]`.
- `θ = θ(h→x) ≥ bandTheta`, and *no balancer is available*: x is a Chiefdom, or no y has Kingdom+ tier, R(x,y) < calm,
  contact, and θ(h→y) ≥ thetaMin.
- Make one `rngAlign` draw against `band · smoothstep(bandTheta, 1, θ) · (1 − f_h/(1+f_h))`.
- On success: if h has a rival c ≠ x (R(h,c) ≥ ALLIANCE.threat, c alive; the strongest by θ(c→h)), call `ally(x, h, c)`
  and log `Bandwagon(cap x, cap h, h, 0)` before the Alliance event. Otherwise call `subject(s, ps, x, h, true)`
  (tribute) and log `Bandwagon(..., 1)` before BecameVassal. Then set `relR(x,h) = min(relR, bandR)`.
  Diag: `bandwagonAlly` / `bandwagonTribute`.
- [A] A bandwagon ally of h is thereby a protector of h, so it may join h's defensive wars. That resembles the
  "jackal bandwagoning" of Schweller (1994, p. 93: revisionists bandwagon to share the spoils; the term is
  Schweller's, not Walt's), accepted.

**Interaction with oaths.** `a` in 3.6a uses θ(c→p) as the value of an alliance. A coalition alliance against a hegemon
is therefore worth more and is betrayed less, and a bandwagon alliance (low θ of its c to x) is cheap to betray. That is
the intended Walt-plus-Axelrod coupling.

### 3.11 (rev 2) Richardson arms races (new `polity/arms.ts`; switch `arms`)

**Model.** Richardson (1960, *Arms and Insecurity*): dx/dt = k·y − a·x + g, dy/dt = l·x − b·y + h. Reaction is k and l,
fatigue a and b, grievance g and h. The equilibrium is stable iff a·b > k·l (symmetric: k² < a²). Unstable pairs
spiral to the cap (stability condition as in Richardson 1960; see FSU MAP5932 2016, eq. 5.3).
Empirical support is weak to mixed: Richardson's own fit used pre-WWI European defence budgets (1909–1913), and later
regression tests rarely find significant reaction coefficients, India–Pakistan being a partial exception (Britannica
n.d., "Arms race: Prisoner's dilemma models"). Treat it as a stylised mechanism. Arms here are **dyadic** (x is a's arms *against b*). Each pair is an independent 2×2 linear
system, so the per-pair stability condition is sufficient. A single pooled stock per polity coupled across all rivals
would need the spectral condition k·λ_max(W) < a instead, and is rejected for v1 (risk 17).

**Update** (`armsStep`, every slow step right after `relationStep` and `grievanceStep`; `substeps` Euler steps, dt = 5):
```
for r in relation order (pair a = relA, b = relB, both alive, relEdges non-empty or R ≥ ALIGN.preR; else x, y *= 1 − a·10, floored at 0):
  if relWar[r] >= 0: hold x, y (armies are in the field); continue
  g_a = gR·smoothstep(0.5,1.2,R) + gG·g(a,b) + gT·θ(b→a) − gTrade·v/(v+200)     // θ: 3.10, or 0.5·smoothstep(1,2,advantageAt(b,a)) without balance
  k_a = k·(rulers ? rulerWar(a) : 1);  a_a = a·(1 + fatigue·need_a)           // need: finNeed (finances) or min(1, pExh[a])
  repeat substeps: dx = k_a·y − a_a·x + g_a;  dy = k_b·x − a_b·y + g_b;  x = clamp(x + dt·dx, 0, max); y = clamp(y + dt·dy, 0, max)
  race: open if relRace < 0, min(x,y) ≥ raceOn, x > prevX and y > prevY  → new row, log ArmsRace(cap a, cap b, row, 0)
        close Eased if min(x,y) < raceOff → log ArmsRace(..., 2)
  append round(255·min(x,y)) to the open row's level; track the peak
```
- At `declare()` between a and b: if `relRace[r] >= 0`, close it as War, set `raWar`, and log ArmsRace(..., 1) right
  after WarDeclared. `Wars.race` = that row, or the latest row of the pair that closed ≤ precede years ago.
- At `closeWar`: x, y *= peace. When a polity ends or becomes the other's vassal, its open rows close as Ended.
- R-only equilibrium: x* = g/(a − k) = 0.006/0.025 = 0.24 < raceOn 0.3. **Rivalry alone does not make a race; it needs
  a grudge or a threat.** This is the fix for the section-2 finding that R ≥ 0.6 precedes ~90% of wars. With a
  saturated grudge (g = 0.5 → 0.004) and θ 0.5 (0.003), x* = 0.013/0.025 = 0.52. The ceiling is 0.02/0.025 = 0.8 < max.
  [A] Calibration, not data.

**Effects.**
- Power: `M_p = min(1, max_q x_pq + pool·(Σ_q x_pq − max_q x_pq))`, recomputed in armsStep and snapshotted to History.arms.
  In `campaigns`, A × (1 + proj·x_pq) and D × (1 + proj·x_qp) for the pair's war. In `declarations`,
  adv × (1 + proj·x_pq)/(1 + proj·x_qp), so arming deters as well as provokes. In `exposedFront` the value is unchanged;
  multiply after. `projAt` itself is not touched: arms are dyadic, so control and submission are unaffected.
- Cost: with finances (state-finances.md 2.4.2), `garrison = garrison·R°·(1 + costMul·M_p)` replaces
  `(1 + rivalArmy·min(1, maxR_p))` when arms is on. Without finances, use a proxy in the tax-system hook next to
  `tributeFlows` (`armsUpkeep`): `w = drain·M_p·WEALTH.decay·wealth[cap]`, `wealth[cap] −= w`. This is lost wealth, not
  transferred. It is per year.
- Feedback that keeps races bounded: fatigue rises with need (debt or exhaustion), and fatigue enters a_x, which only
  improves stability (a·b grows).

**Tests.** (1) The constants obey the stability inequalities (3.4). (2) Synthetic 2×2 runs: from any start, with constant
g, x and y converge monotonically to the closed form x* = (a_b g_a + k_a g_b)/(a_a a_b − k_a k_b) within 1e-6 after
200 substeps. (3) History: every ArmsRace extra 1 has a WarDeclared the same year between the pair; `Wars.race` rows
have start ≤ the war's start; `level` lengths match the duration in decades (+1). (4) No pair sits at x ≥ 0.95·max
for > 30 years (diag `armsCapYears`, expected 0).

---

## 4. Ordered commit-sized steps

Each step ends with `npm run typecheck`, `npm test` (or the targeted test files: `npx vitest run
src/sim/history/polity2.test.ts src/sim/history/history.test.ts`), and the attribution lines in the commit message.

0. **Harness.** Add `src/sim/history/polity/oathStats.ts`, or copy `/home/claude/scripts/baseline.ts`. It runs with
   node and takes seeds. It prints, per seed: betrayals (by extra), broken truces, attacks on allies, revenge wars
   (`Wars.cause >= 0`), revenge wars by grievance kind, grievances recorded, avenged and inherited, peak faithless, and
   the baseline columns from section 2. With oaths off it prints the baseline. Not shipped in tests.
   Files: new script only.
   (rev 2) Fold in `/home/claude/scripts/rev2-balance.ts`: top-realm share, coalition decades (also conditional on top
   share ≥ 0.30), alliances against the top or top-3 realm, bandwagon counts, mean δ at oath decisions, races (by end
   cause), the share of conquest wars with `Wars.race >= 0`, mean M_p of Kingdom+ realms, and armsCapYears.
1. **Contract, options and empty plumbing.** In contract.ts: `GrievanceKind`, `Grievances`, `History.grievances`,
   `History.faithless`, `Wars.cause`/`Wars.ally` (all -1), `BondEnd.Betrayed`, EventType 190/191 with comments, and
   `HistoryOptions.oaths`. Add `OATH` params. Add PolityState fields and `rngOath`, and push in
   `ensureRelation`/`declare`/grow. Emit in `polity/assemble.ts`, plus the empty versions. Add `oaths` in `index.ts`
   defaults. Update the history.test.ts event switch. Tests: shapes (count matches lengths, Int16 ranges), the `keep`
   constants match pow, and oaths off ⇒ empty. **Check: identical to main on all old fields with oaths on**, since
   nothing records yet.
2. **Grievance recording, no effects.** Add `polity/grievances.ts` (`recordGrievance`, `grievanceStep`: event scan,
   decay, avenge, prune), with hooks in conquer, capitalFalls and endBond(Freed). Call `grievanceStep` from `system.ts`
   in the slow-step block right after `relationStep`; document the order in the system.ts header. Tests in
   polity2.test.ts: rows are valid (wronged ≠ offender, both alive at the year, w0 > 0, kind in range, settlement and
   war valid, endYear ≥ year), and every Sacked event of a polity's town has a row. Add the **oaths-on ≡ oaths-off
   test** (600 years, seed 42).
3. **Faithless snapshots and the UI read-out early.** Snapshot `pFaith` (still 0). Add the politiesData helpers and the
   panel "Grudges" section, so the grievances are visible before effects exist. That helps tuning. The UI has no tests
   beyond typecheck; check the panel by hand in `npm run dev` if possible.
4. **Effects: rivalry, drive, revenge flag, avenging.** Update the relations.ts and war.ts headers with the formulas.
   Delete the step-2 identity test (note why in the commit). Tests: every `Wars.cause >= 0` has a row whose wronged is
   the attacker and offender the defender, recorded before the war's start; the stat harness shows revenge wars
   rising. Expect existing statistical tests to move; record them.
4a. **(rev 2) Shadow of the future.** Add `polity/shadow.ts` with `oathDelta`, `oathExcess` and `OathCase`, the new
   OATH params, and `R.remain`. No callers yet. Tests: the folk-theorem property test, δ monotonicity and bounds
   (3.6a), and the literal-constant checks. History is unchanged (the module is unused).
5. **Truces as oaths and reputation** (rev 2: decisions use `oathExcess`, not honour). Add relOath, truce breaking via rngOath, attacks on allies, `oathBroken`,
   witnesses, the reputation decay and the alliance/join threshold scaling. Tests: each OathBroken has a WarDeclared
   with the same value and year; extra 0 ⇒ the previous war between the pair ended < WAR.truce years before; extra 1
   ⇒ an alliance bond ending Betrayed that year; a TruceBroken/AllyBetrayed row exists; `faithless` > 0 at the next
   snapshot.
6. **Alliance betrayal** (rev 2: the Defect case of `oathExcess`). Fill `wAlly`, export `closeWar`, add `betrayalStep`, ceding and turning. Tests: each Betrayal
   ⇒ war `value` has attacker = betrayer's polity and endYear = the event year; the alliance bond between the betrayer
   and `other`'s polity ends Betrayed that year; extra 1 ⇒ a WarDeclared from the betrayer on the ally the same year;
   ceded towns ⇒ Joined events from e's members that year; `Wars.ally` points to an earlier war whose defender is the
   betrayed ally.
7. **Inheritance.** Successors, partition, civil war, reunified/absorbed. Tests: heir rows have `heir` pointing to a
   row of the parent, weight ≤ inherit × the parent's weight at that year (+ε), and the wronged's parent chain
   contains the original's wronged.
8. **Prose.** polityFormat, historyIndex, chronicleFilter, sagas (state, year, epithets), panel past-bond wording, and
   optionally Avenged. Tests: if `src/ui` has tests (grep `src/ui/**/*.test.ts`), add a line test similar to the
   existing ones; otherwise check a saga render from a script for seeds with betrayals.
9. **Tuning, README and stats.** Run the harness on seeds 1, 7, 42 and 1234 and tune toward section 5. Update the
   README bullet and polityStats. Then `npm run build`, the `git format-patch 8cabf09..grudges-and-oaths -o
   /home/claude/worldseed-patches/` (if the `main` ref is missing in the shallow clone, use the sha), and `git bundle
   create /home/claude/grudges-and-oaths.bundle 8cabf09..grudges-and-oaths`.
   (rev 2) Do steps 10–14 before the format-patch and bundle; step 9 then covers only the oaths tuning.

10. **(rev 2) Balance: plumbing.** Add `HistoryOptions.balance`, `rngAlign`, the relThr*/relTradeV/pAggr arrays,
    `ALIGN`, `threatOf`, and EventType 193 in contract.ts, politiesData and the history.test.ts switch. Rename the old
    body to `allianceStepLegacy`. Test: balance off ⇒ bit-identical to the previous commit on every History field
    (vitest, 600 years, seed 42).
11. **(rev 2) Balance: rules.** `allianceStepBalance`, the coalition cap, the θ lapse rule, the join threshold and
    `bandwagonStep`. Tests: every Bandwagon event is followed the same year by Alliance (extra 0) or by BecameVassal with
    value ≥ 1000 (extra 1), with `other` = the stronger polity; with balance on, every alliance's threat c had θ ≥
    thetaMin with both allies at formation (record θ in diag; assert in a test-only probe); no polity holds more than
    maxAlliances. Run the harness and compare with the rev-2 table in section 2.
12. **(rev 2) Arms: core.** Add `HistoryOptions.arms`, `ARMS`, the arms.ts update, races, `Wars.race`, History.arms and
    armsRaces (with empty versions), EventType 194, the campaign and declaration multipliers, closeWar demobilisation,
    and the cost hook (finances' garrison term if `s.fin`, else `armsUpkeep`). Tests: the 3.11 list, and arms off ⇒
    bit-identical to the previous commit.
13. **(rev 2) Arms and balance: UI.** The polityFormat, historyIndex and sagas lines of 3.9 (rev 2), the Factions-view
    arms border (`pl_arms`) with its legend toggle, `armsRacesAt`, and the panel lines. Check by hand in `npm run dev`
    on a seed with races.
14. **(rev 2) Tuning.** Tune toward the rev-2 targets in section 5, in this order: δ (breakMul, breakSpan, delta0), then
    balance (thetaMin, coalition, band), then arms (gG, gT, raceOn). Each later system shifts the earlier ones' counts, so
    re-run the full harness after each. Update README and polityStats.

Note: `npm install` modified `package-lock.json` on the clean tree. Revert it (`git checkout package-lock.json`) before
committing, unless the change is intended.

---

## 5. Tuning plan

Targets per 2000-year run, on each of seeds 1, 7, 42 and 1234:

| measure | baseline [M] | target |
|---|---|---|
| Betrayal events (defection), extra 0+1 | 0 (does not exist) | 2–6 |
| Attacks on an ally (OathBroken extra 1) | 0–4 (silent Lapsed today) | 0–3 |
| Broken truces (OathBroken extra 0) | 0 (impossible) | 3–10 |
| Revenge wars (`Wars.cause >= 0`) | 1–6 "revenge-like" by heuristic | 10–25% of conquest wars (≈ 10–25) |
| Total conquest wars | 80–105 | within ±20% of baseline (no war explosion) |
| Alliances formed | 36–54 | may drop ≤ 25% (reputation) |
| Open grievances at year 2000 | n/a | tens, not hundreds; median row life 40–90 years |

Knobs, in order of leverage:
- `defect` and the `case` weights control betrayals. There are only 13–25 joined wars per run, so per-joined-war
  defection must be about 20–35%.
- `breakMul` controls broken truces.
- `drive`, `revengeMin` and `rivalry` control revenge share and war count. If total wars climb more than 20%, lower
  `rivalry` first: it feeds every declaration, whereas drive only acts on pairs with a grudge.
- `halfLife` sets how long feuds persist.

Sensitivity check: also run seeds 2, 3 and 99, to make sure no seed has more than 15 betrayals.

**(rev 2) Targets** (seeds 1, 7, 42, 1234; baselines from section 2 rev 2):

| measure | baseline [M] | target |
|---|---|---|
| Mean δ at OathBroken/Betrayal vs. over all oath checks | n/a | lower by ≥ 0.05; ≥ 40% of breaks by rulers aged ≥ 55, without an adult heir, or in crisis |
| Rev-1 oath targets (broken truces 3–10, betrayals 2–6) | — | still met after δ replaces honour |
| Decades with a coalition vs. the top realm, when top share ≥ 0.30 | to measure (unconditional 42–86%) | ≥ 65% on every seed |
| Alliances formed against a top-3 realm | 64–86% (23–43 of 36–54) | ≥ 75% |
| Top-realm share p90 | .32 / .47 / .44 / .61 | −5% to −20% relative on 7, 42, 1234; seed 1 within ±10%; mean ≥ 0.18 everywhere (no levelling) |
| Alliances formed | 36–54 | −20% to +40% |
| Bandwagon events (193) | 0 | 2–10 per run, none on seeds where the top share stays < 0.25 |
| Conquest wars with `Wars.race >= 0` | n/a (R ≥ 0.6 for 20 y precedes 86–95%) | 30–55% |
| Races ending Eased (not War) | n/a | ≥ 40% of closed races (deterrence, no spiral) |
| Race length median | n/a | 20–60 years |
| `armsCapYears` (x ≥ 0.95·max for > 30 y) | n/a | 0 |
| Mean M_p of Kingdom+ realms at peace | n/a | 0.1–0.35 |
| Total conquest wars, all rev-2 on | 80–105 | within ±20% of the rev-1 tuned value |

Knobs: `gG`/`gT` against `raceOn` set the precursor share (raise raceOn if races precede > 55%). `ARMS.proj` controls
whether arms deter more than they provoke: if total wars rise > 20%, lower `proj` before `k`. `thetaMin` and
`coalition` set coalition frequency; `band` and `bandTheta` set bandwagons.

---

## 6. Risks and open questions

1. **Pre-existing test failures**: the 2 history.test.ts failures seen under load. Confirm them on an idle machine
   before attributing anything.
2. **Bit-identity with oaths off.** Every hook must be guarded. Watch for these in particular:
   - the push of `wCause`/`wAlly` (harmless; ps-only);
   - the reputation threshold changes (`f = 0` when off);
   - the event scan cursor (ps-only);
   - History field additions (new fields only). `Wars` gains arrays, so the Wars object differs; compare only the old
     fields.
3. **Draw coupling.** Truce breaking adds wars that consume `rngWar` in `declare()` (buffer and join draws). After the
   first oath event this inevitably reorders later war draws. That is accepted and documented.
4. **Ceding towns by `setPolity`** bypasses the submission test. Check that `controlOne`/the control pass handle a
   member placed at FAR or with a computed dist. `absorbVassal` uses `setPolity(id, b, d + dist)`; mirror it with
   `distAcross`. **[A]**
5. **`closeWar` export**: it is module-private today. Exporting it is fine. It runs `peaceTerms`; for a separate peace,
   pass an outcome that skips peaceTerms (AttackerGains or WhitePeace both still call peaceTerms for Conquest-kind
   wars; check lines 131-134). Possibly add a `terms = true` parameter.
6. **"Ally at war alongside you"** only covers protectors who joined a defensive war. Alliances never join offensive
   wars, so "an ally switching sides in your offensive" cannot happen without first adding offensive co-belligerence.
   Out of scope for v1; noted.
7. **Overlords as protectors**: `protectorsOf` includes the overlord. An overlord defecting from its vassal's war is a
   betrayal of a Vassal bond, not an alliance. v1: only alliance bonds can be betrayed. Skip when the protector is
   the overlord: check `bKind` of the linking bond.
8. **Holy-city wronged party**: proposed as the polity that lost the city. An alternative is every polity whose state
   faith is that faith, which is more dramatic but adds more rows. Decide in step 2.
9. **Event volume**: TownConquered rows are about 1000 conquests per run, merged per war to roughly 100–250 rows.
   Sack rows are 150–250. Total rows are likely 400–800 per run, which is fine. Prune by `forget`.
10. **Int16 in History**: polity ids and years fit; settlement ids need Int32 (as in the draft).
11. **UI cost**: `standingGrudges` runs per panel open and is O(rows of p). Fine.
12. **Saga tests**: check `src/ui` and sagas for tests that pin exact text or epithets (`grep -rn "the Victorious\|the
    Conqueror" src --include=*.test.ts`). The new epithet ordering could change pinned outputs.
13. **Orders**: should a player be able to order a treacherous war? v1 says no (still `OrderReason.Truce`).
14. **The recentWar rivalry term** partially overlaps grievances. Keep it for bit-identity with oaths off. Optionally,
    halve it when oaths are on, as a tuning knob only.

15. **(rev 2) Folk theorem as propensity.** The δ rule assumes grim trigger and payoffs known to the ruler. It is a
    stylised calculus, not a solved game. The payoff scale (realm shares per period) is assumed; the T, R, P weights
    are the main tuning risk. If breaks come almost only from `gain`, raise `hostile` or `repCost`.
16. **(rev 2) Balance changes ps.rng draws.** With balance on, `'history-polities'` shifts (3.8). Acceptable, but any test
    that pins raid counts with defaults will move. List them in the step-11 commit.
17. **(rev 2) Dyadic arms.** A realm with three rivals arms against each separately, and pool 0.3 caps the burden.
    That understates the burden on encircled realms. A pooled stock is the alternative, but then stability needs
    k·λ_max(W) < a over the rivalry graph, which is checkable only at runtime. Deferred.
18. **(rev 2) θ cost.** `advantageAt` → `distAcross` loops over relEdges and calls `distTo`. [A] Its cost is not
    measured. The preR filter limits it to relations with rivalry. If a slow step grows > 5%, cache θ every other slow
    step.
19. **(rev 2) Arms × finances double count.** With finances, `rivalArmy` must be dropped (replaced) when arms is on.
    Otherwise rivalry is charged twice. Without arms, finances keeps rivalArmy.
20. **(rev 2) Hegemon by pMass vs pPop.** The sim uses pMass (military reach) and the harness uses pPop (comparable with
    the baseline). Report both in step 0.
21. **(rev 2) Richardson evidence is weak to mixed** (Britannica n.d.), and Walt's bandwagoning claims are contested (Schweller 1994). Both are
    used as mechanisms that produce plausible histories, not as validated laws.

## 7. Verified vs assumed: summary
- **Verified in code:** everything in section 1, the RNG stream names and the no-pow rule, where truces are set, that
  join happens only in defensive wars, that declarations ignore `allied`, the event id gaps (190–199 free), the UI file
  roles and line locations, the off-switch test convention, and that the README bullet location is current.
- **Measured:** section 2, and the clean-tree test failures (under load).
- **(rev 2) Verified:** ruler, heir, law and survival fields; the allianceStep filters and draw site; that the declaration draw is gated by drive (and so by adv); the danger and projection functions; the finances garrison term; the Factions embargo-border mechanism.
- **(rev 2) Measured:** the hegemony, coalition, rivalry-before-war and ruler-horizon table (section 2 rev 2); s10 and e(a) computed from RULERS hazards.
- **(rev 2) Assumed:** all OATH δ/payoff, ALIGN and ARMS params; the λ-by-law ordering; dyadic arms; the θ functional form; the targets.
- **Assumed or proposed:** all params; the honour formula (superseded in rev 2 by δ); a per-polity reputation;
  the HolyCityFell lag; the ceding mechanics; the inheritance rules; the prose wording; the placement of `betrayalStep`.

## Interfaces (rev 2)
- **state-finances.md**: arms reads `finNeed(s,p)` as fatigue input and replaces finances' `rivalArmy` garrison factor
  with `(1 + ARMS.costMul·M_p)` when `s.pol.arms`. Finances exposes nothing new, but its garrison line must branch on
  `ps.arms` (to be stated in its step that builds the garrison). `OATH.warCost × (1 + finNeed)` reads the same hook.
  Proxies without finances: need = min(1, pExh); cost = `armsUpkeep` wealth drain.
- **rulers**: read-only use of `cur, rBorn, rDeath, hN/hBorn/hDeath/hLegit, law, surv` plus a new `R.remain`
  (UI/prose). No new draws on `'history-rulers'`.
- **city-states.md**: a FreeCity with a charter bond is "bound" for bandwagon purposes (skip it). City leagues
  (`PolityOrigin.League`) can be balancers if Kingdom tier. No change to their ids.
- **EventType block 190–199 now**: 190 Betrayal, 191 OathBroken, 192 Avenged (optional), 193 Bandwagon, 194 ArmsRace,
  195–199 spare.
- New streams: `'history-oaths'` (unchanged draw sites in rev 2) and `'history-align'` (balance). Arms is RNG-free.
- **Perf/memory (rev 2) [A]**: per relation +7 numbers (θ×2, x, y, prev×2, race) and per polity +2 Float64 (pAggr, pArms).
  With relations in the low thousands, that is < 100 KB. History.arms is 1 byte per polity per snapshot, the size of
  `tariff`. ArmsRaces: tens to ~200 rows, each with a decade curve, a few KB. CPU: armsStep O(relations) per slow
  step, which is negligible. δ is O(H) per oath check, and those are rare. θ is the only real cost (risk 18). Expected
  total < 3% of history time; measure in step 14 with the perf harness.

## Addendum (cross-plan interface, from state-finances.md §0)
Add `GrievanceKind.CrownDefault = 7`: when a crown defaults on a loan whose lender's seat lies in another polity, finances calls this plan's `record(...)` with wronged = the lender seat's polity, offender = the defaulting polity. Reserve the id now even if finances lands later. EventType blocks across plans: families 161–169, grudges 190–199, city-states 200–205, finances 210–219.

## References
Citation audit 2026-11-26. [verified] = a publisher, DOI, RePEc, library-catalogue or scholarly page confirming the
item (and, where stated, the attributed claim) was opened; [unverified] = not confirmed, with the reason. Every
numeric parameter in this plan (halfLife, delta0, repCost, θ thresholds, ARMS k/a/fatigue, half-life 50, ...) is a
**design default**, not a sourced fact.

- Axelrod, R. (1984). *The Evolution of Cooperation*. New York: Basic Books. https://en.wikipedia.org/wiki/The_Evolution_of_Cooperation
  [verified: publisher/year; the continuation probability w is called "the shadow of the future". The chapter
  number previously given (ch. 1) is not confirmed.]
- Friedman, J. W. (1971). A Non-cooperative Equilibrium for Supergames. *Review of Economic Studies* 38(1): 1–12.
  https://doi.org/10.2307/2296617 [verified: Crossref metadata]
- Kariv, S. (n.d.; author inferred from the URL). Economics 110 lecture 10: repeated games (UC Berkeley). https://eml.berkeley.edu/~kariv/110_lecture_10.pdf
  [verified: grim trigger sustains cooperation iff (1−δ)T + δP ≤ R, i.e. δ ≥ (T−R)/(T−P); with T=3, R=2, P=1 the lecture
  gets δ ≥ 1/2. The rearrangement T−R > δ/(1−δ)·(R−P) used in 3.6a is algebraically equivalent.]
- Walt, S. M. (1987). *The Origins of Alliances*. Ithaca, NY: Cornell University Press. https://doi.org/10.7591/9780801469992
  [verified: publisher/DOI (De Gruyter page), 1987 and the four sources of threat (https://en.wikipedia.org/wiki/Balance_of_threat).
  The "ch. 2" pointer for bandwagoning is unverified.]
- Schweller, R. L. (1994). Bandwagoning for Profit: Bringing the Revisionist State Back In. *International Security*
  19(1): 72–107. https://doi.org/10.2307/2539149 [verified: Crossref metadata and article text; "jackal bandwagoning"
  is defined on p. 93 and is Schweller's own term]
- Richardson, L. F. (1960). *Arms and Insecurity: A Mathematical Study of the Causes and Origins of War*. Pittsburgh:
  Boxwood Press (also Chicago: Quadrangle). https://openlibrary.org/works/OL4123221W [verified: title, Boxwood 1960.
  The Quadrangle co-edition is unverified.]
- FSU MAP5932 (2016). Lecture 5: Richardson's armaments race model. Florida State University course notes (author
  not stated on the fetched page).
  https://www.math.fsu.edu/~mesterto/NewCourses/MAP5932/2016/Notes/lecture05.pdf [verified: dx/dt = ky − αx + g,
  dy/dt = lx − βy + h; stable iff αβ > kl; Richardson's 1909–1913 fit]
- Encyclopaedia Britannica (n.d.). Arms race: Prisoner's dilemma models. https://www.britannica.com/topic/arms-race/Prisoners-dilemma-models
  [verified: the Richardson approach "has a rather poor empirical record"; India–Pakistan partial support]

