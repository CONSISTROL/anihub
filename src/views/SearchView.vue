<script setup>
// 站内搜索：一次搜索博客 / Wiki 文章（服务端过滤可见性）与服务器已缓存的档期动漫
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listPosts } from '../api/posts'
import { searchAnime } from '../api/anilist'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'
import AppIcon from '../components/AppIcon.vue'

const route = useRoute()
const router = useRouter()
const { isLoggedIn, isInsider } = useAuth()
const settings = useSettings()
settings.load() // 需要 showAdult（成人内容身份开关）与页面可见性

const q = ref(route.query.q || '')
const loading = ref(false)
const done = ref(false)
const posts = ref([])
const anime = ref([])
const error = ref('')

function canSee(page) {
  return isLoggedIn.value || settings.canAccess(page, isInsider.value)
}

function onSearch() {
  const kw = q.value.trim()
  if (!kw) return
  if (route.query.q !== kw) router.replace({ name: 'search', query: { q: kw } })
  else runSearch(kw)
}

watch(
  () => route.query.q,
  (v) => {
    q.value = v || ''
    if (v) runSearch(v)
  },
  { immediate: true }
)

async function runSearch(kw) {
  await settings.load() // 确保成人内容身份开关等设置已加载（URL 直访时与搜索存在竞态）
  loading.value = true
  done.value = false
  error.value = ''
  posts.value = []
  anime.value = []
  const tasks = []
  if (canSee('blog') || canSee('wiki')) {
    tasks.push(
      listPosts({ q: kw, pageSize: 50 })
        .then((d) => { posts.value = d.items })
        .catch((e) => { error.value = e.message })
    )
  }
  if (canSee('anime')) {
    tasks.push(
      searchAnime(kw)
        .then((items) => {
          // 成人内容按身份过滤；服务端只搜索已缓存档期，不会回源 AniList
          anime.value = items
            .filter((a) => !a.isAdult || settings.canSeeAdult(isLoggedIn.value, isInsider.value))
            .slice(0, 30)
        })
        .catch((e) => { error.value = e.message })
    )
  }
  await Promise.all(tasks)
  loading.value = false
  done.value = true
}

const blogPosts = computed(() => posts.value.filter((p) => p.category === 'blog'))
const wikiPosts = computed(() => posts.value.filter((p) => p.category === 'wiki'))
const hasAny = computed(() => blogPosts.value.length || wikiPosts.value.length || anime.value.length)

