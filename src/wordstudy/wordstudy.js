/** Word study on the web (desktop: unit_wordstudy.pas) -- the parts that need no lemmatizer. */

/** "H07225", "strong:g0026", "G26" -> "H7225" / "G26"; null when it is not a Strong's number. */
export function normStrong(s) {
	const m = /^(?:strong:)?([GH])0*(\d+)[a-z]?$/i.exec(String(s || '').trim())
	return m ? m[1].toUpperCase() + m[2] : null
}

export const isHebrew = strong => /^H/i.test(strong)

/**
 * The translation ring: how the words carrying `strong` are rendered in the given verses' HTML
 * (bible/render.js output, `.phos-w[data-lemma]`). Returns [{ word, count, verses: Set }],
 * most frequent first. `parse` turns an HTML string into a Document (DOMParser in the browser).
 */
export function translationRing(hits, strong, parse) {
	const want = normStrong(strong)
	const ring = new Map()
	for (const h of hits) {
		const doc = parse(h.html)
		for (const w of doc.querySelectorAll('.phos-w[data-lemma]')) {
			if (!w.getAttribute('data-lemma').split(/\s+/).some(l => normStrong(l) === want)) {
				continue
			}
			const word = w.textContent.trim().replace(/[.,;:!?“”„"'()]+$/g, '').replace(/^[“„"'(]+/, '')
			if (!word) {
				continue
			}
			const key = word.toLowerCase()
			const e = ring.get(key) ?? { word, count: 0, verses: new Set() }
			e.count++
			e.verses.add(h.id)
			ring.set(key, e)
		}
	}
	return [...ring.values()].sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
}

/** Marks the occurrences of `strong` in rendered verse HTML (adds the class phos-ws-hit). */
export function markStrong(html, strong) {
	const want = normStrong(strong)
	return html.replace(/<span class="phos-w" data-lemma="([^"]*)"/g, (m, lemma) =>
		lemma.split(/\s+/).some(l => normStrong(l) === want) ? `<span class="phos-w phos-ws-hit" data-lemma="${lemma}"` : m)
}
