# WashRadar

WashRadar is a mobile-first PWA that helps drivers answer:

> **Where should I wash my car right now?**

Its differentiated value is **queue intelligence + trustworthy wash information**, not navigation. Live traffic and turn-by-turn routing belong in the user's Google Maps / Apple Maps app.

**Production:** https://washradar.ca  
**Repository:** `MC140/washradar`  
**Supabase:** `mwyomijlvjfllgeniqcz` — Canada Central

---

## READ THIS FIRST — project handoff rules

This README is the handoff for future ChatGPT/Codex/model sessions.

Before doing project work:

1. Read current `main`.
2. Check the newest merged PRs.
3. Check the latest **Deploy WashRadar to GitHub Pages** workflow.
4. For capacity work, read `docs/SCALING.md`.
5. Treat GitHub `main`, Supabase production schema and Actions as the final source of truth.

Do not restart work from an old/superseded PR just because it appears in historical notes.

---

# Current production baseline — 2026-09-09

Production includes feature work through **PR #30**.

## Latest platform release — PR #30

**PR #30 — `Prepare WashRadar for Supabase scale`** keeps Supabase as the backend while removing the largest client fan-out risk before traffic grows.

Production behavior now:

- Queue freshness defaults to **visible-tab adaptive polling**, not one Supabase Realtime socket per browser.
- A queue refresh fetches only `queue_signal_feed` for washes already on screen; it does **not** reload the directory, profile, favourites, alerts, auth and metrics every time.
- Default polling interval is ~20 seconds plus per-session jitter, which spreads requests instead of synchronizing browsers.
- Hidden tabs do no queue polling.
- Realtime remains available through `VITE_QUEUE_REFRESH_MODE=realtime` without an application rewrite.
- Additional history/freshness indexes are applied for queue reports, wash-type reports and Radar Points as tables grow.
- `.github/workflows/scale-smoke.yml` + `scripts/scale_smoke.mjs` provide a read-only production capacity smoke test.
- `docs/SCALING.md` documents Free → Pro, compute resizing, load tests, observability and incident handling.

The app should scale through **capacity/config changes**, not a backend migration.

## Recent identity / community releases

- **PR #25 — Contributor profiles, Radar Challenges and My Cars**
  - Profile v2, handles, bio, levels and activity;
  - Radar Points and server-computed challenges;
  - private My Cars garage;
  - reward security and RLS;
  - points remain separate from queue trust.
- **PR #26 — Community release handoff docs**
  - documented the contributor architecture.
- **PR #27 — Persistent shared account session + global account drawer**
  - one shared Supabase client/session across the app;
  - profile/auth identity follows Explore, Saved, Alerts, Challenges, My Cars and contributions;
  - same-device session should survive refresh/reopen until explicit sign out;
  - top-level account drawer added while retaining the full Profile page.
- **PR #28 — Show account drawer trigger on mobile**
  - fixed legacy mobile CSS that hid the new account button;
  - mobile header now keeps the account control visible;
  - service-worker cache was bumped so stale mobile CSS is cleared.
- **PR #29 — Prevent auth email rate-limit bursts**
  - one sign-in tap can trigger at most one email-sending auth operation;
  - local resend cooldown prevents repeated taps from hammering Supabase Auth;
  - rate-limit errors are mapped to user-friendly messaging;
  - anonymous-user upgrade is still preferred when it can preserve contributor history.

### Important launch blocker: custom SMTP

WashRadar still uses Supabase Auth for identity, but **Supabase's built-in test email sender is not suitable for a larger public launch**. Before broad beta/public promotion, configure custom SMTP (for example Resend) in Supabase Auth and test domain/DNS delivery.

Paying for Supabase Pro does not itself replace the built-in mail sender.

---

# Product principles

> **Low friction for users. High scrutiny for data.**

- Browsing must not require an account.
- Basic queue contributions must not require a permanent account.
- Nearby/fresh/verified evidence receives more influence than remote/stale evidence.
- Unknown data stays unknown; never silently turn missing queue data into `0`.
- Paid placements must never alter organic recommendation scoring.
- Normal browsing should generate **$0 of paid Google API traffic whenever practical**.
- **Trust and rewards are separate systems.** Points, badges and challenges must never make an inaccurate report more trusted.
- Scale proactively before a quota/compute limit becomes an incident.

---

# Current architecture

