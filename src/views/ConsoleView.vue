<script setup>
// 管理员控制台：真正的终端模拟器（xterm.js），与 Xshell 一致——
// htop/vim/top 等全屏程序正常显示，bash 原生 Tab 补全/提示符/方向键/历史，
// 输入逐键转发（WebSocket），Ctrl+C 由终端发 \x03（等价真终端）。
// 右侧保留服务器日志面板（3 秒刷新 + 关键词搜索高亮）。
// 仅管理员可访问（路由 auth + 服务端 authRequired + WebSocket token 三重校验）。
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import 'xterm/css/xterm.css'
import { getConsoleLogs } from '../api/settings'

const TERM_CMD = /win/i.test(navigator.platform || '') ? 'cmd' : 'bash' // 终端会话的 shell（服务端包装 stty 尺寸）

const termEl = ref(null)
const termRunning = ref(false) // 终端会话是否运行中
const errMsg = ref('')

const logLines = ref([]) // 服务器日志
const logErr = ref('')
const logQuery = ref('') // 日志搜索关键词

const findQuery = ref('') // 终端输出查找
const findResult = ref('') // 查找结果位置（如 3/12）

let term = null
let fitAddon = null
let searchAddon = null
let ws = null
let wsRetry = 0
let logTimer = null

// 日志搜索过滤（不区分大小写，匹配日志正文）
const filteredLogs = computed(() => {
  const q = logQuery.value.trim().toLowerCase()
  if (!q) return logLines.value
  return logLines.value.filter((l) => l.text.toLowerCase().includes(q))
})

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// 日志搜索高亮：先转义防 XSS，再把命中的片段包成 <mark>
function highlightLog(text) {
  const q = logQuery.value.trim()
  if (!q) return escapeHtml(text)
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  let out = ''
  let i = 0
  for (;;) {
    const j = lower.indexOf(ql, i)
    if (j < 0) {
      out += escapeHtml(text.slice(i))
      break
    }
    out += escapeHtml(text.slice(i, j)) + '<mark class="log-hl">' + escapeHtml(text.slice(j, j + q.length)) + '</mark>'
    i = j + q.length
  }
  return out
}

function termWrite(text) {
  term?.write(text)
}

function termWriteln(text) {
  term?.writeln(text)
}

/* —— 终端会话 —— */
function startTerminal() {
  if (!term || !ws || ws.readyState !== WebSocket.OPEN) return
  termRunning.value = true
  errMsg.value = ''
  term.clear()
  ws.send(
    JSON.stringify({ type: 'run', cmd: TERM_CMD, term: true, cols: term.cols, rows: term.rows })
  )
}

function sendKill() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'kill' }))
  termWriteln('\x1b[90m[已发送中断请求 (Ctrl+C)]\x1b[0m')
}

function clearTerm() {
  term?.clear()
}

function restartTerm() {
  if (ws && ws.readyState === WebSocket.OPEN) startTerminal()
  else connectWs()
}

/* —— 终端内查找（xterm search addon）—— */
function findNext() {
  const q = findQuery.value
  if (!q || !searchAddon) {
    findResult.value = ''
    return
  }
  searchAddon.findNext(q, { caseSensitive: false, incremental: true })
}

function findPrev() {
  const q = findQuery.value
  if (!q || !searchAddon) return
  searchAddon.findPrevious(q, { caseSensitive: false })
}

/* —— WebSocket —— */
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
      if (!termRunning.value) startTerminal()
    } else if (m.type === 'out') {
      termWrite(m.text)
    } else if (m.type === 'err') {
      termWrite(m.text)
    } else if (m.type === 'exit') {
      termRunning.value = false
      termWriteln(
        `\x1b[90m[会话已结束 · 退出码 ${m.exitCode}${m.timedOut ? ' · 超时终止' : ''}]（可点右上角"重启会话"）\x1b[0m`
      )
    }
  }
  ws.onclose = () => {
    if (termRunning.value) {
      termRunning.value = false
      termWriteln('\x1b[31m连接已断开，正在重连…\x1b[0m')
    }
    wsRetry++
    setTimeout(connectWs, Math.min(5000, 500 * wsRetry))
  }
  ws.onerror = () => {
    /* onclose 会触发重连 */
  }
}

/* —— 服务器日志 —— */
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

function fitTerm() {
  nextTick(() => {
    try {
      fitAddon?.fit()
    } catch {
      /* 终端不可见时忽略 */
    }
  })
}

