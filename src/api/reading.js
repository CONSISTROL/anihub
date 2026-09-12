// 在线阅读接口
import { api } from './http'

/** 当前身份可读的书（游客会返回 401，调用方按无权限处理） */
export const getBooks = () => api('/reading')

/** 管理员：全部书 + 上架配置 */
export const getBooksAccess = () => api('/reading/access')

/** 管理员：保存上架配置 */
export const saveBooksAccess = (payload) =>
  api('/reading/access', { method: 'PUT', body: payload })

/**
 * 换取 /books 专用会话 Cookie。
 * 书正文是 iframe 直接加载的静态 HTML，带不上 localStorage 里的 token，
 * 所以先换一个只发给 /books 的 HttpOnly Cookie，再把 iframe 指过去。
 */
export const openBookSession = () => api('/reading/session', { method: 'POST' })

/** 清除 /books 会话 Cookie（退出登录 / 退出内部模式） */
export const closeBookSession = () =>
  api('/reading/session', { method: 'DELETE', auth: false }).catch(() => {})
