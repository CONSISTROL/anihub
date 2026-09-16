// 主题状态：浅色 / 深色 / 按时间自动切换（默认自动）
// 手动选择持久化到 localStorage；自动模式在 6:00–18:00 用浅色，其余用深色
//
// 注意（原实现的 bug）：`resolved` 曾用 computed 包装 `themeByTime()`，
// 而 `themeByTime()` 读的是 `new Date()` —— 不是响应式依赖，
// 因此 computed 会永久缓存首次结果：跨过 6:00 / 18:00 时主题不会切换。
// 现在用一个每分钟推进的 tick 作为响应式依赖，时间边界到点即生效。

import { computed, ref } from 'vue'

const STORAGE_KEY = 'anime-calendar.theme'
const LIGHT_START_HOUR = 6
const DARK_START_HOUR = 18

/** 手动选择：auto（按时间）| light | dark，默认 auto */
export const theme = ref(localStorage.getItem(STORAGE_KEY) || 'auto')

/** 每分钟推进一次，作为「当前时间」的响应式代理 */
const timeTick = ref(Date.now())

/** 当前时间对应的主题 */
export function themeByTime(date = new Date()) {
  const h = date.getHours()
  return h >= LIGHT_START_HOUR && h < DARK_START_HOUR ? 'light' : 'dark'
}

/** 实际生效的主题（依赖 timeTick，跨时间边界会自动重算） */
export const resolved = computed(() => {
  timeTick.value // 订阅时间推进
  return theme.value === 'auto' ? themeByTime() : theme.value
})

/** 是否处于「按时间自动」模式 */
export const isAuto = computed(() => theme.value === 'auto')

let animTimer = null
let lastApplied = null

/** 把生效主题应用到 <html data-theme>；切换瞬间挂 .theme-animating 让全局颜色平滑过渡 */
export function applyTheme({ animate = true } = {}) {
  const next = resolved.value
  if (next === lastApplied) return // 值没变：不重写 DOM，避免整页样式重算
  lastApplied = next
  const el = document.documentElement
  if (animate) {
    el.classList.add('theme-animating')
    clearTimeout(animTimer)
    animTimer = setTimeout(() => el.classList.remove('theme-animating'), 600)
  }
  el.dataset.theme = next
  notifyTheme(next, animate)
}

/* ---------------------------------------------------------------------------
   跨文档主题同步（内置书 / 页内 iframe）
   以本站为准：内嵌文档不该自己按时间切主题，否则会出现「站点浅色、书里深色」。
   · 首帧：通过 iframe URL 上的 ?theme= 传入，由被嵌文档在解析期应用（不会闪一下）
   · 后续切换：postMessage 通知。目标源固定为同源，避免把主题广播给任意来源。
   --------------------------------------------------------------------------- */
const THEME_MSG = 'anihub:theme'
const themeSubscribers = new Set()

/** 订阅主题变化（用于没有走 postMessage 的内嵌文档，例如 srcdoc） */
export function onThemeChange(fn) {
  themeSubscribers.add(fn)
  return () => themeSubscribers.delete(fn)
}

function notifyTheme(next, animate) {
  for (const fn of themeSubscribers) {
    try {
      fn(next, animate)
    } catch {
      /* 单个订阅者出错不影响其它 */
    }
  }
  try {
    for (const frame of document.querySelectorAll('iframe')) {
      // 目标源用 '*'：srcdoc 文档是不透明来源（opaque origin），指定具体源会被丢弃。
      // 只发主题这一个无敏感信息的字段，接收端也校验 type 才应用。
      frame.contentWindow?.postMessage({ type: THEME_MSG, theme: next }, '*')
    }
  } catch {
    /* 忽略 */
  }
}

/**
 * 注入内嵌文档的主题接收脚本。
 *
 * 注意两点：
 * 1) iframe 用 srcdoc 渲染时是**不透明来源（opaque origin）**，无法读取 window.parent.document，
 *    因此主题值必须由父页面直接写进脚本（而不是靠读父文档）。
 * 2) 父页面 postMessage 时目标源只能用 '*'（指定具体源会被丢弃），
 *    所以这里不校验 e.origin，只校验消息结构。
 *
 * @param {'light'|'dark'} theme 当前生效主题
 */
