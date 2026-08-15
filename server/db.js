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
    tags        TEXT NOT NULL DEFAULT '[]',
    hidden      INTEGER NOT NULL DEFAULT 0,           -- 1 = 对游客隐藏
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
`)

// 兼容旧库：posts 表新增 hidden 列（CREATE TABLE IF NOT EXISTS 不会补列）
const postCols = db.prepare('PRAGMA table_info(posts)').all()
if (!postCols.some((c) => c.name === 'hidden')) {
  db.exec('ALTER TABLE posts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0')
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
