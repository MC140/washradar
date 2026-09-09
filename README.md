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
2. Check the newest merged PRs.
3. Check the latest **Deploy WashRadar to GitHub Pages** workflow.
4. Read `docs/AUTH.md` for account work.
5. Read `docs/SCALING.md` for capacity work.
6. Treat GitHub `main`, the production Supabase schema and GitHub Actions as final source of truth.

Do not restart old/superseded work merely because it appears in historical notes.

---

# Current production baseline — 2026-09-09

Production includes feature work through **PR #39**.

## Friends-beta account model

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
- signed-in users have **Set / change password** in Profile and can update their password without email;
- forgot-password email recovery is intentionally hidden until reliable public SMTP is configured;
- the shared Supabase session persists across routes/refreshes until sign-out/session invalidation;
- guest contribution history can be securely merged into a permanent account through the claim flow.

### Anonymous → permanent account continuity

When a guest contributor signs into an existing permanent account, WashRadar can transfer queue reports, wash-type reports, queue-session history and visible contribution counters.

It intentionally does **not** transfer anonymous Radar Points, anonymous reputation/trust score, or an active queue timer. Merge claims are device-held and valid for **24 hours**.

### Remaining account work before broad public launch

1. Configure **custom SMTP** for reliable password-reset/recovery and, if desired later, email verification.
2. Enable Supabase **Leaked Password Protection** when the project plan supports it.
3. Decide whether to expose Google sign-in publicly; backend Google OAuth is configured but currently hidden from the beta UI.
4. Add CAPTCHA/Turnstile if signup or anonymous-auth abuse becomes material.

Do not re-enable password-reset UI until email delivery is reliable.

---

# Recent release hardening — PRs #33–#39

- **PR #33** extended anonymous-account merge claims to 24 hours.
- **PR #35** fixed cold-start/shared wash detail loading, hardened a privileged wash-type RPC, restored Saved/queue-target state on reload, clarified in-app-only queue targets, and hardened friends-beta auth behavior.
- **PR #36** simplified signup to 8+ character passwords, removed the second password field, and improved password-manager compatibility.
- **PR #37** aligned the production audit with the simplified signup flow.
- **PR #38** temporarily exposed Google sign-in for recovery of an existing linked account and added signed-in password change.
- **PR #39** hid Google again after recovery while keeping signed-in password change available.

Current production validation includes green deterministic queue/trust tests, desktop/mobile live-user journeys, post-deploy production audit, and a synthetic transactional challenge lifecycle audit that was rolled back after testing.

The challenge audit covered remote-vs-nearby qualification, distinct-wash counting, verified waits, wash-type confirmation, three-day progress, disabled contributions, one-time rewards, daily point caps, post-completion anti-farming and cross-user isolation.

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
- Scale proactively before quota/compute limits become incidents.

---

# Current architecture

```text
GitHub Pages (React + Vite PWA)
        |
        +-- app shell / service worker
        +-- static postal/FSA data
        +-- static GTA address chunks
        |
        +-- Supabase Auth
        |     +-- guest/anonymous identity
        |     +-- email + password
        |     +-- Google OAuth configured but hidden in beta UI
        |     +-- signed-in password change
        |     +-- email recovery deferred until SMTP
        |
        +-- Supabase Data API / RLS
        |     +-- canonical washes / hours / types
        |     +-- queue reports / estimates
        |     +-- profiles / user vehicles
        |     +-- challenges / progress / points ledger
        |     +-- favourites / queue targets
        |
        +-- queue freshness
        |     +-- DEFAULT: visible-tab polling of queue_signal_feed
        |     +-- OPTIONAL: Supabase Realtime by config
        |
        +-- Supabase DB triggers / RPCs
        |     +-- nearby spatial lookup
        |     +-- queue signal feed
        |     +-- direct wash-detail lookup
        |     +-- contribution rewards
        |     +-- challenge progress
        |     +-- account/anonymous-history helpers
        |
        +-- Supabase Edge Functions
              +-- queue validation/sessions
              +-- geocode fallback
              +-- controlled Places ingestion
              +-- wash-type evidence
              +-- ads/analytics
              +-- protected admin/moderation

Directions --> Google Maps / Apple Maps on the user's device
```

Main folders:

- `src/domain` — ranking, queue estimation, confidence, contributor levels/config.
- `src/services` — repositories, Supabase adapter, search, auth/community, analytics and queue refresh.
- `src/components`, `src/pages` — UI.
- `supabase/migrations` — schema/RLS/indexes/RPCs/triggers.
- `supabase/functions` — privileged actions/enrichment.
- `scripts` — static index generators and scale-smoke script.
- `.github/workflows` — CI, Pages deployment, post-deploy live audit and production scale smoke.
- `release-tests` — production Playwright user journeys.
- `docs/AUTH.md` — account/auth security model.
- `docs/SCALING.md` — capacity/upgrade runbook.
- `tests`, `e2e` — deterministic and browser coverage.

---

# Queue trust and timing

General evidence ordering:

1. verified completed queue session;
2. fresh nearby GPS report;
3. older/less precise nearby report;
4. remote report.

