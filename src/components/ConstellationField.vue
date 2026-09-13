<script setup>
// 星座背景（主页专用）
//
// 为什么放在 App 层而不是 HomeView 里：
//   放在 HomeView 里时，每次从别的页面切回主页都会重新挂载组件 —— canvas 被销毁重建、
//   粒子全部重新随机，用户看到的就是"闪一下然后重新绘制"。
//   挂在 App 层常驻、只用 on 控制显隐，粒子的位置与速度就一直延续，
//   切回来时是同一片星空，不会有重绘感，也不会重新开始动画。
//
// 排布方式：**按真实星座来摆**，而不是随机撒点。
//   星星按 88 星座数据（CONSTELLATIONS88）的归一化坐标落到画布上，
//   同一星座内部按数据里的折线连线；另外撒一层很淡的"碎星"填满空隙。
//   星座整体随时间极慢自转 + 轻微呼吸缩放，既保持可辨识的形状，又不会像贴图一样死板。
//
// 没有鼠标交互：早先版本会让靠近光标的粒子被吸过去并提亮，视觉上很吵，已去掉。
//   现在只有滚动带来的轻微视差与 z 深度，鼠标完全不参与（连监听都不装）。
//
// 另外动画循环只在 on 时跑（其它页面完全停掉，不空烧 GPU）。
import { onMounted, onUnmounted, ref, watch } from 'vue'
// 88 星座真实连线数据（D3-celestial，BSD-3-Clause）；生成脚本 scripts/build-constellations.mjs
import { CONSTELLATIONS88 } from '../data/constellations88'

// 88 星座真实连线数据（D3-celestial，BSD-3-Clause）
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

let scrollY = 0
let scrollSmooth = 0

// 画的星座个数按面积定（大屏多摆几个，小屏少摆）
const DUST_PER_AREA = 16000 // 每多少 px² 一颗碎星（星座变密后同步加密）
let linkDist = 132

// —— 场：模块级单例 ——
// 组件重新挂载也复用同一份数据（视口尺寸变化时才重建），
// 这样即使 DOM 被重建，星空看上去也是"连续"的。
let items = [] // { kind:'star'|'dust', x,y,z,r,tw,mag, links:[下标] }
let builtW = 0
let builtH = 0
let rotSeed = 0
let rebuildTag = ''

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null

function palette() {
  const dark = document.documentElement.dataset.theme !== 'light'
  // 壁纸本身很花，星座要压得住：提高基础不透明度并给连线更大的权重
  return dark
    ? { dot: '198, 216, 255', line: '150, 180, 245', glow: '130, 165, 255', dotA: 0.92, lineA: 0.6 }
    : { dot: '46, 86, 220', line: '58, 96, 210', glow: '58, 96, 210', dotA: 0.72, lineA: 0.48 }
}

