<script setup>
// HTML 渲染：完整 HTML 文档（含 <!DOCTYPE html> / <html> 的独立页面，可带 <style>/<script>）
// 用独立 iframe 渲染，保留全部样式与脚本；普通 HTML 片段走 DOMPurify 消毒渲染。
import { computed, onMounted, onUnmounted, ref } from 'vue'
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
function onMessage(e) {
  const d = e.data
  if (d && typeof d === 'object' && typeof d.__anihubDocH === 'number') {
    height.value = Math.max(200, Math.min(20000, d.__anihubDocH))
  }
}
onMounted(() => window.addEventListener('message', onMessage))
onUnmounted(() => window.removeEventListener('message', onMessage))

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
    if (d && typeof d === 'object' && d.__anihubScroll) {
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
  <iframe
    v-else
    class="doc-frame"
    :srcdoc="srcdoc"
    :style="{ height: height + 'px' }"
    sandbox="allow-scripts"
    loading="lazy"
    title="HTML 文档"
  ></iframe>
</template>

<style scoped>
.doc-frame {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff; /* 独立文档自带样式，白底兜底 */
}
</style>
