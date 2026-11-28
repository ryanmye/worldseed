// The story director's DOM (experience-whatif-director-sagas §2.5): the caption card of a beat, the notices queue, the
// "Following paused" chip and the timeline's Follow button. Placement follows the free rect (overlay.ts): desktop, the
// card sits lower left above the timeline (max 360 px wide) with up to 3 notices; phone (compact.ts), a two-line strip
// directly above the timeline that a tap expands to the full text, and 1 notice. Notices live in an aria-live="polite"
// region; the card is focusable and Esc closes it.

import './story.css'
import { isCompact } from '../compact.ts'
import { getFreeViewportInset, onFreeViewportChange } from '../overlay.ts'

export interface Caption {
  /** "War · 1590" */
  eyebrow: string
  title: string
  /** The scene's text, or the chronicle line when the title is a scene's; '' for none. */
  body: string
  /** n4b: "Read more" expands the caption itself with more text (the subject's saga where it tells this moment); null: no button. */
  more: (() => CaptionMore | null) | null
  /** causes: "Why?": opens the Why panel on the beat's event (null or absent: no button). */
  why?: (() => void) | null
  /** Reduced motion: "Show" cuts the camera to the place (null: no button). */
  show: (() => void) | null
  /** onboarding: "Share" gives a link to this moment (null or absent: no button). */
  share?: (() => void) | null
  /** battles: "Watch the battle" opens the 2D replay of the beat's battle (null or absent: no button). */
  battle?: (() => void) | null
}

/** n4b: what "Read more" adds to the caption: a few paragraphs, and optionally a link to the whole saga. */
export interface CaptionMore {
  paragraphs: string[]
  /** "The whole saga" (opens the Sagas panel on the subject); absent: no link. */
  open?: () => void
}

