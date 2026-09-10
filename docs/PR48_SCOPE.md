# PR #48 scope

Pre-native hardening for WashRadar before the Capacitor iOS/Android phase.

Implemented here:
- proper HTTP-200 entry points for known public/account routes;
- in-product and public-web account deletion path;
- authenticated `account-actions` deletion backend;
- unsigned guest metrics 401 cleanup;
- optional wait-timer wording/lifecycle clarity;
- large-list render containment and 44px mobile action targets;
- native-ready remote static address-index base;
- common native WebView CORS source preparation;
- synthetic-user UX scanner hardening;
- refreshed auth/native handoff documentation and release checklists.

Explicitly not treated as completed by this web PR:
- Capacitor iOS/Android projects and signing;
- APNs/FCM;
- secure native storage/deep-link bridge;
- SMTP/password recovery configuration;
- leaked-password-protection plan/config change;
- external crash telemetry account/DSN;
- physical iPhone/Android and real-wash transactional testing.