export function themeBridgeScript(theme) {
  const initial = theme === 'dark' ? 'dark' : 'light'
  const lit = JSON.stringify(initial)
  return `
(function(){
  function apply(t){
    if (t !== 'light' && t !== 'dark') return;
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = t;
  }
  // 供父页面直接调用（同源 srcdoc 时父页面可访问 contentWindow）
  window.__anihubSetTheme = apply;
  apply(${lit});
  // 内嵌书有自己的主题状态（存在 localStorage，由它自己的初始化逻辑回填），
  // 会在加载过程中把 data-theme 改回它记住的值。因此在两个对齐阶段再压一次，
  // 保证"主题以本站为准"。之后的变化由 postMessage 保持同步。
  document.addEventListener('DOMContentLoaded', function(){ apply(${lit}) });
  window.addEventListener('load', function(){ apply(${lit}) });
  window.addEventListener('message', function(e){
    var d = e.data;
    if (d && d.type === '${THEME_MSG}') apply(d.theme);
  });
})();
`
}

/** 切换主题选择（auto/light/dark），持久化并生效 */
export function setTheme(t) {
  if (theme.value === t) return
  theme.value = t
  localStorage.setItem(STORAGE_KEY, t)
  applyTheme()
}

/* ---------------------------------------------------------------------------
   配色方案（与昼夜主题正交）
   data-theme 只管明暗、data-scheme 只管色板 —— 这样站内按 'light'/'dark' 分支的
   几处逻辑、以及书籍 iframe 的主题桥接脚本都不用知道方案的存在。
   ⚠ 刻意**不复用 applyTheme**：它按 data-theme 的 lastApplied 值提前返回，
     只改方案不改昼夜时会被它吞掉，所以这里单独维护一份 lastAppliedScheme。
   --------------------------------------------------------------------------- */
const SCHEME_KEY = 'anime-calendar.scheme'
/** 与 src/style.css 的 [data-scheme] 块、服务端 SCHEMES 一一对应 */
export const SCHEMES = ['classic', 'indigo']
export const DEFAULT_SCHEME = 'classic'

const storedScheme = localStorage.getItem(SCHEME_KEY)
export const scheme = ref(SCHEMES.includes(storedScheme) ? storedScheme : DEFAULT_SCHEME)

let lastAppliedScheme = null

/**
 * 应用配色方案。未知取值回退 classic。
 *
 * localStorage 只是**首屏前的提示值**（index.html 内联脚本读它抢首帧），
 * 服务端下发的值永远优先 —— 所以这里每次都把生效值回写 localStorage。
 */
export function applyScheme(next, { animate = true } = {}) {
  const s = SCHEMES.includes(next) ? next : DEFAULT_SCHEME
  scheme.value = s
  localStorage.setItem(SCHEME_KEY, s)
  if (s === lastAppliedScheme) return // 值没变：不重写 DOM
  lastAppliedScheme = s
  const el = document.documentElement
  if (animate) {
    // 复用 applyTheme 的定时器：两者同时变更时不会被对方提前摘掉过渡类
    el.classList.add('theme-animating')
    clearTimeout(animTimer)
    animTimer = setTimeout(() => el.classList.remove('theme-animating'), 600)
  }
  el.dataset.scheme = s
}

/** 切换配色方案（设置页保存后调用） */
export function setScheme(s) {
  const next = SCHEMES.includes(s) ? s : DEFAULT_SCHEME
  if (scheme.value === next && lastAppliedScheme === next) return
  applyScheme(next)
}

// 模块加载时立即生效（index.html 内联脚本已先设过一次，这里是状态对齐，不需要动画）
applyScheme(scheme.value, { animate: false })

// 模块加载时立即生效（index.html 内联脚本已先设过一次，这里是状态对齐，不需要动画）
applyTheme({ animate: false })

// 自动模式：每分钟检查一次时间边界（跨过 6:00 / 18:00 时切换）
// applyTheme 内部已做「值未变则直接返回」，因此这里不会每分钟触发全页重算。
setInterval(() => {
  timeTick.value = Date.now()
  if (theme.value === 'auto') applyTheme()
}, 60_000)
