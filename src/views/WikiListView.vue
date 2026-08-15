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
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  margin: 0 0 18px;
  font-size: 24px;
}
</style>
