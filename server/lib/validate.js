// 输入校验：返回错误消息或 null（用户名 3-20 字符；密码 6-72 字节，bcrypt 上限）
export const USERNAME_RE = /^[\p{Letter}\p{Number}_-]{3,20}$/u

export function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username))
    return '用户名需为 3-20 个字母、数字、下划线或连字符'
  return null
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6)
    return '密码至少 6 个字符'
  if (Buffer.byteLength(password, 'utf8') > 72)
    return '密码过长（最多 72 字节）'
  return null
}

export function validateCategory(category) {
  if (!['blog', 'wiki'].includes(category)) return 'category 需为 blog 或 wiki'
  return null
}

export function validatePostInput({ title, summary, content_md, tags }) {
  if (typeof title !== 'string' || !title.trim()) return '标题不能为空'
  if (title.length > 200) return '标题过长（最多 200 字符）'
  if (summary != null && summary.length > 500) return '摘要过长（最多 500 字符）'
  if (content_md != null && content_md.length > 500_000) return '正文过长'
  if (tags != null && (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string')))
    return 'tags 需为字符串数组'
  return null
}
