/**
 * Book names and reference parsing (port of unit_verseref.pas).
 * Books are OSIS ids; KJV_ORDER is the 66-book order whose index desktop
 * bookmarks carry as `bookIdx`.
 */
export const KJV_ORDER = [
	'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam',
	'1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov',
	'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos',
	'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
	'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph',
	'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas',
	'1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev',
]

// German full name first (display), then abbreviations; English names come from the server.
const ALIASES = {
	Gen: 'Genesis|1. Mose|1Mose|1Mo|1M|Gen|Ge|First Moses',
	Exod: 'Exodus|2. Mose|2Mose|2Mo|2M|Ex|Exod',
	Lev: 'Levitikus|3. Mose|3Mose|3Mo|3M|Lev|Le',
	Num: 'Numeri|4. Mose|4Mose|4Mo|4M|Num|Nu',
	Deut: 'Deuteronomium|5. Mose|5Mose|5Mo|5M|Dtn|Dt|Deut|Deu|Deuteronomy',
	Josh: 'Josua|Jos|Joshua|Josh',
	Judg: 'Richter|Ri|Judges|Judg|Jdg|Jdc',
	Ruth: 'Rut|Ruth|Rt|Ru',
	'1Sam': '1. Samuel|1Samuel|1Sam|1Sa|First Samuel',
	'2Sam': '2. Samuel|2Samuel|2Sam|2Sa|Second Samuel',
	'1Kgs': '1. Könige|1Koenige|1Koen|1Kge|1Kgs|1Ki|1Kö|1Könige|1Kön|First Kings',
	'2Kgs': '2. Könige|2Koenige|2Koen|2Kge|2Kgs|2Ki|2Kö|2Könige|2Kön|Second Kings',
	'1Chr': '1. Chronik|1Chronik|1Chr|1Ch|First Chronicles',
	'2Chr': '2. Chronik|2Chronik|2Chr|2Ch|Second Chronicles',
	Ezra: 'Esra|Esr|Ezra|Ezr|Ezd',
	Neh: 'Nehemia|Neh|Ne|Nehemiah',
	Esth: 'Ester|Esther|Est|Es',
	Job: 'Hiob|Ijob|Hi|Ijb|Job|Jb',
	Ps: 'Psalm|Psalmen|Ps|Psa|Pss|Psalms',
	Prov: 'Sprüche|Sprueche|Sprichwoerter|Spr|Sprw|Proverbs|Prov|Pro|Pr',
	Eccl: 'Prediger|Kohelet|Pred|Koh|Ecclesiastes|Eccl|Qoh|Ec',
	Song: 'Hoheslied|Hohelied|Hld|Hl|Song of Solomon|Song of Songs|Song|SOS|Canticles|Cant',
	Isa: 'Jesaja|Jes|Isaiah|Isa|Is',
	Jer: 'Jeremia|Jer|Jeremiah|Jr',
	Lam: 'Klagelieder|Klgl|Klag|Threni|Lamentations|Lam|La',
	Ezek: 'Hesekiel|Ezechiel|Hes|Ez|Ezekiel|Ezek|Eze',
	Dan: 'Daniel|Dan|Dn|Da',
	Hos: 'Hosea|Hos|Ho',
	Joel: 'Joel|Joe|Jol|Jl',
	Amos: 'Amos|Am|Amo',
	Obad: 'Obadja|Obd|Ob|Obadiah|Obad|Oba',
	Jonah: 'Jona|Jon|Jonah|Jnh',
	Mic: 'Micha|Mi|Mic|Micah|Mch',
	Nah: 'Nahum|Nah|Na|Nam',
	Hab: 'Habakuk|Hab|Habakkuk|Hbk',
	Zeph: 'Zefanja|Zephanja|Zef|Zeph|Zephaniah|Zep',
	Hag: 'Haggai|Hag|Hgg|Hg',
	Zech: 'Sacharja|Sach|Sac|Zechariah|Zech|Zec|Za',
	Mal: 'Maleachi|Mal|Malachi|Ml',
	Matt: 'Matthäus|Matthaeus|Matth|Mt|Matt|Mat|MtEv|Matthew',
	Mark: 'Markus|Mk|Mark|Mar|Mr|MkEv',
	Luke: 'Lukas|Lk|Luk|Luke|Lu|LkEv|Lukasevangelium',
	John: 'Johannes|Joh|Jh|John|Jn|Jo|JohEv|Johannesevangelium',
	Acts: 'Apostelgeschichte|Apg|Apostelg|Acts|Act|Ac',
	Rom: 'Römer|Roemer|Roem|Röm|Rom|Romans|Ro|Rm',
	'1Cor': '1. Korinther|1Korinther|1Kor|1Ko|1Co|1Cor|First Corinthians',
	'2Cor': '2. Korinther|2Korinther|2Kor|2Ko|2Co|2Cor|Second Corinthians',
	Gal: 'Galater|Gal|Galatians|Ga',
	Eph: 'Epheser|Eph|Ephesians|Ep',
	Phil: 'Philipper|Phil|Php|Philippians|Pp',
	Col: 'Kolosser|Kol|Col|Colossians|Cl',
	'1Thess': '1. Thessalonicher|1Thessalonicher|1Thess|1Thes|1Th|1Te|First Thessalonians',
	'2Thess': '2. Thessalonicher|2Thessalonicher|2Thess|2Thes|2Th|2Te|Second Thessalonians',
	'1Tim': '1. Timotheus|1Timotheus|1Tim|1Ti|First Timothy',
	'2Tim': '2. Timotheus|2Timotheus|2Tim|2Ti|Second Timothy',
	Titus: 'Titus|Tit|Tt',
	Phlm: 'Philemon|Phlm|Phm|Phlmn|Pm',
	Heb: 'Hebräer|Hebraeer|Hebr|Heb|Hbr|Hebrews|He',
	Jas: 'Jakobus|Jak|Jas|Jam|James|Jc',
	'1Pet': '1. Petrus|1Petrus|1Petr|1Pet|1Pe|1Pt|First Peter',
	'2Pet': '2. Petrus|2Petrus|2Petr|2Pet|2Pe|2Pt|Second Peter',
	'1John': '1. Johannes|1Johannes|1Joh|1Jn|1Jo|First John',
	'2John': '2. Johannes|2Johannes|2Joh|2Jn|2Jo|Second John',
	'3John': '3. Johannes|3Johannes|3Joh|3Jn|3Jo|Third John',
	Jude: 'Judas|Jud|Jude|Jd|Jds',
	Rev: 'Offenbarung|Offb|Apokalypse|Apk|Revelation|Rev|Re|Apoc',
	// deuterocanonical books of the Luther/Catholic/KJVA systems
	Tob: 'Tobit|Tob|Tobias|Tb',
	Jdt: 'Judit|Judith|Jdt',
	Wis: 'Weisheit|Weish|Wsh|Wisdom|Wis',
	Sir: 'Jesus Sirach|Sirach|Sir|Ecclesiasticus',
	Bar: 'Baruch|Bar',
	EpJer: 'Brief des Jeremia|BrJer|EpJer',
	'1Macc': '1. Makkabäer|1Makk|1Mak|1Macc|1Ma',
	'2Macc': '2. Makkabäer|2Makk|2Mak|2Macc|2Ma',
	'3Macc': '3. Makkabäer|3Makk|3Macc',
	'4Macc': '4. Makkabäer|4Makk|4Macc',
	AddEsth: 'Stücke zu Ester|StEst|AddEsth',
	AddDan: 'Stücke zu Daniel|StDan|AddDan',
	PrAzar: 'Gebet Asarjas|PrAzar',
	Sus: 'Susanna|Sus',
	Bel: 'Bel und der Drache|Bel',
	PrMan: 'Gebet Manasses|GebMan|PrMan',
	'1Esd': '3. Esra|1Esd',
	'2Esd': '4. Esra|2Esd',
	Ps151: 'Psalm 151|Ps151',
}

