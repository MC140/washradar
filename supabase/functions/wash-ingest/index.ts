import {z} from 'npm:zod@4.1.8';
import {authenticatedUser, cors, json, serviceClient} from '../_shared/http.ts';

const schema = z.object({lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusMetres: z.number().int().min(500).max(50000).default(10000)});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  const user = await authenticatedUser(request);
  const admins = (Deno.env.get('ADMIN_EMAILS') ?? '').split(',').map((value) => value.trim().toLowerCase());
  if (!user?.email || !admins.includes(user.email.toLowerCase())) return json(request, {error: 'Administrator access is required.'}, 403);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Invalid discovery area.'}, 400);
  const key = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!key) return json(request, {error: 'Google Places is not configured.'}, 503);
  const db = serviceClient();
  const {data: quota} = await db.rpc('consume_api_quota', {p_provider: 'google-places-nearby', p_daily_limit: Number(Deno.env.get('GOOGLE_PLACES_DAILY_LIMIT') || 10)});
  if (!quota) return json(request, {error: 'Daily discovery quota reached.'}, 429);
  const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.types'},
    body: JSON.stringify({
      includedTypes: ['car_wash'],
      maxResultCount: 20,
      locationRestriction: {circle: {center: {latitude: parsed.data.lat, longitude: parsed.data.lng}, radius: parsed.data.radiusMetres}},
    }),
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) return json(request, {error: 'Places discovery failed.'}, 502);
  const body = await response.json();
  let imported = 0;
  let updated = 0;
  for (const place of body.places ?? []) {
    const {data: existingRef} = await db.from('car_wash_provider_refs').select('wash_id').eq('provider', 'google').eq('provider_place_id', place.id).maybeSingle();
    if (existingRef) {
      await db.from('car_washes').update({canonical_name: place.displayName?.text, rating: place.rating ?? null, rating_count: place.userRatingCount ?? 0, source_updated_at: new Date().toISOString()}).eq('id', existingRef.wash_id);
      await db.from('car_wash_provider_refs').update({last_fetched_at: new Date().toISOString(), metadata: {types: place.types ?? []}}).eq('provider', 'google').eq('provider_place_id', place.id);
      updated++;
      continue;
    }
    const {data: wash, error} = await db.from('car_washes').insert({
      canonical_name: place.displayName?.text ?? 'Car wash',
      rating: place.rating ?? null,
      rating_count: place.userRatingCount ?? 0,
      operating_status: 'unknown',
      data_environment: 'production',
      source_updated_at: new Date().toISOString(),
    }).select('id').single();
    if (error || !wash) continue;
    await Promise.all([
      db.from('wash_locations').insert({
        wash_id: wash.id,
        address_line: place.formattedAddress ?? 'Address unavailable',
        city: extractCity(place.formattedAddress ?? ''),
        region_name: 'Ontario',
        country_name: 'Canada',
        country_code: 'CA',
        postal_code: extractPostal(place.formattedAddress ?? ''),
        latitude: place.location.latitude,
        longitude: place.location.longitude,
      }),
      db.from('car_wash_provider_refs').insert({wash_id: wash.id, provider: 'google', provider_place_id: place.id, metadata: {types: place.types ?? []}}),
    ]);
    imported++;
  }
  return json(request, {imported, updated, discovered: body.places?.length ?? 0});
});

function extractCity(address: string) {
  const parts = address.split(',').map((value) => value.trim());
  return parts.length >= 3 ? parts[parts.length - 3] : 'Unknown';
}
function extractPostal(address: string) {
  return address.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i)?.[0]?.toUpperCase() ?? 'UNKNOWN';
}
