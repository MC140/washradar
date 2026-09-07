import {copyFile, readFile} from 'node:fs/promises';
const index = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
if (!index.includes('<div id="root"></div>')) throw new Error('Built index.html is missing the React root.');
await copyFile(new URL('../dist/index.html', import.meta.url), new URL('../dist/404.html', import.meta.url));
