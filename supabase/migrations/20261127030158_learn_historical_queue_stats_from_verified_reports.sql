-- Learn only from existing genuine nearby/verified queue reports.
-- Keep the current directory RPC contract and existing aggregate table.
-- A bucket is published only with at least 3 contributors and 3 distinct days.
-- Private trigger functions are not callable by browser roles.
create or replace function private.rebuild_historical_queue_for_wash(p_wash_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_wash_id is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_wash_id::text, 5821));
  delete from public.historical_queue_stats where wash_id = p_wash_id;
  if not exists(select 1 from public.car_washes where id = p_wash_id and active and data_environment = 'production') then return; end if;
  with eligible as (
    select actor_hash, created_at, timezone('America/Toronto', created_at) as local_at,
      coalesce(observed_wait_minutes, estimated_wait_minutes)::numeric as wait_minutes
    from public.queue_reports
    where wash_id = p_wash_id and not disabled and proximity in ('nearby','session')
      and report_kind in ('queue','session')
      and coalesce(observed_wait_minutes, estimated_wait_minutes) between 0 and 90
      and actor_hash is not null and actor_hash <> ''
  ), daily_actor as (
    select actor_hash, local_at::date as local_day,
      extract(dow from local_at)::smallint as weekday,
      extract(hour from local_at)::smallint as hour_bucket,
      avg(wait_minutes) as wait_minutes, max(created_at) as last_sample_at
    from eligible group by 1,2,3,4
  )
  insert into public.historical_queue_stats(wash_id,weekday,hour_bucket,sample_count,average_wait_minutes,p50_wait_minutes,p90_wait_minutes,last_sample_at)
  select p_wash_id, weekday, hour_bucket, count(*)::integer, round(avg(wait_minutes),2),
    percentile_cont(0.5) within group(order by wait_minutes),
    percentile_cont(0.9) within group(order by wait_minutes), max(last_sample_at)
  from daily_actor group by weekday,hour_bucket
  having count(distinct actor_hash) >= 3 and count(distinct local_day) >= 3;
end;
$$;
revoke all on function private.rebuild_historical_queue_for_wash(uuid) from public, anon, authenticated;

create or replace function private.learn_historical_queue_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.proximity in ('nearby','session') then perform private.rebuild_historical_queue_for_wash(old.wash_id); end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.proximity in ('nearby','session') and old.wash_id is distinct from new.wash_id then
      perform private.rebuild_historical_queue_for_wash(old.wash_id);
    end if;
    if old.proximity in ('nearby','session') or new.proximity in ('nearby','session') then
      perform private.rebuild_historical_queue_for_wash(new.wash_id);
    end if;
  elsif new.proximity in ('nearby','session') and new.report_kind in ('queue','session') and not new.disabled then
    perform private.rebuild_historical_queue_for_wash(new.wash_id);
  end if;
  return new;
end;
$$;
revoke all on function private.learn_historical_queue_trigger() from public, anon, authenticated;
drop trigger if exists learn_historical_queue_after_change on public.queue_reports;
create trigger learn_historical_queue_after_change
after insert or delete or update of wash_id, actor_hash, report_kind, proximity, observed_wait_minutes, estimated_wait_minutes, disabled, created_at
on public.queue_reports for each row execute function private.learn_historical_queue_trigger();

-- Initial backfill is restricted to locations with genuine qualifying reports.
do $$ declare item record; begin
  for item in select distinct wash_id from public.queue_reports
    where not disabled and proximity in ('nearby','session') and report_kind in ('queue','session')
  loop perform private.rebuild_historical_queue_for_wash(item.wash_id); end loop;
end $$;
;
