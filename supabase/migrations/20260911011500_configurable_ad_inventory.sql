-- Keep the paid-ad product flexible without turning commercial decisions into app releases.
-- The client may ask for up to 20 candidates, but each placement has a server-owned
-- max_visible limit. Explore starts at five; single-card placements start at one.

create table if not exists public.ad_inventory_settings (
  placement_id uuid primary key references public.ad_placements(id) on delete cascade,
  max_visible smallint not null default 1 check (max_visible between 1 and 20),
  updated_at timestamptz not null default now()
);

alter table public.ad_inventory_settings enable row level security;
revoke all on table public.ad_inventory_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.ad_inventory_settings to service_role;

insert into public.ad_inventory_settings (placement_id, max_visible)
select
  p.id,
  case when p.slug = 'explore_nearby_offer' then 5 else 1 end
from public.ad_placements p
on conflict (placement_id) do nothing;

create or replace function public.select_ads(
  p_placement_slug text,
  p_lat double precision,
  p_lng double precision,
  p_session_hash text,
  p_limit integer default 20,
  p_wash_id uuid default null
)
returns table(
  id uuid,
  "campaignId" uuid,
  "businessName" text,
  headline text,
  body text,
  "callToAction" text,
  "destinationUrl" text,
  disclosure text,
  "distanceKm" numeric
)
language sql
stable
security definer
set search_path = ''
as $function$
  with placement_config as (
    select p.id, coalesce(s.max_visible, 1)::integer as max_visible
    from public.ad_placements p
    left join public.ad_inventory_settings s on s.placement_id = p.id
    where p.slug = p_placement_slug
      and p.active
    limit 1
  ),
  request_point as (
    select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography as point
  ),
  eligible as (
    select
      cr.id,
      c.id as campaign_id,
      b.id as business_id,
      b.name as business_name,
      cr.headline,
      cr.body,
      cr.call_to_action,
      cr.destination_url,
      cr.disclosure,
      round((extensions.st_distance(gt.centre, rp.point) / 1000)::numeric, 1) as distance_km,
      c.priority,
      cp.weight,
      row_number() over (
        partition by b.id
        order by
          c.priority desc,
          cp.weight desc,
          md5(c.id::text || ':' || cr.id::text || ':' || p_session_hash || ':' || current_date::text),
          extensions.st_distance(gt.centre, rp.point)
      ) as business_rank
    from public.ad_campaigns c
    join public.advertiser_businesses b
      on b.id = c.advertiser_business_id
      and b.status = 'verified'
    join public.ad_creatives cr
      on cr.campaign_id = c.id
      and cr.active
    join public.ad_campaign_placements cp
      on cp.campaign_id = c.id
    join placement_config pc
      on pc.id = cp.placement_id
    join public.ad_geo_targets gt
      on gt.campaign_id = c.id
      and gt.target_kind = 'radius'
      and gt.centre is not null
      and gt.radius_km is not null
    cross join request_point rp
    where c.status = 'active'
      and now() between c.starts_at and c.ends_at
      and extensions.st_dwithin(gt.centre, rp.point, gt.radius_km * 1000)
      and (
        select count(*)
        from public.ad_impressions i
        where i.campaign_id = c.id
          and i.session_hash = p_session_hash
          and i.created_at > now() - interval '1 day'
      ) < c.frequency_cap_per_day
  ),
  one_per_business as (
    select *
    from eligible
    where business_rank = 1
  )
  select
    e.id,
    e.campaign_id,
    e.business_name,
    e.headline,
    e.body,
    e.call_to_action,
    e.destination_url,
    e.disclosure,
    e.distance_km
  from one_per_business e
  order by
    e.priority desc,
    e.weight desc,
    md5(e.campaign_id::text || ':' || e.id::text || ':' || p_session_hash || ':' || current_date::text),
    e.distance_km
  limit least(
    greatest(coalesce(p_limit, 20), 1),
    20,
    coalesce((select pc.max_visible from placement_config pc), 1)
  )
$function$;

revoke execute on function public.select_ads(text, double precision, double precision, text, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.select_ads(text, double precision, double precision, text, integer, uuid)
  to service_role;

create or replace function public.select_ad(
  p_placement_slug text,
  p_lat double precision,
  p_lng double precision,
  p_session_hash text,
  p_wash_id uuid default null
)
returns table(
  id uuid,
  "campaignId" uuid,
  "businessName" text,
  headline text,
  body text,
  "callToAction" text,
  "destinationUrl" text,
  disclosure text,
  "distanceKm" numeric
)
language sql
stable
security definer
set search_path = ''
as $function$
  select *
  from public.select_ads(
    p_placement_slug,
    p_lat,
    p_lng,
    p_session_hash,
    1,
    p_wash_id
  )
$function$;

comment on table public.ad_inventory_settings is
  'Server-owned per-placement sponsored inventory limits. Change max_visible to alter visible inventory without a client release.';
comment on function public.select_ads(text, double precision, double precision, text, integer, uuid) is
  'Returns radius-targeted sponsored businesses, one slot per advertiser, frequency-capped, and limited by server-owned placement inventory settings.';
