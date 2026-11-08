<template>
	<div class="phos-page synopsis">
		<h2>{{ t('phos', 'Gospel synopsis') }}</h2>
		<div class="synopsis__layout">
			<nav class="synopsis__list" :aria-label="t('phos', 'Pericopes')">
				<NcTextField v-model="query" :label="t('phos', 'Title or reference (e.g. Mk 4)')" />
				<p class="synopsis__count">
					{{ t('phos', '{n} of {total} pericopes', { n: hits.length, total: PERICOPES.length }) }}
				</p>
				<router-link v-for="p in hits.slice(0, limit)"
					:key="p.id"
					:to="{ name: 'synopsis', params: { id: p.id }, query: route.query }"
					class="synopsis__item"
					:class="{ 'synopsis__item--on': current && p.id === current.id }">
					{{ title(p, lang) }}
					<span class="synopsis__refs">{{ refLine(p) }}</span>
				</router-link>
				<NcButton v-if="hits.length > limit" variant="tertiary" @click="limit += 100">
					{{ t('phos', 'Show more ({n} left)', { n: hits.length - limit }) }}
				</NcButton>
			</nav>
			<article v-if="current" class="synopsis__main">
				<div class="synopsis__head">
					<h3>{{ title(current, lang) }}</h3>
					<NcSelect v-model="bible"
						:options="bibleOptions"
						:clearable="false"
						:input-label="t('phos', 'Bible')"
						class="synopsis__bible" />
					<NcButton :disabled="index <= 0" @click="go(-1)">
						‹ {{ t('phos', 'Previous') }}
					</NcButton>
					<NcButton :disabled="index >= PERICOPES.length - 1" @click="go(1)">
						{{ t('phos', 'Next') }} ›
					</NcButton>
				</div>
				<div class="synopsis__cols" :style="{ '--cols': columns.length }">
					<section v-for="col in columns" :key="col.gospel" class="synopsis__col">
						<h4>{{ bookName(col.gospel, lang) }}</h4>
						<div v-for="(s, i) in col.ranges" :key="i" class="synopsis__range">
							<router-link class="synopsis__ref" :to="{ name: 'bible', params: { module: bible, book: s.book, chapter: s.c1 }, query: { v: s.v1 } }">
								{{ rangeLabel(s) }}
							</router-link>
							<PassageText :module="bible" :passage="s" compact />
						</div>
					</section>
				</div>
			</article>
			<NcEmptyContent v-else :name="t('phos', 'Choose a pericope')" />
		</div>
	</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import PassageText from '../components/PassageText.vue'
import PERICOPES from '../synopsis/pericopes.json'
import { title, sourcesByGospel, rangeLabel, filterPericopes, pericopeAt } from '../synopsis/synopsis.js'
import { bookName, bookFromToken } from '../bible/books.js'
import { bibles, defaultBible, lang, prefs } from '../services/phos.js'

/**
 * The desktop's Bibel-Synopse (unit_synopsis.pas, data/compositeGospel.1.2.xml): one pericope,
 * its parallels side by side. Opened directly (/synopsis/<id>) or from a gospel verse
 * (?book=Mark&c=4&v=3, see BibleView).
 */
const route = useRoute()
const router = useRouter()
const query = ref('')
const limit = ref(150)
const bible = ref(prefs.get('synopsisBible', null) || defaultBible())
watch(bible, v => prefs.set('synopsisBible', v))
const bibleOptions = computed(() => bibles.value.map(b => b.name))

const hits = computed(() => filterPericopes(PERICOPES, query.value, lang, bookFromToken))
const current = computed(() => {
	if (route.params.id) {
		return PERICOPES.find(p => p.id === route.params.id) || null
	}
	const { book, c, v } = route.query
	return book ? pericopeAt(PERICOPES, book, +c || 1, +v || 0) : null
})
const index = computed(() => (current.value ? PERICOPES.indexOf(current.value) : -1))
const columns = computed(() => (current.value ? sourcesByGospel(current.value) : []))

const refLine = p => sourcesByGospel(p).map(x => `${bookName(x.gospel, lang)} ${x.ranges.map(rangeLabel).join('; ')}`).join(' · ')

function go(d) {
	const p = PERICOPES[index.value + d]
	if (p) {
		router.push({ name: 'synopsis', params: { id: p.id } })
	}
}
</script>

<style scoped lang="scss">
.synopsis {
	&__layout {
		display: flex;
		gap: 24px;
		align-items: flex-start;
	}

	&__list {
		flex: 0 0 280px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: calc(100vh - 140px);
		overflow-y: auto;
		position: sticky;
		top: 0;
	}

	&__count {
		font-size: .85em;
		color: var(--color-text-maxcontrast);
		margin: 6px 0;
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

	&__refs {
		font-size: .8em;
		font-weight: normal;
		color: var(--color-text-maxcontrast);
	}

	&__main {
		flex: 1 1 auto;
		min-width: 0;
	}

	&__head {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
		margin-bottom: 12px;

		h3 {
			flex: 1 1 100%;
			margin: 0;
		}
	}

	&__bible {
		min-width: 200px;
	}

	&__cols {
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		gap: 16px;
	}

	&__col h4 {
		margin: 0 0 6px;
		padding-bottom: 4px;
		border-bottom: 1px solid var(--color-border);
	}

	&__range + &__range {
		margin-top: 12px;
	}

	&__ref {
		font-size: .85em;
		color: var(--phos-ref);
	}
}

@media (max-width: 900px) {
	.synopsis__layout {
		flex-direction: column;
	}

	.synopsis__list {
		position: static;
		max-height: 260px;
		flex-basis: auto;
		width: 100%;
	}

	.synopsis__cols {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
