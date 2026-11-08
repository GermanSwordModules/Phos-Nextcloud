<template>
	<div class="bible">
		<div class="bible__bar">
			<NcSelect v-model="moduleSel"
				class="bible__module"
				:options="bibleOptions"
				:clearable="false"
				:selectable="o => !o.locked"
				:input-label="isCommentary ? t('phos', 'Commentary') : t('phos', 'Bible')"
				label="label" />
			<NcSelect v-model="parallelSel"
				class="bible__module bible__module--parallel"
				:options="parallelOptions"
				:selectable="o => !o.locked"
				multiple
				:input-label="t('phos', 'Parallel text')"
				:placeholder="t('phos', 'none')"
				label="label" />
			<form class="bible__goto" @submit.prevent="gotoInput">
				<NcTextField v-model="refInput"
					:label="t('phos', 'Go to or search (e.g. Joh 3,16)')"
					:error="refError"
					:show-trailing-button="!!refInput"
					trailing-button-icon="arrowEnd"
					@trailing-button-click="gotoInput" />
			</form>
		</div>
		<div v-if="book" class="bible__nav">
			<NcButton variant="tertiary" class="bible__histnav" :aria-label="t('phos', 'Back')" @click="router.back()">
				<template #icon>
					<NcIconSvgWrapper :path="iconHistBack" />
				</template>
			</NcButton>
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
			<NcButton variant="tertiary" :aria-label="t('phos', 'Go to a verse …')" @click="versePickerOpen = true">
				<template #icon>
					<NcIconSvgWrapper :path="iconVerseGrid" />
				</template>
			</NcButton>
			<NcButton variant="tertiary" :disabled="!nextChapter" :aria-label="t('phos', 'Next chapter')" @click="go(nextChapter)">
				<template #icon>
					<NcIconSvgWrapper :path="iconNext" />
				</template>
			</NcButton>
			<NcButton variant="tertiary" class="bible__histnav" :aria-label="t('phos', 'Forward')" @click="router.forward()">
				<template #icon>
					<NcIconSvgWrapper :path="iconHistForward" />
				</template>
			</NcButton>
			<NcButton v-if="!isCommentary && GOSPELS.includes(book)"
				variant="tertiary"
				:aria-label="t('phos', 'Gospel synopsis')"
				:title="t('phos', 'Parallels in the other gospels')"
				@click="router.push({ name: 'synopsis', query: { book, c: chapter, v: route.query.v || 0 } })">
				<template #icon>
					<NcIconSvgWrapper :path="iconSynopsis" />
				</template>
			</NcButton>
			<BibleViewOptions v-model:verse-per-line="versePerLine" class="bible__viewopts" @print="printView" />
		</div>
		<VersePicker v-model:open="versePickerOpen" :books="books" :book="book" :chapter="chapter" @go="go" />

		<NcEmptyContent v-if="!ownModules.length"
			:name="isCommentary ? t('phos', 'No commentary on the server yet.') : t('phos', 'No Bible on the server yet')"
			:description="t('phos', 'Bibles appear here once you store them online in Phos Desktop (library → right-click a module → “Online speichern (Nextcloud)”).')" />
		<NcEmptyContent v-else-if="error" :name="t('phos', 'This text cannot be shown')" :description="error" />
		<div v-else-if="loading" class="bible__loading">
			<NcLoadingIcon :size="32" />
		</div>
		<div v-else
			ref="textEl"
			class="bible__text phos-text"
			:class="{
				'bible__text--parallel': columns.length > 1,
				'bible__text--flow': !versePerLine && columns.length === 1,
				'opts-strongs': displayOptions.strongs,
				'opts-hide-notes': !displayOptions.notes,
				'opts-hide-headings': !displayOptions.headings,
				'opts-no-redletter': !displayOptions.redLetter,
				'opts-sidenotes': displayOptions.notes && displayOptions.sideNotes,
				'opts-chapternum': displayOptions.chapterNum,
			}"
			:dir="columns.length === 1 && columns[0].rtl ? 'rtl' : null"
			:style="{ '--cols': columns.length, '--phos-zoom': textZoom / 100 }"
			@click="onTextClick"
			@mouseover="onHover">
			<div v-if="columns.length > 1" class="bible__row bible__row--head">
				<div v-for="c in columns" :key="c.module" class="bible__colhead">
					{{ c.module }}
				</div>
			</div>
			<div v-if="hasIntro" class="bible__row">
				<div v-for="c in columns" :key="c.module" class="bible__cell" :data-mod="c.module" :dir="c.rtl ? 'rtl' : null">
					<div v-for="(h, i) in c.intro" :key="i" class="phos-heading phos-heading--intro" v-html="h" />
				</div>
			</div>
			<div v-for="v in verseNumbers"
				:key="v"
				:data-v="v"
				:data-chapternum="v === verseNumbers[0] ? chapter : null"
				class="bible__row"
				:class="{ 'bible__row--selected': inSelection(v), 'bible__row--first': v === verseNumbers[0] }">
				<div v-for="c in columns" :key="c.module" class="bible__cell" :data-mod="c.module" :dir="c.rtl ? 'rtl' : null">
					<div v-for="(h, i) in c.verses[v]?.headings || []" :key="i" class="phos-heading" v-html="h" />
					<span class="bible__verse" :style="verseStyle(v)">
						<button type="button"
							class="bible__vnum"
							:title="t('phos', 'Bookmark / note')"
							:data-verse="v">{{ v }}</button>
						<span v-if="c.verses[v]?.from"
							class="bible__from"
							:title="t('phos', 'Counted differently in {module}', { module: c.module })">{{ c.verses[v].from }}</span>
						<span v-if="c.verses[v]?.html" v-html="c.verses[v].html" />
						<span v-else-if="c.verses[v]?.linkedTo" class="bible__linked">{{ t('phos', 'see verse {v}', { v: c.verses[v].linkedTo }) }}</span>
						<button v-if="noteVerses.has(v) && c === columns[0]"
							type="button"
							class="bible__notemark"
							:title="t('phos', 'Has a note')"
							:data-verse="v">✎</button>
						<button v-if="syntaxVerses.has(v) && c === columns[0]"
							type="button"
							class="bible__syntaxmark"
							:title="t('phos', 'Has a saved syntax diagram')"
							:data-verse="v">
							<NcIconSvgWrapper :path="iconSyntax" :size="14" />
						</button>
					</span>
					<div v-if="displayOptions.sideNotes && displayOptions.notes && c.verses[v]?.noteIds?.length" class="bible__sidenotes">
						<div v-for="id in c.verses[v].noteIds" :key="id" class="bible__sidenote">
							<b>{{ notes.get(id)?.label }}</b>
							<!-- eslint-disable-next-line vue/no-v-html -- built by bible/render.js from a whitelist -->
							<span v-html="notes.get(id)?.html" />
						</div>
					</div>
				</div>
			</div>
		</div>

		<TextPopover :popover="pop.popover.value"
			@keep="pinPopover"
			@ref="gotoRef"
			@dict="showDict"
			@search="searchWord" />

		<!-- the sidebar belongs next to NcAppContent, not inside it -->
		<Teleport to="#content-vue">
			<NcAppSidebar v-if="selection"
			:name="selectionLabel"
			:subname="t('phos', 'Bookmarks and notes')"
			@close="selection = null">
			<div class="bible__sidebar">
				<SyntaxDiagramPanel v-if="selection.from === selection.to"
					:osis="`${book}.${chapter}.${selection.from}`" />
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
import { GOSPELS } from '../synopsis/synopsis.js'
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
import TextPopover from '../components/TextPopover.vue'
import BookmarkPanel from '../components/BookmarkPanel.vue'
import BibleViewOptions from '../components/BibleViewOptions.vue'
import VersePicker from '../components/VersePicker.vue'
import { useTextPopover } from '../components/useNotes.js'
import { render } from '../bible/render.js'
import { bookName, formatRef, parseRef, registerBookName } from '../bible/books.js'
import {
	bibles, commentaries, modules, getBooks, getChapter, getEntry, defaultBible, defaultCommentary, prefs, lang,
	bookmarksIn, labels, resumePosition, rememberPosition, localOnlyOptions, syntaxDiagramFor,
	displayOptions, textZoom } from '../services/phos.js'
