import { defineConfig, devices } from '@playwright/test'

const port = 4173

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://localhost:${port}`,
    // Point at a preinstalled Chromium when Playwright's own download isn't available.
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    // The API runs inside the preview server (see vite.config.ts); e2e/sync.spec.ts signs in as this person.
    env: { BETTER_AUTH_URL: `http://localhost:${port}`, ALLOWED_EMAILS: 'e2e@stickers.test' },
  },
})
