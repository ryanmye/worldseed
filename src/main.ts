import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { World, WorldOptions } from './contract.ts'
import type { WorkerRequest, WorkerResponse } from './worker.ts'
import { buildGlobeMesh, type GlobeMesh } from './render/globe.ts'
import { buildRiverLines, type RiverLines } from './render/rivers.ts'
import { buildAtmosphere, buildClouds, buildStarfield, type Clouds } from './render/sky.ts'
import { createOverlay, getFreeViewportInset, loadLayerPrefs, onFreeViewportChange } from './ui/overlay.ts'
import { goodsInUse } from './ui/tradePanel.ts'
import { attachPointer } from './ui/pointer.ts'
import { ViewMode, isViewMode, type ViewMode as ViewModeT } from './render/palette.ts'
import { createCameraFly } from './render/cameraFly.ts'
import { createHistoryView, MAX_YEARS } from './ui/historyView.ts'
import { HISTORY_CHUNK_YEARS } from './ui/historyIndex.ts'
import { installCameraTilt } from './render/dioramas/cameraTilt.ts'
import { consumeRenderRequest, requestRender } from './render/invalidate.ts'
import { isSunMode, setSunLonLat, setSunMode, setSunToward, SUN_LAT_LIMIT, sunIsDefault, SunMode, sunState, updateSun } from './render/sun.ts'
import { loadQuality, Quality, QUALITY_SETTINGS, saveQuality } from './render/quality.ts'
import { createSunPanel } from './ui/sunPanel.ts'
import { createPerfMonitor } from './render/perfTools.ts'
import { addShortcut } from './ui/shortcuts.ts'
import { located, renderedGroundRadius, setTerrainHistory } from './render/terrainHeight.ts'
import { flat, setFlatView, syncSeamCopies } from './render/mapProjection.ts'
import { createMapControls } from './render/mapControls.ts'
import { buildMapFrame } from './render/mapFrame.ts'
import { sunUniforms } from './render/sun.ts'
import { trace, traceAdd } from './render/perfTrace.ts'
import { createGpuTimer } from './render/gpuTimer.ts'
import { loadPref, savePref } from './ui/panels.ts'

// ---------- URL parameters ----------
// seed, view (terrain|elevation|...|population), spin=0, lon/lat/az (degrees), dist, clouds=0|1, rivers=0,
// sub (subdivisions), year=<n> (start year; past 2000 the history is first simulated that far), years=<n> (length of the
// initial history, default 2000, in steps of 500 up to 6000: auto-play stops at its end), play=0 (start paused), select=<settlement id>, markers=0, journeys=0,
// land=0 (no farmland on the Terrain view), structures=0 (no ports, dams or reservoirs), models=0 (no 3D buildings up close),
// tilt=0 (keep looking straight down when zoomed in), labels=0 (no place names),
// sun=fixed|follow|full, sunlon/sunlat (degrees, fixed sun), quality=high|balanced|low, bake=0 (procedural
// surface every frame, for comparison), perf=1 (frame-rate readout and window.__worldseed tools),
// people=<id> (show the world as that people knew it), known=all (show what no people knew), tint=1 (markers coloured by people),
// expeditions=0 (no expedition trails, supply lines, lost-expedition marks or discoveries), species=<id> (select a species),
// view=crops|herds (main staple / herd animal per cell, when the history has them),
// factions=0 (no faction tint and borders on the Terrain view), polity=<id> (select a faction), view=factions|danger (when the history has them)
// longhaul=0 (no lanes, relay legs, marts or posts), tradition=<id>, secret=<id>, deposit=<id>, lane=<leg id>, price=<good 7..11> (the Goods panel), view=resources
// map=1|0 (the flat map, Equal Earth; else the remembered choice), mapcenter=<degrees> (its central meridian)
// faith=<id> (select a faith in the Faiths panel), view=faiths (the majority faith of each place's land)
// disease=0 (no epidemics, links or quarantine flags on the map), epidemic=<id>, sickness=<disease id> (the Sickness panel), view=fever
// travel=0 (no travellers, visited places, resorts or sights on the map), view=scenery (when the history has scenery)
// nocache=1 (simulate afresh instead of reading the world and history cache, and overwrite it; historyCache.ts),
// cachecheck=1 (on a cache hit also simulate afresh and log whether the two are identical: slow, for checking)

const params = new URLSearchParams(window.location.search)

function numParam(name: string, fallback: number, min = -Infinity, max = Infinity): number {
  const raw = params.get(name)
  if (raw === null) return fallback
  const v = Number.parseFloat(raw)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

function seedFromUrl(): number {
  const raw = params.get('seed')
  if (raw !== null) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return 12345
}

function setUrlParam(name: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value === null) url.searchParams.delete(name)
  else url.searchParams.set(name, value)
  window.history.replaceState(null, '', url)
}

const WORLD_OPTIONS: WorldOptions = { subdivisions: Math.round(numParam('sub', 48, 4, 160)) }

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('missing #app root')

const canvas = document.createElement('canvas')
canvas.id = 'globe-canvas'
app.appendChild(canvas)

// ---------- three.js scaffolding ----------

/** Closest camera distance from the planet centre (radius 1): low enough to see the 3D settlements (src/render/dioramas) house by house, above where the surface detail runs out. */
const MIN_DISTANCE = 1.025
/** Closest camera height above the ground under it (mountains rise well above sea level up close). */
const MIN_CLEARANCE = 0.021

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 300)
{
  const lat = THREE.MathUtils.degToRad(numParam('lat', 12, -89, 89))
  const az = THREE.MathUtils.degToRad(numParam('az', 0))
  const dist = numParam('dist', 3.25, MIN_DISTANCE, 8)
  camera.position.set(dist * Math.sin(az) * Math.cos(lat), dist * Math.sin(lat), dist * Math.cos(az) * Math.cos(lat))
}

