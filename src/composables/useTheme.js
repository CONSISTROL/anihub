// 主题状态：浅色 / 深色 / 按时间自动切换（默认）
// 手动选择持久化到 localStorage；自动模式在 6:00–18:00 用浅色，其余用深色

import { computed, ref } from 'vue'

const STORAGE_KEY = 'anime-calendar.theme'
const LIGHT_START_HOUR = 6
const DARK_START_HOUR = 18

/** 手动选择：auto（按时间）| light | dark，默认 auto */
export const theme = ref(localStorage.getItem(STORAGE_KEY) || 'auto')

/** 当前时间对应的主题 */
export function themeByTime(date = new Date()) {
  const h = date.getHours()
  return h >= LIGHT_START_HOUR && h < DARK_START_HOUR ? 'light' : 'dark'
}

/** 实际生效的主题 */
export const resolved = computed(() => (theme.value === 'auto' ? themeByTime() : theme.value))

/** 把生效主题应用到 <html data-theme> */
export function applyTheme() {
  document.documentElement.dataset.theme = resolved.value
}

/** 切换主题选择（auto/light/dark），持久化并生效 */
export function setTheme(t) {
  theme.value = t
  localStorage.setItem(STORAGE_KEY, t)
  applyTheme()
}

// 模块加载时立即生效
applyTheme()

// 自动模式：每分钟检查一次时间边界（跨过 6:00 / 18:00 时切换）
setInterval(() => {
  if (theme.value === 'auto') applyTheme()
}, 60_000)
