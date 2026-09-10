import {chromium, devices} from '@playwright/test';

const BASE_URL = (process.env.WASHRADAR_URL || 'https://washradar.ca').replace(/\/$/, '');
const MISSISSAUGA = {latitude: 43.5837, longitude: -79.7591};

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

    const ratingResponse = page.waitForResponse(
      (response) => response.url().includes('/rest/v1/rpc/wash_rating_summary'),
      {timeout: 15_000},
    );
    await page.getByRole('link', {name: 'Details'}).first().click();

    await page.getByRole('heading', {name: 'What drivers think'}).waitFor({state: 'visible', timeout: 15_000});
    const response = await ratingResponse;
    if (response.status() !== 200) throw new Error(`wash_rating_summary returned HTTP ${response.status()}`);

    const action = page.getByRole('button', {name: /Rate this wash|Edit my rating/i});
    await action.waitFor({state: 'visible', timeout: 10_000});

    const zeroState = page.getByText('No WashRadar ratings yet');
    const score = page.locator('.rating-score');
    if (!await zeroState.isVisible().catch(() => false) && !await score.isVisible().catch(() => false)) {
      throw new Error('WashRadar Ratings rendered neither an aggregate score nor the zero-rating state');
    }

    await action.click();
    const ratingDialog = page.getByRole('dialog', {name: /Rate this wash|Edit my WashRadar rating/i});
    await ratingDialog.waitFor({state: 'visible', timeout: 10_000});
    const overallGroup = ratingDialog.getByRole('group', {name: 'Overall rating'});
    await overallGroup.waitFor({state: 'visible'});
    await overallGroup.getByRole('button', {name: '5 stars'}).waitFor({state: 'visible'});
    await ratingDialog.getByRole('button', {name: 'Clean facility'}).waitFor({state: 'visible'});

    if (await ratingDialog.locator('textarea').count() > 0) {
      throw new Error('Structured WashRadar rating modal unexpectedly contains a free-text review field');
    }

    await page.screenshot({path: 'synthetic-user-results/ratings-panel.png', fullPage: true});
    console.log(JSON.stringify({
      ok: true,
      summaryHttpStatus: response.status(),
      panelVisible: true,
      structuredOnly: true,
      noFreeTextReview: true,
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
