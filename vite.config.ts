import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

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

/**
 * Open Graph needs absolute URLs. SITE_URL wins; on Vercel the production domain is used;
 * locally the tags fall back to root-relative paths.
 */
function siteUrl(): Plugin {
  const url = (
    process.env.SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
  ).replace(/\/$/, '')
  return { name: 'site-url', transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', url) }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), siteUrl()],
  server: { proxy: catalogProxy },
  preview: { proxy: catalogProxy },
})
