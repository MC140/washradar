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
  z.object({action: z.literal('hq-run-company')}),
  z.object({
    action: z.literal('hq-plan-goal'),
    goal: z.string().trim().min(8).max(1200),
  }),
]);

type Db = ReturnType<typeof serviceClient>;

type HqTaskRecord = {
  id: string;
  title: string;
  detail: string;
  agent_key: string | null;
  status: string;
  priority: string;
  source: string;
  dedupe_key: string | null;
  approval_required: boolean;
};

type AgentResult = {
  summary: string;
  findings: string[];
  deliverables: string[];
  recommendation: string;
  metrics?: Record<string, unknown>;
  prospects?: Array<Record<string, unknown>>;
  approval?: {
    actionType: string;
    summary: string;
    payload: Record<string, unknown>;
  };
};

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
      fetch('https://api.github.com/repos/MC140/washradar/actions/runs?per_page=12', {headers}),
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
      recentSuccessfulRuns: workflowRuns.filter((item: any) => item?.conclusion === 'success').slice(0, 3).map((item: any) => ({
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
      recentSuccessfulRuns: [],
    };
  }
}

function planIdFromTask(task: HqTaskRecord) {
  const match = task.dedupe_key?.match(/^plan:([^:]+):/);
  return match?.[1] ?? null;
}

function founderGoalFromTask(task: HqTaskRecord) {
  const match = task.detail.match(/Founder goal:\s*([\s\S]*?)(?:\n\n|$)/i);
  return match?.[1]?.trim() || task.title;
}

function scopeFromGoal(goal: string) {
  const value = goal.toLowerCase();
  if (value.includes('scarborough')) return {label: 'Scarborough', postalPrefixes: ['M1']};
  if (value.includes('north york')) return {label: 'North York', postalPrefixes: ['M2','M3','M4']};
  if (value.includes('etobicoke')) return {label: 'Etobicoke', postalPrefixes: ['M8','M9']};
  if (value.includes('brampton')) return {label: 'Brampton', postalPrefixes: ['L6','L7']};
  if (value.includes('mississauga')) return {label: 'Mississauga', postalPrefixes: ['L4','L5']};
  if (value.includes('markham')) return {label: 'Markham', postalPrefixes: ['L3']};
  if (value.includes('vaughan')) return {label: 'Vaughan', postalPrefixes: ['L4J','L4K','L6A']};
  if (value.includes('pickering')) return {label: 'Pickering', postalPrefixes: ['L1V','L1W','L1X']};
  return {label: 'GTA', postalPrefixes: [] as string[]};
}

async function scopeWashIds(db: Db, goal: string) {
  const scope = scopeFromGoal(goal);
  if (!scope.postalPrefixes.length) return {scope, ids: [] as string[]};

  const clauses = scope.postalPrefixes.map((prefix) => `postal_code.ilike.${prefix}%`).join(',');
  const {data, error} = await db.from('wash_locations')
    .select('wash_id,postal_code,city,address_line')
    .or(clauses)
    .limit(1200);
  if (error) throw error;
  return {
    scope,
    ids: [...new Set((data ?? []).map((item: any) => String(item.wash_id)))],
  };
}

