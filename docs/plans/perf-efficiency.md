# worldseed: performance and power-efficiency plan

Status: **measured, not implemented.** Base commit `8cabf09` (branch `perf-audit`, worktree
`/home/claude/worldseed-perf`, left clean). Every script referred to below is in
`/home/claude/plans/perf-scripts/` and imports the worktree's `src/` by absolute path. If you run
them against another checkout, change the `/home/claude/worldseed-perf/src/` prefix.

Labels used throughout:
- **[M]** measured here (scripts in `/home/claude/plans/perf-scripts/`, named per row; see the
  appendix and "Measured here" under References).
- **[M*]** measured, but the absolute number is unreliable. Either the software GPU (SwiftShader)
  or CPU contention distorts it (see §1.4). The ratios and counts still hold.
- **[C]** derived from reading the code. The result is exact under the stated assumptions but was
  not observed running.
- **[G]** a guess or estimate. It needs a real-device measurement.

---

## 0. Summary

1. **The idle page is already efficient [M].** With paused playback and no spin, the page draws
   0 frames in 10 s and Chrome uses 0.14 CPU-s in total. A hidden tab also draws 0 frames
   (0.15 CPU-s), as expected: most browsers pause `requestAnimationFrame` in background tabs
   (MDN 2026e). `main.ts` already has a careful on-demand loop (`invalidate.ts`, frame-rate caps
   per reason, motion resolution, setTimeout for slow ambient frames). Rewriting the render loop
   would not help.
2. **The battery goes when something moves, and on desktop something moves by default
   forever [C+M\*].** Every shared link opens with the globe auto-rotating (`spin`, default on). On
   touch devices the spin stops after 8 s (`TOUCH_TURN_SECONDS`). **On desktop and laptop it never
   stops** until the user drags. The spin redraws the full scene at `ambientFps`: 30 fps on
   Balanced and 60 on High at a normal window height [C]. Each frame draws ~560k triangles and
   ~24 draw calls, with ~15 transparent full-globe overlay layers, the atmosphere ray-march and a
   full-window 2D label canvas. The initial history animation adds `playFps` = 30 on
   Balanced/Phone.
3. **The sim is a one-off burst, not a continuous cost [M].** A fresh 2000-year history takes
   4.9–7.3 s of one core in Node (best of runs on a contended VM). The worker sleeps afterwards.
   A nudge (order) re-simulates from year 0 (5.6–7.1 s). Years 0–1000 are only 32–43% of the cost,
   because the cost per year grows with the world. Resuming from a checkpoint is feasible: the
   sim state is cloneable except for 13 RNG closures. It is also the biggest interactive CPU win
   for nudging, but it is high-risk work (§3, P6).
4. **Memory [M].** The History is 34–39 MB of typed arrays per 2000 years. The scene keeps
   73.5 MB of CPU-side geometry arrays, and their GPU copies come on top. The surface and cloud
   bakes take 128 MB of GPU texture at Balanced. The renderer process RSS is 680 MB (main thread +
   worker). The worker also keeps 30–41 MB of live sim state for extensions. A cache write costs
   ~1.1 s of worker CPU (213 ms copy + 890 ms gzip, 34 MB → 2.85 MB).
5. **Top recommendations, by payoff/risk:**
   - (P1) Stop the idle auto-rotation on desktop too, and honour `prefers-reduced-motion`.
   - (P2) Cap playback fps lower on Phone/Low, and in a saver mode.
   - (P3) An opt-in Battery-saver quality preset in the existing `S` panel.
   - (P4) Draw only the long-haul legs and outlaw lanes that exist at the shown year. The legs
     ribbon alone is 243k triangles, 43% of all triangles, drawn every frame.
   - (P5) Free the CPU copies of static geometry after upload.
   - (P6) Resume nudges from a checkpoint.

   Sim micro-optimisation is low priority: the profile is flat, it is a one-off cost, and every
   change risks determinism.

---

## 1. Baseline measurements

### 1.1 Simulation (Node 22, `--experimental-strip-types`, 2-vCPU VM)

Scripts: `bench-sim.ts` (world + history time, hash, History byte breakdown, re-sim) and
`bench-nudge.ts` (time per 250-year chunk, assembly, nudge re-sim).

| seed | world gen | history 2000 y (best run) | history (contended runs) | assemble History | nudge @1000 re-sim from 0 | share of sim time in years 0–1000 | History bytes | hash (`hashValue`, 2000 y, default options) |
|---|---|---|---|---|---|---|---|---|
| 1 | 494 ms | 7.28 s | 12.4–28.5 s | 282 ms | 5.62 s | 32% | 35.50 MB | `923881e7cd3fe59b` |
| 42 | 460 ms | 4.92 s | 12.8–28.1 s | 335 ms | 7.06 s | 30% | 35.00 MB | `3bac8db3dfd723b5` |
| 1234 | 462 ms | 5.76 s | 9.9–35.7 s | 209 ms | 5.61 s | 43% | 39.47 MB | `2bb9f72e9e99433d` |

- **[M]** The hashes were identical across ≥3 separate processes per seed. Use them as the
  determinism baseline: `BENCH_ONLY=hash node --experimental-strip-types bench-sim.ts 2000 1 42 1234`.
- **[M]** Time per 250-year chunk, seed 42, least-contended run, in ms:
  `264, 811, 1586, 1126, 1374, 2052, 2481, 3085`. The cost per year grows about 10× from the
  first chunk to the last. Seed 1: `264, 817, 1848, 1029, 1564, 2094, 1971, 2803`. Seed 1234:
  `293, 1048, 1686, 1266, 818, 1122, 1804, 1990`.
- **[M\*]** The worker comment says a 2000-year run takes "about 3 s". On this VM it took 5–7 s
  at best. In headless Chrome, with the SwiftShader GPU process fighting for the same 2 cores, it
  took 53–87 s. That figure is unusable; it is reported only to show how badly GPU emulation
  starves the worker.

**CPU profile** (`node --cpu-prof`, 3 seeds × (world + history + re-sim), 110 s sampled;
`prof-top.mjs prof/*.cpuprofile`). Self time:

| % | function | file |
|---|---|---|
| 11.2 | `foodSystem` | src/sim/history/population.ts:50 |
| 6.7 | `siteSearch` | src/sim/history/migration.ts:210 |
| 6.1 | `tradeSystem` | src/sim/history/trade.ts:778 |
| 3.5 | GC | – |
| 2.7 | `degradationSystem` | src/sim/history/land.ts:64 |
| 2.0 | `step` | src/sim/history/index.ts:525 |
| 1.9 | `hvPair` | src/sim/history/goods/market.ts:330 |
| 1.7 | `rebuildLinks` | src/sim/history/trade.ts:340 |
| 1.6 | `mapPass` | src/sim/history/polity/territory.ts:116 |
| 1.5 | `goodsStock` | goods/market.ts:125 |
| 1.4 each | `spreadAt`, `landUseSystem`, `cropOf` | species.ts, land.ts |
| ≤1.3 each | long tail of ~40 systems | – |

