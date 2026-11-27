import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'release-production.spec.ts',
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: {timeout: 20_000},
  reporter: [
    ['list'],
    ['html', {outputFolder: 'playwright-report-production', open: 'never'}],
  ],
  outputDir: 'test-results-production',
  use: {
    baseURL: process.env.PROD_BASE_URL || 'https://washradar.ca',
    trace: 'on',
    screenshot: 'on',
    geolocation: {latitude: 43.5890, longitude: -79.6441},
    permissions: ['geolocation'],
    serviceWorkers: 'allow',
  },
  projects: [
    {name: 'production-mobile-chrome', use: {...devices['Pixel 7']}},
    {name: 'production-desktop-chrome', use: {...devices['Desktop Chrome']}},
  ],
});
