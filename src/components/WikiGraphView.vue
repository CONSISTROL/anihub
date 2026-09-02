<script setup>
// Wiki 拓扑视图：把条目作为节点，共享至少一个标签的两个条目之间画一条关联边。
// 使用轻量 force-directed 布局 + 矩形碰撞分离，避免卡片重叠。
// 鼠标悬停/键盘聚焦卡片时高亮相连的边与邻接卡片。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { listPosts } from '../api/posts'

const router = useRouter()

const loading = ref(true)
const error = ref('')
const items = ref([])
const nodes = ref([])
const edges = ref([])
const running = ref(false)
const activeId = ref(null)
const filterTags = ref([])
const maxShared = ref(1)

let viewW = 1400
let viewH = 900
const MARGIN = 100
const NODE_H = 46
const CARD_GAP = 30
let raf = null
let iter = 0
const MAX_ITER = 520

let measureCtx = null
function getMeasureCtx() {
  if (typeof document === 'undefined') return null
  if (!measureCtx) {
    const canvas = document.createElement('canvas')
    measureCtx = canvas.getContext('2d')
  }
  return measureCtx
}

// 用 canvas 实测文本宽度，兼容中文/英文混排，避免按字符数估算导致溢出
function textWidth(text, size, weight) {
  const ctx = getMeasureCtx()
  const s = String(text || '')
  if (!ctx) return s.length * size * 0.62
  ctx.font = `${weight || 400} ${size}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif`
  return ctx.measureText(s).width
}

function fitText(text, maxWidth, size, weight) {
  const s = String(text || '')
  if (textWidth(s, size, weight) <= maxWidth) return s
  const ell = '…'
  let low = 0
  let high = s.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (textWidth(s.slice(0, mid) + ell, size, weight) <= maxWidth) low = mid
    else high = mid - 1
  }
  return s.slice(0, low) + ell
}

// 卡片宽度由标题实际宽度 + 标签预览宽度共同决定，保证文字能放进卡片
function rawTagPreview(n) {
  const tags = n.tags || []
  if (!tags.length) return '无标签'
  return tags.slice(0, 3).map((t) => '#' + t).join(' ')
}

function nodeWidth(n) {
  const titleW = textWidth(String(n.title || ''), 13, 600)
  const tagW = textWidth(rawTagPreview(n), 10, 500)
  return Math.max(96, Math.min(240, Math.ceil(Math.max(titleW, tagW) + 30)))
}

function nodeHeight() {
  return NODE_H
}

// 标题按卡片实际可用宽度截断，避免文字超出卡片
function fmtTitle(n) {
  const maxWidth = nodeWidth(n) - 20
  return fitText(String(n.title || ''), maxWidth, 13, 600)
}

// 标签也按卡片实际可用宽度截断
function fmtTags(n) {
  const tags = n.tags || []
  if (!tags.length) return ''
  const maxWidth = nodeWidth(n) - 20
  for (let count = Math.min(3, tags.length); count >= 1; count--) {
    const suffix = tags.length > count ? ` +${tags.length - count}` : ''
    const text = tags.slice(0, count).map((t) => '#' + t).join(' ') + suffix
    if (textWidth(text, 10, 500) <= maxWidth) return text
  }
  return fitText('#' + tags[0], maxWidth, 10, 500)
}

function openNode(slug) {
  router.push(`/wiki/${slug}`)
}

function buildGraph() {
  const list = items.value
  if (!list.length) return

  const ns = list.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    tags: Array.isArray(p.tags) ? p.tags : [],
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  }))
  const es = []
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const shared = ns[i].tags.filter((t) => ns[j].tags.includes(t))
      if (shared.length) es.push({ i, j, shared })
    }
  }
  maxShared.value = es.length ? Math.max(...es.map((e) => e.shared.length)) : 1

  const cx = viewW / 2
  const cy = viewH / 2
  const radius = Math.max(140, Math.min(viewW, viewH) / 2 - 160)
  ns.forEach((node, index) => {
    const angle = ns.length === 1 ? 0 : (index / ns.length) * Math.PI * 2
    node.x = cx + radius * Math.cos(angle) + (Math.random() * 80 - 40)
    node.y = cy + radius * Math.sin(angle) + (Math.random() * 80 - 40)
  })

  nodes.value = ns
  edges.value = es
  startSimulation()
}

