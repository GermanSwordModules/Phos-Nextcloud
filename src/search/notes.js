import { fold, parseQuery, words, termMatches } from './fold.js'

/** Text of a desktop note (HTML from RTF) without tags and entities. */
export function htmlText(html) {
	return String(html || '')
		.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, entity)
		.replace(/[ \t\u00a0]+/g, ' ')
		.trim()
}

const NAMED = { nbsp: '\u00a0', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }
let decoder = null
function entity(all, name) {
	if (name[0] === '#') {
		const n = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
		return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all
	}
	if (NAMED[name]) {
		return NAMED[name]
	}
	if (typeof document === 'undefined') {
		return all
	}
	decoder ??= document.createElement('textarea')
	decoder.innerHTML = all
	return decoder.value
}

/**
 * Notes search in the browser (W-4): every item is { text, ... }; a hit
 * has all words (prefix*), all phrases and none of the -excluded words —
 * or, mode "any", at least one word or phrase. Returns the hits with a
 * snippet around the first match.
 */
export function searchItems(items, query, mode = 'all') {
	const q = parseQuery(query)
	const wanted = [...q.words.map(w => [w]), ...q.phrases]
	if (!wanted.length) {
		return []
	}
	const out = []
	for (const it of items) {
		const ws = words(it.text)
		const has = seq => ws.some((_, i) => seq.every((t, j) => ws[i + j] !== undefined && termMatches(t, ws[i + j])))
		const ok = mode === 'any' ? wanted.some(has) : wanted.every(has)
		if (ok && !q.not.some(t => ws.some(w => termMatches(t, w)))) {
			out.push({ ...it, snippet: snippet(it.text, wanted.flat()) })
		}
	}
	return out
}

/** ~160 characters around the first matching word. */
export function snippet(text, terms, width = 160) {
	const s = String(text).replace(/\s+/g, ' ').trim()
	let at = -1
	for (const m of s.matchAll(/[\p{L}\p{N}]+/gu)) {
		const w = fold(m[0])
		if (terms.some(t => termMatches(t, w))) {
			at = m.index
			break
		}
	}
	if (s.length <= width) {
		return s
	}
	const from = Math.max(0, at - Math.floor(width / 3))
	return (from > 0 ? '… ' : '') + s.slice(from, from + width).trim() + (from + width < s.length ? ' …' : '')
}
