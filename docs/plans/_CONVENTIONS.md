# worldseed plan conventions (shared by all plan agents)
- Code: pristine read-only checkout /home/claude/ryanmye/worldseed (commit 8cabf09). Never edit it. To run anything: cp -r it to /home/claude/scratch-<yourname>, npm install there. Never touch /home/claude/worldseed or /home/claude/worldseed-perf.
- Plans are PLAN-ONLY, implementation-ready and self-contained for a later agent: current behaviour with file/function refs; design (contract.ts struct-of-arrays records with drafted doc comments in codebase style, EventTypes with settlement/other/value/extra semantics, params with defaults, rules as formulas); determinism (own named RNG stream, fixed draw order, HistoryOptions toggle so off-runs are bit-identical; golden-hash tests need filters); UI + Chronicle (hedged) / Legend (story) example lines; ordered commit-sized steps with files + tests; stats harness with targets on seeds 1, 7, 42, 1234; perf/memory estimate; risks/open questions; tag claims verified / measured / assumed.
- Existing plans (read the ones you touch; adopt their interface names or state amendments in an "Interfaces" section): grudges-and-oaths.md, state-finances.md, merchant-families.md, city-states.md, perf-efficiency.md (in progress).
- EventType id blocks, enum values, HistoryOptions switches and RNG streams: **MASTER-PLAN.md §3** (single source). Stay in your block; take "next free" values from there and edit §3 in the same PR.
- Build order assumed: grudges → finances → families → city-states → then new plans. Say which plans yours depends on, and provide proxy fallbacks when a dependency isn't built yet.
- Cite real models properly; say when a constant is a textbook approximation or contested.

## Enum value registry
Consolidated in **MASTER-PLAN.md §3** (EventType blocks §3.1, enums §3.2, HistoryOptions §3.3, RNG streams §3.4). The incremental registry lines that used to be here were folded into that table; where they disagreed with a plan body, the table and the plan's `## Addendum (master plan)` win (stale bodies listed in MASTER-PLAN §2.8). Addenda at the end of a plan override its body.

## Citation rule (owner requirement)
Every statistic, equation, model, constant and named concept must cite a real source: author(s), year, title, venue, and a DOI or stable URL. Verify each one with WebSearch/WebFetch (a fetched abstract or publisher page is enough); never cite from memory unverified. Tag each citation [verified] (you opened a page confirming it) or [unverified] (could not confirm — say why). Put inline cites as (Author Year) and a "References" section at the end of the plan. If a number can't be sourced, say it's a design default, not a fact.

## Integration rule (owner requirement)
Integrate into what exists before adding anything new: extend existing code systems, records, events, params and UI panels, and existing/other plans' interfaces, rather than creating parallel subsystems. A new record/system/panel needs a one-line justification of why no existing one can carry it. Prefer modulating existing draws/quantities over new mechanics; reuse other plans' quantities (Ψ, prestige, beliefs, treasury, grievances, ideas pressures) instead of re-deriving them.
- Ownership of shared quantities (one writer each) and the composition stacks for shared draws: MASTER-PLAN.md §1.4 and §2.3. Add a factor through `compose.ts`, never inline.
