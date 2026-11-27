import {expect, test, type Page, type TestInfo} from '@playwright/test';

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({path: testInfo.outputPath(`${name}.png`), fullPage: true});
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect.soft(dimensions.scrollWidth, `horizontal overflow: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.clientWidth + 2);
}

async function openRoute(page: Page, path: string, expected: string | RegExp) {
  const response = await page.goto(path, {waitUntil: 'domcontentloaded'});
  expect.soft(response?.status(), `${path} HTTP status`).toBeLessThan(500);
  await expect.soft(page.getByText(expected).first(), `${path} expected content`).toBeVisible();
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('wr-location-intro', 'seen'));
});

test('production end-to-end friend-release audit', async ({page}, testInfo) => {
  const pageErrors: string[] = [];
  const firstPartyServerErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    const url = response.url();
    if ((url.startsWith('https://washradar.ca') || url.includes('mwyomijlvjfllgeniqcz.supabase.co')) && response.status() >= 500) {
      firstPartyServerErrors.push(`${response.status()} ${url}`);
    }
  });

  const root = await page.goto('/', {waitUntil: 'domcontentloaded'});
  expect.soft(root?.status()).toBe(200);
  await expect.soft(page.getByRole('link', {name: 'WashRadar home'})).toBeVisible();
  await expect.soft(page.getByRole('heading', {name: /Where should you wash your car/i})).toBeVisible();
  await expect.soft(page.getByText('DEMO MODE')).toHaveCount(0);
  await expect.soft(page.getByRole('navigation', {name: /Primary navigation|Mobile navigation/}).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await screenshot(page, testInfo, '01-home-initial');

  // Manual location search must work without GPS. M1X is a regression case from earlier testing.
  const search = page.getByPlaceholder('Search city, postal code or address');
  await search.fill('M1X');
  await search.press('Enter');
  await expect.soft(page.getByText('No matching area found. Try a city, postal code or address.')).toHaveCount(0, {timeout: 30_000});
  await expect.soft(page.getByRole('heading', {name: /Nearby washes/i})).toBeVisible({timeout: 30_000});
  await screenshot(page, testInfo, '02-search-m1x');

  // GPS location should refresh the catalogue around the configured Mississauga test coordinate.
  await page.getByRole('button', {name: 'Use my location'}).first().click();
  await expect.soft(page.getByRole('heading', {name: /Nearby washes/i})).toBeVisible({timeout: 30_000});
  const nearbyCount = await page.locator('.cards-grid article').count();
  expect.soft(nearbyCount, 'nearby result cards after GPS').toBeGreaterThan(0);

  const sort = page.getByLabel('Sort nearby washes');
  if (await sort.count()) {
    await expect.soft(sort.locator('option', {hasText: 'Recommended'})).toHaveCount(1);
    await expect.soft(sort.locator('option', {hasText: 'Nearest'})).toHaveCount(1);
    await sort.selectOption({label: 'Nearest'});
    await expect.soft(sort).toHaveValue('Nearest');
  }

  // Filters open and close without trapping the user.
  await page.getByRole('button', {name: /Filters/i}).click();
  await expect.soft(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', {name: 'Close'}).click();
  await expect.soft(page.getByRole('dialog')).toHaveCount(0);

  // List -> map -> list, including a selectable wash pin.
  const viewGroup = page.getByRole('group', {name: 'Choose results view'});
  if (await viewGroup.count()) {
    await viewGroup.getByRole('button', {name: 'Map'}).click();
    const map = page.getByLabel('Interactive map of nearby car washes');
    await expect.soft(map).toBeVisible({timeout: 20_000});
    const pins = map.locator('button.map-pin');
    if (await pins.count()) {
      await pins.first().click();
      await expect.soft(page.locator('.map-preview')).toBeVisible();
      await page.getByLabel('Close map preview').click();
    }
    await screenshot(page, testInfo, '03-map-view');
    await viewGroup.getByRole('button', {name: 'List'}).click();
  }

  // Open a real wash and touch every non-destructive action.
  const detailsLinks = page.getByRole('link', {name: 'View details'});
  expect.soft(await detailsLinks.count(), 'details links available').toBeGreaterThan(0);
  if (await detailsLinks.count()) {
    await detailsLinks.first().click();
    await expect.soft(page.getByText('CURRENT WAIT')).toBeVisible();
    await expect.soft(page.getByText('DATA STATUS')).toBeVisible();
    await expect.soft(page.getByText('CONFIDENCE')).toBeVisible();
    await expect.soft(page.getByRole('heading', {name: 'Packages and prices'})).toBeVisible();
    await expect.soft(page.getByRole('heading', {name: 'Before you go'})).toBeVisible();
    await expect.soft(page.getByRole('heading', {name: 'What drivers are seeing'})).toBeVisible();

    await page.evaluate(() => {
      const target = window as Window & {__wrOpenedUrl?: string};
      target.open = ((url?: string | URL) => {
        target.__wrOpenedUrl = String(url ?? '');
        return null;
      }) as typeof window.open;
    });
    await page.getByRole('button', {name: /Directions/}).first().click();
    const openedUrl = await page.evaluate(() => (window as Window & {__wrOpenedUrl?: string}).__wrOpenedUrl ?? '');
    expect.soft(openedUrl, 'Directions handoff URL').toMatch(/^https:\/\/(www\.google\.com\/maps|maps\.apple\.com)/);

    await page.getByRole('button', {name: 'Update queue'}).first().click();
    await expect.soft(page.getByRole('dialog')).toContainText('What do you see?');
    await expect.soft(page.getByRole('button', {name: 'NO QUEUE'})).toBeVisible();
    await expect.soft(page.getByRole('button', {name: '12+ / HUGE QUEUE'})).toBeVisible();
    await page.getByRole('button', {name: 'Close'}).click();

    await page.getByRole('button', {name: /Join queue/}).click();
    await expect.soft(page.getByRole('dialog')).toContainText('Start verified queue timer');
    await expect.soft(page.getByRole('button', {name: '1–3 ahead'})).toBeVisible();
    await page.getByRole('button', {name: 'Close'}).click();

    await page.getByRole('button', {name: /Alert me/}).click();
    await expect.soft(page.getByRole('dialog')).toContainText('A shorter queue, on your terms.');
    await expect.soft(page.getByRole('button', {name: 'Create alert'})).toBeVisible();
    await page.getByRole('button', {name: 'Close'}).click();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, testInfo, '04-wash-detail');
  }

  // Account experience: Google must be public-facing; Apple intentionally stays absent.
  await openRoute(page, '/profile', /Build a contributor identity/i);
  await expect.soft(page.getByRole('button', {name: 'Continue with Google'})).toBeVisible({timeout: 20_000});
  await expect.soft(page.getByRole('button', {name: 'Continue with Apple'})).toHaveCount(0);
  await expect.soft(page.getByRole('tab', {name: 'Sign in'})).toBeVisible();
  await expect.soft(page.getByRole('tab', {name: 'Create account'})).toBeVisible();
  await expect.soft(page.getByLabel('Email address')).toBeVisible();
  await screenshot(page, testInfo, '05-profile-auth');

  // Feature routes and their guest states.
  await openRoute(page, '/saved', /Saved washes/i);
  await openRoute(page, '/alerts', /Less waiting/i);
  await openRoute(page, '/challenges', /Radar Challenges|Challenges/i);
  await openRoute(page, '/vehicles', /My Cars/i);
  await expect.soft(page.getByRole('link', {name: 'Sign in'})).toBeVisible();

  // Legal/support routes must be directly addressable, not only client-side navigable.
  await openRoute(page, '/privacy', /Privacy Policy/i);
  await openRoute(page, '/terms', /Terms of Use/i);
  await openRoute(page, '/sponsored', /Sponsored Content Disclosure/i);
  await openRoute(page, '/support', /Contact|Support/i);

  // Internal and preview routes should behave intentionally.
  await openRoute(page, '/admin', /WashRadar moderation/i);
  await expect.soft(page.getByText('Protected route')).toBeVisible({timeout: 20_000});
  await openRoute(page, '/ad-preview', /See exactly where sponsored offers would appear/i);
  await expect.soft(page.getByText('Sponsored · preview only').first()).toBeVisible();
  await screenshot(page, testInfo, '06-ad-preview');

  // A nonsense deep link must land on the app's explicit 404 experience rather than a server error.
  await page.goto('/definitely-not-a-washradar-route', {waitUntil: 'domcontentloaded'});
  await expect.soft(page.getByText(/not found|couldn’t find|could not find/i).first()).toBeVisible();

  expect.soft(pageErrors, `uncaught browser errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect.soft(firstPartyServerErrors, `first-party 5xx responses: ${firstPartyServerErrors.join(' | ')}`).toEqual([]);
});

test('production PWA assets are reachable and valid', async ({request}) => {
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  const manifestBody = await manifest.json() as {name?: string; short_name?: string; display?: string};
  expect(manifestBody.name).toContain('WashRadar');
  expect(manifestBody.short_name).toContain('WashRadar');
  expect(manifestBody.display).toBeTruthy();

  const serviceWorker = await request.get('/sw.js');
  expect(serviceWorker.status()).toBe(200);
  expect(await serviceWorker.text()).toContain('washradar');

  const offline = await request.get('/offline.html');
  expect(offline.status()).toBe(200);
  expect(await offline.text()).toContain('WashRadar');
});
