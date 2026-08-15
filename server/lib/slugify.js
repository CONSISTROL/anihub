// 由标题生成 URL slug：保留中文字符，非字母数字转连字符
export function slugify(title) {
  return String(title)
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled'
}
