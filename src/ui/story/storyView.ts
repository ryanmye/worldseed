// The story director in the app (experience-whatif-director-sagas §2.4–2.5): built by the history view, it scores the
// history's chronicle entries (drama.ts), plans the beats (plan.ts), runs "Follow the story" (director.ts) and the
// notices, and words captions from the existing saga scenes or the chronicle's own lines (one wording source).
// Off by default: Follow is the H key, the timeline's Follow button (a touch target on phones) or follow=1 in the
// address; notices come with Follow, or on their own from the View menu's "Story notices" toggle.
// onboarding (EVALUATION §4 Lane 4): Follow is on by default for a first visit (ui/onboard.ts decides initialOn); it
// opens on the people's heartland (the most populous place a century on) and goes back there through quiet stretches;
// the director fast-forwards those stretches (director.ts pacing); every flight brings its place into daylight (the
// planet turns under the fixed sun, so no beat is framed on the night side); the top battles of the run play their 2D
// replay inline as their year comes; the timeline shows the time left; a caption's Share links to the moment.

import * as THREE from 'three'
import { EventType, type History, type World } from '../../contract.ts'
import { surfaceRadius } from '../../render/globe.ts'
import type { CameraFly } from '../../render/cameraFly.ts'
import type { Chronicle } from '../chronicle.ts'
import type { HistoryIndex } from '../historyIndex.ts'
import type { LayerToggle } from '../overlay.ts'
import type { Timeline } from '../timeline.ts'
import { decadeOf, generateSaga, type SagaSubject } from '../sagas/index.ts'
import { Ctx } from '../sagas/facts.ts'
import { conversionScene, landfallScene, plagueScene, sackScene, SCENE_T, workScene, type Scene } from '../sagas/scenes.ts'
import { Voice } from '../sagas/voice.ts'
import { OMEN_T } from '../sagas/omens.ts'
import { addShortcut } from '../shortcuts.ts'
import { loadFlag, saveFlag } from '../panels.ts'
import { buildStaticDrama, createDramaCtx, DRAMA_CAT_NAMES, type StaticDrama } from './drama.ts'
import { beatKept, buildStoryPlan, STORY, type StoryPlan } from './plan.ts'
import { createDirector, DIRECTOR, DirectorState, dwellSlowAt, type Director } from './director.ts'
import { SUN_DIRECTION, SunMode, sunState } from '../../render/sun.ts'
import { flat } from '../../render/mapProjection.ts'
import { battlesOf, battleWeight, townAt } from '../battlesData.ts'
import type { BattleOpenOptions } from '../battleMap.ts'
import { battleSummary, battleTitle, decidingShort, describeBattle } from '../battleFormat.ts'
import { contextChanged, registerContext } from '../contextPanel.ts'
import { createDramaStrip } from './dramaStrip.ts'
import { arcEntries, findArcs } from './arcs.ts'
import { createStoryCard, type CaptionMore, type StoryCard } from './storyCard.ts'

export interface StoryViewDeps {
  /** The overlay root (the card and notices go in it). */
  host: HTMLElement
  canvas: HTMLCanvasElement
  camera: THREE.PerspectiveCamera
  planetGroup: THREE.Group
  fly: CameraFly
  timeline: Timeline
  chronicle: Chronicle
  /** Stops the globe's turn before a flight (historyView deps.onFly, without suspending the director). */
  stopSpin(): void
  cityEngaged(): boolean
  /** The register of the Sagas panel (legend or chronicle). */
  legend(): boolean
  openSaga(subject: SagaSubject): void
  /** causes: the caption's "Why?" opens the Why panel on the beat's event (absent: no button). */
  openWhy?(event: number): void
  addLayerToggle?(t: LayerToggle): HTMLInputElement
  setUrlParam(name: string, value: string | null): void
  requestRender(): void
  wake(): void
  /** Follow on when the first history shows (follow=1, or a first visit: ui/onboard.ts followByDefault). */
  initialOn: boolean
  /** battles: the 2D replay (inline: the director's own, closing by itself); whether one is open. */
  openBattle?(b: number, opts?: BattleOpenOptions): void
  battleOpen?(): boolean
  /** The timeline's playback, paused by a replay, goes on after it (Follow still on). */
  play?(): void
  /** n4c: quiet the map's moving layers (travellers, trade, expeditions) while a strip jump's caption shows (play-test 2: a busy map). */
  quiet?(on: boolean): void
  /** ui-additions 2: the right column, where the story's battle is the context panel while it is told (absent: none). */
  contextHost?: HTMLElement
}

export interface StoryView {
  /** The history shown changed (or grew, `extend`). */
  commit(h: History | null, w: World | null, ix: HistoryIndex | null, extend: boolean): void
  /** n4b: a decision card's Show me flew away: following resumes once `stillOpen` says the card has closed. */
  resumeAfter(stillOpen: () => boolean): void
  /** Polities whose stories get the focus factor (the selection); rebuilds the plan when it changes. */
  setFocus(polities: readonly number[]): void
  /** A camera move the director did not make (a panel's fly-to, a pick): suspend following. */
  userMoved(): void
  tick(dt: number, year: number): void
  readonly director: Director
  /** onboarding: whether Follow turns on when the history shows (the start page's play path sets it before Start). */
  setFollowOnShow(on: boolean): void
  /** The current plan and static scores (tests, perf=1 tools). */
  debug(): { plan: StoryPlan | null; drama: StaticDrama | null }
}

