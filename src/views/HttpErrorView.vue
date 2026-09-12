<script setup>
// HTTP 错误码页面：仅展示 public/http_status_code/ 下的错误码插画（图内自带码数说明）。
// 用于：游客访问需登录的页面（401）、未知路径（404）等。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
    <!-- 错误页是死胡同：给一个明确的回首页出口 -->
    <button class="btn error-home" type="button" @click="router.push('/')">
      <AppIcon name="arrow-right" :size="14" :stroke-width="2" /> 返回首页
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

.error-img {
  max-width: min(70vw, 400px);
  height: auto;
  border-radius: 16px;
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.16);
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
