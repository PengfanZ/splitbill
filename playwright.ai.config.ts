import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4174/splitbill/'

export default defineConfig({
  testDir: './e2e-ai',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report-ai' }]]
    : 'line',
  use: {
    baseURL,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npm run build:pages && npm run preview -- --host 127.0.0.1 --port 4174 --base=/splitbill/',
    env: {
      ...process.env,
      VITE_AI_EXPENSE_ENABLED: 'true',
      VITE_SUPABASE_URL: 'https://live-sharing.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
