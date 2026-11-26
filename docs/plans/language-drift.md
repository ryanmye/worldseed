# Plan: Language drift — languages that evolve and split with their speakers

Target: worldseed at commit 8cabf09. Plan only; nothing in the repo is changed. Probes live in
`/home/claude/scratch-language/scripts/` (`langProbe.ts`, `treeProbe.ts`, `driftProto.ts`). Each runs with `node <script> <seeds>`.

Markers: **[V]** I read it in the code at 8cabf09. **[M]** I measured it with the probes (2000-year default runs, seeds 1, 7,
42, 1234). **[A]** An assumption or a tuning guess; check it while implementing.

EventType block: **250–259** (this plan uses 250–253; 254–259 are reserved).
Depends on: nothing hard. It is a pure consequence layer over the settlement table, `History.polity` snapshots, renamings and
contact years. It is built after grudges → finances → families → city-states, and it works with none of them. See §9.

---

## 1. Current behaviour

### 1.1 How a language is represented today [V]
- `names/phonology.ts`: `Language` is a static phonology. It has a consonant and vowel inventory, finals, coda consonants,
  onset clusters, diphthongs, syllable-shape weights, an `openFinal` chance, a syllable range, apostrophe/hyphen/two-word
  habits and `affixes` per `MeaningClass` (river, coast, hill, forest, plain, lake, ford, new). These affixes are the only
  "vocabulary" a settlement name sees.
- `buildLanguage(rng)` picks one of 4 rhythm `STYLES`. `deriveLanguage(parent, rng)` makes a daughter: it applies up to 2
  `CONSONANT_SHIFTS` and 1 `VOWEL_SHIFTS` to the inventory, **element by element and without context** (index i of the
  daughter is the reflex of index i of the parent). It also regenerates **all** affixes, so the daughter's vocabulary has
  no cognates with the parent's.
- `names/words.ts shiftWord(word, parent, child)` maps every unit to its reflex by inventory position. It returns null if
  the result is not `isEuphonic`. This unconditioned substitution is the only sound-change mechanism today.
- `names/index.ts nameSettlementsDetailed(world, settlements)`:
  - It keys a language by `(tribe, level)`. `tribe` is the original settlement. `level = min(MAX_BRANCH 8,
    max(floor(depth / GEN_PER_BRANCH 5), floor(yearsSinceTribe / YEARS_PER_BRANCH 350)))`.
  - `language(tribe, level)` is memoised. It is `buildLanguage('names-lang-<tribe>')` at level 0, and otherwise
    `deriveLanguage(language(tribe, level-1), 'names-shift-<tribe>-<level>')`.
  - **So each tribe has one linear chain of languages, not a tree.** Two colonies on different continents at the same level
    speak the same language. A town founded in year 1800 speaks "level 5" even when its parent spoke level 1.
  - Each settlement's language is fixed at its founding and never changes. Its name is coined once, in that language.
- `SettlementNaming` exposes `{names, roots, tribe, level, language(tribe, level)}`. It has 37 references and 19 calls of the
  form `naming.language(naming.tribe[x], naming.level[x])`, in polities, rulers, faiths, renaming, landmarks, species-v2 and
  peoples. Endings streams are keyed `names-*affix-<tribe>-<level>`.
- `featureNames.ts` has a geographic `Lexicon` (generic words, a derive ending, lenitions) per language. `shiftLexicon`
  carries it through `shiftWord`, and each word is replaced with chance 0.15 per level. This is the only cognate-preserving
  vocabulary in the code.

### 1.2 When names are generated: at assembly [V]
- All names (settlements, features, peoples, polities, houses, rulers, faiths, renamings, landmarks) are made in
  `history/index.ts assemble(years)` (~line 602 onward). They are drawn from `names-*` streams that no simulation rule uses.
  - Settlements are named in id order. Naming a prefix of the table gives the same names (`names.test.ts:93`).
  - The design rule (`names/index.ts` header) is that a name never changes when unrelated rules are tuned, and a longer run
    names alike.
- **Implication.** Language drift can be a pure function of (world, settlement table, history-so-far), computed at assembly.
  The year loop needs nothing. No sim state changes, so with the system off the run is bit-identical, and with it on every
  non-name field is the same.

### 1.3 Peoples [V]
- `peoples.ts seedPeoples` founds one people per tribe. In `state.ts:364-365 found()`, a child inherits `s.people[parent]`.
  **Peoples never split or merge.** `namePeoples` names each people in `language(founder, 0)`.
- So "daughter languages when peoples split" cannot hang on peoples. This plan adds **language lineages (nodes)**, which are
  separate from peoples. `s.people` stays the ethnic identity that knowledge, tech, polity and religion read. It is never
  touched.

### 1.4 Renaming (`history/renaming/`) [V]
- `system.ts` runs as a sim-time consequence layer (`renamingYear`, after religion). It records decisions (cause, form,
  `yLang` = the settlement whose language makes the name, `yPeople`). `rn.lang[v]` is the people whose name `v` bears.
- `assemble.ts` turns the decisions into names:
  - `adaptName` (placeNames.ts) puts the old name into the conquerors' tongue by nearest-sound mapping, cluster/final
    repair and clipping.
  - `dedicate`, `freshPlace` and `qualify` make the other forms. They are drawn from `names-place-<k>` and
    `names-placequal-<id>`.
- Conquest rename: a town is held holdMin..holdMax (15–60) years, then renamed with chance 0.42 × importance (60% Adapted).
  `keptBy` records a people that still uses the old name. The UI says "the Leko still call it Tiboi"
  (`renamingFormat.ts namesLine`).
- UI name lookup: `contract.ts settlementNameAt(h, id, year)`, and `ui/renamingData.ts renamedName` / `withEventNames(year,
  fn)` for event lines. `format.ts settlementName` serves labels, the inspector and panels. Sagas use `settlementNameAt` in
  `sagas/facts.ts:131`. The UI already imports sim modules (`historyView.ts` imports `sim/names/features.ts`).
- `History.contactYear[a * P + b]` (Int16) gives the year two peoples met.

