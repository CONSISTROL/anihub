<script setup>
// 桌宠（蓝毛小女仆）：按 dsh-pet 原始项目（https://github.com/PC2005-cloud/dsh-pet）适配。
// 素材与动画池命名参考其 dsh-pet/assets/config.jsonc + dsh-pet/assets/webm。
// 行为：
// - 动画链：每个 10s 动画播完按权重（idle/turn/move + 分类动作）选下一个，不常驻循环
// - 转向：东张西望播完翻转朝向；朝右时镜像播放
// - 移动：选 move 动画后由 rAF 按 lead/tail 时段驱动水平位移
// - 左键点击：随机点击回应；按住拖动
// - 右键菜单：动作分类完整点播 / 随机逗一逗 / 回到角落 / 状态气泡开关 / 隐藏
// 可见性由设置页「桌宠」权限控制（默认内部人员可见，游客需管理员开放）。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'

const emit = defineEmits(['hide'])

/* 素材 URL：与原始项目 flat webm 命名保持一致 */
const WEBM = (name) => `/pet/webm/${encodeURIComponent(name)}.webm`

const IDLE = '待机呼吸休闲'
const TURN = '东张西望'
const DRAG = '被鼠标拖拽悬空反馈'
const CLICKS = [
  '点击回应-开心跃动',
  '点击回应-害羞惊讶',
  '点击回应-傲娇生气',
  '点击回应-元气挥手',
  '点击回应-挠痒咯咯笑',
]

/* 移动池与原始 config.jsonc 的 animations.moves 结构一致 */
const MOVE_DEFAULT = { minDist: 60, maxDist: 240, margin: 20, leadSec: 2, tailSec: 2 }
const MOVES = [
  { name: '螃蟹走路' },
  { name: '原地漂浮踏步', params: { minDist: 40, maxDist: 120 } },
  { name: '原地左转奔跑', params: { minDist: 120, maxDist: 320, leadSec: 1.75, tailSec: 4.8 } },
]

/* 随机动作分类：与原始 config.jsonc 的 animations.categories 完全一致 */
const CATEGORIES = [
  {
    id: '小动作',
    weight: 20,
    actions: [
      '悠闲哼歌', '超大伸懒腰', '原地敲击桌面互动', '原地重力下蹲压缩', '哈欠连天',
      '原地小憩沉眠', '女仆屈膝礼仪', '被吓一跳', '小幅度原地360度旋转展示',
      '偷吃零食被抓住', '用鲸鱼尾巴拍打地面', '打瞌睡被惊醒', '照镜子', '整体换装试色',
      '轻快记录', '写代码', '摇扇纳凉', '晨间刷牙',
    ],
  },
  {
    id: '玩耍',
    weight: 20,
    actions: [
      '原地专心玩魔方', '原地蹲下玩玩具汽车', '鲸鱼吐泡泡特效', '原地跳跃抓碎头顶物品',
      '玩游戏气急败坏', '玩水枪', '小提琴演奏', '蓝鲸现世', '优雅女仆舞', '轻快摇摆舞',
      '可爱宅舞', '吹气球', '动物环绕', '放风筝', '拆礼物', '变鸽子', '扑克魔术',
      '抽陀螺', '吹笛子', '蝴蝶蜜蜂环绕头顶开花', '撸猫', '凭空生花', '骑木马',
      '三球抛接', '踢毽子', '下五子棋', '荡秋千',
    ],
  },
  {
    id: '吃什么',
    weight: 16,
    actions: [
      '吃白饭', '大口吃零食', '吃Token', '吃早餐', '吃午餐', '吃晚餐', '吃冰淇淋融化',
      '吃大闸蟹', '吃糖葫芦', '吃长寿面', '吃西瓜', '涮火锅',
    ],
  },
  {
    id: '时节',
    weight: 14,
    actions: [
      '被落叶淹没', '中秋赏月吃月饼', '堆雪人', '放烟花', '吃粽子', '吃年糕', '吃青团',
      '吃腊八粥', '吃重阳糕', '收红包', '写福字', '穿针乞巧', '舞狮头', '讨糖南瓜灯',
      '插茱萸赏菊', '放河灯', '萌化小幽灵', '装点圣诞树', '放孔明灯', '吃汤圆', '吃饺子',
    ],
  },
  {
    id: '文字',
    weight: 10,
    noMirror: true,
    actions: ['是啊，吃什么', '深度思考碎碎念'],
  },
]

