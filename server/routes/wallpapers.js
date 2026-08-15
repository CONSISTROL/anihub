// 壁纸目录扫描：返回该目录下所有图片的 URL 列表（前端随机取一张做背景）
// 目录内新增/删除图片无需重启，每次请求实时读取
import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { WALLPAPER_DIR } from '../config.js'

const router = Router()

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

router.get('/', (req, res) => {
  let names = []
  try {
    names = fs
      .readdirSync(WALLPAPER_DIR)
      .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
  } catch {
    // 目录不存在或不可读：视为空列表，前端自动回退
  }
  names.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
  res.json({ images: names.map((n) => '/wallpapers/' + encodeURIComponent(n)) })
})

export default router
