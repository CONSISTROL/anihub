// 管理员控制台：在服务器上执行命令（仅管理员）+ 查看服务端实时日志
// 注意：这是对服务器的直接命令执行能力，authRequired 已限定仅管理员可用
import { Router } from 'express'
import { exec } from 'node:child_process'
import path from 'node:path'
import { authRequired } from '../middleware/auth.js'
import { getConsoleLines } from '../logger.js'

const router = Router()
const CWD = path.join(import.meta.dirname, '..', '..') // 项目根目录
const TIMEOUT_MS = 15000

router.post('/exec', authRequired, (req, res) => {
  const cmd = typeof req.body?.cmd === 'string' ? req.body.cmd.trim() : ''
  if (!cmd) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '命令不能为空' } })
  }
  if (cmd.length > 4000) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '命令过长' } })
  }
  console.log(`[console] admin 执行命令: ${cmd}`)
  // Windows 下 cmd 的输出编码随代码页漂移（GBK 或 UTF-8 都可能），取原始字节后自动识别解码：
  // 先按 UTF-8 严格解码，出现替换符则按 GBK 解码，保证中文正常显示
  exec(
    cmd,
    { cwd: CWD, timeout: TIMEOUT_MS, shell: true, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'buffer' },
    (err, stdout, stderr) => {
      const decode = (buf) => {
        const s = Buffer.from(buf || '').toString('utf8')
        if (!s.includes('\uFFFD')) return s
        try {
          return new TextDecoder('gbk').decode(buf)
        } catch {
          return s
        }
      }
      const timedOut = !!err?.killed
      const exitCode = typeof err?.code === 'number' ? err.code : timedOut ? 124 : err ? 1 : 0
      res.json({
        cmd,
        cwd: CWD,
        exitCode,
        timedOut,
        stdout: decode(stdout),
        stderr: decode(stderr),
      })
    }
  )
})

router.get('/logs', authRequired, (req, res) => {
  res.json({ lines: getConsoleLines() })
})

export default router
