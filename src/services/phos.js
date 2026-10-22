import { reactive, ref, computed } from 'vue'
import { getCurrentUser } from '@nextcloud/auth'
import { getLanguage, t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
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
/** as: count verses in that versification (a parallel text next to a Bible of another system) */
export const getChapter = (name, book, chap, as = '') => cachedGet(`c|${name}|${book}|${chap}|${as}`,
	`${mod(name)}/text/${encodeURIComponent(book)}/${chap}`, as ? { as } : undefined)
export const getEntry = (name, key) => cachedGet(`e|${name}|${key}`, `${mod(name)}/entry/${encodeURIComponent(key)}`)
export const getPlan = name => cachedGet(`p|${name}`, `${mod(name)}/plan`)
export const getToc = (name, path = '/') => cachedGet(`t|${name}|${path}`, `${mod(name)}/toc`, { path })
export const getBookEntry = (name, path = '/') => cachedGet(`g|${name}|${path}`, `${mod(name)}/book`, { path })
/** Sermon and devotional books treating a chapter (start page) */
export const getSermonBooks = (book, chapter, names) => cachedGet(`sb|${book}|${chapter}`,
	`/sermons/${encodeURIComponent(book)}/${chapter}`, { names: names.join('|') }).then(r => r.hits)
/** Pictures and maps citing a chapter (start page) */
export const getMedia = (book, chapter, names) => cachedGet(`md|${book}|${chapter}`,
	`/media/${encodeURIComponent(book)}/${chapter}`, { names: names.join('|') }).then(r => r.hits)
/** Full-text search (W-4); books: '' | 'OT' | 'NT' | OSIS id(s), comma separated */
export const searchModule = (name, q, { mode = 'all', books = '', offset = 0, limit = 50 } = {}) =>
	cachedGet(`s|${name}|${q}|${mode}|${books}|${offset}|${limit}`, `${mod(name)}/search`, { q, mode, books, offset, limit })
export const getKeys = (name, from = '', limit = 200, before = false) => http.get(`${mod(name)}/keys`, { from, limit, before: before ? 1 : 0 }).then(r => r.keys)

/**
 * URL builder for the pictures of a module (render's `picture`). Pictures
 * named by an online URL are looked for under images/ by their file name,
 * like the desktop does for bundled copies.
 */
export function pictureUrl(module) {
	const base = generateUrl('/apps/phos/module/{module}/file', { module })
	return src => {
		let p = String(src).trim()
		if (/^[a-z][a-z0-9+.-]*:/i.test(p)) {
			if (!/^https?:/i.test(p)) {
				return null
			}
			p = 'images/' + decodeURIComponent(p.split(/[?#]/)[0].split('/').pop() || '')
		}
		return p ? `${base}?path=${encodeURIComponent(p)}` : null
	}
}

// ---------- library ----------

/** SWORD driver → module kind (server SwordModule::kindOf). */
export function kindOfDriver(d) {
	const x = String(d || '').toLowerCase()
	if (['ztext', 'ztext4', 'rawtext', 'rawtext4'].includes(x)) {
		return 'bible'
	}
	if (['zcom', 'zcom4', 'rawcom', 'rawcom4', 'hrefcom', 'rawfiles'].includes(x)) {
		return 'commentary'
	}
	if (['zld', 'rawld', 'rawld4'].includes(x)) {
		return 'dictionary'
	}
	return 'genbook'
}

/**
 * Modules installed on one of the user's desktops but not stored online
 * (moduleInventory records): listed greyed, not readable here.
 * {name, description, kind, lang, category, readingPlan, localOnly, devices[]}
 */
export const localOnlyModules = computed(() => {
	const online = new Set(modules.value.map(m => m.name))
	const out = new Map()
	for (const r of engine.list('moduleInventory')) {
		const dev = r.payload?.device || ''
		for (const m of r.payload?.modules || []) {
			if (!m?.name || online.has(m.name)) {
				continue
			}
			if (!out.has(m.name)) {
				out.set(m.name, {
					name: m.name, description: m.description || m.name, kind: kindOfDriver(m.modDrv), lang: m.lang || 'und',
					category: m.category || '', readingPlan: !!m.readingPlan, localOnly: true, devices: [],
				})
			}
			if (dev && !out.get(m.name).devices.includes(dev)) {
				out.get(m.name).devices.push(dev)
			}
		}
	}
	return [...out.values()]
})

/** Picker entries for local-only modules of a kind: shown, not selectable. */
export const localOnlyOptions = kind => localOnlyModules.value.filter(m => m.kind === kind && !m.readingPlan)
	.map(m => ({ id: m.name, label: `${m.name} – ${m.description} (${t('phos', 'only on {device}', { device: m.devices.join(', ') || 'Desktop' })})`, locked: true, localOnly: true }))

/** The desktop's library groups (unit1 BuildLibraryTree / unit_config CfgKindOfCategory). */
export const LIBRARY_GROUPS = ['bible', 'commentary', 'book', 'dictionary', 'map']

export function libraryGroup(m) {
	const cat = m.category || ''
	if (m.kind === 'bible') {
		return 'bible'
	}
	if (m.kind === 'commentary') {
		return 'commentary'
	}
	if (/Maps|Images|Cartographic/.test(cat)) {
		return 'map'
	}
	if (m.kind === 'dictionary') {
		return 'dictionary'
	}
	return 'book'
}

/** Where a module is read in the web. */
export function moduleRoute(m) {
	switch (m.kind) {
	case 'bible': return { name: 'bible', params: { module: m.name } }
	case 'commentary': return { name: 'commentary', params: { module: m.name } }
	case 'dictionary': return { name: 'dict', params: { module: m.name } }
	case 'genbook': return { name: 'book', params: { module: m.name } }
	default: return null
	}
}

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

export const commentaries = computed(() => modules.value.filter(m => m.kind === 'commentary'))

export function defaultCommentary() {
	const names = commentaries.value.filter(m => !m.locked).map(m => m.name)
	const want = [prefs.get('commentary', null), setting('StudyCommentaries.Mod1')]
	return want.find(n => n && names.includes(n)) || names[0] || null
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

/**
 * Labels picked for a bookmark, in order (label objects, any collection).
 * Desktop rule: the first shared label decides the bookmark's collection, and
 * it carries only that collection's labels — members never see my private
 * ones. No shared label → the bookmark is (back in) my personal collection.
 */
export function setBookmarkLabels(bm, picked) {
	const target = picked.find(l => l.collection !== state.personal)?.collection ?? state.personal
	const labelNames = picked.filter(l => l.collection === target).map(l => l.name)
	if (target === bm.collection) {
		return updateBookmark(bm, { labelNames })
	}
	const { key, collection, pending: _p, ...payload } = bm
	return engine.move('bookmark', key, { ...payload, labelNames, modified: nowS() }, collection, target)
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

export function createLabel(name, color = '#4a90d9', collection = state.personal) {
	return engine.write('label', 'label:' + name, {
		name, color, style: 'fill', iconId: 'bookmark', favorite: false, actionBar: false, autoAssign: false,
	}, collection)
}

/** Labels a bookmark of mine may carry: my own and those of collections I can write to. */
export const assignableLabels = computed(() => labels.value.filter(l => engine.writable(l.collection)))

/** Bookmarks touching a verse in this chapter (module-scoped ones only in their module). */
export function bookmarksIn(book, chap, module) {
	return bookmarks.value.filter(b => b.bookOsis === book && b.chap === chap && b.kind !== 'entry'
		&& (!b.module || b.module === module))
}

// ---------- where the user was reading ----------

const hlcMs = h => parseInt(String(h || '').slice(0, 13), 10) || 0

/**
 * Bible and commentary panels of the desktop's workspaces (synced, read
 * only here), newest workspace first: bookIndex is the desktop's 66-book
 * list, chapIndex 0-based, verseIndex the verse.
 */
export const desktopPositions = computed(() => {
	const out = []
	const seen = new Set()
	for (const r of engine.list('workspace')) {
		for (const p of r.payload?.panels || []) {
			const book = KJV_ORDER[p.bookIndex]
			if ((p.kind !== 'Bible' && p.kind !== 'Commentary') || !book || !p.module) {
				continue
			}
			const pos = {
				workspace: r.payload.name || '', module: p.module, kind: p.kind === 'Bible' ? 'bible' : 'commentary',
				book, chapter: Math.max(0, p.chapIndex || 0) + 1, verse: Math.max(1, p.verseIndex || 1), at: hlcMs(r.hlc),
			}
			const k = [pos.workspace, pos.module, book, pos.chapter, pos.verse].join('|')
			if (!seen.has(k)) {
				seen.add(k)
				out.push(pos)
			}
		}
	}
	return out.sort((a, b) => b.at - a.at)
})

/** The web's own last Bible position (this browser). */
export function rememberPosition(p) {
	prefs.set('lastRead', { module: p.module, book: p.book, chapter: p.chapter, verse: p.verse, at: Date.now() })
}

/**
 * Where to continue reading when nothing is asked for: the newer of this
 * browser's last position and the desktop's newest workspace (Bibles only).
 */
export function resumePosition() {
	const own = prefs.get('lastRead', null)
	const desk = desktopPositions.value.find(p => p.kind === 'bible')
	if (desk && (!own || desk.at > own.at)) {
		return desk
	}
	return own
}

/** A general book's reading position, shared with the desktop (pos:mod:<module>). */
export function bookPosition(module) {
	return engine.get('readingPosition', 'pos:mod:' + module)?.payload?.entryKey || null
}

export function setBookPosition(module, entryKey) {
	const cur = engine.get('readingPosition', 'pos:mod:' + module)?.payload
	if (!entryKey || cur?.entryKey === entryKey) {
		return
	}
	engine.write('readingPosition', 'pos:mod:' + module, { entryKey, scroll: 0 })
}
