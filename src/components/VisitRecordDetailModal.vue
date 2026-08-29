<script setup>
// 单条访问记录详情：点击访问统计表格中的条目时展示该次访问的完整字段
import { computed, onMounted, onUnmounted } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  record: { type: Object, required: true },
})
const emit = defineEmits(['close', 'view-ip'])

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const locationText = computed(() => {
  const r = props.record
  const parts = [r.country, r.region, r.city].filter(Boolean)
  const base = parts.join(' · ') || '未知位置'
  return r.isp ? `${base} · ${r.isp}` : base
})

const statusText = computed(() => {
  const s = props.record.status
  if (!s) return '未解析'
  if (s === 'ok') return '已解析'
  if (s === 'skipped') return '内网 / 本机'
  if (s === 'pending') return '解析中'
  return '解析失败'
})

const sourceText = computed(() => (props.record.source === 'spa' ? 'SPA 路由切换' : '整页加载'))

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="record-detail-mask" @click.self="emit('close')">
    <div class="record-detail-card">
      <header class="record-detail-head">
        <h3 class="record-detail-title"><AppIcon name="clock" :size="17" /> 访问记录详情</h3>
        <button class="record-detail-close" title="关闭" @click="emit('close')">✕</button>
      </header>

      <div class="record-detail-body">
        <div class="record-detail-grid">
          <div class="record-detail-item">
            <span>访问时间</span>
            <b>{{ fmtTime(record.ts) }}</b>
          </div>
          <div class="record-detail-item">
            <span>IP</span>
            <button class="ip-link" title="查看该 IP 完整来源" @click="emit('view-ip', record.ip)">{{ record.ip || '—' }}</button>
          </div>
          <div class="record-detail-item">
            <span>IP 来源</span>
            <b>{{ locationText }}</b>
          </div>
          <div class="record-detail-item">
            <span>解析状态</span>
            <b>{{ statusText }}</b>
          </div>
          <div class="record-detail-item">
            <span>记录来源</span>
            <b>{{ sourceText }}</b>
          </div>
        </div>

        <div class="record-detail-fields">
          <div class="record-detail-field">
            <span>访问路径</span>
            <code>{{ record.path || '—' }}</code>
          </div>
          <div class="record-detail-field">
            <span>来源页 / Referer</span>
            <code>{{ record.referer || '直达（无来源页）' }}</code>
          </div>
          <div class="record-detail-field">
            <span>User-Agent</span>
            <code class="record-detail-ua">{{ record.userAgent || '—' }}</code>
          </div>
        </div>

        <div class="record-detail-actions">
          <button class="btn btn-sm" @click="emit('close')">关闭</button>
          <button v-if="record.ip" class="btn btn-sm btn-primary" @click="emit('view-ip', record.ip)">查看该 IP 完整来源</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.record-detail-mask {
  position: fixed;
  inset: 0;
  z-index: 310;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.45);
  backdrop-filter: blur(3px);
  padding: 20px;
}

.record-detail-card {
  width: min(640px, 96vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.35);
  overflow: hidden;
}

.record-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.record-detail-title {
  margin: 0;
  font-size: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.record-detail-close {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}

.record-detail-close:hover {
  color: var(--text);
  background: var(--panel-2);
}

.record-detail-body {
  padding: 16px 20px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.record-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.record-detail-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.record-detail-item span {
  font-size: 11px;
  color: var(--muted);
}

.record-detail-item b {
  font-size: 13px;
  word-break: break-word;
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
  font-size: 13px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ip-link:hover {
  text-decoration: underline;
}

.record-detail-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.record-detail-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.record-detail-field span {
  font-size: 11px;
  color: var(--muted);
}

.record-detail-field code {
  padding: 10px 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text);
}

.record-detail-ua {
  max-height: 160px;
  overflow-y: auto;
}

.record-detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
