<script setup>
// 文件对比（Beyond Compare 风格）：文本逐行对比 + 文件夹对比。
// 纯前端：diff 用 jsdiff 的 diffArrays 逐行 LCS；文件/文件夹全部在本地读取，不上传。
import { computed, nextTick, ref } from 'vue'
import { diffArrays } from 'diff'

/* ================ 文本对比 ================ */
const leftText = ref('')
const rightText = ref('')
const rows = ref([]) // [{ left: {text,type,ln}, right: {...} }]
const leftFileName = ref('')
const rightFileName = ref('')
const changeIdx = ref(-1) // 当前差异序号
const textErr = ref('')

const blank = () => ({ text: '', type: 'blank', ln: null })

function toLines(s) {
  const t = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const l = t.split('\n')
  if (l.length > 1 && l[l.length - 1] === '') l.pop()
  return l
}

function runTextDiff() {
  textErr.value = ''
  const a = toLines(leftText.value)
  const b = toLines(rightText.value)
  if (a.length > 20000 || b.length > 20000) {
    textErr.value = '内容过大（单侧超过 2 万行），请缩小范围后再对比'
    return
  }
  const parts = diffArrays(a, b)
  const out = []
  let li = 0
  let ri = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const next = parts[i + 1]
    if (p.removed && next && next.added) {
      const n = Math.max(p.value.length, next.value.length)
      for (let k = 0; k < n; k++) {
        out.push({
          left: k < p.value.length ? { text: p.value[k], type: 'del', ln: li++ } : blank(),
          right: k < next.value.length ? { text: next.value[k], type: 'add', ln: ri++ } : blank(),
        })
      }
      i++
    } else if (p.added && next && next.removed) {
      const n = Math.max(p.value.length, next.value.length)
      for (let k = 0; k < n; k++) {
        out.push({
          left: k < next.value.length ? { text: next.value[k], type: 'del', ln: li++ } : blank(),
          right: k < p.value.length ? { text: p.value[k], type: 'add', ln: ri++ } : blank(),
        })
      }
      i++
    } else if (p.removed) {
      for (const line of p.value) out.push({ left: { text: line, type: 'del', ln: li++ }, right: blank() })
    } else if (p.added) {
      for (const line of p.value) out.push({ left: blank(), right: { text: line, type: 'add', ln: ri++ } })
    } else {
      for (const line of p.value) {
        out.push({
          left: { text: line, type: 'same', ln: li++ },
          right: { text: line, type: 'same', ln: ri++ },
        })
      }
    }
  }
  rows.value = out
  changeIdx.value = -1
}

const changeRows = computed(() => {
  const idxs = []
  rows.value.forEach((r, i) => {
    if (r.left.type === 'del' || r.right.type === 'add') idxs.push(i)
  })
  return idxs
})

const stats = computed(() => {
  const add = rows.value.filter((r) => r.right.type === 'add').length
  const del = rows.value.filter((r) => r.left.type === 'del').length
  return { add, del, changes: changeRows.value.length }
})

