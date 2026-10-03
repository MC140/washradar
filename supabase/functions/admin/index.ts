import {z} from 'npm:zod@4.1.8';
import {authenticatedUser, cors, json, serviceClient} from '../_shared/http.ts';

const taskStatus = z.enum(['backlog','queued','in_progress','waiting_approval','done','blocked']);
const taskPriority = z.enum(['low','normal','high','urgent']);

const schema = z.discriminatedUnion('action', [
  z.object({action: z.literal('snapshot')}),
  z.object({action: z.literal('moderate-report'), reportId: z.string().uuid(), disabled: z.boolean()}),
  z.object({action: z.literal('hq-snapshot')}),
  z.object({
    action: z.literal('hq-create-task'),
    title: z.string().trim().min(3).max(180),
    detail: z.string().max(4000).default(''),
    agentKey: z.string().trim().min(2).max(40).nullable().optional(),
    priority: taskPriority.default('normal'),
    approvalRequired: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('hq-update-task'),
    taskId: z.string().uuid(),
    status: taskStatus.optional(),
    priority: taskPriority.optional(),
  }),
  z.object({
    action: z.literal('hq-add-memory'),
    title: z.string().trim().min(3).max(180),
    body: z.string().trim().min(3).max(5000),
    category: z.string().trim().min(2).max(40).default('observation'),
    pinned: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('hq-review-approval'),
    approvalId: z.string().uuid(),
    decision: z.enum(['approved','rejected','cancelled']),
    note: z.string().max(1000).default(''),
  }),
  z.object({action: z.literal('hq-run-scan')}),
  z.object({
    action: z.literal('hq-plan-goal'),
    goal: z.string().trim().min(8).max(1200),
  }),
]);

type Db = ReturnType<typeof serviceClient>;

async function operationalSnapshot(db: Db) {
  const {data, error} = await db.rpc('hq_operational_snapshot');
  if (error) throw error;
  return (data ?? {}) as Record<string, number | string>;
}

async function githubSignals() {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'WashRadar-HQ',
  };
  try {
    const [pullsResponse, runsResponse] = await Promise.all([
      fetch('https://api.github.com/repos/MC140/washradar/pulls?state=open&per_page=20', {headers}),
      fetch('https://api.github.com/repos/MC140/washradar/actions/runs?per_page=10', {headers}),
    ]);
    const pulls = pullsResponse.ok ? await pullsResponse.json() : [];
    const runsPayload = runsResponse.ok ? await runsResponse.json() : {workflow_runs: []};
    const openPulls = Array.isArray(pulls) ? pulls : [];
    const workflowRuns = Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [];
    const now = Date.now();
    return {
      available: pullsResponse.ok || runsResponse.ok,
      openPullRequests: openPulls.length,
      draftPullRequests: openPulls.filter((item: any) => item?.draft).length,
      staleDraftPullRequests: openPulls.filter((item: any) => item?.draft && item?.updated_at && now - new Date(item.updated_at).getTime() > 7 * 86400000).map((item: any) => ({
        number: item.number,
        title: item.title,
        updatedAt: item.updated_at,
      })),
      recentFailedRuns: workflowRuns.filter((item: any) => item?.conclusion === 'failure').slice(0, 5).map((item: any) => ({
        id: item.id,
        name: item.name,
        branch: item.head_branch,
        updatedAt: item.updated_at,
        url: item.html_url,
      })),
    };
  } catch {
    return {
      available: false,
      openPullRequests: 0,
      draftPullRequests: 0,
      staleDraftPullRequests: [],
      recentFailedRuns: [],
    };
  }
}