export function normalize(s) {
	return String(s).toLowerCase()
		.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
		.replace(/[^a-z0-9]/g, '')
}

const LOOKUP = new Map()
for (const [osis, list] of Object.entries(ALIASES)) {
	for (const a of [osis, ...list.split('|')]) {
		const n = normalize(a)
		if (n && !LOOKUP.has(n)) {
			LOOKUP.set(n, osis)
		}
	}
}

/** Adds a module's own book name (e.g. its display name) as an alias. */
export function registerBookName(osis, name) {
	const n = normalize(name)
	if (n && !LOOKUP.has(n)) {
		LOOKUP.set(n, osis)
	}
}

export function bookFromToken(token) {
	return LOOKUP.get(normalize(token)) ?? null
}

/** Display name: German when the UI is German, else the versification's English name. */
export function bookName(osis, lang = 'de', englishName = null) {
	if (lang.startsWith('de') && ALIASES[osis]) {
		return ALIASES[osis].split('|')[0]
	}
	return englishName || ALIASES[osis]?.split('|').find(a => /^[A-Z1-4][a-z ]/.test(a) && a.length > 3) || osis
}

/** Every way a book is written (German and English names, abbreviations), for finding citations. */
export function bookNames(osis) {
	return [...new Set([...(ALIASES[osis] || '').split('|').filter(Boolean), osis])]
}

