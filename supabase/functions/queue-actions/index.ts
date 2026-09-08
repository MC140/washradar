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
const MAX_REPORTS_PER_HOUR = 30;
const SOFT_REPORTS_PER_WASH_HOUR = 12;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  if (request.method !== 'POST') return json(request, {error: 'Method not allowed.'}, 405);
  const user = await authenticatedUser(request);
  if (!user) return json(request, {error: 'A valid contributor session is required.'}, 401);
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Invalid queue action.'}, 400);
  const input = parsed.data;
  const db = serviceClient();
  const actorHash = await hashValue(user.is_anonymous ? user.id + ':' + input.clientId : user.id);

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
        const {data: reputation} = await db.from('contributor_reputation').select('score').eq('user_id', user.id).maybeSingle();
        await db.from('queue_reports').insert({
          id: session.id,
          wash_id: session.wash_id,
          user_id: user.id,
          actor_hash: actorHash,
          report_kind: 'session',
          observed_wait_minutes: elapsed,
          proximity: session.start_proximity === 'nearby' ? 'session' : 'remote',
          confidence_weight: session.start_proximity === 'nearby' ? 1.45 : 0.12,
          reputation_snapshot: Number(reputation?.score ?? 50),
          expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        });
        await recordContribution(user.id, 'session', true);
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
    const [{count: hourlyCount}, {count: washHourlyCount}, {data: last}, {data: reputation}] = await Promise.all([
      db.from('queue_reports').select('id', {head: true, count: 'exact'}).eq('actor_hash', actorHash).gte('created_at', oneHourAgo),
      db.from('queue_reports').select('id', {head: true, count: 'exact'}).eq('actor_hash', actorHash).eq('wash_id', input.washId).gte('created_at', oneHourAgo),
      db.from('queue_reports').select('id,report_kind,queue_bucket,created_at,report_minute')
        .eq('actor_hash', actorHash).eq('wash_id', input.washId).order('created_at', {ascending: false}).limit(1).maybeSingle(),
      db.from('contributor_reputation').select('score').eq('user_id', user.id).maybeSingle(),
    ]);

    if ((hourlyCount ?? 0) >= MAX_REPORTS_PER_HOUR) {
      return json(request, {error: 'You have shared a lot of updates recently. Please try again a little later.'}, 429);
    }

    if ((washHourlyCount ?? 0) >= SOFT_REPORTS_PER_WASH_HOUR) {
      return json(request, {
        verification: proximity,
        counted: false,
        message: 'Thanks — your recent updates already represent this wash.',
      });
    }

    const now = new Date();
    const lastAgeMinutes = last ? (Date.now() - new Date(last.created_at).getTime()) / 60_000 : Number.POSITIVE_INFINITY;
    if (
      last &&
      last.report_kind === input.kind &&
      last.queue_bucket === (input.queueBucket ?? null) &&
      lastAgeMinutes < 2
    ) {
      return json(request, {
        verification: proximity,
        counted: false,
        message: 'Thanks — your latest report is already being used.',
      });
    }

    const estimatedWait = input.queueBucket ? Math.round(queueCars[input.queueBucket] * Number(wash.minutes_per_car)) : null;
    const reputationScore = Number(reputation?.score ?? 50);
    const confidenceWeight = proximity === 'nearby' ? 1 : 0.12;
    const expiresAt = new Date(Date.now() + (input.kind === 'queue' ? 60 : 30) * 60_000).toISOString();
    const currentMinute = Math.floor(Date.now() / 60_000);
    const sameMinute = last && Number(last.report_minute) === currentMinute;

    if (sameMinute) {
      const {error: updateError} = await db.from('queue_reports').update({
        report_kind: input.kind,
        queue_bucket: input.queueBucket ?? null,
        estimated_wait_minutes: estimatedWait,
        observed_wait_minutes: null,
        proximity,
        confidence_weight: confidenceWeight,
        reputation_snapshot: reputationScore,
        expires_at: expiresAt,
        disabled: false,
        created_at: now.toISOString(),
      }).eq('id', last.id);
      if (updateError) throw updateError;
    } else {
      const {error: insertError} = await db.from('queue_reports').insert({
        wash_id: input.washId,
        user_id: user.id,
        actor_hash: actorHash,
        report_kind: input.kind,
        queue_bucket: input.queueBucket,
        estimated_wait_minutes: estimatedWait,
        proximity,
        confidence_weight: confidenceWeight,
        reputation_snapshot: reputationScore,
        expires_at: expiresAt,
      });
      if (insertError) throw insertError;
    }

    const rewardNearby = proximity === 'nearby' && lastAgeMinutes >= 15;
    await recordContribution(user.id, proximity === 'nearby' ? 'nearby' : 'remote', !sameMinute && rewardNearby);
    await recalculate(input.washId);
    return json(request, {verification: proximity, counted: true}, sameMinute ? 200 : 201);
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

async function recordContribution(userId: string, kind: 'session' | 'nearby' | 'remote', reward: boolean) {
  const db = serviceClient();
  const {data} = await db.from('contributor_reputation').select('*').eq('user_id', userId).maybeSingle();
  const current = data ?? {score: 50, reports_submitted: 0, completed_waits: 0};
  const scoreDelta = kind === 'session' ? 4 : kind === 'nearby' && reward ? 1 : 0;
  await db.from('contributor_reputation').upsert({
    user_id: userId,
    score: Math.min(100, Number(current.score) + scoreDelta),
    reports_submitted: Number(current.reports_submitted) + (kind === 'session' ? 0 : 1),
    completed_waits: Number(current.completed_waits) + (kind === 'session' ? 1 : 0),
    last_contribution_at: new Date().toISOString(),
  });
}

