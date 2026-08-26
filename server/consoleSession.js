// 控制台会话：流式进程执行（实时回显）+ 会话工作目录 + 中断 + 交互输入。
// Linux 上通过系统自带的 script（util-linux）给子进程分配伪终端（PTY），
// 从而支持 su/passwd 等交互命令（密码提示实时显示、输入可转发、Ctrl+C 走终端驱动发 SIGINT）。
// 与 REST 路由（console.js）共享 session 状态；WebSocket（consoleSocket.js）使用 startStream 实时推送。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PROJECT_ROOT = path.join(import.meta.dirname, '..') // 项目根目录（server/ 的上级）
const STREAM_TIMEOUT_MS = 600000 // 流式命令最长 10 分钟（有输出/输入则顺延；可用 Ctrl+C 中断）
const FLUSH_IDLE_MS = 150 // 无换行的部分输出（如 su 的 "Password: " 提示）空闲后及时冲刷

export const session = {
  dir: PROJECT_ROOT, // 会话工作目录
  proc: null, // 当前运行的子进程
  pty: false, // 当前进程是否运行在伪终端（script）上
  killTimer: null, // PTY 软中断后的硬杀兜底定时器
  resetTimer: null, // startStream 内部超时定时器的重置函数（供 writeInput 调用）
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

/** 去掉 ANSI 转义序列（PTY 下程序会输出颜色/光标控制，行列表 UI 里显示为乱码） */
function stripAnsi(s) {
  return s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI（颜色、光标移动等）
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC（标题等）
    .replace(/\x1b[@-_][0-9]*/g, '') // 单字符转义（ESC M/7/8 等）
    .replace(/\x1b\[/g, '') // 残留的半截 CSI（跨块被切开的兜底）
}

/** 处理 \b 退格回显（PTY 行编辑会回显 "\b \b"，把前一个字符删掉） */
function collapseBackspaces(s) {
  if (!s.includes('\b')) return s
  while (s.includes('\b')) {
    const i = s.indexOf('\b')
    s = s.slice(0, Math.max(0, i - 1)) + s.slice(i + 1)
  }
  return s
}

/** 向运行中的进程写入输入（PTY 模式下经 script 转发给伪终端） */
export function writeInput(data) {
  const p = session.proc
  if (!p || !p.stdin || !p.stdin.writable) return false
  try {
    p.stdin.write(data)
    session.resetTimer?.()
    return true
  } catch {
    return false
  }
}

/**
 * 中断当前命令。
 * PTY 模式：先向伪终端写 \x03（终端驱动发 SIGINT，等价真实终端的 Ctrl+C），
 *   5 秒内进程没退出则硬杀兜底；第二次调用立即硬杀。
 * 非 PTY 模式（Windows / 无 script）：直接硬杀（Windows taskkill /T 杀进程树；Linux 杀进程组）。
 */
export function killCurrent(hard = false) {
  const p = session.proc
  if (!p || !p.pid) return false
  if (session.pty && !hard) {
    if (session.killTimer) {
      // 第二次 Ctrl+C：立即硬杀
      clearTimeout(session.killTimer)
      session.killTimer = null
      return killCurrent(true)
    }
    try {
      p.stdin?.write('\x03')
    } catch {}
    session.killTimer = setTimeout(() => {
      session.killTimer = null
      killCurrent(true)
    }, 5000)
    session.killTimer.unref?.()
    return true
  }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', String(p.pid)], { windowsHide: true, stdio: 'ignore' })
    } else {
      try {
        process.kill(-p.pid, hard ? 'SIGKILL' : 'SIGTERM')
      } catch {
        p.kill(hard ? 'SIGKILL' : 'SIGTERM')
      }
    }
  } catch {}
  return true
}

/**
 * 流式执行命令：实时回调输出（\r 进度条会以 replace=true 覆盖当前行；无换行提示 150ms 空闲即冲刷）。
 * onOut(text, replace) / onErr(text) / onCwd(dir) / onExit({exitCode, timedOut, cwd, ...})
 */
