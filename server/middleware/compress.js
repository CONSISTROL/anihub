// 响应压缩中间件（zlib 内置，无第三方依赖）
//
// 为什么需要它：生产环境 Nginx 虽然开了 gzip，但其 gzip_types 不含 text/javascript，
// 而 Express 5（mime-types 3）对 .js 输出的正是 text/javascript —— 前端 chunk 实际未被压缩。
// 在应用层兜底后，dev（Vite 代理）与生产（Nginx 反代）两条链路都能拿到压缩结果。
//
// 做法：拦截 res.write / res.end，把响应体交给 zlib 流压缩，再把压缩结果写回原始方法。
// 覆盖范围：文本类响应（JS/CSS/JSON/HTML/SVG/XML）。图片/视频/字体/压缩包直接放行。
//
// 两个关键细节：
// 1. 压缩决策必须发生在写出第一段之前（它决定 Content-Encoding 与 Content-Length）：
//      - 声明了 Content-Length 且落在 [MIN, MAX] → 立即决定
//      - 未声明长度 → 先缓存；超过阈值说明是大响应，整批原样放行；否则在 end 时压缩
// 2. 背压：静态文件是 fs.createReadStream().pipe(res) 送进来的，
//    如果直接把 zlib 输出丢给原始 write 而不把 socket 的背压回传，大文件会永久挂住
//    （对端一直等，read stream 一直不被 drain）。这里用 res.bufferedAmount 判断水位，
//    超过阈值就让 gzip 流暂停，降下来再恢复，从而把背压一路传回文件流。
import zlib from 'node:zlib'

const MIN_BYTES = 1024 // 小于 1KB 压缩收益为负
const MAX_BYTES = 8 * 1024 * 1024 // 超过 8MB 放行（游戏资源等，避免占用内存与 CPU）
const BACKPRESSURE_BYTES = 1024 * 1024 // gzip 输出积压超过 1MB 就暂停压缩流

const COMPRESSIBLE = [
  'text/',
  'application/json',
  'application/javascript',
  'application/x-javascript',
  'application/xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/manifest+json',
  'application/x-www-form-urlencoded',
  'image/svg+xml',
  'application/wasm',
]

function isCompressible(type) {
  if (!type) return true // 未定类型（多为 JSON 接口）：允许压缩
  const t = String(type).toLowerCase()
  return COMPRESSIBLE.some((p) => t.startsWith(p))
}

/** 协商可用编码：'br' | 'gzip' | null（正确处理 q=0 拒绝） */
function pickEncoding(header) {
  if (!header) return null
  const raw = String(header).toLowerCase()
  const parse = (name) => {
    const m = raw.match(new RegExp(`(?:^|,)\\s*${name}\\s*(?:;\\s*q=([0-9.]+))?`))
    if (!m) return -1
    if (m[1] === undefined) return 1
    const q = Number(m[1])
    return Number.isFinite(q) ? q : 1
  }
  if (parse('br') > 0) return 'br'
  if (parse('gzip') > 0) return 'gzip'
  return null
}

function toBuffer(chunk, enc) {
  if (chunk === undefined || chunk === null) return null
  if (typeof chunk === 'string') return Buffer.from(chunk, enc && enc !== 'buffer' ? enc : 'utf8')
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
}

/**
 * 弱 ETag 比较（RFC 7232）：忽略 W/ 前缀与引号差异。
 * 参数可以是单个或多个 tag（多个用逗号分隔），任一个匹配即算新鲜。
 */
function etagMatches(header, current) {
  if (!header || !current) return false
  const norm = (s) => String(s).trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  const cur = norm(current)
  if (String(header).trim() === '*') return true
  return String(header)
    .split(',')
    .map((s) => norm(s))
    .some((s) => s === cur)
}

