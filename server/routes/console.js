// 管理员控制台：REST 接口（一次性执行 / Tab 补全 / 服务端日志）
// 实时流式执行与中断走 WebSocket（consoleSocket.js），本文件保持 REST 兼容
import { Router, raw } from 'express'
import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { authRequired } from '../middleware/auth.js'
import { getConsoleLines } from '../logger.js'
import { CONSOLE_HOME } from '../config.js'
import { session, tryCd, decodeLine } from '../consoleSession.js'

const router = Router()
const TIMEOUT_MS = 15000

/** 解析文件管理路径：绝对路径直接使用；相对路径基于当前控制台会话目录；未传路径默认项目根目录 */
function resolveFsPath(p) {
  if (!p) return CONSOLE_HOME
  const target = path.isAbsolute(p) ? p : path.resolve(session.dir, p)
  return path.normalize(target)
}

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

/* —— 文件管理（仅管理员） —— */
router.get('/files', authRequired, (req, res) => {
  const dir = resolveFsPath(req.query.path)
  let st
  try {
    st = fs.statSync(dir)
  } catch {
    return res.status(400).json({ error: { code: 'INVALID_PATH', message: '目录不存在', path: dir } })
  }
  if (!st.isDirectory()) {
    return res.status(400).json({ error: { code: 'INVALID_PATH', message: '路径不是目录', path: dir } })
  }
  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch (e) {
    return res.status(500).json({ error: { code: 'READ_DIR_FAILED', message: e.message, path: dir } })
  }
  const entries = names
    .map((name) => {
      const full = path.join(dir, name)
      try {
        const s = fs.statSync(full)
        return {
          name,
          path: full,
          type: s.isDirectory() ? 'directory' : 'file',
          size: s.size,
          mtime: s.mtimeMs,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  res.json({ cwd: dir, entries })
})

router.get('/files/download', authRequired, (req, res) => {
  const file = resolveFsPath(req.query.path)
  let st
  try {
    st = fs.statSync(file)
  } catch {
    return res.status(400).json({ error: { code: 'INVALID_PATH', message: '文件不存在' } })
  }
  if (!st.isFile()) {
    return res.status(400).json({ error: { code: 'INVALID_PATH', message: '路径不是文件' } })
  }
  res.download(file)
})

router.post(
  '/files/upload',
  authRequired,
  raw({ type: 'application/octet-stream', limit: '200mb' }),
  (req, res) => {
    const dir = resolveFsPath(req.query.dir)
    const name = path.basename(String(req.query.name || 'upload.bin'))
    if (!name || name === '.' || name === '..') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '文件名不合法' } })
    }
    let st
    try {
      st = fs.statSync(dir)
    } catch {
      return res.status(400).json({ error: { code: 'INVALID_PATH', message: '目录不存在' } })
    }
    if (!st.isDirectory()) {
      return res.status(400).json({ error: { code: 'INVALID_PATH', message: '路径不是目录' } })
    }
    const dest = path.join(dir, name)
    try {
      fs.writeFileSync(dest, req.body || Buffer.alloc(0))
    } catch (e) {
      return res.status(500).json({ error: { code: 'WRITE_FAILED', message: e.message } })
    }
    res.json({ ok: true, path: dest })
  }
)

router.get('/files/content', authRequired, (req, res) => {
  const file = resolveFsPath(req.query.path)
  let st
  try {
    st = fs.statSync(file)
  } catch {
    return res.status(400).json({ error: { code: 'INVALID_PATH', message: '文件不存在' } })
  }
  if (!st.isFile()) {
    return res.status(400).json({ error: { code: 'INVALID_PATH', message: '路径不是文件' } })
  }
  const MAX_TEXT = 2 * 1024 * 1024
  if (st.size > MAX_TEXT) {
    return res.status(413).json({ error: { code: 'TOO_LARGE', message: '文件超过 2MB，暂不支持在线编辑' } })
  }
  const buf = fs.readFileSync(file)
  let text = buf.toString('utf8')
  if (text.includes('\uFFFD')) {
    try {
      text = new TextDecoder('gbk').decode(buf)
    } catch {
      /* 保留 utf8 结果 */
    }
  }
  res.json({ path: file, name: path.basename(file), content: text })
})

router.post(
  '/files/content',
  authRequired,
  raw({ type: 'text/plain', limit: '10mb' }),
  (req, res) => {
    const file = resolveFsPath(req.query.path)
    let st
    try {
      st = fs.statSync(file)
    } catch {
      return res.status(400).json({ error: { code: 'INVALID_PATH', message: '文件不存在' } })
    }
    if (!st.isFile()) {
      return res.status(400).json({ error: { code: 'INVALID_PATH', message: '路径不是文件' } })
    }
    try {
      fs.writeFileSync(file, req.body || Buffer.alloc(0))
    } catch (e) {
      return res.status(500).json({ error: { code: 'WRITE_FAILED', message: e.message } })
    }
    res.json({ ok: true, path: file })
  }
)

router.delete('/files', authRequired, (req, res) => {
  const target = resolveFsPath(req.query.path)
  let st
  try {
    st = fs.statSync(target)
  } catch {
    return res.status(400).json({ error: { code: 'INVALID_PATH', message: '文件或目录不存在' } })
  }
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch (e) {
    return res.status(500).json({ error: { code: 'DELETE_FAILED', message: e.message } })
  }
  res.json({ ok: true, path: target })
})

router.get('/logs', authRequired, (req, res) => {
  res.json({ lines: getConsoleLines() })
})

export default router
