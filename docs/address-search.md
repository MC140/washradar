# Zero-cost GTA address search

## Current production behaviour

- WashRadar car-wash listings contain their own street addresses and coordinates.
- WashRadar does **not** contain every GTA residential address today.
- Free-text location search currently falls back to Google Geocoding when a cached result is not available.
- Normal browsing no longer calls Google Routes. Traffic and live ETA are delegated to the user's navigation app through the Directions button.

## Authoritative no-cost source

Use Statistics Canada's **National Address Register (NAR)** as the canonical address source. The NAR is a free, georeferenced list of civic addresses published under the Statistics Canada Open Licence and is released as a downloadable public-use file. The former Government of Canada NAR API was retired in 2023, so WashRadar should ingest the downloadable release rather than depend on a public autocomplete API.

Current release URL pattern:

`https://www150.statcan.gc.ca/n1/pub/46-26-0002/2022001/YYYYMM.zip`

Example June 2026 release:

`https://www150.statcan.gc.ca/n1/pub/46-26-0002/2022001/202606.zip`

## Storage strategy

Do not blindly load all Canadian or Ontario addresses into the Supabase free database. First filter the NAR to GTA municipalities/census subdivisions and measure the resulting row/index size.

The production schema includes `address_points`, `address_import_state`, and `address_suggestions()` so a filtered GTA index can be loaded when its size has been verified.

If the filtered/indexed GTA dataset would consume too much of the free 500 MB Postgres allowance, generate a compact autocomplete index partitioned by postal/FSA prefix and serve those static files from the existing GitHub Pages deployment. Supabase then stores only a small cache of selected/previously searched addresses. This preserves $0 address autocomplete while protecting database headroom.

## Search UX

1. After at least 4 characters, query the local GTA address index.
2. Debounce requests (~150-250 ms) and return at most 8 suggestions.
3. Selecting a suggestion sets the map origin directly from stored latitude/longitude; no Google call is needed.
4. City, FSA and postal searches should also resolve locally.
5. Only if an exact address is outside the local coverage may the existing Google Geocoding fallback be used, subject to quota and cache.

## Cost rules

- Browser GPS: $0.
- Local distance calculation: $0.
- Local NAR autocomplete/geocoding: $0 API cost.
- Google Routes: disabled for normal browsing.
- Google Geocoding: fallback only; cache results.
- Google Places: catalogue maintenance only, never normal browsing.
