<template>
	<div class="phos-page shared">
		<h2>{{ t('phos', 'Shared') }}</h2>
		<p class="shared__intro">
			{{ t('phos', 'Shared collections hold labels with their bookmarks, projects, modules and more. Projects, presentations, sermons, exegeses, e-books and modules go into a collection with “Share …” on their page (labels from Phos Desktop); here you manage who takes part.') }}
		</p>
		<form class="shared__new" @submit.prevent="create">
			<NcTextField v-model="newName" :label="t('phos', 'New shared collection')" />
			<NcButton type="submit" :disabled="!newName.trim()">
				<template #icon>
					<NcIconSvgWrapper :path="iconAdd" />
				</template>
				{{ t('phos', 'Create') }}
			</NcButton>
		</form>
		<NcLoadingIcon v-if="loading" />
		<NcEmptyContent v-else-if="!shared.length" :name="t('phos', 'Nothing shared yet')" />
		<section v-for="c in shared"
			:id="'coll-' + c.id"
			:key="c.id"
			class="shared__coll"
			:class="{ 'shared__coll--focus': c.id === route.query.c }">
			<header class="shared__head">
				<h3>{{ c.name || t('phos', 'Unnamed') }}</h3>
				<span class="shared__owner">
					{{ c.owner === me ? t('phos', 'yours') : t('phos', 'shared by {owner}', { owner: c.ownerName }) }} · {{ permLabel(c.perm) }}
				</span>
				<NcActions>
					<NcActionButton v-if="c.perm === 'admin'" @click="rename(c)">
						<template #icon>
							<NcIconSvgWrapper :path="iconEdit" />
						</template>
						{{ t('phos', 'Rename') }}
					</NcActionButton>
					<NcActionButton v-if="c.owner === me" @click="destroy(c)">
						<template #icon>
							<NcIconSvgWrapper :path="iconDelete" />
						</template>
						{{ t('phos', 'Delete collection') }}
					</NcActionButton>
					<NcActionButton v-else @click="leave(c)">
						<template #icon>
							<NcIconSvgWrapper :path="iconClose" />
						</template>
						{{ t('phos', 'Leave') }}
					</NcActionButton>
				</NcActions>
			</header>
			<div class="shared__content">
				<span v-for="l in labelsOf(c)" :key="l.name" class="phos-chip" :style="{ '--phos-chip': l.color }">
					<router-link :to="{ name: 'pads', params: { label: c.id + '|' + l.name } }">{{ labelDisplay(l.name) }}</router-link>
				</span>
				<span v-if="countOf(c)" class="shared__count">{{ n('phos', '%n bookmark', '%n bookmarks', countOf(c)) }}</span>
			</div>
			<ul v-if="itemsOf(c).length" class="shared__items">
				<li v-for="it in itemsOf(c)" :key="it.type + it.key">
					<span class="shared__kind">{{ kindLabel(it.type) }}</span>
					<router-link v-if="it.to" :to="it.to">
						{{ it.title }}
					</router-link>
					<span v-else>{{ it.title }}</span>
					<NcButton v-if="c.owner === me"
						variant="tertiary"
						:aria-label="t('phos', 'Take out of the collection')"
						:title="t('phos', 'Take out of the collection')"
						@click="takeOut(it)">
						<template #icon>
							<NcIconSvgWrapper :path="iconClose" :size="18" />
						</template>
					</NcButton>
				</li>
			</ul>
			<div v-if="members[c.id]" class="shared__members">
				<h4>{{ t('phos', 'Members') }}</h4>
				<ul>
					<li v-for="m in members[c.id]" :key="m.ptype + m.pid" class="shared__member">
						<NcAvatar v-if="m.ptype === 'user'" :user="m.pid" :display-name="m.displayName" :size="24" />
						<span class="shared__mname">{{ m.displayName }}<template v-if="m.ptype !== 'user'"> ({{ m.ptype === 'group' ? t('phos', 'group') : t('phos', 'team') }})</template></span>
						<select v-if="c.perm === 'admin'" :value="m.perm" @change="e => setPerm(c, m, e.target.value)">
							<option value="read">{{ permLabel('read') }}</option>
							<option value="write">{{ permLabel('write') }}</option>
							<option value="admin">{{ permLabel('admin') }}</option>
						</select>
						<span v-else>{{ permLabel(m.perm) }}</span>
						<NcButton v-if="c.perm === 'admin'" variant="tertiary" :aria-label="t('phos', 'Remove member')" @click="removeMember(c, m)">
							<template #icon>
								<NcIconSvgWrapper :path="iconClose" />
							</template>
						</NcButton>
					</li>
				</ul>
				<div v-if="c.perm === 'admin'" class="shared__add">
					<NcSelect v-model="pick[c.id]"
						:options="sharees"
						:loading="searching"
						:filterable="false"
						:input-label="t('phos', 'Add person, group or team')"
						label="label"
						@search="search" />
					<select v-model="pickPerm[c.id]">
						<option value="read">{{ permLabel('read') }}</option>
						<option value="write">{{ permLabel('write') }}</option>
						<option value="admin">{{ permLabel('admin') }}</option>
					</select>
					<NcButton :disabled="!pick[c.id]" @click="addMember(c)">
						{{ t('phos', 'Add') }}
					</NcButton>
				</div>
			</div>
		</section>
	</div>
