<script setup>
// 工具箱首页：列出各子工具，点击进入二级页面
const TOOLS = [
  {
    to: '/tools/json',
    icon: '🧾',
    title: 'JSON 格式化',
    desc: '格式化 / 压缩标准 JSON；也能识别类 JSON 的文本（key = value、0x 十六进制、嵌套 {} 的结构体转储等）并转为 JSON。',
  },
  {
    to: '/tools/qr',
    icon: '🔗',
    title: '二维码解析',
    desc: '点击选择 / 拖拽 / Ctrl+V 粘贴二维码图片，提取其中的链接或文本。纯前端解析，图片不会上传。',
  },
  {
    to: '/tools/crop',
    icon: '✂️',
    title: '图片裁切',
    desc: '上传版图（多格图 / 精灵图），拖动网格线划分格子，裁切成一张张小图，可打包 zip 下载。纯前端处理。',
  },
]
</script>

<template>
  <div class="tools-page">
    <h1 class="page-title">Tools 工具箱</h1>
    <p class="sub">小工具集合，选择一项开始</p>

    <div class="tools-grid">
      <router-link v-for="t in TOOLS" :key="t.to" :to="t.to" class="tool-card">
        <span class="tool-icon">{{ t.icon }}</span>
        <h2 class="tool-title">{{ t.title }}</h2>
        <p class="tool-desc">{{ t.desc }}</p>
        <span class="tool-go">进入 →</span>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.tools-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  margin: 0 0 6px;
  font-size: 24px;
}

.sub {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--muted);
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
}

.tool-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 24px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  text-decoration: none;
  color: var(--text);
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
}

.tool-card:hover {
  transform: translateY(-3px);
  border-color: var(--accent);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.12);
}

.tool-icon {
  font-size: 30px;
}

.tool-title {
  margin: 0;
  font-size: 18px;
}

.tool-desc {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
  flex: 1;
}

.tool-go {
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
}
</style>
