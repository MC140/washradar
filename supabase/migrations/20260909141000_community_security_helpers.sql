-- Lock server-only reward machinery and expose only self-scoped helpers to clients.

revoke all on function public.award_radar_points(uuid, integer, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.refresh_user_challenges(uuid) from public, anon, authenticated;
revoke all on function public.reward_queue_contribution() from public, anon, authenticated;
revoke all on function public.reward_wash_type_contribution() from public, anon, authenticated;

grant execute on function public.award_radar_points(uuid, integer, text, text, text, text, integer) to service_role;
grant execute on function public.refresh_user_challenges(uuid) to service_role;

create or replace function public.my_radar_points()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::integer
  from public.points_ledger
  where user_id = (select auth.uid());
$$;

grant execute on function public.my_radar_points() to authenticated;

create or replace function public.refresh_my_challenges()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then return; end if;
  perform public.refresh_user_challenges((select auth.uid()));
end;
$$;

revoke all on function public.refresh_my_challenges() from public, anon;
grant execute on function public.refresh_my_challenges() to authenticated;

create or replace function public.set_primary_vehicle(p_vehicle_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.user_vehicles
    where id = p_vehicle_id and user_id = (select auth.uid())
  ) then
    raise exception 'Vehicle not found';
  end if;

  update public.user_vehicles
  set is_primary = false, updated_at = now()
  where user_id = (select auth.uid()) and is_primary;

  update public.user_vehicles
  set is_primary = true, updated_at = now()
  where id = p_vehicle_id and user_id = (select auth.uid());
end;
$$;

grant execute on function public.set_primary_vehicle(uuid) to authenticated;

create or replace function public.keep_vehicle_primary_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next uuid;
begin
  if old.is_primary then
    select id into v_next
    from public.user_vehicles
    where user_id = old.user_id
    order by created_at asc
    limit 1;

    if v_next is not null then
      update public.user_vehicles set is_primary = true, updated_at = now() where id = v_next;
    end if;
  end if;
  return old;
end;
$$;

revoke all on function public.keep_vehicle_primary_after_delete() from public, anon, authenticated;
drop trigger if exists keep_vehicle_primary_after_delete on public.user_vehicles;
create trigger keep_vehicle_primary_after_delete
after delete on public.user_vehicles
for each row execute function public.keep_vehicle_primary_after_delete();
