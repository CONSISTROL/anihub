<script setup>
// 主页：沉浸式入口
//
// 设计目标：像 Wiki 拓扑图那样"活"起来 —— 而不是一张静态卡片列表。
// 构成：
//   1) 全站壁纸背景（WallpaperLayer，浅色主题下与 anime 等页面完全一致）；
//      主页**不再**有独立的 canvas 星座背景 —— 用户要求"不显示背景的星座"，
//      原来那个 ConstellationField（88 星座星点 + 连线）已连同数据文件一起删除
//   2) 主视觉：星座 Logo（HomeLogoMark，星星 + hover 交互）+ 流动渐变标题 + 公告 + 下滑提示
//   3) 五个功能入口做成"星图节点"：跟手倾角（3D tilt）、指向光标处点亮柔光与描边
//
// ⚠ 主页曾经在浅色主题下整屏深空化（深色 token 覆盖 + 壁纸深色遮罩），
//   后按用户要求恢复成"和 anime 一样的正常明亮背景"，相关覆盖已全部移除。
//
// 性能与可访问性：
//   - DPR 上限 2；入口节点按面积自适应
//   - prefers-reduced-motion 下不跑装饰性动效
//   - 标签页不可见 / 卸载时停掉循环
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'
import { getAnnouncement } from '../api/posts'
import AppIcon from '../components/AppIcon.vue'
import HomeLogoMark from '../components/HomeLogoMark.vue'

const { isLoggedIn, isInsider } = useAuth()
const settings = useSettings()
if (!isLoggedIn.value) settings.load() // 加载可见性设置（卡片过滤依赖）

// 主页公告 = 置顶的博客文章（无公告时接口 404，静默隐藏）
const announcement = ref(null)
onMounted(async () => {
  try {
    announcement.value = await getAnnouncement()
  } catch {
    announcement.value = null
  }
})

// 入口配置：与导航/路由一致（page 用于按身份过滤可见性）
// 说明文案用猫娘口吻（轻快、随口介绍的感觉），不要写成产品说明书，
// 也**不要罗列页面的具体功能**（例如"周历/月历/多语言""Markdown/HTML"这类），
// 只讲这个页面是干嘛的、有什么气氛。控制在两行内，卡片高度才不会被撑开。
const SECTIONS = [
  {
    to: '/anime',
    page: 'anime',
    img: '/home/anime.webp',
    icon: 'calendar',
    title: 'Anime',
    cn: '新番日历',
    desc: '这周看什么？哪部几点播我都给你排好啦，打开就知道～',
  },
  {
    to: '/blog',
    page: 'blog',
    img: '/home/blog.webp',
    icon: 'pen',
    title: 'Blog',
    cn: '更新日志',
    desc: '这个站又改了啥、踩了哪些坑，都会随手记在这儿喵～',
  },
  {
    to: '/wiki',
    page: 'wiki',
    img: '/home/wiki.webp',
    icon: 'book-open',
    title: 'Wiki',
    cn: '笔记',
    desc: '攒了一堆笔记呢！也能点拓扑图，看它们牵着手转圈圈～',
  },
  {
    to: '/tools',
    page: 'tools',
    img: '/home/tools.webp',
    icon: 'wrench',
    title: 'Tools',
    cn: '工具箱',
    desc: '都是你能用上的小工具，大多在你本机跑，不上传喵～',
  },
  {
    to: '/game',
    page: 'game',
    img: '/home/game.webp',
    icon: 'flame',
    title: 'Game',
    cn: '像素地牢',
    desc: '想下地牢随时来～地图每局都不一样，摸鱼的时候很合适喵。',
  },
]

const visibleSections = computed(() =>
  isLoggedIn.value ? SECTIONS : SECTIONS.filter((s) => settings.canAccess(s.page, isInsider.value))
)

/* ⚠ 主页原先在 App 层挂了一个常驻的 canvas 星座背景（ConstellationField）——
   放在 HomeView 里会随路由切换被销毁重建、粒子每次重新随机，
   所以当初挂在 App 层让同一片星空延续。该功能已按用户要求整体移除
   （"不显示背景的星座"），组件与 88 星座数据文件都已删除。 */

