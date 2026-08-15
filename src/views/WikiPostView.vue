<script setup>
// Wiki 条目详情页
import PostDetail from '../components/PostDetail.vue'

defineProps({ slug: { type: String, required: true } })
</script>

<template>
  <PostDetail category="wiki" :slug="slug" />
</template>
