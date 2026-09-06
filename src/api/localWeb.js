// 管理员本地 Web：获取本机监听端口 / 建立新标签页代理专用会话 Cookie
import { api } from './http'

export const getLocalWebServices = (force = false) => api('/local-web/services' + (force ? '?force=1' : ''))
export const createLocalWebSession = () => api('/local-web/session', { method: 'POST' })
