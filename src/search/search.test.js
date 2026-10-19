import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fold, parseQuery } from './fold.js'
import { searchItems, htmlText, snippet } from './notes.js'
import { highlight } from './highlight.js'

test('fold like the server index', () => {
	assert.equal(fold('Größte ἀγάπη'), 'grosste αγαπη')
	assert.equal(fold('בְּרֵאשִׁית'), 'בראשית')
})

test('query parsing', () => {
	assert.deepEqual(parseQuery('Glaube "im Anf*" -Werke G0026 h430'), {
		words: ['glaube'], phrases: [['im', 'anf*']], strongs: ['G26', 'H430'], not: ['werke'],
	})
})

test('notes search', () => {
	const items = [
		{ id: 1, text: 'Die Liebe ist langmütig und freundlich' },
		{ id: 2, text: 'Glaube, Hoffnung, Liebe' },
		{ id: 3, text: 'Über den Glauben' },
	]
	assert.deepEqual(searchItems(items, 'liebe').map(i => i.id), [1, 2])
	assert.deepEqual(searchItems(items, 'glaub* liebe').map(i => i.id), [2])
	assert.deepEqual(searchItems(items, 'glaub* liebe', 'any').map(i => i.id), [1, 2, 3])
	assert.deepEqual(searchItems(items, '"hoffnung liebe"').map(i => i.id), [2])
	assert.deepEqual(searchItems(items, '"liebe hoffnung"').map(i => i.id), [])
	assert.deepEqual(searchItems(items, 'liebe -glaube').map(i => i.id), [1])
	assert.deepEqual(searchItems(items, 'uber').map(i => i.id), [3])
	assert.deepEqual(searchItems(items, '').map(i => i.id), [])
})

test('desktop html notes and snippets', () => {
	assert.equal(htmlText('<p>Eins&nbsp;&amp; <b>zwei</b></p><p>drei&#228;&#xFC;</p>'), 'Eins & zwei\ndreiäü')
	assert.equal(htmlText('&amp;lt;'), '&lt;')
	const long = 'a '.repeat(200) + 'Treffer ' + 'b '.repeat(200)
	const s = snippet(long, ['treffer'])
	assert.ok(s.includes('Treffer') && s.startsWith('… ') && s.endsWith(' …'))
})

test('highlight words and Strong\'s', () => {
	assert.equal(highlight('Im <i>Anfang</i> schuf &quot;Gott&quot;', { terms: ['anf*', 'gott'] }),
		'Im <i><mark>Anfang</mark></i> schuf &quot;<mark>Gott</mark>&quot;')
	assert.equal(highlight('<span class="phos-w" data-lemma="strong:G0026">love</span> <span class="phos-w" data-lemma="strong:G260">x</span>', { strongs: ['G26'] }),
		'<span class="phos-w phos-hit" data-lemma="strong:G0026">love</span> <span class="phos-w" data-lemma="strong:G260">x</span>')
	assert.equal(highlight('<a href="x" title="Gott">Gott</a>', { terms: ['gott'] }), '<a href="x" title="Gott"><mark>Gott</mark></a>')
})
