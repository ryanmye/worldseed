import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { World, WorldOptions } from './contract.ts'
import type { WorkerRequest, WorkerResponse } from './worker.ts'
import { buildGlobeMesh, type GlobeMesh } from './render/globe.ts'
import { buildRiverLines, type RiverLines } from './render/rivers.ts'
import { buildAtmosphere, buildClouds, buildStarfield, type Clouds } from './render/sky.ts'
import { createOverlay, loadLayerPrefs } from './ui/overlay.ts'
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
import { located, renderedGroundRadius, setTerrainHistory } from './render/terrainHeight.ts'

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
if (params.get('tilt') !== '0') installCameraTilt(camera, controls, () => showBuildings, groundUnder) // leans the view toward the horizon up close

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
const showFactions = layerOn('factions', 'factions') // factions=0: no faction tint, borders, capitals and armies
/** While a known world is shown its mist goes under the clouds (historyView.ts). */
let cloudsOverFog = false
let viewMode: ViewModeT = isViewMode(params.get('view')) ? (params.get('view') as ViewModeT) : ViewMode.Terrain

function applyLayerVisibility() {
  const terrain = viewMode === ViewMode.Terrain
  if (currentRivers) currentRivers.lines.visible = showRivers && terrain
  if (currentClouds) currentClouds.mesh.visible = showClouds && terrain
  atmosphere.setStrength(terrain ? 1 : 0.35)
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
  return w
}

function onWorkerMessage(ev: MessageEvent<WorkerResponse>) {
  const msg = ev.data
  if (msg.requestId !== requestId) return
  requestRender()
  wake()
  if (msg.type === 'world') {
    overlay.setGenerating(false)
    showWorld(msg.world)
  } else if (msg.type === 'history') {
    console.info(`history: ${msg.history.years} years, ${msg.history.settlements.length} settlements, ${msg.history.events.length} events, ${msg.ms.toFixed(0)} ms`)
    // towns and fields flatten the ground (terrainHeight.ts) before any layer is placed on it
    if (currentWorld) setTerrainHistory(currentWorld, msg.history)
    if (msg.extend) {
      extending = 0
      historyView.extendHistory(msg.history, msg.ms)
    } else historyView.setHistory(msg.history)
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
  const req: WorkerRequest = { type: 'generate', requestId: ++requestId, seed, options: WORLD_OPTIONS, historyOptions: historyYears === 2000 ? undefined : { years: historyYears } }
  worker.postMessage(req)
}

function requestYears(years: number) {
  extending = years
  const req: WorkerRequest = { type: 'extend', requestId, years, fail: failNextExtension || undefined }
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
    historyView.setBuildingsVisible(show)
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
    addLayerToggle: (t) => overlay.addLayerToggle(t),
  },
  { year: intParam('year'), play: params.get('play') !== '0', select: intParam('select'), people: intParam('people'), knownAll: params.get('known') === 'all', species: intParam('species'), polity: intParam('polity'), factions: showFactions },
)
// the Crops and Herds views need the history's crop and herd layers (offered once they arrive)
overlay.setViewModeAvailable(ViewMode.Crops, false)
overlay.setViewModeAvailable(ViewMode.Herds, false)
// the Factions and Danger views need the history's polities (offered once they arrive)
overlay.setViewModeAvailable(ViewMode.Factions, false)
overlay.setViewModeAvailable(ViewMode.Danger, false)
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
historyView.setBuildingsVisible(showBuildings)
historyView.setTradeVisible(showTrade)
historyView.setRoadsVisible(showRoads)
historyView.setLabelsVisible(showLabels)
historyView.setExpeditionsVisible(showExpeditions)

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
// Adaptive resolution: while frames come in much slower than intended, the pixel ratio
// steps down (to the quality's minimum); it returns to the cap when the page goes idle or
// an interaction ends.

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
let slowMs = 0 // accumulated "frame too slow" time (adaptive resolution)
let wasInteracting = false
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

function applySize() {
  sizeDirty = false
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
}

