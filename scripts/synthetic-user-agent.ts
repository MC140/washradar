import {chromium, devices, type Browser, type BrowserContext, type Page} from '@playwright/test';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = (process.env.WASHRADAR_URL || 'https://washradar.ca').replace(/\/$/, '');
const RESULTS_DIR = process.env.SYNTHETIC_RESULTS_DIR || 'synthetic-user-results';
const MISSISSAUGA = {latitude: 43.5837, longitude: -79.7591};

type Severity = 'info' | 'warning' | 'critical';
type JourneyStatus = 'passed' | 'passed-with-warnings' | 'failed';

type Finding = {
  severity: Severity;
  step: string;
  message: string;
  url?: string;
};

type StepResult = {
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  detail?: string;
};

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

function addFinding(journey: Journey, severity: Severity, step: string, message: string, url?: string) {
  journey.findings.push({severity, step, message, url});
}

async function humanPause(page: Page, minMs = 120, maxMs = 320) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await page.waitForTimeout(delay);
}

function monitorPage(page: Page, journey: Journey) {
  page.on('pageerror', error => {
    addFinding(journey, 'critical', 'Browser runtime', `Uncaught page error: ${error.message}`, page.url());
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text().trim();
      if (text) addFinding(journey, 'warning', 'Browser console', text.slice(0, 500), page.url());
    }
  });

  page.on('requestfailed', request => {
    if (request.url().startsWith(BASE_URL)) {
      addFinding(
        journey,
        'warning',
        'Network',
        `WashRadar request failed: ${request.method()} ${request.url()} (${request.failure()?.errorText || 'unknown error'})`,
        page.url(),
      );
    }
  });

  page.on('response', response => {
    const request = response.request();
    if (response.url().startsWith(BASE_URL) && response.status() >= 500) {
      addFinding(
        journey,
        'critical',
        'Network',
        `WashRadar returned HTTP ${response.status()} for ${request.method()} ${response.url()}`,
        page.url(),
      );
    } else if (response.url().startsWith(BASE_URL) && request.resourceType() === 'document' && response.status() >= 400) {
      addFinding(
        journey,
        'critical',
        'Navigation',
        `Page returned HTTP ${response.status()}: ${response.url()}`,
        page.url(),
      );
    }
  });
}

async function step(journey: Journey, page: Page, name: string, action: () => Promise<void>) {
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

async function dismissIntroForManualSearch(page: Page) {
  const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', {name: 'Search manually'}).click();
  }
}

