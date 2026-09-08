import {z} from 'npm:zod@4.1.8';
import {authenticatedUser, cors, json, serviceClient} from '../_shared/http.ts';

const nearbySchema = z.object({
  action: z.literal('nearby').optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMetres: z.number().int().min(500).max(50000).default(10000),
});

const textSchema = z.object({
  action: z.literal('text'),
  query: z.string().min(2).max(120),
  pageToken: z.string().min(1).max(2048).optional(),
});

const schema = z.union([nearbySchema, textSchema]);

type GooglePeriod = {
  open?: {day?: number; hour?: number; minute?: number};
  close?: {day?: number; hour?: number; minute?: number};
};

type AddressComponent = {longText?: string; shortText?: string; types?: string[]};
type GooglePlace = {
  id: string;
  displayName?: {text?: string};
  formattedAddress?: string;
  addressComponents?: AddressComponent[];
  location?: {latitude?: number; longitude?: number};
  rating?: number;
  userRatingCount?: number;
  types?: string[];
  businessStatus?: string;
  regularOpeningHours?: {periods?: GooglePeriod[]};
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});

  const user = await authenticatedUser(request);
  const admins = (Deno.env.get('ADMIN_EMAILS') ?? '').split(',').map((value) => value.trim().toLowerCase());
  if (!user?.email || !admins.includes(user.email.toLowerCase())) {
    return json(request, {error: 'Administrator access is required.'}, 403);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Invalid discovery request.'}, 400);

  const key = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!key) return json(request, {error: 'Google Places is not configured.'}, 503);
  const db = serviceClient();

  const isText = parsed.data.action === 'text';
  const quotaProvider = isText ? 'google-places-text' : 'google-places-nearby';
  const {data: quota} = await db.rpc('consume_api_quota', {
    p_provider: quotaProvider,
    p_daily_limit: Number(Deno.env.get('GOOGLE_PLACES_DAILY_LIMIT') || 500),
  });
  if (!quota) return json(request, {error: 'Daily discovery quota reached.'}, 429);

  let discoveredPlaces: GooglePlace[] = [];
  let nextPageToken: string | null = null;

  if (isText) {
    const searchBody: Record<string, unknown> = {
      textQuery: parsed.data.query,
      pageSize: 20,
      includedType: 'car_wash',
      strictTypeFiltering: true,
      regionCode: 'CA',
      languageCode: 'en',
    };
    if (parsed.data.pageToken) searchBody.pageToken = parsed.data.pageToken;

    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        // ID-only Text Search keeps discovery inexpensive; details are fetched below only for the returned IDs.
        'X-Goog-FieldMask': 'places.id,nextPageToken',
      },
      body: JSON.stringify(searchBody),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return json(request, {error: 'Places text search failed.'}, 502);
    const body = await response.json();
    nextPageToken = body.nextPageToken ?? null;

    const ids = [...new Set((body.places ?? []).map((place: {id?: string}) => place.id).filter(Boolean))] as string[];
    discoveredPlaces = await fetchPlaceDetails(ids, key);
  } else {
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({
        includedTypes: ['car_wash'],
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: {latitude: parsed.data.lat, longitude: parsed.data.lng},
            radius: parsed.data.radiusMetres,
          },
        },
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return json(request, {error: 'Places discovery failed.'}, 502);
    const body = await response.json();
    const ids = [...new Set((body.places ?? []).map((place: {id?: string}) => place.id).filter(Boolean))] as string[];
    discoveredPlaces = await fetchPlaceDetails(ids, key);
  }

  let imported = 0;
  let updated = 0;
  let hoursRefreshed = 0;
  let failed = 0;

  for (const place of discoveredPlaces) {
    if (!place.id || place.location?.latitude == null || place.location?.longitude == null) {
      failed++;
      continue;
    }

    const {data: existingRef} = await db.from('car_wash_provider_refs')
      .select('wash_id')
      .eq('provider', 'google')
      .eq('provider_place_id', place.id)
      .maybeSingle();

    let washId: string | null = existingRef?.wash_id ?? null;
    const address = addressParts(place.addressComponents ?? [], place.formattedAddress ?? '');

    if (washId) {
      await db.from('car_washes').update({
        canonical_name: place.displayName?.text ?? 'Car wash',
        rating: place.rating ?? null,
        rating_count: place.userRatingCount ?? 0,
        google_business_status: place.businessStatus ?? null,
        source_updated_at: new Date().toISOString(),
      }).eq('id', washId);

      await db.from('wash_locations').update({
        address_line: place.formattedAddress ?? 'Address unavailable',
        city: address.city,
        region_name: 'Ontario',
        country_name: 'Canada',
        country_code: 'CA',
        postal_code: address.postalCode,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
      }).eq('wash_id', washId).eq('is_primary', true);

      await db.from('car_wash_provider_refs').update({
        last_fetched_at: new Date().toISOString(),
        metadata: {types: place.types ?? [], businessStatus: place.businessStatus ?? null},
      }).eq('provider', 'google').eq('provider_place_id', place.id);
      updated++;
    } else {
      const {data: wash, error} = await db.from('car_washes').insert({
        canonical_name: place.displayName?.text ?? 'Car wash',
        rating: place.rating ?? null,
        rating_count: place.userRatingCount ?? 0,
        google_business_status: place.businessStatus ?? null,
        operating_status: 'unknown',
        data_environment: 'production',
        source_updated_at: new Date().toISOString(),
      }).select('id').single();
      if (error || !wash) {
        failed++;
        continue;
      }
      washId = wash.id;

      const [locationResult, refResult] = await Promise.all([
        db.from('wash_locations').insert({
          wash_id: wash.id,
          address_line: place.formattedAddress ?? 'Address unavailable',
          city: address.city,
          region_name: 'Ontario',
          country_name: 'Canada',
          country_code: 'CA',
          postal_code: address.postalCode,
          latitude: place.location.latitude,
          longitude: place.location.longitude,
        }),
        db.from('car_wash_provider_refs').insert({
          wash_id: wash.id,
          provider: 'google',
          provider_place_id: place.id,
          metadata: {types: place.types ?? [], businessStatus: place.businessStatus ?? null},
        }),
      ]);
      if (locationResult.error || refResult.error) {
        failed++;
        continue;
      }
      imported++;
    }

    if (washId) {
      const rows = openingHourRows(washId, place.regularOpeningHours?.periods ?? []);
      await db.from('business_hours').delete().eq('wash_id', washId);
      if (rows.length) {
        const {error} = await db.from('business_hours').insert(rows);
        if (!error) hoursRefreshed++;
      }
    }
  }

  return json(request, {
    imported,
    updated,
    hoursRefreshed,
    failed,
    discovered: discoveredPlaces.length,
    nextPageToken,
  });
});

