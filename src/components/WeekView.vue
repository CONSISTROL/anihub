<script setup>
import { computed } from 'vue'
import { addDays, dayKey, fmtTime } from '../utils/date'
import { titleFor } from '../utils/titles'

const props = defineProps({
  weekStart: { type: Date, required: true }, // 该周周一（本地）
  schedules: { type: Array, default: () => [] },
  mediaMap: { type: Map, required: true },
})

const emit = defineEmits(['select'])

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
  <div class="week-grid">
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
          <span v-else class="cover cover-ph">🎬</span>
          <span class="row-main">
            <span class="title">{{ titleOf(e.mediaId) }}</span>
            <span class="meta">第{{ e.episode }}话 · {{ fmtTime(e.airingAt) }}</span>
          </span>
        </button>
        <p v-if="!d.list.length" class="none">无放送</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.week-grid {
  display: grid;
  /* minmax(0, 1fr)：7 列严格等宽，不换行内容不撑宽 */
  grid-template-columns: repeat(7, minmax(0, 1fr));
  align-items: stretch;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--panel);
}

.col {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}

.col:last-child {
  border-right: none;
}

.col-today {
  background: color-mix(in srgb, var(--accent) 8%, var(--panel));
}

.col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
}

.col-today .col-head {
  background: color-mix(in srgb, var(--accent) 14%, var(--panel-2));
}

.wd {
  font-size: 13px;
  font-weight: 700;
}

.col-today .wd {
  color: var(--accent);
}

.dt {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.today-badge {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 999px;
  padding: 0 6px;
}

.col-body {
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}

.row:hover {
  background: var(--panel-2);
}

.cover {
  width: 32px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.cover-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-2);
  border: 1px solid var(--border);
  font-size: 13px;
}

.row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.3;
}

.meta {
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.none {
  margin: 0;
  padding: 24px 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}
</style>
