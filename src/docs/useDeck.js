import { decks, deckPassage, deckImageUrl, deckExtras, deckTheme, cleanHtml, fullPayload } from '../services/docs.js'
import { renderDeck, themeVars, deckLogo } from './deck.js'
import { loadModules, modulesLoaded } from '../services/phos.js'

/*
 * Everything the deck page, the presenter window and the phone remote share:
 * loading and rendering a deck, setting up reveal.js, and the link between
 * two windows of the same browser showing the same deck.
 */

const plain = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** Slide names for lists: the slide's title, else its first heading block, else "n". */
export function slideTitles(deck) {
	return (deck?.slides || []).map((s, i) => {
		const head = (s.blocks || []).find(b => (b.kind === 'title' || b.kind === 'subtitle') && plain(b.text))
		return plain(s.title) || plain(head?.text) || String(i + 1)
	})
}

/** A synced deck record → rendered sections plus its theme, pictures and slide names. */
export async function loadDeck(d) {
	if (!modulesLoaded.value) {
		await loadModules()
	}
	const [payload, ext] = await Promise.all([fullPayload(d.rec), deckExtras(d)])
	const deck = payload?.deck || payload || {}
	const image = p => deckImageUrl(d, p, ext)
	const theme = name => deckTheme(name, ext)
	const sections = await renderDeck(deck, {
		passage: (m, osis) => deckPassage(m, osis),
		image,
		theme,
		sanitize: cleanHtml,
	})
	const th = theme(deck.theme || d.p?.theme)
	return { deck, sections, vars: themeVars(th, image), logo: deckLogo(th, image), titles: slideTitles(deck) }
}

export const findDeck = id => decks.value.find(d => d.id === id) || null

/** reveal.js on `el` (a .reveal holding an empty .slides) with the deck's sections. */
export async function mountReveal(el, sections, opts = {}) {
	el.querySelector('.slides').innerHTML = sections.join('')
	const { default: Reveal } = await import('reveal.js')
	const r = new Reveal(el, {
		embedded: true, hash: false, history: false, controls: true, progress: true, center: false,
		transition: 'slide', width: 1280, height: 720, margin: 0.06, minScale: 0.2, maxScale: 2.0,
		keyboard: true, overview: true, slideNumber: false, ...opts,
	})
	await r.initialize()
	return r
}

/** The notes of the slide reveal shows now (rendered HTML), '' when none. */
export const currentNotes = r => r.getCurrentSlide()?.querySelector('aside.notes')?.innerHTML || ''

/**
 * Deck page ↔ presenter window (same browser): {type:'go', h, v, f},
 * {type:'black', on}, {type:'hello'} (asks for the position). Messages from
 * this window itself never come back (BroadcastChannel semantics).
 */
export function deckChannel(deckId, onMessage) {
	if (typeof BroadcastChannel === 'undefined') {
		return { send() {}, close() {} }
	}
	const ch = new BroadcastChannel('phos-deck-' + deckId)
	ch.onmessage = e => onMessage(e.data || {})
	return { send: m => ch.postMessage(m), close: () => ch.close() }
}

/** Move `r` to the position of a 'go' message unless it is there already. */
export function applyGo(r, m) {
	const i = r.getIndices()
	const f = m.f ?? undefined
	if (i.h !== m.h || (i.v || 0) !== (m.v || 0) || (i.f ?? undefined) !== f) {
		r.slide(m.h, m.v || 0, f)
	}
}

export const goMessage = r => {
	const i = r.getIndices()
	return { type: 'go', h: i.h, v: i.v || 0, f: i.f ?? null }
}
