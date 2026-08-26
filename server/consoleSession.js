// 控制台会话：流式进程执行（实时回显）+ 会话工作目录 + 中断。
// 与 REST 路由（console.js）共享 session 状态；WebSocket（consoleSocket.js）使用 startStream 实时推送。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PROJECT_ROOT = path.join(import.meta.dirname, '..') // 项目根目录（server/ 的上级）
const STREAM_TIMEOUT_MS = 600000 // 流式命令最长 10 分钟（用户可用 Ctrl+C 中断）

export const session = {
  dir: PROJECT_ROOT, // 会话工作目录
  proc: null, // 当前运行的子进程
}

/** cd 命令：更新会话工作目录（一次性子进程无法保留 cd） */
export function tryCd(cmd) {
  if (!/^cd(?:\s|$)/i.test(cmd)) return null
  let raw = cmd.slice(2).trim()
  raw = raw.replace(/^\/d\s+/i, '') // Windows cd /d
  if (!raw) return { ok: true, dir: session.dir, msg: '' }
  const target = raw.replace(/^"(.*)"$/, '$1').trim()
  const resolved = path.resolve(session.dir, target)
  let isDir = false
  try {
    isDir = fs.statSync(resolved).isDirectory()
  } catch {}
  if (!isDir) {
    return { ok: false, dir: session.dir, msg: `系统找不到指定的路径: ${raw}` }
  }
  session.dir = resolved
  return { ok: true, dir: session.dir, msg: '' }
}

/** 行级解码：先按 UTF-8 严格解，出现替换符则按 GBK 解。
 *  \n 与 \r 在 UTF-8/GBK 的多字节字符内都不会出现，按行切分是安全的。 */
export function decodeLine(buf) {
  const s = Buffer.from(buf).toString('utf8')
  if (!s.includes('\uFFFD')) return s
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return s
  }
}

/** 中断当前命令（Windows 用 taskkill /T 杀进程树；Linux 杀进程组） */
export function killCurrent() {
  const p = session.proc
  if (!p || !p.pid) return false
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', String(p.pid)], { windowsHide: true, stdio: 'ignore' })
    } else {
      try {
        process.kill(-p.pid, 'SIGTERM')
      } catch {
        p.kill('SIGTERM')
      }
    }
  } catch {}
  return true
}

/**
 * 流式执行命令：实时回调输出（\r 进度条会以 replace=true 覆盖当前行）。
 * onOut(text, replace) / onErr(text) / onCwd(dir) / onExit({exitCode, timedOut, cwd})
 */
export function startStream(cmd, { onOut, onErr, onCwd, onExit }) {
  killCurrent() // 单会话：新命令替换旧命令
  const cd = tryCd(cmd)
  if (cd) {
    if (onCwd) onCwd(cd.dir)
    if (onExit)
      onExit({ exitCode: cd.ok ? 0 : 1, timedOut: false, cwd: cd.dir, stderr: cd.ok ? '' : cd.msg })
    return
  }

  const child = spawn(cmd, {
    cwd: session.dir,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      PYTHONUNBUFFERED: '1', // 管道下 Python 默认块缓冲，print 不实时输出；强制无缓冲（等价 python -u）
    },
    shell: true,
    windowsHide: true,
    detached: process.platform !== 'win32', // Linux 独立进程组，便于整组终止
  })
  session.proc = child

  let timer = setTimeout(() => {
    killCurrent()
    onExit({ exitCode: 124, timedOut: true, cwd: session.dir })
  }, STREAM_TIMEOUT_MS)
  timer.unref?.()

  let bufOut = Buffer.alloc(0)
  let bufErr = Buffer.alloc(0)

  const pump = (chunk, bufRef, emit) => {
    const buf = Buffer.concat([bufRef, chunk])
    let rest = buf
    for (;;) {
      if (!rest.length) break
      const iN = rest.indexOf(0x0a)
      const iR = rest.indexOf(0x0d)
      if (iN < 0 && iR < 0) break
      if (iN >= 0 && (iR < 0 || iN < iR)) {
        // \n 先出现：一行结束（追加）
        emit(decodeLine(rest.slice(0, iN)), false)
        rest = rest.slice(iN + 1)
      } else {
        // \r 先出现
        if (iR + 1 < rest.length && rest[iR + 1] === 0x0a) {
          // \r\n：一行结束（追加）
          emit(decodeLine(rest.slice(0, iR)), false)
          rest = rest.slice(iR + 2)
        } else {
          // 单独 \r：进度条覆盖当前行
          emit(decodeLine(rest.slice(0, iR)), true)
          rest = rest.slice(iR + 1)
        }
      }
    }
    return rest
  }

  child.stdout.on('data', (d) => {
    bufOut = pump(d, bufOut, onOut)
  })
  child.stderr.on('data', (d) => {
    bufErr = pump(d, bufErr, onErr)
  })
  child.on('error', (e) => {
    clearTimeout(timer)
    session.proc = null
    if (onExit) onExit({ exitCode: 1, timedOut: false, cwd: session.dir, error: e.message })
  })
  child.on('exit', (code, signal) => {
    clearTimeout(timer)
    // 冲刷剩余缓冲
    if (bufOut.length) onOut(decodeLine(bufOut), false)
    if (bufErr.length) onErr(decodeLine(bufErr))
    session.proc = null
    const timedOut = !!signal || code === 124
    if (onExit) onExit({ exitCode: code ?? (timedOut ? 124 : 1), timedOut, cwd: session.dir, signal })
  })
}
