// Anime 档期数据服务端缓存：数据持久化在 SQLite（anime_cache），
// 只有对应档期没有缓存或缓存过期时才回源 AniList，页面重复打开不再请求源站。
import { Router } from 'express'
import db from '../db.js'
import { ZH_TITLES } from '../../src/data/zhTitles.js'
import { ZH_GENRES } from '../../src/data/zhGenres.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()

const ENDPOINT = 'https://graphql.anilist.co'
const PAGE_DELAY = 200 // 分页请求间隔（毫秒），避免连发触发限流

// 缓存有效期：媒体列表（标题/封面/简介等）几乎不变，7 天；
// 排期（每集放送时间）当前档期会随新集公布陆续更新，12 小时；过去档期已定型，30 天
const MEDIA_TTL = 7 * 24 * 3600 * 1000
const SCHEDULE_CURRENT_TTL = 12 * 3600 * 1000
const SCHEDULE_PAST_TTL = 30 * 24 * 3600 * 1000

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL']
const SEASON_MONTHS = {
  WINTER: [0, 1, 2],
  SPRING: [3, 4, 5],
  SUMMER: [6, 7, 8],
  FALL: [9, 10, 11],
}
const SEASON_ZH = { WINTER: '冬', SPRING: '春', SUMMER: '夏', FALL: '秋' }
const SEASON_ORDER = ['WINTER', 'SPRING', 'SUMMER', 'FALL']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cacheKey = (year, season) => `${year}-${season}`

function displayYear(season, year) {
  // 界面按自然年“春夏秋冬”展示：冬季 12-2 月归到起始年份，AniList 的 WINTER seasonYear 需减 1
  return season === 'WINTER' ? year - 1 : year
}

function previousSeason(season, year) {
  const i = SEASON_ORDER.indexOf(season)
  const n = i - 1
  return {
    year: year + Math.floor(n / 4),
    season: SEASON_ORDER[((n % 4) + 4) % 4],
  }
}

function mergeMedia(...lists) {
  const map = new Map()
  for (const list of lists) {
    for (const m of list || []) {
      if (m?.id && !map.has(m.id)) map.set(m.id, m)
    }
  }
  return [...map.values()]
}

// 上一档仍在放送（RELEASING）的作品会跨季继续播出，需要并入当前档期。
// 这里直接拉 AniList 上一档的“原始档期列表”，避免把上一档已经合并进来的跨季作品再传递到下一档。
const seasonMediaMemory = new Map()
const SEASON_MEDIA_MEMORY_TTL = 7 * 24 * 3600 * 1000

async function fetchSeasonAnimeCached(season, year) {
  const key = cacheKey(year, season)
  const hit = seasonMediaMemory.get(key)
  if (hit && Date.now() - hit.at <= SEASON_MEDIA_MEMORY_TTL) return hit.media
  const media = await fetchSeasonAnime(season, year)
  seasonMediaMemory.set(key, { at: Date.now(), media })
  return media
}

async function fetchCarryoverAnime(season, year) {
  try {
    const prev = previousSeason(season, year)
    const prevMedia = await fetchSeasonAnimeCached(prev.season, prev.year)
    return prevMedia.filter((m) => m.status === 'RELEASING')
  } catch (e) {
    // 跨季拉取是增强逻辑，失败时不应影响当前档期主数据
    console.error('[anime] 拉取上一档跨季动画失败，忽略：', e.message)
    return []
  }
}

function seasonsInRange(start, end) {
  const out = []
  const startYear = new Date(start * 1000).getUTCFullYear() - 1
  const endYear = new Date(end * 1000).getUTCFullYear() + 1
  for (let y = startYear; y <= endYear; y++) {
    for (const s of SEASONS) {
      const w = seasonWindow(s, y)
      if (w.start <= end && w.end >= start) out.push({ season: s, year: y })
    }
  }
  return out
}

function isCurrentSeason(season, year) {
  // year 为 AniList 口径；当前档期按界面“自然年春夏秋冬”判断后换算回 AniList 年份
  const now = new Date()
  const m = now.getMonth()
  let cur, curYear
  if (m === 11) {
    cur = 'WINTER'
    curYear = now.getFullYear()
  } else if (m === 0 || m === 1) {
    cur = 'WINTER'
    curYear = now.getFullYear() - 1
  } else if (m >= 2 && m <= 4) {
    cur = 'SPRING'
    curYear = now.getFullYear()
  } else if (m >= 5 && m <= 7) {
    cur = 'SUMMER'
    curYear = now.getFullYear()
  } else {
    cur = 'FALL'
    curYear = now.getFullYear()
  }
  const aniYear = cur === 'WINTER' ? curYear + 1 : curYear
  return season === cur && year === aniYear
}

