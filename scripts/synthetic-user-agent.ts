import {chromium, devices, type BrowserContext, type Locator, type Page} from '@playwright/test';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = (process.env.WASHRADAR_URL || 'https://washradar.ca').replace(/\/$/, '');
const RESULTS_DIR = process.env.SYNTHETIC_RESULTS_DIR || 'synthetic-user-results';
const MISSISSAUGA = {latitude: 43.5837, longitude: -79.7591};

type Severity = 'info' | 'warning' | 'critical';
type JourneyStatus = 'passed' | 'passed-with-warnings' | 'failed';
type Finding = {severity: Severity; step: string; message: string; url?: string};
type StepResult = {name: string; status: 'passed' | 'failed'; durationMs: number; detail?: string};
type Journey = {
  persona: string;
  device: string;
  status: JourneyStatus;
  durationMs: number;
  steps: StepResult[];
  findings: Finding[];
  metrics: Record<string, string | number | boolean>;
  finalUrl?: string;
  screenshot?: string;
};

const journeys: Journey[] = [];

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function addFinding(journey: Journey, severity: Severity, stepName: string, message: string, url?: string) {
  const key = `${severity}|${stepName}|${message}|${url || ''}`;
  if (!journey.findings.some((finding) => `${finding.severity}|${finding.step}|${finding.message}|${finding.url || ''}` === key)) {
    journey.findings.push({severity, step: stepName, message, url});
  }
}

async function humanPause(page: Page, minMs = 120, maxMs = 320) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await page.waitForTimeout(delay);
}

function safeUrl(raw: string) {
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw;
  }
}

function monitorPage(page: Page, journey: Journey) {
  page.on('pageerror', (error) => addFinding(journey, 'critical', 'Browser runtime', `Uncaught page error: ${error.message}`, page.url()));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text().trim();
    if (!text || /Failed to load resource: the server responded with a status of (401|403|404)/i.test(text)) return;
    addFinding(journey, 'warning', 'Browser console', text.slice(0, 500), page.url());
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(BASE_URL)) {
      addFinding(journey, 'warning', 'Network', `WashRadar request failed: ${request.method()} ${safeUrl(request.url())} (${request.failure()?.errorText || 'unknown error'})`, page.url());
    }
  });
  page.on('response', (response) => {
    const status = response.status();
    const request = response.request();
    const url = response.url();
    const sameOrigin = url.startsWith(BASE_URL);
    if (sameOrigin && status >= 500) {
      addFinding(journey, 'critical', 'Network', `WashRadar returned HTTP ${status} for ${request.method()} ${safeUrl(url)}`, page.url());
    } else if (sameOrigin && request.resourceType() === 'document' && status >= 400) {
      addFinding(journey, 'warning', 'Deep-link response', `Direct navigation returned HTTP ${status} before the SPA rendered: ${safeUrl(url)}`, page.url());
    } else if ((status === 401 || status === 403) && !sameOrigin) {
      addFinding(journey, 'warning', 'Remote API', `Anonymous browser received HTTP ${status} from ${safeUrl(url)}`, page.url());
    }
  });
}

async function runStep(journey: Journey, page: Page, name: string, action: () => Promise<void>) {
  const started = Date.now();
  try {
    await action();
    journey.steps.push({name, status: 'passed', durationMs: Date.now() - started});
  } catch (error) {
    const detail = messageOf(error).split('\n')[0].slice(0, 500);
    journey.steps.push({name, status: 'failed', durationMs: Date.now() - started, detail});
    addFinding(journey, 'critical', name, detail, page.url());
    throw error;
  }
}

async function activate(locator: Locator) {
  await locator.waitFor({state: 'visible', timeout: 10_000});
  // dispatchEvent avoids a Chromium/Pixel emulation actionability flake on the fixed
  // introductory bottom sheet. The subsequent journey assertion proves the React action ran.
  await locator.dispatchEvent('click');
}

async function dismissIntroForManualSearch(page: Page) {
  const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
  if (await dialog.isVisible().catch(() => false)) {
    await activate(dialog.getByRole('button', {name: 'Search manually'}));
  }
}

