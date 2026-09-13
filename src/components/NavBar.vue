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

// 内部身份卡片：CSS 负责悬停/聚焦的视觉，这里只跟进展开状态，
// 让 aria-expanded 与实际一致，并支持触屏（click 切换）。
const insiderOpen = ref(false)

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

// 导航折叠成下拉列表时：AniHub 点击只展开菜单，不跳转回首页
const menuHidden = ref(false)
function onBrandClick(e) {
  // 直接根据当前 DOM 状态判断是否处于折叠态，避免依赖具体断点
  const linksEl = document.querySelector('.links')
  const collapsed = !!linksEl && getComputedStyle(linksEl).display === 'none'
  if (!collapsed) return
  e.preventDefault()
  menuHidden.value = false
}
function closeMenu() {
  menuHidden.value = true
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
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  cancelAnimationFrame(shiftRaf)
  navRo?.disconnect()
  window.removeEventListener('resize', syncWpShift)
})
</script>

<template>
  <nav ref="navEl" class="navbar" :class="{ scrolled }">
    <!-- nav-top：标识 + 主导航 -->
    <div class="nav-top">
      <div class="brand-wrap" @mouseleave="menuHidden = false">
        <router-link to="/" class="brand" @click="onBrandClick">AniHub</router-link>
        <!-- 手机比例：鼠标悬停 AniHub 时展开，菜单位置紧贴品牌下方 -->
        <div class="mobile-menu" :class="{ hidden: menuHidden }">
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
             与 B 站头像的交互一致。键盘 Tab 聚焦也能展开（:focus-within），
             触屏点击同样可展开（见 insiderOpen 的 click 切换）。
             卡片内容按身份分：
               · 管理员：控制台 / 设置 / 退出（原先这三个按钮直接摊在顶栏上）
               · 匿名模式：匿名模式标题 + 退出内部模式
             ⚠ 站点版本号（`版本.commit`）必须一直可见（这是产品要求），
               所以它没有被藏起来，而是**从顶栏移到了卡片里**。 -->
        <div
          v-if="isLoggedIn || (isInsider && !isLoggedIn)"
          class="insider-wrap"
          :class="{ open: insiderOpen, 'is-admin': isLoggedIn }"
          @pointerenter="insiderOpen = true"
          @pointerleave="insiderOpen = false"
        >
          <button
            type="button"
            class="insider-avatar-btn"
            :aria-label="isLoggedIn ? '账户菜单' : '匿名模式'"
            aria-haspopup="true"
            :aria-expanded="insiderOpen ? 'true' : 'false'"
            @click="insiderOpen = !insiderOpen"
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
              <router-link to="/console" class="ic-item" @click="insiderOpen = false">
                <AppIcon name="terminal" :size="13" /> 控制台
              </router-link>
              <router-link to="/settings" class="ic-item" @click="insiderOpen = false">
                <AppIcon name="gear" :size="13" /> 设置
              </router-link>
              <button type="button" class="ic-item" @click="clearSession">
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

/* —— 品牌：保持原有的纯文字样式（accent 色 + 800 字重） —— */
.brand-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.brand {
  font-size: 18px;
  font-weight: 800;
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
  /* 纵向内边距是按"顶栏内容高度"定的：这一项（以及 .navbar 的上下 padding）
     决定了整条顶栏多高（实测导航链接 35px 是最高子元素，搜索框只 31px）。
     由 7px 收到 5px，链接高度 35→31px，与搜索框齐平。 */
  padding: 5px 13px;
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
  padding: 7px 14px 7px 30px;
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

/* 操作区与身份区之间的细分隔线 */
.nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}

.theme-slot {
  display: inline-flex;
  align-items: center;
}

/* —— 内部身份：头像 + 悬停浮出卡片 ——
   顶栏只见一个圆形头像；鼠标移上去头像放大、下方浮出卡片（退出在卡片里）。
   交互与 B 站头像一致，因此这里沿用它们的两个关键做法：
     1) 悬停时头像**放大并浮到卡片之上**（z-index / scale），形成"从顶栏探出来"的层次
     2) 卡片与头像**在几何上相连**（卡片 top 略微高于头像底边），
        否则鼠标从头像移到卡片途中会经过一段空隙，卡片会闪一下消失
   另外用 :focus-within 让键盘 Tab 也能展开（纯 :hover 对键盘不可达）。 */
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
  width: 28px;
  height: 28px;
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

/* 悬停 / 聚焦 / 点击展开（.open 供触屏使用）：头像向左下方向变大 */
.insider-wrap:hover .insider-avatar,
.insider-wrap:focus-within .insider-avatar,
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
     头像以右上角为原点放大到 1.55 倍后底边下移约 15px，
     因此把卡片顶边放在 100% + 13px：
       · 收起态：卡片顶边在头像底边下方约 2.6px（不贴着，视觉干净）
       · 展开态：卡片顶边落在放大后头像底边**之上**约 2.6px，
         与头像相接、路径连续；这 2.6px 落在头像下缘的空白处，不会盖到脸
     实测展开态卡片顶边低于「匿名模式」标题，不遮挡任何文字。 */
  top: calc(100% + 13px);
  /* 横向对齐**放大后头像的视觉中心**，而不是 .insider-wrap 的布局中心。
     头像以右上角为原点放大，视觉中心相对布局中心左移
     (28 × 0.55) / 2 ≈ 7.7px；卡片若按 50% 居中就会整体偏右。 */
  --ic-shift: 7.7px;
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
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  border: 1px solid var(--border);
  border-radius: 14px;
  backdrop-filter: blur(18px) saturate(1.4);
  -webkit-backdrop-filter: blur(18px) saturate(1.4);
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