```text
GitHub Pages (React + Vite PWA)
        |
        +-- app shell / service worker
        +-- static postal/FSA data
        +-- static GTA address chunks
        |
        +-- Supabase Data API / RLS
        |     +-- canonical washes / hours / types
        |     +-- queue reports / estimates
        |     +-- profiles / user vehicles
        |     +-- challenges / progress / points ledger
        |     +-- favourites / alerts
        |
        +-- queue freshness
        |     +-- DEFAULT: visible-tab polling of queue_signal_feed
        |     +-- OPTIONAL: Supabase Realtime by config
        |
        +-- Supabase DB triggers / RPCs
        |     +-- nearby spatial lookup
        |     +-- queue signal feed
        |     +-- contribution rewards
        |     +-- challenge progress
        |     +-- self-scoped account helpers
        |
        +-- Supabase Edge Functions
              +-- queue validation/sessions
              +-- geocode fallback
              +-- controlled Places ingestion
              +-- wash-type evidence
              +-- ads/analytics
              +-- protected admin/moderation

Directions --> Google Maps / Apple Maps on the user's device
              (live traffic/ETA handled outside WashRadar)
```

Main folders:

- `src/domain` — ranking, queue estimation, confidence, contributor levels/config.
- `src/services` — repositories, Supabase adapter, static search, auth/community, analytics and queue refresh.
- `src/components`, `src/pages` — UI.
- `supabase/migrations` — schema/RLS/indexes/RPCs/triggers.
- `supabase/functions` — privileged actions/enrichment.
- `scripts` — static index generators and scale-smoke script.
- `.github/workflows` — CI, Pages deployment and production scale smoke.
- `docs/SCALING.md` — capacity/upgrade runbook.
- `tests`, `e2e` — automated coverage.

---

# Supabase scaling posture

WashRadar is intentionally staying on Supabase.

Current production DB is small (roughly tens of MB, with ~889 wash locations), so the immediate scale concern is request/connection behavior rather than storage size.

## Queue refresh modes

Production-safe default:

```env
VITE_QUEUE_REFRESH_MODE=poll
VITE_QUEUE_POLL_MS=20000
```

Optional Realtime mode:

```env
VITE_QUEUE_REFRESH_MODE=realtime
```

Do not turn Realtime back on globally merely because it feels more "live". Measure concurrent connections/message fan-out first.

## Important indexes

Production includes spatial and future-growth indexes such as:

- geographic GiST lookup on wash locations;
- queue report wash/freshness/expiry indexes;
- queue report user-history and user/wash indexes;
- wash-type report user-history index;
- Radar Points user/category/date index;
- favourites, alerts and business-hour lookup indexes.

Before a new high-volume feature launches, inspect its query plan and add supporting indexes **before** the table becomes large.

## Upgrading later

- **Free → Pro plan:** treat as a billing/capacity/configuration change. No WashRadar backend rewrite should be required.
- **Compute-size change:** separate from the plan upgrade. Supabase documents a database restart/downtime for compute resizing, so resize proactively during a low-traffic window and run the production smoke immediately after.
- For stricter availability needs later, evaluate paid read-replica/high-availability options before a resize or major maintenance operation.

See `docs/SCALING.md` for the detailed runbook and thresholds.

---

# Contributor / community architecture

## Queue trust

General evidence ordering:

1. verified completed queue session;
2. fresh nearby GPS report;
3. older/less precise nearby report;
4. remote report.

Freshness decays from strongest in the first minutes to no live influence after roughly an hour. Reports are combined using proximity, freshness, reputation and agreement/outlier penalties. Only the latest active signal from a contributor should materially influence a wash.

## Radar Points

Radar Points are a retention/reward system, **not** a trust score.

| Contribution | Base points |
| --- | ---: |
| Nearby queue update | 20 |
| Verified completed wait | 75 |
| Nearby wash-type confirmation | 15 |
| Remote report | 0 |

Base contribution points are capped at 200/day. Challenge bonuses are one-time/idempotent.

Contributor levels:

- Level 1 — **New Scout** — 0+
- Level 2 — **Queue Scout** — 250+
- Level 3 — **Radar Regular** — 750+
- Level 4 — **Local Expert** — 1,500+
- Level 5 — **WashRadar Hero** — 3,000+

## Current challenges

- **First Radar** — first nearby queue update — +100.
- **Queue Scout** — update 3 different nearby washes — +250.
- **Verified Wait** — complete a verified `I'm in line` timer — +500.
- **Wash Detective** — nearby wash-type confirmation — +150.
- **3-Day Contributor** — contribute on 3 different days — +300.
- **Local Hero** — help update 5 different nearby washes — +750.

Challenge progress is derived from server-side contribution history rather than browser counters.

## Profile / auth

Signed-in users can have:

- display name and unique handle;
- optional bio;
- Radar Points / level;
- reports, verified waits, reputation and streak;
- contribution history;
- My Cars;
- saved washes and alerts.

The same Supabase session/client is shared across the app. On the same device/browser, login is expected to persist through refresh/reopen until explicit sign out. Email is account/private data, not a public contributor label.

## My Cars

