<script setup>
// 控制台“本地 Web”：自动列出服务器本机监听的 TCP 端口，也支持手动输入
// IP:端口/路径。点击后先确保 /local-web 专用 Cookie 已建立，再在新标签页中
// 通过反向代理打开完整页面（仅允许回环地址，管理员可用）。
import { onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { createLocalWebSession, getLocalWebServices } from '../api/localWeb'

const input = ref('')
const services = ref([])
const loading = ref(false)
const error = ref('')
const authError = ref('')
const scannedAt = ref(null)

const RECENT_KEY = 'anihub.localWeb.recents'
const recents = ref([])
try {
  recents.value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
  if (!Array.isArray(recents.value)) recents.value = []
} catch {
  recents.value = []
}

function saveRecents() {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents.value.slice(0, 8)))
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase()
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  )
}

/** 把用户输入（127.0.0.1:8080、localhost:3000/a?b=1、http://127.0.0.1:8080）转成代理 URL */
function buildProxyUrl(raw) {
  let s = String(raw || '').trim()
  if (!s) {
    error.value = '请输入本机 Web 服务地址'
    return ''
  }
  if (/^https?:\/\//i.test(s)) {
    s = s.slice(s.indexOf('://') + 3)
  }
  const slash = s.indexOf('/')
  const authority = slash < 0 ? s : s.slice(0, slash)
  const suffix = slash < 0 ? '/' : s.slice(slash)
  const idx = authority.lastIndexOf(':')
  if (idx <= 0) {
    error.value = '地址需要包含端口，例如 127.0.0.1:8080'
    return ''
  }
  let host = authority.slice(0, idx).trim()
  const portText = authority.slice(idx + 1).trim()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  host = host.toLowerCase()
  if (host === '0.0.0.0') host = '127.0.0.1'
  if (!isLoopbackHost(host)) {
    error.value = '仅支持访问服务器本机回环地址：localhost / 127.0.0.1 / [::1]'
    return ''
  }
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    error.value = '端口不合法'
    return ''
  }
  const displayHost = host === '::1' ? '[::1]' : host
  return `/local-web/http/${displayHost}:${port}${suffix || '/'}`
}

function pushRecent(url) {
  recents.value = [url, ...recents.value.filter((r) => r !== url)].slice(0, 8)
  saveRecents()
}

async function ensureSession() {
  try {
    await createLocalWebSession()
    authError.value = ''
  } catch (e) {
    authError.value = e.message
    throw e
  }
}

function openProxy(raw) {
  error.value = ''
  const proxyUrl = buildProxyUrl(raw)
  if (!proxyUrl) return
  // 先同步打开，避免 await 后触发浏览器弹窗拦截；Cookie 一般已在进入面板时建立。
  // 后台再刷新一次授权，保证之后继续打开的标签页也有有效 Cookie。
  window.open(proxyUrl, '_blank', 'noopener')
  ensureSession().catch(() => {
    // 如果授权失败，已打开的标签页会显示 401 提示；这里把错误同步到面板。
    error.value = '授权失败，请点击“刷新”后重试'
  })
  pushRecent(raw.trim())
}

function openService(service) {
  openProxy(service.endpoint)
}

