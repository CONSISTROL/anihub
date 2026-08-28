// Anime 档期数据服务端缓存：数据持久化在 SQLite（anime_cache），
// 只有对应档期没有缓存或缓存过期时才回源 AniList，页面重复打开不再请求源站。
import { Router } from 'express'
import db from '../db.js'
import { ZH_TITLES } from '../../src/data/zhTitles.js'

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cacheKey = (year, season) => `${year}-${season}`

function isCurrentSeason(season, year) {
  const now = new Date()
  const m = now.getMonth()
  const cur = SEASONS.find((s) => SEASON_MONTHS[s].includes(m))
  return season === cur && year === now.getFullYear()
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

  // 排期：仅在不新鲜时重新拉取（当前档期 12 小时 / 过去档期 30 天）
  let schedules = schedFresh ? cached.schedules : []
  let schedFetchedAt = schedFresh ? cached.schedFetchedAt : 0
  if (!schedFresh) {
    const ids = media.map((m) => m.id)
    const { start, end } = seasonWindow(season, year)
    schedules = ids.length ? await fetchSchedules(ids, start, end) : []
    schedFetchedAt = Date.now()
  }

  if (!mediaFresh || !schedFresh) {
    writeCache(key, year, season, media, schedules, { mediaFetchedAt, schedFetchedAt })
  }

  return { media, schedules }
}

// 同一档期并发请求时只回源一次
const inFlight = new Map()

async function getSeasonData(season, year) {
  const key = cacheKey(year, season)
  if (inFlight.has(key)) return inFlight.get(key)
  const p = loadSeasonData(season, year).finally(() => inFlight.delete(key))
  inFlight.set(key, p)
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

// GET /api/anime/search?q=关键词
// 只搜索服务器上已缓存过的档期，不会因此回源 AniList
router.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''
  if (!q) {
    return res.json({ items: [] })
  }
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
      const haystack = [t.romaji, t.native, t.english, zh].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(needle)) continue
      seen.add(m.id)
      out.push({
        id: m.id,
        isAdult: !!m.isAdult,
        cover: m.coverImage?.medium || m.coverImage?.large || '',
        title: zh || t.romaji || t.native || t.english || '',
        season: `${row.year} ${SEASON_ZH[row.season] || row.season}`,
      })
    }
  }

  out.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  res.json({ items: out.slice(0, 50) })
})

export default router
