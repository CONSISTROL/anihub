<script setup>
// Wiki 拓扑视图（三维）：以「关联最多的条目」为核（太阳），其余条目像电子/行星一样沿各自的
// 3D 轨道绕行；共享 ≥1 个标签的条目之间画发光连线（拓扑信息保留），线越亮关联越强。
// 交互：拖拽旋转 / 滚轮缩放 / 悬停高亮（变暗无关节点与连线）/ 标签筛选 / 点击打开条目 / 可暂停绕行。
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { listPosts } from '../api/posts'

const router = useRouter()

const loading = ref(true)
const error = ref('')
const countInfo = reactive({ nodes: 0, edges: 0 })
const filterTags = ref([])
const paused = ref(false)
const hoverId = ref(null)
const hoverPos = reactive({ x: 0, y: 0 })
const hostEl = ref(null)
const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ================= 数据（非响应式，运行期常量） =================
const nodes = [] // { idx, id, slug, title, tags, degree }
const edgeList = [] // { a, b, shared }
const edgeIndexByNode = new Map() // nodeIdx -> edgeIdx[]
const NODE_IDX = new Map() // post.id -> nodeIdx
let hubIdx = -1 // 核节点下标；-1 = 没有可用的共享标签，只画装饰核心
let maxShared = 1
let viewScale = 1

// ================= 文本测量 =================
let measureCtx = null
function textWidth(text, size) {
  const s = String(text || '')
  if (!measureCtx) {
    measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  }
  if (!measureCtx) return s.length * size * 0.62
  measureCtx.font = `600 ${size}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif`
  return measureCtx.measureText(s).width
}
// 标题标签单行显示：不换行。宽度能放下就完整显示，超过宽度上限才在末尾加省略号。
function lineFit(text, size, maxPx) {
  const s = String(text || '')
  if (!s || textWidth(s, size) <= maxPx) return s
  const chars = Array.from(s)
  const ell = '…'
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (textWidth(chars.slice(0, mid).join('') + ell, size) <= maxPx) lo = mid
    else hi = mid - 1
  }
  return (lo ? chars.slice(0, lo).join('') : '') + ell
}

// ================= 主题色 =================
function cssColor(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v ? new THREE.Color(v) : new THREE.Color(fallback)
  } catch (_) {
    return new THREE.Color(fallback)
  }
}
function shade(col, t) {
  const c = col.clone()
  return t >= 0 ? c.lerp(new THREE.Color('#ffffff'), t) : c.lerp(new THREE.Color('#000000'), -t)
}

// ================= three.js 状态 =================
let renderer = null
let scene = null
let camera = null
let controls = null
let clock = null
let raf = 0
let resizeObs = null
let stars = null
let hubGroup = null
let hubMesh = null
let satellites = [] // { n, i, shell, R, phase, speed, q, pos, group, mesh, mat, label }
let satByIndex = new Map()
let edgeSegs = null
let edgePosAttr = null
let edgeColAttr = null
let edgeBaseCol = []
let shellGuides = []
const ORIGIN = new THREE.Vector3()
let accentColor = new THREE.Color('#5b8cff')
let textColor = new THREE.Color('#e8e8f0')

// ================= 构图 =================
function buildGraph(list) {
  nodes.length = 0
  edgeList.length = 0
  edgeIndexByNode.clear()
  NODE_IDX.clear()
  edgeBaseCol.length = 0

  list.forEach((p, i) => {
    nodes.push({ idx: i, id: p.id, slug: p.slug, title: p.title, tags: Array.isArray(p.tags) ? p.tags : [] })
    NODE_IDX.set(p.id, i)
    edgeIndexByNode.set(i, [])
  })

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const shared = nodes[i].tags.filter((t) => nodes[j].tags.includes(t))
      if (shared.length) {
        edgeList.push({ a: i, b: j, shared })
        edgeIndexByNode.get(i).push(edgeList.length - 1)
        edgeIndexByNode.get(j).push(edgeList.length - 1)
      }
    }
  }
  maxShared = edgeList.length ? Math.max(...edgeList.map((e) => e.shared.length)) : 1
  nodes.forEach((n, i) => {
    n.degree = (edgeIndexByNode.get(i) || []).length
  })

  hubIdx = -1
  if (nodes.length === 1) {
    hubIdx = 0
  } else {
    let best = 0
    nodes.forEach((n, i) => {
      if (n.degree > best) {
        best = n.degree
        hubIdx = i
      }
    })
    if (best === 0) hubIdx = -1 // 没有共享标签 → 装饰核心
  }
  countInfo.nodes = nodes.length
  countInfo.edges = edgeList.length
}

