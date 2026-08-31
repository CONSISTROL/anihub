<script setup>
// 所见即所得编辑器（TipTap v3）：工具栏支持 加粗/斜体/下划线/删除线/标题/行内代码/代码块/
// 引用/列表/链接/图片/字号/颜色/撤销重做，作用于选中的文本
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color, FontSize } from '@tiptap/extension-text-style'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  modelValue: { type: String, default: '' }, // HTML 内容（v-model）
  imageUpload: { type: Function, default: null }, // async (file) => { url }
})
const emit = defineEmits(['update:modelValue'])

const editor = useEditor({
  content: props.modelValue || '',
  extensions: [
    StarterKit,
    TextStyle,
    Color,
    FontSize,
    Underline,
    Link.configure({ openOnClick: false, autolink: true }),
    Image,
  ],
  editorProps: {
    // 剪贴板粘贴图片（Ctrl+V 复制来的图片 / 截图）→ 上传并插入
    handlePaste(_view, event) {
      const file = imageFileFromClipboard(event)
      if (!file) return false
      insertImageFile(file)
      return true
    },
  },
  onUpdate: ({ editor: e }) => emit('update:modelValue', e.getHTML()),
})

// 外部（如模式切换）改动内容时同步进编辑器，避免覆盖当前编辑
watch(
  () => props.modelValue,
  (val) => {
    const e = editor.value
    if (!e || val === e.getHTML()) return
    e.commands.setContent(val || '', { emitUpdate: false })
  }
)

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 32]
const COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#ec4899', '#64748b', '#111827']
const fileInput = ref(null)
const uploading = ref(false)
const errMsg = ref('')

// 按钮高亮状态（响应式跟随光标）
const active = computed(() => {
  const e = editor.value
  if (!e) return {}
  return {
    bold: e.isActive('bold'),
    italic: e.isActive('italic'),
    underline: e.isActive('underline'),
    strike: e.isActive('strike'),
    code: e.isActive('code'),
    codeBlock: e.isActive('codeBlock'),
    quote: e.isActive('blockquote'),
    bullet: e.isActive('bulletList'),
    ordered: e.isActive('orderedList'),
    link: e.isActive('link'),
    h1: e.isActive('heading', { level: 1 }),
    h2: e.isActive('heading', { level: 2 }),
    h3: e.isActive('heading', { level: 3 }),
  }
})

const chain = () => editor.value?.chain().focus()
const run = (fn) => {
  const c = chain()
  if (c) fn(c)?.run() // 注意：链式命令必须以 .run() 结束才会真正执行
}

function toggleHeading(level) {
  run((c) => c.toggleHeading({ level }))
}

function onFontSize(e) {
  const v = e.target.value
  if (!v) run((c) => c.unsetFontSize())
  else run((c) => c.setFontSize(`${v}px`))
}

function onColor(c) {
  run((ch) => (c ? ch.setColor(c) : ch.unsetColor()))
}

function onLink() {
  const e = editor.value
  if (!e) return
  if (e.isActive('link')) {
    e.chain().focus().unsetLink().run()
    return
  }
  const url = window.prompt('链接地址（https://…）')
  if (url) e.chain().focus().setLink({ href: url }).run()
}

function imageFileFromClipboard(e) {
  const items = e.clipboardData?.items
  if (!items) return null
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return null
}

async function insertImageFile(file) {
  if (!props.imageUpload) return
  uploading.value = true
  errMsg.value = ''
  try {
    const { url } = await props.imageUpload(file)
    editor.value?.chain().focus().setImage({ src: url }).run()
  } catch (err) {
    errMsg.value = err.message
  } finally {
    uploading.value = false
  }
}

function onPickImage(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (file) insertImageFile(file)
}
</script>

