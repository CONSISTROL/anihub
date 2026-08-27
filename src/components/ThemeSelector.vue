<script setup>
// 主题切换：日/夜滑动开关（移植自 github.com/Xiumuzaidiao/Day-night-toggle-button v4.0，纯 CSS 矢量）。
// 白天=浅色：金色太阳居左、白环光晕、云朵漂浮；夜晚=深色：太阳滑到右侧变灰月亮（环形山淡入）、
// 星星从上方落下并闪烁、云朵下沉；整体 em 基准，font-size 控制缩放。
// 默认按时间自动切换（6:00–18:00 浅色，其余深色）；点击整块开关手动切到相反主题。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { resolved, setTheme } from '../composables/useTheme'

const rootEl = ref(null)
const isNight = computed(() => resolved.value === 'dark')

function toggle() {
  setTheme(isNight.value ? 'light' : 'dark')
}

// 云朵随机漂移（原实现每秒随机 ±2em）
let driftTimer = null
onMounted(() => {
  driftTimer = setInterval(() => {
    const r = () => (Math.random() < 0.5 ? '-2em' : '2em')
    rootEl.value?.querySelectorAll('.ts-cloud-son').forEach((el) => {
      el.style.transform = `translate(${r()}, ${r()})`
    })
  }, 1000)
})
onUnmounted(() => clearInterval(driftTimer))
</script>

<template>
  <div ref="rootEl" class="ts-wrap" :class="{ night: isNight }">
    <div class="ts-components" title="切换深色/浅色主题" @click="toggle">
      <!-- 太阳/月亮滑块（月亮 = 灰色圆 + 三个环形山淡入） -->
      <div class="ts-main-button">
        <div class="ts-moon"></div>
        <div class="ts-moon"></div>
        <div class="ts-moon"></div>
      </div>
      <!-- 白天光晕圆层（夜晚右滑视差） -->
      <div class="ts-daytime-background"></div>
      <div class="ts-daytime-background"></div>
      <div class="ts-daytime-background"></div>
      <!-- 云朵 -->
      <div class="ts-cloud">
        <div class="ts-cloud-son"></div>
        <div class="ts-cloud-son"></div>
        <div class="ts-cloud-son"></div>
        <div class="ts-cloud-son"></div>
        <div class="ts-cloud-son"></div>
        <div class="ts-cloud-son"></div>
      </div>
      <!-- 云朵亮层 -->
      <div class="ts-cloud-light">
        <div class="ts-cloud-son"></div>
        <div class="ts-cloud-son"></div>
        <div class="ts-cloud-son"></div>
        <div class="ts-cloud-son"></div>
        <div class="ts-cloud-son"></div>
        <div class="ts-cloud-son"></div>
      </div>
      <!-- 夜晚星星（从上方落下，进入后持续闪烁） -->
      <div class="ts-stars">
        <div class="ts-star big"><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div></div>
        <div class="ts-star big"><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div></div>
        <div class="ts-star medium"><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div></div>
        <div class="ts-star medium"><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div></div>
        <div class="ts-star small"><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div></div>
        <div class="ts-star small"><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div><div class="ts-star-son"></div></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 原设计 180×70em，font-size 决定实际尺寸（≈77×31 适配导航栏） */
.ts-wrap {
  font-size: 0.43px;
  width: 180em;
  height: 70em;
  position: relative;
  flex-shrink: 0;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
}

.ts-components {
  position: absolute;
  inset: 0;
  z-index: 0; /* 建立层叠上下文，负 z 子层才能浮在背景上 */
  background-color: rgba(70, 133, 192, 1);
  border-radius: 100em;
  box-shadow: inset 0 0 5em 3em rgba(0, 0, 0, 0.5);
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.7s;
  transition-timing-function: cubic-bezier(0, 0.5, 1, 1);
}

.ts-wrap.night .ts-components {
  background-color: rgba(25, 30, 50, 1);
}

