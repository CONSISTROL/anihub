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

// 管理员带 anihub.token，内部人员带 anihub.insider。
// ⚠ 原来只读管理员 token —— 内部人员调用时会**一个 Authorization 都不带**，
//   服务端按游客处理直接 401（实测"内部人员点下载 → 下载失败：请先获取内部人员或管理员身份"）。
//   凡是"内部人员也可能调用"的接口都要用这个函数，别再只读 anihub.token。
function authHeaders() {
  const admin = localStorage.getItem('anihub.token')
  const insider = localStorage.getItem('anihub.insider')
  const t = admin || insider
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

// 下载单条 Wiki → 返回 zip Blob（正文 + 正文引用的 /uploads 图片）。
// 权限由服务端判定（public / insider 可下，private 不下；游客 401）。
// ⚠ 文件名由**前端**决定：服务端**故意不下发 `Content-Disposition`** ——
//   Chrome 看到 `attachment` 会把响应当成下载，导致这里的 `res.blob()` 拿到 204/0 字节
//   （文件会被存下来，但内容是空的）。详见服务端该路由的注释。
export async function downloadWikiZip(post) {
  const res = await fetch(`/api/posts/${post.id}/download`, { headers: authHeaders() })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    const err = new Error(d.error?.message || `下载失败 (${res.status})`)
    err.status = res.status
    throw err
  }
  const blob = await res.blob()
  // 文件名沿用导出那套命名：<slug>.zip（slug 常是中文，download 属性支持）
  const name = `${post.slug || 'wiki-' + post.id}.zip`
  return { blob, name }
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
