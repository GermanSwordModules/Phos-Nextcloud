<template>
	<NcContent app-name="phos">
		<NcAppNavigation :aria-label="t('phos', 'Phos navigation')">
			<template #list>
				<NcAppNavigationItem v-for="item in nav"
					:key="item.to"
					:name="item.name"
					:to="item.to">
					<template #icon>
						<NcIconSvgWrapper :path="item.icon" />
					</template>
					<template v-if="item.count" #counter>
						<NcCounterBubble :count="item.count" :type="item.highlight ? 'highlighted' : ''" />
					</template>
				</NcAppNavigationItem>
			</template>
			<template #footer>
				<div class="phos-syncstate" :class="{ 'phos-syncstate--off': !state.online }">
					<NcIconSvgWrapper :path="state.online ? iconSync : iconOffline" :size="18" :class="{ 'phos-spin': state.syncing }" />
					<span>{{ syncText }}</span>
					<NcButton variant="tertiary" :aria-label="t('phos', 'Sync now')" @click="syncNow">
						{{ t('phos', 'Sync') }}
					</NcButton>
				</div>
			</template>
		</NcAppNavigation>
		<NcAppContent>
			<NcEmptyContent v-if="startError" :name="t('phos', 'Phos could not start')" :description="startError" />
			<NcEmptyContent v-else-if="!state.ready" :name="t('phos', 'Loading …')">
				<template #icon>
					<NcLoadingIcon />
				</template>
			</NcEmptyContent>
			<router-view v-else />
		</NcAppContent>
	</NcContent>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { t, n } from '@nextcloud/l10n'
import NcContent from '@nextcloud/vue/components/NcContent'
import NcAppNavigation from '@nextcloud/vue/components/NcAppNavigation'
import NcAppNavigationItem from '@nextcloud/vue/components/NcAppNavigationItem'
import NcAppContent from '@nextcloud/vue/components/NcAppContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcCounterBubble from '@nextcloud/vue/components/NcCounterBubble'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcButton from '@nextcloud/vue/components/NcButton'
import { showError, showWarning } from '@nextcloud/dialogs'
import { engine, state, start, loadModules } from './services/phos.js'
import * as I from './icons.js'

const iconSync = I.iconSync
const iconOffline = I.iconOffline
const startError = ref('')

const nav = computed(() => [
	{ to: '/read', name: t('phos', 'Bible reading'), icon: I.iconReading },
	{ to: '/library', name: t('phos', 'Library'), icon: I.iconLibrary },
	{ to: '/bible', name: t('phos', 'Bible'), icon: I.iconBible },
	{ to: '/bookmarks', name: t('phos', 'Bookmarks'), icon: I.iconBookmarks },
	{ to: '/notes', name: t('phos', 'Notes'), icon: I.iconNotes },
	{ to: '/pads', name: t('phos', 'Study pads'), icon: I.iconPads },
	{ to: '/plan', name: t('phos', 'Reading plan'), icon: I.iconPlan },
	{ to: '/shared', name: t('phos', 'Shared'), icon: I.iconShared },
	{ to: '/conflicts', name: t('phos', 'Conflicts'), icon: I.iconConflicts, count: state.conflicts?.length || 0, highlight: true },
	{ to: '/devices', name: t('phos', 'Devices'), icon: I.iconDevices },
])

const syncText = computed(() => {
	if (!state.online) {
		return state.outbox
			? n('phos', 'Offline – %n change waiting', 'Offline – %n changes waiting', state.outbox)
			: t('phos', 'Offline')
	}
	if (state.syncing) {
		return t('phos', 'Syncing …')
	}
	if (state.outbox) {
		return n('phos', '%n change waiting', '%n changes waiting', state.outbox)
	}
	return state.lastSync ? t('phos', 'Synced {time}', { time: new Date(state.lastSync).toLocaleTimeString() }) : ''
})

async function syncNow() {
	try {
		await engine.sync()
	} catch (e) {
		showError(t('phos', 'Sync failed: {error}', { error: e.message }))
	}
}

let timer = null
const onFocus = () => engine.sync().catch(() => {})
onMounted(async () => {
	try {
		await Promise.all([start(), loadModules()])
	} catch (e) {
		startError.value = e.message
		return
	}
	timer = setInterval(() => engine.sync().catch(() => {}), 30000)
	window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => {
	clearInterval(timer)
	window.removeEventListener('focus', onFocus)
})

// server answers that deserve a word
watch(() => state.lastProblem, p => {
	if (p) {
		if (p.status === 'conflict') {
			showWarning(t('phos', 'Your edit collided with another device. See “Conflicts”.'))
		} else if (p.status === 'forbidden') {
			showError(t('phos', 'This item is shared read-only; your change was undone.'))
		} else {
			showError(t('phos', 'The server rejected a change: {error}', { error: p.error || p.status }))
		}
	}
})
</script>

<style lang="scss">
@use './style.scss';
</style>

<style scoped lang="scss">
.phos-syncstate {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 6px 12px;
	font-size: 0.9em;
	color: var(--color-text-maxcontrast);

	span {
		flex: 1;
	}

	&--off {
		color: var(--color-warning-text);
	}
}

.phos-spin {
	animation: phos-spin 1.2s linear infinite;
}

@keyframes phos-spin {
	to { transform: rotate(360deg); }
}
</style>
