<script setup>
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { isLoggedIn, user, clearSession } = useAuth()

// 隐藏登录入口：未登录时点击站点 logo 进入登录页
function onBrandClick() {
  if (!isLoggedIn.value) router.push('/login')
}
</script>

<template>
  <nav class="navbar">
    <router-link to="/" class="brand" @click.prevent="onBrandClick">AniHub</router-link>
    <div class="links">
      <router-link to="/anime">Anime</router-link>
      <router-link to="/blog">Blog</router-link>
      <router-link to="/wiki">Wiki</router-link>
    </div>
    <div class="user-area">
      <template v-if="isLoggedIn">
        <span class="username">{{ user?.username }}</span>
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
