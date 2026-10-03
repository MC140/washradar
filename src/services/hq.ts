import {supabaseClient} from './supabaseClient';

export type HqTaskStatus = 'backlog' | 'queued' | 'in_progress' | 'waiting_approval' | 'done' | 'blocked';
export type HqPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface HqAgent {
  key: string;
  name: string;
  department: string;
  purpose: string;
  automation_level: number;
  active: boolean;
  sort_order: number;
}

export interface HqTask {
  id: string;
  title: string;
  detail: string;
  agent_key: string | null;
  status: HqTaskStatus;
  priority: HqPriority;
  source: string;
  dedupe_key: string | null;
  approval_required: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface HqRun {
  id: string;
  agent_key: string;
  task_id: string | null;
  run_type: string;
  mode: string;
  status: string;
  summary: string;
  output: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
}

export interface HqApproval {
  id: string;
  task_id: string | null;
  agent_key: string | null;
  action_type: string;
  summary: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface HqMemory {
  id: string;
  category: string;
  title: string;
  body: string;
  source: string;
  tags: string[];
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface HqOperational {
  active_washes?: number;
  washes_with_hours?: number;
  stale_washes_30d?: number;
  queue_reports_24h?: number;
  nearby_queue_reports_24h?: number;
  active_queue_sessions?: number;
  pending_moderation?: number;
  advertiser_businesses?: number;
  active_campaigns?: number;
  app_opens_7d?: number;
  searches_7d?: number;
  support_views_7d?: number;
  api_requests_today?: number;
  generated_at?: string;
}

export interface HqGithub {
  available: boolean;
  openPullRequests: number;
  draftPullRequests: number;
  staleDraftPullRequests: {number: number; title: string; updatedAt: string}[];
  recentFailedRuns: {id: number; name: string; branch: string; updatedAt: string; url: string}[];
}

export interface HqSnapshot {
  agents: HqAgent[];
  tasks: HqTask[];
  approvals: HqApproval[];
  memory: HqMemory[];
  settings: Record<string, unknown>;
  runs: HqRun[];
  operational: HqOperational;
  github: HqGithub;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const {data, error} = await supabaseClient.functions.invoke('admin', {body});
  if (error) throw new Error(error.message || 'WashRadar HQ request failed.');
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

export function loadHqSnapshot() {
  return invoke<HqSnapshot>({action: 'hq-snapshot'});
}

export function runHqScan() {
  return invoke<{operational: HqOperational; github: HqGithub; createdTasks: string[]}>({action: 'hq-run-scan'});
}

export function planHqGoal(goal: string) {
  return invoke<{planId: string; tasks: HqTask[]}>({action: 'hq-plan-goal', goal});
}

export function createHqTask(input: {
  title: string;
  detail?: string;
  agentKey?: string | null;
  priority?: HqPriority;
  approvalRequired?: boolean;
}) {
  return invoke<{task: HqTask}>({
    action: 'hq-create-task',
    title: input.title,
    detail: input.detail ?? '',
    agentKey: input.agentKey ?? null,
    priority: input.priority ?? 'normal',
    approvalRequired: input.approvalRequired ?? false,
  });
}

export function updateHqTask(taskId: string, updates: {status?: HqTaskStatus; priority?: HqPriority}) {
  return invoke<{task: HqTask}>({action: 'hq-update-task', taskId, ...updates});
}

export function addHqMemory(input: {title: string; body: string; category?: string; pinned?: boolean}) {
  return invoke<{memory: HqMemory}>({
    action: 'hq-add-memory',
    title: input.title,
    body: input.body,
    category: input.category ?? 'observation',
    pinned: input.pinned ?? false,
  });
}

export function reviewHqApproval(approvalId: string, decision: 'approved' | 'rejected' | 'cancelled', note = '') {
  return invoke<{approval: HqApproval}>({action: 'hq-review-approval', approvalId, decision, note});
}
