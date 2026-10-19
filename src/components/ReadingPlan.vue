<template>
	<div class="plan" :class="{ 'plan--compact': compact }">
		<NcEmptyContent v-if="!plans.length"
			:name="t('phos', 'No reading plan on the server')"
			:description="t('phos', 'Reading plans are modules too: sync one from Phos Desktop (e.g. a daily watchword or Bible-in-a-year plan).')" />
		<template v-else>
			<div class="plan__top">
				<NcSelect v-model="planSel" :options="planOptions" :clearable="false" :input-label="t('phos', 'Plan')" label="label" class="plan__select" />
				<NcSelect v-if="!compact" v-model="bibleSel" :options="bibleOptions" :clearable="false" :input-label="t('phos', 'Bible')" label="label" class="plan__select" />
				<NcButton v-if="todayIdx >= 0 && todayIdx !== dayIdx" @click="dayIdx = todayIdx">
					<template #icon>
						<NcIconSvgWrapper :path="iconToday" />
					</template>
					{{ t('phos', 'Today') }}
				</NcButton>
			</div>
			<NcEmptyContent v-if="error" :name="t('phos', 'The plan cannot be read')" :description="error" />
			<div v-else-if="plan" class="plan__body">
				<ol v-if="!compact" class="plan__days" role="listbox" :aria-label="t('phos', 'Days')">
					<li v-for="(d, i) in plan.days"
						:key="d.day"
						:ref="el => { if (i === dayIdx) currentDayEl = el }"
						role="option"
						:aria-selected="i === dayIdx"
						class="plan__day"
						:class="{ 'plan__day--done': isDone(d.day), 'plan__day--current': i === dayIdx }"
						@click="dayIdx = i">
						<NcIconSvgWrapper v-if="isDone(d.day)" :path="iconCheck" :size="16" />
						<span>{{ dayTitle(d) }}</span>
					</li>
				</ol>
				<div v-if="day" class="plan__content">
					<div class="plan__dayhead">
						<NcButton v-if="compact"
							variant="tertiary"
							:disabled="dayIdx <= 0"
							:aria-label="t('phos', 'Previous day')"
							@click="dayIdx--">
							<template #icon>
								<NcIconSvgWrapper :path="iconPrev" />
							</template>
						</NcButton>
						<h3>
							<NcIconSvgWrapper v-if="compact && isDone(day.day)" :path="iconCheck" :size="18" class="plan__donemark" />
							{{ dayTitle(day) }}
						</h3>
						<NcButton v-if="compact"
							variant="tertiary"
							:disabled="dayIdx >= plan.days.length - 1"
							:aria-label="t('phos', 'Next day')"
							@click="dayIdx++">
							<template #icon>
								<NcIconSvgWrapper :path="iconNext" />
							</template>
						</NcButton>
					</div>
					<template v-for="(item, i) in day.seq" :key="i">
						<div v-if="refIndex(i) >= 0" class="plan__card">
							<NcCheckboxRadioSwitch :model-value="checks[refIndex(i)] || false" @update:model-value="v => check(refIndex(i), v)">
								<a href="#" class="plan__ref" @click.prevent.stop="open(item)">{{ refLabel(item) }}</a>
							</NcCheckboxRadioSwitch>
							<PassageText v-if="!compact && parsed(item)" :module="bibleName" :passage="parsed(item)" @ref="open" />
						</div>
						<p v-else class="plan__text">
							{{ item }}
						</p>
					</template>
					<div class="plan__done">
						<NcButton v-if="!isDone(day.day)" variant="primary" @click="markDone">
							<template #icon>
								<NcIconSvgWrapper :path="iconCheck" />
							</template>
							{{ t('phos', 'Done') }}
						</NcButton>
						<NcButton v-else @click="unmark">
							{{ t('phos', 'Mark as not done') }}
						</NcButton>
						<span class="plan__count">{{ t('phos', '{done} of {all} days done', { done: progress.doneDays?.length || 0, all: plan.days.length }) }}</span>
					</div>
				</div>
			</div>
			<div v-else class="plan__loading">
				<NcLoadingIcon :size="32" />
			</div>
		</template>
	</div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { t } from '@nextcloud/l10n'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcIconSvgWrapper from '@nextcloud/vue/components/NcIconSvgWrapper'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import PassageText from './PassageText.vue'