export function startStream(cmd, { onOut, onErr, onCwd, onExit }) {
  killCurrent(true) // 单会话：新命令替换旧命令（硬杀旧进程）
  const cd = tryCd(cmd)
  if (cd) {
    if (onCwd) onCwd(cd.dir)
    if (onExit)
      onExit({ exitCode: cd.ok ? 0 : 1, timedOut: false, cwd: cd.dir, stderr: cd.ok ? '' : cd.msg })
    return
  }

  // Linux 且存在 script（util-linux，Ubuntu 自带）：走伪终端，支持交互输入（su 密码等）
  const usePty = process.platform !== 'win32' && fs.existsSync('/usr/bin/script')
  let child
  if (usePty) {
    child = spawn('script', ['-qefc', cmd, '/dev/null'], {
      cwd: session.dir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        PYTHONUNBUFFERED: '1', // 管道下 Python 默认块缓冲，print 不实时输出；强制无缓冲（等价 python -u）
      },
      windowsHide: true,
      detached: true, // 独立进程组，便于整组终止
    })
  } else {
    child = spawn(cmd, {
      cwd: session.dir,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        PYTHONUNBUFFERED: '1',
      },
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32', // Linux 独立进程组，便于整组终止
    })
  }
  session.proc = child
  session.pty = usePty
  child.stdin?.on('error', () => {}) // 进程退出后再写 stdin 会触发 EPIPE，吞掉避免崩服务

  let finished = false
  const finish = (r) => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    if (session.killTimer) {
      clearTimeout(session.killTimer)
      session.killTimer = null
    }
    session.proc = null
    session.pty = false
    session.resetTimer = null
    if (onExit) onExit(r)
  }
  const onTimeout = () => {
    killCurrent(true)
    finish({ exitCode: 124, timedOut: true, cwd: session.dir })
  }
  let timer = setTimeout(onTimeout, STREAM_TIMEOUT_MS)
  timer.unref?.()
  // 有输出/输入就顺延超时（交互 shell 挂机不会被误杀；静默进程仍按 10 分钟兜底）
  const resetTimer = () => {
    clearTimeout(timer)
    timer = setTimeout(onTimeout, STREAM_TIMEOUT_MS)
    timer.unref?.()
  }
  session.resetTimer = resetTimer

  // 行级泵：\n 追加一行；\r\n 追加一行；单独 \r 覆盖当前行（进度条）；
  // 无换行的残留缓冲 150ms 空闲即冲刷（"Password: " 这类提示要实时显示）
  const makePump = (emit) => {
    let buf = Buffer.alloc(0)
    let flusher = null
    const flush = () => {
      if (flusher) {
        clearTimeout(flusher)
        flusher = null
      }
      if (buf.length) {
        emit(collapseBackspaces(stripAnsi(decodeLine(buf))), false)
        buf = Buffer.alloc(0)
      }
    }
    const push = (chunk) => {
      buf = Buffer.concat([buf, chunk])
      for (;;) {
        if (!buf.length) break
        const iN = buf.indexOf(0x0a)
        const iR = buf.indexOf(0x0d)
        if (iN < 0 && iR < 0) break
        if (iN >= 0 && (iR < 0 || iN < iR)) {
          // \n 先出现：一行结束（追加）
          emit(collapseBackspaces(stripAnsi(decodeLine(buf.slice(0, iN)))), false)
          buf = buf.slice(iN + 1)
        } else if (iR + 1 < buf.length && buf[iR + 1] === 0x0a) {
          // \r\n：一行结束（追加）
          emit(collapseBackspaces(stripAnsi(decodeLine(buf.slice(0, iR)))), false)
          buf = buf.slice(iR + 2)
        } else {
          // 单独 \r：进度条覆盖当前行
          emit(collapseBackspaces(stripAnsi(decodeLine(buf.slice(0, iR)))), true)
          buf = buf.slice(iR + 1)
        }
      }
      if (buf.length) {
        if (flusher) clearTimeout(flusher)
        flusher = setTimeout(flush, FLUSH_IDLE_MS)
        flusher.unref?.()
      }
    }
    return { push, flush }
  }
  const pOut = makePump(onOut)
  const pErr = makePump(onErr)

  child.stdout.on('data', (d) => {
    pOut.push(d)
    resetTimer()
  })
  child.stderr.on('data', (d) => {
    pErr.push(d)
    resetTimer()
  })
  child.on('error', (e) => {
    finish({ exitCode: 1, timedOut: false, cwd: session.dir, error: e.message })
  })
  child.on('exit', (code, signal) => {
    pOut.flush()
    pErr.flush()
    const timedOut = !!signal || code === 124
    finish({ exitCode: code ?? (timedOut ? 124 : 1), timedOut, cwd: session.dir, signal })
  })
}
