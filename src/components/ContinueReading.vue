<template>
	<ul v-if="items.length" class="continue">
		<li v-for="p in items" :key="p.key">
			<a href="#" class="continue__ref" @click.prevent="open(p)">{{ p.label }}</a>
			<span class="continue__where">{{ p.where }}</span>
		</li>
	</ul>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import { desktopPositions, modules, lang } from '../services/phos.js'
import { formatRef } from '../bible/books.js'

/**
 * “Continue reading”: the passages open in the desktop's workspaces, newest
 * first. A module that is not on the server opens the place in the Bible
 * shown here.
 */
const props = defineProps({
	limit: { type: Number, default: 4 },
	bible: { type: String, default: null },   // the Bible open next to the list
})
const router = useRouter()

const items = computed(() => desktopPositions.value.slice(0, props.limit).map(p => {
	const online = modules.value.some(m => m.name === p.module && !m.locked)
	return {
		...p,
		key: [p.workspace, p.module, p.book, p.chapter, p.verse].join('|'),
		online,
		label: formatRef({ book: p.book, c1: p.chapter, v1: p.verse, c2: p.chapter, v2: 0 }, lang),
		where: [p.module + (online ? '' : ' ' + t('phos', '(not online)')), p.workspace].filter(Boolean).join(' · '),
	}
}))

function open(p) {
	const query = p.verse > 1 ? { at: p.verse } : {}
	if (p.kind === 'commentary' && p.online) {
		router.push({ name: 'commentary', params: { module: p.module, book: p.book, chapter: p.chapter }, query })
		return
	}
	const module = p.online && p.kind === 'bible' ? p.module : props.bible
	router.push({ name: 'read', params: { module, book: p.book, chapter: p.chapter }, query })
}
</script>

<style scoped lang="scss">
.continue {
	list-style: none;
	padding: 0;
	margin: 0;

	li {
		padding: 3px 0;
	}

	&__ref {
		font-weight: bold;
		color: var(--color-primary-element);
		margin-right: 6px;
	}

	&__where {
		color: var(--color-text-maxcontrast);
		font-size: 0.9em;
	}
}
</style>
