import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const appDescription = 'Tally makes shared expenses simple.'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: 'script-defer',
      includeAssets: ['favicon.svg'],
      pwaAssets: {
        image: 'public/favicon.svg',
        preset: 'minimal-2023',
        includeHtmlHeadLinks: true,
        injectThemeColor: false,
      },
      manifest: {
        id: './',
        name: 'Tally — Shared expenses, settled',
        short_name: 'Tally',
        description: appDescription,
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f7f4ee',
        theme_color: '#f7f4ee',
        categories: ['finance', 'productivity'],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        globIgnores: ['og.png'],
      },
    }),
  ],
  server: {
    port: 3000,
  },
})
