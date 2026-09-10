# WashRadar

WashRadar is a mobile-first PWA that helps drivers answer:

> **Where should I wash my car right now?**

Its differentiated value is **queue intelligence + trustworthy wash information**, not navigation. Live traffic and turn-by-turn routing belong in the user's Google Maps / Apple Maps app.

**Production:** https://washradar.ca  
**Repository:** `MC140/washradar`  
**Supabase:** `mwyomijlvjfllgeniqcz` — Canada Central

---

## READ THIS FIRST — project handoff rules

Before doing project work:

1. Read current `main`.
2. Check the newest merged and open PRs.
3. Compare those PRs with this README; if the README is stale, update it before relying on old handoff notes.
4. Check the latest **Deploy WashRadar to GitHub Pages** workflow plus the latest production/synthetic-user audits.
5. Read `docs/AUTH.md` for account work.
6. Read `docs/SCALING.md` for capacity work.
7. Treat GitHub `main`, the production Supabase schema, GitHub Actions and observed production behavior as final source of truth.

Do not restart old/superseded work merely because it appears in historical notes.

---

# Current production baseline — 2026-09-10

Production runs `main` through **PR #49**.

- **PR #45** is the last large result-card/search-persistence feature release before native hardening.
- **PR #46** is a documentation-only follow-up.
- **PR #47** added the read-only synthetic normal-user testing agent.
- **PR #48** is the **pre-native production-hardening baseline**. It added self-service account deletion, true HTTP-200 app-route entry points, guest-network cleanup, optional verified wait-timer wording/behavior, mobile/native hardening, native-ready address-index configuration and stronger candidate-build regression testing.
- Direct commit `d8ba61a…` aligned the older production audit with the new **Start wait timer** wording.
- **PR #49** cleaned the map UX, added overlap clustering and added explicit **Search this area** / persisted pinned-map-origin browsing. It also added a dedicated regression agent for the map behavior and removed the Pixel-emulation intro-sheet click flake from the older production audit.

PR #49 merged at `4936e3eb…`. Its exact candidate head passed quality and synthetic checks before merge. After merge, the `main` quality run, GitHub Pages deployment, post-deploy synthetic agent and post-deploy production Playwright audit all completed successfully. The production synthetic agent explicitly verified the new map-marker and **Search this area** journey.

This is the production baseline to use before beginning the Capacitor iOS/Android foundation.

---

# Friends-beta account model

The current friends-beta auth surface is intentionally simple:

- browsing and basic queue contributions remain guest-first;
- email + password is the visible account method;
- minimum password length is **8 characters**;
- no forced upper/lower/number/symbol composition rule;
- no duplicate confirmation-password field;
- password-manager/iCloud Keychain/browser-generated passwords are supported;
- Supabase **Confirm email is OFF** for the friends beta, so new accounts can be created and signed in immediately without waiting for email;
- Google OAuth remains configured in the backend but its button is **hidden** in the friends-beta UI;
- Apple sign-in is not exposed;
- signed-in users can set/change their password from Profile;
- forgot-password email recovery is intentionally hidden until reliable public SMTP is configured;
- self-service account deletion is available and `/account-deletion` exists as a public resource;
- the shared Supabase session persists across routes/refreshes until sign-out/session invalidation;
- guest contribution history can be securely merged into a permanent account through the claim flow.

### Anonymous → permanent account continuity

When a guest contributor signs into an existing permanent account, WashRadar can transfer queue reports, wash-type reports, queue-session history and visible contribution counters.

It intentionally does **not** transfer anonymous Radar Points, anonymous reputation/trust score, or an active wait timer. Merge claims are device-held and valid for **24 hours**.

### Remaining account work before broad public launch

1. Configure **custom SMTP** for reliable password reset/recovery and optional email verification.
2. Enable Supabase **Leaked Password Protection** when the project plan supports it.
3. Decide whether to expose Google sign-in publicly; backend Google OAuth is configured but currently hidden.
4. Add CAPTCHA/Turnstile if signup or anonymous-auth abuse becomes material.

SMTP is intentionally **not** a blocker for starting the Capacitor iOS/Android phase. Do not re-enable password-reset UI until email delivery is reliable.

---