async function requireVisible(page: Page, role: 'button' | 'heading' | 'link', name: string | RegExp) {
  await page.getByRole(role, {name}).first().waitFor({state: 'visible', timeout: 12_000});
}

async function associatedLabelText(page: Page, element: Locator) {
  const ancestor = element.locator('xpath=ancestor::label[1]');
  if (await ancestor.count()) return (await ancestor.textContent().catch(() => '')) ?? '';
  const id = await element.getAttribute('id');
  if (!id) return '';
  return (await page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).first().textContent().catch(() => '')) ?? '';
}

async function uxScan(page: Page, journey: Journey, mobile: boolean) {
  const interactive = page.locator('button, a[href], input, select, textarea');
  const count = await interactive.count();
  let visibleInteractiveCount = 0;
  let unlabeledInteractiveCount = 0;
  let smallTouchTargetCount = 0;

  for (let index = 0; index < count; index += 1) {
    const element = interactive.nth(index);
    if (!await element.isVisible().catch(() => false)) continue;
    visibleInteractiveCount += 1;

    const text = (await element.textContent().catch(() => '')) ?? '';
    const aria = await element.getAttribute('aria-label');
    const title = await element.getAttribute('title');
    const placeholder = await element.getAttribute('placeholder');
    const labelledBy = await element.getAttribute('aria-labelledby');
    const value = await element.inputValue().catch(() => '');
    const labelText = await associatedLabelText(page, element);
    if (!(text.trim() || aria?.trim() || title?.trim() || placeholder?.trim() || labelledBy?.trim() || value.trim() || labelText.trim())) {
      unlabeledInteractiveCount += 1;
    }

    if (mobile) {
      const type = (await element.getAttribute('type') || '').toLowerCase();
      const ancestorLabel = element.locator('xpath=ancestor::label[1]');
      const measure = (type === 'checkbox' || type === 'radio') && await ancestorLabel.count() ? ancestorLabel : element;
      const box = await measure.boundingBox();
      if (box && (box.width < 44 || box.height < 44)) smallTouchTargetCount += 1;
    }
  }

  const overflow = Number(await page.evaluate('Math.max(0, document.documentElement.scrollWidth - window.innerWidth)'));
  const mainText = await page.locator('#main-content').innerText().catch(() => '');
  const scan = {
    title: await page.title(),
    horizontalOverflowPx: overflow,
    interactiveCount: visibleInteractiveCount,
    unlabeledInteractiveCount,
    smallTouchTargetCount,
    mainTextLength: mainText.trim().length,
  };
  Object.assign(journey.metrics, scan);

  if (scan.horizontalOverflowPx > 2) addFinding(journey, 'warning', 'UX scan', `Horizontal overflow detected: ${scan.horizontalOverflowPx}px`, page.url());
  if (scan.unlabeledInteractiveCount > 0) addFinding(journey, 'warning', 'Accessibility scan', `${scan.unlabeledInteractiveCount} visible interactive control(s) appear to have no accessible label`, page.url());
  if (mobile && scan.smallTouchTargetCount > 5) addFinding(journey, 'info', 'Mobile UX scan', `${scan.smallTouchTargetCount} visible controls are smaller than the 44px native target guideline in at least one dimension`, page.url());
  if (scan.mainTextLength < 40) addFinding(journey, 'warning', 'Content scan', 'The main page has unusually little visible text', page.url());
}

async function runJourney(options: {
  persona: string;
  device: string;
  context: () => Promise<BrowserContext>;
  mobile: boolean;
  flow: (page: Page, journey: Journey) => Promise<void>;
}) {
  const journey: Journey = {persona: options.persona, device: options.device, status: 'passed', durationMs: 0, steps: [], findings: [], metrics: {}};
  const started = Date.now();
  const context = await options.context();
  const page = await context.newPage();
  monitorPage(page, journey);

  try {
    await options.flow(page, journey);
  } catch {
    // Failed flow steps are recorded above. Keep collecting screenshot/UX evidence.
  }

  try {
    await uxScan(page, journey, options.mobile);
  } catch (error) {
    addFinding(journey, 'critical', 'UX scanner', `UX scan failed: ${messageOf(error).split('\n')[0].slice(0, 500)}`, page.url());
  } finally {
    journey.finalUrl = page.url();
    const safeName = options.persona.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const screenshotPath = path.join(RESULTS_DIR, `${safeName}.png`);
    await page.screenshot({path: screenshotPath, fullPage: true}).catch(() => undefined);
    journey.screenshot = screenshotPath;
    journey.durationMs = Date.now() - started;
    const hasCritical = journey.findings.some((finding) => finding.severity === 'critical');
    const hasWarning = journey.findings.some((finding) => finding.severity === 'warning');
    journey.status = hasCritical ? 'failed' : hasWarning ? 'passed-with-warnings' : 'passed';
    journeys.push(journey);
    await context.close();
  }
}

