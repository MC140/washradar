# WashRadar

WashRadar answers one question:

> **Where should I wash my car right now?**

The product is a mobile-first car-wash discovery and live queue PWA for Canada, starting with the GTA. Its differentiated value is **queue intelligence and trustworthy wash information**, not navigation. Google Maps and Apple Maps already solve live traffic and turn-by-turn routing well, so WashRadar should avoid paying to recreate that functionality.

**Production:** https://washradar.ca  
**Repository:** `MC140/washradar`  
**Supabase project:** `mwyomijlvjfllgeniqcz` (Canada Central)

---

# Start here in a future chat

This README is intentionally also the project handoff/context file. Before changing architecture, read this section and the current blocker/roadmap sections below.

## Product intent

WashRadar should help a driver answer, with as little friction as possible:

- Which car washes are near me?
- Which are open?
- What wash type do they offer?
- What is the queue right now?
- How trustworthy/fresh is that queue information?
- How long is the wash itself likely to take?
- Is it worth driving slightly farther for a much shorter queue?
- How do I navigate there?

The guiding product rule is:

> **Low friction for users. High scrutiny for data.**

Do not put mandatory accounts, CAPTCHA or invasive device fingerprinting in front of basic browsing or contributions. Instead, allow contributions and control how much influence each contribution receives based on proximity, freshness, reputation, agreement and verified queue sessions.

## Cost philosophy

Normal browsing should generate **$0 of paid Google API traffic whenever possible**.

The intended architecture is:

- **GPS:** browser/phone geolocation — free to WashRadar.
- **Distance:** calculated locally from coordinates — free.
- **Catalogue:** canonical wash records stored in Supabase.
- **Queue:** WashRadar community + historical data in Supabase.
- **Address autocomplete:** static Statistics Canada National Address Register index hosted with the app — no per-search Google or Supabase database cost.
- **Traffic/navigation:** user taps **Directions** and their Google Maps/Apple Maps app handles traffic and ETA.
- **Google Places:** occasional administrative catalogue maintenance/enrichment only.
- **Google Geocoding:** fallback only when our own address/city/postal search cannot resolve a location.

Do not reintroduce automatic Google Routes calls during normal browsing unless there is a deliberate future product decision to accept that cost.

---

# Current project state — 2026-09-09

## Current production infrastructure

- `washradar.ca` is the primary production domain.
- `carwashbuddy.ca` is retained as a redirect/backup domain.
- Frontend: React + Vite + TypeScript PWA on GitHub Pages.
- Backend: Supabase PostgreSQL, Auth, Realtime and Edge Functions.
- Map display currently uses the open tile-map path rather than Google map loads.
- Production Supabase project ref: `mwyomijlvjfllgeniqcz`.
- Supabase database is still small relative to the Free-plan 500 MB database allowance; the last measured size was about 24 MB before any full GTA address dataset was loaded.

### Namecheap DNS for `washradar.ca`

- A `@` → `185.199.108.153`
- A `@` → `185.199.109.153`
- A `@` → `185.199.110.153`
- A `@` → `185.199.111.153`
- CNAME `www` → `mc140.github.io`

GitHub Pages custom-domain HTTPS has been configured.

## Supabase Edge Functions currently used

- `ad-events`
- `admin`
- `analytics-events`
- `geo-services`
- `queue-actions`
- `wash-ingest`
- `wash-type-actions`

Temporary bootstrap/diagnostic functions should remain disabled rather than becoming part of normal production traffic.

## Authentication

Supabase Auth is configured for the production domain. Anonymous users can contribute queue information; email auth exists for users who want an account. User-owned favourites can remain local for anonymous users and sync when appropriate.

The product must not require sign-in simply to find a wash or submit a basic queue observation.

---

# Completed work

## 1. GTA wash catalogue

A broad GTA catalogue has already been imported and normalized in Supabase.

Approximate last known state:

- ~889 total saved wash locations.
- ~800 with real weekly opening hours.
- ~859 within true GTA municipalities.
- Some useful spillover locations outside the strict GTA boundary are intentionally tolerated rather than automatically deleted.
- ~188 distinct FSA prefixes across the whole catalogue.

