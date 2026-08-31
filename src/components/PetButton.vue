<script setup>
// 桌宠隐藏 / 手机端时的紧凑图标按钮：以小图标代替完整桌宠，风格与回到顶部按钮一致
</script>

<template>
  <button class="pet-button" type="button" title="桌宠已隐藏" aria-label="桌宠">
    <img src="/deepseek_maid_icon.png" alt="桌宠" draggable="false" />
  </button>
</template>

<style scoped>
.pet-button {
  position: fixed;
  right: 22px;
  bottom: 10px;
  z-index: 60;
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--panel);
  cursor: pointer;
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
  backdrop-filter: blur(6px);
  transition:
    border-color var(--dur-ios-1) var(--ease-ios-expo),
    box-shadow var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-1) var(--ease-ios-spring);
}

.pet-button:hover {
  border-color: var(--accent);
  transform: translateY(-3px) scale(1.05);
  box-shadow: 0 8px 20px rgb(0 0 0 / 0.22);
}

.pet-button:active {
  transform: scale(0.9);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.pet-button img {
  width: 26px;
  height: 26px;
  object-fit: contain;
  pointer-events: none;
  -webkit-user-drag: none;
}
</style>
