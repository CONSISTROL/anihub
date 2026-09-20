// AniHub 后端入口：API + 静态托管 dist（生产单端口）
import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { PORT } from './config.js'
import authRouter from './routes/auth.js'
import postsRouter from './routes/posts.js'
import settingsRouter from './routes/settings.js'
import uploadRouter from './routes/upload.js'
import wallpapersRouter from './routes/wallpapers.js'
import animeRouter from './routes/anime.js'
import monitorRouter, { serverStats } from './routes/monitor.js'
import consoleRouter from './routes/console.js'
import upgradeRouter, { finalizeUpgradeState } from './routes/upgrade.js'
import visitsRouter, { recordPageVisit, flushPendingVisits } from './routes/visits.js'
import localWebRouter, { proxyRouter as localWebProxy, localWebUpgrade } from './routes/localWeb.js'
import readingRouter from './routes/reading.js'
import { BOOKS_DIR, booksGuard, booksInjectGuard, sendBookHtml, blockManifest } from './books.js'
import { attachConsoleSocket, closeConsoleSockets } from './consoleSocket.js'
import { startMonitor, stopMonitor } from './monitorCollector.js'
import { startMaintenance, stopMaintenance } from './db.js'
import { captureConsole } from './logger.js'
import { WALLPAPER_DIR } from './config.js'
import { compressionMiddleware } from './middleware/compress.js'

// 捕获服务端 console 输出（管理员控制台实时日志）
captureConsole()

const app = express()

// 部署形态是 Nginx（公网）→ Express（127.0.0.1:3001）。
// trust proxy 设为 1 表示「只信任最近一跳代理」，Express 会据此把 req.ip
// 解析为 XFF 中最后一段（Nginx 用 $proxy_add_x_forwarded_for 追加的真实对端地址）。
// 绝不能直接把 XFF 首段当客户端 IP——那是请求方可以随便伪造的。
app.set('trust proxy', 1)
app.disable('x-powered-by')

// 响应压缩：必须在所有路由之前挂载，才能包住 res.write/res.end。
// 放在请求计数之后、代理与访问记录之前，保证 API 与静态资源都被覆盖。
app.use((req, res, next) => {
  serverStats.requests++
  next()
})
app.use(compressionMiddleware)

// 本地 Web 反向代理必须放在 express.json 之前挂载：
// 代理需要把请求体原样转发给本机服务，不能被 JSON body parser 提前消费。
// 同时放在访问记录之前，避免把代理访问统计成网站页面访问。
app.use('/local-web', localWebProxy)
app.use(recordPageVisit)
// 文章正文允许完整 HTML 文档（Archify 等导出可能 >500KB），JSON body 放宽到 20mb
app.use(express.json({ limit: '20mb' }))

app.use('/api/auth', authRouter)
app.use('/api/posts', postsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/wallpapers', wallpapersRouter)
app.use('/api/anime', animeRouter)
app.use('/api/monitor', monitorRouter)
app.use('/api/console', consoleRouter)
app.use('/api/upgrade', upgradeRouter)
app.use('/api/visits', visitsRouter)
app.use('/api/local-web', localWebRouter)
app.use('/api/reading', readingRouter)

// 静态资源缓存策略：
// - 带内容 hash 的构建产物（/assets/xxx-<hash>.js）→ 一年 immutable
// - 用户上传的图片 / 壁纸 / 桌宠动画 / 游戏资源 → 7 天，配合 ETag 走 304
// - 其余（favicon 等）→ 1 天
// express.static 默认 maxAge 为 0，等于每次都回源校验；大文件（壁纸可达十几 MB）代价极高。
// 带内容 hash 的构建产物（/assets/xxx-<hash>.js）→ 一年 immutable
// - 用户上传的图片 / 壁纸 / 桌宠动画 / 游戏资源 → 7 天，配合 ETag 走 304
// - 其余（favicon 等）→ 1 天
// express.static 默认 maxAge 为 0，等于每次都回源校验；大文件（壁纸可达十几 MB）代价极高。
const HASHED = /-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css)$/
function staticCacheHeaders(res, filePath) {
  const base = path.basename(filePath)
  if (HASHED.test(base)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  } else if (/\.(?:woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|ogg|wasm)$/i.test(base)) {
    res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400')
  } else {
    res.setHeader('Cache-Control', 'public, max-age=86400')
  }
}
const staticOpts = (dir) => ({
  etag: true,
  lastModified: true,
  setHeaders: staticCacheHeaders,
  // 目录不存在时不要报错（wallpapers 目录可能被 WALLPAPER_DIR 覆盖）
  fallthrough: true,
  maxAge: 0,
})

// 上传的图片静态托管（dev 模式由 vite 代理 /uploads 到本服务）
const uploads = path.join(import.meta.dirname, 'uploads')
app.use('/uploads', express.static(uploads, staticOpts(uploads)))

