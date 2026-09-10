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
  await expect(page.locator('.wash-card').first()).toBeVisible();
}

function collectPageErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

test('production shell, PWA assets and responsive layout are healthy', async ({page, request}) => {
  const errors = collectPageErrors(page);
  const response = await page.goto('/');
  expect(response?.status()).toBeLessThan(400);
  await dismissLocationIntro(page);
  await expect(page.getByRole('link', {name: 'WashRadar home'})).toBeVisible();
  const dimensions = await page.evaluate(() => ({scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth}));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth + 2);
  for (const path of ['/manifest.webmanifest', '/sw.js', '/offline.html', '/favicon.svg']) {
    const asset = await request.get(path);
    expect(asset.ok(), `${path} should return 2xx`).toBeTruthy();
  }
  expect(errors).toEqual([]);
});

test('location journey loads real washes and list/map/detail views', async ({page}) => {
  const errors = collectPageErrors(page);
  await useLocation(page);
  await expect(page.getByText('DEMO MODE')).toHaveCount(0);
  await expect(page.getByRole('link', {name: 'Details'}).first()).toBeVisible();
  await page.getByRole('button', {name: 'Map'}).click();
  await expect(page.locator('.map-section')).toBeVisible();
  await page.getByRole('button', {name: 'List'}).click();
  await expect(page.locator('.cards-grid')).toBeVisible();
  await page.getByRole('link', {name: 'Details'}).first().click();
  await expect(page.getByText('CURRENT WAIT')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Directions'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Update queue'}).first()).toBeVisible();
  await expect(page.getByRole('button', {name: /Join queue/})).toBeVisible();
  await expect(page.getByRole('button', {name: /Alert me/})).toBeVisible();
  expect(errors).toEqual([]);
});

test('fresh shared wash link resolves without prior Explore state', async ({page, browser}) => {
  await useLocation(page);
  const href = await page.getByRole('link', {name: 'Details'}).first().getAttribute('href');
  expect(href).toMatch(/^\/wash\//);

  const device = test.info().project.name === 'mobile-chrome' ? devices['Pixel 7'] : devices['Desktop Chrome'];
  const context = await browser.newContext({...device});
  const fresh = await context.newPage();
  await fresh.goto(`https://washradar.ca${href}`);
  await expect(fresh.getByText('Wash not found')).toHaveCount(0);
  await expect(fresh.getByText('Wash temporarily unavailable')).toHaveCount(0);
  await expect(fresh.getByText('CURRENT WAIT')).toBeVisible();
  await expect(fresh.getByText('Set location').first()).toBeVisible();
  await expect(fresh.getByRole('button', {name: 'Update queue'}).first()).toBeVisible();
  await context.close();
});

test('manual GTA postal search persists across reload and exposes quick sort controls', async ({page}) => {
  await page.goto('/');
  await dismissLocationIntro(page);
  const input = page.getByPlaceholder('Search city, postal code or address');
  await input.fill('M1X 1S7');
  await input.press('Enter');
  await expect(page.getByRole('heading', {name: /Nearby washes/i})).toBeVisible();
  await expect(page.locator('.wash-card').first()).toBeVisible();

  await expect(page.getByRole('button', {name: 'Recommended'})).toBeVisible();
  const nearest = page.getByRole('button', {name: 'Nearest'});
  await nearest.click();
  await expect(nearest).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.getByRole('heading', {name: /Nearby washes/i})).toBeVisible();
  await expect(page.locator('.wash-card').first()).toBeVisible();
  await expect(page.getByText('M1X 1S7').first()).toBeVisible();
  await expect(page.getByRole('button', {name: 'Nearest'})).toHaveAttribute('aria-pressed', 'true');
});

test('manual GTA street-address search returns production wash results', async ({page}) => {
  await page.goto('/');
  await dismissLocationIntro(page);
  const input = page.getByPlaceholder('Search city, postal code or address');
  await input.fill('2310 Battleford Rd, Mississauga');
  await input.press('Enter');
  await expect(page.getByRole('heading', {name: /Nearby washes/i})).toBeVisible();
  await expect(page.locator('.wash-card').first()).toBeVisible();
});

test('friends beta hides social sign-in and keeps password-manager-friendly signup', async ({page}) => {
  await page.goto('/profile');
  await expect(page.getByRole('button', {name: 'Continue with Google'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Continue with Apple'})).toHaveCount(0);
  await expect(page.getByRole('tab', {name: 'Sign in'})).toBeVisible();
  await page.getByRole('tab', {name: 'Create account'}).click();
  const password = page.getByLabel('Password', {exact: true});
  await expect(password).toHaveAttribute('minlength', '8');
  await expect(password).toHaveAttribute('maxlength', '128');
  await expect(password).toHaveAttribute('autocomplete', 'new-password');
  await expect(page.getByLabel('Confirm password', {exact: true})).toHaveCount(0);
  await expect(page.getByText(/Suggested strong passwords/i)).toBeVisible();
});

test('queue target UX does not promise background push delivery', async ({page}) => {
  await useLocation(page);
  await page.getByRole('link', {name: 'Details'}).first().click();
  await page.getByRole('button', {name: /Alert me/}).click();
  await expect(page.getByText(/Check WashRadar/i)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Save queue target'})).toBeVisible();
  await page.goto('/alerts');
  await expect(page.getByText(/background push notifications are not part of this beta/i)).toBeVisible();
});

test('all public and account routes render without crashes', async ({page}) => {
  const errors = collectPageErrors(page);
  const routes = [
    ['/', /Where should you wash your car/i],
    ['/saved', /Saved washes/i],
    ['/alerts', /Save a queue target/i],
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
  expect(errors).toEqual([]);
});

test('unknown routes show a controlled 404 experience', async ({page}) => {
  await page.goto('/this-route-should-not-exist');
  await expect(page.locator('#main-content')).toContainText(/not found|Back|Explore/i);
});