/** 档期查询时间窗（Unix 秒）。故意比档期前后各放宽一点，避免时区导致边缘集漏掉。 */
function seasonWindow(season, year) {
  const months = SEASON_MONTHS[season]
  const start = Math.floor(Date.UTC(year, months[0], 1, 0, 0, 0) / 1000) - 86400
  const end = Math.floor(Date.UTC(year, months[2] + 1, 8, 0, 0, 0) / 1000)
  return { start, end }
}

function readCache(key) {
  const row = db.prepare('SELECT * FROM anime_cache WHERE season_key = ?').get(key)
  if (!row) return null
  try {
    const media = JSON.parse(row.media)
    const schedules = JSON.parse(row.schedules)
    if (!Array.isArray(media) || !Array.isArray(schedules)) return null
    return {
      media,
      schedules,
      mediaFetchedAt: row.media_fetched_at,
      schedFetchedAt: row.sched_fetched_at,
    }
  } catch {
    return null // 缓存损坏，忽略并重新拉取
  }
}

function writeCache(key, year, season, media, schedules, { mediaFetchedAt, schedFetchedAt }) {
  db.prepare(
    `INSERT INTO anime_cache (season_key, year, season, media, schedules, media_fetched_at, sched_fetched_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(season_key) DO UPDATE SET
       media = excluded.media,
       schedules = excluded.schedules,
       media_fetched_at = excluded.media_fetched_at,
       sched_fetched_at = excluded.sched_fetched_at,
       updated_at = excluded.updated_at`
  ).run(
    key,
    year,
    season,
    JSON.stringify(media),
    JSON.stringify(schedules),
    mediaFetchedAt,
    schedFetchedAt
  )
}

