<script setup>
// Anime 页语言切换：胶囊按钮 + 自定义 iOS 风格下拉菜单。
// 原生 select 的下拉面板由浏览器渲染、无法跨平台统一美化，这里改为自绘下拉：
// 弹簧缩放 + Expo 淡入，当前语言带线性对勾，点击外部 / Esc 关闭。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { LANGS, lang } from '../composables/useLanguage'
import AppIcon from './AppIcon.vue'

const root = ref(null)
const open = ref(false)

const currentLabel = computed(() => LANGS.find((l) => l.key === lang.value)?.label || '中文')

function toggle() {
  open.value = !open.value
}

function select(l) {
  lang.value = l.key
  open.value = false
}

function onDocPointerDown(e) {
  if (root.value && !root.value.contains(e.target)) open.value = false
}

function onDocKeydown(e) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onDocKeydown)
})
onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onDocKeydown)
})
</script>

<template>
  <div ref="root" class="lang-select">
    <button
      type="button"
      class="lang-btn"
      :aria-expanded="open"
      aria-haspopup="listbox"
      title="切换番剧显示语言"
      @click="toggle"
    >
      <span class="lang-badge"><AppIcon name="globe" :size="14" :stroke-width="1.9" /></span>
      <span class="lang-value">{{ currentLabel }}</span>
      <span class="lang-chevron" :class="{ open }">
        <AppIcon name="chevron-down" :size="12" :stroke-width="2" />
      </span>
    </button>

    <Transition name="dropdown">
      <div v-if="open" class="lang-menu" role="listbox" aria-label="显示语言">
        <button
          v-for="l in LANGS"
          :key="l.key"
          type="button"
          role="option"
          :aria-selected="lang === l.key"
          class="lang-option"
          :class="{ on: lang === l.key }"
          @click="select(l)"
        >
          <span class="lang-option-label">{{ l.label }}</span>
          <AppIcon v-if="lang === l.key" name="check" :size="13" :stroke-width="2" class="lang-check" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.lang-select {
  position: relative;
  display: inline-flex;
}

/* —— 胶囊按钮（外壳） —— */
.lang-btn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 9px 5px 6px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.06);
  backdrop-filter: blur(10px);
  transition:
    transform var(--dur-ios-1) var(--ease-ios-spring),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    background-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
}

.lang-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(135deg, var(--accent), #a78bfa);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent);
  transition: transform var(--dur-ios-1) var(--ease-ios-spring);
}

.lang-value {
  min-width: 46px;
  text-align: left;
  font-weight: 600;
  white-space: nowrap;
}

.lang-chevron {
  display: flex;
  align-items: center;
  color: var(--muted);
  transition:
    color var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-2) var(--ease-ios-spring);
}

.lang-chevron.open {
  transform: rotate(180deg);
  color: var(--accent);
}

.lang-btn:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--panel) 96%, transparent);
  box-shadow: 0 8px 22px color-mix(in srgb, var(--accent) 16%, transparent);
}

.lang-btn:hover .lang-badge {
  transform: scale(1.08) rotate(-6deg);
}

.lang-btn:hover .lang-chevron {
  color: var(--accent);
}

.lang-btn:active {
  transform: scale(0.96);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.lang-btn:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent),
    0 8px 22px color-mix(in srgb, var(--accent) 14%, transparent);
}

/* —— 下拉菜单（iOS 风格浮层） —— */
.lang-menu {
  position: absolute;
  top: calc(100% + 9px);
  right: 0;
  z-index: 80;
  min-width: 148px;
  padding: 5px;
  background: color-mix(in srgb, var(--overlay-panel) 92%, transparent);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow:
    0 18px 46px rgb(0 0 0 / 0.24),
    0 2px 8px rgb(0 0 0 / 0.08);
  backdrop-filter: blur(16px);
  transform-origin: top right;
}

.lang-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--dur-ios-1) var(--ease-ios-expo),
    color var(--dur-ios-1) var(--ease-ios-expo);
}

.lang-option:hover {
  background: var(--panel-2);
}

.lang-option:active {
  background: color-mix(in srgb, var(--accent) 14%, var(--panel-2));
}

.lang-option.on {
  color: var(--accent);
  font-weight: 600;
}

.lang-check {
  color: var(--accent);
}

/* 下拉动画：弹簧缩放入场，iOS 减速退场 */
.dropdown-enter-active {
  transition:
    opacity var(--dur-ios-1) var(--ease-ios-expo),
    transform var(--dur-ios-2) var(--ease-ios-spring);
}

.dropdown-leave-active {
  transition:
    opacity var(--dur-ios-1) var(--ease-ios),
    transform var(--dur-ios-1) var(--ease-ios);
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.92);
}
</style>
