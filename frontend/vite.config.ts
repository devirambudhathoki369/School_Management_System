import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev-only: forward API calls to the Django dev server so the app works
// without CORS friction and cookies stay same-origin. Override with
// API_PROXY when :8000 is taken (e.g. API_PROXY=http://127.0.0.1:8001).
const apiProxy = process.env.API_PROXY ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': apiProxy,
      '/health': apiProxy,
      '/media': apiProxy,
    },
  },
})