import { plans, bibles, getPlan, engine, setting, defaultBible, prefs, lang } from '../services/phos.js'
import { formatRef, parseRef } from '../bible/books.js'
import { iconCheck, iconToday, iconPrev, iconNext } from '../icons.js'

/**
 * A reading plan: pick the plan, see a day, tick passages, mark it done.
 * The full form (Reading plan page) lists the days and shows the passages'
 * text; the compact one (Bible reading page) steps through days and leaves
 * the text to the Bible next to it — `open` hands a passage over.
 */
const props = defineProps({
	module: { type: String, default: null },    // plan asked for (e.g. by the route)
	compact: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'select'])

const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const plan = ref(null)
const error = ref('')
const dayIdx = ref(-1)
let currentDayEl = null

const chosen = ref(prefs.get('plan', null))
const planOptions = computed(() => plans.value.map(m => ({ id: m.name, label: m.description || m.name })))
const planName = computed(() => {
	const names = plans.value.map(m => m.name)
	const want = [props.module, chosen.value, setting('General.ReadingPlanModule')]
	return want.find(n => n && names.includes(n)) || names[0] || null
})
const planSel = computed({
	get: () => planOptions.value.find(o => o.id === planName.value) || null,
	set: o => { chosen.value = o.id; prefs.set('plan', o.id); emit('select', o.id) },
})
const bibleOptions = computed(() => bibles.value.filter(m => !m.locked).map(m => ({ id: m.name, label: `${m.name} – ${m.description}` })))
const bibleName = ref(prefs.get('planBible', null) || setting('General.ReadingPlanBible') || defaultBible())
const bibleSel = computed({
	get: () => bibleOptions.value.find(o => o.id === bibleName.value) || null,
	set: o => { bibleName.value = o.id; prefs.set('planBible', o.id) },
})

const progress = computed(() => engine.get('planProgress', 'plan:' + planName.value)?.payload || {})
const isDone = d => (progress.value.doneDays || []).includes(d)
const day = computed(() => plan.value?.days[dayIdx.value] || null)
const checks = computed(() => progress.value.checks?.[String(day.value?.day)] || [])

const todayIdx = computed(() => {
	if (!plan.value?.dateBased) {
		return -1
	}
	const now = new Date()
	const label = `${MONS[now.getMonth()]}-${now.getDate()}`
	return plan.value.days.findIndex(d => d.date.toLowerCase() === label.toLowerCase())
})

function pickInitialDay() {
	if (todayIdx.value >= 0) {
		return todayIdx.value
	}
	const i = plan.value.days.findIndex(d => !isDone(d.day))
	return i >= 0 ? i : plan.value.days.length - 1
}

function dayTitle(d) {
	if (d.date) {
		const [m, n] = d.date.split('-')
		const mi = MONS.findIndex(x => x.toLowerCase() === m.toLowerCase())
		if (mi >= 0) {
			return new Date(2000, mi, Number(n)).toLocaleDateString(lang, { day: 'numeric', month: 'long' })
		}
	}
	return t('phos', 'Day {n}', { n: d.day })
}

const parsedCache = new Map()
function parsed(item) {
	if (!parsedCache.has(item)) {
		// plan files use OSIS refs; anything else in a day's sequence is text
		const osis = /^[1-4]?\p{L}+\.\d+(\.\d+)?(-([1-4]?\p{L}+\.)?\d+(\.\d+)?)?$/u.test(item.trim())
		parsedCache.set(item, osis ? parseRef(item.trim()) : null)
	}
	return parsedCache.get(item)
}

/** Position among the day's passages (check marks are per passage), -1 for text. */
function refIndex(i) {
	if (!parsed(day.value.seq[i])) {
		return -1
	}
	return day.value.seq.slice(0, i).filter(x => parsed(x)).length
}

