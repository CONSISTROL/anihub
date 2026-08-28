<script setup>
// 图片拼接：把多张图片拼成一张（横向 / 纵向 / 网格）。
// 纯前端处理：图片不上传；支持点击多选 / 拖拽 / Ctrl+V 粘贴图片。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'

const MAX_DIM = 16000 // 浏览器 canvas 尺寸上限（超出给出提示）

const fileInput = ref(null)
const preview = ref(null) // 预览 canvas
const items = ref([]) // [{ id, name, img, url, w, h }]
const mode = ref('h') // h 横向 | v 纵向 | grid 网格
const gridCols = ref(2)
const gap = ref(0) // 间距 px
const bg = ref('transparent') // transparent | white | black | custom
const customBg = ref('#ffffff')
const alignH = ref('center') // 横向模式：start | center | end
const alignV = ref('center') // 纵向模式：start | center | end
const error = ref('')
let idSeq = 1

const bgColor = computed(() => {
  if (bg.value === 'white') return '#ffffff'
  if (bg.value === 'black') return '#000000'
  if (bg.value === 'custom') return customBg.value
  return 'transparent'
})

/* —— 图片加载 —— */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ img, url, w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`图片解码失败：${file.name}`))
    }
    img.src = url
  })
}

async function addFiles(files) {
  error.value = ''
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue
    try {
      const meta = await loadImage(f)
      items.value.push({ id: idSeq++, name: f.name, img: meta.img, url: meta.url, w: meta.w, h: meta.h })
    } catch (e) {
      error.value = e.message
    }
  }
}

function onPick(e) {
  addFiles([...e.target.files])
  e.target.value = '' // 允许重复选择同一文件
}

function onDrop(e) {
  addFiles([...e.dataTransfer.files])
}

function onPaste(e) {
  const files = [...(e.clipboardData?.items || [])]
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter(Boolean)
  if (files.length) {
    e.preventDefault()
    addFiles(files)
  }
}

function removeItem(i) {
  const it = items.value[i]
  URL.revokeObjectURL(it.url)
  items.value.splice(i, 1)
}

function moveItem(i, dir) {
  const j = i + dir
  if (j < 0 || j >= items.value.length) return
  const arr = items.value
  ;[arr[i], arr[j]] = [arr[j], arr[i]]
}

function clearAll() {
  items.value.forEach((it) => URL.revokeObjectURL(it.url))
  items.value = []
}

onUnmounted(() => {
  items.value.forEach((it) => URL.revokeObjectURL(it.url))
  window.removeEventListener('paste', onPaste)
})
onMounted(() => window.addEventListener('paste', onPaste))

/* —— 拼接计算 —— */
const metrics = computed(() => {
  const n = items.value.length
  if (!n) return null
  const g = gap.value
  if (mode.value === 'grid') {
    const cols = Math.min(n, Math.max(1, Math.round(gridCols.value) || 1))
    const rows = Math.ceil(n / cols)
    const cellW = Math.max(...items.value.map((i) => i.w))
    const cellH = Math.max(...items.value.map((i) => i.h))
    return {
      W: cols * cellW + (cols - 1) * g,
      H: rows * cellH + (rows - 1) * g,
      grid: { cols, rows, cellW, cellH },
    }
  }
  if (mode.value === 'h') {
    return {
      W: items.value.reduce((s, i) => s + i.w, 0) + g * (n - 1),
      H: Math.max(...items.value.map((i) => i.h)),
    }
  }
  return {
    W: Math.max(...items.value.map((i) => i.w)),
    H: items.value.reduce((s, i) => s + i.h, 0) + g * (n - 1),
  }
})

function placements() {
  const m = metrics.value
  if (!m || !items.value.length) return []
  const out = []
  const g = gap.value
  if (mode.value === 'grid') {
    const { cols, cellW, cellH } = m.grid
    items.value.forEach((it, idx) => {
      out.push({
        img: it.img,
        x: (idx % cols) * (cellW + g) + (cellW - it.w) / 2,
        y: Math.floor(idx / cols) * (cellH + g) + (cellH - it.h) / 2,
      })
    })
  } else if (mode.value === 'h') {
    let x = 0
    items.value.forEach((it) => {
      const y = alignH.value === 'center' ? (m.H - it.h) / 2 : alignH.value === 'end' ? m.H - it.h : 0
      out.push({ img: it.img, x, y })
      x += it.w + g
    })
  } else {
    let y = 0
    items.value.forEach((it) => {
      const x = alignV.value === 'center' ? (m.W - it.w) / 2 : alignV.value === 'end' ? m.W - it.w : 0
      out.push({ img: it.img, x, y })
      y += it.h + g
    })
  }
  return out
}

