<script setup>
// 设置页：目前仅支持配置哪些页面对游客可见
import { onMounted, ref } from 'vue'
import { getGuestPages, updateGuestPages } from '../api/settings'
import { useSettings } from '../composables/useSettings'

const settings = useSettings()

const OPTIONS = [
  { key: 'anime', label: 'Anime 日历', desc: '当前档期新番放送时间表' },
  { key: 'blog', label: 'Blog 博客', desc: '追番笔记与推荐' },
  { key: 'wiki', label: 'Wiki', desc: '动漫知识库' },
]

const selected = ref([])
const loading = ref(true)
const saving = ref(false)
const message = ref('')
const error = ref('')

onMounted(async () => {
  try {
    selected.value = await getGuestPages()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

async function onSave() {
  saving.value = true
  message.value = ''
  error.value = ''
  try {
    const pages = await updateGuestPages(selected.value)
    settings.apply(pages) // 导航 / 主页立即生效
    message.value = '已保存'
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="settings-page">
    <h1 class="page-title">设置</h1>
    <p class="sub">页面访问权限：选择哪些页面允许游客（未登录）查看，未勾选的页面登录后仍可访问</p>

    <p v-if="error" class="settings-error">{{ error }}</p>
    <p v-if="loading" class="settings-hint">加载中…</p>

    <div v-else class="settings-card">
      <label v-for="o in OPTIONS" :key="o.key" class="opt">
        <input type="checkbox" :value="o.key" v-model="selected" />
        <span class="opt-main">
          <span class="opt-label">{{ o.label }}</span>
          <span class="opt-desc">{{ o.desc }}</span>
        </span>
      </label>

      <div class="actions">
        <button class="btn btn-primary" :disabled="saving" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <span v-if="message" class="saved">{{ message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 560px;
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  margin: 0 0 6px;
  font-size: 24px;
}

.sub {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--muted);
}

.settings-error {
  color: #ff9d9d;
  font-size: 14px;
}

.settings-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 30px 0;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.opt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
}

.opt:hover {
  background: var(--panel-2);
}

.opt input {
  margin-top: 4px;
  accent-color: var(--accent);
}

.opt-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.opt-label {
  font-size: 14px;
  font-weight: 600;
}

.opt-desc {
  font-size: 12px;
  color: var(--muted);
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}

.saved {
  font-size: 13px;
  color: var(--accent);
}
</style>
