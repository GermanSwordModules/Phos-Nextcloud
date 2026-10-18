import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hlc, parseHlc } from './hlc.js'

const mem = () => { const m = new Map(); return { get: k => m.get(k), set: (k, v) => m.set(k, v) } }

test('format: 13 digits, lowercase counter, device', () => {
	const h = new Hlc('00000000000000ab', mem(), () => 1791200000000)
	assert.equal(h.tick(), '1791200000000-0000-00000000000000ab')
	assert.equal(h.tick(), '1791200000000-0001-00000000000000ab')
	for (let i = 0; i < 9; i++) h.tick()
	assert.match(h.tick(), /-000b-/)
})

test('observe moves past remote clocks ahead of the wall clock', () => {
	const h = new Hlc('00000000000000ab', mem(), () => 1000000000000)
	h.observe('1791200000000-0005-ffffffffffffffff')
	const next = h.tick()
	assert.ok(next > '1791200000000-0005-ffffffffffffffff', next)
})

test('persisted and never backwards', () => {
	const s = mem()
	let now = 1791200000000
	const a = new Hlc('00000000000000ab', s, () => now)
	const first = a.tick()
	now -= 60000
	const b = new Hlc('00000000000000ab', s, () => now)
	assert.ok(b.tick() > first)
	assert.equal(parseHlc('nope'), null)
})