Normal nearby browsing reads this saved catalogue. It should **not** call Google Places discovery for every user session.

### Catalogue refresh policy

Do not run another full expensive Google enrichment sweep casually.

Prefer selective refreshes:

- address/business status: infrequent/monthly or when stale/problematic;
- opening hours: roughly monthly;
- ratings: monthly or less frequently;
- wash type: only unresolved/stale locations;
- reviews/editorial fields: only unresolved locations where cheaper sources did not classify the wash.

The C$20 Google Cloud budget alert seen during development was driven primarily by one-time catalogue/detail enrichment, not by ordinary Supabase browsing.

## 2. Zero-cost normal routing

Automatic Google traffic-route calls have been removed from the normal browsing experience.

The production `geo-services` Edge Function also contains a backend guard: a `routes` request returns an empty `disabled-zero-cost` result rather than contacting Google Routes.

The UI direction is now:

- show **distance**;
- show **queue time**;
- show **wash-time estimate**;
- keep a prominent but compact **Directions** action;
- let the user's navigation app provide live traffic/ETA.

Do not present a locally derived driving estimate as if it were live traffic.

PR #12 implemented the zero-cost routing/address-search foundation.

## 3. Queue trust engine

Queue reporting is designed to accept contributions with low friction while weighting evidence carefully.

Current principles:

- fresh nearby GPS report = strong influence;
- remote report = accepted but weak influence;
- verified queue session = strongest evidence;
- evidence decays with time;
- weighted consensus/median is used;
- only the latest signal per actor/wash should materially influence the current estimate;
- remote-only reports cannot easily create a LIVE state;
- closure/unavailable status requires stronger nearby evidence.

Freshness approximately follows:

- ≤5 min: strongest;
- ≤15 min: strong;
- ≤30 min: moderate;
- ≤60 min: weak;
- older than 60 min: no live influence.

The UI must distinguish LIVE / recent / estimated / limited-data states and never convert unknown queue into zero.

Queue reports request a fresh GPS sample at submission time when possible. A blocked/coarse position does not prevent contribution; it simply reduces trust. Verified queue timers require stronger proximity/accuracy.

## 4. Wash-type trust system

Google Places structured `types` does not reliably tell us whether a wash is touchless, soft-cloth, tunnel, self-serve, hand wash, etc. WashRadar therefore has a multi-source evidence model.

Sources include:

- explicit business-name wording;
- official website;
- Google editorial summary;
- Google reviews when needed;
- nearby contributor reports;
- contributor reputation and independence.

Relevant production structures include `wash_type_evidence`, `wash_type_reports`, `car_wash_types` confidence metadata and `wash-type-actions`.

A type should be published only when confidence crosses the configured threshold. One weak/remote report should not be able to label a business definitively.

A previous enrichment run processed 250 places but initially classified none because the service role lacked SELECT on `wash_types`; that grant was repaired. The enrichment quota was then exhausted for that day. Avoid raising safety caps automatically just to finish a batch.

## 5. Real hours and safer unknown handling

Completed UI/data fixes include:

- fake/default opening-hours text removed;
- real weekly hours shown when available;
- unknown hours stay unknown;
- unknown queue stays `—` rather than `0`;
- unknown operating status is not described as a failure/outage;
- filters depending on unavailable data are disabled rather than guessed;
- stale queue signals are re-ranked locally as they age.

## 6. UI polish

Completed changes include:

- small blue **Directions** pill near queue information;
- compact Directions action on detail pages;
- contribution CTA renamed **Update queue**;
- Update queue styled for visibility;
- type-filter chips show nearby verified counts and disable zero-result categories;
- recommendation wording softens appropriately when data is incomplete.

## 7. Ads foundation

The database already supports:

- advertiser businesses;
- campaigns;
- creatives;
- placements;
- radius/city/neighbourhood/region targeting;
- dates, priority, caps and budget/pricing metadata;
- impression/click tracking.

Seeded placement concepts include:

- `explore_nearby_offer`
- `wash_detail_nearby_offer`
- `queue_wait_offer`
- `post_wash_offer`
- `sponsored_wash`

The consumer UI currently uses Explore/detail nearby-offer placements. There are no production advertisers/campaigns yet.