/* 事件动画：与原始 config.jsonc 的 animations.events 一致（不进入随机链，仅在菜单点播/事件触发） */
const EVENTS = {
  balance: [
    '余额-钱袋满溢',
    '余额-金袋叮当',
    '余额-钱袋如常',
    '余额-数金皱眉',
    '余额-袋空如洗',
    '余额-分文不剩',
  ],
  whisper: ['碎碎念-擦桌碎碎念', '碎碎念-发呆碎碎念', '碎碎念-对屏碎碎念'],
}

/* 右键动作树分组：与原始 buildMenuTree 的结构一致 */
const MENU_GROUPS = [
  { label: '待机', items: [IDLE] },
  { label: '转向', items: [TURN] },
  { label: '拖拽', items: [DRAG] },
  { label: '点击回应', items: CLICKS },
  { label: '移动', items: MOVES.map((m) => m.name) },
  ...CATEGORIES.map((c) => ({ label: c.id, items: c.actions })),
  { label: '余额', items: EVENTS.balance },
  { label: '碎碎念', items: EVENTS.whisper },
]

/* 动画链顶层权重：原始默认 idle 10 / turn 5 / move 5 */
const WEIGHTS = { idle: 10, turn: 5, move: 5 }

const PET_W = 180 // 可视区域宽（容纳透明 WebM 中的人物主体）
const PET_H = 165 // 可视区域高
const MARGIN = 12
const BUBBLE_KEY = 'anime-calendar.mascot.bubble'
const FALLBACK_DURATION = 10.09 // 与原始 client 一致，加载前先按 10s 估算

// 随机闲聊文案（站点原有轻交互保留）
const LINES = ['你好呀～', '今天也要加油！', '呜…想摸鱼了', '外面在忙什么呢', '要不要陪我玩？']

const videoAEl = ref(null)
const videoBEl = ref(null)
const frontVideo = ref(0)
const state = ref('idle')
const animName = ref(IDLE)
const flipped = ref(false) // 朝右移动/站姿时水平翻转（素材默认朝左）
// 停靠角落：右下角（left = 视口宽 - 宠物宽 - 边距）
const HOME_X = () => Math.max(MARGIN, window.innerWidth - PET_W - MARGIN)
const posX = ref(HOME_X())
const dragging = ref(false)
const bubbleText = ref('')
const bubbleOn = ref(localStorage.getItem(BUBBLE_KEY) !== '0')
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const actionMenuOpen = ref(false)
const activeGroup = ref(-1)
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const actionMenuX = ref(0)
const actionMenuY = ref(0)
const submenuX = ref(0)
const submenuY = ref(0)
const actionMenuMaxHeight = computed(() => Math.max(0, Math.min(460, window.innerHeight - actionMenuY.value - 8)))
const submenuMaxHeight = computed(() => Math.max(0, Math.min(460, window.innerHeight - submenuY.value - 8)))

let bubbleTimer = null
let rafId = null
let movePlan = null
let dragStartX = 0
let dragBaseX = 0
let moved = false
let switchToken = 0

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const randomBetween = (min, max) => Math.floor(min + Math.random() * (max - min))

/* —— 播放底层（双缓冲：新视频加载完成后再淡入，避免切换闪白/黑） —— */
function videoByIndex(i) {
  return i === 0 ? videoAEl.value : videoBEl.value
}

function currentVideo() {
  return videoByIndex(frontVideo.value)
}

function samePath(video, path) {
  if (!video?.src) return false
  try {
    return new URL(video.src).pathname === new URL(path, window.location.origin).pathname
  } catch {
    return false
  }
}

