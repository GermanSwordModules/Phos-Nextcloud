<template>
	<div class="phos-page devices">
		<h2>{{ t('phos', 'Devices') }}</h2>
		<p class="devices__intro">
			{{ t('phos', 'Every Phos installation that syncs with this account. Removing a device only forgets it here; if it syncs again it comes back.') }}
		</p>
		<NcLoadingIcon v-if="loading" />
		<ul v-else>
			<NcListItem v-for="d in devices"
				:key="d.id"
				:name="d.name || d.id"
				:bold="d.id === engine.device"
				:details="d.lastSeen ? new Date(d.lastSeen).toLocaleString() : ''">
				<template #icon>
					<NcIconSvgWrapper :path="iconDevices" />
				</template>
				<template #subname>
					{{ [d.platform, d.appVersion, d.id === engine.device ? t('phos', 'this browser') : ''].filter(Boolean).join(' · ') }}
				</template>
				<template v-if="d.id !== engine.device" #actions>
					<NcActionButton @click="remove(d)">
						<template #icon>
							<NcIconSvgWrapper :path="iconDelete" />
						</template>
						{{ t('phos', 'Remove') }}
					</NcActionButton>
				</template>
			</NcListItem>
		</ul>
	</div>
</template>

<script setup>
import { ref } from 'vue'
import { t } from '@nextcloud/l10n'
import { showError } from '@nextcloud/dialogs'
import NcListItem from '@nextcloud/vue/components/NcListItem'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import { engine } from '../services/phos.js'
import { http } from '../services/api.js'
import { iconDevices, iconDelete } from '../icons.js'

const devices = ref([])
const loading = ref(true)

async function load() {
	try {
		devices.value = (await http.get('/devices')).devices
	} catch (e) {
		showError(e.message)
	} finally {
		loading.value = false
	}
}

async function remove(d) {
	if (!confirm(t('phos', 'Forget the device “{name}”?', { name: d.name || d.id }))) {
		return
	}
	try {
		await http.del(`/devices/${d.id}`)
		await load()
	} catch (e) {
		showError(e.message)
	}
}

load()
</script>

<style scoped lang="scss">
.devices__intro {
	color: var(--color-text-maxcontrast);
	max-width: 700px;
	margin-bottom: 12px;
}
</style>
