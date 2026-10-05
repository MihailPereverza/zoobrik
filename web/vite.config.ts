import path from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { deckApi } from './server/deckApi.ts';

const root = path.resolve(import.meta.dirname, '..');

const build = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  define: { __BUILD__: JSON.stringify(build) },
  base: process.env.ZOOBRIK_BASE ?? '/',
  plugins: [
    svelte(),
    deckApi({
      deckDir: path.resolve(process.env.ZOOBRIK_DECK ?? path.join(root, 'decks/english-notebook')),
      coreDir: path.join(root, 'core-templates'),
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Zoobrik',
        short_name: 'Zoobrik',
        description: 'Английские слова и грамматика с интервальными повторениями',
        lang: 'ru',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F4F5F7',
        theme_color: '#F4F5F7',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/deck\//],
        runtimeCaching: [
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, handler: 'CacheFirst', options: { cacheName: 'fonts', expiration: { maxEntries: 30, maxAgeSeconds: 31536000 } } },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, fs: { allow: [root] } },
});
