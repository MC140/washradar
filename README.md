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

Before doing project work:

1. Read `main`.
2. Check the newest merged PRs.
3. Check the latest **Deploy WashRadar to GitHub Pages** workflow.
4. Treat this README as context, but GitHub `main` + Actions are the final source of truth.

Do not restart work from an old PR just because it appears in historical notes.

---

# Current production baseline — 2026-09-09

The current production feature baseline includes work through **PR #25**.

## Latest release — PR #25

**PR #25 — `Add contributor profiles, Radar Challenges and My Cars`** added the first complete contributor-retention layer:

- **Profile v2** with display name, unique handle, optional bio, contributor level, Radar Points, contribution metrics and recent activity.
- **Radar Challenges** with server-computed progress and one-time challenge rewards.
- **My Cars** with private year/make/model, optional nickname, optional VIN and one primary vehicle.
- **Radar Points** for useful nearby contributions:
  - nearby queue update: +20;
  - verified completed queue wait: +75;
  - nearby wash-type confirmation: +15;
  - one-time challenge bonuses on completion.
- Base contribution points are capped at **200/day** to reduce farming.
- **Remote reports earn no Radar Points** but can still contribute weak evidence to the trust model.
- Points and challenge rewards are intentionally **separate from queue trust**. They do not increase report confidence.
- Reward functions are server-controlled; authenticated browser clients cannot directly execute the internal award functions.
- Anonymous contributor sign-in first attempts to preserve the same Supabase user ID when converting to email identity, so contribution history can stay attached where the auth configuration permits it.

Production database migrations for profiles, challenges, points, vehicles and RLS are applied. GitHub Pages deployment for merge commit `52f1400799c7791c59325ff7561de6a15aa65bb6` completed successfully.

## Recent search / platform work

- **PR #21 — `Use full Canada postal dataset for GTA FSA search`**
  - replaced the incomplete postal source from PR #20;
  - builds GTA/Southern Ontario FSA centroids from the full Canadian postal dataset;
  - deployment requires `M1X` and a non-trivial FSA set.
- **PR #22 — `Prevent stale postal search on iPhone/PWA`**
  - postal index revalidates instead of depending on stale `force-cache` data;
  - service-worker shell cache was bumped so existing mobile/PWA clients receive new postal assets.
- **PR #23 — `Refresh README to current production state`**
  - replaced the stale PR #13 handoff and established the current source-of-truth workflow.
- **PR #24 — `Document complete pull-request history`**
  - added the PR ledger used for project archaeology/handoff.

**Important:** PR #13's original NAR deployment problem is historical and is not the current blocker.

---

# Product principles

> **Low friction for users. High scrutiny for data.**

- Browsing must not require an account.
- Basic queue contributions must not require a permanent account.
- Nearby/fresh/verified evidence receives more influence than remote/stale evidence.
- Unknown data stays unknown; never silently turn missing queue data into `0`.
- Paid placements must never alter organic recommendation scoring.
- Normal browsing should generate **$0 of paid Google API traffic whenever practical**.
- **Trust and rewards are separate systems.** Points, badges or challenges must never make an inaccurate report more trusted.

---

# Contributor / community architecture

## Queue trust

General evidence ordering:

1. verified completed queue session;
2. fresh nearby GPS report;
3. older/less precise nearby report;
4. remote report.

Freshness decays roughly from strongest at ≤5 minutes to no live influence after ~60 minutes. Reports are combined using proximity, freshness, reputation and agreement/outlier penalties. Only the latest active signal from a contributor should materially influence a wash.

## Radar Points

Radar Points are a retention/reward system, not a trust score.

Current base awards:

| Contribution | Points |
| --- | ---: |
| Nearby queue update | 20 |
| Verified completed wait | 75 |
| Nearby wash-type confirmation | 15 |
| Remote report | 0 |

Base contribution points are capped at 200/day. Challenge bonuses are one-time and idempotent.

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

## Profile v2

Signed-in users can have:

- display name;
- unique handle;
- optional short bio;
- Radar Points / level;
- reports, verified waits, reputation and streak;
- recent contribution history;
- saved washes / alerts links;
- My Cars.

Email should remain account/private information, not a public-facing contributor label.

## My Cars

`user_vehicles` is private under RLS and supports:

- year;
- make;
- model;
- optional nickname;
- optional 17-character VIN;
- one primary vehicle.

The current release stores/manages vehicles. Future vehicle work can add wash compatibility and personalized recommendations without redesigning identity/storage.

---

# Cost architecture

Normal WashRadar use should follow this path:

- **GPS:** browser/phone geolocation — $0 to WashRadar.
- **Distance:** calculated locally from coordinates — $0.
- **Wash catalogue:** canonical records in Supabase; no per-user Places discovery.
- **Queue:** community + historical data in Supabase.
- **Postal/FSA search:** static generated index hosted with the PWA — $0/search.
- **Street/house autocomplete:** static partitioned open-address files — $0/search.
- **Traffic/ETA:** user's Maps app after tapping **Directions** — $0 to WashRadar.
- **Google Routes:** disabled for normal browsing.
- **Google Places:** administrative catalogue maintenance/enrichment only.
- **Google Geocoding:** exceptional fallback when local search cannot resolve a location.

