// 访问统计（仅管理员查看）：记录页面访问量 / 访问记录 / IP 来源。
// - 记录来源：生产环境 Express 页面请求中间件（source=page）+ 前端 SPA 路由切换上报（source=spa）
// - IP 归属地：使用 ip-api.com 免费接口按需异步解析，结果缓存到 ip_locations 表
import { Router } from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()

/* ---------- IP 来源解析（异步、带缓存） ---------- */

const resolving = new Set()

// SPA 上报接口的简单限流：防止恶意脚本刷访问量
const trackRate = new Map()
const TRACK_WINDOW_MS = 60_000
const TRACK_MAX_PER_WINDOW = 60
function allowTrack(ip) {
  const now = Date.now()
  if (trackRate.size > 2000) {
    for (const [k, v] of trackRate) {
      if (now - v.start >= TRACK_WINDOW_MS) trackRate.delete(k)
    }
  }
  const rec = trackRate.get(ip)
  if (!rec || now - rec.start >= TRACK_WINDOW_MS) {
    trackRate.set(ip, { start: now, count: 1 })
    return true
  }
  rec.count++
  return rec.count <= TRACK_MAX_PER_WINDOW
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  let ip = ''
  if (typeof xff === 'string' && xff.trim()) {
    ip = xff.split(',')[0].trim()
  } else if (Array.isArray(xff) && xff.length) {
    ip = String(xff[0]).trim()
  } else {
    ip = req.socket?.remoteAddress || req.ip || ''
  }
  // Node 在 IPv6 映射地址下会给出 ::ffff:1.2.3.4，去掉前缀保留 IPv4
  return ip.replace(/^::ffff:/i, '')
}

