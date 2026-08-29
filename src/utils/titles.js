import { ZH_TITLES } from '../data/zhTitles'
import { lang } from '../composables/useLanguage'

/**
 * 按当前语言返回动画标题。
 * 中文缺映射时回退罗马音；其他语言按 AniList 字段可用性逐级回退。
 */
export function titleFor(media) {
  if (!media) return ''
  const t = media.title || {}
  switch (lang.value) {
    case 'zh':
      // 中文模式优先中文译名；没有译名时回退日文原名，避免满屏英文
      return ZH_TITLES[media.id] || t.native || t.romaji || t.english || ''
    case 'native':
      return t.native || t.romaji || t.english || ''
    case 'en':
      return t.english || t.romaji || t.native || ''
    default: // romaji
      return t.romaji || t.native || t.english || ''
  }
}
