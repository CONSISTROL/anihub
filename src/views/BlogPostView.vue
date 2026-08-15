<script setup>
// 博客文章详情页
import PostDetail from '../components/PostDetail.vue'

defineProps({ slug: { type: String, required: true } })
</script>

<template>
  <PostDetail category="blog" :slug="slug" />
</template>
