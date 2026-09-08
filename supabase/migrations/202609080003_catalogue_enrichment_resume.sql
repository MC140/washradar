-- Make the Google catalogue import resumable and retain provenance for conservative wash-type labels.
grant select, insert, update, delete on table public.business_hours to service_role;
grant select, insert, update, delete on table public.car_wash_types to service_role;

create table if not exists public.catalogue_import_state (
  job_key text primary key,
  next_index integer not null default 0 check (next_index >= 0),
  total integer not null check (total > 0),
  last_area text,
  last_error text,
  page_token text,
  page_number integer not null default 0 check (page_number >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.catalogue_import_state enable row level security;
grant select, insert, update, delete on table public.catalogue_import_state to service_role;

alter table public.car_wash_types add column if not exists source_label text;
alter table public.car_wash_types add column if not exists confidence_score smallint check (confidence_score between 0 and 100);
alter table public.car_wash_types add column if not exists verified_at timestamptz;

-- The first municipality run stopped immediately after Whitby (25/30).
insert into public.catalogue_import_state(job_key, next_index, total, last_area)
values ('gta-full', 25, 30, 'Whitby, Ontario, Canada')
on conflict (job_key) do nothing;