async function insertTaskIfMissing(db: Db, input: {
  title: string;
  detail: string;
  agentKey: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dedupeKey: string;
  source?: string;
}) {
  const {data: existing} = await db
    .from('hq_tasks')
    .select('id')
    .eq('dedupe_key', input.dedupeKey)
    .neq('status', 'done')
    .limit(1);
  if (existing?.length) return false;

  const {error} = await db.from('hq_tasks').insert({
    title: input.title,
    detail: input.detail,
    agent_key: input.agentKey,
    priority: input.priority,
    status: 'queued',
    source: input.source ?? 'agent_scan',
    dedupe_key: input.dedupeKey,
  });
  if (error) throw error;
  return true;
}

async function writeRun(db: Db, input: {
  agentKey: string;
  summary: string;
  output: unknown;
}) {
  const {error} = await db.from('hq_agent_runs').insert({
    agent_key: input.agentKey,
    run_type: 'health_scan',
    mode: 'zero_cost_rules',
    status: 'complete',
    summary: input.summary,
    output: input.output,
    completed_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function runHqScan(db: Db) {
  const [ops, github] = await Promise.all([operationalSnapshot(db), githubSignals()]);
  const created: string[] = [];

  const activeWashes = Number(ops.active_washes ?? 0);
  const washesWithHours = Number(ops.washes_with_hours ?? 0);
  const hoursCoverage = activeWashes > 0 ? washesWithHours / activeWashes : 1;
  const staleWashes = Number(ops.stale_washes_30d ?? 0);
  const appOpens = Number(ops.app_opens_7d ?? 0);
  const searches = Number(ops.searches_7d ?? 0);
  const searchActivation = appOpens > 0 ? searches / appOpens : 0;
  const advertisers = Number(ops.advertiser_businesses ?? 0);
  const pendingModeration = Number(ops.pending_moderation ?? 0);

  if (hoursCoverage < 0.95) {
    if (await insertTaskIfMissing(db, {
      title: 'Repair business-hours coverage',
      detail: `Only ${washesWithHours} of ${activeWashes} active washes currently have business-hours records. Data Agent should identify uncovered locations and repair the catalogue before wider launch.`,
      agentKey: 'data',
      priority: hoursCoverage < 0.85 ? 'high' : 'normal',
      dedupeKey: 'scan:data:hours-coverage',
    })) created.push('Repair business-hours coverage');
  }

  if (staleWashes > 0) {
    if (await insertTaskIfMissing(db, {
      title: 'Refresh stale wash catalogue records',
      detail: `${staleWashes} active production wash records have not been source-refreshed in more than 30 days or have no source refresh timestamp.`,
      agentKey: 'data',
      priority: staleWashes > Math.max(20, activeWashes * 0.1) ? 'high' : 'normal',
      dedupeKey: 'scan:data:stale-catalogue',
    })) created.push('Refresh stale wash catalogue records');
  }

  if (appOpens >= 20 && searchActivation < 0.25) {
    if (await insertTaskIfMissing(db, {
      title: 'Review first-use search activation',
      detail: `WashRadar recorded ${appOpens} app opens and ${searches} searches in the last 7 days. Product Agent should inspect whether this represents real-user friction or internal/test traffic before changing the experience.`,
      agentKey: 'product',
      priority: 'normal',
      dedupeKey: 'scan:product:search-activation',
    })) created.push('Review first-use search activation');
  }

  const staleDrafts = Array.isArray((github as any).staleDraftPullRequests) ? (github as any).staleDraftPullRequests : [];
  const failedRuns = Array.isArray((github as any).recentFailedRuns) ? (github as any).recentFailedRuns : [];
  if (staleDrafts.length > 0) {
    if (await insertTaskIfMissing(db, {
      title: 'Review stale draft pull requests',
      detail: `Engineering Agent found ${staleDrafts.length} draft PR(s) unchanged for more than 7 days. Review whether they are still needed or should be closed/superseded.`,
      agentKey: 'engineering',
      priority: 'normal',
      dedupeKey: 'scan:engineering:stale-drafts',
    })) created.push('Review stale draft pull requests');
  }
  if (failedRuns.length > 0) {
    if (await insertTaskIfMissing(db, {
      title: 'Investigate recent failed GitHub Actions',
      detail: `Engineering Agent found ${failedRuns.length} recent failed workflow run(s). Review failures before the next production release.`,
      agentKey: 'engineering',
      priority: 'high',
      dedupeKey: 'scan:engineering:failed-actions',
    })) created.push('Investigate recent failed GitHub Actions');
  }

  if (advertisers === 0) {
    if (await insertTaskIfMissing(db, {
      title: 'Build the first GTA advertiser prospect list',
      detail: 'WashRadar has no advertiser businesses onboarded yet. Growth Agent should prepare a small, high-quality first prospect set for founder review; no outreach is sent automatically.',
      agentKey: 'growth',
      priority: 'high',
      dedupeKey: 'scan:growth:first-advertisers',
    })) created.push('Build the first GTA advertiser prospect list');
  }

  if (pendingModeration > 0) {
    if (await insertTaskIfMissing(db, {
      title: 'Clear pending moderation items',
      detail: `${pendingModeration} moderation item(s) are still pending. Operations Agent should review them and escalate anything ambiguous.`,
      agentKey: 'operations',
      priority: pendingModeration > 10 ? 'high' : 'normal',
      dedupeKey: 'scan:operations:moderation',
    })) created.push('Clear pending moderation items');
  }

  await Promise.all([
    writeRun(db, {
      agentKey: 'data',
      summary: `Catalogue: ${activeWashes} active washes, ${Math.round(hoursCoverage * 100)}% hours coverage, ${staleWashes} stale records.`,
      output: {activeWashes, washesWithHours, hoursCoverage, staleWashes},
    }),
    writeRun(db, {
      agentKey: 'product',
      summary: `7-day product signal: ${appOpens} opens, ${searches} searches, ${Math.round(searchActivation * 100)}% searches per app-open event.`,
      output: {appOpens, searches, searchActivation, supportViews: Number(ops.support_views_7d ?? 0)},
    }),
    writeRun(db, {
      agentKey: 'engineering',
      summary: github.available
        ? `GitHub: ${(github as any).openPullRequests} open PR(s), ${staleDrafts.length} stale draft(s), ${failedRuns.length} recent failed run(s).`
        : 'GitHub public status could not be fetched during this scan; no production action was taken.',
      output: github,
    }),
    writeRun(db, {
      agentKey: 'growth',
      summary: `Commercial pipeline: ${advertisers} advertiser business(es), ${Number(ops.active_campaigns ?? 0)} active campaign(s).`,
      output: {advertisers, activeCampaigns: Number(ops.active_campaigns ?? 0)},
    }),
    writeRun(db, {
      agentKey: 'operations',
      summary: `Operations: ${Number(ops.queue_reports_24h ?? 0)} queue reports in 24h, ${pendingModeration} pending moderation item(s).`,
      output: {
        queueReports24h: Number(ops.queue_reports_24h ?? 0),
        nearbyQueueReports24h: Number(ops.nearby_queue_reports_24h ?? 0),
        activeQueueSessions: Number(ops.active_queue_sessions ?? 0),
        pendingModeration,
      },
    }),
    writeRun(db, {
      agentKey: 'chief',
      summary: `HQ scan completed. ${created.length} new task(s) created. Zero-Cost Mode remained enabled.`,
      output: {createdTasks: created, zeroCostMode: true},
    }),
  ]);

  await db.from('hq_memory').insert({
    category: 'scan',
    title: 'HQ health scan',
    body: `Completed live health scan. Created ${created.length} new follow-up task(s): ${created.length ? created.join(', ') : 'none'}.`,
    source: 'agent_scan',
    tags: ['health-scan','zero-cost'],
    pinned: false,
  });

  return {operational: ops, github, createdTasks: created};
}

async function hqSnapshot(db: Db) {
  const [agents, tasks, approvals, memory, settings, runs, operational, github] = await Promise.all([
    db.from('hq_agents').select('*').eq('active', true).order('sort_order'),
    db.from('hq_tasks').select('*').order('created_at', {ascending: false}).limit(100),
    db.from('hq_approvals').select('*').order('requested_at', {ascending: false}).limit(50),
    db.from('hq_memory').select('*').order('pinned', {ascending: false}).order('created_at', {ascending: false}).limit(30),
    db.from('hq_settings').select('*').order('key'),
    db.from('hq_agent_runs').select('*').order('started_at', {ascending: false}).limit(30),
    operationalSnapshot(db),
    githubSignals(),
  ]);
  const firstError = [agents.error, tasks.error, approvals.error, memory.error, settings.error, runs.error].find(Boolean);
  if (firstError) throw firstError;
  return {
    agents: agents.data ?? [],
    tasks: tasks.data ?? [],
    approvals: approvals.data ?? [],
    memory: memory.data ?? [],
    settings: Object.fromEntries((settings.data ?? []).map((item: any) => [item.key, item.value])),
    runs: runs.data ?? [],
    operational,
    github,
  };
}

async function planGoal(db: Db, goal: string, userId: string) {
  const planId = crypto.randomUUID().slice(0, 8);
  const specialists = [
    {
      agent_key: 'product',
      title: 'Define product outcome and acceptance criteria',
      detail: `Founder goal: ${goal}\n\nClarify the user outcome, scope, success measures, and what should explicitly stay out of scope.`,
      priority: 'high',
    },
    {
      agent_key: 'engineering',
      title: 'Assess implementation and release readiness',
      detail: `Founder goal: ${goal}\n\nIdentify the smallest safe implementation path, dependencies, tests, rollout checks, and technical risks.`,
      priority: 'high',
    },
    {
      agent_key: 'data',
      title: 'Validate data readiness and measurement',
      detail: `Founder goal: ${goal}\n\nConfirm the underlying data is trustworthy and define the metrics that will prove whether the goal worked.`,
      priority: 'normal',
    },
    {
      agent_key: 'growth',
      title: 'Prepare growth and communication plan',
      detail: `Founder goal: ${goal}\n\nDefine the audience, acquisition/partner motion, messaging, and what needs founder approval before external outreach.`,
      priority: 'normal',
    },
    {
      agent_key: 'operations',
      title: 'Prepare operating and support checklist',
      detail: `Founder goal: ${goal}\n\nDefine launch/support procedures, exception handling, moderation needs, and rollback/escalation steps.`,
      priority: 'normal',
    },
  ];

  const rows = [
    {
      title: `Coordinate goal: ${goal.slice(0, 120)}`,
      detail: `Chief of Staff coordination record for plan ${planId}. Keep specialist work aligned to this founder goal and surface decisions requiring approval.`,
      agent_key: 'chief',
      status: 'in_progress',
      priority: 'high',
      source: 'chief_plan',
      dedupe_key: `plan:${planId}:chief`,
      created_by: userId,
    },
    ...specialists.map((item) => ({
      ...item,
      status: 'queued',
      source: 'chief_plan',
      dedupe_key: `plan:${planId}:${item.agent_key}`,
      created_by: userId,
    })),
  ];

  const {data, error} = await db.from('hq_tasks').insert(rows).select('*');
  if (error) throw error;
  await db.from('hq_memory').insert({
    category: 'goal',
    title: `Founder goal · ${planId}`,
    body: goal,
    source: 'founder',
    tags: ['goal', planId],
    pinned: true,
    created_by: userId,
  });
  return {planId, tasks: data ?? []};
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request)});
  const user = await authenticatedUser(request);
  const allowed = (Deno.env.get('ADMIN_EMAILS') ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!user?.email || !allowed.includes(user.email.toLowerCase())) return json(request, {error: 'Administrator access is required.'}, 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(request, {error: 'Invalid admin action.'}, 400);
  const db = serviceClient();

  try {
    if (parsed.data.action === 'moderate-report') {
      const {error} = await db.from('queue_reports').update({disabled: parsed.data.disabled}).eq('id', parsed.data.reportId);
      if (error) throw error;
      await db.from('moderation_flags').insert({
        entity_type: 'queue_report',
        entity_id: parsed.data.reportId,
        reason: parsed.data.disabled ? 'Disabled by administrator' : 'Restored by administrator',
        status: 'actioned',
        created_by: user.id,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
      });
      return json(request, {ok: true});
    }

    if (parsed.data.action === 'snapshot') {
      const [washes, sessions, campaigns, reports] = await Promise.all([
        db.from('car_washes').select('id', {head: true, count: 'exact'}).eq('data_environment', 'production').eq('active', true),
        db.from('queue_sessions').select('id', {head: true, count: 'exact'}).eq('status', 'active'),
        db.from('ad_campaigns').select('id', {head: true, count: 'exact'}).eq('status', 'active'),
        db.from('queue_reports').select('id,wash_id,report_kind,created_at,disabled,proximity').order('created_at', {ascending: false}).limit(50),
      ]);
      return json(request, {
        washCount: washes.count ?? 0,
        activeSessionCount: sessions.count ?? 0,
        activeCampaignCount: campaigns.count ?? 0,
        reports: (reports.data ?? []).map((report) => ({
          id: report.id,
          washId: report.wash_id,
          kind: report.report_kind,
          createdAt: report.created_at,
          disabled: report.disabled,
          verification: report.proximity,
        })),
      });
    }

    if (parsed.data.action === 'hq-snapshot') return json(request, await hqSnapshot(db));

    if (parsed.data.action === 'hq-create-task') {
      const {data, error} = await db.from('hq_tasks').insert({
        title: parsed.data.title,
        detail: parsed.data.detail,
        agent_key: parsed.data.agentKey ?? null,
        priority: parsed.data.priority,
        status: 'queued',
        source: 'founder',
        approval_required: parsed.data.approvalRequired,
        created_by: user.id,
      }).select('*').single();
      if (error) throw error;
      return json(request, {task: data});
    }

    if (parsed.data.action === 'hq-update-task') {
      const updates: Record<string, unknown> = {};
      if (parsed.data.status) {
        updates.status = parsed.data.status;
        updates.completed_at = parsed.data.status === 'done' ? new Date().toISOString() : null;
      }
      if (parsed.data.priority) updates.priority = parsed.data.priority;
      const {data, error} = await db.from('hq_tasks').update(updates).eq('id', parsed.data.taskId).select('*').single();
      if (error) throw error;
      return json(request, {task: data});
    }

    if (parsed.data.action === 'hq-add-memory') {
      const {data, error} = await db.from('hq_memory').insert({
        category: parsed.data.category,
        title: parsed.data.title,
        body: parsed.data.body,
        source: 'founder',
        pinned: parsed.data.pinned,
        created_by: user.id,
      }).select('*').single();
      if (error) throw error;
      return json(request, {memory: data});
    }

    if (parsed.data.action === 'hq-review-approval') {
      const {data, error} = await db.from('hq_approvals').update({
        status: parsed.data.decision,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_note: parsed.data.note,
      }).eq('id', parsed.data.approvalId).eq('status', 'pending').select('*').single();
      if (error) throw error;
      return json(request, {approval: data});
    }

    if (parsed.data.action === 'hq-run-scan') return json(request, await runHqScan(db));
    if (parsed.data.action === 'hq-plan-goal') return json(request, await planGoal(db, parsed.data.goal, user.id));

    return json(request, {error: 'Unsupported action.'}, 400);
  } catch (caught) {
    console.error('admin action failed', caught);
    return json(request, {error: caught instanceof Error ? caught.message : 'Admin action failed.'}, 500);
  }
});
