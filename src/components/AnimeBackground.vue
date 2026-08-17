<script setup>
// Anime 页背景：壁纸逻辑已抽到 useWallpaper 管理器（Anime 页与内部人员模式全局背景共用）。
// 壁纸通过 --wallpaper-url 应用到 <body> 背景；本组件仅在全部壁纸加载失败时
// 用档期数据的横幅图回退（依赖 mediaMap）。
import { computed, onUnmounted } from 'vue'
import { acquireWallpaper } from '../composables/useWallpaper'

const props = defineProps({ mediaMap: { type: Map, required: true } })
const { allFailed, release } = acquireWallpaper()
onUnmounted(() => release())

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
