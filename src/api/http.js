// API 请求封装：/api 前缀、Bearer 认证、统一错误抛错、401 自动登出
import { useAuth } from '../composables/useAuth'

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth) {
    const t = localStorage.getItem('anihub.token')
    if (t) headers.Authorization = `Bearer ${t}`
  }
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error?.message || `请求失败 (${res.status})`)
    err.status = res.status
    err.code = data.error?.code
    // token 失效自动登出（登录接口自身除外）
    if (res.status === 401 && path !== '/auth/login') useAuth().clearSession()
    throw err
  }
  return data
}
