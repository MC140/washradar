import {chromium, devices} from '@playwright/test';

const BASE_URL = (process.env.WASHRADAR_URL || 'https://washradar.ca').replace(/\/$/, '');
const MISSISSAUGA = {latitude: 43.5837, longitude: -79.7591};
const LOCATION_STORAGE_KEY = 'wr-selected-location-v2';

async function main() {
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    geolocation: MISSISSAUGA,
    permissions: ['geolocation'],
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
  });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/`, {waitUntil: 'domcontentloaded', timeout: 30_000});
    const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole('button', {name: 'Use my location'}).dispatchEvent('click');
    } else {
      await page.getByRole('button', {name: /Use my location/i}).first().dispatchEvent('click');
    }

    await page.getByRole('heading', {name: /Nearby washes/i}).waitFor({state: 'visible', timeout: 15_000});
    await page.locator('.wash-card').first().waitFor({state: 'visible', timeout: 15_000});
    await page.getByRole('button', {name: 'Map'}).click();
    const map = page.locator('.wash-map');
    await map.waitFor({state: 'visible', timeout: 10_000});

    const badMarkerSymbols = await page.locator('.map-pin').evaluateAll((pins) =>
      pins.filter((pin) => ['?', '×', 'x'].includes((pin.textContent || '').trim().toLowerCase())).length,
    );
    if (badMarkerSymbols > 0) throw new Error(`Map still renders ${badMarkerSymbols} error-like ?/× marker(s)`);

    const markerCount = await page.locator('.map-pin').count();
    const clusterCount = await page.locator('.map-cluster').count();
    if (markerCount + clusterCount < 1) throw new Error('Map rendered no wash markers or clusters');

    const visibleMarkerIndex = await page.locator('.map-pin').evaluateAll((pins) => {
      const mapElement = document.querySelector('.wash-map');
      if (!mapElement) return -1;
      const mapRect = mapElement.getBoundingClientRect();
      return pins.findIndex((pin) => {
        const rect = pin.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return x >= mapRect.left && x <= mapRect.right && y >= mapRect.top && y <= mapRect.bottom;
      });
    });
    if (visibleMarkerIndex >= 0) {
      // Dispatch the marker's semantic click without asking Playwright to scroll a
      // positioned map pin, which would change the viewport/map during the check.
      await page.locator('.map-pin').nth(visibleMarkerIndex).dispatchEvent('click');
      await page.locator('.map-preview').waitFor({state: 'visible', timeout: 5_000});
      await page.getByRole('button', {name: 'Close map preview'}).dispatchEvent('click');
    }

    const before = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, LOCATION_STORAGE_KEY);

    const box = await map.boundingBox();
    if (!box) throw new Error('Could not measure map for pan interaction');
    const startX = box.x + box.width * 0.55;
    const startY = box.y + box.height * 0.55;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 80, startY + 35, {steps: 8});
    await page.mouse.up();

    const searchArea = page.getByRole('button', {name: 'Search this area'});
    await searchArea.waitFor({state: 'visible', timeout: 5_000});
    await searchArea.click();

    await page.getByRole('heading', {name: /Nearby washes/i}).waitFor({state: 'visible', timeout: 15_000});
    const pinned = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, LOCATION_STORAGE_KEY);
    if (!pinned || pinned.label !== 'Pinned map area' || pinned.source !== 'map') {
      throw new Error('Search this area did not persist the pinned map origin');
    }

    const originalPoint = before?.point || {lat: MISSISSAUGA.latitude, lng: MISSISSAUGA.longitude};
    const moved = Math.abs(Number(pinned.point?.lat) - Number(originalPoint.lat)) + Math.abs(Number(pinned.point?.lng) - Number(originalPoint.lng));
    if (!Number.isFinite(moved) || moved < 0.001) throw new Error('Search this area did not move the active search origin');

    await page.reload({waitUntil: 'domcontentloaded'});
    await page.getByRole('heading', {name: /Nearby washes/i}).waitFor({state: 'visible', timeout: 15_000});
    const persisted = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, LOCATION_STORAGE_KEY);
    if (!persisted || persisted.label !== 'Pinned map area' || persisted.source !== 'map') {
      throw new Error('Pinned map origin did not survive reload');
    }

    console.log(JSON.stringify({
      ok: true,
      badMarkerSymbols,
      markerCount,
      clusterCount,
      visibleMarkerSelected: visibleMarkerIndex >= 0,
      pinnedPoint: pinned.point,
      persistedAfterReload: true,
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
