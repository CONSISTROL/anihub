// 服务配置：从 .env 读取（node --env-file=.env），缺失时降级 dev 值
export const PORT = Number(process.env.PORT) || 3001
export const JWT_SECRET =
  process.env.JWT_SECRET || 'anihub-dev-secret-change-me'
export const JWT_EXPIRES_IN = '7d'
