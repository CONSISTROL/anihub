<script setup>
import { computed } from 'vue'
import { dayKey, fmtTime, weekdayCN } from '../utils/date'
import { titleFor } from '../utils/titles'
import AppIcon from './AppIcon.vue'
import SeasonPattern from './SeasonPattern.vue'

const props = defineProps({
  month: { type: Object, required: true }, // { y, m }
  schedules: { type: Array, default: () => [] },
  mediaMap: { type: Map, required: true },
  season: { type: String, default: '' },
})

const seasonClass = computed(() => `season-${(props.season || '').toLowerCase() || 'spring'}`)

const emit = defineEmits(['select'])

// 只显示当前月份（月历视图月份与列表视图保持一致），并按日期分组
const groups = computed(() => {
  const prefix = `${props.month.y}-${String(props.month.m + 1).padStart(2, '0')}`
  const map = new Map()
  for (const s of props.schedules) {
    const key = dayKey(new Date(s.airingAt * 1000))
    if (!key.startsWith(prefix)) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(s)
  }
  // 按日期升序、日内按时间升序
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, list]) => ({ key, list: list.sort((a, b) => a.airingAt - b.airingAt) }))
})

const todayKey = computed(() => dayKey(new Date()))

function titleOf(mediaId) {
  return titleFor(props.mediaMap.get(mediaId)) || `#${mediaId}`
}

function coverOf(mediaId) {
  const m = props.mediaMap.get(mediaId)
  return m?.coverImage?.medium || m?.coverImage?.large || ''
}

function weekdayOf(key) {
  const [y, m, d] = key.split('-').map(Number)
  return weekdayCN(new Date(y, m - 1, d))
}
</script>

<template>
  <div class="list-view" :class="seasonClass">
    <div v-if="groups.length === 0" class="empty">本月暂无放送安排</div>
    <div v-for="g in groups" :key="g.key" class="group">
      <SeasonPattern :season="season" :density="4" />
      <div class="group-head" :class="{ today: g.key === todayKey }">
        <span class="date">{{ g.key }}</span>
        <span class="weekday">星期{{ weekdayOf(g.key) }}</span>
        <span class="count">{{ g.list.length }} 部</span>
        <span v-if="g.key === todayKey" class="today-badge">今天</span>
      </div>
      <div class="rows">
        <button
          v-for="e in g.list"
          :key="`${e.mediaId}-${e.episode}`"
          class="row"
          @click="emit('select', e.mediaId)"
        >
          <img v-if="coverOf(e.mediaId)" :src="coverOf(e.mediaId)" class="cover" alt="" />
          <span v-else class="cover cover-placeholder"><AppIcon name="film" :size="15" /></span>
          <span class="row-title">{{ titleOf(e.mediaId) }}</span>
          <span class="row-ep">第{{ e.episode }}话</span>
          <span class="row-time">{{ fmtTime(e.airingAt) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-variant-numeric: tabular-nums;
}

.empty {
  padding: 48px 0;
  text-align: center;
  color: var(--muted);
  border: 1px dashed var(--border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--panel) 60%, transparent);
}

.group {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.06);
}

.group-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  background: color-mix(in srgb, var(--panel-2) 80%, transparent);
  border-bottom: 1px solid var(--border);
  backdrop-filter: blur(6px);
}

.group-head.today {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent) 16%, var(--panel-2)) 0%,
    color-mix(in srgb, var(--accent) 5%, var(--panel-2)) 100%
  );
}

.group-head .date {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
}

.group-head .weekday {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}

.group-head .count {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 8px;
}

.group-head .today-badge {
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
  border-radius: 999px;
  padding: 2px 10px;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 40%, transparent);
}

.rows {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 16px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.row:last-child {
  border-bottom: none;
}

.row:hover {
  background: color-mix(in srgb, var(--accent) 7%, var(--panel));
  box-shadow: inset 3px 0 0 var(--accent);
  transform: translateX(3px);
}

.row:active {
  transform: scale(0.992);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.cover {
  width: 44px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
  box-shadow: 0 3px 10px rgb(0 0 0 / 0.18);
}

.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-2);
  border: 1px solid var(--border);
}

.row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.01em;
}

.row-ep {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
}

.row-time {
  flex-shrink: 0;
  min-width: 48px;
  text-align: right;
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
</style>
