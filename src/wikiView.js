// wiki 视图模式（列表 / 拓扑图）的解析 + 拓扑图的两项预取。
//
// 为什么单独抽一个模块：
//  - `WikiListView.vue` 用的是 `<script setup>`，**不能有 ES 模块导出**（编译器会直接报错），
//    所以解析逻辑不能放在组件里再导出；
//  - 而 `main.js` 的路由守卫也需要它 —— 拓扑图要把 <html> 标成深空底（`data-deep`），
//    这个标记**必须在路由确认时**就写好（早于新页面挂载），否则从别的页面切过来时
//    body 会在过渡中途硬切颜色、闪一下白。
//  - 预取（`prefetchWikiGraph`）同理：`main.js` 的导航守卫与 `WikiListView.vue` 的悬停
//    都要能调它，所以放在这里而不是组件里。
//
// ⚠ 关键：**不能只看 URL query**。用户点导航进 /wiki 时 URL 里没有 `?view=`，
//   实际模式来自上次的选择（localStorage）。组件挂载后才把 `?view=graph` 写回 URL，
//   那时"新页面已经挂载"，光靠 URL 判断就晚了一整段过渡。
import router from './router'
import { listPosts } from './api/posts'
import { useAuth } from './composables/useAuth'

export const WIKI_VIEW_STORAGE_KEY = 'anihub.wiki-view'

export function readStoredWikiView() {
  try {
    return localStorage.getItem(WIKI_VIEW_STORAGE_KEY)
  } catch {
    return null
  }
}

export function writeStoredWikiView(view) {
  try {
    localStorage.setItem(WIKI_VIEW_STORAGE_KEY, view)
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

/** 这次进 wiki 应该是 'graph' 还是 'list'：URL 参数优先，其次上次选择，默认列表。 */
export function resolveWikiView() {
  let q = null
  try {
    q = router.currentRoute.value?.query?.view ?? null
  } catch {
    q = null
  }
  if (q === 'graph' || q === 'list') return q
  return readStoredWikiView() === 'graph' ? 'graph' : 'list'
}

/**
 * 当前是否处于"整屏深空底"的页面 → 决定 `<html data-deep>`。
 *
 * ⚠ 现在只有 **wiki 拓扑图** 是深空底。主页**不再是**深空底：
 *   用户要求"浅色模式下主页恢复成和 anime 一样的正常明亮背景"，
 *   所以主页彻底退出深空化（连带去掉了 canvas 星座背景，见 App.vue）。
 *
 * ⚠ 判 `to.query.view` 而**不能**走 `resolveWikiView()`：后者读的是
 *   `router.currentRoute`，而守卫阶段它还是**旧**路由 —— 深链 `/wiki?view=graph`
 *   （localStorage 里没存过视图）会被判成列表，结果既不置 data-deep、也不预取分包。
 *   这里用**目标路由**判断，query 的优先级与 `resolveWikiView()` 保持一致。
 */
export function isDeepRoute(to) {
  if (to?.name !== 'wiki') return false
  const q = to.query?.view
  if (q === 'graph') return true
  if (q === 'list') return false
  return readStoredWikiView() === 'graph'
}

/* ================= 拓扑图预取 =================
   拓扑图的瓶颈是 three.js 那个 **527KB（gzip ≈130KB）** 的分包：它只在组件挂载时才开始
   下载+解析，而组件挂载又要等列表视图淡出（`<Transition mode="out-in">` 之后）。
   两段串起来，从点「拓扑图」到看见星系中间就有几百毫秒到数秒的空窗 —— 这正是用户
   反馈的"转圈/空白等太久"。

   这里把两件事提前做掉（都不阻塞、失败静默）：
     1) `import()` 同一个组件 → 分包下载 + 解析 + 模块求值一起提前完成。
        ⚠ 必须是**同一个 specifier**：ES 模块按解析后的模块记录去重，`defineAsyncComponent`
        的 loader 拿到的就是这份已经求值过的模块，挂载时几乎立即 resolve；
        同时还让 `WikiGraphView.vue` 里那个"按模块求值时刻算"的过渡守卫自然过期。
     2) 顺带把拓扑图数据也拉起来，与分包并行（527KB 下载期间接口早就返回了 6.6KB）。

   触发点：导航进 wiki 拓扑图（`main.js` 的 beforeEach）、列表页悬停/聚焦「拓扑图」按钮。
   **不做**"列表页空闲预取"：只看列表的访客不该平白多下 130KB。 */

let graphChunkPrefetched = false

/** 慢网 / 省流模式不预取：527KB 与首屏自己的路由块抢带宽更亏，反正预取也赶不上。 */
function prefetchAllowed() {
  const c = navigator.connection
  if (!c) return true // Firefox / Safari 没这个 API，按可预取处理
  if (c.saveData) return false
  return c.effectiveType !== 'slow-2g' && c.effectiveType !== '2g'
}

export function prefetchWikiGraph() {
  if (!prefetchAllowed()) return
  prefetchWikiGraphData()
  if (graphChunkPrefetched) return
  graphChunkPrefetched = true
  import('./components/WikiGraphView.vue').catch(() => {
    // 这次预取失败（离线/被中断）不是错误路径 —— 用户还没进拓扑图。
    // 但要复位标志，否则一次失败会把后续所有预取都挡掉。
    graphChunkPrefetched = false
  })
}

/* 预取到的拓扑图数据：只做"一次性交接"，不做长期缓存 —— 它随条目增删、更随**当前身份**
   而变，长期缓存得维护一堆失效点（增删改、登录登出、导入备份…）。
   这里的约束够了：
     · 只有**同一身份**能取用（服务端按 Authorization 过滤可见性，跨身份复用会显示错的内容
       —— 这是正确性，不只是新鲜度）；
     · 15 秒内没人取用就作废，由组件自己重新请求。
   promise 在本模块挂一个空 catch 防 unhandledrejection，但**失败不入缓存**：取用方 await
   时该 reject 照样 reject，走它自己的错误分支。 */
const GRAPH_DATA_FRESH_MS = 15000
let graphDataPrefetch = null // { key, at, promise }

function viewerKey() {
  const auth = useAuth()
  return `${auth.token.value}|${auth.insiderToken.value}`
}

export function prefetchWikiGraphData() {
  // 新鲜度窗口内视为同一次预取：悬停来来回回不该反复打接口
  if (graphDataPrefetch && Date.now() - graphDataPrefetch.at < GRAPH_DATA_FRESH_MS) {
    return graphDataPrefetch.promise
  }
  const promise = listPosts({ category: 'wiki', page: 1, pageSize: 100 })
  graphDataPrefetch = { key: viewerKey(), at: Date.now(), promise }
  promise.catch(() => {})
  return promise
}

/** 取走预取好的数据（取走即作废）。没有 / 已过期 / 身份变了 → 返回 null，调用方自己请求。 */
export function takePrefetchedWikiGraphData() {
  const g = graphDataPrefetch
  graphDataPrefetch = null
  if (!g) return null
  if (g.key !== viewerKey() || Date.now() - g.at > GRAPH_DATA_FRESH_MS) return null
  return g.promise
}
