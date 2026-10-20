// The web sync engine against a real server (dev container):
//   PHOS_URL=http://127.0.0.1:8090 PHOS_ADMIN=admin PHOS_ADMIN_PW=phos-dev-pw node --test tests/web/engine.live.test.js
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { SyncEngine } from '../../src/sync/engine.js'

const BASE = process.env.PHOS_URL || 'http://127.0.0.1:8090'
const ADMIN = [process.env.PHOS_ADMIN || 'admin', process.env.PHOS_ADMIN_PW || 'phos-dev-pw']
const run = Math.random().toString(16).slice(2, 8)
const user = [`web${run}`, `Web-pw-${run}-x9!Q`]

function http([u, p]) {
	const auth = 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64')
	const call = async (method, path, body, params) => {
		const qs = params ? '?' + new URLSearchParams(params) : ''
		const r = await fetch(`${BASE}/ocs/v2.php/apps/phos/api/v1${path}${qs}`, {
			method,
			headers: { 'OCS-APIRequest': 'true', Accept: 'application/json', Authorization: auth, 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		})
		const j = await r.json()
		if (!r.ok) {
			throw Object.assign(new Error(`${method} ${path}: ${r.status}`), { status: r.status, data: j })
		}
		return j.ocs.data
	}
	return { get: (p, params) => call('GET', p, undefined, params), post: (p, b) => call('POST', p, b), del: p => call('DELETE', p) }
}

const mem = () => { const m = new Map(); return { get: k => m.get(k), set: (k, v) => m.set(k, String(v)) } }

before(async () => {
	const auth = 'Basic ' + Buffer.from(ADMIN.join(':')).toString('base64')
	const r = await fetch(`${BASE}/ocs/v2.php/cloud/users`, {
		method: 'POST',
		headers: { 'OCS-APIRequest': 'true', Accept: 'application/json', Authorization: auth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ userid: user[0], password: user[1] }),
	})
	assert.ok(r.ok, 'create user')
})

const bm = (id, extra = {}) => ({
	id, kind: 'verse', bookOsis: 'John', bookIdx: 42, chap: 3, vStart: 16, vEnd: 16,
	labelNames: [], sortOrder: 0, created: 1791200000, modified: 1791200000, ...extra,
})

test('two web devices: create, merge notes and labels, delete', async () => {
	const a = new SyncEngine({ http: http(user), storage: mem(), deviceName: 'A' })
	const b = new SyncEngine({ http: http(user), storage: mem(), deviceName: 'B' })
	await a.start('test')
	await b.start('test')
	assert.ok(/^[0-9a-f]{16}$/.test(a.device) && a.device !== b.device)

	await a.write('label', 'label:Gebet', { name: 'Gebet', color: '#ff0000', style: 'fill', iconId: 'bookmark', favorite: false, actionBar: false, autoAssign: false })
	await a.write('bookmark', 'bm:x1', bm('x1', { noteMd: 'eins\nzwei\ndrei' }))
	assert.equal(a.state.outbox, 0)
	await b.sync()
	assert.equal(b.get('bookmark', 'bm:x1').payload.noteMd, 'eins\nzwei\ndrei')

	// concurrent edits of different lines and different labels merge on the server
	await a.write('bookmark', 'bm:x1', bm('x1', { noteMd: 'EINS\nzwei\ndrei', labelNames: ['Gebet'] }))
	await b.write('bookmark', 'bm:x1', bm('x1', { noteMd: 'eins\nzwei\nDREI', labelNames: ['Dank'] }))
	await a.sync()
	const merged = a.get('bookmark', 'bm:x1').payload
	assert.equal(merged.noteMd, 'EINS\nzwei\nDREI')
	assert.deepEqual([...merged.labelNames].sort(), ['Dank', 'Gebet'])

	// the same line changed on both → conflict, theirs kept, resolvable
	await a.write('bookmark', 'bm:x1', bm('x1', { ...merged, noteMd: 'A\nzwei\nDREI' }))
	await b.write('bookmark', 'bm:x1', bm('x1', { ...b.get('bookmark', 'bm:x1').payload, noteMd: 'B\nzwei\nDREI' }))
	assert.equal(b.state.conflicts.length, 1)
	assert.equal(b.get('bookmark', 'bm:x1').payload.noteMd, 'A\nzwei\nDREI')
	await b.resolveConflict(b.state.conflicts[0].id, 'conflict', { ...b.state.conflicts[0].payload, noteMd: 'A und B\nzwei\nDREI' })
	await a.sync()
	assert.equal(a.get('bookmark', 'bm:x1').payload.noteMd, 'A und B\nzwei\nDREI')
	assert.equal(b.state.conflicts.length, 0)

	await b.write('bookmark', 'bm:x1', null)
	await a.sync()
	assert.equal(a.get('bookmark', 'bm:x1'), null)
	assert.equal(a.list('bookmark').length, 0)
	assert.equal(a.list('label').length, 1)
})