async function uxScan(page: Page, journey: Journey, mobile: boolean) {
  const scan = await page.evaluate(({mobile}) => {
    const isVisible = (element: Element) => {
      const html = element as HTMLElement;
      const style = window.getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const interactive = Array.from(document.querySelectorAll('button, a[href], input, select, textarea')).filter(isVisible);
    const unlabeled = interactive.filter(element => {
      const html = element as HTMLElement;
      const text = (html.innerText || '').trim();
      const aria = element.getAttribute('aria-label')?.trim();
      const title = element.getAttribute('title')?.trim();
      const value = element instanceof HTMLInputElement ? element.value.trim() : '';
      return !text && !aria && !title && !value;
    });

    const smallTargets = mobile
      ? interactive.filter(element => {
          const rect = (element as HTMLElement).getBoundingClientRect();
          return rect.width < 36 || rect.height < 36;
        })
      : [];

    return {
      title: document.title,
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      interactiveCount: interactive.length,
      unlabeledInteractiveCount: unlabeled.length,
      smallTouchTargetCount: smallTargets.length,
      mainTextLength: (document.querySelector('#main-content')?.textContent || document.body.textContent || '').trim().length,
    };
  }, {mobile});

  Object.assign(journey.metrics, scan);
  if (scan.horizontalOverflowPx > 2) {
    addFinding(journey, 'warning', 'UX scan', `Horizontal overflow detected: ${scan.horizontalOverflowPx}px`, page.url());
  }
  if (scan.unlabeledInteractiveCount > 0) {
    addFinding(journey, 'warning', 'Accessibility scan', `${scan.unlabeledInteractiveCount} visible interactive control(s) appear to have no accessible label`, page.url());
  }
  if (mobile && scan.smallTouchTargetCount > 5) {
    addFinding(journey, 'info', 'Mobile UX scan', `${scan.smallTouchTargetCount} visible controls are smaller than 36px in at least one dimension`, page.url());
  }
  if (scan.mainTextLength < 40) {
    addFinding(journey, 'warning', 'Content scan', 'The main page has unusually little visible text', page.url());
  }
}

async function requireVisible(page: Page, role: 'button' | 'heading' | 'link', name: string | RegExp) {
  await page.getByRole(role, {name}).first().waitFor({state: 'visible', timeout: 12_000});
}

async function runJourney(
  browser: Browser,
  options: {
    persona: string;
    device: string;
    context: () => Promise<BrowserContext>;
    mobile: boolean;
    flow: (page: Page, journey: Journey) => Promise<void>;
  },
) {
  const journey: Journey = {
    persona: options.persona,
    device: options.device,
    status: 'passed',
    durationMs: 0,
    steps: [],
    findings: [],
    metrics: {},
  };
  const started = Date.now();
  const context = await options.context();
  const page = await context.newPage();
  monitorPage(page, journey);

  try {
    await options.flow(page, journey);
    await uxScan(page, journey, options.mobile);
  } catch {
    // The failed step already records a critical finding. Continue to evidence capture.
  } finally {
    journey.finalUrl = page.url();
    const safeName = options.persona.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const screenshotPath = path.join(RESULTS_DIR, `${safeName}.png`);
    await page.screenshot({path: screenshotPath, fullPage: true}).catch(() => undefined);
    journey.screenshot = screenshotPath;
    journey.durationMs = Date.now() - started;

    const hasCritical = journey.findings.some(finding => finding.severity === 'critical');
    const hasWarning = journey.findings.some(finding => finding.severity === 'warning');
    journey.status = hasCritical ? 'failed' : hasWarning ? 'passed-with-warnings' : 'passed';
    journeys.push(journey);
    await context.close();
  }
}

async function mobileNearbyJourney(browser: Browser) {
  await runJourney(browser, {
    persona: 'First-time nearby visitor',
    device: 'Pixel 7 / GTA geolocation',
    mobile: true,
    context: () => browser.newContext({
      ...devices['Pixel 7'],
      geolocation: MISSISSAUGA,
      permissions: ['geolocation'],
      locale: 'en-CA',
      timezoneId: 'America/Toronto',
    }),
    flow: async (page, journey) => {
      await step(journey, page, 'Open WashRadar home', async () => {
        const response = await page.goto(`${BASE_URL}/`, {waitUntil: 'domcontentloaded', timeout: 30_000});
        if (!response || response.status() >= 400) throw new Error(`Homepage returned ${response?.status() ?? 'no response'}`);
        await humanPause(page);
      });

      await step(journey, page, 'Use current location', async () => {
        const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
        if (await dialog.isVisible().catch(() => false)) {
          await dialog.getByRole('button', {name: 'Use my location'}).click();
        } else {
          await page.getByRole('button', {name: /Use my location/i}).first().click();
        }
        await requireVisible(page, 'heading', /Nearby washes/i);
        await page.locator('.wash-card').first().waitFor({state: 'visible', timeout: 12_000});
        await humanPause(page);
      });

      await step(journey, page, 'Understand nearby wash cards', async () => {
        const cards = page.locator('.wash-card');
        const count = await cards.count();
        if (count < 1) throw new Error('No car-wash cards were shown after sharing location');
        journey.metrics.nearbyWashCards = count;
        const firstCardText = (await cards.first().innerText()).replace(/\s+/g, ' ').trim();
        journey.metrics.firstCardPreview = firstCardText.slice(0, 240);
        if (!/\bmin\b/i.test(firstCardText)) {
          addFinding(journey, 'warning', 'Wash card comprehension', 'The first wash card did not visibly communicate a time in minutes', page.url());
        }
        if (!/car|queue|wait/i.test(firstCardText)) {
          addFinding(journey, 'warning', 'Wash card comprehension', 'The first wash card did not visibly communicate queue/car information', page.url());
        }
      });

      await step(journey, page, 'Switch between map and list', async () => {
        await page.getByRole('button', {name: 'Map'}).click();
        await page.locator('.map-section').waitFor({state: 'visible', timeout: 10_000});
        await humanPause(page);
        await page.getByRole('button', {name: 'List'}).click();
        await page.locator('.cards-grid').waitFor({state: 'visible', timeout: 10_000});
      });

      await step(journey, page, 'Open a wash as a shopper', async () => {
        await page.getByRole('link', {name: 'Details'}).first().click();
        await page.getByText('CURRENT WAIT').waitFor({state: 'visible', timeout: 12_000});
        await requireVisible(page, 'button', 'Directions');
        await requireVisible(page, 'button', 'Update queue');
        await requireVisible(page, 'button', /Join queue/i);
        await requireVisible(page, 'button', /Alert me/i);
        const detailText = (await page.locator('#main-content').innerText()).replace(/\s+/g, ' ');
        journey.metrics.detailCommunicatesMinutes = /\bmin\b/i.test(detailText);
        journey.metrics.detailCommunicatesCars = /\bcars?\b/i.test(detailText);
        await humanPause(page);
      });
    },
  });
}

async function desktopManualJourney(browser: Browser) {
  await runJourney(browser, {
    persona: 'Manual-search desktop visitor',
    device: 'Desktop Chrome',
    mobile: false,
    context: () => browser.newContext({
      ...devices['Desktop Chrome'],
      locale: 'en-CA',
      timezoneId: 'America/Toronto',
    }),
    flow: async (page, journey) => {
      await step(journey, page, 'Open without location sharing', async () => {
        await page.goto(`${BASE_URL}/`, {waitUntil: 'domcontentloaded', timeout: 30_000});
        await dismissIntroForManualSearch(page);
      });

      await step(journey, page, 'Search a GTA postal code', async () => {
        const input = page.getByPlaceholder('Search city, postal code or address');
        await input.waitFor({state: 'visible', timeout: 10_000});
        await input.fill('M1X 1S7');
        await humanPause(page);
        await input.press('Enter');
        await requireVisible(page, 'heading', /Nearby washes/i);
        await page.locator('.wash-card').first().waitFor({state: 'visible', timeout: 12_000});
        journey.metrics.manualSearchResults = await page.locator('.wash-card').count();
      });

      await step(journey, page, 'Sort by nearest', async () => {
        const nearest = page.getByRole('button', {name: 'Nearest'});
        await nearest.click();
        const pressed = await nearest.getAttribute('aria-pressed');
        if (pressed !== 'true') throw new Error(`Nearest sort did not become active (aria-pressed=${pressed})`);
      });

      await step(journey, page, 'Reload like a returning visitor', async () => {
        await page.reload({waitUntil: 'domcontentloaded'});
        await requireVisible(page, 'heading', /Nearby washes/i);
        await page.locator('.wash-card').first().waitFor({state: 'visible', timeout: 12_000});
        const bodyText = await page.locator('#main-content').innerText();
        if (!bodyText.includes('M1X 1S7')) {
          addFinding(journey, 'warning', 'Returning visitor', 'The previous postal-code location was not visibly restored after reload', page.url());
        }
      });
    },
  });
}

async function deniedLocationJourney(browser: Browser) {
  await runJourney(browser, {
    persona: 'Location-denied visitor',
    device: 'Pixel 7 / geolocation denied',
    mobile: true,
    context: () => browser.newContext({
      ...devices['Pixel 7'],
      locale: 'en-CA',
      timezoneId: 'America/Toronto',
    }),
    flow: async (page, journey) => {
      await step(journey, page, 'Open as a privacy-conscious visitor', async () => {
        await page.goto(`${BASE_URL}/`, {waitUntil: 'domcontentloaded', timeout: 30_000});
      });

      await step(journey, page, 'Decline location and recover manually', async () => {
        const dialog = page.getByRole('dialog', {name: 'Find the best wash near you'});
        if (await dialog.isVisible().catch(() => false)) {
          const locationButton = dialog.getByRole('button', {name: 'Use my location'});
          await locationButton.click();
          await page.waitForTimeout(900);
          if (await dialog.isVisible().catch(() => false)) {
            const manual = dialog.getByRole('button', {name: 'Search manually'});
            if (await manual.isVisible().catch(() => false)) await manual.click();
          }
        }

        const input = page.getByPlaceholder('Search city, postal code or address');
        await input.waitFor({state: 'visible', timeout: 10_000});
        await input.fill('M1X 1S7');
        await input.press('Enter');
        await page.locator('.wash-card').first().waitFor({state: 'visible', timeout: 12_000});
        journey.metrics.recoveredAfterLocationDenial = true;
      });
    },
  });
}

async function publicNavigationJourney(browser: Browser) {
  await runJourney(browser, {
    persona: 'Curious visitor exploring the app',
    device: 'Desktop Chrome',
    mobile: false,
    context: () => browser.newContext({
      ...devices['Desktop Chrome'],
      locale: 'en-CA',
      timezoneId: 'America/Toronto',
    }),
    flow: async (page, journey) => {
      const routes: Array<[string, RegExp]> = [
        ['/', /Where should you wash your car/i],
        ['/saved', /Saved washes/i],
        ['/alerts', /Save a queue target/i],
        ['/challenges', /Challenges|Radar Points/i],
        ['/vehicles', /My Cars/i],
        ['/profile', /YOUR WASHRADAR|Build a contributor identity/i],
        ['/support', /Support/i],
      ];

      for (const [route, expected] of routes) {
        await step(journey, page, `Visit ${route}`, async () => {
          const response = await page.goto(`${BASE_URL}${route}`, {waitUntil: 'domcontentloaded', timeout: 30_000});
          if (!response || response.status() >= 400) throw new Error(`${route} returned ${response?.status() ?? 'no response'}`);
          await dismissIntroForManualSearch(page);
          const main = page.locator('#main-content');
          await main.waitFor({state: 'visible', timeout: 10_000});
          const text = await main.innerText();
          if (!expected.test(text)) throw new Error(`${route} rendered, but expected content was not found`);
          await humanPause(page, 70, 160);
        });
      }
      journey.metrics.publicRoutesVisited = routes.length;
    },
  });
}

function renderReport() {
  const totals = {
    passed: journeys.filter(journey => journey.status === 'passed').length,
    warnings: journeys.filter(journey => journey.status === 'passed-with-warnings').length,
    failed: journeys.filter(journey => journey.status === 'failed').length,
    criticalFindings: journeys.flatMap(journey => journey.findings).filter(finding => finding.severity === 'critical').length,
    warningsFound: journeys.flatMap(journey => journey.findings).filter(finding => finding.severity === 'warning').length,
  };

  const lines = [
    '# WashRadar Synthetic User Agent Report',
    '',
    `Target: ${BASE_URL}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Executive summary',
    '',
    `- Journeys: ${journeys.length}`,
    `- Passed cleanly: ${totals.passed}`,
    `- Passed with warnings: ${totals.warnings}`,
    `- Failed: ${totals.failed}`,
    `- Critical findings: ${totals.criticalFindings}`,
    `- Warnings: ${totals.warningsFound}`,
    '',
    'The agent is intentionally read-only against production. It does not create accounts, join queues, update queue counts, save queue targets, or submit other production-changing data.',
    '',
  ];

  for (const journey of journeys) {
    lines.push(`## ${journey.persona}`);
    lines.push('');
    lines.push(`Status: **${journey.status}**  `);
    lines.push(`Device: ${journey.device}  `);
    lines.push(`Duration: ${(journey.durationMs / 1000).toFixed(1)}s  `);
    lines.push(`Final URL: ${journey.finalUrl || 'unknown'}  `);
    lines.push(`Screenshot: ${journey.screenshot || 'not captured'}`);
    lines.push('');
    lines.push('### Steps');
    lines.push('');
    for (const result of journey.steps) {
      lines.push(`- ${result.status === 'passed' ? 'PASS' : 'FAIL'} — ${result.name} (${result.durationMs}ms)${result.detail ? ` — ${result.detail}` : ''}`);
    }
    lines.push('');

    lines.push('### Findings');
    lines.push('');
    if (journey.findings.length === 0) {
      lines.push('- No problems detected.');
    } else {
      for (const finding of journey.findings) {
        lines.push(`- **${finding.severity.toUpperCase()}** — ${finding.step}: ${finding.message}${finding.url ? ` (${finding.url})` : ''}`);
      }
    }
    lines.push('');

    lines.push('### Observed metrics');
    lines.push('');
    for (const [key, value] of Object.entries(journey.metrics)) {
      lines.push(`- ${key}: ${String(value)}`);
    }
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
  await writeFile(path.join(RESULTS_DIR, 'report.md'), markdown, 'utf8');
  await writeFile(path.join(RESULTS_DIR, 'report.json'), JSON.stringify({target: BASE_URL, generatedAt: new Date().toISOString(), totals, journeys}, null, 2), 'utf8');

  console.log(markdown);
  if (totals.failed > 0 || totals.criticalFindings > 0) process.exitCode = 1;
}

main().catch(error => {
  console.error(`Synthetic user agent crashed: ${messageOf(error)}`);
  process.exitCode = 1;
});
