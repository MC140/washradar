-- Structured WashRadar ratings: no free-text review surface.
-- One rating per authenticated/anonymous Supabase contributor per wash.

create table if not exists public.wash_ratings (
  id uuid primary key default gen_random_uuid(),
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  overall_rating smallint not null check (overall_rating between 1 and 5),
  quality_rating smallint check (quality_rating is null or quality_rating between 1 and 5),
  value_rating smallint check (value_rating is null or value_rating between 1 and 5),
  equipment_rating smallint check (equipment_rating is null or equipment_rating between 1 and 5),
  tags text[] not null default '{}',
  verified_visit boolean not null default false,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wash_ratings_one_per_user unique (wash_id, user_id),
  constraint wash_ratings_tags_allowed check (
    cardinality(tags) <= 3
    and tags <@ array[
      'clean_facility',
      'good_value',
      'strong_equipment',
      'gentle_on_paint',
      'quick_wash',
      'long_cycle'
    ]::text[]
  )
);

create index if not exists wash_ratings_wash_visible_idx
  on public.wash_ratings (wash_id, updated_at desc)
  where disabled = false;
create index if not exists wash_ratings_user_idx
  on public.wash_ratings (user_id)
  where user_id is not null;

alter table public.wash_ratings enable row level security;

-- Raw rows are intentionally not exposed. Consumers read only the aggregate RPC;
-- contributors write only through the narrow validated RPC below.
revoke all on table public.wash_ratings from anon, authenticated;
grant select, insert, update, delete on table public.wash_ratings to service_role;

create or replace function public.wash_rating_summary(p_wash_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_summary jsonb;
  v_tags jsonb := '[]'::jsonb;
  v_my_rating jsonb := null;
begin
  select jsonb_build_object(
    'rating', round(avg(r.overall_rating)::numeric, 1),
    'ratingCount', count(*)::integer,
    'quality', round(avg(r.quality_rating)::numeric, 1),
    'value', round(avg(r.value_rating)::numeric, 1),
    'equipment', round(avg(r.equipment_rating)::numeric, 1),
    'verifiedVisitCount', count(*) filter (where r.verified_visit)::integer
  )
  into v_summary
  from public.wash_ratings r
  where r.wash_id = p_wash_id
    and r.disabled = false;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('tag', ranked.tag, 'count', ranked.tag_count)
      order by ranked.tag_count desc, ranked.tag
    ),
    '[]'::jsonb
  )
  into v_tags
  from (
    select tag_item.tag, count(*)::integer as tag_count
    from public.wash_ratings r
    cross join lateral unnest(r.tags) as tag_item(tag)
    where r.wash_id = p_wash_id
      and r.disabled = false
    group by tag_item.tag
    order by count(*) desc, tag_item.tag
    limit 6
  ) ranked;

  if v_user_id is not null then
    select jsonb_build_object(
      'overall', r.overall_rating,
      'quality', r.quality_rating,
      'value', r.value_rating,
      'equipment', r.equipment_rating,
      'tags', to_jsonb(r.tags),
      'verifiedVisit', r.verified_visit,
      'updatedAt', r.updated_at
    )
    into v_my_rating
    from public.wash_ratings r
    where r.wash_id = p_wash_id
      and r.user_id = v_user_id
      and r.disabled = false
    limit 1;
  end if;

  return coalesce(v_summary, jsonb_build_object(
    'rating', null,
    'ratingCount', 0,
    'quality', null,
    'value', null,
    'equipment', null,
    'verifiedVisitCount', 0
  )) || jsonb_build_object('tags', v_tags, 'myRating', v_my_rating);
end;
$$;

