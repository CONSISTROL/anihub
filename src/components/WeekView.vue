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
          <img v-if="coverOf(e.mediaId)" :src="coverOf(e.mediaId)" class="cover" alt="" loading="lazy" decoding="async" />
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
          <img v-if="coverOf(e.mediaId)" :src="coverOf(e.mediaId)" class="cover" alt="" loading="lazy" decoding="async" />
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

/* ⚠⚠ 这里**不要**加 backdrop-filter（原为 `blur(6px)`）。
   表头本身是半透明面板色，而它所在的 `.main` 带 `ios-rise-in` 入场动画
   （带 200ms 延迟、`backwards`）：动画前 200ms `.main` 的 opacity 是 0，随后从 0 爬到 1。
   `backdrop-filter` 的元素若处在 **opacity < 1 的祖先**里，浏览器无法正确采样背景，
   模糊等于没做 —— 于是这几百毫秒内表头只剩那层半透明底色，
   透出的是页面背景（浅色主题下接近白色 `#f2f4f9`），
   观感就是用户报的"刷新 anime 页面时 col-head 刚开始一瞬间是白色的"。
   实测（浅色主题逐帧）：col-head 首次出现时祖先 `.main` 的 opacity=0，
   一直爬到 ~1 才稳定；表头自己的背景色自始至终没变。
   把底色加实一点即可，不用模糊 —— 它底下就是壁纸/页面背景，模糊换不来多少观感。 */
.col-head {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 12px 10px;
  /* ⚠⚠ 底色要"自己够实"，而且**不能**用 `color-mix(..., transparent)` 去调 ——
     `color-mix` 与 `transparent` 混合时，结果的 alpha **不会超过**源色的 alpha。
     而 `--panel-2` 本身是 `rgb(29 33 44 / 0.66)` 这种带 alpha 的颜色，
     所以无论把百分比调到 92% 还是 100%，实测最终 alpha 都卡在 0.46/0.5 上不去。
     正确做法：先用**不透明**成分算出一个实色，再统一在最后叠一次透明度。
     这里用 `--overlay-panel`（两个主题下都是不透明的实底）当基色：
       浅色 #ffffff / 深色 #171a22 → 最后 62% 透明度 → alpha 0.62
     （`--overlay-panel` 本就是"需要实底"的语义，正合适。） */
  background: color-mix(in srgb, var(--overlay-panel) 62%, transparent);
  border-bottom: 1px solid var(--border);
}

/* 「今天」那一列的表头：混一点 accent 区分出来，透明度与普通列一致。 */
.col-today .col-head {
  background: color-mix(in srgb, color-mix(in srgb, var(--accent) 14%, var(--overlay-panel)) 62%, transparent);
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
  /* 桌面周历是**表格**：col-body 不留内边距、行与行之间也不留空隙，
     让每一行横向铺满整列、上下紧贴 —— 否则行会像一块块圆角矩形"浮"在列底上 */
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  /* 行本身是一整条：左右给图标留点呼吸，上下只留小内边距 */
  padding: 7px 9px;
  border: none;
  /* 行不再自成圆角卡片，而是列里的一段 —— 靠一条细分隔线区分彼此 */
  border-radius: 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  box-shadow: none;
  /* ::before 的分隔线要相对本行定位 */
  position: relative;
  transition: background-color var(--dur-ios-1) var(--ease-ios-expo);
}

/* 行之间用"上边线"而不是下边线：这样最后一行不会多出一条悬空的分隔线。
   用伪元素而不是 border-top，是为了让它横向铺满整列、不受行内左右内边距影响。 */
.row::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  background: var(--border);
}

.row:first-child::before {
  display: none;
}

.row:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  /* hover 只改底色，不再位移/加阴影 —— 表格里的行不该"浮起来" */
}

.row:active {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
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
  margin: 0;
  padding: 24px 0;
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