// 背景壁纸静态托管（dev 模式 vite 直接服务 public/，本路径供生产使用）
app.use('/wallpapers', express.static(WALLPAPER_DIR, staticOpts(WALLPAPER_DIR)))

// 在线阅读正文静态托管：**必须先鉴权**再放行。
// 这些是整本书的 HTML，不能只靠前端路由守卫 —— 直接访问 /books/<id>/xxx.html 也要拦住。
// 未登录 401、未上架 404；管理员可读全部，内部人员只读已上架的。
// 响应与身份相关，加 private + no-cache 明确告诉 CDN/代理不要缓存（避免串给别的身份）。
const booksNoCache = (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-cache')
  res.setHeader('Vary', 'Cookie')
  next()
}
// 带主题桥注入的 HTML 入口：/books/<id>/<theme>/<entry>。
// 书正文必须用真实 URL 加载（srcdoc 会让片段链接导航到外层文档），
// 主题由服务端在解析期注入，避免"先闪一下书的默认主题"。
//
// 注意 Express 5（path-to-regexp v8）的两个坑：
//   1) 不再支持 `:theme(light|dark)` 这种内联正则 → 取值合法性在 sendBookHtml 内校验
//   2) 参数是**逐段匹配**而不是贪婪匹配：`:theme/*splat` 命中 /books/A/B/C 时
//      :theme 会拿到 A、splat 为 undefined。所以必须显式写全 :id/:theme/*splat。
app.get('/books/:id/:theme/*splat', booksInjectGuard, booksNoCache, sendBookHtml)
// 其余静态资源（配图等）直接服务
app.use(
  '/books',
  booksGuard,
  booksNoCache,
  blockManifest,
  express.static(BOOKS_DIR, { etag: true, lastModified: true, maxAge: 0 })
)

// /api 下未匹配的路径返回 JSON 404，不能落到 SPA fallback
// （顺手加短缓存，避免重复打不存在的接口）
app.use('/api', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
})

// 生产模式：静态托管构建产物 + SPA fallback
// 注意（Express 5）：`/*splat` 只匹配至少一段路径，**不匹配根路径 `/`**，
// 所以根路径必须单独注册，否则首页会 404。
const dist = path.join(import.meta.dirname, '..', 'dist')

// 游戏音频清单分流：
// SPD 的 assets/preload.txt 是批量预载清单，其中有 31 个 music + 67 个 sounds（约 18MB）。
// 游戏对 ?noaudio=1 的处理只跳过「音乐定时器」，**并不会**跳过批量预载 ——
// 结果是无音频模式依然把这 98 个音频全部下下来，"极速模式"名不副实。
// 因此在服务端按 noaudio 参数返回精简清单：
//   1) 启动时把原始清单拆成完整版与无音频版缓存在内存（各约 30KB）
//   2) /spd/assets/preload.txt 带 noaudio=1 时返回无音频版
// 必须注册在 express.static 之前，否则会被静态文件直接命中。
// 清单行格式：i:b:/路径:体积:标志（音频位于 /music/ 与 /sounds/ 两个目录）
const AUDIO_DIRS = ['/music/', '/sounds/']
const isAudioEntry = (line) => AUDIO_DIRS.some((d) => line.includes(d))
let preloadNoAudio = null
if (fs.existsSync(path.join(dist, 'spd', 'assets', 'preload.txt'))) {
  try {
    const lines = fs.readFileSync(path.join(dist, 'spd', 'assets', 'preload.txt'), 'utf8').split(/\r?\n/)
    const kept = lines.filter((l) => !isAudioEntry(l))
    preloadNoAudio = kept.join('\n')
    console.log(`[game] 预载清单分流完成：无音频版 ${kept.length} 条（去掉 ${lines.length - kept.length} 条音频）`)
  } catch (e) {
    console.warn('[game] 预载清单分流失败，将原样返回：', e.message)
  }
}

