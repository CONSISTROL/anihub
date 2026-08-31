<script setup>
// 桌宠隐藏 / 手机端时的紧凑图标按钮：以小图标代替完整桌宠，风格与回到顶部按钮一致
</script>

<template>
  <button class="pet-button" type="button" title="桌宠已隐藏" aria-label="桌宠"></button>
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
  border: none;
  border-radius: 50%;
  background: url('/deepseek_maid_icon.png') center / cover no-repeat;
  cursor: pointer;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.22);
  transition:
    box-shadow var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring);
}

.pet-button:hover {
  transform: translateY(-3px) scale(1.05);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.28);
}

.pet-button:active {
  transform: scale(0.9);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}
</style>
