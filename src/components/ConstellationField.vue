<script setup>
// 星座背景（主页专用）
//
// 为什么放在 App 层而不是 HomeView 里：
//   放在 HomeView 里时，每次从别的页面切回主页都会重新挂载组件 —— canvas 被销毁重建、
//   粒子全部重新随机，用户看到的就是"闪一下然后重新绘制"。
//   挂在 App 层常驻、只用 on 控制显隐，粒子的位置与速度就一直延续，
//   切回来时是同一片星空，不会有重绘感，也不会重新开始动画。
//
// 另外动画循环只在 on 时跑（其它页面完全停掉，不空烧 GPU）。
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  on: { type: Boolean, default: false },
})

const canvasEl = ref(null)

let ctx = null
let raf = 0
let running = false
let ro = null
let cssW = 0
let cssH = 0
let linkDist = 132

// 鼠标（目标值 + 平滑值，用于视差；归一化到 -0.5 ~ 0.5）
const mouse = { tx: 0, ty: 0, x: 0, y: 0, inside: false }
let scrollY = 0
let scrollSmooth = 0

// —— 粒子场：模块级单例 ——
// 组件重新挂载也复用同一份数据（视口尺寸变化时才重建），
// 这样即使 DOM 被重建，星空看上去也是"连续"的。
let particles = []
let builtW = 0
let builtH = 0

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

function palette() {
  const dark = document.documentElement.dataset.theme !== 'light'
  // 壁纸本身很花，星座要压得住：提高基础不透明度并给连线更大的权重
  return dark
    ? { dot: '198, 216, 255', line: '150, 180, 245', glow: '130, 165, 255', dotA: 0.92, lineA: 0.5 }
    : { dot: '46, 86, 220', line: '58, 96, 210', glow: '58, 96, 210', dotA: 0.72, lineA: 0.4 }
}

function buildParticles() {
  const area = Math.max(1, cssW * cssH)
  // 按面积给数量，并夹在 [90, 230]：高 DPI 大屏也不会把粒子堆到卡顿
  const count = Math.round(Math.min(230, Math.max(90, area / 8000)))
  linkDist = Math.min(170, Math.max(110, cssW / 10))
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * cssW,
    y: Math.random() * cssH,
    // z ∈ [0,1]：越大越"近"，点更大更亮，视差位移也更大
    z: Math.random(),
    vx: (Math.random() - 0.5) * 0.16,
    vy: (Math.random() - 0.5) * 0.16,
    r: 0.65 + Math.random() * 1.6,
    tw: Math.random() * Math.PI * 2, // 闪烁相位
  }))
  builtW = cssW
  builtH = cssH
}

function resize() {
  const el = canvasEl.value
  if (!el) return
  cssW = el.clientWidth || window.innerWidth
  cssH = el.clientHeight || window.innerHeight
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  el.width = Math.round(cssW * dpr)
  el.height = Math.round(cssH * dpr)
  ctx = el.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  // 尺寸没变就保留原粒子（避免"切页面/小抖动"就把星空重排）
  if (Math.abs(cssW - builtW) > 1 || Math.abs(cssH - builtH) > 1) buildParticles()
  if (!running) draw(0) // 静态兜底也要有一帧
}

