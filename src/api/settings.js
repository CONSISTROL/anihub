// 站点设置接口：游客可见页面 + 内部人员可见页面 + 壁纸/成人内容 + 服务器监控 + 管理员控制台
import { api } from './http'

export const getSettings = () => api('/settings')
export const updateSettings = (body) => api('/settings', { method: 'PUT', body })
export const getMonitor = () => api('/monitor')
export const getMonitorHistory = (params = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const q = qs.toString()
  return api('/monitor/history' + (q ? `?${q}` : ''))
}
export const execCommand = (cmd) => api('/console/exec', { method: 'POST', body: { cmd } })
export const getConsoleLogs = () => api('/console/logs')
export const completeCommand = (text) => api(`/console/complete?text=${encodeURIComponent(text)}`)
export const getWallpapersManage = () => api('/wallpapers/manage')
export const saveWallpaperSelection = (names) => api('/wallpapers/selected', { method: 'PUT', body: { names } })
