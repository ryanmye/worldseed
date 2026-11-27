# worldseed improvement plans (base commit 8cabf09)

**Start with `MASTER-PLAN.md`**: architecture, cross-plan rulings, the consolidated enum/ID registry (§3), phased roadmap, budgets, decisions and risks. Its rulings and each plan's `## Addendum (master plan)` override plan bodies.
All plans are implementation-ready and self-contained. Shared rules: `_CONVENTIONS.md`.
Every plan must keep its feature behind a `HistoryOptions` switch (off = bit-identical) and pass the realism scorecard (`realism-metrics.md`, scripts in `realism-scripts/`) off vs on.

## Build order
| # | Plan | Depends on | Notes |
|---|------|-----------|-------|
| 0 | perf-efficiency.md | — | Idle spin, frame caps, saver preset, lane culling; checkpoint resume (P6) is the risky one. Golden hashes inside. |
| 0 | realism-metrics.md | — | Harness first, so every later step is measured. |
| 1 | grudges-and-oaths.md (rev 2) | — | Grievances, truces as oaths, betrayal, shadow of the future, balance of threat, arms races. |
| 2 | state-finances.md (rev 2) | grudges (optional) | Treasury, loans, defaults, bankruptcy wars, MV=PQ, Gresham, SFD. |
| 3 | merchant-families.md | finances (optional) | Named houses, branches, lending, bankruptcy. |
| 4 | city-states.md | finances, families (proxies) | Governments, charters, republics. |
| 5 | battles.md | — (grudges, beliefs optional) | Lanchester battles, commanders, replay. |
| 6 | beliefs-and-deception.md | grudges, finances, battles (proxies) | Fearon bargaining, spies, bluffs, secret alliances. |
| 7 | society-secular-cycles.md | finances (proxy) | Classes, wages/rents, elite overproduction, Ψ. |
| 8 | riots-uprisings.md | society, finances, city-states (proxies) | Escalation ladder, thresholds, contagion, tyranny, ideologies. |
| 9 | disasters-climate.md | — | Volcanoes, quakes/tsunamis, climate epochs. |
| 10 | language-drift.md | — | Language tree, sound change, exonyms. Changes all names when on. |
| 11 | seat-mode.md | perf P6 (for take-back) | Take a throne: decision cards → orders. |
| 12 | experience-whatif-director-sagas.md | director registry of all event types | What-if compare, story camera, partisan sagas. |

Owner decisions (2026-11-26): all resolved — see the "Owner decisions" section at the end of perf-efficiency, experience-whatif-director-sagas, language-drift and merchant-families. Politics inside a realm: court-politics.md (planned, built last).
Additional plans: court-politics.md, tech-tree-innovation.md, future-tech.md, character-mode.md, migration-borders.md, modern-ideologies-regimes.md, causal-explorer.md (written);, tech-tree-innovation.md, modern-ideologies-regimes.md, future-tech.md, future-politics.md, city-renderer-eras.md, migration-borders.md, infrastructure.md (in progress).

Dropped by owner (2026-11-26): walkable city view, async link multiplayer, prediction game is kept inside scenarios-challenges only if already planned there. Added: world-builder-divine.md (in progress).

## Citation follow-ups (run after all plan agents finish, when search budget is free)
- court-politics.md: 18 unverified (Barfield, Blaydes & Chaney, Bloch, Brewer, Centeno, Chehabi & Linz, Crone, Downing, Doyle, Elman, Fukuyama, Hui, Ibn Khaldun, Moore, Pipes, Strayer, Tilly 1975, Weber) + flagged Blaydes & Chaney "fifth to a quarter" figure.
- beliefs-and-deception.md: Reiter 1995; Fearon bargaining-range formula on-page.
- riots-uprisings.md: Weber 1922, Tocqueville 1856, Zipf 1949 (resumed).
- disasters-climate.md, language-drift.md, realism-metrics.md: audit blocked on a permission prompt.
- causal-explorer.md: all 14 refs unverified (search budget exhausted).
- character-mode.md: 5 refs unverified (Stark 1996, Greif 1989, Padgett & Ansell 1993, Gompertz 1825, Lanchester 1916).
- realism-metrics.md: 6 refs unverified (Arbesman 2011 re-check, Pew 2012, de Vries 1984, Gibrat 1931, Hill 1975, Taagepera). Corrected facts imply target bands should move: peak empire share 30–37% (script says 25–35%), Black Death 30–60% (script says 30–50%) — update realismStats.ts TARGETS at build time.
- disasters-climate.md: Miles et al. 2004 + several flagged anomaly figures unverified.
- Cross-plan inconsistency: phone speed factor 3–5× (seat-mode) vs 1.5–3× (perf) — settle in integration review.

Owner decision (2026-11-26): no extra verification pass; unverified citations are acceptable where the claim is plausible. Implementers should still check any [unverified] source before it sets a model constant.

Owner decision (2026-11-26): platform = web + PWA now; native Apple shell dropped for now (no Xcode available); C++/Rust/native rebuild deferred — revisit after perf phase 1 with real-iPhone profiling (port single hotspots to WASM only if profiling shows one).

Owner instruction (2026-11-27): run all phases 1–5 automatically; coordinator merges lanes to main directly (no PRs) once gates pass (G0, typecheck, build, lane tests, realism off@tol0 + on A/B, full suite at merge). Owner-only gates (device measurement, tone reviews, play-tests, regime frequency table) are recorded as pending and do NOT block automation; flag them in reports.