function paint(canvas, w, h) {
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, w, h)
  if (bgColor.value !== 'transparent') {
    ctx.fillStyle = bgColor.value
    ctx.fillRect(0, 0, w, h)
  }
  return ctx
}

// 完整尺寸渲染（用于导出）
function renderFull() {
  const m = metrics.value
  if (!m) return null
  if (m.W > MAX_DIM || m.H > MAX_DIM) {
    throw new Error(`拼接后尺寸 ${m.W}×${m.H} 超出浏览器画布上限（单边 ≤ ${MAX_DIM}px），请减小间距或改用网格/减少图片`)
  }
  const c = document.createElement('canvas')
  const ctx = paint(c, m.W, m.H)
  for (const p of placements()) ctx.drawImage(p.img, p.x, p.y)
  return c
}

// 预览（按容器宽度缩放绘制）
function renderPreview() {
  const c = preview.value
  const m = metrics.value
  if (!c || !m || !items.value.length) {
    if (c) c.width = 0
    return
  }
  const scale = Math.min(1, 760 / m.W)
  const w = Math.max(1, Math.round(m.W * scale))
  const h = Math.max(1, Math.round(m.H * scale))
  const ctx = paint(c, w, h)
  ctx.save()
  ctx.scale(scale, scale)
  for (const p of placements()) ctx.drawImage(p.img, p.x, p.y)
  ctx.restore()
}

watch([items, mode, gridCols, gap, bg, customBg, alignH, alignV], () => nextTick(renderPreview), { deep: true })

function download() {
  error.value = ''
  try {
    const c = renderFull()
    if (!c) return
    const a = document.createElement('a')
    a.download = `splice-${Date.now()}.png`
    a.href = c.toDataURL('image/png')
    a.click()
  } catch (e) {
    error.value = e.message
  }
}
</script>

<template>
  <div class="tool-page">
    <h1 class="page-title"><AppIcon name="grid" :size="21" /> 图片拼接</h1>
    <p class="sub">把多张图片拼成一张：横向 / 纵向 / 网格，可设间距与背景。纯前端处理，图片不会上传。</p>

    <!-- 上传区 -->
    <div
      class="drop-zone"
      @click="fileInput.click()"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <span class="dz-icon"><AppIcon name="image" :size="30" /></span>
      <p class="dz-main">点击选择多张图片，或拖拽到此处，或 <b>Ctrl+V</b> 粘贴</p>
      <p class="dz-sub">支持 png / jpg / webp 等；按列表顺序拼接，可用右侧按钮调整顺序</p>
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPick" />
    </div>

    <p v-if="error" class="tool-error">{{ error }}</p>

    <!-- 主体：左（列表+设置）右（预览+导出） -->
    <div v-if="items.length" class="splice-main">
      <div class="left">
        <!-- 图片列表 -->
        <div class="panel">
          <div class="panel-head">
            <h3>图片列表（{{ items.length }}）</h3>
            <button class="btn btn-sm" @click="clearAll">清空</button>
          </div>
          <ul class="img-list">
            <li v-for="(it, i) in items" :key="it.id" class="img-item">
              <img class="thumb" :src="it.url" :alt="it.name" />
              <div class="img-info">
                <p class="img-name" :title="it.name">{{ it.name }}</p>
                <p class="img-size">{{ it.w }} × {{ it.h }}</p>
              </div>
              <div class="img-ops">
                <button class="btn btn-sm" :disabled="i === 0" @click="moveItem(i, -1)"><AppIcon name="arrow-up" :size="13" /></button>
                <button class="btn btn-sm" :disabled="i === items.length - 1" @click="moveItem(i, 1)"><AppIcon name="arrow-down" :size="13" /></button>
                <button class="btn btn-sm btn-danger" @click="removeItem(i)"><AppIcon name="x" :size="13" /></button>
              </div>
            </li>
          </ul>
        </div>

        <!-- 拼接设置 -->
        <div class="panel">
          <h3>拼接设置</h3>
          <div class="set-row">
            <span class="set-label">方向</span>
            <div class="set-opts">
              <label><input v-model="mode" type="radio" value="h" /> 横向</label>
              <label><input v-model="mode" type="radio" value="v" /> 纵向</label>
              <label><input v-model="mode" type="radio" value="grid" /> 网格</label>
            </div>
          </div>
          <div v-if="mode === 'grid'" class="set-row">
            <span class="set-label">列数</span>
            <input v-model.number="gridCols" class="inp" type="number" min="1" :max="items.length" />
          </div>
          <div v-if="mode === 'h'" class="set-row">
            <span class="set-label">对齐</span>
            <select v-model="alignH" class="inp">
              <option value="start">顶部</option>
              <option value="center">居中</option>
              <option value="end">底部</option>
            </select>
          </div>
          <div v-if="mode === 'v'" class="set-row">
            <span class="set-label">对齐</span>
            <select v-model="alignV" class="inp">
              <option value="start">左侧</option>
              <option value="center">居中</option>
              <option value="end">右侧</option>
            </select>
          </div>
          <div class="set-row">
            <span class="set-label">间距</span>
            <input v-model.number="gap" class="inp" type="number" min="0" max="200" /> <span class="set-unit">px</span>
          </div>
          <div class="set-row">
            <span class="set-label">背景</span>
            <div class="set-opts">
              <label><input v-model="bg" type="radio" value="transparent" /> 透明</label>
              <label><input v-model="bg" type="radio" value="white" /> 白</label>
              <label><input v-model="bg" type="radio" value="black" /> 黑</label>
              <label class="bg-custom"><input v-model="bg" type="radio" value="custom" /> 自定义
                <input v-if="bg === 'custom'" v-model="customBg" class="color-inp" type="color" />
              </label>
            </div>
          </div>
        </div>
      </div>

      <div class="right">
        <div class="panel">
          <div class="panel-head">
            <h3>预览</h3>
            <span v-if="metrics" class="result-size">{{ metrics.W }} × {{ metrics.H }}</span>
          </div>
          <div class="preview-box">
            <canvas ref="preview" class="preview-canvas"></canvas>
          </div>
          <button class="btn btn-primary btn-block" :disabled="!metrics" @click="download">
            下载拼接结果（PNG）
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-page {
  max-width: min(1160px, 95vw); /* 高分辨率适配 */
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-size: 24px;
}