</template>

<script setup>
import { computed, nextTick, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { t, n } from '@nextcloud/l10n'
import { getCurrentUser } from '@nextcloud/auth'
import { showError } from '@nextcloud/dialogs'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcActions from '@nextcloud/vue/components/NcActions'
import NcActionButton from '@nextcloud/vue/components/NcActionButton'
import NcAvatar from '@nextcloud/vue/components/NcAvatar'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import { http } from '../services/api.js'
import { engine, labels, labelDisplay, bookmarks, modules, loadModules, lang } from '../services/phos.js'
import { iconAdd, iconClose, iconDelete, iconEdit } from '../icons.js'
import { projects, decks, sermons, exegeses, ebooks, pericopeRef } from '../services/docs.js'
import { unshareItem } from '../services/share.js'

const route = useRoute()

const me = getCurrentUser()?.uid
const collections = ref([])
const members = reactive({})
const loading = ref(true)
const newName = ref('')
const sharees = ref([])
const searching = ref(false)
const pick = reactive({})
const pickPerm = reactive({})

const shared = computed(() => collections.value.filter(c => c.kind !== 'personal'))
const permLabel = p => ({ read: t('phos', 'can read'), write: t('phos', 'can edit'), admin: t('phos', 'can manage') })[p] || p
const labelsOf = c => labels.value.filter(l => l.collection === c.id)
const countOf = c => bookmarks.value.filter(b => b.collection === c.id).length
const KINDS = {
	project: () => t('phos', 'Project'), presentation: () => t('phos', 'Presentation'), sermon: () => t('phos', 'Sermon'),
	pericope: () => t('phos', 'Exegesis'), ebook: () => t('phos', 'E-book'), module: () => t('phos', 'Module'),
}
const kindLabel = k => (KINDS[k] || (() => k))()
/** what the collection holds besides labels: {type, key, collection, title, to} */
const itemsOf = c => [
	...projects.value.filter(x => x.collection === c.id).map(x => ({ type: 'project', key: x.key, collection: c.id, title: x.title, to: { name: 'projects', params: { id: x.id } } })),
	...decks.value.filter(x => x.collection === c.id).map(x => ({ type: 'presentation', key: x.key, collection: c.id, title: x.title, to: { name: 'decks', params: { id: x.id } } })),
	...sermons.value.filter(x => x.collection === c.id).map(x => ({ type: 'sermon', key: x.key, collection: c.id, title: x.title || t('phos', '(untitled)'), to: { name: 'sermons', params: { id: x.id } } })),
	...exegeses.value.filter(x => x.collection === c.id).map(x => ({ type: 'pericope', key: x.key, collection: c.id, title: x.title || pericopeRef(x.p, lang), to: { name: 'exegesis', params: { id: x.id } } })),
	...ebooks.value.filter(x => x.collection === c.id).map(x => ({ type: 'ebook', key: x.key, collection: c.id, title: x.ref, to: { name: 'ebooks', params: { ref: x.ref } } })),
	...modules.value.filter(m => m.collection === c.id).map(m => ({ type: 'module', key: 'module:' + m.name, collection: c.id, title: m.description || m.name, to: null })),
]
const takeOut = it => confirm(t('phos', 'Take “{title}” out of the collection? It is yours alone again; members lose it.', { title: it.title }))
	&& act(() => unshareItem(it))

async function load() {
	try {
		collections.value = (await http.get('/collections')).collections
		await Promise.all(shared.value.map(async c => {
			try {
				members[c.id] = (await http.get(`/collections/${c.id}/members`)).members
			} catch {
				members[c.id] = []
			}
			pickPerm[c.id] ??= 'read'
		}))
	} catch (e) {
		showError(e.message)
	} finally {
		loading.value = false
	}
}

async function act(fn) {
	try {
		await fn()
		await load()
		await engine.sync()
		await loadModules()
	} catch (e) {
		showError(e.message)
	}
}

const create = () => act(async () => {
	await http.post('/collections', { name: newName.value.trim() })
	newName.value = ''
})
const rename = c => {
	const name = prompt(t('phos', 'New name'), c.name || '')
	if (name?.trim()) {
		act(() => http.put(`/collections/${c.id}`, { name: name.trim() }))
	}
}
const destroy = c => confirm(t('phos', 'Delete “{name}” with everything in it, for all members?', { name: c.name })) && act(() => http.del(`/collections/${c.id}`))
const leave = c => confirm(t('phos', 'Leave “{name}”? Its content disappears from your devices.', { name: c.name })) && act(() => http.del(`/collections/${c.id}/members/user/${encodeURIComponent(me)}`))
const removeMember = (c, m) => act(() => http.del(`/collections/${c.id}/members/${m.ptype}/${encodeURIComponent(m.pid)}`))
const setPerm = (c, m, perm) => act(() => http.post(`/collections/${c.id}/members`, { type: m.ptype, id: m.pid, perm }))
const addMember = c => act(async () => {
	await http.post(`/collections/${c.id}/members`, { type: pick[c.id].type, id: pick[c.id].id, perm: pickPerm[c.id] })
	pick[c.id] = null
})

let searchTimer = null
function search(q) {
	clearTimeout(searchTimer)
	if (!q) {
		return
	}
	searchTimer = setTimeout(async () => {
		searching.value = true
		try {
			sharees.value = (await http.get('/sharees', { search: q })).sharees.map(s => ({
				...s, label: s.type === 'user' ? s.label : `${s.label} (${s.type === 'group' ? t('phos', 'group') : t('phos', 'team')})`,
			}))
		} finally {
			searching.value = false
		}
	}, 300)
}

load()
</script>

<style scoped lang="scss">
.shared {
	&__intro {
		color: var(--color-text-maxcontrast);
		max-width: 700px;
	}

	&__new {
		display: flex;
		gap: 8px;
		align-items: flex-end;
		max-width: 480px;
		margin: 12px 0 20px;

		> button {
			flex-shrink: 0;
		}
	}

	&__coll {
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-large);
		padding: 10px 16px;
		margin-bottom: 14px;
	}

	&__coll--focus {
		border-color: var(--color-primary-element);
		box-shadow: 0 0 0 1px var(--color-primary-element);
	}

	&__items {
		margin: 4px 0;
		padding: 0;
		list-style: none;

		li {
			display: flex;
			align-items: center;
			gap: 8px;
			min-height: 36px;
		}

		a {
			text-decoration: underline;
		}
	}

	&__kind {
		color: var(--color-text-maxcontrast);
		min-width: 110px;
	}

	&__head {
		display: flex;
		align-items: center;
		gap: 10px;

		h3 {
			font-weight: bold;
			font-size: 1.1em;
		}
	}

	&__owner,
	&__count {
		color: var(--color-text-maxcontrast);
		flex: 1;
	}

	&__content {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 6px 0;
		align-items: center;
	}

	&__members h4 {
		font-weight: bold;
		margin-top: 8px;
		color: var(--color-text-maxcontrast);
	}

	&__member {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 0;
	}

	&__mname {
		min-width: 180px;
	}

	&__add {
		display: flex;
		gap: 8px;
		align-items: flex-end;
		flex-wrap: wrap;
		margin-top: 8px;

		> :first-child {
			min-width: 260px;
		}
	}
}
</style>
