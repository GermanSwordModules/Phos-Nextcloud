<template>
	<span class="sharebtn">
		<NcButton :variant="shared ? 'secondary' : 'tertiary'"
			:title="shared ? t('phos', 'In the shared collection “{name}”', { name: info?.name || '' }) : ''"
			:aria-label="compact ? (shared ? t('phos', 'Shared') : t('phos', 'Share …')) : undefined"
			@click="open = true">
			<template #icon>
				<NcIconSvgWrapper :path="iconShared" :size="compact ? 18 : 20" />
			</template>
			<template v-if="!compact">
				{{ shared ? t('phos', 'Shared') : t('phos', 'Share …') }}
			</template>
		</NcButton>
		<ShareDialog v-model:open="open" :item="item" />
	</span>
</template>

<script setup>
import { computed, ref } from 'vue'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import ShareDialog from './ShareDialog.vue'
import { iconShared } from '../icons.js'
import { collectionInfo, personal } from '../services/phos.js'

/** type + key + collection of the record, title for the dialog */
const props = defineProps({
	type: { type: String, required: true },
	recordKey: { type: String, required: true },
	collection: { type: String, required: true },
	title: { type: String, default: '' },
	/** icon only (lists) */
	compact: { type: Boolean, default: false },
})
const open = ref(false)
const item = computed(() => ({ type: props.type, key: props.recordKey, collection: props.collection, title: props.title }))
const shared = computed(() => props.collection !== personal())
const info = computed(() => collectionInfo(props.collection))
</script>
