# lane/detmath2 PROGRESS
Goal: port every frozen transcendental call on the replay path (names/*, history/why.ts) to plain-JS ports in src/sim/detMath.ts,
bit-identical to V8 (Node 22 and 25); FROZEN list -> {}; cross-engine check; worker/parallel float-order audit.
Base: 2dc5ebf (lane/ci-determinism tip). Tools: /home/claude/runs/detmath2/tools (cmp.ts = bit-exactness vs Math.*).
- [x] step 1a: ports expD logD log2D sinD cosD acosD hypotD (V8 12.4 src/base/ieee754.cc fdlibm; hypot = builtins/math.tq MathHypot)
  cmp.ts: 0 mismatches, 1M inputs/fn (+edge cases; hypot 4M arg-lists) on Node 22.23.5 AND Node 25.9.0 (runs/detmath2/cmp-node{22,25}.json)
- [ ] step 1b: replace call sites; G0 unchanged
- [ ] step 2: FROZEN -> {}; pins/hash tests
- [ ] step 3: cross-engine (no WebKit/Firefox in /opt/pw-browsers; try bun = JavaScriptCore)
- [ ] step 4: worker/parallel audit
