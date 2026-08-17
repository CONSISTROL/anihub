<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'
import ThemeSelector from './ThemeSelector.vue'

const { isLoggedIn, isInsider, user, clearSession, exitInsider } = useAuth()
const settings = useSettings()
settings.load() // 预加载可见页面（单例，守卫/主页共用）

const router = useRouter()

// 站内搜索：回车跳转到搜索页
const navQ = ref('')
function onNavSearch() {
  const kw = navQ.value.trim()
  if (!kw) return
  router.push({ name: 'search', query: { q: kw } })
  navQ.value = ''
}

const ALL_LINKS = [
  { to: '/anime', label: 'Anime', page: 'anime' },
  { to: '/blog', label: 'Blog', page: 'blog' },
  { to: '/wiki', label: 'Wiki', page: 'wiki' },
  { to: '/tools', label: 'Tools', page: 'tools' },
]

// 未登录时按身份显示可见的页面链接：游客只看游客可见，内部人员多看内部可见
const links = computed(() => {
  if (isLoggedIn.value) return ALL_LINKS
  return ALL_LINKS.filter((l) => settings.canAccess(l.page, isInsider.value))
})

const WELCOME = 'Ciallo ～(∠・ω< )⌒★!'
</script>

<template>
  <nav class="navbar">
    <router-link to="/" class="brand">AniHub</router-link>
    <div class="links">
      <router-link v-for="l in links" :key="l.to" :to="l.to">{{ l.label }}</router-link>
    </div>
    <form class="nav-search" @submit.prevent="onNavSearch">
      <input v-model.trim="navQ" placeholder="站内搜索…" title="站内搜索（回车）" />
    </form>
    <div class="user-area">
      <span v-if="isInsider && !isLoggedIn" class="insider-chip" title="内部人员模式（只读）">
        <img src="/insider.webp" class="insider-avatar" alt="" />
        <span class="insider-label">⋆｡ﾟ☁︎｡⋆｡ ﾟ☾ ﾟ｡⋆</span>
        <button class="chip-x" aria-label="退出内部模式" @click="exitInsider">✕</button>
      </span>
      <template v-if="isLoggedIn">
        <span class="username">{{ WELCOME }}</span>
        <router-link to="/settings" class="btn btn-sm">设置</router-link>
        <button class="btn btn-sm" @click="clearSession">退出</button>
      </template>
    </div>
    <ThemeSelector />
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

.nav-search input {
  width: 140px;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  outline: none;
  transition: width 0.15s, border-color 0.15s;
}

.nav-search input:focus {
  width: 180px;
  border-color: var(--accent);
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

.insider-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #ffd166;
  border: 1px solid color-mix(in srgb, #ffd166 45%, transparent);
  background: color-mix(in srgb, #ffd166 10%, transparent);
  border-radius: 999px;
  padding: 3px 8px 3px 4px;
}

.insider-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid color-mix(in srgb, #ffd166 65%, transparent);
}

.insider-label {
  white-space: nowrap;
}

.chip-x {
  background: none;
  border: none;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0.7;
}

.chip-x:hover {
  opacity: 1;
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
