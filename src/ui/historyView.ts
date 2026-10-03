// Glue between a History and everything that shows it: the timeline clock, the
// settlement markers, travelling groups, ports and dams, farmland, night-side city
// lights, the inspector and the chronicle.
// Per frame it only derives (snapshot, fraction) from the timeline's year and pushes
// uniforms; heavier work (copying snapshot rows, recomputing city lights, stats,
// uploading land rows) happens only when a snapshot index changes.

import * as THREE from 'three'
import { CITY_POPULATION, TOWN_POPULATION, type History, type World } from '../contract.ts'
import type { GlobeMesh } from '../render/globe.ts'
import { ViewMode } from '../render/palette.ts'
import { buildSettlementLayer, MarkerStyle, type SettlementLayer } from '../render/settlements.ts'
import type { CameraFly } from '../render/cameraFly.ts'
import { buildJourneyLayer, type JourneyLayer } from '../render/journeys.ts'
import { buildStructureLayer, type StructureLayer } from '../render/structures.ts'
import { createChronicle } from './chronicle.ts'
import { buildHistoryIndex, landSnapshotAt, logScaled, snapshotAt, type HistoryIndex, type SnapshotPos } from './historyIndex.ts'
import { createInspector } from './inspector.ts'
import { createTimeline, YEARS_PER_SECOND } from './timeline.ts'

export interface HistoryViewDeps {
  /** Overlay containers. */
  bottom: HTMLElement
  left: HTMLElement
  right: HTMLElement
  planetGroup: THREE.Group
  camera: THREE.PerspectiveCamera
  canvas: HTMLCanvasElement
  fly: CameraFly
  getGlobe(): GlobeMesh | null
  /** Called before flying to a settlement (stops the planet spinning). */
  onFly(): void
  setUrlParam(name: string, value: string | null): void
}

export interface InitialHistoryState {
  year: number | null
  play: boolean
  select: number | null
}

export interface HistoryView {
  /** A new world is showing; history is being simulated. */
  setWorld(world: World): void
  setHistory(history: History): void
  setHistoryError(message: string): void
  /** Settlement under CSS pixel (x, y) relative to the canvas, or -1. */
  pickAt(x: number, y: number): number
  select(id: number, fly: boolean): void
  setHover(id: number): void
  setViewMode(mode: ViewMode): void
  setMarkersVisible(show: boolean): void
  setJourneysVisible(show: boolean): void
  /** Ports, dams and reservoirs. */
  setStructuresVisible(show: boolean): void
  tick(dt: number, drawSize: THREE.Vector2, pixelRatio: number): void
}

const FLY_DIST = 2.3
/** Bounds on how long a route stays faintly visible after the group passed (years). */
const THREAD_MIN_YEARS = 40
const THREAD_MAX_YEARS = 120
/** Upper bound on how long a trail's bright head takes to decay (years). */
const HEAD_MAX_YEARS = 30

