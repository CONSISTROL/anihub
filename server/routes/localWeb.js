// 管理员“本地 Web”访问：让管理员在控制台里发现/输入服务器本机监听的 Web 端口，
// 通过本站点反向代理在完整新标签页中打开（仅限回环地址，避免 SSRF 到内网）。
//
// 两个 Router：
// - apiRouter：/api/local-web/*  —— 建立 /local-web 专用 HttpOnly Cookie、扫描本机监听端口
// - proxyRouter：/local-web/http/<host:port>/... —— 真正把请求转发到 127.0.0.1/::1/localhost
import { Router } from 'express'
import http from 'node:http'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import jwt from 'jsonwebtoken'
import { JWT_SECRET, PORT } from '../config.js'
import { authRequired } from '../middleware/auth.js'

const apiRouter = Router()
const proxyRouter = Router()

const COOKIE_NAME = 'anihub_local_web'
const SCAN_TTL_MS = 30000
/* 上游**空闲**超时（不是总耗时）：多久没收到任何字节才算挂死。
 *
 * ⚠⚠ 这里原来是 30s，对本地服务是灾难性的：本机跑的往往是**重后端**
 * （DSH 的 workspace 创建 / 会话恢复 / 导出 / 一轮对话的接收确认都可能远超 30s），
 * 一旦超时，代理会 `upstream.destroy()` 并回 `502 PROXY_FAILED: upstream timeout`
 * —— 客户端侧表现就是"点了没反应 / 一直等待中 / 连接不上"，而且**看起来完全不像是超时**。
 * 实测（`.probe/slow-upstream.mjs`）：上游 45s 才回，30s 整被掐断成 502。
 * 现在默认 10 分钟，仍能在上游真的挂死时回收；可用 LOCAL_WEB_UPSTREAM_TIMEOUT_MS 覆盖。 */
const UPSTREAM_TIMEOUT_MS = Number(process.env.LOCAL_WEB_UPSTREAM_TIMEOUT_MS) > 0
  ? Number(process.env.LOCAL_WEB_UPSTREAM_TIMEOUT_MS)
  : 10 * 60 * 1000

/* -------------------- 会话 Cookie（供新标签页全页代理鉴权） -------------------- */

apiRouter.post('/session', authRequired, (req, res) => {
  // 这个 Cookie 只发给 /local-web/*，不会随网站其它页面 / API 发送。
  // 不设置 maxAge = 会话 Cookie：关闭浏览器即失效；退出登录时前端也会主动删除。
  const token = jwt.sign(
    { role: 'admin', sub: req.user.sub, username: req.user.username, purpose: 'local-web', v: 2 },
    JWT_SECRET,
    { expiresIn: '7d' }
  )
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/local-web',
  })
  res.json({ ok: true })
})

// 退出登录时由前端调用，清除本地 Web 专用 Cookie，避免登出后仍能访问代理
apiRouter.delete('/session', (req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/local-web',
  })
  res.json({ ok: true })
})

/* -------------------- 本机监听端口扫描 -------------------- */

let scanCache = { at: 0, services: [] }

function formatIpv4(hex) {
  const n = Number.parseInt(hex, 16)
  // ⚠ `/proc/net/tcp` 里的 IPv4 是**小端序**：`0100007F` 就是 127.0.0.1，
  // 不是 1.0.0.127。所以必须从低字节往高字节取，而不是反过来。
  // 之前按大端读，于是每个回环监听都被解析成 `1.0.0.127` / `54.0.0.127` 之类，
  // 接着被 isLoopbackOrWildcard() 判成"非回环"而丢弃 —— 表现就是只剩下
  // `0.0.0.0` 上的服务能被扫出来（22/80/443），而绝大多数本地部署
  // （尤其 Docker 发布到 127.0.0.1 的端口）全都探测不到。
  return `${n & 255}.${(n >>> 8) & 255}.${(n >>> 16) & 255}.${(n >>> 24) & 255}`
}

function formatIpv6(hex) {
  const groups = hex.match(/.{8}/g) || []
  const bytes = []
  for (const group of groups) {
    // /proc/net/tcp6 每 8 个 hex 是一个 little-endian 32 位整数
    for (let i = 6; i >= 0; i -= 2) bytes.push(Number.parseInt(group.slice(i, i + 2), 16))
  }
  // 尽量压缩常见 IPv6 地址：::1 / :: / ::ffff:127.0.0.1
  if (bytes.every((b) => b === 0)) return '::'
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return '::1'
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return `::ffff:${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`
  }
  const words = []
  for (let i = 0; i < 16; i += 2) words.push(((bytes[i] << 8) | bytes[i + 1]).toString(16))
  return words.join(':').replace(/(^|:)0(?=:|$)/g, '$1').replace(/(^|:)0{1,}(?=:|$)/g, '$1').replace(/:{3,}/g, '::')
}

function parseProcNet(content, v6) {
  const out = []
  for (const line of content.split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 4 || parts[3] !== '0A') continue // 0A = LISTEN
    const local = parts[1] || ''
    const [addrHex, portHex] = local.split(':')
    const port = Number.parseInt(portHex, 16)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue
    const rawHost = v6 ? formatIpv6(addrHex) : formatIpv4(addrHex)
    const host = normalizeListenHost(rawHost)
    if (!isLoopbackOrWildcard(host)) continue
    out.push({ host, port })
  }
  return out
}

/** 把 netstat 输出里出现的任意监听地址归一化成可从回环访问的 host */
function normalizeListenHost(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase()
  if (h === '0.0.0.0' || h === '::' || h === '*') return '127.0.0.1'
  if (h === '::ffff:127.0.0.1') return '127.0.0.1'
  if (h.startsWith('::ffff:')) return h.slice(7) // Windows 上 IPv6-mapped IPv4
  if (h === '::1') return '[::1]'
  if (h === 'localhost') return '127.0.0.1'
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return h
  if (h.includes(':')) return `[${h}]` // 其它 IPv6 地址保留，但代理层仍只允许回环
  return h
}

function dedupe(entries) {
  const map = new Map()
  for (const { host, port } of entries) {
    const endpoint = `${host}:${port}`
    if (!map.has(endpoint)) map.set(endpoint, { host, port })
  }
  return [...map.values()]
}

function isLoopbackOrWildcard(host) {
  const h = String(host).replace(/^\[|\]$/g, '').toLowerCase()
  if (h === '0.0.0.0' || h === '::' || h === '*') return true
  if (h === 'localhost' || h === '::1') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  if (/^::ffff:(127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.test(h)) return true
  return false
}

function runNetstat() {
  return new Promise((resolve) => {
    const args = process.platform === 'win32' ? ['-ano', '-p', 'TCP'] : ['-tln']
    execFile('netstat', args, { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve('')
      resolve(String(stdout || ''))
    })
  })
}

function parseNetstat(content) {
  const isWin = process.platform === 'win32'
  const out = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    if (isWin) {
      if (parts[0]?.toUpperCase() !== 'TCP') continue
      if (!parts.includes('LISTENING')) continue
      const local = parts[1]
      if (!local) continue
      const idx = local.lastIndexOf(':')
      if (idx <= 0) continue
      const host = local.slice(0, idx)
      const port = Number(local.slice(idx + 1))
      if (!Number.isInteger(port) || port <= 0 || port > 65535) continue
      if (!isLoopbackOrWildcard(host)) continue
      out.push({ host: normalizeListenHost(host), port })
    } else {
      if (parts[0] !== 'tcp' && parts[0] !== 'tcp6') continue
      if (parts[parts.length - 1] !== 'LISTEN') continue
      const local = parts[3]
      if (!local) continue
      const idx = local.lastIndexOf(':')
      if (idx <= 0) continue
      const host = local.slice(0, idx)
      const port = Number(local.slice(idx + 1))
      if (!Number.isInteger(port) || port <= 0 || port > 65535) continue
      if (!isLoopbackOrWildcard(host)) continue
      out.push({ host: normalizeListenHost(host), port })
    }
  }
  return out
}

