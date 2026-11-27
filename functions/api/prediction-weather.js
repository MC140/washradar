// Cloudflare Pages Function: fixed regional query, no user location or paid API.
// Source: Environment and Climate Change Canada, MSC GeoMet SWOB real-time observations.
// https://api.weather.gc.ca/collections/swob-realtime/schema?f=html
const SOURCE = 'https://api.weather.gc.ca/collections/swob-realtime/items';
const MAX_AGE = 2 * 60 * 60 * 1000;
const CACHE_SECONDS = 1800;

const numeric = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;

export function normalizeObservations(data, now = Date.now()) {
  const stations = new Map();
  for (const feature of Array.isArray(data?.features) ? data.features : []) {
    const coords = feature.geometry?.coordinates;
    const p = feature.properties ?? {};
    if (!Array.isArray(coords)) continue;
    const [lng, lat] = coords;
    if (numeric(lat, 43, 45) === null || numeric(lng, -81, -78) === null) continue;
    const observedAt = p['date_tm-value'];
    const age = now - Date.parse(observedAt);
    if (!Number.isFinite(age) || age < -300000 || age > MAX_AGE) continue;
    const temperatureC = numeric(p.air_temp, -60, 55) ?? numeric(p.avg_air_temp_pst1hr, -60, 55);
    const precipitation1hMm = numeric(p.pcpn_amt_pst1hr, 0, 150);
    const precipitation24hMm = numeric(p.pcpn_amt_pst24hrs, 0, 300);
    if (temperatureC === null) continue;
    const key = String(p['msc_id-value'] ?? p['icao_stn_id-value'] ?? lat + ',' + lng);
    const row = {lat, lng, observedAt, temperatureC, precipitation1hMm, precipitation24hMm};
    // Prefer the latest complete precipitation observation when available.
    const prev = stations.get(key);
    const complete = precipitation1hMm !== null && precipitation24hMm !== null;
    const prevComplete = prev?.precipitation1hMm !== null && prev?.precipitation24hMm !== null;
    if (!prev || (complete && !prevComplete) || (complete === prevComplete && Date.parse(observedAt) > Date.parse(prev.observedAt))) stations.set(key, row);
  }
  return [...stations.values()];
}

export async function onRequestGet({request, waitUntil}) {
  const key = new Request(new URL('/api/prediction-weather', request.url).href);
  const cache = caches.default;
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const now = Date.now();
    const url = new URL(SOURCE);
    url.searchParams.set('f', 'json');
    url.searchParams.set('bbox', '-80.2,43.2,-78.4,44.4');
    url.searchParams.set('datetime', new Date(now - MAX_AGE).toISOString() + '/' + new Date(now).toISOString());
    url.searchParams.set('limit', '500');
    const response = await fetch(url, {signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('Weather source unavailable');
    const observations = normalizeObservations(await response.json(), now);
    if (!observations.length) throw new Error('No fresh regional observations');
    const result = Response.json({source: 'ECCC MSC GeoMet SWOB', observations}, {headers: {'Cache-Control': 'public, max-age=' + CACHE_SECONDS}});
    waitUntil(cache.put(key, result.clone()).catch(() => {}));
    return result;
  } catch {
    // Cached negative responses prevent retry storms; never invent weather.
    const result = Response.json({source: 'ECCC MSC GeoMet SWOB', observations: []}, {headers: {'Cache-Control': 'public, max-age=300'}});
    waitUntil(cache.put(key, result.clone()).catch(() => {}));
    return result;
  }
}
