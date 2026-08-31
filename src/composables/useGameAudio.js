// 游戏音频加载模式：控制是否提前传输 / 加载 Shattered Pixel Dungeon 的音频资源
// - noaudio：进入游戏时不请求音频，加载更快
// - 点击顶栏「加载音频」后，从 /spd/audio-manifest.json 拉取剩余音频资源并缓存
import { ref } from 'vue'

const STORAGE_KEY = 'anihub.game-audio'
const MANIFEST_URL = '/spd/audio-manifest.json'

function readSaved() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'audio' || v === 'noaudio' ? v : null
  } catch {
    return null
  }
}

const audioMode = ref(readSaved())
const audioLoaded = ref(false)
const loadingAudio = ref(false)

function chooseAudio(mode) {
  audioMode.value = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
    if (mode === 'noaudio') {
      localStorage.setItem('anihub-game-audio-enabled', '0')
    } else {
      localStorage.removeItem('anihub-game-audio-enabled')
    }
  } catch {
    /* ignore */
  }
}

async function loadRemainingAudio() {
  if (loadingAudio.value || audioLoaded.value || audioMode.value !== 'noaudio') return
  loadingAudio.value = true
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`audio manifest ${res.status}`)
    const files = await res.json()
    // 并发但限制数量，避免一次性打爆浏览器连接数
    const concurrency = 6
    let index = 0
    async function worker() {
      while (index < files.length) {
        const url = files[index++]
        try {
          await fetch(url, { cache: 'force-cache' })
        } catch {
          // 单个音频失败不影响整体
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
    audioLoaded.value = true
    try {
      localStorage.setItem('anihub-game-audio-enabled', '1')
    } catch {
      /* ignore */
    }
  } finally {
    loadingAudio.value = false
  }
}

export function useGameAudio() {
  return {
    audioMode,
    audioLoaded,
    loadingAudio,
    chooseAudio,
    loadRemainingAudio,
  }
}
