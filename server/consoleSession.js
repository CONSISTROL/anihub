// 控制台会话：流式进程执行（原始字节流）+ 会话工作目录 + 中断 + 交互输入。
// Linux 上通过系统自带的 script（util-linux）给子进程分配伪终端（PTY），
// 从而支持 su/passwd/htop/vim 等交互命令（终端模拟器 xterm.js 自行解析 ANSI）。
// 与 REST 路由（console.js）共享 session 状态；WebSocket（consoleSocket.js）使用 startStream 实时推送。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PROJECT_ROOT = path.join(import.meta.dirname, '..') // 项目根目录（server/ 的上级）
const STREAM_TIMEOUT_MS = 600000 // 一次性命令最长 10 分钟（有输出/输入则顺延；终端会话不设超时）

export const session = {
  dir: PROJECT_ROOT, // 会话工作目录
  proc: null, // 当前运行的子进程
  pty: false, // 当前进程是否运行在伪终端（script）上
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

/** 行级解码（REST 一次性执行用）：先按 UTF-8 严格解，出现替换符则按 GBK 解。
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

/** 向运行中的进程写入输入（PTY 模式下经 script 转发给伪终端，含逐键字节） */
export function writeInput(data) {
  const p = session.proc
  if (!p || !p.stdin || !p.stdin.writable) return false
  // Windows 无 PTY（cmd 走管道）：cmd 的行终止符是 \n（单独的 \r 不触发执行），
  // 而终端模拟器的回车键发 \r——翻译成 \n
  if (process.platform === 'win32' && !session.pty) {
    data = String(data).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  }
  try {
    p.stdin.write(data)
    session.resetTimer?.()
    return true
  } catch {
    return false
  }
}

// 软中断（\x03）计数：连续 3 次内只发 SIGINT（真终端行为，停在提示符的 shell 不会被杀），
// 3 次内仍不退出则转硬杀
let softKillCount = 0
let softKillTimer = null

function resetSoftKill() {
  if (softKillTimer) clearTimeout(softKillTimer)
  softKillTimer = null
  softKillCount = 0
}

/** 杀进程树：先杀 pid 所在进程组，再读 /proc/<pid>/task/<pid>/children
 *  杀其直接子进程组——script 的子 shell（setsid 后是独立会话/进程组首领）
 *  包含 su/root shell 全家，只杀 script 自己会导致它们残留 */
function killGroupTree(pid, sig) {
  let kids = []
  try {
    kids = fs
      .readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
  } catch {}
  try {
    process.kill(-pid, sig)
  } catch {}
  for (const k of kids) {
    if (k && k !== pid) {
      try {
        process.kill(-k, sig)
      } catch {}
    }
  }
}

/**
 * 中断当前命令。
 * PTY 模式：向伪终端写 \x03（终端驱动发 SIGINT，等价真实终端 Ctrl+C）。
 *   停在提示符的 shell 收到后只是换行出新提示符，不会被杀（真终端行为）；
 *   连续 3 次 \x03 仍不退出（进程忽略 SIGINT）则硬杀兜底。
 * 非 PTY 模式（Windows / 无 script）：直接硬杀（Windows taskkill /T 杀进程树；Linux 杀进程组）。
 */
export function killCurrent(hard = false) {
  const p = session.proc
  if (!p || !p.pid) return false
  if (session.pty && !hard) {
    softKillCount++
    if (softKillTimer) clearTimeout(softKillTimer)
    softKillTimer = setTimeout(resetSoftKill, 8000)
    try {
      p.stdin?.write('\x03')
    } catch {}
    if (softKillCount >= 3) {
      resetSoftKill()
      return killCurrent(true)
    }
    return true
  }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', String(p.pid)], { windowsHide: true, stdio: 'ignore' })
    } else {
      killGroupTree(p.pid, hard ? 'SIGKILL' : 'SIGTERM')
    }
  } catch {}
  return true
}

/** 原始流解码器：按 \n 切分（\n 不在多字节字符内，切分安全），每段独立解码
 *  （UTF-8 优先，出现替换符按 GBK 兜底——兼容 Windows cmd 的 GBK 输出），
 *  拼回原样保留 \r 与 ANSI 序列交给终端模拟器解析；无换行的残留（如提示符）
 *  150ms 空闲冲刷（xterm 光标会把它和后续回显拼在同一行） */
