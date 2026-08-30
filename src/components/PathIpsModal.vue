<script setup>
// 热门页面详情：查看访问过某个页面的 IP 列表
import { onMounted, onUnmounted, ref } from 'vue'
import { getVisitPathIps } from '../api/visits'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  path: { type: String, required: true },
  days: { type: Number, default: 30 },
})
const emit = defineEmits(['close', 'view-ip'])

const data = ref(null)
const page = ref(1)
const pageSize = ref(50)
const loading = ref(true)
const error = ref('')

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    data.value = await getVisitPathIps(props.path, {
      days: props.days,
      page: page.value,
      pageSize: pageSize.value,
    })
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function changePage(delta) {
  const next = page.value + delta
  if (next < 1 || (data.value && next > Math.max(1, Math.ceil(data.value.total / pageSize.value)))) return
  page.value = next
  load()
}

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  load()
})
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="path-ips-mask" @click.self="emit('close')">
    <div class="path-ips-card">
      <header class="path-ips-head">
        <h3 class="path-ips-title"><AppIcon name="link" :size="17" /> 页面访问 IP</h3>
        <button class="path-ips-close" title="关闭" @click="emit('close')">✕</button>
      </header>

      <div class="path-ips-body">
        <div class="path-ips-path-row">
          <code class="path-ips-path">{{ path }}</code>
          <span class="path-ips-days">近 {{ days }} 天</span>
        </div>

        <p v-if="loading" class="path-ips-hint">加载中…</p>
        <p v-else-if="error" class="path-ips-error">{{ error }}</p>

        <template v-else-if="data">
          <div class="path-ips-summary">
            <span><b>{{ data.total }}</b> 个独立 IP</span>
            <span><b>{{ data.totalVisits }}</b> 次访问</span>
          </div>

          <div class="path-ips-table-wrap">
            <table class="path-ips-table">
              <thead>
                <tr>
                  <th>IP</th>
                  <th>IP 来源</th>
                  <th>访问次数</th>
                  <th>最近访问</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in data.items" :key="item.ip">
                  <td>
                    <button class="ip-link" title="查看 IP 详情" @click="emit('view-ip', item.ip)">{{ item.ip }}</button>
                  </td>
                  <td class="path-ips-loc" :title="item.location + (item.isp ? ' · ' + item.isp : '')">
                    {{ item.location }}<span v-if="item.isp"> · {{ item.isp }}</span>
                  </td>
                  <td class="path-ips-count">{{ item.count }}</td>
                  <td class="path-ips-time">{{ fmtTime(item.lastSeen) }}</td>
                </tr>
                <tr v-if="!data.items.length">
                  <td colspan="4" class="path-ips-empty">近 {{ days }} 天没有该页面的访问记录</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="data.total > pageSize" class="path-ips-pager">
            <button class="btn btn-sm" :disabled="page <= 1 || loading" @click="changePage(-1)">上一页</button>
            <span>{{ page }} / {{ Math.max(1, Math.ceil(data.total / pageSize)) }}</span>
            <button class="btn btn-sm" :disabled="page >= Math.ceil(data.total / pageSize) || loading" @click="changePage(1)">下一页</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.path-ips-mask {
  position: fixed;
  inset: 0;
  z-index: 320;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
  backdrop-filter: blur(3px);
  padding: 20px;
}

.path-ips-card {
  width: min(760px, 96vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.35);
  overflow: hidden;
}

.path-ips-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.path-ips-title {
  margin: 0;
  font-size: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.path-ips-close {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}

.path-ips-close:hover {
  color: var(--text);
  background: var(--panel-2);
}

.path-ips-body {
  padding: 16px 20px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.path-ips-path-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.path-ips-path {
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
  word-break: break-all;
}

.path-ips-days {
  font-size: 12px;
  color: var(--muted);
}

.path-ips-hint,
.path-ips-error {
  padding: 30px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}

.path-ips-error {
  color: #ff9d9d;
}

.path-ips-summary {
  display: flex;
  gap: 20px;
  font-size: 13px;
  color: var(--muted);
}

.path-ips-summary b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.path-ips-table-wrap {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.path-ips-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.path-ips-table th,
.path-ips-table td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
}

.path-ips-table th {
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.path-ips-table td {
  color: var(--text);
}

.path-ips-loc {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}

.path-ips-count {
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  font-weight: 700;
}

.path-ips-time {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.path-ips-empty {
  text-align: center;
  color: var(--muted);
  padding: 20px 0;
}

.path-ips-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}

.ip-link {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ip-link:hover {
  text-decoration: underline;
}
</style>
