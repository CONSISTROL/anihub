<script setup>
// 二维码生成：输入 URL/文本，二维码实时变形为一棵 3D 等距体素树。
// 参考：https://recent.design/i/3driga1-animated-qr-code-morphing
// 纯前端：qrcode-generator 生成矩阵，three.js 渲染体素。
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import QRCode from 'qrcode-generator'

const url = ref('https://anihub.example.com')
const error = ref('')
const status = ref('')
const view = ref('3d') // '3d' | 'top'

const QUIET = 4
const MODULE = 0.4 // 每个二维码模块的世界尺寸
const VOXEL = 0.34 // 体素边长
const TREE_GRID = 25 // 体素树网格分辨率（奇数，稍大让树冠更饱满）
const TRUNK_H = 9 // 树干体素层数（加高树干）
const MAX_H = 18 // 树冠最高层
const TRUNK_R = 0.18 // 树干半径（归一化，细一点）
const MAX_R = 1.1 // 树冠最大半径（归一化，更大）

let mount = null
let renderer = null
let scene = null
let camera = null
let orbitGroup = null
let groundMesh = null
let voxelMesh = null
let voxelData = [] // { flat, tree, flatColor, treeColor }
let clock = null
let rafId = 0
let morphT = 0 // 当前变形进度 0=平面二维码 1=3D 树
let morphTarget = 1
let qrInfo = null
let generatedText = ''
let disposed = false
let debounceTimer = null

const _pos = new THREE.Vector3()
const _color = new THREE.Color()
const _dummy = new THREE.Object3D()

const CAM_3D_POS = new THREE.Vector3(-10, 9, 7.5)
const CAM_3D_LOOK = new THREE.Vector3(0, 2.8, 0)
const CAM_TOP_POS = new THREE.Vector3(0, 16, 0.01)
const CAM_TOP_LOOK = new THREE.Vector3(0, 0, 0)
const _camPos = new THREE.Vector3()
const _camLook = new THREE.Vector3()

/* —— 二维码矩阵 —— */
function buildMatrix(text) {
  const qr = QRCode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const size = n + QUIET * 2
  const dark = []
  const light = []
  const darkSet = new Set()
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const qrR = r - QUIET
      const qrC = c - QUIET
      const isDark = qrR >= 0 && qrR < n && qrC >= 0 && qrC < n && qr.isDark(qrR, qrC)
      if (isDark) {
        dark.push([c, r])
        darkSet.add(r * size + c)
      } else {
        light.push([c, r])
      }
    }
  }
  return { n, size, dark, light, darkSet }
}

/* —— 场景 —— */
function initScene() {
  const w = mount.clientWidth || 720
  const h = mount.clientHeight || 480
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(w, h)
  mount.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  const aspect = w / h
  const d = 9.5
  camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 100)
  camera.position.copy(CAM_3D_POS)
  camera.lookAt(CAM_3D_LOOK)

  scene.add(new THREE.AmbientLight(0xffffff, 0.85))
  const dir = new THREE.DirectionalLight(0xffffff, 1.6)
  dir.position.set(6, 14, 8)
  scene.add(dir)
  const fill = new THREE.DirectionalLight(0xb0c4ff, 0.5)
  fill.position.set(-6, 4, -6)
  scene.add(fill)

  orbitGroup = new THREE.Group()
  scene.add(orbitGroup)
  clock = new THREE.Clock()
}

function disposeObject3D(obj) {
  if (!obj) return
  obj.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose()
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      for (const mat of mats) {
        mat?.map?.dispose()
        mat?.dispose()
      }
    }
  })
}

function buildGround(text) {
  const S = qrInfo.size
  const N = qrInfo.n
  const group = new THREE.Group()

  // 3D 二维码草坪：只包含二维码本身的内容，不需要 padding/静区，也不需要外围草地
  const blockGeo = new THREE.BoxGeometry(MODULE * 0.86, MODULE * 0.22, MODULE * 0.86)
  const blockMat = new THREE.MeshStandardMaterial({ roughness: 0.8 })
  const count = N * N
  const blockMesh = new THREE.InstancedMesh(blockGeo, blockMat, count)
  const m4 = new THREE.Matrix4()
  const color = new THREE.Color()

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const isDark = qrInfo.darkSet.has((r + QUIET) * S + (c + QUIET))
      const x = (c - (N - 1) / 2) * MODULE
      const z = (r - (N - 1) / 2) * MODULE
      const y = isDark ? 0.14 : 0.07
      m4.makeTranslation(x, y, z)
      blockMesh.setMatrixAt(r * N + c, m4)
      color.set(isDark ? 0x43a047 : 0xb9f6ca)
      blockMesh.setColorAt(r * N + c, color)
    }
  }
  blockMesh.instanceMatrix.needsUpdate = true
  if (blockMesh.instanceColor) blockMesh.instanceColor.needsUpdate = true
  group.add(blockMesh)

  groundMesh = group
  orbitGroup.add(groundMesh)
}

