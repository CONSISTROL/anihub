<script setup>
// 二维码解析：纯前端识别图片中的二维码，提取链接 / 文本
import { ref } from 'vue'
import jsQR from 'jsqr'

const qrFile = ref(null)
const qrPreview = ref('') // 预览图 dataURL
const qrResult = ref('') // 解析出的文本
const qrError = ref('')
const qrBusy = ref(false)
const qrCopied = ref(false)

const isUrl = (s) => /^https?:\/\//i.test(s.trim())

function onFile(file) {
  if (!file) return
  if (!file.type.startsWith('image/')) {
    qrError.value = '请选择图片文件（png / jpg / webp 等）'
    return
  }
  qrError.value = ''
  qrResult.value = ''
  qrCopied.value = false
  const reader = new FileReader()
  reader.onload = () => decodeImage(reader.result)
  reader.readAsDataURL(file)
}

function onPick(e) {
  onFile(e.target.files?.[0])
  e.target.value = '' // 允许再次选择同一文件
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

function decodeImage(dataUrl) {
  const img = new Image()
  img.onload = () => {
    qrPreview.value = dataUrl
    qrBusy.value = true
    try {
      // 超大图片先等比缩小，兼顾解码速度与成功率
      const maxDim = 1600
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, w, h)
      const result = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      })
      if (result && result.data) {
        qrResult.value = result.data
      } else {
        qrError.value = '未在图片中识别到二维码，请换一张更清晰的图片试试'
      }
    } catch (err) {
      qrError.value = `解码失败：${err.message || err}`
    } finally {
      qrBusy.value = false
    }
  }
  img.onerror = () => {
    qrError.value = '图片读取失败，请换一张试试'
  }
  img.src = dataUrl
}

function openLink() {
  window.open(qrResult.value.trim(), '_blank', 'noopener')
}

async function copyQr() {
  try {
    await navigator.clipboard.writeText(qrResult.value)
    qrCopied.value = true
    setTimeout(() => (qrCopied.value = false), 1500)
  } catch {
    /* 剪贴板不可用：静默 */
  }
}

function clearQr() {
  qrPreview.value = ''
  qrResult.value = ''
  qrError.value = ''
  qrCopied.value = false
}
</script>

<template>
  <div class="qr-tool">
    <router-link to="/tools" class="back-link">← 返回工具箱</router-link>
    <h1 class="page-title">🔗 二维码解析</h1>
    <p class="sub">上传或粘贴二维码图片，提取其中的链接 / 文本。纯前端解析，图片不会上传。</p>

    <div
      class="dropzone"
      tabindex="0"
      title="点击选择图片，或拖拽、Ctrl+V 粘贴二维码图片"
      @click="qrFile.click()"
      @keydown.enter="qrFile.click()"
      @dragover.prevent
      @drop.prevent="onDrop"
      @paste="onPaste"
    >
      <img v-if="qrPreview" :src="qrPreview" class="qr-preview" alt="二维码预览" />
      <template v-else>
        <span class="dz-icon">📷</span>
        <span class="dz-text">点击选择图片<br />或拖拽 / Ctrl+V 粘贴到此处</span>
      </template>
      <span v-if="qrBusy" class="dz-busy">识别中…</span>
    </div>
    <input ref="qrFile" type="file" accept="image/*" class="hidden-input" @change="onPick" />

    <div v-if="qrPreview" class="dz-actions">
      <button class="btn btn-sm" @click="qrFile.click()">重新选择</button>
      <button class="btn btn-sm" @click="clearQr">清除图片</button>
    </div>

    <p v-if="qrError" class="tool-error">{{ qrError }}</p>

    <div v-if="qrResult" class="output-wrap">
      <div class="output-head">
        <span class="output-label">解析结果</span>
        <button class="btn btn-sm" @click="copyQr">{{ qrCopied ? '已复制 ✓' : '复制' }}</button>
      </div>
      <div class="qr-text">{{ qrResult }}</div>
      <a v-if="isUrl(qrResult)" class="qr-link" :href="qrResult" target="_blank" rel="noopener">
        打开链接 ↗
      </a>
    </div>
  </div>
</template>

<style scoped>
.qr-tool {
  max-width: min(1200px, 95vw); /* 高分辨率适配 */
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

.dz-busy {
  font-size: 13px;
  color: var(--accent);
}

.qr-preview {
  max-width: 100%;
  max-height: 260px;
  border-radius: 8px;
}

.hidden-input {
  display: none;
}

.dz-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.tool-error {
  margin: 12px 0 0;
  font-size: 13px;
  color: #ff9d9d;
}

.output-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}

.output-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.output-label {
  font-size: 13px;
  color: var(--muted);
}

.qr-text {
  padding: 10px 12px;
  font-size: 13px;
  word-break: break-all;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.qr-link {
  align-self: flex-start;
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
}

.qr-link:hover {
  text-decoration: underline;
}
</style>
