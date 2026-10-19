<template>
	<div class="phos-page book">
		<div class="book__bar">
			<NcSelect v-model="moduleSel"
				class="book__module"
				:options="options"
				:clearable="false"
				:selectable="o => !o.locked"
				:input-label="t('phos', 'Book')"
				label="label" />
		</div>
		<NcEmptyContent v-if="!moduleName" :name="t('phos', 'No book on the server yet')" />
		<div v-else class="book__body">
			<nav class="book__toc" :aria-label="t('phos', 'Contents')">
				<NcLoadingIcon v-if="!rows.length && tocLoading" :size="24" />
				<ul role="tree">
					<li v-for="r in rows"
						:key="r.path"
						role="treeitem"
						:aria-expanded="r.children ? expanded.has(r.path) : undefined"
						:style="{ paddingLeft: `${r.depth * 16}px` }"
						class="book__tocrow"
						:class="{ 'book__tocrow--current': r.path === entry?.path }">
						<button v-if="r.children"
							type="button"
							class="book__twisty"
							:aria-label="expanded.has(r.path) ? t('phos', 'Collapse') : t('phos', 'Expand')"
							@click="toggle(r.path)">
							<NcIconSvgWrapper :path="expanded.has(r.path) ? iconExpand : iconNext" :size="16" />
						</button>
						<span v-else class="book__twisty" />
						<a href="#" class="book__toclink" @click.prevent="open(r.path)">{{ r.name || '…' }}</a>
					</li>
				</ul>
			</nav>
			<article class="book__entry">
				<NcLoadingIcon v-if="loading" :size="28" />
				<NcEmptyContent v-else-if="error" :name="t('phos', 'This entry cannot be shown')" :description="error" />
				<template v-else-if="entry">
					<div class="book__trail">
						<template v-for="p in entry.trail" :key="p">
							<a href="#" @click.prevent="open(p)">{{ p.split('/').pop() }}</a>
							<span aria-hidden="true">›</span>
						</template>
					</div>
					<h3>{{ entry.name }}</h3>
					<!-- eslint-disable-next-line vue/no-v-html -- bible/render.js output, escaped -->
					<div class="phos-text book__text" @click="onClick" v-html="html" />
					<p v-if="!html && entry.children" class="book__hint">
						{{ t('phos', 'This section has no text of its own — see its parts in the contents.') }}
					</p>
					<div class="book__nav">
						<NcButton :disabled="!entry.prev" @click="open(entry.prev)">
							<template #icon>
								<NcIconSvgWrapper :path="iconPrev" />
							</template>
							{{ t('phos', 'Previous') }}
						</NcButton>
						<NcButton :disabled="!entry.next" @click="open(entry.next)">
							{{ t('phos', 'Next') }}
							<template #icon>
								<NcIconSvgWrapper :path="iconNext" />
							</template>
						</NcButton>
					</div>
				</template>
			</article>
		</div>
		<TextPopover :popover="pop.popover.value" @ref="openRef" />
	</div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import TextPopover from '../components/TextPopover.vue'
import { useTextPopover } from '../components/useNotes.js'
import { modules, getToc, getBookEntry, prefs, defaultBible, pictureUrl } from '../services/phos.js'
import { render } from '../bible/render.js'
import { parseRef } from '../bible/books.js'
import { iconPrev, iconNext, iconExpand } from '../icons.js'

/** A general book (genbook): its contents as a tree, one entry at a time. */
const route = useRoute()
const router = useRouter()
const pop = useTextPopover()

const books = computed(() => modules.value.filter(m => m.kind === 'genbook' && !m.readingPlan))
const options = computed(() => books.value.map(m => ({ id: m.name, label: `${m.name} – ${m.description}`, locked: m.locked })))
const moduleName = computed(() => {
	const names = books.value.filter(m => !m.locked).map(m => m.name)
	return [route.params.module, prefs.get('book', null)].find(n => n && names.includes(n)) || names[0] || null
})
const moduleSel = computed({
	get: () => options.value.find(o => o.id === moduleName.value) || null,
	set: o => { prefs.set('book', o.id); router.push({ name: 'book', params: { module: o.id } }) },
})
const path = computed(() => typeof route.query.e === 'string' && route.query.e ? route.query.e : '/')

// ---------- contents ----------

const kids = reactive(new Map())     // path → [{name, path, children}]
const expanded = reactive(new Set())
const tocLoading = ref(false)

async function loadKids(p) {
	if (kids.has(p)) {
		return
	}
	const r = await getToc(moduleName.value, p)
	kids.set(p, r.children)
}

const rows = computed(() => {
	const out = []
	const walk = (p, depth) => {
		for (const c of kids.get(p) || []) {
			out.push({ ...c, depth })
			if (c.children && expanded.has(c.path)) {
				walk(c.path, depth + 1)
			}
		}
	}
	walk('/', 0)
	return out
})

