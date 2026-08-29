<script setup>
// 游戏页（游客公开）：纯前端 Canvas 地牢射击
// 玩法参考“挺进地牢”：房间制地牢、鼠标瞄准射击、翻滚闪避、随机枪械、
// 清房解锁、商店/宝箱/Boss、四层主题地牢。
import { onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { DungeonGame } from '../game/dungeon'
import { acquireWallpaper } from '../composables/useWallpaper'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'
import AppIcon from '../components/AppIcon.vue'

const canvas = ref(null)
const game = ref(null)
const auth = useAuth()
const settings = useSettings()
const wallpaperHolder = ref(null)

const screen = ref('start') // start | playing | paused | dead | victory
const stats = ref(null)
const gameSpeed = ref(1)
const hasSave = ref(false)
const SAVE_KEY = 'dsh-game-save'

function onSpawnRateInput() {
  if (game.value) game.value.setSpawnRate(gameSpeed.value)
}

function onGameOver(s) {
  stats.value = s
  screen.value = s.win ? 'victory' : 'dead'
  clearSave()
  if (canvas.value) canvas.value.style.cursor = ''
}

function onPause(paused) {
  screen.value = paused ? 'paused' : 'playing'
  if (canvas.value) canvas.value.style.cursor = paused ? '' : 'none'
}

function startGame() {
  clearSave()
  if (!game.value) {
    game.value = new DungeonGame(canvas.value, { onGameOver, onPause, spawnRate: gameSpeed.value })
  }
  game.value.setSpawnRate(gameSpeed.value)
  game.value.restartRun()
  screen.value = 'playing'
  game.value.start()
  if (canvas.value) canvas.value.style.cursor = 'none'
  if (import.meta.env.DEV) window.__game = game.value
}

function saveGame() {
  if (!game.value) return
  if (!['playing', 'paused'].includes(screen.value)) return
  if (screen.value === 'playing') game.value.pause(true)
  const data = game.value.snapshot()
  data.screen = screen.value
  data.gameSpeed = gameSpeed.value
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
    hasSave.value = true
  } catch {
    // 存储不可用时静默失败，不影响继续游戏
  }
}

function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    // ignore
  }
  hasSave.value = false
}

function refreshHasSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    hasSave.value = !!raw
    if (raw) {
      const data = JSON.parse(raw)
      if (data.gameSpeed) gameSpeed.value = data.gameSpeed
    }
  } catch {
    hasSave.value = false
  }
}

function continueGame() {
  let raw = null
  try {
    raw = localStorage.getItem(SAVE_KEY)
  } catch {
    raw = null
  }
  if (!raw) return
  try {
    const data = JSON.parse(raw)
    if (!game.value) {
      game.value = new DungeonGame(canvas.value, { onGameOver, onPause, spawnRate: gameSpeed.value })
    }
    if (!game.value.loadSnapshot(data)) {
      clearSave()
      return
    }
    gameSpeed.value = data.gameSpeed || 1
    game.value.setSpawnRate(gameSpeed.value)
    screen.value = 'playing'
    game.value.start()
    if (canvas.value) canvas.value.style.cursor = 'none'
    if (import.meta.env.DEV) window.__game = game.value
  } catch {
    clearSave()
  }
}

function restart() {
  game.value?.destroy()
  game.value = new DungeonGame(canvas.value, { onGameOver, onPause, spawnRate: gameSpeed.value })
  startGame()
}

function quitGame() {
  game.value?.destroy()
  game.value = null
  screen.value = 'start'
  clearSave()
  if (canvas.value) canvas.value.style.cursor = ''
}

function resumeGame() {
  if (!game.value) return
  game.value.pause(false)
  if (canvas.value) canvas.value.style.cursor = 'none'
}

onMounted(async () => {
  refreshHasSave()
  await settings.load()
  if (settings.canSeeWallpaper(auth.isLoggedIn.value, auth.isInsider.value)) {
    wallpaperHolder.value = acquireWallpaper()
  }
  game.value = new DungeonGame(canvas.value, { onGameOver, onPause, spawnRate: gameSpeed.value })
  if (import.meta.env.DEV) window.__game = game.value
  window.addEventListener('beforeunload', saveGame)
})

onBeforeRouteLeave(() => {
  saveGame()
})

onUnmounted(() => {
  saveGame()
  window.removeEventListener('beforeunload', saveGame)
  wallpaperHolder.value?.release()
  game.value?.destroy()
  if (canvas.value) canvas.value.style.cursor = ''
})
</script>

