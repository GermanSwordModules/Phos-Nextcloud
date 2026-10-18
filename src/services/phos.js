import { reactive, ref, computed } from 'vue'
import { getCurrentUser } from '@nextcloud/auth'
import { getLanguage } from '@nextcloud/l10n'
import { http } from './api.js'
import { SyncEngine } from '../sync/engine.js'
import { KJV_ORDER } from '../bible/books.js'

/** App-wide state: the sync engine (web device) and the module reader. */

const uid = getCurrentUser()?.uid || 'anon'
const storage = {
	get: k => { try { return localStorage.getItem(`phos.${uid}.${k}`) } catch { return null } },
	set: (k, v) => { try { localStorage.setItem(`phos.${uid}.${k}`, v) } catch { /* private mode */ } },
}

function browserName() {
	const ua = navigator.userAgent
	const b = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
	const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
	return `Web · ${b}${os ? ' / ' + os : ''}`
}

export const lang = getLanguage()
export const records = reactive(new Map())
export const pending = reactive(new Map())
export const state = reactive({})
export const engine = new SyncEngine({ http, storage, records, pending, state, deviceName: browserName() })
export const prefs = {
	get: (k, d) => { const v = storage.get('pref.' + k); return v === null ? d : JSON.parse(v) },
	set: (k, v) => storage.set('pref.' + k, JSON.stringify(v)),
}

let started = null
export function start() {
	started ??= engine.start(appVersion).catch(e => { started = null; throw e })
	return started
}

// ---------- modules ----------

export const modules = ref([])
export const modulesLoaded = ref(false)
export async function loadModules() {
	const r = await http.get('/modules')
	modules.value = r.modules
	modulesLoaded.value = true
	return r.modules
}
export const bibles = computed(() => modules.value.filter(m => m.kind === 'bible'))
export const plans = computed(() => modules.value.filter(m => m.readingPlan))

const memo = new Map()
function cachedGet(key, path, params) {
	if (!memo.has(key)) {
		memo.set(key, http.get(path, params).catch(e => { memo.delete(key); throw e }))
	}
	return memo.get(key)
}
const mod = name => `/modules/${encodeURIComponent(name)}`
export const getBooks = name => cachedGet(`b|${name}`, `${mod(name)}/books`)
export const getChapter = (name, book, chap) => cachedGet(`c|${name}|${book}|${chap}`, `${mod(name)}/text/${encodeURIComponent(book)}/${chap}`)
export const getEntry = (name, key) => cachedGet(`e|${name}|${key}`, `${mod(name)}/entry/${encodeURIComponent(key)}`)
export const getPlan = name => cachedGet(`p|${name}`, `${mod(name)}/plan`)

/** Lexicons for a Strong's number: the user's default dictionary first, then any with the feature. */
export function lexiconsFor(strong) {
	const hebrew = /^H/i.test(strong)
	const feature = hebrew ? 'HebrewDef' : 'GreekDef'
	const wanted = setting(hebrew ? 'General.DefaultHebrewDict' : 'General.DefaultGreekDict')
	const all = modules.value.filter(m => m.kind === 'dictionary' && m.features.includes(feature) && !m.locked)
	return all.sort((a, b) => (b.name === wanted) - (a.name === wanted))
}

// ---------- settings (synced from the desktop) ----------

export function setting(name) {
	return engine.get('setting', 'setting:' + name)?.payload?.value ?? null
}

export function defaultBible() {
	const names = bibles.value.filter(m => !m.locked).map(m => m.name)
	const want = [prefs.get('bible', null), setting('General.DefaultBible')]
	return want.find(n => n && names.includes(n)) || names[0] || null
}

// ---------- labels and bookmarks ----------

export function personal() {
	return state.personal
}

export function collectionInfo(id) {
	return state.collections?.find(c => c.id === id) || null
}

/** Labels, each with its collection and whether it is someone else's. */
export const labels = computed(() => engine.list('label').map(r => ({
	...r.payload,
	key: r.key,
	collection: r.collection,
	shared: r.collection !== state.personal,
	owner: collectionInfo(r.collection)?.ownerName || null,
})).sort((a, b) => a.name.localeCompare(b.name, lang)))

export function labelDisplay(name) {
	return name.startsWith('_') ? name.slice(1) : name
}

export const bookmarks = computed(() => engine.list('bookmark').map(r => ({ ...r.payload, key: r.key, collection: r.collection, pending: !!r.pending })))

export function newId() {
	const b = new Uint8Array(16)
	crypto.getRandomValues(b)
	return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
}

const nowS = () => Math.floor(Date.now() / 1000)

/** A whole-verse bookmark (no module: shows in every Bible, like the desktop's). */
export function createBookmark(book, chap, vStart, vEnd = vStart, extra = {}) {
	const id = newId()
	const p = {
		id, kind: vEnd > vStart ? 'range' : 'verse', bookOsis: book, bookIdx: Math.max(0, KJV_ORDER.indexOf(book)),
		chap, vStart, vEnd, labelNames: [], sortOrder: 0, created: nowS(), modified: nowS(), ...extra,
	}
	engine.write('bookmark', 'bm:' + id, p)
	return p
}

/** A reference-less note of a study pad (desktop: "Eigene Notiz"). */
export function createPadNote(label, text, sortOrder) {
	const id = newId()
	const p = {
		id, kind: 'entry', bookIdx: 0, chap: 0, vStart: 0, vEnd: 0, labelNames: [label.name],
		noteMd: text, sortOrder, created: nowS(), modified: nowS(),
	}
	engine.write('bookmark', 'bm:' + id, p, label.collection)
	return p
}

export function updateBookmark(bm, changes) {
	const { key, collection, pending: _p, ...payload } = bm
	const next = { ...payload, ...changes, modified: nowS() }
	for (const [k, v] of Object.entries(changes)) {
		if (v === undefined) {
			delete next[k]
		}
	}
	return engine.write('bookmark', key, next, collection)
}

/** Note edited here: Markdown only. The desktop's RTF copy would hide the edit, so it goes. */
export function setNote(bm, text) {
	return updateBookmark(bm, { noteMd: text.trim() ? text : undefined, noteHtml: undefined })
}

export function deleteBookmark(bm) {
	return engine.write('bookmark', bm.key, null, bm.collection)
}

export function saveLabel(label, changes = {}) {
	const { key, collection, shared, owner, ...payload } = label
	return engine.write('label', 'label:' + label.name, { ...payload, ...changes }, collection || state.personal)
}

export function createLabel(name, color = '#4a90d9') {
	return engine.write('label', 'label:' + name, {
		name, color, style: 'fill', iconId: 'bookmark', favorite: false, actionBar: false, autoAssign: false,
	})
}

/** Bookmarks touching a verse in this chapter (module-scoped ones only in their module). */
export function bookmarksIn(book, chap, module) {
	return bookmarks.value.filter(b => b.bookOsis === book && b.chap === chap && b.kind !== 'entry'
		&& (!b.module || b.module === module))
}
