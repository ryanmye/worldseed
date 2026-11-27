# Plan: Language typology and writing systems — sound systems that differ, and scripts that spread

Target: worldseed `main` @ 4484b19 (language drift merged: `phase1/language`, language#1–10). Plan only; no code in the repo
is changed. The probe is `/home/claude/scratch-scripts/probes/sameness.ts` (copy of ws-main in `/home/claude/scratch-scripts/ws`).
It runs with `node --experimental-strip-types sameness.ts <seeds>`.

Markers: **[V]** read in the code at 4484b19. **[M]** measured with the probe. **[A]** assumption or design default; tune it
in the harness. Citations follow `_CONVENTIONS.md` (tag per entry in the References).

- **EventType block: 400–409.** This plan uses 400–404; 405–409 are spare. It deliberately leaves 182–189 and 390–399 to
  barriers-coldwar, which is being written in parallel (see §9.4).
- **Phase / lane:** Phase 2, lane **L2** (MASTER-PLAN §4.1 addendum).
- **Depends on:** language-drift (merged). It reads `History.ideaAdoptions` (ideas key `writing`, `alphabet` [V
  `sim/history/ideas/params.ts:185,222`]), polity snapshots, `stateFaith` and faith holy cities. All of these exist on main.
- **Option:** `HistoryOptions.typology`, carried by the URL as `lang=2` (§7). Like R32, it is for **new worlds only**. G0 is
  unaffected.

---

## 1. Current behaviour (why everything sounds "Germanic")

### 1.1 One English-letter master inventory [V]
- `names/phonology.ts`:
  - `CONSONANTS_MASTER` has 21 English spellings: `p t k b d g m n ng f v s z sh th r l w y h ch`.
  - `CORE_CONSONANTS` = `n r l m s t k`. Every language takes 4–6 of these, then 3–6 more from the master.
  - `PURE_VOWELS` = `a e i o u`. Every language has 3–5 of them, with no length, nasality or tone.
  - `buildLanguage` picks one of 4 rhythm `STYLES`. They differ only in syllable-shape weights over V, CV, VC, CVC and
    CCV, and in final-consonant counts.
- `names/words.ts`: the phonotactic constants are global and Indo-European in flavour.
  - `FINAL_OK` = `n r l s m th sh t k d ng`.
  - `ONSET_CLUSTERS_OK` = `tr dr kr gr pr br fr thr shr st sk sp sl pl bl gl fl kl`.
  - `DIPHTHONGS_OK` = `ai au ei ou ia io oi ea`.
  - `isEuphonic`, `toUnits` (the digraphs `ng sh th ch` + `gh kh ph dh zh`) and the regexes `DOUBLED`, `REPEATED_CV` and
    `ECHO_CV` are all ASCII-letter based.
- `names/soundChange.ts`: the drift catalogue (14 kinds, `SOUND_CHANGES[kind][variant]`) rewrites **letters**. Its kinds are
  lenition, palatalisation, umlaut, syncope, apocope, prothesis and so on, the textbook history of Germanic and Romance.
  `drawRules` (languageTree.ts:210) picks kinds from `SOUND_CHANGES` directly.
- `drift.ts base(n)` = `buildLanguage(createRng(seed, 'names-lang-<tribe>'))`. Daughters share the proto `Language`, and they
  diverge only through letter rules. `spoken.ts spokenNameAt` = `capitalizeName(evolve(...))`. No orthography layer exists:
  the underlying form **is** the spelling.
- Every other name module draws from the same `Language` and capitalises the result directly. That covers
  `placeNames.ts` (adaptName, borrowWord, dedicate), `rulerNames.ts`, `polityNames.ts`, `peoples.ts namePeoples` and
  `featureNames.ts`.

### 1.2 Measured sameness [M] (`sameness.ts 1 7 42 1234`; 8 tribes × 4 seeds = 32 languages, 200 roots each)
| measure | value |
|---|---|
| consonants per language | 7–12 (mean 9.3); WALS mean is 22.7, range 6–122 (Maddieson, WALS ch. 1) |
| vowel qualities | 3–5; WALS: 5–6 is the modal class, 33 % have exactly 5, 32.6 % have 7–14 (ch. 2) |
| presence of `th` (/θ/-like) | 8 / 32 = 25 %; WALS 'th' sounds: 43 / 567 = 7.6 % (ch. 19) |
| tone, length, nasal vowels, ejectives, uvulars, clicks | 0 % each; WALS: tone 41.7 % (ch. 13), nasal-vowel contrast 26.2 % (ch. 10), ejectives 16.8 % (ch. 7), uvulars 17.1 % (ch. 6), clicks 1.8 % (ch. 19) |
| pairwise bigram-profile cosine of roots (496 pairs) | mean **0.433**, min 0.150, max 0.762 |
| mean root length | 5.43 letters |

Samples show the problem: seed 1234 tribe 2 has `ronshik yamath spalar sincho thishath`, and seed 7 tribe 1 has `kowei
yenere krone tewo`. The English digraphs (th, sh, ch), the obstruent+liquid onsets and the 5-vowel ceiling make almost
every world sound like one north-west-European family. The 4 `STYLES` change rhythm only.

### 1.3 UI fonts [V]
- **The UI does not use Libre Franklin.** The repo has no `@font-face`, no font files and no font link in `index.html`.
- `style.css:3` and `render/labels.ts:51` ask for `'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif`. Inter is not
  bundled, so in practice this is the platform UI font.
- Feature labels use `SERIF` = `Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', serif`
  (`labels.ts:50`). So do the sagas and the library.
- Map labels are drawn on a canvas. `labels.ts measure()` splits text with `Array.from(text)`, one code point per glyph,
  and draws tracked labels glyph by glyph.
  - A combining diacritic therefore becomes a separate, mis-placed glyph on curved labels.
  - `style.upper` labels (oceans, continents, ranges, deserts) call `toUpperCase()`. Some lowercase letters have no
    precomposed capital: `ǰ` becomes `J̌` (2 code points), `ŉ` becomes `ʼN`.
- Consequence (§4.4): only **precomposed** characters whose uppercase is a single code point. Coverage is probed at run
  time; `document.fonts.check()` cannot do it (MDN: it "does not check for individual glyph coverage").

### 1.4 What exists to build on [V]
- `IdeaAdoptions` (contract.ts:1977) has per-people rows of `idea`, `year`, `how` (IdeaHow: Invented, Contact, … Conquest,
  Empire, Pilgrims, … Lost), `from` people, `via` and `source` settlements.
  - Idea keys `writing` (pre `calendar`, era 1), `alphabet` (pre `writing`), `paper` and `printing` exist
    (ideas/params.ts).
  - **A script can therefore ride the existing writing idea**: who invented it, from whom it was learned, and when it was
    lost.
- `People.cradle`: "peoples sharing a cradle are neighbours" (contract.ts:1905). This is the natural areal unit.
- `contact.ts` already computes, per 50-year bin, each language's exposure to the tongue of the realms its speakers live
  in. Scripts reuse it (§5.5).
- Assembly order [V `history/index.ts:664–699`]: `prepareLanguage` runs before naming. `assembleReligion` (695) runs before
  `assembleLanguage` (699), so faith data is available to a script pass placed after `assembleLanguage`.
- The UI already imports sim/names modules (`cityCard.ts:7` imports `spokenNameAt`).

---

## 2. Design overview

1. **Phoneme model.** Every typology-on form is a string of **internal phoneme symbols**: one UTF-16 code unit per phoneme,
   from the Private Use Area (§3.1). A phoneme is a feature bundle:
   - consonants: place × manner × laryngeal × secondary;
   - vowels: quality × length × nasal × tone.
   Sound change, borrowing and euphony run on features. Spelling is a separate layer.
2. **Typological profile per proto-language.** Parameters are drawn from priors with WALS frequencies (§4.1): consonant
   inventory class, vowel inventory class, syllable structure, tone, glottalic series, uvulars, rare series, nasal vowels,
   length, harmony, and morphology style.
   - **Areal clustering**: each cradle has an areal profile, and a people takes each feature group from its cradle with
     chance `arealKeep`.
   - **Stratified** world draws make each world span the distribution, so no single family dominates.
3. **Inventory and templates.** An inventory is built series by series in cross-linguistic frequency order. Syllable
   templates run from (C)V to clusters, with a sonority-sequencing gate (Clements 1990).
4. **Morphology styles shape names**: isolating, suffixing (agglutinating, with harmony), prefixing (noun-class),
   compounding, and root-and-pattern.
5. **Orthography.** `romanize(form, tradition, register)` turns phonemes into Latin.
   - A *tradition* is a per-language vector of spelling choices: the in-world "scholarly school".
   - The **plain** register is ASCII plus apostrophe, may be lossy, and is used on map labels, `Settlement.name` and search.
   - The **scholarly** register is a whitelist of precomposed diacritics and must be injective. It is used in the
     inspector, the tree panel and optionally the labels. A glyph probe and fallback sit behind it.
6. **Drift composes unchanged in structure.** The tree, rates, rule dates, lexicon, contact, shifts and exonyms are as
   merged. Only the rule *catalogue* (feature-based kinds), the euphony gate and borrowing switch to phoneme mode, and
   romanization is applied at display.
7. **Writing systems**, invented and spread through the writing idea:
   - types: alphabet, abjad, abugida, syllabary, logosyllabic, featural;
   - direction: LTR, RTL, vertical, boustrophedon;
   - events: adoption with adaptation, reform (the `alphabet` idea), and replacement under rulers or faiths;
   - each script has a deterministic stroke-grammar glyph set, cached SVG, with related scripts sharing primitives;
   - names are transcribed to glyph strings and shown beside the romanization.

Worked example (seed-independent illustration; symbols shown as IPA):
- Proto form `/ˈtɬa.qʼum/`. The profile is moderately complex, with ejectives, uvulars and no tone, so `tɬ` is an affricate
  onset.
- Year 700: ejective → plain (`Deglottalise`), giving `/tɬa.qum/`. Year 1300: uvular → velar (`UvularMerge`), giving
  `/tɬa.kum/`.
- The tradition writes `tɬ` as `tl` in plain and as `tł` in scholarly, and `qʼ` as `q'`.
- Spoken at 1500: plain **Tlakum**, scholarly *Tłakum*. Spoken at 600, before the ejective was lost: plain `Tlaq'um`,
  scholarly `Tłaqʼum`.
- The people adopted writing (`writing` via Trade from a syllabary user) at 1120. The card shows glyphs `[tla][ku][m̥]`,
  with the coda as a dead-vowel sign.

---

## 3. Contract (`src/contract.ts`), drafted in the codebase style

### 3.1 Phonemes (`src/sim/names/typology/phoneme.ts`, not in contract; pure)
```ts
/**
 * typology: a phoneme is one UTF-16 code unit in U+E000..U+F8FF (Private Use Area), so a form is a plain string with one
 * unit per phoneme (toUnits is s.split(''); hashing, saves and nameForms are unchanged in kind). Consonant code =
 * 0xE000 + ((place * 10 + manner) * 6 + laryngeal) * 3 + secondary  (12 x 10 x 6 x 3 = 2160 codes);
 * vowel code = 0xF000 + ((quality * 2 + long) * 2 + nasal) * 6 + tone  (16 x 2 x 2 x 6 = 384 codes). Never displayed:
 * romanize() (orthography.ts) or ipa() (tests, debugging) render them.
 */
export const Place = { Bilabial: 0, Labiodental: 1, Dental: 2, Alveolar: 3, Postalveolar: 4, Retroflex: 5, Palatal: 6, Velar: 7, Uvular: 8, Pharyngeal: 9, Glottal: 10, LabialVelar: 11 } as const
export const Manner = { Stop: 0, Nasal: 1, Fricative: 2, Affricate: 3, LateralAffricate: 4, Lateral: 5, Tap: 6, Trill: 7, Approximant: 8, Click: 9 } as const
export const Laryngeal = { Voiceless: 0, Voiced: 1, Aspirated: 2, Ejective: 3, Implosive: 4, Prenasalised: 5 } as const
export const Secondary = { None: 0, Labialised: 1, Palatalised: 2 } as const
/** Vowel qualities (front/central/back x height; rounding implied by the IPA cell). */
export const Quality = { i: 0, y: 1, e: 2, ø: 3, ɛ: 4, a: 5, ɨ: 6, ə: 7, ɐ: 8, u: 9, ɯ: 10, o: 11, ɔ: 12, ɑ: 13, ʉ: 14, œ: 15 } as const
/** Tone on a vowel: 0 none, 1 high, 2 mid, 3 low, 4 rising, 5 falling. */
export const Tone = { None: 0, High: 1, Mid: 2, Low: 3, Rising: 4, Falling: 5 } as const
export function sonority(code: number): number // 0 stop .. 1 affricate .. 2 fricative .. 3 nasal .. 4 liquid .. 5 glide .. 6 vowel (Clements 1990 scale, coarse)
/** Legacy letters as phonemes (t, th = /θ/, sh = /ʃ/, ch = /tʃ/, y = /j/, ng = /ŋ/ ...): for tests and the LEGACY tradition. */
export const LEGACY_LETTER: Record<string, number>
```
- Why PUA rather than IPA strings: IPA needs combining marks or multi-character units (`tʰ`, `kʼ`, `ⁿd`, `aː`, `ã́`), so
  `toUnits` would need a tokenizer per language, and two spellings could collide.
  - One code unit per bundle makes every rule O(units) and unambiguous.
  - The PUA has 6400 code points; 2544 are used.

### 3.2 Enums (contract.ts)
```ts
/** typology: how a language builds names (Languages.typo bits 8-10; WALS ch. 26A/20A priors, typology/profile.ts). */
export const MorphStyle = { Isolating: 0, Suffixing: 1, Prefixing: 2, Compounding: 3, RootPattern: 4 } as const
/** typology: kinds of writing system (Daniels & Bright 1996; 'featural' after Sampson). */
export const ScriptType = { Logosyllabic: 0, Syllabary: 1, Abugida: 2, Abjad: 3, Alphabet: 4, Featural: 5 } as const
export const ScriptDirection = { LTR: 0, RTL: 1, Vertical: 2, Boustrophedon: 3 } as const
/** Where a script came from (Scripts.origin). */
export const ScriptOrigin = { Invented: 0, Stimulus: 1, Adapted: 2, Reformed: 3 } as const
/** Why a people took up another people's script (ScriptUse.cause; the `extra` of ScriptReplaced). */
export const ScriptCause = { Own: 0, Learned: 1, Rule: 2, Faith: 3, Idea: 4, Lost: 5 } as const
```
**`SoundChangeKind` extension** (the enum is owned by language-drift; this plan appends). Ids 14–25 are **phoneme-model
only**. The legacy catalogue keeps 0–13 unchanged.
```ts
  Tonogenesis: 14,      // a final stop or glottal falls and leaves a contour tone on the vowel (falling after a voiceless one, rising after a voiced or glottal)
  Nasalise: 15,         // a vowel before a nasal that closes its syllable takes on nasality and the nasal falls (aN > ã)
  Deaspirate: 16,       // aspirated stops merge with plain ones
  Deglottalise: 17,     // ejectives (or implosives) become plain stops
  UvularMerge: 18,      // uvulars move to velar (q > k, χ > x)
  RetroflexMerge: 19,   // retroflexes merge with alveolars
  Debuccalise: 20,      // s > h, or a final k/t > ʔ
  LengthChange: 21,     // long vowels shorten, or a lost coda lengthens the vowel (compensatory lengthening)
  ToneMerge: 22,        // two tone levels merge (L and M, or rising and high)
  HarmonyLoss: 23,      // vowel harmony stops applying to new suffixes (inherited words keep their vowels)
  Prenasal: 24,         // prenasalised stops become plain voiced stops, or nasals
  ClusterBreak: 25,     // an epenthetic vowel breaks a cluster the template does not allow (CC > CVC)
```
- Kinds 0–13 also get **feature implementations** in phoneme mode. For example, Lenition becomes "a stop becomes a fricative
  at the same place between vowels".
- So one `SoundChangeKind` id means the same process in both models. Only the variant lists differ (§5.3).

### 3.3 Events 400–404 (405–409 spare)
```ts
  // typology: writing (400-409; none when HistoryOptions.typology is false).
  ScriptInvented: 400, // a people made writing of its own: `settlement` where (the IdeaAdoptions via), `other` the settlement it heard of writing from (Stimulus) or -1; `value` the script id (History.scripts); `extra` the ScriptOrigin (Invented or Stimulus)
  ScriptAdopted: 401, // a people learned to write another's script, fitted to its tongue: `settlement` where, `other` the source settlement; `value` the new (adapted) script id; `extra` the script it was adapted from
  ScriptReformed: 402, // a people made a new script out of its own (the alphabet idea, invented): `settlement` its largest town; `other` -1; `value` the new script; `extra` the old
  ScriptReplaced: 403, // a people gave up its script for another's: `settlement` its largest town, `other` the donor's capital or holy city; `value` the script now used; `extra` the ScriptCause (Rule, Faith, Idea)
  ScriptLost: 404, // the last people writing script `value` lost writing or left it: `settlement` its largest town then; `other` -1; `extra` the people
```
- Chronicle lines are hedged:
  - 400: "At Tlakum, it is said, the Ashkari began to keep words in signs of their own."
  - 401: "The Ashkari have learned to write from the Peloi, shaping Peloi signs to their tongue."
  - 402: "Ashkari scribes have made their signs into letters, one for each sound."
  - 403: "Under Kepian rule the Ashkari have come to write in the Kepian hand."
  - 404: "No one now reads the old Ashkari signs."
- The director's weights (experience §0.1) get the default notice weight. ScriptInvented gets a beat weight equal to
  IdeaTakeoff's [A].

### 3.4 History tables (struct-of-arrays; all absent when the option is off)
```ts
/**
 * typology: per-language phonology summary (only with HistoryOptions.typology; absent otherwise, so lang=1 histories hash as
 * before). Languages.model = 1 says forms in nameForms and lexForm are phoneme strings (typology/phoneme.ts).
 */
export interface Languages {
  // ... existing columns (language-drift) ...
  /** 1 when forms are phoneme strings (typology), absent or 0 for letters. */
  model?: number
  /**
   * Packed profile per language (inherited at a split, unchanged): bits 0-1 onsetMax, 2-3 codaMax, 4-6 tones (0, 2..5 levels
   * incl. contours as 5), 7 harmony, 8-10 MorphStyle, 11 headInitial (compounds), 12 classPrefix in names, 13-15 the
   * syllable class (0 simple, 1 moderate, 2 complex). The euphony gate and the rule catalogue read it (no Rng in the UI).
   */
  typo?: Uint32Array
  /** Orthography tradition per language: packed spelling choices (orthography.ts ORTHO_SLOTS; 2 bits each, 16 slots). */
  ortho?: Uint32Array
}

/**
 * typology: the writing systems of the world (empty when off). Row i is script i in order of appearance (a parent before its
 * daughters). Glyph shapes are not stored: they are a pure function of (world seed, family, script id) (script/glyphs.ts).
 */
export interface Scripts {
  count: number
  type: Uint8Array
  direction: Uint8Array
  origin: Uint8Array
  /** Script it came from (-1 for an invention), and the root of its line (stroke primitives are the family's). */
  parent: Int16Array
  family: Int16Array
  /** People that made it, the language (History.languages) its signs were fitted to, the year and the town. */
  people: Int16Array
  language: Int16Array
  year: Int16Array
  settlement: Int32Array
  /** "Ashkari": its makers' name for it (plain romanization), shown as "the Ashkari script". */
  name: string[]
}

/** typology: which script each people writes over time (empty when off). Rows by people, years ascending: start[p]..start[p+1]-1. */
export interface ScriptUse {
  start: Int32Array
  year: Int16Array
  /** Script written from that year, -1: writing lost. */
  script: Int16Array
  cause: Uint8Array
}
```
**NameForms additions** (typology only): `peopleForm: string[]`, `polityForm: string[]`, `polityLanguage: Int16Array`,
`faithForm: string[]`, `houseForm: string[]`. These hold the native stems as phoneme strings, so the polity panel and
peoples panel can show the scholarly form and the script; the stored display names stay plain. Helpers in `contract.ts`:
`scriptAt(h, people, year)`, which returns the script id or -1.

### 3.5 Options and params
```ts
  /**
   * typology: languages drawn from typological profiles (phoneme inventories, syllable templates, tone, morphology styles)
   * with romanization traditions, and writing systems that spread with the writing idea (History.scripts, scriptUse, events
   * 400-404). Needs `language`. Default false; new worlds write lang=2 (drift + typology). Off: exactly as without it.
   */
  typology?: boolean
```
Params go in `src/sim/names/typology/params.ts` (`export const TYPO`, `export const SCRIPT`). The priors are in §4.1, and
other values appear where they are used.

---

## 4. Typology rules

### 4.1 Priors (WALS shares; the harness targets in §8 compare against these)
| dimension | categories → prior | source |
|---|---|---|
| consonant inventory | small 6–14: 0.158 · mod. small 15–18: 0.217 · average 19–25: 0.357 · mod. large 26–33: 0.167 · large 34+: 0.101 (capped at 48 for names) | Maddieson, WALS 1A (89/122/201/94/57 of 563) |
| vowel qualities | 2–4: 0.165 · 5–6: 0.509 (5 alone 0.333) · 7–14: 0.326 | Maddieson, WALS 2A (93/287/184 of 564) |
| syllable structure | simple (C)V: 0.126 · moderate (C2 a liquid or glide; one coda): 0.564 · complex: 0.311 | Maddieson, WALS 12A (61/274/151 of 486) |
| tone | none 0.583 · simple (2-way, usually H/L) 0.250 · complex 0.167 | Maddieson, WALS 13A (307/132/88 of 527) |
| glottalic | ejectives 0.168 · implosives 0.134 · glottalised resonants 0.055 (not exclusive; joint table used as is) | Maddieson, WALS 7A (of 567) |
| uvulars | any 0.171 (stops only 0.067, continuants only 0.019, both 0.085) | Maddieson, WALS 6A (of 567) |
| uncommon | labial-velars 0.079 · pharyngeals 0.042 · 'th' 0.076 · clicks 0.018 | Maddieson, WALS 19A (of 567) |
| nasal vowels | contrast 0.262 | Hajek, WALS 10A (64 of 244) |
| morphology style | Isolating 0.14 · Suffixing 0.47 · Prefixing 0.15 · Compounding 0.20 · RootPattern 0.04 | mapped from Dryer, WALS 26A (little affixation 0.146; suffixing 0.546; equal 0.152; prefixing 0.157 of 969) and Bickel & Nichols, WALS 20A (ablaut/concatenative 5 of 165 = 0.03). The split of suffixing and equal into Suffixing/Compounding is a design mapping [A] |
| retroflex · aspiration · prenasalised · vowel length · vowel harmony | 0.15 · 0.20 · 0.08 · 0.35 · 0.15 | **design defaults [A]**: no WALS chapter. Calibrate against PHOIBLE 2.0 segment counts (Moran & McCloy 2019) in step 4 (a dev-only script reads the PHOIBLE CSV; nothing ships) |

Structural correlations, and only these, so the plan does not encode real families:
- **Complexity factor.** z ~ N(0, 1) per language. Inventory class and syllable class are drawn by the inverse CDF of
  Φ(ρz + √(1−ρ²)ε) with ρ = `TYPO.rho` 0.4 [A]. Basis: Maddieson (WALS ch. 12) notes that simple syllables are
  distributed like small consonant inventories.
- **Harmony.** P(harmony) × 2.5 with a large vowel inventory (7+) [A]. Basis: WALS ch. 2 ties large inventories in
  Africa's middle belt to vowel harmony.
- **Isolating morphology.** Morphemes are monosyllabic, and P(tone) is not changed. Tone clustering comes from areality
  only, not from bundling.
- **Clicks.** Only with an inventory class ≥ average, and at most 1 click per word in names [A] (§4.6).

### 4.2 Areal clustering and stratification (`typology/profile.ts`)
- **Feature groups**: G1 inventory + rare series, G2 vowels (size, length, nasal, harmony), G3 syllable, G4 tone, G5
  morphology.
- **World draw** (stream `names-typo-world`): for C cradles and each of G3, G4 and G5, the cradle category is drawn by
  **systematic sampling**: u_c = (π(c) + U)/C through the prior's inverse CDF, with π a random permutation. A world's cradles
  therefore cover the distribution (with 6 cradles, at least one tonal cradle in ~95 % of worlds [A, verify in the
  harness]). G1 and G2 are drawn independently per cradle.
- **Neighbours.** Cradles are ordered by founding-cell great-circle distance. A cradle within `TYPO.nearArc` (0.35 rad) of
  an earlier cradle copies that cradle's G-group with chance `TYPO.nearCopy` (0.3) [A].
- **Areal basis** [verified statements]: WALS ch. 13 (tone dominant in East and Southeast Asia and in Africa), ch. 6
  (uvulars concentrated in the Caucasus, Inner Asia and western North America), ch. 7 (ejectives in the Americas,
  eastern and southern Africa and the Caucasus), ch. 10 ("strong areal influence" on nasal vowels) and ch. 12 (complex
  syllables in the northern two-thirds of the northern hemisphere).
  - **No latitude or climate term** is used. Real areas come from contact and history, and the invented world's cradles
    stand in for them.
- **People draw** (stream `names-typo-<tribe>`): per group, keep the cradle's value with `TYPO.arealKeep` (0.65 [A]),
  else draw from the global prior.
- **Balance guard** (deterministic, no extra draw): if more than half of a world's peoples agree on all of G3, G4 and G5,
  the people farthest from its cradle centre redraws G4 and G5 from the next draws of its stream (one pass).

### 4.3 Inventory and templates (`typology/inventory.ts`)
- **Consonants**: the target size n comes from the class (uniform within its range). The inventory is filled by series in
  order. **This order is a design order [A]**, loosely after how common segments are cross-linguistically; calibrate it
  against PHOIBLE frequencies in step 4.
  1. Core: /p t k m n/ and a liquid. Then /w j s/.
  2. Voicing (b d g) with p 0.67.
  3. /h ŋ l r/ as needed.
  4. Fricatives f, ʃ, x and z.
  5. Affricates tʃ, ts and dʒ.
  6. Palatal ɲ.
  7. The series the profile switched on (aspirated, ejective, implosive, prenasalised, retroflex, uvular, pharyngeal,
     labial-velar, labialised velars, lateral fricative/affricate, clicks). Each takes 2–5 places, so a series stays
     coherent: never a lone ejective.
  8. Then stop at n, dropping the last-added singletons first.
- A language **never draws from a real language's inventory**. Series are generic.
- **Vowels**: 3 → /i a u/; 4 adds /e/ or /o/; 5 → /i e a o u/; 6 adds /ə/ or /ɨ/; 7 adds /ɛ ɔ/ for /e o/, or /y/ … up to 14 with
  front rounded and back unrounded vowels. Length doubles the vowel set (long counterparts of 3–5 qualities). Nasal vowels
  add nasal counterparts of 3–5 qualities. Tone sets: simple → {H, L}; complex → 3 levels + 1–2 contours.
- **Templates**: (onsetMax, codaMax, finalCodaMax).
  - Simple = (1, 0, 0). A rare 5 % of simple languages require an onset (CV-only) [A].
  - Moderate = (2, 1, 1), where C2 of an onset must be a liquid or glide, matching WALS's definition exactly.
  - Complex = (2–3, 2–3, 2).
  - Clusters must satisfy sonority sequencing: rise to the nucleus, fall after it, with an /s/+stop exception at the onset
    edge (Clements 1990). Cluster lists are enumerated from the inventory, and 3–12 are sampled so that languages differ
    in *which* clusters they allow.
- **Output**: a `Language` with the existing fields filled with phoneme symbols (`consonants`, `codaConsonants`, `finals`,
  `onsetClusters`, `vowels`, `diphthongs`) and `shapeWeights` kept for the CV skeleton, plus a new optional field `typo:
  TypoProfile` (template, tones, harmony, style, cluster sets, class prefixes, patterns). Legacy code ignores `typo`.

### 4.4 Euphony in phoneme mode (`typology/phonotactics.ts`)
- `words.ts` gains a `Phonotactics` interface: `isVowel`, `onsetOk`, `medialOk`, `finalOk`, `maxRun` and the repeat checks
  on units.
  - `LEGACY` reproduces today's constants and regexes **exactly**.
  - `isEuphonic(word, pt = LEGACY)`, `isEuphonicDrift(word, pt = LEGACY)`, `isFluent`, `buildRoot`, `buildMorph` and
    `fuseWords` dispatch on `lang.typo`. Legacy callers do not change.
- A typology gate is derived from the template plus universal checks:
  - no identical adjacent phonemes (geminates only via length);
  - no syllable repeated within two syllables;
  - no consonant 3 times;
  - at most `TYPO.markedPerWord` (2) phonemes from the rare series per word;
  - at most 1 click.
- Drift's relaxation (`isEuphonicDrift`) becomes: a word may exceed the template by **one** cluster that obeys sonority
  sequencing. So drift can create clusters, as syncope does in real languages, without breaking the template wholesale.

### 4.5 Morphology styles (`typology/words.ts`)
Each style changes what `buildRoot`, `composeName`, `fuseWords`, the affix slots and the people, language and polity name
builders produce. All of them share one property: the lexicon's visible meanings are still the affix slots, so drift's
lexical replacement works unchanged.
- **Isolating.**
  - Morphemes are 1 syllable, and names have 2–3 morphemes (root + site word).
  - Tone is on each syllable.
  - The tradition's `join` slot writes them fused ("Tlakum"), hyphenated or spaced.
  - At most 3 syllables per name, and no two identical syllables, tone ignored (anti-caricature, §4.7).
- **Suffixing.** The root takes 0–2 suffixes: the site word, then a derivational suffix for people and language names.
  With harmony, suffix vowels copy the root's harmony class (front/back or ±ATR, drawn per language). A `HarmonyLoss` rule
  freezes this for later coinages.
- **Prefixing (noun-class).**
  - The language draws 3–4 class prefixes (CV or V shapes from its inventory): place, person/people, language and thing.
  - These are new visible lexicon meanings 21–24 (`LANG.visible` 21 → 25 with typology; meanings 21..99 are invisible core
    words, so ids shift only in typology worlds).
  - Town names take the place prefix with p 0.5. People and language names always take theirs, so one root gives three
    distinct names by prefix.
  - Prefixes are generated, never real ones.
- **Compounding.** Names are root + root (descriptor + head; `headInitial` per language), with a linking vowel when the
  template needs one. Site words are full roots, not affixes.
- **RootPattern.**
  - Roots are 3 consonants (2 with p 0.15) drawn under a co-occurrence constraint: no two identical, and no two of the same
    place in C1C2 [A].
  - Meanings are vocalic patterns over the root: the affix slots hold *patterns* such as `C1aC2C3-a` or `maC1C2aC3`, built
    from the vowel inventory.
  - Composing interdigitates the root with the pattern.
  - Drift rules apply to the surface. `ruleKind` Syncope and similar still work. Coining at year Y uses the pattern in
    force (lexicon rows hold patterns, as affix rows hold `|`-joined texts today).
- **People, language and polity names** use the same builders: `namePeoples`, the drift node name (people name + derive
  ending), `namePolities`, `nameRulers` and `nameFaiths`.
  - Each routes its final string through `nameOf(lang, form)`: `capitalizeName(romanize(form, tradition, 'plain'))` with
    typology, exactly `capitalizeName(form)` without.
  - Uniqueness, `nearAny` and `fluentName` checks run on the plain romanization.

### 4.6 Anti-stereotype and "exotic balance" rules (hard, tested)
1. **No real-language templates.** Profiles are per-feature draws from §4.1 priors with areal copying. No profile names a
   real language or family, and no inventory or affix list is copied.
2. **Blocklist.** `typology/blocklist.ts` holds slurs and profanity (English and other widely read languages) plus real
   country names and major ethnonyms (~400 entries, owner-reviewed). A plain romanization, case- and diacritic-folded,
   that equals an entry, or contains a slur of 4+ letters, is redrawn from the name's own fluent stream (as
   `names-fluent-<id>`).