/** One symbol per category for the notices. */
const CAT_ICON: readonly string[] = ['⚔', '♛', '♜', '✦', '☠', '⚓', '⌂', '✎', '⚖', '☁', '⚑', '☞']
/** Notices: at most one new per this many real seconds; one expires when its year is this far behind. */
const NOTICE_EVERY = 2
const NOTICE_EXPIRE_YEARS = 30
const NOTICE_TEXT_MAX = 110

/** onboarding: a place this lit or less (cos of the sun's angle from its zenith) is turned into the day before a beat. */
const DAY_MIN = 0.42
/** The camera ends this far east of the sun's meridian (radians): lit, with some relief from the low sun to its west. */
const DAY_OFFSET = THREE.MathUtils.degToRad(35)
/** The heartland shot: its distance, the years ahead it looks for the most populous place, and its least real interval (s). */
const HEART_DIST = 2.05
const HEART_AHEAD = 100
const HEART_EVERY = 20
/** Before this year the heartland shot frames the leading people's hearth (glowing, render/peopleWash.ts). */
const HEART_HEARTH_YEARS = 250
/** n4c: a caption goes once the year shown is this far from its own. */
const CAPTION_LAG_YEARS = 8
/** The top battles of a run that play their replay inline while following. */
const TOP_BATTLES = 3

