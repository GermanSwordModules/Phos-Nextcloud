<template>
	<div class="phos-page decks">
		<h2>{{ t('phos', 'Presentations') }}</h2>
		<NcEmptyContent v-if="!decks.length"
			:name="t('phos', 'No presentations yet')"
			:description="t('phos', 'Slide decks made in Phos Desktop appear here once they are synced.')" />
		<template v-else>
			<div class="decks__top">
				<NcSelect v-model="sel"
					:options="options"
					:clearable="false"
					:input-label="t('phos', 'Presentation')"
					label="label"
					class="decks__select" />
				<NcButton :disabled="!ready" :title="t('phos', 'Present')" @click="fullscreen">
					<template #icon>
						<NcIconSvgWrapper :path="iconFullscreen" />
					</template>
					<span class="decks__lbl">{{ t('phos', 'Present') }}</span>
				</NcButton>
				<NcButton :disabled="!ready" :title="t('phos', 'Presenter view')" @click="openPresenter">
					<template #icon>
						<NcIconSvgWrapper :path="iconPresenter" />
					</template>
					<span class="decks__lbl">{{ t('phos', 'Presenter view') }}</span>
				</NcButton>
				<NcButton :disabled="!ready" :pressed="remoteOn" :title="t('phos', 'Phone remote')" @update:pressed="toggleRemote">
					<template #icon>
						<NcIconSvgWrapper :path="iconRemote" />
					</template>
					<span class="decks__lbl">{{ t('phos', 'Phone remote') }}</span>
				</NcButton>
				<ShareButton v-if="current" type="presentation" :record-key="current.key" :collection="current.collection" :title="current.title" />
				<span v-if="ready" class="decks__pos">{{ t('phos', 'Slide {n} of {total}', { n: pos + 1, total }) }}</span>
			</div>
			<p v-if="remoteOn" class="decks__remote">
				{{ t('phos', 'On your phone, open Phos in this Nextcloud with the same account and choose “Remote”:') }}
				<a :href="remoteUrl" target="_blank" rel="noopener">{{ remoteUrl }}</a>
			</p>
			<NcLoadingIcon v-if="loading" />
			<p v-if="error" class="decks__error">
				{{ error }}
			</p>
			<div ref="host" class="phos-deckhost decks__stage" :style="hostVars" tabindex="0">
				<div ref="revealEl" class="reveal">
					<div class="slides" />
				</div>
				<div v-if="logo" class="phos-deck-logo" :class="logo.cls" :style="{ height: logo.height + '%' }">
					<img :src="logo.url" alt="">
				</div>
			</div>
			<p class="decks__hint">
				{{ t('phos', 'Arrow keys or space move on; F or the button above shows it full screen, Esc leaves.') }}
			</p>
			<section v-if="notes" class="decks__notes">
				<h3>{{ t('phos', 'Speaker notes') }}</h3>
				<div v-html="notes" />
			</section>
		</template>
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import { mdiFullscreen, mdiMonitorEye, mdiCellphoneLink } from '@mdi/js'
import 'reveal.js/reveal.css'
import '../docs/phos-deck.css'
import { decks } from '../services/docs.js'
import { http } from '../services/api.js'
import { loadDeck, mountReveal, currentNotes, deckChannel, applyGo, goMessage } from '../docs/useDeck.js'
import { themeVars } from '../docs/deck.js'
import ShareButton from '../components/ShareButton.vue'

const iconFullscreen = mdiFullscreen
const iconPresenter = mdiMonitorEye
const iconRemote = mdiCellphoneLink
const route = useRoute()
const router = useRouter()

const options = computed(() => decks.value.map(d => ({ id: d.id, label: d.title || t('phos', '(untitled)') })))
const sel = computed({
	get: () => options.value.find(o => o.id === route.params.id) || null,
	set: o => router.replace({ name: 'decks', params: { id: o?.id } }),
})
const current = computed(() => decks.value.find(d => d.id === route.params.id) || null)
watch(() => [route.params.id, decks.value.length], () => {
	if (!route.params.id && decks.value.length) {
		router.replace({ name: 'decks', params: { id: decks.value[0].id } })
	}
}, { immediate: true })

const host = ref(null)
const revealEl = ref(null)
const loaded = shallowRef(null)
const reveal = shallowRef(null)
const ready = ref(false)
const loading = ref(false)
const error = ref('')
const pos = ref(0)
const total = ref(0)
const notes = ref('')
const black = ref(false)

const hostVars = computed(() => loaded.value?.vars || themeVars())
const logo = computed(() => loaded.value?.logo || null)

let channel = null
async function destroy() {
	ready.value = false
	channel?.close()
	channel = null
	try {
		reveal.value?.destroy()
	} catch {
		// reveal throws when it was never fully set up
	}
	reveal.value = null
}

