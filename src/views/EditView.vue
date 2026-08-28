<script setup>
// 新建/编辑文章（博客与 Wiki 共用，category 由路由 props 传入）
// 两种正文编辑模式：Markdown（源码 + 工具栏 + 实时预览）/ 所见即所得（TipTap）
// 存储格式跟随模式：md 存 content_md，html 存 content_html；切换时相互转换
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createPost, getPostBySlug, updatePost, uploadImage } from '../api/posts'
import { useAuth } from '../composables/useAuth'
import MarkdownView from '../components/MarkdownView.vue'
import RichTextEditor from '../components/RichTextEditor.vue'
import MdToolbar from '../components/MdToolbar.vue'
import HtmlDocView from '../components/HtmlDocView.vue'
import AppIcon from '../components/AppIcon.vue'
import { marked } from 'marked'
import TurndownService from 'turndown'

const props = defineProps({
  category: { type: String, required: true }, // 'blog' | 'wiki'
})

const route = useRoute()
const router = useRouter()
const { isLoggedIn } = useAuth()

const slug = computed(() => (route.name.endsWith('-new') ? null : route.params.slug))
const postId = ref(null)

const isEdit = computed(() => !!slug.value)
const loading = ref(!!slug.value) // 编辑模式需要拉取原内容
const saving = ref(false)
const error = ref('')
const uploading = ref(false)

// 编辑模式：md（Markdown）| html（所见即所得）| raw（HTML 源码）；新建时记住上次选择
const MODE_KEY = 'anihub.editor-mode'
const mode = ref(localStorage.getItem(MODE_KEY) === 'html' ? 'html' : localStorage.getItem(MODE_KEY) === 'raw' ? 'raw' : 'md')

// 完整 HTML 文档判定（独立页面，带 <!DOCTYPE html>/<html>）
const isFullDoc = (s) => /^\s*(<!DOCTYPE[^>]*>)?\s*<html[\s>]/i.test(s || '')

const form = ref({
  title: '',
  slug: '',
  summary: '',
  content_md: '',
  content_html: '',
  tags: '',
  visibility: 'public',
})
const fileInput = ref(null)
const mdInput = ref(null)

// —— 格式转换 ——
// Markdown → HTML（与 MarkdownView 渲染同配置）
function mdToHtml(src) {
  return marked.parse(src || '', { gfm: true, breaks: true })
}

// HTML → Markdown：带样式的 span（字号/颜色）保留为行内 HTML，其余 span 展开
// 注意：turndown 规则后添加者优先，故先加通用 span 规则、再加带样式的
let turndown = null
function htmlToMd(html) {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    })
    turndown.addRule('plainSpan', { filter: 'span', replacement: (content) => content })
    turndown.addRule('styledSpan', {
      filter: (node) => node.nodeName === 'SPAN' && !!node.getAttribute('style'),
      replacement: (content, node) => `<span style="${node.getAttribute('style')}">${content}</span>`,
    })
  }
  return turndown.turndown(html || '')
}

