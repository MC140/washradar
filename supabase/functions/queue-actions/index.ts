import {z} from 'npm:zod@4.1.8';
import {authenticatedUser, cors, distanceKm, hashValue, json, serviceClient} from '../_shared/http.ts';

const point = z.object({lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180)});
const bucket = z.enum(['none', '1-3', '4-7', '8-12', '12-plus']);
const inputSchema = z.discriminatedUnion('action', [
  z.object({action: z.literal('report'), washId: z.string().uuid(), clientId: z.string().uuid(), kind: z.enum(['queue', 'normal', 'closed', 'broken', 'stalled', 'payment', 'dryer', 'other']), queueBucket: bucket.optional(), position: point.optional()}),
  z.object({action: z.literal('start'), washId: z.string().uuid(), clientId: z.string().uuid(), initialQueueBucket: bucket.optional(), position: point}),
  z.object({action: z.enum(['finish', 'cancel', 'active']), clientId: z.string().uuid()}),
]);
const queueCars = {none: 0, '1-3': 2, '4-7': 5.5, '8-12': 10, '12-plus': 15};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  if (request.method !== 'POST') return json(request, {error: 'Method not allowed.'}, 405);
  const user = await authenticatedUser(request);
  if (!user) return json(request, {error: 'A valid contributor session is required.'}, 401);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Invalid queue action.'}, 400);
  const input = parsed.data;
  const db = serviceClient();
  const actorHash = await hashValue(user.id + ':' + input.clientId);

  try {
    if (input.action === 'active') {
      const {data} = await db.from('queue_sessions').select('*').eq('actor_hash', actorHash).eq('status', 'active').maybeSingle();
      return json(request, data ? sessionResponse(data) : null);
    }
    if (input.action === 'finish' || input.action === 'cancel') {
      const {data: session} = await db.from('queue_sessions').select('*').eq('actor_hash', actorHash).eq('status', 'active').maybeSingle();
      if (!session) return json(request, null);
      const elapsed = Math.max(1, Math.min(90, Math.round((Date.now() - new Date(session.started_at).getTime()) / 60_000)));
      const status = input.action === 'finish' ? 'completed' : 'cancelled';
      const {error: updateError} = await db.from('queue_sessions').update({status, ended_at: new Date().toISOString(), observed_wait_minutes: status === 'completed' ? elapsed : null}).eq('id', session.id).eq('status', 'active');
      if (updateError) throw updateError;
      if (status === 'completed') {
        await db.from('queue_reports').insert({
          id: session.id,
          wash_id: session.wash_id,
          user_id: user.id,
          actor_hash: actorHash,
          report_kind: 'session',
          observed_wait_minutes: elapsed,
          proximity: session.start_proximity === 'nearby' ? 'session' : 'remote',
          confidence_weight: session.start_proximity === 'nearby' ? 1.55 : 0.3,
          reputation_snapshot: 50,
          expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        });
        await incrementReputation(user.id, 'session');
        await recalculate(session.wash_id);
      }
      return json(request, sessionResponse({...session, status, observed_wait_minutes: status === 'completed' ? elapsed : null}));
    }

    const {data: wash, error: washError} = await db.from('car_washes')
      .select('id,minutes_per_car,operating_status,wash_locations!inner(latitude,longitude)')
      .eq('id', input.washId).eq('active', true).eq('data_environment', 'production').single();
    if (washError || !wash) return json(request, {error: 'That wash is unavailable.'}, 404);
    const location = Array.isArray(wash.wash_locations) ? wash.wash_locations[0] : wash.wash_locations;
    const proximity = input.position && distanceKm(input.position, {lat: Number(location.latitude), lng: Number(location.longitude)}) <= 0.35 ? 'nearby' : 'remote';

    if (input.action === 'start') {
      if (proximity !== 'nearby') return json(request, {error: 'Move closer to this wash to start a verified queue timer.'}, 403);
      const {data, error} = await db.from('queue_sessions').insert({
        wash_id: input.washId,
        user_id: user.id,
        actor_hash: actorHash,
        start_proximity: 'nearby',
        initial_queue_bucket: input.initialQueueBucket,
      }).select('*').single();
      if (error?.code === '23505') return json(request, {error: 'You already have an active queue timer.'}, 409);
      if (error) throw error;
      return json(request, sessionResponse(data), 201);
    }

    if (input.kind === 'queue' && !input.queueBucket) return json(request, {error: 'Choose a queue size.'}, 400);
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const {count} = await db.from('queue_reports').select('id', {head: true, count: 'exact'}).eq('actor_hash', actorHash).gte('created_at', oneHourAgo);
    if ((count ?? 0) >= 6) return json(request, {error: 'Report limit reached. Please try later.'}, 429);
    const {data: last} = await db.from('queue_reports').select('report_kind,queue_bucket,created_at').eq('actor_hash', actorHash).order('created_at', {ascending: false}).limit(1).maybeSingle();
    if (last) {
      const age = (Date.now() - new Date(last.created_at).getTime()) / 60_000;
      if (age < 3) return json(request, {error: 'Please wait a few minutes before reporting again.'}, 429);
      if (last.report_kind === input.kind && last.queue_bucket === (input.queueBucket ?? null) && age < 10) return json(request, {error: 'That report was already received.'}, 409);
    }
    const estimatedWait = input.queueBucket ? Math.round(queueCars[input.queueBucket] * Number(wash.minutes_per_car)) : null;
    const {error: insertError} = await db.from('queue_reports').insert({
      wash_id: input.washId,
      user_id: user.id,
      actor_hash: actorHash,
      report_kind: input.kind,
      queue_bucket: input.queueBucket,
      estimated_wait_minutes: estimatedWait,
      proximity,
      confidence_weight: proximity === 'nearby' ? 1.2 : 0.3,
      reputation_snapshot: 50,
      expires_at: new Date(Date.now() + (input.kind === 'queue' ? 60 : 30) * 60_000).toISOString(),
    });
    if (insertError?.code === '23505') return json(request, {error: 'A report was already received this minute.'}, 409);
    if (insertError) throw insertError;
    await incrementReputation(user.id, proximity === 'nearby' ? 'nearby' : 'remote');
    await recalculate(input.washId);
    return json(request, {verification: proximity}, 201);
  } catch (error) {
    console.error(JSON.stringify({event: 'queue_action_failed', action: input.action, message: error instanceof Error ? error.message : 'unknown'}));
    return json(request, {error: 'The queue action could not be completed.'}, 500);
  }
});

