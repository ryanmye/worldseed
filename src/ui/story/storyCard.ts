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
  /** "Read more": opens the saga of the main subject (null: no link). */
  more: (() => void) | null
  /** causes: "Why?": opens the Why panel on the beat's event (null or absent: no button). */
  why?: (() => void) | null
  /** Reduced motion: "Show" cuts the camera to the place (null: no button). */
  show: (() => void) | null
  /** onboarding: "Share" gives a link to this moment (null or absent: no button). */
  share?: (() => void) | null
  /** battles: "Watch the battle" opens the 2D replay of the beat's battle (null or absent: no button). */
  battle?: (() => void) | null
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
}

export interface StoryCardDeps {
  host: HTMLElement
  onToggle(): void
  onResume(): void
  onNext(): void
  onClose(): void
}

const MAX_BODY = 220
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
  card.append(closeBtn, eyebrow, title, body, moreText, row)
  root.append(toasts, chip, card)

  let full = ''
  let caption: Caption | null = null
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
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      deps.onClose()
    }
  })
  showBtn.addEventListener('click', () => caption?.show?.())
  readBtn.addEventListener('click', () => caption?.more?.())
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
    },
    hideCaption() {
      caption = null
      if (card.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
      card.classList.add('hidden')
    },
    setPaused(paused) {
      chip.classList.toggle('hidden', !paused)
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