create or replace function public.submit_wash_rating(
  p_wash_id uuid,
  p_overall smallint,
  p_quality smallint default null,
  p_value smallint default null,
  p_equipment smallint default null,
  p_tags text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tags text[] := '{}';
  v_verified_visit boolean := false;
begin
  if v_user_id is null then
    raise exception 'A contributor session is required to rate a wash.';
  end if;

  if p_overall is null or p_overall not between 1 and 5
     or (p_quality is not null and p_quality not between 1 and 5)
     or (p_value is not null and p_value not between 1 and 5)
     or (p_equipment is not null and p_equipment not between 1 and 5) then
    raise exception 'Ratings must be between 1 and 5.';
  end if;

  select coalesce(array_agg(distinct tag_item.tag order by tag_item.tag), '{}'::text[])
  into v_tags
  from unnest(coalesce(p_tags, '{}'::text[])) as tag_item(tag);

  if cardinality(v_tags) > 3
     or exists (
       select 1
       from unnest(v_tags) as tag_item(tag)
       where tag_item.tag <> all(array[
         'clean_facility',
         'good_value',
         'strong_equipment',
         'gentle_on_paint',
         'quick_wash',
         'long_cycle'
       ]::text[])
     ) then
    raise exception 'Choose up to three supported rating tags.';
  end if;

  if not exists (
    select 1
    from public.car_washes w
    where w.id = p_wash_id
      and w.active = true
      and w.data_environment = 'production'::public.data_environment
  ) then
    raise exception 'That wash is not available for ratings.';
  end if;

  -- A contributor cannot self-assert a verified visit. It is derived from WashRadar's
  -- existing nearby queue evidence or a physically verified wait-timer session.
  select (
    exists (
      select 1
      from public.queue_reports qr
      where qr.user_id = v_user_id
        and qr.wash_id = p_wash_id
        and qr.disabled = false
        and qr.proximity in ('nearby'::public.proximity_level, 'session'::public.proximity_level)
    )
    or exists (
      select 1
      from public.queue_sessions qs
      where qs.user_id = v_user_id
        and qs.wash_id = p_wash_id
        and qs.start_proximity = 'nearby'::public.proximity_level
        and qs.status in ('active', 'completed')
    )
  ) into v_verified_visit;

  insert into public.wash_ratings (
    wash_id,
    user_id,
    overall_rating,
    quality_rating,
    value_rating,
    equipment_rating,
    tags,
    verified_visit
  ) values (
    p_wash_id,
    v_user_id,
    p_overall,
    p_quality,
    p_value,
    p_equipment,
    v_tags,
    v_verified_visit
  )
  on conflict (wash_id, user_id) do update set
    overall_rating = excluded.overall_rating,
    quality_rating = excluded.quality_rating,
    value_rating = excluded.value_rating,
    equipment_rating = excluded.equipment_rating,
    tags = excluded.tags,
    verified_visit = public.wash_ratings.verified_visit or excluded.verified_visit,
    updated_at = now();

  return public.wash_rating_summary(p_wash_id);
end;
$$;

revoke execute on function public.wash_rating_summary(uuid) from public, anon, authenticated;
grant execute on function public.wash_rating_summary(uuid) to anon, authenticated;

revoke execute on function public.submit_wash_rating(uuid, smallint, smallint, smallint, smallint, text[]) from public, anon, authenticated;
grant execute on function public.submit_wash_rating(uuid, smallint, smallint, smallint, smallint, text[]) to authenticated;

comment on table public.wash_ratings is 'Structured WashRadar ratings; no free-text reviews.';
comment on function public.wash_rating_summary(uuid) is 'Returns public aggregate WashRadar rating data plus the caller''s own rating when authenticated.';
comment on function public.submit_wash_rating(uuid, smallint, smallint, smallint, smallint, text[]) is 'Validated structured rating upsert; verified_visit is derived server-side from WashRadar evidence.';

-- Keep guest -> permanent account continuity. If the permanent account already rated
-- the same wash, its rating wins; verified-visit evidence is still preserved.
create or replace function public.claim_anonymous_contributions(p_claim_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_user_id uuid := auth.uid();
  v_target_is_anonymous boolean;
  v_source_user_id uuid;
  v_queue_reports integer := 0;
  v_wash_type_reports integer := 0;
  v_queue_sessions integer := 0;
  v_wash_ratings integer := 0;
  v_source_rep public.contributor_reputation%rowtype;
begin
  if v_target_user_id is null then raise exception 'A permanent account session is required.'; end if;
  select is_anonymous into v_target_is_anonymous from auth.users where id = v_target_user_id;
  if coalesce(v_target_is_anonymous, true) then raise exception 'Finish signing in before claiming contributor history.'; end if;

  select source_user_id into v_source_user_id
  from public.auth_merge_claims
  where token = p_claim_token and claimed_at is null and expires_at >= now()
  for update;
  if v_source_user_id is null then raise exception 'This contributor-history claim is invalid or expired.'; end if;

  if v_source_user_id = v_target_user_id then
    update public.auth_merge_claims set target_user_id = v_target_user_id, claimed_at = now() where token = p_claim_token;
    return jsonb_build_object('queueReports', 0, 'washTypeReports', 0, 'queueSessions', 0, 'washRatings', 0);
  end if;

  update public.queue_sessions
  set status = 'cancelled', ended_at = coalesce(ended_at, now()), updated_at = now()
  where user_id = v_source_user_id and status = 'active';

  update public.queue_reports set user_id = v_target_user_id, updated_at = now() where user_id = v_source_user_id;
  get diagnostics v_queue_reports = row_count;
  update public.wash_type_reports set user_id = v_target_user_id, updated_at = now() where user_id = v_source_user_id;
  get diagnostics v_wash_type_reports = row_count;
  update public.queue_sessions set user_id = v_target_user_id, updated_at = now() where user_id = v_source_user_id;
  get diagnostics v_queue_sessions = row_count;

  select count(*)::integer into v_wash_ratings
  from public.wash_ratings
  where user_id = v_source_user_id;

  insert into public.wash_ratings as target (
    wash_id,
    user_id,
    overall_rating,
    quality_rating,
    value_rating,
    equipment_rating,
    tags,
    verified_visit,
    disabled,
    created_at,
    updated_at
  )
  select
    source.wash_id,
    v_target_user_id,
    source.overall_rating,
    source.quality_rating,
    source.value_rating,
    source.equipment_rating,
    source.tags,
    source.verified_visit,
    source.disabled,
    source.created_at,
    source.updated_at
  from public.wash_ratings source
  where source.user_id = v_source_user_id
  on conflict (wash_id, user_id) do update set
    verified_visit = target.verified_visit or excluded.verified_visit,
    updated_at = greatest(target.updated_at, excluded.updated_at);

  delete from public.wash_ratings where user_id = v_source_user_id;

  select * into v_source_rep from public.contributor_reputation where user_id = v_source_user_id;
  if found then
    insert into public.contributor_reputation(user_id, score, reports_submitted, completed_waits, reports_confirmed, reports_flagged, streak_days, last_contribution_at)
    values (v_target_user_id, 50, v_source_rep.reports_submitted, v_source_rep.completed_waits, v_source_rep.reports_confirmed, v_source_rep.reports_flagged, v_source_rep.streak_days, v_source_rep.last_contribution_at)
    on conflict (user_id) do update set
      reports_submitted = public.contributor_reputation.reports_submitted + excluded.reports_submitted,
      completed_waits = public.contributor_reputation.completed_waits + excluded.completed_waits,
      reports_confirmed = public.contributor_reputation.reports_confirmed + excluded.reports_confirmed,
      reports_flagged = public.contributor_reputation.reports_flagged + excluded.reports_flagged,
      streak_days = greatest(public.contributor_reputation.streak_days, excluded.streak_days),
      last_contribution_at = case
        when public.contributor_reputation.last_contribution_at is null then excluded.last_contribution_at
        when excluded.last_contribution_at is null then public.contributor_reputation.last_contribution_at
        else greatest(public.contributor_reputation.last_contribution_at, excluded.last_contribution_at)
      end,
      updated_at = now();
  end if;

  delete from public.points_ledger where user_id = v_source_user_id;
  delete from public.challenge_progress where user_id = v_source_user_id;
  delete from public.contributor_reputation where user_id = v_source_user_id;
  perform public.refresh_user_challenges(v_target_user_id);

  update public.auth_merge_claims
  set target_user_id = v_target_user_id, claimed_at = now()
  where token = p_claim_token;

  return jsonb_build_object(
    'queueReports', v_queue_reports,
    'washTypeReports', v_wash_type_reports,
    'queueSessions', v_queue_sessions,
    'washRatings', v_wash_ratings
  );
end;
$$;
