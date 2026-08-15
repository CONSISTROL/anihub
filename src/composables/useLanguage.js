import { ref, watch } from 'vue'

const STORAGE_KEY = 'anime-calendar.lang'

export const LANGS = [
  { key: 'zh', label: '中文' },
  { key: 'native', label: '日本語' },
  { key: 'en', label: 'English' },
  { key: 'romaji', label: '罗马音' },
]

// 默认中文；选择结果持久化到 localStorage
const saved = localStorage.getItem(STORAGE_KEY)
export const lang = ref(LANGS.some((l) => l.key === saved) ? saved : 'zh')

watch(lang, (v) => localStorage.setItem(STORAGE_KEY, v))
