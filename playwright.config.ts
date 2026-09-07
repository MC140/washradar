import {defineConfig, devices} from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    geolocation: {latitude: 43.5837, longitude: -79.7591},
    permissions: ['geolocation'],
  },
  webServer: {command: 'npm run dev', url: 'http://127.0.0.1:4173', reuseExistingServer: true},
  projects: [{name: 'mobile-chrome', use: {...devices['Pixel 7']}}, {name: 'desktop-chrome', use: {...devices['Desktop Chrome']}}],
});
