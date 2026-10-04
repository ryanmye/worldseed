// Glue between a History and everything that shows it: the timeline clock, the
// settlement markers, travelling groups, ports and dams, farmland, night-side city
// lights, trade routes and merchants, roads and bridges, the inspector and the chronicle;
// expedition bases, lost expeditions and discoveries (outposts.ts, discoveries.ts, from
// expeditionsData.ts); the species panel, the Crops and Herds views, origins and the
// exchange web, and epidemic pulses (speciesPanel.ts, render/species.ts, from speciesData.ts);
// goods and the long-distance trade: lanes, relay legs, marts, posts, deposits, the Resources and
// price views and the Goods and trade panel (goodsPanel.ts, render/longhaul.ts, from goodsData.ts).
// Per frame it only derives (snapshot, fraction) from the timeline's year and pushes
// uniforms; heavier work (copying snapshot rows, recomputing city lights, stats,
// uploading land rows) happens only when a snapshot index changes.
//
// Open-ended playback: the history can be extended past its end (deps.requestYears asks
// for a longer run of the same world; extendHistory receives it). A longer run reproduces
// the shorter one bit for bit, and settlement ids are stable, so the swap keeps the year,
// the selection, the camera and the toggles. The per-history indexes and GPU layers are
// rebuilt off the critical path: one build step per task while the old ones keep drawing,
// then a cheap commit swaps them in at once. The diorama layer is updated in place (its
// town layouts are kept), and the surface bake does not depend on the history at all.

import * as THREE from 'three'
import { CITY_POPULATION, FeatureKind, TOWN_POPULATION, type GeoFeature, type History, type World } from '../contract.ts'
import { isWaterCell, lakeArray, surfaceRadius, type GlobeMesh } from '../render/globe.ts'
import { ViewMode, densityRampCss } from '../render/palette.ts'
import { buildSettlementLayer, MarkerStyle, type SettlementLayer } from '../render/settlements.ts'
import type { CameraFly } from '../render/cameraFly.ts'
import { buildJourneyLayer, type JourneyLayer } from '../render/journeys.ts'
import { buildStructureLayer, type StructureLayer } from '../render/structures.ts'
import { createDioramaLayer, DIORAMA_FAR, DIORAMA_NEAR, DIORAMA_YIELD_FAR, DIORAMA_YIELD_NEAR, type DioramaLayer } from '../render/dioramas/layer.ts'
import { createChronicle } from './chronicle.ts'
import { buildHistoryIndex, HISTORY_CHUNK_YEARS, landSnapshotAt, logScaled, NORM_YEARS, snapshotAt, type HistoryIndex, type SnapshotPos } from './historyIndex.ts'
import { createInspector } from './inspector.ts'
import { createTimeline, More, YEARS_PER_SECOND } from './timeline.ts'
import { requestRender } from '../render/invalidate.ts'
import { buildTradeLayer, type TradeLayer } from '../render/trade.ts'
import { buildRoadLayer, type RoadLayer } from '../render/roads.ts'
import { routeNetwork } from '../render/routeCurves.ts'
import { addShortcut } from './shortcuts.ts'
import { createLabelLayer, type LabelLayer } from '../render/labels.ts'
import { detectFeatures, featuresAt, type FeatureMap } from '../sim/names/features.ts'
import { describePlaces, formatPopulation } from './format.ts'
import { ANYONE, buildPeoplesData } from './peoplesData.ts'
import { createPeoplesView } from './peoplesPanel.ts'
import { buildExpeditionData, discoveryNote } from './expeditionsData.ts'
import { buildOutpostLayer, type OutpostLayer } from '../render/outposts.ts'
import { buildDiscoveryLayer, type DiscoveryLayer } from '../render/discoveries.ts'
import { applySpeciesStandIn, buildSpeciesData, CASH_VIEW, cropSnapshotAt, inViewCategory, layerOf } from './speciesData.ts'
import { buildSpeciesLayer, type SpeciesLayer } from '../render/species.ts'
import { createSpeciesView } from './speciesPanel.ts'
import { buildContactPulses, type ContactPulses } from '../render/knownWorld.ts'
import { buildPopulationDensity, type PopulationDensity } from './populationDensity.ts'
import { createPolitiesView, type PolitiesBuilt } from './politiesPanel.ts'
import type { PolityLayer } from '../render/polities.ts'
import { createGoodsView, type GoodsBuilt } from './goodsPanel.ts'
import type { LayerToggle } from './overlay.ts'

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
  /** Ask for a longer run (`years` long) of the current world; answered by extendHistory or extendFailed. */
  requestYears(years: number): void
  /** Something changed outside a frame (a swapped-in history): wake the render loop. */
  wake(): void
  /** While a known world is shown the clouds are drawn over its mist (and back under the overlays after). */
  setCloudsOverFog?(on: boolean): void
  /** Offer a view mode or not (the Crops and Herds views need the history's crop and herd layers). */
  setViewModeAvailable?(mode: ViewMode, available: boolean): void
  /** Add a layer toggle (the Factions toggle appears with the first history that has factions). */
  addLayerToggle?(t: LayerToggle): HTMLInputElement
}

export interface InitialHistoryState {
  year: number | null
  play: boolean
  select: number | null
  /** Known world to show: a people id (people=<id>), or what nobody knows (known=all). */
  people?: number | null
  knownAll?: boolean
  /** Species to select (species=<id>). */
  species?: number | null
  /** Faction (polity) to select (polity=<id>), and whether the Factions layer is on (factions=0 hides it). */
  polity?: number | null
  factions?: boolean
}

/** Longest history: memory grows with years times settlements ever founded (about 45 MB of arrays at 6000 years, see the report). */
export const MAX_YEARS = 6000
/** Length of a history `years` long extended once (the next chunk boundary), capped. */
export const nextHistoryLength = (years: number) => Math.min(MAX_YEARS, (Math.floor(years / HISTORY_CHUNK_YEARS + 1e-9) + 1) * HISTORY_CHUNK_YEARS)

/** Timing of the last history swap, for measurement (perf=1). */
export interface SwapStats {
  years: number
  /** Simulation time in the worker. */
  simMs: number
  /** Main-thread time of all build steps and the commit, the longest single step, and the commit. */
  totalMs: number
  maxStepMs: number
  commitMs: number
  steps: Record<string, number>
}

