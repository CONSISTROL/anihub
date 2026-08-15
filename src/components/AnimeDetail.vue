<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { fmtDate, fmtTime } from '../utils/date'
import { titleFor } from '../utils/titles'
import { lang } from '../composables/useLanguage'
import { ZH_DESCRIPTIONS } from '../data/zhDescriptions'

const props = defineProps({
  media: { type: Object, default: null },
  episodes: { type: Array, default: () => [] }, // 该番剧的排期，按时间升序
})

const emit = defineEmits(['close'])

const STATUS_LABELS = {
  RELEASING: '连载中',
  FINISHED: '已完结',
  NOT_YET_RELEASED: '未开播',
  CANCELLED: '已取消',
}

const FORMAT_LABELS = {
  TV: 'TV',
  TV_SHORT: 'TV 短片',
  MOVIE: '剧场版',
  OVA: 'OVA',
  ONA: 'ONA',
  SPECIAL: '特别篇',
  MUSIC: 'MV',
}

const displayTitle = computed(() => titleFor(props.media) || '未知标题')

const studio = computed(() => props.media?.studios?.nodes?.[0]?.name)

const description = computed(() => {
  // 语言为中文时优先显示本地维护的中文简介，未收录则回退 AniList 原文
  if (lang.value === 'zh') {
    const zh = ZH_DESCRIPTIONS[props.media?.id]
    if (zh) return zh
  }
  const raw = props.media?.description
  if (!raw) return ''
  // AniList 简介是 HTML，去掉标签后保留换行
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
})

// 按日期分组显示放送列表
const episodesByDate = computed(() => {
  const groups = []
  for (const e of props.episodes) {
    const key = fmtDate(e.airingAt)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(e)
    else groups.push({ key, items: [e] })
  }
  return groups
})

function onKeydown(e) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="media" class="modal-overlay" @click.self="emit('close')">
        <div class="modal">
          <button class="close-btn" @click="emit('close')" aria-label="关闭">✕</button>

          <div class="modal-body">
            <img v-if="media.coverImage?.large" :src="media.coverImage.large" class="cover" alt="封面" />
            <div class="info">
              <h2 class="title">{{ displayTitle }}</h2>
              <div v-if="media.title?.native && media.title.native !== displayTitle" class="native">{{ media.title.native }}</div>
              <div v-if="media.title?.english && media.title.english !== displayTitle" class="english">{{ media.title.english }}</div>

              <div class="meta">
                <span v-if="media.status" class="tag">{{ STATUS_LABELS[media.status] || media.status }}</span>
                <span v-if="media.format" class="tag">{{ FORMAT_LABELS[media.format] || media.format }}</span>
                <span v-if="media.episodes" class="tag">全 {{ media.episodes }} 话</span>
                <span v-if="media.averageScore" class="tag score">★ {{ media.averageScore }}</span>
                <span v-if="studio" class="tag">{{ studio }}</span>
                <span v-for="g in media.genres" :key="g" class="tag genre">{{ g }}</span>
              </div>

              <div v-if="description" class="desc">{{ description }}</div>

              <a v-if="media.siteUrl" class="site-link" :href="media.siteUrl" target="_blank" rel="noreferrer">
                查看 AniList 详情 ↗
              </a>
            </div>
          </div>

          <div v-if="episodes.length" class="schedule">
            <h3>放送时间表</h3>
            <div v-for="g in episodesByDate" :key="g.key" class="ep-date">
              <span class="ep-date-label">{{ g.key }}</span>
              <span v-for="e in g.items" :key="e.episode" class="ep-item">
                第{{ e.episode }}话 {{ fmtTime(e.airingAt) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.6);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
}

.modal {
  position: relative;
  width: min(680px, 100%);
  max-height: min(82vh, 760px);
  overflow-y: auto;
  background: var(--overlay-panel); /* 弹窗实底，保证长文可读 */
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 22px;
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.5);
}

.close-btn {
  position: absolute;
  top: 12px;
  right: 14px;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
}

.close-btn:hover {
  color: var(--text);
}

.modal-body {
  display: flex;
  gap: 18px;
}

.cover {
  width: 200px;
  height: auto; /* 显示封面原图比例，不裁剪 */
  align-self: flex-start; /* 防止 flex 默认 stretch 把封面拉长（右侧信息更高时） */
  flex-shrink: 0;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.info {
  flex: 1;
  min-width: 0;
}

.title {
  margin: 0 0 4px;
  font-size: 20px;
  line-height: 1.35;
}

.native {
  color: var(--muted);
  font-size: 14px;
  margin-bottom: 2px;
}

.english {
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 10px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.tag {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--muted);
  border: 1px solid var(--border);
}

.tag.score {
  color: #ffd166;
}

.tag.genre {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}

.desc {
  font-size: 13px;
  line-height: 1.7;
  color: var(--muted);
  white-space: pre-line;
  max-height: 180px;
  overflow-y: auto;
}

.site-link {
  display: inline-block;
  margin-top: 12px;
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
}

.site-link:hover {
  text-decoration: underline;
}

.schedule {
  margin-top: 18px;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.schedule h3 {
  margin: 0 0 10px;
  font-size: 14px;
  color: var(--muted);
}

.ep-date {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 5px 0;
  font-size: 13px;
  border-bottom: 1px dashed var(--border);
}

.ep-date:last-child {
  border-bottom: none;
}

.ep-date-label {
  flex-shrink: 0;
  color: var(--accent);
  font-weight: 600;
  width: 88px;
}

.ep-item {
  color: var(--text);
}

/* 弹窗动画 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}

.modal-enter-active .modal,
.modal-leave-active .modal {
  transition: transform 0.18s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal,
.modal-leave-to .modal {
  transform: translateY(12px) scale(0.98);
}
</style>
