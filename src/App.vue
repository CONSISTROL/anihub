<script setup>
import { computed, ref, watch } from 'vue'
import Calendar from './components/Calendar.vue'
import WeekView from './components/WeekView.vue'
import ListView from './components/ListView.vue'
import SeasonSwitcher from './components/SeasonSwitcher.vue'
import LanguageSelector from './components/LanguageSelector.vue'
import ThemeSelector from './components/ThemeSelector.vue'
import BackgroundWall from './components/BackgroundWall.vue'
import AnimeDetail from './components/AnimeDetail.vue'
import { useSeason } from './composables/useSeason'
import { titleFor } from './utils/titles'
import { addDays, mondayOf, weekBounds, weekRangeLabel } from './utils/date'

const {
  year,
  season,
  month,
  mediaMap,
  schedules,
  noScheduleAnime,
  loading,
  error,
  load,
  goSeason,
  goMonth,
  canPrevMonth,
  canNextMonth,
} = useSeason()

// 视图切换：week 周历（默认） / month 月历 / list 列表
const view = ref('week')

// 周视图状态：当前显示周的周一；导航范围限制在当前档期覆盖的周内
const weekStart = ref(mondayOf(new Date()))
const bounds = computed(() => weekBounds({ year: year.value, season: season.value }))

function clampWeek() {
  const { minStart, maxStart } = bounds.value
  const t = weekStart.value.getTime()
  if (t < minStart.getTime()) weekStart.value = minStart
  else if (t > maxStart.getTime()) weekStart.value = maxStart
}
clampWeek()
watch([year, season], clampWeek)

const weekLabel = computed(() => weekRangeLabel(weekStart.value))
const canPrevWeek = computed(
  () => weekStart.value.getTime() > bounds.value.minStart.getTime()
)
const canNextWeek = computed(
  () => weekStart.value.getTime() < bounds.value.maxStart.getTime()
)

function goWeek(delta) {
  weekStart.value = addDays(weekStart.value, delta * 7)
  clampWeek()
}

function onCurrent() {
  load()
  weekStart.value = mondayOf(new Date()) // 回到当前档期时跳到本周
}

// 详情弹窗
const selectedId = ref(null)
const selectedMedia = computed(() =>
  selectedId.value ? mediaMap.value.get(selectedId.value) : null
)
const selectedEpisodes = computed(() =>
  schedules.value.filter((s) => s.mediaId === selectedId.value)
)
</script>

<template>
  <div class="app">
    <BackgroundWall :media-map="mediaMap" />
    <header class="header">
      <h1 class="logo">🗓️ 动漫日历</h1>
      <div class="header-actions">
        <SeasonSwitcher
          :year="year"
          :season="season"
          :loading="loading"
          @prev="goSeason(-1)"
          @current="onCurrent"
          @next="goSeason(1)"
        />
        <LanguageSelector />
        <ThemeSelector />
      </div>
    </header>

    <div v-if="error" class="banner error">
      <p>数据加载失败：{{ error }}</p>
      <button class="btn" @click="load">重试</button>
    </div>

    <div v-else-if="loading" class="loading">
      <div class="spinner"></div>
      <p>正在加载 {{ year }} 档期数据…</p>
    </div>

    <main v-else class="main">
      <div class="month-bar">
        <button
          class="btn"
          :disabled="view === 'week' ? !canPrevWeek : !canPrevMonth"
          @click="view === 'week' ? goWeek(-1) : goMonth(-1)"
        >‹</button>
        <span class="month-label">
          {{ view === 'week' ? weekLabel : `${month.y}年${month.m + 1}月` }}
        </span>
        <button
          class="btn"
          :disabled="view === 'week' ? !canNextWeek : !canNextMonth"
          @click="view === 'week' ? goWeek(1) : goMonth(1)"
        >›</button>
        <span class="month-count">{{ schedules.length }} 条放送记录</span>
        <div class="view-toggle">
          <button
            class="toggle-btn"
            :class="{ active: view === 'week' }"
            @click="view = 'week'"
          >周历</button>
          <button
            class="toggle-btn"
            :class="{ active: view === 'month' }"
            @click="view = 'month'"
          >月历</button>
          <button
            class="toggle-btn"
            :class="{ active: view === 'list' }"
            @click="view = 'list'"
          >列表</button>
        </div>
      </div>

      <WeekView
        v-if="view === 'week'"
        :week-start="weekStart"
        :schedules="schedules"
        :media-map="mediaMap"
        @select="selectedId = $event"
      />

      <Calendar
        v-else-if="view === 'month'"
        :month="month"
        :schedules="schedules"
        :media-map="mediaMap"
        @select="selectedId = $event"
      />

      <ListView
        v-else
        :month="month"
        :schedules="schedules"
        :media-map="mediaMap"
        @select="selectedId = $event"
      />

      <section v-if="noScheduleAnime.length" class="nosched">
        <h2>本档期暂无排期的动画</h2>
        <div class="nosched-list">
          <button
            v-for="m in noScheduleAnime"
            :key="m.id"
            class="nosched-chip"
            @click="selectedId = m.id"
          >
            {{ titleFor(m) }}
          </button>
        </div>
      </section>

      <footer class="footer">
        数据来源：<a href="https://anilist.co" target="_blank" rel="noreferrer">AniList</a>
        · 时间为本地时区显示
      </footer>
    </main>

    <AnimeDetail
      :media="selectedMedia"
      :episodes="selectedEpisodes"
      @close="selectedId = null"
    />
  </div>
</template>

<style scoped>
.app {
  max-width: 1080px;
  margin: 0 auto;
  padding: 20px 20px 40px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 18px;
}

.logo {
  margin: 0;
  font-size: 22px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  margin-bottom: 16px;
}

.banner p {
  margin: 0;
  font-size: 14px;
}

.banner.error {
  background: color-mix(in srgb, #ff5c5c 12%, var(--panel));
  border: 1px solid color-mix(in srgb, #ff5c5c 40%, transparent);
  color: #ff9d9d;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 80px 0;
  color: var(--muted);
}

.spinner {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 3px solid var(--panel-2);
  border-top-color: var(--accent);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.month-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.month-label {
  font-size: 15px;
  font-weight: 700;
  min-width: 200px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.month-count {
  font-size: 12px;
  color: var(--muted);
}

.view-toggle {
  margin-left: auto;
  display: flex;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

.toggle-btn {
  padding: 6px 16px;
  font-size: 13px;
  color: var(--muted);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.toggle-btn + .toggle-btn {
  border-left: 1px solid var(--border);
}

.toggle-btn:hover {
  color: var(--text);
}

.toggle-btn.active {
  background: var(--accent);
  color: #fff;
}

.nosched {
  margin-top: 22px;
}

.nosched h2 {
  font-size: 14px;
  color: var(--muted);
  margin: 0 0 10px;
  font-weight: 600;
}

.nosched-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nosched-chip {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border: 1px dashed var(--border);
  border-radius: 999px;
  cursor: pointer;
}

.nosched-chip:hover {
  color: var(--text);
  border-color: var(--accent);
}

.footer {
  margin-top: 26px;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
}

.footer a {
  color: var(--accent);
  text-decoration: none;
}
</style>
