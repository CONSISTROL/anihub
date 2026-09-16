<script setup>
// 文章列表（博客/Wiki 共用）：搜索、分页、新建入口；博客支持置顶（置顶篇即主页公告）
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { listPosts, pinPost, downloadWikiZip } from '../api/posts'
import { useAuth } from '../composables/useAuth'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  category: { type: String, required: true }, // 'blog' | 'wiki'
})

const { isLoggedIn, isInsider } = useAuth()

// 下载单条 Wiki：内部人员与管理员都可用（游客没有入口 —— 服务端也会拒 401）。
// wiki 条目分 md / html 两种，下载的是该条正文原格式 + 它引用的图片，打包成 zip。
const downloadingId = ref(null)
const downloadMsg = ref('')
const downloadErr = ref(false)
async function doDownload(p) {
  if (downloadingId.value) return
  downloadingId.value = p.id
  downloadMsg.value = ''
  downloadErr.value = false
  try {
    const { blob, name } = await downloadWikiZip(p)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 交给浏览器读完再释放，立刻 revoke 会让部分浏览器拿到空文件
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    downloadMsg.value = `已下载 ${name}（${(blob.size / 1024).toFixed(0)} KB）`
  } catch (e) {
    downloadErr.value = true
    downloadMsg.value = `下载失败：${e.message}`
  } finally {
    downloadingId.value = null
  }
}

const items = ref([])
const total = ref(0)
const page = ref(1)
// Wiki 卡片较紧凑，一页多拉一些，避免高分辨率屏只显示几行很空；博客保持 10 篇
const pageSize = ref(props.category === 'wiki' ? 24 : 10)
const q = ref('')
const loading = ref(true)
const error = ref('')
const actionError = ref('') // 置顶等操作的错误（与加载错误分开显示）
const pinningId = ref(0)

// 骨架屏：等一小会儿再出现。
// 命中缓存/本地服务很快时（<150ms）直接出内容，避免"骨架屏闪一下又消失"的抖动感。
const SKELETON_DELAY = 150
const showSkeleton = ref(false)
let skeletonTimer = 0
function armSkeleton() {
  clearTimeout(skeletonTimer)
  showSkeleton.value = false
  skeletonTimer = setTimeout(() => {
    skeletonTimer = 0
    if (loading.value) showSkeleton.value = true
  }, SKELETON_DELAY)
}
function disarmSkeleton() {
  clearTimeout(skeletonTimer)
  skeletonTimer = 0
  showSkeleton.value = false
}
onBeforeUnmount(disarmSkeleton)

// 骨架条数：靠近一屏能容纳的量，不必按 pageSize 全铺（避免几十行无意义占位）
const skeletonRows = computed(() => (props.category === 'wiki' ? 6 : 5))

async function load() {
  loading.value = true
  error.value = ''
  armSkeleton()
  try {
    const data = await listPosts({
      category: props.category,
      page: page.value,
      pageSize: pageSize.value,
      q: q.value || undefined,
    })
    items.value = data.items
    total.value = data.total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    disarmSkeleton()
  }
}

watch(() => props.category, () => {
  pageSize.value = props.category === 'wiki' ? 24 : 10
  page.value = 1
  load()
}, { immediate: true })

// 逐条入场动画：
//   之前是手写 nth-child(1..4) 各一个延迟，第 5 条起统一 240ms ——
//   于是"前 4 条依次弹出、剩下的（wiki 一页 24 条）一下全出来"，观感很割裂。
// 现在按序号线性递增，并把**总错峰时长**限制在 STAGGER_TOTAL 内：
//   条目少时接近"每条约 80ms"的节奏；条目多时自动收紧到每条约 20ms，
//   整体像一道快速扫过的波，而不是分两批冒出来。
const STAGGER_TOTAL = 440 // 最后一条的延迟上限（ms）
const STAGGER_MIN_STEP = 18 // 每条至少间隔，避免太挤看不出顺序
function staggerDelay(i, total) {
  if (total <= 1) return 0
  const step = Math.max(STAGGER_MIN_STEP, Math.min(80, STAGGER_TOTAL / (total - 1)))
  return Math.round(Math.min(i * step, STAGGER_TOTAL))
}

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize.value))

function onSearch() {
  page.value = 1
  load()
}

