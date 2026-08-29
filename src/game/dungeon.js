// 纯前端 Canvas 地牢射击游戏引擎
// 玩法参考“挺进地牢”：俯视角房间制地牢、鼠标瞄准 + 左键射击、
// WASD/方向键移动、空格/Shift 翻滚闪避、E 互动、随机枪械与道具、
// 清空房间解锁门、每层 Boss 镇守、通关后进入下一层。
// 怪物/墙壁/道具/Boss 全部使用 Canvas 矢量图形渲染，无外部美术依赖。

export const GUNS = [
  { id: 'pistol', name: '基础手枪', dmg: 3, fireRate: 6, speed: 620, spread: 0.04, count: 1, ammo: Infinity, maxAmmo: 0, color: '#cbd5e1', bulletR: 5, pierce: 0, splash: 0, burst: 1, burstDelay: 0, desc: '无限弹药，稳定可靠' },
  { id: 'shotgun', name: '霰弹枪', dmg: 6, fireRate: 1.8, speed: 540, spread: 0.4, count: 5, ammo: 24, maxAmmo: 24, color: '#f59e0b', bulletR: 5, pierce: 0, splash: 0, burst: 1, burstDelay: 0, desc: '近距离喷出一片弹丸' },
  { id: 'machinegun', name: '冲锋枪', dmg: 2.2, fireRate: 9.5, speed: 690, spread: 0.13, count: 1, ammo: 90, maxAmmo: 90, color: '#fbbf24', bulletR: 4, pierce: 0, splash: 0, burst: 1, burstDelay: 0, desc: '高射速，弹幕倾泻' },
  { id: 'burst', name: '爆裂步枪', dmg: 4, fireRate: 2.8, speed: 760, spread: 0.05, count: 1, ammo: 42, maxAmmo: 42, color: '#22d3ee', bulletR: 5, pierce: 1, splash: 0, burst: 3, burstDelay: 0.06, desc: '三连发，可穿透一个敌人' },
  { id: 'laser', name: '激光枪', dmg: 3, fireRate: 7, speed: 1100, spread: 0, count: 1, ammo: 36, maxAmmo: 36, color: '#a5f3fc', bulletR: 3, pierce: 4, splash: 0, burst: 1, burstDelay: 0, desc: '高速贯穿光束' },
  { id: 'rocket', name: '火箭筒', dmg: 18, fireRate: 1.3, speed: 420, spread: 0.03, count: 1, ammo: 8, maxAmmo: 8, color: '#fb7185', bulletR: 9, pierce: 0, splash: 62, burst: 1, burstDelay: 0, desc: '爆炸范围伤害，注意走位' },
]

export const FLOORS = [
  { id: 'forest', name: '森林地牢', floor: 1, wall: '#4d6b3f', wallHi: '#6f8f5b', floorA: '#3f7d3a', floorB: '#3a7436', accent: '#4ade80', enemyColor: '#4ade80', bossName: '巨木守卫', bossColor: '#22c55e' },
  { id: 'snow', name: '雪山地牢', floor: 2, wall: '#7d94b0', wallHi: '#a8bcd4', floorA: '#b8c4d8', floorB: '#aebbd0', accent: '#93c5fd', enemyColor: '#93c5fd', bossName: '冰霜暴君', bossColor: '#60a5fa' },
  { id: 'tower', name: '魔塔地牢', floor: 3, wall: '#5b3b78', wallHi: '#7c55a0', floorA: '#3a3348', floorB: '#352f42', accent: '#f87171', enemyColor: '#f87171', bossName: '魔塔典狱长', bossColor: '#ef4444' },
  { id: 'abyss', name: '深渊地牢', floor: 4, wall: '#37335a', wallHi: '#4f4a7d', floorA: '#1c1e33', floorB: '#191b2e', accent: '#c084fc', enemyColor: '#c084fc', bossName: '深渊之主', bossColor: '#a855f7' },
]

export const PASSIVES = [
  { id: 'maxhp', name: '心之容器', icon: 'heart', desc: '最大生命 +1 并恢复 1 颗心', apply: (p) => { p.maxHp += 1; p.hp = Math.min(p.maxHp, p.hp + 1) } },
  { id: 'dmg', name: '力量子弹', icon: 'sword', desc: '所有枪械伤害 +1', apply: (p) => { p.dmgBonus += 1 } },
  { id: 'speed', name: '疾走靴', icon: 'wind', desc: '移动速度 +10%', apply: (p) => { p.speedBonus += 0.1 } },
  { id: 'blank', name: '空白卷轴', icon: 'zap', desc: '空白 +2', apply: (p) => { p.blanks += 2 } },
  { id: 'ammo', name: '弹药背包', icon: 'box', desc: '所有枪械补满弹药', apply: (p, g) => { g.forEach((gun) => { if (!Number.isFinite(gun.ammo)) gun.ammo = Infinity; else gun.ammo = gun.maxAmmo }) } },
  { id: 'luck', name: '幸运四叶草', icon: 'star', desc: '掉落率小幅提升', apply: (p) => { p.luck += 0.08 } },
]

const TILE = 40
const ROOM_W = 960
const ROOM_H = 640
const COLS = 4
const ROWS = 4
const TOTAL_ROOMS = COLS * ROWS

const rand = (a, b) => a + Math.random() * (b - a)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shadeColor(hex, f) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f))
  const b = Math.min(255, Math.round((n & 255) * f))
  return `rgb(${r},${g},${b})`
}

// ---------------- 地牢生成 ----------------
function createFloor(floorIndex, seed) {
  const rng = mulberry32((seed ^ (floorIndex * 1000003)) >>> 0)
  const rooms = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const index = r * COLS + c
      rooms.push({
        index,
        col: c,
        row: r,
        x: c * ROOM_W,
        y: r * ROOM_H,
        w: ROOM_W,
        h: ROOM_H,
        type: 'normal',
        doors: { top: false, right: false, bottom: false, left: false },
        tiles: null,
        enemyDefs: [],
        enemies: [],
        boss: null,
        pickups: [],
        chests: [],
        shopItems: [],
        portal: null,
        cleared: false,
        visited: false,
        active: false,
        decor: [],
      })
    }
  }

  // 生成连通迷宫：随机生成树 + 少量回廊
  const connected = new Set([0])
  while (connected.size < TOTAL_ROOMS) {
    const fromArr = Array.from(connected)
    const from = fromArr[Math.floor(rng() * fromArr.length)]
    const nbs = neighbors(from).filter((n) => !connected.has(n))
    if (!nbs.length) continue
    const to = nbs[Math.floor(rng() * nbs.length)]
    addEdge(rooms, from, to)
    connected.add(to)
  }
  for (let i = 0; i < TOTAL_ROOMS; i++) {
    for (const j of neighbors(i)) {
      if (j > i && !hasEdge(rooms[i], rooms[j]) && rng() < 0.28) addEdge(rooms, i, j)
    }
  }

  const startIndex = 0
  const bossIndex = TOTAL_ROOMS - 1
  rooms[startIndex].type = 'start'
  rooms[bossIndex].type = 'boss'

  // 随机放置商店和宝库
  const candidates = rooms.filter((r) => r.type === 'normal')
  const shuffled = candidates.slice().sort(() => rng() - 0.5)
  if (shuffled.length >= 2) {
    shuffled[0].type = 'shop'
    shuffled[1].type = 'treasure'
  }

  for (const room of rooms) {
    buildRoom(room, floorIndex, rng)
  }
  return rooms
}

function neighbors(index) {
  const r = Math.floor(index / COLS)
  const c = index % COLS
  const out = []
  if (r > 0) out.push(index - COLS)
  if (r < ROWS - 1) out.push(index + COLS)
  if (c > 0) out.push(index - 1)
  if (c < COLS - 1) out.push(index + 1)
  return out
}

function addEdge(rooms, a, b) {
  const ra = rooms[a]
  const rb = rooms[b]
  if (rb.col === ra.col + 1) { ra.doors.right = true; rb.doors.left = true }
  else if (rb.col === ra.col - 1) { ra.doors.left = true; rb.doors.right = true }
  else if (rb.row === ra.row + 1) { ra.doors.bottom = true; rb.doors.top = true }
  else if (rb.row === ra.row - 1) { ra.doors.top = true; rb.doors.bottom = true }
}

function hasEdge(a, b) {
  return a.doors.right && b.doors.left || a.doors.left && b.doors.right || a.doors.bottom && b.doors.top || a.doors.top && b.doors.bottom
}

function buildRoom(room, floorIndex, rng) {
  const tw = ROOM_W / TILE
  const th = ROOM_H / TILE
  const grid = Array.from({ length: th }, () => Array(tw).fill(0))
  // 外圈墙
  for (let x = 0; x < tw; x++) {
    grid[0][x] = 1
    grid[th - 1][x] = 1
  }
  for (let y = 0; y < th; y++) {
    grid[y][0] = 1
    grid[y][tw - 1] = 1
  }

  // 开门洞
  const doorX = Math.floor(tw / 2)
  const doorY = Math.floor(th / 2)
  if (room.doors.top) { grid[0][doorX - 1] = 0; grid[0][doorX] = 0 }
  if (room.doors.bottom) { grid[th - 1][doorX - 1] = 0; grid[th - 1][doorX] = 0 }
  if (room.doors.left) { grid[doorY - 1][0] = 0; grid[doorY][0] = 0 }
  if (room.doors.right) { grid[doorY - 1][tw - 1] = 0; grid[doorY][tw - 1] = 0 }

  // 障碍物
  let obstacleCount = 0
  if (room.type === 'normal') obstacleCount = 4 + Math.floor(rng() * 4) + floorIndex
  else if (room.type === 'treasure') obstacleCount = 2
  else if (room.type === 'shop') obstacleCount = 4
  else if (room.type === 'boss') obstacleCount = 1 + Math.floor(rng() * 2)
  for (let i = 0; i < obstacleCount; i++) {
    const x = 2 + Math.floor(rng() * (tw - 4))
    const y = 2 + Math.floor(rng() * (th - 4))
    // 不要堵死门口和出生点附近
    if (Math.abs(x - doorX) < 2 && (y <= 2 || y >= th - 3)) continue
    if (Math.abs(y - doorY) < 2 && (x <= 2 || x >= tw - 3)) continue
    if (Math.abs(x - doorX) < 3 && Math.abs(y - doorY) < 3) continue
    grid[y][x] = 2
    if (rng() < 0.3 && x + 1 < tw - 1 && grid[y][x + 1] === 0) grid[y][x + 1] = 2
  }

  room.tiles = grid
  room.decor = generateDecor(room, floorIndex, rng)

  // 敌人生成点
  if (room.type === 'normal') {
    const count = 4 + Math.floor(rng() * 2) + floorIndex
    room.enemyDefs = generateSpawns(room, count, rng).map((p) => ({
      type: rollEnemyType(rng, floorIndex),
      x: p.x,
      y: p.y,
    }))
  } else if (room.type === 'treasure') {
    const pts = generateSpawns(room, 2, rng)
    room.chests.push({
      x: room.x + ROOM_W / 2,
      y: room.y + ROOM_H / 2,
      locked: false,
      opened: false,
      quality: rng() < 0.5 ? 'rare' : 'epic',
    })
    room.enemyDefs = pts.map((p) => ({ type: 'kin', x: p.x, y: p.y }))
  } else if (room.type === 'shop') {
    const cx = room.x + ROOM_W / 2
    const cy = room.y + ROOM_H / 2
    room.shopItems = [
      makeShopItem(cx - 110, cy + 40, 'gun', rng),
      makeShopItem(cx, cy + 40, 'passive', rng),
      makeShopItem(cx + 110, cy + 40, 'consumable', rng),
    ]
  } else if (room.type === 'boss') {
    room.boss = null
  }
}

