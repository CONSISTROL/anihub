<script setup>
// Wiki 拓扑视图（旋臂盘状星系 · three.js）
// - 条目按标签主题分到几条旋臂上，沿螺线铺开，星系整体缓慢绕中心公转；
// - 共享标签的条目之间有极淡的关联线（悬停时提亮相连线、点亮邻接点）；
// - 悬停看详情浮层，点击打开对应 Wiki；标签筛选变淡无关内容；可暂停公转。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { listPosts } from '../api/posts'

const router = useRouter()

const loading = ref(true)
const error = ref('')
const countInfo = reactive({ nodes: 0, edges: 0 })
const filterTags = ref([])
const spinning = ref(true)
const hoverId = ref(null)
const hoverPos = reactive({ x: 0, y: 0 })
const hostEl = ref(null)
const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ================= 数据 =================
const nodes = [] // { id, slug, title, tags, degree, arm, r, th }
const edges = [] // { a, b, shared }
const NODE_IDX = new Map()
let maxShared = 1

// ================= three.js =================
let renderer = null
let scene = null
let camera = null
let controls = null
let clock = null
let raf = 0
let ro = null
let galaxy = null
let isoGroup = null
let markers = [] // 与 nodes 对齐 { mesh, mat, nd, color, label, labelMat }
let edgeLines = [] // 与 edges 对齐 { line, mat }
let lastW = 800
let lastH = 600
let armAngle = 0

const R_MAX = 240
const R_IN = 40
const ARM_SWEEP = 4.4
let armCount = 3
const PALETTE = ['#8fb7ff', '#7fe0d0', '#ffb86b', '#e29cff', '#ff8fa3', '#9fe36b']

// ================= 构图 =================
function buildGraph(list) {
  nodes.length = 0
  edges.length = 0
  NODE_IDX.clear()
  list.forEach((p, i) => {
    nodes.push({
      idx: i,
      id: p.id,
      slug: p.slug,
      title: p.title,
      tags: Array.isArray(p.tags) ? p.tags : [],
      degree: 0,
      arm: 0,
      r: 0,
      th: 0,
    })
    NODE_IDX.set(p.id, i)
  })
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const shared = nodes[i].tags.filter((t) => nodes[j].tags.includes(t))
      if (shared.length) edges.push({ a: i, b: j, shared })
    }
  }
  maxShared = edges.length ? Math.max(...edges.map((e) => e.shared.length)) : 1
  nodes.forEach((n, i) => {
    n.degree = edges.reduce((acc, e) => acc + (e.a === i || e.b === i ? 1 : 0), 0)
  })
  countInfo.nodes = nodes.length
  countInfo.edges = edges.length
}

// 有关联的条目分到旋臂；完全无关联的放到星系外围 3D 稀疏区（不属于星系，不随盘转）
function assignArms() {
  const connected = nodes.filter((n) => n.degree > 0)
  const iso = nodes.filter((n) => n.degree === 0)
  const n = connected.length
  armCount = n ? Math.min(5, Math.max(1, Math.round(n / 9))) : 1
  if (n >= 1 && n < 4) armCount = 1
  const freq = new Map()
  for (const nd of connected) for (const t of nd.tags || []) freq.set(t, (freq.get(t) || 0) + 1)
  const themes = [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a)).slice(0, armCount)
  const fill = new Array(armCount).fill(0)
  const least = () => {
    let k = 0
    for (let i = 1; i < armCount; i++) if (fill[i] < fill[k]) k = i
    return k
  }
  for (const nd of connected) {
    let pick = -1
    let best = Infinity
    for (let a = 0; a < themes.length; a++) {
      if ((nd.tags || []).includes(themes[a]) && fill[a] < best) {
        pick = a
        best = fill[a]
      }
    }
    nd.arm = pick >= 0 ? pick : least()
    fill[nd.arm]++
  }
  const byArm = new Map()
  for (let a = 0; a < armCount; a++) byArm.set(a, [])
  for (const nd of connected) byArm.get(nd.arm).push(nd)
  for (let a = 0; a < armCount; a++) {
    const arr = byArm.get(a).sort((x, y) => y.degree - x.degree || x.idx - y.idx)
    const c = arr.length
    arr.forEach((nd, j) => {
      const t = c <= 1 ? 0.5 : j / (c - 1)
      nd.r = R_IN + (R_MAX - R_IN) * Math.pow(t, 0.9)
      nd.th = (a / armCount) * Math.PI * 2 + t * ARM_SWEEP + (Math.random() - 0.5) * 0.16
      // 3D 厚度：核心区鼓起来、外盘变薄 → 立体星系
      const sigma = 3 + 26 * Math.exp(-nd.r / 95)
      nd.y = (Math.random() * 2 - 1) * sigma
    })
  }
  // 无关联条目：星系外围稀疏静置
  iso.forEach((nd, i) => {
    nd.iso = true
    nd.r = R_MAX + 100 + (i % 3) * 45 + (Math.random() * 30 - 15)
    nd.th = (i / Math.max(1, iso.length)) * Math.PI * 2 + Math.random() * 0.6
    nd.y = (Math.random() * 2 - 1) * 130
  })
}

