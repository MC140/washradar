-- WashRadar community layer: profile identity, private vehicles, Radar Points and server-trusted challenges.
-- Rewards are intentionally separate from queue trust. Points never change report confidence weights.

alter table public.profiles add column if not exists handle text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;

create unique index if not exists profiles_handle_unique_ci
  on public.profiles (lower(handle)) where handle is not null;

alter table public.profiles drop constraint if exists profiles_handle_format;
alter table public.profiles add constraint profiles_handle_format
  check (handle is null or handle ~ '^[A-Za-z0-9_]{3,24}$');

create table if not exists public.user_vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year smallint not null check (year between 1980 and 2100),
  make text not null check (char_length(trim(make)) between 1 and 60),
  model text not null check (char_length(trim(model)) between 1 and 80),
  nickname text check (nickname is null or char_length(trim(nickname)) <= 40),
  vin text check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_vehicles_one_primary
  on public.user_vehicles(user_id) where is_primary;
create index if not exists user_vehicles_user_idx on public.user_vehicles(user_id, created_at desc);

alter table public.user_vehicles enable row level security;
drop policy if exists user_vehicles_owner_all on public.user_vehicles;
create policy user_vehicles_owner_all on public.user_vehicles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.user_vehicles to authenticated;

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  metric text not null,
  goal integer not null check (goal > 0),
  reward_points integer not null check (reward_points >= 0),
  category text not null default 'contribution',
  sort_order integer not null default 0,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.challenge_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  progress integer not null default 0 check (progress >= 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);

create table if not exists public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  category text not null,
  source_type text not null,
  source_key text not null,
  description text not null,
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_key)
);

create index if not exists points_ledger_user_created_idx on public.points_ledger(user_id, created_at desc);
create index if not exists challenge_progress_user_idx on public.challenge_progress(user_id, updated_at desc);

alter table public.challenges enable row level security;
alter table public.challenge_progress enable row level security;
alter table public.points_ledger enable row level security;

drop policy if exists challenges_public_read on public.challenges;
create policy challenges_public_read on public.challenges
  for select to anon, authenticated
  using (active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now()));

drop policy if exists challenge_progress_owner_read on public.challenge_progress;
create policy challenge_progress_owner_read on public.challenge_progress
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists points_ledger_owner_read on public.points_ledger;
create policy points_ledger_owner_read on public.points_ledger
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.challenges to anon, authenticated;
grant select on public.challenge_progress, public.points_ledger to authenticated;

-- Let signed-in contributors view their own raw contribution history. Writes remain server-only.
drop policy if exists queue_reports_owner_read on public.queue_reports;
create policy queue_reports_owner_read on public.queue_reports
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists wash_type_reports_owner_read on public.wash_type_reports;
create policy wash_type_reports_owner_read on public.wash_type_reports
  for select to authenticated using (user_id = (select auth.uid()));

grant select on public.queue_reports, public.wash_type_reports to authenticated;

insert into public.challenges (slug, title, description, metric, goal, reward_points, category, sort_order)
values
  ('first-radar', 'First Radar', 'Submit your first nearby queue update.', 'nearby_queue_reports', 1, 100, 'starter', 10),
  ('queue-scout', 'Queue Scout', 'Update the queue at 3 different car washes.', 'distinct_nearby_washes', 3, 250, 'contribution', 20),
  ('verified-wait', 'Verified Wait', 'Complete your first verified “I’m in line” timer.', 'verified_waits', 1, 500, 'verification', 30),
  ('wash-detective', 'Wash Detective', 'Confirm a wash type while you are nearby.', 'nearby_wash_type_reports', 1, 150, 'data-quality', 40),
  ('three-days', '3-Day Contributor', 'Contribute on 3 different days.', 'contribution_days', 3, 300, 'streak', 50),
  ('local-hero', 'Local Hero', 'Help update 5 different nearby washes.', 'distinct_nearby_washes', 5, 750, 'contribution', 60)
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  metric = excluded.metric,
  goal = excluded.goal,
  reward_points = excluded.reward_points,
  category = excluded.category,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = now();

