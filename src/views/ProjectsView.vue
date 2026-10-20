<template>
	<div class="phos-page projects">
		<h2>{{ t('phos', 'Projects') }}</h2>
		<NcEmptyContent v-if="!projects.length && !exegeses.length"
			:name="t('phos', 'No projects yet')"
			:description="t('phos', 'Study projects and exegeses of Phos Desktop appear here once they are synced.')" />
		<div v-else class="projects__layout">
			<nav class="projects__list" :aria-label="t('phos', 'Projects')">
				<template v-for="g in groups" :key="g.name">
					<h3 class="projects__cat">
						{{ g.name || t('phos', 'Projects') }}
					</h3>
					<router-link v-for="p in g.items"
						:key="p.key"
						:to="{ name: 'projects', params: { id: p.id } }"
						class="projects__item"
						:class="{ 'projects__item--on': p.id === route.params.id }">
						{{ p.title || t('phos', '(untitled)') }}
						<span class="projects__kind">{{ kindLabel(p.kind) }}</span>
					</router-link>
				</template>
				<template v-if="loose.length">
					<h3 class="projects__cat">
						{{ t('phos', 'Exegeses without a project') }}
					</h3>
					<router-link v-for="e in loose"
						:key="e.key"
						:to="{ name: 'exegesis', params: { id: e.id } }"
						class="projects__item">
						{{ e.title || pericopeRef(e.p, lang) }}
						<span class="projects__kind">{{ pericopeRef(e.p, lang) }}</span>
					</router-link>
				</template>
			</nav>
			<article v-if="current" class="projects__doc">
				<h2>{{ current.title }}</h2>
				<p class="projects__meta">
					{{ [kindLabel(current.kind), current.status, current.category].filter(Boolean).join(' · ') }}
				</p>
				<p v-if="pj.question" class="projects__question">
					{{ pj.question }}
				</p>
				<p v-if="pj.description">
					{{ pj.description }}
				</p>
				<NcLoadingIcon v-if="loading" />
				<p v-else-if="loadError" class="projects__error">
					{{ loadError }}
				</p>

				<section v-if="checklist.length">
					<h3>{{ t('phos', 'Steps') }}</h3>
					<ul class="projects__check">
						<li v-for="(c, i) in checklist" :key="i" :class="{ 'projects__check--done': c.done }">
							{{ c.done ? '☑' : '☐' }} {{ c.title }}
						</li>
					</ul>
				</section>

				<section v-if="ownExegeses.length">
					<h3>{{ t('phos', 'Exegeses') }}</h3>
					<ul>
						<li v-for="e in ownExegeses" :key="e.key">
							<router-link :to="{ name: 'exegesis', params: { id: e.id } }">
								{{ pericopeRef(e.p, lang) }}{{ e.title ? ' — ' + e.title : '' }}
							</router-link>
						</li>
					</ul>
				</section>
				<section v-if="ownSermons.length || ownDecks.length">
					<h3>{{ t('phos', 'Sermons and slides') }}</h3>
					<ul>
						<li v-for="s in ownSermons" :key="s.key">
							<router-link :to="{ name: 'sermons', params: { id: s.id } }">
								{{ s.title || t('phos', '(untitled)') }}
							</router-link>
						</li>
						<li v-for="d in ownDecks" :key="d.key">
							<router-link :to="{ name: 'decks', params: { id: d.id } }">
								▶ {{ d.title }}
							</router-link>
						</li>
					</ul>
				</section>
				<section v-if="concepts.length">
					<h3>{{ t('phos', 'Concepts') }}</h3>
					<p class="projects__concepts">
						<span v-for="(c, i) in concepts" :key="i" class="phos-chip">{{ c.gloss ? `${c.lexeme} – ${c.gloss}` : c.lexeme }}</span>
					</p>
				</section>
				<section v-if="notesHtml">
					<h3>{{ t('phos', 'Notes') }}</h3>
					<div class="phos-rtf" v-html="notesHtml" />
				</section>
				<section v-if="synthesisHtml">
					<h3>{{ t('phos', 'Synthesis') }}</h3>
					<div class="phos-rtf" v-html="synthesisHtml" />
				</section>
				<section v-if="findings.length">
					<h3>{{ t('phos', 'Findings') }}</h3>
					<ul>
						<li v-for="(f, i) in findings" :key="i">
							<strong v-if="f.title">{{ f.title }}</strong>
							{{ f.text || f.note || '' }}
						</li>
					</ul>
				</section>
				<p class="projects__hint">
					{{ t('phos', 'Projects are edited in Phos Desktop.') }}
				</p>
			</article>
		</div>
	</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { lang } from '../services/phos.js'
