// 管理员控制台：REST 接口（一次性执行 / Tab 补全 / 服务端日志）
// 实时流式执行与中断走 WebSocket（consoleSocket.js），本文件保持 REST 兼容
import { Router } from 'express'
import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { authRequired } from '../middleware/auth.js'
import { getConsoleLines } from '../logger.js'
import { session, tryCd, decodeLine } from '../consoleSession.js'

const router = Router()
const TIMEOUT_MS = 15000

/* —— Tab 补全 —— */
const WIN_EXE_EXT = new Set(['.exe', '.cmd', '.bat', '.com'])
let pathCache = null // { at, dirs: [{ name }] } PATH 下可执行命令缓存

function listPathCommands() {
  const now = Date.now()
  if (pathCache && now - pathCache.at < 30000) return pathCache.names
  const sep = process.platform === 'win32' ? ';' : ':'
  const dirs = (process.env.PATH || '').split(sep).filter(Boolean)
  const names = new Set()
  for (const d of dirs) {
    try {
      for (const f of fs.readdirSync(d)) {
        if (process.platform === 'win32') {
          if (WIN_EXE_EXT.has(path.extname(f).toLowerCase())) names.add(path.basename(f, path.extname(f)).toLowerCase())
        } else {
          try {
            if (fs.statSync(path.join(d, f)).mode & 0o111) names.add(f)
          } catch {}
        }
      }
    } catch {
      /* 目录不可读跳过 */
    }
  }
  // 常用内建命令补充
  for (const c of ['dir', 'cd', 'type', 'echo', 'cls', 'copy', 'del', 'mkdir', 'rmdir', 'ls', 'cat', 'pwd', 'grep', 'git', 'node', 'npm', 'pnpm', 'clear', 'rm', 'cp', 'mv', 'touch']) {
    names.add(process.platform === 'win32' ? c : c)
  }
  pathCache = { at: now, names: [...names] }
  return pathCache.names
}

function completePath(cwd, prefix) {
  const idx = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('\\'))
  const dir = idx >= 0 ? prefix.slice(0, idx + 1) : ''
  const base = idx >= 0 ? prefix.slice(idx + 1) : prefix
  const target = path.isAbsolute(dir) ? dir : path.join(cwd, dir)
  const out = []
  try {
    for (const f of fs.readdirSync(target)) {
      if (!f.toLowerCase().startsWith(base.toLowerCase())) continue
      let cand = dir + f
      try {
        if (fs.statSync(path.join(target, f)).isDirectory()) cand += path.sep
      } catch {}
      out.push(cand)
    }
  } catch {}
  return out
}

router.get('/complete', authRequired, (req, res) => {
  const text = String(req.query.text || '')
  const lastSpace = text.lastIndexOf(' ')
  const prefix = lastSpace < 0 ? text : text.slice(lastSpace + 1)
  const isCommand = lastSpace < 0
  const candidates = isCommand
    ? listPathCommands().filter((c) => c.startsWith(prefix.toLowerCase())).slice(0, 60)
    : completePath(session.dir, prefix).slice(0, 60)
  res.json({ candidates })
})

router.post('/exec', authRequired, (req, res) => {
  const cmd = typeof req.body?.cmd === 'string' ? req.body.cmd.trim() : ''
  if (!cmd) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '命令不能为空' } })
  }
  if (cmd.length > 4000) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '命令过长' } })
  }
  console.log(`[console] admin 执行命令: ${cmd}`)
  // cd 命令：更新会话工作目录，不启动子进程
  const cd = tryCd(session, cmd)
  if (cd) {
    console.log(`[console] 工作目录 -> ${cd.dir}`)
    return res.json({
      cmd,
      cwd: cd.dir,
      exitCode: cd.ok ? 0 : 1,
      timedOut: false,
      stdout: cd.ok ? cd.dir : '',
      stderr: cd.ok ? '' : cd.msg,
    })
  }
  exec(
    cmd,
    {
      cwd: session.dir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      timeout: TIMEOUT_MS,
      shell: true,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'buffer',
    },
    (err, stdout, stderr) => {
      const timedOut = !!err?.killed
      const exitCode = typeof err?.code === 'number' ? err.code : timedOut ? 124 : err ? 1 : 0
      res.json({
        cmd,
        cwd: session.dir,
        exitCode,
        timedOut,
        stdout: decodeLine(stdout),
        stderr: decodeLine(stderr),
      })
    }
  )
})

router.get('/logs', authRequired, (req, res) => {
  res.json({ lines: getConsoleLines() })
})

export default router
