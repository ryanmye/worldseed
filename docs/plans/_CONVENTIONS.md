# worldseed plan conventions (shared by all plan agents)
- Code: pristine read-only checkout /home/claude/ryanmye/worldseed (commit 8cabf09). Never edit it. To run anything: cp -r it to /home/claude/scratch-<yourname>, npm install there. Never touch /home/claude/worldseed or /home/claude/worldseed-perf.
- Plans are PLAN-ONLY, implementation-ready and self-contained for a later agent: current behaviour with file/function refs; design (contract.ts struct-of-arrays records with drafted doc comments in codebase style, EventTypes with settlement/other/value/extra semantics, params with defaults, rules as formulas); determinism (own named RNG stream, fixed draw order, HistoryOptions toggle so off-runs are bit-identical; golden-hash tests need filters); UI + Chronicle (hedged) / Legend (story) example lines; ordered commit-sized steps with files + tests; stats harness with targets on seeds 1, 7, 42, 1234; perf/memory estimate; risks/open questions; tag claims verified / measured / assumed.
- Existing plans (read the ones you touch; adopt their interface names or state amendments in an "Interfaces" section): grudges-and-oaths.md, state-finances.md, merchant-families.md, city-states.md, perf-efficiency.md (in progress).
- EventType id blocks: families 161–169, grudges 190–199, city-states 200–205, finances 210–219, battles 220–229, beliefs 230–239, society 240–249, language 250–259, disasters 260–269, seat/orders 270–279. Stay in your block.
- Build order assumed: grudges → finances → families → city-states → then new plans. Say which plans yours depends on, and provide proxy fallbacks when a dependency isn't built yet.
- Cite real models properly; say when a constant is a textbook approximation or contested.

## Enum value registry (resolved centrally; plans must follow)
- RevoltCause: 5 Taxes (state-finances), 6 Burghers (city-states, renumbered from 5), 7 Urban (society), 8–15 riots-uprisings (Tyranny, Conscription, Hunger/Policy, Persecution, Usurpation, Ideology, ...).
- GrievanceKind: 0–6 grudges, 7 CrownDefault (finances), 8–10 beliefs-and-deception, 11 GeneralTurned (battles), 12 KinAttacked (riots-uprisings).
- EventType blocks: as above; society uses 240–246.
- OrderKind (array-indexed, so contiguous small ints): 0–9 existing, 10–22 seat-mode, 23–29 reserved seat follow-ups, 30+ other plans (allocate in order: riots-uprisings policy orders start at 30).
- ReignEnd: 0–8 existing, 9 Revolution (riots-uprisings).
- OrderKind 30–32: Crackdown, Relief, Tolerate (riots-uprisings).
- RevoltCause 8–14 riots-uprisings, 15 reserved.
- DecisionKind (seat-mode decision cards): 0–17 seat-mode, 18–24 court-politics; next plans start at 25.
- court-politics: events 290–299, RevoltCause 16 (Estates), GrievanceKind 13 (Asylum), ReignEnd 10–11, OrderKind 33–38.
- Note: addenda at the end of a plan override its body (e.g. riots KinAttacked = 12, battles GeneralTurned = 11).

## Citation rule (owner requirement)
Every statistic, equation, model, constant and named concept must cite a real source: author(s), year, title, venue, and a DOI or stable URL. Verify each one with WebSearch/WebFetch (a fetched abstract or publisher page is enough); never cite from memory unverified. Tag each citation [verified] (you opened a page confirming it) or [unverified] (could not confirm — say why). Put inline cites as (Author Year) and a "References" section at the end of the plan. If a number can't be sourced, say it's a design default, not a fact.