By file: trade.ts 11.7%, population.ts 11.5%, migration.ts 8.2%, species.ts 6.2%,
goods/market.ts 5.1%, land.ts 4.1%, index.ts 4.0%. The rest is ≤3% each. **The profile is flat.**
`foodSystem` is already a tight typed-array loop. Its claim pass and supply pass walk every
living settlement's catchment every year.

### 1.2 Memory and data size

| item | size | label |
|---|---|---|
| History, 2000 y (seeds 1/42/1234) | 35.5 / 35.0 / 39.5 MB | [M] |
| — top fields (seed 42) | `landUse`, `degradation`, `road`, `crop`, `herd`, `cash`: 2.33 MB each (Uint8, 101 land snapshots × 23,042 cells, **dense over all cells, 67% of which are ocean** by elevation ≥ 0). `population`, `food`, `wealth`, `merchantWealth`: 1.9 MB each (Float32, 401 snapshots × every settlement ever, zeros before founding and after abandonment). `territory` 1.54, `priceIndex` 1.19, `longHaulVolume` 1.06, `polity` 0.95, `claimed` 0.77 MB | [M] |
| World (sub 48, 23,042 cells) | 2.03 MB | [M] |
| History typed arrays on the main thread (seed 42) | 34 MB | [M] |
| Scene geometry CPU-side arrays (main thread) | **73.5 MB**. Largest: globe mesh 22.5, long-haul legs 15.7, two 6.8 MB meshes, trade 3.2, town ground 2.8, contraband routes 2.8, ideas links 2.7, roads 2.0 | [M] (`memory-page.mjs`) |
| Bake textures (surface + clouds), Balanced | 128 MB GPU (perf readout "bake tex") | [M] |
| Renderer process RSS (main + worker), idle after load | 680 MB | [M\*] (Chrome build/flags) |
| GPU process RSS | 626 MB | [M\*] (SwiftShader keeps textures in RAM) |
| Main-thread JS heap used | 17–27 MB (typed-array backing stores not included) | [M] |
| Worker live sim state at year 300 / 1000 / 2000 (excl. terrain) | 28.6 / 32.4 / 40.9 MB; `s.sp` (species) alone 18.6–21.8 MB | [M] (`fork-probe3.ts`) |
| Cache write of one 2000-y History | snapshot copy 213 ms + gzip (Deutsch 1996) 890 ms worker CPU; 34 MB raw → 2.85 MB stored | [M] (`cache-cost.ts`) |
| Worker→main transfer | the large arrays are transferred, not copied (worker.ts `simulateAndPost`; a transferred ArrayBuffer is moved zero-copy and detached in the sender, MDN 2026c); the world is structured-cloned (~2 MB, ~1 ms per worker comment) | [C] |
| Per-frame JS allocation during playback | **0.29 MB sampled in 10 s**: effectively garbage-free | [M] (`profile-playback.mjs`, HeapProfiler sampling) |

Main-thread staging of an arriving History: 2238 ms in 20 tasks, longest 543 ms. By part (ms):
goods 542, commit 365, polities 336, index 254, species data 154, population 148, roads 94,
compileWait 89, journeys 80, trade 60, peoples 46, expeditions 44. **[M\*]** These were taken at
load average ~50 on a 2-vCPU VM. A second, even more contended run gave 7317 ms with a longest
task of 1658 ms. Trust the split, not the totals.

### 1.3 Rendering (headless Chrome 1280×800 @1x unless noted; `bench-render.mjs`)

Each window is 10 s, measured 3 s after the history and the bakes are ready.

| scenario (URL) | frames drawn / 10 s | Chrome CPU-s / 10 s (all processes) | main-thread JS per drawn frame (ms: tick / three.js render submit / whole frame callback) | vertex upload per frame |
|---|---|---|---|---|
| idle (`play=0&spin=0`) | **0** | **0.14** | – | – |
| hidden tab (default link) | **0** | 0.15 | – | – |
| phone idle (iPhone 13 emu, `quality=phone`) | **0** | 0.20 | – | – |
| paused + spin (`play=0`) | 28 (GPU-bound; code cap 30 fps → 300) | 8.0 | 0.36 / 6.5 / 8.2 | 0 |
| paused + spin, small viewport 360×240 | 57 (cap ≈ 11.6 fps → 116) | 6.5 | 0.43 / 1.9 / 2.8 | 0 |
| High, paused + spin, small viewport | 62 | 7.4 | 0.36 / 1.8 / 2.7 | 0 |
| High, paused, **no spin** (cloud drift only), small viewport | **20** | 2.65 | 0.29 / 9.5 / 10.1 | 0 |
| default link (spin + playback) | 36 (GPU-bound; cap 30 → 300) | 11.8 | 1.46 / 4.8 / 7.4 | 234 KB |
| default link, small viewport | 95 | 10.9 | 1.38 / 3.4 / 5.6 | 231 KB |
| playback, no spin, small viewport | 107 | 10.8 | 1.16 / 2.7 / 4.3 | 234 KB |
| flat map, playback, small viewport | 107 | 10.8 | 0.95 / 2.5 / 4.0 | 229 KB |
| phone emu, default link (`quality=phone`, 390×844 @3x → pr 0.5 in motion) | 111 (small viewport) / 76 (full) | 11.3 | 1.55 / 2.6 / 4.9 | 218 KB |
| start page (`intro=1`), 1280×800 | 27 | 12.1 | – / 3.7 / 6.2 (+ bake 1.4) | 0 |

- **[M\*] The frame counts while moving are all limited by SwiftShader.** About 100–300 ms per
  frame for 560k triangles. They are far below the caps the code sets. The caps themselves are
  exact [C]:
  - Balanced: `interactFps` 60, `playFps` 30, `ambientFps` ≤ 30.
  - Phone: 60 / 30 / 20.
  - Low: 45 / 20 / 15.
  - High: ∞ / 60 / 60.
  - Spin `ambientFps` = min(cap, 0.05 rad/s × px-per-unit / 0.6). That is ≈ 43 fps at
    900 px height and distance 3.25, so the cap applies.
- **[M]** Idle and hidden-tab zero-frame results are reliable. So are the JS ms per frame on this
  CPU (a phone CPU is probably 1.5–3× slower [G]) and the allocation figures.
- **[M]** Scene census during playback: 560k triangles in 24–26 draw calls. Visible primitives
  by object:

  | object | primitives |
  |---|---|
  | long-haul legs (transparent) | **243,456** |
  | globe | 46,080 |
  | polity territory (transparent) | 46,080 |
  | trade (transparent) | 45,860 |
  | contraband routes (transparent) | 42,520 |
  | preyed-upon lanes (transparent) | 42,520 |
  | transparent mesh | 38,080 |
  | roads | 30,896 |
  | transparent mesh | 12,096 |
  | stars (points) | 3,200 |

  Most are transparent ribbons laid over the globe: overdraw, plus a blend pass per layer.
