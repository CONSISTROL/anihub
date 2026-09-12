<script setup>
// 阅读正文页（/reading/:id）：把整本书放进 iframe，并做主题同步。
//
// 为什么用真实 URL + 服务端注入主题桥，而不是 iframe srcdoc：
//   about:srcdoc 文档**没有基址**，书里 `href="#章节id"` 这类片段链接会被解析到
//   外层文档的 URL —— 点目录会把 iframe 整个导航成网站首页，书的内容全丢（已实测复现）。
//   用真实 URL 加载，片段导航与相对资源都按书的目录正常解析。
//
// 而真实 URL 又拿不到"解析期就定好主题"的能力，所以由服务端在
// /books/<id>/<theme>/<entry> 这个路径上把主题桥注入 <head>：
//   · 解析期就应用主题（不会先闪一下书的默认主题）
//   · 暴露 window.__anihubSetTheme 供父页面调用，并提供 postMessage 通道
// 主题变化时直接换 iframe 地址重载 —— 最确定，不依赖跨文档时序。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getBooks, openBookSession } from '../api/reading'
import { resolved } from '../composables/useTheme'
import AppIcon from '../components/AppIcon.vue'

defineOptions({ name: 'ReadingBookView' })

const route = useRoute()
const router = useRouter()

const book = ref(null)
const loading = ref(true)
const error = ref('')
const frame = ref(null)

/**
 * 把书正文地址改写为「带主题注入」的路径：
 *   /books/<id>/<entry>  →  /books/<id>/<theme>/<entry>
 * 服务端只接受 light / dark 两段，因此这里拼出来的地址一定是受支持的。
 */
const iframeSrc = computed(() => {
  if (!book.value) return ''
  const theme = resolved.value === 'dark' ? 'dark' : 'light'
  return `/books/${encodeURIComponent(book.value.id)}/${theme}/${book.value.entry}`
})

// 主题切换 → 换地址重载 iframe（书的阅读进度与设置由它自己持久化，重载不会丢）
watch(resolved, () => {
  const f = frame.value
  if (!f) return
  try {
    // 同源时优先原地切，避免重载
    f.contentWindow?.__anihubSetTheme?.(resolved.value)
  } catch {
    /* 跨文档异常忽略 */
  }
})

onMounted(async () => {
  try {
    // 1) 先确认这本书当前身份可读
    const list = await getBooks()
    const found = (list.books || []).find((b) => b.id === route.params.id)
    if (!found) {
      error.value = '这本书不存在或未上架'
      return
    }
    book.value = found
    // 2) 换取 /books 专用会话 Cookie（iframe 里的静态请求带不上 localStorage 的 token）
    await openBookSession()
  } catch (e) {
    if (e.status === 401) return router.replace({ name: 'home' })
    error.value = e.message
  } finally {
    loading.value = false
  }
})

function close() {
  router.push({ name: 'reading' })
}

onUnmounted(() => {
  book.value = null
})

const sizeText = computed(() => {
  const s = book.value?.size
  if (!s) return ''
  return s > 1024 * 1024 ? `${(s / 1024 / 1024).toFixed(1)} MB` : `${Math.round(s / 1024)} KB`
})
</script>

<template>
  <div class="reader-page">
    <!-- 阅读工具条：返回书架 / 书名 / 体积 / 来源（书籍自身的目录与搜索在书内） -->
    <div class="reader-bar">
      <button type="button" class="btn btn-sm back-btn" @click="close">
        <AppIcon name="arrow-right" :size="13" /> 书架
      </button>
      <span class="reader-title" :title="book?.title">{{ book?.title || '在线阅读' }}</span>
      <span v-if="sizeText" class="reader-meta">{{ sizeText }}</span>
      <a
        v-if="book?.home"
        class="reader-link"
        :href="book.home"
        target="_blank"
        rel="noopener noreferrer"
        title="上游项目"
      >来源</a>
    </div>

    <p v-if="loading" class="reader-hint">正在打开《{{ book?.title || route.params.id }}》…</p>
    <p v-else-if="error" class="reader-err">{{ error }}</p>
    <iframe
      v-else
      ref="frame"
      class="reader-frame"
      :src="iframeSrc"
      title="书籍正文"
    ></iframe>
  </div>
</template>

<style scoped>
/* 铺满导航栏以下区域（--nav-h 由 NavBar 实时测量，导航折行时也准） */
.reader-page {
  position: fixed;
  top: var(--nav-h, 56px);
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.reader-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
  padding: 7px 14px;
  background: color-mix(in srgb, var(--panel) 60%, transparent);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.back-btn {
  gap: 5px;
}

/* 复用 arrow-right 图标并旋转成朝左，省一个图标定义 */
.back-btn :deep(.app-icon) {
  transform: rotate(180deg);
}

.reader-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  font-weight: 600;
}

.reader-meta {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.reader-link {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--accent);
  text-decoration: none;
}

.reader-link:hover {
  text-decoration: underline;
}

.reader-frame {
  flex: 1 1 auto;
  width: 100%;
  border: 0;
  background: transparent;
}

.reader-hint,
.reader-err {
  margin: auto;
  padding: 20px;
  font-size: 14px;
  color: var(--muted);
}

.reader-err {
  color: var(--danger);
}
</style>
