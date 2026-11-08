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
		<!-- Word scope's "pick an action" counterpart to BookmarkPanel's verse-scope actions --
			only shown for a word popover (showStrong sets popover.text), not for a footnote/xref
			one, since those have no single word to act on. -->
		<div v-if="popover.text" class="phos-popover__actions">
			<NcButton variant="tertiary" @click="onCopy">
				<template #icon>
					<NcIconSvgWrapper :path="iconCopy" />
				</template>
				{{ t('phos', 'Copy') }}
			</NcButton>
			<NcButton v-if="strongOf(popover.title)"
				variant="tertiary"
				@click="router.push({ name: 'wordstudy', params: { strong: strongOf(popover.title) } })">
				<template #icon>
					<NcIconSvgWrapper :path="iconWordStudy" />
				</template>
				{{ t('phos', 'Word study') }}
			</NcButton>
			<NcButton variant="tertiary" @click="$emit('search', popover.text)">
				<template #icon>
					<NcIconSvgWrapper :path="iconSearch" />
				</template>
				{{ t('phos', 'Search') }}
			</NcButton>
		</div>
	</div>
</template>

<script setup>
import { computed } from 'vue'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { useRouter } from 'vue-router'
import { iconCopy, iconSearch, iconWordStudy } from '../icons.js'
import { normStrong } from '../wordstudy/wordstudy.js'

const props = defineProps({ popover: { type: Object, default: null } })
const emit = defineEmits(['keep', 'ref', 'dict', 'search'])
const router = useRouter()
/** The first Strong's number of a word popover's title ("G26 G3588"), else null. */
const strongOf = title => normStrong(String(title || '').split(/\s+/)[0])

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

function onCopy() {
	navigator.clipboard?.writeText(props.popover?.text || '')
}
</script>