function applySource(path, loopFlag) {
  const old = currentVideo()
  // 前台已经是同一段动画：如果播完/暂停就原地重播，不切缓冲
  if (old && samePath(old, path)) {
    old.loop = loopFlag
    if (old.ended || old.paused) {
      old.currentTime = 0
      old.play().catch(() => {})
    }
    return
  }

  const token = ++switchToken
  const next = videoByIndex(1 - frontVideo.value)
  if (!next) return

  next.loop = loopFlag
  next.src = path
  next.currentTime = 0
  next.classList.remove('is-front')
  next.load()

  const onReady = () => {
    next.removeEventListener('loadeddata', onReady)
    if (token !== switchToken) return // 已被更新的切换取代
    next.classList.add('is-front')
    if (old && old !== next) {
      old.classList.remove('is-front')
      old.pause() // 停掉旧视频，避免残留 ended 打断新动画
    }
    frontVideo.value = 1 - frontVideo.value
    next.play().catch(() => {})
  }
  next.addEventListener('loadeddata', onReady)
  if (next.readyState >= 2) onReady()
}

function switchAnim(name, kind) {
  stopMove()
  state.value = kind
  animName.value = name
  applySource(WEBM(name), false)
}

function playIdle() {
  switchAnim(IDLE, 'idle')
}

function playRandomClick() {
  switchAnim(pick(CLICKS), 'click')
}

function playDrag() {
  stopMove()
  state.value = 'drag'
  animName.value = DRAG
  applySource(WEBM(DRAG), true)
}

function playAction(name) {
  switchAnim(name, 'action')
}

function playRandomAction() {
  const name = pickCategoryAction()
  if (!name) {
    playIdle()
    return
  }
  playAction(name)
  if (Math.random() < 0.35) say(pick(LINES))
}

/* —— 分类动作选择（原始 pickers 的轻量版） —— */
function pickCategoryAction() {
  const cats = CATEGORIES.filter((c) => c.actions.length > 0)
  if (!cats.length) return null
  const filtered = cats.filter((c) => !(c.noMirror && flipped.value))
  const eligible = filtered.length ? filtered : cats
  const totalW = eligible.reduce((s, c) => s + c.weight, 0) || 1
  let t = Math.random() * totalW
  for (const c of eligible) {
    t -= c.weight
    if (t <= 0) return pick(c.actions)
  }
  return pick(eligible[eligible.length - 1].actions)
}

/* —— 动画链：播完按权重选下一个 —— */
function pickNext() {
  const w = WEIGHTS
  const roll = Math.random()
  const topEnd = (w.idle + w.turn + w.move) / 100
  if (roll < w.idle / 100) {
    playIdle()
    return
  }
  if (roll < (w.idle + w.turn) / 100) {
    switchAnim(TURN, 'turn')
    return
  }
  if (roll < topEnd) {
    if (tryMove()) return
    // 空间不足时回退到随机动作（与原始 pickNext 同语义）
  }
  playRandomAction()
}

function onVideoEnded(e) {
  const el = e?.currentTarget
  if (el && el !== currentVideo()) return // 只处理当前前台视频的 ended，避免后台残留事件打断动画
  if (state.value === 'drag') {
    if (dragging.value) return
    playIdle()
    return
  }
  if (state.value === 'click') {
    playIdle()
    return
  }
  if (state.value === 'event') {
    playIdle()
    return
  }
  stopMove()
  if (state.value === 'turn') flipped.value = !flipped.value
  pickNext()
}