async function scopedReadiness(db: Db, goal: string, ops: Record<string, number | string>) {
  const {scope, ids} = await scopeWashIds(db, goal);
  if (!ids.length) {
    const active = Number(ops.active_washes ?? 0);
    const hours = Number(ops.washes_with_hours ?? 0);
    return {
      scope: scope.label,
      activeWashes: active,
      washesWithHours: hours,
      hoursCoveragePct: active ? Math.round((hours / active) * 100) : 100,
      queueReports30d: null,
      note: scope.label === 'GTA' ? 'Using GTA-wide operating snapshot.' : `No location rows matched the ${scope.label} postal scope.`,
    };
  }

  const [activeResponse, hoursResponse, queueResponse] = await Promise.all([
    db.from('car_washes').select('id', {count: 'exact', head: true}).in('id', ids).eq('active', true).eq('data_environment', 'production'),
    db.from('business_hours').select('wash_id').in('wash_id', ids),
    db.from('queue_reports').select('id', {count: 'exact', head: true}).in('wash_id', ids).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).eq('disabled', false),
  ]);
  if (activeResponse.error) throw activeResponse.error;
  if (hoursResponse.error) throw hoursResponse.error;
  if (queueResponse.error) throw queueResponse.error;

  const active = activeResponse.count ?? ids.length;
  const hours = new Set((hoursResponse.data ?? []).map((item: any) => String(item.wash_id))).size;
  return {
    scope: scope.label,
    activeWashes: active,
    washesWithHours: hours,
    hoursCoveragePct: active ? Math.round((hours / active) * 100) : 100,
    queueReports30d: queueResponse.count ?? 0,
    note: `Matched ${ids.length} catalogue location(s) by postal geography.`,
  };
}

async function prospectList(db: Db, goal: string) {
  const {scope, ids} = await scopeWashIds(db, goal);
  let washesQuery = db.from('car_washes')
    .select('id,canonical_name,rating,rating_count')
    .eq('active', true)
    .eq('data_environment', 'production')
    .not('rating_count', 'is', null)
    .order('rating_count', {ascending: false})
    .limit(12);

  if (ids.length) washesQuery = washesQuery.in('id', ids);
  const {data: washes, error: washesError} = await washesQuery;
  if (washesError) throw washesError;
  const washRows = washes ?? [];
  if (!washRows.length) return {scope: scope.label, prospects: [] as Array<Record<string, unknown>>};

  const washIds = washRows.map((item: any) => item.id);
  const {data: locations, error: locationsError} = await db.from('wash_locations')
    .select('wash_id,address_line,city,postal_code')
    .in('wash_id', washIds)
    .eq('is_primary', true);
  if (locationsError) throw locationsError;
  const byId = new Map((locations ?? []).map((item: any) => [String(item.wash_id), item]));

  const prospects = washRows.slice(0, 10).map((wash: any, index: number) => {
    const location: any = byId.get(String(wash.id)) ?? {};
    return {
      rank: index + 1,
      washId: wash.id,
      name: wash.canonical_name,
      rating: wash.rating === null ? null : Number(wash.rating),
      ratingCount: Number(wash.rating_count ?? 0),
      city: location.city ?? null,
      postalCode: location.postal_code ?? null,
      address: location.address_line ?? null,
    };
  });
  return {scope: scope.label, prospects};
}

function resultBody(result: AgentResult) {
  const findings = result.findings.map((item) => `• ${item}`).join('\n');
  const deliverables = result.deliverables.map((item) => `• ${item}`).join('\n');
  return [
    result.summary,
    findings ? `\nFindings\n${findings}` : '',
    deliverables ? `\nDeliverables\n${deliverables}` : '',
    result.recommendation ? `\nRecommendation\n${result.recommendation}` : '',
  ].filter(Boolean).join('\n');
}

