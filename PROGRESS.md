# lane/detmath2 PROGRESS
Goal: port every frozen transcendental call on the replay path (names/*, history/why.ts) to plain-JS ports in src/sim/detMath.ts,
bit-identical to V8 (Node 22 and 25); FROZEN list -> {}; cross-engine check; worker/parallel float-order audit.
Base: 2dc5ebf (lane/ci-determinism tip). Tools: /home/claude/runs/detmath2/tools (cmp.ts = bit-exactness vs Math.*).
- [x] step 1a: ports expD logD log2D sinD cosD acosD hypotD (V8 12.4 src/base/ieee754.cc fdlibm; hypot = builtins/math.tq MathHypot)
  cmp.ts: 0 mismatches, 1M inputs/fn (+edge cases; hypot 4M arg-lists) on Node 22.23.5 AND Node 25.9.0 (runs/detmath2/cmp-node{22,25}.json)
- [x] step 1b: call sites replaced (tools/replace.mjs): why.ts log2D; names/* logD expD cosD sinD acosD hypotD. G0 6/6 OK node22 (runs/detmath2/g0-node22.log)
  lang/dramatic identities seed 1 (realistic+lang1, +lang2, dramatic, dramatic+lang1, +lang2): hashBase AND hashValue identical base vs new (hashes-{base,new}.jsonl)
- [x] step 2: FROZEN -> {} + hash tests (tools/gen.mjs: Math.* hashes identical on 22 and 25); detMath.test 7/7 node22
- [x] step 3: owner check: perf=1 shows NO hash -> added detcheck=1 (src/detcheck.ts worker + corner box in main.ts end). Verified in headless
  Chromium on vite preview (tools/detcheck_page.py -> runs/detmath2/detcheck-chromium.jsonl): seed 1 v=2 / +lang=1 / dramatic+lang=1 match Node.
  cross-engine (no WebKit/Firefox in /opt/pw-browsers (chromium only); installing bun (JSC) was denied by permission classifier -> owner check)
- [ ] step 4: worker/parallel audit
- touched tests: why.test + src/sim/names 9 files 62/62 (runs/detmath2/vitest-touched.log). origin/main already an ancestor (ci-determinism not yet on main).
- [x] CI GREEN run 46020779737: build (22) and build (25) success, 82/82 test files, build, G0 6/6 OK on both. Temporary workflow deleted (final commit).
- [x] G0 6/6 OK on local Node 25.9.0 too (hashValue equal); realism:check OK 0.371 -> 0.371
- [x] step 4: single worker, no split reductions; chunked createHistoryRun (50y simulateTo, extensions 500->1200->2000) == simulateHistory (runs/detmath2/chunked.jsonl)

LANE COMPLETE. No golden changes.
