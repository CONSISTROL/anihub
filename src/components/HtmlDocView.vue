<script setup>
// HTML 渲染：完整 HTML 文档（含 <!DOCTYPE html> / <html> 的独立页面，可带 <style>/<script>）
// 用独立 iframe 渲染，保留全部样式与脚本；普通 HTML 片段走 DOMPurify 消毒渲染。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import RichTextView from './RichTextView.vue'

const props = defineProps({ source: { type: String, default: '' } })

// 完整文档判定：以 <!DOCTYPE html> 或 <html 开头
const isFullDoc = computed(() => /^\s*(<!DOCTYPE[^>]*>)?\s*<html[\s>]/i.test(props.source))

// 修复 AI 生成文档常见的畸形 mermaid 块：
// <pre class="mermaid"> 内部又嵌套了 <pre><code>…</code></pre>，图的文本里混入字面 <pre><code> 标签，
// 导致 mermaid 解析报 "Syntax error in text"。
// 逐块处理（以块内第一个 </pre> 为界，只作用于单个 mermaid 块），随后清掉残留的 <p></pre></p>。
function repairMermaid(src) {
  return src
    .replace(/<pre class="mermaid">[\s\S]*?<\/pre>/gi, (block) => {
      const inner = block.replace(/^<pre class="mermaid">/i, '')
      if (!/<pre[\s>]/i.test(inner)) return block // 无嵌套，原样返回
      return (
        '<pre class="mermaid">' +
        inner.replace(/<pre><code>/gi, '\n').replace(/<\/code><\/pre>/gi, '') +
        '</pre>'
      )
    })
    .replace(/<p><\/pre><\/p>/gi, '')
}

const height = ref(600)
const frameEl = ref(null)
// 完整文档用 iframe 独立渲染，可能包含外部 CDN / 脚本，加载耗时较长；
// 在 iframe 内容真正可用前显示加载占位，避免看起来像“白屏/没反应”。
const ready = ref(false)
let readyTimer = null
let frameLoaded = false
let heightReceived = false

function markReady() {
  if (ready.value) return
  ready.value = true
  clearTimeout(readyTimer)
}

function requestHeight() {
  const f = frameEl.value
  if (f && f.contentWindow) f.contentWindow.postMessage({ __anihubGetH: true }, '*')
}

function onFrameLoad() {
  frameLoaded = true
  // load 之前收到的高度可能来自 body 尚未解析时的早期上报（例如外部 CDN 阻塞解析时
  // 定时器上报的 0/200px），不能作为最终高度；这里作废并主动向 iframe 要一次最终高度。
  heightReceived = false
  requestHeight()
}

function onMessage(e) {
  const d = e.data
  if (d && typeof d === 'object' && typeof d.__anihubDocH === 'number') {
    // load 前的高度不可信：外部 CDN 阻塞解析时，documentElement.scrollHeight
    // 会等于视口高度，导致 iframe 高度随分辨率变化。这里一律忽略，只用 load 后的真实高度。
    if (!frameLoaded) return
    heightReceived = true
    height.value = Math.max(200, Math.min(20000, d.__anihubDocH))
    markReady()
  }
}

onMounted(() => {
  window.addEventListener('message', onMessage)
  // 兜底：外部资源长时间挂起/永不触发 load 时不至于让占位永远挡住页面
  readyTimer = setTimeout(markReady, 20000)
})

onUnmounted(() => {
  window.removeEventListener('message', onMessage)
  clearTimeout(readyTimer)
})

watch(
  () => props.source,
  () => {
    ready.value = false
    frameLoaded = false
    heightReceived = false
    clearTimeout(readyTimer)
    readyTimer = setTimeout(markReady, 20000)
  }
)