import { projects, exegeses, sermons, decks, pericopeRef, fullPayload } from '../services/docs.js'
import { rtfToHtml } from '../docs/rtf.js'

const route = useRoute()
const router = useRouter()

const KINDS = { study: () => t('phos', 'Study'), paper: () => t('phos', 'Paper'), children: () => t('phos', 'Children’s church'), sermon: () => t('phos', 'Sermon') }
const kindLabel = k => (KINDS[k] ? KINDS[k]() : k || '')

const groups = computed(() => {
	const m = new Map()
	for (const p of projects.value) {
		if (!m.has(p.category)) {
			m.set(p.category, [])
		}
		m.get(p.category).push(p)
	}
	return [...m].sort((a, b) => (a[0] === '') - (b[0] === '') || a[0].localeCompare(b[0])).map(([name, items]) => ({ name, items }))
})
const known = computed(() => new Set(projects.value.map(p => p.id)))
const loose = computed(() => exegeses.value.filter(e => !e.p.project || !known.value.has(e.p.project)))

const current = computed(() => projects.value.find(p => p.id === route.params.id) || null)
watch(() => [route.params.id, projects.value.length], () => {
	if (!route.params.id && projects.value.length) {
		router.replace({ name: 'projects', params: { id: projects.value[0].id } })
	}
}, { immediate: true })

const full = ref(null)
const loading = ref(false)
const loadError = ref('')
watch(current, async c => {
	full.value = null
	loadError.value = ''
	if (!c) {
		return
	}
	loading.value = true
	try {
		full.value = await fullPayload(c.rec)
	} catch (e) {
		loadError.value = t('phos', 'This project could not be loaded: {error}', { error: e.message })
	} finally {
		loading.value = false
	}
}, { immediate: true })

const pj = computed(() => full.value?.project || {})
// the desktop's project.json keeps some lists as JSON text
const listOf = v => {
	if (Array.isArray(v)) {
		return v
	}
	if (typeof v === 'string' && v.trim().startsWith('[')) {
		try {
			return JSON.parse(v)
		} catch {
			return []
		}
	}
	return []
}
const checklist = computed(() => listOf(pj.value.checklist).filter(c => c && c.title))
const concepts = computed(() => listOf(pj.value.concepts).filter(c => c && c.lexeme))
const findings = computed(() => listOf(full.value?.findings).filter(f => f && typeof f === 'object'))
const notesHtml = computed(() => (full.value?.notesRtf ? rtfToHtml(full.value.notesRtf) : ''))
const synthesisHtml = computed(() => (full.value?.synthesisRtf ? rtfToHtml(full.value.synthesisRtf) : ''))

const ownExegeses = computed(() => exegeses.value.filter(e => current.value && e.p.project === current.value.id))
const ownSermons = computed(() => sermons.value.filter(s => current.value && s.p.project === current.value.id))
const ownDecks = computed(() => decks.value.filter(d => current.value && (d.p.project || d.p.deck?.project) === current.value.id))
</script>

<style scoped lang="scss">
.projects {
	&__layout {
		display: flex;
		gap: 24px;
		align-items: flex-start;
		flex-wrap: wrap;
	}

	&__list {
		flex: 0 0 260px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	&__cat {
		margin: 12px 0 4px;
		font-size: 1em;
		color: var(--color-text-maxcontrast);
	}

	&__item {
		display: flex;
		flex-direction: column;
		padding: 6px 10px;
		border-radius: var(--border-radius-large);

		&:hover, &--on {
			background: var(--color-background-hover);
		}

		&--on {
			font-weight: bold;
		}
	}

	&__kind {
		font-size: .85em;
		font-weight: normal;
		color: var(--color-text-maxcontrast);
	}

	&__doc {
		flex: 1 1 420px;
		max-width: 900px;

		section {
			margin-top: 18px;
		}

		a {
			color: var(--color-primary-element);
		}
	}

	&__meta, &__hint {
		color: var(--color-text-maxcontrast);
	}

	&__question {
		font-style: italic;
		font-size: 1.1em;
	}

	&__check {
		list-style: none;
		padding: 0;

		&--done {
			color: var(--color-text-maxcontrast);
		}
	}

	&__concepts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	&__error {
		color: var(--color-error);
	}
}
</style>