function sessionResponse(session: Record<string, unknown>) {
  return {
    id: session.id,
    washId: session.wash_id,
    startedAt: session.started_at,
    status: session.status,
    verification: session.start_proximity,
    initialQueueBucket: session.initial_queue_bucket,
    observedWaitMinutes: session.observed_wait_minutes,
  };
}

async function incrementReputation(userId: string, kind: 'session' | 'nearby' | 'remote') {
  const db = serviceClient();
  const {data} = await db.from('contributor_reputation').select('*').eq('user_id', userId).maybeSingle();
  const current = data ?? {score: 50, reports_submitted: 0, completed_waits: 0};
  await db.from('contributor_reputation').upsert({
    user_id: userId,
    score: Math.min(100, current.score + (kind === 'session' ? 4 : kind === 'nearby' ? 1 : 0)),
    reports_submitted: current.reports_submitted + (kind === 'session' ? 0 : 1),
    completed_waits: current.completed_waits + (kind === 'session' ? 1 : 0),
    last_contribution_at: new Date().toISOString(),
  });
}

async function recalculate(washId: string) {
  const db = serviceClient();
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const [{data: reports}, {data: wash}, {data: historical}] = await Promise.all([
    db.from('queue_reports').select('*').eq('wash_id', washId).eq('disabled', false).gt('expires_at', new Date().toISOString()).gte('created_at', since),
    db.from('car_washes').select('operating_status,minutes_per_car').eq('id', washId).single(),
    db.from('historical_queue_stats').select('average_wait_minutes,sample_count').eq('wash_id', washId)
      .eq('weekday', new Date().getUTCDay()).eq('hour_bucket', new Date().getUTCHours()).maybeSingle(),
  ]);
  const latestByActor = new Map<string, Record<string, any>>();
  for (const report of reports ?? []) {
    const previous = latestByActor.get(report.actor_hash);
    if (!previous || new Date(report.created_at) > new Date(previous.created_at)) latestByActor.set(report.actor_hash, report);
  }
  const signals = [...latestByActor.values()];
  const historicalWait = Number(historical?.average_wait_minutes ?? 0);
  const historyCount = Number(historical?.sample_count ?? 0);
  let weighted = historicalWait * Math.min(2, 0.6 + historyCount / 25);
  let totalWeight = Math.min(2, 0.6 + historyCount / 25);
  let evidence = 0;
  let latest: Date | null = null;
  const waits: number[] = [];
  for (const report of signals) {
    const wait = report.observed_wait_minutes ?? report.estimated_wait_minutes;
    if (wait === null) continue;
    const age = (Date.now() - new Date(report.created_at).getTime()) / 60_000;
    const freshness = age <= 5 ? 1 : age <= 15 ? 0.7 : age <= 30 ? 0.35 : 0.12;
    const weight = freshness * Number(report.confidence_weight);
    weighted += wait * weight;
    totalWeight += weight;
    evidence += weight;
    waits.push(wait);
    if (!latest || new Date(report.created_at) > latest) latest = new Date(report.created_at);
  }
  const waitMinutes = Math.round(weighted / Math.max(totalWeight, 0.1));
  const disagreement = waits.length ? waits.reduce((total, wait) => total + Math.abs(wait - waitMinutes), 0) / waits.length : 0;
  const confidence = Math.round(Math.min(96, Math.max(8, 16 + Math.min(22, historyCount) + evidence * 18 - disagreement)));
  const age = latest ? (Date.now() - latest.getTime()) / 60_000 : Infinity;
  const dataState = age <= 10 && confidence >= 50 ? 'LIVE' : age <= 45 ? 'RECENT REPORT' : 'ESTIMATED';
  const confidenceLabel = dataState === 'ESTIMATED' ? (historyCount >= 8 ? 'Historical Estimate' : 'Limited Data') : confidence >= 75 ? 'High' : confidence >= 45 ? 'Medium' : 'Low';
  const bad = signals.filter((report) => ['closed', 'broken'].includes(report.report_kind) && report.proximity !== 'remote').length;
  const normal = signals.filter((report) => report.report_kind === 'normal').length;
  const status = bad >= 2 && bad > normal ? 'unavailable' : wash?.operating_status ?? 'unknown';
  await db.from('queue_estimates').upsert({
    wash_id: washId,
    wait_minutes: Math.max(0, Math.min(90, waitMinutes)),
    confidence_score: confidence,
    confidence_label: confidenceLabel,
    data_state: dataState,
    operating_status: status,
    estimated_cars: waits.length ? Math.round(waitMinutes / Math.max(Number(wash?.minutes_per_car ?? 4), 0.5)) : null,
    recent_signal_count: waits.length,
    last_signal_at: latest?.toISOString() ?? null,
    calculated_at: new Date().toISOString(),
  });
}
