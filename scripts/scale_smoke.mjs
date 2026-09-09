import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const concurrency = clamp(Number(process.env.CONCURRENCY || 20), 1, 100);
const totalRequests = clamp(Number(process.env.REQUESTS || 200), concurrency, 2000);
const siteUrl = process.env.SITE_URL || 'https://washradar.ca/';
const maxErrorRate = Number(process.env.MAX_ERROR_RATE || 0.01);
const maxP95Ms = Number(process.env.MAX_P95_MS || 2000);

const production = JSON.parse(await readFile(new URL('../src/config/production.json', import.meta.url), 'utf8'));
const rpcUrl = `${production.supabaseUrl}/rest/v1/rpc/nearby_washes_json`;
const headers = {
  apikey: production.supabasePublishableKey,
  authorization: `Bearer ${production.supabasePublishableKey}`,
  'content-type': 'application/json',
};

const siteResponse = await fetch(siteUrl, {redirect: 'follow'});
if (!siteResponse.ok) throw new Error(`Site smoke failed: ${siteResponse.status}`);

let cursor = 0;
let failures = 0;
const latencies = [];

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= totalRequests) return;
    const started = performance.now();
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({p_lat: 43.6532, p_lng: -79.3832, p_radius_km: 25}),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.arrayBuffer();
    } catch (error) {
      failures += 1;
      console.error(`request ${index + 1} failed:`, error instanceof Error ? error.message : error);
    } finally {
      latencies.push(performance.now() - started);
    }
  }
}

await Promise.all(Array.from({length: concurrency}, () => worker()));
latencies.sort((a, b) => a - b);
const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] || 0;
const p50 = percentile(0.50);
const p95 = percentile(0.95);
const p99 = percentile(0.99);
const errorRate = failures / totalRequests;

console.log(JSON.stringify({
  siteUrl,
  concurrency,
  totalRequests,
  failures,
  errorRate: Number(errorRate.toFixed(4)),
  p50Ms: Math.round(p50),
  p95Ms: Math.round(p95),
  p99Ms: Math.round(p99),
}, null, 2));

if (errorRate > maxErrorRate) {
  throw new Error(`Error rate ${(errorRate * 100).toFixed(2)}% exceeded ${(maxErrorRate * 100).toFixed(2)}%`);
}
if (p95 > maxP95Ms) {
  throw new Error(`p95 ${Math.round(p95)}ms exceeded ${maxP95Ms}ms`);
}
