<template>
	<div class="phos-page remote">
		<h2>{{ t('phos', 'Remote') }}</h2>
		<NcEmptyContent v-if="!live"
			:name="t('phos', 'No presentation running')"
			:description="t('phos', 'Open a presentation in Phos on the computer and switch on “Phone remote” there. This page follows it.')" />
		<template v-else>
			<p class="remote__deck">
				{{ state.deck }}
			</p>
			<p class="remote__pos">
				{{ t('phos', 'Slide {n} of {total}', { n: state.idx + 1, total: state.total }) }}
				<span v-if="state.title && state.title !== String(state.idx + 1)"> · {{ state.title }}</span>
			</p>
			<div class="remote__keys">
				<NcButton class="remote__key" :aria-label="t('phos', 'Previous')" @click="send('prev')">
					<template #icon>
						<NcIconSvgWrapper :path="iconPrev" :size="40" />
					</template>
				</NcButton>
				<NcButton class="remote__key" variant="primary" :aria-label="t('phos', 'Next')" @click="send('next')">
					<template #icon>
						<NcIconSvgWrapper :path="iconNext" :size="40" />
					</template>
				</NcButton>
			</div>
			<div class="remote__row">
				<NcButton :pressed="state.black" @update:pressed="send('black')">
					{{ t('phos', 'Black screen') }}
				</NcButton>
				<NcButton @click="send('first')">
					{{ t('phos', 'First slide') }}
				</NcButton>
				<NcButton @click="showList = !showList">
					{{ t('phos', 'All slides') }}
				</NcButton>
			</div>
			<ol v-if="showList" class="remote__list">
				<li v-for="(s, i) in state.slides" :key="i" :class="{ 'remote__list--on': i === state.idx }">
					<button type="button" @click="send('goto', i); showList = false">
						{{ i + 1 }}. {{ s }}
					</button>
				</li>
			</ol>
			<section class="remote__notes">
				<h3>{{ t('phos', 'Speaker notes') }}</h3>
				<!-- eslint-disable-next-line vue/no-v-html -- sanitized -->
				<div v-html="notesHtml || '—'" />
			</section>
		</template>
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { iconPrev, iconNext } from '../icons.js'
import { http } from '../services/api.js'
import { cleanHtml } from '../services/docs.js'

// a presenting page republishes on every change; older than this = gone
const STALE_MS = 6 * 3600 * 1000

const state = ref(null)
const serverNow = ref(0)
const showList = ref(false)
const live = computed(() => state.value && state.value.total > 0 && serverNow.value - state.value.at < STALE_MS)
const notesHtml = computed(() => cleanHtml(state.value?.notes || ''))

let timer = null
let busy = false
async function poll() {
	if (busy) {
		return
	}
	busy = true
	try {
		const r = await http.get('/remote')
		state.value = r.state
		serverNow.value = r.now
	} catch {
		// keep the last state; the next poll tries again
	} finally {
		busy = false
	}
}

async function send(action, slide = 0) {
	try {
		await http.post('/remote/cmd', { action, slide })
	} catch {
		return
	}
	// the presenting page answers within its poll interval
	setTimeout(poll, 900)
}

onMounted(() => {
	poll()
	timer = setInterval(poll, 1500)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped lang="scss">
.remote {
	max-width: 640px;

	&__deck {
		font-weight: bold;
		margin: 0;
	}

	&__pos {
		color: var(--color-text-maxcontrast);
	}

	&__keys {
		display: grid;
		grid-template-columns: 1fr 2fr;
		gap: 12px;
		margin: 12px 0;
	}

	&__key {
		width: 100% !important;
		min-height: 120px !important;
	}

	&__row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	&__list {
		margin: 12px 0;
		padding: 0;
		list-style: none;

		button {
			width: 100%;
			text-align: start;
			min-height: 40px;
			margin: 2px 0;
		}
	}

	&__list--on button {
		background: var(--color-primary-element-light);
		font-weight: bold;
	}

	&__notes {
		margin-top: 16px;
		padding: 8px 12px;
		background: var(--color-background-hover);
		border-radius: var(--border-radius-large);
		font-size: 1.1em;
		line-height: 1.5;
	}
}
</style>
