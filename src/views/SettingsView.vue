<script setup>
// 设置页：配置哪些页面对游客可见、哪些页面对内部人员额外可见 + 壁纸/成人内容身份控制 + 服务器监控（图表）
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getSettings, updateSettings, getMonitor, getMonitorHistory, getWallpapersManage, saveWallpaperSelection } from '../api/settings'
import { useSettings } from '../composables/useSettings'
import LineChart from '../components/LineChart.vue'
import AppIcon from '../components/AppIcon.vue'

const settings = useSettings()

const OPTIONS = [
  { key: 'anime', label: 'Anime 日历', desc: '当前档期新番放送时间表' },
  { key: 'blog', label: 'Blog 博客', desc: '追番笔记与推荐' },
  { key: 'wiki', label: 'Wiki', desc: '动漫知识库' },
  { key: 'tools', label: 'Tools 工具箱', desc: 'JSON 格式化 / 二维码解析 / 图片裁切' },
  { key: 'game', label: 'Game 游戏', desc: '大肥鱼割草，纯前端小游戏' },
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

onMounted(() => {
  refreshMonitor()
  monTimer = setInterval(refreshMonitor, 5000)
  setCustomNow()
  loadHistory()
  histTimer = setInterval(loadHistory, 15000)
})
onUnmounted(() => {
  clearInterval(monTimer)
  clearInterval(histTimer)
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
          <div class="mon-item">
            <span class="mon-label">系统内存</span>
            <b>{{ fmtBytes(mon.memTotal - mon.memFree) }} / {{ fmtBytes(mon.memTotal) }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">进程内存 RSS</span>
            <b>{{ fmtBytes(mon.mem.rss) }}</b>
          </div>
          <div class="mon-item">
            <span class="mon-label">堆内存</span>
            <b>{{ fmtBytes(mon.mem.heapUsed) }} / {{ fmtBytes(mon.mem.heapTotal) }}</b>
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
        <div v-if="mon" class="mon-bars">
          <div class="mon-bar-row">
            <span class="mon-label">系统内存占用</span>
            <div class="mon-bar"><div class="mon-bar-fill" :style="{ width: memRatio + '%' }"></div></div>
            <span class="mon-val">{{ memRatio }}%</span>
          </div>
          <div class="mon-bar-row">
            <span class="mon-label">本进程 RSS</span>
            <div class="mon-bar"><div class="mon-bar-fill rss" :style="{ width: rssRatio + '%' }"></div></div>
            <span class="mon-val">{{ rssRatio }}%</span>
          </div>
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
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
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
</style>