function nodeLocalPos(nd) {
  return new THREE.Vector3(Math.cos(nd.th) * nd.r, nd.y || 0, Math.sin(nd.th) * nd.r)
}

// ================= 场景 =================
function initScene() {
  if (renderer || !hostEl.value) return
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(50, 1, 1, 6000)
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch (e) {
    error.value = '当前环境不支持 WebGL，无法显示星系拓扑'
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  hostEl.value.appendChild(renderer.domElement)
  clock = new THREE.Clock()
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 0, 0)
  camera.position.set(170, 290, 420)
  controls.minDistance = 110
  controls.maxDistance = 2200
  controls.update()

  makeBackgroundStars()
  galaxy = new THREE.Group()
  scene.add(galaxy)
  isoGroup = new THREE.Group()
  scene.add(isoGroup)
  makeCenter()
  makeDust()
  makeMarkers()
  makeEdges()

  ro = new ResizeObserver(resize)
  ro.observe(hostEl.value)
  resize()

  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', onPointerLeave)
  tick()
}

function makeBackgroundStars() {
  const count = 700
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(700 + Math.random() * 1000)
    pos[i * 3] = v.x
    pos[i * 3 + 1] = v.y
    pos[i * 3 + 2] = v.z
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const m = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false })
  const p = new THREE.Points(g, m)
  scene.add(p)
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const x = c.getContext('2d')
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

function makeCenter() {
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })
  )
  spr.scale.set(150, 150, 1)
  galaxy.add(spr)
  const core = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }))
  galaxy.add(core)
}

function makeDust() {
  const total = 3400
  const armPts = Math.floor(total * 0.85)
  const pos = new Float32Array(total * 3)
  let k = 0
  for (let i = 0; i < armPts; i++) {
    const a = Math.floor(Math.random() * armCount)
    const t = Math.pow(Math.random(), 0.9) // 与节点同一半径分布
    // 与节点使用同一曲线（含更弯的 sweep），只加少量弧向/径向散布 → 星尘带贴合旋臂
    const r = R_IN + (R_MAX + 18 - R_IN) * t + (Math.random() * 2 - 1) * 6
    const th = (a / armCount) * Math.PI * 2 + t * ARM_SWEEP + (Math.random() - 0.5) * 0.3
    const sigma = 3 + 24 * Math.exp(-r / 110)
    pos[k * 3] = Math.cos(th) * r
    pos[k * 3 + 1] = (Math.random() * 2 - 1) * sigma
    pos[k * 3 + 2] = Math.sin(th) * r
    k++
  }
  for (; k < total; k++) {
    const r = Math.pow(Math.random(), 0.5) * R_IN * 1.7
    const th = Math.random() * Math.PI * 2
    pos[k * 3] = Math.cos(th) * r
    pos[k * 3 + 1] = (Math.random() - 0.5) * 18
    pos[k * 3 + 2] = Math.sin(th) * r
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const m = new THREE.PointsMaterial({ color: 0xa9c3ff, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.35, depthWrite: false })
  const p = new THREE.Points(g, m)
  galaxy.add(p)
}

let _labelCtx = null
function labelWidth(text, font) {
  if (!_labelCtx) _labelCtx = document.createElement('canvas').getContext('2d')
  _labelCtx.font = font
  return _labelCtx.measureText(String(text || '')).width
}
// 完整标题换行（不截断省略）：按行宽折行
function wrapFull(text, font, maxPx) {
  const s = String(text || '')
  const chars = Array.from(s)
  const lines = []
  let cur = ''
  for (const ch of chars) {
    const t = cur + ch
    if (cur && labelWidth(t, font) > maxPx) {
      lines.push(cur)
      cur = ch
    } else {
      cur = t
    }
  }
  if (cur || !lines.length) lines.push(cur)
  return lines
}

function themeTextColor() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--text').trim()
    if (v) return new THREE.Color(v)
  } catch (_) {
    /* 忽略 */
  }
  return new THREE.Color('#e8eaf0')
}

