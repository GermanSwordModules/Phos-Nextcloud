<template>
	<!-- eslint-disable-next-line vue/no-v-html -- sanitized by DOMPurify -->
	<div class="phos-markdown" v-html="html" />
</template>

<script setup>
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps({ text: { type: String, default: '' } })
const html = computed(() => DOMPurify.sanitize(marked.parse(props.text || '', { breaks: true, gfm: true })))
</script>
