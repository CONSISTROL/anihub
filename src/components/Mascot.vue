<script setup>
// 桌宠（大肥鱼）：网页左下角的动画小宠物，帧动画驱动（素材取自 dsh-dafeiyu 项目）。
// 交互：
// - 左键点击：随机互动（摸头/戳/尾巴）；按住拖动（沿底部移动）
// - 右键：菜单（喂食 / 逗一逗 / 回到角落 / 状态气泡开关 / 隐藏）
// - 喂食：放出一条鱼，桌宠走过去吃掉并开心/气泡反馈
// - 状态气泡：思考/扫地/互动/觅食/随机闲聊时在头顶显示文字（可在菜单开关，记住选择）
// 自动行为：待机呼吸、随机眨眼/张望、偶尔思考/扫地、沿底部散步一段。
// 可见性由设置页「桌宠」权限控制（默认内部人员可见，游客需管理员开放）。
import { onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'

const emit = defineEmits(['hide'])

const B = (p) => `/pet/${p}`

const CLIPS = {
  idle: { frames: [B('idle_front/idle_front_238.png')], ms: 200, loop: true },
  blink: {
    frames: ['00', '01', '02', '03', '04'].map((n) => B(`idle_blink/idle_blink_238_${n}.png`)),
    ms: 100,
    loop: false,
  },
  glance: {
    frames: ['00', '01', '02', '03', '04', '05', '06'].map((n) => B(`idle_glance/idle_glance_238_${n}.png`)),
    ms: 160,
    loop: false,
  },
  think: { frames: [B('idle_think/idle_think_238.png')], ms: 200, loop: true, hold: 4500 },
  sweep: { frames: [B('sweep/sweep_238.png')], ms: 200, loop: true, hold: 5000 },
  happy: { frames: [B('happy/happy_238.png')], ms: 200, loop: true, hold: 3200 },
  dragging: { frames: [B('dragging/dragging_238.png')], ms: 200, loop: true },
  headPat: {
    frames: ['00', '01', '02', '03', '04', '05'].map((n) => B(`head_pat/head_pat_238_${n}.png`)),
    ms: 180,
    loop: false,
  },
  poke: {
    frames: ['00', '01', '02', '03'].map((n) => B(`poke_react/poke_react_238_${n}.png`)),
    ms: 170,
    loop: false,
  },
  tail: {
    frames: ['00', '01', '02', '03'].map((n) => B(`tail_react/tail_react_238_${n}.png`)),
    ms: 220,
    loop: false,
  },
  walkStart: {
    frames: [B('walk_start_left/walk_start_left_238_00.png'), B('walk_start_left/walk_start_left_238_01.png')],
    ms: 118,
    loop: false,
  },
  walk: {
    frames: ['00', '01', '02', '03'].map((n) => B(`walk_side/walk_side_238_${n}.png`)),
    ms: 135,
    loop: true,
  },
  walkStop: {
    frames: [B('walk_stop_left/walk_stop_left_238_00.png'), B('walk_stop_left/walk_stop_left_238_01.png')],
    ms: 135,
    loop: false,
  },
}

const PET_H = 150 // 显示高度（px）
const PET_W = Math.round(PET_H * 0.75) // 帧约 195×260，宽高比 ≈ 0.75
const MARGIN = 12
const BUBBLE_KEY = 'anime-calendar.mascot.bubble'

// 随机闲聊文案
const LINES = ['你好呀～', '今天也要加油！', '呜…好像有点饿了', '外面在忙什么呢', '摸鱼时间到～', '要不要喂我一条鱼？']

const state = ref('idle')
const frame = ref(0)
const flipped = ref(false) // 朝右走时水平翻转（帧素材默认朝左）
// 停靠角落：右下角（left = 视口宽 - 宠物宽 - 边距）
const HOME_X = () => Math.max(MARGIN, window.innerWidth - PET_W - MARGIN)
const posX = ref(HOME_X())
const dragging = ref(false)
const hidden = ref(false) // 本次会话隐藏（刷新恢复）

const bubbleText = ref('')
const bubbleOn = ref(localStorage.getItem(BUBBLE_KEY) !== '0')
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const foodX = ref(null) // 鱼的位置（null = 没有鱼）

let timer = null
let microTimer = null
let holdTimer = null
let bubbleTimer = null
let foodTimer = null
let walking = false
let walkSteps = 0 // 本次散步剩余帧数
let walkTarget = null // 定向行走目标（觅食时使用）
let pendingFood = false // 正在走向食物
let dir = 1 // 1=右  -1=左
let dragStartX = 0
let dragBaseX = 0
let moved = false

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

// 预加载全部帧，切换动画不闪烁
function preloadAll() {
  const seen = new Set()
  for (const c of Object.values(CLIPS)) {
    for (const f of c.frames) {
      if (seen.has(f)) continue
      seen.add(f)
      const img = new Image()
      img.src = f
    }
  }
}

function schedule(ms) {
  clearTimeout(timer)
  timer = setTimeout(tick, ms)
}

function play(name) {
  state.value = name
  frame.value = 0
  schedule(CLIPS[name].ms)
}

function playHold(name) {
  play(name)
  clearTimeout(holdTimer)
  holdTimer = setTimeout(() => {
    if (state.value === name) play('idle')
  }, CLIPS[name].hold)
}

/* —— 状态气泡 —— */
function say(text, ms = 2600) {
  if (!bubbleOn.value) return
  bubbleText.value = text
  clearTimeout(bubbleTimer)
  bubbleTimer = setTimeout(() => {
    bubbleText.value = ''
  }, ms)
}

function toggleBubble() {
  bubbleOn.value = !bubbleOn.value
  localStorage.setItem(BUBBLE_KEY, bubbleOn.value ? '1' : '0')
  bubbleText.value = ''
  if (bubbleOn.value) say('我会说话了！')
}

/* —— 帧循环 —— */
function tick() {
  const clip = CLIPS[state.value]
  if (!clip) return

  // 走路：每帧移动；定向行走（觅食）到目标停下，随机散步走完步数停下
  if (state.value === 'walk' && walking) {
    const maxX = window.innerWidth - PET_W - MARGIN
    posX.value = clamp(posX.value + 6 * dir, MARGIN, maxX)
    if (walkTarget != null) {
      const reached = dir > 0 ? posX.value >= walkTarget : posX.value <= walkTarget
      if (reached) {
        posX.value = walkTarget
        walkTarget = null
        finishWalk()
        return
      }
    } else {
      if (posX.value <= MARGIN && dir < 0) dir = 1
      else if (posX.value >= maxX && dir > 0) dir = -1
      flipped.value = dir === 1
      if (--walkSteps <= 0) {
        play('walkStop') // 走一段后停下休息
        return
      }
    }
    frame.value = (frame.value + 1) % clip.frames.length
    schedule(clip.ms)
    return
  }

  if (frame.value + 1 < clip.frames.length) {
    frame.value++
    schedule(clip.ms)
  } else if (clip.loop) {
    frame.value = 0
    schedule(clip.ms)
  } else {
    onClipEnd(state.value)
  }
}

function onClipEnd(name) {
  switch (name) {
    case 'walkStart':
      state.value = 'walk'
      frame.value = 0
      schedule(CLIPS.walk.ms)
      break
    case 'walkStop':
      walking = false
      play('idle')
      break
    default: // 眨眼/张望/互动/思考/扫地/开心等：回到待机
      play('idle')
      break
  }
}

// 走到目标后的收尾：若在觅食则开吃，否则停下
function finishWalk() {
  if (pendingFood) {
    pendingFood = false
    clearTimeout(foodTimer)
    foodX.value = null
    playHold('happy')
    say('好吃！谢谢～')
  } else {
    play('walkStop')
  }
}

function startWalk() {
  if (walking || dragging.value) return
  walking = true
  walkTarget = null
  walkSteps = 8 + Math.floor(Math.random() * 20) // 随机走 8~27 帧（约 1~3.6 秒）
  const maxX = window.innerWidth - PET_W - MARGIN
  if (posX.value <= MARGIN) dir = 1
  else if (posX.value >= maxX) dir = -1
  else dir = Math.random() < 0.5 ? -1 : 1
  flipped.value = dir === 1
  play('walkStart')
}

/* —— 喂食 —— */
function feed() {
  if (hidden.value) return
  const maxX = window.innerWidth - PET_W - MARGIN
  foodX.value = MARGIN + Math.random() * Math.max(1, maxX - MARGIN)
  pendingFood = true
  clearTimeout(foodTimer)
  foodTimer = setTimeout(() => {
    if (pendingFood) {
      pendingFood = false
      foodX.value = null // 鱼等太久消失了
    }
  }, 15000)
  say('哇，有鱼吃！', 2000)
  // 取消当前活动，走向食物
  walking = true
  walkTarget = foodX.value
  walkSteps = 9999
  dir = walkTarget >= posX.value ? 1 : -1
  flipped.value = dir === 1
  play('walkStart')
}

/* —— 空闲时随机小动作 —— */
function microTick() {
  if (state.value !== 'idle' || walking || dragging.value) return
  const r = Math.random()
  if (r < 0.3) play('blink')
  else if (r < 0.5) play('glance')
  else if (r < 0.65) {
    playHold('think')
    say('思考中…')
  } else if (r < 0.78) {
    playHold('sweep')
    say('扫扫地～')
  } else if (r < 0.88) startWalk()
  else say(LINES[Math.floor(Math.random() * LINES.length)])
}

/* —— 左键互动 & 拖动 —— */
function onPointerDown(e) {
  if (e.button !== 0) return
  e.preventDefault()
  closeMenu()
  dragStartX = e.clientX
  dragBaseX = posX.value
  moved = false
  dragging.value = true
  // 拖动打断当前散步/觅食
  walking = false
  walkTarget = null
  if (pendingFood) {
    pendingFood = false
    clearTimeout(foodTimer)
    foodX.value = null
  }
  play('dragging')
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e) {
  const dx = e.clientX - dragStartX
  if (Math.abs(dx) > 5) moved = true
  if (moved) {
    const maxX = window.innerWidth - PET_W - MARGIN
    posX.value = clamp(dragBaseX + dx, MARGIN, maxX)
  }
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  dragging.value = false
  if (!moved) {
    const r = Math.random()
    if (r < 0.4) {
      play('headPat')
      say('摸摸～好舒服')
    } else if (r < 0.7) {
      play('poke')
      say('呜哇！戳我干嘛！')
    } else {
      play('tail')
      say('看我的尾巴～')
    }
  } else {
    play('idle')
  }
}

/* —— 右键菜单 —— */
function onContextMenu(e) {
  const W = 176
  const H = 216
  menuX.value = clamp(e.clientX, 8, window.innerWidth - W - 8)
  menuY.value = clamp(e.clientY, 8, window.innerHeight - H - 8)
  menuOpen.value = true
}

function closeMenu() {
  menuOpen.value = false
}

function menuAction(type) {
  closeMenu()
  switch (type) {
    case 'feed':
      feed()
      break
    case 'play': {
      const r = Math.random()
      play(r < 0.4 ? 'headPat' : r < 0.7 ? 'poke' : 'tail')
      break
    }
    case 'home':
      goHome()
      break
    case 'bubble':
      toggleBubble()
      break
    case 'hide':
      hide()
      break
  }
}

function goHome() {
  walking = false
  walkTarget = null
  if (pendingFood) {
    pendingFood = false
    clearTimeout(foodTimer)
    foodX.value = null
  }
  posX.value = HOME_X()
  flipped.value = false
  play('idle')
  say('回到角落～')
}

function hide() {
  hidden.value = true
  emit('hide')
  if (pendingFood) {
    pendingFood = false
    clearTimeout(foodTimer)
    foodX.value = null
  }
}

function show() {
  hidden.value = false
}

defineExpose({ show })

function onWinPointerDown(e) {
  if (menuOpen.value && !(e.target instanceof Element && e.target.closest('.mascot-menu'))) closeMenu()
}

function onWinKey(e) {
  if (e.key === 'Escape') closeMenu()
}

onMounted(() => {
  preloadAll()
  microTimer = setInterval(microTick, 7000)
  play('idle')
  window.addEventListener('pointerdown', onWinPointerDown)
  window.addEventListener('keydown', onWinKey)
})

onUnmounted(() => {
  clearInterval(microTimer)
  clearTimeout(timer)
  clearTimeout(holdTimer)
  clearTimeout(bubbleTimer)
  clearTimeout(foodTimer)
  window.removeEventListener('pointerdown', onWinPointerDown)
  window.removeEventListener('keydown', onWinKey)
})
</script>

<template>
  <div
    v-if="!hidden"
    class="mascot"
    :class="{ dragging }"
    :style="{ left: posX + 'px', height: PET_H + 'px' }"
    title="大肥鱼 · 左键互动 / 拖动，右键菜单"
    @pointerdown="onPointerDown"
    @contextmenu.prevent="onContextMenu"
  >
    <img :src="CLIPS[state].frames[frame]" :class="{ flip: flipped }" alt="桌宠" draggable="false" />
    <div v-if="bubbleOn && bubbleText" class="mascot-bubble">{{ bubbleText }}</div>
  </div>

  <!-- 食物（喂食） -->
  <div v-if="!hidden && foodX !== null" class="mascot-food" :style="{ left: foodX + 'px' }"><AppIcon name="fish" :size="22" /></div>

  <!-- 右键菜单 -->
  <div v-if="!hidden && menuOpen" class="mascot-menu" :style="{ left: menuX + 'px', top: menuY + 'px' }">
    <button type="button" @click="menuAction('feed')"><AppIcon name="fish" :size="14" /> 喂食</button>
    <button type="button" @click="menuAction('play')"><AppIcon name="sparkles" :size="14" /> 逗一逗</button>
    <button type="button" @click="menuAction('home')"><AppIcon name="house" :size="14" /> 回到角落</button>
    <button type="button" @click="menuAction('bubble')"><AppIcon name="message" :size="14" /> 状态气泡：{{ bubbleOn ? '开' : '关' }}</button>
    <button type="button" @click="menuAction('hide')"><AppIcon name="eye-off" :size="14" /> 隐藏（本次会话）</button>
  </div>
</template>

<style scoped>
.mascot {
  position: fixed;
  left: 12px;
  bottom: 10px; /* 贴底：右下角（停靠点由 posX 控制，初始为右下角） */
  z-index: 55; /* 低于登录弹窗(100) */
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}

.mascot.dragging {
  cursor: grabbing;
}

.mascot img {
  height: 100%;
  width: auto;
  pointer-events: none;
  -webkit-user-drag: none;
  filter: drop-shadow(0 4px 10px rgb(0 0 0 / 0.28));
}

.mascot img.flip {
  transform: scaleX(-1);
}

/* 状态气泡 */
.mascot-bubble {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  font-size: 13px;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.15);
  z-index: 56;
}

.mascot-bubble::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: var(--overlay-panel);
}

/* 食物 */
.mascot-food {
  position: fixed;
  bottom: 14px;
  z-index: 54;
  color: var(--accent);
  pointer-events: none;
  animation: food-drop 0.5s ease-out;
  filter: drop-shadow(0 3px 6px rgb(0 0 0 / 0.25));
}

@keyframes food-drop {
  0% {
    transform: translateY(-140px) scale(0.7);
    opacity: 0;
  }
  60% {
    transform: translateY(6px) scale(1.06);
    opacity: 1;
  }
  100% {
    transform: translateY(0) scale(1);
  }
}

/* 右键菜单 */
.mascot-menu {
  position: fixed;
  z-index: 70;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px;
  background: var(--overlay-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
  min-width: 160px;
}

.mascot-menu button {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  font-size: 13px;
  text-align: left;
  color: var(--text);
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  white-space: nowrap;
}

.mascot-menu button:hover {
  background: var(--panel-2);
  color: var(--accent);
}
</style>
