// 访问统计接口：管理员查看访问量 / 访问记录 / IP 来源；前端 SPA 路由切换时上报页面访问
import { api } from './http'

export const getVisitSummary = () => api('/visits/summary')
export const getVisitMap = (params = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const q = qs.toString()
  return api('/visits/map' + (q ? `?${q}` : ''))
}
export const getVisitRecords = (params = {}) => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const q = qs.toString()
  return api('/visits/records' + (q ? `?${q}` : ''))
}
export const trackVisit = (path) => api('/visits/track', { method: 'POST', body: { path }, auth: false })
