import { fold, termMatches } from './fold.js'

/**
 * Marks search hits in rendered HTML (string in, string out, so it runs
 * without a DOM): words matching a term get <mark>, words carrying a
 * searched Strong's number (data-lemma) the class phos-hit.
 */
export function highlight(html, { terms = [], strongs = [] } = {}) {
	if (!terms.length && !strongs.length) {
		return html
	}
	const lemmaRe = strongs.length ? new RegExp(`\\b(?:strong:)?(?:${strongs.map(s => s[0] + '0*' + s.slice(1)).join('|')})(?![0-9])`, 'i') : null
	return String(html).split(/(<[^>]+>)/).map(part => {
		if (part.startsWith('<')) {
			if (lemmaRe && /^<span\b[^>]*class="phos-w"/.test(part)) {
				const lemma = /data-lemma="([^"]*)"/.exec(part)?.[1] || ''
				if (lemmaRe.test(lemma)) {
					return part.replace('class="phos-w"', 'class="phos-w phos-hit"')
				}
			}
			return part
		}
		if (!terms.length) {
			return part
		}
		// entities stay as they are; words between them are checked
		return part.split(/(&#?\w+;)/).map(seg => seg.startsWith('&') && seg.endsWith(';')
			? seg
			: seg.replace(/[\p{L}\p{N}\p{M}]+/gu, w => terms.some(t => termMatches(t, fold(w))) ? `<mark>${w}</mark>` : w)).join('')
	}).join('')
}