async function buildAgentResult(
  db: Db,
  task: HqTaskRecord,
  ops: Record<string, number | string>,
  github: Awaited<ReturnType<typeof githubSignals>>,
): Promise<AgentResult> {
  const goal = founderGoalFromTask(task);

  if (task.agent_key === 'product') {
    const opens = Number(ops.app_opens_7d ?? 0);
    const searches = Number(ops.searches_7d ?? 0);
    const supportViews = Number(ops.support_views_7d ?? 0);
    const searchRate = opens ? Math.round((searches / opens) * 100) : 0;
    return {
      summary: `Product review completed for: ${goal}. Current 7-day signal is ${opens} app opens, ${searches} searches and ${supportViews} support views.`,
      findings: [
        `Search events are ${searchRate}% of app-open events; treat this as a directional activation signal, not a unique-user conversion rate.`,
        'Pilot success should be measured around trustworthy location discovery, visible queue confidence, successful reporting and repeat usage—not feature count.',
        'Internal/test traffic can distort the current event totals, so pilot metrics need a clearly tagged cohort before making UX decisions.',
      ],
      deliverables: [
        'Pilot acceptance gate: users can set/search a location, see nearby washes, open details, and return without losing the selected area.',
        'Queue trust gate: the UI must distinguish recent community evidence from unknown/no-recent-data states.',
        'Measurement gate: track pilot app opens, searches, wash-detail views, queue reports, completed waits and support/error events as a single funnel.',
        'Scope guardrail: no new social or monetization feature should block pilot readiness.',
      ],
      recommendation: 'Ship the smallest trustworthy pilot experience first, instrument the pilot cohort, then prioritize changes from observed friction.',
      metrics: {opens7d: opens, searches7d: searches, supportViews7d: supportViews, searchEventsPerOpenPct: searchRate},
    };
  }

  if (task.agent_key === 'engineering') {
    const failed = github.recentFailedRuns ?? [];
    const stale = github.staleDraftPullRequests ?? [];
    return {
      summary: github.available
        ? `Engineering readiness review completed: ${github.openPullRequests} open PR(s), ${failed.length} recent failed workflow run(s), and ${stale.length} stale draft PR(s).`
        : 'Engineering readiness review completed, but GitHub public metadata was unavailable during this run.',
      findings: [
        failed.length
          ? `Release health is not fully green: recent failures include ${failed.slice(0, 3).map((item: any) => item.name).join(', ')}.`
          : 'No recent failed GitHub workflow was returned by the public status check.',
        stale.length
          ? `${stale.length} draft PR(s) have been idle for more than seven days and should be closed, revived or superseded.`
          : 'No stale draft PR was identified by the current rule.',
        'A public pilot should only advance when build/type/lint gates pass and the known map synthetic-test baseline is either fixed or explicitly waived with evidence.',
      ],
      deliverables: [
        'Run the quality workflow on the release candidate and require lint, typecheck, tests and build to pass.',
        'Verify the live Cloudflare deployment after merge, not only the local/PR build.',
        'Keep the existing map Search-this-area failure as a tracked engineering defect until the synthetic test is green.',
        'Use a rollback-ready release: one merge, one deployment, one smoke check, then pilot.',
      ],
      recommendation: failed.length ? 'Treat the current red workflow history as a release risk and resolve the failing browser path before widening the pilot.' : 'Proceed with a small pilot once the release candidate remains green after deployment.',
      metrics: {openPullRequests: github.openPullRequests, recentFailedRuns: failed, staleDraftPullRequests: stale},
    };
  }

  if (task.agent_key === 'data') {
    const readiness = await scopedReadiness(db, goal, ops);
    return {
      summary: `Data readiness review completed for ${readiness.scope}: ${readiness.activeWashes} active wash(es), ${readiness.hoursCoveragePct}% business-hours coverage, and ${readiness.queueReports30d ?? 'GTA-wide'} recent queue-evidence count context.`,
      findings: [
        `${readiness.washesWithHours} of ${readiness.activeWashes} active scoped washes have business-hours records.`,
        readiness.queueReports30d === null
          ? 'Queue-report coverage is being read from the GTA operating layer; a location-specific evidence cohort was not available for this scope.'
          : `${readiness.queueReports30d} non-disabled queue reports were recorded in the scoped area during the last 30 days.`,
        readiness.hoursCoveragePct < 95
          ? 'Business-hours completeness is below the 95% pilot confidence target.'
          : 'Business-hours completeness meets the 95% pilot confidence target.',
        'Queue estimates should show an explicit unknown state when recent evidence is absent rather than implying precision.',
      ],
      deliverables: [
        'Pilot data gate: ≥95% of scoped active washes have current hours.',
        'Pilot trust gate: no synthetic/fallback queue number is presented as live community evidence.',
        'Freshness gate: catalogue records older than 30 days are flagged before expansion.',
        'Daily pilot review should compare submitted queue reports with completed waits where available.',
      ],
      recommendation: readiness.hoursCoveragePct < 95
        ? 'Close the hours-coverage gap before public promotion; do not trigger paid catalogue refreshes automatically while Zero-Cost Mode is enabled.'
        : 'The hours layer is ready enough for a controlled pilot; focus next on increasing real queue evidence.',
      metrics: readiness,
    };
  }

  if (task.agent_key === 'growth') {
    const {scope, prospects} = await prospectList(db, goal);
    const names = prospects.slice(0, 5).map((item: any) => item.name).join(', ');
    const suggestedMessage = 'Hi — I’m building WashRadar, a local car-wash discovery and live queue platform. We’re preparing a small pilot and would like to include a few local operators early. I’d love to show you how your location appears and discuss a no-obligation pilot partnership.';
    return {
      summary: `Growth package prepared for ${scope}. ${prospects.length} high-signal existing catalogue location(s) were shortlisted using rating volume as the first zero-cost proxy for local visibility.`,
      findings: [
        prospects.length ? `Top initial names include ${names}.` : 'No scoped prospect set was returned from the current catalogue filter.',
        'The shortlist is a prioritization aid, not proof that an operator will buy advertising.',
        'No email, message or external outreach was sent by the agent.',
      ],
      deliverables: [
        `Ranked ${prospects.length}-location first-pass prospect shortlist for founder review.`,
        'Founder-approved outreach should start with a small batch and track replies before scaling.',
        'Suggested opening message prepared for manual/policy-controlled outreach.',
        'Record contacted, replied, meeting and partner-converted states so growth can learn from the first batch.',
      ],
      recommendation: prospects.length ? 'Review the shortlist in Approval Centre; if approved, use it as the first outreach batch. Sending remains disabled in Zero-Cost Mode.' : 'Broaden the geography or improve catalogue business metadata before beginning outreach.',
      prospects,
      metrics: {scope, prospectCount: prospects.length},
      approval: prospects.length ? {
        actionType: 'partner_outreach_package',
        summary: `Approve ${scope} first outreach shortlist (${prospects.length} prospects)`,
        payload: {scope, prospects, suggestedMessage, sendingEnabled: false},
      } : undefined,
    };
  }

  if (task.agent_key === 'operations') {
    const reports = Number(ops.queue_reports_24h ?? 0);
    const nearby = Number(ops.nearby_queue_reports_24h ?? 0);
    const sessions = Number(ops.active_queue_sessions ?? 0);
    const moderation = Number(ops.pending_moderation ?? 0);
    return {
      summary: `Operations review completed: ${reports} queue report(s) in 24h, ${nearby} nearby-verified, ${sessions} active queue session(s), and ${moderation} pending moderation item(s).`,
      findings: [
        moderation ? `${moderation} moderation item(s) require operator review.` : 'No moderation backlog is currently pending.',
        reports === 0 ? 'No queue report was recorded in the last 24 hours, so pilot support should expect sparse-data states.' : 'Recent queue activity exists and can be used to validate the pilot operating flow.',
        'Support and incident handling should differentiate product defects, stale business data, and community-signal disputes.',
      ],
      deliverables: [
        'Pilot support checklist: login/location issue, missing wash, wrong hours, queue disagreement, report abuse, deployment incident.',
        'Escalation rule: anything involving production data deletion, user-account intervention, money or external commitments stays founder-approved.',
        'Daily pilot check: moderation backlog, queue-report volume, active sessions and support-view spikes.',
        'Rollback rule: if location/search or queue-report submission breaks after deploy, revert before adding pilot users.',
      ],
      recommendation: moderation ? 'Clear moderation before inviting more users.' : 'Operations is ready for a controlled pilot; keep the daily checklist lightweight and evidence-driven.',
      metrics: {queueReports24h: reports, nearbyQueueReports24h: nearby, activeQueueSessions: sessions, pendingModeration: moderation},
    };
  }

  return {
    summary: `Task reviewed by ${task.agent_key ?? 'HQ'} in Zero-Cost Mode.`,
    findings: ['No specialist execution rule matched this task, so HQ preserved it as a reviewed internal work item rather than inventing external facts.'],
    deliverables: ['Task context captured in the shared Brain.', 'Founder can refine the task or assign it to a specialist agent for a deeper deterministic run.'],
    recommendation: 'Assign the task to Product, Engineering, Data, Growth or Operations if specialist analysis is required.',
  };
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
  taskId?: string | null;
  runType?: string;
}) {
  const {data, error} = await db.from('hq_agent_runs').insert({
    agent_key: input.agentKey,
    task_id: input.taskId ?? null,
    run_type: input.runType ?? 'health_scan',
    mode: 'zero_cost_rules',
    status: 'complete',
    summary: input.summary,
    output: input.output,
    completed_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw error;
  return data;
}

async function createApprovalIfNeeded(db: Db, task: HqTaskRecord, result: AgentResult, userId: string) {
  if (!result.approval) return false;
  const {data: existing, error: existingError} = await db.from('hq_approvals')
    .select('id')
    .eq('task_id', task.id)
    .eq('action_type', result.approval.actionType)
    .eq('status', 'pending')
    .limit(1);
  if (existingError) throw existingError;
  if (existing?.length) return true;

  const {error} = await db.from('hq_approvals').insert({
    task_id: task.id,
    agent_key: task.agent_key,
    action_type: result.approval.actionType,
    summary: result.approval.summary,
    payload: result.approval.payload,
    status: 'pending',
    requested_by: userId,
  });
  if (error) throw error;
  return true;
}

async function executeTask(
  db: Db,
  task: HqTaskRecord,
  userId: string,
  ops: Record<string, number | string>,
  github: Awaited<ReturnType<typeof githubSignals>>,
) {
  if (!task.agent_key || task.agent_key === 'chief') return {taskId: task.id, skipped: true};

  await db.from('hq_tasks').update({status: 'in_progress'}).eq('id', task.id);
  try {
    const result = await buildAgentResult(db, task, ops, github);
    await writeRun(db, {
      agentKey: task.agent_key,
      taskId: task.id,
      runType: 'task_execution',
      summary: result.summary,
      output: result,
    });

    await db.from('hq_memory').insert({
      category: 'agent_result',
      title: `${task.agent_key} · ${task.title}`.slice(0, 180),
      body: resultBody(result),
      source: 'agent_execution',
      tags: ['agent-result', task.agent_key, ...(planIdFromTask(task) ? [String(planIdFromTask(task))] : [])],
      pinned: false,
      created_by: userId,
    });

    const waitingApproval = await createApprovalIfNeeded(db, task, result, userId);
    await db.from('hq_tasks').update({
      status: waitingApproval ? 'waiting_approval' : 'done',
      completed_at: waitingApproval ? null : new Date().toISOString(),
    }).eq('id', task.id);

    return {taskId: task.id, agentKey: task.agent_key, waitingApproval, result};
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Agent execution failed.';
    await db.from('hq_agent_runs').insert({
      agent_key: task.agent_key,
      task_id: task.id,
      run_type: 'task_execution',
      mode: 'zero_cost_rules',
      status: 'failed',
      summary: message,
      output: {error: message},
      completed_at: new Date().toISOString(),
    });
    await db.from('hq_tasks').update({status: 'blocked'}).eq('id', task.id);
    return {taskId: task.id, agentKey: task.agent_key, error: message};
  }
}

async function finalizeChiefTasks(db: Db, tasks: HqTaskRecord[], userId: string) {
  const chiefs = tasks.filter((task) => task.agent_key === 'chief' && planIdFromTask(task));
  const summaries: Array<Record<string, unknown>> = [];

  for (const chief of chiefs) {
    const planId = planIdFromTask(chief)!;
    const siblings = tasks.filter((task) => task.dedupe_key?.startsWith(`plan:${planId}:`) && task.id !== chief.id);
    const siblingIds = siblings.map((task) => task.id);
    const {data: runs, error} = siblingIds.length
      ? await db.from('hq_agent_runs').select('task_id,agent_key,summary,output,completed_at').in('task_id', siblingIds).eq('run_type', 'task_execution').order('completed_at', {ascending: false})
      : {data: [], error: null};
    if (error) throw error;

    const latestByTask = new Map<string, any>();
    for (const run of runs ?? []) if (!latestByTask.has(String(run.task_id))) latestByTask.set(String(run.task_id), run);
    const waiting = siblings.filter((task) => task.status === 'waiting_approval');
    const blocked = siblings.filter((task) => task.status === 'blocked');
    const completed = siblings.filter((task) => task.status === 'done').length;

    const lines = siblings.map((task) => {
      const run = latestByTask.get(task.id);
      return `${task.agent_key}: ${run?.summary ?? task.status}`;
    });

    const summary = blocked.length
      ? `Chief brief: ${completed}/${siblings.length} specialist tasks completed, ${blocked.length} blocked, ${waiting.length} waiting founder approval.`
      : waiting.length
        ? `Chief brief: specialist work is complete; ${waiting.length} item(s) are waiting for founder approval.`
        : `Chief brief: all ${siblings.length} specialist tasks completed. The plan is ready for founder review.`;

    await writeRun(db, {
      agentKey: 'chief',
      taskId: chief.id,
      runType: 'task_execution',
      summary,
      output: {planId, completed, total: siblings.length, waitingApproval: waiting.map((task) => task.title), blocked: blocked.map((task) => task.title), specialistSummaries: lines},
    });

    await db.from('hq_memory').insert({
      category: 'chief_brief',
      title: `Chief brief · ${planId}`,
      body: [summary, ...lines.map((line) => `• ${line}`)].join('\n'),
      source: 'chief_execution',
      tags: ['chief-brief', planId],
      pinned: true,
      created_by: userId,
    });

    await db.from('hq_tasks').update({
      status: blocked.length ? 'blocked' : waiting.length ? 'waiting_approval' : 'done',
      completed_at: blocked.length || waiting.length ? null : new Date().toISOString(),
    }).eq('id', chief.id);

    summaries.push({planId, summary, waiting: waiting.length, blocked: blocked.length});
  }
  return summaries;
}

async function runCompany(db: Db, userId: string, planId?: string | null) {
  let query = db.from('hq_tasks')
    .select('id,title,detail,agent_key,status,priority,source,dedupe_key,approval_required')
    .in('status', ['queued','in_progress'])
    .order('created_at', {ascending: true})
    .limit(30);
  if (planId) query = query.like('dedupe_key', `plan:${planId}:%`);

  const {data, error} = await query;
  if (error) throw error;
  const tasks = (data ?? []) as HqTaskRecord[];
  const specialists = tasks.filter((task) => task.agent_key && task.agent_key !== 'chief');
  const [ops, github] = await Promise.all([operationalSnapshot(db), githubSignals()]);

  const executions = await Promise.all(specialists.map((task) => executeTask(db, task, userId, ops, github)));

  const standaloneChiefs = tasks.filter((task) => task.agent_key === 'chief' && !planIdFromTask(task));
  for (const chief of standaloneChiefs) {
    const summary = 'Chief of Staff reviewed the current company queue and completed the coordination task.';
    await writeRun(db, {
      agentKey: 'chief',
      taskId: chief.id,
      runType: 'task_execution',
      summary,
      output: {summary, findings: ['Specialist execution is handled by the assigned department agents.'], deliverables: ['Current queue reviewed and coordination record closed.'], recommendation: 'Use Scan & work for live operating checks or assign a founder goal for cross-functional execution.'},
    });
    await db.from('hq_tasks').update({status: 'done', completed_at: new Date().toISOString()}).eq('id', chief.id);
  }

  let allPlanTasks = tasks;
  const planIds = [...new Set(tasks.map(planIdFromTask).filter(Boolean) as string[])];
  if (planIds.length) {
    const {data: refreshed, error: refreshError} = await db.from('hq_tasks')
      .select('id,title,detail,agent_key,status,priority,source,dedupe_key,approval_required')
      .or(planIds.map((id) => `dedupe_key.like.plan:${id}:%`).join(','));
    if (refreshError) throw refreshError;
    allPlanTasks = (refreshed ?? []) as HqTaskRecord[];
  }

  const chiefBriefs = await finalizeChiefTasks(db, allPlanTasks, userId);
  return {
    processed: executions.length,
    completed: executions.filter((item: any) => item.result && !item.waitingApproval).length,
    waitingApproval: executions.filter((item: any) => item.waitingApproval).length,
    blocked: executions.filter((item: any) => item.error).length,
    executions,
    chiefBriefs,
  };
}

async function runHqScan(db: Db, userId: string) {
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
    writeRun(db, {agentKey: 'data', summary: `Catalogue: ${activeWashes} active washes, ${Math.round(hoursCoverage * 100)}% hours coverage, ${staleWashes} stale records.`, output: {activeWashes, washesWithHours, hoursCoverage, staleWashes}}),
    writeRun(db, {agentKey: 'product', summary: `7-day product signal: ${appOpens} opens, ${searches} searches, ${Math.round(searchActivation * 100)}% searches per app-open event.`, output: {appOpens, searches, searchActivation, supportViews: Number(ops.support_views_7d ?? 0)}}),
    writeRun(db, {agentKey: 'engineering', summary: github.available ? `GitHub: ${(github as any).openPullRequests} open PR(s), ${staleDrafts.length} stale draft(s), ${failedRuns.length} recent failed run(s).` : 'GitHub public status could not be fetched during this scan; no production action was taken.', output: github}),
    writeRun(db, {agentKey: 'growth', summary: `Commercial pipeline: ${advertisers} advertiser business(es), ${Number(ops.active_campaigns ?? 0)} active campaign(s).`, output: {advertisers, activeCampaigns: Number(ops.active_campaigns ?? 0)}}),
    writeRun(db, {agentKey: 'operations', summary: `Operations: ${Number(ops.queue_reports_24h ?? 0)} queue reports in 24h, ${pendingModeration} pending moderation item(s).`, output: {queueReports24h: Number(ops.queue_reports_24h ?? 0), nearbyQueueReports24h: Number(ops.nearby_queue_reports_24h ?? 0), activeQueueSessions: Number(ops.active_queue_sessions ?? 0), pendingModeration}}),
    writeRun(db, {agentKey: 'chief', summary: `HQ scan completed. ${created.length} new task(s) created. Zero-Cost Mode remained enabled.`, output: {createdTasks: created, zeroCostMode: true}}),
  ]);

  await db.from('hq_memory').insert({
    category: 'scan',
    title: 'HQ health scan',
    body: `Completed live health scan. Created ${created.length} new follow-up task(s): ${created.length ? created.join(', ') : 'none'}.`,
    source: 'agent_scan',
    tags: ['health-scan','zero-cost'],
    pinned: false,
  });

  const execution = await runCompany(db, userId);
  return {operational: ops, github, createdTasks: created, execution};
}