export function compression({ threshold = MAX_BYTES } = {}) {
  return function compressionMiddleware(req, res, next) {
    res.vary('Accept-Encoding')
    const encoding = pickEncoding(req.headers['accept-encoding'])
    if (!encoding) return next()

    const rawWrite = res.write.bind(res)
    const rawEnd = res.end.bind(res)

    // 再入保护：如果上层中间件包裹过 res.write，或压缩中间件被重复挂载，
    // rawWrite 可能指回我们自己，直接调用会无限递归（表现为请求永久挂起）。
    // 用标记位把这种情况变成明确的 500 报错，而不是静默卡死。
    if (res.write.__anihubCompress || res.end.__anihubCompress) {
      return next(new Error('compression middleware mounted twice on the same response'))
    }

    // pending：尚未决定；streaming：正在压缩；raw：放行（不压缩）；notModified：已回 304
    let mode = 'pending'
    let gz = null
    let pending = []
    let pendingBytes = 0

    function headersAllow() {
      if (req.method === 'HEAD') return false
      if (res.getHeader('Content-Encoding')) return false // 已编码（预压缩文件 / 上游代理）
      /**
       * ⚠⚠ 响应头**已经发出**时必须放弃压缩。
       *
       * 压缩要做两件必然改头的事：`res.removeHeader('Content-Length')`（改成 chunked）
       * 与 `res.setHeader('Content-Encoding', ...)`。一旦路由自己调用过 `res.writeHead(...)`，
       * 头就已经提交到 socket 了，这两个调用都会抛 `ERR_HTTP_HEADERS_SENT`
       * —— 而且抛在 `res.end()` 的调用栈里，会变成 uncaughtException：
       * 响应要么 500、要么直接挂住（连接不断开，浏览器一直转圈）。
       *
       * 实测触发点：本地 Web 代理（`routes/localWeb.js`）在改写 HTML/JS 后
       * 用 `res.writeHead(200, headers)` + `res.end(body)` 发送，于是
       * **每次打开 /local-web/... 页面的子资源（css/js）都会崩一次**，
       * 表现为「本地 Web 只能打开首页、样式脚本全加载不出来」。
       *
       * `res.headersSent` 在 writeHead 之后立刻为 true，用它判断最可靠。
       * 此时按 `raw` 模式原样透传即可 —— `Content-Length` 是路由自己算好写进去的，
       * 与正文一致，不需要也不应该再压缩。
       */
      if (res.headersSent) return false
      const status = res.statusCode
      if (status === 204 || status === 304 || status === 206) return false
      if (!isCompressible(res.getHeader('Content-Type'))) return false
      return true
    }

    /**
     * 压缩流输出。不做手工 pause/resume：
     * 写入方依赖 res.write() 的返回值做背压，而 res.write() 已把真实背压透传给 gzip 流；
     * 手工 gz.pause() 会让源端 pipe 无法感知，容易出现「暂停后再也收不到 drain」的挂死。
     */
    function onGzData(chunk) {
      rawWrite(chunk)
    }

    function startStream() {
      gz = encoding === 'br'
        ? zlib.createBrotliCompress({
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: 5,
              [zlib.constants.BROTLI_PARAM_SIZE_HINT]: Number(res.getHeader('Content-Length')) || 0,
            },
          })
        : zlib.createGzip({ level: 6 })

      // 压缩后长度未知：改用 chunked 传输
      res.removeHeader('Content-Length')
      res.setHeader('Content-Encoding', encoding)

      gz.on('data', onGzData)
      gz.on('end', () => rawEnd())
      // 关键：写入方（fs.createReadStream().pipe(res)）是靠 res.write() 返回 false 后
      // 等待 **res 的 'drain' 事件** 来恢复的。而这里的写其实是写进 gzip 流，
      // 真正排空的是 gzip —— 所以必须把 gzip 的 drain 转发到 res 上，
      // 否则源端 pipe 会永久停在 paused 状态（表现为大文件响应只发出一小段后挂死）。
      gz.on('drain', () => res.emit('drain'))
      gz.on('error', () => {
        // 响应已开始，无法回退到未压缩：只能断开连接
        try {
          res.destroy()
        } catch {}
      })

      // 同一 URL 不同编码内容不同，ETag 必须区分，否则缓存会把 br 的内容当 gzip 用。
      // 先做条件请求判断（用原始 ETag 比对），再改写成带编码后缀的 ETag。
      const etag = res.getHeader('ETag')
      if (etag) {
        const encoded = `W/"${String(etag).replace(/"/g, '')}-${encoding}"`
        // 条件请求判断：客户端可能带原始 ETag（首次协商时看到的），
        // 也可能带带编码后缀的 ETag（之前某次压缩响应的），两者都算命中。
        if (
          etagMatches(req.headers['if-none-match'], etag) ||
          etagMatches(req.headers['if-none-match'], encoded)
        ) {
          // 内容未变：返回 304。此时还没有写出任何正文，
          // 必须清掉继承自 200 的实体头，否则会发出「304 却带 Content-Type/Length」的畸形响应。
          mode = 'notModified'
          pending = []
          pendingBytes = 0
          for (const h of ['Content-Type', 'Content-Length', 'Content-Encoding', 'Content-Range']) {
            res.removeHeader(h)
          }
          res.statusCode = 304
          rawEnd()
          return
        }
        res.setHeader('ETag', encoded)
      }
      mode = 'streaming'
    }

    /** 放弃压缩：把缓存原样写出，后续全部透传 */
    function giveUp(extra) {
      mode = 'raw'
      const items = pending
      pending = []
      pendingBytes = 0
      for (const b of items) rawWrite(b)
      if (extra) rawWrite(extra)
    }

    res.write = function write(chunk, enc, cb) {
      const buf = toBuffer(chunk, enc)

      // 已判定 304：丢弃正文
      if (mode === 'notModified') {
        if (typeof cb === 'function') cb()
        return true
      }

      if (mode === 'raw') return rawWrite(chunk, enc, cb)

      if (mode === 'streaming') {
        if (buf && buf.length) return gz.write(buf, cb)
        if (typeof cb === 'function') cb()
        return true
      }

      // mode === 'pending'
      if (!headersAllow()) {
        giveUp(buf)
        return true
      }
      const declared = Number(res.getHeader('Content-Length'))
      if (Number.isFinite(declared) && declared > 0) {
        if (declared < MIN_BYTES || declared > threshold) {
          giveUp(buf)
          return true
        }
        startStream()
        if (buf && buf.length) gz.write(buf, cb)
        else if (typeof cb === 'function') cb()
        return true
      }
      // 无长度声明：先缓存，等 end 再定；超过阈值说明是大响应，直接放行避免占内存
      if (buf && buf.length) {
        pending.push(buf)
        pendingBytes += buf.length
        if (pendingBytes > threshold) {
          giveUp(null)
          return true
        }
      }
      if (typeof cb === 'function') cb()
      return true
    }

    res.end = function end(chunk, enc, cb) {
      if (typeof chunk === 'function') {
        cb = chunk
        chunk = undefined
        enc = undefined
      }
      const buf = toBuffer(chunk, enc)

      // 已判定 304：已在 startStream 里结束响应
      if (mode === 'notModified') {
        if (typeof cb === 'function') cb()
        return res
      }

      if (mode === 'raw') return rawEnd(chunk, enc, cb)

      if (mode === 'streaming') {
        if (buf && buf.length) gz.write(buf)
        gz.end()
        if (typeof cb === 'function') res.once('finish', cb)
        return res
      }

      // mode === 'pending'：整个响应体都在这里，现在做最终判断
      const bodyLen = buf ? buf.length : 0
      const total = pendingBytes + bodyLen
      const declared = Number(res.getHeader('Content-Length'))
      const size = Number.isFinite(declared) && declared > 0 ? declared : total

      if (!headersAllow() || size < MIN_BYTES || size > threshold || total > threshold) {
        giveUp(buf)
        return rawEnd(cb)
      }

      startStream()
      // 把缓存的数据冲入压缩流
      const items = pending
      pending = []
      pendingBytes = 0
      for (const b of items) gz.write(b)
      if (buf && buf.length) gz.write(buf)
      gz.end()
      if (typeof cb === 'function') res.once('finish', cb)
      return res
    }

    // 允许路由主动 flush（SSE 等场景）
    res.flush = function flush() {
      if (mode === 'streaming' && gz?.flush) gz.flush(zlib.constants.Z_SYNC_FLUSH)
      return res
    }

    // 客户端中断：停掉压缩流，避免继续白跑 CPU
    res.on('close', () => {
      if (mode === 'streaming' && gz && !gz.destroyed) gz.destroy()
    })

    // 标记我们的覆写，便于诊断「重复挂载 / 被上层包裹」导致的递归
    res.write.__anihubCompress = true
    res.end.__anihubCompress = true

    next()
  }
}

export const compressionMiddleware = compression()
