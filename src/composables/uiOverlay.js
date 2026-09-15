// 全局浮动 UI 覆盖层状态
// Wiki 拓扑图等「沉浸式整页视图」激活时置 true：
// 页面不是常规文档流（内容高度≈视口），回到底部/回到顶部等滚动跳转按钮不再有意义，
// 由各浮动按钮组件观察本标志自行隐藏。
import { ref } from 'vue'

export const immersiveView = ref(false)

// 星座连线是否显形（网页内虚拟键盘输入 `Stella` 切换；深色主题的主页才能看到）。
// 默认 false —— 星空平时只有星点，看不出"星座"。
// 不写 localStorage：这是"看一眼"的临时效果，不该跨会话记住。
export const constellationLines = ref(false)

/** 切换星座连线显形；返回切换后的状态。 */
export function toggleConstellationLines() {
  constellationLines.value = !constellationLines.value
  return constellationLines.value
}
