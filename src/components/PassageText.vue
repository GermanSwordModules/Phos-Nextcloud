<template>
	<div class="passage phos-text" :class="{ 'passage--compact': compact }" @click="onClick">
		<NcLoadingIcon v-if="loading" :size="20" />
		<span v-else-if="error" class="passage__error">{{ error }}</span>
		<template v-else>
			<span v-for="p in parts" :key="p.c + ':' + p.v" class="passage__verse">
				<sup class="passage__num">{{ p.label }}</sup>
				<span v-html="p.html" />
			</span>
		</template>
		<TextPopover :popover="pop.popover.value" @ref="r => emit('ref', r)" />
	</div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { t } from '@nextcloud/l10n'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import TextPopover from './TextPopover.vue'
import { useTextPopover } from './useNotes.js'
import { getBooks, getChapter, modules } from '../services/phos.js'
import { render } from '../bible/render.js'

/** The text of a passage {book, c1, v1, c2, v2} (v = 0: whole chapter) in one module. */
const props = defineProps({
	passage: { type: Object, required: true },
	module: { type: String, default: null },
	compact: { type: Boolean, default: false },
})
const emit = defineEmits(['ref'])
const parts = ref([])
const loading = ref(false)
const error = ref('')
const notes = new Map()
const pop = useTextPopover()

async function load() {
	parts.value = []
	error.value = ''
	if (!props.module) {
		error.value = t('phos', 'No Bible chosen')
		return
	}
	loading.value = true
	try {
		const { book, c1, v1, c2, v2 } = props.passage
		const info = await getBooks(props.module)
		const b = info.books.find(x => x.osis === book)
		if (!b) {
			throw new Error(t('phos', 'Not in {module}', { module: props.module }))
		}
		const st = modules.value.find(m => m.name === props.module)?.sourceType
		const out = []
		for (let c = c1; c <= Math.min(c2, b.verses.length); c++) {
			const ch = await getChapter(props.module, book, c)
			const from = c === c1 && v1 ? v1 : 1
			const to = c === c2 && v2 ? v2 : b.verses[c - 1]
			for (let v = from; v <= to; v++) {
				if ((ch.links?.[v] && v !== from) || !ch.verses[v]) {
					continue
				}
				const r = render(ch.verses[v] || '', { sourceType: st })
				r.notes.forEach(n => notes.set(n.id, n))
				out.push({ c, v, label: c !== c1 || c1 !== c2 ? `${c},${v}` : v, html: r.html })
			}
		}
		parts.value = out
	} catch (e) {
		error.value = e.message
	} finally {
		loading.value = false
	}
}

function onClick(e) {
	const n = e.target.closest('[data-note]')
	if (n && notes.has(n.dataset.note)) {
		pop.showNote(n, notes.get(n.dataset.note))
		return
	}
	const a = e.target.closest('a[data-ref]')
	if (a) {
		e.preventDefault()
		emit('ref', a.dataset.ref)
		return
	}
	pop.close()
}

watch(() => [props.module, JSON.stringify(props.passage)], load, { immediate: true })
</script>

<style scoped lang="scss">
.passage {
	&__num {
		font-size: 0.7em;
		font-weight: bold;
		color: var(--color-text-maxcontrast);
		padding-right: 2px;
	}

	&__verse::after {
		content: ' ';
	}

	&__error {
		color: var(--color-text-maxcontrast);
		font-style: italic;
	}

	&--compact {
		font-size: 0.95rem;
		line-height: 1.5;
	}
}
</style>