- **[M]** Vertex re-uploads during playback, in KB per drawn frame: lane ships and highlights
  (long-haul) 27.3, polities mesh 17.4, outlaw marks 8.4, a group mesh 5.6, goods marks 4.9. The
  trace's `upKB` (all `bufferSubData` and `texSubImage`) totals ~230 KB per frame, so ~7 MB/s at
  30 fps.
- **[M]** The main-thread CPU profile during playback is ~95% "(program)", meaning native code
  waiting on the GL command buffer (SwiftShader) [M\*]. JS itself is ~4–5% of the main thread.
  Inside the frame, JS costs ~1–1.5 ms in `historyView.tick` and 2–5 ms in three.js render
  submission.

### 1.4 Why some numbers are unreliable
- **GPU:** headless Chrome with SwiftShader (CPU rasterisation). Every GPU time, every frame
  count while moving, "Chrome CPU-s" while moving (it is mostly the GPU process rasterising) and
  the bake times (24–26 s here) are meaningless as absolute values. What they do show: anything
  that draws continuously costs real work, and idle costs nothing.
- **CPU contention:** a 2-vCPU VM shared with another agent running vitest continuously (load
  average 2–50 during the runs). Sim times vary up to 5×. Use the best runs, and re-measure on
  the owner's machine.
- **No real phone or iPad:** device classes were emulated (Playwright "iPhone 13" with
  `quality=phone`). Not measured: Safari/WebKit behaviour (timer queries, `deviceMemory`,
  `getBattery`), thermal throttling, real battery draw. Documented, not measured: Safari ships none
  of `EXT_disjoint_timer_query`, `navigator.deviceMemory` or `navigator.getBattery` (MDN BCD 2026).

---

## 2. Where the cost goes

### 2.1 CPU: simulation (worker)
- `src/worker.ts`: `generate` → `historyOf` → `simulateAndPost`. Each run is followed by
  `snapshot(history)` and a gzip `cacheWrite` (~1.1 s of worker CPU).
- `src/sim/history/index.ts` `createRunner`: `step(year)` calls ~40 systems every year. The
  snapshots run at intervals of 5 (settlements), 20 (land) and 10 (trade) years. `assemble` takes
  0.2–0.75 s and runs on every `advanceTo`.
- **Nudges:** `worker.ts reorder()` sets `run: null`, so `simulate()` calls
  `createHistoryRun(world, options)` and re-runs years 0..`years`. For a 6000-year history that is
  the whole 6000 years [C]. The cost grows superlinearly with years, because later years cost more.
- **Auto-extension:** `ui/timeline.ts` calls `onWantMore` when playback nears the end and
  `more === More.Yes`. That simulates the next 500 years plus a full assemble, transfer and cache
  write of the whole longer history. Each extension re-writes the whole history to the cache:
  O(n²) bytes over a long session [C]. I could not confirm whether the initial 0→2000 intro
  animation triggers a 2500-year prefetch (`intro-prefetch.mjs` was inconclusive within 200 s
  under contention). **Open question Q1.**

### 2.2 GPU and main thread: rendering
- `src/main.ts` render loop (lines ~1104–1612): on demand, with caps per reason. This is solid
  and should not be rewritten.
  - **Never-ending desktop spin:** `spinning = showLanding || spin != 0` (main.ts:184). Only touch
    devices stop it, after `TOUCH_TURN_SECONDS = 8` (main.ts ~1563). On desktop it runs at
    `ambientFps()` (≈30 fps Balanced, 60 High) until a drag, map mode and the like.
  - **High quality with spin off still draws:** `cloudsAnimate: 'always'` (`cloudsDriveFrames`)
    keeps cloud-drift frames going. Measured: **20 frames in 10 s** at 360×240 (`high_idle`,
    `play=0&spin=0&quality=high`; 2.65 Chrome CPU-s against 0.14 on Balanced) [M]. The formula
    gives ≈3–4 fps at a 900 px window [C]. That is acceptable for an explicit High choice, but
    Saver and reduced motion must use `'never'`.
  - **Playback** at `playFps` (30 Balanced/Phone) for the whole intro (2000 y at 20 y/s ≈ 100 s)
    and for any later play.
  - **Every drawn frame draws everything:** 560k triangles; ~15 transparent overlay ribbons over
    the globe; atmosphere ray-march (`atmosphereSteps` 12, or 8 on Phone/Low); clouds; stars; the
    full-window 2D labels canvas (`render/labels.ts`, redrawn when the camera or year changes);
    CSS `backdrop-filter` panels on Balanced/High (`panelBlur`, recomposited each frame [unverified:
    browser compositor behaviour, assumed, not measured here]).
- **Long-haul legs** (`src/render/longhaul.ts`, the "Lines" ribbon): one geometry holding every
  leg that will ever exist, 243k triangles and 15.7 MB. All of it goes through the vertex shader
  on every frame, and the shader hides legs that do not exist yet. The same pattern holds for
  `contraband routes` and `preyed-upon lanes` (src/render/outlaws.ts, 42.5k each) and trade
  (`src/render/trade.ts`, 45.9k).
- **Per-frame uploads during playback** (~230 KB per frame): long-haul ships and highlights
  (dynamic instanced marks), polities (`src/render/polities.ts`, 9 `needsUpdate` sites), outlaw
  marks.
- **Main thread:** ~4–6 ms JS per drawn frame on this CPU [M]. No measurable per-frame garbage.
  The staging spike when a History arrives (§1.2) is a separate jank risk on phones.

### 2.3 Memory, transfer, cache
- **History:** about 14 MB of six dense Uint8 land arrays, about two thirds of it ocean zeros
  (≈9 MB) [M+C]. About 8 MB of four dense Float32 settlement arrays, which include rows for
  not-yet-founded settlements [C]. All the large fields are read by the UI (grep of
  `src/ui`/`src/render`), so nothing is dead data.
- **Scene geometry:** 73.5 MB of CPU-side copies kept after upload (three.js keeps `array` unless
  told otherwise), plus the same on the GPU.
- **Bakes:** 128 MB at Balanced (`bakeSize` 1024, `cloudBakeSize` 1024 cube maps). Phone uses
  768/768, about 72 MB [G: scaling as size²].
- **Worker:** kept world + run (30–41 MB) + transient `snapshot()` copy for the cache (34 MB) +
  gzip buffers.

---

## 3. Proposed changes (ranked by payoff ÷ (risk × effort))

None of P1–P5 touches `src/sim/**`, `src/contract.ts` or `src/sim/history/polity/*`, so the
History hashes must not change. Still run the determinism check after each change.

