# Handoff: worldseed improvement programme

Start here if you are a new agent picking this up. Everything you need is in this folder (`docs/plans/` on branch `plans/roadmap` of `ryanmye/worldseed`, based on `main` @ 8cabf09).

## State (2026-11-26)
- **Planning is done; nothing is implemented.** The plans are design docs only. `main` is untouched.
- **Push access works** (tested by pushing this branch).
- Owner: Ryan (GitHub `ryanmye`). Style: terse and dense. He wants to be told when something is speculation, wants pushback on weak claims, and wants work split into small tasks run by parallel background agents after shared setup.

## Read first, in this order
1. `_CONVENTIONS.md`: shared rules. These cover determinism (a `HistoryOptions` switch per feature; off must be bit-identical), own RNG streams, the **enum/ID registry**, the **Citation rule**, and the **Integration rule**: extend existing systems before adding new ones. Addenda at the end of a plan override its body.
2. `README.md`: the plan index, build order, owner decisions, and the citation follow-up list.
3. `realism-metrics.md` and `perf-efficiency.md`: the measuring tools every later step must pass.

## Plans (24 written)
| Area | Plans |
|---|---|
| Foundation | perf-efficiency, realism-metrics |
| War & diplomacy | grudges-and-oaths, beliefs-and-deception, battles |
| States & politics | city-states, court-politics, modern-ideologies-regimes, future-politics |
| Economy | state-finances, merchant-families, infrastructure |
| Society | society-secular-cycles, riots-uprisings, language-drift, migration-borders, religious-evolution |
| World & tech | disasters-climate, tech-tree-innovation, future-tech |
| Player experience | seat-mode, character-mode, experience-whatif-director-sagas, causal-explorer, scenarios-challenges, world-builder-divine (builder + divine favour + saving) |

**Stopped before writing, no file exists:** city-renderer-eras, demography, environment, culture-soft-power. The owner stopped them. Ask him before redoing any. Other plans reference them as optional, with proxies and fallbacks.

## Next steps
1. **Master plan.** The owner asked for an integration agent running **Opus 5.5 at high effort** to write `MASTER-PLAN.md`. It should cover:
   - the architecture and the dependency graph between systems, plus the quantities they share;
   - phased milestones that produce something playable early;
   - reconciliation: contradictions, effects counted twice, runaway feedback loops (debt → revolt → debt…), duplicated subsystems, and inconsistent numbers (e.g. the phone speed factor: 3–5× in seat-mode vs 1.5–3× in perf);
   - a combined CPU, memory and phone budget;
   - one consolidated enum/ID registry table, replacing the incremental lines in `_CONVENTIONS.md`;
   - a decision log and a risk register.
   It points to the smaller plans rather than repeating them, and it writes any fixes back into the affected plans as addenda.
2. **Implementation**, after the master plan:
   - One branch per plan and one PR each. Never push to `main`, because GitHub Pages serves it.
   - Build order: perf + realism → grudges → finances → families → city-states → the rest → court-politics last.
   - Each PR must keep the golden hashes with its feature off (seed 1 `923881e7cd3fe59b`, 42 `3bac8db3dfd723b5`, 1234 `2bb9f72e9e99433d` at 2000 years; see perf-efficiency.md) and must not worsen the realism score by more than 0.03.
   - Before writing code, run `npm test`. Two `history.test.ts` failures were seen on a loaded machine and may just be timeouts; recheck on an idle machine first.
   - Pushing from a shallow clone: `git -c push.negotiate=true push -u origin BRANCH`.

## Owner decisions already made
- Stop the idle globe spin after about 45 s.
- "Differences, not effects" wording in what-if comparisons.
- Language drift is on only for new worlds.
- Merchant families may exist at non-mart towns, cadet lines keep the surname, ship glyphs are on.
- Court politics is built last.
- Walkable city and link multiplayer are dropped; world builder and divine favour are kept, and saving is added.
- An extra citation-verification pass isn't needed, but check an [unverified] source before it sets a real constant.

## Owner decisions still open
These are collected from the plans' "open questions" sections.
- A 3000-year "modern" preset vs faster tech pacing. Modern politics doesn't appear in a 2000-year run.
- S-curve adoption in all eras or only era 5+.
- Tokugawa-style bans on ideas a people already holds.
- Whether scribes resist printing.
- Tier for generalAI (speculative or near) and for uploads (speculative or fiction).
- Federation as a set of bonds or as one state.
- Whether bans can wipe an idea out worldwide.
- Daily challenge rollover at UTC midnight.
- A GitHub Issues leaderboard.
- Whether free nudges are allowed in Ranked.
- Archiving old engine builds, for saves and scenarios.
- Traits for starting peoples.
- Divine mode as the default.
- Builder edits mid-run.
- Embedding the History in exported files.
- Merchant-families cadet surnames are settled; ship glyphs are in.

## Local-only artefacts (not in the repo)
- Probe scripts and outputs live in the original cloud session's `/home/claude/scratch-*` folders and are not preserved.
- The realism harness scripts are included here under `realism-scripts/`, and the perf bench scripts under `perf-scripts/` (its `node_modules` is removed; run `npm i playwright` to use them).

Owner decision (2026-11-26): platform = web + PWA now; native Apple shell dropped for now (no Xcode available); C++/Rust/native rebuild deferred — revisit after perf phase 1 with real-iPhone profiling (port single hotspots to WASM only if profiling shows one).

Owner instruction (2026-11-27): run all phases 1–5 automatically; coordinator merges lanes to main directly (no PRs) once gates pass (G0, typecheck, build, lane tests, realism off@tol0 + on A/B, full suite at merge). Owner-only gates (device measurement, tone reviews, play-tests, regime frequency table) are recorded as pending and do NOT block automation; flag them in reports.
