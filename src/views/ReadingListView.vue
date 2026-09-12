<script setup>
// 在线阅读书架（/reading）：列出当前身份可读的书。
// 只对内部人员（inside）与管理员开放 —— 游客访问会被路由守卫送走，
// 接口本身也会返回 401（页面隐藏按钮不等于没有权限，服务端也拦了一遍）。
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getBooks } from '../api/reading'
import { useAuth } from '../composables/useAuth'
import AppIcon from '../components/AppIcon.vue'

defineOptions({ name: 'ReadingListView' })

const router = useRouter()
const { isLoggedIn, isInsider } = useAuth()

const loading = ref(true)
const error = ref('')
const books = ref([])
const role = ref('')

function fmtSize(bytes) {
  if (!bytes) return ''
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`
}

onMounted(async () => {
  try {
    const d = await getBooks()
    books.value = d.books || []
    role.value = d.role || ''
  } catch (e) {
    // 游客 / 未授权：不提示"你没权限"，按站点惯例静默回首页
    if (e.status === 401) return router.replace({ name: 'home' })
    error.value = e.message
  } finally {
    loading.value = false
  }
})

const roleLabel = computed(() =>
  role.value === 'admin' ? '管理员' : role.value === 'insider' ? '内部人员' : ''
)
</script>

<template>
  <div class="reading-page">
    <header class="page-head">
      <h1 class="page-title"><AppIcon name="book-open" :size="22" /> 在线阅读</h1>
      <span v-if="roleLabel" class="role-chip">{{ roleLabel }}</span>
    </header>
    <p class="sub">
      <template v-if="isLoggedIn">全部藏书都可阅读。</template>
      <template v-else-if="isInsider">当前身份可阅读下列藏书。</template>
      <template v-else>选择一本书开始阅读。</template>
    </p>

    <p v-if="loading" class="hint">正在加载书架…</p>
    <p v-else-if="error" class="err-msg">{{ error }}</p>
    <p v-else-if="!books.length" class="hint">书架上暂时没有可阅读的书。</p>

    <div v-else class="book-grid">
      <router-link
        v-for="(b, i) in books"
        :key="b.id"
        class="book-card"
        :style="{ '--i': i }"
        :to="{ name: 'reading-book', params: { id: b.id } }"
      >
        <div class="book-cover">
          <img v-if="b.cover" :src="`/books/${b.id}/${b.cover}`" :alt="b.title" loading="lazy" decoding="async" />
          <span v-else class="book-cover-fallback" aria-hidden="true">
            <AppIcon name="book-open" :size="30" />
          </span>
        </div>
        <div class="book-body">
          <h2 class="book-title">{{ b.title }}</h2>
          <p class="book-meta">
            <span v-if="b.author">{{ b.author }}</span>
            <span v-if="b.author && b.size" class="dot">·</span>
            <span v-if="b.size">{{ fmtSize(b.size) }}</span>
          </p>
          <p v-if="b.summary" class="book-summary">{{ b.summary }}</p>
          <p v-if="b.tags?.length" class="book-tags">
            <span v-for="t in b.tags" :key="t" class="tag">{{ t }}</span>
          </p>
          <span class="book-go">开始阅读 <AppIcon name="arrow-right" :size="14" /></span>
        </div>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.reading-page {
  max-width: min(1160px, 95vw);
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-size: 24px;
}

.role-chip {
  margin-bottom: 6px;
  padding: 2px 9px;
  font-size: 12px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 999px;
}

.sub {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--muted);
}

.hint {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
}

.err-msg {
  margin: 0;
  font-size: 14px;
  color: var(--danger);
}

.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
  gap: 18px;
}

.book-card {
  display: flex;
  gap: 16px;
  padding: 18px;
  color: var(--text);
  text-decoration: none;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
  animation: ios-rise-in var(--dur-ios-3) var(--ease-ios-expo) calc(80ms + var(--i, 0) * 60ms) backwards;
}

.book-card:hover {
  transform: translateY(-4px);
  border-color: var(--accent);
  box-shadow: 0 14px 36px rgb(0 0 0 / 0.14);
}

.book-card:active {
  transform: translateY(-1px) scale(0.99);
  transition-duration: 70ms;
}

.book-cover {
  flex: 0 0 84px;
  width: 84px;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: color-mix(in srgb, var(--accent) 10%, var(--panel-2));
  border: 1px solid var(--border);
  border-radius: 10px;
}

.book-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.book-cover-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: color-mix(in srgb, var(--accent) 70%, transparent);
}

.book-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.book-title {
  margin: 0;
  font-size: 16px;
  line-height: 1.4;
}

.book-meta {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.book-meta .dot {
  margin: 0 5px;
}

.book-summary {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.book-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 2px 0 0;
}

.tag {
  padding: 1px 7px;
  font-size: 11px;
  color: var(--muted);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.book-go {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: auto;
  padding-top: 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
}

@media (max-width: 560px) {
  .book-grid {
    grid-template-columns: 1fr;
  }

  .book-card {
    padding: 14px;
  }

  .book-cover {
    flex-basis: 68px;
    width: 68px;
  }
}
</style>
