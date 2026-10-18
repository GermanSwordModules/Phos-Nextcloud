// Smoke test of the web frontend against the dev container:
//   dev/compose.sh up && npm run build && npm run smoke
// PHOS_URL (default http://127.0.0.1:8090), PHOS_ADMIN/PHOS_ADMIN_PW,
// CHROMIUM (default /usr/bin/chromium; no browser download needed).
import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: '.',
	timeout: 120000,
	workers: 1,
	globalSetup: './global-setup.js',
	use: {
		baseURL: process.env.PHOS_URL || 'http://127.0.0.1:8090',
		locale: 'de-DE',
		viewport: { width: 1400, height: 900 },
		launchOptions: { executablePath: process.env.CHROMIUM || '/usr/bin/chromium' },
		screenshot: 'only-on-failure',
		actionTimeout: 15000,
	},
	outputDir: '../../.playwright-results',
})
