<script setup>
import { computed } from 'vue'

const props = defineProps({
  mediaMap: { type: Map, required: true },
})

// 取档期热门动画的封面，拼成二次元背景墙（最多 12 张）
const covers = computed(() =>
  [...props.mediaMap.values()]
    .map((m) => m.coverImage?.large || m.coverImage?.medium)
    .filter(Boolean)
    .slice(0, 12)
)
</script>

<template>
  <div class="bg-wall" aria-hidden="true">
    <img
      v-for="(src, i) in covers"
      :key="src"
      :src="src"
      :alt="''"
      loading="lazy"
      @error="(e) => (e.target.style.display = 'none')"
    />
  </div>
</template>

<style scoped>
.bg-wall {
  position: fixed;
  inset: 0;
  z-index: -1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(3, 1fr);
  overflow: hidden;
}

.bg-wall img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(10px) saturate(1.15);
  transform: scale(1.08); /* 模糊后边缘留白补偿 */
}

/* 遮罩：深色主题压暗、浅色主题提亮，保证前景可读 */
.bg-wall::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgb(10 12 18 / 0.62);
}

:root[data-theme='light'] .bg-wall::after {
  background: rgb(245 246 250 / 0.72);
}
</style>
