import {copyFile, mkdir, readFile} from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const indexUrl = new URL('index.html', dist);
const index = await readFile(indexUrl, 'utf8');
if (!index.includes('<div id="root"></div>')) throw new Error('Built index.html is missing the React root.');

// Keep the generic SPA fallback for unknown/dynamic routes such as /wash/:id.
await copyFile(indexUrl, new URL('404.html', dist));

// GitHub Pages otherwise returns HTTP 404 before React renders a known client route.
// Create real static entry points for store-facing and account/public routes so direct
// navigation gets an actual 200 response while React still owns the rendered screen.
const staticRoutes = [
  'saved',
  'alerts',
  'challenges',
  'vehicles',
  'profile',
  'auth/confirm',
  'privacy',
  'terms',
  'sponsored',
  'support',
  'account-deletion',
];

for (const route of staticRoutes) {
  const directory = new URL(`${route}/`, dist);
  await mkdir(directory, {recursive: true});
  await copyFile(indexUrl, new URL('index.html', directory));
}
