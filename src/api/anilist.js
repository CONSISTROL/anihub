// Anime 档期数据接口：统一走后端 /api/anime
// 数据由服务器持久化在 SQLite（anime_cache），只有服务器没有缓存/缓存过期时才回源 AniList。
// 浏览器不再直连 AniList，避免每次打开 Anime 页都重复请求源站。
import { api } from './http'

/**
 * 加载某个档期的完整数据（动漫列表 + 放送排期）。
 * 服务端负责缓存与过期判断，这里只负责请求与组装 Map。
 */
export async function loadSeasonData({ season, year }) {
  const data = await api(
    `/anime/season?season=${encodeURIComponent(season)}&year=${encodeURIComponent(year)}`,
    { auth: false }
  )
  return {
    mediaMap: new Map((data.media || []).map((m) => [m.id, m])),
    schedules: data.schedules || [],
  }
}

/**
 * 在服务器已缓存的档期数据中搜索动漫（标题匹配）。
 * 不会因为搜索而回源 AniList。
 */
export async function searchAnime(keyword) {
  const data = await api(`/anime/search?q=${encodeURIComponent(keyword)}`, { auth: false })
  return data.items || []
}

/**
 * 加载一段连续时间范围内的动漫数据（跨档期自动合并）。
 */
export async function loadRangeData({ start, end }) {
  const data = await api(
    `/anime/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    { auth: false }
  )
  return {
    mediaMap: new Map((data.media || []).map((m) => [m.id, m])),
    schedules: data.schedules || [],
  }
}

/**
 * 管理员强制重新从 AniList 拉取指定档期并更新服务器缓存。
 * 需要管理员 token（api 默认带 auth）。
 */
export async function refreshSeasonData({ season, year }) {
  return api(
    `/anime/refresh?season=${encodeURIComponent(season)}&year=${encodeURIComponent(year)}`,
    { method: 'POST' }
  )
}
