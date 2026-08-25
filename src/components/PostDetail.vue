<script setup>
// 文章详情（博客/Wiki 共用）：Markdown/富文本/HTML 渲染 + 作者操作
// Wiki 额外：右侧停靠可隐藏的抽屉（标题导航 + 条目信息）
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getPostBySlug, deletePost } from '../api/posts'
import { useAuth } from '../composables/useAuth'
import MarkdownView from './MarkdownView.vue'
import RichTextView from './RichTextView.vue'
import HtmlDocView from './HtmlDocView.vue'

const props = defineProps({
  category: { type: String, required: true },
  slug: { type: String, required: true },
})

const route = useRoute()
const router = useRouter()
const { isLoggedIn } = useAuth()

const post = ref(null)
const loading = ref(true)
const error = ref('')
const deleting = ref(false)

const canEdit = computed(() => post.value?.canEdit && isLoggedIn.value)

async function load() {
  loading.value = true
  error.value = ''
  try {
    post.value = await getPostBySlug(props.slug)
  } catch (e) {
    // 详情不存在 / 无权限访问（服务端按 404 统一处理，不暴露存在性）→ 展示错误码图片页
    if (e.status === 404) {
      router.replace({ name: 'error', params: { code: 404 } })
      return
    }
    if (e.status === 401) {
      router.replace({ name: 'error', params: { code: 401 } })
      return
    }
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => props.slug, load, { immediate: true })

async function onDelete() {
  if (!window.confirm('确定删除这篇文章吗？此操作不可恢复。')) return
  deleting.value = true
  try {
    await deletePost(post.value.id)
    router.replace(`/${props.category}`)
  } catch (e) {
    alert(e.message)
    deleting.value = false
  }
}

function fmtDateTime(s) {
  const d = new Date(s + 'Z')
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const VIS_LABEL = { insider: '仅内部可见', private: '仅管理员可见' }

/* ---------------- Wiki 右侧抽屉：鼠标悬停滑出 + 标题导航（滚动高亮）+ 条目信息 ---------------- */

// 抽屉默认收起：点开 wiki 不自动弹出；鼠标移到右侧热区自动滑出（仅支持悬停的设备）。
// 用「指针位置追踪」判断进出（而非 mouseenter/mouseleave）：
// 跨域 iframe 会吞掉父页面的鼠标事件——指针一旦进入 iframe 区域，父页面收不到 mouseleave。
// 因此：父页面 document 监听 mousemove（覆盖非 iframe 区域），
// iframe 内注入脚本上报指针位置（覆盖 iframe 区域），统一换算成视口坐标后按热区/抽屉矩形判断开关。
const sideOpen = ref(false)
const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches
const wrapEl = ref(null)
let lastP = null

function reconcile() {
  if (!canHover || !lastP || !wrapEl.value) return
  const wr = wrapEl.value.getBoundingClientRect()
  const insideWrap = lastP.x >= wr.left && lastP.x <= wr.right && lastP.y >= wr.top && lastP.y <= wr.bottom
  if (insideWrap) {
    sideOpen.value = true
    return
  }
  if (!sideOpen.value) return
  // 已打开：指针还需在抽屉内才算停留
  const d = wrapEl.value.querySelector('.wiki-side')
  let inside = false
  if (d) {
    const dr = d.getBoundingClientRect()
    inside = lastP.x >= dr.left && lastP.x <= dr.right && lastP.y >= dr.top && lastP.y <= dr.bottom
  }
  if (!inside) sideOpen.value = false
}

function onDocPointerMove(e) {
  lastP = { x: e.clientX, y: e.clientY }
  reconcile()
}

// 标题导航：{ level, text, el? }；el 存在 = 页面内 DOM（可直接滚动），否则 = iframe 文档（postMessage 定位）
const toc = ref([])
// 当前所在小节（滚动高亮）
const activeIndex = ref(-1)
// iframe 文档上报的标题位置表 [{t, y}]（文档内偏移）
const iframeHeads = ref([])
const isFullDoc = computed(
  () =>
    post.value?.format === 'html' &&
    /^\s*(<!DOCTYPE[^>]*>)?\s*<html[\s>]/i.test(post.value.contentHtml || '')
)

// 布局：完整 HTML 文档 Wiki 全宽直铺（无卡片，保留原生样式）；其余保持卡片布局
const detailClass = computed(() => {
  if (props.category !== 'wiki') return ''
  return isFullDoc.value ? 'detail-full' : 'detail-wide'
})

function stripTags(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function collectToc() {
  const items = []
  if (isFullDoc.value) {
    // iframe 完整文档：从原始 HTML 里正则提取标题
    const src = post.value.contentHtml || ''
    const re = /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi
    let m
    while ((m = re.exec(src))) {
      const text = stripTags(m[3])
      if (!text) continue
      const idm = m[2].match(/\bid=["']([^"']*)["']/i)
      items.push({ level: +m[1], text, id: idm ? idm[1] : '', el: null })
    }
  } else {
    // 页面内渲染的标题（Markdown / HTML 片段）
    const root = document.querySelector('.post-detail')
    if (!root) return
    const els = root.querySelectorAll(
      '.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6'
    )
    els.forEach((el) => {
      const t = (el.textContent || '').trim()
      if (t) items.push({ level: +el.tagName[1], text: t, el })
    })
  }
  toc.value = items
  // 收集后立即按当前滚动位置刷新高亮：
  // 打开/关闭抽屉会触发本函数（按钮文字 ✕/☰ 变化），若只重置 -1 而用户没有滚动，高亮就会消失
  updateActive()
}

// 内容渲染完成后（含子组件异步渲染）收集标题
let tocTimer = null
function scheduleToc() {
  clearTimeout(tocTimer)
  tocTimer = setTimeout(collectToc, 150)
}
watch(
  () => post.value,
  () => {
    if (post.value) nextTick(scheduleToc)
  }
)

const rootEl = ref(null)
let tocObserver = null
onMounted(() => {
  if (rootEl.value) {
    tocObserver = new MutationObserver(scheduleToc)
    tocObserver.observe(rootEl.value, { childList: true, subtree: true })
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  document.addEventListener('mousemove', onDocPointerMove, { passive: true })
})
onUnmounted(() => {
  tocObserver && tocObserver.disconnect()
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  document.removeEventListener('mousemove', onDocPointerMove)
  window.removeEventListener('message', onMessage)
  clearTimeout(tocTimer)
  if (rafId) cancelAnimationFrame(rafId)
})

// 点击导航：页面内标题直接滚动；iframe 文档发消息让 iframe 回传偏移，再由父页面滚动
function onTocClick(item) {
  if (item.el) {
    item.el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } else {
    const f = document.querySelector('.doc-frame')
    if (f && f.contentWindow) f.contentWindow.postMessage({ __anihubScroll: item.text }, '*')
  }
  if (canHover) sideOpen.value = false // 桌面悬停场景：跳转后收起抽屉
}

// 滚动高亮：最后一个「顶部已越过阈值线」的标题即为当前小节
let rafId = null
function onScroll() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    updateActive()
  })
}

function updateActive() {
  if (!toc.value.length) return
  const threshold = 110
  let headIdx = -1
  if (isFullDoc.value && iframeHeads.value.length) {
    const f = document.querySelector('.doc-frame')
    if (f) {
      const base = f.getBoundingClientRect().top + window.scrollY
      for (let i = 0; i < iframeHeads.value.length; i++) {
        if (base + iframeHeads.value[i].y <= window.scrollY + threshold) headIdx = i
        else break
      }
    }
  } else {
    for (let i = 0; i < toc.value.length; i++) {
      const el = toc.value[i].el
      if (el && el.getBoundingClientRect().top <= threshold) headIdx = i
      else break
    }
  }
  if (headIdx === -1) {
    // 尚未越过第一个标题（页面顶部）：把第一项视为当前小节
    activeIndex.value = 0
    return
  }
  if (isFullDoc.value && iframeHeads.value.length) {
    // iframe 场景按文本反查 toc 下标（防正则提取与 DOM 标题数量不一致）
    const t = iframeHeads.value[headIdx].t
    const j = toc.value.findIndex((it) => it.text === t)
    activeIndex.value = j
  } else {
    activeIndex.value = headIdx
  }
}

function onMessage(e) {
  const d = e.data
  if (!d || typeof d !== 'object') return
  if (Array.isArray(d.__anihubHeads) && d.__anihubHeads.length) {
    iframeHeads.value = d.__anihubHeads
    updateActive()
    return
  }
  if (typeof d.__anihubScrollY === 'number') {
    const f = document.querySelector('.doc-frame')
    if (f) {
      const rect = f.getBoundingClientRect()
      window.scrollTo({
        top: rect.top + window.scrollY + d.__anihubScrollY - 70,
        behavior: 'smooth',
      })
    }
    return
  }
  if (d.__anihubPointer && typeof d.__anihubPointer.x === 'number') {
    // iframe 内上报的指针位置（iframe 视口坐标 → 页面视口坐标）
    const f = document.querySelector('.doc-frame')
    if (f) {
      const r = f.getBoundingClientRect()
      lastP = { x: r.left + d.__anihubPointer.x, y: r.top + d.__anihubPointer.y }
      reconcile()
    }
  }
}
onMounted(() => window.addEventListener('message', onMessage))
</script>

<template>
  <div ref="rootEl" class="post-detail" :class="detailClass">
    <p v-if="error" class="detail-error">{{ error }}</p>
    <p v-else-if="loading" class="detail-hint">加载中…</p>

    <!-- 完整 HTML 文档 Wiki：不嵌入卡片，直接在网页主体中显示原生样式（仅保留顶部导航） -->
    <div v-else-if="post && isFullDoc" class="html-doc-direct">
      <HtmlDocView :source="post.contentHtml" />
    </div>

    <article v-else-if="post" class="post-card">
      <header class="post-head">
        <h1 class="post-title">{{ post.title }}</h1>
        <!-- 博客：元信息在顶部；Wiki 走右侧抽屉 -->
        <div v-if="category !== 'wiki'" class="post-meta">
          <span>作者：{{ post.authorName }}</span>
          <span>发布于 {{ fmtDateTime(post.createdAt) }}</span>
          <span v-if="post.updatedAt !== post.createdAt">更新于 {{ fmtDateTime(post.updatedAt) }}</span>
          <span v-if="post.visibility !== 'public'" class="post-hidden">{{ VIS_LABEL[post.visibility] || post.visibility }}</span>
          <span v-for="t in post.tags" :key="t" class="post-tag">#{{ t }}</span>
        </div>
      </header>

      <MarkdownView v-if="post.format !== 'html' && post.contentMd" :source="post.contentMd" />
      <HtmlDocView v-else-if="post.format === 'html' && post.contentHtml" :source="post.contentHtml" />
      <p v-else class="detail-hint">（暂无内容）</p>

      <footer v-if="canEdit" class="post-actions">
        <router-link :to="`/${category}/${post.slug}/edit`" class="btn">编辑</router-link>
        <button class="btn btn-danger" :disabled="deleting" @click="onDelete">
          {{ deleting ? '删除中…' : '删除' }}
        </button>
      </footer>
    </article>

    <!-- Wiki：右侧停靠隐藏抽屉（悬停热区自动滑出：标题导航 + 条目信息） -->
    <template v-if="category === 'wiki' && post">
      <div v-if="sideOpen" class="side-backdrop" @click="sideOpen = false"></div>
      <div ref="wrapEl" class="side-wrap">
        <button
          class="side-toggle"
          :aria-label="sideOpen ? '收起侧栏' : '展开侧栏'"
          @click="sideOpen = !sideOpen"
        >
          {{ sideOpen ? '✕' : '☰' }}
        </button>
        <transition name="side">
          <aside v-show="sideOpen" class="wiki-side">
            <div class="side-box">
              <h3 class="side-title">标题导航</h3>
              <nav v-if="toc.length" class="side-toc">
                <a
                  v-for="(item, i) in toc"
                  :key="i"
                  href="#"
                  :class="['lv-' + item.level, { active: i === activeIndex }]"
                  @click.prevent="onTocClick(item)"
                >{{ item.text }}</a>
              </nav>
              <p v-else class="side-empty">（无标题）</p>
            </div>
            <div class="side-box">
              <h3 class="side-title">条目信息</h3>
              <div class="side-row"><span>作者</span><b>{{ post.authorName }}</b></div>
              <div class="side-row"><span>创建</span><b>{{ fmtDateTime(post.createdAt) }}</b></div>
              <div v-if="post.updatedAt !== post.createdAt" class="side-row">
                <span>更新</span><b>{{ fmtDateTime(post.updatedAt) }}</b>
              </div>
              <div class="side-row">
                <span>可见性</span>
                <b v-if="post.visibility !== 'public'">{{ VIS_LABEL[post.visibility] || post.visibility }}</b>
                <b v-else>公开</b>
              </div>
              <div v-if="post.tags.length" class="side-tags">
                <span v-for="t in post.tags" :key="t" class="post-tag">#{{ t }}</span>
              </div>
            </div>
            <!-- 完整 HTML 文档没有卡片操作栏，编辑/删除放到抽屉里 -->
            <div v-if="canEdit && isFullDoc" class="side-box">
              <h3 class="side-title">操作</h3>
              <div class="side-actions">
                <router-link :to="`/${category}/${post.slug}/edit`" class="btn btn-sm">编辑</router-link>
                <button class="btn btn-sm btn-danger" :disabled="deleting" @click="onDelete">
                  {{ deleting ? '删除中…' : '删除' }}
                </button>
              </div>
            </div>
          </aside>
        </transition>
      </div>
    </template>
  </div>
</template>

<style scoped>
.post-detail {
  max-width: min(880px, 95vw); /* 博客正文适度加宽；Wiki 由 detail-wide 控制 */
  margin: 0 auto;
  padding: 24px 20px 60px;
}

/* Wiki：高分辨率下更宽正文（右侧抽屉悬浮，不占正文列宽） */
.detail-wide {
  max-width: min(1280px, 95vw);
}

/* 完整 HTML 文档 Wiki：全宽直铺，无卡片外壳，仅保留顶部导航 */
.detail-full {
  max-width: 100%;
  padding: 0;
}

.html-doc-direct {
  width: 100%;
}

.html-doc-direct :deep(.doc-frame) {
  border: none;
  border-radius: 0;
  background: transparent;
}

.detail-error {
  color: #ff9d9d;
  font-size: 14px;
}

.detail-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 40px 0;
}

