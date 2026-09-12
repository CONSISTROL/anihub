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
</script>

<template>
  <div class="wallpaper-layer" aria-hidden="true"></div>
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
</style>
