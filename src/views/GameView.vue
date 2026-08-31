<script setup>
// /game 页面：嵌入 Shattered Pixel Dungeon Web（TeaVM/libGDX 构建产物）
// 游戏本体由 game/shattered-pixel-dungeon-web 构建后输出到 public/spd
import { computed, onActivated, onMounted, onUnmounted, ref } from 'vue'
import { useGameAudio } from '../composables/useGameAudio'

defineOptions({ name: 'GameView' })

const frame = ref(null)
const loaded = ref(false)
const failed = ref(false)
const topOffset = ref(48)
const { audioMode, chooseAudio } = useGameAudio()

const iframeSrc = computed(() =>
  audioMode.value === 'noaudio' ? '/spd/index.html?noaudio=1' : '/spd/index.html'
)

let loadTimer = null

function onLoad() {
  loaded.value = true
  failed.value = false
  if (loadTimer) {
    clearTimeout(loadTimer)
    loadTimer = null
  }
  frame.value?.focus()
}

function onError() {
  loaded.value = false
  failed.value = true
}

function reload() {
  window.location.reload()
}

// 给一个较长的兜底提示：TeaVM 生成的 app.js 较大，首次加载需要一些时间
function startLoadTimer() {
  if (loadTimer) clearTimeout(loadTimer)
  loadTimer = setTimeout(() => {
    if (!loaded.value) failed.value = true
  }, 60000)
}

// 根据顶部导航栏实际高度定位游戏区域，避免血条/HUD 被导航栏遮挡
function updateTop() {
  const nav = document.querySelector('.navbar')
  topOffset.value = nav ? nav.getBoundingClientRect().height : 0
}

onMounted(() => {
  updateTop()
  window.addEventListener('resize', updateTop)
  if (audioMode.value) startLoadTimer()
})

onActivated(updateTop)

onUnmounted(() => {
  if (loadTimer) clearTimeout(loadTimer)
  window.removeEventListener('resize', updateTop)
})
</script>

<template>
  <div class="game-page" :style="{ top: topOffset + 'px' }">
    <template v-if="audioMode">
      <iframe
        ref="frame"
        :src="iframeSrc"
        class="spd-frame"
        :class="{ ready: loaded }"
        title="Shattered Pixel Dungeon"
        allow="autoplay; fullscreen"
        tabindex="-1"
        @load="onLoad"
        @error="onError"
      />
      <div v-if="!loaded" class="spd-loading">
        <div class="spinner" aria-hidden="true"></div>
        <p class="spd-loading-text">
          {{ failed ? '游戏加载失败，请检查浏览器是否支持 WebGL 后刷新重试。' : 'Shattered Pixel Dungeon 加载中…' }}
        </p>
        <button v-if="failed" class="btn btn-primary" @click="reload">刷新重试</button>
      </div>
    </template>

    <div v-else class="spd-audio-choice">
      <h2 class="spd-choice-title">选择游戏加载模式</h2>
      <p class="spd-choice-sub">无音频模式传输量更小，加载更快</p>
      <div class="spd-choice-btns">
        <button class="btn btn-primary btn-big" @click="chooseAudio('noaudio')">
          极速模式（无音频）
        </button>
        <button class="btn btn-big" @click="chooseAudio('audio')">
          完整模式（含音频）
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-page {
  position: fixed;
  inset: 48px 0 0; /* 导航栏高度下方铺满 */
  overflow: hidden;
  background: #0b0e14;
}

.spd-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  opacity: 0;
  transition: opacity var(--dur-ios-2) var(--ease-ios-expo);
}

.spd-frame.ready {
  opacity: 1;
}

.spd-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--muted);
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spd-spin 0.8s linear infinite;
}

.spd-loading-text {
  margin: 0;
  font-size: 14px;
  text-align: center;
  padding: 0 20px;
}

.spd-audio-choice {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--text);
  background: #0b0e14;
  padding: 20px;
  text-align: center;
}

.spd-choice-title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
}

.spd-choice-sub {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

.spd-choice-btns {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 8px;
}

.btn-big {
  padding: 12px 28px;
  font-size: 15px;
}

@keyframes spd-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
