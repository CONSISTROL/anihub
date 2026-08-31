<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { buildMonthGrid, fmtDate, fmtTime, dayKey } from '../utils/date'
import { titleFor } from '../utils/titles'
import DayPopover from './DayPopover.vue'
import AppIcon from './AppIcon.vue'
import SeasonPattern from './SeasonPattern.vue'
import { useMediaQuery } from '../composables/useMediaQuery'

const props = defineProps({
  month: { type: Object, required: true }, // { y, m }
  schedules: { type: Array, default: () => [] },
  mediaMap: { type: Map, required: true },
  season: { type: String, default: '' },
})

const seasonClass = computed(() => `season-${(props.season || '').toLowerCase() || 'spring'}`)

const emit = defineEmits(['select'])

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const weeks = computed(() => buildMonthGrid(props.month.y, props.month.m))

// 手机端使用“每日日程卡”布局：只显示当月有排期的日期
const isMobile = useMediaQuery('(max-width: 760px)')
const mobileDays = computed(() =>
  weeks.value.flat().filter((cell) => cell.date && entriesFor(cell).length > 0)
)

// 按本地日期分组排期，'YYYY-MM-DD' → [{ airingAt, episode, mediaId }]
const byDay = computed(() => {
  const map = new Map()
  for (const s of props.schedules) {
    const key = fmtDate(s.airingAt)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(s)
  }
  return map
})

function entriesFor(cell) {
  if (!cell.date) return []
  return byDay.value.get(dayKey(cell.date)) || []
}

function titleOf(mediaId) {
  return titleFor(props.mediaMap.get(mediaId)) || `#${mediaId}`
}

function coverOf(mediaId) {
  const m = props.mediaMap.get(mediaId)
  return m?.coverImage?.medium || m?.coverImage?.large || ''
}

