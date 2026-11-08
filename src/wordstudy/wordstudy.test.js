import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normStrong, translationRing, markStrong } from './wordstudy.js'

test('normStrong', () => {
	assert.equal(normStrong('H07225'), 'H7225')
	assert.equal(normStrong('strong:g0026'), 'G26')
	assert.equal(normStrong('G26'), 'G26')
	assert.equal(normStrong('love'), null)
})

// minimal stand-in for DOMParser: enough for querySelectorAll('.phos-w[data-lemma]') on render.js output
const parse = html => ({
	querySelectorAll: () => [...html.matchAll(/<span class="phos-w[^"]*" data-lemma="([^"]*)"[^>]*>([^<]*)<\/span>/g)]
		.map(m => ({ getAttribute: () => m[1], textContent: m[2] })),
})
const w = (lemma, text) => `<span class="phos-w" data-lemma="${lemma}" data-morph="">${text}</span>`

test('translation ring counts renderings of one number, case-folded, punctuation stripped', () => {
	const hits = [
		{ id: 'a', html: w('G26', 'Liebe') + ' ' + w('G2316', 'Gott') },
		{ id: 'b', html: w('G0026', 'Liebe,') },
		{ id: 'c', html: w('G26 G3588', 'liebe') + w('G26', 'Agape') },
	]
	const ring = translationRing(hits, 'G26', parse)
	assert.deepEqual(ring.map(r => [r.word, r.count]), [['Liebe', 3], ['Agape', 1]])
	assert.deepEqual([...ring[0].verses], ['a', 'b', 'c'])
})

test('markStrong adds the hit class only to matching words', () => {
	const out = markStrong(w('H07225', 'Anfang') + w('H430', 'Gott'), 'H7225')
	assert.match(out, /class="phos-w phos-ws-hit" data-lemma="H07225"/)
	assert.match(out, /class="phos-w" data-lemma="H430"/)
})
