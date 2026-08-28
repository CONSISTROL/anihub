// 控制台 WebSocket：每连接一个终端会话（多终端标签页各连一条）。
// 原始字节流（终端模拟器渲染）+ 交互输入 + 中断（Ctrl+C）。仅管理员（token 校验）。
// 客户端消息: { type: 'run', cmd, term?, cols?, rows? } | { type: 'input', data } | { type: 'kill' }
// 服务端消息: ready/out/err/cwd/exit
import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from './config.js'
import { createSession, startStream, killCurrent, writeInput } from './consoleSession.js'

/** 终端会话启动命令：设置 PTY 尺寸后进入交互 shell（stty 静默、无回显污染） */
function terminalCommand(cols, rows) {
  const shell = process.platform === 'win32' ? 'cmd' : 'bash'
  const c = Math.max(20, Math.min(500, Number(cols) || 80))
  const r = Math.max(5, Math.min(200, Number(rows) || 24))
  if (process.platform === 'win32') return shell
  return `stty rows ${r} cols ${c}; exec ${shell}`
}

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
    // 每个连接独立会话（多终端互不影响），初始目录固定为项目根目录，
    // 避免上一次终端 cd 的全局副作用把新终端/文件管理器默认目录带走
    const sess = createSession()
    ws.send(JSON.stringify({ type: 'ready', cwd: sess.dir, pty: sess.pty }))
    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === 'run' && typeof msg.cmd === 'string' && msg.cmd.trim()) {
        const isTerm = msg.term === true
        const cmd = isTerm ? terminalCommand(msg.cols, msg.rows) : msg.cmd.trim()
        console.log(`[console] admin ${isTerm ? '启动终端会话' : `执行命令: ${cmd}`}`)
        startStream(sess, cmd, {
          onOut: (text) => ws.send(JSON.stringify({ type: 'out', text })),
          onErr: (text) => ws.send(JSON.stringify({ type: 'err', text })),
          onCwd: (dir) => ws.send(JSON.stringify({ type: 'cwd', cwd: dir })),
          onExit: (r) => ws.send(JSON.stringify({ type: 'exit', ...r })),
          noTimeout: isTerm, // 终端会话不设超时（交互 shell 挂机不被杀）
        })
      } else if (msg.type === 'input' && typeof msg.data === 'string') {
        // 交互输入（终端模式为逐键字节）：转发给本会话的进程
        writeInput(sess, msg.data)
      } else if (msg.type === 'kill') {
        if (killCurrent(sess)) {
          console.log('[console] admin 中断当前命令')
        }
      }
    })
    // 终端断开（关闭标签页/刷新）：清理本会话进程，避免孤儿 shell
    ws.on('close', () => killCurrent(sess, true))
  })

  return wss
}
