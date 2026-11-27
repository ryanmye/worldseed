# Implementation lane brief (shared by all phase-1+ agents)
- Repo: worldseed. Your worktree and branch are given in your prompt; it starts from `main` (phase 0 merged: scaffold with hashBase/G0, compose.ts stacks C1–C10, rulers/hazards.ts, reserved ORDER_KINDS/DecisionKind rows, hash01; PWA + src/platform; perf phase 1; realism harness + ratchet; story director in src/ui/story).
- Plans: /home/claude/plans/ (also in repo under docs/plans on branch plans/roadmap). Read MASTER-PLAN.md (§2 rulings, §3 registry, §4.1 your phase/lane, §4.2 gates, §8 handoff) and your plan INCLUDING all addenda at its end (addenda override the body; the master-plan addendum overrides earlier addenda). Also _CONVENTIONS.md.
- Other lanes run in parallel in other worktrees (/home/claude/ws1-*). Stay in your plan's files; if you must touch a shared hot file (war.ts, unrest.ts, contract.ts, main.ts, historyView.ts), keep edits small and localised. Use the compose.ts stacks for any multiplier on a shared draw — never add a raw multiplier.
- Gates for every commit you push:
  - G0: `node --experimental-strip-types scripts/g0.ts` prints OK for all 3 seeds (feature switch off by default).
  - `npm run typecheck`, `npm run build`.
  - Your new tests + the existing tests of files you touched: `npx vitest run <paths> --testTimeout=900000`. Do NOT run the whole suite (~30–40 min; the coordinator runs it at merge).
  - Realism: `npm run realism:check` with your feature OFF must pass at --tol 0; report an off-vs-on A/B with your feature ON (`--from`/`--vs` or OPTS) — on is allowed to fail only for keys listed as accepted trade-offs in your plan.
- The machine is a shared 2-vCPU VM running several lanes. Prefix EVERY heavy command (g0, vitest, realism, sims, probes, build) with `/home/claude/bin/simq` — a 2-slot CPU queue. Prefer 1–2 seeds for quick checks, 4 seeds for the final A/B.
- Ship the feature behind its HistoryOptions switch, default OFF.
- Commit in plan-step-sized commits; messages end with:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PmUGboHReUUDsswkNqo9Um
- Push your branch only: `git -c push.negotiate=true push -u origin <branch>`. Never push main; the coordinator merges.
- Report: steps done (plan#step), files, gate results, A/B numbers, deviations from the plan and why, anything another lane must know (new exports, interfaces).
