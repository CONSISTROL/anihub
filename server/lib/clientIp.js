// 客户端 IP 解析（唯一可信来源）
//
// 背景：部署结构是 Nginx（对公网）→ Express（127.0.0.1:3001）。
// Nginx 用 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`，
// 即「客户端传来的 XFF + 真实对端地址」追加在末尾。
// 因此 **XFF 的第一段是攻击者可控的**（可随意伪造），只有最后一段才是真实来源。
//
// 旧实现取 `xff.split(',')[0]`，攻击者可以借此伪造任意 IP：
//   - 绕过 SPA 上报限流（visits.js 的 trackRate）
//   - 让每个伪造 IP 都触发一次 ip-api.com 外呼（出网耗尽）
//   - 在访问统计里写入大量假归属地
//
// 现在统一走本模块：优先信任 platform 提供的 `req.ip`
// （index.js 里 `app.set('trust proxy', …)` 已配置可信代理层数），
// 并在兜底解析 XFF 时取 **最后一段**。
import net from 'node:net'

/** 去掉 IPv6 映射前缀（::ffff:1.2.3.4 → 1.2.3.4），并归一小写 */
export function normalizeIp(ip) {
  let v = String(ip || '').trim()
  if (!v) return ''
  if (v.includes(',')) v = v.split(',')[0].trim() // 兼容误传整串 XFF
  v = v.replace(/^::ffff:/i, '')
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1)
  return v.toLowerCase()
}

/** XFF 链里最后一个可解析的地址（最接近真实来源的一段） */
function lastForwardedFor(header) {
  const raw = Array.isArray(header) ? header.join(',') : header
  if (!raw) return ''
  const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (net.isIP(normalizeIp(parts[i]))) return normalizeIp(parts[i])
  }
  return ''
}

/**
 * 解析客户端 IP。
 * 解析顺序：Express（已按 trust proxy 计算）→ XFF 末段 → socket 对端地址
 */
export function getClientIp(req) {
  const fromExpress = normalizeIp(req.ip)
  if (fromExpress && net.isIP(fromExpress)) return fromExpress
  const fromXff = lastForwardedFor(req.headers['x-forwarded-for'])
  if (fromXff) return fromXff
  return normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress || '')
}

/**
 * 限流键：IPv6 归一到 /64 前缀，避免单个用户用海量地址绕过限流。
 */
export function rateKey(ip) {
  const v = normalizeIp(ip)
  if (!v) return 'unknown'
  if (net.isIPv6(v)) {
    const seg = v.split(':')
    return seg.slice(0, 4).join(':') + '::/64'
  }
  return v
}
