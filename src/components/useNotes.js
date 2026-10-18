import { ref } from 'vue'
import { render } from '../bible/render.js'
import { getEntry, lexiconsFor } from '../services/phos.js'

/**
 * Popovers for footnotes and Strong's numbers inside rendered text.
 * The text container delegates clicks/hovers here; notes are looked up by
 * the data-note id among the notes the renderer returned.
 */
export function useTextPopover() {
	const popover = ref(null)  // { x, y, title, html }
	let hoverTimer = null

	function place(el) {
		const r = el.getBoundingClientRect()
		const x = Math.min(r.left, window.innerWidth - 440)
		const below = r.bottom + 6
		return { x: Math.max(8, x), y: below + 200 > window.innerHeight ? Math.max(8, r.top - 210) : below }
	}

	function showNote(el, note) {
		popover.value = { ...place(el), title: note.type === 'xref' ? 'xref' : 'note', html: note.html, pinned: true }
	}

	async function showStrong(el, lemma) {
		const nums = lemma.split(/\s+/).filter(Boolean)
		if (!nums.length) {
			return
		}
		const at = place(el)
		popover.value = { ...at, title: nums.join(' '), html: '…' }
		const parts = []
		for (const num of nums) {
			let html = `<i>${num.replace(/[^\w]/g, '')}</i>`
			for (const lex of lexiconsFor(num)) {   // the first lexicon that has the entry
				try {
					const e = await getEntry(lex.name, num)
					html = render(e.text, { sourceType: lex.sourceType }).html
					break
				} catch {
					// not in this one
				}
			}
			parts.push(html)
		}
		if (popover.value && popover.value.title === nums.join(' ')) {
			popover.value = { ...at, title: nums.join(' '), html: parts.join('<hr>') }
		}
	}

	function hoverStrong(el) {
		clearTimeout(hoverTimer)
		const lemma = el?.dataset?.lemma
		if (!lemma) {
			if (popover.value && !popover.value.pinned) {
				hoverTimer = setTimeout(() => { if (!popover.value?.pinned) popover.value = null }, 250)
			}
			return
		}
		hoverTimer = setTimeout(() => showStrong(el, lemma), 350)
	}

	function close() {
		clearTimeout(hoverTimer)
		popover.value = null
	}

	return { popover, showNote, showStrong, hoverStrong, close }
}