let quality: Quality = loadQuality(params.get('quality'))
let qs = QUALITY_SETTINGS[quality]
const bakeEnabled = params.get('bake') !== '0'
/** Pixel-ratio ceiling for the current quality, and the ratio in use (adaptive, see the render loop). */
const pixelRatioCap = () => Math.min(window.devicePixelRatio || 1, qs.pixelRatioCap)
let pixelRatio = pixelRatioCap()

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(pixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.setClearColor(0x010205, 1)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
const DAMPING_PER_60HZ_FRAME = 0.08
controls.dampingFactor = DAMPING_PER_60HZ_FRAME
controls.minDistance = MIN_DISTANCE // close enough to read the 3D settlements (src/render/dioramas)
controls.maxDistance = 8
controls.rotateSpeed = 0.6
controls.zoomSpeed = 0.8
controls.enablePan = false // right-drag and shift-drag move the sun instead (pointer.ts)
/** Rendered ground radius under a world-space point (terrainHeight.ts), or 1 before the world arrives. */
const groundTmp = new THREE.Vector3()
let groundStart = 0
function groundUnder(x: number, y: number, z: number): number {
  const w = currentWorld
  if (!w) return 1
  groundTmp.set(x, y, z)
  planetGroup.worldToLocal(groundTmp).normalize()
  const r = renderedGroundRadius(w, groundTmp.x, groundTmp.y, groundTmp.z, groundStart)
  groundStart = located.cell
  return r
}
// (never on the flat map, which is seen from straight above)
if (params.get('tilt') !== '0') installCameraTilt(camera, controls, () => showBuildings && !mapOn && flat.t === 0, groundUnder) // leans the view toward the horizon up close

// The planet turns beneath a sun fixed in world space; the first drag stops it.
let spinning = numParam('spin', 1) !== 0
const SPIN_SPEED = 0.05 // rad/s
const fly = createCameraFly(camera)
controls.addEventListener('start', () => {
  spinning = false
  fly.cancel()
})
// Camera moved outside the render loop (wheel zoom, drag): draw. Changes made by the loop's
// own controls.update() are picked up from its return value instead.
let inLoopControlsUpdate = false
let cameraChanged = false
controls.addEventListener('change', () => {
  if (inLoopControlsUpdate) return
  cameraChanged = true
  wake()
})

// ---------- sun (sun.ts): sun=fixed|follow|full, sunlon, sunlat ----------
if (params.has('sunlon') || params.has('sunlat')) setSunLonLat(numParam('sunlon', sunState.lon), numParam('sunlat', sunState.lat, -SUN_LAT_LIMIT, SUN_LAT_LIMIT))
{
  const m = params.get('sun')
  if (isSunMode(m)) setSunMode(m)
}

const stars = buildStarfield()
scene.add(stars)
const atmosphere = buildAtmosphere()
atmosphere.setSteps(qs.atmosphereSteps)
scene.add(atmosphere.mesh)

const planetGroup = new THREE.Group()
planetGroup.rotation.y = -THREE.MathUtils.degToRad(numParam('lon', 0))
scene.add(planetGroup)

// ---------- the flat map (render/mapProjection.ts): map=1, mapcenter=<degrees>, remembered ----------
// Globe and map are one scene: every layer goes through the shared projection, whose amount
// (flat.t) morphs between the two. The map lies under the camera, which stays where a globe
// camera looking at the same place would be, so switching keeps the view's centre and scale.
const MAP_KEY = 'worldseed.map'
const MORPH_SECONDS = 0.8
/** Map background (around the map plate), and the globe's space. */
const MAP_BG = new THREE.Color(0x0b1016)
const SPACE_BG = new THREE.Color(0x010205)
const clearTmp = new THREE.Color()
let mapOn = params.has('map') ? params.get('map') === '1' : loadPref(MAP_KEY) === '1'
// (remembered on: written to the URL, so the address reproduces the view)
if (mapOn && !params.has('map')) setUrlParam('map', '1')
/** Morph progress toward the map (0 globe .. 1 map), eased into flat.t. */
let morph = mapOn ? 1 : 0
// (no auto-rotation on the map)
if (mapOn) spinning = false
const easeMorph = (x: number) => x * x * (3 - 2 * x)
const mapFrame = buildMapFrame()
planetGroup.add(mapFrame.matte, mapFrame.graticule, mapFrame.neatline)
const mapControls = createMapControls(camera, canvas, planetGroup, () => {
  spinning = false
  fly.cancel()
})
let mapUrlTimer = 0
function writeMapUrl() {
  mapUrlTimer = 0
  if (mapOn) setUrlParam('mapcenter', String(Math.round(THREE.MathUtils.radToDeg(mapControls.lon) * 10) / 10))
}
const flatCam = new THREE.Vector3()

let currentGlobe: GlobeMesh | null = null
let currentRivers: RiverLines | null = null
let currentClouds: Clouds | null = null
let currentWorld: World | null = null
// Layer toggles: the URL parameter when given, else the remembered toggle (overlay.ts), else on.
// A layer remembered off is written to the URL, so the address reproduces the view.
const layerPrefs = loadLayerPrefs()
function layerOn(param: string, key: string): boolean {
  if (params.has(param)) return params.get(param) !== '0'
  const on = layerPrefs[key] ?? true
  if (!on) setUrlParam(param, '0')
  return on
}
let showRivers = layerOn('rivers', 'rivers')
let showClouds = layerOn('clouds', 'clouds')
let showMarkers = layerOn('markers', 'markers')
let showJourneys = layerOn('journeys', 'journeys')
let showFarmland = layerOn('land', 'farmland')
let showStructures = layerOn('structures', 'structures')
let showBuildings = layerOn('models', 'buildings')
let showTrade = layerOn('trade', 'trade') // trade=0: no trade routes or merchants
let showRoads = layerOn('roads', 'roads') // roads=0: no roads or bridges
let showLabels = layerOn('labels', 'labels') // labels=0: no place names
let showExpeditions = layerOn('expeditions', 'expeditions') // expeditions=0: no expedition trails, supply lines or discoveries
// the flat map's own toggles (remembered, no URL): clouds there (off by default), the graticule, day and night
let showMapClouds = layerPrefs['mapClouds'] ?? false
let showGraticule = layerPrefs['graticule'] ?? true
let showMapNight = layerPrefs['mapNight'] ?? false
const showFactions = layerOn('factions', 'factions') // factions=0: no faction tint, borders, capitals and armies
/** While a known world is shown its mist goes under the clouds (historyView.ts). */
let cloudsOverFog = false
let viewMode: ViewModeT = isViewMode(params.get('view')) ? (params.get('view') as ViewModeT) : ViewMode.Terrain

let atmosphereStrength = 1
function applyLayerVisibility() {
  const terrain = viewMode === ViewMode.Terrain
  if (currentRivers) currentRivers.lines.visible = showRivers && terrain
  // (on the map its own clouds toggle: see draw)
  if (currentClouds) currentClouds.mesh.visible = (flat.t >= 0.5 ? showMapClouds : showClouds) && terrain
  atmosphereStrength = terrain ? 1 : 0.35
  atmosphere.setStrength(atmosphereStrength * (1 - Math.min(1, flat.t / 0.45)))
  requestRender()
}

function clearPlanet() {
  if (currentGlobe) {
    planetGroup.remove(currentGlobe.mesh)
    currentGlobe.dispose()
    currentGlobe = null
  }
  if (currentRivers) {
    planetGroup.remove(currentRivers.lines)
    currentRivers.dispose()
    currentRivers = null
  }
  if (currentClouds) {
    planetGroup.remove(currentClouds.mesh)
    currentClouds.dispose()
    currentClouds = null
  }
  pointerInput.reset()
}

function showWorld(world: World) {
  clearPlanet()
  currentWorld = world
  currentGlobe = buildGlobeMesh(world, viewMode)
  currentGlobe.setMapStyle(flat.t >= 0.5)
  currentGlobe.setFarmlandVisible(showFarmland)
  currentGlobe.setReservoirsVisible(showStructures)
  planetGroup.add(currentGlobe.mesh)
  currentRivers = buildRiverLines(world)
  planetGroup.add(currentRivers.lines)
  currentClouds = buildClouds(world.seed)
  currentClouds.mesh.renderOrder = cloudsOverFog ? 9.6 : 5
  planetGroup.add(currentClouds.mesh)
  if (bakeEnabled) {
    currentGlobe.setBakeSize(qs.bakeSize)
    currentClouds.setBakeSize(qs.cloudBakeSize)
  }
  applyLayerVisibility()
  historyView.setWorld(world)
}

// ---------- worker ----------
// One request per seed; responses for superseded requests are dropped. Extensions (a longer
// run of the same world, see historyView.ts) carry the seed's requestId; at most one is in
// flight. A new seed while one runs restarts the worker rather than wait for it.

let worker = createWorker()
let requestId = 0
/** Years of the extension in flight, 0 for none. */
let extending = 0
/** Debugging (perf=1): make the next extension fail as if the simulation had thrown. */
let failNextExtension = false

function createWorker(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = onWorkerMessage
  if (document.hidden) w.postMessage({ type: 'throttle', hidden: true } satisfies WorkerRequest)
  return w
}
// background extensions run slower while the page is hidden (worker.ts)
document.addEventListener('visibilitychange', () => worker.postMessage({ type: 'throttle', hidden: document.hidden } satisfies WorkerRequest))

function onWorkerMessage(ev: MessageEvent<WorkerResponse>) {
  const msg = ev.data
  if (msg.requestId !== requestId) return
  requestRender()
  wake()
  if (msg.type === 'world') {
    overlay.setGenerating(false)
    showWorld(msg.world)
  } else if (msg.type === 'progress') {
    historyView.setSimProgress(msg.years, msg.target)
  } else if (msg.type === 'history') {
    console.info(`history: ${msg.history.years} years, ${msg.history.settlements.length} settlements, ${msg.history.events.length} events, ${msg.ms.toFixed(0)} ms`)
    // towns and fields flatten the ground (terrainHeight.ts) before any layer is placed on it
    if (currentWorld) setTerrainHistory(currentWorld, msg.history)
    overlay.setGoodsInUse(goodsInUse(msg.history.trade))
    if (msg.extend) {
      extending = 0
      historyView.extendHistory(msg.history, msg.ms)
    } else historyView.setHistory(msg.history, historyYears) // (shorter than asked: shown at once, then extended to it)
  } else if (msg.stage === 'world') {
    overlay.setGenerating(false)
    console.error('world generation failed:', msg.message)
  } else if (msg.stage === 'extend') {
    extending = 0
    historyView.extendFailed(msg.message)
  } else {
    historyView.setHistoryError(msg.message)
  }
}

/** Length of the initial history: years= (default 2000), or long enough for a start year= past it; in whole chunks, capped. */
function initialYears(): number {
  const want = Math.max(numParam('years', 2000, 1, MAX_YEARS), numParam('year', 0, 0, MAX_YEARS))
  return Math.min(MAX_YEARS, Math.max(HISTORY_CHUNK_YEARS, Math.ceil(want / HISTORY_CHUNK_YEARS - 1e-9) * HISTORY_CHUNK_YEARS))
}
let historyYears = initialYears()

function requestWorld(seed: number) {
  overlay.setGenerating(true)
  overlay.setReadout(null)
  if (extending) {
    // the worker is busy simulating a longer run of the old world: start afresh
    worker.terminate()
    worker = createWorker()
    extending = 0
  }
  const req: WorkerRequest = {
    type: 'generate',
    requestId: ++requestId,
    seed,
    options: WORLD_OPTIONS,
    historyOptions: historyYears === 2000 ? undefined : { years: historyYears },
    // a long first run (year=6000): show the default length first, then extend to it
    firstYears: historyYears > 2000 ? 2000 : undefined,
    nocache: params.get('nocache') === '1' || undefined,
    cachecheck: params.get('cachecheck') === '1' || undefined,
  }
  worker.postMessage(req)
}

function requestYears(years: number, full = false) {
  extending = years
  const req: WorkerRequest = { type: 'extend', requestId, years, fail: failNextExtension || undefined, full: full || undefined }
  failNextExtension = false
  worker.postMessage(req)
}

// ---------- UI ----------

let currentSeed = seedFromUrl()

function clearHistoryParams() {
  setUrlParam('year', null)
  setUrlParam('years', null)
  setUrlParam('play', null)
  setUrlParam('select', null)
  setUrlParam('people', null)
  setUrlParam('known', null)
  setUrlParam('species', null)
  setUrlParam('polity', null)
  setUrlParam('faith', null)
  for (const k of ['tradition', 'secret', 'deposit', 'lane', 'price', 'epidemic', 'sickness']) setUrlParam(k, null)
  historyYears = 2000 // a new world starts with the default history again
}

const overlay = createOverlay(app, currentSeed, { viewMode, rivers: showRivers, clouds: showClouds, markers: showMarkers, journeys: showJourneys, farmland: showFarmland, structures: showStructures, buildings: showBuildings, trade: showTrade, roads: showRoads, labels: showLabels }, {
  onSeedSubmit(seed: number) {
    if (seed === currentSeed && currentWorld?.seed === seed) return
    currentSeed = seed
    setUrlParam('seed', String(seed))
    clearHistoryParams()
    requestWorld(seed)
  },
  onRandomSeed() {
    currentSeed = Math.floor(Math.random() * 1_000_000)
    overlay.setSeed(currentSeed)
    setUrlParam('seed', String(currentSeed))
    clearHistoryParams()
    requestWorld(currentSeed)
  },
  onViewModeChange(mode: ViewModeT) {
    viewMode = mode
    overlay.setViewMode(mode)
    setUrlParam('view', mode === ViewMode.Terrain ? null : mode)
    currentGlobe?.setMode(mode)
    historyView.setViewMode(mode)
    applyLayerVisibility()
  },
  onRiversToggle(show: boolean) {
    showRivers = show
    setUrlParam('rivers', show ? null : '0')
    applyLayerVisibility()
  },
  onCloudsToggle(show: boolean) {
    showClouds = show
    setUrlParam('clouds', show ? null : '0')
    applyLayerVisibility()
  },
  onMarkersToggle(show: boolean) {
    showMarkers = show
    setUrlParam('markers', show ? null : '0')
    historyView.setMarkersVisible(show)
  },
  onJourneysToggle(show: boolean) {
    showJourneys = show
    setUrlParam('journeys', show ? null : '0')
    historyView.setJourneysVisible(show)
  },
  onFarmlandToggle(show: boolean) {
    showFarmland = show
    setUrlParam('land', show ? null : '0')
    currentGlobe?.setFarmlandVisible(show)
  },
  onStructuresToggle(show: boolean) {
    showStructures = show
    setUrlParam('structures', show ? null : '0')
    currentGlobe?.setReservoirsVisible(show)
    historyView.setStructuresVisible(show)
  },
  onBuildingsToggle(show: boolean) {
    showBuildings = show
    setUrlParam('models', show ? null : '0')
    // (the 3D towns stay on the globe)
    historyView.setBuildingsVisible(show && !mapOn)
  },
  onTradeToggle(show: boolean) {
    showTrade = show
    setUrlParam('trade', show ? null : '0')
    historyView.setTradeVisible(show)
  },
  onRoadsToggle(show: boolean) {
    showRoads = show
    setUrlParam('roads', show ? null : '0')
    historyView.setRoadsVisible(show)
  },
  onLabelsToggle(show: boolean) {
    showLabels = show
    setUrlParam('labels', show ? null : '0')
    historyView.setLabelsVisible(show)
  },
  onProjectionChange(map: boolean) {
    setMapMode(map)
  },
})

const intParam = (name: string): number | null => {
  const raw = params.get(name)
  const v = raw === null ? NaN : Number.parseInt(raw, 10)
  return Number.isFinite(v) ? v : null
}

const historyView = createHistoryView(
  {
    bottom: overlay.bottom,
    left: overlay.left,
    right: overlay.right,
    planetGroup,
    camera,
    canvas,
    fly,
    getGlobe: () => currentGlobe,
    onFly: () => {
      spinning = false
    },
    setUrlParam,
    requestYears,
    wake: () => wake(),
    setCloudsOverFog: (on) => {
      cloudsOverFog = on
      // over the known-world mist (9.5), under the atmosphere (10); else under every overlay
      if (currentClouds) currentClouds.mesh.renderOrder = on ? 9.6 : 5
      requestRender()
    },
    setViewModeAvailable: (mode, available) => overlay.setViewModeAvailable(mode, available),
    // (each object compiled in place, with the scene's lights: nothing is re-parented)
    precompile: (objects) => Promise.all(objects.map((o) => renderer.compileAsync(o, camera, scene))),
    addLayerToggle: (t) => overlay.addLayerToggle(t),
  },
  { year: intParam('year'), play: params.get('play') !== '0', select: intParam('select'), people: intParam('people'), knownAll: params.get('known') === 'all', species: intParam('species'), polity: intParam('polity'), factions: showFactions },
)
// the Crops and Herds views need the history's crop and herd layers (offered once they arrive)
overlay.setViewModeAvailable(ViewMode.Crops, false)
overlay.setViewModeAvailable(ViewMode.Herds, false)
overlay.setViewModeAvailable(ViewMode.Cash, false)
// the Factions and Danger views need the history's polities (offered once they arrive)
overlay.setViewModeAvailable(ViewMode.Factions, false)
overlay.setViewModeAvailable(ViewMode.Danger, false)
// the Resources view needs the history's goods (deposits, industries)
overlay.setViewModeAvailable(ViewMode.Resources, false)
overlay.addLayerToggle({
  key: 'expeditions',
  label: 'Expeditions',
  group: 'movement',
  checked: showExpeditions,
  title: 'Expeditions under way, the supply lines of their bases, lost expeditions and discoveries',
  onChange: (on) => {
    showExpeditions = on
    setUrlParam('expeditions', on ? null : '0')
    historyView.setExpeditionsVisible(on)
  },
})
// markers coloured by people (off unless tint=1 or remembered on)
{
  const tintOn = params.has('tint') ? params.get('tint') === '1' : (layerPrefs['peoples'] ?? false)
  if (tintOn) setUrlParam('tint', '1')
  historyView.setPeopleTint(tintOn)
  overlay.addLayerToggle({
    key: 'peoples',
    label: 'Peoples',
    group: 'people',
    checked: tintOn,
    title: 'Colour settlements by the people they belong to',
    onChange: (on) => {
      setUrlParam('tint', on ? '1' : null)
      historyView.setPeopleTint(on)
    },
  })
}
historyView.setViewMode(viewMode)
historyView.setMarkersVisible(showMarkers)
historyView.setJourneysVisible(showJourneys)
historyView.setStructuresVisible(showStructures)
historyView.setBuildingsVisible(showBuildings && !mapOn)
historyView.setTradeVisible(showTrade)
historyView.setRoadsVisible(showRoads)
historyView.setLabelsVisible(showLabels)
historyView.setExpeditionsVisible(showExpeditions)

// ---------- Globe / Map ----------

const rowOf = (box: HTMLInputElement) => box.closest('.layer-toggle') as HTMLElement | null
const mapCloudsBox = overlay.addLayerToggle({
  key: 'mapClouds',
  label: 'Clouds',
  group: 'nature',
  checked: showMapClouds,
  title: 'Clouds over the map',
  onChange: (on) => {
    showMapClouds = on
    applyLayerVisibility()
  },
})
const graticuleBox = overlay.addLayerToggle({
  key: 'graticule',
  label: 'Graticule',
  group: 'nature',
  checked: showGraticule,
  title: 'Meridians and parallels every 30 degrees on the map',
  onChange: (on) => {
    showGraticule = on
    requestRender()
  },
})
const mapNightBox = overlay.addLayerToggle({
  key: 'mapNight',
  label: 'Day and night',
  group: 'nature',
  checked: showMapNight,
  title: 'The sun on the map: the terminator and the night lights sweep across (else daylight everywhere)',
  onChange: (on) => {
    showMapNight = on
    // the night sweeps across the map as the planet turns beneath the sun
    spinning = on && mapOn
    requestRender()
  },
})
const cloudsBox = document.querySelector<HTMLInputElement>('input[data-layer="clouds"]')
const buildingsBox = document.querySelector<HTMLInputElement>('input[data-layer="buildings"]')
/** Toggles that belong to one projection: shown in it only. */
function syncMapUi() {
  const show = (box: HTMLInputElement | null, on: boolean) => {
    const row = box ? rowOf(box) : null
    if (row) row.classList.toggle('hidden', !on)
  }
  show(cloudsBox, !mapOn)
  show(mapCloudsBox, mapOn)
  show(graticuleBox, mapOn)
  show(mapNightBox, mapOn)
  if (buildingsBox) {
    buildingsBox.disabled = mapOn
    const row = rowOf(buildingsBox)
    if (row) row.title = mapOn ? '3D towns show on the globe only: the map keeps the flat markers' : '3D towns, farms and ships up close'
  }
  overlay.setProjection(mapOn)
}

/** Switch between the globe and the flat map (a morph keeping the view's centre and scale). */
function setMapMode(on: boolean, animate = true) {
  if (on === mapOn) return
  mapOn = on
  savePref(MAP_KEY, on ? '1' : '0')
  setUrlParam('map', on ? '1' : null)
  if (!on) setUrlParam('mapcenter', null)
  fly.cancel()
  if (on) {
    // leave the orbit: no tilt (restored by one update with it off), no auto-rotation
    controls.update()
    controls.enabled = false
    spinning = showMapNight
    mapControls.sync()
    historyView.setBuildingsVisible(false)
  } else {
    mapControls.enabled = false
    mapControls.stop()
    spinning = false
  }
  if (!animate) {
    morph = on ? 1 : 0
    morphDone()
  }
  syncMapUi()
  applyLayerVisibility()
  requestRender()
  wake()
}
/** The morph reached its end: hand the camera to the controls of the projection. */
function morphDone() {
  if (mapOn) {
    mapControls.enabled = true
  } else {
    mapControls.enabled = false
    controls.enabled = true
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)
    historyView.setBuildingsVisible(showBuildings)
  }
  applyLayerVisibility()
}
addShortcut({ keys: ['m', 'M'], label: 'M', description: 'Globe / flat map', group: 'View', run: () => setMapMode(!mapOn) })
if (mapOn) {
  // starting on the map: the whole world unless a distance is given, centred on mapcenter (degrees) if given
  controls.enabled = false
  const lonDeg = params.has('mapcenter') ? numParam('mapcenter', 0) : numParam('az', 0) + numParam('lon', 0)
  const az = THREE.MathUtils.degToRad(lonDeg - numParam('lon', 0))
  const lat = THREE.MathUtils.degToRad(numParam('lat', 0, -89, 89))
  const dist = params.has('dist') ? numParam('dist', 3.25, 1.03, 8) : 1 + mapControls.fitAltitude() * 1.02
  camera.position.set(dist * Math.sin(az) * Math.cos(lat), dist * Math.sin(lat), dist * Math.cos(az) * Math.cos(lat))
  camera.lookAt(0, 0, 0)
  mapControls.sync()
  mapControls.enabled = true
}
syncMapUi()

