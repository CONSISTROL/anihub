// 纯 2D 大肥鱼割草引擎：正俯视 2D 视角，无透视。
// 主角使用网站桌宠素材（public/pet）；怪物、地图资源、道具、装饰全部先用 Canvas 矢量图形渲染。
// 玩法：自动攻击 + WASD/方向键移动 + 空格/Shift 冲刺，升级三选一能力卡，小怪/精英/Boss 掉不同品质道具。

export const QUALITY = {
  common: { color: '#9ca3af', label: '普通', heal: 15, dmg: 3, shield: 25 },
  rare: { color: '#60a5fa', label: '稀有', heal: 30, dmg: 7, shield: 50 },
  epic: { color: '#c084fc', label: '史诗', heal: 55, dmg: 15, shield: 80 },
  legendary: { color: '#fbbf24', label: '传奇', heal: 120, dmg: 40, shield: 150 },
}

const ABILITIES = [
  { id: 'dmg', icon: 'sword', name: '攻击强化', desc: '伤害 +25%' },
  { id: 'atkspd', icon: 'flame', name: '攻速提升', desc: '攻击间隔 -18%' },
  { id: 'speed', icon: 'wind', name: '移速提升', desc: '移动速度 +12%' },
  { id: 'hp', icon: 'heart', name: '生命强化', desc: '最大生命 +30 并恢复 30' },
  { id: 'regen', icon: 'heart-plus', name: '生命再生', desc: '每秒恢复 1 点生命' },
  { id: 'multi', icon: 'fork', name: '多重弹幕', desc: '弹体数量 +1' },
  { id: 'pierce', icon: 'crosshair', name: '贯穿弹', desc: '子弹可多穿透 1 个敌人' },
  { id: 'crit', icon: 'star', name: '暴击强化', desc: '暴击率 +12%（2 倍伤害）' },
  { id: 'dashcd', icon: 'zap', name: '冲刺精通', desc: '冲刺冷却 -20%' },
  { id: 'magnet', icon: 'magnet', name: '磁力核心', desc: '拾取范围 +45%' },
  { id: 'lifesteal', icon: 'droplet', name: '吸血', desc: '击杀回复 2 点生命' },
  { id: 'orbital', icon: 'orbit', name: '环绕刃', desc: '增加 1 把环绕飞刃' },
]

const ARENA = { w: 4800, h: 4800 }
const TILE = 48

// 网站桌宠素材：静止使用 idle_front，移动使用 walk_side 循环
const PET = {
  idle: '/pet/idle_front/idle_front_238.png',
  walk: [
    '/pet/walk_side/walk_side_238_00.png',
    '/pet/walk_side/walk_side_238_01.png',
    '/pet/walk_side/walk_side_238_02.png',
    '/pet/walk_side/walk_side_238_03.png',
  ],
}
const PET_FPS = 10

const DECO_KINDS = {
  forest: ['tree', 'tree', 'tree', 'bush', 'bush', 'rock', 'flower'],
  snow: ['pine', 'pine', 'mound', 'ice', 'rock'],
  tower: ['pillar', 'pillar', 'torch', 'rock', 'crystal'],
  abyss: ['spike', 'spike', 'crystal', 'rock', 'monument'],
}

const RESOURCE_COLORS = {
  forest: '#4ade80',
  snow: '#93c5fd',
  tower: '#f472b6',
  abyss: '#a78bfa',
}

const MAX_ENEMIES = 140
const MAX_BULLETS = 260
const MAX_GEMS = 360
const MAX_SHOTS = 240

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

// ---------------- 区域 ----------------
const ZONES = [
  {
    id: 'forest', name: '森林',
    rect: { x: 0, y: 0, w: 2400, h: 2400 },
    base: '#3f7d3a', color: '#4ade80',
    enemy: { hp: 18, speed: [60, 105], dmg: 7, color: '#4ade80' },
    effects: [
      { id: 'heal', text: '生命果：大量恢复', fn: (p, m) => { p.hp = Math.min(p.maxHp, p.hp + m * 1.5) } },
      { id: 'regen', text: '木灵：生命再生提升', fn: (p) => { p.regen += 0.6 } },
    ],
  },
  {
    id: 'snow', name: '雪山',
    rect: { x: 2400, y: 0, w: 2400, h: 2400 },
    base: '#b8c4d8', color: '#e2e8f0',
    enemy: { hp: 22, speed: [70, 115], dmg: 9, color: '#a5b4fc' },
    effects: [
      { id: 'shield', text: '暖玉：护盾增加', fn: (p, m) => { p.shield += m } },
      { id: 'speed', text: '冰靴：移速提升', fn: (p, m) => { p.speed += m } },
    ],
  },
  {
    id: 'tower', name: '魔塔',
    rect: { x: 0, y: 2400, w: 2400, h: 2400 },
    base: '#3a3348', color: '#f87171',
    enemy: { hp: 24, speed: [65, 110], dmg: 10, color: '#f87171' },
    effects: [
      { id: 'dmg', text: '勇者徽章：攻击提升', fn: (p, m) => { p.dmg += m } },
      { id: 'shield', text: '塔盾：护盾增加', fn: (p, m) => { p.shield += m } },
    ],
  },
  {
    id: 'abyss', name: '深渊',
    rect: { x: 2400, y: 2400, w: 2400, h: 2400 },
    base: '#1c1e33', color: '#c084fc',
    enemy: { hp: 28, speed: [55, 95], dmg: 11, color: '#c084fc' },
    effects: [
      { id: 'crit', text: '深渊之眼：暴击提升', fn: (p, m) => { p.crit += 0.06 * m } },
      { id: 'dmg', text: '深渊之力：攻击提升', fn: (p, m) => { p.dmg += m } },
    ],
  },
]

function zoneAt(x, y) {
  if (x < 2400 && y < 2400) return ZONES[0]
  if (x >= 2400 && y < 2400) return ZONES[1]
  if (x < 2400) return ZONES[2]
  return ZONES[3]
}

function zoneIdAt(x, y) {
  return zoneAt(x, y).id
}

// ---------------- 游戏主类 ----------------
export class MowGame {
  constructor(canvas, cb = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.cb = cb
    this.state = 'ready'
    this.choices = null
    this.keys = new Set()
    this.dashKey = false

    this.spawnRate = clamp(Number(cb.spawnRate) || 1, 0.25, 4)

    this.time = 0
    this.kills = 0
    this.score = 0
    this.combo = 0
    this.comboT = 0
    this.level = 1
    this.xp = 0
    this.xpNext = 20

    this.enemies = []
    this.bullets = []
    this.enemyBullets = []
    this.gems = []
    this.items = []
    this.particles = []
    this.boss = null
    this.resources = []

    this.spawnT = 0.4
    this.eliteT = 16
    this.bossT = 45
    this.shake = 0
    this.banner = null
    this.transition = 0

    // 桌宠素材
    this.pImg = typeof Image !== 'undefined' ? new Image() : null
    if (this.pImg) this.pImg.src = PET.idle
    this.petWalk = []
    if (typeof Image !== 'undefined') {
      for (const src of PET.walk) {
        const img = new Image()
        img.src = src
        this.petWalk.push(img)
      }
    }

    this.player = {
      x: ARENA.w / 2,
      y: ARENA.h / 2,
      r: 28,
      speed: 250,
      dmg: 12,
      atkInterval: 0.34,
      atkT: 0,
      bulletSpeed: 480,
      multi: 1,
      pierce: 0,
      crit: 0,
      magnet: 180,
      lifesteal: 0,
      orbitals: 0,
      hp: 100,
      maxHp: 100,
      regen: 0,
      shield: 0,
      iframes: 0,
      dashT: 0,
      dashCd: 0,
      dashDur: 0.16,
      dashCdBase: 1.0,
      dir: 1,
      face: 'down',
      moving: false,
      attackT: 0,
      img: this.pImg,
    }

    this.view = { w: 0, h: 0 }
    this.currentZone = zoneAt(this.player.x, this.player.y)

    this.onKeyDown = this.onKeyDown.bind(this)
    this.onKeyUp = this.onKeyUp.bind(this)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    this.resize()
    window.addEventListener('resize', this.resize)

    this.buildDecorations()
    this.spawnResources()
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
    this.state = 'running'
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('resize', this.resize)
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
    this.spawnRate = clamp(Number(rate) || 1, 0.25, 4)
  }

