-- The analytics-events Edge Function writes through the Supabase service role.
-- analytics_events was originally created without INSERT granted to service_role,
-- so requests were accepted/logged but telemetry rows could not persist.

grant insert on table public.analytics_events to service_role;
