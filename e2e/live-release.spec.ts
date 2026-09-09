import {expect, test, devices} from '@playwright/test';

async function dismissLocationIntro(page: import('@playwright/test').Page) {
  const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', {name: 'Search manually'}).click();
  }
}

async function useLocation(page: import('@playwright/test').Page) {
  await page.goto('/');
  const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', {name: 'Use my location'}).click();
  } else {
    await page.getByRole('button', {name: /Use my location/i}).first().click();
  }
  await expect(page.getByRole('heading', {name: /Nearby washes/i})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Details'}).first()).toBeVisible();
}

function collectRuntimeIssues(page: import('@playwright/test').Page) {
  const pageErrors: string[] = [];
  const badResponses: Array<{status: number; url: string}> = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) badResponses.push({status: response.status(), url: response.url()});
  });
  return {pageErrors, badResponses};
}

function unexpectedApiFailures(items: Array<{status: number; url: string}>) {
  return items.filter(item => {
    // Known beta noise: the guest shell currently probes an authenticated-only contribution metric.
    if (item.status === 401 && item.url.includes('/rpc/my_contribution_metrics')) return false;
    // GitHub Pages intentionally returns the SPA 404 document on direct client-route navigations.
    if (item.status === 404 && item.url.startsWith('https://washradar.ca/')) return false;
    return true;
  });
}

test('production shell, PWA assets and responsive layout are healthy', async ({page, request}, testInfo) => {
  const issues = collectRuntimeIssues(page);
  const response = await page.goto('/');
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByRole('link', {name: 'WashRadar home'})).toBeVisible();
  await dismissLocationIntro(page);
  const dimensions = await page.evaluate(() => ({scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth}));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 2);
  for (const path of ['/manifest.webmanifest', '/sw.js', '/offline.html', '/favicon.svg']) {
    const asset = await request.get(path);
    expect(asset.ok(), `${path} should return 2xx`).toBeTruthy();
  }
  await page.screenshot({path: testInfo.outputPath('landing.png'), fullPage: true});
  expect(issues.pageErrors).toEqual([]);
  expect(unexpectedApiFailures(issues.badResponses)).toEqual([]);
});

test('production location flow loads real nearby washes and list/map views', async ({page}, testInfo) => {
  const issues = collectRuntimeIssues(page);
  await useLocation(page);
  await expect(page.getByText('DEMO MODE')).toHaveCount(0);
  const detailsCount = await page.getByRole('link', {name: 'Details'}).count();
  expect(detailsCount).toBeGreaterThan(0);
  await expect(page.getByText(/Some listing details are still being verified|THE DECISION, MADE CLEAR|Best available estimate/i).first()).toBeVisible();
  await page.screenshot({path: testInfo.outputPath('nearby-list.png'), fullPage: true});
  await page.getByRole('button', {name: 'Map'}).click();
  await expect(page.locator('.map-section')).toBeVisible();
  await page.getByRole('button', {name: 'List'}).click();
  await expect(page.locator('.cards-grid')).toBeVisible();
  expect(issues.pageErrors).toEqual([]);
  expect(unexpectedApiFailures(issues.badResponses)).toEqual([]);
});

test('manual postal search resolves GTA data without paid-routing dependency', async ({page}) => {
  await page.goto('/');
  await dismissLocationIntro(page);
  const input = page.getByRole('textbox', {name: 'Search city, postal code or address'});
  await input.fill('M1X 1S7');
  await page.getByRole('button', {name: 'Search location'}).click();
  await expect(page.getByRole('heading', {name: /Nearby washes/i})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Details'}).first()).toBeVisible();
});

test('local GTA address autocomplete returns selectable suggestions', async ({page}) => {
  await page.goto('/');
  await dismissLocationIntro(page);
  const input = page.getByRole('textbox', {name: 'Search city, postal code or address'});
  await input.fill('2310 Battleford');
  const option = page.getByRole('option').first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByRole('heading', {name: /Nearby washes/i})).toBeVisible();
});

test('wash detail page exposes the expected friend-beta actions', async ({page}) => {
  const issues = collectRuntimeIssues(page);
  await useLocation(page);
  await page.getByRole('link', {name: 'Details'}).first().click();
  await expect(page.getByText('CURRENT WAIT')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Directions'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Update queue'}).first()).toBeVisible();
  await expect(page.getByRole('button', {name: /Join queue/})).toBeVisible();
  await expect(page.getByRole('button', {name: /Alert me/})).toBeVisible();
  await expect(page.getByText('Packages and prices')).toBeVisible();
  expect(issues.pageErrors).toEqual([]);
  expect(unexpectedApiFailures(issues.badResponses)).toEqual([]);
});

test('Google sign-in is exposed and Apple sign-in stays hidden', async ({page}) => {
  await page.goto('/');
  await dismissLocationIntro(page);
  await page.getByRole('button', {name: 'Open account menu'}).click();
  await expect(page.getByRole('button', {name: 'Continue with Google'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Continue with Apple'})).toHaveCount(0);
  await expect(page.getByRole('tab', {name: 'Sign in'})).toBeVisible();
  await expect(page.getByRole('tab', {name: 'Create account'})).toBeVisible();
});

test('all public and account routes render without crashes', async ({page}) => {
  const issues = collectRuntimeIssues(page);
  const routes = [
    ['/', /Where should you wash your car/i],
    ['/saved', /Saved/i],
    ['/alerts', /Less waiting|No queue alerts/i],
    ['/challenges', /Challenges|Radar Points/i],
    ['/vehicles', /My Cars/i],
    ['/profile', /YOUR WASHRADAR|Build a contributor identity/i],
    ['/privacy', /Privacy/i],
    ['/terms', /Terms/i],
    ['/sponsored', /Sponsored/i],
    ['/support', /Support/i],
  ] as const;
  for (const [path, expected] of routes) {
    await page.goto(path);
    await dismissLocationIntro(page);
    await expect(page.locator('#main-content')).toContainText(expected);
  }
  expect(issues.pageErrors).toEqual([]);
  expect(unexpectedApiFailures(issues.badResponses)).toEqual([]);
});

test('fresh direct wash links are handled deterministically', async ({page, browser}) => {
  await useLocation(page);
  const href = await page.getByRole('link', {name: 'Details'}).first().getAttribute('href');
  expect(href).toMatch(/^\/wash\//);

  const device = test.info().project.name === 'mobile-chrome' ? devices['Pixel 7'] : devices['Desktop Chrome'];
  const context = await browser.newContext({...device, geolocation: {latitude: 43.5837, longitude: -79.7591}, permissions: ['geolocation']});
  const fresh = await context.newPage();
  await fresh.goto(`https://washradar.ca${href}`);
  await expect(fresh.locator('#main-content')).toBeVisible();
  // Capture the current behavior explicitly; this test will fail if fresh deep links cannot resolve.
  await expect(fresh.getByText('Wash not found')).toHaveCount(0);
  await expect(fresh.getByText('CURRENT WAIT')).toBeVisible();
  await context.close();
});

test('unknown routes show a controlled 404 experience', async ({page}) => {
  await page.goto('/this-route-should-not-exist');
  await expect(page.locator('#main-content')).toContainText(/not found|Back|Explore/i);
});
