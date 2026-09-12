<script setup>
// 桌宠未显示（被隐藏 / 手机端）时的紧凑图标按钮：点击召唤完整桌宠。
// 注意它只在「有权限但当前没显示完整桌宠」时渲染，因此点击一定有反馈。
</script>

<template>
  <button class="pet-button" type="button" title="召唤桌宠" aria-label="召唤桌宠"></button>
</template>

<style scoped>
.pet-button {
  position: fixed;
  right: 22px;
  bottom: 10px;
  z-index: 60;
  width: 42px;
  height: 42px;
  padding: 0;
  /* 背景图加载失败时仍是一个可点、可辨认的圆形按钮，不会变成隐形控件 */
  background: var(--panel) url('/deepseek_maid_icon.png') center / cover no-repeat;
  border: 1px solid var(--border);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.22);
  transition:
    box-shadow var(--dur-ios-1) var(--ease-ios-expo),
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring);
}

.pet-button:hover {
  transform: translateY(-3px) scale(1.05);
  border-color: var(--accent);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.28);
}

.pet-button:active {
  transform: scale(0.9);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}
</style>
