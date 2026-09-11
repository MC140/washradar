-- Local paid-ad inventory for WashRadar.
-- v1 paid targeting is deliberately radius-only. City/neighbourhood/region rows remain
-- available for future work but are not eligible until their matching rules are explicit.

create index if not exists ad_geo_targets_radius_centre_idx
  on public.ad_geo_targets using gist (centre)
  where target_kind = 'radius';

create index if not exists ad_impressions_campaign_session_created_idx
  on public.ad_impressions (campaign_id, session_hash, created_at desc);

create or replace function public.select_ads(
  p_placement_slug text,
  p_lat double precision,
  p_lng double precision,
  p_session_hash text,
  p_limit integer default 5,
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
  with request_point as (
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
    join public.ad_placements p
      on p.id = cp.placement_id
      and p.active
      and p.slug = p_placement_slug
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
  limit least(greatest(coalesce(p_limit, 5), 1), 5)
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
  with request_point as (
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
        order by c.priority desc, cp.weight desc,
          md5(c.id::text || ':' || cr.id::text || ':' || p_session_hash || ':' || current_date::text)
      ) as business_rank
    from public.ad_campaigns c
    join public.advertiser_businesses b
      on b.id = c.advertiser_business_id and b.status = 'verified'
    join public.ad_creatives cr
      on cr.campaign_id = c.id and cr.active
    join public.ad_campaign_placements cp
      on cp.campaign_id = c.id
    join public.ad_placements p
      on p.id = cp.placement_id and p.active and p.slug = p_placement_slug
    join public.ad_geo_targets gt
      on gt.campaign_id = c.id
      and gt.target_kind = 'radius'
      and gt.centre is not null
      and gt.radius_km is not null
    cross join request_point rp
    where c.status = 'active'
      and now() between c.starts_at and c.ends_at
      and extensions.st_dwithin(gt.centre, rp.point, gt.radius_km * 1000)
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
  from eligible e
  where e.business_rank = 1
  order by e.priority desc, e.weight desc,
    md5(e.campaign_id::text || ':' || e.id::text || ':' || p_session_hash || ':' || current_date::text),
    e.distance_km
  limit 1
$function$;

comment on function public.select_ads(text, double precision, double precision, text, integer, uuid)
  is 'Returns up to five eligible radius-targeted sponsored businesses, one slot per advertiser, using a server-hashed session id for frequency caps.';
comment on function public.select_ad(text, double precision, double precision, text, uuid)
  is 'Legacy one-ad selector retained for cached clients; radius targets only.';
