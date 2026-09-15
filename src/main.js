import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { isDeepRoute, prefetchWikiGraph } from './wikiView'
import './style.css'

const app = createApp(App)

// 全局错误兜底：任何组件渲染/生命周期中的未捕获异常都会走到这里。
// 没有它时 Vue 会直接卸载整棵组件树，用户看到的是一片空白（连错误码插画都没有）。
let errorShown = false
app.config.errorHandler = (err, instance, info) => {
  console.error('[app error]', info, err)
  if (errorShown) return
  errorShown = true
  // 回退到内置错误码页（复用同一套 HTTP 错误码插画），至少保证页面还有可用内容与返回入口
  try {
    router.replace({ name: 'error', params: { code: 500 } })
  } catch {
    document.body.innerHTML =
      '<div style="padding:48px;text-align:center;font-family:system-ui">' +
      '<h1 style="font-size:20px">页面出错了</h1>' +
      '<p><a href="/" style="color:#4a6cf7">返回首页</a></p></div>'
  }
}

// 未处理的 Promise 拒绝（多为接口失败）：只记录，不打断页面
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled rejection]', e.reason)
})

/* —— 深空底标记：<html data-deep> ——
   用途：让**整屏是深空底**的页面（主页、wiki 拓扑图）把 body 底色也切成深空色。
   ⚠⚠ 必须在**路由守卫阶段**写，不能用 `body:has(.某个页面元素)` 去判断。
   原因：路由切换是 `<Transition name="page" mode="out-in">` —— 旧页面先淡出、
   淡到 0 之后新页面才挂载。用 `:has()` 只能等新页面挂载后才生效，实测表现为
   body 在**一帧之内**从浅色硬切成深空色：新视图正以 opacity 1 淡入、它自己背景透明，
   底下的 body 却在这一帧由近白跳到深空 → 观感就是"刚切过去那一下背景是白的"。
   标记在导航确认时就写好（早于新页面挂载），整个过渡期间 body 都是深空色，
   旧页面在一张深空画布上淡出、新页面淡入，全程无白闪。
   "算不算深空路由"的判断放在 `src/wikiView.js`（那里能看到 localStorage 里保存的模式 ——
   点导航进 /wiki 时 URL 没有 `?view=`，只看 query 会漏判）。 */
function syncDeepFlag(to) {
  const root = document.documentElement
  if (isDeepRoute(to)) root.dataset.deep = '1'
  else delete root.dataset.deep
}
router.afterEach((to) => syncDeepFlag(to))

/* —— 拓扑图分包预取 ——
   放在 **beforeEach** 而不是 afterEach：afterEach 要等路由块加载完才触发，那时新页面
   马上就要挂载、再去下 527KB 的 three.js 就晚了。beforeEach 在导航一开始就触发 ——
   SPA 内切换时比新视图挂载早一整段离场过渡（约 260ms，分包能吃下这段等待），
   首次整页加载时与首屏路由块并行下载。
   幂等、失败静默，慢网/省流模式自动跳过，详见 wikiView.js 的 prefetchWikiGraph。 */
router.beforeEach((to) => {
  if (isDeepRoute(to)) prefetchWikiGraph()
})

/* 首帧的深空底标记。
   ⚠ 原来这里直接把 `router.currentRoute.value` 喂给 `syncDeepFlag`，但**路由此刻还没启动**，
   它是 START_LOCATION（`name` 为 undefined），`isDeepRoute` 一律判否 —— 于是硬刷新进
   `/wiki?view=graph` 时首帧的 body 还是浅色，要等首次导航**完成**（含路由块下载）后的
   afterEach 才变深，中间就是可见的一下白闪。
   改成按**当前地址**自己解析一次路由：与后面对同一条地址的解析结果完全一致，
   但能赶在 mount 之前把标记写好（判断函数仍在 wikiView.js，与 afterEach 共用同一套规则）。 */
function syncBootDeepFlag() {
  const cur = router.currentRoute.value
  // `name` 为空只可能是"路由尚未启动"（404 兜底路由没有 name，但它解析出来不是深空路由，
  // 多解析一次没有副作用）
  const to = cur?.name == null ? router.resolve(window.location.pathname + window.location.search) : cur
  syncDeepFlag(to)
}
syncBootDeepFlag()

app.use(router).mount('#app')
