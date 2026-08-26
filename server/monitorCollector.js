// 服务器指标采集器：每 5 秒采样 CPU / 内存 / 网络出入 / 磁盘读写，写入 SQLite（metrics 表）。
// 平台适配：
//  - CPU / 内存：node:os（跨平台）
//  - 网络：Linux/macOS 读 /proc/net/dev（累计字节，差分求速率）；Windows/macOS 用 netstat -e（累计字节）
//  - 磁盘：Linux 读 /proc/diskstats（累计扇区，差分）；Windows 用 Get-Counter（直接给速率）
import os from 'node:os'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import db from './db.js'

const execFileAsync = promisify(execFile)
const INTERVAL_MS = 5000
const PRUNE_AFTER = 35 * 24 * 3600 // 秒：只保留 35 天
const isLinux = process.platform === 'linux'

db.exec(`CREATE TABLE IF NOT EXISTS metrics (
  ts         INTEGER PRIMARY KEY,
  cpu        REAL,
  mem_used   REAL,
  net_in     REAL,
  net_out    REAL,
  disk_read  REAL,
  disk_write REAL
)`)

let lastCpu = null
let lastNet = null // { rx, tx } 累计字节
let lastDisk = null // { read, write } 累计字节（仅 Linux）
let timer = null
let running = false
let samples = 0

/** CPU 使用率（%）：os.cpus() 两次采样差分 */
function cpuPercent() {
  const cpus = os.cpus()
  let idle = 0
  let total = 0
  for (const c of cpus) {
    idle += c.times.idle
    for (const t of Object.values(c.times)) total += t
  }
  const now = { idle, total }
  if (!lastCpu) {
    lastCpu = now
    return null
  }
  const dIdle = now.idle - lastCpu.idle
  const dTotal = now.total - lastCpu.total
  lastCpu = now
  if (dTotal <= 0) return 0
  return Math.max(0, Math.min(100, (100 * (1 - dIdle / dTotal))))
}

/** 网络累计字节 { rx, tx }；失败返回 null */
async function readNetwork() {
  if (isLinux) {
    const s = await fs.promises.readFile('/proc/net/dev', 'utf8')
    let rx = 0
    let tx = 0
    for (const line of s.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 10 || !parts[0].endsWith(':')) continue
      rx += +parts[1] || 0
      tx += +parts[9] || 0
    }
    return { rx, tx }
  }
  // Windows / macOS：netstat -e 的第一行两个大整数 = 累计收到的字节 / 发送的字节
  const { stdout } = await execFileAsync('netstat', ['-e'])
  for (const line of stdout.split('\n')) {
    const m = line.match(/(\d+)\s+(\d+)/)
    if (m && +m[1] > 0) return { rx: +m[1], tx: +m[2] }
  }
  return null
}

/** 磁盘读写：Linux 返回累计字节 { read, write }；Windows 返回瞬时速率 { read, write }（单位 B/s） */
async function readDisk() {
  if (isLinux) {
    const s = await fs.promises.readFile('/proc/diskstats', 'utf8')
    let read = 0
    let write = 0
    for (const line of s.split('\n')) {
      const p = line.trim().split(/\s+/)
      if (p.length >= 14) {
        const name = p[2]
        if (/^(sd|hd|vd|nvme|mmcblk)/.test(name)) {
          read += (+p[5] || 0) * 512
          write += (+p[9] || 0) * 512
        }
      }
    }
    return { read, write }
  }
  if (process.platform === 'win32') {
    const ps =
      'Get-Counter "\\PhysicalDisk(_Total)\\Disk Read Bytes/sec","\\PhysicalDisk(_Total)\\Disk Write Bytes/sec" | ForEach-Object { $_.CounterSamples | ForEach-Object { $_.Path + "=" + $_.CookedValue } }'
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps])
    let read = 0
    let write = 0
    for (const line of stdout.split('\n')) {
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const v = parseFloat(line.slice(eq + 1)) || 0
      const lower = line.toLowerCase()
      if (lower.includes('disk read')) read = v
      else if (lower.includes('disk write')) write = v
    }
    return { read, write, rate: true }
  }
  return null // macOS 等其他平台暂不支持磁盘
}

async function sample() {
  if (running) return
  running = true
  try {
    const now = Math.floor(Date.now() / 1000)
    const cpu = cpuPercent()
    const memUsed = os.totalmem() - os.freemem()

    let netIn = 0
    let netOut = 0
    try {
      const net = await readNetwork()
      if (net && lastNet) {
        const dt = Math.max(1, now - lastNet.t)
        netIn = Math.max(0, (net.rx - lastNet.rx) / dt)
        netOut = Math.max(0, (net.tx - lastNet.tx) / dt)
      }
      if (net) lastNet = { ...net, t: now }
    } catch {}

    let diskRead = 0
    let diskWrite = 0
    try {
      const disk = await readDisk()
      if (disk) {
        if (disk.rate) {
          diskRead = disk.read
          diskWrite = disk.write
        } else if (lastDisk) {
          const dt = Math.max(1, now - lastDisk.t)
          diskRead = Math.max(0, (disk.read - lastDisk.read) / dt)
          diskWrite = Math.max(0, (disk.write - lastDisk.write) / dt)
        }
        if (!disk.rate) lastDisk = { ...disk, t: now }
      }
    } catch {}

    if (cpu === null) return // 首次采样仅建立基线
    db.prepare(
      'INSERT INTO metrics (ts, cpu, mem_used, net_in, net_out, disk_read, disk_write) VALUES (?,?,?,?,?,?,?)'
    ).run(now, Math.round(cpu * 10) / 10, Math.round(memUsed), Math.round(netIn), Math.round(netOut), Math.round(diskRead), Math.round(diskWrite))

    // 定期清理过期数据
    samples++
    if (samples % 12 === 0) {
      db.prepare('DELETE FROM metrics WHERE ts < ?').run(now - PRUNE_AFTER)
    }
  } catch {
    /* 采样失败不影响主流程 */
  } finally {
    running = false
  }
}

export function startMonitor() {
  if (timer) return
  sample() // 立即采一次建立基线
  timer = setInterval(sample, INTERVAL_MS)
  timer.unref?.()
}

export function stopMonitor() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
