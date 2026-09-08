import {z} from 'npm:zod@4.1.8';
import {authenticatedUser, cors, distanceKm, hashValue, json, serviceClient} from '../_shared/http.ts';

const washType = z.enum(['touchless','soft-cloth','automatic','self-serve','hand-wash','tunnel']);
const point = z.object({lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180)});
const schema = z.discriminatedUnion('action', [
  z.object({action: z.literal('report'), washId: z.string().uuid(), clientId: z.string().uuid(), washTypes: z.array(washType).min(1).max(6), position: point.optional()}),
  z.object({action: z.literal('enrich'), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(5)}),
]);

type PlaceReview = {name?: string; text?: {text?: string}; publishTime?: string};
type PlaceDetails = {
  id?: string;
  displayName?: {text?: string};
  websiteUri?: string;
  editorialSummary?: {text?: string};
  reviews?: PlaceReview[];
};

type Match = {slug: z.infer<typeof washType>; label: string};

const PATTERNS: {slug: Match['slug']; label: string; patterns: RegExp[]}[] = [
  {slug: 'touchless', label: 'Touchless', patterns: [/\btouch[ -]?less\b/i, /\btouch[ -]?free\b/i, /\bbrush[ -]?less\b/i, /\bno[ -]?touch\b/i]},
  {slug: 'soft-cloth', label: 'Soft cloth', patterns: [/\bsoft[ -]?cloth\b/i, /\bsoft[ -]?touch\b/i, /\bfriction wash\b/i, /\bcloth wash\b/i]},
  {slug: 'self-serve', label: 'Self serve', patterns: [/\bself[ -]?serve\b/i, /\bself[ -]?service\b/i, /\bcoin(?:-op(?:erated)?)? wash\b/i, /\bwand wash\b/i]},
  {slug: 'hand-wash', label: 'Hand wash', patterns: [/\bhand[ -]?wash\b/i, /\bhand car wash\b/i]},
  {slug: 'tunnel', label: 'Tunnel', patterns: [/\btunnel wash\b/i, /\bexpress tunnel\b/i, /\bconveyor wash\b/i]},
  {slug: 'automatic', label: 'Automatic', patterns: [/\bautomatic car wash\b/i, /\bautomated car wash\b/i, /\bdrive[ -]?through car wash\b/i]},
];

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  if (request.method !== 'POST') return json(request, {error: 'Method not allowed.'}, 405);

  const user = await authenticatedUser(request);
  if (!user) return json(request, {error: 'A valid contributor session is required.'}, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Invalid wash-type request.'}, 400);

  const db = serviceClient();

  if (parsed.data.action === 'report') {
    const input = parsed.data;
    const {data: wash, error: washError} = await db.from('car_washes')
      .select('id,wash_locations!inner(latitude,longitude)')
      .eq('id', input.washId).eq('active', true).eq('data_environment', 'production').single();
    if (washError || !wash) return json(request, {error: 'That wash is unavailable.'}, 404);

    const actorHash = await hashValue(user.is_anonymous ? user.id + ':' + input.clientId : user.id);
    const location = Array.isArray(wash.wash_locations) ? wash.wash_locations[0] : wash.wash_locations;
    const proximity = input.position && distanceKm(input.position, {lat: Number(location.latitude), lng: Number(location.longitude)}) <= 0.35 ? 'nearby' : 'remote';
    const {data: reputation} = await db.from('contributor_reputation').select('score').eq('user_id', user.id).maybeSingle();
    const reputationScore = Math.max(0, Math.min(100, Number(reputation?.score ?? 50)));
    const {data: types} = await db.from('wash_types').select('id,slug').in('slug', input.washTypes);
    const typeMap = new Map((types ?? []).map((row) => [String(row.slug), String(row.id)]));

    for (const slug of [...new Set(input.washTypes)]) {
      const typeId = typeMap.get(slug);
      if (!typeId) continue;
      const {error} = await db.from('wash_type_reports').upsert({
        wash_id: input.washId,
        wash_type_id: typeId,
        user_id: user.id,
        actor_hash: actorHash,
        proximity,
        reputation_snapshot: reputationScore,
        disabled: false,
        updated_at: new Date().toISOString(),
      }, {onConflict: 'wash_id,wash_type_id,actor_hash'});
      if (error) return json(request, {error: 'Wash-type contribution could not be saved.'}, 500);
    }

    const {data: truth, error: recalcError} = await db.rpc('recalculate_wash_type_confidence', {p_wash_id: input.washId});
    if (recalcError) return json(request, {error: 'Wash-type confidence could not be recalculated.'}, 500);
    return json(request, {verification: proximity, truth: truth ?? []});
  }

  const admins = (Deno.env.get('ADMIN_EMAILS') ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (!user.email || !admins.includes(user.email.toLowerCase())) return json(request, {error: 'Administrator access is required.'}, 403);
  const key = Deno.env.get('GOOGLE_MAPS_SERVER_KEY');
  if (!key) return json(request, {error: 'Google Places is not configured.'}, 503);

  const start = parsed.data.offset;
  const end = start + parsed.data.limit - 1;
  const {data: refs, error: refsError} = await db.from('car_wash_provider_refs')
    .select('id,wash_id,provider_place_id,type_enriched_at')
    .eq('provider', 'google')
    .order('id', {ascending: true})
    .range(start, end);
  if (refsError) return json(request, {error: 'Google wash references could not be loaded.'}, 500);

  let processed = 0;
  let classified = 0;
  let websiteMatches = 0;
  let reviewMatches = 0;

  for (const ref of refs ?? []) {
    const placeId = String(ref.provider_place_id ?? '');
    if (!placeId) continue;
    const {data: quota} = await db.rpc('consume_api_quota', {p_provider: 'google-places-type-details', p_daily_limit: Number(Deno.env.get('GOOGLE_TYPE_ENRICH_DAILY_LIMIT') || 250)});
    if (!quota) return json(request, {error: 'Daily wash-type enrichment quota reached.', processed, classified, nextOffset: start + processed}, 429);

    const core = await fetchPlace(placeId, key, 'id,displayName,websiteUri');
    if (!core) { processed++; continue; }
    const washId = String(ref.wash_id);
    await db.from('wash_type_evidence').delete().eq('wash_id', washId).in('source_kind', ['google-name','official-website','google-editorial','google-review']);

    const name = core.displayName?.text ?? '';
    await insertEvidence(db, washId, findMatches(name), 'google-name', `google-name:${placeId}`, 95, 'Google business name');

    let websiteText = '';
    if (core.websiteUri) {
      await db.from('car_wash_provider_refs').update({website_uri: core.websiteUri}).eq('id', ref.id);
      websiteText = await fetchOfficialWebsiteText(core.websiteUri);
      const website = findMatches(websiteText);
      if (website.length) websiteMatches++;
      await insertEvidence(db, washId, website, 'official-website', core.websiteUri, 92, 'Official website');
    }

    const existingStrong = [...findMatches(name), ...findMatches(websiteText)].length > 0;
    if (!existingStrong) {
      const atmosphere = await fetchPlace(placeId, key, 'id,editorialSummary,reviews');
      if (atmosphere) {
        const editorial = findMatches(atmosphere.editorialSummary?.text ?? '');
        await insertEvidence(db, washId, editorial, 'google-editorial', `google-editorial:${placeId}`, 85, 'Google place summary');
        for (const review of atmosphere.reviews ?? []) {
          const text = review.text?.text ?? '';
          const matches = findMatches(text);
          if (!matches.length) continue;
          reviewMatches += matches.length;
          await insertEvidence(db, washId, matches, 'google-review', review.name ?? `review:${placeId}:${review.publishTime ?? crypto.randomUUID()}`, 55, 'Google review evidence');
        }
      }
    }

    const {data: truth} = await db.rpc('recalculate_wash_type_confidence', {p_wash_id: washId});
    if ((truth ?? []).length) classified++;
    await db.from('car_wash_provider_refs').update({type_enriched_at: new Date().toISOString()}).eq('id', ref.id);
    processed++;
  }

  const nextOffset = (refs?.length ?? 0) < parsed.data.limit ? null : start + parsed.data.limit;
  return json(request, {processed, classified, websiteMatches, reviewMatches, nextOffset});
});

