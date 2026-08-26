<script setup>
// 博客列表页
import PostList from '../components/PostList.vue'
</script>

<template>
  <div class="page">
    <h1 class="page-title">📝 Blog</h1>
    <PostList category="blog" />
  </div>
</template>

<style scoped>
.page {
  max-width: min(1320px, 95vw); /* 高分辨率适配 */
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  margin: 0 0 18px;
  font-size: 24px;
}
</style>