### P1. Stop the idle auto-rotation everywhere; honour reduced motion
- **Files:** `src/main.ts` (frameBody, near `TOUCH_TURN_SECONDS`; the `spinning` initialiser at
  line ~184; the start-page block).
- **Approach:**
  - Generalise the touch-only cut-off to every device. Example: `IDLE_TURN_SECONDS = 45` on
    desktop (a design default), keep 8 s on touch. Reset `turnSeconds` on any input, and ease the speed down over
    ~2 s rather than stopping dead (multiply `SPIN_SPEED` by a factor that decays).
  - Treat an explicit `spin=1` in the URL as "always", so recordings still work.
  - With `matchMedia('(prefers-reduced-motion: reduce)')` (the user's OS reduced-motion setting;
    Baseline in all browsers since January 2020, MDN 2026a): no spin, and `cloudsAnimate`
    effectively `'never'`.
  - Optionally restart the turn when the tab becomes visible again and the user has not yet
    interacted.
- **Expected gain:** a laptop left on a worldseed tab goes from ~30 fps of full-scene drawing
  forever (60 fps on High) to 0 fps after 45 s. That is the single biggest steady-state power
  saving [C for frames; device power G]. My guess is 5–15 W less package power on a laptop dGPU
  or iGPU at 1.5× DPR (`devicePixelRatio`, physical px per CSS px, MDN 2026b), and fans going
  quiet. The wattage is an unsourced guess, not a fact.
- **Risk:** low. It changes behaviour, though: the owner may like the endless turn. **Q2.**
- **Verify:**
  - `SMALL=1 node bench-render.mjs paused_spin` with `WINDOW_MS=60000`, after a 50 s settle (add
    a scenario). `framesDrawn` in the last 10 s should be 0.
  - Unit-test the decay if it is factored into a pure function.
  - The determinism hash is unaffected (render only).
- **On device:** open the default link on a MacBook and leave it 2 min. Watch Activity Monitor
  "Energy Impact" (a relative measure of energy use, Apple 2026a) and GPU History, before and
  after. Do the same on an iPad with Safari Web Inspector → Timelines tab → **Frames** view
  (current Web Inspector names it "Frames", not "Rendering Frames"; WebKit 2026a).

### P2. Lower playback frame rate where it is not needed
- **Files:** `src/render/quality.ts` (`playFps`).
- **Approach:**
  - Phone `playFps` 30 → 24 (or 20), and Low 20 → 15. Balanced stays at 30.
  - At ≥4× speed, layers already damp their effects (`fx` in historyView.tick). Optionally drop
    to `min(playFps, 20)` at 16×, where per-frame change is mostly noise.
  - Do not touch the interpolation: layers interpolate between snapshots (`pos.frac`), so lower
    fps still shows continuous motion.
- **Expected gain:** GPU work during playback scales with fps. 30 → 24 is −20% and 30 → 20 is
  −33% of playback GPU time on phones [C]. That covers the intro's 100 s and every later play.
- **Risk:** low (visual smoothness). Judge on a real phone.
- **Verify:** the trace's `drawn` count per 10 s with a small viewport equals the cap [M on a
  real GPU]. Confirm the hash is unchanged.

### P3. Battery-saver quality preset (opt-in, plus automatic hints)
See §5 for the design. Payoff: everything above at once, plus a lower DPR and cheaper shaders.
Risk: low, as an extra entry in an existing table. Effort: small.

### P4. Draw only the lanes and routes that exist at the shown year
- **Files:**
  - `src/render/longhaul.ts` (Lines ribbon build, ~line 650–702; `lines.visible` at 702 and 1061)
  - `src/render/outlaws.ts` (contraband routes, preyed-upon lanes)
  - `src/render/trade.ts` (route ribbon)
  - possibly `src/render/routeCurves.ts` (sample ordering)
- **Approach:**
  - When building the ribbon, order the legs or routes by the year they first appear (the open
    year, or first non-zero volume). Keep `startIndex[k]` per leg.
  - In `setTime(year)`, find the number of legs opened by `year` with a binary search, and set
    `geometry.setDrawRange(0, indexEnd)`.
  - Set `mesh.visible = false` when no leg is live. For outlaw layers, that means no contraband
    or preying in the current trade-snapshot pair; an occupancy count per snapshot can be built
    once at staging.
  - Keep the shader's own per-leg year test for fades.
  - Bundled network curves (one curve shared by several legs) have to be ordered by the earliest
    leg that uses them.
- **Expected gain:** fewer vertices per frame early in the history. Legs open over time, so in
  the first centuries most of the 243k triangles are skipped [G: depends on the opening-year
  distribution; measure the fraction per year from `h.longHaul`]. Hidden outlaw layers save
  85k triangles and two blend passes. Apple GPUs are tile-based deferred renderers: they process
  all the geometry of a render pass and sort it into tiles before fragment shading (Apple 2026b)
  [verified], so invisible but submitted triangles still cost vertex and binning work. How much
  that costs here is [G].
- **Risk:** low–medium. Reordering primitives can change how overlapping transparent ribbons
  blend; check visually at several years.
- **Verify:**
  - `profile-playback.mjs` census: the legs' primitive count should follow the year.
  - Screenshots at years 200/1000/2000 before and after (Playwright `page.screenshot` with
    `play=0&year=…&spin=0`; compare with an image diff, tolerance for blending).
  - Confirm the hash is unchanged.

### P5. Free the CPU copies of static geometry after GPU upload
- **Files:**
  - `src/render/globe.ts` (22.5 MB globe mesh)
  - `src/render/longhaul.ts` (15.7 MB)
  - the two 6.8 MB meshes (identify with `memory-page.mjs`: names "Mesh<Group<Group"; give them
    `.name`s first)
  - `src/render/trade.ts`, `src/render/roads.ts`, `src/render/outlaws.ts`, `src/render/ideas.ts`
- **Approach:**
  - For attributes that are never read or updated on the CPU after the build, use
    `attr.onUpload(function () { this.array = null })`, the three.js idiom. The docs say
    `onUpload` exists for "clean-up operations after the upload when attribute data are not
    needed anymore on the CPU side" (three.js 2026). The `this.array = null` body itself is a
    community idiom, not in the docs. An alternative is to keep only the indices needed for
    picking.
  - First grep every reader of each attribute: picking in `ui/pointer.ts`, `historyView.pickAt`,
    the `mapProjection.ts` seam copies (`syncSeamCopies`), `addUpdateRange` users, and the dispose
    and rebuild paths. Those must not run on a freed array.
- **Expected gain:** 30–50 MB less JS-side memory on the main thread [G: 73.5 MB total, minus the
  dynamic or picked ones]. That matters for iOS Safari's per-tab memory limit (iOS terminates a
  WebContent process that runs out of memory, WebKit 2024; Apple publishes no limit value, so the
  headroom is unknown, see Q4); it does not save power.
