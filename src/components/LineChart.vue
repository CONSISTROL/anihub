<script setup>
// 轻量折线图（Canvas）：多序列 + 时间轴 + 悬停十字线与提示 + 图例
// data 中的 null 表示该桶无数据（断线）；yType: 'percent' | 'bytes' | 'plain'
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  series: { type: Array, required: true }, // [{ name, color, data: (number|null)[] }]
  xLabels: { type: Array, default: () => [] }, // 每个点的刻度标签（时间字符串）
  yType: { type: String, default: 'plain' }, // percent | bytes | plain
  height: { type: Number, default: 180 },
})

const wrap = ref(null)
const canvas = ref(null)
const tip = ref(null)
const tipText = ref('')
const tipPos = ref({ left: 0, top: 0 })
const hoverIdx = ref(-1)

let ro = null

function fmtY(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  if (props.yType === 'percent') return `${Math.round(v)}%`
  if (props.yType === 'bytes') return fmtBytes(v)
  return String(Math.round(v))
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function niceMax(max) {
  if (max <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * pow >= max) return m * pow
  }
  return max
}

function draw() {
  const c = canvas.value
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  const w = c.clientWidth
  const h = props.height
  c.width = w * dpr
  c.height = h * dpr
  const ctx = c.getContext('2d')
  ctx.scale(dpr, dpr)

  const padL = 54
  const padR = 12
  const padT = 14
  const padB = 26
  const plotW = w - padL - padR
  const plotH = h - padT - padB

  // 数据范围
  let max = 0
  for (const s of props.series) {
    for (const v of s.data) if (v !== null && v > max) max = v
  }
  const yMax = niceMax(max)
  const n = Math.max(...props.series.map((s) => s.data.length))

  // 网格 + Y 轴刻度
  ctx.font = '11px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  const TICKS = 4
  for (let i = 0; i <= TICKS; i++) {
    const v = (yMax / TICKS) * i
    const y = padT + plotH - (i / TICKS) * plotH
    ctx.strokeStyle = 'rgba(128,128,128,0.18)'
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(w - padR, y)
    ctx.stroke()
    ctx.fillStyle = 'rgba(128,128,128,0.85)'
    ctx.textAlign = 'right'
    ctx.fillText(fmtY(v), padL - 6, y)
  }

  // X 轴时间标签：按标签宽度自适应数量，避免挨得太近（长标签如 "08-25 20:00" 自动减少个数）
  const labelW = (() => {
    let max = 0
    for (const t of props.xLabels) max = Math.max(max, t.length)
    return max * 7 + 24 // 11px 字体约 7px/字符 + 两端间距
  })()
  const labelCount = Math.max(2, Math.min(8, Math.floor(plotW / labelW)))
  const labelStep = Math.max(1, Math.floor(n / labelCount))
  ctx.textAlign = 'center'
  for (let i = 0; i < n; i += labelStep) {
    const x = n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW
    ctx.fillStyle = 'rgba(128,128,128,0.85)'
    ctx.fillText(props.xLabels[i] || '', x, h - padB + 12)
  }

  // 序列折线（null 断线）
  const xOf = (i) => (n === 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW)
  const yOf = (v) => padT + plotH - (v / yMax) * plotH
  for (const s of props.series) {
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.6
    ctx.lineJoin = 'round'
    ctx.beginPath()
    let pen = false
    s.data.forEach((v, i) => {
      if (v === null || v === undefined) {
        pen = false
        return
      }
      const x = xOf(i)
      const y = yOf(v)
      if (!pen) {
        ctx.moveTo(x, y)
        pen = true
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()
  }

  // 悬停十字线
  if (hoverIdx.value >= 0 && hoverIdx.value < n) {
    const x = xOf(hoverIdx.value)
    ctx.strokeStyle = 'rgba(128,128,128,0.5)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(x, padT)
    ctx.lineTo(x, padT + plotH)
    ctx.stroke()
    ctx.setLineDash([])
    for (const s of props.series) {
      const v = s.data[hoverIdx.value]
      if (v === null || v === undefined) continue
      ctx.fillStyle = s.color
      ctx.beginPath()
      ctx.arc(x, yOf(v), 3.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function onMove(e) {
  const rect = canvas.value.getBoundingClientRect()
  const w = canvas.value.clientWidth
  const n = Math.max(...props.series.map((s) => s.data.length))
  if (n <= 0) return
  const padL = 54
  const padR = 12
  const plotW = w - padL - padR
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left - padL) / plotW))
  const idx = n === 1 ? 0 : Math.round(ratio * (n - 1))
  hoverIdx.value = idx
  // 更新 tooltip
  const label = props.xLabels[idx] || ''
  const lines = props.series.map((s) => `${s.name}: ${fmtY(s.data[idx])}`)
  tipText.value = `${label}\n${lines.join('\n')}`
  const tw = 150
  const tx = Math.min(rect.width - tw - 8, Math.max(8, e.clientX - rect.left - tw / 2))
  tipPos.value = { left: tx, top: 8 }
  tip.value.style.display = 'block'
  draw()
}

function onLeave() {
  hoverIdx.value = -1
  tip.value.style.display = 'none'
  draw()
}

watch(() => [props.series, props.xLabels], () => draw(), { deep: true })

onMounted(() => {
  draw()
  ro = new ResizeObserver(() => draw())
  if (wrap.value) ro.observe(wrap.value)
})
onUnmounted(() => ro?.disconnect())
</script>

<template>
  <div ref="wrap" class="line-chart">
    <div class="chart-head">
      <span class="chart-title">{{ title }}</span>
      <span class="chart-legend">
        <span v-for="s in series" :key="s.name" class="legend-item">
          <i class="legend-dot" :style="{ background: s.color }"></i>{{ s.name }}
        </span>
      </span>
    </div>
    <div class="chart-body" :style="{ height: height + 'px' }">
      <canvas ref="canvas" @mousemove="onMove" @mouseleave="onLeave"></canvas>
      <div ref="tip" class="chart-tip" :style="tipPos">
        <pre class="tip-text">{{ tipText }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-chart {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.chart-title {
  font-size: 13px;
  font-weight: 600;
}

.chart-legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
}

.legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}

.chart-body {
  position: relative;
}

.chart-body canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.chart-tip {
  position: absolute;
  display: none;
  pointer-events: none;
  background: color-mix(in srgb, var(--panel-2) 94%, transparent);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 10px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  max-width: 240px;
}

.tip-text {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  white-space: pre;
  font-family: inherit;
  color: var(--text);
}
</style>