/* —— 太阳/月亮滑块（transform 常驻 → 环形山跟随滑块） —— */
.ts-main-button {
  margin: 7.5em 0 0 7.5em;
  width: 55em;
  height: 55em;
  background-color: rgba(255, 195, 35, 1);
  border-radius: 50%;
  box-shadow:
    3em 3em 5em rgba(0, 0, 0, 0.5),
    inset -3em -5em 3em -3em rgba(0, 0, 0, 0.5),
    inset 4em 5em 2em -2em rgba(255, 230, 80, 1);
  transform: translateX(0);
  transition:
    transform 1s,
    background-color 1s,
    box-shadow 1s;
  transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1);
}

.ts-wrap.night .ts-main-button {
  transform: translateX(110em);
  background-color: rgba(195, 200, 210, 1);
  box-shadow:
    3em 3em 5em rgba(0, 0, 0, 0.5),
    inset -3em -5em 3em -3em rgba(0, 0, 0, 0.5),
    inset 4em 5em 2em -2em rgba(255, 255, 210, 1);
}

/* 悬停轻推（白天向右、夜晚向左微移） */
.ts-wrap:not(.night):hover .ts-main-button {
  transform: translateX(10em);
}

.ts-wrap.night:hover .ts-main-button {
  transform: translateX(100em);
}

/* 月亮环形山 */
.ts-moon {
  position: absolute;
  background-color: rgba(150, 160, 180, 1);
  box-shadow: inset 0em 0em 1em 1em rgba(0, 0, 0, 0.3);
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.5s;
}

.ts-wrap.night .ts-moon {
  opacity: 1;
}

.ts-moon:nth-child(1) {
  top: 7.5em;
  left: 25em;
  width: 12.5em;
  height: 12.5em;
}

.ts-moon:nth-child(2) {
  top: 20em;
  left: 7.5em;
  width: 20em;
  height: 20em;
}

.ts-moon:nth-child(3) {
  top: 32.5em;
  left: 32.5em;
  width: 12.5em;
  height: 12.5em;
}

/* —— 白天光晕圆层（夜晚右滑视差） —— */
.ts-daytime-background {
  position: absolute;
  border-radius: 50%;
  transition: transform 1s;
  transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1);
}

.ts-daytime-background:nth-child(2) {
  top: -20em;
  left: -20em;
  width: 110em;
  height: 110em;
  background-color: rgba(255, 255, 255, 0.2);
  z-index: -2;
}

.ts-daytime-background:nth-child(3) {
  top: -32.5em;
  left: -17.5em;
  width: 135em;
  height: 135em;
  background-color: rgba(255, 255, 255, 0.1);
  z-index: -3;
}

.ts-daytime-background:nth-child(4) {
  top: -45em;
  left: -15em;
  width: 160em;
  height: 160em;
  background-color: rgba(255, 255, 255, 0.05);
  z-index: -4;
}

.ts-wrap.night .ts-daytime-background:nth-child(2) {
  transform: translateX(110em);
}

.ts-wrap.night .ts-daytime-background:nth-child(3) {
  transform: translateX(80em);
}

.ts-wrap.night .ts-daytime-background:nth-child(4) {
  transform: translateX(50em);
}

/* —— 云朵（夜晚下沉） —— */
.ts-cloud {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform: translateY(10em);
  transition: transform 1s;
  transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1);
}

.ts-wrap.night .ts-cloud {
  transform: translateY(80em);
}

/* 云朵亮层：锚在右下角的 0 尺寸盒子（子云相对它定位，与原实现一致） */
.ts-cloud-light {
  position: absolute;
  right: 0;
  bottom: 25em;
  opacity: 0.5;
  transform: translateY(10em);
  transition: transform 1s;
  transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1);
}

.ts-wrap.night .ts-cloud-light {
  transform: translateY(80em);
}

.ts-cloud-son {
  position: absolute;
  background-color: #fff;
  border-radius: 50%;
  z-index: -1;
  transition: transform 6s, right 1s, bottom 1s;
}

/* 云层子云（bottom 比原版 +7.5em：云层是 100% 盒子而原版锚在太阳底部 62.5em） */
.ts-cloud .ts-cloud-son:nth-child(6n + 1) {
  right: -20em;
  bottom: 17.5em;
  width: 50em;
  height: 50em;
}

.ts-cloud .ts-cloud-son:nth-child(6n + 2) {
  right: -10em;
  bottom: -17.5em;
  width: 60em;
  height: 60em;
}