function findMatches(text: string): Match[] {
  if (!text) return [];
  const normalized = text.replace(/\s+/g, ' ');
  const matches: Match[] = [];
  for (const item of PATTERNS) {
    const matched = item.patterns.some((pattern) => {
      const result = pattern.exec(normalized);
      if (!result) return false;
      const before = normalized.slice(Math.max(0, result.index - 18), result.index).toLowerCase();
      if (/\b(?:not|isn['’]?t|is not|no)\s+(?:a\s+)?$/.test(before)) return false;
      return true;
    });
    if (matched) matches.push({slug: item.slug, label: item.label});
  }
  return matches;
}

async function insertEvidence(db: ReturnType<typeof serviceClient>, washId: string, matches: Match[], sourceKind: string, sourceRef: string, confidence: number, label: string) {
  if (!matches.length) return;
  const {data: types} = await db.from('wash_types').select('id,slug').in('slug', matches.map((m) => m.slug));
  const map = new Map((types ?? []).map((row) => [String(row.slug), String(row.id)]));
  for (const match of matches) {
    const typeId = map.get(match.slug);
    if (!typeId) continue;
    await db.from('wash_type_evidence').upsert({
      wash_id: washId,
      wash_type_id: typeId,
      source_kind: sourceKind,
      source_ref: sourceRef,
      confidence_score: confidence,
      source_label: label,
      verified_at: new Date().toISOString(),
      active: true,
      updated_at: new Date().toISOString(),
    }, {onConflict: 'wash_id,wash_type_id,source_kind,source_ref'});
  }
}

async function fetchPlace(placeId: string, key: string, fieldMask: string): Promise<PlaceDetails | null> {
  try {
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask},
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return null;
    return await response.json() as PlaceDetails;
  } catch {
    return null;
  }
}

async function fetchOfficialWebsiteText(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!['http:','https:'].includes(url.protocol)) return '';
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return '';
    const response = await fetch(url, {redirect: 'follow', headers: {'User-Agent': 'WashRadar/1.0 catalogue verifier'}, signal: AbortSignal.timeout(8000)});
    if (!response.ok) return '';
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('text/html') && !type.includes('text/plain')) return '';
    const html = (await response.text()).slice(0, 250_000);
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .slice(0, 80_000);
  } catch {
    return '';
  }
}
