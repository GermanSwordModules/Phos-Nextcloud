<template>
	<div class="phos-page pads">
		<h2>{{ t('phos', 'Study pads') }}</h2>
		<div class="pads__top">
			<NcSelect v-model="padSel"
				:options="padOptions"
				:clearable="false"
				:input-label="t('phos', 'Topic (label)')"
				label="label"
				class="pads__select" />
			<template v-if="pad">
				<NcColorPicker v-if="writable" :model-value="pad.color || '#4a90d9'" @update:model-value="c => saveLabel(pad, { color: c })">
					<NcButton>
						<template #icon>
							<span class="pads__swatch" :style="{ background: pad.color }" />
						</template>
						{{ t('phos', 'Color') }}
					</NcButton>
				</NcColorPicker>
				<span v-if="pad.shared" class="pads__shared">
					<NcIconSvgWrapper :path="iconPerson" :size="16" />
					{{ t('phos', 'shared by {owner}', { owner: pad.owner }) }}{{ writable ? '' : ' · ' + t('phos', 'read only') }}
				</span>
			</template>
		</div>
		<NcEmptyContent v-if="!labels.length" :name="t('phos', 'No study pads yet')" :description="t('phos', 'Every label is a study pad: it collects the bookmarks and notes that carry it.')" />
		<template v-else-if="pad">
			<ol class="pads__items">
				<li v-for="(it, i) in items"
					:key="it.key"
					class="pads__item"
					:style="{ marginLeft: (it.indent || 0) * 24 + 'px' }">
					<div class="pads__head">
						<a v-if="it.bookOsis" href="#" class="pads__ref" @click.prevent="open(it)">{{ refOf(it) }}</a>
						<strong v-else class="pads__ref">{{ it.entryKey ? `${it.module}: ${it.entryKey}` : t('phos', 'Own note') }}</strong>
						<span v-for="name in (it.labelNames || []).filter(n => n !== pad.name)"
							:key="name"
							class="phos-chip">{{ labelDisplay(name) }}</span>
						<span class="pads__spacer" />
						<template v-if="writable">
							<NcButton variant="tertiary" :disabled="i === 0" :aria-label="t('phos', 'Move up')" @click="move(i, -1)">
								<template #icon>
									<NcIconSvgWrapper :path="iconUp" />
								</template>
							</NcButton>
							<NcButton variant="tertiary" :disabled="i === items.length - 1" :aria-label="t('phos', 'Move down')" @click="move(i, 1)">
								<template #icon>
									<NcIconSvgWrapper :path="iconDown" />
								</template>
							</NcButton>
							<NcActions>
								<NcActionButton @click="indent(it, 1)">
									{{ t('phos', 'Indent') }}
								</NcActionButton>
								<NcActionButton :disabled="!it.indent" @click="indent(it, -1)">
									{{ t('phos', 'Outdent') }}
								</NcActionButton>
								<NcActionButton v-if="it.bookOsis || it.entryKey" @click="removeFromPad(it)">
									{{ t('phos', 'Remove from this pad') }}
								</NcActionButton>
								<NcActionButton @click="remove(it)">
									<template #icon>
										<NcIconSvgWrapper :path="iconDelete" />
									</template>
									{{ t('phos', 'Delete') }}
								</NcActionButton>
							</NcActions>
						</template>
					</div>
					<PassageText v-if="it.bookOsis && it.kind !== 'entry'"
						compact
						:module="defaultBible()"
						:passage="{ book: it.bookOsis, c1: it.chap, v1: it.vStart, c2: it.chap, v2: it.vEnd || it.vStart }"
						@ref="gotoRef" />
					<blockquote v-if="it.snippetText" class="pads__snippet">
						„{{ it.snippetText }}“
					</blockquote>
					<NoteEditor v-if="writable"
						:key="it.key + (it.noteMd || '')"
						:text="it.noteMd || ''"
						:has-rich="!!it.noteHtml"
						@save="text => setNote(it, text)" />
					<Markdown v-else :text="it.noteMd || ''" />
				</li>
			</ol>
			<NcEmptyContent v-if="!items.length" :name="t('phos', 'This pad is empty')" :description="t('phos', 'Give bookmarks this label in the Bible view, or add your own note.')" />
			<div v-if="writable" class="pads__add">
				<NoteEditor v-if="adding"
					start-editing
					text=""
					@save="addNote"
					@cancel="adding = false" />
				<NcButton v-else @click="adding = true">
					<template #icon>
						<NcIconSvgWrapper :path="iconAdd" />
					</template>
					{{ t('phos', 'Add own note') }}
				</NcButton>
			</div>
		</template>
	</div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcColorPicker from '@nextcloud/vue/components/NcColorPicker'
