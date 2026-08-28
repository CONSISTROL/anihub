// SQLite 连接与建表（node:sqlite，Node ≥ 23.4 内置，无需外部依赖）
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { ADMIN_USERNAME, ADMIN_PASSWORD } from './config.js'

const db = new DatabaseSync(path.join(import.meta.dirname, 'anihub.db'))

db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

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
    media_fetched_at INTEGER NOT NULL,
    sched_fetched_at INTEGER NOT NULL,
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_anime_cache_season ON anime_cache(year, season);
`)

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

// 个人站：启动时确保站长账号存在，密码以 .env 为准（改动后重启即生效）
const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10)
const admin = db
  .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
  .get(ADMIN_USERNAME)
if (admin) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(adminHash, admin.id)
} else {
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(ADMIN_USERNAME, adminHash)
}

export default db
