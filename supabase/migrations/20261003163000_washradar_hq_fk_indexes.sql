-- Cover WashRadar HQ foreign keys used by task/run/approval lifecycle lookups.
create index if not exists hq_agent_runs_task_idx
  on public.hq_agent_runs(task_id)
  where task_id is not null;

create index if not exists hq_approvals_task_idx
  on public.hq_approvals(task_id)
  where task_id is not null;

create index if not exists hq_approvals_agent_idx
  on public.hq_approvals(agent_key)
  where agent_key is not null;
