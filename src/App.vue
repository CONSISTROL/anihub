<script setup>
// 全局布局壳：导航栏 + 页面内容
import NavBar from './components/NavBar.vue'
</script>

<template>
  <div class="app-shell">
    <NavBar />
    <router-view />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
</style>
