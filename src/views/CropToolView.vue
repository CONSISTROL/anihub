<script setup>
// 图片裁切：上传版图（精灵图/多格图），拖动网格线划分格子，裁切成一张张小图。
// 纯前端处理：图片不上传；支持点击/拖拽/Ctrl+V 粘贴图片。
import { nextTick, ref } from 'vue'
import JSZip from 'jszip'

const MAX_CROP = 400 // 单次裁切结果上限，防止误操作卡死

const fileInput = ref(null)
const stage = ref(null) // 图片容器（网格线定位基准）
const imgSrc = ref('')
const imgEl = ref(null) // <img> 元素（取自然尺寸）
const vLines = ref([]) // [{ id, pos }] 竖直切割线（0..1 比例）
const hLines = ref([]) // [{ id, pos }] 水平切割线
const crops = ref([]) // [{ dataUrl, w, h }]
const busy = ref(false)
const error = ref('')
const zipBusy = ref(false)
let idSeq = 1

const clamp = (v, min = 0.01, max = 0.99) => Math.min(max, Math.max(min, v))

function sortLines() {
  vLines.value = [...vLines.value].sort((a, b) => a.pos - b.pos)
  hLines.value = [...hLines.value].sort((a, b) => a.pos - b.pos)
}

// 在最大间隔的中点加一条线（lines 为模板中解包后的数组）
function addLine(lines) {
  const sorted = [...lines].sort((a, b) => a.pos - b.pos)
  let best = 0.5
  let maxGap = -1
  let prev = 0
  for (const l of sorted) {
    const gap = l.pos - prev
    if (gap > maxGap) {
      maxGap = gap
      best = prev + gap / 2
    }
    prev = l.pos
  }
  const lastGap = 1 - prev
  if (lastGap > maxGap) best = prev + lastGap / 2
  lines.push({ id: idSeq++, pos: clamp(best) })
  sortLines()
  detectedBoxes.value = []
}

// 等分预设：切成 cols×rows 格（切割线数 = cols-1 / rows-1）
function preset(cols, rows = cols) {
  vLines.value = Array.from({ length: Math.max(0, cols - 1) }, (_, i) => ({
    id: idSeq++,
    pos: (i + 1) / cols,
  }))
  hLines.value = Array.from({ length: Math.max(0, rows - 1) }, (_, i) => ({
    id: idSeq++,
    pos: (i + 1) / rows,
  }))
  detectedBoxes.value = []
}

// 自定义等分：列 × 行
const customCols = ref(2)
const customRows = ref(2)
function presetCustom() {
  const c = Math.min(30, Math.max(1, Math.round(Number(customCols.value) || 1)))
  const r = Math.min(30, Math.max(1, Math.round(Number(customRows.value) || 1)))
  customCols.value = c
  customRows.value = r
  preset(c, r)
}

function clearGrid() {
  vLines.value = []
  hLines.value = []
  detectedBoxes.value = []
}

function removeLine(lines, id) {
  const i = lines.findIndex((l) => l.id === id)
  if (i >= 0) lines.splice(i, 1)
  detectedBoxes.value = []
}

// 移除最近添加的一条线（id 单调递增，取最大 id）
function removeLastLine(lines) {
  if (!lines.length) return
  const last = [...lines].reduce((a, b) => (a.id > b.id ? a : b))
  removeLine(lines, last.id)
}

/* —— 自动识别框 —— */
const detecting = ref(false)
const detectedBoxes = ref([]) // [{ x, y, w, h }] 自然像素坐标
const ignoreFrames = ref(true) // 忽略空心装饰框（虚线框/实线框）

