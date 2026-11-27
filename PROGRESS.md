# Lane N3 — throne vertical slice ("Rule a kingdom") — journal
Worktree /home/claude/wsx-n3, branch lane/n3 (from origin/main dc5d9f0 + lane/onboard 2b17be6). Runs: /home/claude/runs/n3/.
Spec: plans/EVALUATION.md §4 Lane 3 + §1c; plans/ui-additions.md N3 items 3,3b,3c,3d,4,6,7,8 + old great power start.

## Steps
- [x] S0 setup: worktree, merge lane/onboard (landing conflict: preset pills + play paths; main.ts lazy seat chunk loads decisionCard too) — 77da84a
- [x] S1 watcher fixes (sim/history/seat): heir min age, crisis repeat/cause text, Crush real order (garrison), Opening as a state lever, Unify/Monument judged, per-decision HUD snapshot (hazards, meters) + heir roster
- [x] S2 card model: named heirs, stakes (likely effects + risk), "Because you…" callbacks, honest labels, defer wording
- [x] S3 seat dashboard (context panel 'seat'): HUD, hazards + Why, 50-y odds, heraldry/portraits, your-realm feed, drama strip, age milestones; hide Take this throne while seated
- [x] S4 succession message, reign summary + epithet + share link, marriage answers
- [x] S5 arcs (ui/story/arcs.ts: T1, T3, revenge war, bankruptcy war), director continuity + payoff guarantee, bots arcCompletion
- [x] S6 landing: Rule a kingdom → Dramatic; old great power start
- [ ] S7 phone layout
- [ ] S8 primer/personas/coverage; bots Realistic+Dramatic; screenshots; merge origin/main

## Current
S7 phone layout + S8 (G0 running: /home/claude/runs/n3/g0.log; tests: /home/claude/runs/n3/tests.log)
Curated seats: 61343 polity:0:700 (default), 7 polity:0:700 (Fowinlan, unification contest), 7 polity:1:995 (old great power).
Next: full bots on the 3 seats x Realistic/Dramatic into /home/claude/runs/n3/final/, screenshots into /home/claude/eval/n3/
(preview server: npx vite preview --port 5313; script /home/claude/eval/n3/shoot.mjs URL desktop|phone TAG NCARDS).

## Notes
- merged origin/main 39e8470 (onboard + primer v3) at fc6f744
- play-test #1 findings folded (keys exclusive, reason words, chronicle year dup, Arrange phrase hedged, grows-old by age, regency only for minors)
- Unify: share 0.6 + vassals count; Monument judged (LandmarkCompleted in realm)

## Next commands
(none running)