function makeLabelSprite(text, tint) {
  const font = '600 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif'
  const maxPx = 560
  const lines = wrapFull(text, font, maxPx)
  const lineH = 36
  const padX = 10
  const padY = 6
  const maxW = Math.max(...lines.map((l) => labelWidth(l, font)))
  const c = document.createElement('canvas')
  c.width = Math.ceil(maxW) + padX * 2
  c.height = lines.length * lineH + padY * 2
  const x = c.getContext('2d')
  x.font = font
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.shadowColor = 'rgba(0,0,0,0.85)'
  x.shadowBlur = 6
  x.fillStyle = '#ffffff'
  lines.forEach((ln, i) => {
    x.fillText(ln, c.width / 2, padY + lineH * i + lineH / 2 + 1)
  })
  x.shadowBlur = 0
  const tex = new THREE.CanvasTexture(c)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: tint.clone(), opacity: 0.9 })
  const sp = new THREE.Sprite(mat)
  // 世界尺寸：每行约 10 单位高，行多则整体变高（宽度按同比例）
  const worldH = lines.length * 10 + (lines.length - 1) * 2.5 + 3
  sp.scale.set(worldH * (c.width / c.height), worldH, 1)
  return sp
}

function makeMarkers() {
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i]
    const isIso = !!nd.iso
    const color = new THREE.Color(isIso ? '#8a94a8' : PALETTE[nd.arm % PALETTE.length])
    const r = 1.8 + Math.min(2.2, nd.degree * 0.12) + (isIso ? 0.6 : 0)
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isIso ? 0.55 : 1 })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 14), mat)
    mesh.userData.idx = i
    const pos = nodeLocalPos(nd)
    mesh.position.copy(pos)
    ;(isIso ? isoGroup : galaxy).add(mesh)
    // 标题标签（完整标题，可多行，浮在节点上方；颜色跟随主题保证两种背景下可读）
    const label = makeLabelSprite(nodes[i].title, themeTextColor())
    label.userData.idx = i
    label.position.set(pos.x, pos.y + (r + 2 + label.scale.y / 2), pos.z)
    label.renderOrder = 2
    ;(isIso ? isoGroup : galaxy).add(label)
    markers.push({ mesh, mat, nd, color, label, labelMat: label.material })
  }
}

function makeEdges() {
  for (const e of edges) {
    const a = markers[e.a]
    const b = markers[e.b]
    const g = new THREE.BufferGeometry().setFromPoints([a.mesh.position.clone(), b.mesh.position.clone()])
    const mat = new THREE.LineBasicMaterial({ color: 0x8ab4ff, transparent: true, opacity: 0.05, depthWrite: false })
    const line = new THREE.Line(g, mat)
    galaxy.add(line)
    edgeLines.push({ line, mat, e })
  }
}

