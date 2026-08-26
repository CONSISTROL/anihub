<script setup>
// 一键回到顶部：页面滚动超过阈值后右下角显示圆形按钮，点击平滑回到顶部
import { onMounted, onUnmounted, ref } from 'vue'

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
  <button
    v-show="visible"
    class="back-to-top"
    title="回到顶部"
    aria-label="回到顶部"
    @click="toTop"
  >
    ↑
  </button>
</template>

<style scoped>
.back-to-top {
  position: fixed;
  right: 22px;
  bottom: 172px; /* 抬到桌宠上方（桌宠高 150 + 底距 10 + 12 间隔），避免被右下角桌宠遮挡 */
  z-index: 60; /* 低于登录弹窗（100），高于导航栏（50） */
  width: 42px;
  height: 42px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--panel);
  color: var(--text);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
  backdrop-filter: blur(6px);
  transition: border-color 0.15s, color 0.15s, transform 0.15s;
}

.back-to-top:hover {
  border-color: var(--accent);
  color: var(--accent);
  transform: translateY(-2px);
}
</style>