/* —— 移动系统：lead/tail 时段不动，中间按视频进度位移 —— */
function tryMove(preferredName = null) {
  if (movePlan) return true
  const spec = preferredName ? MOVES.find((m) => m.name === preferredName) : null
  if (preferredName && !spec) return false
  const chosen = spec || pick(MOVES)
  const params = Object.assign({}, MOVE_DEFAULT, chosen.params || {})
  const dir = flipped.value ? 1 : -1
  const dist = randomBetween(params.minDist, params.maxDist)
  const center = posX.value + PET_W / 2
  const targetCenter = center + dir * dist
  const halfW = PET_W / 2
  const leftBound = MARGIN + halfW
  const rightBound = window.innerWidth - MARGIN - halfW
  if (targetCenter < leftBound || targetCenter > rightBound) return false

  // 注意：不能拿 currentVideo()（还是被替换掉的旧动画）的时长/进度当时间轴——
  // 跑步素材要等 applySource 双缓冲切换后才在前台开播。位移统一由 moveTick 在
  // 跑步素材真正开播后按它自己的 currentTime/duration 驱动（见下）。
  movePlan = {
    startLeft: posX.value,
    targetLeft: clamp(targetCenter - halfW, MARGIN, window.innerWidth - PET_W - MARGIN),
    dir,
    leadSec: params.leadSec,
    tailSec: params.tailSec,
    path: WEBM(chosen.name),
    duration: 0, // 延迟到素材实际开播时按其真实时长解析
  }
  state.value = 'move'
  animName.value = chosen.name
  applySource(movePlan.path, false)
  rafId = requestAnimationFrame(moveTick)
  return true
}

/* 位移驱动：只认跑步素材自己的时间轴。
   素材还没切到前台开播（旧动画在播/新素材缓冲中）→ 停在起点继续等；
   一旦跑步素材在前台播放，lead 段原地起跑、travel 段匀速位移、tail 段到达终点原地跑。 */
function moveTick() {
  if (!movePlan) {
    rafId = null
    return
  }
  const video = currentVideo()
  let d = movePlan.duration && movePlan.duration > 0 ? movePlan.duration : FALLBACK_DURATION
  let t = 0
  if (video && samePath(video, movePlan.path)) {
    // 前台已切到跑步素材：以它自己的实时进度/真实时长为准
    // （不做 paused/ended 门槛——暂停也只是停在原进度，用它反而避免瞬移回起点）
    if (Number.isFinite(video.duration) && video.duration > 0) d = video.duration
    movePlan.duration = d
    t = video.currentTime
  }
  // 前台还是被替换掉的旧动画（新素材缓冲中）→ t 保持 0，原地停在起点等待开播
  const lead = movePlan.leadSec
  const tail = movePlan.tailSec
  if (t <= lead) {
    posX.value = movePlan.startLeft
  } else if (t >= d - tail) {
    posX.value = movePlan.targetLeft
    rafId = null
    return // 尾部原地跑，等视频自然 ended 由 onVideoEnded 接续
  } else {
    const travelWindow = Math.max(0.1, d - lead - tail)
    const ratio = (t - lead) / travelWindow
    posX.value = movePlan.startLeft + (movePlan.targetLeft - movePlan.startLeft) * ratio
  }
  rafId = requestAnimationFrame(moveTick)
}

function stopMove() {
  movePlan = null
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
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

/* —— 左键互动 & 拖动 —— */
function onPointerDown(e) {
  if (e.button !== 0) return
  e.preventDefault()
  closeMenu()
  dragStartX = e.clientX
  dragBaseX = posX.value
  moved = false
  dragging.value = true
  playDrag()
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
    playRandomClick()
    const texts = ['嘿嘿～', '干嘛呀！', '好开心～']
    say(pick(texts))
  } else {
    playIdle()
  }
}

/* —— 右键菜单 —— */
function onContextMenu(e) {
  const W = 190
  const H = 220
  menuX.value = clamp(e.clientX, 8, window.innerWidth - W - 8)
  menuY.value = clamp(e.clientY, 8, window.innerHeight - H - 8)
  menuOpen.value = true
  actionMenuOpen.value = false
  activeGroup.value = -1
}

function closeMenu() {
  menuOpen.value = false
  actionMenuOpen.value = false
  activeGroup.value = -1
}

function toggleActionMenu(e) {
  actionMenuOpen.value = !actionMenuOpen.value
  activeGroup.value = -1
  if (actionMenuOpen.value && e?.currentTarget) {
    const rect = e.currentTarget.getBoundingClientRect()
    const menuH = MENU_GROUPS.length * 30 + 8
    const menuW = 210
    const rightX = rect.right + 4
    actionMenuX.value = rightX + menuW <= window.innerWidth ? rightX : Math.max(8, rect.left - menuW - 4)
    actionMenuY.value = clamp(rect.top - 4, 8, Math.max(8, window.innerHeight - menuH - 8))
  }
}

