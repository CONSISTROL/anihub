<script setup>
import { theme, setTheme } from '../composables/useTheme'

const THEMES = [
  { key: 'auto', label: '自动（按时间）' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '深色' },
]
</script>

<template>
  <label class="theme-select">
    <span class="theme-icon">🌓</span>
    <select :value="theme" @change="setTheme($event.target.value)" aria-label="主题">
      <option v-for="t in THEMES" :key="t.key" :value="t.key">{{ t.label }}</option>
    </select>
  </label>
</template>

<style scoped>
.theme-select {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.theme-icon {
  font-size: 13px;
}

select {
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

select option {
  background: var(--panel-2);
  color: var(--text);
}
</style>
