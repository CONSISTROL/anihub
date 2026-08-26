// 服务端控制台：捕获 console 输出到环形缓冲（供管理员控制台查看实时日志）
const MAX = 600 // 保留最近 600 条
const lines = []
let installed = false

function fmt(v) {
  if (v instanceof Error) return v.stack || v.message
  if (typeof v === 'object' && v !== null) {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

export function captureConsole() {
  if (installed) return
  installed = true
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console)
    console[level] = (...args) => {
      const text = args.map(fmt).join(' ')
      lines.push({ ts: Date.now(), level: level === 'info' ? 'log' : level, text })
      if (lines.length > MAX) lines.splice(0, lines.length - MAX)
      orig(...args)
    }
  }
}

export function getConsoleLines() {
  return lines
}
