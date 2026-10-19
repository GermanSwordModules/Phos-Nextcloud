<template>
	<div v-if="tiles.length" class="media">
		<a v-for="m in tiles"
			:key="m.key"
			href="#"
			class="media__tile"
			:title="m.description"
			@click.prevent="open(m)">
			<img :src="m.src" alt="" loading="lazy">
			<span class="media__cap">{{ m.caption }}</span>
		</a>
	</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getMedia, pictureUrl } from '../services/phos.js'
import { bookNames } from '../bible/books.js'

/**
 * Pictures and maps on the chapter being read: entries of picture and map
 * modules that cite it, as tiles; a click opens the entry.
 */
const props = defineProps({
	book: { type: String, default: null },
	chapter: { type: Number, default: 1 },
})
const emit = defineEmits(['count'])
const router = useRouter()
const hits = ref([])
let seq = 0

watch(() => [props.book, props.chapter], async ([book, chapter]) => {
	const s = ++seq
	if (!book) {
		hits.value = []
		return
	}
	try {
		const r = await getMedia(book, chapter, bookNames(book))
		if (s === seq) {
			hits.value = r
		}
	} catch {
		if (s === seq) {
			hits.value = []
		}
	}
}, { immediate: true })

const tiles = computed(() => hits.value.map((h, i) => ({
	...h,
	key: `${h.module}|${h.path}|${i}`,
	src: pictureUrl(h.module)(h.picture),
	caption: h.path.split('/').pop() || h.ref,
})).filter(t => t.src))
watch(() => tiles.value.length, n => emit('count', n), { immediate: true })

function open(m) {
	router.push({ name: 'book', params: { module: m.module }, query: { e: m.path } })
}
</script>

<style scoped lang="scss">
.media {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
	gap: 8px;

	&__tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--color-main-text);

		img {
			width: 100%;
			aspect-ratio: 4 / 3;
			object-fit: cover;
			border-radius: var(--border-radius);
			border: 1px solid var(--color-border);
			background: var(--color-background-dark);
		}
	}

	&__cap {
		font-size: 0.8em;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
}
</style>
