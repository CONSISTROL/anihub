// AniList GraphQL API 封装
// 文档: https://docs.anilist.co/guide/graphql

const ENDPOINT = 'https://graphql.anilist.co'

const PAGE_DELAY = 200 // 分页请求间隔（毫秒），避免连发触发限流
const CACHE_TTL = 12 * 3600 * 1000 // 缓存有效期：12 小时
const CACHE_PREFIX = 'anime-calendar:v2:' // v2: 新增 bannerImage / extraLarge 字段

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cacheKey = (season, year) => `${CACHE_PREFIX}${year}-${season}`

/** 读取档期缓存，未命中/损坏/过期返回 null */
function readCache(season, year) {
  try {
    const raw = localStorage.getItem(cacheKey(season, year))
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || Date.now() - data.fetchedAt > CACHE_TTL) return null
    if (!Array.isArray(data.media) || !Array.isArray(data.schedules)) return null
    return { mediaMap: new Map(data.media.map((m) => [m.id, m])), schedules: data.schedules }
  } catch {
    return null // 缓存损坏，忽略并重新拉取
  }
}

/** 写入档期缓存（localStorage 满时静默失败，不影响主流程） */
function writeCache(season, year, mediaMap, schedules) {
  try {
    localStorage.setItem(
      cacheKey(season, year),
      JSON.stringify({
        fetchedAt: Date.now(),
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

/** 加载整个档期数据（动漫列表 + 放送排期），优先使用缓存避免重复请求 */
export async function loadSeasonData({ season, year }, { start, end }) {
  const cached = readCache(season, year)
  if (cached) return cached

  const mediaMap = await fetchSeasonAnime({ season, year })
  const ids = [...mediaMap.keys()]
  const schedules = ids.length ? await fetchSchedules(ids, { start, end }) : []
  writeCache(season, year, mediaMap, schedules)
  return { mediaMap, schedules }
}
