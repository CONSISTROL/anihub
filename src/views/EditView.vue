<script setup>
// 新建/编辑文章（博客与 Wiki 共用，category 由路由 props 传入）
// 两种正文编辑模式：Markdown（源码 + 工具栏 + 实时预览）/ 所见即所得（TipTap）
// 存储格式跟随模式：md 存 content_md，html 存 content_html；切换时相互转换
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
const rawInput = ref(null)
const showPreview = ref(false)

// 编辑框高度随内容自动撑开，不固定高度
function autoResizeTextarea(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}
function syncEditorHeights() {
  autoResizeTextarea(mdInput.value)
  autoResizeTextarea(rawInput.value)
}
watch([form.content_md, form.content_html, mode, showPreview], () => nextTick(syncEditorHeights), { immediate: true })

// 点击预览时保持当前滚动位置，避免页面跳到顶部
async function togglePreview() {
  const y = window.scrollY
  showPreview.value = !showPreview.value
  await nextTick()
  window.scrollTo(0, y)
}
// 模式切换往返保护：记录最近一次自动转换，避免来回切换改写内容
let lastMdToHtml = null // { md, html }：md → html 自动生成
let lastHtmlToMd = null // { html, md }：html/raw → md 自动生成

// 吸顶设置条高度：供 Markdown/富文本工具栏计算吸顶位置，避免与设置条重叠
const editStickyEl = ref(null)
const editStickyH = ref(54)
const editStickyStuck = ref(false)
const mdToolbarStuck = ref(false)
let stickyResizeObserver = null
let stickyScrollRaf = null

function measureSticky() {
  editStickyH.value = editStickyEl.value?.offsetHeight || 54
  nextTick(syncStickyGlass)
}

// 吸顶元素未锁定前保持透明，锁定时才加毛玻璃：通过“元素实际位置是否已到达 sticky top”判断
function syncStickyGlass() {
  const check = (el, target) => {
    if (!el) {
      target.value = false
      return
    }
    const top = parseFloat(getComputedStyle(el).top) || 0
    target.value = el.getBoundingClientRect().top <= top + 2
  }
  check(editStickyEl.value, editStickyStuck)
  check(document.querySelector('.md-toolbar'), mdToolbarStuck)
}

function onStickyScroll() {
  if (stickyScrollRaf) return
  stickyScrollRaf = requestAnimationFrame(() => {
    stickyScrollRaf = null
    syncStickyGlass()
  })
}

onMounted(() => {
  measureSticky()
  syncEditorHeights()
  if (typeof ResizeObserver !== 'undefined' && editStickyEl.value) {
    stickyResizeObserver = new ResizeObserver(measureSticky)
    stickyResizeObserver.observe(editStickyEl.value)
  }
  window.addEventListener('scroll', onStickyScroll, { passive: true })
  window.addEventListener('resize', onStickyScroll, { passive: true })
})
watch(loading, (v) => {
  if (!v) {
    nextTick(() => {
      measureSticky()
      syncEditorHeights()
    })
  }
})
watch(mode, () => nextTick(syncStickyGlass))
onUnmounted(() => {
  stickyResizeObserver?.disconnect()
  window.removeEventListener('scroll', onStickyScroll)
  window.removeEventListener('resize', onStickyScroll)
  if (stickyScrollRaf) cancelAnimationFrame(stickyScrollRaf)
})
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
    lastMdToHtml = null
    lastHtmlToMd = null
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
  const scrollY = window.scrollY

  if (next === 'md') {
    // html / raw → md
    const html = form.value.content_html
    if (lastMdToHtml && lastMdToHtml.md === form.value.content_md && lastMdToHtml.html === html) {
      // HTML 没被改过：直接保留原 Markdown，避免往返转换改写
      form.value.content_md = lastMdToHtml.md
    } else {
      form.value.content_md = htmlToMd(html)
      lastHtmlToMd = { html, md: form.value.content_md }
    }
  } else if (cur === 'md') {
    // md → html / raw
    const md = form.value.content_md
    if (lastHtmlToMd && lastHtmlToMd.html === form.value.content_html && lastHtmlToMd.md === md) {
      // Markdown 没被改过：直接保留原 HTML，避免往返转换改写
      form.value.content_html = lastHtmlToMd.html
    } else {
      form.value.content_html = mdToHtml(md)
      lastMdToHtml = { md, html: form.value.content_html }
    }
  }

  mode.value = next
  localStorage.setItem(MODE_KEY, next)
  // 切换模式会重建编辑区 DOM；先同步编辑框高度，再恢复滚动位置，
  // 否则高度还没撑开时 scrollTo 会被浏览器 clamp 到顶部附近。
  nextTick(() => {
    syncEditorHeights()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, scrollY))
    })
  })
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
  if (!items) return false
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (!file) return false
      e.preventDefault() // 拦下默认粘贴，避免图片被当文本贴进去
      insertMdImage(file)
      return true
    }
  }
  return false
}