// 用 id 生成稳定色相，让不同番剧在日历上有区分度
function hueOf(mediaId) {
  let h = 0
  const s = String(mediaId)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

// —— 当日弹层 ——
const openDay = ref(null)

function openDayOf(cell) {
  if (cell.date) openDay.value = cell.date
}

function onSelect(mediaId) {
  openDay.value = null
  emit('select', mediaId)
}

// —— 悬浮提示（大封面 + 完整标题） ——
const tooltip = ref(null) // { x, y, entry }
const ttMedia = computed(() =>
  tooltip.value ? props.mediaMap.get(tooltip.value.entry.mediaId) : null
)
const ttTitle = computed(() =>
  tooltip.value ? titleOf(tooltip.value.entry.mediaId) : ''
)
const ttCover = computed(() =>
  ttMedia.value?.coverImage?.large || ttMedia.value?.coverImage?.medium || ''
)
const ttStyle = computed(() => {
  const t = tooltip.value
  if (!t) return {}
  const w = 320
  const h = 190
  return {
    left: `${Math.min(t.x + 14, window.innerWidth - w - 8)}px`,
    top: `${Math.min(t.y + 12, window.innerHeight - h - 8)}px`,
  }
})

function onChipEnter(e, entry) {
  tooltip.value = { x: e.clientX, y: e.clientY, entry }
}

function hideTooltip() {
  tooltip.value = null
}

onMounted(() => window.addEventListener('scroll', hideTooltip, { passive: true }))
onUnmounted(() => window.removeEventListener('scroll', hideTooltip))
</script>

<template>
  <!-- 桌面 / 平板：7 列月历 -->
  <div v-if="!isMobile" class="calendar" :class="seasonClass">
    <SeasonPattern :season="season" :density="16" />
    <div class="weekday-row">
      <div v-for="(w, i) in WEEKDAYS" :key="w" class="weekday-cell" :class="{ weekend: i >= 5 }">{{ w }}</div>
    </div>
    <div class="month-grid">
      <div v-for="(week, wi) in weeks" :key="wi" class="week">
        <div
          v-for="(cell, ci) in week"
          :key="cell.date ? cell.date.toISOString() : `e${wi}-${ci}`"
          class="day"
          :class="{ 'day-empty': !cell.date, 'day-today': cell.isToday, weekend: cell.date && (cell.date.getDay() === 0 || cell.date.getDay() === 6) }"
          @click="openDayOf(cell)"
        >
          <div class="day-num">{{ cell.day ?? '' }}</div>
          <div class="entries" @click.stop>
            <button
              v-for="e in entriesFor(cell)"
              :key="`${e.mediaId}-${e.episode}`"
              class="chip"
              :style="{ '--hue': hueOf(e.mediaId) }"
              @mouseenter="onChipEnter($event, e)"
              @mouseleave="hideTooltip"
              @click="emit('select', e.mediaId)"
            >
              <img v-if="coverOf(e.mediaId)" :src="coverOf(e.mediaId)" class="chip-cover" alt="" />
              <span v-else class="chip-cover chip-cover-ph"><AppIcon name="film" :size="10" /></span>
              <span class="chip-title">{{ titleOf(e.mediaId) }}</span>
              <span class="chip-ep">第{{ e.episode }}话</span>
              <span class="chip-time">{{ fmtTime(e.airingAt) }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 手机：每日一张日程卡，只列有排期的日期 -->
  <div v-else class="calendar-mobile">
    <template v-if="mobileDays.length">
      <section
        v-for="cell in mobileDays"
        :key="cell.date.toISOString()"
        class="calendar-day-card"
        :class="{ 'calendar-day-today': cell.isToday }"
      >
        <header class="calendar-day-head">
          <span class="calendar-day-date">
            {{ cell.date.getMonth() + 1 }}/{{ cell.date.getDate() }}
            <span class="calendar-day-weekday">周{{ '日一二三四五六'[cell.date.getDay()] }}</span>
          </span>
          <span class="calendar-day-count">{{ entriesFor(cell).length }} 部</span>
          <span v-if="cell.isToday" class="calendar-today-badge">今天</span>
        </header>
        <div class="calendar-day-body">
          <button
            v-for="e in entriesFor(cell)"
            :key="`${e.mediaId}-${e.episode}`"
            class="chip"
            :style="{ '--hue': hueOf(e.mediaId) }"
            @click="emit('select', e.mediaId)"
          >
            <img v-if="coverOf(e.mediaId)" :src="coverOf(e.mediaId)" class="chip-cover" alt="" />
            <span v-else class="chip-cover chip-cover-ph"><AppIcon name="film" :size="10" /></span>
            <span class="chip-title">{{ titleOf(e.mediaId) }}</span>
            <span class="chip-ep">第{{ e.episode }}话</span>
            <span class="chip-time">{{ fmtTime(e.airingAt) }}</span>
          </button>
        </div>
      </section>
    </template>
    <p v-else class="calendar-mobile-empty">本月暂无放送安排</p>
  </div>

  <DayPopover
    v-if="openDay"
    :date="openDay"
    :entries="byDay.get(dayKey(openDay)) || []"
    :media-map="mediaMap"
    @select="onSelect"
    @close="openDay = null"
  />

  <Teleport to="body">
    <Transition name="fade">
      <div v-if="tooltip" class="chip-tooltip" :style="ttStyle">
        <img v-if="ttCover" :src="ttCover" class="tt-cover" alt="" />
        <div class="tt-info">
          <div class="tt-title">{{ ttTitle }}</div>
          <div class="tt-meta">
            {{ fmtDate(tooltip.entry.airingAt) }} {{ fmtTime(tooltip.entry.airingAt) }}
            · 第{{ tooltip.entry.episode }}话
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.calendar {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  box-shadow: 0 14px 40px rgb(0 0 0 / 0.08);
  font-variant-numeric: tabular-nums;
}

.weekday-row,
.month-grid {
  position: relative;
  z-index: 1;
}

.weekday-row {
  display: grid;
  /* minmax(0, 1fr)：下限为 0，防止不换行的长标题把列撑宽，保证 7 列严格等宽 */
  grid-template-columns: repeat(7, minmax(0, 1fr));
  background: color-mix(in srgb, var(--panel-2) 80%, transparent);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(6px);
}

.weekday-cell {
  padding: 11px 0 9px;
  text-align: center;
  font-size: 12px;
  letter-spacing: 0.12em;
  color: var(--muted);
  font-weight: 700;
}

.weekday-cell.weekend {
  color: color-mix(in srgb, var(--accent) 65%, var(--muted));
}

.month-grid {
  display: flex;
  flex-direction: column;
}

.week {
  display: grid;
  /* minmax(0, 1fr)：每行列宽都严格等于容器 1/7，周与周之间列对齐 */
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-bottom: 1px solid var(--border);
}

.week:last-child {
  border-bottom: none;
}

.day {
  position: relative;
  min-height: 108px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--panel) 55%, transparent);
  cursor: pointer;
  overflow: hidden;
  transition: background-color var(--dur-ios-2) var(--ease-ios-expo);
}

