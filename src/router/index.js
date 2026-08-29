// 路由表 + 守卫（登录拦截 + 游客页面可见性）
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'
import { finishPageLoading, startPageLoading } from '../composables/usePageProgress'
import { trackVisit } from '../api/visits'

// 所有页面路由懒加载：首次访问对应页面时才下载代码块，
// 配合全局顶部进度条（usePageProgress）显示加载状态，而不是白屏。
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/anime', name: 'anime', component: () => import('../views/CalendarView.vue') },
    { path: '/blog', name: 'blog', component: () => import('../views/BlogListView.vue') },
    { path: '/blog/new', name: 'blog-new', component: () => import('../views/EditView.vue'), props: { category: 'blog' }, meta: { auth: true } },
    { path: '/blog/:slug', name: 'blog-post', component: () => import('../views/BlogPostView.vue'), props: true },
    { path: '/blog/:slug/edit', name: 'blog-edit', component: () => import('../views/EditView.vue'), props: { category: 'blog' }, meta: { auth: true } },
    { path: '/wiki', name: 'wiki', component: () => import('../views/WikiListView.vue') },
    { path: '/wiki/new', name: 'wiki-new', component: () => import('../views/EditView.vue'), props: { category: 'wiki' }, meta: { auth: true } },
    { path: '/wiki/:slug', name: 'wiki-post', component: () => import('../views/WikiPostView.vue'), props: true },
    { path: '/wiki/:slug/edit', name: 'wiki-edit', component: () => import('../views/EditView.vue'), props: { category: 'wiki' }, meta: { auth: true } },
    { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue'), meta: { auth: true } },
    { path: '/console', name: 'console', component: () => import('../views/ConsoleView.vue'), meta: { auth: true } },
    { path: '/tools', name: 'tools', component: () => import('../views/ToolsView.vue') },
    { path: '/tools/json', name: 'tools-json', component: () => import('../views/JsonToolView.vue') },
    { path: '/tools/qr', name: 'tools-qr', component: () => import('../views/QrToolView.vue') },
    { path: '/tools/crop', name: 'tools-crop', component: () => import('../views/CropToolView.vue') },
    { path: '/tools/splice', name: 'tools-splice', component: () => import('../views/SpliceToolView.vue') },
    { path: '/tools/html-render', name: 'tools-html-render', component: () => import('../views/HtmlRenderToolView.vue') },
    { path: '/tools/compare', name: 'tools-compare', component: () => import('../views/CompareToolView.vue') },
    // 二维码生成（3D 树）：three.js 较重，路由懒加载，只在打开该工具时下载
    {
      path: '/tools/qr-tree',
      name: 'tools-qr-tree',
      component: () => import('../views/QrTreeToolView.vue'),
    },
    { path: '/search', name: 'search', component: () => import('../views/SearchView.vue') },
    { path: '/game', name: 'game', component: () => import('../views/GameView.vue') },
    { path: '/error/:code', name: 'error', component: () => import('../views/HttpErrorView.vue') },
    // 兜底：未知路径显示 404 错误码页（不再静默回主页）
    { path: '/:pathMatch(.*)*', component: () => import('../views/HttpErrorView.vue'), props: { code: 404 } },
  ],
})

// 可配置游客可见性的页面：路由名 → 设置中的页面 key（二级页面归属同一页面，与 server/routes/settings.js 的 ALL_PAGES 保持一致）
const GUEST_PAGES = {
  anime: 'anime',
  blog: 'blog',
  wiki: 'wiki',
  tools: 'tools',
  'tools-json': 'tools',
  'tools-qr': 'tools',
  'tools-crop': 'tools',
  'tools-splice': 'tools',
  'tools-html-render': 'tools',
  'tools-compare': 'tools',
  'tools-qr-tree': 'tools',
  game: 'game',
}

// 首次整页加载由服务端中间件记录（source=page），SPA 内部路由切换才在此上报（source=spa），避免重复计数
let firstNavigation = true

// 路由开始切换时立即显示顶部进度条（懒加载页面耗时较长时避免“点了没反应”）
router.beforeEach(async (to) => {
  startPageLoading()
  const auth = useAuth()
  // 需登录的页面（设置/编辑页等）：游客与内部人员访问时展示 401 错误码页（替代原登录跳转）
  if (to.meta.auth && !auth.isLoggedIn.value) {
    return { name: 'error', params: { code: 401 } }
  }
  // 游客 / 内部人员访问页面时按可见性拦截（管理员不受限）；不提示，页面上也不暴露该限制
  const page = GUEST_PAGES[to.name]
  if (!auth.isLoggedIn.value && page) {
    const settings = useSettings()
    await settings.load()
    if (!settings.canAccess(page, auth.isInsider.value)) return { name: 'home' }
  }
})

router.afterEach((to) => {
  finishPageLoading()
  if (firstNavigation) {
    firstNavigation = false
    // 生产模式首屏由服务端中间件记录（source=page），避免重复；开发模式 Vite 不经过 Express 页面中间件，因此也上报一次
    if (!import.meta.env.DEV) return
  }
  trackVisit(to.fullPath).catch(() => {}) // 静默上报，不影响页面跳转
})

router.onError(() => {
  finishPageLoading()
})

export default router
