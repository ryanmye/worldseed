import { expect, it } from 'vitest'
import { formatStats, runStats } from './stats.ts'

it('prints world stats for the standard seeds', () => {
  const rows = runStats()
  console.log('\n' + formatStats(rows))
  // Generation budget: well under 2 s per world at n = 48.
  for (const r of rows) expect(r.ms).toBeLessThan(2000)
}, 60_000)
