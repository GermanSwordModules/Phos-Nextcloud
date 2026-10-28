<template>
	<div class="qb-panel">
		<iframe ref="frame"
			class="qb-panel__frame"
			:src="frameUrl"
			:title="t('phos', 'Query builder')"
			@load="onFrameLoad" />
		<div class="qb-panel__actions">
			<NcButton variant="primary" :disabled="!pql" @click="use">
				{{ t('phos', 'Search') }}
			</NcButton>
			<NcButton @click="emit('close')">
				{{ t('phos', 'Close') }}
			</NcButton>
		</div>
	</div>
</template>

<script setup>
import { ref } from 'vue'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import NcButton from '@nextcloud/vue/components/NcButton'

/**
 * Phase 3, Scope 4: the shared web/querybuilder/ bundle (desktop's graphical PQL builder),
 * restricted via `caps` to the subset ModuleService::search()/SearchIndex actually execute --
 * AND of word/prefix/phrase/strong blocks only; no OR, no NEAR/FOLLOWED proximity, no inline
 * scope/FROM (this app's own module/book-scope picker in SearchView.vue covers that already),
 * no COUNT/COLLOC/INFER. See BVC's docs/shareable-tool-bundles.md "The shape" #6.
 */
const emit = defineEmits(['close', 'run'])

const frameUrl = generateUrl('/apps/phos/qb-bundle/querybuilder.html')
const frame = ref(null)
const pql = ref('')

const CAPS = { fields: ['word', 'prefix', 'phrase', 'strong'], ops: ['AND'], out: ['hits'], scope: false }

function onFrameLoad() {
	const win = frame.value?.contentWindow
	if (!win) {
		return
	}
	win.bvcMsg = (channel, payload) => {
		if (channel === 'qb.pql') {
			pql.value = payload
		}
	}
	win.PhosQB?.load({ caps: CAPS })
}

function use() {
	if (pql.value) {
		emit('run', pql.value)
	}
}
</script>

<style scoped lang="scss">
.qb-panel {
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-large);
	margin-bottom: 16px;
	overflow: hidden;

	&__frame {
		width: 100%;
		min-height: 260px;
		border: 0;
		display: block;
	}

	&__actions {
		display: flex;
		gap: 8px;
		padding: 8px;
		border-top: 1px solid var(--color-border);
	}
}
</style>
