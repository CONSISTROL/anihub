<script setup>
import { computed } from 'vue'
import { addDays, dayKey, fmtTime } from '../utils/date'
import { titleFor } from '../utils/titles'
import AppIcon from './AppIcon.vue'
import SeasonPattern from './SeasonPattern.vue'
import { useMediaQuery } from '../composables/useMediaQuery'

const props = defineProps({
  weekStart: { type: Date, required: true }, // 该周周一（本地）
  schedules: { type: Array, default: () => [] },
  mediaMap: { type: Map, required: true },
  season: { type: String, default: '' },
})

const seasonClass = computed(() => `season-${(props.season || '').toLowerCase() || 'spring'}`)

const emit = defineEmits(['select'])

// 手机端使用“每日日程卡”竖排布局，桌面保持 7 列周历
const isMobile = useMediaQuery('(max-width: 760px)')

const WD = ['一', '二', '三', '四', '五', '六', '日']
const todayKey = dayKey(new Date())

const days = computed(() => {
  const byDayMap = new Map()
  for (const s of props.schedules) {
    const key = dayKey(new Date(s.airingAt * 1000))
    if (!byDayMap.has(key)) byDayMap.set(key, [])
    byDayMap.get(key).push(s)
  }
  const result = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(props.weekStart, i)
    const key = dayKey(date)
    result.push({
      date,
      key,
      list: (byDayMap.get(key) || []).slice().sort((a, b) => a.airingAt - b.airingAt),
      isToday: key === todayKey,
    })
  }
  return result
})

function titleOf(mediaId) {
  return titleFor(props.mediaMap.get(mediaId)) || `#${mediaId}`
}

function coverOf(mediaId) {
  const m = props.mediaMap.get(mediaId)
  return m?.coverImage?.medium || m?.coverImage?.large || ''
}
</script>

<template>
  <!-- 桌面 / 平板：7 列等宽周历 -->
  <div v-if="!isMobile" class="week-grid" :class="seasonClass">
    <SeasonPattern :season="season" :density="12" />
    <div v-for="(d, i) in days" :key="d.key" class="col" :class="{ 'col-today': d.isToday }">
      <div class="col-head">
        <span class="wd">周{{ WD[i] }}</span>
        <span class="dt">{{ d.date.getMonth() + 1 }}/{{ d.date.getDate() }}</span>
        <span v-if="d.isToday" class="today-badge">今天</span>
      </div>
      <div class="col-body">
        <button
          v-for="e in d.list"
          :key="`${e.mediaId}-${e.episode}`"
          class="row"
          @click="emit('select', e.mediaId)"
        >
          <img v-if="coverOf(e.mediaId)" :src="coverOf(e.mediaId)" class="cover" alt="" />
          <span v-else class="cover cover-ph"><AppIcon name="film" :size="16" /></span>
          <span class="row-main">
            <span class="title">{{ titleOf(e.mediaId) }}</span>
            <span class="meta">
              <span class="ep-chip">第{{ e.episode }}话</span>
              <span class="time">{{ fmtTime(e.airingAt) }}</span>
            </span>
          </span>
        </button>
        <p v-if="!d.list.length" class="none">无放送</p>
      </div>
    </div>
  </div>

  <!-- 手机：每日一张日程卡，竖排滚动浏览 -->
  <div v-else class="week-list">
    <section
      v-for="(d, i) in days"
      :key="d.key"
      class="day-card"
      :class="{ 'day-card-today': d.isToday }"
    >
      <header class="day-card-head">
        <span class="day-card-date">
          <span class="wd">周{{ WD[i] }}</span>
          <span class="dt">{{ d.date.getMonth() + 1 }}/{{ d.date.getDate() }}</span>
        </span>
        <span class="day-card-count">{{ d.list.length }} 部</span>
        <span v-if="d.isToday" class="today-badge">今天</span>
      </header>
      <div class="day-card-body">
        <button
          v-for="e in d.list"
          :key="`${e.mediaId}-${e.episode}`"
          class="row"
          @click="emit('select', e.mediaId)"
        >
          <img v-if="coverOf(e.mediaId)" :src="coverOf(e.mediaId)" class="cover" alt="" />
          <span v-else class="cover cover-ph"><AppIcon name="film" :size="16" /></span>
          <span class="row-main">
            <span class="title">{{ titleOf(e.mediaId) }}</span>
            <span class="meta">
              <span class="ep-chip">第{{ e.episode }}话</span>
              <span class="time">{{ fmtTime(e.airingAt) }}</span>
            </span>
          </span>
        </button>
        <p v-if="!d.list.length" class="none">无放送</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.week-grid {
  position: relative;
  display: grid;
  /* minmax(0, 1fr)：7 列严格等宽，不换行内容不撑宽 */
  grid-template-columns: repeat(7, minmax(0, 1fr));
  align-items: stretch;
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  box-shadow: 0 14px 40px rgb(0 0 0 / 0.08);
  font-variant-numeric: tabular-nums;
}

.col {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  overflow: hidden;
  background: color-mix(in srgb, var(--panel) 60%, transparent);
}

.col:last-child {
  border-right: none;
}

.col-today {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent) 12%, var(--panel)) 0%,
    color-mix(in srgb, var(--accent) 5%, var(--panel)) 100%
  );
}

.col-head {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 12px 10px;
  background: color-mix(in srgb, var(--panel-2) 70%, transparent);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(6px);
}

.col-today .col-head {
  background: color-mix(in srgb, var(--accent) 15%, var(--panel-2));
}

.wd {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--muted);
}

.col-today .wd {
  color: var(--accent);
}

.dt {
  font-size: 16px;
  font-weight: 800;
  line-height: 1.15;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.today-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
  border-radius: 999px;
  padding: 2px 8px;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 40%, transparent);
}

.col-body {
  position: relative;
  z-index: 1;
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: color-mix(in srgb, var(--panel) 70%, transparent);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.05);
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.row:hover {
  background: var(--overlay-panel);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.1);
  transform: translateY(-2px);
}

.row:active {
  transform: scale(0.97);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.cover {
  width: 34px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 7px;
  flex-shrink: 0;
  box-shadow: 0 3px 8px rgb(0 0 0 / 0.18);
}

.cover-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-2);
  border: 1px solid var(--border);
}

.row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 650;
  line-height: 1.35;
  letter-spacing: 0.01em;
}

.meta {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ep-chip {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 999px;
  padding: 1px 6px;
  white-space: nowrap;
}

.time {
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.none {
  margin: auto 0;
  padding: 28px 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}

/* —— 手机端：每日日程卡布局 —— */
.week-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.day-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.06);
}

.day-card-today {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent) 10%, var(--panel)) 0%,
    color-mix(in srgb, var(--panel) 92%, transparent) 100%
  );
}

.day-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--panel-2) 72%, transparent);
  border-bottom: 1px solid var(--border);
}

.day-card-date {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}

.day-card-date .wd {
  font-size: 12px;
  font-weight: 700;
  color: var(--muted);
}

.day-card-today .day-card-date .wd {
  color: var(--accent);
}

.day-card-date .dt {
  font-size: 17px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.day-card-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 8px;
}

.day-card-body {
  display: flex;
  flex-direction: column;
  padding: 6px;
}

.day-card-body .row {
  border-bottom: 1px solid var(--border);
  border-radius: 0;
}

.day-card-body .row:last-of-type {
  border-bottom: none;
}

.day-card-body .row:hover {
  background: color-mix(in srgb, var(--accent) 7%, var(--panel));
  border-color: transparent;
}

.day-card-body .none {
  padding: 16px 0;
}
</style>
