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
import monitorRouter, { serverStats } from './routes/monitor.js'
import consoleRouter from './routes/console.js'
import { startMonitor } from './monitorCollector.js'
import { captureConsole } from './logger.js'
import { WALLPAPER_DIR } from './config.js'

// 捕获服务端 console 输出（管理员控制台实时日志）
captureConsole()

const app = express()
app.use(express.json({ limit: '2mb' }))

// 请求计数（服务器监控用）
app.use((req, res, next) => {
  serverStats.requests++
  next()
})

app.use('/api/auth', authRouter)
app.use('/api/posts', postsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/wallpapers', wallpapersRouter)
app.use('/api/monitor', monitorRouter)
app.use('/api/console', consoleRouter)

// 上传的图片静态托管（dev 模式由 vite 代理 /uploads 到本服务）
const uploads = path.join(import.meta.dirname, 'uploads')
app.use('/uploads', express.static(uploads))

// 背景壁纸静态托管（dev 模式 vite 直接服务 public/，本路径供生产使用）
app.use('/wallpapers', express.static(WALLPAPER_DIR))

// /api 下未匹配的路径返回 JSON 404，不能落到 SPA fallback
app.use('/api', (req, res) =>
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } })
)

// 生产模式：静态托管构建产物 + SPA fallback（Express 5 通配符必须用 /*splat）
const dist = path.join(import.meta.dirname, '..', 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get('/*splat', (req, res) => res.sendFile(path.join(dist, 'index.html')))
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

app.listen(PORT, () => {
  console.log(`AniHub server listening on http://localhost:${PORT}`)
  startMonitor() // 服务器指标采集（每 5 秒采样 CPU/内存/网络/磁盘）
})
