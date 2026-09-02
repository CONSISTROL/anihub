<script setup>
// Wiki 拓扑视图：把条目作为节点，共享至少一个标签的两个条目之间画一条关联边。
// 使用轻量 force-directed 布局，点击节点跳转到对应 Wiki 条目。
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

const VIEW_W = 1200
const VIEW_H = 800
const MARGIN = 80
let raf = null
let iter = 0
const MAX_ITER = 420

function fmtTitle(title) {
  const t = String(title || '')
  return t.length > 24 ? t.slice(0, 23) + '…' : t
}

function openNode(slug) {
  router.push(`/wiki/${slug}`)
}

function buildGraph() {
  const list = items.value
  if (!list.length) return

  const ns = list.map((p, i) => ({
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
  const radius = Math.max(120, Math.min(VIEW_W, VIEW_H) / 2 - 120)
  ns.forEach((node, index) => {
    const angle = ns.length === 1 ? 0 : (index / ns.length) * Math.PI * 2
    node.x = cx + radius * Math.cos(angle) + (Math.random() * 60 - 30)
    node.y = cy + radius * Math.sin(angle) + (Math.random() * 60 - 30)
  })

  nodes.value = ns
  edges.value = es
  startSimulation()
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
      const force = 9000 / (d * d)
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
    const target = Math.max(150, Math.min(240, 220 - e.shared.length * 20))
    const f = (d - target) * 0.012
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
    n.vx += (cx - n.x) * 0.0012
    n.vy += (cy - n.y) * 0.0012

    // 速度衰减
    n.vx *= 0.86
    n.vy *= 0.86

    n.x += n.vx
    n.y += n.vy
    n.x = Math.max(MARGIN, Math.min(VIEW_W - MARGIN, n.x))
    n.y = Math.max(MARGIN, Math.min(VIEW_H - MARGIN, n.y))
  }
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
      running.value = false
      raf = null
    }
  }
  raf = requestAnimationFrame(step)
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
          共享标签的条目会连在一起；点击节点打开条目
        </span>
        <span class="graph-count">{{ nodes.length }} 个条目 · {{ edges.length }} 条关联</span>
      </div>

      <div class="graph-canvas">
        <svg :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`" role="img" aria-label="Wiki 条目标签关联拓扑图">
          <defs>
            <marker id="wiki-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" class="arrow-head" />
            </marker>
          </defs>

          <!-- 边：共享标签越多的边越粗 -->
          <g v-for="(e, idx) in edges" :key="'e' + idx">
            <line
              :x1="nodes[e.i]?.x"
              :y1="nodes[e.i]?.y"
              :x2="nodes[e.j]?.x"
              :y2="nodes[e.j]?.y"
              class="graph-edge"
              :stroke-width="Math.min(4, 1 + e.shared.length * 0.8)"
              :title="e.shared.join('、')"
            />
          </g>

          <!-- 节点 -->
          <g
            v-for="n in nodes"
            :key="n.id"
            class="graph-node"
            :transform="`translate(${n.x}, ${n.y})`"
            role="link"
            tabindex="0"
            :aria-label="`打开 Wiki 条目：${n.title}`"
            @click="openNode(n.slug)"
            @keydown.enter="openNode(n.slug)"
            @keydown.space.prevent="openNode(n.slug)"
          >
            <title>{{ n.title }}{{ n.tags.length ? ' · ' + n.tags.join('、') : '' }}</title>
            <rect
              class="node-bg"
              :width="Math.max(96, Math.min(210, n.title.length * 7.2 + 24))"
              height="46"
              rx="12"
              :y="-23"
            />
            <text class="node-label" :x="Math.max(96, Math.min(210, n.title.length * 7.2 + 24)) / 2" y="-3" text-anchor="middle">
              {{ fmtTitle(n.title) }}
            </text>
            <text
              v-if="n.tags.length"
              class="node-tags"
              :x="Math.max(96, Math.min(210, n.title.length * 7.2 + 24)) / 2"
              y="13"
              text-anchor="middle"
            >
              #{{ n.tags.slice(0, 3).join(' #') }}{{ n.tags.length > 3 ? ' …' : '' }}
            </text>
            <text v-else class="node-no-tags" :x="Math.max(96, Math.min(210, n.title.length * 7.2 + 24)) / 2" y="13" text-anchor="middle">
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
  min-height: 520px;
}

.graph-edge {
  stroke: color-mix(in srgb, var(--accent) 35%, var(--border));
  stroke-linecap: round;
  pointer-events: none;
}

.graph-node {
  cursor: pointer;
  outline: none;
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

.graph-node:hover rect.node-bg,
.graph-node:focus-visible rect.node-bg {
  fill: color-mix(in srgb, var(--accent) 12%, var(--panel-2));
  stroke: var(--accent);
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 45%, transparent));
}

.graph-node .node-label {
  fill: var(--text);
  font-size: 13px;
  font-weight: 600;
}

.graph-node .node-tags {
  fill: var(--accent);
  font-size: 10px;
}

.graph-node .node-no-tags {
  fill: var(--muted);
  font-size: 10px;
  opacity: 0.7;
}
</style>
