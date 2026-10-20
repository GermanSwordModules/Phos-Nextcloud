<template>
	<div class="phos-page exegesis">
		<NcEmptyContent v-if="!ex" :name="t('phos', 'Exegesis not found')" :description="t('phos', 'It may not be synced yet, or it was deleted.')" />
		<article v-else>
			<p class="exegesis__crumbs">
				<router-link v-if="project" :to="{ name: 'projects', params: { id: project.id } }">
					{{ project.title }}
				</router-link>
				<router-link v-else :to="{ name: 'projects' }">
					{{ t('phos', 'Projects') }}
				</router-link>
			</p>
			<h2>{{ ref_ }}{{ ex.title && ex.title !== ref_ ? ' — ' + ex.title : '' }}</h2>
			<p class="exegesis__meta">
				<a v-if="book" href="#" @click.prevent="openBible">{{ t('phos', 'Read in {module}', { module: bible }) }}</a>
				<span v-if="comments.length">{{ t('phos', 'Commentaries: {list}', { list: comments.join(', ') }) }}</span>
				<span v-if="saved">{{ t('phos', 'Saved {date}', { date: saved }) }}</span>
			</p>
			<p v-if="sermonsHere.length" class="exegesis__meta">
				{{ t('phos', 'Sermons:') }}
				<router-link v-for="s in sermonsHere" :key="s.key" :to="{ name: 'sermons', params: { id: s.id } }">
					{{ s.title || t('phos', '(untitled)') }}
				</router-link>
			</p>
			<NcLoadingIcon v-if="loading" />
			<p v-else-if="error" class="exegesis__error">
				{{ error }}
			</p>
			<div v-else-if="html" class="phos-rtf" v-html="html" />
			<p v-else class="exegesis__empty">
				{{ t('phos', 'No text written yet.') }}
			</p>
			<p v-if="ex.p.docMode === 'external'" class="exegesis__empty">
				{{ t('phos', 'This exegesis is kept in an external document ({path}), which stays on the desktop.', { path: ex.p.docPath }) }}
			</p>
		</article>
	</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { defaultBible, lang, modules } from '../services/phos.js'
import { exegeses, projects, sermons, pericopeRef, bookOfIndex, fullPayload, deskDate } from '../services/docs.js'
import { rtfToHtml } from '../docs/rtf.js'

const route = useRoute()
const router = useRouter()

const ex = computed(() => exegeses.value.find(e => e.id === route.params.id) || null)
const ref_ = computed(() => (ex.value ? pericopeRef(ex.value.p, lang) : ''))
const book = computed(() => (ex.value ? bookOfIndex(ex.value.p.bookStart) : null))
const project = computed(() => projects.value.find(p => p.id === ex.value?.p.project) || null)
const sermonsHere = computed(() => sermons.value.filter(s => ex.value && s.p.exegesis === ex.value.id))
const comments = computed(() => (Array.isArray(ex.value?.p.commentModules) ? ex.value.p.commentModules : []))
const bible = computed(() => {
	const m = ex.value?.p.bibleModule
	return m && modules.value.some(x => x.name === m) ? m : defaultBible()
})
const saved = computed(() => {
	const d = deskDate(ex.value?.p.savedDate)
	return d ? d.toLocaleDateString(lang) : ''
})

const html = ref('')
const loading = ref(false)
const error = ref('')
watch(ex, async e => {
	html.value = ''
	error.value = ''
	if (!e) {
		return
	}
	loading.value = true
	try {
		const p = await fullPayload(e.rec)
		html.value = p?.rtf ? rtfToHtml(p.rtf) : ''
	} catch (err) {
		error.value = t('phos', 'This exegesis could not be loaded: {error}', { error: err.message })
	} finally {
		loading.value = false
	}
}, { immediate: true })

function openBible() {
	router.push({ name: 'bible', params: { module: bible.value, book: book.value, chapter: ex.value.p.chapStart || 1 }, query: { v: ex.value.p.verseStart || 1 } })
}
</script>

<style scoped lang="scss">
.exegesis {
	article {
		max-width: 900px;
	}

	&__crumbs a, &__meta a {
		color: var(--color-primary-element);
	}

	&__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		color: var(--color-text-maxcontrast);
	}

	&__empty {
		color: var(--color-text-maxcontrast);
		font-style: italic;
	}

	&__error {
		color: var(--color-error);
	}
}
</style>