// BFS 距核层数 → 环
function shellOf(idx) {
  if (hubIdx < 0 || idx === hubIdx) return 0
  const dist = new Array(nodes.length).fill(-1)
  dist[hubIdx] = 0
  const q = [hubIdx]
  while (q.length) {
    const cur = q.shift()
    for (const ei of edgeIndexByNode.get(cur) || []) {
      const e = edgeList[ei]
      const nxt = e.a === cur ? e.b : e.a
      if (dist[nxt] === -1) {
        dist[nxt] = dist[cur] + 1
        q.push(nxt)
      }
    }
  }
  const d = dist[idx]
  if (d <= 1) return 0
  if (d === 2) return 1
  return 2
}

function shellRadius(shell) {
  const base = [175, 265, 360]
  return base[Math.min(shell, base.length - 1)] * viewScale
}

// ================= 场景搭建 =================
function initScene() {
  if (renderer || !hostEl.value) return
  accentColor = cssColor('--accent', '#5b8cff')
  textColor = cssColor('--text', '#e8e8f0')

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(50, 1, 1, 30000)
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch (e) {
    error.value = '当前环境不支持 WebGL，无法显示三维拓扑'
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  hostEl.value.appendChild(renderer.domElement)
  clock = new THREE.Clock()

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.rotateSpeed = 0.6
  controls.zoomSpeed = 0.9

  makeStars()
  resize()
  resizeObs = new ResizeObserver(resize)
  resizeObs.observe(hostEl.value)

  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', onPointerLeave)
  renderer.domElement.addEventListener('pointermove', onCanvasMoveCapture)

  tick()
}

function makeStars() {
  const n = 600
  const pos = new Float32Array(n * 3)
  const rad = 9000
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(rad * (0.7 + Math.random() * 0.6))
    pos[i * 3] = v.x
    pos[i * 3 + 1] = v.y
    pos[i * 3 + 2] = v.z
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  stars = new THREE.Points(
    g,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    })
  )
  scene.add(stars)
}

const LABEL_FONT_PX = 40 // 画布字号：越小，同一行能放的字符越多（同时显示得更小）
const LABEL_MAX_W = 760 // 画布宽度上限：一行能容纳约 19 个汉字 / 38 个西文字符
function makeLabelSprite(text, tint) {
  const s = lineFit(text, LABEL_FONT_PX, LABEL_MAX_W)
  const font = `600 ${LABEL_FONT_PX}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif`
  const lineH = 50
  const padX = 10
  const padTop = 3
  const padBottom = 7
  const c = document.createElement('canvas')
  c.width = Math.ceil(textWidth(s, LABEL_FONT_PX)) + padX * 2
  c.height = lineH + padTop + padBottom
  const ctx = c.getContext('2d')
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.8)'
  ctx.shadowBlur = 8
  ctx.fillStyle = '#ffffff'
  ctx.fillText(s, c.width / 2, padTop + lineH / 2 + 2)
  ctx.shadowBlur = 0
  const tex = new THREE.CanvasTexture(c)
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: tint.clone() })
  const sp = new THREE.Sprite(mat)
  // 单行标签世界高度：值越小默认视角下字越小（随缩放按景深放大）。
  const worldH = 18
  sp.scale.set(worldH * (c.width / c.height), worldH, 1)
  return sp
}

function radialTexture(alpha) {
  const size = 256
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, `rgba(255,255,255,${alpha})`)
  g.addColorStop(0.3, `rgba(255,255,255,${alpha * 0.45})`)
  g.addColorStop(0.65, `rgba(255,255,255,${alpha * 0.1})`)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(c)
}

