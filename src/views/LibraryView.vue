<template>
	<div class="phos-page library">
		<div class="library__head">
			<h2>{{ t('phos', 'Library') }}</h2>
			<NcTextField v-model="filter"
				class="library__filter"
				:label="t('phos', 'Filter')"
				:show-trailing-button="!!filter"
				trailing-button-icon="close"
				@trailing-button-click="filter = ''" />
		</div>
		<NcEmptyContent v-if="!tree.length"
			:name="filter ? t('phos', 'No module matches') : t('phos', 'No module on the server yet')"
			:description="filter ? '' : t('phos', 'Modules appear here once you store them online in Phos Desktop (library → right-click a module → “Online speichern (Nextcloud)”).')" />
		<ul v-else class="library__tree" role="tree">
			<li v-for="g in tree" :key="g.id" role="treeitem" :aria-expanded="isOpen(g.id)">
				<button type="button" class="library__node library__node--group" @click="toggle(g.id)">
					<NcIconSvgWrapper :path="isOpen(g.id) ? iconDown : iconNext" :size="18" />
					<NcIconSvgWrapper :path="g.icon" :size="20" />
					<span>{{ g.label }}</span>
					<span class="library__count">{{ g.count }}</span>
				</button>
				<ul v-if="isOpen(g.id)" role="group">
					<li v-for="l in g.langs" :key="l.id" role="treeitem" :aria-expanded="isOpen(l.id)">
						<button type="button" class="library__node library__node--lang" @click="toggle(l.id)">
							<NcIconSvgWrapper :path="isOpen(l.id) ? iconDown : iconNext" :size="18" />
							<span>{{ l.label }}</span>
							<span class="library__count">{{ l.modules.length }}</span>
						</button>
						<ul v-if="isOpen(l.id)" role="group">
							<li v-for="m in l.modules" :key="m.name" role="treeitem">
								<component :is="m.route && !m.locked ? 'router-link' : 'span'"
									:to="m.route || undefined"
									class="library__node library__node--module"
									:class="{ 'library__node--off': m.locked || !m.route }"
									:title="m.locked ? t('phos', 'Ciphered: the key is not on the server yet') : m.name">
									<NcIconSvgWrapper v-if="m.locked" :path="iconLock" :size="16" />
									<span class="library__desc">{{ m.description || m.name }}</span>
									<span v-if="m.description && m.description !== m.name" class="library__name">{{ m.name }}</span>
									<NcIconSvgWrapper v-if="m.shared" :path="iconPerson" :size="16" :title="t('phos', 'Shared with you')" />
								</component>
							</li>
						</ul>
					</li>
				</ul>
			</li>
		</ul>
	</div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { t } from '@nextcloud/l10n'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { modules, state, prefs, lang, LIBRARY_GROUPS, libraryGroup, moduleRoute } from '../services/phos.js'
import * as I from '../icons.js'

/**
 * The library like the desktop's tree: group → language → module. Reading
 * plans live on their own page, as on the desktop.
 */
const iconDown = I.iconExpand
const iconNext = I.iconNext
const iconLock = I.iconLock
const iconPerson = I.iconPerson

const GROUPS = {
	bible: { label: t('phos', 'Bible'), icon: I.iconBible },
	commentary: { label: t('phos', 'Commentaries'), icon: I.iconCommentary },
	book: { label: t('phos', 'Books'), icon: I.iconBook },
	dictionary: { label: t('phos', 'Lexicons and dictionaries'), icon: I.iconDictionary },
	map: { label: t('phos', 'Maps and pictures'), icon: I.iconMap },
}

const filter = ref('')
const open = reactive(new Set(prefs.get('libraryOpen', ['g:bible'])))
watch(open, () => prefs.set('libraryOpen', [...open]), { deep: true })

let names = null
function langName(code) {
	try {
		names ??= new Intl.DisplayNames([lang], { type: 'language' })
		return names.of(code) || code
	} catch {
		return code
	}
}

const tree = computed(() => {
	const f = filter.value.trim().toLowerCase()
	const groups = new Map(LIBRARY_GROUPS.map(id => [id, new Map()]))
	for (const m of modules.value) {
		if (m.readingPlan) {
			continue
		}
		if (f && !`${m.name} ${m.description}`.toLowerCase().includes(f)) {
			continue
		}
		const g = groups.get(libraryGroup(m))
		const code = (m.lang || 'und').split('-')[0]
		if (!g.has(code)) {
			g.set(code, [])
		}
		g.get(code).push({ ...m, route: moduleRoute(m), shared: m.collection !== state.personal })
	}
	const out = []
	for (const [id, langs] of groups) {
		if (!langs.size) {
			continue
		}
		const ls = [...langs].map(([code, mods]) => ({
			id: `l:${id}:${code}`,
			label: langName(code),
			own: code === lang.split(/[-_]/)[0],
			modules: mods.sort((a, b) => (a.description || a.name).localeCompare(b.description || b.name, lang)),
		})).sort((a, b) => (b.own - a.own) || a.label.localeCompare(b.label, lang))
		out.push({ id: `g:${id}`, ...GROUPS[id], langs: ls, count: ls.reduce((n, l) => n + l.modules.length, 0) })
	}
	return out
})

// while filtering, everything that matches is shown
const isOpen = id => !!filter.value.trim() || open.has(id)
function toggle(id) {
	open.has(id) ? open.delete(id) : open.add(id)
}
</script>

<style scoped lang="scss">
.library {
	&__head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 16px;
		margin-bottom: 8px;

		h2 {
			margin: 0;
		}
	}

	&__filter {
		max-width: 300px;
	}

	&__tree,
	&__tree ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	&__tree ul {
		padding-left: 22px;
	}

	&__node {
		all: unset;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		min-height: 34px;
		padding: 2px 8px;
		border-radius: var(--border-radius-element, 8px);
		cursor: pointer;
		color: var(--color-main-text);

		&:hover,
		&:focus-visible {
			background: var(--color-background-hover);
		}

		&--group {
			font-weight: bold;
			font-size: 1.05em;
		}

		&--module {
			padding-left: 30px;
		}

		&--off {
			cursor: default;
			color: var(--color-text-maxcontrast);
		}
	}

	&__count,
	&__name {
		color: var(--color-text-maxcontrast);
		font-size: 0.9em;
		font-weight: normal;
	}

	&__count {
		margin-left: auto;
	}

	&__desc {
		overflow: hidden;
		text-overflow: ellipsis;
	}
}
</style>