3. **No caricature.**
   - No identical syllables in a name.
   - At most 3 syllables for isolating names.
   - At most 1 click and 2 rare-series phonemes per word.
   - At most 2 apostrophes per word, and never an initial one, in plain spelling.
   - Clicks appear at their real text frequency, not as garnish: per-syllable click probability ≤ `TYPO.clickRate` 0.12 [A].
4. **Balance (harness gate, §8).**
   - Pooled over 22 seeds, no k-means cluster (k = 6, standardised profile vectors) holds more than 30 % of languages.
   - The **legacy-like signature** must be ≤ 15 % of languages. The signature is: no tone, 5 vowels, moderate or complex
     syllables, suffixing, no rare series and inventory 15–25.
   - In ≥ 80 % of seeds with ≥ 6 peoples there are ≥ 3 morphology styles and ≥ 2 syllable classes.
   - The bigram-profile cosine of plain roots averages ≤ 0.30, against the 0.433 baseline [M].
5. **Owner listening sheet.** `typologyStats.ts --sheet` prints 12 names per people for seeds 1, 7, 42 and 1234. Owner tone
   review is an exit criterion, like riots §4.11.

### 4.7 Orthography: romanization traditions (`typology/orthography.ts`)
- **ORTHO_SLOTS.** There are 16 slots, each with up to 4 options. Each option gives a **plain** spelling (ASCII letters
  plus `'`) and a **scholarly** spelling (whitelisted characters). Examples:

