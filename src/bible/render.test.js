import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOMParser } from 'linkedom'
import { render } from './render.js'

globalThis.DOMParser = DOMParser

test('OSIS: headings, notes, words of Jesus, Strong\'s, references', () => {
	const r = render('<div type="x-milestone" subType="x-preverse" sID="pv1"/><title type="x-s3">Die Schöpfung</title><div eID="pv1"/>'
		+ '<w lemma="strong:H07225" morph="oshm:HR">Im Anfang</w> schuf <note type="study" n="a">Oder: <hi type="italic">als</hi></note>'
		+ '<q who="Jesus" marker="">Ich bin</q> <reference osisRef="John.12.47">Joh 12,47</reference>'
		+ '<note type="crossReference"><reference osisRef="Ps.33.6">Ps 33,6</reference></note>')
	assert.deepEqual(r.headings, ['Die Schöpfung'])
	assert.match(r.html, /^<span class="phos-w" data-lemma="H07225" data-morph="oshm:HR">Im Anfang<\/span> schuf <sup class="phos-note" data-note="n\d+" tabindex="0">a<\/sup>/)
	assert.match(r.html, /<span class="phos-jesus">Ich bin<\/span>/)
	assert.match(r.html, /<a class="phos-ref" data-ref="John.12.47" href="#">Joh 12,47<\/a>/)
	assert.equal(r.notes.length, 2)
	assert.equal(r.notes[0].html, 'Oder: <i>als</i>')
	assert.equal(r.notes[1].type, 'xref')
	assert.match(r.notes[1].html, /data-ref="Ps.33.6"/)
})

test('nothing unlisted gets through', () => {
	const r = render('<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>'
		+ '<b onclick="alert(1)">fett</b> a < b & c <iframe src="//evil"></iframe>')
	assert.doesNotMatch(r.html, /script|onerror|onclick|javascript|iframe|<img/i)
	assert.match(r.html, /<b>fett<\/b> a &lt; b &amp; c/)
})

test('ThML and TEI dictionary entries', () => {
	const t = render('<a name="00026">26</a> <b>ἀγάπη</b> from <a href="sword://StrongsRealGreek/00025">25</a><br/>love', { sourceType: 'ThML' })
	assert.match(t.html, /<b>ἀγάπη<\/b> from <a class="phos-dict" data-module="StrongsRealGreek" data-key="00025" href="#">25<\/a><br>love/)
	const e = render('<entry><orth>agape</orth> <def>love</def> <title>Ein Buch</title></entry>', { sourceType: 'TEI' })
	assert.equal(e.html, '<b>agape</b> love <i>Ein Buch</i>')
	assert.deepEqual(e.headings, [])
})

test('poetry lines and line breaks', () => {
	const r = render('<l level="1">Der HERR ist mein Hirte,</l><l level="2"><divineName>Herr</divineName> mir</l><lb/>Ende')
	assert.equal(r.html, '<span class="phos-l">Der HERR ist mein Hirte,</span><br><span class="phos-l"><span class="phos-divine">Herr</span> mir</span><br><br>Ende')
})
