# Registry: values used in code against values reserved in plans

Reconciled 2026-11-27 (lane/setup, after the outside evaluation). It covers `src/contract.ts` on main @ f20cb5f (coldwar merged) and the
unmerged lanes lane/citystates and lane/absentee. It also covers MASTER-PLAN §3 and every addendum, including
the shadow-network, throne-stories-arcs and battles-fiction addenda.

The plan freeze is in force (EVALUATION.md §3 P8). **Nothing new is reserved.** The reservations below stay so that parked
plans keep their numbers. Code reads every value by name. `src/registry.test.ts` checks two things: every enum of
`contract.ts` has unique values, and the EventType names and ids are unique.

## Duplicates in code
I scanned every PascalCase numeric enum in `src/**` and in all 21 lane worktrees, and compared values across trees.
**There is no duplicate value in code**, within a tree or between trees. The collisions were all in the plans, and they are
resolved below.

## EventType blocks
| range | owner | state |
|---|---|---|
| 160–173, 180 | merchants, families, orders, cradles | main |
| 182–184 | seat2: SeatDeclined, SeatReasserted, DeferBlamed | main |
| **185–187** | absentee: CouncilRuled, RuledInPerson, RulerTaken | lane/absentee (registered in the lane/absentee addendum) |
| 188–189 | — | free |
| 190–194 | grudges | main (195–199 spare) |
| 200–205 | city-states | lane/citystates (206–209 spare) |
| 210–214, 217 | finance | main (215, 216 and 218 reserved; 219 spare) |
| 220–227 | battles | main (228–229 spare) |
| 230–238 | beliefs | main |
| 240–246 | society | main |
| 250–253 | language-drift | main |
| 260–268 | disasters | main (269 locusts) |
| 270–279 | seat | main |
| 280–389 | riots, court, tech-tree, MIR, future-tech, future-politics, migration, infrastructure, character, scenarios, divine | reserved (§3.1) |
| 390–392 / 393–398 | barriers / cold war | reserved / main (coldwar merged, f20cb5f; 399 spare) |
| 400–404 | typology scripts | main (405–409 spare) |
| 410–419 | religious-evolution | reserved |
| 420–449 | shadow-network (449 SecretPassed) | reserved, **parked** |
| 450–459 | throne arcs (throne-stories-fiction's table 440–447 maps to 450–457) | reserved (Lane 3 may use) |
| 460–469 | shadow-network A16 (460–466) | reserved, **parked** |
| 470–478 | battles-fiction | reserved (479 spare) |

## Shared enums (code / reserved / next free)
| enum | in code (main + lanes) | reserved | next |
|---|---|---|---|
| OrderKind | 0–20, 22 (`ORDER_KIND_COUNT` 84; 21 Charter reserved) | 23–83 §3.2; 84 Brink; 85–117 and 126–134 shadow; **118–125 throne arcs**; 135–142 battles-fiction | 143 |
| DecisionKind | 0–17, 102–112 (n1 surfacing: the merged systems' cards) (`DECISION_KIND_COUNT` 113; 18–101 placeholder rows) | 18–54 §3.2; 55 Brink; 56–79 and 86–93 shadow; **80–85 throne arcs**; 94–101 battles-fiction | 113 |
| SeatOptionKey | 0–39, 160–166 (n1 surfacing), 167 DefyWithAlly and 168 KeepPaying (n3b) | **40–59 throne arcs** (were unassigned); 60–127 shadow; 128–159 battles-fiction | 169 |
| AmbitionKind | 0–5 | 6–15 character; 16–29 and **34–39** shadow (confirmed); **30–33 throne arcs** | 40 |
| SeatEnd | 0–3 | 4 LineEnded (character); 5 Broken, 6 Legitimate, 7 SecretDied, 8 WentOpen (shadow) | 9 |
| SeatKind | 0–4 | 5 Network (shadow) | 6 |
| ReignEnd | 0–8 | 9–15 §3.2; 16 Abdicated (throne arcs) | 17 |
| AccessionHow | 0–6 | 7–10 §3.2; 11 Restored (throne arcs) | 12 |
| GrievanceKind | 0–11 | 12–16 §3.2; 17 ProxyAid (coldwar, main); 18 Covert (shadow); 19 Abandoned, 20 Massacre (battles-fiction) | 21 |
| UnrestPart | 0–13, 22–26, **27 Shock (causal; was missing from §3.2)**, 28 Deference (`UNREST_PARTS` 32) | 14–21 riots and court; 29 Incited, 30 Purge, 31 Denounced (shadow) | full: the next part must raise `UNREST_PARTS` |
| RivalryPart | 0–14 (13 Secession, 14 Alarm: causal), 15 ColdWar (coldwar, main) | — | full (`RIVALRY_PARTS` 16) |
| DeferenceCause (`rulers/deference.ts`) | 0–6 | 7 Puppet, 8 Captured, 9 Scandal (shadow) | 10 |
| CommanderFate | 0–8 | 9 Murdered (shadow); 10 (battles-fiction) | 11 |
| BattleKind / BattleWeather | 0–5 / 0–4 | 6–7 / 5–6 (battles-fiction) | 8 / 7 |
| OrderRole | 0–7, 11 Decision, 12 Heir | 8–10 §3.2; 13–18 shadow | 19 |
| OrderReason | 0–28 | 29–31 and 33–38 §3.2; **32 is spare: character reuses 24 OutOfReach** (R4) | 39 |
| RevoltCause | 0–5, 7; 6 Burghers (lane/citystates) | 8–18 §3.2 | 19 |
| FamilyRuin | 0–5 | 6 Exposed (shadow) | 7 |
| LenderKind | 0–2 | 3 Person (character), 4 Network (shadow) | 5 |
| BondKind / BondEnd | 0–2, 3 Charter (lane/citystates) / 0–6 | 4–5 / — (§3.2) | 6 / 7 |
| WarMotive | 0–6 (6 Crisis) | — | 7 |

## HistoryOptions (§3.3 additions)
On main: `oaths`, `balance`, `arms`, `families`, `finance`, `society`, `beliefs`, `barriers`, `disasters`, `battles`,
`language`, `typology`, `causes`, `seat`, `coldWars`, `warRestraint` and **`preset`** (lane/setup; `src/sim/history/presets.ts`).
`preset` is `'off' | 'realistic' | 'dramatic'`, and the default is **realistic** (owner decision (b)). Realistic turns on
oaths, balance, arms, finance, beliefs, barriers, battles, society, and disasters with DX.feedback. Dramatic adds
families, coldWars, warRestraint, absentee and causes. Off turns them all off.

The URL link version is **`v=2`**. A link without `v` replays with preset off, so old links keep their history. G0 has two
identities: `G0_GOLDENS` for realistic and `G0_OFF_GOLDENS` for off (the 8cabf09 values). In lanes:
`governments` (citystates). `absentee` is on main (17ae06d).

## Plan collisions resolved (these supersede the plan text)
1. **Shadow-network "A16 framework" line** (EventType 454–456, OrderKind 121–126, DecisionKind 84–87, AmbitionKind 26–35) is
   **void**: it collided with the throne arcs. Only the renumbered A16 line holds (460–469, 126–134, 86–93, 24–29 and 34–39).
2. **throne-stories-fiction.md**: its EventType 440–447, DecisionKind 73–78, OrderKind 108+ and AmbitionKind 22–25 are void.
   The throne arcs use 450–459, 80–85, 118–125 and 30–33. Its "next free" notes are stale: SeatEnd next 6 and AmbitionKind
   next 22 are wrong, and this table holds the correct values. SeatOptionKey 40–59 is assigned to the throne arcs, because they
   had none.
3. **Shadow AmbitionKind 34–39** was marked "needs confirmation". It is confirmed, since 24–29 hold only 6 of its 12
   ambitions. The next free value is 40.
4. **OrderReason 32 OutOfReach** (character) duplicates the base `OrderReason.OutOfReach` = 24. Character reuses 24, and 32 is
   spare.
5. **UnrestPart 27 Shock** (causal-explorer, on main) was in code but in no registry. It is registered here.
6. The barriers addendum text "RivalryPart 13 ColdWar" was already corrected by the coordinator to **15**, which is the value
   coldwar uses on main.
