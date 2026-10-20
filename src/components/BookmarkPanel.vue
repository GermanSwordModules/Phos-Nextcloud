<template>
	<div class="bm-panel">
		<div v-for="bm in covering" :key="bm.key" class="bm-panel__item">
			<div class="bm-panel__head">
				<strong>{{ refLabel(bm) }}</strong>
				<span v-if="bm.module" class="bm-panel__module">{{ bm.module }}</span>
				<span v-if="bm.pending" class="bm-panel__pending">{{ t('phos', 'not yet synced') }}</span>
				<NcButton variant="tertiary" :aria-label="t('phos', 'Delete bookmark')" @click="remove(bm)">
					<template #icon>
						<NcIconSvgWrapper :path="iconDelete" />
					</template>
				</NcButton>
			</div>
			<LabelPicker :selected="bm.labelNames || []" :collection="bm.collection" @update="picked => setBookmarkLabels(bm, picked)" />
			<h4>{{ t('phos', 'Note') }}</h4>
			<NoteEditor :key="bm.key + (bm.noteMd || '')"
				:text="bm.noteMd || ''"
				:has-rich="!!bm.noteHtml"
				@save="text => setNote(bm, text)" />
		</div>
		<NcEmptyContent v-if="!covering.length" :name="t('phos', 'No bookmark here yet')">
			<template #action>
				<NcButton variant="primary" @click="create">
					<template #icon>
						<NcIconSvgWrapper :path="iconAdd" />
					</template>
					{{ t('phos', 'Set bookmark') }}
				</NcButton>
			</template>
		</NcEmptyContent>
		<NcButton v-else-if="!exact" @click="create">
			<template #icon>
				<NcIconSvgWrapper :path="iconAdd" />
			</template>
			{{ t('phos', 'Bookmark exactly {ref}', { ref: selectionLabel }) }}
		</NcButton>
	</div>
</template>

<script setup>
import { computed } from 'vue'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import LabelPicker from './LabelPicker.vue'
import NoteEditor from './NoteEditor.vue'
import { bookmarksIn, createBookmark, deleteBookmark, setNote, setBookmarkLabels, lang } from '../services/phos.js'
import { formatRef } from '../bible/books.js'
import { iconAdd, iconDelete } from '../icons.js'

const props = defineProps({
	book: { type: String, required: true },
	chapter: { type: Number, required: true },
	from: { type: Number, required: true },
	to: { type: Number, required: true },
	module: { type: String, default: '' },
})

const covering = computed(() => bookmarksIn(props.book, props.chapter, props.module)
	.filter(b => b.vStart <= props.to && (b.vEnd || b.vStart) >= props.from)
	.sort((a, b) => a.vStart - b.vStart))
const exact = computed(() => covering.value.some(b => b.vStart === props.from && (b.vEnd || b.vStart) === props.to && !b.module))
const selectionLabel = computed(() => formatRef({ book: props.book, c1: props.chapter, v1: props.from, c2: props.chapter, v2: props.to }, lang))

function refLabel(bm) {
	return formatRef({ book: bm.bookOsis, c1: bm.chap, v1: bm.vStart, c2: bm.chap, v2: bm.vEnd || bm.vStart }, lang)
}

function create() {
	createBookmark(props.book, props.chapter, props.from, props.to)
}

function remove(bm) {
	if (bm.noteMd && !confirm(t('phos', 'Delete this bookmark and its note?'))) {
		return
	}
	deleteBookmark(bm)
}
</script>

<style scoped lang="scss">
.bm-panel {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 4px 2px;

	&__item {
		border-bottom: 1px solid var(--color-border);
		padding-bottom: 12px;

		h4 {
			margin: 10px 0 2px;
			font-size: 1em;
			font-weight: bold;
			color: var(--color-text-maxcontrast);
		}
	}

	&__head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;

		strong {
			flex: 1;
		}
	}

	&__module,
	&__pending {
		font-size: 0.85em;
		color: var(--color-text-maxcontrast);
	}
}
</style>
