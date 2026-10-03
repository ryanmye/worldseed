// Glue between a History and everything that shows it: the timeline clock, the
// settlement markers, travelling groups, ports and dams, farmland, night-side city
// lights, trade routes and merchants, roads and bridges, the inspector and the chronicle.
// Per frame it only derives (snapshot, fraction) from the timeline's year and pushes
// uniforms; heavier work (copying snapshot rows, recomputing city lights, stats,
// uploading land rows) happens only when a snapshot index changes.

import * as THREE from 'three'
import { CITY_POPULATION, TOWN_POPULATION, type GeoFeature, type History, type World } from '../contract.ts'
import { isWaterCell, lakeArray, type GlobeMesh } from '../render/globe.ts'
import { ViewMode } from '../render/palette.ts'
import { buildSettlementLayer, MarkerStyle, type SettlementLayer } from '../render/settlements.ts'
import type { CameraFly } from '../render/cameraFly.ts'
import { buildJourneyLayer, type JourneyLayer } from '../render/journeys.ts'
import { buildStructureLayer, type StructureLayer } from '../render/structures.ts'
import { createDioramaLayer, DIORAMA_YIELD_FAR, DIORAMA_YIELD_NEAR, type DioramaLayer } from '../render/dioramas/layer.ts'
import { createChronicle } from './chronicle.ts'
import { buildHistoryIndex, landSnapshotAt, logScaled, snapshotAt, type HistoryIndex, type SnapshotPos } from './historyIndex.ts'
import { createInspector } from './inspector.ts'
import { createTimeline, YEARS_PER_SECOND } from './timeline.ts'
import { requestRender } from '../render/invalidate.ts'
import { buildTradeLayer, type TradeLayer } from '../render/trade.ts'
import { buildRoadLayer, type RoadLayer } from '../render/roads.ts'
import { addShortcut } from './shortcuts.ts'
import { createLabelLayer, type LabelLayer } from '../render/labels.ts'
import { detectFeatures, featuresAt, type FeatureMap } from '../sim/names/features.ts'
import { describePlaces } from './format.ts'

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
  /** 3D buildings, farms, docks and ships when zoomed in. */
  setBuildingsVisible(show: boolean): void
  /** Trade routes and merchants. */
  setTradeVisible(show: boolean): void
  /** Roads and bridges. */
  setRoadsVisible(show: boolean): void
  /** Map labels: named geography and settlement names. */
  setLabelsVisible(show: boolean): void
  /** The named features (by the current year) a cell lies in or on, e.g. "Kephia river, Hingara continent"; '' for none. */
  placesAt(cell: number): string
  tick(dt: number, drawSize: THREE.Vector2, pixelRatio: number): void
  /** The timeline is playing (the picture changes every frame). */
  isPlaying(): boolean
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
  let dioramas: DioramaLayer | null = null
  let buildingsVisible = true
  let trade: TradeLayer | null = null
  let tradeVisible = true
  let roads: RoadLayer | null = null
  let roadsVisible = true
  let labels: LabelLayer | null = null
  let labelsVisible = true
  let year = 0
  /** Detected features and the History feature of each (by kind and anchor), found lazily for readouts. */
  let geo: { map: FeatureMap; feature: (GeoFeature | null)[] } | null = null
  /** Features around the selected settlement, by naming year, and how many are shown. */
  let selPlaces: GeoFeature[] = []
  let selPlacesShown = -1
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
  addShortcut({
    keys: ['Escape'],
    label: 'Esc',
    description: 'Close a popup, else deselect',
    group: 'Panels',
    run: () => {
      if (selected < 0) return false
      api.select(-1, false)
    },
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
    if (dioramas) {
      deps.planetGroup.remove(dioramas.object)
      dioramas.dispose()
      dioramas = null
    }
    if (trade) {
      deps.planetGroup.remove(trade.object)
      trade.dispose()
      trade = null
    }
    if (roads) {
      deps.planetGroup.remove(roads.object)
      roads.dispose()
      roads = null
    }
    if (labels) {
      labels.dispose()
      labels = null
    }
    geo = null
  }

  /** Features of the history on (and, with `beside`, beside) a cell, named or not yet, via the detected regions. */
  function featuresNear(cell: number, beside: boolean): GeoFeature[] {
    if (!world || !index || cell < 0 || cell >= world.grid.cellCount) return []
    const fs = (index.history as Partial<History>).features
    if (!Array.isArray(fs) || !fs.length) return []
    if (!geo) {
      const map = detectFeatures(world)
      const byKey = new Map<string, GeoFeature>()
      for (const f of fs) byKey.set(f.kind + ':' + f.anchorCell, f)
      geo = { map, feature: map.features.map((d) => byKey.get(d.kind + ':' + d.anchorCell) ?? null) }
    }
    const out: GeoFeature[] = []
    for (const d of featuresAt(geo.map, world, cell, [], beside)) {
      const f = geo.feature[d]
      if (f) out.push(f)
    }
    return out
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
      const lake = lakeArray(world)
      const w = world
      index = buildHistoryIndex(h, (c) => isWaterCell(w, lake, c))
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
      dioramas = createDioramaLayer({
        world,
        history: h,
        land: index.land ? { interval: index.land.interval, count: index.land.count, landUse: index.land.landUse } : null,
        structures: structures ? structures.placements : null,
        reservoirs: structures ? structures.reservoirs : null,
      })
      dioramas.setVisible(buildingsVisible)
      deps.planetGroup.add(dioramas.object)
      const td = index.trade
      if (td) {
        const rd = index.roads
        trade = buildTradeLayer(world, {
          routes: td.routes,
          interval: td.interval,
          snapshots: td.count,
          volume: td.volume,
          road: rd ? { road: rd.road, interval: rd.interval, snapshots: rd.count } : null,
        })
        trade.object.visible = tradeVisible
        deps.planetGroup.add(trade.object)
        if (index.roads) {
          roads = buildRoadLayer(world, { road: index.roads.road, interval: index.roads.interval, snapshots: index.roads.count, routes: td.routes })
          roads.object.visible = roadsVisible
          deps.planetGroup.add(roads.object)
          dioramas.setBridges(roads.placements, roadsVisible)
        }
      }
      const globe = deps.getGlobe()
      const res = structures?.reservoirs
      globe?.setReservoirs(res && res.cells.length > 0 ? res.cells : null, res?.built, res?.lost, res?.strength)
      if (!index.land) globe?.setLandRows(null, null, 0, 0)
      shownL0 = shownL1 = -1
      applyMarkerStyle()
      const settlementLayer = layer
      labels = createLabelLayer(deps.canvas.parentElement ?? document.body, deps.canvas.nextSibling, world, h, { population: (id) => settlementLayer.displayedPopulation(id) })
      labels.setVisible(labelsVisible)
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
      const id = layer.pick(deps.camera, x, y, rect.width, rect.height, 6)
      // up close a settlement's whole cluster of buildings is clickable too
      return id >= 0 || !dioramas ? id : dioramas.pick(deps.camera, x, y, rect.width, rect.height)
    },
    select(id: number, fly: boolean) {
      if (!index || !world) return
      requestRender()
      selected = id >= 0 && id < index.count ? id : -1
      layer?.setSelected(selected)
      journeys?.setHighlight(selected >= 0 ? index.foundingJourney[selected] : -1)
      trade?.setSelected(selected)
      deps.setUrlParam('select', selected >= 0 ? String(selected) : null)
      labels?.setSelected(selected)
      selPlaces = selected >= 0 ? featuresNear(index.history.settlements[selected].cell, true).sort((a, b) => a.namedYear - b.namedYear) : []
      selPlacesShown = -1
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
      requestRender()
      layer?.setHovered(id)
      labels?.setHovered(id)
      deps.canvas.style.cursor = id >= 0 ? 'pointer' : ''
    },
    setViewMode(mode: ViewMode) {
      viewMode = mode
      requestRender()
      applyMarkerStyle()
    },
    setMarkersVisible(show: boolean) {
      markersVisible = show
      requestRender()
      applyMarkerStyle()
      if (!show) api.setHover(-1)
    },
    setJourneysVisible(show: boolean) {
      journeysVisible = show
      requestRender()
      if (journeys) journeys.object.visible = show
    },
    setStructuresVisible(show: boolean) {
      structuresVisible = show
      requestRender()
      if (structures) structures.mesh.visible = show
    },
    setBuildingsVisible(show: boolean) {
      buildingsVisible = show
      requestRender()
      dioramas?.setVisible(show)
    },
    setTradeVisible(show: boolean) {
      tradeVisible = show
      requestRender()
      if (trade) trade.object.visible = show
    },
    setRoadsVisible(show: boolean) {
      roadsVisible = show
      requestRender()
      if (roads) roads.object.visible = show
    },
    setLabelsVisible(show: boolean) {
      labelsVisible = show
      requestRender()
      labels?.setVisible(show)
    },
    placesAt(cell: number) {
      return describePlaces(featuresNear(cell, false).filter((f) => f.namedYear <= year))
    },
    tick(dt: number, drawSize: THREE.Vector2, pixelRatio: number) {
      year = timeline.tick(dt)
      if (!index || !layer) return
      const h = index.history
      snapshotAt(h, year, pos)
      const snapshotChanged = pos.s0 !== shownS0 || pos.s1 !== shownS1
      if (snapshotChanged) {
        layer.setSnapshot(pos.s0, pos.s1)
        updateCityLights(pos.s0)
        const td = index.trade
        const routesOpen = td ? td.openCount[Math.min(td.count - 1, Math.round((pos.s0 * h.snapshotInterval) / td.interval))] : undefined
        timeline.setStats(index.aliveCount[pos.s0], index.totalPopulation[pos.s0], index.townCount[pos.s0], index.cityCount[pos.s0], routesOpen)
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
      if (roads && roadsVisible) {
        roads.setTime(year)
        roads.update(deps.camera, drawSize, pixelRatio)
      }
      if (trade && tradeVisible) {
        trade.setRoadsShown(roads !== null && roadsVisible)
        trade.update(deps.camera, drawSize, pixelRatio)
        trade.setTime(year, timeline.playing, timeline.speed)
      }
      if (dioramas) {
        dioramas.setStructuresVisible(structuresVisible)
        dioramas.setTravellers(journeys ? journeys.groups : null, journeysVisible)
        dioramas.setTraders(trade ? trade.merchants : null, tradeVisible)
        dioramas.setBridges(roads ? roads.placements : null, roadsVisible)
        dioramas.setTime(year, pulseYears * 0.6)
        dioramas.update(deps.camera)
        // up close the flat markers and icons step back for the models
        const near = dioramas.active ? DIORAMA_YIELD_NEAR : 0
        const far = dioramas.active ? DIORAMA_YIELD_FAR : 0
        layer.setYield(near, far)
        structures?.setYield(near, far)
        journeys?.setYield(near, far)
        trade?.setYield(near, far)
        roads?.setYield(near, far)
      }
      chronicle.update(year)
      if (labels && labelsVisible) {
        labels.setYear(year, timeline.playing)
        labels.update(deps.camera, deps.planetGroup, drawSize.x / pixelRatio, drawSize.y / pixelRatio)
      }
      if (selected >= 0) {
        inspector.update(year, pos.s0, layer.displayedPopulation(selected))
        let n = 0
        while (n < selPlaces.length && selPlaces[n].namedYear <= year) n++
        if (n !== selPlacesShown) {
          selPlacesShown = n
          inspector.setPlaces(describePlaces(selPlaces.slice(0, n)))
        }
      }
    },
    isPlaying() {
      return timeline.playing
    },
  }
  return api
}
