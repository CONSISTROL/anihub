// 认证路由：登录 / 内部人员口令 / 当前用户（个人站，注册已移除，账号由 db.js 自动创建）
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../db.js'
import { JWT_SECRET, JWT_EXPIRES_IN, INSIDER_KEYWORD } from '../config.js'
import { authRequired } from '../middleware/auth.js'
import { rateLimit, failureRateLimit } from '../middleware/rateLimit.js'

const router = Router()

// 「用户不存在」时用于等时比对的固定 hash（bcrypt, cost 10），永不匹配任何真实密码。
// 写死常量避免启动时再算一次 bcrypt。
const DUMMY_HASH = '$2b$10$mvUdRQcImcAhIKz/Ha5Rhue75CW70gCzt5jsUD7yC4Y4.4SvTUpCK'

// 登录限流：失败才计数（正常使用不受影响），15 分钟内累计 8 次失败封禁该 IP 一个窗口
const loginFailures = failureRateLimit({ windowMs: 15 * 60_000, max: 8 })
// 内部人员口令：纯字符串比对，无计算成本，用固定窗口限流防扫描
const insiderLimit = rateLimit({ windowMs: 60_000, max: 10, message: '尝试次数过多，请稍后再试' })

function publicUser(row) {
  return { id: row.id, username: row.username, createdAt: row.created_at }
}

function signAdminToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: 'admin' }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  })
}

// 内部人员口令：输入正确关键词换取 insider token（介于游客与管理员之间的只读身份）
router.post('/insider', insiderLimit, (req, res) => {
  const { keyword } = req.body || {}
  if (typeof keyword !== 'string' || keyword !== INSIDER_KEYWORD) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '口令不正确' } })
  }
  res.json({ token: jwt.sign({ role: 'insider' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }), role: 'insider' })
})

// 登录：bcrypt 比对改为异步（bcryptjs 的 compareSync 是纯 JS 计算，约 50-60ms 同步 CPU，
// 会阻塞事件循环；异步版本虽然底层仍走线程池调度，但不再卡住其他请求）。
router.post('/login', async (req, res) => {
  if (loginFailures.check(req, res)) return
  const { username, password } = req.body || {}
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username ?? '')

  // 统一错误信息，不泄露用户名是否存在。
  // 用户不存在时也跑一次 bcrypt 比对（等长耗时），避免用响应时间探测用户名。
  const hash = row ? row.password_hash : DUMMY_HASH
  let ok = false
  try {
    ok = await bcrypt.compare(String(password ?? ''), hash)
  } catch {
    ok = false
  }
  if (!row || !ok) {
    loginFailures.fail(req)
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '用户名或密码错误' } })
  }
  loginFailures.reset(req)
  const user = publicUser(row)
  res.json({ token: signAdminToken(user), user })
})

router.get('/me', authRequired, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.user.sub))
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '用户不存在' } })
  res.json(publicUser(row))
})

export default router
