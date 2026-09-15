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
const UPSTREAM_TIMEOUT_MS = 30000

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
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`
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
  delete out.authorization
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

/** 把本地服务返回的 HTML 中“根路径引用”改写到当前代理前缀下。
 *  只改写 HTML 标签属性里的资源地址与 CSS url()/srcset，
 *  不改写 <script> 里的 JS 源码——路由字符串等会被错误破坏。 */
function rewriteLocalHtml(html, endpoint) {
  const prefix = proxyPrefix(endpoint)
  let out = ensureProxyBase(html, prefix)
  // 注册同源 Service Worker：把页面里发往网站根路径的同源请求
  // （例如 SPA 里 fetch('/api/...')）改写到当前代理前缀，解决路径前缀代理下
  // JS 硬编码根路径 API 的问题。
  const swScript = `<script>(function(){try{if('serviceWorker' in navigator&&location.pathname.indexOf('/local-web/http/')===0){navigator.serviceWorker.register('/local-web/sw.js',{scope:'/local-web/'}).catch(function(){})}}catch(e){}})();<\/script>`
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${swScript}</head>`)
  }
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
  return out
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
 *  不能把所有根路径字符串都改写，否则会破坏前端路由字符串。 */
function rewriteLocalJavaScript(js, endpoint) {
  const prefix = proxyPrefix(endpoint)
  let out = js.replace(/(\bbaseURL\s*[:=]\s*["'])\/(?!\/|local-web\/http\/)/g, `$1${prefix}/`)
  // 只处理 /api/ 这种明确是后端接口的根路径；不碰 /dashboard、/selection 等前端路由
  out = out.replace(/(["'`])\/api\//g, `$1${prefix}/api/`)
  return out
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
  headers.host = target.host
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']
  if (req.headers['accept']) headers.accept = req.headers.accept
  if (req.headers['accept-language']) headers['accept-language'] = req.headers['accept-language']
  if (req.headers['user-agent']) headers['user-agent'] = req.headers['user-agent']
  if (req.headers['referer']) headers.referer = req.headers.referer
  if (req.headers.origin) headers.origin = req.headers.origin
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
        body = rewriteLocalJavaScript(body, endpoint)
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

  upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
    upstream.destroy(new Error('upstream timeout'))
  })
  upstream.on('error', (err) => {
    if (res.headersSent) {
      res.destroy(err)
      return
    }
    const message = err?.code === 'ECONNREFUSED'
      ? `无法连接 ${endpoint.formatHost}:${endpoint.port}（服务未启动或不是 HTTP 服务）`
      : `代理失败：${err?.message || '未知错误'}`
    res.status(502).json({ error: { code: 'PROXY_FAILED', message } })
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
    const init = {
      method: event.request.method,
      headers: event.request.headers,
      credentials: event.request.credentials,
      mode: event.request.mode,
      redirect: event.request.redirect,
      cache: event.request.cache,
    };
    if (event.request.method !== 'GET' && event.request.method !== 'HEAD') init.body = event.request.body;
    return fetch(new Request(target, init));
  })());
});
`)
})

proxyRouter.all('/http/:endpoint', localWebAuth, handleProxy)
proxyRouter.all('/http/:endpoint/*splat', localWebAuth, handleProxy)

export { apiRouter as default, proxyRouter }