function freshnessWeight(ageMinutes: number) {
  if (ageMinutes < 0 || ageMinutes > 60) return 0;
  if (ageMinutes <= 5) return 1;
  if (ageMinutes <= 15) return 0.75;
  if (ageMinutes <= 30) return 0.4;
  return 0.15;
}

function reputationFactor(score: number) {
  return Math.min(1.25, Math.max(0.65, score / 50));
}

function agreementFactor(wait: number, consensus: number) {
  const delta = Math.abs(wait - consensus);
  if (delta <= 4) return 1;
  if (delta <= 10) return 0.75;
  if (delta <= 20) return 0.4;
  return 0.15;
}

function weightedMedian(items: {wait: number; weight: number}[]) {
  if (!items.length) return 0;
  const sorted = [...items].sort((a, b) => a.wait - b.wait);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  let running = 0;
  for (const item of sorted) {
    running += item.weight;
    if (running >= total / 2) return item.wait;
  }
  return sorted[sorted.length - 1].wait;
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
  const queueSignals = signals.filter((report) => (report.observed_wait_minutes ?? report.estimated_wait_minutes) !== null);

  const weightedInputs = queueSignals.map((report) => {
    const wait = Number(report.observed_wait_minutes ?? report.estimated_wait_minutes);
    const age = (Date.now() - new Date(report.created_at).getTime()) / 60_000;
    const proximityBase = report.proximity === 'session'
      ? 1.45
      : report.proximity === 'nearby'
        ? 1
        : Math.min(0.15, Number(report.confidence_weight ?? 0.12));
    return {
      report,
      wait,
      age,
      baseWeight: freshnessWeight(age) * proximityBase * reputationFactor(Number(report.reputation_snapshot ?? 50)),
    };
  }).filter((item) => item.baseWeight > 0);

  const consensus = weightedMedian(weightedInputs.map((item) => ({wait: item.wait, weight: item.baseWeight})));
  const historicalWait = Number(historical?.average_wait_minutes ?? 0);
  const historyCount = Number(historical?.sample_count ?? 0);
  const historicalWeight = historyCount > 0 ? Math.min(1.5, 0.25 + historyCount / 30) : 0;
  let weighted = historicalWait * historicalWeight;
  let totalWeight = historicalWeight;
  let latest: Date | null = null;
  let weightedDisagreement = 0;
  let disagreementWeight = 0;

  for (const item of weightedInputs) {
    const agreement = agreementFactor(item.wait, consensus);
    const weight = item.baseWeight * agreement;
    weighted += item.wait * weight;
    totalWeight += weight;
    weightedDisagreement += Math.abs(item.wait - consensus) * item.baseWeight;
    disagreementWeight += item.baseWeight;
    const createdAt = new Date(item.report.created_at);
    if (!latest || createdAt > latest) latest = createdAt;
  }

  const waitMinutes = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;
  const disagreement = disagreementWeight > 0 ? weightedDisagreement / disagreementWeight : 0;
  const freshStrong = weightedInputs.filter((item) => item.age <= 10 && item.report.proximity !== 'remote');
  const freshSessions = freshStrong.filter((item) => item.report.proximity === 'session');
  const freshRemote = weightedInputs.filter((item) => item.age <= 10 && item.report.proximity === 'remote');
  const agreementScore = weightedInputs.length ? Math.max(0, 1 - disagreement / 20) : 0;
  const historyStrength = Math.min(20, historyCount * 0.8);
  const evidenceStrength = Math.min(52, freshStrong.length * 18 + freshSessions.length * 10 + Math.min(2, freshRemote.length) * 2);
  let confidence = Math.round(Math.min(96, Math.max(8, 12 + historyStrength + evidenceStrength + agreementScore * 12)));
  if (!freshStrong.length && freshRemote.length && historyCount < 8) confidence = Math.min(confidence, 32);

  const newestAge = latest ? (Date.now() - latest.getTime()) / 60_000 : Number.POSITIVE_INFINITY;
  const dataState =
    (freshSessions.length >= 1 && confidence >= 65) || (freshStrong.length >= 2 && confidence >= 60)
      ? 'LIVE'
      : newestAge <= 45
        ? 'RECENT REPORT'
        : 'ESTIMATED';

  const confidenceLabel =
    dataState === 'ESTIMATED'
      ? (historyCount >= 8 ? 'Historical Estimate' : 'Limited Data')
      : confidence >= 75
        ? 'High'
        : confidence >= 45
          ? 'Medium'
          : 'Low';

  const bad = signals.filter((report) => ['closed', 'broken'].includes(report.report_kind) && report.proximity !== 'remote').length;
  const normal = signals.filter((report) => report.report_kind === 'normal' && report.proximity !== 'remote').length;
  const status = bad >= 2 && bad > normal ? 'unavailable' : wash?.operating_status ?? 'unknown';

  await db.from('queue_estimates').upsert({
    wash_id: washId,
    wait_minutes: Math.max(0, Math.min(90, waitMinutes)),
    confidence_score: confidence,
    confidence_label: confidenceLabel,
    data_state: dataState,
    operating_status: status,
    estimated_cars: weightedInputs.length ? Math.round(waitMinutes / Math.max(Number(wash?.minutes_per_car ?? 4), 0.5)) : null,
    recent_signal_count: weightedInputs.length,
    last_signal_at: latest?.toISOString() ?? null,
    calculated_at: new Date().toISOString(),
  });
}