async function fetchPlaceDetails(ids: string[], key: string): Promise<GooglePlace[]> {
  const results: GooglePlace[] = [];
  // Keep concurrency modest so an admin import does not hammer Google or Supabase.
  for (let index = 0; index < ids.length; index += 5) {
    const batch = ids.slice(index, index + 5);
    const values = await Promise.all(batch.map(async (id) => {
      const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
        headers: {
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'id,displayName,formattedAddress,addressComponents,location,rating,userRatingCount,types,businessStatus,regularOpeningHours',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) return null;
      return await response.json() as GooglePlace;
    }));
    results.push(...values.filter((value): value is GooglePlace => Boolean(value)));
  }
  return results;
}

function openingHourRows(washId: string, periods: GooglePeriod[]) {
  if (!periods.length) return [];
  const byDay = new Map<number, {opens_at: string; closes_at: string; closed: boolean}>();

  for (const period of periods) {
    const open = period.open;
    const close = period.close;
    if (open?.day == null || open.hour == null || open.minute == null) continue;
    const weekday = Number(open.day);
    if (weekday < 0 || weekday > 6) continue;

    if (!close || close.day == null || close.hour == null || close.minute == null) {
      byDay.set(weekday, {opens_at: '00:00:00', closes_at: '23:59:59', closed: false});
      continue;
    }

    // Current storage has one regular interval per weekday. Car-wash hours are normally a single daily span.
    // Cross-midnight/multiple-period businesses stay conservative rather than inventing a schedule.
    if (Number(close.day) !== weekday) continue;
    byDay.set(weekday, {
      opens_at: toTime(Number(open.hour), Number(open.minute)),
      closes_at: toTime(Number(close.hour), Number(close.minute)),
      closed: false,
    });
  }

  return Array.from({length: 7}, (_, weekday) => {
    const value = byDay.get(weekday);
    return value
      ? {wash_id: washId, weekday, ...value}
      : {wash_id: washId, weekday, opens_at: null, closes_at: null, closed: true};
  });
}

function addressParts(parts: AddressComponent[], formatted: string) {
  const get = (...types: string[]) => parts.find((part) => part.types?.some((type) => types.includes(type)))?.longText;
  return {
    city: get('locality', 'postal_town', 'administrative_area_level_3') || fallbackCity(formatted),
    postalCode: get('postal_code') || formatted.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i)?.[0]?.toUpperCase() || 'UNKNOWN',
  };
}

function fallbackCity(address: string) {
  const parts = address.split(',').map((value) => value.trim());
  return parts.length >= 3 ? parts[parts.length - 3] : 'Unknown';
}

function toTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}
