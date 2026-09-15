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
import {
  WIKI_VIEW_STORAGE_KEY,
  readStoredWikiView,
  writeStoredWikiView,
  resolveWikiView,
  prefetchWikiGraph,
} from '../wikiView'

// 拓扑图组件（three.js 星系渲染）只在切到“拓扑图”时下载/解析。
// three.js 分包接近 200KB（gzip 后约 130KB），首次进入需要等待，
// 因此这里给一个与深空底色一致的等待态，而不是留空（留空会让人以为页面坏了/卡住）。
const WikiGraphView = defineAsyncComponent({
  loader: () => import('../components/WikiGraphView.vue'),
  loadingComponent: {
    render() {
      return h(
        'div',
        { class: 'graph-loading' },
        [h('div', { class: 'graph-loading-spinner' }), h('p', null, '拓扑图加载中…')]
      )
    },
  },
  delay: 120, // 极快命中缓存时不闪一下
  timeout: 30000,
})

const route = useRoute()
const router = useRouter()
const STORAGE_KEY = WIKI_VIEW_STORAGE_KEY

const readStored = readStoredWikiView
const writeStored = writeStoredWikiView
const resolveInitialView = resolveWikiView

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

// 悬停 / 聚焦「拓扑图」按钮就把 three.js 那个 527KB 的分包与拓扑图数据预先拉起来
// （幂等、慢网自动跳过，见 wikiView.js 的 prefetchWikiGraph）。
// ⚠ 刻意**不**在列表页空闲时预取：只看列表的访客不该平白多下 130KB（gzip）。
function onGraphHint() {
  prefetchWikiGraph()
}

// 天幕的挂载时序说明：
// `.graph-sky` 随 `v-if` 挂载，但它**不需要自己再设一层 opacity 淡入** ——
// 它的父级 `.view-body` 已经由 `<Transition name="view">` 做了 0 → 1 的淡入
// （`.view-enter-from { opacity: 0 }` + `.view-enter-active { transition: opacity 260ms }`），
// 天幕作为子元素自然跟着淡入。
// ⚠ 曾在这里额外加过一层 `.graph-sky { opacity: 0 }` + `is-in` 类：不但多余，
//   而且实测**加类与元素挂载落在同一帧**（逐帧记录：元素首次出现时 class 已是
//   `graph-sky is-in`、opacity 已是 1），过渡根本不播 —— 白写一层。
//   结论：淡入交给父级的 view 过渡，天幕自己只管铺满与终色。

// 拓扑图是“沉浸式整页视图”：置位全局标志，让回到底部/回到顶部等
// 文档滚动辅助按钮隐藏（拓扑页本身不可滚，出现即无意义）。
// 注意：导航栏**不再**依赖这个标志 —— 它直接从路由推导深空态。
// 原因是导航栏位于路由视图之外，用这种副作用标志容易出现不同步
// （曾出现：从拓扑图直接点导航去别的页面后，导航栏一直是深色）。
// 这里的标志只服务于滚动辅助按钮，且卸载时必须显式清除：
// 卸载发生在路由已离开 /wiki 之后，此时 viewMode 仍是 'graph'，
// 若按 viewMode 重新推导会把标志又置回 true。
function syncImmersive(force) {
  immersiveView.value = force === undefined ? viewMode.value === 'graph' : force === true
}