Do not reintroduce automatic Google traffic-route calls without an explicit product decision.

---

# Search / address architecture

## Postal and FSA search

The production build generates a static GTA/Southern Ontario FSA index from a free Canadian postal dataset. Postal input should resolve locally before Google fallback.

PR #21 fixed the data source and added build-time validation. PR #22 fixed stale-cache behavior on existing mobile/PWA sessions.

## House/street autocomplete

Preferred architecture: **static partitioned files**, not millions of household address rows in the primary Supabase database.

Open address data is processed into browser-loadable chunks. Keep one useful routing point per physical building where possible rather than duplicating every apartment/unit.

Google geocode fallback caching should retain a hash + coordinates rather than raw household search text.

---

# Current infrastructure

- Frontend: React + Vite + TypeScript PWA.
- Hosting: GitHub Pages.
- Primary domain: `washradar.ca`.
- Backup/redirect domain: `carwashbuddy.ca`.
- Backend: Supabase PostgreSQL, Auth, Realtime and Edge Functions.
- Map display: open tile-map path rather than paid Google map loads.
- Supabase project: `mwyomijlvjfllgeniqcz`.

Active production Edge Functions include:

- `ad-events`
- `admin`
- `analytics-events`
- `geo-services`
- `queue-actions`
- `wash-ingest`
- `wash-type-actions`

Community data introduced by PR #25 is primarily handled through RLS-protected tables, database triggers and self-scoped RPCs rather than a new general-purpose public reward API.

---

# Catalogue state

Approximate last known GTA catalogue state:

- ~889 saved wash locations;
- ~800 with real weekly opening hours;
- ~859 in true GTA municipalities;
- some useful spillover locations intentionally retained;
- ~188 distinct FSA prefixes across the catalogue.

Do not run full Google Places/detail enrichment casually. Prefer selective refreshes for stale/problem locations.

---

# Wash-type trust model

Google's generic `car_wash` type does not reliably identify touchless, soft-cloth, tunnel, self-serve, hand wash, etc.

WashRadar combines evidence from:

- explicit business-name wording;
- official website;
- editorial/review evidence when needed;
- contributor reports;
- proximity, reputation and independent agreement.

Only publish a wash type when confidence crosses the configured threshold.

---

# User-facing timing model

Do **not** make `drive + queue + wash = done in` the core promise while paid traffic routing is disabled.

Prefer:

- **Distance:** `2.8 km away`
- **Queue:** `~8 min`
- **Wash:** `~6 min`
- **Directions:** opens the user's navigation app for live traffic/ETA

Ranking should primarily use distance, queue/confidence, wash duration, open status, wash-type preference, useful price/rating data and uncertainty penalties.

---

# Ads foundation

The schema supports advertiser businesses, campaigns, creatives, placements, geo/radius targeting, dates, priority, caps, budgets and impression/click tracking.

Current placement concepts include:

- `explore_nearby_offer`
- `wash_detail_nearby_offer`
- `queue_wait_offer`
- `post_wash_offer`
- `sponsored_wash`

There are currently no live production advertisers/campaigns. `/ad-preview` exists for fictional placement/viewability testing without changing organic ranking.

---

# Near-term priorities

1. Physically validate **Profile v2** on production iPhone/Android, including anonymous → email sign-in continuity.
2. Validate **Challenges** with real nearby queue updates and confirm progress/points change once, not repeatedly.
3. Validate **My Cars** add/delete/primary behavior from a signed-in account.
4. Continue postal/FSA and street-address production validation across representative GTA locations.
5. Test `Use my location` end-to-end on Safari/Chrome/PWA.
6. Test the complete `Update queue` and `I'm in line` loop with two independent user sessions.
7. Continue selective wash-type/catalogue enrichment rather than bulk paid enrichment.
8. After enough beta usage, evaluate sponsored challenge rewards / free-wash partnerships without changing trust weights.
9. Later add vehicle-aware wash compatibility once reliable wash restriction/compatibility data is available.

---

# Architecture

