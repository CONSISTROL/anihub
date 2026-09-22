<script setup>
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'
import { useGameAudio } from '../composables/useGameAudio'
import { getUpgradeVersion } from '../api/upgrade'
import ThemeSelector from './ThemeSelector.vue'
import AppIcon from './AppIcon.vue'

const { isLoggedIn, isInsider, user, clearSession, exitInsider } = useAuth()
const settings = useSettings()
settings.load() // 预加载可见页面（单例，守卫/主页共用）

// —— 内部身份卡片：展开状态**只由 JS 决定**，样式里不再有任何 :hover / :focus-within 展开规则 ——
// 原因与品牌抽屉（见 .brand-wrap 的说明）是同一个坑：只要样式里还留着 `:hover` 展开，
// 指针停在头像上时"点击收起"就会被 `:hover` 立刻盖回去 —— 表现为点了没反应。
// 所以把"悬停 / 聚焦"也交给 JS，由下面三个状态算出唯一真值 insiderOpen：
//   insiderHover     指针悬停 或 键盘聚焦（Tab 到头像）时的临时展开
//   insiderPinned    点击头像后的固定展开（触屏没有真正的悬停，全靠它）
//   insiderDismissed "这一轮悬停/聚焦里已被点击收起"，用来挡住悬停的自动展开，
//                    否则收起后会立刻被弹回来；指针/焦点离开时清空，下次悬停照常展开。
const insiderHover = ref(false)
const insiderPinned = ref(false)
const insiderDismissed = ref(false)
const insiderOpen = computed(() => insiderPinned.value || (insiderHover.value && !insiderDismissed.value))

// 悬停 / 聚焦进入：清掉上一轮的"点击收起"否决 —— 重新聚焦头像时应当还能看到卡片
function onInsiderEnter() {
  insiderHover.value = true
  insiderDismissed.value = false
}

// 指针 / 焦点离开：临时展开归零；否决一并清空，下次悬停重新展开
function onInsiderLeave() {
  insiderHover.value = false
  insiderDismissed.value = false
}

// 点击头像：展开 → 收起；收起 → 固定展开
// ⚠ 判断"当前是不是展开"，**不能**只看 insiderOpen：触摸/笔在部分浏览器里
//    点一下会先走一次 pointerenter（悬停态），若照"鼠标悬停中"处理，
//    第一次点就会被解析成"收起"（卡片闪一下、看起来点不开）。
//    所以触屏的首击一律按"展开并固定"处理，收起只由 insiderPinned 决定。
function toggleInsider(ev) {
  if (insiderPinned.value) return closeInsider() // 已固定展开（触屏点开的）→ 收起
  const touch = ev?.pointerType === 'touch' || ev?.pointerType === 'pen'
  // 鼠标悬停 / 键盘聚焦中，且这一轮还没被点收起过 → 收起
  // （dismissed 已为 true 说明上一击刚收起过：再点就该重新展开，否则"收起后原地再点"会没反应）
  if (insiderHover.value && !insiderDismissed.value && !touch) return closeInsider()
  insiderPinned.value = true
  insiderDismissed.value = false
}

// 卡片内条目点完（跳转 / 退出）收起卡片。
// 这里也要置 dismissed：指针大概率还停在卡片上，不挡住悬停就会立刻弹回来。
function closeInsider() {
  insiderPinned.value = false
  insiderDismissed.value = true
}

const router = useRouter()
const route = useRoute()
const { audioMode, audioLoaded, loadingAudio, loadRemainingAudio } = useGameAudio()
const showAudioLoad = computed(() => route.name === 'game' && audioMode.value === 'noaudio' && !audioLoaded.value)
const toggleKeyboard = inject('toggleKeyboard', () => {})

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
  { to: '/reading', label: 'Reading', page: 'reading' },
  { to: '/game', label: 'Game', page: 'game' },
]

// 未登录时按身份显示可见的页面链接：游客只看游客可见，内部人员多看内部可见
const links = computed(() => {
  if (isLoggedIn.value) return ALL_LINKS
  return ALL_LINKS.filter((l) => settings.canAccess(l.page, isInsider.value))
})

// 导航折叠成下拉抽屉时（≤1024px）：品牌图标是**抽屉开关**，不是回首页的链接。
// 点它只开合抽屉，不跳转 —— 回首页走抽屉里那一项。
//
// ⚠ 为什么挂在 .brand-wrap 的**捕获阶段**、而不是 <router-link> 的 @click：
//   品牌是 router-link，它自己的跳转处理器在冒泡阶段执行，捕获阶段先
//   preventDefault，RouterLink 才会因为 defaultPrevented 放弃跳转。
//   捕获阶段还有个好处：抽屉里链接的点击也能在这里一并处理（见下面的收起步），
//   不必指望 <router-link> 会把模板上的 @click 一起执行。
//
// ⚠ 抽屉的显隐**只认这个状态**，样式里不再有任何 :hover / :focus-within 展开规则。
//   早先保留过"鼠标悬停品牌时展开"，结果是关不掉：点完链接指针还停在抽屉上，
//   `.brand-wrap:hover` 一直匹配，把显式关闭又盖了回去（用户反馈的
//   "点了 Blog/Wiki 列表不消失"）。悬停展开与"点击开合"本来就是两套心智，
//   窄屏统一成后者。键盘用户依然可用：Tab 到品牌按回车即开合。
const menuOpen = ref(false)

