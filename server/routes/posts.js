// 文章路由：博客与 Wiki 共用的 CRUD（category 区分），支持 md / html 两种正文格式
import { Router } from 'express'
import express from 'express'
import JSZip from 'jszip'
import fs from 'node:fs'
import path from 'node:path'
import db from '../db.js'
import { slugify } from '../lib/slugify.js'
import { validateCategory, validateFormat, validatePostInput } from '../lib/validate.js'
import { authRequired, optionalAuth } from '../middleware/auth.js'

const router = Router()

const UPLOAD_DIR = path.join(import.meta.dirname, '..', 'uploads')

const POST_FIELDS = `
  p.id, p.category, p.title, p.slug, p.summary,
  p.content_md, p.content_html, p.format,
  p.tags, p.visibility, p.pinned, p.author_id, p.created_at, p.updated_at,
  u.username AS author_name
`

// 列表/搜索/公告等摘要场景：不读取正文列，避免把可能很大的 Wiki HTML/Markdown
// 全文随列表一起返回（一条数百 KB 的完整 HTML 文档会让 /wiki 列表、站内搜索和拓扑图都变慢）
const POST_META_FIELDS = `
  p.id, p.category, p.title, p.slug, p.summary,
  p.format, p.tags, p.visibility, p.pinned, p.author_id, p.created_at, p.updated_at,
  u.username AS author_name
`

function parseTags(raw) {
  try { return JSON.parse(raw) } catch { return [] }
}

