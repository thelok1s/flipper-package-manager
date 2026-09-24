import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The Flipper app catalog only sends CORS headers for lab.flipper.net,
// so the browser reaches it through this same-origin proxy.
const catalogProxy = {
  '/catalog-api': {
    target: 'https://catalog.flipperzero.one',
    changeOrigin: true,
    secure: true,
    rewrite: (p: string) => p.replace(/^\/catalog-api/, '/api/v0'),
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: catalogProxy },
  preview: { proxy: catalogProxy },
})
