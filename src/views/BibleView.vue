<template>
	<div class="bible">
		<div class="bible__bar">
			<NcSelect v-model="moduleSel"
				class="bible__module"
				:options="bibleOptions"
				:clearable="false"
				:selectable="o => !o.locked"
				:input-label="t('phos', 'Bible')"
				label="label" />
			<NcSelect v-model="parallelSel"
				class="bible__module"
				:options="bibleOptions"
				:selectable="o => !o.locked"
				:input-label="t('phos', 'Parallel text')"
				:placeholder="t('phos', 'none')"
				label="label" />
			<form class="bible__goto" @submit.prevent="gotoInput">
				<NcTextField v-model="refInput"
					:label="t('phos', 'Go to (e.g. Joh 3,16)')"
					:error="refError"
					:show-trailing-button="!!refInput"
					trailing-button-icon="arrowEnd"
					@trailing-button-click="gotoInput" />
			</form>
		</div>
		<div v-if="book" class="bible__nav">
			<NcButton variant="tertiary" :disabled="!prevChapter" :aria-label="t('phos', 'Previous chapter')" @click="go(prevChapter)">
				<template #icon>
					<NcIconSvgWrapper :path="iconPrev" />
				</template>
			</NcButton>
			<NcSelect v-model="bookSel"
				class="bible__book"
				:options="bookOptions"
				:clearable="false"
				:aria-label-combobox="t('phos', 'Book')"
				label="label" />
			<NcSelect v-model="chapterSel"
				class="bible__chapter"
				:options="chapterOptions"
				:clearable="false"
				:aria-label-combobox="t('phos', 'Chapter')" />
			<NcButton variant="tertiary" :disabled="!nextChapter" :aria-label="t('phos', 'Next chapter')" @click="go(nextChapter)">
				<template #icon>
					<NcIconSvgWrapper :path="iconNext" />
				</template>
			</NcButton>
			<NcCheckboxRadioSwitch v-model="versePerLine" type="switch" class="bible__vpl">
				{{ t('phos', 'Verse per line') }}
			</NcCheckboxRadioSwitch>
		</div>

		<NcEmptyContent v-if="!bibles.length"
			:name="t('phos', 'No Bible on the server yet')"
			:description="t('phos', 'Bibles appear here once you store them online in Phos Desktop (library → right-click a module → “Online speichern (Nextcloud)”).')" />
		<NcEmptyContent v-else-if="error" :name="t('phos', 'This text cannot be shown')" :description="error" />
		<div v-else-if="loading" class="bible__loading">
			<NcLoadingIcon :size="32" />
		</div>
		<div v-else
			ref="textEl"
			class="bible__text phos-text"
			:class="{ 'bible__text--parallel': columns.length > 1, 'bible__text--flow': !versePerLine && columns.length === 1 }"
			:dir="columns.length === 1 && columns[0].rtl ? 'rtl' : null"
			:style="{ '--cols': columns.length }"
			@click="onTextClick"
			@mouseover="onHover">
			<div v-if="columns.length > 1" class="bible__row bible__row--head">
				<div v-for="c in columns" :key="c.module" class="bible__colhead">
					{{ c.module }}
				</div>
			</div>
			<div v-if="hasIntro" class="bible__row">
				<div v-for="c in columns" :key="c.module" class="bible__cell" :dir="c.rtl ? 'rtl' : null">
					<div v-for="(h, i) in c.intro" :key="i" class="phos-heading phos-heading--intro" v-html="h" />
				</div>
			</div>
			<div v-for="v in verseNumbers"
				:key="v"
				:data-v="v"
				class="bible__row"
				:class="{ 'bible__row--selected': inSelection(v) }">
				<div v-for="c in columns" :key="c.module" class="bible__cell" :dir="c.rtl ? 'rtl' : null">
					<div v-for="(h, i) in c.verses[v]?.headings || []" :key="i" class="phos-heading" v-html="h" />
					<span class="bible__verse" :style="verseStyle(v)">
						<button type="button"
							class="bible__vnum"
							:title="t('phos', 'Bookmark / note')"
							:data-verse="v">{{ v }}</button>
						<span v-if="c.verses[v]?.html" v-html="c.verses[v].html" />
						<span v-else-if="c.verses[v]?.linkedTo" class="bible__linked">{{ t('phos', 'see verse {v}', { v: c.verses[v].linkedTo }) }}</span>
						<button v-if="noteVerses.has(v) && c === columns[0]"
							type="button"
							class="bible__notemark"
							:title="t('phos', 'Has a note')"
							:data-verse="v">✎</button>
					</span>
				</div>
			</div>
		</div>

		<TextPopover :popover="pop.popover.value"
			@keep="pinPopover"
			@ref="gotoRef"
			@dict="showDict" />

		<!-- the sidebar belongs next to NcAppContent, not inside it -->
		<Teleport to="#content-vue">
			<NcAppSidebar v-if="selection"
			:name="selectionLabel"
			:subname="t('phos', 'Bookmarks and notes')"
			@close="selection = null">
			<div class="bible__sidebar">
				<BookmarkPanel :book="book"
					:chapter="chapter"
					:from="selection.from"
					:to="selection.to"
					:module="moduleName" />
				</div>
			</NcAppSidebar>
		</Teleport>
	</div>
