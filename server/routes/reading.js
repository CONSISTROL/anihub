// 在线阅读接口
// - GET    /api/reading           按身份返回可读清单（游客 401）
// - GET    /api/reading/access    管理员：全部书 + 上架配置（设置页用）
// - PUT    /api/reading/access    管理员：保存上架配置
// - POST   /api/reading/session   换取 /books 专用的 HttpOnly Cookie（供 iframe 鉴权）
// - DELETE /api/reading/session   清除该 Cookie（退出登录 / 退出内部模式时调用）
// - GET    /api/reading/:id       单本详情（含入口 URL）
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config.js'
import { authRequired, optionalAuth } from '../middleware/auth.js'
import { listBooks, visibleBooks, readAccess, writeAccess } from '../books.js'

const router = Router()

// 书正文是 iframe 直接加载的静态 HTML，带不上 localStorage 里的 token，
// 因此换成一个只发给 /books 的 HttpOnly Cookie（与本地 Web 代理同一套做法）。
const BOOK_COOKIE = 'anihub_books'
const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', path: '/books' }

function withUrl(b) {
  return { ...b, url: `/books/${encodeURIComponent(b.id)}/${b.entry}` }
}

// 游客在读接口上直接 401：在线阅读本身就是「inside 及以上」的功能
function readingRole(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '需要更高权限' } })
    }
    req.readingRole = req.user.role
    next()
  })
}

router.get('/', readingRole, (req, res) => {
  const { books, access } = visibleBooks(req.readingRole)
  res.json({
    role: req.readingRole,
    total: listBooks().length,
    books: books.map(withUrl),
    // 只有管理员需要知道完整上架状态
    ...(req.readingRole === 'admin' ? { access } : {}),
  })
})

/* ---------- /books 专用会话 Cookie ---------- */

// 内部人员与管理员都可用（游客拿不到任何身份，optionalAuth 会给出 req.user = undefined）
router.post('/session', optionalAuth, (req, res) => {
  if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '需要更高权限' } })
  const payload =
    req.user.role === 'admin'
      ? { role: 'admin', sub: req.user.sub, username: req.user.username, purpose: 'books' }
      : { role: 'insider', purpose: 'books' }
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
  res.cookie(BOOK_COOKIE, token, COOKIE_OPTS)
  res.json({ ok: true, role: req.user.role })
})

router.delete('/session', (req, res) => {
  res.clearCookie(BOOK_COOKIE, COOKIE_OPTS)
  res.json({ ok: true })
})

// 管理接口必须放在 /:id 之前，否则会被当成书 id
router.get('/access', authRequired, (req, res) => {
  const access = readAccess()
  res.json({
    books: listBooks().map((b) => ({
      ...withUrl(b),
      guest: access.guest.includes(b.id),
      insider: access.insider.includes(b.id),
    })),
    access: { enabled: access.enabled, guest: access.guest, insider: access.insider },
  })
})

router.put('/access', authRequired, (req, res) => {
  const { enabled, guest, insider } = req.body || {}
  const ids = new Set(listBooks().map((b) => b.id))
  const clean = (v) =>
    Array.isArray(v) ? [...new Set(v)].filter((x) => typeof x === 'string' && ids.has(x)) : null
  if (typeof enabled !== 'boolean' || (guest !== undefined && clean(guest) === null) || (insider !== undefined && clean(insider) === null)) {
    return res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'enabled 需为布尔；guest / insider 需为书 id 数组' } })
  }
  const prev = readAccess()
  const next = {
    enabled,
    guest: guest === undefined ? prev.guest : clean(guest),
    insider: insider === undefined ? prev.insider : clean(insider),
  }
  // 对游客上架的书自动也算对内部人员上架（内部人员权限高于游客）
  next.insider = [...new Set([...next.insider, ...next.guest])]
  writeAccess(next)
  console.log(
    `[reading] 上架配置已更新：功能${next.enabled ? '开启' : '关闭'}，游客可见 ${next.guest.length} 本，内部人员可见 ${next.insider.length} 本`
  )
  res.json(next)
})

router.get('/:id', readingRole, (req, res) => {
  const { books } = visibleBooks(req.readingRole)
  const book = books.find((b) => b.id === req.params.id)
  if (!book) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '书不存在或未上架' } })
  res.json(withUrl(book))
})

export default router
