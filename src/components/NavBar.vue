<script setup>
import { computed } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'

const { isLoggedIn, user, clearSession } = useAuth()
const settings = useSettings()
settings.load() // 预加载游客可见页面（单例，守卫/主页共用）

const ALL_LINKS = [
  { to: '/anime', label: 'Anime', page: 'anime' },
  { to: '/blog', label: 'Blog', page: 'blog' },
  { to: '/wiki', label: 'Wiki', page: 'wiki' },
]

// 未登录时只显示允许游客访问的页面链接
const links = computed(() =>
  isLoggedIn.value ? ALL_LINKS : ALL_LINKS.filter((l) => settings.isGuestVisible(l.page))
)

const WELCOME = 'Ciallo ～(∠・ω< )⌒★!'
</script>

<template>
  <nav class="navbar">
    <router-link to="/" class="brand">AniHub</router-link>
    <div class="links">
      <router-link v-for="l in links" :key="l.to" :to="l.to">{{ l.label }}</router-link>
    </div>
    <div class="user-area">
      <template v-if="isLoggedIn">
        <span class="username">{{ WELCOME }}</span>
        <router-link to="/settings" class="btn btn-sm">设置</router-link>
        <button class="btn btn-sm" @click="clearSession">退出</button>
      </template>
    </div>
  </nav>
</template>

<style scoped>
.navbar {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px 24px;
  background: color-mix(in srgb, var(--panel) 85%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}

.brand {
  font-size: 18px;
  font-weight: 800;
  color: var(--accent);
  text-decoration: none;
}

.links {
  display: flex;
  gap: 4px;
}

.links a {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--muted);
  text-decoration: none;
  transition: color 0.15s, background 0.15s;
}

.links a:hover {
  color: var(--text);
  background: var(--panel-2);
}

.links a.router-link-active {
  color: var(--accent);
  font-weight: 600;
}

.user-area {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.username {
  font-size: 13px;
  color: var(--muted);
}

.btn-sm {
  padding: 5px 10px;
  font-size: 13px;
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn-primary:hover {
  background: var(--accent-hover);
}
</style>