async function loadServices(force = false) {
  loading.value = true
  error.value = ''
  try {
    const data = await getLocalWebServices(force)
    services.value = data.services || []
    scannedAt.value = data.scannedAt || null
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function refresh() {
  ensureSession().catch(() => {})
  loadServices(true)
}

function clearRecents() {
  recents.value = []
  saveRecents()
}

onMounted(() => {
  // 提前建立 Cookie，避免新标签页弹出后第一次请求 401
  ensureSession().catch(() => {})
  loadServices()
})
</script>

<template>
  <div class="local-web">
    <div class="lw-toolbar">
      <input
        v-model.trim="input"
        class="lw-input"
        type="text"
        spellcheck="false"
        placeholder="例如 127.0.0.1:8080、localhost:3000/dashboard"
        @keydown.enter="openProxy(input)"
      />
      <button class="lw-btn primary" title="通过网站反向代理在新标签页打开" @click="openProxy(input)">
        <AppIcon name="external-link" :size="13" /> 新标签页打开
      </button>
      <button class="lw-btn" title="重新扫描本机监听端口" @click="refresh">
        <AppIcon name="refresh" :size="13" /> 刷新
      </button>
    </div>

    <p v-if="authError" class="lw-error">授权失败：{{ authError }}（仅管理员可使用）</p>
    <p v-if="error" class="lw-error">{{ error }}</p>
    <p v-if="loading" class="lw-status">正在扫描本机监听端口…</p>

    <div v-else-if="services.length" class="lw-section">
      <h3 class="lw-title">本机监听的 TCP 端口</h3>
      <p class="lw-tip">
        列表来自本机监听端口扫描，包含数据库 / SSH 等非 Web 服务；点击后如显示“无法连接”说明该端口不是可访问的 HTTP 服务。
      </p>
      <div class="lw-grid">
        <button v-for="s in services" :key="s.id" class="lw-service" :title="`打开 http://${s.endpoint}/`" @click="openService(s)">
          <span class="lw-service-icon"><AppIcon name="globe" :size="15" /></span>
          <span class="lw-service-main">
            <span class="lw-service-name"><code>{{ s.endpoint }}</code></span>
            <span class="lw-service-meta">{{ s.current ? 'AniHub · 本站' : '本地监听服务' }}</span>
          </span>
          <span class="lw-service-open"><AppIcon name="external-link" :size="13" /></span>
        </button>
      </div>
    </div>

    <div v-else class="lw-empty">
      <p>未发现可用的本机监听端口，或当前环境不支持自动扫描。</p>
      <p class="lw-empty-sub">可以直接在上方输入 <code>127.0.0.1:端口</code> 或 <code>localhost:端口/路径</code> 打开。</p>
    </div>

    <div v-if="recents.length" class="lw-section lw-recent">
      <div class="lw-recent-head">
        <h3 class="lw-title">最近访问</h3>
        <button class="lw-btn small" @click="clearRecents">清空</button>
      </div>
      <div class="lw-grid">
        <button v-for="r in recents" :key="r" class="lw-service" :title="`再次打开 ${r}`" @click="openProxy(r)">
          <span class="lw-service-icon"><AppIcon name="history" :size="15" /></span>
          <span class="lw-service-main">
            <span class="lw-service-name"><code>{{ r }}</code></span>
            <span class="lw-service-meta">最近打开</span>
          </span>
          <span class="lw-service-open"><AppIcon name="external-link" :size="13" /></span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.local-web {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0d1117;
  color: #e6edf3;
  font-size: 13px;
  padding: 12px 14px;
  box-sizing: border-box;
  overflow-y: auto;
}

.lw-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.lw-input {
  flex: 1;
  min-width: 260px;
  padding: 7px 12px;
  background: #0d1117;
  border: 1px solid #2a3441;
  border-radius: 8px;
  color: #e6edf3;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 13px;
  outline: none;
}

.lw-input:focus {
  border-color: #58a6ff;
  box-shadow: 0 0 0 3px rgb(88 166 255 / 0.15);
}

.lw-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  background: #21262d;
  border: 1px solid #2a3441;
  border-radius: 8px;
  color: #e6edf3;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
}

.lw-btn:hover:not(:disabled) {
  border-color: #58a6ff;
  color: #58a6ff;
}

.lw-btn.primary {
  background: #1f6feb;
  border-color: #1f6feb;
  color: #fff;
}

.lw-btn.small {
  padding: 3px 8px;
  font-size: 12px;
}

.lw-error {
  color: #f85149;
  margin: 0 0 10px;
  word-break: break-all;
}

.lw-status {
  color: #8b949e;
  margin: 0;
  padding: 30px 0;
  text-align: center;
}

.lw-section {
  margin-top: 4px;
}

.lw-title {
  margin: 0 0 4px;
  font-size: 13px;
  color: #e6edf3;
}

.lw-tip {
  margin: 0 0 10px;
  font-size: 12px;
  color: #8b949e;
  line-height: 1.6;
}

.lw-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
}

.lw-service {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: #161b22;
  border: 1px solid #2a3441;
  border-radius: 8px;
  color: #e6edf3;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.18s ease,
    transform 0.18s ease,
    background 0.18s ease;
}

.lw-service:hover {
  border-color: #58a6ff;
  background: #1c2128;
  transform: translateY(-1px);
}

.lw-service:active {
  transform: scale(0.97);
}

.lw-service-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 6px;
  background: #21262d;
  color: #58a6ff;
}

.lw-service-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lw-service-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lw-service-name code {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12.5px;
  color: #e6edf3;
}

.lw-service-meta {
  font-size: 11px;
  color: #8b949e;
}

.lw-service-open {
  display: flex;
  align-items: center;
  color: #8b949e;
  flex-shrink: 0;
}

.lw-service:hover .lw-service-open {
  color: #58a6ff;
}

.lw-empty {
  padding: 40px 16px;
  text-align: center;
  color: #8b949e;
  border: 1px dashed #2a3441;
  border-radius: 10px;
}

.lw-empty p {
  margin: 0 0 6px;
}

.lw-empty .lw-empty-sub {
  font-size: 12px;
  opacity: 0.85;
}

.lw-recent {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid #2a3441;
}

.lw-recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
</style>
