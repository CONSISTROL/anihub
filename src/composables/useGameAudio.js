// 游戏音频加载模式：控制是否额外拉取 Shattered Pixel Dungeon 的音频资源
//
// 设计：**默认不加载音频**。
// - 音频资源共 98 个文件、约 18MB（music + sounds），游戏在「无音频」模式下
//   不请求任何音频，首次进入会明显更快。
// - 想要声音时点顶栏「加载音频」按钮（或游戏内设置里开启），
//   这时才从 /spd/audio-manifest.json 逐个拉取并写进 HTTP 缓存，之后游戏可直接使用。
//
// 因此默认值是 'noaudio' 而不是 null：
// 之前 null 表示「还没选过」，会先弹一个模式选择弹窗拦住整个游戏，
// 且不写入任何状态——既拖慢了进入，也让「默认加载音频」成为可能。
import { ref } from 'vue'

const STORAGE_KEY = 'anihub.game-audio'
const MANIFEST_URL = '/spd/audio-manifest.json'

// 游戏本体（public/spd/app.js）读取这个键来决定是否跳过音频加载：
//   '0' → 跳过（默认）；'1' → 允许加载
const GAME_FLAG_KEY = 'anihub-game-audio-enabled'

function readSaved() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'audio' || v === 'noaudio' ? v : 'noaudio' // 未选择过 → 默认无音频
  } catch {
    return 'noaudio'
  }
}

/** 同步游戏本体使用的跳过标记 */
function writeGameFlag(mode) {
  try {
    if (mode === 'noaudio') localStorage.setItem(GAME_FLAG_KEY, '0')
    else localStorage.setItem(GAME_FLAG_KEY, '1')
  } catch {
    /* ignore */
  }
}

const audioMode = ref(readSaved())
const audioLoaded = ref(false)
const loadingAudio = ref(false)

// 首次进入就把默认值落到游戏本体：保证「默认不加载音频」在第一次访问也成立
writeGameFlag(audioMode.value)

function chooseAudio(mode) {
  audioMode.value = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
  writeGameFlag(mode)
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
    // 音频已进入浏览器缓存：放开游戏本体的跳过标记，游戏即可直接使用
    writeGameFlag('audio')
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
