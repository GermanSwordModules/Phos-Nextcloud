import { computed } from 'vue'
import { getCurrentUser } from '@nextcloud/auth'
import { engine, state, collectionInfo } from './phos.js'
import { http } from './api.js'

/*
 * W-7: putting things into a shared collection from the web, the way Phos
 * Desktop's "Teilen …" does (BVC TNcSync.CollectionFor): the item moves with
 * protocol moveFrom, and what belongs to it moves along —
 *
 *   project:<id>       + projectOcc:<id>, every pericope whose `project` is <id>
 *   presentation:<id>  + presAssets:<id> (its pictures, _ext/ included)
 *   pericope, sermon, ebook, module: on their own
 *
 * The desktop follows (an item arriving from another collection is bound to
 * it). Files of file sets stay where they are: the server hands them to the
 * collection's members once the record is in it. Cipher keys (moduleKey)
 * never move. Labels are shared from the desktop (its bookmarks keep private
 * labels there, which a single web copy cannot).
 */

export const SHARE_TYPES = ['project', 'presentation', 'pericope', 'sermon', 'ebook', 'module']

/** Records that travel with an item (desktop CollectionFor), in the item's collection. */
export function dependentsOf(type, key, collection) {
	const id = key.slice(key.indexOf(':') + 1)
	const out = []
	const add = (t, k) => {
		const r = engine.get(t, k, collection)
		if (r) {
			out.push(r)
		}
	}
	if (type === 'project') {
		add('projectOcc', 'projectOcc:' + id)
		for (const r of engine.list('pericope')) {
			if (r.collection === collection && r.payload?.project === id) {
				out.push(r)
			}
		}
	} else if (type === 'presentation') {
		add('presAssets', 'presAssets:' + id)
	}
	return out
}

const me = () => getCurrentUser()?.uid

/**
 * Collections an item of mine can go to: shared ones I own. (Files of a
 * module, e-book or deck live in the collection owner's storage, so the
 * server takes file sets only from the owner — and the desktop, too, shares
 * into a collection of its own.)
 */
export const shareTargets = computed(() => (state.collections || [])
	.filter(c => c.kind !== 'personal' && c.owner === me()))

/** May I take this item out of / put it into a collection? (personal, or a shared one I own) */
export const isMine = collection => collection === state.personal || collectionInfo(collection)?.owner === me()

/**
 * Moves the item (and what belongs to it) into collection `to`; `to` null
 * creates a collection named `newName` first. Resolves to the target id.
 */
export async function shareItem({ type, key, collection }, to, newName = '') {
	if (!SHARE_TYPES.includes(type)) {
		throw new Error('not shareable: ' + type)
	}
	let target = to
	if (!target) {
		target = (await http.post('/collections', { name: newName.trim() || key })).id
		await engine.sync()          // knows the new collection (writable, listed)
	}
	await moveWithDependents(type, key, collection, target)
	return target
}

/** Back into my personal collection (desktop: "Teilen beenden" → data personal again). */
export function unshareItem({ type, key, collection }) {
	return moveWithDependents(type, key, collection, state.personal)
}

async function moveWithDependents(type, key, from, to) {
	if (from === to) {
		return
	}
	const rec = engine.get(type, key, from)
	if (!rec) {
		throw new Error('record not found: ' + key)
	}
	const deps = dependentsOf(type, key, from)
	const moves = [rec, ...deps].map(r => engine.move(r.type, r.key, r.payload, from, to))
	await Promise.all(moves)
	const p = state.lastProblem
	if (p && p.key === key && ['forbidden', 'invalid'].includes(p.status)) {
		throw new Error(p.error || p.status)
	}
}

/** Shareable items in one collection, for the overview: {type, key, collection, title}. */
export function itemsIn(collection, titleOf) {
	const out = []
	for (const type of SHARE_TYPES) {
		for (const r of engine.list(type)) {
			if (r.collection === collection) {
				out.push({ type, key: r.key, collection, title: titleOf(type, r) })
			}
		}
	}
	return out
}
