import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // dev 模式下 /api 与上传图片转发到后端（生产由 Express 直接托管，无需代理）
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
      // 控制台 WebSocket 实时输出
      '/ws': { target: 'http://localhost:3001', ws: true },
    },
    watch: {
      // Windows 下文件监听偶发失效（编辑器原子写入不触发事件，导致 HMR 与重新编译
      // 拿到旧版本），改用轮询确保源码改动总能被检测到
      usePolling: true,
      interval: 300,
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 分包：富文本编辑器（TipTap/ProseMirror）与 Markdown 渲染各自独立成块，主包更小、缓存更优
        manualChunks(id) {
          // Vue 全家桶单独成块，避免被卷入 editor 等特性 chunk，导致首屏加载整个编辑器
          if (
            id.includes('node_modules/vue') ||
            id.includes('node_modules/@vue') ||
            id.includes('node_modules/vue-router')
          ) {
            return 'vue-vendor'
          }
          if (id.includes('node_modules/@tiptap') || id.includes('node_modules/prosemirror')) return 'editor'
          if (
            id.includes('node_modules/marked') ||
            id.includes('node_modules/dompurify') ||
            id.includes('node_modules/turndown') ||
            id.includes('node_modules/domino')
          ) {
            return 'markdown'
          }
        },
      },
    },
  },
})
