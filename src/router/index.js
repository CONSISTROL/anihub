// 路由表 + 登录守卫
import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../composables/useAuth'

import HomeView from '../views/HomeView.vue'
import CalendarView from '../views/CalendarView.vue'
import BlogListView from '../views/BlogListView.vue'
import BlogPostView from '../views/BlogPostView.vue'
import WikiListView from '../views/WikiListView.vue'
import WikiPostView from '../views/WikiPostView.vue'
import EditView from '../views/EditView.vue'
import LoginView from '../views/LoginView.vue'

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
    // 兜底：未知路径回主页
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  if (to.meta.auth && !useAuth().isLoggedIn.value) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
})

export default router
