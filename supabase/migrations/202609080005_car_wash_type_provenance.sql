alter table public.car_wash_types add column if not exists source_label text;
alter table public.car_wash_types add column if not exists confidence_score smallint check (confidence_score between 0 and 100);
alter table public.car_wash_types add column if not exists verified_at timestamptz;
