<script setup>
// 二维码生成（/tools/qr-tree）：输入 URL / 文本，生成一棵 3D 二维码樱花体素树。
// 效果参考：https://recent.design/i/3driga1-animated-qr-code-morphing
// 纯前端 three.js：
//  - 树底下是「嫩绿色二维码草坪」——只含二维码本身内容的 3D 方块，无静区/无外框；
//  - 3D 视角为 45° 俯视、正面朝向二维码的角；点击场景在「3D 树」与「俯视草坪」间
//    平滑过渡（俯视时体素收回地面，只留干净草坪，不出现黑白二维码/压平层）；
//  - 更新字符串时不做过渡动画，直接替换成新渲染好的树。
import { onMounted, onUnmounted, ref, watch } from 'vue'
import * as THREE from 'three'
import QRCode from 'qrcode-generator'
import AppIcon from '../components/AppIcon.vue'

const url = ref('https://anihub.xin')
const error = ref('')
const status = ref('')
const view = ref('3d') // '3d' | 'top'
const busy = ref(false) // 正在播放过渡动画

/* —— 尺寸（世界单位） —— */
const MODULE = 0.42 // 二维码模块边长（草坪方块）
const LAWN_H = 0.16 // 草坪方块厚度
const VOX = 0.34 // 体素间距
const VOX_SIZE = VOX * 0.9 // 体素方块边长（留缝，保持体素感）
const TRUNK_R = 0.36 // 树干半径：细
const TRUNK_H = 3.4 // 树干高度：不过短（= 10 个体素层，保证层位对齐）
const CANOPY_R = 3.0 // 树冠半径：大
const CROWN_H = 3.9 // 树冠高度：大
const ROOT_R = TRUNK_R * 1.9 // 根部微鼓半径
const ROOT_H = 1.02 // 根部微鼓高度

/* —— 配色 —— */
const TRUNK_COLORS = [0x7a5547, 0x6d4c41, 0x5d4037, 0x8d6e63]
const ROOT_COLORS = [0x5d4037, 0x4e342e]
// 樱花粉：CANOPY_COLORS[0] 最浅（顶部/外缘）→ 末尾最深（底部/内芯）
const CANOPY_COLORS = [0xffdde8, 0xffc3d7, 0xfba6c9, 0xf58cba, 0xee75a9]
const PETAL_TIP = 0xfff4f8 // 花瓣亮色点缀
const LAWN_LIGHT = 0xb7f0c3 // 二维码浅色模块 → 嫩绿
const LAWN_DARK = 0x2c9e55 // 二维码深色模块 → 深草绿

/* —— 相机：3D = 45° 俯视、草坪一个角正对前方；俯视 = 垂直看草坪 —— */
const CAM_YAW = (Math.PI * 3) / 4 // 前左角对向相机（与俯视切换时旋转最小的一组角之一）
const CAM_PITCH = Math.PI / 4 // 45° 俯视
const CAM_R = 15
const VIEW_TARGET_Y = 3.2 // 3D 视角注视高度（树冠中下部）
const TOP_POS = new THREE.Vector3(0, 17.5, 0.02)
const TOP_LOOK = new THREE.Vector3(0, 0, 0)

/* —— 场景对象 —— */
const mount = ref(null)
let renderer = null
let scene = null
let camera = null
let world = null // 草坪 + 树整体
let lawnMesh = null
let treeMesh = null
let voxels = [] // { x, z, j, l, color }
let rafId = 0
let lastTs = 0
let disposed = false
let animating = false
let debounceTimer = null
let lastGenerated = ''

// 当前展示内容（用于重建 / 度量取景）
let qr = null // qrcode-generator 实例
let qrN = 0 // 二维码内容模块数（不含静区）
let lawnHalf = 0 // 草坪半宽（世界）
let treeTop = 0 // 树冠顶点高度（世界）
let treeLayers = 1 // 整树总层数（供“从地面逐层长高”动画）
let frustNeededV = 0 // 两种视角下内容所需的视锥半高/半宽
let frustNeededH = 0

