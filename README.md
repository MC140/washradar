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

The current feature baseline includes the work through **PR #22**. **PR #23** refreshed this README/handoff to the current production architecture.

Recent production changes:

- **PR #21 — `Use full Canada postal dataset for GTA FSA search`**
  - replaced the failed postal source used in PR #20;
  - builds GTA/Southern Ontario FSA centroids from the full Canada postal dataset;
  - deployment validation requires `M1X` and at least 100 generated FSAs.
- **PR #22 — `Prevent stale postal search on iPhone/PWA`**
  - revalidates the postal index instead of relying on stale `force-cache` data;
  - bumps the service-worker shell cache so existing iPhone/PWA users receive the new postal-search assets.
- **PR #23 — `Refresh README to current production state`**
  - removed the stale PR #13 blocker/handoff;
  - made `main`, newest merged PRs and the latest Pages workflow the source-of-truth sequence for future sessions.

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

# Complete pull-request history

This is the project change ledger for handoff. **Merged** means the PR entered `main`; **Closed / superseded** means it did not enter `main` and should not be revived unless doing historical investigation.

| PR | Status | Change | What it means now |
| --- | --- | --- | --- |
| #1 — Clarify card timing and add quick queue reporting | Merged | Split Drive, Queue, Wash, Starts in and Done in; stopped showing unknown queue as zero; added quick `Share what you see` reporting. | Foundation of the current timing/quick-report UX. |
| #2 — Fix queue report submission | Merged | Sent current position for proximity verification and showed real backend failures instead of false success; repaired service-role queue privileges. | Queue submission became trustworthy and location-aware. |
| #3 — Add low-friction queue trust scoring | Merged | Added proximity/freshness weighting, remote-report caps, corroborated LIVE logic, soft dedupe and verified-session influence. | Core queue-trust model still applies. |
| #4 — Configure WashRadar custom domain | Merged | Prepared `washradar.ca`, GitHub Pages base/CNAME and Supabase Edge Function CORS/auth origins. | `washradar.ca` is the primary production domain. |
| #5 — Fix trust and accuracy gaps | Merged | Removed invented hours/false zero queues, penalized unknown data, refreshed freshness locally, and tightened GPS requirements for verified sessions. | Current UI should prefer unknown/limited-data states over guesses. |
| #6 — Repair GTA catalogue enrichment and resume imports | Merged | Fixed hours parsing, made GTA catalogue ingestion resumable, re-enriched Place IDs and added coverage auditing. | Established the broad saved GTA wash catalogue and resumable admin ingestion. |
| #7 — Add confidence-scored wash type truth engine | Merged | Added multi-source wash-type evidence, contributor reports, confidence rules and `wash-type-actions`. | Current wash-type classification should remain evidence/confidence based. |
| #8 — Repair wash-type enrichment and simplify card actions | Merged | Repaired service-role enrichment permissions/restart behavior; simplified Directions and `Update queue` actions. | Current card action pattern and enrichment repair came from here. |
| #9 — Make wash-type filters reflect verified nearby data | Merged | Made type chips use verified counts and disable zero-result categories. | Filters should reflect actual nearby verified data. |
| #10 — Add interactive ad placement preview | Merged | Added hidden `/ad-preview` with fictional offers and viewability telemetry that does not affect ranking/production analytics. | Ads remain preview/foundation only; no live advertisers. |
| #11 — Zero-cost routing and local address index foundation | Merged | Removed automatic Google Routes usage from normal browsing and added protected local-address-index groundwork. | First step toward the current zero-cost browsing architecture. |
| #12 — Zero-cost routing and GTA address-search foundation | Merged | Reinforced distance + queue + wash-time UX, Maps-app Directions, and a zero-cost GTA address-search schema. | Current routing/cost philosophy is based on this. |
| #13 — Add zero-cost GTA address autocomplete | Merged | Added first static GTA address autocomplete using Statistics Canada NAR and local city/postal fallback. Its Pages build later failed because the assumed NAR file shape was wrong. | Historical implementation only; its original failure is superseded by #14/#16. |
| #14 — Fix zero-cost GTA address index build | Merged | Switched from the 1.5 GB NAR archive to Ontario ODA, added ODA parsing, GTA filtering, building dedupe and local centroids. | Became the practical static-address build path. |
| #15 — Fix free GTA address index deployment | Closed / superseded | Attempted privacy/cost improvements but `main` advanced while it was in flight. | Do not revive; #16 reapplied the needed work cleanly. |
| #16 — Finalize reliable zero-cost GTA address autocomplete | Merged | Finalized static Ontario ODA address chunks, non-blocking build behavior, hashed geocode cache and fallback-only Google geocoding. | Current street/house autocomplete architecture comes from this. |
| #17 — Fix NAR address index generation | Closed / superseded | Experimental repair joining NAR address and location files by `LOC_GUID`. | Not needed after #16/ODA succeeded. |
| #18 — Reduce ongoing Supabase usage | Merged | Coalesced Realtime refresh bursts, paused hidden-tab refreshes, batched analytics events, fixed analytics auth and updated the analytics Edge Function. | Current low-cost Supabase runtime behavior. |
| #19 — Fix unified city, postal code and address search | Merged | Unified city/postal/address submit behavior, added visible Search button and kept Google fallback-only. | Restored a normal manual location-search flow. |
| #20 — Fix GTA postal-code search reliably | Merged | Added an independent static postal/FSA search path using GeoNames and deployment validation. Initial `CA.zip` source proved incomplete for `M1X`. | Architecture retained, but dataset source was corrected by #21. |
| #21 — Use full Canada postal dataset for GTA FSA search | Merged | Switched to `CA_full.csv.zip`, collapsed full postals to FSA centroids and made Pages fail unless `M1X` and a non-trivial FSA set exist. | Current production postal/FSA data source and validation. |
| #22 — Prevent stale postal search on iPhone/PWA | Merged | Changed postal index loading away from stale `force-cache` behavior and bumped service-worker cache v3 → v4. | Current cache-update behavior for postal search/PWA clients. |
| #23 — Refresh README to current production state | Merged | Replaced the stale PR #13 handoff with current architecture/status and explicit source-of-truth rules. | Established this README as the current handoff document. |

## Superseded branches to avoid restarting

- **PR #15** — superseded by PR #16.
- **PR #17** — experimental NAR repair; superseded by the ODA-based production path.
- **PR #13's failed NAR deployment** — historical only; do not treat it as the current blocker.
- **PR #20's `CA.zip` postal source** — superseded by PR #21's full Canadian postal dataset.

When continuing the project, always start from `main`, inspect the newest merged PRs and verify the latest Pages workflow before making changes.
