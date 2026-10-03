-- Accurate, internal-only operational metrics for WashRadar HQ agents.
create or replace function public.hq_operational_snapshot()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'active_washes', (
      select count(*) from public.car_washes
      where data_environment = 'production' and active = true
    ),
    'washes_with_hours', (
      select count(distinct bh.wash_id)
      from public.business_hours bh
      join public.car_washes cw on cw.id = bh.wash_id
      where cw.data_environment = 'production' and cw.active = true
    ),
    'stale_washes_30d', (
      select count(*) from public.car_washes
      where data_environment = 'production'
        and active = true
        and (source_updated_at is null or source_updated_at < now() - interval '30 days')
    ),
    'queue_reports_24h', (
      select count(*) from public.queue_reports
      where created_at >= now() - interval '24 hours' and disabled = false
    ),
    'nearby_queue_reports_24h', (
      select count(*) from public.queue_reports
      where created_at >= now() - interval '24 hours'
        and disabled = false
        and proximity::text = 'nearby'
    ),
    'active_queue_sessions', (
      select count(*) from public.queue_sessions where status = 'active'
    ),
    'pending_moderation', (
      select count(*) from public.moderation_flags
      where status not in ('actioned','resolved','closed')
    ),
    'advertiser_businesses', (
      select count(*) from public.advertiser_businesses
    ),
    'active_campaigns', (
      select count(*) from public.ad_campaigns
      where status::text = 'active'
    ),
    'app_opens_7d', (
      select count(*) from public.analytics_events
      where created_at >= now() - interval '7 days' and event_name = 'app_opened'
    ),
    'searches_7d', (
      select count(*) from public.analytics_events
      where created_at >= now() - interval '7 days' and event_name = 'search'
    ),
    'support_views_7d', (
      select count(*) from public.analytics_events
      where created_at >= now() - interval '7 days' and event_name = 'support_viewed'
    ),
    'api_requests_today', (
      select coalesce(sum(request_count), 0) from public.api_usage_daily
      where usage_day = current_date
    ),
    'generated_at', now()
  );
$$;

revoke all on function public.hq_operational_snapshot() from public, anon, authenticated;
grant execute on function public.hq_operational_snapshot() to service_role;
