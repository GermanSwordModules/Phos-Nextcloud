import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rtfToHtml } from './rtf.js'
import { renderDeck, bulletsHtml, slideTextHtml, applyVerseSteps, parseOsisRange, themeVars, THEMES } from './deck.js'

// the shape RichMemo writes (desktop exegesis)
const RTF = String.raw`{\rtf1\ansi\ansicp1252\deff0\deflan1033{\fonttbl{\f0\fcharset0 Noto Sans;}}{\colortbl;\red136\green136\blue136;}`
	+ String.raw`\f0\fs16\b\cf1 \pard\li0\ri0\sb0 8 \f0\fs22\b0\cf0 Denn durch die Gnade seid ihr errettet;\f0\fs16\b\cf1 \par `
	+ String.raw`\pard\li0\ri0\sb0\fs22\b0\cf0 nicht aus Werken, damit niemand sich r\u252  hme \'84so\'93.\par `
	+ String.raw`\pard\fs44\b \u220?berschrift\par\pard\fs22\b0\i kursiv\i0  <script>x</script> & {\*\generator Riched20;}fertig\par}`

test('rtf: paragraphs, unicode with fallback, cp1252, colours, sizes, headings', () => {
	const h = rtfToHtml(RTF)
	assert.match(h, /^<p>/)
	assert.match(h, /color:rgb\(136,136,136\)/)
	assert.match(h, /<strong>8 <\/strong>/)
	assert.match(h, /rühme „so“\./, 'the \\u252 fallback char is skipped, \\\'84 is cp1252')
	assert.match(h, /<h3>Überschrift<\/h3>/, 'one big paragraph is a heading')
	assert.match(h, /<em>kursiv<\/em>/)
	assert.match(h, /&lt;script&gt;x&lt;\/script&gt; &amp; fertig/, 'text is escaped, \\* destination skipped')
	assert.doesNotMatch(h, /Noto Sans|Riched20/)
})

test('rtf: plain text and empty input', () => {
	assert.equal(rtfToHtml('a <b>\nc\n\nd'), '<p>a &lt;b&gt;<br>c</p><p>d</p>')
	assert.equal(rtfToHtml(''), '<p></p>')
})

test('deck: bullets nest one level, step bullets are fragments', () => {
	assert.equal(bulletsHtml('- eins\n  zwei\n- drei', 'bullet'),
		'<ul><li class="fragment">eins<ul><li class="fragment">zwei</li></ul></li><li class="fragment">drei</li></ul>')
	assert.equal(bulletsHtml('\tnur Unterpunkt', 'none'), '<ul><li>nur Unterpunkt</li></ul>')
})

test('deck: slide text — headings, quotes, lists, inline markdown, escaping', () => {
	assert.equal(slideTextHtml('# Titel\nZeile **fett**\nweiter *kursiv*\n\n> Zitat\n- a\n- b <i>'),
		'<h3 class="phos-h1">Titel</h3><p>Zeile <strong>fett</strong> weiter <em>kursiv</em></p><blockquote>Zitat</blockquote><ul><li>a</li><li>b &lt;i&gt;</li></ul>')
})

test('deck: verse steps and highlights', () => {
	const body = '<span class="verse" id="v8_1">a</span> <span class="verse" id="v8_2">b</span>'
	assert.equal(applyVerseSteps(body, 'verse', 'v8_2'),
		'<span class="fragment verse" id="v8_1">a</span> <span class="fragment phos-hl verse" id="v8_2">b</span>')
})

test('deck: OSIS ranges', () => {
	assert.deepEqual(parseOsisRange('Rom.8.1-Rom.8.4'), { book: 'Rom', c1: 8, v1: 1, c2: 8, v2: 4 })
	assert.deepEqual(parseOsisRange('Eph.4.22-32'), { book: 'Eph', c1: 4, v1: 22, c2: 4, v2: 32 })
	assert.deepEqual(parseOsisRange('1Kgs.16.1-1Kgs.17.24'), { book: '1Kgs', c1: 16, v1: 1, c2: 17, v2: 24 })
	assert.deepEqual(parseOsisRange('Rom.8.4-Rom.8.1'), { book: 'Rom', c1: 8, v1: 4, c2: 8, v2: 4 })
	assert.equal(parseOsisRange('Rom'), null)
})

test('deck: the desktop deck renders to sections with the desktop markup', async () => {
	const deck = {
		title: 'Gottesdienst', theme: 'Dunkel',
		slides: [
			{ id: 's1', title: 'T', blocks: [{ kind: 'title', text: 'Gottesdienst – 19. So. n. Trin.' }, { kind: 'subtitle', text: '11.10.2026' }] },
			{ id: 's2', layout: 'cols2', notes: 'Hier **langsam**', blocks: [
				{ kind: 'passage', module: 'ELB', osis: 'Eph.4.22-Eph.4.23', step: 'verse', opts: '{"quote":true}' },
				{ kind: 'image', image: '/home/x/phos/documents/presentations/d1/media/a.jpg', text: 'Bild' },
				{ kind: 'image', image: '/somewhere/else.png' },
				{ kind: 'capture', html: '<p onclick="x()">frozen</p><script>alert(1)</script>' },
			] },
			{ id: 's3', theme: 'Sepia', blocks: [{ kind: 'bullets', text: '- a', step: 'block' }] },
		],
	}
	const secs = await renderDeck(deck, {
		passage: async (m, osis) => ({ html: `<span class="verse" id="v4_22"><span class="phos-vnum">22</span>x</span> `, ref: 'Eph 4,22-23 ' + osis }),
		image: p => (p.includes('/d1/') ? '/files/d1/media/a.jpg' : null),
		sanitize: h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/ on\w+="[^"]*"/g, ''),
	})
	assert.equal(secs.length, 3)
	assert.match(secs[0], /^<section data-slide="s1" data-idx="0" class="phos-titleslide">/)
	assert.match(secs[1], /class="phos-fill"><div class="phos-slidebody phos-cols2">/)
	assert.match(secs[1], /phos-passage phos-quote/)
	assert.match(secs[1], /<span class="fragment verse" id="v4_22">/)
	assert.match(secs[1], /<img src="\/files\/d1\/media\/a.jpg" alt=""><div class="phos-caption">Bild<\/div>/)
	assert.match(secs[1], /Bild fehlt: else\.png/)
	assert.match(secs[1], /<div class="phos-block phos-capture"><p>frozen<\/p><\/div>/)
	assert.match(secs[1], /<aside class="notes"><p>Hier <strong>langsam<\/strong><\/p><\/aside>/)
	assert.match(secs[2], /data-theme="Sepia" style="--pres-bg:/)
	assert.match(secs[2], /<div class="fragment"><div class="phos-block phos-bullets">/)
	const v = themeVars(THEMES.Dunkel)
	assert.equal(v['--pres-bg'], THEMES.Dunkel.bg)
	assert.equal(v['--pres-base-size'], THEMES.Dunkel.baseSize + 'pt')
})
