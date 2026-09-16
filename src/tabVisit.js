// 「本标签页此前打开过本站吗」—— 错误页判断能不能"回上一页"时的兜底判据。
//
// 为什么需要它：错误页要回上一页，但**"浏览器里上一条历史记录是不是本站页面"没有任何
// API 能查**。能精确判断的只有两种：
//   ① 站内 SPA 跳转 —— router 自己记了 history.state.back
//   ② 整页跳转过来的 —— document.referrer 同源
// 用户在地址栏直接敲一个错误地址时两条都不成立：实测「先开 /wiki/，再敲 /wiki/404」，
// referrer 为空、back 为 null（PostDetail 是用 router.replace 转过去的，不写 back），
// 于是只能判断成"没有上一页"、把用户送回首页 —— 可上一条记录明明就是 /wiki/。
// 这时只能靠本标记兜底：本标签页既然打开过本站，历史里就一定有它的记录。
//
// ⚠ 必须由 main.js 在**启动时**引入：读要在任何写入之前发生 ——
//   写完的值代表"这个文档"，读到的值才代表"上一个文档"。
// ⚠ 代价：先去别的站点、再回来敲地址（或从外站链接进来）时标记仍为真，返回会离开本站。
//   这与浏览器自带返回键的行为一致，比"一律回首页"更接近预期。
const KEY = 'anihub:tab-visited'

/** 上一个文档是否也在本站（模块载入那一刻取值，之后不再变） */
export const visitedSiteBefore = (() => {
  try {
    const before = sessionStorage.getItem(KEY) === '1'
    sessionStorage.setItem(KEY, '1')
    return before
  } catch {
    // 无痕模式 / 禁用 storage：保守当成"没访问过"，那就回首页
    return false
  }
})()
