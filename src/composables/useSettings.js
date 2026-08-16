// 站点设置：游客可见页面 + 内部人员可见页面（模块级单例，路由守卫 / 导航 / 主页共用）
import { ref } from 'vue'
import { getSettings } from '../api/settings'

/** null 表示尚未加载（此时默认全部可见，避免误拦截） */
const guestPages = ref(null)
const insiderPages = ref(null)
let loading = null

export function useSettings() {
  async function load() {
    if (!loading) {
      loading = getSettings()
        .then((d) => {
          guestPages.value = d.guestPages
          insiderPages.value = d.insiderPages || []
          return d
        })
        .finally(() => {
          loading = null
        })
    }
    return loading
  }

  /** 更新本地状态（设置页保存后调用，导航立即生效） */
  function apply(d) {
    guestPages.value = d.guestPages
    insiderPages.value = d.insiderPages || []
  }

  function isGuestVisible(page) {
    return guestPages.value ? guestPages.value.includes(page) : true
  }

  function isInsiderVisible(page) {
    return insiderPages.value ? insiderPages.value.includes(page) : false
  }

  /** 当前身份是否能访问某页面：游客可见 or 内部人员可见（管理员恒可见） */
  function canAccess(page, isInsider = false) {
    if (isGuestVisible(page)) return true
    return isInsider && isInsiderVisible(page)
  }

  return { guestPages, insiderPages, load, apply, isGuestVisible, isInsiderVisible, canAccess }
}
