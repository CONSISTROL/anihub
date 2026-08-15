// 站点设置：目前仅"哪些页面对游客可见"（guestPages）
import { Router } from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()

const ALL_PAGES = ['anime', 'blog', 'wiki'] // 主页始终可见，不在此列
const KEY = 'guest_pages'

function readGuestPages() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY)
  if (!row) return [...ALL_PAGES] // 未设置过：默认全部对游客可见
  try {
    const v = JSON.parse(row.value)
    if (Array.isArray(v)) return [...new Set(v)].filter((p) => ALL_PAGES.includes(p))
  } catch {}
  return [...ALL_PAGES]
}

// 游客也可读：前端需要知道哪些页面可见（路由守卫 + 导航过滤）
router.get('/', (req, res) => {
  res.json({ guestPages: readGuestPages() })
})

// 仅登录后可改
router.put('/', authRequired, (req, res) => {
  const { guestPages } = req.body || {}
  if (!Array.isArray(guestPages) || guestPages.some((p) => !ALL_PAGES.includes(p))) {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'guestPages 需为 anime/blog/wiki 的子集' } })
  }
  const unique = [...new Set(guestPages)]
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(KEY, JSON.stringify(unique))
  res.json({ guestPages: readGuestPages() })
})

export default router
