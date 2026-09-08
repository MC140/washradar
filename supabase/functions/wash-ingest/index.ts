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

const stateSchema = z.object({action: z.literal('state'), jobKey: z.string().min(1).max(80).default('gta-full')});
const checkpointSchema = z.object({
  action: z.literal('checkpoint'),
  jobKey: z.string().min(1).max(80).default('gta-full'),
  nextIndex: z.number().int().min(0),
  total: z.number().int().min(1).max(500),
  lastArea: z.string().max(180).optional(),
  lastError: z.string().max(500).nullable().optional(),
  pageToken: z.string().max(2048).nullable().optional(),
  pageNumber: z.number().int().min(0).default(0),
  completed: z.boolean().default(false),
});
const enrichSchema = z.object({
  action: z.literal('enrich'),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(40).default(20),
});
const fsaAuditSchema = z.object({action: z.literal('fsa-audit')});

const schema = z.union([nearbySchema, textSchema, stateSchema, checkpointSchema, enrichSchema, fsaAuditSchema]);

type GoogleTime = {day?: number; hour?: number; minute?: number};
type GooglePeriod = {open?: GoogleTime; close?: GoogleTime};
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

type ProcessSummary = {imported: number; updated: number; hoursRefreshed: number; typed: number; failed: number};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});

  const user = await authenticatedUser(request);
  const admins = (Deno.env.get('ADMIN_EMAILS') ?? '').split(',').map((value) => value.trim().toLowerCase());
  if (!user?.email || !admins.includes(user.email.toLowerCase())) {
    return json(request, {error: 'Administrator access is required.'}, 403);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Invalid catalogue request.'}, 400);

  const db = serviceClient();

  if (parsed.data.action === 'state') {
    const {data, error} = await db.from('catalogue_import_state').select('*').eq('job_key', parsed.data.jobKey).maybeSingle();
    if (error) return json(request, {error: 'Catalogue progress could not be loaded.'}, 500);
    return json(request, {state: data});
  }

  if (parsed.data.action === 'checkpoint') {
    const now = new Date().toISOString();
    const {error} = await db.from('catalogue_import_state').upsert({
      job_key: parsed.data.jobKey,
      next_index: parsed.data.nextIndex,
      total: parsed.data.total,
      last_area: parsed.data.lastArea ?? null,
      last_error: parsed.data.lastError ?? null,
      page_token: parsed.data.pageToken ?? null,
      page_number: parsed.data.pageNumber,
      completed_at: parsed.data.completed ? now : null,
      updated_at: now,
    });
    if (error) return json(request, {error: 'Catalogue progress could not be saved.'}, 500);
    return json(request, {ok: true});
  }

  if (parsed.data.action === 'fsa-audit') {
    const {data: rows, error} = await db.from('wash_locations').select('postal_code,wash_id');
    if (error) return json(request, {error: 'FSA coverage could not be calculated.'}, 500);
    const counts = new Map<string, number>();
    let unknownPostal = 0;
    for (const row of rows ?? []) {
      const normalized = String(row.postal_code ?? '').replace(/\s+/g, '').toUpperCase();
      const fsa = /^[A-Z]\d[A-Z]/.test(normalized) ? normalized.slice(0, 3) : null;
      if (!fsa) { unknownPostal++; continue; }
      counts.set(fsa, (counts.get(fsa) ?? 0) + 1);
    }
    const fsas = [...counts.entries()].map(([fsa, washCount]) => ({fsa, washCount})).sort((a, b) => a.fsa.localeCompare(b.fsa));
    return json(request, {
      fsas,
      uniqueFsaCount: fsas.length,
      suspiciousSparse: fsas.filter((item) => item.washCount <= 1),
      unknownPostal,
    });
  }

  const key = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!key) return json(request, {error: 'Google Places is not configured.'}, 503);

  if (parsed.data.action === 'enrich') {
    const start = parsed.data.offset;
    const end = start + parsed.data.limit - 1;
    const {data: refs, error} = await db.from('car_wash_provider_refs')
      .select('id,wash_id,provider_place_id')
      .eq('provider', 'google')
      .order('id', {ascending: true})
      .range(start, end);
    if (error) return json(request, {error: 'Existing Google references could not be loaded.'}, 500);
    const ids = (refs ?? []).map((row) => row.provider_place_id as string).filter(Boolean);
    const places = await fetchPlaceDetails(ids, key);
    const summary = await processPlaces(db, places);
    const nextOffset = (refs?.length ?? 0) < parsed.data.limit ? null : start + parsed.data.limit;
    return json(request, {...summary, processed: refs?.length ?? 0, nextOffset});
  }

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

  const summary = await processPlaces(db, discoveredPlaces);
  return json(request, {...summary, discovered: discoveredPlaces.length, nextPageToken});
});