  onKeyDown(e) {
    // 升级选卡界面由页面层处理键盘（←/→ 选择，Enter/空格 确认），引擎不再响应移动/冲刺键
    if (this.state === 'levelup') return
    const k = e.key.toLowerCase()
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault()
    if (k === ' ' || k === 'shift') {
      if (!this.keys.has('dash')) {
        this.dashKey = true
        this.keys.add('dash')
      }
      return
    }
    if (k === 'escape' || k === 'p') {
      if (this.state === 'running') this.pause(true)
      else if (this.state === 'paused') this.pause(false)
      return
    }
    this.keys.add(k)
  }

  onKeyUp(e) {
    const k = e.key.toLowerCase()
    if (k === ' ' || k === 'shift') {
      this.keys.delete('dash')
      this.dashKey = false
    } else this.keys.delete(k)
  }

  /* ---------- 世界生成 ---------- */
  buildDecorations() {
    this.deco = []
    const plans = [
      { zone: 'forest', n: 55, scale: [0.7, 1.2] },
      { zone: 'snow', n: 45, scale: [0.7, 1.2] },
      { zone: 'tower', n: 40, scale: [0.8, 1.3] },
      { zone: 'abyss', n: 35, scale: [0.8, 1.4] },
    ]
    let seed = 12345
    for (const plan of plans) {
      const z = ZONES.find((x) => x.id === plan.zone)
      const rng = mulberry32(seed++)
      const kinds = DECO_KINDS[plan.zone]
      for (let i = 0; i < plan.n; i++) {
        const x = z.rect.x + 80 + rng() * (z.rect.w - 160)
        const y = z.rect.y + 80 + rng() * (z.rect.h - 160)
        if (dist2(x, y, ARENA.w / 2, ARENA.h / 2) < 220 * 220) continue
        this.deco.push({
          x, y,
          kind: kinds[Math.floor(rng() * kinds.length)],
          scale: rand(plan.scale[0], plan.scale[1]),
          zone: z.id,
        })
      }
    }
    // 少量矢量纪念碑作为地标
    const spots = [
      { x: 1200, y: 1200 }, { x: 3600, y: 1200 }, { x: 1200, y: 3600 }, { x: 3600, y: 3600 },
    ]
    spots.forEach((s) => {
      this.deco.push({ x: s.x, y: s.y, kind: 'monument', scale: 1.1, zone: zoneIdAt(s.x, s.y) })
    })
  }

  spawnResources() {
    this.resources = []
    const per = [6, 5, 5, 6]
    let seed = 777
    ZONES.forEach((z, zi) => {
      const rng = mulberry32(seed++)
      for (let i = 0; i < per[zi]; i++) {
        const x = z.rect.x + 120 + rng() * (z.rect.w - 240)
        const y = z.rect.y + 120 + rng() * (z.rect.h - 240)
        if (dist2(x, y, ARENA.w / 2, ARENA.h / 2) < 200 * 200) continue
        this.resources.push({
          x, y, zone: z.id, active: true, respawnT: 0,
          color: RESOURCE_COLORS[z.id],
        })
      }
    })
  }

  setBanner(name) {
    this.banner = { name, t: 2.2 }
    this.transition = 1
  }

  /* ---------- 更新 ---------- */
  loop = (now) => {
    this.raf = requestAnimationFrame(this.loop)
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    if (this.state === 'running') this.update(dt)
    this.render()
  }

  update(dt) {
    this.time += dt
    const z = zoneAt(this.player.x, this.player.y)
    if (z !== this.currentZone) {
      this.currentZone = z
      // 只保留自然的淡入淡出转场，不弹出场景名横幅
      this.transition = 1
    }
    if (this.banner) {
      this.banner.t -= dt
      if (this.banner.t <= 0) this.banner = null
    }
    if (this.transition > 0) this.transition = Math.max(0, this.transition - dt * 1.6)
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30)

    if (this.comboT > 0) {
      this.comboT -= dt
      if (this.comboT <= 0) this.combo = 0
    }