/** Advance time-based state and draw one frame. */
function draw(ts: number) {
  if (sizeDirty) applySize()
  // near plane follows the height above the ground, so the ground up close is not clipped
  const nearWant = Math.min(0.05, Math.max(0.0012, (camera.position.length() - groundUnder(camera.position.x, camera.position.y, camera.position.z)) * 0.12))
  if (Math.abs(camera.near - nearWant) > camera.near * 0.15) {
    camera.near = nearWant
    camera.updateProjectionMatrix()
  }
  if (spinTime > 0) planetGroup.rotation.y += SPIN_SPEED * spinTime
  if (cloudTime > 0) currentClouds?.update(cloudTime)
  spinTime = cloudTime = 0
  updateSun(camera)
  currentGlobe?.update(camera)
  renderer.getDrawingBufferSize(drawSize)
  currentRivers?.update(camera, drawSize.y)
  historyView.tick(Math.min(tickTime, 0.1), drawSize, renderer.getPixelRatio())
  tickTime = 0
  const t0 = performance.now()
  renderer.render(scene, camera)
  perf.frame(ts, performance.now() - t0, renderer)
  lastDrawTs = ts
}

function frame(ts: number) {
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
  // damping per unit of time, not per frame: the same glide (and settle time) at any frame rate
  controls.dampingFactor = 1 - Math.pow(1 - DAMPING_PER_60HZ_FRAME, Math.min(Math.max(dt * 60, 0.25), 6))
  // drag speed eases off near the ground, where the view is a few houses across
  controls.rotateSpeed = 0.6 * Math.min(1, Math.max(0.025, (camera.position.length() - 1) / 0.5))
  // keep clear of the ground under the camera (tall mountains up close)
  controls.minDistance = Math.max(MIN_DISTANCE, groundUnder(camera.position.x, camera.position.y, camera.position.z) + MIN_CLEARANCE)
  inLoopControlsUpdate = true
  const moved = controls.update()
  inLoopControlsUpdate = false
  const camMoved = moved || flying || cameraChanged
  cameraChanged = false
  const sunMoved = updateSun(camera)

  const requested = consumeRenderRequest() || carryRequest
  carryRequest = false
  const interacting = camMoved || flying
  const playing = historyView.isPlaying()
  const ambient = spinning || cloudsDriveFrames()
  if (spinning) spinTime += dt
  if (cloudsDrift()) cloudTime += dt

  // surface and cloud bakes: one strip of a cube face per frame until done (procedural shading meanwhile)
  let baking = false
  if (perf.holdBake) baking = true
  else if (currentGlobe?.bakeStep(renderer, 1)) baking = true
  else if (currentGlobe && !currentGlobe.bakeInfo.pending && currentClouds?.bakeStep(renderer, 1)) baking = true
  // a finished bake swaps in the baked shaders: draw once
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
      // adaptive resolution: during continuous motion, consecutive draws much slower than intended
      const interval = ts - lastDrawTs
      if (!(interacting || playing || ambient)) slowMs = 0
      else if (interval < 250) {
        const target = Math.max(1000 / Math.min(fps, 60), 16.7)
        slowMs = interval > target * 1.5 + 4 ? slowMs + interval : Math.max(0, slowMs - interval)
        if (slowMs > 750 && pixelRatio > qs.pixelRatioMin + 1e-3) {
          pixelRatio = Math.max(qs.pixelRatioMin, pixelRatio - 0.25)
          sizeDirty = true
          slowMs = 0
        }
      }
      draw(ts)
    } else if (requested) carryRequest = true
  }

  // back to full resolution once an interaction ends
  if (wasInteracting && !interacting && pixelRatio < pixelRatioCap()) {
    pixelRatio = pixelRatioCap()
    sizeDirty = true
    carryRequest = true
  }
  wasInteracting = interacting

  const nextDue = fps > 0 ? lastDrawTs + 1000 / fps - MS_TOL - ts : 0
  if (fps > 0 && !baking && !carryRequest && nextDue > 40) {
    // slow ambient motion only: no animation frames until the next draw is due
    ambientTimer = window.setTimeout(() => {
      ambientTimer = 0
      wake()
    }, nextDue - 12)
  } else if (fps > 0 || baking || carryRequest) rafId = requestAnimationFrame(frame)
  else if (pixelRatio < pixelRatioCap()) {
    // idle: one more frame at full resolution, then sleep
    pixelRatio = pixelRatioCap()
    sizeDirty = true
    carryRequest = true
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
  setAtmosphereSteps: (n) => atmosphere.setSteps(n),
})
if (params.get('perf') === '1') {
  // history extension: state, the last swap's timing, and a simulated failure
  ;(window as unknown as { __worldseedHistory: unknown }).__worldseedHistory = {
    years: () => historyView.years,
    extending: () => extending,
    lastSwap: () => historyView.lastSwap,
    failNextExtension: () => {
      failNextExtension = true
    },
  }
}
