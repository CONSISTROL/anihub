<script setup>
// 文章列表（博客/Wiki 共用）：搜索、分页、新建入口；博客支持置顶（置顶篇即主页公告）
import { ref, watch } from 'vue'
import { listPosts, pinPost } from '../api/posts'
import { useAuth } from '../composables/useAuth'

const props = defineProps({
  category: { type: String, required: true }, // 'blog' | 'wiki'
})

const { isLoggedIn } = useAuth()

const items = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const q = ref('')
const loading = ref(true)
const error = ref('')
const actionError = ref('') // 置顶等操作的错误（与加载错误分开显示）
const pinningId = ref(0)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listPosts({
      category: props.category,
      page: page.value,
      pageSize: pageSize.value,
      q: q.value || undefined,
    })
    items.value = data.items
    total.value = data.total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => props.category, () => { page.value = 1; load() }, { immediate: true })

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize.value))

function onSearch() {
  page.value = 1
  load()
}

async function togglePin(p) {
  pinningId.value = p.id
  actionError.value = ''
  try {
    const updated = await pinPost(p.id, !p.pinned)
    p.pinned = updated.pinned
  } catch (e) {
    actionError.value = e.message
  } finally {
    pinningId.value = 0
  }
}

function fmtDate(s) {
  const d = new Date(s + 'Z')
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const VIS_LABEL = { insider: '仅内部可见', private: '仅管理员可见' }
</script>

<template>
  <div class="post-list">
    <div class="toolbar">
      <form class="search" @submit.prevent="onSearch">
        <input v-model.trim="q" placeholder="搜索标题 / 内容 / 标签…" />
        <button class="btn" type="submit">搜索</button>
      </form>
      <router-link v-if="isLoggedIn" :to="`/${category}/new`" class="btn btn-primary">
        新建{{ category === 'blog' ? '文章' : '条目' }}
      </router-link>
    </div>

    <p v-if="error" class="list-error">{{ error }}</p>
    <p v-else-if="loading" class="list-hint">加载中…</p>
    <p v-else-if="!items.length" class="list-hint">还没有{{ category === 'blog' ? '文章' : '条目' }}，来写第一篇吧</p>

    <template v-else>
      <p v-if="actionError" class="list-error">{{ actionError }}</p>
      <div class="post-items">
        <div
          v-for="p in items"
          :key="p.id"
          class="post-item"
          :class="{ 'is-pinned': p.pinned }"
        >
          <router-link :to="`/${category}/${p.slug}`" class="post-body">
            <div class="post-main">
              <h3 class="post-title">
                <span v-if="p.pinned" class="pin-badge">📌 公告</span>
                {{ p.title }}
              </h3>
              <p v-if="p.summary" class="post-summary">{{ p.summary }}</p>
              <div class="post-meta">
                <span class="post-author">{{ p.authorName }}</span>
                <span class="post-date">{{ fmtDate(p.createdAt) }}</span>
                <span v-if="p.visibility !== 'public'" class="post-hidden">{{ VIS_LABEL[p.visibility] || p.visibility }}</span>
                <span v-for="t in p.tags" :key="t" class="post-tag">#{{ t }}</span>
              </div>
            </div>
            <span class="post-go">→</span>
          </router-link>
          <div v-if="isLoggedIn && category === 'blog'" class="post-actions">
            <button class="btn btn-sm" :disabled="pinningId === p.id" @click="togglePin(p)">
              {{ pinningId === p.id ? '…' : p.pinned ? '取消置顶' : '置顶' }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <div v-if="totalPages() > 1" class="pager">
      <button class="btn" :disabled="page <= 1" @click="page--; load()">‹ 上一页</button>
      <span class="pager-info">{{ page }} / {{ totalPages() }} · 共 {{ total }} 篇</span>
      <button class="btn" :disabled="page >= totalPages()" @click="page++; load()">下一页 ›</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.search {
  display: flex;
  gap: 8px;
  flex: 1;
}

.search input {
  flex: 1;
  max-width: 320px;
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
}

.search input:focus {
  border-color: var(--accent);
}

.list-error {
  color: #ff9d9d;
  font-size: 14px;
  margin-bottom: 10px;
}

.list-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 40px 0;
}

.post-items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.post-item {
  display: flex;
  align-items: stretch;
  gap: 12px;
  padding: 16px 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  transition: border-color 0.15s, transform 0.15s;
}

.post-item:hover {
  border-color: var(--accent);
  transform: translateX(3px);
}

/* 置顶公告条目高亮 */
.post-item.is-pinned {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--panel));
}

.post-body {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  color: var(--text);
}

.post-main {
  flex: 1;
  min-width: 0;
}

.post-title {
  margin: 0 0 4px;
  font-size: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pin-badge {
  display: inline-block;
  margin-right: 6px;
  font-size: 11px;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-radius: 4px;
  padding: 0 6px;
  vertical-align: 2px;
}

.post-summary {
  margin: 0 0 6px;
  font-size: 13px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.post-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}

.post-tag {
  color: var(--accent);
}

.post-hidden {
  color: #ffb35c;
  border: 1px solid color-mix(in srgb, #ffb35c 50%, transparent);
  border-radius: 4px;
  padding: 0 6px;
  font-size: 11px;
}

.post-go {
  color: var(--accent);
  font-size: 16px;
}

.post-actions {
  display: flex;
  align-items: center;
}

.btn-sm {
  padding: 3px 9px;
  font-size: 12px;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 20px;
}

.pager-info {
  font-size: 13px;
  color: var(--muted);
}
</style>
