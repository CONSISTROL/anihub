// 控制台 WebSocket：实时流式输出 + 交互输入 + 中断（Ctrl+C）。仅管理员（token 校验）。
// 客户端消息: { type: 'run', cmd } | { type: 'input', data } | { type: 'kill' }
// 服务端消息: ready/out/err/cwd/exit
import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from './config.js'
import { session, startStream, killCurrent, writeInput, tryCd } from './consoleSession.js'

export function attachConsoleSocket(server) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws/console') {
      socket.destroy()
      return
    }
    const token = url.searchParams.get('token') || ''
    let ok = false
    try {
      ok = jwt.verify(token, JWT_SECRET)?.role === 'admin'
    } catch {
      ok = false
    }
    if (!ok) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'ready', cwd: session.dir, pty: session.pty }))
    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === 'run' && typeof msg.cmd === 'string' && msg.cmd.trim()) {
        const cmd = msg.cmd.trim()
        console.log(`[console] admin 执行命令: ${cmd}`)
        startStream(cmd, {
          onOut: (text, replace) => ws.send(JSON.stringify({ type: 'out', text, replace })),
          onErr: (text) => ws.send(JSON.stringify({ type: 'err', text })),
          onCwd: (dir) => ws.send(JSON.stringify({ type: 'cwd', cwd: dir })),
          onExit: (r) => ws.send(JSON.stringify({ type: 'exit', ...r })),
        })
      } else if (msg.type === 'input' && typeof msg.data === 'string') {
        // 交互输入：转发给运行中的进程（PTY 下如 su 密码、shell 命令）
        // 交互 shell 里的 cd 是 shell 内建命令，不经 tryCd——这里镜像跟踪，
        // 让提示符目录与 shell 实际目录同步（绝对路径可靠；相对路径基于 session.dir）
        const line = msg.data.replace(/\r?\n$/, '')
        if (/^cd(?:\s|$)/.test(line)) {
          const cd = tryCd(line)
          if (cd && cd.ok) ws.send(JSON.stringify({ type: 'cwd', cwd: cd.dir }))
        }
        writeInput(msg.data)
      } else if (msg.type === 'kill') {
        if (killCurrent()) {
          console.log('[console] admin 中断当前命令')
        }
      }
    })
  })

  return wss
}
