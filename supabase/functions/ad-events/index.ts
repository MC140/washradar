import {z} from 'npm:zod@4.1.8';
import {cors, hashValue, json, serviceClient} from '../_shared/http.ts';

const schema = z.object({
  event: z.enum(['impression', 'click']),
  creativeId: z.string().uuid(),
  campaignId: z.string().uuid(),
  placement: z.string().min(2).max(80),
  clientId: z.string().uuid(),
  washId: z.string().uuid().optional(),
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  if (request.method !== 'POST') return json(request, {error: 'Method not allowed.'}, 405);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Invalid advertising event.'}, 400);
  const input = parsed.data;
  const db = serviceClient();
  const sessionHash = await hashValue(input.clientId);
  const [{data: campaign}, {data: creative}, {data: placement}] = await Promise.all([
    db.from('ad_campaigns').select('id,status,starts_at,ends_at').eq('id', input.campaignId).single(),
    db.from('ad_creatives').select('id,campaign_id,active').eq('id', input.creativeId).single(),
    db.from('ad_placements').select('id,active').eq('slug', input.placement).single(),
  ]);
  const now = Date.now();
  if (!campaign || campaign.status !== 'active' || new Date(campaign.starts_at).getTime() > now || new Date(campaign.ends_at).getTime() < now ||
      !creative?.active || creative.campaign_id !== campaign.id || !placement?.active) {
    return json(request, {error: 'Campaign is not eligible.'}, 409);
  }
  try {
    if (input.event === 'impression') {
      const since = new Date(Date.now() - 30_000).toISOString();
      const {count} = await db.from('ad_impressions').select('id', {head: true, count: 'exact'}).eq('session_hash', sessionHash).eq('creative_id', input.creativeId).gte('created_at', since);
      if ((count ?? 0) > 0) return json(request, {ok: true, deduplicated: true});
      await db.from('ad_impressions').insert({campaign_id: input.campaignId, creative_id: input.creativeId, placement_id: placement.id, session_hash: sessionHash, wash_id: input.washId});
    } else {
      await db.from('ad_clicks').insert({campaign_id: input.campaignId, creative_id: input.creativeId, placement_id: placement.id, session_hash: sessionHash});
    }
    return json(request, {ok: true}, 201);
  } catch (error) {
    console.error(JSON.stringify({event: 'ad_event_failed', type: input.event, message: error instanceof Error ? error.message : 'unknown'}));
    return json(request, {error: 'Event could not be recorded.'}, 500);
  }
});
