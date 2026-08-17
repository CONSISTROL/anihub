<script setup>
// 桌宠（大肥鱼）：网页右下角的动画小宠物，帧动画驱动（素材取自 dsh-dafeiyu 项目）。
// 行为：待机呼吸 → 随机眨眼/张望/思考/扫地 → 偶尔沿屏幕底部走动（到边缘回头）；
// 点击触发互动（摸头/戳/尾巴）；可按住拖动。
// 可见性由设置页的「桌宠」权限控制（默认仅登录可见，游客/内部人员需管理员开放）。
import { onMounted, onUnmounted, ref } from 'vue'

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

const state = ref('idle')
const frame = ref(0)
const flipped = ref(false) // 朝右走时水平翻转（帧素材默认朝左）
const posX = ref(MARGIN)
const dragging = ref(false)

let timer = null
let microTimer = null
let holdTimer = null
let walking = false
let dir = 1 // 1=右  -1=左
let dragStartX = 0
let dragBaseX = 0
let moved = false

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

function tick() {
  const clip = CLIPS[state.value]
  if (!clip) return

  // 走路：每帧移动并检查边界
  if (state.value === 'walk' && walking) {
    const maxX = window.innerWidth - PET_W - MARGIN
    posX.value = Math.min(maxX, Math.max(MARGIN, posX.value + 6 * dir))
    if (posX.value <= MARGIN && dir < 0) dir = 1
    else if (posX.value >= maxX && dir > 0) dir = -1
    flipped.value = dir === 1
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

function startWalk() {
  if (walking || dragging.value) return
  walking = true
  const maxX = window.innerWidth - PET_W - MARGIN
  if (posX.value <= MARGIN) dir = 1
  else if (posX.value >= maxX) dir = -1
  else dir = Math.random() < 0.5 ? -1 : 1
  flipped.value = dir === 1
  play('walkStart')
}

// 空闲时随机小动作
function microTick() {
  if (state.value !== 'idle' || walking || dragging.value) return
  const r = Math.random()
  if (r < 0.35) play('blink')
  else if (r < 0.6) play('glance')
  else if (r < 0.78) playHold('think')
  else if (r < 0.92) playHold('sweep')
  else startWalk()
}

/* —— 点击互动 & 拖动 —— */
function onPointerDown(e) {
  if (e.button !== 0) return
  e.preventDefault()
  dragStartX = e.clientX
  dragBaseX = posX.value
  moved = false
  dragging.value = true
  play('dragging')
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(e) {
  const dx = e.clientX - dragStartX
  if (Math.abs(dx) > 5) moved = true
  if (moved) {
    const maxX = window.innerWidth - PET_W - MARGIN
    posX.value = Math.min(maxX, Math.max(MARGIN, dragBaseX + dx))
  }
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  dragging.value = false
  if (!moved) {
    const r = Math.random()
    play(r < 0.4 ? 'headPat' : r < 0.7 ? 'poke' : 'tail') // 点击互动
  } else {
    play('idle')
  }
}

onMounted(() => {
  preloadAll()
  microTimer = setInterval(microTick, 7000)
  play('idle')
})

onUnmounted(() => {
  clearInterval(microTimer)
  clearTimeout(timer)
  clearTimeout(holdTimer)
})
</script>

<template>
  <div
    class="mascot"
    :class="{ dragging }"
    :style="{ left: posX + 'px', height: PET_H + 'px' }"
    title="大肥鱼 · 点击互动，按住可拖动"
    @pointerdown="onPointerDown"
  >
    <img :src="CLIPS[state].frames[frame]" :class="{ flip: flipped }" alt="桌宠" draggable="false" />
  </div>
</template>

<style scoped>
.mascot {
  position: fixed;
  left: 12px;
  bottom: 10px;
  z-index: 55; /* 低于登录弹窗(100)；与右下角回到顶部按钮(60)左右分置不重叠 */
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
</style>
