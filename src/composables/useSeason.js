import { ref, computed } from 'vue'
import { loadRangeData } from '../api/anilist'
import { SEASONS, seasonOf, seasonMonths } from '../utils/date'
import { useSettings } from './useSettings'
import { useAuth } from './useAuth'

/**
 * 连续日历状态：不再按季度分档期，而是加载当前日期附近一段连续时间范围的数据。
 * 翻页跨过已加载范围时自动向服务端请求更大的时间范围。
 */
export function useSeason(initial) {
  const today = new Date()
  let initialMonth = { y: today.getFullYear(), m: today.getMonth() }

  const initialSeason = String(initial?.season || '').toUpperCase()
  const initialYear = Number(initial?.year)
  if (
    initial &&
    SEASONS[initialSeason] &&
    Number.isInteger(initialYear) &&
    initialYear >= 1970 &&
    initialYear <= 2100
  ) {
    const ms = seasonMonths({ year: initialYear, season: initialSeason })
    if (ms.length) initialMonth = ms[0]
  }

  const month = ref(initialMonth)
  const rawMap = ref(new Map()) // id → 动漫详情（原始，含成人内容）
  const rawSchedules = ref([]) // [{ airingAt, episode, mediaId }] 按时间升序
  const loading = ref(false)
  const error = ref('')
  const loadedRange = ref(null) // { start, end } Unix 秒
  const rangeCache = new Map() // key → { start, end, mediaMap, schedules }
  let loadSeq = 0 // 防止快速连续翻页时旧请求覆盖新请求

  // 当前显示月份对应的自然年档期（仅用于背景样式等展示，不再参与翻页边界）
  const currentSeason = computed(() => seasonOf(new Date(month.value.y, month.value.m, 1)))
  const year = computed(() => currentSeason.value.year)
  const season = computed(() => currentSeason.value.season)

  const settings = useSettings()
  const auth = useAuth()
  settings.load()

  // 对外暴露的媒体表与排期：按身份过滤成人内容
  const mediaMap = computed(() => {
    if (settings.canSeeAdult(auth.isLoggedIn.value, auth.isInsider.value)) return rawMap.value
    const out = new Map()
    for (const [id, m] of rawMap.value) if (!m.isAdult) out.set(id, m)
    return out
  })
  const schedules = computed(() => {
    const visible = mediaMap.value
    return rawSchedules.value.filter((s) => visible.has(s.mediaId))
  })

  function monthRangeFor(date, padding = 5) {
    const start = new Date(date.getFullYear(), date.getMonth() - padding, 1)
    const end = new Date(date.getFullYear(), date.getMonth() + 1 + padding, 1)
    end.setTime(end.getTime() - 1)
    return {
      start: Math.floor(start.getTime() / 1000),
      end: Math.floor(end.getTime() / 1000),
    }
  }

  function rangeKey(start, end) {
    return `${start}-${end}`
  }

  function findCachedRangeForDate(date) {
    const ts = Math.floor(date.getTime() / 1000)
    for (const entry of rangeCache.values()) {
      if (ts >= entry.start && ts <= entry.end) return entry
    }
    return null
  }

  async function loadRange(start, end) {
    const seq = ++loadSeq
    loading.value = true
    error.value = ''
    try {
      const data = await loadRangeData({ start, end })
      if (seq !== loadSeq) return // 已有更新的加载请求，丢弃这次过期结果
      rawMap.value = data.mediaMap
      rawSchedules.value = data.schedules
      loadedRange.value = { start, end }
      rangeCache.set(rangeKey(start, end), {
        start,
        end,
        mediaMap: data.mediaMap,
        schedules: data.schedules,
      })
      // 简单限制缓存条数，避免无限增长
      if (rangeCache.size > 16) {
        const oldest = rangeCache.keys().next().value
        rangeCache.delete(oldest)
      }
    } catch (e) {
      if (seq === loadSeq) error.value = e.message || String(e)
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  }

  /** 确保某个日期在已加载的时间范围内，不在则加载其前后各 5 个月的数据 */
  async function ensureRangeForDate(date) {
    // 之前访问过的范围直接秒切回缓存，不需要白屏/加载
    const cached = findCachedRangeForDate(date)
    if (cached) {
      rawMap.value = cached.mediaMap
      rawSchedules.value = cached.schedules
      loadedRange.value = { start: cached.start, end: cached.end }
      return
    }

    const r = monthRangeFor(date)
    const ts = Math.floor(date.getTime() / 1000)
    if (loadedRange.value && ts >= loadedRange.value.start && ts <= loadedRange.value.end) return
    await loadRange(r.start, r.end)
  }

  async function load() {
    await ensureRangeForDate(new Date(month.value.y, month.value.m, 1))
  }

  /** 月份翻页：连续翻，不限制季度边界 */
  async function goMonth(delta) {
    const d = new Date(month.value.y, month.value.m + delta, 1)
    month.value = { y: d.getFullYear(), m: d.getMonth() }
    await ensureRangeForDate(new Date(month.value.y, month.value.m, 1))
  }

  /** 跳转到某个档期（搜索/链接直达用），定位到该档期第一个月 */
  async function goToSeason(y, s) {
    const targetYear = Number(y)
    const targetSeason = String(s || '').toUpperCase()
    if (!SEASONS[targetSeason] || !Number.isInteger(targetYear) || targetYear < 1970 || targetYear > 2100) return
    const ms = seasonMonths({ year: targetYear, season: targetSeason })
    if (!ms.length) return
    month.value = ms[0]
    await ensureRangeForDate(new Date(month.value.y, month.value.m, 1))
  }

  // 档期内没有放送排期的动漫（已完结/未开播/数据缺失）
  const noScheduleAnime = computed(() => {
    const scheduled = new Set(schedules.value.map((s) => s.mediaId))
    return [...mediaMap.value.values()].filter((m) => !scheduled.has(m.id))
  })

  load()

  return {
    year,
    season,
    month,
    mediaMap,
    schedules,
    noScheduleAnime,
    loading,
    error,
    load,
    goMonth,
    goToSeason,
    ensureRangeForDate,
    canPrevMonth: computed(() => true),
    canNextMonth: computed(() => true),
  }
}
