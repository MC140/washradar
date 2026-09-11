# WashRadar

WashRadar is a mobile-first car-wash discovery product that helps drivers answer:

> **Where should I wash my car right now?**

Its differentiated value is **queue intelligence + trustworthy wash information**. Normal browsing focuses on distance, cars ahead, estimated wait, wash duration and queue + wash total time. Live traffic and turn-by-turn routing belong in the user's Google Maps / Apple Maps app.

**Production:** https://washradar.ca  
**Repository:** `MC140/washradar`  
**Supabase:** `mwyomijlvjfllgeniqcz` — Canada Central

---

## READ THIS FIRST — project handoff

Before substantive WashRadar work:

1. Read current `main` and this README.
2. Check the newest merged/open PRs and compare them with this handoff.
3. Check the latest **Deploy WashRadar to Cloudflare Pages**, quality, production-audit and synthetic-user runs.
4. Read `docs/AUTH.md` before auth/account work.
5. Read `docs/SCALING.md` before capacity work.
6. Read `docs/MONETIZATION.md` before changing ads, pricing, placements or advertiser packages.
7. Read `docs/DATA_MODEL.md` before changing durable product data or location persistence.
8. Treat GitHub `main`, production Supabase, GitHub Actions, Cloudflare Pages and observed production behavior as final truth.

Do not restart old/superseded work merely because it appears in historical notes.

---

# Current production baseline — PR #56

**PR #56 — Finalize Cloudflare Pages production cutover** is the current production-infrastructure baseline.

The current functional product baseline remains the feature set introduced through PR #52, with the hosting cutover layered on top:

- PR #48 — pre-native hardening;
- PR #49 — map cleanup, clustering and `Search this area`;
- PR #50 — structured first-party WashRadar Ratings;
- PR #51 — hyperlocal local-business ad inventory;
- PR #52 — durable GPS/manual/map location persistence, readable monetization/data-model docs and server-configurable ad inventory limits;
- PR #54 — validated Cloudflare Pages deployment pipeline running alongside GitHub Pages during cutover;
- PR #55 — production audits and synthetic-user runs switched to trigger from Cloudflare Pages deployments;
- PR #56 — old GitHub Pages deployment workflow and GitHub-only `public/CNAME` retired after both `washradar.ca` and `www.washradar.ca` became active on Cloudflare Pages.

Before the final GitHub Pages cleanup, the Cloudflare production deployment passed static-search checks, synthetic user flows, location persistence, map / `Search this area`, structured ratings and the live read-only production browser audit.

Cloudflare Pages is now the intended production web host. GitHub remains the source repository and CI/CD control plane; Supabase remains the application backend.

---

# Core product objective

WashRadar should feel like a GasBuddy-style discovery product for car washes, but timing is the central value:

- How far is the wash?
- How many cars are ahead?
- How long will I actually wait?
- How long will queue + wash take?

Queue/wash timing stays ahead of secondary catalogue information in the UI.

## Result-card hierarchy

1. Estimated wait — primary.
2. Cars ahead — supporting queue evidence.
3. Distance — compact and secondary.
4. `Queue + wash · ~X min` — clearly separate from drive time.
5. Compact actions such as `Details` and WashRadar-green `Update queue`.

Avoid making one large number dominate the whole card unnecessarily.

---

# Location and search continuity

A selected browsing area now survives refresh for **all three location paths**:

- `Use my location` / GPS;
- manual city, postal-code or full-address search;
- map `Search this area`.

The durable device key is `wr-selected-location-v2` and records a label, point, source (`gps`, `manual`, `map`) and save time.

GPS is persisted only as a reduced-precision **browsing origin**. On a later reload it is shown as **Last location** and is **not** treated as fresh verified GPS. Queue submissions and verified wait timers still request a fresh device location when verification matters.

A valid restored location suppresses the first-use location intro instead of asking the user again after refresh. The old manual-only key is migrated forward for existing users.

The selected sort also persists across refresh.

Primary sort choices remain:

- Recommended
- Shortest wait
- Nearest
- Lowest price, when verified price data exists

---

# Queue trust and timing

Evidence ordering remains:

1. verified completed wait session;
2. fresh nearby GPS report;
3. older/less-precise nearby report;
4. remote report.