/** 当前是否为"导航已折叠成抽屉"的布局（直接看 DOM，不写死断点） */
function isCollapsedNav() {
  const linksEl = document.querySelector('.links')
  return !!linksEl && getComputedStyle(linksEl).display === 'none'
}

function onBrandTap(e) {
  const target = e.target instanceof Element ? e.target : null
  if (!target) return
  // ① 抽屉里的链接：先收起（跳转照常走 router-link，这里不动默认行为）
  if (target.closest('.mobile-menu a')) {
    menuOpen.value = false
    return
  }
  // ② 抽屉的空白处：什么都不做
  if (target.closest('.mobile-menu')) return
  // ③ 宽屏：品牌照常回首页
  if (!isCollapsedNav()) return
  // ④ 折叠态的品牌：只开合抽屉，不回首页
  e.preventDefault()
  menuOpen.value = !menuOpen.value
}

function closeMenu() {
  menuOpen.value = false
}

// 点抽屉以外的任何地方收起抽屉。折叠态下它是浮层、没有遮罩，缺了这一条就只能
// 靠再点一次品牌关掉 —— 用户反馈的「点网页内其它东西抽屉不关」。
// 用**捕获阶段**：站内多处用了 @click.stop（日历条目、表格里的 IP 链接等），
// 冒泡阶段会被它们截住，抽屉就关不掉了。捕获阶段在它们之前跑，不受影响；
// 落在品牌/抽屉内的点击直接跳过，开合仍由 onBrandTap 处理。
function onDocClick(e) {
  if (!menuOpen.value) return
  const target = e.target instanceof Element ? e.target : null
  if (target?.closest('.brand-wrap')) return
  menuOpen.value = false
}

// 登录后右上角显示当前站点版本号 + 提交 ID。
// 初始不显示旧 bundle 的构建 commit，避免先闪旧值再被服务端最新 commit 替换；
// 先显示“版本号…”占位，接口返回后更新为“版本号.commit”。
const WELCOME = ref(__APP_VERSION__ ? `${__APP_VERSION__}…` : '')

async function refreshVersion() {
  try {
    const data = await getUpgradeVersion()
    if (data?.currentCommitShort) {
      WELCOME.value = `${__APP_VERSION__}.${data.currentCommitShort}`
    } else {
      WELCOME.value = `${__APP_VERSION__}.${__APP_COMMIT__}`
    }
  } catch {
    // 接口不可用时回退到构建时注入的版本/commit
    WELCOME.value = `${__APP_VERSION__}.${__APP_COMMIT__}`
  }
}

watch(isLoggedIn, (v) => {
  if (v) refreshVersion()
}, { immediate: true })

// 滚动后导航栏浮起（iOS 式阴影渐进），轻微滚动即可触发
const scrolled = ref(false)
function onScroll() {
  scrolled.value = (window.scrollY || document.documentElement.scrollTop || 0) > 8
}

// 同步根元素上的测量值：
//  - --nav-h：真实导航栏高度，供「铺满整页」的页面（控制台 / 错误页 / JSON 工具）算剩余高度
//
// 关于 --wp-shift（壁纸取景偏移）：**刻意不再让它跟随导航栏高度**。
// 壁纸图层用 `background-position: center calc(50% + var(--wp-shift))`，
// 只要这个值一变，整张壁纸就会重新取景 —— 而导航栏高度在**窄屏折行 / 字体加载 /
// 首次测量**时都会变，于是切页面时壁纸会"跳"一下（实测把 --wp-shift 从 24.5px 改成 10px，
// 取样点色差最大达 44）。
// 现在把它固定成常量 WP_SHIFT，壁纸取景与页面无关、永远不动。
// 代价：导航栏变高时，壁纸不再跟着下移半格 —— 视觉上完全看不出（本来就只是微调取景）。
const WP_SHIFT = '24.5px'
const navEl = ref(null)
let navRo = null
let shiftRaf = 0
let lastNavH = -1
function syncWpShift() {
  if (shiftRaf) return
  shiftRaf = requestAnimationFrame(() => {
    shiftRaf = 0
    const h = navEl.value ? navEl.value.offsetHeight : 0
    if (h === lastNavH) return // 高度没变：什么都不写
    lastNavH = h
    const root = document.documentElement.style
    root.setProperty('--nav-h', h + 'px')
    // 只在没写过时写一次；之后再不随导航栏高度变化
    if (!root.getPropertyValue('--wp-shift')) root.setProperty('--wp-shift', WP_SHIFT)
  })
}
onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  syncWpShift()
  if (navEl.value && typeof ResizeObserver !== 'undefined') {
    navRo = new ResizeObserver(() => syncWpShift())
    navRo.observe(navEl.value)
  }
  window.addEventListener('resize', syncWpShift)
  document.addEventListener('click', onDocClick, true)
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  cancelAnimationFrame(shiftRaf)
  navRo?.disconnect()
  window.removeEventListener('resize', syncWpShift)
  document.removeEventListener('click', onDocClick, true)
})
</script>

