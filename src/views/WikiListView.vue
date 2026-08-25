<script setup>
// Wiki 条目列表页
import PostList from '../components/PostList.vue'
</script>

<template>
  <div class="page">
    <h1 class="page-title">📚 Wiki</h1>
    <PostList category="wiki" />
  </div>
</template>

<style scoped>
.page {
  /* 高分辨率适配：随视口变宽，上限 1280px */
  max-width: min(1280px, 95vw);
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  margin: 0 0 18px;
  font-size: 24px;
}
</style>
