// 站点设置：游客可见页面 + 内部人员可见页面 + 壁纸/成人内容（按身份呈现，管理员恒可见）（模块级单例）
import { ref } from 'vue'
import { getSettings } from '../api/settings'

/** null 表示尚未加载（此时默认全部可见，避免误拦截） */
const guestPages = ref(null)
const insiderPages = ref(null)
const wallpaper = ref({ guest: true, insider: true }) // 网站壁纸：{ guest, insider }（管理员恒可见）
const showAdult = ref({ guest: false, insider: false }) // Anime 成人内容：{ guest, insider }，默认仅管理员可见
let loading = null

function applyData(d) {
  guestPages.value = d.guestPages
  insiderPages.value = d.insiderPages || []
  wallpaper.value = {
    guest: d.wallpaper?.guest === true,
    insider: d.wallpaper?.insider === true,
  }
  showAdult.value = {
    guest: d.showAdult?.guest === true,
    insider: d.showAdult?.insider === true,
  }
}

/** 按身份判断功能可见性：管理员（已登录）恒可见；游客/内部人员按设置 */
function canSeeFeature(feat, isLoggedIn, isInsider) {
  if (isLoggedIn) return true
  if (feat.guest) return true
  return isInsider && feat.insider
}

export function useSettings() {
  async function load() {
    if (!loading) {
      loading = getSettings()
        .then((d) => {
          applyData(d)
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
    applyData(d)
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

  /** 当前身份是否能看到网站壁纸（管理员恒可见） */
  function canSeeWallpaper(isLoggedIn, isInsider = false) {
    return canSeeFeature(wallpaper.value, isLoggedIn, isInsider)
  }

  /** 当前身份是否能看到 Anime 成人内容（管理员恒可见） */
  function canSeeAdult(isLoggedIn, isInsider = false) {
    return canSeeFeature(showAdult.value, isLoggedIn, isInsider)
  }

  return {
    guestPages,
    insiderPages,
    wallpaper,
    showAdult,
    load,
    apply,
    isGuestVisible,
    isInsiderVisible,
    canAccess,
    canSeeWallpaper,
    canSeeAdult,
  }
}
