<template>
	<div class="phos-page ebooks">
		<template v-if="!book">
			<h2>{{ t('phos', 'E-books') }}</h2>
			<NcEmptyContent v-if="!ebooks.length"
				:name="t('phos', 'No e-books on the server')"
				:description="t('phos', 'E-books of Phos Desktop appear here when they are synced (settings of the Nextcloud sync: e-books).')" />
			<NcTextField v-else v-model="filter" :label="t('phos', 'Filter')" class="ebooks__filter" />
			<ul class="ebooks__grid">
				<li v-for="b in shown" :key="b.key">
					<router-link :to="{ name: 'ebooks', params: { ref: b.ref } }" class="ebooks__card">
						<img v-if="infos[b.key]?.Cover && b.files.includes(infos[b.key].Cover)" :src="ebookFileUrl(b, infos[b.key].Cover)" alt="" loading="lazy">
						<span v-else class="ebooks__nocover">{{ b.format.toUpperCase() }}</span>
						<strong>{{ infos[b.key]?.Title || b.ref.replace(/-/g, ' ') }}</strong>
						<span class="ebooks__author">{{ infos[b.key]?.Author || '' }}</span>
					</router-link>
				</li>
			</ul>
		</template>
		<template v-else>
			<div class="ebooks__bar">
				<NcButton variant="tertiary" :aria-label="t('phos', 'Back to the e-books')" @click="router.push({ name: 'ebooks' })">
					<template #icon>
						<NcIconSvgWrapper :path="iconBack" />
					</template>
				</NcButton>
				<strong class="ebooks__title">{{ info.Title || book.ref }}</strong>
				<ShareButton type="ebook" :record-key="book.key" :collection="book.collection" :title="info.Title || book.ref" />
				<template v-if="book.format === 'epub'">
					<NcSelect v-if="toc.length"
						v-model="chapter"
						:options="toc"
						label="label"
						:clearable="false"
						:aria-label-combobox="t('phos', 'Contents')"
						:placeholder="t('phos', 'Contents')"
						class="ebooks__toc" />
					<NcButton :aria-label="t('phos', 'Previous page')" @click="rendition?.prev()">
						‹
					</NcButton>
					<NcButton :aria-label="t('phos', 'Next page')" @click="rendition?.next()">
						›
					</NcButton>
				</template>
				<a :href="ebookFileUrl(book, book.main) + '?download=1'" :download="book.ref + '.' + book.format" class="ebooks__dl">{{ t('phos', 'Download') }}</a>
			</div>
			<NcLoadingIcon v-if="loading" />
			<p v-if="error" class="ebooks__error">
				{{ error }}
			</p>
			<iframe v-if="book.format === 'pdf'"
				:src="ebookFileUrl(book, book.main)"
				class="ebooks__pdf"
				:title="info.Title || book.ref" />
			<div v-else ref="viewer" class="ebooks__viewer" />
		</template>
	</div>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import axios from '@nextcloud/axios'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { mdiArrowLeft } from '@mdi/js'
import { ebooks, ebookFileUrl, ebookInfo, ebookPosition, setEbookPosition } from '../services/docs.js'
import ShareButton from '../components/ShareButton.vue'

const iconBack = mdiArrowLeft
const route = useRoute()
const router = useRouter()

const infos = reactive({})
watch(ebooks, list => {
	for (const b of list) {
		if (!(b.key in infos)) {
			infos[b.key] = null
			ebookInfo(b).then(i => { infos[b.key] = i })
		}
	}
}, { immediate: true })

const filter = ref('')
const shown = computed(() => {
	const f = filter.value.trim().toLowerCase()
	return ebooks.value.filter(b => !f || [b.ref, infos[b.key]?.Title, infos[b.key]?.Author].join(' ').toLowerCase().includes(f))
})

const book = computed(() => ebooks.value.find(b => b.ref === route.params.ref) || null)
const info = computed(() => (book.value && infos[book.value.key]) || {})

// ---------- ePub ----------

