// 认证中间件
// - authRequired：仅管理员可用（内部人员 token 会被拒绝），用于写操作与设置页
// - optionalAuth：可选解析，req.user 为 null（游客）或 { role: 'admin', sub, username } / { role: 'insider' }
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config.js'

function readToken(req) {
  const h = req.headers.authorization || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

export function authRequired(req, res, next) {
  const token = readToken(req)
  if (!token) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } })
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload.role !== 'admin') {
      // 内部人员无写权限
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '请先登录' } })
    }
    req.user = { role: 'admin', sub: payload.sub, username: payload.username }
    next()
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '登录已过期，请重新登录' } })
  }
}

export function optionalAuth(req, res, next) {
  const token = readToken(req)
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET)
      req.user =
        payload.role === 'admin'
          ? { role: 'admin', sub: payload.sub, username: payload.username }
          : payload.role === 'insider'
            ? { role: 'insider' }
            : undefined
    } catch {
      /* 无效 token 视为未登录 */
    }
  }
  next()
}