function setActiveGroup(i, e) {
  activeGroup.value = i
  const el = e?.currentTarget
  if (!el) return
  const rect = el.getBoundingClientRect()
  const itemCount = MENU_GROUPS[i]?.items.length || 1
  // 估算子菜单高度，避免靠近屏幕底部时被截断
  const estimatedH = Math.min(itemCount, 16) * 28 + 14
  const rightX = rect.right + 4
  submenuX.value = rightX + 260 <= window.innerWidth ? rightX : Math.max(8, actionMenuX.value - 266)
  submenuY.value = clamp(rect.top - 4, 8, Math.max(8, window.innerHeight - estimatedH - 8))
}

function isNoMirrorAnimation(name) {
  return CATEGORIES.some((c) => c.noMirror === true && c.actions.includes(name))
}

function stateForMenu(name) {
  if (name === IDLE) return 'idle'
  if (name === TURN) return 'turn'
  if (name === DRAG) return 'drag'
  if (CLICKS.includes(name)) return 'click'
  if (MOVES.some((m) => m.name === name)) return 'move'
  if (EVENTS.balance.includes(name) || EVENTS.whisper.includes(name)) return 'event'
  return 'action'
}

function playMenuAnimation(name) {
  if (isNoMirrorAnimation(name) && flipped.value) flipped.value = false
  if (MOVES.some((m) => m.name === name)) {
    if (tryMove(name) === false) switchAnim(name, 'move')
  } else {
    switchAnim(name, stateForMenu(name))
  }
  closeMenu()
}

function menuAction(type, e) {
  switch (type) {
    case 'actions':
      toggleActionMenu(e)
      break
    case 'play':
      closeMenu()
      playRandomAction()
      break
    case 'home':
      closeMenu()
      goHome()
      break
    case 'bubble':
      closeMenu()
      toggleBubble()
      break
    case 'hide':
      closeMenu()
      hide()
      break
  }
}

function goHome() {
  stopMove()
  posX.value = HOME_X()
  flipped.value = false
  playIdle()
  say('回到角落～')
}

function hide() {
  emit('hide')
}

function show() {
  // 保留给父组件可能的“再次显示”逻辑
  playIdle()
}

defineExpose({ show })

function onWinPointerDown(e) {
  if (menuOpen.value && !(e.target instanceof Element && e.target.closest('.mascot-menu'))) closeMenu()
}

function onWinKey(e) {
  if (e.key === 'Escape') closeMenu()
}

// 首帧动画的延迟启动句柄（见 onMounted 注释）
let idleTimer = null
let idleHandle = null

onMounted(() => {
  // 首帧动画推迟到浏览器空闲时再拉取：桌宠动画单个 WebM 最大约 1.3MB，
  // 立刻加载会与壁纸 / 页面资源抢带宽。视频是 preload="none"，这里才是它真正开始下载的时机。
  const start = () => {
    idleTimer = null
    idleHandle = null
    playIdle()
  }
  if (typeof requestIdleCallback === 'function') {
    // timeout 兜底：空闲迟迟不来也要在 2.5s 内开始，避免桌宠一直空白
    idleHandle = requestIdleCallback(start, { timeout: 2500 })
  } else {
    idleTimer = setTimeout(start, 600)
  }
  window.addEventListener('pointerdown', onWinPointerDown)
  window.addEventListener('keydown', onWinKey)
})

onUnmounted(() => {
  clearTimeout(bubbleTimer)
  clearTimeout(idleTimer)
  if (idleHandle != null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle)
  stopMove()
  window.removeEventListener('pointerdown', onWinPointerDown)
  window.removeEventListener('keydown', onWinKey)
})
</script>

