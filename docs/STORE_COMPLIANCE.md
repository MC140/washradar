# WashRadar store compliance notes

## Account deletion

WashRadar supports permanent accounts, so native distribution requires a clear account-deletion path.

- In-product route: `/account-deletion`
- Public web resource: `https://washradar.ca/account-deletion`
- Backend: authenticated `account-actions` Edge Function
- Business-owner accounts are stopped for manual ownership review rather than silently deleting an active business relationship.
- Account-bound data is deleted; contribution observations may remain only de-identified when required for aggregate timing integrity.

## Privacy

Store disclosures must match actual behavior, including:
- location used for nearby results and contribution verification;
- no public exact GPS trail;
- account/email data through Supabase Auth;
- device/session identifiers used for abuse prevention and analytics;
- optional sponsored-content measurement;
- any native push token if push notifications are later enabled.

## Native permissions

Request only permissions needed by a user-initiated feature. The first native release should avoid always-on background location solely to run the optional wait timer. Use server-backed session timestamps and foreground/resume verification instead.

## Before submission

Re-check the current Apple App Review Guidelines and Google Play account/data-safety requirements immediately before submission; store policies change independently of this repository.
