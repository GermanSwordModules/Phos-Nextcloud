import { Hlc } from './hlc.js'

/**
 * The web as one more sync device (docs/protocol.md §8): records come from
 * GET /changes, local edits go out through POST /push with the rev they were
 * based on; the server merges. No special paths.
 *
 * `records` holds the server state (the shadow), `pending` the local edits
 * not yet confirmed; readers see pending over records. The outbox survives
 * reloads (storage); the records are pulled fresh on every start.
 */
// workspace, pericope (exegesis), project, presentation, presTheme, ebook: read only here;
// readingPosition: books and e-books only (pos:mod:<module>, pos:ebook:<ref>);
// module, presAssets, projectOcc: only moved along when an item is shared (W-7);
// moduleInventory: what each desktop has installed (shown greyed when not online)
export const SYNC_TYPES = ['bookmark', 'label', 'planProgress', 'setting', 'sermon', 'workspace', 'readingPosition',
	'pericope', 'project', 'presentation', 'presTheme', 'ebook', 'module', 'presAssets', 'projectOcc', 'moduleInventory']

const rk = (collection, type, key) => `${collection}\u0001${type}\u0001${key}`

function uuid() {
	if (globalThis.crypto?.randomUUID) {
		return globalThis.crypto.randomUUID()
	}
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
		const r = Math.random() * 16 | 0
		return (ch === 'x' ? r : (r & 3 | 8)).toString(16)
	})
}

