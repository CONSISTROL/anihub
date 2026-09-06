// 本地一键启动：同时运行后端（dev:server）与前端（vite dev）。
// 用法：npm run dev:all
// 支持 Ctrl+C 停止；Windows 下会用 taskkill 结束整个子进程树。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'

function prefixedLine(prefix, text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (line) console.log(`${prefix} ${line}`)
  }
}

function start(name, args) {
  const child = isWin
    ? // Windows 下直接 spawn .cmd 会 EINVAL，改由 cmd.exe 执行 npm
      spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], {
        cwd: root,
        stdio: ['inherit', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '1' },
      })
    : spawn('npm', args, {
        cwd: root,
        stdio: ['inherit', 'pipe', 'pipe'],
        windowsHide: true,
        detached: true, // Unix 下独立进程组，便于一键停止整棵进程树
        env: { ...process.env, FORCE_COLOR: '1' },
      })
  const tag = name === 'backend' ? '\x1b[36m[server]\x1b[0m' : '\x1b[32m[vite]  \x1b[0m'
  child.stdout.on('data', (d) => prefixedLine(tag, d.toString()))
  child.stderr.on('data', (d) => prefixedLine(`\x1b[31m${tag}\x1b[0m`, d.toString()))
  child.on('error', (e) => {
    console.error(tag, '启动失败:', e.message)
  })
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`${tag} 已退出（code=${code}），正在停止另一个进程…`)
      shutdown()
    }
  })
  return child
}

let shuttingDown = false
const children = []

function killChild(child) {
  if (!child || child.exitCode !== null || child.killed) return
  if (isWin) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch {
      child.kill('SIGTERM')
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM') // Linux 下按进程组停止
    } catch {
      child.kill('SIGTERM')
    }
  }
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  console.log('\n正在停止前后端…')
  for (const child of children) killChild(child)
  setTimeout(() => process.exit(0), 1200)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log('启动 AniHub 本地调试环境…')
console.log('  后端 API: http://localhost:3001')
console.log('  前端页面: http://localhost:5173')
console.log('按 Ctrl+C 可同时停止前后端\n')

children.push(start('backend', ['run', 'dev:server']))
children.push(start('frontend', ['run', 'dev']))
