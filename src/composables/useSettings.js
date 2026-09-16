// 站点设置：游客可见页面 + 内部人员可见页面 + 壁纸/成人内容（按身份呈现，管理员恒可见）+ 配色方案（模块级单例）
import { ref } from 'vue'
import { getSettings } from '../api/settings'
import { applyScheme, SCHEMES } from './useTheme'

/** null 表示尚未加载（此时默认全部可见，避免误拦截） */
const guestPages = ref(null)
const insiderPages = ref(null)
const wallpaper = ref({ guest: true, insider: true }) // 网站壁纸：{ guest, insider }（管理员恒可见）
const showAdult = ref({ guest: false, insider: false }) // Anime 成人内容：{ guest, insider }，默认仅管理员可见
const themeScheme = ref('classic') // 全站配色方案（与昼夜主题正交），默认经典
let loading = null
let loadedValue = null // 已加载成功的数据（非 null 表示可以跳过网络请求）

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
  // 配色方案：applyData 是 load() 与 apply() 的共同汇聚点（访客与管理员都走这里），
  // 在这里落地即可让服务端下发的值生效。
  // ⚠ 未知取值一律**保持原值**而不是回退 classic —— 旧服务端或半截响应不该把方案打回默认。
  if (SCHEMES.includes(d.themeScheme)) {
    themeScheme.value = d.themeScheme
    applyScheme(d.themeScheme)
  }
  loadedValue = d
}

/** 按身份判断功能可见性：管理员（已登录）恒可见；游客/内部人员按设置 */
function canSeeFeature(feat, isLoggedIn, isInsider) {
  if (isLoggedIn) return true
  if (feat.guest) return true
  return isInsider && feat.insider
}

export function useSettings() {
  async function load() {
    // 已经成功加载过：直接复用，不再打接口。
    // （设置页原先自己调 getSettings()，与导航栏/路由守卫的这次请求完全重复）
    if (loadedValue) return loadedValue
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

  /** 强制重新拉取（设置保存后需要拿到服务端规范化结果时使用） */
  async function reload() {
    loadedValue = null
    return load()
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
    themeScheme,
    load,
    reload,
    apply,
    isGuestVisible,
    isInsiderVisible,
    canAccess,
    canSeeWallpaper,
    canSeeAdult,
  }
}
