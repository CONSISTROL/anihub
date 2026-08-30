<script setup>
// 设置页：配置哪些页面对游客可见、哪些页面对内部人员额外可见 + 壁纸/成人内容身份控制 + 服务器监控（图表）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getSettings, updateSettings, getMonitor, getMonitorHistory, getWallpapersManage, saveWallpaperSelection } from '../api/settings'
import { getVisitSummary, getVisitMap, getVisitRecords, getVisitIps } from '../api/visits'
import VisitMap from '../components/VisitMap.vue'
import IpDetailModal from '../components/IpDetailModal.vue'
import VisitRecordDetailModal from '../components/VisitRecordDetailModal.vue'
import PathIpsModal from '../components/PathIpsModal.vue'
import { getUpgradeProgress, getUpgradeStatus, runUpgrade } from '../api/upgrade'
import { useSettings } from '../composables/useSettings'
import LineChart from '../components/LineChart.vue'
import AppIcon from '../components/AppIcon.vue'
import LiquidFill from '../components/LiquidFill.vue'

const settings = useSettings()

const OPTIONS = [
  { key: 'anime', label: 'Anime 日历', desc: '当前档期新番放送时间表' },
  { key: 'blog', label: 'Blog 博客', desc: '追番笔记与推荐' },
  { key: 'wiki', label: 'Wiki', desc: '动漫知识库' },
  { key: 'tools', label: 'Tools 工具箱', desc: 'JSON 格式化 / 二维码解析 / 图片裁切' },
  { key: 'game', label: 'Game 游戏', desc: 'Shattered Pixel Dungeon 网页版' },
  { key: 'pet', label: '桌宠（大肥鱼）', desc: '网页左下角的动画小宠物，默认仅登录可见' },
]

const guestSelected = ref([])
const insiderSelected = ref([])
const wallpaperGuest = ref(true)
const wallpaperInsider = ref(true)
const adultGuest = ref(false)
const adultInsider = ref(false)
const loading = ref(true)
const saving = ref(false)
const message = ref('')
const error = ref('')


/* —— 网站升级 —— */
const upg = ref(null)
const upgLoading = ref(false)
const upgError = ref('')
const upgModal = ref(false)
const upgPassword = ref('')
const upgBusy = ref(false)
const upgMessage = ref('')
const upgProgress = ref({ state: 'idle', phase: '', running: false, updatedAt: null, log: '' })
let upgPollTimer = null
/* —— 壁纸管理（选择参与展示的壁纸） —— */
const wpImages = ref([]) // [{ name, url, selected }]
const wpSaving = ref(false)
const wpMessage = ref('')

async function loadWallpapers() {
  try {
    const d = await getWallpapersManage()
    wpImages.value = d.images || []
  } catch {
    /* 接口失败保持空列表（非管理员/接口不可用时静默） */
  }
}

function toggleWp(img) {
  img.selected = !img.selected
}

function selectAllWp(v) {
  wpImages.value.forEach((i) => (i.selected = v))
}

async function saveWp() {
  wpSaving.value = true
  wpMessage.value = ''
  try {
    await saveWallpaperSelection(wpImages.value.filter((i) => i.selected).map((i) => i.name))
    // 清除本地缓存的旧壁纸，下次访问从新选择中取
    localStorage.removeItem('anime-calendar.wallpaper')
    wpMessage.value = '壁纸选择已保存'
  } catch (e) {
    wpMessage.value = '保存失败：' + e.message
  } finally {
    wpSaving.value = false
  }
}

/* —— 网站升级 —— */
async function loadUpgradeStatus() {
  upgLoading.value = true
  upgError.value = ''
  try {
    upg.value = await getUpgradeStatus()
  } catch (e) {
    upgError.value = e.message
  } finally {
    upgLoading.value = false
  }
}

const UPGRADE_PHASE_LABEL = {
  fetch: '拉取代码',
  install: '安装依赖',
  build: '构建前端',
  nginx: '同步 Nginx',
  restart: '重启服务',
  done: '升级完成',
  failed: '升级失败',
  idle: '等待升级',
}

const upgProgressLabel = computed(() =>
  upgProgress.value ? UPGRADE_PHASE_LABEL[upgProgress.value.phase] || upgProgress.value.phase || '' : ''
)

const upgProgressPercent = computed(() => {
  if (!upgProgress.value) return 0
  if (upgProgress.value.state === 'idle') return 0
  if (upgProgress.value.state === 'done') return 100
  if (upgProgress.value.state === 'failed') return 100
  const p = {
    fetch: 10,
    install: 35,
    build: 70,
    nginx: 85,
    restart: 95,
  }
  return p[upgProgress.value.phase] ?? 5
})

async function loadUpgradeProgress() {
  try {
    upgProgress.value = await getUpgradeProgress()
    if (upgProgress.value?.running) startUpgradePolling()
    else stopUpgradePolling()
  } catch {
    // 服务重启期间可能短暂连不上，保持当前显示；接口不可用时回退为空闲状态
    upgProgress.value = { state: 'idle', phase: '', running: false, updatedAt: null, log: '' }
  }
}

function startUpgradePolling() {
  if (upgPollTimer) return
  upgPollTimer = setInterval(async () => {
    try {
      const p = await getUpgradeProgress()
      upgProgress.value = p
      if (!p.running) {
        stopUpgradePolling()
        loadUpgradeStatus()
      }
    } catch {
      // 服务重启中，等待下次轮询
    }
  }, 1500)
}

function stopUpgradePolling() {
  clearInterval(upgPollTimer)
  upgPollTimer = null
}

function openUpgradeModal() {
  upgPassword.value = ''
  upgMessage.value = ''
  upgModal.value = true
}