async function graphql(query, variables) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (!res.ok || json.errors) {
    throw new Error(json.errors?.[0]?.message || `AniList 请求失败 (${res.status})`)
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
  nextAiringEpisode { airingAt episode }
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

const SEARCH_FIELDS = `
  id
  isAdult
  title { romaji native english }
  coverImage { medium large extraLarge }
  season
  seasonYear
  status
  format
  episodes
  genres
  nextAiringEpisode { airingAt episode }
  siteUrl
`

const REMOTE_SEARCH_QUERY = `
  query ($search: String, $page: Int) {
    Page(page: $page, perPage: 20) {
      pageInfo { hasNextPage }
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        ${SEARCH_FIELDS}
      }
    }
  }
`

/** 获取某档期的动漫列表（分页拉全），返回数组 */
async function fetchSeasonAnime(season, year) {
  const media = []
  let page = 1
  let hasNext = true
  while (hasNext && page <= 10) {
    if (page > 1) await sleep(PAGE_DELAY)
    const data = await graphql(SEASON_QUERY, { season, seasonYear: year, page })
    for (const m of data.Page.media) media.push(m)
    hasNext = data.Page.pageInfo.hasNextPage
    page++
  }
  return media
}

/** 获取一批动漫在时间窗内每集的放送时间，按时间升序返回 [{ airingAt, episode, mediaId }] */
async function fetchSchedules(ids, start, end) {
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

async function loadSeasonData(season, year) {
  const key = cacheKey(year, season)
  const cached = readCache(key)

  const mediaFresh =
    !!cached &&
    typeof cached.mediaFetchedAt === 'number' &&
    Date.now() - cached.mediaFetchedAt <= MEDIA_TTL
  const schedTtl = isCurrentSeason(season, year) ? SCHEDULE_CURRENT_TTL : SCHEDULE_PAST_TTL
  const schedFresh =
    !!cached &&
    typeof cached.schedFetchedAt === 'number' &&
    Date.now() - cached.schedFetchedAt <= schedTtl

  // 媒体列表：仅在不新鲜时重新拉取（标题/封面等几乎不变，7 天缓存）
  let media = mediaFresh ? cached.media : null
  let mediaFetchedAt = mediaFresh ? cached.mediaFetchedAt : 0
  if (!media) {
    media = await fetchSeasonAnime(season, year)
    mediaFetchedAt = Date.now()
  }

  // 跨季合并：把上一档仍在放送的作品并入当前档期（如 Re:Zero S4 春季开播、夏季继续播）
  const baseMedia = media
  const carryover = await fetchCarryoverAnime(season, year)
  media = mergeMedia(baseMedia, carryover)
  const mediaChanged =
    !mediaFresh ||
    media.length !== baseMedia.length ||
    media.some((m, i) => m.id !== baseMedia[i].id)

  // 排期：仅在不新鲜时重新拉取（当前档期 12 小时 / 过去档期 30 天）；
  // 如果本次合并进了新的跨季动画，即使排期缓存还新鲜也要补拉，否则新作品会没有排期
  let schedules = schedFresh && !mediaChanged ? cached.schedules : []
  let schedFetchedAt = schedFresh && !mediaChanged ? cached.schedFetchedAt : 0
  if (!schedFresh || mediaChanged) {
    const ids = media.map((m) => m.id)
    const { start, end } = seasonWindow(season, year)
    schedules = ids.length ? await fetchSchedules(ids, start, end) : []
    schedFetchedAt = Date.now()
  }

  if (!mediaFresh || !schedFresh || mediaChanged) {
    writeCache(key, year, season, media, schedules, { mediaFetchedAt, schedFetchedAt })
  }

  return { media, schedules }
}

// 同一档期并发请求时只回源一次
const inFlight = new Map()
const refreshInFlight = new Map()

async function getSeasonData(season, year) {
  const key = cacheKey(year, season)
  if (inFlight.has(key)) return inFlight.get(key)
  const p = loadSeasonData(season, year).finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

/**
 * 强制重新从 AniList 拉取某个档期并更新缓存。
 * 绕过 TTL/旧缓存；拉取失败时不会覆盖已有缓存。
 */
async function refreshSeasonData(season, year) {
  const key = cacheKey(year, season)
  if (refreshInFlight.has(key)) return refreshInFlight.get(key)
  const p = (async () => {
    const media = mergeMedia(
      await fetchSeasonAnime(season, year),
      await fetchCarryoverAnime(season, year)
    )
    const ids = media.map((m) => m.id)
    const { start, end } = seasonWindow(season, year)
    const schedules = ids.length ? await fetchSchedules(ids, start, end) : []
    const now = Date.now()
    writeCache(key, year, season, media, schedules, {
      mediaFetchedAt: now,
      schedFetchedAt: now,
    })
    return { media, schedules }
  })().finally(() => refreshInFlight.delete(key))
  refreshInFlight.set(key, p)
  return p
}

// GET /api/anime/season?season=WINTER&year=2026
router.get('/season', async (req, res) => {
  const season = String(req.query.season || '').toUpperCase()
  const year = Number(req.query.year)
  if (!SEASONS.includes(season) || !Number.isInteger(year) || year < 1970 || year > 2100) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'season 需为 WINTER/SPRING/SUMMER/FALL，year 需为有效年份' },
    })
  }
  const data = await getSeasonData(season, year)
  res.json(data)
})

// GET /api/anime/range?start=1700000000&end=1705000000
// 连续时间范围数据：自动加载与范围重叠的档期并合并，供不分季度的连续日历使用
router.get('/range', async (req, res) => {
  const start = Number(req.query.start)
  const end = Number(req.query.end)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= start || end - start > 400 * 86400) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'start/end 需为有效 Unix 秒，且跨度不超过 400 天' },
    })
  }
  try {
    const seasons = seasonsInRange(start, end)
    const mediaMap = new Map()
    const schedules = []
    for (const q of seasons) {
      const data = await getSeasonData(q.season, q.year)
      for (const m of data.media || []) {
        if (!mediaMap.has(m.id)) mediaMap.set(m.id, m)
      }
      for (const s of data.schedules || []) {
        if (s.airingAt >= start && s.airingAt <= end) schedules.push(s)
      }
    }
    schedules.sort((a, b) => a.airingAt - b.airingAt)
    res.json({ media: [...mediaMap.values()], schedules })
  } catch (e) {
    res.status(502).json({
      error: { code: 'ANILIST_FETCH_FAILED', message: e.message || '拉取时间范围数据失败' },
    })
  }
})

// POST /api/anime/refresh?season=WINTER&year=2026
// 管理员强制重新从 AniList 拉取指定档期并更新服务器缓存
router.post('/refresh', authRequired, async (req, res) => {
  const season = String(req.query.season || '').toUpperCase()
  const year = Number(req.query.year)
  if (!SEASONS.includes(season) || !Number.isInteger(year) || year < 1970 || year > 2100) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'season 需为 WINTER/SPRING/SUMMER/FALL，year 需为有效年份' },
    })
  }
  try {
    const data = await refreshSeasonData(season, year)
    res.json(data)
  } catch (e) {
    res.status(502).json({
      error: { code: 'ANILIST_FETCH_FAILED', message: e.message || '重新拉取 AniList 失败' },
    })
  }
})