<template>
  <nav ref="navEl" class="navbar" :class="{ scrolled }">
    <!-- nav-top：标识 + 主导航 -->
    <div class="nav-top">
      <div class="brand-wrap" @click.capture="onBrandTap">
        <router-link to="/" class="brand" aria-label="AniHub 首页" title="AniHub">
          <AppIcon name="atom" :size="23" :stroke-width="1.5" />
        </router-link>
        <!-- 折叠态的下拉抽屉：点品牌开合（见 onBrandTap）。
             第一项是「首页」—— 折叠态下品牌不再负责跳转，没有这一项就回不了首页。 -->
        <div class="mobile-menu" :class="{ open: menuOpen }">
          <router-link to="/" @click="closeMenu">首页</router-link>
          <router-link v-for="l in links" :key="l.to" :to="l.to" @click="closeMenu">{{ l.label }}</router-link>
        </div>
      </div>
      <!-- 主导航链接：窄屏时用 order 提到 .nav-end 之前，保证落在第一行 -->
      <div class="links">
        <router-link v-for="l in links" :key="l.to" :to="l.to">{{ l.label }}</router-link>
      </div>
    </div>

    <form class="nav-search" @submit.prevent="onNavSearch">
      <span class="nav-search-icon"><AppIcon name="search" :size="13" /></span>
      <input v-model.trim="navQ" placeholder="站内搜索…" title="站内搜索（回车）" />
    </form>

    <!-- nav-end：身份信息 + 操作控件（中间一条细分割线，避免整条栏是一长串同权重元素） -->
    <div class="nav-end">
      <div class="user-area">
        <button v-if="showAudioLoad" class="btn btn-sm audio-load-btn" :disabled="loadingAudio" @click="loadRemainingAudio">
          {{ loadingAudio ? '音频加载中…' : '加载音频' }}
        </button>
        <!-- 身份入口：**匿名模式与管理员都用同一个头像 + 悬停浮出卡片**。
             顶栏只见一个圆形头像；鼠标移上去头像向左下放大、下方浮出卡片，
             与 B 站头像的交互一致。键盘 Tab 聚焦也能展开（JS 的 focusin），
             触屏点击同样可展开（见 toggleInsider）。
             ⚠ 展开态**只认 .open**（由 insiderOpen 算出），样式里没有 :hover 展开规则 ——
               否则"悬停时点一下头像收起"会被 :hover 盖回去（用户反馈的"点了没反应"）。
             卡片内容按身份分：
               · 管理员：控制台 / 设置 / 退出（原先这三个按钮直接摊在顶栏上）
               · 匿名模式：匿名模式标题 + 退出内部模式
             ⚠ 站点版本号（`版本.commit`）必须一直可见（这是产品要求），
               所以它没有被藏起来，而是**从顶栏移到了卡片里**。 -->
        <div
          v-if="isLoggedIn || (isInsider && !isLoggedIn)"
          class="insider-wrap"
          :class="{ open: insiderOpen, 'is-admin': isLoggedIn }"
          @pointerenter="onInsiderEnter"
          @pointerleave="onInsiderLeave"
          @focusin="onInsiderEnter"
          @focusout="onInsiderLeave"
        >
          <button
            type="button"
            class="insider-avatar-btn"
            :aria-label="isLoggedIn ? '账户菜单' : '匿名模式'"
            aria-haspopup="true"
            :aria-expanded="insiderOpen ? 'true' : 'false'"
            @click="toggleInsider"
          >
            <img src="/insider.webp" class="insider-avatar" alt="" />
          </button>
          <div
            class="insider-card"
            role="group"
            :aria-label="isLoggedIn ? '账户菜单' : '匿名模式'"
          >
            <!-- 管理员：控制台 / 设置 / 退出 -->
            <template v-if="isLoggedIn">
              <router-link to="/console" class="ic-item" @click="closeInsider">
                <AppIcon name="terminal" :size="13" /> 控制台
              </router-link>
              <router-link to="/settings" class="ic-item" @click="closeInsider">
                <AppIcon name="gear" :size="13" /> 设置
              </router-link>
              <button type="button" class="ic-item" @click="closeInsider(); clearSession()">
                <AppIcon name="x" :size="13" /> 退出
              </button>
              <p v-if="WELCOME" class="ic-version">{{ WELCOME }}</p>
            </template>
            <!-- 匿名模式：仅退出 -->
            <template v-else>
              <p class="ic-name">匿名模式</p>
              <button type="button" class="ic-exit" @click="exitInsider">
                <AppIcon name="x" :size="13" /> 退出内部模式
              </button>
            </template>
          </div>
        </div>
      </div>
      <div class="nav-actions">
        <button type="button" class="btn btn-sm keyboard-btn" title="网页内键盘（游戏 / login / inside）" @click="toggleKeyboard">
          <AppIcon name="keyboard" :size="14" /> 键盘
        </button>
        <span class="theme-slot"><ThemeSelector /></span>
      </div>
    </div>
  </nav>
</template>

<style scoped>
/* ==========================================================================
   导航栏
   颜色沿用原有取值（半透明液态玻璃：只保留少量面板底色，让壁纸透出）。
   毛玻璃要能糊到东西，身后必须有内容：壁纸已迁到 .app-shell 内的
   .wallpaper-layer（z-index:-1），导航栏正好在它之上；滚动时则糊到正文。

   布局三层，宽屏一行 / 窄屏两行：
     .nav-top（标识 + 主导航） · .nav-search（搜索） · .nav-end（身份 + 操作）
   ========================================================================== */
/* 毛玻璃参数取自 :root（见 style.css 的 --nav-* 定义），这里只消费。
   不要在组件内重新定义它们 —— 那样会覆盖 :root 上的值，导致无法统一调整/按主题微调。 */