// 拓扑图整页铺满：不改动站点滚动条/滚动条槽位设置（宽度恒定，离场不跳位），
// 高度按导航实际高度动态计算（消除底部白边），全站已有 scrollbar-gutter: stable 兜住右侧。
const graphFullEl = ref(null)// 星系区域底色（用于 .wiki-view 背景过渡 + 盖住右侧滚动条槽）
const GRAPH_BG = '#0b1322'
// 深空面纱：85% 不透明的 #0b1322，壁纸会透出 15%，保留背景质感但足够暗。
// 必须与 .graph-sky 用的是**同一个值**（见该处 CSS 里的 --graph-veil），
// 否则 .wiki-view 的过渡终色与天幕最终呈现不一致，拓扑挂载时会出现亮度台阶。
const GRAPH_VEIL_ALPHA = 0.82
const GRAPH_VEIL = `rgb(11 19 34 / ${GRAPH_VEIL_ALPHA})`
// 拓扑模式：**不要**给 <html> 刷深空底色。
//
// 原因：全站壁纸是 .app-shell 内一个 position:fixed 的图层（z-index:-1），
// 往 <html> 上写 backgroundColor 会把它整个盖住 —— 而导航栏的 backdrop-filter
// 只糊它正后方的内容，于是顶栏从「壁纸 + 玻璃」变成「深空纯色 + 玻璃」，
// 在浅色主题下表现为一块近白色（#F8F9FC），与其它页面的壁纸色（#89B6E2~#BCD5EE）明显不一致。
//
// 深空背景由拓扑区域自己负责：.graph-full / .graph-sky 是不透明的 #0b1322，
// 且该视图 height = 视口高 - 导航高、不产生文档滚动，所以页面上不存在"露出白边"的区域。
// colorScheme 仍然保留：它只影响原生滚动条/表单控件的配色，不参与背景绘制。
function applyGraphLock(on) {
  const html = document.documentElement
  html.style.colorScheme = on ? 'dark' : ''
}
// —— 离场守卫 ——
// 组件被卸载时（从拓扑页切到别的页面），下面这几个"按导航栏底部算高度"的逻辑
// 还会再跑一次，而此时离场过渡已经给旧视图加了 `translateY`，
// `nav.getBoundingClientRect().bottom` 落在一个"过渡中"的位置上，
// 于是算出的高度会跳变，把天幕图层（.graph-sky）整层上/下平移一截 ——
// 实测 `sky` 从 `0..748` 瞬间变成 `49..797`，露出的那一条正是**筛选条那几行**，
// 表现就是"离开拓扑页时背景前几行发亮、一闪而过"。
// 视图马上要没了，重算毫无意义，所以卸载起就整段停掉。
let unmounting = false

function syncGraphHeight() {
  if (unmounting) return
  if (viewMode.value !== 'graph') return
  const nav = document.querySelector('.navbar')
  const top = nav ? Math.ceil(nav.getBoundingClientRect().bottom) : 0
  const h = Math.max(200, Math.floor(window.innerHeight - top))
  // 用 CSS 变量先于视图挂载定好高度：进场即正确尺寸，不会“先大后小”缩放
  document.documentElement.style.setProperty('--graph-h', h + 'px')
}
function onWindowResizeGraph() {
  if (unmounting) return
  if (viewMode.value === 'graph') syncGraphHeight()
}

// 背景色（列表透明 ↔ 拓扑底色）。
// ⚠ **不做淡入淡出**：直接写入目标色。用户明确要求去掉"列表 → 拓扑图"的背景淡入效果。
//   早先的实现是"先置 transparent → 下一帧写目标色 + 挂 .bg-fading 过渡类 → 300ms 后摘类"，
//   那套时序既脆又难对齐（内容淡入 260ms、背景 300ms、还得用定时器收尾），
//   实测观感就是"背景单独拖一条尾巴、衔接不自然"。现在没有过渡，写入即生效。
const wikiViewEl = ref(null)
function setPageBg(mode) {
  const el = wikiViewEl.value
  if (!el) return
  el.style.backgroundColor = mode === 'graph' ? GRAPH_VEIL : 'transparent'
}

