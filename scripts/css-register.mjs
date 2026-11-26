// node --import ./scripts/css-register.mjs --experimental-strip-types <script.ts>: CSS imports become empty modules.
import { register } from 'node:module'
register('./css-hooks.mjs', import.meta.url)