.navbar {
  position: sticky;
  top: 0;
  /* ── 顶栏高度必须**与断点无关** ──
     顶栏高度 = 上下 padding(8+8) + 最高子元素的高度，所以只要某个子元素在某个断点变高，
     整条顶栏就跟着长高、里面所有元素也一起上下位移（用户反馈"特定分辨率下 navbar 会变高些，
     位置也会改变"）。实测子元素高度会在断点处变化：
       搜索框 28 / 31 / 34px（`≤900px` 把 input 字号提到 16px 防 iOS 缩放 → 34px）
       品牌字 24px / 24.8px
     解法：统一一个 `--nav-item-h` 变量，让所有"会参与撑高"的元素都用它定高
     （搜索框、输入框、键盘按钮、主题开关），并给顶栏自己一个 `min-height` 兜底。
     这样无论字号/内容怎么变，顶栏高度恒定，元素也不会上下跳。 */
  --nav-item-h: 32px;
  min-height: calc(var(--nav-item-h) + 16px);
  /* 层级：必须高于页面内容里那些"悬浮控件"。
     导航栏自建层叠上下文（backdrop-filter 所致），内部元素再高的 z-index
     也出不去，所以头像卡片能不能压住别人完全取决于**这个数字**。
     实测 wiki 页的「列表 / 拓扑图」切换器是 z-index: 220，原值 50 会被它压住
     （命中测试偶尔侥幸通过，但绘制/合成顺序上仍可能被盖）。
     取 250：高于页面级浮层（220 及以下），低于所有弹窗层（300+ 详情弹窗、
     400 虚拟键盘、1000 文件管理），因此不会挡住模态。
     调整前请确认 221~299 这段区间仍无其它用途。 */
  z-index: 250;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  /* 行间距 10px（窄屏换行时用），列间距由各分组的 margin 控制 */
  gap: 10px;
  /* 纵向留白由 10px 收到 8px：这一段直接加在内容高度上，是顶栏总高的主要来源。
     与 .links a 的内边距一起把顶栏从 56px 压到 50px。 */
  padding: 8px 20px;
  background: color-mix(in srgb, var(--panel) var(--nav-bg-alpha, 55%), transparent);
  backdrop-filter: blur(var(--nav-blur, 18px)) saturate(var(--nav-sat, 1.5));
  -webkit-backdrop-filter: blur(var(--nav-blur, 18px)) saturate(var(--nav-sat, 1.5));
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  transition:
    box-shadow var(--dur-ios-2) var(--ease-ios-expo),
    background-color var(--dur-ios-2) var(--ease-ios-expo),
    border-color var(--dur-ios-2) var(--ease-ios-expo);
}

.navbar.scrolled {
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.14);
}

/* —— 第一组：标识 + 主导航 —— */
.nav-top {
  display: flex;
  align-items: center;
  gap: 22px;
  min-width: 0;
}

/* —— 品牌：原子图标（SF Symbols 线性风格，accent 色，深浅主题自适应）。
   原先这里是纯文字「AniHub」，改成图标后靠 aria-label / title 保留可访问名称。 —— */
.brand-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 高度与其它控件一致（只是把可点区域撑高，图标本身仍居中原位、左缘依然是 20px） */
  height: var(--nav-item-h, 32px);
  color: var(--accent);
  text-decoration: none;
  transition: opacity var(--dur-ios-1) var(--ease-ios-expo);
}

.brand:hover {
  opacity: 0.82;
}

/* —— 主导航链接 ——
   文字用 --text（浅色主题下是深色、深色主题下是浅色），
   而不是 --muted：壁纸颜色不可控，浅色主题配浅色文字会看不清。 */
.links {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.links a {
  /* ⚠ 高度**定死**为顶栏控件高度，不要靠 padding + 行高去撑：
     一是那样难免差半像素（早先实测 31px，比旁边的 32px 控件上下各差 0.5px，
     当前页的胶囊底色就会跟按钮边缘错开）；
     二是字号一变（断点里调过字号、或字体加载后度量变化）链接高度就跟着变，
     整条顶栏的高度也会被它顶起来 —— 这个文件一直在防的就是这件事。 */
  display: inline-flex;
  align-items: center;
  height: var(--nav-item-h, 32px);
  padding: 0 13px;
  font-size: 14px;
  font-weight: 500;
  color: color-mix(in srgb, var(--text) 78%, transparent);
  text-decoration: none;
  border-radius: 9px;
  white-space: nowrap;
  transition:
    color var(--dur-ios-1) var(--ease-ios-expo),
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring);
}

.links a:hover {
  color: var(--text);
  background: color-mix(in srgb, var(--text) 8%, transparent);
  transform: translateY(-1px);
}

.links a:active {
  transform: scale(0.95);
  transition-duration: 70ms;
}

/* 当前页：用 accent 底的胶囊，比只换文字颜色更明确 */
.links a.router-link-active {
  color: var(--accent);
  font-weight: 600;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.links a.router-link-active:hover {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
}

/* —— 搜索 ——
   紧跟在主导航之后，自身可伸缩（窄屏被压缩、宽屏也不会拉成超长输入框）。
   注意不要在它身上用 margin: auto —— 那会把搜索框推到中间、在链接后留出一大段空白；
   "吃掉剩余空间"的职责交给 .nav-end 的 margin-left: auto。 */
.nav-search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1 1 200px;
  min-width: 128px;
  max-width: 420px;
  margin-left: 6px;
  /* ⚠ 高度必须**显式定死**，不要靠内容撑 ——
     导航栏高度 = padding(8+8) + 最高子元素的高度，而子元素高度会在断点处变
     （实测：搜索框 28 / 31 / 34px → navH 47 / 49 / 51），
     于是拖动窗口时顶栏会莫名其妙"高一截"、里面元素的位置也跟着上下移。
     这里与下面的 `input` 一起锁成同一个高度，顶栏高度就恒定了。 */
  height: var(--nav-item-h);
}