| slot | plain options | scholarly options |
|---|---|---|
| ʃ / ʒ | sh/zh · x/j · sj/zj · s'/z' | š/ž · ś/ź · ş/ẓ* · x/j |
| tʃ / dʒ | ch/j · c/dj · tj/dj · ts'/dz' | č/ǰ*(→dž) · ć/dź · c/j · č/dž |
| j | y · j · i | y · j |
| x / ɣ | kh/gh · x/g · h/q | x/ġ · ḫ*/ǧ* · χ… |
| ŋ / ɲ | ng/ny · n'/nh · nn/gn | ŋ/ñ · ṅ*/ń · ŋ/ň |
| aspiration | Ch (th, kh) · C' · Cc | Cʰ* (→Ch) · C' |
| ejective | C' · Cq | Cʼ(U+02BC)* (→C') · C' |
| implosive | 'b, 'd · bb, dd | ɓ*, ɗ* (→'b, 'd) |
| retroflex | (merged, lossy) · rt, rd · tx | ṭ ḍ ṇ ṣ* (→ ţ ď ň ş) |
| uvular | q, gq, qh · q, g', x | q, ġ, χ* (→ q, ǧ, x) |
| pharyngeal | hh, ' · h', ' | ḥ*, ʿ* (→ ħ, ') |
| clicks | c, q, x, ç (letters only) | ǀ ǃ ǁ ǂ* (→ c, q, x, ç) |
| long vowel | aa · ah · a (lossy) | ā · â · aa |
| nasal vowel | an (lossy) · aq · a (lossy) | ã ẽ* ĩ õ ũ · ą ę į ǫ* ų |
| tone | — (plain never marks tone) | acute/grave/circumflex/caron/macron on the vowel · none |
| syllable join (isolating) | fused · hyphen · space · apostrophe on ambiguity | same |
(* = tier 2, probed; the arrow gives the fallback within the same tradition.)

