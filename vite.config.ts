import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { resolveSupabaseConnectOrigin } from './src/security/contentSecurityPolicy'

const appDescription = 'Split group expenses fairly for free—no account required, with optional live collaboration.'

function contentSecurityPolicyPlugin(supabaseUrl?: string): Plugin {
  const supabaseOrigin = resolveSupabaseConnectOrigin(supabaseUrl)
  return {
    name: 'tally-content-security-policy',
    transformIndexHtml: html => html.replaceAll('__TALLY_SUPABASE_ORIGIN__', supabaseOrigin),
  }
}

export default defineConfig(({ mode }) => {
  const fileEnvironment = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? fileEnvironment.VITE_SUPABASE_URL

  return {
    plugins: [
      contentSecurityPolicyPlugin(supabaseUrl),
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
          name: 'Tally — Group expense splitter',
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
  }
})