- **Risk:** medium. A later code path reading `array` would crash, and context-loss recovery
  needs the arrays. After `webglcontextrestored` every buffer and texture is invalid and must be
  recreated (Khronos 2024) [verified]; that three.js re-uploads from `array` is [unverified: not
  checked in three's source]. Either rebuild
  the layer on context restore or skip this item.
- **Verify:** `memory-page.mjs` `sceneGeometryMB`. Then a 5-minute soak: play, scrub, switch the
  map and views, fly into a city. No errors in the console.

### P6. Resume a nudge from a checkpoint instead of year 0 (the CPU win for interaction)
- **Measured premise [M]:** a run with an order at year 600 matched the run without orders on
  the core arrays at year 599 (`fork-probe.ts`). The `HistoryState`, trade and tech states
  structured-clone fine except for **13 RNG objects** (`createRng`/`sfc32` closures; sfc32 is
  Doty-Humphrey's Small Fast Counting generator from PractRand, Doty-Humphrey n.d.; closures
  cannot be structured-cloned, MDN 2026f):
  - `s.sp.rng`, `s.sp.v2.rngHazard`, `s.sp.v2.rngTech`
  - `s.rngMigration`, `s.rngStructures`
  - `s.pol.rng`, `s.pol.rngWar`
  - `s.goods.rng`, `s.dz.rng`, `s.rul.rng`, `s.rel.rng`, `s.tz.rng`, `s.ideas.rng`

  No other functions are reachable from `s` (`fork-probe2.ts`).
- **What else must be in the checkpoint [C]:** the locals of `createRunner` (src/sim/history/index.ts):
  - `weather` (has its own RNG), `voyages`, `explore`, `techState`, `trade`, `polSnaps`, `rn`,
    `lm`, `ox`, `search`, `portSearch`, `scratch`, `featureMapCache`, `cradles`
  - the snapshot buffers and counters: `snapPop`, `snapFood`, `snapWealth`, `snapOff`,
    `snapCount`, `used`, `snapTech`, `techUsed`, the land arrays, `landCount`, `snapVol`,
    `volOff`, `volCount`, `goodVolume`, `volUsed`
  - `year`
  - any module-level mutable caches in the systems. Grep `^let |^const .* = new (Map|Set|Float|Int|Uint)`
    under `src/sim/history`. A determinism test catches any that are missed.
- **Size and cost [M]:** 28.6 MB at year 300, 32.4 MB at year 1000, 40.9 MB at year 2000,
  excluding the read-only `terrain` and `world`, which can be shared. Copy time is 20–70 ms.
- **Approach:**
  1. `src/sim/rng.ts`: give `sfc32` a serialisable form. Methods stay identical; add
     `getState(): [a, b, c, d]` and `fromState(state)`.
  2. `src/sim/history/index.ts` `createRunner`: move every mutable local into one `RunnerState`
     object. Add `checkpoint(): RunnerCheckpoint`, a deep copy that copies typed arrays, arrays,
     plain objects, Maps and Sets, preserves shared references through a `Map` memo, recreates
     RNGs from state, and skips `terrain`/`world`. Add `createRunnerFrom(world, options,
     checkpoint)`.
  3. Rebuild `ox` (OrdersState) for the new order list. The new order list must **extend** the
     old one: the old canonical list is a prefix of the new canonical list, and every added order
     has year > the checkpoint year. Then copy per-order state for the old indices. Also check
     whether the `history-orders` RNG has drawn anything before the checkpoint; if so, copy its
     state.
  4. In `encodeOrders`/`decodeOrders`, check how the canonical order is formed (contract.ts). If
     canonicalisation sorts by year, an appended order at year ≥ all earlier ones keeps the
     earlier indices. Otherwise `OrderGiven` events, which carry the index `k`, would differ, and
     resume would be invalid. *Touches contract.ts only by reading it.*
  5. `src/worker.ts`:
     - Keep a small ladder of checkpoints from the **run being shown**, for example at the year
       of the last order and at each 500-year mark. Cap it at 2 checkpoints on phones because of
       memory.
     - In `reorder()`, when the new orders extend the kept run's orders and a checkpoint exists at
       or before (min new order year − 1), resume from the latest such checkpoint.
     - Otherwise, including removing an order or new cradles, start from 0 as now. Removing the
       last order can resume too, from a checkpoint taken before that order's year.
- **Expected gain [M+C]:** re-sim time × (1 − share before Y). The share of sim time before year
  1000 is 30–43%, so a nudge at Y=1000 saves 1.8–2.4 s of the measured 5.6–7.1 s. A nudge at
  Y=1800 saves ~80%. On a phone, multiply by the phone/VM speed ratio [G: 1.5–3×]. Assembly
  (0.2–0.75 s) and the cache write (~1.1 s) remain.
- **Risk: high.** Correctness depends on finding every piece of mutable state. A missed one
  silently forks the history from what the link reproduces, and the URL `o=` must reproduce the
  history from scratch. This touches the core of `src/sim/history/index.ts` and `rng.ts`, but not
  `polity/*`.
- **Verify (mandatory):**
  1. A new vitest `src/sim/history/resume.test.ts`. For seeds {1, 42, 1234} × order years
     {50, 600, 1500} × kinds {explore, fortify, war, peace, settle}, check that
     `hashValue(resumed.advanceTo(2000)) === hashValue(fresh.advanceTo(2000))`. Also run a
     chained case: order A at 600, then resume to add order B at 1200.
  2. The checkpoint must not alias the live run. Advance the original after taking a checkpoint,
     then resume the checkpoint and compare against fresh.
  3. The `bench-sim.ts` hashes are unchanged for runs without orders.
  4. Measure with `bench-nudge.ts` (extend it to time the resume path).
- **On device:** nudge at year 1500 on an iPhone. Compare the "Simulating with N orders…" duration
  before and after (Safari Web Inspector or the app's console `history:` line).

### P7. Cheaper cache writes during extensions (small)
- **Files:** `src/worker.ts` `simulateAndPost`/`cacheWrite`.
- **Approach:**
  - Write only the initial history and the longest history reached in a session: debounce, so an
    extension that is followed within 30 s by another overwrites rather than adds.
  - Or skip writing intermediate lengths when the next extension is already queued.
  - Keep the cache key semantics.
- **Gain:** ~1.1 s of worker CPU saved per skipped write [M on VM], less on a fast laptop.
- **Risk:** low (best-effort cache).

### P8. Spread the main-thread staging spike (jank, not power)
- **Files:** `src/ui/historyView.ts` (stage/commit), `src/ui/goodsData.ts` (542 ms "goods"),
  polity data, `src/ui/historyIndex.ts`.
- **Approach:**
  - The work is already split into 20 tasks. Split the largest parts (goods, commit, polities)
    further, or move pure data prep (goodsData, historyIndex) into the worker and transfer it.
  - The worker option touches `worker.ts` and the response shape, but not `contract.ts`'s
    History type: add a separate field.
- **Gain:** longest main-thread task 543 ms → <100 ms [G], so fewer dropped frames on load and
  nudge.
- **Risk:** medium.

### P9. Simulation micro-optimisation (deprioritised)
- `foodSystem` (11%): the claim pass recomputes `claimStrength(p)` (two sqrt) twice per living
  settlement per year, once per pass. The base-catchment loop is already the fast path.
  `siteSearch` (6.7%) and `tradeSystem` (6.1%) are the next targets. GC is 3.5%: look for array
  growth (`s.events.push`, `snapOff.push`) and per-year temporaries.
- **Gain:** maybe 10–15% of sim time [G], and the sim is a one-off.
- **Risk:** **high** for determinism. Any reordering of float operations changes the History.
  Only make changes that leave `bench-sim.ts` hashes bit-identical.

### Considered and rejected
- **Rewriting the render loop for on-demand rendering:** it already does it [M: 0 idle frames].
- **Compacting land snapshots to land cells only** (≈9 MB saved per History): needs a
  `contract.ts` change and every renderer indexes by cell. Defer until after the polity work
  merges. The cache already gzips the zeros away (34 → 2.85 MB).
- **Float64 → Float32:** the History is already Float32/Uint8 throughout. Only `through`
  (Float64, diag only) and `goodVolume` (diag) are Float64, and neither is in the posted History.

---

## 4. Ordered, commit-sized steps

Each step needs: `npm run typecheck`, `npm test`, `npm run build`, and
`BENCH_ONLY=hash node --experimental-strip-types /home/claude/plans/perf-scripts/bench-sim.ts 2000 1 42 1234`,
which must print hashes `923881e7cd3fe59b`, `3bac8db3dfd723b5`, `2bb9f72e9e99433d`. That last
check applies unless the sim code version changes intentionally; none of steps 1–7 should change
it. Commit message trailer as instructed by the coordinator.

1. **`perf: stop the idle globe turn after 45 s on every device; no turn with reduced motion`** (P1)
   - main.ts only. Add a `paused_spin_long` scenario to bench-render.mjs to verify 0 frames.
2. **`perf: phone and low playback at 24 and 15 fps`** (P2)
   - quality.ts table only.
3. **`perf: battery-saver quality preset`** (P3, §5)
   - quality.ts (`Quality.Saver`, settings row, `QUALITIES`, `cheaperQuality`)
   - sunPanel.ts labels and titles (`QUALITY_LABELS`, `QUALITY_TITLES`)
   - main.ts: honour `ambientFps: 0` (no spin) and the saver hints
   - tests for `loadQuality`/`isQuality` if they exist (grep `quality.test`)
4. **`perf: long-haul legs drawn up to the legs opened by the year`** (P4a, longhaul.ts)
5. **`perf: outlaw lanes and trade ribbons hidden or ranged by the year`** (P4b, outlaws.ts, trade.ts)
6. **`perf: drop CPU copies of static geometry after upload`** (P5)
   - Name the anonymous meshes first, in its own commit if large.
7. **`perf: debounce cache writes of intermediate extensions`** (P7)
8. **`sim: serialisable RNG state`** (P6.1)
   - rng.ts only. Add a test that a restored generator continues the same stream.
9. **`sim: runner state in one object; checkpoint and resume`** (P6.2–3)
   - Plus resume.test.ts. The hashes must be unchanged.
10. **`worker: resume nudges from a kept checkpoint`** (P6.5)
    - Also update the worker header comment, which currently says a run "cannot be forked".
11. (Optional) P8 staging split. P9 only with bit-identical hashes.

Finish with:
`git format-patch 8cabf09..perf-audit -o /home/claude/worldseed-perf-patches/` and
`git bundle create /home/claude/perf-audit.bundle 8cabf09..perf-audit`.

---

## 5. Battery-saver setting: design

The current presets are `High`, `Balanced`, `Phone` and `Low` (`src/render/quality.ts`), shown in
the `S` panel (`src/ui/sunPanel.ts`, `QUALITIES` loop at line ~93) and applied by `applyQuality`
(main.ts:1051).

- **Add `Quality.Saver = 'saver'`** as the last entry in `QUALITIES`, labelled "Saver", with the
  title "Battery saver: fewer frames, lower resolution, still clouds, no idle turn". Settings:

  | setting | value |
  |---|---|
  | `pixelRatioCap` | 1 |
  | `pixelRatioMin` | 0.5 |
  | `bakeSize` | 768 |
  | `cloudBakeSize` | 768 |
  | `cloudsAnimate` | `'never'` |
  | `interactFps` | 30 |
  | `playFps` | 15 |
  | `ambientFps` | 0 (new meaning: no auto-rotation at all; in `ambientFps()`, return 0 and set `spinning = false` in `applyQuality`) |
  | `atmosphereSteps` | 6 |
  | `townShadows` | false |
  | `starFraction` | 0.5 |
  | `cloudPuffDetail` | false |
  | `panelBlur` | false |
  | `motionTargets` | 1 |
  | `motionSamples` | 0 (no MSAA, multisample antialiasing, in motion; Apple 2026b) |

  Every value in this table, like the fps caps proposed in P2, is a design default to tune on
  devices, not a sourced fact.

  Also consider `antialias` off. It is fixed at context creation (main.ts:143), so it can only
  change on reload. Leave it out of v1.
- `cheaperQuality`: Low stays Low. The probe must never pick Saver on its own.
- **Hints (never automatic switching):**
  - Where `navigator.getBattery` exists (Chromium only, since Chrome 38, and only in secure
    contexts since Chrome 103; Firefox removed it in 52; Safari never shipped it; MDN BCD 2026,
    MDN 2026d) and it reports
    `charging === false && level <= 0.2`, show a one-time toast: "Low battery: switch to Saver?
    (S panel)".
  - `prefers-reduced-motion` turns off spin and drift regardless of preset (P1).
  - iOS Low Power Mode cannot be detected from the web [unverified: no such API found on MDN;
    absence is hard to prove]. iOS WebKit throttles `requestAnimationFrame` to 30 fps in Low Power
    Mode itself (WebKit 2017, fixed in r213169; WebKit 2020, confirmed intentional) [verified].
- Persisted like any other quality choice (`saveQuality`). URL `quality=saver`.
- **Is it warranted?** P1 + P2 already remove most steady-state cost. The preset adds the DPR cap
  of 1, about −55% pixels against 1.5 at the same window [C: (1/1.5)² = 0.44], and cheaper shaders, for users on
  battery who keep playback running. That is worth having, at small cost. It is not urgent.

---

## 6. Open questions (for the owner or a real-device session)

1. **Q1:** Does the initial intro animation (0→2000 at 20 y/s) trigger a background extension to
   2500 years, through the `timeline.ts` prefetch near `years`? If so, every visit pays 500
   extra years plus a cache write for nothing until the user plays on. Check by loading the
   default link, waiting 2 min, and running `__worldseedHistory.years()` with `perf=1`. If it
   does, prefetch only once the user presses Play past the soft stop.
2. **Q2:** Is the endless desktop turn wanted as a feature? P1 changes it. Alternative: keep it,
   but at ≤10 fps (a slow turn needs few frames; `ambientFps` already aims at ~0.6 px per frame,
   so a lower cap shows as a slight judder).
3. **Q3:** On real Apple GPUs, what is the cost per frame of the atmosphere ray-march (12 vs 8
   steps), the bake vs procedural surface, and the transparent ribbons?
   `__worldseed.ab(8, 'atmo', 8)` and `__worldseed.ab(8, 'bake')` exist for exactly this, and
   `__worldseed.bench(20)` gives median ms per frame. iOS Safari has no
   `EXT_disjoint_timer_query` (Safari never shipped it or its WebGL2 variant; Chrome removed the
   WebGL1 one in 65 after the GLitch attack, and ships the WebGL2 one on desktop only; MDN BCD
   2026) [verified], so motion resolution falls back to frame intervals there [C: gpuTimer.ts]. Use `bench()`, which waits with `readPixels`.
4. **Q4:** What is the iPad/iPhone memory headroom with 128 MB of bakes, ~74 MB of geometry
   (doubled on the GPU) and a 35 MB History, at 6000 years (≈3× History)? Use Safari Web
   Inspector → Timelines → Memory, on the default link and after extending to 6000.
5. **Q5:** Does `navigator.hardwareConcurrency` on iPad Safari report real cores? It decides
   `weak` in device.ts and hence the default quality. **Partly answered [verified]:** no. Safari
   15.4+ clamps the value to 4 or 8 to limit fingerprinting (MDN BCD 2026; WebKit 2022), and the
   spec allows any browser to report fewer cores than exist (MDN 2026g). What device.ts does with a
   clamped 4 or 8 on an iPad still needs checking on a device.
6. **Q6, answered [C]:** for P6, `encodeOrders`/`decodeOrders` (contract.ts:2021–2044) keep the
   list order. They do not sort; they only drop items that fail to parse. `createOrdersState`
   sorts by year with ties broken by index, and events carry the list index `k`. So appending
   orders at the **end** of the list keeps every earlier index. Resume is valid when the old list
   is a prefix of the new one and every appended order's year is greater than the checkpoint
   year. An order inserted mid-list, or a deleted one, shifts the later indices. Resume then
   needs a checkpoint before the earliest affected order's year, and the events at or after it
   are recomputed anyway.
7. **Q7:** Are there module-level mutable caches in `src/sim/history/**` that a checkpoint would
   miss? Grep, and rely on the resume test.

---

## Appendix: scripts (`/home/claude/plans/perf-scripts/`)

| script | what it does | how to run |
|---|---|---|
| `bench-sim.ts` | world/history time per seed, History hash, History bytes by field, re-sim time; `BENCH_ONLY=hash` for the determinism check; `BENCH_JSON=path` | `node --experimental-strip-types bench-sim.ts 2000 1 42 1234` |
| `bench-nudge.ts` | ms per 250-year chunk, assembly, nudge re-sim from 0, what a resume at Y would save | `node --experimental-strip-types bench-nudge.ts 42 1000` |
| `fork-probe.ts`, `fork-probe2.ts`, `fork-probe3.ts` | cloneability of the sim state, the functions reachable from it, checkpoint bytes and copy time at years 300/1000/2000, the orders-before-Y premise | `node --experimental-strip-types fork-probe2.ts` |
| `cache-cost.ts` | snapshot and gzip cost of a cache write, ocean share | as above |
| `prof-top.mjs` | top self-time functions and files from a `.cpuprofile` | `node prof-top.mjs prof/*.cpuprofile 40` |
| `bench-render.mjs` | per-scenario 10 s windows: frames drawn, CDP main-thread ms, trace sums per frame, Chrome CPU-s, heap; `SMALL=1` gives a 360×240 viewport; `OUT=` writes JSON | needs a preview server (below) |
| `profile-playback.mjs` | CPU profile and allocation sampling during playback, vertex re-uploads by object, scene census by primitives | `node profile-playback.mjs` |
| `memory-page.mjs` | History bytes on the main thread, scene geometry by object, bake MB, RSS by Chrome process type | `node memory-page.mjs` |
| `staging.mjs` | the app's own console timings of worker sim and main-thread staging | `node staging.mjs` |
| `intro-prefetch.mjs` | samples history length and extension state for 200 s after load (Q1) | `node intro-prefetch.mjs` |

Browser setup:
- The scripts use Playwright with `executablePath: '/usr/bin/google-chrome'`, because the
  playwright CDN was blocked by the proxy. Flags: `--use-angle=swiftshader --enable-unsafe-swiftshader`.
- Build: `npx vite build --outDir /home/claude/plans/dist`.
- Serve: `npx vite preview --outDir /home/claude/plans/dist --port 4173 --strictPort` from the
  worktree.
- Raw results: `render-baseline.json` (1280×800), `render-small.json` (360×240),
  `bench-2000.json`, `*.log`, `playback.cpuprofile`, `playback.heapprofile.json`,
  `prof/*.cpuprofile`.

## Addendum (from seat-mode.md)
seat-mode.md amends P6: (a) P6's orders-state rebuild should call `appendOrders` (live append to a paused run is verified bit-identical to a fresh run); (b) five species arrays are immutable after year 1 (11.7 MB) — share them, don't clone, cutting a checkpoint to ~17–29 MB; (c) budget at most 2 checkpoints total on phones (~60 MB), 6 on desktop, shared between P6's ladder and the seat ring. Read seat-mode.md §5 before implementing P6.

## Owner decisions (2026-11-26)
- Fix 1 approved: stop the idle globe spin after ~45 s on all devices (and honour reduced-motion).

## References

Citation audit 2026-11-26. [verified] = a page confirming the claim was opened during the audit;
[unverified] = could not be confirmed (reason given). Dates of web docs are access dates.

**Browser, platform and library documentation**
- (MDN BCD 2026) MDN contributors. *browser-compat-data*: `api/Navigator.json` (getBattery,
  deviceMemory, hardwareConcurrency), `api/EXT_disjoint_timer_query.json`,
  `api/EXT_disjoint_timer_query_webgl2.json`. GitHub, accessed 2026-11-26.
  https://github.com/mdn/browser-compat-data [verified: getBattery Chrome 38+, Firefox 43–52,
  Safari never; deviceMemory Chrome only; hardwareConcurrency Safari 15.4+ "clamped to 4 or 8
  cores"; EXT_disjoint_timer_query: Safari never, Chrome 47–65 removed for GLitch, re-added 70
  macOS only; webgl2 variant: Chrome 70+ desktop, not Android, not Safari or Firefox]
- (MDN 2026a) MDN. "prefers-reduced-motion". https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
  [verified: `reduce` = user enabled reduced motion; Baseline since January 2020]
- (MDN 2026b) MDN. "Window: devicePixelRatio property". https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
  [verified: ratio of physical pixels to CSS pixels]
- (MDN 2026c) MDN. "Transferable objects". https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
  [verified: ArrayBuffer transfer is zero-copy and detaches the original]
- (MDN 2026d) MDN. "Navigator: getBattery() method". https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getBattery
  [verified: secure contexts only since Chrome 103; not Baseline]
- (MDN 2026e) MDN. "Window: requestAnimationFrame() method". https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
  [verified: "paused in most browsers when running in background tabs or hidden iframes"]
- (MDN 2026f) MDN. "The structured clone algorithm". https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
  [verified: Function objects throw DataCloneError]
- (MDN 2026g) MDN. "Navigator: hardwareConcurrency property". https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency
  [verified: browsers may report fewer logical cores than exist]
- (WebKit 2017) Dumez, C. "[iOS] Throttle requestAnimationFrame to 30fps in low power mode".
  WebKit Bugzilla 168837, RESOLVED FIXED (r213169). https://bugs.webkit.org/show_bug.cgi?id=168837 [verified]
- (WebKit 2020) "Throttling requestAnimation Frame to 30 FPS in low power mode on iOS 14 (but not
  iOS 13)". WebKit Bugzilla 215745, RESOLVED INVALID; S. Abou-Hallawa: "This is intentional."
  https://bugs.webkit.org/show_bug.cgi?id=215745 [verified]
