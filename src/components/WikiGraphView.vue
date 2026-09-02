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

const VIEW_W = 1400
const VIEW_H = 900
const MARGIN = 100
const NODE_H = 46
const CARD_GAP = 30
let raf = null
let iter = 0
const MAX_ITER = 520

function nodeWidth(n) {
  return Math.max(96, Math.min(210, String(n.title || '').length * 7.2 + 24))
}

function nodeHeight() {
  return NODE_H
}

// 标题按卡片宽度截断，避免文字超出卡片
function fmtTitle(n) {
  const t = String(n.title || '')
  const maxChars = Math.max(6, Math.floor((nodeWidth(n) - 18) / 7.2))
  return t.length > maxChars ? t.slice(0, Math.max(1, maxChars - 1)) + '…' : t
}

// 标签也按卡片宽度截断，避免第二行文字溢出
function fmtTags(n) {
  const tags = n.tags || []
  if (!tags.length) return ''
  const maxChars = Math.max(4, Math.floor((nodeWidth(n) - 24) / 5.4))
  let list = tags.slice(0, 3)
  let text = list.map((t) => '#' + t).join(' ')
  while (text.length > maxChars && list.length > 1) {
    list = list.slice(0, -1)
    text = list.map((t) => '#' + t).join(' ')
  }
  if (text.length > maxChars) {
    text = text.slice(0, Math.max(1, maxChars - 1)) + '…'
  }
  return text
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

  const cx = VIEW_W / 2
  const cy = VIEW_H / 2
  const radius = Math.max(140, Math.min(VIEW_W, VIEW_H) / 2 - 160)
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
  n.x = Math.max(MARGIN, Math.min(VIEW_W - MARGIN, n.x))
  n.y = Math.max(MARGIN, Math.min(VIEW_H - MARGIN, n.y))
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
  const cx = VIEW_W / 2
  const cy = VIEW_H / 2
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
      // 结束后再多次碰撞分离，尽量收敛到无重叠状态
      for (let i = 0; i < 120; i++) separateOverlaps()
      running.value = false
      raf = null
    }
  }
  raf = requestAnimationFrame(step)
}

// —— 悬停高亮 ——
function nodeClass(n) {
  if (!activeId.value) return ''
  if (n.id === activeId.value) return 'is-active'
  const linked = edges.value.some((e) => {
    const a = nodes.value[e.i]
    const b = nodes.value[e.j]
    return (a.id === activeId.value && b.id === n.id) || (b.id === activeId.value && a.id === n.id)
  })
  return linked ? 'is-neighbor' : 'is-dim'
}

function edgeClass(e) {
  if (!activeId.value) return ''
  const a = nodes.value[e.i]
  const b = nodes.value[e.j]
  const linked = a.id === activeId.value || b.id === activeId.value
  return linked ? 'is-active' : 'is-dim'
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
          共享标签的条目会连在一起；悬停卡片高亮关联；点击节点打开条目
        </span>
        <span class="graph-count">{{ nodes.length }} 个条目 · {{ edges.length }} 条关联</span>
      </div>

      <div class="graph-canvas">
        <svg :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" role="img" aria-label="Wiki 条目标签关联拓扑图">
          <!-- 边：共享标签越多的边越粗 -->
          <g v-for="(e, idx) in edges" :key="'e' + idx">
            <line
              :x1="nodes[e.i]?.x"
              :y1="nodes[e.i]?.y"
              :x2="nodes[e.j]?.x"
              :y2="nodes[e.j]?.y"
              :class="['graph-edge', edgeClass(e)]"
              :stroke-width="Math.min(4, 1 + e.shared.length * 0.8)"
              :title="e.shared.join('、')"
            />
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
  stroke-linecap: round;
  pointer-events: none;
  transition:
    opacity var(--dur-ios-1) var(--ease-ios-expo),
    stroke var(--dur-ios-1) var(--ease-ios-expo),
    stroke-width var(--dur-ios-1) var(--ease-ios-expo);
}

.graph-edge.is-active {
  stroke: var(--accent);
  opacity: 1;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--accent) 60%, transparent));
}

.graph-edge.is-dim {
  opacity: 0.12;
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
