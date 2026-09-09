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

Production includes feature work through **PR #32**.

## Latest account release — PR #32

**PR #32 — `Add password and social account model`** replaced magic-link-only login with the intended consumer account model:

- browsing and basic contribution remain guest-first;
- email + password is the normal email login;
- normal password logins send **no email**;
- new email/password accounts use a one-time verification email when confirmations are enabled;
- existing magic-link-only users can use **Forgot / create password** once, then use password login thereafter;
- Google and Apple OAuth are implemented and their buttons appear only when the provider is actually enabled in Supabase;
- the shared Supabase session remains persistent across routes and refreshes until sign-out/session invalidation;
- `/auth/confirm` now handles signup verification, OAuth return and password recovery;
- PWA shell cache is `washradar-shell-v6` so installed mobile clients receive the new account UI;
- anonymous contribution history can be safely attached to an existing permanent account through a short-lived claim flow.

### Anonymous → permanent account continuity

When a guest contributor signs into an existing permanent account, WashRadar can transfer:

- queue reports;
- wash-type reports;
- queue-session history;
- visible contribution counters.

It intentionally does **not** transfer:

- anonymous Radar Points;
- anonymous reputation/trust score;
- an active queue timer.

This preserves useful history without allowing disposable anonymous identities to farm rewards/trust and merge them into a permanent account. Merge claims are random, device-held and now valid for **24 hours** so delayed verification/recovery email does not unnecessarily lose guest history.

See `docs/AUTH.md` for the full account/security model.

### Remaining account launch configuration

Before broad public promotion:

1. Configure **custom SMTP** (for example Resend) for reliable signup verification/password recovery.
2. Enable Supabase **Leaked Password Protection**.
3. Configure Google and/or Apple provider credentials if those buttons are desired in production.
4. Consider CAPTCHA/Turnstile as signup/anonymous-auth abuse becomes material.

Google/Apple support existing in code does **not** mean provider credentials are already configured.

---

# Scale baseline — PR #30 / #31

**PR #30 — `Prepare WashRadar for Supabase scale`** removed the largest client fan-out risk before traffic grows.

Production behavior:

- queue freshness defaults to **visible-tab adaptive polling**, not one global Realtime socket per browser;
- a queue refresh fetches only `queue_signal_feed` for washes already on screen;
- default poll interval is ~20 seconds plus per-session jitter;
- hidden tabs do not poll;
- Realtime remains available through `VITE_QUEUE_REFRESH_MODE=realtime` without a rewrite;
- history/freshness indexes exist for queue reports, wash-type reports and Radar Points;
- `.github/workflows/scale-smoke.yml` + `scripts/scale_smoke.mjs` provide a read-only production capacity smoke;
- `docs/SCALING.md` documents Free → Pro, compute resizing, observability and incident handling.

The first production scale smoke on Supabase Free ran at **20 concurrent / 200 reads** with **0 failures**, p50 ~640 ms, p95 ~1.93 s and p99 ~2.00 s. Treat that as an early baseline, not a maximum-capacity claim.

**PR #31** refreshed the scale handoff and added a controlled trigger for that production smoke workflow.

The goal is for growth to require **capacity/configuration changes, not a backend migration**.

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
        |     +-- optional Google / Apple OAuth
        |     +-- verification / recovery email
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
              (live traffic/ETA handled outside WashRadar)
```

Main folders:

- `src/domain` — ranking, queue estimation, confidence, contributor levels/config.
- `src/services` — repositories, Supabase adapter, search, auth/community, analytics and queue refresh.
- `src/components`, `src/pages` — UI.
- `supabase/migrations` — schema/RLS/indexes/RPCs/triggers.
- `supabase/functions` — privileged actions/enrichment.
- `scripts` — static index generators and scale-smoke script.
- `.github/workflows` — CI, Pages deployment and production scale smoke.
- `docs/AUTH.md` — account/auth security model.
- `docs/SCALING.md` — capacity/upgrade runbook.
- `tests`, `e2e` — automated coverage.

---

# Supabase scaling posture

WashRadar is intentionally staying on Supabase.

Current production DB is small (roughly tens of MB, with ~889 wash locations). The near-term scaling concern is request/connection behavior rather than storage.

Production-safe queue mode:

```env
VITE_QUEUE_REFRESH_MODE=poll
VITE_QUEUE_POLL_MS=20000
```

Optional Realtime mode:

```env
VITE_QUEUE_REFRESH_MODE=realtime
```

Do not turn global Realtime back on merely because it feels more "live". Measure connection/message fan-out first.

Important indexes include geographic GiST lookup, queue freshness/expiry, queue user history/user-wash, wash-type user history, Radar Points user/category/date, favourites and alerts.

Scaling path:

- **Free → Pro:** billing/capacity change; no WashRadar backend rewrite should be required.
- **Compute resize:** separate operation that can restart the database; do it proactively in a low-traffic window and rerun the production smoke afterward.
- For stricter availability later, evaluate paid replica/high-availability options before major maintenance.

See `docs/SCALING.md`.

---

# Contributor / community architecture

## Queue trust

General evidence ordering:

1. verified completed queue session;
2. fresh nearby GPS report;
3. older/less precise nearby report;
4. remote report.

Freshness decays from strongest in the first minutes to no live influence after roughly an hour. Reports combine proximity, freshness, reputation and agreement/outlier penalties. Only the latest active signal from a contributor should materially influence a wash.

## Radar Points

Radar Points are a retention/reward system, **not** a trust score.

| Contribution | Base points |
| --- | ---: |
| Nearby queue update | 20 |
| Verified completed wait | 75 |
| Nearby wash-type confirmation | 15 |
| Remote report | 0 |

Base contribution points are capped at 200/day. Challenge bonuses are one-time/idempotent.

Levels:

- Level 1 — **New Scout** — 0+
- Level 2 — **Queue Scout** — 250+
- Level 3 — **Radar Regular** — 750+
- Level 4 — **Local Expert** — 1,500+
- Level 5 — **WashRadar Hero** — 3,000+

## Challenges

- **First Radar** — first nearby queue update — +100.
- **Queue Scout** — update 3 different nearby washes — +250.
- **Verified Wait** — complete a verified `I'm in line` timer — +500.
- **Wash Detective** — nearby wash-type confirmation — +150.
- **3-Day Contributor** — contribute on 3 different days — +300.
- **Local Hero** — help update 5 different nearby washes — +750.