// 把 88 星座摆到画布上：均匀分格 + 格内抖动，避免重叠又不像网格。
//
// 密度：格子约 4.2 万 px²（约 205×205）。1400×900 摆 24 个、1920×1080 摆 48 个左右。
// 88 星座的数据比原来手写的 6 个**稀疏得多**（总共只有 150 段连线、893 个点，
// 平均每个星座不到 2 段），所以格子比 6 星座时代（11 万）要紧得多才不空；
// 但也不能太密 —— 试过 3 万，画面碎成一片、看不出星座的形状。
// 行数确定后把数量**补满整行**（n = cols × rows）——只摆 want 个的话最后一行
// 常常只占一两格，那个角落就空着（实测 4×3 分区里出现 0）。
//
// 星座顺序：把 88 个**不重复地**铺一遍，不够再从头循环（换抖动/缩放/角度，
// 不会看出是同一个）。
function layoutConstellations() {
  const area = Math.max(1, cssW * cssH)
  const want = Math.min(56, Math.max(12, area / 42000))
  const cols = Math.max(1, Math.round(Math.sqrt((want * cssW) / Math.max(1, cssH))))
  const rows = Math.max(1, Math.ceil(want / cols))
  const n = cols * rows
  const cellW = cssW / cols
  const cellH = cssH / rows
  // 单实例的可用尺寸（留 12% 边距，避免贴到格子边）
  const boxW = cellW * 0.88
  const boxH = cellH * 0.88
  // 起手位置：随机挑一个星座作为起点，让每次重新排布看到的顺序都不同
  const startOff = Math.floor(Math.random() * CONSTELLATIONS88.length)

  for (let i = 0; i < n; i++) {
    const def = CONSTELLATIONS88[(startOff + i) % CONSTELLATIONS88.length]
    // 位置抖动 + 尺寸抖动 + 角度抖动，降低网格感
    const cx = (i % cols) * cellW + cellW / 2 + (Math.random() - 0.5) * cellW * 0.38
    const cy = Math.floor(i / cols) * cellH + cellH / 2 + (Math.random() - 0.5) * cellH * 0.38
    const k = 0.68 + Math.random() * 0.32 // 0.68~1.0
    // 星座自带 w/h（长边 = 1），按格子与自身比例算出两个方向的缩放
    const sx = boxW * k
    const sy = boxH * k
    const rot = (Math.random() - 0.5) * 0.8 // ±0.4 rad
    const cos = Math.cos(rot)
    const sin = Math.sin(rot)
    // 折线 → 星点 + 连线。每颗星按它在星座里的位置略微随机亮度，
    // 看起来才不会像"每个点一样亮"的机器图
    for (const line of def.lines) {
      for (let j = 0; j < line.length; j++) {
        const [nx, ny] = line[j]
        // 归一化 [0,1] → 以格子中心为原点的偏移
        const ox = (nx - 0.5) * sx
        const oy = (ny - 0.5) * sy
        const mag = 0.55 + Math.random() * 0.45
        // ⚠ 连线要连"本折线内的上一个点"，不能写 base + j ——
        // 一个星座有多条折线，j 是折线内的下标，base + j 会连错到别的折线上
        const prevIdx = j > 0 ? items.length - 1 : -1
        items.push({
          kind: 'star',
          x: cx + ox * cos - oy * sin,
          y: cy + ox * sin + oy * cos,
          z: 0.55 + mag * 0.45, // 亮星更"近"：更大更亮、视差更多
          r: 0.75 + mag * 1.35,
          mag,
          tw: Math.random() * Math.PI * 2,
          drift: 0.0012 + Math.random() * 0.0016,
          links: prevIdx >= 0 ? [prevIdx] : [],
          cx,
          cy,
          rot,
          size: Math.max(sx, sy),
        })
      }
    }
  }
}

function buildParticles() {
  items = []
  layoutConstellations()
  // 碎星：填满星座之间的空隙，让画面不至于空
  const dust = Math.round(Math.min(520, Math.max(90, (cssW * cssH) / DUST_PER_AREA)))
  for (let i = 0; i < dust; i++) {
    items.push({
      kind: 'dust',
      x: Math.random() * cssW,
      y: Math.random() * cssH,
      z: Math.random(),
      r: 0.4 + Math.random() * 0.9,
      mag: 0.25,
      tw: Math.random() * Math.PI * 2,
      drift: 0.0012 + Math.random() * 0.0016,
      links: [],
      cx: 0,
      cy: 0,
    })
  }
  linkDist = Math.min(170, Math.max(110, cssW / 10))
  rotSeed = Math.random() * Math.PI * 2
  builtW = cssW
  builtH = cssH
  // 重建标记：把这个"批次号"写到 canvas 上。
  // 星空只有被重排时才会换号 —— 切页面回来若号没变，就说明还是同一片星空。
  // （方便自动化验收：像素比对会被闪烁噪声淹没，这个标记是确定性的。）
  rebuildTag = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
  if (canvasEl.value) canvasEl.value.dataset.rebuild = rebuildTag
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
  // 尺寸没变就保留原排布（避免"切页面/小抖动"就把星空重排）
  if (Math.abs(cssW - builtW) > 1 || Math.abs(cssH - builtH) > 1) buildParticles()
  if (!running) draw(0) // 静态兜底也要有一帧
}