/** Sentences of a text ("A. B? C!" -> ["A.", "B?", "C!"]), split at a stop followed by a space and a capital or a quote. */
function sentences(t: string): string[] {
  return t.split(/(?<=[.!?…])\s+(?=[A-Z“"'‘(])/).map((x) => x.trim()).filter(Boolean)
}
const norm = (t: string) => t.toLowerCase().replace(/[“”"'‘’…]/g, '').replace(/\s+/g, ' ').replace(/[.!?:;,]+$/, '').trim()

/**
 * n4c: Read more's paragraphs without what the caption shows (`shown`: its title and body): a paragraph the caption holds
 * whole is dropped, and the caption's sentences are taken out of the rest; a paragraph left empty is dropped.
 */
export function withoutShown(paragraphs: readonly string[], shown: readonly string[]): string[] {
  const said = new Set<string>()
  const whole = shown.map(norm).filter(Boolean)
  for (const s of shown) for (const x of sentences(s)) said.add(norm(x))
  const out: string[] = []
  for (const p of paragraphs) {
    const n = norm(p)
    if (!n || whole.some((w) => w === n || w.includes(n))) continue
    const left = sentences(p).filter((x) => !said.has(norm(x)))
    const t = left.join(' ').trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

export interface Notice {
  id: number
  icon: string
  text: string
  /** Grouping key: notices with the same key coalesce. */
  key: number
  go(): void
}

export interface StoryCard {
  showCaption(c: Caption): void
  hideCaption(): void
  /** The "Following paused — Resume" chip. */
  setPaused(paused: boolean): void
  /** Add a notice (coalesced with a visible one of the same key: "+n more"). */
  addNotice(n: Notice): void
  /** Drop the notices whose ids `keep` rejects. */
  pruneNotices(keep: (id: number) => boolean): void
  clearNotices(): void
  /** The Follow button (for the timeline row). */
  readonly button: HTMLButtonElement
  setButton(on: boolean, available: boolean): void
  /** onboarding: the story's progress beside the Follow button ("~6 min left", "quiet years ⏩"); '' hides it. */
  readonly progress: HTMLElement
  setProgress(text: string, title?: string): void
  /** onboarding: a short confirmation on the card ("Link copied"). */
  flash(text: string): void
  /** A ring at a screen point (CSS px in the host), for a beat that needs no flight. */
  pulseAt(x: number, y: number): void
  /** n4b: the caption's place on the globe: a pin with its name at a screen point (CSS px in the host); null hides it. */
  pinAt(x: number, y: number, label: string): void
  hidePin(): void
  /** n4b: whether the caption is expanded by Read more (the reader holds the story there). */
  readonly reading: boolean
}

export interface StoryCardDeps {
  host: HTMLElement
  onToggle(): void
  onResume(): void
  onNext(): void
  onClose(): void
  /** n4b: Read more expanded (true) or folded (false) the caption. */
  onReading?(on: boolean): void
}

const MAX_BODY = 220
/** ui-additions 4: a swipe this long (CSS px) sideways goes to the next story or puts the card away. */
const SWIPE_PX = 56
const EYE = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.1" fill="currentColor"/></svg>'

export function createStoryCard(deps: StoryCardDeps): StoryCard {
  const root = document.createElement('div')
  root.className = 'story-root'
  deps.host.appendChild(root)

  // ---- notices (aria-live) ----
  const toasts = document.createElement('div')
  toasts.className = 'story-toasts'
  toasts.setAttribute('aria-live', 'polite')
  toasts.setAttribute('aria-label', 'Story notices')

  // ---- the paused chip ----
  const chip = document.createElement('div')
  chip.className = 'story-chip hidden'
  chip.setAttribute('role', 'status')
  const chipText = document.createElement('span')
  chipText.textContent = 'Following paused'
  const resume = document.createElement('button')
  resume.type = 'button'
  resume.className = 'btn story-resume'
  resume.textContent = 'Resume'
  resume.addEventListener('click', () => deps.onResume())
  chip.append(chipText, resume)

  // ---- the caption card ----
  const card = document.createElement('section')
  card.className = 'story-card hidden'
  card.tabIndex = -1
  card.setAttribute('aria-label', 'Story')
  const eyebrow = document.createElement('div')
  eyebrow.className = 'story-eyebrow'
  const title = document.createElement('h3')
  title.className = 'story-title'
  const body = document.createElement('p')
  body.className = 'story-body'
  const moreText = document.createElement('button')
  moreText.type = 'button'
  moreText.className = 'story-expand'
  moreText.textContent = 'more'
  // n4b: Read more's text, inside the card
  const moreBox = document.createElement('div')
  moreBox.className = 'story-more hidden'
  const row = document.createElement('div')
  row.className = 'story-actions'
  const showBtn = document.createElement('button')
  showBtn.type = 'button'
  showBtn.className = 'btn story-show'
  showBtn.textContent = 'Show'
  const readBtn = document.createElement('button')
  readBtn.type = 'button'
  readBtn.className = 'btn story-read'
  readBtn.textContent = 'Read more'
  const whyBtn = document.createElement('button') // causes:
  whyBtn.type = 'button'
  whyBtn.className = 'btn story-why'
  whyBtn.textContent = 'Why?'
  const nextBtn = document.createElement('button')
  nextBtn.type = 'button'
  nextBtn.className = 'btn story-next'
  nextBtn.textContent = 'Next'
  nextBtn.title = 'On to the next story'
  const battleBtn = document.createElement('button') // battles: the replay
  battleBtn.type = 'button'
  battleBtn.className = 'btn story-battle'
  battleBtn.textContent = 'Watch the battle'
  const shareBtn = document.createElement('button') // onboarding: share this moment
  shareBtn.type = 'button'
  shareBtn.className = 'btn story-share'
  shareBtn.textContent = 'Share'
  shareBtn.title = 'A link to this moment: the same world, this year, following the story'
  const closeBtn = document.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'story-close'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.textContent = '×'
  row.append(showBtn, battleBtn, readBtn, whyBtn, shareBtn, nextBtn)
  card.append(closeBtn, eyebrow, title, body, moreText, moreBox, row)
  root.append(toasts, chip, card)
  // n4b: the paused chip sits above a caption shown with it (they share the lower left corner)
  const placeChip = () => {
    const up = !card.classList.contains('hidden') && !chip.classList.contains('hidden')
    chip.style.bottom = up ? `calc(var(--story-bottom) + ${card.offsetHeight + 8}px)` : ''
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(placeChip).observe(card)

  let full = ''
  let caption: Caption | null = null
  let reading = false
  const setReading = (on: boolean) => {
    if (on === reading) return
    reading = on
    readBtn.textContent = on ? 'Less' : 'Read more'
    readBtn.setAttribute('aria-expanded', String(on))
    moreBox.classList.toggle('hidden', !on)
    card.classList.toggle('reading', on)
    deps.onReading?.(on)
  }
  const openMore = () => {
    if (reading) { setReading(false); return }
    const m = caption?.more?.()
    moreBox.replaceChildren()
    setBody(true)
    // n4c (play-test 2: the expansion repeated the caption's paragraph verbatim): what the caption already says is left out
    for (const t of withoutShown(m?.paragraphs ?? [], [title.textContent ?? '', full])) {
      const p = document.createElement('p')
      p.textContent = t
      moreBox.appendChild(p)
    }
    if (moreBox.childElementCount === 0) moreBox.appendChild(Object.assign(document.createElement('p'), { className: 'story-more-none', textContent: 'The record says no more of it yet.' }))
    if (m?.open) {
      const a = document.createElement('button')
      a.type = 'button'
      a.className = 'story-more-link'
      a.textContent = 'The whole saga ›'
      a.addEventListener('click', () => m.open?.())
      moreBox.appendChild(a)
    }
    setReading(true)
    moreBox.scrollTop = 0
  }
  const setBody = (expanded: boolean) => {
    const long = full.length > MAX_BODY
    body.textContent = long && !expanded ? `${full.slice(0, full.lastIndexOf(' ', MAX_BODY - 1) > 0 ? full.lastIndexOf(' ', MAX_BODY - 1) : MAX_BODY)}…` : full
    moreText.hidden = !long || expanded
  }
  moreText.addEventListener('click', (e) => {
    e.stopPropagation()
    setBody(true)
    card.classList.add('expanded')
  })
  // phone: the strip expands on a tap
  card.addEventListener('click', (e) => {
    if (!isCompact() || (e.target as HTMLElement).closest('button')) return
    const on = !card.classList.contains('expanded')
    card.classList.toggle('expanded', on)
    setBody(on)
  })
  // ui-additions 4 (phone): a sideways swipe on the card, left for the next story, right to put it away
  let swipe: { id: number; x: number; y: number } | null = null
  card.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || (e.target as HTMLElement).closest('button')) return
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY }
  })
  card.addEventListener('pointermove', (e) => {
    if (!swipe || e.pointerId !== swipe.id) return
    const dx = e.clientX - swipe.x
    if (Math.abs(dx) > Math.abs(e.clientY - swipe.y)) card.style.transform = `translateX(${dx * 0.6}px)`
  })
  const endSwipe = (e: PointerEvent) => {
    if (!swipe || e.pointerId !== swipe.id) return
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y
    swipe = null
    card.style.transform = ''
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < 1.5 * Math.abs(dy)) return
    if (dx < 0) deps.onNext()
    else deps.onClose()
  }
  card.addEventListener('pointerup', endSwipe)
  card.addEventListener('pointercancel', endSwipe)
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      deps.onClose()
    }
  })
  showBtn.addEventListener('click', () => caption?.show?.())
  readBtn.addEventListener('click', () => openMore())
  whyBtn.addEventListener('click', () => caption?.why?.())
  battleBtn.addEventListener('click', () => caption?.battle?.())
  shareBtn.addEventListener('click', () => caption?.share?.())
  nextBtn.addEventListener('click', () => deps.onNext())
  closeBtn.addEventListener('click', () => deps.onClose())

  // ---- the timeline's Follow button ----
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'btn tl-follow'
  button.innerHTML = `${EYE}<span class="tl-follow-label">Follow</span>`
  button.title = 'Follow the story: the camera goes to the great events as they happen (H)'
  button.setAttribute('aria-label', 'Follow the story')
  button.setAttribute('aria-pressed', 'false')
  button.addEventListener('click', () => deps.onToggle())
  const progress = document.createElement('span')
  progress.className = 'tl-story-progress hidden'
  progress.setAttribute('aria-live', 'off')

  // ---- placement in the free rect ----
  const place = () => {
    const inset = getFreeViewportInset()
    root.style.setProperty('--story-left', `${Math.round(inset.left + (isCompact() ? 8 : 14))}px`)
    root.style.setProperty('--story-right', `${Math.round(inset.right + (isCompact() ? 8 : 14))}px`)
    root.style.setProperty('--story-bottom', `${Math.round(inset.bottom + (isCompact() ? 6 : 14))}px`)
    root.classList.toggle('compact', isCompact())
  }
  place()
  onFreeViewportChange(place)
  window.addEventListener('resize', place)

  // n4b: the caption's place, pinned on the globe with its name
  const pin = document.createElement('div')
  pin.className = 'story-pin hidden'
  pin.setAttribute('aria-hidden', 'true')
  const pinLabel = document.createElement('span')
  pinLabel.className = 'story-pin-label'
  pin.append(Object.assign(document.createElement('span'), { className: 'story-pin-ring' }), pinLabel)
  root.insertBefore(pin, root.firstChild)

  const visible = new Map<number, { el: HTMLElement; key: number; extra: number; text: HTMLElement; base: string }>()
  const maxToasts = () => (isCompact() ? 1 : 3)

  return {
    button,
    showCaption(c) {
      caption = c
      place()
      eyebrow.textContent = c.eyebrow
      title.textContent = c.title
      full = c.body
      card.classList.remove('expanded')
      setReading(false)
      setBody(false)
      body.hidden = c.body === ''
      showBtn.hidden = !c.show
      readBtn.hidden = !c.more
      whyBtn.hidden = !c.why
      battleBtn.hidden = !c.battle
      shareBtn.hidden = !c.share
      shareBtn.textContent = 'Share'
      card.classList.remove('hidden')
      // (re-run the entrance animation)
      card.classList.remove('enter')
      void card.offsetWidth
      card.classList.add('enter')
      placeChip()
    },
    hideCaption() {
      caption = null
      setReading(false)
      pin.classList.add('hidden')
      if (card.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
      card.classList.add('hidden')
      placeChip()
    },
    setPaused(paused) {
      chip.classList.toggle('hidden', !paused)
      placeChip()
    },
    addNotice(n) {
      for (const v of visible.values()) {
        if (v.key !== n.key) continue
        v.extra++
        v.text.textContent = `${v.base} · +${v.extra} more`
        return
      }
      place()
      const el = document.createElement('div')
      el.className = 'story-toast'
      const icon = document.createElement('span')
      icon.className = 'story-toast-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.textContent = n.icon
      const text = document.createElement('span')
      text.className = 'story-toast-text'
      text.textContent = n.text
      const go = document.createElement('button')
      go.type = 'button'
      go.className = 'btn story-go'
      go.textContent = 'Go'
      go.setAttribute('aria-label', `Go there: ${n.text}`)
      go.addEventListener('click', () => n.go())
      el.append(icon, text, go)
      toasts.appendChild(el)
      visible.set(n.id, { el, key: n.key, extra: 0, text, base: n.text })
      while (visible.size > maxToasts()) {
        const [id, v] = visible.entries().next().value!
        v.el.remove()
        visible.delete(id)
      }
    },
    pruneNotices(keep) {
      for (const [id, v] of visible) {
        if (keep(id)) continue
        v.el.remove()
        visible.delete(id)
      }
    },
    clearNotices() {
      for (const v of visible.values()) v.el.remove()
      visible.clear()
    },
    progress,
    setProgress(text, tip) {
      if (progress.textContent !== text) progress.textContent = text
      progress.classList.toggle('hidden', text === '')
      progress.title = tip ?? ''
    },
    flash(text) {
      shareBtn.textContent = text
      window.setTimeout(() => (shareBtn.textContent = 'Share'), 2200)
    },
    setButton(on, available) {
      button.classList.toggle('on', on)
      button.setAttribute('aria-pressed', String(on))
      button.disabled = !available
    },
    get reading() {
      return reading
    },
    pinAt(x, y, label) {
      pin.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      if (pinLabel.textContent !== label) pinLabel.textContent = label
      pinLabel.hidden = label === ''
      pin.classList.remove('hidden')
    },
    hidePin() {
      pin.classList.add('hidden')
    },
    pulseAt(x, y) {
      const ring = document.createElement('div')
      ring.className = 'story-pulse'
      ring.style.left = `${x}px`
      ring.style.top = `${y}px`
      root.appendChild(ring)
      window.setTimeout(() => ring.remove(), 1600)
    },
  }
}