function isPrivateIp(ip) {
  const v = String(ip || '').trim().toLowerCase()
  if (!v || v === 'unknown') return true
  if (v === '::1' || v === 'localhost') return true
  if (v.startsWith('127.') || v.startsWith('10.') || v.startsWith('192.168.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true
  if (v.startsWith('169.254.')) return true
  // IPv6 本机 / 唯一本地 / 链路本地
  if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80:')) return true
  return false
}

function upsertLocation(ip, { country = '', region = '', city = '', isp = '', lat = null, lon = null, status = 'failed', resolvedAt = null } = {}) {
  db.prepare(
    `INSERT INTO ip_locations (ip, country, region, city, isp, lat, lon, status, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET
       country = excluded.country,
       region = excluded.region,
       city = excluded.city,
       isp = excluded.isp,
       lat = excluded.lat,
       lon = excluded.lon,
       status = excluded.status,
       resolved_at = excluded.resolved_at`
  ).run(ip, country, region, city, isp, lat, lon, status, resolvedAt ?? Math.floor(Date.now() / 1000))
}

async function resolveIp(ip) {
  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN&fields=status,message,country,regionName,city,isp,query`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 5000)
    let data
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'AniHub/1.0' } })
      data = await res.json()
    } finally {
      clearTimeout(timer)
    }
    if (data?.status === 'success') {
      const lat = Number(data.lat)
      const lon = Number(data.lon)
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lon)
      upsertLocation(ip, {
        country: String(data.country || ''),
        region: String(data.regionName || ''),
        city: String(data.city || ''),
        isp: String(data.isp || ''),
        lat: hasCoords ? lat : null,
        lon: hasCoords ? lon : null,
        status: hasCoords ? 'ok' : 'failed',
      })
    } else {
      upsertLocation(ip, { status: 'failed' })
    }
  } catch {
    upsertLocation(ip, { status: 'failed' })
  }
}

function queueResolve(ip) {
  try {
    if (!ip) return
    if (isPrivateIp(ip)) {
      upsertLocation(ip, { status: 'skipped' })
      return
    }
    const row = db.prepare('SELECT status, resolved_at, lat, lon FROM ip_locations WHERE ip = ?').get(ip)
    if (row && row.status === 'ok' && row.lat != null && row.lon != null) return
    // 旧数据已解析但缺经纬度：允许立即补解析；失败/未知 24 小时后允许重新解析；正在解析的 IP 不重复发起
    if (row && row.status === 'failed' && row.resolved_at > Math.floor(Date.now() / 1000) - 86400) return
    if (resolving.has(ip)) return
    resolving.add(ip)
    setImmediate(async () => {
      try {
        await resolveIp(ip)
      } finally {
        resolving.delete(ip)
      }
    })
  } catch {
    /* IP 归属地解析失败不影响访问记录 */
  }
}

/* ---------- 记录写入 ---------- */

const ASSET_RE = /\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|map|txt|json|xml|mp4|webm|mp3|pdf)(?:\/|$)/i

export function recordVisit({ ip, path, ua = '', referer = '', source = 'page' }) {
  if (!path || typeof path !== 'string' || !path.startsWith('/')) return
  if (path === '/api' || path.startsWith('/api/')) return
  if (path.startsWith('/uploads') || path.startsWith('/wallpapers')) return
  if (path === '/favicon.ico') return
  // 静态资源不当作“访问页面”
  const pathname = path.split('?')[0]
  if (ASSET_RE.test(pathname)) return

  const now = Math.floor(Date.now() / 1000)
  try {
    db.prepare(
      'INSERT INTO visits (ts, ip, path, user_agent, referer, source) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      now,
      String(ip || '').slice(0, 64),
      path.slice(0, 500),
      String(ua || '').slice(0, 500),
      String(referer || '').slice(0, 500),
      source === 'spa' ? 'spa' : 'page'
    )
  } catch {
    return
  }
  queueResolve(String(ip || ''))
}

// 生产环境 Express 页面请求记录中间件：只记录真正的页面文档请求
export function recordPageVisit(req, res, next) {
  if ((req.method === 'GET' || req.method === 'HEAD') &&
      !req.path.startsWith('/api') &&
      !req.path.startsWith('/uploads') &&
      !req.path.startsWith('/wallpapers')) {
    recordVisit({
      ip: getClientIp(req),
      path: req.originalUrl || req.url,
      ua: req.headers['user-agent'],
      referer: req.headers.referer,
      source: 'page',
    })
  }
  next()
}

/* ---------- 管理员查询接口 ---------- */

router.get('/summary', authRequired, (req, res) => {
  const now = Math.floor(Date.now() / 1000)
  const startOfToday = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
  const startOfYesterday = startOfToday - 86400
  const since30 = now - 30 * 86400

  const count = (sql, ...args) => {
    try {
      return db.prepare(sql).get(...args)?.c || 0
    } catch {
      return 0
    }
  }

  const byDay = db
    .prepare(
      `SELECT * FROM (
         SELECT date(ts, 'unixepoch', 'localtime') AS d, COUNT(*) AS c, COUNT(DISTINCT ip) AS u
         FROM visits WHERE ts >= ? AND ip <> ''
         GROUP BY d ORDER BY d DESC LIMIT 30
       ) ORDER BY d ASC`
    )
    .all(since30)

  const topPaths = db
    .prepare(
      `SELECT CASE WHEN instr(path, '?') > 0 THEN substr(path, 1, instr(path, '?') - 1) ELSE path END AS path,
              COUNT(*) AS c
       FROM visits WHERE ts >= ?
       GROUP BY path ORDER BY c DESC, path LIMIT 10`
    )
    .all(since30)

  const topIps = db
    .prepare(
      `SELECT v.ip, COUNT(*) AS c,
              MAX(l.country) AS country, MAX(l.region) AS region, MAX(l.city) AS city,
              MAX(l.isp) AS isp, MAX(l.status) AS status
       FROM visits v LEFT JOIN ip_locations l ON l.ip = v.ip
       WHERE v.ts >= ? AND v.ip <> ''
       GROUP BY v.ip ORDER BY c DESC LIMIT 10`
    )
    .all(since30)

  res.json({
    total: count('SELECT COUNT(*) AS c FROM visits'),
    today: count('SELECT COUNT(*) AS c FROM visits WHERE ts >= ?', startOfToday),
    yesterday: count('SELECT COUNT(*) AS c FROM visits WHERE ts >= ? AND ts < ?', startOfYesterday, startOfToday),
    uniqueIps: count('SELECT COUNT(DISTINCT ip) AS c FROM visits WHERE ip <> \'\''),
    uniqueIpsToday: count('SELECT COUNT(DISTINCT ip) AS c FROM visits WHERE ip <> \'\' AND ts >= ?', startOfToday),
    uniqueIps30d: count('SELECT COUNT(DISTINCT ip) AS c FROM visits WHERE ip <> \'\' AND ts >= ?', since30),
    byDay,
    topPaths,
    topIps,
    lastRecordAt: db.prepare('SELECT MAX(ts) AS m FROM visits').get().m || null,
  })
})

// IP 列表（近 N 天热门 IP）：支持分页，用于管理后台“热门 IP / 全部 IP 记录”
router.get('/ips', authRequired, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30))
  const since = Math.floor(Date.now() / 1000) - days * 86400
  const q = String(req.query.q || '').trim()

  const where = ["v.ts >= ?", "v.ip <> ''"]
  const params = [since]
  if (q) {
    where.push('(v.ip LIKE ? OR l.country LIKE ? OR l.region LIKE ? OR l.city LIKE ? OR l.isp LIKE ?)')
    const like = `%${q}%`
    params.push(like, like, like, like, like)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const total = db
    .prepare(`SELECT COUNT(DISTINCT v.ip) AS c FROM visits v LEFT JOIN ip_locations l ON l.ip = v.ip ${whereSql}`)
    .get(...params)?.c || 0

  const rows = db
    .prepare(
      `SELECT v.ip, COUNT(*) AS count,
              MAX(l.country) AS country, MAX(l.region) AS region, MAX(l.city) AS city,
              MAX(l.isp) AS isp, MAX(l.status) AS status
       FROM visits v LEFT JOIN ip_locations l ON l.ip = v.ip
       ${whereSql}
       GROUP BY v.ip
       ORDER BY count DESC, v.ip
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize)

  res.json({
    total,
    page,
    pageSize,
    days,
    items: rows.map((r) => {
      const locationParts = [r.country, r.region, r.city].filter(Boolean)
      let location = locationParts.join(' · ')
      if (!location) {
        if (r.status === 'pending') location = '解析中…'
        else if (r.status === 'skipped') location = '内网 / 本机'
        else location = '未知'
      }
      return {
        ip: r.ip,
        count: r.count,
        country: r.country || '',
        region: r.region || '',
        city: r.city || '',
        isp: r.isp || '',
        status: r.status || 'pending',
        location,
      }
    }),
  })
})