create or replace function public.award_radar_points(
  p_user_id uuid,
  p_amount integer,
  p_category text,
  p_source_type text,
  p_source_key text,
  p_description text,
  p_daily_cap integer default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount integer := greatest(coalesce(p_amount, 0), 0);
  v_remaining integer;
  v_awarded integer;
begin
  if p_user_id is null or v_amount = 0 then return 0; end if;

  if p_daily_cap is not null then
    select greatest(0, p_daily_cap - coalesce(sum(amount), 0))::integer
      into v_remaining
    from public.points_ledger
    where user_id = p_user_id
      and category = p_category
      and created_at >= date_trunc('day', now());
    v_amount := least(v_amount, coalesce(v_remaining, 0));
  end if;

  if v_amount <= 0 then return 0; end if;

  insert into public.points_ledger(user_id, amount, category, source_type, source_key, description)
  values (p_user_id, v_amount, p_category, p_source_type, p_source_key, p_description)
  on conflict (user_id, source_type, source_key) do nothing
  returning amount into v_awarded;

  return coalesce(v_awarded, 0);
end;
$$;

create or replace function public.refresh_user_challenges(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v_progress integer;
  v_completed_at timestamptz;
begin
  if p_user_id is null then return; end if;

  for c in
    select * from public.challenges
    where active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at >= now())
    order by sort_order, created_at
  loop
    v_progress := 0;

    if c.metric = 'nearby_queue_reports' then
      select count(*)::integer into v_progress
      from public.queue_reports
      where user_id = p_user_id and disabled = false
        and proximity::text in ('nearby', 'session')
        and report_kind::text in ('queue', 'session');
    elsif c.metric = 'distinct_nearby_washes' then
      select count(distinct wash_id)::integer into v_progress
      from public.queue_reports
      where user_id = p_user_id and disabled = false
        and proximity::text in ('nearby', 'session')
        and report_kind::text in ('queue', 'session');
    elsif c.metric = 'verified_waits' then
      select count(*)::integer into v_progress
      from public.queue_reports
      where user_id = p_user_id and disabled = false
        and proximity::text = 'session' and report_kind::text = 'session';
    elsif c.metric = 'nearby_wash_type_reports' then
      select count(*)::integer into v_progress
      from public.wash_type_reports
      where user_id = p_user_id and disabled = false and proximity = 'nearby';
    elsif c.metric = 'contribution_days' then
      select count(distinct contribution_day)::integer into v_progress
      from (
        select created_at::date as contribution_day from public.queue_reports
          where user_id = p_user_id and disabled = false and proximity::text in ('nearby', 'session')
        union
        select created_at::date from public.wash_type_reports
          where user_id = p_user_id and disabled = false and proximity = 'nearby'
      ) d;
    end if;

    select completed_at into v_completed_at
      from public.challenge_progress
      where user_id = p_user_id and challenge_id = c.id;

    insert into public.challenge_progress(user_id, challenge_id, progress, completed_at, updated_at)
    values (
      p_user_id,
      c.id,
      least(v_progress, c.goal),
      case when v_progress >= c.goal then coalesce(v_completed_at, now()) else null end,
      now()
    )
    on conflict (user_id, challenge_id) do update set
      progress = excluded.progress,
      completed_at = coalesce(public.challenge_progress.completed_at, excluded.completed_at),
      updated_at = now();

    if v_progress >= c.goal then
      perform public.award_radar_points(
        p_user_id,
        c.reward_points,
        'challenge',
        'challenge',
        c.id::text,
        'Challenge completed: ' || c.title,
        null
      );
    end if;
  end loop;
end;
$$;

create or replace function public.reward_queue_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null or new.disabled then return new; end if;

  if new.proximity::text = 'session' and new.report_kind::text = 'session' then
    perform public.award_radar_points(new.user_id, 75, 'contribution', 'queue_report', new.id::text, 'Verified queue wait', 200);
  elsif new.proximity::text = 'nearby' and new.report_kind::text = 'queue' then
    perform public.award_radar_points(new.user_id, 20, 'contribution', 'queue_report', new.id::text, 'Nearby queue update', 200);
  end if;

  perform public.refresh_user_challenges(new.user_id);
  return new;
end;
$$;

create or replace function public.reward_wash_type_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null or new.disabled then return new; end if;

  if new.proximity = 'nearby' then
    perform public.award_radar_points(new.user_id, 15, 'contribution', 'wash_type_report', new.id::text, 'Nearby wash-type confirmation', 200);
  end if;

  perform public.refresh_user_challenges(new.user_id);
  return new;
end;
$$;

drop trigger if exists reward_queue_contribution_after_insert on public.queue_reports;
create trigger reward_queue_contribution_after_insert
  after insert on public.queue_reports
  for each row execute function public.reward_queue_contribution();

drop trigger if exists reward_wash_type_after_insert on public.wash_type_reports;
create trigger reward_wash_type_after_insert
  after insert on public.wash_type_reports
  for each row execute function public.reward_wash_type_contribution();

-- Backfill challenge progress for contributors who already have history. Base contribution points begin from this release.
do $$
declare u record;
begin
  for u in
    select distinct user_id from (
      select user_id from public.queue_reports where user_id is not null
      union
      select user_id from public.wash_type_reports where user_id is not null
    ) contributors
  loop
    perform public.refresh_user_challenges(u.user_id);
  end loop;
end;
$$;
