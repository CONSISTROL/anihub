// 文章 API 封装（博客与 Wiki 共用，category 区分）
import { api } from './http'

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
