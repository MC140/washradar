create or replace function public.wash_detail_json(p_wash_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with ctx as (
    select timezone('America/Toronto', now()) as local_now
  )
  select to_jsonb(q)
  from (
    select
      w.id,
      w.canonical_name as name,
      l.address_line,
      l.city,
      l.region_name,
      l.country_name,
      l.postal_code,
      l.latitude,
      l.longitude,
      case
        when w.google_business_status = 'CLOSED_PERMANENTLY' then 'closed'
        when w.google_business_status in ('CLOSED_TEMPORARILY', 'FUTURE_OPENING') then 'unavailable'
        when w.operating_status in ('closed', 'unavailable', 'open') then w.operating_status::text
        when not hours_state.has_hours then 'unknown'
        when hours_state.is_open then 'open'
        else 'closed'
      end as operating_status,
      w.rating,
      w.rating_count,
      w.estimated_wash_minutes,
      w.minutes_per_car,
      coalesce(h.average_wait_minutes::integer, 0) as historical_wait_minutes,
      coalesce(h.sample_count, 0) as historical_sample_count,
      w.source_updated_at,
      coalesce(types.items, '[]'::jsonb) as wash_types,
      coalesce(packages.items, '[]'::jsonb) as packages,
      coalesce(hours.items, '[]'::jsonb) as hours,
      coalesce(w.amenities, '{}'::text[]) as amenities
    from public.car_washes w
    join public.wash_locations l on l.wash_id = w.id and l.is_primary
    cross join ctx
    left join public.historical_queue_stats h on h.wash_id = w.id
      and h.weekday = extract(dow from ctx.local_now)::smallint
      and h.hour_bucket = extract(hour from ctx.local_now)::smallint
    left join lateral (
      select jsonb_agg(t.slug::text order by t.label) as items
      from public.car_wash_types wt
      join public.wash_types t on t.id = wt.wash_type_id
      where wt.wash_id = w.id and t.active
    ) types on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'washType', t.slug::text,
        'price', pr.amount,
        'currency', pr.currency,
        'membershipAvailable', p.membership_available,
        'promotion', pr.promotion_text,
        'verifiedAt', pr.verified_at,
        'sourceLabel', pr.source_label
      ) order by p.sort_order) as items
      from public.wash_packages p
      left join public.wash_types t on t.id = p.wash_type_id
      left join lateral (
        select value.*
        from public.wash_prices value
        where value.package_id = p.id and value.active
          and (value.valid_from is null or value.valid_from <= now())
          and (value.valid_until is null or value.valid_until > now())
        order by case value.price_type when 'promotion' then 0 else 1 end,
                 value.verified_at desc nulls last
        limit 1
      ) pr on true
      where p.wash_id = w.id and p.active
    ) packages on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'weekday', bh.weekday,
        'opensAt', bh.opens_at,
        'closesAt', bh.closes_at,
        'closed', bh.closed
      ) order by bh.weekday, bh.opens_at nulls first) as items
      from public.business_hours bh
      where bh.wash_id = w.id
    ) hours on true
    left join lateral (
      select
        count(*) > 0 as has_hours,
        coalesce(bool_or(
          not bh.closed
          and bh.opens_at is not null
          and bh.closes_at is not null
          and ctx.local_now::time >= bh.opens_at
          and ctx.local_now::time < bh.closes_at
        ), false) as is_open
      from public.business_hours bh
      where bh.wash_id = w.id
        and bh.weekday = extract(dow from ctx.local_now)::smallint
    ) hours_state on true
    where w.id = p_wash_id
      and w.active
      and w.data_environment = 'production'
    limit 1
  ) q;
$function$;

revoke all on function public.wash_detail_json(uuid) from public;
grant execute on function public.wash_detail_json(uuid) to anon, authenticated, service_role;

revoke execute on function public.recalculate_wash_type_confidence(uuid) from public, anon, authenticated;
grant execute on function public.recalculate_wash_type_confidence(uuid) to service_role;

grant execute on function public.my_contribution_metrics() to anon;
