// 站点设置：哪些页面对游客可见（guestPages）+ 哪些页面对内部人员可见（insiderPages）
// 内部人员可见范围 = 游客可见页面 + insiderPages（insiderPages 仅存"游客不可见但内部可见"的部分）
import { Router } from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()

const ALL_PAGES = ['anime', 'blog', 'wiki', 'tools'] // 主页始终可见，不在此列
const GUEST_KEY = 'guest_pages'
const INSIDER_KEY = 'insider_pages'

function readList(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (!row) return fallback
  try {
    const v = JSON.parse(row.value)
    if (Array.isArray(v)) return [...new Set(v)].filter((p) => ALL_PAGES.includes(p))
  } catch {}
  return fallback
}

function readGuestPages() {
  return readList(GUEST_KEY, [...ALL_PAGES]) // 未设置过：默认全部对游客可见
}

function readInsiderPages() {
  return readList(INSIDER_KEY, []) // 默认无额外页面
}

function writeList(key, pages) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(pages))
}

// 游客也可读：前端需要知道哪些页面可见（路由守卫 + 导航过滤）
router.get('/', (req, res) => {
  res.json({ guestPages: readGuestPages(), insiderPages: readInsiderPages() })
})

// 仅登录后可改
router.put('/', authRequired, (req, res) => {
  const { guestPages, insiderPages } = req.body || {}
  if (
    !Array.isArray(guestPages) ||
    guestPages.some((p) => !ALL_PAGES.includes(p)) ||
    (insiderPages !== undefined && (!Array.isArray(insiderPages) || insiderPages.some((p) => !ALL_PAGES.includes(p))))
  ) {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'guestPages / insiderPages 需为 anime/blog/wiki/tools 的子集' } })
  }
  const guests = [...new Set(guestPages)]
  // 内部人员额外可见的页面：剔除已对游客可见的（游客可见自动包含在内部可见内）
  const insiders = [...new Set(insiderPages ?? [])].filter((p) => !guests.includes(p))
  writeList(GUEST_KEY, guests)
  writeList(INSIDER_KEY, insiders)
  res.json({ guestPages: guests, insiderPages: insiders })
})

export default router
