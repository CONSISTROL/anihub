<script setup>
// Wiki 条目列表页：支持「列表 / 拓扑图」两种视图切换。
// 视图状态同时保存在 URL query 与 localStorage 中：
// - URL 带 ?view=graph 时优先按 URL 显示（支持分享/前进后退）
// - URL 不带 view 时使用上次选择，因此从其它页面回到 /wiki 仍能保持拓扑图
// 切换动画：悬浮的“列表/拓扑图”按钮常驻，在两种视图各自锚点间平滑滑行；
// 视图内容以淡出/上移缩放过渡（列表 ↔ 星系）。
import { defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostList from '../components/PostList.vue'
import AppIcon from '../components/AppIcon.vue'
import { useAuth } from '../composables/useAuth'
import { immersiveView } from '../composables/uiOverlay'
import { exportWikiZip, importWikiZip } from '../api/posts'

// 拓扑图组件（three.js 星系渲染）只在切到“拓扑图”时下载/解析
const WikiGraphView = defineAsyncComponent({
  loader: () => import('../components/WikiGraphView.vue'),
  loadingComponent: {
    // 加载期间不显示任何等待文案，直接留空
    render: () => h('div'),
  },
})

const route = useRoute()
const router = useRouter()
const STORAGE_KEY = 'anihub.wiki-view'

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}
function writeStored(view) {
  try { localStorage.setItem(STORAGE_KEY, view) } catch {}
}
function resolveInitialView() {
  const q = route.query.view
  if (q === 'graph' || q === 'list') return q
  return readStored() === 'graph' ? 'graph' : 'list'
}

const viewMode = ref(resolveInitialView())
// 每次从拓扑图切回列表时 +1，强制重建列表组件
const listNonce = ref(0)

watch(
  () => route.query.view,
  (view) => {
    if (view === 'graph' || view === 'list') {
      viewMode.value = view
      writeStored(view)
    }
  }
)

function setMode(mode) {
  viewMode.value = mode
  writeStored(mode)
  if (mode === 'list') {
    listNonce.value++
    try { window.scrollTo({ top: 0 }) } catch (_) {}
  }
  const query = { ...route.query }
  if (mode === 'graph') query.view = 'graph'
  else delete query.view
  router.replace({ query })
}

// 拓扑图是“沉浸式整页视图”：置位全局标志，让回到底部/回到顶部等
// 文档滚动辅助按钮隐藏（拓扑页本身不可滚，出现即无意义）
function syncImmersive() {
  immersiveView.value = viewMode.value === 'graph'
}

// 拓扑图整页铺满：不改动站点滚动条/滚动条槽位设置（宽度恒定，离场不跳位），
// 高度按导航实际高度动态计算（消除底部白边），全站已有 scrollbar-gutter: stable 兜住右侧。
const graphFullEl = ref(null)// 星系区域底色（用于 .wiki-view 背景过渡 + 盖住右侧滚动条槽）
const GRAPH_BG = '#0b1322'
// 拓扑模式：不动 overflow / gutter / scrollbar 宽度（宽度恒定），
// 把根背景设为深空色并临时用 color-scheme: dark 让原生滚动条变深色 ——
// 右侧既无白条也无宽度/形态变化；离开时恢复。
function applyGraphLock(on) {
  const html = document.documentElement
  if (on) {
    html.style.backgroundColor = GRAPH_BG
    html.style.colorScheme = 'dark'
  } else {
    html.style.backgroundColor = ''
    html.style.colorScheme = ''
  }
}
function syncGraphHeight() {
  if (viewMode.value !== 'graph') return
  const nav = document.querySelector('.navbar')
  const top = nav ? Math.ceil(nav.getBoundingClientRect().bottom) : 0
  const h = Math.max(200, Math.floor(window.innerHeight - top))
  // 用 CSS 变量先于视图挂载定好高度：进场即正确尺寸，不会“先大后小”缩放
  document.documentElement.style.setProperty('--graph-h', h + 'px')
}
function onWindowResizeGraph() {
  if (viewMode.value === 'graph') syncGraphHeight()
}

// 背景色淡入淡出（列表透明 ↔ 拓扑底色）。无论从哪个入口进入/切到拓扑图都会播放：
// 先置透明 → 下一帧再写入目标色，让 CSS transition 真正产生过渡。
const wikiViewEl = ref(null)
let bgRaf = 0
function setPageBg(mode, animate) {
  const el = wikiViewEl.value
  if (!el) return
  cancelAnimationFrame(bgRaf)
  if (mode === 'list') {
    el.style.backgroundColor = 'transparent'
    return
  }
  const apply = () => {
    el.style.backgroundColor = GRAPH_BG
  }
  if (!animate) {
    apply()
    return
  }
  el.style.backgroundColor = 'transparent'
  void el.offsetWidth // 强制重排，确保从透明开始过渡
  bgRaf = requestAnimationFrame(() => {
    bgRaf = requestAnimationFrame(apply)
  })
}

