<script setup>
// 网站主页：功能导航卡片（游客只看到允许访问的卡片）
import { computed } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'

const { isLoggedIn, isInsider } = useAuth()
const settings = useSettings()
if (!isLoggedIn.value) settings.load()

const SECTIONS = [
  {
    to: '/anime',
    page: 'anime',
    icon: '🗓️',
    title: 'Anime',
    desc: '当前档期新番放送时间表，精确到分钟。周历 / 月历 / 列表三种视图，支持中文标题与深浅主题。',
  },
  {
    to: '/blog',
    page: 'blog',
    icon: '📝',
    title: 'Blog',
    desc: '记录追番心得、推荐与杂谈。登录后即可发布文章，支持 Markdown 排版。',
  },
  {
    to: '/wiki',
    page: 'wiki',
    icon: '📚',
    title: 'Wiki',
    desc: '共同维护的动漫知识库：动画作品、术语、API 指南……登录后可编辑。',
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
      <p class="slogan">番剧时间表 · 追番笔记 · 动漫知识库</p>
    </section>

    <section class="cards">
      <router-link v-for="s in visibleSections" :key="s.to" :to="s.to" class="card">
        <span class="card-icon">{{ s.icon }}</span>
        <h2 class="card-title">{{ s.title }}</h2>
        <p class="card-desc">{{ s.desc }}</p>
        <span class="card-go">进入 →</span>
      </router-link>
    </section>
  </div>
</template>

<style scoped>
.home {
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 20px 60px;
}

.hero {
  text-align: center;
  padding: 48px 0 36px;
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

.slogan {
  margin: 10px 0 0;
  font-size: 16px;
  color: var(--muted);
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

.card-icon {
  font-size: 30px;
}

.card-title {
  margin: 0;
  font-size: 18px;
}

.card-desc {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
  flex: 1;
}

.card-go {
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
}
</style>