/* 下滑提示：页面还能继续往下滚时显示 */
const canScroll = ref(false)
const stageEl = ref(null)
let scrollCheckRaf = 0

/** 是否开启了"减少动效"（只用于抑制装饰性动效与滚动行为） */
function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function checkScrollable() {
  if (scrollCheckRaf) return
  scrollCheckRaf = requestAnimationFrame(() => {
    scrollCheckRaf = 0
    canScroll.value =
      document.documentElement.scrollHeight - window.innerHeight - (window.scrollY || 0) > 80
  })
}
function scrollIntoViewNext() {
  stageEl.value?.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  })
}

onMounted(() => {
  checkScrollable()
  window.addEventListener('scroll', checkScrollable, { passive: true })
  window.addEventListener('resize', checkScrollable, { passive: true })
})

onUnmounted(() => {
  cancelAnimationFrame(scrollCheckRaf)
  window.removeEventListener('scroll', checkScrollable)
  window.removeEventListener('resize', checkScrollable)
})

/* ------------------------- 卡片跟手倾角 ------------------------- */
// 鼠标在卡片上的相对位置 → 轻微 3D 旋转 + 柔光位置（写成 CSS 变量，交给样式消费）
function onCardMove(e) {
  const el = e.currentTarget
  if (!el || typeof el.getBoundingClientRect !== 'function') return
  const r = el.getBoundingClientRect()
  const nx = (e.clientX - r.left) / Math.max(1, r.width) - 0.5
  const ny = (e.clientY - r.top) / Math.max(1, r.height) - 0.5
  el.style.setProperty('--rx', (ny * -7).toFixed(2) + 'deg')
  el.style.setProperty('--ry', (nx * 9).toFixed(2) + 'deg')
  el.style.setProperty('--gx', ((nx + 0.5) * 100).toFixed(1) + '%')
  el.style.setProperty('--gy', ((ny + 0.5) * 100).toFixed(1) + '%')
}
function onCardLeave(e) {
  const el = e.currentTarget
  if (!el) return
  el.style.setProperty('--rx', '0deg')
  el.style.setProperty('--ry', '0deg')
}
</script>

<template>
  <div class="home">
    <!-- 主视觉 -->
    <section class="hero">
      <HomeLogoMark />

      <!-- 原先两行（"记东西，顺手折腾点小工具" + "记录折腾，也记录踩过的坑"）已合并成一行，
           后来又按用户要求把后半句去掉，只留前半句。 -->
      <p class="tagline">记东西，顺手折腾点小工具</p>

      <router-link v-if="announcement" :to="`/${announcement.category}/${announcement.slug}`" class="announce">
        <span class="ann-mark"><AppIcon name="megaphone" :size="13" /> 公告</span>
        <span class="ann-title">{{ announcement.title }}</span>
        <span v-if="announcement.summary" class="ann-summary">{{ announcement.summary }}</span>
        <AppIcon name="arrow-right" :size="14" class="ann-go" />
      </router-link>

      <button v-if="canScroll" type="button" class="scroll-hint" @click="scrollIntoViewNext">
        <span>向下探索</span>
        <AppIcon name="chevron-down" :size="15" />
      </button>
    </section>

    <!-- 内容区：先铺一层与主题同色的渐变遮罩，把花哨的壁纸压下去，保证卡片可读 -->
    <div class="content">
      <section ref="stageEl" class="stage">
        <div class="stage-head">
          <span class="stage-line" aria-hidden="true"></span>
          <span class="stage-label">今天想看点啥？</span>
          <span class="stage-line" aria-hidden="true"></span>
        </div>

        <!-- 固定 6 列：5 张卡片按 2/3 排成两行，不会出现"最后一个孤零零"的缺口 -->
        <div class="nodes">
          <router-link
            v-for="(s, i) in visibleSections"
            :key="s.to"
            :to="s.to"
            class="node"
            :style="{ '--i': i }"
            @pointermove="onCardMove"
            @pointerleave="onCardLeave"
          >
            <span class="node-glow" aria-hidden="true"></span>

            <span class="node-top">
              <span class="node-icon"><AppIcon :name="s.icon" :size="20" /></span>
              <span class="node-idx">0{{ i + 1 }}</span>
            </span>

            <span class="node-visual">
              <img :src="s.img" :alt="s.title" width="512" height="512" loading="lazy" decoding="async" />
            </span>

            <span class="node-title">
              {{ s.title }}
              <em>{{ s.cn }}</em>
            </span>
            <span class="node-desc">{{ s.desc }}</span>

            <span class="node-go">
              进入 <AppIcon name="arrow-right" :size="13" />
            </span>
          </router-link>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home {
  position: relative;
  min-height: 100vh;
}

