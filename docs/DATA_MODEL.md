# WashRadar readable data model

This document is a human-readable map of WashRadar's important data domains. It is not a substitute for the SQL migrations, RLS policies, RPCs, Edge Functions, or live production schema. Its purpose is to make the product model easy to recover in a new chat or engineering session.

For implementation truth, use current `main` plus the production Supabase schema. When the model materially changes, update this document in the same PR/release.

## 1. Car-wash catalogue

### `car_washes`

Canonical physical wash locations and core listing fields.

Conceptually contains things such as:

- wash identity;
- business/location name;
- coordinates;
- street/city/region/address data;
- operating/catalogue status;
- wash-duration assumptions and other listing-level facts.

### Provider references / enrichment

Provider-link tables connect a WashRadar wash to external catalogue sources such as Google for controlled enrichment. Provider data must not be confused with first-party WashRadar ratings or queue evidence.

### Hours / wash types / packages

Related records describe:

- operating hours;
- supported wash types;
- packages/prices;
- verification/provenance where available.

Missing values stay missing; the UI should not invent a price, wash type, hours, or queue state.

## 2. Driver browsing location

Browsing location is primarily **device-local state**, not a public user profile attribute.

A selected browsing origin can come from:

- current GPS;
- manual city search;
- postal-code search;
- full-address search;
- map `Search this area`.

The selected origin is stored locally on the device so refresh/reopen can restore the same area. A restored GPS browsing point is not treated as fresh verified GPS for queue contribution. Queue verification still requests a fresh device location when required.

The current local-storage model is:

```text
wr-selected-location-v2
  label
  point { lat, lng }
  source = gps | manual | map
  savedAt
```

For privacy, a GPS point persisted for browsing is rounded before storage. It is used to restore nearby discovery, not to prove physical presence.

The older `wr-manual-location-v1` record is migrated forward when encountered.

## 3. Queue / timing evidence

### Queue reports

Community queue reports are the primary low-friction timing input.

Evidence may include:

- queue bucket / cars-ahead estimate;
- wash/location id;
- contributor identity where applicable;
- server timestamps;
- nearby vs remote verification class;
- moderation/disabled state.

Trust hierarchy is broadly:

1. verified completed wait session;
2. fresh nearby GPS report;
3. older/less precise nearby report;
4. remote report.

Remote evidence is deliberately weaker and cannot by itself create a strong live state.

### Queue sessions / Start wait timer

A queue session represents an optional observed real wait for someone physically at the wash.

It can carry:

- wash id;
- contributor/session identity;
- start time;
- start proximity/verification;
- optional starting queue bucket;
- completion/cancellation state;
- observed wait when completed.

The server owns trusted timing semantics. Native v1 should restore an active session on resume without requiring always-on background GPS.

### Queue estimates

The UI consumes derived queue/timing signals rather than pretending each report is exact truth.

Displayed decision information separates:

- estimated queue wait;
- cars ahead/supporting evidence;
- wash duration;
- queue + wash total;
- distance;
- drive/traffic time, which remains delegated to the user's Maps app.

## 4. Users, profiles and contributions

### Supabase Auth identity

WashRadar supports:

- guest/anonymous contribution identity;
- email/password permanent accounts;
- Google OAuth configured but hidden during current beta.

Browsing does not require login.

### Profiles / vehicles / favourites / alerts

User-linked tables support normal account features such as:

- profile data;
- saved vehicles;
- favourites;
- queue alerts/targets;
- contribution counters/challenges.

### Anonymous -> permanent account claim

A controlled claim flow can move supported guest history into a permanent account within its claim window.

Currently intended transferable history includes:

- queue reports;
- wash-type reports;
- queue-session history;
- structured wash ratings;
- visible contribution counters.

It intentionally does not blindly transfer every anonymous state item, such as active timers or anonymous points/reputation.

## 5. Radar Points / challenges

Radar Points are a retention/reward layer, not the trust score used to judge evidence.

Challenge progress is derived from qualifying contribution history. Base contribution points are capped per day and challenge bonuses are idempotent.

Do not use paid activity or advertising spend to increase evidence trust or Radar Points.

## 6. WashRadar Ratings

### `wash_ratings`

One structured first-party WashRadar rating per contributor per wash.

Fields conceptually include:

- wash id;
- contributor user id (nullable after de-identification/account deletion);
- overall 1–5 score;
- optional quality/value/equipment scores;
- up to three allowed structured tags;
- server-derived `verified_visit`;
- moderation/disabled state;
- created/updated timestamps.