async function loadExisting() {
  if (!slug.value) return
  try {
    const post = await getPostBySlug(slug.value)
    if (post.category !== props.category) {
      router.replace(`/${post.category}/${post.slug}/edit`)
      return
    }
    postId.value = post.id
    form.value = {
      title: post.title,
      slug: post.slug,
      summary: post.summary,
      content_md: post.contentMd || '',
      content_html: post.contentHtml || '',
      tags: post.tags.join('，'),
      visibility: post.visibility || 'public',
    }
    // 完整 HTML 文档用源码模式编辑（所见即所得会破坏 <head>/<style>/<script>）
    if (post.format === 'html') mode.value = isFullDoc(post.contentHtml) ? 'raw' : 'html'
    else mode.value = 'md'
    localStorage.setItem(MODE_KEY, mode.value)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => route.params.slug, loadExisting, { immediate: true })

// —— 模式切换（md / html / raw 相互转换）——
function switchMode(next) {
  if (next === mode.value) return
  const cur = mode.value
  if (next === 'md') {
    form.value.content_md = htmlToMd(form.value.content_html) // html / raw → md
  } else if (next === 'html') {
    if (cur === 'md') form.value.content_html = mdToHtml(form.value.content_md)
    // raw → html：内容已是 HTML，直接切换
  } else if (next === 'raw') {
    if (cur === 'md') form.value.content_html = mdToHtml(form.value.content_md)
    // html → raw：内容已是 HTML，直接切换
  }
  mode.value = next
  localStorage.setItem(MODE_KEY, next)
}

// —— Markdown 工具栏命令 ——
function onMdCmd({ type, value }) {
  switch (type) {
    case 'bold': wrapSelection('**', '**', '粗体'); break
    case 'italic': wrapSelection('*', '*', '斜体'); break
    case 'strike': wrapSelection('~~', '~~', '删除线'); break
    case 'code': wrapSelection('`', '`', '代码'); break
    case 'code-block': wrapSelection('\n```\n', '\n```\n', '代码'); break
    case 'h1': case 'h2': case 'h3': prefixLines('#'.repeat(Number(type[1])) + ' '); break
    case 'quote': prefixLines('> '); break
    case 'ul': prefixLines('- '); break
    case 'ol': prefixLines('1. '); break
    case 'link': onInsertLink(); break
    case 'image': fileInput.value?.click(); break
    case 'font-size': wrapSelection(`<span style="font-size:${value}px">`, '</span>', '文字'); break
    case 'color': wrapSelection(`<span style="color:${value}">`, '</span>', '文字'); break
  }
}

// 行内包裹选区（无选区时插入占位并选中）
function wrapSelection(before, after, placeholder) {
  const ta = mdInput.value
  if (!ta) return
  const start = ta.selectionStart ?? form.value.content_md.length
  const end = ta.selectionEnd ?? start
  const sel = form.value.content_md.slice(start, end)
  const inner = sel || placeholder
  form.value.content_md = form.value.content_md.slice(0, start) + before + inner + after + form.value.content_md.slice(end)
  ta.focus()
  const p = start + before.length
  ta.setSelectionRange(p, p + inner.length)
}

// 行首前缀（标题/引用/列表）：对选区涉及的行批量加前缀，已全部加过则撤销
function prefixLines(prefix) {
  const ta = mdInput.value
  if (!ta) return
  const md = form.value.content_md
  const start = ta.selectionStart ?? 0
  const end = ta.selectionEnd ?? start
  const lineStart = md.lastIndexOf('\n', start - 1) + 1
  let lineEnd = md.indexOf('\n', end)
  if (lineEnd === -1) lineEnd = md.length
  const block = md.slice(lineStart, lineEnd)
  const lines = block.split('\n')
  const allPrefixed = lines.length > 0 && lines.every((l) => l.startsWith(prefix))
  const next = lines
    .map((l) => (allPrefixed ? l.slice(prefix.length) : l.startsWith(prefix) ? l : prefix + l))
    .join('\n')
  form.value.content_md = md.slice(0, lineStart) + next + md.slice(lineEnd)
  ta.focus()
  ta.setSelectionRange(lineStart, lineStart + next.length)
}

// 插入链接
function onInsertLink() {
  const ta = mdInput.value
  const start = ta?.selectionStart ?? 0
  const end = ta?.selectionEnd ?? start
  const url = window.prompt('链接地址（https://…）')
  if (!url) return
  const sel = form.value.content_md.slice(start, end) || '链接'
  const text = window.prompt('链接文字', sel) || sel
  const insert = `[${text}](${url})`
  form.value.content_md = form.value.content_md.slice(0, start) + insert + form.value.content_md.slice(end)
  ta?.focus()
  ta?.setSelectionRange(start + insert.length, start + insert.length)
}

function parseTags() {
  return form.value.tags
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

// 选择图片 → 上传 → 插入（Markdown 模式在光标处插入图片语法；富文本模式由 RichTextEditor 自行处理）
function onPickImage(e) {
  const file = e.target.files?.[0]
  e.target.value = '' // 允许重复选择同一文件
  if (file) insertMdImage(file)
}

// 粘贴剪贴板中的图片（Ctrl+C 复制的图片 / 截图）→ 上传并插入；普通文本粘贴不受影响
function onPasteImage(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (!file) return
      e.preventDefault() // 拦下默认粘贴，避免图片被当文本贴进去
      insertMdImage(file)
      return
    }
  }
}