function createVisuals() {
  if (!scene) return
  const satCols = [shade(accentColor, 0.52), shade(accentColor, 0.18), accentColor.clone()]

  // —— 核（太阳）——
  if (hubIdx >= 0) {
    const core = nodes[hubIdx]
    hubGroup = new THREE.Group()
    hubMesh = new THREE.Mesh(
      new THREE.SphereGeometry(24, 32, 24),
      new THREE.MeshBasicMaterial({ color: shade(accentColor, 0.55), transparent: true, opacity: 1 })
    )
    hubMesh.userData.idx = hubIdx
    hubGroup.add(hubMesh)

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture(0.9),
        color: shade(accentColor, 0.35),
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    glow.scale.set(220, 220, 1)
    hubGroup.add(glow)

    const lab = makeLabelSprite(core.title, shade(textColor, 0.12))
    lab.position.set(0, 24 + 8 + lab.scale.y / 2, 0)
    lab.renderOrder = 20
    hubGroup.add(lab)
    scene.add(hubGroup)
  } else {
    const deco = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture(0.5),
        color: new THREE.Color('#aab3c8'),
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    deco.scale.set(90, 90, 1)
    scene.add(deco)
  }

  // —— 轨道卫星（电子/行星）——
  satByIndex.clear()
  for (const s of satellites) {
    const col = satCols[Math.min(s.shell, satCols.length - 1)]
    const r = 4.6 + Math.min(4, s.n.degree) * 0.85 + Math.random() * 1.1
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 1 })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), mat)
    mesh.userData.idx = s.i
    const label = makeLabelSprite(s.n.title, shade(textColor, 0.08))
    label.position.set(0, r + 6 + label.scale.y / 2, 0)
    label.renderOrder = 10

    const g = new THREE.Group()
    g.add(mesh)
    g.add(label)
    scene.add(g)

    s.group = g
    s.mesh = mesh
    s.mat = mat
    s.label = label
    s.pos = new THREE.Vector3()
    satByIndex.set(s.i, s)
  }
}

function createEdges() {
  if (!scene) return
  if (edgeSegs) {
    scene.remove(edgeSegs)
    edgeSegs.geometry.dispose()
    edgeSegs.material.dispose()
    edgeSegs = null
  }
  const count = edgeList.length
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3))
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 6), 3))
  geo.setDrawRange(0, count * 2)
  edgeSegs = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })
  )
  edgeSegs.frustumCulled = false
  edgeSegs.renderOrder = 1
  scene.add(edgeSegs)
  edgePosAttr = geo.attributes.position
  edgeColAttr = geo.attributes.color

  edgeBaseCol.length = 0
  const faint = shade(textColor, -0.35)
  for (const e of edgeList) {
    const s = Math.min(1, e.shared.length / maxShared)
    const c = accentColor.clone().multiplyScalar(0.22 + 0.78 * s)
    c.lerp(faint, (1 - s) * 0.5)
    edgeBaseCol.push(c)
  }
  refreshEdgeColors()
}

function makeShellGuides() {
  shellGuides.forEach(removeObject)
  shellGuides = []
  if (!scene || !satellites.length) return
  let maxShell = 0
  for (const s of satellites) maxShell = Math.max(maxShell, s.shell)
  for (let shell = 0; shell <= Math.min(maxShell, 2); shell++) {
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(shellRadius(shell), 1)),
      new THREE.LineBasicMaterial({
        color: shade(accentColor, 0.35),
        transparent: true,
        opacity: shell === 0 ? 0.1 : 0.06,
        depthWrite: false,
      })
    )
    scene.add(wire)
    shellGuides.push(wire)
  }
}

function setupLayout() {
  if (!scene) return
  viewScale = 1 + Math.max(0, (nodes.length - 30) / 130)
  satellites.forEach((s) => s.group && removeObject(s.group))
  satellites = []
  satByIndex.clear()
  if (hubGroup) removeObject(hubGroup)
  hubGroup = null
  hubMesh = null

  nodes.forEach((n, i) => {
    if (i === hubIdx) return
    const shell = Math.min(shellOf(i), 2)
    const R = shellRadius(shell) * (1 + (Math.random() * 2 - 1) * 0.08)
    const eul = new THREE.Euler(
      (Math.random() * 1.1 - 0.55) * (shell === 0 ? 0.6 : 1),
      Math.random() * Math.PI * 2,
      (Math.random() * 1.1 - 0.55) * (shell === 0 ? 0.6 : 1)
    )
    const q = new THREE.Quaternion().setFromEuler(eul)
    const speed = (0.2 + Math.random() * 0.14) * Math.sqrt(175 / R) * (reducedMotion ? 0.25 : 1)
    satellites.push({ n, i, shell, R, phase: Math.random() * Math.PI * 2, speed, q })
  })

  createVisuals()
  createEdges()
  makeShellGuides()
  fitCamera()
}

