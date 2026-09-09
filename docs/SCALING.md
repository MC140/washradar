# WashRadar scaling runbook

WashRadar stays on Supabase. The goal is to scale by configuration and capacity changes, not by emergency rewrites.

## Current production posture

- Public browsing and GTA address/postal search are static/zero-cost where possible.
- Normal browsing does not call Google Routes.
- Supabase owns dynamic state: auth, profiles, favourites, alerts, queue reports, queue estimates, challenges, Radar Points and vehicles.
- Queue refresh defaults to `poll`, not one persistent Realtime connection per browser.
- Visible tabs fetch only the current `queue_signal_feed`; hidden tabs do no queue polling.
- Full account/directory refreshes happen only when location, filters, auth or user actions require them.
- Core spatial and queue queries are indexed, including PostGIS GiST lookup and queue freshness/history indexes.

## Runtime queue modes

### Production / scale mode

```env
VITE_QUEUE_REFRESH_MODE=poll
VITE_QUEUE_POLL_MS=20000
```

Each visible browser refreshes only live queue signals every roughly 20–24 seconds. A random per-session jitter spreads requests instead of creating synchronized traffic spikes.

### Realtime mode

```env
VITE_QUEUE_REFRESH_MODE=realtime
```

Use only when the connected-user count is comfortably inside the Realtime connection budget or when testing true push behavior. The application code does not need to change to switch modes.

## Capacity upgrade order

### 1. Before a public launch

1. Configure custom SMTP for Supabase Auth. Do not use the built-in test mailer for a public launch.
2. Run the **Production scale smoke** GitHub Action at 20 concurrent users / 200 reads.
3. Confirm p95 is below 2 seconds and error rate is below 1%.
4. Confirm Supabase Database Reports show healthy CPU, memory, I/O and connection usage.

### 2. Upgrade Free -> Pro before saturation

Upgrade the organization subscription in Supabase Billing. Supabase documents subscription upgrades as taking effect immediately. The WashRadar project ref, database, API URL, publishable key and application code remain unchanged.

After upgrading:

1. Re-run the production scale smoke at 50 concurrent / 500 reads.
2. Verify auth, Explore, queue reporting, Challenges, My Cars and Saved.
3. Keep `VITE_QUEUE_REFRESH_MODE=poll` unless there is a specific reason to use Realtime.
4. Confirm backups/log retention and spend controls are configured as intended.

## Compute upgrades

A plan upgrade and a compute-size change are different operations.

- **Plan upgrade:** capacity/features change immediately and does not require a WashRadar code deployment.
- **Compute resize:** Supabase documents that changing compute size incurs a database restart/downtime. Do not wait until the database is already saturated.

To minimize impact:

1. Scale before sustained CPU/memory/connection pressure reaches the danger zone.
2. Perform compute changes during a low-traffic window.
3. Keep the static WashRadar shell/search available; users may briefly see dynamic queue data as unavailable while the DB restarts.
4. Run the production smoke immediately after the resize.
5. If WashRadar later reaches a size where near-continuous database availability is required, evaluate Supabase Read Replicas / higher-availability architecture before the next compute change.

## Operational triggers

Treat these as prompts to investigate/scale rather than absolute platform limits:

- p95 nearby-wash read latency repeatedly > 1.5 s.
- >1% dynamic API error rate over a sustained period.
- sustained database CPU > ~70% during normal traffic.
- memory pressure or swap activity begins increasing.
- database connections repeatedly approach ~70% of the available pool.
- Edge Function latency/errors rise materially.
- auth emails approach SMTP provider/rate-limit capacity.
- daily/monthly Supabase usage reaches ~70% of the current plan quota.

Scale proactively at ~70–80% utilization; do not wait for 100%.

## Manual production load smoke

GitHub Actions -> **Production scale smoke** -> Run workflow.

Safe starting points:

- routine check: 20 concurrency / 200 requests
- pre-launch: 50 concurrency / 500 requests
- after a capacity upgrade: 75 concurrency / 1000 requests

The workflow is intentionally read-only. It checks `washradar.ca` and repeatedly calls the public `nearby_washes_json` read RPC. It fails if the error rate exceeds 1% or p95 latency exceeds 2 seconds.

Do not use the smoke workflow as an uncontrolled stress test. Increase concurrency gradually while watching Supabase observability.

## Database index posture

Scale-readiness indexes include:

- `wash_locations_geo_idx` for geographic lookup
- `queue_reports_wash_fresh_idx` / `queue_reports_wash_expiry_idx` for live queue reads
- `queue_reports_user_history_idx` and `queue_reports_user_wash_idx` for challenges/profile history
- `wash_type_reports_user_history_idx` for challenge/profile history
- `points_ledger_user_category_created_idx` for daily reward caps
- favourites, alerts, business hours and wash metadata indexes already present in production

Before adding a new high-volume feature, inspect its query plan and add its indexes before launch rather than after the table becomes large.

## Deployment safety

- Schema changes are additive/backward-compatible whenever possible.
- Add columns/indexes/functions before deploying frontend code that depends on them.
- Avoid destructive migrations in the same release as UI changes.
- Keep the previous frontend deployment recoverable through Git history.
- Run CI before merge and verify the GitHub Pages build + deploy jobs after merge.
- For high-risk database changes, use a Supabase development branch/staging environment once the paid plan makes that practical.

## Incident fallback

If Supabase dynamic services are degraded:

- static site, postal/address search and basic browsing shell should remain available;
- do not silently invent queue data;
- show dynamic data as unavailable/stale;
- disable or fail closed on writes that cannot be safely recorded;
- preserve queued user intent only where idempotency is guaranteed.

The scaling objective is graceful degradation, not pretending the backend is healthy.