const viewer = ref(null)
const rendition = shallowRef(null)
let epub = null
const toc = ref([])
const loading = ref(false)
const error = ref('')
const chapterSel = ref(null)
const chapter = computed({
	get: () => chapterSel.value,
	set: o => {
		chapterSel.value = o
		rendition.value?.display(o.href)
	},
})

function close() {
	try {
		rendition.value?.destroy()
		epub?.destroy()
	} catch {
		// half-opened book
	}
	rendition.value = null
	epub = null
	toc.value = []
}

let seq = 0
watch(book, async b => {
	const s = ++seq
	close()
	error.value = ''
	if (!b || b.format !== 'epub') {
		return
	}
	loading.value = true
	try {
		const [{ default: ePub }, data] = await Promise.all([
			import('epubjs'),
			axios.get(ebookFileUrl(b, b.main), { responseType: 'arraybuffer' }).then(r => r.data),
		])
		if (s !== seq) {
			return
		}
		await nextTick()
		epub = ePub(data)
		const r = epub.renderTo(viewer.value, { width: '100%', height: '100%', flow: 'paginated', allowScriptedContent: false })
		rendition.value = r
		const nav = await epub.loaded.navigation
		const flat = []
		const walk = (items, depth) => {
			for (const it of items || []) {
				flat.push({ href: it.href, label: ' '.repeat(depth) + (it.label || '').trim() })
				walk(it.subitems, depth + 1)
			}
		}
		walk(nav.toc, 0)
		toc.value = flat
		// where the desktop (or this browser) left off: the chapter file
		const at = ebookPosition(b.ref)
		let shownAt = false
		if (at) {
			const sec = epub.spine.get(at) || epub.spine.spineItems.find(x => x.href.endsWith(at) || at.endsWith(x.href))
			if (sec) {
				await r.display(sec.href)
				shownAt = true
			}
		}
		if (!shownAt) {
			await r.display()
		}
		r.on('relocated', loc => {
			const href = loc?.start?.href
			if (!href) {
				return
			}
			chapterSel.value = flat.find(x => x.href.split('#')[0] === href) || chapterSel.value
			setEbookPosition(b.ref, href)
		})
	} catch (e) {
		error.value = t('phos', 'This e-book could not be opened: {error}', { error: e.message })
	} finally {
		if (s === seq) {
			loading.value = false
		}
	}
}, { immediate: true, flush: 'post' })

function onKey(e) {
	if (!rendition.value || /input|textarea|select/i.test(e.target?.tagName || '')) {
		return
	}
	if (e.key === 'ArrowRight' || e.key === 'PageDown') {
		rendition.value.next()
	} else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
		rendition.value.prev()
	}
}
document.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
	document.removeEventListener('keydown', onKey)
	seq++
	close()
})
</script>

<style scoped lang="scss">
.ebooks {
	&__filter {
		max-width: 360px;
		margin-bottom: 12px;
	}

	&__grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 16px;
		list-style: none;
		padding: 0;
	}

	&__card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px;
		border-radius: var(--border-radius-large);

		&:hover {
			background: var(--color-background-hover);
		}

		img {
			width: 100%;
			aspect-ratio: 2 / 3;
			object-fit: cover;
			border-radius: var(--border-radius);
			box-shadow: 0 0 4px var(--color-box-shadow);
		}
	}

	&__nocover {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		aspect-ratio: 2 / 3;
		background: var(--color-background-dark);
		border-radius: var(--border-radius);
		color: var(--color-text-maxcontrast);
		font-weight: bold;
	}

	&__author {
		color: var(--color-text-maxcontrast);
		font-size: .9em;
	}

	&__bar {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}

	&__title {
		margin-right: auto;
	}

	&__toc {
		min-width: 260px;
	}

	&__dl {
		color: var(--color-primary-element);
	}

	&__viewer, &__pdf {
		width: 100%;
		height: calc(100vh - 170px);
		min-height: 420px;
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-large);
		background: var(--phos-page, #fff);
	}

	&__error {
		color: var(--color-error);
	}
}
</style>