let seq = 0
watch(() => current.value?.rec, async () => {
	const s = ++seq
	await destroy()
	error.value = ''
	notes.value = ''
	black.value = false
	const d = current.value
	if (!d) {
		return
	}
	loading.value = true
	try {
		const l = await loadDeck(d)
		if (s !== seq) {
			return
		}
		loaded.value = l
		const r = await mountReveal(revealEl.value, l.sections)
		if (s !== seq) {
			r.destroy()
			return
		}
		reveal.value = r
		channel = deckChannel(d.id, m => {
			if (m.type === 'go') {
				applyGo(r, m)
			} else if (m.type === 'black') {
				r.togglePause(!!m.on)
			} else if (m.type === 'hello') {
				channel.send(goMessage(r))
				channel.send({ type: 'black', on: r.isPaused() })
			}
		})
		const report = () => {
			const cur = r.getCurrentSlide()
			pos.value = cur ? parseInt(cur.getAttribute('data-idx') || '0', 10) : 0
			total.value = r.getTotalSlides()
			notes.value = currentNotes(r)
			channel?.send(goMessage(r))
			publish()
		}
		r.on('slidechanged', report)
		r.on('fragmentshown', () => channel?.send(goMessage(r)))
		r.on('fragmenthidden', () => channel?.send(goMessage(r)))
		r.on('paused', () => { black.value = true; channel?.send({ type: 'black', on: true }); publish() })
		r.on('resumed', () => { black.value = false; channel?.send({ type: 'black', on: false }); publish() })
		report()
		ready.value = true
		host.value?.focus()
	} catch (e) {
		error.value = t('phos', 'This presentation could not be shown: {error}', { error: e.message })
	} finally {
		if (s === seq) {
			loading.value = false
		}
	}
}, { immediate: true })

function fullscreen() {
	host.value?.requestFullscreen?.()
	host.value?.focus()
}
function onFs() {
	// reveal measures its box; tell it the box changed
	setTimeout(() => reveal.value?.layout(), 50)
}
document.addEventListener('fullscreenchange', onFs)

function openPresenter() {
	const url = generateUrl('/apps/phos/') + '#/presenter/' + encodeURIComponent(current.value.id)
	window.open(url, 'phos-presenter-' + current.value.id, 'popup,width=1200,height=800')
}

// ---- phone remote (RemoteController): publish the state, poll for commands

const remoteOn = ref(false)
const remoteUrl = window.location.origin + generateUrl('/apps/phos/') + '#/remote'
let remoteSeq = -1
let remoteTimer = null
let publishTimer = null

function publish() {
	if (!remoteOn.value || !reveal.value || !loaded.value) {
		return
	}
	clearTimeout(publishTimer)
	publishTimer = setTimeout(() => {
		const l = loaded.value
		http.post('/remote/state', {
			deck: current.value?.title || '', title: l.titles[pos.value] || '', idx: pos.value, total: total.value,
			black: black.value, notes: notes.value, slides: l.titles,
		}).catch(() => {})
	}, 150)
}

async function poll() {
	const r = reveal.value
	if (!remoteOn.value || !r) {
		return
	}
	try {
		const { cmd } = await http.get('/remote')
		if (!cmd) {
			remoteSeq = Math.max(remoteSeq, 0)   // nothing sent yet: the first one counts
			return
		}
		if (cmd.seq <= remoteSeq) {
			return
		}
		const first = remoteSeq < 0
		remoteSeq = cmd.seq
		if (first) {
			return // what was sent before we listened
		}
		switch (cmd.action) {
		case 'next': r.next(); break
		case 'prev': r.prev(); break
		case 'first': r.slide(0); break
		case 'last': r.slide(r.getTotalSlides() - 1); break
		case 'goto': r.slide(cmd.slide || 0); break
		case 'black': r.togglePause(); break
		}
	} catch {
		// offline for a moment: the next poll tries again
	}
}

async function toggleRemote(on) {
	remoteOn.value = on
	clearInterval(remoteTimer)
	remoteTimer = null
	if (on) {
		remoteSeq = -1
		await poll()
		remoteTimer = setInterval(poll, 700)
		publish()
	} else {
		http.post('/remote/state', {}).catch(() => {})
	}
}

onBeforeUnmount(() => {
	document.removeEventListener('fullscreenchange', onFs)
	if (remoteOn.value) {
		toggleRemote(false)
	}
	clearTimeout(publishTimer)
	seq++
	destroy()
})
</script>

<style scoped lang="scss">
.decks {
	&__top {
		display: flex;
		gap: 12px;
		align-items: flex-end;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}

	&__select {
		min-width: min(420px, 100%);
	}

	&__remote {
		max-width: 1100px;
		margin: 0 0 8px;
		color: var(--color-text-maxcontrast);

		a {
			color: var(--color-primary-element);
			text-decoration: underline;
		}
	}

	&__pos, &__hint {
		color: var(--color-text-maxcontrast);
	}

	&__stage {
		position: relative;
		width: 100%;
		max-width: 1100px;
		aspect-ratio: 16 / 9;
		border-radius: var(--border-radius-large);
		overflow: hidden;
		box-shadow: 0 0 6px var(--color-box-shadow);
		outline: none;

		&:fullscreen {
			max-width: none;
			border-radius: 0;
		}

		:deep(.reveal) {
			width: 100%;
			height: 100%;
		}
	}

	&__notes {
		max-width: 1100px;
		margin-top: 12px;
		padding: 8px 12px;
		background: var(--color-background-hover);
		border-radius: var(--border-radius-large);
	}

	&__error {
		color: var(--color-error);
	}
}

@media (max-width: 600px) {
	.decks__lbl {
		display: none;
	}

	.decks__select {
		min-width: 100%;
	}
}
</style>