import SyntaxDiagramPanel from '../components/SyntaxDiagramPanel.vue'
import { iconPrev, iconNext, iconSyntax, iconHistBack, iconHistForward, iconVerseGrid, iconSynopsis } from '../icons.js'

/**
 * The Bible text, standalone (route `bible`) or as the left half of the
 * Bible reading page (route `read`): it navigates within whichever route
 * shows it, and reports the verse being read (`position`: the selected
 * verse, else the first one in view) so that page can follow along.
 */
const emit = defineEmits(['position'])
const route = useRoute()
const router = useRouter()
const routeName = computed(() => route.name || 'bible')

// route `commentary`: the same page for commentaries (verse-keyed alike)
const isCommentary = computed(() => route.name === 'commentary')
const ownModules = computed(() => isCommentary.value ? commentaries.value : bibles.value)
const moduleName = computed(() => route.params.module || (isCommentary.value ? defaultCommentary() : defaultBible()))
const book = computed(() => route.params.book || null)
const chapter = computed(() => Number(route.params.chapter) || 1)
// N-version parallel (desktop: unlimited columns via GroupID/ArrangeTiles) -- comma-separated in ?p=
const parallelNames = computed(() => String(route.query.p || '').split(',').filter(Boolean))
const versePickerOpen = ref(false)

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

