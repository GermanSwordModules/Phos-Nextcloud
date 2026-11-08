import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportBookmarks } from './export.js'

const fmt = {
	ref: bm => bm.ref,
	labels: bm => bm.labelNames || [],
	date: () => '7.11.2026',
	note: bm => bm.noteMd || '',
}
const list = [
	{ ref: 'Joh 3,16', labelNames: ['Gebet'], snippetText: 'Also hat Gott', noteMd: 'eins\nzwei' },
	{ ref: 'Ps 23,1', noteMd: '<b>x</b>' },
]

test('markdown has a heading per bookmark, labels, quote and note', () => {
	const md = exportBookmarks(list, 'md', fmt, 'Lesezeichen')
	assert.match(md, /^# Lesezeichen/)
	assert.match(md, /## Joh 3,16\n\n`Gebet` · 7\.11\.2026\n\n> Also hat Gott\n\neins\nzwei/)
	assert.match(md, /## Ps 23,1/)
})

test('html escapes note text and keeps line breaks', () => {
	const html = exportBookmarks(list, 'html', fmt, 'Lesezeichen')
	assert.match(html, /<h2>Joh 3,16<\/h2>/)
	assert.match(html, /eins<br>zwei/)
	assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/)
	assert.doesNotMatch(html, /<b>x<\/b>/)
})

test('plain text indents notes under the reference', () => {
	const txt = exportBookmarks(list, 'txt', fmt, 'Notizen')
	assert.match(txt, /^Notizen\n=======\n/)
	assert.match(txt, /Joh 3,16 {2}\[Gebet\] {2}7\.11\.2026\n {2}„Also hat Gott“\n {2}eins\n {2}zwei/)
})