// 变形进度：1 = 3D 树，0 = 俯视草坪（体素收回地面）
let morphT = 1
let morphTarget = 1

const _dummy = new THREE.Object3D()
const _color = new THREE.Color()
const _corner = new THREE.Vector3()
const _look = new THREE.Vector3()
const _camPos = new THREE.Vector3()
const _cam3dPos = new THREE.Vector3()
const _cam3dLook = new THREE.Vector3()

/* —— 工具 —— */
function hashText(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
function pickColor(rng, palette, sat = 0.07, lit = 0.06) {
  const c = new THREE.Color(palette[Math.floor(rng() * palette.length)])
  c.offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * sat, (rng() - 0.5) * lit)
  return c
}

/* —— 场景初始化 —— */
function initScene() {
  const el = mount.value
  if (!el) {
    error.value = 'WebGL 初始化失败：场景挂载点不存在'
    return false
  }
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(el.clientWidth || 720, el.clientHeight || 480)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // ACES 电影级色调映射：高光柔和不溢出，樱花粉色更通透
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    el.appendChild(renderer.domElement)
  } catch (e) {
    error.value = `WebGL 初始化失败：${e?.message || e}`
    return false
  }

  scene = new THREE.Scene()
  world = new THREE.Group()
  scene.add(world)

  const aspect = (el.clientWidth || 720) / (el.clientHeight || 480)
  camera = new THREE.OrthographicCamera(-10 * aspect, 10 * aspect, 10, -10, 0.1, 90)

  // 灯光：柔和环境 + 暖色主光（带投影）+ 冷色补光
  scene.add(new THREE.AmbientLight(0xffffff, 0.3))
  const hemi = new THREE.HemisphereLight(0xfff2ea, 0x90c9a0, 0.62)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xfff1e0, 1.7)
  key.position.set(9, 16, 7)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.45
  key.shadow.camera.near = 1
  key.shadow.camera.far = 48
  key.target.position.set(0, 3, 0)
  scene.add(key, key.target)
  const fill = new THREE.DirectionalLight(0xd8e5ff, 0.45)
  fill.position.set(-8, 5, -8)
  scene.add(fill)
  return true
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

function clearContent() {
  if (lawnMesh) {
    disposeObject3D(lawnMesh)
    world.remove(lawnMesh)
    lawnMesh = null
  }
  if (treeMesh) {
    disposeObject3D(treeMesh)
    world.remove(treeMesh)
    treeMesh = null
  }
  voxels = []
}

/* —— 二维码矩阵 —— */
function buildMatrix(text) {
  qr = QRCode(0, 'M')
  qr.addData(text)
  qr.make()
  qrN = qr.getModuleCount()
}

// 世界坐标 (x, z) 对应二维码模块是否深色（树冠轮廓轻微呼应二维码图案）
function moduleDarkAt(x, z) {
  const c = Math.round(x / MODULE + (qrN - 1) / 2)
  const r = Math.round(z / MODULE + (qrN - 1) / 2)
  if (r < 0 || r >= qrN || c < 0 || c >= qrN) return false
  return qr.isDark(r, c)
}

