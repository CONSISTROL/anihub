<script setup>
// 网站主页：公告 + 功能导航卡片（游客只看到允许访问的卡片）
import { computed, onMounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'
import { getAnnouncement } from '../api/posts'

const { isLoggedIn, isInsider } = useAuth()
const settings = useSettings()
if (!isLoggedIn.value) settings.load()

// 主页公告 = 置顶的博客文章（无公告时接口 404，静默隐藏）
const announcement = ref(null)
onMounted(async () => {
  try {
    announcement.value = await getAnnouncement()
  } catch {
    announcement.value = null
  }
})

const SECTIONS = [
  {
    to: '/anime',
    page: 'anime',
    img: '/home/anime.png',
    title: 'Anime',
  },
  {
    to: '/blog',
    page: 'blog',
    img: '/home/blog.png',
    title: 'Blog',
  },
  {
    to: '/wiki',
    page: 'wiki',
    img: '/home/wiki.png',
    title: 'Wiki',
  },
  {
    to: '/tools',
    page: 'tools',
    img: '/home/tools.png',
    title: 'Tools',
  },
  {
    to: '/game',
    page: 'game',
    img: '/home/game.png',
    title: 'Game',
  },
]

const visibleSections = computed(() =>
  isLoggedIn.value ? SECTIONS : SECTIONS.filter((s) => settings.canAccess(s.page, isInsider.value))
)
</script>

<template>
  <div class="home">
    <section class="hero">
      <h1 class="site-name">AniHub</h1>
    </section>

    <section v-if="announcement" class="announcement">
      <span class="ann-label">📢 公告</span>
      <router-link :to="`/${announcement.category}/${announcement.slug}`" class="ann-body">
        <span class="ann-title">{{ announcement.title }}</span>
        <span v-if="announcement.summary" class="ann-summary">{{ announcement.summary }}</span>
      </router-link>
    </section>

    <section class="cards">
      <router-link v-for="s in visibleSections" :key="s.to" :to="s.to" class="card">
        <img :src="s.img" class="card-img" :alt="s.title" loading="lazy" />
        <h2 class="card-title">{{ s.title }}</h2>
        <span class="card-go">进入 →</span>
      </router-link>
    </section>
  </div>
</template>

<style scoped>
.home {
  max-width: min(1320px, 95vw); /* 高分辨率适配 */
  margin: 0 auto;
  padding: 40px 20px 60px;
}

.hero {
  text-align: center;
  padding: 48px 0 20px;
}

.site-name {
  margin: 0;
  font-size: 52px;
  font-weight: 900;
  background: linear-gradient(135deg, var(--accent), #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.announcement {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  margin-top: 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 4px solid var(--accent);
  border-radius: 12px;
}

.ann-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
  white-space: nowrap;
}

.ann-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  text-decoration: none;
  color: var(--text);
}

.ann-title {
  font-size: 15px;
  font-weight: 600;
}

.ann-title:hover {
  color: var(--accent);
}

.ann-summary {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 18px;
  margin-top: 28px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  text-decoration: none;
  color: var(--text);
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.card:hover {
  transform: translateY(-3px);
  border-color: var(--accent);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.12);
}

.card-img {
  width: 100%;
  height: 170px;
  object-fit: contain; /* 透明底插图，随卡片背景显示 */
  border-radius: 10px;
}

.card-title {
  margin: 4px 0 0;
  font-size: 18px;
}

.card-go {
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
  margin-top: auto;
}
</style>