<template>
  <div
    class="mascot"
    :class="{ dragging }"
    :style="{ left: posX + 'px', width: PET_W + 'px', height: PET_H + 'px' }"
    title="蓝毛小女仆 · 左键互动 / 拖动，右键菜单"
    @pointerdown="onPointerDown"
    @contextmenu.prevent="onContextMenu"
  >
    <div class="pet-stage" :class="{ flip: flipped }">
      <video
        ref="videoAEl"
        class="video-layer"
        :class="{ 'is-front': frontVideo === 0 }"
        muted
        playsinline
        autoplay
        preload="none"
        aria-hidden="true"
        @ended="onVideoEnded"
      ></video>
      <video
        ref="videoBEl"
        class="video-layer"
        :class="{ 'is-front': frontVideo === 1 }"
        muted
        playsinline
        autoplay
        preload="none"
        aria-hidden="true"
        @ended="onVideoEnded"
      ></video>
    </div>
    <div v-if="bubbleOn && bubbleText" class="mascot-bubble">{{ bubbleText }}</div>
  </div>

  <!-- 右键菜单 -->
  <div v-if="menuOpen" class="mascot-menu mascot-root-menu" :style="{ left: menuX + 'px', top: menuY + 'px' }">
    <button type="button" @click="menuAction('actions', $event)">
      <AppIcon name="menu" :size="14" /> 动作分类
      <span class="menu-arrow">›</span>
    </button>
    <button type="button" @click="menuAction('play')"><AppIcon name="sparkles" :size="14" /> 随机逗一逗</button>
    <button type="button" @click="menuAction('home')"><AppIcon name="house" :size="14" /> 回到角落</button>
    <button type="button" @click="menuAction('bubble')"><AppIcon name="message" :size="14" /> 状态气泡：{{ bubbleOn ? '开' : '关' }}</button>
    <button type="button" @click="menuAction('hide')"><AppIcon name="eye-off" :size="14" /> 隐藏（本次会话）</button>
  </div>

  <!-- 动作分类面板 -->
  <div
    v-if="menuOpen && actionMenuOpen"
    class="mascot-menu mascot-action-menu"
    :style="{ left: actionMenuX + 'px', top: actionMenuY + 'px', maxHeight: actionMenuMaxHeight + 'px' }"
  >
    <button
      v-for="(group, i) in MENU_GROUPS"
      :key="group.label"
      type="button"
      :class="{ active: activeGroup === i }"
      @mouseenter="setActiveGroup(i, $event)"
    >
      <span>{{ group.label }}</span>
      <span class="menu-arrow">›</span>
    </button>
  </div>

  <!-- 动作分类下的具体动画 -->
  <div
    v-if="menuOpen && actionMenuOpen && activeGroup >= 0"
    class="mascot-menu mascot-submenu"
    :style="{ left: submenuX + 'px', top: submenuY + 'px', maxHeight: submenuMaxHeight + 'px' }"
  >
    <button v-for="name in MENU_GROUPS[activeGroup].items" :key="name" type="button" @click="playMenuAnimation(name)">
      {{ name }}
    </button>
  </div>
</template>

<style scoped>
.mascot {
  position: fixed;
  left: 12px;
  bottom: 2px; /* 贴底：右下角（停靠点由 posX 控制，初始为右下角） */
  z-index: 55; /* 低于登录弹窗(100) */
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  pointer-events: auto;
}

.mascot.dragging {
  cursor: grabbing;
}

/* 视频画布为 640×360；此舞台只显示人物主体所在的中部区域。
   人物脚底约在素材 y=330，因此视频下移 12px 让脚踩在舞台底部。 */
.pet-stage {
  position: absolute;
  left: 50%;
  bottom: -12px;
  width: 330px;
  height: 186px;
  margin-left: -165px;
  pointer-events: none;
}

.pet-stage.flip {
  transform: scaleX(-1);
}

.pet-stage video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.pet-stage video.is-front {
  opacity: 1;
}

/* 状态气泡 */
.mascot-bubble {
  position: absolute;
  bottom: calc(100% + 8px);
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
  min-width: 170px;
  max-width: 260px;
}

.mascot-action-menu,
.mascot-submenu {
  max-height: min(62vh, 460px);
  overflow-y: auto;
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
  width: 100%;
}

.mascot-menu button .menu-arrow {
  margin-left: auto;
  color: var(--text-2, #9aa0a6);
  font-size: 14px;
}

.mascot-menu button.active,
.mascot-menu button:hover {
  background: var(--panel-2);
  color: var(--accent);
}
</style>
