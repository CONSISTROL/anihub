<script setup>
// Wiki 条目列表页：支持「列表 / 拓扑图」两种视图切换。
// 视图状态同时保存在 URL query 与 localStorage 中：
// - URL 带 ?view=graph 时优先按 URL 显示（支持分享/前进后退）
// - URL 不带 view 时使用上次选择，因此从其它页面回到 /wiki 仍能保持拓扑图
import { defineAsyncComponent, h, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostList from '../components/PostList.vue'
import AppIcon from '../components/AppIcon.vue'
import { useAuth } from '../composables/useAuth'
import { exportWikiZip, importWikiZip } from '../api/posts'

// 拓扑图组件（three.js 三维「电子绕核/行星绕日」渲染）只在切到“拓扑图”时下载/解析，
// 默认列表视图不加载它，Wiki 首屏能少下载一块 JS。
const WikiGraphView = defineAsyncComponent({
  loader: () => import('../components/WikiGraphView.vue'),
  loadingComponent: {
    render: () =>
      h(
        'p',
        {
          style: {
            color: 'var(--muted)',
            fontSize: '14px',
            textAlign: 'center',
            padding: '48px 0',
          },
        },
        '图谱加载中…'
      ),
  },
})

const route = useRoute()
const router = useRouter()
const STORAGE_KEY = 'anihub.wiki-view'

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

function writeStored(view) {
  try { localStorage.setItem(STORAGE_KEY, view) } catch {}
}

function resolveInitialView() {
  const q = route.query.view
  if (q === 'graph' || q === 'list') return q
  return readStored() === 'graph' ? 'graph' : 'list'
}

const viewMode = ref(resolveInitialView())

watch(
  () => route.query.view,
  (view) => {
    if (view === 'graph' || view === 'list') {
      viewMode.value = view
      writeStored(view)
    }
  }
)

function setMode(mode) {
  viewMode.value = mode
  writeStored(mode)
  const query = { ...route.query }
  if (mode === 'graph') query.view = 'graph'
  else delete query.view
  router.replace({ query })
}

// —— 管理员批量导出 / 导入（wiki）——
const { isLoggedIn } = useAuth() // 登录即管理员（个人站不开放注册）
const xferBusy = ref(false)
const xferMsg = ref('')
const xferErr = ref(false)
const fileInput = ref(null)

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function doExport() {
  xferBusy.value = true
  xferMsg.value = ''
  xferErr.value = false
  try {
    const blob = await exportWikiZip()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wiki-backup-${stamp()}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    xferMsg.value = `已导出 ${a.download}（${(blob.size / 1024).toFixed(0)} KB）`
  } catch (e) {
    xferErr.value = true
    xferMsg.value = `导出失败：${e.message}`
  } finally {
    xferBusy.value = false
  }
}

async function onImportFile(e) {
  const f = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!f) return
  xferBusy.value = true
  xferMsg.value = ''
  xferErr.value = false
  try {
    const r = await importWikiZip(f)
    const parts = [`新增 ${r.imported}`, `跳过 ${r.skipped}`]
    if (r.images) parts.push(`图片：写入 ${r.images.written} / 已存在 ${r.images.skipped} / 缺失 ${r.images.missing}`)
    xferMsg.value = `导入完成：${parts.join(' · ')}`
    if (r.errors && r.errors.length) {
      xferErr.value = true
      xferMsg.value += `（${r.errors.length} 条问题，详见控制台）`
      console.warn('[wiki-import]', r.errors)
    }
  } catch (err) {
    xferErr.value = true
    xferMsg.value = `导入失败：${err.message}`
  } finally {
    xferBusy.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title"><AppIcon name="book-open" :size="22" /> Wiki</h1>
      <div class="view-switch" role="tablist" aria-label="Wiki 视图切换">
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'list'"
          :class="{ on: viewMode === 'list' }"
          @click="setMode('list')"
        >
          列表
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'graph'"
          :class="{ on: viewMode === 'graph' }"
          @click="setMode('graph')"
        >
          拓扑图
        </button>
      </div>
    </div>

    <!-- 管理员：批量导出 / 导入 wiki -->
    <div v-if="isLoggedIn" class="admin-bar">
      <span class="admin-label">批量管理</span>
      <button type="button" class="admin-btn" :disabled="xferBusy" @click="doExport">
        导出全部 Wiki (.zip)
      </button>
      <button type="button" class="admin-btn" :disabled="xferBusy" @click="fileInput?.click()">
        导入 Wiki 备份
      </button>
      <input
        ref="fileInput"
        type="file"
        accept=".zip,application/zip"
        class="file-input"
        @change="onImportFile"
      />
      <span v-if="xferBusy" class="admin-status">处理中…</span>
      <span v-else-if="xferMsg" class="admin-status" :class="{ err: xferErr }">{{ xferMsg }}</span>
    </div>

    <PostList v-if="viewMode === 'list'" category="wiki" />
    <WikiGraphView v-else />
  </div>
</template>

<style scoped>
.page {
  /* 高分辨率适配：随视口变宽，上限 1280px */
  max-width: min(1320px, 95vw);
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 24px;
}

.view-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.view-switch button {
  padding: 6px 16px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo);
}

.view-switch button:hover {
  color: var(--text);
  background: var(--panel-2);
}

.view-switch button.on {
  background: var(--accent);
  color: #fff;
}

/* —— 管理员批量导出/导入 —— */
.admin-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: -4px 0 16px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel) 80%, transparent);
}

.admin-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
  margin-right: 2px;
}

.admin-btn {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo),
    background var(--dur-ios-1) var(--ease-ios-expo);
}

.admin-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.admin-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.file-input {
  display: none;
}

.admin-status {
  font-size: 12px;
  color: var(--muted);
}

.admin-status.err {
  color: #ff9d9d;
}

@media (max-width: 640px) {
  .page-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
