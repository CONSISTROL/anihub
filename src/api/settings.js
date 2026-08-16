// 站点设置接口：游客可见页面 + 内部人员可见页面
import { api } from './http'

export const getSettings = () => api('/settings')
export const updateSettings = (body) => api('/settings', { method: 'PUT', body })
