// 输入校验：返回错误消息或 null（个人站无注册，站长账号密码由 .env 管理，无需该校验）
export function validateCategory(category) {
  if (!['blog', 'wiki'].includes(category)) return 'category 需为 blog 或 wiki'
  return null
}

export function validateFormat(format) {
  if (!['md', 'html'].includes(format)) return 'format 需为 md 或 html'
  return null
}

// 按 format 校验正文：md 看 content_md，html 看 content_html
export function validatePostInput({ title, summary, content_md, content_html, tags, format }) {
  if (typeof title !== 'string' || !title.trim()) return '标题不能为空'
  if (title.length > 200) return '标题过长（最多 200 字符）'
  if (summary != null && summary.length > 500) return '摘要过长（最多 500 字符）'
  const isHtml = format === 'html'
  const body = isHtml ? content_html : content_md
  if (body == null || typeof body !== 'string') return isHtml ? '正文不能为空' : '正文不能为空'
  if (body.length > 500_000) return '正文过长'
  if (tags != null && (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')))
    return 'tags 需为字符串数组'
  return null
}