<template>
  <div class="game-page">
    <canvas ref="canvas" class="game-canvas"></canvas>

    <!-- 开始界面 -->
    <div v-if="screen === 'start'" class="overlay">
      <div class="panel">
        <img src="/pet/idle_front/idle_front_238.png" alt="" class="hero-img" />
        <h1 class="game-title">大肥鱼：挺进地牢</h1>
        <p class="subtitle">随机地牢 · 清房开门 · 枪械收集 · 四层 Boss</p>
        <div class="spawn-rate">
          <span>游戏速度</span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            v-model.number="gameSpeed"
            @input="onSpawnRateInput"
          />
          <b>{{ gameSpeed.toFixed(1) }}x</b>
        </div>
        <div class="keys">
          <span>移动：WASD / 方向键</span>
          <span>瞄准：鼠标</span>
          <span>射击：鼠标左键</span>
          <span>翻滚：空格 / Shift</span>
          <span>互动：E</span>
          <span>空白：F（清除弹幕）</span>
          <span>切枪：Q / 数字键</span>
          <span>暂停：Esc / P</span>
        </div>
        <div v-if="hasSave" class="btn-row">
          <button class="btn btn-primary btn-big" @click="continueGame">继续冒险</button>
          <button class="btn btn-big" @click="startGame">新的冒险</button>
        </div>
        <button v-else class="btn btn-primary btn-big" @click="startGame">开始冒险</button>
      </div>
    </div>

    <!-- 暂停 -->
    <div v-if="screen === 'paused'" class="overlay">
      <div class="panel">
        <h2 class="game-title"><AppIcon name="stop" :size="18" /> 已暂停</h2>
        <div class="spawn-rate">
          <span>游戏速度</span>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            v-model.number="gameSpeed"
            @input="onSpawnRateInput"
          />
          <b>{{ gameSpeed.toFixed(1) }}x</b>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" @click="resumeGame">继续</button>
          <button class="btn" @click="quitGame">退出游戏</button>
        </div>
      </div>
    </div>

    <!-- 结算 -->
    <div v-if="screen === 'dead'" class="overlay">
      <div class="panel">
        <h2 class="game-title"><AppIcon name="skull" :size="18" /> 冒险失败</h2>
        <div class="stat-list">
          <p>抵达层数：<b>第 {{ stats.floor }} 层</b></p>
          <p>生存时间：<b>{{ stats.time }}s</b></p>
          <p>击杀数：<b>{{ stats.kills }}</b></p>
          <p>清空房间：<b>{{ stats.roomsCleared }}</b></p>
          <p>金币：<b>{{ stats.money }}</b></p>
          <p>得分：<b>{{ stats.score }}</b></p>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" @click="restart">再来一局</button>
          <router-link to="/" class="btn">返回首页</router-link>
        </div>
      </div>
    </div>

    <!-- 通关 -->
    <div v-if="screen === 'victory'" class="overlay">
      <div class="panel">
        <h2 class="game-title"><AppIcon name="star" :size="18" /> 地牢通关！</h2>
        <p class="subtitle">你击败了四层地牢的所有 Boss</p>
        <div class="stat-list">
          <p>生存时间：<b>{{ stats.time }}s</b></p>
          <p>击杀数：<b>{{ stats.kills }}</b></p>
          <p>清空房间：<b>{{ stats.roomsCleared }}</b></p>
          <p>金币：<b>{{ stats.money }}</b></p>
          <p>得分：<b>{{ stats.score }}</b></p>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" @click="restart">再次挑战</button>
          <router-link to="/" class="btn">返回首页</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-page {
  position: relative;
  height: calc(100vh - 48px); /* 导航栏下方全屏 */
  overflow: hidden;
  background: transparent;
}

.game-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(2 6 23 / 0.4);
  backdrop-filter: blur(4px);
  z-index: 10;
}

.panel {
  max-width: 520px;
  padding: 28px 30px;
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.hero-img {
  width: 90px;
  height: 120px;
  object-fit: contain;
  filter: drop-shadow(0 6px 14px rgb(59 130 246 / 0.5));
}

.game-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 26px;
  font-weight: 900;
  background: linear-gradient(135deg, #38bdf8, #818cf8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.game-title .app-icon {
  color: #38bdf8;
  flex-shrink: 0;
}

.subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}

.keys {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 16px;
  font-size: 12px;
  color: var(--muted);
}

.spawn-rate {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--muted);
}

.spawn-rate input[type="range"] {
  width: 160px;
  accent-color: var(--accent);
}

.spawn-rate b {
  min-width: 34px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.btn-big {
  padding: 10px 34px;
  font-size: 15px;
}

.btn-row {
  display: flex;
  gap: 10px;
}

.stat-list p {
  margin: 6px 0;
  font-size: 15px;
  color: var(--muted);
}

.stat-list b {
  color: var(--accent);
}
</style>