.nav-search-icon {
  position: absolute;
  left: 11px;
  display: flex;
  color: color-mix(in srgb, var(--text) 55%, transparent);
  pointer-events: none;
  transition: color var(--dur-ios-1) var(--ease-ios-expo);
}

.nav-search:focus-within .nav-search-icon {
  color: var(--accent);
}

.nav-search input {
  width: 100%;
  /* ⚠ 用 height 而不是 padding 控高：`padding: 7px 14px` + `font-size: 13px`
     算出来是 31px，而 `≤900px` 把字号提到 16px（防 iOS 聚焦缩放）后变成 **34px**，
     顶栏就跟着长高 3px。定死高度 + `box-sizing: border-box` 后字号再变也不影响外高。 */
  height: var(--nav-item-h);
  box-sizing: border-box;
  padding: 0 14px 0 30px;
  font-size: 13px;
  color: var(--text);
  background: color-mix(in srgb, var(--text) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  border-radius: 999px;
  outline: none;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-1) var(--ease-ios-expo);
}

.nav-search input::placeholder {
  color: color-mix(in srgb, var(--text) 45%, transparent);
}

.nav-search input:focus {
  background: color-mix(in srgb, var(--text) 4%, transparent);
  border-color: color-mix(in srgb, var(--accent) 62%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
}

/* —— 第三组：身份 + 操作 ——
   margin-left: auto 让这一组整体贴右，剩余空间集中到「搜索之后」这一段；
   组内 user-area 不再单独 auto，否则身份区与操作区之间会裂开一大块。 */
.nav-end {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
}

.user-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 操作区与身份区之间的细分隔线。
   ⚠ 间距刻意收小：`.nav-end` 的 gap 是 6px，而这里的 `margin-left + padding-left` 是
   **叠在 gap 之上**的（6 + 12 + 12 = 30），实测头像到键盘 25px，比其它相邻元素明显松。
   收到 margin 4 / padding 8 后实测 15px，与整条导航栏的节奏一致。
   ⚠ 这两个值在 ≤1180px 必须清零 —— 那里 `.nav-actions` 是 `display: contents`。 */
.nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 4px;
  padding-left: 8px;
  border-left: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}

.theme-slot {
  display: inline-flex;
  align-items: center;
  /* 与其它控件同高（见 .navbar 的 --nav-item-h 说明）。
     开关自身的高度也由 --nav-item-h 推出来（见 ThemeSelector.vue 的 .ts-wrap），
     两边恒等，所以上下边缘能连成一条直线，这里的定高只是兜底。 */
  height: var(--nav-item-h, 32px);
}

/* —— 内部身份：头像 + 悬停浮出卡片 ——
   顶栏只见一个圆形头像；鼠标移上去头像放大、下方浮出卡片（退出在卡片里）。
   交互与 B 站头像一致，因此这里沿用它们的两个关键做法：
     1) 悬停时头像**放大并浮到卡片之上**（z-index / scale），形成"从顶栏探出来"的层次
     2) 卡片与头像**在几何上相连**（卡片 top 略微高于头像底边），
        否则鼠标从头像移到卡片途中会经过一段空隙，卡片会闪一下消失
   ⚠ 展开态**只认 .open**（JS 算出的 insiderOpen），样式里没有 :hover / :focus-within 规则：
     留着 `:hover` 的话，指针停在头像上时"点击头像收起"会被它立刻盖回去（用户反馈的"点了没反应"）。
     键盘可达性没有因此丢失 —— 聚焦由 @focusin 换成 .open，见 script 里的说明。
     这与品牌抽屉（.brand-wrap）是同一个坑，别再加回来。 */
.insider-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
}

/* 卡片必须浮在顶栏其它部分之上。
   注意：只给卡片设 z-index 是**不够的** —— .nav-search 是 position: relative，
   而 .nav-end（卡片的祖先）是 static + z-index: auto；
   按 CSS 绘制顺序，"定位元素"会盖过"非定位元素的子元素"，
   实测卡片底部会被搜索框压住。因此这里把 .nav-end 也提为定位元素并给 z-index。 */
.nav-end {
  position: relative;
  z-index: 2;
}

.insider-avatar-btn {
  display: block;
  padding: 0;
  background: none;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  /* 悬停放大时叠在卡片之上 */
  position: relative;
  z-index: 2;
}

.insider-avatar {
  display: block;
  /* ⚠ 尺寸必须跟 --nav-item-h（顶栏统一控件高度）一致：早先是写死的 28px，
     与旁边 32px 的键盘 / 主题按钮虽然中心对齐，但上下边缘各差 2px，
     整条顶栏的控件边缘连不成一条直线（用户反馈"像不在一根中轴上"）。
     边框已由全局 box-sizing: border-box 计入这个尺寸，不会撑大。 */
  width: var(--nav-item-h, 32px);
  height: var(--nav-item-h, 32px);
  object-fit: cover;
  border: 1.5px solid rgb(122 77 8 / 0.5);
  border-radius: 50%;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.22);
  /* 放大用 transform: scale()，原点取**右上角**：
     右上角固定，头像向左下方向扩展。
     （transform-origin 指的是"固定不动的那一点"，所以要往左下长就取 right top。）
     布局盒子尺寸不随 transform 改变，因此下面的卡片定位与悬停路径都是稳定的。 */
  transform-origin: right top;
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