- **A tradition** = a choice per slot (2 bits each, packed in `Languages.ortho`). It is drawn per proto-language from
  `names-ortho-<node>`. A daughter inherits it, and at its split redraws 1–2 slots with p 0.3 [A], so dialects drift in
  spelling.
  - In-world reading: each people's scholars spell their own tongue and their exonyms their way.
  - The tree panel says "spelt after the Kepian school" for a daughter whose tradition still equals an ancestor's
    (cosmetic).
- **Validity.** The scholarly register must be **injective** over the language's inventory. Verify by greedy re-parse of
  every spelling. An ambiguous tradition draw is repaired by trying the next option of the conflicting slot, so no extra
  RNG is needed. Plain may be lossy (many real popular romanizations are), but it must be pronounceable (§8).
- **One diacritic per letter.**
  - Tone takes precedence. Length is then written by doubling, and nasality by a following `n` in scholarly too, when tone
    is marked.
  - Precomposed only: no combining marks (labels draw per code point, §1.3).
  - Every character's `toUpperCase()` must be a single code point, which excludes ǰ and ŉ (§1.3).
- **Glyph tiers.**
  - Tier 1 is assumed to render everywhere [A; check on lane M devices]: ASCII, Latin-1 Supplement letters and Latin
    Extended-A.
  - Tier 2 is probed per font stack: Latin Extended-B, Latin Extended Additional, IPA letters and spacing modifiers.
