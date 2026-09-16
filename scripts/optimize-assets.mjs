#!/usr/bin/env node
// 静态插图资源优化：把 public/ 下体积过大的 PNG 转成 WebP，并生成合适的站点图标。
//
// 为什么需要：这些图在仓库里以 PNG 形式存在，单张 250KB~490KB，
// 而它们只是错误码插画（原生尺寸 433×401），转 WebP 后同画质只剩约 1/5 体积。
// 壁纸目录（public/wallpapers）**不在本脚本处理范围内**，那是用户自己的原图。
// 主页功能卡片插图已改为纯 SVG（src/components/HomeNodeArt.vue），不再有位图需要处理。
//
// 用法：node scripts/optimize-assets.mjs
// 依赖：ImageMagick 7（magick 命令）。Windows 常见安装路径会自动探测；
//       也可用 MAGICK_PATH 环境变量显式指定。
//
// 产物是提交进仓库的，因此服务器上不需要装 ImageMagick。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PUBLIC = path.join(ROOT, 'public')

/* ---------- 定位 ImageMagick ---------- */

function findMagick() {
  const candidates = [
    process.env.MAGICK_PATH,
    'magick',
    'C:/Program Files/ImageMagick/magick.exe',
    'D:/software/ImageMagick-7.1.1-Q16-HDRI/magick.exe',
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      execFileSync(c, ['-version'], { stdio: 'ignore' })
      return c
    } catch {
      /* 试下一个 */
    }
  }
  console.error('✗ 找不到 ImageMagick（magick）。请安装后重试，或用 MAGICK_PATH 指定可执行文件路径。')
  process.exit(1)
}

const MAGICK = findMagick()

function run(args) {
  execFileSync(MAGICK, args, { stdio: ['ignore', 'ignore', 'pipe'] })
}

function sizeOf(p) {
  return fs.existsSync(p) ? fs.statSync(p).size : 0
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB'

let savedTotal = 0

/** 把 PNG 转成同目录同名的 WebP（并删除原 PNG，避免仓库里留两份大图） */
function toWebp(relPath, { quality = 88 } = {}) {
  const src = path.join(PUBLIC, relPath)
  if (!fs.existsSync(src)) {
    console.log(`  · 跳过（不存在）: ${relPath}`)
    return
  }
  const out = src.replace(/\.png$/i, '.webp')
  const before = sizeOf(src)
  run([src, '-strip', '-quality', String(quality), '-define', 'webp:method=6', out])
  const after = sizeOf(out)
  if (!after) {
    console.error(`  ✗ 转换失败: ${relPath}`)
    process.exitCode = 1
    return
  }
  fs.rmSync(src)
  savedTotal += before - after
  console.log(
    `  ✓ ${relPath} → ${path.basename(out)}  ${kb(before)} → ${kb(after)}  (-${(100 - (after / before) * 100).toFixed(0)}%)`
  )
}

/** 用源图生成指定尺寸的 PNG 图标 */
function makePngIcon(srcRel, outRel, size) {
  const src = path.join(PUBLIC, srcRel)
  if (!fs.existsSync(src)) {
    console.log(`  · 跳过（源图不存在）: ${srcRel}`)
    return
  }
  const out = path.join(PUBLIC, outRel)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  run([src, '-resize', `${size}x${size}`, '-strip', '-define', 'png:compression-level=9', out])
  console.log(`  ✓ ${outRel}  ${size}×${size}  ${kb(sizeOf(out))}`)
}

/* ---------- 执行 ---------- */

console.log('ImageMagick:', MAGICK)
console.log('\n[1/3] 站点图标（浏览器标签页 / 主屏图标）')

// favicon：原 anihub.png 是 864×886 / 929KB，仅作标签页图标（正常显示 16–32px）
// apple-touch-icon：180×180，iOS 添加到主屏用
makePngIcon('anihub.png', 'favicon-32.png', 32)
makePngIcon('anihub.png', 'apple-touch-icon.png', 180)

console.log('\n[2/3] 错误码插画')
for (const code of [400, 401, 403, 404, 500, 502, 503, 504]) {
  toWebp(`http_status_code/${code}.png`)
}

console.log('\n[3/3] 站点分享/装饰图标')
// anihub.png（929KB）在改用 favicon-32.png 后不再被页面引用，但保留原图供再生成
// deepseek_maid_icon.png 是桌宠召唤按钮的圆形底图（1254×1254），缩到 256 足够显示
const maid = path.join(PUBLIC, 'deepseek_maid_icon.png')
if (fs.existsSync(maid)) {
  const before = sizeOf(maid)
  const tmp = maid.replace(/\.png$/, '.tmp.png')
  run([maid, '-resize', '256x256', '-strip', '-define', 'png:compression-level=9', tmp])
  fs.rmSync(maid)
  fs.renameSync(tmp, maid)
  const after = sizeOf(maid)
  savedTotal += before - after
  console.log(`  ✓ deepseek_maid_icon.png  256×256  ${kb(before)} → ${kb(after)}`)
}

console.log(`\n完成。共减少约 ${(savedTotal / 1024 / 1024).toFixed(2)} MB。`)
console.log('提示：错误码插画现在都是 .webp，引用路径已同步更新；')
console.log('      若新增同类插图，请用本脚本转换后一并提交。')
