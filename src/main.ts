import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Order, World, WorldOptions } from './contract.ts'
import { canonicalCradles, decodeCradles, decodeOrders, encodeCradles, encodeOrders, type HistoryOptions } from './contract.ts'
import type { WorkerRequest, WorkerResponse } from './worker.ts'
import { buildGlobeMesh, type GlobeMesh } from './render/globe.ts'
import { buildRiverLines, type RiverLines } from './render/rivers.ts'
import { buildAtmosphere, buildClouds, buildStarfield, CLOUD_DECK_RADIUS, type Clouds } from './render/sky.ts'
import { buildSunDisc } from './render/sunDisc.ts'
import { buildCitySky } from './render/citySky.ts'
import { createOverlay, getFreeViewportInset, loadLayerPrefs, onFreeViewportChange } from './ui/overlay.ts'
import { goodsInUse } from './ui/tradePanel.ts'
import { attachPointer, TOUCH_PICK_SLOP_PX } from './ui/pointer.ts'
import { createDoubleTap } from './ui/doubleTap.ts'
import { ViewMode, isViewMode, type ViewMode as ViewModeT } from './render/palette.ts'
import { createCameraFly } from './render/cameraFly.ts'
import { createHistoryView, MAX_YEARS } from './ui/historyView.ts'
import { HISTORY_CHUNK_YEARS } from './ui/historyIndex.ts'
import { installCameraTilt } from './render/dioramas/cameraTilt.ts'
import { consumeRenderRequest, requestRender } from './render/invalidate.ts'
import { isSunMode, setSunLonLat, setSunMode, setSunToward, SUN_LAT_LIMIT, sunIsDefault, SunMode, sunState, updateSun } from './render/sun.ts'
import { cheaperQuality, loadQuality, Quality, QUALITY_SETTINGS, saveAutoQuality, saveQuality } from './render/quality.ts'
import { detectDevice } from './render/device.ts'
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
import { CityState, createCityView } from './render/cityView.ts'
import { createCityCard } from './ui/cityCard.ts'
import { setFlyInHandler } from './ui/flyIn.ts'
import { landmarkNameAt } from './contract.ts'
import { activeDioramaLayer } from './render/dioramas/layer.ts'
import { createLanding, randomSeed, YEARS_MAX, YEARS_MIN, type Landing } from './ui/landing.ts'
import { setShortcutsEnabled } from './ui/shortcuts.ts'
import { createHearthPicker } from './ui/hearthPicker.ts'
import { previewCradles } from './ui/cradlesData.ts'

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
// fly=<settlement id> (fly down into that town: the city view, render/cityView.ts),
// nocache=1 (simulate afresh instead of reading the world and history cache, and overwrite it; historyCache.ts),
// cachecheck=1 (on a cache hit also simulate afresh and log whether the two are identical: slow, for checking)
// o=<orders> (the player's nudges, contract.ts encodeOrders: `year:kind:actor[:target]` joined by `;`, e.g.
// o=1000:explore:5:12345;1000:fortify:14): part of the world's history like the seed, so the link reproduces a nudged
// world and its outcomes; written whenever the orders change (the Nudge panel, ui/nudgePanel.ts), cleared with a new seed
// c=<cradles> (the first hearths the player planted, contract.ts encodeCradles: a cell per people in people order,
// -1 the simulation's choice): part of the history like o=; written at Start (the start page's "Choose where peoples
// begin") and by the Nudge panel's "Replant the hearths", cleared with a new seed
// intro=1 (show the start page, ui/landing.ts, even with other parameters: seed= and years= prefill its fields),
// intro=0 (skip it). Without intro the start page shows at the bare URL only: any parameter at all opens the app
// directly, so shared links keep working. After Start the address gains seed= (and years= when not 2000), intro is dropped.

const params = new URLSearchParams(window.location.search)
/** The start page comes first (see intro= above). */
const showLanding = params.get('intro') === '1' || (params.get('intro') !== '0' && [...params.keys()].every((k) => k === 'intro'))
/** While the start page shows, the address the app writes is kept here and only applied at Start (the bare URL stays bare). */
let heldUrl: URL | null = showLanding ? new URL(window.location.href) : null

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
  const url = heldUrl ?? new URL(window.location.href)
  if (value === null) url.searchParams.delete(name)
  else url.searchParams.set(name, value)
  if (!heldUrl) window.history.replaceState(null, '', url)
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

