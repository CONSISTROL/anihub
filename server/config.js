// 服务配置：从 .env 读取，缺失时降级 dev 值
import path from 'node:path'

export const PORT = Number(process.env.PORT) || 3001
export const JWT_SECRET =
  process.env.JWT_SECRET || 'anihub-dev-secret-change-me'
export const JWT_EXPIRES_IN = '7d'

// 个人站仅允许站长账号登录（见 db.js ensureAdmin）
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'anihub-dev-password'

// Anime 页背景壁纸目录：放任意数量的图片即可随机展示；
// 默认 public/wallpapers，可用 WALLPAPER_DIR 指向其他目录（绝对路径）
export const WALLPAPER_DIR =
  process.env.WALLPAPER_DIR || path.join(import.meta.dirname, '..', 'public', 'wallpapers')
