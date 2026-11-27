# lane/ci-determinism PROGRESS
Goal: CI (ubuntu-26.04 x64, Node v25.9.0) G0 realistic seed 1 = 0e20763885721f5f vs local (Node v22.23.5 x64) 086a0ba67ed15ca6. Seeds 42/1234 and off pass on CI.
- [x] step 1: CI facts (above)
- [ ] step 2: bisect (try npx node@25 locally)
- [x] step 2: root found. Tracer (/home/claude/runs/ci/tools/tracer.mjs) diffed Node 22 vs Node 25.9.0 (npx node@25.9.0 reproduces CI's 0e20763885721f5f):
  first divergence = call #11 Math.pow(0.9, 4) in src/sim/history/polity/outlaw.ts:128 flushAccounts (pre-8cabf09 code!):
  node22 0.6561000000000001, node25 0.6561. Probe (tools/mathprobe.mjs, powcmp.mjs): ~9% of pow results differ by 1ulp between the two V8s, all exponent classes;
  exp/log/trig/hypot/cbrt identical on 200k samples. Node25 ~correctly rounded, node22 not.
- [ ] step 3/4: collect pow sites per seed/preset (tools/sites.mjs -> runs/ci/sites-*.jsonl), replace with +-*/ (repeated products), guard test.
- [x] presets fix written (src/bots/presets.ts uses sim/history/presets expandPreset), not yet tested
