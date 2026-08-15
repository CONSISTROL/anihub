// AniHub 后端入口：API + 静态托管 dist（生产单端口）
import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { PORT } from './config.js'
import authRouter from './routes/auth.js'
import postsRouter from './routes/posts.js'

const app = express()
app.use(express.json({ limit: '2mb' }))

app.use('/api/auth', authRouter)
app.use('/api/posts', postsRouter)

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
})
