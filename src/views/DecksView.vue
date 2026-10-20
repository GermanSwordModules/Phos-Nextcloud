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
				<NcButton :disabled="!ready" @click="fullscreen">
					<template #icon>
						<NcIconSvgWrapper :path="iconFullscreen" />
					</template>
					{{ t('phos', 'Present') }}
				</NcButton>
				<span v-if="ready" class="decks__pos">{{ t('phos', 'Slide {n} of {total}', { n: pos + 1, total }) }}</span>
			</div>
			<NcLoadingIcon v-if="loading" />
			<p v-if="error" class="decks__error">
				{{ error }}
			</p>
			<div ref="host" class="phos-deckhost decks__stage" :style="hostVars" tabindex="0">
				<div ref="revealEl" class="reveal">
					<div class="slides" />
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
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import { mdiFullscreen } from '@mdi/js'
import 'reveal.js/reveal.css'
import '../docs/phos-deck.css'
import { decks, deckPassage, deckImageUrl, cleanHtml, fullPayload } from '../services/docs.js'
import { renderDeck, themeOf, themeVars } from '../docs/deck.js'
import { loadModules, modulesLoaded } from '../services/phos.js'

const iconFullscreen = mdiFullscreen
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
const deckObj = shallowRef(null)
const reveal = shallowRef(null)
const ready = ref(false)
const loading = ref(false)
const error = ref('')
const pos = ref(0)
const total = ref(0)
const notes = ref('')

const hostVars = computed(() => themeVars(themeOf(deckObj.value?.theme || current.value?.theme)))

async function destroy() {
	ready.value = false
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
	const d = current.value
	if (!d) {
		return
	}
	loading.value = true
	try {
		if (!modulesLoaded.value) {
			await loadModules()
		}
		const payload = await fullPayload(d.rec)
		const deck = payload?.deck || payload || {}
		deckObj.value = deck
		const sections = await renderDeck(deck, {
			passage: (m, osis) => deckPassage(m, osis),
			image: p => deckImageUrl(d, p),
			sanitize: cleanHtml,
		})
		if (s !== seq) {
			return
		}
		await nextTick()
		revealEl.value.querySelector('.slides').innerHTML = sections.join('')
		const { default: Reveal } = await import('reveal.js')
		const r = new Reveal(revealEl.value, {
			embedded: true, hash: false, history: false, controls: true, progress: true, center: false,
			transition: 'slide', width: 1280, height: 720, margin: 0.06, minScale: 0.2, maxScale: 2.0,
			keyboard: true, overview: true, slideNumber: false,
		})
		await r.initialize()
		if (s !== seq) {
			r.destroy()
			return
		}
		reveal.value = r
		const report = () => {
			const cur = r.getCurrentSlide()
			pos.value = cur ? parseInt(cur.getAttribute('data-idx') || '0', 10) : 0
			total.value = r.getTotalSlides()
			const aside = cur?.querySelector('aside.notes')
			notes.value = aside ? aside.innerHTML : ''
		}
		r.on('slidechanged', report)
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
onBeforeUnmount(() => {
	document.removeEventListener('fullscreenchange', onFs)
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
</style>
