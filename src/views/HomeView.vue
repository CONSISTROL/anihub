<script setup>
// 网站主页：公告 + 功能导航卡片（游客只看到允许访问的卡片）
import { computed, onMounted, ref } from 'vue'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'
import { getAnnouncement } from '../api/posts'
import AppIcon from '../components/AppIcon.vue'

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
      <span class="ann-label"><AppIcon name="megaphone" :size="15" /> 公告</span>
      <router-link :to="`/${announcement.category}/${announcement.slug}`" class="ann-body">
        <span class="ann-title">{{ announcement.title }}</span>
        <span v-if="announcement.summary" class="ann-summary">{{ announcement.summary }}</span>
      </router-link>
    </section>

    <section class="cards">
      <router-link
        v-for="(s, i) in visibleSections"
        :key="s.to"
        :to="s.to"
        class="card"
        :style="{ '--i': i }"
      >
        <img :src="s.img" class="card-img" :alt="s.title" loading="lazy" />
        <h2 class="card-title">{{ s.title }}</h2>
        <span class="card-go">进入 <AppIcon name="arrow-right" :size="14" /></span>
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
  animation: ios-rise-in var(--dur-ios-3) var(--ease-ios-expo) both;
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
  animation: ios-rise-in var(--dur-ios-3) var(--ease-ios-expo) 70ms both;
}

.ann-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  transition: color var(--dur-ios-1) var(--ease-ios-expo);
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
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
  animation: ios-rise-in var(--dur-ios-3) var(--ease-ios-expo)
    calc(140ms + var(--i, 0) * 70ms) backwards;
  will-change: transform;
}

.card:hover {
  transform: translateY(-4px) scale(1.012);
  border-color: var(--accent);
  box-shadow: 0 14px 36px rgb(0 0 0 / 0.14);
}

.card:active {
  transform: translateY(-1px) scale(0.985);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.card-img {
  width: 100%;
  height: 170px;
  object-fit: contain; /* 透明底插图，随卡片背景显示 */
  border-radius: 10px;
  transition: transform var(--dur-ios-2) var(--ease-ios-spring);
}

.card:hover .card-img {
  transform: scale(1.04);
}

.card-title {
  margin: 4px 0 0;
  font-size: 18px;
}

.card-go {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
  margin-top: auto;
}

/* —— 手机端适配 —— */
@media (max-width: 640px) {
  .home {
    padding: 24px 12px 40px;
  }

  .hero {
    padding: 28px 0 14px;
  }

  .site-name {
    font-size: 38px;
  }

  .cards {
    gap: 12px;
  }

  .card {
    padding: 18px;
  }

  .card-img {
    height: 136px;
  }
}
</style>
