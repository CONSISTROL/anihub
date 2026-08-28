<script setup>
// 控制台文件管理：浏览服务器目录、上传文件、下载文件（仅管理员）。
// startPath/startTick：与终端工作目录同步——打开文件管理或终端 cd 后自动定位到终端目录。
import { ref, watch, onMounted } from 'vue'
import { useAuth } from '../composables/useAuth'

const props = defineProps({
  startPath: { type: String, default: '' },
  startTick: { type: Number, default: 0 },
})

const { token } = useAuth()

const cwd = ref('')
const entries = ref([])
const loading = ref(false)
const uploading = ref(false)
const error = ref('')
const fileInput = ref(null)
const pathInput = ref('')
const editorVisible = ref(false)
const editingPath = ref('')
const editingName = ref('')
const editContent = ref('')
const saving = ref(false)

watch(cwd, (v) => {
  pathInput.value = v
})

async function api(url, options = {}) {
  const headers = {
    Authorization: `Bearer ${token.value}`,
    ...(options.headers || {}),
  }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    let msg = res.statusText
    let path = ''
    try {
      const data = await res.json()
      msg = data?.error?.message || msg
      path = data?.error?.path || ''
    } catch {}
    const err = new Error(msg)
    err.path = path
    throw err
  }
  return res
}

function parentPath(p) {
  const norm = String(p || '').replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  if (idx <= 0) return norm || '/'
  return norm.slice(0, idx) || '/'
}

async function load(dir) {
  loading.value = true
  error.value = ''
  try {
    const q = dir ? `?path=${encodeURIComponent(dir)}` : ''
    const res = await api(`/api/console/files${q}`)
    const data = await res.json()
    cwd.value = data.cwd
    entries.value = data.entries || []
  } catch (e) {
    error.value = e.message
    // 加载失败时也把尝试访问的路径显示到顶部输入框，方便看到/修改出错路径
    const failedPath = e.path || dir
    if (failedPath) pathInput.value = failedPath
  } finally {
    loading.value = false
  }
}

function openEntry(entry) {
  if (entry.type === 'directory') load(entry.path)
}

function goUp() {
  load(parentPath(cwd.value))
}

function refresh() {
  load(cwd.value)
}

function goToPath() {
  const p = pathInput.value.trim()
  if (p) load(p)
}

