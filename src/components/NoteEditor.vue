<template>
	<div class="note-editor">
		<template v-if="editing">
			<NcTextArea ref="area"
				v-model="draft"
				:label="t('phos', 'Note (Markdown)')"
				resize="vertical"
				:rows="6"
				@keydown.ctrl.enter="save"
				@keydown.esc="cancel" />
			<p v-if="hasRich" class="note-editor__hint">
				{{ t('phos', 'This note has formatting from Phos Desktop. Saving here keeps the text but drops the formatting.') }}
			</p>
			<div class="note-editor__buttons">
				<NcButton variant="primary" @click="save">
					{{ t('phos', 'Save') }}
				</NcButton>
				<NcButton @click="cancel">
					{{ t('phos', 'Cancel') }}
				</NcButton>
			</div>
		</template>
		<div v-else class="note-editor__view" :class="{ 'note-editor__view--empty': !text }" @click="edit">
			<Markdown v-if="text" :text="text" />
			<span v-else>{{ placeholder || t('phos', 'Add a note …') }}</span>
		</div>
	</div>
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { t } from '@nextcloud/l10n'
import NcTextArea from '@nextcloud/vue/components/NcTextArea'
import NcButton from '@nextcloud/vue/components/NcButton'
import Markdown from './Markdown.vue'

const props = defineProps({
	text: { type: String, default: '' },
	hasRich: { type: Boolean, default: false },
	placeholder: { type: String, default: '' },
	startEditing: { type: Boolean, default: false },
})
const emit = defineEmits(['save', 'cancel'])
const editing = ref(props.startEditing)
const draft = ref(props.text)
const area = ref(null)

function edit() {
	draft.value = props.text
	editing.value = true
	nextTick(() => area.value?.$el?.querySelector('textarea')?.focus())
}

function save() {
	editing.value = false
	if (draft.value !== props.text) {
		emit('save', draft.value)
	}
}

function cancel() {
	editing.value = false
	emit('cancel')
}
</script>

<style scoped lang="scss">
.note-editor {
	&__view {
		cursor: text;
		padding: 4px 6px;
		border-radius: var(--border-radius);
		min-height: 1.6em;

		&:hover {
			background: var(--color-background-hover);
		}

		&--empty {
			color: var(--color-text-maxcontrast);
			font-style: italic;
		}
	}

	&__hint {
		color: var(--color-text-maxcontrast);
		font-size: 0.85em;
	}

	&__buttons {
		display: flex;
		gap: 8px;
		margin-top: 6px;
	}
}
</style>
