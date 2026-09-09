-- Preserve legitimate anonymous contribution history when a contributor signs into an existing account.
-- Raw contribution history may move, but anonymous Radar Points and trust score never transfer.
-- This prevents disposable-account reward/reputation farming while keeping useful history attached.

create table if not exists public.auth_merge_claims (
  token uuid primary key default gen_random_uuid(),
  source_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  claimed_at timestamptz
);

create index if not exists auth_merge_claims_source_idx
  on public.auth_merge_claims(source_user_id, created_at desc);

alter table public.auth_merge_claims enable row level security;
revoke all on public.auth_merge_claims from anon, authenticated;

create or replace function public.prepare_anonymous_contribution_merge()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_anonymous boolean;
  v_token uuid := gen_random_uuid();
begin
  if v_user_id is null then
    return null;
  end if;

  select is_anonymous into v_is_anonymous
  from auth.users
  where id = v_user_id;

  if not coalesce(v_is_anonymous, false) then
    return null;
  end if;

  delete from public.auth_merge_claims
  where source_user_id = v_user_id
    and (claimed_at is not null or expires_at < now());

  insert into public.auth_merge_claims(token, source_user_id)
  values (v_token, v_user_id);

  return v_token;
end;
$$;

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
  v_source_rep public.contributor_reputation%rowtype;
begin
  if v_target_user_id is null then
    raise exception 'A permanent account session is required.';
  end if;

  select is_anonymous into v_target_is_anonymous
  from auth.users
  where id = v_target_user_id;

  if coalesce(v_target_is_anonymous, true) then
    raise exception 'Finish signing in before claiming contributor history.';
  end if;

  select source_user_id into v_source_user_id
  from public.auth_merge_claims
  where token = p_claim_token
    and claimed_at is null
    and expires_at >= now()
  for update;

  if v_source_user_id is null then
    raise exception 'This contributor-history claim is invalid or expired.';
  end if;

  if v_source_user_id = v_target_user_id then
    update public.auth_merge_claims
      set target_user_id = v_target_user_id, claimed_at = now()
      where token = p_claim_token;
    return jsonb_build_object('queueReports', 0, 'washTypeReports', 0, 'queueSessions', 0);
  end if;

  -- An active timer cannot survive an auth identity switch because its anti-abuse actor hash changes.
  -- Close it cleanly before moving historical ownership.
  update public.queue_sessions
  set status = 'cancelled', ended_at = coalesce(ended_at, now()), updated_at = now()
  where user_id = v_source_user_id and status = 'active';

  update public.queue_reports
  set user_id = v_target_user_id, updated_at = now()
  where user_id = v_source_user_id;
  get diagnostics v_queue_reports = row_count;

  update public.wash_type_reports
  set user_id = v_target_user_id, updated_at = now()
  where user_id = v_source_user_id;
  get diagnostics v_wash_type_reports = row_count;

  update public.queue_sessions
  set user_id = v_target_user_id, updated_at = now()
  where user_id = v_source_user_id;
  get diagnostics v_queue_sessions = row_count;

  -- Preserve visible contribution counters, but never import the anonymous trust score.
  -- Trust for the permanent account remains based on that account's own reputation state.
  select * into v_source_rep
  from public.contributor_reputation
  where user_id = v_source_user_id;

  if found then
    insert into public.contributor_reputation(
      user_id, score, reports_submitted, completed_waits, reports_confirmed,
      reports_flagged, streak_days, last_contribution_at
    ) values (
      v_target_user_id,
      50,
      v_source_rep.reports_submitted,
      v_source_rep.completed_waits,
      v_source_rep.reports_confirmed,
      v_source_rep.reports_flagged,
      v_source_rep.streak_days,
      v_source_rep.last_contribution_at
    )
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

  -- Anonymous points are intentionally not transferable. Combined raw history can still complete
  -- each permanent-account challenge once, through the existing idempotent challenge ledger.
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
    'queueSessions', v_queue_sessions
  );
end;
$$;

revoke all on function public.prepare_anonymous_contribution_merge() from public, anon;
revoke all on function public.claim_anonymous_contributions(uuid) from public, anon;
grant execute on function public.prepare_anonymous_contribution_merge() to authenticated;
grant execute on function public.claim_anonymous_contributions(uuid) to authenticated;
