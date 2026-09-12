import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

const app = createApp(App)

// 全局错误兜底：任何组件渲染/生命周期中的未捕获异常都会走到这里。
// 没有它时 Vue 会直接卸载整棵组件树，用户看到的是一片空白（连错误码插画都没有）。
let errorShown = false
app.config.errorHandler = (err, instance, info) => {
  console.error('[app error]', info, err)
  if (errorShown) return
  errorShown = true
  // 回退到内置错误码页（复用同一套 HTTP 错误码插画），至少保证页面还有可用内容与返回入口
  try {
    router.replace({ name: 'error', params: { code: 500 } })
  } catch {
    document.body.innerHTML =
      '<div style="padding:48px;text-align:center;font-family:system-ui">' +
      '<h1 style="font-size:20px">页面出错了</h1>' +
      '<p><a href="/" style="color:#4a6cf7">返回首页</a></p></div>'
  }
}

// 未处理的 Promise 拒绝（多为接口失败）：只记录，不打断页面
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled rejection]', e.reason)
})

app.use(router).mount('#app')
