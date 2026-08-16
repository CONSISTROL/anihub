<script setup>
// Anime 页背景：壁纸来自服务端扫描的目录（public/wallpapers 或 WALLPAPER_DIR），随机选择。
// 壁纸通过 --wallpaper-url 应用到 <body> 背景（CSS 叠加同色遮罩，等效原来的半透明 img），
// 并记住上次的壁纸：index.html 内联脚本会在首帧前恢复，刷新时直接显示壁纸、不闪纯色背景。
// 每次进入为下次访问随机预选一张（访问中不换图），加载失败自动换下一张，全部失败回退 AniList 横幅。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api/http'

const props = defineProps({ mediaMap: { type: Map, required: true } })

const STORE_KEY = 'anime-calendar.wallpaper'
const images = ref([]) // 壁纸 URL 列表（服务端实时扫描目录）
const allFailed = ref(false)
const failedIdxs = new Set() // 已确认加载失败的序号，避免反复试同一张
const displayUrl = ref(localStorage.getItem(STORE_KEY) || '')

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

// 选一张并立即应用（预加载成功后才切换，避免空白闪烁）；全部失败则回退横幅
function applyRandom() {
  const url = pickRandom()
  if (!url) {
    allFailed.value = true
    applyBody('') // 清除壁纸，横幅回退交给模板中的 <img>
    return
  }
  preload(url)
    .then(() => {
      displayUrl.value = url
      localStorage.setItem(STORE_KEY, url)
      applyBody(url)
    })
    .catch(() => {
      failedIdxs.add(images.value.indexOf(url))
      applyRandom()
    })
}

// 本次已显示缓存壁纸：为下次访问随机预选一张并持久化（不切换当前显示，访问中不换图）
function prepareNext() {
  const url = pickRandom()
  if (!url || url === displayUrl.value) return
  localStorage.setItem(STORE_KEY, url)
}

// 同步应用缓存壁纸（setup 即生效；index.html 已应用过则幂等）
if (displayUrl.value) applyBody(displayUrl.value)

onMounted(async () => {
  // background-image 不会触发 error 事件，手动探测缓存壁纸是否仍可用
  if (displayUrl.value) {
    preload(displayUrl.value).catch(() => {
      localStorage.removeItem(STORE_KEY)
      displayUrl.value = ''
      applyBody('')
      if (images.value.length) applyRandom()
    })
  }
  try {
    images.value = (await api('/wallpapers')).images || []
  } catch {
    /* 接口不可用视为空列表，走回退 */
  }
  if (displayUrl.value) {
    prepareNext() // 缓存有效：本次保持显示，预选下一次
  } else {
    applyRandom() // 无缓存（首次访问）：立即选一张显示
  }
})

// 离开 Anime 页时移除壁纸，避免其他页面残留背景
onUnmounted(() => applyBody(''))

// 封面 URL 里 AniList 可能只给 medium/large 桶，这里强制换成 extra_large 原图桶
function hdCover(m) {
  const src = m.coverImage?.extraLarge || m.coverImage?.large || m.coverImage?.medium
  return src?.replace(/\/cover\/(?:small|medium|large)\//, '/cover/extra_large/')
}

const fallbackSrc = computed(() => {
  for (const m of props.mediaMap.values()) {
    if (m.bannerImage) return m.bannerImage
  }
  for (const m of props.mediaMap.values()) {
    const src = hdCover(m)
    if (src) return src
  }
  return ''
})
</script>

<template>
  <!-- 壁纸已通过 --wallpaper-url 应用到 <body>；此处仅保留全部失败时的横幅回退 -->
  <div class="bg-anime" aria-hidden="true">
    <img v-if="allFailed && fallbackSrc" :src="fallbackSrc" alt="" />
  </div>
</template>

<style scoped>
.bg-anime {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}

.bg-anime img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  opacity: 0.15;
}

:root[data-theme='light'] .bg-anime img {
  opacity: 0.09;
}
</style>