/** Phone, weak device (render/device.ts): the default quality, the start page's turn. */
const device = detectDevice()
const qualityStart = loadQuality(params.get('quality'), device.defaultQuality)
let quality: Quality = qualityStart.quality
/** Nothing chosen (URL or settings): the first-frame probe may step the quality down once. */
let qualityAuto = qualityStart.auto
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
// touch: one finger turns the globe; two pinch to zoom and, dragged together, turn it too (no pan: the view orbits the centre)
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }
// no page scroll, pinch-zoom of the page or double-tap zoom over the canvas (and so no click delay); no long-press callout
canvas.style.touchAction = 'none'
canvas.style.userSelect = 'none'
canvas.style.setProperty('-webkit-user-select', 'none')
canvas.style.setProperty('-webkit-touch-callout', 'none')
canvas.style.setProperty('-webkit-tap-highlight-color', 'transparent')
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
let spinning = showLanding || numParam('spin', 1) !== 0
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
// the sun itself in the sky (render/sunDisc.ts)
const sunDisc = buildSunDisc()
scene.add(sunDisc.mesh)
// the sky seen from low down (the city view): a dome behind everything (render/citySky.ts)
const citySky = buildCitySky()
scene.add(citySky.mesh)

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
// (the start page shows the globe: a remembered map comes back after Start)
let mapOn = showLanding ? false : params.has('map') ? params.get('map') === '1' : loadPref(MAP_KEY) === '1'
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
  currentClouds.setPuffDetail(qs.cloudPuffDetail)
  planetGroup.add(currentClouds.mesh)
  if (bakeEnabled) {
    currentGlobe.setBakeSize(qs.bakeSize)
    currentClouds.setBakeSize(qs.cloudBakeSize)
  }
  applyLayerVisibility()
  historyView.setWorld(world)
  hearths.setWorld(world)
  // (planting on the start page while the seed changed: the new world's peoples)
  if (landing?.planting) startLandingPlanting()
}

// ---------- planting the first hearths (ui/hearthPicker.ts): the start page's and the Nudge panel's ----------
// while hearths are being planted the sun follows the camera (the whole visible globe lit), then goes back to what it was
let sunBeforePicking: SunMode | null = null
function sunForPicking(on: boolean) {
  if (on) {
    sunBeforePicking = sunState.mode
    // (daylight everywhere already lights it all)
    if (sunState.mode === SunMode.Fixed) setSunMode(SunMode.Follow)
  } else if (sunBeforePicking !== null) {
    // (unless the sun was set by hand meanwhile)
    if (sunState.mode === SunMode.Follow) setSunMode(sunBeforePicking)
    sunBeforePicking = null
  }
  // (not syncSun: the picker's sun is not written to the address)
  sunPanel.setSun(sunState.mode, sunState.lon, sunState.lat)
  requestRender()
  wake()
}
const hearths = createHearthPicker({ canvas, camera, planetGroup, getWorld: () => currentWorld, wake: () => wake(), onPickerActive: sunForPicking })

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
/** The player's orders (o=, the Nudge panel), canonical; the history shown or on its way was simulated with them. */
let currentOrders: Order[] = decodeOrders(params.get('o') ?? '')
/** The first hearths the player planted (c=, ui/hearthPicker.ts), canonical: the cradles the history shown or on its way was simulated with. */
let currentCradles: number[] = canonicalCradles(decodeCradles(params.get('c') ?? ''))
/** The history options of the history asked for: its length, the orders and the cradles (undefined: all default). */
function historyOptionsNow(years = historyYears): HistoryOptions | undefined {
  const o: HistoryOptions = {}
  if (years !== 2000) o.years = years
  if (currentOrders.length > 0) o.orders = currentOrders
  if (currentCradles.length > 0) o.cradles = currentCradles
  return Object.keys(o).length > 0 ? o : undefined
}
/** A re-simulation with new orders is on its way: the year to keep when it arrives (-1 none). */
let resimYear = -1
let resimLabel = ''

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
    landing?.setLoading(false)
  } else if (msg.type === 'progress') {
    historyView.setSimProgress(msg.years, msg.target, resimYear >= 0 ? resimLabel : undefined)
  } else if (msg.type === 'history') {
    console.info(`history: ${msg.history.years} years, ${msg.history.settlements.length} settlements, ${msg.history.events.length} events, ${msg.ms.toFixed(0)} ms`)
    // towns and fields flatten the ground (terrainHeight.ts) before any layer is placed on it
    if (currentWorld) setTerrainHistory(currentWorld, msg.history)
    overlay.setGoodsInUse(goodsInUse(msg.history.trade))
    if (msg.replace) {
      // a run with the new orders: swapped in keeping the camera, the selection and the year
      historyView.replaceHistory(msg.history, msg.ms, resimYear)
      resimYear = -1
    } else if (msg.extend) {
      extending = 0
      historyView.extendHistory(msg.history, msg.ms)
    } else historyView.setHistory(msg.history, historyYears) // (shorter than asked: shown at once, then extended to it)
  } else if (msg.stage === 'world') {
    overlay.setGenerating(false)
    console.error('world generation failed:', msg.message)
  } else if (msg.stage === 'extend') {
    extending = 0
    historyView.extendFailed(msg.message)
  } else if (resimYear >= 0) {
    // the run with new orders failed: the history shown stays
    resimYear = -1
    historyView.setSimProgress(0, 0, null)
    console.error('re-simulation with orders failed (keeping the current history):', msg.message)
  } else {
    historyView.setHistoryError(msg.message)
  }
}