Remote evidence is deliberately weak and cannot by itself create a strong `LIVE` queue state.

Queue buckets are `NO QUEUE`, `1–3`, `4–7`, `8–12`, and `12+`. The backend maps a bucket to a representative car count and combines it with the wash's minutes-per-car model. Evidence freshness decays and expires rather than pretending the line continuously shrinks.

`Update queue` is the primary low-friction community action. `Start wait timer` is optional and intended for drivers physically at the wash who want to contribute a stronger observed wait sample.

---

# Structured WashRadar Ratings

Wash Details includes a separate first-party ratings section after timing/pricing context.

- Overall 1–5 rating required.
- Wash quality, value and equipment optional.
- Up to three predefined tags/highlights.
- No free-text reviews in the current release.
- One rating per contributor per wash; resubmission edits/upserts.
- `Verified visit` is server-derived from existing nearby/verified evidence and cannot be self-selected.
- Public reads expose aggregates, not reviewer identity.

Do not add unrestricted written reviews until moderation, reporting/blocking and UGC-policy work is deliberately implemented.

---

# Hyperlocal sponsored businesses

The current monetization direction is **free for drivers + optional paid local-business visibility**.

Paid placement is always separate from organic wash truth. An advertiser can buy visibility, not a fake recommendation, shorter wait, higher rating or stronger confidence.

## Current paid v1 model

- targeting: coordinate + radius only;
- default commercial package: **C$100 CAD/month**;
- default radius: **5 km** around the verified business address;
- normal frequency cap: **3 impressions/day per WashRadar device/session per campaign**;
- one visible slot per advertiser/business in a single request;
- clearly labelled `Sponsored` / `Nearby offer`;
- impression + click tracking;
- manual advertiser onboarding; no WashRadar account required for early advertisers.

The business supplies only business name, full address, category, destination/booking/offer link, offer/message, and private contact name/email/phone. Logo/image is optional. WashRadar handles coordinates, targeting, creative formatting, disclosure and tracking. See `docs/ADVERTISER_INTAKE.md`.

## Current visible inventory

Production has these ad-placement records:

- `explore_nearby_offer` — **live UI, max 5 visible**;
- `wash_detail_nearby_offer` — **live UI, max 1 visible**;
- `queue_wait_offer` — reserved, not automatically surfaced;
- `post_wash_offer` — reserved, not automatically surfaced;
- `sponsored_wash` — reserved, not automatically surfaced.

There are currently no real advertiser campaigns seeded merely for testing.

## Future-proof inventory model

`ad_inventory_settings.max_visible` is now server-owned per placement. Explore is currently 5 and Details is 1, but a future business decision such as **5 → 8** can be made in server configuration without a client release, within the defensive transport ceiling.

Businesses that later buy more visibility should receive more **rotation/reach**, not duplicate cards in the same request. Existing `priority`, placement `weight`, radius, frequency cap, campaign dates and approved placement links are the intended building blocks for future Boosted / Expanded / Premium packages.

Do not use sponsored map pins by default; keep the map focused on wash discovery/timing unless later evidence justifies a separate design.

`docs/MONETIZATION.md` is the durable readable commercial model. Update it in the same release whenever pricing, radius, visible inventory, package tiers, placements or sponsorship rules materially change.

---

# Readable data-model memory

`docs/DATA_MODEL.md` is the human-readable map of the current product data model and should stay synchronized with schema/product changes.

Major domains include:

- wash catalogue, hours, types, packages and amenities;
- queue reports, queue sessions, derived estimates and trust/freshness;
- guest/permanent auth continuity, profiles, vehicles, favourites and queue targets;
- Radar Points/challenges;
- structured WashRadar Ratings;
- advertiser businesses, campaigns, radius targets, creatives, placements, inventory settings, impressions and clicks;
- device-local selected location, filters and sort state.

Supabase migrations/RLS/RPCs remain the schema/security source of truth; `DATA_MODEL.md` is the readable operating reference.

---

# Auth / friends-beta model

- Browsing is guest-first; login is not required for normal discovery.
- Guest contributions are supported.
- Email/password accounts are active.
- Minimum password length is 8 characters.
- Confirm-email is off for the friends beta.
- Google OAuth remains hidden in the UI.
- Apple sign-in is not exposed.
- Self-service account deletion exists.
- Forgot-password recovery stays hidden until reliable public SMTP is configured.
- Guest contribution continuity to permanent accounts is supported for the intended contribution history; anonymous reputation/points are intentionally not blindly transferred.

