import { defineConfig } from '@playwright/test'
import baseConfig from './playwright.config'

const baseURL = 'http://127.0.0.1:4175/splitbill/'

export default defineConfig({
  ...baseConfig,
  testDir: './e2e-analytics',
  use: { ...baseConfig.use, baseURL },
  webServer: {
    command: 'npm run build:pages && npm run preview -- --host 127.0.0.1 --port 4175 --base=/splitbill/',
    env: {
      ...process.env,
      VITE_GA_MEASUREMENT_ID: 'G-TEST12345',
      VITE_SUPABASE_URL: 'https://live-sharing.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
      TALLY_INCLUDE_DEV_CSP: 'true',
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