function makeRawDecoder(emit) {
  let buf = Buffer.alloc(0)
  let flusher = null
  const flushNow = () => {
    if (flusher) {
      clearTimeout(flusher)
      flusher = null
    }
    if (buf.length) {
      emit(decodeLine(buf))
      buf = Buffer.alloc(0)
    }
  }
  const push = (chunk) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const i = buf.indexOf(0x0a)
      if (i < 0) break
      emit(decodeLine(buf.slice(0, i)) + '\n')
      buf = buf.slice(i + 1)
    }
    if (buf.length) {
      if (flusher) clearTimeout(flusher)
      flusher = setTimeout(flushNow, 150)
      flusher.unref?.()
    }
  }
  return { push, flush: flushNow }
}

/**
 * 流式执行命令：原始字节流输出（终端模拟器 xterm.js 自行解析 ANSI/换行/进度条）。
 * onOut(text) / onErr(text) / onCwd(dir) / onExit({exitCode, timedOut, cwd, ...})
 * noTimeout=true：终端会话不设 10 分钟超时（交互 shell 挂机不被杀）。
 */
export function startStream(cmd, { onOut, onErr, onCwd, onExit, noTimeout = false }) {
  killCurrent(true) // 单会话：新命令替换旧命令（硬杀旧进程）
  const cd = tryCd(cmd)
  if (cd) {
    if (onCwd) onCwd(cd.dir)
    if (onExit)
      onExit({ exitCode: cd.ok ? 0 : 1, timedOut: false, cwd: cd.dir, stderr: cd.ok ? '' : cd.msg })
    return
  }

  // Linux 且存在 script（util-linux，Ubuntu 自带）：走伪终端，支持交互命令
  const usePty = process.platform !== 'win32' && fs.existsSync('/usr/bin/script')
  // 子进程环境：不继承 NODE_ENV=production——否则 npm ci 会跳过 devDependencies（vite 等），
  // 控制台里跑构建/更新会报 vite: not found
  const childEnv = { ...process.env }
  delete childEnv.NODE_ENV
  let child
  if (usePty) {
    child = spawn('script', ['-qefc', cmd, '/dev/null'], {
      cwd: session.dir,
      env: {
        ...childEnv,
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
        ...childEnv,
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
    if (timer) clearTimeout(timer)
    resetSoftKill()
    // 只清理自己拥有的进程：旧命令被新命令顶替时（kill 是异步的），
    // 旧 finish 可能晚于新进程启动——不能把新进程的 session.proc 清掉
    if (session.proc === child) {
      session.proc = null
      session.pty = false
      session.resetTimer = null
    }
    if (onExit) onExit(r)
  }
  const onTimeout = () => {
    killCurrent(true)
    finish({ exitCode: 124, timedOut: true, cwd: session.dir })
  }
  let timer = null
  const resetTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = setTimeout(onTimeout, STREAM_TIMEOUT_MS)
    timer.unref?.()
  }
  if (!noTimeout) {
    timer = setTimeout(onTimeout, STREAM_TIMEOUT_MS)
    timer.unref?.()
    // 有输出/输入就顺延超时（交互挂机不会被误杀；静默进程仍按 10 分钟兜底）
    session.resetTimer = resetTimer
  } else {
    session.resetTimer = null
  }

  // 原始字节流：按行解码（UTF-8 优先、GBK 兜底），ANSI 原样交给终端模拟器
  const decOut = makeRawDecoder(onOut)
  const decErr = makeRawDecoder(onErr)
  child.stdout.on('data', (d) => {
    decOut.push(d)
    resetTimer()
  })
  child.stderr.on('data', (d) => {
    decErr.push(d)
    resetTimer()
  })
  child.on('error', (e) => {
    finish({ exitCode: 1, timedOut: false, cwd: session.dir, error: e.message })
  })
  child.on('exit', (code, signal) => {
    decOut.flush()
    decErr.flush()
    const timedOut = !!signal || code === 124
    finish({ exitCode: code ?? (timedOut ? 124 : 1), timedOut, cwd: session.dir, signal })
  })
}