- **Probe** (`ui/glyphProbe.ts`, once per session and per font stack, ~2 ms [A]):
  1. Draw each tier-2 character in the label font at 24 px on an offscreen canvas.
  2. Compare its 24×24 alpha signature with (a) a never-assigned code point (the tofu signature) and (b) the base letter
     alone (a dropped diacritic).
  3. Any match marks the character unsupported. `romanize` then uses that slot's fallback.
  - The result is cached in localStorage keyed by `navigator.userAgent` and the font stack.
  - Optional (owner decision D-TS2): bundle a small OFL subset font for the scholarly register if lane M finds tier-2 gaps
    on iPhone or Mac. The licence and size must be confirmed then.
- **Display rule.**
  - `Settlement.name`, map labels, search and URLs use plain. The UI setting "Spelling: plain / scholarly" (localStorage;
    a UI preference, not part of History) switches DOM panels. Labels switch only when the probe passed.
  - Search folds diacritics: `normalize('NFD')`, strip `\p{M}`.

---

## 5. Composition with drift and contact (phoneme mode)

### 5.1 Where typology enters `buildDrift` [V drift.ts]
- `base(n)`:
  - typology on → `buildTypoLanguage(world, tribe[n], cradleOf(tribe[n]))`, cached per tribe, from `names-typo-<tribe>`
    and the world/cradle draws;
  - off → as merged.
- `protoWords` and `coinWord` call `buildMorph` and `buildRoot`, which dispatch on `lang.typo`. Prefix-class and pattern
  meanings are added at 21–24.
- `buildDrift` gains a `cradleOf(tribe)` input from `planCradles`/People.
- **The tree, rates, rule dates, lexicon renewal dates, shift draws and exonym borrow years are drawn exactly as in lang=1**:
  same streams, same draw order.
  - The rule kinds differ. drawRules consumes `uKind` and `uVar` per date regardless of whether a kind applies.
  - So a lang=2 world has the **same language tree, split years and shift years** as the lang=1 world of the same seed.
    Only the sounds differ (test it).

### 5.2 Forms, evolve, spoken
- `evolve(L, form, node, from, to, minLetters)`:
  - `L.model === 1` → units = `form.split('')`;
  - catalogue = `FEATURE_CHANGES`;
  - gate = `typoGate(L.typo[proto(node)])`.
  - `minLetters` counts phonemes.
- `spokenNameAt` = `capitalizeName(romanize(evolve(...), ortho(node), register))`. Its `register` argument defaults to
  `'plain'`, so existing callers are unchanged. `spokenKey` adds the register.
- **Romanization is applied at display only.** Sound changes act on phonemes. A merger (q > k) shows in spelling for free,
  and a tradition never feeds back into sound.
- **Exonyms**: `borrowWord` in phoneme mode maps each phoneme to the recipient's nearest by feature distance (place,
  manner, laryngeal, then secondary; vowels by quality, then length and nasal, then tone dropped if the recipient has none),
  then repairs to the recipient's template by epenthesis or deletion.
  - The borrowed form is romanized in the **borrower's** tradition: the in-world "school" effect, as with Köln/Cologne in
    the drift plan.
  - `adaptName` gets the same branch, and its legacy draw order is untouched.

### 5.3 Feature catalogue (`names/soundChangeF.ts`; pure; UI-imported)
- `FEATURE_CHANGES[kind][variant]` is defined for kinds 0–25 (§3.2). Each variant is a predicate plus a rewrite on feature
  bundles. Examples:
  - Lenition v0: stop → fricative at the same place, between vowels;
  - Palatalisation v0: velar → postalveolar affricate before a front vowel;
  - Tonogenesis v0: a final voiceless stop falls and the vowel gets Falling (Rising after a glottal), in a language with
    tones ≥ 2, or with none, which **creates** a tone contrast.
- Applicability in `drawRules` uses the same sample-corpus mechanism, with phoneme strings. `drawRules(…, catalogue)` takes
  the catalogue as a parameter; legacy passes `SOUND_CHANGES` and is unchanged.
- Kind weights stay uniform via `uKind` as merged. Areal "sound-change fashions" are not modelled; see open questions.
- A rule changes the profile summary only through a cached derived profile. When Tonogenesis gives a tone-less language
  tone, the romanizer must know that tones now exist, so `ortho` tone slot handling uses "tones present in the form", not
  the profile bit.

### 5.4 Contact
Loans (`borrowWord`), shifts and LoanWave work unchanged in structure, because `borrowWord` dispatches on `to.typo`.

### 5.5 Writing systems at assembly (`src/sim/history/language/scripts.ts`; after `assembleLanguage`)
Input:
- `ideaAdoptions` rows for key `writing` and key `alphabet` (looked up **by key**, so it is robust to tech-tree's catalogue
  widening, R3);
- polity snapshots and ruling people;
- `stateFaith` and faith holy cities;
- the drift context (main node per people, profile).

The pass walks the rows in `(year, row index)` order. Each decision draws from `script-<people>-<k>`, with k = that people's
decision count.

1. **`writing`, how = Invented**: a new script (origin Invented). ScriptInvented.
   - Type: if no earlier script exists anywhere, Logosyllabic with p `SCRIPT.firstLogo` 0.85. This is a design default,
     after the four commonly recognised independent inventions, each with logographic elements plus phonetic signs
     (Wikipedia, "History of writing").
   - Otherwise (independent invention elsewhere), Logosyllabic with p 0.6, else the phonology fit below.
2. **`writing` learned** (how ∈ Contact … Theft; `from` people q has a script s):
   - with p `SCRIPT.stimulus` 0.12 → **Stimulus** invention: a new family, with the type by phonology fit. "Only the
     general idea spreads": stimulus diffusion, Sequoyah's syllabary being the best documented case (Jordan, UCSD notes).
   - else **Adapted**: a daughter of s with the same family primitives and glyphs reused for shared phonemes; new glyphs are
     derived for missing ones (§6.3).
   - If s is Logosyllabic and the learner's style is not Isolating, the daughter becomes a Syllabary with p 0.5 (borrowed
     logograms used for their sound) [A].
   - Event: ScriptAdopted or ScriptInvented(Stimulus).
3. **`alphabet`**:
   - how = Invented → **Reformed**: a new script of type Alphabet, or Abjad for RootPattern, or Abugida if the people's
     script is a Syllabary or Abugida and its syllables are simple. It is derived from the people's own script (family
     kept). ScriptReformed.
   - how = learned from q → the people **replaces** its script with an Adapted daughter of q's (ScriptReplaced, cause Idea),
     unless it already writes a segmental script.