Public browser roles do not directly read raw reviewer rows. Public UI reads aggregate rating data through a narrow RPC.

### Verified visit

Verified visit is derived on the server from existing nearby queue / queue-session evidence. The browser cannot simply declare itself verified.

### Free-text reviews

Not part of the current model. Written UGC should not be added until reporting, blocking, filtering, moderation, terms/community guidelines and owner dispute/contact handling are deliberately implemented.

## 7. Local advertising / monetization

Read `docs/MONETIZATION.md` for the commercial behavior and `docs/ADVERTISER_INTAKE.md` for operations.

### `advertiser_businesses`

One advertiser business/location identity.

Important concepts:

- optional `owner_user_id`;
- business name/type;
- website/destination metadata;
- physical address/city/region/postal code;
- verification/status;
- private contact name/email/phone.

`owner_user_id` may be null because early advertisers are staff-managed and do not need a WashRadar account.

Private sales/billing contact data is not part of public ad selection.

### `ad_campaigns`

A booked advertising campaign.

Concepts include:

- advertiser business id;
- name/status;
- start/end dates;
- campaign priority;
- daily frequency cap;
- budget/booked price;
- pricing model;
- approval metadata.

Higher `priority` can be used for a legitimate paid visibility tier, but only inside sponsored inventory.

### `ad_geo_targets`

Where a campaign is eligible.

Paid v1 deliberately uses:

```text
target_kind = radius
centre = geographic point
radius_km = numeric radius
```

City/neighbourhood/region-shaped fields may exist but are not eligible for paid v1 until explicit matching rules are implemented and tested.

### `ad_creatives`

What the user sees/clicks.

Concepts include:

- campaign id;
- headline/body;
- call to action;
- destination URL;
- disclosure;
- optional media path;
- active state.

### `ad_placements`

Named UI inventory surfaces such as:

- `explore_nearby_offer`;
- `wash_detail_nearby_offer`;
- reserved/future rows such as queue/post-wash/sponsored-wash placements.

A row existing here does not automatically mean the UI currently renders it.

### `ad_campaign_placements`

Many-to-many campaign -> placement relationship.

Includes a placement `weight` that can support higher rotation/visibility inside sponsored inventory without duplicating a business in the same response.

### `ad_inventory_settings`

Server-owned configuration for how many sponsored businesses a placement may visibly return.

Current intended values:

- Explore local sponsor module: 5;
- single-card placements such as Wash Details: 1.

This exists so changing visible inventory later does not require a client release.

### `ad_impressions` / `ad_clicks`

Performance-event tables.

The client sends a local device/client id to the protected Edge Function. The server hashes it before persistence/selection frequency checks. Raw readable device identity is not stored in these ad event rows.

## 8. Ad-selection path

Readable request flow:

```text
User selects/searches an area
        |
        v
active lat/lng origin
        |
        v
frontend asks ad-events Edge Function
        |
        +-- validates request
        +-- hashes local client id
        v
service-role select_ads RPC
        |
        +-- active verified advertiser?
        +-- campaign active in date window?
        +-- active creative?
        +-- linked/active placement?
        +-- radius target contains origin?
        +-- frequency cap still available?
        +-- one visible slot per business?
        +-- placement max_visible config?
        v
clearly labelled sponsored cards
```

Organic WashRadar result ranking is a different path and is never altered by this paid selection function.

## 9. Static/open address search

Large household-address data should remain outside normal Supabase database storage when possible.

Current architecture:

- static FSA/postal lookup;
- Ontario ODA-based partitioned address chunks;
- served statically through GitHub Pages;
- approximately zero marginal search cost;
- no return to the superseded PR #13 NAR pipeline without a new concrete reason.

## 10. Cost-sensitive boundaries

Keep these architectural decisions unless new evidence justifies change:

- Google Routes disabled for normal browsing;
- live turn-by-turn/traffic delegated to user's Maps app;
- no millions of household addresses moved into Supabase;
- no always-on background GPS requirement for native v1;
- open/static search where practical;
- Supabase used for dynamic, trusted, relational product state.

## 11. Update rule

When a PR changes a major data relationship or product truth, update this file in the same release.

Examples:

- new queue evidence class;
- rating moderation identity behavior;
- advertiser package/tier field;
- new ad placement/inventory model;
- new account/claim behavior;
- new location persistence behavior;
- major new backend domain.

This file is intended to be the compact, readable model a future ChatGPT session can reload before touching the project.