async function scanListeners() {
  let entries = []
  // Linux 优先读 /proc（无需 netstat，也更快）
  if (process.platform !== 'win32' && fs.existsSync('/proc/net/tcp')) {
    try {
      const v4 = fs.readFileSync('/proc/net/tcp', 'utf8')
      entries.push(...parseProcNet(v4, false))
    } catch { /* 继续尝试 netstat */ }
    try {
      if (fs.existsSync('/proc/net/tcp6')) {
        const v6 = fs.readFileSync('/proc/net/tcp6', 'utf8')
        entries.push(...parseProcNet(v6, true))
      }
    } catch { /* 继续 */ }
  }
  if (!entries.length) {
    entries = parseNetstat(await runNetstat())
  }
  const services = dedupe(entries).sort((a, b) => {
    if (a.port !== b.port) return a.port - b.port
    return a.host.localeCompare(b.host)
  }).map(({ host, port }) => {
    const endpoint = `${host}:${port}`
    return {
      id: endpoint,
      endpoint,
      host,
      port,
      current: Number(port) === Number(PORT),
    }
  })
  return services
}

async function getServices(force = false) {
  const now = Date.now()
  if (!force && now - scanCache.at < SCAN_TTL_MS && scanCache.services.length) return scanCache.services
  const services = await scanListeners()
  scanCache = { at: now, services }
  return services
}

apiRouter.get('/services', authRequired, async (req, res) => {
  try {
    const force = req.query.force === '1'
    if (force) scanCache = { at: 0, services: [] }
    const services = await getServices(force)
    res.json({ services, scannedAt: scanCache.at })
  } catch (e) {
    res.status(500).json({ error: { code: 'SCAN_FAILED', message: e.message || '本机端口扫描失败' } })
  }
})

/* -------------------- 反向代理 -------------------- */

function parseEndpoint(endpoint) {
  if (typeof endpoint !== 'string') return null
  const idx = endpoint.lastIndexOf(':')
  if (idx <= 0) return null
  let host = endpoint.slice(0, idx).trim()
  const portText = endpoint.slice(idx + 1).trim()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  host = host.toLowerCase()
  if (host === '0.0.0.0' || host === '::') host = '127.0.0.1'
  const isLoopback =
    host === 'localhost' ||
    host === '::1' ||
    host === '127.0.0.1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  if (!isLoopback) return null
  if (/^::ffff:/.test(host)) host = host.slice(7)
  const port = Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  const formatHost = host === '::1' ? '[::1]' : host
  return { host, port, formatHost }
}

function readCookie(req, name) {
  const header = req.headers.cookie || ''
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim())
      } catch {
        return part.slice(eq + 1).trim()
      }
    }
  }
  return null
}

function localWebAuth(req, res, next) {
  let token = readCookie(req, COOKIE_NAME)
  if (!token && typeof req.query.token === 'string' && req.query.token) token = req.query.token
  let ok = false
  try {
    const payload = jwt.verify(token || '', JWT_SECRET)
    ok = payload?.role === 'admin' && payload?.purpose === 'local-web' && payload?.v === 2
  } catch {
    ok = false
  }
  if (!ok) {
    return res.status(401).type('text/plain; charset=utf-8').send(
      'AniHub 本地 Web 代理：登录已失效。请回到“控制台 → 本地 Web”，刷新授权后重新打开。'
    )
  }
  next()
}

/**
 * 转发给上游的请求头。逐跳头必须去掉（交给 Node 管理本连接）。
 *
 * ⚠⚠ `Cookie` 这里**不能整个删掉**，否则任何"用自家 Cookie 做会话"的本地服务都登不上。
 * 典型症状：上游第一次回 303 并 `Set-Cookie`，代理把它改写成前缀内的 Path、
 * 浏览器也老老实实带回来了，但代理转发时把整个 `Cookie` 丢掉 →
 * 上游收不到自己的会话 Cookie，继续回 401（表现为"这个页面死活打不开，
 * 而别的本地服务却正常"）。
 * 正确做法：只剔掉**代理自己**那个会话 Cookie（`anihub_local_web`，路径在 /local-web 下），
 * 其余原样转发给上游。
 */
function upstreamCookieHeader(cookieHeader) {
  if (!cookieHeader) return null
  const kept = String(cookieHeader)
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => {
      const eq = p.indexOf('=')
      const name = eq < 0 ? p : p.slice(0, eq).trim()
      return name !== COOKIE_NAME
    })
  return kept.length ? kept.join('; ') : null
}

function hopByHopHeaders(headers) {
  const out = { ...headers }
  delete out.host
  // Cookie 单独处理：只去掉代理自己的会话 Cookie，其余转发给上游（见 upstreamCookieHeader）
  const cookie = upstreamCookieHeader(headers.cookie)
  if (cookie) out.cookie = cookie
  else delete out.cookie
  // ⚠⚠ `Authorization` 不能删：它**不是**逐跳头。上游用 Bearer 令牌做会话的
  // 服务（实测 SnowLuma WebUI，本机 5099）登录请求本身不需要令牌、能过，
  // 但登录成功后所有带 `Authorization: Bearer <token>` 的接口在代理后面恒定 401 ——
  // 浏览器侧表现为"密码没错、点了进入控制台却死活不跳转"。
  // 代理自己的授权走 Cookie（anihub_local_web）/ `?token=`，与这个头无关，原样透传即可。
  delete out.connection
  delete out['proxy-connection']
  delete out['keep-alive']
  delete out['transfer-encoding']
  delete out.upgrade
  delete out.te
  delete out.trailer
  delete out['proxy-authenticate']
  delete out['proxy-authorization']
  // 保留合法 Content-Length 能让上游尽量少用 chunked；没有则 Node 按 req.pipe 自动处理
  const declared = headers['content-length']
  if (declared && /^\d+$/.test(String(declared))) out['content-length'] = String(declared)
  return out
}

function proxyPrefix(endpoint) {
  return `/local-web/http/${endpoint.formatHost}:${endpoint.port}`
}

/** 上游自己的 origin（浏览器直连该服务时会用的那个）。 */
function upstreamOrigin(endpoint) {
  return `http://${endpoint.formatHost}:${endpoint.port}`
}

