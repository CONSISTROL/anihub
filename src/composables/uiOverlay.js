// 全局浮动 UI 覆盖层状态
// Wiki 拓扑图等「沉浸式整页视图」激活时置 true：
// 页面不是常规文档流（内容高度≈视口），回到底部/回到顶部等滚动跳转按钮不再有意义，
// 由各浮动按钮组件观察本标志自行隐藏。
import { ref } from 'vue'

export const immersiveView = ref(false)