/** Books whose alias starts with what was typed (suggestions). */
export function suggestBooks(prefix, available = null) {
	const p = normalize(splitRef(prefix)[0])
	if (!p) {
		return []
	}
	const out = new Set()
	for (const [alias, osis] of LOOKUP) {
		if (alias.startsWith(p) && (!available || available.includes(osis))) {
			out.add(osis)
		}
	}
	const order = available || KJV_ORDER
	return [...out].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

/** "Lk 4,8" → ["Lk", "4,8"]: the book token ends with the last letter. */
export function splitRef(input) {
	const s = String(input).trim()
	let last = -1
	for (let i = 0; i < s.length; i++) {
		if (/\p{L}/u.test(s[i])) {
			last = i
		}
	}
	return last < 0 ? ['', s] : [s.slice(0, last + 1).trim(), s.slice(last + 1).trim()]
}

/**
 * Parses "Joh 3,16", "Joh 3:16-18", "Röm 1,1–2,5", "Ps 23", "1. Mose 1" and
 * OSIS refs "John.3.16", "Luke.4.18-Luke.4.21", "Gen.1".
 * v = 0: whole chapter. Returns null when the book is unknown.
 * @return {{book: string, c1: number, v1: number, c2: number, v2: number}|null}
 */
export function parseRef(input) {
	const s = String(input).trim().replace(/[–—]/g, '-')
	const osis = /^([1-4]?\p{L}+)\.(\d+)(?:\.(\d+))?(?:-(?:([1-4]?\p{L}+)\.)?(\d+)(?:\.(\d+))?)?$/u.exec(s)
	if (osis) {
		const book = bookFromToken(osis[1])
		if (!book) {
			return null
		}
		const c1 = +osis[2]
		const v1 = osis[3] ? +osis[3] : 0
		let c2 = c1
		let v2 = v1
		if (osis[5]) {
			if (osis[6]) {
				c2 = +osis[5]
				v2 = +osis[6]
			} else if (osis[4] || !osis[3]) {
				c2 = +osis[5]
				v2 = 0
			} else {
				v2 = +osis[5]
			}
		}
		return { book, c1, v1, c2, v2 }
	}
	const [bookPart, num] = splitRef(s)
	const book = bookFromToken(bookPart)
	if (!book) {
		return null
	}
	const m = /^(\d+)?(?:\s*[:,.]\s*(\d+))?(?:\s*-\s*(\d+)(?:\s*[:,.]\s*(\d+))?)?/.exec(num)
	const c1 = m?.[1] ? +m[1] : 1
	const v1 = m?.[2] ? +m[2] : 0
	let c2 = c1
	let v2 = v1
	if (m?.[3]) {
		if (m[4]) {
			c2 = +m[3]
			v2 = +m[4]
		} else if (v1) {
			v2 = +m[3]
		} else {
			c2 = +m[3]
			v2 = 0
		}
	}
	return { book, c1, v1, c2, v2 }
}

/** Short label like "Joh 3,16-18" / "Gen 1". */
export function formatRef({ book, c1, v1, c2, v2 }, lang = 'de', englishName = null) {
	const name = bookName(book, lang, englishName)
	const sep = lang.startsWith('de') ? ',' : ':'
	let s = `${name} ${c1}`
	if (v1) {
		s += `${sep}${v1}`
	}
	if (c2 !== c1) {
		s += `-${c2}` + (v2 ? `${sep}${v2}` : '')
	} else if (v2 && v2 !== v1) {
		s += `-${v2}`
	}
	return s
}