async function processPlaces(db: ReturnType<typeof serviceClient>, places: GooglePlace[]): Promise<ProcessSummary> {
  let imported = 0;
  let updated = 0;
  let hoursRefreshed = 0;
  let typed = 0;
  let failed = 0;

  const {data: typeRows} = await db.from('wash_types').select('id,slug');
  const typeIds = new Map((typeRows ?? []).map((row) => [String(row.slug), String(row.id)]));

  for (const place of places) {
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
      const {error: washError} = await db.from('car_washes').update({
        canonical_name: place.displayName?.text ?? 'Car wash',
        rating: place.rating ?? null,
        rating_count: place.userRatingCount ?? 0,
        google_business_status: place.businessStatus ?? null,
        source_updated_at: new Date().toISOString(),
      }).eq('id', washId);
      if (washError) { failed++; continue; }

      await db.from('wash_locations').update({
        address_line: place.formattedAddress ?? 'Address unavailable',
        city: address.city,
        region_name: address.region || 'Ontario',
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
      if (error || !wash) { failed++; continue; }
      washId = wash.id;

      const [locationResult, refResult] = await Promise.all([
        db.from('wash_locations').insert({
          wash_id: wash.id,
          address_line: place.formattedAddress ?? 'Address unavailable',
          city: address.city,
          region_name: address.region || 'Ontario',
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
      if (locationResult.error || refResult.error) { failed++; continue; }
      imported++;
    }

    if (!washId) continue;

    const rows = openingHourRows(washId, place.regularOpeningHours?.periods ?? []);
    const {error: deleteHoursError} = await db.from('business_hours').delete().eq('wash_id', washId);
    if (!deleteHoursError && rows.length) {
      const {error: hoursError} = await db.from('business_hours').insert(rows);
      if (!hoursError) hoursRefreshed++;
    }

    await db.from('car_wash_types').delete().eq('wash_id', washId).eq('source_label', 'google-name-explicit');
    const classifications = classifyWashTypes(place.displayName?.text ?? '');
    const links = classifications
      .map((slug) => ({slug, typeId: typeIds.get(slug)}))
      .filter((item): item is {slug: string; typeId: string} => Boolean(item.typeId))
      .map((item) => ({
        wash_id: washId,
        wash_type_id: item.typeId,
        source_label: 'google-name-explicit',
        confidence_score: 95,
        verified_at: new Date().toISOString(),
      }));
    if (links.length) {
      const {error: typeError} = await db.from('car_wash_types').upsert(links, {onConflict: 'wash_id,wash_type_id'});
      if (!typeError) typed++;
    }
  }

  return {imported, updated, hoursRefreshed, typed, failed};
}

async function fetchPlaceDetails(ids: string[], key: string): Promise<GooglePlace[]> {
  const results: GooglePlace[] = [];
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

  if (periods.length === 1) {
    const only = periods[0];
    const openDay = only.open?.day;
    const openHour = only.open?.hour ?? 0;
    const openMinute = only.open?.minute ?? 0;
    if (openDay === 0 && openHour === 0 && openMinute === 0 && !only.close) {
      return Array.from({length: 7}, (_, weekday) => ({
        wash_id: washId,
        weekday,
        opens_at: '00:00:00',
        closes_at: '23:59:59',
        closed: false,
      }));
    }
  }

  const rows: {wash_id: string; weekday: number; opens_at: string | null; closes_at: string | null; closed: boolean}[] = [];
  const daysWithHours = new Set<number>();

  const addInterval = (weekday: number, opensAt: string, closesAt: string) => {
    rows.push({wash_id: washId, weekday, opens_at: opensAt, closes_at: closesAt, closed: false});
    daysWithHours.add(weekday);
  };

  for (const period of periods) {
    const open = period.open;
    if (open?.day == null) continue;
    const openDay = Number(open.day);
    if (openDay < 0 || openDay > 6) continue;
    const openTime = toTime(Number(open.hour ?? 0), Number(open.minute ?? 0));
    const close = period.close;

    if (!close || close.day == null) {
      addInterval(openDay, openTime, '23:59:59');
      continue;
    }

    const closeDay = Number(close.day);
    if (closeDay < 0 || closeDay > 6) continue;
    const closeTime = toTime(Number(close.hour ?? 0), Number(close.minute ?? 0));

    if (closeDay === openDay) {
      if (openTime === closeTime && openTime === '00:00:00') addInterval(openDay, '00:00:00', '23:59:59');
      else addInterval(openDay, openTime, closeTime);
      continue;
    }

    addInterval(openDay, openTime, '23:59:59');
    let day = (openDay + 1) % 7;
    let guard = 0;
    while (day !== closeDay && guard < 7) {
      addInterval(day, '00:00:00', '23:59:59');
      day = (day + 1) % 7;
      guard++;
    }
    if (closeTime !== '00:00:00') addInterval(closeDay, '00:00:00', closeTime);
  }

  for (let weekday = 0; weekday < 7; weekday++) {
    if (!daysWithHours.has(weekday)) {
      rows.push({wash_id: washId, weekday, opens_at: null, closes_at: null, closed: true});
    }
  }

  return rows;
}

function classifyWashTypes(name: string) {
  const value = name.toLowerCase();
  const result = new Set<string>();
  if (/\btouchless\b|\btouch[- ]?free\b/.test(value)) result.add('touchless');
  if (/\bsoft[- ]?(cloth|touch)\b/.test(value)) result.add('soft-cloth');
  if (/\bself[- ]?serve\b|\bself service\b|\bcoin[- ]?(op|operated|wash)\b/.test(value)) result.add('self-serve');
  if (/\bhand[- ]?wash\b|\bhand car wash\b/.test(value)) result.add('hand-wash');
  if (/\btunnel\b/.test(value)) result.add('tunnel');
  if (/\bautomatic\b/.test(value)) result.add('automatic');
  return [...result];
}

function addressParts(parts: AddressComponent[], formatted: string) {
  const getLong = (...types: string[]) => parts.find((part) => part.types?.some((type) => types.includes(type)))?.longText;
  const getShort = (...types: string[]) => parts.find((part) => part.types?.some((type) => types.includes(type)))?.shortText;
  return {
    city: getLong('locality', 'postal_town', 'administrative_area_level_3') || fallbackCity(formatted),
    region: getShort('administrative_area_level_1') || getLong('administrative_area_level_1') || 'Ontario',
    postalCode: getLong('postal_code') || formatted.match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i)?.[0]?.toUpperCase() || 'UNKNOWN',
  };
}

function fallbackCity(address: string) {
  const parts = address.split(',').map((value) => value.trim());
  return parts.length >= 3 ? parts[parts.length - 3] : 'Unknown';
}

function toTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}