</template>

<script setup>
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcAppSidebar from '@nextcloud/vue/components/NcAppSidebar'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import TextPopover from '../components/TextPopover.vue'
import BookmarkPanel from '../components/BookmarkPanel.vue'
import { useTextPopover } from '../components/useNotes.js'
import { render } from '../bible/render.js'
import { bookName, formatRef, parseRef, registerBookName } from '../bible/books.js'
import {
	bibles, modules, getBooks, getChapter, getEntry, defaultBible, prefs, lang,
	bookmarksIn, labels,
} from '../services/phos.js'
import { iconPrev, iconNext } from '../icons.js'

const route = useRoute()
const router = useRouter()

const moduleName = computed(() => route.params.module || defaultBible())
const book = computed(() => route.params.book || null)
const chapter = computed(() => Number(route.params.chapter) || 1)
const parallelName = computed(() => route.query.p || '')

const books = ref([])           // books of the main module
const columns = ref([])         // [{ module, rtl, intro: [html], verses: {v: {html, headings, linkedTo}} }]
const notes = new Map()          // note id → note
const loading = ref(false)
const error = ref('')
const refInput = ref('')
const refError = ref(false)
const selection = ref(null)     // { from, to }
const textEl = ref(null)
const versePerLine = ref(prefs.get('versePerLine', true))
watch(versePerLine, v => prefs.set('versePerLine', v))
const pop = useTextPopover()

const bibleOptions = computed(() => bibles.value.map(m => ({
	id: m.name, label: m.locked ? `🔒 ${m.name} – ${m.description}` : `${m.name} – ${m.description}`, locked: m.locked,
})))
const moduleSel = computed({
	get: () => bibleOptions.value.find(o => o.id === moduleName.value) || null,
	set: o => { if (o) { prefs.set('bible', o.id); go({ module: o.id }) } },
})
const parallelSel = computed({
	get: () => bibleOptions.value.find(o => o.id === parallelName.value) || null,
	set: o => go({ p: o?.id || '' }),
})
const bookOptions = computed(() => books.value.map(b => ({ id: b.osis, label: bookName(b.osis, lang, b.name) })))
const bookSel = computed({
	get: () => bookOptions.value.find(o => o.id === book.value) || null,
	set: o => o && go({ book: o.id, chapter: 1, v: 0 }),
})
const current = computed(() => books.value.find(b => b.osis === book.value) || null)
const chapterOptions = computed(() => current.value ? current.value.verses.map((_, i) => i + 1) : [])
const chapterSel = computed({
	get: () => chapter.value,
	set: c => go({ chapter: c, v: 0 }),
})
const verseNumbers = computed(() => {
	const n = current.value?.verses[chapter.value - 1] || 0
	return Array.from({ length: n }, (_, i) => i + 1)
})
const hasIntro = computed(() => columns.value.some(c => c.intro.length))

const prevChapter = computed(() => {
	if (!current.value) {
		return null
	}
	if (chapter.value > 1) {
		return { chapter: chapter.value - 1 }
	}
	const i = books.value.indexOf(current.value)
	return i > 0 ? { book: books.value[i - 1].osis, chapter: books.value[i - 1].verses.length } : null
})
const nextChapter = computed(() => {
	if (!current.value) {
		return null
	}
	if (chapter.value < current.value.verses.length) {
		return { chapter: chapter.value + 1 }
	}
	const i = books.value.indexOf(current.value)
	return i < books.value.length - 1 ? { book: books.value[i + 1].osis, chapter: 1 } : null
})

const selectionLabel = computed(() => selection.value
	? formatRef({ book: book.value, c1: chapter.value, v1: selection.value.from, c2: chapter.value, v2: selection.value.to }, lang)
	: '')

// a selection belongs to one chapter
watch(() => [moduleName.value, book.value, chapter.value], () => { selection.value = null })