4. **Phonology fit** [A; a design heuristic in the spirit of Daniels & Bright 1996 on script–language fit]:
   - simple syllables → Syllabary 0.6 / Abugida 0.25 / Alphabet 0.15;
   - moderate → Abugida 0.35 / Syllabary 0.25 / Alphabet 0.4;
   - complex → Alphabet 0.6 / Abjad 0.25 / Abugida 0.15;
   - RootPattern → Abjad 0.7 / Alphabet 0.3.
   - **Featural** arises only by Reform (a designed script), with p `SCRIPT.featural` 0.04 (Sampson's term for Hangul) [A].
5. **Replacement by rule or faith.**
   - Exposure: for each literate people p and 50-year bin (LANG.bin), exposure E_s is the share of p's population living
     in realms whose ruling people writes a script of another **family** s. To it add `SCRIPT.faithMul` (0.4) × the share
     under a state faith whose holy city's people writes s. This reuses contact.ts's bin and share code, factored out as
     `exposureBins(…, keyOf)`, so there is one implementation (Integration rule).
   - Hazard per bin = `SCRIPT.shiftRate` (0.12) × Ē² when Ē, the mean over the last 4 bins, ≥ `SCRIPT.shiftMin` (0.6) [A].
   - On a draw: a ScriptUse row (Adapted daughter of s, cause Rule or Faith, whichever share is larger). ScriptReplaced.
6. **Loss**: `writing` with how = Lost → a ScriptUse row with script -1 (cause Lost). If no people writes the script
   afterwards: ScriptLost.
7. **Direction**:
   - a new family draws LTR 0.45 / RTL 0.35 / Vertical 0.15 / Boustrophedon 0.05 [A];
   - a daughter keeps the parent's with p 0.85, else redraws, and mirrors its glyphs on an LTR↔RTL flip.
8. **Name**: "the X script", with X the people's name (plain). A reform is "the new X script" when X already has one.

---

## 6. Glyphs and transcription (UI-side, pure; `src/sim/names/script/`)

### 6.1 Stroke grammar (`glyphs.ts`)
- **Family style** (stream `script-family-<seed>-<family>`):
  - anchor grid G ∈ {3, 4};
  - angularity a ∈ [0, 1] (1 = incised straight lines, 0 = brush curves);
  - allowed line directions (a subset of H, V, /, \);
  - primitive set of 6–10 from {line, arc, hook, dot, loop, chevron, wave};
  - stroke width 6–12 % of the em;
  - terminals (round, square, wedge);
  - headline (p 0.15) and slant (−10° … 15°).
- **Glyph**: k strokes with mean ≈ 3, which matches Changizi & Shimojo (2005): about 3 strokes per character across 100+
  writing systems regardless of system size. k = 1 + Binomial(4, 0.5) for letters and syllable signs.
  - Each stroke after the first touches an existing stroke or anchor with p 0.7 [A].
  - Logograms are 2 components in a layout (left-right, top-bottom or enclosure), each a glyph of the family. That is
    larger, as composite characters are.
- **Distinctness**: rasterise at 8×8 into a 64-bit signature. Reject a candidate within Hamming distance `SCRIPT.minHam`
  (6) of an accepted glyph of the same script, with ≤ 40 retries, then accept the farthest. Changizi & Shimojo's ~50 %
  stroke redundancy is the motivation for keeping glyphs well apart. dmin is [A].
- **Output**: SVG path data over a 0–100 integer viewBox (`M`/`L`/`Q` with stroke-linecap per terminal), ~40–80 bytes per
  glyph.

### 6.2 Per type (`builders.ts`)
- **Alphabet**: one glyph per phoneme of the language inventory at the script's year. Vowels get glyphs too. Length is a
  doubled glyph, or a mark if the family draws one. Tone marks appear only if the inventory has tone (p 0.5) [A].
- **Abjad**: consonant glyphs. Long vowels may use 2–3 consonant glyphs (p 0.6, like matres lectionis) [A]. Short vowels
  are unwritten.
- **Abugida**:
  - consonant bases with an inherent vowel (the most frequent vowel);
  - other vowels are 1–2-stroke marks at slots (above, below, right, pre-base);
  - a vowel-killer mark for codas;
  - independent vowel glyphs.
- **Syllabary**:
  - one sign per CV pair of the inventory, at most `SCRIPT.maxSyllabary` 160. Beyond the cap, vowels are grouped by height,
    a defective spelling [A].
  - Codas: dropped (p 0.4) or written with a dead-vowel sign [A].
- **Logosyllabic**:
  - 30–60 components;
  - a logogram for each visible meaning (affix and geographic words, the class prefixes) and the core meanings it is asked
    for;
  - phonetic syllable signs (rebus) for everything else, names in particular;
  - a place determinative (a fixed component) before town names (p 0.7) [A].
- **Featural**:
  - consonant shape = place base stroke + manner stroke + laryngeal tick;
  - vowels = a line + dots by height and backness;
  - glyphs are grouped into syllable blocks when the template is (C)V(C).

### 6.3 Related scripts
- A daughter's glyph for a phoneme the parent has = the parent's glyph. A derived (Reformed or Stimulus-family) script
  transforms each glyph:
  - keep 0.5;
  - drop the shortest stroke 0.2;
  - straight → arc 0.15 when the child's angularity is lower;
  - add a stroke 0.1;
  - mirror all glyphs on a direction flip.
- Glyphs for phonemes the parent lacks = the nearest phoneme's glyph plus a diacritic stroke (dot or bar). This is how real
  adaptations add letters [A].
- The family's primitive set is inherited ± 1 primitive. A harness metric checks that related scripts share more raster
  overlap than unrelated ones (§8).

### 6.4 Transcription (`transcribe.ts`)
- `transcribe(h, script, form, year) → GlyphRun { glyphs: number[]; marks: [glyph, slot][]; dir }`.
  - The input is the spoken phoneme form at the year, so the native-script name drifts with speech.
  - A frozen orthography after the `printing` idea is an open question (§11).
- Logosyllabic names: a morpheme matching a visible lexicon word in force (affix, site word, class prefix) gets its
  logogram; the rest are syllable signs.
- A town whose speakers' people has no script at the year → null. The UI says "unwritten".

### 6.5 Cache and budget (`ui/scriptData.ts`)
- `glyphSet(h, script)` is generated lazily on the first request and kept in an LRU of `SCRIPT.cacheScripts` (12) scripts.
- `nameRun(h, id, year)` uses an LRU of 1024 entries keyed `spokenKey|script`.
- **Budget** (tested in §8):
  - ≤ 3 ms to generate one script's glyph set on desktop, ≤ 10 ms on D-phone (§5.3 gates);
  - ≤ 48 KB of path strings per script;
  - ≤ 1 MB total cache.
- Nothing is generated at assembly, and nothing is stored in History.

---

## 7. Determinism and compatibility
- **Carrier.**
  - `HistoryOptions.typology` (requires `language`). URL: `lang=2` means drift + typology; `lang=1` is drift as merged; no
    `lang` param means as before.
  - Once the harness and owner review pass, new worlds write `lang=2` (owner decision D-TS1; recommended). Saves and
    scenarios write the value explicitly (R32).
  - No device-dependent default (R42). The glyph probe changes only *display*, never History.
- **G0**: unaffected. Everything is assembly-only, from `names-*`, `lang-*` and `script-*` streams the simulation never
  uses. With typology on, every non-name field equals the lang=1 run, events aside (400–404 are added). Test with the
  names-stripped hash (language#3's test).
- **lang=1 unchanged**:
  - the legacy `Phonotactics` default;
  - `SOUND_CHANGES` passed explicitly;
  - the new Languages columns absent, not empty, so lang=1 histories hash as before;
  - a golden-names test on seeds 1, 42 and 1234 (lang=1) before and after each step.
- **New streams** (only when on):
  - `names-typo-world`, `names-typo-area-<cradle>` (reserved; the world draw covers it), `names-typo-<tribe>`,
    `names-ortho-<node>`;
  - `script-<people>-<k>`, `script-shift-<people>`;
  - UI-only and pure: `script-family-<family>` and `script-glyph-<script>`, via `createRng(world.seed, …)`.
  - The drift streams are reused unchanged (§5.1). The Phase 0 stream-list test (all options off) is unaffected.
- **Prefix stability**:
  - profiles depend only on world and cradles;
  - script decisions are made in adoption-row order and depend only on earlier rows and snapshots up to their year;
  - so `assemble(Y1)` is a prefix of `assemble(Y2)`. Test it.
- **Cache version**: bump the history cache key for the `typology` option, as for `language`. Check `historyCache.ts`'s
  options key at step 7.

---

## 8. Stats harness

### 8.1 Typology (`node src/sim/names/typology/typologyStats.ts [seeds]`)
This harness needs no history run, because profiles depend on world and cradles only. Cost: ~1 s for 22 seeds [A].
- **Distribution vs WALS**: pooled over 22 seeds and every people (≈ 200 languages), and also over 2000 synthetic draws
  (a 20-cradle world repeated), for each §4.1 dimension.
  - Target: each category share within ±max(0.05, 0.25 × prior) on the synthetic draws, and within ±0.10 on the pooled
    seeds. The ±0.25 relative band is a design default.
  - Report a χ² statistic too (informational).
- **Areal**: agreement on G3, G4 and G5 within a cradle minus across cradles ≥ 0.15.
- **Balance**: §4.6 item 4 (k-means ≤ 30 %, legacy-like ≤ 15 %, style counts, bigram cosine mean ≤ 0.30 vs 0.433 [M]).
- **Pronounceability**:
  - 100 % of plain names pass: letters a–z plus `'` only, ≤ 12 letters, ≤ 4 consonant letters in a row, ≤ 2 apostrophes,
    a vowel letter in every word;
  - mean letters 5–9;
  - every scholarly spelling uses only whitelisted characters, and its uppercase is single-code-point;
  - the scholarly register is injective (re-parse) for 100 % of languages.
- **Blocklist**: 0 hits in output.
- **Sheet** (`--sheet`): the owner listening review.

### 8.2 Drift under typology (extend `languageStats.ts` with `--typology`)
- The existing targets still hold:
  - λ̂ ∈ [0.11, 0.19];
  - name similarity bands 0.75–0.88 at t ≈ 1000 and 0.65–0.82 at 2000, on phoneme strings;
  - erosion 50–80 %;
  - mergers ≤ 3 per seed.
- The tree and split years equal the lang=1 run's (§5.1).
- Tonogenesis fires in 10–40 % of tone-less languages over 2000 years [A].

### 8.3 Scripts (4 seeds: 1, 7, 42, 1234; 2000 y; runs under `simq`)
- scripts per world: 2–12;
- first inventions logosyllabic ≥ 70 %;
- literate peoples (holding `writing`) with a script = 100 %;
- by year 2000, the share of literate peoples writing a segmental script (alphabet, abjad, abugida) ≥ 30 % where
  `alphabet` spread;
- ScriptReplaced 0–6 per seed;
- ScriptLost ≤ 3.

### 8.4 Glyphs (`scriptStats.ts`, pure)
- **Determinism**: the hash of all path strings for a fixed (seed, script) is stable across two runs.
- **Distinctness**: minimum pairwise Hamming ≥ 6 within each script.
- **Strokes**: mean strokes per letter or syllable sign within 2.6–3.4 (Changizi & Shimojo 2005).
- **Related scripts**: raster overlap of daughter vs parent minus unrelated vs unrelated ≥ 0.15.
- **Budget**: §6.5.

### 8.5 Cost
- Assembly with typology on vs lang=1: ≤ +25 ms. Feature rules are ~2× the letter rules' cost [A].
- `spokenNameAt` in µs.
- Realism A/B Δ = 0 (names do not feed the sim).

---

## 9. Interfaces

### 9.1 Amendments to existing code (no parallel subsystems)
- **`words.ts`**:
  - adds `Phonotactics` (LEGACY default);
  - `buildRoot`, `buildMorph`, `fuseWords`, `composeName` and `isEuphonic*` dispatch on `lang.typo`;
  - adds `nameOf(lang, form)`.
- **`phonology.ts`**: `Language.typo?: TypoProfile` (optional); `buildLanguage` is unchanged.
- **`soundChange.ts`**: `evolve` and `applyUnits` take the model; `SOUND_CHANGES` is unchanged; `FEATURE_CHANGES` is in
  `soundChangeF.ts`.
- **`languageTree.ts drawRules`**: the catalogue becomes a parameter.
- **`placeNames.ts`**: `borrowWord` and `adaptName` branch on `to.typo`.
- **`contact.ts`**: factor out `exposureBins` (shared with scripts).
- **`spoken.ts`**: romanize at the end; `register` parameter.
- **`ui/languageData.ts`**: the cache key includes the register.
- **`ui/languageFormat.ts`**:
  - the etymology line shows the scholarly form ("from Old Ashkari *Tła'qum*");
  - `peopleLanguageLines` adds "writes the Peloi-derived Ashkari script (an abugida, left to right) since c. 1120";
  - Chronicle lines for 400–404.
- **New record justification**:
  - `Scripts`/`ScriptUse`: no existing table carries a writing system. IdeaAdoptions says *that* a people writes, not
    *what*.
  - `typo`/`ortho` columns extend `Languages`; no new table.

### 9.2 UI surfaces (DOM only; map labels stay text)
- **City card** (`cityCard.ts:86`): the plain name, then a native-script run (inline SVG, 1.1 em high; vertical scripts as
  a short column) and the scholarly form on hover.
- **Inspector**: in the name block, scholarly form + script run + "in the Ashkari script (an abugida)". Script events
  appear in the town's event list.
- **Polity panel**: the native stem (`nameForms.polityForm`) in the script of the realm's ruling people at the view year.
- **Peoples panel**: a script row per people. A "Scripts" mini-tree goes in the language family tree section, with glyph
  samples (5 signs).
- **Legend register** (`ui/sagas/city.ts:378`): when the people was literate at the coin year, the archaic name gets an
  inline glyph run beside "In the old tongue it was …".
- **City renderer inscription hook**: `ui/scriptData.ts inscription(h, landmarkId, year): { script, dir, paths: string[];
  text: string } | null`. The text is the landmark's name, or its builder ruler's name, in the builders' script at the
  completed year. `render/dioramas` may texture-map it onto a frieze or stele later; this plan adds the API only.
- **Settings**: Spelling plain/scholarly; "Show native scripts" (on).

### 9.3 Consumers (optional; no dependency)
- religious-evolution may read the script's type for liturgical prestige.
- tech-tree's literacy could read script type, but **don't**: the link between script type and literacy is contested.
  This plan offers no effect.
- character-mode PlaceNamed (363) can coin names with `nameOf`.

### 9.4 Registry claims (MASTER-PLAN §3, via the addendum)
- **EventType**:
  - **400–409** typology-scripts: 400 ScriptInvented, 401 ScriptAdopted, 402 ScriptReformed, 403 ScriptReplaced,
    404 ScriptLost; 405–409 spare.
  - **Coordination**: barriers-coldwar is being planned in parallel. This plan takes the *later* half of the unassigned
    390–409 range, so barriers-coldwar can take 390–399, or 182–189. 254–259 stay language-drift's reserve.
- **Enums**:
  - `SoundChangeKind` 14–25 (appended to language-drift's enum, phoneme model only; next free 26);
  - new MorphStyle 0–4, ScriptType 0–5, ScriptDirection 0–3, ScriptOrigin 0–3 and ScriptCause 0–5 (plan-local; the
    `Script*` prefix avoids collisions).
- **HistoryOptions**: `typology` (default false; new worlds via `lang=2` after D-TS1).
- **RNG streams**: those in §7.

---

## 10. Steps (commit-sized; lane L2)
1. **Phoneme codec** (`typology/phoneme.ts`): bundles, PUA codec, sonority, `ipa()`, `LEGACY_LETTER`. Tests: round trip of
   all 2544 codes; sonority order; legacy letter map.
2. **Phonotactics refactor** (`words.ts`): `Phonotactics` with `LEGACY`. A pure refactor. Tests: golden names for lang=0
   and lang=1 on seeds 1, 42 and 1234 identical (whole-History hash identical); every existing names test is green.
3. **Profiles** (`typology/profile.ts`, `params.ts`) and **typologyStats** §8.1 distribution, areal and balance parts.
   Tests: priors sum to 1; the distribution test runs in vitest on synthetic draws (fast); stratification coverage.
4. **Inventory and templates** (`inventory.ts`), with the PHOIBLE calibration dev script (not shipped). Tests: sizes within
   class ranges; coherent series; SSP-valid clusters; a CV-only template yields no codas.
5. **Morphology styles and words** (`typology/words.ts`): roots, morphs, harmony, tone, class prefixes, patterns,
   compounds, blocklist. Tests: style signatures (isolating monosyllables; root-pattern skeleton preserved through
   composition; prefix classes distinct); anti-caricature caps; blocklist.
6. **Orthography** (`orthography.ts`): slots, traditions, plain and scholarly, repair, whitelist tiers, uppercase rule.
   Tests: scholarly injective for 10k drawn languages; plain pronounceability; no combining marks; uppercase single code
   point.
7. **Wiring**:
   - add `HistoryOptions.typology`, `lang=2` (main.ts), `buildDrift` base and cradle input, `nameOf` in every name module,
     the Languages `model`/`typo`/`ortho` columns, and the NameForms additions;
   - the cache key.
   Tests: on = names-stripped hash equal to lang=1; same tree and split years as lang=1; uniqueness and fluency; prefix
   stability; G0.
8. **Feature sound change** (`soundChangeF.ts`; kinds 0–25; `drawRules` catalogue param; evolve and gate dispatch;
   `SoundChangeKind` 14–25 in contract). Tests: each kind on hand-made forms; a tonogenesis chain; blocking; drift harness
   §8.2.
9. **Borrowing in phoneme space** (`borrowWord`, `adaptName` branches). Tests: legacy draw order unchanged (lang=1
   hash); feature-nearest mapping; template repair.
10. **Scripts at assembly**:
    - contract (Scripts, ScriptUse, enums, events 400–404, `scriptAt`);
    - `history/language/scripts.ts`;
    - the `exposureBins` factor-out.
    Tests: a script iff writing is held; well-formed events; replacement only after `shiftMin` exposure; determinism;
    prefix test; option off identical; the §8.3 harness.
11. **Glyphs** (`script/glyphs.ts`, `builders.ts`) and **transcription** (`transcribe.ts`). Tests: §8.4 determinism,
    distinctness, strokes, related-script overlap, budget; transcription per type (alphabet one-to-one, abjad
    consonant-only, syllabary coda rule, logogram use).
12. **UI**:
    - `ui/scriptData.ts` (caches, inscription hook), `ui/scriptView.ts` (inline SVG run, direction), `ui/glyphProbe.ts`;
    - city card, inspector, polity panel, peoples panel, Legend glyphs;
    - Chronicle lines 400–404; settings; diacritic-folded search.
    Tests: formatters on a fixture history; the probe's fallback path with a mocked canvas.
13. **Harness and tuning pass**:
    - TYPO/SCRIPT constants;
    - the realism A/B (Δ = 0 expected) and the perf bench;
    - MASTER-PLAN §3 registry edits in the same PR;
    - the owner listening sheet → D-TS1 (flip new worlds to `lang=2`).

MVP (§4.3 style): steps 1–7 + 12 (the city card's scholarly line only) give "worlds that sound different". Scripts follow in
steps 10–12.

---

## 11. Performance and memory
- **Assembly** [A]:
  - profile and inventory build: ≤ 10 peoples × ~0.2 ms;
  - feature rules: ~1.5k founding surfaces × ≤ 15 rules at ~2× letter cost, ≈ 2–4 ms;
  - exonym borrowings: ~4k at ~1.5× ≈ +10 ms;
  - the script pass: adoption rows (≤ ~10 peoples × ~5 ideas) plus exposure reuse, ≈ 2–5 ms.
  - Total ≤ +25 ms over lang=1.
- **Sim year loop**: 0.
- **History**:
  - Languages `typo`/`ortho`: 8 B × ≤ 160;
  - Scripts ≤ 40 rows; ScriptUse ≤ ~200 rows;
  - NameForms additions ≈ 2k short strings ≈ 60 KB.
  - Total < 0.1 MB.
- **UI**: glyph cache ≤ 12 scripts × ≤ 48 KB; name runs 1024 entries ≈ 100 KB; probe once per session.
- **Phones (R42 / §5.4)**: identical History. Only "Show native scripts" may default off on D-phone *display* if lane M
  finds the SVG cost visible (a UI policy).

---

## 12. Risks, open questions, verified vs assumed
**Verified [V]**:
- the master inventory, constants and rule catalogue are letter-based (§1.1);
- no Libre Franklin and no bundled fonts; labels split by code point and uppercase some styles;
- the `writing` and `alphabet` keys; the IdeaAdoptions fields; `People.cradle`;
- assembly order (religion before language);
- `drawRules` hard-codes `SOUND_CHANGES`.

**Measured [M]**: the §1.2 table (inventory sizes, 'th' rate, bigram cosine 0.433).

**Assumed [A]**:
- every TYPO and SCRIPT constant not tagged with a WALS chapter;
- the series order;
- the phonology-fit table;
- glyph-tier coverage on target devices;
- the cost estimates.

**Risks**:
1. **Stereotyping.** Profiles plus names could still evoke a real group for a reader. Mitigations: the §4.6 rules, the
   blocklist, the owner listening review, and no culture/climate coupling. Residual risk is accepted with review.
2. **Font coverage.** Tier-2 characters may tofu on some platforms. The probe and fallback handle it. Lane M must run the
   probe page on iPhone, iPad and Mac before D-TS1.
3. **Legibility of invented glyphs at 14–16 px**: stroke width ≥ 8 % of the em at small sizes; a 1.1 em minimum; the card
   only, not map labels.
4. **Sound-change realism in phoneme mode**: the drift harness bands must still hold. If tonogenesis or nasalisation
   erode too much, cap deletion kinds as drift §11 (3) does.
5. **A daughter's profile drift vs the template gate**: one extra cluster is allowed (§4.4). If names grow
   unpronounceable in plain, the pronounceability gate blocks the rule for that word, as drift already does.
6. **Search and URLs with non-ASCII**: plain is ASCII by design; scholarly is display only.
7. **The script reform/replace hazard on short runs**: the harness band at 2000 y. The Phase 4 3000-year preset should be
   rechecked.

**Open questions**:
- Should `printing` freeze a historical orthography, so the native-script spelling stops following speech (English-like
  spelling lag)? Proposed: yes, as a later step. `transcribe` would use the form at the people's printing year with
  p 0.5 [A].
- Should areal *sound-change fashions* exist (neighbouring nodes favour the same kinds)? Proposed: a later param.
- Should map labels ever show native script? Proposed: no; DOM only.
- Should exonyms in a people's tradition be shown when "names as said by" (drift §6) is picked? Proposed: yes, for free
  (§5.2).

## Owner decisions (pending; recommended defaults)
- **D-TS1**: new worlds write `lang=2` once §8 and the listening review pass. Recommended: yes.
- **D-TS2**: bundle a subset font for the scholarly register only if lane M finds tier-2 gaps. Recommended: probe first.
- **D-TS3**: blocklist content review (country names, ethnonyms, slurs). Recommended: owner signs off before D-TS1.

---

## References (citation audit 2026-11-27)
Tags: **[verified]** = a page confirming the citation and the claim was opened this session. **[verified: citation]** =
the record was confirmed but not the specific claim. **[unverified]** gives the reason.

The WALS chapters below were opened on wals.info on 2026-11-27. The site names "WALS Online, edited by Dryer, Matthew S.
& Haspelmath, Martin", Max Planck Institute for Evolutionary Anthropology, Leipzig, CC BY 4.0. The edition year (usually
cited as 2013) was not shown on the pages read, so it is [unverified: year].

1. Maddieson, I. Consonant Inventories. WALS Online ch. 1 (Feature 1A). https://wals.info/chapter/1 [verified: categories
   6–14 / 15–18 / 19–25 / 26–33 / 34+ with 89 / 122 / 201 / 94 / 57 of 563; mean 22.7, range 6–122]
2. Maddieson, I. Vowel Quality Inventories. WALS ch. 2. https://wals.info/chapter/2 [verified: 93 / 287 / 184 of 564; 5
   vowels in 188; large inventories linked to vowel harmony in Africa's middle belt]
3. Maddieson, I. Syllable Structure. WALS ch. 12. https://wals.info/chapter/12 [verified: definitions; 61 / 274 / 151 of
   486; areal notes]
4. Maddieson, I. Tone. WALS ch. 13. https://wals.info/chapter/13 [verified: 307 / 132 / 88; simple = two-way, usually
   H/L; areal notes]