- (WebKit 2022) "Restore navigator.hardwareConcurrency" (capped value). WebKit Bugzilla 233381;
  shipped in Safari 15.4 (2022) per MDN BCD 2026.
  https://bugs.webkit.org/show_bug.cgi?id=233381 [verified: discussion of returning 4 or 8; the
  exact threshold between 4 and 8 is not stated on the page]
- (WebKit 2024) "REGRESSION (?): Model-Viewer causing WebContent jetsam". WebKit Bugzilla 282379.
  https://bugs.webkit.org/show_bug.cgi?id=282379 [verified: "The WebContent process is running out
  of memory, and gets terminated"; no limit value is given. No official per-tab limit was found:
  the value is unverified]
- (WebKit 2026a) WebKit. "Web Inspector Reference: Timelines Tab". https://webkit.org/web-inspector/timelines-tab/
  [verified: Memory and CPU timelines; a separate Frames view groups work by rendering frame]
- (Apple 2026a) Apple. "View energy consumption in Activity Monitor on Mac". https://support.apple.com/en-us/ht203184
  [verified: Energy Impact = "a relative measure of the current energy consumption of the app"]
- (Apple 2026b) Apple. "Tailor your apps for Apple GPUs and tile-based deferred rendering". Metal
  documentation. https://developer.apple.com/documentation/metal/tailor-your-apps-for-apple-gpus-and-tile-based-deferred-rendering
  [verified: Apple-silicon GPUs are TBDR, process all geometry of a pass per tile before shading;
  MSAA definition]
