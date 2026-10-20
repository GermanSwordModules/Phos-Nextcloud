/**
 * RTF → HTML for the documents Phos Desktop writes (RichMemo: exegeses, project
 * notes and syntheses). Read-only view, not a general RTF engine.
 *
 * Handled: paragraphs (\par, \pard, \li, \sb, \sa), \b \i \ul \ulnone \strike,
 * \fs (relative sizes), \cf with the colour table, \u<n> with its fallback
 * skipped (\uc), \'hh in the document code page (cp1252), \line, \tab, groups.
 * Skipped: font/colour/stylesheet tables, \* destinations, pictures, fields'
 * instructions (their result is kept).
 *
 * Output is built from text nodes the converter escapes itself — nothing from
 * the RTF reaches the page as markup.
 */

const CP1252 = {
	0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
	0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018,
	0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC,
	0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
}

const SKIP_DEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'fldinst', 'themedata',
	'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'listtable', 'listoverridetable',
	'rsidtbl', 'generator', 'header', 'footer', 'headerl', 'headerr', 'footerl', 'footerr', 'object', 'nonshppict'])

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function parseColors(rtf) {
	const m = /\{\\colortbl\s*;?([^}]*)\}/.exec(rtf)
	const out = [null]   // index 0 = automatic
	if (!m) {
		return out
	}
	for (const part of m[1].split(';')) {
		const r = /\\red(\d+)/.exec(part)
		const g = /\\green(\d+)/.exec(part)
		const b = /\\blue(\d+)/.exec(part)
		if (r || g || b) {
			out.push(`rgb(${r ? r[1] : 0},${g ? g[1] : 0},${b ? b[1] : 0})`)
		}
	}
	return out
}

