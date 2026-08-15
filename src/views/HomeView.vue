<script setup>
// 网站主页：功能导航卡片
import { useAuth } from '../composables/useAuth'

const { isLoggedIn, user } = useAuth()

const SECTIONS = [
  {
    to: '/calendar',
    icon: '🗓️',
    title: '动漫日历',
    desc: '当前档期新番放送时间表，精确到分钟。周历 / 月历 / 列表三种视图，支持中文标题与深浅主题。',
  },
  {
    to: '/blog',
    icon: '📝',
    title: '博客',
    desc: '记录追番心得、推荐与杂谈。注册即可发布文章，支持 Markdown 排版。',
  },
  {
    to: '/wiki',
    icon: '📚',
    title: 'Wiki',
    desc: '共同维护的动漫知识库：动画作品、术语、API 指南……人人可编辑。',
  },
]
</script>

<template>
  <div class="home">
    <section class="hero">
      <h1 class="site-name">AniHub</h1>
      <p class="slogan">番剧时间表 · 追番笔记 · 动漫知识库</p>
      <p class="welcome" v-if="isLoggedIn">
        欢迎回来，{{ user?.username }} 👋
      </p>
      <div class="hero-actions" v-else>
        <router-link to="/register" class="btn btn-primary">注册</router-link>
        <router-link to="/login" class="btn">登录</router-link>
      </div>
    </section>

    <section class="cards">
      <router-link v-for="s in SECTIONS" :key="s.to" :to="s.to" class="card">
        <span class="card-icon">{{ s.icon }}</span>
        <h2 class="card-title">{{ s.title }}</h2>
        <p class="card-desc">{{ s.desc }}</p>
        <span class="card-go">进入 →</span>
      </router-link>
    </section>

    <footer class="home-footer">
      数据来源：<a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a>
      · 时间为本地时区显示
    </footer>
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

.welcome {
  margin: 14px 0 0;
  font-size: 14px;
  color: var(--muted);
}

.hero-actions {
  margin-top: 18px;
  display: flex;
  justify-content: center;
  gap: 10px;
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

.home-footer {
  margin-top: 40px;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

.home-footer a {
  color: var(--accent);
  text-decoration: none;
}
</style>