.post-card {
  padding: 28px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.post-head {
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.post-title {
  margin: 0 0 10px;
  font-size: 24px;
  line-height: 1.35;
}

.post-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}

.post-tag {
  color: var(--accent);
}

.post-hidden {
  color: #ffb35c;
  border: 1px solid color-mix(in srgb, #ffb35c 50%, transparent);
  border-radius: 4px;
  padding: 0 6px;
  font-size: 11px;
}

.post-actions {
  margin-top: 26px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 10px;
}

.btn-danger {
  color: #ff9d9d;
  border-color: color-mix(in srgb, #ff5c5c 50%, var(--border));
}

.btn-danger:hover {
  border-color: #ff5c5c;
}

/* 页面内标题滚动定位时给固定导航留出间距 */
.post-detail :deep(.markdown-body h1),
.post-detail :deep(.markdown-body h2),
.post-detail :deep(.markdown-body h3),
.post-detail :deep(.markdown-body h4),
.post-detail :deep(.markdown-body h5),
.post-detail :deep(.markdown-body h6) {
  scroll-margin-top: 70px;
}

/* ---------------- Wiki 右侧抽屉 ---------------- */

/* 右侧悬停热区：整条贴边条，鼠标移入自动滑出抽屉 */
.side-wrap {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 18px;
  z-index: 45;
}

.side-toggle {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 47;
  width: 18px;
  height: 72px;
  border-radius: 10px 0 0 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-right: none;
  color: var(--text);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.2);
}

.side-toggle:hover {
  background: var(--panel-2);
}

.wiki-side {
  position: absolute;
  top: 64px;
  right: 12px;
  bottom: 12px;
  width: 300px;
  z-index: 46;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.side-box {
  padding: 14px 16px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.side-title {
  margin: 0 0 10px;
  font-size: 14px;
}

.side-toc {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.side-toc a {
  color: var(--text);
  text-decoration: none;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-all;
  transition: background 0.15s ease, color 0.15s ease;
}

.side-toc a:hover {
  background: var(--panel);
  color: var(--accent);
}

/* 当前所在小节高亮 */
.side-toc a.active {
  background: var(--accent);
  color: #fff;
}

.side-toc .lv-2 {
  padding-left: 20px;
  font-size: 12.5px;
  color: var(--muted);
}

.side-toc .lv-2.active {
  color: #fff;
}

.side-toc .lv-3 {
  padding-left: 34px;
  font-size: 12px;
  color: var(--muted);
}

.side-toc .lv-3.active {
  color: #fff;
}

.side-toc .lv-4,
.side-toc .lv-5,
.side-toc .lv-6 {
  padding-left: 46px;
  font-size: 12px;
  color: var(--muted);
}

.side-toc .lv-4.active,
.side-toc .lv-5.active,
.side-toc .lv-6.active {
  color: #fff;
}

.side-empty {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
}

.side-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  margin-bottom: 6px;
}

.side-row span {
  color: var(--muted);
  white-space: nowrap;
}

.side-row b {
  font-weight: 600;
  text-align: right;
}

.side-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.side-actions {
  display: flex;
  gap: 8px;
}

.side-actions .btn-sm {
  padding: 6px 12px;
  font-size: 13px;
}

/* 遮罩仅窄屏需要（桌面悬停场景点击外部即滑回） */
.side-backdrop {
  display: none;
}

.side-enter-active,
.side-leave-active {
  transition: transform 0.25s ease;
}

.side-enter-from,
.side-leave-to {
  transform: translateX(110%);
}

/* 窄屏：抽屉贴边铺开，遮罩出现；按钮落到右下角（触屏用） */
@media (max-width: 960px) {
  .side-wrap {
    width: 20px;
  }

  .side-toggle {
    top: auto;
    bottom: 24px;
    transform: none;
    height: 56px;
    border-radius: 10px 0 0 10px;
  }

  .wiki-side {
    top: 0;
    right: 0;
    bottom: 0;
    width: min(320px, 88vw);
    border-radius: 12px 0 0 12px;
    padding: 56px 8px 12px;
    background: color-mix(in srgb, var(--panel) 92%, transparent);
  }

  .side-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 44;
    background: rgba(0, 0, 0, 0.35);
  }
}
</style>
