# WashRadar local advertiser intake

WashRadar's first paid-ad product is intentionally simple: a verified local business buys a clearly labelled sponsored placement around a real geographic centre. The default product is **C$100/month for a 5 km radius** unless a different commercial package is approved.

Paid placement never changes organic wash wait time, queue data, ratings, or the Recommended result.

## What we ask the business to send

For the standard local package, ask for only these items:

1. **Business name** — exactly how it should appear in WashRadar.
2. **Business address** — the physical location used to centre the 5 km ad radius.
3. **Business category / what you do** — for example auto detailing, tire shop, restaurant, coffee shop, oil change, dealership or another local service.
4. **Best customer link** — website, booking page, offer page, or another approved destination URL.
5. **Offer/message** — one sentence describing what they want drivers to know. If they do not have copy, WashRadar can write it from their business/service and ask them to approve it.
6. **Contact person** — name, email and phone number for billing/approvals; this stays private.
7. **Optional logo/image** — not required for the first text-first local placement.

That is enough for WashRadar to prepare the campaign. The business does **not** need to provide latitude/longitude, postal-code targeting rules, ad-tech settings, analytics tags, or a formatted creative.

## Defaults WashRadar supplies

Unless the business requests otherwise:

- price: **C$100 CAD/month**;
- targeting: **5 km radius** around the verified business address;
- placement: Explore nearby local offers;
- disclosure: **Sponsored** / **Nearby offer**;
- campaign term: one month, renewable;
- call to action: chosen by WashRadar to match the destination, such as `View offer`, `Book now`, `Learn more`, or `Get directions`;
- frequency cap: 3 impressions per WashRadar device/session per campaign per day;
- maximum local inventory shown together: 5 businesses;
- one visible slot per advertiser/business in a single ad request.

## Before activation

WashRadar should verify:

- the business exists at the supplied address;
- the contact is authorized to approve the advertisement;
- the destination URL works and is appropriate;
- the offer/copy is accurate and not misleading;
- payment/booking has been confirmed;
- the campaign has an active date range;
- a radius target, creative and Explore placement are attached to the campaign.

The business should approve the final copy before activation. A simple written confirmation such as `Approved to run this WashRadar ad` is sufficient for the beta process.

## Internal Supabase mapping

- `advertiser_businesses` — business identity, category, private owner/contact relationship, verification state.
- `ad_campaigns` — monthly/flat booking, booked price, dates, priority and frequency cap.
- `ad_geo_targets` — v1 uses `target_kind = 'radius'`, a geographic centre and `radius_km`.
- `ad_creatives` — headline, body, CTA, destination and disclosure.
- `ad_campaign_placements` — connects the campaign to `explore_nearby_offer` or another approved placement.
- `ad_impressions` / `ad_clicks` — campaign performance.

## Business-facing message

> To put your business live on WashRadar, send us: **(1) business name, (2) business address, (3) what your business does, (4) the website/booking/offer link you want customers to open, (5) what you want to promote, and (6) your contact name, email and phone number.** A logo or image is optional. We handle the location targeting, ad formatting and tracking. Our standard local package is C$100/month and targets WashRadar users within 5 km of your business. We send you the final ad for approval before it goes live.

## Launch principle

Start manually. Do not build a large self-serve advertiser portal before there is repeatable demand. A controlled onboarding process lets WashRadar validate pricing, radius size, categories, creative quality and renewal behaviour first. Automate billing/onboarding only after the sales motion is proven.