function resize() {
  if (!hostEl.value || !renderer) return
  const w = hostEl.value.clientWidth || 800
  const h = hostEl.value.clientHeight || 600
  lastW = w
  lastH = h
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

// ================= 帧循环 =================
function tick() {
  raf = requestAnimationFrame(tick)
  const dt = Math.min(clock.getDelta(), 0.05)
  if (spinning.value) {
    armAngle += dt * (reducedMotion ? 0.02 : 0.045)
    galaxy.rotation.y = armAngle
  }
  controls.update()
  scene.updateMatrixWorld()
  applyStates(dt)
  renderer.render(scene, camera)
}

function isNeighbor(i, h) {
  for (const e of edges) {
    if ((e.a === h && e.b === i) || (e.b === h && e.a === i)) return true
  }
  return false
}
function matchesFilter(nd) {
  if (!filterTags.value.length) return true
  return (nd.tags || []).some((t) => filterTags.value.includes(t))
}

const _tmpV = new THREE.Vector3()
const _tmpP = new THREE.Vector3()
function applyStates(dt) {
  const k = 1 - Math.exp(-dt * 10)
  const hover = hoverId.value == null ? -1 : NODE_IDX.get(hoverId.value)

  // 边
  for (let i = 0; i < edgeLines.length; i++) {
    const el = edgeLines[i]
    const s = Math.min(1, el.e.shared.length / maxShared)
    let target
    if (hover >= 0) {
      target = el.e.a === hover || el.e.b === hover ? 0.5 + s * 0.45 : 0.012
    } else if (filterTags.value.length) {
      target = matchesFilter(nodes[el.e.a]) && matchesFilter(nodes[el.e.b]) ? 0.12 + s * 0.2 : 0.008
    } else {
      target = 0.035 + s * 0.045
    }
    el.mat.opacity += (target - el.mat.opacity) * k
  }

  // 节点 + 标题候选
  const cand = []
  for (let i = 0; i < markers.length; i++) {
    const mk = markers[i]
    let target
    if (hover >= 0) {
      target = i === hover ? 1 : isNeighbor(i, hover) ? 0.95 : 0.12
    } else if (filterTags.value.length) {
      target = matchesFilter(nodes[i]) ? (mk.nd.iso ? 0.6 : 1) : 0.06
    } else {
      target = mk.nd.iso ? 0.5 : 0.85
    }
    mk.mat.opacity += (target - mk.mat.opacity) * k
    const want = i === hover ? 2.6 : 1
    const sc = mk.mesh.scale.x + (want - mk.mesh.scale.x) * k
    mk.mesh.scale.set(sc, sc, sc)
    mk._lab = Math.max(0, Math.min(0.95, target * 0.95))
    // 投影成屏幕矩形，用于防重叠
    if (!mk.label) continue
    mk.label.getWorldPosition(_tmpV)
    _tmpP.copy(_tmpV).project(camera)
    if (_tmpP.z <= 0 || _tmpP.z >= 1) continue
    const dist = _tmpV.distanceTo(camera.position)
    const perUnit = (lastH / 2) / (Math.max(0.01, dist) * Math.tan((camera.fov * Math.PI) / 360))
    cand.push({
      i,
      x: (_tmpP.x * 0.5 + 0.5) * lastW,
      y: (-_tmpP.y * 0.5 + 0.5) * lastH,
      w: mk.label.scale.x * perUnit,
      h: mk.label.scale.y * perUnit,
      pri: i === hover ? 1e6 : isNeighbor(i, hover) ? 1000 : mk.nd.degree,
      show: mk._lab >= 0.45,
    })
  }

  // 贪心防重叠：优先级高者占位，相交的低优先标题淡出（保证呈现的互不重叠）
  cand.sort((a, b) => b.pri - a.pri || Number(b.show) - Number(a.show) || b.i - a.i)
  const taken = []
  const shown = new Set()
  for (const cd of cand) {
    if (!cd.show) continue
    let ok = true
    for (const t of taken) {
      const m = 6
      if (Math.abs(cd.x - t.x) < (cd.w + t.w) / 2 + m && Math.abs(cd.y - t.y) < (cd.h + t.h) / 2 + m) {
        ok = false
        break
      }
    }
    if (ok) {
      taken.push(cd)
      shown.add(cd.i)
    }
  }
  for (let i = 0; i < markers.length; i++) {
    const mk = markers[i]
    if (!mk.labelMat) continue
    const wantL = shown.has(i) && mk._lab >= 0.45 ? mk._lab : 0
    mk.labelMat.opacity += (wantL - mk.labelMat.opacity) * k
    mk.label.visible = wantL > 0.02
  }
}

// ================= 交互 =================
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
let downPos = null
let downTime = 0
let dragged = false

function onPointerMove(e) {
  if (!renderer) return
  const rect = renderer.domElement.getBoundingClientRect()
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)
  // 节点球与标题精灵都可命中（标题同样可查看节点信息）
  const targets = []
  for (const m of markers) {
    targets.push(m.mesh)
    if (m.label) targets.push(m.label)
  }
  const hits = raycaster.intersectObjects(targets, false)
  const idx = hits.length && hits[0].object.userData.idx != null ? hits[0].object.userData.idx : null
  const next = idx == null ? null : nodes[idx].id
  if (next !== hoverId.value) hoverId.value = next
  hoverPos.x = e.clientX - rect.left
  hoverPos.y = e.clientY - rect.top
  renderer.domElement.style.cursor = idx != null ? 'pointer' : 'grab'
}
function onPointerDown(e) {
  downPos = { x: e.clientX, y: e.clientY }
  downTime = Date.now()
  dragged = false
}
function onPointerUp(e) {
  if (!downPos) return
  const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
  const quick = Date.now() - downTime < 400
  downPos = null
  if (dragged || dist > 8 || !quick) return
  const idx = hoverId.value != null ? NODE_IDX.get(hoverId.value) : null
  if (idx != null) router.push(`/wiki/${nodes[idx].slug}`)
}
function onPointerLeave() {
  hoverId.value = null
  dragged = false
  downPos = null
}