function generateSpawns(room, count, rng) {
  const pts = []
  const cx = room.x + ROOM_W / 2
  const cy = room.y + ROOM_H / 2
  let guard = 0
  while (pts.length < count && guard++ < 500) {
    const x = room.x + TILE * (2 + rng() * (ROOM_W / TILE - 4))
    const y = room.y + TILE * (2 + rng() * (ROOM_H / TILE - 4))
    if (dist2(x, y, cx, cy) < 120 * 120) continue
    if (solidAt(room, x, y)) continue
    pts.push({ x, y })
  }
  return pts
}

function solidAt(room, x, y) {
  const tx = Math.floor((x - room.x) / TILE)
  const ty = Math.floor((y - room.y) / TILE)
  if (tx < 0 || ty < 0 || tx >= ROOM_W / TILE || ty >= ROOM_H / TILE) return true
  const v = room.tiles[ty]?.[tx]
  return v === 1 || v === 2
}

function rollEnemyType(rng, floorIndex) {
  const table = [
    ['kin', 'kin', 'rat', 'shotgunner'],
    ['kin', 'rat', 'shotgunner', 'wizard'],
    ['kin', 'shotgunner', 'wizard', 'brute'],
    ['shotgunner', 'wizard', 'brute', 'turret'],
  ][Math.min(floorIndex, 3)]
  return table[Math.floor(rng() * table.length)]
}

function generateDecor(room, floorIndex, rng) {
  const deco = []
  const floor = FLOORS[floorIndex]
  const n = 8 + Math.floor(rng() * 8)
  for (let i = 0; i < n; i++) {
    const x = room.x + TILE * (2 + rng() * (ROOM_W / TILE - 4))
    const y = room.y + TILE * (2 + rng() * (ROOM_H / TILE - 4))
    if (solidAt(room, x, y)) continue
    if (dist2(x, y, room.x + ROOM_W / 2, room.y + ROOM_H / 2) < 70 * 70) continue
    deco.push({
      x,
      y,
      kind: pickDecoKind(floor.id, rng),
      scale: rand(0.7, 1.3),
      floorId: floor.id,
      color: floor.accent,
    })
  }
  return deco
}

function pickDecoKind(zone, rng) {
  const table = {
    forest: ['tree', 'bush', 'flower', 'rock', 'mushroom'],
    snow: ['pine', 'mound', 'ice', 'rock'],
    tower: ['pillar', 'torch', 'crystal', 'rock'],
    abyss: ['spike', 'crystal', 'monument', 'rock'],
  }
  const arr = table[zone] || table.forest
  return arr[Math.floor(rng() * arr.length)]
}

function makeShopItem(x, y, kind, rng) {
  if (kind === 'gun') {
    const gun = GUNS.filter((g) => g.id !== 'pistol')
    const g = gun[Math.floor(rng() * gun.length)]
    return { x, y, kind: 'gun', id: g.id, name: g.name, price: 20 + Math.floor(rng() * 4) * 5, desc: g.desc }
  }
  if (kind === 'passive') {
    const p = PASSIVES[Math.floor(rng() * PASSIVES.length)]
    return { x, y, kind: 'passive', id: p.id, name: p.name, price: 25 + Math.floor(rng() * 3) * 5, desc: p.desc }
  }
  const consumables = [
    { kind: 'heart', name: '生命药水', price: 15, desc: '恢复 2 颗心' },
    { kind: 'key', name: '黄铜钥匙', price: 20, desc: '钥匙 +1' },
    { kind: 'blank', name: '空白卷轴', price: 12, desc: '空白 +1' },
    { kind: 'ammo', name: '弹药补给', price: 18, desc: '所有枪械补满弹药' },
  ]
  const c = consumables[Math.floor(rng() * consumables.length)]
  return { x, y, kind: 'consumable', id: c.kind, name: c.name, price: c.price, desc: c.desc }
}

function neighborRoom(rooms, room, side) {
  let c = room.col
  let r = room.row
  if (side === 'top') r--
  else if (side === 'bottom') r++
  else if (side === 'left') c--
  else if (side === 'right') c++
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null
  return rooms[r * COLS + c]
}

function doorInfo(room, side) {
  const cx = room.x + ROOM_W / 2
  const cy = room.y + ROOM_H / 2
  if (side === 'top') return { x: cx, y: room.y, side: 'top', nx: room.col, ny: room.row - 1, enterSide: 'bottom', px: cx, py: room.y + 44 }
  if (side === 'bottom') return { x: cx, y: room.y + ROOM_H, side: 'bottom', nx: room.col, ny: room.row + 1, enterSide: 'top', px: cx, py: room.y + ROOM_H - 44 }
  if (side === 'left') return { x: room.x, y: cy, side: 'left', nx: room.col - 1, ny: room.row, enterSide: 'right', px: room.x + 44, py: cy }
  return { x: room.x + ROOM_W, y: cy, side: 'right', nx: room.col + 1, ny: room.row, enterSide: 'left', px: room.x + ROOM_W - 44, py: cy }
}

function makeEnemy(type, x, y, floorIndex) {
  const floor = FLOORS[floorIndex]
  const hpScale = 1 + floorIndex * 0.5
  const dmg = 1 + Math.floor(floorIndex / 2)
  const base = {
    x,
    y,
    type,
    r: 14,
    hp: 8 * hpScale,
    maxHp: 8 * hpScale,
    speed: 70,
    dmg,
    color: floor.enemyColor,
    hitT: 0,
    shootT: rand(0.6, 1.8),
    shootCd: 1.6,
    t: rand(0, 6),
  }
  switch (type) {
    case 'kin':
      return { ...base, r: 14, hp: 8 * hpScale, maxHp: 8 * hpScale, speed: 78, dmg, shootCd: 1.8 }
    case 'rat':
      return { ...base, r: 11, hp: 5 * hpScale, maxHp: 5 * hpScale, speed: 135, dmg, shootCd: 99, shootT: 99 }
    case 'shotgunner':
      return { ...base, r: 16, hp: 13 * hpScale, maxHp: 13 * hpScale, speed: 55, dmg: dmg + 0.5, shootCd: 2.4, shootT: rand(0.8, 2) }
    case 'wizard':
      return { ...base, r: 15, hp: 11 * hpScale, maxHp: 11 * hpScale, speed: 62, dmg: dmg + 0.5, shootCd: 2.0, shootT: rand(0.5, 1.6) }
    case 'brute':
      return { ...base, r: 22, hp: 28 * hpScale, maxHp: 28 * hpScale, speed: 44, dmg: dmg + 1, shootCd: 99, shootT: 99 }
    case 'turret':
      return { ...base, r: 16, hp: 20 * hpScale, maxHp: 20 * hpScale, speed: 0, dmg: dmg + 1, shootCd: 1.3, shootT: rand(0.5, 1.2) }
    default:
      return base
  }
}

function makeBoss(floorIndex) {
  const floor = FLOORS[floorIndex]
  const hp = 160 + floorIndex * 120
  return {
    x: 0,
    y: 0,
    type: 'boss',
    r: 34,
    hp,
    maxHp: hp,
    speed: 52 + floorIndex * 4,
    dmg: 2,
    color: floor.bossColor,
    hitT: 0,
    shootT: 1.2,
    shootCd: 2.0,
    t: 0,
    pattern: 1,
  }
}

// ---------------- 游戏主类 ----------------
export class DungeonGame {
  constructor(canvas, cb = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.cb = cb
    this.state = 'ready'
    this.gameSpeed = clamp(Number(cb.spawnRate) || 1, 0.5, 2)
    this.keys = new Set()
    this.shootT = 0
    this.burstRemaining = 0
    this.burstT = 0
    this.banner = null

    this.seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
    this.floorIndex = 0
    this.rooms = []
    this.currentRoom = null

    this.player = this.makePlayer()
    this.guns = [JSON.parse(JSON.stringify(GUNS[0]))]
    this.gunIndex = 0

    this.enemyBullets = []
    this.bullets = []
    this.particles = []
    this.floaters = []

    this.time = 0
    this.kills = 0
    this.roomsCleared = 0
    this.score = 0
    this.shake = 0
    this.transition = 0
    this.enterT = 0
    this.interactPressed = false
    this.rollKey = false
    this.blankPressed = false
    this.mouse = { x: 0, y: 0, down: false, inside: false }

    this.pImg = typeof Image !== 'undefined' ? new Image() : null
    if (this.pImg) this.pImg.src = '/pet/idle_front/idle_front_238.png'
    this.petWalk = []
    if (typeof Image !== 'undefined') {
      for (let i = 0; i < 4; i++) {
        const img = new Image()
        img.src = `/pet/walk_side/walk_side_238_0${i}.png`
        this.petWalk.push(img)
      }
    }

    this.view = { w: 0, h: 0 }
    this.camX = 0
    this.camY = 0

    this.onKeyDown = this.onKeyDown.bind(this)
    this.onKeyUp = this.onKeyUp.bind(this)
    this.onMouseMove = this.onMouseMove.bind(this)
    this.onMouseDown = this.onMouseDown.bind(this)
    this.onMouseUp = this.onMouseUp.bind(this)
    this.onBlur = this.onBlur.bind(this)

    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('blur', this.onBlur)
    canvas.addEventListener('contextmenu', this.onContextMenu = (e) => e.preventDefault())

    this.resize()
    window.addEventListener('resize', this.resize)
  }

