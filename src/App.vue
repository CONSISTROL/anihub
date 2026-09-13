<script setup>
// 全局布局壳：导航栏 + 页面内容；登录框/内部身份入口由网页内虚拟键盘触发
import { computed, defineAsyncComponent, onMounted, onUnmounted, provide, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NavBar from './components/NavBar.vue'
import LoginModal from './components/LoginModal.vue'
import InsiderBackground from './components/InsiderBackground.vue'
import WallpaperLayer from './components/WallpaperLayer.vue'
import ConstellationField from './components/ConstellationField.vue'
import BackToTop from './components/BackToTop.vue'
import BackToBottom from './components/BackToBottom.vue'
import ScrollIndicator from './components/ScrollIndicator.vue'
import PetButton from './components/PetButton.vue'
import VirtualKeyboard from './components/VirtualKeyboard.vue'
import { api } from './api/http'
import { useAuth } from './composables/useAuth'
import { useSettings } from './composables/useSettings'
import { finishPageLoading } from './composables/usePageProgress'

// 桌宠（Mascot.vue，774 行 + 全部动作表）只在真正要显示时才下载，
// 不再打进首屏 chunk：多数访客（游客/手机端）根本不会加载它。
const Mascot = defineAsyncComponent(() => import('./components/Mascot.vue'))

const { isLoggedIn, isInsider } = useAuth()
const settings = useSettings()
if (!isLoggedIn.value) settings.load() // 加载可见性设置（桌宠权限依赖）
const route = useRoute()
const router = useRouter()
const showLogin = ref(false)
const showKeyboard = ref(false)
const insiderBusy = ref(false)

// 游戏页为沉浸式全屏 iframe：隐藏桌宠与回到顶部按钮
const isGame = computed(() => route.name === 'game')

// 手机端默认不展示完整桌宠（只显示紧凑图标按钮），但按钮真的能把它召唤出来
const isMobile = ref(false)
const petOnMobile = ref(false) // 手机上点了召唤按钮后临时显示完整桌宠
let mobileQuery = null
function updateMobile() {
  isMobile.value = window.matchMedia('(max-width: 768px)').matches
  if (!isMobile.value) petOnMobile.value = false
}

// 桌宠被右键菜单“隐藏”后，持久化到 localStorage，刷新后仍保持隐藏，直到点击召唤按钮恢复
const PET_HIDDEN_KEY = 'anime-calendar.mascot.hidden'
const petDismissed = ref(localStorage.getItem(PET_HIDDEN_KEY) === '1')

function hidePet() {
  petDismissed.value = true
  localStorage.setItem(PET_HIDDEN_KEY, '1')
}

function summonPet() {
  petDismissed.value = false
  petOnMobile.value = true // 手机上也能真的召唤出来（否则按钮点了没有效果）
  localStorage.removeItem(PET_HIDDEN_KEY)
}

// 桌宠可见性：登录（管理员）恒可见；游客/内部人员需管理员在设置中开放 pet 权限
const petVisible = computed(() => {
  if (isLoggedIn.value) return true
  if (!settings.guestPages.value) return false // 设置未加载完成：默认不显示
  return settings.canAccess('pet', isInsider.value)
})

// 有权限且不在游戏页时才可能与桌宠有关
const petAllowed = computed(() => petVisible.value && !isGame.value)
// 完整桌宠：桌面端直接显示；手机端需要用户主动召唤
const showPet = computed(
  () => petAllowed.value && !petDismissed.value && (!isMobile.value || petOnMobile.value)
)
// 召唤按钮：只有「有权限但当前没显示完整桌宠」时才出现——保证点击一定有反馈
const showPetButton = computed(() => petAllowed.value && !showPet.value)

function openLogin() {
  showLogin.value = true
}

function closeLogin() {
  showLogin.value = false
}

function openKeyboard() {
  showKeyboard.value = true
}

function closeKeyboard() {
  showKeyboard.value = false
}

function toggleKeyboard() {
  showKeyboard.value = !showKeyboard.value
}

function onLoginCommand() {
  closeKeyboard()
  openLogin()
}

async function onInsideCommand() {
  await enterInside()
  closeKeyboard()
}

// 内部人员口令：网页内虚拟键盘输入 inside 后回车触发
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

// 提供给全局组件 / 虚拟键盘调用
provide('openLogin', openLogin)
provide('closeLogin', closeLogin)
provide('enterInside', enterInside)
provide('openKeyboard', openKeyboard)
provide('closeKeyboard', closeKeyboard)
provide('toggleKeyboard', toggleKeyboard)

onMounted(() => {
  mobileQuery = window.matchMedia('(max-width: 768px)')
  updateMobile()
  mobileQuery.addEventListener?.('change', updateMobile)
  router.isReady().then(finishPageLoading, finishPageLoading)
})

onUnmounted(() => {
  mobileQuery?.removeEventListener?.('change', updateMobile)
})
</script>

<template>
  <div class="app-shell">
    <!-- 全站壁纸图层：放在最前、z-index -1，让导航栏的毛玻璃能糊到它。
         :on 表示"当前在主页" —— 主页在浅色主题下需要把壁纸压得更暗一点
         （见 WallpaperLayer.vue 里的 .is-home 规则）。 -->
    <WallpaperLayer :on="route.name === 'home'" />
    <!-- 主页星座背景：常驻挂载、只在主页显示。
         挂在 App 层是为了让粒子场在页面切换时延续 —— 放进 HomeView 就会随组件重建，
         每次切回主页粒子都重新随机，看起来就是"闪一下然后重绘"。 -->
    <ConstellationField :on="route.name === 'home'" />
    <!-- 路由懒加载 / 页面切换时的进度反馈由右侧细条（ScrollIndicator）统一承担，
         不再另外放一条顶部横条 -->
    <NavBar />
    <!-- 页面切换：iOS 式非线性入场（轻微上移 + 呼吸缩放，沿 Expo 曲线滑停） -->
    <router-view v-slot="{ Component }">
      <Transition name="page" mode="out-in" appear>
        <keep-alive :include="['ConsoleView', 'GameView']">
          <component :is="Component" :key="route.path" />
        </keep-alive>
      </Transition>
    </router-view>
    <!-- 隐藏登录弹窗：遮罩淡入 + 弹层弹簧缩放；由网页内虚拟键盘输入 login 后触发 -->
    <Transition name="login" appear>
      <LoginModal v-if="showLogin" @close="closeLogin" />
    </Transition>
    <!-- 网页内虚拟键盘：非游戏页输入 login/inside，游戏页向 iframe 发送按键 -->
    <VirtualKeyboard
      v-if="showKeyboard"
      @close="closeKeyboard"
      @login="onLoginCommand"
      @inside="onInsideCommand"
    />
    <!-- 全站壁纸背景（组件内部按身份自检：管理员恒可见，游客/内部人员按设置开关）
         游戏页也保持挂载，避免进入 /game 时壁纸持有者释放后再重新加载导致背景闪烁 -->
    <InsiderBackground />
    <!-- 一键回到顶部 / 回到底部 -->
    <BackToTop v-if="!isGame" />
    <BackToBottom v-if="!isGame" />
    <!-- 右侧悬浮磁贴滚动指示条（仅页面可滚动时出现；非游戏页） -->
    <ScrollIndicator v-if="!isGame" />
    <!-- 桌宠（可见性由设置页 pet 权限控制，默认内部人员可见、游客不可见；手机端需点按钮召唤） -->
    <Mascot v-if="showPet" @hide="hidePet" />
    <!-- 未显示完整桌宠时的紧凑图标按钮，点击召唤 / 恢复 -->
    <PetButton v-else-if="showPetButton" @click="summonPet" />
  </div>
</template>

<style scoped>
/* 桌面端不设 isolation：壁纸图层的 z-index:-1 需要落到 body 背景之上、
   但仍在所有内容之下。页面本身没有非透明背景，因此无需额外层。 */
.app-shell {
  min-height: 100vh;
  overflow-x: clip; /* 壁纸图层固定 100% 宽，防止横向溢出 */
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