// ================= 工具 / 浮层 =================
function allTags() {
  const counts = new Map()
  for (const n of nodes) for (const t of n.tags || []) counts.set(t, (counts.get(t) || 0) + 1)
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b))
}
function toggleTag(tag) {
  const i = filterTags.value.indexOf(tag)
  if (i >= 0) filterTags.value.splice(i, 1)
  else filterTags.value.push(tag)
}

const hoverInfo = computed(() => {
  if (hoverId.value == null) return null
  const idx = NODE_IDX.get(hoverId.value)
  if (idx == null) return null
  const n = nodes[idx]
  const ns = []
  const byTags = new Map()
  for (const e of edges) {
    let other = -1
    if (e.a === idx) other = e.b
    else if (e.b === idx) other = e.a
    else continue
    ns.push({ title: nodes[other].title, shared: e.shared })
    for (const t of e.shared) byTags.set(t, (byTags.get(t) || 0) + 1)
  }
  const topTags = [...byTags.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map((x) => '#' + x[0])
  return {
    title: n.title,
    tags: n.tags || [],
    edgeCount: ns.length,
    topTags,
    neighbors: ns.slice(0, 6),
    more: Math.max(0, ns.length - 6),
  }
})

// ================= 加载 =================
async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listPosts({ category: 'wiki', page: 1, pageSize: 100 })
    buildGraph(data.items || [])
    if (nodes.length) assignArms()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    if (!error.value && nodes.length) {
      nextTick(() => initScene())
    }
  }
}

// ================= 清理 =================
onMounted(load)
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (ro) ro.disconnect()
  if (hostEl.value && renderer && renderer.domElement.parentNode === hostEl.value) {
    hostEl.value.removeChild(renderer.domElement)
  }
  const disposeObj = (o) => {
    if (!o) return
    o.traverse((x) => {
      if (x.geometry) x.geometry.dispose()
      if (x.material) {
        const arr = Array.isArray(x.material) ? x.material : [x.material]
        arr.forEach((m) => {
          if (m.map) m.map.dispose()
          m.dispose()
        })
      }
    })
  }
  disposeObj(scene)
  if (controls) controls.dispose()
  if (renderer) renderer.dispose()
  renderer = null
  scene = null
  camera = null
  markers = []
  edgeLines = []
})
</script>

