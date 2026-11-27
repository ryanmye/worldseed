// G0 (MASTER-PLAN §2.1 R2): hashBase at 2000 years for seeds 1, 42 and 1234, default options (every new option false).
// Run: node --experimental-strip-types scripts/g0.ts [years] [seeds...] [--preset off|realistic|dramatic]
// Default: both identities per seed, the default (realistic preset: G0_GOLDENS) and preset 'off' (every post-8cabf09 system off:
// G0_OFF_GOLDENS, the 8cabf09 goldens). A lane whose feature is off by default must keep both. --preset runs one only.
// Exits 1 if a golden seed at 2000 years does not match G0_GOLDENS. Prints hashValue (G1, current defaults) beside it.
//
// `--schema` re-records src/hashBaseShape.ts. Only ever run that on 8cabf09 (it was, once): on a later tree it would fold
// the new fields into the base and G0 would stop guarding them.
import { writeFileSync } from 'node:fs'
import { generateWorld, simulateHistory } from '../src/sim/index.ts'
import { hashValue } from '../src/historyCache.ts'
import { G0_GOLDENS, G0_OFF_GOLDENS, G0_YEARS, hashBase, shapeOf } from '../src/hashBase.ts'
import { pickOrders } from '../src/sim/history/orders/ordersStats.ts'
import type { History, PresetName } from '../src/contract.ts'

const argv = process.argv.slice(2)
if (argv[0] === '--schema') {
  const hs: History[] = []
  for (const seed of [1, 42, 1234]) hs.push(simulateHistory(generateWorld(seed), { years: G0_YEARS, preset: 'off' }))
  // orders and orderOutcomes exist only with orders (the orders test's standard set on seed 3)
  const w = generateWorld(3)
  const base = simulateHistory(w, { years: 1100, preset: 'off' })
  const orders = [
    ...pickOrders(w, base, 699, 'A').map((o) => ({ ...o, year: 700 })),
    ...pickOrders(w, base, 949, 'B').map((o) => ({ ...o, year: 950 })),
  ]
  hs.push(base, simulateHistory(w, { years: 1100, orders, preset: 'off' }))
  const shape = shapeOf(hs)
  const path = new URL('../src/hashBaseShape.ts', import.meta.url)
  writeFileSync(path, `// Generated once on main @ 8cabf09 by \`scripts/g0.ts --schema\` (seeds 1, 42, 1234 at 2000 y; seed 3 at 1100 y with and\n// without the standard orders). Frozen: the 8cabf09 History shape that hashBase projects onto (src/hashBase.ts). Do not edit.\nexport const BASE_SHAPE = ${JSON.stringify(shape, null, 1)} as const\n`)
  console.log('wrote', path.pathname)
} else {
  // default: both identities, the realistic default (G0_GOLDENS) and preset 'off' (G0_OFF_GOLDENS, every post-8cabf09 system off)
  const pi = argv.indexOf('--preset')
  const only = pi >= 0 ? (argv[pi + 1] as PresetName) : undefined
  const nums = argv.filter((_, i) => pi < 0 || (i !== pi && i !== pi + 1)).map(Number)
  const years = nums[0] || G0_YEARS
  const seeds = nums.length > 1 ? nums.slice(1) : [1, 42, 1234]
  const runs: (PresetName | undefined)[] = only ? [only] : [undefined, 'off']
  let ok = true
  for (const seed of seeds) for (const preset of runs) {
    const h = simulateHistory(generateWorld(seed), preset ? { years, preset } : { years })
    const g0 = hashBase(h), g1 = hashValue(h)
    const table = preset === 'off' ? G0_OFF_GOLDENS : preset === undefined || preset === 'realistic' ? G0_GOLDENS : undefined
    const want = years === G0_YEARS ? table?.[seed] : undefined
    const verdict = want === undefined ? '' : g0 === want ? 'OK' : `FAIL (want ${want})`
    if (want !== undefined && g0 !== want) ok = false
    console.log(JSON.stringify({ seed, years, preset: preset ?? 'default (realistic)', hashBase: g0, hashValue: g1, verdict }))
  }
  process.exit(ok ? 0 : 1)
}