watch(viewMode, (v) => {
  setPageBg(v, true)
  applyGraphLock(v === 'graph')
  syncImmersive()
  if (v === 'graph') {
    // 立刻写好高度变量（新视图尚未挂载也不会有“先大后小”）
    syncGraphHeight()
    requestAnimationFrame(() => requestAnimationFrame(syncGraphHeight))
    window.addEventListener('resize', onWindowResizeGraph)
  } else {
    window.removeEventListener('resize', onWindowResizeGraph)
  }
})
function onViewEnter() {
  requestAnimationFrame(() => requestAnimationFrame(syncGraphHeight))
}
onMounted(() => {
  // 直接进入拓扑页（其它页面导航过来 / 刷新 / 分享链接）也要有背景淡入
  setPageBg(viewMode.value, viewMode.value === 'graph')
  applyGraphLock(viewMode.value === 'graph')
  syncImmersive()
  if (viewMode.value === 'graph') {
    syncGraphHeight()
    window.addEventListener('resize', onWindowResizeGraph)
    requestAnimationFrame(() => requestAnimationFrame(syncGraphHeight))
  }
})
onBeforeUnmount(() => {
  cancelAnimationFrame(bgRaf)
  window.removeEventListener('resize', onWindowResizeGraph)
  applyGraphLock(false)
  syncImmersive()
})

// —— 管理员批量导出 / 导入（wiki）——
const { isLoggedIn } = useAuth()
const xferBusy = ref(false)
const xferMsg = ref('')
const xferErr = ref(false)
const fileInput = ref(null)

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function doExport() {
  xferBusy.value = true
  xferMsg.value = ''
  xferErr.value = false
  try {
    const blob = await exportWikiZip()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wiki-backup-${stamp()}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    xferMsg.value = `已导出 ${a.download}（${(blob.size / 1024).toFixed(0)} KB）`
  } catch (e) {
    xferErr.value = true
    xferMsg.value = `导出失败：${e.message}`
  } finally {
    xferBusy.value = false
  }
}

async function onImportFile(e) {
  const f = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!f) return
  xferBusy.value = true
  xferMsg.value = ''
  xferErr.value = false
  try {
    const r = await importWikiZip(f)
    const parts = [`新增 ${r.imported}`, `跳过 ${r.skipped}`]
    if (r.images) parts.push(`图片：写入 ${r.images.written} / 已存在 ${r.images.skipped} / 缺失 ${r.images.missing}`)
    xferMsg.value = `导入完成：${parts.join(' · ')}`
    if (r.errors && r.errors.length) {
      xferErr.value = true
      xferMsg.value += `（${r.errors.length} 条问题，详见控制台）`
      console.warn('[wiki-import]', r.errors)
    }
  } catch (err) {
    xferErr.value = true
    xferMsg.value = `导入失败：${err.message}`
  } finally {
    xferBusy.value = false
  }
}
</script>