/* 展开态（.open = 悬停 / 聚焦 / 点击固定）：头像向左下方向变大 */
.insider-wrap.open .insider-avatar {
  transform: scale(1.55);
  border-color: #c9821a;
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent),
    0 8px 20px rgb(0 0 0 / 0.3);
}

.insider-card {
  position: absolute;
  /* 纵向位置要让"头像 → 卡片"这条悬停路径不断开：
     卡片、头像都是 .insider-wrap 的子元素，指针一旦离开两者的并集，
     就会触发 pointerleave 把卡片收起来（表现为卡片闪一下消失）。
     头像以右上角为原点放大到 1.55 倍后底边下移 32 × 0.55 ≈ 17.6px，
     因此把卡片顶边放在 100% + 15px：
       · 收起态：卡片顶边在头像底边下方约 15px（不贴着，视觉干净）
       · 展开态：卡片顶边落在放大后头像底边**之上**约 2.6px，
         与头像相接、路径连续；这 2.6px 落在头像下缘的空白处，不会盖到脸
     实测展开态卡片顶边低于「匿名模式」标题，不遮挡任何文字。
     ⚠ 这两个数都是按头像 32px、放大 1.55 倍算出来的；改头像尺寸要同步改。 */
  top: calc(100% + 15px);
  /* 横向对齐**放大后头像的视觉中心**，而不是 .insider-wrap 的布局中心。
     头像以右上角为原点放大，视觉中心相对布局中心左移
     (32 × 0.55) / 2 ≈ 8.8px；卡片若按 50% 居中就会整体偏右。 */
  --ic-shift: 8.8px;
  left: calc(50% - var(--ic-shift));
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 200px;
  /* 卡片整体已在放大后头像的下方（见上面的 top），因此顶部不再需要
     为头像预留内边距，恢复常规内边距即可。 */
  padding: 12px;
  text-align: center;
  /* 卡片**不透明**（用户要求）：用 --overlay-panel 这个"实底" token ——
     它在浅色主题是 #ffffff、深色主题是 #171a22，两边都是不透明值。
     ⚠ 别用 --panel：那个是带 alpha 的（浅色 0.52 / 深色 0.72），
       底色会透出来，卡片就会看着脏。
     既然已经不透明，backdrop-filter 就没有任何视觉作用了（模糊被实底完全盖住），
     顺手去掉 —— 它还会让卡片自建层叠上下文。 */
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.28);
  /* 收起态：向上收一点 + 淡出，展开时像从头顶"长出来"。
     用 visibility 而不是只靠 opacity：收起时必须真的从可达性树里移除
     （否则顶栏读屏会念出卡片里的文字），同时也一并屏蔽指针事件。 */
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translate(-50%, -6px) scale(0.94);
  transform-origin: top center;
  transition:
    opacity var(--dur-ios-2) var(--ease-ios-expo),
    transform var(--dur-ios-2) var(--ease-ios-spring),
    visibility 0s linear var(--dur-ios-2);
}

.insider-wrap.open .insider-card {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translate(-50%, 0) scale(1);
  transition:
    opacity var(--dur-ios-2) var(--ease-ios-expo),
    transform var(--dur-ios-2) var(--ease-ios-spring),
    visibility 0s;
}

.ic-name {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

/* 退出按钮与卡片同色：只靠边框和悬停反馈区分，不再用琥珀实心块抢视觉焦点 */
.ic-exit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  padding: 7px 10px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
  background: color-mix(in srgb, var(--text) 7%, transparent);
  border: 1px solid var(--border);
  border-radius: 9px;
  cursor: pointer;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring);
}

.ic-exit:hover {
  background: color-mix(in srgb, var(--text) 12%, transparent);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.ic-exit:active {
  transform: scale(0.97);
}

/* —— 管理员卡片里的条目（控制台 / 设置 / 退出）——
   与 .ic-exit 同一套外观：竖排等宽、靠边框与悬停反馈区分，
   不再用顶栏那种实心 .btn（卡片里实心块会显得很吵）。 */
.ic-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 7px;
  width: 100%;
  padding: 7px 10px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
  text-decoration: none;
  background: color-mix(in srgb, var(--text) 7%, transparent);
  border: 1px solid var(--border);
  border-radius: 9px;
  cursor: pointer;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring);
}

.ic-item + .ic-item {
  margin-top: 2px;
}

