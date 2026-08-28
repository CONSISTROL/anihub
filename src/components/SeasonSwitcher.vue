<script setup>
import { SEASONS } from '../utils/date'
import AppIcon from './AppIcon.vue'

defineProps({
  year: { type: Number, required: true },
  season: { type: String, required: true },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['prev', 'current', 'next'])
</script>

<template>
  <div class="season-switcher">
    <button class="btn" :disabled="loading" @click="emit('prev')"><AppIcon name="chevron-left" :size="14" /> 上一档</button>
    <button class="btn season-btn" :disabled="loading" @click="emit('current')" title="回到当前档期">
      {{ year }} {{ SEASONS[season].label }}新番
    </button>
    <button class="btn" :disabled="loading" @click="emit('next')">下一档 <AppIcon name="chevron-right" :size="14" /></button>
  </div>
</template>

<style scoped>
.season-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
}

.season-btn {
  min-width: 132px;
  font-weight: 600;
  background: var(--accent);
  color: #fff;
  border-color: transparent;
}

.season-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}
</style>
