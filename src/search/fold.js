/**
 * Words folded the way the server's search index does
 * (lib/Service/Sword/SearchIndex::tokens): lower case, ß = ss, no
 * diacritics (Greek accents, Hebrew points), letters and digits only.
 */
export function fold(s) {
	return String(s).toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{Mn}+/gu, '')
}

export function words(s) {
	return fold(s).match(/[\p{L}\p{N}]+/gu) || []
}

/**
 * The query as the server reads it: words (prefix*), "phrases", -excluded,
 * Strong's numbers. Phrases come back as lists of words.
 */
export function parseQuery(q) {
	const out = { words: [], phrases: [], strongs: [], not: [] }
	const terms = piece => {
		const w = words(piece)
		if (w.length && piece.endsWith('*')) {
			w[w.length - 1] += '*'
		}
		return w
	}
	for (const m of String(q).matchAll(/(-?)"([^"]*)"?|(\S+)/gu)) {
		if (m[3] === undefined) {
			const p = m[2].trim().split(/\s+/u).flatMap(terms)
			if (p.length === 1) {
				out[m[1] === '-' ? 'not' : 'words'].push(p[0])
			} else if (p.length && m[1] !== '-') {
				out.phrases.push(p)
			}
			continue
		}
		let t = m[3]
		const neg = t.length > 1 && t[0] === '-'
		if (neg) {
			t = t.slice(1)
		}
		const s = /^(?:strong:)?([GH])0*(\d+)[a-z]?$/i.exec(t)
		if (s) {
			if (!neg) {
				out.strongs.push(s[1].toUpperCase() + s[2])
			}
			continue
		}
		out[neg ? 'not' : 'words'].push(...terms(t))
	}
	return out
}

/** Does a folded word match a term (word or prefix*)? */
export function termMatches(term, w) {
	return term.endsWith('*') ? w.startsWith(term.slice(0, -1)) : w === term
}
