# WashRadar

WashRadar answers one question: **Where should I wash my car right now?**

It compares drive time, queue time, expected wash duration, total time, price, wash type, rating, hours, status and data confidence. The organic **Best Right Now** recommendation is calculated independently of clearly labelled sponsored placements.

The public application is a mobile-first React PWA hosted as static files on GitHub Pages. Supabase provides PostgreSQL, authentication, Realtime and protected Edge Functions. A clearly marked local demo works without paid API credentials.

## Architecture

    GitHub Pages (React + Vite PWA)
            |
            +-- Supabase Data API (public reads and user-owned RLS data)
            +-- Supabase Realtime (queue_estimates)
            +-- Supabase Edge Functions
                  +-- queue reports and sessions
                  +-- cached geocoding and controlled Places ingestion
                  +-- ad and analytics validation
                  +-- protected moderation

The browser contains only public configuration. The Supabase service-role key, Google server key, device-hash salt and admin allowlist remain Supabase Edge Function secrets.

- **src/domain:** queue estimation, confidence, total-time and ranking logic.
- **src/services:** provider-neutral repository, Supabase adapter, demo persistence, location and analytics.
- **src/components and src/pages:** responsive consumer, reporting, map, profile and admin UI.
- **supabase/migrations:** normalized PostgreSQL schema, indexes, RLS and safe public RPCs.
- **supabase/functions:** privileged validation, ingestion, moderation and cost-controlled external calls.
- **.github/workflows:** quality checks and GitHub Pages deployment.
- **tests and e2e:** domain/service and Playwright user-flow coverage.

## Local development

Requirements: Node.js 22.13 or newer and npm.

    git clone YOUR_REPOSITORY_URL
    cd washradar
    npm ci
    cp .env.example .env.local
    npm run dev

Open http://localhost:4173. Set VITE_DEMO_MODE=true for 20 fictional GTA washes. Reports, favourites, alerts and queue sessions persist locally. Demo content always displays a prominent disclosure; the Pages production workflow forces demo mode off.

Quality commands:

    npm run lint
    npm run typecheck
    npm test
    npm run build
    npm run test:e2e

Verify the GitHub project-pages path:

    VITE_DEMO_MODE=true VITE_BASE_PATH=/washradar/ npm run build
    npm run preview

## Environment variables

Copy .env.example to .env.local. Variables beginning with VITE_ are public.

| Variable | Required | Purpose |
|---|---:|---|
| VITE_DEMO_MODE | Yes | true for the fictional local demo; false in public production. |
| VITE_BASE_PATH | Yes | /washradar/ for project Pages; / for washradar.ca. |
| VITE_SUPABASE_URL | Production | Supabase project URL. |
| VITE_SUPABASE_PUBLISHABLE_KEY | Production | Public browser key protected by RLS. |
| VITE_GOOGLE_MAPS_BROWSER_KEY | Optional | Google map. Without it, the open tile-map provider is used. |
| VITE_MAP_TILE_URL | Optional | Key-free fallback tile URL. Confirm the provider’s production terms. |
| VITE_MAP_ATTRIBUTION | Optional | Required map attribution. |
| VITE_SUPPORT_EMAIL | Recommended | Address displayed on Support. |
| VITE_SENTRY_DSN | Optional | Reserved for a privacy-reviewed error provider. |

Set these with supabase secrets set, never in GitHub Pages:

| Edge Function secret | Required | Purpose |
|---|---:|---|
| GOOGLE_MAPS_SERVER_KEY | Real search/import | Geocoding and controlled Places ingestion. |
| DEVICE_HASH_SALT | Yes | Random 32+ byte value used before storing device hashes. |
| ADMIN_EMAILS | Yes | Comma-separated moderation/ingestion allowlist. |
| ALLOWED_ORIGINS | Yes | Comma-separated production and local origins. |
| GOOGLE_GEOCODE_DAILY_LIMIT | Recommended | Application quota; defaults to 200. |
| GOOGLE_PLACES_DAILY_LIMIT | Recommended | Discovery quota; defaults to 10. |
| GOOGLE_ROUTES_DAILY_LIMIT | Recommended | Route Matrix quota; defaults to 300. |