async function togglePin(p) {
  pinningId.value = p.id
  actionError.value = ''
  try {
    const updated = await pinPost(p.id, !p.pinned)
    p.pinned = updated.pinned
  } catch (e) {
    actionError.value = e.message
  } finally {
    pinningId.value = 0
  }
}

function fmtDate(s) {
  const d = new Date(s + 'Z')
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const VIS_LABEL = { insider: '仅内部可见', private: '仅管理员可见' }
</script>

<template>
  <div class="post-list" :class="category">
    <div class="toolbar">
      <form class="search" @submit.prevent="onSearch">
        <input v-model.trim="q" placeholder="搜索标题 / 内容 / 标签…" />
        <button class="btn" type="submit"><AppIcon name="search" :size="13" /> 搜索</button>
      </form>
      <router-link v-if="isLoggedIn" :to="`/${category}/new`" class="btn btn-primary">
        <AppIcon name="plus" :size="13" :stroke-width="2" />
        新建{{ category === 'blog' ? '文章' : '条目' }}
      </router-link>
      <!-- 供页面注入的管理操作（如 Wiki 批量导出/导入），紧随搜索与新建入口 -->
      <slot name="actions" />
    </div>

    <p v-if="error" class="list-error">{{ error }}</p>

    <!-- 加载态：骨架屏（形状与真实条目一致，加载完成不发生跳版）
         结构与 .post-item 完全同构：博客是整行条目（2 行摘要 + 右侧箭头），
         Wiki 是自适应多列卡片（3 行摘要 + 无箭头），下面的 .wiki 覆盖规则负责区分。 -->
    <div
      v-else-if="loading"
      class="skeleton-wrap"
      :class="[category, { 'is-visible': showSkeleton }]"
      role="status"
      aria-live="polite"
    >
      <span class="sr-only">加载中…</span>
      <div class="post-items" aria-hidden="true">
        <div v-for="n in skeletonRows" :key="n" class="post-item sk-item" :style="{ '--i': n - 1 }">
          <div class="post-main">
            <span class="sk-line sk-title"></span>
            <span class="sk-line sk-summary"></span>
            <span class="sk-line sk-summary sk-summary-2"></span>
            <span class="sk-line sk-summary sk-summary-3"></span>
            <div class="post-meta">
              <span class="sk-chip"></span>
              <span class="sk-chip sk-chip-sm"></span>
              <span class="sk-chip sk-chip-sm"></span>
            </div>
          </div>
          <span class="post-go sk-go"></span>
        </div>
      </div>
    </div>

    <p v-else-if="!items.length" class="list-hint">还没有{{ category === 'blog' ? '文章' : '条目' }}，来写第一篇吧</p>

    <template v-else>
      <p v-if="actionError" class="list-error">{{ actionError }}</p>
      <p v-if="downloadMsg" class="list-hint download-status" :class="{ err: downloadErr }">{{ downloadMsg }}</p>
      <div class="post-items">
        <div
          v-for="(p, i) in items"
          :key="p.id"
          class="post-item"
          :class="{ 'is-pinned': p.pinned }"
          :style="{ '--stagger': staggerDelay(i, items.length) + 'ms' }"
        >
          <router-link :to="`/${category}/${p.slug}`" class="post-body">
            <div class="post-main">
              <h3 class="post-title">
                <span v-if="p.pinned" class="pin-badge"><AppIcon name="pin" :size="12" /> 公告</span>
                {{ p.title }}
              </h3>
              <p v-if="p.summary" class="post-summary">{{ p.summary }}</p>
              <div class="post-meta">
                <span class="post-author">{{ p.authorName }}</span>
                <span class="post-date">{{ fmtDate(p.createdAt) }}</span>
                <span v-if="p.visibility !== 'public'" class="post-hidden">{{ VIS_LABEL[p.visibility] || p.visibility }}</span>
                <span v-for="t in p.tags" :key="t" class="post-tag">#{{ t }}</span>
              </div>
            </div>
            <span class="post-go"><AppIcon name="chevron-right" :size="17" /></span>
          </router-link>
          <div v-if="isLoggedIn && category === 'blog'" class="post-actions">
            <button class="btn btn-sm" :disabled="pinningId === p.id" @click="togglePin(p)">
              {{ pinningId === p.id ? '…' : p.pinned ? '取消置顶' : '置顶' }}
            </button>
          </div>
          <!-- Wiki 单条下载：内部人员与管理员可见（游客没有入口；服务端同样会拒） -->
          <div v-else-if="(isLoggedIn || isInsider) && category === 'wiki'" class="post-actions">
            <button
              class="btn btn-sm"
              :disabled="downloadingId === p.id"
              :title="`下载该条目（正文 + 引用的图片，打包为 zip）`"
              @click="doDownload(p)"
            >
              <AppIcon name="download" :size="13" /> {{ downloadingId === p.id ? '…' : '下载' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-if="totalPages() > 1" class="pager">
      <button class="btn" :disabled="page <= 1" @click="page--; load()"><AppIcon name="chevron-left" :size="13" /> 上一页</button>
      <span class="pager-info">{{ page }} / {{ totalPages() }} · 共 {{ total }} {{ category === 'blog' ? '篇' : '条' }}</span>
      <button class="btn" :disabled="page >= totalPages()" @click="page++; load()">下一页 <AppIcon name="chevron-right" :size="13" /></button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.search {
  display: flex;
  gap: 8px;
  flex: 1;
}

.search input {
  flex: 1;
  max-width: 320px;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
}

.search input:focus {
  border-color: var(--accent);
}

.list-error {
  color: var(--danger);
  font-size: 14px;
  margin-bottom: 10px;
}

.list-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 40px 0;
}

/* —— 加载骨架屏 ——
   形状与真实条目一致（同样的 .post-item 外壳 + 相同内边距），
   因此内容到达时只是"占位块被文字替换"，不会有跳版。
   整体淡入：延迟到期才显示，极快返回时不闪。 */
.skeleton-wrap {
  opacity: 0;
  transition: opacity var(--dur-ios-2) var(--ease-ios-expo);
}

.skeleton-wrap.is-visible {
  opacity: 1;
}

/* 骨架条目自身不做入场动画（它是"等待"而不是"内容"）。
   注意必须写 `.post-items .sk-item`：`.sk-item` 与 `.post-item` 同为单类选择器、
   特异性相同，而 `.post-item` 的 animation 规则在源序上更靠后就会胜出
   （实测骨架条目确实拿到了 ios-rise-in，跟着一起错峰弹入）。
   这里用同前缀提高特异性，并与 .post-item 的写法对齐。 */
.post-items .sk-item {
  animation: none;
  pointer-events: none;
}

.sk-line,
.sk-chip {
  display: block;
  border-radius: 6px;
  background: linear-gradient(
    100deg,
    color-mix(in srgb, var(--text) 9%, transparent) 30%,
    color-mix(in srgb, var(--text) 17%, transparent) 50%,
    color-mix(in srgb, var(--text) 9%, transparent) 70%
  );
  background-size: 220% 100%;
  animation: sk-shimmer 1.5s var(--ease-ios) infinite;
}

@keyframes sk-shimmer {
  from {
    background-position: 140% 0;
  }
  to {
    background-position: -40% 0;
  }
}

.sk-title {
  width: 42%;
  height: 15px;
  margin-bottom: 10px;
}

/* 摘要占位按"真实摘要最多两行"给高度（.post-summary 是 line-clamp: 2），
   否则骨架比真实条目矮 20px，内容到达时会整体上跳。 */
.sk-summary {
  width: 88%;
  height: 13px;
  margin-bottom: 8px;
}

.sk-summary-2 {
  width: 62%;
  margin-bottom: 8px;
}

/* 第三行占位只在 Wiki 卡片里显示（那边摘要 clamp 3 行），博客条目是 2 行 */
.sk-summary-3 {
  display: none;
}

/* —— Wiki 卡片：跟着 .wiki .post-item 的真实形状走 ——
   更紧凑的标题、3 行摘要、无右侧箭头、更小的行间距 */
.wiki .sk-summary-3 {
  display: block;
  width: 74%;
}

.wiki .sk-title {
  height: 14px;
  margin-bottom: 7px;
}

.wiki .sk-summary {
  height: 11px;
  margin-bottom: 6px;
}

.wiki .sk-go {
  display: none;
}

.wiki .sk-item {
  padding: 14px 16px;
}

.sk-chip {
  width: 76px;
  height: 10px;
  border-radius: 999px;
}

.sk-chip-sm {
  width: 48px;
}

.sk-go {
  width: 17px;
  height: 17px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text) 10%, transparent);
  animation: sk-shimmer 1.5s var(--ease-ios) infinite;
  background-size: 220% 100%;
}