if (fs.existsSync(dist)) {
  app.get('/spd/assets/preload.txt', (req, res, next) => {
    // 浏览器为子资源请求带上 Referer，其中包含 iframe 的完整 URL（含 ?noaudio=1）。
    // 游戏自己 fetch('assets/preload.txt') 时不带任何参数，所以只能从这里判断模式。
    // 这个响应内容随 Referer 变化，必须声明 Vary，否则浏览器/中间缓存会把
    // 「完整清单」按 URL 复用给极速模式（反之亦然），出现切模式后仍然下载 18MB 音频。
    res.setHeader('Vary', 'Referer')
    const referer = String(req.headers.referer || '')
    const noAudio =
      req.query.noaudio === '1' ||
      req.query.noaudio === 'true' ||
      /[?&]noaudio=(1|true)/.test(referer)
    if (!noAudio || !preloadNoAudio) return next() // 无 noaudio 标记：交给静态托管返回原始清单
    res.setHeader('Cache-Control', 'no-store')
    res.type('text/plain; charset=utf-8').send(preloadNoAudio)
  })
  // 仅用于本地自动化测试：同源写入身份 token 后跳转，方便无头浏览器直接渲染需要登录的内页。
  // 必须显式设置 ENABLE_TEST_HOOKS=1 才启用，默认完全不存在（生产不要开）。
  if (process.env.ENABLE_TEST_HOOKS === '1') {
    console.warn('[server] ⚠ 测试用 /__seed 路由已启用（ENABLE_TEST_HOOKS=1），请勿在生产环境开启')
    app.get('/__seed', (req, res) => {
      const key = ['anihub.token', 'anihub.insider'].includes(String(req.query.key)) ? String(req.query.key) : ''
      const token = String(req.query.token || '')
      const to = String(req.query.to || '/')
      // 只允许站内相对路径，避免被当成开放重定向
      const safeTo = to.startsWith('/') && !to.startsWith('//') ? to : '/'
      res
        .type('html')
        .setHeader('Cache-Control', 'no-store')
        .send(
          `<!doctype html><meta charset="utf-8"><script>if(${JSON.stringify(key)})localStorage.setItem(${JSON.stringify(
            key
          )},${JSON.stringify(token)});location.replace(${JSON.stringify(safeTo)});</script>`
        )
    })
  }
  app.use(
    express.static(dist, {
      etag: true,
      lastModified: true,
      setHeaders: staticCacheHeaders,
      // index.html 必须每次校验，否则发版后用户仍拿旧页面引旧 chunk
      index: false,
      maxAge: 0,
    })
  )
  const sendIndex = (req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(dist, 'index.html'))
  }
  app.get('/', sendIndex)
  app.get('/*splat', sendIndex)
}

// 统一错误处理（Express 5 async handler 的 throw 会自动走到这里）
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '内容过大' } })
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '请求体不是合法 JSON' } })
  }
  console.error('[server error]', err)
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误' } })
})

// 进程级兜底：任何未捕获异常都不应让服务静默死掉（此前完全没有处理）
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})

const server = app.listen(PORT, () => {
  console.log(`AniHub server listening on http://localhost:${PORT}`)
  startMonitor() // 服务器指标采集（每 5 秒采样 CPU/内存/网络/磁盘）
  startMaintenance() // WAL checkpoint + 过期访问记录清理
  finalizeUpgradeState() // 如果上次升级停在 restart 阶段，新进程起来后标记完成
})
// 本地 Web 代理的 WebSocket 升级（SPA 实时通道，如 DSH 的 /api/remote.mux）。
// 必须**早于** attachConsoleSocket 注册：控制台那个处理器对非 /ws/console 的路径
// 一律 destroy，晚注册的处理器拿不到 socket（事件是广播给所有 listener 的）。
server.on('upgrade', (req, socket, head) => {
  // 兜底：这个 listener 抛异常会**中断同一次 emit 里后面的 listener**（控制台 WS），
  // 所以这里必须自己吞掉并关掉 socket。非 /local-web 路径不会抛（第一行就 return）。
  try {
    localWebUpgrade(req, socket, head)
  } catch (err) {
    console.error('[local-web] 升级代理异常：', err)
    socket.destroy()
  }
})
attachConsoleSocket(server) // 控制台实时流式输出（WebSocket）

// 优雅退出：停掉监控/维护定时器、落盘缓冲中的访问记录、checkpoint 并关闭数据库。
// 部署脚本（deploy/update.sh）会 systemctl restart，若不 checkpoint，
// WAL 会一直留在磁盘上（此前观察到 -wal 9.1MB 而主库 14.6MB）。
let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[server] 收到 ${signal}，正在优雅退出…`)

  let finished = false
  const done = () => {
    if (finished) return
    finished = true
    try {
      stopMonitor()
      flushPendingVisits() // 落盘缓冲中的访问记录
      stopMaintenance() // 内部会做 wal_checkpoint(TRUNCATE) + db.close()
    } catch (e) {
      console.error('[server] 退出清理失败', e)
    }
    process.exit(0)
  }

  // 先断开 WebSocket 与空闲连接，否则 server.close() 会一直等它们
  try {
    closeConsoleSockets()
  } catch {
    /* 忽略 */
  }
  server.closeIdleConnections?.()
  server.close(done)

  // 兜底：1.5 秒内还有长连接没断，就强制关闭并退出
  setTimeout(() => {
    try {
      server.closeAllConnections?.()
    } catch {
      /* 忽略 */
    }
    done()
  }, 1500).unref?.()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
