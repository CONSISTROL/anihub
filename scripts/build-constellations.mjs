// 生成 src/data/constellations88.js（88 星座真实连线数据）
//
// 用法：node scripts/build-constellations.mjs
// 只在需要更新星座数据时手动跑一次；产出的 js 会随仓库提交，运行时不需要联网。
//
// 数据来源：d3-celestial 的 constellations.lines.json（真实星座连线，RA/Dec 度）
//   https://github.com/ofrohn/d3-celestial  （BSD-3-Clause）
//
// 处理方式：
//   · 按 id 归并（Ser 在数据里被拆成两个 feature，合并成一个星座）
//   · ra 归一化到 [-180,180)，避免跨 0° 的一团被扯成横跨全天
//   · 每个星座**等比**缩放到 [0,1] 的框内并居中 → 形状保留、大小统一
//     （真实角尺寸差 10 倍以上，不统一的话小星座会看不见）
//   · 记录宽高比 w/h，渲染时按格子尺寸适配
//   · 坐标四舍五入到 3 位小数，控制体积
const URL = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json'

const res = await fetch(URL)
if (!res.ok) throw new Error('HTTP ' + res.status)
const data = await res.json()

const DEG = Math.PI / 180
// 球面 → 平面（等距圆柱投影）：直接保留 0~360 的绝对 RA，先不做环绕
function flatten([ra, dec]) {
  const r = ((ra % 360) + 360) % 360
  return [r, dec]
}

/** id → { lines: [[[x,y],...], ...] } */
const byId = new Map()
for (const f of data.features || []) {
  const id = f.id
  const geom = f.geometry
  if (!id || !geom) continue
  const coords = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates]
  const flat = coords.map((line) => line.map(flatten)).filter((l) => l.length >= 2)
  if (!flat.length) continue
  if (!byId.has(id)) byId.set(id, [])
  byId.get(id).push(...flat)
}

const out = []
let skipped = 0
for (const [id, lines] of [...byId.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  // ——— RA 环绕（unwrapping）———
  // 星座如果跨过 RA 0°（比如大熊座、室女座），直接取差会得到"横跨整个天区"的假跨度
  // （实测把 Cha 压成 w=1 / h=0.01 的一条细线）。正确做法：
  // 丢掉最大的那个空隙，得到真实的聚集弧段。
  const ras = []
  for (const line of lines) for (const [x] of line) ras.push(x)
  ras.sort((a, b) => a - b)
  let gap = 360 - (ras[ras.length - 1] - ras[0])
  let gapAt = ras[0]
  for (let i = 1; i < ras.length; i++) {
    const g = ras[i] - ras[i - 1]
    if (g > gap) { gap = g; gapAt = ras[i] }
  }
  // 把 [gapAt, gapAt+360) 之外的点 +360 搬回来，得到一个连续弧段
  const unwrap = (x) => (x < gapAt ? x + 360 : x)
  const un = lines.map((line) => line.map(([x, y]) => [unwrap(x), y]))

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const line of un) {
    for (const [x, y] of line) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  const w = maxX - minX
  const h = maxY - minY
  // 退化成一个点/一条极短线的不值得画（比如只有两颗几乎重合的星）
  if (!(w > 1e-6) && !(h > 1e-6)) { skipped++; continue }
  // 等比缩放：把长边映射到 1
  const s = 1 / Math.max(w, h)
  const nw = w * s
  const nh = h * s
  // 极扁的星座（南天的 Oct/Aps/Cha 这类，真实比值只有 0.05）等比缩完是一条细线，
  // 放进格子基本看不见。给一个下限 0.3：轻微非等比拉伸把它撑开，
  // 形状仍然认得出，但至少是个"图"而不是一根头发。
  const MIN_ASPECT = 0.3
  const effW = nw >= nh ? nw : Math.max(nw, nh * MIN_ASPECT)
  const effH = nh >= nw ? nh : Math.max(nh, nw * MIN_ASPECT)
  // 居中到 [0,1]
  const ox = (1 - effW) / 2
  const oy = (1 - effH) / 2
  const sx = effW / w
  const sy = effH / h
  const r3 = (v) => Math.round(v * 1000) / 1000
  const L = un
    .map((line) => line.map(([x, y]) => [r3((x - minX) * sx + ox), r3((y - minY) * sy + oy)]))
    // 去掉长度为零的线段
    .filter((line) => line.some((p, i) => i > 0 && (p[0] !== line[0][0] || p[1] !== line[0][1])))
  if (!L.length) { skipped++; continue }
  out.push({ id, w: r3(effW), h: r3(effH), lines: L })
}

console.log(`星座数 ${out.length}，跳过退化 ${skipped}`)
const pts = out.reduce((a, c) => a + c.lines.reduce((b, l) => b + l.length, 0), 0)
console.log(`总点数 ${pts}，总线段 ${out.reduce((a, c) => a + c.lines.length, 0)}`)
console.log('宽高比范围:', Math.min(...out.map((c) => Math.min(c.w, c.h) / Math.max(c.w, c.h))).toFixed(2), '~ 1')

const body = out
  .map((c) => `  {id:'${c.id}',w:${c.w},h:${c.h},lines:${JSON.stringify(c.lines)}},`)
  .join('\n')

const file = `// 88 星座真实连线数据（自动生成，请勿手改）
//
// 来源：d3-celestial data/constellations.lines.json（BSD-3-Clause）
//   https://github.com/ofrohn/d3-celestial
// 生成脚本：scripts/build-constellations.mjs
//
// 每个星座：id / w / h（等比归一化后的宽高，长边 = 1）/ lines（[[x,y],...] 折线，坐标在 [0,1]）
// 坐标是**等比**缩放并居中的：形状与内部比例保留，不同星座的大小统一。
export const CONSTELLATIONS88 = [
${body}
]

export default CONSTELLATIONS88
`

const fs = await import('node:fs')
await fs.promises.mkdir('src/data', { recursive: true })
await fs.promises.writeFile('src/data/constellations88.js', file)
console.log('已写入 src/data/constellations88.js，', Math.round(file.length / 1024), 'KB')
