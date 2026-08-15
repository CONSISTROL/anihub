// 文章 API 封装（博客与 Wiki 共用，category 区分）
import { api } from './http'
import { useAuth } from '../composables/useAuth'

export function listPosts(params = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, v)
  }
  const query = qs.toString()
  return api('/posts' + (query ? `?${query}` : ''))
}

export function getPost(id) {
  return api(`/posts/${id}`)
}

export function getPostBySlug(slug) {
  return api(`/posts/slug/${encodeURIComponent(slug)}`)
}

export function createPost(body) {
  return api('/posts', { method: 'POST', body })
}

export function updatePost(id, body) {
  return api(`/posts/${id}`, { method: 'PUT', body })
}

export function deletePost(id) {
  return api(`/posts/${id}`, { method: 'DELETE' })
}

// 图片上传：原始二进制请求体，返回 { url }
export async function uploadImage(file) {
  const headers = {}
  const t = localStorage.getItem('anihub.token')
  if (t) headers.Authorization = `Bearer ${t}`
  headers['Content-Type'] = file.type || 'application/octet-stream'
  const res = await fetch('/api/upload', { method: 'POST', headers, body: file })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error?.message || `上传失败 (${res.status})`)
    err.status = res.status
    if (res.status === 401) useAuth().clearSession()
    throw err
  }
  return data
}
