# Plan: Character mode, "Play a person" (a life inside the sim: merchant, explorer, general, prophet, spy, courtier)

Plan only. The code is the read-only checkout `/home/claude/ryanmye/worldseed` @ 8cabf09. Probes ran on the scratch copy
`/home/claude/scratch-character` (`probes/scale.ts`, run with `node --experimental-strip-types`).
Tags: **[V]** verified in code, **[M]** measured (a 2-core box shared with many agents: times are loaded upper bounds),
**[A]** assumed or a design default to tune.

**This is seat mode's person-scale sibling, not a fork.** seat-mode.md owns the loop (watcher → decision cards → orders),
live `appendOrders` (append at Y−1 ≡ from-scratch [M there]), `HistoryRun.addOrders`, `playSeat`, the seat ring of
checkpoints on perf-efficiency P6, the decision table `SeatDecisions`, the card UI and the `Choice` idea. Character mode
adds **one seat kind** (`SeatKind.Person`), a small **person record**, person **order kinds 41–58**, person **decision
kinds 27–44**, a **lite pause** (no full History per pause), and the person-scale UI. Everything else is called by
seat-mode's names.

Ids (Interfaces, section 10, lists every enum value): **EventType 360–369**, **OrderKind 41–58**, **DecisionKind 27–44**,
SeatKind 4, AmbitionKind 6–15, OrderRole 8, OrderReason 29–34, LenderKind 3, FamilyCause 3. RNG stream
`'history-person'`.

Depends on: **seat-mode phases A–B** (live append, Choice, watcher, worker `seat*` requests, card UI) for everything;
seat-mode phase C (P6 checkpoints) only for take-back. MVP roles: **goods** (in repo) for Merchant, **exploration** (in
repo) for Explorer. Later roles: battles (General), religion (in repo, Prophet), beliefs + goods/secrets (Spy),
court-politics (Courtier). Optional: merchant-families, state-finances, grudges. Every dependency has a proxy or the role
(or the card) is simply absent (section 10).

---

## 0. Summary

