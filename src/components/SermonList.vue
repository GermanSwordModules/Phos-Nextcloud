<template>
	<div class="sermons">
		<p v-if="!items.length" class="sermons__empty">
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
	</div>
</template>

<script setup>
import { computed } from 'vue'
import { t } from '@nextcloud/l10n'
import { engine, lang } from '../services/phos.js'
import { formatRef, parseRef } from '../bible/books.js'

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
