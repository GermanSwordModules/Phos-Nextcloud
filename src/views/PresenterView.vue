<template>
	<div class="presenter" :class="{ 'presenter--black': black }">
		<header class="presenter__bar">
			<strong class="presenter__title">{{ deckTitle }}</strong>
			<span>{{ t('phos', 'Slide {n} of {total}', { n: pos + 1, total }) }}</span>
			<span class="presenter__timer" :title="t('phos', 'Time since the start')">{{ elapsedText }}</span>
			<NcButton variant="tertiary" @click="toggleTimer">
				{{ running ? t('phos', 'Pause') : t('phos', 'Start') }}
			</NcButton>
			<NcButton variant="tertiary" @click="resetTimer">
				{{ t('phos', 'Reset') }}
			</NcButton>
			<span class="presenter__clock">{{ clock }}</span>
			<span class="presenter__spacer" />
			<NcButton :disabled="!ready" :aria-label="t('phos', 'Previous')" @click="reveal?.prev()">
				<template #icon>
					<NcIconSvgWrapper :path="iconPrev" />
				</template>
			</NcButton>
			<NcButton :disabled="!ready" :aria-label="t('phos', 'Next')" @click="reveal?.next()">
				<template #icon>
					<NcIconSvgWrapper :path="iconNext" />
				</template>
			</NcButton>
			<NcButton :disabled="!ready" :pressed="black" @update:pressed="on => reveal?.togglePause(on)">
				{{ t('phos', 'Black screen') }}
			</NcButton>
		</header>
		<p v-if="error" class="presenter__error">
			{{ error }}
		</p>
		<NcLoadingIcon v-if="loading" />
		<div class="presenter__main">
			<div ref="host" class="phos-deckhost presenter__current" :style="vars" tabindex="0">
				<div ref="currentEl" class="reveal">
					<div class="slides" />
				</div>
				<div v-if="logo" class="phos-deck-logo" :class="logo.cls" :style="{ height: logo.height + '%' }">
					<img :src="logo.url" alt="">
				</div>
			</div>
			<aside class="presenter__side">
				<h3>{{ t('phos', 'Next') }}</h3>
				<div class="phos-deckhost presenter__next" :style="vars">
					<div ref="nextEl" class="reveal">
						<div class="slides" />
					</div>
					<div v-if="isLast" class="presenter__end">
						{{ t('phos', 'End of the presentation') }}
					</div>
				</div>
				<h3>{{ t('phos', 'Speaker notes') }}</h3>
				<!-- eslint-disable-next-line vue/no-v-html -- rendered by deck.js, which escapes -->
				<div class="presenter__notes" v-html="notes || '—'" />
			</aside>
		</div>
		<p class="presenter__hint">
			{{ t('phos', 'This window steers the presentation in the other window: arrow keys or space, B for a black screen.') }}
		</p>
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { t } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import 'reveal.js/reveal.css'
import '../docs/phos-deck.css'
import { iconPrev, iconNext } from '../icons.js'
import { loadDeck, findDeck, mountReveal, currentNotes, deckChannel, applyGo, goMessage } from '../docs/useDeck.js'
import { decks } from '../services/docs.js'

const route = useRoute()
const host = ref(null)
const currentEl = ref(null)
const nextEl = ref(null)
const reveal = shallowRef(null)
const preview = shallowRef(null)
const loaded = shallowRef(null)
const ready = ref(false)
const loading = ref(false)
const error = ref('')
const pos = ref(0)
const total = ref(0)
const notes = ref('')
const black = ref(false)
const isLast = ref(false)

const deck = computed(() => findDeck(route.params.id))
const deckTitle = computed(() => deck.value?.title || '')
const vars = computed(() => loaded.value?.vars || {})
const logo = computed(() => loaded.value?.logo || null)

