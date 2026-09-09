import {z} from 'npm:zod@4.1.8';
import {cors, hashValue, json, serviceClient} from '../_shared/http.ts';

const eventNames = [
  'app_opened','search','location_granted','wash_viewed','directions_clicked',
  'best_right_now_selected','queue_report_started','queue_report_completed',
  'wash_type_reported','queue_session_started','queue_session_completed','favourite',
  'alert_created','ad_impression','ad_click',
] as const;

const eventSchema = z.object({
  name: z.enum(eventNames),
  at: z.string().datetime(),
  properties: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).default({}),
});

const batchSchema = z.object({
  clientId: z.string().uuid(),
  events: z.array(eventSchema).min(1).max(8),
});

// Keep the old single-event payload valid briefly so already-open browser tabs from
// the previous deployment do not fail while the service worker updates.
const singleSchema = eventSchema.extend({clientId: z.string().uuid()});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  if (request.method !== 'POST') return json(request, {error: 'Method not allowed.'}, 405);

  const body = await request.json().catch(() => null);
  const batch = batchSchema.safeParse(body);
  const single = batch.success ? null : singleSchema.safeParse(body);
  if (!batch.success && !single?.success) return json(request, {error: 'Invalid event.'}, 400);

  const clientId = batch.success ? batch.data.clientId : single!.data.clientId;
  const events = batch.success
    ? batch.data.events
    : [{name: single!.data.name, at: single!.data.at, properties: single!.data.properties}];

  if (events.some((event) => JSON.stringify(event.properties).length > 2000)) {
    return json(request, {error: 'Invalid event.'}, 400);
  }

  const db = serviceClient();
  const sessionHash = await hashValue(clientId);
  const since = new Date(Date.now() - 10 * 60_000).toISOString();

  // Limit batches rather than individual events. With a max batch of 8 this still
  // caps a single client to 160 accepted events per 10 minutes, while normal users
  // require far fewer Edge Function invocations than the previous one-event-per-call path.
  const {count} = await db.from('api_request_log')
    .select('id', {head: true, count: 'exact'})
    .eq('provider', 'analytics')
    .eq('actor_hash', sessionHash)
    .gte('created_at', since);
  if ((count ?? 0) >= 20) return json(request, {ok: true, sampled: true});

  const rows = events.map((event) => ({
    session_hash: sessionHash,
    event_name: event.name,
    properties: event.properties,
  }));

  await Promise.all([
    db.from('api_request_log').insert({provider: 'analytics', actor_hash: sessionHash}),
    db.from('analytics_events').insert(rows),
  ]);

  return json(request, {ok: true, accepted: rows.length}, 201);
});