async function toggle(p) {
	if (expanded.has(p)) {
		expanded.delete(p)
		return
	}
	await loadKids(p)
	expanded.add(p)
}

watch(moduleName, async name => {
	kids.clear()
	expanded.clear()
	if (!name) {
		return
	}
	tocLoading.value = true
	try {
		await loadKids('/')
	} finally {
		tocLoading.value = false
	}
}, { immediate: true })

// ---------- entry ----------

const entry = ref(null)
const loading = ref(false)
const error = ref('')
const notes = new Map()

const html = computed(() => {
	if (!entry.value) {
		return ''
	}
	const meta = modules.value.find(m => m.name === moduleName.value)
	const r = render(entry.value.text, { sourceType: meta?.sourceType, picture: pictureUrl(moduleName.value) })
	r.notes.forEach(n => notes.set(n.id, n))
	return [...r.headings.map(h => `<div class="phos-heading">${h}</div>`), r.html].join('')
})

watch(() => [moduleName.value, path.value], async ([name, p]) => {
	error.value = ''
	if (!name) {
		return
	}
	loading.value = !entry.value
	try {
		const e = await getBookEntry(name, p)
		entry.value = e
		// open the way to the entry in the contents
		for (const tp of e.trail) {
			await loadKids(tp)
			expanded.add(tp)
		}
		document.querySelector('#app-content-vue')?.scrollTo?.({ top: 0 })
	} catch (e) {
		error.value = e.message
	} finally {
		loading.value = false
	}
}, { immediate: true })

function open(p) {
	if (p) {
		router.push({ name: 'book', params: { module: moduleName.value }, query: { e: p } })
	}
}

function openRef(ref) {
	const p = parseRef(ref.replace(/^[^:]+:/, ''))
	if (p) {
		router.push({ name: 'bible', params: { module: defaultBible(), book: p.book, chapter: p.c1 }, query: p.v1 ? { v: p.v1 } : {} })
	}
}

function onClick(e) {
	const d = e.target.closest('a[data-module]')
	if (d) {
		e.preventDefault()
		const m = modules.value.find(x => x.name === d.dataset.module)
		if (m?.kind === 'genbook') {
			router.push({ name: 'book', params: { module: m.name }, query: { e: d.dataset.key } })
		} else if (m?.kind === 'dictionary') {
			router.push({ name: 'dict', params: { module: m.name, key: d.dataset.key } })
		}
		return
	}
	const a = e.target.closest('a[data-ref]')
	if (a) {
		e.preventDefault()
		openRef(a.dataset.ref)
		return
	}
	const n = e.target.closest('[data-note]')
	if (n && notes.has(n.dataset.note)) {
		pop.showNote(n, notes.get(n.dataset.note))
		return
	}
	pop.close()
}
</script>

<style scoped lang="scss">
.book {
	&__bar {
		margin-bottom: 12px;
	}

	&__module {
		max-width: 480px;
	}

	&__body {
		display: flex;
		gap: 20px;
		align-items: flex-start;
	}

	&__toc {
		width: 280px;
		flex: 0 0 280px;
		max-height: calc(100vh - 180px);
		overflow-y: auto;
		border-right: 1px solid var(--color-border);
		position: sticky;
		top: 0;

		ul {
			list-style: none;
			padding: 0;
			margin: 0;
		}
	}

	&__tocrow {
		display: flex;
		align-items: center;
		gap: 2px;
		border-radius: var(--border-radius);

		&:hover {
			background: var(--color-background-hover);
		}

		&--current {
			background: var(--color-primary-element-light);
			font-weight: bold;
		}
	}

	&__twisty {
		all: unset;
		display: inline-flex;
		width: 22px;
		height: 22px;
		flex: 0 0 22px;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	&__toclink {
		flex: 1;
		padding: 3px 4px;
		color: var(--color-main-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	&__entry {
		flex: 1;
		min-width: 0;
		max-width: 900px;

		h3 {
			font-size: 1.3em;
			font-weight: bold;
			margin: 0 0 10px;
		}
	}

	&__trail {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		color: var(--color-text-maxcontrast);
		font-size: 0.9em;
		margin-bottom: 4px;

		a {
			color: var(--color-primary-element);
		}
	}

	&__text :deep(.phos-img) {
		max-width: 100%;
		height: auto;
		display: block;
		margin: 8px 0;
	}

	&__hint {
		color: var(--color-text-maxcontrast);
		font-style: italic;
	}

	&__nav {
		display: flex;
		justify-content: space-between;
		margin-top: 24px;
	}
}

@media (max-width: 800px) {
	.book__body {
		flex-direction: column;
	}

	.book__toc {
		position: static;
		width: 100%;
		flex-basis: auto;
		max-height: 35vh;
		border-right: none;
	}
}
</style>
