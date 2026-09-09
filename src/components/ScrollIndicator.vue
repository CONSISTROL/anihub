<script setup>
// 悬浮磁贴式滚动指示条：页面右侧细轨道常显（无箭头）；
// 鼠标靠近右缘时浮现加宽高亮，按住可拖动跳转；页面不可滚动时自动隐藏。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const EDGE = 90 // 鼠标距右缘多少 px 内视为"贴近"（＝右侧可拖拽热区的宽度，与 zone 等宽）
const PAD = 12 // 胶囊内部顶部/底部留白（滑块不贴胶囊圆端）
const near = ref(false)
const has = ref(false)
const len = ref(0)
const top = ref(0)
const trackEl = ref(null)
let dragStart = null // { ratio, clientY }
let raf = 0

function docH() {
  return Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)
}
function winH() {
  return window.innerHeight || document.documentElement.clientHeight
}
function scrollTop() {
  return window.scrollY || document.documentElement.scrollTop || 0
}
function schedule() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    update()
  })
}
// 玻璃药丸当前可用高度（真实 DOM 尺寸，随 padding/宽度动画变化自适应）
function availH() {
  const r = trackEl.value ? trackEl.value.getBoundingClientRect() : null
  return r ? r.height : winH() - 28
}
function update() {
  const th = winH()
  const sh = docH()
  const scrollable = sh > th + 2
  has.value = scrollable
  const avail = availH()
  if (!scrollable || avail <= 0) {
    len.value = 0
    top.value = 0
    return
  }
  // 滑块只在胶囊内部（去掉上下内边距后的区域）滑行
  const inner = avail - PAD * 2
  const ratio = Math.min(1, Math.max(0, scrollTop() / (sh - th)))
  let h
  if (inner <= 64) {
    // 极矮胶囊兜底：至少不越界
    h = Math.max(12, inner - 6)
  } else {
    // 滑块高度与内容占比挂钩，但始终留出胶囊内上下间距
    h = Math.max(44, Math.min(inner - 14, inner * (th / sh)))
  }
  len.value = h
  top.value = PAD + ratio * (inner - h)
}

function onMove(e) {
  // 每次移动都即时判定可滚动性（内容高度可能在无 resize/scroll 事件下变化）
  has.value = docH() > winH() + 2
  near.value = has.value && e.clientX >= window.innerWidth - EDGE
  if (has.value) schedule()
}

// 右侧热区里的真实控件（按钮/链接/输入等）不被滚动条劫持
function isInteractive(el) {
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest(
    'button, a, input, textarea, select, label, [role="tab"], [role="button"], [contenteditable="true"], .view-float, .back-to-top, .back-to-bottom, .theme-slot'
  )
}

// 全局 pointerdown：把「右缘 EDGE 宽整列」作为滚动条可拖拽区域。
// 点击任意空白处 → 立即把滑块中心移到指针处并进入拖动；
// 点击真实控件 → 放行给页面（同时不拦截其 click）。
function onDown(e) {
  if (e.button !== undefined && e.button !== 0) return // 仅左键
  has.value = docH() > winH() + 2 // 按下瞬间兜底刷新可滚动判定
  if (!has.value || !trackEl.value) return
  if (e.clientX < window.innerWidth - EDGE) return // 不在右侧热区内
  if (isInteractive(e.target)) return // 控件放行
  e.preventDefault() // 空白区启动滚动拖拽：避免误选文本/拖图
  near.value = true
  // 捕获指针：拖出热区/窗口也不丢事件
  try {
    trackEl.value.setPointerCapture(e.pointerId)
  } catch {
    /* 忽略（部分环境不支持） */
  }
  const rect = trackEl.value.getBoundingClientRect()
  const inner = rect.height - PAD * 2
  const h = len.value
  // 以滑块中心对准光标（换算在内部滑行区间上）
  const t = Math.min(1, Math.max(0, (e.clientY - rect.top - PAD - h / 2) / (inner - h)))
  const target = Math.max(0, (docH() - winH()) * t)
  window.scrollTo(0, target)
  dragStart = { t }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}
function onDragMove(e) {
  if (!dragStart || !trackEl.value) return
  near.value = true // 拖拽途中即使指针略偏也不隐藏
  const rect = trackEl.value.getBoundingClientRect()
  const inner = rect.height - PAD * 2
  const h = len.value
  const t = Math.min(1, Math.max(0, (e.clientY - rect.top - PAD - h / 2) / (inner - h)))
  window.scrollTo(0, (docH() - winH()) * t)
}
function onDragEnd() {
  dragStart = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}
