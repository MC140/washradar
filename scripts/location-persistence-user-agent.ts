import {chromium, devices} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

const BASE_URL = (process.env.WASHRADAR_URL || 'https://washradar.ca').replace(/\/$/, '');
const RESULTS_DIR = process.env.SYNTHETIC_RESULTS_DIR || 'synthetic-user-results';
const MISSISSAUGA = {latitude: 43.5837, longitude: -79.7591};
const STORAGE_KEY = 'wr-selected-location-v2';

async function clickIntro(page: import('@playwright/test').Page, action: 'Use my location' | 'Search manually') {
  const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', {name: action}).dispatchEvent('click');
  }
}

async function main() {
  await mkdir(RESULTS_DIR, {recursive: true});
  const browser = await chromium.launch({headless: true});

  try {
    const gpsContext = await browser.newContext({
      ...devices['Pixel 7'],
      geolocation: MISSISSAUGA,
      permissions: ['geolocation'],
      locale: 'en-CA',
      timezoneId: 'America/Toronto',
    });
    const gpsPage = await gpsContext.newPage();
    await gpsPage.goto(`${BASE_URL}/`, {waitUntil: 'domcontentloaded', timeout: 30_000});
    await clickIntro(gpsPage, 'Use my location');
    await gpsPage.locator('.wash-card').first().waitFor({state: 'visible', timeout: 15_000});

    const storedGps = await gpsPage.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), STORAGE_KEY);
    if (!storedGps || storedGps.source !== 'gps') throw new Error('GPS browsing origin was not persisted.');
    if (typeof storedGps?.point?.lat !== 'number' || typeof storedGps?.point?.lng !== 'number') throw new Error('Persisted GPS origin is missing coordinates.');

    // Remove geolocation permission before reload. The restored browsing area must still
    // produce results without asking the browser for location again.
    await gpsContext.clearPermissions();
    await gpsPage.reload({waitUntil: 'domcontentloaded'});
    await gpsPage.locator('.wash-card').first().waitFor({state: 'visible', timeout: 15_000});
    if (await gpsPage.getByRole('dialog', {name: 'Find the best wash near you'}).isVisible().catch(() => false)) {
      throw new Error('Location introduction reappeared after a saved GPS location was restored.');
    }
    const locationButton = (await gpsPage.locator('.location-button').innerText()).replace(/\s+/g, ' ').trim();
    if (!/Last location/i.test(locationButton)) throw new Error(`Restored GPS location was not labelled as saved/last location: ${locationButton}`);
    await gpsPage.screenshot({path: `${RESULTS_DIR}/location-persistence-gps.png`, fullPage: true});
    await gpsContext.close();

    const manualContext = await browser.newContext({...devices['Pixel 7'], locale: 'en-CA', timezoneId: 'America/Toronto'});
    const manualPage = await manualContext.newPage();
    await manualPage.goto(`${BASE_URL}/`, {waitUntil: 'domcontentloaded', timeout: 30_000});
    await clickIntro(manualPage, 'Search manually');
    const search = manualPage.getByPlaceholder('Search city, postal code or address');
    await search.fill('M1X 1S7');
    await search.press('Enter');
    await manualPage.locator('.wash-card').first().waitFor({state: 'visible', timeout: 15_000});
    const storedManual = await manualPage.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), STORAGE_KEY);
    if (!storedManual || storedManual.source !== 'manual') throw new Error('Manual browsing origin was not persisted.');

    await manualPage.reload({waitUntil: 'domcontentloaded'});
    await manualPage.locator('.wash-card').first().waitFor({state: 'visible', timeout: 15_000});
    if (await manualPage.getByRole('dialog', {name: 'Find the best wash near you'}).isVisible().catch(() => false)) {
      throw new Error('Location introduction reappeared after a saved manual location was restored.');
    }
    const manualButton = (await manualPage.locator('.location-button').innerText()).replace(/\s+/g, ' ').trim();
    if (!/M1X 1S7/i.test(manualButton)) throw new Error(`Manual search label did not survive reload: ${manualButton}`);
    await manualPage.screenshot({path: `${RESULTS_DIR}/location-persistence-manual.png`, fullPage: true});
    await manualContext.close();

    console.log('Location persistence regression passed: GPS + manual search survive reload without another location prompt.');
  } finally {
    await browser.close();
  }
}

await main();