/** 只看主机名（去掉端口）的规范化形式，用来容忍中间层丢端口的 Host 改写。 */
function hostNameOf(authority) {
  try {
    return new URL(`http://${String(authority || '')}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * 把浏览器的来源头（`Origin` / `Referer`）改写成**上游视角**的值。
 *
 * ⚠⚠ 代理转发时会把 `Host` 改写成 `127.0.0.1:<port>`（上游才知道自己是谁），
 * 但浏览器附带的 `Origin` / `Referer` 仍然是**站点自己的地址**。上游只要做了
 * 同源 / CSRF 栅栏，就会把这条请求判成"跨站发来的"而拒绝 —— 表现是页面能打开、
 * 一类调用（多为 POST）却恒定失败。
 *
 * 实测（DSH Web GUI，即本机 3080 的 `dsh web`）：
 *   - `POST /api/llm/listProviders` 带 `Origin: http://<站点>` 经代理转发后回 `403 forbidden`
 *     （上游 `isTrustedApiRequest()` 的比较是 `new URL(origin).host === host`），
 *     页面上的表现是"模型：加载提供方目录失败"；
 *   - 不带 `Origin` 时同一条请求 200。
 *
 * "这条请求确实来自站点自己的页面"按三条**任一**成立判定：
 *   1. 浏览器自带标记 `sec-fetch-site` 是 `same-origin` / `same-site`（最可靠：浏览器自己说的）；
 *   2. Origin 的 `host` 与本站 Host 完全一致；
 *   3. Origin 的**主机名**与本站 Host 的主机名一致（端口不同也算）—— 中间层
 *      （nginx `proxy_set_header Host $host;`、隧道、端口转发）可能把 Host 的端口吃掉，
 *      这种"端口对不上"会让判定整体失效、上游继续 403。
 * 外部来源与 `null`（不透明来源）一律原样保留，不替上游洗白。
 *
 * `Referer` 用同一套判定：命中就按前缀映射成上游地址，指向站点其它页面则删掉。
 *
 * @param headers - 即将发给上游的可变头对象（尚未改写 `host`）。
 * @param endpoint - 目标回环服务。
 * @param siteHost - 浏览器请求本站时用的 Host（`req.headers.host`）。
 */
function rewriteUpstreamSourceHeaders(headers, endpoint, siteHost) {
  const origin = upstreamOrigin(endpoint)
  const site = String(siteHost || '').toLowerCase()
  const siteName = hostNameOf(siteHost)
  const marker = String(headers['sec-fetch-site'] || '').toLowerCase()
  const browserSaysSameSite = marker === 'same-origin' || marker === 'same-site'
  const isOurPage = (host, hostname) => {
    if (browserSaysSameSite) return true
    if (host && String(host).toLowerCase() === site) return true
    return Boolean(siteName) && String(hostname || '').toLowerCase() === siteName
  }
  if (headers.origin && headers.origin !== 'null') {
    try {
      const ref = new URL(headers.origin)
      if (isOurPage(ref.host, ref.hostname)) headers.origin = origin
    } catch { /* 解析不了就原样保留 */ }
  }
  if (headers.referer) {
    try {
      const ref = new URL(headers.referer)
      if (isOurPage(ref.host, ref.hostname)) {
        const prefix = proxyPrefix(endpoint)
        if (ref.pathname.startsWith(prefix)) {
          headers.referer = `${origin}${ref.pathname.slice(prefix.length)}${ref.search}`
        } else {
          delete headers.referer
        }
      }
    } catch { /* 解析不了就原样保留 */ }
  }
}

const HTML_REWRITE_LIMIT = 10 * 1024 * 1024

/** 在 HTML 中注入/改写 <base href>，让 Vue Router 等前端路由把根路径
 *  拼到当前代理前缀下，而不是跳回网站根路径。 */
function ensureProxyBase(html, prefix) {
  const proxyBase = `${prefix}/`
  if (/<base\b/i.test(html)) {
    return html.replace(/<base\b[^>]*>/gi, (tag) => {
      if (!/\bhref\s*=/i.test(tag)) return tag
      return tag.replace(
        /(\bhref\s*=\s*)(["']?)([^"' >]+)(\2)/i,
        (match, pre, quote, oldHref, closingQuote) => {
          if (/^https?:\/\//i.test(oldHref)) return match
          if (oldHref.startsWith('/local-web/http/')) return match
          const href = oldHref.startsWith('/') ? prefix + oldHref : proxyBase
          return `${pre}${quote}${href}${closingQuote}`
        }
      )
    })
  }
  return html.replace(/(<head[^>]*>)/i, `$1<base href="${proxyBase}">`)
}

/** 把本地服务返回的 HTML 中“根路径引用”改写到当前代理前缀下：
 *  - 标签属性里的资源地址（href/src/action/...）与 CSS url()/srcset；
 *  - 内联脚本里的 `/plugins/`、`/assets/` 字面量（见 rewriteInlineScriptPaths）；
 *  只按"明确的资源前缀"改写，不碰前端路由字符串（改错会把 SPA 拆坏）。 */
function rewriteLocalHtml(html, endpoint) {
  const prefix = proxyPrefix(endpoint)
  let out = ensureProxyBase(html, prefix)
  // href / src / action / poster 等根路径资源
  out = out.replace(
    /(\b(?:href|src|action|poster|data-src|data-href|data-url|formaction)\s*=\s*["'])\/(?!\/|local-web\/http\/)/gi,
    `$1${prefix}/`
  )
  // CSS url(/...)（含 <style> 与内联 style）
  out = out.replace(/(url\s*\(\s*["']?)\/(?!\/|local-web\/http\/)/gi, `$1${prefix}/`)
  // srcset 内的根路径项（保留 1x/2x 描述符）
  out = out.replace(/(\bsrcset\s*=\s*["'])([^"']*)/gi, (match, open, value) => {
    const next = value
      .split(',')
      .map((part) => {
        const trimmed = part.trim()
        const sp = trimmed.search(/\s/)
        const url = sp < 0 ? trimmed : trimmed.slice(0, sp)
        const desc = sp < 0 ? '' : trimmed.slice(sp)
        if (!url.startsWith('/') || url.startsWith('//') || url.startsWith('/local-web/http/')) return trimmed
        return prefix + url + desc
      })
      .join(', ')
    return open + next
  })
  // 内联脚本里的引导数据（/plugins/、/assets/）→ 加前缀
  out = rewriteInlineScriptPaths(out, prefix)
  // 上游自己的绝对地址（http/https://127.0.0.1:<port>/… 等三种回环写法）→ 前缀
  out = out.replace(upstreamAbsoluteUrlPattern(endpoint, 'https?'), prefix)
  // ⚠ 注入脚本必须放在**所有文本改写之后**：垫片自身也是页面文本，
  // 先注入就会被上面的属性 / url() 正则改写。
  // 垫片紧跟 <head> 之后（最早执行）；Service Worker 注册放 </head> 前。
  out = injectAfterHead(out, apiShimScript(prefix, endpoint))
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${serviceWorkerScript()}</head>`)
  return out
}

/**
 * 匹配「上游自己的绝对地址」的正则：`<scheme>://<回环写法>:<端口>`。
 *
 * 很多本地服务会把自身地址硬编码进前端（配置文件、注入的 runtime config、
 * 拼接的接口地址），写法可能是 `127.0.0.1` / `localhost` / `[::1]`。
 * 不改写的话，浏览器会去**访问者自己的机器**上找这个端口 —— 远程通过统一入口
 * 访问时必然失败（而这恰恰是"统一 Web"要解决的场景）。
 *
 * 只认**同端口**：端口相同才说明指的是同一个本机服务；不同端口是另一个服务，
 * 不能替它做主（也就不会把用户故意指向别的端口的地址改写掉）。
 *
 * @param endpoint - 当前目标回环服务。
 * @param schemes - 要匹配的协议（HTML/JS 文本里用 `https?`；ws 交给页面垫片）。
 */
function upstreamAbsoluteUrlPattern(endpoint, schemes) {
  const hosts = ['127\\.0\\.0\\.1', 'localhost', '\\[::1\\]']
  return new RegExp(`\\b(?:${schemes})://(?:${hosts.join('|')}):${endpoint.port}(?=[/?#"'\\s]|$)`, 'gi')
}

/**
 * 改写**内联 `<script>` 正文**里的根路径资源 URL（`/plugins/`、`/assets/`）。
 *
 * ⚠ 为什么不能只靠 Service Worker：内联脚本里的 `<script>` 引导数据
 * （例如 DSH 的 `globalThis.__DSH_BOOT__ = {...batches:[{url:"/plugins/??..."}]}`）
 * 是**运行期**再去取脚本的，属性改写够不着、页面垫片也拦不住（可能是 `import()`）。
 * 而 SW 接管存在先有鸡还是先有蛋的竞态：**首次打开时**引导数据往往早于
 * `clients.claim()` 生效，那批 `/plugins/??...` 就会打到站点根路径上
 * （生产站会落进 SPA fallback 返回 HTML，控制台报 `Unexpected token '<'`；
 * 表现为首屏丢模块、"自动重连中…"或设置页空白）。
 * 这里直接按前缀改写，从源头消除竞态。
 *
 * 只改 `"/plugins/`、`'/plugins/`、`` `/plugins/ `` 这类**字符串字面量开头**的地址，
 * 不碰其它根路径字符串（前端路由字符串被改写会直接把 SPA 拆坏）。
 */
function rewriteInlineScriptPaths(html, prefix) {
  return html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (match, open, body, close) => {
    if (/\bsrc\s*=/i.test(open)) return match
    const next = body.replace(/(["'`])\/(plugins|assets)\//g, `$1${prefix}/$2/`)
    return next === body ? match : open + next + close
  })
}

/** 在 `<head>` 开始标签之后插入一段内联脚本（没有 `<head>` 就原样返回）。 */
function injectAfterHead(html, snippet) {
  const match = /<head[^>]*>/i.exec(html)
  if (!match) return html
  const at = match.index + match[0].length
  return html.slice(0, at) + snippet + html.slice(at)
}

/** 注册同源 Service Worker：把页面里发往网站根路径的同源请求（例如 SPA 里
 *  `import('/plugins/...')`、`fetch('/api/...')`）改写到当前代理前缀。 */
function serviceWorkerScript() {
  return `<script>(function(){try{if('serviceWorker' in navigator&&location.pathname.indexOf('/local-web/http/')===0){navigator.serviceWorker.register('/local-web/sw.js',{scope:'/local-web/'}).catch(function(){})}}catch(e){}})();<\/script>`
}

/**
 * 注入到被代理页面最前面的 API 垫片：把 `fetch` / `XMLHttpRequest` / `WebSocket`
 * 的目标地址改写到当前代理前缀。
 *
 * 为什么 SW 之外还要这个：
 *   1. **Service Worker 拦截不到 WebSocket 握手** —— 实时通道（DSH 的
 *      `/api/remote.mux`）只能靠改 WebSocket 构造参数指回代理前缀；
 *   2. SW 只能在安全上下文注册（https / localhost）。站点若从局域网 `http://IP`
 *      打开，navigator.serviceWorker 直接不存在，垫片是此时唯一的改写手段；
 *   3. 带 body 的请求经 SW 转发要处理 `duplex` 之类的坑，页面内直接改写少一层。
 *
 * 只处理**同源**请求，且已带前缀的地址不重复改写：与 SW 的分工互不冲突
 * （垫片改过的请求落到 `/local-web/...`，SW 会原样放行）。
 *
 * @param prefix - 当前服务的代理前缀（如 `/local-web/http/127.0.0.1:3080`）。
 * @param endpoint - 当前目标回环服务（垫片要用它的端口识别"写死自身地址"的 URL）。
 */
function apiShimScript(prefix, endpoint) {
  return `<script>(function(){
/* ⚠⚠ 让页面以「操作者本机」语义运行（统一 Web 入口的关键一步）。
 *
 * 背景：DSH 客户端把「本页是否拥有 Host」当成权限判据 ——
 *   packages/client/connection/src/client/index.ts
 *     pageLocation = location; transport = globalThis.__DSH_TRANSPORT__
 *     isLoopback = transport?.ownsHost === true || isLoopbackHostname(location.hostname)
 *   packages/client/ui-settings/src/client/index.ts
 *     persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'
 * 于是从**域名**（我们的统一入口）打开时 hostname 不是回环 → 设置镜像被设成 memory，
 * settings/describe 根本不会发出 → 设置/模型 页恒显示
 * "settings are unavailable in this browser"，工作区相关面板同样残缺。
 *
 * 这里声明 ownsHost（DSH 自己的官方缝隙：其注释写明 served pages never carry the
 * global）。连接插件因此把 isLoopback 置真，而传输层**原样回落到 HTTP + WebSocket**
 * —— 见 rpc = ... ?? createWebConnectionRpc(transport?.fetch, transport?.openStream)，
 * 只给 ownsHost 时 fetch/openStream 都是 undefined，走浏览器默认通道，不打断链路。
 *
 * 为什么在代理里声明是成立的：本页面只对**已登录的管理员**开放，且请求一律转发到
 * 回环地址上的上游（localWebAuth + parseEndpoint 双重限制），也就是说这一页确实独占
 * 该 Host —— 正是 ownsHost 的语义。放到域名下只是把通道换成公开入口，
 * 信任边界仍然等于站点管理员会话。
 *
 * 已存在 __DSH_TRANSPORT__ 时**不覆盖**（worker/desktop 外壳自带真传输）。 */
try {
  var g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (!g.__DSH_TRANSPORT__) g.__DSH_TRANSPORT__ = { ownsHost: true };
} catch (e) { /* 忽略 */ }
var PREFIX = ${JSON.stringify(prefix)};
var PORT = ${JSON.stringify(String(endpoint.port))};
var ORIGIN = location.origin;
var HOST = location.host;
function fixPath(pathname) {
  if (pathname.charAt(0) !== '/' || pathname.charAt(1) === '/') return pathname;
  if (pathname === PREFIX || pathname.indexOf(PREFIX + '/') === 0) return pathname;
  return PREFIX + pathname;
}
/* 上游自己的绝对地址（http(s)/ws(s)://127.0.0.1|localhost|[::1]:<本端口>/…）→ 代理前缀。
   很多服务的配置/前端会把自身地址写死；远程访问时那个 127.0.0.1 指的是**访问者的机器**，
   必须拦下来改写到代理前缀，否则接口/实时通道都会指向错误的地方。只认同端口。 */
function fixUpstream(href) {
  try {
    var target = new URL(String(href), location.href);
    if (target.port !== PORT) return href;
    if (!/^(127\\.0\\.0\\.1|localhost|\\[::1\\])$/.test(target.hostname)) return href;
    var path = PREFIX + (target.pathname.charAt(0) === '/' ? target.pathname : '/' + target.pathname);
    if (target.protocol === 'ws:' || target.protocol === 'wss:') {
      var wsScheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return wsScheme + '//' + location.host + path + target.search + target.hash;
    }
    return ORIGIN + path + target.search + target.hash;
  } catch (e) { return href; }
}
function fix(href) {
  try {
    var target = new URL(String(href), location.href);
    if (target.origin !== ORIGIN) return fixUpstream(href);
    var pathname = fixPath(target.pathname);
    if (pathname === target.pathname) return href;
    target.pathname = pathname;
    return target.href;
  } catch (e) { return href; }
}
var rawFetch = window.fetch;
if (rawFetch) {
  window.fetch = function (input, init) {
    try {
      if (typeof input === 'string') return rawFetch.call(this, fix(input), init);
      if (typeof URL !== 'undefined' && input instanceof URL) return rawFetch.call(this, fix(input.href), init);
      if (typeof Request !== 'undefined' && input instanceof Request) {
        var moved = fix(input.url);
        if (moved !== input.url) return rawFetch.call(this, new Request(moved, input), init);
      }
    } catch (e) { /* 交给原生实现，出问题按原样发 */ }
    return rawFetch.call(this, input, init);
  };
}
var rawOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, target) {
  var args = Array.prototype.slice.call(arguments);
  try { args[1] = fix(target); } catch (e) { /* 原样发 */ }
  return rawOpen.apply(this, args);
};
var RawWebSocket = window.WebSocket;
if (RawWebSocket) {
  // ws:/wss: 的 URL.origin 与页面的 http(s) origin 不同，所以这里比较 host；
  // 另外先过一遍 fixUpstream（服务把自己写死成 127.0.0.1:<port> 的实时通道）
  var fixSocketUrl = function (address) {
    try {
      var raw = String(address && address.url ? address.url : address);
      var upstream = fixUpstream(raw);
      if (upstream !== raw) return upstream;
      var target = new URL(raw, location.href);
      if (target.host !== HOST) return address;
      var pathname = fixPath(target.pathname);
      if (pathname === target.pathname) return address;
      target.pathname = pathname;
      if (target.protocol === 'http:') target.protocol = 'ws:';
      else if (target.protocol === 'https:') target.protocol = 'wss:';
      return target.href;
    } catch (e) { return address; }
  };
  var ProxyWebSocket = function (address, protocols) {
    return protocols === undefined
      ? new RawWebSocket(fixSocketUrl(address))
      : new RawWebSocket(fixSocketUrl(address), protocols);
  };
  ProxyWebSocket.prototype = RawWebSocket.prototype;
  ProxyWebSocket.CONNECTING = 0;
  ProxyWebSocket.OPEN = 1;
  ProxyWebSocket.CLOSING = 2;
  ProxyWebSocket.CLOSED = 3;
  window.WebSocket = ProxyWebSocket;
}
})();<\/script>`
}

function rewriteLocation(endpoint, loc) {
  if (!loc) return loc
  if (loc.startsWith(proxyPrefix(endpoint))) return loc
  if (loc.startsWith('/')) return proxyPrefix(endpoint) + loc
  if (/^https?:\/\//i.test(loc)) {
    try {
      const u = new URL(loc)
      const isLocal =
        u.hostname === 'localhost' ||
        u.hostname === '127.0.0.1' ||
        u.hostname === '[::1]' ||
        u.hostname === '::1' ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(u.hostname)
      if (isLocal && (!u.port || Number(u.port) === Number(endpoint.port))) {
        return proxyPrefix(endpoint) + u.pathname + u.search
      }
    } catch {
      return loc
    }
  }
  // 相对 Location 会由浏览器基于当前代理前缀继续解析，保持原样
  return loc
}

function rewriteSetCookie(endpoint, cookie) {
  const parts = String(cookie).split(';').map((p) => p.trim()).filter(Boolean)
  // 去掉 Domain / 原 Path / Secure，统一把 Cookie 限制在本服务的代理前缀下。
  // 这样不同本地服务的同名 Cookie 不会串，也不会污染网站根路径。
  const kept = parts.filter((p) => !/^domain=/i.test(p) && !/^path=/i.test(p) && !/^secure/i.test(p))
  const normalized = kept.map((p) => (/^samesite=/i.test(p) ? 'SameSite=Lax' : p))
  normalized.push(`Path=${proxyPrefix(endpoint)}`)
  return normalized.join('; ')
}

/** 改写外部 JS 里常见的 API 根路径：
 *  1. axios.create({ baseURL: "/api" })
 *  2. 动态拼接的 /api/reports/xxx、/api/jobs/xxx 等字符串
 *  3. 把**服务自身地址**写死的字符串（`http://127.0.0.1:<port>/…`）
 *  不能把所有根路径字符串都改写，否则会破坏前端路由字符串。 */
function rewriteLocalJavaScript(js, endpoint, browserPrefix) {
  const prefix = proxyPrefix(endpoint)
  let out = js.replace(/(\bbaseURL\s*[:=]\s*["'])\/(?!\/|local-web\/http\/)/g, `$1${prefix}/`)
  // 只处理明确的资源/接口根路径；不碰 /dashboard、/selection 等前端路由：
  //   /api/     —— 后端接口
  //   /plugins/、/assets/ —— 被代理服务的构建产物（动态 import / 运行时拼地址，
  //                          例如 DSH 的 `import("/plugins/??...")`）
  out = out.replace(/(["'`])\/api\//g, `$1${prefix}/api/`)
  out = out.replace(/(["'`])\/(plugins|assets)\//g, `$1${prefix}/$2/`)
  // 服务把自身地址写成绝对 URL（含 token 类的服务很常见）→ 前缀路径。
  // ws(s) 的绝对地址留给页面垫片在运行期处理（静态文本里改协议会把 URL 弄坏）。
  out = out.replace(upstreamAbsoluteUrlPattern(endpoint, 'https?'), prefix)
  // 最后再注入 SPA 路由 basepath：必须排在其它文本改写之后，
  // 免得刚注入的前缀又被上面的根路径正则再改写一遍。
  return injectSpaRouterBasepath(out, browserPrefix || prefix)
}

/**
 * 给「自己按 `location.pathname` 匹配路由」的 SPA 注入路由 basepath。
 *
 * ⚠⚠ 为什么注入的 `<base href>` 救不了这类 SPA：`<base>` 只影响**相对 URL 解析**，
 * 而 TanStack Router 直接读 `window.location.pathname`（SnowLuma 的 bundle 里没有任何
 * 读取 `baseURI` / `<base>` 的代码，`createRouter({...})` 也没传 `basepath`）。
 * 于是服务挂到 `/local-web/http/<endpoint>` 前缀下时，路由器把前缀当成路由路径，
 * 匹配不到任何路由 → 渲染它自己的 `defaultNotFoundComponent`。
 * 实测表现（SnowLuma 控制台，`127.0.0.1:5099`）：密码校验通过、登录请求 200，
 * 一进控制台却是它前端的「页面不存在 404」，而服务器侧全程 200（nginx 访问日志里
 * 一条 404 都没有）—— 极容易被误判成"代理把页面搞坏了"。
 *
 * 这里只做一件极窄的事：在 `defaultPreload:`intent``（TanStack Router 应用的典型
 * 选项，SnowLuma 打包产物里唯一一处）前面补一个 `basepath:"<前缀>"`。
 * 该选项会被库翻译成一条 rewrite（`Bn`）：读 location 时**剥掉**前缀（路径恰好等于
 * 前缀则视为 `/`），生成 href 时再**拼回**前缀 —— 路由匹配、刷新、深链因此全部
 * 落回代理前缀内，不依赖任何前端改造。
 *
 * ⚠ 这是按上游打包产物做的窄匹配：SnowLuma 升级后 minify 结果变了就可能失配，
 * 失配时这里保持原样（页面会再次前端 404），所以下面会打日志，便于一眼定位。
 *
 * @param js - 已完成其它改写、即将发给浏览器的 JS 文本。
 * @param prefix - 浏览器地址栏里实际使用的前缀（`/local-web/http/<endpoint>`）。
 */
const TANSTACK_ROUTER_OPTIONS_RE = /defaultPreload\s*:\s*`intent`/

function injectSpaRouterBasepath(js, prefix) {
  if (!TANSTACK_ROUTER_OPTIONS_RE.test(js)) {
    // 自检：认得出是 TanStack Router 应用却没匹配到注入点 → 大概率是上游升级换了产物
    if (/defaultNotFoundComponent/.test(js)) {
      console.warn(
        '[local-web] JS 里出现 TanStack Router 的 defaultNotFoundComponent，但没匹配到 defaultPreload 选项：' +
          `basepath=${prefix} 未注入（上游可能已升级，请更新注入规则），页面可能再次出现前端 404`
      )
    }
    return js
  }
  const inject = `basepath:${JSON.stringify(prefix)},defaultPreload:\`intent\``
  if (js.includes(inject)) return js
  console.info(`[local-web] 已为上游 JS 注入 SPA 路由 basepath=${prefix}（TanStack Router）`)
  return js.replace(new RegExp(TANSTACK_ROUTER_OPTIONS_RE.source, 'g'), inject)
}

function handleProxy(req, res) {
  const endpoint = parseEndpoint(req.params.endpoint)
  if (!endpoint) {
    return res.status(400).json({ error: { code: 'INVALID_ENDPOINT', message: '仅支持访问本机回环地址（localhost / 127.0.0.1 / [::1]）' } })
  }

  const marker = `/local-web/http/${req.params.endpoint}`
  let suffix = (req.originalUrl || req.url).slice(marker.length)
  if (!suffix) suffix = '/'
  const qIdx = suffix.indexOf('?')
  const pathPart = qIdx < 0 ? suffix : suffix.slice(0, qIdx)
  const queryPart = qIdx < 0 ? '' : suffix.slice(qIdx)
  const targetPath = `${pathPart.startsWith('/') ? pathPart : '/' + pathPart}${queryPart}`

  const target = new URL(`http://${endpoint.formatHost}:${endpoint.port}${targetPath}`)
  const headers = hopByHopHeaders(req.headers)
  // 来源头（Origin / Referer）必须先按"站点 Host"判断再改写 —— 必须在下面
  // `headers.host` 换成上游之前调用；改写后**不要**再从 req.headers 覆盖回来
  // （这两个头正是"POST 恒定 403 forbidden"的成因，见 rewriteUpstreamSourceHeaders）。
  rewriteUpstreamSourceHeaders(headers, endpoint, req.headers.host)
  headers.host = target.host
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']
  if (req.headers['accept']) headers.accept = req.headers.accept
  if (req.headers['accept-language']) headers['accept-language'] = req.headers['accept-language']
  if (req.headers['user-agent']) headers['user-agent'] = req.headers['user-agent']
  if (req.headers['x-requested-with']) headers['x-requested-with'] = req.headers['x-requested-with']
  /* ⚠⚠ 必须向上游声明 `Accept-Encoding: identity`。
     否则浏览器会把自己的 `accept-encoding: gzip, deflate` 透传给上游，上游就可能回
     **gzip 压缩体**；而 HTML/JS 的路径改写是**按文本做的**（`<base>` 注入、
     `/api` → 前缀改写），拿到压缩字节就完全改不动 —— 只能原样透传。
     后果：目标页面里的 `/plugins/...`、`/assets/...` 等绝对路径不会被加前缀，
     浏览器会去**主站**根路径取这些资源，拿到 HTML 而不是 JS，
     控制台报 `SyntaxError: Unexpected token '<'`，页面空白。
     实测：`http://127.0.0.1:3080/` 直连响应 `content-encoding: gzip` + `transfer-encoding: chunked`，
     加上这条之后上游回明文，改写才真正生效。
     代价可忽略：这是本机回环代理，不压缩反而省 CPU。 */
  headers['accept-encoding'] = 'identity'

  const upstream = http.request(target, { method: req.method, headers }, (upRes) => {
    /* 诊断：上游回 403 基本只有一个含义 —— 它把这条**转发过来的**请求判成了不可信
       （同源 / CSRF / 权限栅栏）。这是最容易被误判成"代理坏了"的一类失败，所以直接
       把代理实际发出的来源头打出来：对照 `origin` 与 `host` 一眼就能看出是不是没改写成功。
       （401 太常见——上游自己的登录流程也会回 401——所以只记 403。） */
    if (upRes.statusCode === 403) {
      console.warn(
        `[local-web] 上游 403：${req.method} ${targetPath} → ${endpoint.formatHost}:${endpoint.port}` +
          ` | 浏览器 host=${String(req.headers.host || '-')} origin=${String(req.headers.origin || '-')}` +
          ` referer=${String(req.headers.referer || '-')} sec-fetch-site=${String(req.headers['sec-fetch-site'] || '-')}` +
          ` | 转发给上游 host=${String(headers.host || '-')} origin=${String(headers.origin || '-')}` +
          ` referer=${String(headers.referer || '-')}`
      )
    }
    const responseHeaders = { ...upRes.headers }
    if (responseHeaders.location) {
      responseHeaders.location = rewriteLocation(endpoint, responseHeaders.location)
    }
    if (responseHeaders['set-cookie']) {
      responseHeaders['set-cookie'] = responseHeaders['set-cookie'].map((c) => rewriteSetCookie(endpoint, c))
    }
    // 代理内容会随本地服务/前缀改写变化，统一禁用缓存，避免浏览器拿到旧 JS/HTML
    responseHeaders['Cache-Control'] = 'no-store'
    // 清理上游的逐跳头，交给 Node 管理本连接的传输编码/连接头
    delete responseHeaders['transfer-encoding']
    delete responseHeaders.connection
    delete responseHeaders['keep-alive']
    delete responseHeaders.upgrade
    delete responseHeaders.proxyAuthenticate
    delete responseHeaders['proxy-authenticate']

    const contentType = String(upRes.headers['content-type'] || '')
    const declaredLen = Number(upRes.headers['content-length'])
    /* ⚠ 改写条件**不能要求 `content-length`**。
       上游常用 `transfer-encoding: chunked`（没有 content-length），
       老条件 `Number.isFinite(declaredLen) && declaredLen > 0` 会直接判否 →
       HTML/JS 原样透传、`<base>` 不注入、路径不改写（这正是"页面打开是空白、
       控制台报 `Unexpected token '<'`"的原因之一）。
       现在：有 length 就按 length 预判，没有就**先收下来**、在累积过程中用
       `HTML_REWRITE_LIMIT` 兜住内存（超限立即改为直通，不再缓存）。 */
    const lenOk = (n) => !Number.isFinite(n) || n <= HTML_REWRITE_LIMIT
    const canRewriteHtml = upRes.statusCode === 200 && /text\/html/i.test(contentType) && lenOk(declaredLen)

    if (canRewriteHtml) {
      const chunks = []
      let bytes = 0
      let overflowed = false
      upRes.on('data', (c) => {
        bytes += c.length
        if (bytes > HTML_REWRITE_LIMIT) {
          // 超限：把已收的先写出去，剩下直通（避免为超大页面占内存）
          if (!overflowed) {
            overflowed = true
            res.writeHead(upRes.statusCode || 200, responseHeaders)
            for (const b of chunks) res.write(b)
            chunks.length = 0
          }
          res.write(c)
          return
        }
        chunks.push(c)
      })
      upRes.on('end', () => {
        if (overflowed) return res.end()
        let body = Buffer.concat(chunks).toString('utf8')
        body = rewriteLocalHtml(body, endpoint)
        delete responseHeaders['content-length']
        responseHeaders['content-length'] = Buffer.byteLength(body)
        res.writeHead(upRes.statusCode || 200, responseHeaders)
        res.end(body)
      })
      return
    }

    const canRewriteJs = upRes.statusCode === 200 && /javascript/i.test(contentType) && lenOk(declaredLen)

    if (canRewriteJs) {
      const chunks = []
      let bytes = 0
      let overflowed = false
      upRes.on('data', (c) => {
        bytes += c.length
        if (bytes > HTML_REWRITE_LIMIT) {
          // 与 HTML 分支同理：超限就改成直通，避免为超大 JS 占内存
          if (!overflowed) {
            overflowed = true
            res.writeHead(upRes.statusCode || 200, responseHeaders)
            for (const b of chunks) res.write(b)
            chunks.length = 0
          }
          res.write(c)
          return
        }
        chunks.push(c)
      })
      upRes.on('end', () => {
        if (overflowed) return res.end()
        let body = Buffer.concat(chunks).toString('utf8')
        body = rewriteLocalJavaScript(body, endpoint, marker)
        delete responseHeaders['content-length']
        responseHeaders['content-length'] = Buffer.byteLength(body)
        res.writeHead(upRes.statusCode || 200, responseHeaders)
        res.end(body)
      })
      return
    }

    res.writeHead(upRes.statusCode || 502, responseHeaders)
    upRes.pipe(res)
  })

  // 空闲超时（上游多久没吐字节才算挂死；见 UPSTREAM_TIMEOUT_MS 的注释）
  upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
    upstream.destroy(new Error(`upstream timeout（${Math.round(UPSTREAM_TIMEOUT_MS / 1000)}s 无响应）`))
  })
  upstream.on('error', (err) => {
    // 浏览器已经走了（关标签页 / 前端 abort）：别再往上写响应，直接收摊
    if (res.writableEnded || res.destroyed) return
    if (res.headersSent) {
      res.destroy(err)
      return
    }
    const message = err?.code === 'ECONNREFUSED'
      ? `无法连接 ${endpoint.formatHost}:${endpoint.port}（服务未启动或不是 HTTP 服务）`
      : `代理失败：${err?.message || '未知错误'}`
    res.status(502).json({ error: { code: 'PROXY_FAILED', message } })
  })
  // 客户端提前断开（用户切走 / 前端取消）→ 立刻掐掉上游请求。
  // 超时放宽到分钟级之后，这一步是必须的：否则每条被放弃的慢请求都会占着上游连接。
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy(new Error('client aborted'))
  })
  req.pipe(upstream)
}

proxyRouter.get('/sw.js', (req, res) => {
  res.type('text/javascript; charset=utf-8').set('Cache-Control', 'no-store').send(`/* AniHub 本地 Web Service Worker：把受控页面里发往本域根路径的请求改写回代理前缀 */
const PROXY_PREFIX = '/local-web/http/';
function endpointFromPath(pathname) {
  if (!pathname || pathname.indexOf(PROXY_PREFIX) !== 0) return null;
  const rest = pathname.slice(PROXY_PREFIX.length);
  const slash = rest.indexOf('/');
  return slash < 0 ? (rest || null) : rest.slice(0, slash);
}
function endpointFromUrl(value) {
  try { return endpointFromPath(new URL(value).pathname); } catch (e) { return null; }
}
async function findEndpoint(event) {
  try {
    if (event.clientId) {
      const client = await self.clients.get(event.clientId);
      if (client && client.url) {
        const ep = endpointFromUrl(client.url);
        if (ep) return ep;
      }
    }
  } catch (e) {}
  if (event.request.referrer) {
    const ep = endpointFromUrl(event.request.referrer);
    if (ep) return ep;
  }
  return null;
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/local-web/') === 0) return;
  event.respondWith((async () => {
    const endpoint = await findEndpoint(event);
    if (!endpoint) return fetch(event.request);
    const target = PROXY_PREFIX + endpoint + url.pathname + url.search;
    const request = event.request;
    const init = {
      method: request.method,
      headers: request.headers,
      credentials: request.credentials,
      // mode 'navigate' 只有浏览器自己发得出来，透传会让 Request 构造直接抛错
      mode: request.mode === 'navigate' ? 'same-origin' : request.mode,
      redirect: request.redirect,
      cache: request.cache,
    };
    if (request.referrer) init.referrer = request.referrer;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      /* ⚠⚠ 带 body 的转发必须声明 duplex:'half'。
         带流式 body（POST 的 JSON / 表单）的 Request 在缺少 duplex 时
         **构造函数本身就抛 TypeError**，于是 respondWith 的 Promise 被拒，
         页面侧只看到一句 "Failed to fetch"（网络错误），而 GET 一律正常 ——
         这正是"页面能打开、样式脚本都在，一到调 API 就 Failed to fetch"的原因。
         浏览器不支持 duplex 时按"先带、失败再去掉"兜底重试。 */
      init.body = request.body;
      init.duplex = 'half';
    }
    try {
      return await fetch(new Request(target, init));
    } catch (error) {
      if (init.duplex === undefined) throw error;
      const retry = Object.assign({}, init);
      delete retry.duplex;
      return await fetch(new Request(target, retry));
    }
  })());
});
`)
})

proxyRouter.all('/http/:endpoint', localWebAuth, handleProxy)
proxyRouter.all('/http/:endpoint/*splat', localWebAuth, handleProxy)

/* -------------------- WebSocket / 协议升级代理 -------------------- */
//
// 只做 HTTP 反向代理是不够的：SPA 的实时通道（例如 DSH Web GUI 的
// `/api/remote.mux`）是 WebSocket。而 **Service Worker 无法拦截 WebSocket 握手**，
// 所以这条链路只能两头补：页面里把 WS 目标改写到代理前缀（见 apiShimScript），
// 服务端在 HTTP `upgrade` 事件上把它转给上游。
// 不补的后果很好认：页面能打开、按钮能点，但"自动重连中…"永远转圈，
// 会话列表/流式输出/设置同步全部停在加载态。

const UPGRADE_MARKER = '/local-web/http/'
const UPGRADE_CONNECT_TIMEOUT_MS = 10000

/** 给原始 socket 回一条完整的 HTTP 响应（升级失败/拒绝时用）。 */
function endSocketWith(socket, status, message) {
  const body = Buffer.from(message, 'utf8')
  try {
    socket.end(
      `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n` +
        `Content-Length: ${body.length}\r\n\r\n${message}`
    )
  } catch {
    socket.destroy()
  }
}

/** 升级请求的鉴权：与 localWebAuth 同源（Cookie 优先，其次 `?token=`）。 */
function upgradeAuthorized(req) {
  let token = readCookie(req, COOKIE_NAME)
  if (!token) {
    try {
      token = new URL(String(req.url || ''), 'http://localhost').searchParams.get('token') || ''
    } catch {
      token = ''
    }
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    return payload?.role === 'admin' && payload?.purpose === 'local-web' && payload?.v === 2
  } catch {
    return false
  }
}

/** 把上游 101 / 拒绝响应里除逐跳头以外的元素原样搬给浏览器。
 *  `Connection` / `Upgrade` 是升级语义本身，必须保留。 */
function rawUpgradeHead(statusLine, rawHeaders, drop) {
  const lines = [statusLine]
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = String(rawHeaders[i])
    if (drop?.has(name.toLowerCase())) continue
    lines.push(`${name}: ${rawHeaders[i + 1]}`)
  }
  return `${lines.join('\r\n')}\r\n\r\n`
}

/**
 * 处理 `/local-web/http/<host:port>/...` 上的 HTTP 升级（WebSocket）请求。
 *
 * 由 `server.on('upgrade')` 调用，必须**早于**控制台 WS 的处理器注册：
 * `attachConsoleSocket()` 对非 `/ws/console` 的路径一律 `socket.destroy()`。
 *
 * @param req - 升级请求。
 * @param socket - 客户端原始 socket（本函数返回 true 时归本函数所有）。
 * @param head - 已从客户端读出、但还没解析的部分（必须转给上游）。
 * @returns 是否接管了这条连接（false = 不是本地 Web 代理的路径，交给其它处理器）。
 */
export function localWebUpgrade(req, socket, head) {
  const rawUrl = String(req.url || '')
  if (!rawUrl.startsWith(UPGRADE_MARKER)) return false

  /* ⚠⚠ 接管 socket 后必须**立刻**挂上 error 监听。
     原始 socket 在握手 / 转发期间被对端 reset 是常态（浏览器切标签页、握手被拒后
     直接关连接），而 'error' 事件没有监听器时会以 uncaughtException 的形式
     **把整个 Node 进程带走** —— 实测一次被拒的 WebSocket 就能让服务端整体退出。 */
  socket.on('error', () => socket.destroy())

  if (!upgradeAuthorized(req)) {
    endSocketWith(socket, '401 Unauthorized', 'AniHub 本地 Web 代理：登录已失效。请回到“控制台 → 本地 Web”，刷新授权后重新打开。')
    return true
  }

  let url
  try {
    url = new URL(rawUrl, 'http://localhost')
  } catch {
    endSocketWith(socket, '400 Bad Request', 'INVALID_URL')
    return true
  }
  const rest = url.pathname.slice(UPGRADE_MARKER.length)
  const slash = rest.indexOf('/')
  const endpoint = parseEndpoint(slash < 0 ? rest : rest.slice(0, slash))
  if (!endpoint) {
    endSocketWith(socket, '400 Bad Request', '仅支持访问本机回环地址（localhost / 127.0.0.1 / [::1]）')
    return true
  }
  const targetPath = `${slash < 0 ? '/' : rest.slice(slash)}${url.search}`

  const headers = { ...req.headers }
  delete headers.host
  delete headers['proxy-connection']
  delete headers['keep-alive']
  delete headers.te
  delete headers.trailer
  delete headers['transfer-encoding']
  delete headers['proxy-authenticate']
  delete headers['proxy-authorization']
  // `connection: Upgrade` 与 `upgrade: websocket` 留着 —— 它们就是升级语义本身
  const cookie = upstreamCookieHeader(headers.cookie)
  if (cookie) headers.cookie = cookie
  else delete headers.cookie
  rewriteUpstreamSourceHeaders(headers, endpoint, req.headers.host)
  headers.host = `${endpoint.formatHost}:${endpoint.port}`

  const upstream = http.request({
    host: endpoint.host,
    port: endpoint.port,
    method: req.method || 'GET',
    path: targetPath,
    headers,
    agent: false, // 升级连接不复用连接池
  })

  let settled = false
  const connectTimer = setTimeout(() => upstream.destroy(new Error('upstream timeout')), UPGRADE_CONNECT_TIMEOUT_MS)
  connectTimer.unref?.()
  const finish = () => {
    settled = true
    clearTimeout(connectTimer)
  }

  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    finish()
    socket.write(rawUpgradeHead(
      `HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage || 'Switching Protocols'}`,
      upRes.rawHeaders,
    ))
    if (upHead?.length) socket.write(upHead)
    if (head?.length) upSocket.write(head)
    const teardown = () => {
      upSocket.destroy()
      socket.destroy()
    }
    socket.on('error', teardown)
    upSocket.on('error', teardown)
    socket.on('close', () => upSocket.destroy())
    upSocket.on('close', () => socket.destroy())
    upSocket.pipe(socket)
    socket.pipe(upSocket)
  })

  // 上游拒绝升级（例如 401/403/404）时会走普通响应：把状态与正文如实透传
  upstream.on('response', (upRes) => {
    finish()
    /* ⚠ `content-length` / `transfer-encoding` 描述的就是下面要**原样 pipe** 的字节，
       必须保留：这里写的是裸 socket，不是 ServerResponse，Node 不会替我们重新分块；
       丢掉 `transfer-encoding: chunked` 会得到一条帧格式对不上的残响应。
       只去掉 connection/keep-alive，并在末尾显式声明关闭本连接。 */
    socket.write(rawUpgradeHead(
      `HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage || ''}`,
      [...upRes.rawHeaders, 'Connection', 'close'],
      new Set(['connection', 'keep-alive']),
    ))
    upRes.on('error', () => socket.destroy())
    upRes.on('end', () => socket.end())
    upRes.pipe(socket)
  })

  upstream.on('error', (err) => {
    if (settled) return
    finish()
    const message = err?.code === 'ECONNREFUSED'
      ? `无法连接 ${endpoint.formatHost}:${endpoint.port}（服务未启动或不是 HTTP 服务）`
      : `代理失败：${err?.message || '未知错误'}`
    endSocketWith(socket, '502 Bad Gateway', message)
  })

  upstream.end()
  return true
}

export { apiRouter as default, proxyRouter }
