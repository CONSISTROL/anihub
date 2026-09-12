// 在线阅读书库
//
// 书本来源：public/books/ 下的目录 + 一份清单文件 public/books/books.json
//   public/books/books.json          书本元数据（标题、作者、简介、入口文件、来源等）
//   public/books/<id>/<entry>        书的正文（单文件 HTML 电子书，自包含）
//
// 访问控制是**服务端强制**的（不能只靠前端路由守卫）：
//   - books 目录由本模块自己的静态中间件托管，先校验身份再放行
//   - 游客一律 401；内部人员只能读「对内部人员上架」的书；管理员可读全部
//   - /api/reading 同样按身份过滤，未上架的书对内部人员连元数据都看不到
import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from './config.js'
import db from './db.js'

export const BOOKS_DIR = path.join(import.meta.dirname, '..', 'public', 'books')
const MANIFEST = path.join(BOOKS_DIR, 'books.json')
const ACCESS_KEY = 'reading_access' // settings 表：JSON { enabled, guest: [id], insider: [id] }

/** 读取书库清单（每次实时读，新增目录后无需重启） */
export function listBooks() {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  } catch {
    return []
  }
  const books = Array.isArray(manifest?.books) ? manifest.books : []
  return books
    .filter((b) => b && typeof b.id === 'string' && typeof b.entry === 'string')
    .map((b) => {
      const dir = path.join(BOOKS_DIR, b.id)
      const entry = path.join(dir, b.entry)
      // 只保留真实存在的书，避免清单写了但文件没同步
      const exists = fs.existsSync(entry) && isInside(dir, entry)
      return {
        id: b.id,
        title: String(b.title || b.id),
        author: String(b.author || ''),
        summary: String(b.summary || ''),
        tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
        entry: b.entry,
        home: typeof b.home === 'string' ? b.home : '',
        license: typeof b.license === 'string' ? b.license : '',
        upstream: b.upstream && typeof b.upstream === 'object' ? b.upstream : null,
        cover: typeof b.cover === 'string' ? b.cover : '',
        size: exists ? fs.statSync(entry).size : 0,
        available: exists,
      }
    })
    .filter((b) => b.available)
}

/** 防目录穿越：target 必须落在 dir 内 */
function isInside(dir, target) {
  const rel = path.relative(dir, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/* ---------- 上架配置（settings 表，与壁纸选择同一套做法） ---------- */

const EMPTY = { enabled: true, guest: [], insider: [] }

function readAccess() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(ACCESS_KEY)
  if (!row) return { ...EMPTY }
  try {
    const v = JSON.parse(row.value)
    return {
      enabled: v?.enabled !== false,
      guest: Array.isArray(v?.guest) ? v.guest.filter((x) => typeof x === 'string') : [],
      insider: Array.isArray(v?.insider) ? v.insider.filter((x) => typeof x === 'string') : [],
    }
  } catch {
    return { ...EMPTY }
  }
}

function writeAccess(v) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(ACCESS_KEY, JSON.stringify(v))
}

/** 按身份取可读的书：管理员全部；内部人员 = 对内部人员上架；游客 = 对游客上架 */
export function visibleBooks(role) {
  const all = listBooks()
  const access = readAccess()
  if (role === 'admin') return { books: all, access }
  if (access.enabled === false) return { books: [], access }
  const allowed = new Set(role === 'insider' ? [...access.guest, ...access.insider] : access.guest)
  return { books: all.filter((b) => allowed.has(b.id)), access }
}

export function isBookVisible(role, id) {
  return visibleBooks(role).books.some((b) => b.id === id)
}

export { readAccess, writeAccess, ACCESS_KEY }

/* ---------- 身份识别（静态目录也要鉴权，因此需要独立解析） ---------- */

/** 从 Cookie 解析 token：书正文在 iframe 里加载，带不上 localStorage 的 token，
 *  因此由 /api/reading/session 换取一个只发给 /books 的 HttpOnly Cookie。 */
function readCookie(req, name) {
  const raw = req.headers.cookie
  if (!raw) return ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return ''
}

export const BOOK_COOKIE = 'anihub_books'

/** 当前身份：admin / insider / guest */
export function roleOf(req) {
  const bearer = String(req.headers.authorization || '')
  const candidates = [
    readCookie(req, BOOK_COOKIE),
    bearer.startsWith('Bearer ') ? bearer.slice(7) : '',
    readCookie(req, 'anihub.token'),
    readCookie(req, 'anihub.insider'),
  ].filter(Boolean)
  for (const t of candidates) {
    try {
      const p = jwt.verify(t, JWT_SECRET)
      if (p?.role === 'admin') return 'admin'
      if (p?.role === 'insider') return 'insider'
    } catch {
      /* 试下一个 */
    }
  }
  return 'guest'
}

/** 取路径的第一段（书 id） */
function firstSegment(p) {
  return decodeURIComponent(String(p || '')).replace(/^\/+/, '').split('/')[0]
}

/**
 * books 目录的鉴权静态中间件：必须挂在 express.static 之前。
 * 未登录 / 未上架一律 404（不暴露"这里有一本书"），只有真正的错误才回 401。
 * 挂在 app.use('/books', ...) 上时，req.path 已经是去掉 /books 前缀的相对路径。
 */
