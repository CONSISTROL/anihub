// 网站升级：检查 git 版本落后情况 + 管理员输入 root/sudo 密码后触发 deploy/update.sh
import { Router } from 'express'
import { exec, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { APP_DIR, GIT_BRANCH, GIT_REMOTE } from '../config.js'
import { authRequired } from '../middleware/auth.js'

const router = Router()
const FETCH_TIMEOUT_MS = 30000
const UPDATE_SCRIPT = 'deploy/update.sh'

function run(cmd, { cwd = APP_DIR, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        killed: !!err?.killed,
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim(),
      })
    })
  })
}

async function getGitStatus() {
  if (!fs.existsSync(path.join(APP_DIR, '.git'))) {
    return { git: false, message: '当前不是 git 部署，无法检查更新' }
  }

  const branch = GIT_BRANCH
  const fetch = await run(`git fetch "${GIT_REMOTE}" "${branch}"`, { timeout: FETCH_TIMEOUT_MS })

  const head = await run('git rev-parse HEAD')
  const headShort = await run('git rev-parse --short HEAD')
  const currentCommit = head.stdout || null
  const currentCommitShort = headShort.stdout || null

  if (fetch.code !== 0) {
    return {
      git: true,
      currentCommit,
      currentCommitShort,
      branch,
      updateAvailable: null,
      fetchError: fetch.killed ? '检查更新超时（网络较慢）' : fetch.stderr || fetch.stdout || '无法连接远程仓库',
    }
  }

  const remoteShort = await run('git rev-parse --short FETCH_HEAD')
  const counts = await run('git rev-list --left-right --count HEAD...FETCH_HEAD')
  const log = await run('git log --oneline -n 10 HEAD..FETCH_HEAD')

  let ahead = 0
  let behind = 0
  const parts = counts.stdout.split(/\s+/)
  if (parts.length >= 2) {
    ahead = Number(parts[0]) || 0
    behind = Number(parts[1]) || 0
  }

  const remoteCommits = log.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const sp = line.indexOf(' ')
      return {
        hash: sp > 0 ? line.slice(0, sp) : line,
        subject: sp > 0 ? line.slice(sp + 1) : '',
      }
    })

  return {
    git: true,
    currentCommit,
    currentCommitShort,
    remoteCommitShort: remoteShort.stdout || null,
    branch,
    ahead,
    behind,
    updateAvailable: behind > 0,
    remoteCommits,
  }
}

function verifySudoPassword(password) {
  return new Promise((resolve) => {
    if (typeof password !== 'string' || !password) return resolve(false)
    // root 用户本身无需密码
    if (typeof process.getuid === 'function' && process.getuid() === 0) return resolve(true)
    const child = spawn('sudo', ['-S', '-p', '', 'true'], { stdio: ['pipe', 'ignore', 'pipe'] })
    let errText = ''
    child.stderr.on('data', (d) => {
      errText += d.toString()
    })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
    try {
      child.stdin.write(password + '\n')
      child.stdin.end()
    } catch {
      resolve(false)
    }
  })
}

function triggerUpdate(password) {
  return new Promise((resolve) => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      // 已经是 root：直接后台执行，不经过 sudo
      const child = spawn('bash', [UPDATE_SCRIPT], {
        cwd: APP_DIR,
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      return resolve(true)
    }

    const child = spawn(
      'sudo',
      ['-S', '-p', '', 'bash', UPDATE_SCRIPT],
      {
        cwd: APP_DIR,
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      }
    )
    child.on('error', () => resolve(false))
    child.on('spawn', () => {
      try {
        child.stdin.write(password + '\n')
        child.stdin.end()
        child.unref()
        resolve(true)
      } catch {
        resolve(false)
      }
    })
  })
}

// 轻量版本信息：仅返回当前 commit，不触发 git fetch（供导航栏展示）
router.get('/version', authRequired, async (req, res) => {
  try {
    const headShort = await run('git rev-parse --short HEAD')
    const branch = await run('git rev-parse --abbrev-ref HEAD')
    if (!headShort.stdout) {
      return res.json({ git: false, currentCommitShort: null })
    }
    res.json({
      git: true,
      currentCommitShort: headShort.stdout,
      branch: branch.stdout || GIT_BRANCH,
    })
  } catch (e) {
    res.status(500).json({ error: { code: 'VERSION_FAILED', message: e.message } })
  }
})

// 管理员查看升级状态：当前版本、落后多少提交、是否有新版本
router.get('/status', authRequired, async (req, res) => {
  try {
    const status = await getGitStatus()
    res.json(status)
  } catch (e) {
    res.status(500).json({ error: { code: 'UPGRADE_STATUS_FAILED', message: e.message } })
  }
})

// 管理员触发升级：先校验 sudo/root 密码，再后台执行 deploy/update.sh
router.post('/', authRequired, async (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!password && !(typeof process.getuid === 'function' && process.getuid() === 0)) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '请输入 su/root 密码' } })
  }

  const ok = await verifySudoPassword(password)
  if (!ok) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'su/root 密码不正确' } })
  }

  try {
    await triggerUpdate(password)
    res.json({
      ok: true,
      started: true,
      message: '升级已触发，脚本正在后台执行；完成后服务会自动重启，请稍后刷新页面。',
    })
  } catch (e) {
    res.status(500).json({ error: { code: 'UPGRADE_START_FAILED', message: e.message } })
  }
})

export default router
