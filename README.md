# WashRadar

WashRadar is a mobile-first PWA that helps drivers answer:

> **Where should I wash my car right now?**

Its differentiated value is **queue intelligence + trustworthy wash information**, not navigation. Live traffic and turn-by-turn routing belong in the user's Google Maps / Apple Maps app.

**Production:** https://washradar.ca  
**Repository:** `MC140/washradar`  
**Supabase:** `mwyomijlvjfllgeniqcz` (Canada Central)

---

## READ THIS FIRST — project handoff rules

This README is the handoff for future ChatGPT/Codex/model sessions.

**Do not assume an old PR number mentioned in historical notes is the current production state.** Before doing project work:

1. Read `main`.
2. Check the newest merged PRs.
3. Check the latest **Deploy WashRadar to GitHub Pages** workflow.
4. Treat this README's architecture/status as context, but GitHub `main` + Actions are the final source of truth.

PR numbers below are historical milestones, not a pointer to an active branch.

---

# Current production baseline — 2026-09-09

The current feature baseline includes the work through **PR #22**.

Recent production changes:

- **PR #21 — `Use full Canada postal dataset for GTA FSA search`**
  - replaced the failed postal source used in PR #20;
  - builds GTA/Southern Ontario FSA centroids from the full Canada postal dataset;
  - deployment validation requires `M1X` and at least 100 generated FSAs.
- **PR #22 — `Prevent stale postal search on iPhone/PWA`**
  - revalidates the postal index instead of relying on stale `force-cache` data;
  - bumps the service-worker shell cache so existing iPhone/PWA users receive the new postal-search assets.

**Important:** PR #13 is historical. It introduced the first zero-cost GTA address-autocomplete implementation, but its original deployment failure is no longer the current project blocker. Do not resume work from the PR #13 failure unless investigating history.

---

# Product principles

> **Low friction for users. High scrutiny for data.**

- Browsing must not require an account.
- Basic queue contributions must not be blocked by CAPTCHA or invasive fingerprinting.
- Nearby/fresh/verified evidence receives more influence than remote or stale evidence.
- Unknown data stays unknown; never silently turn missing queue information into `0`.
- Paid placements must never alter organic recommendation scoring.
- Normal browsing should generate **$0 of paid Google API traffic whenever practical**.

---

# Cost architecture

Normal WashRadar use should follow this path:

- **GPS:** browser/phone geolocation — $0 to WashRadar.
- **Distance:** calculated locally from coordinates — $0.
- **Wash catalogue:** saved in Supabase; no per-user Google Places discovery.
- **Queue:** WashRadar community + historical data in Supabase.
- **Postal/FSA search:** static generated index hosted with the PWA — $0 per search.
- **Street/house autocomplete:** static open-address index hosted with the PWA when generated/available — $0 per search.
- **Traffic/ETA:** user's Maps app after tapping **Directions** — $0 to WashRadar.
- **Google Routes:** disabled for normal browsing.
- **Google Places:** administrative catalogue maintenance/enrichment only.
- **Google Geocoding:** fallback only when local search cannot resolve a location.

The production `geo-services` function contains a zero-cost guard for route requests; do not reintroduce automatic traffic-route calls without an explicit product decision.

---

# Search / address architecture

## Postal and FSA search

The production build generates a static GTA/Southern Ontario FSA index from a free Canadian postal dataset. Search should resolve postal/FSA input locally before any Google fallback.

PR #21 fixed the dataset source and added deployment validation. PR #22 fixed stale-cache behavior for existing iPhone/PWA sessions.

## House/street address autocomplete

The preferred architecture is **static partitioned address files**, not millions of address rows in the primary Supabase database.

Open-address data is processed into browser-loadable chunks so autocomplete can work without a paid per-keystroke API. Keep one useful routing point per physical building where possible rather than duplicating apartment units that share the same building origin.

Supabase already has an `address_points` / `address_suggestions(...)` foundation as a fallback/server-side option, but it is **not** the preferred place to bulk-store the entire GTA household address universe.

Google geocode fallback cache should store a hash + coordinates rather than retaining raw household search text.

---

# Current infrastructure

- Frontend: React + Vite + TypeScript PWA.
- Hosting: GitHub Pages.
- Primary domain: `washradar.ca`.
- Backup/redirect domain: `carwashbuddy.ca`.
- Backend: Supabase PostgreSQL, Auth, Realtime and Edge Functions.
- Map display: open tile-map path, not paid Google map loads.
- Supabase project: `mwyomijlvjfllgeniqcz`.
- Last measured database size before any full address bulk-load: about **24 MB / 500 MB Free-plan database allowance**.