function clampToView(n) {
  n.x = Math.max(MARGIN, Math.min(viewW - MARGIN, n.x))
  n.y = Math.max(MARGIN, Math.min(viewH - MARGIN, n.y))
}

// 矩形碰撞分离：确保卡片之间不重叠，并保留 CARD_GAP 间距
function separateOverlaps() {
  const ns = nodes.value
  if (!ns.length) return
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i]
      const b = ns[j]
      const minX = (nodeWidth(a) + nodeWidth(b)) / 2 + CARD_GAP
      const minY = nodeHeight() + CARD_GAP
      let dx = b.x - a.x
      let dy = b.y - a.y
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)
      const ox = minX - absX
      const oy = minY - absY
      if (ox <= 0 || oy <= 0) continue
      if (ox < oy) {
        const dir = dx >= 0 ? 1 : -1
        const move = ox / 2
        a.x -= dir * move
        b.x += dir * move
      } else {
        const dir = dy >= 0 ? 1 : -1
        const move = oy / 2
        a.y -= dir * move
        b.y += dir * move
      }
    }
  }
  ns.forEach(clampToView)
}

function hasOverlap() {
  const ns = nodes.value
  if (!ns.length) return false
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i]
      const b = ns[j]
      const minX = (nodeWidth(a) + nodeWidth(b)) / 2 + CARD_GAP
      const minY = nodeHeight() + CARD_GAP
      if (Math.abs(a.x - b.x) < minX && Math.abs(a.y - b.y) < minY) return true
    }
  }
  return false
}

function settleCollisions() {
  let guard = 0
  while (hasOverlap() && guard < 600) {
    separateOverlaps()
    guard += 1
  }
}

function applyForces() {
  const ns = nodes.value
  const es = edges.value
  if (!ns.length) return

  // 两两斥力
  for (let i = 0; i < ns.length; i++) {
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i]
      const b = ns[j]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let d = Math.sqrt(dx * dx + dy * dy) || 1
      const force = 14000 / (d * d)
      dx /= d
      dy /= d
      a.vx += dx * force
      a.vy += dy * force
      b.vx -= dx * force
      b.vy -= dy * force
    }
  }

  // 边弹簧：拉向目标长度
  for (const e of es) {
    const a = ns[e.i]
    const b = ns[e.j]
    let dx = a.x - b.x
    let dy = a.y - b.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const target = Math.max(190, Math.min(300, 270 - e.shared.length * 24))
    const f = (d - target) * 0.014
    dx /= d
    dy /= d
    a.vx -= dx * f
    a.vy -= dy * f
    b.vx += dx * f
    b.vy += dy * f
  }

  // 向中心轻微聚拢，避免整体漂移
  const cx = viewW / 2
  const cy = viewH / 2
  for (const n of ns) {
    n.vx += (cx - n.x) * 0.001
    n.vy += (cy - n.y) * 0.001
    n.vx *= 0.85
    n.vy *= 0.85
    n.x += n.vx
    n.y += n.vy
  }

  // 每帧做一次碰撞分离，避免中途卡片叠在一起
  separateOverlaps()
}

function startSimulation() {
  if (raf) cancelAnimationFrame(raf)
  iter = 0
  running.value = true
  const step = () => {
    applyForces()
    iter += 1
    if (iter < MAX_ITER) {
      raf = requestAnimationFrame(step)
    } else {
      // 结束后继续碰撞分离，直到没有重叠或达到保护上限
      settleCollisions()
      running.value = false
      raf = null
    }
  }
  raf = requestAnimationFrame(step)
}

// —— 标签筛选 ——
function allTags() {
  const counts = {}
  for (const n of nodes.value) {
    for (const t of n.tags || []) counts[t] = (counts[t] || 0) + 1
  }
  return Object.keys(counts).sort((a, b) => (counts[b] - counts[a]) || a.localeCompare(b))
}

function matchesFilter(n) {
  if (!filterTags.value.length) return true
  return (n.tags || []).some((t) => filterTags.value.includes(t))
}

function toggleTag(tag) {
  const index = filterTags.value.indexOf(tag)
  if (index >= 0) filterTags.value.splice(index, 1)
  else filterTags.value.push(tag)
}

// —— 悬停高亮 + 标签筛选 ——
function nodeClass(n) {
  if (activeId.value) {
    if (n.id === activeId.value) return 'is-active'
    const linked = edges.value.some((e) => {
      const a = nodes.value[e.i]
      const b = nodes.value[e.j]
      return (a.id === activeId.value && b.id === n.id) || (b.id === activeId.value && a.id === n.id)
    })
    return linked ? 'is-neighbor' : 'is-dim'
  }
  if (filterTags.value.length) return matchesFilter(n) ? 'is-filter-match' : 'is-dim'
  return ''
}