## Integration rule (owner requirement)
Integrate into what exists before adding anything new: extend existing code systems, records, events, params and UI panels, and existing/other plans' interfaces, rather than creating parallel subsystems. A new record/system/panel needs a one-line justification of why no existing one can carry it. Prefer modulating existing draws/quantities over new mechanics; reuse other plans' quantities (Ψ, prestige, beliefs, treasury, grievances, ideas pressures) instead of re-deriving them.
- IdeaKind: 0–7 existing, 8 Industry, 9 Communication (tech-tree), 10 Ideology (modern-ideologies; future-politics reuses it), 11–15 future-tech.
- IdeaHow: 14 Hired (tech-tree; channel count 15), 15 Recovered (future-tech; count 16).
- Idea ids: currently stored as one byte; tech-tree takes the catalogue to 107; with ideologies + future-tech it may exceed 255 → tech-tree.md's first step must widen idea-id storage to Uint16 (contract + assemble + cache version bump).
- tech-tree: events 300–306 (307–309 reserved), OrderKind 39–40, DecisionKind 25–26, IdeaResist 3–4, IdeaLoss 3.
- Clash resolved: character-mode previously told to use OrderKind 39+/DecisionKind 25+ → character-mode moves to OrderKind 41+, DecisionKind 27+.
- future-tech: events 320–329, RevoltCause 17 Displaced, StructureType 6–11 (Airport, Spaceport, PowerStation, Arcology, Desalination, SkyTether) — other plans adding StructureTypes start at 12; ArmyEra 7–8.
- Ownership: infrastructure.md owns ALL networks incl. air/rocket/gate hubs (future-tech only unlocks + sets cost/speed); demography.md owns the demographic transition (future-tech's step-4 transition/damp defers to it, keeping only the settlement-founding damp if demography doesn't cover it).
- character-mode: events 360–369, OrderKind 41–58 (count 59), DecisionKind 27–44, SeatKind 4, AmbitionKind 6–15, SeatEnd 4, OrderRole 8, OrderReason 29–34, LenderKind 3, FamilyCause 3. Later plans: OrderKind 59+, DecisionKind 45+.
- migration-borders: events 340–348, OrderKind 59–61 (moved from 42–44, which character-mode holds), DecisionKind 45–46 (moved from 28–29), JourneyKind 5 Refugees, MovementKind Nativist (next free after modern-ideologies' kinds). Later plans: OrderKind 62+, DecisionKind 47+.
- RevoltCause 17 = Displaced (future-tech). future-politics uses 18+.
- modern-ideologies: events 310–319, IdeaKind 10, MovementKind 5, Government 7–11, GovernmentCause 13–22, ReignEnd 12–13, GrievanceKind 14, OrderKind 62–64 (moved from 41–43), DecisionKind 47–49 (moved from 27–29).
- future-politics: ReignEnd 14–15, GrievanceKind 15, OrderKind 65–67, DecisionKind 50–52, RevoltCause 18+, Government 12+, GovernmentCause 23+. Later plans: OrderKind 68+, DecisionKind 53+.
- Integration review: consolidate this registry into one table in MASTER-PLAN.md and make every plan's addendum agree.
- causal-explorer: new enums RivalryPart, UnrestPart (pre-allocates 11 finances, 12 city-states, 13 society, 14–20 riots, 21 court), WarWhyFlag, AbandonCause, CrisisBit, FamineFactor; HistoryOptions.causes; History.why. Plans adding rivalry/unrest terms add one recorder line next to the term.
- infrastructure: events 350–359, StructureType 12–20, GrievanceKind 16 Expropriated (moved from 14), OrderKind 68–70 (moved from 59–61), DecisionKind 53 (moved from 45). Later plans: OrderKind 71+, DecisionKind 54+, GrievanceKind 17+.
- world-builder-divine: events 380–385 (386–389 reserved), OrderKind 71–82 (12 divine kinds), OrderReason 35–38 (character holds 29–34), OrderRole 9 House, 10 Scope (character holds 8). Later plans: OrderKind 83+.
- future-politics (final): events 330–339 (331, 336, 338 unused), RevoltCause 18, GrievanceKind 15, ReignEnd 14–15, OrderKind 65–66 (67 spare), DecisionKind 50–51 (52 spare), Government 12–29, GovernmentCause 23–41, RegimeFamily 3–8.
- religious-evolution: events 410–417 (418–419 reserved), OrderKind 83 Council, DecisionKind 54 Doctrine; enums DoctrineAxis, SplitKind, FaithOrder, RevivalCause, FoundingKind; riots Movement.doctrine field. Later plans: OrderKind 84+, DecisionKind 55+.
