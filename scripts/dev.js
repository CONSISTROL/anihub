// 本地一键启动：同时运行后端（dev:server）与前端（vite dev）。
// 用法：npm run dev:all
//
// 设计说明：不自己拦截 Ctrl+C，让两个子进程和当前终端处于同一控制台/进程组，
// 由终端原生的 Ctrl+C 行为同时停止前后端，避免自定义信号处理导致终端异常。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'

function start(name, args) {
  const child = isWin
    ? // Windows 下直接 spawn .cmd 会 EINVAL，改由 cmd.exe 执行 npm
      spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '1' },
      })
    : spawn('npm', args, {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '1' },
      })
  child.on('error', (e) => {
    console.error(`[${name}] 启动失败:`, e.message)
    process.exit(1)
  })
  return child
}

console.log('启动 AniHub 本地调试环境…')
console.log('  后端 API: http://localhost:3001')
console.log('  前端页面: http://localhost:5173')
console.log('按 Ctrl+C 停止（由终端同时结束前后端）\n')

start('backend', ['run', 'dev:server'])
start('frontend', ['run', 'dev'])