const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()
const ease3 = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export function createStoryView(deps: StoryViewDeps): StoryView {
  let history: History | null = null
  let world: World | null = null
  let index: HistoryIndex | null = null
  let drama: StaticDrama | null = null
  let plan: StoryPlan | null = null
  let focusKey = ''
  let focus = new Set<number>()
  const reduceQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  const reducedMotion = () => reduceQuery?.matches ?? false

  // ---------- geometry ----------
  /** World-space position of cell `cell` on the surface into `out`. */
  const cellWorld = (cell: number, out: THREE.Vector3) => {
    const w = world!
    const P = w.grid.positions
    const r = surfaceRadius(w, cell)
    deps.planetGroup.updateWorldMatrix(true, false)
    return out.set(P[cell * 3] * r, P[cell * 3 + 1] * r, P[cell * 3 + 2] * r).applyMatrix4(deps.planetGroup.matrixWorld)
  }
  const validCell = (cell: number) => !!world && cell >= 0 && cell < world.grid.cellCount
  let flights = 0
  /** Daylight framing is possible: the globe (not the flat map) under a fixed sun (follow and full light it anyway). */
  const daylightFraming = () => flat.t === 0 && sunState.mode === SunMode.Fixed
  /** How lit the place at world point `p` is (cos of the sun's zenith angle there). */
  const lightAt = (p: THREE.Vector3) => p.dot(SUN_DIRECTION) / Math.max(1e-9, p.length())
  /** The planet's turn toward the day (eased with the flight): rotation.y from a to b over `len` seconds. */
  const turn = { active: false, a: 0, b: 0, t: 0, len: 1 }
  const flyTo = (cell: number, dist: number, seconds: number) => {
    if (!validCell(cell)) return
    flights++
    deps.stopSpin()
    cellWorld(cell, tmp)
    turn.active = false
    if (daylightFraming() && lightAt(tmp) < DAY_MIN) {
      // turn the planet about its axis so the place comes round to DAY_OFFSET east of the sun's meridian (its latitude
      // is kept); the camera flies to where it will be
      const az = Math.atan2(tmp.x, tmp.z)
      const sunAz = Math.atan2(SUN_DIRECTION.x, SUN_DIRECTION.z)
      const d = wrapPi(sunAz + DAY_OFFSET - az)
      const r0 = deps.planetGroup.rotation.y
      const c = Math.cos(d), sn = Math.sin(d)
      tmp.set(tmp.x * c + tmp.z * sn, tmp.y, -tmp.x * sn + tmp.z * c)
      if (seconds <= 0) {
        deps.planetGroup.rotation.y = r0 + d
        deps.planetGroup.updateMatrixWorld(true)
      } else Object.assign(turn, { active: true, a: r0, b: r0 + d, t: 0, len: seconds })
    }
    deps.fly.flyTo(tmp, dist, seconds)
    deps.requestRender()
    deps.wake()
  }
  const stepTurn = (dt: number) => {
    if (!turn.active) return
    turn.t = Math.min(1, turn.t + dt / turn.len)
    deps.planetGroup.rotation.y = turn.a + (turn.b - turn.a) * ease3(turn.t)
    deps.planetGroup.updateMatrixWorld(true)
    if (turn.t >= 1) turn.active = false
    deps.requestRender()
    deps.wake()
  }
  /** On the near side and within half the view's half-angle of its centre. */
  const inView = (cell: number) => {
    if (!validCell(cell)) return true
    cellWorld(cell, tmp)
    const C = deps.camera.position
    if (tmp.dot(C) / (tmp.length() * C.length()) < 0.25) return false // the far side of the globe
    if (daylightFraming() && lightAt(tmp) < DAY_MIN) return false // in view but in the dark: fly (and turn it into the day)
    tmp2.copy(tmp).sub(C).normalize()
    const look = tmp.copy(C).negate().normalize()
    const half = THREE.MathUtils.degToRad(deps.camera.fov) / 2
    return Math.acos(Math.max(-1, Math.min(1, tmp2.dot(look)))) < 0.5 * half
  }
  const pulse = (cell: number) => {
    if (!validCell(cell)) return
    cellWorld(cell, tmp).project(deps.camera)
    const rect = deps.canvas.getBoundingClientRect()
    const host = deps.host.getBoundingClientRect()
    card.pulseAt(rect.left - host.left + ((tmp.x + 1) / 2) * rect.width, rect.top - host.top + ((1 - tmp.y) / 2) * rect.height)
  }

  // ---------- captions ----------
  const sceneOf = (c: Ctx, v: Voice, i: number, legend: boolean): Scene | null => {
    const t = history!.events[i].type as number
    try {
      if (t === EventType.Sacked) return sackScene(c, v, i)
      if (t === EventType.CityStricken) return plagueScene(c, v, i, legend)
      if (t === EventType.Landfall) return landfallScene(c, v, i)
      if (t === EventType.RulerConverted) return conversionScene(c, v, i)
      if (t === EventType.LandmarkCompleted) return workScene(c, v, i)
      if (t === EventType.BattleFought) return battleCaption(history!, history!.events[i].value) // n5: what decided it
    } catch (err) {
      console.warn('story: scene failed', err)
    }
    return null
  }
  /** n5: a battle's caption names what decided it ("The Battle of Vebena Ford: the defenders held the ford"). */
  const battleCaption = (h: History, b: number): Scene | null => {
    if (!h.battles || b < 0 || b >= h.battles.count) return null
    const why = decidingShort(h, b)
    return { kind: 'battle', year: h.battles.year[b], score: 0, title: battleTitle(h, b) + (why ? `: ${why}` : ''), text: describeBattle(h, b), place: h.battles.target[b] }
  }
  const subjectOf = (entry: number, target: number): SagaSubject | null => {
    const h = history
    if (!h || !drama) return null
    const p = drama.polA[entry]
    if (p >= 0 && p < (h.polities?.length ?? 0)) return { kind: 'state', id: p }
    if (target >= 0 && target < h.settlements.length) return { kind: 'city', id: target }
    return null
  }
  /**
   * n4b: Read more: the subject's saga where it tells this moment (its paragraphs naming the year, else its latest), and
   * the decade's chronicle when that is short; `lead` (the chronicle's line when the title is a scene's) first.
   */
  function moreOf(subject: SagaSubject | null, year: number, lead: string): CaptionMore | null {
    const h = history
    if (!h) return null
    const Y = Math.max(0, Math.min(h.years, Math.ceil(year)))
    const legend = deps.legend()
    const yr = new RegExp(`\\b${Math.floor(year)}\\b`)
    const out: string[] = lead ? [lead] : []
    const take = (s: SagaSubject, max: number) => {
      try {
        const saga = generateSaga(h, world, s, legend, Y)
        let ps = saga.paragraphs.filter((p) => yr.test(p))
        if (ps.length === 0) ps = saga.paragraphs.slice(-1)
        if (ps.length === 0 && saga.epigraph) ps = [saga.epigraph]
        for (const p of ps.slice(-max)) if (!out.includes(p)) out.push(p)
      } catch (err) {
        console.warn('story: read more failed', err)
      }
    }
    if (subject) take(subject, 2)
    if (out.join(' ').length < 240) take(decadeOf(Math.floor(year)), 1)
    const s = subject ?? decadeOf(Math.floor(year))
    return { paragraphs: out, open: () => deps.openSaga(s) }
  }
  /** The caption of entry `entry` told at `year`. */
  function captionOf(entry: number, year: number, cell: number, scale: number) {
    const h = history!
    const line = deps.chronicle.describe(entry, year)
    const rep = drama!.rep[entry]
    const legend = deps.legend()
    let scene: Scene | null = null
    if (rep >= 0) {
      const c = new Ctx(h, world, Math.min(h.years, Math.ceil(year)))
      const v = new Voice(world?.seed ?? 0, `story:${entry}`, legend, SCENE_T, OMEN_T)
      scene = sceneOf(c, v, rep, legend)
      // a town taken (a capital, a holy city, a realm's last) is told by its sack that year, when it was sacked
      const e = h.events[rep]
      const t = e.type as number
      if (!scene && index && (t === EventType.Conquered || t === EventType.HolyCityFell || t === EventType.PolityEnded) && e.settlement >= 0 && e.settlement < index.count) {
        for (let q = index.eventOffsets[e.settlement], end = index.eventOffsets[e.settlement + 1]; q < end && !scene; q++) {
          const i = index.eventList[q]
          const x = h.events[i]
          if (x.year === e.year && x.settlement === e.settlement && (x.type as number) === EventType.Sacked) scene = sceneOf(c, v, i, legend)
        }
      }
    }
    const yearText = line?.year ?? String(Math.floor(year))
    const subject = subjectOf(entry, line?.target ?? -1)
    // n4b: the place pinned on the globe (the line's town, else a town on the beat's cell) and its name then
    let pinId = line && line.target >= 0 && line.target < h.settlements.length ? line.target : -1
    if (pinId < 0 && cell >= 0) pinId = h.settlements.findIndex((st) => st.cell === cell && st.foundedYear <= year)
    const pinCell = pinId >= 0 ? h.settlements[pinId].cell : cell
    const pinLabel = pinId >= 0 ? townAt(h, pinId, Math.floor(year)) : '' // n4c: as the chronicle says it that year
    // battles: a beat told by a battle offers its replay
    const be = rep >= 0 ? h.events[rep] : null
    const battle = be && (be.type as number) === EventType.BattleFought && deps.openBattle && h.battles && be.value >= 0 && be.value < h.battles.count ? be.value : -1
    return {
      eyebrow: `${DRAMA_CAT_NAMES[drama!.cat[entry]] ?? 'Story'} · ${yearText}`,
      title: scene?.title ?? line?.text ?? '',
      body: scene ? scene.text : '',
      more: () => moreOf(subject, year, scene && line && scene.title !== line.text ? line.text : ''),
      pinCell,
      pinLabel,
      why: rep >= 0 && deps.openWhy ? () => deps.openWhy!(rep) : null, // causes:
      show: reducedMotion() && validCell(cell) ? () => flyTo(cell, [1.8, 2.3, 2.8][scale] ?? 2.3, 0) : null,
      battle: battle >= 0 ? () => replay(battle, false) : null,
      battleId: battle,
      share: () => shareMoment(year),
      year, // n4c: the caption's year (it is cleared once the view runs CAPTION_LAG_YEARS past it)
    }
  }

  // ---------- onboarding: share, the heartland, the top battles, the time left ----------
  /** A link to this moment: the address as it is (seed, orders, preset...), at `year`, following the story. */
  function shareMoment(year: number) {
    const url = new URL(window.location.href)
    url.searchParams.set('year', String(Math.max(0, Math.floor(year) - 5)))
    url.searchParams.set('follow', '1')
    url.searchParams.delete('intro')
    const text = url.toString()
    const nav = navigator as Navigator & { share?: (d: { url: string; title?: string }) => Promise<void> }
    if (typeof nav.share === 'function' && matchMedia('(pointer: coarse)').matches) {
      nav.share({ url: text, title: 'worldseed' }).catch(() => {})
      return
    }
    const done = () => card.flash('Link copied')
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt('A link to this moment', text))
    else window.prompt('A link to this moment', text)
  }
  /** The cell of the most populous place `ahead` years on from `year` (where the story will be): -1 none. */
  function heartCell(year: number, ahead = HEART_AHEAD): number {
    const h = history
    if (!h || h.settlements.length === 0) return -1
    const N = h.settlements.length
    const s = Math.max(0, Math.min(h.snapshotCount - 1, Math.round(Math.min(h.years, year + ahead) / h.snapshotInterval)))
    let best = -1, bestPop = 0
    for (let id = 0; id < N; id++) {
      const p = h.population[s * N + id]
      if (p > bestPop) {
        bestPop = p
        best = id
      }
    }
    if (best < 0) return -1
    // the first centuries: the hearth (an original tribe's place) of the people the most populous place belongs to
    if (year < HEART_HEARTH_YEARS) {
      const people = h.settlements[best].people
      for (let id = 0; id < N; id++) {
        const st = h.settlements[id]
        if (st.parent < 0 && st.people === people && !st.outpost) return st.cell
      }
    }
    return h.settlements[best].cell
  }
  let heartClock = HEART_EVERY
  /** Fly to the heartland unless it is already in view (lit); `force` ignores the interval. */
  function heartShot(year: number, force: boolean) {
    if (!force && heartClock < HEART_EVERY) return
    if (deps.cityEngaged()) return
    const cell = heartCell(year)
    if (cell < 0 || inView(cell)) return
    heartClock = 0
    flyTo(cell, HEART_DIST, reducedMotion() ? 0 : 2.2)
  }
  /** The run's top battles (battleWeight), in order of year; the ones already replayed this session. */
  let topBattles: number[] = []
  const replayed = new Set<number>()
  let replaying = false
  function replay(b: number, auto: boolean) {
    const h = history
    if (!h || !deps.openBattle || b < 0 || b >= (h.battles?.count ?? 0)) return
    replayed.add(b)
    if (auto) director.suspend()
    flyTo(h.battles.site[b], DIRECTOR.dist[0], reducedMotion() ? 0 : 1.2)
    replaying = true
    setContextBattle(b)
    deps.openBattle(b, {
      inline: auto,
      onDone: () => {
        replaying = false
        if (!captionBattle) setContextBattle(-1)
        if (auto && director.on) {
          director.resume()
          deps.play?.()
        }
      },
    })
  }
  // the battle being told (a replay, or a caption about a battle) as the right column's context panel
  let ctxBattle = -1
  const ctxRoot = document.createElement('section')
  ctxRoot.className = 'panel context-battle hidden'
  ctxRoot.setAttribute('aria-label', 'The battle')
  if (deps.contextHost) {
    deps.contextHost.insertBefore(ctxRoot, deps.contextHost.querySelector(':scope > .chronicle'))
    registerContext({ id: 'battle', priority: 6, root: ctxRoot, active: () => ctxBattle >= 0 })
  }
  function setContextBattle(b: number) {
    if (b === ctxBattle || !deps.contextHost) return
    ctxBattle = b
    const h = history
    ctxRoot.replaceChildren()
    if (b >= 0 && h && b < (h.battles?.count ?? 0)) {
      const eb = document.createElement('div')
      eb.className = 'cb-eyebrow'
      eb.textContent = `Battle · ${h.battles.year[b]}`
      const t = document.createElement('h3')
      t.className = 'cb-title'
      t.textContent = battleTitle(h, b)
      const p = document.createElement('p')
      p.className = 'cb-text'
      p.textContent = describeBattle(h, b)
      // n5: the battle at a glance (ground, weather, what decided it)
      const dl = document.createElement('div')
      dl.className = 'cb-summary'
      for (const [k, v] of battleSummary(h, b)) {
        const pair = document.createElement('span'), dt = document.createElement('b')
        pair.className = 'cb-pair'
        dt.textContent = k
        pair.append(dt, ' ' + v)
        dl.appendChild(pair)
      }
      ctxRoot.append(eb, t, dl, p)
      if (deps.openBattle) {
        const w = document.createElement('button')
        w.type = 'button'
        w.className = 'btn'
        w.textContent = 'Watch the battle'
        w.addEventListener('click', () => replay(b, false))
        ctxRoot.appendChild(w)
      }
    }
    ctxRoot.classList.toggle('hidden', ctxBattle < 0)
    contextChanged()
  }
  function battlesDue(prev: number, year: number) {
    if (!history || topBattles.length === 0 || replaying || deps.battleOpen?.()) return
    const Y = history.battles.year
    for (const b of topBattles) {
      if (replayed.has(b)) continue
      if (Y[b] > prev && Y[b] <= year + 1e-6) {
        replay(b, true)
        return
      }
    }
  }
  /** Real seconds of story from `year` to the run's end at this speed (beats' captions, quiet stretches fast-forwarded). */
  function secondsLeft(year: number): number {
    const p = plan, h = history
    if (!p || !h) return 0
    const speed = deps.timeline.speed
    const base = Math.max(1e-6, speed * DIRECTOR.yps1x)
    const k = Math.min(DIRECTOR.ffFactor, Math.max(1, DIRECTOR.ffMaxYps / base))
    const quiet = Math.max(DIRECTOR.ffYears * Math.max(1, speed), (DIRECTOR.leadSeconds + 3 * DIRECTOR.ffEase) * base * k)
    const gapTime = (g: number) => (k > 1.05 && g > quiet ? (g - 4.5 * base) / (k * base) + 4.5 : g / base)
    let t = 0
    let at = year
    for (let b = 0; b < p.beatYear.length; b++) {
      const y = p.beatYear[b]
      if (y < at || y > h.years || !beatKept(p, b, speed)) continue
      t += gapTime(y - at) + DIRECTOR.dwellSeconds + DIRECTOR.slowOut
      at = y + DIRECTOR.dwellSeconds * dwellSlowAt(speed) * base
    }
    if (h.years > at) t += gapTime(h.years - at)
    return t
  }
  let progressClock = 1
  /**
   * n4b: the estimate is the plan's story time at the chosen speed, scaled by how fast the story has really gone so far:
   * the real seconds of following against the story seconds the model says they took (a slow device, the director's
   * dwells, cards), summed over every stretch of playback since the history showed. Without that the estimate stayed at
   * the model's figure while the story ran several times slower (play-test #1: "~7 min" frozen for minutes).
   */
  const pace = { k: 1, real: 0, model: 0, t0: 0, model0: -1 }
  const PACE_MIN_S = 4
  function syncProgress(dt: number, year: number) {
    progressClock += dt
    if (progressClock < 1) return
    progressClock = 0
    if (!director.on || !history || year >= history.years - 1) {
      card.setProgress('')
      pace.model0 = -1
      return
    }
    const sec0 = secondsLeft(year)
    const now = performance.now()
    if (!deps.timeline.playing || director.state === DirectorState.Suspended || deps.timeline.intro) pace.model0 = -1
    else if (pace.model0 < 0) Object.assign(pace, { t0: now, model0: sec0 })
    else if (now - pace.t0 >= PACE_MIN_S * 1000) {
      const used = pace.model0 - sec0
      // (a jump or a speed change moves the model's figure by more than the time that passed: not a sample)
      if (used > 0 && used < 4 * (now - pace.t0) / 1000 + 30) {
        pace.real += (now - pace.t0) / 1000
        pace.model += used
        if (pace.model > 6) pace.k = Math.max(0.5, Math.min(8, pace.real / pace.model))
      }
      Object.assign(pace, { t0: now, model0: sec0 })
    }
    const sec = sec0 * pace.k
    const min = Math.max(1, Math.round(sec / 60))
    const ff = director.fastForward ? '⏩ ' : ''
    card.setProgress(`${ff}~${min} min`, `${director.fastForward ? 'Quiet years go by fast. ' : ''}About ${min} ${min === 1 ? 'minute' : 'minutes'} of story to year ${history.years} at this speed`)
  }

  // ---------- the director ----------
  let card: StoryCard
  const director = createDirector({
    timeline: deps.timeline,
    flyTo,
    inView,
    pulse,
    reducedMotion,
    cityEngaged: deps.cityEngaged,
    showCaption(b) {
      if (!plan) return
      const c = captionOf(plan.beatEntry[b], plan.beatYear[b], plan.beatCell[b], plan.beatScale[b])
      showCap(c, false)
      captionBattle = c.battleId >= 0
      if (captionBattle) setContextBattle(c.battleId)
    },
    hideCaption: () => {
      hideCap()
      if (captionBattle && !replaying) setContextBattle(-1)
      captionBattle = false
    },
    onState(s) {
      card.setPaused(s === DirectorState.Suspended)
      // n4b: a caption the director did not show (a drama-strip jump) goes once following goes on
      if (s !== DirectorState.Suspended && looseCaption) hideCap()
      syncButton()
    },
  })
  card = createStoryCard({
    host: deps.host,
    onToggle: () => setFollow(!director.on),
    // n4b: Resume follows again and plays on (a strip jump or a card paused the timeline)
    onResume: () => {
      director.resume()
      if (!deps.timeline.playing) deps.play?.()
    },
    onNext: () => (director.state === DirectorState.Dwell ? director.next() : hideCap()),
    onClose: () => (director.state === DirectorState.Dwell ? director.next() : hideCap()),
    // n4b: reading an expanded caption holds the story there (the timeline pauses, and plays on when the reading ends)
    onReading: (on) => {
      if (on && deps.timeline.playing) {
        heldByReading = true
        deps.timeline.pause()
      } else if (!on && heldByReading) {
        heldByReading = false
        deps.play?.()
      }
    },
  })
  let heldByReading = false
  // n4b: the caption shown, its place pinned on the globe while it shows; `loose`: not the director's (a strip jump)
  let pinCell = -1
  let pinLabel = ''
  let looseCaption = false
  /** n4c: the year of the caption shown (NaN none). */
  let capYear = NaN
  function showCap(c: ReturnType<typeof captionOf>, loose: boolean) {
    card.showCaption(c)
    capYear = c.year
    deps.quiet?.(loose) // n4c: a jump's caption: the moving layers step back while it shows
    pinCell = c.pinCell
    pinLabel = c.pinLabel
    looseCaption = loose
    syncPin()
  }
  function hideCap() {
    capYear = NaN
    deps.quiet?.(false)
    card.hideCaption()
    pinCell = -1
    looseCaption = false
    card.hidePin()
  }
  function syncPin() {
    if (pinCell < 0 || !validCell(pinCell) || flat.t > 0.01) {
      card.hidePin()
      return
    }
    cellWorld(pinCell, tmp)
    const C = deps.camera.position
    if (tmp.dot(C) / (tmp.length() * C.length()) < 0.2) {
      card.hidePin()
      return
    }
    tmp.project(deps.camera)
    const rect = deps.canvas.getBoundingClientRect()
    const host = deps.host.getBoundingClientRect()
    const x = rect.left - host.left + ((tmp.x + 1) / 2) * rect.width
    const y = rect.top - host.top + ((1 - tmp.y) / 2) * rect.height
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) card.hidePin()
    else card.pinAt(x, y, pinLabel)
  }
  /** n4b: a drama-strip jump: the strongest story at the peak is captioned and framed (following lets go). */
  function jumpTo(y: number) {
    director.suspend()
    deps.timeline.pause()
    const h = history
    let best = -1
    if (h && drama && index) {
      const NY = index.notableYear
      // the peak's year is the strip's smoothed maximum: look a few years either side of it
      const lo = y - 4, hi = y + 10
      let a = 0, b = NY.length
      while (a < b) { const m = (a + b) >> 1; if (NY[m] < lo) a = m + 1; else b = m }
      // (a story with a place first: the jump is framed there)
      let bs = 0
      for (let k = a; k < NY.length && NY[k] <= hi; k++) {
        const sc = drama.score[k] * (drama.cell[k] >= 0 ? 4 : 1)
        if (sc > bs) { bs = sc; best = k }
      }
    }
    if (best < 0 || !h || !drama || !index) {
      deps.timeline.setYear(Math.min(y, deps.timeline.years))
    } else {
      const ey = index.notableYear[best]
      deps.timeline.setYear(Math.min(Math.ceil(ey), deps.timeline.years))
      const cell = drama.cell[best], scale = drama.scale[best]
      if (cell >= 0) flyTo(cell, Math.min(DIRECTOR.dist[scale] ?? 2.3, 2.3), reducedMotion() ? 0 : 1.2)
      showCap(captionOf(best, Math.ceil(ey), cell, scale), true)
    }
    deps.requestRender()
    deps.wake()
  }
  deps.timeline.addControl(card.button)
  deps.timeline.addControl(card.progress)
  // ui-additions 3: the drama strip over the slider; a click jumps to the peak there (following lets go)
  // (a beat's peak: its caption shows there, as the director would show it (n1, play-test 1); any other peak: the strongest
  // story near it, framed and captioned (n4b jumpTo))
  const strip = createDramaStrip((y, b) => {
    if (b >= 0 && plan && b < plan.beatEntry.length) {
      director.suspend()
      deps.timeline.pause()
      deps.timeline.setYear(Math.min(y, deps.timeline.years))
      const cell = plan.beatCell[b], scale = plan.beatScale[b]
      showCap(captionOf(plan.beatEntry[b], plan.beatYear[b], cell, scale), true)
      if (cell >= 0) flyTo(cell, DIRECTOR.dist[scale] ?? DIRECTOR.dist[1], reducedMotion() ? 0 : 1.2)
      deps.requestRender()
      deps.wake()
      return
    }
    jumpTo(y)
  })
  deps.timeline.addAboveSlider(strip.root)
  director.setPacing(true)
  const syncButton = () => card.setButton(director.on, !!plan)
  syncButton()

  let notesOn = loadFlag('worldseed.story.notices', false)
  deps.addLayerToggle?.({ key: 'storyNotices', label: 'Story notices', group: 'people', checked: notesOn, title: 'Short notices of the great events as they happen (always on while following the story, H)', onChange: (on) => { notesOn = on; saveFlag('worldseed.story.notices', on); if (!on && !director.on) card.clearNotices() } })

  function setFollow(on: boolean) {
    if (on && !plan) return
    // (the first playback to the end of the initial history is the timeline's intro, at its own faster rate: following
    // ends it, and playback goes on at the chosen speed)
    if (on && deps.timeline.intro) deps.timeline.setSoftStop(null)
    director.setOn(on)
    deps.timeline.setBeats(on && plan ? plan.beatYear : null, on && plan ? plan.beatProminence : null, Math.min(STORY.gMin, STORY.promPerSpeed))
    deps.setUrlParam('follow', on ? '1' : null)
    if (on && !deps.timeline.playing) deps.timeline.play()
    // the opening shot: where the people are (unless a beat is about to be flown to)
    if (on && plan) {
      const b = director.state === DirectorState.Idle ? nextBeatAfter(deps.timeline.year) : -1
      if (b < 0 || plan.beatYear[b] - deps.timeline.year > 3 * DIRECTOR.leadSeconds * deps.timeline.speed * DIRECTOR.yps1x) heartShot(deps.timeline.year, true)
    }
    if (!on) card.setProgress('')
    if (!on && !notesOn) card.clearNotices()
    syncButton()
    deps.requestRender()
    deps.wake()
  }
  addShortcut({ keys: ['h', 'H'], label: 'H', description: 'Follow the story (the camera goes to the great events)', group: 'View', run: () => {
    if (!plan) return false
    setFollow(!director.on)
  } })
  let pendingOn = deps.initialOn
  const nextBeatAfter = (year: number) => {
    if (!plan) return -1
    for (let b = 0; b < plan.beatYear.length; b++) if (plan.beatYear[b] >= year && beatKept(plan, b, deps.timeline.speed)) return b
    return -1
  }

  // user input on the globe suspends following
  const onInput = () => {
    turn.active = false
    director.suspend()
  }
  deps.canvas.addEventListener('pointerdown', onInput)
  deps.canvas.addEventListener('wheel', onInput, { passive: true })

  // ---------- notices ----------
  let noteCursor = 0
  let noteClock = NOTICE_EVERY
  let lastYear = 0
  /** Visible notices by id (the note's index in the plan), for expiry. */
  const shownNotes = new Set<number>()
  const resetNotes = (year: number) => {
    card.clearNotices()
    shownNotes.clear()
    noteCursor = 0
    if (plan) while (noteCursor < plan.noteYear.length && plan.noteYear[noteCursor] <= year) noteCursor++
  }
  function notices(dt: number, year: number) {
    if (!plan || !drama) return
    noteClock += dt
    if (year < lastYear - 1e-6 || year - lastYear > 50) resetNotes(year)
    lastYear = year
    // expired: their year is long behind (or ahead, after scrubbing back)
    if (shownNotes.size > 0) {
      const p = plan
      card.pruneNotices((id) => {
        const keep = year - p.noteYear[id] <= NOTICE_EXPIRE_YEARS && p.noteYear[id] <= year + 1
        if (!keep) shownNotes.delete(id)
        return keep
      })
    }
    if (!deps.timeline.playing) return
    // the due ones; at most one new per NOTICE_EVERY seconds (the rest wait, and expire if they wait too long)
    while (noteCursor < plan.noteYear.length && plan.noteYear[noteCursor] <= year) {
      if (year - plan.noteYear[noteCursor] > NOTICE_EXPIRE_YEARS) {
        noteCursor++
        continue
      }
      if (noteClock < NOTICE_EVERY) break
      const k = noteCursor++
      const entry = plan.noteEntry[k]
      const line = deps.chronicle.describe(entry, year)
      if (!line || !line.text) continue
      noteClock = 0
      shownNotes.add(k)
      const cell = drama.cell[entry]
      const scale = drama.scale[entry]
      const noteYear = plan.noteYear[k]
      const text = line.text.length > NOTICE_TEXT_MAX ? `${line.text.slice(0, NOTICE_TEXT_MAX - 1).replace(/\s+\S*$/, '')}…` : line.text
      card.addNotice({
        id: k,
        icon: CAT_ICON[drama.cat[entry]] ?? '•',
        text,
        key: drama.key[entry],
        go() {
          director.suspend()
          if (Math.abs(deps.timeline.year - noteYear) > 5) deps.timeline.setYear(noteYear)
          flyTo(cell, [1.8, 2.3, 2.8][scale] ?? 2.3, reducedMotion() ? 0 : 0.9)
        },
      })
      break
    }
  }

  // ---------- plan ----------
  function rebuildPlan() {
    if (!index || !drama || !history) {
      plan = null
    } else {
      // lane N3: story arcs keep their chapters together (arcs.ts; plan.ts continuity and the payoff guarantee)
      plan = buildStoryPlan(drama, index.notableYear, { focus, until: history.years, arcs: arcEntries(findArcs(history), drama.rep) })
    }
    director.setPlan(plan)
    strip.setData(drama, index ? index.notableYear : null, plan ? plan.beatYear : null, plan ? plan.beatScore : null, plan ? plan.beatEntry : null)
    if (director.on) deps.timeline.setBeats(plan ? plan.beatYear : null, plan ? plan.beatProminence : null, Math.min(STORY.gMin, STORY.promPerSpeed))
    resetNotes(deps.timeline.year)
    syncButton()
  }

  let tickYear = 0
  let captionBattle = false
  /** n4b: Show me on a decision card: resume following once this says the card has closed. */
  let peekOpen: (() => boolean) | null = null
  const api: StoryView = {
    director,
    commit(h, w, ix, extend) {
      history = h
      world = w
      index = ix
      drama = h && ix ? buildStaticDrama(ix, createDramaCtx(h)) : null
      const bd = h ? battlesOf(h) : null
      topBattles = bd && deps.openBattle ? Array.from({ length: h!.battles.count }, (_, b) => b).filter((b) => bd.siegeOf[b] < 0 || bd.sieges[bd.siegeOf[b]].rows[bd.sieges[bd.siegeOf[b]].rows.length - 1] === b).sort((a, b) => battleWeight(bd.B, b) - battleWeight(bd.B, a) || a - b).slice(0, TOP_BATTLES) : []
      if (!extend) {
        replayed.clear()
        hideCap()
        card.clearNotices()
      }
      rebuildPlan()
      if (!h && director.on) setFollow(false)
    },
    setFocus(polities) {
      const next = new Set(polities.filter((p) => p >= 0))
      const key = [...next].sort((a, b) => a - b).join(',')
      if (key === focusKey) return
      focusKey = key
      focus = next
      if (drama) rebuildPlan()
    },
    resumeAfter(stillOpen) {
      peekOpen = director.on ? stillOpen : null
    },
    userMoved: () => {
      turn.active = false
      director.suspend()
    },
    setFollowOnShow(on) {
      pendingOn = on
    },
    tick(dt, year) {
      if (pendingOn && plan) {
        pendingOn = false
        setFollow(true)
      }
      stepTurn(dt)
      strip.setRange(deps.timeline.years)
      const wasFf = director.fastForward
      const prevYear = tickYear
      tickYear = year
      director.tick(dt)
      if (director.on) {
        heartClock += dt
        // a quiet stretch begins: back to where the people are
        if (director.fastForward && !wasFf) heartShot(year, false)
        if (deps.timeline.playing && director.state !== DirectorState.Suspended && year > prevYear && year - prevYear < 50) battlesDue(prevYear, year)
      }
      syncProgress(dt, year)
      if (pinCell >= 0) syncPin()
      // n4c (play-test 2: "WAR · 1890" still up at 1900): a caption the view has run well past goes (the director's, as Next)
      if (Number.isFinite(capYear) && Math.abs(year - capYear) > CAPTION_LAG_YEARS) {
        if (director.state === DirectorState.Dwell) director.next()
        else hideCap()
      }
      if (peekOpen && !peekOpen()) {
        peekOpen = null
        if (director.state === DirectorState.Suspended) director.resume()
      }
      if (director.on || notesOn) notices(dt, year)
      if (card.button.disabled !== !plan) syncButton()
    },
    debug: () => ({ plan, drama }),
  }
  if (new URLSearchParams(location.search).get('perf') === '1') {
    // measurement and checks (perf=1): the director's state, the beat it is on, flights made, the plan's size
    ;(window as unknown as { __worldseedStory: unknown }).__worldseedStory = {
      state: () => director.state,
      beat: () => (director.beat >= 0 && plan ? { index: director.beat, year: plan.beatYear[director.beat], entry: plan.beatEntry[director.beat], cell: plan.beatCell[director.beat] } : null),
      flights: () => flights,
      beats: () => (plan ? Array.from(plan.beatYear) : []),
      notes: () => plan?.noteYear.length ?? 0,
      follow: (on: boolean) => setFollow(on),
      secondsLeft: () => ({ model: secondsLeft(deps.timeline.year), pace: pace.k }), // n4b
    }
  }
  return api
}