/* —— 体素树 —— */
function buildTreeVoxels() {
  const S = qrInfo.size
  const N = qrInfo.n
  const half = (S - 1) / 2
  const R = (TREE_GRID - 1) / 2
  const data = []

  for (let gx = 0; gx < TREE_GRID; gx++) {
    for (let gz = 0; gz < TREE_GRID; gz++) {
      const nx = (gx - R) / R // -1..1
      const nz = (gz - R) / R
      const r = Math.sqrt(nx * nx + nz * nz)

      // 将树体素位置映射到二维码真实数据区（避开静区）
      const col = QUIET + Math.round(((nx + 1) / 2) * (N - 1))
      const row = QUIET + Math.round(((nz + 1) / 2) * (N - 1))
      const isDark = qrInfo.darkSet.has(row * S + col)

      // 二维码明暗参与树形：深色列更高更密，浅色列略矮，树干始终完整
      let maxY = -1
      if (r <= TRUNK_R) {
        maxY = TRUNK_H - 1
      } else if (r <= MAX_R) {
        maxY = MAX_H
      }
      if (maxY < 0) continue
      const columnMaxY = r <= TRUNK_R
        ? TRUNK_H - 1
        : Math.max(TRUNK_H, Math.round(maxY * (isDark ? 1 : 0.6)))

      for (let y = 0; y <= columnMaxY; y++) {
        let include = false
        let isTrunk = false

        if (r <= TRUNK_R && y < TRUNK_H) {
          include = true
          isTrunk = true
        } else if (y >= TRUNK_H && y <= MAX_H) {
          const t = (y - TRUNK_H) / (MAX_H - TRUNK_H)
          const radiusAtY = MAX_R * (1 - t * 0.82)
          if (r <= radiusAtY) {
            include = true
          }
        }

        if (!include) continue

        const flatX = (col - half) * MODULE
        const flatZ = (row - half) * MODULE
        const treeX = nx * R * VOXEL * 0.92
        const treeZ = nz * R * VOXEL * 0.92
        const treeY = y * VOXEL

        const flatColor = isDark
          ? new THREE.Color(0x111111)
          : new THREE.Color(0xf5f5f5)
        const treeColor = isTrunk
          ? (isDark ? new THREE.Color(0x5d4037) : new THREE.Color(0xd7ccc8))
          : (isDark ? new THREE.Color(0xf06292) : new THREE.Color(0xffc1e3))

        data.push({
          // 平面状态时按层轻微抬升，避免同一二维码模块的多层体素完全重叠
          flat: new THREE.Vector3(flatX, 0.04 + y * 0.008, flatZ),
          tree: new THREE.Vector3(treeX, treeY, treeZ),
          flatColor,
          treeColor,
        })
      }
    }
  }
  return data
}

function buildVoxels() {
  voxelData = buildTreeVoxels()
  const geo = new THREE.BoxGeometry(VOXEL * 0.82, VOXEL * 0.82, VOXEL * 0.82)
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.05 })
  voxelMesh = new THREE.InstancedMesh(geo, mat, voxelData.length)
  voxelMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  for (let i = 0; i < voxelData.length; i++) {
    voxelMesh.setColorAt(i, voxelData[i].flatColor)
  }
  orbitGroup.add(voxelMesh)
}

