<script setup>
// 一键回到底部：页面不在底部时显示右下角按钮，点击平滑滚动到底部
import { onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'

const HIDE_NEAR_BOTTOM = 300 // 距底部小于该距离时隐藏
const visible = ref(false)

function onScroll() {
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  const y = window.scrollY || doc.scrollTop || 0
  visible.value = max > 0 && y < max - HIDE_NEAR_BOTTOM
}

function toBottom() {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
})
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
})
</script>

<template>
  <Transition name="pop">
    <button
      v-if="visible"
      class="back-to-bottom"
      title="回到底部"
      aria-label="回到底部"
      @click="toBottom"
    >
      <AppIcon name="arrow-down" :size="17" :stroke-width="1.9" />
    </button>
  </Transition>
</template>

<style scoped>
.back-to-bottom {
  position: fixed;
  right: 22px;
  bottom: 120px; /* 放在“回到顶部”下方，避免重叠 */
  z-index: 60;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
  backdrop-filter: blur(6px);
  transition:
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring);
}

.back-to-bottom:hover {
  border-color: var(--accent);
  color: var(--accent);
  transform: translateY(-3px) scale(1.05);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.22);
}

.back-to-bottom:active {
  transform: scale(0.9);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.pop-enter-active {
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    opacity var(--dur-ios-1) var(--ease-ios-expo);
}

.pop-leave-active {
  transition:
    transform var(--dur-ios-1) var(--ease-ios),
    opacity var(--dur-ios-1) var(--ease-ios);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.75);
}
</style>