- (three.js 2026) three.js. "BufferAttribute" (onUpload, array). https://threejs.org/docs/pages/BufferAttribute.html
  [verified: onUpload is for CPU-side clean-up after upload; `this.array = null` is not in the docs]
- (Khronos 2024) Khronos. "HandlingContextLost". WebGL wiki. https://wikis.khronos.org/webgl/HandlingContextLost
  [verified: after restore all previously allocated resources are invalid and must be re-created]

**Algorithms and formats**
- (Deutsch 1996) Deutsch, L. P. *GZIP file format specification version 4.3*. RFC 1952, IETF, May
  1996. https://www.rfc-editor.org/rfc/rfc1952 [verified]
- (Doty-Humphrey n.d.) Doty-Humphrey, C. *PractRand* RNG engines: sfc16/sfc32/sfc64, "Small Fast
  Counting RNG, version 4". http://pracrand.sourceforge.net/RNG_engines.txt [verified: sfc32
  32-bit, 16-byte state, state space 2^128, minimum cycle 2^32]

**Design defaults and guesses (no source; not facts)**
- P1 `IDLE_TURN_SECONDS` 45 and the 2 s ease; P2 fps caps (24, 20, 15); the §5 Saver table; the
  5–15 W laptop saving; the phone/VM speed ratio 1.5–3×; the P8 "<100 ms" target; the P9
  "10–15%" gain. All [G] or design defaults.