async function onUpload(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  if (!files.length) return
  uploading.value = true
  error.value = ''
  try {
    for (const file of files) {
      const url = `/api/console/files/upload?dir=${encodeURIComponent(cwd.value)}&name=${encodeURIComponent(file.name)}`
      const res = await api(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      await res.json()
    }
    await load(cwd.value)
  } catch (e) {
    error.value = e.message
  } finally {
    uploading.value = false
  }
}

async function download(entry) {
  error.value = ''
  try {
    const res = await api(`/api/console/files/download?path=${encodeURIComponent(entry.path)}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = entry.name
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = e.message
  }
}

function isHtml(name) {
  return /\.html?$/i.test(name)
}

async function openEditor(entry) {
  if (entry.type !== 'file') return
  error.value = ''
  try {
    const res = await api(`/api/console/files/content?path=${encodeURIComponent(entry.path)}`)
    const data = await res.json()
    editingPath.value = data.path
    editingName.value = data.name
    editContent.value = data.content
    editorVisible.value = true
  } catch (e) {
    error.value = e.message
  }
}

async function saveEditor() {
  if (!editingPath.value) return
  saving.value = true
  error.value = ''
  try {
    await api(`/api/console/files/content?path=${encodeURIComponent(editingPath.value)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: editContent.value,
    })
    editorVisible.value = false
    await load(cwd.value)
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

function closeEditor() {
  if (!saving.value) editorVisible.value = false
}

async function removeEntry(entry) {
  if (!window.confirm(`确定删除 ${entry.name} 吗？删除后不可恢复。`)) return
  error.value = ''
  try {
    await api(`/api/console/files?path=${encodeURIComponent(entry.path)}`, { method: 'DELETE' })
    await load(cwd.value)
  } catch (e) {
    error.value = e.message
  }
}

async function previewHtml(entry) {
  if (!isHtml(entry.name)) return
  error.value = ''
  try {
    const res = await api(`/api/console/files/download?path=${encodeURIComponent(entry.path)}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    // 延迟释放，避免新标签页还没加载完 blob 就被回收
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (e) {
    error.value = e.message
  }
}

function formatSize(n) {
  if (n == null) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTime(ms) {
  if (!ms) return '-'
  const d = new Date(ms)
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(() => load(props.startPath || ''))

// 终端 cd 后 / 每次打开文件管理：重新定位到终端当前目录
watch(
  [() => props.startPath, () => props.startTick],
  () => {
    if (props.startPath) load(props.startPath)
  }
)
</script>

<template>
  <div class="file-manager">
    <div class="fm-toolbar">
      <button class="fm-btn" title="上一级" @click="goUp">⬆ 上级</button>
      <button class="fm-btn" title="刷新" @click="refresh">⟳ 刷新</button>
      <button class="fm-btn primary" title="上传文件到当前目录" @click="fileInput.click()" :disabled="uploading">
        {{ uploading ? '上传中…' : '⬆ 上传文件' }}
      </button>
      <input ref="fileInput" type="file" multiple class="hidden-input" @change="onUpload" />
      <input
        v-model="pathInput"
        class="fm-path-input"
        type="text"
        spellcheck="false"
        placeholder="输入路径，例如 /home"
        @keydown.enter="goToPath"
      />
      <button class="fm-btn" @click="goToPath">跳转</button>
    </div>

    <p v-if="error" class="fm-error">{{ error }}</p>
    <p v-if="loading" class="fm-status">加载中…</p>

    <div class="fm-table-wrap">
      <table class="fm-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>大小</th>
            <th>修改时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in entries" :key="entry.path" :class="{ dir: entry.type === 'directory' }" @dblclick="openEntry(entry)">
            <td>
              <span class="fm-icon">{{ entry.type === 'directory' ? '📁' : '📄' }}</span>
              <span class="fm-name">{{ entry.name }}</span>
            </td>
            <td>{{ entry.type === 'directory' ? '-' : formatSize(entry.size) }}</td>
            <td>{{ formatTime(entry.mtime) }}</td>
            <td>
              <template v-if="entry.type === 'directory'">
                <button class="fm-btn small" @click="openEntry(entry)">进入</button>
                <button class="fm-btn small danger" @click="removeEntry(entry)">删除</button>
              </template>
              <template v-else>
                <button v-if="isHtml(entry.name)" class="fm-btn small" @click="previewHtml(entry)">预览</button>
                <button class="fm-btn small" @click="download(entry)">下载</button>
                <button class="fm-btn small" @click="openEditor(entry)">编辑</button>
                <button class="fm-btn small danger" @click="removeEntry(entry)">删除</button>
              </template>
            </td>
          </tr>
          <tr v-if="!entries.length && !loading">
            <td colspan="4" class="fm-empty">当前目录为空</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 在线编辑弹窗 -->
    <div v-if="editorVisible" class="fm-editor-mask" @click.self="closeEditor">
      <div class="fm-editor">
        <div class="fm-editor-head">
          <span class="fm-editor-title">编辑 {{ editingName }}</span>
          <button class="fm-btn small" :disabled="saving" @click="closeEditor">关闭</button>
        </div>
        <textarea v-model="editContent" class="fm-editor-text" spellcheck="false"></textarea>
        <div class="fm-editor-foot">
          <button class="fm-btn primary" :disabled="saving" @click="saveEditor">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-manager {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0d1117;
  color: #e6edf3;
  font-size: 13px;
  padding: 10px;
  box-sizing: border-box;
}

.fm-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.fm-btn {
  padding: 5px 12px;
  background: #21262d;
  border: 1px solid #2a3441;
  border-radius: 6px;
  color: #e6edf3;
  font-size: 12.5px;
  cursor: pointer;
}

.fm-btn:hover:not(:disabled) {
  border-color: #58a6ff;
  color: #58a6ff;
}

.fm-btn.primary {
  background: #1f6feb;
  border-color: #1f6feb;
  color: #fff;
}

.fm-btn.small {
  padding: 2px 8px;
  font-size: 12px;
}

/* 操作列按钮间距 */
.fm-table td .fm-btn + .fm-btn {
  margin-left: 6px;
}

.fm-btn.danger {
  color: #f85149;
  border-color: #3d1d1d;
}

.fm-btn.danger:hover:not(:disabled) {
  border-color: #f85149;
  color: #f85149;
}

.fm-path-input {
  flex: 1;
  min-width: 200px;
  padding: 5px 10px;
  background: #0d1117;
  border: 1px solid #2a3441;
  border-radius: 6px;
  color: #e6edf3;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12.5px;
  outline: none;
}

.fm-path-input:focus {
  border-color: #58a6ff;
}

.hidden-input {
  display: none;
}

.fm-error {
  color: #f85149;
  margin: 0 0 8px;
}

.fm-status {
  color: #8b949e;
  margin: 0 0 8px;
}

.fm-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #2a3441;
  border-radius: 8px;
}

.fm-table {
  width: 100%;
  border-collapse: collapse;
}

.fm-table th,
.fm-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid #1c2128;
  white-space: nowrap;
}

.fm-table th {
  position: sticky;
  top: 0;
  background: #161b22;
  color: #8b949e;
  font-weight: 600;
  z-index: 1;
}

.fm-table tr:hover {
  background: #161b22;
}

.fm-table tr.dir {
  cursor: pointer;
}

.fm-icon {
  margin-right: 6px;
}

.fm-name {
  font-family: Consolas, 'Courier New', monospace;
}

.fm-empty {
  text-align: center;
  color: #8b949e;
  padding: 30px 0;
}

/* 在线编辑弹窗 */
.fm-editor-mask {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.fm-editor {
  width: min(900px, 100%);
  height: min(80vh, 700px);
  display: flex;
  flex-direction: column;
  background: #0d1117;
  border: 1px solid #2a3441;
  border-radius: 10px;
  overflow: hidden;
}

.fm-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: #161b22;
  border-bottom: 1px solid #2a3441;
}

.fm-editor-title {
  font-size: 13px;
  color: #e6edf3;
  word-break: break-all;
}

.fm-editor-text {
  flex: 1;
  min-height: 0;
  padding: 12px;
  background: #0d1117;
  border: none;
  outline: none;
  color: #e6edf3;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  tab-size: 2;
}

.fm-editor-foot {
  display: flex;
  justify-content: flex-end;
  padding: 8px 12px;
  background: #161b22;
  border-top: 1px solid #2a3441;
}
</style>
