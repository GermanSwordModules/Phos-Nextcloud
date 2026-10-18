<template>
	<div class="label-picker">
		<button v-for="l in available"
			:key="l.collection + l.name"
			type="button"
			class="phos-chip label-picker__chip"
			:class="{ 'label-picker__chip--on': selected.includes(l.name) }"
			:style="{ '--phos-chip': l.color || 'var(--color-border-dark)' }"
			:aria-pressed="selected.includes(l.name)"
			:title="l.shared ? t('phos', 'shared by {owner}', { owner: l.owner }) : ''"
			@click="toggle(l.name)">
			<NcIconSvgWrapper v-if="selected.includes(l.name)" :path="iconCheck" :size="14" />
			{{ labelDisplay(l.name) }}
			<NcIconSvgWrapper v-if="l.shared" :path="iconPerson" :size="14" />
		</button>
		<form class="label-picker__new" @submit.prevent="addNew">
			<NcTextField v-model="newName"
				:label="t('phos', 'New label')"
				:show-trailing-button="!!newName"
				trailing-button-icon="arrowEnd"
				@trailing-button-click="addNew" />
		</form>
	</div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { t } from '@nextcloud/l10n'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { labels, labelDisplay, createLabel } from '../services/phos.js'
import { iconCheck, iconPerson } from '../icons.js'

const props = defineProps({
	selected: { type: Array, default: () => [] },
	/** labels of this collection only (a bookmark names labels of its own collection) */
	collection: { type: String, default: null },
})
const emit = defineEmits(['update'])
const newName = ref('')

const available = computed(() => labels.value.filter(l => !props.collection || l.collection === props.collection))

function toggle(name) {
	const next = props.selected.includes(name) ? props.selected.filter(x => x !== name) : [...props.selected, name]
	emit('update', next)
}

function addNew() {
	const name = newName.value.trim()
	if (!name) {
		return
	}
	if (!labels.value.some(l => l.name === name)) {
		createLabel(name)
	}
	if (!props.selected.includes(name)) {
		emit('update', [...props.selected, name])
	}
	newName.value = ''
}
</script>

<style scoped lang="scss">
.label-picker {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	align-items: center;

	&__chip {
		cursor: pointer;
		opacity: 0.75;
		background: transparent;
		color: var(--color-main-text);
		// Nextcloud styles every <button> as a 44px control
		min-height: 26px;
		height: auto;
		line-height: 22px;
		padding: 1px 10px;
		margin: 0;
		border: 1px solid var(--phos-chip);
		font-weight: normal;

		&--on {
			opacity: 1;
			font-weight: bold;
			background: color-mix(in srgb, var(--phos-chip) 35%, transparent);
		}
	}

	&__new {
		flex: 1 1 100%;
		margin-top: 6px;
	}
}
</style>