function edgeClass(e) {
  if (activeId.value) {
    const a = nodes.value[e.i]
    const b = nodes.value[e.j]
    const linked = a.id === activeId.value || b.id === activeId.value
    return linked ? 'is-active' : 'is-dim'
  }
  if (filterTags.value.length) {
    const a = nodes.value[e.i]
    const b = nodes.value[e.j]
    return matchesFilter(a) && matchesFilter(b) ? 'is-filter-match' : 'is-dim'
  }
  return ''
}

// 关联强度：按当前图谱最大共同标签数归一化到 0~1
function edgeStrength(e) {
  if (!maxShared.value) return 0
  return Math.min(1, e.shared.length / maxShared.value)
}

function edgeStyle(e) {
  const s = edgeStrength(e)
  return {
    '--edge-width': `${1.5 + s * 5}px`,
    '--edge-opacity': `${0.35 + s * 0.6}`,
  }
}

function edgeTitle(e) {
  return `共享标签 (${e.shared.length})：${e.shared.join('、')}`
}

// 悬停时在关联边上显示共享标签
function sharedLabel(e) {
  const tags = e.shared || []
  if (!tags.length) return ''
  const shown = tags.slice(0, 2).map((t) => '#' + t).join(' ')
  return tags.length > 2 ? shown + ' +' + (tags.length - 2) : shown
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listPosts({ category: 'wiki', page: 1, pageSize: 100 })
    items.value = data.items || []
    buildGraph()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div class="wiki-graph">
    <p v-if="error" class="graph-error">{{ error }}</p>
    <p v-else-if="loading" class="graph-hint">加载条目中…</p>
    <p v-else-if="!nodes.length" class="graph-hint">还没有 Wiki 条目</p>

    <template v-else>
      <div class="graph-head">
        <span class="graph-tip">
          <span class="dot"></span>
          共享标签的条目会连在一起；线越粗/越亮 = 关联越强；悬停卡片可查看共享标签
        </span>
        <span class="graph-count">{{ nodes.length }} 个条目 · {{ edges.length }} 条关联</span>
      </div>

      <div v-if="allTags().length" class="filter-bar">
        <span class="filter-label">标签筛选</span>
        <button
          v-for="tag in allTags()"
          :key="tag"
          type="button"
          :class="{ on: filterTags.includes(tag) }"
          @click="toggleTag(tag)"
        >
          #{{ tag }}
        </button>
        <button
          v-if="filterTags.length"
          type="button"
          class="filter-clear"
          @click="filterTags = []"
        >
          清除
        </button>
      </div>

      <div class="graph-canvas">
        <svg :viewBox="`0 0 ${viewW} ${viewH}`" role="img" aria-label="Wiki 条目标签关联拓扑图">
          <!-- 边：共享标签越多，线越粗、越亮；悬停卡片时显示共享标签 -->
          <g v-for="(e, idx) in edges" :key="'e' + idx">
            <line
              :x1="nodes[e.i]?.x"
              :y1="nodes[e.i]?.y"
              :x2="nodes[e.j]?.x"
              :y2="nodes[e.j]?.y"
              :class="['graph-edge', edgeClass(e)]"
              :style="edgeStyle(e)"
              :title="edgeTitle(e)"
            />
            <g
              v-if="edgeClass(e) === 'is-active'"
              class="edge-tag"
              :transform="`translate(${(nodes[e.i]?.x + nodes[e.j]?.x) / 2}, ${(nodes[e.i]?.y + nodes[e.j]?.y) / 2})`"
            >
              <rect :width="sharedLabel(e).length * 6.5 + 18" height="20" rx="10" :x="-(sharedLabel(e).length * 6.5 + 18) / 2" :y="-10" />
              <text y="4" text-anchor="middle">{{ sharedLabel(e) }}</text>
            </g>
          </g>

          <!-- 节点 -->
          <g
            v-for="n in nodes"
            :key="n.id"
            :class="['graph-node', nodeClass(n)]"
            :transform="`translate(${n.x}, ${n.y})`"
            role="link"
            tabindex="0"
            :aria-label="`打开 Wiki 条目：${n.title}`"
            @click="openNode(n.slug)"
            @keydown.enter="openNode(n.slug)"
            @keydown.space.prevent="openNode(n.slug)"
            @mouseenter="activeId = n.id"
            @mouseleave="activeId = null"
            @focusin="activeId = n.id"
            @focusout="activeId = null"
          >
            <title>{{ n.title }}{{ n.tags.length ? ' · ' + n.tags.join('、') : '' }}</title>
            <rect
              class="node-bg"
              :width="nodeWidth(n)"
              height="46"
              rx="12"
              :y="-23"
            />
            <text class="node-label" :x="nodeWidth(n) / 2" y="-3" text-anchor="middle">
              {{ fmtTitle(n) }}
            </text>
            <text
              v-if="n.tags.length"
              class="node-tags"
              :x="nodeWidth(n) / 2"
              y="13"
              text-anchor="middle"
            >
              {{ fmtTags(n) }}
            </text>
            <text v-else class="node-no-tags" :x="nodeWidth(n) / 2" y="13" text-anchor="middle">
              无标签
            </text>
          </g>
        </svg>
      </div>
    </template>
  </div>
</template>

<style scoped>
.wiki-graph {
  min-height: 260px;
}

.graph-error {
  color: #ff9d9d;
  font-size: 14px;
  padding: 24px 0;
}

.graph-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 48px 0;
}

