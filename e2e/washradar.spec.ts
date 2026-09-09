import {expect, test} from '@playwright/test';

async function resetAndUseLocation(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const intro = page.getByRole('dialog', {name: 'Find the best wash near you'});
  if (await intro.isVisible().catch(() => false)) {
    await intro.getByRole('button', {name: 'Use my location'}).click();
  } else {
    await page.getByRole('button', {name: /Use my location/i}).first().click();
  }
  await expect(page.getByRole('heading', {name: /Nearby washes/i})).toBeVisible();
  await expect(page.locator('.wash-card').first()).toBeVisible();
}

test('guest browse → save → reload saved → details journey works', async ({page}) => {
  await resetAndUseLocation(page);
  await expect(page.getByText('DEMO MODE')).toBeVisible();
  await page.getByLabel('Save this wash').first().click();
  await page.goto('/saved');
  await expect(page.getByRole('heading', {name: 'Saved washes.'})).toBeVisible();
  await expect(page.getByText('ClearRoute Touchless').first()).toBeVisible();
  await page.getByRole('link', {name: 'Details'}).first().click();
  await expect(page.getByText('CURRENT WAIT')).toBeVisible();
  await expect(page.getByText('Packages and prices')).toBeVisible();
});

test('guest can submit a queue report end to end', async ({page}) => {
  await resetAndUseLocation(page);
  await page.locator('.wash-card').first().getByRole('button', {name: 'Update queue'}).click();
  await page.getByRole('button', {name: '1–3 CARS'}).click();
  await expect(page.getByText(/Thanks/)).toBeVisible();
});

test('verified queue timer can start and finish near the wash', async ({page}) => {
  await resetAndUseLocation(page);
  await page.getByRole('link', {name: 'Details'}).first().click();
  await page.getByRole('button', {name: /Join queue/}).click();
  await page.getByRole('button', {name: '1–3 ahead'}).click();
  await expect(page.getByText(/YOU’VE BEEN WAITING/)).toBeVisible();
  await page.getByRole('button', {name: 'Wash started'}).click();
  await expect(page.getByText(/YOU’VE BEEN WAITING/)).toBeHidden();
});

test('queue target is in-app and survives a reload', async ({page}) => {
  await resetAndUseLocation(page);
  await page.getByRole('link', {name: 'Details'}).first().click();
  await page.getByRole('button', {name: /Alert me/}).click();
  await expect(page.getByText(/Check WashRadar/i)).toBeVisible();
  await page.getByRole('button', {name: 'Save queue target'}).click();
  await page.goto('/alerts');
  await expect(page.getByRole('heading', {name: 'Save a queue target.'})).toBeVisible();
  await expect(page.getByText('ClearRoute Touchless').first()).toBeVisible();
  await expect(page.getByText(/TARGET (MET|SAVED)/).first()).toBeVisible();
  await expect(page.getByText(/background push notifications are not part of this beta/i)).toBeVisible();
});

test('friends beta account UI is email/password only with stronger signup password rules', async ({page}) => {
  await page.goto('/profile');
  await expect(page.getByRole('button', {name: 'Continue with Google'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Continue with Apple'})).toHaveCount(0);
  await expect(page.getByRole('tab', {name: 'Sign in'})).toBeVisible();
  await page.getByRole('tab', {name: 'Create account'}).click();
  const password = page.getByLabel('Password', {exact: true});
  const confirmation = page.getByLabel('Confirm password', {exact: true});
  await expect(password).toHaveAttribute('minlength', '12');
  await expect(confirmation).toHaveAttribute('minlength', '12');
  await expect(page.getByText(/unique 12\+ character password/i)).toBeVisible();
});

test('fresh direct wash URL renders without prior Explore state', async ({page}) => {
  await page.goto('/wash/00000000-0000-4000-8000-000000000001');
  await expect(page.getByText('Wash not found')).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'ClearRoute Touchless'})).toBeVisible();
  await expect(page.getByText('CURRENT WAIT')).toBeVisible();
  await expect(page.getByText('Set location').first()).toBeVisible();
  await expect(page.getByRole('button', {name: 'Update queue'}).first()).toBeVisible();
  await expect(page.getByRole('button', {name: /Alert me/})).toBeVisible();
});
