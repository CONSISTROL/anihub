<script setup>
// 工具箱首页：列出各子工具，点击进入二级页面
import AppIcon from '../components/AppIcon.vue'

const TOOLS = [
  {
    to: '/tools/json',
    icon: 'braces',
    title: 'JSON 格式化',
    desc: '格式化 / 压缩标准 JSON；也能识别类 JSON 的文本（key = value、0x 十六进制、嵌套 {} 的结构体转储等）并转为 JSON。',
  },
  {
    to: '/tools/qr',
    icon: 'qrcode',
    title: '二维码解析',
    desc: '点击选择 / 拖拽 / Ctrl+V 粘贴二维码图片，提取其中的链接或文本。纯前端解析，图片不会上传。',
  },
  {
    to: '/tools/crop',
    icon: 'scissors',
    title: '图片裁切',
    desc: '上传版图（多格图 / 精灵图），自动识别框线或拖动网格线划分格子，裁切成一张张小图，可打包 zip 下载。纯前端处理。',
  },
  {
    to: '/tools/splice',
    icon: 'grid',
    title: '图片拼接',
    desc: '把多张图片拼成一张：横向 / 纵向 / 网格，可调顺序、间距、对齐与背景色，导出 PNG。纯前端处理。',
  },
  {
    to: '/tools/html-render',
    icon: 'code',
    title: 'HTML 渲染',
    desc: '粘贴 HTML 代码，一键在新标签页中原样渲染（样式与脚本都生效）；完整文档或片段均可。纯前端处理。',
  },
  {
    to: '/tools/qr-tree',
    icon: 'tree',
    title: '二维码生成',
    desc: '输入 URL，生成 3D 二维码体素树；点击场景可在 3D 树和俯视二维码草坪之间切换。',
  },
  {
    to: '/tools/compare',
    icon: 'diff',
    title: '文件对比',
    desc: '文本逐行对比（双栏高亮、跳转差异）+ 文件夹对比（相同/不同/仅左/仅右，点击差异文件直接看文本 diff）。纯前端处理。',
  },
]
</script>

<template>
  <div class="tools-page">
    <h1 class="page-title"><AppIcon name="wrench" :size="22" /> Tools 工具箱</h1>
    <p class="sub">小工具集合，选择一项开始</p>

    <div class="tools-grid">
      <router-link
        v-for="(t, i) in TOOLS"
        :key="t.to"
        :to="t.to"
        class="tool-card"
        :style="{ '--i': i }"
      >
        <span class="tool-icon"><AppIcon :name="t.icon" :size="26" /></span>
        <h2 class="tool-title">{{ t.title }}</h2>
        <p class="tool-desc">{{ t.desc }}</p>
        <span class="tool-go">进入 <AppIcon name="arrow-right" :size="14" /></span>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.tools-page {
  max-width: min(1160px, 95vw); /* 高分辨率适配 */
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 8px;
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
  transition:
    transform var(--dur-ios-2) var(--ease-ios-spring),
    border-color var(--dur-ios-2) var(--ease-ios-expo),
    box-shadow var(--dur-ios-2) var(--ease-ios-expo);
  animation: ios-rise-in var(--dur-ios-3) var(--ease-ios-expo)
    calc(120ms + var(--i, 0) * 60ms) backwards;
  will-change: transform;
}

.tool-card:hover {
  transform: translateY(-4px) scale(1.012);
  border-color: var(--accent);
  box-shadow: 0 14px 36px rgb(0 0 0 / 0.14);
}

.tool-card:active {
  transform: translateY(-1px) scale(0.985);
  transition-duration: 70ms;
  transition-timing-function: var(--ease-ios);
}

.tool-icon {
  display: flex;
  align-items: center;
  width: 26px;
  height: 26px;
  color: var(--accent);
  transition: transform var(--dur-ios-2) var(--ease-ios-spring);
}

.tool-card:hover .tool-icon {
  transform: scale(1.12) rotate(-3deg);
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
}
</style>