import NoteEditor from '../components/NoteEditor.vue'
import Markdown from '../components/Markdown.vue'
import PassageText from '../components/PassageText.vue'
import {
	labels, labelDisplay, bookmarks, engine, saveLabel, setNote, updateBookmark, deleteBookmark,
	createPadNote, defaultBible, lang,
} from '../services/phos.js'
import { formatRef, parseRef } from '../bible/books.js'
import { iconAdd, iconDelete, iconUp, iconDown, iconPerson } from '../icons.js'

const route = useRoute()
const router = useRouter()
const adding = ref(false)

// route param: "<collection>|<name>" (names repeat across collections)
const padOptions = computed(() => labels.value.map(l => ({
	id: `${l.collection}|${l.name}`, label: labelDisplay(l.name) + (l.shared ? ` (${l.owner})` : ''), l,
})))
const padSel = computed({
	get: () => padOptions.value.find(o => o.id === route.params.label) || padOptions.value[0] || null,
	set: o => o && router.replace({ name: 'pads', params: { label: o.id } }),
})
const pad = computed(() => padSel.value?.l || null)
const writable = computed(() => pad.value && engine.writable(pad.value.collection))

const items = computed(() => pad.value
	? bookmarks.value
		.filter(b => b.collection === pad.value.collection && b.labelNames?.includes(pad.value.name))
		.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (a.created || 0) - (b.created || 0))
	: [])

function refOf(it) {
	return formatRef({ book: it.bookOsis, c1: it.chap, v1: it.vStart, c2: it.chap, v2: it.vEnd || it.vStart }, lang)
}

function open(it) {
	router.push({ name: 'bible', params: { module: defaultBible(), book: it.bookOsis, chapter: it.chap }, query: { v: it.vStart } })
}

function gotoRef(ref) {
	const r = parseRef(ref)
	if (r) {
		router.push({ name: 'bible', params: { module: defaultBible(), book: r.book, chapter: r.c1 }, query: r.v1 ? { v: r.v1 } : {} })
	}
}

/** Swaps neighbours; renumbers the pad when orders collide (the desktop does the same). */
function move(i, d) {
	const list = [...items.value]
	const [x] = list.splice(i, 1)
	list.splice(i + d, 0, x)
	list.forEach((it, n) => {
		if ((it.sortOrder || 0) !== n) {
			updateBookmark(it, { sortOrder: n })
		}
	})
}

function indent(it, d) {
	const v = Math.max(0, (it.indent || 0) + d)
	updateBookmark(it, { indent: v || undefined })
}

function removeFromPad(it) {
	updateBookmark(it, { labelNames: it.labelNames.filter(n => n !== pad.value.name) })
}

function remove(it) {
	if (confirm(t('phos', 'Delete this item and its note everywhere?'))) {
		deleteBookmark(it)
	}
}

function addNote(text) {
	adding.value = false
	if (text.trim()) {
		createPadNote(pad.value, text, items.value.length ? Math.max(...items.value.map(i => i.sortOrder || 0)) + 1 : 0)
	}
}
</script>

<style scoped lang="scss">
.pads {
	&__top {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
		margin-bottom: 14px;
	}

	&__select {
		min-width: 260px;
	}

	&__swatch {
		display: inline-block;
		width: 16px;
		height: 16px;
		border-radius: 50%;
	}

	&__shared {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--color-text-maxcontrast);
	}

	&__items {
		list-style: none;
		padding: 0;
	}

	&__item {
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-large);
		padding: 8px 12px;
		margin-bottom: 10px;
	}

	&__head {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	&__ref {
		font-weight: bold;
		color: var(--color-main-text);
	}

	&__spacer {
		flex: 1;
	}

	&__snippet {
		color: var(--color-text-maxcontrast);
		font-style: italic;
	}

	&__add {
		margin-top: 12px;
	}
}
</style>