/** @returns {string} HTML (paragraphs with inline spans) */
export function rtfToHtml(rtf) {
	if (typeof rtf !== 'string' || !rtf.startsWith('{\\rtf')) {
		// not RTF (plain text or an older note): show it as text
		return (rtf || '').split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
	}
	const colors = parseColors(rtf)
	const base = { b: false, i: false, u: false, s: false, fs: 24, cf: 0, skip: false, uc: 1 }
	let st = { ...base }
	const stack = []
	const paras = []
	let para = { li: 0, sb: 0, sa: 0, runs: [] }
	let text = ''
	let pendingSkip = 0       // characters to skip after \u (fallback)
	let sizes = new Map()     // fs → count of characters, to find the body size

	const flushText = () => {
		if (!text) {
			return
		}
		para.runs.push({ text, b: st.b, i: st.i, u: st.u, s: st.s, fs: st.fs, cf: st.cf })
		sizes.set(st.fs, (sizes.get(st.fs) || 0) + text.length)
		text = ''
	}
	const endPara = () => {
		flushText()
		paras.push(para)
		para = { li: para.li, sb: para.sb, sa: para.sa, runs: [] }
	}
	const put = ch => {
		if (st.skip) {
			return
		}
		if (pendingSkip > 0) {
			pendingSkip--
			return
		}
		text += ch
	}

	let i = 0
	const n = rtf.length
	while (i < n) {
		const c = rtf[i]
		if (c === '{') {
			flushText()
			stack.push(st)
			st = { ...st }
			i++
			// {\*\dest …} is ignorable
			if (rtf.startsWith('\\*', i)) {
				st.skip = true
			}
			continue
		}
		if (c === '}') {
			flushText()
			st = stack.pop() || { ...base }
			i++
			continue
		}
		if (c === '\\') {
			const nx = rtf[i + 1]
			if (nx === '\\' || nx === '{' || nx === '}') {
				put(nx)
				i += 2
				continue
			}
			if (nx === '\'') {
				const code = parseInt(rtf.substr(i + 2, 2), 16)
				i += 4
				if (!Number.isNaN(code)) {
					put(String.fromCharCode(CP1252[code] || code))
				}
				continue
			}
			if (nx === '~') {
				put(' '); i += 2; continue
			}
			if (nx === '-' || nx === '_') {
				if (nx === '_') {
					put('‑')
				}
				i += 2
				continue
			}
			if (nx === '\n' || nx === '\r') {
				if (!st.skip) {
					endPara()
				}
				i += 2
				continue
			}
			const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40))
			if (!m) {
				i += 2
				continue
			}
			i += m[0].length
			const word = m[1]
			const arg = m[2] === undefined ? null : parseInt(m[2], 10)
			if (SKIP_DEST.has(word)) {
				st.skip = true
				continue
			}
			if (st.skip) {
				continue
			}
			switch (word) {
			case 'par': endPara(); break
			case 'line': put('\n'); break
			case 'tab': put('\t'); break
			case 'pard': flushText(); para.li = 0; para.sb = 0; para.sa = 0; break
			case 'plain': flushText(); Object.assign(st, { b: false, i: false, u: false, s: false, fs: 24, cf: 0 }); break
			case 'li': para.li = arg || 0; break
			case 'sb': para.sb = arg || 0; break
			case 'sa': para.sa = arg || 0; break
			case 'b': flushText(); st.b = arg !== 0; break
			case 'i': flushText(); st.i = arg !== 0; break
			case 'ul': flushText(); st.u = arg !== 0; break
			case 'ulnone': flushText(); st.u = false; break
			case 'strike': flushText(); st.s = arg !== 0; break
			case 'fs': flushText(); st.fs = arg || 24; break
			case 'cf': flushText(); st.cf = arg || 0; break
			case 'uc': st.uc = arg ?? 1; break
			case 'u': {
				let cp = arg ?? 0
				if (cp < 0) {
					cp += 65536
				}
				put(String.fromCodePoint(cp))
				pendingSkip = st.uc
				break
			}
			case 'emdash': put('—'); break
			case 'endash': put('–'); break
			case 'bullet': put('•'); break
			case 'lquote': put('‘'); break
			case 'rquote': put('’'); break
			case 'ldblquote': put('“'); break
			case 'rdblquote': put('”'); break
			default: break
			}
			continue
		}
		if (c === '\r' || c === '\n') {
			i++
			continue
		}
		put(c)
		i++
	}
	flushText()
	if (para.runs.length) {
		paras.push(para)
	}

	// the most used size is the body text; others are shown relative to it
	let body = 24
	let most = -1
	for (const [fs, cnt] of sizes) {
		if (cnt > most) {
			most = cnt
			body = fs
		}
	}
	const out = []
	for (const p of paras) {
		const style = []
		if (p.li > 0) {
			style.push(`margin-left:${(p.li / 20).toFixed(0)}pt`)
		}
		if (p.sb > 0) {
			style.push(`margin-top:${(p.sb / 20).toFixed(0)}pt`)
		}
		const runs = p.runs.filter(r => r.text.length)
		if (!runs.length) {
			out.push('<p class="rtf-empty"></p>')
			continue
		}
		// a paragraph in one size well above the body text is a heading
		const big = runs.every(r => r.fs >= body * 1.3 || !r.text.trim())
		const inner = runs.map(r => {
			let h = esc(r.text).replace(/\n/g, '<br>').replace(/\t/g, '&emsp;')
			const css = []
			if (r.fs !== body && !big) {
				css.push(`font-size:${(r.fs / body).toFixed(2)}em`)
			}
			if (r.cf && colors[r.cf]) {
				css.push(`color:${colors[r.cf]}`)
			}
			if (r.b && !big) {
				h = `<strong>${h}</strong>`
			}
			if (r.i) {
				h = `<em>${h}</em>`
			}
			if (r.u) {
				h = `<u>${h}</u>`
			}
			if (r.s) {
				h = `<s>${h}</s>`
			}
			return css.length ? `<span style="${css.join(';')}">${h}</span>` : h
		}).join('')
		const tag = big ? (runs[0].fs >= body * 1.6 ? 'h3' : 'h4') : 'p'
		out.push(`<${tag}${style.length ? ` style="${style.join(';')}"` : ''}>${inner}</${tag}>`)
	}
	return out.join('')
}