setUrlParam('seed', String(currentSeed))
requestWorld(currentSeed)

// ---------- pointer: terrain readout on hover, settlement hover/click ----------

const pointerInput = attachPointer({
  canvas,
  camera,
  getWorld: () => currentWorld,
  getGlobe: () => currentGlobe,
  // (nothing is described in lands the known world shown does not include)
  setReadout: (r) => overlay.setReadout(r && r.cell !== undefined ? (historyView.isCellHidden(r.cell) ? null : { ...r, places: historyView.placesAt(r.cell) }) : r),
  pickSettlement: (x, y) => historyView.pickAt(x, y),
  hoverSettlement: (id) => historyView.setHover(id),
  selectSettlement: (id) => historyView.select(id, false),
  selectFactionAt: (cell) => historyView.selectFactionAt(cell),
  dragSun: (dir) => {
    setSunToward(dir)
    syncSun()
  },
})

// ---------- sun and quality panel ----------

let sunUrlTimer = 0
/** Reflect the sun state in the panel and (debounced) the URL, and redraw. */
function syncSun() {
  sunPanel.setSun(sunState.mode, sunState.lon, sunState.lat)
  requestRender()
  wake()
  window.clearTimeout(sunUrlTimer)
  sunUrlTimer = window.setTimeout(() => {
    setUrlParam('sun', sunState.mode === SunMode.Fixed ? null : sunState.mode)
    const custom = !sunIsDefault()
    setUrlParam('sunlon', custom ? String(Math.round(sunState.lon)) : null)
    setUrlParam('sunlat', custom ? String(Math.round(sunState.lat)) : null)
  }, 250)
}

