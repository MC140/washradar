# Catalogue enrichment rules

WashRadar treats Google Places as a directory source, not a source of live queue data.

## Hours and status

- Weekly business hours come from Google Place Details `regularOpeningHours`.
- Zero-valued hour/minute fields are treated as valid midnight values.
- 24/7 and cross-midnight schedules are normalized into `business_hours` rows.
- Current open/closed state is computed from the stored schedule in the Toronto time zone, while permanent/temporary Google business status remains authoritative for unavailable locations.

## Wash type

Google Places does not expose structured `touchless`, `soft-cloth`, `self-serve`, `hand-wash`, `tunnel` or `automatic` fields. WashRadar therefore does not guess these categories from generic `car_wash` data.

The importer may add a high-confidence category only when the Google business name explicitly contains a matching phrase (for example, `Touchless`, `Self Serve`, `Hand Wash`, `Soft Cloth`, `Tunnel`, or `Automatic`). These links carry `source_label=google-name-explicit` and `confidence_score=95`. All other wash types remain unknown until a stronger source is available.

## Resumability

The GTA discovery job stores municipality index and pagination token in `catalogue_import_state`. A stopped import resumes from its saved page instead of restarting the GTA scan.

After discovery completes, the admin workflow re-enriches every saved Google Place ID so older records receive corrected hours/status, then runs an FSA coverage audit.
