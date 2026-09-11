# WashRadar monetization model

This document is the readable source of truth for WashRadar's commercial model. Read it before changing advertising, pricing, sponsor placement, targeting, advertiser onboarding, or paid visibility.

The production database/code remains authoritative for implementation details; this document explains the intended business behavior in plain language.

## Core principle

WashRadar is free for drivers. Organic car-wash discovery is based on real product signals such as distance, queue evidence, estimated wait, wash duration, price when available, confidence, and operating status.

**Money can buy sponsored visibility. It can never buy a fake organic advantage.**

A sponsor must never be able to purchase:

- a shorter displayed wait;
- fewer displayed cars ahead;
- a higher WashRadar Rating;
- a better organic `Recommended` position;
- fake confidence/freshness;
- suppression of a competitor's organic wash result.

Sponsored content must remain visually disclosed as `Sponsored`, `Nearby offer`, or another clear equivalent.

## Current paid product

The beta/default local package is:

- **C$100 CAD / month**;
- **5 km radius** around the verified advertiser business location;
- one approved campaign/offer;
- location-relevant eligibility when a WashRadar user's active browsing origin falls inside the advertiser radius;
- impression/click tracking;
- normal rotation with other eligible sponsors;
- one visible card per business in a single ad request.

The price/radius are commercial defaults, not architectural limits. They may change after real sales and renewal data.

## How location targeting works

All normal WashRadar discovery methods resolve to an active latitude/longitude browsing origin:

- Use my location;
- city search;
- postal-code search;
- full-address search;
- Search this area on the map.

Paid v1 then performs a PostGIS coordinate/radius match against active campaigns.

So the ad system is **coordinate/radius based**, not dependent on postal-code boundaries. Postal/address input is simply another way to establish the user's active coordinates.

Do not enable the existing city/neighbourhood/region target shapes for paid campaigns until explicit matching rules and tests are added.

## Current production placements

### `explore_nearby_offer`

Live on Explore as the **Nearby Sponsors / Local offers around this area** module.

- Current server-owned inventory limit: **5 visible businesses**.
- Desktop: responsive sponsored-card grid.
- Mobile: horizontal sponsored-card carousel.
- If zero eligible advertisers exist, the entire module disappears; no empty ad placeholder is shown.

### `wash_detail_nearby_offer`

Live on Wash Details after the primary timing/decision block and before packages/pricing.

- Current server-owned inventory limit: **1**.
- Uses the wash coordinates for local relevance.
- If no sponsor is eligible, nothing is shown.

### Reserved / future-capable placement rows

The database also contains:

- `queue_wait_offer`;
- `post_wash_offer`;
- `sponsored_wash`.

A placement row existing in the database does **not** mean we should automatically expose it in the UI. Add visible inventory only when it improves the product and has a clearly defined sponsored treatment.

## Inventory is configurable

`ad_inventory_settings` stores the server-owned `max_visible` value for each placement.

That means a future business decision such as:

- Explore 5 -> 8 sponsors;
- Details 1 -> 2;
- a new placement with max 1;

can be changed centrally in Supabase (within the defensive ceiling) without requiring an iOS/Android/web client release.

The client and Edge Function accept up to 20 candidates only as a safety ceiling. The commercial visible limit belongs to the placement configuration.

## More visibility for a paying business

A business may buy greater **ad exposure**, but not additional simultaneous duplicate cards in the same request.

The existing model supports differentiated visibility through:

- campaign `priority`;
- placement `weight`;
- larger/smaller radius;
- frequency cap;
- additional approved placements;
- campaign dates;
- multiple approved creatives over time.

Recommended commercial evolution after real demand is proven:

### Local

Example: C$100/month, 5 km radius, standard rotation.

### Boosted

Higher campaign/placement weight so the advertiser appears more often when eligible. It should still occupy at most one visible slot in a request.

### Expanded

Larger radius, for example 10 km, while preserving the same truth/organic separation.

### Premium / multi-placement

Eligible across more than one approved sponsor surface, such as Explore + Wash Details.

Do **not** hard-code public prices for these future tiers until sales evidence shows what businesses value. The schema already supports the underlying mechanics.

## Selection rules

For a campaign to appear, all of the following must be true:

1. advertiser is verified;
2. campaign is active and inside its date range;
3. creative is active;
4. requested placement is active and linked to the campaign;
5. campaign has a radius target;
6. user's selected coordinates are inside that radius;
7. the campaign has not exceeded its daily frequency cap for the server-hashed local session/device id;
8. the business has not already taken another visible slot in the same response.

Eligible campaigns are ordered using campaign priority, placement weight, deterministic rotation, and proximity. The system never needs readable raw device identity for ad frequency control.

## Advertiser onboarding

Early advertiser onboarding is manual by design. The business does not need a WashRadar account.

Ask only for:

1. business name;
2. full physical address;
3. business category / what they do;
4. destination link (website, booking page, offer page, etc.);
5. offer/message;
6. private contact name, email and phone;
7. optional logo/image.

WashRadar handles coordinates, radius targeting, ad formatting, disclosure, tracking and final creative preparation. The business approves the final creative in writing before activation.

See `docs/ADVERTISER_INTAKE.md` for the operational copy/paste intake process.

## Reporting

Current event infrastructure records:

- impressions;
- clicks.

Useful future reporting can include:

- local impressions;
- clicks;
- click-through rate;
- directions taps;
- booking/offer link taps;
- coupon redemptions if a reliable redemption mechanism is introduced.

Do not promise offline sales attribution unless we actually have a defensible measurement method.

## Scaling rules

The monetization system should scale by adding rows/configuration, not by duplicating product logic per city.

- New cities: no special ad engine rewrite; coordinates/radius continue to work.
- More advertisers: same campaign/target/creative/placement model.
- More visible inventory: change `ad_inventory_settings` deliberately.
- Higher-value packages: use campaign priority/placement weight/radius/placements rather than creating separate ranking engines.
- Multiple locations in a chain: model each physical location appropriately so local radius eligibility remains correct; commercial billing may still be one parent agreement.
- Self-serve billing/portal: defer until manual sales are repeatable enough to justify automation.

## Product-placement guidance

Good future ad surfaces are clearly separated sponsor modules that do not impersonate car-wash results.

Potential future surfaces:

- one sponsored module between groups of organic wash cards;
- a lower Wash Details local-offer module;
- native app home/nearby sponsor module;
- post-wash offer after a completed user journey.

Avoid sponsored map pins initially. The WashRadar map's first job is wash discovery and timing; unrelated business pins can quickly make it noisy and confusing.

## Change-management rule

When a commercial decision changes, update this file in the same release/PR as the code/schema/config change.

Examples:

- C$100 -> C$150;
- 5 km -> 8 km;
- 5 visible sponsors -> 8;
- new Boosted package;
- new placement;
- changed frequency cap;
- images/video;
- self-serve advertiser accounts;
- new attribution/reporting promise.

Do not rely on conversational memory alone. `main`, production Supabase, this document, `docs/DATA_MODEL.md`, and `docs/ADVERTISER_INTAKE.md` together are the durable project memory.