function toPost(row) {
  const format = row.format || 'md'
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    // 详情/编辑只需当前格式对应的正文列：md 只回 contentMd、html 只回 contentHtml。
    // 数据库里旧数据/切换历史可能在另一列残留副本（如完整 HTML 同时存在于两列），
    // 不再返回可让详情 JSON 体积减半，也避免前端拿到无意义的大字符串。
    contentMd: format === 'html' ? '' : (row.content_md ?? ''),
    contentHtml: format === 'html' ? (row.content_html ?? '') : '',
    format,
    tags: parseTags(row.tags),
    visibility: row.visibility,
    pinned: !!row.pinned,
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
    where.push('(instr(lower(p.title), lower(?)) > 0 OR instr(lower(p.summary), lower(?)) > 0 OR instr(lower(p.content_md), lower(?)) > 0 OR instr(lower(p.content_html), lower(?)) > 0 OR instr(lower(p.tags), lower(?)) > 0)')
    params.push(q, q, q, q, q)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = db.prepare(`SELECT count(*) AS n FROM posts p ${whereSql}`).get(...params).n
  const rows = db
    .prepare(`SELECT ${POST_META_FIELDS} FROM posts p JOIN users u ON u.id = p.author_id ${whereSql} ORDER BY p.pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize)

  const uid = req.user ? Number(req.user.sub) : null
  res.json({
    items: rows.map((r) => ({ ...toPost(r), canEdit: uid === r.author_id })),
    total,
    page,
    pageSize,
  })
})

// 公告：置顶的博客文章（全局唯一），按当前身份过滤可见性；无公告时 404
// 注意：必须定义在 /:id 之前，否则会被当作 id 匹配
router.get('/announcement', optionalAuth, (req, res) => {
  const vis = visibilityClause(req.user)
  const row = db
    .prepare(
      `SELECT ${POST_META_FIELDS} FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.pinned = 1 AND p.category = 'blog' ${vis ? `AND ${vis}` : ''}
       ORDER BY p.updated_at DESC LIMIT 1`
    )
    .get()
  if (!row) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: '暂无公告' } })
  }
  // 公告只需标题/摘要，不返回正文
  res.json(toPost(row))
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
  const {
    category = 'blog',
    title,
    slug,
    summary = '',
    content_md = '',
    content_html = '',
    format = 'md',
    tags = [],
    visibility = 'public',
  } = req.body || {}
  const vis = parseVisibility(visibility)
  const err =
    validateCategory(category) ||
    validateFormat(format) ||
    validatePostInput({ title, summary, content_md, content_html, tags, format }) ||
    (slug != null && typeof slug !== 'string' ? 'slug 需为字符串' : null) ||
    (vis === undefined ? 'visibility 需为 public/insider/private' : null)
  if (err) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err } })
  }
  const finalSlug = uniqueSlug(slug?.trim() ? slugify(slug) : slugify(title))
  const isHtml = format === 'html'
  const r = db
    .prepare(
      'INSERT INTO posts (category, title, slug, summary, content_md, content_html, format, tags, visibility, author_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      category,
      title.trim(),
      finalSlug,
      summary,
      isHtml ? '' : content_md,
      isHtml ? content_html : '',
      format,
      JSON.stringify(tags),
      vis,
      Number(req.user.sub)
    )
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
  const format = body.format ?? row.format
  if (validateFormat(format)) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'format 需为 md 或 html' } })
  }
  const isHtml = format === 'html'
  const next = {
    category: body.category ?? row.category,
    title: body.title ?? row.title,
    summary: body.summary ?? row.summary,
    content_md: isHtml ? row.content_md : (body.content_md ?? row.content_md),
    content_html: isHtml ? (body.content_html ?? row.content_html) : row.content_html,
    format,
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
    "UPDATE posts SET category = ?, title = ?, slug = ?, summary = ?, content_md = ?, content_html = ?, format = ?, tags = ?, visibility = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    next.category,
    next.title.trim(),
    finalSlug,
    next.summary,
    next.content_md,
    next.content_html,
    next.format,
    JSON.stringify(next.tags),
    next.visibility,
    id
  )
  const updated = db
    .prepare(`SELECT ${POST_FIELDS} FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`)
    .get(id)
  res.json(toPost(updated))
})

// 置顶 / 取消置顶（仅作者；仅博客文章，全局唯一置顶 → 该篇即主页公告）
router.post('/:id/pin', authRequired, (req, res) => {
  const id = Number(req.params.id)
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '文章不存在' } })
  if (row.author_id !== Number(req.user.sub)) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: '只能操作自己的文章' } })
  }
  if (row.category !== 'blog') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '只有博客文章可以置顶为公告' } })
  }
  const pinned = !!(req.body && req.body.pinned)
  db.exec('BEGIN')
  try {
    if (pinned) {
      // 全局唯一：置顶这篇时取消其他所有置顶
      db.prepare('UPDATE posts SET pinned = 0 WHERE pinned = 1').run()
    }
    db.prepare('UPDATE posts SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
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

// ================= Wiki 批量导出 / 导入（仅管理员） =================
// 导出：全部 wiki 条目（含内部/私密）打包为 zip：
//   manifest.json（元数据+正文）+ uploads/<文件名>（正文引用的图片）
const UPLOAD_REF_RE = /\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)/g

function collectUploadRefs(...texts) {
  const names = []
  const seen = new Set()
  for (const text of texts) {
    if (typeof text !== 'string') continue
    UPLOAD_REF_RE.lastIndex = 0
    let m
    while ((m = UPLOAD_REF_RE.exec(text))) {
      const name = m[1]
      if (!seen.has(name)) {
        seen.add(name)
        names.push(name)
      }
    }
  }
  return names.filter((name) => name === path.basename(name)) // 只接受纯文件名，防路径穿越
}

router.get('/wiki/export', authRequired, async (req, res) => {
  const rows = db
    .prepare(
      `SELECT ${POST_FIELDS} FROM posts p JOIN users u ON u.id = p.author_id
       WHERE p.category = 'wiki' ORDER BY p.created_at`
    )
    .all()
  const posts = rows.map((r) => {
    const format = r.format === 'html' ? 'html' : 'md'
    return {
      title: r.title,
      slug: r.slug,
      summary: r.summary,
      format,
      content_md: format === 'md' ? r.content_md : '',
      content_html: format === 'html' ? r.content_html : '',
      tags: parseTags(r.tags),
      visibility: r.visibility,
      pinned: !!r.pinned,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }
  })
  const refs = []
  for (const p of posts) refs.push(...collectUploadRefs(p.content_md, p.content_html))
  const uploads = [...new Set(refs)]

  const zip = new JSZip()
  zip.file(
    'manifest.json',
    JSON.stringify({ app: 'anihub', kind: 'wiki-backup', version: 1, exportedAt: new Date().toISOString(), posts, uploads }, null, 2)
  )
  // 每条 wiki 正文单独成文件（wiki/<slug>.md|.html），方便人直接查看/比对；
  // 导入只认 manifest.json + uploads/，这些附加文件不影响导入。
  posts.forEach((p, i) => {
    const safe = String(p.slug || 'entry-' + (i + 1)).replace(/[\\/:*?"<>|]/g, '-')
    const ext = p.format === 'html' ? 'html' : 'md'
    const body = p.format === 'html' ? p.content_html : p.content_md
    // html 条目（独立文档）原样保存，保证仍是完整可打开的 HTML；
    // md 条目加一段人类可读的头部说明。
    const content =
      p.format === 'html'
        ? body
        : `# ${p.title}\n\n` +
          (p.summary ? `> ${p.summary}\n\n` : '') +
          `标签：${(p.tags || []).join('、') || '无'}\n` +
          `可见性：${p.visibility}\n\n` +
          '---\n\n' +
          body
    zip.file(`wiki/${safe}.${ext}`, content)
  })
  zip.file(
    'README.txt',
    `AniHub Wiki 备份（${posts.length} 条）
====================
- manifest.json  机器可读清单（导入时使用；含标题/slug/标签/可见性/时间等）
- wiki/          每条 Wiki 的正文原文，命名 wiki/<slug>.md|.html，方便直接查看
- uploads/       正文里引用的图片

导入方法：管理员在 Wiki 页点「导入 Wiki 备份」，选择本 zip；
同名（同 slug）条目已存在时会自动跳过，不覆盖。
`
  )
  for (const name of uploads) {
    const file = path.join(UPLOAD_DIR, name)
    try {
      if (fs.existsSync(file)) zip.file('uploads/' + name, fs.readFileSync(file))
    } catch (_) {
      /* 读取失败则跳过该图（导入端会报告缺失） */
    }
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="wiki-backup-${stamp}.zip"`)
  res.send(buf)
})

// ================= Wiki 单条下载（内部人员及以上） =================
// 为什么打包成 zip 而不是直接给单个文件：wiki 正文里常引用 /uploads 的图片，
// 只给一个 .md 的话图片全丢；而且 HTML 类条目**本身就是一份自包含文档**
// （前端用 iframe srcdoc 渲染它，见 PostDetail.vue / HtmlDocView.vue），
// 把图片一起放进 zip 后，下载到本地解压即可直接打开、与站内所见一致。
//
// ⚠ 可见性**沿用条目自身规则**（`visibilityClause`）：public / insider 可下，private 不下。
//   内部人员本来就能在页面上读到 insider 条目，能读就能下，不额外设限。
//   注意 `visibilityClause()` 对**管理员**返回 null（表示"全可见"），所以这里要单独兜住
//   private —— 否则管理员会把 private 条目也下载走，而需求明确是"内部人员及以上"。
router.get('/:id/download', optionalAuth, async (req, res) => {
  const row = db
    .prepare(`SELECT ${POST_FIELDS} FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`)
    .get(Number(req.params.id))
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '条目不存在' } })
  if (row.category !== 'wiki') {
    return res.status(400).json({ error: { code: 'NOT_WIKI', message: '仅 Wiki 条目支持下载' } })
  }
  // 仅"内部人员及以上"：游客没有下载入口
  if (!req.user) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '请先获取内部人员或管理员身份' } })
  }
  const vis = visibilityClause(req.user)
  const allowed =
    vis === null
      ? // 管理员：除 private 外都可下（private 只留在站内）
        row.visibility !== 'private'
      : vis === "p.visibility IN ('public', 'insider')"
        ? row.visibility === 'public' || row.visibility === 'insider'
        : row.visibility === 'public'
  if (!allowed) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '条目不存在' } })

  const format = row.format === 'html' ? 'html' : 'md'
  const body = format === 'html' ? row.content_html || '' : row.content_md || ''
  const tags = parseTags(row.tags)
  const safeSlug = String(row.slug || 'wiki-' + row.id).replace(/[\\/:*?"<>|]/g, '-')
  const ext = format === 'html' ? 'html' : 'md'

  const zip = new JSZip()
  // HTML 条目原样保存（它本来就是完整文档）；md 条目补一段人类可读的头部。
  const content =
    format === 'html'
      ? body
      : `# ${row.title}\n\n` +
        (row.summary ? `> ${row.summary}\n\n` : '') +
        `标签：${tags.join('、') || '无'}\n` +
        `可见性：${row.visibility}\n` +
        `更新时间：${row.updated_at || ''}\n\n` +
        '---\n\n' +
        body
  zip.file(`${safeSlug}.${ext}`, content)

  // 正文引用的图片一并打包 —— 但**不重写正文里的链接**。
  // 正文写的是站内绝对路径 `/uploads/x.png`，而 zip 解压后就是同级的 `uploads/x.png`：
  // 直接双击打开 HTML/MD 时相对路径自然命中；这样既不用改用户的原文，
  // 也不依赖站点是否可达（不塞 base64，文件不会膨胀）。
  const refs = [...new Set(collectUploadRefs(body))]
  let images = 0
  for (const name of refs) {
    const file = path.join(UPLOAD_DIR, name)
    try {
      if (fs.existsSync(file)) {
        zip.file('uploads/' + name, fs.readFileSync(file))
        images++
      }
    } catch (_) {
      /* 单张图读失败不影响整体下载 */
    }
  }
  if (images) {
    zip.file(
      'README.txt',
      `${row.title}
${'='.repeat(Math.min(40, Math.max(3, row.title.length)))}
- ${safeSlug}.${ext}   Wiki 正文（${format === 'html' ? 'HTML 文档，可直接双击打开' : 'Markdown'}）
- uploads/          正文里引用的 ${images} 张图片

正文里的图片链接写作 /uploads/xxx —— 与 zip 内的 uploads/ 目录同名，
解压后在本地打开即可正常显示。
`
    )
  }

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  res.setHeader('Content-Type', 'application/zip')
  /* ⚠⚠ **不要下发 `Content-Disposition`** —— 这是踩出来的硬结论：
     Chrome 看到 `Content-Disposition: attachment` 会把响应当成"下载"处理，
     于是**前端 `fetch()` 拿到的是 204 + 空 body**（实测：带该头 status=204/bytes=0，
     不带则 status=200/bytes=10575）。文件确实会被浏览器存下来，但页面里
     `await res.blob()` 拿到 0 字节 —— 我们是用 fetch 取 blob 再自己触发下载的，
     所以下载下来就是一个 0 字节的 zip。
     正确做法：服务端只给干净的字节，**文件名交给前端**（`<a download="...">`）。
     顺带还避开另一个坑：该头只能是 ASCII，而 wiki 的 slug 常是中文，
     直接写会抛 `ERR_INVALID_CHAR` 把请求打成 500（曾经就发生过）。 */
  res.send(buf)
})