function updateSatPositions() {
  for (const s of satellites) {
    const x = Math.cos(s.phase) * s.R
    const z = Math.sin(s.phase) * s.R
    s.pos.set(x, 0, z).applyQuaternion(s.q)
    s.group.position.copy(s.pos)
  }
}

function contentRadius() {
  let rMax = 0
  for (const s of satellites) rMax = Math.max(rMax, s.R + 70)
  if (hubMesh || hubIdx >= 0) rMax = Math.max(rMax, 190)
  if (!satellites.length && hubIdx < 0) rMax = 120
  return rMax || 220
}

function fitCamera() {
  if (!camera || !hostEl.value || !controls) return
  const w = hostEl.value.clientWidth || 800
  const h = hostEl.value.clientHeight || 560
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  const vfov = (camera.fov * Math.PI) / 180
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect)
  const distH = w / 2 / Math.tan(hfov / 2)
  const rMax = contentRadius()
  const dist = Math.max(rMax * 1.9, distH, 420)
  camera.position.set(0, dist * 0.58, dist * 0.85)
  controls.target.set(0, 0, 0)
  controls.minDistance = Math.max(90, rMax * 0.3)
  controls.maxDistance = Math.max(rMax * 6, 3000)
  controls.update()
}

function resize() {
  if (!hostEl.value || !renderer || !camera) return
  const w = hostEl.value.clientWidth
  const h = hostEl.value.clientHeight
  if (!w || !h) return
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

// ================= 渲染循环 =================
function endpointPos(i) {
  if (i === hubIdx) return ORIGIN
  const s = satByIndex.get(i)
  return s ? s.pos : ORIGIN
}

function tick() {
  raf = requestAnimationFrame(tick)
  const dt = Math.min(clock.getDelta(), 0.05)

  if (!paused.value) {
    for (const s of satellites) {
      s.phase += s.speed * dt
      const x = Math.cos(s.phase) * s.R
      const z = Math.sin(s.phase) * s.R
      s.pos.set(x, 0, z).applyQuaternion(s.q)
      s.group.position.copy(s.pos)
    }
    if (edgeSegs) {
      const arr = edgePosAttr.array
      for (let i = 0; i < edgeList.length; i++) {
        const e = edgeList[i]
        const pa = endpointPos(e.a)
        const pb = endpointPos(e.b)
        arr[i * 6] = pa.x
        arr[i * 6 + 1] = pa.y
        arr[i * 6 + 2] = pa.z
        arr[i * 6 + 3] = pb.x
        arr[i * 6 + 4] = pb.y
        arr[i * 6 + 5] = pb.z
      }
      edgePosAttr.needsUpdate = true
    }
  }

  animateAppearance(dt)
  if (controls) controls.update()
  if (renderer) renderer.render(scene, camera)
}

function isNeighbor(i, hover) {
  const list = edgeIndexByNode.get(hover)
  if (!list) return false
  for (const ei of list) {
    const e = edgeList[ei]
    if (e.a === i || e.b === i) return true
  }
  return false
}

function matchesFilter(n) {
  if (!filterTags.value.length) return true
  return (n.tags || []).some((t) => filterTags.value.includes(t))
}

function animateAppearance(dt) {
  const k = 1 - Math.exp(-dt * 7)
  const hover = hoverId.value == null ? -1 : NODE_IDX.get(hoverId.value)

  const targetFor = (i) => {
    if (hover >= 0) {
      if (i === hover) return 1
      return isNeighbor(i, hover) ? 0.9 : 0.1
    }
    if (filterTags.value.length) return matchesFilter(nodes[i]) ? 1 : 0.08
    return 1
  }

  for (const s of satellites) {
    const target = targetFor(s.i)
    s.mat.opacity += (target - s.mat.opacity) * k
    s.label.material.opacity += (target * 0.95 - s.label.material.opacity) * k
    const wantS = s.i === hover ? 1.45 : 1
    const sc = s.mesh.scale.x + (wantS - s.mesh.scale.x) * k
    s.mesh.scale.set(sc, sc, sc)
  }
  if (hubMesh && hubGroup) {
    const target = targetFor(hubIdx)
    hubMesh.material.opacity += (target - hubMesh.material.opacity) * k
    const wantS = hover === hubIdx ? 1.1 : 1
    const sc = hubMesh.scale.x + (wantS - hubMesh.scale.x) * k
    hubMesh.scale.set(sc, sc, sc)
  }
}

function refreshEdgeColors() {
  if (!edgeSegs) return
  const hover = hoverId.value == null ? -1 : NODE_IDX.get(hoverId.value)
  const arr = edgeColAttr.array
  const bright = accentColor.clone().lerp(new THREE.Color('#ffffff'), 0.45)
  const faintC = shade(textColor, -0.55)
  for (let i = 0; i < edgeList.length; i++) {
    const e = edgeList[i]
    let c
    if (hover >= 0) {
      c = e.a === hover || e.b === hover ? bright : faintC
    } else if (filterTags.value.length) {
      c = matchesFilter(nodes[e.a]) && matchesFilter(nodes[e.b]) ? edgeBaseCol[i].clone().lerp(bright, 0.3) : faintC.clone()
    } else {
      c = edgeBaseCol[i]
    }
    arr[i * 6] = c.r
    arr[i * 6 + 1] = c.g
    arr[i * 6 + 2] = c.b
    arr[i * 6 + 3] = c.r
    arr[i * 6 + 4] = c.g
    arr[i * 6 + 5] = c.b
  }
  edgeColAttr.needsUpdate = true
}

// ================= 交互 =================
const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
let downPos = null
let downTime = 0
let dragged = false

function pickables() {
  const arr = satellites.map((s) => s.mesh)
  if (hubMesh) arr.push(hubMesh)
  return arr
}

function onPointerMove(e) {
  if (!hostEl.value || !camera) return
  const rect = hostEl.value.getBoundingClientRect()
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)
  const hit = raycaster.intersectObjects(pickables(), false)[0]
  const idx = hit && hit.object.userData.idx != null ? hit.object.userData.idx : null
  const next = idx == null ? null : nodes[idx].id
  if (next !== hoverId.value) hoverId.value = next
  hoverPos.x = e.clientX - rect.left
  hoverPos.y = e.clientY - rect.top
  hostEl.value.style.cursor = next != null ? 'pointer' : 'grab'
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
function onCanvasMoveCapture(e) {
  if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) dragged = true
}
function onPointerLeave() {
  hoverId.value = null
}

