<script setup>
// 管理员控制台：真正的终端模拟器（xterm.js），与 Xshell 一致——
// htop/vim/top 等全屏程序正常显示，bash 原生 Tab 补全/提示符/方向键/历史，
// 输入逐键转发（WebSocket），Ctrl+C 由终端发 \x03（等价真终端）。
// 全宽全高铺满；服务器日志在终端里 journalctl -u anihub / tail 直接看。
// 仅管理员可访问（路由 auth + 服务端 authRequired + WebSocket token 三重校验）。
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import 'xterm/css/xterm.css'

const TERM_CMD = /win/i.test(navigator.platform || '') ? 'cmd' : 'bash' // 终端会话的 shell（服务端包装 stty 尺寸）

const termEl = ref(null)
const termRunning = ref(false) // 终端会话是否运行中
const errMsg = ref('')

const findQuery = ref('') // 终端输出查找
const findResult = ref('') // 查找结果位置（如 3/12）

let term = null
let fitAddon = null
let searchAddon = null
let ws = null
let wsRetry = 0

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
  // 会话启动后确保键盘焦点在终端（xterm 依赖其隐藏 textarea 捕获按键）
  nextTick(() => term?.focus())
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

/* —— 服务器日志（已移除面板：终端里 journalctl -u anihub / tail 直接看）—— */

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
    convertEol: true, // 把 \n 当 \r\n（Windows cmd 输出单独的 \n 时提示符不错位）
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
  // 挂载后主动聚焦终端（mousedown/延迟各兜底一次），否则键入无效
  nextTick(() => term?.focus())
  setTimeout(() => term?.focus(), 400)
  window.addEventListener('resize', fitTerm)
  connectWs()
})
onUnmounted(() => {
  window.removeEventListener('resize', fitTerm)
  ws?.close() // 服务端会在 WS 关闭时清理会话进程
  term?.dispose()
  term = null
})
</script>

<template>
  <div class="console-page">
    <p v-if="errMsg" class="tool-error">{{ errMsg }}</p>

    <!-- 全宽全高终端 -->
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
      <div ref="termEl" class="term-shell" @mousedown="term?.focus()"></div>
    </section>
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

/* 终端面板：全宽全高，固定深色，贴边无圆角 */
.term-panel {
  height: 100%;
  border: none;
  border-radius: 0;
  overflow: hidden;
  background: #0d1117;
  display: flex;
  flex-direction: column;
  min-height: 0;
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

.btn-danger {
  background: #da3633;
  border-color: #da3633;
  color: #fff;
}
</style>