# Explore, map and card UX

## Location continuity

A successful **manual city, postal-code or street-address search is stored locally on that device**. Refreshing or reopening WashRadar restores the same searched area and results.

Manual search coordinates are not treated as verified GPS. If the user later chooses **Use my location** and a fresh GPS fix succeeds, the saved manual/pinned area is cleared and current GPS becomes the active origin. If GPS fails while a manual area is active, WashRadar keeps the working manual area.

Map browsing follows the same model. Panning itself does not fire queries. After the user moves the map, **Search this area** explicitly promotes the map center to the active search origin. That pinned map area persists across refresh until the user chooses another manual search or **Use my location**.

## Quick sorting

The primary choices are:

- **Recommended** — WashRadar's trust-aware recommendation score;
- **Shortest wait** — lowest known queue wait, with unknown queue data sorted last;
- **Nearest** — physical distance from the selected origin;
- **Lowest price** — shown only when price data is available.

The selected sort persists across refresh. `Fastest Total Time` is not a prominent quick-sort choice because normal browsing does not use paid/live route traffic.

## Result-card hierarchy

Result cards intentionally make **wait time the primary decision number** and **cars ahead supporting evidence**.

Current hierarchy:

1. estimated wait;
2. cars ahead / queue evidence;
3. distance;
4. `Queue + wash · ~X min` as the at-location total;
5. `+ drive time` separately;
6. compact `Details` + `Update queue` actions.

Wait colors are semantic: **green 0–15 min**, **amber 16–39 min**, **red 40+ min**, neutral for unknown. Freshness color separately reflects report age.

**`Update queue` stays WashRadar green** regardless of wait severity because it represents the contribution action rather than congestion severity.

## Map-marker principle

The map is a discovery layer, not a place to expose uncertainty as error-like punctuation.

- Known queue/wait evidence may show a wait-minute number.
- Unknown timing is a neutral marker, not `?`.
- Closed/unavailable listings are visually subdued, not `×`.
- Dense nearby listings cluster into numeric count markers; choosing a cluster zooms in.
- Tapping a single wash marker opens its existing preview/details.
- Panning reveals **Search this area** instead of automatically replacing the user's location.
- The center target shows the prospective search point before the user commits it.
- The map reset control returns the viewport to the active search origin.

The production map regression agent checks that `?`/`×` wash markers do not return, that marker selection works, that **Search this area** changes the active origin and that the pinned area survives reload.

---

# Queue trust and timing

General evidence ordering:

1. verified completed wait session;
2. fresh nearby GPS report;
3. older/less-precise nearby report;
4. remote report.

Remote evidence is deliberately weak and cannot by itself create a strong `LIVE` queue state. Rapid duplicates/excessive reporting are rate-limited or deduplicated server-side.

Queue buckets are `NO QUEUE`, `1–3`, `4–7`, `8–12`, and `12+`. The backend maps each bucket to a representative car count and combines it with the wash's minutes-per-car model. It does **not** fake a continuously decreasing car count after a report. Evidence freshness decays and expires.

Open clients normally receive another user's accepted queue update within roughly **20 seconds plus jitter**; the submitting client refreshes immediately after a successful write.

## Update queue vs Start wait timer

These are intentionally different contribution types:

- **Update queue** is the primary, low-friction community action. It helps other drivers immediately by reporting the current cars-ahead/queue bucket.
- **Start wait timer** is optional and only for someone physically at the wash. It collects a stronger observed actual-wait sample.

WashRadar must not depend on every user running a timer. Many quick queue reports plus occasional verified completed waits is the intended data model.

---

# Radar Points and Challenges

Radar Points are a retention/reward system, **not** a trust score.

| Contribution | Base points |
| --- | ---: |
| Nearby queue update | 20 |
| Verified completed wait | 75 |
| Nearby wash-type confirmation | 15 |
| Remote report | 0 |

Base contribution points are capped at **200/day**. Challenge bonuses are one-time/idempotent.

Challenges:

- **First Radar** — first nearby queue update — +100.
- **Queue Scout** — update 3 different nearby washes — +250.
- **Verified Wait** — complete a verified **Start wait timer** session — +500.
- **Wash Detective** — nearby wash-type confirmation — +150.
- **3-Day Contributor** — contribute on 3 different days — +300.
- **Local Hero** — help update 5 different nearby washes — +750.

