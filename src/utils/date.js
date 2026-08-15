// 档期（季度）与日历相关工具函数

export const SEASONS = {
  WINTER: { label: '冬季', months: [0, 1, 2] },
  SPRING: { label: '春季', months: [3, 4, 5] },
  SUMMER: { label: '夏季', months: [6, 7, 8] },
  FALL: { label: '秋季', months: [9, 10, 11] },
}

export const SEASON_ORDER = ['WINTER', 'SPRING', 'SUMMER', 'FALL']

/** 根据日期获取所在档期 */
export function seasonOf(date = new Date()) {
  const m = date.getMonth()
  const season = SEASON_ORDER.find((s) => SEASONS[s].months.includes(m))
  return { year: date.getFullYear(), season }
}

export function seasonLabel({ year, season }) {
  return `${year} ${SEASONS[season].label}`
}

export function isCurrentSeason(q) {
  const cur = seasonOf()
  return q.season === cur.season && q.year === cur.year
}

/** 档期向前/向后偏移（delta 为 ±1 等） */
export function shiftSeason({ year, season }, delta) {
  const i = SEASON_ORDER.indexOf(season)
  const n = i + delta
  return {
    year: year + Math.floor(n / 4),
    season: SEASON_ORDER[((n % 4) + 4) % 4],
  }
}

/** 档期的起止时间（Unix 秒），结束时间额外放宽一周 */
export function seasonWindow({ year, season }) {
  const months = SEASONS[season].months
  const start = new Date(year, months[0], 1, 0, 0, 0)
  const end = new Date(year, months[2] + 1, 1, 0, 0, 0)
  end.setTime(end.getTime() + 7 * 86400000)
  return {
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(end.getTime() / 1000),
  }
}

/** 档期包含的月份（数组） */
export function seasonMonths({ year, season }) {
  return SEASONS[season].months.map((m) => ({ y: year, m }))
}

/** Date → 'YYYY-MM-DD'（本地时区） */
export function dayKey(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Unix 秒 → 'YYYY-MM-DD'（本地时区） */
export function fmtDate(ts) {
  return dayKey(new Date(ts * 1000))
}

/** Unix 秒 → 'HH:mm'（本地时区） */
export function fmtTime(ts) {
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 本地日期 → 星期中文（'日'/'一'/…） */
export function weekdayCN(d) {
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
}

/** 日期 + n 天 */
export function addDays(d, n) {
  const nd = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  nd.setDate(nd.getDate() + n)
  return nd
}

/** 所在周的周一（本地，周一为每周第一天） */
export function mondayOf(d) {
  return addDays(d, -((d.getDay() + 6) % 7))
}

/** 周范围标签，如 '2026年8月10日 – 16日' */
export function weekRangeLabel(start) {
  const end = addDays(start, 6)
  const y = start.getFullYear()
  const m1 = start.getMonth() + 1
  const d1 = start.getDate()
  const m2 = end.getMonth() + 1
  const d2 = end.getDate()
  if (m1 === m2) return `${y}年${m1}月${d1}日 – ${d2}日`
  return `${y}年${m1}月${d1}日 – ${m2}月${d2}日`
}

/** 档期允许浏览的周范围（周一开头），返回 { minStart, maxStart }（Date） */
export function weekBounds({ year, season }) {
  const w = seasonWindow({ year, season })
  const minStart = mondayOf(new Date(w.start * 1000))
  const maxStart = mondayOf(new Date((w.end - 86400) * 1000))
  return { minStart, maxStart }
}

/** 生成某月的日历网格（周一开头），返回周数组，每格 { date, day, inMonth, isToday } */
export function buildMonthGrid(y, m, today = new Date()) {
  const first = new Date(y, m, 1)
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const startDow = (first.getDay() + 6) % 7 // 周一 = 0
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(
      cells.slice(i, i + 7).map((d) => {
        if (d == null) return { date: null, day: null, inMonth: false, isToday: false }
        const date = new Date(y, m, d)
        return {
          date,
          day: d,
          inMonth: true,
          isToday:
            date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate(),
        }
      })
    )
  }
  return weeks
}
