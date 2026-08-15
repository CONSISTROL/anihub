<script setup>
// 登录页：成功后按 redirect 参数跳回
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api/http'
import { useAuth } from '../composables/useAuth'

const route = useRoute()
const router = useRouter()
const { setSession } = useAuth()

const username = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function onSubmit() {
  error.value = ''
  busy.value = true
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { username: username.value, password: password.value },
      auth: false,
    })
    setSession(data.token, data.user)
    router.replace(route.query.redirect || '/')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <form class="auth-card" @submit.prevent="onSubmit">
      <h1 class="auth-title">登录 AniHub</h1>
      <p v-if="error" class="auth-error">{{ error }}</p>
      <label class="field">
        <span>用户名</span>
        <input v-model.trim="username" required autocomplete="username" />
      </label>
      <label class="field">
        <span>密码</span>
        <input v-model="password" type="password" required autocomplete="current-password" />
      </label>
      <button class="btn btn-primary btn-block" :disabled="busy">
        {{ busy ? '登录中…' : '登录' }}
      </button>
      <p class="auth-switch">
        还没有账号？<router-link to="/register">去注册</router-link>
      </p>
    </form>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  padding: 60px 20px;
}

.auth-card {
  width: min(380px, 100%);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 28px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.auth-title {
  margin: 0 0 4px;
  font-size: 20px;
  text-align: center;
}

.auth-error {
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  color: #ff9d9d;
  background: color-mix(in srgb, #ff5c5c 12%, var(--panel));
  border: 1px solid color-mix(in srgb, #ff5c5c 40%, transparent);
  border-radius: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}

.field input {
  padding: 9px 12px;
  font-size: 14px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
}

.field input:focus {
  border-color: var(--accent);
}

.btn-block {
  margin-top: 4px;
  padding: 10px;
  font-size: 14px;
}

.auth-switch {
  margin: 0;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
}

.auth-switch a {
  color: var(--accent);
  text-decoration: none;
}
</style>
