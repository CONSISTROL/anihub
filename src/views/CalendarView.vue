<script setup>
// 动漫日历视图（由原 App.vue 迁移而来，逻辑与样式保持原样）
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import Calendar from '../components/Calendar.vue'
import WeekView from '../components/WeekView.vue'
import ListView from '../components/ListView.vue'
import LanguageSelector from '../components/LanguageSelector.vue'
import AnimeBackground from '../components/AnimeBackground.vue'
import AnimeDetail from '../components/AnimeDetail.vue'
import AppIcon from '../components/AppIcon.vue'
import { useSeason } from '../composables/useSeason'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'
import { refreshSeasonData, searchAnime } from '../api/anilist'
import { ZH_GENRES } from '../data/zhGenres'
import { lang } from '../composables/useLanguage'
import { addDays, mondayOf, weekRangeLabel, dayKey, toApiSeason, seasonOf, SEASONS, buildMonthGrid } from '../utils/date'

const route = useRoute()
const initialSeason = (() => {
  const y = Number(route.query.year)
  const s = String(route.query.season || '').toUpperCase()
  if (SEASONS[s] && Number.isInteger(y)) return { year: y, season: s }
  return undefined
})()

const {
  year,
  season,
  month,
  mediaMap,
  schedules,
  loading,
  error,
  load,
  goToSeason,
  goMonth,
  ensureRangeForDate,
  canPrevMonth,
  canNextMonth,
} = useSeason(initialSeason)

const { isLoggedIn, isInsider } = useAuth()
const settings = useSettings()
settings.load()

// 视图切换：week 周历（默认） / month 月历 / list 列表
const view = ref('week')

// 周视图状态：连续日历，不限制季度边界
const weekStart = ref(mondayOf(new Date()))

const weekLabel = computed(() => weekRangeLabel(weekStart.value))
// 连续日历始终可翻
const canPrevWeek = computed(() => true)
const canNextWeek = computed(() => true)

// 背景花纹按当前实际显示的日期所属档期变化：周历看 weekStart，月历/列表看 month
const displaySeason = computed(() =>
  view.value === 'week'
    ? seasonOf(weekStart.value).season
    : seasonOf(new Date(month.value.y, month.value.m, 1)).season
)

async function goWeek(delta) {
  const next = addDays(weekStart.value, delta * 7)
  weekStart.value = next
  await ensureRangeForDate(next)
}

