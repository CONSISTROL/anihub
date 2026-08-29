<script setup>
// 全局布局壳：导航栏 + 页面内容；登录框/内部身份入口由 Tools → HTML 渲染工具触发
import { computed, onMounted, provide, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NavBar from './components/NavBar.vue'
import LoginModal from './components/LoginModal.vue'
import InsiderBackground from './components/InsiderBackground.vue'
import BackToTop from './components/BackToTop.vue'
import Mascot from './components/Mascot.vue'
import { api } from './api/http'
import { useAuth } from './composables/useAuth'
import { useSettings } from './composables/useSettings'
import { finishPageLoading, usePageProgress } from './composables/usePageProgress'

const { isLoggedIn, isInsider } = useAuth()
const settings = useSettings()
if (!isLoggedIn.value) settings.load() // 加载可见性设置（桌宠权限依赖）
const route = useRoute()
const router = useRouter()
const { loading: pageLoading } = usePageProgress()
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

function openLogin() {
  showLogin.value = true
}

function closeLogin() {
  showLogin.value = false
}

// 内部人员口令：Tools → HTML 渲染中输入 inside 后点击渲染触发
// 关键词与 server/.env 的 INSIDER_KEYWORD 一致（默认 inside）
async function enterInside() {
  const auth = useAuth()
  if (auth.isLoggedIn.value || auth.isInsider.value) return true // 管理员已全权限，内部身份已生效
  if (insiderBusy.value) return false
  insiderBusy.value = true
  try {
    const data = await api('/auth/insider', {
      method: 'POST',
      body: { keyword: 'inside' },
      auth: false,
    })
    auth.enterInsider(data.token)
    return true
  } catch {
    /* 口令错误等：静默，不打扰访客 */
    return false
  } finally {
    insiderBusy.value = false
  }
}

// 提供给 Tools → HTML 渲染工具调用
provide('openLogin', openLogin)
provide('closeLogin', closeLogin)
provide('enterInside', enterInside)

onMounted(() => {
  router.isReady().then(finishPageLoading, finishPageLoading)
})
</script>

<template>
  <div class="app-shell">
    <!-- 路由懒加载 / 页面切换时的顶部进度条 -->
    <div class="page-progress" :class="{ visible: pageLoading }" aria-hidden="true">
      <div class="page-progress-bar"></div>
    </div>
    <NavBar />
    <!-- 页面切换：iOS 式非线性入场（轻微上移 + 呼吸缩放，沿 Expo 曲线滑停） -->
    <router-view v-slot="{ Component }">
      <Transition name="page" mode="out-in" appear>
        <keep-alive :include="['ConsoleView']">
          <component :is="Component" :key="route.path" />
        </keep-alive>
      </Transition>
    </router-view>
    <!-- 隐藏登录弹窗：遮罩淡入 + 弹层弹簧缩放；由 Tools → HTML 渲染输入 login 后触发 -->
    <Transition name="login" appear>
      <LoginModal v-if="showLogin" @close="closeLogin" />
    </Transition>
    <!-- 全站壁纸背景（组件内部按身份自检：管理员恒可见，游客/内部人员按设置开关）
         游戏页也保持挂载，避免进入 /game 时壁纸持有者释放后再重新加载导致背景闪烁 -->
    <InsiderBackground />
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

/* 页面切换顶部进度条：懒加载资源期间保持可见，避免用户以为点击无效 */
.page-progress {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 9999;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--dur-ios-2) var(--ease-ios-expo);
}

.page-progress.visible {
  opacity: 1;
}

.page-progress-bar {
  height: 100%;
  width: 40%;
  background: linear-gradient(90deg, transparent, var(--accent), #a78bfa, transparent);
  animation: page-progress-slide 1s ease-in-out infinite;
}

@keyframes page-progress-slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(350%);
  }
}

/* ---- iOS 式页面切换 ---- */
.page-enter-active {
  transition:
    opacity var(--dur-ios-3) var(--ease-ios-expo),
    transform var(--dur-ios-3) var(--ease-ios-expo);
}

.page-leave-active {
  transition:
    opacity var(--dur-ios-1) var(--ease-ios),
    transform var(--dur-ios-1) var(--ease-ios);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(16px) scale(0.992);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.996);
}

/* ---- iOS 式登录弹窗 ---- */
.login-enter-active {
  transition:
    opacity var(--dur-ios-2) var(--ease-ios-expo),
    transform var(--dur-ios-3) var(--ease-ios-spring);
}

.login-leave-active {
  transition:
    opacity var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios);
}

.login-enter-from,
.login-leave-to {
  opacity: 0;
}

.login-enter-from {
  transform: scale(0.94) translateY(12px);
}

.login-leave-to {
  transform: scale(0.97) translateY(6px);
}
</style>
