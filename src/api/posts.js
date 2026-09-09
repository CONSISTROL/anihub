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

// 置顶 / 取消置顶（仅博客，全局唯一置顶 → 该篇即主页公告）
export function pinPost(id, pinned) {
  return api(`/posts/${id}/pin`, { method: 'POST', body: { pinned } })
}

// Wiki 批量导出 / 导入（仅管理员）
function authHeaders() {
  const t = localStorage.getItem('anihub.token')
  const h = {}
  if (t) h.Authorization = `Bearer ${t}`
  return h
}

// 导出全部 wiki → 返回 zip Blob（含正文与引用的 /uploads 图片）
export async function exportWikiZip() {
  const res = await fetch('/api/posts/wiki/export', { headers: authHeaders() })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    const err = new Error(d.error?.message || `导出失败 (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.blob()
}

// 导入备份 zip：同 slug 的 wiki 已存在则跳过，返回 { imported, skipped, images, errors }
export async function importWikiZip(file) {
  const res = await fetch('/api/posts/wiki/import', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/zip' },
    body: file,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error?.message || `导入失败 (${res.status})`)
    err.status = res.status
    if (res.status === 401) useAuth().clearSession()
    throw err
  }
  return data
}

// 主页公告：返回置顶的博客文章摘要（无公告时 404）
export function getAnnouncement() {
  return api('/posts/announcement')
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