### 1.5 Measurements [M] (`langProbe.ts`)
| seed | peoples | settlements (alive@2000) | (tribe,level) languages | level histogram 0/1/2/3/4/5 | landmasses per people | foreign-ruled @2000 | ruled ≥200 y by another people (ever) | renamings |
|---|---|---|---|---|---|---|---|---|
| 1 | 6 | 1284 (1085) | 36 | 45/337/312/310/188/92 | 7,9,10,5,12,17 | 133 | 139 | 6 |
| 7 | 10 | 1143 (941) | 57 | 87/317/274/192/163/110 | 3–12 | 243 | 192 | 5 |
| 42 | 10 | 1182 (893) | 55 | 63/375/224/236/230/54 | 1–9 | 397 | 416 | 16 |
| 1234 | 10 | 1462 (1050) | 58 | 98/334/270/404/279/77 | 1–14 | 255 | 374 | 11 |

- The level never passes 5 in 2000 years (2000/350 = 5.7).
- The current chain's root similarity to level 0 (normalised Levenshtein distance; Levenshtein 1965) is 0.80, 0.67, 0.60, 0.55, 0.52, 0.53, 0.49, 0.52 for
  levels 1..8. It saturates near 0.5 after 3 shifts, because unconditioned substitution hits every occurrence.
- The baseline for unrelated roots is about 0.17 (driftProto).
- Assembly naming (`nameSettlementsDetailed`) takes 47–229 ms. The history run takes 36–45 s per seed.
- Renaming is rare (5–16 per run). The 139–416 towns under long foreign rule have no linguistic consequence today.

---

## 2. Design overview

1. **Language tree.** Each people has one proto-language: today's `language(founder, 0)`, kept exactly.
   - Daughter nodes split off when its speakers separate: overseas colonisation, or a distant region filling up.
   - The tree is a pure function of the settlement table and terrain landmasses, so it is prefix-stable.
   - Each settlement has a **speech row history** (node from a year). It starts with its founding node and changes only on
     a split (the region moves to the daughter) or a **language shift** (§4.6).
2. **Regular sound changes.** Each node draws an ordered, dated list of rewrite rules from a fixed catalogue: lenition,
   palatalisation, vowel shifts, syncope, apocope, cluster simplification, monophthongisation, h-loss, raising before nasals
   and so on.
   - Rule dates follow a Poisson renewal process at `μ × rate[node]` per millennium. The default is μ = 7 [M: driftProto].
   - A name spoken at year Y = its **underlying form** passed through the rules on the lineage path, in date order, up to Y.
   - A rule applies exceptionlessly: a change hits every word in which its environment occurs (the Neogrammarian
     hypothesis, Osthoff & Brugmann 1878). It is blocked for a word whose output would break phonotactics. This
     "conspiracy" keeps names euphonic: the term is Kisseberth's (1970), for rules that "conspire" toward one surface
     target. Blocking a regular change is a **design simplification**, not a linguistic claim.