async function confirmUpgrade() {
  if (!upgPassword.value) {
    upgMessage.value = '请输入 su/root 密码'
    return
  }
  upgBusy.value = true
  upgMessage.value = ''
  try {
    const r = await runUpgrade(upgPassword.value)
    upgMessage.value = r.message || '升级已触发'
    upgModal.value = false
    // 开始轮询升级进度与日志
    upgProgress.value = { state: 'running', phase: 'fetch', running: true, log: '正在触发升级…' }
    startUpgradePolling()
  } catch (e) {
    upgMessage.value = e.message
  } finally {
    upgBusy.value = false
  }
}


onMounted(async () => {
  try {
    const d = await getSettings()
    guestSelected.value = d.guestPages
    insiderSelected.value = d.insiderPages || []
    wallpaperGuest.value = d.wallpaper?.guest === true
    wallpaperInsider.value = d.wallpaper?.insider === true
    adultGuest.value = d.showAdult?.guest === true
    adultInsider.value = d.showAdult?.insider === true
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
  loadWallpapers()
  loadUpgradeStatus()
  loadUpgradeProgress()
})

// 内部人员额外可见的选项：已对游客可见的页面自动包含在内部可见内，不再重复勾选
const insiderOptions = computed(() =>
  OPTIONS.filter((o) => !guestSelected.value.includes(o.key))
)
const guestCovered = computed(() =>
  OPTIONS.filter((o) => guestSelected.value.includes(o.key))
)

async function onSave() {
  saving.value = true
  message.value = ''
  error.value = ''
  try {
    const d = await updateSettings({
      guestPages: guestSelected.value,
      insiderPages: insiderSelected.value,
      wallpaper: { guest: wallpaperGuest.value, insider: wallpaperInsider.value },
      showAdult: { guest: adultGuest.value, insider: adultInsider.value },
    })
    settings.apply(d) // 导航 / 主页立即生效
    insiderSelected.value = d.insiderPages
    message.value = '已保存'
  } catch (e) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

/* —— 服务器监控（实时摘要） —— */
const mon = ref(null)
const monError = ref('')
const monUpdated = ref(0)
let monTimer = null

async function refreshMonitor() {
  try {
    mon.value = await getMonitor()
    monError.value = ''
    monUpdated.value = Date.now()
  } catch (e) {
    monError.value = e.message
  }
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec))
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (d > 0) return `${d} 天 ${h} 小时 ${m} 分`
  if (h > 0) return `${h} 小时 ${m} 分 ${s} 秒`
  if (m > 0) return `${m} 分 ${s} 秒`
  return `${s} 秒`
}