test('offline edits wait in the outbox and survive a reload', async () => {
	const storage = mem()
	const real = http(user)
	let down = true
	const flaky = {
		get: (...x) => real.get(...x),
		del: (...x) => real.del(...x),
		post: (p, body) => (down && p === '/push') ? Promise.reject(Object.assign(new Error('offline'), { network: true })) : real.post(p, body),
	}
	const a = new SyncEngine({ http: flaky, storage })
	await a.start('test')
	await a.write('bookmark', 'bm:off', bm('off', { noteMd: 'offline' }))
	assert.equal(a.state.outbox, 1)
	assert.equal(a.get('bookmark', 'bm:off').pending, true)
	down = false
	const again = new SyncEngine({ http: flaky, storage })     // reload: same device, same outbox
	assert.equal(again.device, a.device)
	assert.equal(again.get('bookmark', 'bm:off', a.state.personal).payload.noteMd, 'offline')
	await again.start('test')
	assert.equal(again.state.outbox, 0)
	assert.equal(again.get('bookmark', 'bm:off').pending, undefined)
	assert.ok(again.get('bookmark', 'bm:off').rev > 0)
})

test('a shared label moves the bookmark into its collection and back', async () => {
	const bob = [`webb${run}`, `Web-pw-${run}-y8!R`]
	const auth = 'Basic ' + Buffer.from(ADMIN.join(':')).toString('base64')
	const r = await fetch(`${BASE}/ocs/v2.php/cloud/users`, {
		method: 'POST',
		headers: { 'OCS-APIRequest': 'true', Accept: 'application/json', Authorization: auth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ userid: bob[0], password: bob[1] }),
	})
	assert.ok(r.ok, 'create bob')
	const ha = http(user)
	const coll = (await ha.post('/collections', { name: `Hauskreis ${run}` })).id
	await ha.post(`/collections/${coll}/members`, { type: 'user', id: bob[0], perm: 'write' })

	const a = new SyncEngine({ http: ha, storage: mem() })
	const b = new SyncEngine({ http: http(bob), storage: mem() })
	await a.start('test')
	await b.start('test')
	const me = a.state.personal
	await a.write('label', 'label:Privat', { name: 'Privat', color: '#00ff00' })
	await a.write('label', 'label:Hauskreis', { name: 'Hauskreis', color: '#0000ff' }, coll)
	await a.write('bookmark', 'bm:mv', bm('mv', { labelNames: ['Privat'], noteMd: 'teilen' }))

	// move in, private label dropped; queued edit after the move keeps moving it
	const p = a.get('bookmark', 'bm:mv').payload
	const moving = a.move('bookmark', 'bm:mv', { ...p, labelNames: ['Hauskreis'] }, me, coll)
	assert.equal(a.get('bookmark', 'bm:mv', me), null, 'old copy hidden at once')
	assert.equal(a.get('bookmark', 'bm:mv', coll).payload.labelNames[0], 'Hauskreis')
	await moving
	await a.sync()
	assert.equal(a.get('bookmark', 'bm:mv', me), null)
	assert.equal(a.list('bookmark').filter(x => x.key === 'bm:mv').length, 1)
	await b.sync()
	const seen = b.get('bookmark', 'bm:mv', coll)
	assert.equal(seen?.payload.noteMd, 'teilen')
	assert.deepEqual(seen.payload.labelNames, ['Hauskreis'])

	// back out: members lose it, I keep it
	await a.move('bookmark', 'bm:mv', { ...seen.payload, labelNames: [] }, coll, me)
	await a.sync()
	await b.sync()
	assert.equal(b.get('bookmark', 'bm:mv', coll), null)
	assert.equal(a.get('bookmark', 'bm:mv', me)?.payload.noteMd, 'teilen')
	assert.equal(a.list('bookmark').filter(x => x.key === 'bm:mv').length, 1)

	// offline move then delete: the original is deleted, nothing lands in the collection
	const down = { ...ha, post: (path, body) => path === '/push' ? Promise.reject(Object.assign(new Error('offline'), { network: true })) : ha.post(path, body) }
	const c = new SyncEngine({ http: down, storage: mem() })
	await c.start('test')
	await c.move('bookmark', 'bm:mv', { ...c.get('bookmark', 'bm:mv', me).payload, labelNames: ['Hauskreis'] }, me, coll)
	await c.write('bookmark', 'bm:mv', null, coll)
	assert.equal(c.outbox.length, 1)
	assert.equal(c.outbox[0].collection, me)
	assert.equal(c.outbox[0].op, 'delete')
})