function fmtDate(s) {
  const d = new Date(s + 'Z')
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
</script>

<template>
  <div class="search-page">
    <h1 class="page-title"><AppIcon name="search" :size="22" /> 站内搜索</h1>
    <form class="search-bar" @submit.prevent="onSearch">
      <input v-model.trim="q" placeholder="搜索博客 / Wiki / 动漫…" autofocus />
      <button class="btn btn-primary" type="submit"><AppIcon name="search" :size="13" /> 搜索</button>
    </form>

    <p v-if="error" class="search-error">{{ error }}</p>
    <p v-else-if="loading" class="search-hint">搜索中…</p>
    <p v-else-if="done && !q" class="search-hint">输入关键词，回车搜索站内内容</p>
    <p v-else-if="done && !hasAny" class="search-hint">没有找到与「{{ q }}」相关的内容</p>

    <template v-else-if="done && hasAny">
      <!-- 博客 -->
      <section v-if="canSee('blog') && blogPosts.length" class="result-section">
        <h2 class="section-title"><AppIcon name="file-text" :size="16" /> 博客 <span class="count">{{ blogPosts.length }}</span></h2>
        <router-link v-for="p in blogPosts" :key="'b' + p.id" :to="`/blog/${p.slug}`" class="result-item">
          <div class="result-main">
            <span class="result-title"><span v-if="p.pinned" class="pin-tag"><AppIcon name="pin" :size="11" /> 公告</span>{{ p.title }}</span>
            <span v-if="p.summary" class="result-summary">{{ p.summary }}</span>
          </div>
          <span class="result-date">{{ fmtDate(p.createdAt) }}</span>
        </router-link>
      </section>

      <!-- Wiki -->
      <section v-if="canSee('wiki') && wikiPosts.length" class="result-section">
        <h2 class="section-title"><AppIcon name="book-open" :size="16" /> Wiki <span class="count">{{ wikiPosts.length }}</span></h2>
        <router-link v-for="p in wikiPosts" :key="'w' + p.id" :to="`/wiki/${p.slug}`" class="result-item">
          <div class="result-main">
            <span class="result-title">{{ p.title }}</span>
            <span v-if="p.summary" class="result-summary">{{ p.summary }}</span>
          </div>
          <span class="result-date">{{ fmtDate(p.createdAt) }}</span>
        </router-link>
      </section>

      <!-- 动漫（来自服务器已缓存的档期数据） -->
      <section v-if="canSee('anime') && anime.length" class="result-section">
        <h2 class="section-title"><AppIcon name="calendar" :size="16" /> 动漫 <span class="count">{{ anime.length }}</span></h2>
        <div class="anime-grid">
          <router-link v-for="a in anime" :key="a.id" to="/anime" class="anime-item">
            <img v-if="a.cover" :src="a.cover" class="anime-cover" alt="" loading="lazy" />
            <div class="anime-info">
              <span class="anime-name">{{ a.title }}</span>
              <span class="anime-season">{{ a.season }}</span>
            </div>
          </router-link>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.search-page {
  max-width: min(960px, 95vw); /* 高分辨率适配 */
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px;
  font-size: 24px;
}

.search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
}

.search-bar input {
  flex: 1;
  padding: 10px 14px;
  font-size: 14px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  outline: none;
}

.search-bar input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.search-error {
  color: #ff9d9d;
  font-size: 14px;
}

.search-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 40px 0;
}

.result-section {
  margin-bottom: 26px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: 16px;
}

.count {
  font-size: 12px;
  color: var(--muted);
  font-weight: 400;
  margin-left: 4px;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  text-decoration: none;
  color: var(--text);
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
  animation: ios-rise-in var(--dur-ios-3) var(--ease-ios-expo) backwards;
}

.result-section .result-item:nth-child(2) {
  animation-delay: 60ms;
}
.result-section .result-item:nth-child(3) {
  animation-delay: 110ms;
}
.result-section .result-item:nth-child(4) {
  animation-delay: 160ms;
}
.result-section .result-item:nth-child(n + 5) {
  animation-delay: 210ms;
}

.result-item:hover {
  border-color: var(--accent);
  transform: translateX(4px);
  box-shadow: 0 8px 22px rgb(0 0 0 / 0.1);
}

.result-item:active {
  transform: translateX(2px) scale(0.995);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.result-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.result-title {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pin-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 6px;
  font-size: 11px;
  color: var(--accent);
}

.result-summary {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.result-date {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}

.anime-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.anime-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  text-decoration: none;
  color: var(--text);
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
  animation: ios-rise-in var(--dur-ios-3) var(--ease-ios-expo) backwards;
}

.anime-grid .anime-item:nth-child(1) {
  animation-delay: 40ms;
}
.anime-grid .anime-item:nth-child(2) {
  animation-delay: 90ms;
}
.anime-grid .anime-item:nth-child(3) {
  animation-delay: 140ms;
}
.anime-grid .anime-item:nth-child(4) {
  animation-delay: 190ms;
}
.anime-grid .anime-item:nth-child(n + 5) {
  animation-delay: 240ms;
}

.anime-item:hover {
  border-color: var(--accent);
  transform: translateY(-3px) scale(1.01);
  box-shadow: 0 8px 22px rgb(0 0 0 / 0.1);
}

.anime-cover {
  width: 48px;
  height: 67px; /* 2:3 封面比例 */
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}

.anime-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.anime-name {
  font-size: 13px;
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.anime-season {
  font-size: 11px;
  color: var(--muted);
}
</style>
