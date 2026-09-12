// 轻量内存限流（自实现，无第三方依赖）
//
// 用途：登录 / 内部人员口令 / 升级（会调用 sudo 校验 root 密码）等敏感接口，
// 防止暴力猜测与事件循环被拖死。
//
// 实现：按 key（默认 IP）做固定窗口计数。窗口到期自动重置；
// 表上限保护（超过 maxKeys 时清理过期项，仍超则淘汰最旧的一批），避免被海量伪造 IP 撑爆内存。
import { getClientIp, rateKey } from '../lib/clientIp.js'

/**
 * @param {object} opts
 * @param {number} opts.windowMs 窗口长度
 * @param {number} opts.max 窗口内最大请求数
 * @param {string} opts.message 超限时的错误信息
 * @param {number} [opts.maxKeys] 记录表上限
 */
export function rateLimit({ windowMs = 60_000, max = 10, message = '请求过于频繁，请稍后再试', maxKeys = 5000 } = {}) {
  const hits = new Map() // key -> { start, count }

  function sweep(now) {
    for (const [k, v] of hits) {
      if (now - v.start >= windowMs) hits.delete(k)
    }
    // 仍然过多：按开始时间淘汰最旧的一批（防内存膨胀）
    if (hits.size > maxKeys) {
      const sorted = [...hits.entries()].sort((a, b) => a[1].start - b[1].start)
      for (let i = 0; i < sorted.length - maxKeys; i++) hits.delete(sorted[i][0])
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now()
    const key = rateKey(getClientIp(req))
    let rec = hits.get(key)
    if (!rec || now - rec.start >= windowMs) {
      rec = { start: now, count: 0 }
      hits.set(key, rec)
    }
    rec.count++
    const remaining = Math.max(0, max - rec.count)
    res.setHeader('X-RateLimit-Limit', String(max))
    res.setHeader('X-RateLimit-Remaining', String(remaining))
    if (rec.count > max) {
      const retryAfter = Math.max(1, Math.ceil((rec.start + windowMs - now) / 1000))
      res.setHeader('Retry-After', String(retryAfter))
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message } })
    }
    if (hits.size > maxKeys) sweep(now)
    next()
  }
}

/** 失败计数型限流：只在处理函数显式调用 fail() 时计数（用于「密码错误才计数」的场景） */
export function failureRateLimit({ windowMs = 15 * 60_000, max = 8, maxKeys = 5000 } = {}) {
  const hits = new Map() // key -> { times: number[], blockedUntil }

  function prune(now) {
    for (const [k, v] of hits) {
      v.times = v.times.filter((t) => now - t < windowMs)
      if (!v.times.length && (!v.blockedUntil || v.blockedUntil < now)) hits.delete(k)
    }
    if (hits.size > maxKeys) {
      const sorted = [...hits.entries()].sort((a, b) => (a[1].times.at(-1) || 0) - (b[1].times.at(-1) || 0))
      for (let i = 0; i < sorted.length - maxKeys; i++) hits.delete(sorted[i][0])
    }
  }

  function keyOf(req) {
    return rateKey(getClientIp(req))
  }

  return {
    /** 检查是否已被封禁；返回 true 表示已拦截 */
    check(req, res) {
      const now = Date.now()
      const v = hits.get(keyOf(req))
      if (v?.blockedUntil && v.blockedUntil > now) {
        const retryAfter = Math.max(1, Math.ceil((v.blockedUntil - now) / 1000))
        res.setHeader('Retry-After', String(retryAfter))
        res.status(429).json({ error: { code: 'RATE_LIMITED', message: '尝试次数过多，请稍后再试' } })
        return true
      }
      return false
    },
    /** 记录一次失败；达到上限则封禁一个窗口 */
    fail(req) {
      const now = Date.now()
      const k = keyOf(req)
      const v = hits.get(k) || { times: [], blockedUntil: 0 }
      v.times = v.times.filter((t) => now - t < windowMs)
      v.times.push(now)
      if (v.times.length >= max) {
        v.blockedUntil = now + windowMs
        v.times = []
      }
      hits.set(k, v)
      prune(now)
    },
    /** 成功则清空失败记录 */
    reset(req) {
      hits.delete(keyOf(req))
    },
  }
}