3. **Lexical replacement (glottochronology target).** Each node has a 100-meaning core list, with ids only. Its first 20
   meanings are visible: the 8 `MeaningClass` affixes, the 9 feature generic words, the derive ending and the 2 city
   endings.
   - Each meaning is replaced on each branch by a Poisson process at λ_m.
   - The mechanic is per-meaning replacement plus contact loans. The **target** is the harness curve: shared cognates
     between sister nodes ≈ e^(−2λt), with λ = −ln 0.86 ≈ 0.151 per millennium. Swadesh (1955) gives retention of 0.86 per
     millennium on the 100-word list, i.e. about 14 of 100 words replaced. Lees (1953) gave 0.8048 ± 0.0176 (90 % CI) on a
     **215-item** list over 13 language pairs. (**Corrected**: the plan had said "200-word list".)
   - Glottochronology is **contested**. Bergsland & Vogt (1962) found Icelandic changing only about 4 % per millennium
     against Riksmål's about 20 %, and East Greenlandic retaining only 53.7 % per millennium against West Greenlandic's
     97.2 % (figures as reported by Wikipedia and Guy 1982). (**Corrected**: the plan had paired "Icelandic ~97 %" with East
     Greenlandic. The 97 % figure is West Greenlandic's.) Blust (2000) argues lexicostatistics fails on Austronesian data;
     "rates varying many-fold" is **[unverified]**, because the chapter was not opened. Pagel, Atkinson & Meade (2007) found
     that frequently used words change more slowly. Gray & Atkinson (2003) dropped the constant rate. (**Corrected**: they
     used penalized-likelihood rate smoothing (r8s) across a Bayesian MCMC sample of trees, not "Bayesian relaxed clocks".)
   - So λ is a calibration target with per-node rate variation. It is not a law the code enforces.
4. **Proper names fossilise.** An existing place name is never lexically replaced. It only sound-changes ("Avon" kept the
   old Brittonic word for river; compare Welsh *afon*, per Wikipedia's "River Avon"). New coinages use the current lexicon. This gives realistic tautologies ("Oru Tal river").
5. **Exonyms.** A foreign people B borrows a town's name once, at max(contact year, founding). B's form = `adaptName` of A's
   spoken form at that year into B's node; afterwards it evolves by B's rules (Köln/Cologne, both from Latin *Colonia*; Wien/Vienna, Vienna a Latinised form of the
   river name; both per Wikipedia).
   - Borrowing (RNG) happens at assembly. Evolution is pure and lazy in the UI.
6. **Contact.** Loans enter a node's lexicon from the language of a dominant polity (conquest elites), and more weakly from a
   state faith's holy-city language (liturgical prestige).
   - **Language shift**: a town long ruled by a polity whose people is demographically heavy in the realm moves to the
     rulers' node. Its spoken endonym becomes their exonym for it.
   - This ties to renaming: a town already renamed Adapted shifts more readily, and `keptBy` names evolve.
7. **UI.** Maps, labels, the inspector and the Chronicle show the name spoken in the view/event year.
   - The inspector gets an etymology line ("from Old Vashtari *Vashtarum*").
   - A language family tree panel shows nodes, split years and shared-core %.
   - The Legend register may use archaic forms.

Worked example (rules a node might draw):
- The underlying form is `vashtarum`.
- Year 610, depalatalisation sh > s: `vastarum`.
- Year 900, final nasal loss after an unstressed vowel, with u > a: `vastara`.
- Year 1240, syncope of the second-syllable vowel in 3+ syllable words: `vastra`.

The result, *Vastra*, needs the euphony relaxation in §4.3. Without it the syncope rule is blocked and the name stays
*Vastara*.

---

## 3. Contract (`src/contract.ts`), drafted in the codebase's style

### 3.1 Enums
```ts
/** language: why a language parted from its parent (Languages.cause). */
export const LanguageSplitCause = { Proto: 0, Overseas: 1, Distance: 2 } as const
export type LanguageSplitCause = (typeof LanguageSplitCause)[keyof typeof LanguageSplitCause]

/**
 * language: the kinds of regular sound change (SOUND_CHANGES in names/soundChange.ts is the catalogue; Languages.ruleKind
 * indexes it). Each is a rewrite on phoneme units with a context; a word whose result would not be euphonic keeps its form.
 */
export const SoundChangeKind = {
  Lenition: 0,        // a stop or fricative softens between vowels (t > d, k > g > h, p > b > v)
  Palatalisation: 1,  // a consonant before i or e becomes palatal (k > ch, s > sh, g > y)
  VowelShift: 2,      // a vowel moves everywhere (a > o, e > i), sometimes as a chain
  Raising: 3,         // a vowel rises before a nasal that closes its syllable (a > o, e > i)
  Umlaut: 4,          // a back vowel fronts when i follows in the next syllable (a > e, o > e, u > i)
  Syncope: 5,         // the vowel of the second syllable falls between single consonants in a word of 3+ syllables
  Apocope: 6,         // a final vowel falls in a word of 3+ syllables
  FinalLoss: 7,       // a final consonant falls after a vowel (or a final nasal after an unstressed vowel, with the vowel lowered)
  ClusterSimplify: 8, // the first of two consonants assimilates to the second (kt > t, nd > n, sht > st)
  Monophthong: 9,     // a diphthong becomes one vowel (ai > e, au > o)
  HLoss: 10,          // h falls (initially and between vowels)
  Depalatalise: 11,   // a palatal turns back (sh > s, ch > t, y > l)
  Fortition: 12,      // a word-initial w or y hardens (w > v, y > j written as 'y' > 'g' before back vowels)
  Prothesis: 13,      // a vowel is put before an initial s-cluster (sp > esp)
} as const
export type SoundChangeKind = (typeof SoundChangeKind)[keyof typeof SoundChangeKind]
```

### 3.2 Events 250–253 (254–259 reserved)
```ts
  // language: the languages of the world (250-259; none when HistoryOptions.language is false).
  LanguageSplit: 250, // a language parted from its parent: `settlement` is the daughter's seat (its first town), `other` the parent's seat; `value` the language id (History.languages); `extra` the LanguageSplitCause
  LanguageShift: 251, // the people of `settlement` took up the tongue of their rulers: `other` the capital of the polity whose people's language it took; `value` the language now spoken there; `extra` the language given up
  LoanWave: 252, // the language spoken at `settlement` (its largest town) took many words from another (at least LANG.waveLoans of its visible words in LANG.waveYears): `other` the donor's capital (or holy city, for a faith's tongue); `value` the recipient language id; `extra` the donor language id
  LanguageDied: 253, // the last town that spoke language `value` (`settlement`) gave it up or was abandoned; `other` -1; `extra` the language that replaced it there, or -1
```
- LanguageSplit is a Chronicle line ("A distinct tongue, Kepian, has grown apart from Vashtari across the sea").
- LoanWave and LanguageDied are Chronicle lines.
- LanguageShift is logged only for towns ≥ TOWN_POPULATION (smaller ones are recorded in `History.speech` only), like
  Raid's 1,000 rule.
- Sound changes are **not** events (~600 per run). They are listed in the tree panel.

### 3.3 History tables (struct-of-arrays, drafted doc comments)
```ts
/**
 * language: the language tree (empty when HistoryOptions.language is false). Row i is language i, in order of appearance
 * (a parent before its daughters; the peoples' proto-languages first, in people order). A language is not a people: a
 * people speaks one or more languages over time, and a town may shift to another people's (History.speech).
 */
export interface Languages {
  count: number
  /** Language it parted from, or -1 for a people's proto-language. */
  parent: Int16Array
  /** People whose tongue it is by descent (the proto-language's people), index into History.peoples. */
  people: Int16Array
  /** Year it parted from its parent (0 for a proto-language). */
  splitYear: Int16Array
  cause: Uint8Array
  /** First settlement that spoke it (the daughter's seat; the founder for a proto-language). */
  seat: Int32Array
  /** Its name as its speakers say it at the end of the run ("Vashtari", "Kepian"). */
  name: string[]
  /** Relative pace of change (1 typical; drawn once, LANG.rateSpread). */
  rate: Float32Array
  /** Sound changes of language i: rows ruleStart[i] .. ruleStart[i + 1] - 1 of the rule columns, in date order. */
  ruleStart: Int32Array
  /** Rule columns: the year it took hold, its SoundChangeKind and its catalogue variant (which sounds; SOUND_CHANGES[kind][variant]). */
  ruleYear: Int16Array
  ruleKind: Uint8Array
  ruleVariant: Uint8Array
  /**
   * Core vocabulary (LANG.core meanings, 0 .. LANG.visible - 1 the words names are made of): the replacement rows of each
   * language, by meaning. lexStart[i * core + m] .. lexStart[i * core + m + 1] - 1 are rows of the lex columns: the year a new
   * word replaced the inherited one, the donor language (-1 a native coinage) and the new word's underlying form.
   */
  lexStart: Int32Array
  lexYear: Int16Array
  lexDonor: Int16Array
  lexForm: string[]
}

/**
 * language: what each settlement speaks over time (empty when off). Each settlement has a founding row; a row is added when
 * its region parts as a daughter language (LanguageSplit) or it shifts (LanguageShift). Rows by settlement, years ascending:
 * rows start[id] .. start[id + 1] - 1.
 */
export interface Speech {
  start: Int32Array
  year: Int16Array
  language: Int16Array
}

/**
 * language: names as underlying forms. A settlement's founding name, and each renaming's name, was coined as an underlying
 * form in a language; the name said in a year is that form through the sound changes of the speakers' line up to the year
 * (spokenName). Settlement.name stays the name as said at the founding, and Renamings.name the name as said at the renaming.
 */
export interface NameForms {
  /** Underlying form (lower case) and coining language of each settlement's founding name. */
  form: string[]
  language: Int16Array
  /** Per renaming row (History.renamings), its underlying form and coining language (a restored name: its earlier row's). */
  renamingForm: string[]
  renamingLanguage: Int16Array
  /**
   * Exonyms: what another people calls a town, borrowed once (`year`) from the name said then, into language `language`.
   * Sparse: towns that reached TOWN_POPULATION, for each people in contact. Sorted by (settlement, people).
   */
  exoSettlement: Int32Array
  exoPeople: Int16Array
  exoYear: Int16Array
  exoLanguage: Int16Array
  exoForm: string[]
}
```
- New History fields: `languages: Languages`, `speech: Speech`, `nameForms: NameForms`. Each comes with an `empty*()`
  constructor, as for `emptyRenamings`.
- New pure helpers in `contract.ts`, beside `settlementNameAt`:
  - `languageAt(h, id, year)` returns the speech row in force.
  - `spokenNameAt(h, id, year, people?)` returns the endonym, or the exonym for `people`. It is defined in
    `names/soundChange.ts` and re-exported from contract.ts.
- Off, or an older history: `spokenNameAt` returns `settlementNameAt`.

### 3.4 Options and params
```ts
  /**
   * language: languages that split with their speakers and change by regular sound change, lexical replacement and contact
   * (History.languages, speech, nameForms); names are said as in the year shown. Default true; false names everything exactly
   * as before (the new fields empty). A pure consequence layer: on or off, every non-name field is the same (events aside,
   * which gain 250-253).
   */
  language?: boolean
```
Params go in `src/sim/names/languageParams.ts` (`export const LANG`; each value has a doc comment in the file):

| param | default | meaning | tag |
|---|---|---|---|
| `LANGUAGE_ON` | true | default of the option | |
| `mu` | 7 | sound changes per millennium at rate 1 | [M] driftProto: 64% of names visibly changed after 1000 y, cognate form-similarity 0.81 |
| `rateSpread` | 0.35 | node rate = exp(N(0, rateSpread)) (lognormal; relaxed clock) | [A] design default; idea after relaxed clocks (Drummond et al. 2006) |
| `lambda` | 0.151 | core replacement per meaning per millennium (−ln 0.86) | Swadesh (1955) 100-list retention 0.86/millennium; contested |
| `meaningShape` | 0 | gamma shape for per-meaning rate heterogeneity; 0 = homogeneous | [A] design default. With k>0, shared = E[e^(−2λgt)] for g ~ Gamma(k, 1/k) = (1+2λt/k)^−k (the gamma MGF; derived, not cited) |
| `core` / `visible` | 100 / 20 | core list size / visible words | |
| `overseasK` | 3 | a lineage's k-th town on another landmass makes it a daughter | [M] treeProbe: 8–19 overseas splits per seed |
| `regionK` | 4 | towns of a lineage in another region before that region parts | [A] |
| `regionAge` | 300 | years since the node's own split before a region may part | [A] |
| `regions` | 48 | world regions (farthest-point centres on land, from the world alone) | [A] ~0.5 chord across |
| `maxNodes` | 160 | cap on languages | [A] |
| `shiftMin` | 150 | years of unbroken foreign rule before a town can shift | [A] design default. Loosely after the three-generation model of immigrant language shift (Alba et al. 2002 call it "known from previous waves of immigration"). **Corrected**: the plan credited it to Fishman, which could not be verified; "≈ 75–100 y" is my reading of 3 generations, not a sourced number |
| `shiftRate` | 0.02 | shift hazard per 5-year snapshot × share² (see §4.6) | [A] |
| `loanRate` | 0.6 | loans per visible meaning per millennium under full exposure | [A] |
| `coreLoanMul` | 0.25 | core-list (non-visible) loan rate relative to visible | value [A] design default; the direction is from WOLD: basic meanings are the most borrowing-resistant, which gives the Leipzig–Jakarta list (Tadmor, Haspelmath & Taylor 2010) |
| `faithLoanMul` | 0.3 | liturgical donor exposure weight | [A] |
| `waveLoans`, `waveYears` | 4, 100 | LoanWave threshold | [A] |
| `oldYears`, `middleYears` | 450, 900 | "Old X" within oldYears of the node's start, "Middle X" until middleYears | [A] cosmetic |

---

## 4. Rules

### 4.1 Module layout
- `src/sim/names/soundChange.ts` is **pure, with no RNG**.
  - `SOUND_CHANGES: Array<Array<RuleSpec>>`, the catalogue of variants per kind.
  - `applyRule(units, kind, variant): string[] | null` (null = not applicable or blocked).
  - `evolve(form, rules: RuleCursor, upTo)`.
  - `spokenNameAt` and `etymology`.
  - It is imported by sim and UI alike.
- `src/sim/names/languageTree.ts` builds the tree, speech rows and splits (deterministic, no RNG besides rates).
- `src/sim/names/lexicon.ts` handles core replacement and loans (RNG streams below).
- `src/sim/names/contact.ts` handles exposure from polity snapshots, shifts and loan waves.
- `src/sim/names/languageParams.ts`.
- `src/sim/history/language/assemble.ts` is the glue called from `assemble()`.

### 4.2 Tree (pure in settlements + terrain.landmass + world)
- **Regions.** Pick `LANG.regions` region centres by farthest-point sampling over land cells. Start at the lowest-index
  land cell; ties go to the lower index. The result is a pure function of the world, cached like `featureMapCache`.
  `region[cell]` is the nearest centre.
- Process settlements in id order (parent before child, founding order [V]):
  - An original tribe gets a proto node: language(founder, 0), splitYear 0, cause Proto.
  - A child starts in its parent's **current** node at its founding year (speech row of the parent at foundedYear).
  - **Overseas.** The landmass differs from the node seat's landmass. The pending set key is `(node, landmass)`. On the
    `overseasK`-th member, create the daughter (cause Overseas, splitYear = that founding year, seat = the first member). All
    living pending members get a speech row (daughter, splitYear). Later members join it directly.
  - **Distance.** Same landmass, but `region[cell] ≠ region[seat cell]`. Pending key `(node, region)`. It splits on the
    `regionK`-th member if `foundedYear − splitYear[node] ≥ regionAge`.
  - Cap: past `maxNodes`, no new splits.
- Probe [M] (`treeProbe.ts`, a simpler distance rule with no K): unrestricted distance splits gave 69–293 nodes with up to
  half singletons. That is why the region + K gate exists.
  - The overseas K = 3 rule alone gives 8–19 splits per seed.
  - Estimate with the gate: 40–100 nodes per seed [A; verify in step 2, target in §8].
- Prefix stability: a split is decided at the year of the K-th founding and only adds rows from that year on.
- Each node's base `Language`:
  - A proto node uses `language(founder, 0)` as today (same stream `names-lang-<tribe>`).
  - A daughter's **base Language is its parent's** (the same object), with affixes, city endings and the lexicon taken from
    the lexicon state at the split year (§4.4).
  - `deriveLanguage` is not used with the option on. Divergence comes from the dated rules.
- Node rate: `exp(N(0, rateSpread))` from `lang-rate-<node>`.
- Node names: the people's name (proto) or the seat's root (daughter), fused with the node's derive ending and spoken at the
  end year. Duplicates are qualified by the seat's English bearing, as polity qualifiers do.

### 4.3 Sound changes
- Rule dates per node form a renewal sequence from stream `lang-rules-<node>`: `t_{k+1} = t_k + Exp(mean 1000 / (μ·rate))`,
  with t_0 = splitYear. The sequence is drawn only up to the assembled year, and it is prefix-stable because each draw
  depends only on earlier draws.
- Kind and variant are drawn from the same stream, weighted by applicability. A rule whose input segments do not occur in
  any word of the node's base inventory has weight 0.
- Ordered application for a word: the path goes from the coining node to the speaker node. Each node's rules are restricted
  to `[max(splitYear, coinYear), nextNodeStart)`; for the speaker node the window is up to Y. Rules apply in date order.
- **Blocking.** If `applyRule` output fails `isEuphonicDrift`, the word keeps its form for that rule. Also blocked: fewer
  than 2 letters, or fewer than 3 for a settlement name.
- `isEuphonicDrift(w)` = `isEuphonic(w)` **or** w fails it only because of one medial triple of the shape
  `s|n|r|l + ONSET_CLUSTERS_OK` ("vastra", "kantro").
  - The legacy `isEuphonic` and `names.test.ts:83` stay as they are for founding forms.
  - Add a test that spoken forms pass `isEuphonicDrift` (the amendment).
- The underlying form of a name coined at year Y in node n is built with the node's base Language (legacy `buildRoot` /
  `composeName`). It is then evolved through **all** of n's lineage rules up to Y, from the proto start.
  - So a coinage obeys the sound pattern of its day.
  - `Settlement.name` = the capitalised surface at the founding year.
  - Uniqueness and `fluentName` are checked on that surface, so the draw loop of `nameSettlementsDetailed` runs on the
    surface.
- Mergers are allowed (two towns may come to sound alike, as Newport does). The harness reports the rate; see Risks.

### 4.4 Lexicon (glottochronology target)
- Meaning m of node n. For each (node, m), stream `lang-lex-<node>-<m>` gives a renewal sequence of replacements:
  - The rate is `lambda × rate[n] × g_m`. `g_m` ≡ 1 when `meaningShape` = 0; otherwise g_m ~ Gamma(k, 1/k) from
    `lang-meaning-<m>`, the same in every node (the frequency effect is a property of the meaning).
  - A native replacement gets a new underlying form: `buildMorph` for visible affix slots, `buildRoot` for the others.
- A word's surface at Y = its underlying form (the latest replacement ≤ Y on the path, or the inherited one) evolved by the
  rules from its replacement year.
- Visible meanings map to `affixes[cls]` (0–7), `Lexicon.words[geo]` (8–16), `derive` (17) and the city endings (18–19). New
  names at year Y use the words in force at Y. Old names keep theirs: proper names fossilise.
- Cognacy (for the harness): two nodes share meaning m at Y iff their words in force descend from the same replacement row
  (or the same inheritance). For a loan, the donor row counts as the same cognate set only when the donor is the sister
  itself; that is the standard treatment of loans as non-cognate (it inflates similarity, a known glottochronology problem).

### 4.5 Contact exposure and loans (assembly, from `History.polity` snapshots; deterministic order)
- For each 50-year bin and node n, exposure to donor node d =
  - the share of n's speaker-population (snapshot pop) living in polities whose ruling people's main node is d, plus
  - `faithLoanMul ×` the share living under a state faith whose holy city speaks d.
  - The donor's main node is the node of the polity capital's speech.
- Loans are a renewal sequence per (n, m) from `lang-loan-<n>-<m>`, at rate `loanRate × exposure` (× `coreLoanMul` for
  non-visible m), using the bin's dominant donor.
  - The loan form = `adaptName`-style `soundsInto` + `fitShape` of the donor's surface at that year, into n's base Language.
    Factor these out of placeNames.ts as an exported `borrowWord(word, to, rng)`. `adaptName` keeps its exact draw order.
- LoanWave: when a node takes ≥ `waveLoans` visible loans in any `waveYears` window. Logged once per (n, donor) per 300 years.

### 4.6 Language shift (assembly, from snapshots)
- A town v speaking node n, held without a break by a polity whose ruling people's main node is d (d's people ≠ n's people),
  becomes a candidate after `shiftMin` years.
  - share = the population of the ruling people's own settlements in that polity ÷ the polity population, at the snapshot.
  - Per 5-year snapshot hazard = `shiftRate × share² × (1.5 if v was renamed Adapted/Ruler/House by that polity) ×
    (1.3 if v is the capital)`.
  - Draws come from `lang-shift-<v>`, one per snapshot after eligibility, in snapshot order.
- On a shift, add a speech row (d, year). From then on, the endonym is d's exonym of v: borrowed now if no exonym exists, and
  that becomes the town's spoken form.
- The reverse case (a thin elite assimilating, like the Normans in England or the Franks in Gaul; these are textbook
  illustrations, [unverified] here) does not touch place names.
  It is represented by share² staying small.
- LanguageDied: a node with no living speaker row (abandonment or shift).
- **Tie to renaming** (no sim change): `assembleRenamings` coins names with `langOf(at)`. With the option on, `at`'s node at
  the renaming year comes from speech rows (§9.1). `keptBy` names render as the keeping people's spoken/exonym form.

### 4.7 Exonyms
- For each town reaching TOWN_POPULATION, and each people B with `contactYear[A,B] ≥ 0`: borrowYear = max(foundedYear,
  contactYear, the year it reached town size).
- Form = `borrowWord(spoken_A(v, borrowYear), baseLang(mainNode_B(borrowYear)), createRng(seed, 'lang-exo-<v>-<B>'))`.
- Stored in NameForms.exo*. Evolved lazily along B's node path.
- Sizes: ≤ ~400 towns × ≤ 10 peoples ≈ 4k rows [A].

### 4.8 Determinism
- New streams: `lang-rate-<n>`, `lang-rules-<n>`, `lang-lex-<n>-<m>`, `lang-meaning-<m>`, `lang-loan-<n>-<m>`,
  `lang-shift-<v>`, `lang-exo-<v>-<B>`. None is used by the sim. The tree uses no RNG.
- Off: `nameSettlementsDetailed` takes the legacy path untouched, and all new tables are empty, so the run is bit-identical.
  Test with the existing `hashHistory` comparisons by running off vs the pristine 8cabf09 snapshot hash.
- On: every non-name field is identical. Golden tests that compare names, the `names.test.ts` flavour tests and the
  `renaming.test.ts:303` prefix test need a filter or a re-baseline. Run `hashHistory` with names stripped to assert the
  rest is unchanged.
- Prefix stability: `assemble(Y1)` and `assemble(Y2 > Y1)` agree on every name at years ≤ Y1. Add a test.

---

## 5. Lazy evaluation and cache (UI and sim share `soundChange.ts`)
- `spokenNameAt(h, id, year, people?)`:
  1. Pick the name row in force (founding or renaming), giving the underlying form and the coining node.
  2. Pick the speaker node (speech row at year), or B's main node when `people` is given (use the exonym row).
  3. Walk the path to the root (≤ depth 6) from the coin node or borrow node, gathering rules in the windows.
  4. Apply them.
- Cost: ≤ ~15 rules × ≤ 10 units ≈ 1 µs [A].
- Cache key: `id | node | rulesApplied` (a count, so the key changes only when a rule date is crossed). It is an LRU `Map`
  of 8192 entries in `ui/languageData.ts`.
- `namesEpoch()` (renamingData.ts) also advances when any visible town's rule count changes. The simplest version: fold the
  per-node rule-year list into the slot binary search, so the epoch moves when the view year crosses any rule year
  (~600 years in a run).
- `settlementName` / `renamedName` delegate to `spokenNameAt` when `h.languages.count > 0`. `withEventNames` already sets
  the event year, so Chronicle lines get period-correct names for free.

---

## 6. UI, Chronicle and Legend
- **Map labels and panels** show the endonym at the view year. Option: a "names as said by" picker (people) in the peoples
  panel switches labels to exonyms.
- **Inspector**: an etymology line under `namesLine`:
  "From Old Vashtari *Vashtarum* (founded 412); the Leko call it *Bastar*."
  - The stage label is "Old"/"Middle"/none from `oldYears`/`middleYears` after the coining node's split.
  - A shifted town: "Its people took up Kepian about 1310; formerly *Tiboi* in Lekoan."
- **Language family tree panel** (`ui/languagesPanel.ts` + `languages.css`, a section of the peoples panel):
  - Tree with split years and causes; speakers (towns, population) at the view year.
  - Shared core % with each sister (from §4.4); a sample cognate row (the "river" word across daughters); the rule list
    with years ("c. 900: final -m lost").
  - Clicking a node highlights its speaking towns on the map.
- **Chronicle lines** (plain, hedged):
  - 250: "Across the sea the speech of Vashtari settlers has grown into a tongue of its own, Kepian."
  - 251: "By about 1310 the townsfolk of Tiboi speak the Kepian of their rulers."
  - 252: "Many Kepian words have entered Lekoan, it seems, under Kepian rule."
  - 253: "The last speakers of Old Rumi, at Sallo, have given up their tongue."
- **Legend register** (sagas/voice.ts `leg`):
  - It uses archaic forms: the spoken form at the coin year, or at the node split, for "the old tongue".
  - Example: "In the old tongue it was Vashtarum, where the kings of the river sat; men now say Vastra."
  - Sagas' `facts.ts:131` name lookup switches to `spokenNameAt`. The Legend's `archaic` slot calls `spokenNameAt(h, id,
    coinYear)`.

---

## 7. Ordered commit-sized steps
1. **Pure sound-change core.** `names/soundChange.ts` (catalogue, `applyRule`, `isEuphonicDrift`, `evolve`), `SoundChangeKind`
   in contract.
   - Tests: each kind on hand-made words; blocking; that evolve with no rules is the identity; that a vashtarum chain gives
     vastra.
2. **Regions and tree.** `languageTree.ts` and `languageParams.ts`.
   - Tests: purity; prefix stability (tree of a prefix = prefix of tree); node counts in [20, 160] on seeds 1, 7, 42, 1234;
     every settlement has a founding speech row.
3. **Rule draws and underlying forms.** Wire the on-path of `nameSettlementsDetailed`: underlying forms, surface at
   founding, and the `SettlementNaming` amendment (§9.1). Add `HistoryOptions.language`, and `History.languages`, `speech`
   and `nameForms` (empty when off).
   - Tests: off = bit-identical hash vs pristine; on = names-stripped hash equal; uniqueness and fluency of founding
     surfaces; prefix test.
4. **Lexicon.** Lexicon replacement plus the visible-word mapping (affixes, feature generic words, endings, at the coining
   year). Feature naming (`featureNames.ts nameAll`) uses the node lexicon at `namedYear` with the option on.
   - Tests: fossilisation (an old name is unaffected by a later replacement); harness hook.
5. **Renaming coin language and forms.** Add `renamingForm` / `renamingLanguage`.
   - Factor `borrowWord` out of `adaptName` and assert its output is unchanged for off-runs.
6. **Exonyms** (§4.7).
7. **Contact: exposure, loans, LoanWave; shift, LanguageDied** (§4.5–4.6). Add events 250–253 (LanguageSplit is emitted
   from step 3's tree, woven via `weaveEvents`).
   - Tests: events well-formed; shift only after `shiftMin`; no shift without foreign rule.
8. **UI data.** `ui/languageData.ts` (cache, epoch); `settlementName` delegation; inspector etymology line; sagas name
   lookup.
9. **Panels and Chronicle.** Tree panel, chronicle formatters (`ui/languageFormat.ts`), Legend phrases.
10. **Stats harness** `src/sim/names/languageStats.ts` (§8), plus a short tuning pass on `mu`, `regionK` and `shiftRate`.

---

## 8. Stats harness (`node src/sim/names/languageStats.ts 1 7 42 1234`; 2000 years)
Per seed it reports the following, with targets:
- **Tree**: nodes (target 30–120), by cause; median towns per living node ≥ 5; singleton nodes ≤ 15%; depth ≤ 6.
- **Core cognates vs separation**: for every pair of sister lineages with an MRCA, at Y ∈ {500, 1000, 1500, 2000}:
  - Separation t = Y − MRCA split year; shared fraction c over the 100 meanings.
  - Fit `ln c = −2λ̂t` by least squares through the origin. **Target λ̂ ∈ [0.11, 0.19] per millennium** (0.151 ± 25%; the
    ±25 % is a design default),
    pooled over the 4 seeds; residual SD of c ≤ 0.08 at t ≈ 1000.
  - With `meaningShape` > 0, compare instead to (1+2λt/k)^−k.
  - Report the loan-inflated c (loans counted as shared when from the sister) separately.
- **Name-form similarity vs separation**: the same place name said in two sister nodes (exonym-free cognates: a town of the
  MRCA era, its descendants' forms).
  - Target: mean normalised similarity 0.75–0.88 at t ≈ 1000 and 0.65–0.82 at t ≈ 2000, monotone non-increasing in t-bins.
  - Unrelated baseline ≈ 0.17. Prototype [M]: μ = 7 sits between the μ = 5 (0.86 / 0.78) and μ = 8 (0.81 / 0.73) rows.
  - Blind cognate detector (sim ≥ 0.5, a design default, after sound-class mapping in the style of Dolgopolsky 1964/1986): recall ≥ 0.9 at t ≤ 1000, false-positive
    rate on unrelated pairs ≤ 5%.
- **Erosion**: the share of founding names visibly changed by year 2000 for towns founded before 500 is 50–80% [M prototype:
  64% at 1000 y, μ = 8]. Mean letter loss is ≤ 1.5 letters.
- **Shift**: towns shifted, as a share of towns ruled ≥ 200 years by another people (139–416 per seed [M]). Target 10–30%.
  LanguageDied ≥ 1 on at least 2 of the 4 seeds.
- **Loans**: visible-word loan share at 2000 (target 5–25%); LoanWave count (target 1–8 per seed).
- **Mergers**: pairs of living towns of one node with identical spoken names (target ≤ 3 per seed).
- **Cost**: assembly ms on vs off (target +≤ 40 ms per assembly); UI `spokenNameAt` µs per call.

---

## 9. Interfaces
### 9.1 Amendment to `SettlementNaming` (names/index.ts)
- With the option on, **`level[id]` holds the node id** of the coining language, and `language(tribe, level)` returns that
  node's base Language (tribe is ignored but kept for call shape).
- All 19 `naming.language(naming.tribe[x], naming.level[x])` sites and the `names-*affix-<tribe>-<level>` streams keep
  working unchanged: node ids are globally unique, so stream keys stay unique.
- With the option off, the meaning is unchanged.
- Added: `node(id, year)` (speaker node via speech rows) and `surface(form, node, year)` (evolve), so later plans can coin
  period-correct names.
- `merchant-families.md` (§8.2 naming of family surnames via `naming.language(tribe[firstHome], level[firstHome])`) is
  compatible as written. Recommend it use `surface(…, foundedYear)` for display.
- `city-states.md` (polity names unchanged) is compatible.
- `grudges-and-oaths.md` and `state-finances.md`: no interaction.
### 9.2 Optional consumers (no dependency)
- Ethnic/linguistic grievance: `unrest.ts` has an ethnic term (people-based, [V] from city-states §1.4). It could later
  read `languageAt` (a shifted town is less aggrieved). Exposed as `speechDistance(h, v, p)`; not used here.
- `riots-uprisings.md` (280–289) and the society plan (240–249) own unrest mechanics. This plan specifies none. It offers
  only `languageAt(h, id, year)` and the LanguageShift events, as read-only inputs if they want a linguistic-minority
  term.
### 9.3 Proxy fallbacks
- None needed. Every input (settlements, terrain landmass, `History.polity` snapshots, renamings, faith holy cities,
  `contactYear`) exists at 8cabf09.
- With polities off: no shifts and no conquest loans. Faith loans still apply if religion is on, otherwise none. The tree
  and sound change work alone.

---

## 10. Performance and memory estimate
- **Assembly** [A, extrapolated from §1.5 naming time 47–229 ms]:
  - Tree: O(S) ≈ 1.5k, under 1 ms. Regions: O(land cells × 48), once (cached) ≈ 5 ms.
  - Surfaces at founding ≈ 1.5k × 15 rules ≈ 1 ms.
  - Lexicon draws: nodes × 100 × few ≈ 30k ≈ 3 ms.
  - Exposure and shift scan: S × 401 snapshots ≈ 600k reads ≈ 5–10 ms.
  - Exonyms: ≤ 4k `borrowWord` calls ≈ 10–20 ms.
  - Total ≈ +25–40 ms per assembly.
  - Incremental reuse across `advance()` calls (prefix-stable, like `featureMapCache`) is a later optimisation. Coordinate
    with `perf-efficiency.md`.
- **Sim year loop**: 0 (nothing runs in `step`).
- **Memory**: languages ≤ 160 rows; rules ≈ 160 × 15 = 2.4k rows (5 B each); lex rows ≈ nodes × 100 × 0.3 + loans ≈ 10k
  (strings ≈ 100 KB); speech ≈ S + splits + shifts ≈ 3k rows; nameForms ≈ 1.5k + 4k strings ≈ 120 KB. Total < 0.5 MB per
  history.
- **UI** cache: 8192 strings ≈ 300 KB.

---

## 11. Risks, open questions, verified vs assumed
**Verified [V]**:
- Names are generated at assembly, in `names-*` streams.
- Each tribe has a linear `(tribe, level)` language chain, with `deriveLanguage` doing unconditioned inventory shifts.
- Peoples never split.
- Renaming is a sim-time decision layer whose names are made at assembly.
- `settlementNameAt` / `withEventNames` exist.
- The UI imports sim/names modules.
- `contactYear` and the `polity` snapshots exist.
- `isEuphonic` rejects three-consonant runs, and so does `names.test.ts:83`.

**Measured [M]**: the §1.5 table; current-chain similarity saturating near 0.5; the prototype sound-change curves (μ = 3/5/8);
node counts for naive distance splits (69–293, many singletons) and overseas splits (8–19).

**Assumed [A]**: all `LANG` constants except `lambda`; the region/K gate keeping nodes at 40–100; the assembly cost; the
shift hazard form (share²).

**Risks**:
- (1) On-runs change every founding name (a different draw path). This is accepted behind the option, but players' saved
  seeds will show different names. Consider defaulting `language: true` only for new histories, keyed by a version.
- (2) Mergers and near-duplicates in a node: if the harness exceeds its target, block a rule for a word whose output equals
  another living name of the node.
- (3) Over-erosion of short names: the min-letter block, plus a cap of 2 deletion rules per word per millennium.
- (4) A circularity of "main node of a people": define it as the node of the people's largest polity capital, else its
  largest town, computed per 50-year bin.
- (5) The epoch fold may rebuild panels ~600 times per scrub across a run. If that is too often, coarsen it to rule years
  of nodes that have visible towns.
- (6) Glottochronology is contested (see §2). The harness checks the implementation against the target, not reality.

**Open questions**:
- Should polity, house and faith names also be said in the period's form (`surface` at view year), or stay as coined?
  Proposed: coined (historical documents keep spellings), with only settlements and features drifting.
- Should a written standard (an empire's capital dialect) slow change? That would be a rate multiplier for the node of a
  long-lived Empire capital (Latin-like fossilisation of the Legend register).
- Should a people's English ethnonym follow its main node's name?

## Owner decisions (2026-11-26)
- Approved: language drift on by default for NEW worlds only; existing seeds/links keep current names unless the user opts in.

---

## References (citation audit 2026-11-26)
Tags: **[verified]** means a page confirming the citation and the claim was opened this session. **[verified: citation]**
means the record was confirmed but the specific claim was not on the page read. **[unverified]** gives the reason. Every
`LANG` value except `lambda` is a design default (tagged [A] in §3.4).

1. Alba, R., Logan, J., Lutz, A., & Stults, B. (2002). Only English by the third generation? Loss and preservation of the mother tongue among the grandchildren of contemporary immigrants. *Demography* 39(3), 467–484. https://link.springer.com/content/pdf/10.1353/dem.2002.0023.pdf [verified: the three-generation model, which it does not credit to Fishman on the page read]
2. Bergsland, K., & Vogt, H. (1962). On the validity of glottochronology. *Current Anthropology* 3(2), 115–153. https://asjp.clld.org/sources/9269 [verified: citation. The Icelandic ~4 % vs Riksmål ~20 % figures are from Wikipedia, "Glottochronology"; the East 53.7 % / West 97.2 % Greenlandic figures are from Guy 1982. The issue number is recalled]
3. Blust, R. (2000). Why lexicostatistics doesn't work: the "universal constant" hypothesis and the Austronesian languages. In C. Renfrew, A. McMahon & L. Trask (eds.), *Time Depth in Historical Linguistics*, vol. 2, 311–331. Cambridge: McDonald Institute for Archaeological Research. https://concepticon.clld.org/sources/Blust2000 [verified: citation. The subtitle is recalled. The "many-fold variation" claim is unverified because the chapter was not opened]
4. Dolgopolsky, A. B. (1986 [Russian original 1964]). A probabilistic hypothesis concerning the oldest relationships among the language families of northern Eurasia. In V. V. Shevoroshkin (ed.), *Typology, Relationship and Time*, 27–50. Ann Arbor: Karoma. https://concepticon.clld.org/sources/Dolgopolsky1986 [verified: citation]
5. Drummond, A. J., Ho, S. Y. W., Phillips, M. J., & Rambaut, A. (2006). Relaxed phylogenetics and dating with confidence. *PLoS Biology* 4(5), e88. https://doi.org/10.1371/journal.pbio.0040088 [verified: relaxed clocks. The abstract does not name the lognormal model]
6. Gray, R. D., & Atkinson, Q. D. (2003). Language-tree divergence times support the Anatolian theory of Indo-European origin. *Nature* 426(6965), 435–439. https://doi.org/10.1038/nature02029 [verified: penalized-likelihood rate smoothing in r8s over an MCMC tree sample (Oxford ORA full text)]
7. Guy, J. B. M. (1982). Bases for new methods in glottochronology. In A. Halim, L. Carrington & S. A. Wurm (eds.), *Papers from the Third International Conference on Austronesian Linguistics*, vol. 1, Pacific Linguistics C-74, 283–314. https://openresearch-repository.anu.edu.au/server/api/core/bitstreams/b9da93e1-bb2e-4a35-add4-677b933dedc8/content [verified]
8. Tadmor, U., Haspelmath, M., & Taylor, B. (2010). Borrowability and the notion of basic vocabulary. *Diachronica* 27(2), 226–246. https://benjamins.com/online/ebop/publications/53924 [verified: finding and venue. The publisher summary listed Haspelmath first; the usual order is Tadmor, Haspelmath & Taylor, so check before printing]
9. Kisseberth, C. W. (1970). On the functional unity of phonological rules. *Linguistic Inquiry* 1(3), 291–306. Cited via Noske, https://rnoske.home.xs4all.nl/publications/Yawelmani.pdf [verified: citation and the "conspire" usage. The issue number is recalled]
10. Lees, R. B. (1953). The basis of glottochronology. *Language* 29(2), 113–127. https://isidore.co/misc/Physics%20papers%20and%20books/Zotero/storage/CQSZ6LBH/Lees%20-%201953%20-%20The%20Basis%20of%20Glottochronology.pdf [verified: k = 0.8048 ± 0.0176/millennium on a 215-word list]
11. Levenshtein, V. I. (1965). Binary codes capable of correcting deletions, insertions and reversals. *Doklady Akademii Nauk SSSR* 163(4), 845–848; English in *Soviet Physics Doklady* 10(8), 707–710 (1966). https://en.wikipedia.org/wiki/Levenshtein_distance [verified: citation via Wikipedia]
12. Osthoff, H., & Brugmann, K. (1878). Vorwort. *Morphologische Untersuchungen auf dem Gebiete der indogermanischen Sprachen* 1, iii–xx. https://en.wikipedia.org/wiki/Neogrammarian [verified: via Wikipedia]
13. Pagel, M., Atkinson, Q. D., & Meade, A. (2007). Frequency of word-use predicts rates of lexical evolution throughout Indo-European history. *Nature* 449(7163), 717–720. https://doi.org/10.1038/nature06176 [verified]
14. Swadesh, M. (1955). Towards greater accuracy in lexicostatistic dating. *International Journal of American Linguistics* 21(2), 121–137. https://doi.org/10.1086/464321 [verified: citation via concepticon. The 0.86/millennium (≈14 words per 100) rate is from Wikipedia, "Glottochronology". The DOI comes from the search-result URL; the publisher page failed to load]
15. Fishman, J. A. (1991). *Reversing Language Shift*. Clevedon: Multilingual Matters. https://doi.org/10.21832/9781800418097 [verified: book. **Not** confirmed as the source of a three-generation rule, so the plan no longer credits it]
16. Wikipedia, "River Avon" (afon = river), "Cologne" (Colonia), "Vienna" (Wien, from the river name), all fetched 2026-11-26. https://en.wikipedia.org/wiki/River_Avon, https://en.wikipedia.org/wiki/Cologne, https://en.wikipedia.org/wiki/Vienna [verified]