onMounted(async () => {
  // 创建终端模拟器
  term = new Terminal({
    scrollback: 2000,
    cursorBlink: true,
    fontSize: 13,
    fontFamily:
      'ui-monospace, SFMono-Regular, Consolas, "Courier New", "Microsoft YaHei", "PingFang SC", "Noto Sans Mono CJK SC", monospace',
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#3fb950',
      cursorAccent: '#0d1117',
      selectionBackground: '#2a3441',
      black: '#0d1117',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#c9d1d9',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc',
    },
  })
  fitAddon = new FitAddon()
  searchAddon = new SearchAddon()
  term.loadAddon(fitAddon)
  term.loadAddon(searchAddon)
  term.open(termEl.value)
  searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
    findResult.value = resultCount ? `${resultIndex + 1}/${resultCount}` : ''
  })
  // 输入逐键转发给服务器（bash 的编辑/补全/信号都在终端层完成）
  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }))
    }
  })
  termWriteln('\x1b[90mAniHub 管理员终端 — 正在连接…\x1b[0m')
  fitTerm()
  setTimeout(fitTerm, 300) // 布局稳定后再校正一次尺寸
  window.addEventListener('resize', fitTerm)
  connectWs()
  refreshLogs()
  logTimer = setInterval(refreshLogs, 3000)
})
onUnmounted(() => {
  clearInterval(logTimer)
  window.removeEventListener('resize', fitTerm)
  ws?.close() // 服务端会在 WS 关闭时清理会话进程
  term?.dispose()
  term = null
})
</script>

<template>
  <div class="console-page">
    <p v-if="errMsg" class="tool-error">{{ errMsg }}</p>

    <div class="console-grid">
      <!-- 终端 -->
      <section class="term-panel">
        <div class="term-head">
          <span>🖥️ 管理员终端</span>
          <span class="head-actions">
            <input
              v-model="findQuery"
              class="log-search"
              type="text"
              placeholder="查找输出 (Enter 下一个 / Shift+Enter 上一个)"
              spellcheck="false"
              @input="findNext"
              @keydown.enter.prevent="findNext"
              @keydown.shift.enter.prevent="findPrev"
            />
            <span v-if="findResult" class="find-result">{{ findResult }}</span>
            <button v-if="termRunning" class="btn btn-sm btn-danger" @click="sendKill">⏹ 停止 (Ctrl+C)</button>
            <button v-if="!termRunning" class="btn btn-sm" @click="restartTerm">重启会话</button>
            <button class="btn btn-sm" @click="clearTerm">清空</button>
          </span>
        </div>
        <div ref="termEl" class="term-shell" @click="term?.focus()"></div>
      </section>

      <!-- 服务器日志 -->
      <section class="log-panel">
        <div class="term-head">
          <span>服务器日志（最近 {{ logLines.length }} 条，每 3 秒刷新）</span>
          <span class="head-actions">
            <input
              v-model="logQuery"
              class="log-search"
              type="text"
              placeholder="搜索日志…"
              spellcheck="false"
            />
            <button v-if="logQuery" class="btn btn-sm" @click="logQuery = ''">清除</button>
            <button class="btn btn-sm" @click="refreshLogs">刷新</button>
          </span>
        </div>
        <p v-if="logErr" class="tool-error">{{ logErr }}</p>
        <p v-if="logQuery.trim()" class="log-match-info">匹配 {{ filteredLogs.length }} 条</p>
        <div class="term-out log-out">
          <p v-for="(l, i) in filteredLogs" :key="i" class="term-line log-line" :class="l.level">
            <span class="log-time">{{ fmtTime(l.ts) }}</span>
            <span v-html="highlightLog(l.text)"></span>
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
}

.console-grid {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px; /* 左：终端；右：日志 */
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

/* xterm 容器：占满剩余高度 */
.term-shell {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 6px 0 6px 6px;
  background: #0d1117;
}

.log-search {
  width: 160px;
  padding: 3px 8px;
  font-size: 12px;
  color: #c9d1d9;
  background: #0d1117;
  border: 1px solid #2a3441;
  border-radius: 4px;
  outline: none;
}

.log-search:focus {
  border-color: #58a6ff;
}

.find-result {
  font-size: 12px;
  color: #8b949e;
  flex-shrink: 0;
}

.log-match-info {
  margin: 4px 14px 0;
  font-size: 12px;
  color: #8b949e;
  flex-shrink: 0;
}

.log-hl {
  background: #f0c36d;
  color: #1c2333;
  border-radius: 2px;
  padding: 0 1px;
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

.term-line {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.term-line.cmd {
  color: #3fb950;
}

.term-line.info,
.term-line.log {
  color: #8b949e;
}

.term-line.err,
.term-line.error {
  color: #f85149;
}

.log-line {
  color: #c9d1d9;
}

.log-line .log-time {
  color: #8b949e;
  margin-right: 8px;
}

.log-line.warn {
  color: #d29922;
}

.log-line.error {
  color: #f85149;
}

.btn-danger {
  background: #da3633;
  border-color: #da3633;
  color: #fff;
}
</style>