function go({ module = moduleName.value, book: b = book.value, chapter: c = chapter.value, v = undefined, p = parallelName.value } = {}) {
	const query = {}
	if (p) {
		query.p = p
	}
	if (v) {
		query.v = v
	}
	selection.value = null
	pop.close()
	router.push({ name: 'bible', params: { module, book: b, chapter: c }, query })
}

// ---------- loading ----------

let loadSeq = 0
async function load() {
	const seq = ++loadSeq
	error.value = ''
	if (!moduleName.value) {
		return
	}
	loading.value = !columns.value.length
	try {
		const info = await getBooks(moduleName.value)
		if (seq !== loadSeq) {
			return
		}
		books.value = info.books
		info.books.forEach(b => registerBookName(b.osis, b.name))
		if (!book.value || !info.books.some(b => b.osis === book.value)) {
			const start = info.books.find(b => b.osis === (prefs.get('lastBook', null))) || info.books[0]
			if (!start) {
				throw new Error(t('phos', 'The module has no books.'))
			}
			router.replace({ name: 'bible', params: { module: moduleName.value, book: start.osis, chapter: prefs.get('lastChapter', 1) }, query: route.query })
			return
		}
		prefs.set('lastBook', book.value)
		prefs.set('lastChapter', chapter.value)
		const names = [moduleName.value, parallelName.value].filter(Boolean)
		const cols = await Promise.all(names.map(async name => {
			const meta = modules.value.find(m => m.name === name)
			try {
				return column(name, meta, await getChapter(name, book.value, chapter.value))
			} catch (e) {
				if (name === moduleName.value) {
					throw e
				}
				return { module: name, rtl: false, intro: [], verses: {} }   // parallel text without this chapter
			}
		}))
		if (seq !== loadSeq) {
			return
		}
		columns.value = cols
		loading.value = false
		await nextTick()
		const v = Number(route.query.v)
		if (v) {
			selection.value = { from: v, to: v }
			textEl.value?.querySelector(`[data-v="${v}"]`)?.scrollIntoView({ block: 'center' })
		} else {
			const sc = textEl.value?.closest('#app-content-vue, .app-content')
			if (sc) {
				sc.scrollTop = 0
			}
		}
	} catch (e) {
		if (seq === loadSeq) {
			error.value = e.message
			loading.value = false
		}
	}
}

function column(name, meta, ch) {
	const st = meta?.sourceType || 'OSIS'
	const keep = r => { r.notes.forEach(n => notes.set(n.id, n)); return r }
	const intro = []
	if (ch.bookIntro) {
		const r = keep(render(ch.bookIntro, { sourceType: st }))
		intro.push(...r.headings)
	}
	if (ch.intro) {
		const r = keep(render(ch.intro, { sourceType: st }))
		intro.push(...r.headings)
		if (r.html.replace(/<[^>]+>/g, '').trim()) {
			intro.push(r.html)
		}
	}
	const verses = {}
	for (const [v, text] of Object.entries(ch.verses)) {
		if (ch.links?.[v]) {
			verses[v] = { linkedTo: ch.links[v] }
			continue
		}
		verses[v] = keep(render(text, { sourceType: st }))
	}
	return { module: name, rtl: meta?.direction === 'RtoL', intro, verses }
}

watch(() => [moduleName.value, book.value, chapter.value, parallelName.value, route.query.v, modules.value.length], load, { immediate: true })

// ---------- bookmarks in this chapter ----------

const chapterBookmarks = computed(() => book.value ? bookmarksIn(book.value, chapter.value, moduleName.value) : [])
const noteVerses = computed(() => new Set(chapterBookmarks.value.filter(b => b.noteMd || b.noteHtml).map(b => b.vStart)))

function verseStyle(v) {
	const bm = chapterBookmarks.value.find(b => b.vStart <= v && (b.vEnd || b.vStart) >= v && b.labelNames?.length)
	if (!bm) {
		return chapterBookmarks.value.some(b => b.vStart <= v && (b.vEnd || b.vStart) >= v)
			? { borderBottom: '2px dotted var(--color-primary-element)' }
			: null
	}
	const label = labels.value.find(l => bm.labelNames.includes(l.name) && l.collection === bm.collection)
	if (!label?.color) {
		return { borderBottom: '2px dotted var(--color-primary-element)' }
	}
	return label.style === 'box'
		? { outline: `2px solid ${label.color}`, borderRadius: '3px' }
		: { background: `color-mix(in srgb, ${label.color} 40%, transparent)`, borderRadius: '3px' }
}

function inSelection(v) {
	return selection.value && v >= selection.value.from && v <= selection.value.to
}

