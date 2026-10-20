<template>
	<div class="phos-page sermons-page">
		<h2>{{ t('phos', 'Sermons') }}</h2>
		<div class="sermons-page__top">
			<NcSelect v-model="sel"
				:options="options"
				:clearable="false"
				:input-label="t('phos', 'Sermon')"
				:placeholder="t('phos', 'Choose a sermon')"
				label="label"
				class="sermons-page__select" />
			<NcButton @click="create">
				<template #icon>
					<NcIconSvgWrapper :path="iconAdd" />
				</template>
				{{ t('phos', 'New sermon') }}
			</NcButton>
		</div>
		<NcEmptyContent v-if="!sermons.length" :name="t('phos', 'No sermons yet')" :description="t('phos', 'Sermons from the sermon builder of Phos Desktop appear here; you can also start one here.')" />
		<form v-else-if="draft" class="sermon" @submit.prevent>
			<div class="sermon__meta">
				<NcTextField v-model="draft.title" :label="t('phos', 'Title')" @update:model-value="touch" />
				<NcTextField v-model="draft.passage" :label="t('phos', 'Passage')" @update:model-value="touchPassage" />
				<NcSelect v-model="draft.bible"
					:options="bibleNames"
					:input-label="t('phos', 'Bible')"
					:clearable="false"
					@update:model-value="touch" />
			</div>
			<p class="sermon__links">
				<a v-if="passageRef" href="#" @click.prevent="openPassage">{{ t('phos', 'Read the passage') }}</a>
				<router-link v-if="exegesis" :to="{ name: 'exegesis', params: { id: exegesis.id } }">
					{{ t('phos', 'Exegesis: {title}', { title: exegesis.title || exegesis.ref }) }}
				</router-link>
				<router-link v-if="project" :to="{ name: 'projects', params: { id: project.id } }">
					{{ t('phos', 'Project: {title}', { title: project.title }) }}
				</router-link>
				<router-link v-if="deck" :to="{ name: 'decks', params: { id: deck.id } }">
					{{ t('phos', 'Slides: {title}', { title: deck.title }) }}
				</router-link>
				<span class="sermon__time">{{ t('phos', '{words} words · about {minutes} min', time) }}</span>
				<span v-if="current.rec.pending" class="sermon__pending">{{ t('phos', 'not yet synced') }}</span>
			</p>
			<NcTextArea v-model="draft.main_idea" :label="t('phos', 'Main idea')" resize="vertical" @update:model-value="touch" />
			<div class="sermon__row">
				<NcTextArea v-model="draft.goal" :label="t('phos', 'Goal')" resize="vertical" @update:model-value="touch" />
				<NcTextArea v-model="draft.audience" :label="t('phos', 'Audience')" resize="vertical" @update:model-value="touch" />
			</div>
			<NcTextArea v-model="draft.intro" :label="t('phos', 'Introduction')" resize="vertical" @update:model-value="touch" />

			<h3>{{ t('phos', 'Outline') }}</h3>
			<ol class="sermon__points">
				<li v-for="(pt, i) in draft.outline" :key="'p' + i" class="sermon__point">
					<div class="sermon__pointhead">
						<NcTextField v-model="pt.title" :label="t('phos', 'Point {n}', { n: i + 1 })" @update:model-value="touch" />
						<NcTextField v-model="pt.refs" :label="t('phos', 'Verses')" class="sermon__refs" @update:model-value="touch" />
						<NcActions>
							<NcActionButton :disabled="i === 0" @click="movePoint(i, -1)">
								{{ t('phos', 'Move up') }}
							</NcActionButton>
							<NcActionButton :disabled="i === draft.outline.length - 1" @click="movePoint(i, 1)">
								{{ t('phos', 'Move down') }}
							</NcActionButton>
							<NcActionButton @click="removePoint(i)">
								<template #icon>
									<NcIconSvgWrapper :path="iconDelete" />
								</template>
								{{ t('phos', 'Delete point') }}
							</NcActionButton>
						</NcActions>
					</div>
					<ul class="sermon__blocks">
						<li v-for="(b, k) in pt.blocks" :key="'b' + k" class="sermon__block" :class="'sermon__block--' + b.kind">
							<div class="sermon__blockhead">
								<NcSelect v-model="b.kind"
									:options="kindOptions"
									:reduce="o => o.id"
									label="label"
									:clearable="false"
									:aria-label-combobox="t('phos', 'Kind')"
									class="sermon__kind"
									@update:model-value="touch" />
								<NcTextField v-model="b.ref" :label="t('phos', 'Source')" @update:model-value="touch" />
								<NcActions>
									<NcActionButton :disabled="k === 0" @click="moveBlock(pt, k, -1)">
										{{ t('phos', 'Move up') }}
									</NcActionButton>
									<NcActionButton :disabled="k === pt.blocks.length - 1" @click="moveBlock(pt, k, 1)">
										{{ t('phos', 'Move down') }}
									</NcActionButton>
									<NcActionButton @click="pt.blocks.splice(k, 1); touch()">
										<template #icon>
											<NcIconSvgWrapper :path="iconDelete" />
										</template>
										{{ t('phos', 'Delete') }}
									</NcActionButton>
								</NcActions>
							</div>
							<NcTextArea v-model="b.text" :label="kindLabel(b.kind)" resize="vertical" @update:model-value="touch" />
						</li>
					</ul>
					<NcButton variant="tertiary" @click="addBlock(pt)">
						<template #icon>
							<NcIconSvgWrapper :path="iconAdd" />
						</template>
						{{ t('phos', 'Add building block') }}
					</NcButton>
				</li>
			</ol>
			<NcButton @click="addPoint">
				<template #icon>
					<NcIconSvgWrapper :path="iconAdd" />
				</template>
				{{ t('phos', 'Add point') }}
			</NcButton>

			<NcTextArea v-model="draft.conclusion" :label="t('phos', 'Conclusion')" resize="vertical" class="sermon__conclusion" @update:model-value="touch" />
			<div class="sermon__actions">
				<NcButton variant="error" @click="remove">
					<template #icon>
						<NcIconSvgWrapper :path="iconDelete" />
					</template>
					{{ t('phos', 'Delete sermon') }}
				</NcButton>
			</div>
		</form>
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { bibles, defaultBible, lang } from '../services/phos.js'
import {
	sermons, newSermon, saveSermon, deleteSermon, osisOfPassage, SERMON_KINDS, sermonMinutes,
	exegeses, projects, decks, pericopeRef,
} from '../services/docs.js'
import { parseRef } from '../bible/books.js'
import { iconAdd, iconDelete } from '../icons.js'

