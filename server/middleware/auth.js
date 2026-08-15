// 认证中间件：authRequired 强制登录；optionalAuth 可选（用于计算 canEdit）
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
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '登录已过期，请重新登录' } })
  }
}

export function optionalAuth(req, res, next) {
  const token = readToken(req)
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET) } catch { /* 无效 token 视为未登录 */ }
  }
  next()
}