.ic-item:hover {
  background: color-mix(in srgb, var(--text) 12%, transparent);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.ic-item:active {
  transform: scale(0.97);
}

/* 版本号：从顶栏搬进卡片底部（产品要求它一直可见）。
   小一号、次要色，不跟上面的操作项抢注意力。 */
.ic-version {
  margin: 8px 0 0;
  padding-top: 8px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  border-top: 1px solid var(--border);
}

/* 管理员头像的琥珀色描边换成主题色：与匿名模式的橙色区分开，
   一眼能看出当前是"已登录"还是"匿名"。 */
.insider-wrap.is-admin .insider-avatar {
  border-color: color-mix(in srgb, var(--accent) 62%, transparent);
}

.insider-wrap.is-admin.open .insider-avatar {
  border-color: var(--accent);
}

/* 窄屏：顶栏空间紧张，卡片改为贴右缘对齐，避免溢出视口 */
@media (max-width: 1180px) {
  .insider-card {
    left: auto;
    right: 0;
    transform: translateY(-6px) scale(0.94);
    transform-origin: top right;
  }
  .insider-wrap.open .insider-card {
    transform: translateY(0) scale(1);
  }
}

.btn-sm {
  /* ⚠ 高度用 --nav-item-h 定死（见 .navbar 的说明）：
     原来靠 `padding: 5px 11px` + 字号撑，`≤480px` 把字号降到 12px 后高度就变了，
     顶栏跟着长高/变矮。定高后字号怎么改都不影响顶栏。 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--nav-item-h, 32px);
  box-sizing: border-box;
  padding: 0 11px;
  font-size: 13px;
}

/* 手机比例：AniHub 下拉抽屉
   —— 改版说明 ——
   原来是**完全透明**的一条竖排文字（`background: transparent`，连每项也没有底色），
   压在壁纸上几乎读不清；而且靠 `display: none/flex` 切换，没有任何过渡。
   现在做成真正的**抽屉**：
     · 抽屉本体：实底面板 + 细边框 + 圆角 + 阴影（用 --overlay-panel 这个不透明 token）
     · 每一项各自有底与圆角，hover / 当前页高亮 —— 条目不再"贴"在壁纸上
     · 展开动画：`visibility + opacity + translateY`，像从品牌下方滑出来
   ⚠ 收起**不能**用 `display: none`：那样无法做过渡。改用 visibility + opacity，
     配合 `transition: visibility 0s linear <delay>` 让它在淡出结束后才不可见
     （否则收起瞬间就点不到了）。 */
.mobile-menu {
  /* ⚠ 显隐**不用 display**（那样没法做过渡），这里默认 `display: none`，
     只在窄屏媒体查询里改成 flex；显示/隐藏交给 visibility + opacity + translateY。
     另外这样也保证桌面端不会在文档流里留一个可聚焦的抽屉。 */
  display: none;
  position: absolute;
  top: calc(100% + 6px);
  left: -10px;
  z-index: 60;
  flex-direction: column;
  gap: 2px;
  min-width: 148px;
  padding: 6px;
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.28);
  /* 收起态 */
  opacity: 0;
  visibility: hidden;
  transform: translateY(-8px) scale(0.97);
  transform-origin: top left;
  transition:
    opacity var(--dur-ios-2) var(--ease-ios-expo),
    transform var(--dur-ios-2) var(--ease-ios-spring),
    visibility 0s linear var(--dur-ios-2);
}

.mobile-menu a {
  display: block;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text);
  text-decoration: none;
  white-space: nowrap;
  border-radius: 9px;
  background: color-mix(in srgb, var(--text) 7%, transparent);
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo);
}

