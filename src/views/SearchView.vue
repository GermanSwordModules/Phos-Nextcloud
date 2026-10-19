<template>
	<div class="phos-page search">
		<h2>{{ t('phos', 'Search') }}</h2>
		<div class="search__tabs" role="tablist">
			<NcButton v-for="tb in tabs"
				:key="tb.id"
				role="tab"
				:aria-selected="tab === tb.id"
				:variant="tab === tb.id ? 'primary' : 'secondary'"
				@click="setQuery({ tab: tb.id })">
				{{ tb.label }}
			</NcButton>
		</div>
		<div class="search__bar">
			<!-- its own form: Enter submits only with a single text input -->
			<form class="search__query" @submit.prevent="submit">
				<NcTextField v-model="input"
					:label="t('phos', 'Search for')"
					:helper-text="t('phos', 'Words (all must occur), “a phrase”, prefix*, -exclude, G26 / H430 for Strong’s')"
					:show-trailing-button="!!input"
					trailing-button-icon="arrowEnd"
					@trailing-button-click="submit" />
			</form>
			<NcSelect v-if="tab === 'bible'"
				v-model="moduleSel"
				class="search__module"
				:options="moduleOptions"
				:clearable="false"
				:input-label="t('phos', 'Module')"
				label="label" />
			<NcSelect v-if="tab === 'bible'"
				v-model="scopeSel"
				class="search__scope"
				:options="scopeOptions"
				:clearable="false"
				:input-label="t('phos', 'In')"
				label="label" />
			<NcCheckboxRadioSwitch :model-value="mode === 'any'" type="switch" @update:model-value="v => setQuery({ mode: v ? 'any' : '' })">
				{{ t('phos', 'One word is enough') }}
			</NcCheckboxRadioSwitch>
		</div>

		<!-- Bible / commentary: on the server -->
		<template v-if="tab === 'bible'">
			<NcEmptyContent v-if="!moduleOptions.length" :name="t('phos', 'No Bible on the server yet')" />
			<NcEmptyContent v-else-if="error" :name="t('phos', 'Search failed')" :description="error" />
			<div v-else-if="loading && !result" class="search__loading">
				<NcLoadingIcon :size="32" />
				<p>{{ t('phos', 'The first search in a module builds its index; this takes a few seconds.') }}</p>
			</div>
			<template v-else-if="result">
				<p class="search__count">
					{{ n('phos', '%n verse', '%n verses', result.total) }}
				</p>
				<div v-if="bookCounts.length > 1" class="search__books">
					<button v-for="b in bookCounts"
						:key="b.osis"
						type="button"
						class="phos-chip search__bookchip"
						:class="{ 'search__bookchip--on': scope === b.osis }"
						@click="setQuery({ scope: scope === b.osis ? '' : b.osis })">
						{{ b.label }} <span>{{ b.count }}</span>
					</button>
				</div>
				<ul class="search__hits phos-text" :class="{ 'search__hits--stale': loading }">
					<li v-for="h in hits" :key="h.key" class="search__hit">
						<a href="#" class="search__ref" @click.prevent="openHit(h)">{{ h.label }}</a>
						<span v-html="h.html" />
					</li>
				</ul>
				<NcButton v-if="hits.length < result.total" :disabled="loading" @click="more">
					{{ t('phos', 'Show more ({n} left)', { n: result.total - hits.length }) }}
				</NcButton>
			</template>
		</template>

		<!-- own notes: in the browser -->
		<template v-else>
			<NcEmptyContent v-if="query && !noteHits.length" :name="t('phos', 'Nothing found in your notes')" />
			<ul class="search__hits">
				<li v-for="h in noteHits.slice(0, noteLimit)" :key="h.key" class="search__hit">
					<div class="search__notehead">
						<span class="search__kind">{{ h.kindLabel }}</span>
						<a v-if="h.open" href="#" class="search__ref" @click.prevent="h.open()">{{ h.title }}</a>
						<span v-else class="search__ref">{{ h.title }}</span>
						<span v-for="l in h.labels || []" :key="l" class="phos-chip">{{ labelDisplay(l) }}</span>
					</div>
					<div class="search__snippet" v-html="h.snippetHtml" />
				</li>
			</ul>
			<NcButton v-if="noteHits.length > noteLimit" @click="noteLimit += 100">
				{{ t('phos', 'Show more ({n} left)', { n: noteHits.length - noteLimit }) }}
			</NcButton>
		</template>
	</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t, n } from '@nextcloud/l10n'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { render } from '../bible/render.js'
import { bookName, formatRef, parseRef } from '../bible/books.js'
import { highlight } from '../search/highlight.js'
import { htmlText, searchItems } from '../search/notes.js'
import { parseQuery } from '../search/fold.js'
import {
	bibles, commentaries, modules, defaultBible, getBooks, searchModule, bookmarks, labels, labelDisplay, engine, lang, prefs,
} from '../services/phos.js'

