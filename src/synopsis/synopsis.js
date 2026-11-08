/** Gospel synopsis (desktop: unit_synopsis.pas, mobile: SynopsisData.kt) on the generated pericope list. */

export const GOSPELS = ['Matt', 'Mark', 'Luke', 'John']

export const title = (p, lang) => (String(lang).startsWith('de') && p.de) || p.en

export function inRange(s, c, v) {
	const at = c * 1000 + v
	return at >= s.c1 * 1000 + s.v1 && at <= s.c2 * 1000 + s.v2
}

/** The first pericope whose source in `book` contains chapter:verse (verse 0 = the chapter's start). */
export function pericopeAt(list, book, c, v) {
	return list.find(p => p.src.some(s => s.book === book && (v ? inRange(s, c, v) : s.c1 <= c && c <= s.c2))) || null
}

/** Sources in gospel order; a gospel with several ranges keeps them in the order given. */
export const sourcesByGospel = p => GOSPELS.map(g => ({ gospel: g, ranges: p.src.filter(s => s.book === g) })).filter(x => x.ranges.length)

export function rangeLabel(s) {
	if (s.c1 === s.c2) {
		return s.v1 === s.v2 ? `${s.c1},${s.v1}` : `${s.c1},${s.v1}–${s.v2}`
	}
	return `${s.c1},${s.v1}–${s.c2},${s.v2}`
}

/** Case-/accent-insensitive title match, or a reference like "Mk 4" / "Mark 4,3". */
export function filterPericopes(list, query, lang, bookOf) {
	const q = query.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
	if (!q) {
		return list
	}
	const m = /^(.+?)\s*(\d+)(?:[,:.](\d+))?$/.exec(q)
	if (m && bookOf) {
		const book = bookOf(m[1])
		if (GOSPELS.includes(book)) {
			return list.filter(p => p.src.some(s => s.book === book && (m[3] ? inRange(s, +m[2], +m[3]) : s.c1 <= +m[2] && +m[2] <= s.c2)))
		}
	}
	return list.filter(p => (title(p, lang) + ' ' + p.en).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q))
}
