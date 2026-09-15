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
// ⚠ 本组件**不再有任何 prop / 状态**（曾经有个 `on` 用来判断"是否在主页"）：
//   主页以前在浅色主题下要压成深空底，现在按用户要求恢复成与 anime 一样的正常明亮背景，
//   于是"主页特殊化"这件事整体消失 —— 各页面共用同一套壁纸取值。
//   深空底只剩 wiki 拓扑图一处，由 `:root[data-deep]`（路由驱动）负责，见下方 CSS。
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

/* 浅色主题：壁纸稍淡（约透出 28%），避免浅色底 + 强壁纸对比过高。
   主页与 anime 等页面**走的是同一条规则** —— 浅色主题下主页不再是深空底。 */
:root[data-theme='light'] .wallpaper-layer {
  background-image:
    linear-gradient(
      color-mix(in srgb, var(--bg) 72%, transparent),
      color-mix(in srgb, var(--bg) 72%, transparent)
    ),
    var(--wallpaper-url, none);
}

/* 深空底页面（现在只有 **wiki 拓扑图**）：**套用深色主题的取值**，让两个主题的深空底完全一致。
   ⚠ 这里刻意把深色主题那一对数值（底色 #0e1015、遮罩 62%）**写死**，
     而不是引用 var(--bg)：浅色主题下 var(--bg) 是 #f2f4f9，用它做遮罩只会更白。
   若以后调整深色主题的壁纸遮罩，这里要同步改（两处必须一致）。

   ⚠⚠ 条件必须用 `:root[data-deep]`（路由驱动），**不能**用"某个页面元素在场"：
   这一层 `background-color: var(--bg)` 是**不透明的**，且位于 `body` 之上 ——
   所以它会**盖住 body 的底色**。用户报的"wiki 处于拓扑图模式时，从主页切过来刚开始的背景是浅色的"
   根因就在这里：把 body 压暗（`:root[data-deep] body`）根本没用，因为壁纸层盖在它上面；
   而当时用的 `.is-home` 在离开主页的瞬间就没了，于是过渡期间露出的是**浅色主题的壁纸**
   （实测 `bg = rgb(242,244,249)`、`opacity = 1`，而同期 `body` 已经是深空色）。
   换成 `data-deep` 后，只要路由是"深空底页面"，本层在**导航确认的那一刻**就变深，
   整个过渡期间都是深空底 —— 与 `body`、与 wiki 的 `.graph-sky` 三者同色，衔接无台阶。 */
:root[data-deep] .wallpaper-layer {
  background-color: #0e1015;
  background-image:
    linear-gradient(rgb(14 16 21 / 0.62), rgb(14 16 21 / 0.62)),
    var(--wallpaper-url, none);
}
</style>
