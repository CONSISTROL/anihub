<script setup>
// 右侧细进度条：贴在网页最右缘的一条细线，表示当前滚动进度。
// 只在鼠标移到网页右侧热区时淡入，平时完全不可见；可直接按住拖动跳转。
//
// 注意：读取 scrollHeight / getBoundingClientRect 会强制同步布局，
// 因此文档高度用 ResizeObserver 缓存、鼠标移动只做几何比较，
// 不在 mousemove 里读布局（否则鼠标一动就是一次 reflow）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const HOT = 24 // 距右缘多少 px 内算"移到网页右侧"（判定区刻意做窄，不影响右缘的页面元素）
const THIN = 3 // 常态线宽
const THICK = 6 // 悬停/拖动时的线宽

const near = ref(false)
const has = ref(false)
const dragging = ref(false)
// 进度用 0~1 表示，避免把像素换算写进渲染里
const progress = ref(0)

const barEl = ref(null)
let raf = 0
let measureRaf = 0
let ro = null
let docHCache = 0

function winH() {
  return window.innerHeight || document.documentElement.clientHeight
}
function scrollTop() {
  return window.scrollY || document.documentElement.scrollTop || 0
}
function docH() {
  return docHCache || document.documentElement.scrollHeight
}

function apply() {
  const th = winH()
  const sh = docH()
  const max = sh - th
  const scrollable = max > 2
  has.value = scrollable
  progress.value = scrollable ? Math.min(1, Math.max(0, scrollTop() / max)) : 0
}
function schedule() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    apply()
  })
}
/** 重新测量文档高度（会强制布局，只在真正可能变化时调用） */
function measure() {
  measureRaf = 0
  docHCache = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0
  )
  apply()
}
function scheduleMeasure() {
  if (measureRaf) return
  measureRaf = requestAnimationFrame(measure)
}

function onScroll() {
  schedule()
  scheduleMeasure() // 内容可能随滚动懒加载而变高
}
function onResize() {
  near.value = false
  scheduleMeasure()
}
function onMove(e) {
  // 只做几何比较，不读布局
  near.value = has.value && e.clientX >= window.innerWidth - HOT
}
function onLeave() {
  near.value = false
}
function onVisibility() {
  if (document.hidden) near.value = false
}

/* ---------- 拖动跳转 ---------- */
function seekTo(clientY) {
  const max = docH() - winH()
  if (max <= 0) return
  progress.value = Math.min(1, Math.max(0, clientY / winH()))
  window.scrollTo(0, max * progress.value)
}
function onDown(e) {
  if (e.button !== undefined && e.button !== 0) return
  if (!has.value) return
  if (e.clientX < window.innerWidth - HOT) return
  if (typeof e.target?.closest === 'function' && e.target.closest('button, a, input, textarea, select, label, [role="button"]')) {
    return // 热区里的真实控件放行
  }
  dragging.value = true
  e.preventDefault()
  seekTo(e.clientY)
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}
function onDragMove(e) {
  if (!dragging.value) return
  near.value = true
  seekTo(e.clientY)
}
function onDragEnd() {
  dragging.value = false
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

const barStyle = computed(() => ({
  '--p': String(progress.value),
  width: (near.value || dragging.value ? THICK : THIN) + 'px',
}))

onMounted(() => {
  docHCache = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0
  )
  apply()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize, { passive: true })
  window.addEventListener('mousemove', onMove, { passive: true })
  window.addEventListener('pointerdown', onDown)
  document.addEventListener('mouseleave', onLeave)
  document.addEventListener('visibilitychange', onVisibility)
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(scheduleMeasure)
    ro.observe(document.documentElement)
    if (document.body) ro.observe(document.body)
  }
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  cancelAnimationFrame(measureRaf)
  ro?.disconnect()
  ro = null
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('pointerdown', onDown)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  document.removeEventListener('mouseleave', onLeave)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <!-- 贴右缘的细进度条：鼠标进入右侧热区才淡入（判定在脚本里，见 HOT） -->
  <div
    ref="barEl"
    class="rp-bar"
    :class="{ on: has && near, dragging }"
    :style="barStyle"
    aria-hidden="true"
  ></div>
</template>

<style scoped>
/* —— 贴边细条 ——
   用 scaleY 表示进度，避免动画 height（会触发布局）；
   原点设在顶部，滚动越多填得越长。 */
.rp-bar {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 90;
  height: 100vh;
  min-width: 3px;
  border-radius: 999px 0 0 999px;
  pointer-events: none;
  /* 常态完全不可见；鼠标移到右侧才淡入 */
  opacity: 0;
  transform: scaleY(var(--p, 0));
  transform-origin: top center;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent) 85%, #fff),
    var(--accent)
  );
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 45%, transparent);
  transition:
    opacity var(--dur-ios-2) var(--ease-ios-expo),
    width var(--dur-ios-2) var(--ease-ios-spring),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.rp-bar.on {
  opacity: 1;
}

/* 拖动中：加亮、略微外扩，给出"正在操作"的反馈 */
.rp-bar.dragging {
  opacity: 1;
  box-shadow:
    0 0 10px color-mix(in srgb, var(--accent) 60%, transparent),
    0 0 22px color-mix(in srgb, var(--accent) 35%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .rp-bar {
    transition-duration: 0.01ms;
  }
}
</style>