// ---- timer and clock
const started = ref(0)
const accumulated = ref(0)
const running = ref(false)
const now = ref(Date.now())
const tick = setInterval(() => { now.value = Date.now() }, 1000)
const elapsed = computed(() => accumulated.value + (running.value ? now.value - started.value : 0))
const two = n => String(n).padStart(2, '0')
const elapsedText = computed(() => {
	const s = Math.floor(elapsed.value / 1000)
	return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`
})
const clock = computed(() => new Date(now.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
function toggleTimer() {
	if (running.value) {
		accumulated.value += Date.now() - started.value
	} else {
		started.value = Date.now()
	}
	running.value = !running.value
}
function resetTimer() {
	accumulated.value = 0
	started.value = Date.now()
}

let channel = null
function showNext(r) {
	const p = preview.value
	if (!p) {
		return
	}
	const h = r.getIndices().h
	isLast.value = h + 1 >= r.getTotalSlides()
	p.slide(Math.min(h + 1, p.getTotalSlides() - 1), 0)
}

async function start() {
	const d = deck.value
	if (!d || reveal.value || loading.value) {
		return
	}
	loading.value = true
	try {
		const l = await loadDeck(d)
		loaded.value = l
		const r = await mountReveal(currentEl.value, l.sections)
		// the next slide whole: no fragments, no controls, no keys
		const p = await mountReveal(nextEl.value, l.sections, {
			controls: false, progress: false, keyboard: false, touch: false, fragments: false, transition: 'none',
		})
		reveal.value = r
		preview.value = p
		const report = () => {
			const cur = r.getCurrentSlide()
			pos.value = cur ? parseInt(cur.getAttribute('data-idx') || '0', 10) : 0
			total.value = r.getTotalSlides()
			notes.value = currentNotes(r)
			showNext(r)
			channel.send(goMessage(r))
		}
		channel = deckChannel(d.id, m => {
			if (m.type === 'go') {
				applyGo(r, m)
			} else if (m.type === 'black') {
				r.togglePause(!!m.on)
			}
		})
		r.on('slidechanged', report)
		r.on('fragmentshown', () => channel.send(goMessage(r)))
		r.on('fragmenthidden', () => channel.send(goMessage(r)))
		r.on('paused', () => { black.value = true; channel.send({ type: 'black', on: true }) })
		r.on('resumed', () => { black.value = false; channel.send({ type: 'black', on: false }) })
		pos.value = 0
		total.value = r.getTotalSlides()
		notes.value = currentNotes(r)
		showNext(r)
		// where the deck window is now
		channel.send({ type: 'hello' })
		ready.value = true
		started.value = Date.now()
		running.value = true
		host.value?.focus()
	} catch (e) {
		error.value = t('phos', 'This presentation could not be shown: {error}', { error: e.message })
	} finally {
		loading.value = false
	}
}

onMounted(start)
watch(() => decks.value.length, start)
onBeforeUnmount(() => {
	clearInterval(tick)
	channel?.close()
	for (const r of [reveal.value, preview.value]) {
		try {
			r?.destroy()
		} catch {
			// never fully set up
		}
	}
})
</script>

<style scoped lang="scss">
.presenter {
	padding: 8px 12px;
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-height: 100%;
	box-sizing: border-box;

	&__bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}

	&__title {
		font-size: 1.1em;
	}

	&__timer {
		font-variant-numeric: tabular-nums;
		font-size: 1.4em;
		font-weight: bold;
	}

	&__clock {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-maxcontrast);
	}

	&__spacer {
		flex: 1;
	}

	&__main {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr);
		gap: 12px;
		align-items: start;
	}

	&__current, &__next {
		position: relative;
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: var(--border-radius-large);
		overflow: hidden;
		box-shadow: 0 0 6px var(--color-box-shadow);
		outline: none;

		:deep(.reveal) {
			width: 100%;
			height: 100%;
		}
	}

	&__next {
		pointer-events: none;
	}

	&__end {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-main-background);
		color: var(--color-text-maxcontrast);
		z-index: 50;
	}

	&__side h3 {
		margin: 4px 0;
		font-size: 1em;
	}

	&__notes {
		font-size: 1.15em;
		line-height: 1.5;
		padding: 8px 12px;
		background: var(--color-background-hover);
		border-radius: var(--border-radius-large);
		max-height: 50vh;
		overflow: auto;
	}

	&__hint {
		color: var(--color-text-maxcontrast);
	}

	&__error {
		color: var(--color-error);
	}
}

@media (max-width: 800px) {
	.presenter__main {
		grid-template-columns: 1fr;
	}
}
</style>
