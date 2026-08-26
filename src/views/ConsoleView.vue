<script setup>
// 管理员控制台（Xshell 风格终端）：命令 + 输出都在同一滚动区内，
// 回车后提示符移到下一行；Tab 补全命令名/路径；↑/↓ 历史；Ctrl+L 清空；
// 实时流式输出（WebSocket），Ctrl+C 中断当前命令。
// 仅管理员可访问（路由 auth + 服务端 authRequired + WebSocket token 三重校验）。
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { getConsoleLogs, completeCommand } from '../api/settings'

const input = ref('')
const running = ref(false)
const lines = ref([]) // { type: 'cmd'|'out'|'err'|'info'|'log'|'warn'|'error', text }
const history = ref([])
const histIdx = ref(-1)
const outEl = ref(null)
const termInput = ref(null)
const errMsg = ref('')
const promptDir = ref('') // 当前工作目录（提示符显示）

const logLines = ref([]) // 服务器日志
const logErr = ref('')
let logTimer = null
const platform = ref('') // 服务器平台（用于命令提示）

let ws = null
let wsRetry = 0

const WELCOME = `AniHub 管理员控制台
工作目录: ${location.origin} 对应的服务器项目根目录
输入命令回车执行（支持 shell 语法），↑/↓ 历史，Tab 补全，Ctrl+C 中断，Ctrl+L 清空`

// 输出行数上限（终端 scrollback 风格）：超出后丢弃最早的输出，最新内容始终可见
const MAX_LINES = 2000

function push(type, text) {
  lines.value.push({ type, text: String(text) })
  trimLines()
}

function trimLines() {
  if (lines.value.length > MAX_LINES) {
    lines.value = lines.value.slice(lines.value.length - MAX_LINES)
  }
}

/* —— 输出：append 追加一行；replace 覆盖最后一行输出（进度条 \r 更新） —— */
function pushOut(text, replace) {
  if (replace) {
    const arr = lines.value
    let i = arr.length - 1
    while (i >= 0 && arr[i].type !== 'out') i--
    if (i >= 0) {
      arr[i] = { type: 'out', text: String(text) }
      lines.value = [...arr]
    } else {
      lines.value.push({ type: 'out', text: String(text) })
    }
  } else {
    lines.value.push({ type: 'out', text: String(text) })
    trimLines()
  }
}

function run() {
  const cmd = input.value.trim()
  if (!cmd || running.value) return
  history.value.push(cmd)
  histIdx.value = -1
  input.value = ''
  push('cmd', cmd)
  running.value = true
  errMsg.value = ''
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'run', cmd }))
  } else {
    push('err', '连接已断开，无法执行（正在重连…）')
    running.value = false
  }
  scrollBottom()
}

function sendKill() {
  if (!running.value) return
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'kill' }))
  push('info', '⏹ 已发送中断请求 (Ctrl+C)')
}

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const token = localStorage.getItem('anihub.token') || ''
  ws = new WebSocket(`${proto}://${location.host}/ws/console?token=${encodeURIComponent(token)}`)
  ws.onmessage = (ev) => {
    let m
    try {
      m = JSON.parse(ev.data)
    } catch {
      return
    }
    if (m.type === 'ready') {
      promptDir.value = m.cwd || promptDir.value
    } else if (m.type === 'cwd') {
      promptDir.value = m.cwd || promptDir.value
    } else if (m.type === 'out') {
      pushOut(m.text, m.replace)
      scrollBottom()
    } else if (m.type === 'err') {
      push('err', m.text)
      scrollBottom()
    } else if (m.type === 'exit') {
      push('info', `[退出码 ${m.exitCode}${m.timedOut ? ' · 超时终止(10min)' : ''}]`)
      running.value = false
      scrollBottom()
      focusInput()
    }
  }
  ws.onclose = () => {
    if (running.value) {
      push('err', '连接已断开')
      running.value = false
    }
    wsRetry++
    setTimeout(connectWs, Math.min(5000, 500 * wsRetry))
  }
  ws.onerror = () => {
    /* onclose 会触发重连 */
  }
}