const option = m => ({
	id: m.name, label: m.locked ? `🔒 ${m.name} – ${m.description}` : `${m.name} – ${m.description}`, locked: m.locked,
})
const bibleOptions = computed(() => [...ownModules.value.map(option), ...localOnlyOptions(isCommentary.value ? 'commentary' : 'bible')])
// a Bible next to a commentary, or a commentary (or several) as columns next to the Bible
const parallelOptions = computed(() => [...bibles.value, ...commentaries.value].map(option)
	.concat(localOnlyOptions('bible'), localOnlyOptions('commentary')))
const moduleSel = computed({
	get: () => bibleOptions.value.find(o => o.id === moduleName.value) || null,
	set: o => { if (o) { prefs.set(isCommentary.value ? 'commentary' : 'bible', o.id); go({ module: o.id }) } },
})
const parallelSel = computed({
	get: () => parallelNames.value.map(n => parallelOptions.value.find(o => o.id === n)).filter(Boolean),
	set: arr => go({ p: (arr || []).map(o => o.id) }),
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

function go({ module = moduleName.value, book: b = book.value, chapter: c = chapter.value, v = undefined, p = parallelNames.value } = {}) {
	const query = {}
	const pStr = (Array.isArray(p) ? p : [p]).filter(Boolean).join(',')
	if (pStr) {
		query.p = pStr
	}
	if (v) {
		query.v = v
	}
	selection.value = null
	pop.close()
	router.push({ name: routeName.value, params: { module, book: b, chapter: c }, query })
}

function printView() {
	window.print()
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
			// continue where the user last read, here or on the desktop — in
			// that Bible, when none is asked for and it is on the server
			const last = resumePosition()
			if (!isCommentary.value && !route.params.module && last?.module && last.module !== moduleName.value
				&& ownModules.value.some(m => m.name === last.module && !m.locked)) {
				router.replace({ name: routeName.value, params: { module: last.module }, query: route.query })
				return
			}
			const start = info.books.find(b => b.osis === last?.book) || info.books[0]
			if (!start) {
				throw new Error(t('phos', 'The module has no books.'))
			}
			const c = start.osis === last?.book && last.chapter <= start.verses.length ? last.chapter : 1
			const query = { ...route.query }
			if (start.osis === last?.book && last.verse > 1 && !query.v) {
				query.at = last.verse   // scroll there, no selection
			}
			router.replace({ name: routeName.value, params: { module: moduleName.value, book: start.osis, chapter: c }, query })
			return
		}
		const names = [...new Set([moduleName.value, ...parallelNames.value])].filter(Boolean)
		// the parallel text follows the main module's verse numbering (sword's mapping tables)
		const system = info.versification
		const cols = await Promise.all(names.map(async name => {
			const meta = modules.value.find(m => m.name === name)
			const as = name !== moduleName.value && meta?.versification && meta.versification !== system ? system : ''
			try {
				return column(name, meta, await getChapter(name, book.value, chapter.value, as))
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
		bindScroll()
		const v = Number(route.query.v)
		if (v) {
			selection.value = { from: v, to: v }
			textEl.value?.querySelector(`[data-v="${v}"]`)?.scrollIntoView({ block: 'center' })
		} else if (Number(route.query.at)) {
			scrollToVerse(Number(route.query.at))
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

/** "Ps.22.0-1" → "Ps 22,1" (verse 0 = the psalm title, shown with verse 1) */
function osisLabel(osis) {
	const m = /^([^.]+)\.(\d+)\.(\d+)(?:-(\d+))?$/.exec(osis)
	if (!m) {
		return osis
	}
	const c = Number(m[2])
	const v1 = Number(m[3]) || 1
	const v2 = Number(m[4] || 0)
	return formatRef({ book: m[1], c1: c, v1, c2: c, v2: v2 > v1 ? v2 : 0 }, lang)
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
		if (ch.refs?.[v]) {
			verses[v].from = osisLabel(ch.refs[v])
		}
		// which notes this verse's html carries (side-notes mode shows them next to it)
		const ids = [...verses[v].html.matchAll(/data-note="([^"]+)"/g)].map(m => m[1])
		if (ids.length) {
			verses[v].noteIds = ids
		}
	}
	return { module: name, rtl: meta?.direction === 'RtoL', intro, verses }
}

watch(() => [moduleName.value, book.value, chapter.value, parallelNames.value.join(','), route.query.v, route.query.at, modules.value.length], load, { immediate: true })

// ---------- bookmarks in this chapter ----------

const chapterBookmarks = computed(() => book.value ? bookmarksIn(book.value, chapter.value, moduleName.value) : [])
const noteVerses = computed(() => new Set(chapterBookmarks.value.filter(b => b.noteMd || b.noteHtml).map(b => b.vStart)))
const syntaxVerses = computed(() => book.value
	? new Set(verseNumbers.value.filter(v => syntaxDiagramFor(`${book.value}.${chapter.value}.${v}`)))
	: new Set())

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

/**
 * Click-to-open popovers, one entry per kind of marker the renderer tags --
 * the web analogue of desktop's single scheme-dispatcher
 * (`TForm1.BuildPreviewHTML`, unit1.pas:4050, for strong:/bible:/fn:/geo:/
 * person:/pericope:/bmclick:). Only notes and Strong's words exist today;
 * a future geo/person marker is one more entry here, not a new if-chain.
 */
const POPOVER_HANDLERS = [
	{
		selector: '[data-note]',
		open: el => { const note = notes.get(el.dataset.note); if (note) { pop.showNote(el, note) } },
	},
	{
		selector: '.phos-w',
		test: el => !!el.dataset.lemma,
		open: el => pop.showStrong(el, el.dataset.lemma).then(() => { if (pop.popover.value) { pop.popover.value.pinned = true } }),
	},
]

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
	const a = e.target.closest('a[data-ref]')
	if (a) {
		e.preventDefault()
		gotoRef(a.dataset.ref)
		return
	}
	for (const h of POPOVER_HANDLERS) {
		const el = e.target.closest(h.selector)
		if (el && (!h.test || h.test(el))) {
			h.open(el)
			return
		}
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

/** "Search" on a word popover -- the module search, carrying the word as the query, same
 * route contract SearchView.vue's own query box already produces. */
function searchWord(text) {
	router.push({ name: 'search', query: { q: text, m: moduleName.value } })
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

/** a passage goes there, anything else is searched in this module */
function gotoInput() {
	const text = refInput.value.trim()
	const r = parseRef(text)
	refError.value = false
	if (r) {
		refInput.value = ''
		go({ book: r.book, chapter: r.c1, v: r.v1 || undefined })
	} else if (text) {
		router.push({ name: 'search', query: { q: text, m: moduleName.value } })
	}
}

// ---------- where the reader is ----------

let scroller = null
let raf = 0
/** the verse at the top, below the sticky navigation */
function scrollToVerse(v) {
	const row = textEl.value?.querySelector(`[data-v="${v}"]`)
	const sc = textEl.value?.closest('#app-content-vue, .app-content')
	const nav = textEl.value?.closest('.bible')?.querySelector('.bible__nav')
	if (row && sc) {
		sc.scrollTop += row.getBoundingClientRect().top - (nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top) - 4
	}
}

function topVerse() {
	if (!textEl.value || !scroller) {
		return 1
	}
	// the first verse not hidden under the sticky navigation
	const nav = textEl.value.closest('.bible')?.querySelector('.bible__nav')
	const top = nav ? nav.getBoundingClientRect().bottom : scroller.getBoundingClientRect().top
	for (const row of textEl.value.querySelectorAll('[data-v]')) {
		if (row.getBoundingClientRect().bottom > top + 8) {
			return Number(row.dataset.v)
		}
	}
	return 1
}
function report() {
	raf = 0
	if (book.value) {
		const p = { module: moduleName.value, book: book.value, chapter: chapter.value, verse: selection.value?.from || topVerse() }
		if (!isCommentary.value) {
			rememberPosition(p)
		}
		emit('position', p)
	}
}
const onScroll = () => { raf ||= requestAnimationFrame(report) }
function bindScroll() {
	const sc = textEl.value?.closest('#app-content-vue, .app-content') || null
	if (sc !== scroller) {
		scroller?.removeEventListener('scroll', onScroll)
		scroller = sc
		scroller?.addEventListener('scroll', onScroll, { passive: true })
	}
	onScroll()
}
watch(selection, onScroll)
onBeforeUnmount(() => {
	scroller?.removeEventListener('scroll', onScroll)
	cancelAnimationFrame(raf)
})

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

	&__viewopts {
		margin-left: auto;
	}

	&__module--parallel {
		min-width: 280px;
		max-width: 460px;
	}

	&__loading {
		display: flex;
		justify-content: center;
		padding: 40px;
	}

	&__text {
		max-width: 900px;
		font-size: calc(var(--phos-text-size) * var(--phos-zoom, 1));

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
		position: relative;

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

	/* desktop: dtChapNum -- a big chapter number floated into the left margin
	   at the chapter's first verse. No effect without that margin (mobile). */
	&__text.opts-chapternum &__row--first::before {
		content: attr(data-chapternum);
		position: absolute;
		left: -46px;
		top: -0.05em;
		font-size: 2.1em;
		font-weight: bold;
		line-height: 1;
		color: var(--color-text-maxcontrast);
	}

	&__sidenotes {
		margin: 2px 0 2px 8px;
		padding-inline-start: 8px;
		border-inline-start: 2px solid var(--color-border);
		font-size: 0.78em;
		color: var(--color-text-maxcontrast);
		float: right;
		// each verse's notes start at max(own verse, end of the previous notes) -- what the desktop's
		// SideNoteScript computes in JS; without it dense notes sat side by side or over each other
		clear: right;
		width: 200px;
	}

	&__sidenote + &__sidenote {
		margin-top: 4px;
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

	&__syntaxmark {
		all: unset;
		cursor: pointer;
		display: inline-flex;
		vertical-align: middle;
		margin-left: 4px;
		color: var(--color-primary-element);
	}

	&__from {
		font-size: 0.75em;
		color: var(--color-text-maxcontrast);
		margin-right: 4px;

		&::before {
			content: '(';
		}

		&::after {
			content: ')';
		}
	}

	&__linked {
		color: var(--color-text-maxcontrast);
		font-style: italic;
	}

	&__sidebar {
		padding: 0 10px;
	}
}

/* W-8 phones: a compact toolbar, a parallel text under each verse */
@media (max-width: 600px) {
	.bible {
		padding: 4px 10px 32px;

		&__bar {
			margin-inline-start: 40px;
			gap: 6px;
		}

		&__module {
			min-width: 0 !important;
			flex: 1 1 calc(50% - 6px);
			max-width: none;
		}

		&__goto {
			flex: 1 1 100%;
			max-width: none;
		}

		&__nav {
			flex-wrap: nowrap;
			gap: 2px;
		}

		&__book {
			min-width: 0 !important;
			flex: 1 1 0;
		}

		&__chapter {
			min-width: 0 !important;
			flex: 0 0 92px;
			width: 92px;
		}

		&__nav > * {
			flex-shrink: 1;
		}

		&__nav > button {
			flex: 0 0 auto;
		}

		/* the browser's own back/forward gesture covers this on a phone */
		&__histnav {
			display: none;
		}

		&__row {
			grid-template-columns: 1fr;

			&--head {
				display: none;
			}
		}

		/* no left margin to float a big chapter number into */
		&__text.opts-chapternum &__row--first::before {
			display: none;
		}

		&__text--parallel &__cell + &__cell {
			margin: 2px 0 6px;
			padding-inline-start: 8px;
			border-inline-start: 3px solid var(--color-border-dark);
			color: var(--color-text-maxcontrast);

			&::before {
				content: attr(data-mod);
				display: block;
				font-weight: bold;
				font-size: 0.78em;
				color: var(--color-text-maxcontrast);
			}
		}

		&__sidenotes {
			float: none;
			width: auto;
			margin: 2px 0 6px 8px;
		}
	}
}
</style>