// 星座整体绕自身中心极慢自转 + 轻微缩放的呼吸：形状保留，但不像贴图。
// ⚠ 摆放角度 it.rot 已经在 layout 时烘进 x/y 了，这里只叠加"动态"的那部分自转，
// 不能再加一次 it.rot（否则等于转了两次）。
// 相位用 it.rot 错开，各实例的呼吸/自转不同步。
function place(it, t) {
  const breathe = 1 + 0.035 * Math.sin(t * 0.00016 + rotSeed + (it.rot || 0) * 3)
  const rot = 0.05 * Math.sin(t * 0.00009 + rotSeed * 1.7 + (it.rot || 0) * 5)
  const dx = it.x - it.cx
  const dy = it.y - it.cy
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  return {
    x: it.cx + (dx * cos - dy * sin) * breathe,
    y: it.cy + (dx * sin + dy * cos) * breathe,
  }
}

// 亮星的光晕渐变：用径向渐变而不是"实心圆 + 低透明度" ——
// 后者会渲染成有明显硬边的圆盘（亮星看起来像贴了个圆片），渐变才会自然晕开。
let glowGrad = null
let glowKey = ''

function ensureGlow(p, r) {
  const key = `${p.glow}|${r.toFixed(1)}`
  if (glowKey === key && glowGrad) return glowGrad
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  g.addColorStop(0, `rgba(${p.glow}, 0.32)`)
  g.addColorStop(0.45, `rgba(${p.glow}, 0.11)`)
  g.addColorStop(1, `rgba(${p.glow}, 0)`)
  glowGrad = g
  glowKey = key
  return g
}

function draw(t) {
  if (!ctx) return
  const p = palette()
  ctx.clearRect(0, 0, cssW, cssH)

  // 滚动视差：只有滚动参与（鼠标完全不参与）
  const py = -scrollSmooth * 0.04

  const pos = new Array(items.length)
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const b = it.kind === 'star' ? place(it, t) : { x: it.x, y: it.y }
    pos[i] = [b.x, b.y + py * it.z]
  }

  // 1) 星座内部连线（只连同一条折线内的相邻点，不是"近邻全连"）
  // 线宽比 6 星座时代粗一点：88 星座总共只有 150 段（每个星座平均不到 2 段），
  // 单段太细的话整片星空看起来是散的
  ctx.lineWidth = 1.45
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!it.links.length) continue
    const [ax, ay] = pos[i]
    for (const j of it.links) {
      if (j <= i) continue
      const [bx, by] = pos[j]
      const d = Math.hypot(ax - bx, ay - by)
      // 太长的不画（自转/呼吸把距离拉开时避免出现横跨屏幕的怪线）
      if (d > linkDist * 3.2) continue
      ctx.strokeStyle = `rgba(${p.line}, ${p.lineA.toFixed(3)})`
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.stroke()
    }
  }

  // 2) 星星：亮星带光晕，整体各自闪烁
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const [ax, ay] = pos[i]
    const twinkle = 0.78 + 0.22 * Math.sin(t * 0.0012 + it.tw)
    const alpha = Math.min(1, (0.42 + it.z * 0.58) * twinkle * p.dotA)
    const r = it.r * (0.75 + it.z * 0.75)
    ctx.fillStyle = `rgba(${p.dot}, ${alpha.toFixed(3)})`
    ctx.beginPath()
    ctx.arc(ax, ay, r, 0, Math.PI * 2)
    ctx.fill()
    if (it.kind === 'star' && it.mag > 0.8) {
      // 亮星带光晕（径向渐变，边缘自然晕开），制造"星芒"层次
      const gr = r * 6
      ctx.save()
      ctx.translate(ax, ay)
      ctx.fillStyle = ensureGlow(p, gr)
      ctx.beginPath()
      ctx.arc(0, 0, gr, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }
}

function tick(t) {
  if (!running) return
  raf = requestAnimationFrame(tick)
  // 只推进闪烁相位：位置完全由 place() 按时间算出，星座形状不会漂散
  for (const it of items) it.tw += it.drift
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
