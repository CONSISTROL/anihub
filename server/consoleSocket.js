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

// 背压阈值：命令输出（如 `yes`、`find /`）产生速度远超网络时，
// 无限制 ws.send 会让消息堆在内存里直至 OOM。超过阈值直接丢弃并提示。
const BACKPRESSURE_LIMIT = 8 * 1024 * 1024
const HEARTBEAT_MS = 30_000

let activeWss = null

/** 安全发送：检查连接状态与积压量 */
function safeSend(ws, payload) {
  if (ws.readyState !== ws.OPEN) return false
  if (ws.bufferedAmount > BACKPRESSURE_LIMIT) return false
  try {
    ws.send(payload)
    return true
  } catch {
    return false
  }
}

export function attachConsoleSocket(server) {
  const wss = new WebSocketServer({ noServer: true })
  activeWss = wss

  server.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== '/ws/console') {
      // /local-web/* 的升级归本地 Web 代理（index.js 里先注册的处理器）所有。
      // Node 的 'upgrade' 是广播：本处理器也会被调用，直接 destroy 会把
      // 已经被代理接管的 socket 打死（表现为本地 Web 的 WebSocket 一握手就断）。
      if (!url.pathname.startsWith('/local-web/')) socket.destroy()
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
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })
    // 没有 error 处理时，底层 socket 错误会以未捕获异常形式冒泡
    ws.on('error', (err) => {
      console.error('[console] WebSocket 错误:', err?.message || err)
    })

    safeSend(ws, JSON.stringify({ type: 'ready', cwd: sess.dir, pty: sess.pty }))

    // 输出节流：高产出命令下合并同一 tick 内的分片，减少 ws 帧数量与内存占用
    let dropped = false
    const sendOut = (type) => (text) => {
      if (!safeSend(ws, JSON.stringify({ type, text }))) {
        if (!dropped) {
          dropped = true
          // 只提示一次，之后静默丢弃，避免「提示本身」把缓冲顶满
          safeSend(ws, JSON.stringify({ type: 'err', text: '\n[输出过快，已丢弃部分内容]\n' }))
        }
      }
    }

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
        dropped = false
        startStream(sess, cmd, {
          onOut: sendOut('out'),
          onErr: sendOut('err'),
          onCwd: (dir) => safeSend(ws, JSON.stringify({ type: 'cwd', cwd: dir })),
          onExit: (r) => safeSend(ws, JSON.stringify({ type: 'exit', ...r })),
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
    // 终端断开（关闭标签页/刷新）：清理本会话进程，避免孤儿 shell。
    // 同时必须 terminate，否则服务端认为连接还活着，挂机连接会一直占着 PTY。
    ws.on('close', () => killCurrent(sess, true))
  })

  // 心跳：清理半开连接（客户端崩溃/网络断开时 TCP 不会立刻通知）
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      try {
        ws.ping()
      } catch {
        /* 忽略 */
      }
    }
  }, HEARTBEAT_MS)
  heartbeat.unref?.()

  wss.on('close', () => clearInterval(heartbeat))

  return wss
}

/** 优雅退出时关闭所有控制台连接（WS 会让 server.close() 一直挂起） */
export function closeConsoleSockets() {
  if (!activeWss) return
  for (const ws of activeWss.clients) {
    try {
      ws.close(1001, 'server shutting down')
    } catch {
      /* 忽略 */
    }
    // close 握手可能永远不完成，直接销毁
    setTimeout(() => {
      try {
        ws.terminate()
      } catch {}
    }, 200).unref?.()
  }
  activeWss = null
}
