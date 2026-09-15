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
import { takePrefetchedWikiGraphData } from '../wikiView'

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
  const __t = () => performance.now()
  const __marks = {}
  let __last = __t()
  const __mark = (k) => { const n = __t(); __marks[k] = +(n - __last).toFixed(1); __last = n }
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(50, 1, 1, 6000)
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  } catch (e) {
    error.value = '当前环境不支持 WebGL，无法显示星系拓扑'
    return
  }
  __mark('newRenderer')
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
  __mark('controls')

  makeBackgroundStars()
  __mark('bgStars')
  galaxy = new THREE.Group()
  scene.add(galaxy)
  isoGroup = new THREE.Group()
  scene.add(isoGroup)
  makeCenter()
  __mark('center')
  makeDust()
  __mark('dust')
  makeMarkers()
  __mark('markers')
  makeEdges()
  __mark('edges')

  ro = new ResizeObserver(resize)
  ro.observe(hostEl.value)
  resize()
  __mark('resize')
  // 保留分阶段耗时到 window，便于以后回归（不写 console，避免每帧/每次进入都刷日志）
  window.__graphPerf = __marks

  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', onPointerLeave)
  // 帧循环由 load() 统一启动（见那里的注释），这里不再启动，避免起两个循环
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
  // 深空底下的白色星点（与站点主题无关）
  const m = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.7, depthWrite: false })
  const p = new THREE.Points(g, m)
  scene.add(p)
}

// 星系核心的光晕贴图（纯径向渐变，本身是白色 —— 实际颜色由材质 color 决定）。
// ⚠ 色标必须做出**接近高斯**的平滑衰减：
//   1) 中心不要有"实心圆"（色标 0 → 0.12 若保持 1.0，叠加后中心会是一块硬边的亮斑）；
//   2) 越靠外越平缓，让"边界"落在极低不透明度处，肉眼看不到圆边；
//   3) 末尾几档要足够小且彼此接近（0.04 → 0.012 → 0），避免出现可见的收边台阶。
function glowTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const x = c.getContext('2d')
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128)
  // ⚠ 中心**不要做成"实心亮点"**：0 → 0.1 之间保持接近满值的话，
  //   叠加五层后中心会是一个又小又亮的点，肉眼又成了"中心有个点"。
  //   这里让中心就已经开始衰减（1 → 0.8），得到"宽而软的亮心"。
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.12, 'rgba(255,255,255,0.62)')
  g.addColorStop(0.24, 'rgba(255,255,255,0.44)')
  g.addColorStop(0.38, 'rgba(255,255,255,0.3)')
  g.addColorStop(0.54, 'rgba(255,255,255,0.17)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.08)')
  g.addColorStop(0.84, 'rgba(255,255,255,0.03)')
  g.addColorStop(0.93, 'rgba(255,255,255,0.01)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 256, 256)
  return new THREE.CanvasTexture(c)
}

/* 核心 = **一团看不到边界的光团**，不再有任何实体几何。
   —— 为什么必须去掉球体 ——
   原来核心是一个 `SphereGeometry(6)` 的实体网格：实体表面在屏幕上就是一个**硬边圆**，
   无论怎么调色都能看到"一个圆盘贴在那里"。光团的边缘必须由**不透明度衰减**造出来，
   所以核心只能是纯径向渐变的 Sprite。
   —— 为什么要用 AdditiveBlending ——
   叠加混合本身就是"发光"的物理表达（把颜色加到背景上）。普通混合画出的是一块
   **不透明的色块**，压在旋臂上会挡住后面的星点、更像贴纸而不是光。
   —— 怎么做到"发亮"又不刺眼 ——
   光晕**分五层叠加**，而不是一层调亮：各层尺寸不同、峰值错开，
   每层自身都衰减到 0，叠加后的总衰减沿半径**单调且无明显台阶**，
   整体是"中间亮、向外化开"的一团光，任何位置都看不出圆边。
   —— 参数是实测调出来的 ——
   ① 三层(46/110/230, .9/.42/.16)：太小太闷，看不出光团；
   ② 四层(60/120/200/340, 1/.6/.32/.14)：亮度够了，但**中心出现硬边亮点**
      （实测方向中位亮度 r=0→83.9、r=8→49.4、r=12→36.7，12px 内掉了 47，是个可见的点）；
   ③ 五层 + 贴图中心就开始衰减（色标 1 → 0.8）→ 得到"宽而软的亮心"，中心不再是点。
   —— 颜色来回改过三轮，最终定**白色** ——
   最初是纯白内核球（太亮、有硬边）→ 改成暗红（那是"暗红斑"不是光）→
   再改成暗红的多层光团 → 用户最终确认"**中心光团还是用白色的吧**"。
   所以现在是**白色光团**：颜色 `0xffffff`，柔和度靠"多层 + 平滑衰减 + 压低 opacity"实现，
   而不是靠调暗颜色。⚠ 正因为是白色，**透明度必须压在较低水平**：
   五层全是满不透明度的白会叠加回第一轮那种刺眼白斑。
   要整体调亮/调暗，改各层 `opacity`；`CORE_GLOW_SCALE` 控制铺开的范围。 */
