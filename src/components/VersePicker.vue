<template>
	<NcDialog :open="open"
		:name="title"
		size="normal"
		@update:open="v => $emit('update:open', v)">
		<nav v-if="level !== 'book'" class="versepicker__crumb">
			<NcButton variant="tertiary" @click="level = 'book'">
				{{ t('phos', 'Books') }}
			</NcButton>
			<span v-if="level === 'verse'"> / </span>
			<NcButton v-if="level === 'verse'" variant="tertiary" @click="level = 'chapter'">
				{{ pickedLabel }}
			</NcButton>
		</nav>
		<div v-if="level === 'book'" class="versepicker__grid">
			<button v-for="b in books"
				:key="b.osis"
				type="button"
				class="versepicker__cell versepicker__cell--book"
				:class="{ 'versepicker__cell--current': b.osis === book }"
				@click="pickBook(b)">
				{{ bookName(b.osis, lang, b.name) }}
			</button>
		</div>
		<div v-else-if="level === 'chapter'" class="versepicker__grid versepicker__grid--num">
			<button v-for="(_, i) in pickedBook.verses"
				:key="i"
				type="button"
				class="versepicker__cell"
				:class="{ 'versepicker__cell--current': pickedBook.osis === book && i + 1 === chapter }"
				@click="pickChapter(i + 1)">
				{{ i + 1 }}
			</button>
		</div>
		<div v-else class="versepicker__grid versepicker__grid--num">
			<button v-for="v in verseCount"
				:key="v"
				type="button"
				class="versepicker__cell"
				@click="pickVerse(v)">
				{{ v }}
			</button>
		</div>
	</NcDialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { t } from '@nextcloud/l10n'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcButton from '@nextcloud/vue/components/NcButton'
import { bookName } from '../bible/books.js'
import { lang } from '../services/phos.js'

/**
 * Book → chapter → verse drill-down picker, the web analogue of the
 * desktop's `TVersePickerForm` (tile grids opened from the verse-select
 * field). `books`: the current module's book list as `getBooks()` returns
 * it (`{osis, name, verses: [chapter lengths]}`).
 */
const props = defineProps({
	open: { type: Boolean, default: false },
	books: { type: Array, required: true },
	book: { type: String, default: null },
	chapter: { type: Number, default: 1 },
})
const emit = defineEmits(['update:open', 'go'])

const level = ref('book')   // 'book' | 'chapter' | 'verse'
const pickedBook = ref(null)

watch(() => props.open, v => {
	if (v) {
		level.value = 'book'
		pickedBook.value = props.books.find(b => b.osis === props.book) || null
		if (pickedBook.value) {
			level.value = 'chapter'
		}
	}
})

const pickedLabel = computed(() => pickedBook.value ? bookName(pickedBook.value.osis, lang, pickedBook.value.name) : '')
const verseCount = computed(() => pickedBook.value?.verses[(pendingChapter.value || 1) - 1] || 0)
const pendingChapter = ref(1)

const title = computed(() => {
	if (level.value === 'book') {
		return t('phos', 'Go to a book')
	}
	if (level.value === 'chapter') {
		return t('phos', 'Go to a chapter of {book}', { book: pickedLabel.value })
	}
	return t('phos', 'Go to a verse of {book} {chapter}', { book: pickedLabel.value, chapter: pendingChapter.value })
})

function pickBook(b) {
	pickedBook.value = b
	level.value = 'chapter'
}
function pickChapter(c) {
	pendingChapter.value = c
	emit('go', { book: pickedBook.value.osis, chapter: c })
	level.value = 'verse'
}
function pickVerse(v) {
	emit('go', { book: pickedBook.value.osis, chapter: pendingChapter.value, v })
	emit('update:open', false)
}
</script>

<style scoped lang="scss">
.versepicker {
	&__crumb {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 8px;
	}

	&__grid {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		max-height: 60vh;
		overflow: auto;

		&--num {
			.versepicker__cell {
				min-width: 2.4em;
				justify-content: center;
			}
		}
	}

	&__cell {
		all: unset;
		cursor: pointer;
		padding: 6px 10px;
		border-radius: var(--border-radius);
		border: 1px solid var(--color-border);
		text-align: center;

		&:hover,
		&:focus-visible {
			background: var(--color-background-hover);
		}

		&--current {
			border-color: var(--color-primary-element);
			font-weight: bold;
		}

		&--book {
			flex: 1 1 140px;
			text-align: start;
		}
	}
}
</style>
