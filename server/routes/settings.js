// 站点设置：哪些页面对游客可见（guestPages）+ 哪些页面对内部人员可见（insiderPages）
// + 网站壁纸 / Anime 成人内容：均按身份（游客/内部人员/管理员）控制呈现，管理员恒可见
// 内部人员可见范围 = 游客可见页面 + insiderPages（insiderPages 仅存"游客不可见但内部可见"的部分）
import { Router } from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()

const ALL_PAGES = ['anime', 'blog', 'wiki', 'tools', 'game'] // 主页始终可见，不在此列；未设置时默认全部对游客可见
const PET_KEY = 'pet' // 桌宠：默认不向游客/内部人员展示，需管理员在设置中显式开放
// 只对内部人员及以上开放的页面：不在默认游客可见列表里，但允许管理员显式放给游客。
// 在线阅读即属此类（默认内部人员可见、游客不可见）。
const INSIDER_ONLY_PAGES = ['reading']
const PAGE_KEYS = [...ALL_PAGES, ...INSIDER_ONLY_PAGES, PET_KEY]
const GUEST_KEY = 'guest_pages'
const INSIDER_KEY = 'insider_pages'
const WALLPAPER_KEY = 'wallpaper' // JSON: { guest: bool, insider: bool }
const SHOW_ADULT_KEY = 'show_adult' // JSON: { guest: bool, insider: bool }
const SCHEME_KEY = 'theme_scheme' // 配色方案 id；未设置过 = classic（沿用原有配色）
const SCHEMES = ['classic', 'indigo'] // 与前端 src/style.css 的 [data-scheme] 块一一对应

function readList(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (!row) return fallback
  try {
    const v = JSON.parse(row.value)
    if (Array.isArray(v)) return [...new Set(v)].filter((p) => PAGE_KEYS.includes(p))
  } catch {}
  return fallback
}

function readGuestPages() {
  return readList(GUEST_KEY, [...ALL_PAGES]) // 未设置过：默认页面全开（桌宠与在线阅读不在内）
}

function readInsiderPages() {
  const fallback = [PET_KEY, ...INSIDER_ONLY_PAGES]
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(INSIDER_KEY)
  // 未设置过：默认桌宠与在线阅读对内部人员可见（游客仍需显式开放）
  if (!row) return fallback
  const list = readList(INSIDER_KEY, fallback)
  // 兼容历史数据：reading 是后加的功能，老配置里当然没有它。
  // 若配置里从未出现过该键，则按新功能默认值补上（内部人员可见）；
  // 管理员一旦在设置里显式取消勾选，它就会出现在数组里，因此不会覆盖管理员的决定。
  const persisted = (() => {
    try {
      const v = JSON.parse(row.value)
      return Array.isArray(v) ? v : null
    } catch {
      return null
    }
  })()
  if (!persisted) return list
  const missing = INSIDER_ONLY_PAGES.filter((p) => !persisted.includes(p))
  return [...new Set([...list, ...missing])]
}

function writeList(key, pages) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(pages))
}

/** 身份可见性：{ guest, insider }，管理员恒可见。兼容旧格式（'1'/'0'、布尔、{enabled}）。 */
function readFeature(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (!row) return fallback
  try {
    const v = JSON.parse(row.value)
    if (typeof v === 'boolean') return { guest: v, insider: v } // 旧布尔格式
    if (v && typeof v === 'object') {
      // 旧格式 { enabled: bool } → 迁移为 guest/insider
      if (typeof v.enabled === 'boolean' && typeof v.guest !== 'boolean' && typeof v.insider !== 'boolean') {
        return { guest: v.enabled, insider: v.enabled }
      }
      return {
        guest: v.guest === true,
        insider: v.insider === true,
      }
    }
  } catch {}
  // 非 JSON（旧 '1'/'0' 字符串）
  if (row.value === '1' || row.value === 'true') return { guest: true, insider: true }
  if (row.value === '0' || row.value === 'false') return { guest: false, insider: false }
  return fallback
}

function writeFeature(key, v) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify({ guest: !!v.guest, insider: !!v.insider }))
}

function readWallpaper() {
  return readFeature(WALLPAPER_KEY, { guest: true, insider: true }) // 默认：游客/内部人员都可见（管理员恒可见）
}

function writeWallpaper(w) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(WALLPAPER_KEY, JSON.stringify({ guest: !!w.guest, insider: !!w.insider }))
}

/** 配色方案：全站一套（与昼夜主题正交）。值不在白名单内一律回退 classic。 */
function readScheme() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SCHEME_KEY)
  return row && SCHEMES.includes(row.value) ? row.value : 'classic'
}

function writeScheme(v) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(SCHEME_KEY, v)
}

// 游客也可读：前端需要知道哪些页面可见（路由守卫 + 导航过滤）
router.get('/', (req, res) => {
  res.json({
    guestPages: readGuestPages(),
    insiderPages: readInsiderPages(),
    wallpaper: readWallpaper(),
    showAdult: readFeature(SHOW_ADULT_KEY, { guest: false, insider: false }), // 默认仅管理员可见
    themeScheme: readScheme(), // 配色方案是全站一套，游客也要拿到才能按管理员的选择渲染
  })
})

// 仅登录后可改
router.put('/', authRequired, (req, res) => {
  const { guestPages, insiderPages, wallpaper, showAdult, themeScheme } = req.body || {}
  const validFeat = (f) =>
    f === undefined ||
    (typeof f === 'object' &&
      f !== null &&
      typeof f.guest === 'boolean' &&
      typeof f.insider === 'boolean')
  if (
    !Array.isArray(guestPages) ||
    guestPages.some((p) => !PAGE_KEYS.includes(p)) ||
    (insiderPages !== undefined && (!Array.isArray(insiderPages) || insiderPages.some((p) => !PAGE_KEYS.includes(p)))) ||
    (wallpaper !== undefined &&
      (typeof wallpaper !== 'object' ||
        wallpaper === null ||
        typeof wallpaper.guest !== 'boolean' ||
        typeof wallpaper.insider !== 'boolean')) ||
    !validFeat(showAdult) ||
    (themeScheme !== undefined && !SCHEMES.includes(themeScheme))
  ) {
    return res
      .status(400)
      .json({
        error: {
          code: 'VALIDATION_ERROR',
          message: `guestPages / insiderPages 需为 ${PAGE_KEYS.join('/')} 的子集；wallpaper 需 {guest,insider}；showAdult 需 {guest,insider}；themeScheme 需为 ${SCHEMES.join('/')}`,
        },
      })
  }
  const guests = [...new Set(guestPages)]
  // 内部人员额外可见的页面：剔除已对游客可见的（游客可见自动包含在内部可见内）
  const insiders = [...new Set(insiderPages ?? [])].filter((p) => !guests.includes(p))
  writeList(GUEST_KEY, guests)
  writeList(INSIDER_KEY, insiders)
  if (wallpaper !== undefined) writeWallpaper(wallpaper)
  if (showAdult !== undefined) writeFeature(SHOW_ADULT_KEY, showAdult)
  if (themeScheme !== undefined) writeScheme(themeScheme)
  res.json({
    guestPages: guests,
    insiderPages: insiders,
    wallpaper: readWallpaper(),
    showAdult: readFeature(SHOW_ADULT_KEY, { guest: false, insider: false }),
    themeScheme: readScheme(),
  })
})

export default router
