// 图片上传：登录后把图片存到 server/uploads/，返回可访问的 URL
// 请求体为原始二进制（Content-Type: image/*），限制 8MB
import { Router } from 'express'
import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { authRequired } from '../middleware/auth.js'

const router = Router()

const UPLOAD_DIR = path.join(import.meta.dirname, '..', 'uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const TYPE_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

router.post(
  '/',
  authRequired,
  express.raw({ type: Object.keys(TYPE_EXT), limit: '8mb' }),
  (req, res) => {
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim()
    const ext = TYPE_EXT[contentType]
    if (!ext) {
      return res.status(400).json({ error: { code: 'BAD_TYPE', message: '仅支持 PNG / JPG / WebP / GIF 图片' } })
    }
    if (!req.body?.length) {
      return res.status(400).json({ error: { code: 'EMPTY', message: '上传内容为空' } })
    }
    // 随机文件名，不信任客户端提供的文件名
    const name = crypto.randomBytes(8).toString('hex') + ext
    fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body)
    res.status(201).json({ url: `/uploads/${name}` })
  }
)

export default router
