# Lane N3c — patronage order "Commission a monument" — journal
Worktree /home/claude/wsx-n3c, branch lane/n3c (from origin/main 2fa2410). Runs: /home/claude/runs/n3c/.
Brief: plans/_LANE_BRIEF.md. Before = runs/n3b/r4 (main == n3b final code).

## Steps
- [x] S0 setup (worktree, node_modules symlink, journal)
- [x] S1 OrderKind 143 Commission (contract, registry, MASTER-PLAN addendum), orders/seatOrders give/pay/resolve, landmarks begin/pause/give up
- [x] S2 card: DecisionKind 113 Patronage + option key 169 Commission; stakes, callbacks, HUD feed; primer v8
- [ ] S3 personas v5 (greedy:Monument uses it) + metrics outcome reason
- [ ] S4 bots acceptance (3 seats x 2 presets x 13 runs) -> runs/n3c/r1
- [ ] S5 gates, merge origin/main, push

## Current
- r1 (runs/n3c/r1, personas v5, cool 30): Monument 5-6/13 per setup (too easy: randoms), realistic-oldpower2 others regressed (chaotic card-stream shift).
- v2 tuning (wip commit): cool 40, Patronage only in a year with no other card and does not set lastCard, war toll 0.2/yr (OrderReason 40 AtWar).
- q1 quick runs (random,greedy:5,--null 3): PERS=random,greedy:5 bash runs/n3c/run2.sh <preset> runs/n3c/q1 (resumable); summarize: python3 runs/n3c/summarize.py runs/n3b/r4 runs/n3c/q1
- then full acceptance r2: bash runs/n3c/run.sh <preset> runs/n3c/r2; update primer for v2 rules; merge origin/main; gates.

## Next commands
see Current
