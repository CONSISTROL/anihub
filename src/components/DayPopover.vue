<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { dayKey, fmtTime, weekdayCN } from '../utils/date'
import { titleFor } from '../utils/titles'

const props = defineProps({
  date: { type: Date, required: true },
  entries: { type: Array, default: () => [] }, // 当天排期，按时间升序
  mediaMap: { type: Map, required: true },
})

const emit = defineEmits(['select', 'close'])

const dateLabel = computed(() => `${dayKey(props.date)} 星期${weekdayCN(props.date)}`)

function titleOf(mediaId) {
  return titleFor(props.mediaMap.get(mediaId)) || `#${mediaId}`
}

function coverOf(mediaId) {
  const m = props.mediaMap.get(mediaId)
  return m?.coverImage?.medium || m?.coverImage?.large || ''
}

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div class="popover-overlay" @click.self="emit('close')">
        <div class="popover">
          <div class="popover-head">
            <h2>{{ dateLabel }}</h2>
            <span class="count">{{ entries.length }} 部</span>
            <button class="close-btn" @click="emit('close')" aria-label="关闭">✕</button>
          </div>
          <div class="popover-list">
            <button
              v-for="e in entries"
              :key="`${e.mediaId}-${e.episode}`"
              class="row"
              @click="emit('select', e.mediaId)"
            >
              <img v-if="coverOf(e.mediaId)" :src="coverOf(e.mediaId)" class="cover" alt="" />
              <span v-else class="cover cover-placeholder">🎬</span>
              <span class="row-title">{{ titleOf(e.mediaId) }}</span>
              <span class="row-ep">第{{ e.episode }}话</span>
              <span class="row-time">{{ fmtTime(e.airingAt) }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.popover-overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
  padding: 24px;
}

.popover {
  width: min(520px, 100%);
  max-height: min(78vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.5);
  overflow: hidden;
}

.popover-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}

.popover-head h2 {
  margin: 0;
  font-size: 16px;
}

.popover-head .count {
  font-size: 12px;
  color: var(--muted);
}

.popover-head .close-btn {
  margin-left: auto;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 13px;
  cursor: pointer;
}

.popover-head .close-btn:hover {
  color: var(--text);
}

.popover-list {
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.row:hover {
  background: var(--panel-2);
}

.cover {
  width: 38px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 5px;
  flex-shrink: 0;
}

.cover-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--panel-2);
  border: 1px solid var(--border);
  font-size: 16px;
}

.row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-ep {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--muted);
}

.row-time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

/* 弹窗动画 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}

.modal-enter-active .popover,
.modal-leave-active .popover {
  transition: transform 0.18s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .popover,
.modal-leave-to .popover {
  transform: translateY(12px) scale(0.98);
}
</style>
