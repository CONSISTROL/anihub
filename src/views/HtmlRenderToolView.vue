<script setup>
// HTML 渲染：粘贴 HTML 代码，点击「渲染」在新标签页中原样显示。
// 一次性语义：代码不经过服务器、不写入本地存储/localStorage；渲染成功后输入框立即清空，
// Blob URL 短延时后释放、组件卸载时兜底释放——新标签页关闭后不留任何副本。
// 特殊入口：输入 login / inside 后点击渲染，分别触发登录弹窗 / 内部人员身份（由 App.vue 提供）。
import { inject, onUnmounted, ref } from 'vue'
import AppIcon from '../components/AppIcon.vue'

const code = ref('')
const error = ref('')
const notice = ref('')
let pendingUrl = null // 尚未释放的 blob URL

// 隐藏入口：输入 login / inside 后点击渲染触发特殊行为（由 App.vue 提供）
const openLogin = inject('openLogin', () => {})
const enterInside = inject('enterInside', async () => false)

const SAMPLE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>示例页面</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 40px auto; max-width: 640px; color: #333; }
  h1 { color: #d94f5c; }
  .card { border: 1px solid #e2e2e2; border-radius: 12px; padding: 16px 20px; margin-top: 16px; }
  button { padding: 8px 16px; border: none; border-radius: 8px; background: #4a7de0; color: #fff; cursor: pointer; }
</style>
</head>
<body>
  <h1>你好，HTML 渲染！</h1>
  <div class="card">这是一段由 <b>tools / HTML 渲染</b> 打开的示例页面，脚本也会正常执行。</div>
  <p><button onclick="document.querySelector('.card').textContent = '点击了按钮：脚本生效 ✓'">点我（运行 JS）</button></p>
</body>
</html>`

const isFullDoc = (s) => /^\s*(<!DOCTYPE[^>]*>)?\s*<html[\s>]/i.test(s)

function wrapFragment(s) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:24px;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7;color:#222}</style>
</head>
<body>
${s}
</body>
</html>`
}

function releaseBlob(url) {
  if (pendingUrl === url) pendingUrl = null
  try {
    URL.revokeObjectURL(url)
  } catch {
    /* 已释放 */
  }
}

async function render() {
  error.value = ''
  notice.value = ''
  const src = code.value.trim()
  if (!src) {
    error.value = '请先粘贴 HTML 代码'
    return
  }

  // 特殊行为：login → 打开登录弹窗；inside → 获取内部人员身份
  if (/^login$/i.test(src)) {
    code.value = ''
    openLogin()
    return
  }
  if (/^inside$/i.test(src)) {
    code.value = ''
    const ok = await enterInside()
    notice.value = ok ? '已进入内部模式' : '当前已是内部人员/管理员，或操作未生效'
    return
  }

  const html = isFullDoc(src) ? src : wrapFragment(src)
  try {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const win = window.open(url, '_blank')
    if (!win) {
      releaseBlob(url)
      error.value = '新标签页被浏览器拦截了，请允许本站弹出窗口后重试'
      return
    }
    pendingUrl = url
    // 一次性渲染：成功打开后立即清空输入框，代码不在页面内存中留存
    code.value = ''
    // 短延时后释放 Blob：新标签页文档加载完成后 revoke 不影响已打开的内容，标签页关闭后不留副本
    setTimeout(() => releaseBlob(url), 30000)
  } catch (e) {
    error.value = '渲染失败：' + e.message
  }
}

// 离开本工具页时兜底释放，确保代码不留存
onUnmounted(() => {
  if (pendingUrl) {
    URL.revokeObjectURL(pendingUrl)
    pendingUrl = null
  }
})

function onKeydown(e) {
  if (e.ctrlKey && e.key === 'Enter') render()
}

function clearCode() {
  code.value = ''
  error.value = ''
  notice.value = ''
}
</script>

<template>
  <div class="tool-page">
    <h1 class="page-title"><AppIcon name="code" :size="21" /> HTML 渲染</h1>
    <p class="sub">
      粘贴 HTML 代码，点击「渲染」在新标签页中原样显示（样式与脚本都会生效）。
      <b>一次性渲染</b>：代码不经过服务器、不写入本地存储，渲染成功后输入框自动清空。
    </p>

    <div class="render-bar">
      <button class="btn btn-primary" @click="render">渲染（Ctrl+Enter）</button>
      <button class="btn" @click="code = SAMPLE">填入示例</button>
      <button class="btn" @click="clearCode">清空</button>
    </div>

    <p v-if="error" class="tool-error">{{ error }}</p>
    <p v-if="notice" class="tool-notice">{{ notice }}</p>

    <textarea
      v-model="code"
      class="code-input"
      placeholder="在此粘贴 HTML 代码……（完整文档或片段均可，Ctrl+Enter 快速渲染；渲染后即清空，不留存）"
      spellcheck="false"
      @keydown="onKeydown"
    ></textarea>

    <p class="tip">
      <AppIcon name="lightbulb" :size="14" />
      完整文档（&lt;!DOCTYPE html&gt; / &lt;html&gt; 开头）原样渲染；片段自动补全为最小页面骨架。
      新标签页中的脚本会正常执行；相对路径资源（如图片）在新标签页中无法解析，请使用完整 URL 或 data: 图片。
      渲染是一次性的：新标签页关闭后内容即消失，本站不保存任何副本。
    </p>
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

.render-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.tool-error {
  margin: 0 0 10px;
  color: #ff9d9d;
  font-size: 13px;
}

.tool-notice {
  margin: 0 0 10px;
  color: var(--accent);
  font-size: 13px;
}

.code-input {
  width: 100%;
  min-height: 62vh;
  padding: 14px;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  resize: vertical;
  white-space: pre;
  tab-size: 2;
}

.code-input:focus {
  outline: none;
  border-color: var(--accent);
}

.tip {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.7;
}

.tip .app-icon {
  margin-top: 3px;
  color: var(--accent);
}
</style>
