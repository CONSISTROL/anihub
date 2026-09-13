<script setup>
// 全站壁纸图层（纯展示，不持有壁纸生命周期）
//
// 为什么单独做一个图层，而不是继续用 body::before：
// 导航栏要做「毛玻璃」，毛玻璃的观感来自 backdrop-filter 对**身后真实内容**的模糊。
// body::before 位于 body 背景层、且在 .app-shell 的层叠上下文之下，
// 导航栏的 backdrop-filter 只能看到 .app-shell 的不透明底色 —— 模糊出来是一片纯色，
// 玻璃感完全出不来。把壁纸搬进 .app-shell 的专用图层（z-index: -1）后：
//   · 壁纸仍在所有内容之下（.app-shell 内的流动内容与定位元素都会盖住它）
//   · 导航栏能看到它，于是 blur 出真正的壁纸色彩与明暗
// 图层本身固定在视口（桌面观感与原来的 background-attachment: fixed 一致），
// 不参与滚动重绘。
//
// 壁纸 URL 由 useWallpaper 管理器 / index.html 内联脚本写在 <html> 的 --wallpaper-url 上，
// 这里只需消费它；是否显示壁纸由 InsiderBackground / AnimeBackground 决定。
//
// on: 是否在主页。**浅色主题的主页背景要与深色主题完全一致**（用户要求）——
//     所以 `.is-home` 那组规则在浅色下直接套用深色主题的取值。
//     主页整屏都是背景（还叠着星座粒子），深空底才能让星点与光点立住。
//     其它页面内容多、需要浅底保证文字可读，一律不动。
//
// ⚠ 这里必须给 <html> 打一个 `data-home-deep` 标记：ConstellationField 是
//   canvas 绘制，读不到 CSS 变量，它要靠这个标记知道"当前虽然 data-theme=light、
//   但主页是深空底"，从而切换成深色那套星点配色。
//   （canvas 每帧都会读它，所以主题切换 / 进出主页时改这一个属性就够了。）
import { computed, onBeforeUnmount, watchEffect } from 'vue'

const props = defineProps({
  on: { type: Boolean, default: false },
})

// 浅色主题 + 主页 = 深空底
const deepHome = computed(
  () => props.on && typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light'
)

let mo = null
function syncMarker() {
  const root = document.documentElement
  if (deepHome.value) root.dataset.homeDeep = '1'
  else delete root.dataset.homeDeep
}

watchEffect(() => {
  syncMarker()
  // 主题是在 <html data-theme> 上切的，属性变化不会触发 Vue 更新，
  // 所以这里观察一下 —— 否则在浅色主页上手动切主题时，标记会停在旧值。
  if (typeof MutationObserver === 'undefined' || mo) return
  mo = new MutationObserver(() => syncMarker())
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onBeforeUnmount(() => {
  if (mo) mo.disconnect()
  delete document.documentElement.dataset.homeDeep
})
</script>

<template>
  <div class="wallpaper-layer" :class="{ 'is-home': props.on }" aria-hidden="true"></div>
</template>

<style scoped>
.wallpaper-layer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  z-index: -1; /* 位于 .app-shell 内所有内容之下 */
  pointer-events: none;
  background-color: var(--bg);
  /* 同色半透明遮罩只保留少量底色以保证文字可读，壁纸约透出 38%（浅色主题更淡） */
  background-image:
    linear-gradient(
      color-mix(in srgb, var(--bg) 62%, transparent),
      color-mix(in srgb, var(--bg) 62%, transparent)
    ),
    var(--wallpaper-url, none);
  background-size: cover;
  background-position: center calc(50% + var(--wp-shift, 0px));
  background-repeat: no-repeat;
  transition: background-image var(--dur-ios-3) var(--ease-ios);
}

/* 浅色主题：壁纸稍淡（约透出 28%），避免浅色底 + 强壁纸对比过高 */
:root[data-theme='light'] .wallpaper-layer {
  background-image:
    linear-gradient(
      color-mix(in srgb, var(--bg) 72%, transparent),
      color-mix(in srgb, var(--bg) 72%, transparent)
    ),
    var(--wallpaper-url, none);
}

/* 浅色主题 + 主页：**套用深色主题的取值**，让两个主题的主页背景完全一致。
   ⚠ 这里刻意把深色主题那一对数值（底色 62%、底色 #0e1015）**写死**，
     而不是引用 var(--bg)：浅色主题下 var(--bg) 是 #f2f4f9，用它做遮罩只会更白。
   若以后调整深色主题的壁纸遮罩，这里要同步改（两处必须一致）。 */
:root[data-theme='light'] .wallpaper-layer.is-home {
  background-color: #0e1015;
  background-image:
    linear-gradient(rgb(14 16 21 / 0.62), rgb(14 16 21 / 0.62)),
    var(--wallpaper-url, none);
}
</style>
