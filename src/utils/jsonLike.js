// 类 JSON（C 结构体转储 / 配置类文本）解析器：把 key = value、嵌套 {} 转成 JSON 结构
// 规则：
// - key = value           → "key": "value"（标量一律保留为字符串，避免 0x 等进制/精度丢失；支持 "..." 与 '...' 引号字符串）
// - key = { ... }         → "key": { ... }；块内全是裸值（如 0x0, 0x1）时为数组
// - 匿名 { ... }          → 合并到最近的具名祖先（对应 C 匿名 union/struct 的成员提升）
// - 顶层支持 name = { ... }、{ ... } 以及直接成员序列 a = 1, b = 2
// - key 与值之间支持 = 或 :；支持 //、/* */、# 注释与行尾/末尾逗号
export function parseJsonLike(text) {
  const src = String(text)
  let i = 0
  const len = src.length

  function lineOf(pos) {
    let line = 1
    for (let k = 0; k < pos && k < len; k++) if (src[k] === '\n') line++
    return line
  }

  function fail(msg, pos = i) {
    throw new Error(`${msg}（第 ${lineOf(pos)} 行）`)
  }

  function skipWs() {
    while (i < len) {
      const c = src[i]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        i++
        continue
      }
      if (c === '/' && src[i + 1] === '/') {
        while (i < len && src[i] !== '\n') i++
        continue
      }
      if (c === '/' && src[i + 1] === '*') {
        const start = i
        i += 2
        while (i < len && !(src[i] === '*' && src[i + 1] === '/')) i++
        if (i >= len) fail('注释未闭合', start)
        i += 2
        continue
      }
      if (c === '#') {
        while (i < len && src[i] !== '\n') i++
        continue
      }
      break
    }
  }

  const isIdentStart = (c) => c !== undefined && /[A-Za-z_$]/.test(c)
  const isIdentPart = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c)

  function readIdent() {
    const start = i
    if (!isIdentStart(src[i])) fail('期望字段名', start)
    while (i < len && isIdentPart(src[i])) i++
    return src.slice(start, i)
  }

  // 值：引号字符串，或读到空白/逗号/括号为止的裸词（0x…、数字、NULL、true 等）
  function readScalar() {
    const start = i
    const c = src[i]
    if (c === '"' || c === "'") {
      const q = c
      i++
      let out = ''
      while (i < len && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < len) {
          out += src[i + 1]
          i += 2
          continue
        }
        out += src[i]
        i++
      }
      if (i >= len) fail('字符串未闭合', start)
      i++ // 闭合引号
      return out
    }
    let j = i
    while (j < len && !/[\s,{}]/.test(src[j])) j++
    const word = src.slice(i, j)
    if (!word) fail('期望值', start)
    i = j
    return word
  }

  // 解析一段成员序列，直到 endChar（'}' 或 null=文件末尾）
  // 返回 items: { type: 'named'|'anon'|'bare', key?, value?, pos }
  function parseItems(endChar) {
    const items = []
    for (;;) {
      skipWs()
      if (i >= len) {
        if (endChar === '}') fail("缺少 '}'")
        break
      }
      const c = src[i]
      if (endChar && c === endChar) {
        i++
        break
      }
      if (c === ',') {
        i++
        continue // 容忍行尾/末尾逗号
      }
      const pos = i
      if (c === '{') {
        items.push({ type: 'anon', node: parseBlock(), pos })
        continue
      }
      // 尝试 key = value：字段名 + （可选空白） + '=' / ':'
      if (isIdentStart(c)) {
        const save = i
        const key = readIdent()
        skipWs()
        if (src[i] === '=' || src[i] === ':') {
          i++
          skipWs()
          let value
          if (src[i] === '{') value = parseBlock().value
          else value = readScalar()
          items.push({ type: 'named', key, value, pos })
          continue
        }
        i = save // 不是键值对：回退，按裸值处理
      }
      const v = readScalar()
      items.push({ type: 'bare', value: v, pos })
    }
    return items
  }

  // 由 items 构建对象或数组
  function build(items) {
    const hasNamed = items.some((it) => it.type === 'named')
    if (hasNamed) {
      const obj = {}
      for (const it of items) {
        if (it.type === 'named') {
          obj[it.key] = it.value // value 为字符串或已展开的对象/数组
        } else if (it.type === 'anon') {
          const node = it.node
          if (node.kind === 'object') {
            Object.assign(obj, node.value) // 匿名对象块：成员提升到本层
          } else {
            fail('匿名块与具名字段混排时，匿名块中不能是纯数组', it.pos)
          }
        } else {
          fail('对象中出现了无字段名的裸值', it.pos)
        }
      }
      return { kind: 'object', value: obj }
    }
    // 无具名字段：数组（裸值为元素，匿名块为嵌套元素）
    return { kind: 'array', value: items.map((it) => (it.type === 'anon' ? it.node.value : it.value)) }
  }

  // 解析一个 { ... } 块，返回 { kind: 'object'|'array', value }
  function parseBlock() {
    i++ // 吃掉 '{'
    return build(parseItems('}'))
  }

  skipWs()
  if (i >= len) fail('内容为空')

  let root
  if (src[i] === '{') {
    root = parseBlock().value // 顶层匿名块：直接采用其内容
  } else {
    // 顶层成员序列：name = { ... } 具名结构体、a = 1, b = 2 平铺成员均可
    root = build(parseItems(null)).value
  }

  skipWs()
  if (i < len) fail('存在无法解析的剩余内容')
  return root
}
