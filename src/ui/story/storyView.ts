// The story director in the app (experience-whatif-director-sagas §2.4–2.5): built by the history view, it scores the
// history's chronicle entries (drama.ts), plans the beats (plan.ts), runs "Follow the story" (director.ts) and the
// notices, and words captions from the existing saga scenes or the chronicle's own lines (one wording source).
// Off by default: Follow is the H key, the timeline's Follow button (a touch target on phones) or follow=1 in the
// address; notices come with Follow, or on their own from the View menu's "Story notices" toggle.

import * as THREE from 'three'
import { EventType, type History, type World } from '../../contract.ts'
import { surfaceRadius } from '../../render/globe.ts'
import type { CameraFly } from '../../render/cameraFly.ts'
import type { Chronicle } from '../chronicle.ts'
import type { HistoryIndex } from '../historyIndex.ts'
import type { LayerToggle } from '../overlay.ts'
import type { Timeline } from '../timeline.ts'
import type { SagaSubject } from '../sagas/index.ts'
import { Ctx } from '../sagas/facts.ts'
import { conversionScene, landfallScene, plagueScene, sackScene, SCENE_T, workScene, type Scene } from '../sagas/scenes.ts'
import { Voice } from '../sagas/voice.ts'
import { OMEN_T } from '../sagas/omens.ts'
import { addShortcut } from '../shortcuts.ts'
import { loadFlag, saveFlag } from '../panels.ts'
import { buildStaticDrama, createDramaCtx, DRAMA_CAT_NAMES, type StaticDrama } from './drama.ts'
import { buildStoryPlan, STORY, type StoryPlan } from './plan.ts'
import { createDirector, DirectorState, type Director } from './director.ts'
import { createStoryCard, type StoryCard } from './storyCard.ts'

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
  /** follow=1 in the address. */
  initialOn: boolean
}

export interface StoryView {
  /** The history shown changed (or grew, `extend`). */
  commit(h: History | null, w: World | null, ix: HistoryIndex | null, extend: boolean): void
  /** Polities whose stories get the focus factor (the selection); rebuilds the plan when it changes. */
  setFocus(polities: readonly number[]): void
  /** A camera move the director did not make (a panel's fly-to, a pick): suspend following. */
  userMoved(): void
  tick(dt: number, year: number): void
  readonly director: Director
  /** The current plan and static scores (tests, perf=1 tools). */
  debug(): { plan: StoryPlan | null; drama: StaticDrama | null }
}

/** One symbol per category for the notices. */
const CAT_ICON: readonly string[] = ['⚔', '♛', '♜', '✦', '☠', '⚓', '⌂', '✎', '⚖', '☁', '⚑', '☞']
/** Notices: at most one new per this many real seconds; one expires when its year is this far behind. */
const NOTICE_EVERY = 2
const NOTICE_EXPIRE_YEARS = 30
const NOTICE_TEXT_MAX = 110

const tmp = new THREE.Vector3()
const tmp2 = new THREE.Vector3()

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
  const flyTo = (cell: number, dist: number, seconds: number) => {
    if (!validCell(cell)) return
    flights++
    deps.stopSpin()
    cellWorld(cell, tmp)
    deps.fly.flyTo(tmp, dist, seconds)
    deps.requestRender()
    deps.wake()
  }
  /** On the near side and within half the view's half-angle of its centre. */
  const inView = (cell: number) => {
    if (!validCell(cell)) return true
    cellWorld(cell, tmp)
    const C = deps.camera.position
    if (tmp.dot(C) / (tmp.length() * C.length()) < 0.25) return false // the far side of the globe
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
    } catch (err) {
      console.warn('story: scene failed', err)
    }
    return null
  }
  const subjectOf = (entry: number, target: number): SagaSubject | null => {
    const h = history
    if (!h || !drama) return null
    const p = drama.polA[entry]
    if (p >= 0 && p < (h.polities?.length ?? 0)) return { kind: 'state', id: p }
    if (target >= 0 && target < h.settlements.length) return { kind: 'city', id: target }
    return null
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
    return {
      eyebrow: `${DRAMA_CAT_NAMES[drama!.cat[entry]] ?? 'Story'} · ${yearText}`,
      title: scene?.title ?? line?.text ?? '',
      body: scene ? scene.text : '',
      more: subject ? () => deps.openSaga(subject) : null,
      why: rep >= 0 && deps.openWhy ? () => deps.openWhy!(rep) : null, // causes:
      show: reducedMotion() && validCell(cell) ? () => flyTo(cell, [1.8, 2.3, 2.8][scale] ?? 2.3, 0) : null,
    }
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
      card.showCaption(captionOf(plan.beatEntry[b], plan.beatYear[b], plan.beatCell[b], plan.beatScale[b]))
    },
    hideCaption: () => card.hideCaption(),
    onState(s) {
      card.setPaused(s === DirectorState.Suspended)
      syncButton()
    },
  })
  card = createStoryCard({
    host: deps.host,
    onToggle: () => setFollow(!director.on),
    onResume: () => director.resume(),
    onNext: () => director.next(),
    onClose: () => (director.state === DirectorState.Dwell ? director.next() : card.hideCaption()),
  })
  deps.timeline.addControl(card.button)
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

  // user input on the globe suspends following
  const onInput = () => director.suspend()
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
      plan = buildStoryPlan(drama, index.notableYear, { focus, until: history.years })
    }
    director.setPlan(plan)
    if (director.on) deps.timeline.setBeats(plan ? plan.beatYear : null, plan ? plan.beatProminence : null, Math.min(STORY.gMin, STORY.promPerSpeed))
    resetNotes(deps.timeline.year)
    syncButton()
  }

  const api: StoryView = {
    director,
    commit(h, w, ix, extend) {
      history = h
      world = w
      index = ix
      drama = h && ix ? buildStaticDrama(ix, createDramaCtx(h)) : null
      if (!extend) {
        card.hideCaption()
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
    userMoved: () => director.suspend(),
    tick(dt, year) {
      if (pendingOn && plan) {
        pendingOn = false
        setFollow(true)
      }
      director.tick(dt)
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
    }
  }
  return api
}
