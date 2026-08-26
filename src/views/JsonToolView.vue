<script setup>
// JSON 格式化：标准 JSON 与类 JSON（结构体转储）两种输入，原文与结果两列对照
// 整体布局尽量压缩页面铬（标题栏一行、按钮并入列头），把视口高度让给文本框
import { ref } from 'vue'
import { parseJsonLike } from '../utils/jsonLike'

const jsonInput = ref('')
const jsonOutput = ref('')
const jsonError = ref('')
const jsonMode = ref('') // 'json' | 'like'
const jsonCopied = ref(false)

// 示例：类 JSON 的结构体转储（含匿名块、十六进制、数组块）
const SAMPLE = `mbuf = {
	addr = 0x446fbc0500,
	port = 0x1,
	ol_flags = 0xc00220000000002,

	rx_desc = 0x446fbc04a0,
	{
	  packet_type = 0x413291,
	  {
	    l2_type = 0x1,
	    l3_type = 0x9,
	    tun_type = 0x3
	  }
	},

	dyn = {
	  0x0,
	  0x0,
	  0x0
	}
}`

function doJson(mode) {
  jsonError.value = ''
  jsonCopied.value = false
  const text = jsonInput.value.trim()
  if (!text) {
    jsonError.value = '请输入要处理的 JSON 或类 JSON 文本'
    return
  }

  // 先按标准 JSON 解析
  try {
    const value = JSON.parse(text)
    jsonMode.value = 'json'
    jsonOutput.value = mode === 'minify' ? JSON.stringify(value) : JSON.stringify(value, null, 2)
    return
  } catch (jsonErr) {
    // 再尝试类 JSON（key = value、0x 十六进制、嵌套 {}）解析
    try {
      const value = parseJsonLike(text)
      jsonMode.value = 'like'
      jsonOutput.value = mode === 'minify' ? JSON.stringify(value) : JSON.stringify(value, null, 2)
      return
    } catch (likeErr) {
      jsonError.value = `既不是标准 JSON，也无法按类 JSON 解析。\n标准 JSON：${jsonErr.message}\n类 JSON：${likeErr.message}`
      jsonOutput.value = ''
      return
    }
  }
}

function clearJson() {
  jsonInput.value = ''
  jsonOutput.value = ''
  jsonError.value = ''
  jsonMode.value = ''
  jsonCopied.value = false
}

function fillSample() {
  jsonInput.value = SAMPLE
  jsonError.value = ''
  jsonOutput.value = ''
  jsonMode.value = ''
  jsonCopied.value = false
}

async function copyJson() {
  if (!jsonOutput.value) return
  try {
    await navigator.clipboard.writeText(jsonOutput.value)
    jsonCopied.value = true
    setTimeout(() => (jsonCopied.value = false), 1500)
  } catch {
    /* 剪贴板不可用：静默 */
  }
}
</script>

<template>
  <div class="json-tool">
    <!-- 单行头部：返回 + 标题 + 提示，尽量少占高度 -->
    <div class="tool-head">
      <router-link to="/tools" class="back-link">← 工具箱</router-link>
      <h1 class="page-title">🧾 JSON 格式化</h1>
      <span class="tool-hint" title="支持标准 JSON 与类 JSON：key = value、0x 十六进制、嵌套 {}（如 C 结构体转储）">
        支持标准 JSON 与类 JSON（key = value / 0x / 嵌套 {}）
      </span>
    </div>

    <div class="tool-grid">
      <!-- 左列：原文 -->
      <div class="col">
        <div class="col-head">
          <span class="col-label">原文</span>
          <div class="btn-row">
            <button class="btn btn-sm btn-primary" @click="doJson('format')">格式化</button>
            <button class="btn btn-sm" @click="doJson('minify')">压缩</button>
            <button class="btn btn-sm" @click="fillSample">示例</button>
            <button class="btn btn-sm" @click="clearJson">清空</button>
          </div>
        </div>
        <textarea
          v-model="jsonInput"
          class="json-input"
          spellcheck="false"
          placeholder='{"name":"AniHub","tools":["json","qr"]} 或 mbuf = { addr = 0x446fbc0500, ... }'
        ></textarea>
      </div>

      <!-- 右列：结果 -->
      <div class="col">
        <div class="col-head">
          <span class="col-label">
            结果
            <span v-if="jsonMode === 'json'" class="mode-tag">标准 JSON</span>
            <span v-else-if="jsonMode === 'like'" class="mode-tag">类 JSON（已转换）</span>
          </span>
          <button class="btn btn-sm" :disabled="!jsonOutput" @click="copyJson">
            {{ jsonCopied ? '已复制 ✓' : '复制' }}
          </button>
        </div>
        <textarea
          readonly
          class="json-output"
          :value="jsonOutput"
          placeholder="点击「格式化」后，结果将显示在这里"
        ></textarea>
      </div>
    </div>

    <p v-if="jsonError" class="tool-error">{{ jsonError }}</p>
  </div>
</template>

<style scoped>
/* 页面占满视口剩余高度（导航栏约 48px）；dvh 更准确适配移动端地址栏，不支持时回退 vh */
.json-tool {
  max-width: min(1320px, 95vw); /* 高分辨率适配 */
  margin: 0 auto;
  padding: 10px 20px 12px;
  min-height: calc(100vh - 48px);
  min-height: calc(100dvh - 48px);
  display: flex;
  flex-direction: column;
}

/* 单行头部 */
.tool-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  padding-bottom: 8px;
}

.back-link {
  font-size: 13px;
  color: var(--muted);
  text-decoration: none;
  white-space: nowrap;
}

.back-link:hover {
  color: var(--accent);
}

.page-title {
  margin: 0;
  font-size: 19px;
  line-height: 1.3;
}

.tool-hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 62%;
}

/* 原文 / 结果 两列：占满头部以下的全部高度 */
.tool-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
  align-items: stretch;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0; /* 防止长文本撑破列宽 */
  min-height: 0;
}

.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 26px;
}

.col-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--muted);
  white-space: nowrap;
}

.btn-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.json-input,
.json-output {
  flex: 1;
  min-height: 160px; /* 极矮视口下的最小高度，正常情况由 flex 撑满剩余空间 */
  width: 100%;
  padding: 10px;
  font-family: Consolas, 'Cascadia Code', 'Courier New', monospace;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.json-input:focus {
  outline: none;
  border-color: var(--accent);
}

.tool-error {
  margin: 8px 0 0;
  font-size: 13px;
  color: #ff9d9d;
  white-space: pre-line;
  line-height: 1.5;
}

.mode-tag {
  font-size: 11px;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 4px;
  padding: 0 6px;
}

/* 紧凑小按钮（本页专用，不依赖其他组件的 .btn-sm） */
.btn-sm {
  padding: 3px 9px;
  font-size: 12px;
}
</style>