Challenge progress is derived server-side from contribution history.

## Profile / My Cars

Signed-in users can have display name, handle, optional bio, Radar Points/level, contribution stats/history, saved washes, alerts and a private My Cars garage.

`user_vehicles` is RLS-protected and supports year, make, model, optional nickname, optional 17-character VIN and one primary vehicle.

Do not invent vehicle/wash compatibility until reliable restriction/source data exists.

---

# Cost architecture

Normal use:

- GPS — browser/phone geolocation — $0 to WashRadar.
- Distance — local calculation — $0.
- Wash catalogue — canonical Supabase records; no per-user Places discovery.
- Queue — dynamic Supabase data.
- Postal/FSA search — static generated index — $0/search.
- Street/house autocomplete — static partitioned open-address files — $0/search.
- Traffic/ETA — user's Maps app after Directions — $0 to WashRadar.
- Google Routes — disabled for normal browsing.
- Google Places — administrative catalogue maintenance/enrichment only.
- Google Geocoding — exceptional fallback.
- Password login — no email send.
- Signup/recovery — email only when needed; custom SMTP pending before broad launch.

Do not reintroduce automatic Google traffic-route calls without an explicit product decision.

---

# Search / address architecture

PR #21 uses the full Canadian postal dataset and validates GTA coverage such as `M1X`. PR #22 fixed stale mobile/PWA postal caching.

Street/house autocomplete uses **static partitioned files**, not millions of household addresses in primary Supabase. The ODA-derived deployment contains roughly 1.56M GTA address points in chunks. Keep one useful routing point per building where possible rather than duplicating every unit.

---

# Current infrastructure / catalogue

- Frontend: React + Vite + TypeScript PWA.
- Hosting: GitHub Pages.
- Primary domain: `washradar.ca`.
- Backend: Supabase PostgreSQL, Auth, Data API, optional Realtime and Edge Functions.
- Supabase project: `mwyomijlvjfllgeniqcz`.
- Map display: open tile-map path.
- Approximate catalogue: ~889 saved wash locations, most with real weekly hours; GTA-first with useful spillover.

Active Edge Functions:

- `ad-events`
- `admin`
- `analytics-events`
- `geo-services`
- `queue-actions`
- `wash-ingest`
- `wash-type-actions`

Prefer selective catalogue enrichment over casual full paid Google enrichment.

---

# Wash-type trust model

Google's generic `car_wash` type does not reliably identify touchless, soft-cloth, tunnel, self-serve or hand wash.

WashRadar combines business-name wording, official website, other credible evidence where needed, contributor reports, proximity, reputation and independent agreement. Publish a wash type only when confidence crosses the configured threshold.

---

# User-facing timing model

Do **not** promise `drive + queue + wash = done in` while paid traffic routing is disabled.

Prefer:

- **Distance:** `2.8 km away`
- **Queue:** `~8 min`
- **Wash:** `~6 min`
- **Directions:** user's navigation app for live traffic/ETA

---

# Ads foundation

The schema supports advertiser businesses, campaigns, creatives, placements, geo/radius targeting, dates, priority, caps, budgets and impression/click tracking.

There are currently no live production advertisers/campaigns. `/ad-preview` exists for fictional testing. Paid/sponsored activity must never alter organic queue trust or recommendation scoring.

---

# Near-term priorities

1. Configure custom SMTP and verify branded signup/recovery delivery.
2. Enable Supabase leaked-password protection.
3. Physically validate email/password signup, existing-account password creation, persistent session and account drawer on iPhone/Android.
4. Configure/test Google and Apple OAuth only after provider credentials are available.
5. Validate Challenges/Radar Points and My Cars with real signed-in usage.
6. Continue representative GTA postal/FSA/street search and `Use my location` validation.
7. Test the complete `Update queue` + `I'm in line` loop with two independent sessions.
8. Run Production scale smoke before launch and after Supabase plan/compute changes.
9. Monitor Supabase and scale around ~70–80% sustained capacity rather than waiting for hard limits.

