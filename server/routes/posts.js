// 文章路由：博客与 Wiki 共用的 CRUD（category 区分）
import { Router } from 'express'
import db from '../db.js'
import { slugify } from '../lib/slugify.js'
import { validateCategory, validatePostInput } from '../lib/validate.js'
import { authRequired, optionalAuth } from '../middleware/auth.js'

const router = Router()

const POST_FIELDS = `
  p.id, p.category, p.title, p.slug, p.summary, p.content_md,
  p.tags, p.visibility, p.author_id, p.created_at, p.updated_at,
  u.username AS author_name
`

function parseTags(raw) {
  try { return JSON.parse(raw) } catch { return [] }
}

function toPost(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    contentMd: row.content_md,
    tags: parseTags(row.tags),
    visibility: row.visibility,
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const VISIBILITIES = ['public', 'insider', 'private']
// visibility 归一化：public=公开（游客可见）/ insider=仅内部人员 / private=仅管理员
function parseVisibility(v) {
  if (v === undefined || v === null) return null
  return VISIBILITIES.includes(v) ? v : undefined
}

// 按身份过滤的可见性子句：
// 游客只看公开；内部人员看公开+仅内部；管理员全部
function visibilityClause(user) {
  if (!user) return "p.visibility = 'public'"
  if (user.role === 'insider') return "p.visibility IN ('public', 'insider')"
  return null // 管理员不过滤
}

// slug 唯一化：已存在则追加 -2、-3…
function uniqueSlug(base, excludeId = null) {
  const taken = new Set(
    db.prepare('SELECT slug FROM posts WHERE slug LIKE ?').all(base + '%').map((r) => r.slug)
  )
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const cand = `${base}-${n}`
    if (!taken.has(cand)) return cand
  }
}

// 列表（摘要视图，不含正文），支持 category/page/pageSize/q 搜索
router.get('/', optionalAuth, (req, res) => {
  const { category, q } = req.query
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))

  const where = []
  const params = []
  // 按身份过滤可见性（游客/内部人员/管理员）
  const vis = visibilityClause(req.user)
  if (vis) where.push(vis)
  if (category) {
    where.push('p.category = ?')
    params.push(category)
  }
  if (q) {
    const like = `%${q}%`
    where.push('(instr(lower(p.title), lower(?)) > 0 OR instr(lower(p.summary), lower(?)) > 0 OR instr(lower(p.content_md), lower(?)) > 0 OR instr(lower(p.tags), lower(?)) > 0)')
    params.push(q, q, q, q)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = db.prepare(`SELECT count(*) AS n FROM posts p ${whereSql}`).get(...params).n
  const rows = db
    .prepare(`SELECT ${POST_FIELDS} FROM posts p JOIN users u ON u.id = p.author_id ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)

  const uid = req.user ? Number(req.user.sub) : null
  res.json({
    items: rows.map((r) => {
      const { content_md, ...rest } = r
      return { ...toPost({ ...r, content_md: '' }), canEdit: uid === r.author_id }
    }),
    total,
    page,
    pageSize,
  })
})

// 详情：按 id 或 slug 查（带 canEdit 供前端显示编辑按钮）
// 无权限访问的文章与不存在同等对待（404，不暴露存在性）
function detail(row, req, res) {
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '文章不存在' } })
  const vis = visibilityClause(req.user)
  if (vis) {
    // 用同一可见性规则判断：游客只看 public，内部人员多看 insider，管理员全看
    const allowed =
      vis === "p.visibility = 'public'"
        ? row.visibility === 'public'
        : vis === "p.visibility IN ('public', 'insider')"
          ? row.visibility === 'public' || row.visibility === 'insider'
          : true
    if (!allowed) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '文章不存在' } })
  }
  const uid = req.user && req.user.role === 'admin' ? Number(req.user.sub) : null
  res.json({ ...toPost(row), canEdit: uid === row.author_id })
}

router.get('/slug/:slug', optionalAuth, (req, res) => {
  const row = db
    .prepare(`SELECT ${POST_FIELDS} FROM posts p JOIN users u ON u.id = p.author_id WHERE p.slug = ?`)
    .get(req.params.slug)
  detail(row, req, res)
})

router.get('/:id', optionalAuth, (req, res) => {
  const row = db
    .prepare(`SELECT ${POST_FIELDS} FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`)
    .get(Number(req.params.id))
  detail(row, req, res)
})

// 新建（需登录）
router.post('/', authRequired, (req, res) => {
  const { category = 'blog', title, slug, summary = '', content_md = '', tags = [], visibility = 'public' } = req.body || {}
  const vis = parseVisibility(visibility)
  const err =
    validateCategory(category) ||
    validatePostInput({ title, summary, content_md, tags }) ||
    (slug != null && typeof slug !== 'string' ? 'slug 需为字符串' : null) ||
    (vis === undefined ? 'visibility 需为 public/insider/private' : null)
  if (err) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err } })
  }
  const finalSlug = uniqueSlug(slug?.trim() ? slugify(slug) : slugify(title))
  const r = db
    .prepare('INSERT INTO posts (category, title, slug, summary, content_md, tags, visibility, author_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(category, title.trim(), finalSlug, summary, content_md, JSON.stringify(tags), vis, Number(req.user.sub))
  const row = db
    .prepare(`SELECT ${POST_FIELDS} FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`)
    .get(Number(r.lastInsertRowid))
  res.status(201).json(toPost(row))
})

// 更新（仅作者）
router.put('/:id', authRequired, (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '文章不存在' } })
  if (row.author_id !== Number(req.user.sub)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: '只能编辑自己的文章' } })
  }
  const body = req.body || {}
  const vis = parseVisibility(body.visibility)
  if (vis === undefined) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'visibility 需为 public/insider/private' } })
  }
  const next = {
    category: body.category ?? row.category,
    title: body.title ?? row.title,
    summary: body.summary ?? row.summary,
    content_md: body.content_md ?? row.content_md,
    tags: body.tags ?? parseTags(row.tags),
    slug: body.slug ?? row.slug,
    visibility: vis ?? row.visibility,
  }
  const err =
    validateCategory(next.category) ||
    validatePostInput(next) ||
    (typeof next.slug !== 'string' ? 'slug 需为字符串' : null)
  if (err) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err } })
  }
  // slug 变化时保证唯一（排除自身）
  const finalSlug = next.slug === row.slug ? row.slug : uniqueSlug(slugify(next.slug), id)
  db.prepare(
    'UPDATE posts SET category = ?, title = ?, slug = ?, summary = ?, content_md = ?, tags = ?, visibility = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(next.category, next.title.trim(), finalSlug, next.summary, next.content_md, JSON.stringify(next.tags), next.visibility, id)
  const updated = db
    .prepare(`SELECT ${POST_FIELDS} FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`)
    .get(id)
  res.json(toPost(updated))
})

// 删除（仅作者）
router.delete('/:id', authRequired, (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT author_id FROM posts WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '文章不存在' } })
  if (row.author_id !== Number(req.user.sub)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: '只能删除自己的文章' } })
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(id)
  res.status(204).end()
})

export default router