/* —— 嫩绿色二维码草坪：3D 方块，只含二维码内容（无静区/外框） —— */
function buildLawn() {
  const count = qrN * qrN
  const geo = new THREE.BoxGeometry(MODULE * 0.86, LAWN_H, MODULE * 0.86)
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.receiveShadow = true
  mesh.frustumCulled = false

  const m4 = new THREE.Matrix4()
  const col = new THREE.Color()
  for (let r = 0; r < qrN; r++) {
    for (let c = 0; c < qrN; c++) {
      const dark = qr.isDark(r, c)
      const x = (c - (qrN - 1) / 2) * MODULE
      const z = (r - (qrN - 1) / 2) * MODULE
      // 深色模块略隆起，让二维码在 3D 视角下也有清晰可读的凹凸
      const lift = dark ? 0.055 : 0.015
      m4.makeTranslation(x, -LAWN_H / 2 + lift, z)
      const idx = r * qrN + c
      mesh.setMatrixAt(idx, m4)
      col.set(dark ? LAWN_DARK : LAWN_LIGHT)
      // 每块草皮轻微色差，避免呆板纯色网格
      col.offsetHSL((Math.random() - 0.5) * 0.015, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.055)
      mesh.setColorAt(idx, col)
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  lawnMesh = mesh
  world.add(mesh)
}

/* —— 樱花体素树 —— */
// 每列体素按「段」填色：树干段 / 根部段 / 树冠段；生长动画按整树逐层从地面长高。
function buildTree(text) {
  const rng = mulberry32(hashText(text))
  const GR = Math.ceil((CANOPY_R + VOX) / VOX)

  for (let gz = -GR; gz <= GR; gz++) {
    for (let gx = -GR; gx <= GR; gx++) {
      const x = gx * VOX
      const z = gz * VOX
      const r = Math.hypot(x, z)
      if (r > Math.max(ROOT_R, CANOPY_R)) continue

      // 该列覆盖范围：树干 / 根部微鼓 / 树冠
      const isTrunkCol = r <= TRUNK_R
      const inCanopy = r <= CANOPY_R
      const inRoot = r > TRUNK_R && r <= ROOT_R

      // 树冠轮廓最高点（世界 Y）：底部平、中部饱满的云团状，
      // QR 深色模块的枝条略高，整体带随机云团起伏
      let canopyTop = 0
      if (inCanopy) {
        const u = Math.min(1, r / CANOPY_R)
        const prof = Math.pow(1 - Math.pow(u, 1.5), 0.6)
        const ang = Math.atan2(z, x)
        const lump = clamp(1 + 0.14 * Math.sin(ang * 4 + 1.3) + (rng() - 0.5) * 0.3, 0.72, 1.32)
        const darkF = moduleDarkAt(x, z) ? 1 : 0.955 // QR 深色模块枝条略高
        canopyTop = TRUNK_H + CROWN_H * prof * lump * darkF
      }
      if (!isTrunkCol && !inCanopy && !inRoot) continue
      const colTop = inCanopy ? canopyTop : ROOT_H
      if (colTop <= VOX * 0.25) continue

      // 推入一段体素：y0..y1（世界 Y），颜色按段类型取值
      const pushSeg = (y0, y1, segKind) => {
        let j = 0
        while (true) {
          const yc = y0 + (j + 0.5) * VOX
          if (yc > y1 + VOX * 0.001 || yc > colTop + VOX * 0.001) break
          // 树冠外缘留少量透气孔，模拟花团间隙
          if (segKind === 'canopy' && r > CANOPY_R * 0.5 && yc > TRUNK_H + VOX * 1.2 && rng() < 0.03) {
            j++
            continue
          }
          let color
          if (segKind === 'root') {
            color = pickColor(rng, ROOT_COLORS, 0.04, 0.05)
          } else if (segKind === 'trunk') {
            color = pickColor(rng, TRUNK_COLORS, 0.04, 0.05)
          } else {
            // 树冠：下深上浅、内深外浅，边缘点缀花瓣亮色
            const t = clamp((yc - TRUNK_H) / CROWN_H, 0, 1)
            const uu = clamp(r / CANOPY_R, 0, 1)
            if (rng() < 0.1 && t > 0.2 && uu > 0.4) {
              color = new THREE.Color(PETAL_TIP)
              color.offsetHSL(0, 0, (rng() - 0.5) * 0.02)
            } else {
              const idx = clamp(
                Math.round(2.0 * (1 - t) + 0.8 * (1 - uu) + (rng() - 0.5) * 1.2),
                0,
                CANOPY_COLORS.length - 1
              )
              color = new THREE.Color(CANOPY_COLORS[idx])
              color.offsetHSL((rng() - 0.5) * 0.02, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.06)
            }
          }
          voxels.push({ x, z, j: Math.round(yc / VOX - 0.5), color: color.getHex() })
          j++
        }
      }

      if (isTrunkCol) {
        pushSeg(0, Math.min(TRUNK_H, canopyTop), 'trunk') // 树干段
        if (canopyTop > TRUNK_H + VOX * 0.25) pushSeg(TRUNK_H, canopyTop, 'canopy') // 树冠段
      } else if (inCanopy) {
        if (canopyTop > TRUNK_H + VOX * 0.25) pushSeg(TRUNK_H, canopyTop, 'canopy')
        if (inRoot) pushSeg(0, ROOT_H, 'root') // 树干底部的微鼓树根
      } else {
        pushSeg(0, ROOT_H, 'root')
      }
    }
  }

  if (!voxels.length) return
  const geo = new THREE.BoxGeometry(VOX_SIZE, VOX_SIZE, VOX_SIZE)
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.58, metalness: 0.04 })
  treeMesh = new THREE.InstancedMesh(geo, mat, voxels.length)
  treeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  treeMesh.castShadow = true
  treeMesh.frustumCulled = false
  for (let i = 0; i < voxels.length; i++) {
    treeMesh.setColorAt(i, _color.set(voxels[i].color))
  }
  if (treeMesh.instanceColor) treeMesh.instanceColor.needsUpdate = true
  world.add(treeMesh)
}

