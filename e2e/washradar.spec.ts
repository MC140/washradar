import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
  await dialog.getByRole('button', {name: 'Use my location'}).click();
  await expect(page.getByRole('link', {name: 'Details'}).first()).toBeVisible();
});

test('home loads demo decision data and opens wash details', async ({page}) => {
  await expect(page.getByText(/BEST RIGHT NOW|BEST AVAILABLE ESTIMATE/).first()).toBeVisible();
  await expect(page.getByText('DEMO MODE')).toBeVisible();
  await expect(page.getByText(/Fastest/).first()).toBeVisible();
  await page.getByRole('link', {name: 'Details'}).first().click();
  await expect(page.getByText('CURRENT WAIT')).toBeVisible();
  await expect(page.getByText('Packages and prices')).toBeVisible();
});

test('submits a queue report', async ({page}) => {
  await page.getByRole('button', {name: 'Report'}).click();
  await page.getByRole('button', {name: /ClearRoute Touchless/}).click();
  await page.getByRole('button', {name: '1–3 CARS'}).click();
  await expect(page.getByText(/Thanks/)).toBeVisible();
});

test('starts and completes a queue session', async ({page}) => {
  await page.getByRole('link', {name: 'Details'}).first().click();
  await page.getByRole('button', {name: /Join queue/}).click();
  await page.getByRole('button', {name: '1–3 ahead'}).click();
  await expect(page.getByText(/YOU’VE BEEN WAITING/)).toBeVisible();
  await page.getByRole('button', {name: 'Wash started'}).click();
  await expect(page.getByText(/YOU’VE BEEN WAITING/)).toBeHidden();
});

test('favourites a wash and creates an alert', async ({page}) => {
  await page.getByLabel('Save this wash').first().click();
  await page.getByRole('link', {name: 'Saved'}).click();
  await expect(page.getByText('ClearRoute Touchless')).toBeVisible();
  await page.getByRole('link', {name: 'Details'}).click();
  await page.getByRole('button', {name: /Alert me/}).click();
  await page.getByRole('button', {name: 'Create alert'}).click();
  await page.getByRole('link', {name: 'Alerts'}).click();
  await expect(page.getByText('ClearRoute Touchless')).toBeVisible();
});