function applyQuality(q: Quality) {
  quality = q
  qs = QUALITY_SETTINGS[q]
  sunPanel.setQuality(q)
  document.body.classList.toggle('q-low', q === Quality.Low)
  atmosphere.setSteps(qs.atmosphereSteps)
  if (bakeEnabled) {
    currentGlobe?.setBakeSize(qs.bakeSize)
    currentClouds?.setBakeSize(qs.cloudBakeSize)
  }
  pixelRatio = pixelRatioCap()
  sizeDirty = true
  requestRender()
  wake()
}

const sunPanel = createSunPanel(
  {
    onSunMode(mode) {
      setSunMode(mode)
      syncSun()
    },
    onSunLonLat(lon, lat) {
      setSunLonLat(lon, lat)
      syncSun()
    },
    onQuality(q) {
      saveQuality(q)
      if (params.has('quality')) setUrlParam('quality', q)
      applyQuality(q)
    },
  },
  { mode: sunState.mode, lon: sunState.lon, lat: sunState.lat, quality },
)
// in the settings popover of the seed bar
overlay.settings.appendChild(sunPanel.root)

// ---------- resize ----------

let sizeDirty = true
window.addEventListener('resize', () => {
  pixelRatio = pixelRatioCap()
  sizeDirty = true
  wake()
})

