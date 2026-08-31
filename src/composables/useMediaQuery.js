import { onMounted, onUnmounted, ref } from 'vue'

// 响应式媒体查询：在 JS 中判断屏幕尺寸（用于切换移动端专用布局）
export function useMediaQuery(query) {
  const matches = ref(false)
  let mq = null

  const update = () => {
    matches.value = mq ? mq.matches : window.matchMedia(query).matches
  }

  onMounted(() => {
    mq = window.matchMedia(query)
    update()
    if (mq.addEventListener) mq.addEventListener('change', update)
    else mq.addListener(update)
  })

  onUnmounted(() => {
    if (!mq) return
    if (mq.removeEventListener) mq.removeEventListener('change', update)
    else mq.removeListener(update)
  })

  return matches
}
