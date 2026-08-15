// 站点设置接口
import { api } from './http'

/** 哪些页面对游客可见 */
export const getGuestPages = () => api('/settings').then((d) => d.guestPages)
export const updateGuestPages = (guestPages) =>
  api('/settings', { method: 'PUT', body: { guestPages } }).then((d) => d.guestPages)