Active production Edge Functions include:

- `ad-events`
- `admin`
- `analytics-events`
- `geo-services`
- `queue-actions`
- `wash-ingest`
- `wash-type-actions`

---

# Catalogue state

Approximate last known GTA catalogue state:

- ~889 saved wash locations;
- ~800 with real weekly opening hours;
- ~859 in true GTA municipalities;
- some useful spillover locations intentionally retained;
- ~188 distinct FSA prefixes across the full catalogue.

Do not run another full Google Places/detail enrichment sweep casually. Prefer selective refreshes for stale/problem locations.

---

# Queue trust model

Queue reports are intentionally easy to submit, but influence is weighted.

General trust ordering:

1. verified queue session;
2. fresh nearby GPS report;
3. older/less precise nearby report;
4. remote report.

Freshness decays roughly from strongest at ≤5 minutes to no live influence after ~60 minutes. Remote-only evidence should not be able to create a strong LIVE state by itself. Closure/unavailable evidence requires stronger local support.

The UI must distinguish LIVE / recent / estimated / limited-data states.

---

# Wash-type trust model

Google's generic `car_wash` type does not tell us whether a location is touchless, soft-cloth, tunnel, self-serve, hand wash, etc.

WashRadar combines evidence from:

- explicit business-name wording;
- official website;
- editorial/review evidence only when needed;
- contributor reports;
- proximity, reputation and independent agreement.

Only publish a wash type when confidence crosses the configured threshold.

---

# User-facing timing model

Do **not** make `drive + queue + wash = done in` the core promise now that paid traffic routing is intentionally disabled.

Prefer:

- **Distance:** e.g. `2.8 km away`
- **Queue:** e.g. `~8 min`
- **Wash:** e.g. `~6 min`
- **Directions:** opens the user's navigation app for live ETA/traffic

Ranking should primarily use distance, queue/confidence, wash duration, open status, user type preference, useful price/rating data and uncertainty penalties.

---

# Ads foundation

The schema supports advertiser businesses, campaigns, creatives, placements, geo/radius targeting, dates, priority, caps, budget/pricing metadata, and impression/click tracking.

Current placement concepts include:

- `explore_nearby_offer`
- `wash_detail_nearby_offer`
- `queue_wait_offer`
- `post_wash_offer`
- `sponsored_wash`

There are currently no live production advertisers/campaigns. `/ad-preview` exists for fictional placement/viewability testing without real ad analytics.

---

# Near-term priorities

1. Validate PR #21/#22 postal/FSA search on production mobile Safari/Chrome/PWA sessions.
2. Confirm representative GTA FSAs resolve locally without Google geocoding.
3. Continue/validate the static street-address autocomplete path using a free/open address source.
4. Keep address data out of the main Supabase DB unless measured size/performance proves that server-side storage is better.
5. Keep Google Geocoding as a rare fallback and avoid storing raw household queries.
6. Continue selective catalogue refreshes rather than bulk paid enrichment.
7. Validate wash-type enrichment after quota reset and confirm evidence/classifications persist correctly.
8. Continue physical iPhone/Android tests for GPS, queue reporting, PWA cache/update behavior and deep links.

---

# Architecture

```text
GitHub Pages (React + Vite PWA)
        |
        +-- app shell / service worker
        +-- static postal/FSA search data
        +-- static address-autocomplete chunks
        |
        +-- Supabase Data API
        |     +-- canonical washes
        |     +-- hours / types / queue state
        |     +-- user-owned data under RLS
        |
        +-- Supabase Realtime
        |     +-- queue estimate updates
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

- `src/domain` — ranking, queue estimation, confidence and config.
- `src/services` — repositories, Supabase adapter, location/search/analytics.
- `src/components`, `src/pages` — UI.
- `supabase/migrations` — schema/RLS/indexes/RPCs.
- `supabase/functions` — privileged actions/enrichment.
- `scripts` — static postal/address index generators.
- `.github/workflows` — CI and Pages deployment.
- `tests`, `e2e` — automated coverage.

---

# Historical milestone PRs

These are useful for archaeology only; they are **not current-session pointers**:

- PR #4 — production custom domain/CORS groundwork.
- PR #10 — ad placement preview.
- PR #12 — zero-cost routing/address-search foundation.
- PR #13 — first zero-cost GTA address-autocomplete implementation.
- PR #20 — postal-source attempt whose deployment was fixed by PR #21.
- PR #21 — working full-Canada postal dataset → GTA FSA build.
- PR #22 — iPhone/PWA postal cache refresh fix.

When continuing the project, always start from `main` and newest merged PRs rather than restarting from one of these historical PRs.
