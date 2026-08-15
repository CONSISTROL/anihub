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
    // 兜底：未知路径回主页
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// 可配置游客可见性的页面（与 server/routes/settings.js 的 ALL_PAGES 保持一致）
const GUEST_PAGES = { anime: true, blog: true, wiki: true }

router.beforeEach(async (to) => {
  const auth = useAuth()
  if (to.meta.auth && !auth.isLoggedIn.value) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  // 游客访问被禁用的页面：回主页（不提示，页面上也不暴露该限制）
  if (!auth.isLoggedIn.value && GUEST_PAGES[to.name]) {
    const settings = useSettings()
    await settings.load()
    if (!settings.isGuestVisible(to.name)) return { name: 'home' }
  }
})

export default router