An `/ad-preview` page was added in PR #10 to preview fictional placements and viewability without producing real ad analytics.

Organic recommendation scoring must remain separate from paid placement eligibility.

## 8. Custom domain

PR #4 configured the custom-domain production build and CORS support for:

- `https://washradar.ca`
- `https://www.washradar.ca`
- legacy GitHub Pages origin where needed.

---

# Address autocomplete strategy

## Goal

A GTA user should be able to type a home/street address and see a Google-like dropdown **without a paid autocomplete API**.

## Chosen source

Use Statistics Canada's **National Address Register (NAR)** as the canonical free/open address source for GTA civic addresses and coordinates.

## Preferred architecture

Do **not** put millions of household/building address rows into the main Supabase database unless there is a compelling reason.

Preferred architecture:

1. Download the NAR release during a controlled build/update workflow.
2. Filter to GTA municipalities.
3. Keep one useful record per physical building rather than duplicating apartment units that share the same routing origin.
4. Normalize addresses and coordinates.
5. Partition the resulting autocomplete index into small static chunks.
6. Publish those chunks through GitHub Pages with the PWA.
7. Load only the relevant chunk(s) in the browser as the user types.
8. Resolve city/postal area locally first.
9. Use Google Geocoding only as a rare fallback.

Advantages:

- $0 per address-autocomplete search;
- almost no Supabase quota consumed by autocomplete;
- no Google Places Autocomplete dependency;
- coordinates are already present in NAR;
- easy to cache in browser/CDN;
- address source can be refreshed periodically without affecting queue data.

## Supabase address foundation

`address_points`, `address_import_state` and an `address_suggestions(...)` RPC were prepared earlier as a fallback/server-side option, but the preferred production direction is now static partitioned files. Do not bulk-load all GTA civic addresses into Supabase unless the static architecture proves inadequate.

Google geocode cache no longer needs to retain the raw normalized address string. Hash + coordinates are sufficient for fallback caching; raw-query retention was removed to reduce unnecessary address data storage.

---

# CURRENT BLOCKER — address autocomplete deployment

PR #13 **was merged** and contains the zero-cost GTA address autocomplete implementation.

The GitHub Pages deployment then failed specifically at:

> **Build zero-cost GTA address autocomplete index**

Important details for the next session:

- The Statistics Canada NAR download step **succeeded**.
- The failure occurred in the **index-generation Python step**.
- Because that build step failed, the normal static PWA build/deployment was skipped for that workflow run.
- Quality checks for PR #13 passed before merge.
- The workflow run to inspect is `34313873634` and the failed build job was `102345897680`.
- The relevant builder is `scripts/build_gta_address_index.py`.
- The relevant workflow is `.github/workflows/pages.yml`.
- Fix this build/index-generation failure before considering the address autocomplete feature complete in production.

Do not restart the address-autocomplete design from scratch. The architecture and frontend foundation already exist; debug the current generator/workflow.

---

# Near-term implementation roadmap

Priority order:

1. **Fix the PR #13 Pages failure** in `scripts/build_gta_address_index.py` / the NAR archive parsing path.
2. Confirm generated GTA address index size, address count and partition count.
3. Confirm `washradar.ca` serves the generated address chunks and autocomplete dropdown on mobile.
4. Test real GTA household addresses across Toronto, Peel, Halton, York and Durham.
5. Confirm selecting an autocomplete result updates the origin without calling Google Geocoding.
6. Keep Google Geocoding only as fallback and add usage telemetry that distinguishes `local-address`, `local-area`, `cache` and `google-fallback` without storing raw house searches.
7. Continue freezing expensive full-catalogue Google enrichment; refresh only stale/unresolved records.
8. Re-run wash-type enrichment only after daily quota resets and validate that classifications are now being stored.
9. Conduct physical iPhone Safari/Chrome and Android testing for GPS, autocomplete, queue reports, PWA install and deep links.

---

# Future roadmap

## Consumer experience

- Better queue density and coverage as more users contribute.
- More useful historical queue expectations by hour/day only after enough samples exist.
- Better recommendation explanation: e.g. "3 km farther, but ~15 min less queue" without pretending to know live traffic.
- Optional alerts when a favourite wash queue drops below a threshold.
- Stronger PWA install/onboarding polish.
- Accessibility and mobile performance hardening.