/**
 * Search (W-4): a Bible or commentary on the server (index per module),
 * or the user's own notes, study pads and sermons right here in the
 * browser. The query lives in the URL, so back/forward keep it.
 */
const route = useRoute()
const router = useRouter()

const tabs = [
	{ id: 'bible', label: t('phos', 'Bible and commentaries') },
	{ id: 'notes', label: t('phos', 'My notes') },
]
const tab = computed(() => route.query.tab === 'notes' ? 'notes' : 'bible')
const query = computed(() => String(route.query.q || ''))
const mode = computed(() => route.query.mode === 'any' ? 'any' : 'all')
const scope = computed(() => String(route.query.scope || ''))
const input = ref(query.value)
watch(query, q => { input.value = q })

function setQuery(changes) {
	const q = { ...route.query, ...changes }
	for (const k of Object.keys(q)) {
		if (q[k] === '' || q[k] == null) {
			delete q[k]
		}
	}
	router.replace({ name: 'search', query: q })
}
function submit() {
	setQuery({ q: input.value.trim() })
}

// ---------- Bible / commentary ----------

const searchable = computed(() => [...bibles.value, ...commentaries.value].filter(m => !m.locked))
const moduleOptions = computed(() => searchable.value.map(m => ({ id: m.name, label: `${m.name} – ${m.description}` })))
const moduleName = computed(() => {
	const names = searchable.value.map(m => m.name)
	return [route.query.m, prefs.get('searchModule', null), defaultBible()].find(x => x && names.includes(x)) || names[0] || null
})
const moduleSel = computed({
	get: () => moduleOptions.value.find(o => o.id === moduleName.value) || null,
	set: o => { if (o) { prefs.set('searchModule', o.id); setQuery({ m: o.id, scope: '' }) } },
})
const books = ref([])
watch(moduleName, async name => {
	books.value = name ? (await getBooks(name).catch(() => ({ books: [] }))).books : []
}, { immediate: true })
const scopeOptions = computed(() => [
	{ id: '', label: t('phos', 'whole module') },
	{ id: 'OT', label: t('phos', 'Old Testament') },
	{ id: 'NT', label: t('phos', 'New Testament') },
	...books.value.map(b => ({ id: b.osis, label: bookName(b.osis, lang, b.name) })),
])
const scopeSel = computed({
	get: () => scopeOptions.value.find(o => o.id === scope.value) || scopeOptions.value[0],
	set: o => setQuery({ scope: o?.id || '' }),
})

const result = ref(null)
const hits = ref([])
const loading = ref(false)
const error = ref('')
let seq = 0

function hitOf(h, marks) {
	const meta = modules.value.find(m => m.name === moduleName.value)
	return {
		...h,
		key: `${h.book}.${h.chapter}.${h.verse}`,
		label: formatRef({ book: h.book, c1: h.chapter, v1: h.verse, c2: h.chapter, v2: 0 }, lang, books.value.find(b => b.osis === h.book)?.name),
		html: highlight(render(h.text, { sourceType: meta?.sourceType }).html, marks),
	}
}

async function runBible(offset = 0) {
	const s = ++seq
	error.value = ''
	if (!query.value || !moduleName.value) {
		result.value = null
		hits.value = []
		return
	}
	loading.value = true
	try {
		const r = await searchModule(moduleName.value, query.value, { mode: mode.value, books: scope.value, offset, limit: 50 })
		if (s !== seq) {
			return
		}
		const marks = { terms: r.terms, strongs: r.strongs }
		const page = r.hits.map(h => hitOf(h, marks))
		hits.value = offset ? [...hits.value, ...page] : page
		result.value = r
	} catch (e) {
		if (s === seq) {
			const why = { 'prefix too short': t('phos', 'A prefix* needs at least two letters.'), 'empty query': t('phos', 'Enter at least one word to look for.') }
			error.value = e.status === 422 ? t('phos', 'This query cannot be searched: {error}', { error: why[e.message] || e.message }) : e.message
			result.value = null
		}
	} finally {
		if (s === seq) {
			loading.value = false
		}
	}
}
const more = () => runBible(hits.value.length)

const bookCounts = computed(() => Object.entries(result.value?.perBook || {}).map(([osis, count]) => ({
	osis, count, label: bookName(osis, lang, books.value.find(b => b.osis === osis)?.name),
})))

function openHit(h) {
	const meta = modules.value.find(m => m.name === moduleName.value)
	router.push({
		name: meta?.kind === 'commentary' ? 'commentary' : 'bible',
		params: { module: moduleName.value, book: h.book, chapter: h.chapter },
		query: { v: h.verse },
	})
}

watch(() => [tab.value, query.value, mode.value, scope.value, moduleName.value], () => {
	if (tab.value === 'bible') {
		runBible()
	}
}, { immediate: true })

// ---------- own notes ----------

const noteLimit = ref(100)
const isBible = name => bibles.value.some(b => b.name === name)