function searchLocalAnime(q) {
  const needle = q.toLowerCase()
  const rows = db
    .prepare(
      `SELECT year, season, media FROM anime_cache
       ORDER BY year DESC,
         CASE season WHEN 'WINTER' THEN 0 WHEN 'SPRING' THEN 1 WHEN 'SUMMER' THEN 2 WHEN 'FALL' THEN 3 END DESC`
    )
    .all()

  const out = []
  const seen = new Set()
  for (const row of rows) {
    let media
    try {
      media = JSON.parse(row.media)
    } catch {
      continue
    }
    if (!Array.isArray(media)) continue
    for (const m of media) {
      if (seen.has(m.id)) continue
      const t = m.title || {}
      const zh = ZH_TITLES[m.id]
      const genreText = (m.genres || [])
        .map((g) => ZH_GENRES[g] || g)
        .join(' ')
      const haystack = [t.romaji, t.native, t.english, zh, genreText]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(needle)) continue
      seen.add(m.id)
      out.push({
        id: m.id,
        isAdult: !!m.isAdult,
        cover: m.coverImage?.medium || m.coverImage?.large || '',
        title: zh || t.native || t.romaji || t.english || '',
        year: displayYear(row.season, row.year),
        season: row.season,
        seasonLabel: `${displayYear(row.season, row.year)} ${SEASON_ZH[row.season] || row.season}`,
        status: m.status,
        format: m.format,
        episodes: m.episodes,
        genres: m.genres || [],
        siteUrl: m.siteUrl,
        nextAiringAt: m.nextAiringEpisode?.airingAt || null,
        nextEpisode: m.nextAiringEpisode?.episode || null,
        source: 'cache',
      })
    }
  }
  return out
}

function remoteSearchItem(m) {
  const zh = ZH_TITLES[m.id]
  const t = m.title || {}
  const hasSeason = !!(m.season && m.seasonYear)
  return {
    id: m.id,
    isAdult: !!m.isAdult,
    cover: m.coverImage?.medium || m.coverImage?.large || '',
    title: zh || t.native || t.romaji || t.english || '',
    year: m.seasonYear ? displayYear(m.season, m.seasonYear) : null,
    season: m.season || '',
    seasonLabel: hasSeason ? `${displayYear(m.season, m.seasonYear)} ${SEASON_ZH[m.season] || m.season}` : '',
    status: m.status,
    format: m.format,
    episodes: m.episodes,
    genres: m.genres || [],
    siteUrl: m.siteUrl,
    nextAiringAt: m.nextAiringEpisode?.airingAt || null,
    nextEpisode: m.nextAiringEpisode?.episode || null,
    source: 'anilist',
  }
}

// AniList 在线搜索缓存：同样关键词 10 分钟内不重复请求源站
const searchCache = new Map()
const SEARCH_CACHE_TTL = 10 * 60 * 1000

async function searchRemoteAnime(q) {
  const hit = searchCache.get(q)
  if (hit && Date.now() - hit.at < SEARCH_CACHE_TTL) return hit.items
  const data = await graphql(REMOTE_SEARCH_QUERY, { search: q, page: 1 })
  const items = (data.Page?.media || []).map(remoteSearchItem)
  searchCache.set(q, { at: Date.now(), items })
  return items
}

// GET /api/anime/search?q=关键词
// 先搜本地已缓存档期，再补充 AniList 在线搜索；不会因本地搜索而强制回源，只有需要在线补全时才请求 AniList。
router.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''
  if (!q) {
    return res.json({ items: [] })
  }

  const localItems = searchLocalAnime(q)
  let remoteItems = []
  try {
    remoteItems = await searchRemoteAnime(q)
  } catch (e) {
    // 在线搜索失败不阻塞：仍返回本地缓存结果
    console.error('[anime] AniList 在线搜索失败，仅返回本地结果：', e.message)
  }

  const byId = new Map()
  for (const item of localItems) byId.set(item.id, item)
  for (const item of remoteItems) {
    const existing = byId.get(item.id)
    if (existing) {
      byId.set(item.id, {
        ...existing,
        ...item,
        title: existing.title || item.title,
        seasonLabel: existing.seasonLabel || item.seasonLabel,
        source: existing.source || item.source,
      })
    } else {
      byId.set(item.id, item)
    }
  }

  const items = [...byId.values()]
  items.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'))
  res.json({ items: items.slice(0, 50) })
})

export default router
