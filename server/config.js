// 服务配置：从 .env 读取，缺失时降级 dev 值
export const PORT = Number(process.env.PORT) || 3001
export const JWT_SECRET =
  process.env.JWT_SECRET || 'anihub-dev-secret-change-me'
export const JWT_EXPIRES_IN = '7d'

// 个人站仅允许站长账号登录（见 db.js ensureAdmin）
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'anihub-dev-password'