watch(hoverId, () => refreshEdgeColors())

// ================= 标签筛选 / 工具 =================
function allTags() {
  const counts = new Map()
  for (const n of nodes) for (const t of n.tags || []) counts.set(t, (counts.get(t) || 0) + 1)
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b))
}
function toggleTag(tag) {
  const i = filterTags.value.indexOf(tag)
  if (i >= 0) filterTags.value.splice(i, 1)
  else filterTags.value.push(tag)
  refreshEdgeColors()
}
function reLayout() {
  for (const s of satellites) {
    s.phase = Math.random() * Math.PI * 2
    const eul = new THREE.Euler(
      (Math.random() * 1.1 - 0.55) * (s.shell === 0 ? 0.6 : 1),
      Math.random() * Math.PI * 2,
      (Math.random() * 1.1 - 0.55) * (s.shell === 0 ? 0.6 : 1)
    )
    s.q.setFromEuler(eul)
  }
  updateSatPositions()
}

// ================= 悬停信息 =================
const hoverInfo = computed(() => {
  if (hoverId.value == null) return null
  const idx = NODE_IDX.get(hoverId.value)
  if (idx == null) return null
  const n = nodes[idx]
  const list = edgeIndexByNode.get(idx) || []
  const byTags = new Map()
  const neighbors = []
  for (const ei of list) {
    const e = edgeList[ei]
    const other = e.a === idx ? e.b : e.a
    neighbors.push({ title: nodes[other].title, shared: e.shared })
    for (const t of e.shared) byTags.set(t, (byTags.get(t) || 0) + 1)
  }
  const topTags = [...byTags.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map((x) => '#' + x[0])
  return {
    title: n.title,
    tags: n.tags || [],
    isHub: idx === hubIdx,
    edgeCount: list.length,
    topTags,
    neighbors: neighbors.slice(0, 6),
    more: Math.max(0, neighbors.length - 6),
  }
})

const coreTitle = computed(() => (hubIdx >= 0 ? nodes[hubIdx].title : ''))

// ================= 数据加载 =================
async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listPosts({ category: 'wiki', page: 1, pageSize: 100 })
    buildGraph(data.items || [])
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    // 3D 容器（.graph-3d）在 v-else 分支里，要等 loading=false 渲染出来后再建场景
    if (!error.value && nodes.length) {
      nextTick(() => {
        initScene()
        setupLayout()
      })
    }
  }
}