const CORE_GLOW_COLOR = 0xffffff
const CORE_GLOW_SCALE = 150

function makeCenter() {
  const tex = glowTexture()
  // [半径(× CORE_GLOW_SCALE), 不透明度]：从内到外
  // 最外层 1.7×150 ≈ 255 世界单位 —— 屏幕上约 175px 半径，
  // 亮度早已低到看不见，因此光团"铺得很开但收得无痕"。
  // ⚠ 白色比暗红"显亮"得多，所以整体 opacity 比暗红那版低一档。
  const LAYERS = [
    [0.12, 0.2],
    [0.3, 0.26],
    [0.52, 0.22],
    [0.9, 0.14],
    [1.7, 0.07],
  ]
  for (const [k, opacity] of LAYERS) {
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        color: CORE_GLOW_COLOR,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
    const size = k * CORE_GLOW_SCALE * 2
    spr.scale.set(size, size, 1)
    galaxy.add(spr)
  }
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
  // 星系区域恒为深色背景，文字统一用浅色保证可读
  return new THREE.Color('#ffffff')
}

// 标签光栅化的"超采样倍率"。
//
// 问题：标签是 Sprite + CanvasTexture，纹理在创建时就以固定的 30px 字号画好。
// 透视相机拉近（OrbitControls 的 dolly）会把这个纹理放大呈现 —— 纹理像素被拉伸，
// 于是越放大越糊。
//
// 修法：按"当前相机距离"推算出这个纹理在屏幕上最多会被放大多少倍，就按那个倍数
// 提高光栅化分辨率（字号与画布同比放大），世界尺寸保持不变（视觉大小不变，只变清晰度）。
// 只在需要更高倍率时重建，避免来回抖动时反复重画。
//
// 内存控制：标签纹理与 (倍率)² 成正比，因此上限按「最近机位实际需要多少」来定，
// 而不是拍脑袋给个很大的值。LABEL_REF_DISTANCE / controls.minDistance ≈ 4.5，
// 留些余量取 4.8；再大就只是浪费显存了。
// 若将来节点数大幅增长，优先下调此上限或 makeLabelSprite 里的 maxPx。
const LABEL_SS_MAX = 4.8
const LABEL_SS_MIN = 1
// 参照距离：标签纹理就是按这个距离对应的屏幕尺寸光栅化的（initScene 的初始机位约 504）。
// 机位比它更远时精灵在屏幕上更小，纹理只多不少，因此不需要降低倍率。
const LABEL_REF_DISTANCE = 500
let labelSuperSample = LABEL_SS_MIN
let labelRefreshTimer = null
// 当前这次挂载的"代号"：延后一帧烤标签的回调靠它判断自己是否已经过期。
// ⚠ 这里原来是一个 `unmounted` 布尔量（卸载时置 true，**从不复位**）。ES 模块在路由
//   切换之间只求值一次，所以**第一次离开拓扑图之后它永远是 true** —— 第二次进来时
//   `if (unmounted || !renderer) return` 会直接跳过 makeLabels()：球体与边都正常，
//   文字标签却再也不出现，直到整页刷新。
//   换成只增不减的代号后，连"上一代残留的 rAF 回调打在这一次挂载上"这种情况也一并拦掉
//   （复位布尔量做不到这一点）。
let mountGen = 0

