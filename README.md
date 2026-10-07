# worldseed

worldseed is a procedural planet and civilisation simulator that runs entirely in
the browser. Give it a number and it builds a planet: plates, mountains, climate,
rivers and biomes. Then it simulates that planet's history year by year, by
default for 2000 years: peoples spreading from a few cradles, farming, sailing,
trading, forming states, going to war, founding faiths and dynasties, passing on
ideas and diseases. There is no backend and no language model. Every name, event
and line of the chronicle comes from code in this repository. The simulation is
deterministic, so a seed is a world: the same seed always gives the same planet
and the same history. The address bar holds the seed and any nudges you have
given, so a link reproduces the world you were looking at.

Live at [ryanmye.github.io/worldseed](https://ryanmye.github.io/worldseed/).

![Seed 42 in the year 4067: 25 states, 25 cities and 33 long-distance trade lanes on a planet of 1.3 million people](docs/world-42-year-4067.png)

*Seed 42 in the year 4067: 25 states, 25 cities and 33 long-distance lanes, 1.3 million people.*

## Try it

Open [ryanmye.github.io/worldseed](https://ryanmye.github.io/worldseed/). The
start page asks for a seed (type one, or roll a random one) and how many years to
simulate (200 to 6000), then Start. The globe appears first and the history fills
in behind it. When playback reaches the end you can keep playing and the
simulation runs further.

The start page only shows at the bare address. Any link with parameters, such as
[`?seed=42`](https://ryanmye.github.io/worldseed/?seed=42), opens the app
directly, so shared links go straight to the world.

## What it simulates

Roughly in the order things happen in a world:

- **The planet.** Tectonic plates raise mountains and open oceans; temperature,
  rainfall, rivers and biomes follow from the land.
- **Peoples, farming and migration.** Founding tribes start in a few separate
  cradles; settlements grow on what their land and technology can feed, and
  groups leave to found new ones.
- **Voyages, contact and the known world.** Settlers sail to new coasts. Each
  people knows only part of the world, and that limits where it migrates, sails
  and trades. Peoples that meet learn what the other knows.
- **Exploration.** Prosperous towns send expeditions to the edge of their
  people's known world and found expedition bases where nobody could farm.
- **Species and crops.** Staples, herd animals and cash crops are native to
  particular places and spread through colonisation, contact and trade.
- **Trade, roads and ports.** Settlements open trade routes, build roads, ports
  and dams, and import food, so trading hubs can outgrow their land.
- **States.** States form, hold land and claim the empty land around it, fight
  wars and civil wars, take vassals and pay tribute; groups of trading towns can
  form leagues.
- **Danger.** Raids, war and weak government make land dangerous. Pirates nest on
  defensible coasts near busy sea lanes, bandits work roads far from a capital's
  reach, and smugglers dodge tariffs. Trade counts that danger as cost: routes
  re-path around it or are given up.
- **Goods.** Mines and craft traditions produce specialities; some crops and
  crafts are state secrets that leak through trade, espionage and smuggling.
  Marts are joined by relay legs and long-distance lanes, and merchant houses keep
  their own capital.
- **Disease.** Epidemics travel along trade routes and journeys, first contact
  passes on crowd diseases, and fever stays bound to its places. Ports can
  quarantine ships.
- **Rulers.** Every state has a named ruler with heirs. Houses rise and fall,
  marry into each other, unite crowns and fight over successions.
- **Faiths.** Faiths are founded at holy cities, spread, become state churches,
  split in schisms and fight holy wars.
- **Ideas.** Inventions and practices are conceived by particular peoples and
  carried by trade, migration, conquest and marriage. Some peoples refuse them,
  and some lose them again.
- **Tourism.** Wealthy towns travel for pleasure to scenery, ruins, old capitals
  and holy cities; some towns become resorts and later go out of fashion.
- **Renaming.** Towns held long enough by conquerors of another people take a new
  name; holy cities taken by another faith are rededicated.
- **Landmarks.** Castles, palaces and houses of worship in the style of each
  faith's building tradition are raised, neglected, ruined, restored and
  rededicated. Ruins outlive their towns and can be revived when a town is
  founded beside them.
- **Oceans.** A wide ocean is a barrier until a people's ships and seafaring
  ideas can cross it, so continents can stay apart and their species, faiths and
  ideas diverge.
- **Nudges.** The player's orders are part of the history like the seed. They
  are recorded with what came of them.

Everything the interface shows comes from one `History` record
([`src/contract.ts`](src/contract.ts)): settlements and populations, events,
journeys, structures, land use, roads, trade, peoples and what they knew,
species, technology, polities, wars, goods, diseases, rulers, faiths, tourism,
renamings, ideas, landmarks, and the orders with their outcomes.

## Looking at it

**Views and layers.** `V` cycles through the views: terrain, elevation,
temperature, rainfall, plates and biomes; population, carrying capacity, land
use, crops, herds and cash crops; factions, danger and faiths; resources,
scenery and fever; ideas. Views that need history data appear once there is
some. `L` opens the layers: rivers, clouds, labels, settlements, buildings,
farmland, structures, journeys, trade and roads. `M` switches between the globe
and a flat map.

**Chronicle and inspector.** The chronicle (`C`) lists the notable events up to
the current year, newest first, and follows the timeline exactly when you scrub
back. Click a town to open its inspector: origin, people, population over time,
and what shaped it.

**Cities.** The Cities panel (`U`) ranks every town and city alive at the
current year by population. A row selects the town and flies to it.

**City view.** Double-click a town, or select it and press `Y`, to fly down into
it. The camera orbits at street level over the town's 3D buildings, under a sky
lit by the current sun, with shadows. `Q`/`E` turn, `Z`/`X` lower and raise,
`+`/`-` zoom; `Esc` flies back up.

**Other panels.** Each opens with its own key and is collapsed by default:

- Faiths (`F`): the universal faiths, their holy cities, share of the world's
  people, schisms and holy wars.
- Ideas (`I`): the catalogue of ideas known so far, who first conceived each,
  and how it travelled from people to people.
- Travel (`T`): places visited, resort towns and sights.
- Sickness (`D`): the world's diseases and its epidemics, with deaths over time.
- Also Peoples (`P`), Factions (`R`), Goods (`G`) and Species (`N`).

**Sagas and the Library.** The Sagas panel (`A`) tells a prose history of the
world, a people, a state, a city or a ruling house, from the records up to the
current year. The Library (`B`) collects every saga as a book, with a table of
contents and cross-references. Both have two registers: the Chronicle, which
reports with the hedging of a historian, and the Legend, which tells the same
events as story. Sagas can be copied or downloaded as Markdown. Nudges never
appear in a saga as orders: each one is told as an omen (a light on the horizon,
a dream, a voice), and what followed is told from the recorded outcome.

**Nudging.** The Nudge panel (`O`) lets you urge a people, a state or a town at
the year shown: explore or settle toward a place, take up a crop or seek an
idea, make war or peace, move the capital, take up a faith, fortify a town,
quarantine a port. Nudging is light: an order raises the odds of something the
simulation could do anyway, and the rules decide whether it happens. An order
can be fulfilled, partly fulfilled, fail (impossible, or its actor or target
gone) or expire with nothing done. Each nudge re-simulates the world with the
new list of orders. The orders are written to the URL, so a link carries the
seed and the nudges.

### Keyboard shortcuts

Press `?` in the app for the full list.

| Key | Action |
| --- | --- |
| `Space` | Play / pause (at the end: simulate further) |
| `1` to `4` | Playback speed ¼×, 1×, 4×, 16× |
| `←` / `→` | Step one snapshot (`Shift` for ten) |
| `Home` / `End` | First / last year |
| `V` / `Shift+V` | Next / previous view |
| `L` | Layers |
| `M` | Globe / flat map |
| `C` | Chronicle |
| `U` | Cities |
| `Y` | Fly down into the selected town |
| `O` | Nudge panel |
| `A` | Sagas |
| `B` | Library |
| `S` | Sun and quality settings |
| `J` | Credits and licence |
| `Esc` | Close a popup, leave the city view, or deselect |

### URL parameters

The address reproduces the view, and the app keeps it up to date as you go. The
full list is in the comment at the top of [`src/main.ts`](src/main.ts); the
useful ones:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `seed` | The world | [`?seed=42`](https://ryanmye.github.io/worldseed/?seed=42) |
| `years` | Length of the first run, rounded up to 500-year steps, up to 6000 | [`?seed=42&years=4000`](https://ryanmye.github.io/worldseed/?seed=42&years=4000) |
| `year` | Start at this year (simulated that far first if needed) | [`?seed=42&year=1500`](https://ryanmye.github.io/worldseed/?seed=42&year=1500) |
| `play=0` | Start paused | [`?seed=42&year=1500&play=0`](https://ryanmye.github.io/worldseed/?seed=42&year=1500&play=0) |
| `view` | Start in a view (`terrain`, `biomes`, `factions`, `faiths`, `fever`, ...) | [`?seed=42&year=1500&view=factions`](https://ryanmye.github.io/worldseed/?seed=42&year=1500&view=factions) |
| `select` | Select a settlement by id | `?seed=42&select=<id>` |
| `fly` | Open in the city view of a settlement by id | `?seed=42&fly=<id>` |
| `o` | Nudges: `year:kind:actor[:target]` joined by `;` | `?seed=42&o=1000:explore:5:12345;1000:fortify:14` |
| `saga`, `legend=1` | Sagas subject (`world`, `people:<id>`, `state:<id>`, `city:<id>`, `house:<id>`) and register | [`?seed=42&saga=world&legend=1`](https://ryanmye.github.io/worldseed/?seed=42&saga=world&legend=1) |
| `library=1`, `told` | Open the Library, told at year `told` | [`?seed=42&library=1&told=1500`](https://ryanmye.github.io/worldseed/?seed=42&library=1&told=1500) |
| `intro=1` / `intro=0` | Force or skip the start page | [`?seed=42&intro=1`](https://ryanmye.github.io/worldseed/?seed=42&intro=1) |
| `sun` | `fixed`, `follow` (behind the camera) or `full` (daylight everywhere) | [`?seed=42&sun=full`](https://ryanmye.github.io/worldseed/?seed=42&sun=full) |
| `nocache=1` | Simulate afresh, ignoring and overwriting the browser cache | [`?seed=42&nocache=1`](https://ryanmye.github.io/worldseed/?seed=42&nocache=1) |
| `cachecheck=1` | On a cache hit, also simulate afresh and log whether they match (slow) | [`?seed=42&cachecheck=1`](https://ryanmye.github.io/worldseed/?seed=42&cachecheck=1) |
| `perf=1` | Frame-rate readout and `window.__worldseed` tools | [`?seed=42&perf=1`](https://ryanmye.github.io/worldseed/?seed=42&perf=1) |

## Running it locally

```
npm install
npm run dev        # Vite dev server, usually http://localhost:5173
npm test           # the test suite (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # type-check and build into dist/
```

Generated worlds and histories are cached in the browser (see below). The dev
server serves a hash of the simulation code, recomputed when those files change,
so an edit to the simulation never reads a stale cache. Add `?nocache=1` to force
a fresh run anyway.

The tests check, among other things, that the simulation is deterministic (the
same seed gives bit-identical output), that it is prefix-stable (a longer run
repeats a shorter one exactly up to its end, and a run resumed part-way equals
one run from scratch), and that every optional system has a bit-identical off
switch. The off-switch tests run a set of seeds with a system turned off (the
polities, goods, disease, rulers, religion, tourism, renaming, ideas, landmarks,
or no orders) and compare a hash of the whole history against a recorded golden
value from before that system existed. Passing means turning the system off
gives exactly the world without it, so a new system cannot quietly change the
others, and any change to an existing world is deliberate and visible in a
golden value. Some tests run full 2000-year histories and take a while; CI raises
the per-test timeout for them.

Each system also has a stats harness that runs many seeds and prints summary
figures, used to tune its parameters. They run directly under Node 23 or later
(native TypeScript type stripping), for example:

```
node src/sim/history/polityStats.ts 42 7
node src/sim/history/disease/diseaseStats.ts --off 42
node src/sim/history/ideas/ideasStats.ts --detail 42
```

The usage of each is in its header comment. Others: `src/sim/stats.ts` (the
planet), `src/sim/history/stats.ts` (settlement history), `speciesStats.ts`,
`goods/goodsStats.ts`, `rulers/dynastyStats.ts`, `tourism/tourismStats.ts`,
`renaming/renamingStats.ts`, `landmarks/landmarksStats.ts`,
`orders/ordersStats.ts` and `polity/wayStats.ts` (danger on trade routes). Most
take `--off` to compare against the same worlds with the system switched off.

## How it is built

The planet is an icosphere cell graph: an icosahedron with each face subdivided
and projected onto the sphere, giving hexagonal cells and twelve pentagons
([`src/sim/grid.ts`](src/sim/grid.ts)). The planet generator (`src/sim`) and the
history (`src/sim/history`) run in a Web Worker ([`src/worker.ts`](src/worker.ts)),
which posts the world first and the history after it, so the globe is on screen
while history is still being computed. [`src/contract.ts`](src/contract.ts)
defines the `World` and `History` types and is the only boundary between the
simulation and the interface: neither imports the other. The renderer
(`src/render`, three.js) draws only when something changed, and lowers its pixel
ratio when frames run slow. Worlds and histories are cached in IndexedDB
([`src/historyCache.ts`](src/historyCache.ts)), keyed by the seed, the options,
the length of the run, and a hash of the simulation code computed by
[`vite.config.ts`](vite.config.ts), so a cached history is only served to the same
code. The cache is best effort: without IndexedDB the app works the same.

Determinism rules: every subsystem draws from its own named random stream derived
from the world seed (`history-migration`, `history-war`, `history-ideas` and so
on; [`src/sim/rng.ts`](src/sim/rng.ts)), so adding draws to one system never
shifts the numbers another sees. The simulation does not use `Math.random`. The
generator uses only 32-bit integer operations, and the simulation keeps to
arithmetic that IEEE-754 pins down exactly (`+ - * /`, `sqrt`, `floor`; integer
powers), so results are bit-identical across JavaScript engines. Systems
draw in a fixed order over peoples, polities and settlements and do not let the
iteration order of a `Map` or `Set` decide anything. Nothing depends on the
length of the run. These rules are kept by convention and checked by the
determinism, prefix and golden tests above, not by a linter.

Deployment: [CI](.github/workflows/ci.yml) runs the type check, the tests and
the build on every push and pull request to `main`. A push to `main` that passes
all three is built with the `/worldseed/` base path and published to GitHub
Pages.

## Credits and licence

worldseed is licensed under the GPL-3.0; see [LICENSE](LICENSE).

The 3D building and ship models are CC0 (public domain): the KayKit Medieval
Hexagon Pack by Kay Lousberg, and the Pirate Kit and Fantasy Town Kit by Kenney.
Only a small subset of each pack is shipped, repacked into `.glb` files with
texture colours baked into vertex colours. Most buildings, the landmarks of
history and the houses of worship are generated in code. See
[`public/models/CREDITS.md`](public/models/CREDITS.md) for the per-file
attribution.

The settlement plans contain portions ported from
[TownGeneratorOS](https://github.com/watabou/TownGeneratorOS) (Medieval Fantasy
City Generator) by Oleg Dolya (watabou), GPL-3.0.

Made by [Ryan Ye](https://ryanmye.github.io).