```text
GitHub Pages (React + Vite PWA)
        |
        +-- app shell / service worker
        +-- static postal/FSA data
        +-- static address chunks
        |
        +-- Supabase Data API / RLS
        |     +-- canonical washes / hours / types
        |     +-- queue state
        |     +-- profiles
        |     +-- user vehicles
        |     +-- challenges / progress / points ledger
        |     +-- favourites / alerts
        |
        +-- Supabase Realtime
        |     +-- queue estimate updates
        |
        +-- Supabase DB triggers / RPCs
        |     +-- contribution rewards
        |     +-- challenge progress
        |     +-- self-scoped point totals / vehicle operations
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
- `src/services` — repositories, Supabase adapter, search, auth/community services, analytics.
- `src/components`, `src/pages` — UI.
- `supabase/migrations` — schema/RLS/indexes/RPCs/triggers.
- `supabase/functions` — privileged actions/enrichment.
- `scripts` — static postal/address-index generators.
- `.github/workflows` — CI and Pages deployment.
- `tests`, `e2e` — automated coverage.

---

# Complete pull-request history

This is the project change ledger. **Merged** means the PR entered `main`; **Closed / superseded** means it did not enter `main` and should not be restarted unless investigating history.

| PR | Status | Change | What it means now |
| --- | --- | --- | --- |
| #1 — Clarify card timing and add quick queue reporting | Merged | Split timing concepts, stopped unknown queue from appearing as zero, added quick reporting. | Foundation of the timing/report UX. |
| #2 — Fix queue report submission | Merged | Added proximity position and proper failure states; repaired backend privileges. | Queue submission became location-aware/trustworthy. |
| #3 — Add low-friction queue trust scoring | Merged | Added proximity/freshness weighting, remote caps, consensus, dedupe and verified-session influence. | Core queue-trust model. |
| #4 — Configure WashRadar custom domain | Merged | Added `washradar.ca` Pages/CORS/auth groundwork. | Production custom domain. |
| #5 — Fix trust and accuracy gaps | Merged | Removed invented hours/false zero queues and strengthened unknown/GPS handling. | Unknown data remains unknown. |
| #6 — Repair GTA catalogue enrichment and resume imports | Merged | Fixed hours parser and resumable GTA ingestion/enrichment. | Broad saved GTA wash catalogue. |
| #7 — Add confidence-scored wash type truth engine | Merged | Added multi-source type evidence and confidence rules. | Current type-classification model. |
| #8 — Repair wash-type enrichment and simplify card actions | Merged | Repaired enrichment and moved to the visible `Update queue` CTA. | Current contributor action pattern. |
| #9 — Make wash-type filters reflect verified nearby data | Merged | Type chips use verified nearby counts. | Filters reflect actual data. |
| #10 — Add interactive ad placement preview | Merged | Added `/ad-preview` with fictional offers/viewability. | Ads foundation only. |
| #11 — Zero-cost routing and local address index foundation | Merged | Removed automatic Google Routes and added local address groundwork. | Start of zero-cost browsing path. |
| #12 — Zero-cost routing and GTA address-search foundation | Merged | Reinforced distance/queue/wash UX + external Maps Directions. | Current routing/cost philosophy. |
| #13 — Add zero-cost GTA address autocomplete | Merged | First static NAR address implementation; original Pages build later failed because NAR files needed joining. | Historical; superseded by #14/#16. |
| #14 — Fix zero-cost GTA address index build | Merged | Switched practical build path to Ontario ODA. | Static address build foundation. |
| #15 — Fix free GTA address index deployment | Closed / superseded | In-flight privacy/cost fix after main advanced. | Superseded by #16. |
| #16 — Finalize reliable zero-cost GTA address autocomplete | Merged | Finalized ODA chunks, fallback geocoding privacy/cost behavior. | Current street-address architecture. |
| #17 — Fix NAR address index generation | Closed / superseded | Experimental NAR `LOC_GUID` join repair. | Not current. |
| #18 — Reduce ongoing Supabase usage | Merged | Coalesced Realtime updates, hidden-tab behavior and analytics batching. | Current low-cost runtime behavior. |
| #19 — Fix unified city, postal code and address search | Merged | Unified manual location search and added explicit Search button. | Normal search-box behavior. |
| #20 — Fix GTA postal-code search reliably | Merged | Added separate GeoNames postal/FSA path but initial `CA.zip` source lacked `M1X`. | Architecture retained; data source superseded by #21. |
| #21 — Use full Canada postal dataset for GTA FSA search | Merged | Switched to full Canadian postal data and build validation. | Current postal/FSA source. |
| #22 — Prevent stale postal search on iPhone/PWA | Merged | Revalidated postal data and bumped service-worker cache. | Current postal cache behavior. |
| #23 — Refresh README to current production state | Merged | Replaced stale project handoff. | Established source-of-truth rules. |
| #24 — Document complete pull-request history | Merged | Added full historical PR ledger. | Future sessions can understand superseded/current work. |
| #25 — Add contributor profiles, Radar Challenges and My Cars | Merged | Added Profile v2, Radar Points/challenges, contribution history, private vehicles, reward security and contributor sign-in continuity attempt. | Current community/retention foundation in production. |

## Superseded branches / paths to avoid restarting

- **PR #15** — superseded by PR #16.
- **PR #17** — experimental NAR repair; superseded by the ODA-based path.
- **PR #13's failed NAR deployment** — historical only.
- **PR #20's `CA.zip` source** — superseded by PR #21's full dataset.

When continuing the project, always start from `main`, inspect newest merged PRs and verify the latest Pages workflow before making changes.