.ts-cloud .ts-cloud-son:nth-child(6n + 3) {
  right: 20em;
  bottom: -32.5em;
  width: 60em;
  height: 60em;
}

.ts-cloud .ts-cloud-son:nth-child(6n + 4) {
  right: 50em;
  bottom: -27.5em;
  width: 60em;
  height: 60em;
}

.ts-cloud .ts-cloud-son:nth-child(6n + 5) {
  right: 75em;
  bottom: -52.5em;
  width: 75em;
  height: 75em;
}

.ts-cloud .ts-cloud-son:nth-child(6n + 6) {
  right: 110em;
  bottom: -42.5em;
  width: 60em;
  height: 60em;
}

/* 亮层子云（锚点已在右下角 45em 处，用原版值） */
.ts-cloud-light .ts-cloud-son:nth-child(6n + 1) {
  right: -20em;
  bottom: 10em;
  width: 50em;
  height: 50em;
}

.ts-cloud-light .ts-cloud-son:nth-child(6n + 2) {
  right: -10em;
  bottom: -25em;
  width: 60em;
  height: 60em;
}

.ts-cloud-light .ts-cloud-son:nth-child(6n + 3) {
  right: 20em;
  bottom: -40em;
  width: 60em;
  height: 60em;
}

.ts-cloud-light .ts-cloud-son:nth-child(6n + 4) {
  right: 50em;
  bottom: -35em;
  width: 60em;
  height: 60em;
}

.ts-cloud-light .ts-cloud-son:nth-child(6n + 5) {
  right: 75em;
  bottom: -60em;
  width: 75em;
  height: 75em;
}

.ts-cloud-light .ts-cloud-son:nth-child(6n + 6) {
  right: 110em;
  bottom: -50em;
  width: 60em;
  height: 60em;
}

.ts-cloud {
  z-index: -2;
}

.ts-cloud-light {
  z-index: -3;
}

/* —— 夜晚星星（从上方落下进入，持续闪烁） ——
   注意：星星层保持流内定位（静态位置在太阳下方 62.5em），
   夜晚 translateY(-62.5em) 后正好落进轨道可见区域 */
.ts-stars {
  transform: translateY(-125em);
  opacity: 0;
  transition:
    transform 1s,
    opacity 1s;
  transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1);
}

.ts-wrap.night .ts-stars {
  transform: translateY(-62.5em);
  opacity: 1;
}

.ts-star {
  position: absolute;
  width: calc(2 * var(--size));
  height: calc(2 * var(--size));
  transform: scale(1);
  transition: transform 1s;
  transition-timing-function: cubic-bezier(0.56, 1.35, 0.52, 1);
  animation: ts-twinkle 3s linear infinite alternate;
}

.ts-star.big {
  --size: 7.5em;
}

.ts-star.medium {
  --size: 5em;
}

.ts-star.small {
  --size: 3em;
}

.ts-star:nth-child(1) {
  top: 11em;
  left: 39em;
  animation-duration: 3.5s;
}

.ts-star:nth-child(2) {
  top: 39em;
  left: 91em;
  animation-duration: 4.1s;
}

.ts-star:nth-child(3) {
  top: 26em;
  left: 19em;
  animation-duration: 4.9s;
}

.ts-star:nth-child(4) {
  top: 37em;
  left: 66em;
  animation-duration: 5.3s;
}

.ts-star:nth-child(5) {
  top: 21em;
  left: 75em;
  animation-duration: 3s;
}

.ts-star:nth-child(6) {
  top: 51em;
  left: 38em;
  animation-duration: 2.2s;
}

@keyframes ts-twinkle {
  0%,
  20% {
    transform: scale(0);
  }
  20%,
  100% {
    transform: scale(1);
  }
}

/* 四角星：四个径向渐变象限 */
.ts-star-son {
  float: left;
  width: var(--size);
  height: var(--size);
  background-image: radial-gradient(circle var(--size) at var(--pos), transparent var(--size), #fff);
}

.ts-star-son:nth-child(1) {
  --pos: left 0;
}

.ts-star-son:nth-child(2) {
  --pos: right 0;
}

.ts-star-son:nth-child(3) {
  --pos: 0 bottom;
}

.ts-star-son:nth-child(4) {
  --pos: right bottom;
}
</style>