/* 逐行错峰：让等待态也有节奏，而不是整块一起呼吸 */
.sk-item:nth-child(1) .sk-line,
.sk-item:nth-child(1) .sk-chip,
.sk-item:nth-child(1) .sk-go {
  animation-delay: 0ms;
}
.sk-item:nth-child(2) .sk-line,
.sk-item:nth-child(2) .sk-chip,
.sk-item:nth-child(2) .sk-go {
  animation-delay: 90ms;
}
.sk-item:nth-child(3) .sk-line,
.sk-item:nth-child(3) .sk-chip,
.sk-item:nth-child(3) .sk-go {
  animation-delay: 180ms;
}
.sk-item:nth-child(4) .sk-line,
.sk-item:nth-child(4) .sk-chip,
.sk-item:nth-child(4) .sk-go {
  animation-delay: 270ms;
}
.sk-item:nth-child(n + 5) .sk-line,
.sk-item:nth-child(n + 5) .sk-chip,
.sk-item:nth-child(n + 5) .sk-go {
  animation-delay: 360ms;
}

/* 无障碍：视觉隐藏但读屏可读 */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .sk-line,
  .sk-chip,
  .sk-go {
    animation: none;
  }
}

.post-items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.post-item {
  display: flex;
  align-items: stretch;
  gap: 12px;
  padding: 16px 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
  animation: ios-rise-in var(--dur-ios-3) var(--ease-ios-expo) backwards;
  /* 逐条错峰入场：延迟按序号线性递增，但**总错峰时长有上限**，
     因此条目多时不会出现"前几条依次弹出、剩下的挤在一起"。
     延迟值由 JS 按条目数算好（见 staggerDelay），这里只消费。 */
  animation-delay: var(--stagger, 0ms);
}