.sub {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--muted);
}

.drop-zone {
  border: 2px dashed var(--border);
  border-radius: 14px;
  padding: 30px 20px;
  text-align: center;
  cursor: pointer;
  transition:
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    background-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
  background: var(--panel);
}

.drop-zone:hover {
  box-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 14%, transparent);
}

.drop-zone:hover {
  border-color: var(--accent);
  background: var(--panel-2);
}

.dz-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.dz-main {
  margin: 8px 0 4px;
  font-size: 14px;
}

.dz-sub {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.tool-error {
  margin: 12px 0 0;
  color: #ff9d9d;
  font-size: 13px;
}

.splice-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 18px;
  margin-top: 18px;
}

.left,
.right {
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-width: 0;
}

.panel {
  padding: 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.panel h3 {
  margin: 0 0 12px;
  font-size: 15px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.panel-head h3 {
  margin: 0;
}

.img-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow-y: auto;
}

.img-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.thumb {
  width: 52px;
  height: 52px;
  object-fit: contain;
  border-radius: 6px;
  background: var(--panel);
}

.img-info {
  flex: 1;
  min-width: 0;
}

.img-name {
  margin: 0;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.img-size {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.img-ops {
  display: flex;
  gap: 4px;
}

.set-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 13px;
}

.set-row:last-child {
  margin-bottom: 0;
}

.set-label {
  width: 44px;
  color: var(--muted);
  flex-shrink: 0;
}

.set-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.set-opts label {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.bg-custom {
  gap: 6px;
}

.color-inp {
  width: 34px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.inp {
  width: 90px;
  padding: 5px 8px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
}

.set-unit {
  color: var(--muted);
  font-size: 12px;
}

.preview-box {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 12px;
  background:
    repeating-conic-gradient(#00000012 0% 25%, transparent 0% 50%) 0 0 / 20px 20px,
    var(--panel);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  max-height: 420px;
  overflow: auto;
}

.preview-canvas {
  max-width: 100%;
  max-height: 400px;
  border-radius: 6px;
}

.result-size {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.btn-block {
  width: 100%;
  justify-content: center;
}

@media (max-width: 900px) {
  .splice-main {
    grid-template-columns: 1fr;
  }
}
</style>