Hosted Supabase supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Edge Functions.

## Supabase setup

The free plan is sufficient for the initial launch.

1. Create a dedicated project at https://supabase.com/dashboard. Do not reuse an unrelated project.
2. Install the Supabase CLI from https://supabase.com/docs/guides/local-development/cli/getting-started.
3. Link and deploy:

       supabase login
       supabase link --project-ref YOUR_PROJECT_REF
       supabase db push
       supabase functions deploy queue-actions
       supabase functions deploy ad-events --no-verify-jwt
       supabase functions deploy geo-services --no-verify-jwt
       supabase functions deploy analytics-events --no-verify-jwt
       supabase functions deploy admin
       supabase functions deploy wash-ingest
       supabase secrets set DEVICE_HASH_SALT=... ADMIN_EMAILS=... ALLOWED_ORIGINS=...

4. In Authentication → Providers, enable Email and Anonymous Sign-ins.
5. In Authentication → URL Configuration, set the final HTTPS Site URL and exact /auth/confirm redirect.
6. Add your authenticated user UUID to private.admin_users in the SQL editor.
7. Import reviewed production locations with the protected wash-ingest Edge Function. It never invents prices or wash types.
8. Run Supabase security and performance advisors after migration.

The migration enables RLS on every public table. Anonymous users can read only active production wash data and calculated estimates. Queue writes, moderation, reputation, ad metrics and ingestion use validated Edge Functions. User-owned favourites, alerts and preferences require matching auth.uid().

supabase/seed.sql intentionally contains no businesses. Demo places are never inserted into production.

## Recommendation and queue model

    TOTAL TIME = drive time + queue time + wash duration

The score begins with total time and adds configurable distance, price and uncertainty penalties, rating and preferred-type adjustments, plus a small optional weather signal. Closed or unavailable washes receive an infinite score. src/domain/config.ts holds weights and wash-type defaults.

The estimator keeps only the latest fresh signal from each contributor, heavily weights fresh verified reports and completed sessions, decays evidence over 60 minutes, blends with historical time buckets, reduces confidence when reports disagree, and requires two nearby closure/broken reports before changing status.

LIVE requires recent credible evidence. Older submissions become RECENT REPORT. Historical or weak data is labelled ESTIMATED, Historical Estimate or Limited Data.

The Edge Function enforces cooldowns, duplicate detection, six reports per hour, one active session, a 90-minute maximum wait and proximity validation. It stores a proximity class, never submitted GPS coordinates.

## Maps, Places and cost controls

Normal browsing reads canonical washes from Supabase. It does not call Nearby Search while a user pans. Only an administrator invokes wash-ingest. That request uses a minimal Google field mask, deduplicates by provider place ID and has a server-side daily limit.

Address geocoding occurs only after explicit search. Results cache for 30 days, requests are rate-limited per hashed client, and a global quota fails closed.

The Google browser key must use HTTP referrer restrictions for localhost, GitHub Pages and the production domain, with only Maps JavaScript API enabled. The server key belongs only in Supabase secrets and enables only Geocoding API, Places API (New) and Routes API.

In Google Cloud:

1. Create a dedicated WashRadar project and billing account.
2. Create separate browser and server keys.
3. Set per-API quotas close to the application limits.
4. Create budget alerts at C$5, C$20 and C$50.
5. Review provider storage, attribution and display terms before scaling imports.

Drive time uses a traffic-aware Route Matrix for the first ten nearby results when Routes is configured. Results cache by coarse origin cell for ten minutes. Without Routes, the UI clearly labels its distance-derived fallback.

## Advertising

The schema supports advertiser businesses, campaigns, creatives, placements, flexible radius/city/region targets, dates, priority, frequency caps, budgets, weekly/monthly/flat pricing metadata, impressions and clicks. Pricing is data, not hard-coded logic.

Ads rotate on meaningful navigation through select_ad. Frequency caps prevent one advertiser from dominating. Every creative says Sponsored or Nearby offer. Ad eligibility is separate from recommendation scoring.