// Tab 补全：唯一候选直接补全；多个候选打印到输出区（类似 shell）
async function onTab() {
  const text = input.value
  if (!text || running.value) return
  try {
    const r = await completeCommand(text)
    if (r.candidates.length === 1) {
      const lastSpace = text.lastIndexOf(' ')
      input.value = (lastSpace < 0 ? '' : text.slice(0, lastSpace + 1)) + r.candidates[0]
    } else if (r.candidates.length > 1) {
      push('info', r.candidates.join('  '))
      scrollBottom()
    }
  } catch {
    /* 补全失败忽略 */
  }
}

function onKeydown(e) {
  if (e.ctrlKey && e.key === 'l') {
    e.preventDefault()
    lines.value = []
    return
  }
  if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
    // 终端习惯：Ctrl+C 清空当前输入行；运行中同时中断命令（复制请用 Ctrl+Shift+C 或右键菜单）
    e.preventDefault()
    input.value = ''
    histIdx.value = -1
    if (running.value) sendKill()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    run()
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    onTab()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (!history.value.length) return
    histIdx.value = histIdx.value < 0 ? history.value.length - 1 : Math.max(0, histIdx.value - 1)
    input.value = history.value[histIdx.value]
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (histIdx.value < 0) return
    histIdx.value++
    input.value = histIdx.value >= history.value.length ? '' : history.value[histIdx.value]
  }
}

function focusInput() {
  nextTick(() => termInput.value?.focus())
}

// 运行中提示行隐藏，Ctrl+C 需在窗口级捕获（本地终端行为：命令跑完才出现新提示行）
function onWinKey(e) {
  if (running.value && e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault()
    input.value = ''
    histIdx.value = -1
    sendKill()
  }
}

function scrollBottom() {
  nextTick(() => {
    if (outEl.value) outEl.value.scrollTop = outEl.value.scrollHeight
  })
}

async function refreshLogs() {
  try {
    logLines.value = (await getConsoleLogs()).lines || []
    logErr.value = ''
  } catch (e) {
    logErr.value = e.message
  }
}

function fmtTime(ts) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

onMounted(async () => {
  push('info', WELCOME)
  connectWs() // WebSocket 实时流式输出
  window.addEventListener('keydown', onWinKey)
  // 获取服务器平台，提示对应命令风格（Windows 用 dir/type，Linux 用 ls/cat）
  try {
    const mon = await import('../api/settings').then((m) => m.getMonitor())
    platform.value = mon?.platform || ''
    const win = /win/i.test(platform.value)
    push(
      'info',
      `服务器平台: ${platform.value} — 命令提示: ${win ? 'Windows 用 dir / type / cd（没有 ls / cat）' : 'Linux 用 ls / cat / pwd'}`
    )
  } catch {
    /* 忽略平台获取失败 */
  }
  refreshLogs()
  logTimer = setInterval(refreshLogs, 3000)
})
onUnmounted(() => {
  clearInterval(logTimer)
  window.removeEventListener('keydown', onWinKey)
  ws?.close()
})
</script>