/* —— 更新体素矩阵（m: 1 = 树形，0 = 收回地面） —— */
function updateVoxels(m) {
  if (!treeMesh) return
  const e = easeInOutCubic(clamp(m, 0, 1))
  for (let i = 0; i < voxels.length; i++) {
    const v = voxels[i]
    // 整树从地面逐层长高：第 j 层体素约在 e = j / treeLayers 时出现，
    // 在其层位窗口内从地面升到最终高度、由细变粗（树干先出、树冠随后，不会悬浮）
    const q = clamp(e * treeLayers - v.j, 0, 1)
    if (q <= 0.004) {
      _dummy.position.set(v.x, 0, v.z)
      _dummy.scale.set(0.001, 0.001, 0.001)
    } else {
      _dummy.position.set(v.x, (v.j + 0.5) * VOX * q, v.z)
      _dummy.scale.set(q < 1 ? 0.6 + 0.4 * q : 1, q, q < 1 ? 0.6 + 0.4 * q : 1)
    }
    _dummy.rotation.set(0, 0, 0)
    _dummy.updateMatrix()
    treeMesh.setMatrixAt(i, _dummy.matrix)
  }
  treeMesh.instanceMatrix.needsUpdate = true
}

function snapVoxels() {
  if (treeMesh) updateVoxels(morphT)
}

/* —— 相机 —— */
function get3DPose() {
  const ce = Math.cos(CAM_PITCH)
  _cam3dPos.set(Math.cos(CAM_YAW) * ce * CAM_R, Math.sin(CAM_PITCH) * CAM_R, Math.sin(CAM_YAW) * ce * CAM_R)
  _cam3dPos.y += VIEW_TARGET_Y
  _cam3dLook.set(0, VIEW_TARGET_Y, 0)
  return { pos: _cam3dPos, look: _cam3dLook }
}

function updateCamera(m) {
  if (!camera) return
  const e = easeInOutCubic(clamp(m, 0, 1))
  const p3 = get3DPose()
  _camPos.lerpVectors(TOP_POS, p3.pos, e)
  _look.lerpVectors(TOP_LOOK, p3.look, e)
  camera.position.copy(_camPos)
  camera.lookAt(_look)
}

// 测量某相机姿态下内容包围盒所需的屏幕半宽/半高（世界单位）
function measurePose(pos, look) {
  camera.position.copy(pos)
  camera.lookAt(look)
  camera.updateMatrixWorld(true)
  const inv = camera.matrixWorldInverse
  let vh = 0
  let hh = 0
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      for (const y of [0, treeTop]) {
        _corner.set(sx * lawnHalf, y, sz * lawnHalf).applyMatrix4(inv)
        vh = Math.max(vh, Math.abs(_corner.y))
        hh = Math.max(hh, Math.abs(_corner.x))
      }
    }
  }
  return { vh, hh }
}

function applyFrustum(aspect, needV, needH) {
  if (!camera) return
  const halfV = Math.max(needV, needH / aspect) * 1.1
  camera.left = -halfV * aspect
  camera.right = halfV * aspect
  camera.top = halfV
  camera.bottom = -halfV
  camera.updateProjectionMatrix()
}