Challenge progress is derived server-side from contribution history and rewards cannot be repeatedly farmed after completion.

---

# Current architecture

```text
GitHub Pages (React + Vite PWA)
        |
        +-- app shell / service worker
        +-- static postal/FSA data
        +-- static GTA ODA address chunks
        +-- device-local manual/pinned search + filter/sort preferences
        |
        +-- Supabase Auth
        |     +-- guest/anonymous identity
        |     +-- email + password
        |     +-- Google OAuth configured but hidden in beta UI
        |     +-- signed-in password change
        |     +-- self-service deletion
        |     +-- email recovery deferred until SMTP
        |
        +-- Supabase Data API / RLS
        |     +-- canonical washes / hours / types
        |     +-- queue reports / estimates
        |     +-- profiles / vehicles
        |     +-- challenges / progress / points
        |     +-- favourites / queue targets
        |
        +-- queue freshness
        |     +-- DEFAULT: visible-tab polling of queue_signal_feed
        |     +-- OPTIONAL: Supabase Realtime by config
        |
        +-- Supabase RPCs/triggers
        |     +-- nearby spatial lookup
        |     +-- queue signal feed
        |     +-- direct wash detail
        |     +-- contribution rewards/challenges
        |     +-- account/anonymous-history helpers
        |
        +-- Supabase Edge Functions
              +-- account-actions
              +-- queue validation/sessions
              +-- geocode fallback
              +-- controlled Places ingestion
              +-- wash-type evidence
              +-- ads/analytics
              +-- protected admin/moderation

Directions --> Google Maps / Apple Maps on the user's device
```

Main folders:

- `src/domain` — ranking, queue estimation, confidence, contributor config.
- `src/services` — repositories, Supabase adapter, search, auth/community, analytics and queue refresh.
- `src/components`, `src/pages` — UI.
- `src/state` — app state plus device-local location/filter/sort continuity.
- `supabase/migrations` — schema/RLS/indexes/RPCs/triggers.
- `supabase/functions` — privileged actions/enrichment.
- `scripts` — static index generators, synthetic agents and scale-smoke tooling.
- `.github/workflows` — CI, Pages deployment, post-deploy audit, synthetic user and scale smoke.
- `release-tests` — production Playwright user journeys.
- `docs/AUTH.md` — account/auth security model.
- `docs/SCALING.md` — capacity/upgrade runbook.
- `tests`, `e2e` — deterministic/browser coverage.

---

# Cost architecture

Normal browsing is designed to avoid paid Google routing traffic:

- GPS — browser/phone geolocation — $0 to WashRadar.
- Distance — local calculation — $0.
- Queue — dynamic Supabase data.
- Postal/FSA search — static generated index — $0/search.
- Street/house autocomplete — static partitioned open-address files — $0/search.
- Map-area search — coordinate-based nearby lookup; no geocode required.
- Traffic/ETA — user's Maps app after Directions — $0 to WashRadar.
- Google Routes — disabled for normal browsing.
- Google Places — administrative catalogue maintenance/enrichment only.
- Google Geocoding — exceptional fallback.
- Password login — no email send.
- Friends-beta signup — no email confirmation while Confirm email is OFF.
- Forgot-password recovery — deferred until public SMTP is configured.

### Address architecture — do not regress

The failed PR #13 NAR path has been superseded. PR #16 moved address autocomplete to Statistics Canada's Ontario Open Database of Addresses (ODA) and a static partitioned index served by GitHub Pages.

Do not return to NAR debugging by default, put millions of household addresses into Supabase, or make address-index generation a production deployment blocker without a new concrete reason.

---

# Scale posture

Production queue freshness defaults to visible-tab adaptive polling. Default interval is about 20 seconds plus jitter; hidden tabs do not poll. Realtime remains optional through `VITE_QUEUE_REFRESH_MODE=realtime`.

The first production scale smoke on Supabase Free ran at **20 concurrent / 200 reads** with **0 failures**, p50 ~640 ms, p95 ~1.93 s and p99 ~2.00 s. Treat that as an early baseline, not a maximum-capacity claim.

