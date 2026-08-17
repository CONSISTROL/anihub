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
}

function removeLine(lines, id) {
  const i = lines.findIndex((l) => l.id === id)
  if (i >= 0) lines.splice(i, 1)
}

// 移除最近添加的一条线（id 单调递增，取最大 id）
function removeLastLine(lines) {
  if (!lines.length) return
  const last = [...lines].reduce((a, b) => (a.id > b.id ? a : b))
  removeLine(lines, last.id)
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
  error.value = ''
}
</script>

<template>
  <div class="crop-tool">
    <router-link to="/tools" class="back-link">← 返回工具箱</router-link>
    <h1 class="page-title">✂️ 图片裁切</h1>
    <p class="sub">
      上传版图（多格图 / 精灵图），拖动网格线划分格子，一键裁切成小图。
      纯前端处理，图片不会上传。
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
  max-width: 960px;
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
