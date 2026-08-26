<script setup>
// 管理员控制台（Xshell 风格终端）：命令 + 输出都在同一滚动区内，
// 回车后提示符移到下一行；Tab 补全命令名/路径；↑/↓ 历史；Ctrl+L 清空；
// 实时流式输出（WebSocket），Ctrl+C 中断当前命令。
// 仅管理员可访问（路由 auth + 服务端 authRequired + WebSocket token 三重校验）。
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { getConsoleLogs, completeCommand } from '../api/settings'

const input = ref('')
const running = ref(false)
const lines = ref([]) // { type: 'cmd'|'out'|'err'|'info'|'log'|'warn'|'error', text }
const termQuery = ref('') // 终端输出搜索关键词
const shellPrompt = ref('') // 交互 shell 提示符结尾标记（# = root，$ = 普通用户），运行中作为输入前缀

// 从交互 shell 输出中识别提示符结尾标记：bash 默认 PS1（root@host:/path#）以 #/$ 结尾。
// 含路径/主机名特征（: @ / ~ 等）或极短（单独 "$"、"#"）才算，避免命令输出误判
function matchShellPrompt(line) {
  const t = line.replace(/\s+$/, '')
  if (!t || t.length > 90) return null
  const m = t.match(/[$#%❯➜]$/)
  if (!m) return null
  const looksPathy = /[:@/\\~]/.test(t) || t.length <= 4
  if (!looksPathy) return null
  return m[0]
}

// 终端输出搜索过滤（不区分大小写，匹配输出正文）
const filteredLines = computed(() => {
  const q = termQuery.value.trim().toLowerCase()
  if (!q) return lines.value
  return lines.value.filter((l) => l.text.toLowerCase().includes(q))
})
const history = ref([])
const histIdx = ref(-1)
const outEl = ref(null)
const termInput = ref(null)
const errMsg = ref('')
const promptDir = ref('') // 当前工作目录（提示符显示）

const logLines = ref([]) // 服务器日志
const logErr = ref('')
const logQuery = ref('') // 日志搜索关键词

// 日志搜索过滤（不区分大小写，匹配日志正文）
const filteredLogs = computed(() => {
  const q = logQuery.value.trim().toLowerCase()
  if (!q) return logLines.value
  return logLines.value.filter((l) => l.text.toLowerCase().includes(q))
})

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// 通用搜索高亮：先转义防 XSS，再把命中的片段包成 <mark>
function highlight(text, q) {
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

function highlightLog(text) {
  return highlight(text, logQuery.value.trim())
}

function highlightTerm(text) {
  return highlight(text, termQuery.value.trim())
}
let logTimer = null
const platform = ref('') // 服务器平台（用于命令提示）

let ws = null
let wsRetry = 0
let ptyHintShown = false // PTY 交互提示只显示一次

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
  shellPrompt.value = '' // 新命令重新开始，等 shell 打印新提示符再识别
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
      if (m.pty && !ptyHintShown) {
        ptyHintShown = true
        push('info', '已启用交互模式：运行中的命令可直接输入内容（如 su 密码），回车发送，Ctrl+C 中断')
      }
    } else if (m.type === 'cwd') {
      promptDir.value = m.cwd || promptDir.value
    } else if (m.type === 'out') {
      pushOut(m.text, m.replace)
      if (!m.replace) {
        const marker = matchShellPrompt(m.text)
        if (marker) shellPrompt.value = marker
      }
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

// Tab 补全：唯一候选直接补全；多个候选打印到输出区（类似 shell）。
// 空闲与运行中（交互 shell）都能用——服务端基于会话目录 + PATH 补全
async function onTab() {
  const text = input.value
  if (!text) return
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
    // stopPropagation：避免与窗口级 onWinKey 重复触发（一次按键发两次 kill）
    e.preventDefault()
    e.stopPropagation()
    input.value = ''
    histIdx.value = -1
    if (running.value) sendKill()
    return
  }
  if (running.value && e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
    // 交互 shell 里 Ctrl+D = EOF：空行退出 shell（等价输入 exit）
    e.preventDefault()
    e.stopPropagation()
    input.value = ''
    sendRaw('\x04')
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    if (running.value) sendInput()
    else run()
    return
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    onTab()
    return
  }
  if (running.value) return // 运行中 ↑/↓ 历史不生效（输入是发给进程的）
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

// 运行中：把输入行发给运行中的进程（PTY 交互，如 su 密码、shell 命令）
function sendInput() {
  const text = input.value
  input.value = ''
  histIdx.value = -1
  sendRaw(text + '\n')
}

// 直接发送原始字节（如 Ctrl+D 的 \x04 EOF）
function sendRaw(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data }))
  }
}

function focusInput() {
  nextTick(() => termInput.value?.focus())
}

// 窗口级兜底：仅当输入框未聚焦时捕获 Ctrl+C（聚焦时由 onKeydown 处理并 stopPropagation，避免重复发中断）
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
            <input
              v-model="termQuery"
              class="log-search"
              type="text"
              placeholder="搜索输出…"
              spellcheck="false"
            />
            <button v-if="termQuery" class="btn btn-sm" @click="termQuery = ''">清除</button>
            <button v-if="running" class="btn btn-sm btn-danger" @click="sendKill">
              {{ shellPrompt ? '⏹ 中断 (Ctrl+C)' : '⏹ 停止 (Ctrl+C)' }}
            </button>
            <button class="btn btn-sm" @click="lines = []">清空输出</button>
          </span>
        </div>
        <p v-if="termQuery.trim()" class="log-match-info">匹配 {{ filteredLines.length }} 条</p>
        <div ref="outEl" class="term-out" @click="focusInput">
          <template v-for="(l, i) in filteredLines" :key="i">
            <p class="term-line" :class="l.type">
              <template v-if="l.type === 'cmd'"><span class="prompt">$</span> <span v-html="highlightTerm(l.text)"></span></template>
              <template v-else><span v-html="highlightTerm(l.text)"></span></template>
            </p>
          </template>
          <!-- 当前提示行：空闲时显示会话目录与 $；运行中显示识别出的 shell 提示符
               标记（# = root，$ = 普通用户，等价真终端提示符），未识别出（如
               su 密码提示期间）才显示低调的 > -->
          <div class="prompt-line">
            <template v-if="!running">
              <span class="prompt-dir">{{ promptDir }}</span>
              <span class="prompt">$</span>
            </template>
            <template v-else>
              <span v-if="shellPrompt" class="prompt">{{ shellPrompt }}</span>
              <span v-else class="prompt-run">&gt;</span>
            </template>
            <input
              ref="termInput"
              v-model="input"
              class="term-input"
              type="text"
              :placeholder="
                running
                  ? '运行中：输入内容回车后发送给进程（如 su 密码 / root shell 命令），Ctrl+C 中断'
                  : '输入命令（Tab 补全，Enter 执行，Ctrl+C 中断，↑/↓ 历史，Ctrl+L 清空）'
              "
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

.log-search {
  width: 140px;
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

/* 运行中（交互 shell）的输入前缀：低调的 >，提示符以 shell 自己输出的为准 */
.prompt-run {
  color: #8b949e;
  font-weight: 700;
  margin-right: 8px;
  user-select: none;
  flex-shrink: 0;
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
