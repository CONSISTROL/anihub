<script setup>
// HTTP 错误码页面：仅展示 public/http_status_code/ 下的错误码插画（图内自带码数说明）。
// 用于：游客访问需登录的页面（401）、未知路径（404）等。
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { visitedSiteBefore } from '../tabVisit'
import AppIcon from '../components/AppIcon.vue'

const route = useRoute()
const router = useRouter()

// 合法错误码集合（对应 public/http_status_code/ 下的图片）；非法时回退 404
const CODES = new Set([400, 401, 403, 404, 500, 502, 503, 504])

const code = computed(() => {
  const c = Number(route.params.code)
  return CODES.has(c) ? c : 404
})
// 插画已优化为 WebP（见 scripts/optimize-assets.mjs）
const imgSrc = computed(() => `/http_status_code/${code.value}.webp`)

// 加载失败时给一句可读的提示，避免只剩一个破图图标
function onImgError(e) {
  e.target.style.display = 'none'
  e.target.parentElement?.classList.add('img-missing')
}

/* 出口按钮：有**本站**上一页就回上一页，没有就直接回首页（不把用户带出站外）。
   三条判据按可靠度从高到低：
     ① 站内 SPA 跳转 —— router 自己维护的 history.state.back 有值就说明上一条是本站路由；
     ② 整页跳转过来的 —— document.referrer 同源（从外站进来、或地址栏敲进来时都不是）；
     ③ 兜底：本标签页此前打开过本站（见 tabVisit.js）。地址栏直接敲一个错误地址时
        ①②都不成立，但历史里明明还留着本站上一条记录 —— 只看前两条会把用户误送回首页。
   ⚠ 不要用 window.history.length：那是整个标签页的历史长度（含其它站点、前进记录、
     iframe），拿它当"有本站上一页"会把人带出站外。 */
function hasInSitePrev() {
  if (router.options.history.state?.back) return true
  try {
    if (document.referrer && new URL(document.referrer).origin === location.origin) return true
  } catch {
    // referrer 不是合法 URL：忽略这一条
  }
  return visitedSiteBefore
}

const canGoBack = ref(false)
// 在 onMounted 里读：挂载完成时本条历史记录一定已写入，读到的是稳定值
onMounted(() => {
  canGoBack.value = hasInSitePrev()
})

function goBack() {
  // 以点击当时为准再判一次，避免用到挂载时的旧值
  if (hasInSitePrev()) router.back()
  else router.push('/')
}
</script>

<template>
  <div class="error-page">
    <img
      :src="imgSrc"
      class="error-img"
      :alt="`HTTP ${code}`"
      width="433"
      height="401"
      decoding="async"
      @error="onImgError"
    />
    <p class="error-code" aria-hidden="true">HTTP {{ code }}</p>
    <!-- 错误页是死胡同：给一个明确的出口（有上一页就回上一页，见 goBack） -->
    <button class="btn error-home" type="button" @click="goBack">
      <AppIcon name="arrow-right" :size="14" :stroke-width="2" />
      {{ canGoBack ? '返回上一页' : '返回首页' }}
    </button>
  </div>
</template>

<style scoped>
.error-page {
  /* 占满视口剩余高度，让插图尽量大；--nav-h 由 NavBar 实时测量（导航折行时也准） */
  min-height: calc(100vh - var(--nav-h, 54px));
  min-height: calc(100dvh - var(--nav-h, 54px));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 24px 20px 60px;
}

/* ⚠ 插画上不要加圆角 / 阴影 / 描边一类的"相框"：这组 webp 本身是带透明底的完整
   插画，在壁纸上直接放即可；加了一圈投影 + 圆角后看着像贴了张卡片（用户反馈
   "图片外面有一圈框的阴影"）。这里只管尺寸。 */
.error-img {
  max-width: min(70vw, 400px);
  height: auto;
}

/* 插画加载失败时的兜底文案（图片本身也含码数，这里保证仍有信息量） */
.error-code {
  display: none;
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--muted);
}

.img-missing .error-code {
  display: block;
}

.error-home {
  gap: 6px;
}

.error-home :deep(.app-icon) {
  transform: rotate(180deg); /* arrow-right 转成「返回」方向 */
}
</style>