// 导入：上传导出的 zip；同 slug 已存在（wiki）→ 跳过，其余按“当前管理员”新建。
// 图片文件名沿用导出时的名字，同名文件已存在则跳过写入（不覆盖）。
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const TIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/

router.post(
  '/wiki/import',
  authRequired,
  express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: '200mb' }),
  async (req, res) => {
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: { code: 'EMPTY', message: '上传内容为空' } })
    }
    const result = { imported: 0, skipped: 0, images: { written: 0, skipped: 0, missing: 0 }, errors: [] }
    let zip
    let manifest
    try {
      zip = await JSZip.loadAsync(req.body)
      const mf = zip.file('manifest.json')
      if (!mf) throw new Error('缺少 manifest.json，不是有效的 Wiki 备份包')
      manifest = JSON.parse(await mf.async('string'))
    } catch (e) {
      return res.status(400).json({ error: { code: 'BAD_ARCHIVE', message: '无法解析备份包：' + e.message } })
    }
    if (!manifest || manifest.kind !== 'wiki-backup' || !Array.isArray(manifest.posts)) {
      return res.status(400).json({ error: { code: 'BAD_ARCHIVE', message: 'manifest 结构不正确，不是有效的 Wiki 备份包' } })
    }

    // 1) 图片：写 uploads/（已存在则跳过，不覆盖现有文件）
    for (const name of manifest.uploads || []) {
      if (typeof name !== 'string' || !SAFE_FILE.test(name)) {
        result.errors.push(`图片名不合法，已忽略：${String(name).slice(0, 60)}`)
        continue
      }
      const dest = path.join(UPLOAD_DIR, name)
      if (path.dirname(dest) !== UPLOAD_DIR) {
        result.errors.push(`图片路径不合法，已忽略：${name}`)
        continue
      }
      try {
        if (fs.existsSync(dest)) {
          result.images.skipped++
          continue
        }
        const entry = zip.file('uploads/' + name)
        if (!entry) {
          result.images.missing++
          continue
        }
        fs.writeFileSync(dest, await entry.async('nodebuffer'))
        result.images.written++
      } catch (e) {
        result.errors.push(`图片写入失败 ${name}：${e.message}`)
      }
    }

    // 2) 条目：同 slug 的 wiki 已存在 → 跳过；否则新建，作者 = 当前管理员
    const me = Number(req.user.sub)
    const insert = db.prepare(
      `INSERT INTO posts (category, title, slug, summary, content_md, content_html, format, tags, visibility, pinned, author_id, created_at, updated_at)
       VALUES ('wiki', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
    db.exec('BEGIN')
    try {
      for (const p of manifest.posts || []) {
        const pushErr = (msg) => result.errors.push(`「${String(p?.title || '').slice(0, 40)}」：${msg}`)
        if (!p || typeof p !== 'object') {
          result.errors.push('存在无效条目，已忽略')
          continue
        }
        const title = typeof p.title === 'string' ? p.title.trim() : ''
        const format = p.format === 'html' ? 'html' : 'md'
        if (!title) {
          pushErr('标题为空，已跳过')
          result.skipped++
          continue
        }
        if (!VISIBILITIES.includes(p.visibility)) {
          pushErr('visibility 无效，已跳过')
          result.skipped++
          continue
        }
        const tags = Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === 'string').slice(0, 50) : []
        const contentMd = format === 'md' && typeof p.content_md === 'string' ? p.content_md : ''
        const contentHtml = format === 'html' && typeof p.content_html === 'string' ? p.content_html : ''
        if (contentMd.length > 5_000_000 || contentHtml.length > 5_000_000) {
          pushErr('正文过大（>5M 字符），已跳过')
          result.skipped++
          continue
        }

        const base = typeof p.slug === 'string' && p.slug.trim() ? slugify(p.slug) : slugify(title)
        const existing = db.prepare('SELECT category FROM posts WHERE slug = ?').get(base)
        if (existing) {
          if (existing.category === 'wiki') {
            result.skipped++ // 决策：同 slug 的 wiki 已存在 → 跳过
            continue
          }
          // 极少见：同 slug 被博客占用 → 自动追加 -2/-3 避免唯一约束冲突
        }
        const slug = uniqueSlug(base)
        const created = TIME_RE.test(String(p.createdAt || '')) ? p.createdAt : undefined
        const updated = TIME_RE.test(String(p.updatedAt || '')) ? p.updatedAt : undefined
        insert.run(
          title,
          slug,
          typeof p.summary === 'string' ? p.summary : '',
          contentMd,
          contentHtml,
          format,
          JSON.stringify(tags),
          p.visibility,
          me,
          created || new Date().toISOString().replace('T', ' ').slice(0, 19),
          updated || new Date().toISOString().replace('T', ' ').slice(0, 19)
        )
        result.imported++
      }
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      result.errors.push('数据库写入失败：' + e.message)
    }
    res.json(result)
  }
)

export default router
