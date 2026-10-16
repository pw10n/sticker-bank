import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Serves MSW's service worker script in `mock` mode only; it must never be part of a production build. */
function mockServiceWorker(): Plugin {
  return {
    name: 'sticker-bank-mock-service-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/mockServiceWorker.js', (_req, res) => {
        const file = resolve(process.cwd(), 'node_modules/msw/lib/mockServiceWorker.js')
        res.setHeader('Content-Type', 'text/javascript')
        res.end(readFileSync(file))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        devOptions: { enabled: false },
        includeAssets: ['icons/apple-touch-icon.png', 'licenses/*'],
        manifest: {
          name: 'Sticker Bank',
          short_name: 'Stickers',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          theme_color: '#FFB703',
          background_color: '#FFF8E7',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,woff,woff2,webp,png,svg,ico,txt}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/actuator\//],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [],
        },
      }),
      ...(mode === 'mock' ? [mockServiceWorker()] : []),
    ],
    server: {
      proxy:
        mode === 'mock'
          ? undefined
          : { '/api': { target: env.API_PROXY_TARGET ?? 'http://localhost:8080', changeOrigin: false } },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  }
})
