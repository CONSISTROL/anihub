<script setup>
// 文章详情（博客/Wiki 共用）：Markdown 渲染 + 作者操作
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getPostBySlug, deletePost } from '../api/posts'
import { useAuth } from '../composables/useAuth'
import MarkdownView from './MarkdownView.vue'
import RichTextView from './RichTextView.vue'

const props = defineProps({
  category: { type: String, required: true },
  slug: { type: String, required: true },
})

const route = useRoute()
const router = useRouter()
const { isLoggedIn } = useAuth()

const post = ref(null)
const loading = ref(true)
const error = ref('')
const deleting = ref(false)

const canEdit = computed(() => post.value?.canEdit && isLoggedIn.value)

async function load() {
  loading.value = true
  error.value = ''
  try {
    post.value = await getPostBySlug(props.slug)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => props.slug, load, { immediate: true })

async function onDelete() {
  if (!window.confirm('确定删除这篇文章吗？此操作不可恢复。')) return
  deleting.value = true
  try {
    await deletePost(post.value.id)
    router.replace(`/${props.category}`)
  } catch (e) {
    alert(e.message)
    deleting.value = false
  }
}

function fmtDateTime(s) {
  const d = new Date(s + 'Z')
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const VIS_LABEL = { insider: '仅内部可见', private: '仅管理员可见' }
</script>

<template>
  <div class="post-detail">
    <p v-if="error" class="detail-error">{{ error }}</p>
    <p v-else-if="loading" class="detail-hint">加载中…</p>

    <article v-else-if="post" class="post-card">
      <header class="post-head">
        <h1 class="post-title">{{ post.title }}</h1>
        <div class="post-meta">
          <span>作者：{{ post.authorName }}</span>
          <span>发布于 {{ fmtDateTime(post.createdAt) }}</span>
          <span v-if="post.updatedAt !== post.createdAt">更新于 {{ fmtDateTime(post.updatedAt) }}</span>
          <span v-if="post.visibility !== 'public'" class="post-hidden">{{ VIS_LABEL[post.visibility] || post.visibility }}</span>
          <span v-for="t in post.tags" :key="t" class="post-tag">#{{ t }}</span>
        </div>
      </header>

      <MarkdownView v-if="post.format !== 'html' && post.contentMd" :source="post.contentMd" />
      <RichTextView v-else-if="post.format === 'html' && post.contentHtml" :source="post.contentHtml" />
      <p v-else class="detail-hint">（暂无内容）</p>

      <footer v-if="canEdit" class="post-actions">
        <router-link :to="`/${category}/${post.slug}/edit`" class="btn">编辑</router-link>
        <button class="btn btn-danger" :disabled="deleting" @click="onDelete">
          {{ deleting ? '删除中…' : '删除' }}
        </button>
      </footer>
    </article>
  </div>
</template>

<style scoped>
.post-detail {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.detail-error {
  color: #ff9d9d;
  font-size: 14px;
}

.detail-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 40px 0;
}

.post-card {
  padding: 28px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
}

.post-head {
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.post-title {
  margin: 0 0 10px;
  font-size: 24px;
  line-height: 1.35;
}

.post-meta {
  display: flex;
  flex-wrap: wrap;
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

.post-actions {
  margin-top: 26px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 10px;
}

.btn-danger {
  color: #ff9d9d;
  border-color: color-mix(in srgb, #ff5c5c 50%, var(--border));
}

.btn-danger:hover {
  border-color: #ff5c5c;
}
</style>
