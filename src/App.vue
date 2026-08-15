<script setup>
// 全局布局壳：导航栏 + 页面内容；键盘监听呼出隐藏的登录框
import { onMounted, onUnmounted, ref } from 'vue'
import NavBar from './components/NavBar.vue'
import LoginModal from './components/LoginModal.vue'

const showLogin = ref(false)

// 隐藏登录入口：键盘依次输入 "login"（大小写均可）弹出登录框
const KEY_SEQ = 'login'
let keyBuf = ''
function onKeydown(e) {
  if (e.isComposing) return // 中文输入法组词中
  // Esc 关闭弹窗：优先判断，避免输入框聚焦时（弹窗打开即聚焦用户名）关闭失效
  if (e.key === 'Escape' && showLogin.value) {
    showLogin.value = false
    return
  }
  const t = e.target
  if (t?.matches?.('input, textarea, select, [contenteditable]')) return // 输入框内打字不触发
  if (e.key.length !== 1) return // 只处理普通字符键
  keyBuf = (keyBuf + e.key.toLowerCase()).slice(-KEY_SEQ.length)
  if (keyBuf === KEY_SEQ) {
    keyBuf = ''
    e.preventDefault() // 拦下最后那个字母的默认动作，避免被键入到刚聚焦的用户名输入框
    showLogin.value = true
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app-shell">
    <NavBar />
    <router-view />
    <LoginModal v-if="showLogin" @close="showLogin = false" />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
</style>