    this.updatePlayer(dt)
    this.updateSpawning(dt)
    this.updateEnemies(dt)
    this.updateBullets(dt)
    this.updateEnemyBullets(dt)
    this.updateOrbitals(dt)
    this.updateGems(dt)
    this.updateItems(dt)
    this.updateResources(dt)
    this.updateParticles(dt)
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
      if (Math.abs(dy) >= Math.abs(dx)) {
        p.face = dy < 0 ? 'up' : 'down'
      } else {
        p.face = dx < 0 ? 'left' : 'right'
      }
    }

    p.dashCd = Math.max(0, p.dashCd - dt)
    if (this.dashKey && p.dashCd <= 0 && moving) {
      this.dashKey = false
      p.dashT = p.dashDur
      p.dashCd = p.dashCdBase
      p.iframes = Math.max(p.iframes, p.dashDur + 0.12)
      this.shake = 3
      this.burst(p.x, p.y, '#7dd3fc', 8)
    } else if (!this.dashKey) {
      this.dashKey = false
    }

    const spd = p.dashT > 0 ? 820 : p.speed
    p.x = clamp(p.x + dx * spd * dt, p.r, ARENA.w - p.r)
    p.y = clamp(p.y + dy * spd * dt, p.r, ARENA.h - p.r)
    if (p.dashT > 0) {
      p.dashT -= dt
      this.particles.push({ x: p.x, y: p.y, vx: -dx * 90, vy: -dy * 90, life: 0.3, max: 0.3, r: 6, color: '#7dd3fc' })
    }
    p.iframes = Math.max(0, p.iframes - dt)
    p.attackT = Math.max(0, p.attackT - dt)
    if (p.hp > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt)

    // 自动攻击
    p.atkT -= dt
    if (p.atkT <= 0) {
      const candidates = this.boss && this.boss.hp > 0 ? [this.boss, ...this.enemies] : this.enemies
      let target = null
      let best = 560 * 560
      for (const e of candidates) {
        const d = dist2(p.x, p.y, e.x, e.y)
        if (d < best) {
          best = d
          target = e
        }
      }
      if (target && this.bullets.length < MAX_BULLETS) {
        const base = Math.atan2(target.y - p.y, target.x - p.x)
        const spread = p.multi > 1 ? 0.2 : 0
        for (let i = 0; i < p.multi; i++) {
          const ang = base + (i - (p.multi - 1) / 2) * spread
          this.bullets.push({
            x: p.x, y: p.y, vx: Math.cos(ang) * p.bulletSpeed, vy: Math.sin(ang) * p.bulletSpeed,
            r: 7, dmg: p.dmg, crit: Math.random() < p.crit, life: 1.3, pierce: p.pierce, hit: new Set(),
          })
        }
        p.atkT = p.atkInterval
        p.attackT = 0.22
      } else {
        p.atkT = 0.05
      }
    }
  }

  updateSpawning(dt) {
    this.spawnT -= dt
    if (this.spawnT <= 0 && this.enemies.length < MAX_ENEMIES) {
      this.spawnT = Math.max(0.08, (1.0 - this.time * 0.0012) / this.spawnRate)
      const n = 1 + Math.floor(this.time / 30)
      for (let i = 0; i < n; i++) this.spawnEnemy()
    }
    this.eliteT -= dt
    if (this.eliteT <= 0) {
      this.eliteT = Math.max(10, 18 - this.time * 0.01) / this.spawnRate
      this.spawnEnemy('elite')
    }
    this.bossT -= dt
    if (this.bossT <= 0) {
      this.bossT = Math.max(30, 50 - this.time * 0.02) / this.spawnRate
      this.spawnBoss()
    }
  }

  spawnEnemy(type = 'normal') {
    if (this.enemies.length >= MAX_ENEMIES) return
    const z = this.currentZone
    const cfg = z.enemy
    let def
    if (type === 'elite') {
      def = {
        type, r: 30,
        hp: cfg.hp * 7, speed: rand(cfg.speed[0] + 18, cfg.speed[1] + 18), dmg: cfg.dmg * 2.5,
        xp: 18, scale: 1.4, shootT: rand(1, 2), shootCd: 2.4,
      }
    } else {
      const roll = Math.random()
      if (roll < 0.12) {
        def = {
          type: 'tank', r: 30,
          hp: cfg.hp * 3.2, speed: rand(35, 55), dmg: cfg.dmg * 1.8,
          xp: 6, scale: 1.3,
        }
      } else if (roll < 0.28) {
        def = {
          type: 'fast', r: 20,
          hp: cfg.hp * 0.65, speed: rand(cfg.speed[1] + 25, cfg.speed[1] + 70), dmg: cfg.dmg * 0.8,
          xp: 3, scale: 1.0,
        }
      } else {
        def = {
          type: 'normal', r: 18,
          hp: cfg.hp, speed: rand(cfg.speed[0], cfg.speed[1]), dmg: cfg.dmg,
          xp: 2, scale: 0.9,
        }
      }
    }
    const a = Math.random() * Math.PI * 2
    const dist = Math.max(this.view.w, this.view.h) * 0.7
    const x = clamp(this.player.x + Math.cos(a) * dist, 40, ARENA.w - 40)
    const y = clamp(this.player.y + Math.sin(a) * dist, 40, ARENA.h - 40)
    this.enemies.push({
      x, y, r: def.r, hp: def.hp * (1 + this.time / 90), maxHp: def.hp * (1 + this.time / 90),
      speed: def.speed, dmg: def.dmg, xp: def.xp, type: def.type,
      scale: def.scale, hitT: 0, shootT: def.shootT || 0, shootCd: def.shootCd || 0,
      color: cfg.color,
    })
  }

  spawnBoss() {
    if (this.boss || this.enemies.length > 90) return
    const z = this.currentZone
    const a = Math.random() * Math.PI * 2
    const dist = Math.max(this.view.w, this.view.h) * 0.7
    const hp = 1800 * (1 + this.time / 80)
    this.boss = {
      x: clamp(this.player.x + Math.cos(a) * dist, 60, ARENA.w - 60),
      y: clamp(this.player.y + Math.sin(a) * dist, 60, ARENA.h - 60),
      r: 58, hp, maxHp: hp, speed: 62, dmg: 42, xp: 120,
      scale: 1.8, hitT: 0, color: z.enemy.color,
      shootT: 2, shootCd: 2.6, phase: 1,
    }
  }

  updateEnemies(dt) {
    const p = this.player
    const all = this.boss ? [...this.enemies, this.boss] : this.enemies
    for (const e of all) {
      const dx = p.x - e.x
      const dy = p.y - e.y
      const d = Math.hypot(dx, dy) || 1
      const spd = e.type === 'fast' && e.hp < e.maxHp * 0.3 ? e.speed * 1.25 : e.speed
      e.x = clamp(e.x + (dx / d) * spd * dt, 20, ARENA.w - 20)
      e.y = clamp(e.y + (dy / d) * spd * dt, 20, ARENA.h - 20)
      if (e.hitT > 0) e.hitT -= dt

      // 远程敌人 / Boss 攻击
      if ((e.type === 'elite' || e.type === 'boss') && d < 460) {
        e.shootT -= dt
        if (e.shootT <= 0 && this.enemyBullets.length < MAX_SHOTS) {
          e.shootT = e.shootCd
          if (e.type === 'boss') {
            for (let i = 0; i < 8; i++) {
              const ang = (Math.PI * 2 * i) / 8 + this.time * 0.7
              this.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 180, vy: Math.sin(ang) * 180, r: 9, dmg: e.dmg * 0.7, life: 3.5 })
            }
          } else {
            const ang = Math.atan2(p.y - e.y, p.x - e.x)
            this.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang) * 220, vy: Math.sin(ang) * 220, r: 7, dmg: e.dmg * 0.8, life: 3 })
          }
          this.burst(e.x, e.y, '#f87171', 6)
        }
      }

      // 接触伤害
      if (p.iframes <= 0 && d < e.r + p.r) {
        this.hurtPlayer(e.dmg)
        p.iframes = 0.6
        this.shake = 9
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0)
    if (this.boss && this.boss.hp <= 0) {
      this.onBossKilled()
      this.boss = null
    }
  }

  hurtPlayer(amount) {
    const p = this.player
    if (p.shield > 0) {
      const absorbed = Math.min(p.shield, amount)
      p.shield -= absorbed
      amount -= absorbed
    }
    p.hp -= amount
    if (p.hp <= 0) {
      p.hp = 0
      this.state = 'dead'
      this.cb.onGameOver?.({ time: Math.floor(this.time), kills: this.kills, level: this.level, score: this.score })
    }
  }

  updateBullets(dt) {
    const p = this.player
    for (const b of this.bullets) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      const targets = this.boss && this.boss.hp > 0 ? [this.boss, ...this.enemies] : this.enemies
      for (const e of targets) {
        if (e.hp <= 0 || b.hit.has(e)) continue
        if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) * (e.r + b.r)) {
          const dmg = b.crit ? b.dmg * 2 : b.dmg
          e.hp -= dmg
          e.hitT = 0.1
          b.hit.add(e)
          this.particles.push({ x: b.x, y: b.y, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.25, max: 0.25, r: b.crit ? 8 : 5, color: b.crit ? '#fbbf24' : '#93c5fd' })
          if (e.hp <= 0 && e !== this.boss) this.onEnemyKilled(e)
          if (b.pierce > 0) {
            b.pierce--
            b.dmg *= 0.85
            b.life = Math.min(b.life, 0.35)
            continue
          }
          b.life = 0
          break
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0)
  }

  updateEnemyBullets(dt) {
    const p = this.player
    for (const b of this.enemyBullets) {
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.life -= dt
      if (p.iframes <= 0 && dist2(b.x, b.y, p.x, p.y) < (p.r + b.r) * (p.r + b.r)) {
        this.hurtPlayer(b.dmg)
        p.iframes = 0.5
        this.shake = 6
        b.life = 0
        this.burst(b.x, b.y, '#ef4444', 6)
      }
    }
    this.enemyBullets = this.enemyBullets.filter((b) => b.life > 0 && b.x > -50 && b.x < ARENA.w + 50 && b.y > -50 && b.y < ARENA.h + 50)
  }

  orbitalBlades(p) {
    const blades = []
    for (let i = 0; i < p.orbitals; i++) {
      const ang = this.time * 3 + (Math.PI * 2 * i) / p.orbitals
      blades.push({
        x: p.x + Math.cos(ang) * 62,
        y: p.y + Math.sin(ang) * 62,
        ang,
      })
    }
    return blades
  }

  updateOrbitals(dt) {
    const p = this.player
    if (!p.orbitals) return
    const targets = this.boss && this.boss.hp > 0 ? [this.boss, ...this.enemies] : this.enemies
    const blades = this.orbitalBlades(p)
    for (const b of blades) {
      this.particles.push({ x: b.x, y: b.y, text: '', color: '#22d3ee', life: 0.08, max: 0.08, r: 3 })
      for (const e of targets) {
        if (e.hp <= 0) continue
        if (dist2(b.x, b.y, e.x, e.y) < (e.r + 16) * (e.r + 16)) {
          e.hp -= p.dmg * 0.5
          e.hitT = 0.1
          this.particles.push({ x: b.x, y: b.y, vx: rand(-30, 30), vy: rand(-30, 30), life: 0.2, max: 0.2, r: 4, color: '#22d3ee' })
          if (e.hp <= 0 && e !== this.boss) this.onEnemyKilled(e)
        }
      }
    }
  }

  onEnemyKilled(e) {
    this.kills++
    this.combo++
    this.comboT = 2.5
    const mult = 1 + Math.min(5, Math.floor(this.combo / 10)) * 0.5
    this.score += Math.round((e.type === 'elite' ? 30 : e.type === 'tank' ? 20 : e.type === 'fast' ? 15 : 10) * mult)
    this.spawnGem(e.x, e.y, e.xp)
    if (this.player.lifesteal > 0) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.lifesteal)
      this.floatText(e.x, e.y - 20, `+${this.player.lifesteal}`, '#f87171')
    }
    if (e.type === 'normal') {
      if (Math.random() < 0.09) this.spawnItem(e.x, e.y, 'common', zoneIdAt(e.x, e.y))
    } else if (e.type === 'fast') {
      if (Math.random() < 0.12) this.spawnItem(e.x, e.y, 'common', zoneIdAt(e.x, e.y))
    } else if (e.type === 'tank') {
      if (Math.random() < 0.2) this.spawnItem(e.x, e.y, Math.random() < 0.5 ? 'rare' : 'common', zoneIdAt(e.x, e.y))
    } else if (e.type === 'elite') {
      this.spawnItem(e.x, e.y, Math.random() < 0.6 ? 'rare' : 'epic', zoneIdAt(e.x, e.y))
    }
    this.burst(e.x, e.y, e.color, 10)
  }

  onBossKilled() {
    this.kills++
    this.combo += 5
    this.comboT = 3
    this.score += 500
    this.spawnGem(this.boss.x, this.boss.y, this.boss.xp)
    this.spawnItem(this.boss.x, this.boss.y, 'legendary', zoneIdAt(this.boss.x, this.boss.y))
    this.burst(this.boss.x, this.boss.y, this.boss.color, 32)
    this.shake = 14
    this.setBanner('Boss 已击破！')
  }

  spawnGem(x, y, amount) {
    if (this.gems.length >= MAX_GEMS) return
    this.gems.push({ x, y, amount, dead: false, vx: rand(-40, 40), vy: rand(-40, 40) })
  }

  updateGems(dt) {
    const p = this.player
    const magnetR = p.magnet
    for (const g of this.gems) {
      const d2 = dist2(g.x, g.y, p.x, p.y)
      if (d2 < magnetR * magnetR) {
        const d = Math.sqrt(d2) || 1
        g.x += ((p.x - g.x) / d) * 520 * dt
        g.y += ((p.y - g.y) / d) * 520 * dt
      } else {
        g.x += g.vx * dt
        g.y += g.vy * dt
        g.vx *= 0.9
        g.vy *= 0.9
      }
      // 用移动后的位置判断拾取，避免“看起来没吃到”
      if (dist2(g.x, g.y, p.x, p.y) < p.r * p.r) {
        this.gainXp(g.amount)
        g.dead = true
      }
    }
    this.gems = this.gems.filter((g) => !g.dead)
  }

  gainXp(amount) {
    this.xp += amount
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext
      this.level++
      this.xpNext = 20 + this.level * 15
      this.levelUp()
    }
  }

  levelUp() {
    this.state = 'levelup'
    const pool = ABILITIES.slice()
    const choices = []
    while (choices.length < 3 && pool.length) {
      choices.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
    }
    this.choices = choices
    this.cb.onLevelUp?.(choices)
  }

  chooseAbility(i) {
    const c = this.choices?.[i]
    if (!c) return
    const p = this.player
    switch (c.id) {
      case 'dmg': p.dmg *= 1.25; break
      case 'atkspd': p.atkInterval *= 0.82; break
      case 'speed': p.speed *= 1.12; break
      case 'hp': p.maxHp += 30; p.hp = Math.min(p.maxHp, p.hp + 30); break
      case 'regen': p.regen += 1; break
      case 'multi': p.multi += 1; break
      case 'pierce': p.pierce += 1; break
      case 'crit': p.crit += 0.12; break
      case 'dashcd': p.dashCdBase *= 0.8; break
      case 'magnet': p.magnet *= 1.45; break
      case 'lifesteal': p.lifesteal += 2; break
      case 'orbital': p.orbitals += 1; break
    }
    this.choices = null
    this.state = 'running'
  }

  /* ---------- 存档 / 读档 ---------- */
  snapshot() {
    const p = { ...this.player }
    delete p.img
    return {
      version: 1,
      state: this.state,
      spawnRate: this.spawnRate,
      time: this.time,
      kills: this.kills,
      score: this.score,
      combo: this.combo,
      comboT: this.comboT,
      level: this.level,
      xp: this.xp,
      xpNext: this.xpNext,
      spawnT: this.spawnT,
      eliteT: this.eliteT,
      bossT: this.bossT,
      player: p,
      enemies: this.enemies.map((e) => ({ ...e })),
      bullets: this.bullets.map((b) => ({ ...b, hit: [] })),
      enemyBullets: this.enemyBullets.map((b) => ({ ...b })),
      items: this.items.map((i) => ({
        x: i.x, y: i.y, quality: i.quality, color: i.color,
        zone: i.zone, effectId: i.effectId, text: i.text,
      })),
      gems: this.gems.map((g) => ({ ...g })),
      resources: this.resources.map((r) => ({ ...r })),
      boss: this.boss ? { ...this.boss } : null,
      choices: this.choices ? this.choices.map((c) => ({ ...c })) : null,
    }
  }

  loadSnapshot(data) {
    if (!data) return
    // 从存档恢复时统一先进入暂停态；调用方再通过 start()/pause(false) 继续
    this.state = data.state === 'levelup' ? 'levelup' : 'paused'
    this.choices = data.screen === 'levelup' && Array.isArray(data.choices) ? data.choices.map((c) => ({ ...c })) : null
    this.spawnRate = clamp(Number(data.spawnRate) || 1, 0.25, 4)
    this.time = Number(data.time) || 0
    this.kills = Number(data.kills) || 0
    this.score = Number(data.score) || 0
    this.combo = Number(data.combo) || 0
    this.comboT = Number(data.comboT) || 0
    this.level = Number(data.level) || 1
    this.xp = Number(data.xp) || 0
    this.xpNext = Number(data.xpNext) || 20
    this.spawnT = Number.isFinite(data.spawnT) ? data.spawnT : 0.4
    this.eliteT = Number.isFinite(data.eliteT) ? data.eliteT : 16
    this.bossT = Number.isFinite(data.bossT) ? data.bossT : 45

    const p = { ...this.player, ...(data.player || {}) }
    delete p.img
    p.img = this.pImg
    this.player = p

    this.enemies = Array.isArray(data.enemies) ? data.enemies.map((e) => ({ ...e })) : []
    this.bullets = Array.isArray(data.bullets) ? data.bullets.map((b) => ({ ...b, hit: new Set() })) : []
    this.enemyBullets = Array.isArray(data.enemyBullets) ? data.enemyBullets.map((b) => ({ ...b })) : []
    this.items = Array.isArray(data.items) ? data.items.map((i) => ({
      ...i,
      bobT: Math.random() * 6,
      fn: null,
    })) : []
    this.gems = Array.isArray(data.gems) ? data.gems.map((g) => ({ ...g })) : []
    this.resources = Array.isArray(data.resources) ? data.resources.map((r) => ({ ...r })) : this.resources
    this.boss = data.boss ? { ...data.boss } : null

    this.particles = []
    this.banner = null
    this.transition = 0
    this.shake = 0
    this.dashKey = false
    this.keys.clear()
    this.currentZone = zoneAt(this.player.x, this.player.y)
  }

  spawnItem(x, y, quality, zoneId) {
    if (this.items.length > 60) return
    const def = QUALITY[quality]
    const z = ZONES.find((zz) => zz.id === zoneId) || ZONES[0]
    const eff = z.effects[Math.floor(Math.random() * z.effects.length)]
    this.items.push({
      x, y, quality, color: def.color, zone: zoneId, effectId: eff.id, text: eff.text, fn: eff.fn,
      bobT: Math.random() * 6,
    })
  }

  updateItems(dt) {
    const p = this.player
    for (const it of this.items) {
      it.bobT += dt
      if (dist2(it.x, it.y, p.x, p.y) < (p.r + 18) * (p.r + 18)) {
        const def = QUALITY[it.quality]
        let txt = ''
        const m = def.dmg
        if (it.effectId === 'heal') {
          p.hp = Math.min(p.maxHp, p.hp + def.heal * 1.5)
          txt = `+${def.heal * 1.5} HP`
        } else if (it.effectId === 'dmg') {
          p.dmg += m
          txt = `+${m} 攻击`
        } else if (it.effectId === 'shield') {
          p.shield += def.shield
          txt = `+${def.shield} 护盾`
        } else if (it.effectId === 'regen') {
          p.regen += 0.6
          txt = '生命再生 +'
        } else if (it.effectId === 'crit') {
          p.crit += 0.06 * m
          txt = '暴击 +'
        } else if (it.effectId === 'speed') {
          p.speed += m * 5
          txt = '移速 +'
        } else {
          p.dmg += m
          p.maxHp += 20 * (m / 3)
          p.hp = Math.min(p.maxHp, p.hp + 20 * (m / 3))
          txt = '全属性 +'
        }
        txt += `（${it.text}）`
        this.floatText(it.x, it.y - 20, txt, def.color)
        it.dead = true
      }
    }
    this.items = this.items.filter((i) => !i.dead)
  }

  updateResources(dt) {
    const p = this.player
    for (const r of this.resources) {
      if (!r.active) {
        r.respawnT -= dt
        if (r.respawnT <= 0) r.active = true
        continue
      }
      if (dist2(r.x, r.y, p.x, p.y) < 48 * 48) {
        r.active = false
        r.respawnT = 25
        const roll = Math.random()
        const q = roll < 0.4 ? 'common' : roll < 0.7 ? 'rare' : roll < 0.9 ? 'epic' : 'legendary'
        this.spawnItem(r.x, r.y, q, r.zone)
        this.floatText(r.x, r.y - 26, '资源！', '#67e8f9')
        this.burst(r.x, r.y, '#67e8f9', 12)
      }
    }
  }

  burst(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = rand(40, 160)
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.2, 0.5), max: 0.5, r: rand(2, 5), color })
    }
  }

  floatText(x, y, text, color) {
    this.particles.push({ x, y, text, color, life: 1.4, max: 1.4, vx: 0, vy: -36 })
  }

  updateParticles(dt) {
    for (const pt of this.particles) {
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
      pt.life -= dt
    }
    this.particles = this.particles.filter((p) => p.life > 0)
  }

  /* ================= 纯 2D 矢量渲染 ================= */
  render() {
    const ctx = this.ctx
    const { w, h } = this.view
    const shakeX = this.shake > 0 ? rand(-2, 2) : 0
    const shakeY = this.shake > 0 ? rand(-2, 2) : 0
    ctx.save()
    ctx.fillStyle = '#0b1020'
    ctx.fillRect(0, 0, w, h)

    const camX = clamp(this.player.x - w / 2, 0, ARENA.w - w) + shakeX
    const camY = clamp(this.player.y - h / 2, 0, ARENA.h - h) + shakeY
    this.camX = camX
    this.camY = camY

    this.drawGround(ctx, camX, camY)
    this.drawWorld(ctx, camX, camY)
    this.drawTransition(ctx)
    this.drawHud(ctx)
    this.drawMinimap(ctx)
    this.drawBanner(ctx)
    ctx.restore()
  }

  drawGround(ctx, camX, camY) {
    const { w, h } = this.view
    // 可见世界范围
    const x0 = Math.max(0, Math.floor(camX / TILE) * TILE)
    const y0 = Math.max(0, Math.floor(camY / TILE) * TILE)
    const x1 = Math.min(ARENA.w, camX + w + TILE)
    const y1 = Math.min(ARENA.h, camY + h + TILE)
    for (let ty = Math.floor(y0 / TILE); ty * TILE < y1; ty++) {
      for (let tx = Math.floor(x0 / TILE); tx * TILE < x1; tx++) {
        const px = tx * TILE + TILE / 2
        const py = ty * TILE + TILE / 2
        const z = zoneAt(px, py)
        const rnd = (tx * 7919 + ty * 104729) % 100 / 100
        ctx.fillStyle = rnd > 0.92 ? shadeColor(z.base, 1.25) : z.base
        ctx.fillRect(tx * TILE - camX, ty * TILE - camY, TILE, TILE)
        if (rnd > 0.84) {
          ctx.fillStyle = 'rgba(255,255,255,0.06)'
          ctx.fillRect(tx * TILE - camX + 4, ty * TILE - camY + 4, TILE - 8, TILE - 8)
        }
      }
    }
    // 区域边界线
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(2400 - camX, 0)
    ctx.lineTo(2400 - camX, h)
    ctx.moveTo(0, 2400 - camY)
    ctx.lineTo(w, 2400 - camY)
    ctx.stroke()
  }

  drawWorld(ctx, camX, camY) {
    const list = []
    for (const d of this.deco) this.pushDeco(list, d, camX, camY)
    for (const r of this.resources) {
      if (r.active) this.pushResource(list, r, camX, camY)
    }
    for (const it of this.items) this.pushItem(list, it, camX, camY)
    for (const g of this.gems) {
      const pulse = 0.7 + Math.sin(performance.now() / 200 + g.x) * 0.2
      this.pushGem(list, g.x, g.y, 5 * pulse, '#67e8f9', g.y)
    }
    for (const e of this.enemies) this.pushEnemy(list, e, camX, camY)
    if (this.boss) {
      const b = this.boss
      this.pushEnemy(list, b, camX, camY)
      // Boss 血条
      const bw = 90
      this.bar(ctx, b.x - camX - bw / 2, b.y - camY - b.r * 1.8, bw, 6, b.hp / b.maxHp, '#f87171', '#7f1d1d')
    }
    const p = this.player
    this.pushPlayer(list, p)
    if (p.orbitals) {
      for (const b of this.orbitalBlades(p)) this.pushBlade(list, b.x, b.y, b.ang, p.y)
    }
    for (const b of this.bullets) {
      this.pushCircle(list, b.x, b.y, b.r * (b.crit ? 0.9 : 0.7), b.crit ? '#fbbf24' : '#bfdbfe', b.y)
    }
    for (const b of this.enemyBullets) {
      this.pushCircle(list, b.x, b.y, b.r, '#f87171', b.y)
    }
    for (const pt of this.particles) {
      if (pt.text) this.pushText(list, pt.x, pt.y, pt.text, pt.color, pt.life / pt.max)
      else this.pushCircle(list, pt.x, pt.y, pt.r, pt.color, pt.y, pt.life / pt.max)
    }
    list.sort((a, b) => a.y - b.y)
    for (const it of list) it.draw(ctx, camX, camY)
  }

  pushDeco(list, d, camX, camY) {
    list.push({
      y: d.y,
      draw: (ctx, cx, cy) => this.drawDeco(ctx, d, cx, cy),
    })
  }

  pushResource(list, r, camX, camY) {
    list.push({
      y: r.y,
      draw: (ctx, cx, cy) => this.drawResource(ctx, r, cx, cy),
    })
  }

  pushItem(list, it, camX, camY) {
    list.push({
      y: it.y,
      draw: (ctx, cx, cy) => this.drawItem(ctx, it, cx, cy),
    })
  }

  pushEnemy(list, e, camX, camY) {
    list.push({
      y: e.y,
      draw: (ctx, cx, cy) => this.drawEnemy(ctx, e, cx, cy),
    })
  }

  pushBlade(list, x, y, angle, sortY) {
    list.push({
      y: sortY,
      draw: (ctx, camX, camY) => this.drawBlade(ctx, x - camX, y - camY, angle),
    })
  }

  drawBlade(ctx, sx, sy, angle) {
    if (sx < -80 || sx > this.view.w + 80 || sy < -80 || sy > this.view.h + 80) return
    ctx.save()
    ctx.translate(sx, sy)
    ctx.rotate(angle)
    ctx.shadowColor = '#22d3ee'
    ctx.shadowBlur = 10
    ctx.fillStyle = '#22d3ee'
    ctx.beginPath()
    ctx.moveTo(14, 0)
    ctx.quadraticCurveTo(0, -8, -14, 0)
    ctx.quadraticCurveTo(0, 8, 14, 0)
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = '#a5f3fc'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(14, 0)
    ctx.quadraticCurveTo(0, -8, -14, 0)
    ctx.stroke()
    ctx.restore()
  }

  pushCircle(list, x, y, r, color, sortY, alpha = 1) {
    list.push({
      y: sortY,
      draw: (ctx, camX, camY) => {
        const sx = x - camX
        const sy = y - camY
        if (sx < -50 || sx > this.view.w + 50 || sy < -50 || sy > this.view.h + 50) return
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(sx, sy, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      },
    })
  }

  pushGem(list, x, y, r, color, sortY, alpha = 1) {
    list.push({
      y: sortY,
      draw: (ctx, camX, camY) => {
        const sx = x - camX
        const sy = y - camY
        if (sx < -50 || sx > this.view.w + 50 || sy < -50 || sy > this.view.h + 50) return
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(sx, sy)
        // 菱形经验宝石 + 高光
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(0, -r * 1.5)
        ctx.lineTo(r, 0)
        ctx.lineTo(0, r * 1.5)
        ctx.lineTo(-r, 0)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.beginPath()
        ctx.moveTo(0, -r * 0.7)
        ctx.lineTo(r * 0.55, 0)
        ctx.lineTo(0, r * 0.7)
        ctx.lineTo(-r * 0.55, 0)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      },
    })
  }

  pushText(list, x, y, text, color, alpha) {
    list.push({
      y,
      draw: (ctx, camX, camY) => {
        const sx = x - camX
        const sy = y - camY
        ctx.save()
        ctx.globalAlpha = clamp(alpha, 0, 1)
        ctx.fillStyle = color
        ctx.font = 'bold 14px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(text, sx, sy)
        ctx.restore()
      },
    })
  }

  drawDeco(ctx, d, camX, camY) {
    const sx = d.x - camX
    const sy = d.y - camY
    if (sx < -200 || sx > this.view.w + 200 || sy < -200 || sy > this.view.h + 200) return
    ctx.save()
    ctx.translate(sx, sy)
    ctx.scale(d.scale, d.scale)
    const z = d.zone
    switch (d.kind) {
      case 'tree':
        ctx.fillStyle = '#7c5a3a'
        ctx.fillRect(-6, -24, 12, 28)
        ctx.fillStyle = z === 'snow' ? '#e2e8f0' : '#3f9142'
        ctx.beginPath()
        ctx.moveTo(0, -72)
        ctx.lineTo(-34, -12)
        ctx.lineTo(34, -12)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = z === 'snow' ? '#f8fafc' : '#34a853'
        ctx.beginPath()
        ctx.moveTo(0, -50)
        ctx.lineTo(-26, -2)
        ctx.lineTo(26, -2)
        ctx.closePath()
        ctx.fill()
        break
      case 'pine':
        ctx.fillStyle = '#6b4f3a'
        ctx.fillRect(-5, -20, 10, 24)
        ctx.fillStyle = '#dbeafe'
        ctx.beginPath()
        ctx.moveTo(0, -66)
        ctx.lineTo(-30, -8)
        ctx.lineTo(30, -8)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#bfdbfe'
        ctx.beginPath()
        ctx.moveTo(0, -44)
        ctx.lineTo(-22, 2)
        ctx.lineTo(22, 2)
        ctx.closePath()
        ctx.fill()
        break
      case 'bush':
        ctx.fillStyle = '#2f7d32'
        ctx.beginPath()
        ctx.arc(-10, -10, 12, 0, Math.PI * 2)
        ctx.arc(10, -12, 14, 0, Math.PI * 2)
        ctx.arc(0, -4, 13, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#4ade80'
        ctx.beginPath()
        ctx.arc(0, -16, 6, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'flower':
        ctx.strokeStyle = '#2f7d32'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -14)
        ctx.stroke()
        ctx.fillStyle = '#f9a8d4'
        for (let i = 0; i < 5; i++) {
          const a = (Math.PI * 2 * i) / 5
          ctx.beginPath()
          ctx.arc(Math.cos(a) * 7, -18 + Math.sin(a) * 7, 5, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = '#fbbf24'
        ctx.beginPath()
        ctx.arc(0, -18, 4, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'rock':
        ctx.fillStyle = '#94a3b8'
        ctx.beginPath()
        ctx.moveTo(-14, 0)
        ctx.lineTo(-8, -18)
        ctx.lineTo(10, -20)
        ctx.lineTo(16, 0)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.18)'
        ctx.beginPath()
        ctx.moveTo(-6, -16)
        ctx.lineTo(2, -18)
        ctx.lineTo(0, -4)
        ctx.lineTo(-8, -4)
        ctx.closePath()
        ctx.fill()
        break
      case 'mound':
        ctx.fillStyle = '#f1f5f9'
        ctx.beginPath()
        ctx.ellipse(0, -6, 24, 12, 0, Math.PI, 0)
        ctx.fill()
        ctx.fillStyle = '#e2e8f0'
        ctx.beginPath()
        ctx.ellipse(-8, -8, 10, 6, 0, Math.PI, 0)
        ctx.fill()
        break
      case 'ice':
        ctx.fillStyle = '#a5f3fc'
        ctx.beginPath()
        ctx.moveTo(0, -26)
        ctx.lineTo(12, 0)
        ctx.lineTo(0, 10)
        ctx.lineTo(-12, 0)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.8)'
        ctx.beginPath()
        ctx.moveTo(0, -14)
        ctx.lineTo(5, 0)
        ctx.lineTo(0, 6)
        ctx.lineTo(-5, 0)
        ctx.closePath()
        ctx.fill()
        break
      case 'pillar':
        ctx.fillStyle = '#4c1d95'
        ctx.fillRect(-12, -34, 24, 38)
        ctx.fillStyle = '#7c3aed'
        ctx.fillRect(-15, -38, 30, 8)
        ctx.fillStyle = 'rgba(255,255,255,0.2)'
        ctx.fillRect(-6, -34, 5, 34)
        break
      case 'torch':
        ctx.fillStyle = '#57534e'
        ctx.fillRect(-3, -22, 6, 24)
        ctx.fillStyle = '#fbbf24'
        ctx.beginPath()
        ctx.moveTo(0, -34)
        ctx.lineTo(-9, -18)
        ctx.lineTo(9, -18)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = 'rgba(251,191,36,0.25)'
        ctx.beginPath()
        ctx.arc(0, -22, 18, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'crystal':
        ctx.fillStyle = z === 'abyss' ? '#a78bfa' : '#f472b6'
        ctx.beginPath()
        ctx.moveTo(0, -30)
        ctx.lineTo(10, -6)
        ctx.lineTo(6, 8)
        ctx.lineTo(-6, 8)
        ctx.lineTo(-10, -6)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.beginPath()
        ctx.moveTo(0, -18)
        ctx.lineTo(4, -4)
        ctx.lineTo(0, 2)
        ctx.lineTo(-4, -4)
        ctx.closePath()
        ctx.fill()
        break
      case 'spike':
        ctx.fillStyle = '#4c1d95'
        ctx.beginPath()
        ctx.moveTo(0, -30)
        ctx.lineTo(14, 4)
        ctx.lineTo(-14, 4)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#7c3aed'
        ctx.beginPath()
        ctx.moveTo(0, -30)
        ctx.lineTo(6, 4)
        ctx.lineTo(-6, 4)
        ctx.closePath()
        ctx.fill()
        break
      case 'monument':
        ctx.fillStyle = '#475569'
        ctx.fillRect(-10, -46, 20, 48)
        ctx.fillStyle = '#64748b'
        ctx.fillRect(-14, -52, 28, 8)
        ctx.fillStyle = z === 'abyss' ? '#c084fc' : z === 'tower' ? '#f87171' : z === 'snow' ? '#93c5fd' : '#4ade80'
        ctx.beginPath()
        ctx.moveTo(0, -62)
        ctx.lineTo(-8, -48)
        ctx.lineTo(8, -48)
        ctx.closePath()
        ctx.fill()
        break
    }
    ctx.restore()
  }

  drawResource(ctx, r, camX, camY) {
    const sx = r.x - camX
    const sy = r.y - camY
    if (sx < -80 || sx > this.view.w + 80 || sy < -80 || sy > this.view.h + 80) return
    const pulse = 1 + Math.sin(performance.now() / 280) * 0.08
    ctx.save()
    ctx.translate(sx, sy)
    ctx.scale(pulse, pulse)
    ctx.shadowColor = r.color
    ctx.shadowBlur = 18
    ctx.fillStyle = r.color
    ctx.beginPath()
    ctx.moveTo(0, -24)
    ctx.lineTo(13, 0)
    ctx.lineTo(0, 24)
    ctx.lineTo(-13, 0)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    ctx.beginPath()
    ctx.moveTo(0, -10)
    ctx.lineTo(5, 0)
    ctx.lineTo(0, 10)
    ctx.lineTo(-5, 0)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  drawItem(ctx, it, camX, camY) {
    const sx = it.x - camX
    const sy = it.y - camY + Math.sin(it.bobT * 2.5) * 3
    if (sx < -80 || sx > this.view.w + 80 || sy < -80 || sy > this.view.h + 80) return
    ctx.save()
    ctx.translate(sx, sy)
    ctx.shadowColor = it.color
    ctx.shadowBlur = 12
    if (it.quality === 'common') {
      ctx.fillStyle = it.color
      ctx.fillRect(-12, -12, 24, 24)
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillRect(-8, -8, 8, 8)
    } else if (it.quality === 'rare') {
      ctx.fillStyle = it.color
      ctx.beginPath()
      ctx.moveTo(0, -18)
      ctx.lineTo(12, 0)
      ctx.lineTo(0, 18)
      ctx.lineTo(-12, 0)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath()
      ctx.moveTo(0, -8)
      ctx.lineTo(5, 0)
      ctx.lineTo(0, 8)
      ctx.lineTo(-5, 0)
      ctx.closePath()
      ctx.fill()
    } else if (it.quality === 'epic') {
      ctx.fillStyle = it.color
      ctx.beginPath()
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? 18 : 8
        const a = (Math.PI * 2 * i) / 8
        const px = Math.cos(a) * r
        const py = Math.sin(a) * r
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.beginPath()
      ctx.arc(0, 0, 4, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = it.color
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 18 : 7
        const a = (Math.PI * 2 * i) / 10 - Math.PI / 2
        const px = Math.cos(a) * r
        const py = Math.sin(a) * r
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.beginPath()
      ctx.arc(0, 0, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  drawEnemy(ctx, e, camX, camY) {
    const sx = e.x - camX
    const sy = e.y - camY
    if (sx < -200 || sx > this.view.w + 200 || sy < -200 || sy > this.view.h + 200) return
    const flash = e.hitT > 0
    const main = flash ? '#ffffff' : e.color
    const dark = flash ? '#e2e8f0' : shadeColor(e.color, 0.72)
    const light = flash ? '#ffffff' : shadeColor(e.color, 1.3)
    ctx.save()
    ctx.translate(sx, sy)
    ctx.scale(e.scale, e.scale)

    if (e.type === 'boss') {
      const cy = -e.r * 0.8
      // 外圈尖刺
      ctx.fillStyle = dark
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI * 2 * i) / 10
        const px = Math.cos(a) * (e.r + 10)
        const py = cy + Math.sin(a) * (e.r + 10)
        ctx.beginPath()
        ctx.moveTo(px + Math.cos(a) * 14, py + Math.sin(a) * 14)
        ctx.lineTo(px - Math.cos(a) * 8, py - Math.sin(a) * 8)
        ctx.lineTo(px - Math.sin(a) * 8, py + Math.cos(a) * 8)
        ctx.closePath()
        ctx.fill()
      }
      ctx.fillStyle = main
      ctx.beginPath()
      ctx.arc(0, cy, e.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = dark
      ctx.beginPath()
      ctx.moveTo(-e.r * 0.5, cy - e.r * 0.5)
      ctx.lineTo(-e.r * 0.7, cy - e.r * 1.5)
      ctx.lineTo(-e.r * 0.2, cy - e.r * 0.8)
      ctx.closePath()
      ctx.moveTo(e.r * 0.5, cy - e.r * 0.5)
      ctx.lineTo(e.r * 0.7, cy - e.r * 1.5)
      ctx.lineTo(e.r * 0.2, cy - e.r * 0.8)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(-e.r * 0.35, cy - e.r * 0.1, e.r * 0.18, 0, Math.PI * 2)
      ctx.arc(e.r * 0.35, cy - e.r * 0.1, e.r * 0.18, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(-e.r * 0.35, cy - e.r * 0.08, e.r * 0.08, 0, Math.PI * 2)
      ctx.arc(e.r * 0.35, cy - e.r * 0.08, e.r * 0.08, 0, Math.PI * 2)
      ctx.fill()
    } else if (e.type === 'elite') {
      const cy = -e.r * 0.8
      ctx.fillStyle = dark
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * 2 * i) / 6
        ctx.beginPath()
        ctx.moveTo(Math.cos(a) * e.r, cy + Math.sin(a) * e.r)
        ctx.lineTo(Math.cos(a + 0.4) * (e.r + 12), cy + Math.sin(a + 0.4) * (e.r + 12))
        ctx.lineTo(Math.cos(a + 0.8) * e.r, cy + Math.sin(a + 0.8) * e.r)
        ctx.closePath()
        ctx.fill()
      }
      ctx.fillStyle = main
      ctx.beginPath()
      ctx.moveTo(0, cy - e.r)
      ctx.lineTo(e.r * 0.9, cy - e.r * 0.5)
      ctx.lineTo(e.r * 0.9, cy + e.r * 0.5)
      ctx.lineTo(0, cy + e.r)
      ctx.lineTo(-e.r * 0.9, cy + e.r * 0.5)
      ctx.lineTo(-e.r * 0.9, cy - e.r * 0.5)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = light
      ctx.beginPath()
      ctx.moveTo(0, cy - e.r * 0.6)
      ctx.lineTo(e.r * 0.45, cy - e.r * 0.2)
      ctx.lineTo(e.r * 0.45, cy + e.r * 0.3)
      ctx.lineTo(0, cy + e.r * 0.6)
      ctx.lineTo(-e.r * 0.45, cy + e.r * 0.3)
      ctx.lineTo(-e.r * 0.45, cy - e.r * 0.2)
      ctx.closePath()
      ctx.fill()
    } else if (e.type === 'tank') {
      const cy = -e.r * 0.75
      ctx.fillStyle = dark
      ctx.beginPath()
      ctx.arc(0, cy, e.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = main
      ctx.beginPath()
      ctx.arc(0, cy - e.r * 0.12, e.r * 0.85, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      ctx.beginPath()
      ctx.arc(-e.r * 0.3, cy - e.r * 0.25, e.r * 0.2, 0, Math.PI * 2)
      ctx.arc(e.r * 0.3, cy - e.r * 0.25, e.r * 0.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(-e.r * 0.3, cy - e.r * 0.3, e.r * 0.12, 0, Math.PI * 2)
      ctx.arc(e.r * 0.3, cy - e.r * 0.3, e.r * 0.12, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(-e.r * 0.3, cy - e.r * 0.28, e.r * 0.06, 0, Math.PI * 2)
      ctx.arc(e.r * 0.3, cy - e.r * 0.28, e.r * 0.06, 0, Math.PI * 2)
      ctx.fill()
    } else if (e.type === 'fast') {
      const cy = -e.r * 0.8
      ctx.fillStyle = light
      ctx.beginPath()
      ctx.moveTo(-e.r * 0.8, cy)
      ctx.lineTo(-e.r * 1.7, cy - e.r * 0.5)
      ctx.lineTo(-e.r * 0.9, cy + e.r * 0.4)
      ctx.closePath()
      ctx.moveTo(e.r * 0.8, cy)
      ctx.lineTo(e.r * 1.7, cy - e.r * 0.5)
      ctx.lineTo(e.r * 0.9, cy + e.r * 0.4)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = main
      ctx.beginPath()
      ctx.arc(0, cy, e.r * 0.9, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(-e.r * 0.3, cy - e.r * 0.2, e.r * 0.22, 0, Math.PI * 2)
      ctx.arc(e.r * 0.3, cy - e.r * 0.2, e.r * 0.22, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(-e.r * 0.3, cy - e.r * 0.18, e.r * 0.1, 0, Math.PI * 2)
      ctx.arc(e.r * 0.3, cy - e.r * 0.18, e.r * 0.1, 0, Math.PI * 2)
      ctx.fill()
    } else {
      // 普通史莱姆
      const cy = -e.r * 0.75
      ctx.fillStyle = main
      ctx.beginPath()
      ctx.ellipse(0, cy, e.r, e.r * 0.9, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = dark
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.beginPath()
      ctx.ellipse(-e.r * 0.3, cy - e.r * 0.35, e.r * 0.3, e.r * 0.18, -0.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(-e.r * 0.35, cy - e.r * 0.1, e.r * 0.24, 0, Math.PI * 2)
      ctx.arc(e.r * 0.35, cy - e.r * 0.1, e.r * 0.24, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#0f172a'
      ctx.beginPath()
      ctx.arc(-e.r * 0.35, cy - e.r * 0.08, e.r * 0.1, 0, Math.PI * 2)
      ctx.arc(e.r * 0.35, cy - e.r * 0.08, e.r * 0.1, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  playerFrame(p) {
    if (p.moving) {
      return {
        kind: 'walk',
        idx: Math.floor(this.time * PET_FPS) % PET.walk.length,
        mirror: p.dir > 0,
      }
    }
    return { kind: 'idle', idx: 0, mirror: false }
  }

  pushPlayer(list, p) {
    list.push({
      y: p.y,
      draw: (ctx, camX, camY) => {
        const sx = p.x - camX
        const sy = p.y - camY
        const imgW = p.r * 2.1
        const imgH = p.r * 2.8
        ctx.save()
        ctx.translate(sx, sy)
        if (p.dashT > 0) {
          ctx.globalAlpha = 0.35
          ctx.fillStyle = '#7dd3fc'
          ctx.beginPath()
          ctx.ellipse(0, 0, p.r * 1.2, p.r * 0.9, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
        }
        if (p.iframes > 0 && Math.floor(p.iframes * 12) % 2 === 0) ctx.globalAlpha = 0.55
        const f = this.playerFrame(p)
        const frameImg = f.kind === 'walk' ? this.petWalk[f.idx] : this.pImg
        if (frameImg && frameImg.complete && frameImg.naturalWidth > 0) {
          ctx.save()
          if (f.mirror) ctx.scale(-1, 1)
          ctx.drawImage(frameImg, -imgW / 2, -imgH, imgW, imgH)
          ctx.restore()
        } else {
          ctx.fillStyle = '#3b82f6'
          ctx.beginPath()
          ctx.ellipse(0, -imgH / 2, p.r, p.r * 0.82, 0, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
        if (p.attackT > 0) {
          ctx.strokeStyle = 'rgba(255,255,255,0.85)'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(0, -imgH / 2, p.r + 12, -1.1, 1.1)
          ctx.stroke()
        }
        if (p.shield > 0) {
          ctx.strokeStyle = 'rgba(251,191,36,0.85)'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(0, -imgH / 2, p.r + 8, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (p.dashCd > 0) {
          const frac = 1 - p.dashCd / p.dashCdBase
          ctx.strokeStyle = 'rgba(125,211,252,0.5)'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(0, -imgH / 2, p.r + 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac)
          ctx.stroke()
        }
        ctx.restore()
      },
    })
  }

  bar(ctx, x, y, w, h, frac, color, bg) {
    ctx.fillStyle = 'rgba(2,6,23,0.7)'
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2)
    ctx.fillStyle = bg
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = color
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h)
  }

  drawTransition(ctx) {
    if (this.transition <= 0) return
    const a = Math.sin(clamp(this.transition, 0, 1) * Math.PI) * 0.55
    ctx.fillStyle = `rgba(2,6,23,${a.toFixed(3)})`
    ctx.fillRect(0, 0, this.view.w, this.view.h)
  }

  // 右侧 HUD：线性小图标 + 数字（替代 emoji，与全站 SF Symbols 风格一致）
  hudLine(ctx, icon, text, x, y, color = 'rgba(226,232,240,0.85)') {
    ctx.font = 'bold 14px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = color
    ctx.fillText(text, x, y)
    const tw = ctx.measureText(text).width
    this.hudIcon(ctx, icon, x - tw - 18, y, color)
  }

  hudIcon(ctx, icon, cx, cy, color) {
    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 1.6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.translate(cx, cy)
    ctx.beginPath()
    switch (icon) {
      case 'clock':
        ctx.arc(0, 0, 6.5, 0, Math.PI * 2)
        ctx.moveTo(0, 0)
        ctx.lineTo(0, -4)
        ctx.moveTo(0, 0)
        ctx.lineTo(3, 1.5)
        break
      case 'skull':
        ctx.arc(0, -1, 6, 0, Math.PI * 2)
        ctx.moveTo(-4, 6)
        ctx.lineTo(4, 6)
        ctx.moveTo(-2, 6)
        ctx.lineTo(-2, 8)
        ctx.moveTo(2, 6)
        ctx.lineTo(2, 8)
        ctx.moveTo(-2.5, -1.5)
        ctx.lineTo(-1.5, -1.5)
        ctx.moveTo(1.5, -1.5)
        ctx.lineTo(2.5, -1.5)
        break
      case 'star': {
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 7 : 3
          const a = -Math.PI / 2 + (i * Math.PI) / 5
          const px = Math.cos(a) * r
          const py = Math.sin(a) * r
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        break
      }
      case 'flame':
        ctx.moveTo(0, 7)
        ctx.bezierCurveTo(-6, 3, -5, -3, 0, -6)
        ctx.bezierCurveTo(5, -3, 6, 3, 0, 7)
        ctx.moveTo(0, 7)
        ctx.bezierCurveTo(-2.5, 4.5, -2, 1.5, 0, -1)
        ctx.bezierCurveTo(2, 1.5, 2.5, 4.5, 0, 7)
        break
      default:
        break
    }
    ctx.stroke()
    ctx.restore()
  }

  drawHud(ctx) {
    const { w } = this.view
    const p = this.player
    ctx.save()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    this.bar(ctx, 16, 14, 220, 16, p.hp / p.maxHp, '#4ade80', '#ef4444')
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`${Math.ceil(p.hp)}/${p.maxHp}`, 126, 23)
    if (p.shield > 0) this.bar(ctx, 16, 34, 140, 8, p.shield / 150, '#fbbf24', '#78350f')
    this.bar(ctx, 16, 52, 220, 10, this.xp / this.xpNext, '#22d3ee', '#0e7490')
    this.hudLine(ctx, 'clock', `${Math.floor(this.time)}s`, w - 16, 22)
    this.hudLine(ctx, 'skull', `${this.kills}`, w - 16, 44)
    this.hudLine(ctx, 'star', `${this.score}`, w - 16, 66)
    if (this.combo > 1) {
      this.hudLine(ctx, 'flame', `x${this.combo}`, w - 16, 88, this.combo >= 20 ? '#fbbf24' : '#7dd3fc')
    }
    ctx.restore()
  }

  drawMinimap(ctx) {
    const size = 140
    const x = this.view.w - size - 14
    const y = this.view.h - size - 14
    ctx.save()
    ctx.fillStyle = 'rgba(2,6,23,0.75)'
    ctx.fillRect(x - 2, y - 2, size + 4, size + 4)
    const s = size / ARENA.w
    const zoneColors = { forest: '#4ade80', snow: '#e2e8f0', tower: '#f87171', abyss: '#a855f7' }
    for (const z of ZONES) {
      ctx.fillStyle = zoneColors[z.id] + '55'
      ctx.fillRect(x + z.rect.x * s, y + z.rect.y * s, z.rect.w * s, z.rect.h * s)
    }
    for (const r of this.resources) {
      if (!r.active) continue
      ctx.fillStyle = '#22d3ee'
      ctx.fillRect(x + r.x * s - 1, y + r.y * s - 1, 2, 2)
    }
    if (this.boss) {
      ctx.fillStyle = '#ef4444'
      ctx.beginPath()
      ctx.arc(x + this.boss.x * s, y + this.boss.y * s, 4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(x + this.player.x * s, y + this.player.y * s, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.lineWidth = 1
    ctx.strokeRect(
      x + clamp(this.player.x - this.view.w / 2, 0, ARENA.w - this.view.w) * s,
      y + clamp(this.player.y - this.view.h / 2, 0, ARENA.h - this.view.h) * s,
      this.view.w * s,
      this.view.h * s
    )
    ctx.restore()
  }

  drawBanner(ctx) {
    if (!this.banner) return
    const alpha = clamp(this.banner.t / 0.6, 0, 1)
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(2,6,23,0.55)'
    const w = Math.min(420, this.view.w - 40)
    const h = 56
    ctx.fillRect(this.view.w / 2 - w / 2, this.view.h * 0.3, w, h)
    ctx.fillStyle = '#f8fafc'
    ctx.font = 'bold 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(this.banner.name, this.view.w / 2, this.view.h * 0.3 + h / 2 + 1)
    ctx.restore()
  }
}
