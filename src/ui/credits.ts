// The Credits popover: who made worldseed, its licence, the 3D model packs it ships (see
// public/models/CREDITS.md) and a link back to the start page. overlay.ts owns the popover
// shell (open/close, Esc, click outside); this file makes the button and fills the body.

const SITE = 'https://ryanmye.github.io'
const REPO = 'https://github.com/ryanmye/worldseed'

interface Pack {
  name: string
  author: string
  url: string
  /** What of it is used, shown after the name. */
  used?: string
}

/** The model packs, mirroring public/models/CREDITS.md (all CC0 1.0). */
const PACKS: Pack[] = [
  { name: 'KayKit Medieval Hexagon Pack 1.0', author: 'Kay Lousberg', url: 'https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0', used: 'buildings, landmarks' },
  { name: 'Kenney Pirate Kit 2.1', author: 'Kenney', url: 'https://kenney.nl/assets/pirate-kit', used: 'ships, dock' },
  { name: 'Kenney Fantasy Town Kit 2.0', author: 'Kenney', url: 'https://kenney.nl/assets/fantasy-town-kit', used: 'cart' },
]

export function creditsButton(): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'btn credits-btn'
  b.textContent = 'Credits'
  b.title = 'Credits and licence (B)'
  return b
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.href = href
  a.textContent = text
  a.className = 'credits-link'
  if (/^https?:\/\//.test(href)) {
    a.target = '_blank'
    a.rel = 'noopener'
  }
  return a
}

function section(body: HTMLElement, title: string): void {
  const h = document.createElement('div')
  h.className = 'help-section'
  h.textContent = title
  body.appendChild(h)
}

function para(body: HTMLElement, ...parts: (string | Node)[]): void {
  const p = document.createElement('p')
  p.className = 'help-note credits-p'
  p.append(...parts)
  body.appendChild(p)
}

export function fillCredits(body: HTMLElement): void {
  body.replaceChildren()
  section(body, 'Worldseed')
  para(body, 'made by ', link(SITE, 'Ryan Ye'))
  para(body, 'Licence: GPL-3.0. Source on ', link(REPO, 'GitHub'), '.')
  section(body, 'Models (all CC0)')
  const ul = document.createElement('ul')
  ul.className = 'credits-list'
  for (const p of PACKS) {
    const li = document.createElement('li')
    li.append(link(p.url, p.name), ` by ${p.author}, CC0 1.0`)
    if (p.used) li.append(` (${p.used})`)
    ul.appendChild(li)
  }
  body.appendChild(ul)
  section(body, 'Code')
  para(body, 'Town layouts draw on Oleg Dolya’s (watabou) ', link('https://github.com/watabou/TownGeneratorOS', 'TownGeneratorOS'), ', GPL-3.0.')
  section(body, 'Privacy')
  para(body, 'Simulated entirely in your browser: no server, no data collected.')
  // the bare app URL: no query, so it works under the /worldseed/ base path too
  para(body, link(location.pathname, 'Start page'))
}