Free → Pro should remain a capacity/billing change rather than an application rewrite.

---

# Current infrastructure

- Frontend: React + Vite + TypeScript PWA.
- Hosting: GitHub Pages.
- Primary domain: `washradar.ca`.
- Backend: Supabase PostgreSQL, Auth, Data API, optional Realtime and Edge Functions.
- Map display: open tile-map path for normal browsing.
- Approximate catalogue: ~889 saved wash locations, GTA-first with useful spillover.

Active Edge Functions include: `account-actions`, `ad-events`, `admin`, `analytics-events`, `geo-services`, `queue-actions`, `wash-ingest`, `wash-type-actions`.

---

# Pre-native / native release sequence

The web architecture does not need to be rewritten for iOS/Android. The intended native path is **Capacitor** around the existing React/Vite/Supabase application.

Before store submission, native-specific work still includes:

- Capacitor iOS/Android projects and signing;
- platform geolocation and app lifecycle/resume behavior;
- secure native session/token storage where practical;
- deep links and Maps handoff;
- safe-area/status-bar/native shell polish;
- optional APNs/FCM push if queue alerts are included in native v1;
- production crash telemetry;
- physical iPhone/Android accessibility/lifecycle testing;
- controlled two-device and real-wash transaction testing.

SMTP/password-recovery delivery can remain deferred until wider release and is **not** required merely to begin the native projects.

---

# Near-term priorities

1. Test the complete **Find wash → inspect wait/cars ahead → Update queue → optional Start wait timer → verify updated queue/timing** loop with multiple independent real sessions at an actual wash.
2. Begin the Capacitor iOS/Android foundation from the verified PR #49 production baseline.
3. Preserve the current map interaction in native: tap markers for detail and explicitly **Search this area** after panning.
4. Keep Google Routes disabled for normal browsing and keep ODA address data static/outside Supabase.
5. Configure SMTP, leaked-password protection, public social login, native push and crash reporting when their release phase requires them rather than prematurely coupling them to the native foundation.

---

# Pull-request history

| PR | Status | Current meaning |
| --- | --- | --- |
| #1–#12 | Merged | Core timing, queue reporting/trust, catalogue and zero-cost routing foundations |
| #13–#17 | Mixed | Address-index iterations; current implementation is ODA-based from #16 |
| #18–#22 | Merged | Runtime optimization and unified postal/address search |
| #23–#24 | Merged | Handoff/history documentation |
| #25–#31 | Merged | Profiles, points/challenges, vehicles, auth persistence, scale architecture |
| #32–#33 | Merged | Password/social foundation and 24-hour anonymous merge claim |
| #34 | Draft / open | Old temporary friend-release browser audit; review/clean up, do not treat as release blocker by default |
| #35–#41 | Merged | Friends-beta/auth hardening and handoff updates |
| #42–#44 | Merged | Timing-first compact result-card redesign |
| #45 | Merged | Manual-location + sort persistence, quick-sort buttons and stable Update queue CTA |
| #46 | Merged | Documentation follow-up |
| #47 | Merged | Read-only synthetic normal-user testing agent |
| #48 | Merged | Pre-native hardening: account deletion, real deep-link 200s, guest cleanup, optional Start wait timer, mobile/native preparation, stronger synthetic testing |
| #49 | Merged | Clean map markers, clustering, explicit Search this area and persisted pinned-map-origin browsing; dedicated map regression coverage |

## Superseded paths to avoid restarting

- PR #13 NAR address indexing — superseded by PR #16 ODA/static architecture.
- Global always-on queue Realtime as default — superseded by adaptive polling.
- Magic-link-only login as normal UX — superseded by password auth.
- Public Google button during friends beta — hidden again after temporary recovery work.
- Dense card layouts giving every metric equal weight — superseded by timing-first hierarchy.
- Sort dropdown — superseded by quick-sort controls.
- Re-entering a successful manual postal/address search after every refresh — superseded by persisted location state.
- Treating the old draft PR #34 as a current blocker — newer regression tooling supersedes its purpose unless fresh inspection says otherwise.

Always start from live `main`, inspect newest PRs and Actions, compare with this README, and verify production before declaring a new baseline.