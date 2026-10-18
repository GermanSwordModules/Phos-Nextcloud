/**
 * Hybrid logical clock of this browser device (docs/protocol.md §3):
 * "<ms:13>-<counter:4 lowercase hex>-<device:16 hex>". Persisted, never
 * goes backwards; every HLC seen from the server is fed in via observe().
 */
export function parseHlc(s) {
	const m = /^(\d{13})-([0-9a-f]{4})-([0-9a-f]{16})$/.exec(s || '')
	return m ? { ms: Number(m[1]), c: parseInt(m[2], 16) } : null
}

export function formatHlc(ms, c, device) {
	return String(ms).padStart(13, '0') + '-' + c.toString(16).padStart(4, '0') + '-' + device
}

export class Hlc {
	constructor(device, storage, now = () => Date.now()) {
		this.device = device
		this.storage = storage
		this.now = now
		const saved = parseHlc(storage?.get('hlc'))
		this.ms = saved?.ms ?? 0
		this.c = saved?.c ?? 0
	}

	save() {
		this.storage?.set('hlc', formatHlc(this.ms, this.c, this.device))
	}

	/** Next HLC for a local edit. */
	tick() {
		const now = this.now()
		if (now > this.ms) {
			this.ms = now
			this.c = 0
		} else {
			this.c++
		}
		if (this.c > 0xffff) {
			this.ms++
			this.c = 0
		}
		this.save()
		return formatHlc(this.ms, this.c, this.device)
	}

	/** Receive rule: later local edits sort after everything seen. */
	observe(remote) {
		const r = parseHlc(remote)
		if (!r) {
			return
		}
		const now = this.now()
		const ms = Math.max(this.ms, r.ms, now)
		if (ms === this.ms && ms === r.ms) {
			this.c = Math.max(this.c, r.c) + 1
		} else if (ms === this.ms) {
			this.c++
		} else if (ms === r.ms) {
			this.c = r.c + 1
		} else {
			this.c = 0
		}
		this.ms = ms
		if (this.c > 0xffff) {
			this.ms++
			this.c = 0
		}
		this.save()
	}
}