// 注入高度上报 + 标题定位脚本（插入 <head> 之后，先于文档自身的外部脚本解析）：
// 文档内若有加载缓慢/挂起的外部 <script src>（如 CDN），HTML 解析器会停在原地，
// 追加在末尾的脚本永远不会被解析 → 高度永远不更新。
// 因此：① 插到 head 后保证先解析；② 用 DOMContentLoaded + 定时轮询 + ResizeObserver 多路兜底，
// 解析被卡住时定时器仍会触发，能上报当前（部分）高度，解析完成后 DOMContentLoaded 再上报完整高度。
// 同时：① 上报标题位置表 {__anihubHeads:[{t,y}]} 供父页面滚动高亮当前小节；
// ② 监听 {__anihubScroll: 标题文本}，找到标题后回传 {__anihubScrollY: 文档内偏移}，供父页面滚动定位。
const REPORT_JS = `<script>
(function () {
  var W = function (m) { try { parent.postMessage(m, '*') } catch (e) {} }
  var H = function () {
    var hs = document.querySelectorAll('h1,h2,h3,h4,h5,h6'), a = []
    for (var i = 0; i < hs.length; i++) {
      var t = hs[i].textContent.trim()
      if (t) a.push({ t: t, y: Math.round(hs[i].getBoundingClientRect().top + (window.pageYOffset || 0)) })
    }
    return a
  }
  var P = function () {
    var d = document, el = d.documentElement, h = Math.max(el.scrollHeight, d.body ? d.body.scrollHeight : 0)
    if (h > 0) W({ __anihubDocH: h })
    var a = H()
    if (a.length) W({ __anihubHeads: a })
  }
  var ready = function () { P(); try { new ResizeObserver(P).observe(document.body) } catch (e) {} }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', ready) } else { ready() }
  var n = 0
  var iv = setInterval(function () {
    if (document.readyState !== 'loading') { P(); if (++n >= 6) clearInterval(iv) }
  }, 400)
  setTimeout(P, 2000)
  setTimeout(P, 5000)
  var lastT = 0
  document.addEventListener('mousemove', function (e) {
    var now = Date.now()
    if (now - lastT > 120) { lastT = now; W({ __anihubPointer: { x: e.clientX, y: e.clientY } }) }
  })
  window.addEventListener('message', function (e) {
    var d = e.data
    if (!d || typeof d !== 'object') return
    if (d.__anihubGetH) { P(); return }
    if (d.__anihubScroll) {
      var txt = String(d.__anihubScroll), hs = document.querySelectorAll('h1,h2,h3,h4,h5,h6'), el = null
      for (var i = 0; i < hs.length; i++) {
        if (hs[i].textContent.trim() === txt) { el = hs[i]; break }
      }
      if (!el) {
        for (var j = 0; j < hs.length; j++) {
          if (hs[j].textContent.indexOf(txt) >= 0) { el = hs[j]; break }
        }
      }
      if (el) W({ __anihubScrollY: el.getBoundingClientRect().top + (window.pageYOffset || 0) })
    }
  })
})()
<\/script>`
const srcdoc = computed(() => {
  const src = repairMermaid(props.source)
  const m = src.match(/<head[^>]*>/i)
  return m ? src.replace(m[0], m[0] + REPORT_JS) : src + REPORT_JS
})
</script>

<template>
  <RichTextView v-if="!isFullDoc" :source="source" />
  <div v-else class="doc-frame-wrap">
    <iframe
      ref="frameEl"
      class="doc-frame"
      :srcdoc="srcdoc"
      :style="{ height: height + 'px' }"
      sandbox="allow-scripts"
      loading="lazy"
      title="HTML 文档"
      @load="onFrameLoad"
    ></iframe>
    <div v-if="!ready" class="doc-loading" role="status" aria-live="polite">
      <span class="doc-spinner"></span>
      <span>HTML 文档加载中…</span>
    </div>
  </div>
</template>

<style scoped>
.doc-frame-wrap {
  position: relative;
  width: 100%;
}

.doc-frame {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff; /* 独立文档自带样式，白底兜底 */
}

.doc-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 13px;
  z-index: 1;
}

.doc-spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid var(--panel-2);
  border-top-color: var(--accent);
  animation: doc-spin 0.8s linear infinite;
}

@keyframes doc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