5. Maddieson, I. Glottalized Consonants. WALS ch. 7. https://wals.info/chapter/7 [verified: table of 567; areal notes]
6. Maddieson, I. Uvular Consonants. WALS ch. 6. https://wals.info/chapter/6 [verified: 470 / 38 / 11 / 48 of 567; areal
   notes]
7. Maddieson, I. Presence of Uncommon Consonants. WALS ch. 19. https://wals.info/chapter/19 [verified: clicks 9 (+1),
   labial-velars 45, pharyngeals 21 (+3), 'th' 40 (+3), none 449]
8. Hajek, J. Vowel Nasalization. WALS ch. 10. https://wals.info/chapter/10 [verified: 64 of 244; "strong areal
   influence"]
9. Dryer, M. S. Prefixing vs. Suffixing in Inflectional Morphology. WALS ch. 26. https://wals.info/chapter/26 [verified:
   141 / 406 / 123 / 147 / 94 / 58 of 969; areal notes]
10. Bickel, B., & Nichols, J. Fusion of Selected Inflectional Formatives. WALS ch. 20. https://wals.info/chapter/20
    [verified: 125 / 16 / 3 / 1 / 2 / 5 / 13 of 165]
11. Moran, S., & McCloy, D. (eds.) (2019). *PHOIBLE 2.0*. Jena: Max Planck Institute for the Science of Human History.
    https://phoible.org, doi:10.5281/zenodo.2593234 [verified: citation; 3,020 inventories, 2,186 languages. **No segment
    frequency was read**; the retroflex, aspiration, prenasal, length and harmony priors are design defaults]