  makePlayer() {
    return {
      x: ROOM_W / 2,
      y: ROOM_H / 2,
      r: 18,
      speed: 225,
      speedBonus: 0,
      dmgBonus: 0,
      luck: 0,
      hp: 6,
      maxHp: 6,
      blanks: 2,
      keys: 1,
      money: 0,
      iframes: 0,
      rollT: 0,
      rollCd: 0,
      rollDirX: 1,
      rollDirY: 0,
      dir: 1,
      face: 'down',
      moving: false,
      attackT: 0,
      img: this.pImg,
    }
  }

  resize = () => {
    this.view.w = this.canvas.clientWidth || window.innerWidth
    this.view.h = this.canvas.clientHeight || window.innerHeight - 48
    const dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.round(this.view.w * dpr)
    this.canvas.height = Math.round(this.view.h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  start() {
    if (!this.rooms.length) {
      this.rooms = createFloor(this.floorIndex, this.seed)
      this.currentRoom = this.rooms[0]
      this.enterRoom(this.currentRoom, null, true)
    }
    this.state = 'running'
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('resize', this.resize)
    if (this.onContextMenu) this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.canvas.style.cursor = ''
  }

  pause(paused) {
    if (paused && this.state === 'running') {
      this.state = 'paused'
      this.cb.onPause?.(true)
    } else if (!paused && this.state === 'paused') {
      this.state = 'running'
      this.last = performance.now()
      this.cb.onPause?.(false)
    }
  }

  setSpawnRate(rate) {
    this.gameSpeed = clamp(Number(rate) || 1, 0.5, 2)
  }

  onKeyDown(e) {
    const k = e.key.toLowerCase()
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
    if (k === ' ' || k === 'shift') {
      this.rollKey = true
      return
    }
    if (k === 'escape' || k === 'p') {
      if (this.state === 'running') this.pause(true)
      else if (this.state === 'paused') this.pause(false)
      return
    }
    if (k === 'e') {
      this.interactPressed = true
      return
    }
    if (k === 'f') {
      this.blankPressed = true
      return
    }
    if (k === 'q') {
      this.cycleGun(-1)
      return
    }
    if (k === 'r' || k === 'e') return
    if (k >= '1' && k <= '9') {
      const idx = Number(k) - 1
      if (idx < this.guns.length) this.gunIndex = idx
      return
    }
    this.keys.add(k)
  }

  onKeyUp(e) {
    const k = e.key.toLowerCase()
    if (k === ' ' || k === 'shift') this.rollKey = false
    else this.keys.delete(k)
  }

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect()
    this.mouse.x = e.clientX - rect.left
    this.mouse.y = e.clientY - rect.top
    this.mouse.inside = true
  }

  onMouseDown(e) {
    if (e.button === 0) this.mouse.down = true
  }

  onMouseUp(e) {
    if (e.button === 0) this.mouse.down = false
  }

  onBlur() {
    this.mouse.down = false
    this.keys.clear()
    this.rollKey = false
    this.blankPressed = false
  }

  cycleGun(delta) {
    if (this.guns.length < 2) return
    this.gunIndex = (this.gunIndex + delta + this.guns.length) % this.guns.length
  }

  currentGun() {
    return this.guns[this.gunIndex]
  }

  /* ---------- 流程 ---------- */
  enterRoom(room, side, initial = false) {
    if (this.currentRoom && this.currentRoom !== room) {
      this.currentRoom.active = false
    }
    this.currentRoom = room
    room.active = true
    if (!room.visited) {
      room.visited = true
      this.activateRoom(room)
    }
    const d = side ? doorInfo(room, this.oppositeSide(side)) : null
    if (initial) {
      this.player.x = room.x + ROOM_W / 2
      this.player.y = room.y + ROOM_H / 2
    } else if (d) {
      this.player.x = d.px
      this.player.y = d.py
    }
    this.transition = 1
    this.enterT = 0.35
    this.enemyBullets = []
    this.bullets = []
  }

  oppositeSide(side) {
    return side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left'
  }

  activateRoom(room) {
    if (room.type === 'boss' && !room.boss && !room.cleared) {
      const b = makeBoss(this.floorIndex)
      b.x = room.x + ROOM_W / 2
      b.y = room.y + ROOM_H / 2 - 40
      room.boss = b
      return
    }
    if (!room.cleared && room.enemyDefs.length && !room.enemies.length) {
      room.enemies = room.enemyDefs.map((d) => makeEnemy(d.type, d.x, d.y, this.floorIndex))
    }
  }

  isRoomLocked(room) {
    if (room.cleared) return false
    if (room.boss) return true
    return room.enemies.length > 0 || (room.visited && room.enemyDefs.length > 0)
  }

  clearRoom(room) {
    if (room.cleared) return
    room.cleared = true
    this.roomsCleared++
    this.score += 50
    if (room.type === 'boss') {
      const b = room.boss
      room.boss = null
      this.spawnPickup(room, b.x, b.y + 10, 'gun', true)
      room.portal = { x: room.x + ROOM_W / 2, y: room.y + ROOM_H / 2 + 40 }
      this.floatText(room.portal.x, room.portal.y - 30, '传送门已开启', '#fbbf24')
      this.setBanner(`${FLOORS[this.floorIndex].bossName} 已击败！`)
    } else if (room.enemyDefs.length) {
      if (Math.random() < 0.35 + this.player.luck) {
        const chest = room.chests.find((c) => !c.opened) || {
          x: room.x + ROOM_W / 2 + (Math.random() < 0.5 ? -60 : 60),
          y: room.y + ROOM_H / 2 + 20,
          locked: false,
          opened: false,
          quality: Math.random() < 0.5 ? 'rare' : 'common',
        }
        if (!room.chests.includes(chest)) room.chests.push(chest)
      }
    }
  }

  goNextFloor() {
    this.floorIndex++
    this.score += 200
    if (this.floorIndex >= FLOORS.length) {
      this.state = 'victory'
      this.cb.onGameOver?.({ win: true, floor: FLOORS.length, time: Math.floor(this.time), kills: this.kills, roomsCleared: this.roomsCleared, score: this.score, money: this.player.money })
      return
    }
    this.rooms = createFloor(this.floorIndex, this.seed)
    this.currentRoom = this.rooms[0]
    this.enemyBullets = []
    this.bullets = []
    this.enterRoom(this.currentRoom, null, true)
    this.setBanner(`${FLOORS[this.floorIndex].name}`)
  }

  restartRun() {
    this.seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
    this.floorIndex = 0
    this.rooms = []
    this.currentRoom = null
    this.player = this.makePlayer()
    this.guns = [JSON.parse(JSON.stringify(GUNS[0]))]
    this.gunIndex = 0
    this.enemyBullets = []
    this.bullets = []
    this.particles = []
    this.floaters = []
    this.time = 0
    this.kills = 0
    this.roomsCleared = 0
    this.score = 0
    this.transition = 0
    this.shootT = 0
    this.burstRemaining = 0
    this.burstT = 0
    this.banner = null
    this.shake = 0
    this.enterT = 0
    this.blankPressed = false
  }

  /* ---------- 更新 ---------- */
  loop = (now) => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    if (this.state === 'running') this.update(dt * this.gameSpeed)
    this.render()
  }

  update(dt) {
    this.time += dt
    if (this.transition > 0) this.transition = Math.max(0, this.transition - dt * 1.8)
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30)
    if (this.enterT > 0) this.enterT -= dt
    if (this.banner) {
      this.banner.t -= dt
      if (this.banner.t <= 0) this.banner = null
    }