<template>
  <div class="console-page">
    <p v-if="errMsg" class="tool-error">{{ errMsg }}</p>

    <div class="console-grid">
      <!-- 命令控制台 -->
      <section class="term-panel">
        <div class="term-head">
          <span>🖥️ 命令控制台</span>
          <span class="head-actions">
            <button v-if="running" class="btn btn-sm btn-danger" @click="sendKill">⏹ 停止 (Ctrl+C)</button>
            <button class="btn btn-sm" @click="lines = []">清空输出</button>
          </span>
        </div>
        <div ref="outEl" class="term-out" @click="focusInput">
          <template v-for="(l, i) in lines" :key="i">
            <p class="term-line" :class="l.type">
              <template v-if="l.type === 'cmd'"><span class="prompt">$</span> {{ l.text }}</template>
              <template v-else>{{ l.text }}</template>
            </p>
          </template>
          <!-- 当前提示行：回车后随输出下移，光标留在下一行（Xshell 风格）；
               运行中隐藏——命令跑完才出现新提示行（本地终端行为） -->
          <div v-show="!running" class="prompt-line">
            <span class="prompt-dir">{{ promptDir }}</span>
            <span class="prompt">$</span>
            <input
              ref="termInput"
              v-model="input"
              class="term-input"
              type="text"
              placeholder="输入命令（Tab 补全，Enter 执行，Ctrl+C 中断，↑/↓ 历史，Ctrl+L 清空）"
              spellcheck="false"
              autocomplete="off"
              @keydown="onKeydown"
            />
          </div>
        </div>
      </section>

      <!-- 服务器日志 -->
      <section class="log-panel">
        <div class="term-head">
          <span>服务器日志（最近 {{ logLines.length }} 条，每 3 秒刷新）</span>
          <button class="btn btn-sm" @click="refreshLogs">刷新</button>
        </div>
        <p v-if="logErr" class="tool-error">{{ logErr }}</p>
        <div class="term-out log-out">
          <p v-for="(l, i) in logLines" :key="i" class="term-line log-line" :class="l.level">
            <span class="log-time">{{ fmtTime(l.ts) }}</span> {{ l.text }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.console-page {
  /* 像 html wiki 一样铺满页面：无内边距、无空隙，从导航栏下开始占满到边缘 */
  height: calc(100dvh - 54px); /* 导航栏实测高度 54px */
  max-width: 100%;
  padding: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.tool-error {
  color: #ff9d9d;
  font-size: 13px;
  margin: 0 0 6px;
}

.console-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1.5fr 1fr;
  gap: 0;
}

@media (max-width: 1000px) {
  .console-grid {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 1fr;
  }
}

/* 终端风格：固定深色，不随主题变化；贴边无圆角 */
.term-panel,
.log-panel {
  border: none;
  border-radius: 0;
  overflow: hidden;
  background: #0d1117;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.log-panel {
  border-left: 1px solid #2a3441;
}

@media (max-width: 1000px) {
  .log-panel {
    border-left: none;
    border-top: 1px solid #2a3441;
  }
}

.term-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 14px;
  background: #161b22;
  border-bottom: 1px solid #2a3441;
  font-size: 12px;
  color: #9aa7b4;
  flex-shrink: 0;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-danger {
  color: #f85149;
  border-color: #6e2b2b;
}

.term-out {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 14px;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", "Microsoft YaHei", "PingFang SC", "Noto Sans Mono CJK SC", monospace;
  font-size: 12.5px;
  line-height: 1.55;
  color: #c9d1d9;
  background: #0d1117;
}

.term-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid #2a3441;
  background: #161b22;
  flex-shrink: 0;
}

.term-line {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}.term-line.cmd {
  color: #58a6ff;
  font-weight: 600;
}

.term-line.out {
  color: #c9d1d9;
}

.term-line.err {
  color: #f85149;
}

.term-line.info {
  color: #8b949e;
}

.prompt {
  color: #3fb950;
  font-weight: 700;
  margin-right: 6px;
  user-select: none;
  flex-shrink: 0;
}

.prompt-dir {
  color: #58a6ff;
  font-weight: 600;
  margin-right: 8px;
  user-select: none;
  flex-shrink: 0;
  font-size: 12px;
}

/* 当前输入行：跟随输出区底部，回车后自然下移（Xshell 风格） */
.prompt-line {
  display: flex;
  align-items: center;
  gap: 0;
}

.term-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: #c9d1d9;
  caret-color: #3fb950;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", "Microsoft YaHei", "PingFang SC", monospace;
  font-size: 12.5px;
  line-height: 1.55;
  padding: 0;
}

.term-input::placeholder {
  color: #6e7681;
  font-family: inherit;
}

.log-line .log-time {
  color: #6e7681;
  margin-right: 8px;
  user-select: none;
}

.log-line.warn {
  color: #d29922;
}

.log-line.error {
  color: #f85149;
}
</style>
