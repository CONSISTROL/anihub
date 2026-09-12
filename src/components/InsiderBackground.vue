<script setup>
// 内部人员模式全局背景：inside 模式下所有页面都像 Anime 页一样显示壁纸。
// 壁纸逻辑与 Anime 页共用 useWallpaper 管理器（同一缓存键、同一随机选择），
// 组件挂载即持有壁纸，卸载（退出内部模式）即释放。
// 壁纸是否显示按身份控制（设置 → 网站壁纸，管理员恒可见）。
import { onMounted, onUnmounted, ref } from 'vue'
import { acquireWallpaper } from '../composables/useWallpaper'
import { useAuth } from '../composables/useAuth'
import { useSettings } from '../composables/useSettings'

const auth = useAuth()
const settings = useSettings()
const holder = ref(null)

onMounted(async () => {
  // 壁纸列表与身份设置互不依赖，并行拉取；壁纸管理器内部自己请求 /api/wallpapers。
  // 但「是否显示壁纸」要先知道设置，所以这里仍等设置返回（已有缓存时不发请求）。
  const setting = settings.load()
  // 先按「已加载的设置」快速判断，避免多等一个网络往返；设置到达后再复核
  if (settings.wallpaper.value && settings.canSeeWallpaper(auth.isLoggedIn.value, auth.isInsider.value)) {
    holder.value = acquireWallpaper()
  }
  await setting
  const allowed = settings.canSeeWallpaper(auth.isLoggedIn.value, auth.isInsider.value)
  if (allowed && !holder.value) holder.value = acquireWallpaper()
  else if (!allowed && holder.value) {
    holder.value.release()
    holder.value = null
  }
})
onUnmounted(() => holder.value?.release())
</script>

<template>
  <!-- 壁纸已通过 --wallpaper-url 应用到 <body>，本组件仅作为持有者，无需渲染内容 -->
  <div class="bg-insider" aria-hidden="true"></div>
</template>

<style scoped>
.bg-insider {
  display: none;
}
</style>
