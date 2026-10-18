<template>
	<div v-if="popover"
		class="phos-popover phos-text"
		role="dialog"
		:style="{ left: popover.x + 'px', top: popover.y + 'px' }"
		@mouseenter="$emit('keep')"
		@click="onClick">
		<div class="phos-popover__title">
			{{ title }}
		</div>
		<!-- eslint-disable-next-line vue/no-v-html -- built by bible/render.js from a whitelist -->
		<div v-html="popover.html" />
	</div>
</template>

<script setup>
import { computed } from 'vue'
import { t } from '@nextcloud/l10n'

const props = defineProps({ popover: { type: Object, default: null } })
const emit = defineEmits(['keep', 'ref', 'dict'])

const title = computed(() => {
	const p = props.popover
	return p?.title === 'note' ? t('phos', 'Footnote') : p?.title === 'xref' ? t('phos', 'Cross references') : p?.title
})

function onClick(e) {
	const a = e.target.closest('a')
	if (a?.dataset.ref) {
		e.preventDefault()
		emit('ref', a.dataset.ref)
	} else if (a?.dataset.key) {
		e.preventDefault()
		emit('dict', a.dataset.module, a.dataset.key)
	}
}
</script>
