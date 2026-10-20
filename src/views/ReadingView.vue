<template>
	<div class="reading" :class="'reading--' + pane">
		<div class="reading__switch" role="tablist">
			<button type="button" role="tab" :aria-selected="pane === 'bible'" @click="pane = 'bible'">
				{{ t('phos', 'Bible') }}
			</button>
			<button type="button" role="tab" :aria-selected="pane === 'side'" @click="pane = 'side'">
				{{ t('phos', 'Today and more') }}
			</button>
		</div>
		<BibleView class="reading__bible" @position="p => pos = p" />
		<aside class="reading__side" :aria-label="t('phos', 'Bible reading')">
			<section v-if="desktopPositions.length" class="reading__section">
				<h3>{{ t('phos', 'Continue reading') }}</h3>
				<ContinueReading :bible="route.params.module || defaultBible()" />
			</section>
			<section class="reading__section">
				<h3>{{ t('phos', 'Reading plan') }}</h3>
				<ReadingPlan compact @open="openPassage" />
			</section>
			<section class="reading__section">
				<h3>{{ t('phos', 'Commentary') }}</h3>
				<CommentaryTeaser :book="pos?.book" :chapter="pos?.chapter || 1" :verse="pos?.verse || 1" @ref="openRef" />
			</section>
			<section v-show="mediaCount" class="reading__section">
				<h3>{{ t('phos', 'Pictures and maps') }}</h3>
				<MediaTiles :book="pos?.book" :chapter="pos?.chapter || 1" @count="n => mediaCount = n" />
			</section>
			<section class="reading__section">
				<h3>{{ t('phos', 'Sermons') }}</h3>
				<SermonList :book="pos?.book" :chapter="pos?.chapter || 1" @open="openPassage" />
			</section>
		</aside>
	</div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import BibleView from './BibleView.vue'
import ReadingPlan from '../components/ReadingPlan.vue'
import CommentaryTeaser from '../components/CommentaryTeaser.vue'
import SermonList from '../components/SermonList.vue'
import ContinueReading from '../components/ContinueReading.vue'
import MediaTiles from '../components/MediaTiles.vue'
import { parseRef } from '../bible/books.js'
import { defaultBible, desktopPositions } from '../services/phos.js'

/**
 * Start page, like the desktop's Bible reading view: the Bible on the left,
 * on the right what belongs to the passage being read — today's reading,
 * the commentaries on the verse in view, the user's sermons on the chapter.
 * Everything opens in the Bible next to it.
 */
const route = useRoute()
const router = useRouter()
const pos = ref(null)
const mediaCount = ref(0)
// phones show one of the two at a time
const pane = ref('bible')

function openPassage(p) {
	pane.value = 'bible'
	const query = p.v1 ? { v: p.v1 } : {}
	if (route.query.p) {
		query.p = route.query.p
	}
	router.push({ name: 'read', params: { module: route.params.module || defaultBible(), book: p.book, chapter: p.c1 }, query })
}

function openRef(ref) {
	const p = parseRef(ref.replace(/^[^:]+:/, ''))
	if (p) {
		openPassage(p)
	}
}
</script>

<style scoped lang="scss">
.reading {
	display: flex;
	align-items: flex-start;

	&__switch {
		display: none;
	}

	&__bible {
		flex: 1 1 auto;
		min-width: 0;
	}

	&__side {
		flex: 0 0 380px;
		width: 380px;
		position: sticky;
		top: 0;
		max-height: calc(100vh - var(--header-height, 50px) - 2 * var(--body-container-margin, 0px));
		overflow-y: auto;
		padding: 12px 16px 24px;
		border-left: 1px solid var(--color-border);
		box-sizing: border-box;
	}

	&__section {
		margin-bottom: 20px;

		h3 {
			font-size: 1.1em;
			font-weight: bold;
			margin: 0 0 8px;
		}
	}
}

@media (max-width: 1100px) {
	.reading {
		flex-direction: column;
		align-items: stretch;

		&__side {
			position: static;
			width: auto;
			flex-basis: auto;
			max-height: none;
			border-left: none;
			border-top: 1px solid var(--color-border);
			padding-left: 50px;
		}
	}
}

@media (max-width: 600px) {
	.reading {
		position: relative;

		&__switch {
			display: flex;
			gap: 4px;
			margin: 6px 12px 0 52px;
			padding: 3px;
			border-radius: var(--border-radius-pill, 20px);
			background: var(--color-background-dark);

			button {
				all: unset;
				flex: 1;
				text-align: center;
				padding: 6px 8px;
				border-radius: var(--border-radius-pill, 20px);
				cursor: pointer;

				&[aria-selected="true"] {
					background: var(--color-main-background);
					font-weight: bold;
					box-shadow: 0 1px 3px var(--color-box-shadow);
				}
			}
		}

		&__side {
			border-top: none;
			padding: 8px 12px 24px;
		}

		&--bible &__side,
		&--side &__bible {
			display: none;
		}

		/* the switch row clears the navigation toggle already */
		&__bible :deep(.bible__bar) {
			margin-inline-start: 0;
		}
	}
}
</style>
