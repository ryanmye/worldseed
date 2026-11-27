// =====================================================================================================================
// OWNER REVIEW (decision D-TS3): the name blocklist of typology worlds. Every list below is a draft for the owner to edit.
// =====================================================================================================================
// typology: a generated plain name (case- and diacritic-folded) is redrawn when a word of it EQUALS an entry of any list, or
// CONTAINS an entry of CONTAINS_BLOCK (slurs and profanity of 4+ letters). Real country names and major ethnonyms are blocked
// as whole words only, so ordinary invented words that merely contain them ("maliko", "perun") stay possible.
// Legacy (lang=0 and lang=1) worlds never consult this file, so their names are unchanged.

/** Sovereign states and a few well-known territories, in their common English short forms (whole-word matches). */
export const COUNTRIES: readonly string[] = [
  'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'antigua', 'argentina', 'armenia', 'australia', 'austria', 'azerbaijan',
  'bahamas', 'bahrain', 'bangladesh', 'barbados', 'belarus', 'belgium', 'belize', 'benin', 'bhutan', 'bolivia', 'bosnia', 'botswana',
  'brazil', 'brunei', 'bulgaria', 'burkina', 'burundi', 'cambodia', 'cameroon', 'canada', 'chad', 'chile', 'china', 'colombia',
  'comoros', 'congo', 'croatia', 'cuba', 'cyprus', 'czechia', 'denmark', 'djibouti', 'dominica', 'ecuador', 'egypt', 'eritrea',
  'estonia', 'eswatini', 'ethiopia', 'fiji', 'finland', 'france', 'gabon', 'gambia', 'georgia', 'germany', 'ghana', 'greece',
  'grenada', 'guatemala', 'guinea', 'guyana', 'haiti', 'honduras', 'hungary', 'iceland', 'india', 'indonesia', 'iran', 'iraq',
  'ireland', 'israel', 'italy', 'jamaica', 'japan', 'jordan', 'kazakhstan', 'kenya', 'kiribati', 'korea', 'kosovo', 'kuwait',
  'kyrgyzstan', 'laos', 'latvia', 'lebanon', 'lesotho', 'liberia', 'libya', 'liechtenstein', 'lithuania', 'luxembourg',
  'madagascar', 'malawi', 'malaysia', 'maldives', 'mali', 'malta', 'mauritania', 'mauritius', 'mexico', 'micronesia', 'moldova',
  'monaco', 'mongolia', 'montenegro', 'morocco', 'mozambique', 'myanmar', 'burma', 'namibia', 'nauru', 'nepal', 'netherlands',
  'holland', 'nicaragua', 'niger', 'nigeria', 'norway', 'oman', 'pakistan', 'palau', 'palestine', 'panama', 'paraguay', 'peru',
  'philippines', 'poland', 'portugal', 'qatar', 'romania', 'russia', 'rwanda', 'samoa', 'senegal', 'serbia', 'seychelles',
  'singapore', 'slovakia', 'slovenia', 'somalia', 'spain', 'sudan', 'suriname', 'sweden', 'switzerland', 'syria', 'taiwan',
  'tajikistan', 'tanzania', 'thailand', 'togo', 'tonga', 'trinidad', 'tobago', 'tunisia', 'turkey', 'turkiye', 'turkmenistan',
  'tuvalu', 'uganda', 'ukraine', 'emirates', 'britain', 'england', 'scotland', 'wales', 'america', 'uruguay', 'uzbekistan',
  'vanuatu', 'vatican', 'venezuela', 'vietnam', 'yemen', 'zambia', 'zimbabwe', 'greenland', 'tibet', 'tahiti', 'hawaii', 'guam',
  'macau', 'kurdistan', 'catalonia', 'bavaria', 'prussia', 'persia', 'siam', 'ceylon', 'zaire',
]

/** Major present-day ethnonyms and demonyms (whole-word matches). */
export const ETHNONYMS: readonly string[] = [
  'arab', 'arabs', 'turk', 'turks', 'kurd', 'kurds', 'persian', 'pashtun', 'tajik', 'uzbek', 'kazakh', 'mongol', 'tatar', 'han',
  'hui', 'uyghur', 'tibetan', 'manchu', 'korean', 'japanese', 'chinese', 'thai', 'lao', 'khmer', 'viet', 'burman', 'malay', 'javanese',
  'filipino', 'tamil', 'telugu', 'bengali', 'punjabi', 'gujarati', 'hindi', 'sindhi', 'sinhala', 'nepali', 'zulu', 'xhosa', 'yoruba',
  'igbo', 'hausa', 'fulani', 'amhara', 'oromo', 'somali', 'tigray', 'berber', 'amazigh', 'tuareg', 'maasai', 'kikuyu', 'ashanti',
  'swahili', 'shona', 'tswana', 'wolof', 'dinka', 'nuer', 'maori', 'samoan', 'tongan', 'aborigine', 'inuit', 'cree', 'navajo',
  'cherokee', 'sioux', 'apache', 'hopi', 'maya', 'aztec', 'inca', 'quechua', 'aymara', 'guarani', 'mapuche', 'roma', 'romani',
  'jew', 'jews', 'jewish', 'hebrew', 'slav', 'slavs', 'russian', 'polish', 'czech', 'serb', 'croat', 'bosniak', 'greek', 'german',
  'french', 'english', 'irish', 'scots', 'welsh', 'dutch', 'danish', 'swede', 'finn', 'sami', 'basque', 'italian', 'spanish',
  'latino', 'hispanic', 'yankee', 'gypsy', 'eskimo', 'pygmy', 'hottentot', 'bushman',
]

/** Slurs and profanity in English and other widely read languages: blocked as whole words and as parts of words (4+ letters). */
export const CONTAINS_BLOCK: readonly string[] = [
  'fuck', 'shit', 'cunt', 'piss', 'cock', 'dick', 'twat', 'wank', 'slut', 'whore', 'bitch', 'bastard', 'arse', 'tits', 'boob',
  'nigg', 'nigr', 'negro', 'kike', 'spic', 'chink', 'gook', 'wetback', 'coon', 'paki', 'raghead', 'towelhead', 'kaffir', 'kafir',
  'fagg', 'dyke', 'tranny', 'retard', 'spaz', 'rape', 'nazi', 'hitler', 'porn', 'anal', 'anus', 'penis', 'vagina', 'scrot',
  'merde', 'puta', 'puto', 'cono', 'mierda', 'cazzo', 'fica', 'figa', 'scheiss', 'fotze', 'kurwa', 'blyat', 'pizda', 'suka',
  'chuj', 'huevon', 'pendejo', 'culo', 'kuso', 'mumu', 'sikis', 'orospu',
]
/** Short profanity and slurs, blocked as whole words only (they are too common inside invented words). */
export const WORD_BLOCK: readonly string[] = ['ass', 'fag', 'cum', 'jap', 'wop', 'kak', 'fut', 'poo', 'pee', 'sex', 'god', 'allah', 'jesus', 'christ']

const whole = new Set<string>([...COUNTRIES, ...ETHNONYMS, ...CONTAINS_BLOCK, ...WORD_BLOCK])

/** Whether a plain name (any case; diacritics folded) is blocked (see the file comment). */
export function blocked(name: string): boolean {
  const lc = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/'/g, '')
  for (const w of lc.split(/[ -]/)) {
    if (!w) continue
    if (whole.has(w)) return true
    for (const b of CONTAINS_BLOCK) if (w.includes(b)) return true
  }
  return false
}
