// 服务器监控（仅管理员）：进程 / 系统 / 数据库实时状态 + 历史图表数据
import { Router } from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()

// 进程级统计：请求计数由 index.js 的中间件累加
export const serverStats = { requests: 0, startedAt: Date.now() }

router.get('/', authRequired, (req, res) => {
  const mem = process.memoryUsage()
  const dbBase = path.join(import.meta.dirname, '..', 'anihub.db') // 本文件位于 server/routes/，db 在 server/
  let dbSize = 0
  let dbMtime = 0
  try {
    // SQLite WAL 模式下数据主要在 -wal 文件里，统计主库 + wal + shm 的总大小
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        const st = fs.statSync(dbBase + suffix)
        dbSize += st.size
        if (st.mtimeMs > dbMtime) dbMtime = st.mtimeMs
      } catch {}
    }
  } catch {
    /* 文件不可读：忽略 */
  }
  const counts = {}
  try {
    counts.posts = db.prepare('SELECT COUNT(*) AS c FROM posts').get().c
    counts.users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
    counts.settings = db.prepare('SELECT COUNT(*) AS c FROM settings').get().c
  } catch {
    /* 表不存在 */
  }
  res.json({
    now: Date.now(),
    startedAt: serverStats.startedAt,
    uptime: process.uptime(),
    requests: serverStats.requests,
    node: process.version,
    pid: process.pid,
    platform: `${os.platform()} ${os.arch()}`,
    hostname: os.hostname(),
    cpus: os.cpus().length,
    loadAvg: os.loadavg(),
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    mem: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    db: { size: dbSize, mtime: dbMtime, ...counts },
  })
})

// 历史监控图表数据：range = h(小时) | d(天) | w(周) | m(月) | custom(from/to epoch 秒)
// 按时间桶聚合（AVG），返回连续的时间轴（缺桶由前端补 null）
router.get('/history', authRequired, (req, res) => {
  const now = Math.floor(Date.now() / 1000)
  let from = now - 3600
  let to = now
  let bucketSec = 60
  const range = String(req.query.range || 'h')
  if (range === 'd') {
    from = now - 86400
    bucketSec = 300
  } else if (range === 'w') {
    from = now - 7 * 86400
    bucketSec = 1800
  } else if (range === 'm') {
    from = now - 30 * 86400
    bucketSec = 7200
  } else if (range === 'custom') {
    const f = Number(req.query.from)
    const t = Number(req.query.to)
    if (!Number.isFinite(f) || !Number.isFinite(t) || t <= f) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '自定义范围需提供合法的 from/to（epoch 秒）' } })
    }
    from = f
    to = t
    bucketSec = Math.max(1, Math.round((to - from) / 600)) // 控制 ≤600 个点
  }
  const rows = db
    .prepare(
      `SELECT (ts / ?) * ? AS b,
              AVG(cpu) AS cpu, AVG(mem_used) AS mem,
              AVG(net_in) AS net_in, AVG(net_out) AS net_out,
              AVG(disk_read) AS disk_read, AVG(disk_write) AS disk_write
       FROM metrics WHERE ts >= ? AND ts <= ?
       GROUP BY b ORDER BY b`
    )
    .all(bucketSec, bucketSec, from, to)
  res.json({
    from,
    to,
    bucketSec,
    memTotal: os.totalmem(),
    points: rows.map((r) => ({
      ts: r.b,
      cpu: r.cpu,
      mem: r.mem,
      netIn: r.net_in,
      netOut: r.net_out,
      diskRead: r.disk_read,
      diskWrite: r.disk_write,
    })),
  })
})

export default router