watch(viewMode, (v) => {
  setPageBg(v)
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
  // 直接进入拓扑页（其它页面导航过来 / 刷新 / 分享链接）：立刻写入底色，不做过渡
  setPageBg(viewMode.value)
  applyGraphLock(viewMode.value === 'graph')
  syncImmersive()
  if (viewMode.value === 'graph') {
    syncGraphHeight()
    window.addEventListener('resize', onWindowResizeGraph)
    requestAnimationFrame(() => requestAnimationFrame(syncGraphHeight))
  }
})
onBeforeUnmount(() => {
  // ⚠ 第一件事就把守卫立起来：下面的 rAF（onViewEnter / watch 里排的那两个）
  // 会在卸载之后才执行，不拦住的话它们会拿"过渡中"的导航栏位置重算天幕高度，
  // 把 .graph-sky 整层平移一截，离场时顶部几行就会亮一下（见 syncGraphHeight 注释）
  unmounting = true
  window.removeEventListener('resize', onWindowResizeGraph)
  applyGraphLock(false)
  // 显式清除（不能用 syncImmersive() 按 viewMode 重新推导：卸载时 viewMode 仍是 graph）
  syncImmersive(false)
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
          <!-- 天幕背景层：站点壁纸 + 深空面纱（无壁纸时退化为纯色，观感不变）。
               尺寸与取景跟 .wallpaper-layer 完全一致，因此全站背景位置/缩放都相同。
               它铺满整个视口，顶栏下方的筛选条也在这层之上 —— 筛选条自身透明，
               于是上下取自同一层背景，不会割裂。 -->
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
        @pointerenter="onGraphHint"
        @focus="onGraphHint"
        @click="setMode('graph')"
      >
        拓扑图
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 页面容器：切换按钮用相对定位挂在其右上角（导航条下方的 page 区域内）。
   背景色（透明 ↔ 拓扑底色）由 JS 直接写入，见 setPageBg()。

   ⚠ **这里刻意没有任何 transition**（用户要求去掉"列表 → 拓扑图"的背景淡入）。
   曾经有过一版 `.bg-fading { transition: background-color 300ms }`，只在切换瞬间挂类、
   300ms 后用定时器摘掉。那套之所以要这么绕，是因为路由切换用的
   `<Transition name="page" mode="out-in">` 会读取**离场元素自身**的 transition 属性作为离场时长：
   根元素上常驻 background-color(380ms) 会把"wiki → 其它页面"的离场拖到 ~400ms
   （对照：tools → blog 只要 ~180ms），表现为切到目标页时卡一下。
   现在直接写入颜色、没有过渡，上面这些时序问题一并消失。 */
.wiki-view {
  position: relative;
  min-height: 60vh;
  background-color: transparent;
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

/* ⚠⚠ 拓扑页离场时**必须去掉 transform**（只留 opacity）。
   原因：`.graph-sky` 是 `position: fixed; inset: 0`，而**带 transform 的元素会成为
   fixed 后代的包含块**。路由离场过渡（`.page-leave-active`）会给本视图加
   `translateY(-8px) scale(0.996)`，于是天幕的"视口"变成"本视图的盒子" ——
   实测天幕 rect 从 `[0,748]`（铺满视口）跳到 `[49,797]`，**把 y 49~93 那一条让了出来**，
   露出的正是未压暗的壁纸：表现就是"离开拓扑页时背景前几行发亮、一闪而过"。
   这里把拓扑图的离场过渡限定为纯 opacity —— 少了一点上移位移（肉眼几乎看不出），
   换来天幕在离场全程稳稳铺住视口。 */
.wiki-view.page-leave-active {
  transition: opacity var(--dur-ios-1) var(--ease-ios);
}
.wiki-view.page-leave-to {
  transform: none;
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
  /* 注意：**不能** overflow: hidden —— 天幕要靠负 top 向上延伸盖住筛选条那一条，
     一旦裁掉，筛选条就会露出"未被面纱压过的原始壁纸"，与下方星图区割裂
     （这一条踩过一次）。水平方向用 clip 兜住即可。 */
  overflow-x: clip;
}

/* 异步加载 three.js 分包期间的等待态：与天幕同色，不出现白闪 */
.graph-loading {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #9fb0d0;
  font-size: 13px;
  background: #0b1322;
}

.graph-loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid rgb(255 255 255 / 0.16);
  border-top-color: #7d9aff;
  border-radius: 50%;
  animation: graph-spin 0.9s linear infinite;
}

@keyframes graph-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 天幕背景层：最底为不透明深空色（无壁纸时的观感与原来一致），
   中间叠站点壁纸（--wallpaper-url，继承自 <html>），最上罩半透明深空面纱。
   面纱 alpha = 0.8：壁纸透过 20%；数值调小壁纸更明显（可读性下降），调大则更接近纯深空。 */
/* 天幕背景层：站点壁纸 + 深空面纱（保留壁纸质感，但压到足够暗）。
   ── 两个必须注意的点 ──
   1) CSS 里 `background-color` 画在**所有背景图之下**，所以不能靠"底色 + 半透明渐变盖住壁纸"
      的方式来做纯色（底色会被渐变挡掉，实际亮度以渐变+壁纸为准）。
   2) 切换的**平滑**取决于：.wiki-view 的过渡终色与这里的天幕最终呈现一致。
      两者都用 85% 深空面纱（同一个变量 --graph-veil），拓扑挂载时天幕出现不会带来亮度台阶；
      过渡全程壁纸始终可见，只是从"原亮度"渐渐压暗，不会出现"先变纯色再亮回壁纸"的闪动。 */
.graph-sky {
  /* 尺寸与 .wallpaper-layer **完全一致**（都是整个视口）、取景也完全一致，
     因此两者显示的是同一张壁纸的同一块裁剪 —— 位置与缩放都相同。
     用 fixed 而不是 absolute：百分比基准是视口，与壁纸图层一致
     （祖先 .graph-full 用 overflow-x: clip，不裁剪 fixed 后代）。

     ⚠ 这里**不能**靠"把元素撑高"来覆盖筛选条：
     `cover` 的缩放比是按**元素自身盒子**算的，元素一高就会把壁纸放大
     （撑高 44px → 放大约 5%，缩放浏览器时肉眼很明显）。
     本元素铺满整个视口（y 0..100vh），**天然就盖住了筛选条**（筛选条在 y 49..93），
     不需要再叠一个专门盖筛选条的元素 —— 曾经有个 `.graph-sky-cap` 就是干这个的，
     但它的 `clip-path` 只保留自身顶部 44px，实际落在 y 0..44，
     盖的是**顶栏**而不是筛选条，纯属多余且会误导排查。已删除。 */
  position: fixed;
  inset: 0;
  height: 100vh;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(180deg, var(--graph-veil), var(--graph-veil)),
    var(--wallpaper-url, none);
  background-size: cover;
  background-position: center calc(50% + var(--wp-shift, 0px));
  background-repeat: no-repeat;
  /* ⚠ 这里**不要**再给天幕单独加一层 opacity 淡入 —— 它已经跟着父级淡入了：
     天幕的父级是 `.view-body`，而 `<Transition name="view">` 对 `.view-body` 做了
     `opacity 0 → 1`（260ms），天幕作为子元素自然跟着淡入。
     我曾在这里额外写 `opacity: 0` + `.is-in` 类做二次淡入，实测**加类与元素挂载落在同一帧**
     （逐帧记录：元素首次出现时 class 已是 `graph-sky is-in`、opacity 已是 1），过渡根本不播。
     真正要保证的是**终色一致**：`.wiki-view` 过渡到的 GRAPH_VEIL 与这里的 --graph-veil 同值，
     天幕盖上来时才没有亮度台阶。 */
}

.graph-full :deep(.wiki-graph) {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1; /* 盖在天幕背景层之上 */
}

/* 筛选条在拓扑模式下**保持透明**：天幕铺满整个视口，筛选条正落在天幕之上，
   于是上下取自**同一层背景**，天然连续，不存在两块壁纸对不齐的问题。
   注意不要给它加 backdrop-filter：那会把壁纸糊掉，与下方清晰的星图区质感不一致。 */
.graph-full :deep(.filter-bar) {
  flex: 0 0 auto;
  background: transparent;
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