export function createHistoryView(deps: HistoryViewDeps, initial: InitialHistoryState): HistoryView {
  let world: World | null = null
  let index: HistoryIndex | null = null
  let layer: SettlementLayer | null = null
  let journeys: JourneyLayer | null = null
  let journeysVisible = true
  let structures: StructureLayer | null = null
  let structuresVisible = true
  let shownL0 = -1
  let shownL1 = -1
  const landPos: SnapshotPos = { s0: 0, s1: 0, frac: 0 }
  let pending: InitialHistoryState | null = initial
  let markersVisible = true
  let viewMode: ViewMode = ViewMode.Terrain
  let selected = -1
  let hovered = -1
  let shownS0 = -1
  let shownS1 = -1
  let lights: Float32Array | null = null
  let cellPop: Float32Array | null = null
  const pos: SnapshotPos = { s0: 0, s1: 0, frac: 0 }
  const tmp = new THREE.Vector3()

  const timeline = createTimeline(deps.bottom, {
    onSettled(year: number, playing: boolean) {
      if (!index) return
      deps.setUrlParam('year', playing ? null : String(Math.round(year)))
      deps.setUrlParam('play', playing ? null : '0')
    },
  })
  const inspector = createInspector(deps.left, {
    onSelect: (id) => api.select(id, true),
    onClose: () => api.select(-1, false),
  })
  const chronicle = createChronicle(deps.right, {
    onSelect: (id) => api.select(id, true),
  })

  function clearLayer() {
    if (layer) {
      deps.planetGroup.remove(layer.mesh)
      layer.dispose()
      layer = null
    }
    if (journeys) {
      deps.planetGroup.remove(journeys.object)
      journeys.dispose()
      journeys = null
    }
    if (structures) {
      deps.planetGroup.remove(structures.mesh)
      structures.dispose()
      structures = null
    }
  }

  function applyMarkerStyle() {
    if (!layer) return
    layer.mesh.visible = markersVisible
    layer.setStyle(viewMode === ViewMode.Terrain ? MarkerStyle.Terrain : MarkerStyle.Data)
  }

  /**
   * Per-cell night-light intensity from the populations of snapshot s. Towns and cities
   * burn brighter and spill into the neighbouring cells (suburbs), so a city reads as a
   * larger, brighter sprawl than any village.
   */
  function updateCityLights(s: number) {
    const globe = deps.getGlobe()
    if (!globe || !index || !world || !lights || !cellPop) return
    const h = index.history
    const N = index.count
    const base = s * N
    for (let i = 0; i < N; i++) {
      const p = h.population[base + i]
      if (p > 0) cellPop[h.settlements[i].cell] = 0
    }
    for (let i = 0; i < N; i++) {
      const p = h.population[base + i]
      if (p > 0) cellPop[h.settlements[i].cell] += p
    }
    lights.fill(0)
    for (let i = 0; i < N; i++) {
      const c = h.settlements[i].cell
      if (h.population[base + i] > 0) lights[c] = Math.max(lights[c], logScaled(cellPop[c], index.logMax))
    }
    const { neighborOffsets: off, neighbors: nb } = world.grid
    for (let i = 0; i < N; i++) {
      if (h.population[base + i] <= 0) continue
      const c = h.settlements[i].cell
      const p = cellPop[c]
      if (p < TOWN_POPULATION) continue
      const city = p >= CITY_POPULATION
      const v = logScaled(p, index.logMax)
      lights[c] = Math.max(lights[c], v * (city ? 1.45 : 1.12))
      const spill = v * (city ? 0.62 : 0.3)
      for (let k = off[c]; k < off[c + 1]; k++) if (lights[nb[k]] < spill) lights[nb[k]] = spill
    }
    globe.setCityLights(lights, 1)
  }

  /** Copy the land rows bracketing the current year into the globe (when they change). */
  function updateLand(year: number) {
    const globe = deps.getGlobe()
    const land = index?.land
    if (!globe || !land) return
    landSnapshotAt(land, year, landPos)
    if (landPos.s0 !== shownL0 || landPos.s1 !== shownL1) {
      globe.setLandRows(land.landUse, land.degradation, landPos.s0, landPos.s1)
      shownL0 = landPos.s0
      shownL1 = landPos.s1
    }
    globe.setLandFrac(landPos.frac)
  }

  const api: HistoryView = {
    setWorld(w: World) {
      world = w
      index = null
      clearLayer()
      selected = -1
      hovered = -1
      inspector.hide()
      chronicle.setIndex(null)
      timeline.setRange(null, 1, 'simulating history…')
      lights = new Float32Array(w.grid.cellCount)
      cellPop = new Float32Array(w.grid.cellCount)
      shownS0 = shownS1 = -1
      shownL0 = shownL1 = -1
      deps.canvas.style.cursor = ''
    },
    setHistory(h: History) {
      if (!world) return
      index = buildHistoryIndex(h)
      clearLayer()
      layer = buildSettlementLayer(world, h, index.maxPopulation)
      deps.planetGroup.add(layer.mesh)
      if (index.journeys) {
        journeys = buildJourneyLayer(world, index.journeys)
        journeys.object.visible = journeysVisible
        deps.planetGroup.add(journeys.object)
      }
      if (index.structures.length > 0) {
        structures = buildStructureLayer(world, index.structures, h.settlements)
        structures.mesh.visible = structuresVisible
        deps.planetGroup.add(structures.mesh)
      }
      const globe = deps.getGlobe()
      const res = structures?.reservoirs
      globe?.setReservoirs(res && res.cells.length > 0 ? res.cells : null, res?.built, res?.lost, res?.strength)
      if (!index.land) globe?.setLandRows(null, null, 0, 0)
      shownL0 = shownL1 = -1
      applyMarkerStyle()
      deps.getGlobe()?.setCapacity(h.capacity)
      chronicle.setIndex(index)
      timeline.setRange(h.years, h.snapshotInterval)
      shownS0 = shownS1 = -1
      const init = pending
      pending = null
      if (init && init.year !== null) timeline.setYear(init.year)
      if (!init || init.play) timeline.play()
      if (init && init.select !== null && init.select >= 0 && init.select < index.count) api.select(init.select, true)
    },
    setHistoryError(message: string) {
      timeline.setRange(null, 1, 'history unavailable')
      console.error('history simulation failed:', message)
    },
    pickAt(x: number, y: number) {
      if (!layer || !layer.mesh.visible) return -1
      const rect = deps.canvas.getBoundingClientRect()
      return layer.pick(deps.camera, x, y, rect.width, rect.height, 6)
    },
    select(id: number, fly: boolean) {
      if (!index || !world) return
      selected = id >= 0 && id < index.count ? id : -1
      layer?.setSelected(selected)
      journeys?.setHighlight(selected >= 0 ? index.foundingJourney[selected] : -1)
      deps.setUrlParam('select', selected >= 0 ? String(selected) : null)
      if (selected < 0) {
        inspector.hide()
        return
      }
      inspector.show(index, world, selected)
      if (fly && layer) {
        deps.onFly()
        deps.planetGroup.updateWorldMatrix(true, false)
        layer.centerLocal(selected, tmp)
        tmp.applyMatrix4(deps.planetGroup.matrixWorld)
        deps.fly.flyTo(tmp, Math.min(deps.camera.position.length(), FLY_DIST))
        api.setHover(-1) // the marker under the pointer is about to move away
      }
      shownS0 = -1 // force an inspector refresh this frame
    },
    setHover(id: number) {
      if (id === hovered) return
      hovered = id
      layer?.setHovered(id)
      deps.canvas.style.cursor = id >= 0 ? 'pointer' : ''
    },
    setViewMode(mode: ViewMode) {
      viewMode = mode
      applyMarkerStyle()
    },
    setMarkersVisible(show: boolean) {
      markersVisible = show
      applyMarkerStyle()
      if (!show) api.setHover(-1)
    },
    setJourneysVisible(show: boolean) {
      journeysVisible = show
      if (journeys) journeys.object.visible = show
    },
    setStructuresVisible(show: boolean) {
      structuresVisible = show
      if (structures) structures.mesh.visible = show
    },
    tick(dt: number, drawSize: THREE.Vector2, pixelRatio: number) {
      const year = timeline.tick(dt)
      if (!index || !layer) return
      const h = index.history
      snapshotAt(h, year, pos)
      const snapshotChanged = pos.s0 !== shownS0 || pos.s1 !== shownS1
      if (snapshotChanged) {
        layer.setSnapshot(pos.s0, pos.s1)
        updateCityLights(pos.s0)
        timeline.setStats(index.aliveCount[pos.s0], index.totalPopulation[pos.s0], index.townCount[pos.s0], index.cityCount[pos.s0])
        shownS0 = pos.s0
        shownS1 = pos.s1
      }
      // pulses last about a second of real time at any speed, and 20 years when paused
      const pulseYears = YEARS_PER_SECOND * (timeline.playing ? timeline.speed : 1)
      layer.setTime(year, pos.frac, pulseYears)
      layer.update(deps.camera, drawSize, pixelRatio)
      updateLand(year)
      deps.getGlobe()?.setYear(year)
      if (structures && structuresVisible) {
        structures.setTime(year, pulseYears)
        structures.update(deps.camera, drawSize, pixelRatio)
      }
      if (journeys && journeysVisible) {
        // a trail's bright head decays like the pulse (but stays local at high speed); its thread lingers longer
        journeys.setTime(year, Math.min(HEAD_MAX_YEARS, pulseYears), Math.min(THREAD_MAX_YEARS, Math.max(THREAD_MIN_YEARS, 2 * pulseYears)))
        journeys.update(deps.camera, drawSize, pixelRatio)
      }
      chronicle.update(year)
      if (selected >= 0) inspector.update(year, pos.s0, layer.displayedPopulation(selected))
    },
  }
  return api
}