<template>
  <div ref="wikiViewEl" class="wiki-view">
    <!-- 视图内容（淡出 → 进入，带轻微上移/缩放） -->
    <Transition name="view" mode="out-in" @after-enter="onViewEnter">
      <div :key="viewMode" :class="['view-body', viewMode]">
        <!-- 拓扑图：整页星系（不显示页面标题 / 批量管理） -->
        <div v-if="viewMode === 'graph'" ref="graphFullEl" class="graph-full">
          <!-- 天幕背景层：半透明深空面纱 + 站点壁纸（无壁纸时退化为纯色，观感不变）。
               透明度见下方 .graph-sky 的 --graph-sky-alpha 注释 -->
          <div class="graph-sky" aria-hidden="true"></div>
          <WikiGraphView />
        </div>

        <!-- 列表视图：常规页面 -->
        <div v-else class="page">
          <div class="page-head">
            <h1 class="page-title"><AppIcon name="book-open" :size="22" /> Wiki</h1>
          </div>

          <PostList :key="'list-' + listNonce" category="wiki">
            <!-- 批量导出 / 导入直接放在工具栏（搜索/新建条目 旁边） -->
            <template v-if="isLoggedIn" #actions>
              <button type="button" class="btn" :disabled="xferBusy" @click="doExport">
                导出全部 (.zip)
              </button>
              <button type="button" class="btn" :disabled="xferBusy" @click="fileInput?.click()">
                导入备份
              </button>
              <input
                ref="fileInput"
                type="file"
                accept=".zip,application/zip"
                class="file-input"
                @change="onImportFile"
              />
              <span v-if="xferBusy" class="admin-status">处理中…</span>
              <span v-else-if="xferMsg" class="admin-status" :class="{ err: xferErr }">{{ xferMsg }}</span>
            </template>
          </PostList>
        </div>
      </div>
    </Transition>

    <!-- 视图切换按钮：两种视图固定在同一位置（右上角），不移动不跳变 -->
    <div
      class="view-float"
      :class="{ 'on-graph': viewMode === 'graph' }"
      role="tablist"
      aria-label="Wiki 视图切换"
    >
      <button
        type="button"
        role="tab"
        :aria-selected="viewMode === 'list'"
        :class="{ on: viewMode === 'list' }"
        @click="setMode('list')"
      >
        列表
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="viewMode === 'graph'"
        :class="{ on: viewMode === 'graph' }"
        @click="setMode('graph')"
      >
        拓扑图
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 页面容器：切换按钮用相对定位挂在其右上角（导航条下方的 page 区域内）。
   背景色（透明 ↔ 拓扑底色）由 JS 控制淡入淡出，见 setPageBg()。 */
.wiki-view {
  position: relative;
  min-height: 60vh;
  background-color: transparent;
  transition: background-color var(--dur-ios-3) var(--ease-ios-expo);
}

/* —— 视图切换过渡：纯淡入淡出，不做位移/缩放，避免背景抖动 —— */
.view-enter-active,
.view-leave-active {
  transition: opacity var(--dur-ios-2) var(--ease-ios-expo);
}
.view-enter-from,
.view-leave-to {
  opacity: 0;
}

/* —— 视图切换按钮：固定在 page 右上角（导航条下方），列表/拓扑图同一位置；随主题配色 —— */
.view-float {
  position: absolute;
  top: 12px;
  right: 14px;
  z-index: 220;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: color-mix(in srgb, var(--panel) 84%, transparent);
  border: 1px solid var(--border);
  border-radius: 10px;
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.18);
  animation: float-in 0.4s ease var(--dur-ios-1) backwards;
}

@keyframes float-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.view-float button {
  flex: 1;
  padding: 5px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--dur-ios-1) var(--ease-ios-expo),
    background var(--dur-ios-1) var(--ease-ios-expo);
}

.view-float button:hover {
  color: var(--text);
}

.view-float button.on {
  background: var(--accent);
  color: #fff;
}

/* 在拓扑图（深空区）里：切换按钮固定为深色玻璃浅字，不随站点主题变浅 */
.view-float.on-graph {
  background: rgba(16, 21, 36, 0.82);
  border-color: rgba(255, 255, 255, 0.16);
}

.view-float.on-graph button {
  color: #cfd9ec;
}

.view-float.on-graph button:hover {
  color: #fff;
}

.graph-full {
  position: relative;
  width: 100%;
  /* 高度由 JS 在进入视图前算好写入 --graph-h，避免进场后收缩；兜底铺满视口 */
  height: var(--graph-h, 100dvh);
  min-height: 560px;
  overflow: hidden;
}

/* 天幕背景层：最底为不透明深空色（无壁纸时的观感与原来一致），
   中间叠站点壁纸（--wallpaper-url，继承自 <html>），最上罩半透明深空面纱。
   面纱 alpha = 0.8：壁纸透过 20%；数值调小壁纸更明显（可读性下降），调大则更接近纯深空。 */
.graph-sky {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-color: #0b1322;
  background-image:
    linear-gradient(180deg, rgba(11, 19, 34, 0.8), rgba(11, 19, 34, 0.8)),
    var(--wallpaper-url, none);
  background-size: auto, cover;
  background-position: center;
}

.graph-full :deep(.wiki-graph) {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1; /* 盖在天幕背景层之上 */
}

.graph-full :deep(.filter-bar) {
  flex: 0 0 auto;
}

.graph-full :deep(.graph-space) {
  flex: 1 1 auto;
  height: auto !important;
  min-height: 0;
  border: 0;
  border-radius: 0;
}

.page {
  max-width: min(1320px, 95vw);
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 24px;
}

.file-input {
  display: none;
}

.admin-status {
  font-size: 12px;
  color: var(--muted);
}

.admin-status.err {
  color: #ff9d9d;
}

@media (max-width: 640px) {
  .page-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
