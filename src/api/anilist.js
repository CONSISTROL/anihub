// AniList GraphQL API 封装
// 文档: https://docs.anilist.co/guide/graphql
import { isCurrentSeason } from '../utils/date'

const ENDPOINT = 'https://graphql.anilist.co'

const PAGE_DELAY = 200 // 分页请求间隔（毫秒），避免连发触发限流
// 缓存有效期：媒体列表（标题/封面/简介等）几乎不变，7 天；
// 排期（每集放送时间）当前档期会随新集公布陆续更新，12 小时；过去档期已定型，30 天
const MEDIA_TTL = 7 * 24 * 3600 * 1000
const SCHEDULE_CURRENT_TTL = 12 * 3600 * 1000
const SCHEDULE_PAST_TTL = 30 * 24 * 3600 * 1000
export const CACHE_PREFIX = 'anime-calendar:v4:' // v4: 媒体列表与排期分开缓存（不同有效期）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cacheKey = (season, year) => `${CACHE_PREFIX}${year}-${season}`

/** 读取档期缓存：返回媒体/排期各自是否新鲜；未命中/损坏返回 null */
function readCache(season, year) {
  try {
    const raw = localStorage.getItem(cacheKey(season, year))
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || !Array.isArray(data.media) || !Array.isArray(data.schedules)) return null
    const mediaFresh =
      typeof data.mediaFetchedAt === 'number' && Date.now() - data.mediaFetchedAt <= MEDIA_TTL
    const schedTtl = isCurrentSeason({ season, year }) ? SCHEDULE_CURRENT_TTL : SCHEDULE_PAST_TTL
    const schedFresh =
      typeof data.schedFetchedAt === 'number' && Date.now() - data.schedFetchedAt <= schedTtl
    return {
      mediaMap: new Map(data.media.map((m) => [m.id, m])),
      schedules: data.schedules,
      mediaFetchedAt: data.mediaFetchedAt,
      schedFetchedAt: data.schedFetchedAt,
      mediaFresh,
      schedFresh,
    }
  } catch {
    return null // 缓存损坏，忽略并重新拉取
  }
}

/** 写入档期缓存（保留未过期部分的抓取时间；localStorage 满时静默失败） */
function writeCache(season, year, mediaMap, schedules, { mediaFetchedAt, schedFetchedAt } = {}) {
  try {
    localStorage.setItem(
      cacheKey(season, year),
      JSON.stringify({
        mediaFetchedAt: mediaFetchedAt ?? Date.now(),
        schedFetchedAt: schedFetchedAt ?? Date.now(),
        media: [...mediaMap.values()],
        schedules,
      })
    )
  } catch {}
}

async function graphql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (!res.ok || json.errors) {
    throw new Error(json.errors?.[0]?.message || `请求失败 (${res.status})`)
  }
  return json.data
}

const ANIME_FIELDS = `
  id
  isAdult
  title { romaji native english }
  bannerImage
  coverImage { medium large extraLarge }
  description
  episodes
  averageScore
  status
  format
  genres
  siteUrl
  studios(isMain: true) { nodes { name } }
`

const SEASON_QUERY = `
  query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {
        ${ANIME_FIELDS}
      }
    }
  }
`

const SCHEDULE_QUERY = `
  query ($ids: [Int], $start: Int, $end: Int, $page: Int) {
    Page(page: $page, perPage: 50) {
      pageInfo { hasNextPage }
      airingSchedules(
        mediaId_in: $ids
        airingAt_greater: $start
        airingAt_lesser: $end
        sort: TIME
      ) {
        airingAt
        episode
        media { id }
      }
    }
  }
`

/** 获取某档期的动漫列表（分页拉全），返回 Map(id → media) */
export async function fetchSeasonAnime({ season, year }) {
  const map = new Map()
  let page = 1
  let hasNext = true
  while (hasNext && page <= 10) {
    if (page > 1) await sleep(PAGE_DELAY)
    const data = await graphql(SEASON_QUERY, { season, seasonYear: year, page })
    for (const m of data.Page.media) map.set(m.id, m)
    hasNext = data.Page.pageInfo.hasNextPage
    page++
  }
  return map
}

/** 获取一批动漫在时间窗内每集的放送时间，按时间升序返回 [{ airingAt, episode, mediaId }] */
export async function fetchSchedules(ids, { start, end }) {
  const out = []
  let page = 1
  let hasNext = true
  while (hasNext && page <= 30) {
    if (page > 1) await sleep(PAGE_DELAY)
    const data = await graphql(SCHEDULE_QUERY, { ids, start, end, page })
    for (const s of data.Page.airingSchedules) {
      out.push({ airingAt: s.airingAt, episode: s.episode, mediaId: s.media.id })
    }
    hasNext = data.Page.pageInfo.hasNextPage
    page++
  }
  return out.sort((a, b) => a.airingAt - b.airingAt)
}

/** 加载整个档期数据（动漫列表 + 放送排期），只重拉过期的部分 */
export async function loadSeasonData({ season, year }, { start, end }) {
  const cached = readCache(season, year)

  // 媒体列表：仅在不新鲜时重新拉取（标题/封面等几乎不变，7 天缓存）
  let mediaMap = cached?.mediaMap || null
  let mediaFetchedAt = cached?.mediaFresh ? cached.mediaFetchedAt : 0
  if (!mediaMap) {
    mediaMap = await fetchSeasonAnime({ season, year })
    mediaFetchedAt = Date.now()
  }

  // 排期：仅在不新鲜时重新拉取（当前档期 12 小时 / 过去档期 30 天）
  let schedules = cached?.schedules || []
  let schedFetchedAt = cached?.schedFresh ? cached.schedFetchedAt : 0
  if (!cached || !cached.schedFresh) {
    const ids = [...mediaMap.keys()]
    schedules = ids.length ? await fetchSchedules(ids, { start, end }) : []
    schedFetchedAt = Date.now()
  }

  if (!cached || !cached.mediaFresh || !cached.schedFresh) {
    writeCache(season, year, mediaMap, schedules, { mediaFetchedAt, schedFetchedAt })
  }
  return { mediaMap, schedules }
}