The player picks a role and a birth taken from the sim's own records (a merchant family's younger son, a ship's master
in a port, an officer of a realm, a royal cadet from the heirs pool, a seeker in a holy town, a spymaster's client). The
seat is `SeatKind.Person`. Each year the worker steps the live runner and the person system (`person/system.ts
personYear`) ages the person, settles ventures and missions, and records life events. A pure watcher (`person/watch.ts`,
called from seat-mode's `seatWatch`) emits **opportunity cards** (DecisionKind 27–44). The run pauses at a card; the
worker posts a small **PersonView** (≈ 20–80 KB [A]) instead of the 35–39 MB History, which it assembles only every
`PERSON.fullEvery` (25) years or on demand. Each option is a list of **person orders** (OrderKind 41–58, actor = person id)
for year D+1, plus the record-only `PChoice` (41). Orders go into the live runner through seat-mode's `addOrders`, so a
URL `seat=person:…&o=…` replays the life bit-identically.

A person moves the world **only through orders**, and every order is a **lever** `1 + Lmax·I` on an existing threshold
(or a bounded transfer), with influence `I ∈ [0, roleCap]` from role and standing. The largest lever a person can pull is
×2 (a famous general's coup bar), against seat mode's ×4 or chance 1 for a king. Person draws come only from
`'history-person'`; where an order acts inside another system, that system's own draw is kept and only its threshold
moves (the seat-mode rule). Death is a pre-drawn year (rulers' survival table) plus the sim's own hazards (slain in
battle by battles' draw, lost at sea by the voyage roll, plague at home, executed). At death the player continues as an
**heir, apprentice or disciple** chosen during life; the line's lives form a dynasty with a lineage score. At each death
the person's saga is told in both registers.

---

## 1. Current behaviour (verified)

### 1.1 What seat mode gives (plan, not yet code) and what the code has [V]
- Orders today: `contract.ts` l.1891 `OrderKind` 0–9, `ORDER_KIND_COUNT = 10` (l.1904), `OrderRole` (l.1915: None 0 …
  Faith 7), `OrderReason` 0–25, `ORDER_KINDS` rows (l.~2000: key, label, roles, years, effect),
  `encodeOrders/decodeOrders`. `orders/system.ts ordersBegin/ordersEnd` (activation and event matching from `evSeen`),
  hooks in `orders/hooks.ts`, always called as `s.orders !== null && …`.
- `index.ts step()` l.525–571 [V]: `ordersBegin` first; … `explorationSystem` (l.552) … `goodsYear` (l.559) …
  `religionYear` (l.562) … `landmarksYear` (l.565); `ordersEnd` (l.566); then snapshots. Seat mode adds `seatYear` and
  `seatWatch` after `ordersEnd`. **This plan adds `personYear` just before `ordersEnd`** (so person events are matched
  the same year) and `personExpeditions` right after `explorationSystem`.
- seat-mode.md 3.2–3.8 (live append, `SeatOptions`, `SeatDecisions`, cadence, `playSeat`, cards, reign summary, saga
  facts) and 5 (worker requests `seat`, `seatChoose`, `seatBack`, `seatStop`; response `seatPause`). Reused as is.

### 1.2 Records a person can be drawn from (NPCs come from these; no new populations) [V unless noted]
| record | where | what a person needs from it |
|---|---|---|
| rulers, heirs pool | `rulers/state.ts` `R.cur, rBorn, rAbility, rWar, rPiety, rTol, rDyn`; heirs `hN/hBorn/hDeath/hLegit/hFemale/hParent [p·H+k]` | patrons (the ruler served), royal cadets as courtier births, spouses from a house. `hDeath`, `rDeath` are pre-drawn futures: **never read** by the watcher |
| survival table | `rulers/state.ts survival()` (private, Gompertz hazard from age 20, `RULERS.gompertz/gompertzRate`), `deathYear(R, born, year, u)` exported | the person's own death year (one draw from `'history-person'`) |
| merchant pools | `goods/merchants.ts` `mw[town]`, `merchantPay`; History.merchantWealth | merchant capital (shares of pools, as merchant-families does) |
| prices | `trade.ts` `ts.price[id·G + c]` (l.166), forward prices `g.fwd`, `g.fwdBid` reckoned every other year (`longhaul.ts forwardPrices` l.228) for `LEG_GOODS = [7..11]` | buy and sell prices of a venture |
| legs and lanes | `goods/state.ts` `legA/legB/legKind/legOpen/legCap/legUse/legHazard/legSailed/legPath/lanes`; FleetLost (64) is one `g.rng` draw `< h·X.fleetLost` (`longhaul.ts` l.725–729) | the venture's route, its hazard, the lane's own losses |
| expeditions | `exploration.ts expedition(s, es, id, f)` l.478: Dijkstra over `es.stepSea/stepLand` toward the cell with the most unknown, loss `rng.next() < 1 − 1/(1 + h)`, base (outpost) with `O.chance`, `learnPath`, `discoveries`; draws from `'history-expeditions'` (`es.rng`) only | the explorer's expedition, run with the person stream |
| knowledge | `s.know.known[p·N + c]` (Int16 year or −1), `s.know.contact`; History.knownYear/contactYear; N = 23 042 cells [M] | the fog: a people's known world |
| faiths | `religion/state.ts` per faith `kind, people, foundAt, holy, zeal, org, appeal, followers`; `system.ts newFaith` l.43 (private), `foundStep` l.655 (one `rel.rng` draw for the chance, one for the town, then `zeal = 0.2 + 0.8u, org = u, appeal = u`), `addShare`, `expose` l.288; spread every `RELIGION.step` 10 y; `rel.state[p]`, `persUntil[p]` | tenets = (zeal, org, appeal); preaching = exposure |
| secrets | `goods/secrets.ts leaks` l.263: per (secret, people) the channel rates `r[LeakChannel.*]`, **one** `g.rng` draw against `1 − Π(1 − r)` | stealing a secret = a threshold lever on `r[Espionage]` |
| expected (plans) | battles `Commanders` (skill, fame, pVeteran, coup/rising hooks), court `holders` (offices, factions, plots), families (heads, seats, marriages), beliefs (`est`, `varL`, `spy`, `counter`) | general, courtier, merchant house, spy |

### 1.3 Gaps [V]
- No person-scale entity at all; Settlement, Polity, Ruler and (planned) Family, Commander, Holder are the agents.
- `expedition()` reads `es.rng` directly and pays from `s.wealth[id]`; it cannot be run for a player without a small
  refactor (3.6.2).
- `newFaith` is private; a faith can only be founded by `foundStep`'s chance draw.
- Names exist for settlements, features, rulers, houses (`names/*`), not for persons.

---

## 2. Measurements [M] (`probes/scale.ts`, 2000 years, default options; ~205–220 s per run on the loaded box)

| seed | P | settlements (living) | marts | legs (open lanes) | faiths | rulers / houses | ExpeditionSent / Returned | VoyageLost | FleetLost | FaithFounded | WarDeclared | CivilWar |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 6 | 1284 (1085) | 75 | 1009 (7) | 15 | 1132 / 183 | 63 / 49 | 25 | 2 | 5 | 105 | 14 |
| 7 | 10 | 1143 (941) | 114 | 1378 (23) | 16 | 1099 / 146 | 122 / 99 | 46 | 21 | 4 | 96 | 15 |
| 42 | 10 | 1182 (893) | 87 | 1323 (12) | 15 | 1099 / 175 | 67 / 50 | 25 | 8 | 3 | 99 | 17 |
| 1234 | 10 | 1462 (1050) | 131 | 1531 (29) | 16 | 1209 / 175 | 136 / 96 | 61 | 30 | 3 | 80 | 10 |

- **Price gaps** between the two ends of open legs at the last trade snapshot (History.priceIndex, five HV classes):
  ratio p10 1.04, p50 1.68–2.09, p90 7.0–11.8 (n 715–1280). So the sim offers real arbitrage, but most legs are
  near-equal and a few are huge. Merchant cards must pick from the known high-gap legs (3.6.1).
- **Expeditions are rare**: 63–136 in 2000 years worldwide (3–7 a century), ~22–29 % never come home
  (1 − Returned/Sent; a land loss logs nothing). A player explorer adds ~1 expedition per 5–10 years of life, which is
  comparable to the whole world's rate: the effect is large on the map but each expedition is an ordinary one (3.4).
- **Fleet losses are rare**: 2–30 FleetLost in 2000 years. The venture risk must come from `legHazard` directly (3.6.1),
  not from waiting for FleetLost events.
- Fog bytes: `knownYear` 0.28–0.46 MB in History; one person's own known bitset is N/8 = **2.9 KB**.

---

## 3. Design

### 3.1 Reuse of seat mode (the loop with two changes)
```
pick role + birth (a record) at year Y0  →  HistoryOptions.seat = {kind: Person, id: -1, from: Y0, person: PersonStart}
loop (seat-mode 3.1, unchanged except ★):
  worker: step years; after each: personYear (before ordersEnd), seatYear, seatWatch → personWatch rows
  ★ stop at the first year with a person card, at maxRun = PERSON.maxRun (10) years, or at the person's death
  ★ post PersonView (+ the full History only every PERSON.fullEvery years, at death, or when asked)
  player picks; orders of year D+1 (PChoice record + person kinds) → addOrders; continue
  at death: Succession card (heir / apprentice / disciple) → PersonEntered for the successor, or SeatLost (line ended)
```
- The person id is assigned by `personYear` at `from` (rows are created in a fixed order, 3.2), so it is known before
  any order needs it. The first person is id 0; successors and family members follow in creation order.
- When a person **becomes a ruler** (a general's coup, a royal cadet accedes), the card offers "Rule as your house":
  a new `SeatOptions {kind: House, id: dynasty, from: year+1}` continues in seat mode (a new HistoryOptions.seat: a new
  run whose prefix is identical, restored from the latest pause checkpoint when one exists). Ruling is seat mode's game.

### 3.2 The person record (light, deterministic) — `src/sim/history/person/state.ts`
Rows are created only for: the player's line (each successive player character), their spouses and children, and
apprentices or disciples taken on. ≤ ~10 rows per life, ≤ ~200 per session [A]. Everyone else is an existing record,
referenced by `(RefKind, id)`.
```ts
export interface PersonState {
  rng: Rng                          // createRng(seed, 'history-person')
  // --- persons (JS arrays, append-only; id = index) ---
  born: number[]; died: number[]; death: number[]   // death: pre-drawn year (deathYear(R or own table, born, year, u)); NEVER read by the watcher
  end: number[]; how: number[]; female: number[]; parent: number[]; line: number[]  // PersonEnd, PersonHow, parent person (-1), generation of the player line (-1 not a player)
  people: number[]; home: number[]; faith: number[]; role: number[]                 // home: settlement; faith: History.faiths (-1)
  /** Skills 0..1, 6 per person (PersonSkill order): trade, command, piety (charisma), navigation, intrigue, administration. */
  skill: Float64Array               // grown by doubling
  /** Merchant capital: shares of town pools, as merchant-families' seats (own overlay when families are off). */
  seatTown: number[]; seatSig: number[]; seatPerson: number[]; family: number[]     // family: History.families id (-1)
  rep: number[]; repPeak: number[]  // reputation 0..∞ (renown), decays REP.decay a year
  patronKind: number[]; patron: number[]; rivalKind: number[]; rival: number[]     // RefKind + id
  spouse: number[]; heir: number[]; commander: number[]; holder: number[]          // persons; History.commanders / court.holders rows (-1)
  known: Uint8Array                 // own known cells of the CURRENT player (bitset N/8 = 2.9 KB), cleared at succession, OR-ed with the people's
  news: Float64Array; newsYear: Int32Array   // per mart (grown): last price seen per LEG_GOODS class (5 per mart) and when (fog of prices, 3.9)
  // --- in-flight actions ---
  vPerson: number[]; vLeg: number[]; vDir: number[]; vClass: number[]; vOut: number[]; vQty: number[]; vDue: number[]; vEnd: number[]  // ventures
  mPerson: number[]; mKind: number[]; mTarget: number[]; mFrom: number[]; mDue: number[]; mEnd: number[]                              // missions
  cur: number                       // the current player person (-1 after the line ends)
  evSeen: number
  events: HistoryEvent[]            // (woven in at assembly like landmarks')
  diag: PersonDiag
}
```
Contract (drafted, codebase style):
```ts
// person: character mode, a life inside the sim (HistoryOptions.seat with SeatKind.Person; all empty otherwise).

/** The calling a person follows (History.persons.role, and the role a card or order acts in). */
export const PersonRole = { Merchant: 0, Explorer: 1, General: 2, Prophet: 3, Spy: 4, Courtier: 5, None: 6 } as const
/** How a person entered the story (History.persons.how). */
export const PersonHow = {
  Start: 0,      // the player's first character, born from a record (PersonStart.birth)
  Heir: 1,       // a child of the last player character who took up the life
  Apprentice: 2, // a factor, mate or officer the last player character trained
  Disciple: 3,   // a prophet's follower who carried the faith on
  Spouse: 4, Child: 5, // family rows that were never played
} as const
/** How a life ended (History.persons.end). */
export const PersonEnd = { Living: 0, Age: 1, Plague: 2, Battle: 3, Sea: 4, Executed: 5, Martyred: 6, Murdered: 7, Lost: 8 } as const
/** Which record a relationship points to (patron, rival). */
export const RefKind = { None: 0, Ruler: 1, Holder: 2, FamilyHead: 3, Commander: 4, Person: 5, Polity: 6 } as const
export const PersonSkill = { Trade: 0, Command: 1, Piety: 2, Navigation: 3, Intrigue: 4, Administration: 5 } as const

/** Where a played life begins: the role and the record it is born from (the UI lists only valid ones at `from`). */
export interface PersonStart {
  role: PersonRole
  /** BirthKind (3.3) and the record's id: a family (its younger son or daughter), a settlement (a new man there), a polity (an officer of it), a ruling house's heir by birth year (heirs pool), a court holder. */
  birth: number
  of: number
  /** Year of birth (age at `from` 16..40); female 0/1 (the UI's choice where the record allows). */
  born: number
  female: number
}

/** person: everyone character mode recorded, struct-of-arrays in order of appearance (the player's line, spouses, children, apprentices). */
export interface Persons {
  count: number
  /** "Taro Veckin", "Ivo of Kubeta": personal name in the language of the people at birth, plus the house or the home (assembly, 'names-person-<id>'). */
  name: string[]
  born: Int16Array
  /** -1 while alive at the end. */
  died: Int16Array
  end: Uint8Array // PersonEnd
  how: Uint8Array // PersonHow
  female: Uint8Array
  parent: Int32Array
  /** Generation in the player's line (0 first), -1 never played; the years played: from playedFrom to playedTo. */
  line: Int16Array
  playedFrom: Int16Array
  playedTo: Int16Array
  people: Int16Array
  /** Home settlement at birth and at death (moves are PersonRose events with extra Move). */
  homeFirst: Int32Array
  homeLast: Int32Array
  faith: Int16Array
  role: Uint8Array // PersonRole at death (role changes are PersonRose events)
  /** Skills at death, 6 per person (PersonSkill order), 0..255 for 0..1. */
  skill: Uint8Array
  /** Peak capital (wealth units) and peak renown, with years. */
  wealthPeak: Float32Array
  repPeak: Float32Array
  /** Relationships at death (or the last held): RefKind and id of the patron and the rival; persons of the spouse and heir (-1). */
  patronKind: Uint8Array; patron: Int32Array; rivalKind: Uint8Array; rival: Int32Array; spouse: Int32Array; heir: Int32Array
  /** History.families, History.commanders, History.court.holders rows the person was (-1). */
  family: Int32Array; commander: Int32Array; holder: Int32Array
  /** End-of-life score (3.12), 0 for unplayed rows. */
  score: Float32Array
}
/** person: ventures and missions (one row each, in order of setting out). */
export interface PersonActs {
  count: number
  person: Int32Array
  /** ActKind: 0 venture, 1 loan, 2 expedition, 3 mission, 4 preaching tour, 5 battle stance (with its battle). */
  kind: Uint8Array
  year: Int16Array
  /** Venture: History.longHaul record; loan: polity; expedition: the cell aimed at; mission: MissionKind*256 + subject; preaching: town; stance: History.battles row. */
  subject: Int32Array
  /** Wealth put in (venture, loan, expedition cost), and the result (gain, -1 lost, repaid share). */
  stake: Float32Array
  result: Float32Array
  /** ActEnd: 0 open, 1 done, 2 lost at sea, 3 caught, 4 defaulted, 5 failed. */
  end: Uint8Array
}
```
`History.persons?: Persons`, `History.personActs?: PersonActs` (absent without a Person seat). `SeatOptions.person?:
PersonStart` (amendment to seat-mode: only read when `kind === SeatKind.Person`). `encodeSeat` form:
`seat=person:<role>:<birthKind>.<of>:<born>[f]:<from>[:amb=6.8]`, e.g. `seat=person:0:1.12:1162:1180`.

### 3.3 Births from records, NPCs, relationships
`BirthKind` (contract): `Family 0` (a younger son/daughter of family f's head: surname, home, capital share 0, the family
backs him), `NewMan 1` (at settlement t: a mart for a merchant, a port for an explorer, any town for a prophet), `Officer
2` (of polity p: a general's start, battles on), `RoyalKin 3` (heir of polity p with `hBorn = born`: a courtier who may
accede; seat mode takes over if so), `Client 4` (of court holder h: a spy under a spymaster, or a courtier under a
chancellor). The start sheet lists only records alive at `from` (pure reads of the History shown).

| relationship | source record (no new population) | rule |
|---|---|---|
| patron | Merchant: the head of his family or of the richest family at home (families), else the ruler of home's polity · Explorer: the ruler whose port he sails from · General: the ruler served (`R.cur[p]`) · Prophet: none, or a converted ruler · Spy: the Spymaster holder (court) or the ruler · Courtier: the faction leader or the Chancellor | recomputed when it ends (death, fall, house change): PersonRose extra Patron |
| rival | Merchant: the richest other family at home · General: the most famous other serving commander of p · Courtier: the leader of the strongest opposing faction · Prophet: the state faith's ChiefPriest (court) or the holy city's ruler · Spy: the target's spymaster · Explorer: none | pure read each slow step |
| spouse | a daughter/son of a family head (families' `mg*` pattern), of a ruling house's heirs pool (`hFemale`, ages 16–30, the house's relR with the person's polity < MARRIAGE.maxR), or a new row (PersonHow.Spouse) | offered on a Marriage card (42); a house match raises standing (3.4) |
| children | new rows, PersonHow.Child: a draw per year for a married couple with the wife aged 16–40, `< PERSON.fertility` 0.22; sex 0.5; death year from the survival table (born at 0) | from `'history-person'` |
| apprentice / disciple | a new row at the first card that offers one (≥ 15 years of the role), age 16–25 | skills start at 0.6 × the master's role skill |

Names at assembly (`names/personNames.ts`, streams `names-person-<id>`, in id order, prefix-stable): records keep their
own names (a family surname, a royal heir's name when he accedes is the ruler's). A person with a family gets its surname;
otherwise "of <home>" in the people's language.

### 3.4 The influence model: standing, levers, bounds
- **Standing** (per slow step, pure, `person/standing.ts`):
  `S = 0.3·repN + 0.25·wealthN + 0.25·postN + 0.2·skill[role]`, each in [0, 1]:
  `repN = rep/(rep + PERSON.repHalf 10)`; `wealthN` = the person's capital rank among the families and pools of his
  polity (0 bottom, 1 richest); `postN` = office weight (court `officeW`, Chancellor 0.4 → 1 after ×2.5), commander 0.6
  (1 at fame ≥ renown), family head 0.7, ruler's spouse/kin 0.5, else 0.
- **Influence** `I = roleCap[role] · S`, `roleCap` = Merchant 0.3, Explorer 0.5, General 0.6, Prophet 0.5, Spy 0.4,
  Courtier 0.5 (design defaults; the stats tune them).
- **Lever rule**: every person order that acts inside another system multiplies (or adds to) the threshold of that
  system's **existing** draw by `L = 1 + Lmax[kind]·I`, `Lmax ≤ 1`. So the strongest person lever is ×1.6 at full
  standing. Seat-mode's royal levers are ×4 (Ally) or chance 1 (Charter, Betray). Transfers (ventures, loans, expedition
  costs) are capped by the person's own capital, and gains from a pool by `PERSON.takeMax` 0.05 of it a year.
- Orders that **create** an act (an expedition, a venture, a faith) run a normal instance of an existing mechanism with
  the person stream. The world gets one more expedition or venture of the ordinary kind, never a stronger one, apart from
  skill terms bounded by `±0.5·skill`.

### 3.5 Order kinds 41–58 (`ORDER_KINDS` rows; `OrderRole.Person = 8`; effects in `person/orders.ts`, hooks in `person/hooks.ts`)
Actor = person id. Each hook is neutral when absent. `check` runs on the state at give (as orders do); infeasible ⇒
Failed with the reason. New `OrderReason`: NoFunds 29, NotServing 30, NoPatron 31, OutOfReach 32 (target not known to
the person / not reachable), RoleOff 33 (the role's system is off), Dead 34 (actor not alive).

| kind | key | actor → target | years | rule (formulas in 3.6) |
|---|---|---|---|---|
| PChoice 41 | `pchoice` | person → `row·8 + option` | 0 | record only, Fulfilled at give (seat's Choice 10 rule; Choice keeps its polity/people roles) |
| Venture 42 | `venture` | person → `record·16 + class·2 + dir` (History.longHaul record; class 0–4 = LEG_GOODS; dir 0 a→b) | 1 | buy at one end, sell at the other (3.6.1); resolves after the voyage's years; mode bit 8 in `class` = "pioneer": sponsor a lane to the far mart instead |
| Lend 43 | `lend` | person → `polity·4 + size` (size 0–3: 10/25/50/80 % of capital) | 1 | a loan to the crown (3.6.1) |
| House 44 | `house` | person → family id or −1 | 1 | −1: found a merchant house; f: join (by marriage card) (3.6.1) |
| Serve 45 | `serve` | person → `polity·8 + role` | 1 | enter p's service as General / Spy / Courtier (3.6.3, 3.6.5, 3.6.6); NotServing reasons for the others |
| Stance 46 | `stance` | person → `stance·64 + ground·8 + timing` | 1 | the next battle the person commands (3.6.3) |
| Usurp 47 | `usurp` | person → 0 coup, 1 rising | 2 | a famous general reaches for the throne (lever on battles' coup / rising hooks) |
| Expedition 48 | `expedition` | person → target cell (·2 + 1 = "found an outpost if you can"; high bit = "send a captain, stay home") | 1 | runs one expedition from the person's port (3.6.2) |
| Name 49 | `name` | person → `discovery·4 + choice` | 0 | record only, read at assembly to name a feature the person discovered |
| Reveal 50 | `reveal` | person → `town·64 + tenets` | 1 | found a universal faith (3.6.4) |
| Preach 51 | `preach` | person → town | 10 | a preaching tour: exposure at the town (3.6.4) |
| Mission 52 | `mission` | person → `MissionKind·2^20 + subject` | 10 | a spy's mission (3.6.5) |
| Seek 53 | `seek` | person → OfficeKind | 5 | stand for an office at its next vacancy (3.6.6) |
| Plot 54 | `plot` | person → `FactionKind·4 + mode` (0 join, 1 lead, 2 inform, 3 stand aside) | 10 | court plots (3.6.6) |
| Move 55 | `move` | person → settlement | 1 | move home (a merchant to a richer mart, a prophet into exile) |
| Wed 56 | `wed` | person → `RefKind·2^24 + id` (candidate) | 1 | marriage (3.7) |
| Heir 57 | `heir` | person → person | 0 | name the successor (3.7) |
| Retire 58 | `retire` | person → role or 6 (none) | 0 | leave the role (a general retires: battles' `cRetire` set now; a courtier resigns) or change role (3.7) |

`ORDER_KIND_COUNT` = 59. The Nudge panel never lists 41–58 (they need the person's context). `orderFeasible` gains the
checks for greying in the card.

### 3.6 The role loops (concrete mechanics wired into sim data)

#### 3.6.1 Merchant (MVP; needs goods)
**Capital.** A merchant's capital is shares σ of town pools `mw` (merchant-families 2.1, the same scale-free overlay).
With families on and the person in a family, his seats are the family's seats and his venture budget is
`PERSON.factorShare 0.3 ×` the family capital (head: all of it). Without families, `seatTown/seatSig` in PersonState play
the same role (P2 accounting of merchant-families, simplified: `c = σ·mw`, the pool's own dynamics apply). A start as
NewMan gets `σ0 = min(0.05, PERSON.startCap 50 / mw[home])` as an **overlay** (no money moves: seat on, no orders ≡ off).

**Prices the merchant sees.** At a mart m known to him (3.9): `p̂[m,c] = news[m,c]` (the price when his news last
came from m), real at `newsYear`. True prices are `ts.price[m·G + LEG_GOODS[c]]` at the end of the market of the year.
Buy price `pa = ts.price[a,c]·(1 + sp)`, sell `pb = ts.price[b,c]·(1 − sp)`, spread `sp = PERSON.spread0 0.06 + 0.08·(1 −
skill[Trade])` (a design default: middlemen's cut; no source used).

**Venture (order 42), given at D+1, executed in `personYear` that year (after goodsYear, so prices are this year's):**
```
k   = legHist.leg[record]; legOpen[k] else Failed(OutOfReach); a, b = ends by dir
X   = min(capital · commit, PERSON.cargoShare 0.1 · legUse[k] · pa)        commit: 0.5 (card option "half"), 0.9 ("all in")
q   = X / pa
T   = max(1, round(|legPath[k]| / PERSON.cellsPerYear 40))                 years at sea or on the road
carry = pa · PERSON.carry 0.002 · |legPath[k]| / (1 + 0.5·(tech Seafaring of the home people − 1))
at give: mw[home] -= X (the cargo is aboard: the person's share σ_home reduced by X / mw[home])
at D+1+T (one person-stream draw):  lost = u < 1 − 1/(1 + legHazard[k] · PERSON.fleetMul 3 · T · (1 − 0.5·skill[Navigation]))
     and, if the lane logged FleetLost in [D+1, D+1+T], lost |= u2 < PERSON.fleetHit 0.5   (second draw, only then)
lost:    nothing returns (X destroyed, as the sweep's cargo losses); rep −1; act end 2
arrived: G = q · (pb − carry) − X  (G < 0 possible: the price moved; it is real);  take = min(max(G, 0), PERSON.takeMax · φ_b · mw[b])
         mw[b] -= take; mw[home] += X + min(G, take) (G < 0: + X + G);  σ_home recomputed;  rep += min(2, G/X);  skill[Trade] += 0.03·(1 − skill)
```
World effect: a transfer between two pools (≤ 5 % of b's free pool a year) and destroyed cargo; nothing created [A: no
price impact; at ≤ 10 % of a leg's use this is a deliberate simplification, open question 3]. **Pioneer mode** (bit 8):
the person sponsors a lane to b: `g.urge[home] += PERSON.pioneerUrge 0.5 · (1 + I)` and the route target is b (routes'
`urgeChart`/target fields); `tradeExpedition`'s cost is paid by `merchantPay` from his share first (merchant-families' P3
sponsor rule: "the sponsor is the ordered person's seat at h" amendment). The lane opens or not by the routes code's own
draws (`g.rng`). A lane opened this way is owned by his family (families' laneOwner) or recorded on the act.

**Fleet risk** is the lane's own hazard (`legHazard` falls with `legSailed`, longhaul l.728 [V]): new lanes are dear.

**Loan to a crown (order 43).** With finances: a lender of `LenderKind.Person = 3` (amendment) enters finances'
`lenderCandidates` for p at the next borrowing, at finances' rate and terms, capped by the offered size; repayment and
default by finances' rules (`lenderTake`/`lenderLose`, ruin check = the person's capital to 0 → PersonFell extra Ruined).
Without finances, the merchant-families P3 fallback: a notional loan, default triggers (ReignEnded Overthrown/Deposed/
Battle/RealmEnded, DynastyEnded, PolityEnded, a lost war) with chance 0.5 from the person stream; interest
`PERSON.loanRate 0.08` a year paid from `s.wealth[cap p]` while it holds ≥ 2× the instalment. Proxy effect on the crown:
`s.wealth[cap p] += amount` (real, bounded by the person's capital). A loan raises standing with that court (`postN +=
0.2` while outstanding) and makes a Marriage card with its house likely (families' `marryLoanMul`).

**House (order 44).** Found (target −1, needs capital ≥ families' `foundAbs` and a free family slot): families api
amendment `familyFoundBy(s, home, sig, cause = FamilyCause.Person 3, head = {born, female, ability = 0.5 + skill})`; the
person becomes its head (`Persons.family`), his σ moves into the family's home seat. Join (target f): only through a
Wed with f's head's daughter/son, or as BirthKind.Family. Without families: "House" is a name only (the person's surname
at assembly), and the card is absent.

#### 3.6.2 Explorer (MVP; needs exploration, in repo)
**Refactor (bit-identical, step 5):** `expedition(s, es, id, f, rng = es.rng, ctx: ExpCtx | null = null)` where
```ts
interface ExpCtx { pay: (cost: number) => boolean; rangeMul: number; hazardMul: number; target: number; forceBase: boolean; keepUrge: boolean }
```
With `ctx = null` every line is as today (golden hashes unchanged). With a ctx: `es.rng` reads become `rng` (the person
stream); `xo = ctx.target` replaces `exploreTarget(s.orders, people)`; the cost goes through `ctx.pay` (the person's
capital, else Failed NoFunds); `range ×= ctx.rangeMul`; `h ×= ctx.hazardMul`; the base attempt skips the `O.chance`
comparison when `forceBase` (its draw is still made, on the person stream); `keepUrge` leaves `es.urge[id]`, `nextTry`,
`fails` and `newsRange` untouched (the town's own expeditions go on as if this one had not happened, so the effect is
bounded to the expedition). Shared scratch (`dist/prev/stamp/run`) is safe: stamps compare with `run`.

**Order 48**, executed by `personExpeditions(s, es, px)` right after `explorationSystem` in the year of give:
```
id = person's home (a port, or a coastal town for a sea expedition; overland otherwise); f = prosperity(s, id)
ctx.rangeMul  = 1 + 0.3·skill[Navigation]           ctx.hazardMul = 1 / (1 + 0.5·skill[Navigation])
ctx.target    = the order's cell (the card offers 2–3: the frontier cells of 3.8 kind 36) or -1 ("the edge": the most unknown)
aboard        = high bit clear: the person sails; lost ⇒ PersonDied end Sea (the expedition's own roll decides)
returned: rep += cells/50 + 3·(Discovery logged); skill[Navigation] += 0.05·(1 − skill); the people's map grows by learnPath (existing)
```
Known-world reveal is the existing `learnPath` (the people's knowledge: the whole people learns, as for any expedition)
plus the person's own `known` bits along the path. **Outposts**: the existing base logic with `forceBase`.
**Naming (order 49, record only):** for each Discovery (15) or first-sighted landmass the person's expedition logged, a
Landfall card (37) offers 3 names: (0) the feature's own generated name (`names-feature-<key>`, as today), (1) after the
person ("Veckin's Land", in his language), (2) after the patron or home ("Cape Ashtar"). `names/featureNames.ts` reads the
Name orders at assembly and overrides that key's name (prefix-stable: only that key changes).

**Voyage risk** is the expedition's own `1 − 1/(1 + h)` with the skill factor; measured baseline 22–29 % lost.

#### 3.6.3 General (needs battles; proxy: absent)
- **Serve (45, role General)**: `battleNewCommander(bs, p, born, female, skill = clamp(0.6 + 0.9·skill[Command], 0.6,
  1.5), dyn = -1)` and `battleRecall(bs, p, cmd)` (both asked by court-politics 0.4 of battles; reused). The person is that
  Commanders row; battles' next war of p recalls him through its veteran path (no draws). A retire draw for him is
  overridden: `battleRetire(bs, cmd, year)` (new tiny amendment) is called at his death or Retire order.
- **Pre-battle choices (46)** are read in `war.ts battle()` through `battleStance(s, bs, cmd)` (null when absent):

| choice | effect (design defaults; battles 3.3 terms) |
|---|---|
| stance Bold 0 | own break `b −= 0.04` (fights longer), surprise chance ×1.2 for his side, rout ρ ×1.2 against him if he loses |
| stance Steady 1 | none |
| stance Cautious 2 | `b += 0.04`, ρ against him ×0.7 |
| ground g (0–3) | battles 3.4's candidate list (the last 3 path cells + predecessor). If his side wins battles' **existing ground draw** (`u < sD/(sA+sD)` for the defender), the site is candidate g (shown on the card as "the ford", "the ridge", "open plain") instead of the max/min-T rule; else the enemy's rule. When the actual candidate list differs from the card's (the front moved), the nearest-T candidate to the chosen one is used |
| timing Early 0 | enemy men ×(1 − 0.1·I), own ×0.95 (no time to gather) |
| timing Full muster 1 | own men ×1.08, surprise against him ×1.3 |
All terms enter x, x\*, ρ as battles' modifiers do; the battle stream's fixed draw order `[ground, wet, fog, surprise,
surpriseSide] → … → [slainA, slainD]` is unchanged. **Battle maths decides.** Slain or taken by battles' draw ⇒
PersonDied end Battle (or PersonFell Captured: ransom card).
- The card (31 Battle) appears in the pause before a year in which his polity is at war and he is its recalled commander;
  candidates come from a pure `battleCandidates(s, p, q)`: `armyJourney`'s path is pure (no draws [V battles 1.1]).
- **Fame → pretender**: battles' fame; at `fame ≥ renown/2`, weak ruler (`overthrowHazard(p) ≥ SEAT.riseX`, seat's pure
  helper) the Fame card (32) offers Usurp coup / rising / stay loyal. Usurp multiplies battles' `battleCoup` term by
  `1 + 1.0·I` (coup) or lowers the rising bar `generalBase × (1 − 0.3·I)` for 2 years; the rulers' overthrow draw and
  `contested()` decide. Success ⇒ GeneralSeized (224) with him; the "Rule as your house" seat hand-off (3.1). Failure:
  the rulers' Overthrown path does not fire; with court on, a Foiled plot follows (executed or fled by court rules).

#### 3.6.4 Prophet (needs religion, in repo)
- **Reveal (50)** at town t (the card lists: home and towns he has preached in, alive, `pop ≥ FOUNDING.popMin`, not a
  holy city of another faith, `skill[Piety] ≥ 0.5`). New export `foundFaithAt(s, rel, at, zeal, org, appeal, share)`
  (the tail of `foundStep` after its draws: `newFaith` + `addShare` + FaithFounded 89; **no `rel.rng` draw**).
  `share = FOUNDING.share · (0.3 + 0.7·skill[Piety])`. Tenets are the religion system's attributes, chosen from three
  archetypes that keep `zeal + org + appeal = 1.6` (the mean of `foundStep`'s draws 0.6 + 0.5 + 0.5): **Fervent** (0.9,
  0.4, 0.3: holy wars, persecution when it rules), **Ordered** (0.4, 0.9, 0.3: missionaries, state adoption `adopt·(adoptBase
  + org)`), **Open** (0.3, 0.4, 0.9: town fit up, village fit down, `RELIGION.townAppeal/villageAppeal`); target low 6 bits
  = archetype·16 + a 4-bit tilt (±0.1 moves between two attributes). The faith then lives by the existing system: it
  crowds later foundings (`crowd`), spreads by trade, converts rulers, schisms. Without religion: the role is absent.
- **Preach (51)** at a town j he can reach (home, or one hop along an open route or leg): in `spreadStep` (decadal) the
  hook adds `expose(rel, j, f, PERSON.preach 0.4 · (0.5 + skill[Piety]) · (1 + I), src = j)` once, a bounded exposure
  term in the existing gain formula `rate · exposure · fit · (1 − share)`; no new religion draws. Calibration target for
  an active founder's early growth: the order of 40 % a decade (Stark 1996 [unverified]) at the town level, as a
  check, not a constant.
- **Persecution risk**, per tour, one person-stream draw: `u < PERSON.arrest 0.25 · zeal(state faith of j's polity) ·
  (1 − rTol) · (persUntil[p] > year ? 2 : 1) · (1 − 0.5·skill[Intrigue])`. Hit ⇒ a Persecuted card next pause: Recant
  (rep −5, lives), Flee (Move to the nearest town outside p), Stand firm (a second draw `< 0.5` ⇒ PersonDied end Martyred:
  `rel.zeal[f] = min(1, zeal + 0.05)`, rep +10; a design default, not a sourced effect).
- **Disciples** carry the faith on (PersonHow.Disciple).

#### 3.6.5 Spy (needs beliefs and a spymaster; proxies below)
- **Serve (45, role Spy)** under a spymaster: court's Spymaster holder of p, or (court off) any Kingdom+ polity with
  beliefs' `spy[p] ≥ 0.2`. Missions come as Spymaster cards (38), targets = rivals of p with `relR ≥ BELIEF.spyR`.
- `MissionKind`: **Steal 0** (subject = secret id held by the target's people and not by ours): in `secrets.ts leaks`
  for q = our people, `r[Espionage] = (r[Espionage] || SECRET.espionage·0.5) · (1 + 1.0·I)` while in force (10 years
  covers one secrets phase, `year % 10 === 9`); the **one existing `g.rng` draw** decides; success = SecretLeaked with
  extra Espionage for q. **Plant 1** (subject = target polity t; belief of t about p): beliefs amendment
  `beliefPlant(s, t, p, factor = 1 ± 0.3·I, I)`: `est *= factor`, `varL −= 0.2·I` (a convincing lie; no beliefs draws).
  **Expose 2** (subject t): `beliefDefector(s, p, t, I)` (court amendment 0.4, a hard-channel read of t by p): beliefs'
  own exposure rule can then reveal t's bluff (BluffExposed 233 with source Spies).
- **Caught**, once per mission per slow step, person stream: `u < BELIEF.caughtK · 2 · counter[t] · (1 − skill[Intrigue])`
  ⇒ SpyCaught 236 by beliefs' own logging path (and grudges' row), the mission ends, a Captured card: ransom (capital),
  turn (become t's spy: Serve t, rep −5), or silence (PersonDied end Executed with chance `0.5·cruelty` (riots) or 0.3).
- Proxy without beliefs: Steal only; caught chance with `counter = 0.3·[Kingdom+]`.

#### 3.6.6 Courtier (needs court-politics; proxy: absent; a RoyalKin birth works without court as a pure waiting game for the throne)
- **Seek (53)**: at a vacancy of the office at p, court's `appoint` makes its 12 draws as always; then, if a Seek order is
  in force, the person is a third candidate with `c = clamp(0.5 + skill[Administration], 0.5, 1.5)`, `l` = 0.8 (loyal
  service) or 0.4 (his own man) from the card, faction from the card, and the same argmax score times `1 + 0.5·I`. If he
  wins, the holder row's drawn values are replaced by his (draws already made) and `holders.person` links him
  (amendment: a `person: Int32Array` column, −1). PersonRose extra Office.
- **Offices** then act through court 5.4 multipliers with his competence. His tenure, dismissal hazard (court 5.3) and
  plot rules apply with court's draws; the Purge card (41) offers "Loyal service" (`l += 0.1`), "Cultivate the favourite"
  (`favour += 0.1`) or "Withdraw" (Retire).
- **Plot (54)**: join (his faction's plot `P_k · (1 + 0.5·I)`), lead (as join, and he is the plot leader: success ⇒ he is
  the candidate who accedes, MinisterSeized 298), inform (the plot's detection draw threshold `+ 0.3·I`; success ⇒
  `favour = 1`, rival disgraced; his faction's strength ×0.7 and a Revenge risk: the rival's faction plots against him),
  stand aside (∅). Survive purges: Executed by court's rule ⇒ PersonDied end Executed.
- Factions: `fav` and faction membership by the card (Faction 40). Sources: court-politics' models (e.g. Padgett & Ansell
  1993 [unverified] for network-based court power, as background only; no constant taken from it).

### 3.7 A life: ageing, family, death, succession
- **Age and skills**: skills start from the birth (BirthKind table [A]: a family son trade 0.35, a ship's master
  navigation 0.4, …, the rest 0.1–0.2 by a person-stream draw each) and grow by use (`+α·(1 − x)` per act, α in 3.6)
  and decay after 55 (`×0.99` a year). Learning-by-doing curve is a design default.
- **Death**: `death = deathYear(R.surv, born, from, u)` drawn once at entry (rulers' survival table; when rulers are off
  the same table is built by an exported `survivalTable()` — merchant-families also asks for it). Plus event hazards from
  the sim's own draws (battle, sea) and person-stream draws (plague: a CityStricken/epidemic toll t at home ⇒ `u <
  PERSON.plague 1.0 · t`; executions). **The watcher never reads `death`**; an Old age card appears from age 60 by age
  only.
- **Marriage (42, Wed 56)** from the relationship table (3.3). A match into a family or house: standing `postN += 0.2`
  and for a merchant `wealthN` uses the joint capital; with families on and the spouse's family a family of the world,
  families logs FamilyMarriage-like rows only for ruling houses — person marriages are PersonRose extra Married.
- **Succession (43, Heir 57)**: candidates = living children aged ≥ 14, apprentices, disciples (and for a courtier or
  general, the protégé = his apprentice row). Heir inherits: capital (shares) whole (a family head's seat stays the
  family's; the heir becomes head only if families' own head succession picks him: families P4 `howWeights` Son — an
  amendment lets an ordered heir be that Son), reputation `×PERSON.repInherit 0.4`, skills: child
  `0.3 + 0.4·parent + U(−0.1, 0.1)` in the parent's role skill, apprentice `0.7·master`, disciple piety `0.8·master`.
  The role may change on succession (an explorer's daughter may be a merchant). No candidate ⇒ SeatLost (extra 4, a new
  SeatEnd "line ended"); the UI offers "Take another life".
- **Dynasty of characters**: `Persons.line` and the lineage score (3.12).

### 3.8 Decision kinds 27–44 (`person/watch.ts`, pure reads; seat-mode's rules: mix32 tie-breaks, fog, cadence, "let it be" ∅ option, PChoice record)
| DecisionKind | trigger (D = this year; person x, home h, polity p of h) | options → orders (year D+1) | class / cool |
|---|---|---|---|
| Market 27 | Merchant: a known open leg from a mart where x has a seat with `p̂b(1−sp)/(p̂a(1+sp)) − 1 − carry ≥ PERSON.cardGap 0.15` (≤ 3 best, by expected gain) | Venture half / all in on leg L (42) · Pioneer a lane (42 mode 8) when a far mart is known with no lane · Wait (∅) | minor / 3 |
| Credit 28 | Merchant: p (or a contacted polity) borrowed this year or finances' `finNeed(p) ≥ 0.5` (proxy: a war declared by p) | Lend 25/50 % (43) · Refuse (∅) | major / 10 |
| House 29 | Merchant: capital ≥ families' `foundAbs` and not in a family, or a family head offers a match | Found a house (44) · Marry into it (56) · Stay free (∅) | major / 20 |
| Muster 30 | General: a war declared by or on p while x is not serving, or a contacted realm at war hires (relR with p < 0.3) | Serve p / Serve q (45) · Stay home (∅) | major / 5 |
| Battle 31 | General: x is p's recalled commander and p is at war | Stance × ground × timing (46), at most 4 options (Bold-ridge-early, Steady-ford-muster, Cautious-best-T, the engine's own choice ∅) | urgent / 0 |
| Fame 32 | General: fame ≥ renown/2 and `overthrowHazard(p) ≥ SEAT.riseX` or a lost war | Seize (47 coup) · Raise the banner (47 rising) · Stay loyal (∅) | major / 15 |
| Revelation 33 | Prophet: not yet founded, piety ≥ 0.5, a woe at home (famine, sack, plague ≤ 25 y: foundStep's own crisis rule) or age ≥ 30 | Reveal: Fervent / Ordered / Open (50) · Wait (∅) | major / 10 |
| Mission field 34 | Prophet: his faith founded; ≤ 3 reachable towns with the lowest share of it | Preach at j (51) · Stay (∅) | minor / 10 |
| Persecuted 35 | Prophet: the arrest draw hit | Recant (58 → None) · Flee (55) · Stand firm (PChoice; the second draw) | urgent / 0 |
| Frontier 36 | Explorer: at a port with prosperity ≥ EXPLORE.satMin and unknown cells within range (the exploration code's `frontier()` test, made pure) | Sail for A / B (48 with target) · "The edge" (48, −1) · Send a captain (48 high bit) · Stay (∅) | minor / 5 |
| Landfall 37 | Explorer: a Discovery or new landmass by his expedition | Name it 0/1/2 (49) | minor / 0 |
| Spymaster 38 | Spy serving p: rivals with relR ≥ spyR known | Steal k / Plant / Expose (52) · Decline (∅) | minor / 10 |
| Office 39 | Courtier: a vacancy in Chancellor/Marshal/Treasurer/Spymaster at p (court) | Seek it loyal / as your own man (53) · Not this one (∅) | major / 0 |
| Faction 40 | Courtier: a plot (P_k ≥ 0.02) or a divided court (court 9.1 Council test) | Join / Lead / Inform / Stand aside (54) | major / 10 |
| Purge 41 | Courtier or General: his patron fell, a new reign, or his faction lost power | Loyal service / Court the favourite (PChoice + court favour lever) · Withdraw (58) · Flee abroad (55) | urgent / 0 |
| Marriage 42 | age 18–40, unmarried; candidates (3.3) known to x | Wed A / B (56) · Not yet (∅) | major / 8 |
| Succession 43 | age ≥ 50 with ≥ 1 candidate and no heir named, or at death | Name A / B / C (57) · (at death:) Take up A's life | urgent at death / 10 |
| Patron 44 | the patron died or fell; or a richer/ higher patron is reachable | Follow the new man (PChoice) · Move to X (55) · Change calling (58 → role) | major / 15 |

Cadence (person scale): `PERSON.maxCards 2` a pause, `minGap 1` year except urgent, per-kind cool as listed, warm-up 1
year. **"Skip to next opportunity"** = the UI's pause filter: in skip mode the worker breaks `playSeat` only on urgent or
major rows; minor rows are still created (the decisions table is identical) and resolve to ∅. The filter is a UI
setting, not a sim option: replay is unaffected.

### 3.9 Fog and perspective (what the person knows; rumours can be wrong)
- **Map**: cells known to the person = `known[k·N + c] ≥ 0` for his people k **or** his own bit (`PersonState.known`:
  paths of his ventures, expeditions, tours; 2.9 KB). Uses seat-mode's `people=` view filter with the extra bitset.
- **Prices**: `news[m]` is refreshed to the true prices when his network touches mart m in a year (a venture arrives or
  leaves, he lives there, his family has a seat there, a lane from his home to m carried use > 0: "letters"). Shown prices
  are those of `newsYear[m]`, labelled with their age. Second-hand news (via the family's branch or a relay mart, not
  his own visit) carries rumour noise `× exp(PERSON.rumourSd 0.15 · z)`, `z = gaussHash(seed, person, m, newsYear)`
  (a deterministic hash: no draws). Decisions are taken on the stale, noisy price; the venture is settled at the true one.
- **Strength, alliances, bluffs**: beliefs' `est/varL/bKnown` for his polity (seat-mode 6.5 adapter), so a spy who plants
  a lie and a general misjudging the enemy see the same engine. Without beliefs: the truth, but only for contacted polities.
- **Events** enter his annals with a delay `d = ceil(hops(home, event town) / PERSON.newsHops 6)` years, hops on the
  link graph; events beyond contact never. A false rumour: for battle results and royal deaths of non-neighbours, with
  hash probability `PERSON.falseRumour 0.08` the annals show the wrong outcome until the true news arrives (`d + 2`
  years). UI only: never read by the sim or the watcher's triggers (the watcher uses the delayed true events).

### 3.10 Events 360–369 (`EventType`; none without a Person seat)
```ts
  // person: character mode, the player's life (360-369; none unless HistoryOptions.seat is a Person seat). `value` is the History.persons row unless noted.
  PersonEntered: 360, // person `value` took up the life at `settlement` (home); `other` the home of the person they succeed (-1 at the start); `extra` PersonHow * 8 + PersonRole
  PersonDied: 361, // person `value` died at `settlement`; `other` the place of death if elsewhere (a battle's target, a port the ship sailed from), -1; `extra` the PersonEnd
  VentureEnded: 362, // the venture `extra` (History.personActs row) of person `value` from `settlement` to `other` came home with a gain, or was lost at sea (the act's end says which)
  PlaceNamed: 363, // person `value` named the discovery at cell `other` (History.features id in the act) from his expedition out of `settlement`; `extra` the name choice
  Preached: 364, // person `value` preached faith `extra` (History.faiths) at `settlement`; `other` the town he came from, -1
  PersonRose: 365, // person `value` at `settlement` gained a standing: `extra` RiseKind (0 office, 1 command, 2 house founded, 3 married, 4 patron, 5 role changed, 6 moved home, 7 heir named); `other` the polity's capital or the spouse's home, -1
  MissionEnded: 366, // the mission `extra` (History.personActs row) of person `value` against the realm ruled from `other` ended: its act end says done, caught or failed; `settlement` the spy's base
  PersonFell: 367, // person `value` lost standing at `settlement`: `extra` FallKind (0 dismissed, 1 disgraced, 2 imprisoned, 3 captured, 4 ruined, 5 exiled, 6 recanted); `other` the capital whose court did it, -1
  PersonRenowned: 368, // person `value` reached the renown of a saga's hero (rep >= PERSON.renown 25) at `settlement`; `other` -1; `extra` the role
  LineEnded: 369, // the player's line ended with person `value` at `settlement`: no heir took up the life; `other` -1; `extra` the generations played
```
Ambitions reuse seat-mode's AmbitionFulfilled 273 with AmbitionKind 6–15. A person's own FaithFounded 89,
ExpeditionSent/Returned 13/14, Discovery 15, SecretLeaked 58, GeneralSeized 224 and court 290s are logged by their
systems as usual; the saga links them by the act rows. Director (experience 0.1): `registerDrama` for 360–369 in
`personFormat.ts`: PersonDied/LineEnded/PersonRenowned cat Nudge base 6 (focus factor as seat), VentureEnded and
PlaceNamed base 2, the rest 3; all others ignored only if the person is not the focus.

### 3.11 Params `person/params.ts` (`export const PERSON`, a doc line each; **all design defaults to tune**, none sourced)
`maxRun 10, maxCards 2, minGap 1, fullEvery 25, repHalf 10, renown 25, repDecay 0.03, repInherit 0.4, roleCap [0.3, 0.5,
0.6, 0.5, 0.4, 0.5], startCap 50, factorShare 0.3, spread0 0.06, cargoShare 0.1, cellsPerYear 40, carry 0.002,
fleetMul 3, fleetHit 0.5, takeMax 0.05, pioneerUrge 0.5, loanRate 0.08, cardGap 0.15, preach 0.4, arrest 0.25, plague 1.0,
fertility 0.22, newsHops 6, rumourSd 0.15, falseRumour 0.08, seats 4`.

### 3.12 Goals: ambitions, end-of-life score, lineage
`AmbitionKind` (seat-mode's enum, continued): MerchantPrince 6 (the richest house or person of his polity for 10 years),
Discoverer 7 (a Discovery), Founder 8 (a faith he revealed has ≥ 10 000 followers), Marshal 9 (CommanderRenowned),
Throne 10 (he or his heir takes a throne), Chancellor 11 (10 years in the highest office), Shadow 12 (3 missions
succeeded uncaught), Dynast 13 (his house survives 100 years), Elder 14 (lives to 70), Lineage 15 (5 generations
played). Max 3 per life at the start sheet; judged in `personYear`.

**Life score** (at death, `Persons.score`, shown on the death card; a game score, not a historical claim):
`score = 10·[ambitions fulfilled] + 5·log2(1 + wealthPeak/startCap) + repPeak + 3·log10(1 + followers of his faith) +
cells revealed/100 + 2·secrets stolen + office years/5 + 2·battles won`. **Lineage score** = Σ over the line of
`score_g · 0.9^g`. Both are deterministic functions of History (the UI recomputes them, the sim stores them).

### 3.13 Saga at death (both registers)
Subject `person` in `ui/sagas/` (new `SagaKind.Person`; `sagasPanel` subject list; facts from `Persons`, `PersonActs`,
the PChoice orders and the events 360–369 plus the linked system events). Partisan lens: `Pov.kind` gains `'person'`
(the person's polity and faith decide Us/Foe; experience 3.2 amendment). Examples:
- Venture lost, Chronicle: "1211 — A ship of Taro Veckin bound for Kubeta with pepper is not heard of again; the house
  is said to have lost half its capital." Legend: "The sea took the Kubeta pepper, and Taro learned to pray."
- Discovery, Chronicle: "1240 — Ivo of Rilko returned from the south with word of a land no one had seen; he named it
  Rilkoland." Legend: "Ivo sailed past the last chart and came back with a coast in his hands."
- Battle (ground chosen), Chronicle: "1302 — The marshal Asha Ten chose to hold the ford at Vebena; the Oreni broke on
  it, though at heavy cost." Legend: "Asha planted her banner in the river and let the Oreni come to her."
- Martyred, Chronicle: "1330 — The preacher Mera was put to death at Tarsa for refusing to recant; her followers there
  are said to have grown in number after it." Legend: "They burned Mera at Tarsa, and her word went out on the smoke."
- Succession, Chronicle: "Taro's daughter Ilsa took up the house's books in 1252." Legend: "The ledgers passed to Ilsa,
  and the house did not miss a season."
Hedging as seat-mode 6.4: the Chronicle states the order and the recorded outcome, never the motive.

---

## 4. Determinism and the off switch
- **Seat off or a non-Person seat**: `px = null`, no hooks, no events 360–369, no `History.persons`: bit-identical
  (golden hashes unchanged, no filter).
- **Person seat, no orders**: identical but for `History.persons/personActs`, events 360–369 (and 273). The start
  capital is an overlay, children and death draws are person-stream only, the watcher draws nothing. Test filter: those
  fields and types.
- **Draw order** in `'history-person'`, fixed per year: entry draws (death u, skill draws, in that order) → per person
  in id order: children → plague → per venture in act order (lost u, then u2 if FleetLost) → per mission (caught) → per
  tour (arrest, second) → personExpeditions' own sequence (the expedition's draws, in its code order). Every other
  stream keeps its draws: the levers move thresholds only (secrets, rulers' overthrow, contested, court appoint/plot
  detection, battles' ground/surprise), and `expedition()` with a ctx draws from the person stream only.
- **URL replay** = one run from 0 with `{seat, orders}` ≡ the live session: the orders of D+1 change nothing ≤ D
  [M seat-mode], the watcher is pure, person ids are created in a fixed order. Tests in step 3.
- **Refactors with unchanged hashes**: `expedition(…, rng, ctx)`, `foundFaithAt`, `frontier()` purity, `survivalTable()`.

## 5. Worker protocol (seat-mode 5, extended)
```ts
| { type: 'seat'; …; seat: SeatOptions /* kind Person, person: PersonStart */ }           // unchanged request
| { type: 'personHistory'; requestId: number }                                          // assemble and post the full History now
Response: { type: 'personPause'; requestId; view: PersonView; cards: number[]; history?: History; dead: boolean; lineEnded: boolean }
```
`PersonView` (struct of small typed arrays, built by `person/view.ts` from state, transfer-listed): the person sheet
(skills, capital, seats, rep, standing, relationships with names resolved through the naming service's cached tables),
the life timeline rows since the last view, ≤ 64 known marts × 5 prices with ages, ≤ 32 legs with hazard words, the
cards (the decision rows and options, same layout as `SeatDecisions`), the person's annals (delayed events, ≤ 200),
overlay cells (his `known` delta and paths). The full History is attached every `fullEvery` years, at death, and on
`personHistory` (the map's "bring the world up to date"). Main keeps the last full History for the globe and draws the
overlay on it, marked "the world as of <year>".

## 6. UI (`ui/person/*`, `person.css`; reuses seat's `decisionCard.ts`, `seatController.ts`)
- **Start sheet** (from "Live a life here" in the Settlement, Factions, Rulers (heirs), Merchant Houses and Court panels):
  role, birth (the record, with its name), sex where open, age, ambitions (≤ 3), Begin.
- **Character sheet** (tab "Life" in the sheet; phone bottom sheet tab): portrait glyph by role and era, name, age, home,
  faith, skills as words (six bars), capital and seats, renown, standing in words ("known at court"), patron, rival,
  spouse, children, named heir.
- **Life timeline** (`ui/person/lifeline.ts`): a horizontal band from birth to now under the main timeline, with PersonRose,
  ventures (green/red), battles, tours, missions; tap a mark to fly there.
- **Opportunity cards**: seat's card component, title by DecisionKind, situation lines from what he knows ("letters
  from Kubeta, three years old, say pepper fetches twice what it costs here"), options with the expected outcome and the
  risk in words ("one ship in five is lost on this lane"). Desktop modal; phone half sheet, 48 px buttons (seat 6.3).
- **Personal map overlay** (`render/personOverlay.ts`): home ring, his seats, known marts with price chips, his lanes
  and expedition paths, the fog of his own knowledge, the next card's place pulsing. One InstancedMesh for markers, one
  line batch; ≤ 2 draw calls (perf-efficiency budgets).
- **Speed**: life speed (default 1 year/s; ½, 2, 5), Space pauses, "Skip to next opportunity" toggle (3.8).
- **Walkable city hook** (city-renderer-eras.md, in progress): `cityFocus(view): CityFocus` with
  `{settlement: home, year, building: 'counting-house' | 'harbour' | 'barracks' | 'temple' | 'palace' | 'house', landmark?:
  number}` (a family patron landmark, his faith's temple, the court's palace). "Walk home" opens the city view focused
  there once that plan provides an entry point; until then the button is hidden. No dependency in either direction
  beyond this interface.
- **Death card**: cause, age, score, ambitions, "Read the saga" (both registers), and the Succession choice.

## 7. Ordered commit-sized steps (each: `npm test`, `npm run typecheck` green; golden hashes unchanged unless a Person seat is on)
Phase P0 (after seat-mode phases A–B)
1. **Contract**: PersonRole, PersonHow, PersonEnd, RefKind, PersonSkill, BirthKind, MissionKind, ActKind, ActEnd, RiseKind,
   FallKind, PersonStart, Persons, PersonActs, EventTypes 360–369, `SeatKind.Person 4`, `SeatOptions.person`,
   AmbitionKind 6–15, `OrderRole.Person 8`, OrderReason 29–34, OrderKind 41–58 rows, encode/decode (seat and orders);
   `history.test.ts` event switch; worker transfer list `personBuffers`. Tests: encode round trips; ORDER_KINDS row count.
2. **Person state and life** (`person/state.ts`, `system.ts personYear`, `assemble.ts`, `names/personNames.ts`; hook in
   `index.ts` before `ordersEnd`; `survivalTable()` export): entry from each BirthKind, ageing, children, death, events
   360/361/369. Tests: seat off ≡ golden; Person seat no orders ≡ off filtered (seeds 1, 42, 600 y); death year never
   read by `watch.ts` (grep test, as seat-mode's); same person ids on replay.
3. **Watcher + lite pause** (`person/watch.ts` called from `seatWatch`, `person/view.ts`, worker `personPause`,
   `personHistory`; `playSeat` break rules, skip filter). Tests: paused run ≡ unpaused with the same orders; PChoice-only
   run ≡ no orders filtered; cadence limits. **Measure**: PersonView build ms and bytes, main-thread apply ms (desktop,
   phone emulation) vs a full History swap.
Phase P1: MVP roles
4. **Merchant**: seats overlay (families-off path), prices and news, Venture (+ pioneer), Market card, VentureEnded,
   fleet risk. Tests: neutral when absent; a venture on a known high-gap leg gains ≈ the formula; loss rate over 500
   simulated ventures ≈ `1 − 1/(1 + h·…)` (stats); pool totals conserved except the lost cargo (assert).
5. **Explorer**: `expedition(…, rng, ctx)` refactor (hash unchanged with ctx null), `frontier()` pure, `personExpeditions`,
   Frontier and Landfall cards, Name order read in `featureNames.ts`. Tests: refactor golden; a person expedition draws
   nothing from `'history-expeditions'` (stream state equal); names change only for the named key.
6. **Succession and goals**: Wed, Heir, Retire, Marriage/Succession/Patron cards, ambitions 6–15 (MVP subset 6, 7, 13,
   14, 15), score, LineEnded. Tests: an heir continues with inherited capital; no candidate ⇒ LineEnded + SeatLost.
7. **UI MVP**: start sheet, character sheet, lifeline, overlay, card texts for 27–29, 36, 37, 42–44, death card.
   Manual: seed 42, a merchant born at the largest mart of 1100, 3 generations; reload the URL, same lives.
8. **Saga** `person` subject, `personFormat.ts` (both registers for every RiseKind/FallKind/PersonEnd/ActEnd), director
   rules. Tests: phrase-table completeness; saga facts include acts and choices.
Phase P2: merchant depth (needs finances / families; proxies otherwise)
9. **Lend** (LenderKind.Person in finances, or the notional fallback) + Credit card; **House** (families api
   `familyFoundBy`, factor budgets, ordered heir as Son) + House card.
Phase P3: other roles, each behind its system
10. **General** (battles: `battleStance`, `battleCandidates`, `battleRetire`; Serve, Stance, Usurp; cards 30–32).
11. **Prophet** (religion: `foundFaithAt`, preach hook in `spreadStep`, arrest; cards 33–35; ambition 8).
12. **Spy** (secrets lever, beliefs `beliefPlant`, `beliefDefector`; cards 38, captured flow; ambition 12).
13. **Courtier** (court: third candidate in `appoint`, `holders.person`, plot levers; cards 39–41; ambitions 10–11; the
    seat hand-off on accession).
14. **Stats harness and tuning** (section 8), **fog polish** (rumours, delayed annals), **city hook** (6).

## 8. Stats harness (`src/sim/history/person/personStats.ts`, node, one JSON line per run)
Auto-players: **Greedy** (the best expected gain or the first active option), **Cautious** (lowest risk; ∅ when unsure),
**Random** (hash-chosen), **Passive** (always ∅). Seeds 1, 7, 42, 1234; Y0 ∈ {600, 1200}; per role a valid birth (the
largest mart's family, the busiest port, the largest polity's officer, …); play until the line ends or 300 years.

| metric | target |
|---|---|
| cards per decade of a life | 3–8 (median); ≥ 1 per 5 years for the MVP roles |
| cards with ≥ 2 feasible options | ≥ 95 % |
| life length from entry at 20 | median 35–50 years (survival table + hazards); explorers aboard shorter |
| merchant capital over a career (Greedy) | median ×3–10; ruin (capital < 10 % of peak) 10–30 % |
| venture loss rate | within ±20 % of the formula's mean for the lanes used |
| explorer expedition loss | 15–35 % (baseline 22–29 % [M]) |
| decisions matter | Greedy vs Cautious vs Passive differ in life score by ≥ 20 % on ≥ 3 of 4 seeds |
| world impact (merchant) | Σ|Δmw| over the life ≤ 2 % of Σ mw; (explorer) ≤ +1 expedition per 5 years; hash differs from off only after the first order |
| bounded levers | no lever term > 1.6 (assert in debug builds) |
| determinism | replay hash ≡ live, every run |
| perf | choice → next pause median ≤ 60 ms desktop unloaded (≤ 10 y × ~3 ms + view), p95 ≤ 250 ms |

## 9. Performance and memory
- Sim: `personYear` is O(persons alive + acts) a year, < 0.05 ms [A]; the watcher O(known marts·legs from his seats)
  ≤ 64·8 checks; `standing` once a slow step.
- **Pause cost is the issue**: person pauses come every 1–3 years. A full History per pause (35–39 MB at 2000 y; 25 ms
  unloaded, 200–750 ms loaded to assemble [M seat-mode]) would dominate. Hence PersonView (≈ 20–80 KB [A], < 2 ms to
  build [A]) and a full History every 25 years (≈ 1 per 10 pauses). Measure in step 3; if the main-thread apply of a
  full History is > 150 ms on a phone, raise `fullEvery` on phones to 50 and make "bring up to date" explicit.
- Memory: PersonState < 50 KB (≤ 200 rows, the known bitset 2.9 KB, news 5 × marts ≤ 131 [M] × 12 B). PersonView ×2 in
  flight. Checkpoints: seat-mode's ring and phone cap (2 total, ≤ ~60 MB) unchanged; take-back on a phone is one card.
- Phone sim speed 3–5× desktop [A, seat-mode], so a 10-year run is ≤ ~150 ms there.

## 10. Interfaces (enum values used; amendments to other plans)
**Enum values (registry):**
| enum | values | note |
|---|---|---|
| EventType | 360–369 | this plan's block |
| OrderKind | 41–58 (`ORDER_KIND_COUNT` 59) | after tech-tree 39–40 (registry clash resolved) |
| DecisionKind | 27–44 | after tech-tree 25–26 (registry clash resolved) |
| SeatKind (seat-mode) | Person 4 | after Family 3 |
| AmbitionKind (seat-mode) | 6–15 | after Monument 5 |
| OrderRole | Person 8 | after Faith 7 |
| OrderReason | NoFunds 29, NotServing 30, NoPatron 31, OutOfReach 32, RoleOff 33, Dead 34 | after seat-mode's 26–28 |
| LenderKind (state-finances) | Person 3 | after Town 2 |
| FamilyCause (merchant-families) | Person 3 | after Split 2 |
| SeatEnd (seat-mode SeatLost extra) | LineEnded 4 | after 0–3 |
| SeatOptionKey (seat-mode) | appended after court-politics' keys at build time | person option keys: VentureHalf, VentureAll, Pioneer, Wait, Lend25, Lend50, Refuse, FoundHouse, MarryIn, StayFree, ServeP, ServeQ, StayHome, Bold/Steady/Cautious combos, Seize, Rise, Loyal, Fervent, Ordered, Open, Preach, Recant, Flee, StandFirm, SailA, SailB, Edge, Captain, Name0–2, Steal, Plant, Expose, Decline, SeekLoyal, SeekOwn, Join, Lead, Inform, StandAside, CourtFavourite, Withdraw, FleeAbroad, WedA, WedB, NotYet, NameHeir, TakeUp, Follow, MoveTo, ChangeCalling |
| new local enums | PersonRole, PersonHow, PersonEnd, RefKind, PersonSkill, BirthKind, MissionKind, ActKind, ActEnd, RiseKind, FallKind | this plan's contract (3.2, 3.10) |
| RNG stream | `'history-person'`, names `names-person-<id>` | |
No GrievanceKind, RevoltCause or ReignEnd values are added.

**Amendments asked (all null-guarded, draw-neutral):**
- **seat-mode**: `SeatKind.Person`, `SeatOptions.person`, AmbitionKind 6–15, SeatEnd 4; `seatWatch` calls `personWatch`
  when `kind === Person`; worker response `personPause` and request `personHistory`; `playSeat(limit, filter)` gains the
  skip filter (urgent/major/minor); the "Rule as your house" hand-off creates a new seat from a pause checkpoint.
- **perf-efficiency P6**: `PersonState` is part of `RunnerState` (no module-level state).
- **exploration (in repo)**: `expedition(s, es, id, f, rng = es.rng, ctx = null)`; `frontier()` without side effects for
  the watcher (split the refresh of `unknownCount` from the test, or the watcher computes its own count: pure).
- **religion (in repo)**: export `foundFaithAt` (no draws) and a preach exposure hook in `spreadStep`.
- **rulers (in repo)**: export `survivalTable()` (merchant-families asks too) and reuse seat's `overthrowHazard`.
- **merchant-families**: `familyFoundBy(s, home, sig, cause, head)`; the ordered person is the sponsor seat in P3
  Venture; an ordered heir is the Son in P4; `FamilyCause.Person 3`.
- **state-finances**: `LenderKind.Person 3` in `lenderCandidates` (capacity = the person's offered amount) and its
  `lenderGive/Take/Lose` branches (to the person's shares).
- **battles**: `battleStance(s, bs, cmd)`, `battleCandidates(s, p, q)` (pure), `battleRetire(bs, cmd, year)`; reuse
  `battleNewCommander`, `battleRecall` (court 0.4).
- **court-politics**: `holders.person` column; Seek as a third candidate in `appoint` (draws unchanged); plot levers
  from Plot orders; the dismissal and execution outcomes call `personFell/personDied` when `holders.person ≥ 0`.
- **beliefs-and-deception**: `beliefPlant(s, o, t, factor, I)`; reuse `beliefDefector` (court 0.4).
- **goods/secrets**: the Espionage lever in `leaks` (threshold only).
- **experience-whatif-director-sagas**: `SagaKind.Person`, `Pov.kind 'person'`, drama rules for 360–369.
- **city-renderer-eras** (in progress): consume `CityFocus` (6) when it provides an entry point.

## 11. Risks, open questions; verified / measured / assumed
### Verified [V]
Step order and hook points in `index.ts step()`; `expedition()` structure, its stream, loss formula and base logic; the
expedition's side effects on `urge/nextTry/fails/news`; `newFaith` private and `foundStep`'s draws and attribute
draws; religion attributes zeal/org/appeal and their uses (params doc); `ts.price` and `forwardPrices` (every other
year) for LEG_GOODS 7–11; `legHazard` falling with `legSailed`, FleetLost's one draw; `leaks` one draw over channel
rates incl. Espionage for Kingdom+; rulers' `deathYear` exported, `survival()` private; OrderKind 0–9 and OrderRole 0–7.
### Measured [M]
World scale per seed (2000 y): N 23 042, P 6–10, marts 75–131, expeditions 63–136, expedition loss 22–29 %, FleetLost
2–30, faiths 15–16, rulers ~1100–1200; lane-end price ratios p50 1.68–2.09, p90 7–12. Seat-mode's live-append and
pause-cost measurements are reused, not re-measured.
### Assumed [A]
All PERSON constants; PersonView size and build time; no price impact of ventures; skill learning curves; phone speed;
that court/battles/beliefs/families expose the functions named (they are planned, not built).
### Risks
- **Too many pauses / too few interesting cards**: the person scale is slow; Market cards could dominate (most legs have
  ratio ~1.04 [M]). Mitigation: `cardGap`, the skip filter, priority of major/urgent kinds, the harness's kind-share limit.
- **Feedback with no world effect feels hollow** (a merchant only re-divides pools): pioneer lanes, loans, houses and
  patronage are the real levers; the harness's world-impact metric shows it is non-zero but bounded.
- **Explorer is world-scale strong**: one more expedition per 5–10 years doubles a small world's rate (2). Bound by the
  cooldown, cost from the person's capital, and `keepUrge`. Watch the Discovery race (players taking every pole first).
- **Leaking the future**: `death`, `rDeath`, `hDeath`, court's pre-drawn holder deaths. Grep test on `person/watch.ts`
  and `view.ts`.
- **Hand-offs between seats** (person → house on accession) need a new run from a checkpoint; without P6 it is a re-run
  0→D (seconds). Acceptable as a rare moment, with a progress bar.
- **Dependence on unbuilt plans** for 4 of 6 roles. The MVP needs only seat-mode A–B and in-repo systems.
### Open questions
1. Should a merchant's venture move prices (a small quantity added to the sweep's flows)? v1 says no (pure transfer).
2. Should the player be allowed to name non-discovery features (a town he founds as an outpost)? Cheap at assembly.
3. Spouses from ruling houses: should a person marriage count in rulers' marriage ties (diplomacy)? v1: no.
4. When a royal cadet accedes, offer the hand-off automatically or keep playing the person (a king's life at person
   scale)? v1 offers the choice.
5. Free orders (sandbox) in character mode: hidden, as seat mode's "free decrees".

## References
Search budget for this session was exhausted before these could be opened, so every citation is **[unverified]**
(not confirmed by a fetched page in this session; to be verified before implementation). None of them supplies a
constant used above; all PERSON values are design defaults.
- Stark, R. (1996). *The Rise of Christianity: A Sociologist Reconsiders History*. Princeton University Press.
  ISBN 978-0691027494. Used only as a calibration check (about 40 % growth a decade) for an active founder's early
  spread (3.6.4). [unverified: search budget exhausted; the estimate is also contested]
- Greif, A. (1989). "Reputation and Coalitions in Medieval Trade: Evidence on the Maghribi Traders." *Journal of
  Economic History* 49(4): 857–882. doi:10.1017/S0022050700009475. Background for reputation as a merchant's standing
  term (3.4). [unverified: search budget exhausted]
- Padgett, J. F., and Ansell, C. K. (1993). "Robust Action and the Rise of the Medici, 1400–1434." *American Journal
  of Sociology* 98(6): 1259–1319. doi:10.1086/230190. Background for courtier networks (3.6.6). [unverified: search
  budget exhausted]
- Gompertz, B. (1825). "On the Nature of the Function Expressive of the Law of Human Mortality…" *Philosophical
  Transactions of the Royal Society of London* 115: 513–583. doi:10.1098/rstl.1825.0026. The model behind the rulers'
  survival table the person's death reuses (3.7). [unverified: search budget exhausted]
- Lanchester, F. W. (1916). *Aircraft in Warfare: The Dawn of the Fourth Arm*. Constable, London. The battle model
  (battles.md) that decides a general's battles (3.6.3). [unverified: search budget exhausted]

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **R1.** Phone speed: 3× the VM bench [G], replacing "3–5× (seat-mode)" in §9, until Phase 0 measures it.
- **R25.** The `CityFocus` walkable-city hook (§6, §10, step 14) is dropped: the owner dropped the walkable city.
