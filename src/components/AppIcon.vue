<script setup>
// 全站统一线性图标组件（iOS SF Symbols 风格）
// 用法：<AppIcon name="search" :size="16" />  颜色自动继承 color，深色/浅色主题自适应
import { computed } from 'vue'
import { ICONS } from '../icons'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 },
  strokeWidth: { type: [Number, String], default: 1.7 },
})

const paths = computed(() => ICONS[props.name] || [])
</script>

<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-for="(el, i) in paths" :key="i">
      <path v-if="el.t === 'path'" :d="el.d" :fill="el.fill ? 'currentColor' : 'none'" />
      <circle
        v-else-if="el.t === 'circle'"
        :cx="el.cx"
        :cy="el.cy"
        :r="el.r"
        :fill="el.fill ? 'currentColor' : 'none'"
      />
      <line v-else-if="el.t === 'line'" :x1="el.x1" :y1="el.y1" :x2="el.x2" :y2="el.y2" />
      <polyline
        v-else-if="el.t === 'polyline'"
        :points="el.points"
        :fill="el.fill ? 'currentColor' : 'none'"
      />
      <polygon
        v-else-if="el.t === 'polygon'"
        :points="el.points"
        :fill="el.fill ? 'currentColor' : 'none'"
      />
      <rect
        v-else-if="el.t === 'rect'"
        :x="el.x"
        :y="el.y"
        :width="el.width"
        :height="el.height"
        :rx="el.rx || 0"
        :fill="el.fill ? 'currentColor' : 'none'"
      />
      <ellipse
        v-else-if="el.t === 'ellipse'"
        :cx="el.cx"
        :cy="el.cy"
        :rx="el.rx"
        :ry="el.ry"
        :fill="el.fill ? 'currentColor' : 'none'"
      />
    </template>
  </svg>
</template>

<style scoped>
.app-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: -0.125em;
}
</style>
