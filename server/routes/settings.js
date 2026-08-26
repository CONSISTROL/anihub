// 站点设置：哪些页面对游客可见（guestPages）+ 哪些页面对内部人员可见（insiderPages）
// + 网站壁纸 / Anime 成人内容：均按身份（游客/内部人员/管理员）控制呈现，管理员恒可见
// 内部人员可见范围 = 游客可见页面 + insiderPages（insiderPages 仅存"游客不可见但内部可见"的部分）
import { Router } from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()

const ALL_PAGES = ['anime', 'blog', 'wiki', 'tools', 'game'] // 主页始终可见，不在此列；未设置时默认全部对游客可见
const PET_KEY = 'pet' // 桌宠：默认不向游客/内部人员展示，需管理员在设置中显式开放
const PAGE_KEYS = [...ALL_PAGES, PET_KEY]
const GUEST_KEY = 'guest_pages'
const INSIDER_KEY = 'insider_pages'
const WALLPAPER_KEY = 'wallpaper' // JSON: { guest: bool, insider: bool }
const SHOW_ADULT_KEY = 'show_adult' // JSON: { guest: bool, insider: bool }

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
  return readList(GUEST_KEY, [...ALL_PAGES]) // 未设置过：默认页面全开（桌宠不在内）
}

function readInsiderPages() {
  return readList(INSIDER_KEY, [PET_KEY]) // 未设置过：默认桌宠对内部人员可见（游客仍需显式开放）
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

// 游客也可读：前端需要知道哪些页面可见（路由守卫 + 导航过滤）
router.get('/', (req, res) => {
  res.json({
    guestPages: readGuestPages(),
    insiderPages: readInsiderPages(),
    wallpaper: readWallpaper(),
    showAdult: readFeature(SHOW_ADULT_KEY, { guest: false, insider: false }), // 默认仅管理员可见
  })
})

// 仅登录后可改
router.put('/', authRequired, (req, res) => {
  const { guestPages, insiderPages, wallpaper, showAdult } = req.body || {}
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
    !validFeat(showAdult)
  ) {
    return res
      .status(400)
      .json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'guestPages / insiderPages 需为 anime/blog/wiki/tools/game/pet 的子集；wallpaper 需 {guest,insider}；showAdult 需 {guest,insider}',
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
  res.json({
    guestPages: guests,
    insiderPages: insiders,
    wallpaper: readWallpaper(),
    showAdult: readFeature(SHOW_ADULT_KEY, { guest: false, insider: false }),
  })
})

export default router
