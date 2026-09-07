-- WashRadar production schema. Demo content intentionally lives only in the browser demo repository.
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create type public.data_environment as enum ('production', 'demo');
create type public.operating_status as enum ('open', 'closed', 'unavailable', 'unknown');
create type public.wash_type_slug as enum ('touchless', 'soft-cloth', 'automatic', 'self-serve', 'hand-wash', 'tunnel');
create type public.queue_report_kind as enum ('queue', 'session', 'normal', 'closed', 'broken', 'stalled', 'payment', 'dryer', 'other');
create type public.queue_bucket as enum ('none', '1-3', '4-7', '8-12', '12-plus');
create type public.proximity_level as enum ('nearby', 'remote', 'session');
create type public.queue_data_state as enum ('LIVE', 'RECENT REPORT', 'ESTIMATED');
create type public.campaign_status as enum ('draft', 'pending', 'approved', 'active', 'paused', 'completed', 'rejected');

create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $function$
begin
  new.updated_at = now();
  return new;
end
$function$;

create table public.regions (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.regions(id) on delete restrict,
  kind text not null check (kind in ('country', 'province', 'state', 'city', 'neighbourhood')),
  name text not null,
  code text,
  country_code char(2) not null,
  time_zone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_id, kind, name)
);

create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  provider_type text not null check (provider_type in ('operator', 'google', 'user', 'admin', 'import', 'historical')),
  website_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wash_types (
  id uuid primary key default gen_random_uuid(),
  slug public.wash_type_slug not null unique,
  label text not null,
  default_duration_minutes smallint not null check (default_duration_minutes between 1 and 90),
  default_minutes_per_car numeric(5,2) not null check (default_minutes_per_car > 0 and default_minutes_per_car <= 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.car_washes (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  normalized_name text generated always as (lower(regexp_replace(canonical_name, '[^a-z0-9]+', '', 'g'))) stored,
  operating_status public.operating_status not null default 'unknown',
  rating numeric(2,1) check (rating between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  estimated_wash_minutes smallint not null default 6 check (estimated_wash_minutes between 1 and 90),
  minutes_per_car numeric(5,2) not null default 4 check (minutes_per_car > 0 and minutes_per_car <= 60),
  amenities text[] not null default '{}',
  data_environment public.data_environment not null default 'production',
  active boolean not null default true,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index car_washes_name_idx on public.car_washes using gin (to_tsvector('simple', canonical_name));
create index car_washes_public_idx on public.car_washes (data_environment, active, operating_status);

create table public.wash_locations (
  id uuid primary key default gen_random_uuid(),
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  region_id uuid references public.regions(id) on delete set null,
  address_line text not null,
  city text not null,
  region_name text not null,
  country_name text not null,
  country_code char(2) not null default 'CA',
  postal_code text not null,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  location extensions.geography(point, 4326) generated always as (
    extensions.st_setsrid(extensions.st_makepoint(longitude::double precision, latitude::double precision), 4326)::extensions.geography
  ) stored,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wash_locations_geo_idx on public.wash_locations using gist (location);
create index wash_locations_city_postal_idx on public.wash_locations (lower(city), upper(postal_code));
create unique index wash_locations_one_primary_idx on public.wash_locations (wash_id) where is_primary;

create table public.car_wash_provider_refs (
  id uuid primary key default gen_random_uuid(),
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  provider text not null,
  provider_place_id text not null,
  metadata jsonb not null default '{}',
  last_fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_place_id)
);
create index provider_refs_wash_idx on public.car_wash_provider_refs (wash_id);

create table public.car_wash_types (
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  wash_type_id uuid not null references public.wash_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (wash_id, wash_type_id)
);

create table public.business_hours (
  id uuid primary key default gen_random_uuid(),
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time,
  closes_at time,
  closed boolean not null default false,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (closed or (opens_at is not null and closes_at is not null)),
  unique (wash_id, weekday, valid_from)
);
create index business_hours_wash_idx on public.business_hours (wash_id, weekday);

create table public.wash_packages (
  id uuid primary key default gen_random_uuid(),
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  wash_type_id uuid references public.wash_types(id) on delete set null,
  name text not null,
  description text,
  membership_available boolean not null default false,
  active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wash_id, name)
);

create table public.wash_prices (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.wash_packages(id) on delete cascade,
  amount numeric(8,2) check (amount >= 0),
  currency char(3) not null default 'CAD',
  price_type text not null default 'regular' check (price_type in ('regular', 'promotion', 'membership')),
  promotion_text text,
  source_id uuid references public.data_sources(id) on delete set null,
  source_label text,
  verified_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wash_prices_package_active_idx on public.wash_prices (package_id, active, price_type);

create table public.price_corrections (
  id uuid primary key default gen_random_uuid(),
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  package_id uuid references public.wash_packages(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  proposed_amount numeric(8,2) check (proposed_amount >= 0),
  currency char(3) not null default 'CAD',
  note text check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.queue_reports (
  id uuid primary key default gen_random_uuid(),
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  actor_hash text not null check (char_length(actor_hash) between 32 and 128),
  report_kind public.queue_report_kind not null,
  queue_bucket public.queue_bucket,
  estimated_wait_minutes smallint check (estimated_wait_minutes between 0 and 90),
  observed_wait_minutes smallint check (observed_wait_minutes between 0 and 90),
  proximity public.proximity_level not null,
  confidence_weight numeric(4,3) not null check (confidence_weight between 0 and 2),
  reputation_snapshot smallint not null default 50 check (reputation_snapshot between 0 and 100),
  disabled boolean not null default false,
  expires_at timestamptz not null,
  report_minute bigint not null default (extract(epoch from now())::bigint / 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (report_kind in ('queue', 'session') and coalesce(estimated_wait_minutes, observed_wait_minutes) is not null)
    or report_kind not in ('queue', 'session')
  )
);
create index queue_reports_wash_fresh_idx on public.queue_reports (wash_id, created_at desc) where disabled = false;
create index queue_reports_actor_rate_idx on public.queue_reports (actor_hash, created_at desc);
create unique index queue_reports_actor_minute_idx on public.queue_reports (actor_hash, report_minute) where disabled = false and report_kind <> 'session';

create table public.queue_sessions (
  id uuid primary key default gen_random_uuid(),
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  actor_hash text not null check (char_length(actor_hash) between 32 and 128),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled', 'expired')),
  start_proximity public.proximity_level not null,
  end_proximity public.proximity_level,
  initial_queue_bucket public.queue_bucket,
  observed_wait_minutes smallint check (observed_wait_minutes between 0 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index queue_sessions_one_active_actor_idx on public.queue_sessions (actor_hash) where status = 'active';
create index queue_sessions_wash_time_idx on public.queue_sessions (wash_id, started_at desc);

create table public.queue_estimates (
  wash_id uuid primary key references public.car_washes(id) on delete cascade,
  wait_minutes smallint not null check (wait_minutes between 0 and 90),
  confidence_score smallint not null check (confidence_score between 0 and 100),
  confidence_label text not null check (confidence_label in ('High', 'Medium', 'Low', 'Limited Data', 'Historical Estimate')),
  data_state public.queue_data_state not null,
  operating_status public.operating_status not null,
  estimated_cars smallint check (estimated_cars >= 0),
  recent_signal_count smallint not null default 0 check (recent_signal_count >= 0),
  last_signal_at timestamptz,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.historical_queue_stats (
  id uuid primary key default gen_random_uuid(),
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  hour_bucket smallint not null check (hour_bucket between 0 and 23),
  sample_count integer not null default 0 check (sample_count >= 0),
  average_wait_minutes numeric(5,2) not null default 0 check (average_wait_minutes between 0 and 90),
  p50_wait_minutes numeric(5,2) check (p50_wait_minutes between 0 and 90),
  p90_wait_minutes numeric(5,2) check (p90_wait_minutes between 0 and 90),
  last_sample_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wash_id, weekday, hour_bucket)
);

create table public.weather_observations (
  id uuid primary key default gen_random_uuid(),
  region_id uuid references public.regions(id) on delete cascade,
  observed_at timestamptz not null,
  temperature_c numeric(5,2),
  precipitation_mm numeric(7,2),
  snowfall_24h_cm numeric(7,2),
  snowfall_48h_cm numeric(7,2),
  forecast_precipitation_24h_mm numeric(7,2),
  road_salt_index numeric(4,2),
  source text not null,
  created_at timestamptz not null default now(),
  unique (region_id, observed_at, source)
);
create index weather_region_time_idx on public.weather_observations (region_id, observed_at desc);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_wash_types public.wash_type_slug[] not null default '{}',
  maximum_price numeric(8,2),
  maximum_distance_km numeric(6,2),
  notifications_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.favourites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, wash_id)
);
create index favourites_user_idx on public.favourites (user_id, created_at desc);
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  threshold_minutes smallint not null check (threshold_minutes between 0 and 60),
  enabled boolean not null default true,
  triggered_at timestamptz,
  last_evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, wash_id, threshold_minutes)
);
create index alerts_evaluation_idx on public.alerts (enabled, wash_id) where enabled = true;
create table public.contributor_reputation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  score smallint not null default 50 check (score between 0 and 100),
  reports_submitted integer not null default 0 check (reports_submitted >= 0),
  completed_waits integer not null default 0 check (completed_waits >= 0),
  reports_confirmed integer not null default 0 check (reports_confirmed >= 0),
  reports_flagged integer not null default 0 check (reports_flagged >= 0),
  streak_days integer not null default 0 check (streak_days >= 0),
  last_contribution_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  alert_id uuid references public.alerts(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'web_push', 'email')),
  status text not null check (status in ('pending', 'sent', 'failed', 'read')),
  payload jsonb not null default '{}',
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  session_hash text,
  event_name text not null check (char_length(event_name) between 2 and 80),
  coarse_region text,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index analytics_event_time_idx on public.analytics_events (event_name, created_at desc);

create table public.advertiser_businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null,
  business_type text not null,
  website_url text,
  address_line text,
  city text,
  country_code char(2) not null default 'CA',
  status text not null default 'pending' check (status in ('pending', 'verified', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.ad_placements (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_business_id uuid not null references public.advertiser_businesses(id) on delete cascade,
  name text not null,
  status public.campaign_status not null default 'draft',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  priority smallint not null default 50 check (priority between 0 and 100),
  frequency_cap_per_day smallint not null default 3 check (frequency_cap_per_day between 1 and 50),
  budget_cad numeric(10,2) check (budget_cad >= 0),
  pricing_model text check (pricing_model in ('weekly', 'monthly', 'impression', 'flat')),
  booked_price_cad numeric(10,2) check (booked_price_cad >= 0),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index campaigns_delivery_idx on public.ad_campaigns (status, starts_at, ends_at, priority desc);
create table public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  headline text not null check (char_length(headline) between 2 and 80),
  body text not null check (char_length(body) between 2 and 180),
  call_to_action text not null check (char_length(call_to_action) between 2 and 30),
  destination_url text not null,
  image_path text,
  disclosure text not null default 'Sponsored' check (disclosure in ('Sponsored', 'Nearby offer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.ad_campaign_placements (
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  placement_id uuid not null references public.ad_placements(id) on delete cascade,
  weight smallint not null default 100 check (weight between 1 and 1000),
  created_at timestamptz not null default now(),
  primary key (campaign_id, placement_id)
);
create table public.ad_geo_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  target_kind text not null check (target_kind in ('radius', 'city', 'neighbourhood', 'region')),
  centre extensions.geography(point, 4326),
  radius_km numeric(7,2) check (radius_km > 0 and radius_km <= 500),
  region_id uuid references public.regions(id) on delete cascade,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (target_kind = 'radius' and centre is not null and radius_km is not null)
    or (target_kind = 'region' and region_id is not null)
    or (target_kind in ('city', 'neighbourhood') and city is not null)
  )
);
create index ad_geo_targets_geo_idx on public.ad_geo_targets using gist (centre);
create table public.ad_impressions (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  creative_id uuid not null references public.ad_creatives(id) on delete cascade,
  placement_id uuid not null references public.ad_placements(id) on delete restrict,
  session_hash text not null,
  coarse_region text,
  wash_id uuid references public.car_washes(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ad_impressions_cap_idx on public.ad_impressions (session_hash, campaign_id, created_at desc);
create index ad_impressions_campaign_time_idx on public.ad_impressions (campaign_id, created_at desc);
create table public.ad_clicks (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  creative_id uuid not null references public.ad_creatives(id) on delete cascade,
  placement_id uuid not null references public.ad_placements(id) on delete restrict,
  session_hash text not null,
  impression_id bigint references public.ad_impressions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index ad_clicks_campaign_time_idx on public.ad_clicks (campaign_id, created_at desc);

create table public.moderation_flags (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('queue_report', 'price_correction', 'wash', 'contributor', 'campaign')),
  entity_id text not null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index moderation_open_idx on public.moderation_flags (status, created_at desc);

create table private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.route_cache (
  origin_cell text not null,
  wash_id uuid not null references public.car_washes(id) on delete cascade,
  drive_minutes smallint not null check (drive_minutes between 1 and 240),
  distance_metres integer not null check (distance_metres >= 0),
  provider text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (origin_cell, wash_id)
);
create table public.geocode_cache (
  query_hash text primary key,
  query_normalized text not null,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  provider text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.api_usage_daily (
  provider text not null,
  usage_day date not null default current_date,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (provider, usage_day)
);
create table public.api_request_log (
  id bigint generated always as identity primary key,
  provider text not null,
  actor_hash text not null,
  created_at timestamptz not null default now()
);
create index api_request_log_rate_idx on public.api_request_log (provider, actor_hash, created_at desc);

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $function$
  select exists (select 1 from private.admin_users where user_id = (select auth.uid()))
$function$;

create or replace function private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.profiles(id) values (new.id) on conflict do nothing;
  insert into public.contributor_reputation(user_id) values (new.id) on conflict do nothing;
  return new;
end
$function$;
create trigger auth_user_profile after insert on auth.users for each row execute function private.create_profile();

do $block$
declare item text;
begin
  foreach item in array array[
    'regions','data_sources','wash_types','car_washes','wash_locations','car_wash_provider_refs','car_wash_types',
    'business_hours','wash_packages','wash_prices','price_corrections','queue_reports','queue_sessions','queue_estimates',
    'historical_queue_stats','weather_observations','profiles','user_preferences','favourites','alerts',
    'contributor_reputation','notification_events','analytics_events','advertiser_businesses','ad_placements',
    'ad_campaigns','ad_creatives','ad_campaign_placements','ad_geo_targets','ad_impressions','ad_clicks','moderation_flags',
    'route_cache','geocode_cache','api_usage_daily','api_request_log'
  ] loop
    execute format('alter table public.%I enable row level security', item);
    execute format('revoke all on public.%I from anon, authenticated', item);
  end loop;
end
$block$;

create policy regions_public_read on public.regions for select to anon, authenticated using (true);
create policy sources_public_read on public.data_sources for select to anon, authenticated using (true);
create policy wash_types_public_read on public.wash_types for select to anon, authenticated using (active);
create policy washes_public_read on public.car_washes for select to anon, authenticated using (active and data_environment = 'production');
create policy locations_public_read on public.wash_locations for select to anon, authenticated using (
  exists (select 1 from public.car_washes w where w.id = wash_id and w.active and w.data_environment = 'production')
);
create policy wash_type_links_public_read on public.car_wash_types for select to anon, authenticated using (
  exists (select 1 from public.car_washes w where w.id = wash_id and w.active and w.data_environment = 'production')
);
create policy hours_public_read on public.business_hours for select to anon, authenticated using (
  exists (select 1 from public.car_washes w where w.id = wash_id and w.active and w.data_environment = 'production')
);
create policy packages_public_read on public.wash_packages for select to anon, authenticated using (
  active and exists (select 1 from public.car_washes w where w.id = wash_id and w.active and w.data_environment = 'production')
);
create policy prices_public_read on public.wash_prices for select to anon, authenticated using (
  active and (valid_from is null or valid_from <= now()) and (valid_until is null or valid_until > now())
  and exists (
    select 1 from public.wash_packages p join public.car_washes w on w.id = p.wash_id
    where p.id = package_id and p.active and w.active and w.data_environment = 'production'
  )
);
create policy estimates_public_read on public.queue_estimates for select to anon, authenticated using (
  exists (select 1 from public.car_washes w where w.id = wash_id and w.active and w.data_environment = 'production')
);
create policy profile_owner_all on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy preferences_owner_all on public.user_preferences for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy favourites_owner_all on public.favourites for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy alerts_owner_all on public.alerts for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_owner_read on public.notification_events for select to authenticated using (user_id = (select auth.uid()));
create policy reputation_owner_read on public.contributor_reputation for select to authenticated using (user_id = (select auth.uid()));
create policy advertiser_owner_read on public.advertiser_businesses for select to authenticated using (owner_user_id = (select auth.uid()));
create policy campaign_owner_read on public.ad_campaigns for select to authenticated using (
  exists (select 1 from public.advertiser_businesses b where b.id = advertiser_business_id and b.owner_user_id = (select auth.uid()))
);
create policy creative_owner_read on public.ad_creatives for select to authenticated using (
  exists (
    select 1 from public.ad_campaigns c join public.advertiser_businesses b on b.id = c.advertiser_business_id
    where c.id = campaign_id and b.owner_user_id = (select auth.uid())
  )
);
create policy price_corrections_owner_read on public.price_corrections for select to authenticated using (user_id = (select auth.uid()));
create policy price_corrections_owner_insert on public.price_corrections for insert to authenticated with check (user_id = (select auth.uid()) and status = 'pending');

grant select on public.regions, public.data_sources, public.wash_types, public.car_washes, public.wash_locations,
  public.car_wash_types, public.business_hours, public.wash_packages, public.wash_prices, public.queue_estimates
  to anon, authenticated;
grant select, insert, update, delete on public.profiles, public.user_preferences, public.favourites, public.alerts to authenticated;
grant select on public.notification_events, public.contributor_reputation, public.advertiser_businesses, public.ad_campaigns, public.ad_creatives to authenticated;
grant select, insert on public.price_corrections to authenticated;

create or replace function public.consume_api_quota(p_provider text, p_daily_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $function$
declare current_count integer;
begin
  if p_daily_limit < 1 or p_daily_limit > 100000 then return false; end if;
  insert into public.api_usage_daily(provider, usage_day, request_count)
  values (p_provider, current_date, 1)
  on conflict (provider, usage_day) do update
    set request_count = public.api_usage_daily.request_count + 1, updated_at = now()
  returning request_count into current_count;
  return current_count <= p_daily_limit;
end
$function$;

create or replace function public.nearby_washes(p_lat double precision, p_lng double precision, p_radius_km double precision default 25)
returns table (
  id uuid, name text, address_line text, city text, region_name text, country_name text, postal_code text,
  latitude numeric, longitude numeric, operating_status public.operating_status, rating numeric, rating_count integer,
  estimated_wash_minutes smallint, minutes_per_car numeric, historical_wait_minutes integer,
  historical_sample_count integer, source_updated_at timestamptz, wash_types public.wash_type_slug[],
  packages jsonb, hours jsonb, amenities text[]
)
language sql stable security definer set search_path = '' as $function$
  select
    w.id, w.canonical_name, l.address_line, l.city, l.region_name, l.country_name, l.postal_code,
    l.latitude, l.longitude, w.operating_status, w.rating, w.rating_count, w.estimated_wash_minutes, w.minutes_per_car,
    coalesce(h.average_wait_minutes::integer, 0), coalesce(h.sample_count, 0), w.source_updated_at,
    coalesce(types.items, '{}'), coalesce(packages.items, '[]'::jsonb), coalesce(hours.items, '[]'::jsonb), w.amenities
  from public.car_washes w
  join public.wash_locations l on l.wash_id = w.id and l.is_primary
  left join public.historical_queue_stats h on h.wash_id = w.id
    and h.weekday = extract(dow from now())::smallint and h.hour_bucket = extract(hour from now())::smallint
  left join lateral (
    select array_agg(t.slug order by t.label) as items
    from public.car_wash_types wt join public.wash_types t on t.id = wt.wash_type_id
    where wt.wash_id = w.id and t.active
  ) types on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'washType', t.slug, 'price', pr.amount, 'currency', pr.currency,
      'membershipAvailable', p.membership_available, 'promotion', pr.promotion_text,
      'verifiedAt', pr.verified_at, 'sourceLabel', pr.source_label
    ) order by p.sort_order) as items
    from public.wash_packages p
    left join public.wash_types t on t.id = p.wash_type_id
    left join lateral (
      select value.* from public.wash_prices value
      where value.package_id = p.id and value.active
        and (value.valid_from is null or value.valid_from <= now())
        and (value.valid_until is null or value.valid_until > now())
      order by case value.price_type when 'promotion' then 0 else 1 end, value.verified_at desc nulls last limit 1
    ) pr on true
    where p.wash_id = w.id and p.active
  ) packages on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('weekday', bh.weekday, 'opensAt', bh.opens_at, 'closesAt', bh.closes_at, 'closed', bh.closed) order by bh.weekday) as items
    from public.business_hours bh where bh.wash_id = w.id
  ) hours on true
  where w.active and w.data_environment = 'production'
    and extensions.st_dwithin(
      l.location,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
      least(greatest(p_radius_km, 1), 100) * 1000
    )
  order by extensions.st_distance(l.location, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography)
  limit 100
$function$;

create or replace function public.queue_signal_feed(p_wash_ids uuid[])
returns table (
  "id" uuid, "washId" uuid, "actorHash" text, "kind" public.queue_report_kind,
  "waitMinutes" smallint, "queueBucket" public.queue_bucket, "verification" public.proximity_level,
  "createdAt" timestamptz, "reputation" smallint, "disabled" boolean
)
language sql stable security definer set search_path = '' as $function$
  select r.id, r.wash_id,
    encode(extensions.digest(r.actor_hash || ':' || r.wash_id::text, 'sha256'), 'hex'),
    r.report_kind, coalesce(r.observed_wait_minutes, r.estimated_wait_minutes), r.queue_bucket,
    r.proximity, r.created_at, r.reputation_snapshot, false
  from public.queue_reports r
  join public.car_washes w on w.id = r.wash_id
  where cardinality(p_wash_ids) between 1 and 100
    and r.wash_id = any(p_wash_ids)
    and not r.disabled and r.expires_at > now()
    and w.active and w.data_environment = 'production'
  order by r.created_at desc
  limit 500
$function$;

create or replace function public.my_contribution_metrics()
returns table (reports_submitted integer, completed_waits integer, reputation smallint, streak_days integer)
language sql stable security invoker set search_path = '' as $function$
  select r.reports_submitted, r.completed_waits, r.score, r.streak_days
  from public.contributor_reputation r where r.user_id = (select auth.uid())
$function$;

create or replace function public.select_ad(
  p_placement_slug text, p_lat double precision, p_lng double precision, p_session_hash text, p_wash_id uuid default null
) returns table (
  "id" uuid, "campaignId" uuid, "businessName" text, "headline" text, "body" text,
  "callToAction" text, "destinationUrl" text, "disclosure" text, "distanceKm" numeric
)
language sql stable security definer set search_path = '' as $function$
  with eligible as (
    select cr.id, c.id campaign_id, b.name business_name, cr.headline, cr.body, cr.call_to_action,
      cr.destination_url, cr.disclosure,
      case when gt.centre is null then null else
        round((extensions.st_distance(gt.centre, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography) / 1000)::numeric, 1)
      end distance_km,
      c.priority, cp.weight
    from public.ad_campaigns c
    join public.advertiser_businesses b on b.id = c.advertiser_business_id and b.status = 'verified'
    join public.ad_creatives cr on cr.campaign_id = c.id and cr.active
    join public.ad_campaign_placements cp on cp.campaign_id = c.id
    join public.ad_placements p on p.id = cp.placement_id and p.active and p.slug = p_placement_slug
    join public.ad_geo_targets gt on gt.campaign_id = c.id
    where c.status = 'active' and now() between c.starts_at and c.ends_at
      and (
        (gt.target_kind = 'radius' and extensions.st_dwithin(gt.centre, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography, gt.radius_km * 1000))
        or (gt.target_kind <> 'radius')
      )
      and (select count(*) from public.ad_impressions i where i.campaign_id = c.id and i.session_hash = p_session_hash and i.created_at > now() - interval '1 day') < c.frequency_cap_per_day
  )
  select e.id, e.campaign_id, e.business_name, e.headline, e.body, e.call_to_action, e.destination_url, e.disclosure, e.distance_km
  from eligible e
  order by e.priority desc, e.weight desc, md5(e.id::text || p_session_hash || current_date::text)
  limit 1
$function$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.nearby_washes(double precision, double precision, double precision) to anon, authenticated;
grant execute on function public.queue_signal_feed(uuid[]) to anon, authenticated;
grant execute on function public.my_contribution_metrics() to authenticated;
grant execute on function public.select_ad(text, double precision, double precision, text, uuid) to anon, authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function public.consume_api_quota(text, integer) to service_role;

insert into public.wash_types(slug, label, default_duration_minutes, default_minutes_per_car) values
  ('touchless', 'Touchless', 6, 4.5),
  ('soft-cloth', 'Soft cloth', 5, 3.5),
  ('automatic', 'Automatic', 6, 4),
  ('self-serve', 'Self serve', 12, 3),
  ('hand-wash', 'Hand wash', 25, 18),
  ('tunnel', 'Tunnel / express', 4, 1.5)
on conflict (slug) do update set label = excluded.label, default_duration_minutes = excluded.default_duration_minutes, default_minutes_per_car = excluded.default_minutes_per_car;

insert into public.ad_placements(slug, name, description) values
  ('explore_nearby_offer', 'Explore nearby offer', 'Tasteful offer between the recommendation and results'),
  ('wash_detail_nearby_offer', 'Wash detail nearby offer', 'Contextual offer near wash details'),
  ('queue_wait_offer', 'Queue wait offer', 'Optional offer shown while a queue timer is active'),
  ('post_wash_offer', 'Post-wash offer', 'Offer after a completed queue session'),
  ('sponsored_wash', 'Sponsored wash', 'Clearly-labelled enhanced wash placement')
on conflict (slug) do update set name = excluded.name, description = excluded.description;

do $block$
declare item text;
begin
  foreach item in array array[
    'regions','data_sources','wash_types','car_washes','wash_locations','car_wash_provider_refs','business_hours',
    'wash_packages','wash_prices','price_corrections','queue_reports','queue_sessions','queue_estimates',
    'historical_queue_stats','profiles','user_preferences','favourites','alerts','contributor_reputation',
    'notification_events','advertiser_businesses','ad_placements','ad_campaigns','ad_creatives','ad_geo_targets',
    'moderation_flags','api_usage_daily'
  ] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = item and column_name = 'updated_at') then
      execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', item || '_updated_at', item);
    end if;
  end loop;
end
$block$;

do $block$
begin
  alter publication supabase_realtime add table public.queue_estimates;
exception when duplicate_object then null;
end
$block$;
