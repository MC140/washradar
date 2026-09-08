-- Low-friction queue trust scoring support.
-- Allow one actor to report different washes within the same minute while still
-- preventing duplicate same-wash rows in that minute.
drop index if exists public.queue_reports_actor_minute_idx;
create unique index if not exists queue_reports_actor_wash_minute_idx
  on public.queue_reports (actor_hash, wash_id, report_minute)
  where disabled = false and report_kind <> 'session';

-- Edge queue engine runs with service_role and needs explicit table privileges.
grant select, insert, update, delete on table public.queue_reports to service_role;
grant select, insert, update, delete on table public.queue_sessions to service_role;
grant select, insert, update, delete on table public.queue_estimates to service_role;
grant select, insert, update, delete on table public.historical_queue_stats to service_role;
grant select, insert, update, delete on table public.contributor_reputation to service_role;
