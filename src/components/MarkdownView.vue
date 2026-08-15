<script setup>
// Markdown 渲染：marked 解析 + DOMPurify 消毒（多用户内容必须防 XSS）
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps({
  source: { type: String, default: '' },
})

const html = computed(() =>
  DOMPurify.sanitize(marked.parse(props.source, { gfm: true, breaks: true }))
)
</script>

<template>
  <div class="markdown-body" v-html="html" />
</template>

<style scoped>
.markdown-body {
  font-size: 15px;
  line-height: 1.75;
  word-wrap: break-word;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin: 1.2em 0 0.5em;
  line-height: 1.3;
}

.markdown-body :deep(h1) {
  font-size: 22px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.markdown-body :deep(h2) {
  font-size: 18px;
}

.markdown-body :deep(h3) {
  font-size: 16px;
}

.markdown-body :deep(p) {
  margin: 0.7em 0;
}

.markdown-body :deep(a) {
  color: var(--accent);
}

.markdown-body :deep(code) {
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 0.9em;
  background: var(--panel-2);
}

.markdown-body :deep(pre) {
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--panel-2);
  overflow-x: auto;
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-body :deep(blockquote) {
  margin: 0.7em 0;
  padding: 2px 14px;
  border-left: 3px solid var(--accent);
  color: var(--muted);
}

.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 0.8em 0;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 6px 12px;
  border: 1px solid var(--border);
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.6em;
}

.markdown-body :deep(img) {
  max-width: 100%;
}
</style>