export interface HistoryView {
  /** A new world is showing; history is being simulated. */
  setWorld(world: World): void
  setHistory(history: History): void
  setHistoryError(message: string): void
  /** Settlement under CSS pixel (x, y) relative to the canvas, or -1. */
  pickAt(x: number, y: number): number
  select(id: number, fly: boolean): void
  /**
   * A click that hit no settlement landed on cell `cell`: if the Factions layer or view is
   * on and the cell belongs to a polity, select it (deselecting if it is already selected).
   * No-op off the Factions view, over water, or on unclaimed land.
   */
  selectFactionAt(cell: number): void
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
  /** The timeline is playing (the picture changes every frame); false while it waits at the end for more history. */
  isPlaying(): boolean
  /** A longer run of the current world (requested through deps.requestYears), with its simulation time. */
  extendHistory(history: History, ms: number): void
  /** The requested longer run failed: keep the current history and stop asking. */
  extendFailed(message: string): void
  /** Length of the current history in years (0 while there is none). */
  readonly years: number
  /** Timing of the last swap (null before the first). */
  readonly lastSwap: SwapStats | null
  /** Settlement markers coloured by people. */
  setPeopleTint(on: boolean): void
  /** Whether a cell is unknown in the known world shown (so the readout should not describe it). */
  isCellHidden(cell: number): boolean
  /** Expedition trails, the marks of lost expeditions, supply lines and discoveries. */
  setExpeditionsVisible(show: boolean): void
}

const FLY_DIST = 2.3
/** Bounds on how long a route stays faintly visible after the group passed (years). */
const THREAD_MIN_YEARS = 40
const THREAD_MAX_YEARS = 120
/** Upper bound on how long a trail's bright head takes to decay (years). */
const HEAD_MAX_YEARS = 30

/** The History feature (by kind and anchor) of each detected feature region, or null. */
function featureOfRegions(map: FeatureMap, h: History): (GeoFeature | null)[] {
  const fs = (h as Partial<History>).features
  const byKey = new Map<string, GeoFeature>()
  if (Array.isArray(fs)) for (const f of fs) byKey.set(f.kind + ':' + f.anchorCell, f)
  return map.features.map((d) => byKey.get(d.kind + ':' + d.anchorCell) ?? null)
}

/**
 * Why `next` cannot replace `cur` as a longer run of the same world, or '' if it can: it
 * must be longer, keep the snapshot layout and the settlements (ids, places, founding years)
 * and be internally consistent. Differences in the shared years' numbers are only warned
 * about (the swap is then not seamless, but the history is still usable).
 */