## Data quality

- Periodic selective business-hours/status refresh.
- Owner/business verification for corrections.
- Contributor reputation maturation.
- Better conflict handling for wash-type and price reports.
- Automatic retirement/review of stale wash listings.

## Address/search

- Periodic NAR release refresh workflow.
- Static index versioning and cache invalidation.
- Efficient fuzzy/prefix matching without loading large datasets into memory.
- Canada-wide expansion by province/metro only after GTA proves the model.

## Advertising/business model

Future advertiser work can include:

- self-service advertiser onboarding;
- address geocoding for campaign centre;
- map/radius selector;
- radius-based pricing calculator;
- payments/invoices;
- campaign approval workflow;
- queue-wait and post-wash placements where tasteful.

Radius pricing should increase more than linearly as reach expands because geographic area grows roughly with radius squared.

## Expansion

After GTA product/queue density is validated, expand incrementally to other Canadian metros rather than importing all of Canada at once.

---

# Architecture

```text
GitHub Pages (React + Vite PWA)
        |
        +-- static app shell / service worker
        +-- static GTA address autocomplete chunks (NAR)
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

Directions button --> user's Google Maps / Apple Maps app
                    (live traffic/ETA handled outside WashRadar)
```

The browser contains only public configuration. Service-role credentials, Google server key, device hash salt and admin allowlist remain server-side Supabase secrets.

Main source folders:

- `src/domain` — ranking, queue estimation, confidence and config.
- `src/services` — provider-neutral repositories, Supabase adapter, location/search/analytics.
- `src/components`, `src/pages` — user, reporting, map, profile/admin UI.
- `supabase/migrations` — schema, RLS, indexes and RPCs.
- `supabase/functions` — privileged validation/enrichment/actions.
- `scripts/build_gta_address_index.py` — Statistics Canada NAR → static GTA autocomplete index.
- `.github/workflows` — CI and Pages deployment.
- `tests`, `e2e` — automated coverage.

---

# Recommendation model

The old idea of making `drive + queue + wash = done in` the primary promise is no longer the preferred product model because WashRadar intentionally stopped buying live traffic-route data.

The primary ranking should rely on trustworthy data we own/control:

- distance;
- queue time/confidence;
- wash duration estimate;
- open/closed status;
- type preference;
- price/rating when available;
- uncertainty penalties.

Distance-derived drive time may exist internally as a rough heuristic but must be labelled as an estimate and must not be described as traffic-aware.

The user's navigation app is the source of truth for actual traffic/ETA after **Directions** is selected.

---

# Maps, Google APIs and cost controls

## Normal user session

A normal GTA session should ideally require no billable Google call:

| User action | Intended source |
|---|---|
| Open app | GitHub Pages + Supabase |
| Use current location | Browser GPS |
| Find nearby washes | Supabase catalogue |
| Calculate distance | Local math |
| Type/select GTA address | Static NAR index |
| View queue | Supabase |
| Submit queue | Supabase Edge Function |
| Submit wash type | Supabase Edge Function |
| Directions | User's maps app |

## Google usage that may remain

- rare address geocode fallback;
- deliberate admin Places discovery;
- selective Place Details refresh/enrichment.

## Cost safety

- Keep Google Cloud budget alerts enabled.
- Keep provider/app quotas conservative.
- Do not silently raise enrichment quotas to make a batch finish.
- Cache reusable geocode results.
- Prefer official/open static datasets whenever they can replace per-request APIs.

---

# Supabase usage philosophy

The free plan is expected to be sufficient for the beta/initial launch if the app remains efficient.

Watch:

- database size;
- monthly active users;
- egress;
- Edge Function invocations;
- Realtime messages/connections;
- Storage only if images/ad creatives are added.

Queue history can eventually grow much more quickly than the wash catalogue. When necessary, retain detailed recent signals for a bounded period and aggregate older history by wash/time bucket rather than retaining unlimited raw events forever.

Do not use Supabase database space for huge static national address datasets when GitHub Pages/CDN static partition files solve the same problem more cheaply.

---

# Advertising principles

Ads are monetization, not ranking.

Rules:

- paid placements must be clearly labelled;
- sponsored eligibility must not alter the organic best-wash score;
- frequency caps should prevent domination;
- geo targeting should be explicit and bounded;
- consumer usefulness should stay ahead of advertiser density.

---

# Local development

Requirements: Node.js 22.13+ and npm.

```bash
git clone <repository-url>
cd washradar
npm ci
cp .env.example .env.local
npm run dev
```

Quality commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Production deploys use GitHub Actions and `VITE_BASE_PATH=/` for `washradar.ca`.

---

# Environment variables

Variables beginning with `VITE_` are public browser configuration.

| Variable | Purpose |
|---|---|
| `VITE_DEMO_MODE` | Local fictional demo vs production data. |
| `VITE_BASE_PATH` | `/` for custom-domain production. |
| `VITE_SUPABASE_URL` | Public Supabase project URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public browser key protected by RLS. |
| `VITE_MAP_TILE_URL` | Optional open tile provider. |
| `VITE_MAP_ATTRIBUTION` | Required attribution for tile provider. |
| `VITE_SUPPORT_EMAIL` | Support address. |

Server-side Supabase secrets include values such as:

- `GOOGLE_MAPS_SERVER_KEY`
- `DEVICE_HASH_SALT`
- `ADMIN_EMAILS`
- `ALLOWED_ORIGINS`
- provider quota limits.

Never put a Supabase service-role key in the repository or frontend configuration.

---

# PWA and GitHub Pages

The PWA uses a service worker, static app shell and a `404.html` SPA fallback for deep links.

Production workflow: `.github/workflows/pages.yml`.

Remember that PR #13 added NAR-address-index generation to that workflow. Until the current generator failure is fixed, production deploys containing that step can fail before the Vite build.

---

# Monitoring

- **Supabase:** monitor database, egress, MAU, Edge invocations and Realtime usage.
- **Google Cloud:** budget alerts + per-API quotas.
- **GitHub Actions:** monitor CI/Pages failures and address-index cache behavior.
- **Application:** keep analytics privacy-conscious; avoid storing raw home-address searches unnecessarily.

---

# Troubleshooting / known gotchas

- **Pages deploy fails before Vite build:** inspect `Build zero-cost GTA address autocomplete index`; current known blocker is NAR index generation after a successful download.
- **No autocomplete dropdown:** confirm `public/address-index` generated chunks/manifest exist in the deployed site; fallback city data alone does not provide full household autocomplete.
- **No production washes:** verify Supabase config/RLS and `nearby_washes_json` rather than re-running full Google import immediately.
- **Queue report rejected/low-trust:** check anonymous auth, fresh GPS accuracy and proximity rules.
- **Magic-link wrong route:** verify exact `https://washradar.ca/auth/confirm` redirect.
- **Map unavailable:** verify the open tile-provider configuration/terms.
- **Wash-type enrichment yields zero:** verify service-role grants and daily provider quota before rerunning.

---

# Decisions that should not be accidentally reversed

1. **Do not restart the project.** Continue the existing repository, database and production deployment.
2. **Do not re-enable automatic Google Routes for normal browsing.** Traffic belongs in the user's navigation app.
3. **Do not treat unknown queue as zero.**
4. **Do not make an account mandatory for basic browsing/contribution.**
5. **Do not let ads influence organic ranking.**
6. **Do not bulk-run expensive Google enrichment without a clear need.**
7. **Do not store millions of GTA household addresses in Supabase by default.** Prefer static NAR partitions on GitHub Pages.
8. **Do not restart the NAR autocomplete implementation from scratch.** Fix the current PR #13 build/index-generation failure.
9. **Do not invent prices, wash types, hours or queue values when source data is missing.**

---

# Recent milestone PRs

- **PR #4** — production custom-domain configuration.
- **PR #10** — ad placement preview page.
- **PR #12** — zero-cost routing/address-search foundation; removes automatic Routes dependence.
- **PR #13** — zero-cost GTA address autocomplete foundation using Statistics Canada NAR; merged, but its first Pages deployment failed during address-index generation and still needs debugging.

This README should be updated whenever a major architectural decision, completed milestone, current blocker or future roadmap item changes so a new chat/session can continue without reconstructing project history.
