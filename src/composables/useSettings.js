// 站点设置：游客可见页面（模块级单例，路由守卫 / 导航 / 主页共用）
import { ref } from 'vue'
import { getGuestPages } from '../api/settings'

/** 页面 key → 游客是否可见；null 表示尚未加载（此时默认全部可见，避免误拦截） */
const guestPages = ref(null)
let loading = null

export function useSettings() {
  async function load() {
    if (!loading) {
      loading = getGuestPages()
        .then((pages) => {
          guestPages.value = pages
          return pages
        })
        .finally(() => {
          loading = null
        })
    }
    return loading
  }

  /** 更新本地状态（设置页保存后调用，导航立即生效） */
  function apply(pages) {
    guestPages.value = pages
  }

  function isGuestVisible(page) {
    return guestPages.value ? guestPages.value.includes(page) : true
  }

  return { guestPages, load, apply, isGuestVisible }
}