.graph-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--muted);
}

.graph-tip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.graph-tip .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 70%, transparent);
}

.graph-count {
  color: var(--text-faint, var(--muted));
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel) 72%, transparent);
}

.filter-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  margin-right: 2px;
}

.filter-bar button {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo);
}

.filter-bar button:hover {
  color: var(--text);
  border-color: var(--accent);
}

.filter-bar button.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.filter-bar .filter-clear {
  border-style: dashed;
}

.graph-canvas {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--panel);
  overflow: hidden;
}

.graph-canvas svg {
  display: block;
  width: 100%;
  height: auto;
  min-height: 560px;
}

.graph-edge {
  stroke: color-mix(in srgb, var(--accent) 35%, var(--border));
  stroke-width: var(--edge-width, 2px);
  stroke-linecap: round;
  opacity: var(--edge-opacity, 0.6);
  pointer-events: none;
  transition:
    opacity var(--dur-ios-1) var(--ease-ios-expo),
    stroke var(--dur-ios-1) var(--ease-ios-expo),
    stroke-width var(--dur-ios-1) var(--ease-ios-expo);
}

.graph-edge.is-active,
.graph-edge.is-filter-match {
  stroke: var(--accent);
  opacity: 1;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--accent) 60%, transparent));
}

.graph-edge.is-dim {
  opacity: 0.12;
}

.edge-tag {
  pointer-events: none;
}

.edge-tag rect {
  fill: var(--panel);
  stroke: var(--accent);
  stroke-width: 1;
  filter: drop-shadow(0 1px 4px rgb(0 0 0 / 0.18));
}

.edge-tag text {
  fill: var(--accent);
  font-size: 10px;
  font-weight: 700;
}

.graph-node {
  cursor: pointer;
  outline: none;
  transition: opacity var(--dur-ios-1) var(--ease-ios-expo);
}

.graph-node.is-dim {
  opacity: 0.22;
}

.graph-node rect.node-bg {
  fill: var(--panel-2);
  stroke: var(--border);
  stroke-width: 1.2;
  transition:
    fill var(--dur-ios-1) var(--ease-ios-expo),
    stroke var(--dur-ios-1) var(--ease-ios-expo),
    filter var(--dur-ios-1) var(--ease-ios-expo);
}

.graph-node.is-active rect.node-bg,
.graph-node.is-neighbor rect.node-bg,
.graph-node.is-filter-match rect.node-bg,
.graph-node:hover rect.node-bg,
.graph-node:focus-visible rect.node-bg {
  fill: color-mix(in srgb, var(--accent) 12%, var(--panel-2));
  stroke: var(--accent);
  filter: drop-shadow(0 0 7px color-mix(in srgb, var(--accent) 50%, transparent));
}

.graph-node .node-label {
  fill: var(--text);
  font-size: 13px;
  font-weight: 600;
  pointer-events: none;
}

.graph-node .node-tags {
  fill: var(--accent);
  font-size: 10px;
  pointer-events: none;
}

.graph-node .node-no-tags {
  fill: var(--muted);
  font-size: 10px;
  opacity: 0.7;
  pointer-events: none;
}
</style>
