<script setup>
import { LANGS, lang } from '../composables/useLanguage'
</script>

<template>
  <label class="lang-select">
    <span class="lang-icon">🌐</span>
    <select v-model="lang" aria-label="显示语言">
      <option v-for="l in LANGS" :key="l.key" :value="l.key">{{ l.label }}</option>
    </select>
  </label>
</template>

<style scoped>
.lang-select {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.lang-icon {
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