/* ⚠ 主页**不再**做深空化：浅色主题下与 anime 等页面完全一致（正常明亮背景）。
   早先这里是 `:root[data-theme='light'] .home { --bg: #0e1015; --text: #e8eaf0; … }`
   一整套深色 token 覆盖，配合壁纸层的深色遮罩，让两个主题的主页背景看起来一致。
   用户后来明确要求"浅色模式下主页恢复正常明亮背景"，于是连同 canvas 星座背景一起移除。
   现在主页直接用浅色主题的全局 token，没有任何页面级覆盖。
   若日后要恢复深色主页，必须**同时**改三处，缺一处就会出现"文字看不见"或"底色泄露"：
     ① 本处 token 覆盖　② 壁纸层的深色遮罩（WallpaperLayer.vue 的 data-deep 规则）
     ③ wikiView.js 的 isDeepRoute 里把 home 加回去（否则 body 底色仍是浅的） */

/* —— 主视觉 —— */
.hero {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  min-height: 100vh;
  padding: 96px 20px 80px;
  text-align: center;
}

/* Logo 已抽成独立组件：src/components/HomeLogoMark.vue
   （星星为元素、三体运动 + 彗尾 + hover 加速；尺寸/动效/reduced-motion 都在那边）
   原先 Logo 下面还有一个大号渐变「AniHub」标题 —— 用户反馈太占空间，已去掉；
   站名在顶栏品牌处已经写过一次了。 */

.tagline {
  margin: 0;
  font-size: 15px;
  color: var(--muted);
}

/* 公告
   —— 设计取舍 ——
   原来是「胶囊药丸 + 毛玻璃 + 强调色描边」：圆角 999px、边框带 accent 色，
   放在居中的 Logo / 一行标语 / 下滑提示之间，像一个孤立的按钮，跟主视觉不搭。
   改成一枚**克制的横条**：
     · 圆角从 999px 收到 14px —— 不再像按钮，更像一张"公告纸"
     · 去掉强调色描边，改成"左边一道 accent 竖条 + 中性细边框"，层次靠留白不靠撞色
     · 底色沿用同主题的实色感（不透明度过高会与壁纸割裂，这里仍留一点透）
     · hover 时不整体上移（主视觉里位移很跳），改为**底色与左条同时变亮**，
       并让箭头右移一小步 —— 动静更收敛
   ⚠ 别再用 999px 胶囊：那个形状在主视觉里太"UI 组件"了。

   ⚠⚠ 两个已修的渲染问题（用户反馈）：
   1) **左侧竖条改用 `border-left`，不再用绝对定位的 `::before`**。
      原来那道 3px 竖条是 `position:absolute; left:0; top:0; bottom:0` 的**矩形**，
      和 14px 圆角对不上 —— 矩形的直角压在圆角上，左上/左下会露出"方角"。
      现在写成 `border-left: 3px` + `border-radius`，边框天然沿圆角走，
      几何上不可能错位（去掉了一个 ::before，也不再需要 overflow:hidden 去裁它）。
   2) **去掉 `backdrop-filter`**。路由级视图（`.page`）切换时会做 `translateY + scale`，
      而 `backdrop-filter` 要采样身后内容、在祖先做变换时采样会晚一两帧才稳定 ——
      表现就是"先透明、随后才变成毛玻璃"。
      公告条下面就是壁纸，把底色加实一点即可，模糊在这里换不来多少观感。
      ⚠ 同类隐患：**任何放在路由过渡元素里、又带 backdrop-filter 的小卡片**都可能有这个现象。 */
