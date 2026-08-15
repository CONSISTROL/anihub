<script setup>
// Anime 页背景：从服务端壁纸目录列表随机选一张展示。
// 图片放在 public/wallpapers/（或 WALLPAPER_DIR 指向的目录）即可，
// 无需登记；单张加载失败自动换下一张，全部失败回退到 AniList 横幅图
import { computed, onMounted, ref } from 'vue'
import { api } from '../api/http'

const props = defineProps({ mediaMap: { type: Map, required: true } })

const images = ref([]) // 壁纸 URL 列表（服务端实时扫描目录）
const currentIdx = ref(-1)
const allFailed = ref(false)
const failedIdxs = new Set() // 已加载失败的序号，避免反复试同一张

function pickNext() {
  const candidates = images.value.map((_, i) => i).filter((i) => !failedIdxs.has(i))
  if (!candidates.length) {
    allFailed.value = true
    return
  }
  currentIdx.value = candidates[Math.floor(Math.random() * candidates.length)]
}

function onImgError() {
  if (currentIdx.value >= 0) failedIdxs.add(currentIdx.value)
  pickNext()
}

onMounted(async () => {
  try {
    images.value = (await api('/wallpapers')).images || []
  } catch {
    // 接口不可用视为空列表，走 AniList 回退
  }
  pickNext()
})

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
  <div class="bg-anime" aria-hidden="true">
    <img
      v-if="!allFailed && images[currentIdx]"
      :src="images[currentIdx]"
      alt=""
      @error="onImgError"
    />
    <img
      v-else-if="fallbackSrc"
      :src="fallbackSrc"
      alt=""
    />
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