const route = useRoute()
const router = useRouter()

const KIND_LABELS = {
	note: () => t('phos', 'Note'), exegesis: () => t('phos', 'From the exegesis'), verse: () => t('phos', 'Verse'),
	quote: () => t('phos', 'Quotation'), illustration: () => t('phos', 'Illustration'), application: () => t('phos', 'Application'),
	question: () => t('phos', 'Question'), slide: () => t('phos', 'Slide'),
}
const kindLabel = k => (KIND_LABELS[k] || KIND_LABELS.note)()
const kindOptions = SERMON_KINDS.map(id => ({ id, label: kindLabel(id) }))

const options = computed(() => sermons.value.map(s => ({ id: s.id, label: s.title || t('phos', '(untitled)') })))
const sel = computed({
	get: () => options.value.find(o => o.id === route.params.id) || null,
	set: o => router.replace({ name: 'sermons', params: { id: o?.id } }),
})
const current = computed(() => sermons.value.find(s => s.id === route.params.id) || null)
const bibleNames = computed(() => bibles.value.map(b => b.name))

watch(() => [route.params.id, sermons.value.length], () => {
	if (!route.params.id && sermons.value.length) {
		router.replace({ name: 'sermons', params: { id: sermons.value[0].id } })
	}
}, { immediate: true })

// ---------- editing: a draft, saved shortly after the last change ----------

