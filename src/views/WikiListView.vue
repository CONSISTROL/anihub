<script setup>
// Wiki 条目列表页：支持「列表 / 拓扑图」两种视图切换，视图状态保存在 URL query 中，
// 这样从拓扑图点进条目再返回时仍会回到拓扑图视图。
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PostList from '../components/PostList.vue'
import WikiGraphView from '../components/WikiGraphView.vue'
import AppIcon from '../components/AppIcon.vue'

const route = useRoute()
const router = useRouter()

const viewMode = ref(route.query.view === 'graph' ? 'graph' : 'list')

watch(
  () => route.query.view,
  (view) => {
    viewMode.value = view === 'graph' ? 'graph' : 'list'
  }
)

function setMode(mode) {
  viewMode.value = mode
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