function fitFrustum() {
  const el = mount.value
  if (!el || !camera) return
  const aspect = (el.clientWidth || 720) / (el.clientHeight || 480)
  const p3 = get3DPose()
  const a = measurePose(p3.pos, p3.look)
  const b = measurePose(TOP_POS, TOP_LOOK)
  frustNeededV = Math.max(a.vh, b.vh)
  frustNeededH = Math.max(a.hh, b.hh)
  applyFrustum(aspect, frustNeededV, frustNeededH)
}

function resizeShadowCamera() {
  const key = scene?.children.find((o) => o.isDirectionalLight && o.castShadow)
  if (!key) return
  const cover = Math.max(lawnHalf, CANOPY_R + 1) + 0.8
  key.shadow.camera.left = -cover
  key.shadow.camera.right = cover
  key.shadow.camera.top = cover
  key.shadow.camera.bottom = -cover
  key.shadow.camera.updateProjectionMatrix()
}

/* —— 生成 / 更新 —— */
function rebuildScene(text) {
  clearContent()
  buildMatrix(text)
  lawnHalf = (qrN * MODULE) / 2
  treeTop = TRUNK_H + CROWN_H * 1.32 + VOX // 树冠顶点（含随机云团余量）+ 层余量
  treeLayers = Math.max(1, Math.floor(treeTop / VOX) + 1)
  buildLawn()
  buildTree(text)
  fitFrustum()
  resizeShadowCamera()
}

function generate() {
  const text = url.value.trim()
  if (!text) {
    error.value = '请先输入要编码的 URL 或文本'
    return
  }
  try {
    error.value = ''
    status.value = `正在生成「${text.slice(0, 24)}${text.length > 24 ? '…' : ''}」的二维码樱花树…`
    rebuildScene(text)
  } catch (e) {
    error.value = `生成失败：${e?.message || e}` // 内容超出 QR 容量等情况
    status.value = ''
    return
  }
  lastGenerated = text
  // 更新字符串：不做过渡动画，直接展示新生成的 3D 树
  morphT = 1
  morphTarget = 1
  view.value = '3d'
  busy.value = false
  snapVoxels()
  updateCamera(1)
  status.value = '完成：已生成 3D 樱花二维码树。点击画面可切换俯视草坪 / 3D。'
}

function toggleView() {
  if (animating) return
  if (view.value === '3d') {
    view.value = 'top'
    morphTarget = 0
    busy.value = true
    status.value = '正在收拢花树，露出二维码草坪…'
  } else {
    view.value = '3d'
    morphTarget = 1
    busy.value = true
    status.value = '正在让二维码草坪长成樱花树…'
  }
}

/* —— 动画循环 —— */
function tick(ts) {
  if (disposed) return
  rafId = requestAnimationFrame(tick)
  if (!lastTs) lastTs = ts
  const dt = Math.min(0.05, (ts - lastTs) / 1000)
  lastTs = ts

  const diff = morphTarget - morphT
  if (Math.abs(diff) > 0.0006) {
    animating = true
    // 帧率无关的指数趋近，约 1.2s 完成
    morphT += diff * (1 - Math.exp(-dt * 3.1))
    updateVoxels(morphT)
    updateCamera(morphT)
  } else {
    if (animating) {
      animating = false
      busy.value = false
      morphT = morphTarget
      snapVoxels()
      updateCamera(morphT)
      status.value =
        morphTarget === 1
          ? '完成：已生成 3D 樱花二维码树。点击画面可切换俯视草坪 / 3D。'
          : '俯视：二维码草坪可直接扫码，无多余边距。点击画面回到 3D 树。'
    }
  }
  renderer.render(scene, camera)
}

/* —— 窗口缩放 —— */
function resize() {
  const el = mount.value
  if (!renderer || !camera || !el) return
  const w = el.clientWidth || 720
  const h = el.clientHeight || 480
  renderer.setSize(w, h)
  applyFrustum(w / h, frustNeededV || 8, frustNeededH || 8)
}

