import { ref } from 'vue'

// 全局页面加载进度状态：路由懒加载 / 页面切换时由 router 守卫驱动
const loading = ref(false)
let finishTimer = null

export function usePageProgress() {
  return { loading }
}

export function startPageLoading() {
  loading.value = true
  // 兜底：极端情况下 afterEach 未触发（导航被取消等）时，不让进度条永久卡住
  clearTimeout(finishTimer)
  finishTimer = setTimeout(() => {
    loading.value = false
  }, 30000)
}

export function finishPageLoading() {
  clearTimeout(finishTimer)
  finishTimer = null
  loading.value = false
}
