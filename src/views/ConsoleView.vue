<script setup>
// 管理员控制台：在服务器上执行命令（项目根目录）+ 查看服务端实时日志。
// 仅管理员可访问（路由 auth + 服务端 authRequired 双重校验）。
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { execCommand, getConsoleLogs } from '../api/settings'

const input = ref('')
const running = ref(false)
const lines = ref([]) // { type: 'cmd'|'out'|'err'|'info'|'log'|'warn'|'error', text }
const history = ref([])
const histIdx = ref(-1)
const outEl = ref(null)
const errMsg = ref('')

const logLines = ref([]) // 服务器日志
const logErr = ref('')
let logTimer = null
const platform = ref('') // 服务器平台（用于命令提示）

const WELCOME = `AniHub 管理员控制台
工作目录: ${location.origin} 对应的服务器项目根目录
输入命令回车执行（支持 shell 语法），↑/↓ 浏览历史，Ctrl+L 清空`

function push(type, text) {
  lines.value.push({ type, text: String(text) })
}

async function run() {
  const cmd = input.value.trim()
  if (!cmd || running.value) return
  history.value.push(cmd)
  histIdx.value = -1
  input.value = ''
  push('cmd', cmd)
  running.value = true
  errMsg.value = ''
  try {
    const r = await execCommand(cmd)
    if (r.stdout) push('out', r.stdout.replace(/\n$/, ''))
    if (r.stderr) push('err', r.stderr.replace(/\n$/, ''))
    push('info', `[退出码 ${r.exitCode}${r.timedOut ? ' · 超时终止(15s)' : ''}]`)
  } catch (e) {
    push('err', `执行失败: ${e.message}`)
  } finally {
    running.value = false
    scrollBottom()
  }
}

function onKeydown(e) {
  if (e.ctrlKey && e.key === 'l') {
    e.preventDefault()
    lines.value = []
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    run()
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
onUnmounted(() => clearInterval(logTimer))
</script>

<template>
  <div class="console-page">
    <p v-if="errMsg" class="tool-error">{{ errMsg }}</p>

    <div class="console-grid">
      <!-- 命令控制台 -->
      <section class="term-panel">
        <div class="term-head">
          <span>🖥️ 命令控制台</span>
          <button class="btn btn-sm" @click="lines = []">清空输出</button>
        </div>
        <div ref="outEl" class="term-out">
          <p v-for="(l, i) in lines" :key="i" class="term-line" :class="l.type">
            <template v-if="l.type === 'cmd'"><span class="prompt">$</span> {{ l.text }}</template>
            <template v-else>{{ l.text }}</template>
          </p>
        </div>
        <div class="term-input-row">
          <span class="prompt">$</span>
          <input
            v-model="input"
            class="term-input"
            type="text"
            placeholder="输入命令，回车执行（Windows 用 dir、type；Linux 用 ls、cat）；↑/↓ 历史，Ctrl+L 清空"
            :disabled="running"
            spellcheck="false"
            @keydown="onKeydown"
          />
          <button class="btn btn-sm" :disabled="running || !input.trim()" @click="run">
            {{ running ? '执行中…' : '执行' }}
          </button>
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
}

.term-line.cmd {
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
}

.term-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #c9d1d9;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Courier New", "Microsoft YaHei", "PingFang SC", monospace;
  font-size: 13px;
  padding: 4px 0;
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
