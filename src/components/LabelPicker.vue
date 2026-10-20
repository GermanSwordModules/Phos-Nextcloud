<template>
	<div class="label-picker">
		<button v-for="l in available"
			:key="l.collection + l.name"
			type="button"
			class="phos-chip label-picker__chip"
			:class="{ 'label-picker__chip--on': isOn(l) }"
			:style="{ '--phos-chip': l.color || 'var(--color-border-dark)' }"
			:aria-pressed="isOn(l)"
			:title="chipTitle(l)"
			@click="toggle(l)">
			<NcIconSvgWrapper v-if="isOn(l)" :path="iconCheck" :size="14" />
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
import { assignableLabels, labelDisplay, createLabel, personal } from '../services/phos.js'
import { iconCheck, iconPerson } from '../icons.js'

const props = defineProps({
	/** label names of the bookmark (they name labels of its own collection) */
	selected: { type: Array, default: () => [] },
	/** the bookmark's collection */
	collection: { type: String, default: null },
})
/** emits the picked label objects in order; the first shared one decides the collection */
const emit = defineEmits(['update'])
const newName = ref('')

const available = computed(() => assignableLabels.value)
const isOn = l => l.collection === props.collection && props.selected.includes(l.name)
const current = () => available.value.filter(isOn)
	.sort((a, b) => props.selected.indexOf(a.name) - props.selected.indexOf(b.name))

function chipTitle(l) {
	if (!l.shared) {
		return ''
	}
	const by = t('phos', 'shared by {owner}', { owner: l.owner })
	return isOn(l) || l.collection === props.collection ? by : by + ' — ' + t('phos', 'adding it shares this bookmark (without your private labels)')
}

function toggle(l) {
	const cur = current()
	emit('update', isOn(l) ? cur.filter(x => x !== l) : [...cur, l])
}

/** A new label belongs where the bookmark is (shared there, or mine). */
function addNew() {
	const name = newName.value.trim()
	if (!name) {
		return
	}
	const coll = props.collection || personal()
	let l = available.value.find(x => x.name === name && x.collection === coll)
	if (!l) {
		createLabel(name, undefined, coll)
		l = { name, collection: coll }
	}
	if (!isOn(l)) {
		emit('update', [...current(), l])
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