.announce {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: min(680px, 92vw);
  margin-top: 14px;
  /* 左侧 3px 边框已计入，文字内边距相应减 3px，视觉留白与右侧一致 */
  padding: 11px 16px 11px 15px;
  font-size: 13.5px;
  color: var(--text);
  text-decoration: none;
  text-align: left;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  border: 1px solid var(--border);
  /* 左条：边框沿圆角走，永远与圆角矩形贴合 */
  border-left: 3px solid var(--accent);
  border-radius: 14px;
  box-shadow: 0 8px 26px rgb(0 0 0 / 0.14);
  overflow: hidden;
  transition:
    background-color var(--dur-ios-2) var(--ease-ios-expo),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

/* 一道很淡的高光斜掠：只有 hover 时扫过，给一点"被注意到"的感觉 */
.announce::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 30%,
    color-mix(in srgb, var(--accent) 14%, transparent) 50%,
    transparent 70%
  );
  transform: translateX(-120%);
  transition: transform 900ms var(--ease-ios-expo);
  pointer-events: none;
}

.announce:hover {
  background: color-mix(in srgb, var(--panel) 100%, transparent);
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  /* 左条同时提亮（它现在是 border-left，不再有 ::before 的 opacity 可调） */
  border-left-color: var(--accent-hover);
  box-shadow: 0 12px 32px color-mix(in srgb, var(--accent) 18%, transparent);
}

.announce:hover::after {
  transform: translateX(120%);
}

.ann-mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 3px 9px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 999px;
}

.ann-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

/* 摘要属于作者自由填写的内容（可能是一串装饰符号），
   给个上限并允许被挤压而先让位给标题，避免长摘要把标题挤没。 */
.ann-summary {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted);
}

.ann-go {
  flex: 0 0 auto;
  color: var(--accent);
  transition: transform var(--dur-ios-2) var(--ease-ios-spring);
}

.announce:hover .ann-go {
  transform: translateX(3px);
}

/* 下滑提示 */
.scroll-hint {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-top: 26px;
  padding: 6px 10px;
  font: inherit;
  font-size: 12px;
  color: var(--muted);
  background: none;
  border: 0;
  cursor: pointer;
  animation: hint-bob 2.6s var(--ease-ios) infinite;
}

.scroll-hint:hover {
  color: var(--accent);
}

@keyframes hint-bob {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.75;
  }
  50% {
    transform: translateY(6px);
    opacity: 1;
  }
}

/* —— 入口节点 —— */
/* 内容区遮罩：与主题同色的渐变压暗。
   壁纸很花，不加这层卡片上的文字会被背景吃掉；但过渡要足够长，
   否则主视觉（透出壁纸）与内容区之间会出现一条生硬的分界线。 */
.content {
  position: relative;
  z-index: 1;
  background: linear-gradient(
    180deg,
    transparent 0%,
    color-mix(in srgb, var(--bg) 30%, transparent) 10%,
    color-mix(in srgb, var(--bg) 62%, transparent) 26%,
    color-mix(in srgb, var(--bg) 82%, transparent) 48%,
    color-mix(in srgb, var(--bg) 90%, transparent) 100%
  );
}

.stage {
  position: relative;
  max-width: min(1320px, 95vw);
  margin: 0 auto;
  padding: 56px 20px 90px;
}

.stage-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 26px;
}

.stage-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--accent) 55%, transparent),
    transparent
  );
}

.stage-label {
  flex: 0 0 auto;
  font-size: 12px;
  letter-spacing: 0.22em;
  color: color-mix(in srgb, var(--muted) 90%, transparent);
}

/* 6 列栅格 + span 2：
   5 张卡片在宽屏下排成 3 + 2 两行，末行居中，不会出现四张挤一行、最后一张孤立的缺口。
   窄屏自动降级为 2 列 / 1 列。 */
.nodes {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 20px;
}

.node {
  grid-column: span 2;
  min-width: 0;
}

/* 第 4、5 张（第二行的两张）各占 2 列并居中：靠左右各空 1 列实现 */
.node:nth-child(4) {
  grid-column: 2 / span 2;
}

.node:nth-child(5) {
  grid-column: 4 / span 2;
}