12. Clements, G. N. (1990). The role of the sonority cycle in core syllabification. In J. Kingston & M. E. Beckman (eds.),
    *Papers in Laboratory Phonology I*, 283–333. Cambridge University Press. https://doi.org/10.1017/CBO9780511627736.017
    [verified: citation (Cambridge record). The SSP content is the standard reading, not quoted from the chapter]
13. Daniels, P. T. (1990). Fundamentals of grammatology. *Journal of the American Oriental Society* 110(4), 727–731.
    doi:10.2307/602899. Via https://en.wikipedia.org/wiki/Peter_T._Daniels [verified: via Wikipedia. "Abjad" proposed
    there; the page notes his "abugida" wording was conditional]
14. Daniels, P. T., & Bright, W. (eds.) (1996). *The World's Writing Systems*. Oxford University Press. ISBN
    0-19-507993-0. Via the same page [verified: citation. The script–language "fit" heuristic in §5.5 is **my design
    reading**, not a claim quoted from the book]
15. Sampson, G. *Writing Systems*. Stanford University Press (ed. cited by Wikipedia: 1990, ISBN 978-0-8047-1756-4;
    the first edition is usually dated 1985 [unverified]). Via https://en.wikipedia.org/wiki/Featural_writing_system
    [verified: via Wikipedia, "featural" introduced for Hangul]
16. Changizi, M. A., & Shimojo, S. (2005). Character complexity and redundancy in writing systems over human history.
    *Proceedings of the Royal Society B* 272(1560), 267–275. https://doi.org/10.1098/rspb.2004.2942 (record:
    https://authors.library.caltech.edu/records/ny1vr-8vn21) [verified: about 3 strokes per character regardless of
    system size; about 50 % redundancy]
17. Miton, H., & Morin, O. (2021). Graphic complexity in writing systems. *Cognition* 214, 104771.
    https://doi.org/10.1016/j.cognition.2021.104771 (PMC8346946) [verified: little evidence that complexity declines over
    time or at borrowing; this is why §6.3 does **not** simplify daughters systematically (keep 0.5; drop a stroke only
    0.2)]
18. Wikipedia, "Early writing" / "History of writing", fetched 2026-11-27. https://en.wikipedia.org/wiki/Early_writing
    [verified: four independent inventions commonly recognised (Mesopotamia, Egypt, China, Mesoamerica); Sumerian with
    syllabic phonetic elements; Maya logograms plus syllabic glyphs. `SCRIPT.firstLogo` 0.85 is a design default after
    this, not a measured rate]
19. Jordan, D. K. Writing systems notes (UCSD). https://pages.ucsd.edu/~dkjordan/resources/writing/Writing03.html
    [verified: stimulus diffusion defined; Sequoyah's Cherokee syllabary as the best-documented case. Kroeber's original
    article (1940) was **not** opened, so it is not cited]
20. Wikipedia, "Romanization of Chinese", fetched 2026-11-27. https://en.wikipedia.org/wiki/Romanization_of_Chinese
    [verified: coexisting systems (Wade–Giles 1859/1892, postal 1906, Gwoyeu Romatzyh 1928, Yale, Hanyu Pinyin 1958);
    different tone notations (digits, diacritics, letters). This is the model for in-world "schools"]
21. MDN, "FontFaceSet: check() method". https://developer.mozilla.org/docs/Web/API/FontFaceSet/check [verified: returns
    true for nonexistent or system fonts; "does not check for individual glyph coverage". Hence the canvas probe]