// ---------- render loop: draw on demand ----------
//
// Nothing is drawn unless something changed: a render request (requestRender(), from UI
// changes, hover, data and texture arrival, animations in progress), camera motion or
// damping, a fly-to, playback, the sun, a resize. Auto-rotation and cloud drift alone draw
// at a reduced rate, just often enough that each frame moves the surface by under a pixel
// or so (capped by the quality preset). With nothing to do the loop stops entirely (no
// animation frames); input events and the worker wake it, and a slow poll picks up render
// requests made elsewhere while it sleeps. A hidden tab neither draws nor polls.
//
// Motion resolution: while the picture moves (camera, playback, auto-rotation) and the GPU
// cannot finish a frame within the frame budget, the pixel ratio steps down at once to the
// ratio that fits (by the measured GPU time where the browser can time it, else by the frame
// interval; down to the quality's minimum), and back up while there is room again. A still
// picture is always drawn at the cap: when the motion ends, one more frame at full resolution.
// The next motion near the same zoom starts at the ratio the last one settled on.

const drawSize = new THREE.Vector2()
const perf = createPerfMonitor(params.get('perf') === '1', app)
const MS_TOL = 3 // ms of slack on frame-rate caps (vsync jitter)
const POLL_MS = 150
let rafId = 0
let pollId = 0
let ambientTimer = 0
let lastTs: number | null = null
let lastDrawTs = -Infinity
let spinTime = 0 // seconds of auto-rotation not yet applied
let cloudTime = 0 // seconds of cloud drift not yet applied
let tickTime = 0 // seconds of timeline time not yet ticked
let carryRequest = false
/** Last frame with motion (camera, playback, auto-rotation); full resolution returns MOTION_SETTLE_MS after it. */
let lastMotionTs = -Infinity
const MOTION_SETTLE_MS = 200
/** Last slider input or key press, and the run of frames drawn for such input (a timeline scrub is motion too). */
let inputTs = -Infinity
let inputStreak = 0
// motion resolution (see above)
const gpuTimer = createGpuTimer(renderer.getContext() as WebGL2RenderingContext)
/** 'auto'; 'interval' (ignore the GPU timer); 'off' (always the cap): perf=1 comparisons. */
let motionResMode: 'auto' | 'interval' | 'off' = 'auto'
/** perf=1: a ratio held at rest too (0: none), to compare a motion frame with a still one. */
let holdPr = 0
let holdDirect = false
/** Recent GPU ms (or frame intervals) at the current ratio during the motion. */
const motionSamples: number[] = []
let motionWasOn = false
/** The ratio the last motion settled on, and the camera altitude there (0: none). */
let motionPr = 0
let motionAlt = 0
/** The latest GPU ms of a frame drawn at the current ratio, not yet used. */
let gpuSample = NaN
/** The ratio for continuous motion: a step toward what the measured frames afford. */
function motionResolution(interval: number, fps: number, movingNow: boolean) {
  const cap = pixelRatioCap()
  const min = Math.min(cap, qs.pixelRatioMin)
  const alt = Math.max(1e-3, camera.position.length() - 1)
  if (!movingNow || motionResMode === 'off' || holdPr > 0) {
    motionWasOn = false
    motionSamples.length = 0
    return
  }
  if (!motionWasOn) {
    motionWasOn = true
    motionSamples.length = 0
    // near the zoom where the last motion settled: start at its ratio
    if (motionPr > 0 && motionPr < pixelRatio && Math.abs(Math.log(alt / motionAlt)) < 0.35) setPixelRatio(Math.max(min, motionPr))
    return
  }
  const target = 1000 / Math.min(fps, 60)
  const timed = gpuTimer.available && motionResMode === 'auto'
  const v = timed ? gpuSample : interval
  gpuSample = NaN
  if (!(v > 0) || (!timed && interval >= 250)) return
  motionSamples.push(v)
  if (motionSamples.length < 3) return
  const sorted = motionSamples.slice(-4).sort((a, b) => a - b)
  const med = sorted[sorted.length >> 1]
  // the GPU's share of the budget (the rest for the CPU and the compositor)
  const budget = timed ? target * 0.8 : target
  let want = pixelRatio
  if (med > budget * (timed ? 1.12 : 1.35)) want = pixelRatio * Math.sqrt(budget / med)
  else if (timed && med < budget * 0.6 && pixelRatio < cap) want = pixelRatio * Math.sqrt((budget * 0.85) / med)
  want = Math.min(cap, Math.max(min, Math.floor(want * 8 + 1e-6) / 8))
  if (want <= pixelRatio - 0.1 || want >= pixelRatio + 0.1) {
    setPixelRatio(want)
    motionPr = want
    motionAlt = alt
  } else if (motionSamples.length >= 4 && motionPr !== pixelRatio) {
    motionPr = pixelRatio
    motionAlt = alt
  }
}
function setPixelRatio(pr: number) {
  if (pr === pixelRatio) return
  pixelRatio = pr
  motionSamples.length = 0
  gpuSample = NaN
}
// Frames below the cap are drawn into an offscreen target of that size and copied onto the
// canvas, which keeps its size: resizing the canvas (its multisampled buffers) takes tens of
// milliseconds, a visible stall each time the ratio steps. The target renders exactly as the
// canvas does (tone mapping, sRGB-encoded 8-bit colour, blending after both: three treats an
// XR target so), so the copy is the frame. The last two sizes stay allocated.
const motionTargets: THREE.WebGLRenderTarget[] = []
function motionTarget(): THREE.WebGLRenderTarget | null {
  if (pixelRatio >= pixelRatioCap() - 1e-6 || holdDirect) return null
  const w = Math.max(1, Math.round(window.innerWidth * pixelRatio))
  const h = Math.max(1, Math.round(window.innerHeight * pixelRatio))
  let k = motionTargets.findIndex((t) => t.width === w && t.height === h)
  if (k < 0) {
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
    rt.texture.colorSpace = THREE.SRGBColorSpace
    rt.texture.internalFormat = 'RGBA8'
    ;(rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true
    motionTargets.unshift(rt)
    while (motionTargets.length > 2) motionTargets.pop()?.dispose()
    k = 0
  } else if (k > 0) motionTargets.unshift(motionTargets.splice(k, 1)[0])
  return motionTargets[0]
}
const copyMaterial = new THREE.ShaderMaterial({
  uniforms: { tFrame: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tFrame; varying vec2 vUv; void main() { gl_FragColor = texture2D(tFrame, vUv); }',
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})
const copyScene = new THREE.Scene()
{
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial)
  quad.frustumCulled = false
  copyScene.add(quad)
}
const copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
function copyToCanvas(rt: THREE.WebGLRenderTarget) {
  copyMaterial.uniforms.tFrame.value = rt.texture
  renderer.setRenderTarget(null)
  const auto = renderer.autoClear
  renderer.autoClear = false
  renderer.render(copyScene, copyCamera)
  renderer.autoClear = auto
}
let wasBaking = false

function wake() {
  if (pollId) {
    window.clearTimeout(pollId)
    pollId = 0
  }
  if (ambientTimer) {
    window.clearTimeout(ambientTimer)
    ambientTimer = 0
  }
  if (!rafId && !document.hidden) rafId = requestAnimationFrame(frame)
}

function sleep() {
  lastTs = null
  if (!pollId && !document.hidden) pollId = window.setTimeout(poll, POLL_MS)
}

function poll() {
  pollId = 0
  if (document.hidden) return
  if (consumeRenderRequest()) {
    carryRequest = true
    wake()
  } else pollId = window.setTimeout(poll, POLL_MS)
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    window.clearTimeout(pollId)
    pollId = 0
    window.clearTimeout(ambientTimer)
    ambientTimer = 0
    lastTs = null
  } else {
    requestRender()
    wake()
  }
})
// any input may change something: wake the loop (it draws only if something did change);
// discrete UI actions (clicks, keys, sliders, toggles) also request one frame
for (const type of ['pointermove', 'pointerdown', 'wheel'] as const) window.addEventListener(type, wake, { capture: true, passive: true })
for (const type of ['pointerup', 'click', 'keydown', 'input', 'change'] as const) {
  window.addEventListener(type, () => {
    if (type === 'input' || type === 'keydown') inputTs = performance.now()
    requestRender()
    wake()
  }, { capture: true, passive: true })
}

