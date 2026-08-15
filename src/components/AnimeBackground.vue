<script setup>
import { computed, ref } from 'vue'

const props = defineProps({ mediaMap: { type: Map, required: true } })

// 本地壁纸候选：放进 public/ 的图在这里登记即可，每次进入随机选一张。
// 用绑定字符串引用，避免 Vite 构建时把 public 资源当模块解析
const LOCAL_WALLPAPERS = ['/bg1.jpg', '/bg2.jpg']
const localFailed = ref(false)
const localIdx = ref(Math.floor(Math.random() * LOCAL_WALLPAPERS.length))

// 当前本地图加载失败：换下一张，全部失败后回退到 AniList 横幅图
function nextLocal() {
  localIdx.value += 1
  if (localIdx.value >= LOCAL_WALLPAPERS.length) localFailed.value = true
}

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

const src = computed(() =>
  localFailed.value ? fallbackSrc.value : LOCAL_WALLPAPERS[localIdx.value]
)
</script>

<template>
  <div class="bg-anime" aria-hidden="true">
    <img
      v-if="!localFailed"
      :src="src"
      alt=""
      @error="nextLocal"
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
