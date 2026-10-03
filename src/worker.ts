// Web worker: generates a World off the main thread and posts it back with
// its typed-array buffers transferred (not copied).

import type { World, WorldOptions } from './contract.ts'
import { generateWorld } from './sim/index.ts'

export interface WorkerRequest {
  seed: number
  options?: WorldOptions
}

export type WorkerResponse = { type: 'world'; world: World } | { type: 'error'; message: string }

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { seed, options } = ev.data
  try {
    const world = generateWorld(seed, options)
    const transferables: Transferable[] = [
      world.grid.positions.buffer,
      world.grid.triangles.buffer,
      world.grid.neighborOffsets.buffer,
      world.grid.neighbors.buffer,
      world.plate.buffer,
      world.elevation.buffer,
      world.temperature.buffer,
      world.rainfall.buffer,
      world.biome.buffer,
      world.riverTo.buffer,
      world.flow.buffer,
    ]
    // `lake` is required by the contract but may be absent from an older sim build.
    const lake = (world as Partial<World>).lake
    if (lake) transferables.push(lake.buffer)
    const response: WorkerResponse = { type: 'world', world }
    ;(self as unknown as Worker).postMessage(response, transferables)
  } catch (err) {
    const response: WorkerResponse = { type: 'error', message: err instanceof Error ? err.message : String(err) }
    ;(self as unknown as Worker).postMessage(response)
  }
}