<template>
  <div class="wiki-graph">
    <p v-if="error" class="graph-error">{{ error }}</p>
    <p v-else-if="!loading && !countInfo.nodes" class="graph-hint">还没有 Wiki 条目</p>

    <template v-else-if="!loading && countInfo.nodes">
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
        <button v-if="filterTags.length" type="button" class="filter-clear" @click="filterTags = []">
          清除
        </button>
      </div>

      <div ref="hostEl" class="graph-space" role="img" aria-label="Wiki 旋臂星系拓扑图">
        <div class="graph-hud">
          <span class="hud-stat">{{ countInfo.nodes }} 个条目 · {{ countInfo.edges }} 条关联</span>
          <div class="hud-actions">
            <button type="button" @click="spinning = !spinning">
              {{ spinning ? '暂停' : '继续' }}公转
            </button>
          </div>
        </div>

        <div
          v-if="hoverInfo"
          class="graph-tooltip"
          :style="{ left: hoverPos.x + 'px', top: hoverPos.y + 'px' }"
        >
          <div class="tt-title">{{ hoverInfo.title }}</div>
          <div v-if="hoverInfo.tags.length" class="tt-tags">
            {{ hoverInfo.tags.slice(0, 5).map((t) => '#' + t).join(' ') }}
            <span v-if="hoverInfo.tags.length > 5">+{{ hoverInfo.tags.length - 5 }}</span>
          </div>
          <div class="tt-links">
            关联 {{ hoverInfo.edgeCount }} 条
            <template v-if="hoverInfo.topTags.length"> · 共享最多 {{ hoverInfo.topTags.join(' ') }}</template>
          </div>
          <ul v-if="hoverInfo.neighbors.length" class="tt-neighbors">
            <li v-for="(nb, i) in hoverInfo.neighbors" :key="i">
              <span>{{ nb.title }}</span>
              <span class="tt-shared">#{{ nb.shared[0] }}{{ nb.shared.length > 1 ? ' +' + (nb.shared.length - 1) : '' }}</span>
            </li>
          </ul>
          <div v-if="hoverInfo.more > 0" class="tt-more">等 {{ hoverInfo.more }} 条…</div>
        </div>
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
  padding: 8px 14px;
  border: 0;
  /* 透明：背景统一交给外层 page 容器做淡入淡出 */
  background: transparent;
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

/* —— 星系画布 —— */
.graph-space {
  position: relative;
  height: min(94vh, 1000px);
  min-height: 760px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: transparent;
  touch-action: none;
}

.graph-space :deep(canvas) {
  display: block;
  cursor: grab;
}

.graph-hud {
  position: absolute;
  left: 14px;
  bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  pointer-events: none;
  z-index: 4;
}

.hud-stat {
  font-size: 12px;
  color: #c3cde0;
  background: rgba(16, 21, 36, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  padding: 5px 12px;
  backdrop-filter: blur(6px);
}

.hud-actions {
  display: inline-flex;
  gap: 6px;
  pointer-events: auto;
}

.hud-actions button {
  padding: 5px 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background: rgba(16, 21, 36, 0.8);
  color: #c3cde0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition:
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo);
}

.hud-actions button:hover {
  color: #fff;
  border-color: #7aa7ff;
}

/* —— 悬停信息卡 —— */
.graph-tooltip {
  position: absolute;
  z-index: 5;
  transform: translate(16px, -55%);
  max-width: 340px;
  min-width: 200px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  background: rgba(13, 18, 32, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
  color: #edf1f7;
  font-size: 12px;
  line-height: 1.5;
  pointer-events: none;
}

.tt-title {
  font-size: 14px;
  font-weight: 700;
}

.tt-tags {
  color: #8ab4ff;
  margin-top: 3px;
}

.tt-links {
  color: #9aa7c4;
  margin-top: 3px;
}

.tt-neighbors {
  list-style: none;
  margin: 6px 0 0;
  padding: 6px 0 0;
  border-top: 1px dashed rgba(255, 255, 255, 0.14);
}

.tt-neighbors li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 2px;
  color: #edf1f7;
}

.tt-neighbors li .tt-shared {
  color: #8ab4ff;
  font-size: 11px;
  margin-left: auto;
  white-space: nowrap;
}

.tt-more {
  color: #9aa7c4;
  margin-top: 4px;
}
</style>