/** 根据相机距离算出需要的超采样倍率（永远取"够清晰"的那一档） */
function neededSuperSample() {
  if (!camera || !controls) return LABEL_SS_MIN
  const d = Math.max(1, camera.position.distanceTo(controls.target))
  const raw = LABEL_REF_DISTANCE / d
  return Math.min(LABEL_SS_MAX, Math.max(LABEL_SS_MIN, raw))
}

/**
 * 标记标签需要重建。
 *
 * 关键：定时器**只排一次**。这个函数每帧都会被调用（帧循环里判断是否需要提高倍率），
 * 如果每帧都 clearTimeout + 重设，180ms 的定时器在持续缩放期间永远等不到触发时机，
 * 标签纹理就永远停在初始倍率上 —— 这正是"放大后依然模糊"的原因。
 * 因此这里只在没有待处理定时器时才排队。
 */
function scheduleLabelRefresh() {
  if (!markers.length || labelRefreshTimer) return
  const need = neededSuperSample()
  // 只在"明显需要更清晰"时重建（留 15% 余量，避免临界点反复触发）
  if (need <= labelSuperSample * 1.15) return
  labelRefreshTimer = setTimeout(() => {
    labelRefreshTimer = null
    refreshLabels()
  }, 180)
}

/** 用当前倍率重画所有标签纹理（只替换纹理，不动精灵与世界尺寸） */
function refreshLabels() {
  if (!markers.length) return
  const next = neededSuperSample()
  if (next <= labelSuperSample * 1.01) return
  labelSuperSample = next
  for (const m of markers) {
    const old = m.label
    if (!old) continue
    const parent = old.parent
    if (!parent) continue
    const tint = old.material?.color?.clone() || themeTextColor()
    const fresh = makeLabelSprite(m.nd.title, tint)
    // 沿用原位置、缩放与可见性/透明度，保证视觉状态完全不变，只有清晰度变化
    // （过滤、悬停等逻辑会直接改 label.visible / labelMat.opacity，重建时必须带走）
    // ⚠ 例外：若还是**占位**精灵（phase 1 之后、phase 2 之前就被触发），它是 `visible = false`，
    // 照抄会把新标签也藏起来。此时用新精灵自己的默认可见性。
    if (old.userData?.placeholder) fresh.visible = true
    else fresh.visible = old.visible
    fresh.position.copy(old.position)
    fresh.scale.copy(old.scale)
    fresh.renderOrder = old.renderOrder
    if (!old.userData?.placeholder && old.material) fresh.material.opacity = old.material.opacity
    fresh.userData.idx = m.nd.idx
    parent.add(fresh)
    parent.remove(old)
    old.material?.map?.dispose()
    old.material?.dispose()
    m.label = fresh
    m.labelMat = fresh.material
  }
}

/**
 * 标签文本按给定倍率光栅化后的**行数与世界尺寸**。
 *
 * ⚠ 抽出来是为了把"建结构"和"烤标签纹理"分两阶段做：
 * 精灵的世界尺寸只由**文本行数**决定，与 `labelSuperSample` 无关
 * （见 makeLabelSprite：`sp.scale` 用的是原始世界尺寸，倍率只影响清晰度）。
 * 所以第一阶段就能把位置/尺寸都定下来、让第一帧先画出来，
 * 纹理留到下一帧再烤 —— 用户更早看到图，标签晚一帧出现。
 */
function labelMetricsFor(text, fs) {
  const font = labelFont(fs)
  const lines = wrapFull(text, font, 560 * fs)
  const worldH = lines.length * 10 + (lines.length - 1) * 2.5 + 3
  return { lines, worldH }
}

function labelFont(fs) {
  return `600 ${Math.round(30 * fs)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`
}

// 占位精灵专用的**全黑 1×1 贴图**（只建一次，所有占位共用）。
//
// ⚠⚠ 这是"白色矩形"的根治办法。`SpriteMaterial` 不传 `map` 时用的是**默认白色贴图**，
// 而 `Sprite` 永远正对相机 → 未烤纹理的那一帧里每个标签位置都会画出一块白矩形。
// 只靠 `visible = false` **不可靠**（实测仍然出现过白块：状态探针显示 0 个"可见无贴图"精灵，
// 画面上却确实有白条，说明还有别的路径把它画了出来）。
// 换成"赋一张全黑不透明贴图"后，即使它被渲染出来也只会是**黑色小片**，
// 在深空底上几乎不可见；再叠加 `visible = false` 就是双保险。
let _placeholderTex = null
function placeholderTexture() {
  if (_placeholderTex) return _placeholderTex
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 1
  const x = c.getContext('2d')
  x.fillStyle = '#000000'
  x.fillRect(0, 0, 1, 1)
  _placeholderTex = new THREE.CanvasTexture(c)
  return _placeholderTex
}