const cloudsDrift = () => qs.cloudsAnimate !== 'never' && currentClouds !== null && currentClouds.mesh.visible
/** Cloud drift alone keeps the page drawing (High quality only). */
const cloudsDriveFrames = () => qs.cloudsAnimate === 'always' && cloudsDrift()

/** Frames per second at which the auto-rotation / cloud drift moves the surface by ~0.6 CSS px per frame. */
function ambientFps(): number {
  const speed = (spinning ? SPIN_SPEED : 0) + (cloudsDriveFrames() ? 0.004 : 0) // rad/s, ~ surface units/s
  const alt = Math.max(0.02, camera.position.length() - 1)
  const pxPerUnit = window.innerHeight / (alt * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
  return Math.min(qs.ambientFps, Math.max(2, (speed * pxPerUnit) / 0.6))
}

/**
 * Shifts the camera's rendered frame (not its zoom or aspect) so its centre sits in the
 * window's free rect (ui/overlay.ts) instead of dead centre, on both the globe and the map:
 * a pure screen-space recentring away from whatever the side panels cover. setViewOffset
 * needs updateProjectionMatrix() to take effect; picking (pointer.ts) and labels (labels.ts)
 * stay correct because they read the camera's own projection matrix.
 */
function syncViewportOffset() {
  const inset = getFreeViewportInset()
  const w = window.innerWidth, h = window.innerHeight
  camera.setViewOffset(w, h, (inset.right - inset.left) / 2, (inset.bottom - inset.top) / 2, w, h)
  camera.updateProjectionMatrix()
}

function applySize() {
  sizeDirty = false
  camera.aspect = window.innerWidth / window.innerHeight
  syncViewportOffset()
  // (the canvas is always at the cap: motion frames below it go through a smaller target, see motionTarget)
  renderer.setPixelRatio(holdDirect && holdPr > 0 ? holdPr : pixelRatioCap())
  renderer.setSize(window.innerWidth, window.innerHeight)
  // the window resized: the free rect's fraction of it changed even if the panels didn't
  if (mapOn) mapControls.refitWhole()
}

// The free rect itself can change without a window resize (a panel opens, closes or is
// dragged wider): recentre the camera and, on the map, re-fit the whole world if the user
// has not panned or zoomed away from it since the last automatic fit (mapControls.ts).
onFreeViewportChange(() => {
  syncViewportOffset()
  if (mapOn) mapControls.refitWhole()
  requestRender()
  wake()
})

/**
 * The projection of the moment (render/mapProjection.ts): the morph amount, the map centred
 * under the camera; and what goes with it: the sky fades out, the map's frame and background
 * fade in, daylight everywhere on the map unless Day and night is on. No allocation.
 */
function updateFlat() {
  const t = easeMorph(morph)
  if (t > 0 || flat.t > 0) {
    planetGroup.updateWorldMatrix(true, false)
    flatCam.copy(camera.position)
    planetGroup.worldToLocal(flatCam)
    const was = flat.t
    setFlatView(t, flatCam.x, flatCam.y, flatCam.z)
    if ((was >= 0.5) !== (t >= 0.5) || (was > 0) !== (t > 0)) {
      applyLayerVisibility()
      currentGlobe?.setMapStyle(t >= 0.5)
    }
  }
  const terrain = viewMode === ViewMode.Terrain
  atmosphere.mesh.visible = t < 0.45
  atmosphere.setStrength(atmosphereStrength * (1 - Math.min(1, t / 0.45)))
  stars.visible = t < 0.5
  ;(stars.material as THREE.ShaderMaterial).uniforms.uFade.value = 1 - Math.min(1, t / 0.5)
  if (currentClouds) currentClouds.mesh.visible = (t >= 0.5 ? showMapClouds : showClouds) && terrain
  mapFrame.neatline.visible = t > 0.5
  mapFrame.graticule.visible = t > 0.5 && showGraticule
  mapFrame.matte.visible = t > 0.8
  renderer.setClearColor(clearTmp.copy(SPACE_BG).lerp(MAP_BG, t), 1)
  mapFrame.setBackground(clearTmp)
  sunUniforms.uDaylight.value = sunState.mode === SunMode.Full || (t >= 0.5 && !showMapNight) ? 1 : 0
  syncSeamCopies(planetGroup)
}

/** Advance time-based state and draw one frame. */
function draw(ts: number) {
  if (sizeDirty) {
    const tr = performance.now()
    applySize()
    traceAdd('resize', performance.now() - tr)
  }
  // near plane follows the height above the ground, so the ground up close is not clipped
  const nearWant = Math.min(0.05, Math.max(0.0012, (camera.position.length() - groundUnder(camera.position.x, camera.position.y, camera.position.z)) * 0.12))
  if (Math.abs(camera.near - nearWant) > camera.near * 0.15) {
    camera.near = nearWant
    camera.updateProjectionMatrix()
  }
  if (spinTime > 0) {
    planetGroup.rotation.y += SPIN_SPEED * spinTime
    // on the map the camera turns with the planet (the map stays put, the sun sweeps across it)
    if (mapOn || morph > 0) mapControls.apply()
  }
  if (cloudTime > 0) currentClouds?.update(cloudTime)
  spinTime = cloudTime = 0
  updateFlat()
  updateSun(camera)
  currentGlobe?.update(camera)
  // the size drawn at: the canvas, or a smaller motion target
  const target = motionTarget()
  if (target) drawSize.set(target.width, target.height)
  else renderer.getDrawingBufferSize(drawSize)
  currentRivers?.update(camera, drawSize.y)
  const tt = performance.now()
  historyView.tick(Math.min(tickTime, 0.1), drawSize, target ? pixelRatio : renderer.getPixelRatio())
  tickTime = 0
  const t0 = performance.now()
  const rec = trace.cur
  const prNow = pixelRatio
  gpuTimer.begin((ms) => {
    if (rec) rec.gpu = ms
    if (prNow === pixelRatio) gpuSample = ms
  })
  renderer.setRenderTarget(target)
  renderer.render(scene, camera)
  perf.frame(ts, performance.now() - t0, renderer)
  if (target) copyToCanvas(target)
  gpuTimer.end()
  const t1 = performance.now()
  traceAdd('tick', t0 - tt)
  traceAdd('render', t1 - t0)
  lastDrawTs = ts
}

function frame(ts: number) {
  perf.traceBegin(ts)
  frameBody(ts)
  perf.traceEnd(pixelRatio)
}

function frameBody(ts: number) {
  rafId = 0
  if (document.hidden) {
    lastTs = null
    return
  }
  // (slow ambient frames can be up to half a second apart; the timeline caps its own step)
  const dt = lastTs === null ? 0 : Math.min((ts - lastTs) / 1000, 1)
  lastTs = ts
  tickTime += dt

  // camera: fly-to and controls (damping keeps it moving after a drag)
  const flying = fly.active
  fly.update(Math.min(dt, 0.1))
  let moved: boolean
  // the morph between globe and map, and the map's own controls while either shows it
  const morphing = mapOn ? morph < 1 : morph > 0
  if (morphing) {
    morph = Math.min(1, Math.max(0, morph + ((mapOn ? 1 : -1) * Math.min(dt, 0.1)) / MORPH_SECONDS))
    if (morph === (mapOn ? 1 : 0)) morphDone()
  }
  if (mapOn || morph > 0) {
    // (a fly-to moves the camera like a globe camera: the map follows it)
    if (flying) mapControls.sync()
    moved = mapControls.update(Math.min(dt, 0.1)) || morphing
    // the central meridian in the URL, a little after the view moved (one timer at a time)
    if (moved && mapOn && !morphing && !mapUrlTimer) mapUrlTimer = window.setTimeout(writeMapUrl, 400)
  } else {
    // damping per unit of time, not per frame: the same glide (and settle time) at any frame rate
    controls.dampingFactor = 1 - Math.pow(1 - DAMPING_PER_60HZ_FRAME, Math.min(Math.max(dt * 60, 0.25), 6))
    // drag speed eases off near the ground, where the view is a few houses across
    controls.rotateSpeed = 0.6 * Math.min(1, Math.max(0.025, (camera.position.length() - 1) / 0.5))
    // keep clear of the ground under the camera (tall mountains up close)
    controls.minDistance = Math.max(MIN_DISTANCE, groundUnder(camera.position.x, camera.position.y, camera.position.z) + MIN_CLEARANCE)
    inLoopControlsUpdate = true
    moved = controls.update()
    inLoopControlsUpdate = false
  }
  const camMoved = moved || flying || cameraChanged
  cameraChanged = false
  const sunMoved = updateSun(camera)

  const requested = consumeRenderRequest() || carryRequest
  carryRequest = false
  const interacting = camMoved || flying
  // frames drawn one after another for input (dragging the timeline, a held key): motion too
  if (ts - inputTs >= 150) inputStreak = 0
  else if (requested && ts - lastDrawTs < 100) inputStreak++
  const scrubbing = inputStreak >= 3
  const playing = historyView.isPlaying()
  const ambient = spinning || cloudsDriveFrames()
  if (spinning) spinTime += dt
  if (cloudsDrift()) cloudTime += dt

  // surface and cloud bakes: one strip of a cube face per frame until done (procedural shading meanwhile)
  let baking = false
  const tb = performance.now()
  if (perf.holdBake) baking = true
  else if (currentGlobe?.bakeStep(renderer, 1)) baking = true
  else if (currentGlobe && !currentGlobe.bakeInfo.pending && currentClouds?.bakeStep(renderer, 1)) baking = true
  // a finished bake swaps in the baked shaders: draw once
  traceAdd('bakeStep', performance.now() - tb)
  const bakeDone = wasBaking && !baking
  wasBaking = baking

  // the most urgent reason sets the frame-rate cap
  let fps = 0
  if (requested || interacting || sunMoved || sizeDirty || bakeDone) fps = qs.interactFps
  else if (playing) fps = qs.playFps
  else if (ambient) fps = ambientFps()
  if (perf.forceContinuous) fps = Infinity

  if (fps > 0) {
    const due = ts - lastDrawTs >= 1000 / fps - MS_TOL
    if (due) {
      gpuTimer.poll()
      motionResolution(ts - lastDrawTs, fps, interacting || playing || ambient || scrubbing)
      draw(ts)
    } else if (requested) carryRequest = true
  }

  // back to full resolution once the motion has ended: a moment without any (input often
  // comes in slower than frames are drawn, and a drag held still for a frame is not over)
  const moving = interacting || playing || ambient || scrubbing
  if (moving) lastMotionTs = ts
  const still = !moving && ts - lastMotionTs >= MOTION_SETTLE_MS
  if (still) {
    motionResolution(0, 0, false)
    if (pixelRatio < pixelRatioCap() && holdPr === 0) {
      pixelRatio = pixelRatioCap()
      carryRequest = true
    }
  }

  const nextDue = fps > 0 ? lastDrawTs + 1000 / fps - MS_TOL - ts : 0
  if (fps > 0 && !baking && !carryRequest && nextDue > 40) {
    // slow ambient motion only: no animation frames until the next draw is due
    ambientTimer = window.setTimeout(() => {
      ambientTimer = 0
      wake()
    }, nextDue - 12)
  } else if (fps > 0 || baking || carryRequest) rafId = requestAnimationFrame(frame)
  else if (pixelRatio < pixelRatioCap() && holdPr === 0) {
    // the motion paused: wait the moment out (no drawing), then one frame at full resolution
    rafId = requestAnimationFrame(frame)
  } else sleep()
}

applyQuality(quality)
wake()

// ---------- debugging and measurement (perf=1 shows the readout) ----------

perf.expose({
  renderer,
  scene,
  camera,
  getGlobe: () => currentGlobe,
  getClouds: () => currentClouds,
  drawNow: () => {
    requestRender()
    draw(performance.now())
  },
  bakeReady: () => {
    const g = currentGlobe?.bakeInfo
    const c = currentClouds?.bakeInfo
    return currentWorld !== null && (!bakeEnabled || viewMode !== ViewMode.Terrain || (g !== undefined && !g.pending && c !== undefined && !c.pending))
  },
  pixelRatio: () => pixelRatio,
  quality: () => quality,
  gpuTimer,
  setMotionRes: (mode) => {
    motionResMode = mode
    motionPr = 0
  },
  setAtmosphereSteps: (n) => atmosphere.setSteps(n),
})
if (params.get('perf') === '1') {
  // the flat map: switch (animated or not) and state
  ;(window as unknown as { __worldseedMap: unknown }).__worldseedMap = {
    set: (on: boolean, animate = true) => setMapMode(on, animate),
    state: () => ({ map: mapOn, morph, t: flat.t, lon0: flat.lon0, lat0: flat.lat0, alt: camera.position.length() - 1, fit: mapControls.fitAltitude() }),
    /** The settlement under canvas pixel (x, y), as a click would pick it (-1: none). */
    pick: (x: number, y: number) => historyView.pickAt(x, y),
  }
  // motion resolution state
  ;(window as unknown as { __worldseedMotion: unknown }).__worldseedMotion = () => ({ pixelRatio, motionPr, motionAlt, motionWasOn, samples: [...motionSamples], gpu: gpuTimer.available, mode: motionResMode, lastMotionTs })
  /** Draw at this ratio even at rest (through the motion target below the cap); 0 lets go. */
  ;(window as unknown as { __worldseedHoldRatio: unknown }).__worldseedHoldRatio = (pr: number, direct = false) => {
    holdPr = pr
    holdDirect = direct && pr > 0
    sizeDirty = true
    pixelRatio = pr > 0 ? pr : pixelRatioCap()
    requestRender()
    wake()
  }
  // history extension: state, the last swap's timing, and a simulated failure
  ;(window as unknown as { __worldseedHistory: unknown }).__worldseedHistory = {
    years: () => historyView.years,
    extending: () => extending,
    lastSwap: () => historyView.lastSwap,
    /** The history shown, its index and the journey layer (journey and long-haul checks). */
    debug: () => historyView.debug(),
    failNextExtension: () => {
      failNextExtension = true
    },
  }
}