/** Length of the initial history: years= (default 2000), or long enough for a start year= past it; in whole chunks, capped. */
function initialYears(): number {
  return wholeChunks(Math.max(numParam('years', 2000, 1, MAX_YEARS), numParam('year', 0, 0, MAX_YEARS)))
}
/** A history length asked for, in whole chunks, capped (as years= is read). */
function wholeChunks(want: number): number {
  return Math.min(MAX_YEARS, Math.max(HISTORY_CHUNK_YEARS, Math.ceil(want / HISTORY_CHUNK_YEARS - 1e-9) * HISTORY_CHUNK_YEARS))
}
let historyYears = initialYears()

/** The request id of the latest world asked for without its history (the start page), -1 none. */
let worldOnlyId = -1

/** `worldOnly`: the world without its history (the start page; the history follows at Start, startHistory). */
function requestWorld(seed: number, worldOnly = false) {
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
    historyOptions: historyOptionsNow(),
    // a long first run (year=6000): show the default length first, then extend to it
    firstYears: historyYears > 2000 ? 2000 : undefined,
    nocache: params.get('nocache') === '1' || undefined,
    cachecheck: params.get('cachecheck') === '1' || undefined,
    worldOnly: worldOnly || undefined,
  }
  worldOnlyId = worldOnly ? requestId : -1
  worker.postMessage(req)
}

/** Start on the start page: the history of the world shown there (or asked for), `historyYears` long. */
function startHistory(seed: number) {
  if (seed !== currentSeed || worldOnlyId !== requestId) {
    currentSeed = seed
    overlay.setSeed(seed)
    requestWorld(seed)
    return
  }
  worldOnlyId = -1
  worker.postMessage({
    type: 'history',
    requestId,
    historyOptions: historyOptionsNow(),
    firstYears: historyYears > 2000 ? 2000 : undefined,
    nocache: params.get('nocache') === '1' || undefined,
    cachecheck: params.get('cachecheck') === '1' || undefined,
  } satisfies WorkerRequest)
}

/**
 * Re-simulate the world with a new list of orders (the Nudge panel), as long as the history shown; the history on screen
 * stays until the new one arrives (then swapped in at year `keepYear`, see historyView.replaceHistory). Written to the URL (o=).
 */
function requestOrders(orders: Order[], keepYear: number) {
  currentOrders = decodeOrders(encodeOrders(orders))
  setUrlParam('o', currentOrders.length > 0 ? encodeOrders(currentOrders) : null)
  resimYear = Math.max(0, keepYear)
  extending = 0 // (an extension in flight is answered under the old requestId and dropped)
  const years = historyView.years || historyYears
  const req: WorkerRequest = { type: 'orders', requestId: ++requestId, orders: currentOrders, years, cradles: currentCradles }
  worker.postMessage(req)
  const n = currentOrders.length
  resimLabel = n > 0 ? `Simulating with ${n} ${n === 1 ? 'order' : 'orders'}…` : 'Simulating without orders…'
  historyView.setSimProgress(0, years, resimLabel)
}

/**
 * Re-simulate the world with the first hearths planted anew (the Nudge panel's "Replant the hearths"), as the orders
 * are: a new run from year 0 as long as the history shown, swapped in at `keepYear` keeping the camera. Written to the URL (c=).
 */
function requestCradles(cradles: number[], keepYear: number) {
  currentCradles = canonicalCradles(cradles)
  setUrlParam('c', currentCradles.length > 0 ? encodeCradles(currentCradles) : null)
  resimYear = Math.max(0, keepYear)
  extending = 0
  const years = historyView.years || historyYears
  worker.postMessage({ type: 'orders', requestId: ++requestId, orders: currentOrders, years, cradles: currentCradles } satisfies WorkerRequest)
  const n = currentCradles.filter((c) => c >= 0).length
  resimLabel = n > 0 ? `Simulating with ${n} ${n === 1 ? 'hearth' : 'hearths'} planted…` : 'Simulating with the hearths the world chooses…'
  historyView.setSimProgress(0, years, resimLabel)
}

function requestYears(years: number, full = false) {
  extending = years
  const req: WorkerRequest = { type: 'extend', requestId, years, fail: failNextExtension || undefined, full: full || undefined }
  failNextExtension = false
  worker.postMessage(req)
}

// ---------- UI ----------

// (the start page: the seed given, else a random one)
let currentSeed = showLanding && !params.has('seed') ? randomSeed() : seedFromUrl()

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
  setUrlParam('o', null) // (orders belong to the world they were given in)
  currentOrders = []
  setUrlParam('c', null) // (and so do the hearths planted)
  currentCradles = []
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
    requestOrders,
    getOrders: () => currentOrders,
    requestCradles,
    getCradles: () => currentCradles,
    hearths,
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
requestWorld(currentSeed, showLanding)