function goChange(dir) {
  if (!changeRows.value.length) return
  let idx = changeIdx.value
  if (dir > 0) idx = Math.min(changeRows.value.length - 1, idx + 1)
  else idx = Math.max(0, idx === -1 ? changeRows.value.length - 1 : idx - 1)
  if (dir === 0) idx = 0
  changeIdx.value = idx
  const row = changeRows.value[idx]
  nextTick(() => {
    const el = diffScroll.value?.querySelector(`[data-row="${row}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

function swapText() {
  const t = leftText.value
  leftText.value = rightText.value
  rightText.value = t
  const n = leftFileName.value
  leftFileName.value = rightFileName.value
  rightFileName.value = n
  runTextDiff()
}

const diffScroll = ref(null)

/* —— 文本文件上传 —— */
const leftFileInput = ref(null)
const rightFileInput = ref(null)
function loadTextFile(file, side) {
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    textErr.value = `${file.name} 超过 2MB，请直接粘贴文本对比`
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    if (side === 'left') {
      leftText.value = reader.result
      leftFileName.value = file.name
    } else {
      rightText.value = reader.result
      rightFileName.value = file.name
    }
    runTextDiff()
  }
  reader.readAsText(file)
}

/* ================ 文件夹对比 ================ */
const tab = ref('text') // text | folder
const leftFiles = ref([])
const rightFiles = ref([])
const leftDirName = ref('')
const rightDirName = ref('')
const folderFilter = ref('all')
const folderErr = ref('')
const leftDirInput = ref(null)
const rightDirInput = ref(null)

function onPickDir(side, e) {
  const files = [...(e.target.files || [])]
  const list = files.map((f) => ({
    rel: (f.webkitRelativePath || f.name).replace(/^[^/]*\//, ''), // 去掉顶层目录名
    name: f.name,
    size: f.size,
    mtime: f.lastModified,
    file: f,
  }))
  if (side === 'left') {
    leftFiles.value = list
    leftDirName.value = files[0]?.webkitRelativePath?.split('/')[0] || ''
  } else {
    rightFiles.value = list
    rightDirName.value = files[0]?.webkitRelativePath?.split('/')[0] || ''
  }
}

const folderItems = computed(() => {
  const lm = new Map(leftFiles.value.map((f) => [f.rel, f]))
  const rm = new Map(rightFiles.value.map((f) => [f.rel, f]))
  const keys = new Set([...lm.keys(), ...rm.keys()])
  const items = []
  for (const rel of keys) {
    const l = lm.get(rel)
    const r = rm.get(rel)
    let status
    if (!l) status = 'right-only'
    else if (!r) status = 'left-only'
    else if (l.size === r.size && l.mtime === r.mtime) status = 'same'
    else status = 'diff'
    items.push({ rel, status, l, r })
  }
  const order = { diff: 0, 'left-only': 1, 'right-only': 2, same: 3 }
  items.sort((a, b) => order[a.status] - order[b.status] || a.rel.localeCompare(b.rel, 'zh'))
  return items
})

const folderStats = computed(() => {
  const s = { same: 0, diff: 0, 'left-only': 0, 'right-only': 0 }
  folderItems.value.forEach((i) => s[i.status]++)
  return s
})

const filteredItems = computed(() => {
  if (folderFilter.value === 'all') return folderItems.value
  return folderItems.value.filter((i) => i.status === folderFilter.value)
})

function clearFolders() {
  leftFiles.value = []
  rightFiles.value = []
  leftDirName.value = ''
  rightDirName.value = ''
}

// 点击文件 → 加载两侧文本进入文本对比
async function openFileDiff(item) {
  folderErr.value = ''
  if (!item.l || !item.r) {
    folderErr.value = `${item.rel} 只存在于一侧，无法文本对比`
    return
  }
  if (item.l.size > 2 * 1024 * 1024 || item.r.size > 2 * 1024 * 1024) {
    folderErr.value = `${item.rel} 超过 2MB，请用其他工具对比`
    return
  }
  try {
    const [lt, rt] = await Promise.all([item.l.file.text(), item.r.file.text()])
    leftText.value = lt
    rightText.value = rt
    leftFileName.value = `左：${item.rel}`
    rightFileName.value = `右：${item.rel}`
    runTextDiff()
    tab.value = 'text'
  } catch {
    folderErr.value = `${item.rel} 读取失败（可能不是文本文件）`
  }
}

const STATUS_META = {
  diff: { icon: '⚠️', cls: 'diff', label: '不同' },
  'left-only': { icon: '←', cls: 'left-only', label: '仅左侧' },
  'right-only': { icon: '→', cls: 'right-only', label: '仅右侧' },
  same: { icon: '✓', cls: 'same', label: '相同' },
}

function humanSize(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="tool-page">
    <h1 class="page-title">🆚 文件对比</h1>
    <p class="sub">文本逐行对比 + 文件夹对比。纯前端处理，文件与文件夹全部在本地读取，不会上传。</p>

    <div class="tabs">
      <button class="btn tab-btn" :class="{ active: tab === 'text' }" @click="tab = 'text'">📄 文本对比</button>
      <button class="btn tab-btn" :class="{ active: tab === 'folder' }" @click="tab = 'folder'">📁 文件夹对比</button>
    </div>

    <!-- ============ 文本对比 ============ -->
    <div v-if="tab === 'text'" class="text-tab">
      <div class="inputs">
        <div class="input-col">
          <div class="col-head">
            <span class="col-name">{{ leftFileName || '左侧文本' }}</span>
            <input ref="leftFileInput" type="file" hidden @change="loadTextFile($event.target.files?.[0], 'left'); $event.target.value = ''" />
            <button class="btn btn-sm" @click="leftFileInput.click()">打开文件</button>
          </div>
          <textarea v-model="leftText" class="text-input" placeholder="粘贴左侧文本…" spellcheck="false"></textarea>
        </div>
        <div class="input-col">
          <div class="col-head">
            <span class="col-name">{{ rightFileName || '右侧文本' }}</span>
            <input ref="rightFileInput" type="file" hidden @change="loadTextFile($event.target.files?.[0], 'right'); $event.target.value = ''" />
            <button class="btn btn-sm" @click="rightFileInput.click()">打开文件</button>
          </div>
          <textarea v-model="rightText" class="text-input" placeholder="粘贴右侧文本…" spellcheck="false"></textarea>
        </div>
      </div>

      <div class="bar">
        <button class="btn btn-sm btn-primary" @click="runTextDiff">🔍 对比</button>
        <button class="btn btn-sm" @click="swapText">⇄ 交换左右</button>
        <button class="btn btn-sm" @click="leftText = ''; rightText = ''; rows = []; leftFileName = ''; rightFileName = ''; changeIdx = -1">清空</button>
        <span v-if="rows.length" class="bar-stats">
          {{ stats.changes }} 处差异 · <span class="add">+{{ stats.add }}</span> / <span class="del">-{{ stats.del }}</span> 行
        </span>
        <span v-if="changeRows.length" class="bar-nav">
          <button class="btn btn-sm" :disabled="changeIdx <= 0" @click="goChange(-1)">▲ 上一个差异</button>
          <button class="btn btn-sm" :disabled="changeIdx >= changeRows.length - 1" @click="goChange(1)">▼ 下一个差异</button>
          <span class="nav-pos">{{ changeIdx + 1 }} / {{ changeRows.length }}</span>
        </span>
      </div>
      <p v-if="textErr" class="tool-error">{{ textErr }}</p>

      <div v-if="rows.length" ref="diffScroll" class="diff-scroll">
        <div v-for="(r, i) in rows" :key="i" :data-row="i" class="diff-row" :class="{ changed: r.left.type !== 'same' || r.right.type !== 'same', current: i === changeRows[changeIdx] }">
          <span class="ln">{{ r.left.ln !== null ? r.left.ln + 1 : '' }}</span>
          <span class="cell" :class="r.left.type">{{ r.left.text || ' ' }}</span>
          <span class="ln">{{ r.right.ln !== null ? r.right.ln + 1 : '' }}</span>
          <span class="cell" :class="r.right.type">{{ r.right.text || ' ' }}</span>
        </div>
      </div>
      <p v-else-if="leftText || rightText" class="side-empty">点击「对比」查看逐行差异</p>
    </div>

    <!-- ============ 文件夹对比 ============ -->
    <div v-else class="folder-tab">
      <div class="inputs">
        <div class="input-col">
          <div class="col-head">
            <span class="col-name">{{ leftDirName || '左侧文件夹' }}</span>
            <input ref="leftDirInput" type="file" webkitdirectory multiple hidden @change="onPickDir('left', $event)" />
            <button class="btn btn-sm" @click="leftDirInput.click()">选择文件夹</button>
          </div>
          <div class="dir-preview">
            <p v-if="leftFiles.length" class="dir-count">共 {{ leftFiles.length }} 个文件</p>
            <p v-else class="side-empty">选择左侧文件夹（webkitdirectory）</p>
          </div>
        </div>
        <div class="input-col">
          <div class="col-head">
            <span class="col-name">{{ rightDirName || '右侧文件夹' }}</span>
            <input ref="rightDirInput" type="file" webkitdirectory multiple hidden @change="onPickDir('right', $event)" />
            <button class="btn btn-sm" @click="rightDirInput.click()">选择文件夹</button>
          </div>
          <div class="dir-preview">
            <p v-if="rightFiles.length" class="dir-count">共 {{ rightFiles.length }} 个文件</p>
            <p v-else class="side-empty">选择右侧文件夹（webkitdirectory）</p>
          </div>
        </div>
      </div>

      <div class="bar">
        <button class="btn btn-sm btn-primary" :disabled="!leftFiles.length && !rightFiles.length" @click="folderFilter = 'all'">刷新对比</button>
        <button class="btn btn-sm" @click="clearFolders">清空</button>
        <span v-if="folderItems.length" class="bar-stats">
          <span class="f-same">✓ 相同 {{ folderStats.same }}</span> ·
          <span class="f-diff">⚠ 不同 {{ folderStats.diff }}</span> ·
          <span class="f-left">← 仅左 {{ folderStats['left-only'] }}</span> ·
          <span class="f-right">→ 仅右 {{ folderStats['right-only'] }}</span>
        </span>
      </div>
      <p v-if="folderErr" class="tool-error">{{ folderErr }}</p>

      <div v-if="folderItems.length" class="folder-list-head">
        <div class="filters">
          <button class="btn btn-sm" :class="{ active: folderFilter === 'all' }" @click="folderFilter = 'all'">全部</button>
          <button class="btn btn-sm" :class="{ active: folderFilter === 'diff' }" @click="folderFilter = 'diff'">不同 ({{ folderStats.diff }})</button>
          <button class="btn btn-sm" :class="{ active: folderFilter === 'left-only' }" @click="folderFilter = 'left-only'">仅左侧 ({{ folderStats['left-only'] }})</button>
          <button class="btn btn-sm" :class="{ active: folderFilter === 'right-only' }" @click="folderFilter = 'right-only'">仅右侧 ({{ folderStats['right-only'] }})</button>
          <button class="btn btn-sm" :class="{ active: folderFilter === 'same' }" @click="folderFilter = 'same'">相同 ({{ folderStats.same }})</button>
        </div>
      </div>

      <div v-if="filteredItems.length" class="folder-list">
        <button v-for="item in filteredItems" :key="item.rel" class="file-row" :class="STATUS_META[item.status].cls" @click="openFileDiff(item)">
          <span class="f-icon">{{ STATUS_META[item.status].icon }}</span>
          <span class="f-status">{{ STATUS_META[item.status].label }}</span>
          <span class="f-path" :title="item.rel">{{ item.rel }}</span>
          <span class="f-meta">
            {{ item.l ? humanSize(item.l.size) : '—' }}
            <template v-if="item.r"> / {{ humanSize(item.r.size) }}</template>
          </span>
        </button>
      </div>
      <p v-else-if="leftFiles.length || rightFiles.length" class="side-empty">该筛选下没有文件</p>
    </div>
  </div>
</template>

<style scoped>
.tool-page {
  max-width: 100%; /* 对比工具占满页面宽度，两侧不留空 */
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  margin: 0 0 6px;
  font-size: 24px;
}

.sub {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--muted);
}

.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.tab-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}

.inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.input-col {
  min-width: 0;
}

.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.col-name {
  font-size: 13px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.text-input {
  width: 100%;
  min-height: 240px;
  padding: 10px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  resize: vertical;
  white-space: pre;
  tab-size: 2;
}

.text-input:focus {
  outline: none;
  border-color: var(--accent);
}

.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 12px 0;
}

.bar-stats {
  font-size: 13px;
  color: var(--muted);
}

.bar-stats .add {
  color: #5ad06b;
}

.bar-stats .del {
  color: #ff6b6b;
}

.bar-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

.nav-pos {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.tool-error {
  color: #ff9d9d;
  font-size: 13px;
  margin: 6px 0;
}

/* —— 差异表格 —— */
.diff-scroll {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: auto;
  max-height: 60vh;
  background: var(--panel);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.5;
}

.diff-row {
  display: flex;
  min-width: max-content;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
}

.diff-row.current {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.ln {
  width: 46px;
  flex-shrink: 0;
  padding: 0 8px;
  text-align: right;
  color: var(--muted);
  background: var(--panel-2);
  border-right: 1px solid var(--border);
  user-select: none;
  font-size: 11px;
  line-height: 1.5;
}

.cell {
  flex: 1;
  min-width: 260px;
  padding: 0 10px;
  white-space: pre;
  overflow: visible;
}

.cell.del {
  background: color-mix(in srgb, #ff5c5c 20%, transparent);
}

.cell.add {
  background: color-mix(in srgb, #37b24d 18%, transparent);
}

.cell.blank {
  background: color-mix(in srgb, var(--border) 35%, transparent);
}

/* —— 文件夹对比 —— */
.dir-preview {
  min-height: 120px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dir-count {
  font-size: 13px;
  color: var(--muted);
}

.side-empty {
  font-size: 13px;
  color: var(--muted);
  text-align: center;
  padding: 24px 0;
}

.f-same { color: #9aa5b1; }
.f-diff { color: #ffa94d; }
.f-left { color: #66a3ff; }
.f-right { color: #e599f7; }

.folder-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 10px 0;
}

.filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.folder-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 52vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px;
  background: var(--panel);
}

.file-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  width: 100%;
}

.file-row:hover {
  background: var(--panel-2);
}

.file-row.diff { border-color: color-mix(in srgb, #ffa94d 45%, transparent); }
.file-row.left-only { border-color: color-mix(in srgb, #66a3ff 45%, transparent); }
.file-row.right-only { border-color: color-mix(in srgb, #e599f7 45%, transparent); }

.f-icon {
  flex-shrink: 0;
  width: 22px;
  text-align: center;
}

.f-status {
  flex-shrink: 0;
  width: 56px;
  font-size: 12px;
  color: var(--muted);
}

.file-row.diff .f-status { color: #ffa94d; }
.file-row.left-only .f-status { color: #66a3ff; }
.file-row.right-only .f-status { color: #e599f7; }
.file-row.same .f-status { color: #9aa5b1; }

.f-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.f-meta {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 860px) {
  .inputs {
    grid-template-columns: 1fr;
  }
}
</style>