Admin-focused work remains secondary until operational need exists.

---

# Routing, maps and address-cost architecture

Normal browsing must remain inexpensive:

- Google traffic Routes are disabled.
- Distance is calculated without paid Google routing.
- Directions hands off to the user's Maps app for live traffic/ETA.
- Postal/FSA search uses static data.
- Full GTA address autocomplete uses the Statistics Canada Ontario Open Database of Addresses (ODA) static partitioned architecture from PR #16.
- Large public address datasets should stay outside Supabase when possible.
- Map-area search reuses coordinates and nearby lookup; it does not require paid geocoding.

The failed PR #13 National Address Register path is obsolete. Do **not** restart NAR debugging by default, move millions of household addresses into Supabase, or re-enable paid Google Routes for normal browsing.

OpenStreetMap-derived map tiles are fine for early testing when policy-compliant. At larger commercial traffic, use a proper hosted tile provider or own infrastructure rather than assuming the public OSM tile service is unlimited production infrastructure.

---

# Current architecture

```text
GitHub — source code + pull requests + GitHub Actions
        |
        +-- build zero-cost postal/FSA index
        +-- restore/build static GTA ODA address index
        +-- build React + Vite PWA into dist/
        |
        +-- deploy dist/ to Cloudflare Pages
                     |
                     +-- static app shell
                     +-- static postal/FSA + GTA ODA address indexes
                     +-- CDN + TLS + production custom domains
                     |
                     +-- Supabase Auth
                     +-- Supabase Postgres + PostGIS + RLS
                     +-- RPCs/triggers for nearby lookup, queue, ratings, rewards and ads
                     +-- Edge Functions for protected writes/actions and ad events

Cloudflare DNS / Pages --> https://washradar.ca + https://www.washradar.ca
Cloudflare Email Routing --> support/contact aliases to the configured destination inbox
Directions --> Google Maps / Apple Maps on the user's device
```

Key docs:

- `docs/MONETIZATION.md` — ad/business model and change rules.
- `docs/DATA_MODEL.md` — readable data-model reference.
- `docs/ADVERTISER_INTAKE.md` — business onboarding checklist.
- `docs/AUTH.md` — account/auth security model.
- `docs/SCALING.md` — capacity/upgrade runbook.
- `docs/NATIVE_ARCHITECTURE.md` — Capacitor native direction.
- `docs/NATIVE_RELEASE_CHECKLIST.md` — native release gates.
- `docs/NATIVE_GATES.md` — native go/no-go criteria.

---

# Native direction

Do not rewrite WashRadar in React Native for v1. The intended path is to wrap the existing React/Vite product with **Capacitor** and reuse its ranking, queue logic, Supabase APIs, UI and ODA search foundation.

Native work must cover foreground geolocation/permission state, lifecycle/resume restoration, secure auth/session storage, auth deep links, Maps handoff, ODA remote fetch/cache, safe areas/status/navigation integration and physical iPhone/Android testing. Always-on background GPS is not required. True background push can remain a later feature unless product scope changes.

Recommended app identifier remains `ca.washradar.app` for iOS and Android unless a concrete store decision changes it before publication.

---

# Testing / release gates

Do not treat a merge alone as production proof. A release should be considered healthy only after the relevant candidate checks, main quality run, **Cloudflare Pages deployment**, post-deploy production audit and post-deploy synthetic-user suite are green.

The synthetic suite includes normal-user browsing, manual search, location denial recovery, map behavior, structured ratings and selected-location persistence across refresh.

For queue trust, still perform real-device / real-wash testing, especially:

`Find wash → inspect wait/cars ahead → Update queue → optionally Start wait timer → verify another device sees the updated queue/timing.`

---

# Next recommended phase

With the web baseline hardened through PR #56 and production hosting moved to Cloudflare Pages, the highest-value next phase remains **real-user mobile testing at actual wash locations**, followed by the Capacitor iOS/Android foundation once the physical queue flow is trusted.

Keep the product focused: **distance + cars ahead + wait + wash time** first; secondary features and monetization should not dilute that decision experience.
