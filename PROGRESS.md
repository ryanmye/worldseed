# lane/detmath2 PROGRESS
Goal: port every frozen transcendental call on the replay path (names/*, history/why.ts) to plain-JS ports in src/sim/detMath.ts,
bit-identical to V8 (Node 22 and 25); FROZEN list -> {}; cross-engine check; worker/parallel float-order audit.
Base: 2dc5ebf (lane/ci-determinism tip). Tools: /home/claude/runs/detmath2/tools (cmp.ts = bit-exactness vs Math.*).
- [x] step 1a: ports expD logD log2D sinD cosD acosD hypotD (V8 12.4 src/base/ieee754.cc fdlibm; hypot = builtins/math.tq MathHypot)
  cmp.ts: 0 mismatches, 1M inputs/fn (+edge cases; hypot 4M arg-lists) on Node 22.23.5 AND Node 25.9.0 (runs/detmath2/cmp-node{22,25}.json)
- [x] step 1b: call sites replaced (tools/replace.mjs): why.ts log2D; names/* logD expD cosD sinD acosD hypotD. G0 6/6 OK node22 (runs/detmath2/g0-node22.log)
  lang/dramatic identities seed 1 (realistic+lang1, +lang2, dramatic, dramatic+lang1, +lang2): hashBase AND hashValue identical base vs new (hashes-{base,new}.jsonl)
- [x] step 2: FROZEN -> {} + hash tests (tools/gen.mjs: Math.* hashes identical on 22 and 25); detMath.test 7/7 node22
- [ ] step 3: cross-engine (no WebKit/Firefox in /opt/pw-browsers (chromium only); installing bun (JSC) was denied by permission classifier -> owner check)
- [ ] step 4: worker/parallel audit
