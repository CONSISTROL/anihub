<script setup>
// Wiki 条目列表页：支持「列表 / 拓扑图」两种视图切换。
// 视图状态同时保存在 URL query 与 localStorage 中：
// - URL 带 ?view=graph 时优先按 URL 显示（支持分享/前进后退）
// - URL 不带 view 时使用上次选择，因此从其它页面回到 /wiki 仍能保持拓扑图
import { defineAsyncComponent, h, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostList from '../components/PostList.vue'
import AppIcon from '../components/AppIcon.vue'

// 拓扑图组件（含力导向布局 + SVG 渲染）只在切到“拓扑图”时下载/解析，
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

@media (max-width: 640px) {
  .page-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
