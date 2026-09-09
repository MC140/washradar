# Cost optimization rules

1. Google Routes is disabled during normal browsing. Distance is calculated locally; live traffic/ETA is provided by the user's navigation app after Directions is tapped.
2. Google Places is reserved for catalogue maintenance/enrichment, never ordinary browsing.
3. Location search should resolve from a local address index or cache first; Google Geocoding is fallback-only.
4. Queue reports, queue sessions, wash-type contributions, favourites and alerts use Supabase only.
5. Keep old high-volume event/report tables prunable or aggregateable so the free database remains small.
6. Avoid storing large images in Postgres; use static assets or Storage only when needed.
7. Prefer browser/local calculations and cached data over external APIs whenever accuracy is sufficient.