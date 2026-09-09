create index if not exists queue_reports_user_history_idx
  on public.queue_reports(user_id, created_at desc)
  where user_id is not null and disabled = false;

create index if not exists queue_reports_user_wash_idx
  on public.queue_reports(user_id, wash_id)
  where user_id is not null and disabled = false;

create index if not exists queue_reports_wash_expiry_idx
  on public.queue_reports(wash_id, expires_at desc, created_at desc)
  where disabled = false;

create index if not exists wash_type_reports_user_history_idx
  on public.wash_type_reports(user_id, created_at desc)
  where user_id is not null and disabled = false;

create index if not exists points_ledger_user_category_created_idx
  on public.points_ledger(user_id, category, created_at desc);