// 从图片边缘采样最可能的主背景色（16 级量化取众数）
function sampleBackground(data, w, h) {
  const hist = new Map()
  const step = Math.max(1, Math.floor(Math.min(w, h) / 200))
  const points = []
  for (let x = 0; x < w; x += step) {
    points.push([x, 0], [x, h - 1])
  }
  for (let y = 0; y < h; y += step) {
    points.push([0, y], [w - 1, y])
  }
  for (const [x, y] of points) {
    const i = (y * w + x) * 4
    if (data[i + 3] < 20) continue
    const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`
    hist.set(key, (hist.get(key) || 0) + 1)
  }
  let bestKey = null
  let bestCount = 0
  for (const [k, c] of hist) {
    if (c > bestCount) {
      bestCount = c
      bestKey = k
    }
  }
  if (bestKey) {
    const [r, g, b] = bestKey.split(',').map(Number)
    return [r << 4, g << 4, b << 4]
  }
  return [255, 255, 255]
}

// 生成前景 mask：非背景且不透明像素为 1
function buildMask(data, w, h, bg) {
  const mask = new Uint8Array(w * h)
  const threshold = 40
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]
    if (a < 20) {
      mask[i] = 0
      continue
    }
    const dr = data[i * 4] - bg[0]
    const dg = data[i * 4 + 1] - bg[1]
    const db = data[i * 4 + 2] - bg[2]
    mask[i] = Math.sqrt(dr * dr + dg * dg + db * db) > threshold ? 1 : 0
  }
  return mask
}

// 连通域分析：返回每个前景连通块的外接框
function connectedComponentBoxes(mask, w, h) {
  const labels = new Int32Array(w * h)
  const queue = new Int32Array(w * h)
  const boxes = []
  const minArea = Math.max(20, Math.floor(w * h * 0.0002))

  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue
    let head = 0
    let tail = 0
    queue[tail++] = start
    labels[start] = 1
    let minX = w
    let minY = h
    let maxX = 0
    let maxY = 0
    let area = 0

    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      const y = (p / w) | 0
      area++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y

      if (x > 0) {
        const q = p - 1
        if (mask[q] && !labels[q]) { labels[q] = 1; queue[tail++] = q }
      }
      if (x < w - 1) {
        const q = p + 1
        if (mask[q] && !labels[q]) { labels[q] = 1; queue[tail++] = q }
      }
      if (y > 0) {
        const q = p - w
        if (mask[q] && !labels[q]) { labels[q] = 1; queue[tail++] = q }
      }
      if (y < h - 1) {
        const q = p + w
        if (mask[q] && !labels[q]) { labels[q] = 1; queue[tail++] = q }
      }
    }

    if (area >= minArea && maxX - minX + 1 >= 4 && maxY - minY + 1 >= 4) {
      boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area })
    }
  }
  return boxes
}

// 判断一个前景块是否为「空心装饰框」（虚线框/实线框）：沿四边外沿测量边框厚度，
// 若厚度远小于盒子尺寸（≤ max(4, 15% 短边)）→ 是环状装饰框（图标描边、示意图框），不是裁切目标；
// 实心内容块的「边」贯穿整个块，厚度≈盒子尺寸，不会被误判。
function isHollowFrame(mask, w, h, box) {
  const bw = box.w
  const bh = box.h
  if (bw < 12 || bh < 12) return false
  // 测量边框厚度：沿四条边的外沿均匀取点，从外沿向内数连续前景，取非零值的中位数
  const ts = []
  const xs = []
  const stepX = Math.max(1, Math.floor(bw / 30))
  for (let px = box.x; px < box.x + bw; px += stepX) xs.push(px)
  const ys = []
  const stepY = Math.max(1, Math.floor(bh / 30))
  for (let py = box.y; py < box.y + bh; py += stepY) ys.push(py)
  // 上边（向下数）
  for (const px of xs) {
    let t = 0
    for (let k = 0; k < bh; k++) {
      if (mask[(box.y + k) * w + px]) t++
      else break
    }
    if (t > 0) ts.push(t)
  }
  // 下边（向上数）
  for (const px of xs) {
    let t = 0
    for (let k = 0; k < bh; k++) {
      if (mask[(box.y + bh - 1 - k) * w + px]) t++
      else break
    }
    if (t > 0) ts.push(t)
  }
  // 左边（向右数）
  for (const py of ys) {
    let t = 0
    for (let k = 0; k < bw; k++) {
      if (mask[py * w + box.x + k]) t++
      else break
    }
    if (t > 0) ts.push(t)
  }
  // 右边（向左数）
  for (const py of ys) {
    let t = 0
    for (let k = 0; k < bw; k++) {
      if (mask[py * w + box.x + bw - 1 - k]) t++
      else break
    }
    if (t > 0) ts.push(t)
  }
  if (!ts.length) return false
  const sorted = [...ts].sort((a, b) => a - b)
  const t = sorted[Math.floor(sorted.length / 2)]
  if (t < 1) return false
  return t <= Math.max(4, Math.floor(Math.min(bw, bh) * 0.15))
}

// 合并嵌套框：实心大块保留并吞掉内部小块；空心装饰框跳过（其内部的内容块自然保留）。
function mergeNestedBoxes(mask, w, h, boxes) {
  const sorted = [...boxes].sort((a, b) => b.area - a.area)
  const result = []
  const contains = (outer, inner) =>
    inner.x >= outer.x - 2 &&
    inner.y >= outer.y - 2 &&
    inner.x + inner.w <= outer.x + outer.w + 2 &&
    inner.y + inner.h <= outer.y + outer.h + 2

  for (const b of sorted) {
    if (isHollowFrame(mask, w, h, b)) continue // 装饰框不是裁切目标
    if (result.some((r) => contains(r, b))) continue
    result.push(b)
  }
  return result.sort((a, b) => a.y - b.y || a.x - b.x)
}

// 旧行为：外框完整包住内部小块时只保留外框（不忽略装饰框）
function mergeNestedBoxesKeepFrames(boxes) {
  const sorted = [...boxes].sort((a, b) => b.area - a.area)
  const result = []
  const contains = (outer, inner) =>
    inner.x >= outer.x - 2 &&
    inner.y >= outer.y - 2 &&
    inner.x + inner.w <= outer.x + outer.w + 2 &&
    inner.y + inner.h <= outer.y + outer.h + 2

  for (const b of sorted) {
    if (result.some((r) => contains(r, b))) continue
    result.push(b)
  }
  return result.sort((a, b) => a.y - b.y || a.x - b.x)
}

// 采样线带内的颜色种类（16 级量化）：分隔线颜色单一（≤3 种），内容区域颜色多样。
// 用于排除「覆盖全高的内容列/行」被误判为分隔线。axis: 'v' 竖线带 | 'h' 横线带
function sampleBandColors(data, mask, w, h, axis, start, end) {
  const colors = new Set()
  const major = axis === 'v' ? h : w
  const step = Math.max(1, Math.floor(major / 50))
  let sampled = 0
  for (let i = start; i <= end && sampled < 6000; i++) {
    for (let j = 0; j < major; j += step) {
      const x = axis === 'v' ? i : j
      const y = axis === 'v' ? j : i
      const idx = y * w + x
      if (!mask[idx]) continue
      const k = idx * 4
      colors.add(`${data[k] >> 4},${data[k + 1] >> 4},${data[k + 2] >> 4}`)
      sampled++
      if (colors.size > 3) return false
    }
  }
  return colors.size <= 3
}

// 分隔线网格检测：前景列/行满足「跨度 ≥92% 图片尺寸」，且——
//  - 连续线：最大空隙 ≤3px（粗细均可）；
//  - 虚线：覆盖 ≥0.35、断点 ≥5、最大间隙 ≤ max(6px, 8% 跨度)——虚线分隔线也能识别。
// 取线带中心为切割线位置（0..1）。
// 排除装饰框干扰：跨度条件（装饰框边只覆盖局部）、空隙条件（多排装饰框堆叠的间隙大、断点少）。
// 支持不等分格子、粗细框线；贴边的外框线忽略。
function detectGridLines(data, mask, w, h) {
  // 每列/每行：前景数、首尾跨度、最大空隙、断点数
  const col = new Array(w)
  for (let x = 0; x < w; x++) {
    let count = 0
    let minY = -1
    let maxY = -1
    let prev = -1
    let maxGap = 0
    let gapCount = 0
    for (let y = 0; y < h; y++) {
      if (mask[y * w + x]) {
        count++
        if (minY < 0) minY = y
        maxY = y
        if (prev >= 0) {
          const g = y - prev - 1
          if (g > 0) gapCount++
          if (g > maxGap) maxGap = g
        }
        prev = y
      }
    }
    col[x] = { count, minY, maxY, maxGap, gapCount }
  }
  const row = new Array(h)
  for (let y = 0; y < h; y++) {
    let count = 0
    let minX = -1
    let maxX = -1
    let prev = -1
    let maxGap = 0
    let gapCount = 0
    const base = y * w
    for (let x = 0; x < w; x++) {
      if (mask[base + x]) {
        count++
        if (minX < 0) minX = x
        maxX = x
        if (prev >= 0) {
          const g = x - prev - 1
          if (g > 0) gapCount++
          if (g > maxGap) maxGap = g
        }
        prev = x
      }
    }
    row[y] = { count, minX, maxX, maxGap, gapCount }
  }
  const isVLine = (x) => {
    const c = col[x]
    if (c.minY < 0) return false
    const extent = c.maxY - c.minY + 1
    const cov = c.count / extent
    if (c.maxGap <= 3) return extent >= h * 0.92 && cov >= 0.5
    return extent >= h * 0.92 && cov >= 0.35 && c.gapCount >= 5 && c.maxGap <= Math.max(6, extent * 0.08)
  }
  const isHLine = (y) => {
    const r = row[y]
    if (r.minX < 0) return false
    const extent = r.maxX - r.minX + 1
    const cov = r.count / extent
    if (r.maxGap <= 3) return extent >= w * 0.92 && cov >= 0.5
    return extent >= w * 0.92 && cov >= 0.35 && r.gapCount >= 5 && r.maxGap <= Math.max(6, extent * 0.08)
  }
  const bands = (isLine, n, axis) => {
    const out = []
    let start = -1
    for (let i = 0; i <= n; i++) {
      const on = i < n && isLine(i)
      if (on && start < 0) start = i
      if (!on && start >= 0) {
        const end = i - 1
        // 贴边（图片外框线）忽略；颜色单一的线带才接受
        if (start > 1 && end < n - 2 && sampleBandColors(data, mask, w, h, axis, start, end)) {
          out.push((start + end) / 2 / n)
        }
        start = -1
      }
    }
    return out
  }
  return {
    vs: bands(isVLine, w, 'v').sort((a, b) => a - b),
    hs: bands(isHLine, h, 'h').sort((a, b) => a - b),
  }
}

// 自动识别：① 有分隔线 → 生成切割线网格（支持不等分 / 粗细线）；② 无分隔线 → 前景连通域逐块识别。
// 返回 'grid' | 'boxes' | 'none'
function detectBoxes() {
  const img = imgEl.value
  if (!img?.naturalWidth) return 'none'
  detecting.value = true
  error.value = ''
  detectedBoxes.value = []
  try {
    const natW = img.naturalWidth
    const natH = img.naturalHeight

    // 大图先降采样再检测，提升速度；比例坐标映射回原图
    const maxDim = 1024
    const scale = Math.min(1, maxDim / Math.max(natW, natH))
    const dw = Math.max(1, Math.round(natW * scale))
    const dh = Math.max(1, Math.round(natH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = dw
    canvas.height = dh
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, dw, dh)
    const data = ctx.getImageData(0, 0, dw, dh).data

    const bg = sampleBackground(data, dw, dh)
    const mask = buildMask(data, dw, dh, bg)

    // ① 分隔线网格
    const { vs, hs } = detectGridLines(data, mask, dw, dh)
    if (vs.length || hs.length) {
      vLines.value = vs.map((pos) => ({ id: idSeq++, pos: clamp(pos) }))
      hLines.value = hs.map((pos) => ({ id: idSeq++, pos: clamp(pos) }))
      return 'grid'
    }

    // ② 无分隔线：连通域逐块识别（不等分精灵图）；空心装饰框（虚线/实线框）按开关忽略
    const rawBoxes = connectedComponentBoxes(mask, dw, dh)
    const boxes = ignoreFrames.value
      ? mergeNestedBoxes(mask, dw, dh, rawBoxes)
      : mergeNestedBoxesKeepFrames(rawBoxes)
    if (!boxes.length) {
      error.value = '未识别到明显框，请手动调整网格线'
      return 'none'
    }
    detectedBoxes.value = boxes.map((b) => ({
      x: Math.round(b.x / scale),
      y: Math.round(b.y / scale),
      w: Math.round(b.w / scale),
      h: Math.round(b.h / scale),
    }))
    crops.value = []
    return 'boxes'
  } catch (e) {
    error.value = `识别失败：${e.message || e}`
    return 'none'
  } finally {
    detecting.value = false
  }
}

async function cropDetectedBoxes() {
  const img = imgEl.value
  if (!img?.naturalWidth) return
  if (!detectedBoxes.value.length) {
    error.value = '请先点击「识别框」'
    return
  }
  if (detectedBoxes.value.length > MAX_CROP) {
    error.value = `识别到 ${detectedBoxes.value.length} 个框，最多支持 ${MAX_CROP} 个`
    return
  }
  busy.value = true
  error.value = ''
  try {
    const natW = img.naturalWidth
    const natH = img.naturalHeight
    const out = []
    for (const b of detectedBoxes.value) {
      const x = Math.min(natW - 1, Math.max(0, Math.round(b.x)))
      const y = Math.min(natH - 1, Math.max(0, Math.round(b.y)))
      const w = Math.max(1, Math.min(natW - x, Math.round(b.w)))
      const h = Math.max(1, Math.min(natH - y, Math.round(b.h)))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h)
      out.push({ dataUrl: canvas.toDataURL('image/png'), w, h })
    }
    crops.value = out
  } catch (e) {
    error.value = `裁切失败：${e.message || e}`
  } finally {
    busy.value = false
  }
}

async function detectAndCrop() {
  const kind = detectBoxes()
  if (kind === 'grid') {
    await doCrop()
  } else if (kind === 'boxes') {
    await cropDetectedBoxes()
  }
}

// 识别框 overlay 样式（用图片自然尺寸换算百分比）
function detectBoxStyle(b) {
  const natW = imgEl.value?.naturalWidth || 1
  const natH = imgEl.value?.naturalHeight || 1
  return {
    left: (b.x / natW) * 100 + '%',
    top: (b.y / natH) * 100 + '%',
    width: (b.w / natW) * 100 + '%',
    height: (b.h / natH) * 100 + '%',
  }
}

/* —— 拖拽网格线 —— */
let drag = null // { axis: 'v' | 'h', id }

function onLinePointerDown(e, axis, id) {
  e.preventDefault()
  drag = { axis, id }
  e.currentTarget.setPointerCapture(e.pointerId)
}

function onLinePointerMove(e) {
  if (!drag) return
  const rect = stage.value?.getBoundingClientRect()
  if (!rect || !rect.width || !rect.height) return
  if (drag.axis === 'v') {
    const l = vLines.value.find((x) => x.id === drag.id)
    if (l) l.pos = clamp((e.clientX - rect.left) / rect.width)
  } else {
    const l = hLines.value.find((x) => x.id === drag.id)
    if (l) l.pos = clamp((e.clientY - rect.top) / rect.height)
  }
}

function onLinePointerUp() {
  drag = null
  sortLines()
}

/* —— 图片加载 —— */
function onFile(file) {
  if (!file) return
  if (!file.type.startsWith('image/')) {
    error.value = '请选择图片文件（png / jpg / webp 等）'
    return
  }
  error.value = ''
  crops.value = []
  const reader = new FileReader()
  reader.onload = () => {
    imgSrc.value = reader.result
    resetForNewImage()
  }
  reader.readAsDataURL(file)
}

function onPick(e) {
  onFile(e.target.files?.[0])
  e.target.value = ''
}

function onDrop(e) {
  onFile(e.dataTransfer?.files?.[0])
}

function onPaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        onFile(file)
        return
      }
    }
  }
}

function resetForNewImage() {
  // 默认 3×3 等分，方便直接调整
  vLines.value = Array.from({ length: 2 }, (_, i) => ({ id: idSeq++, pos: (i + 1) / 3 }))
  hLines.value = Array.from({ length: 2 }, (_, i) => ({ id: idSeq++, pos: (i + 1) / 3 }))
  crops.value = []
  detectedBoxes.value = []
}

/* —— 裁切 —— */
async function doCrop() {
  const img = imgEl.value
  if (!img?.naturalWidth) return
  busy.value = true
  error.value = ''
  try {
    const natW = img.naturalWidth
    const natH = img.naturalHeight
    const vs = [0, ...vLines.value.map((l) => l.pos), 1]
    const hs = [0, ...hLines.value.map((l) => l.pos), 1]
    const out = []
    // 允许等待浏览器渲染，避免大量 canvas 操作卡住交互
    for (let j = 0; j < hs.length - 1; j++) {
      for (let i = 0; i < vs.length - 1; i++) {
        const x = Math.round(vs[i] * natW)
        const w = Math.round(vs[i + 1] * natW) - x
        const y = Math.round(hs[j] * natH)
        const h = Math.round(hs[j + 1] * natH) - y
        if (w < 1 || h < 1) continue
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h)
        out.push({ dataUrl: canvas.toDataURL('image/png'), w, h })
      }
      if (j % 10 === 9) await nextTick()
    }
    if (out.length > MAX_CROP) {
      error.value = `网格过密（共 ${out.length} 格），最多支持 ${MAX_CROP} 格，请减少切割线`
      crops.value = []
      return
    }
    crops.value = out
  } catch (e) {
    error.value = `裁切失败：${e.message || e}`
  } finally {
    busy.value = false
  }
}

/* —— 下载 —— */
function base64ToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',')
  const mime = head.match(/data:(.*?);/)?.[1] || 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

function downloadOne(c, i) {
  const a = document.createElement('a')
  a.href = c.dataUrl
  a.download = `crop-${i + 1}-${c.w}x${c.h}.png`
  a.click()
}

async function downloadAll() {
  if (!crops.value.length) return
  zipBusy.value = true
  try {
    const zip = new JSZip()
    crops.value.forEach((c, i) => zip.file(`crop-${i + 1}-${c.w}x${c.h}.png`, base64ToBlob(c.dataUrl)))
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'crops.zip'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  } finally {
    zipBusy.value = false
  }
}

function clearAll() {
  imgSrc.value = ''
  imgEl.value = null
  vLines.value = []
  hLines.value = []
  crops.value = []
  detectedBoxes.value = []
  error.value = ''
}
</script>

<template>
  <div class="crop-tool">
    <router-link to="/tools" class="back-link">← 返回工具箱</router-link>
    <h1 class="page-title">✂️ 图片裁切</h1>
    <p class="sub">
      上传版图（多格图 / 精灵图），自动识别框线或拖动网格线划分格子，一键裁切成小图。
      自动识别支持<strong>不等分格子</strong>与<strong>粗细框线</strong>：有分隔线时生成切割线网格，
      无分隔线时按内容块识别（可忽略图中的虚线框/实线框装饰）。纯前端处理，图片不会上传。
    </p>

    <input ref="fileInput" type="file" accept="image/*" class="hidden-input" @change="onPick" />

    <!-- 未上传图片 -->
    <div
      v-if="!imgSrc"
      class="dropzone"
      tabindex="0"
      title="点击选择图片，或拖拽、Ctrl+V 粘贴"
      @click="fileInput.click()"
      @keydown.enter="fileInput.click()"
      @dragover.prevent
      @drop.prevent="onDrop"
      @paste="onPaste"
    >
      <span class="dz-icon">🖼️</span>
      <span class="dz-text">点击选择图片<br />或拖拽 / Ctrl+V 粘贴到此处</span>
    </div>

    <!-- 已上传：网格调整 + 裁切 -->
    <template v-else>
      <div class="controls">
        <div class="ctrl-group">
          <span class="ctrl-label">等分预设</span>
          <button class="btn btn-sm" @click="preset(2)">2×2</button>
          <button class="btn btn-sm" @click="preset(3)">3×3</button>
          <button class="btn btn-sm" @click="preset(4)">4×4</button>
          <button class="btn btn-sm" @click="preset(5)">5×5</button>
          <label class="custom-preset">
            <input v-model.number="customCols" type="number" min="1" max="30" title="列数" />
            ×
            <input v-model.number="customRows" type="number" min="1" max="30" title="行数" />
            <button class="btn btn-sm" type="button" @click="presetCustom">自定义</button>
          </label>
        </div>
        <div class="ctrl-group">
          <span class="ctrl-label">切割线</span>
          <button class="btn btn-sm" @click="addLine(vLines)">＋ 竖线</button>
          <button class="btn btn-sm" @click="addLine(hLines)">＋ 横线</button>
          <button class="btn btn-sm" :disabled="!vLines.length" @click="removeLastLine(vLines)">－ 竖线</button>
          <button class="btn btn-sm" :disabled="!hLines.length" @click="removeLastLine(hLines)">－ 横线</button>
          <button class="btn btn-sm" @click="clearGrid">清空网格</button>
        </div>
        <div class="ctrl-group">
          <span class="ctrl-label">自动识别</span>
          <button class="btn btn-sm" :disabled="detecting" @click="detectBoxes">
            {{ detecting ? '识别中…' : '🔍 识别框' }}
          </button>
          <button class="btn btn-sm" :disabled="detecting" @click="detectAndCrop">
            {{ detecting ? '识别中…' : '🔍 识别并裁切' }}
          </button>
          <label class="opt-label" title="版图中的虚线框/实线框（装饰框）不是裁切目标时开启">
            <input v-model="ignoreFrames" type="checkbox" />
            忽略装饰框
          </label>
        </div>
        <div class="ctrl-group">
          <button class="btn btn-sm btn-primary" :disabled="busy" @click="doCrop">
            {{ busy ? '裁切中…' : '✂️ 裁切' }}
          </button>
          <button class="btn btn-sm" @click="fileInput.click()">重新选择</button>
          <button class="btn btn-sm" @click="clearAll">清除图片</button>
        </div>
      </div>

      <p v-if="error" class="tool-error">{{ error }}</p>

      <div class="stage-wrap">
        <div ref="stage" class="stage">
          <img ref="imgEl" :src="imgSrc" alt="版图" class="stage-img" />
          <!-- 识别出的内容框（无分隔线时的连通域结果） -->
          <div
            v-for="(b, i) in detectedBoxes"
            :key="'d' + i"
            class="detect-box"
            :style="detectBoxStyle(b)"
            title="识别出的框"
          ></div>
          <!-- 竖直切割线 -->
          <div
            v-for="l in vLines"
            :key="l.id"
            class="line v"
            :style="{ left: l.pos * 100 + '%' }"
            title="拖动调整，点击 × 删除"
            @pointerdown="onLinePointerDown($event, 'v', l.id)"
            @pointermove="onLinePointerMove"
            @pointerup="onLinePointerUp"
            @pointercancel="onLinePointerUp"
          >
            <span class="line-bar"></span>
            <button class="line-x" @pointerdown.stop @click.stop="removeLine(vLines, l.id)">✕</button>
          </div>
          <!-- 水平切割线 -->
          <div
            v-for="l in hLines"
            :key="l.id"
            class="line h"
            :style="{ top: l.pos * 100 + '%' }"
            title="拖动调整，点击 × 删除"
            @pointerdown="onLinePointerDown($event, 'h', l.id)"
            @pointermove="onLinePointerMove"
            @pointerup="onLinePointerUp"
            @pointercancel="onLinePointerUp"
          >
            <span class="line-bar"></span>
            <button class="line-x" @pointerdown.stop @click.stop="removeLine(hLines, l.id)">✕</button>
          </div>
        </div>
      </div>

      <!-- 裁切结果 -->
      <div v-if="crops.length" class="results">
        <div class="results-head">
          <span class="results-label">裁切结果（{{ crops.length }} 张）</span>
          <button class="btn btn-sm btn-primary" :disabled="zipBusy" @click="downloadAll">
            {{ zipBusy ? '打包中…' : '⬇️ 全部下载 (zip)' }}
          </button>
        </div>
        <div class="crop-grid">
          <div v-for="(c, i) in crops" :key="i" class="crop-cell">
            <img :src="c.dataUrl" alt="" loading="lazy" />
            <span class="crop-meta">{{ c.w }}×{{ c.h }}</span>
            <button class="btn btn-sm" @click="downloadOne(c, i)">下载</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.crop-tool {
  max-width: min(1160px, 95vw); /* 高分辨率适配 */
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
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--muted);
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 240px;
  padding: 16px;
  border: 1.5px dashed var(--border);
  border-radius: 12px;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}

.dropzone:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.dropzone:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.dz-icon {
  font-size: 34px;
}

.dz-text {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
}

.hidden-input {
  display: none;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  margin-bottom: 12px;
}

.ctrl-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ctrl-label {
  font-size: 12px;
  color: var(--muted);
  margin-right: 2px;
}

.opt-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  margin-left: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  user-select: none;
}

.opt-label:hover {
  border-color: var(--accent);
}

.custom-preset {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  font-size: 12px;
  color: var(--muted);
}

.custom-preset input {
  width: 44px;
  padding: 3px 6px;
  font-size: 12px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
}

.custom-preset input:focus {
  border-color: var(--accent);
}

.btn-sm {
  padding: 3px 9px;
  font-size: 12px;
}

.tool-error {
  margin: 0 0 10px;
  font-size: 13px;
  color: #ff9d9d;
}

.stage-wrap {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  justify-content: center;
  overflow: auto;
}

.stage {
  position: relative;
  display: inline-block;
  max-width: 100%;
  user-select: none;
}

.stage-img {
  display: block;
  max-width: 100%;
  max-height: 68vh;
  height: auto;
  border-radius: 6px;
}

/* 自动识别出的内容框（无分隔线时的连通域结果） */
.detect-box {
  position: absolute;
  z-index: 4;
  border: 2px solid #22c55e;
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5), 0 0 6px rgba(34, 197, 94, 0.5);
  pointer-events: none;
}

/* 切割线：14px 的隐形热区，内含 2px 可见线 */
.line {
  position: absolute;
  z-index: 5;
}

.line.v {
  top: 0;
  bottom: 0;
  width: 14px;
  transform: translateX(-50%);
  cursor: ew-resize;
}

.line.h {
  left: 0;
  right: 0;
  height: 14px;
  transform: translateY(-50%);
  cursor: ns-resize;
}

.line-bar {
  position: absolute;
  background: var(--accent);
  opacity: 0.75;
}

.line.v .line-bar {
  left: 50%;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-50%);
}

.line.h .line-bar {
  top: 50%;
  left: 0;
  right: 0;
  height: 2px;
  transform: translateY(-50%);
}

.line-x {
  position: absolute;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--overlay-panel);
  color: var(--muted);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
  opacity: 0;
  transition: opacity 0.12s;
}

.line.v .line-x {
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
}

.line.h .line-x {
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
}

.line:hover .line-x {
  opacity: 1;
}

.line-x:hover {
  color: #ff5c5c;
}

/* 裁切结果 */
.results {
  margin-top: 20px;
}

.results-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.results-label {
  font-size: 14px;
  font-weight: 600;
}

.crop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}

.crop-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.crop-cell img {
  max-width: 100%;
  max-height: 140px;
  border-radius: 4px;
  background:
    repeating-conic-gradient(#ccc 0% 25%, #eee 0% 50%) 0 0 / 14px 14px; /* 透明底棋盘格 */
}

.crop-meta {
  font-size: 11px;
  color: var(--muted);
}
</style>
