// 壁纸目录扫描：返回用于展示的壁纸 URL 列表（管理员可在设置中选择展示哪些）。
// 未选择（选择为空）时使用目录下全部图片；目录内新增/删除图片无需重启，每次请求实时读取。
// 公开接口按选择过滤（轮播只出现被选中的）；管理接口（仅管理员）返回全部 + 当前选择。
import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { WALLPAPER_DIR } from '../config.js'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const SELECTED_KEY = 'wallpaper_selected' // settings 表：JSON 文件名数组

function scanNames() {
  try {
    return fs
      .readdirSync(WALLPAPER_DIR)
      .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
  } catch {
    // 目录不存在或不可读：视为空列表，前端自动回退
    return []
  }
}

function readSelected() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SELECTED_KEY)
  if (!row) return []
  try {
    const v = JSON.parse(row.value)
    if (Array.isArray(v)) return [...new Set(v)].filter((n) => typeof n === 'string')
  } catch {}
  return []
}

function writeSelected(names) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(SELECTED_KEY, JSON.stringify(names))
}

const urlOf = (n) => '/wallpapers/' + encodeURIComponent(n)

// 展示用列表（游客可读）：仅返回被选中的壁纸；未选择时返回全部
router.get('/', (req, res) => {
  const all = scanNames()
  const selected = readSelected().filter((n) => all.includes(n))
  const names = selected.length ? selected : all
  res.json({ images: names.map(urlOf) })
})

// 管理接口（仅管理员）：全部壁纸 + 当前选择状态
router.get('/manage', authRequired, (req, res) => {
  const all = scanNames()
  const selected = readSelected().filter((n) => all.includes(n))
  res.json({
    images: all.map((n) => ({ name: n, url: urlOf(n), selected: selected.includes(n) })),
    selected,
  })
})

// 保存选择（仅管理员）：只接受目录中实际存在的文件名
router.put('/selected', authRequired, (req, res) => {
  const names = req.body?.names
  if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'names 需为文件名数组' } })
  }
  const all = scanNames()
  const valid = [...new Set(names)].filter((n) => all.includes(n))
  writeSelected(valid)
  console.log(`[settings] 壁纸选择已更新: ${valid.length} 张`)
  res.json({ selected: valid })
})

export default router