// Markdown 模式粘贴：优先处理图片；若粘贴的是完整 HTML 文档（<html> / <!DOCTYPE html>），
// 自动切到 HTML 源码模式并按原样保存，避免用户以为“保存没反应”而实际存成了 Markdown。
function onPaste(e) {
  if (onPasteImage(e)) return
  const text = e.clipboardData?.getData('text/plain')
  if (text && isFullDoc(text)) {
    e.preventDefault()
    form.value.content_html = text
    mode.value = 'raw'
    localStorage.setItem(MODE_KEY, 'raw')
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
    // 错误提示在页面顶部；保存按钮通常在下方，滚动过去避免“点了没反应”的错觉
    requestAnimationFrame(() => {
      document.querySelector('.edit-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="edit-page">
    <h1 class="page-title"><AppIcon name="pen" :size="22" /> {{ isEdit ? '编辑' : '新建' }}{{ category === 'blog' ? '文章' : 'Wiki 条目' }}</h1>
    <p v-if="error" class="edit-error">{{ error }}</p>
    <p v-if="loading" class="edit-hint">加载中…</p>

    <form v-else class="edit-card" :style="{ '--edit-sticky-h': editStickyH + 'px' }" @submit.prevent="onSubmit">
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

      <!-- 长内容编辑时固定可见性与保存/取消：放在正文上方，滚动时始终可见 -->
      <div ref="editStickyEl" class="edit-sticky" :class="{ stuck: editStickyStuck }" role="group" aria-label="条目设置与操作">
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
          <button
            type="button"
            class="mode-btn"
            :class="{ on: showPreview }"
            @click="togglePreview"
          >
            预览
          </button>
        </div>
        <div class="edit-sticky-right">
          <div class="toolbar-vis" role="radiogroup" aria-label="可见性">
            <span class="toolbar-label">可见性</span>
            <label class="vis-pill" title="公开（游客可见）">
              <input type="radio" value="public" v-model="form.visibility" />
              <span>公开</span>
            </label>
            <label class="vis-pill" title="仅内部人员（游客不可见，内部人员可读）">
              <input type="radio" value="insider" v-model="form.visibility" />
              <span>内部</span>
            </label>
            <label class="vis-pill" title="仅管理员（私有）">
              <input type="radio" value="private" v-model="form.visibility" />
              <span>私有</span>
            </label>
          </div>
          <div class="actions">
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? '保存中…' : '保存' }}
            </button>
            <router-link :to="isEdit ? `/${category}/${slug}` : `/${category}`" class="btn">取消</router-link>
          </div>
        </div>
      </div>

      <!-- Markdown 模式：工具栏 + 源码 + 实时预览 -->
      <template v-if="mode === 'md'">
        <template v-if="!showPreview">
          <MdToolbar :class="{ stuck: mdToolbarStuck }" @cmd="onMdCmd" />
          <textarea
            ref="mdInput"
            v-model="form.content_md"
            rows="1"
            required
            class="md-input"
            placeholder="支持 Markdown 与行内 HTML（如 <span style=&quot;color:red&quot;>文字</span>）…；Ctrl+V 可直接粘贴剪贴板里的图片；粘贴完整 HTML 文档会自动切到 HTML 源码模式"
            @paste="onPaste"
          ></textarea>
        </template>
        <div v-if="showPreview" class="preview">
          <span class="preview-label">预览</span>
          <div class="preview-body">
            <MarkdownView v-if="form.content_md" :source="form.content_md" />
            <p v-else class="edit-hint">（正文为空，预览将显示在此处）</p>
          </div>
        </div>
      </template>

      <!-- 所见即所得模式：TipTap 编辑器（预览时隐藏编辑器，只展示渲染结果） -->
      <template v-else-if="mode === 'html'">
        <RichTextEditor v-if="!showPreview" v-model="form.content_html" :image-upload="uploadImage" />
        <div v-else class="preview">
          <span class="preview-label">预览</span>
          <div class="preview-body">
            <HtmlDocView v-if="form.content_html" :source="form.content_html" />
            <p v-else class="edit-hint">（正文为空，预览将显示在此处）</p>
          </div>
        </div>
      </template>

      <!-- HTML 源码模式：原始 HTML（可粘贴完整文档，按原样保存与渲染） -->
      <template v-else-if="mode === 'raw'">
        <textarea
          ref="rawInput"
          v-if="!showPreview"
          v-model="form.content_html"
          rows="1"
          spellcheck="false"
          class="md-input raw-input"
          placeholder="粘贴 / 编写原始 HTML，可包含 &lt;style&gt; 与 &lt;script&gt;（完整文档或片段均可）"
        ></textarea>
        <div v-if="showPreview" class="preview">
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
  border-radius: 10px;
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
  min-height: 0;
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

/* 长内容编辑：可见性 + 保存/取消固定在正文上方，滚动时始终可用 */
.edit-sticky {
  position: sticky;
  top: 70px;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  padding: 10px 0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 14px;
  box-shadow: none;
  transition:
    background-color var(--dur-ios-2) var(--ease-ios-expo),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo),
    padding var(--dur-ios-2) var(--ease-ios-expo);
}

.edit-sticky.stuck {
  padding: 10px 14px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  border-color: var(--border);
  border-radius: 14px;
  box-shadow:
    0 10px 30px rgb(0 0 0 / 0.12),
    inset 0 1px 0 rgb(255 255 255 / 0.06);
}

/* 右侧控件组：模式切换在左，可见性 + 操作在右，布局更整齐 */
.edit-sticky-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px 14px;
}

.toolbar-vis {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}

.toolbar-label {
  font-weight: 600;
  margin-right: 2px;
}

.vis-pill {
  position: relative;
}

.vis-pill input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.vis-pill span {
  display: inline-block;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--muted);
  cursor: pointer;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo);
}

