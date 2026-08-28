<script setup>
// 一键回到顶部：页面滚动超过阈值后右下角显示圆形按钮，点击平滑回到顶部
import { onMounted, onUnmounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'

const SHOW_AFTER = 300 // 滚动超过该距离（px）才显示
const visible = ref(false)

function onScroll() {
  visible.value = (window.scrollY || document.documentElement.scrollTop || 0) > SHOW_AFTER
}

function toTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <Transition name="pop">
    <button
      v-if="visible"
      class="back-to-top"
      title="回到顶部"
      aria-label="回到顶部"
      @click="toTop"
    >
      <AppIcon name="arrow-up" :size="17" :stroke-width="1.9" />
    </button>
  </Transition>
</template>

<style scoped>
.back-to-top {
  position: fixed;
  right: 22px;
  bottom: 172px; /* 抬到桌宠上方（桌宠高 150 + 底距 10 + 12 间隔），避免被右下角桌宠遮挡 */
  z-index: 60; /* 低于登录弹窗（100），高于导航栏（50） */
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

.back-to-top:hover {
  border-color: var(--accent);
  color: var(--accent);
  transform: translateY(-3px) scale(1.05);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.22);
}

.back-to-top:active {
  transform: scale(0.9);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

/* 出现/消失：弹簧缩放入场，iOS 减速退场 */
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
