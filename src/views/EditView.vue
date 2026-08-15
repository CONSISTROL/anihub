<script setup>
// 新建/编辑文章（博客与 Wiki 共用，category 由路由 props 传入）
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createPost, getPostBySlug, updatePost } from '../api/posts'
import { useAuth } from '../composables/useAuth'
import MarkdownView from '../components/MarkdownView.vue'

const props = defineProps({
  category: { type: String, required: true }, // 'blog' | 'wiki'
})

const route = useRoute()
const router = useRouter()
const { isLoggedIn } = useAuth()

const slug = computed(() => (route.name.endsWith('-new') ? null : route.params.slug))
const postId = ref(null)

const isEdit = computed(() => !!slug.value)
const loading = ref(!!slug.value) // 编辑模式需要拉取原内容
const saving = ref(false)
const error = ref('')

const form = ref({ title: '', slug: '', summary: '', content_md: '', tags: '' })

async function loadExisting() {
  if (!slug.value) return
  try {
    const post = await getPostBySlug(slug.value)
    if (post.category !== props.category) {
      router.replace(`/${post.category}/${post.slug}/edit`)
      return
    }
    postId.value = post.id
    form.value = {
      title: post.title,
      slug: post.slug,
      summary: post.summary,
      content_md: post.contentMd,
      tags: post.tags.join('，'),
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => route.params.slug, loadExisting, { immediate: true })

function parseTags() {
  return form.value.tags
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

async function onSubmit() {
  error.value = ''
  saving.value = true
  const body = {
    category: props.category,
    title: form.value.title.trim(),
    summary: form.value.summary.trim(),
    content_md: form.value.content_md,
    tags: parseTags(),
  }
  if (form.value.slug.trim() && form.value.slug.trim() !== form.value.title.trim()) {
    body.slug = form.value.slug.trim()
  }
  try {
    const saved = isEdit.value
      ? await updatePost(postId.value, body)
      : await createPost(body)
    // 跳回文章页，用服务端生成的最终 slug
    router.replace(`/${props.category}/${saved.slug}`)
  } catch (e) {
    error.value = e.message
    saving.value = false
  }
}
</script>

<template>
  <div class="edit-page">
    <h1 class="page-title">{{ isEdit ? '编辑' : '新建' }}{{ category === 'blog' ? '文章' : 'Wiki 条目' }}</h1>
    <p v-if="error" class="edit-error">{{ error }}</p>
    <p v-if="loading" class="edit-hint">加载中…</p>

    <form v-else class="edit-card" @submit.prevent="onSubmit">
      <label class="field">
        <span>标题 *</span>
        <input v-model.trim="form.title" required maxlength="200" />
      </label>
      <label class="field">
        <span>链接别名（留空则按标题自动生成）</span>
        <input v-model.trim="form.slug" maxlength="80" placeholder="例如：2026-summer-anime-guide" />
      </label>
      <label class="field">
        <span>摘要（列表页显示）</span>
        <input v-model.trim="form.summary" maxlength="500" />
      </label>
      <label class="field">
        <span>标签（用逗号或空格分隔）</span>
        <input v-model.trim="form.tags" placeholder="例如：2026夏, 推荐, 攻略" />
      </label>
      <label class="field">
        <span>正文（Markdown）*</span>
        <textarea v-model="form.content_md" rows="14" required class="md-input"></textarea>
      </label>

      <div class="preview">
        <span class="preview-label">预览</span>
        <div class="preview-body">
          <MarkdownView v-if="form.content_md" :source="form.content_md" />
          <p v-else class="edit-hint">（正文为空，预览将显示在此处）</p>
        </div>
      </div>

      <div class="actions">
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <router-link :to="`/${category}`" class="btn">取消</router-link>
      </div>
    </form>
  </div>
</template>

<style scoped>
.edit-page {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  margin: 0 0 18px;
  font-size: 24px;
}

.edit-error {
  color: #ff9d9d;
  font-size: 14px;
}

.edit-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 30px 0;
}

.edit-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}

.field input,
.field textarea {
  padding: 9px 12px;
  font-size: 14px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  font-family: inherit;
}

.field input:focus,
.field textarea:focus {
  border-color: var(--accent);
}

.md-input {
  line-height: 1.6;
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preview-label {
  font-size: 13px;
  color: var(--muted);
}

.preview-body {
  padding: 16px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  min-height: 120px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}
</style>
