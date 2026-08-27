<script setup>
// 全局布局壳：导航栏 + 页面内容；键盘监听呼出隐藏的登录框 / 获取内部人员身份
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import NavBar from './components/NavBar.vue'
import LoginModal from './components/LoginModal.vue'
import InsiderBackground from './components/InsiderBackground.vue'
import BackToTop from './components/BackToTop.vue'
import Mascot from './components/Mascot.vue'
import { api } from './api/http'
import { useAuth } from './composables/useAuth'
import { useSettings } from './composables/useSettings'

const { isLoggedIn, isInsider } = useAuth()
const settings = useSettings()
if (!isLoggedIn.value) settings.load() // 加载可见性设置（桌宠权限依赖）
const route = useRoute()
const showLogin = ref(false)
const insiderBusy = ref(false)

// 游戏页为沉浸式全屏玩法：隐藏桌宠与回到顶部按钮
const isGame = computed(() => route.name === 'game')

// 桌宠可见性：登录（管理员）恒可见；游客/内部人员需管理员在设置中开放 pet 权限
const petVisible = computed(() => {
  if (isLoggedIn.value) return true
  if (!settings.guestPages.value) return false // 设置未加载完成：默认不显示
  return settings.canAccess('pet', isInsider.value)
})

// 隐藏登录入口：键盘依次输入 "login"（大小写均可）弹出登录框
const KEY_SEQ_LOGIN = 'login'
// 内部人员口令：键盘依次输入 "inside" 获取只读的内部身份（关键词与 server/.env 的 INSIDER_KEYWORD 一致）
const KEY_SEQ_INSIDE = 'inside'
const keyBufLen = Math.max(KEY_SEQ_LOGIN.length, KEY_SEQ_INSIDE.length)
let keyBuf = ''

async function enterInside() {
  if (insiderBusy.value) return
  const auth = useAuth()
  if (auth.isLoggedIn.value || auth.isInsider.value) return // 管理员已全权限，内部身份已生效
  insiderBusy.value = true
  try {
    const data = await api('/auth/insider', {
      method: 'POST',
      body: { keyword: KEY_SEQ_INSIDE },
      auth: false,
    })
    auth.enterInsider(data.token)
  } catch {
    /* 口令错误等：静默，不打扰访客 */
  } finally {
    insiderBusy.value = false
  }
}

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
  keyBuf = (keyBuf + e.key.toLowerCase()).slice(-keyBufLen)
  if (keyBuf === KEY_SEQ_LOGIN) {
    keyBuf = ''
    e.preventDefault() // 拦下最后那个字母的默认动作，避免被键入到刚聚焦的用户名输入框
    showLogin.value = true
  } else if (keyBuf === KEY_SEQ_INSIDE) {
    keyBuf = ''
    e.preventDefault()
    enterInside()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="app-shell">
    <NavBar />
    <router-view v-slot="{ Component }">
      <keep-alive :include="['ConsoleView']">
        <component :is="Component" />
      </keep-alive>
    </router-view>
    <LoginModal v-if="showLogin" @close="showLogin = false" />
    <!-- 全站壁纸背景（组件内部按身份自检：管理员恒可见，游客/内部人员按设置开关） -->
    <InsiderBackground v-if="!isGame" />
    <!-- 一键回到顶部 -->
    <BackToTop v-if="!isGame" />
    <!-- 桌宠（可见性由设置页 pet 权限控制，默认仅登录可见） -->
    <Mascot v-if="petVisible && !isGame" />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
</style>