---

# Complete pull-request history

**Merged** means the PR entered `main`. **Closed / superseded** means it did not.

| PR | Status | Change | Current meaning |
| --- | --- | --- | --- |
| #1 — Clarify card timing and add quick queue reporting | Merged | Split timing concepts, fixed unknown queue display, added quick reporting. | Timing/report UX foundation. |
| #2 — Fix queue report submission | Merged | Added proximity position and failure states; repaired backend privileges. | Location-aware queue submission. |
| #3 — Add low-friction queue trust scoring | Merged | Proximity/freshness weighting, remote caps, consensus, dedupe and verified-session influence. | Core queue trust. |
| #4 — Configure WashRadar custom domain | Merged | Added `washradar.ca` Pages/CORS/auth groundwork. | Production domain. |
| #5 — Fix trust and accuracy gaps | Merged | Removed invented hours/false zero queues; improved GPS/unknown handling. | Unknown stays unknown. |
| #6 — Repair GTA catalogue enrichment and resume imports | Merged | Fixed hours parser and resumable GTA ingestion. | GTA catalogue foundation. |
| #7 — Add confidence-scored wash type truth engine | Merged | Multi-source type evidence/confidence. | Type truth model. |
| #8 — Repair wash-type enrichment and simplify card actions | Merged | Repaired enrichment; visible `Update queue`. | Contributor CTA pattern. |
| #9 — Make wash-type filters reflect verified nearby data | Merged | Verified nearby counts. | Trusted filters. |
| #10 — Add interactive ad placement preview | Merged | `/ad-preview`. | Ads testing foundation. |
| #11 — Zero-cost routing and local address index foundation | Merged | Removed automatic Routes; local address groundwork. | Zero-cost browsing start. |
| #12 — Zero-cost routing and GTA address-search foundation | Merged | Distance/queue/wash + external Maps. | Current routing philosophy. |
| #13 — Add zero-cost GTA address autocomplete | Merged | First NAR implementation; build issue. | Historical/superseded. |
| #14 — Fix zero-cost GTA address index build | Merged | Switched practical path to Ontario ODA. | Static address foundation. |
| #15 — Fix free GTA address index deployment | Closed / superseded | In-flight fix after main advanced. | Superseded by #16. |
| #16 — Finalize reliable zero-cost GTA address autocomplete | Merged | ODA chunks + fallback privacy/cost. | Current street architecture. |
| #17 — Fix NAR address index generation | Closed / superseded | Experimental NAR join. | Not current. |
| #18 — Reduce ongoing Supabase usage | Merged | Coalesced Realtime, hidden-tab work, batching. | Runtime-cost optimization. |
| #19 — Fix unified city, postal code and address search | Merged | Unified search + explicit Search button. | Current search UX. |
| #20 — Fix GTA postal-code search reliably | Merged | Separate postal path with incomplete source. | Source superseded. |
| #21 — Use full Canada postal dataset for GTA FSA search | Merged | Full Canadian postal data + validation. | Current postal source. |
| #22 — Prevent stale postal search on iPhone/PWA | Merged | Revalidation + SW cache bump. | Postal cache behavior. |
| #23 — Refresh README to current production state | Merged | Replaced stale handoff. | Source-of-truth workflow. |
| #24 — Document complete pull-request history | Merged | Added ledger. | Project archaeology. |
| #25 — Add contributor profiles, Radar Challenges and My Cars | Merged | Profile v2, points/challenges, vehicles, security. | Community foundation. |
| #26 — Document community release state | Merged | Community handoff. | Docs milestone. |
| #27 — Persist shared account session and add global profile drawer | Merged | Shared auth identity, persistent session, drawer. | Account/navigation architecture. |
| #28 — Show account drawer trigger on mobile | Merged | Responsive account control + cache bump. | Mobile account access. |
| #29 — Prevent auth email rate-limit bursts | Merged | One mail operation/tap, cooldowns, friendly 429. | Mail burst protection. |
| #30 — Prepare WashRadar for Supabase scale | Merged | Adaptive queue polling, scale indexes, load smoke/runbook. | Scale architecture. |
| #31 — Refresh scale handoff and add controlled smoke trigger | Merged | Current scale docs + controlled production smoke trigger. | Operational capacity baseline. |
| #32 — Add password and social account model | Merged | Guest-first + email/password + optional Google/Apple + recovery/verification callback + secure guest-history merge. | Current account model. |

## Superseded paths to avoid restarting

- PR #15 — superseded by #16.
- PR #17 — experimental NAR repair; street index is ODA-based.
- PR #13's failed NAR deployment — historical only.
- PR #20's incomplete postal source — superseded by #21.
- Global always-on queue Realtime as default — superseded by #30 polling; Realtime remains optional.
- Magic-link-only login as normal account UX — superseded by #32 password/social model.

Always start from `main`, inspect newest merged PRs, verify the latest Pages workflow, and read the relevant auth/scaling runbook before changing those systems.
