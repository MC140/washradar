import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './release-tests',
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  expect: {timeout: 10_000},
  use: {
    baseURL: 'https://washradar.ca',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    geolocation: {latitude: 43.5837, longitude: -79.7591},
    permissions: ['geolocation'],
  },
  projects: [
    {name: 'mobile-chrome', use: {...devices['Pixel 7']}},
    {name: 'desktop-chrome', use: {...devices['Desktop Chrome']}},
  ],
});