// 地图热点数据：按 IP 归属地坐标聚合访问次数 / 独立 IP 数
router.get('/map', authRequired, (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30))
  const since = Math.floor(Date.now() / 1000) - days * 86400

  // 旧数据可能已解析归属地但缺少经纬度：每次打开地图时补解析少量，避免一次性打满免费接口配额
  const missingCoordRows = db
    .prepare(`SELECT ip FROM ip_locations WHERE status IN ('ok', 'pending') AND (lat IS NULL OR lon IS NULL) LIMIT 50`)
    .all()
  for (const row of missingCoordRows) queueResolve(row.ip)

  const points = db
    .prepare(
      `SELECT l.lat AS lat, l.lon AS lon,
              l.country AS country, l.region AS region, l.city AS city,
              COUNT(*) AS count,
              COUNT(DISTINCT v.ip) AS ip_count
       FROM visits v
       JOIN ip_locations l ON l.ip = v.ip
       WHERE v.ts >= ? AND l.lat IS NOT NULL AND l.lon IS NOT NULL
       GROUP BY l.lat, l.lon, l.country, l.region, l.city
       ORDER BY count DESC
       LIMIT 500`
    )
    .all(since)
  const unresolvedIps = db
    .prepare(
      `SELECT COUNT(DISTINCT v.ip) AS c
       FROM visits v LEFT JOIN ip_locations l ON l.ip = v.ip
       WHERE v.ts >= ? AND (l.lat IS NULL OR l.lon IS NULL)`
    )
    .get(since)?.c || 0
  const total = db.prepare('SELECT COUNT(*) AS c FROM visits WHERE ts >= ?').get(since)?.c || 0
  const totalIps = db.prepare('SELECT COUNT(DISTINCT ip) AS c FROM visits WHERE ip <> \'\' AND ts >= ?').get(since)?.c || 0

  const mappedVisits = points.reduce((sum, p) => sum + p.count, 0)
  const mappedIps = points.reduce((sum, p) => sum + p.ip_count, 0)

  res.json({
    days,
    total,
    totalIps,
    mappedVisits,
    mappedIps,
    unresolvedIps,
    points: points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      country: p.country || '',
      region: p.region || '',
      city: p.city || '',
      count: p.count,
      ipCount: p.ip_count,
    })),
  })
})

