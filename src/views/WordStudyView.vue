<template>
	<div class="phos-page wordstudy">
		<h2>{{ t('phos', 'Word study') }}</h2>
		<form class="wordstudy__bar" @submit.prevent="lookup">
			<NcTextField v-model="input" :label="t('phos', 'Strong’s number (e.g. G26, H430)')" class="wordstudy__input" />
			<NcSelect v-model="bible"
				:options="bibleOptions"
				:clearable="false"
				:input-label="t('phos', 'Bible with Strong’s numbers')"
				class="wordstudy__bible" />
			<NcButton type="submit" variant="primary">
				{{ t('phos', 'Study') }}
			</NcButton>
		</form>

		<NcEmptyContent v-if="!strong"
			:name="t('phos', 'Enter a Strong’s number')"
			:description="t('phos', 'Or tap a word in a Bible with Strong’s numbers and choose “Word study”.')" />
		<template v-else>
			<section class="wordstudy__lex">
				<h3>{{ strong }}</h3>
				<NcLoadingIcon v-if="lexLoading" />
				<!-- eslint-disable-next-line vue/no-v-html -- bible/render.js output -->
				<div v-else-if="lexHtml" class="phos-text" v-html="lexHtml" />
				<p v-else class="wordstudy__muted">
					{{ t('phos', 'No lexicon on the server has an entry for {n}.', { n: strong }) }}
				</p>
			</section>

			<NcLoadingIcon v-if="loading" />
			<p v-else-if="error" class="wordstudy__error">
				{{ error }}
			</p>
			<template v-else-if="result">
				<section>
					<h3>{{ t('phos', '{n} verses in {bible}', { n: result.total, bible }) }}</h3>
					<div class="wordstudy__books">
						<button v-for="b in perBook"
							:key="b.osis"
							type="button"
							class="wordstudy__book"
							:class="{ 'wordstudy__book--on': bookFilter === b.osis }"
							:title="bookName(b.osis, lang) + ': ' + b.n"
							@click="bookFilter = bookFilter === b.osis ? null : b.osis">
							<span class="wordstudy__bar-fill" :style="{ height: (100 * b.n / maxPerBook) + '%' }" />
							<span class="wordstudy__book-name">{{ bookName(b.osis, lang) }}</span>
						</button>
					</div>
				</section>

				<section v-if="ring.length">
					<h3>{{ t('phos', 'Translated as') }}</h3>
					<p class="wordstudy__ring">
						<button v-for="r in ring"
							:key="r.word"
							type="button"
							class="phos-chip wordstudy__chip"
							:class="{ 'wordstudy__chip--on': wordFilter === r.word }"
							@click="wordFilter = wordFilter === r.word ? null : r.word">
							{{ r.word }} <small>{{ r.count }}</small>
						</button>
					</p>
					<p v-if="result.total > hits.length" class="wordstudy__muted">
						{{ t('phos', 'Counted in the first {n} verses.', { n: hits.length }) }}
					</p>
				</section>

				<section>
					<h3>{{ t('phos', 'Passages') }} <small class="wordstudy__muted">{{ shown.length }}</small></h3>
					<ul class="wordstudy__hits">
						<li v-for="h in shown.slice(0, limit)" :key="h.id">
							<router-link :to="{ name: 'bible', params: { module: bible, book: h.book, chapter: h.chapter }, query: { v: h.verse } }" class="wordstudy__ref">
								{{ formatRef({ book: h.book, c1: h.chapter, v1: h.verse, c2: h.chapter, v2: h.verse }, lang) }}
							</router-link>
							<!-- eslint-disable-next-line vue/no-v-html -- bible/render.js output -->
							<span class="phos-text" v-html="h.marked" />
						</li>
					</ul>
					<NcButton v-if="shown.length > limit" @click="limit += 50">
						{{ t('phos', 'Show more ({n} left)', { n: shown.length - limit }) }}
					</NcButton>
				</section>
			</template>
		</template>
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
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { render } from '../bible/render.js'
import { bookName, formatRef, KJV_ORDER } from '../bible/books.js'
import { bibles, modules, defaultBible, lexiconsFor, getEntry, searchModule, setting, lang, prefs } from '../services/phos.js'
import { normStrong, isHebrew, translationRing, markStrong } from '../wordstudy/wordstudy.js'

/**
 * The desktop's Wortstudie (unit_wordstudy.pas) as far as the server can carry it: the lexicon
 * entry, where the number occurs (per book), how it is translated (the "Übersetzungsring") and the
 * passages. No lemmatizer and no LXX/related-words pass -- those need the desktop's local tools.
 */
const route = useRoute()
const router = useRouter()
const input = ref(route.params.strong || '')
const strong = computed(() => normStrong(route.params.strong))