**Measured here** (scripts in `/home/claude/plans/perf-scripts/`, against `/home/claude/worldseed-perf` @ 8cabf09)
- Sim times, hashes, History bytes: `bench-sim.ts`; per-chunk times and nudge re-sim: `bench-nudge.ts`.
- Cloneability, reachable functions, checkpoint bytes and copy time: `fork-probe.ts`,
  `fork-probe2.ts`, `fork-probe3.ts`.
- Cache-write cost and ocean share: `cache-cost.ts`. CPU profile top list: `prof-top.mjs`.
- Frames drawn, CPU-s, JS ms per frame: `bench-render.mjs`; playback profile, uploads, census:
  `profile-playback.mjs`; scene geometry and RSS: `memory-page.mjs`; staging: `staging.mjs`;
  Q1 probe: `intro-prefetch.mjs`.

## Addendum (master plan)
Overrides the body and earlier addenda where they differ. Rulings and ids: MASTER-PLAN.md §2 and §3.
- **R2 (golden hashes).** `hashValue` hashes the whole History, so any new field changes it. The programme gate is **G0 = `hashBase(h)`**: hashValue over the 8cabf09 key set, with widened fields projected back to their 8cabf09 types (MASTER-PLAN §2.1). On 8cabf09 it reproduces `923881e7cd3fe59b`, `3bac8db3dfd723b5` and `2bb9f72e9e99433d`. Phase 0 adds `scripts/g0.ts`. `BENCH_ONLY=hash` stays as the G1 (current-defaults) check.
- **R1 (phone factor).** Plan with **3×** the VM bench for D-phone [G], 5× as the floor-device stress case. Phase 0 lane M measures the real factor in the browser on the target iPhone and iPad and replaces 3× everywhere (MASTER-PLAN §2.6).
- **P6 checkpoint store** is the single `CheckpointStore` for seat, what-if, causal, scenarios and divine branches. Its key includes the engine hash and `worldEditsHash` (world-builder-divine §0.3). Caps: 2 in total on phones, 6 on desktop.
- **P8 (staging split) is required, not optional,** before seat mode ships on phones (MASTER-PLAN §5.2).
- **R31.** The format-patch and bundle instructions at the end of §4 are obsolete. Use MASTER-PLAN §8 (branch per step group, one PR each).
