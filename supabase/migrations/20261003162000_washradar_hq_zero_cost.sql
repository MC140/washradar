-- WashRadar HQ: zero-cost multi-agent operating layer.
-- All tables are internal-only. Browser roles receive no direct table privileges;
-- admin access goes through the authenticated admin Edge Function using service_role.

create table if not exists public.hq_agents (
  key text primary key,
  name text not null,
  department text not null,
  purpose text not null,
  automation_level smallint not null default 1 check (automation_level between 0 and 4),
  active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hq_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 180),
  detail text not null default '',
  agent_key text references public.hq_agents(key) on update cascade on delete set null,
  status text not null default 'backlog'
    check (status in ('backlog','queued','in_progress','waiting_approval','done','blocked')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  source text not null default 'manual',
  dedupe_key text,
  approval_required boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.hq_agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null references public.hq_agents(key) on update cascade on delete restrict,
  task_id uuid references public.hq_tasks(id) on delete set null,
  run_type text not null default 'health_scan',
  mode text not null default 'zero_cost_rules',
  status text not null default 'running'
    check (status in ('running','complete','failed','skipped')),
  summary text not null default '',
  output jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.hq_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.hq_tasks(id) on delete cascade,
  agent_key text references public.hq_agents(key) on update cascade on delete set null,
  action_type text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text
);

create table if not exists public.hq_memory (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'observation',
  title text not null check (char_length(title) between 3 and 180),
  body text not null,
  source text not null default 'manual',
  tags text[] not null default '{}'::text[],
  pinned boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hq_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists hq_tasks_status_priority_idx
  on public.hq_tasks(status, priority, updated_at desc);
create index if not exists hq_tasks_agent_status_idx
  on public.hq_tasks(agent_key, status, updated_at desc);
create index if not exists hq_tasks_dedupe_idx
  on public.hq_tasks(dedupe_key) where dedupe_key is not null;
create index if not exists hq_agent_runs_agent_started_idx
  on public.hq_agent_runs(agent_key, started_at desc);
create index if not exists hq_approvals_status_idx
  on public.hq_approvals(status, requested_at desc);
create index if not exists hq_memory_created_idx
  on public.hq_memory(created_at desc);

create or replace function public.touch_washradar_hq_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hq_agents_touch_updated_at on public.hq_agents;
create trigger hq_agents_touch_updated_at
before update on public.hq_agents
for each row execute function public.touch_washradar_hq_updated_at();

drop trigger if exists hq_tasks_touch_updated_at on public.hq_tasks;
create trigger hq_tasks_touch_updated_at
before update on public.hq_tasks
for each row execute function public.touch_washradar_hq_updated_at();

drop trigger if exists hq_memory_touch_updated_at on public.hq_memory;
create trigger hq_memory_touch_updated_at
before update on public.hq_memory
for each row execute function public.touch_washradar_hq_updated_at();

alter table public.hq_agents enable row level security;
alter table public.hq_tasks enable row level security;
alter table public.hq_agent_runs enable row level security;
alter table public.hq_approvals enable row level security;
alter table public.hq_memory enable row level security;
alter table public.hq_settings enable row level security;

revoke all on public.hq_agents from anon, authenticated;
revoke all on public.hq_tasks from anon, authenticated;
revoke all on public.hq_agent_runs from anon, authenticated;
revoke all on public.hq_approvals from anon, authenticated;
revoke all on public.hq_memory from anon, authenticated;
revoke all on public.hq_settings from anon, authenticated;

grant select, insert, update, delete on public.hq_agents to service_role;
grant select, insert, update, delete on public.hq_tasks to service_role;
grant select, insert, update, delete on public.hq_agent_runs to service_role;
grant select, insert, update, delete on public.hq_approvals to service_role;
grant select, insert, update, delete on public.hq_memory to service_role;
grant select, insert, update, delete on public.hq_settings to service_role;

insert into public.hq_agents (key, name, department, purpose, automation_level, sort_order)
values
  ('chief', 'Chief of Staff', 'Executive', 'Turn the founder goal into coordinated work, surface risks, and keep the team focused.', 2, 1),
  ('product', 'Product Agent', 'Product', 'Read product signals, identify friction, and turn evidence into product tasks.', 2, 2),
  ('engineering', 'Engineering Agent', 'Engineering', 'Watch repository and release health, surface failures, and prepare engineering follow-ups.', 2, 3),
  ('data', 'Data Agent', 'Data', 'Monitor catalogue freshness, queue evidence, timing coverage, and data-quality gaps.', 2, 4),
  ('growth', 'Growth Agent', 'Growth', 'Monitor the advertiser pipeline and create concrete acquisition work without sending anything automatically.', 1, 5),
  ('operations', 'Operations Agent', 'Operations', 'Watch moderation, queue activity, and operational exceptions that need attention.', 2, 6)
on conflict (key) do update set
  name = excluded.name,
  department = excluded.department,
  purpose = excluded.purpose,
  automation_level = excluded.automation_level,
  sort_order = excluded.sort_order,
  active = true;

insert into public.hq_settings (key, value)
values
  ('zero_cost_mode', 'true'::jsonb),
  ('paid_ai_enabled', 'false'::jsonb),
  ('cloudflare_ai_enabled', 'false'::jsonb),
  ('monthly_budget_usd', '0'::jsonb),
  ('hq_version', '"1.0"'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

insert into public.hq_tasks (title, detail, agent_key, status, priority, source, dedupe_key)
select
  'Run the first WashRadar HQ health scan',
  'Run all six agents against live WashRadar operational data and establish the first shared HQ memory.',
  'chief',
  'queued',
  'high',
  'system',
  'hq:first-health-scan'
where not exists (
  select 1 from public.hq_tasks where dedupe_key = 'hq:first-health-scan'
);

insert into public.hq_memory (category, title, body, source, tags, pinned)
select
  'decision',
  'Month 1 operating rule',
  'WashRadar HQ starts in Zero-Cost Mode. Paid AI providers are disabled. Agents use live product data, deterministic analysis, and only explicitly enabled free-tier inference.',
  'system',
  array['zero-cost','governance','month-1'],
  true
where not exists (
  select 1 from public.hq_memory where title = 'Month 1 operating rule'
);