// ================= 清理 =================
function removeObject(obj) {
  if (!obj || !scene) return
  scene.remove(obj)
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach((m) => {
        if (m.map) m.map.dispose()
        m.dispose()
      })
    }
  })
}

onMounted(load)
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (resizeObs) resizeObs.disconnect()
  if (hostEl.value && renderer && renderer.domElement.parentNode === hostEl.value) {
    hostEl.value.removeChild(renderer.domElement)
  }
  const objs = [hubGroup, edgeSegs, stars, ...shellGuides]
  objs.forEach((o) => o && removeObject(o))
  satellites.forEach((s) => s.group && removeObject(s.group))
  if (controls) controls.dispose()
  if (renderer) renderer.dispose()
  scene = null
  renderer = null
  controls = null
  satellites = []
  satByIndex.clear()
})
</script>

<template>
  <div class="wiki-graph">
    <p v-if="error" class="graph-error">{{ error }}</p>
    <p v-else-if="loading" class="graph-hint">加载条目中…</p>
    <p v-else-if="!countInfo.nodes" class="graph-hint">还没有 Wiki 条目</p>

    <template v-else>
      <div class="graph-head">
        <span class="graph-tip">
          <span class="dot"></span>
          <template v-if="coreTitle">
            核心「{{ coreTitle }}」为关联最多的条目，其余条目沿 3D 轨道绕行；连线 = 共享标签，越亮关联越强
          </template>
          <template v-else>条目之间暂无共享标签，自由绕行中</template>
        </span>
        <span class="graph-count">{{ countInfo.nodes }} 个条目 · {{ countInfo.edges }} 条关联</span>
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
        <button v-if="filterTags.length" type="button" class="filter-clear" @click="filterTags = []">
          清除
        </button>
      </div>

      <div ref="hostEl" class="graph-3d" role="img" aria-label="Wiki 条目标签关联三维拓扑图">
        <div class="graph-hud">
          <span class="hud-hint">拖拽旋转 · 滚轮缩放 · 悬停高亮 · 点击打开条目</span>
          <div class="hud-actions">
            <button type="button" title="重新随机轨道相位与倾角" @click="reLayout">重新排布</button>
            <button type="button" @click="paused = !paused">
              {{ paused ? '继续' : '暂停' }}绕行
            </button>
          </div>
        </div>

        <div
          v-if="hoverInfo"
          class="graph-tooltip"
          :style="{ left: hoverPos.x + 'px', top: hoverPos.y + 'px' }"
        >
          <div class="tt-title">
            {{ hoverInfo.title }}
            <span v-if="hoverInfo.isHub" class="tt-hub">核心</span>
          </div>
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

/* —— 3D 画布 —— */
.graph-3d {
  position: relative;
  height: min(76vh, 720px);
  min-height: 520px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 14px;
  background:
    radial-gradient(circle at 50% 44%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 62%),
    var(--panel);
  touch-action: none;
}

.graph-3d :deep(canvas) {
  display: block;
}

.graph-hud {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  pointer-events: none;
}

.hud-hint {
  font-size: 12px;
  color: var(--muted);
  background: color-mix(in srgb, var(--panel) 80%, transparent);
  border: 1px solid var(--border);
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
  border: 1px solid var(--border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 85%, transparent);
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  backdrop-filter: blur(6px);
  transition:
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo),
    background var(--dur-ios-1) var(--ease-ios-expo);
}

.hud-actions button:hover {
  color: var(--text);
  border-color: var(--accent);
}

/* —— 悬停信息卡 —— */
.graph-tooltip {
  position: absolute;
  z-index: 5;
  transform: translate(16px, -55%);
  max-width: 340px;
  min-width: 200px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
  pointer-events: none;
}

.tt-title {
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tt-hub {
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
  border-radius: 999px;
  padding: 1px 7px;
}

.tt-tags {
  color: var(--accent);
  margin-top: 3px;
}

.tt-links {
  color: var(--muted);
  margin-top: 3px;
}

.tt-neighbors {
  list-style: none;
  margin: 6px 0 0;
  padding: 6px 0 0;
  border-top: 1px dashed var(--border);
}

.tt-neighbors li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 2px;
  color: var(--text);
}

.tt-neighbors li .tt-shared {
  color: var(--muted);
  font-size: 11px;
  margin-left: auto;
  white-space: nowrap;
}

.tt-more {
  color: var(--muted);
  margin-top: 4px;
}
</style>