<template>
  <div class="richtext">
    <div class="rt-toolbar">
      <button type="button" class="rt-btn" title="撤销" :disabled="!editor?.can().undo()" @click="run((c) => c.undo())"><AppIcon name="undo" :size="14" /></button>
      <button type="button" class="rt-btn" title="重做" :disabled="!editor?.can().redo()" @click="run((c) => c.redo())"><AppIcon name="redo" :size="14" /></button>
      <span class="rt-sep" />
      <button type="button" class="rt-btn" :class="{ on: active.bold }" title="加粗" @click="run((c) => c.toggleBold())"><AppIcon name="bold" :size="14" /></button>
      <button type="button" class="rt-btn" :class="{ on: active.italic }" title="斜体" @click="run((c) => c.toggleItalic())"><AppIcon name="italic" :size="14" /></button>
      <button type="button" class="rt-btn" :class="{ on: active.underline }" title="下划线" @click="run((c) => c.toggleUnderline())"><AppIcon name="underline" :size="14" /></button>
      <button type="button" class="rt-btn" :class="{ on: active.strike }" title="删除线" @click="run((c) => c.toggleStrike())"><AppIcon name="strike" :size="14" /></button>
      <span class="rt-sep" />
      <button type="button" class="rt-btn" :class="{ on: active.h1 }" title="一级标题" @click="toggleHeading(1)">H1</button>
      <button type="button" class="rt-btn" :class="{ on: active.h2 }" title="二级标题" @click="toggleHeading(2)">H2</button>
      <button type="button" class="rt-btn" :class="{ on: active.h3 }" title="三级标题" @click="toggleHeading(3)">H3</button>
      <span class="rt-sep" />
      <button type="button" class="rt-btn" :class="{ on: active.code }" title="行内代码" @click="run((c) => c.toggleCode())"><AppIcon name="code" :size="14" /></button>
      <button type="button" class="rt-btn" :class="{ on: active.codeBlock }" title="代码块" @click="run((c) => c.toggleCodeBlock())"><AppIcon name="braces" :size="14" /></button>
      <button type="button" class="rt-btn" :class="{ on: active.quote }" title="引用" @click="run((c) => c.toggleBlockquote())"><AppIcon name="quote" :size="14" /></button>
      <button type="button" class="rt-btn" :class="{ on: active.bullet }" title="无序列表" @click="run((c) => c.toggleBulletList())"><AppIcon name="list" :size="14" /></button>
      <button type="button" class="rt-btn" :class="{ on: active.ordered }" title="有序列表" @click="run((c) => c.toggleOrderedList())"><AppIcon name="list-ordered" :size="14" /></button>
      <span class="rt-sep" />
      <button type="button" class="rt-btn" :class="{ on: active.link }" title="链接" @click="onLink"><AppIcon name="link" :size="14" /></button>
      <button type="button" class="rt-btn" title="插入图片（或直接 Ctrl+V 粘贴图片）" :disabled="uploading" @click="fileInput.click()">
        <AppIcon v-if="!uploading" name="image" :size="14" />
        <template v-else>…</template>
      </button>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="rt-file" @change="onPickImage" />
      <span class="rt-sep" />
      <select class="rt-select" title="字号" @change="onFontSize">
        <option value="">字号</option>
        <option v-for="s in FONT_SIZES" :key="s" :value="s">{{ s }}px</option>
      </select>
      <span class="rt-colors">
        <button
          v-for="c in COLORS"
          :key="c"
          type="button"
          class="rt-swatch"
          :style="{ background: c }"
          :title="c"
          @click="onColor(c)"
        />
        <input type="color" class="rt-picker" title="自定义颜色" @input="onColor($event.target.value)" />
      </span>
      <button type="button" class="rt-btn" title="清除格式" @click="run((c) => c.clearNodes().unsetAllMarks())"><AppIcon name="eraser" :size="14" /></button>
    </div>

    <p v-if="errMsg" class="rt-error">{{ errMsg }}</p>
    <EditorContent :editor="editor" class="rt-content" />
  </div>
</template>

<style scoped>
.richtext {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.rt-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 6px 8px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
}

.rt-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}

.rt-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--panel);
}

.rt-btn.on {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.rt-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rt-sep {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 5px;
}

.rt-select {
  height: 26px;
  font-size: 12px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 4px;
}

.rt-colors {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 2px;
}

.rt-swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid rgb(0 0 0 / 0.25);
  cursor: pointer;
  padding: 0;
}

.rt-picker {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: none;
  cursor: pointer;
}

.rt-file {
  display: none;
}

.rt-error {
  margin: 0;
  padding: 6px 12px;
  font-size: 12px;
  color: #ff9d9d;
  background: color-mix(in srgb, #ff5c5c 10%, transparent);
}

.rt-content {
  min-height: 280px;
  padding: 12px 14px;
  font-size: 15px;
  line-height: 1.75;
  color: var(--text);
  word-wrap: break-word;
}

.rt-content :deep(.ProseMirror) {
  outline: none;
  min-height: 260px;
}

.rt-content :deep(h1),
.rt-content :deep(h2),
.rt-content :deep(h3) {
  margin: 1.1em 0 0.5em;
  line-height: 1.3;
}

.rt-content :deep(h1) {
  font-size: 22px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.rt-content :deep(h2) {
  font-size: 18px;
}

.rt-content :deep(h3) {
  font-size: 16px;
}

.rt-content :deep(p) {
  margin: 0.6em 0;
}

.rt-content :deep(a) {
  color: var(--accent);
}

.rt-content :deep(code) {
  font-family: Consolas, 'Cascadia Code', 'Courier New', monospace;
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 0.9em;
  background: var(--panel-2);
}

.rt-content :deep(pre) {
  font-family: Consolas, 'Cascadia Code', 'Courier New', monospace;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  line-height: 1.6;
  overflow-x: auto;
  tab-size: 4;
  -webkit-overflow-scrolling: touch;
}

.rt-content :deep(pre code) {
  font-family: inherit;
  padding: 0;
  background: transparent;
  font-size: 13px;
}

.rt-content :deep(blockquote) {
  margin: 0.7em 0;
  padding: 2px 14px;
  border-left: 3px solid var(--accent);
  color: var(--muted);
}

.rt-content :deep(ul),
.rt-content :deep(ol) {
  padding-left: 1.6em;
}

.rt-content :deep(img) {
  max-width: 100%;
}
</style>
