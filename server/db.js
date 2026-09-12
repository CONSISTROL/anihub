// SQLite 连接与建表（node:sqlite，Node ≥ 23.4 内置，无需外部依赖）
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { ADMIN_USERNAME, ADMIN_PASSWORD } from './config.js'

const db = new DatabaseSync(path.join(import.meta.dirname, 'anihub.db'))

// SQLite 运行时调优：
// - WAL：读写并发（已有）
// - synchronous = NORMAL：WAL 模式下只有 checkpoint 才 fsync，
//   避免「每次页面访问都触发一次 fsync」——访问统计写入在热路径上，这个差异很直观
// - busy_timeout：并发写时自动等待而不是立刻抛 SQLITE_BUSY
// - wal_autocheckpoint + journal_size_limit：限制 WAL 膨胀
//   （此前观察到 -wal 达 9.1MB、主库 14.6MB，重启也不回收）
// - cache_size：负值表示 KB，64MB 页缓存，提升访问统计 / 动漫缓存的读取命中
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA wal_autocheckpoint = 1000;
  PRAGMA journal_size_limit = 67108864;
  PRAGMA cache_size = -65536;
  PRAGMA temp_store = MEMORY;
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category    TEXT NOT NULL DEFAULT 'blog' CHECK (category IN ('blog', 'wiki')),
    title       TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    summary     TEXT NOT NULL DEFAULT '',
    content_md  TEXT NOT NULL DEFAULT '',
    content_html TEXT NOT NULL DEFAULT '',            -- 富文本（所见即所得模式）正文
    format      TEXT NOT NULL DEFAULT 'md' CHECK (format IN ('md', 'html')),
    tags        TEXT NOT NULL DEFAULT '[]',
    hidden      INTEGER NOT NULL DEFAULT 0,           -- 旧字段：1 = 对游客隐藏（迁移到 visibility）
    visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'insider', 'private')),
    author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_posts_cat_created ON posts(category, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS anime_cache (
    season_key       TEXT PRIMARY KEY,
    year             INTEGER NOT NULL,
    season           TEXT NOT NULL,
    media            TEXT NOT NULL,
    schedules        TEXT NOT NULL,
    base_media       TEXT NOT NULL DEFAULT '',
    media_fetched_at INTEGER NOT NULL,
    sched_fetched_at INTEGER NOT NULL,
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_anime_cache_season ON anime_cache(year, season);

  CREATE TABLE IF NOT EXISTS visits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL,
    ip         TEXT NOT NULL DEFAULT '',
    path       TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    referer    TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT 'page' CHECK (source IN ('page', 'spa'))
  );

  CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_visits_ip ON visits(ip);
  CREATE INDEX IF NOT EXISTS idx_visits_path ON visits(path);

  CREATE TABLE IF NOT EXISTS ip_locations (
    ip          TEXT PRIMARY KEY,
    country     TEXT NOT NULL DEFAULT '',
    region      TEXT NOT NULL DEFAULT '',
    city        TEXT NOT NULL DEFAULT '',
    isp         TEXT NOT NULL DEFAULT '',
    lat         REAL,
    lon         REAL,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'failed', 'skipped')),
    resolved_at INTEGER
  );
`)

// 兼容旧库：anime_cache 新增 base_media 列（跨季合并用到的原始档期列表，避免重启后重复请求 AniList）
const animeCacheCols = db.prepare('PRAGMA table_info(anime_cache)').all()
if (!animeCacheCols.some((c) => c.name === 'base_media')) {
  db.exec("ALTER TABLE anime_cache ADD COLUMN base_media TEXT NOT NULL DEFAULT ''")
}

// 兼容旧库：posts 表新增 hidden / visibility / content_html / format / pinned 列（CREATE TABLE IF NOT EXISTS 不会补列）
const postCols = db.prepare('PRAGMA table_info(posts)').all()
const hasCol = (n) => postCols.some((c) => c.name === n)
if (!hasCol('hidden')) {
  db.exec('ALTER TABLE posts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0')
}
if (!hasCol('visibility')) {
  db.exec("ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'")
  // 旧数据迁移：之前"对游客隐藏"的文章归入"仅内部人员可见"（游客仍看不到，语义不变）
  db.exec("UPDATE posts SET visibility = 'insider' WHERE hidden = 1")
}
if (!hasCol('content_html')) {
  db.exec("ALTER TABLE posts ADD COLUMN content_html TEXT NOT NULL DEFAULT ''")
}
if (!hasCol('format')) {
  db.exec("ALTER TABLE posts ADD COLUMN format TEXT NOT NULL DEFAULT 'md'")
}
if (!hasCol('pinned')) {
  db.exec('ALTER TABLE posts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0') // 置顶公告（仅 blog 使用，全局唯一）
}

// 兼容旧库：ip_locations 表补充经纬度列（地图热点需要）
const ipCols = db.prepare('PRAGMA table_info(ip_locations)').all()
const hasIpCol = (n) => ipCols.some((c) => c.name === n)
if (!hasIpCol('lat')) {
  db.exec('ALTER TABLE ip_locations ADD COLUMN lat REAL')
}
if (!hasIpCol('lon')) {
  db.exec('ALTER TABLE ip_locations ADD COLUMN lon REAL')
}

// 个人站：启动时确保管理员账号存在，密码以 .env 为准（改动后重启即生效）
// 优化：先取出已有 hash 并与 ADMIN_PASSWORD 比对，只有不一致时才重新计算 bcrypt。
// 旧实现每次启动都无条件 hashSync（约 60ms 同步 CPU），且会让密码没变的账号 hash 变化。
const admin = db
  .prepare('SELECT id, password_hash FROM users WHERE username = ? COLLATE NOCASE')
  .get(ADMIN_USERNAME)
if (admin) {
  let same = false
  try {
    same = bcrypt.compareSync(ADMIN_PASSWORD, admin.password_hash)
  } catch {
    same = false
  }
  if (!same) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(ADMIN_PASSWORD, 10), admin.id)
    console.log('[db] 管理员密码已按 .env 更新')
  }
} else {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    ADMIN_USERNAME,
    bcrypt.hashSync(ADMIN_PASSWORD, 10)
  )
}

// WAL 定期 checkpoint + 过期数据清理：
// - WAL 不回收会让 -wal 文件一直膨胀（重启前观察到 9.1MB）
// - visits 表此前没有任何保留策略，会无限增长
const CHECKPOINT_MS = 5 * 60_000
const VISIT_RETENTION_DAYS = 180
let maintenanceTimer = null

export function startMaintenance() {
  if (maintenanceTimer) return
  let round = 0
  const run = () => {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* checkpoint 失败（有活跃读事务）不影响主流程 */
    }
    // 每 12 轮（约 1 小时）做一次过期清理
    if (++round % 12 === 0) {
      try {
        const cutoff = Math.floor(Date.now() / 1000) - VISIT_RETENTION_DAYS * 86400
        const info = db.prepare('DELETE FROM visits WHERE ts < ?').run(cutoff)
        if (info.changes) console.log(`[db] 清理过期访问记录 ${info.changes} 条`)
      } catch {
        /* 表不存在等：忽略 */
      }
    }
  }
  run()
  maintenanceTimer = setInterval(run, CHECKPOINT_MS)
  maintenanceTimer.unref?.()
}

export function stopMaintenance() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer)
    maintenanceTimer = null
  }
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
  } catch {
    /* 已关闭等情况忽略 */
  }
}

export default db
