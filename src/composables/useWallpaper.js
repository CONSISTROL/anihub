// 壁纸管理器（模块级单例）：把 Anime 页的壁纸逻辑抽出，供 Anime 页背景与
// 内部人员模式全局背景共用。多个持有者并存时壁纸保持显示，全部释放后才移除。
// 壁纸通过 --wallpaper-url 应用到 <html>（body 背景 CSS 叠加同色遮罩），
// 并记住上次的壁纸：index.html 内联脚本会在首帧前恢复，刷新时不闪纯色背景。
// 每次进入为下次访问随机预选一张（访问中不换图），加载失败自动换下一张。
import { ref } from 'vue'
import { api } from '../api/http'

const STORE_KEY = 'anime-calendar.wallpaper'

const images = ref([]) // 壁纸 URL 列表（服务端实时扫描目录）
const allFailed = ref(false)
const displayUrl = ref(localStorage.getItem(STORE_KEY) || '')
const failedIdxs = new Set() // 已确认加载失败的序号，避免反复试同一张

let owners = 0 // 当前持有壁纸的组件数（Anime 页 / 内部模式背景）
let initStarted = false

function applyBody(url) {
  const el = document.documentElement
  if (!url) {
    el.style.removeProperty('--wallpaper-url')
    return
  }
  el.style.setProperty('--wallpaper-url', `url("${url.replace(/"/g, '\\"')}")`)
}

function preload(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('壁纸加载失败'))
    img.src = url
  })
}

function candidates() {
  return images.value.map((_, i) => i).filter((i) => !failedIdxs.has(i))
}

function pickRandom() {
  const list = candidates()
  if (!list.length) return null
  return images.value[list[Math.floor(Math.random() * list.length)]]
}

// 选一张并立即应用（预加载成功后才切换，避免空白闪烁）；全部失败则清除壁纸
function applyRandom() {
  const url = pickRandom()
  if (!url) {
    allFailed.value = true
    applyBody('')
    return
  }
  preload(url)
    .then(() => {
      displayUrl.value = url
      localStorage.setItem(STORE_KEY, url)
      if (owners > 0) applyBody(url) // 期间若已无持有者则不再显示
    })
    .catch(() => {
      failedIdxs.add(images.value.indexOf(url))
      applyRandom()
    })
}

// 本次已显示缓存壁纸：为下次访问随机预选一张并持久化（不切换当前显示）
function prepareNext() {
  const url = pickRandom()
  if (!url || url === displayUrl.value) return
  localStorage.setItem(STORE_KEY, url)
}

async function init() {
  // background-image 不会触发 error 事件，手动探测缓存壁纸是否仍可用
  if (displayUrl.value) {
    preload(displayUrl.value).catch(() => {
      localStorage.removeItem(STORE_KEY)
      displayUrl.value = ''
      applyBody('')
      if (images.value.length && owners > 0) applyRandom()
    })
  }
  try {
    images.value = (await api('/wallpapers')).images || []
  } catch {
    /* 接口不可用视为空列表，走回退 */
  }
  if (displayUrl.value) {
    prepareNext() // 缓存有效：本次保持显示，预选下一次
  } else if (owners > 0) {
    applyRandom() // 无缓存（首次访问）：立即选一张显示
  }
}

/**
 * 组件挂载时调用，返回共享状态与 release 释放函数。
 * 首个持有者应用缓存壁纸并启动初始化（拉取壁纸列表、探测缓存、随机预选）。
 */
export function acquireWallpaper() {
  owners++
  if (owners === 1) {
    if (displayUrl.value) applyBody(displayUrl.value) // 同步应用缓存壁纸
    if (!initStarted) {
      initStarted = true
      init()
    }
  }
  return { displayUrl, images, allFailed, release }
}

function release() {
  owners = Math.max(0, owners - 1)
  if (owners === 0) {
    applyBody('') // 无持有者：移除壁纸，避免其他页面残留背景
    initStarted = false // 下次持有重新拉取列表（与旧行为一致）
  }
}
