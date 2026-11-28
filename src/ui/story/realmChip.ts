// lane N4d: the timeline's realm chip while Follow follows one realm (realmFollow.ts): "◉ Kingdom of Tidu ×" in the realm's
// colour. Its × (or Esc) goes back to following the whole world; a short note on it says when the story passes on
// ("The story passes to X"). DOM only; storyView.ts drives it.

import './realmFollow.css'

export interface RealmChip {
  readonly root: HTMLElement
  /** Show the chip for realm `name` (colour `css`), or hide it (null). */
  set(name: string | null, css?: string): void
  /** A note on the chip for `seconds` ("The story passes to X"), then back to the realm's name. */
  note(text: string, seconds: number): void
  tick(dt: number): void
}

export function createRealmChip(onWorld: () => void): RealmChip {
  const root = document.createElement('span')
  root.className = 'tl-realm hidden'
  root.setAttribute('role', 'status')
  const dot = document.createElement('span')
  dot.className = 'tl-realm-dot'
  const label = document.createElement('span')
  label.className = 'tl-realm-label'
  const x = document.createElement('button')
  x.type = 'button'
  x.className = 'tl-realm-x'
  x.textContent = '×'
  x.title = 'Follow the whole world again (Esc)'
  x.setAttribute('aria-label', 'Follow the whole world again')
  x.addEventListener('click', (e) => {
    e.stopPropagation()
    onWorld()
  })
  root.append(dot, label, x)
  let name = ''
  let noteLeft = 0
  const show = () => {
    label.textContent = name
    root.title = `Following ${name}: its own smaller events, and the world's greatest. × or Esc follows the whole world`
  }
  return {
    root,
    set(n, css) {
      root.classList.toggle('hidden', n === null)
      if (n === null) return
      name = n
      dot.style.background = css ?? '#ffd68a'
      if (noteLeft <= 0) show()
    },
    note(text, seconds) {
      noteLeft = seconds
      label.textContent = text
      root.classList.add('tl-realm-note')
    },
    tick(dt) {
      if (noteLeft <= 0) return
      noteLeft -= dt
      if (noteLeft <= 0) {
        root.classList.remove('tl-realm-note')
        show()
      }
    },
  }
}
