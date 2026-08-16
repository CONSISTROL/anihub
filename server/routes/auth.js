// 认证路由：登录 / 内部人员口令 / 当前用户（个人站，注册已移除，账号由 db.js 自动创建）
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { JWT_SECRET, JWT_EXPIRES_IN, INSIDER_KEYWORD } from '../config.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()

function publicUser(row) {
  return { id: row.id, username: row.username, createdAt: row.created_at }
}

function signAdminToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: 'admin' }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  })
}

// 内部人员口令：输入正确关键词换取 insider token（介于游客与管理员之间的只读身份）
router.post('/insider', (req, res) => {
  const { keyword } = req.body || {}
  if (typeof keyword !== 'string' || keyword !== INSIDER_KEYWORD) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '口令不正确' } })
  }
  const token = jwt.sign({ role: 'insider' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
  res.json({ token, role: 'insider' })
})

router.post('/login', (req, res) => {
  const { username, password } = req.body || {}
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username ?? '')
  // 统一错误信息，不泄露用户名是否存在
  if (!row || !bcrypt.compareSync(password ?? '', row.password_hash)) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '用户名或密码错误' } })
  }
  const user = publicUser(row)
  res.json({ token: signAdminToken(user), user })
})

router.get('/me', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.user.sub))
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '用户不存在' } })
  res.json(publicUser(row))
})

export default router