// 指定日期跳转
const jumpDate = ref(dayKey(new Date()))
async function jumpToDate() {
  if (!jumpDate.value) return
  const d = new Date(`${jumpDate.value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return
  month.value = { y: d.getFullYear(), m: d.getMonth() }
  weekStart.value = mondayOf(d)
  await ensureRangeForDate(d)
}

// —— 自定义日期选择日历（替代浏览器原生 date picker） ——
const DP_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const todayKey = dayKey(new Date())
const pickerOpen = ref(false)
const pickerYear = ref(new Date().getFullYear())
const pickerMonth = ref(new Date().getMonth())
const pickerDays = computed(() => buildMonthGrid(pickerYear.value, pickerMonth.value).flat())

function openPicker() {
  const d = new Date(`${jumpDate.value || todayKey}T00:00:00`)
  if (!Number.isNaN(d.getTime())) {
    pickerYear.value = d.getFullYear()
    pickerMonth.value = d.getMonth()
  }
  pickerOpen.value = !pickerOpen.value
}

function pickerShift(delta) {
  const d = new Date(pickerYear.value, pickerMonth.value + delta, 1)
  pickerYear.value = d.getFullYear()
  pickerMonth.value = d.getMonth()
}

function pickerToday() {
  const now = new Date()
  pickerYear.value = now.getFullYear()
  pickerMonth.value = now.getMonth()
}

function pickDay(date) {
  if (!date) return
  jumpDate.value = dayKey(date)
  pickerOpen.value = false
  jumpToDate()
}

// 点击日历浮层外部 / Esc 关闭
function onDocPointerDown(e) {
  if (pickerOpen.value && !e.target.closest('.jump-form')) pickerOpen.value = false
}
function onDocKeydown(e) {
  if (e.key === 'Escape') pickerOpen.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onDocKeydown)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onDocKeydown)
})

async function onCurrent() {
  const now = new Date()
  month.value = { y: now.getFullYear(), m: now.getMonth() }
  weekStart.value = mondayOf(now) // 回到当前时间所在的周
  await ensureRangeForDate(now)
}

// 管理员手动重新拉取 AniList（绕过服务端缓存）
const refreshing = ref(false)
const refreshMsg = ref('')
async function onRefresh() {
  if (refreshing.value) return
  refreshing.value = true
  refreshMsg.value = ''
  try {
    await refreshSeasonData(toApiSeason({ season: season.value, year: year.value }))
    await load()
    refreshMsg.value = '已重新拉取 AniList 并更新缓存'
  } catch (e) {
    refreshMsg.value = e.message || '重新拉取失败'
  } finally {
    refreshing.value = false
  }
}

// 番剧搜索（本地缓存 + AniList 在线补全）
const searchQ = ref('')
const searchResults = ref([])
const searching = ref(false)
const searchDone = ref(false)
const searchError = ref('')
const selectedGenre = ref('')

function genreLabel(g) {
  return lang.value === 'zh' ? ZH_GENRES[g] || g : g
}

const searchGenres = computed(() => {
  const set = new Set()
  for (const a of searchResults.value) for (const g of a.genres || []) set.add(g)
  return [...set].sort((a, b) => a.localeCompare(b, 'zh'))
})

const visibleSearchResults = computed(() =>
  selectedGenre.value
    ? searchResults.value.filter((a) => (a.genres || []).includes(selectedGenre.value))
    : searchResults.value
)

async function onSearchAnime() {
  const kw = searchQ.value.trim()
  if (!kw) return
  searching.value = true
  searchDone.value = false
  searchError.value = ''
  selectedGenre.value = ''
  searchResults.value = []
  try {
    await settings.load()
    const items = await searchAnime(kw)
    searchResults.value = items.filter(
      (a) => !a.isAdult || settings.canSeeAdult(isLoggedIn.value, isInsider.value)
    )
  } catch (e) {
    searchError.value = e.message || '搜索失败'
  } finally {
    searching.value = false
    searchDone.value = true
  }
}

function clearSearch() {
  searchQ.value = ''
  searchResults.value = []
  searchDone.value = false
  searchError.value = ''
  selectedGenre.value = ''
}

async function openSearchResult(a) {
  if (a.year && a.season) {
    await goToSeason(a.year, a.season)
    weekStart.value = mondayOf(new Date(month.value.y, month.value.m, 1))
  }
  selectedId.value = a.id
}

// 支持从 /anime?year=2026&season=SPRING&id=189046 这类链接直达
const selectedId = ref(null)
const selectedMedia = computed(() =>
  selectedId.value ? mediaMap.value.get(selectedId.value) : null
)
const selectedEpisodes = computed(() =>
  schedules.value.filter((s) => s.mediaId === selectedId.value)
)

async function applyRouteQuery() {
  const q = route.query
  const y = Number(q.year)
  const s = String(q.season || '').toUpperCase()
  if (SEASONS[s] && Number.isInteger(y) && (y !== year.value || s !== season.value)) {
    await goToSeason(y, s)
    weekStart.value = mondayOf(new Date(month.value.y, month.value.m, 1))
  }
  const id = Number(q.id)
  if (Number.isInteger(id) && id > 0) selectedId.value = id
}

watch(() => route.query, applyRouteQuery, { immediate: true })

if (route.query.id) selectedId.value = Number(route.query.id)
</script>

<template>
  <div class="app">
    <AnimeBackground :media-map="mediaMap" />
    <header class="header">
      <h1 class="logo"><AppIcon name="calendar" :size="24" /> Anime</h1>
      <div class="header-actions">
        <LanguageSelector />
        <button
          v-if="isLoggedIn"
          class="btn"
          :disabled="loading || refreshing"
          title="强制重新从 AniList 拉取当前档期数据"
          @click="onRefresh"
        >
          <AppIcon name="refresh" :size="13" />
          {{ refreshing ? '拉取中…' : '重新拉取' }}
        </button>
        <span v-if="refreshMsg" class="refresh-msg" :class="{ error: refreshMsg.includes('失败') }">
          {{ refreshMsg }}
        </span>
      </div>
    </header>

    <div class="anime-search">
      <form class="search-form" @submit.prevent="onSearchAnime">
        <AppIcon name="search" :size="14" />
        <input v-model.trim="searchQ" placeholder="搜索番剧：Re:Zero / 从零开始的异世界生活…" />
        <button class="btn" type="submit" :disabled="searching || !searchQ">
          {{ searching ? '搜索中…' : '搜索' }}
        </button>
      </form>
      <p v-if="searchError" class="search-error">{{ searchError }}</p>
      <div v-else-if="searchResults.length" class="search-results">
        <div class="search-results-head">
          <span>找到 {{ visibleSearchResults.length }} / {{ searchResults.length }} 部番剧</span>
          <button class="btn btn-sm" @click="clearSearch">清除</button>
        </div>
        <div v-if="searchGenres.length" class="genre-filter">
          <span class="genre-filter-label">类型：</span>
          <button
            class="genre-chip"
            :class="{ active: !selectedGenre }"
            @click="selectedGenre = ''"
          >全部</button>
          <button
            v-for="g in searchGenres"
            :key="g"
            class="genre-chip"
            :class="{ active: selectedGenre === g }"
            @click="selectedGenre = selectedGenre === g ? '' : g"
          >{{ genreLabel(g) }}</button>
        </div>
        <div v-if="visibleSearchResults.length" class="search-result-grid">
          <button v-for="a in visibleSearchResults" :key="a.id" class="search-result" @click="openSearchResult(a)">
            <img v-if="a.cover" :src="a.cover" class="search-result-cover" alt="" loading="lazy" />
            <span v-else class="search-result-cover placeholder">?</span>
            <span class="search-result-info">
              <span class="search-result-name">{{ a.title }}</span>
              <span class="search-result-season">{{ a.seasonLabel || a.season || '未知档期' }}</span>
            </span>
          </button>
        </div>
        <p v-else class="search-empty">「{{ selectedGenre }}」类型下暂无结果</p>
      </div>
      <p v-else-if="searchDone && searchQ" class="search-empty">没有找到「{{ searchQ }}」相关番剧</p>
    </div>

    <!-- 日历导航栏：周/月翻页 + 视图切换 + 指定日期跳转 -->
    <div class="month-bar">
      <div class="nav-group">
        <button
          class="nav-arrow"
          :aria-label="view === 'week' ? '上一周' : '上一月'"
          :disabled="view === 'week' ? !canPrevWeek : !canPrevMonth"
          @click="view === 'week' ? goWeek(-1) : goMonth(-1)"
        ><AppIcon name="chevron-left" :size="15" :stroke-width="2" /></button>
        <Transition name="label" mode="out-in">
          <span
            :key="view === 'week' ? weekLabel : `${month.y}-${month.m}`"
            class="month-label"
          >
            {{ view === 'week' ? weekLabel : `${month.y}年${month.m + 1}月` }}
          </span>
        </Transition>
        <button
          class="nav-arrow"
          :aria-label="view === 'week' ? '下一周' : '下一月'"
          :disabled="view === 'week' ? !canNextWeek : !canNextMonth"
          @click="view === 'week' ? goWeek(1) : goMonth(1)"
        ><AppIcon name="chevron-right" :size="15" :stroke-width="2" /></button>
      </div>
      <span class="month-count"><AppIcon name="calendar" :size="12" /> {{ schedules.length }} 条放送记录</span>
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
      <button class="today-btn" :disabled="loading" title="回到当前日期" @click="onCurrent">
        <AppIcon name="clock" :size="13" /> 回到当前
      </button>
      <form class="jump-form" @submit.prevent="jumpToDate">
        <button
          type="button"
          class="jump-icon"
          :aria-expanded="pickerOpen"
          aria-haspopup="dialog"
          aria-label="选择跳转日期"
          @click="openPicker"
        >
          <AppIcon name="calendar" :size="13" :stroke-width="2" />
        </button>
        <button
          type="button"
          class="jump-date-btn"
          :aria-expanded="pickerOpen"
          aria-haspopup="dialog"
          @click="openPicker"
        >
          <span>{{ jumpDate }}</span>
          <AppIcon name="chevron-down" :size="11" :stroke-width="2.2" class="jump-date-caret" :class="{ open: pickerOpen }" />
        </button>
        <button class="jump-btn" type="submit">
          跳转 <AppIcon name="arrow-right" :size="13" :stroke-width="2.2" />
        </button>

        <!-- 自定义日期选择日历（替代浏览器原生 date picker） -->
        <Transition name="picker">
          <div v-if="pickerOpen" class="date-picker" @click.stop>
            <div class="dp-head">
              <button type="button" class="dp-nav" aria-label="上一月" @click="pickerShift(-1)">
                <AppIcon name="chevron-left" :size="13" :stroke-width="2" />
              </button>
              <span class="dp-label">{{ pickerYear }}年{{ pickerMonth + 1 }}月</span>
              <button type="button" class="dp-nav" aria-label="下一月" @click="pickerShift(1)">
                <AppIcon name="chevron-right" :size="13" :stroke-width="2" />
              </button>
              <button type="button" class="dp-today" @click="pickerToday">今天</button>
            </div>
            <div class="dp-weekdays">
              <span v-for="w in DP_WEEKDAYS" :key="w">{{ w }}</span>
            </div>
            <div class="dp-grid">
              <button
                v-for="(cell, i) in pickerDays"
                :key="i"
                type="button"
                class="dp-day"
                :class="{
                  empty: !cell.date,
                  today: cell.date && dayKey(cell.date) === todayKey,
                  selected: cell.date && dayKey(cell.date) === jumpDate,
                }"
                :disabled="!cell.date"
                @click="pickDay(cell.date)"
              >
                {{ cell.date ? cell.day : '' }}
              </button>
            </div>
            <div class="dp-foot">
              <span>已选：{{ jumpDate }}</span>
              <button type="button" class="dp-jump" @click="jumpToDate()">跳转到此日</button>
            </div>
          </div>
        </Transition>
      </form>
    </div>

    <div v-if="error" class="banner error">
      <p>数据加载失败：{{ error }}</p>
      <button class="btn" @click="load">重试</button>
    </div>

    <main class="main">
      <div v-if="loading" class="loading-inline">
        <div class="loading-text">正在加载动漫数据…</div>
        <div class="progress-track"><div class="progress-bar"></div></div>
      </div>
      <WeekView
        v-if="view === 'week'"
        :week-start="weekStart"
        :schedules="schedules"
        :media-map="mediaMap"
        :season="displaySeason"
        @select="selectedId = $event"
      />

      <Calendar
        v-else-if="view === 'month'"
        :month="month"
        :schedules="schedules"
        :media-map="mediaMap"
        :season="displaySeason"
        @select="selectedId = $event"
      />

      <ListView
        v-else
        :month="month"
        :schedules="schedules"
        :media-map="mediaMap"
        :season="displaySeason"
        @select="selectedId = $event"
      />

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
  max-width: min(1320px, 95vw); /* 高分辨率适配 */
  margin: 0 auto;
  padding: 20px 20px 40px;
}

/* 页面内容按从上到下的顺序依次浮现（与 blog/wiki/tools 的入场风格一致） */
.header,
.anime-search,
.month-bar,
.main,
.footer {
  animation: ios-rise-in var(--dur-ios-3) var(--ease-ios-expo) backwards;
}

.header {
  animation-delay: 20ms;
}

.anime-search {
  animation-delay: 80ms;
}

.month-bar {
  animation-delay: 140ms;
}

.main {
  animation-delay: 200ms;
}

.footer {
  animation-delay: 260ms;
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
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 22px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.refresh-msg {
  font-size: 12px;
  color: var(--accent);
}

.refresh-msg.error {
  color: #ff9d9d;
}

.anime-search {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}

.search-form {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  transition:
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.search-form:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}

.search-form input {
  flex: 1;
  min-width: 0;
  padding: 5px 0;
  font-size: 14px;
  color: var(--text);
  background: transparent;
  border: none;
  outline: none;
}

.search-error {
  font-size: 13px;
  color: #ff9d9d;
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.search-results-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: var(--muted);
}

.genre-filter {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.genre-filter-label {
  margin-right: 2px;
}

.genre-chip {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  transition:
    color var(--dur-ios-1) var(--ease-ios-expo),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    background-color var(--dur-ios-1) var(--ease-ios-expo);
}

.genre-chip:hover {
  color: var(--text);
  border-color: var(--accent);
}

.genre-chip.active {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}

.search-result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  max-height: 320px;
  overflow: auto;
}

.search-result {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px;
  text-align: left;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.search-result:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.1);
}

.search-result-cover {
  width: 40px;
  height: 56px;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}

.search-result-cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 14px;
}

.search-result-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.search-result-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-result-season {
  font-size: 11px;
  color: var(--muted);
}

.search-empty {
  font-size: 13px;
  color: var(--muted);
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

/* 后台加载时保留日历内容，只在顶部显示一条带进度条的轻量加载提示 */
.loading-inline {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  margin-bottom: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 8%, var(--panel));
  color: var(--muted);
  font-size: 13px;
}

.loading-text {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-track {
  height: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  width: 40%;
  border-radius: 999px;
  background: var(--accent);
  animation: progress-indeterminate 1.1s ease-in-out infinite;
}

@keyframes progress-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}

/* —— 日历导航栏：iOS 风格毛玻璃工具条 —— */
.month-bar {
  position: relative;
  z-index: 45; /* 让日期选择浮层浮在其他日历内容之上 */
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 7px 10px;
  margin-bottom: 12px;
  background: color-mix(in srgb, var(--panel) 72%, transparent);
  border: 1px solid var(--border);
  border-radius: 14px;
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 18px rgb(0 0 0 / 0.05);
}

/* 翻页区：左右圆形箭头 + 居中日期标签 */
.nav-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--panel-2);
  color: var(--text);
  cursor: pointer;
  transition:
    transform var(--dur-ios-1) var(--ease-ios-spring),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.nav-arrow:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--panel-2));
  transform: translateY(-1px);
  box-shadow: 0 6px 14px color-mix(in srgb, var(--accent) 18%, transparent);
}

.nav-arrow:active:not(:disabled) {
  transform: scale(0.9);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.nav-arrow:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.month-label {
  min-width: 190px;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* 日期标签切换时的非线性微过渡 */
.label-enter-active {
  transition:
    opacity var(--dur-ios-2) var(--ease-ios-expo),
    transform var(--dur-ios-2) var(--ease-ios-spring);
}

.label-leave-active {
  transition:
    opacity var(--dur-ios-1) var(--ease-ios),
    transform var(--dur-ios-1) var(--ease-ios);
}

.label-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.label-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

.month-count {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}

/* 视图切换：iOS 分段控件 */
.view-toggle {
  margin-left: auto;
  display: flex;
  padding: 3px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 999px;
}

.toggle-btn {
  padding: 5px 14px;
  font-size: 13px;
  color: var(--muted);
  background: transparent;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition:
    background-color var(--dur-ios-2) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.toggle-btn:hover {
  color: var(--text);
}

.toggle-btn.active {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 35%, transparent);
}

/* —— 回到当前：与跳转日历并列的胶囊按钮 —— */
.today-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 13px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition:
    transform var(--dur-ios-1) var(--ease-ios-spring),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    background-color var(--dur-ios-2) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.today-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--panel-2));
  box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 18%, transparent);
  transform: translateY(-1px);
}

.today-btn:active:not(:disabled) {
  transform: scale(0.95);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.today-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* —— 指定日期跳转：胶囊日历控件 —— */
.jump-form {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 5px 4px 6px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  transition:
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    background-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring);
}

.jump-form:hover {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--panel-2));
  transform: translateY(-1px);
}

.jump-form:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}

.jump-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), #a78bfa);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 35%, transparent);
  cursor: pointer;
  transition:
    transform var(--dur-ios-1) var(--ease-ios-spring),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.jump-icon:hover {
  transform: scale(1.08);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 45%, transparent);
}

.jump-icon:active {
  transform: scale(0.92);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.jump-date-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 4px 3px 8px;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo);
}

.jump-date-btn:hover {
  background: var(--panel);
}

.jump-date-caret {
  color: var(--muted);
  transition:
    color var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-2) var(--ease-ios-spring);
}

.jump-date-caret.open {
  color: var(--accent);
  transform: rotate(180deg);
}

/* —— 自定义日期选择日历 —— */
.date-picker {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 120;
  width: min(292px, 90vw);
  padding: 10px;
  background: color-mix(in srgb, var(--overlay-panel) 94%, transparent);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow:
    0 24px 64px rgb(0 0 0 / 0.3),
    0 4px 14px rgb(0 0 0 / 0.12);
  backdrop-filter: blur(18px);
  transform-origin: top right;
  font-variant-numeric: tabular-nums;
}

.dp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.dp-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--panel-2);
  color: var(--muted);
  cursor: pointer;
  transition:
    transform var(--dur-ios-1) var(--ease-ios-spring),
    color var(--dur-ios-1) var(--ease-ios-expo),
    border-color var(--dur-ios-1) var(--ease-ios-expo);
}

.dp-nav:hover {
  color: var(--accent);
  border-color: var(--accent);
  transform: translateY(-1px);
}

.dp-label {
  flex: 1;
  text-align: center;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.dp-today {
  padding: 5px 10px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring);
}

.dp-today:hover {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  transform: translateY(-1px);
}

.dp-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 4px;
}

.dp-weekdays span {
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--muted);
  padding: 4px 0;
}

.dp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.dp-day {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.dp-day.empty {
  cursor: default;
}

.dp-day:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  transform: scale(1.06);
}

.dp-day:active:not(:disabled) {
  transform: scale(0.9);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.dp-day.today {
  color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
}

.dp-day.selected {
  background: var(--accent);
  color: #fff;
  font-weight: 800;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--accent) 40%, transparent);
}

.dp-day.selected:hover {
  background: var(--accent-hover);
  color: #fff;
}

.dp-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
}

.dp-jump {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: none;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent);
  transition:
    transform var(--dur-ios-1) var(--ease-ios-spring),
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.dp-jump:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
}

.dp-jump:active {
  transform: scale(0.94);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

/* 日历浮层动画 */
.picker-enter-active {
  transition:
    opacity var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-2) var(--ease-ios-spring);
}

.picker-leave-active {
  transition:
    opacity var(--dur-ios-1) var(--ease-ios),
    transform var(--dur-ios-1) var(--ease-ios);
}

.picker-enter-from,
.picker-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.94);
}

.jump-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent);
  transition:
    transform var(--dur-ios-1) var(--ease-ios-spring),
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.jump-btn:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
  box-shadow: 0 6px 14px color-mix(in srgb, var(--accent) 40%, transparent);
}

.jump-btn:active {
  transform: scale(0.95);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
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

/* —— 手机端适配 —— */
@media (max-width: 760px) {
  .app {
    padding: 12px 10px 32px;
  }

  .logo {
    font-size: 19px;
  }

  .header-actions {
    width: 100%;
  }

  .search-form input {
    font-size: 16px; /* 避免 iOS 聚焦自动放大 */
  }

  .month-bar {
    padding: 6px 8px;
    gap: 8px;
  }

  .nav-group {
    flex: 1 1 100%;
    min-width: 0;
  }

  .month-label {
    min-width: 128px;
    font-size: 14px;
  }

  .month-count {
    display: none;
  }

  .view-toggle {
    flex: 1;
    margin-left: 0;
    justify-content: center;
  }

  .toggle-btn {
    padding: 5px 10px;
    font-size: 12px;
  }

  .today-btn {
    padding: 5px 10px;
    font-size: 12px;
  }

  .jump-date-btn {
    max-width: 104px;
  }

  .jump-date-btn span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