function onResize() {
  update()
}

const thumbStyle = computed(() => ({
  height: len.value + 'px',
  transform: `translateY(${top.value}px)`,
}))

onMounted(() => {
  update()
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', onResize)
  window.addEventListener('mousemove', onMove, { passive: true })
  window.addEventListener('pointerdown', onDown)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('scroll', schedule)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('pointerdown', onDown)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
})
</script>

<template>
  <div
    class="sbar-zone"
    :class="{ near, visible: has }"
    aria-hidden="true"
  >
    <div
      ref="trackEl"
      class="sbar-track"
    >
      <div class="sbar-thumb" :style="thumbStyle"></div>
    </div>
  </div>
</template>

<style scoped>
/* 悬浮磁贴：平时细轨道；鼠标靠右缘时浮出加宽高亮 */
.sbar-zone {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 90;
  width: var(--sb-zone-w, 90px);
  pointer-events: none; /* 不可见时完全不挡点击 */
  display: flex;
  justify-content: flex-end;
  align-items: center; /* 胶囊纵向居中，长度不再贯穿整列 */
  padding: 14px 8px 14px 0;
  opacity: 1;
  transition: opacity var(--dur-ios-1) var(--ease-ios-expo);
}

/* 常态隐藏：只有可滚动且鼠标贴近右缘时，玻璃胶囊才浮现并可交互 */
.sbar-zone:not(.visible) {
  opacity: 0;
}

.sbar-zone.visible.near .sbar-track {
  pointer-events: auto;
  opacity: 1;
}

/* —— 液态玻璃轨道 —— */
.sbar-track {
  position: relative;
  width: 18px;
  /* 长度改为视口高度约 60%（上下留白），不再贯穿整列 */
  height: var(--sb-track-h, 62%);
  border-radius: 999px;
  /* 玻璃层：配色随主题走（style.css 的 --sbar-* 变量） */
  background:
    linear-gradient(180deg, var(--sbar-track-1), var(--sbar-track-2) 45%, var(--sbar-track-3));
  backdrop-filter: blur(16px) saturate(1.6);
  -webkit-backdrop-filter: blur(16px) saturate(1.6);
  border: 1px solid var(--sbar-track-brd);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 -6px 14px rgba(0, 0, 0, 0.06),
    inset 1px 0 2px rgba(255, 255, 255, 0.12),
    0 8px 24px rgb(0 0 0 / 0.2);
  pointer-events: none;
  cursor: pointer;
  overflow: visible;
  touch-action: none;
  transform: translateX(0);
  /* 平时完全隐藏，贴近右缘时浮现（见 .visible.near 规则） */
  opacity: 0;
  transition:
    width var(--dur-ios-2) var(--ease-ios-spring),
    background var(--dur-ios-2) var(--ease-ios-expo),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo),
    transform var(--dur-ios-2) var(--ease-ios-spring),
    opacity var(--dur-ios-2) var(--ease-ios-expo);
}

/* 玻璃滑块（颜色随主题：浅色=深灰玻璃，深色=亮白玻璃） */
.sbar-thumb {
  position: absolute;
  left: 3px;
  right: 3px;
  top: 0;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--sbar-thumb-1), var(--sbar-thumb-2));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    inset 0 -2px 4px rgba(0, 0, 0, 0.08),
    0 2px 8px rgb(0 0 0 / 0.25);
  transition:
    background var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-1) var(--ease-ios-expo);
}

/* 贴近右缘：浮出放大、玻璃感增强 */
.sbar-zone.near .sbar-track {
  width: 26px;
  background:
    linear-gradient(180deg,
      color-mix(in srgb, var(--sbar-track-1) 60%, #fff),
      color-mix(in srgb, var(--sbar-track-2) 60%, #fff) 45%,
      color-mix(in srgb, var(--sbar-track-3) 60%, #fff));
  border-color: color-mix(in srgb, var(--sbar-track-brd), #fff 18%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    inset 0 -8px 18px rgba(0, 0, 0, 0.07),
    inset 1px 0 3px rgba(255, 255, 255, 0.18),
    0 10px 30px rgb(0 0 0 / 0.28);
}

.sbar-zone.near .sbar-thumb {
  left: 4px;
  right: 4px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--sbar-thumb-1) 40%, var(--accent)),
    color-mix(in srgb, var(--sbar-thumb-2) 30%, var(--accent))
  );
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.45),
    inset 0 -2px 5px rgba(0, 0, 0, 0.06),
    0 0 14px color-mix(in srgb, var(--accent) 45%, transparent);
}
</style>