`user_vehicles` is private under RLS and supports year, make, model, optional nickname, optional 17-character VIN and one primary vehicle.

Vehicle-aware wash compatibility is a future feature; do not invent compatibility until restriction/source data is trustworthy.

---

# Cost architecture

Normal WashRadar use should follow this path:

- **GPS:** browser/phone geolocation — $0 to WashRadar.
- **Distance:** calculated locally — $0.
- **Wash catalogue:** canonical Supabase records; no per-user Places discovery.
- **Queue:** dynamic Supabase data.
- **Postal/FSA search:** static generated index — $0/search.
- **Street/house autocomplete:** static partitioned open-address files — $0/search.
- **Traffic/ETA:** user's Maps app after Directions — $0 to WashRadar.
- **Google Routes:** disabled for normal browsing.
- **Google Places:** administrative catalogue maintenance/enrichment only.
- **Google Geocoding:** exceptional fallback when local search cannot resolve.

Do not reintroduce automatic Google traffic-route calls without an explicit product decision.

---

# Search / address architecture

## Postal/FSA

PR #21 switched the postal build to the full Canadian dataset and validates required GTA coverage such as `M1X`. PR #22 fixed stale mobile/PWA postal caching.

Postal input is normalized for case/spacing and should resolve locally before Google fallback.

## Street/house autocomplete

Preferred architecture: **static partitioned files**, not millions of household addresses in primary Supabase.

Current ODA-derived deployment contains roughly 1.56M GTA address points in partitioned chunks. Keep one useful routing point per building where possible rather than duplicating every unit.

Google fallback caches should avoid storing raw household search text where not required.

---

# Current infrastructure / catalogue

- Frontend: React + Vite + TypeScript PWA.
- Hosting: GitHub Pages.
- Primary domain: `washradar.ca`.
- Backend: Supabase PostgreSQL, Auth, Data API, optional Realtime and Edge Functions.
- Supabase project: `mwyomijlvjfllgeniqcz`.
- Map display: open tile-map path rather than paid Google map loads.
- Approximate catalogue: ~889 saved wash locations; most have real weekly hours; GTA-first with useful spillover.

Active production Edge Functions include:

- `ad-events`
- `admin`
- `analytics-events`
- `geo-services`
- `queue-actions`
- `wash-ingest`
- `wash-type-actions`

Do not run full Google Places/detail enrichment casually. Prefer selective refreshes for stale/problem locations.

---

# Wash-type trust model

Google's generic `car_wash` type does not reliably identify touchless, soft-cloth, tunnel, self-serve, hand wash, etc.

WashRadar combines evidence from business-name wording, official website, other credible evidence where needed, contributor reports, proximity, reputation and independent agreement. Only publish a wash type when confidence crosses the configured threshold.

---

# User-facing timing model

Do **not** promise `drive + queue + wash = done in` while paid traffic routing is disabled.

Prefer:

- **Distance:** `2.8 km away`
- **Queue:** `~8 min`
- **Wash:** `~6 min`
- **Directions:** opens the user's navigation app for live traffic/ETA

Ranking should primarily use distance, queue/confidence, wash duration, open status, wash-type preference, useful price/rating data and uncertainty penalties.

---

# Ads foundation

The schema supports advertiser businesses, campaigns, creatives, placements, geo/radius targeting, dates, priority, caps, budgets and impression/click tracking.

There are currently no live production advertisers/campaigns. `/ad-preview` exists for fictional placement/viewability testing without changing organic ranking.

Paid/sponsored activity must never alter organic queue trust or recommendation scoring.

---

# Near-term priorities

1. **Configure custom SMTP for Supabase Auth** and verify branded login delivery before wider beta/public launch.
2. Physically validate persistent login + account drawer on iPhone/Android after the newest deployment.
3. Validate Challenges/Radar Points with real nearby contributions and confirm idempotent awards.
4. Validate My Cars add/delete/primary behavior.
5. Continue representative GTA postal/FSA/street search tests and `Use my location` validation.
6. Test the complete `Update queue` + `I'm in line` loop with two independent sessions.
7. Run **Production scale smoke** before launch and after any Supabase plan/compute change.
8. Monitor Supabase usage/observability and scale around ~70–80% sustained capacity rather than waiting for hard limits.
9. Continue selective wash-type/catalogue enrichment rather than bulk paid enrichment.

---

# Complete pull-request history

**Merged** means the PR entered `main`. **Closed / superseded** means it did not and should not be restarted unless investigating history.