Remote evidence is deliberately weak and cannot by itself create a strong `LIVE` queue state. Rapid duplicates and excessive reporting are rate-limited/deduplicated server-side.

Queue buckets are `NO QUEUE`, `1–3`, `4–7`, `8–12`, and `12+`. The backend maps each bucket to a representative car count and combines it with the wash's minutes-per-car model. It does **not** fake a continuously decreasing car count after a report. Evidence freshness decays over time and old evidence expires.

Open clients typically receive another user's accepted queue update within roughly **20 seconds plus jitter**; the submitting client refreshes immediately after a successful write.

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
- **Verified Wait** — complete a verified `I'm in line` timer — +500.
- **Wash Detective** — nearby wash-type confirmation — +150.
- **3-Day Contributor** — contribute on 3 different days — +300.
- **Local Hero** — help update 5 different nearby washes — +750.

Challenge progress is derived server-side from contribution history and rewards cannot be repeatedly farmed after completion.

---

# Scale posture

Production queue freshness defaults to visible-tab adaptive polling. Default interval is about 20 seconds plus jitter; hidden tabs do not poll. Realtime remains optional through `VITE_QUEUE_REFRESH_MODE=realtime`.

The first production scale smoke on Supabase Free ran at **20 concurrent / 200 reads** with **0 failures**, p50 ~640 ms, p95 ~1.93 s and p99 ~2.00 s. Treat that as an early baseline, not a maximum-capacity claim.

Free → Pro should remain a capacity/billing change rather than an application rewrite.

---

# Cost architecture

Normal browsing is designed to avoid paid Google routing traffic:

- GPS — browser/phone geolocation — $0 to WashRadar.
- Distance — local calculation — $0.
- Queue — dynamic Supabase data.
- Postal/FSA search — static generated index — $0/search.
- Street/house autocomplete — static partitioned open-address files — $0/search.
- Traffic/ETA — user's Maps app after Directions — $0 to WashRadar.
- Google Routes — disabled for normal browsing.
- Google Places — administrative catalogue maintenance/enrichment only.
- Google Geocoding — exceptional fallback.
- Password login — no email send.
- Friends-beta signup — no email confirmation while Confirm email is OFF.
- Forgot-password recovery — deferred until public SMTP is configured.

---

# Current infrastructure

- Frontend: React + Vite + TypeScript PWA.
- Hosting: GitHub Pages.
- Primary domain: `washradar.ca`.
- Backend: Supabase PostgreSQL, Auth, Data API, optional Realtime and Edge Functions.
- Map display: open tile-map path.
- Approximate catalogue: ~889 saved wash locations, GTA-first with useful spillover.

Active Edge Functions: `ad-events`, `admin`, `analytics-events`, `geo-services`, `queue-actions`, `wash-ingest`, `wash-type-actions`.

---

# Near-term priorities

1. Keep the friends beta on email/password while collecting real-user feedback.
2. Configure custom SMTP before enabling forgot-password recovery for arbitrary users.
3. Enable leaked-password protection if/when the Supabase plan supports it.
4. Physically test new-account creation, logout/login, profile persistence, Saved, queue targets, Challenges, My Cars and contribution history on multiple real phones.
5. Continue representative GTA postal/FSA/street search and `Use my location` validation.
6. Test the complete `Update queue` + `I'm in line` loop with multiple independent real sessions at an actual wash.
7. Keep Google hidden until there is an explicit decision to make it public.
8. Run production scale smoke before a larger public launch and after Supabase plan/compute changes.

---

# Pull-request history

| PR | Status | Current meaning |
| --- | --- | --- |
| #1–#12 | Merged | Core timing, queue reporting/trust, domain, catalogue, wash-type truth and zero-cost routing foundations |
| #13–#17 | Mixed | Address-index iterations; current implementation is ODA-based |
| #18–#22 | Merged | Supabase runtime optimization and current unified postal/address search |
| #23–#24 | Merged | README/handoff and PR history documentation |
| #25–#29 | Merged | Profiles, Radar Points/Challenges, My Cars, persistent auth/drawer and email burst protection |
| #30–#31 | Merged | Scale architecture, smoke testing and runbook |
| #32 | Merged | Password/social account foundation |
| #33 | Merged | 24-hour anonymous merge claim |
| #35 | Merged | Friends-beta release hardening |
| #36 | Merged | 8-character/password-manager-friendly signup |
| #37 | Merged | Production audit aligned with simplified signup |
| #38 | Merged | Temporary Google recovery + signed-in password change |
| #39 | Merged | Google hidden again; current friends-beta auth surface |

## Superseded paths to avoid restarting

- Global always-on queue Realtime as default — superseded by adaptive polling.
- Magic-link-only login as normal account UX — superseded by password auth.
- 12-character forced-composition signup — superseded by the 8-character beta model.
- Public Google button during the friends beta — temporary recovery only; hidden again after PR #39.

Always start from `main`, inspect newest merged PRs, verify the latest Pages workflow, and read the relevant auth/scaling runbook before changing those systems.