async function insertMdImage(file) {
  uploading.value = true
  error.value = ''
  try {
    const { url } = await uploadImage(file)
    const md = `![图片](${url})`
    const ta = mdInput.value
    const start = ta.selectionStart ?? form.value.content_md.length
    const end = ta.selectionEnd ?? start
    form.value.content_md = form.value.content_md.slice(0, start) + md + form.value.content_md.slice(end)
    ta.focus()
    ta.setSelectionRange(start + md.length, start + md.length)
  } catch (err) {
    error.value = err.message
  } finally {
    uploading.value = false
  }
}

async function onSubmit() {
  error.value = ''
  saving.value = true
  const isHtml = mode.value !== 'md' // html / raw 均按 HTML 存储
  const body = {
    category: props.category,
    title: form.value.title.trim(),
    summary: form.value.summary.trim(),
    tags: parseTags(),
    visibility: form.value.visibility,
    format: isHtml ? 'html' : 'md',
    ...(isHtml
      ? { content_html: form.value.content_html }
      : { content_md: form.value.content_md }),
  }
  if (form.value.slug.trim() && form.value.slug.trim() !== form.value.title.trim()) {
    body.slug = form.value.slug.trim()
  }
  try {
    const saved = isEdit.value
      ? await updatePost(postId.value, body)
      : await createPost(body)
    // 跳回文章页，用服务端生成的最终 slug
    router.replace(`/${props.category}/${saved.slug}`)
  } catch (e) {
    error.value = e.message
    saving.value = false
  }
}
</script>