watch(url, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const text = url.value.trim()
    if (text && text !== lastGenerated) generate()
  }, 320)
})

/* —— 生命周期 —— */
onMounted(() => {
  if (!initScene()) return
  window.addEventListener('resize', resize)
  const initText = url.value.trim() || 'https://anihub.xin'
  try {
    rebuildScene(initText)
    lastGenerated = initText
    snapVoxels()
    updateCamera(1)
    status.value = '完成：已生成 3D 樱花二维码树。点击画面可切换俯视草坪 / 3D。'
  } catch (e) {
    error.value = `生成失败：${e?.message || e}`
  }
  lastTs = 0
  rafId = requestAnimationFrame(tick)
})

onUnmounted(() => {
  disposed = true
  clearTimeout(debounceTimer)
  cancelAnimationFrame(rafId)
  window.removeEventListener('resize', resize)
  if (world && lawnMesh) {
    world.remove(lawnMesh)
  }
  if (world && treeMesh) {
    world.remove(treeMesh)
  }
  clearContent()
  renderer?.dispose()
  if (mount.value) mount.value.innerHTML = ''
})
</script>

<template>
  <div class="tool-page">
    <router-link to="/tools" class="back-link"><AppIcon name="arrow-left" :size="13" /> 返回工具箱</router-link>
    <h1 class="page-title"><AppIcon name="tree" :size="21" /> 二维码生成</h1>
    <p class="sub">
      输入 URL / 文本，生成一棵 <strong>3D 樱花二维码体素树</strong>；树下的嫩绿色草坪就是二维码本身（无静区边距）。<strong>点击画面</strong>可在 3D 树与俯视草坪间平滑切换。纯前端处理，内容不会上传。
    </p>

    <div class="controls">
      <input
        v-model="url"
        class="url-input"
        type="text"
        spellcheck="false"
        placeholder="输入 URL 或任意文本，例如 https://example.com"
        @keydown.enter="generate()"
      />
      <button class="btn btn-primary" @click="generate()">重新生成</button>
    </div>

    <p v-if="error" class="tool-error">{{ error }}</p>
    <p v-if="status && !error" class="tool-status">{{ status }}</p>

    <div
      ref="mount"
      class="scene"
      :class="{ top: view === 'top' }"
      role="button"
      tabindex="0"
      :title="view === '3d' ? '点击切换为俯视草坪' : '点击回到 3D 树'"
      @click="toggleView"
      @keydown.enter="toggleView"
      @keydown.space.prevent="toggleView"
    >
      <span class="view-pill" aria-hidden="true">
        <AppIcon :name="view === '3d' ? 'tree' : 'qrcode'" :size="13" />
        {{ view === '3d' ? '3D 树' : '俯视草坪' }}
      </span>
      <span v-if="busy" class="view-pill hint" aria-hidden="true">
        {{ morphTarget === 1 ? '生长中…' : '收拢中…' }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.tool-page {
  max-width: min(1160px, 95vw);
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--muted);
  text-decoration: none;
}

.back-link:hover {
  color: var(--accent);
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-size: 24px;
}

.sub {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.7;
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
  transition:
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.url-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
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
    radial-gradient(120% 130% at 50% 18%, color-mix(in srgb, var(--accent) 12%, var(--panel)) 0%, var(--panel) 72%);
  position: relative;
  cursor: pointer;
  outline: none;
  transition: border-color var(--dur-ios-2) var(--ease-ios-expo);
}

.scene:hover {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.scene:focus-visible {
  border-color: var(--accent);
}

.scene canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.view-pill {
  position: absolute;
  right: 12px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font-size: 12px;
  line-height: 1;
  color: var(--text);
  background: color-mix(in srgb, var(--panel) 74%, transparent);
  border: 1px solid var(--border);
  border-radius: 999px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  pointer-events: none;
  user-select: none;
}

.view-pill.hint {
  right: 12px;
  bottom: 40px;
  color: var(--muted);
  border-style: dashed;
}

@media (max-width: 860px) {
  .scene {
    height: 420px;
  }
}
</style>
