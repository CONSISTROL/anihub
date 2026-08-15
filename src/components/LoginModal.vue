<script setup>
// 登录弹窗：由键盘输入 "login" 呼出（见 App.vue），登录成功后关闭
import { nextTick, onMounted, ref } from 'vue'
import { api } from '../api/http'
import { useAuth } from '../composables/useAuth'

const emit = defineEmits(['close'])
const { setSession } = useAuth()

const username = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const showPassword = ref(false)
const userInput = ref(null)

// 弹窗出现后光标直接落在用户名输入框
onMounted(() => nextTick(() => userInput.value?.focus()))

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
    emit('close')
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="login-overlay" @click.self="emit('close')">
    <form class="login-card" @submit.prevent="onSubmit">
      <h1 class="login-title">登录</h1>
      <p v-if="error" class="login-error">{{ error }}</p>
      <label class="field">
        <span>用户名</span>
        <input ref="userInput" v-model.trim="username" required autocomplete="username" />
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
.login-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
}

.login-card {
  width: min(360px, calc(100vw - 40px));
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 28px;
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
}

.login-title {
  margin: 0 0 4px;
  font-size: 20px;
  text-align: center;
}

.login-error {
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
}

.pwd-toggle:hover {
  opacity: 1;
}

.btn-block {
  margin-top: 4px;
  padding: 10px;
  font-size: 14px;
}
</style>
