// 路由表 + 守卫（登录拦截 + 游客页面可见性）
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'

import HomeView from '../views/HomeView.vue'
import CalendarView from '../views/CalendarView.vue'
import BlogListView from '../views/BlogListView.vue'
import BlogPostView from '../views/BlogPostView.vue'
import WikiListView from '../views/WikiListView.vue'
import WikiPostView from '../views/WikiPostView.vue'
import EditView from '../views/EditView.vue'
import LoginView from '../views/LoginView.vue'
import SettingsView from '../views/SettingsView.vue'
import ToolsView from '../views/ToolsView.vue'
import JsonToolView from '../views/JsonToolView.vue'
import QrToolView from '../views/QrToolView.vue'
import CropToolView from '../views/CropToolView.vue'
import SearchView from '../views/SearchView.vue'
import HttpErrorView from '../views/HttpErrorView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/anime', name: 'anime', component: CalendarView },
    { path: '/blog', name: 'blog', component: BlogListView },
    { path: '/blog/new', name: 'blog-new', component: EditView, props: { category: 'blog' }, meta: { auth: true } },
    { path: '/blog/:slug', name: 'blog-post', component: BlogPostView, props: true },
    { path: '/blog/:slug/edit', name: 'blog-edit', component: EditView, props: { category: 'blog' }, meta: { auth: true } },
    { path: '/wiki', name: 'wiki', component: WikiListView },
    { path: '/wiki/new', name: 'wiki-new', component: EditView, props: { category: 'wiki' }, meta: { auth: true } },
    { path: '/wiki/:slug', name: 'wiki-post', component: WikiPostView, props: true },
    { path: '/wiki/:slug/edit', name: 'wiki-edit', component: EditView, props: { category: 'wiki' }, meta: { auth: true } },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/settings', name: 'settings', component: SettingsView, meta: { auth: true } },
    { path: '/tools', name: 'tools', component: ToolsView },
    { path: '/tools/json', name: 'tools-json', component: JsonToolView },
    { path: '/tools/qr', name: 'tools-qr', component: QrToolView },
    { path: '/tools/crop', name: 'tools-crop', component: CropToolView },
    { path: '/search', name: 'search', component: SearchView },
    { path: '/error/:code', name: 'error', component: HttpErrorView },
    // 兜底：未知路径显示 404 错误码页（不再静默回主页）
    { path: '/:pathMatch(.*)*', component: HttpErrorView, props: { code: 404 } },
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
}

router.beforeEach(async (to) => {
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

export default router
