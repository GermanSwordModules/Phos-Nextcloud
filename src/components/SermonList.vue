<template>
	<div class="sermons">
		<p v-if="!items.length && !bookHits.length && !loadingBooks" class="sermons__empty">
			{{ t('phos', 'No sermon of yours on this chapter.') }}
		</p>
		<ul v-else>
			<li v-for="s in items" :key="s.key" class="sermons__item">
				<div class="sermons__title">
					{{ s.title || s.passage }}
				</div>
				<a v-if="s.ref" href="#" class="sermons__ref" @click.prevent="emit('open', s.ref)">{{ s.refLabel }}</a>
				<p v-if="s.mainIdea" class="sermons__idea">
					{{ s.mainIdea }}
				</p>
				<ol v-if="s.points.length" class="sermons__outline">
					<li v-for="(p, i) in s.points" :key="i">
						{{ p }}
					</li>
				</ol>
			</li>
		</ul>
		<!-- sermon and devotional books (modules) citing the chapter, like the desktop -->
		<NcLoadingIcon v-if="loadingBooks" :size="20" class="sermons__loading" />
		<ul v-if="bookHits.length" class="sermons__books">
			<li v-for="h in bookHits" :key="h.key" class="sermons__item">
				<a href="#" class="sermons__title" @click.prevent="openBook(h)">{{ h.title }}</a>
				<div class="sermons__src">
					{{ h.description }}
				</div>
				<p class="sermons__idea">
					{{ h.snippet }}
				</p>
			</li>
		</ul>
	</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { engine, lang, getSermonBooks } from '../services/phos.js'
import { bookNames, formatRef, parseRef } from '../bible/books.js'

/** The user's own sermons (synced from Phos Desktop) whose passage touches this chapter. */
const props = defineProps({
	book: { type: String, default: null },
	chapter: { type: Number, default: 1 },
})
const emit = defineEmits(['open'])

const DEFAULT_POINT = /^(Neuer Punkt|New point)$/i

const items = computed(() => {
	if (!props.book) {
		return []
	}
	return engine.list('sermon').map(r => {
		const p = r.payload || {}
		const ref = p.passage_osis ? parseRef(p.passage_osis) : null
		return {
			key: r.key, title: p.title, passage: p.passage, ref,
			refLabel: ref ? formatRef(ref, lang) : p.passage,
			mainIdea: p.main_idea,
			points: (p.outline || []).map(o => o.title).filter(x => x && !DEFAULT_POINT.test(x)),
			modified: p.modified || '',
		}
	}).filter(s => s.ref && s.ref.book === props.book && s.ref.c1 <= props.chapter && props.chapter <= s.ref.c2)
		.sort((a, b) => b.modified.localeCompare(a.modified))
})

// ---------- sermon books (modules) ----------

const router = useRouter()
const bookHits = ref([])
const loadingBooks = ref(false)
let seq = 0
watch(() => [props.book, props.chapter], async ([book, chapter]) => {
	const s = ++seq
	bookHits.value = []
	if (!book) {
		return
	}
	loadingBooks.value = true
	try {
		const hits = await getSermonBooks(book, chapter, bookNames(book))
		if (s === seq) {
			bookHits.value = hits.map((h, i) => ({
				...h,
				key: `${h.module}|${h.path || h.verse}|${i}`,
				title: h.kind === 'genbook'
					? [h.ref, h.path.split('/').pop()].filter(Boolean).filter((x, j, a) => a.indexOf(x) === j).join(' – ')
					: formatRef({ book, c1: chapter, v1: h.verse, c2: chapter, v2: 0 }, lang),
				snippet: h.lead.length > 160 ? h.lead.slice(0, 160).replace(/\s+\S*$/, '') + ' …' : h.lead,
			}))
		}
	} catch {
		// no sermon books then
	} finally {
		if (s === seq) {
			loadingBooks.value = false
		}
	}
}, { immediate: true })

function openBook(h) {
	if (h.kind === 'genbook') {
		router.push({ name: 'book', params: { module: h.module }, query: { e: h.path } })
	} else {
		router.push({ name: 'commentary', params: { module: h.module, book: props.book, chapter: props.chapter }, query: { v: h.verse } })
	}
}
</script>

<style scoped lang="scss">
.sermons {
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	&__item {
		padding: 6px 0;
		border-top: 1px solid var(--color-border);

		&:first-child {
			border-top: none;
		}
	}

	&__title {
		font-weight: bold;
	}

	&__ref {
		color: var(--color-primary-element);
		font-size: 0.9em;
	}

	&__src {
		color: var(--color-text-maxcontrast);
		font-size: 0.85em;
	}

	&__books {
		border-top: 1px solid var(--color-border);
		margin-top: 6px;
	}

	&__loading {
		margin: 6px 0;
	}

	&__idea {
		margin: 4px 0 0;
	}

	&__outline {
		margin: 4px 0 0 18px;
		color: var(--color-text-maxcontrast);
	}

	&__empty {
		color: var(--color-text-maxcontrast);
		font-style: italic;
		margin: 0;
	}
}
</style>