.insider-wrap:hover .insider-card,
.insider-wrap:focus-within .insider-card,
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

.insider-wrap.is-admin:hover .insider-avatar,
.insider-wrap.is-admin:focus-within .insider-avatar,
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
  .insider-wrap:hover .insider-card,
  .insider-wrap:focus-within .insider-card,
  .insider-wrap.open .insider-card {
    transform: translateY(0) scale(1);
  }
}

.btn-sm {
  padding: 5px 11px;
  font-size: 13px;
}

/* 手机比例：AniHub 下拉菜单 */
.mobile-menu {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 60;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

/* 视觉上不是卡片，而是 AniHub 文字向下自然延伸展开 */
.mobile-menu a {
  display: block;
  padding: 5px 2px;
  font-size: 14px;
  color: color-mix(in srgb, var(--text) 78%, transparent);
  text-decoration: none;
  white-space: nowrap;
  transition: color var(--dur-ios-1) var(--ease-ios-expo);
}

.mobile-menu a:hover {
  color: var(--accent);
  background: transparent;
}

.mobile-menu a.router-link-active {
  color: var(--accent);
  font-weight: 600;
}

.mobile-menu.hidden {
  display: none !important;
}

/* —— 关于 Wiki 拓扑图（深空场景）——
   这里不再对导航栏做任何"固定深色玻璃"的特殊处理：
   导航栏在所有页面、两种主题下都使用同一套配色（--panel / --text 等主题变量），
   视觉上才是一致的。

   需要注意：.navbar 的 backdrop-filter 只会取到**它正后方**的内容。
   拓扑页的画布在导航栏下方（.graph-full 起始于导航栏底边），
   所以浅色主题下的导航栏取到的是页面背景/壁纸，而不是那块深空画布 ——
   这正是"和其它页面一致"想要的结果。 */

/* ==========================================================================
   窄屏 / 中等宽度：导航栏折成两行
   第一行：品牌 + 搜索 + 键盘 + 主题开关（常用入口保持可见）
   第二行：主导航链接 + 身份 —— 链接可横向滚动，绝不竖排文字
   ========================================================================== */
@media (max-width: 1180px) {
  .navbar {
    padding: 8px 14px;
    gap: 8px 10px;
  }

  /* 解开分组：品牌 / 搜索 / 键盘 / 主题 / 链接 直接参与外层排序。
     注意 display:contents 会让子元素丢掉原本的分组位置，因此每个元素都要显式 order。
     .nav-end 的 flex-basis 是 100%，因此 order 必须排在 links 之后 ——
     否则它会先把整行占掉、links 被挤到下一行，出现「身份区在导航链接左边」。 */
  .nav-top {
    display: contents;
  }

  .brand-wrap {
    order: 1;
  }

  .nav-search {
    order: 2;
    flex: 0 1 auto;
    width: 200px;
    margin: 0;
  }

  .nav-actions {
    display: contents;
  }

  .keyboard-btn {
    order: 3;
  }

  .theme-slot {
    order: 4;
  }

  /* 第一行：导航链接占据品牌与搜索之间的剩余空间，可横向滚动 */
  .links {
    order: 1;
    flex: 1 1 auto;
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
    padding: 6px 11px;
    font-size: 13px;
  }

  /* 第二行：身份 + 操作，整行靠右（100% 基准强制换行） */
  .nav-end {
    order: 5;
    flex: 1 1 100%;
    width: 100%;
    min-width: 0;
    margin-left: 0;
    justify-content: flex-end;
  }

  .user-area {
    flex: 0 1 auto;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }

}

@media (max-width: 1024px) {
  .links {
    display: none;
  }

  /* 鼠标悬停 AniHub 时展开，菜单从品牌正下方依次排布 */
  .brand-wrap:hover .mobile-menu,
  .mobile-menu:hover {
    display: flex;
  }
}

@media (max-width: 900px) {
  .nav-search input {
    font-size: 16px; /* 避免 iOS 聚焦时自动放大页面 */
  }

}

@media (max-width: 700px) {
  /* 键盘按钮缩成图标：它对 login / inside 入口是必需的，不能隐藏。
     图标是子组件的 <svg>，字号归零不影响它，所以用 font-size:0 隐掉文字即可。 */
  .keyboard-btn {
    gap: 0;
    padding: 6px 9px;
    font-size: 0;
  }

  .keyboard-btn :deep(.app-icon) {
    width: 16px;
    height: 16px;
  }
}

@media (max-width: 480px) {
  .navbar {
    padding: 8px 10px;
  }

  .brand {
    font-size: 16px;
  }

  .btn-sm {
    padding: 5px 8px;
    font-size: 12px;
  }

  .nav-search {
    flex: 1 1 100%;
    min-width: 0;
  }
}
</style>