// ---------- pointer: terrain readout on hover, settlement hover/click ----------

const pointerInput = attachPointer({
  canvas,
  camera,
  getWorld: () => currentWorld,
  getGlobe: () => currentGlobe,
  // (nothing is described in lands the known world shown does not include)
  setReadout: (r) => overlay.setReadout(r && r.cell !== undefined ? (historyView.isCellHidden(r.cell) ? null : { ...r, places: historyView.placesAt(r.cell) }) : r),
  pickSettlement: (x, y, slop) => historyView.pickAt(x, y, slop),
  // (the city view's taps are its own: re-centring, naming a landmark)
  tapsElsewhere: () => cityView.engaged,
  hoverSettlement: (id) => historyView.setHover(id),
  selectSettlement: (id) => historyView.select(id, false),
  selectFactionAt: (cell) => historyView.selectFactionAt(cell),
  // (planting hearths first: the start page's and the Nudge panel's, ui/hearthPicker.ts)
  pickCell: (cell) => hearths.pickCell(cell) || historyView.pickCell(cell),
  dragSun: (dir) => {
    setSunToward(dir)
    syncSun()
  },
})

// ---------- city view (render/cityView.ts): fly down into a town, orbit it, fly back ----------

const cityCard = createCityCard(app, {
  onBack: () => cityView.flyOut(),
  onTurn: (rad) => cityView.turn(rad),
  onRaise: (k) => cityView.raise(k),
  onZoom: (k) => cityView.zoom(k),
})
const cityView = createCityView({
  camera,
  canvas,
  planetGroup,
  getWorld: () => currentWorld,
  getHistory: () => historyView.debug().history,
  getGlobe: () => currentGlobe,
  wake: () => wake(),
  onState(state, id) {
    if (state === CityState.Off) {
      cityCard.hide()
      setUrlParam('fly', null)
      if (!mapOn) controls.enabled = true
      historyView.setMarkersVisible(showMarkers)
      historyView.setLabelsVisible(showLabels)
    } else {
      // at street level the flat markers and place names only clutter the town
      if (state === CityState.Orbit) {
        historyView.setMarkersVisible(false)
        historyView.setLabelsVisible(false)
      }
      controls.enabled = false
      spinning = false
      fly.cancel()
      cityCard.show(state !== CityState.Orbit)
      if (state === CityState.Orbit) setUrlParam('fly', String(id))
    }
  },
})
/** Fly into settlement id: from the map, by way of the globe. */
function flyIntoCity(id: number): boolean {
  if (!showBuildings) return false
  const fromMap = mapOn
  if (mapOn) setMapMode(false, false)
  const ok = cityView.flyIn(id)
  // (the card names the town: no selection ring and inspector over the view)
  if (ok) historyView.select(-1, false)
  // from the map the 3D towns are not laid out yet: the flight starts once they are (as fly=<id>)
  else if (fromMap) pendingFly = id
  return ok || fromMap
}
setFlyInHandler((id) => {
  flyIntoCity(id)
})
// fly=<id>: once the history and the models are in
let pendingFly = intParam('fly') ?? -1
// double-click a settlement marker (or a town's buildings) on the globe or the map
// (what was under the first press: that click selects the town and the opening inspector moves the view)
let downPick = -1
let downPickTs = 0
/** The last press on the canvas was a finger (its taps: the double tap below; the browser's own dblclick is ignored). */
let touchPress = false
canvas.addEventListener('pointerdown', (e) => {
  touchPress = e.pointerType === 'touch'
  if (cityView.engaged || e.button !== 0) return
  const rect = canvas.getBoundingClientRect()
  if (performance.now() - downPickTs > 600 || downPick < 0) {
    downPick = historyView.pickAt(e.clientX - rect.left, e.clientY - rect.top, touchPress ? TOUCH_PICK_SLOP_PX : undefined)
    downPickTs = performance.now()
  }
})
function flyIntoPicked(e: MouseEvent, slop?: number) {
  const rect = canvas.getBoundingClientRect()
  let id = historyView.pickAt(e.clientX - rect.left, e.clientY - rect.top, slop)
  if (id < 0 && performance.now() - downPickTs < 800) id = downPick
  downPick = -1
  if (id >= 0) flyIntoCity(id)
}
canvas.addEventListener('dblclick', (e) => {
  if (cityView.engaged || touchPress) return
  flyIntoPicked(e)
})
// double-tap a town (touch): fly in (after the taps' own clicks, pointer.ts, selected it)
const doubleTap = createDoubleTap()
/** The town the first tap of a pair landed on (-1: none). */
let firstTapTown = -1
let swallowClickUntil = 0
// the first tap may open something over the town (the inspector): a second tap there still completes the double tap,
// and that element gets neither the press nor its click
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || e.target === canvas || cityView.engaged || firstTapTown < 0 || !doubleTap.pending(e.clientX, e.clientY)) return
  e.preventDefault()
  e.stopPropagation()
  swallowClickUntil = performance.now() + 700
  doubleTap.tap(e.clientX, e.clientY)
  const id = firstTapTown
  firstTapTown = -1
  flyIntoCity(id)
}, { capture: true })
window.addEventListener('click', (e) => {
  if (performance.now() > swallowClickUntil) return
  swallowClickUntil = 0
  e.preventDefault()
  e.stopPropagation()
}, { capture: true })
canvas.addEventListener('click', (e) => {
  if (!touchPress) return
  if (cityView.state === CityState.Orbit) {
    // (no hover on touch: a tap names the landmark under it, a tap elsewhere clears the name)
    const rect = canvas.getBoundingClientRect()
    const lm = cityView.landmarkAt(e.clientX - rect.left, e.clientY - rect.top)
    const h = historyView.debug().history
    const layer = activeDioramaLayer()
    cityCard.hover(lm && h && layer ? landmarkNameAt(h, lm.lm, Math.floor(layer.year)) : null, e.clientX, e.clientY)
    return
  }
  if (cityView.engaged) return
  if (doubleTap.tap(e.clientX, e.clientY)) {
    firstTapTown = -1
    flyIntoPicked(e, TOUCH_PICK_SLOP_PX)
  } else {
    const rect = canvas.getBoundingClientRect()
    firstTapTown = historyView.pickAt(e.clientX - rect.left, e.clientY - rect.top, TOUCH_PICK_SLOP_PX)
  }
})
// hovering a landmark in the city view names it
canvas.addEventListener('pointermove', (e) => {
  if (cityView.state !== CityState.Orbit || e.buttons) return cityCard.hover(null, 0, 0)
  const rect = canvas.getBoundingClientRect()
  const lm = cityView.landmarkAt(e.clientX - rect.left, e.clientY - rect.top)
  const h = historyView.debug().history
  const layer = activeDioramaLayer()
  cityCard.hover(lm && h && layer ? landmarkNameAt(h, lm.lm, Math.floor(layer.year)) : null, e.clientX, e.clientY)
})
canvas.addEventListener('pointerleave', (e) => {
  // (a finger leaves at every lift: a tapped landmark's name stays)
  if (e.pointerType !== 'touch') cityCard.hover(null, 0, 0)
})
{
  const inOrbit = () => cityView.state === CityState.Orbit
  addShortcut({ keys: ['Escape'], label: 'Esc', description: 'City view: back to the globe', group: 'View', first: true, run: () => {
    if (!cityView.engaged || cityView.state === CityState.Out) return false
    // an open popup closes first
    if (document.querySelector('.popover:not(.hidden)')) return false
    cityView.flyOut()
  } })
  addShortcut({ keys: ['q', 'Q'], label: 'Q / E', description: 'City view: turn left / right', group: 'View', run: () => (inOrbit() ? cityView.turn(-0.3) : false) })
  addShortcut({ keys: ['e', 'E'], label: 'Q / E', description: 'City view: turn left / right', group: 'View', run: () => (inOrbit() ? cityView.turn(0.3) : false) })
  addShortcut({ keys: ['x', 'X', 'PageUp'], label: 'Z / X', description: 'City view: lower / raise the view', group: 'View', run: () => (inOrbit() ? cityView.raise(1.2) : false) })
  addShortcut({ keys: ['z', 'Z', 'PageDown'], label: 'Z / X', description: 'City view: lower / raise the view', group: 'View', run: () => (inOrbit() ? cityView.raise(1 / 1.2) : false) })
  addShortcut({ keys: ['+', '='], label: '+ / −', description: 'City view: closer / further', group: 'View', run: () => (inOrbit() ? cityView.zoom(0.8) : false) })
  addShortcut({ keys: ['-', '_'], label: '+ / −', description: 'City view: closer / further', group: 'View', run: () => (inOrbit() ? cityView.zoom(1.25) : false) })
  addShortcut({ keys: ['y', 'Y'], label: 'Y', description: 'Fly down into the selected town (double-click a town does too)', group: 'View', run: () => {
    const id = historyView.debug().index ? selectedSettlement() : -1
    if (cityView.engaged || id < 0) return false
    return flyIntoCity(id)
  } })
}
/** The inspector's settlement (-1 none), from the URL the selection keeps current. */
function selectedSettlement(): number {
  const v = new URLSearchParams(window.location.search).get('select')
  const n = v === null ? NaN : Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : -1
}
let cityCardTs = 0

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
  // (q-low: opaque panels, no backdrop blur)
  document.body.classList.toggle('q-low', !qs.panelBlur)
  atmosphere.setSteps(qs.atmosphereSteps)
  // (the stars are in random order: the first n are an even thinning)
  stars.geometry.setDrawRange(0, Math.round((stars.geometry.getAttribute('position').count) * qs.starFraction))
  currentClouds?.setPuffDetail(qs.cloudPuffDetail)
  while (motionTargets.length > qs.motionTargets) motionTargets.pop()?.dispose()
  if (motionTargets[0] && motionTargets[0].samples !== qs.motionSamples) motionTargets.splice(0).forEach((t) => t.dispose())
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
      qualityAuto = false
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
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: qs.motionSamples, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
    rt.texture.colorSpace = THREE.SRGBColorSpace
    rt.texture.internalFormat = 'RGBA8'
    ;(rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true
    motionTargets.unshift(rt)
    while (motionTargets.length > qs.motionTargets) motionTargets.pop()?.dispose()
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

// First-frame probe: with no quality chosen, the first still frames of the app (the bakes done, off the
// start page) are timed, CPU and GPU, by drawing a few back to back and waiting for each; a device that
// cannot draw them at 30 fps gets one step cheaper (remembered for the next visit, apart from the user's
// choice, so a still slow device steps down once more next time).
const PROBE_FRAMES = 3
const PROBE_SLOW_MS = 34
let probe: { ms: number[]; median: number; from: Quality; to: Quality } | null = null
function qualityProbe(ts: number) {
  const gl = renderer.getContext()
  const px = new Uint8Array(4)
  const ms: number[] = []
  // (one draw to finish what came before)
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
  for (let i = 0; i < PROBE_FRAMES; i++) {
    const t = performance.now()
    draw(ts)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    ms.push(performance.now() - t)
  }
  const median = ms.slice().sort((a, b) => a - b)[PROBE_FRAMES >> 1]
  const from = quality
  const to = median > PROBE_SLOW_MS ? cheaperQuality(quality, device.phone || device.touchOnly) : quality
  probe = { ms: ms.map((m) => +m.toFixed(1)), median: +median.toFixed(1), from, to }
  if (to !== from) {
    saveAutoQuality(to)
    applyQuality(to)
  }
}

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
const cloudsDriveFrames = () => qs.cloudsAnimate === 'always' && cloudsDrift() && !cityView.engaged && !landingIdle

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
  // (on the start page the planet is centred on the canvas; the hand-over moves it to the free rect's centre)
  const k = landingGeom
  camera.setViewOffset(w, h, (k * (inset.right - inset.left)) / 2, (k * (inset.bottom - inset.top)) / 2, w, h)
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
  // (on the start page the page's sky shows the stars, landing.ts; the canvas's own, the same, once it is over)
  ;(stars.material as THREE.ShaderMaterial).uniforms.uFade.value = landing ? 0 : 1 - Math.min(1, t / 0.5)
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
  if (landing) {
    landingFrame(ts)
    const sky = landing?.takeSky()
    if (sky) drawLandingSky(sky)
  }
  // near plane follows the height above the ground, so the ground up close is not clipped
  const groundR = groundUnder(camera.position.x, camera.position.y, camera.position.z)
  atmosphere.setGroundRadius(groundR)
  const nearWant = Math.min(0.05, Math.max(0.0012, (camera.position.length() - groundR) * 0.12))
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
  // (not on the start page: its sky is a fixed layer behind the scrolling planet, landing.ts)
  sunDisc.update(camera, drawSize.y, landing !== null)
  // the low sky: off on the start page and toward the flat map; the stars fade under it by day,
  // and the clouds seen from below draw after the sun (they pass in front of it)
  citySky.update(camera, landing ? 0 : 1 - Math.min(1, flat.t / 0.45))
  ;(stars.material as THREE.ShaderMaterial).uniforms.uFade.value *= citySky.stars
  if (currentClouds) currentClouds.mesh.renderOrder = citySky.low > 0 && camera.position.length() < CLOUD_DECK_RADIUS ? 10.6 : 5
  const tt = performance.now()
  historyView.tick(Math.min(tickTime, 0.1), drawSize, target ? pixelRatio : renderer.getPixelRatio())
  hearths.update(camera, drawSize, target ? pixelRatio : renderer.getPixelRatio())
  tickTime = 0
  if (cityView.engaged && ts - cityCardTs > 200) {
    // (the card: a few times a second at most, and only on frames drawn anyway)
    cityCardTs = ts
    const h = historyView.debug().history
    const layer = activeDioramaLayer()
    if (h && layer) cityCard.update(h, cityView.settlement, layer.year, cityView.focus, cityView.inView(), cityView.state !== CityState.Orbit)
  }
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
  // (a panel's fly-to takes the camera from the city view)
  if (cityView.engaged && fly.active) cityView.abort()
  // fly=<id>: once there is a history and the models are in
  if (pendingFly >= 0 && currentWorld && historyView.debug().history && activeDioramaLayer()?.active && !activeDioramaLayer()?.pending) {
    const id = pendingFly
    pendingFly = -1
    flyIntoCity(id)
  }
  const flying = fly.active || cityView.state === CityState.In || cityView.state === CityState.Out
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
  } else if (cityView.engaged) {
    moved = cityView.update(Math.min(dt, 0.1))
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
  // (the town's light and shadow fit in the city view: dioramas/layer.ts setCity)
  activeDioramaLayer()?.setCity(cityView.engaged ? cityView.settlement : -1, qs.townShadows)

  // (the start page's hand-over to the app: every frame)
  const requested = consumeRenderRequest() || carryRequest || landing?.leaving === true
  carryRequest = false
  const interacting = camMoved || flying
  // frames drawn one after another for input (dragging the timeline, a held key): motion too
  if (ts - inputTs >= 150) inputStreak = 0
  else if (requested && ts - lastDrawTs < 100) inputStreak++
  const scrubbing = inputStreak >= 3
  const playing = historyView.isPlaying()
  const ambient = spinning || cloudsDriveFrames()
  if (spinning) spinTime += dt
  if (spinning && device.touchOnly && (turnSeconds += dt) > TOUCH_TURN_SECONDS) {
    spinning = false
    landingTurnOver = true
  }
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
  if (qualityAuto && !probe && !baking && !landing && currentWorld && !cityView.engaged && !interacting && pixelRatio >= pixelRatioCap() && (!bakeEnabled || (currentGlobe?.bakeInfo.ready ?? false))) qualityProbe(ts)

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

// ---------- the start page (ui/landing.ts) ----------
// The planet lies in the page, centred on its own canvas, the camera set back so the disc fills the page's slot;
// at Start the camera comes in to the app's distance and the centre moves to the free rect's (landingFrame).

/** Geometry from the start page (0) to the app (1). */
let landingGeom = showLanding ? 0 : 1
/** The page is scrolled away from the planet: no slow turn, no cloud drift. */
let landingIdle = false
/** Touch devices: the slow turn (a frame every few dozen ms for as long as it lasts) stops after this many seconds of it (battery). */
const TOUCH_TURN_SECONDS = 8
let turnSeconds = 0
let landingTurnOver = false
const APP_DIST = 3.25
let landing: Landing | null = null
if (showLanding) {
  controls.enabled = false
  setShortcutsEnabled(false)
  landing = createLanding({
    canvas,
    seed: currentSeed,
    years: Math.min(YEARS_MAX, Math.max(YEARS_MIN, numParam('years', 2000))),
    onSeed(seed) {
      currentSeed = seed
      overlay.setSeed(seed)
      setUrlParam('seed', String(seed))
      // (hearths belong to the world they were planted in)
      currentCradles = []
      if (!landing?.planting) landing?.endPlanting(0)
      landing?.setLoading(true)
      requestWorld(seed, true)
    },
    onStart(seed, years) {
      // the address: what the app wrote meanwhile, with the seed and the years chosen
      const url = heldUrl ?? new URL(window.location.href)
      heldUrl = null
      url.searchParams.delete('intro')
      url.searchParams.set('seed', String(seed))
      if (years === 2000) url.searchParams.delete('years')
      else url.searchParams.set('years', String(years))
      if (currentCradles.length > 0) url.searchParams.set('c', encodeCradles(currentCradles))
      else url.searchParams.delete('c')
      window.history.replaceState(null, '', url)
      historyYears = wholeChunks(years)
      startHistory(seed)
      landingIdle = false
      spinning = numParam('spin', 1) !== 0
      turnSeconds = 0
      overlay.relayout()
    },
    onVisible(visible) {
      if (landing?.leaving) return
      landingIdle = !visible
      spinning = visible && !hearths.active && !landingTurnOver
      wake()
    },
    onPlant(on) {
      if (on) {
        startLandingPlanting()
        return
      }
      // (the button again, or Start: the hearths as planted are kept)
      if (hearths.active) {
        currentCradles = canonicalCradles(hearths.cells())
        hearths.stop()
      }
      endLandingPlanting()
    },
    wake() {
      requestRender()
      wake()
    },
  })
  landing.setLoading(currentWorld === null)
  landing.mountPlantBar(hearths.bar)
}

/** Planting on the start page: the globe takes the pointer (a drag turns it, no zoom), the slow turn stops, the picker starts (again, for a new world) once the world's people count is known. */
async function startLandingPlanting() {
  const w = currentWorld
  if (!landing || !w) return
  spinning = false
  controls.enabled = true
  controls.enableZoom = false
  const count = (await previewCradles(w, [])).count
  if (!landing?.planting || currentWorld !== w) return
  hearths.start({
    max: count,
    cells: currentCradles,
    onDone(cells) {
      currentCradles = cells
      endLandingPlanting()
    },
  })
}
function endLandingPlanting() {
  if (!landing) return
  controls.enabled = false
  controls.enableZoom = true
  landing.endPlanting(currentCradles.filter((c) => c >= 0).length)
  requestRender()
  wake()
}
/** One frame of the start page: the camera's distance and the view's centre between the page's and the app's. */
function landingFrame(ts: number) {
  if (!landing) return
  const f = landing.frame(ts)
  landingGeom = f.geom
  // the disc's radius (a fraction of the half-height) eased between the two, and the distance that shows it so
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
  const rhoApp = 1 / (Math.sqrt(APP_DIST * APP_DIST - 1) * tanHalf)
  const rho = landing.discRho() + (rhoApp - landing.discRho()) * f.geom
  camera.position.setLength(Math.sqrt(1 + 1 / (rho * tanHalf) ** 2))
  syncViewportOffset()
  // the page's sky keeps its hole over the planet as it moves (the view offset moves the image the other way)
  const inset = getFreeViewportInset()
  const h = window.innerHeight
  landing.setDisc((-f.geom * (inset.right - inset.left)) / 2, (-f.geom * (inset.bottom - inset.top)) / 2, (rho * h) / 2)
  if (f.done) {
    landing = null
    landingGeom = 1
    controls.enableZoom = true
    controls.enabled = !mapOn && !cityView.engaged
    setShortcutsEnabled(true)
    // a remembered map comes back (the start page showed the globe)
    if (!params.has('map') && loadPref(MAP_KEY) === '1') setMapMode(true)
  }
}

/**
 * The start page's sky: the app's starfield alone, as the app will show it (the camera at the app's distance, the
 * view centred on the free rect), drawn straight onto the canvas (on black: the page screens it onto the planet's
 * canvas) and copied at once into the page's sky canvas, before the frame itself is drawn over it.
 */
const skyScene = new THREE.Scene()
function drawLandingSky(out: HTMLCanvasElement) {
  const fade = (stars.material as THREE.ShaderMaterial).uniforms.uFade
  const was = fade.value
  const len = camera.position.length()
  const geom = landingGeom
  fade.value = 1
  camera.position.setLength(APP_DIST)
  landingGeom = 1
  syncViewportOffset()
  skyScene.add(stars)
  renderer.setRenderTarget(null)
  renderer.setClearColor(0x000000, 1)
  renderer.render(skyScene, camera)
  const src = renderer.domElement
  out.width = src.width
  out.height = src.height
  out.getContext('2d')?.drawImage(src, 0, 0)
  scene.add(stars)
  fade.value = was
  camera.position.setLength(len)
  landingGeom = geom
  syncViewportOffset()
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
  // city view: fly in / out, its state and the last flight's longest frame
  ;(window as unknown as { __worldseedCity: unknown }).__worldseedCity = {
    flyIn: (id: number) => flyIntoCity(id),
    flyOut: () => cityView.flyOut(),
    state: () => ({ state: cityView.state, id: cityView.settlement, focus: cityView.focus, flight: { ...cityView.lastFlight }, inView: cityView.inView(), cam: camera.position.toArray(), alt: camera.position.length() - 1 }),
    turn: (r: number) => cityView.turn(r),
    raise: (k: number) => cityView.raise(k),
    zoom: (k: number) => cityView.zoom(k),
    landmarkAt: (x: number, y: number) => cityView.landmarkAt(x, y),
    /** Fixed sun `elev` degrees above settlement id's horizon, toward azimuth `az` (degrees from east, counter-clockwise). */
    sunOver: (id: number, elev = 35, az = 200) => {
      const h = historyView.debug().history
      if (!h || !currentWorld) return false
      const P = currentWorld.grid.positions, c = h.settlements[id].cell
      const u = new THREE.Vector3(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]).normalize()
      const e = new THREE.Vector3(-u.z, 0, u.x).normalize(), n = new THREE.Vector3().crossVectors(u, e)
      const E = THREE.MathUtils.degToRad(elev), A = THREE.MathUtils.degToRad(az)
      const d = u.clone().multiplyScalar(Math.sin(E)).addScaledVector(e, Math.cos(E) * Math.cos(A)).addScaledVector(n, Math.cos(E) * Math.sin(A))
      planetGroup.localToWorld(d.add(planetGroup.position)).normalize()
      setSunToward(d)
      syncSun()
      return true
    },
    world: () => currentWorld,
    aim: (id: number) => {
      const l = activeDioramaLayer()
      return l ? { aim: l.cityAim(id, l.year), pending: l.pending, detail: currentGlobe?.detailPending } : null
    },
  }
  // device class, quality and the first-frame probe
  ;(window as unknown as { __worldseedDevice: unknown }).__worldseedDevice = () => ({ device, quality, qualityAuto, probe, pixelRatio, cap: pixelRatioCap(), stars: stars.geometry.drawRange.count })
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