.vis-pill:hover span {
  border-color: var(--accent);
}

.vis-pill input:checked + span {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.vis-pill input:focus-visible + span {
  outline: 2px solid color-mix(in srgb, var(--accent) 65%, transparent);
  outline-offset: 2px;
}

.actions {
  display: flex;
  gap: 10px;
}

/* 正文编辑工具栏（Markdown / 富文本）也吸顶，但保持在设置条下方 */
.edit-card :deep(.md-toolbar),
.edit-card :deep(.rt-toolbar) {
  position: sticky;
  top: calc(70px + var(--edit-sticky-h, 54px));
  z-index: 19;
  transition:
    background-color var(--dur-ios-2) var(--ease-ios-expo),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.edit-card :deep(.md-toolbar.stuck),
.edit-card :deep(.rt-toolbar.stuck) {
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.06);
}

/* 窄屏：操作区改为上下两行，依然保持吸顶 */
@media (max-width: 768px) {
  .edit-sticky {
    top: 84px;
    flex-direction: column;
    align-items: stretch;
  }

  .edit-sticky-right {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-vis {
    justify-content: space-between;
  }

  .actions {
    justify-content: flex-end;
  }

  .edit-card :deep(.md-toolbar),
  .edit-card :deep(.rt-toolbar) {
    top: calc(84px + var(--edit-sticky-h, 92px));
  }
}
</style>