function strings(v, out = []) {
	if (typeof v === 'string') {
		out.push(v)
	} else if (Array.isArray(v)) {
		v.forEach(x => strings(x, out))
	} else if (v && typeof v === 'object') {
		for (const [k, x] of Object.entries(v)) {
			if (!/^(id|uuid|created|modified|.*_osis|.*Id)$/.test(k)) {
				strings(x, out)
			}
		}
	}
	return out
}

const noteItems = computed(() => {
	const items = []
	for (const bm of bookmarks.value) {
		const note = [bm.noteMd || '', bm.noteMd ? '' : htmlText(bm.noteHtml)].join(' ').trim()
		if (!note) {
			continue
		}
		const pad = bm.kind === 'entry' || !bm.bookOsis
		const ref = bm.bookOsis ? formatRef({ book: bm.bookOsis, c1: bm.chap, v1: bm.vStart, c2: bm.chap, v2: bm.vEnd || bm.vStart }, lang) : ''
		items.push({
			key: bm.key,
			kindLabel: pad ? t('phos', 'Study pad') : t('phos', 'Note'),
			title: ref || labelDisplay(bm.labelNames?.[0] || t('phos', 'Own note')),
			labels: bm.labelNames || [],
			text: note,
			open: pad
				? () => router.push({ name: 'pads', params: { label: bm.labelNames?.[0] || '' } })
				: () => router.push({ name: 'bible', params: { module: bm.module && isBible(bm.module) ? bm.module : defaultBible(), book: bm.bookOsis, chapter: bm.chap }, query: { v: bm.vStart } }),
		})
	}
	for (const r of engine.list('sermon')) {
		const p = r.payload || {}
		const ref = p.passage_osis ? parseRef(p.passage_osis) : null
		items.push({
			key: r.key,
			kindLabel: t('phos', 'Sermon'),
			title: [p.title, ref ? formatRef(ref, lang) : p.passage].filter(Boolean).join(' – '),
			text: strings(p).join('\n'),
			open: ref ? () => router.push({ name: 'read', params: { module: defaultBible(), book: ref.book, chapter: ref.c1 }, query: ref.v1 ? { v: ref.v1 } : {} }) : null,
		})
	}
	for (const l of labels.value) {
		items.push({
			key: 'label|' + l.collection + '|' + l.name,
			kindLabel: t('phos', 'Label'),
			title: labelDisplay(l.name),
			text: labelDisplay(l.name),
			open: () => router.push({ name: 'pads', params: { label: l.name } }),
		})
	}
	return items
})

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const noteHits = computed(() => {
	if (tab.value !== 'notes' || !query.value) {
		return []
	}
	const q = parseQuery(query.value)
	const terms = [...q.words, ...q.phrases.flat()]
	return searchItems(noteItems.value, query.value, mode.value)
		.map(h => ({ ...h, snippetHtml: highlight(esc(h.snippet), { terms }) }))
})
watch(query, () => { noteLimit.value = 100 })
</script>

<style scoped lang="scss">
.search {
	&__tabs {
		display: flex;
		gap: 8px;
		margin-bottom: 10px;
	}

	&__bar {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
		margin-bottom: 14px;
	}

	&__query {
		flex: 1 1 320px;
		max-width: 520px;
	}

	&__module {
		min-width: 240px;
		max-width: 360px;
	}

	&__scope {
		min-width: 180px;
	}

	&__loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 30px;
		color: var(--color-text-maxcontrast);
	}

	&__count {
		color: var(--color-text-maxcontrast);
		margin: 0 0 6px;
	}

	&__books {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 10px;
	}

	&__bookchip {
		cursor: pointer;
		min-height: 0;
		height: auto;
		padding: 1px 8px;
		margin: 0;
		font-weight: normal;

		span {
			color: var(--color-text-maxcontrast);
			margin-left: 2px;
		}

		&--on {
			background: var(--color-primary-element-light);
			border-color: var(--color-primary-element);
		}
	}

	&__hits {
		transition: opacity 0.2s;

		&--stale {
			opacity: 0.5;
		}

		list-style: none;
		padding: 0;
		margin: 0 0 12px;
		max-width: 900px;
	}

	&__hit {
		padding: 6px 0;
		border-bottom: 1px solid var(--color-border);

		:deep(mark) {
			background: color-mix(in srgb, var(--color-warning) 40%, transparent);
			color: inherit;
			border-radius: 2px;
		}

		:deep(.phos-hit) {
			background: color-mix(in srgb, var(--color-warning) 40%, transparent);
			border-radius: 2px;
		}
	}

	&__ref {
		font-weight: bold;
		color: var(--color-primary-element);
		margin-right: 8px;
	}

	&__notehead {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	&__kind {
		font-size: 0.8em;
		text-transform: uppercase;
		color: var(--color-text-maxcontrast);
	}

	&__snippet {
		color: var(--color-main-text);
		margin-top: 2px;
		white-space: pre-line;
	}
}
</style>
