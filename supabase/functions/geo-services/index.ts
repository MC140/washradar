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
  const db = serviceClient();
  const actorHash = await hashValue(parsed.data.clientId);
  if (parsed.data.action === 'routes') return routeMatrix(request, parsed.data, actorHash);
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const {count} = await db.from('api_request_log').select('id', {head: true, count: 'exact'}).eq('provider', 'google-geocode').eq('actor_hash', actorHash).gte('created_at', tenMinutesAgo);
  if ((count ?? 0) >= 8) return json(request, {error: 'Search limit reached. Try again shortly.'}, 429);
  const normalized = parsed.data.query.toLowerCase().replace(/\s+/g, ' ');
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
    if (!response.ok) {
      console.error(JSON.stringify({event: 'geocode_provider_http_error', status: response.status}));
      return json(request, {error: 'Address search is temporarily unavailable.'}, 502);
    }
    const result = await response.json();
    if (result.status === 'ZERO_RESULTS') return json(request, {point: null});
    if (result.status !== 'OK') {
      console.error(JSON.stringify({event: 'geocode_provider_error', status: result.status, message: result.error_message ?? 'unknown'}));
      return json(request, {error: 'Address search is temporarily unavailable.'}, 502);
    }
    const location = result.results?.[0]?.geometry?.location;
    if (!location) return json(request, {point: null});
    await db.from('geocode_cache').upsert({
      query_hash: queryHash,
      query_normalized: normalized,
      latitude: location.lat,
      longitude: location.lng,
      provider: 'google',
      expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
    });
    return json(request, {point: {lat: location.lat, lng: location.lng}, source: 'google'});
  } catch (error) {
    console.error(JSON.stringify({event: 'geocode_failed', message: error instanceof Error ? error.message : 'unknown'}));
    return json(request, {error: 'Address search is temporarily unavailable.'}, 502);
  }
});

async function routeMatrix(request: Request, input: Extract<z.infer<typeof schema>, {action: 'routes'}>, actorHash: string) {
  const db = serviceClient();
  const originCell = (Math.round(input.origin.lat * 100) / 100).toFixed(2) + ':' + (Math.round(input.origin.lng * 100) / 100).toFixed(2);
  const ids = input.destinations.map((item) => item.washId);
  const {data: cached} = await db.from('route_cache').select('wash_id,drive_minutes').eq('origin_cell', originCell).in('wash_id', ids).gt('expires_at', new Date().toISOString());
  const routes: Record<string, number> = Object.fromEntries((cached ?? []).map((item) => [item.wash_id, item.drive_minutes]));
  const missing = input.destinations.filter((item) => routes[item.washId] === undefined);
  if (!missing.length) return json(request, {routes, source: 'cache'});
  const key = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!key) return json(request, {routes, source: 'estimated'});
  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const {count} = await db.from('api_request_log').select('id', {head: true, count: 'exact'}).eq('provider', 'google-routes').eq('actor_hash', actorHash).gte('created_at', tenMinutesAgo);
  if ((count ?? 0) >= 5) return json(request, {routes, source: 'rate-limited'});
  const {data: quota} = await db.rpc('consume_api_quota', {p_provider: 'google-routes', p_daily_limit: Number(Deno.env.get('GOOGLE_ROUTES_DAILY_LIMIT') || 300)});
  if (!quota) return json(request, {routes, source: 'quota'});
  await db.from('api_request_log').insert({provider: 'google-routes', actor_hash: actorHash});
  try {
    const response = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition',
      },
      body: JSON.stringify({
        origins: [{waypoint: {location: {latLng: {latitude: input.origin.lat, longitude: input.origin.lng}}}}],
        destinations: missing.map((item) => ({waypoint: {location: {latLng: {latitude: item.point.lat, longitude: item.point.lng}}}})),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) return json(request, {routes, source: 'provider-unavailable'});
    const values = await response.json();
    for (const item of values) {
      if (item.condition !== 'ROUTE_EXISTS' || item.destinationIndex === undefined) continue;
      const target = missing[item.destinationIndex];
      const seconds = Number(String(item.duration ?? '0s').replace('s', ''));
      const minutes = Math.max(1, Math.ceil(seconds / 60));
      routes[target.washId] = minutes;
      await db.from('route_cache').upsert({
        origin_cell: originCell,
        wash_id: target.washId,
        drive_minutes: minutes,
        distance_metres: item.distanceMeters ?? 0,
        provider: 'google-routes',
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
    }
    return json(request, {routes, source: 'google-routes'});
  } catch (error) {
    console.error(JSON.stringify({event: 'route_matrix_failed', message: error instanceof Error ? error.message : 'unknown'}));
    return json(request, {routes, source: 'provider-unavailable'});
  }
}