// ---------- interaction ----------

function onTextClick(e) {
	const verseBtn = e.target.closest('[data-verse]')
	if (verseBtn) {
		const v = Number(verseBtn.dataset.verse)
		if (e.shiftKey && selection.value) {
			selection.value = { from: Math.min(selection.value.from, v), to: Math.max(selection.value.to, v) }
		} else {
			selection.value = { from: v, to: v }
		}
		return
	}
	const noteEl = e.target.closest('[data-note]')
	if (noteEl) {
		const note = notes.get(noteEl.dataset.note)
		if (note) {
			pop.showNote(noteEl, note)
		}
		return
	}
	const a = e.target.closest('a[data-ref]')
	if (a) {
		e.preventDefault()
		gotoRef(a.dataset.ref)
		return
	}
	const w = e.target.closest('.phos-w')
	if (w?.dataset.lemma) {
		pop.showStrong(w, w.dataset.lemma).then(() => { if (pop.popover.value) pop.popover.value.pinned = true })
		return
	}
	pop.close()
}

function onHover(e) {
	if (pop.popover.value?.pinned) {
		return
	}
	pop.hoverStrong(e.target.closest('.phos-w'))
}

function pinPopover() {
	if (pop.popover.value) {
		pop.popover.value.pinned = true
	}
}

function gotoRef(ref) {
	const r = parseRef(ref.replace(/^[^:]+:/, ''))
	if (r) {
		go({ book: r.book, chapter: r.c1, v: r.v1 || undefined })
	}
}

async function showDict(module, key) {
	try {
		const e = await getEntry(module, key)
		const meta = modules.value.find(m => m.name === module)
		const p = pop.popover.value
		pop.popover.value = { ...(p || { x: 40, y: 80 }), title: key, html: render(e.text, { sourceType: meta?.sourceType }).html, pinned: true }
	} catch {
		// unknown entry: leave the popover as it is
	}
}

function gotoInput() {
	const r = parseRef(refInput.value)
	refError.value = !r
	if (r) {
		refInput.value = ''
		go({ book: r.book, chapter: r.c1, v: r.v1 || undefined })
	}
}

const onKey = e => {
	if (e.target.closest?.('input, textarea, [contenteditable]')) {
		return
	}
	if (e.key === 'Escape') {
		pop.close()
	} else if (e.key === 'ArrowLeft' && prevChapter.value && e.altKey) {
		go(prevChapter.value)
	} else if (e.key === 'ArrowRight' && nextChapter.value && e.altKey) {
		go(nextChapter.value)
	}
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped lang="scss">
.bible {
	padding: 4px 16px 40px 50px;

	&__bar,
	&__nav {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: flex-end;
		margin-bottom: 8px;
	}

	&__nav {
		align-items: center;
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--color-main-background);
		padding: 4px 0;
	}

	&__module {
		min-width: 240px;
		flex: 1 1 240px;
		max-width: 380px;
	}

	&__goto {
		flex: 1 1 200px;
		max-width: 300px;
	}

	&__book {
		min-width: 200px;
	}

	&__chapter {
		min-width: 90px;
	}

	&__vpl {
		margin-left: auto;
	}

	&__loading {
		display: flex;
		justify-content: center;
		padding: 40px;
	}

	&__text {
		max-width: 900px;

		&--parallel {
			max-width: none;
		}
	}

	&__row {
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		gap: 0 24px;
		padding: 1px 4px;
		border-radius: var(--border-radius);

		&--head {
			position: sticky;
			top: 52px;
			background: var(--color-main-background);
			font-weight: bold;
			color: var(--color-text-maxcontrast);
			z-index: 1;
		}

		&--selected {
			background: var(--color-primary-element-light);
		}
	}

	&__text--flow {
		.bible__row {
			display: inline;
			padding: 0;
		}

		.bible__cell {
			display: inline;
		}

		.phos-heading {
			display: block;
		}
	}

	&__vnum {
		all: unset;
		cursor: pointer;
		font-size: 0.7em;
		font-weight: bold;
		vertical-align: super;
		color: var(--color-text-maxcontrast);
		padding: 0 3px 0 2px;

		&:hover,
		&:focus-visible {
			color: var(--color-primary-element);
			text-decoration: underline;
		}
	}

	&__notemark {
		all: unset;
		cursor: pointer;
		margin-left: 4px;
		color: var(--color-primary-element);
	}

	&__linked {
		color: var(--color-text-maxcontrast);
		font-style: italic;
	}

	&__sidebar {
		padding: 0 10px;
	}
}
</style>
