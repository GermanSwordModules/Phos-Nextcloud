<template>
	<div class="phos-page">
		<h2>{{ t('phos', 'Reading plan') }}</h2>
		<ReadingPlan :module="route.params.module || null" @select="select" @open="open" />
	</div>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import { t } from '@nextcloud/l10n'
import ReadingPlan from '../components/ReadingPlan.vue'

const route = useRoute()
const router = useRouter()

function select(name) {
	router.replace({ name: 'plan', params: { module: name } })
}

function open(p, bible) {
	router.push({ name: 'bible', params: { module: bible, book: p.book, chapter: p.c1 }, query: p.v1 ? { v: p.v1 } : {} })
}
</script>
