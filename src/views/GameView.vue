<script setup>
// 游戏页（游客公开）：纯 2D 大肥鱼割草——主角使用网站桌宠形象，自动攻击、冲刺闪避，
// 升级三选一能力卡，小怪/精英/boss 掉落不同品质道具，地图上有可探索资源点。
// 怪物 / 地图资源 / 道具先用 Canvas 矢量图形渲染。
import { onMounted, onUnmounted, ref } from 'vue'
import { MowGame } from '../game/engine'
import { acquireWallpaper } from '../composables/useWallpaper'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'

const canvas = ref(null)
const game = ref(null)
const auth = useAuth()
const settings = useSettings()
const wallpaperHolder = ref(null) // 开始/暂停等界面背景显示壁纸（按身份控制）

const screen = ref('start') // start | playing | levelup | paused | dead
const choices = ref([])
const stats = ref(null)
const spawnRate = ref(1)

function onSpawnRateInput() {
  if (game.value) game.value.setSpawnRate(spawnRate.value)
}

function onLevelUp(c) {
  choices.value = c
  screen.value = 'levelup'
}

function onGameOver(s) {
  stats.value = s
  screen.value = 'dead'
}

function onPause(paused) {
  screen.value = paused ? 'paused' : 'playing'
}

function startGame() {
  if (!game.value) {
    game.value = new MowGame(canvas.value, { onLevelUp, onGameOver, onPause, spawnRate: spawnRate.value })
  }
  game.value.setSpawnRate(spawnRate.value)
  screen.value = 'playing'
  game.value.start()
  if (import.meta.env.DEV) window.__game = game.value
}

function pickAbility(i) {
  game.value.chooseAbility(i)
  screen.value = 'playing'
}

function restart() {
  game.value?.destroy()
  game.value = new MowGame(canvas.value, { onLevelUp, onGameOver, onPause, spawnRate: spawnRate.value })
  startGame()
}

function quitGame() {
  game.value?.destroy()
  game.value = null
  screen.value = 'start'
}

onMounted(async () => {
  // 开始/暂停等界面背景显示壁纸（与 Anime 页共用壁纸管理器，按身份控制，管理员恒可见）
  await settings.load()
  if (settings.canSeeWallpaper(auth.isLoggedIn.value, auth.isInsider.value)) {
    wallpaperHolder.value = acquireWallpaper()
  }
  game.value = new MowGame(canvas.value, { onLevelUp, onGameOver, onPause, spawnRate: spawnRate.value })
  if (import.meta.env.DEV) window.__game = game.value
})

onUnmounted(() => {
  wallpaperHolder.value?.release()
  game.value?.destroy()
})
</script>

<template>
  <div class="game-page">
    <canvas ref="canvas" class="game-canvas"></canvas>

    <!-- 开始界面 -->
    <div v-if="screen === 'start'" class="overlay">
      <div class="panel">
        <img src="/pet/idle_front/idle_front_238.png" alt="" class="hero-img" />
        <h1 class="game-title">大肥鱼割草</h1>
        <div class="spawn-rate">
          <span>刷怪速度</span>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            v-model.number="spawnRate"
            @input="onSpawnRateInput"
          />
          <b>{{ spawnRate.toFixed(1) }}x</b>
        </div>
        <div class="keys">
          <span>移动：WASD / 方向键</span>
          <span>冲刺：空格 / Shift</span>
          <span>暂停：Esc / P</span>
          <span>小地图：右下角</span>
          <span>连击：连续击杀叠乘区</span>
        </div>
        <button class="btn btn-primary btn-big" @click="startGame">开始游戏</button>
      </div>
    </div>

    <!-- 升级选卡 -->
    <div v-if="screen === 'levelup'" class="overlay">
      <div class="levelup">
        <h2 class="lu-title">🎉 升级了！选择一项能力</h2>
        <div class="cards">
          <button
            v-for="(c, i) in choices"
            :key="c.id"
            class="card"
            @click="pickAbility(i)"
          >
            <span class="card-icon">{{ c.icon }}</span>
            <span class="card-name">{{ c.name }}</span>
            <span class="card-desc">{{ c.desc }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 暂停 -->
    <div v-if="screen === 'paused'" class="overlay">
      <div class="panel">
        <h2 class="game-title">已暂停</h2>
        <div class="spawn-rate">
          <span>刷怪速度</span>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            v-model.number="spawnRate"
            @input="onSpawnRateInput"
          />
          <b>{{ spawnRate.toFixed(1) }}x</b>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" @click="game.pause(false)">继续</button>
          <button class="btn" @click="quitGame">退出游戏</button>
        </div>
      </div>
    </div>

    <!-- 结算 -->
    <div v-if="screen === 'dead'" class="overlay">
      <div class="panel">
        <h2 class="game-title">💀 游戏结束</h2>
        <div class="stat-list">
          <p>生存时间：<b>{{ stats.time }}s</b></p>
          <p>击杀数：<b>{{ stats.kills }}</b></p>
          <p>到达等级：<b>{{ stats.level }}</b></p>
          <p>得分：<b>{{ stats.score }}</b></p>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" @click="restart">再来一局</button>
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
  /* 背景透明：开始/暂停等界面露出站点壁纸；游戏运行时 canvas 由引擎自行清屏绘制 */
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
  max-width: 480px;
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
  margin: 0;
  font-size: 26px;
  font-weight: 900;
  background: linear-gradient(135deg, #38bdf8, #818cf8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
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

/* 升级选卡 */
.levelup {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}

.lu-title {
  margin: 0;
  font-size: 22px;
  color: var(--text);
}

.cards {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
}

.card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 150px;
  padding: 18px 12px;
  background: var(--overlay-panel);
  border: 2px solid var(--border);
  border-radius: 14px;
  cursor: pointer;
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.card:hover {
  transform: translateY(-4px);
  border-color: var(--accent);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
}

.card-icon {
  font-size: 34px;
}

.card-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.card-desc {
  font-size: 12px;
  color: var(--muted);
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