function degenerate(cur: History, next: History): string {
  const N0 = cur.settlements.length
  const N = next.settlements?.length ?? 0
  if (!(next.years > cur.years)) return `not longer (${next.years} years after ${cur.years})`
  if (next.snapshotInterval !== cur.snapshotInterval) return 'a different snapshot interval'
  if (N === 0) return 'no settlements'
  if (N < N0) return `fewer settlements (${N} after ${N0})`
  if (!(next.population instanceof Float32Array) || next.population.length !== next.snapshotCount * N || next.snapshotCount !== Math.floor(next.years / next.snapshotInterval) + 1) return 'inconsistent snapshot arrays'
  const stride = Math.max(1, Math.floor(N0 / 97))
  let popDiffs = 0
  const s = cur.snapshotCount - 1
  for (let i = 0; i < N0; i += stride) {
    const a = cur.settlements[i], b = next.settlements[i]
    if (!b || a.cell !== b.cell || a.foundedYear !== b.foundedYear || a.parent !== b.parent) return `settlement ${i} is not the same in the longer run`
    if (cur.population[s * N0 + i] !== next.population[s * N + i]) popDiffs++
  }
  if (popDiffs > 0) console.warn(`longer history: ${popDiffs} sampled populations at year ${cur.years} differ from the shorter run (the simulation is not prefix-stable)`)
  return ''
}

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
  let outposts: OutpostLayer | null = null
  let discoveries: DiscoveryLayer | null = null
  let speciesLayer: SpeciesLayer | null = null
  let epidemics: ContactPulses | null = null
  /** Per-cell polity ids of the faction layer (WATER, -1 or an id), for click-to-select-faction. */
  let polityLayer: PolityLayer | null = null
  let expeditionsVisible = true
  /** Selected species (-1 none), and what the Crops / Herds colours and the grown discs last showed. */
  let speciesSelected = -1
  let shownSpeciesKey = -1
  let shownGrownKey = -1
  let speciesRgb: Uint8Array | null = null
  let grownFlags: Uint8Array | null = null
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
  /** Population view: per-cell density (populationDensity.ts), and the snapshot it last showed. */
  let popDensity: PopulationDensity | null = null
  let shownPopS0 = -1
  /** Faction stats last given to the timeline ("states:wars:largest bloc", '' none), and the routes open with them. */
  let shownPolStats = ''
  let statRoutes: number | undefined = undefined
  const pos: SnapshotPos = { s0: 0, s1: 0, frac: 0 }
  const tmp = new THREE.Vector3()
  // ---- extension state ----
  /** Length (years) of the longer run asked for and not yet swapped in, 0 for none. */
  let requested = 0
  /** The last extension failed: do not ask again for this world. */
  let failed = false
  /** A longer history that arrived during the initial animation: swapped in once it ends. */
  let deferred: { h: History; ms: number } | null = null
  /** The staged rebuild in progress (cancel() drops it), or null. */
  let staging: { cancel(): void } | null = null
  /** Simulation milliseconds per simulated year (for the prefetch lead), from the last run. */
  let simMsPerYear = 0.6
  let lastSwap: SwapStats | null = null

  const timeline = createTimeline(deps.bottom, {
    onSettled(year: number, playing: boolean) {
      if (!index) return
      deps.setUrlParam('year', playing ? null : String(Math.floor(year + 1e-6)))
      deps.setUrlParam('play', playing ? null : '0')
    },
    onWantMore() {
      wantMore()
    },
  })

  const capMessage = () => `History ends at year ${MAX_YEARS}, the longest run kept in memory`

  /** Ask the worker for the next chunk of history, unless one is on its way or there can be none. */
  function wantMore() {
    if (!index || requested > 0 || failed || deferred || staging) return
    const cur = index.history.years
    const next = nextHistoryLength(cur)
    if (next <= cur) {
      timeline.setMore(More.No, capMessage())
      return
    }
    requested = next
    timeline.setMore(More.Pending)
    deps.requestYears(next)
  }

  /** Playback lead (real seconds) at which to ask for more: the expected simulation time of the next run, plus margin. */
  function syncPrefetchLead() {
    const cur = index ? index.history.years : 0
    timeline.setPrefetchLead((simMsPerYear * nextHistoryLength(cur)) / 1000 + 1.5)
  }
  const inspector = createInspector(deps.left, {
    onSelect: (id) => api.select(id, true),
    onClose: () => api.select(-1, false),
  })
  const chronicle = createChronicle(deps.right, {
    onSelect: (id) => api.select(id, true),
    landName: (id, y) => {
      // the landmass (continent or island) a landfall colony stands on, if named by then
      if (!index || id < 0 || id >= index.count) return null
      for (const f of featuresNear(index.history.settlements[id].cell, false)) {
        if (f.namedYear > y) continue
        if (f.kind === FeatureKind.Continent) return `continent of ${f.name}`
        if (f.kind === FeatureKind.Island) return `island of ${f.name}`
      }
      return null
    },
    southern: (id) => (world && index && id >= 0 && id < index.count ? world.grid.positions[index.history.settlements[id].cell * 3 + 1] < 0 : false),
  })
  // peoples panel, known-world view, inspector people section (its Esc comes first: Esc leaves the known world before it deselects)
  const peoples = createPeoplesView({
    right: deps.right,
    bottom: deps.bottom,
    inspectorSlot: inspector.peopleSlot,
    planetGroup: deps.planetGroup,
    setUrlParam: deps.setUrlParam,
    onSelectionChange: () => applyKnownWorld(),
  })
  // factions: panel, layer, inspector section (its Esc deselects the faction before the settlement)
  const polities = createPolitiesView({
    right: deps.right,
    inspectorSlot: inspector.politySlot,
    planetGroup: deps.planetGroup,
    getGlobe: deps.getGlobe,
    setUrlParam: deps.setUrlParam,
    onSelectSettlement: (id) => api.select(id, true),
    addLayerToggle: deps.addLayerToggle,
    setViewModeAvailable: deps.setViewModeAvailable,
    layerOn: initial.factions ?? true,
    initialPolity: initial.polity ?? null,
  })
  // goods and trade: panel, long-haul layer, inspector section (its Esc deselects a tradition, secret, deposit or lane first)
  const goods = createGoodsView({
    right: deps.right,
    inspectorSlot: inspector.goodsSlot,
    planetGroup: deps.planetGroup,
    setUrlParam: deps.setUrlParam,
    onSelectSettlement: (id) => api.select(id, true),
    flyToCell: (cell) => {
      if (!world || cell < 0 || cell >= world.grid.cellCount) return
      deps.onFly()
      deps.planetGroup.updateWorldMatrix(true, false)
      const P = world.grid.positions
      const r = surfaceRadius(world, cell)
      tmp.set(P[cell * 3] * r, P[cell * 3 + 1] * r, P[cell * 3 + 2] * r).applyMatrix4(deps.planetGroup.matrixWorld)
      deps.fly.flyTo(tmp, Math.min(deps.camera.position.length(), FLY_DIST))
      requestRender()
      deps.wake()
    },
    addLayerToggle: deps.addLayerToggle,
    setViewModeAvailable: deps.setViewModeAvailable,
  })
  addShortcut({
    keys: ['Escape'],
    label: 'Esc',
    description: 'Close a popup, else leave the known world, else deselect',
    group: 'Panels',
    run: () => {
      if (selected < 0) return false
      api.select(-1, false)
    },
  })
  // species panel, Crops / Herds legend, inspector species section (after the peoples panel: it goes under it)
  const speciesView = createSpeciesView({
    right: deps.right,
    inspectorSlot: inspector.speciesSlot,
    setUrlParam: deps.setUrlParam,
    onSelect: (s) => {
      speciesSelected = s
      speciesLayer?.setSelected(s)
      shownSpeciesKey = shownGrownKey = -1
      requestRender()
      deps.wake()
    },
    onSelectTechnique: (k) => {
      speciesLayer?.setTechnique(k)
      requestRender()
      deps.wake()
    },
  })
  /** Species view category of a map view: 0 Crops, 1 Herds, CASH_VIEW Cash crops, -1 others. */
  const speciesViewCategory = (m: ViewMode) => (m === ViewMode.Crops ? 0 : m === ViewMode.Herds ? 1 : m === ViewMode.Cash ? CASH_VIEW : -1)

  // ---------- legend of the Population view ----------
  const popLegend = document.createElement('div')
  popLegend.className = 'panel sp-legend hidden'
  const popLegendTitle = document.createElement('div')
  popLegendTitle.className = 'sp-legend-title'
  popLegendTitle.textContent = 'People per cell'
  const popLegendList = document.createElement('div')
  popLegendList.className = 'sp-legend-list'
  popLegend.append(popLegendTitle, popLegendList)
  {
    const mapPanel = deps.right.querySelector('.map-panel')
    deps.right.insertBefore(popLegend, mapPanel ? mapPanel.nextSibling : deps.right.firstChild)
  }
  let popLegendMax = -1
  /** Rebuilds the legend's tick swatches for the fixed `densityMax` of the history on screen. */
  function buildPopLegend(densityMax: number) {
    if (densityMax === popLegendMax) return
    popLegendMax = densityMax
    popLegendList.replaceChildren()
    if (densityMax <= 0) return
    const logMax = Math.log1p(densityMax)
    for (const frac of [1, 0.66, 0.33, 0.1]) {
      const item = document.createElement('div')
      item.className = 'sp-legend-item none'
      const sw = document.createElement('span')
      sw.className = 'sp-swatch'
      sw.style.background = densityRampCss(frac)
      const value = Math.expm1(frac * logMax)
      item.append(sw, `~${formatPopulation(value)}`)
      popLegendList.appendChild(item)
    }
    const none = document.createElement('div')
    none.className = 'sp-legend-item none'
    const sw = document.createElement('span')
    sw.className = 'sp-swatch neutral'
    none.append(sw, 'Unsettled')
    popLegendList.appendChild(none)
  }

  /** The known world shown (or none) to the expedition and species layers: their masks, and the draw order over the clouds. */
  function applyKnownWorld() {
    const cells = peoples.knownCells
    outposts?.setKnownMask(cells)
    discoveries?.setKnownMask(cells)
    speciesLayer?.setKnownMask(cells)
    epidemics?.setKnownMask(cells)
    polities.setKnownMask(cells)
    goods.setKnownMask(cells)
    const on = cells !== null
    goods.setMasked(on)
    // the clouds go over the mist; the masked markers over the clouds (nothing unknown is drawn by them)
    if (layer) layer.mesh.renderOrder = on ? 9.7 : 8
    outposts?.setFlagOrder(on ? 9.72 : 8.3)
    if (discoveries) discoveries.mesh.renderOrder = on ? 9.74 : 8.4
    speciesLayer?.setOrder(on ? 9.73 : 8.45)
    deps.setCloudsOverFog?.(on)
    requestRender()
  }

  /** The per-history objects, built step by step (see buildSteps). */
  interface Built {
    index?: HistoryIndex
    population?: PopulationDensity
    layer?: SettlementLayer
    journeys?: JourneyLayer | null
    structures?: StructureLayer | null
    trade?: TradeLayer | null
    roads?: RoadLayer | null
    outposts?: OutpostLayer | null
    discoveries?: DiscoveryLayer | null
    speciesLayer?: SpeciesLayer | null
    epidemics?: ContactPulses | null
    polities?: PolitiesBuilt | null
    goods?: GoodsBuilt | null
  }

  function disposeBuilt(b: Built) {
    const drop = (o: { dispose(): void } | null | undefined, obj: THREE.Object3D | undefined) => {
      if (!o) return
      if (obj) deps.planetGroup.remove(obj)
      o.dispose()
    }
    drop(b.layer, b.layer?.mesh)
    drop(b.journeys, b.journeys?.object)
    drop(b.structures, b.structures?.mesh)
    drop(b.trade, b.trade?.object)
    drop(b.roads, b.roads?.object)
    drop(b.outposts, b.outposts?.object)
    drop(b.discoveries, b.discoveries?.mesh)
    drop(b.speciesLayer, b.speciesLayer?.object)
    drop(b.epidemics, b.epidemics?.mesh)
  }
  /** A staged build that was never committed: its faction layer too. */
  function disposeStaged(b: Built) {
    disposeBuilt(b)
    polities.disposeBuilt(b.polities)
    goods.disposeBuilt(b.goods)
  }

  function clearLayer() {
    disposeBuilt({ layer: layer ?? undefined, journeys, structures, trade, roads, outposts, discoveries, speciesLayer, epidemics })
    layer = null
    journeys = null
    structures = null
    trade = null
    roads = null
    outposts = null
    discoveries = null
    speciesLayer = null
    epidemics = null
    if (dioramas) {
      deps.planetGroup.remove(dioramas.object)
      dioramas.dispose()
      dioramas = null
    }
    if (labels) {
      labels.dispose()
      labels = null
    }
    polities.commit(null, null, false)
    goods.commit(null, false)
    polityLayer = null
    geo = null
  }

  /**
   * The build steps for history `h`, each a separately timed piece of main-thread work that
   * fills in `b`. Nothing here touches what is on screen: commit() swaps the result in.
   */
  function buildSteps(w: World, h: History, b: Built): { name: string; run(): void }[] {
    return [
      {
        name: 'index',
        run() {
          const lake = lakeArray(w)
          const water = (c: number) => isWaterCell(w, lake, c)
          const pd = buildPeoplesData(w, h, water) // first: the dev stand-ins may add events
          const standIn = applySpeciesStandIn(w, h, pd)
          if (standIn) console.info('species: using the dev stand-in data (speciesData.ts STAND_IN)')
          b.index = buildHistoryIndex(h, water)
          b.index.peoples = pd
          b.index.species = buildSpeciesData(w, h, pd, standIn)
          b.index.expeditions = buildExpeditionData(w, h, b.index.journeys)
        },
      },
      {
        name: 'expeditions',
        run() {
          const ix = b.index!
          const ed = ix.expeditions!
          const pd = ix.peoples
          const rgb = (id: number) => (pd ? ([pd.rgb[pd.people[id] * 3], pd.rgb[pd.people[id] * 3 + 1], pd.rgb[pd.people[id] * 3 + 2]] as const) : null)
          b.outposts = ed.outposts.length > 0 || ed.lostCell.length > 0 ? buildOutpostLayer(w, h, ed, rgb) : null
          b.discoveries = buildDiscoveryLayer(w, ed.discoveries)
        },
      },
      {
        name: 'species',
        run() {
          const sd = b.index!.species
          b.speciesLayer = sd ? buildSpeciesLayer(w, sd, h, b.index!.peoples?.people ?? null) : null
          const n = sd ? sd.epidemicCells.length : 0
          if (sd && n > 0) {
            // a sickly yellow and a bruised purple
            const a = new Float32Array(n * 3), c = new Float32Array(n * 3)
            for (let k = 0; k < n; k++) {
              a.set([0.82, 0.88, 0.36], k * 3)
              c.set([0.62, 0.36, 0.8], k * 3)
            }
            b.epidemics = buildContactPulses(w, sd.epidemicCells, sd.epidemicYears, a, c)
          } else b.epidemics = null
        },
      },
      { name: 'population', run: () => (b.population = buildPopulationDensity(w, b.index!)) },
      { name: 'polities', run: () => (b.polities = polities.build(w, h)) },
      // (after the factions: posts take their owners' faction colours)
      { name: 'goods', run: () => (b.goods = goods.build(w, h, b.index!.maxPopulation)) },
      { name: 'settlements', run: () => (b.layer = buildSettlementLayer(w, h, b.index!.maxPopulation)) },
      { name: 'journeys', run: () => (b.journeys = b.index!.journeys ? buildJourneyLayer(w, b.index!.journeys, NORM_YEARS) : null) },
      { name: 'structures', run: () => (b.structures = b.index!.structures.length > 0 ? buildStructureLayer(w, b.index!.structures, h.settlements) : null) },
      {
        // the bundled route network (cached per route set, shared by the trade and road layers)
        name: 'network',
        run() {
          const td = b.index!.trade
          if (td) routeNetwork(w, td.routes.pathOffsets, td.routes.path, td.routes.count)
        },
      },
      {
        name: 'trade',
        run() {
          const td = b.index!.trade
          const rd = b.index!.roads
          b.trade = td
            ? buildTradeLayer(w, {
                routes: td.routes,
                interval: td.interval,
                snapshots: td.count,
                volume: td.volume,
                road: rd ? { road: rd.road, interval: rd.interval, snapshots: rd.count } : null,
                normSnapshots: Math.floor(NORM_YEARS / td.interval) + 1,
              })
            : null
        },
      },
      {
        name: 'roads',
        run() {
          const td = b.index!.trade
          const rd = b.index!.roads
          b.roads = td && rd ? buildRoadLayer(w, { road: rd.road, interval: rd.interval, snapshots: rd.count, routes: td.routes }) : null
        },
      },
    ]
  }

  /**
   * Swap the built objects in (and dispose the old ones), carrying over the selection, hover
   * and toggles. `extend`: a longer run of the history on screen (keep the chronicle rows and
   * the diorama layouts; the timeline range only grows).
   */
  function commit(w: World, h: History, b: Built, extend: boolean) {
    const old: Built = { layer: layer ?? undefined, journeys, structures, trade, roads, outposts, discoveries, speciesLayer, epidemics }
    disposeBuilt(old)
    index = b.index!
    layer = b.layer!
    deps.planetGroup.add(layer.mesh)
    journeys = b.journeys ?? null
    if (journeys) {
      journeys.object.visible = journeysVisible
      deps.planetGroup.add(journeys.object)
    }
    structures = b.structures ?? null
    if (structures) {
      structures.mesh.visible = structuresVisible
      deps.planetGroup.add(structures.mesh)
    }
    trade = b.trade ?? null
    if (trade) {
      trade.object.visible = tradeVisible
      deps.planetGroup.add(trade.object)
    }
    roads = b.roads ?? null
    if (roads) {
      roads.object.visible = roadsVisible
      deps.planetGroup.add(roads.object)
    }
    journeys?.setExpeditionsVisible(expeditionsVisible)
    outposts = b.outposts ?? null
    if (outposts) {
      outposts.setFlagsVisible(markersVisible)
      outposts.setTracesVisible(expeditionsVisible)
      outposts.setCampsVisible(buildingsVisible)
      deps.planetGroup.add(outposts.object)
    }
    discoveries = b.discoveries ?? null
    if (discoveries) {
      discoveries.mesh.visible = expeditionsVisible
      deps.planetGroup.add(discoveries.mesh)
    }
    speciesLayer = b.speciesLayer ?? null
    if (speciesLayer) deps.planetGroup.add(speciesLayer.object)
    epidemics = b.epidemics ?? null
    if (epidemics) {
      epidemics.mesh.visible = markersVisible
      deps.planetGroup.add(epidemics.mesh)
    }
    {
      const sd = index.species
      deps.setViewModeAvailable?.(ViewMode.Crops, !!sd?.crop)
      deps.setViewModeAvailable?.(ViewMode.Herds, !!sd?.herd)
      deps.setViewModeAvailable?.(ViewMode.Cash, !!sd?.cash)
      speciesSelected = -1
      shownSpeciesKey = shownGrownKey = -1
      speciesRgb = sd?.crop || sd?.herd || sd?.cash ? new Uint8Array(w.grid.cellCount * 3) : null
      grownFlags = sd ? new Uint8Array(w.grid.cellCount) : null
      speciesLayer?.setOriginCategory(speciesViewCategory(viewMode))
      speciesView.setData(sd, h, index.peoples?.people ?? null, index.peoples?.names ?? null, extend)
    }
    const dioramaInputs = {
      world: w,
      history: h,
      land: index.land ? { interval: index.land.interval, count: index.land.count, landUse: index.land.landUse } : null,
      structures: structures ? structures.placements : null,
      reservoirs: structures ? structures.reservoirs : null,
    }
    if (extend && dioramas) dioramas.setHistory(dioramaInputs)
    else {
      if (dioramas) {
        deps.planetGroup.remove(dioramas.object)
        dioramas.dispose()
      }
      dioramas = createDioramaLayer(dioramaInputs)
      dioramas.setVisible(buildingsVisible)
      deps.planetGroup.add(dioramas.object)
    }
    dioramas.setBridges(roads ? roads.placements : null, roadsVisible)
    const globe = deps.getGlobe()
    const res = structures?.reservoirs
    globe?.setReservoirs(res && res.cells.length > 0 ? res.cells : null, res?.built, res?.lost, res?.strength)
    if (!index.land) globe?.setLandRows(null, null, 0, 0)
    shownL0 = shownL1 = -1
    applyMarkerStyle()
    const settlementLayer = layer
    labels?.dispose()
    labels = createLabelLayer(deps.canvas.parentElement ?? document.body, deps.canvas.nextSibling, w, h, { population: (id) => settlementLayer.displayedPopulation(id) }, NORM_YEARS)
    labels.setVisible(labelsVisible)
    polities.commit(b.polities ?? null, labels, extend)
    goods.commit(b.goods ?? null, extend)
    polityLayer = b.polities?.layer ?? null
    globe?.setCapacity(h.capacity)
    popDensity = b.population ?? null
    shownPopS0 = -1
    buildPopLegend(popDensity?.densityMax ?? 0)
    popLegend.classList.toggle('hidden', viewMode !== ViewMode.Population || !popDensity)
    chronicle.setIndex(index, extend)
    // the feature regions are geography (kept); which History feature each is may have grown
    if (geo) geo = { map: geo.map, feature: featureOfRegions(geo.map, index.history) }
    shownS0 = shownS1 = -1
    // peoples: colours, masks and the known world for the new history (the selected people is kept)
    peoples.setIndex(index, w, { settlements: layer, labels, dioramas }, extend)
    applyKnownWorld()
    if (extend) {
      // the same settlement (ids are stable), shown from the longer history
      layer.setHovered(hovered)
      labels.setHovered(hovered)
      outposts?.setHovered(hovered)
      if (selected >= index.count) selected = -1
      if (selected >= 0) reselect(selected)
    }
  }

  /** Re-apply a selection after a swap: highlight, inspector (with the whole run's sparkline), places. */
  function reselect(id: number) {
    if (!index || !world) return
    selected = id
    layer?.setSelected(id)
    outposts?.setSelected(id)
    journeys?.setHighlight(index.foundingJourney[id])
    trade?.setSelected(id)
    labels?.setSelected(id)
    selPlaces = featuresNear(index.history.settlements[id].cell, true).sort((a, b) => a.namedYear - b.namedYear)
    selPlacesShown = -1
    inspector.show(index, world, id)
    peoples.showSettlement(id)
    speciesView.showSettlement(id, index.isOutpost[id] === 1)
    polities.showSettlement(id)
    goods.showSettlement(id)
  }

  /** Build the longer history `h` step by step, one step per task, then commit it. */
  function stage(h: History, ms: number) {
    const w = world!
    const b: Built = {}
    const steps = buildSteps(w, h, b)
    const times: Record<string, number> = {}
    let k = 0
    let cancelled = false
    let timer = 0
    let total = 0
    let maxStep = 0
    const cancel = () => {
      cancelled = true
      window.clearTimeout(timer)
      disposeStaged(b)
    }
    const next = () => {
      timer = 0
      if (cancelled || world !== w) return
      const t0 = performance.now()
      if (k < steps.length) {
        const step = steps[k++]
        try {
          step.run()
        } catch (err) {
          staging = null
          disposeStaged(b)
          api.extendFailed(`building the ${step.name} layer failed: ${err instanceof Error ? err.message : String(err)}`)
          return
        }
        const dt = performance.now() - t0
        times[step.name] = dt
        total += dt
        maxStep = Math.max(maxStep, dt)
        timer = window.setTimeout(next, 0)
        return
      }
      // all built: swap in, in one task
      staging = null
      requested = 0
      commit(w, h, b, true)
      timeline.extendRange(h.years)
      timeline.setMore(h.years >= MAX_YEARS ? More.No : More.Yes, h.years >= MAX_YEARS ? capMessage() : '')
      syncPrefetchLead()
      const commitMs = performance.now() - t0
      times.commit = commitMs
      total += commitMs
      lastSwap = { years: h.years, simMs: ms, totalMs: total, maxStepMs: Math.max(maxStep, commitMs), commitMs, steps: times }
      console.info(
        `history extended to ${h.years} years: simulation ${ms.toFixed(0)} ms (worker); main thread ${total.toFixed(0)} ms in ${steps.length + 1} tasks, longest ${lastSwap.maxStepMs.toFixed(0)} ms (` +
          Object.entries(times).map(([n, t]) => `${n} ${t.toFixed(1)}`).join(', ') +
          `); ${h.settlements.length} settlements, ${h.events.length} events`,
      )
      requestRender()
      deps.wake()
    }
    staging = { cancel }
    timer = window.setTimeout(next, 0)
  }

  /** Features of the history on (and, with `beside`, beside) a cell, named or not yet, via the detected regions. */
  function featuresNear(cell: number, beside: boolean): GeoFeature[] {
    if (!world || !index || cell < 0 || cell >= world.grid.cellCount) return []
    const fs = (index.history as Partial<History>).features
    if (!Array.isArray(fs) || !fs.length) return []
    if (!geo) {
      const map = detectFeatures(world)
      geo = { map, feature: featureOfRegions(map, index.history) }
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
    // (expedition bases light no lamps)
    const out = index.isOutpost
    for (let i = 0; i < N; i++) {
      const p = h.population[base + i]
      if (p > 0) cellPop[h.settlements[i].cell] = 0
    }
    for (let i = 0; i < N; i++) {
      const p = h.population[base + i]
      if (p > 0 && !out[i]) cellPop[h.settlements[i].cell] += p
    }
    lights.fill(0)
    for (let i = 0; i < N; i++) {
      const c = h.settlements[i].cell
      if (h.population[base + i] > 0 && !out[i]) lights[c] = Math.max(lights[c], logScaled(cellPop[c], index.logMax))
    }
    const { neighborOffsets: off, neighbors: nb } = world.grid
    for (let i = 0; i < N; i++) {
      if (h.population[base + i] <= 0 || out[i]) continue
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

  /** Population view: the per-cell density of snapshot `s` (pure function of `s`; see populationDensity.ts). */
  function updatePopulationDensity(s: number) {
    const globe = deps.getGlobe()
    if (!globe || !popDensity) return
    popDensity.update(s)
    globe.setDensity(popDensity.density, popDensity.densityMax)
  }

  /**
   * Crops and Herds views: the per-cell colours of the land snapshot shown (the selected
   * species bright, the others dimmed), and for the selected species on any other view,
   * the discs where it is grown. Rewritten only when the snapshot, view or selection changes.
   */
  function updateSpecies(year: number) {
    const sd = index?.species
    if (!sd || !world) return
    const N = world.grid.cellCount
    const l = cropSnapshotAt(sd, year)
    const cat = speciesViewCategory(viewMode)
    const shownLayer = cat === 0 ? sd.crop : cat === 1 ? sd.herd : cat === CASH_VIEW ? sd.cash : null
    const globe = deps.getGlobe()
    if (shownLayer && speciesRgb && globe) {
      const key = (l * 16 + cat + 1) * 64 + speciesSelected + 1
      if (key !== shownSpeciesKey) {
        shownSpeciesKey = key
        const dimOthers = speciesSelected >= 0 && inViewCategory(sd.list[speciesSelected].category, cat)
        const o = l * N
        // (the Cash crops view tells farmland growing only food from unfarmed land by a lighter neutral)
        const food = cat === CASH_VIEW ? sd.crop : null
        for (let c = 0; c < N; c++) {
          const v = shownLayer[o + c] - 1
          let r = 46, g = 52, b = 50 // not farmed: neutral (palette.ts LANDUSE_WILD)
          if (food && food[o + c] > 0) {
            r = 70
            g = 76
            b = 72
          }
          if (v >= 0 && v < sd.count) {
            r = sd.rgb[v * 3] * 255
            g = sd.rgb[v * 3 + 1] * 255
            b = sd.rgb[v * 3 + 2] * 255
            if (dimOthers && v !== speciesSelected) {
              r = r * 0.28 + 46 * 0.72
              g = g * 0.28 + 52 * 0.72
              b = b * 0.28 + 50 * 0.72
            }
          }
          speciesRgb[c * 3] = r
          speciesRgb[c * 3 + 1] = g
          speciesRgb[c * 3 + 2] = b
        }
        globe.setSpeciesColors(speciesRgb)
      }
    }
    // discs where the selected species is grown (not on the view that already colours it)
    const sel = speciesSelected
    const selLayer = sel >= 0 ? layerOf(sd, sel) : null
    const showDiscs = selLayer !== null && !inViewCategory(sd.list[sel].category, cat) && grownFlags !== null
    const gk = showDiscs ? l * 64 + sel + 1 : 0
    if (gk !== shownGrownKey) {
      shownGrownKey = gk
      if (showDiscs && grownFlags && selLayer) {
        const o = l * N
        for (let c = 0; c < N; c++) grownFlags[c] = selLayer[o + c] === sel + 1 ? 1 : 0
        speciesLayer?.setGrown(grownFlags)
      } else speciesLayer?.setGrown(null)
    }
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
      staging?.cancel()
      staging = null
      deferred = null
      requested = 0
      failed = false
      clearLayer()
      selected = -1
      hovered = -1
      inspector.hide()
      peoples.setWorld(w)
      polities.setWorld(w)
      goods.setWorld(w)
      speciesView.setData(null, null, null, null, false)
      speciesView.showSettlement(-1, false)
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
      staging?.cancel()
      staging = null
      deferred = null
      requested = 0
      const b: Built = {}
      for (const step of buildSteps(world, h, b)) step.run()
      commit(world, h, b, false)
      timeline.setRange(h.years, h.snapshotInterval)
      timeline.setMore(h.years >= MAX_YEARS ? More.No : More.Yes, h.years >= MAX_YEARS ? capMessage() : '')
      syncPrefetchLead()
      shownS0 = shownS1 = -1
      const init = pending
      pending = null
      if (init && init.year !== null) timeline.setYear(init.year)
      // the initial animation stops at the end of the initial history (from there Play goes on)
      if (!init || init.play) {
        timeline.setSoftStop(h.years)
        timeline.play()
      } else timeline.setSoftStop(null)
      if (init && init.select !== null && init.select >= 0 && init.select < (index?.count ?? 0)) api.select(init.select, true)
      if (init?.knownAll) peoples.select(ANYONE)
      else if (init && typeof init.people === 'number') peoples.select(init.people)
      if (init && typeof init.species === 'number') speciesView.select(init.species)
    },
    setHistoryError(message: string) {
      timeline.setRange(null, 1, 'history unavailable')
      console.error('history simulation failed:', message)
    },
    extendHistory(h: History, ms: number) {
      if (!world || !index || requested <= 0) return
      const problem = degenerate(index.history, h)
      if (problem) {
        api.extendFailed(problem)
        return
      }
      simMsPerYear = ms / Math.max(1, h.years)
      if (timeline.intro) deferred = { h, ms } // swapped in when the initial animation ends (tick)
      else stage(h, ms)
    },
    extendFailed(message: string) {
      requested = 0
      failed = true
      const end = index ? index.history.years : 0
      console.error('history extension failed (keeping the current history):', message)
      timeline.setMore(More.No, `Could not simulate past year ${end}; the history ends there`, true)
    },
    get years() {
      return index ? index.history.years : 0
    },
    get lastSwap() {
      return lastSwap
    },
    pickAt(x: number, y: number) {
      if (!layer || !layer.mesh.visible) return -1
      const rect = deps.canvas.getBoundingClientRect()
      let id = layer.pick(deps.camera, x, y, rect.width, rect.height, 6)
      // expedition bases have their own flags
      if (id < 0 && outposts) id = outposts.pick(deps.camera, x, y, rect.width, rect.height, 5)
      // up close a settlement's whole cluster of buildings is clickable too
      const hit = id >= 0 || !dioramas ? id : dioramas.pick(deps.camera, x, y, rect.width, rect.height)
      // nothing in the unknown is clickable while a known world is shown
      return hit >= 0 && index && peoples.hidesCell(index.history.settlements[hit].cell) ? -1 : hit
    },
    select(id: number, fly: boolean) {
      if (!index || !world) return
      requestRender()
      selected = id >= 0 && id < index.count ? id : -1
      layer?.setSelected(selected)
      outposts?.setSelected(selected)
      journeys?.setHighlight(selected >= 0 ? index.foundingJourney[selected] : -1)
      trade?.setSelected(selected)
      deps.setUrlParam('select', selected >= 0 ? String(selected) : null)
      labels?.setSelected(selected)
      selPlaces = selected >= 0 ? featuresNear(index.history.settlements[selected].cell, true).sort((a, b) => a.namedYear - b.namedYear) : []
      selPlacesShown = -1
      peoples.showSettlement(selected)
      speciesView.showSettlement(selected, selected >= 0 && index.isOutpost[selected] === 1)
      polities.showSettlement(selected)
      goods.showSettlement(selected)
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
    selectFactionAt(cell: number) {
      // describeCell gates on the same thing (the Factions layer or view on, the cell on
      // land and owned): a non-empty description means cells[cell] is a valid polity id
      const taken = polities.describeCell(cell) !== ''
      const p = taken && polityLayer?.cells ? polityLayer.cells[cell] : -1
      if (p < 0) return
      polities.select(p === polities.selected ? -1 : p)
    },
    setHover(id: number) {
      if (id === hovered) return
      hovered = id
      requestRender()
      layer?.setHovered(id)
      labels?.setHovered(id)
      outposts?.setHovered(id)
      deps.canvas.style.cursor = id >= 0 ? 'pointer' : ''
    },
    setViewMode(mode: ViewMode) {
      viewMode = mode
      requestRender()
      applyMarkerStyle()
      speciesView.setViewMode(mode)
      polities.setViewMode(mode)
      goods.setViewMode(mode)
      speciesLayer?.setOriginCategory(speciesViewCategory(mode))
      shownSpeciesKey = shownGrownKey = -1
      popLegend.classList.toggle('hidden', mode !== ViewMode.Population || !popDensity)
      if (mode === ViewMode.Population) shownPopS0 = -1 // force a recompute on the next tick (the view was not kept live while inactive)
    },
    setMarkersVisible(show: boolean) {
      markersVisible = show
      requestRender()
      applyMarkerStyle()
      peoples.setMarkersVisible(show)
      outposts?.setFlagsVisible(show)
      if (epidemics) epidemics.mesh.visible = show
      if (!show) api.setHover(-1)
    },
    setExpeditionsVisible(show: boolean) {
      expeditionsVisible = show
      requestRender()
      journeys?.setExpeditionsVisible(show)
      outposts?.setTracesVisible(show)
      if (discoveries) discoveries.mesh.visible = show
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
      goods.setStructuresVisible(show) // (deposits go with the ports, dams and mines)
    },
    setBuildingsVisible(show: boolean) {
      buildingsVisible = show
      requestRender()
      dioramas?.setVisible(show)
      outposts?.setCampsVisible(show)
    },
    setTradeVisible(show: boolean) {
      tradeVisible = show
      requestRender()
      if (trade) trade.object.visible = show
      polities.setTradeVisible(show) // (contraband routes, preyed-upon lanes and pirate ships go with the trade)
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
      polities.setLabelsVisible(show)
    },
    placesAt(cell: number) {
      if (peoples.hidesCell(cell)) return ''
      // the faction holding the cell first ("Kingdom of Vashtar")
      const faction = polities.describeCell(cell)
      const named = describePlaces(featuresNear(cell, false).filter((f) => f.namedYear <= year))
      const places = faction ? (named ? `${faction} · ${named}` : faction) : named
      const ed = index?.expeditions
      const note = ed && world ? discoveryNote(ed, world, index!.history, cell, year) : ''
      const withNote = note ? (places ? `${places}. ${note}` : note) : places
      // goods: a deposit or a trading post there
      const g = goods.describeCell(cell)
      return g ? (withNote ? `${withNote} · ${g}` : g) : withNote
    },
    setPeopleTint(on: boolean) {
      peoples.setTint(on)
    },
    isCellHidden(cell: number) {
      return peoples.hidesCell(cell)
    },
    tick(dt: number, drawSize: THREE.Vector2, pixelRatio: number) {
      year = timeline.tick(dt)
      if (deferred && !timeline.intro && !staging) {
        // the initial animation is over: swap in the longer history that arrived meanwhile
        const d = deferred
        deferred = null
        stage(d.h, d.ms)
      }
      if (!index || !layer) return
      const h = index.history
      snapshotAt(h, year, pos)
      const snapshotChanged = pos.s0 !== shownS0 || pos.s1 !== shownS1
      if (snapshotChanged) {
        layer.setSnapshot(pos.s0, pos.s1)
        updateCityLights(pos.s0)
        const td = index.trade
        const routesOpen = td ? td.openCount[Math.min(td.count - 1, Math.round((pos.s0 * h.snapshotInterval) / td.interval))] : undefined
        const ps = polities.stats()
        statRoutes = routesOpen
        timeline.setStats(index.aliveCount[pos.s0], index.totalPopulation[pos.s0], index.townCount[pos.s0], index.cityCount[pos.s0], routesOpen, ps?.states, ps?.wars, ps?.largest)
        shownS0 = pos.s0
        shownS1 = pos.s1
      }
      if (viewMode === ViewMode.Population && popDensity && pos.s0 !== shownPopS0) {
        shownPopS0 = pos.s0
        updatePopulationDensity(pos.s0)
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
      if (outposts) {
        outposts.setTime(year, pulseYears)
        outposts.update(deps.camera, drawSize, pixelRatio)
      }
      if (discoveries && discoveries.mesh.visible) {
        discoveries.setTime(year, pulseYears)
        discoveries.update(deps.camera, drawSize, pixelRatio)
      }
      if (speciesLayer) {
        speciesLayer.setTime(year, pulseYears)
        speciesLayer.update(deps.camera, drawSize, pixelRatio)
      }
      if (epidemics && epidemics.mesh.visible) {
        epidemics.setTime(year, pulseYears * 0.6) // briefer than a first contact's rings
        epidemics.update(deps.camera, drawSize, pixelRatio)
      }
      updateSpecies(year)
      speciesView.tick(year)
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
        outposts?.setYield(near, far)
        goods.setYield(near, far)
        // merchants and travelling groups are 3D carts and ships once the models are in:
        // their flat markers have gone by the distance at which the models are full size
        const tNear = dioramas.active ? DIORAMA_NEAR : 0
        const tFar = dioramas.active ? DIORAMA_FAR - 0.02 : 0
        journeys?.setYield(tNear, tFar)
        trade?.setYield(tNear, tFar)
        roads?.setYield(near, far)
      }
      chronicle.update(year)
      peoples.tick(year, pos.s0, pulseYears, deps.camera, drawSize, pixelRatio)
      // factions: effects step back at high playback speed (as the merchants do)
      const fx = !timeline.playing ? 1 : timeline.speed >= 16 ? 0.35 : timeline.speed >= 4 ? 0.75 : 1
      polities.tick(year, pos.s0, pos.s1, pos.frac, pulseYears, fx, deps.camera, drawSize, pixelRatio)
      goods.tick(year, pos.s0, pos.s1, pos.frac, fx, deps.camera, drawSize, pixelRatio)
      {
        // states and wars in the timeline's stats (wars start and end between snapshots)
        const ps = polities.stats()
        const key = ps ? `${ps.states}:${ps.wars}:${ps.largest}` : ''
        if (key !== shownPolStats) {
          shownPolStats = key
          timeline.setStats(index.aliveCount[pos.s0], index.totalPopulation[pos.s0], index.townCount[pos.s0], index.cityCount[pos.s0], statRoutes, ps?.states, ps?.wars, ps?.largest)
        }
      }
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
      return timeline.playing && !timeline.waiting
    },
  }
  return api
}
