<script setup>
// HTTP 错误码页面：仅展示 public/http_status_code/ 下的错误码插画（图内自带码数说明）。
// 用于：游客访问需登录的页面（401）、未知路径（404）等。
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

// 合法错误码集合（对应 public/http_status_code/ 下的图片）；非法时回退 404
const CODES = new Set([400, 401, 403, 404, 500, 502, 503, 504])

const code = computed(() => {
  const c = Number(route.params.code)
  return CODES.has(c) ? c : 404
})
const imgSrc = computed(() => `/http_status_code/${code.value}.png`)
</script>

<template>
  <div class="error-page">
    <img :src="imgSrc" class="error-img" :alt="`HTTP ${code}`" />
  </div>
</template>

<style scoped>
.error-page {
  min-height: calc(100vh - 48px); /* 占满视口剩余高度，让插图尽量大 */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 20px 60px;
}

.error-img {
  max-width: min(70vw, 400px);
  width: 100%;
  border-radius: 16px;
  box-shadow: 0 10px 28px rgb(0 0 0 / 0.16);
}
</style>