| PR | Status | Change | Current meaning |
| --- | --- | --- | --- |
| #1 — Clarify card timing and add quick queue reporting | Merged | Split timing concepts, fixed unknown queue display, added quick reporting. | Timing/report UX foundation. |
| #2 — Fix queue report submission | Merged | Added proximity position and failure states; repaired backend privileges. | Location-aware queue submission. |
| #3 — Add low-friction queue trust scoring | Merged | Proximity/freshness weighting, remote caps, consensus, dedupe and verified-session influence. | Core queue-trust model. |
| #4 — Configure WashRadar custom domain | Merged | Added `washradar.ca` Pages/CORS/auth groundwork. | Production custom domain. |
| #5 — Fix trust and accuracy gaps | Merged | Removed invented hours/false zero queues; improved GPS/unknown handling. | Unknown stays unknown. |
| #6 — Repair GTA catalogue enrichment and resume imports | Merged | Fixed hours parser and resumable GTA ingestion/enrichment. | Broad GTA catalogue foundation. |
| #7 — Add confidence-scored wash type truth engine | Merged | Multi-source type evidence and confidence rules. | Current type-classification model. |
| #8 — Repair wash-type enrichment and simplify card actions | Merged | Repaired enrichment and introduced visible `Update queue` CTA. | Current contributor CTA pattern. |
| #9 — Make wash-type filters reflect verified nearby data | Merged | Type chips use verified nearby counts. | Filters reflect trusted data. |
| #10 — Add interactive ad placement preview | Merged | Added `/ad-preview`. | Ads foundation/testing only. |
| #11 — Zero-cost routing and local address index foundation | Merged | Removed automatic Google Routes and added local address groundwork. | Start of zero-cost browsing. |
| #12 — Zero-cost routing and GTA address-search foundation | Merged | Reinforced distance/queue/wash UX + external Maps Directions. | Current routing philosophy. |
| #13 — Add zero-cost GTA address autocomplete | Merged | First static NAR implementation; build failed because NAR files required joining. | Historical; superseded. |
| #14 — Fix zero-cost GTA address index build | Merged | Switched practical build path to Ontario ODA. | Static address build foundation. |
| #15 — Fix free GTA address index deployment | Closed / superseded | In-flight privacy/cost fix after main advanced. | Superseded by #16. |
| #16 — Finalize reliable zero-cost GTA address autocomplete | Merged | Finalized ODA chunks and fallback privacy/cost behavior. | Current street-address architecture. |
| #17 — Fix NAR address index generation | Closed / superseded | Experimental `LOC_GUID` NAR join. | Not current. |
| #18 — Reduce ongoing Supabase usage | Merged | Coalesced Realtime events, hidden-tab work and analytics batching. | First runtime-cost optimization layer. |
| #19 — Fix unified city, postal code and address search | Merged | Unified manual search and explicit Search button. | Current search-box behavior. |
| #20 — Fix GTA postal-code search reliably | Merged | Added separate GeoNames postal path using incomplete `CA.zip`. | Architecture retained; source superseded. |
| #21 — Use full Canada postal dataset for GTA FSA search | Merged | Switched to full Canadian postal data + coverage validation. | Current postal/FSA source. |
| #22 — Prevent stale postal search on iPhone/PWA | Merged | Revalidation + service-worker cache bump. | Current postal cache behavior. |
| #23 — Refresh README to current production state | Merged | Replaced stale handoff. | Source-of-truth workflow established. |
| #24 — Document complete pull-request history | Merged | Added historical ledger. | Project archaeology/handoff foundation. |
| #25 — Add contributor profiles, Radar Challenges and My Cars | Merged | Profile v2, points/challenges, activity, vehicles, RLS/reward security. | Current community foundation. |
| #26 — Document community release state | Merged | Updated handoff for the community release. | Documentation milestone. |
| #27 — Persist shared account session and add global profile drawer | Merged | One shared Supabase auth identity; persistent same-device session; global account drawer. | Current auth/navigation architecture. |
| #28 — Show account drawer trigger on mobile | Merged | Fixed responsive CSS hiding the account control; cache bump. | Mobile account menu visible. |
| #29 — Prevent auth email rate-limit bursts | Merged | One mail operation per tap, resend cooldowns, friendly 429 handling. | Protects Auth; custom SMTP still pending. |
| #30 — Prepare WashRadar for Supabase scale | Merged | Lightweight queue-only refresh, adaptive polling default, scale indexes, load smoke, scaling runbook. | Current production scale architecture. |

## Superseded paths to avoid restarting

- **PR #15** — superseded by #16.
- **PR #17** — experimental NAR repair; current street index is ODA-based.
- **PR #13's failed NAR deployment** — historical only.
- **PR #20's `CA.zip` postal source** — superseded by #21 full dataset.
- **Global always-on queue Realtime as the default** — superseded by #30 adaptive polling. Realtime remains an explicit config option.

When continuing the project, always start from `main`, inspect newest merged PRs, verify the latest Pages workflow, and read `docs/SCALING.md` before capacity-related changes.
