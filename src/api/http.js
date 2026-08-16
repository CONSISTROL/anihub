// API 请求封装：/api 前缀、Bearer 认证、统一错误抛错、401 自动清理对应身份
import { useAuth } from '../composables/useAuth'

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  // 管理员 token 优先，其次用内部人员 token（内部人员只读接口）
  const adminToken = localStorage.getItem('anihub.token')
  const insiderToken = localStorage.getItem('anihub.insider')
  if (auth) {
    const t = adminToken || insiderToken
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
    // token 失效自动清理对应身份（登录/口令接口自身除外）
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/insider') {
      const auth = useAuth()
      if (adminToken) auth.clearSession()
      else if (insiderToken) auth.exitInsider()
    }
    throw err
  }
  return data
}