function makeLabelSprite(text, tint) {
  // ss：光栅化倍率。字号/行高/内边距/画布尺寸全部同比放大，
  // 最后 sp.scale 用"原始世界尺寸"（与 ss 无关），因此放大只提升清晰度、不改变视觉大小。
  const ss = labelSuperSample
  const font = labelFont(ss)
  const maxPx = 560 * ss
  const lines = wrapFull(text, font, maxPx)
  const lineH = 36 * ss
  const padX = 10 * ss
  const padY = 6 * ss
  const maxW = Math.max(...lines.map((l) => labelWidth(l, font)))
  const c = document.createElement('canvas')
  c.width = Math.ceil(maxW) + padX * 2
  c.height = lines.length * lineH + padY * 2
  const x = c.getContext('2d')
  x.font = font
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.shadowColor = 'rgba(0,0,0,0.85)'
  x.shadowBlur = 6 * ss
  x.fillStyle = '#ffffff'
  lines.forEach((ln, i) => {
    x.fillText(ln, c.width / 2, padY + lineH * i + lineH / 2 + 1)
  })
  x.shadowBlur = 0
  const tex = new THREE.CanvasTexture(c)
  // 各向异性过滤：斜视角下长文本的清晰度也靠它
  tex.anisotropy = renderer?.capabilities?.getMaxAnisotropy?.() || 1
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: tint.clone(), opacity: 0.9 })
  const sp = new THREE.Sprite(mat)
  // 世界尺寸：每行约 10 单位高，行多则整体变高（宽度按同比例）
  const worldH = lines.length * 10 + (lines.length - 1) * 2.5 + 3
  sp.scale.set(worldH * (c.width / c.height), worldH, 1)
  return sp
}

/**
 * 阶段一：球体 + 精灵**占位**（位置/尺寸都定好，但还没有纹理）。
 *
 * ⚠ 为什么拆成两阶段：烤 21 张标签纹理（每张一个 canvas + CanvasTexture + 各向异性设置）
 * 实测占 makeMarkers 的大头（21.3ms 里大部分），而它**不影响第一帧能不能画出来**。
 * 把纹理留到下一帧，首帧更快出现 —— 用户的体感是"图先出来，字跟着来"，
 * 比"白等一帧、图和字一起出现"要好。
 */
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

    // 标题标签占位：**位置与世界尺寸现在就算好**（只依赖文本行数，与纹理倍率无关），
    // 所以第一帧就能把精灵放到正确位置。下一帧由 makeLabels() 把纹理烤上。
    //
    // ⚠⚠ 占位精灵**必须带一张全黑贴图**（`placeholderTexture()`），不能只靠 `visible = false`。
    // `SpriteMaterial` 不传 `map` 时用的是**默认白色贴图**，而 `Sprite` 永远正对相机 ——
    // 于是未烤纹理的这段时间里，每个标签位置都会被画成一块**白色矩形**
    // （用户反馈"刷新该页面时，星系拓扑上的文字位置会先显示白色矩形"）。
    // 我第一版只用 `visible = false` 隐藏它，**用户复测仍有白条**：逐帧推进 rAF 实测
    // 占位窗口浅色像素 23761，而状态探针显示"可见且缺贴图的精灵 = 0" ——
    // 也就是说 `visible = false` 在这个路径上没真正拦住绘制（原因未查清，不再依赖它）。
    // 换成全黑贴图后，即使被画出来也只是黑色小片；`visible = false` 保留作双保险。
    // 再叠上 `opacity: 0`（原来是 0.001）就是三重保险 —— 占位在任何路径下都不贡献像素。
    const { worldH } = labelMetricsFor(nd.title, LABEL_SS_MIN)
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: placeholderTexture(), transparent: true, depthWrite: false, opacity: 0 })
    )
    sp.visible = false
    sp.userData.placeholder = true
    const aspectW = worldH * 4 // 占位宽高比，等真实纹理烤好后再按 c.width/c.height 精修
    sp.scale.set(aspectW, worldH, 1)
    const labelY = pos.y + (r + 2 + worldH / 2)
    sp.position.set(pos.x, labelY, pos.z)
    sp.renderOrder = 2
    ;(isIso ? isoGroup : galaxy).add(sp)

    markers.push({ mesh, mat, nd, color, label: sp, labelMat: sp.material, labelY, labelRadius: r })
  }
}