.day:last-child {
  border-right: none;
}

.day:not(.day-empty):hover {
  background: color-mix(in srgb, var(--accent) 7%, var(--panel));
}

.day.weekend:not(.day-empty) {
  background: color-mix(in srgb, var(--accent) 3%, color-mix(in srgb, var(--panel) 55%, transparent));
}

.day-empty {
  background: color-mix(in srgb, var(--panel) 40%, transparent);
  cursor: default;
}

.day-today {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent) 11%, var(--panel)) 0%,
    color-mix(in srgb, var(--accent) 5%, var(--panel)) 100%
  );
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 65%, transparent);
}

.day-num {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: flex-end;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  user-select: none;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.day:not(.day-empty):hover .day-num {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.day-today .day-num {
  background: var(--accent);
  color: #fff;
  font-weight: 800;
  box-shadow: 0 3px 10px color-mix(in srgb, var(--accent) 45%, transparent);
}

.entries {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chip {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 4px 6px;
  border: 1px solid color-mix(in srgb, hsl(var(--hue) 65% 60%) 35%, transparent);
  border-left-width: 3px;
  border-radius: 8px;
  background: hsl(var(--hue) 60% 55% / 0.15);
  color: var(--text);
  font-size: 11.5px;
  cursor: pointer;
  text-align: left;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.05);
  transition:
    filter var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring),
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.chip:hover {
  filter: brightness(1.22);
  transform: translateX(2px) scale(1.02);
  background: hsl(var(--hue) 60% 55% / 0.24);
  box-shadow: 0 6px 14px rgb(0 0 0 / 0.14);
}

.chip:active {
  transform: scale(0.97);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.chip-cover {
  width: 20px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
  box-shadow: 0 2px 5px rgb(0 0 0 / 0.18);
}

.chip-cover-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-2);
  border: 1px solid var(--border);
}

.chip-title {
  flex: 1;
  min-width: 0; /* 允许收缩，配合 overflow 让长标题真正显示省略号 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.chip-ep {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  background: hsl(var(--hue) 60% 45% / 0.7);
  border-radius: 999px;
  padding: 1px 5px;
  white-space: nowrap;
}

.chip-time {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: hsl(var(--hue) 70% 72%);
  opacity: 0.9;
}

/* 悬浮提示 */
.chip-tooltip {
  position: fixed;
  z-index: 110;
  width: 320px;
  display: flex;
  gap: 12px;
  padding: 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
  pointer-events: none;
}

.tt-cover {
  width: 72px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 6px;
  flex-shrink: 0;
}

.tt-info {
  min-width: 0;
}

.tt-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  margin-bottom: 6px;
}

.tt-meta {
  font-size: 12px;
  color: var(--muted);
}

.fade-enter-active {
  transition: opacity var(--dur-ios-2) var(--ease-ios-expo);
}

.fade-leave-active {
  transition: opacity var(--dur-ios-1) var(--ease-ios);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* —— 手机端：每日日程卡布局 —— */
.calendar-mobile {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.calendar-day-card {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.06);
}

.calendar-day-today {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent) 10%, var(--panel)) 0%,
    color-mix(in srgb, var(--panel) 92%, transparent) 100%
  );
}

.calendar-day-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: color-mix(in srgb, var(--panel-2) 72%, transparent);
  border-bottom: 1px solid var(--border);
}

.calendar-day-date {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-size: 17px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.calendar-day-weekday {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

.calendar-day-count {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 8px;
}

.calendar-today-badge {
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
  border-radius: 999px;
  padding: 2px 9px;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 40%, transparent);
}

.calendar-day-body {
  display: flex;
  flex-direction: column;
  padding: 6px;
  gap: 5px;
}

.calendar-day-body .chip {
  border-radius: 9px;
  padding: 7px 8px;
}

.calendar-day-body .chip-title {
  font-size: 12.5px;
}

.calendar-mobile-empty {
  margin: 0;
  padding: 48px 0;
  text-align: center;
  font-size: 13px;
  color: var(--muted);
  border: 1px dashed var(--border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel) 60%, transparent);
}
</style>
