<script setup>
// 卡片背景液体填充层：高度 = percent，顶部两层细正弦水面持续流动；
// 页面滚动时水面随滚动方向轻微摇晃（水杯走路效果）。
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  percent: { type: Number, default: 0 },
  color: { type: String, default: '#4a7de0' },
})

const pct = computed(() => `${Math.max(0, Math.min(100, Number(props.percent) || 0))}%`)

/* —— 滚动时水面摇晃 —— */
const waterLayer = ref(null)
let lastScrollY = 0
let raf = 0

function slosh(strength) {
  const el = waterLayer.value
  if (!el || !el.animate) return
  const k = Math.max(-1, Math.min(1, strength))
  el.animate(
    [
      { transform: 'translateX(0px) skewX(0deg)' },
      { transform: `translateX(${k * 5}px) skewX(${k * 1.4}deg)`, offset: 0.3 },
      { transform: `translateX(${k * -3}px) skewX(${k * -1}deg)`, offset: 0.62 },
      { transform: 'translateX(0px) skewX(0deg)', offset: 1 },
    ],
    { duration: 650, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
  )
}

function onScroll() {
  const y = window.scrollY || document.documentElement.scrollTop || 0
  const dy = y - lastScrollY
  lastScrollY = y
  if (Math.abs(dy) < 4) return
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    slosh(dy / 80)
  })
}

onMounted(() => {
  lastScrollY = window.scrollY || document.documentElement.scrollTop || 0
  window.addEventListener('scroll', onScroll, { passive: true })
})
onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <div class="liquid-fill" :style="{ '--liquid': color, '--pct': pct }" aria-hidden="true">
    <span class="liquid-shine"></span>
    <div ref="waterLayer" class="water-layer">
      <svg class="water water-back" viewBox="0 0 1200 24" preserveAspectRatio="none">
        <path
          d="M0,20
             C37.5,17 112.5,17 150,20
             C187.5,23 262.5,23 300,20
             C337.5,17 412.5,17 450,20
             C487.5,23 562.5,23 600,20
             C637.5,17 712.5,17 750,20
             C787.5,23 862.5,23 900,20
             C937.5,17 1012.5,17 1050,20
             C1087.5,23 1162.5,23 1200,20
             L1200,24 L0,24 Z"
        />
      </svg>
      <svg class="water water-front" viewBox="0 0 1200 24" preserveAspectRatio="none">
        <path
          d="M0,20
             C37.5,23 112.5,23 150,20
             C187.5,17 262.5,17 300,20
             C337.5,23 412.5,23 450,20
             C487.5,17 562.5,17 600,20
             C637.5,23 712.5,23 750,20
             C787.5,17 862.5,17 900,20
             C937.5,23 1012.5,23 1050,20
             C1087.5,17 1162.5,17 1200,20
             L1200,24 L0,24 Z"
        />
      </svg>
    </div>
    <span class="bubble bubble-1"></span>
    <span class="bubble bubble-2"></span>
  </div>
</template>

<style scoped>
.liquid-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--pct, 0%);
  z-index: 0;
  overflow: hidden;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--liquid) 70%, white),
    color-mix(in srgb, var(--liquid) 42%, transparent)
  );
  transition: height var(--dur-ios-4) var(--ease-ios-expo);
  pointer-events: none;
}

.liquid-shine {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  z-index: 3;
  background: color-mix(in srgb, white 60%, var(--liquid));
  opacity: 0.55;
}

.water-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  will-change: transform;
}

.water {
  position: absolute;
  left: 0;
  display: block;
  width: 200%;
  height: 24px;
}

.water path {
  fill: color-mix(in srgb, var(--liquid) 55%, transparent);
}

.water-back {
  top: -18px;
  animation: water-slide 7s linear infinite;
}

.water-front {
  top: -21px;
  z-index: 2;
  opacity: 0.5;
  animation: water-slide 10s linear infinite reverse;
}

.water-front path {
  fill: color-mix(in srgb, var(--liquid) 36%, transparent);
}

@keyframes water-slide {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-25%);
  }
}

.bubble {
  position: absolute;
  bottom: -12px;
  z-index: 0;
  border-radius: 50%;
  background: color-mix(in srgb, white 45%, transparent);
  animation: bubble-rise 5.5s ease-in infinite;
}

.bubble-1 {
  left: 24%;
  width: 7px;
  height: 7px;
}

.bubble-2 {
  left: 70%;
  width: 5px;
  height: 5px;
  animation-delay: 2.6s;
  animation-duration: 6.5s;
}

@keyframes bubble-rise {
  0% {
    transform: translateY(0) scale(0.6);
    opacity: 0;
  }
  15% {
    opacity: 0.7;
  }
  100% {
    transform: translateY(-90px) scale(1.05);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .water,
  .bubble {
    animation: none;
  }
}
</style>
