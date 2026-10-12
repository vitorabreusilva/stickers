/// <reference types="vitest/config" />
import { statSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Set BASE_PATH when hosting under a sub-path, e.g. BASE_PATH=/stickers/ for GitHub Pages.
const base = process.env.BASE_PATH ?? '/'

// Background-removal model, downloaded into public/ by scripts/fetch-model.mjs (keep the name in sync).
const CUTOUT_MODEL = 'models/magic-touch-v2-int8-1.task'
const CUTOUT_WASM = 'node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm'
const fileSize = (path: string) => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export default defineConfig({
  base,
  define: {
    __CUTOUT_MODEL__: JSON.stringify(CUTOUT_MODEL),
    __CUTOUT_BYTES__: fileSize(`public/${CUTOUT_MODEL}`) + fileSize(CUTOUT_WASM),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        id: base,
        name: 'Stickers',
        short_name: 'Stickers',
        description: 'Turn anything you see online into a sticker. Circle it, cut it, collect it.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fff6ec',
        theme_color: '#fff6ec',
        categories: ['photo', 'entertainment', 'lifestyle'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Lets the installed app show up in the Android share sheet for images.
        share_target: {
          action: 'share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'image', accept: ['image/*'] }],
          },
        },
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