export function booksGuard(req, res, next) {
  const role = roleOf(req)
  if (role === 'guest') {
    return res.status(401).type('html').send(
      '<!doctype html><meta charset="utf-8"><title>401</title>' +
        '<body style="font-family:system-ui;padding:48px;text-align:center">' +
        '<h1 style="font-size:20px">需要更高权限才能阅读</h1>' +
        '<p style="color:#888">请先获取阅读权限后再打开本书。</p></body>'
    )
  }
  const id = firstSegment(req.path)
  if (!id || id === 'books.json') return res.status(404).end()
  if (!isBookVisible(role, id)) return res.status(404).end()
  next()
}

/**
 * 主题注入路由（/books/:id/:theme/*splat）的鉴权。
 * 这条路由直接挂在 app 上（不在 /books 挂载点内），用显式参数取名书 id。
 */
export function booksInjectGuard(req, res, next) {
  const role = roleOf(req)
  if (role === 'guest') {
    return res.status(401).type('html').send(
      '<!doctype html><meta charset="utf-8"><title>401</title>' +
        '<body style="font-family:system-ui;padding:48px;text-align:center">' +
        '<h1 style="font-size:20px">需要更高权限才能阅读</h1>' +
        '<p style="color:#888">请先获取阅读权限后再打开本书。</p></body>'
    )
  }
  const id = String(req.params.id || '')
  if (!id) return res.status(404).end()
  if (!isBookVisible(role, id)) return res.status(404).end()
  next()
}

/* ---------------------------------------------------------------------------
   主题注入：把一个"裸"的静态书正文变成带主题桥的响应
   ---------------------------------------------------------------------------
   书正文必须通过**真实 URL** 加载，不能用 iframe srcdoc ——
   about:srcdoc 文档没有基址，书里 `href="#章节id"` 这种片段链接会被解析到
   外层文档的 URL 上，点目录会把 iframe 整个导航成网站首页（内容全丢）。
   真实 URL 下片段导航正常工作，相对资源也能按目录解析。

   但真实 URL 又拿不到"解析期就定好主题"的能力（跨文档只能在加载后设置，会闪一下），
   所以这里由服务端在 <head> 起头处注入主题桥脚本：
     · 解析期就应用主题（不闪）
     · 暴露 window.__anihubSetTheme 供父页面调用
     · 内置书自己的主题状态会在加载过程中覆盖它，因此脚本会在
       DOMContentLoaded / load 两个阶段再对齐一次
   theme 只接受 light / dark，避免把任意字符串拼进响应。
   --------------------------------------------------------------------------- */

/** 防目录穿越并拿到绝对路径 */
export function resolveBookFile(slug) {
  // Express 5（path-to-regexp v8）的通配参数是**数组**：/a/*splat → ["x","y"]。
  // 直接 path.join 会把数组当字符串拼接（"x,y"），必须显式 join。
  const raw = Array.isArray(slug) ? slug.join('/') : String(slug || '')
  if (!raw) return null
  const rel = path.normalize(decodeURIComponent(raw)).replace(/^(\.\.[/\\])+/, '')
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  const abs = path.join(BOOKS_DIR, rel)
  if (!isInside(BOOKS_DIR, abs)) return null
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null
  return { abs, id: rel.split(/[/\\]/)[0], rel }
}

function themeBridge(theme) {
  const t = theme === 'dark' ? 'dark' : 'light'
  const lit = JSON.stringify(t)
  // 注意：这里的标签拼接避免在源码中出现 script 字面量组合（对自己也是一种保护）
  return (
    '<' + 'script>(function(){' +
    'function apply(t){if(t!=="light"&&t!=="dark")return;' +
    'document.documentElement.setAttribute("data-theme",t);' +
    'document.documentElement.style.colorScheme=t;}' +
    'window.__anihubSetTheme=apply;apply(' + lit + ');' +
    'document.addEventListener("DOMContentLoaded",function(){apply(' + lit + ')});' +
    'window.addEventListener("load",function(){apply(' + lit + ')});' +
    'window.addEventListener("message",function(e){' +
    'var d=e.data;if(d&&d.type==="anihub:theme")apply(d.theme);});' +
    '})();' + '<' + '/script>'
  )
}

/**
 * 返回注入了主题桥的书正文。
 * 只处理 HTML；其它资源（配图等）由静态中间件直接服务。
 * theme 只接受 light / dark：非法取值直接 404，避免把任意字符串拼进响应。
 */
export function sendBookHtml(req, res, next) {
  const theme = String(req.params.theme || '')
  if (theme !== 'light' && theme !== 'dark') return res.status(404).end()
  // 路由是 /books/:id/:theme/*splat。
  // 注意：Express 5（path-to-regexp v8）把**命名通配**expose 成同名的
  // req.params.splat（值为数组），而不是 req.params[0] —— 后者是 v4 的写法，
  // 在 v5 里恒为 undefined。
  // 另外通配部分不含书 id（已被 :id 吃掉），所以要拼回"相对 books 目录"的路径。
  const rest = req.params.splat
  const tail = Array.isArray(rest) ? rest.join('/') : String(rest || '')
  const target = resolveBookFile([req.params.id, tail].filter(Boolean).join('/'))
  if (!target) return res.status(404).end()
  if (!/\.html?$/i.test(target.abs)) return next()

  let src
  try {
    src = fs.readFileSync(target.abs, 'utf8')
  } catch {
    return next()
  }

  const injected = themeBridge(theme)
  const head = src.match(/<head[^>]*>/i)
  const out = head
    ? src.slice(0, head.index + head[0].length) + injected + src.slice(head.index + head[0].length)
    : injected + src

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(out))
  res.send(out)
}

/** 书库清单文件（books.json）不是书，禁止直接访问 */
export function blockManifest(req, res, next) {
  if (/books\.json$/i.test(req.path)) return res.status(404).end()
  next()
}
