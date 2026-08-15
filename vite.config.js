import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      // dev 模式下 /api 转发到后端（生产由 Express 直接托管 dist/，无需代理）
      '/api': 'http://localhost:3001',
    },
  },
})