function refLabel(item) {
	const p = parsed(item)
	return p ? formatRef(p, lang) : item
}

function open(item) {
	const p = typeof item === 'string' ? parseRef(item) : item
	if (p) {
		emit('open', p, bibleName.value)
	}
}

function writeProgress(change) {
	const cur = progress.value
	const next = { startDate: cur.startDate || new Date().toISOString().slice(0, 10), doneDays: [...(cur.doneDays || [])], checks: { ...(cur.checks || {}) }, ...change }
	engine.write('planProgress', 'plan:' + planName.value, next)
}

function check(i, v) {
	const n = day.value.seq.filter(x => parsed(x)).length
	const arr = Array.from({ length: n }, (_, k) => k === i ? v : !!checks.value[k])
	writeProgress({ checks: { ...(progress.value.checks || {}), [String(day.value.day)]: arr } })
}

function markDone() {
	const d = day.value.day
	const n = day.value.seq.filter(x => parsed(x)).length
	writeProgress({
		doneDays: [...new Set([...(progress.value.doneDays || []), d])],
		checks: { ...(progress.value.checks || {}), [String(d)]: Array(n).fill(true) },
	})
	const next = plan.value.days.findIndex((x, i) => i > dayIdx.value && !isDone(x.day) && x.day !== d)
	if (next >= 0 && !plan.value.dateBased) {
		dayIdx.value = next
	}
}

function unmark() {
	writeProgress({ doneDays: (progress.value.doneDays || []).filter(x => x !== day.value.day) })
}

watch(planName, async name => {
	plan.value = null
	error.value = ''
	if (!name) {
		return
	}
	try {
		plan.value = await getPlan(name)
		dayIdx.value = pickInitialDay()
		await nextTick()
		currentDayEl?.scrollIntoView({ block: 'center' })
	} catch (e) {
		error.value = e.message
	}
}, { immediate: true })
</script>

<style scoped lang="scss">
.plan {
	&__top {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
		margin-bottom: 12px;
	}

	&__select {
		min-width: 260px;
	}

	&__body {
		display: flex;
		gap: 20px;
		align-items: flex-start;
	}

	&__days {
		list-style: none;
		width: 180px;
		flex: 0 0 180px;
		max-height: 70vh;
		overflow-y: auto;
		border-right: 1px solid var(--color-border);
		padding: 0;
	}

	&__day {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		cursor: pointer;
		border-radius: var(--border-radius);

		&:hover {
			background: var(--color-background-hover);
		}

		&--done {
			color: var(--color-success-text);
		}

		&--current {
			background: var(--color-primary-element-light);
			font-weight: bold;
		}
	}

	&__content {
		flex: 1;
		min-width: 0;
	}

	&__dayhead {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 10px;

		h3 {
			font-size: 1.2em;
			font-weight: bold;
			margin: 0;
			display: flex;
			align-items: center;
			gap: 4px;
		}
	}

	&__donemark {
		color: var(--color-success-text);
	}

	&__card {
		border: 1px solid var(--color-border);
		border-radius: var(--border-radius-large);
		padding: 6px 12px 10px;
		margin-bottom: 10px;
	}

	&__ref {
		font-weight: bold;
		color: var(--color-main-text);
	}

	&__text {
		margin: 8px 0 12px;
		white-space: pre-line;
	}

	&__done {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
		margin-top: 14px;
	}

	&__count {
		color: var(--color-text-maxcontrast);
	}

	&__loading {
		display: flex;
		justify-content: center;
		padding: 40px;
	}

	&--compact {
		.plan__select {
			min-width: 0;
			flex: 1 1 200px;
		}

		.plan__dayhead {
			justify-content: space-between;

			h3 {
				font-size: 1.05em;
			}
		}

		.plan__card {
			padding: 2px 10px;
			margin-bottom: 6px;
		}

		.plan__done {
			margin-top: 8px;
		}
	}
}

@media (max-width: 700px) {
	.plan__body {
		flex-direction: column;
	}

	.plan__days {
		width: 100%;
		flex-basis: auto;
		max-height: 30vh;
		border-right: none;
	}
}
</style>