// 单个 IP 详情：归属地完整信息 + 访问汇总 + 路径/UA 分布 + 最近访问记录
router.get('/ip/:ip', authRequired, (req, res) => {
  const ip = req.params.ip || ''
  if (!ip) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '缺少 IP' } })
  }
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30))
  const since = Math.floor(Date.now() / 1000) - days * 86400

  const loc = db
    .prepare('SELECT country, region, city, isp, lat, lon, status, resolved_at FROM ip_locations WHERE ip = ?')
    .get(ip) || null

  const summaryRow = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) AS range_count,
              MIN(ts) AS first_seen,
              MAX(ts) AS last_seen
       FROM visits WHERE ip = ?`
    )
    .get(since, ip)
  const summary = {
    total: summaryRow?.total || 0,
    rangeCount: summaryRow?.range_count || 0,
    firstSeen: summaryRow?.first_seen || null,
    lastSeen: summaryRow?.last_seen || null,
  }

  const paths = db
    .prepare(
      `SELECT path, COUNT(*) AS count, MAX(ts) AS last_ts
       FROM visits WHERE ip = ? AND ts >= ?
       GROUP BY path ORDER BY count DESC, path LIMIT 30`
    )
    .all(ip, since)

  const userAgents = db
    .prepare(
      `SELECT user_agent AS userAgent, COUNT(*) AS count, MAX(ts) AS last_ts
       FROM visits WHERE ip = ? AND ts >= ? AND user_agent <> ''
       GROUP BY user_agent ORDER BY count DESC, user_agent LIMIT 20`
    )
    .all(ip, since)

  const recentVisits = db
    .prepare(
      `SELECT id, ts, path, referer, user_agent AS userAgent, source
       FROM visits WHERE ip = ?
       ORDER BY ts DESC, id DESC LIMIT 100`
    )
    .all(ip)

  res.json({
    ip,
    days,
    location: loc,
    summary,
    paths,
    userAgents,
    recentVisits,
  })
})

router.get('/records', authRequired, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20))
  const q = String(req.query.q || '').trim()
  const from = Number(req.query.from)
  const to = Number(req.query.to)

  const where = []
  const params = []
  if (q) {
    where.push(
      '(v.ip LIKE ? OR v.path LIKE ? OR v.user_agent LIKE ? OR v.referer LIKE ?' +
      ' OR l.country LIKE ? OR l.region LIKE ? OR l.city LIKE ? OR l.isp LIKE ?)'
    )
    const like = `%${q}%`
    params.push(like, like, like, like, like, like, like, like)
  }
  if (Number.isFinite(from)) {
    where.push('v.ts >= ?')
    params.push(Math.floor(from))
  }
  if (Number.isFinite(to)) {
    where.push('v.ts <= ?')
    params.push(Math.floor(to))
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM visits v LEFT JOIN ip_locations l ON l.ip = v.ip ${whereSql}`)
    .get(...params)?.c || 0
  const rows = db
    .prepare(
      `SELECT v.id, v.ts, v.ip, v.path, v.user_agent, v.referer, v.source,
              l.country, l.region, l.city, l.isp, l.status
       FROM visits v LEFT JOIN ip_locations l ON l.ip = v.ip
       ${whereSql}
       ORDER BY v.ts DESC, v.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, (page - 1) * pageSize)

  res.json({
    total,
    page,
    pageSize,
    items: rows.map((r) => {
      const locationParts = [r.country, r.region, r.city].filter(Boolean)
      let location = locationParts.join(' · ')
      if (!location) {
        if (r.status === 'pending') location = '解析中…'
        else if (r.status === 'skipped') location = '内网 / 本机'
        else location = '未知'
      }
      return {
        id: r.id,
        ts: r.ts,
        ip: r.ip,
        path: r.path,
        userAgent: r.user_agent,
        referer: r.referer,
        source: r.source,
        country: r.country || '',
        region: r.region || '',
        city: r.city || '',
        isp: r.isp || '',
        status: r.status || 'pending',
        location,
      }
    }),
  })
})

// 前端 SPA 路由切换上报（无需登录；只接收页面路径，不接收其他敏感信息）
router.post('/track', (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path.trim() : ''
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.length > 500 || path === '/api' || path.startsWith('/api/')) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'path 需为合法的站内路径' } })
  }
  if (!allowTrack(getClientIp(req))) {
    return res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message: '访问上报过于频繁，请稍后再试' } })
  }
  recordVisit({
    ip: getClientIp(req),
    path,
    ua: req.headers['user-agent'],
    referer: req.headers.referer,
    source: 'spa',
  })
  res.json({ ok: true })
})

export default router