export function newDeviceId() {
	const b = new Uint8Array(8)
	globalThis.crypto.getRandomValues(b)
	return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

export class SyncEngine {
	/**
	 * @param {object} o
	 * @param {{get: Function, post: Function, del: Function}} o.http OCS data in, data out
	 * @param {{get: Function, set: Function}} o.storage string key/value store (localStorage)
	 * @param {Map} [o.records] server records (pass a reactive Map in the app)
	 * @param {Map} [o.pending] local edits (reactive Map in the app)
	 * @param {object} [o.state] status fields (reactive object in the app)
	 */
	constructor({ http, storage, records = new Map(), pending = new Map(), state = {}, deviceName = 'Web', now }) {
		this.http = http
		this.storage = storage
		this.records = records
		this.pending = pending
		this.state = state
		Object.assign(state, {
			personal: null, collections: [], cursor: 0, syncing: false, online: true,
			error: null, lastSync: 0, conflicts: [], ready: false,
		})
		let device = storage.get('device')
		if (!/^[0-9a-f]{16}$/.test(device || '')) {
			device = newDeviceId()
			storage.set('device', device)
		}
		this.device = device
		this.deviceName = deviceName
		this.hlc = new Hlc(device, storage, now)
		this.outbox = []
		try {
			this.outbox = JSON.parse(storage.get('outbox') || '[]')
		} catch {
			this.outbox = []
		}
		for (const c of this.outbox) {
			this.setOverlay(c)
		}
		this.state.outbox = this.outbox.length
		this.chain = Promise.resolve()
	}

	overlay(c) {
		return {
			collection: c.collection, type: c.type, key: c.key, rev: c.baseRev, hlc: c.hlc,
			deleted: c.op === 'delete', payload: c.op === 'delete' ? null : c.payload, pending: true,
			changeId: c.changeId,
		}
	}

	/** Shows a queued change locally; a move also hides the record in its old collection. */
	setOverlay(c) {
		this.pending.set(rk(c.collection, c.type, c.key), this.overlay(c))
		if (c.moveFrom) {
			this.pending.set(rk(c.moveFrom, c.type, c.key), {
				...this.overlay(c), collection: c.moveFrom, deleted: true, payload: null,
			})
		}
	}

	saveOutbox() {
		this.storage.set('outbox', JSON.stringify(this.outbox))
		this.state.outbox = this.outbox.length
	}

	/** Runs sync steps one after another. */
	serial(fn) {
		const p = this.chain.then(fn, fn)
		this.chain = p.catch(() => {})
		return p
	}

	async start(appVersion = '') {
		const st = await this.http.get('/status')
		this.state.personal = st.personalCollection
		this.hlc.observe(`${String(st.serverTime).padStart(13, '0')}-0000-${this.device}`)
		await this.http.post('/devices', { id: this.device, name: this.deviceName, platform: 'web', appVersion })
		await this.sync()
		this.state.ready = true
	}

	sync() {
		return this.serial(async () => {
			this.state.syncing = true
			try {
				await this.flushNow()
				await this.pullNow()
				await this.loadConflicts()
				this.state.online = true
				this.state.error = null
				this.state.lastSync = Date.now()
			} catch (e) {
				this.state.online = !e?.network
				this.state.error = e?.message || String(e)
				throw e
			} finally {
				this.state.syncing = false
			}
		})
	}

	async pullNow() {
		let cursor = this.state.cursor
		for (;;) {
			const r = await this.http.get('/changes', {
				cursor, limit: 1000, types: SYNC_TYPES.join(','), device: this.device,
			})
			if (r.resetRequired) {
				this.records.clear()
				cursor = 0
				continue
			}
			this.state.collections = r.collections
			const readable = new Set(r.collections.map(c => c.id))
			for (const k of [...this.records.keys()]) {
				if (!readable.has(k.split('\u0001')[0])) {
					this.records.delete(k)
				}
			}
			for (const rec of r.changes) {
				this.adopt(rec)
			}
			for (const coll of r.joined || []) {
				await this.pullCollection(coll)
			}
			cursor = r.cursor
			if (!r.hasMore) {
				break
			}
		}
		this.state.cursor = cursor
	}

	async pullCollection(coll) {
		let cursor = 0
		for (;;) {
			const r = await this.http.get('/changes', {
				cursor, limit: 1000, types: SYNC_TYPES.join(','), device: this.device, collections: coll,
			})
			r.changes.forEach(rec => this.adopt(rec))
			cursor = r.cursor
			if (!r.hasMore) {
				return
			}
		}
	}

	adopt(rec) {
		this.hlc.observe(rec.hlc)
		const k = rk(rec.collection, rec.type, rec.key)
		const cur = this.records.get(k)
		if (!cur || cur.rev <= rec.rev) {
			this.records.set(k, Object.freeze({ ...rec }))
		}
	}

	async loadConflicts() {
		const r = await this.http.get('/conflicts')
		this.state.conflicts = r.conflicts
	}

	/** Current view of one record (pending edit first); null when absent or deleted. */
	get(type, key, collection = this.state.personal) {
		const k = rk(collection, type, key)
		const r = this.pending.get(k) ?? this.records.get(k)
		return r && !r.deleted ? r : null
	}

	/** Live records of a type, pending edits applied. */
	list(type) {
		const out = new Map()
		for (const [k, r] of this.records) {
			if (r.type === type) {
				out.set(k, r)
			}
		}
		for (const [k, r] of this.pending) {
			if (r.type === type) {
				out.set(k, r)
			}
		}
		return [...out.values()].filter(r => !r.deleted)
	}

	writable(collection) {
		if (collection === this.state.personal) {
			return true
		}
		const c = this.state.collections.find(x => x.id === collection)
		return !!c && (c.perm === 'write' || c.perm === 'admin')
	}

	/**
	 * Queues an upsert (payload) or delete (payload null) and pushes it.
	 * A record edited again before its push replaces the queued change.
	 */
	write(type, key, payload, collection = this.state.personal) {
		return this.queue(type, key, payload, collection, null)
	}

	/**
	 * Moves a record to another collection (protocol §11 moveFrom): an upsert
	 * there, the server tombstones the old copy.
	 */
	move(type, key, payload, from, to) {
		if (from === to) {
			return this.write(type, key, payload, to)
		}
		// a move still queued from `from` is folded into this one
		const earlier = this.outbox.find(c => c.type === type && c.key === key && c.collection === from && c.moveFrom)
		const origin = earlier ? earlier.moveFrom : from
		if (earlier) {
			this.outbox = this.outbox.filter(c => c !== earlier)
			this.pending.delete(rk(from, type, key))
		}
		return this.queue(type, key, payload, to, origin === to ? null : origin)
	}

	queue(type, key, payload, collection, moveFrom) {
		const k = rk(collection, type, key)
		const base = this.records.get(k)
		const queued = this.outbox.findIndex(c => rk(c.collection, c.type, c.key) === k)
		const change = {
			changeId: uuid(), collection, type, key,
			op: payload === null ? 'delete' : 'upsert',
			hlc: this.hlc.tick(),
			baseRev: queued >= 0 ? this.outbox[queued].baseRev : (base?.rev ?? 0),
			payload: payload === null ? undefined : JSON.parse(JSON.stringify(payload)),
		}
		// an edit after a queued move keeps moving it (a delete just deletes the new copy)
		const from = moveFrom ?? (queued >= 0 ? this.outbox[queued].moveFrom : null)
		if (from && payload !== null) {
			change.moveFrom = from
		} else if (from) {
			// deleted before the move went out: delete the original instead
			change.collection = from
			change.baseRev = this.records.get(rk(from, type, key))?.rev ?? 0
			this.pending.delete(k)
		}
		if (queued >= 0) {
			this.outbox.splice(queued, 1, change)
		} else {
			this.outbox.push(change)
		}
		this.saveOutbox()
		this.setOverlay(change)
		return this.flush()
	}

	flush() {
		return this.serial(() => this.flushNow())
	}

	async flushNow() {
		while (this.outbox.length) {
			const batch = this.outbox.slice(0, 500)
			let res
			try {
				res = await this.http.post('/push', { device: this.device, changes: batch })
			} catch (e) {
				this.state.online = !e?.network
				this.state.error = e?.message || String(e)
				return
			}
			const sent = new Set(batch.map(c => c.changeId))
			for (const r of res.results) {
				const c = batch.find(x => x.changeId === r.changeId)
				if (!c) {
					continue
				}
				const k = rk(c.collection, c.type, c.key)
				if (r.record) {
					this.adopt(r.record)
				}
				if (r.status === 'conflict' || r.status === 'forbidden' || r.status === 'invalid') {
					this.state.lastProblem = { status: r.status, type: c.type, key: c.key, error: r.error }
				}
				if (this.pending.get(k)?.changeId === c.changeId) {
					this.pending.delete(k)
				}
				if (c.moveFrom) {
					const fk = rk(c.moveFrom, c.type, c.key)
					if (['accepted', 'merged'].includes(r.status)) {
						// the server tombstoned it; the pull brings the tombstone's rev
						const old = this.records.get(fk)
						if (old) {
							this.records.set(fk, Object.freeze({ ...old, deleted: true, payload: null }))
						}
					}
					if (this.pending.get(fk)?.changeId === c.changeId) {
						this.pending.delete(fk)
					}
				}
			}
			this.outbox = this.outbox.filter(c => !sent.has(c.changeId))
			this.saveOutbox()
			if (res.results.some(r => r.status === 'conflict')) {
				await this.loadConflicts()
			}
		}
	}

	async resolveConflict(id, use, payload) {
		const r = await this.http.post(`/conflicts/${id}/resolve`, payload === undefined ? { use } : { use, payload })
		if (r.record) {
			this.adopt(r.record)
		}
		await this.loadConflicts()
		return r.record
	}
}
