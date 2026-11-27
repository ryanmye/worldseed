# lane/ci-determinism PROGRESS
Goal: CI (ubuntu-26.04 x64, Node v25.9.0) G0 realistic seed 1 = 0e20763885721f5f vs local (Node v22.23.5 x64) 086a0ba67ed15ca6. Seeds 42/1234 and off pass on CI.
- [x] step 1: CI facts (above)
- [ ] step 2: bisect (try npx node@25 locally)
- [x] step 2: root found. Tracer (/home/claude/runs/ci/tools/tracer.mjs) diffed Node 22 vs Node 25.9.0 (npx node@25.9.0 reproduces CI's 0e20763885721f5f):
  first divergence = call #11 Math.pow(0.9, 4) in src/sim/history/polity/outlaw.ts:128 flushAccounts (pre-8cabf09 code!):
  node22 0.6561000000000001, node25 0.6561. Probe (tools/mathprobe.mjs, powcmp.mjs): ~9% of pow results differ by 1ulp between the two V8s, all exponent classes;
  exp/log/trig/hypot/cbrt identical on 200k samples. Node25 ~correctly rounded, node22 not.
- [x] step 3: sites (runs/ci/sites-*.jsonl): every transcendental call on G0 paths (3 seeds x realistic/off) is Math.pow(0.9, years) in outlaw.ts flushAccounts.
  V8 12.4 source (runs/ci/v8src/v8-12.4/src/base/ieee754.cc): Node 22 Math.pow = V8's fdlibm port (one changed line: r = z*t1/((t1-2)-(w+z*w))); Node 25 = std::pow (--use-std-math-pow).
- [x] step 4: src/sim/detMath.ts powD = JS port of V8 12.4 pow: 0 mismatches vs Node 22 on 300k+80k inputs + specials. Used in outlaw.ts, lexicon.ts (2), species.ts (2 ** consts); drift.ts ** 2 -> products.
  Guard src/sim/detMath.test.ts (pins + hash recorded on Node 22; scan: no Math.pow / ** in src/sim replay path; other transcendentals frozen list (names/*, why.ts)). Passes on Node 22 and 25.
- [x] step 4b: G0 6/6 OK on Node 22 AND Node 25.9.0 (runs/ci/g0-node{22,25}.log; hashValue equal too). typecheck, build OK. detMath/coverage/presets/bots tests 20/20. realism:check -> runs/ci/realism-check.log
- [x] bots presets: resolveRun uses expandPreset from sim/history/presets.ts, names preset in options, url v=2; funHarness --preset dramatic smoke OK
- [ ] step 5: CI: temporary .github/workflows/lane-ci-determinism.yml (lane branch only, Node 22+25 matrix). Runs 46010327723 (fix) and 46011560727 (final). `gh run list --branch lane/ci-determinism` from inside /home/claude/wsx-ci. After green: delete the workflow file (final commit).
- [x] presets fix written (src/bots/presets.ts uses sim/history/presets expandPreset), not yet tested