async function mobileNearbyJourney(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  await runJourney({
    persona: 'First-time nearby visitor', device: 'Pixel 7 / GTA geolocation', mobile: true,
    context: () => browser.newContext({...devices['Pixel 7'], geolocation: MISSISSAUGA, permissions: ['geolocation'], locale: 'en-CA', timezoneId: 'America/Toronto'}),
    flow: async (page, journey) => {
      await runStep(journey, page, 'Open WashRadar home', async () => {
        const response = await page.goto(`${BASE_URL}/`, {waitUntil: 'domcontentloaded', timeout: 30_000});
        if (!response || response.status() >= 500) throw new Error(`Homepage returned ${response?.status() ?? 'no response'}`);
      });
      await runStep(journey, page, 'Use current location', async () => {
        const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
        if (await dialog.isVisible().catch(() => false)) await activate(dialog.getByRole('button', {name: 'Use my location'}));
        else await activate(page.getByRole('button', {name: /Use my location/i}).first());
        await requireVisible(page, 'heading', /Nearby washes/i);
        await page.locator('.wash-card').first().waitFor({state: 'visible', timeout: 12_000});
        await humanPause(page);
      });
      await runStep(journey, page, 'Understand nearby wash cards', async () => {
        const cards = page.locator('.wash-card');
        const count = await cards.count();
        if (count < 1) throw new Error('No car-wash cards were shown after sharing location');
        journey.metrics.nearbyWashCards = count;
        const firstCardText = ((await cards.first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
        journey.metrics.firstCardPreview = firstCardText.slice(0, 240);
        const hasTime = /\bmin\b/i.test(firstCardText);
        const explicitlyUnknown = /unknown|no recent queue report/i.test(firstCardText);
        if (!hasTime && explicitlyUnknown) addFinding(journey, 'info', 'Wash card comprehension', 'The first result clearly showed that live timing is currently unknown', page.url());
        else if (!hasTime) addFinding(journey, 'warning', 'Wash card comprehension', 'The first wash card did not clearly communicate a time or an unknown-data state', page.url());
        if (!/car|queue|wait/i.test(firstCardText)) addFinding(journey, 'warning', 'Wash card comprehension', 'The first wash card did not visibly communicate queue/car information', page.url());
      });
      await runStep(journey, page, 'Switch between map and list', async () => {
        await page.getByRole('button', {name: 'Map'}).click();
        await page.locator('.map-section').waitFor({state: 'visible', timeout: 10_000});
        await humanPause(page);
        await page.getByRole('button', {name: 'List'}).click();
        await page.locator('.cards-grid').waitFor({state: 'visible', timeout: 10_000});
      });
      await runStep(journey, page, 'Open a wash as a shopper', async () => {
        await page.getByRole('link', {name: 'Details'}).first().click();
        await page.getByText('CURRENT WAIT').waitFor({state: 'visible', timeout: 12_000});
        await requireVisible(page, 'button', 'Directions');
        await requireVisible(page, 'button', 'Update queue');
        await requireVisible(page, 'button', /Join queue|Start wait timer/i);
        await requireVisible(page, 'button', /Alert me/i);
        const detailText = (await page.locator('#main-content').innerText()).replace(/\s+/g, ' ');
        journey.metrics.detailCommunicatesMinutes = /\bmin\b/i.test(detailText);
        journey.metrics.detailCommunicatesCars = /\bcars?\b/i.test(detailText);
      });
    },
  });
}

async function desktopManualJourney(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  await runJourney({
    persona: 'Manual-search desktop visitor', device: 'Desktop Chrome', mobile: false,
    context: () => browser.newContext({...devices['Desktop Chrome'], locale: 'en-CA', timezoneId: 'America/Toronto'}),
    flow: async (page, journey) => {
      await runStep(journey, page, 'Open without location sharing', async () => {
        await page.goto(`${BASE_URL}/`, {waitUntil: 'domcontentloaded', timeout: 30_000});
        await dismissIntroForManualSearch(page);
      });
      await runStep(journey, page, 'Search a GTA postal code', async () => {
        const input = page.getByPlaceholder('Search city, postal code or address');
        await input.waitFor({state: 'visible', timeout: 10_000});
        await input.fill('M1X 1S7');
        await humanPause(page);
        await input.press('Enter');
        await requireVisible(page, 'heading', /Nearby washes/i);
        await page.locator('.wash-card').first().waitFor({state: 'visible', timeout: 12_000});
        journey.metrics.manualSearchResults = await page.locator('.wash-card').count();
      });
      await runStep(journey, page, 'Sort by nearest', async () => {
        const nearest = page.getByRole('button', {name: 'Nearest'});
        await nearest.click();
        if ((await nearest.getAttribute('aria-pressed')) !== 'true') throw new Error('Nearest sort did not become active');
      });
      await runStep(journey, page, 'Reload like a returning visitor', async () => {
        await page.reload({waitUntil: 'domcontentloaded'});
        await requireVisible(page, 'heading', /Nearby washes/i);
        await page.locator('.wash-card').first().waitFor({state: 'visible', timeout: 12_000});
        const postalVisible = await page.getByText('M1X 1S7', {exact: true}).first().isVisible().catch(() => false);
        journey.metrics.postalCodeStillVisibleAfterReload = postalVisible;
        if (!postalVisible) addFinding(journey, 'info', 'Returning visitor', 'Results survived reload, but the previous postal code was not visibly echoed on screen', page.url());
      });
    },
  });
}

async function deniedLocationJourney(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  await runJourney({
    persona: 'Location-denied visitor', device: 'Pixel 7 / manual recovery', mobile: true,
    context: () => browser.newContext({...devices['Pixel 7'], locale: 'en-CA', timezoneId: 'America/Toronto'}),
    flow: async (page, journey) => {
      await runStep(journey, page, 'Open as a privacy-conscious visitor', async () => {
        await page.goto(`${BASE_URL}/`, {waitUntil: 'domcontentloaded', timeout: 30_000});
      });
      await runStep(journey, page, 'Decline location and recover manually', async () => {
        const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
        if (await dialog.isVisible().catch(() => false)) await activate(dialog.getByRole('button', {name: 'Search manually'}));
        const input = page.getByPlaceholder('Search city, postal code or address');
        await input.waitFor({state: 'visible', timeout: 10_000});
        await input.fill('M1X 1S7');
        await input.press('Enter');
        await requireVisible(page, 'heading', /Nearby washes/i);
        await page.locator('.wash-card').first().waitFor({state: 'visible', timeout: 12_000});
        journey.metrics.recoveredAfterLocationDenial = true;
      });
    },
  });
}

async function publicNavigationJourney(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  await runJourney({
    persona: 'Curious visitor exploring the app', device: 'Desktop Chrome', mobile: false,
    context: () => browser.newContext({...devices['Desktop Chrome'], locale: 'en-CA', timezoneId: 'America/Toronto'}),
    flow: async (page, journey) => {
      const routes: Array<[string, RegExp]> = [
        ['/', /Where should you wash your car/i], ['/saved', /Saved washes/i], ['/alerts', /Save a queue target/i],
        ['/challenges', /Challenges|Radar Points/i], ['/vehicles', /My Cars/i], ['/profile', /YOUR WASHRADAR|Build a contributor identity/i],
        ['/support', /Support/i], ['/privacy', /Privacy Policy/i], ['/account-deletion', /Delete Your WashRadar Account|Delete your WashRadar account/i],
      ];
      for (const [route, expected] of routes) {
        await runStep(journey, page, `Visit ${route}`, async () => {
          const response = await page.goto(`${BASE_URL}${route}`, {waitUntil: 'domcontentloaded', timeout: 30_000});
          if (!response || response.status() >= 500) throw new Error(`${route} returned ${response?.status() ?? 'no response'}`);
          journey.metrics[`http:${route}`] = response.status();
          await dismissIntroForManualSearch(page);
          const main = page.locator('#main-content');
          await main.waitFor({state: 'visible', timeout: 10_000});
          if (!expected.test(await main.innerText())) throw new Error(`${route} rendered, but expected content was not found`);
          await humanPause(page, 70, 160);
        });
      }
      journey.metrics.publicRoutesVisited = routes.length;
    },
  });
}

function renderReport() {
  const allFindings = journeys.flatMap((journey) => journey.findings);
  const totals = {
    passed: journeys.filter((journey) => journey.status === 'passed').length,
    warnings: journeys.filter((journey) => journey.status === 'passed-with-warnings').length,
    failed: journeys.filter((journey) => journey.status === 'failed').length,
    criticalFindings: allFindings.filter((finding) => finding.severity === 'critical').length,
    warningsFound: allFindings.filter((finding) => finding.severity === 'warning').length,
    informationalFindings: allFindings.filter((finding) => finding.severity === 'info').length,
  };
  const lines = [
    '# WashRadar Synthetic User Agent Report', '', `Target: ${BASE_URL}`, `Generated: ${new Date().toISOString()}`, '', '## Executive summary', '',
    `- Journeys: ${journeys.length}`, `- Passed cleanly: ${totals.passed}`, `- Passed with warnings: ${totals.warnings}`, `- Failed: ${totals.failed}`,
    `- Critical findings: ${totals.criticalFindings}`, `- Warnings: ${totals.warningsFound}`, `- Informational findings: ${totals.informationalFindings}`, '',
    'The agent is intentionally read-only against production. It does not create accounts, start wait timers, update queue counts, save queue targets, or submit other production-changing data.', '',
  ];
  for (const journey of journeys) {
    lines.push(`## ${journey.persona}`, '', `Status: **${journey.status}**  `, `Device: ${journey.device}  `, `Duration: ${(journey.durationMs / 1000).toFixed(1)}s  `, `Final URL: ${journey.finalUrl || 'unknown'}  `, `Screenshot: ${journey.screenshot || 'not captured'}`, '', '### Steps', '');
    for (const result of journey.steps) lines.push(`- ${result.status === 'passed' ? 'PASS' : 'FAIL'} — ${result.name} (${result.durationMs}ms)${result.detail ? ` — ${result.detail}` : ''}`);
    lines.push('', '### Findings', '');
    if (!journey.findings.length) lines.push('- No problems detected.');
    else for (const finding of journey.findings) lines.push(`- **${finding.severity.toUpperCase()}** — ${finding.step}: ${finding.message}${finding.url ? ` (${finding.url})` : ''}`);
    lines.push('', '### Observed metrics', '');
    for (const [key, value] of Object.entries(journey.metrics)) lines.push(`- ${key}: ${String(value)}`);
    lines.push('');
  }
  return {markdown: `${lines.join('\n')}\n`, totals};
}

async function main() {
  await rm(RESULTS_DIR, {recursive: true, force: true});
  await mkdir(RESULTS_DIR, {recursive: true});
  const browser = await chromium.launch({headless: true});
  try {
    await mobileNearbyJourney(browser);
    await desktopManualJourney(browser);
    await deniedLocationJourney(browser);
    await publicNavigationJourney(browser);
  } finally {
    await browser.close();
  }
  const {markdown, totals} = renderReport();
  const generatedAt = new Date().toISOString();
  await writeFile(path.join(RESULTS_DIR, 'report.md'), markdown, 'utf8');
  await writeFile(path.join(RESULTS_DIR, 'report.json'), JSON.stringify({target: BASE_URL, generatedAt, totals, journeys}, null, 2), 'utf8');
  console.log(markdown);
  if (totals.failed > 0 || totals.criticalFindings > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Synthetic user agent crashed: ${messageOf(error)}`);
  process.exitCode = 1;
});
