import {z} from 'npm:zod@4.1.8';
import {cors, hashValue, json, serviceClient} from '../_shared/http.ts';

const eventNames = ['app_opened','search','location_granted','wash_viewed','directions_clicked','best_right_now_selected','queue_report_started','queue_report_completed','queue_session_started','queue_session_completed','favourite','alert_created','ad_impression','ad_click'] as const;
const schema = z.object({
  name: z.enum(eventNames),
  clientId: z.string().uuid(),
  at: z.string().datetime(),
  properties: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).default({}),
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || JSON.stringify(parsed.data.properties).length > 2000) return json(request, {error: 'Invalid event.'}, 400);
  const db = serviceClient();
  const sessionHash = await hashValue(parsed.data.clientId);
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const {count} = await db.from('api_request_log').select('id', {head: true, count: 'exact'}).eq('provider', 'analytics').eq('actor_hash', sessionHash).gte('created_at', since);
  if ((count ?? 0) >= 60) return json(request, {ok: true, sampled: true});
  await Promise.all([
    db.from('api_request_log').insert({provider: 'analytics', actor_hash: sessionHash}),
    db.from('analytics_events').insert({session_hash: sessionHash, event_name: parsed.data.name, properties: parsed.data.properties}),
  ]);
  return json(request, {ok: true}, 201);
});