const draft = ref(null)
let dirty = false
let timer = null
const clone = p => {
	const d = JSON.parse(JSON.stringify(p || {}))
	d.outline = Array.isArray(d.outline) ? d.outline : []
	for (const pt of d.outline) {
		pt.blocks = Array.isArray(pt.blocks) ? pt.blocks : []
	}
	return d
}
watch(current, (s, old) => {
	if (!s) {
		draft.value = null
		return
	}
	// another sermon, or a change from elsewhere while nothing is typed here
	if (!old || old.id !== s.id || !dirty) {
		flush(old)
		draft.value = clone(s.p)
	}
}, { immediate: true })

function touch() {
	dirty = true
	clearTimeout(timer)
	timer = setTimeout(() => flush(), 800)
}
function touchPassage() {
	draft.value.passage_osis = osisOfPassage(draft.value.passage)
	touch()
}
function flush(target = current.value) {
	clearTimeout(timer)
	if (!dirty || !target || !draft.value) {
		dirty = false
		return
	}
	dirty = false
	saveSermon(target, draft.value)
}
onBeforeUnmount(() => flush())

const time = computed(() => sermonMinutes(draft.value || {}))

function create() {
	flush()
	const id = newSermon({ bible: defaultBible() || '' })
	router.replace({ name: 'sermons', params: { id } })
}
function remove() {
	if (!current.value || !confirm(t('phos', 'Delete this sermon on all devices?'))) {
		return
	}
	clearTimeout(timer)
	dirty = false
	deleteSermon(current.value)
	router.replace({ name: 'sermons', params: {} })
}
function addPoint() {
	draft.value.outline.push({ title: '', refs: '', blocks: [] })
	touch()
}
function removePoint(i) {
	if (draft.value.outline[i].blocks.length && !confirm(t('phos', 'Delete this point with its building blocks?'))) {
		return
	}
	draft.value.outline.splice(i, 1)
	touch()
}
function movePoint(i, d) {
	const o = draft.value.outline
	o.splice(i + d, 0, o.splice(i, 1)[0])
	touch()
}
function addBlock(pt) {
	pt.blocks.push({ kind: 'note', text: '', ref: '', osis: '' })
	touch()
}
function moveBlock(pt, k, d) {
	pt.blocks.splice(k + d, 0, pt.blocks.splice(k, 1)[0])
	touch()
}

// ---------- what the sermon names ----------

const passageRef = computed(() => draft.value?.passage_osis ? parseRef(draft.value.passage_osis) : null)
function openPassage() {
	const r = passageRef.value
	router.push({ name: 'bible', params: { module: draft.value.bible || defaultBible(), book: r.book, chapter: r.c1 }, query: r.v1 ? { v: r.v1 } : {} })
}
const exegesis = computed(() => {
	const e = exegeses.value.find(x => x.id === draft.value?.exegesis)
	return e ? { ...e, ref: pericopeRef(e.p, lang) } : null
})
const project = computed(() => projects.value.find(x => x.id === draft.value?.project) || null)
const deck = computed(() => decks.value.find(x => x.id === draft.value?.deck) || null)
</script>

<style scoped lang="scss">
.sermons-page {
	&__top {
		display: flex;
		gap: 12px;
		align-items: flex-end;
		flex-wrap: wrap;
		margin-bottom: 16px;
	}

	&__select {
		min-width: min(420px, 100%);
	}
}

.sermon {
	display: flex;
	flex-direction: column;
	gap: 10px;
	max-width: 900px;

	&__meta, &__row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 10px;
		align-items: end;
	}

	&__links {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 18px;
		color: var(--color-text-maxcontrast);

		a {
			color: var(--color-primary-element);
		}
	}

	&__pending {
		font-style: italic;
	}

	&__points {
		padding-left: 1.4em;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	&__point {
		border-left: 3px solid var(--color-primary-element-light);
		padding-left: 10px;
	}

	&__pointhead, &__blockhead {
		display: flex;
		gap: 8px;
		align-items: flex-end;
	}

	&__refs {
		max-width: 160px;
	}

	&__blocks {
		list-style: none;
		padding: 0;
		margin: 8px 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	&__block {
		background: var(--color-background-hover);
		border-radius: var(--border-radius-large);
		padding: 6px 8px;
	}

	&__kind {
		min-width: 190px;
	}

	&__actions {
		margin-top: 12px;
	}
}
</style>