/* 卡片：玻璃 + 跟手倾角 + 指向光标的径向柔光 */
.node {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  overflow: hidden;
  color: var(--text);
  text-decoration: none;
  background: color-mix(in srgb, var(--panel) 82%, transparent);
  border: 1px solid var(--border);
  border-radius: 18px;
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  transform: perspective(900px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)) translateZ(0);
  transform-style: preserve-3d;
  transition:
    transform var(--dur-ios-3) var(--ease-ios-expo),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-3) var(--ease-ios-expo);
  animation: node-in var(--dur-ios-4) var(--ease-ios-expo) calc(120ms + var(--i, 0) * 80ms) backwards;
}

@keyframes node-in {
  from {
    opacity: 0;
    transform: translateY(22px) scale(0.97);
  }
}

.node-glow {
  position: absolute;
  inset: -1px;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(
    240px 200px at var(--gx, 50%) var(--gy, 50%),
    color-mix(in srgb, var(--accent) 30%, transparent),
    transparent 70%
  );
  transition: opacity var(--dur-ios-2) var(--ease-ios-expo);
}

.node:hover {
  border-color: color-mix(in srgb, var(--accent) 65%, var(--border));
  box-shadow:
    0 22px 50px color-mix(in srgb, var(--accent) 22%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
}

.node:hover .node-glow {
  opacity: 1;
}

.node:active {
  transform: perspective(900px) scale(0.985);
  transition-duration: 70ms;
}

.node-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.node-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-radius: 12px;
  transition: transform var(--dur-ios-2) var(--ease-ios-spring);
}

.node:hover .node-icon {
  transform: scale(1.08) rotate(-4deg);
}

.node-idx {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.16em;
  color: color-mix(in srgb, var(--muted) 70%, transparent);
}

.node-visual {
  display: block;
  height: 118px;
  margin: 2px 0;
  text-align: center;
}

.node-visual img {
  height: 100%;
  width: auto;
  max-width: 100%;
  object-fit: contain;
  filter: drop-shadow(0 12px 24px rgb(0 0 0 / 0.2));
  transition: transform var(--dur-ios-3) var(--ease-ios-spring);
}

.node:hover .node-visual img {
  transform: translateY(-4px) scale(1.05);
}

.node-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 19px;
  font-weight: 700;
}

.node-title em {
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
  color: var(--muted);
}

.node-desc {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--muted);
}

.node-go {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: auto;
  padding-top: 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
}

.node-go :deep(.app-icon) {
  transition: transform var(--dur-ios-2) var(--ease-ios-spring);
}

.node:hover .node-go :deep(.app-icon) {
  transform: translateX(4px);
}

@media (max-width: 1080px) {
  /* 两列：取消"居中排布"的显式定位，交给自动流式排列填满 */
  .nodes {
    grid-template-columns: repeat(2, 1fr);
  }

  .node,
  .node:nth-child(4),
  .node:nth-child(5) {
    grid-column: auto;
  }
}

@media (max-width: 720px) {
  .hero {
    padding: 72px 16px 56px;
    gap: 14px;
  }

  /* 窄屏：公告条改为两行（标记+标题一行，摘要让到下一行），不再用 flex-wrap
     硬折（那会把"公告"标记单独挤到一行，很难看） */
  .announce {
    flex-wrap: wrap;
    row-gap: 4px;
    padding: 10px 14px 10px 16px;
  }

  .ann-summary {
    max-width: 100%;
    flex-basis: 100%;
    /* 摘要挪到第二行后，和第二行的箭头对齐得上 */
    order: 3;
  }

  .ann-go {
    order: 2;
    margin-left: auto;
  }

  .stage {
    padding: 40px 16px 64px;
  }

  .nodes {
    grid-template-columns: 1fr;
  }

  .node {
    padding: 16px;
  }

  .node-visual {
    height: 96px;
  }
}

/* 用户要求减少动效：停掉循环动画与跟手倾角
   （Logo 内部的动效由 HomeLogoMark 自己的 reduced-motion 规则接管） */
@media (prefers-reduced-motion: reduce) {
  .scroll-hint,
  .node {
    animation: none;
  }

  .node {
    transform: none;
  }
}
</style>