function draw(t) {
  if (!ctx) return
  const p = palette()
  ctx.clearRect(0, 0, cssW, cssH)

  // 视差：鼠标与滚动都产生轻微位移，营造纵深
  const px = mouse.x * 26
  const py = mouse.y * 26 - scrollSmooth * 0.04
  const mx = (mouse.x + 0.5) * cssW
  const my = (mouse.y + 0.5) * cssH

  // 近邻连线（n ≤ 230，只对近处判定）
  ctx.lineWidth = 1.1
  for (let i = 0; i < particles.length; i++) {
    const a = particles[i]
    const ax = a.x + px * a.z
    const ay = a.y + py * a.z
    for (let j = i + 1; j < particles.length; j++) {
      const b = particles[j]
      const bx = b.x + px * b.z
      const by = b.y + py * b.z
      const dx = ax - bx
      const dy = ay - by
      const d2 = dx * dx + dy * dy
      if (d2 > linkDist * linkDist) continue
      const alpha = (1 - Math.sqrt(d2) / linkDist) * p.lineA
      ctx.strokeStyle = `rgba(${p.line}, ${alpha.toFixed(3)})`
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.stroke()
    }
  }

  // 粒子：靠近光标时被"吸引"并提亮
  for (const a of particles) {
    const ax = a.x + px * a.z
    const ay = a.y + py * a.z
    const dx = mx - ax
    const dy = my - ay
    const d = Math.hypot(dx, dy) || 1
    const pull = mouse.inside ? Math.max(0, 1 - d / 260) : 0
    if (pull > 0) {
      a.x += (dx / d) * pull * 0.35
      a.y += (dy / d) * pull * 0.35
    }
    const twinkle = 0.78 + 0.22 * Math.sin(t * 0.0012 + a.tw)
    const alpha = Math.min(1, (0.42 + a.z * 0.58) * twinkle * p.dotA)
    const r = a.r * (0.75 + a.z * 0.75)
    ctx.fillStyle = `rgba(${p.dot}, ${alpha.toFixed(3)})`
    ctx.beginPath()
    ctx.arc(ax, ay, r, 0, Math.PI * 2)
    ctx.fill()
    if (a.z > 0.78) {
      // 最近的少量粒子带光晕，制造"星芒"层次
      ctx.fillStyle = `rgba(${p.glow}, ${(alpha * 0.22).toFixed(3)})`
      ctx.beginPath()
      ctx.arc(ax, ay, r * 5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function tick(t) {
  if (!running) return
  raf = requestAnimationFrame(tick)
  for (const a of particles) {
    a.x += a.vx
    a.y += a.vy
    if (a.x < -20) a.x = cssW + 20
    else if (a.x > cssW + 20) a.x = -20
    if (a.y < -20) a.y = cssH + 20
    else if (a.y > cssH + 20) a.y = -20
  }
  // 鼠标 / 滚动平滑跟随（系数越小越"重"，手感更稳）
  mouse.x += (mouse.tx - mouse.x) * 0.06
  mouse.y += (mouse.ty - mouse.y) * 0.06
  scrollSmooth += (scrollY - scrollSmooth) * 0.12
  draw(t)
}

function start() {
  if (running || !props.on || reducedMotion?.matches) return
  running = true
  raf = requestAnimationFrame(tick)
}
function stop() {
  running = false
  cancelAnimationFrame(raf)
  raf = 0
}
function onVisibility() {
  if (document.hidden) stop()
  else start()
}

function onPointerMove(e) {
  mouse.inside = e.clientY <= cssH + 40
  mouse.tx = e.clientX / Math.max(1, cssW) - 0.5
  mouse.ty = e.clientY / Math.max(1, cssH) - 0.5
}
function onPointerLeave() {
  mouse.inside = false
  mouse.tx = 0
  mouse.ty = 0
}
function onScroll() {
  scrollY = window.scrollY || document.documentElement.scrollTop || 0
}

// 主页显示状态变化：进入主页立刻补一帧再启动循环，离开则停循环（画面保留在画布上）
watch(
  () => props.on,
  (on) => {
    if (on) {
      resize()
      draw(performance.now()) // 同步补一帧：切换瞬间就有内容，不会闪
      start()
    } else {
      stop()
    }
  }
)

onMounted(() => {
  resize()
  if (reducedMotion?.matches) draw(0) // 尊重"减少动效"：只画一帧静态星座
  else start()
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerleave', onPointerLeave, { passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('resize', resize)
  if (typeof ResizeObserver !== 'undefined' && canvasEl.value) {
    ro = new ResizeObserver(() => resize())
    ro.observe(canvasEl.value)
  }
})

onUnmounted(() => {
  stop()
  ro?.disconnect()
  ro = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerleave', onPointerLeave)
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', resize)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <!-- 常驻画布：只用 .on 控制显隐，绝不销毁重建（否则粒子会重新随机 → 看起来像闪一下重绘） -->
  <div class="constellation" :class="{ on }" aria-hidden="true">
    <canvas ref="canvasEl" class="starfield"></canvas>
    <div class="aura"></div>
  </div>
</template>

<style scoped>
.constellation {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0;
  /* 只在进入 / 离开主页时淡入淡出；画面本身不重绘 */
  transition: opacity var(--dur-ios-3) var(--ease-ios-expo);
}

.constellation.on {
  opacity: 1;
}

.starfield {
  width: 100%;
  height: 100%;
  display: block;
}

/* 中心光晕：给主视觉一个"光源"，随主题浓淡不同 */
.aura {
  position: absolute;
  top: 0;
  left: 50%;
  width: min(1100px, 130vw);
  height: 110%;
  transform: translateX(-50%);
  background: radial-gradient(
    50% 42% at 50% 26%,
    color-mix(in srgb, var(--accent) 26%, transparent),
    transparent 72%
  );
  opacity: 0.9;
}

@media (prefers-reduced-motion: reduce) {
  .constellation {
    transition-duration: 0.01ms;
  }
}
</style>
