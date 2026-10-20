<template>
	<NcDialog :open="open"
		:name="t('phos', 'Share “{title}”', { title: item?.title || '' })"
		size="normal"
		@update:open="v => emit('update:open', v)">
		<div v-if="item" class="sharedlg">
			<template v-if="inShared">
				<p>
					{{ t('phos', 'This is in the shared collection “{name}”.', { name: currentInfo?.name || '' }) }}
				</p>
				<p v-if="!mine" class="sharedlg__muted">
					{{ t('phos', 'Shared with you by {owner}; only the owner can take it out.', { owner: currentInfo?.ownerName || currentInfo?.owner || '' }) }}
				</p>
			</template>
			<template v-else>
				<NcSelect v-model="target"
					:options="options"
					:clearable="false"
					:input-label="t('phos', 'Collection')"
					label="label" />
				<NcTextField v-if="!target?.id" v-model="newName" :label="t('phos', 'Name of the new collection')" />
				<p class="sharedlg__muted">
					{{ t('phos', 'Who takes part is set in “Shared” afterwards.') }}
					<template v-if="item.type === 'project'">
						{{ t('phos', 'Its exegeses and lists of passages go with it.') }}
					</template>
					<template v-else-if="item.type === 'presentation'">
						{{ t('phos', 'Its pictures go with it.') }}
					</template>
				</p>
				<NcNoteCard v-if="item.type === 'module' || item.type === 'ebook'" type="warning">
					<p>{{ t('phos', 'Please check yourself whether you may pass this on — Phos does not check licences. Many Bible translations and books are protected by copyright.') }}</p>
					<p v-if="license">
						{{ t('phos', 'Declared licence: {license}', { license }) }}
					</p>
				</NcNoteCard>
			</template>
			<p v-if="error" class="sharedlg__error">
				{{ error }}
			</p>
		</div>
		<template #actions>
			<NcButton v-if="inShared && mine" :disabled="busy" @click="stop">
				{{ t('phos', 'Stop sharing') }}
			</NcButton>
			<NcButton v-if="inShared" variant="primary" @click="manage(item.collection)">
				{{ t('phos', 'Manage members') }}
			</NcButton>
			<NcButton v-else variant="primary" :disabled="busy || (!target?.id && !newName.trim())" @click="share">
				{{ t('phos', 'Share') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import { engine, collectionInfo, personal } from '../services/phos.js'
import { shareItem, unshareItem, shareTargets, isMine } from '../services/share.js'

/** item: {type, key, collection, title} of a project, deck, sermon, exegesis, e-book or module */
const props = defineProps({
	open: { type: Boolean, default: false },
	item: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'shared'])
const router = useRouter()

const NEW = { id: null, label: t('phos', 'New collection …') }
const options = computed(() => [NEW, ...shareTargets.value.map(c => ({ id: c.id, label: c.name || c.id }))])
const target = ref(NEW)
const newName = ref('')
const busy = ref(false)
const error = ref('')

const inShared = computed(() => !!props.item && props.item.collection !== personal())
const currentInfo = computed(() => props.item ? collectionInfo(props.item.collection) : null)
const mine = computed(() => !!props.item && isMine(props.item.collection))

/** a module's declared licence (DistributionLicense of its .conf) */
const license = computed(() => {
	if (props.item?.type !== 'module') {
		return ''
	}
	const conf = engine.get('module', props.item.key, props.item.collection)?.payload?.conf || ''
	return /^DistributionLicense\s*=\s*(.+)$/m.exec(conf)?.[1]?.trim() || ''
})

watch(() => [props.open, props.item?.key], () => {
	if (props.open) {
		target.value = NEW
		newName.value = props.item?.title || ''
		error.value = ''
	}
}, { immediate: true })

function manage(id) {
	emit('update:open', false)
	router.push({ name: 'shared', query: { c: id } })
}

async function share() {
	busy.value = true
	error.value = ''
	try {
		const id = await shareItem(props.item, target.value?.id || null, newName.value)
		emit('shared', id)
		manage(id)
	} catch (e) {
		error.value = t('phos', 'Could not share: {error}', { error: e.message })
	} finally {
		busy.value = false
	}
}

async function stop() {
	busy.value = true
	error.value = ''
	try {
		await unshareItem(props.item)
		emit('shared', personal())
		emit('update:open', false)
	} catch (e) {
		error.value = t('phos', 'Could not share: {error}', { error: e.message })
	} finally {
		busy.value = false
	}
}
</script>

<style scoped lang="scss">
.sharedlg {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding-bottom: 8px;

	&__muted {
		color: var(--color-text-maxcontrast);
	}

	&__error {
		color: var(--color-error);
	}
}
</style>
