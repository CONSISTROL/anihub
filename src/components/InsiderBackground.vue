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
  await settings.load() // 确保身份相关设置已加载
  const allowed = settings.canSeeWallpaper(auth.isLoggedIn.value, auth.isInsider.value)
  if (allowed) holder.value = acquireWallpaper()
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