const strongBibles = computed(() => bibles.value.filter(b => !b.locked && (b.features || []).includes('StrongsNumbers')))
const bibleOptions = computed(() => (strongBibles.value.length ? strongBibles.value : bibles.value).map(b => b.name))
function preferredBible() {
	const want = strong.value && isHebrew(strong.value) ? setting('General.DefaultHebrewBible') : setting('General.DefaultGreekBible')
	const names = bibleOptions.value
	return [prefs.get('wordstudyBible', null), want, defaultBible()].find(n => n && names.includes(n)) || names[0] || null
}
const bible = ref(preferredBible())
watch(bibleOptions, () => { if (!bible.value || !bibleOptions.value.includes(bible.value)) bible.value = preferredBible() })
watch(bible, v => prefs.set('wordstudyBible', v))

function lookup() {
	const n = normStrong(input.value)
	if (n) {
		router.push({ name: 'wordstudy', params: { strong: n } })
	}
}

const lexHtml = ref('')
const lexLoading = ref(false)
async function loadLexicon(n) {
	lexHtml.value = ''
	if (!n) return
	lexLoading.value = true
	for (const lex of lexiconsFor(n)) {
		try {
			const e = await getEntry(lex.name, n)
			lexHtml.value = render(e.text, { sourceType: lex.sourceType }).html
			break
		} catch {
			// not in this lexicon
		}
	}
	lexLoading.value = false
}

const result = ref(null)
const hits = ref([])
const loading = ref(false)
const error = ref('')
const bookFilter = ref(null)
const wordFilter = ref(null)
const limit = ref(50)

async function loadHits(n, mod) {
	result.value = null
	hits.value = []
	error.value = ''
	bookFilter.value = null
	wordFilter.value = null
	limit.value = 50
	if (!n || !mod) return
	loading.value = true
	try {
		const r = await searchModule(mod, n, { limit: 200 })
		const meta = modules.value.find(m => m.name === mod)
		result.value = r
		hits.value = r.hits.map(h => {
			const html = render(h.text, { sourceType: meta?.sourceType }).html
			return { ...h, id: `${h.book}.${h.chapter}.${h.verse}`, html, marked: markStrong(html, n) }
		})
	} catch (e) {
		error.value = t('phos', 'The search failed: {error}', { error: e.message })
	} finally {
		loading.value = false
	}
}

watch([strong, bible], ([n, mod]) => {
	input.value = n || input.value
	loadLexicon(n)
	loadHits(n, mod)
}, { immediate: true })

const perBook = computed(() => {
	const pb = result.value?.perBook || {}
	return Object.keys(pb).sort((a, b) => KJV_ORDER.indexOf(a) - KJV_ORDER.indexOf(b)).map(osis => ({ osis, n: pb[osis] }))
})
const maxPerBook = computed(() => Math.max(1, ...perBook.value.map(b => b.n)))

const parse = html => new DOMParser().parseFromString(html, 'text/html')
const ring = computed(() => (strong.value ? translationRing(hits.value, strong.value, parse) : []))

const shown = computed(() => {
	let list = hits.value
	if (bookFilter.value) list = list.filter(h => h.book === bookFilter.value)
	if (wordFilter.value) {
		const verses = ring.value.find(r => r.word === wordFilter.value)?.verses
		list = list.filter(h => verses?.has(h.id))
	}
	return list
})
</script>

<style scoped lang="scss">
.wordstudy {
	&__bar {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
		margin-bottom: 16px;
	}

	&__input {
		max-width: 260px;
	}

	&__bible {
		min-width: 220px;
	}

	&__lex {
		max-width: 800px;
		padding: 8px 12px;
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-large);
		margin-bottom: 16px;
		max-height: 320px;
		overflow: auto;

		h3 {
			margin-top: 0;
		}
	}

	&__muted {
		color: var(--color-text-maxcontrast);
	}

	&__error {
		color: var(--color-error);
	}

	&__books {
		display: flex;
		gap: 3px;
		align-items: flex-end;
		height: 140px;
		overflow-x: auto;
		padding-bottom: 4px;
	}

	&__book {
		flex: 0 0 26px;
		height: 100%;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		align-items: center;
		border: none;
		background: none;
		padding: 0;
		margin: 0;
		min-height: 0;
		cursor: pointer;

		&--on .wordstudy__bar-fill {
			background: var(--color-primary-element);
		}
	}

	&__bar-fill {
		width: 18px;
		min-height: 2px;
		background: var(--color-primary-element-light);
		border-radius: 3px 3px 0 0;
	}

	&__book-name {
		font-size: 9px;
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		max-height: 60px;
		overflow: hidden;
		color: var(--color-text-maxcontrast);
	}

	&__ring {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	&__chip {
		cursor: pointer;
		border: 1px solid var(--color-border);
		background: var(--color-main-background);

		&--on {
			background: var(--color-primary-element-light);
			border-color: var(--color-primary-element);
		}
	}

	&__hits {
		li {
			margin: 6px 0;
		}
	}

	&__ref {
		font-weight: bold;
		margin-inline-end: 8px;
		color: var(--phos-ref);
	}

	:deep(.phos-ws-hit) {
		background: var(--color-primary-element-light);
		border-radius: 3px;
		padding: 0 2px;
	}
}
</style>