function fmtBytes(n) {
  if (!n && n !== 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const memRatio = computed(() => {
  if (!mon.value?.memTotal) return 0
  return Math.min(100, Math.round(((mon.value.memTotal - mon.value.memFree) / mon.value.memTotal) * 100))
})

const rssRatio = computed(() => {
  if (!mon.value?.mem?.rss || !mon.value.memTotal) return 0
  return Math.min(100, Math.round((mon.value.mem.rss / mon.value.memTotal) * 100))
})

const diskRatio = computed(() => {
  if (!mon.value?.disk?.total) return 0
  return Math.min(100, Math.round((mon.value.disk.used / mon.value.disk.total) * 100))
})

const heapRatio = computed(() => {
  const m = mon.value?.mem
  if (!m?.heapTotal) return 0
  return Math.min(100, Math.round((m.heapUsed / m.heapTotal) * 100))
})

/* —— 监控图表 —— */
const RANGES = [
  { key: 'h', label: '小时' },
  { key: 'd', label: '天' },
  { key: 'w', label: '周' },
  { key: 'm', label: '月' },
  { key: 'custom', label: '自定义' },
]
const histRange = ref('h')
const customFrom = ref('')
const customTo = ref('')
const hist = ref(null) // { from, to, bucketSec, memTotal, points }
const histErr = ref('')
let histTimer = null

const COLORS = { cpu: '#ff7043', mem: '#4a7de0', netIn: '#37b24d', netOut: '#f59f00', diskRead: '#66a3ff', diskWrite: '#e599f7' }

function pad(n) {
  return String(n).padStart(2, '0')
}

function timeLabel(ts, range, span) {
  const d = new Date(ts * 1000)
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (range === 'h') return hhmm
  if (range === 'd') return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}`
  if (range === 'custom' && span <= 2 * 86400) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toSeries(key) {
  if (!hist.value) return []
  const { from, bucketSec, points } = hist.value
  const n = Math.max(0, Math.floor((hist.value.to - from) / bucketSec) + 1)
  const arr = new Array(n).fill(null)
  for (const p of points) {
    const idx = Math.round((p.ts - from) / bucketSec)
    if (idx >= 0 && idx < n) arr[idx] = p[key]
  }
  return arr
}

function chartData() {
  if (!hist.value) return null
  const span = hist.value.to - hist.value.from
  const n = Math.max(0, Math.floor(span / hist.value.bucketSec) + 1)
  const xLabels = []
  for (let i = 0; i < n; i++) {
    xLabels.push(timeLabel(hist.value.from + i * hist.value.bucketSec, histRange.value, span))
  }
  return {
    xLabels,
    cpu: [{ name: 'CPU 使用率', color: COLORS.cpu, data: toSeries('cpu') }],
    mem: [{ name: '内存使用', color: COLORS.mem, data: toSeries('mem') }],
    net: [
      { name: '入网', color: COLORS.netIn, data: toSeries('netIn') },
      { name: '出网', color: COLORS.netOut, data: toSeries('netOut') },
    ],
    disk: [
      { name: '磁盘读', color: COLORS.diskRead, data: toSeries('diskRead') },
      { name: '磁盘写', color: COLORS.diskWrite, data: toSeries('diskWrite') },
    ],
  }
}

async function loadHistory() {
  histErr.value = ''
  try {
    if (histRange.value === 'custom') {
      if (!customFrom.value || !customTo.value) {
        histErr.value = '请选择自定义时间范围'
        return
      }
      const from = Math.floor(new Date(customFrom.value).getTime() / 1000)
      const to = Math.floor(new Date(customTo.value).getTime() / 1000)
      hist.value = await getMonitorHistory({ range: 'custom', from, to })
    } else {
      hist.value = await getMonitorHistory({ range: histRange.value })
    }
  } catch (e) {
    histErr.value = e.message
  }
}

function onRangeChange() {
  loadHistory()
}

function setCustomNow() {
  const fmt = (d) => {
    const p = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }
  const now = new Date()
  customFrom.value = fmt(new Date(now.getTime() - 24 * 3600 * 1000))
  customTo.value = fmt(now)
}

/* —— 访问统计（仅管理员） —— */
const visitSummary = ref(null)
const visitMap = ref(null)
const visitRecords = ref(null)
const visitPage = ref(1)
const visitPageSize = ref(20)
const visitQ = ref('')
const visitJumpPage = ref(1)
const visitIps = ref(null)
const visitIpPage = ref(1)
const visitIpPageSize = ref(20)
const visitIpJumpPage = ref(1)
const visitLoading = ref(false)
const visitError = ref('')
const VISIT_COLOR = '#4a7de0'

function fmtVisitTime(ts) {
  const d = new Date(ts * 1000)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function visitChart() {
  if (!visitSummary.value?.byDay?.length) return null
  return {
    xLabels: visitSummary.value.byDay.map((d) => d.d.slice(5)),
    trend: [
      { name: '访问量', color: VISIT_COLOR, data: visitSummary.value.byDay.map((d) => d.c) },
      { name: '独立 IP', color: '#37b24d', data: visitSummary.value.byDay.map((d) => d.u) },
    ],
  }
}

async function loadVisits() {
  visitLoading.value = true
  visitError.value = ''
  try {
    const [summary, records, mapData, ips] = await Promise.all([
      getVisitSummary(),
      getVisitRecords({ page: visitPage.value, pageSize: visitPageSize.value, q: visitQ.value || undefined }),
      getVisitMap({ days: 30 }),
      getVisitIps({ page: visitIpPage.value, pageSize: visitIpPageSize.value, days: 30 }),
    ])
    visitSummary.value = summary
    visitRecords.value = records
    visitMap.value = mapData
    visitIps.value = ips
  } catch (e) {
    visitError.value = e.message
  } finally {
    visitLoading.value = false
  }
}

function searchVisits() {
  visitPage.value = 1
  loadVisits()
}

function changeVisitPage(delta) {
  const next = visitPage.value + delta
  if (next < 1 || (visitRecords.value && next > Math.max(1, Math.ceil(visitRecords.value.total / visitPageSize.value)))) return
  visitPage.value = next
  loadVisits()
}

function jumpVisitPage() {
  const target = Math.floor(Number(visitJumpPage.value))
  if (!Number.isFinite(target)) return
  const max = visitTotalPages.value || 1
  visitPage.value = Math.min(max, Math.max(1, target))
  loadVisits()
}

const visitTotalPages = computed(() => {
  if (!visitRecords.value) return 0
  return Math.max(1, Math.ceil(visitRecords.value.total / visitPageSize.value))
})

const visitIpTotalPages = computed(() => {
  if (!visitIps.value) return 0
  return Math.max(1, Math.ceil(visitIps.value.total / visitIpPageSize.value))
})

function changeVisitIpPage(delta) {
  const next = visitIpPage.value + delta
  if (next < 1 || (visitIps.value && next > Math.max(1, Math.ceil(visitIps.value.total / visitIpPageSize.value)))) return
  visitIpPage.value = next
  loadVisits()
}

function jumpVisitIpPage() {
  const target = Math.floor(Number(visitIpJumpPage.value))
  if (!Number.isFinite(target)) return
  const max = visitIpTotalPages.value || 1
  visitIpPage.value = Math.min(max, Math.max(1, target))
  loadVisits()
}

/* —— 访问记录 / 页面 IP / IP 来源详情弹窗 —— */
const recordDetail = ref(null) // 当前查看详情的单条访问记录
const pathIps = ref(null) // 当前查看详情的热门页面路径，null 表示不显示
const ipDetail = ref(null) // 当前查看详情的 IP，null 表示不显示
function openRecordDetail(record) {
  recordDetail.value = record
}
function closeRecordDetail() {
  recordDetail.value = null
}
function openPathIps(path) {
  if (!path) return
  pathIps.value = path
}
function closePathIps() {
  pathIps.value = null
}
function openIpDetail(ip) {
  if (!ip) return
  recordDetail.value = null
  pathIps.value = null
  ipDetail.value = ip
}
function closeIpDetail() {
  ipDetail.value = null
}

onMounted(() => {
  refreshMonitor()
  monTimer = setInterval(refreshMonitor, 5000)
  setCustomNow()
  loadHistory()
  histTimer = setInterval(loadHistory, 15000)
  loadVisits()
})
onUnmounted(() => {
  clearInterval(monTimer)
  clearInterval(histTimer)
  stopUpgradePolling()
})
</script>

<template>
  <div class="settings-page">
    <h1 class="page-title"><AppIcon name="gear" :size="22" /> 设置</h1>
    <p class="sub">页面访问权限：配置不同身份的可见范围（游客 &lt; 内部人员 &lt; 管理员）</p>

    <p v-if="error" class="settings-error">{{ error }}</p>
    <p v-if="loading" class="settings-hint">加载中…</p>

    <div v-else class="settings-stack">
      <section class="settings-card">
        <h2 class="section-title">网站升级</h2>
        <p class="section-sub">检查服务器代码与远程仓库的版本差异；升级需要 su/root 权限</p>

        <p v-if="upgLoading" class="settings-hint">正在检查更新…</p>
        <p v-else-if="upgError" class="settings-error">{{ upgError }}</p>

        <template v-else-if="upg">
          <p v-if="upg.git === false" class="settings-hint">{{ upg.message }}</p>
          <template v-else>
            <div class="upg-row">
              <span>当前版本</span>
              <b>{{ upg.currentCommitShort || '—' }}</b>
            </div>

            <p v-if="upg.fetchError" class="settings-error">{{ upg.fetchError }}</p>

            <template v-if="upg.updateAvailable !== null">
              <div class="upg-row">
                <span>远程最新</span>
                <b>{{ upg.remoteCommitShort || '—' }}</b>
              </div>
              <div class="upg-row">
                <span>提交差异</span>
                <b :class="upg.behind > 0 ? 'upg-behind' : 'upg-ok'">
                  {{ upg.ahead > 0 ? `领先 ${upg.ahead} 个提交 · ` : '' }}{{ upg.behind > 0 ? `落后 ${upg.behind} 个提交` : '已是最新' }}
                </b>
              </div>

              <div v-if="upg.remoteCommits?.length" class="upg-commits">
                <p class="upg-commits-title">远程新增提交：</p>
                <div v-for="c in upg.remoteCommits" :key="c.hash" class="upg-commit">
                  <code>{{ c.hash }}</code>
                  <span>{{ c.subject }}</span>
                </div>
              </div>

              <div class="upg-actions">
                <button
                  class="btn btn-primary"
                  :disabled="!upg.updateAvailable || upgBusy"
                  @click="openUpgradeModal"
                >{{ upg.updateAvailable ? '立即升级' : upg.fetchError ? '检查失败' : '无需升级' }}</button>
                <span v-if="upg.updateAvailable === false" class="upg-ok-text">当前已是最新版本</span>
              </div>

            </template>
          </template>
        </template>

        <!-- 升级进度：仅在升级中/完成/失败时展示，空闲时隐藏 -->
        <div v-if="upgProgress && upgProgress.state !== 'idle'" class="upg-progress">
          <div class="upg-progress-head">
            <span class="upg-progress-label">{{ upgProgressLabel }}</span>
            <span v-if="upgProgress.running" class="upg-progress-spinner"></span>
            <span v-else-if="upgProgress.state === 'done'" class="upg-ok-text">升级完成</span>
            <span v-else-if="upgProgress.state === 'failed'" class="upg-behind">升级失败</span>
          </div>
          <div class="upg-progress-track">
            <div class="upg-progress-bar" :style="{ width: upgProgressPercent + '%' }"></div>
          </div>
          <pre v-if="upgProgress.log" class="upg-log">{{ upgProgress.log }}</pre>
        </div>

        <!-- su/root 密码确认弹窗 -->
        <div v-if="upgModal" class="upg-modal-mask" @click.self="upgModal = false">
          <div class="upg-modal">
            <h3 class="upg-modal-title">确认升级</h3>
            <p class="upg-modal-desc">升级将执行 <code>deploy/update.sh</code>，需要 su/root 权限，请输入 root 密码。</p>
            <input
              v-model="upgPassword"
              type="password"
              placeholder="su / root 密码"
              autocomplete="current-password"
              @keyup.enter="confirmUpgrade"
            />
            <p v-if="upgMessage" class="settings-error">{{ upgMessage }}</p>
            <div class="upg-modal-actions">
              <button class="btn" :disabled="upgBusy" @click="upgModal = false">取消</button>
              <button class="btn btn-primary" :disabled="upgBusy" @click="confirmUpgrade">
                {{ upgBusy ? '升级中…' : '确认升级' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-card">
        <h2 class="section-title">游客可见页面</h2>
        <p class="section-sub">未勾选的页面，游客与内部人员都看不到（内部人员需额外授权）</p>
        <label v-for="o in OPTIONS" :key="o.key" class="opt">
          <input type="checkbox" :value="o.key" v-model="guestSelected" />
          <span class="opt-main">
            <span class="opt-label">{{ o.label }}</span>
            <span class="opt-desc">{{ o.desc }}</span>
          </span>
        </label>
      </section>

      <section class="settings-card">
        <h2 class="section-title">内部人员可见页面（游客不可见）</h2>
        <p class="section-sub">
          内部人员为只读身份，可浏览此处勾选的页面；已对游客可见的页面会自动包含在其可见范围内
        </p>
        <label v-for="o in insiderOptions" :key="o.key" class="opt">
          <input type="checkbox" :value="o.key" v-model="insiderSelected" />
          <span class="opt-main">
            <span class="opt-label">{{ o.label }}</span>
            <span class="opt-desc">{{ o.desc }}</span>
          </span>
        </label>
        <p v-if="guestCovered.length" class="covered-hint">
          已包含：<span v-for="o in guestCovered" :key="o.key" class="covered-tag">{{ o.label }}</span>
        </p>
        <p v-if="!insiderOptions.length" class="settings-hint">当前没有可单独授权的页面</p>
      </section>

      <section class="settings-card">
        <h2 class="section-title">网站壁纸</h2>
        <p class="section-sub">壁纸对哪些身份显示（管理员登录后恒可见；壁纸取自服务器默认目录）</p>
        <label class="opt">
          <input v-model="wallpaperGuest" type="checkbox" />
          <span class="opt-main">
            <span class="opt-label">游客可见壁纸</span>
            <span class="opt-desc">游客身份访问时显示壁纸背景</span>
          </span>
        </label>
        <label class="opt">
          <input v-model="wallpaperInsider" type="checkbox" />
          <span class="opt-main">
            <span class="opt-label">内部人员可见壁纸</span>
            <span class="opt-desc">内部人员身份访问时显示壁纸背景</span>
          </span>
        </label>

        <h3 class="sub-title">壁纸管理</h3>
        <p class="section-sub">勾选参与展示的壁纸（轮播只在选中项中随机）；不勾选任何时自动使用全部</p>
        <div class="wp-grid">
          <div
            v-for="img in wpImages"
            :key="img.name"
            class="wp-item"
            :class="{ on: img.selected }"
            :title="img.name"
            @click="toggleWp(img)"
          >
            <img :src="img.url" :alt="img.name" loading="lazy" />
            <span class="wp-check"><AppIcon v-if="img.selected" name="check" :size="12" :stroke-width="2.4" /></span>
            <span class="wp-name">{{ img.name }}</span>
          </div>
          <p v-if="!wpImages.length" class="settings-hint">壁纸目录为空（public/wallpapers/ 或 WALLPAPER_DIR）</p>
        </div>
        <div class="wp-actions">
          <button class="btn btn-sm" @click="selectAllWp(true)">全选</button>
          <button class="btn btn-sm" @click="selectAllWp(false)">全不选</button>
          <button class="btn btn-sm btn-primary" :disabled="wpSaving" @click="saveWp">
            {{ wpSaving ? '保存中…' : '保存壁纸选择' }}
          </button>
          <span v-if="wpMessage" class="wp-msg">{{ wpMessage }}</span>
        </div>
      </section>

      <section class="settings-card">
        <h2 class="section-title">Anime 内容</h2>
        <p class="section-sub">成人内容对哪些身份显示（管理员登录后恒可见；默认仅管理员可见）</p>
        <label class="opt">
          <input v-model="adultGuest" type="checkbox" />
          <span class="opt-main">
            <span class="opt-label">游客可见成人内容</span>
            <span class="opt-desc">Anime 日历 / 站内搜索对游客展示标注为成人的番剧</span>
          </span>
        </label>
        <label class="opt">
          <input v-model="adultInsider" type="checkbox" />
          <span class="opt-main">
            <span class="opt-label">内部人员可见成人内容</span>
            <span class="opt-desc">Anime 日历 / 站内搜索对内部人员展示标注为成人的番剧</span>
          </span>
        </label>
      </section>

      <section class="settings-card">
        <h2 class="section-title">访问统计</h2>
        <p class="section-sub">网站访问量、访问记录与 IP 来源（仅管理员可见；IP 归属地由 ip-api.com 按需解析）</p>
        <p v-if="visitError" class="settings-error">{{ visitError }}</p>

        <div v-if="visitSummary" class="visit-summary-grid">
          <div class="mon-item">
            <span class="mon-label">总访问量</span>
            <b>{{ visitSummary.total.toLocaleString() }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">今日</span>
            <b>{{ visitSummary.today.toLocaleString() }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">昨日</span>
            <b>{{ visitSummary.yesterday.toLocaleString() }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">独立 IP（累计）</span>
            <b>{{ visitSummary.uniqueIps.toLocaleString() }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">今日独立 IP</span>
            <b>{{ visitSummary.uniqueIpsToday.toLocaleString() }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">近 30 天独立 IP</span>
            <b>{{ visitSummary.uniqueIps30d.toLocaleString() }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">最后访问</span>
            <b>{{ visitSummary.lastRecordAt ? fmtVisitTime(visitSummary.lastRecordAt) : '暂无' }}</b>
          </div>
        </div>

        <div v-if="visitChart()" class="visit-chart">
          <LineChart title="近 30 天访问趋势" :series="visitChart().trend" :x-labels="visitChart().xLabels" y-type="plain" height="160" />
        </div>
        <p v-else-if="visitSummary" class="settings-hint">暂无访问数据</p>

        <div v-if="visitMap" class="visit-map-section">
          <h3 class="sub-title">IP 来源地图</h3>
          <p class="section-sub">
            近 30 天已解析到经纬度的 IP 分布：{{ visitMap.points.length }} 个热点位置，覆盖
            {{ visitMap.mappedIps }} 个 IP / {{ visitMap.mappedVisits }} 次访问
            <template v-if="visitMap.unresolvedIps">；另有 {{ visitMap.unresolvedIps }} 个 IP 暂无坐标</template>
          </p>
          <VisitMap :points="visitMap.points || []" />
        </div>


        <div v-if="visitSummary?.topPaths?.length || visitIps?.items?.length" class="visit-cols">
          <div v-if="visitSummary?.topPaths?.length" class="visit-panel">
            <h3 class="sub-title">热门页面（近 30 天）</h3>
            <div v-for="p in visitSummary.topPaths" :key="p.path" class="visit-rank">
              <button class="ip-link visit-rank-path" :title="`${p.path || '/'} · 点击查看访问 IP`" @click="openPathIps(p.path)">{{ p.path || '/' }}</button>
              <span class="visit-rank-count">{{ p.c }}</span>
            </div>
          </div>
          <div v-if="visitIps?.items?.length" class="visit-panel">
            <h3 class="sub-title">热门 IP（近 30 天）<span class="visit-ip-total">共 {{ visitIps.total.toLocaleString() }} 个</span></h3>
            <div v-for="p in visitIps.items" :key="p.ip" class="visit-rank">
              <button class="ip-link visit-rank-path" :title="p.location || '点击查看 IP 详情'" @click="openIpDetail(p.ip)">{{ p.ip }}</button>
              <span class="visit-rank-loc">{{ p.location }}<span v-if="p.isp" class="visit-isp"> · {{ p.isp }}</span></span>
              <span class="visit-rank-count">{{ p.count }}</span>
            </div>
            <div v-if="visitIpTotalPages > 1" class="visit-pager visit-ip-pager">
              <button class="btn btn-sm" :disabled="visitIpPage <= 1 || visitLoading" @click="changeVisitIpPage(-1)">上一页</button>
              <span>{{ visitIpPage }} / {{ visitIpTotalPages }}</span>
              <button class="btn btn-sm" :disabled="visitIpPage >= visitIpTotalPages || visitLoading" @click="changeVisitIpPage(1)">下一页</button>
              <span class="visit-jump">
                <input
                  v-model.number="visitIpJumpPage"
                  class="range-inp visit-jump-inp"
                  type="number"
                  min="1"
                  :max="visitIpTotalPages"
                  @keyup.enter="jumpVisitIpPage"
                />
                <button class="btn btn-sm" :disabled="visitLoading" @click="jumpVisitIpPage">跳转</button>
              </span>
            </div>
          </div>
        </div>

        <div class="visit-table-wrap">
          <div class="visit-toolbar">
            <input
              v-model="visitQ"
              class="range-inp"
              placeholder="搜索 IP / 路径 / UA / 来源 / IP归属地"
              @keyup.enter="searchVisits"
            />
            <button class="btn btn-sm" :disabled="visitLoading" @click="searchVisits">搜索</button>
            <button class="btn btn-sm" :disabled="visitLoading" @click="loadVisits">刷新</button>
            <span v-if="visitRecords" class="visit-total">共 {{ visitRecords.total.toLocaleString() }} 条</span>
          </div>
          <table class="visit-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>IP</th>
                <th>IP 来源</th>
                <th>访问路径</th>
                <th>来源页 / UA</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in visitRecords?.items || []" :key="r.id" class="visit-row" title="点击查看详情" @click="openRecordDetail(r)">
                <td class="visit-td-time">{{ fmtVisitTime(r.ts) }}</td>
                <td class="visit-td-ip">
                  <button v-if="r.ip" class="ip-link" title="查看 IP 详情" @click.stop="openIpDetail(r.ip)"><code>{{ r.ip }}</code></button>
                  <span v-else>—</span>
                </td>
                <td class="visit-td-loc">{{ r.location }}<span v-if="r.isp" class="visit-isp"> · {{ r.isp }}</span></td>
                <td class="visit-td-path" :title="r.path">{{ r.path }}</td>
                <td class="visit-td-ua" :title="`${r.referer || '直达'}${r.userAgent ? ' · ' + r.userAgent : ''}`">
                  {{ r.referer || '直达' }}<span v-if="r.userAgent" class="visit-ua"> · {{ r.userAgent }}</span>
                </td>
              </tr>
              <tr v-if="visitLoading">
                <td colspan="5" class="visit-empty">加载中…</td>
              </tr>
              <tr v-else-if="!visitRecords?.items?.length">
                <td colspan="5" class="visit-empty">暂无匹配记录</td>
              </tr>
            </tbody>
          </table>
          <div v-if="visitRecords && visitTotalPages > 1" class="visit-pager">
            <button class="btn btn-sm" :disabled="visitPage <= 1 || visitLoading" @click="changeVisitPage(-1)">上一页</button>
            <span>{{ visitPage }} / {{ visitTotalPages }}</span>
            <button class="btn btn-sm" :disabled="visitPage >= visitTotalPages || visitLoading" @click="changeVisitPage(1)">下一页</button>
            <span class="visit-jump">
              <input
                v-model.number="visitJumpPage"
                class="range-inp visit-jump-inp"
                type="number"
                min="1"
                :max="visitTotalPages"
                @keyup.enter="jumpVisitPage"
              />
              <button class="btn btn-sm" :disabled="visitLoading" @click="jumpVisitPage">跳转</button>
            </span>
          </div>
        </div>
      </section>


      <section class="settings-card">
        <h2 class="section-title">服务器监控</h2>
        <p class="section-sub">进程与系统实时状态（每 5 秒自动刷新，仅管理员可见）</p>
        <p v-if="monError" class="settings-error">{{ monError }}</p>
        <div v-else-if="mon" class="mon-grid">
          <div class="mon-item">
            <span class="mon-label">运行时长</span>
            <b>{{ fmtDuration(mon.uptime) }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">收到请求</span>
            <b>{{ mon.requests.toLocaleString() }}</b>
          </div>
          <div class="mon-item liquid" :style="{ '--liquid': '#37b24d' }">
            <LiquidFill :percent="memRatio" color="#37b24d" />
            <span class="mon-label">系统内存</span>
            <b>{{ fmtBytes(mon.memTotal - mon.memFree) }} / {{ fmtBytes(mon.memTotal) }} · {{ memRatio }}%</b>
          </div>
          <div class="mon-item liquid" :style="{ '--liquid': '#f59f00' }">
            <LiquidFill :percent="diskRatio" color="#f59f00" />
            <span class="mon-label">磁盘容量</span>
            <b v-if="mon.disk">{{ fmtBytes(mon.disk.used) }} / {{ fmtBytes(mon.disk.total) }} · {{ diskRatio }}%</b>
            <b v-else>—</b>
          </div>
          <div class="mon-item liquid" :style="{ '--liquid': '#4a7de0' }">
            <LiquidFill :percent="rssRatio" color="#4a7de0" />
            <span class="mon-label">进程内存 RSS</span>
            <b>{{ fmtBytes(mon.mem.rss) }} · {{ rssRatio }}%</b>
          </div>
          <div class="mon-item liquid" :style="{ '--liquid': '#9b59b6' }">
            <LiquidFill :percent="heapRatio" color="#9b59b6" />
            <span class="mon-label">堆内存</span>
            <b>{{ fmtBytes(mon.mem.heapUsed) }} / {{ fmtBytes(mon.mem.heapTotal) }} · {{ heapRatio }}%</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">系统负载</span>
            <b>{{ mon.loadAvg.map((v) => v.toFixed(2)).join(' / ') }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">CPU 核数</span>
            <b>{{ mon.cpus }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">Node 版本</span>
            <b>{{ mon.node }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">系统平台</span>
            <b>{{ mon.platform }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">主机名</span>
            <b>{{ mon.hostname }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">数据库</span>
            <b>{{ fmtBytes(mon.db.size) }} · {{ mon.db.posts ?? 0 }} 篇文章</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">更新时间</span>
            <b>{{ new Date(monUpdated).toLocaleTimeString() }}</b>
          </div>
        </div>
        <div v-else class="mon-grid">
          <p class="settings-hint">加载中…</p>
        </div>

        <!-- 监控图表 -->
        <div class="mon-charts">
          <div class="range-bar">
            <span class="range-label">时间范围</span>
            <button
              v-for="r in RANGES"
              :key="r.key"
              class="btn btn-sm range-btn"
              :class="{ active: histRange === r.key }"
              @click="histRange = r.key; onRangeChange()"
            >{{ r.label }}</button>
            <template v-if="histRange === 'custom'">
              <input v-model="customFrom" type="datetime-local" class="range-inp" />
              <span class="range-sep">至</span>
              <input v-model="customTo" type="datetime-local" class="range-inp" />
              <button class="btn btn-sm btn-primary" @click="loadHistory">查询</button>
            </template>
          </div>
          <p v-if="histErr" class="settings-error">{{ histErr }}</p>
          <div v-if="chartData()" class="chart-grid">
            <LineChart title="CPU 使用率" :series="chartData().cpu" :x-labels="chartData().xLabels" y-type="percent" />
            <LineChart title="内存使用情况" :series="chartData().mem" :x-labels="chartData().xLabels" y-type="bytes" />
            <LineChart title="网络带宽" :series="chartData().net" :x-labels="chartData().xLabels" y-type="bytes" />
            <LineChart title="系统盘读写" :series="chartData().disk" :x-labels="chartData().xLabels" y-type="bytes" />
          </div>
          <p v-else class="settings-hint">暂无监控数据（服务启动后每 5 秒采集一次）</p>
        </div>
      </section>

      <div class="actions">
        <button class="btn btn-primary" :disabled="saving" @click="onSave">
          {{ saving ? '保存中…' : '保存' }}
        </button>
        <span v-if="message" class="saved">{{ message }}</span>
      </div>
    </div>
    <VisitRecordDetailModal
      v-if="recordDetail"
      :record="recordDetail"
      @close="closeRecordDetail"
      @view-ip="openIpDetail"
    />
    <PathIpsModal
      v-if="pathIps"
      :path="pathIps"
      @close="closePathIps"
      @view-ip="openIpDetail"
    />
    <IpDetailModal v-if="ipDetail" :ip="ipDetail" @close="closeIpDetail" />

  </div>
</template>

<style scoped>
.settings-page {
  max-width: min(1200px, 95vw); /* 高分辨率适配 */
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-size: 24px;
}

.sub {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--muted);
}

.settings-error {
  color: #ff9d9d;
  font-size: 14px;
}

.settings-hint {
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 30px 0;
}

.settings-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.section-title {
  margin: 0;
  font-size: 15px;
}

.section-sub {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}

.sub-title {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--text);
}

/* 壁纸管理 */
.wp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
  margin-top: 4px;
}

.wp-item {
  position: relative;
  border: 2px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  aspect-ratio: 16 / 10;
  cursor: pointer;
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.wp-item:hover {
  border-color: var(--accent);
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 10px 26px rgb(0 0 0 / 0.18);
}

.wp-item:active {
  transform: scale(0.97);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.wp-item.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}

.wp-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.wp-item .wp-check {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
  animation: ios-pop-in var(--dur-ios-2) var(--ease-ios-spring) both;
}

.wp-item .wp-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 3px 6px;
  font-size: 11px;
  color: #fff;
  background: linear-gradient(transparent, rgb(0 0 0 / 0.65));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.wp-msg {
  font-size: 12px;
  color: var(--muted);
}

.opt {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
}

.opt:hover {
  background: var(--panel-2);
}

.opt input {
  margin-top: 4px;
  accent-color: var(--accent);
}

.opt-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.opt-label {
  font-size: 14px;
  font-weight: 600;
}

.opt-desc {
  font-size: 12px;
  color: var(--muted);
}

.covered-hint {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--muted);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.covered-tag {
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 4px;
  padding: 0 6px;
  font-size: 11px;
}

/* —— 服务器监控 —— */
.mon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px 16px;
}

.mon-item {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.mon-item .mon-label,
.mon-item b {
  position: relative;
  z-index: 1;
}

/* 有液体背景的小卡片：文字带主题色 tint，保证在彩色液面上可读 */
.mon-item.liquid .mon-label {
  color: color-mix(in srgb, var(--text) 72%, var(--liquid));
  font-weight: 600;
}

.mon-item.liquid b {
  color: var(--text);
  text-shadow: 0 1px 2px rgb(0 0 0 / 0.14);
}

.mon-label {
  font-size: 11px;
  color: var(--muted);
}

.mon-item b {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}

.mon-bars {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.mon-bar-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.mon-bar-row .mon-label {
  width: 88px;
  flex-shrink: 0;
}

.mon-bar {
  flex: 1;
  height: 8px;
  border-radius: 5px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  overflow: hidden;
}

.mon-bar-fill {
  height: 100%;
  border-radius: 5px;
  background: linear-gradient(90deg, #37b24d, #66bb6a);
  transition: width var(--dur-ios-4) var(--ease-ios-expo);
}

.mon-bar-fill.rss {
  background: linear-gradient(90deg, #4a7de0, #66a3ff);
}

.mon-val {
  width: 44px;
  text-align: right;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}


/* —— 监控图表 —— */
.mon-charts {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.range-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.range-label {
  font-size: 13px;
  color: var(--muted);
}

.range-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}

.range-inp {
  padding: 5px 8px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--text);
}

.range-inp:focus-visible,
.range-inp:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.range-sep {
  font-size: 12px;
  color: var(--muted);
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 14px;
}

@media (max-width: 860px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }
}

/* —— 访问统计 —— */
.visit-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px 16px;
}

.visit-chart {
  margin-top: 14px;
}

.visit-map-section {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.visit-map-section .section-sub {
  margin: 0;
}

.visit-cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
  margin-top: 14px;
}

.visit-panel {
  padding: 10px 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.visit-panel .sub-title {
  margin: 0;
}

.visit-ip-total {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
  margin-left: 6px;
}

.visit-ip-pager {
  margin-top: 6px;
  justify-content: flex-start;
}

.visit-rank {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: baseline;
  font-size: 12px;
  padding: 3px 0;
  border-bottom: 1px dashed var(--border);
}

.visit-rank:last-child {
  border-bottom: none;
}

.visit-rank-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.visit-rank-loc {
  grid-column: 1;
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.visit-rank-count {
  grid-row: 1 / span 2;
  grid-column: 2;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  font-weight: 700;
}

.visit-table-wrap {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-x: auto;
}

.visit-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  /* 给输入框焦点外圈留出空间，避免被 visit-table-wrap 的横向滚动裁剪 */
  padding: 2px 5px;
}

.visit-toolbar .range-inp {
  min-width: 240px;
  flex: 1;
}

.visit-total {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}

.visit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.visit-table th,
.visit-table td {
  text-align: left;
  padding: 7px 9px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.visit-table th {
  color: var(--muted);
  font-weight: 600;
  font-size: 11px;
  white-space: nowrap;
}

.visit-table td {
  color: var(--text);
}

.visit-table code {
  font-size: 12px;
  color: var(--accent);
}

.visit-td-time {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
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

.ip-link code {
  color: inherit;
  font-size: inherit;
}

.visit-td-ip {
  white-space: nowrap;
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.visit-td-loc {
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted);
}

.visit-isp {
  color: var(--muted);
  opacity: 0.7;
}

.visit-td-path {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.visit-td-ua {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
}

.visit-ua {
  display: inline-block;
  margin-left: 6px;
  color: var(--muted);
  opacity: 0.7;
}

.visit-row {
  cursor: pointer;
  transition: background var(--dur-ios-1) var(--ease-ios-expo);
}

.visit-row:hover {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.visit-empty {
  text-align: center;
  color: var(--muted);
  padding: 20px 0;
}

.visit-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
  flex-wrap: wrap;
}

.visit-jump {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.visit-jump-inp {
  width: 64px;
  padding: 4px 6px;
}

@media (max-width: 760px) {
  .visit-table th:nth-child(5),
  .visit-table td:nth-child(5) {
    display: none;
  }
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
}

.saved {
  font-size: 13px;
  color: var(--accent);
}

/* —— 网站升级 —— */
.upg-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--border);
}

.upg-row span {
  color: var(--muted);
}

.upg-row b {
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}

.upg-behind {
  color: #ffb35c;
}

.upg-ok {
  color: var(--accent);
}

.upg-ok-text {
  font-size: 12px;
  color: var(--accent);
}

.upg-commits {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  max-height: 180px;
  overflow-y: auto;
}

.upg-commits-title {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--muted);
}

.upg-commit {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  padding: 3px 0;
  color: var(--text);
}

.upg-commit code {
  font-size: 11px;
  color: var(--accent);
  flex-shrink: 0;
}

.upg-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.upg-progress {
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upg-progress-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text);
}

.upg-progress-label {
  font-weight: 600;
}

.upg-progress-spinner {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--panel);
  border-top-color: var(--accent);
  animation: upg-spin 0.8s linear infinite;
}

@keyframes upg-spin {
  to {
    transform: rotate(360deg);
  }
}

.upg-progress-track {
  height: 6px;
  border-radius: 4px;
  background: var(--panel);
  border: 1px solid var(--border);
  overflow: hidden;
}

.upg-progress-bar {
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--accent), #a78bfa);
  transition: width 0.4s var(--ease-ios-expo);
}

.upg-log {
  margin: 0;
  max-height: 200px;
  overflow: auto;
  padding: 8px 10px;
  background: #0d1117;
  color: #c9d1d9;
  border-radius: 8px;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}


.upg-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 0.4);
  backdrop-filter: blur(3px);
}

.upg-modal {
  width: min(420px, 92vw);
  padding: 22px;
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.upg-modal-title {
  margin: 0;
  font-size: 17px;
}

.upg-modal-desc {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
}

.upg-modal input {
  padding: 9px 12px;
  font-size: 14px;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  outline: none;
}

.upg-modal input:focus {
  border-color: var(--accent);
}

.upg-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

</style>
