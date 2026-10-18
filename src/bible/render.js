/**
 * Entry markup (OSIS, ThML, TEI) → safe HTML: a subset of the Phos
 * renderer. The markup is parsed (tags renamed to x-… so the HTML parser
 * applies no HTML rules to them), walked, and only whitelisted output is
 * produced; every text and attribute is escaped.
 *
 * Result: { html, headings: [html], notes: [{id, label, type, html}] }
 *   headings — <title>s lifted out of the verse (shown above it)
 *   notes    — footnotes / cross references; the text holds a marker
 *              <sup class="phos-note" data-note="id">label</sup>
 */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const SAME = new Set(['i', 'b', 'u', 'em', 'strong', 'sup', 'sub', 'small', 'br', 'p', 'ul', 'ol', 'li',
	'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'pre', 'dl', 'dt', 'dd'])
const HI = { italic: 'i', bold: 'b', underline: 'u', super: 'sup', sub: 'sub', emphasis: 'em' }

function prepare(markup) {
	return String(markup)
		.replace(/<!--[\s\S]*?-->/g, '')
		// <tag … /> → <tag …></tag>, then every tag → x-tag
		.replace(/<([A-Za-z][\w:.-]*)((?:\s+[^<>]*?)?)\/>/g, '<$1$2></$1>')
		.replace(/<(\/?)([A-Za-z][\w:.-]*)/g, '<$1x-$2')
}

let noteSeq = 0

export function render(markup, { sourceType = 'OSIS', noteLabels = 'abcdefghijklmnopqrstuvwxyz' } = {}) {
	const out = { html: '', headings: [], notes: [] }
	if (!markup) {
		return out
	}
	const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${prepare(markup)}</body></html>`, 'text/html')
	const tei = /tei/i.test(sourceType)
	let fnCount = 0

	// attribute names are case-insensitive here (osisRef / osisref, sID / sid)
	const attr = (el, n) => {
		for (const a of el.attributes) {
			if (a.name.toLowerCase() === n) {
				return a.value
			}
		}
		return ''
	}

	function children(el, ctx) {
		let s = ''
		for (const c of el.childNodes) {
			s += node(c, ctx)
		}
		return s
	}

	function node(n, ctx) {
		if (n.nodeType === 3) {
			return esc(n.nodeValue)
		}
		if (n.nodeType !== 1) {
			return ''
		}
		const name = n.localName.startsWith('x-') ? n.localName.slice(2) : n.localName
		const kids = () => children(n, ctx)
		switch (name) {
		case 'title': {
			if (tei || ctx.inNote) {
				return `<i>${kids()}</i>`
			}
			const h = kids().trim()
			if (h) {
				out.headings.push(h)
			}
			return ''
		}
		case 'note': {
			if (ctx.inNote) {
				return kids()
			}
			const type = attr(n, 'type')
			const id = `n${++noteSeq}`
			const html = children(n, { ...ctx, inNote: true }).trim()
			if (!html) {
				return ''
			}
			const cross = type === 'crossReference'
			const label = attr(n, 'n') || (cross ? '†' : noteLabels[fnCount++ % noteLabels.length])
			out.notes.push({ id, label, type: cross ? 'xref' : 'note', html })
			return `<sup class="phos-note${cross ? ' phos-note--xref' : ''}" data-note="${id}" tabindex="0">${esc(label)}</sup>`
		}
		case 'q':
			return attr(n, 'who').toLowerCase() === 'jesus'
				? `<span class="phos-jesus">${kids()}</span>`
				: esc(attr(n, 'marker')) + kids()
		case 'w': {
			const lemma = attr(n, 'lemma').split(/\s+/).filter(x => x.startsWith('strong:')).map(x => x.slice(7)).join(' ')
			const morph = attr(n, 'morph')
			if (!lemma && !morph) {
				return kids()
			}
			return `<span class="phos-w" data-lemma="${esc(lemma)}" data-morph="${esc(morph)}">${kids()}</span>`
		}
		case 'reference':
		case 'ref': {
			const ref = attr(n, 'osisref') || attr(n, 'target').replace(/^[^:]*:/, '')
			const text = kids()
			return ref ? `<a class="phos-ref" data-ref="${esc(ref)}" href="#">${text || esc(ref)}</a>` : text
		}
		case 'scripref': {
			const ref = attr(n, 'passage')
			const text = kids()
			return ref ? `<a class="phos-ref" data-ref="${esc(ref)}" href="#">${text || esc(ref)}</a>` : text
		}
		case 'a': {
			const href = attr(n, 'href')
			const m = /^sword:\/\/([^/]+)\/(.+)$/.exec(href)
			if (m) {
				return `<a class="phos-dict" data-module="${esc(decodeURIComponent(m[1]))}" data-key="${esc(decodeURIComponent(m[2]))}" href="#">${kids()}</a>`
			}
			return kids()
		}
		case 'transchange':
			return `<i class="phos-added">${kids()}</i>`
		case 'divinename':
			return `<span class="phos-divine">${kids()}</span>`
		case 'hi': {
			const t = attr(n, 'type') || attr(n, 'rend')
			if (t === 'small-caps') {
				return `<span class="phos-divine">${kids()}</span>`
			}
			const tag = HI[t]
			return tag ? `<${tag}>${kids()}</${tag}>` : kids()
		}
		case 'emph':
		case 'catchword':
		case 'pron':
		case 'pos':
			return `<i>${kids()}</i>`
		case 'orth':
		case 'speaker':
			return `<b>${kids()}</b>`
		case 'lb':
			return '<br>' + kids()
		case 'l': {
			const inner = kids()
			return inner ? `<span class="phos-l">${inner}</span><br>` : (attr(n, 'eid') ? '<br>' : '')
		}
		case 'lg':
			return `<span class="phos-lg">${kids()}</span>`
		case 'milestone':
			return (attr(n, 'type') === 'x-p' ? '<span class="phos-pmark"></span>' : '') + kids()
		case 'script':
		case 'style':
			return ''
		case 'sync':
		case 'figure':
		case 'img':
		case 'hr':
			// void in ThML/HTML: when written unclosed, what follows ends up inside
			return kids()
		case 'item':
			return `<li>${kids()}</li>`
		case 'list':
			return `<ul>${kids()}</ul>`
		case 'row':
			return `<tr>${kids()}</tr>`
		case 'cell':
			return `<td>${kids()}</td>`
		default:
			if (SAME.has(name)) {
				return name === 'br' ? '<br>' + kids() : `<${name}>${kids()}</${name}>`
			}
			// chapter, div, verse, seg, foreign, entry, sense, def, font, span, … : content only
			return kids()
		}
	}

	// paragraph ends (<lb/>) at the edges of an entry would only add blank lines
	out.html = children(doc.body, { inNote: false }).trim().replace(/^(<br>\s*)+|(\s*<br>)+$/g, '')
	return out
}
