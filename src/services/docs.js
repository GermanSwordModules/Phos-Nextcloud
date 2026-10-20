import { computed } from 'vue'
import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import DOMPurify from 'dompurify'
import { engine, newId, getChapter, modules, lang } from './phos.js'
import { KJV_ORDER, formatRef, parseRef } from '../bible/books.js'
import { render } from '../bible/render.js'
import { MAX_PRES_VERSES, parseOsisRange } from '../docs/deck.js'

/*
 * W-5/W-6: the desktop's documents as the web sees them (records synced from
 * Phos Desktop, shapes of BVC unit_ncsync_docs):
 *
 *   sermon        sermon:<uuid>        the sermon JSON (editable here)
 *   pericope      pericope:<uuid>      exegesis: index row + rtf + state
 *   project       project:<uuid>       index row + project + notesRtf + synthesisRtf + findings
 *   presentation  presentation:<uuid>  index row + deck
 *   ebook         ebook:<ref>          manifest {files:[{p,s,h}], total}; files in Phos/E-Books/<ref>/
 *
 * Records over ~1 MB arrive as {"$file": "Phos/.records/…"} and are fetched.
 */

/** URL of a file below Phos/ that belongs to a record of `collection` (own or shared). */
export function phosFileUrl(collection, path) {
	const rel = String(path).replace(/^Phos\//, '')
	return generateUrl('/apps/phos/files/') + encodeURIComponent(collection) + '/' + rel.split('/').map(encodeURIComponent).join('/')
}

const fetched = new Map()
/** The record's payload, fetching it when it is stored as a file. */
export async function fullPayload(rec) {
	const p = rec?.payload
	if (!p || typeof p.$file !== 'string') {
		return p || null
	}
	const k = `${rec.collection}|${p.$file}|${p.md5 || ''}`
	if (!fetched.has(k)) {
		fetched.set(k, axios.get(phosFileUrl(rec.collection, p.$file), { responseType: 'text', transformResponse: x => x })
			.then(r => JSON.parse(r.data))
			.catch(e => { fetched.delete(k); throw e }))
	}
	return fetched.get(k)
}

const list = type => engine.list(type).map(r => ({ rec: r, key: r.key, id: r.key.slice(r.key.indexOf(':') + 1), collection: r.collection, p: r.payload || {} }))

// ---------- sermons ----------

export const sermons = computed(() => list('sermon').map(s => ({ ...s, title: s.p.title || s.p.passage || '', modified: s.p.modified || '' }))
	.sort((a, b) => b.modified.localeCompare(a.modified)))

const isoNow = () => {
	const d = new Date()
	const z = n => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`
}

const dashed = h => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`

export function newSermon({ title = '', passage = '', bible = '' } = {}) {
	const uuid = dashed(newId())
	const p = {
		uuid, title, passage, passage_osis: osisOfPassage(passage), exegesis: '', planner_event: '', project: '', deck: '',
		bible, main_idea: '', goal: '', audience: '', intro: '', conclusion: '', created: isoNow(), modified: isoNow(),
		outline: [{ title: '', refs: '', blocks: [] }],
	}
	engine.write('sermon', 'sermon:' + uuid, p)
	return uuid
}

export function saveSermon(s, payload) {
	return engine.write('sermon', s.key, { ...payload, modified: isoNow() }, s.collection)
}

export function deleteSermon(s) {
	return engine.write('sermon', s.key, null, s.collection)
}

/** "Röm 8,31-39" → 'Rom.8.31-Rom.8.39' (desktop passage_osis), '' when it is no passage. */
export function osisOfPassage(text) {
	const r = parseRef(String(text || ''))
	if (!r) {
		return ''
	}
	const start = `${r.book}.${r.c1}.${r.v1 || 1}`
	// v = 0: to the end of the chapter (999 — readers stop at the last verse)
	const end = `${r.book}.${r.c2}.${r.v2 || (r.v1 && r.c2 === r.c1 ? r.v1 : 999)}`
	return start === end ? start : `${start}-${end}`
}

export const SERMON_KINDS = ['note', 'exegesis', 'verse', 'quote', 'illustration', 'application', 'question', 'slide']

/** Spoken words (not slides, not questions) → minutes at 120 wpm, like the desktop. */
export function sermonMinutes(p, wpm = 120) {
	const words = s => String(s || '').split(/\s+/).filter(Boolean).length
	let n = words(p.main_idea) + words(p.intro) + words(p.conclusion)
	for (const pt of p.outline || []) {
		n += words(pt.title)
		for (const b of pt.blocks || []) {
			if (b.kind !== 'slide' && b.kind !== 'question') {
				n += words(b.text)
			}
		}
	}
	return { words: n, minutes: Math.round(n / wpm) }
}

// ---------- exegeses (pericope) and projects ----------

/** Desktop book number (1-based, 66-book order) → OSIS id. */
export const bookOfIndex = i => KJV_ORDER[(i || 1) - 1] || null

export function pericopeRef(p, lang) {
	const book = bookOfIndex(p.bookStart)
	if (!book) {
		return ''
	}
	return formatRef({ book, c1: p.chapStart, v1: p.verseStart, c2: p.chapEnd || p.chapStart, v2: p.verseEnd || p.verseStart }, lang)
}

export const exegeses = computed(() => list('pericope').map(e => ({ ...e, title: e.p.title || '' }))
	.sort((a, b) => (a.p.bookStart - b.p.bookStart) || (a.p.chapStart - b.p.chapStart) || (a.p.verseStart - b.p.verseStart)))

export const projects = computed(() => list('project').map(x => ({
	...x, title: x.p.title || x.p.project?.title || '', category: x.p.project?.category || x.p.category || '',
	kind: x.p.kind || x.p.project?.kind || '', status: x.p.status || x.p.project?.status || '',
})).sort((a, b) => a.title.localeCompare(b.title)))

/** The desktop's "d-m-yy hh:nn:ss" (also ISO) → a Date, or null. */
export function deskDate(s) {
	const m = /^(\d{1,2})-(\d{1,2})-(\d{2,4})(?: (\d{1,2}):(\d{2}))?/.exec(String(s || ''))
	if (m) {
		const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
		return new Date(y, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0))
	}
	const d = new Date(s)
	return Number.isNaN(d.getTime()) ? null : d
}

/** TDateTime (days since 1899-12-30) → Date. */
export const tdateTime = v => (typeof v === 'number' ? new Date(Date.UTC(1899, 11, 30) + v * 86400000) : deskDate(v))

// ---------- presentations ----------

export const decks = computed(() => list('presentation').map(d => ({
	...d, title: d.p.title || d.p.deck?.title || '', theme: d.p.theme || d.p.deck?.theme || '', kind: d.p.kind || '',
	modified: tdateTime(d.p.modified)?.getTime() || 0,
})).sort((a, b) => b.modified - a.modified))

/** A deck's passage block: verses as the desktop's passage body (spans vC_V). */
export async function deckPassage(module, osis) {
	const r = parseOsisRange(osis)
	const meta = modules.value.find(m => m.name === module)
	if (!r || !meta) {
		return null
	}
	let html = ''
	let n = 0
	for (let c = r.c1; c <= r.c2 && n < MAX_PRES_VERSES; c++) {
		let ch
		try {
			ch = await getChapter(module, r.book, c)
		} catch {
			break
		}
		const nums = Object.keys(ch.verses || {}).map(Number).sort((a, b) => a - b)
		for (const v of nums) {
			if ((c === r.c1 && v < r.v1) || (c === r.c2 && v > r.v2) || n >= MAX_PRES_VERSES) {
				continue
			}
			const body = render(ch.verses[v], { sourceType: meta.sourceType || 'OSIS' }).html
			if (!body.replace(/<[^>]+>/g, '').trim()) {
				continue
			}
			html += `<span class="verse" id="v${c}_${v}"><span class="phos-vnum">${v}</span>${body}</span> `
			n++
		}
	}
	const ref = formatRef({ book: r.book, c1: r.c1, v1: r.v1, c2: r.c2, v2: r.v2 }, lang)
	return html ? { html, ref, rtl: meta.direction === 'RtoL' } : null
}

/**
 * A picture of a deck, as the desktop names it (an absolute path on its disk):
 * one in the deck's own media folder travels with the deck (presAssets,
 * Phos/Praesentationen/<deck>/…); anything else is not on the server.
 */
export function deckImageUrl(deck, path) {
	const p = String(path || '').replace(/\\/g, '/')
	const m = new RegExp(`/${deck.id}/(.+)$`, 'i').exec(p)
	return m ? phosFileUrl(deck.collection, `Praesentationen/${deck.id}/${m[1]}`) : null
}

export const cleanHtml = html => DOMPurify.sanitize(String(html || ''), {
	FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
	FORBID_ATTR: ['srcset'],
})

// ---------- e-books ----------

export const ebooks = computed(() => list('ebook').map(b => {
	const files = (b.p.files || []).map(f => f.p)
	const main = files.find(f => /^book\.(epub|pdf)$/i.test(f)) || files.find(f => /\.(epub|pdf)$/i.test(f)) || null
	return { ...b, ref: b.id, files, main, format: main ? main.split('.').pop().toLowerCase() : '' }
}).filter(b => b.main).sort((a, b) => a.ref.localeCompare(b.ref)))

export const ebookFileUrl = (b, p) => phosFileUrl(b.collection, `E-Books/${b.ref}/${p}`)

const confs = new Map()
/** book.conf of an e-book (Title, Author, Kind, Cover …), {} when there is none. */
export function ebookInfo(b) {
	if (!b.files.includes('book.conf')) {
		return Promise.resolve({})
	}
	const k = b.collection + '|' + b.ref
	if (!confs.has(k)) {
		confs.set(k, axios.get(ebookFileUrl(b, 'book.conf'), { responseType: 'text', transformResponse: x => x }).then(r => {
			const o = {}
			for (const line of String(r.data).split(/\r?\n/)) {
				const m = /^([A-Za-z]+)=(.*)$/.exec(line)
				if (m) {
					o[m[1]] = m[2].trim()
				}
			}
			return o
		}).catch(() => ({})))
	}
	return confs.get(k)
}

/** E-book reading position, shared with the desktop: pos:ebook:<ref> {entryKey: chapter file, scroll}. */
export const ebookPosition = ref => engine.get('readingPosition', 'pos:ebook:' + ref)?.payload?.entryKey || null

export function setEbookPosition(ref, entryKey) {
	if (!entryKey || ebookPosition(ref) === entryKey) {
		return
	}
	engine.write('readingPosition', 'pos:ebook:' + ref, { entryKey, scroll: 0 })
}
