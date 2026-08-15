<script setup>
import { computed } from 'vue'
import { dayKey, fmtTime, weekdayCN } from '../utils/date'
import { titleFor } from '../utils/titles'

const props = defineProps({
  month: { type: Object, required: true }, // { y, m }
  schedules: { type: Array, default: () => [] },
  mediaMap: { type: Map, required: true },
})

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
  <div class="list-view">
    <div v-if="groups.length === 0" class="empty">本月暂无放送安排</div>
    <div v-for="g in groups" :key="g.key" class="group">
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
          <span v-else class="cover cover-placeholder">🎬</span>
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
  gap: 16px;
}

.empty {
  padding: 48px 0;
  text-align: center;
  color: var(--muted);
  border: 1px dashed var(--border);
  border-radius: 12px;
}

.group {
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--panel);
}

.group-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 10px 16px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
}

.group-head.today {
  background: color-mix(in srgb, var(--accent) 12%, var(--panel-2));
}

.group-head .date {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.group-head .weekday {
  font-size: 12px;
  color: var(--muted);
}

.group-head .count {
  font-size: 12px;
  color: var(--muted);
}

.group-head .today-badge {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 999px;
  padding: 1px 8px;
}

.rows {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 16px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.row:last-child {
  border-bottom: none;
}

.row:hover {
  background: color-mix(in srgb, var(--accent) 6%, var(--panel));
}

.cover {
  width: 40px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 5px;
  flex-shrink: 0;
}

.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-2);
  border: 1px solid var(--border);
  font-size: 16px;
}

.row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-ep {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--muted);
}

.row-time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
</style>
