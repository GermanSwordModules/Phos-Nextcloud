/**
 * A Phos Desktop slide deck (presentation record, field `deck`) → reveal.js
 * sections. Port of BVC unit_presrender.pas (RenderBlock, BulletsHtml,
 * SlideTextHtml, ApplyVerseSteps, ThemeVars) so a deck looks the same in the
 * browser as on the desktop; web/reveal/theme/phos.css is shared (scoped copy).
 *
 * Slide markup contract (as on the desktop):
 *   <section data-slide="<id>" data-idx="<n>" class="phos-titleslide|phos-fill">
 *     <div class="phos-slidebody [phos-cols2|phos-cols3]"> blocks </div>
 *     <aside class="notes"> … </aside>
 *   </section>
 */
import { THEMES } from './themes.js'

export { THEMES }

/** Hard cap on verses in one passage block (desktop MAX_PRES_VERSES). */
export const MAX_PRES_VERSES = 80

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** **bold**, *italic*, [text](https://…) — escaped first (desktop InlineMd). */
export function inlineMd(s) {
	let h = esc(s)
	h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
	h = h.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
	h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
	return h
}

/** Bullet lines → nested <ul>, one level deep (tab or two spaces = sub-bullet). */
export function bulletsHtml(src, step) {
	const items = []
	for (const line of String(src || '').split(/\r?\n/)) {
		if (!line.trim()) {
			continue
		}
		let lvl = line.startsWith('\t') || line.startsWith('  ') ? 1 : 0
		let txt = line.trim()
		if (txt.length > 1 && (txt[0] === '-' || txt[0] === '*') && txt[1] === ' ') {
			txt = txt.slice(2).trim()
		}
		if (!txt) {
			continue
		}
		if (lvl === 1 && !items.length) {
			lvl = 0
		}
		items.push({ lvl, txt })
	}
	if (!items.length) {
		return ''
	}
	const cls = step === 'bullet' ? ' class="fragment"' : ''
	let h = `<ul><li${cls}>` + inlineMd(items[0].txt)
	let prev = items[0].lvl
	for (const it of items.slice(1)) {
		if (it.lvl > prev) {
			h += `<ul><li${cls}>` + inlineMd(it.txt)
		} else if (it.lvl < prev) {
			h += `</li></ul></li><li${cls}>` + inlineMd(it.txt)
		} else {
			h += `</li><li${cls}>` + inlineMd(it.txt)
		}
		prev = it.lvl
	}
	if (prev > 0) {
		h += '</li></ul>'
	}
	return h + '</li></ul>'
}

/** Free prose: paragraphs, #/##/### headings, "> " quotes, "- " lists (desktop SlideTextHtml). */
export function slideTextHtml(md) {
	let out = ''
	let para = ''
	let bullets = ''
	const flushPara = () => {
		if (para.trim()) {
			out += '<p>' + inlineMd(para.trim()) + '</p>'
		}
		para = ''
	}
	const flushBullets = () => {
		if (bullets) {
			out += bulletsHtml(bullets, 'none')
			bullets = ''
		}
	}
	for (const raw of String(md || '').replace(/\r\n?/g, '\n').split('\n')) {
		const t = raw.trim()
		if (!t) {
			flushBullets()
			flushPara()
			continue
		}
		if (t.startsWith('- ') || t.startsWith('* ')) {
			flushPara()
			bullets += (bullets ? '\n' : '') + raw
			continue
		}
		flushBullets()
		if (t.startsWith('> ')) {
			flushPara()
			out += '<blockquote>' + inlineMd(t.slice(2).trim()) + '</blockquote>'
			continue
		}
		const hm = /^(#{1,3}) (.+)$/.exec(t)
		if (hm) {
			flushPara()
			out += `<h3 class="phos-h${hm[1].length}">` + inlineMd(hm[2].trim()) + '</h3>'
			continue
		}
		para += (para ? ' ' : '') + t
	}
	flushBullets()
	flushPara()
	return out
}

/** Every verse its own step, and/or named verses ("v8_1" per line) painted on arrival. */
export function applyVerseSteps(body, step, highlight) {
	let r = body
	if (step === 'verse') {
		r = r.replaceAll('<span class="verse" ', '<span class="fragment verse" ')
	}
	for (const id of String(highlight || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
		r = r.replaceAll(`<span class="verse" id="${id}"`, `<span class="fragment phos-hl verse" id="${id}"`)
		r = r.replaceAll(`<span class="fragment verse" id="${id}"`, `<span class="fragment phos-hl verse" id="${id}"`)
	}
	return r
}

/** 'Rom.8.1-Rom.8.4' | 'Rom.8.1-4' | 'Rom.8.1' → {book, c1, v1, c2, v2} (one book; else the start verse). */
export function parseOsisRange(osis) {
	const [a, b] = String(osis || '').split('-').map(s => s.trim())
	const m = /^([1-4]?[A-Za-z]+)\.(\d+)\.(\d+)$/.exec(a || '')
	if (!m) {
		return null
	}
	const r = { book: m[1], c1: +m[2], v1: +m[3], c2: +m[2], v2: +m[3] }
	if (b) {
		const e = /^([1-4]?[A-Za-z]+)\.(\d+)\.(\d+)$/.exec(b)
		if (e && e[1] === r.book) {
			r.c2 = +e[2]
			r.v2 = +e[3]
		} else if (/^\d+$/.test(b)) {
			r.v2 = +b
		}
	}
	if (r.c2 < r.c1 || (r.c2 === r.c1 && r.v2 < r.v1)) {
		r.c2 = r.c1
		r.v2 = r.v1
	}
	return r
}

/**
 * Theme tokens → CSS custom properties (desktop ThemeVars).
 * @param {object} t theme
 * @param {(path:string) => string|null} [image] URL of the background picture; none → flat colour like the desktop
 */
export function themeVars(t = {}, image = null) {
	const c = (v, d) => (v && String(v).trim()) || d
	let bg = 'none'
	if (t.bgMode === 'gradient') {
		bg = `linear-gradient(160deg,${c(t.bg, '#ffffff')} 0%,${c(t.bgStop2, t.bg || '#ffffff')} 100%)`
	} else if (t.bgMode === 'image' && t.bgImage && image) {
		const url = image(t.bgImage)
		if (url) {
			bg = `url("${url.replace(/["\\\n]/g, '')}")`
		}
	}
	return {
		'--pres-bg': c(t.bg, '#ffffff'),
		'--pres-fg': c(t.fg, '#1c2833'),
		'--pres-accent': c(t.accent, '#2874a6'),
		'--pres-muted': c(t.muted, '#7f8c8d'),
		'--pres-versenum': c(t.verseNum, '#95a5a6'),
		'--pres-highlight': c(t.highlight, '#fff3a0'),
		'--pres-heading-font': c(t.headingFont, 'Arial, sans-serif'),
		'--pres-body-font': c(t.bodyFont, 'Arial, sans-serif'),
		'--pres-verse-font': c(t.verseFont, 'Georgia, serif'),
		'--pres-base-size': (t.baseSize > 0 ? t.baseSize : 28) + 'pt',
		'--pres-bg-image': bg,
		'--pres-logo-opacity': String((t.logoOpacity ?? 100) / 100),
	}
}

export const themeOf = name => THEMES[name] || THEMES.Hell

const CORNERS = { tl: 'phos-logo-tl', tr: 'phos-logo-tr', bl: 'phos-logo-bl', br: 'phos-logo-br' }
/** The theme's logo overlay (desktop DeckChrome), or null. */
export function deckLogo(t = {}, image = null) {
	const corner = CORNERS[t.logoCorner]
	const url = corner && t.logo && image ? image(t.logo) : null
	return url ? { url, cls: corner, height: (t.logoHeight > 0 ? t.logoHeight : 8) } : null
}

/**
 * @param {object} deck the desktop deck {title, theme, slides:[{id,title,notes,layout,theme,blocks}]}
 * @param {object} io
 * @param {(module:string, osis:string, opts:{strongs:boolean}) => Promise<{html:string, ref:string, rtl?:boolean}|null>} io.passage
 *        verses as `<span class="verse" id="vC_V"><span class="phos-vnum">V</span>…</span> `
 * @param {(path:string) => string|null} io.image URL for a block's picture, or null (missing)
 * @param {(name:string) => object} [io.theme] a theme by name (default: the built-ins)
 * @param {(html:string) => string} io.sanitize clean frozen HTML (capture blocks)
 * @returns {Promise<string[]>} one <section> per slide
 */
export async function renderDeck(deck, io) {
	const slides = Array.isArray(deck?.slides) ? deck.slides : []
	const out = []
	for (let i = 0; i < slides.length; i++) {
		out.push(await renderSlide(slides[i], i, io))
	}
	if (!out.length) {
		out.push(`<section class="phos-titleslide"><div class="phos-slidebody"><h1 class="phos-title">${esc(deck?.title)}</h1></div></section>`)
	}
	return out
}

async function renderBlock(b, io) {
	const opts = String(b.opts || '')
	let h = ''
	switch (b.kind) {
	case 'title':
		if ((b.text || '').trim()) {
			h = `<h1 class="phos-title">${esc(b.text)}</h1>`
		}
		break
	case 'subtitle':
		if ((b.text || '').trim()) {
			h = `<p class="phos-subtitle">${esc(b.text)}</p>`
		}
		break
	case 'bullets': {
		const body = bulletsHtml(b.text, b.step)
		if (body) {
			h = `<div class="phos-block phos-bullets">${body}</div>`
		}
		break
	}
	case 'passage': {
		const p = await io.passage(b.module, b.osis, { strongs: opts.includes('"strongs":true') })
		if (!p?.html) {
			break
		}
		const lines = opts.includes('"lines":true')
		const body = `<div class="phos-verses${lines ? ' phos-lines' : ''}"${p.rtl ? ' dir="rtl"' : ''}>${applyVerseSteps(p.html, b.step, b.highlight)}</div>`
		h = `<div class="phos-block phos-passage${opts.includes('"quote":true') ? ' phos-quote' : ''}">`
			+ `<div class="phos-ref">${esc(p.ref)} <span class="phos-mod">(${esc(b.module)})</span></div>${body}</div>`
		break
	}
	case 'capture':
		if ((b.html || '').trim()) {
			h = `<div class="phos-block phos-capture">${io.sanitize(b.html)}</div>`
		}
		break
	case 'image':
		if (b.image) {
			const url = io.image(b.image)
			const name = String(b.image).split(/[\\/]/).pop()
			h = url
				? `<div class="phos-block phos-image"><img src="${esc(url)}" alt="">${(b.text || '').trim() ? `<div class="phos-caption">${esc(b.text)}</div>` : ''}</div>`
				: `<div class="phos-block phos-image"><p class="phos-caption">${esc('Bild fehlt: ' + name)}</p></div>`
		}
		break
	case 'spacer':
		h = '<div class="phos-spacer"></div>'
		break
	default: // 'text' and anything unknown, as the desktop reads it
		if ((b.text || '').trim()) {
			h = `<div class="phos-block phos-text">${slideTextHtml(b.text)}</div>`
		}
	}
	if (h && b.step === 'block') {
		h = `<div class="fragment">${h}</div>`
	}
	return h
}

async function renderSlide(s, idx, io) {
	let body = ''
	let onlyHeadings = true
	for (const b of s.blocks || []) {
		const frag = await renderBlock(b, io)
		if (!frag) {
			continue
		}
		if (!['title', 'subtitle', 'spacer'].includes(b.kind)) {
			onlyHeadings = false
		}
		body += frag
	}
	const cls = onlyHeadings && body ? 'phos-titleslide' : 'phos-fill'
	const lay = s.layout === 'cols2' ? ' phos-cols2' : s.layout === 'cols3' ? ' phos-cols3' : ''
	let style = ''
	if (s.theme) {
		const vars = themeVars(io.theme ? io.theme(s.theme) : themeOf(s.theme), io.image)
		style = ` data-theme="${esc(s.theme)}" style="${esc(Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';'))}"`
	}
	let h = `<section data-slide="${esc(s.id)}" data-idx="${idx}" class="${cls}"${style}><div class="phos-slidebody${lay}">${body}</div>`
	if ((s.notes || '').trim()) {
		h += `<aside class="notes">${slideTextHtml(s.notes)}</aside>`
	}
	return h + '</section>'
}
