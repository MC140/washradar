import {z} from 'npm:zod@4.1.8';
import {cors, hashValue, json, serviceClient} from '../_shared/http.ts';

const eventNames = [
  'app_opened','search','location_granted','wash_viewed','directions_clicked',
  'best_right_now_selected','queue_report_started','queue_report_completed',
  'wash_type_reported','queue_session_started','queue_session_completed','favourite',
  'alert_created','rating_submitted','auth_signed_in','account_created','support_viewed',
  'ad_impression','ad_click',
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

type DbClient = ReturnType<typeof serviceClient>;
type AcceptedEvent = z.infer<typeof eventSchema>;
let postHogTokenPromise: Promise<string | null> | null = null;

async function getPostHogToken(db: DbClient) {
  postHogTokenPromise ??= db.from('internal_service_config')
    .select('value')
    .eq('key', 'posthog_project_token')
    .maybeSingle()
    .then(({data, error}) => {
      if (error) {
        console.warn('PostHog configuration unavailable.', error.message);
        return null;
      }
      return typeof data?.value === 'string' && data.value.length > 0 ? data.value : null;
    });
  return postHogTokenPromise;
}

async function forwardToPostHog(db: DbClient, sessionHash: string, events: AcceptedEvent[]) {
  const token = await getPostHogToken(db);
  if (!token) return;

  const payload = JSON.stringify({
    api_key: token,
    batch: events.map((event) => ({
      event: event.name,
      timestamp: event.at,
      properties: {
        ...event.properties,
        distinct_id: sessionHash,
        $process_person_profile: false,
        $geoip_disable: true,
        app: 'washradar',
        environment: 'production',
        telemetry_source: 'supabase-edge',
      },
    })),
  });

  // The connected PostHog workspace may be hosted in either cloud region. Try the
  // US ingest host first and fall back to EU only if the token is not accepted there.
  // A future POSTHOG_HOST Edge secret can pin the host without a code release.
  const configuredHost = Deno.env.get('POSTHOG_HOST')?.replace(/\/$/, '');
  const hosts = configuredHost
    ? [configuredHost]
    : ['https://us.i.posthog.com', 'https://eu.i.posthog.com'];

  for (const host of hosts) {
    try {
      const response = await fetch(`${host}/batch/`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: payload,
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) return;
    } catch {
      // Monitoring must never make a WashRadar user action fail.
    }
  }

  console.warn('PostHog event forwarding failed for all configured ingest hosts.');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  if (request.method !== 'POST') return json(request, {error: 'Method not allowed.'}, 405);

  const body = await request.json().catch(() => null);
  const batch = batchSchema.safeParse(body);
  const single = batch.success ? null : singleSchema.safeParse(body);
  if (!batch.success && !single?.success) return json(request, {error: 'Invalid event.'}, 400);

  const clientId = batch.success ? batch.data.clientId : single!.data.clientId;
  const events: AcceptedEvent[] = batch.success
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

  const [requestLogResult, eventInsertResult] = await Promise.all([
    db.from('api_request_log').insert({provider: 'analytics', actor_hash: sessionHash}),
    db.from('analytics_events').insert(rows),
  ]);

  if (requestLogResult.error) console.warn('Analytics request log insert failed.', requestLogResult.error.message);
  if (eventInsertResult.error) console.warn('Analytics event insert failed.', eventInsertResult.error.message);

  await forwardToPostHog(db, sessionHash, events);

  return json(request, {ok: true, accepted: rows.length}, 201);
});
