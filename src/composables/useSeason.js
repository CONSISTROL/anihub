import { ref, computed } from 'vue'
import { loadSeasonData } from '../api/anilist'
import { seasonOf, shiftSeason, seasonWindow, seasonMonths, isCurrentSeason } from '../utils/date'
import { useSettings } from './useSettings'
import { useAuth } from './useAuth'

/** 档期状态管理：当前档期数据加载、档期/月份切换 */
export function useSeason() {
  const current = seasonOf()
  const year = ref(current.year)
  const season = ref(current.season)
  const month = ref({ y: current.year, m: new Date().getMonth() }) // 日历显示的月份
  const rawMap = ref(new Map()) // id → 动漫详情（原始，含成人内容）
  const rawSchedules = ref([]) // [{ airingAt, episode, mediaId }] 按时间升序
  const loading = ref(false)
  const error = ref('')

  // 成人内容是否显示：按身份（设置 → Anime 内容，管理员恒可见）
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

  async function load() {
    loading.value = true
    error.value = ''
    try {
      const q = { year: year.value, season: season.value }
      // 有缓存时直接返回，避免重复请求 AniList（媒体列表 7 天 / 排期当前档期 12 小时、过去档期 30 天）
      const { mediaMap: map, schedules: sched } = await loadSeasonData(q, seasonWindow(q))
      rawMap.value = map
      rawSchedules.value = sched
      // 默认月份：当前档期显示当月，其他档期显示档期的第一个月
      month.value = isCurrentSeason(q)
        ? { y: new Date().getFullYear(), m: new Date().getMonth() }
        : seasonMonths(q)[0]
    } catch (e) {
      error.value = e.message || String(e)
    } finally {
      loading.value = false
    }
  }

  /** 切换档期（delta = ±1） */
  function goSeason(delta) {
    const q = shiftSeason({ year: year.value, season: season.value }, delta)
    year.value = q.year
    season.value = q.season
    load()
  }

  /** 日历月份偏移 */
  function goMonth(delta) {
    const d = new Date(month.value.y, month.value.m + delta, 1)
    month.value = { y: d.getFullYear(), m: d.getMonth() }
  }

  // 月份导航边界（不能超出档期覆盖的月份）
  const monthIndex = computed(() => month.value.y * 12 + month.value.m)
  const monthBounds = computed(() => {
    const ms = seasonMonths({ year: year.value, season: season.value })
    const first = ms[0]
    const last = ms[ms.length - 1]
    return { first: first.y * 12 + first.m, last: last.y * 12 + last.m }
  })
  const canPrevMonth = computed(() => monthIndex.value > monthBounds.value.first)
  const canNextMonth = computed(() => monthIndex.value < monthBounds.value.last)

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
    goSeason,
    goMonth,
    canPrevMonth,
    canNextMonth,
  }
}