function updateVoxels() {
  if (!voxelMesh) return
  const e = easeInOutCubic(morphT)
  const flatScale = 0.8
  const treeScale = 1
  const scaleXZ = flatScale + (treeScale - flatScale) * e
  const scaleY = 0.06 + (treeScale - 0.06) * e

  for (let i = 0; i < voxelData.length; i++) {
    const d = voxelData[i]
    _pos.copy(d.flat).lerp(d.tree, e)
    _dummy.position.copy(_pos)
    _dummy.scale.set(scaleXZ, scaleY, scaleXZ)
    _dummy.rotation.set(0, 0, 0)
    _dummy.updateMatrix()
    voxelMesh.setMatrixAt(i, _dummy.matrix)

    _color.copy(d.flatColor).lerp(d.treeColor, e)
    voxelMesh.setColorAt(i, _color)
  }
  voxelMesh.instanceMatrix.needsUpdate = true
  if (voxelMesh.instanceColor) voxelMesh.instanceColor.needsUpdate = true
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/* —— 生成 / 更新 —— */
function rebuildScene(text) {
  // 清理旧场景
  if (groundMesh) {
    disposeObject3D(groundMesh)
    orbitGroup.remove(groundMesh)
    groundMesh = null
  }
  if (voxelMesh) {
    disposeObject3D(voxelMesh)
    orbitGroup.remove(voxelMesh)
    voxelMesh = null
  }
  voxelData = []

  qrInfo = buildMatrix(text)
  buildGround(text)
  buildVoxels()
  generatedText = text
}

function generate() {
  const text = url.value.trim()
  if (!text) {
    error.value = '请先输入要编码的 URL 或文本'
    return
  }
  error.value = ''
  status.value = `正在生成「${text.slice(0, 24)}${text.length > 24 ? '…' : ''}」的二维码…`
  rebuildScene(text)

  // 默认显示 3D 树
  morphT = 1
  morphTarget = 1
  view.value = '3d'
  status.value = '完成：已生成 3D 二维码树。点击可切换俯视 / 3D。'
  updateVoxels()
  updateCamera()
}

function toggleView() {
  if (view.value === '3d') {
    view.value = 'top'
    morphTarget = 0
    status.value = '正在切换到俯视二维码草坪…'
  } else {
    view.value = '3d'
    morphTarget = 1
    status.value = '正在切换到 3D 二维码树…'
  }
}

function updateCamera() {
  if (!camera) return
  const e = easeInOutCubic(morphT) // 1 = 3D 视角，0 = 俯视
  _camPos.lerpVectors(CAM_TOP_POS, CAM_3D_POS, e)
  _camLook.lerpVectors(CAM_TOP_LOOK, CAM_3D_LOOK, e)
  camera.position.copy(_camPos)
  camera.lookAt(_camLook)
}

/* —— 动画循环 —— */
function tick() {
  if (disposed) return
  rafId = requestAnimationFrame(tick)

  // 3D 树 <-> 俯视二维码草坪 的过渡动画
  const diff = morphTarget - morphT
  if (Math.abs(diff) > 0.001) {
    morphT += diff * 0.045
    if (Math.abs(morphTarget - morphT) < 0.001) morphT = morphTarget
    updateVoxels()
    updateCamera()
  }

  renderer.render(scene, camera)
}

/* —— 生命周期 —— */
function resize() {
  if (!renderer || !mount) return
  const w = mount.clientWidth || 720
  const h = mount.clientHeight || 480
  renderer.setSize(w, h)
  const aspect = w / h
  const d = 9.5
  camera.left = -d * aspect
  camera.right = d * aspect
  camera.top = d
  camera.bottom = -d
  camera.updateProjectionMatrix()
}

watch(url, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    if (url.value.trim()) generate(true)
  }, 300)
})

onMounted(() => {
  initScene()
  window.addEventListener('resize', resize)
  generate(true)
  rafId = requestAnimationFrame(tick)
})

onUnmounted(() => {
  disposed = true
  clearTimeout(debounceTimer)
  cancelAnimationFrame(rafId)
  window.removeEventListener('resize', resize)
  if (groundMesh) {
    disposeObject3D(groundMesh)
    orbitGroup?.remove(groundMesh)
  }
  if (voxelMesh) {
    disposeObject3D(voxelMesh)
    orbitGroup?.remove(voxelMesh)
  }
  renderer?.dispose()
  mount && (mount.innerHTML = '')
})
</script>

<template>
  <div class="tool-page">
    <router-link to="/tools" class="back-link">← 返回工具箱</router-link>
    <h1 class="page-title">🌳 二维码生成</h1>
    <p class="sub">
      输入 URL，生成 3D 二维码体素树；<strong>点击场景</strong>可在 3D 树和俯视二维码草坪之间切换。纯前端处理。
    </p>

    <div class="controls">
      <input
        v-model="url"
        class="url-input"
        type="text"
        placeholder="输入 URL 或任意文本，例如 https://example.com"
        @keydown.enter="generate()"
      />
      <button class="btn btn-primary" @click="generate()">重新生成</button>
    </div>

    <p v-if="error" class="tool-error">{{ error }}</p>
    <p v-if="status" class="tool-status">{{ status }}</p>

    <div
      ref="mount"
      class="scene"
      :class="{ top: view === 'top' }"
      title="点击切换俯视 / 3D"
      @click="toggleView"
    ></div>
  </div>
</template>

<style scoped>
.tool-page {
  max-width: min(1100px, 95vw);
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.back-link {
  display: inline-block;
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--muted);
  text-decoration: none;
}

.back-link:hover {
  color: var(--accent);
}

.page-title {
  margin: 0 0 6px;
  font-size: 24px;
}

.sub {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--muted);
}

.controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.url-input {
  flex: 1;
  min-width: 260px;
  padding: 8px 12px;
  font-size: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
}

.url-input:focus {
  outline: none;
  border-color: var(--accent);
}

.tool-error {
  color: #ff9d9d;
  font-size: 13px;
  margin: 4px 0;
}

.tool-status {
  color: var(--muted);
  font-size: 12px;
  margin: 4px 0 12px;
}

.scene {
  height: 560px;
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  background:
    radial-gradient(120% 120% at 50% 20%, color-mix(in srgb, var(--accent) 10%, var(--panel)) 0%, var(--panel) 70%);
  position: relative;
  cursor: pointer;
}

.scene canvas {
  display: block;
  width: 100%;
  height: 100%;
}

@media (max-width: 860px) {
  .scene {
    height: 420px;
  }
}
</style>
