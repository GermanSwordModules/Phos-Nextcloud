<template>
	<div class="comm">
		<NcSelect v-model="chosenSel"
			class="comm__select"
			:options="options"
			:multiple="true"
			:close-on-select="false"
			:input-label="t('phos', 'Commentaries')"
			:placeholder="t('phos', 'none')"
			label="label" />
		<p v-if="!options.length" class="comm__empty">
			{{ t('phos', 'No commentary on the server yet.') }}
		</p>
		<div v-for="e in entries" :key="e.module" class="comm__entry">
			<div class="comm__head">
				<strong>{{ e.module }}</strong>
				<span v-if="e.verse" class="comm__ref">{{ e.ref }}</span>
			</div>
			<NcLoadingIcon v-if="e.loading" :size="20" />
			<p v-else-if="!e.html" class="comm__empty">
				{{ e.error || t('phos', 'Nothing on this verse.') }}
			</p>
			<template v-else>
				<!-- eslint-disable-next-line vue/no-v-html -- rendered by bible/render.js, which escapes -->
				<div v-if="open.has(e.module)" class="comm__text phos-text" @click="onClick" v-html="e.html" />
				<p v-else class="comm__teaser">
					{{ e.teaser }}
				</p>
				<NcButton v-if="e.long" variant="tertiary" class="comm__more" @click="toggle(e.module)">
					{{ open.has(e.module) ? t('phos', 'Less') : t('phos', 'Read more') }}
				</NcButton>
			</template>
		</div>
	</div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { t } from '@nextcloud/l10n'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { modules, getChapter, engine, prefs, lang } from '../services/phos.js'
import { render } from '../bible/render.js'
import { formatRef } from '../bible/books.js'

/**
 * What the chosen commentaries say on one verse — a teaser that opens up,
 * like the desktop's Bible reading page. The choice defaults to the
 * desktop's study commentaries (setting section StudyCommentaries).
 */
const props = defineProps({
	book: { type: String, default: null },
	chapter: { type: Number, default: 1 },
	verse: { type: Number, default: 1 },
})
const emit = defineEmits(['ref'])

const TEASER = 300
const commentaries = computed(() => modules.value.filter(m => m.kind === 'commentary' && !m.locked))
const options = computed(() => commentaries.value.map(m => ({ id: m.name, label: m.description ? `${m.name} – ${m.description}` : m.name })))

function desktopChoice() {
	return engine.list('setting')
		.filter(r => r.key.startsWith('setting:StudyCommentaries.'))
		.sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }))
		.map(r => r.payload?.value)
		.filter(Boolean)
}
const chosen = ref(prefs.get('commentaries', null))
const chosenNames = computed(() => {
	const have = new Set(commentaries.value.map(m => m.name))
	const want = chosen.value ?? desktopChoice()
	const list = want.filter(n => have.has(n))
	return list.length || chosen.value ? list : commentaries.value.slice(0, 2).map(m => m.name)
})
const chosenSel = computed({
	get: () => chosenNames.value.map(n => options.value.find(o => o.id === n)).filter(Boolean),
	set: v => { chosen.value = v.map(o => o.id); prefs.set('commentaries', chosen.value) },
})

const entries = ref([])
const open = reactive(new Set())
let seq = 0

function plain(html) {
	const d = document.createElement('div')
	d.innerHTML = html
	return (d.textContent || '').replace(/\s+/g, ' ').trim()
}

async function entryFor(name) {
	const meta = modules.value.find(m => m.name === name)
	const base = { module: name, verse: props.verse, ref: formatRef({ book: props.book, c1: props.chapter, v1: props.verse, c2: props.chapter, v2: props.verse }, lang) }
	try {
		const ch = await getChapter(name, props.book, props.chapter)
		// Many commentaries write one entry per section, at its first verse:
		// take the last entry at or before the verse being read.
		let at = props.verse
		let html = ''
		let txt = ''
		for (; at >= 1; at--) {
			const text = ch.verses[at] || ''
			if (text.trim()) {
				html = render(text, { sourceType: meta?.sourceType }).html
				txt = plain(html)
				if (txt) {
					break
				}
			}
		}
		if (!txt) {
			return base
		}
		// verses sharing one entry repeat it; point at where it starts
		const first = ch.links?.[at] || at
		const ref = first !== props.verse
			? formatRef({ book: props.book, c1: props.chapter, v1: first, c2: props.chapter, v2: props.verse }, lang)
			: base.ref
		return {
			...base, ref, html, long: txt.length > TEASER,
			teaser: txt.length > TEASER ? txt.slice(0, TEASER).replace(/\s\S*$/, '') + ' …' : txt,
		}
	} catch (e) {
		// a commentary without this book (e.g. NT only) just has nothing to say
		return { ...base, error: e.status === 422 ? t('phos', 'Not in this commentary.') : e.message }
	}
}

async function load() {
	const s = ++seq
	if (!props.book) {
		entries.value = []
		return
	}
	const names = chosenNames.value
	entries.value = names.map(n => ({ module: n, loading: true }))
	const out = await Promise.all(names.map(entryFor))
	if (s === seq) {
		entries.value = out
		for (const m of [...open]) {
			if (!out.some(e => e.module === m && e.long)) {
				open.delete(m)
			}
		}
	}
}

function toggle(m) {
	open.has(m) ? open.delete(m) : open.add(m)
}

function onClick(e) {
	const a = e.target.closest('a[data-ref]')
	if (a) {
		e.preventDefault()
		emit('ref', a.dataset.ref)
	}
}

// scrolling reports verses quickly; settle first
let timer = 0
watch(() => [props.book, props.chapter, props.verse, chosenNames.value.join('|')], () => {
	clearTimeout(timer)
	timer = setTimeout(load, 200)
}, { immediate: true })
</script>

<style scoped lang="scss">
.comm {
	min-width: 0;

	&__select {
		width: 100%;
		min-width: 0 !important;
		max-width: 100%;
	}

	:deep(.vs__selected) {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:deep(.vs__selected-options) {
		min-width: 0;
	}
	&__entry {
		margin-top: 10px;
		border-top: 1px solid var(--color-border);
		padding-top: 6px;
	}

	&__head {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	&__ref {
		color: var(--color-text-maxcontrast);
		font-size: 0.9em;
	}

	&__teaser,
	&__text {
		margin: 4px 0 0;
		line-height: 1.5;
	}

	&__text {
		font-size: 0.95rem;
	}

	&__empty {
		color: var(--color-text-maxcontrast);
		font-style: italic;
		margin: 4px 0 0;
	}

	&__more {
		margin-top: 2px;
	}
}
</style>