    this.updatePlayer(dt)
    this.updateBlank(dt)
    this.updateShooting(dt)
    this.updateEnemies(dt)
    this.updateBullets(dt)
    this.updateEnemyBullets(dt)
    this.updatePickups(dt)
    this.updateParticles(dt)
    this.updateInteractions(dt)
    this.updateDoorEntry(dt)
  }

  updatePlayer(dt) {
    const p = this.player
    let dx = 0
    let dy = 0
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1
    const moving = dx !== 0 || dy !== 0
    p.moving = moving
    if (moving) {
      const len = Math.hypot(dx, dy)
      dx /= len
      dy /= len
      if (Math.abs(dx) > 0.01) p.dir = dx > 0 ? 1 : -1
      if (Math.abs(dy) >= Math.abs(dx)) p.face = dy < 0 ? 'up' : 'down'
      else p.face = dx < 0 ? 'left' : 'right'
    }

    p.rollCd = Math.max(0, p.rollCd - dt)
    if (this.rollKey && p.rollCd <= 0 && p.rollT <= 0) {
      p.rollT = 0.22
      p.rollCd = 0.7
      p.iframes = Math.max(p.iframes, 0.3)
      if (moving) {
        p.rollDirX = dx
        p.rollDirY = dy
      } else {
        const aim = this.aimWorld()
        const len = Math.hypot(aim.x - p.x, aim.y - p.y) || 1
        p.rollDirX = (aim.x - p.x) / len
        p.rollDirY = (aim.y - p.y) / len
      }
      this.shake = 3
      this.burst(p.x, p.y, '#7dd3fc', 8)
    }
    this.rollKey = false

    if (p.rollT > 0) {
      p.rollT -= dt
      dx = p.rollDirX
      dy = p.rollDirY
      const spd = 560
      this.moveCircle(p.x + dx * spd * dt, p.y + dy * spd * dt, p.r, (nx, ny) => { p.x = nx; p.y = ny })
      this.particles.push({ x: p.x, y: p.y, vx: -dx * 80, vy: -dy * 80, life: 0.28, max: 0.28, r: 5, color: '#7dd3fc' })
    } else {
      const spd = p.speed * (1 + p.speedBonus)
      this.moveCircle(p.x + dx * spd * dt, p.y + dy * spd * dt, p.r, (nx, ny) => { p.x = nx; p.y = ny })
    }

    p.iframes = Math.max(0, p.iframes - dt)
    p.attackT = Math.max(0, p.attackT - dt)
    p.hp = Math.min(p.maxHp, p.hp)
  }

  moveCircle(nx, ny, r, apply, cur = this.player) {
    const room = this.currentRoom
    if (!room) return apply(nx, ny)
    const stepX = this.collideAxis(room, nx, cur.y, r, 'x')
    const stepY = this.collideAxis(room, stepX, ny, r, 'y')
    apply(stepX, stepY)
  }

  collideAxis(room, x, y, r, axis) {
    const minX = room.x + r
    const maxX = room.x + room.w - r
    const minY = room.y + r
    const maxY = room.y + room.h - r
    let px = clamp(x, minX, maxX)
    let py = clamp(y, minY, maxY)
    if (axis === 'x') px = x
    else py = y
    // 遍历可能碰撞的格子，做圆-矩形推出
    const tw = ROOM_W / TILE
    const th = ROOM_H / TILE
    const tx0 = Math.max(0, Math.floor((px - room.x - r) / TILE))
    const ty0 = Math.max(0, Math.floor((py - room.y - r) / TILE))
    const tx1 = Math.min(tw - 1, Math.floor((px - room.x + r) / TILE))
    const ty1 = Math.min(th - 1, Math.floor((py - room.y + r) / TILE))
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const v = room.tiles[ty][tx]
        if (v !== 1 && v !== 2) continue
        const rect = { x: room.x + tx * TILE, y: room.y + ty * TILE, w: TILE, h: TILE }
        const cx = clamp(px, rect.x, rect.x + rect.w)
        const cy = clamp(py, rect.y, rect.y + rect.h)
        const dx = px - cx
        const dy = py - cy
        const d2 = dx * dx + dy * dy
        if (d2 < r * r) {
          if (d2 === 0) {
            // 圆心在障碍内部：按进入方向推回
            if (axis === 'x') px = dx > 0 ? rect.x + rect.w + r : rect.x - r
            else py = dy > 0 ? rect.y + rect.h + r : rect.y - r
          } else {
            const d = Math.sqrt(d2)
            const push = r - d
            if (axis === 'x') px += (dx / d) * push
            else py += (dy / d) * push
          }
        }
      }
    }
    return axis === 'x' ? clamp(px, minX, maxX) : clamp(py, minY, maxY)
  }

  aimWorld() {
    if (!this.currentRoom) return { x: this.mouse.x, y: this.mouse.y }
    const ox = Math.max(0, (this.view.w - ROOM_W) / 2)
    const oy = Math.max(0, (this.view.h - ROOM_H) / 2)
    return { x: this.currentRoom.x - ox + this.mouse.x, y: this.currentRoom.y - oy + this.mouse.y }
  }

  updateBlank(dt) {
    if (!this.blankPressed) return
    this.blankPressed = false
    const p = this.player
    if (p.blanks <= 0) {
      this.floatText(p.x, p.y - 24, '没有空白卷轴！', '#94a3b8')
      return
    }
    p.blanks--
    this.enemyBullets = []
    this.burst(p.x, p.y, '#22d3ee', 18)
    this.shake = 5
    this.floatText(p.x, p.y - 24, '空白！', '#22d3ee')
  }

  updateShooting(dt) {
    const p = this.player
    const gun = this.currentGun()
    if (this.mouse.down && p.rollT <= 0) {
      this.shootT = (this.shootT || 0) - dt
      if (this.shootT <= 0) {
        const canShoot = Number.isFinite(gun.ammo) ? gun.ammo > 0 : true
        if (canShoot) {
          if (Number.isFinite(gun.ammo)) gun.ammo--
          this.fireGun(gun)
          if (gun.burst > 1) {
            this.burstRemaining = gun.burst - 1
            this.burstT = 0
          }
          this.shootT = 1 / gun.fireRate
        }
      }
    }
    if (this.burstRemaining > 0) {
      this.burstT -= dt
      if (this.burstT <= 0) {
        this.burstT = gun.burstDelay
        this.burstRemaining--
        const canShoot = Number.isFinite(gun.ammo) ? gun.ammo > 0 : true
        if (canShoot) {
          if (Number.isFinite(gun.ammo)) gun.ammo--
          this.fireGun(gun)
        }
      }
    }
  }

  fireGun(gun) {
    const p = this.player
    const aim = this.aimWorld()
    const base = Math.atan2(aim.y - p.y, aim.x - p.x)
    const dmg = gun.dmg + p.dmgBonus
    for (let i = 0; i < gun.count; i++) {
      const off = i - (gun.count - 1) / 2
      const ang = base + off * gun.spread + rand(-gun.spread * 0.25, gun.spread * 0.25)
      this.bullets.push({
        x: p.x + Math.cos(base) * 20,
        y: p.y + Math.sin(base) * 20,
        vx: Math.cos(ang) * gun.speed,
        vy: Math.sin(ang) * gun.speed,
        r: gun.bulletR,
        dmg,
        color: gun.color,
        life: 1.4,
        pierce: gun.pierce,
        splash: gun.splash,
        hit: new Set(),
      })
    }
    p.attackT = 0.16
    this.shake = Math.max(this.shake, gun.id === 'rocket' ? 6 : 1)
  }

  fireEnemyBullet(x, y, angle, speed, r = 7, dmg = 1, color = '#f87171') {
    if (this.enemyBullets.length >= 260) return
    this.enemyBullets.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r, dmg, life: 4, color })
  }

  updateEnemies(dt) {
    const room = this.currentRoom
    if (!room) return
    const p = this.player

    for (const e of room.enemies) {
      this.updateEnemyAI(e, dt)
      if (e.hitT > 0) e.hitT -= dt
      if (p.iframes <= 0 && e.type !== 'turret' && dist2(e.x, e.y, p.x, p.y) < (e.r + p.r) * (e.r + p.r)) {
        this.hurtPlayer(e.dmg)
        p.iframes = 0.6
        this.shake = 7
      }
    }
    room.enemies = room.enemies.filter((e) => e.hp > 0)

    if (room.boss) {
      const b = room.boss
      this.updateBossAI(b, dt)
      if (b.hitT > 0) b.hitT -= dt
      if (p.iframes <= 0 && dist2(b.x, b.y, p.x, p.y) < (b.r + p.r) * (b.r + p.r)) {
        this.hurtPlayer(b.dmg)
        p.iframes = 0.7
        this.shake = 9
      }
      if (b.hp <= 0) {
        this.onBossKilled(b, room)
      }
    }

    if (room.enemies.length === 0 && !room.boss && !room.cleared && room.enemyDefs.length) {
      this.clearRoom(room)
    }
  }

  updateEnemyAI(e, dt) {
    const p = this.player
    const dx = p.x - e.x
    const dy = p.y - e.y
    const d = Math.hypot(dx, dy) || 1

    if (e.type === 'rat') {
      const spd = e.speed * (e.hp < e.maxHp * 0.35 ? 1.25 : 1)
      this.moveCircle(e.x + (dx / d) * spd * dt, e.y + (dy / d) * spd * dt, e.r, (nx, ny) => { e.x = nx; e.y = ny }, e)
      return
    }

    if (e.type === 'brute') {
      if (d > 60) {
        this.moveCircle(e.x + (dx / d) * e.speed * dt, e.y + (dy / d) * e.speed * dt, e.r, (nx, ny) => { e.x = nx; e.y = ny }, e)
      }
      return
    }

    if (e.type === 'turret') {
      e.t += dt
      e.shootT -= dt
      if (e.shootT <= 0 && d < 520) {
        e.shootT = e.shootCd
        const ang = Math.atan2(dy, dx)
        for (let i = -1; i <= 1; i++) this.fireEnemyBullet(e.x, e.y, ang + i * 0.14, 170, 6, e.dmg, '#fca5a5')
      }
      return
    }

    // 中距离游走 + 射击
    const ideal = e.type === 'wizard' ? 260 : 220
    if (d > ideal + 50) {
      this.moveCircle(e.x + (dx / d) * e.speed * dt, e.y + (dy / d) * e.speed * dt, e.r, (nx, ny) => { e.x = nx; e.y = ny }, e)
    } else if (d < ideal - 60 && e.type !== 'kin') {
      this.moveCircle(e.x - (dx / d) * e.speed * 0.6 * dt, e.y - (dy / d) * e.speed * 0.6 * dt, e.r, (nx, ny) => { e.x = nx; e.y = ny }, e)
    } else {
      // 横向小步绕圈
      const strafe = e.type === 'wizard' ? 1 : 0.4
      const sx = -dy / d
      const sy = dx / d
      this.moveCircle(e.x + sx * e.speed * strafe * dt, e.y + sy * e.speed * strafe * dt, e.r, (nx, ny) => { e.x = nx; e.y = ny }, e)
    }

    e.shootT -= dt
    if (e.shootT <= 0 && d < 520) {
      e.shootT = e.shootCd
      const ang = Math.atan2(dy, dx)
      if (e.type === 'shotgunner') {
        for (let i = -1; i <= 1; i++) this.fireEnemyBullet(e.x, e.y, ang + i * 0.22, 180, 7, e.dmg, '#fca5a5')
      } else if (e.type === 'wizard') {
        this.fireEnemyBullet(e.x, e.y, ang, 150, 9, e.dmg, '#c084fc')
        this.fireEnemyBullet(e.x, e.y, ang + 0.5, 150, 9, e.dmg, '#c084fc')
        this.fireEnemyBullet(e.x, e.y, ang - 0.5, 150, 9, e.dmg, '#c084fc')
      } else {
        this.fireEnemyBullet(e.x, e.y, ang, 200, 7, e.dmg, '#f87171')
      }
    }
  }

  updateBossAI(b, dt) {
    const p = this.player
    const dx = p.x - b.x
    const dy = p.y - b.y
    const d = Math.hypot(dx, dy) || 1
    if (d > 180) {
      this.moveCircle(b.x + (dx / d) * b.speed * dt, b.y + (dy / d) * b.speed * dt, b.r, (nx, ny) => { b.x = nx; b.y = ny }, b)
    }
    b.t += dt
    b.shootT -= dt
    const hpFrac = b.hp / b.maxHp
    b.pattern = hpFrac < 0.35 ? 3 : hpFrac < 0.7 ? 2 : 1

    if (b.shootT <= 0) {
      if (b.pattern === 1) {
        b.shootT = 2.0
        const n = 10
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n + b.t
          this.fireEnemyBullet(b.x, b.y, a, 130 + this.floorIndex * 12, 8, b.dmg, b.color)
        }
      } else if (b.pattern === 2) {
        b.shootT = 1.5
        const ang = Math.atan2(dy, dx)
        const n = 12
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n + b.t * 1.3
          this.fireEnemyBullet(b.x, b.y, a, 150 + this.floorIndex * 14, 8, b.dmg, b.color)
        }
        for (let i = -1; i <= 1; i++) this.fireEnemyBullet(b.x, b.y, ang + i * 0.16, 230, 7, b.dmg * 0.8, '#fca5a5')
      } else {
        b.shootT = 1.1
        const ang = Math.atan2(dy, dx)
        const n = 16
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n + b.t * 1.8
          this.fireEnemyBullet(b.x, b.y, a, 170 + this.floorIndex * 16, 8, b.dmg, b.color)
        }
        for (let i = -2; i <= 2; i++) this.fireEnemyBullet(b.x, b.y, ang + i * 0.12, 260, 7, b.dmg * 0.7, '#fca5a5')
      }
      this.burst(b.x, b.y, b.color, 6)
    }
  }

  onBossKilled(b, room) {
    this.kills++
    this.score += 500
    this.shake = 14
    this.burst(b.x, b.y, b.color, 30)
    this.clearRoom(room)
  }

  updateBullets(dt) {
    const room = this.currentRoom
    if (!room) return
    const p = this.player
    for (const b of this.bullets) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      if (solidAt(room, b.x, b.y)) {
        if (b.splash) this.explode(b, room)
        b.life = 0
        continue
      }
      const targets = room.boss ? [room.boss, ...room.enemies] : room.enemies
      for (const e of targets) {
        if (e.hp <= 0 || b.hit.has(e)) continue
        if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) * (e.r + b.r)) {
          e.hp -= b.dmg
          e.hitT = 0.1
          b.hit.add(e)
          this.particles.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.22, max: 0.22, r: b.splash ? 8 : 4, color: b.color })
          if (e.hp <= 0 && e !== room.boss) this.onEnemyKilled(e, room)
          if (b.splash) this.explode(b, room)
          if (b.pierce > 0) {
            b.pierce--
            b.dmg *= 0.85
            b.life = Math.min(b.life, 0.4)
            continue
          }
          b.life = 0
          break
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0)
  }

  explode(b, room) {
    const targets = room.boss ? [room.boss, ...room.enemies] : room.enemies
    for (const e of targets) {
      if (e.hp <= 0) continue
      if (dist2(e.x, e.y, b.x, b.y) < (b.splash + e.r) * (b.splash + e.r)) {
        e.hp -= b.dmg * 0.6
        e.hitT = 0.1
        if (e.hp <= 0 && e !== room.boss) this.onEnemyKilled(e, room)
      }
    }
    this.burst(b.x, b.y, '#fb923c', 12)
    this.shake = Math.max(this.shake, 6)
  }

  updateEnemyBullets(dt) {
    const room = this.currentRoom
    const p = this.player
    for (const b of this.enemyBullets) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      if (solidAt(room, b.x, b.y)) {
        b.life = 0
        continue
      }
      if (p.iframes <= 0 && dist2(b.x, b.y, p.x, p.y) < (p.r + b.r) * (p.r + b.r)) {
        this.hurtPlayer(b.dmg)
        p.iframes = 0.5
        this.shake = 5
        b.life = 0
        this.burst(b.x, b.y, '#ef4444', 6)
      }
    }
    this.enemyBullets = this.enemyBullets.filter((b) => b.life > 0)
  }

  onEnemyKilled(e, room) {
    this.kills++
    this.score += e.type === 'brute' || e.type === 'turret' ? 20 : 10
    this.burst(e.x, e.y, e.color, 8)
    const roll = Math.random()
    if (roll < 0.16 + this.player.luck) this.spawnPickup(room, e.x, e.y, 'coin', false, 1)
    else if (roll < 0.22 + this.player.luck) this.spawnPickup(room, e.x, e.y, 'heart', false, 1)
    else if (roll < 0.26 + this.player.luck) this.spawnPickup(room, e.x, e.y, 'key', false, 1)
    else if (roll < 0.29 + this.player.luck) this.spawnPickup(room, e.x, e.y, 'blank', false, 1)
    else if (roll < 0.31 + this.player.luck) this.spawnPickup(room, e.x, e.y, 'gun', true)
  }

  hurtPlayer(amount) {
    const p = this.player
    if (p.iframes > 0) return
    p.hp -= amount
    p.iframes = 0.6
    this.shake = 8
    if (p.hp <= 0) {
      p.hp = 0
      this.state = 'dead'
      this.cb.onGameOver?.({ win: false, floor: this.floorIndex + 1, time: Math.floor(this.time), kills: this.kills, roomsCleared: this.roomsCleared, score: this.score, money: p.money })
    }
  }

  spawnPickup(room, x, y, kind, force = false, value = 1) {
    if (room.pickups.length > 80) return
    room.pickups.push({ x, y, kind, value, bobT: Math.random() * 6 })
  }

  updatePickups(dt) {
    const room = this.currentRoom
    const p = this.player
    if (!room) return
    for (const it of room.pickups) {
      it.bobT += dt
      if (dist2(it.x, it.y, p.x, p.y) < (p.r + 20) * (p.r + 20)) {
        this.collectPickup(it, room)
        it.dead = true
      }
    }
    room.pickups = room.pickups.filter((i) => !i.dead)
  }

  collectPickup(it, room) {
    const p = this.player
    switch (it.kind) {
      case 'coin':
        p.money += it.value
        this.score += it.value
        this.floatText(it.x, it.y - 14, `+${it.value} 金币`, '#fbbf24')
        break
      case 'heart':
        p.hp = Math.min(p.maxHp, p.hp + it.value)
        this.floatText(it.x, it.y - 14, '+♥', '#f87171')
        break
      case 'key':
        p.keys += it.value
        this.floatText(it.x, it.y - 14, '+钥匙', '#eab308')
        break
      case 'blank':
        p.blanks += it.value
        this.floatText(it.x, it.y - 14, '+空白', '#22d3ee')
        break
      case 'gun':
        this.addGun(it.gunId || randomGunId())
        break
      case 'passive':
        this.applyPassive(it.passiveId || randomPassiveId())
        break
      case 'ammo':
        this.refillAmmo()
        this.floatText(it.x, it.y - 14, '弹药补满', '#a5f3fc')
        break
    }
  }

  randomGunId() {
    const pool = GUNS.filter((g) => g.id !== 'pistol')
    return pool[Math.floor(Math.random() * pool.length)].id
  }

  randomPassiveId() {
    return PASSIVES[Math.floor(Math.random() * PASSIVES.length)].id
  }

  addGun(id) {
    const def = GUNS.find((g) => g.id === id)
    if (!def) return
    const existing = this.guns.find((g) => g.id === id)
    if (existing) {
      if (Number.isFinite(existing.ammo)) existing.ammo = Math.min(existing.maxAmmo, existing.ammo + existing.maxAmmo * 0.5)
      this.floatText(this.player.x, this.player.y - 24, `${def.name} 弹药补充`, def.color)
      return
    }
    this.guns.push(JSON.parse(JSON.stringify(def)))
    this.gunIndex = this.guns.length - 1
    this.floatText(this.player.x, this.player.y - 24, `获得 ${def.name}`, def.color)
  }

  applyPassive(id) {
    const def = PASSIVES.find((x) => x.id === id)
    if (!def) return
    def.apply(this.player, this.guns)
    this.floatText(this.player.x, this.player.y - 24, `获得 ${def.name}`, '#c084fc')
  }

  refillAmmo() {
    for (const g of this.guns) {
      if (Number.isFinite(g.ammo)) g.ammo = g.maxAmmo
    }
  }

  updateInteractions(dt) {
    if (!this.interactPressed) return
    this.interactPressed = false
    const room = this.currentRoom
    if (!room) return
    const p = this.player

    // 传送门
    if (room.portal) {
      if (dist2(p.x, p.y, room.portal.x, room.portal.y) < 60 * 60) {
        this.goNextFloor()
        return
      }
    }
    // 宝箱
    for (const chest of room.chests) {
      if (chest.opened) continue
      if (dist2(p.x, p.y, chest.x, chest.y) < 52 * 52) {
        if (chest.locked && p.keys <= 0) {
          this.floatText(chest.x, chest.y - 30, '需要钥匙！', '#eab308')
          return
        }
        if (chest.locked) {
          p.keys--
          this.floatText(chest.x, chest.y - 30, '使用钥匙', '#eab308')
        }
        chest.opened = true
        this.openChestReward(chest)
        return
      }
    }
    // 商店
    for (const item of room.shopItems) {
      if (item.sold) continue
      if (dist2(p.x, p.y, item.x, item.y) < 46 * 46) {
        if (p.money < item.price) {
          this.floatText(item.x, item.y - 24, '金币不足！', '#f87171')
          return
        }
        p.money -= item.price
        item.sold = true
        this.buyShopItem(item)
        return
      }
    }
  }

  openChestReward(chest) {
    const r = Math.random()
    if (r < 0.45 || chest.quality === 'rare') {
      this.spawnPickup(this.currentRoom, chest.x, chest.y, 'gun', true)
    } else if (r < 0.7) {
      this.spawnPickup(this.currentRoom, chest.x, chest.y, 'passive', true)
    } else if (r < 0.85) {
      this.spawnPickup(this.currentRoom, chest.x, chest.y, 'heart', true, 2)
    } else {
      this.spawnPickup(this.currentRoom, chest.x, chest.y, 'key', true, 2)
    }
    this.burst(chest.x, chest.y, '#fbbf24', 14)
  }

  buyShopItem(item) {
    if (item.kind === 'gun') {
      this.addGun(item.id)
    } else if (item.kind === 'passive') {
      this.applyPassive(item.id)
    } else if (item.id === 'heart') {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2)
      this.floatText(item.x, item.y - 20, '+2♥', '#f87171')
    } else if (item.id === 'key') {
      this.player.keys += 1
      this.floatText(item.x, item.y - 20, '+钥匙', '#eab308')
    } else if (item.id === 'blank') {
      this.player.blanks += 1
      this.floatText(item.x, item.y - 20, '+空白', '#22d3ee')
    } else if (item.id === 'ammo') {
      this.refillAmmo()
      this.floatText(item.x, item.y - 20, '弹药补满', '#a5f3fc')
    }
  }

  updateDoorEntry(dt) {
    if (this.enterT > 0) return
    const room = this.currentRoom
    if (!room || this.isRoomLocked(room)) return
    const sides = ['top', 'bottom', 'left', 'right']
    for (const side of sides) {
      if (!room.doors[side]) continue
      const d = doorInfo(room, side)
      if (dist2(this.player.x, this.player.y, d.x, d.y) < 34 * 34) {
        const next = neighborRoom(this.rooms, room, side)
        if (next && !this.isRoomLocked(next)) {
          this.enterRoom(next, side)
          return
        }
      }
    }
  }

  updateParticles(dt) {
    for (const pt of this.particles) {
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
      pt.life -= dt
    }
    this.particles = this.particles.filter((p) => p.life > 0)
    for (const f of this.floaters) {
      f.y -= 36 * dt
      f.life -= dt
    }
    this.floaters = this.floaters.filter((f) => f.life > 0)
  }

  burst(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = rand(40, 160)
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.5), max: 0.5, r: rand(2, 5), color })
    }
  }

  floatText(x, y, text, color) {
    this.floaters.push({ x, y, text, color, life: 1.3, max: 1.3 })
  }

  setBanner(name) {
    this.banner = { name, t: 2.2 }
  }

  /* ---------- 渲染 ---------- */
  render() {
    const ctx = this.ctx
    const { w, h } = this.view
    if (!this.currentRoom) {
      ctx.fillStyle = '#0b1020'
      ctx.fillRect(0, 0, w, h)
      return
    }
    const room = this.currentRoom
    const ox = Math.max(0, (this.view.w - ROOM_W) / 2)
    const oy = Math.max(0, (this.view.h - ROOM_H) / 2)
    const camX = room.x - ox + (Math.random() * 2 - 1) * this.shake
    const camY = room.y - oy + (Math.random() * 2 - 1) * this.shake
    this.camX = camX
    this.camY = camY

    ctx.save()
    ctx.fillStyle = '#0b1020'
    ctx.fillRect(0, 0, w, h)

    this.drawRoom(ctx, room, camX, camY)
    this.drawEntities(ctx, room, camX, camY)
    this.drawHud(ctx, room)
    this.drawMinimap(ctx)
    this.drawBanner(ctx)
    this.drawTransition(ctx)
    this.drawCrosshair(ctx)
    ctx.restore()
  }

  drawRoom(ctx, room, camX, camY) {
    const floor = FLOORS[this.floorIndex]
    const tw = ROOM_W / TILE
    const th = ROOM_H / TILE
    // 地面
    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const v = room.tiles[ty][tx]
        const sx = room.x + tx * TILE - camX
        const sy = room.y + ty * TILE - camY
        if (v === 1) {
          ctx.fillStyle = floor.wall
          ctx.fillRect(sx, sy, TILE, TILE)
          ctx.fillStyle = floor.wallHi
          ctx.fillRect(sx + 2, sy + 2, TILE - 4, 5)
          continue
        }
        const checker = (tx + ty) % 2 === 0
        ctx.fillStyle = checker ? floor.floorA : floor.floorB
        ctx.fillRect(sx, sy, TILE, TILE)
        if (v === 2) {
          this.drawObstacle(ctx, sx + TILE / 2, sy + TILE / 2, floor)
        }
      }
    }
    // 门框
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 3
    for (const side of ['top', 'bottom', 'left', 'right']) {
      if (!room.doors[side]) continue
      const d = doorInfo(room, side)
      const sx = d.x - camX
      const sy = d.y - camY
      ctx.beginPath()
      if (side === 'top' || side === 'bottom') {
        ctx.moveTo(sx - 34, sy)
        ctx.lineTo(sx + 34, sy)
      } else {
        ctx.moveTo(sx, sy - 34)
        ctx.lineTo(sx, sy + 34)
      }
      ctx.stroke()
    }
    // 装饰
    for (const dec of room.decor) {
      this.drawDeco(ctx, dec, camX, camY, floor)
    }
  }

  drawObstacle(ctx, x, y, floor) {
    ctx.save()
    ctx.translate(x, y)
    ctx.fillStyle = floor.wall
    ctx.fillRect(-16, -16, 32, 32)
    ctx.fillStyle = floor.wallHi
    ctx.fillRect(-16, -16, 32, 6)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(-10, -8, 8, 22)
    ctx.restore()
  }

  drawDeco(ctx, d, camX, camY, floor) {
    const sx = d.x - camX
    const sy = d.y - camY
    if (sx < -120 || sx > this.view.w + 120 || sy < -120 || sy > this.view.h + 120) return
    ctx.save()
    ctx.translate(sx, sy)
    ctx.scale(d.scale, d.scale)
    switch (d.kind) {
      case 'tree':
        ctx.fillStyle = '#7c5a3a'; ctx.fillRect(-5, -22, 10, 24)
        ctx.fillStyle = floor.floorA; ctx.beginPath(); ctx.moveTo(0, -64); ctx.lineTo(-30, -6); ctx.lineTo(30, -6); ctx.closePath(); ctx.fill()
        ctx.fillStyle = floor.accent; ctx.beginPath(); ctx.moveTo(0, -44); ctx.lineTo(-20, 2); ctx.lineTo(20, 2); ctx.closePath(); ctx.fill()
        break
      case 'pine':
        ctx.fillStyle = '#6b4f3a'; ctx.fillRect(-4, -18, 8, 20)
        ctx.fillStyle = floor.floorA; ctx.beginPath(); ctx.moveTo(0, -58); ctx.lineTo(-26, -4); ctx.lineTo(26, -4); ctx.closePath(); ctx.fill()
        ctx.fillStyle = '#dbeafe'; ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(-18, 4); ctx.lineTo(18, 4); ctx.closePath(); ctx.fill()
        break
      case 'bush':
        ctx.fillStyle = '#2f7d32'; ctx.beginPath(); ctx.arc(-9, -8, 10, 0, Math.PI * 2); ctx.arc(9, -10, 12, 0, Math.PI * 2); ctx.arc(0, -2, 11, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = floor.accent; ctx.beginPath(); ctx.arc(0, -14, 5, 0, Math.PI * 2); ctx.fill()
        break
      case 'flower':
        ctx.strokeStyle = '#2f7d32'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -12); ctx.stroke()
        ctx.fillStyle = '#f9a8d4'; for (let i = 0; i < 5; i++) { const a = (Math.PI * 2 * i) / 5; ctx.beginPath(); ctx.arc(Math.cos(a) * 6, -16 + Math.sin(a) * 6, 4, 0, Math.PI * 2); ctx.fill() }
        ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(0, -16, 3, 0, Math.PI * 2); ctx.fill()
        break
      case 'mushroom':
        ctx.fillStyle = '#f8fafc'; ctx.fillRect(-2, -8, 4, 10); ctx.fillStyle = '#f87171'; ctx.beginPath(); ctx.arc(0, -12, 8, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-3, -14, 2, 0, Math.PI * 2); ctx.fill(); break
      case 'mound':
        ctx.fillStyle = '#f1f5f9'; ctx.beginPath(); ctx.ellipse(0, -4, 22, 10, 0, Math.PI, 0); ctx.fill(); break
      case 'ice':
        ctx.fillStyle = '#a5f3fc'; ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(11, 0); ctx.lineTo(0, 9); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill(); break
      case 'pillar':
        ctx.fillStyle = '#4c1d95'; ctx.fillRect(-10, -30, 20, 32); ctx.fillStyle = '#7c3aed'; ctx.fillRect(-13, -34, 26, 7); ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(-5, -30, 4, 30); break
      case 'torch':
        ctx.fillStyle = '#57534e'; ctx.fillRect(-3, -20, 6, 22); ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(-8, -16); ctx.lineTo(8, -16); ctx.closePath(); ctx.fill(); break
      case 'crystal':
        ctx.fillStyle = floor.accent; ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(9, -5); ctx.lineTo(5, 7); ctx.lineTo(-5, 7); ctx.lineTo(-9, -5); ctx.closePath(); ctx.fill(); break
      case 'spike':
        ctx.fillStyle = '#4c1d95'; ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(13, 3); ctx.lineTo(-13, 3); ctx.closePath(); ctx.fill(); break
      case 'monument':
        ctx.fillStyle = '#475569'; ctx.fillRect(-9, -42, 18, 44); ctx.fillStyle = '#64748b'; ctx.fillRect(-13, -48, 26, 7); ctx.fillStyle = floor.accent; ctx.beginPath(); ctx.moveTo(0, -58); ctx.lineTo(-7, -44); ctx.lineTo(7, -44); ctx.closePath(); ctx.fill(); break
      default:
        ctx.fillStyle = floor.accent; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  drawEntities(ctx, room, camX, camY) {
    const list = []
    for (const it of room.pickups) {
      list.push({ y: it.y, draw: () => this.drawPickup(ctx, it, camX, camY) })
    }
    for (const chest of room.chests) {
      list.push({ y: chest.y, draw: () => this.drawChest(ctx, chest, camX, camY) })
    }
    for (const item of room.shopItems) {
      if (item.sold) continue
      list.push({ y: item.y, draw: () => this.drawShopItem(ctx, item, camX, camY) })
    }
    if (room.portal) {
      list.push({ y: room.portal.y, draw: () => this.drawPortal(ctx, room.portal.x, room.portal.y) })
    }
    for (const e of room.enemies) list.push({ y: e.y, draw: () => this.drawEnemy(ctx, e, camX, camY) })
    if (room.boss) list.push({ y: room.boss.y, draw: () => this.drawBoss(ctx, room.boss, camX, camY) })
    list.push({ y: this.player.y, draw: () => this.drawPlayer(ctx, camX, camY) })
    for (const b of this.bullets) list.push({ y: b.y, draw: () => this.drawBullet(ctx, b, camX, camY) })
    for (const b of this.enemyBullets) list.push({ y: b.y, draw: () => this.drawEnemyBullet(ctx, b, camX, camY) })
    for (const pt of this.particles) list.push({ y: pt.y, draw: () => this.drawParticle(ctx, pt, camX, camY) })
    for (const f of this.floaters) list.push({ y: f.y, draw: () => this.drawFloater(ctx, f, camX, camY) })
    list.sort((a, b) => a.y - b.y)
    for (const item of list) item.draw()
  }

  drawPickup(ctx, it, camX, camY) {
    const sx = it.x - camX
    const sy = it.y - camY + Math.sin(it.bobT * 3) * 3
    if (sx < -40 || sx > this.view.w + 40 || sy < -40 || sy > this.view.h + 40) return
    ctx.save()
    ctx.translate(sx, sy)
    if (it.kind === 'coin') {
      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill()
    } else if (it.kind === 'heart') {
      this.heart(ctx, 0, 0, 8, '#f87171')
    } else if (it.kind === 'key') {
      ctx.strokeStyle = '#eab308'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(5, 5); ctx.lineTo(10, 10); ctx.stroke()
    } else if (it.kind === 'blank') {
      ctx.fillStyle = '#22d3ee'; ctx.fillRect(-6, -6, 12, 12); ctx.strokeStyle = '#a5f3fc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-3, -6); ctx.lineTo(-3, 6); ctx.moveTo(3, -6); ctx.lineTo(3, 6); ctx.stroke()
    } else if (it.kind === 'gun') {
      ctx.fillStyle = '#e2e8f0'; ctx.fillRect(-2, -7, 12, 6); ctx.fillStyle = '#475569'; ctx.fillRect(8, -8, 5, 8); ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; ctx.strokeRect(-7, -7, 12, 8)
    } else if (it.kind === 'passive') {
      ctx.fillStyle = '#c084fc'; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0); ctx.closePath(); ctx.fill()
    } else if (it.kind === 'ammo') {
      ctx.fillStyle = '#64748b'; ctx.fillRect(-8, -6, 16, 12); ctx.fillStyle = '#a5f3fc'; ctx.fillRect(-5, -3, 6, 6)
    }
    ctx.restore()
  }

  drawChest(ctx, chest, camX, camY) {
    const sx = chest.x - camX
    const sy = chest.y - camY + Math.sin(performance.now() / 300) * 2
    ctx.save()
    ctx.translate(sx, sy)
    ctx.fillStyle = chest.opened ? '#57534e' : '#8b5e3c'
    ctx.fillRect(-14, -10, 28, 20)
    ctx.fillStyle = chest.locked && !chest.opened ? '#fbbf24' : '#d6a35c'
    ctx.fillRect(-14, -10, 28, 6)
    if (chest.locked && !chest.opened) {
      ctx.fillStyle = '#78350f'; ctx.fillRect(-3, -3, 6, 6); ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill()
    }
    if (!chest.opened && Math.random() < 0.02) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(-5, -4, 2, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  drawShopItem(ctx, item, camX, camY) {
    const sx = item.x - camX
    const sy = item.y - camY
    ctx.save()
    ctx.translate(sx, sy)
    ctx.fillStyle = 'rgba(2,6,23,0.55)'
    ctx.fillRect(-36, -16, 72, 34)
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1; ctx.strokeRect(-36, -16, 72, 34)
    ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${item.price}G`, 0, 8)
    ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(item.name, 0, -6)
    ctx.restore()
  }

  drawPortal(ctx, x, y) {
    const sx = x - this.camX
    const sy = y - this.camY
    const pulse = 1 + Math.sin(performance.now() / 250) * 0.08
    ctx.save()
    ctx.translate(sx, sy)
    ctx.scale(pulse, pulse)
    ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 20
    ctx.fillStyle = '#7c3aed'; ctx.beginPath(); ctx.ellipse(0, 0, 22, 32, 0, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#c084fc'; ctx.beginPath(); ctx.ellipse(0, 0, 14, 24, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  drawEnemy(ctx, e, camX, camY) {
    const sx = e.x - camX
    const sy = e.y - camY
    if (sx < -80 || sx > this.view.w + 80 || sy < -80 || sy > this.view.h + 80) return
    const flash = e.hitT > 0
    const main = flash ? '#ffffff' : e.color
    const dark = flash ? '#e2e8f0' : shadeColor(e.color, 0.7)
    ctx.save()
    ctx.translate(sx, sy)
    const cy = -e.r * 0.7
    if (e.type === 'rat') {
      ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-e.r, cy); ctx.lineTo(-e.r * 1.7, cy - e.r * 0.5); ctx.lineTo(-e.r * 0.8, cy + e.r * 0.3); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.moveTo(e.r, cy); ctx.lineTo(e.r * 1.7, cy - e.r * 0.5); ctx.lineTo(e.r * 0.8, cy + e.r * 0.3); ctx.closePath(); ctx.fill()
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(0, cy, e.r, e.r * 0.85, 0, 0, Math.PI * 2); ctx.fill()
    } else if (e.type === 'brute') {
      ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, cy, e.r, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = main; ctx.beginPath(); ctx.arc(0, cy - e.r * 0.1, e.r * 0.85, 0, Math.PI * 2); ctx.fill()
    } else if (e.type === 'turret') {
      ctx.fillStyle = '#475569'; ctx.fillRect(-e.r, cy - 8, e.r * 2, 16)
      ctx.fillStyle = main; ctx.beginPath(); ctx.arc(0, cy, e.r * 0.7, 0, Math.PI * 2); ctx.fill()
    } else if (e.type === 'wizard') {
      ctx.fillStyle = main; ctx.beginPath(); ctx.moveTo(0, cy - e.r); ctx.lineTo(e.r * 0.85, cy - e.r * 0.4); ctx.lineTo(e.r * 0.85, cy + e.r * 0.5); ctx.lineTo(0, cy + e.r); ctx.lineTo(-e.r * 0.85, cy + e.r * 0.5); ctx.lineTo(-e.r * 0.85, cy - e.r * 0.4); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-e.r * 0.3, cy - e.r * 0.15, e.r * 0.2, 0, Math.PI * 2); ctx.arc(e.r * 0.3, cy - e.r * 0.15, e.r * 0.2, 0, Math.PI * 2); ctx.fill()
    } else {
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(0, cy, e.r, e.r * 0.9, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = dark; ctx.lineWidth = 2; ctx.stroke()
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-e.r * 0.35, cy - e.r * 0.1, e.r * 0.24, 0, Math.PI * 2); ctx.arc(e.r * 0.35, cy - e.r * 0.1, e.r * 0.24, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#0f172a'; ctx.beginPath(); ctx.arc(-e.r * 0.35, cy - e.r * 0.08, e.r * 0.1, 0, Math.PI * 2); ctx.arc(e.r * 0.35, cy - e.r * 0.08, e.r * 0.1, 0, Math.PI * 2); ctx.fill()
    }
    // 血条
    if (e.hp < e.maxHp) {
      this.bar(ctx, -16, -e.r - 12, 32, 4, e.hp / e.maxHp, '#f87171', '#7f1d1d')
    }
    ctx.restore()
  }

  drawBoss(ctx, b, camX, camY) {
    const sx = b.x - camX
    const sy = b.y - camY
    const flash = b.hitT > 0
    const main = flash ? '#ffffff' : b.color
    const dark = flash ? '#e2e8f0' : shadeColor(b.color, 0.7)
    ctx.save()
    ctx.translate(sx, sy)
    const cy = -b.r * 0.8
    ctx.fillStyle = dark
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * (b.r + 8), cy + Math.sin(a) * (b.r + 8))
      ctx.lineTo(Math.cos(a + 0.25) * (b.r + 18), cy + Math.sin(a + 0.25) * (b.r + 18))
      ctx.lineTo(Math.cos(a + 0.5) * (b.r + 8), cy + Math.sin(a + 0.5) * (b.r + 8))
      ctx.closePath(); ctx.fill()
    }
    ctx.fillStyle = main; ctx.beginPath(); ctx.arc(0, cy, b.r, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(-b.r * 0.3, cy - b.r * 0.4, b.r * 0.18, 0, Math.PI * 2); ctx.arc(b.r * 0.3, cy - b.r * 0.4, b.r * 0.18, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-b.r * 0.3, cy - b.r * 0.4, b.r * 0.08, 0, Math.PI * 2); ctx.arc(b.r * 0.3, cy - b.r * 0.4, b.r * 0.08, 0, Math.PI * 2); ctx.fill()
    // Boss 血条
    ctx.restore()
    this.bar(ctx, sx - 80, sy - b.r - 28, 160, 8, b.hp / b.maxHp, main, '#7f1d1d')
  }

  drawPlayer(ctx, camX, camY) {
    const p = this.player
    const sx = p.x - camX
    const sy = p.y - camY
    ctx.save()
    ctx.translate(sx, sy)
    if (p.rollT > 0) {
      ctx.globalAlpha = 0.4
      ctx.fillStyle = '#7dd3fc'
      ctx.beginPath(); ctx.ellipse(0, 0, p.r * 1.2, p.r * 0.9, 0, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
    }
    if (p.iframes > 0 && Math.floor(p.iframes * 12) % 2 === 0) ctx.globalAlpha = 0.5
    const moving = p.moving || p.rollT > 0
    const frameImg = moving && this.petWalk.length ? this.petWalk[Math.floor(this.time * 10) % 4] : this.pImg
    const imgW = p.r * 2.1
    const imgH = p.r * 2.8
    const isWalk = moving && this.petWalk.length > 0
    if (frameImg && frameImg.complete && frameImg.naturalWidth > 0) {
      ctx.save()
      if (isWalk && p.dir > 0) ctx.scale(-1, 1)
      ctx.drawImage(frameImg, -imgW / 2, -imgH, imgW, imgH)
      ctx.restore()
    } else {
      ctx.fillStyle = '#3b82f6'; ctx.beginPath(); ctx.ellipse(0, -imgH / 2, p.r, p.r * 0.82, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
    if (p.attackT > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, -imgH / 2, p.r + 11, -1.1, 1.1); ctx.stroke()
    }
    if (p.rollCd > 0) {
      const frac = 1 - p.rollCd / 0.7
      ctx.strokeStyle = 'rgba(125,211,252,0.55)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, -imgH / 2, p.r + 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke()
    }
    ctx.restore()
  }

  drawBullet(ctx, b, camX, camY) {
    const sx = b.x - camX
    const sy = b.y - camY
    if (sx < -40 || sx > this.view.w + 40 || sy < -40 || sy > this.view.h + 40) return
    ctx.save()
    ctx.translate(sx, sy)
    ctx.rotate(Math.atan2(b.vy, b.vx))
    ctx.fillStyle = b.color
    ctx.fillRect(-b.r, -b.r * 0.6, b.r * 2, b.r * 1.2)
    if (b.splash) {
      ctx.fillStyle = 'rgba(251,146,60,0.3)'; ctx.beginPath(); ctx.arc(0, 0, b.splash * 0.3, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  drawEnemyBullet(ctx, b, camX, camY) {
    const sx = b.x - camX
    const sy = b.y - camY
    if (sx < -40 || sx > this.view.w + 40 || sy < -40 || sy > this.view.h + 40) return
    ctx.save()
    ctx.translate(sx, sy)
    ctx.shadowColor = b.color; ctx.shadowBlur = 8
    ctx.fillStyle = b.color
    ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(0, 0, b.r * 0.45, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  drawParticle(ctx, pt, camX, camY) {
    const sx = pt.x - camX
    const sy = pt.y - camY
    const alpha = clamp(pt.life / pt.max, 0, 1)
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = pt.color; ctx.beginPath(); ctx.arc(sx, sy, pt.r, 0, Math.PI * 2); ctx.fill(); ctx.restore()
  }

  drawFloater(ctx, f, camX, camY) {
    const sx = f.x - camX
    const sy = f.y - camY
    const alpha = clamp(f.life / f.max, 0, 1)
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = f.color; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(f.text, sx, sy); ctx.restore()
  }

  heart(ctx, x, y, size, color) {
    ctx.save()
    ctx.translate(x, y)
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, size * 0.9)
    ctx.bezierCurveTo(-size * 1.1, -size * 0.2, -size * 0.5, -size * 1.1, 0, -size * 0.35)
    ctx.bezierCurveTo(size * 0.5, -size * 1.1, size * 1.1, -size * 0.2, 0, size * 0.9)
    ctx.fill()
    ctx.restore()
  }

  bar(ctx, x, y, w, h, frac, color, bg) {
    ctx.fillStyle = 'rgba(2,6,23,0.75)'
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2)
    ctx.fillStyle = bg
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = color
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h)
  }

  drawHud(ctx, room) {
    const { w } = this.view
    const p = this.player
    const floor = FLOORS[this.floorIndex]
    ctx.save()

    // 左上：生命、空白、钥匙、金币
    ctx.fillStyle = 'rgba(2,6,23,0.55)'
    ctx.fillRect(10, 8, 210, 62)
    const hx = 24
    for (let i = 0; i < p.maxHp; i++) {
      this.heart(ctx, hx + i * 20, 28, i < Math.ceil(p.hp) ? 8 : 7, i < Math.ceil(p.hp) ? '#f87171' : 'rgba(148,163,184,0.35)')
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#e2e8f0'
    ctx.fillText(`💣 ${Math.floor(p.blanks)}`, 14, 48)
    ctx.fillText(`🔑 ${p.keys}`, 74, 48)
    ctx.fillText(`🪙 ${p.money}`, 132, 48)

    // 右上：层数 / 房间 / 枪械
    const gun = this.currentGun()
    const ammoText = Number.isFinite(gun.ammo) ? `${gun.ammo}/${gun.maxAmmo}` : '∞'
    ctx.textAlign = 'right'
    ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = floor.accent
    ctx.fillText(`${floor.name} · ${room.type === 'boss' ? 'Boss 房' : room.type === 'shop' ? '商店' : room.type === 'treasure' ? '宝库' : '房间'}`, w - 14, 22)
    ctx.fillStyle = '#f8fafc'
    ctx.fillText(`【${gun.name}】 ${ammoText}`, w - 14, 44)
    if (this.isRoomLocked(room)) {
      ctx.fillStyle = '#fca5a5'
      ctx.fillText(`敌人 ${room.enemies.length + (room.boss ? 1 : 0)} · 清空房间开门`, w - 14, 64)
    } else {
      ctx.fillStyle = '#86efac'
      ctx.fillText(`门已开启 · E 互动`, w - 14, 64)
    }

    // 枪械列表右下角？放在左下
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(2,6,23,0.5)'
    ctx.fillRect(10, this.view.h - 38, Math.min(260, this.view.w - 20), 28)
    ctx.font = 'bold 11px sans-serif'
    for (let i = 0; i < this.guns.length; i++) {
      const g = this.guns[i]
      const x = 18 + i * 46
      ctx.fillStyle = i === this.gunIndex ? '#fbbf24' : 'rgba(226,232,240,0.55)'
      ctx.fillText(`${i + 1}.${g.name.slice(0, 4)}`, x, this.view.h - 24)
    }
    ctx.restore()
  }

  drawMinimap(ctx) {
    const size = 120
    const x = this.view.w - size - 14
    const y = this.view.h - size - 14
    const s = size / (ROOM_W * COLS)
    ctx.save()
    ctx.fillStyle = 'rgba(2,6,23,0.75)'
    ctx.fillRect(x - 2, y - 2, size + 4, size + 4)
    const floor = FLOORS[this.floorIndex]
    for (const room of this.rooms) {
      if (!room.visited) continue
      ctx.fillStyle = room === this.currentRoom ? '#ffffff' : room.cleared ? 'rgba(74,222,128,0.65)' : 'rgba(248,250,252,0.35)'
      ctx.fillRect(x + room.x * s, y + room.y * s, Math.max(2, room.w * s - 1), Math.max(2, room.h * s - 1))
      if (room.type === 'boss' && !room.cleared) {
        ctx.fillStyle = '#ef4444'; ctx.fillRect(x + room.x * s + 3, y + room.y * s + 3, 4, 4)
      }
    }
    ctx.strokeStyle = floor.accent; ctx.lineWidth = 1; ctx.strokeRect(x, y, size, size)
    ctx.restore()
  }

  drawBanner(ctx) {
    if (!this.banner) return
    const alpha = clamp(this.banner.t / 0.6, 0, 1)
    ctx.save(); ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(2,6,23,0.55)'
    const bw = Math.min(420, this.view.w - 40); const bh = 56
    ctx.fillRect(this.view.w / 2 - bw / 2, this.view.h * 0.3, bw, bh)
    ctx.fillStyle = '#f8fafc'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(this.banner.name, this.view.w / 2, this.view.h * 0.3 + bh / 2 + 1)
    ctx.restore()
  }

  drawTransition(ctx) {
    if (this.transition <= 0) return
    const a = Math.sin(clamp(this.transition, 0, 1) * Math.PI) * 0.6
    ctx.fillStyle = `rgba(2,6,23,${a.toFixed(3)})`
    ctx.fillRect(0, 0, this.view.w, this.view.h)
  }

  drawCrosshair(ctx) {
    const { x, y } = this.mouse
    if (!this.mouse.inside) return
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 14); ctx.stroke()
    ctx.fillStyle = '#f87171'; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  /* ---------- 存档 / 读档 ---------- */
  snapshot() {
    return {
      version: 2,
      game: 'dungeon',
      seed: this.seed,
      floorIndex: this.floorIndex,
      time: this.time,
      kills: this.kills,
      roomsCleared: this.roomsCleared,
      score: this.score,
      gameSpeed: this.gameSpeed,
      player: {
        ...this.player,
        img: undefined,
      },
      guns: this.guns.map((g) => ({ ...g })),
      gunIndex: this.gunIndex,
      currentRoom: this.currentRoom ? this.currentRoom.index : 0,
      rooms: this.rooms.map((r) => ({
        index: r.index,
        cleared: r.cleared,
        visited: r.visited,
        chests: r.chests.map((c) => ({ ...c })),
        shopItems: r.shopItems.map((i) => ({ ...i })),
        pickups: r.pickups.map((i) => ({ ...i })),
        portal: r.portal ? { ...r.portal } : null,
        enemies: r.enemies.map((e) => ({ ...e })),
        boss: r.boss ? { ...r.boss } : null,
      })),
    }
  }

  loadSnapshot(data) {
    if (!data || data.version !== 2 || data.game !== 'dungeon') return false
    this.seed = data.seed || ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0)
    this.floorIndex = data.floorIndex || 0
    this.time = data.time || 0
    this.kills = data.kills || 0
    this.roomsCleared = data.roomsCleared || 0
    this.score = data.score || 0
    this.gameSpeed = clamp(Number(data.gameSpeed) || 1, 0.5, 2)
    this.player = { ...this.makePlayer(), ...data.player }
    this.player.img = this.pImg
    this.guns = data.guns && data.guns.length ? data.guns.map((g) => ({ ...g })) : [JSON.parse(JSON.stringify(GUNS[0]))]
    this.gunIndex = data.gunIndex || 0
    this.rooms = createFloor(this.floorIndex, this.seed)
    this.currentRoom = this.rooms[Math.min(data.currentRoom || 0, TOTAL_ROOMS - 1)]

    const savedRooms = {}
    for (const sr of data.rooms || []) savedRooms[sr.index] = sr
    for (const room of this.rooms) {
      const sr = savedRooms[room.index]
      if (!sr) continue
      room.cleared = sr.cleared || false
      room.visited = sr.visited || false
      room.chests = Array.isArray(sr.chests) ? sr.chests.map((c) => ({ ...c })) : room.chests
      room.shopItems = Array.isArray(sr.shopItems) ? sr.shopItems.map((i) => ({ ...i })) : room.shopItems
      room.pickups = Array.isArray(sr.pickups) ? sr.pickups.map((i) => ({ ...i })) : []
      room.portal = sr.portal ? { ...sr.portal } : null
      room.enemies = Array.isArray(sr.enemies) ? sr.enemies.map((e) => ({ ...e })) : []
      room.boss = sr.boss ? { ...sr.boss } : null
      if (room.type === 'boss' && !room.cleared && !room.boss) {
        const b = makeBoss(this.floorIndex)
        b.x = room.x + ROOM_W / 2
        b.y = room.y + ROOM_H / 2 - 40
        room.boss = b
      }
      if (room.visited && !room.cleared && !room.enemies.length && !room.boss && room.enemyDefs.length) {
        room.enemies = room.enemyDefs.map((d) => makeEnemy(d.type, d.x, d.y, this.floorIndex))
      }
    }
    this.currentRoom.active = true
    this.enemyBullets = []
    this.bullets = []
    this.particles = []
    this.floaters = []
    this.transition = 0
    this.banner = null
    this.shootT = 0
    this.burstRemaining = 0
    this.burstT = 0
    this.blankPressed = false
    this.state = 'paused'
    return true
  }
}

// 兼容旧引用名：旧“大肥鱼割草”入口若仍引用 MowGame，也映射到新地牢玩法
export const MowGame = DungeonGame