async function hqSnapshot(db: Db) {
  const [agents, tasks, approvals, memory, settings, runs, operational, github] = await Promise.all([
    db.from('hq_agents').select('*').eq('active', true).order('sort_order'),
    db.from('hq_tasks').select('*').order('created_at', {ascending: false}).limit(120),
    db.from('hq_approvals').select('*').order('requested_at', {ascending: false}).limit(50),
    db.from('hq_memory').select('*').order('pinned', {ascending: false}).order('created_at', {ascending: false}).limit(60),
    db.from('hq_settings').select('*').order('key'),
    db.from('hq_agent_runs').select('*').order('started_at', {ascending: false}).limit(120),
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
    {agent_key: 'product', title: 'Define product outcome and acceptance criteria', detail: `Founder goal: ${goal}\n\nClarify the user outcome, scope, success measures, and what should explicitly stay out of scope.`, priority: 'high'},
    {agent_key: 'engineering', title: 'Assess implementation and release readiness', detail: `Founder goal: ${goal}\n\nIdentify the smallest safe implementation path, dependencies, tests, rollout checks, and technical risks.`, priority: 'high'},
    {agent_key: 'data', title: 'Validate data readiness and measurement', detail: `Founder goal: ${goal}\n\nConfirm the underlying data is trustworthy and define the metrics that will prove whether the goal worked.`, priority: 'normal'},
    {agent_key: 'growth', title: 'Prepare growth and communication plan', detail: `Founder goal: ${goal}\n\nDefine the audience, acquisition/partner motion, messaging, and what needs founder approval before external outreach.`, priority: 'normal'},
    {agent_key: 'operations', title: 'Prepare operating and support checklist', detail: `Founder goal: ${goal}\n\nDefine launch/support procedures, exception handling, moderation needs, and rollback/escalation steps.`, priority: 'normal'},
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

  const execution = await runCompany(db, userId, planId);
  return {planId, tasks: data ?? [], execution};
}

async function finishPlanAfterApproval(db: Db, taskId: string, userId: string) {
  const {data: task} = await db.from('hq_tasks')
    .select('id,title,detail,agent_key,status,priority,source,dedupe_key,approval_required')
    .eq('id', taskId)
    .single();
  if (!task) return;

  await db.from('hq_tasks').update({status: 'done', completed_at: new Date().toISOString()}).eq('id', taskId);
  const planId = planIdFromTask(task as HqTaskRecord);
  if (!planId) return;

  const {data: planTasks, error} = await db.from('hq_tasks')
    .select('id,title,detail,agent_key,status,priority,source,dedupe_key,approval_required')
    .like('dedupe_key', `plan:${planId}:%`);
  if (error) throw error;
  await finalizeChiefTasks(db, (planTasks ?? []) as HqTaskRecord[], userId);
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
          id: report.id, washId: report.wash_id, kind: report.report_kind, createdAt: report.created_at,
          disabled: report.disabled, verification: report.proximity,
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
      const execution = await runCompany(db, user.id);
      return json(request, {task: data, execution});
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
      const {data: approval, error} = await db.from('hq_approvals').update({
        status: parsed.data.decision,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        review_note: parsed.data.note,
      }).eq('id', parsed.data.approvalId).eq('status', 'pending').select('*').single();
      if (error) throw error;
      if (approval?.task_id) await finishPlanAfterApproval(db, approval.task_id, user.id);
      return json(request, {approval});
    }

    if (parsed.data.action === 'hq-run-scan') return json(request, await runHqScan(db, user.id));
    if (parsed.data.action === 'hq-run-company') return json(request, await runCompany(db, user.id));
    if (parsed.data.action === 'hq-plan-goal') return json(request, await planGoal(db, parsed.data.goal, user.id));

    return json(request, {error: 'Unsupported action.'}, 400);
  } catch (caught) {
    console.error('admin action failed', caught);
    return json(request, {error: caught instanceof Error ? caught.message : 'Admin action failed.'}, 500);
  }
});
