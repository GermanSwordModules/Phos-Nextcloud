<template>
	<NcActions force-menu
		:menu-name="t('phos', 'View')"
		:default-icon="iconViewOptions"
		:aria-label="t('phos', 'View options')">
		<NcActionButton :close-after-click="true" @click="$emit('print')">
			<template #icon>
				<NcIconSvgWrapper :path="iconPrint" />
			</template>
			{{ t('phos', 'Export as PDF …') }}
		</NcActionButton>
		<NcActionSeparator />
		<NcActionCheckbox :model-value="versePerLine" @update:model-value="v => $emit('update:versePerLine', v)">
			{{ t('phos', 'Verse per line') }}
		</NcActionCheckbox>
		<NcActionCheckbox :model-value="displayOptions.chapterNum" @update:model-value="v => setDisplayOption('chapterNum', v)">
			{{ t('phos', 'Chapter number in the margin') }}
		</NcActionCheckbox>
		<NcActionSeparator />
		<NcActionCheckbox :model-value="displayOptions.headings" @update:model-value="v => setDisplayOption('headings', v)">
			{{ t('phos', 'Headings') }}
		</NcActionCheckbox>
		<NcActionCheckbox :model-value="displayOptions.strongs" @update:model-value="v => setDisplayOption('strongs', v)">
			{{ t('phos', "Strong's numbers") }}
		</NcActionCheckbox>
		<NcActionCheckbox :model-value="displayOptions.notes" @update:model-value="v => setDisplayOption('notes', v)">
			{{ t('phos', 'Footnotes and cross-references') }}
		</NcActionCheckbox>
		<NcActionCheckbox v-if="displayOptions.notes"
			:model-value="displayOptions.sideNotes"
			@update:model-value="v => setDisplayOption('sideNotes', v)">
			{{ t('phos', 'Footnotes in the margin') }}
		</NcActionCheckbox>
		<NcActionCheckbox :model-value="displayOptions.redLetter" @update:model-value="v => setDisplayOption('redLetter', v)">
			{{ t('phos', 'Words of Jesus in red') }}
		</NcActionCheckbox>
		<NcActionSeparator />
		<NcActionCaption :name="t('phos', 'Theme (all devices)')" />
		<NcActionRadio v-for="m in THEME_MODES"
			:key="m"
			name="phos-theme"
			:value="m"
			:model-value="readerTheme() || 'auto'"
			@update:model-value="setReaderTheme(m)">
			{{ themeLabel(m) }}
		</NcActionRadio>
		<NcActionSeparator />
		<NcActionButton :close-after-click="false" @click="setTextZoom(textZoom - 10)">
			<template #icon>
				<NcIconSvgWrapper :path="iconZoomOut" />
			</template>
			{{ t('phos', 'Smaller text') }}
		</NcActionButton>
		<NcActionButton :close-after-click="false" @click="setTextZoom(textZoom + 10)">
			<template #icon>
				<NcIconSvgWrapper :path="iconZoomIn" />
			</template>
			{{ t('phos', 'Larger text') }}
		</NcActionButton>
		<NcActionButton v-if="textZoom !== 100" :close-after-click="true" @click="setTextZoom(100)">
			<template #icon>
				<NcIconSvgWrapper :path="iconZoomReset" />
			</template>
			{{ t('phos', 'Reset text size ({pct}%)', { pct: textZoom }) }}
		</NcActionButton>
	</NcActions>
</template>

<script setup>
import { t } from '@nextcloud/l10n'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcActionCheckbox from '@nextcloud/vue/components/NcActionCheckbox'
import NcActionSeparator from '@nextcloud/vue/components/NcActionSeparator'
import NcActionCaption from '@nextcloud/vue/components/NcActionCaption'
import NcActionRadio from '@nextcloud/vue/components/NcActionRadio'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { displayOptions, setDisplayOption, textZoom, setTextZoom, THEME_MODES, readerTheme, setReaderTheme } from '../services/phos.js'
import { iconViewOptions, iconPrint, iconZoomIn, iconZoomOut, iconZoomReset } from '../icons.js'

/**
 * The web analogue of the desktop's "Ansicht ▾" popup menu
 * (`unit_child.pas` `ViewMenuClick`/`ViewMenuItemClick`) and its row of
 * `DISP_TOGGLES` toolbar buttons: one menu reading/writing the single shared
 * `displayOptions` object in `services/phos.js`, so a new toggle is one
 * checkbox here plus one CSS rule in `BibleView.vue`, not a one-off control.
 */
defineProps({ versePerLine: { type: Boolean, default: true } })
defineEmits(['update:versePerLine', 'print'])

const themeLabel = m => ({
	auto: t('phos', 'Automatic (Nextcloud theme)'),
	light: t('phos', 'Light'),
	dark: t('phos', 'Dark'),
	sepia: t('phos', 'Sepia'),
})[m]
</script>
