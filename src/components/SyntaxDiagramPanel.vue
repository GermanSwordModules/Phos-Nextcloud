<template>
	<div v-if="diagram" class="syn-panel">
		<h4>{{ t('phos', 'Syntax diagram') }}</h4>
		<p class="syn-panel__hint">
			{{ t('phos', 'Saved from the desktop app -- read-only here.') }}
		</p>
		<iframe :key="osis"
			ref="frame"
			class="syn-panel__frame"
			:src="frameUrl"
			:title="t('phos', 'Syntax diagram')"
			@load="onFrameLoad" />
	</div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { t } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { syntaxDiagramFor } from '../services/phos.js'

/**
 * Phase 3, Scope 3: renders an already-synced free-form syntax diagram
 * (desktop's Satzbau/Syntax tool, "Frei" mode) read-only, via the shared
 * web/syntax/ bundle in opts.readOnly mode -- no Macula tree data on this
 * host, so tree/blocks/Reed-Kellogg modes aren't offered here.
 */
const props = defineProps({ osis: { type: String, required: true } })

const frameUrl = generateUrl('/apps/phos/syntax-bundle/syntax.html')
const frame = ref(null)
// the iframe is keyed on osis, so a verse change always remounts it and @load fires again
const diagram = computed(() => syntaxDiagramFor(props.osis))

function onFrameLoad() {
	frame.value?.contentWindow?.PhosSyntax?.load({
		data: { sentences: [] },
		labels: {},
		mode: 'free',
		saved: diagram.value,
		opts: { readOnly: true },
	})
}
</script>

<style scoped lang="scss">
.syn-panel {
	border-bottom: 1px solid var(--color-border);
	padding-bottom: 12px;
	margin-bottom: 16px;

	h4 {
		margin: 0 0 2px;
		font-size: 1em;
		font-weight: bold;
		color: var(--color-text-maxcontrast);
	}

	&__hint {
		margin: 0 0 6px;
		font-size: 0.85em;
		color: var(--color-text-maxcontrast);
	}

	&__frame {
		width: 100%;
		min-height: 180px;
		border: 0;
	}
}
</style>
