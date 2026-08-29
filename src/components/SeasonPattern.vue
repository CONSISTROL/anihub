<script setup>
// 季节动态背景：按档期显示飘落的樱花瓣 / 荷叶荷花瓣 / 枫叶 / 雪花
// 使用确定性伪随机，保证同一档期每次渲染位置一致；负 delay 让元素一开始就分散在整个背景里
import { computed } from 'vue'

const props = defineProps({
  season: { type: String, default: 'spring' },
  density: { type: Number, default: 14 },
})

const CONFIG = {
  winter: {
    pool: ['❄️'],
    motion: 'season-fall',
    sizeBase: 13,
    sizeRange: 17,
    durationBase: 12,
    durationRange: 8,
    sway: 26,
    opacity: 0.5,
  },
  spring: {
    pool: ['🌸', '🌸', '🌸'],
    motion: 'season-fall',
    sizeBase: 13,
    sizeRange: 11,
    durationBase: 10,
    durationRange: 8,
    sway: 34,
    opacity: 0.42,
  },
  summer: {
    pool: ['🪷'],
    motion: 'lotus-float',
    sizeBase: 14,
    sizeRange: 12,
    durationBase: 9,
    durationRange: 5,
    sway: 14,
    opacity: 0.42,
  },
  fall: {
    pool: ['🍁', '🍁', '🍁'],
    motion: 'season-fall',
    sizeBase: 15,
    sizeRange: 13,
    durationBase: 10,
    durationRange: 7,
    sway: 42,
    opacity: 0.45,
  },
}

function rand(season, i, salt, mod) {
  const seed = season.length * 17 + season.charCodeAt(0) + i * 31 + salt * 71
  const v = Math.sin(seed * 12.9898) * 43758.5453
  return Math.floor(Math.abs(v - Math.floor(v)) * mod)
}

const items = computed(() => {
  const key = String(props.season || '').toLowerCase()
  const cfg = CONFIG[key] || CONFIG.spring
  const n = Math.max(4, Math.min(40, Math.round(props.density)))
  const out = []
  for (let i = 0; i < n; i++) {
    const duration =
      cfg.durationBase + rand(key, i, 1, cfg.durationRange + 1)
    const from = cfg.motion === 'lotus-float'
      ? 5 + rand(key, i, 2, 78)
      : -12 + rand(key, i, 2, 104)
    out.push({
      char: cfg.pool[i % cfg.pool.length],
      motion: cfg.motion,
      left: rand(key, i, 3, 96),
      from: `${from}%`,
      size: `${cfg.sizeBase + rand(key, i, 4, cfg.sizeRange + 1)}px`,
      duration: `${duration}s`,
      delay: `-${rand(key, i, 5, duration + 1)}s`,
      sway: `${cfg.sway / 2 - rand(key, i, 6, cfg.sway + 1)}px`,
      spin: `${180 + rand(key, i, 7, 360)}deg`,
      opacity: cfg.opacity,
    })
  }
  return out
})

function itemStyle(it) {
  return {
    left: `${it.left}%`,
    fontSize: it.size,
    '--from': it.from,
    '--sway': it.sway,
    '--spin': it.spin,
    '--opacity': it.opacity,
    animationDuration: it.duration,
    animationDelay: it.delay,
  }
}
</script>

<template>
  <div class="season-pattern" aria-hidden="true">
    <span
      v-for="(it, i) in items"
      :key="i"
      class="season-item"
      :class="it.motion"
      :style="itemStyle(it)"
    >{{ it.char }}</span>
  </div>
</template>

<style scoped>
.season-pattern {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
}

.season-item {
  position: absolute;
  top: var(--from);
  line-height: 1;
  opacity: var(--opacity);
  will-change: top, transform, opacity;
  user-select: none;
}

.season-item.season-fall {
  animation-name: season-fall;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}

.season-item.lotus-float {
  animation-name: lotus-float;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}

@keyframes season-fall {
  0% {
    top: var(--from);
    transform: translateX(0) rotate(0deg);
    opacity: 0;
  }
  10% {
    opacity: var(--opacity);
  }
  85% {
    opacity: var(--opacity);
  }
  100% {
    top: 108%;
    transform: translateX(var(--sway)) rotate(var(--spin));
    opacity: 0;
  }
}

@keyframes lotus-float {
  0%,
  100% {
    top: var(--from);
    transform: translateX(0) rotate(-8deg);
  }
  50% {
    top: calc(var(--from) + 7%);
    transform: translateX(var(--sway)) rotate(8deg);
  }
}
</style>
