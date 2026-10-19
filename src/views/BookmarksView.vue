<template>
	<div class="phos-page">
		<h2>{{ notesOnly ? t('phos', 'Notes') : t('phos', 'Bookmarks') }}</h2>
		<div class="bms__filters">
			<NcTextField v-model="search" :label="t('phos', 'Search in references and notes')" class="bms__search" />
			<NcSelect v-model="labelFilter"
				:options="labelOptions"
				:input-label="t('phos', 'Label')"
				:placeholder="t('phos', 'all labels')"
				label="label"
				class="bms__label" />
			<NcSelect v-model="sort" :options="sortOptions" :clearable="false" :input-label="t('phos', 'Order')" label="label" />
			<NcCheckboxRadioSwitch v-model="withText" type="switch">
				{{ t('phos', 'Show Bible text') }}
			</NcCheckboxRadioSwitch>
		</div>
		<NcEmptyContent v-if="!filtered.length" :name="notesOnly ? t('phos', 'No notes found') : t('phos', 'No bookmarks found')" />
		<ul class="bms__list">
			<li v-for="bm in shown" :key="bm.key" class="bms__item">
				<div class="bms__head">
					<a class="bms__ref" href="#" @click.prevent="open(bm)">{{ refOf(bm) }}</a>
					<span v-if="bm.module" class="bms__module">{{ bm.module }}</span>
					<span v-for="name in bm.labelNames || []"
						:key="name"
						class="phos-chip"
						:style="{ '--phos-chip': colorOf(bm, name) }">{{ labelDisplay(name) }}</span>
					<span class="bms__date">{{ dateOf(bm) }}</span>
				</div>
				<blockquote v-if="bm.snippetText" class="bms__snippet">
					„{{ bm.snippetText }}“
				</blockquote>
				<PassageText v-if="withText && bm.bookOsis && bm.kind !== 'entry'"
					compact
					:module="bm.module && isBible(bm.module) ? bm.module : defaultBible()"
					:passage="{ book: bm.bookOsis, c1: bm.chap, v1: bm.vStart, c2: bm.chap, v2: bm.vEnd || bm.vStart }" />
				<NoteEditor :key="bm.key + (bm.noteMd || '')"
					:text="bm.noteMd || ''"
					:has-rich="!!bm.noteHtml"
					:placeholder="t('phos', 'Add a note …')"
					@save="text => setNote(bm, text)" />
			</li>
		</ul>
		<NcButton v-if="filtered.length > limit" @click="limit += 100">
			{{ t('phos', 'Show more ({n} left)', { n: filtered.length - limit }) }}
		</NcButton>
	</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NoteEditor from '../components/NoteEditor.vue'
import PassageText from '../components/PassageText.vue'
import { bookmarks, labels, labelDisplay, setNote, defaultBible, bibles, lang, prefs } from '../services/phos.js'
import { formatRef, KJV_ORDER, normalize } from '../bible/books.js'
import { htmlText } from '../search/notes.js'

const props = defineProps({ notesOnly: { type: Boolean, default: false } })
const router = useRouter()
const search = ref('')
const labelFilter = ref(null)
const limit = ref(100)
const withText = ref(prefs.get('listWithText', false))
const sortOptions = [
	{ id: 'bible', label: t('phos', 'Bible order') },
	{ id: 'new', label: t('phos', 'Newest first') },
]
const sort = ref(sortOptions[props.notesOnly ? 1 : 0])

const labelOptions = computed(() => labels.value.map(l => ({ id: l.collection + '|' + l.name, name: l.name, collection: l.collection, label: labelDisplay(l.name) + (l.shared ? ` (${l.owner})` : '') })))

const isBible = name => bibles.value.some(b => b.name === name)

function refOf(bm) {
	if (!bm.bookOsis) {
		return bm.entryKey ? `${bm.module}: ${bm.entryKey}` : t('phos', 'Own note')
	}
	return formatRef({ book: bm.bookOsis, c1: bm.chap, v1: bm.vStart, c2: bm.chap, v2: bm.vEnd || bm.vStart }, lang)
}

function colorOf(bm, name) {
	return labels.value.find(l => l.name === name && l.collection === bm.collection)?.color || 'var(--color-border-dark)'
}

function dateOf(bm) {
	return bm.modified ? new Date(bm.modified * 1000).toLocaleDateString() : ''
}

const filtered = computed(() => {
	const q = normalize(search.value)
	const lf = labelFilter.value
	const list = bookmarks.value.filter(bm => {
		if (props.notesOnly && !bm.noteMd && !bm.noteHtml) {
			return false
		}
		if (lf && !(bm.collection === lf.collection && bm.labelNames?.includes(lf.name))) {
			return false
		}
		// desktop notes may only have the HTML from their RTF
		return !q || normalize(refOf(bm) + ' ' + (bm.noteMd || htmlText(bm.noteHtml)) + ' ' + (bm.snippetText || '')).includes(q)
	})
	const pos = bm => (KJV_ORDER.indexOf(bm.bookOsis) + 1 || 999) * 1e6 + bm.chap * 1e3 + bm.vStart
	return sort.value.id === 'new'
		? list.sort((a, b) => (b.modified || 0) - (a.modified || 0))
		: list.sort((a, b) => pos(a) - pos(b))
})
const shown = computed(() => filtered.value.slice(0, limit.value))

function open(bm) {
	if (bm.bookOsis) {
		router.push({ name: 'bible', params: { module: bm.module && isBible(bm.module) ? bm.module : defaultBible(), book: bm.bookOsis, chapter: bm.chap }, query: { v: bm.vStart } })
	}
}

watch(withText, v => prefs.set('listWithText', v))
</script>

<style scoped lang="scss">
.bms {
	&__filters {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
		margin-bottom: 14px;
	}

	&__search {
		max-width: 340px;
	}

	&__label {
		min-width: 200px;
	}

	&__item {
		border-bottom: 1px solid var(--color-border);
		padding: 10px 0;
	}

	&__head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-bottom: 4px;
	}

	&__ref {
		font-weight: bold;
		color: var(--color-main-text);
	}

	&__module,
	&__date {
		color: var(--color-text-maxcontrast);
		font-size: 0.85em;
	}

	&__date {
		margin-left: auto;
	}

	&__snippet {
		color: var(--color-text-maxcontrast);
		font-style: italic;
		margin: 2px 0 4px;
	}
}
</style>