<template>
  <div class="edit-page">
    <h1 class="page-title"><AppIcon name="pen" :size="22" /> {{ isEdit ? '编辑' : '新建' }}{{ category === 'blog' ? '文章' : 'Wiki 条目' }}</h1>
    <p v-if="error" class="edit-error">{{ error }}</p>
    <p v-if="loading" class="edit-hint">加载中…</p>

    <form v-else class="edit-card" @submit.prevent="onSubmit">
      <label class="field">
        <span>标题 *</span>
        <input v-model.trim="form.title" required maxlength="200" />
      </label>
      <label class="field">
        <span>链接别名（留空则按标题自动生成）</span>
        <input v-model.trim="form.slug" maxlength="80" placeholder="例如：2026-summer-anime-guide" />
      </label>
      <label class="field">
        <span>摘要（列表页显示）</span>
        <input v-model.trim="form.summary" maxlength="500" />
      </label>
      <label class="field">
        <span>标签（用逗号或空格分隔）</span>
        <input v-model.trim="form.tags" placeholder="例如：2026夏, 推荐, 攻略" />
      </label>

      <div class="mode-switch">
        <button type="button" class="mode-btn" :class="{ on: mode === 'md' }" @click="switchMode('md')">
          Markdown
        </button>
        <button type="button" class="mode-btn" :class="{ on: mode === 'html' }" @click="switchMode('html')">
          所见即所得
        </button>
        <button type="button" class="mode-btn" :class="{ on: mode === 'raw' }" @click="switchMode('raw')">
          HTML 源码
        </button>
      </div>

      <!-- Markdown 模式：工具栏 + 源码 + 实时预览 -->
      <template v-if="mode === 'md'">
        <MdToolbar @cmd="onMdCmd" />
        <textarea
          ref="mdInput"
          v-model="form.content_md"
          rows="14"
          required
          class="md-input"
          placeholder="支持 Markdown 与行内 HTML（如 <span style=&quot;color:red&quot;>文字</span>）…；Ctrl+V 可直接粘贴剪贴板里的图片"
          @paste="onPasteImage"
        ></textarea>
        <div class="preview">
          <span class="preview-label">预览</span>
          <div class="preview-body">
            <MarkdownView v-if="form.content_md" :source="form.content_md" />
            <p v-else class="edit-hint">（正文为空，预览将显示在此处）</p>
          </div>
        </div>
      </template>

      <!-- 所见即所得模式：TipTap 编辑器（所见即所得，无需额外预览） -->
      <RichTextEditor v-else-if="mode === 'html'" v-model="form.content_html" :image-upload="uploadImage" />

      <!-- HTML 源码模式：原始 HTML（可粘贴完整文档，按原样保存与渲染） -->
      <template v-else-if="mode === 'raw'">
        <textarea
          v-model="form.content_html"
          rows="20"
          spellcheck="false"
          class="md-input raw-input"
          placeholder="粘贴 / 编写原始 HTML，可包含 &lt;style&gt; 与 &lt;script&gt;（完整文档或片段均可）"
        ></textarea>
        <div class="preview">
          <span class="preview-label">预览（完整文档以独立页面渲染）</span>
          <div class="preview-body">
            <HtmlDocView v-if="form.content_html" :source="form.content_html" />
            <p v-else class="edit-hint">（正文为空，预览将显示在此处）</p>
          </div>
        </div>
      </template>

      <input
        ref="fileInput"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        class="file-input"
        @change="onPickImage"
      />

      <fieldset class="vis-group">
        <legend>可见性</legend>
        <label class="vis-opt">
          <input type="radio" value="public" v-model="form.visibility" />
          <span>公开（游客可见）</span>
        </label>
        <label class="vis-opt">
          <input type="radio" value="insider" v-model="form.visibility" />
          <span>仅内部人员（游客不可见，内部人员可读）</span>
        </label>
        <label class="vis-opt">
          <input type="radio" value="private" v-model="form.visibility" />
          <span>仅管理员（私有）</span>
        </label>
      </fieldset>

      <div class="actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <router-link :to="`/${category}`" class="btn">取消</router-link>
      </div>
    </form>
  </div>
</template>

<style scoped>
.edit-page {
  max-width: min(1160px, 95vw); /* 高分辨率适配 */
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 18px;
  font-size: 24px;
}

.edit-error {
  color: #ff9d9d;
  font-size: 14px;
}

.edit-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 30px 0;
}

.edit-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}

.field input {
  padding: 9px 12px;
  font-size: 14px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  font-family: inherit;
}

.field input:focus {
  border-color: var(--accent);
}

/* 编辑模式切换 */
.mode-switch {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.mode-btn {
  padding: 7px 18px;
  font-size: 13px;
  border: none;
  background: var(--panel-2);
  color: var(--muted);
  cursor: pointer;
}

.mode-btn + .mode-btn {
  border-left: 1px solid var(--border);
}

.mode-btn.on {
  background: var(--accent);
  color: #fff;
}

/* Markdown 源码区：与工具栏连成一体 */
.md-input {
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 10px 10px;
  outline: none;
  font-family: inherit;
  resize: vertical;
}

.md-input:focus {
  border-color: var(--accent);
}

/* HTML 源码模式：等宽字体便于编辑 */
.raw-input {
  font-family: Consolas, 'Cascadia Code', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
  min-height: 340px;
}

.file-input {
  display: none;
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-label {
  font-size: 13px;
  color: var(--muted);
}

.preview-body {
  padding: 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-height: 120px;
}

.vis-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 13px;
  color: var(--muted);
}

.vis-group legend {
  padding: 0 6px;
  font-size: 13px;
}

.vis-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.vis-opt input {
  accent-color: var(--accent);
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}
</style>
