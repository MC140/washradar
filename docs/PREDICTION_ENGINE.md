# Prediction engine V2

The V1 cold-start forecast remains the safe fallback. Weather adds a bounded factor only when a nearby observation is recent. Predictions stay marked not live, have no report timestamp, and never create contributions.

## Weather
The Cloudflare Pages Function /api/prediction-weather queries a fixed GTA bounding box from Environment and Climate Change Canada MSC GeoMet SWOB real-time observations. No visitor coordinates are transmitted to ECCC. It caches normalized station observations for 30 minutes per Cloudflare cache location; failed/empty responses are cached for five minutes. Browsers also cache in memory and fetch asynchronously while browsing. A nearest station within 35 km and a measurement no older than two hours are required; otherwise V1 remains unchanged. Rain/snow proxies use observed precipitation and temperature; road salt and snowfall are not directly measured. No weather subscription, paid routing, or new weather database is required. These factors are uncalibrated assumptions.

## Historical learning
Use existing historical_queue_stats and existing directory RPCs. A private trigger rebuilds only the changed wash's hourly local-day buckets from eligible genuine nearby/session queue reports, excluding disabled and remote reports. Each actor/day/hour is averaged first. At least three distinct actors and three distinct dates are required before a bucket is usable. Moderation and deletions recalculate aggregates. Existing current-hour historical statistics and genuine fresh reports outrank cold-start predictions. Data is all-time, not season- or weather-conditioned yet. No new public API or table. This is deliberately conservative until more contributions arrive.

## Deployment
Apply the checked-in Supabase migration (if not already applied) and deploy the frontend via the existing Cloudflare Pages workflow. Verify the weather endpoint returns nonempty fresh observations or safely falls back; no fabricated weather. Check CI and production audit. Production audit had a preexisting responsive-layout failure after V1; investigate separately.