/**
 * 阶段二：把纹理烤到占位精灵上。
 * 会重算宽高比（`c.width / c.height`），所以尺寸与一次性构建时**完全一致**。
 */
function makeLabels() {
  for (const m of markers) {
    const sp = m.label
    const parent = sp.parent
    if (!parent) continue
    const tint = themeTextColor()
    const fresh = makeLabelSprite(m.nd.title, tint)
    fresh.position.copy(sp.position)
    fresh.renderOrder = sp.renderOrder
    // ⚠ 占位精灵是 `visible = false` 且 `opacity: 0`（为了不画出白色矩形），
    // 所以这里**不能**照抄它的 `visible`/`opacity` —— 照抄会让标签永远不显示。
    // 新精灵用它自己的默认值（makeLabelSprite 里 opacity 0.9、visible 默认 true）即可。
    // 非占位的情况（理论上不会走到）才沿用原状态。
    if (!sp.userData?.placeholder) {
      fresh.visible = sp.visible
      if (sp.material) fresh.material.opacity = sp.material.opacity
    }
    fresh.userData.idx = m.nd.idx
    parent.add(fresh)
    parent.remove(sp)
    // ⚠ 占位贴图是**所有占位共用的单例**，不能在这里 dispose ——
    // 一 dispose 后面那些还没替换的占位就会拿到失效贴图。只 dispose 独立材质。
    if (!sp.userData?.placeholder) sp.material?.map?.dispose()
    sp.material?.dispose()
    m.label = fresh
    m.labelMat = fresh.material
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
let hidden = false
function onVisibility() {
  hidden = document.hidden
  if (hidden) {
    // 标签页不可见：停掉帧循环，别在后台空烧 GPU
    cancelAnimationFrame(raf)
    raf = 0
  } else if (renderer && !raf) {
    clock.getDelta() // 丢弃切回瞬间的巨大 delta，避免画面跳一下
    tick()
  }
}

function tick() {
  if (hidden) return
  raf = requestAnimationFrame(tick)
  const dt = Math.min(clock.getDelta(), 0.05)
  if (spinning.value) {
    armAngle += dt * (reducedMotion ? 0.02 : 0.045)
    galaxy.rotation.y = armAngle
  }
  controls.update()
  // 拉近后标签纹理会不够清晰：这里只做"是否需要提高倍率"的判断（很轻），
  // 真正的重画交给去抖后的 refreshLabels，不会每帧重建纹理。
  scheduleLabelRefresh()
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
/* 视图过渡时长（--dur-ios-2 = 260ms）。
   ⚠ 这个守卫的意思是"等过渡动画跑完再构建 3D 场景"，因为构建是同步重活、会打断动画。
   实测构成（1600×900，21 条 wiki）：
     · newRenderer 12.8ms、controls 2.1ms、bgStars 0.5ms、center 0.7ms、
       dust 1.1ms、markers 21.3ms、edges 1.3ms、resize 4.5ms —— 合计 **约 44ms**
     · 其中 **markers 占 21.3ms 的大头是"烤 21 张标签纹理"**（每张一个 canvas + CanvasTexture
       + 各向异性），而它并不影响第一帧能不能出来 → 已拆成两阶段（见 makeMarkers / makeLabels）
   于是：**结构**（球体+占位精灵+边+尘埃）只需约 23ms，可以更早开始；
   标签纹理推到首帧之后的那一帧再烤，用户"先看到图、字跟着来"。
   守卫因此从 340ms 收紧到 170ms —— 只等列表淡出那一段（150ms 左右），
   不等整段 260ms，图能提早约 300ms 出现。
   ⚠ 若以后节点数大幅增长（几十上百条），这里的取值要重新量：
   结构构建一旦超过约 60ms 就会明显打断 graph 的淡入，届时应把守卫调回去。 */
const transitionGuardUntil = performance.now() + 170

async function load() {
  // 本次挂载的代号：延后一帧烤标签的回调据此判断自己是否已经过期（见 mountGen）
  const gen = ++mountGen
  loading.value = true
  error.value = ''
  try {
    // 数据可能已经在预取里拉好了（见 wikiView.js 的 prefetchWikiGraph）：
    // 命中就直接用，省掉"等完 527KB 的 three 分包、再等一个接口往返"的后半段。
    // ⚠ `await` 必须裹住整个 `||` —— 预取分支交出的是 promise 本身，
    //   漏掉 await 会拿到 promise 对象去取 .items（undefined），星系会是空的。
    const data = await (takePrefetchedWikiGraphData() ||
      listPosts({ category: 'wiki', page: 1, pageSize: 100 }))
    buildGraph(data.items || [])
    if (nodes.length) assignArms()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    if (!error.value && nodes.length) {
      // 等列表淡出（约 150ms）再建**结构**；用 rAF 链路往后推，比死等 setTimeout 更贴合帧节奏。
      // ⚠ 取 `transitionGuardUntil` 与"现在 + 一帧"的较大者：分包被预取过时模块求值早得多、
      //   这个常量早已过期，此时若不做下限，那次 23ms 的同步构建会正好压在过渡的第一帧上；
      //   冷启动路径语义不变（仍是等满 170ms）。
      const until = Math.max(performance.now() + 16, transitionGuardUntil)
      nextTick(() => {
        requestAnimationFrame(function waitFrames() {
          if (performance.now() < until) {
            requestAnimationFrame(waitFrames)
            return
          }
          if (!error.value && nodes.length) {
            initScene()
            document.addEventListener('visibilitychange', onVisibility)
            hidden = document.hidden
            if (!hidden) tick()
            // 阶段二：首帧已经画出来了（结构+球体+边），现在把标签纹理烤上。
            // 放下一帧做，既不拖慢首帧，也让"图先出现、字随后"这个顺序稳定成立。
            requestAnimationFrame(() => {
              if (gen !== mountGen || !renderer) return
              makeLabels()
            })
          }
        })
      })
    }
  }
}

// ================= 清理 =================
onMounted(load)
onBeforeUnmount(() => {
  // 让代号前进一步：还在队列里的延后回调（烤标签那一帧）就此判定为过期
  mountGen++
  cancelAnimationFrame(raf)
  raf = 0
  clearTimeout(labelRefreshTimer)
  labelRefreshTimer = null
  labelSuperSample = LABEL_SS_MIN
  document.removeEventListener('visibilitychange', onVisibility)
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

        <div v-if="hoverInfo" class="graph-tooltip">
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
  color: #dbe4f5;
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
  color: #dbe4f5;
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
  top: 12px;
  left: 14px;
  z-index: 5;
  max-width: 320px;
  min-width: 170px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  /* 深空底上的玻璃卡：固定浅色文字，深浅主题都可读；半透明不遮节点 */
  background: rgba(10, 15, 28, 0.72);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.3);
  color: #eef2fa;
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
  color: #9db2d6;
  margin-top: 3px;
}

.tt-neighbors {
  list-style: none;
  margin: 6px 0 0;
  padding: 6px 0 0;
  border-top: 1px dashed rgba(255, 255, 255, 0.16);
}

.tt-neighbors li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 2px;
  color: #eef2fa;
}

.tt-neighbors li .tt-shared {
  color: #8ab4ff;
  font-size: 11px;
  margin-left: auto;
  white-space: nowrap;
}

.tt-more {
  color: #9db2d6;
  margin-top: 4px;
}

/* —— 星系内固定深色玻璃样式（不随站点深浅主题变化，保证切换主题时可读） —— */
.filter-bar .filter-label {
  color: #9db2d6;
}

.filter-bar button {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.16);
  color: #cfd9ec;
}

.filter-bar button:hover {
  color: #fff;
  border-color: #8ab4ff;
}

.filter-bar button.on {
  background: #7aa7ff;
  border-color: #7aa7ff;
  color: #fff;
}

.filter-bar .filter-clear {
  border-style: dashed;
}

.graph-hint {
  color: #9db2d6;
}

</style>
