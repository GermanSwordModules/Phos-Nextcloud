/**
 * Bookmark/note list export (Markdown, HTML, plain text) -- the list as currently filtered and
 * sorted. `fmt` supplies the display helpers the view already has: ref(bm), labels(bm) -> names,
 * date(bm), note(bm) -> plain note text.
 */

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export const EXPORT_FORMATS = {
	md: { ext: 'md', mime: 'text/markdown' },
	html: { ext: 'html', mime: 'text/html' },
	txt: { ext: 'txt', mime: 'text/plain' },
}

export function exportBookmarks(list, format, fmt, title) {
	const rows = list.map(bm => ({
		ref: fmt.ref(bm),
		labels: fmt.labels(bm),
		date: fmt.date(bm),
		snippet: bm.snippetText || '',
		note: fmt.note(bm),
	}))
	if (format === 'md') {
		return `# ${title}\n\n` + rows.map(r => [
			`## ${r.ref}`,
			[r.labels.map(l => `\`${l}\``).join(' '), r.date].filter(Boolean).join(' · '),
			r.snippet && `> ${r.snippet}`,
			r.note,
		].filter(Boolean).join('\n\n')).join('\n\n') + '\n'
	}
	if (format === 'html') {
		return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>`
			+ `<h1>${esc(title)}</h1>`
			+ rows.map(r => `<section><h2>${esc(r.ref)}</h2>`
				+ ((r.labels.length || r.date) ? `<p><small>${esc([r.labels.join(', '), r.date].filter(Boolean).join(' · '))}</small></p>` : '')
				+ (r.snippet ? `<blockquote>${esc(r.snippet)}</blockquote>` : '')
				+ (r.note ? `<p>${esc(r.note).replace(/\n/g, '<br>')}</p>` : '')
				+ '</section>').join('')
			+ '</body></html>\n'
	}
	return `${title}\n${'='.repeat(title.length)}\n\n` + rows.map(r => [
		r.ref + (r.labels.length ? `  [${r.labels.join(', ')}]` : '') + (r.date ? `  ${r.date}` : ''),
		r.snippet && `  „${r.snippet}“`,
		r.note && r.note.split('\n').map(l => '  ' + l).join('\n'),
	].filter(Boolean).join('\n')).join('\n\n') + '\n'
}
