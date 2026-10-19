<template>
	<div class="phos-page dict">
		<div class="dict__bar">
			<NcSelect v-model="moduleSel"
				class="dict__module"
				:options="options"
				:clearable="false"
				:selectable="o => !o.locked"
				:input-label="t('phos', 'Dictionary')"
				label="label" />
			<form class="dict__find" @submit.prevent="jump">
				<NcTextField v-model="query"
					:label="t('phos', 'Look up')"
					:show-trailing-button="!!query"
					trailing-button-icon="arrowEnd"
					@trailing-button-click="jump" />
			</form>
		</div>
		<NcEmptyContent v-if="!moduleName" :name="t('phos', 'No dictionary on the server yet')" />
		<div v-else class="dict__body">
			<ol ref="listEl" class="dict__keys" role="listbox" :aria-label="t('phos', 'Entries')">
				<li v-if="keys.length && canBack">
					<NcButton variant="tertiary" wide @click="back">
						{{ t('phos', 'Earlier entries') }}
					</NcButton>
				</li>
				<li v-for="k in keys"
					:key="k"
					role="option"
					:aria-selected="k === key"
					class="dict__key"
					:class="{ 'dict__key--current': k === key }"
					@click="open(k)">
					{{ k }}
				</li>
				<li v-if="keys.length && !atEnd">
					<NcButton variant="tertiary" wide @click="more">
						{{ t('phos', 'More entries') }}
					</NcButton>
				</li>
			</ol>
			<div class="dict__entry">
				<NcLoadingIcon v-if="loading" :size="28" />
				<NcEmptyContent v-else-if="error" :name="error" />
				<template v-else-if="entry">
					<h3>{{ entry.key }}</h3>
					<!-- eslint-disable-next-line vue/no-v-html -- bible/render.js output, escaped -->
					<div class="phos-text dict__text" @click="onClick" v-html="entry.html" />
				</template>
			</div>
		</div>
		<TextPopover :popover="pop.popover.value" @ref="openRef" />
	</div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import TextPopover from '../components/TextPopover.vue'
import { useTextPopover } from '../components/useNotes.js'
import { modules, getEntry, getKeys, prefs, defaultBible, pictureUrl } from '../services/phos.js'
import { render } from '../bible/render.js'
import { parseRef } from '../bible/books.js'

/** A dictionary or lexicon: its keys in order, one entry at a time. */
const PAGE = 200
const route = useRoute()
const router = useRouter()
const pop = useTextPopover()

const dicts = computed(() => modules.value.filter(m => m.kind === 'dictionary' && !m.readingPlan))
const options = computed(() => dicts.value.map(m => ({ id: m.name, label: `${m.name} – ${m.description}`, locked: m.locked })))
const moduleName = computed(() => {
	const names = dicts.value.filter(m => !m.locked).map(m => m.name)
	return [route.params.module, prefs.get('dict', null)].find(n => n && names.includes(n)) || names[0] || null
})
const moduleSel = computed({
	get: () => options.value.find(o => o.id === moduleName.value) || null,
	set: o => { prefs.set('dict', o.id); router.push({ name: 'dict', params: { module: o.id } }) },
})
const key = computed(() => route.params.key || '')

const keys = ref([])
const atEnd = ref(false)
const canBack = ref(false)
const query = ref('')
const entry = ref(null)
const loading = ref(false)
const error = ref('')
const listEl = ref(null)
const notes = new Map()

async function loadKeys(from) {
	const k = await getKeys(moduleName.value, from, PAGE)
	keys.value = k
	atEnd.value = k.length < PAGE
	canBack.value = from !== '' && (await getKeys(moduleName.value, k[0] || from, 1, true)).length > 0
}

async function more() {
	const last = keys.value[keys.value.length - 1]
	const k = await getKeys(moduleName.value, last, PAGE + 1)
	const add = k.filter(x => x !== last)
	keys.value = [...keys.value, ...add]
	atEnd.value = k.length < PAGE + 1
}

async function back() {
	const k = await getKeys(moduleName.value, keys.value[0] || '', PAGE, true)
	keys.value = [...k, ...keys.value]
	canBack.value = k.length === PAGE
}

function open(k) {
	router.push({ name: 'dict', params: { module: moduleName.value, key: k } })
}

async function jump() {
	const q = query.value.trim()
	if (!q) {
		return
	}
	await loadKeys(q)
	if (keys.value.length) {
		open(keys.value[0])
	}
}

async function showEntry() {
	error.value = ''
	entry.value = null
	if (!moduleName.value || !key.value) {
		return
	}
	loading.value = true
	try {
		const e = await getEntry(moduleName.value, key.value)
		const meta = modules.value.find(m => m.name === moduleName.value)
		const r = render(e.text, { sourceType: meta?.sourceType, picture: pictureUrl(moduleName.value) })
		r.notes.forEach(n => notes.set(n.id, n))
		entry.value = { key: e.key, html: r.html }
	} catch (e) {
		error.value = e.status === 404 ? t('phos', 'No entry “{key}”', { key: key.value }) : e.message
	} finally {
		loading.value = false
	}
}

watch(moduleName, async name => {
	keys.value = []
	if (!name) {
		return
	}
	await loadKeys(key.value)
	if (!key.value && keys.value.length) {
		router.replace({ name: 'dict', params: { module: name, key: keys.value[0] } })
	}
}, { immediate: true })

watch(key, async k => {
	showEntry()
	if (k && !keys.value.includes(k)) {
		await loadKeys(k)
	}
	await nextTick()
	listEl.value?.querySelector('.dict__key--current')?.scrollIntoView({ block: 'nearest' })
}, { immediate: true })

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
		const target = modules.value.find(m => m.name === d.dataset.module) ? d.dataset.module : moduleName.value
		router.push({ name: 'dict', params: { module: target, key: d.dataset.key } })
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
.dict {
	&__bar {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
		margin-bottom: 12px;
	}

	&__module {
		min-width: 260px;
		flex: 1 1 260px;
		max-width: 420px;
	}

	&__find {
		flex: 1 1 200px;
		max-width: 300px;
	}

	&__body {
		display: flex;
		gap: 20px;
		align-items: flex-start;
	}

	&__keys {
		list-style: none;
		padding: 0;
		width: 220px;
		flex: 0 0 220px;
		max-height: calc(100vh - 200px);
		overflow-y: auto;
		border-right: 1px solid var(--color-border);
	}

	&__key {
		padding: 3px 8px;
		cursor: pointer;
		border-radius: var(--border-radius);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;

		&:hover {
			background: var(--color-background-hover);
		}

		&--current {
			background: var(--color-primary-element-light);
			font-weight: bold;
		}
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

	&__text :deep(.phos-img) {
		max-width: 100%;
		height: auto;
		display: block;
		margin: 8px 0;
	}
}

@media (max-width: 700px) {
	.dict__body {
		flex-direction: column;
	}

	.dict__keys {
		width: 100%;
		flex-basis: auto;
		max-height: 30vh;
		border-right: none;
	}
}
</style>
