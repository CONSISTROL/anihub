// 网站升级接口：检查版本落后情况 + 管理员触发升级
import { api } from './http'

export const getUpgradeStatus = () => api('/upgrade/status')

export const getUpgradeProgress = () => api('/upgrade/progress')

export const getUpgradeVersion = () => api('/upgrade/version')

export const runUpgrade = (password) =>
  api('/upgrade', { method: 'POST', body: { password } })