.post-item:hover {
  border-color: var(--accent);
  transform: translateX(4px);
  box-shadow: 0 8px 22px rgb(0 0 0 / 0.1);
}

.post-item:active {
  transform: translateX(2px) scale(0.995);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

/* Wiki 列表：不占用整行，改为自适应多列卡片，减少横向空白 */
.wiki .post-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 14px;
}

.wiki .post-item {
  padding: 14px 16px;
}

.wiki .post-body {
  align-items: flex-start;
}

.wiki .post-title {
  white-space: normal;
  line-height: 1.45;
  margin-bottom: 6px;
}

.wiki .post-summary {
  -webkit-line-clamp: 3;
}

.wiki .post-meta {
  flex-wrap: wrap;
  gap: 6px 10px;
}

.wiki .post-go {
  display: none;
}

.wiki .post-item:hover {
  transform: translateY(-2px);
}

.wiki .post-item:active {
  transform: scale(0.985);
}

/* 置顶公告条目高亮 */
.post-item.is-pinned {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--panel));
}

.post-body {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: var(--text);
}

.post-main {
  flex: 1;
  min-width: 0;
}

.post-title {
  margin: 0 0 4px;
  font-size: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pin-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-right: 6px;
  font-size: 11px;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-radius: 4px;
  padding: 1px 6px;
  vertical-align: 2px;
}

.post-summary {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}

.post-tag {
  color: var(--accent);
}

.post-hidden {
  color: var(--warning);
  border: 1px solid color-mix(in srgb, var(--warning) 50%, transparent);
  border-radius: 4px;
  padding: 0 6px;
  font-size: 11px;
}

.post-go {
  display: flex;
  align-items: center;
  color: var(--accent);
}

.post-actions {
  display: flex;
  align-items: center;
}

/* 下载结果提示（成功/失败共用一行，失败时变红） */
.download-status {
  margin: 0 0 10px;
}
.download-status.err {
  color: var(--danger, #e5484d);
}

.btn-sm {
  padding: 3px 9px;
  font-size: 12px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 20px;
}

.pager-info {
  font-size: 13px;
  color: var(--muted);
}
</style>
