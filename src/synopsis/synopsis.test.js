import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pericopeAt, sourcesByGospel, rangeLabel, filterPericopes, title } from './synopsis.js'

const list = JSON.parse(readFileSync(new URL('./pericopes.json', import.meta.url)))
const bookOf = s => ({ mk: 'Mark', mark: 'Mark', mt: 'Matt', joh: 'John' })[s.trim()] || null

test('generated data: 355 pericopes, every one with at least one source', () => {
	assert.equal(list.length, 355)
	assert.ok(list.every(p => p.src.length && p.id && p.en))
})

test('pericopeAt finds the feeding of the 5000 in all four gospels', () => {
	const p = pericopeAt(list, 'John', 6, 5)
	assert.ok(p)
	assert.deepEqual(sourcesByGospel(p).map(x => x.gospel), ['Matt', 'Mark', 'Luke', 'John'])
})

test('rangeLabel', () => {
	assert.equal(rangeLabel({ c1: 4, v1: 1, c2: 4, v2: 9 }), '4,1–9')
	assert.equal(rangeLabel({ c1: 4, v1: 1, c2: 5, v2: 2 }), '4,1–5,2')
	assert.equal(rangeLabel({ c1: 4, v1: 3, c2: 4, v2: 3 }), '4,3')
})

test('filter by German title and by reference', () => {
	assert.ok(filterPericopes(list, 'wort', 'de').some(p => title(p, 'de') === 'Jesus ist das Wort'))
	const mk4 = filterPericopes(list, 'Mk 4,3', 'de', bookOf)
	assert.ok(mk4.length >= 1)
	assert.ok(mk4.every(p => p.src.some(s => s.book === 'Mark')))
})