.mobile-menu a:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.mobile-menu a.router-link-active {
  color: var(--accent);
  font-weight: 600;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

/* 展开态只在下面的 @media (max-width: 1024px) 里定义，且**只认 .open 状态**。
   ⚠ 别再引入 `.hidden` 这种"另写一份收起态"的写法去和展开规则打特异性官司 ——
     早先就是这么坏掉的（`.brand-wrap:hover .mobile-menu` 0,3,0 压过
     `.mobile-menu.hidden` 0,2,0，于是"关闭"根本关不掉）。 */

/* —— 关于 Wiki 拓扑图（深空场景）——
   这里不再对导航栏做任何"固定深色玻璃"的特殊处理：
   导航栏在所有页面、两种主题下都使用同一套配色（--panel / --text 等主题变量），
   视觉上才是一致的。

   需要注意：.navbar 的 backdrop-filter 只会取到**它正后方**的内容。
   拓扑页的画布在导航栏下方（.graph-full 起始于导航栏底边），
   所以浅色主题下的导航栏取到的是页面背景/壁纸，而不是那块深空画布 ——
   这正是"和其它页面一致"想要的结果。 */

/* ==========================================================================
   响应式：**所有宽度都是单行**
   ==========================================================================
   ⚠⚠ 这里踩过一个坑（用户报的"特定分辨率下还是两行"）：
   旧写法是「第一行 = 品牌 + 链接 + 搜索 + 键盘 + 主题；第二行 = .nav-end（身份/操作）」，
   靠 `.nav-end { flex-basis: 100% }` 强制换行 —— 于是 **1024~1180px 这一段必然是两行**
   （实测 1100 / 1160 / 1180px 都是 navH=88、中心极差 40px 的两行）。
   现在改成真正的单行：链接自己横向滚动、搜索可压缩，其余元素一律 `flex: 0 0 auto`
   不参与伸缩，因此任何宽度都不会再折行。
   ========================================================================== */
@media (max-width: 1180px) {
  .navbar {
    padding: 8px 14px;
    gap: 8px 10px;
    flex-wrap: nowrap;
  }

  /* 解开分组：品牌 / 链接 / 搜索 / 键盘 / 主题 / 身份 直接参与外层排序。
     ⚠⚠ `display: contents` 只让**子元素**参与外层 flex，
       容器自身的 `margin` / `padding` / `border` **依然生效**。
       `.nav-actions` 原本带 `margin-left:12px + padding-left:12px + border-left:1px`，
       展开后这些非但没消失，还因为容器不再生成盒子而"消失得只剩占位效果"——
       实测表现为**搜索与键盘之间凭空多出 38px 空档**（390px 下搜索右缘 207、键盘左缘 245），
       也就是用户说的"手机下头像/键盘/深色模式的位置不对"。必须一并清零。 */
  .nav-top,
  .nav-actions {
    display: contents;
  }

  .nav-actions {
    margin-left: 0;
    padding-left: 0;
    border-left: 0;
  }

  .brand-wrap {
    order: 1;
    flex: 0 0 auto;
  }

  /* 链接：**不抢剩余空间**（flex-grow: 0），超出就横向滚动。
     ⚠ 这里曾经是 `flex: 1 1 auto`，本意是"由链接占掉品牌与搜索之间的空档"，
       结果链接自己把自己撑开、内容却左对齐，中间空出一大块，还把搜索框顶到
       612px 附近（1100px 实测）——而跨过 1180px 断点后搜索框又跳回 467px，
       同一个搜索框在两个区间位置不同（用户反馈的"位置不对"）。
       现在链接保持自然宽度、紧挨品牌，剩余空间全部交给 .nav-end 的
       margin-left: auto，搜索框就始终紧跟在链接后面，与宽屏布局一致。 */
  .links {
    order: 2;
    flex: 0 1 auto;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    flex-wrap: nowrap;
  }

  .links::-webkit-scrollbar {
    display: none;
  }

  .links a {
    flex: 0 0 auto;
    padding: 0 11px;
    font-size: 13px;
  }

  /* 搜索：可压缩、有下限；它后面的元素都不伸缩，保证全挤得进一行 */
  .nav-search {
    order: 3;
    flex: 1 1 60px;
    min-width: 0;
    width: auto;
    margin: 0;
  }

  .keyboard-btn {
    order: 4;
    flex: 0 0 auto;
  }

  .theme-slot {
    order: 5;
    flex: 0 0 auto;
  }

  /* 身份/操作：不伸缩、不换行，靠 `margin-left: auto` 贴右 */
  .nav-end {
    order: 6;
    flex: 0 0 auto;
    width: auto;
    flex-basis: auto;
    min-width: 0;
    margin-left: auto;
    justify-content: flex-end;
    /* ⚠ 这里必须补上 gap：`.nav-actions` 被 display: contents 解开后，
       键盘 / 主题开关直接变成 .nav-end 的 flex 子项，而宽屏下它们与头像之间的
       间距**全靠 .nav-actions 自己的 margin-left + padding-left + border-left**。
       上面那句清零把那套间距一起抹掉了，于是「头像 · 键盘 · 主题」三个元素
       严丝合缝地贴在一起（实测 227/227、288/288，间隙 0）。
       取 10px 与整条顶栏在窄屏下的列间距（.navbar 的 column-gap）对齐。 */
    gap: 10px;
  }

  .user-area {
    flex: 0 0 auto;
    flex-wrap: nowrap;
    gap: 6px;
    min-width: 0;
  }
}

@media (max-width: 1024px) {
  /* 主导航收进品牌抽屉（.mobile-menu），一行只剩：品牌 · 搜索 · 键盘 · 主题 · 身份 */
  .links {
    display: none;
  }

  /* 抽屉：窄屏下改回 flex，显隐由 visibility / opacity / transform 控制 */
  .mobile-menu {
    display: flex;
  }

  /* 展开态：**只**由点击/触摸切换的显式状态决定（见 onBrandTap）。
     ⚠ 不要在这里恢复 :hover / :focus-within 展开：那样会与"点击开合"打架 ——
       点完抽屉里的链接，指针还停在抽屉上，:hover 仍然匹配，显式关闭就被盖回去，
       表现为"列表关不掉"。 */
  .mobile-menu.open {
    opacity: 1;
    visibility: visible;
    transform: translateY(0) scale(1);
    transition:
      opacity var(--dur-ios-2) var(--ease-ios-expo),
      transform var(--dur-ios-2) var(--ease-ios-spring),
      visibility 0s;
  }
}

/* 触摸设备 + 窄屏才把输入框字号提到 16px：iOS Safari 在聚焦时会给字号 < 16px
   的输入框自动放大页面。⚠ 必须带 (pointer: coarse)：这条原本对所有设备生效，
   于是**窄窗口的桌面浏览器**在 900px 上下会出现"站内搜索几个字突然变大"的跳变
   （用户反馈）。鼠标设备不会触发 iOS 那套缩放，字号保持 13px 即可。 */
@media (max-width: 900px) and (pointer: coarse) {
  .nav-search input {
    font-size: 16px;
  }
}

@media (max-width: 560px) {
  /* 很窄：搜索框**保留**，只是被压到最窄。
     （早先这里是 `display: none` 直接藏掉，理由是"放不下"；但手机上站内搜索
     就彻底没有入口了 —— 用户反馈"这个搜索框直接没了"。实测 320px 下
     品牌(21) + 搜索 + 键盘(61) + 主题(77) + 4×10 间距 + 左右 20 内边距
     仍能给搜索框留下约 100px，虽紧但可用；再窄才会挤压链接行。） */
  .nav-search {
    flex: 1 1 40px;
    min-width: 0;
  }
}


@media (max-width: 480px) {
  .navbar {
    padding: 8px 10px;
    gap: 8px;
  }

  /* 很窄的屏上图标略微收小，仍然保持可点面积 */
  .brand :deep(svg) {
    width: 21px;
    height: 21px;
  }

  .btn-sm {
    padding: 5px 8px;
    font-size: 12px;
  }
}
</style>
