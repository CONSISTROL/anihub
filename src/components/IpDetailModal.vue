<script setup>
// IP 来源详情弹窗：查看单个 IP 的完整归属地、访问汇总、路径/UA 分布与最近访问记录
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getVisitIpDetail } from '../api/visits'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  ip: { type: String, required: true },
  days: { type: Number, default: 30 },
})
const emit = defineEmits(['close'])

const detail = ref(null)
const loading = ref(true)
const error = ref('')

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const statusText = computed(() => {
  const s = detail.value?.location?.status
  if (!s) return '未解析'
  if (s === 'ok') return '已解析'
  if (s === 'skipped') return '内网 / 本机'
  if (s === 'pending') return '解析中'
  return '解析失败'
})

const statusClass = computed(() => detail.value?.location?.status || 'unknown')

const locationText = computed(() => {
  const l = detail.value?.location
  if (!l) return '暂无归属地信息'
  const parts = [l.country, l.region, l.city].filter(Boolean)
  return parts.join(' · ') || '未知位置'
})

const coordText = computed(() => {
  const l = detail.value?.location
  if (l && Number.isFinite(l.lat) && Number.isFinite(l.lon)) return `${l.lat.toFixed(4)}, ${l.lon.toFixed(4)}`
  return '—'
})

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    detail.value = await getVisitIpDetail(props.ip, { days: props.days })
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="ip-detail-mask" @click.self="emit('close')">
    <div class="ip-detail-card">
      <header class="ip-detail-head">
        <h3 class="ip-detail-title"><AppIcon name="pin" :size="17" /> IP 来源详情</h3>
        <button class="ip-detail-close" title="关闭" @click="emit('close')">✕</button>
      </header>

      <p v-if="loading" class="ip-detail-hint">加载中…</p>
      <p v-else-if="error" class="ip-detail-error">{{ error }}</p>

      <div v-else-if="detail" class="ip-detail-body">
        <div class="ip-detail-ip-row">
          <code class="ip-detail-ip">{{ detail.ip }}</code>
          <span class="ip-status" :class="statusClass">{{ statusText }}</span>
          <span class="ip-detail-days">近 {{ detail.days }} 天</span>
        </div>

        <div class="ip-detail-grid">
          <div class="ip-detail-item">
            <span>归属地</span>
            <b>{{ locationText }}</b>
          </div>
          <div class="ip-detail-item">
            <span>ISP / 运营商</span>
            <b>{{ detail.location?.isp || '—' }}</b>
          </div>
          <div class="ip-detail-item">
            <span>经纬度</span>
            <b>{{ coordText }}</b>
          </div>
          <div class="ip-detail-item">
            <span>解析时间</span>
            <b>{{ fmtTime(detail.location?.resolved_at) }}</b>
          </div>
        </div>

        <div class="ip-detail-cols">
          <div class="ip-detail-panel">
            <h4>访问汇总</h4>
            <div class="ip-detail-stat">近 {{ detail.days }} 天 <b>{{ detail.summary.rangeCount }}</b> 次</div>
            <div class="ip-detail-stat">累计 <b>{{ detail.summary.total }}</b> 次</div>
            <div class="ip-detail-stat">首次访问 <span>{{ fmtTime(detail.summary.firstSeen) }}</span></div>
            <div class="ip-detail-stat">最近访问 <span>{{ fmtTime(detail.summary.lastSeen) }}</span></div>
          </div>

          <div class="ip-detail-panel">
            <h4>访问路径 TOP</h4>
            <div v-for="p in detail.paths" :key="p.path" class="ip-detail-row" :title="p.path">
              <span class="ip-detail-row-path">{{ p.path }}</span>
              <b>{{ p.count }}</b>
            </div>
            <p v-if="!detail.paths.length" class="ip-detail-empty">近 {{ detail.days }} 天暂无记录</p>
          </div>

          <div class="ip-detail-panel">
            <h4>User-Agent TOP</h4>
            <div v-for="u in detail.userAgents" :key="u.userAgent" class="ip-detail-row" :title="u.userAgent">
              <span class="ip-detail-row-ua">{{ u.userAgent }}</span>
              <b>{{ u.count }}</b>
            </div>
            <p v-if="!detail.userAgents.length" class="ip-detail-empty">无 User-Agent 数据</p>
          </div>
        </div>

        <div class="ip-detail-recent">
          <h4>最近访问记录</h4>
          <div class="ip-detail-table-wrap">
            <table class="ip-detail-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>路径</th>
                  <th>来源页</th>
                  <th>User-Agent</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in detail.recentVisits" :key="r.id">
                  <td class="ip-detail-td-time">{{ fmtTime(r.ts) }}</td>
                  <td class="ip-detail-td-path" :title="r.path">{{ r.path }}</td>
                  <td class="ip-detail-td-ref" :title="r.referer">{{ r.referer || '直达' }}</td>
                  <td class="ip-detail-td-ua" :title="r.userAgent">{{ r.userAgent || '—' }}</td>
                </tr>
                <tr v-if="!detail.recentVisits.length">
                  <td colspan="4" class="ip-detail-empty">暂无访问记录</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ip-detail-mask {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
  backdrop-filter: blur(3px);
  padding: 20px;
}

.ip-detail-card {
  width: min(880px, 96vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.35);
  overflow: hidden;
}

.ip-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.ip-detail-title {
  margin: 0;
  font-size: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ip-detail-close {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}

.ip-detail-close:hover {
  color: var(--text);
  background: var(--panel-2);
}

.ip-detail-hint,
.ip-detail-error {
  padding: 30px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}

.ip-detail-error {
  color: #ff9d9d;
}

.ip-detail-body {
  padding: 16px 20px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ip-detail-ip-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ip-detail-ip {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
  word-break: break-all;
}

.ip-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 20px;
  border: 1px solid var(--border);
  color: var(--muted);
  background: var(--panel-2);
}

.ip-status.ok {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
}

.ip-status.skipped {
  color: #ffb35c;
  border-color: color-mix(in srgb, #ffb35c 45%, transparent);
}

.ip-status.failed {
  color: #ff9d9d;
  border-color: color-mix(in srgb, #ff9d9d 45%, transparent);
}

.ip-detail-days {
  font-size: 12px;
  color: var(--muted);
}

.ip-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.ip-detail-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.ip-detail-item span {
  font-size: 11px;
  color: var(--muted);
}

.ip-detail-item b {
  font-size: 13px;
  word-break: break-word;
}

.ip-detail-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.ip-detail-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.ip-detail-panel h4,
.ip-detail-recent h4 {
  margin: 0;
  font-size: 13px;
}

.ip-detail-stat {
  font-size: 12px;
  color: var(--muted);
}

.ip-detail-stat b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.ip-detail-stat span {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.ip-detail-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  padding: 3px 0;
  border-bottom: 1px dashed var(--border);
}

.ip-detail-row:last-child {
  border-bottom: none;
}

.ip-detail-row-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.ip-detail-row-ua {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}

.ip-detail-row b {
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.ip-detail-empty {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
  padding: 12px 0;
}

.ip-detail-recent {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ip-detail-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.ip-detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.ip-detail-table th,
.ip-detail-table td {
  text-align: left;
  padding: 6px 9px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.ip-detail-table th {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

.ip-detail-table td {
  color: var(--text);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ip-detail-td-time {
  font-variant-numeric: tabular-nums;
}

.ip-detail-td-path,
.ip-detail-td-ref,
.ip-detail-td-ua {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
