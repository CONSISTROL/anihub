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
const showPassword = ref(false)

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
        <div class="pwd-wrap">
          <input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            required
            autocomplete="current-password"
          />
          <button
            type="button"
            class="pwd-toggle"
            :title="showPassword ? '隐藏密码' : '显示密码'"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? '🙈' : '👁️' }}
          </button>
        </div>
      </label>
      <button class="btn btn-primary btn-block" :disabled="busy">
        {{ busy ? '登录中…' : '登录' }}
      </button>
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
  animation: ios-rise-in var(--dur-ios-3) var(--ease-ios-expo) both;
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
  animation: ios-pop-in var(--dur-ios-2) var(--ease-ios-spring) both;
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
  transition:
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-1) var(--ease-ios-expo);
}

.field input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

/* 密码明文切换：眼睛按钮固定在输入框右侧 */
.pwd-wrap {
  position: relative;
}

.pwd-wrap input {
  width: 100%;
  padding-right: 38px;
}

.pwd-toggle {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  padding: 4px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  opacity: 0.55;
  transition:
    opacity var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring);
}

.pwd-toggle:hover {
  opacity: 1;
  transform: translateY(-50%) scale(1.15);
}

.pwd-toggle:active {
  transform: translateY(-50%) scale(0.9);
  transition-duration: 70ms;
}

.btn-block {
  margin-top: 4px;
  padding: 10px;
  font-size: 14px;
}

</style>
