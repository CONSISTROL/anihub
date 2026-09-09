// 代码块复制增强：给容器内每个 <pre> 外包一层 .code-wrap 并加右上角“复制”按钮。
// 每次渲染（v-html 替换 DOM）后重跑即可，已处理的块用 data-copy-ready 标记跳过。
// 只处理阅读类渲染（.markdown-body 内的 md / 富文本 / HTML 片段），不涉及完整 HTML 文档 iframe。

// 取块内代码文本：优先取 <code>，textContent 不依赖布局（折叠/隐藏的块也能取到原文），
// 且保留代码开头有意保留的空行，只去掉末尾空白（对应渲染出的尾部换行）。
function getCodeText(pre) {
  const el = pre.querySelector('code') || pre
  return (el.textContent || '').replace(/\s+$/, '')
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '0'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.focus() // 部分浏览器 select() 前需要焦点，否则 execCommand('copy') 失败
  ta.select()
  try {
    return document.execCommand('copy')
  } catch (_) {
    return false
  } finally {
    document.body.removeChild(ta)
  }
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (_) {
      // 权限被拒等 → 走兜底
    }
  }
  return fallbackCopy(text)
}

export function enhanceCodeBlocks(root) {
  if (!root) return
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.dataset.copyReady === '1') return
    if (pre.closest('.code-wrap')) return
    if (pre.classList.contains('mermaid')) return
    // 复制文本在点击时才读取，因此折叠块、后来才可见/异步填充的代码也能复制到最新内容。
    // 纯空块不挂按钮（也不打标记），避免渲染出无意义的按钮。
    if (!getCodeText(pre)) return

    const wrap = document.createElement('div')
    wrap.className = 'code-wrap'
    pre.before(wrap)
    wrap.appendChild(pre)

    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'code-copy'
    btn.setAttribute('aria-label', '复制代码')
    btn.textContent = '复制'
    let token = 0
    btn.addEventListener('click', async () => {
      const t = ++token // 过期回调/快速连点不得覆盖新状态
      const ok = await copyText(getCodeText(pre))
      if (t !== token) return
      btn.textContent = ok ? '已复制' : '复制失败'
      btn.classList.toggle('done', ok)
      setTimeout(() => {
        if (t !== token) return
        btn.textContent = '复制'
        btn.classList.remove('done')
      }, ok ? 1600 : 2400)
    })
    wrap.appendChild(btn)
    pre.dataset.copyReady = '1'
  })
}
