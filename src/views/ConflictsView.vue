<template>
	<div class="phos-page conflicts">
		<h2>{{ t('phos', 'Conflicts') }}</h2>
		<p class="conflicts__intro">
			{{ t('phos', 'A conflict arises when two devices changed the same text in the same place. The server kept one version; the other waits here so nothing is lost.') }}
		</p>
		<NcEmptyContent v-if="!state.conflicts.length" :name="t('phos', 'No open conflicts')">
			<template #icon>
				<NcIconSvgWrapper :path="iconCheck" />
			</template>
		</NcEmptyContent>
		<div v-for="c in state.conflicts" :key="c.id" class="conflicts__item">
			<h3>{{ title(c) }}</h3>
			<div class="conflicts__meta">
				{{ t('phos', 'from {device}, {time}', { device: deviceName(c.device), time: new Date(c.created).toLocaleString() }) }}
			</div>
			<table class="conflicts__table">
				<thead>
					<tr>
						<th />
						<th>{{ t('phos', 'Kept on the server') }}</th>
						<th>{{ t('phos', 'Other version') }}</th>
						<th>{{ t('phos', 'Result') }}</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="f in diff(c)" :key="f">
						<th>{{ f }}</th>
						<td><pre>{{ show(current(c)?.[f]) }}</pre></td>
						<td><pre>{{ show(c.payload?.[f]) }}</pre></td>
						<td>
							<textarea v-if="typeof c.payload?.[f] === 'string' || typeof current(c)?.[f] === 'string'"
								v-model="edits[c.id][f]"
								rows="5" />
							<pre v-else>{{ show(c.payload?.[f]) }}</pre>
						</td>
					</tr>
				</tbody>
			</table>
			<div class="conflicts__buttons">
				<NcButton @click="resolve(c, 'server')">
					{{ t('phos', 'Keep server version') }}
				</NcButton>
				<NcButton @click="resolve(c, 'conflict')">
					{{ t('phos', 'Take other version') }}
				</NcButton>
				<NcButton variant="primary" @click="resolve(c, 'merged')">
					{{ t('phos', 'Save result') }}
				</NcButton>
			</div>
		</div>
	</div>
</template>

<script setup>
import { reactive, ref, watchEffect } from 'vue'
import { t } from '@nextcloud/l10n'
import { showError } from '@nextcloud/dialogs'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { engine, state, lang } from '../services/phos.js'
import { http } from '../services/api.js'
import { formatRef } from '../bible/books.js'
import { iconCheck } from '../icons.js'

const devices = ref([])
http.get('/devices').then(r => { devices.value = r.devices }).catch(() => {})
const edits = reactive({})

const current = c => engine.get(c.type, c.key, c.collection)?.payload ?? null
const deviceName = id => devices.value.find(d => d.id === id)?.name || id
const show = v => v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v, null, 1)

function title(c) {
	const p = c.payload || {}
	if (c.type === 'bookmark' && p.bookOsis) {
		return t('phos', 'Bookmark {ref}', { ref: formatRef({ book: p.bookOsis, c1: p.chap, v1: p.vStart, c2: p.chap, v2: p.vEnd || p.vStart }, lang) })
	}
	return `${c.type}: ${c.key}`
}

function diff(c) {
	const a = current(c) || {}
	const b = c.payload || {}
	return [...new Set([...Object.keys(a), ...Object.keys(b)])]
		.filter(k => k !== 'modified' && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
}

watchEffect(() => {
	for (const c of state.conflicts) {
		if (!edits[c.id]) {
			const e = {}
			for (const f of diff(c)) {
				e[f] = typeof c.payload?.[f] === 'string' ? c.payload[f] : (current(c)?.[f] ?? '')
			}
			edits[c.id] = e
		}
	}
})

async function resolve(c, how) {
	try {
		if (how === 'server') {
			await engine.resolveConflict(c.id, 'server')
		} else if (how === 'conflict') {
			await engine.resolveConflict(c.id, 'conflict')
		} else {
			const payload = { ...c.payload }
			for (const [f, v] of Object.entries(edits[c.id] || {})) {
				if (typeof v === 'string' && (typeof c.payload?.[f] === 'string' || typeof current(c)?.[f] === 'string')) {
					payload[f] = v
				}
			}
			if (c.type === 'bookmark') {
				payload.modified = Math.floor(Date.now() / 1000)
				if ('noteMd' in (edits[c.id] || {})) {
					delete payload.noteHtml
				}
			}
			await engine.resolveConflict(c.id, 'conflict', payload)
		}
	} catch (e) {
		showError(e.message)
	}
}
</script>

<style scoped lang="scss">
.conflicts {
	&__intro {
		color: var(--color-text-maxcontrast);
		margin-bottom: 16px;
		max-width: 700px;
	}

	&__item {
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-large);
		padding: 12px 16px;
		margin-bottom: 16px;

		h3 {
			font-weight: bold;
		}
	}

	&__meta {
		color: var(--color-text-maxcontrast);
		font-size: 0.9em;
		margin-bottom: 8px;
	}

	&__table {
		width: 100%;
		border-collapse: collapse;

		th,
		td {
			text-align: left;
			vertical-align: top;
			padding: 4px 8px;
			border-bottom: 1px solid var(--color-border);
		}

		pre {
			white-space: pre-wrap;
			font-family: inherit;
			margin: 0;
		}

		textarea {
			width: 100%;
			min-width: 180px;
		}
	}

	&__buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 10px;
	}
}
</style>