The initial UI renders tasteful Explore and wash-detail offers. Campaign payment and self-service are intentionally deferred so the consumer launch stays focused.

## PWA and GitHub Pages

The manifest uses relative scope and start paths. The service worker caches the shell and versioned assets, uses network-first navigation, never caches Supabase queue responses as fresh data, provides an offline shell, handles future push events and removes old cache versions.

The build copies index.html to 404.html so GitHub Pages can boot React Router on deep links. When adding a custom domain, set repository variable VITE_BASE_PATH=/, configure the domain in Pages and let GitHub create CNAME.

### Publish

1. Create a GitHub repository named washradar.
2. Push main.
3. In Settings → Pages, choose GitHub Actions as the source.
4. Add repository variables VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and VITE_SUPPORT_EMAIL.
5. Add VITE_GOOGLE_MAPS_BROWSER_KEY as a repository secret only if using Google’s map.
6. Run Deploy WashRadar to GitHub Pages or push to main.

Use pull requests and keep main as production. Branch protection should require Quality checks.

## Monitoring

- **Supabase:** review database size, egress, Realtime connections and Edge invocations weekly; enable usage notifications.
- **Google Cloud:** use budget alerts and per-API quotas. Edge limits do not replace Cloud quotas.
- **GitHub:** review Actions usage; dependency caching and cancellation of superseded runs are configured.
- **Application:** structured errors emit washradar:error; validated product analytics avoid a third-party behavioural tracker.

If Google fails or quotas are exhausted, stored washes and queue data continue. Search explains the limitation and avoids retry loops.

## Current limitations

- A dedicated Supabase project and verified GTA import are required before production has real washes.
- Route traffic is available only when the Google Routes API and quota are configured; the fallback is labelled estimated.
- Background push delivery and scheduled alerts need a future push provider/cron; in-app alerts work.
- Advertiser payment and self-service are outside the first consumer launch.
- Physical iPhone Safari and Android device testing remains necessary.
- Choose a production-suitable map tile provider before usage exceeds the fallback provider’s policy.

## Troubleshooting

- **Blank Pages route:** confirm VITE_BASE_PATH matches /repository/ and that 404.html exists.
- **No production washes:** confirm demo mode is false, Supabase variables are set, migration ran and imported rows use production.
- **Report rejected:** enable Anonymous Sign-ins and deploy queue-actions. Production queue timers require proximity.
- **Magic-link wrong route:** allow the exact HTTPS /auth/confirm URL in Supabase.
- **Map unavailable:** remove the Google key to use fallback tiles, or check API/referrer restrictions.
- **Admin locked:** sign in with an ADMIN_EMAILS address and add its UUID to private.admin_users.

## Connected production infrastructure

The schema and six Edge Functions are deployed to Supabase project `mwyomijlvjfllgeniqcz` (Canada Central). `src/config/production.json` contains the intentionally public project URL and legacy anonymous browser key; this is not a privileged secret. All tables have RLS and privileged writes go through Edge Functions. The legacy anon key is used for compatibility with the JWT-verifying function gateway. Environment variables override these defaults. Never put a service-role key in that file.

Before public launch:
- In GitHub repository Settings → Pages, select **GitHub Actions** as the source.
- In Supabase Authentication → URL Configuration, set Site URL to `https://mc140.github.io/washradar/` and add `https://mc140.github.io/washradar/auth/confirm` as an allowed redirect.
- Enable anonymous sign-ins in Supabase Authentication if anonymous queue contributions are wanted; configure email delivery for magic links.
- Set Edge Function secrets `ADMIN_EMAILS`, `DEVICE_HASH_SALT`, and `GOOGLE_MAPS_SERVER_KEY` when using Google discovery/search/routes. CORS defaults to `https://mc140.github.io`; override `ALLOWED_ORIGINS` for a custom domain.
- Import and verify actual wash records. Production intentionally starts empty and never falls back to fictional demo listings.

The security advisor reports intentionally public, bounded SECURITY DEFINER read functions and deny-by-default internal tables. Review their access boundaries when changing them: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
