<template>
	<div class="phos-page facts">
		<h2>{{ t('phos', 'Facts') }}</h2>
		<form class="facts__search" @submit.prevent="pick(matches[0])">
			<NcTextField v-model="query"
				:label="t('phos', 'Topic')"
				:placeholder="t('phos', 'e.g. “prayer”, “David”, “forgiveness”')" />
			<NcSelect v-if="bibleOptions.length > 1"
				v-model="bibleSel"
				class="facts__bible"
				:options="bibleOptions"
				:clearable="false"
				:input-label="t('phos', 'Bible')"
				label="label" />
		</form>
		<ul v-if="!route.params.key && matches.length" class="facts__matches">
			<li v-for="m in matches" :key="m.key">
				<NcButton variant="tertiary" @click="pick(m)">
					{{ m.label }}
				</NcButton>
			</li>
		</ul>
		<NcEmptyContent v-else-if="!route.params.key" :name="t('phos', 'Pick a topic')"
			:description="t('phos', 'Type above, or open Facts from a word or verse elsewhere in Phos.')" />
		<template v-else>
			<NcLoadingIcon v-if="loading" :size="32" />
			<p v-if="error" class="facts__error">
				{{ error }}
			</p>
			<iframe v-show="!loading && !error"
				ref="frame"
				class="facts__frame"
				:src="frameUrl"
				:title="t('phos', 'Facts')"
				@load="onFrameLoad" />
		</template>
	</div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { showInfo } from '@nextcloud/dialogs'
import { http } from '../services/api.js'
import { bibles, defaultBible, lang } from '../services/phos.js'
import { parseRef, formatRef } from '../bible/books.js'
import { render as renderMarkup } from '../bible/render.js'

const route = useRoute()
const router = useRouter()
const uiLang = lang.slice(0, 2)

const frameUrl = generateUrl('/apps/phos/facts-bundle/facts.html')
const frame = ref(null)
const loading = ref(false)
const error = ref('')
let payload = null
let frameReady = false

// ---- topic picker ----
const query = ref('')
const matches = ref([])
let searchSeq = 0
watch(query, async (q) => {
	if (route.params.key) {
		return
	}
	const s = ++searchSeq
	const r = await http.get('/facts', { lang: uiLang, q }).catch(() => ({ topics: [] }))
	if (s === searchSeq) {
		matches.value = r.topics
	}
}, { immediate: true })

function pick(m) {
	if (m) {
		router.push({ name: 'facts', params: { key: m.key } })
	}
}

// ---- Bible picker (which module the key passages are shown from) ----
const bibleOptions = computed(() => bibles.value.filter(m => !m.locked).map(m => ({ id: m.name, label: m.description || m.name })))
const bibleSel = computed({
	get: () => bibleOptions.value.find(o => o.id === bibleModule.value) || null,
	set: o => { bibleModule.value = o?.id || null },
})
const bibleModule = ref(null)
watch(bibleOptions, (opts) => {
	if (!bibleModule.value && opts.length) {
		bibleModule.value = defaultBible() || opts[0].id
	}
}, { immediate: true })

// ---- load + render ----
async function load() {
	const key = route.params.key
	if (!key) {
		return
	}
	loading.value = true
	error.value = ''
	frameReady = false
	payload = null
	query.value = ''
	try {
		const data = await http.get(`/facts/${encodeURIComponent(key)}`, { lang: uiLang, module: bibleModule.value })
		for (const sec of data.sections) {
			if (sec.kind === 'passages') {
				for (const item of sec.items) {
					const ref = parseRef(item.osis)
					item.display = ref ? formatRef(ref, uiLang) : item.osis
				}
			}
		}
		payload = data
		if (frameReady) {
			renderNow()
		}
	} catch (e) {
		error.value = e.message
	} finally {
		loading.value = false
	}
}
watch(() => [route.params.key, bibleModule.value], load, { immediate: true })

function renderNow() {
	frame.value?.contentWindow?.PhosFacts?.render(payload)
}

function onFrameLoad() {
	const w = frame.value.contentWindow
	w.bvcMsg = handleMsg
	frameReady = true
	if (payload) {
		renderNow()
	}
}

// ---- the bridge (BVC docs/shareable-tool-bundles.md: one bridge out, `window.bvcMsg`) ----
async function handleMsg(channel, msg) {
	if (channel === 'nav') {
		return nav(msg)
	}
	if (channel === 'preview') {
		return preview(msg)
	}
	// 'project' / 'places' / 'slide': desktop-only, never sent (canProject/canPresent are false)
}

function nav(url) {
	if (url.startsWith('phos:bible/')) {
		const ref = parseRef(url.slice(11))
		if (ref && bibleModule.value) {
			router.push({ name: 'bible', params: { module: bibleModule.value, book: ref.book, chapter: ref.c1 } })
		}
		return
	}
	if (url.startsWith('phos:topic/')) {
		router.push({ name: 'facts', params: { key: url.slice(11) } })
		return
	}
	if (url.startsWith('phos:entry/')) {
		const [, , module, key] = url.split('/')
		router.push({ name: 'dict', params: { module, key } })
		return
	}
	// facts:person/… facts:geo/…: People & Places isn't on the web yet
	showInfo(t('phos', 'This isn’t available on the web yet.'))
}

async function preview(msg) {
	const [osis, x, y] = msg.split('|')
	const ref = parseRef(osis)
	if (!ref || !bibleModule.value) {
		return
	}
	try {
		const ch = await http.get(`/modules/${encodeURIComponent(bibleModule.value)}/text/${ref.book}/${ref.c1}`)
		const meta = bibles.value.find(m => m.name === bibleModule.value)
		const text = ch.verses?.[ref.v1 || 1] || ''
		const html = '<b>' + formatRef(ref, uiLang) + '</b><div>' + renderMarkup(text, { sourceType: meta?.sourceType }).html + '</div>'
		await nextTick()
		frame.value?.contentWindow?.PhosFacts?.showPreview(html, +x, +y)
	} catch {
		// a failed preview just doesn't show -- not worth an error toast
	}
}
</script>

<style scoped lang="scss">
.facts {
	&__search {
		display: flex;
		gap: 12px;
		align-items: flex-end;
		flex-wrap: wrap;
		max-width: 700px;
		margin-bottom: 12px;
	}

	&__bible {
		min-width: 220px;
	}

	&__matches {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}

	&__error {
		color: var(--color-error);
	}

	&__frame {
		width: 100%;
		min-height: 70vh;
		border: 0;
	}
}
</style>
