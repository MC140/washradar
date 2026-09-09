import {z} from 'npm:zod@4.1.8';
import {cors, hashValue, json, serviceClient} from '../_shared/http.ts';

const point = z.object({lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180)});
const schema = z.discriminatedUnion('action', [
  z.object({action: z.literal('geocode'), query: z.string().trim().min(3).max(180), clientId: z.string().uuid()}),
  z.object({action: z.literal('routes'), origin: point, destinations: z.array(z.object({washId: z.string().uuid(), point})).min(1).max(10), clientId: z.string().uuid()}),
]);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  if (request.method !== 'POST') return json(request, {error: 'Method not allowed.'}, 405);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Enter a valid city, postal code or address.'}, 400);

  if (parsed.data.action === 'routes') return json(request, {routes: {}, source: 'disabled-zero-cost'});

  const db = serviceClient();
  const actorHash = await hashValue(parsed.data.clientId);
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const {count} = await db.from('api_request_log').select('id', {head: true, count: 'exact'}).eq('provider', 'google-geocode').eq('actor_hash', actorHash).gte('created_at', tenMinutesAgo);
  if ((count ?? 0) >= 8) return json(request, {error: 'Search limit reached. Try again shortly.'}, 429);

  // Fallback geocoding stores only a salted hash of the query. Exact home-address text
  // is unnecessary for cache reuse and is deliberately not retained.
  const normalized = parsed.data.query.toLowerCase().replace(/\s+/g, ' ').trim();
  const queryHash = await hashValue(normalized);
  const {data: cached} = await db.from('geocode_cache').select('latitude,longitude').eq('query_hash', queryHash).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (cached) return json(request, {point: {lat: Number(cached.latitude), lng: Number(cached.longitude)}, source: 'cache'});

  const key = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!key) return json(request, {error: 'Address search is not configured.'}, 503);
  const {data: quota} = await db.rpc('consume_api_quota', {p_provider: 'google-geocode', p_daily_limit: Number(Deno.env.get('GOOGLE_GEOCODE_DAILY_LIMIT') || 200)});
  if (!quota) return json(request, {error: 'Address search is resting for today. Use current location instead.'}, 429);
  await db.from('api_request_log').insert({provider: 'google-geocode', actor_hash: actorHash});

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', parsed.data.query);
  url.searchParams.set('components', 'country:CA');
  url.searchParams.set('key', key);
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(6000)});
    if (!response.ok) return json(request, {error: 'Address search is temporarily unavailable.'}, 502);
    const result = await response.json();
    if (result.status === 'ZERO_RESULTS') return json(request, {point: null});
    if (result.status !== 'OK') return json(request, {error: 'Address search is temporarily unavailable.'}, 502);
    const location = result.results?.[0]?.geometry?.location;
    if (!location) return json(request, {point: null});
    await db.from('geocode_cache').upsert({
      query_hash: queryHash,
      query_normalized: null,
      latitude: location.lat,
      longitude: location.lng,
      provider: 'google',
      expires_at: new Date(Date.now() + 365 * 86400_000).toISOString(),
    });
    return json(request, {point: {lat: location.lat, lng: location.lng}, source: 'google'});
  } catch (error) {
    console.error(JSON.stringify({event: 'geocode_failed', message: error instanceof Error ? error.message : 'unknown'}));
    return json(request, {error: 'Address search is temporarily unavailable.'}, 502);
  }
});
